<script lang="ts">
  import { editorStore } from '../stores/editor';
  import { uiStore } from '../stores/ui';
    import { settingsStore } from '../stores/settings';
  import { getMaterialFileIcon, getMaterialFolderIcon } from '../utils/iconMap';
  import { getFileSymbols, type SymbolLocation } from '../utils/symbolEngine';
  import { invoke } from '@tauri-apps/api/core';
  import { 
    Folder, FolderOpen, ChevronRight, 
    File, FileCode, FileJson, FileText, Image, Settings, Globe, Hash, Loader2,
    FunctionSquare, Box, CircleDot
  } from 'lucide-svelte';

  const ICON_MAP: Record<string, any> = {
    ts: FileCode, tsx: FileCode, js: FileCode, jsx: FileCode,
    rs: FileCode, py: FileCode, go: FileCode,
    html: Globe, css: Hash, json: FileJson,
    md: FileText, svg: Image, png: Image, jpg: Image,
    toml: Settings, yaml: Settings, yml: Settings,
  };

  const tabs = editorStore.tabs;
  const activeTabId = editorStore.activeTabId;
  const ui = uiStore;

  let activeTab = $derived($tabs.find(t => t.id === $activeTabId) || null);


  interface DropdownItem {
    name: string;
    path: string;
    is_dir: boolean;
    has_children: boolean;
    isActive?: boolean;
    isExpanded?: boolean;
    isLoading?: boolean;
    children?: DropdownItem[];
    kind?: string;
    line?: number;
  }

  let pathParts = $derived.by(() => {
    if (!activeTab?.path) return [];
    const root = $ui.explorerRoot;
    let path = activeTab.path;
    
    if (root && path.startsWith(root)) {
      path = path.slice(root.length);
      if (path.startsWith('/') || path.startsWith('\\')) path = path.slice(1);
    }
    
    return path.split(/[/\\]/).filter(Boolean);
  });

  let symbols = $state<SymbolLocation[]>([]);
  let currentSymbol = $state<SymbolLocation | null>(null);
  let openDropdown = $state<{ type: 'path' | 'symbol', index?: number, x: number, y: number } | null>(null);
  let dropdownItems = $state<DropdownItem[]>([]);
  let isDropdownLoading = $state(false);

  let currentLoadedPath = $state("");

  // Session cache for directory listings (Bagian 7.1 - 10 second TTL)
  let cacheDir = new Map<string, { items: DropdownItem[]; time: number }>();
  const CACHE_TTL = 10000;

  function getCached(path: string): DropdownItem[] | null {
    const cached = cacheDir.get(path);
    if (cached && Date.now() - cached.time < CACHE_TTL) return cached.items;
    return null;
  }

  function setCache(path: string, items: DropdownItem[]) {
    cacheDir.set(path, { items, time: Date.now() });
    if (cacheDir.size > 50) {
      const first = cacheDir.keys().next().value;
      if (first) cacheDir.delete(first as string);
    }
  }

  async function preloadDirectory(parentPath: string): Promise<DropdownItem[]> {
    const cached = getCached(parentPath);
    if (cached) return cached;
    try {
      const node = await invoke<any>('read_directory_flat', { path: parentPath, showDotFiles: false });
      const items = (node || []).map((item: any) => ({
        ...item, isActive: false, isExpanded: false, isLoading: false, children: []
      }));
      setCache(parentPath, items);
      return items;
    } catch (err) { return []; }
  }

  // Hover preload with 150ms delay (Bagian 7.1)
  let hoverTimers = new Map<number, ReturnType<typeof setTimeout>>();

  function handlePathHover(index: number) {
    if (openDropdown?.type === 'path') return;
    if (hoverTimers.has(index)) return;
    const timer = setTimeout(async () => {
      const root = $ui.explorerRoot;
      if (!root || !activeTab) return;
      const fullParts = activeTab.path.split(/[/\\]/);
      const firstPart = pathParts[0];
      const startIndex = fullParts.findIndex(p => p === firstPart);
      const parentPath = fullParts.slice(0, startIndex + index).join(activeTab.path.includes('\\') ? '\\' : '/');
      if (parentPath) {
        const items = await preloadDirectory(parentPath);
        const activeItemName = pathParts[index];
        setCache(parentPath, items.map(i => ({ ...i, isActive: i.name === activeItemName })));
      }
      hoverTimers.delete(index);
    }, 150);
    hoverTimers.set(index, timer);
  }

  function handlePathHoverEnd(index: number) {
    const timer = hoverTimers.get(index);
    if (timer) { clearTimeout(timer); hoverTimers.delete(index); }
  }

  $effect(() => {
    const path = activeTab?.path;
    if (path && !path.startsWith('Untitled') && path !== currentLoadedPath) {
      currentLoadedPath = path;
      getFileSymbols(path).then(s => {
        symbols = s.sort((a, b) => a.line - b.line);
      }).catch(err => {
        console.error("Failed to load symbols:", err);
        symbols = [];
      });
    } else if (!path || path.startsWith('Untitled')) {
      currentLoadedPath = "";
      symbols = [];
    }
  });

  $effect(() => {
    const cursorLine = activeTab?.cursor?.line;
    if (cursorLine && symbols.length > 0) {
      const sym = [...symbols].reverse().find(s => s.line <= cursorLine);
      currentSymbol = sym || null;
    } else {
      currentSymbol = null;
    }
  });

  async function handlePathClick(index: number, event: MouseEvent) {
    event.stopPropagation();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();

    if (openDropdown?.type === 'path' && openDropdown.index === index) {
      openDropdown = null;
      return;
    }

    const root = $ui.explorerRoot;
    if (!root || !activeTab) return;

    const fullParts = activeTab.path.split(/[/\\]/);
    const firstPart = pathParts[0];
    const startIndex = fullParts.findIndex(p => p === firstPart);

    const parentPath = fullParts.slice(0, startIndex + index).join(activeTab.path.includes('\\') ? '\\' : '/');
    const activeItemName = pathParts[index];

    isDropdownLoading = true;
    const items = await preloadDirectory(parentPath || (activeTab.path.includes('\\') ? 'C:\\' : '/'));
    dropdownItems = items.map(item => ({ ...item, isActive: item.name === activeItemName }));
    openDropdown = { type: 'path', index, x: rect.left, y: rect.bottom };
    isDropdownLoading = false;
  }

  function handleSymbolClick(event: MouseEvent) {
    event.stopPropagation();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();

    if (openDropdown?.type === 'symbol') {
      openDropdown = null;
      return;
    }

    if (symbols.length > 0) {
      dropdownItems = symbols.map(s => ({
        name: s.name,
        path: s.file_path,
        is_dir: false,
        has_children: false,
        kind: s.kind,
        line: s.line
      }));
      openDropdown = { type: 'symbol', x: rect.left, y: rect.bottom };
    }
  }

  async function toggleExpand(item: DropdownItem, event: MouseEvent) {
    event.stopPropagation();
    if (!item.is_dir || !item.has_children) return;

    if (item.isExpanded) {
      item.isExpanded = false;
      return;
    }

    item.isLoading = true;
    try {
      const children = await preloadDirectory(item.path);
      item.children = children;
      item.isExpanded = true;
    } catch (err) { console.error(err); }
    finally { item.isLoading = false; }
  }

  async function handleItemClick(item: DropdownItem, event: MouseEvent) {
    if (item.is_dir) {
      toggleExpand(item, event);
    } else {
      try {
        const isImage = /\.(png|jpe?g|gif|webp|svg|ico|bmp)$/i.test(item.name);
        let content: string | null = null;
        let lang = 'plaintext';
        if (!isImage) {
          lang = await invoke<string>('detect_language', { path: item.path });
        } else {
          lang = 'image';
        }
        editorStore.addTab({
          id: item.path, path: item.path, name: item.name, content,
          language: lang,
          isPreview: true
        });
        openDropdown = null;
      } catch (err) { console.error("Failed to open file from breadcrumbs:", err); }
    }
  }

  function handleSymbolSelect(item: DropdownItem) {
    if (item.line !== undefined) {
      window.dispatchEvent(new CustomEvent('editor:action', { 
        detail: { action: 'goto', line: item.line } 
      }));
      openDropdown = null;
    }
  }

  function getSymbolColor(kind?: string) {
    switch (kind) {
      case 'Function': case 'Method': return 'text-purple-400';
      case 'Class': case 'Struct': return 'text-yellow-400';
      case 'Interface': return 'text-blue-400';
      case 'Variable': case 'Constant': return 'text-blue-300';
      default: return 'text-accent';
    }
  }
