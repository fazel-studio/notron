<script module lang="ts">
  let cachedResults: any[] = [];
  let cachedFilesScanned = 0;
  let cachedMatchesFound = 0;
  let cachedQuery = '';
</script>

<script lang="ts">
    import { uiStore } from '../stores/ui';
  import { editorStore } from '../stores/editor';
  import { invoke } from '@tauri-apps/api/core';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import { onDestroy, untrack } from 'svelte';
  import { 
    Replace, ChevronDown, ChevronRight, X, 
    File, FileCode, FileJson, FileText, Image, Settings, Globe, Hash, Loader2 
  } from 'lucide-svelte';
  import Tooltip from './Tooltip.svelte';
  import Modal from './Modal.svelte';

  const ICON_MAP: Record<string, any> = {
    ts: FileCode, tsx: FileCode, js: FileCode, jsx: FileCode,
    rs: FileCode, py: FileCode, go: FileCode,
    html: Globe, css: Hash, json: FileJson,
    md: FileText, svg: Image, png: Image, jpg: Image,
    toml: Settings, yaml: Settings, yml: Settings,
  };

  interface SearchResult { path: string; line: number; text: string; }



  let isReplaceVisible = $state(false);
  let showReplaceModal = $state(false);
  let isInitialLoad = true;
  const ui = uiStore;
  
  let searchQuery = $state($ui.searchQuery);
  let replaceQuery = $state($ui.replaceQuery);
  let initialSearchQuery = $ui.searchQuery;
  
  let results = $state<SearchResult[]>(cachedResults);
  let isSearching = $state(false);
  let filesScanned = $state(cachedFilesScanned);
  let matchesFound = $state(cachedMatchesFound);

  // Sync cache and result count
  $effect(() => {
    cachedResults = results;
    cachedFilesScanned = filesScanned;
    cachedMatchesFound = matchesFound;
    
    const count = results.length;
    untrack(() => {
      if (uiStore.getSnapshot().searchResultCount !== count) {
        uiStore.setSearchResultCount(count);
      }
    });
  });

  let lastRefreshCounter = $state($ui.searchRefreshCounter);
  let lastCollapseCounter = $state($ui.searchCollapseCounter);

  $effect(() => {
    const refreshCount = $ui.searchRefreshCounter;
    if (refreshCount > lastRefreshCounter) {
      lastRefreshCounter = refreshCount;
      untrack(() => {
        if (searchQuery.trim().length > 0 && !isSearching) {
          startSearch(searchQuery, true);
        }
      });
    }
  });

  $effect(() => {
    const collapseCount = $ui.searchCollapseCounter;
    if (collapseCount > lastCollapseCounter) {
      lastCollapseCounter = collapseCount;
      untrack(() => {
        const newCollapsed = new Set<string>();
        for (const r of results) {
          newCollapsed.add(r.path);
        }
        collapsedFiles = newCollapsed;
      });
    }
  });

  let collapsedFiles = $state<Set<string>>(new Set());

  function toggleFileCollapse(path: string, e: Event) {
    e.stopPropagation();
    const newSet = new Set(collapsedFiles);
    if (newSet.has(path)) newSet.delete(path);
    else newSet.add(path);
    collapsedFiles = newSet;
  }

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let currentCancelToken: string | null = null;
  let unlisten: UnlistenFn | null = null;

  // Debounced search with streaming 
  $effect(() => {
    const q = searchQuery;
    const rq = replaceQuery;
    const root = untrack(() => $ui.explorerRoot);

    clearTimeout(debounceTimer);
    if (q.trim().length > 0 && root) {
      if (q === cachedQuery && results.length > 0) {
        // Already cached, do not research
        if (untrack(() => uiStore.getSnapshot().searchQuery) !== q) uiStore.setSearchQuery(q);
        if (untrack(() => uiStore.getSnapshot().replaceQuery) !== rq) uiStore.setReplaceQuery(rq);
        isInitialLoad = false;
      } else if (isInitialLoad && q === initialSearchQuery) {
        debounceTimer = setTimeout(() => {
          if (untrack(() => uiStore.getSnapshot().searchQuery) !== q) uiStore.setSearchQuery(q);
          if (untrack(() => uiStore.getSnapshot().replaceQuery) !== rq) uiStore.setReplaceQuery(rq);
          startSearch(q);
          isInitialLoad = false;
        }, 1500);
      } else {
        isInitialLoad = false;
        debounceTimer = setTimeout(() => {
          if (untrack(() => uiStore.getSnapshot().searchQuery) !== q) uiStore.setSearchQuery(q);
          if (untrack(() => uiStore.getSnapshot().replaceQuery) !== rq) uiStore.setReplaceQuery(rq);
          startSearch(q);
        }, 200);
      }
    } else {
      isInitialLoad = false;
      handleCancel();
      if (untrack(() => uiStore.getSnapshot().searchQuery) !== q) uiStore.setSearchQuery(q);
      if (untrack(() => uiStore.getSnapshot().replaceQuery) !== rq) uiStore.setReplaceQuery(rq);
      results = [];
      filesScanned = 0;
      matchesFound = 0;
    }
    return () => clearTimeout(debounceTimer);
  });

  async function startSearch(query: string, quietRefresh = false) {
    if (currentCancelToken) {
      await invoke('cancel_search', { token: currentCancelToken }).catch(() => {});
    }
    
    if (unlisten) {
      unlisten();
      unlisten = null;
    }

    if (!quietRefresh) {
      results = [];
      filesScanned = 0;
      matchesFound = 0;
    }
    
    isSearching = true;
    cachedQuery = query;
    let isFirstBatch = true;

    currentCancelToken = crypto.randomUUID();

    unlisten = await listen<any>('search-batch', (event) => {
      const payload = event.payload;
      if (payload) {
        if (isFirstBatch && quietRefresh) {
           results = [];
           filesScanned = 0;
           matchesFound = 0;
           isFirstBatch = false;
        }

        if (payload.results && payload.results.length > 0) {
          results = [...results, ...payload.results];
        }
        filesScanned = payload.files_scanned;
        matchesFound = payload.total_matches;
        
        if (payload.is_done) {
          if (isFirstBatch && quietRefresh) {
             results = [];
          }
          isSearching = false;
          currentCancelToken = null;
        }
      }
    });

    try {
      await invoke('search_workspace', {
        query,
        workspacePath: $ui.explorerRoot,
        cancelToken: currentCancelToken,
        options: { caseSensitive: false, useRegex: false }
      });
    } catch (err) {
      console.error(err);
      isSearching = false;
    }
  }

  function handleCancel() {
    if (currentCancelToken) {
      invoke('cancel_search', { token: currentCancelToken }).catch(console.error);
      currentCancelToken = null;
    }
    isSearching = false;
  }

  async function executeReplaceAll() {
    showReplaceModal = false;
    if (replaceQuery === undefined || !searchQuery) return;
    
    for (const [path] of Object.entries(groupedResults)) {
      try {
        const fileData: any = await invoke('open_file', { path });
        let content: string = fileData.content;
        
        const escapedQuery = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escapedQuery, 'gi');
        
        const newContent = content.replace(regex, replaceQuery);
        
        if (newContent !== content) {
          await invoke('save_file', { path, content: newContent, encoding: 'utf-8' });
          const tab = untrack(() => editorStore.getTabsSnapshot().find((t: any) => t.path === path));
          if (tab) {
             editorStore.setInitialContent(tab.id, newContent);
          }
        }
      } catch(err) {
         console.error("Failed to replace in file", path, err);
      }
    }
    searchQuery = '';
    replaceQuery = '';
  }

  onDestroy(() => {
    if (unlisten) unlisten();
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (searchQuery.trim().length > 0) {
        if (untrack(() => uiStore.getSnapshot().searchQuery) !== searchQuery) uiStore.setSearchQuery(searchQuery);
        startSearch(searchQuery);
      }
    }
  }

  function highlightMatches(text: string, query: string) {
    if (!query) return [{ text, isMatch: false }];
    let lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    
    const firstIdx = lowerText.indexOf(lowerQuery);
    if (firstIdx > 30) {
      const cropStart = firstIdx - 15;
      text = '...' + text.substring(cropStart);
      lowerText = text.toLowerCase();
    }
    
    const parts = [];
    let start = 0;
    let idx = lowerText.indexOf(lowerQuery, start);
    while (idx !== -1) {
      if (idx > start) parts.push({ text: text.substring(start, idx), isMatch: false });
      parts.push({ text: text.substring(idx, idx + query.length), isMatch: true });
      start = idx + query.length;
      idx = lowerText.indexOf(lowerQuery, start);
    }
    if (start < text.length) parts.push({ text: text.substring(start), isMatch: false });
    return parts;
  }

  async function handleResultClick(path: string, res?: SearchResult) {
    try {
      const name = path.split(/[\/\\]/).pop() || 'Unknown';
      const isImage = /\.(png|jpe?g|gif|webp|svg|ico)$/i.test(name);
      let content: string | null = null;
      if (!isImage) {
        const result: any = await invoke('open_file', { path });
        content = result.content;
      }
      const language = isImage ? 'image' : await invoke<string>('detect_language', { path });
      editorStore.addTab({ id: path, path, name, content, language, isPreview: true });

      if (res) {
        const queryLower = searchQuery.toLowerCase();
        const startCol = res.text.toLowerCase().indexOf(queryLower);
        const col = startCol >= 0 ? startCol + 1 : 1;
        const endCol = startCol >= 0 ? startCol + 1 + queryLower.length : col;
        
        editorStore.updateCursor(path, res.line, col, endCol);
        
        window.dispatchEvent(new CustomEvent('editor:action', {
          detail: { action: 'goto', line: res.line, column: col, endColumn: endCol }
        }));
      }
    } catch (err) { console.error("Failed to open file from search", err); }
  }

  let groupedResults = $derived(
    results.reduce((acc, curr) => {
      if (!acc[curr.path]) acc[curr.path] = [];
      acc[curr.path].push(curr);
      return acc;
    }, {} as Record<string, SearchResult[]>)
  );
