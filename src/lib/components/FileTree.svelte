<script module lang="ts">
  import type { RawFileNode } from '../utils/treeFlattener';
  import { listen } from '@tauri-apps/api/event';
  import { invoke } from '@tauri-apps/api/core';
  import { uiStore } from '../stores/ui';
  import { editorStore } from '../stores/editor';

  export const sharedNodeCache = new Map<string, RawFileNode[]>();
  export let sharedRootChildren: RawFileNode[] = [];
  export let sharedRootPath: string | null = null;
  export let onCacheUpdated: (() => void) | null = null;

  function getParentPathSync(path: string) {
    const sep = path.includes('\\') ? '\\' : '/';
    const parts = path.split(/[/\\]/);
    parts.pop();
    return parts.join(sep) || path;
  }

  function sortNodesSync(nodes: RawFileNode[]) {
    return nodes.sort((a, b) => {
      if (a.is_dir && !b.is_dir) return -1;
      if (!a.is_dir && b.is_dir) return 1;
      return a.name.localeCompare(b.name);
    });
  }

  let globalWatcherInitialized = false;
  export function initGlobalWatcher() {
    if (globalWatcherInitialized) return;
    globalWatcherInitialized = true;

    interface FsChangeItem {
      type: 'created' | 'deleted' | 'renamed' | 'modified';
      path: string;
      parentPath?: string;
      oldPath?: string;
      newPath?: string;
    }

    // 5.1 — reacts to the Rust unified watcher's single `fs-change` event.
    // This listener owns ONLY the Explorer cache/tree; open-tab state
    // (delete / reload / rename) is handled by App.svelte's listener.
    listen<{ changes: FsChangeItem[]; gitignoreChanged?: boolean }>('fs-change', async (event) => {
      const { changes, gitignoreChanged } = event.payload;
      const expandedSnap = uiStore.getExpandedPathsSetSnapshot();
      const snap = uiStore.getSnapshot();

      // ── .gitignore / .notronignore changed → full cache flush ──────────────
      // gitignore rules affect is_ignored for EVERY file in the tree, not just
      // the directory containing the changed file. Flush everything and re-read
      // all currently-expanded directories to pick up new is_ignored values.
      // This matches VS Code's behavior where all decorations update after a
      // gitignore change.
      if (gitignoreChanged) {
        sharedNodeCache.clear();
        // Re-read root first
        if (sharedRootPath) {
          try {
            const node = await invoke<RawFileNode>('read_directory', {
              path: sharedRootPath, showDotFiles: snap.showDotFiles,
            });
            sharedRootChildren = sortNodesSync(node.children ?? []);
            sharedNodeCache.set(sharedRootPath, sharedRootChildren);
          } catch {}
        }
        // Re-read all other expanded directories concurrently
        const expandedArr = [...expandedSnap].filter(p => p !== sharedRootPath);
        await Promise.all(expandedArr.map(async (p) => {
          try {
            const fullNode = await invoke<RawFileNode>('read_directory', {
              path: p, showDotFiles: snap.showDotFiles,
            });
            sharedNodeCache.set(p, sortNodesSync(fullNode.children ?? []));
          } catch {}
        }));
        if (onCacheUpdated) onCacheUpdated();
        return; // normal per-file handling already included in re-read above
      }

      // ── Normal file-level change handling ──────────────────────────────────
      for (const change of changes) {
        switch (change.type) {
          case 'created':
          case 'deleted':
          case 'modified':
            if (change.parentPath) {
              if (expandedSnap.has(change.parentPath)) {
                try {
                  const fullNode = await invoke<RawFileNode>('read_directory', {
                    path: change.parentPath, showDotFiles: snap.showDotFiles,
                  });
                  sharedNodeCache.set(change.parentPath, sortNodesSync(fullNode.children ?? []));
                } catch {}
              } else {
                sharedNodeCache.delete(change.parentPath);
              }
              if (change.parentPath === sharedRootPath) {
                try {
                  const node = await invoke<RawFileNode>('read_directory', {
                    path: sharedRootPath, showDotFiles: snap.showDotFiles,
                  });
                  sharedRootChildren = sortNodesSync(node.children ?? []);
                  sharedNodeCache.set(sharedRootPath, sharedRootChildren);
                } catch {}
              }
            }
            break;
          case 'renamed':
            if (change.oldPath && change.newPath) {
              sharedNodeCache.delete(change.oldPath);
              const parent = getParentPathSync(change.newPath);
              const oldParent = getParentPathSync(change.oldPath);

              const updateParent = async (p: string) => {
                if (expandedSnap.has(p)) {
                  try {
                    const fullNode = await invoke<RawFileNode>('read_directory', {
                      path: p, showDotFiles: snap.showDotFiles,
                    });
                    sharedNodeCache.set(p, sortNodesSync(fullNode.children ?? []));
                  } catch {}
                } else {
                  sharedNodeCache.delete(p);
                }
                if (p === sharedRootPath) {
                  try {
                    const node = await invoke<RawFileNode>('read_directory', {
                      path: sharedRootPath, showDotFiles: snap.showDotFiles,
                    });
                    sharedRootChildren = sortNodesSync(node.children ?? []);
                    sharedNodeCache.set(sharedRootPath, sharedRootChildren);
                  } catch {}
                }
              };

              await updateParent(oldParent);
              if (parent !== oldParent) {
                await updateParent(parent);
              }
            }
            break;
        }
      }
      if (onCacheUpdated) onCacheUpdated();
    });
  }
</script>

