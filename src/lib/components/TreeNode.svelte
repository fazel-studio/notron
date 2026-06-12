<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { uiStore } from '../stores/ui';
    import { settingsStore } from '../stores/settings';
  import ContextMenu, { type MenuItem } from './ContextMenu.svelte';
  import CreationInput from './CreationInput.svelte';
  import RenameInput from './RenameInput.svelte';
  import TreeNode from './TreeNode.svelte';
  import { getMaterialFileIcon, getMaterialFolderIcon } from '../utils/iconMap';
  import { 
    Folder, FolderOpen, ChevronRight, ChevronDown, 
    File, FileCode, FileJson, FileText, Image, Settings, Globe, Hash, Loader2 
  } from 'lucide-svelte';

  const ICON_MAP: Record<string, any> = {
    ts: FileCode, tsx: FileCode, js: FileCode, jsx: FileCode,
    rs: FileCode, py: FileCode, go: FileCode,
    html: Globe, css: Hash, json: FileJson,
    md: FileText, svg: Image, png: Image, jpg: Image,
    toml: Settings, yaml: Settings, yml: Settings,
  };

  interface FileNode {
    name: string;
    path: string;
    is_dir: boolean;
    children?: FileNode[];
  }

  let { node, depth, onFileClick }: { node: FileNode; depth: number; onFileClick: (node: FileNode) => void } = $props();

  const ui = uiStore;

  let isExpanded = $derived($ui.expandedPaths.includes(node.path));
  let localChildren = $state<FileNode[] | null>(null);
  let children = $derived(localChildren ?? node.children ?? []);
  let isLoading = $state(false);


  async function toggleExpand() {
    if (!isExpanded) {
      const existing = localChildren ?? node.children;
      if (!existing || existing.length === 0) {
        isLoading = true;
        try {
          const fullNode = await invoke<FileNode>('read_directory', { path: node.path, showDotFiles: $ui.showDotFiles });
          localChildren = fullNode.children || [];
        } catch (err) { console.error(err); }
        finally { isLoading = false; }
      }
    }
    uiStore.toggleExpandedPath(node.path, !isExpanded);
  }

  let isCreatingInside = $derived($ui.creatingItem?.parentPath === node.path && node.is_dir);
  let isSelected = $derived($ui.selectedExplorerPath === node.path);
  let isRenaming = $derived($ui.renamingItem === node.path);

  $effect(() => {
    if (isCreatingInside && !isExpanded) uiStore.toggleExpandedPath(node.path, true);
  });


  function handleCopyPath() { navigator.clipboard.writeText(node.path); }

  async function handlePasteOnNode() {
    if (!$ui.clipboard) return;
    const sep = node.path.includes('\\') ? '\\' : '/';
    const fileName = $ui.clipboard.path.split(sep).pop();
    const targetPath = node.is_dir ? `${node.path}${sep}${fileName}` : ((p) => { const parts = p.split(sep); parts.pop(); return [...parts, fileName].join(sep); })(node.path);
    try {
      await invoke('copy_item', { srcPath: $ui.clipboard.path, dstPath: targetPath });
      if ($ui.clipboard.type === 'cut') { await invoke('delete_item', { path: $ui.clipboard.path }); uiStore.setClipboard(null); }
      uiStore.triggerExplorerRefresh();
    } catch (err) { alert(err); }
  }

  async function handleDeleteWithOptimistic() {
    if (!confirm(`Are you sure you want to delete ${node.name}?`)) return;
    uiStore.triggerExplorerRefresh();
    try {
      await invoke('delete_item', { path: node.path });
    } catch (err) {
      alert(err);
      uiStore.triggerExplorerRefresh();
    }
  }

  let menuItems = $derived<MenuItem[]>(node.is_dir ? [
    { id: 'new-file', label: 'New File', action: () => { uiStore.setCreatingItem({ type: 'file', parentPath: node.path }); uiStore.toggleExpandedPath(node.path, true); } },
    { id: 'new-folder', label: 'New Folder', action: () => { uiStore.setCreatingItem({ type: 'folder', parentPath: node.path }); uiStore.toggleExpandedPath(node.path, true); }, separator: true },
    { id: 'cut', label: 'Cut', action: () => uiStore.setClipboard({ path: node.path, type: 'cut' }) },
    { id: 'copy', label: 'Copy', action: () => uiStore.setClipboard({ path: node.path, type: 'copy' }) },
    { id: 'paste', label: 'Paste', action: handlePasteOnNode, disabled: !$ui.clipboard, separator: true },
    { id: 'copy-path', label: 'Copy Path', action: handleCopyPath, separator: true },
    { id: 'rename', label: 'Rename', action: () => uiStore.setRenamingItem(node.path) },
    { id: 'delete', label: 'Delete', action: handleDeleteWithOptimistic }
  ] : [
    { id: 'cut', label: 'Cut', action: () => uiStore.setClipboard({ path: node.path, type: 'cut' }) },
    { id: 'copy', label: 'Copy', action: () => uiStore.setClipboard({ path: node.path, type: 'copy' }), separator: true },
    { id: 'copy-path', label: 'Copy Path', action: handleCopyPath, separator: true },
    { id: 'rename', label: 'Rename', action: () => uiStore.setRenamingItem(node.path) },
    { id: 'delete', label: 'Delete', action: handleDeleteWithOptimistic }
  ]);
