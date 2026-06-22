<script module>
  import { File, FileCode, FileJson, FileText, Image, Settings, Globe, Hash } from 'lucide-svelte';

  const ICON_MAP: Record<string, any> = {
    ts: FileCode, tsx: FileCode, js: FileCode, jsx: FileCode,
    rs: FileCode, py: FileCode, go: FileCode,
    html: Globe, css: Hash, json: FileJson,
    md: FileText, svg: Image, png: Image, jpg: Image, jpeg: Image, webp: Image, gif: Image,
    toml: Settings, yaml: Settings, yml: Settings,
  };

  export function getFileIcon(name: string) {
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    return ICON_MAP[ext] ?? File;
  }
</script>

<script lang="ts">
  import type { FlatTreeNode } from '../utils/treeFlattener';
  import Tooltip from './Tooltip.svelte';
  import { Folder, FolderOpen, ChevronRight, ChevronDown, Loader2, Dot } from 'lucide-svelte';
  import { settingsStore } from '../stores/settings.svelte';

  let { 
    node, 
    isSelected,
    isActive,
    isFaded,
    isDropTarget,
    isDropInvalid,
    isCreatingChild,
    ctxMenuOpen, 
    isLoading,
    onFileClick, 
    onContextMenu,
    onPointerDown,
    onPointerMove,
    onPointerUp
  } = $props<{
    node: FlatTreeNode;
    isSelected: boolean;
    isActive?: boolean;
    isFaded?: boolean;
    isDropTarget?: boolean;
    isDropInvalid?: boolean;
    isCreatingChild?: boolean;
    ctxMenuOpen: boolean;
    isLoading: boolean;
    onFileClick: (e: MouseEvent, node: FlatTreeNode) => void;
    onContextMenu: (e: MouseEvent, node: FlatTreeNode) => void;
    onPointerDown?: (e: PointerEvent, node: FlatTreeNode) => void;
    onPointerMove?: (e: PointerEvent) => void;
    onPointerUp?: (e: PointerEvent, node: FlatTreeNode) => void;
  }>();

  const indentStyle = $derived(`padding-left: ${node.depth * 12 + 8}px; padding-right: 8px; height: 26px;`);
  
  const iconTheme = $derived(settingsStore.effectiveSettings.icon_theme);

  function handleClick(e: MouseEvent) {
    e.stopPropagation();
    onFileClick(e, node);
  }
  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.stopPropagation();
      onFileClick({ ctrlKey: false, shiftKey: false } as any, node);
    }
  }
  function handleContextMenu(e: MouseEvent) {
    onContextMenu(e, node);
  }
</script>

<Tooltip content={node.is_dir ? `folder: ${node.path}` : `file: ${node.path}`} wrapperClass="w-full block" followCursor={true} hoverDelay={2000} disabled={ctxMenuOpen}>
  <div
    role="treeitem"
    tabindex="0"
    aria-selected={isActive}
    data-node-path={node.path}
    class="flex items-center gap-1.5 cursor-pointer select-none w-full border text-xs transition-colors
      {isActive ? 'bg-selected ring-1 ring-inset ring-accent text-primary' : (isSelected ? 'bg-selected/60 border-transparent text-primary' : 'border-transparent hover:bg-hover hover:text-primary')}
      {isDropTarget ? 'ring-2 ring-inset ring-accent/70 bg-accent/[0.08] drop-valid' : ''}
      {isDropInvalid ? 'drop-invalid' : ''}
      {isFaded ? 'opacity-40 pointer-events-none' : ''}
      {isCreatingChild ? 'bg-accent/[0.04]' : ''}"
    style={indentStyle}
    class:selected={isSelected}
    class:active={isActive}
    class:faded={isFaded}
    class:drop-target={isDropTarget}
    class:drop-invalid={isDropInvalid}
    class:creating-child={isCreatingChild}
    onclick={handleClick}
    onkeydown={handleKeyDown}
    oncontextmenu={handleContextMenu}
    onpointerdown={(e) => onPointerDown?.(e, node)}
    onpointermove={(e) => onPointerMove?.(e)}
    onpointerup={(e) => onPointerUp?.(e, node)}
  >
    <span class="shrink-0 w-3.5 flex items-center justify-center text-muted">
      {#if node.is_dir}
        {#if isLoading}
          <Loader2 size={12} class="animate-spin" />
        {:else if node.has_children}
          {#if node.isExpanded}
            <ChevronDown size={12} />
          {:else}
            <ChevronRight size={12} />
          {/if}
        {:else if isCreatingChild}
          <Dot size={12} />
        {/if}
      {/if}
    </span>

    {#if node.is_dir}
      <span class="shrink-0 flex items-center text-accent">
        {#if iconTheme === 'default' || !iconTheme}
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
        class:text-icon-active={isActive}
        class:text-icon-default={!isActive}
      >
        {#if iconTheme === 'default' || !iconTheme}
          {@const Icon = getFileIcon(node.name)}
          <Icon size={14} />
        {/if}
      </span>
    {/if}

    <span
      class="truncate min-w-0 flex-1"
      class:text-primary={isActive}
      class:text-secondary={!isActive}
    >
      {node.name}
    </span>
  </div>
</Tooltip>
