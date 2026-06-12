<script lang="ts">
    import { uiStore } from '../stores/ui';
  import { editorStore } from '../stores/editor';
  import { invoke } from '@tauri-apps/api/core';
  import { 
    Replace, ChevronDown, ChevronRight, X, 
    File, FileCode, FileJson, FileText, Image, Settings, Globe, Hash, Loader2 
  } from 'lucide-svelte';

  const ICON_MAP: Record<string, any> = {
    ts: FileCode, tsx: FileCode, js: FileCode, jsx: FileCode,
    rs: FileCode, py: FileCode, go: FileCode,
    html: Globe, css: Hash, json: FileJson,
    md: FileText, svg: Image, png: Image, jpg: Image,
    toml: Settings, yaml: Settings, yml: Settings,
  };

  interface SearchResult { path: string; line: number; text: string; }



  let isReplaceVisible = $state(false);
  let searchQuery = $state('');
  let replaceQuery = $state('');
  let results = $state<SearchResult[]>([]);
  let isSearching = $state(false);
  let filesScanned = $state(0);
  let matchesFound = $state(0);
  const ui = uiStore;

  let debounceTimer: number | undefined;
  let searchVersion = 0;

  // Debounced search with streaming (Bagian 6.2 - Streaming Hasil)
  $effect(() => {
    clearTimeout(debounceTimer);
    if (searchQuery.trim().length > 0 && $ui.explorerRoot) {
      debounceTimer = setTimeout(performSearch, 500);
    } else {
      results = [];
      filesScanned = 0;
      matchesFound = 0;
    }
    return () => clearTimeout(debounceTimer);
  });

  async function performSearch() {
    const currentVersion = ++searchVersion;
    if (isSearching) {
      try { await invoke('cancel_search'); } catch {}
    }
    isSearching = true;
    results = [];
    filesScanned = 0;
    matchesFound = 0;

    try {
      let allResults: SearchResult[] = [];
      let batch = 0;


      // Streaming: receive results in batches every 20 matches or 50ms (Bagian 6.2)
      while (batch < 100) {
        if (currentVersion !== searchVersion) break;
        const res = await invoke<{ results: SearchResult[]; total_scanned: number }>('search_in_files_stream', {
          root: $ui.explorerRoot,
          pattern: searchQuery,
          batchSize: 20,
        });

        if (currentVersion !== searchVersion) break;
        if (res && res.results) {
          allResults = [...allResults, ...res.results];
          matchesFound = allResults.length;
          filesScanned = res.total_scanned || 0;

          // Update results incrementally for user feedback (Bagian 6.2)
          results = [...allResults];
        }

        if (!res || !res.results || res.results.length < 20) break;
        batch++;

        // Yield to UI thread every batch
        await new Promise(r => setTimeout(r, 0));
      }

      if (currentVersion === searchVersion) {
        results = allResults;
      }
    } catch (err) {
      if (currentVersion === searchVersion) {
        console.error(err);
        results = [];
      }
    } finally {
      if (currentVersion === searchVersion) {
        isSearching = false;
      }
    }
  }

  function handleCancel() {
    invoke('cancel_search').catch(console.error);
    searchVersion++;
    isSearching = false;
  }

  async function handleResultClick(path: string) {
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
          <input type="text" placeholder="Search" bind:value={searchQuery} class="flex-1 bg-transparent text-sm outline-none min-w-0 placeholder-muted" />
          {#if isSearching}
            <button aria-label="Cancel search" onclick={handleCancel} class="p-0.5 rounded cursor-pointer shrink-0 ml-1 text-icon-default hover:text-icon-active hover:bg-hover transition-colors">
              <X size={14} />
            </button>
          {/if}
        </div>
        {#if isReplaceVisible}
        <div class="flex items-center flex-1 border rounded px-1.5 py-1 border-subtle bg-canvas focus-within:border-focus">
            <input type="text" placeholder="Replace" bind:value={replaceQuery} class="flex-1 bg-transparent text-sm outline-none min-w-0 placeholder-muted" />
            <button aria-label="Replace All" class="ml-1 p-0.5 rounded cursor-pointer transition-colors shrink-0 text-icon-default hover:text-icon-active hover:bg-hover">
              <Replace size={14} />
            </button>
          </div>
        {/if}
      </div>
    </div>
  </div>
  <div class="flex-1 overflow-y-auto mt-2 text-sm">
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
              <div class="flex flex-col mb-1">
                <div class="flex items-center gap-1.5 px-2 py-1 cursor-pointer select-none group w-full overflow-hidden hover:bg-hover transition-colors" role="treeitem" tabindex="0" aria-selected={false} onclick={() => handleResultClick(path)} onkeydown={(e) => { if (e.key === 'Enter') handleResultClick(path); }}>
                  <span class="shrink-0 text-muted">
                    <ChevronDown size={14} />
                  </span>
                  <span class="shrink-0 text-accent">
                    <Icon size={14} />
                  </span>
                  <span class="text-xs truncate min-w-0 font-medium" title={path}>{path.split(/[\/\\]/).pop()}</span>
                  <span class="text-[10px] px-1 rounded-full shrink-0 bg-surface text-muted">{pathResults.length}</span>
                </div>
            <div class="flex flex-col">
              {#each pathResults as res, i (i)}
                <div class="flex items-start gap-2 pl-8 pr-2 py-0.5 cursor-pointer text-xs group text-secondary hover:text-primary hover:bg-hover transition-colors" role="option" tabindex="0" aria-selected={false} onclick={() => handleResultClick(path)} onkeydown={(e) => { if (e.key === 'Enter') handleResultClick(path); }} title={res.text.trim()}>
                  <span class="shrink-0 w-8 text-right select-none opacity-50 text-muted">{res.line}</span>
                  <span class="truncate flex-1 group-hover:text-primary font-mono text-[11px] mt-[1px]">
                    {res.text.trim()}
                  </span>
                </div>
              {/each}
            </div>
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