</script>

{#if isRenaming}
  <RenameInput initialName={node.name} {node} {depth} />
{:else}
  <ContextMenu items={menuItems}>
    <div
      role="treeitem"
      tabindex="0"
      aria-selected={isSelected}
      class="flex items-center gap-1.5 px-2 py-1 cursor-pointer select-none group w-full overflow-hidden border transition-colors {isSelected ? 'bg-selected border-focus text-primary' : 'border-transparent text-secondary hover:bg-hover hover:text-primary'}"
      style="padding-left: {depth * 12 + 8}px"
      onclick={() => { if (node.is_dir) toggleExpand(); onFileClick(node); }}
      onkeydown={(e) => { if (e.key === 'Enter') { if (node.is_dir) toggleExpand(); onFileClick(node); } }}
      oncontextmenu={() => uiStore.setSelectedExplorerPath(node.path)}
    >
          {#if node.is_dir}
            <span class="text-muted shrink-0 w-3.5 flex items-center justify-center">
              {#if isLoading}
                <Loader2 size={12} class="animate-spin" />
              {:else if isExpanded}
                <ChevronDown size={12} />
              {:else}
                <ChevronRight size={12} />
              {/if}
            </span>
          {:else}
            <span class="w-3.5 shrink-0 inline-block"></span>
          {/if}
          {#if node.is_dir}
            <span class="shrink-0 flex items-center justify-center text-accent">
              {#if $settingsStore.icon_theme === 'advance'}
                <img src="/icons/material/{getMaterialFolderIcon(node.name)}.svg" class="w-4 h-4 object-contain" alt="" />
              {:else if $settingsStore.icon_theme === 'default' || !$settingsStore.icon_theme}
                {#if isExpanded}
                  <FolderOpen size={14} />
                {:else}
                  <Folder size={14} />
                {/if}
              {/if}
            </span>
          {:else}
            {@const Icon = ICON_MAP[node.name.split('.').pop()?.toLowerCase() || ''] || File}
            <span class="shrink-0 flex items-center justify-center" class:text-icon-active={isSelected} class:text-icon-default={!isSelected}>
              {#if $settingsStore.icon_theme === 'advance'}
                <img src="/icons/material/{getMaterialFileIcon(node.name)}.svg" class="w-4 h-4 object-contain" alt="" />
              {:else if $settingsStore.icon_theme === 'default' || !$settingsStore.icon_theme}
                <Icon size={14} />
              {/if}
            </span>
          {/if}
          <span class="text-xs truncate min-w-0" title={node.name}>{node.name}</span>
    </div>
  </ContextMenu>

  {#if node.is_dir && isExpanded}
    <div>
      {#if isCreatingInside && $ui.creatingItem?.type === 'folder'}
        <CreationInput type="folder" parentPath={node.path} />
      {/if}
      {#each children.filter(c => c.is_dir) as child (child.path)}
        <TreeNode node={child} depth={depth + 1} {onFileClick} />
      {/each}
      {#if isCreatingInside && $ui.creatingItem?.type === 'file'}
        <CreationInput type="file" parentPath={node.path} />
      {/if}
      {#each children.filter(c => !c.is_dir) as child (child.path)}
        <TreeNode node={child} depth={depth + 1} {onFileClick} />
      {/each}
    </div>
  {/if}
{/if}