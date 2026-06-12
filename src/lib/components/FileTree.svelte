<script lang="ts">
  /**
   * FileTree.svelte — Optimized File Explorer
   *
   * Implements Section 3 optimizations WITHOUT flickering:
   *  3.1 Tree Flattening (flattenTree utility)
   *  3.2 UI Virtualization (VirtualList component)
   *  3.3 Node Cache — never cleared on collapse
   *  3.4 Optimistic UI on Expand
   *  3.5 Async read_directory (tokio::fs on Rust side)
   *  3.6 FS Watcher cache invalidation (via 'fs-change' event)
   *
   * FLICKERING FIX: Use dedicated derived() stores so the loadRoot
   * $effect only tracks explorerRefreshCounter and showDotFiles,
   * NOT every change to $ui (expandedPaths, selectedPath, etc.).
   */

  import { invoke } from '@tauri-apps/api/core';
  import { listen } from '@tauri-apps/api/event';
  import { derived } from 'svelte/store';
  import { editorStore } from '../stores/editor';
  import { uiStore } from '../stores/ui';
    import { settingsStore } from '../stores/settings';
  import type { MenuItem } from './ContextMenu.svelte';
  import Tooltip from './Tooltip.svelte';
  import CreationInput from './CreationInput.svelte';
  import RenameInput from './RenameInput.svelte';
  import VirtualList from './VirtualList.svelte';
  import { flattenTree, sortNodes, type RawFileNode, type FlatTreeNode } from '../utils/treeFlattener';
  import { getMaterialFileIcon, getMaterialFolderIcon } from '../utils/iconMap';
  import {
    Folder, FolderOpen, ChevronRight, ChevronDown,
    File, FileCode, FileJson, FileText, Image, Settings, Globe, Hash, Loader2
  } from 'lucide-svelte';

  interface Props { rootPath: string }
  let { rootPath }: Props = $props();

  // ─────────────────────────────────────────────────────────
  // Icon map (from TreeNode.svelte — lucide-svelte)
  // ─────────────────────────────────────────────────────────
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

  // ─────────────────────────────────────────────────────────
  // FLICKERING FIX:
  // Extract ONLY the fields we want to trigger root reload from.
  // This means the loadRoot $effect below will ONLY re-run when
  // explorerRefreshCounter or showDotFiles changes — NOT when
  // expandedPaths, selectedExplorerPath, or other fields change.
  // ─────────────────────────────────────────────────────────
  // FLICKERING FIX: Fine-grained tracking
  // ─────────────────────────────────────────────────────────
  const refreshCounterStore = derived(uiStore, $s => $s.explorerRefreshCounter);
  const showDotFilesStore   = derived(uiStore, $s => $s.showDotFiles);
  const explorerRootStore   = derived(uiStore, $s => $s.explorerRoot); // track specifically
  
  const ui = uiStore;

  
  // ─────────────────────────────────────────────────────────
  // State
  // ─────────────────────────────────────────────────────────
  let rootChildren   = $state<RawFileNode[]>([]);
  let errorMsg       = $state<string | null>(null);
  let isInitialLoading = $state(false);

  // Centralized context menu state
  let ctxMenu = $state<{ isOpen: boolean; x: number; y: number; items: MenuItem[] }>({
    isOpen: false, x: 0, y: 0, items: []
  });

  /**
   * Section 3.3: Node Cache
   * Map<path → children>. NEVER cleared on collapse.
   * Only invalidated by FS Watcher events.
   */
  // Use a plain Map + a reactive version counter to avoid double-render.
  // The version counter is the single reactivity signal for flatList.
  const _nodeCache = new Map<string, RawFileNode[]>();
  let nodeCacheVersion = $state(0);

  /** Section 3.4: Paths currently being loaded (show spinner) */
  let loadingPaths = $state(new Set<string>());

  // ─────────────────────────────────────────────────────────
  // Derived flat list (Section 3.1 + 3.2)
  // ─────────────────────────────────────────────────────────
  let creatingItem = $derived($ui.creatingItem);
  let expandedSet = $derived(new Set($ui.expandedPaths));

  let flatList = $derived.by(() => {
    void nodeCacheVersion; // track cache version
    let list = flattenTree(sortNodes(rootChildren), expandedSet, _nodeCache, 0, creatingItem);
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

  // ─────────────────────────────────────────────────────────
  // Load root — ONLY triggered by refreshCounter, showDotFiles, rootPath.
  // NOT triggered by expandedPaths/selectedPath changes.
  // ─────────────────────────────────────────────────────────
  $effect(() => {
    const counter = $refreshCounterStore;
    const showDot = $showDotFilesStore;
    const rp = $explorerRootStore; // Use derived store instead of prop to guarantee no over-firing
    
    if (!rp) return;
    console.log('[FileTree] loadRoot triggered by effect', { counter, showDot, rp });
    // IMPORTANT: don't clear rootChildren here to avoid flickering on config change
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

      // Reload expanded paths to prevent them from becoming empty after a cache clear
      const expanded = uiStore.getSnapshot().expandedPaths;
      if (expanded.length > 0) {
        await Promise.all(expanded.map(async (expPath) => {
          try {
            const expNode = await invoke<RawFileNode>('read_directory', { path: expPath, showDotFiles });
            _nodeCache.set(expPath, sortNodes(expNode.children ?? []));
          } catch (e) {
            // Ignore errors for folders that might have been deleted
          }
        }));
      }

      nodeCacheVersion++;
    } catch (err) {
      errorMsg = String(err);
      setTimeout(() => uiStore.setExplorerRoot(null), 2000);
    } finally {
      isInitialLoading = false;
    }
  }

  // ─────────────────────────────────────────────────────────
  // Section 3.4: Optimistic expand + Section 3.3: Cache
  // ─────────────────────────────────────────────────────────
  async function handleExpand(node: FlatTreeNode) {
    if (!node.is_dir) return;

    if (expandedSet.has(node.path)) {
      // Collapse — keep cache, only remove from expandedSet
      uiStore.toggleExpandedPath(node.path, false);
      return;
    }

    // Cache hit → instant, no fetch needed
    if (_nodeCache.has(node.path)) {
      uiStore.toggleExpandedPath(node.path, true);
      return;
    }

    // Section 3.4: Optimistic — show expand arrow immediately
    uiStore.toggleExpandedPath(node.path, true);
    loadingPaths = new Set(loadingPaths).add(node.path);

    try {
      const fullNode = await invoke<RawFileNode>('read_directory', {
        path: node.path,
        showDotFiles: uiStore.getSnapshot().showDotFiles,
      });
      const children = sortNodes(fullNode.children ?? []);
      _nodeCache.set(node.path, children);
      nodeCacheVersion++; // single reactive trigger → flatList recomputes once
    } catch (err) {
      console.error('Failed to load directory', node.path, err);
      uiStore.toggleExpandedPath(node.path, false);
    } finally {
      const next = new Set(loadingPaths);
      next.delete(node.path);
      loadingPaths = next;
    }
  }

  // ─────────────────────────────────────────────────────────
  // Section 3.6: FS Watcher cache invalidation
  // ─────────────────────────────────────────────────────────
  $effect(() => {
    if (!rootPath) return;
    const unlisten = listen<{ path: string; parent_path: string; kind: string }>(
      'fs-change',
      async (event) => {
        const { path, parent_path } = event.payload;
        _nodeCache.delete(path);
        _nodeCache.delete(parent_path);
        nodeCacheVersion++;

        const snap = uiStore.getSnapshot();
        if (snap.expandedPaths.includes(parent_path)) {
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

  // ─────────────────────────────────────────────────────────
  // File click
  // ─────────────────────────────────────────────────────────
  async function handleFileClick(node: FlatTreeNode) {
    uiStore.setSelectedExplorerPath(node.path);
    if (node.is_dir) {
      await handleExpand(node);
      return;
    }
    const isImg = /\.(png|jpe?g|gif|webp|svg|ico)$/i.test(node.name);
    if (isImg) {
      editorStore.addTab({ id: node.path, path: node.path, name: node.name, content: '', language: 'image', isPreview: true });
      return;
    }
    const isLarge = await invoke<boolean>('is_large_file', { path: node.path });
    if (isLarge) {
      if (!confirm(`"${node.name}" is large (>1MB). Open anyway? Syntax highlighting will be disabled.`)) return;
      editorStore.addTab({ id: node.path, path: node.path, name: node.name, content: '', language: 'plaintext', isPreview: true, isLargeFile: true });
      return;
    }
    editorStore.addTab({ id: node.path, path: node.path, name: node.name, content: null, language: 'plaintext', isPreview: true });
  }

  // ─────────────────────────────────────────────────────────
  // Context menu helpers
  // ─────────────────────────────────────────────────────────
  async function handlePaste(targetPath: string, isDir: boolean) {
    const clip = uiStore.getSnapshot().clipboard;
    if (!clip) return;
    const sep = targetPath.includes('\\') ? '\\' : '/';
    const fileName = clip.path.split(sep).pop();
    const actualTarget = isDir
      ? `${targetPath}${sep}${fileName}`
      : (() => { const p = targetPath.split(sep); p.pop(); return [...p, fileName].join(sep); })();
    try {
      await invoke('copy_item', { srcPath: clip.path, dstPath: actualTarget });
      if (clip.type === 'cut') { await invoke('delete_item', { path: clip.path }); uiStore.setClipboard(null); }
      invalidateCacheAndRefreshRoot();
    } catch (err) { alert(err); }
  }

  async function handleDeleteNode(node: FlatTreeNode) {
    if (!confirm(`Delete "${node.name}"?`)) return;
    try {
      await invoke('delete_item', { path: node.path });
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
    } catch (err) { alert(err); }
  }

  function invalidateCacheAndRefreshRoot() {
    _nodeCache.clear();
    nodeCacheVersion++;
    uiStore.triggerExplorerRefresh();
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
        { id: 'delete',     label: 'Delete',     action: () => handleDeleteNode(node) },
      ];
    } else {
      return [
        { id: 'cut',       label: 'Cut',       action: () => uiStore.setClipboard({ path: node.path, type: 'cut' }) },
        { id: 'copy',      label: 'Copy',      action: () => uiStore.setClipboard({ path: node.path, type: 'copy' }) },
        { id: 'sep-1',     label: '',          action: () => {}, separator: true },
        { id: 'copy-path', label: 'Copy Path', action: () => handleCopyPath(node.path) },
        { id: 'sep-2',     label: '',          action: () => {}, separator: true },
        { id: 'rename',    label: 'Rename',    action: () => uiStore.setRenamingItem(node.path) },
        { id: 'delete',    label: 'Delete',    action: () => handleDeleteNode(node) },
      ];
    }
  }

  // Root area context menu
  let rootMenuItems = $derived<MenuItem[]>([
    { id: 'new-file',   label: 'New File',   action: () => uiStore.setCreatingItem({ type: 'file',   parentPath: rootPath }) },
    { id: 'new-folder', label: 'New Folder', action: () => uiStore.setCreatingItem({ type: 'folder', parentPath: rootPath }) },
    { id: 'sep-1',      label: '',           action: () => {}, separator: true },
    { id: 'paste',      label: 'Paste',      action: () => handlePaste(rootPath, true), disabled: !$ui.clipboard },
    { id: 'sep-2',      label: '',           action: () => {}, separator: true },
    { id: 'copy-path',  label: 'Copy Path',  action: () => handleCopyPath(rootPath) },
  ]);

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
    ctxMenu = { isOpen: true, x: pos.x, y: pos.y, items: getNodeMenuItems(node) };
  }

  function handleRootContextMenu(e: MouseEvent) {
    if (e.target !== e.currentTarget) {
      // Allow clicking directly on the root container, but don't override node clicks
      // if propagation wasn't stopped for some reason.
    }
    e.preventDefault();
    const pos = getBoundedPos(e.clientX, e.clientY);
    ctxMenu = { isOpen: true, x: pos.x, y: pos.y, items: rootMenuItems };
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
      if (node && confirm(`Delete "${node.name}"?`)) {
        invoke('delete_item', { path }).then(() => invalidateCacheAndRefreshRoot()).catch(err => alert(err));
      }
    } else if (e.ctrlKey && e.key.toLowerCase() === 'c') { uiStore.setClipboard({ path, type: 'copy' }); }
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
  <div class="p-4 text-xs text-muted">
    Empty folder.
  </div>

{:else}
  <!-- Root-level context menu container (empty area right-click) -->
  <div
    class="flex-1 h-full outline-none flex flex-col"
    role="tree"
    tabindex="0"
    onkeydown={handleKeydown}
    onclick={() => uiStore.setSelectedExplorerPath(null)}
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
  onclick={() => { if (ctxMenu.isOpen) ctxMenu.isOpen = false; }} 
  oncontextmenu={() => { if (ctxMenu.isOpen) ctxMenu.isOpen = false; }}
  onkeydown={(e) => { if (e.key === 'Escape' && ctxMenu.isOpen) ctxMenu.isOpen = false; }} 
/>
{#if ctxMenu.isOpen}
  <div
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