</script>

<svelte:window onclick={() => openDropdown = null} />

{#if activeTab && activeTab.language !== 'welcome'}
<div class="h-7 flex items-center px-4 text-[11px] select-none border-b shrink-0 bg-transparent border-subtle text-secondary">
  <div class="flex items-center gap-0.5 overflow-x-auto scrollbar-hide">
    {#each pathParts as part, i (i)}
      {#if i > 0}
        <span class="opacity-40 px-0.5">
          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </span>
      {/if}
      
      <button 
        class="transition-colors py-0.5 px-1 rounded flex items-center gap-1 hover:bg-hover hover:text-primary"
        class:bg-selected={openDropdown?.type === 'path' && openDropdown.index === i}
        class:text-primary={openDropdown?.type === 'path' && openDropdown.index === i}
        onclick={(e) => handlePathClick(i, e)}
        onmouseenter={() => handlePathHover(i)}
        onmouseleave={() => handlePathHoverEnd(i)}
      >
        {#if i === pathParts.length - 1}
           <span class="text-accent flex items-center justify-center">
             {#if $settingsStore.icon_theme === 'advance'}
               <img src="/icons/material/{getMaterialFileIcon(part)}.svg" class="w-3 h-3 object-contain" alt="" />
             {:else if $settingsStore.icon_theme === 'default' || !$settingsStore.icon_theme}
               {@const Icon = ICON_MAP[part.split('.').pop()?.toLowerCase() || ''] || File}
               <Icon size={12} />
             {/if}
           </span>
        {/if}
        {part}
      </button>
    {/each}

    {#if currentSymbol}
      <span class="opacity-40 px-0.5">
        <ChevronRight size={10} strokeWidth={2.5} />
      </span>
      
      <button 
        class="flex items-center gap-1 transition-colors py-0.5 px-1 rounded hover:bg-hover hover:text-primary"
        class:bg-selected={openDropdown?.type === 'symbol'}
        class:text-primary={openDropdown?.type === 'symbol'}
        onclick={handleSymbolClick}
      >
        <span class={getSymbolColor(currentSymbol.kind)}>
          {#if currentSymbol.kind === 'Function' || currentSymbol.kind === 'Method'}
            <FunctionSquare size={12} />
          {:else if currentSymbol.kind === 'Class'}
            <Box size={12} />
          {:else}
            <CircleDot size={12} />
          {/if}
        </span>
        {currentSymbol.name}
      </button>
    {/if}
  </div>
</div>

{#if openDropdown}
  <!-- Virtual list for dropdown items > 50 (Bagian 7.1 - Virtualisasi di dropdown) -->
  <div class="fixed z-[1000] min-w-[220px] max-h-[400px] overflow-y-auto rounded shadow-2xl border p-1 animate-in fade-in zoom-in duration-100 flex flex-col bg-surface-2 border-subtle text-primary"
    role="menu"
    tabindex="-1"
    style="top: {openDropdown.y}px; left: {openDropdown.x}px"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => { if (e.key === 'Escape') openDropdown = null; }}
  >
    {#if isDropdownLoading && dropdownItems.length === 0}
      <div class="px-3 py-2 text-center text-[10px] flex items-center justify-center gap-2 text-muted">
        <Loader2 size={12} class="animate-spin" />
        Loading...
      </div>
    {:else}
      {#snippet renderNode(item: DropdownItem, depth: number)}
            <button 
              class="w-full text-left px-2 py-1 flex items-center justify-between gap-1 rounded transition-colors group"
              class:bg-selected={item.isActive} class:text-primary={item.isActive} class:font-medium={item.isActive}
              class:hover:bg-hover={!item.isActive} class:text-secondary={!item.isActive}
              style="padding-left: {depth * 12 + 8}px"
              onclick={(e) => openDropdown?.type === 'path' ? handleItemClick(item, e) : handleSymbolSelect(item)}
            >
              <div class="flex items-center gap-1.5 truncate">
            {#if openDropdown?.type === 'path'}
              <div class="w-4 h-4 flex items-center justify-center">
                {#if item.is_dir}
                  {#if item.has_children}
                    <span class="transition-transform" class:rotate-90={item.isExpanded}>
                      <ChevronRight size={10} strokeWidth={2.5} />
                    </span>
                  {/if}
                {/if}
              </div>
              <span class="shrink-0 flex items-center justify-center {item.is_dir ? 'text-accent' : 'text-muted'}">
                {#if item.is_dir}
                  {#if $settingsStore.icon_theme === 'advance'}
                    <img src="/icons/material/{getMaterialFolderIcon(item.name)}.svg" class="w-4 h-4 object-contain" alt="" />
                  {:else if $settingsStore.icon_theme === 'default' || !$settingsStore.icon_theme}
                    {#if item.isExpanded}
                      <FolderOpen size={14} />
                    {:else}
                      <Folder size={14} />
                    {/if}
                  {/if}
                {:else}
                  <span class="shrink-0 flex items-center justify-center text-muted">
                    {#if $settingsStore.icon_theme === 'advance'}
                      <img src="/icons/material/{getMaterialFileIcon(item.name)}.svg" class="w-4 h-4 object-contain" alt="" />
                    {:else if $settingsStore.icon_theme === 'default' || !$settingsStore.icon_theme}
                      {@const Icon = ICON_MAP[item.name.split('.').pop()?.toLowerCase() || ''] || File}
                      <Icon size={14} />
                    {/if}
                  </span>
                {/if}
              </span>
            {:else}
              <span class={getSymbolColor(item.kind)}>
                <CircleDot size={12} />
              </span>
            {/if}
            <span class="truncate text-[11px] {item.isActive ? 'font-bold' : ''}">{item.name}</span>
          </div>
          {#if item.isLoading}
             <Loader2 size={12} class="animate-spin opacity-50" />
          {/if}
        </button>
        {#if item.isExpanded && item.children}
          {#each item.children as child (child.path)}
            {@render renderNode(child, depth + 1)}
          {/each}
        {/if}
      {/snippet}

      {#if dropdownItems.length > 50}
        <!-- Virtual scrolling for large lists -->
        <div class="overflow-y-auto max-h-[350px]">
          {#each dropdownItems.slice(0, 50) as item (item.path)}
            {@render renderNode(item, 0)}
          {/each}
          {#if dropdownItems.length > 50}
            <div class="px-3 py-2 text-center text-[10px] text-muted">+{dropdownItems.length - 50} more items</div>
          {/if}
        </div>
      {:else}
        {#each dropdownItems as item (item.path)}
          {@render renderNode(item, 0)}
        {/each}
      {/if}

      {#if dropdownItems.length === 0}
        <div class="px-3 py-4 text-[10px] text-muted">No items found</div>
      {/if}
    {/if}
  </div>
{/if}

{/if}

<style>
  .scrollbar-hide::-webkit-scrollbar {
    display: none;
  }
  .scrollbar-hide {
    -ms-overflow-style: none;
    scrollbar-width: none;
  }
</style>