</script>

<div class="flex flex-col p-2 gap-2 h-full text-primary">
  <div class="flex flex-col gap-1.5 shrink-0">
    <div class="flex items-start gap-1">
      <button aria-label="Toggle replace" onclick={() => isReplaceVisible = !isReplaceVisible} class="mt-1 p-0.5 rounded cursor-pointer transition-colors hover:bg-hover">
        {#if isReplaceVisible}
          <ChevronDown size={16} />
        {:else}
          <ChevronRight size={16} />
        {/if}
      </button>
      <div class="flex flex-col flex-1 gap-1.5 min-w-0">
        <div class="flex items-center flex-1 border rounded px-1.5 py-1 border-subtle bg-canvas focus-within:border-focus">
          <input type="text" placeholder="Search" bind:value={searchQuery} onkeydown={handleKeydown} class="flex-1 bg-transparent text-sm outline-none min-w-0 placeholder-muted" />
          {#if isSearching}
            <button aria-label="Cancel search" onclick={handleCancel} class="p-0.5 rounded cursor-pointer shrink-0 ml-1 text-icon-default hover:text-icon-active hover:bg-hover transition-colors">
              <X size={14} />
            </button>
          {/if}
        </div>
        {#if isReplaceVisible}
        <div class="flex items-center flex-1 border rounded px-1.5 py-1 border-subtle bg-canvas focus-within:border-focus">
            <input type="text" placeholder="Replace" bind:value={replaceQuery} class="flex-1 bg-transparent text-sm outline-none min-w-0 placeholder-muted" />
            <Tooltip content="Replace All" wrapperClass="ml-1 shrink-0 flex items-center">
              <button aria-label="Replace All" onclick={() => { if (results.length > 0) showReplaceModal = true; }} disabled={results.length === 0 || searchQuery === replaceQuery} class="p-0.5 rounded cursor-pointer transition-colors text-icon-default hover:text-icon-active hover:bg-hover disabled:opacity-30 disabled:cursor-not-allowed">
                <Replace size={14} />
              </button>
            </Tooltip>
          </div>
        {/if}
      </div>
    </div>
  </div>
  <div class="flex-1 overflow-y-auto mt-2 text-sm hover-scrollbar">
    {#if isSearching}
      <div class="flex items-center gap-2 px-6 text-xs text-muted">
        <Loader2 size={12} class="animate-spin" />
        <span>Searching... {filesScanned} files scanned, {matchesFound} matches found</span>
        <button onclick={handleCancel} class="underline ml-2 transition-colors text-icon-default hover:text-icon-active">Cancel</button>
      </div>
    {:else if results.length > 0}
      <div class="text-xs px-6 pb-1 text-muted">{results.length} results in {Object.keys(groupedResults).length} files</div>
          <div class="flex flex-col mb-1">
            {#each Object.entries(groupedResults) as [path, pathResults] (path)}
              {@const Icon = ICON_MAP[path.split('.').pop()?.toLowerCase() || ''] || File}
              {@const isCollapsed = collapsedFiles.has(path)}
              <div class="flex flex-col mb-1">
                <div class="flex items-center gap-1.5 px-2 py-1 cursor-pointer select-none group w-full overflow-hidden hover:bg-hover transition-colors" role="treeitem" tabindex="0" aria-expanded={!isCollapsed} aria-selected="false" onclick={(e) => toggleFileCollapse(path, e)} onkeydown={(e) => { if (e.key === 'Enter') toggleFileCollapse(path, e); }}>
                  <span class="shrink-0 text-muted transition-transform {isCollapsed ? '-rotate-90' : ''}">
                    <ChevronDown size={14} />
                  </span>
                  <span class="shrink-0 text-accent">
                    <Icon size={14} />
                  </span>
                  <Tooltip content={path} wrapperClass="truncate min-w-0 flex-1 flex items-center" followCursor={true} hoverDelay={2000}>
                    <span class="text-xs truncate min-w-0 font-medium">{path.split(/[\/\\]/).pop()}</span>
                  </Tooltip>
                  <span class="text-[10px] px-1 rounded-full shrink-0 bg-surface text-muted">{pathResults.length}</span>
                </div>
              {#if !isCollapsed}
              <div class="flex flex-col">
                {#each pathResults as res, i (i)}
                <Tooltip content={res.text.trim()} wrapperClass="w-full block" followCursor={true} hoverDelay={2000}>
                  <div class="flex items-start gap-2 pl-8 pr-2 py-0.5 cursor-pointer text-xs group text-secondary hover:text-primary hover:bg-hover transition-colors" role="option" tabindex="0" aria-selected={false} onclick={() => handleResultClick(path, res)} onkeydown={(e) => { if (e.key === 'Enter') handleResultClick(path, res); }}>
                    <span class="shrink-0 w-8 text-right select-none opacity-50 text-muted">{res.line}</span>
                    <span class="truncate flex-1 group-hover:text-primary font-mono text-[11px] mt-[1px]">
                      {#each highlightMatches(res.text.trim(), searchQuery) as part}
                        {#if part.isMatch}
                          <span class="border border-accent bg-accent/20 text-accent rounded-[2px] px-[1px]">{part.text}</span>
                        {:else}
                          {part.text}
                        {/if}
                      {/each}
                    </span>
                  </div>
                </Tooltip>
              {/each}
              </div>
              {/if}
            </div>
          {/each}
      </div>
    {:else if searchQuery.length > 0}
      <div class="px-6 text-xs text-muted">No results found.</div>
    {:else}
      <div class="px-6 text-xs text-muted">Type to search across workspace.</div>
    {/if}
  </div>
</div>

<Modal 
  isOpen={showReplaceModal} 
  title="Confirm Replace All" 
  onClose={() => showReplaceModal = false}
>
  <div class="p-4 flex flex-col gap-3">
    <p class="text-sm">Are you sure you want to replace all occurrences of <strong>{searchQuery}</strong> with <strong>{replaceQuery}</strong>?</p>
    <p class="text-xs text-muted">This will replace {results.length} results across {Object.keys(groupedResults).length} files.</p>
  </div>
  {#snippet footer()}
    <div class="flex justify-end gap-2 w-full">
      <button class="px-3 py-1.5 text-sm rounded hover:bg-hover transition-colors" onclick={() => showReplaceModal = false}>Cancel</button>
      <button class="px-3 py-1.5 text-sm rounded bg-accent text-on-accent hover:bg-accent/90 transition-colors" onclick={executeReplaceAll}>Yes, Replace it</button>
    </div>
  {/snippet}
</Modal>