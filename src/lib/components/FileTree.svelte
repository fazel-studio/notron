<script lang="ts">
  /**
   * FileTree.svelte — Optimized File Explorer
   *
   * Performance optimizations:
   *  - Tree Flattening (flattenTree utility)
   *  - UI Virtualization (VirtualList component)
   *  - Node Cache — never cleared on collapse
   *  - Optimistic UI on Expand
   *  - Async read_directory (tokio::fs on Rust side)
   *  - FS Watcher cache invalidation (via 'fs-change' event)
   *  - Batch directory restore (single IPC for N folders)
   *  - Set-based expandedPaths (O(1) lookups)
   */

  import { invoke } from '@tauri-apps/api/core';
  import { listen } from '@tauri-apps/api/event';
  import { derived } from 'svelte/store';
  import { onMount } from 'svelte';
  import { editorStore } from '../stores/editor';
  import { uiStore } from '../stores/ui';
    import { settingsStore } from '../stores/settings';
  import Tooltip from './Tooltip.svelte';
  import type { MenuItem } from './ContextMenu.svelte';
  import Modal from './Modal.svelte';
  import CreationInput from './CreationInput.svelte';
  import RenameInput from './RenameInput.svelte';
  import VirtualList from './VirtualList.svelte';
  import { flattenTree, sortNodes, type RawFileNode, type FlatTreeNode } from '../utils/treeFlattener';
  import { getMaterialFileIcon, getMaterialFolderIcon } from '../utils/iconMap';
  import {
    Folder, FolderOpen, ChevronRight, ChevronDown,
    File, FileCode, FileJson, FileText, Image, Settings, Globe, Hash, Loader2
  } from 'lucide-svelte';

  interface FileOpenMeta {
    content: number[];
    size: number;
    is_large: boolean;
  }

  interface DirBatchEntry {
    path: string;
    children: RawFileNode[];
  }

  interface Props { rootPath: string }
  let { rootPath }: Props = $props();

  // Icon map for file extensions (lucide-svelte icons)
  const ICON_MAP: Record<string, any> = {
    ts: FileCode, tsx: FileCode, js: FileCode, jsx: FileCode,
    rs: FileCode, py: FileCode, go: FileCode,
    html: Globe, css: Hash, json: FileJson,
    md: FileText, svg: Image, png: Image, jpg: Image, jpeg: Image, webp: Image, gif: Image,
    toml: Settings, yaml: Settings, yml: Settings,
  };

  function getFileIcon(name: string) {
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    return ICON_MAP[ext] ?? File;
  }

  // Fine-grained derived stores to prevent over-firing
  const refreshCounterStore = derived(uiStore, $s => $s.explorerRefreshCounter);
  const showDotFilesStore   = derived(uiStore, $s => $s.showDotFiles);
  const explorerRootStore   = derived(uiStore, $s => $s.explorerRoot);
  
  const ui = uiStore;
  // expandedPaths is now a separate Set-based store
  const expandedPathsStore = uiStore.expandedPaths;

  
  // State
  let rootChildren   = $state<RawFileNode[]>([]);
  let errorMsg       = $state<string | null>(null);
  let isInitialLoading = $state(false);

  // Centralized context menu state
  let ctxMenu = $state<{ isOpen: boolean; x: number; y: number; items: MenuItem[] }>({
    isOpen: false, x: 0, y: 0, items: []
  });

  /**
   * Node Cache: Map<path → children>. NEVER cleared on collapse.
   * Only invalidated by FS Watcher events.
   */
  const _nodeCache = new Map<string, RawFileNode[]>();
  let nodeCacheVersion = $state(0);

  /** Paths currently being loaded (show spinner) */
  let loadingPaths = $state(new Set<string>());

  function getParentPath(path: string) {
    const normalized = path.replace(/\\/g, '/');
    const parts = normalized.split('/');
    parts.pop();
    return parts.join('/') || path;
  }

  /**
   * PERF: Batch restore expanded children using single IPC call.
   * Previously this was N sequential invoke('read_directory') calls.
   * Now uses invoke('read_directory_batch') — 1 round-trip for all.
   */
  async function restoreExpandedChildren() {
    const expanded = uiStore.getExpandedPathsSnapshot();
    if (!expanded.length) return;

    const ordered = [...expanded].sort((a, b) => a.split(/\\|\//).length - b.split(/\\|\//).length);
    const toLoad = ordered.filter(expPath => {
      if (_nodeCache.has(expPath) || expPath === rootPath) return false;
      const parentPath = getParentPath(expPath);
      if (parentPath !== rootPath && !_nodeCache.has(parentPath)) return false;
      return true;
    });

    if (toLoad.length === 0) return;

    loadingPaths = new Set([...loadingPaths, ...toLoad]);

    try {
      const showDot = uiStore.getSnapshot().showDotFiles;
      
      // Single IPC call for all directories
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
      // Fallback: try individual loads
      const showDot = uiStore.getSnapshot().showDotFiles;
      for (const expPath of toLoad) {
        try {
          const fullNode = await invoke<RawFileNode>('read_directory', { path: expPath, showDotFiles: showDot });
          _nodeCache.set(expPath, sortNodes(fullNode.children ?? []));
        } catch { /* skip */ }
      }
      nodeCacheVersion++;
    } finally {
      const next = new Set(loadingPaths);
      for (const p of toLoad) next.delete(p);
      loadingPaths = next;
    }
  }

  // Derived flat list — uses Set directly (O(1) lookups)
  let creatingItem = $derived($ui.creatingItem);
  // PERF: expandedPaths is now Set<string> from separate store
  let expandedSet = $derived($expandedPathsStore);

  let flatList = $derived.by(() => {
    void nodeCacheVersion; // track cache version
    let list = flattenTree(sortNodes(rootChildren), expandedSet, _nodeCache, 0, creatingItem, loadingPaths);
    if (creatingItem && creatingItem.parentPath === rootPath) {
        if (creatingItem.type === 'folder') {
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

  // Load root — ONLY triggered by refreshCounter, showDotFiles, rootPath.
  // NOT triggered by expandedPaths/selectedPath changes.
  $effect(() => {
    $refreshCounterStore;
    $showDotFilesStore;
    const rp = $explorerRootStore;
    
    if (!rp) return;
    loadRoot(rp);
  });

  async function loadRoot(path: string) {
    if (rootChildren.length === 0) {
      isInitialLoading = true;
    }
    errorMsg = null;

    try {
      const showDotFiles = uiStore.getSnapshot().showDotFiles;
      const node = await invoke<RawFileNode>('read_directory', { path, showDotFiles });
      rootChildren = sortNodes(node.children ?? []);
      _nodeCache.set(path, rootChildren);
      nodeCacheVersion++;
    } catch (err) {
      errorMsg = String(err);
      setTimeout(() => uiStore.setExplorerRoot(null), 2000);
    } finally {
      isInitialLoading = false;
      restoreExpandedChildren().catch(console.error);
    }
  }

  onMount(() => {
    const handleCreateFile = () => {
      setTimeout(() => {
        const targetPath = resolveCreationPath();
        uiStore.setCreatingItem({ type: 'file', parentPath: targetPath });
        uiStore.toggleExpandedPath(targetPath, true);
      }, 10);
    };
    
    const handleCreateFolder = () => {
      setTimeout(() => {
        const targetPath = resolveCreationPath();
        uiStore.setCreatingItem({ type: 'folder', parentPath: targetPath });
        uiStore.toggleExpandedPath(targetPath, true);
      }, 10);
    };

    document.addEventListener('notron-create-file', handleCreateFile);
    document.addEventListener('notron-create-folder', handleCreateFolder);

    return () => {
      document.removeEventListener('notron-create-file', handleCreateFile);
      document.removeEventListener('notron-create-folder', handleCreateFolder);
    };
  });

  // Optimistic expand + Cache
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

    uiStore.toggleExpandedPath(node.path, true);
    loadingPaths = new Set(loadingPaths).add(node.path);

    invoke<RawFileNode>('read_directory', {
      path: node.path,
      showDotFiles: uiStore.getSnapshot().showDotFiles,
    }).then((fullNode) => {
      const children = sortNodes(fullNode.children ?? []);
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

  // FS Watcher cache invalidation
  $effect(() => {
    if (!rootPath) return;
    const unlisten = listen<{ path: string; parent_path: string; kind: string }>(
      'fs-change',
      async (event) => {
        const { path, parent_path } = event.payload;
        _nodeCache.delete(path);
        _nodeCache.delete(parent_path);
        nodeCacheVersion++;

        const expandedSnap = uiStore.getExpandedPathsSetSnapshot();
        const snap = uiStore.getSnapshot();
        if (expandedSnap.has(parent_path)) {
          try {
            const fullNode = await invoke<RawFileNode>('read_directory', {
              path: parent_path, showDotFiles: snap.showDotFiles,
            });
            _nodeCache.set(parent_path, sortNodes(fullNode.children ?? []));
            nodeCacheVersion++;
          } catch {}
        }
        if (parent_path === rootPath || path === rootPath) {
          try {
            const node = await invoke<RawFileNode>('read_directory', {
              path: rootPath, showDotFiles: snap.showDotFiles,
            });
            rootChildren = sortNodes(node.children ?? []);
            _nodeCache.set(rootPath, rootChildren);
            nodeCacheVersion++;
          } catch {}
        }
      }
    );
    return () => { unlisten.then(fn => fn()); };
  });

  // File click — uses read_file_text for text files (no binary overhead)
  async function handleFileClick(node: FlatTreeNode) {
    uiStore.setSelectedExplorerPath(node.path);
    if (node.is_dir) {
      handleExpand(node);
      return;
    }
    const isImg = /\.(png|jpe?g|gif|webp|svg|ico)$/i.test(node.name);
    if (isImg) {
      editorStore.addTab({ id: node.path, path: node.path, name: node.name, content: '', language: 'image', isPreview: true });
      return;
    }
    editorStore.addTab({ id: node.path, path: node.path, name: node.name, content: null, language: 'plaintext', isPreview: true, isLoading: true });
    try {
      // PERF: Use read_file_text — returns String directly, no JSON array overhead
      const content = await invoke<string>('read_file_text', { path: node.path });
      editorStore.setInitialContent(node.path, content);
    } catch (err) {
      const errStr = String(err);
      if (errStr === '__BINARY__') {
        editorStore.setTabUnsupported(node.path, true);
        editorStore.setInitialContent(node.path, '');
      } else {
        // Try open_file_with_meta as fallback for large files
        try {
          const meta = await invoke<FileOpenMeta>('open_file_with_meta', { path: node.path });
          if (meta.is_large) {
            editorStore.closeTab(node.path);
            if (!confirm(`"${node.name}" is large (>1MB). Open anyway? Syntax highlighting will be disabled.`)) return;
            editorStore.addTab({ id: node.path, path: node.path, name: node.name, content: '', language: 'plaintext', isPreview: true, isLargeFile: true });
            return;
          }
          const content = new TextDecoder('utf-8').decode(new Uint8Array(meta.content)).replace(/\r\n/g, '\n');
          editorStore.setInitialContent(node.path, content);
        } catch (fallbackErr) {
          console.error('Failed to open file:', node.path, fallbackErr);
          editorStore.setTabLoading(node.path, false);
        }
      }
    }
  }

  // Context menu helpers
  async function handlePaste(targetPath: string, isDir: boolean) {
    const clip = uiStore.getSnapshot().clipboard;
    if (!clip) return;
    const sep = targetPath.includes('\\') ? '\\' : '/';
    const fileName = clip.path.split(sep).pop();
    const actualTarget = isDir
      ? `${targetPath}${sep}${fileName}`
      : (() => { const p = targetPath.split(sep); p.pop(); return [...p, fileName].join(sep); })();
    try {
      await uiStore.withStatus(`Copying ${fileName}...`, invoke('copy_item', { srcPath: clip.path, dstPath: actualTarget }), 500);
      if (clip.type === 'cut') {
        await uiStore.withStatus(`Moving ${fileName}...`, invoke('delete_item', { path: clip.path }), 500);
        uiStore.setClipboard(null);
        invalidateCacheForPath(clip.path);
      }
      invalidateCacheForPath(actualTarget);
      const parentDir = targetPath.split(/[/\\]/).slice(0, -1).join('/') || targetPath;
      invalidateCacheForPath(parentDir);
      nodeCacheVersion++;
      uiStore.triggerExplorerRefresh();
    } catch (err) { alert(err); }
  }

  let nodeToDelete: FlatTreeNode | null = $state(null);
  let skipDeleteConfirm = $state(false);

  async function requestDeleteNode(node: FlatTreeNode) {
    const explorerRoot = $ui.explorerRoot;
    if (!explorerRoot) return;
    const skipSetting = localStorage.getItem(`delete_confirm_skip_${explorerRoot}`);
    if (skipSetting === 'true') {
      await executeDelete(node);
    } else {
      nodeToDelete = node;
      skipDeleteConfirm = false;
    }
  }

  async function confirmDelete() {
    if (!nodeToDelete) return;
    const explorerRoot = $ui.explorerRoot;
    if (skipDeleteConfirm && explorerRoot) {
      localStorage.setItem(`delete_confirm_skip_${explorerRoot}`, 'true');
    }
    const node = nodeToDelete;
    nodeToDelete = null;
    await executeDelete(node);
  }

  function cancelDelete() {
    nodeToDelete = null;
  }

  async function executeDelete(node: FlatTreeNode) {
    try {
      await uiStore.withStatus(`Deleting ${node.name}...`, invoke('delete_item', { path: node.path }), 500);
      editorStore.closeTab(node.path);
      const sep = node.path.includes('\\') ? '\\' : '/';
      const parts = node.path.split(sep); parts.pop();
      const parent = parts.join(sep);
      
      const children = _nodeCache.get(parent);
      if (children) {
        _nodeCache.set(parent, children.filter(c => c.path !== node.path));
        nodeCacheVersion++;
      }
      _nodeCache.delete(node.path);
      uiStore.triggerExplorerRefresh();
    } catch (err) { alert(err); }
  }

  function invalidateCacheForPath(path: string) {
    const normalized = path.replace(/\\/g, '/');
    for (const key of _nodeCache.keys()) {
      const normalizedKey = key.replace(/\\/g, '/');
      if (normalizedKey === normalized || normalizedKey.startsWith(normalized + '/')) {
        _nodeCache.delete(key);
      }
    }
  }

  function handleCopyPath(path: string) { navigator.clipboard.writeText(path); }

  // Per-node context menu
  function getNodeMenuItems(node: FlatTreeNode): MenuItem[] {
    const clip = $ui.clipboard;
    if (node.is_dir) {
      return [
        { id: 'new-file',   label: 'New File',   action: () => { uiStore.setCreatingItem({ type: 'file',   parentPath: node.path }); uiStore.toggleExpandedPath(node.path, true); } },
        { id: 'new-folder', label: 'New Folder', action: () => { uiStore.setCreatingItem({ type: 'folder', parentPath: node.path }); uiStore.toggleExpandedPath(node.path, true); } },
        { id: 'sep-1',      label: '',           action: () => {}, separator: true },
        { id: 'cut',        label: 'Cut',        action: () => uiStore.setClipboard({ path: node.path, type: 'cut' }) },
        { id: 'copy',       label: 'Copy',       action: () => uiStore.setClipboard({ path: node.path, type: 'copy' }) },
        { id: 'paste',      label: 'Paste',      action: () => handlePaste(node.path, true), disabled: !clip },
        { id: 'sep-2',      label: '',           action: () => {}, separator: true },
        { id: 'copy-path',  label: 'Copy Path',  action: () => handleCopyPath(node.path) },
        { id: 'sep-3',      label: '',           action: () => {}, separator: true },
        { id: 'rename',     label: 'Rename',     action: () => uiStore.setRenamingItem(node.path) },
        { id: 'delete',     label: 'Delete',     action: () => requestDeleteNode(node) },
        { id: 'sep-4',      label: '',           action: () => {}, separator: true },
      ];
    } else {
      return [
        { id: 'cut',       label: 'Cut',       action: () => uiStore.setClipboard({ path: node.path, type: 'cut' }) },
        { id: 'copy',      label: 'Copy',      action: () => uiStore.setClipboard({ path: node.path, type: 'copy' }) },
        { id: 'sep-1',     label: '',          action: () => {}, separator: true },
        { id: 'copy-path', label: 'Copy Path', action: () => handleCopyPath(node.path) },
        { id: 'sep-2',     label: '',          action: () => {}, separator: true },
        { id: 'rename',    label: 'Rename',    action: () => uiStore.setRenamingItem(node.path) },
        { id: 'delete',    label: 'Delete',    action: () => requestDeleteNode(node) },
        { id: 'sep-5',     label: '',          action: () => {}, separator: true },
      ];
    }
  }

  function resolveCreationPath(): string {
    const selected = uiStore.getSnapshot().selectedExplorerPath;
    if (!selected || selected === rootPath) return rootPath;
    
    const node = flatList.find(n => n.path === selected);
    if (node) {
      if (node.is_dir) return selected;
      return getParentPath(selected);
    }
    return getParentPath(selected);
  }

  // Root area context menu
  function getRootMenuItems(): MenuItem[] {
    const clip = uiStore.getSnapshot().clipboard;
    const targetPath = resolveCreationPath();
    return [
      { id: 'new-file',   label: 'New File',   action: () => { uiStore.setCreatingItem({ type: 'file',   parentPath: targetPath }); uiStore.toggleExpandedPath(targetPath, true); } },
      { id: 'new-folder', label: 'New Folder', action: () => { uiStore.setCreatingItem({ type: 'folder', parentPath: targetPath }); uiStore.toggleExpandedPath(targetPath, true); } },
      { id: 'sep-1',      label: '',           action: () => {}, separator: true },
      { id: 'paste',      label: 'Paste',      action: () => handlePaste(rootPath, true), disabled: !clip },
      { id: 'sep-2',      label: '',           action: () => {}, separator: true },
      { id: 'copy-path',  label: 'Copy Path',  action: () => handleCopyPath(rootPath) },
    ];
  }

  function getBoundedPos(x: number, y: number) {
    // Basic bounds checking for menu
    const menuWidth = 160;
    const menuHeight = 250; // estimate max height
    const finalX = x + menuWidth > window.innerWidth ? window.innerWidth - menuWidth - 5 : x;
    const finalY = y + menuHeight > window.innerHeight ? window.innerHeight - menuHeight - 5 : y;
    return { x: finalX, y: finalY };
  }

  function handleNodeContextMenu(e: MouseEvent, node: FlatTreeNode) {
    e.preventDefault();
    e.stopPropagation();
    uiStore.setSelectedExplorerPath(node.path);
    const pos = getBoundedPos(e.clientX, e.clientY);
    setTimeout(() => {
      ctxMenu = { isOpen: true, x: pos.x, y: pos.y, items: getNodeMenuItems(node) };
    }, 0);
  }

  function handleRootContextMenu(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const pos = getBoundedPos(e.clientX, e.clientY);
    setTimeout(() => {
      ctxMenu = { isOpen: true, x: pos.x, y: pos.y, items: getRootMenuItems() };
    }, 0);
  }

  function handleCtxItemAction(item: MenuItem) {
    if (!item.disabled) item.action();
    ctxMenu.isOpen = false;
  }

  // Keyboard navigation
  function handleKeydown(e: KeyboardEvent) {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    const path = uiStore.getSnapshot().selectedExplorerPath;
    if (!path) return;
    if (e.key === 'F2') { uiStore.setRenamingItem(path); }
    else if (e.key === 'Delete') {
      const node = flatList.find(n => n.path === path);
      if (node) requestDeleteNode(node);
    }
    else if (e.ctrlKey && e.key.toLowerCase() === 'c') { uiStore.setClipboard({ path, type: 'copy' }); }
    else if (e.ctrlKey && e.key.toLowerCase() === 'x') { uiStore.setClipboard({ path, type: 'cut' }); }
    else if (e.ctrlKey && e.key.toLowerCase() === 'v') { handlePaste(path, false); }
  }
</script>

{#if errorMsg}
  <div class="p-4 text-xs text-red-500">Failed to load: {errorMsg}.<br/><br/>Resetting workspace...</div>

{:else if isInitialLoading}
  <!-- Loading skeleton — only shown on true initial load, not on expand/click -->
  <div class="flex flex-col gap-1.5 p-2 pt-1">
    {#each [75, 55, 88, 45, 68, 38, 82, 50] as w}
      <div
        class="h-3.5 rounded animate-pulse bg-hover"
        style="width: {w}%"
      ></div>
    {/each}
  </div>

{:else if rootChildren.length === 0}
  <div 
    class="p-4 text-xs text-muted flex-1 h-full outline-none transition-all {$ui.selectedExplorerPath === rootPath ? 'bg-surface-2 ring-1 ring-inset ring-focus' : ''}"
    role="presentation"
    onclick={() => uiStore.setSelectedExplorerPath(rootPath)}
    oncontextmenu={handleRootContextMenu}
  >
    Empty folder.
  </div>

{:else}
  <!-- Root-level context menu container (empty area right-click) -->
  <div
    class="flex-1 h-full outline-none flex flex-col p-2 transition-all {$ui.selectedExplorerPath === rootPath ? 'bg-surface-2 ring-1 ring-inset ring-focus' : ''}"
    role="tree"
    tabindex="0"
    onkeydown={handleKeydown}
    onclick={() => uiStore.setSelectedExplorerPath(rootPath)}
    oncontextmenu={handleRootContextMenu}
  >
    <VirtualList items={flatList} itemHeight={26} overscan={5} class="flex-1">
      {#snippet item({ item: node }: { item: FlatTreeNode; index: number })}
        {#if node.is_creating}
          <CreationInput type={node.creating_type!} parentPath={$ui.creatingItem!.parentPath} depth={node.depth} />
        {:else if $ui.renamingItem === node.path}
          <RenameInput initialName={node.name} {node} depth={node.depth} />
        {:else}
          <div
            role="treeitem"
            tabindex="0"
            aria-selected={$ui.selectedExplorerPath === node.path}
            class="flex items-center gap-1.5 cursor-pointer select-none w-full border text-xs transition-colors
              {$ui.selectedExplorerPath === node.path
                ? 'bg-selected border-focus text-primary'
                : 'border-transparent hover:bg-hover hover:text-primary'}"
            style="padding-left: {node.depth * 12 + 8}px; padding-right: 8px; height: 26px;"
            onclick={(e) => { e.stopPropagation(); handleFileClick(node); }}
            onkeydown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); handleFileClick(node); } }}
            oncontextmenu={(e) => handleNodeContextMenu(e, node)}
          >
            <span class="shrink-0 w-3.5 flex items-center justify-center text-muted">
              {#if node.is_dir}
                {#if loadingPaths.has(node.path)}
                  <Loader2 size={12} class="animate-spin" />
                {:else if node.has_children}
                  {#if node.isExpanded}
                    <ChevronDown size={12} />
                  {:else}
                    <ChevronRight size={12} />
                  {/if}
                {/if}
              {/if}
            </span>

            {#if node.is_dir}
              <span class="shrink-0 flex items-center text-accent">
                {#if $settingsStore.icon_theme === 'advance'}
                  <img src="/icons/material/{getMaterialFolderIcon(node.name)}.svg" class="w-4 h-4 object-contain" alt="" />
                {:else if $settingsStore.icon_theme === 'default' || !$settingsStore.icon_theme}
                  {#if node.isExpanded}
                    <FolderOpen size={14} />
                  {:else}
                    <Folder size={14} />
                  {/if}
                {/if}
              </span>
            {:else}
              <span
                class="shrink-0 flex items-center"
                class:text-icon-active={$ui.selectedExplorerPath === node.path}
                class:text-icon-default={$ui.selectedExplorerPath !== node.path}
              >
                {#if $settingsStore.icon_theme === 'advance'}
                  <img src="/icons/material/{getMaterialFileIcon(node.name)}.svg" class="w-4 h-4 object-contain" alt="" />
                {:else if $settingsStore.icon_theme === 'default' || !$settingsStore.icon_theme}
                  {@const Icon = getFileIcon(node.name)}
                  <Icon size={14} />
                {/if}
              </span>
            {/if}

            <Tooltip content={node.path} side="right" wrapperClass="flex-1 min-w-0 flex items-center">
              <span
                class="truncate min-w-0 flex-1"
                class:text-primary={$ui.selectedExplorerPath === node.path}
                class:text-secondary={$ui.selectedExplorerPath !== node.path}
              >
                {node.name}
              </span>
            </Tooltip>
          </div>
        {/if}
      {/snippet}
    </VirtualList>
  </div>
{/if}

<!-- Centralized Context Menu UI -->
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
    class="fixed min-w-[160px] rounded-md border p-1 shadow-md z-[100] animate-in fade-in duration-100 bg-surface-2 border-subtle text-primary"
    style="left: {ctxMenu.x}px; top: {ctxMenu.y}px;"
    role="presentation"
    onclick={(e) => e.stopPropagation()}
    oncontextmenu={(e) => e.stopPropagation()}
  >
    {#each ctxMenu.items as item (item.id)}
      {#if item.separator}
        <div class="h-px my-1 bg-subtle"></div>
      {:else}
        <button
          class="flex items-center justify-between w-full px-2 py-1.5 text-xs rounded-sm cursor-pointer select-none outline-none transition-colors {!item.disabled ? 'hover:bg-selected focus:bg-selected hover:text-primary focus:text-primary text-secondary' : 'text-muted'}"
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

{#if nodeToDelete}
  <Modal
    isOpen={true}
    title="Confirm Delete"
    onClose={cancelDelete}
    widthClass="max-w-sm"
  >
    <div class="p-6">
      <p class="text-sm opacity-80 mb-4 break-words">
        Are you sure you want to delete <span class="font-semibold text-primary">{nodeToDelete.name}</span>?
      </p>
      
      <label class="flex items-center gap-2 mb-2 cursor-pointer select-none">
        <input type="checkbox" bind:checked={skipDeleteConfirm} class="w-4 h-4 rounded border-subtle bg-surface-2 text-accent focus:ring-accent focus:ring-opacity-50 transition-shadow">
        <span class="text-xs opacity-70">Don't show again in this workspace</span>
      </label>
    </div>
    
    {#snippet footer()}
      <div class="flex justify-end gap-3 w-full">
        <button onclick={cancelDelete} class="px-4 py-2 text-sm rounded bg-surface-2 hover:bg-hover transition-colors text-primary border border-subtle">
          Cancel
        </button>
        <button onclick={confirmDelete} class="px-4 py-2 text-sm rounded bg-status-error hover:bg-status-error/80 transition-colors text-white border border-transparent">
          Yes, Delete it
        </button>
      </div>
    {/snippet}
  </Modal>
{/if}