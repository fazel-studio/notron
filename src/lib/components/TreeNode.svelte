<script module lang="ts">
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
  import { Folder, FolderOpen, ChevronRight, ChevronDown, Loader2, Dot } from 'lucide-svelte';
  import { settingsStore } from '../stores/settings.svelte';
  import { gitDecorationStore } from '../stores/gitDecoration';

  let { 
    node, 
    isSelected,
    isActive,
    isFaded,
    isDropTarget,
    isDropInvalid,
    isCreatingChild,
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
    isLoading: boolean;
    onFileClick: (e: MouseEvent, node: FlatTreeNode) => void;
    onContextMenu: (e: MouseEvent, node: FlatTreeNode) => void;
    onPointerDown?: (e: PointerEvent, node: FlatTreeNode) => void;
    onPointerMove?: (e: PointerEvent) => void;
    onPointerUp?: (e: PointerEvent, node: FlatTreeNode) => void;
  }>();


  const indentStyle = $derived(`padding-left: ${node.depth * 12 + 8}px; padding-right: 8px; height: 26px;`);
  
  const iconTheme = $derived(settingsStore.effectiveSettings.icon_theme);
  const gitDecoration = $derived($gitDecorationStore[node.path]);

  /**
   * The badge label shown to the right of the filename, exactly like VSCode:
   * - Files: U / A / M / D / R / C / ! (conflict)
   * - Folders (rollup): same character representing worst status inside
   */
  const gitBadgeChar = $derived((() => {
    if (!gitDecoration) return '';
    const code = gitDecoration.code;
    if (code === 'Conflict') return '!';
    return code; // U, A, M, D, R, C — all shown verbatim like VSCode
  })());

  /**
   * A gitignored entry (node.is_ignored) is shown but visually dimmed,
   * exactly like VS Code does. If the file has an active git status badge
   * (gitDecoration), that takes priority — a modified gitignored file is
   * yellow, not grey.
   */
  const isGitIgnored = $derived(node.is_ignored === true && !gitDecoration);

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

<!-- 
  PERF: Tooltip Svelte dihapus — setiap Tooltip = onMount + $effect + portal DOM injection.
  Dengan 30-50 visible nodes, itu 30-50 komponen reaktif aktif bersamaan.
  Native `title` attribute = zero-cost, tidak ada overhead JS sama sekali.
-->
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
  class:opacity-60={isGitIgnored && !isActive}
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
    <!-- Folder icon: inherits git color when decorated, otherwise uses accent -->
    <span
      class="shrink-0 flex items-center"
      class:text-accent={!gitDecoration && !isGitIgnored || isActive}
      class:text-muted={isGitIgnored && !gitDecoration && !isActive}
      class:text-green-400={!isActive && !!gitDecoration && (gitDecoration.code === 'U' || gitDecoration.code === 'A' || gitDecoration.code === 'R' || gitDecoration.code === 'C')}
      class:text-yellow-400={!isActive && gitDecoration?.code === 'M'}
      class:text-red-400={!isActive && gitDecoration?.code === 'D'}
      class:text-purple-400={!isActive && gitDecoration?.code === 'Conflict'}
    >
      {#if iconTheme === 'default' || !iconTheme}
        {#if node.isExpanded}
          <FolderOpen size={14} />
        {:else}
          <Folder size={14} />
        {/if}
      {/if}
    </span>
  {:else}
    <!-- File icon: inherits git color when decorated -->
    <span
      class="shrink-0 flex items-center"
      class:text-icon-active={isActive}
      class:text-icon-default={!isActive && !gitDecoration && !isGitIgnored}
      class:text-icon-muted={isGitIgnored && !gitDecoration && !isActive}
      class:text-green-400={!isActive && !!gitDecoration && (gitDecoration.code === 'U' || gitDecoration.code === 'A' || gitDecoration.code === 'R' || gitDecoration.code === 'C')}
      class:text-yellow-400={!isActive && gitDecoration?.code === 'M'}
      class:text-red-400={!isActive && gitDecoration?.code === 'D'}
      class:text-purple-400={!isActive && gitDecoration?.code === 'Conflict'}
    >
      {#if iconTheme === 'default' || !iconTheme}
        {@const Icon = getFileIcon(node.name)}
        <Icon size={14} />
      {/if}
    </span>
  {/if}

  <!-- Filename: colored by git status exactly like VSCode -->
  <span
    class="truncate min-w-0 flex-1"
    class:text-primary={isActive}
    class:text-secondary={!isActive && !gitDecoration && !isGitIgnored}
    class:text-muted={isGitIgnored && !gitDecoration && !isActive}
    class:text-green-400={!isActive && !!gitDecoration && (gitDecoration.code === 'U' || gitDecoration.code === 'A' || gitDecoration.code === 'R' || gitDecoration.code === 'C')}
    class:text-yellow-400={!isActive && gitDecoration?.code === 'M'}
    class:text-red-400={!isActive && gitDecoration?.code === 'D'}
    class:text-purple-400={!isActive && gitDecoration?.code === 'Conflict'}
  >
    {node.name}
  </span>
  
  <!-- Git badge: shown to the right like VSCode -->
  {#if gitDecoration}
    {#if gitDecoration.is_rollup}
      <!-- Folder rollup badge: pill-shaped like VSCode folder decoration -->
      {@const rollupTone =
        gitDecoration.code === 'U' || gitDecoration.code === 'A' || gitDecoration.code === 'R' || gitDecoration.code === 'C'
          ? 'border-green-500/50 text-green-400'
          : gitDecoration.code === 'M'
            ? 'border-yellow-500/50 text-yellow-400'
            : gitDecoration.code === 'D'
              ? 'border-red-500/50 text-red-400'
              : gitDecoration.code === 'Conflict'
                ? 'border-purple-500/50 text-purple-400'
                : 'border-subtle text-muted'}
      <span class="shrink-0 text-[10px] font-bold px-1.5 rounded-full border text-center ml-1 {rollupTone}">{gitBadgeChar}</span>
    {:else}
      <!-- File badge: single character flush-right like VSCode -->
      <span
        class="shrink-0 text-[10px] font-bold w-3.5 text-right ml-1"
        class:text-green-400={gitDecoration.code === 'U' || gitDecoration.code === 'A' || gitDecoration.code === 'R' || gitDecoration.code === 'C'}
        class:text-yellow-400={gitDecoration.code === 'M'}
        class:text-red-400={gitDecoration.code === 'D'}
        class:text-purple-400={gitDecoration.code === 'Conflict'}
      >
        {gitBadgeChar}
      </span>
    {/if}
  {/if}
</div>