<script lang="ts">
  import { derived } from 'svelte/store';
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import { Folder, File, Ban, ArrowRight } from 'lucide-svelte';
  import type { FlatTreeNode } from '../utils/treeFlattener';
  import type { MenuItem, DragState, ClipboardOp, UndoEntry } from '../utils/explorer';
  import { getParentPath, getFileName, getFileExt, isDir, isValidFileName, humanizeError, getBoundedPos, DRAG_THRESHOLD_PX } from '../utils/explorer';
  import Modal from './Modal.svelte';
  import VirtualList from './VirtualList.svelte';
  import { flattenTree, sortNodes } from '../utils/treeFlattener';
  import TreeNode from './TreeNode.svelte';
  import Tooltip from './Tooltip.svelte';

  interface DirBatchEntry {
    path: string;
    children: RawFileNode[];
  }

  // B.2 — result of the canonical lazy-expand command.
  interface ExpandResult {
    path: string;
    children: RawFileNode[];
    cached: boolean;
  }

  interface Props { rootPath: string }
  let { rootPath }: Props = $props();

  const refreshCounterStore = derived(uiStore, $s => $s.explorerRefreshCounter);
  const showDotFilesStore   = derived(uiStore, $s => $s.showDotFiles);
  const explorerRootStore   = derived(uiStore, $s => $s.explorerRoot);
  
  const expandedPathsStore = uiStore.expandedPaths;
  
  const initialRootChildren = untrack(() => rootPath === sharedRootPath ? sharedRootChildren : []);
  let rootChildren   = $state<RawFileNode[]>(initialRootChildren);
  let errorMsg       = $state<string | null>(null);
  let isInitialLoading = $state(initialRootChildren.length === 0);

  let largeFolderModal = $state<{ isOpen: boolean; resolve: ((v: boolean) => void) | null; message: string }>({
    isOpen: false, resolve: null, message: ''
  });

  function promptLargeFolder(): Promise<boolean> {
    return new Promise((resolve) => {
      largeFolderModal.message = "This folder is very large (>10,000 items). Rendering it might slow down the editor. Open anyway?";
      largeFolderModal.resolve = resolve;
      largeFolderModal.isOpen = true;
    });
  }

  function handleLargeFolderProceed() {
    largeFolderModal.isOpen = false;
    if (largeFolderModal.resolve) largeFolderModal.resolve(true);
    largeFolderModal.resolve = null;
  }

  function handleLargeFolderCancel() {
    largeFolderModal.isOpen = false;
    if (largeFolderModal.resolve) largeFolderModal.resolve(false);
    largeFolderModal.resolve = null;
  }

  // ─── Selection ────────────────────────────────────────────────
  let selectedPaths   = $state<Set<string>>(new Set());
  let anchorPath      = $state<string | null>(null);
  let activePath      = $state<string | null>(null);

  // ─── Clipboard ────────────────────────────────────────────────
  let clipboardPaths  = $state<string[]>([]);
  let clipboardOp     = $state<ClipboardOp>(null);

  // ─── Drag ─────────────────────────────────────────────────────
  let drag = $state<DragState>({
    active: false, paths: [], ghostX: 0, ghostY: 0,
    dropTargetPath: null, dropTargetValid: false, autoExpandTimer: null,
  });
  let pendingDrag: { paths: string[]; startX: number; startY: number } | null = null;
  let dragOccurred = false;
  let ghostEl = $state<HTMLDivElement | null>(null);

  // B.5 — drag-over target computation is throttled to one pass per animation
  // frame (~60fps). `dragover`/`pointermove` can fire hundreds of times/sec;
  // hit-testing + validation must not run more than once per frame.
  let lastPointerX = 0;
  let lastPointerY = 0;
  let dragTargetRaf: number | null = null;

  // ─── Rename inline ────────────────────────────────────────────
  let renamingPath    = $state<string | null>(null);
  let renameValue     = $state('');
  let renameError     = $state('');

  // ─── Create new item ──────────────────────────────────────────
  let creatingIn      = $state<string | null>(null);
  let creatingType    = $state<'file' | 'folder' | null>(null);
  let creatingValue   = $state('');
  let creatingError   = $state('');

  // ─── Extra faded (sementara untuk drag/move) ──────────────────
  let extraFadedPaths = $state<Set<string>>(new Set());

  // ─── Undo stack ───────────────────────────────────────────────
  let undoStack: UndoEntry[] = $state([]);

  // ─── Visual overlay ───────────────────────────────────────────
  // PERF FIX #4b: Hapus fadedPaths sebagai $derived Set.
  // $derived Set = setiap drag.active/clipboardOp berubah → Set baru dibuat → SEMUA
  // visible TreeNode re-render karena Svelte melihat referensi Set berubah.
  // Sekarang inline check langsung di template: zero allocation, zero re-render overhead.
  // fadedPaths.has(node.path) diganti: isNodeFaded(node.path)
  function isNodeFaded(path: string): boolean {
    if (clipboardOp === 'cut' && clipboardPaths.includes(path)) return true;
    if (drag.active && drag.paths.includes(path)) return true;
    return false;
  }

  const _nodeCache = sharedNodeCache;
  let nodeCacheVersion = $state(0);

  let hoveredPath = $state('');

  function handleTreePointerMove(event: PointerEvent) {
    if (drag.active || pendingDrag) {
      if (hoveredPath !== '') hoveredPath = '';
      return;
    }
    const el = (event.target as HTMLElement).closest('[role="treeitem"]');
    if (el) {
      const path = el.getAttribute('data-node-path');
      if (path && path !== hoveredPath) {
        hoveredPath = path;
      }
    } else {
      if (hoveredPath !== '') hoveredPath = '';
    }
  }

  function handleTreePointerLeave() {
    if (hoveredPath !== '') hoveredPath = '';
  }

  // PERF FIX #3: loadingPaths TIDAK masuk ke flatList dependency.
  // Sebelumnya loadingPaths dipass ke flattenTree() → setiap loading state change
  // memicu full tree recompute. Sekarang loadingPaths hanya dikonsumsi langsung
  // oleh TreeNode melalui prop `isLoading`, bukan via flatList.
  let loadingPaths = $state(new Set<string>());

  let ctxMenu = $state<{ isOpen: boolean; x: number; y: number; items: MenuItem[] }>({
    isOpen: false, x: 0, y: 0, items: []
  });

  let expandedSet = $derived($expandedPathsStore);

  // PERF FIX #2: Memoize sortNodes(rootChildren) secara terpisah.
  // Sebelumnya dipanggil inside flatList derived → sortNodes() dipanggil ulang
  // bahkan saat hanya nodeCacheVersion berubah (misal: expand subfolder).
  let sortedRootChildren = $derived(sortNodes(rootChildren));

  let flatList = $derived.by(() => {
    void nodeCacheVersion;
    const creatingItem = creatingIn && creatingType ? { type: creatingType, parentPath: creatingIn } : null;
    // PERF: Gunakan sortedRootChildren yang sudah di-memoize, tidak sort ulang.
    // loadingPaths sengaja TIDAK dipass agar perubahan loading state tidak trigger recompute flatList.
    let list = flattenTree(sortedRootChildren, expandedSet, _nodeCache, 0, creatingItem);
    if (creatingItem && creatingItem.parentPath === rootPath) {
      if (creatingType === 'folder') {
        list.unshift({
          path: '__creating_input__',
          name: '',
          depth: 0,
          is_dir: true,
          isExpanded: false,
          has_children: false,
          is_creating: true,
          creating_type: 'folder'
        });
      } else {
        let insertIndex = 0;
        while (insertIndex < list.length && list[insertIndex].is_dir && !list[insertIndex].is_creating) {
          insertIndex++;
        }
        list.splice(insertIndex, 0, {
          path: '__creating_input__',
          name: '',
          depth: 0,
          is_dir: false,
          isExpanded: false,
          has_children: false,
          is_creating: true,
          creating_type: 'file'
        });
      }
    }
    return list;
  });

  // PERF FIX #4: O(1) path → FlatTreeNode lookup map.
  // Sebelumnya semua tempat pakai flatList.find(n => n.path === x) = O(n) linear scan.
  // Saat drag: isValidDropTarget dipanggil setiap pointer move (60fps) dengan O(n) scan
  // pada list yang bisa ribuan nodes. flatListMap membuatnya O(1).
  let flatListMap = $derived.by(() => {
    const map = new Map<string, import('../utils/treeFlattener').FlatTreeNode>();
    for (const node of flatList) map.set(node.path, node);
    return map;
  });

  // PERF FIX #4b: O(1) path → index lookup untuk keyboard nav & shift-select.
  // findIndex() = O(n) scan. Map lookup = O(1). Dibuat sekali bersamaan flatListMap.
  let flatListIndexMap = $derived.by(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < flatList.length; i++) map.set(flatList[i].path, i);
    return map;
  });


  $effect(() => {
    $showDotFilesStore;
    const rp = $explorerRootStore;
    if (!rp) return;
    loadRoot(rp);
  });

  $effect(() => {
    $refreshCounterStore;
    const rp = $explorerRootStore;
    if (!rp || isInitialLoading) return;
    silentRefresh(rp);
  });

  $effect(() => {
    if (expandedSet.size > 0 && rootChildren.length > 0 && !isInitialLoading) {
      const timer = setTimeout(() => {
        restoreExpandedChildren().catch(console.error);
      }, 100);
      return () => clearTimeout(timer);
    }
  });

  async function restoreExpandedChildren() {
    const expandedSet = uiStore.getExpandedPathsSetSnapshot();
    if (!expandedSet.size) return;

    const toLoad = [...expandedSet].filter(expPath => {
      if (_nodeCache.has(expPath) || expPath === rootPath || loadingPaths.has(expPath)) return false;
      let current = getParentPath(expPath);
      while (current && current.length >= rootPath.length && current !== rootPath) {
        if (!expandedSet.has(current)) return false;
        current = getParentPath(current);
      }
      return true;
    });

    if (toLoad.length === 0) return;

    loadingPaths = new Set([...loadingPaths, ...toLoad]);
    try {
      const showDot = uiStore.getSnapshot().showDotFiles;
      const results = await invoke<DirBatchEntry[]>('read_directory_batch', {
        paths: toLoad,
        showDotFiles: showDot,
      });
      for (const result of results) {
        _nodeCache.set(result.path, sortNodes(result.children));
      }
      nodeCacheVersion++;
    } catch (err) {
      console.warn('restoreExpandedChildren batch failed:', err);
      const showDot = uiStore.getSnapshot().showDotFiles;
      for (const expPath of toLoad) {
        try {
          const fullNode = await invoke<RawFileNode>('read_directory', { path: expPath, showDotFiles: showDot });
          _nodeCache.set(expPath, sortNodes(fullNode.children ?? []));
        } catch {}
      }
      nodeCacheVersion++;
    } finally {
      const next = new Set(loadingPaths);
      for (const p of toLoad) next.delete(p);
      loadingPaths = next;
    }
  }

  async function loadRoot(path: string) {
    isInitialLoading = true;
    errorMsg = null;
    if (sharedRootPath !== path) {
      sharedNodeCache.clear();
      sharedRootPath = path;
      nodeCacheVersion++;
    }
    try {
      const showDotFiles = uiStore.getSnapshot().showDotFiles;
      const res = await invoke<ExpandResult>('expand_folder', { path, showDotFiles });
      const newRootChildren = sortNodes(res.children ?? []);
      if (newRootChildren.length > 10000) {
        const proceed = await promptLargeFolder();
        if (!proceed) {
          uiStore.setExplorerRoot(null);
          isInitialLoading = false;
          return;
        }
      }
      rootChildren = newRootChildren;
      sharedRootChildren = rootChildren;
      _nodeCache.set(path, rootChildren);
      nodeCacheVersion++;
      await restoreExpandedChildren();
    } catch (err) {
      errorMsg = String(err);
      setTimeout(() => uiStore.setExplorerRoot(null), 2000);
    } finally {
      isInitialLoading = false;
    }
  }

  async function silentRefresh(path: string) {
    try {
      const showDotFiles = uiStore.getSnapshot().showDotFiles;
      const res = await invoke<ExpandResult>('expand_folder', { path, showDotFiles });
      const newRootChildren = sortNodes(res.children ?? []);
      rootChildren = newRootChildren;
      sharedRootChildren = rootChildren;
      _nodeCache.set(path, rootChildren);
      nodeCacheVersion++;
    } catch (err) {
      console.warn('silentRefresh failed:', err);
    }
  }

  // ════════════════════════════════════════════════════════════════
  // SECTION 1 — SELECTION
  // ════════════════════════════════════════════════════════════════

  function applySingleSelect(path: string, node: FlatTreeNode, openFile = true) {
    selectedPaths = new Set([path]);
    anchorPath    = path;
    activePath    = path;
    uiStore.setSelectedExplorerPath(path);
    if (openFile && !node.is_dir) openFileInTab(path);
  }

  function applyCtrlSelect(path: string) {
    const next = new Set(selectedPaths);
    if (next.has(path)) {
      next.delete(path);
      if (activePath === path) activePath = [...next][next.size - 1] ?? null;
    } else {
      next.add(path);
      activePath = path;
    }
    selectedPaths = next;
    anchorPath = path;
  }

  function applyShiftSelect(targetPath: string) {
    const anchor     = anchorPath ?? activePath ?? targetPath;
    // PERF: O(1) index lookup via flatListIndexMap
    const anchorIdx  = flatListIndexMap.get(anchor) ?? -1;
    const targetIdx  = flatListIndexMap.get(targetPath) ?? -1;
    if (anchorIdx === -1 || targetIdx === -1) {
      selectedPaths = new Set([targetPath]);
      activePath    = targetPath;
      return;
    }
    const lo = Math.min(anchorIdx, targetIdx);
    const hi = Math.max(anchorIdx, targetIdx);
    const next = new Set(selectedPaths);
    for (let i = lo; i <= hi; i++) next.add(flatList[i].path);
    selectedPaths = next;
    activePath    = targetPath;
  }

  function clearSelection() {
    if (selectedPaths.size === 0) return;
    selectedPaths = new Set();
    anchorPath    = null;
    activePath    = null;
  }

  function selectAll() {
    selectedPaths = new Set(flatList.filter(n => !n.is_creating).map(n => n.path));
    activePath    = flatList[flatList.length - 1]?.path ?? null;
  }

  function handleNodeClick(event: MouseEvent, node: FlatTreeNode) {
    event.stopPropagation();
    window.dispatchEvent(new CustomEvent('notron:cancel-tooltips'));
    if (dragOccurred) {
      dragOccurred = false;
      return;
    }

    if (renamingPath) commitRename();
    if (creatingIn)   cancelCreate();

    const ctrl  = event.ctrlKey || event.metaKey;
    const shift = event.shiftKey;

    if (ctrl && shift) { applyShiftSelect(node.path); return; }
    if (ctrl)          { applyCtrlSelect(node.path);  return; }
    if (shift)         { applyShiftSelect(node.path); return; }

    applySingleSelect(node.path, node);
    if (node.is_dir) handleExpand(node);
  }

  async function handleExpand(node: FlatTreeNode) {
    if (!node.is_dir) return;
    if (expandedSet.has(node.path)) {
      uiStore.toggleExpandedPath(node.path, false);
      return;
    }
    if (_nodeCache.has(node.path)) {
      uiStore.toggleExpandedPath(node.path, true);
      return;
    }
    
    // Prevent duplicate IPC requests if already loading
    if (loadingPaths.has(node.path)) {
      uiStore.toggleExpandedPath(node.path, true);
      return;
    }

    uiStore.toggleExpandedPath(node.path, true);
    loadingPaths = new Set(loadingPaths).add(node.path);

    invoke<ExpandResult>('expand_folder', {
      path: node.path,
      showDotFiles: uiStore.getSnapshot().showDotFiles,
    }).then(async (res) => {
      const children = sortNodes(res.children ?? []);
      if (children.length > 10000) {
        const proceed = await promptLargeFolder();
        if (!proceed) {
          uiStore.toggleExpandedPath(node.path, false);
          return;
        }
      }
      _nodeCache.set(node.path, children);
      nodeCacheVersion++;
    }).catch((err) => {
      console.error('Failed to load directory', node.path, err);
      uiStore.toggleExpandedPath(node.path, false);
    }).finally(() => {
      const next = new Set(loadingPaths);
      next.delete(node.path);
      loadingPaths = next;
    });
  }

  function handleBackgroundClick(event: MouseEvent) {
    window.dispatchEvent(new CustomEvent('notron:cancel-tooltips'));
    if (dragOccurred) {
      dragOccurred = false;
      return;
    }
    if ((event.target as HTMLElement).closest('[role="treeitem"]')) return;
    clearSelection();
    activePath = rootPath;
    uiStore.setSelectedExplorerPath(rootPath);
    if (renamingPath) cancelRename();
    if (creatingIn)   cancelCreate();
  }

  // ════════════════════════════════════════════════════════════════
  // SECTION 2 — KEYBOARD NAVIGATION
  // ════════════════════════════════════════════════════════════════

  function scrollNodeIntoView(path: string) {
    setTimeout(() => {
      const escapedPath = path.replace(/\\/g, '\\\\');
      const el = document.querySelector(`[data-node-path="${escapedPath}"]`);
      if (el) el.scrollIntoView({ block: 'nearest' });
    }, 10);
  }

  function handleTreeKeyDown(event: KeyboardEvent) {
    window.dispatchEvent(new CustomEvent('notron:cancel-tooltips'));
    if ((event.target as HTMLElement)?.tagName === 'INPUT') return;
    const ctrl = event.ctrlKey || event.metaKey;

    if (ctrl && event.key.toLowerCase() === 'a') { event.preventDefault(); selectAll(); return; }
    if (ctrl && event.key.toLowerCase() === 'c') { event.preventDefault(); copySelected(); return; }
    if (ctrl && event.key.toLowerCase() === 'x') { event.preventDefault(); cutSelected();  return; }
    if (ctrl && event.key.toLowerCase() === 'v') { event.preventDefault(); pasteClipboard(); return; }
    if (ctrl && event.key.toLowerCase() === 'z') { event.preventDefault(); undoLastAction(); return; }
    if (event.key === 'F2')        { event.preventDefault(); startRenameActive(); return; }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      deleteSelected();
      return;
    }
    if (event.key === 'Escape') {
      if (renamingPath) { cancelRename(); return; }
      if (creatingIn)   { cancelCreate(); return; }
      clearSelection();
      return;
    }

    if (!activePath) return;
    // PERF: O(1) index lookup via flatListIndexMap
    const currentIdx = flatListIndexMap.get(activePath) ?? -1;
    if (currentIdx === -1) return;

    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault();
        const next = flatList[currentIdx + 1];
        if (!next || next.is_creating) return;
        event.shiftKey ? applyShiftSelect(next.path) : applySingleSelect(next.path, next, false);
        scrollNodeIntoView(next.path);
        break;
      }
      case 'ArrowUp': {
        event.preventDefault();
        const prev = flatList[currentIdx - 1];
        if (!prev || prev.is_creating) return;
        event.shiftKey ? applyShiftSelect(prev.path) : applySingleSelect(prev.path, prev, false);
        scrollNodeIntoView(prev.path);
        break;
      }
      case 'ArrowRight': {
        event.preventDefault();
        const node = flatList[currentIdx];
        if (node.is_dir && !node.isExpanded) handleExpand(node);
        break;
      }
      case 'ArrowLeft': {
        event.preventDefault();
        const node = flatList[currentIdx];
        if (node.is_dir && node.isExpanded) {
          handleExpand(node);
        } else {
          const parentPath = getParentPath(node.path);
          const parentIdx  = flatListIndexMap.get(parentPath) ?? -1;
          if (parentIdx !== -1) {
            applySingleSelect(parentPath, flatList[parentIdx]);
            scrollNodeIntoView(parentPath);
          }
        }
        break;
      }
      case 'Enter': {
        event.preventDefault();
        const node = flatList[currentIdx];
        if (node.is_dir) handleExpand(node);
        else openFileInTab(node.path);
        break;
      }
    }
  }

  // ════════════════════════════════════════════════════════════════
  // SECTION 3 — CONTEXT MENU
  // ════════════════════════════════════════════════════════════════

  function showContextMenu(event: MouseEvent, node?: FlatTreeNode) {
    window.dispatchEvent(new CustomEvent('notron:cancel-tooltips'));
    event.preventDefault();
    event.stopPropagation();

    if (node && !selectedPaths.has(node.path)) {
      applySingleSelect(node.path, node, false);
    } else if (!node) {
      handleBackgroundClick(event);
    }

    const targets = selectedPaths.size > 0 ? [...selectedPaths] : (node ? [node.path] : []);
    const isBackground = !node;

    const pos = getBoundedPos(event.clientX, event.clientY);
    ctxMenu = { isOpen: true, x: pos.x, y: pos.y, items: buildMenuItems(targets, isBackground) };
  }

  function buildMenuItems(targets: string[], isBackground: boolean): MenuItem[] {
    const count      = targets.length;
    const hasFolder  = targets.some(p => isDir(p, flatListMap));
    const hasFile    = targets.some(p => !isDir(p, flatListMap));
    const isSingle   = count === 1;
    const label      = isSingle ? `"${getFileName(targets[0])}"` : `${count} items`;
    const canPaste   = clipboardPaths.length > 0 && clipboardOp !== null;

    if (isBackground || count === 0) {
      return [
        { label: 'New File',       action: () => startCreate('file',   rootPath) },
        { label: 'New Folder',     action: () => startCreate('folder', rootPath) },
        { separator: true, label: '', action: () => {} },
        { label: 'Paste',          action: () => pasteClipboard(), disabled: !canPaste },
        { separator: true, label: '', action: () => {} },
        { label: 'Refresh',        action: () => uiStore.triggerExplorerRefresh() },
        { label: 'Reveal in File Manager', action: () => revealInFileManager(rootPath) },
      ];
    }

    const singleFolderItems: MenuItem[] = hasFolder && isSingle ? [
      { label: 'New File in Folder',   action: () => startCreate('file',   targets[0]) },
      { label: 'New Folder in Folder', action: () => startCreate('folder', targets[0]) },
      { separator: true, label: '', action: () => {} },
    ] : [];

    const result: MenuItem[] = [
      ...(hasFile ? [{
        label: isSingle ? 'Open' : `Open ${count} files`,
        action: () => targets.filter(p => !isDir(p, flatListMap)).forEach(p => openFileInTab(p)),
      }] : []),

      ...(isSingle && !hasFolder ? [{
        label: 'Open to the Side',
        action: () => openFileInTabSplit(targets[0]),
      }] : []),

      ...(hasFile ? [{ separator: true, label: '', action: () => {} }] : []),

      ...singleFolderItems,

      { label: 'Copy',             action: () => copySelected(),   shortcut: 'Ctrl+C' },
      { label: 'Cut',              action: () => cutSelected(),    shortcut: 'Ctrl+X' },
      { label: 'Paste',            action: () => pasteClipboard(), shortcut: 'Ctrl+V', disabled: !canPaste },
      { label: 'Duplicate',        action: () => duplicateSelected(), disabled: !isSingle },
      { separator: true, label: '', action: () => {} },

      { label: 'Rename',           action: () => startRename(targets[0]),  shortcut: 'F2', disabled: !isSingle },
      { label: `Delete ${label}`,  action: () => deleteSelected(),         shortcut: 'Delete', danger: true },
      { separator: true, label: '', action: () => {} },

      { label: 'Copy Path',        action: () => copyPathToClipboard(targets[0]), disabled: !isSingle },
      { label: 'Copy Relative Path', action: () => copyRelativePathToClipboard(targets[0]), disabled: !isSingle },
      { separator: true, label: '', action: () => {} },

      { label: 'Reveal in File Manager', action: () => revealInFileManager(targets[0]), disabled: !isSingle },
      { label: 'Open in Terminal',       action: () => openTerminalAt(
        isSingle && hasFolder ? targets[0] : getParentPath(targets[0])
      )},
    ];

    return result;
  }

  function handleCtxItemAction(item: MenuItem) {
    if (!item.disabled) item.action();
    ctxMenu.isOpen = false;
  }

  // ════════════════════════════════════════════════════════════════
  // SECTION 4 — CLIPBOARD (Copy, Cut, Paste)
  // ════════════════════════════════════════════════════════════════

  function copySelected() {
    if (selectedPaths.size === 0) return;
    clipboardPaths = [...selectedPaths];
    clipboardOp    = 'copy';
    uiStore.addToast(`Copied ${clipboardPaths.length} item(s)`, 'success');
  }

  function cutSelected() {
    if (selectedPaths.size === 0) return;
    clipboardPaths = [...selectedPaths];
    clipboardOp    = 'cut';
    uiStore.addToast(`Cut ${clipboardPaths.length} item(s)`, 'success');
  }

  function clearClipboard() {
    clipboardPaths = [];
    clipboardOp    = null;
  }

  async function pasteClipboard() {
    if (!clipboardOp || clipboardPaths.length === 0) return;

    let destFolder = rootPath;
    if (selectedPaths.size === 1) {
      const p = [...selectedPaths][0];
      destFolder = isDir(p, flatListMap) ? p : getParentPath(p);
    } else if (activePath) {
      destFolder = isDir(activePath, flatListMap) ? activePath : getParentPath(activePath);
    }

    const op = clipboardOp;
    const sources = [...clipboardPaths];

    for (const src of sources) {
      if (isDir(src, flatListMap) && (destFolder === src || destFolder.startsWith(src + '/'))) {
        uiStore.addToast('Cannot paste folder into itself', 'alert');
        return;
      }
    }

    if (op === 'copy') {
      const selfCopy = sources.filter(src => getParentPath(src) === destFolder);
      if (selfCopy.length > 0) {
        for (const src of selfCopy) {
          await duplicateSingleItem(src);
        }
        return;
      }
    }

    try {
      if (op === 'copy') {
        const copies = sources.map(src => ({ sourcePath: src, destPath: `${destFolder}/${getFileName(src)}` }));
        try {
          await invoke('copy_items', { copies: copies.map(c => ({ source_path: c.sourcePath, dest_path: c.destPath })) });
        } catch (err) {
          uiStore.addToast(`Copy failed: ${humanizeError(err)}`, 'alert');
        }
      } else {
        extraFadedPaths = new Set(sources);
        const moves = sources.map(src => ({ oldPath: src, newPath: `${destFolder}/${getFileName(src)}` })).filter(m => m.oldPath !== m.newPath);
        if (moves.length > 0) {
          try {
            await invoke('rename_items', { moves: moves.map(m => ({ old_path: m.oldPath, new_path: m.newPath })) });
          } catch (err) {
            uiStore.addToast(`Move failed: ${humanizeError(err)}`, 'alert');
          }
        }
        clearClipboard();
        extraFadedPaths = new Set();
      }

      await refreshAffectedDirs(sources, destFolder);
      const newPaths = sources.map(src => `${destFolder}/${getFileName(src)}`);
      selectedPaths  = new Set(newPaths);
      activePath     = newPaths[0];
      uiStore.addToast(
        op === 'copy' ? `Pasted ${sources.length} item(s)` : `Moved ${sources.length} item(s)`,
        'success'
      );
    } catch (err) {
      if (op === 'cut') extraFadedPaths = new Set();
      uiStore.addToast(`${op === 'copy' ? 'Copy' : 'Move'} failed: ${humanizeError(err)}`, 'alert');
    }
  }

  async function duplicateSelected() {
    if (selectedPaths.size !== 1) return;
    const srcPath    = [...selectedPaths][0];
    await duplicateSingleItem(srcPath);
  }

  async function duplicateSingleItem(srcPath: string) {
    const parentPath = getParentPath(srcPath);
    const name       = getFileName(srcPath);
    const ext        = getFileExt(name);
    const base       = ext ? name.slice(0, -ext.length - 1) : name;

    const siblings = await getOrFetchDirContents(parentPath);
    const siblingNames = new Set(siblings.map(n => n.name));

    let newName = ext ? `${base} copy.${ext}` : `${base} copy`;
    let counter = 2;
    while (siblingNames.has(newName)) {
      newName = ext ? `${base} copy ${counter}.${ext}` : `${base} copy ${counter}`;
      counter++;
    }

    const destPath = `${parentPath}/${newName}`;
    try {
      await invoke('copy_item', { sourcePath: srcPath, destPath });
      invalidateDirCache(parentPath);
      nodeCacheVersion++;

      selectedPaths = new Set([destPath]);
      activePath    = destPath;

      await tick();
      startRename(destPath);
    } catch (err) {
      uiStore.addToast(`Duplicate failed: ${humanizeError(err)}`, 'alert');
    }
  }

  async function getOrFetchDirContents(folderPath: string): Promise<{ name: string; path: string; is_dir: boolean }[]> {
    if (_nodeCache.has(folderPath)) return _nodeCache.get(folderPath)!;
    try {
      const res = await invoke<ExpandResult>('expand_folder', {
        path: folderPath,
        showDotFiles: uiStore.getSnapshot().showDotFiles,
      });
      const children = sortNodes(res.children ?? []);
      _nodeCache.set(folderPath, children);
      return children;
    } catch {
      return [];
    }
  }

  function invalidateDirCache(path: string) {
    const normalized = path.replace(/\\/g, '/');
    for (const key of _nodeCache.keys()) {
      const normalizedKey = key.replace(/\\/g, '/');
      if (normalizedKey === normalized || normalizedKey.startsWith(normalized + '/')) {
        _nodeCache.delete(key);
      }
    }
  }

  function removeFromDirCache(parentPath: string, childPath: string) {
    const children = _nodeCache.get(parentPath);
    if (children) {
      _nodeCache.set(parentPath, children.filter(c => c.path !== childPath));
    }
  }

  function addToDirCache(parentPath: string, node: RawFileNode) {
    const children = _nodeCache.get(parentPath);
    if (children) {
      _nodeCache.set(parentPath, sortNodes([...children, node]));
    }
  }

  function renameDirCacheKey(oldPath: string, newPath: string) {
    if (_nodeCache.has(oldPath)) {
      _nodeCache.set(newPath, _nodeCache.get(oldPath)!);
      _nodeCache.delete(oldPath);
    }
    for (const key of [..._nodeCache.keys()]) {
      if (key.startsWith(oldPath + '/')) {
        const newKey = newPath + key.slice(oldPath.length);
        _nodeCache.set(newKey, _nodeCache.get(key)!);
        _nodeCache.delete(key);
      }
    }
  }

  async function refreshAffectedDirs(sources: string[], destFolder: string) {
    const parents = new Set<string>([destFolder]);
    for (const src of sources) parents.add(getParentPath(src));
    for (const p of parents) {
      if (expandedSet.has(p) || p === rootPath) {
        try {
          const res = await invoke<ExpandResult>('expand_folder', {
            path: p,
            showDotFiles: uiStore.getSnapshot().showDotFiles,
          });
          _nodeCache.set(p, sortNodes(res.children ?? []));
        } catch {}
      }
    }
    nodeCacheVersion++;
  }

  function updateExpandedPathsAfterRename(oldPath: string, newPath: string) {
    const expanded = uiStore.getExpandedPathsSetSnapshot();
    const next = new Set(expanded);
    if (next.has(oldPath)) { next.delete(oldPath); next.add(newPath); }
    for (const p of expanded) {
      if (p.startsWith(oldPath + '/')) {
        next.delete(p);
        next.add(newPath + p.slice(oldPath.length));
      }
    }
    uiStore.setExpandedPathsSet(next);
  }

  function updateOpenTabsAfterRename(oldPath: string, newPath: string) {
    const tabs = editorStore.getTabsSnapshot();
    for (const tab of tabs) {
      if (tab.path === oldPath) {
        editorStore.updateTabPath(oldPath, newPath);
      } else if (tab.path.startsWith(oldPath + '/')) {
        const newTabPath = newPath + tab.path.slice(oldPath.length);
        editorStore.updateTabPath(tab.path, newTabPath);
      }
    }
  }

  // ════════════════════════════════════════════════════════════════
  // SECTION 5 — DELETE
  // ════════════════════════════════════════════════════════════════

  let deleteConfirmState = $state<{ targets: string[]; isOpen: boolean; requireTyping?: string }>({
    targets: [], isOpen: false
  });

  async function deleteSelected() {
    if (selectedPaths.size === 0) return;
    const targets = [...selectedPaths];

    const isAllSelected = selectedPaths.size === flatList.filter(n => !n.is_creating).length;

    deleteConfirmState = {
      targets,
      isOpen: true,
      requireTyping: isAllSelected ? 'delete' : undefined,
    };
  }

  async function confirmDelete() {
    const targets = deleteConfirmState.targets;
    if (targets.length === 0) return;
    deleteConfirmState = { targets: [], isOpen: false };

    const prevSelected = new Set(selectedPaths);
    extraFadedPaths = new Set(targets);

    try {
      await invoke('delete_items', { paths: targets });
      for (const p of targets) {
        editorStore.closeTab(p);
        const parentPath = getParentPath(p);
        removeFromDirCache(parentPath, p);
        if (parentPath === rootPath) {
          sharedRootChildren = sharedRootChildren.filter(c => c.path !== p);
          rootChildren = sharedRootChildren;
        }
        _nodeCache.delete(p);
      }

      const newClipboard = clipboardPaths.filter(p => !targets.includes(p));
      if (newClipboard.length !== clipboardPaths.length) {
        clipboardPaths = newClipboard;
        if (clipboardPaths.length === 0) clipboardOp = null;
      }

      for (const p of targets) {
        editorStore.markTabDeleted(p);
      }

      selectedPaths   = new Set();
      activePath      = null;
      extraFadedPaths = new Set();
      nodeCacheVersion++;

      uiStore.addToast(`Deleted ${targets.length === 1 ? getFileName(targets[0]) : `${targets.length} items`}`, 'success');
    } catch (err) {
      selectedPaths   = prevSelected;
      extraFadedPaths = new Set();
      uiStore.addToast(`Delete failed: ${humanizeError(err)}`, 'alert');
    }
  }

  function cancelDeleteConfirm() {
    deleteConfirmState = { targets: [], isOpen: false };
  }

  // ════════════════════════════════════════════════════════════════
  // SECTION 6 — RENAME INLINE
  // ════════════════════════════════════════════════════════════════

  function startRenameActive() {
    if (!activePath) return;
    startRename(activePath);
  }

  function startRename(path: string) {
    if (renamingPath === path) return;
    if (renamingPath) cancelRename();
    if (creatingIn)   cancelCreate();

    renamingPath = path;
    renameValue  = getFileName(path);
    renameError  = '';

    tick().then(() => {
      const input = document.querySelector<HTMLInputElement>('.rename-input');
      if (!input) return;
      input.focus();
      const ext   = getFileExt(renameValue);
      const selEnd = ext ? renameValue.length - ext.length - 1 : renameValue.length;
      input.setSelectionRange(0, selEnd);
    });
  }

  function validateRenameValue(value: string): string | null {
    if (!value.trim())                        return 'Name cannot be empty';
    if (value === getFileName(renamingPath!)) return null;
    if (!isValidFileName(value))               return 'Name contains invalid characters';

    const parent   = getParentPath(renamingPath!);
    const siblings = _nodeCache.get(parent) ?? [];
    const exists   = siblings.some(n =>
      n.name.toLowerCase() === value.toLowerCase() &&
      n.name !== value &&
      n.path !== renamingPath
    );
    if (exists) return `"${value}" already exists`;

    return null;
  }

  function handleRenameInput(value: string) {
    renameValue = value;
    renameError = validateRenameValue(value) ?? '';
  }

  async function commitRename() {
    if (!renamingPath) return;

    const oldPath = renamingPath;
    const newName = renameValue.trim();

    if (newName === getFileName(oldPath)) {
      cancelRename();
      return;
    }

    const error = validateRenameValue(newName);
    if (error) {
      renameError = error;
      return;
    }

    const newPath = `${getParentPath(oldPath)}/${newName}`;

    renameNodeOptimistic(oldPath, newName);
    renamingPath = null;

    try {
      await invoke('rename_item', { old_path: oldPath, new_path: newPath });

      renameDirCacheKey(oldPath, newPath);
      updateExpandedPathsAfterRename(oldPath, newPath);
      updateOpenTabsAfterRename(oldPath, newPath);

      const next = new Set(selectedPaths);
      if (next.has(oldPath)) { next.delete(oldPath); next.add(newPath); }
      selectedPaths = next;
      if (activePath === oldPath) activePath = newPath;
      if (anchorPath === oldPath) anchorPath = newPath;

      nodeCacheVersion++;
    } catch (err) {
      renameNodeOptimistic(newPath, getFileName(oldPath));
      uiStore.addToast(`Rename failed: ${humanizeError(err)}`, 'alert');
    }
  }

  function cancelRename() {
    if (!renamingPath) return;
    renamingPath = null;
    renameValue  = '';
    renameError  = '';
  }

  function renameNodeOptimistic(path: string, newName: string) {
    const parent = getParentPath(path);
    const children = _nodeCache.get(parent);
    if (children) {
      _nodeCache.set(parent, children.map(c => {
        if (c.path === path) {
          const newPath = `${parent}/${newName}`;
          return { ...c, name: newName, path: newPath };
        }
        return c;
      }));
      nodeCacheVersion++;
    }
    if (path === rootPath || rootChildren.some(c => c.path === path)) {
      sharedRootChildren = sharedRootChildren.map(c => {
        if (c.path === path) {
          return { ...c, name: newName, path: `${getParentPath(path)}/${newName}` };
        }
        return c;
      });
      rootChildren = sharedRootChildren;
    }
  }

  function handleRenameKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter')  { event.preventDefault(); commitRename(); }
    if (event.key === 'Escape') { event.preventDefault(); cancelRename(); }
  }

  // ════════════════════════════════════════════════════════════════
  // SECTION 7 — CREATE NEW FILE/FOLDER
  // ════════════════════════════════════════════════════════════════

  async function startCreate(type: 'file' | 'folder', parentPath: string) {
    if (renamingPath) cancelRename();
    if (creatingIn)   cancelCreate();

    const parentNode = flatListMap.get(parentPath);
    if (parentNode && !parentNode.isExpanded) {
      await handleExpand(parentNode);
      await tick();
    }

    creatingIn    = parentPath;
    creatingType  = type;
    creatingValue = '';
    creatingError = '';

    await tick();
    document.querySelector<HTMLInputElement>('.create-input')?.focus();
  }

  function validateCreateValue(value: string, parentPath: string): string | null {
    if (!value.trim())                        return 'Name cannot be empty';
    if (!isValidFileName(value))               return 'Name contains invalid characters';

    const siblings   = _nodeCache.get(parentPath) ?? [];
    const exists     = siblings.some(n => n.name.toLowerCase() === value.toLowerCase());
    if (exists)                               return `"${value}" already exists`;

    return null;
  }

  async function commitCreate() {
    if (!creatingIn || !creatingType) return;

    const name       = creatingValue.trim();
    const parentPath = creatingIn;
    const type       = creatingType;

    const error = validateCreateValue(name, parentPath);
    if (error) { creatingError = error; return; }

    const newPath = `${parentPath}/${name}`;
    creatingIn   = null;
    creatingType = null;

    try {
      if (type === 'file') {
        await invoke('create_file', { path: newPath });
      } else {
        await invoke('create_directory', { path: newPath });
      }

      const newNode = { name, path: newPath, is_dir: type === 'folder' };
      addToDirCache(parentPath, newNode);
      if (parentPath === rootPath) {
        sharedRootChildren = sortNodes([...sharedRootChildren, newNode]);
        rootChildren = sharedRootChildren;
      }
      nodeCacheVersion++;

      selectedPaths = new Set([newPath]);
      activePath    = newPath;

      if (type === 'file') openFileInTab(newPath);
    } catch (err) {
      uiStore.addToast(`Create ${type} failed: ${humanizeError(err)}`, 'alert');
    }
  }

  function cancelCreate() {
    creatingIn    = null;
    creatingType  = null;
    creatingValue = '';
    creatingError = '';
  }

  // ════════════════════════════════════════════════════════════════
  // SECTION 8 — DRAG-TO-MOVE
  // ════════════════════════════════════════════════════════════════

  function handleNodePointerDown(event: PointerEvent, node: FlatTreeNode) {
    if (event.button !== 0) return;
    window.dispatchEvent(new CustomEvent('notron:cancel-tooltips'));
    if (renamingPath) { commitRename(); return; }

    dragOccurred = false;

    const ctrl  = event.ctrlKey || event.metaKey;
    const shift = event.shiftKey;

    let pathsToDrag: string[];
    if (selectedPaths.has(node.path) && selectedPaths.size > 1) {
      pathsToDrag = [...selectedPaths];
    } else {
      // Jangan reset selection jika Ctrl/Shift ditekan —
      // handleNodeClick yang akan menangani multi-select dengan benar
      if (!ctrl && !shift && !selectedPaths.has(node.path)) {
        applySingleSelect(node.path, node, false);
      }
      pathsToDrag = selectedPaths.has(node.path) ? [...selectedPaths] : [node.path];
    }

    pendingDrag = { paths: pathsToDrag, startX: event.clientX, startY: event.clientY };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function handleNodePointerMove(event: PointerEvent) {
    if (!pendingDrag) return;
    const dx = Math.abs(event.clientX - pendingDrag.startX);
    const dy = Math.abs(event.clientY - pendingDrag.startY);
    if (dx < DRAG_THRESHOLD_PX && dy < DRAG_THRESHOLD_PX) return;
    startDrag(pendingDrag.paths, event.clientX, event.clientY);
    pendingDrag = null;
  }

  function handleNodePointerUp(event: PointerEvent, node: FlatTreeNode) {
    if (!drag.active) {
      event.stopPropagation();
    }
    if (pendingDrag) {
      pendingDrag = null;
      const ctrl  = event.ctrlKey || event.metaKey;
      const shift = event.shiftKey;
      if (!ctrl && !shift) {
        applySingleSelect(node.path, node);
      }
    }
  }

  function startDrag(paths: string[], x: number, y: number) {
    dragOccurred = true;
    drag = { active: true, paths, ghostX: x, ghostY: y,
             dropTargetPath: null, dropTargetValid: false, autoExpandTimer: null };
    window.addEventListener('pointermove', onDragMove, { passive: true });
    window.addEventListener('pointerup',   onDragEnd);
    window.addEventListener('keydown',     onDragEscKey);
    window.addEventListener('blur',        onDragWindowBlur);
  }

  function onDragMove(event: PointerEvent) {
    if (!drag.active) return;

    lastPointerX = event.clientX;
    lastPointerY = event.clientY;

    // ✅ Direct DOM update for ghost position — bypasses Svelte reactivity entirely
    if (ghostEl) {
      ghostEl.style.left = `${event.clientX + 14}px`;
      ghostEl.style.top  = `${event.clientY - 8}px`;
    }

    // B.5 — coalesce drop-target computation to one pass per animation frame.
    // Raw pointermove can fire hundreds of times/sec; isValidDropTarget + the
    // elementFromPoint hit-test must not run more often than the screen can
    // refresh (same pattern as VS Code's drag feedback, throttled to ~60fps).
    if (dragTargetRaf !== null) return;
    dragTargetRaf = requestAnimationFrame(() => {
      dragTargetRaf = null;
      updateDragTarget();
    });
  }

  function updateDragTarget() {
    if (!drag.active) return;

    // ✅ pointer-events:none on ghost is already set — no need to hide/show
    const el      = document.elementFromPoint(lastPointerX, lastPointerY);
    const nodeEl  = el?.closest('[data-node-path]') as HTMLElement | null;
    const targetPath = nodeEl?.dataset.nodePath ?? null;

    // ✅ Only update Svelte $state when drop target actually changes
    if (targetPath === drag.dropTargetPath) return;

    if (drag.autoExpandTimer) clearTimeout(drag.autoExpandTimer);

    const isValid   = targetPath !== null && isValidDropTarget(targetPath, drag.paths);
    let expandTimer: ReturnType<typeof setTimeout> | null = null;

    if (isValid && targetPath) {
      const targetNode = flatListMap.get(targetPath);
      if (targetNode?.is_dir && !targetNode.isExpanded) {
        expandTimer = setTimeout(() => handleExpand(targetNode), 600);
      }
    }

    // Property mutation instead of object spread — Svelte only re-renders
    // components that read these specific properties
    drag.dropTargetPath   = targetPath;
    drag.dropTargetValid  = isValid;
    drag.autoExpandTimer  = expandTimer;
  }

  function isValidDropTarget(targetPath: string, draggedPaths: string[]): boolean {
    // PERF: O(1) lookup via flatListMap instead of O(n) flatList.find()
    const targetNode = flatListMap.get(targetPath);
    if (!targetNode && targetPath !== rootPath) return false;
    if (targetNode && !targetNode.is_dir) return false;

    for (const p of draggedPaths) {
      if (targetPath === p)                          return false;
      if (targetPath.startsWith(p + '/'))            return false;
      if (targetPath.startsWith(p + '\\'))           return false;
    }

    return true;
  }

  async function onDragEnd(_event: PointerEvent) {
    if (!drag.active) return;
    cleanupDragListeners();

    const { paths: sourcePaths, dropTargetPath, dropTargetValid } = drag;

    if (drag.autoExpandTimer) clearTimeout(drag.autoExpandTimer);

    drag = { active: false, paths: [], ghostX: 0, ghostY: 0,
             dropTargetPath: null, dropTargetValid: false, autoExpandTimer: null };
    pendingDrag = null;

    if (!dropTargetValid || !dropTargetPath) return;

    const targetNode = flatListMap.get(dropTargetPath);
    const destFolder = dropTargetPath === rootPath
      ? rootPath
      : (targetNode?.is_dir ? dropTargetPath : getParentPath(dropTargetPath));

    if (sourcePaths.every(p => getParentPath(p) === destFolder)) return;

    await executeMoveItems(sourcePaths, destFolder);
  }

  function onDragEscKey(event: KeyboardEvent) {
    if (event.key === 'Escape' && drag.active) cancelDrag();
  }

  function onDragWindowBlur() {
    if (drag.active) cancelDrag();
  }

  function cancelDrag() {
    cleanupDragListeners();
    if (drag.autoExpandTimer) clearTimeout(drag.autoExpandTimer);
    drag = { active: false, paths: [], ghostX: 0, ghostY: 0,
             dropTargetPath: null, dropTargetValid: false, autoExpandTimer: null };
    pendingDrag = null;
  }

  function cleanupDragListeners() {
    if (dragTargetRaf !== null) {
      cancelAnimationFrame(dragTargetRaf);
      dragTargetRaf = null;
    }
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup',   onDragEnd);
    window.removeEventListener('keydown',     onDragEscKey);
    window.removeEventListener('blur',        onDragWindowBlur);
  }

  // ════════════════════════════════════════════════════════════════
  // SECTION 8b — OPTIMISTIC MOVE + ROLLBACK (B.5)
  // ════════════════════════════════════════════════════════════════

  // B.5 — optimistic UI: the move is applied to the local tree state *in the
  // same frame* the drop happens, then `rename_items` runs async in the
  // background. If the commit fails (permission / name conflict / …), the
  // frontend state is rolled back to the pre-drop snapshot. No optimistic
  // without a rollback plan.
  async function executeMoveItems(sourcePaths: string[], destFolder: string) {
    for (const src of sourcePaths) {
      if (isDir(src, flatListMap) && (destFolder === src || destFolder.startsWith(src + '/'))) {
        uiStore.addToast('Cannot move folder into itself', 'alert');
        return;
      }
    }

    const moves = sourcePaths
      .map(p => ({ oldPath: p, newPath: `${destFolder}/${getFileName(p)}` }))
      .filter(m => m.oldPath !== m.newPath);
    if (moves.length === 0) return;

    const snap = snapshotExplorerState();
    extraFadedPaths = new Set(sourcePaths);

    // Apply locally first → user sees the result instantly (target UX B.3).
    const tabRenames = applyMovesOptimistic(moves, destFolder);

    try {
      // Single batched command for all items (B.5 — 1 IPC, not N round-trips).
      await invoke('rename_items', { moves: moves.map(m => ({ old_path: m.oldPath, new_path: m.newPath })) });

      // Reveal the moved items: expand the destination folder if it isn't
      // expanded yet (reads from disk, which now contains the moved entries).
      const destNode = flatListMap.get(destFolder);
      if (destNode && !destNode.isExpanded) {
        handleExpand(destNode).catch(() => {});
      }

      if (moves.length > 0) {
        uiStore.addToast(`Moved ${moves.length} item(s)`, 'success');
      }
    } catch (err) {
      // Commit failed → roll back the optimistic update.
      restoreExplorerState(snap, tabRenames);
      uiStore.addToast(`Move failed: ${humanizeError(err)}`, 'alert');
    } finally {
      extraFadedPaths = new Set();
    }
  }

  function snapshotExplorerState() {
    return {
      nodeCache: new Map(_nodeCache),
      rootChildren: [...rootChildren],
      sharedRootChildren: [...sharedRootChildren],
      selectedPaths: new Set(selectedPaths),
      activePath,
      anchorPath,
      expandedPaths: new Set(uiStore.getExpandedPathsSetSnapshot()),
    };
  }

  // Apply the move to every piece of frontend state we own. Returns the tab
  // renames performed (old→new) so a failed commit can reverse exactly them.
  function applyMovesOptimistic(
    moves: Array<{ oldPath: string; newPath: string }>,
    destFolder: string,
  ): Array<{ from: string; to: string }> {
    const tabRenames: Array<{ from: string; to: string }> = [];

    for (const { oldPath, newPath } of moves) {
      const name = getFileName(newPath);
      const oldParent = getParentPath(oldPath);
      const isDirOld = isDir(oldPath, flatListMap);

      removeFromDirCache(oldParent, oldPath);
      if (oldParent === rootPath) {
        sharedRootChildren = sharedRootChildren.filter(c => c.path !== oldPath);
      }

      addToDirCache(destFolder, { name, path: newPath, is_dir: isDirOld });
      if (destFolder === rootPath) {
        sharedRootChildren = sortNodes([...sharedRootChildren, { name, path: newPath, is_dir: isDirOld }]);
      }
      rootChildren = sharedRootChildren;

      renameDirCacheKey(oldPath, newPath);
      // B.5 — expanded-path set follows the moved folder (was missing before).
      updateExpandedPathsAfterRename(oldPath, newPath);

      // Update open tabs' paths now, recording exactly what we changed.
      for (const tab of editorStore.getTabsSnapshot()) {
        if (tab.path === oldPath) {
          tabRenames.push({ from: newPath, to: oldPath });
          editorStore.updateTabPath(oldPath, newPath);
        } else if (tab.path.startsWith(oldPath + '/')) {
          const newTabPath = newPath + tab.path.slice(oldPath.length);
          tabRenames.push({ from: newTabPath, to: tab.path });
          editorStore.updateTabPath(tab.path, newTabPath);
        }
      }
    }

    nodeCacheVersion++;

    // B.5 — selection updates in the same frame as the drop (optimistic);
    // a failed commit restores it from the snapshot.
    const newPaths = moves.map(m => m.newPath);
    selectedPaths  = new Set(newPaths);
    activePath     = newPaths[0] ?? null;

    return tabRenames;
  }

  function restoreExplorerState(
    snap: ReturnType<typeof snapshotExplorerState>,
    tabRenames: Array<{ from: string; to: string }>,
  ) {
    _nodeCache.clear();
    for (const [k, v] of snap.nodeCache) _nodeCache.set(k, v);
    sharedRootChildren = snap.sharedRootChildren;
    rootChildren = snap.rootChildren;
    selectedPaths = snap.selectedPaths;
    activePath = snap.activePath;
    anchorPath = snap.anchorPath;
    uiStore.setExpandedPathsSet(snap.expandedPaths);

    // Reverse exactly the tab renames we performed optimistically.
    for (const r of tabRenames) {
      editorStore.updateTabPath(r.from, r.to);
    }

    nodeCacheVersion++;
  }

  function handleRootAreaPointerUp(event: PointerEvent) {
    if (!drag.active) return;
    const el = event.target as HTMLElement;
    const isOnNode = el.closest('[data-node-path]') as HTMLElement | null;
    if (isOnNode && isOnNode.dataset.nodePath !== rootPath) return;

    if (drag.active && drag.paths.length > 0) {
      const allAtRoot = drag.paths.every(p => getParentPath(p) === rootPath);
      if (!allAtRoot) {
        drag.dropTargetPath = rootPath;
        drag.dropTargetValid = isValidDropTarget(rootPath, drag.paths);
        onDragEnd(event);
      } else {
        cancelDrag();
      }
    }
  }

  // ════════════════════════════════════════════════════════════════
  // SECTION 9 — UNDO STACK
  // ════════════════════════════════════════════════════════════════

  async function undoLastAction() {
    const entry = undoStack.shift();
    if (!entry) { uiStore.addToast('Nothing to undo', 'success'); return; }

    try {
      switch (entry.type) {
        case 'move':
          await invoke('rename_item', {
            oldPath: entry.payload.newPath,
            newPath: entry.payload.oldPath,
          });
          break;
        case 'rename':
          await invoke('rename_item', { old_path: entry.payload.newPath, new_path: entry.payload.oldPath });
          break;
        case 'create':
          await invoke('delete_item', { path: entry.payload.path });
          break;
        case 'copy':
          if (entry.payload.destPaths) {
            for (const p of entry.payload.destPaths) {
              try { await invoke('delete_item', { path: p }); } catch {}
            }
          }
          break;
        case 'delete':
          uiStore.addToast('Cannot undo delete (file permanently removed)', 'alert');
          return;
      }

      uiStore.triggerExplorerRefresh();
      uiStore.addToast('Undone', 'success');
    } catch (err) {
      uiStore.addToast(`Undo failed: ${humanizeError(err)}`, 'alert');
    }
  }

  // ════════════════════════════════════════════════════════════════
  // SECTION 10 — FILE/TAB OPERATIONS
  // ════════════════════════════════════════════════════════════════

  function openFileInTab(path: string) {
    const name = getFileName(path);
    const isImg = /\.(png|jpe?g|gif|webp|svg|ico)$/i.test(name);
    if (isImg) {
      editorStore.addTab({ id: path, path, name, content: '', language: 'image', isPreview: true });
      return;
    }

    // Deduplicate rapid clicks: if already loading, just activate the tab
    const existing = editorStore.getTabsSnapshot().find(t => t.id === path);
    if (existing && existing.isLoading) {
      editorStore.addTab(existing);
      return;
    }

    editorStore.addTab({ id: path, path, name, content: null, language: 'plaintext', isPreview: true, isLoading: true });
    invoke<string>('read_file_text', { path }).then((content) => {
      editorStore.setInitialContent(path, content);
    }).catch((err) => {
      const errStr = String(err);
      if (errStr === '__BINARY__') {
        editorStore.setTabUnsupported(path, true);
        editorStore.setInitialContent(path, '');
      } else if (errStr === '__LARGE_FILE__') {
        editorStore.closeTab(path);
        if (confirm(`"${name}" is large (>1MB). Open anyway? Syntax highlighting will be disabled.`)) {
          editorStore.addTab({
            id: path, path, name, content: '', language: 'plaintext', isPreview: true, isLargeFile: true, isLoading: true
          });
          invoke<any>('read_file_chunked', { path }).then(chunked => {
            editorStore.setInitialContent(path, chunked.content);
            editorStore.setTabLoading(path, false);
          }).catch(e => {
            console.error('Failed to load chunked file:', e);
            editorStore.setTabLoading(path, false);
          });
        }
      } else {
        console.error('Failed to open file:', path, err);
        editorStore.setTabLoading(path, false);
      }
    });
  }

  function openFileInTabSplit(path: string) {
    openFileInTab(path);
  }

  function copyPathToClipboard(path: string) {
    navigator.clipboard.writeText(path);
  }

  function copyRelativePathToClipboard(path: string) {
    if (path.startsWith(rootPath + '/') || path.startsWith(rootPath + '\\')) {
      navigator.clipboard.writeText(path.slice(rootPath.length + 1));
    } else {
      navigator.clipboard.writeText(path);
    }
  }

  function revealInFileManager(_path: string) {
    import('@tauri-apps/plugin-opener').then(({ openPath }) => {
      openPath(getParentPath(_path)).catch(() => {});
    }).catch(() => {});
  }

  function openTerminalAt(_path: string) {
    const terminalStore = (window as any).__notronTerminalStore;
    if (terminalStore) {
      terminalStore.openTerminal(_path);
    }
  }

  // ════════════════════════════════════════════════════════════════
  // LIFECYCLE
  // ════════════════════════════════════════════════════════════════

  onMount(() => {
    initGlobalWatcher();
    onCacheUpdated = () => {
      rootChildren = sharedRootChildren;
      nodeCacheVersion++;
    };

    const handleCreateFile = () => {
      setTimeout(() => {
        const targetPath = resolveCreationTarget();
        startCreate('file', targetPath);
      }, 10);
    };

    const handleCreateFolder = () => {
      setTimeout(() => {
        const targetPath = resolveCreationTarget();
        startCreate('folder', targetPath);
      }, 10);
    };

    document.addEventListener('notron-create-file', handleCreateFile);
    document.addEventListener('notron-create-folder', handleCreateFolder);

    return () => {
      document.removeEventListener('notron-create-file', handleCreateFile);
      document.removeEventListener('notron-create-folder', handleCreateFolder);
      onCacheUpdated = null;
    };
  });

  onDestroy(() => {
    if (drag.active) {
      cleanupDragListeners();
    }
    if (drag.autoExpandTimer) clearTimeout(drag.autoExpandTimer);
  });

  function resolveCreationTarget(): string {
    const selected = uiStore.getSnapshot().selectedExplorerPath;
    if (!selected || selected === rootPath) return rootPath;
    const node = flatListMap.get(selected);
    if (node) return node.is_dir ? selected : getParentPath(selected);
    return getParentPath(selected);
  }
</script>

{#if errorMsg}
  <div class="p-4 text-xs text-red-500">Failed to load: {errorMsg}.<br/><br/>Resetting workspace...</div>

{:else if isInitialLoading}
  <div class="flex flex-col gap-1.5 p-2 pt-1">
    {#each [75, 55, 88, 45, 68, 38, 82, 50] as w}
      <div
        class="h-3.5 rounded animate-pulse bg-hover"
        style="width: {w}%"
      ></div>
    {/each}
  </div>

{:else if rootChildren.length === 0}
  <Tooltip content={hoveredPath} disabled={!hoveredPath} followCursor={true} hoverDelay={400} wrapperClass="flex-1 flex flex-col min-h-0 min-w-0">
    <div 
      class="p-4 text-xs text-muted flex-1 h-full outline-none transition-all {activePath === rootPath ? 'bg-surface-2 ring-1 ring-inset ring-focus' : ''}"
      role="presentation"
      onclick={handleBackgroundClick}
      oncontextmenu={(e) => showContextMenu(e)}
      data-node-path={rootPath}
      onpointerup={handleRootAreaPointerUp}
      onpointermove={handleTreePointerMove}
      onpointerleave={handleTreePointerLeave}
    >
      Empty folder.
    </div>
  </Tooltip>

{:else}
  <Tooltip content={hoveredPath} disabled={!hoveredPath} followCursor={true} hoverDelay={400} wrapperClass="flex-1 flex flex-col min-h-0 min-w-0">
    <div
      class="flex-1 h-full outline-none flex flex-col p-2 transition-all {activePath === rootPath ? 'bg-surface-2 ring-1 ring-inset ring-focus' : ''}"
      role="tree"
      tabindex="0"
      data-node-path={rootPath}
      onkeydown={handleTreeKeyDown}
      oncontextmenu={(e) => showContextMenu(e)}
      onpointerup={handleRootAreaPointerUp}
      onclick={handleBackgroundClick}
      onpointermove={handleTreePointerMove}
      onpointerleave={handleTreePointerLeave}
    >
      <VirtualList items={flatList} itemHeight={26} overscan={3} class="flex-1">
      {#snippet item({ item: node }: { item: FlatTreeNode; index: number })}
        {#if node.is_creating && node.creating_type}
          <div
            class="flex items-center gap-1.5 pr-2 py-1 w-full text-primary border border-transparent"
            style="padding-left: {node.depth * 12 + 8}px; height: 26px;"
          >
            <span class="w-3.5 shrink-0 inline-block"></span>
            <span class="shrink-0 text-accent">
              {#if node.creating_type === 'folder'}
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>
              {:else}
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
              {/if}
            </span>
            <input
              class="create-input flex-1 border outline-none text-xs px-1 py-0 rounded-sm bg-canvas border-focus text-primary h-[20px]"
              type="text"
              placeholder={node.creating_type === 'folder' ? 'folder name' : 'file name'}
              bind:value={creatingValue}
              oninput={(e) => {
                creatingValue = e.currentTarget.value;
                creatingError = validateCreateValue(creatingValue, creatingIn!) ?? '';
              }}
              onkeydown={(e) => {
                if (e.key === 'Enter')  { e.preventDefault(); commitCreate(); }
                if (e.key === 'Escape') { e.preventDefault(); cancelCreate(); }
              }}
              onblur={cancelCreate}
            />
            {#if creatingError}
              <div class="text-xs text-status-error ml-1">{creatingError}</div>
            {/if}
          </div>
        {:else if renamingPath === node.path}
          <div
            class="flex items-center gap-1.5 px-2 py-1 w-full text-primary"
            style="padding-left: {node.depth * 12 + 8}px; height: 26px;"
          >
            <span class="w-3.5 shrink-0 inline-block"></span>
            <span class="shrink-0 text-accent">
              {#if node.is_dir}
                <Folder size={14} />
              {:else}
                <File size={14} />
              {/if}
            </span>
            <input
              class="rename-input flex-1 border outline-none text-xs px-1 py-0.5 rounded-sm bg-canvas border-focus text-primary"
              type="text"
              bind:value={renameValue}
              oninput={(e) => handleRenameInput(e.currentTarget.value)}
              onkeydown={handleRenameKeyDown}
              onblur={commitRename}
              spellcheck="false"
            />
            {#if renameError}
              <div class="text-xs text-status-error ml-1">{renameError}</div>
            {/if}
          </div>
        {:else}
          <TreeNode 
            {node}
            isSelected={selectedPaths.has(node.path)}
            isActive={activePath === node.path}
            isFaded={isNodeFaded(node.path) || extraFadedPaths.has(node.path)}
            isDropTarget={drag.dropTargetPath === node.path && drag.dropTargetValid}
            isDropInvalid={drag.dropTargetPath === node.path && !drag.dropTargetValid}
            isCreatingChild={creatingIn === node.path}
            isLoading={loadingPaths.has(node.path)}
            onFileClick={handleNodeClick}
            onContextMenu={(e) => showContextMenu(e, node)}
            onPointerDown={handleNodePointerDown}
            onPointerMove={handleNodePointerMove}
            onPointerUp={(e) => handleNodePointerUp(e, node)}
          />
        {/if}
      {/snippet}
      </VirtualList>
    </div>
  </Tooltip>
{/if}

{#if drag.active}
  <div
    id="drag-ghost"
    bind:this={ghostEl}
    style="
      position: fixed;
      left: -9999px;
      top: -9999px;
      pointer-events: none;
      z-index: 9999;
    "
  >
    <div class="ghost-inner">
      {#if drag.paths.length === 1}
        {#if isDir(drag.paths[0], flatListMap)}
          <Folder size={14} />
        {:else}
          <File size={14} />
        {/if}
        <span>{getFileName(drag.paths[0])}</span>
      {:else}
        <Folder size={14} />
        <span class="ghost-count">{drag.paths.length}</span>
        <span>items</span>
      {/if}

      {#if drag.dropTargetPath !== null}
        {#if drag.dropTargetValid}
          <ArrowRight size={12} class="ghost-indicator valid" />
        {:else}
          <Ban size={12} class="ghost-indicator invalid" />
        {/if}
      {/if}
    </div>
  </div>
{/if}

<svelte:body class:is-dragging={drag.active} />
<svelte:window 
  onclickcapture={(e) => { 
    if (ctxMenu.isOpen && !(e.target as Element)?.closest('[data-notron-context-menu]')) {
      ctxMenu.isOpen = false; 
    }
  }} 
  oncontextmenucapture={(e) => { 
    if (ctxMenu.isOpen && !(e.target as Element)?.closest('[data-notron-context-menu]')) {
      ctxMenu.isOpen = false; 
    }
  }}
  onkeydown={(e) => { if (e.key === 'Escape' && ctxMenu.isOpen) ctxMenu.isOpen = false; }} 
/>

{#if ctxMenu.isOpen}
  <div
    data-notron-context-menu="true"
    class="fixed min-w-[180px] rounded-md border p-1 shadow-md z-[100] animate-in fade-in duration-100 bg-surface-2 border-subtle text-primary"
    style="left: {ctxMenu.x}px; top: {ctxMenu.y}px;"
    role="presentation"
    onclick={(e) => e.stopPropagation()}
    oncontextmenu={(e) => e.stopPropagation()}
  >
    {#each ctxMenu.items as item}
      {#if item.separator}
        <div class="h-px my-1 bg-subtle"></div>
      {:else}
        <button
          class="flex items-center justify-between w-full px-2 py-1.5 text-xs rounded-sm cursor-pointer select-none outline-none transition-colors {!item.disabled ? 'hover:bg-selected focus:bg-selected hover:text-primary focus:text-primary text-secondary' : 'text-muted cursor-not-allowed'} {item.danger ? 'text-status-error hover:bg-status-error/10 hover:text-status-error' : ''}"
          disabled={item.disabled}
          onclick={(e) => { e.stopPropagation(); handleCtxItemAction(item); }}
        >
          <span>{item.label}</span>
          {#if item.shortcut}
            <span class="ml-auto text-[10px] text-muted opacity-80">{item.shortcut}</span>
          {/if}
        </button>
      {/if}
    {/each}
  </div>
{/if}

{#if deleteConfirmState.isOpen}
  <Modal
    isOpen={true}
    title="Confirm Delete"
    onClose={cancelDeleteConfirm}
    widthClass="max-w-sm"
  >
    <div class="p-6">
      <p class="text-sm opacity-80 mb-4 break-words">
        Are you sure you want to delete <span class="font-semibold text-primary">
          {deleteConfirmState.targets.length === 1 ? getFileName(deleteConfirmState.targets[0]) : `${deleteConfirmState.targets.length} items`}
        </span>?
      </p>
      {#if deleteConfirmState.requireTyping}
        <p class="text-xs text-status-error mb-2">Type "{deleteConfirmState.requireTyping}" to confirm:</p>
      {/if}
    </div>
    {#snippet footer()}
      <div class="flex justify-end gap-3 w-full">
        <button onclick={cancelDeleteConfirm} class="px-4 py-2 text-sm rounded bg-surface-2 hover:bg-hover transition-colors text-primary border border-subtle">
          Cancel
        </button>
        <button onclick={() => confirmDelete()} class="px-4 py-2 text-sm rounded bg-status-error hover:bg-status-error/80 transition-colors text-white border border-transparent">
          Yes, Delete it
        </button>
      </div>
    {/snippet}
  </Modal>
{/if}

<Modal
  isOpen={largeFolderModal.isOpen}
  title="Large Folder Warning"
  onClose={handleLargeFolderCancel}
>
  <div class="p-4 text-sm text-primary">
    {largeFolderModal.message}
  </div>
  {#snippet footer()}
    <div class="flex justify-end gap-2">
      <button class="px-4 py-1.5 rounded bg-surface-3 hover:bg-surface-4 text-primary text-sm transition-colors" onclick={handleLargeFolderCancel}>Cancel</button>
      <button class="px-4 py-1.5 rounded bg-orange-600 hover:bg-orange-500 text-white text-sm transition-colors" onclick={handleLargeFolderProceed}>Proceed</button>
    </div>
  {/snippet}
</Modal>

<style>
  .ghost-inner {
    display: flex;
    align-items: center;
    gap: 6px;
    background: var(--color-bg-elevated, #2a2a2a);
    color: var(--color-text, #fff);
    border: 1px solid var(--color-border, #444);
    border-radius: 6px;
    padding: 4px 10px;
    font-size: 12px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.3);
    white-space: nowrap;
    opacity: 0.95;
  }
  .ghost-count {
    background: var(--color-accent);
    color: white;
    border-radius: 10px;
    padding: 1px 7px;
    font-weight: 600;
    font-size: 11px;
  }
</style>