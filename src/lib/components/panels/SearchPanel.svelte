<script module lang="ts">
  // SearchLineMatch mirrors src-tauri/src/search.rs — `start`/`end` are byte
  // offsets relative to `text` (the trimmed line); `isContext` marks lines
  // emitted for context, not real matches.
  export interface SearchLineMatch { line: number; start: number; end: number; text: string; isContext?: boolean; }
  export interface SearchFileItem { path: string; displayPath: string; fileName: string; matchCount: number; matches: SearchLineMatch[]; }
  export interface DisplayRow {
    key: string;
    type: 'file' | 'match';
    path: string;
    matchCount?: number;
    excluded?: boolean;
    res?: SearchLineMatch;
  }

  let cachedResults: SearchFileItem[] = [];
  let cachedFilesScanned = 0;
  let cachedMatchesFound = 0;
  let cachedQuery = '';
</script>

<script lang="ts">
    import { uiStore } from '../../stores/ui';
  import { editorStore } from '../../stores/editor';
  import { invoke } from '@tauri-apps/api/core';
  import { onDestroy, untrack } from 'svelte';
  import { streamCommand } from '../../utils/stream';
  import { 
    Replace, ChevronDown, ChevronRight, X, 
    File, FileCode, FileJson, FileText, Image, Settings, Globe, Hash, Loader2,
    CaseSensitive, WholeWord
  } from 'lucide-svelte';
  import Tooltip from '../common/Tooltip.svelte';
  import Modal from '../common/Modal.svelte';
  import VirtualList from '../common/VirtualList.svelte';

  const ICON_MAP: Record<string, any> = {
    ts: FileCode, tsx: FileCode, js: FileCode, jsx: FileCode,
    rs: FileCode, py: FileCode, go: FileCode,
    html: Globe, css: Hash, json: FileJson,
    md: FileText, svg: Image, png: Image, jpg: Image,
    toml: Settings, yaml: Settings, yml: Settings,
  };

  // Cap total matches so the backend scan stops early and the UI never
  // accumulates unbounded results (matches the Rust MAX default of 10k).
  const MAX_RESULTS = 10000;
  const MAX_FILE_SIZE = 5 * 1024 * 1024;

  let isReplaceVisible = $state(false);
  let showReplaceModal = $state(false);
  let isInitialLoad = true;
  const ui = uiStore;
  
  let searchQuery = $state($ui.searchQuery);
  let replaceQuery = $state($ui.replaceQuery);
  let initialSearchQuery = $ui.searchQuery;

  let caseSensitive = $state(false);
  let wholeWord = $state(false);
  let excludedFiles = $state<Set<string>>(new Set());
  
  let results = $state<SearchFileItem[]>(cachedResults);
  let isSearching = $state(false);
  let filesScanned = $state(cachedFilesScanned);
  let matchesFound = $state(cachedMatchesFound);
  let lastOptionKey = $state('00');

  // Sync cache and result count
  $effect(() => {
    cachedResults = results;
    cachedFilesScanned = filesScanned;
    cachedMatchesFound = matchesFound;
    
    const count = results.reduce((n, f) => n + f.matchCount, 0);
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
        collapsedFiles = new Set(results.map(f => f.path));
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

  function toggleExclude(path: string, e: Event) {
    e.stopPropagation();
    const newSet = new Set(excludedFiles);
    if (newSet.has(path)) newSet.delete(path);
    else newSet.add(path);
    excludedFiles = newSet;
  }

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let currentCancelToken: string | null = null;

  // Debounced search with streaming; re-runs when query or match options change.
  $effect(() => {
    const q = searchQuery;
    const rq = replaceQuery;
    const root = untrack(() => $ui.explorerRoot);
    const cs = caseSensitive;
    const ww = wholeWord;

    clearTimeout(debounceTimer);
    if (q.trim().length > 0 && root) {
      const optKey = `${cs ? '1' : '0'}${ww ? '1' : '0'}`;
      if (q === cachedQuery && results.length > 0 && optKey === lastOptionKey) {
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

    if (!quietRefresh) {
      results = [];
      filesScanned = 0;
      matchesFound = 0;
    }

    isSearching = true;
    cachedQuery = query;
    lastOptionKey = `${caseSensitive ? '1' : '0'}${wholeWord ? '1' : '0'}`;
    currentCancelToken = crypto.randomUUID();

    try {
      await streamCommand<SearchFileItem>(
        'search_files_stream',
        {
          options: {
            query,
            caseSensitive,
            useRegex: false,
            wholeWord,
            dotFiles: untrack(() => $ui.showDotFiles),
            contextLines: 0,
          },
          workspacePath: $ui.explorerRoot,
          maxResults: MAX_RESULTS,
          maxFileSize: MAX_FILE_SIZE,
          cancelToken: currentCancelToken,
        },
        {
          onBatch: (batchItems, meta) => {
            if (quietRefresh) {
              results = [];
              filesScanned = 0;
              matchesFound = 0;
            }
            if (batchItems.length > 0) {
              const totalSoFar = results.reduce((n, f) => n + f.matchCount, 0);
              const remaining = MAX_RESULTS - totalSoFar;
              if (remaining > 0) {
                let added = 0;
                for (const item of batchItems) {
                  if (added >= remaining) break;
                  results.push(item);
                  added += item.matchCount;
                }
              } else {
                // Cap reached — cancel the backend scan to stop wasted I/O
                invoke('cancel_search', { token: currentCancelToken }).catch(() => {});
                currentCancelToken = null;
              }
            }
            filesScanned = meta.files_scanned ?? filesScanned;
            matchesFound = meta.matches_found ?? matchesFound;
          },
          onDone: (meta) => {
            if (quietRefresh) {
              results = [];
            }
            filesScanned = meta.files_scanned ?? filesScanned;
            matchesFound = meta.matches_found ?? matchesFound;
            isSearching = false;
            currentCancelToken = null;
          },
        },
      );
    } catch (err) {
      console.error(err);
      isSearching = false;
      currentCancelToken = null;
    }
  }

  function handleCancel() {
    if (currentCancelToken) {
      invoke('cancel_search', { token: currentCancelToken }).catch(console.error);
      currentCancelToken = null;
    }
    isSearching = false;
  }

  let fileCount = $derived(results.length);

  // Results arrive already grouped per-file (SearchFileItem), so each file
  // becomes one header row followed by its match rows. Collapsed files only
  // emit their header; excluded files are dimmed and skipped by Replace All.
  let displayRows = $derived.by(() => {
    const rows: DisplayRow[] = [];
    for (const f of results) {
      const isExcluded = excludedFiles.has(f.path);
      rows.push({ key: `file:${f.path}`, type: 'file', path: f.path, matchCount: f.matchCount, excluded: isExcluded });
      if (collapsedFiles.has(f.path)) continue;
      for (let i = 0; i < f.matches.length; i++) {
        rows.push({ key: `match:${f.path}:${f.matches[i].line}:${i}`, type: 'match', path: f.path, res: f.matches[i] });
      }
    }
    return rows;
  });

  // Convert a byte offset (Rust grep reports byte offsets) into a character
  // index inside the preview string, so CodeMirror columns stay correct even
  // for non-ASCII lines.
  function byteToCharIndex(str: string, byteIndex: number): number {
    let charIdx = 0;
    let bytePos = 0;
    for (const ch of str) {
      if (bytePos >= byteIndex) break;
      bytePos += new TextEncoder().encode(ch).length;
      charIdx++;
    }
    return charIdx;
  }

  async function executeReplaceAll() {
    showReplaceModal = false;
    if (!searchQuery) return;

    const replaceOpts = {
      query: searchQuery,
      replace: replaceQuery ?? '',
      caseSensitive,
      useRegex: false,
      wholeWord,
    };

    // Target files: every result file minus the excluded ones.
    const targetPaths = results.filter(f => !excludedFiles.has(f.path)).map(f => f.path);
    if (targetPaths.length === 0) return;

    const tabs = editorStore.getTabsSnapshot();
    const openByPath = new Map<string, string>(); // path -> tabId (content loaded in memory)
    for (const t of tabs) {
      if (t.path && t.content !== null && !openByPath.has(t.path)) openByPath.set(t.path, t.id);
    }
    const activeTabId = editorStore.getActiveTabIdSnapshot();
    const activePath = tabs.find(t => t.id === activeTabId)?.path ?? null;

    const closed: string[] = [];

    for (const path of targetPaths) {
      const tabId = openByPath.get(path);
      if (tabId === undefined) {
        // Not open in memory → Rust re-reads, re-scans and atomically rewrites disk.
        closed.push(path);
      } else if (path === activePath) {
        // Live view → single CodeMirror transaction (undo-able); the editor's
        // updateListener marks it dirty and auto-saves through the normal path.
        window.dispatchEvent(new CustomEvent('editor:action', {
          detail: { action: 'replaceAll', path, options: replaceOpts }
        }));
      } else {
        editorStore.applyReplacements(path, replaceOpts);
      }
    }

    if (closed.length > 0) {
      isSearching = true;
      try {
        await streamCommand(
          'replace_all_files',
          {
            options: {
              query: replaceOpts.query,
              replace: replaceOpts.replace,
              caseSensitive,
              useRegex: false,
              wholeWord,
            },
            files: closed,
          },
          {
            onBatch: () => {},
            onDone: () => {},
          },
        );
      } catch (err) {
        console.error('Replace All (closed files) failed', err);
      }
      isSearching = false;
    }

    uiStore.addToast(
      `Replace All complete`,
      'success',
      `${targetPaths.length} file(s), ${closed.length} written on disk, ${targetPaths.length - closed.length} open in editor.`,
    );

    searchQuery = '';
    replaceQuery = '';
    results = [];
    filesScanned = 0;
    matchesFound = 0;
  }

  onDestroy(() => {
    if (currentCancelToken) {
      invoke('cancel_search', { token: currentCancelToken }).catch(() => {});
      currentCancelToken = null;
    }
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

  async function handleResultClick(path: string, res?: SearchLineMatch) {
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
        let startCol = res.text.toLowerCase().indexOf(searchQuery.toLowerCase());
        let endCol = startCol >= 0 ? startCol + searchQuery.length : startCol + 1;
        if (res.end > res.start) {
          const s = byteToCharIndex(res.text, res.start);
          const e = byteToCharIndex(res.text, res.end);
          if (e > s) { startCol = s; endCol = e; }
        }
        const col = Math.max(startCol, 0) + 1;
        const endColPos = Math.max(endCol, startCol) + 1;
        
        editorStore.updateCursor(path, res.line, col, endColPos);
        
        window.dispatchEvent(new CustomEvent('editor:action', {
          detail: { action: 'goto', line: res.line, column: col, endColumn: endColPos }
        }));
      }
    } catch (err) { console.error("Failed to open file from search", err); }
  }
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
          <input id="global-search-input" type="text" placeholder="Search" bind:value={searchQuery} onkeydown={handleKeydown} class="flex-1 bg-transparent text-sm outline-none min-w-0 placeholder-muted" />
          <Tooltip content="Match Case" wrapperClass="shrink-0 flex items-center">
            <button aria-label="Match Case" class="p-0.5 rounded cursor-pointer transition-colors text-icon-default hover:text-icon-active hover:bg-hover {caseSensitive ? 'text-accent' : ''}" onclick={() => caseSensitive = !caseSensitive}>
              <CaseSensitive size={14} />
            </button>
          </Tooltip>
          <Tooltip content="Match Whole Word" wrapperClass="shrink-0 flex items-center ml-0.5">
            <button aria-label="Match Whole Word" class="p-0.5 rounded cursor-pointer transition-colors text-icon-default hover:text-icon-active hover:bg-hover {wholeWord ? 'text-accent' : ''}" onclick={() => wholeWord = !wholeWord}>
              <WholeWord size={14} />
            </button>
          </Tooltip>
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
      <div class="text-xs px-6 pb-1 text-muted">{matchesFound} results in {fileCount} files</div>
      <VirtualList items={displayRows} itemHeight={24} getKey={(row) => row.key}>
        {#snippet item({ item })}
          {#if item.type === 'file'}
            {@const Icon = ICON_MAP[item.path.split('.').pop()?.toLowerCase() || ''] || File}
            {@const isCollapsed = collapsedFiles.has(item.path)}
            <div class="flex items-center gap-1.5 px-2 h-6 cursor-pointer select-none group w-full overflow-hidden hover:bg-hover transition-colors {item.excluded ? 'opacity-40' : ''}" role="treeitem" tabindex="0" aria-expanded={!isCollapsed} aria-selected="false" onclick={(e) => toggleFileCollapse(item.path, e)} onkeydown={(e) => { if (e.key === 'Enter') toggleFileCollapse(item.path, e); }}>
              <span class="shrink-0 text-muted transition-transform {isCollapsed ? '-rotate-90' : ''}">
                <ChevronDown size={14} />
              </span>
              <span class="shrink-0 text-accent">
                <Icon size={14} />
              </span>
              <Tooltip content={item.path} wrapperClass="truncate min-w-0 flex-1 flex items-center" followCursor={true} hoverDelay={2000}>
                <span class="text-xs truncate min-w-0 font-medium">{item.path.split(/[\/\\]/).pop()}</span>
              </Tooltip>
              <span class="text-[10px] px-1 rounded-full shrink-0 bg-surface text-muted">{item.matchCount}</span>
              <button aria-label={item.excluded ? "Include file" : "Exclude file"} class="shrink-0 p-0.5 rounded text-icon-default opacity-0 group-hover:opacity-100 hover:text-icon-active hover:bg-hover transition-all" onclick={(e) => toggleExclude(item.path, e)}>
                <X size={12} />
              </button>
            </div>
          {:else}
            {@const res = item.res!}
            {@const isContext = !!res.isContext}
            <Tooltip content={res.text.trim()} wrapperClass="w-full block" followCursor={true} hoverDelay={2000}>
              <div class="flex items-start gap-2 pl-8 pr-2 h-6 py-[3px] cursor-pointer text-xs group text-secondary hover:text-primary hover:bg-hover transition-colors overflow-hidden {isContext ? 'opacity-60' : ''}" role="option" tabindex="0" aria-selected="false" onclick={() => handleResultClick(item.path, res)} onkeydown={(e) => { if (e.key === 'Enter') handleResultClick(item.path, res); }}>
                <span class="shrink-0 w-8 text-right select-none opacity-50 text-muted">{res.line}</span>
                <span class="truncate flex-1 group-hover:text-primary font-mono text-[11px] mt-[1px]">
                  {#if isContext}
                    {res.text.trim()}
                  {:else}
                    {#each highlightMatches(res.text.trim(), searchQuery) as part}
                      {#if part.isMatch}
                        <span class="border border-accent bg-accent/20 text-accent rounded-[2px] px-[1px]">{part.text}</span>
                      {:else}
                        {part.text}
                      {/if}
                    {/each}
                  {/if}
                </span>
              </div>
            </Tooltip>
          {/if}
        {/snippet}
      </VirtualList>
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
    <p class="text-xs text-muted">This will replace {matchesFound} matches across {fileCount} files. Hover a file and press <span class="font-mono">X</span> to exclude it from the operation.</p>
  </div>
  {#snippet footer()}
    <div class="flex justify-end gap-2 w-full">
      <button class="px-3 py-1.5 text-sm rounded hover:bg-hover transition-colors" onclick={() => showReplaceModal = false}>Cancel</button>
      <button class="px-3 py-1.5 text-sm rounded bg-accent text-on-accent hover:bg-accent/90 transition-colors" onclick={executeReplaceAll}>Yes, Replace it</button>
    </div>
  {/snippet}
</Modal>
