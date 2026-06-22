<script lang="ts">
  import Modal from './Modal.svelte';
  import MultiSelect from './MultiSelect.svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { Search, File, Loader2 } from 'lucide-svelte';
  import { uiStore } from '../stores/ui';
  import { editorStore } from '../stores/editor';
  import { onMount } from 'svelte';

  let { isOpen, onClose }: { isOpen: boolean; onClose: () => void } = $props();

  let query = $state('');
  let fileQuery = $state('');
  let selectedFiles = $state<string[]>([]);
  let allFiles = $state<string[]>([]);
  
  let isSearchingContent = $state(false);
  let hasSearched = $state(false);

  interface SearchResult {
    path: string;
    line: number;
    text: string;
  }
  let contentResults = $state<SearchResult[]>([]);

  // Show up to 50 matches for performance, but the UI container scrolls if > 5.
  let fileResults = $derived(
    fileQuery.trim() === '' ? [] : allFiles.filter(f => !selectedFiles.includes(f) && f.toLowerCase().includes(fileQuery.toLowerCase())).slice(0, 50)
  );

  onMount(() => {
    const root = uiStore.getSnapshot().explorerRoot;
    if (root) {
      invoke<string[]>('list_all_files', { path: root, excludeDirs: ['node_modules', '.git', 'target', 'dist', 'build'] })
        .then(files => {
          allFiles = files.map(f => f.replace(/\\/g, '/'));
        })
        .catch(console.error);
    }
  });

  function addFile(file: string) {
    if (!selectedFiles.includes(file)) {
      selectedFiles = [...selectedFiles, file];
    }
    fileQuery = '';
    
    if (query.trim() !== '') {
      performSmartSearch();
    } else {
      hasSearched = false;
    }
  }

  function removeFile(file: string) {
    selectedFiles = selectedFiles.filter(f => f !== file);
    
    if (selectedFiles.length === 0) {
      hasSearched = false;
      contentResults = [];
    } else if (query.trim() !== '') {
      performSmartSearch();
    } else {
      hasSearched = false;
    }
  }

  async function performSmartSearch() {
    if (query.trim() === '' || selectedFiles.length === 0) return;
    
    isSearchingContent = true;
    hasSearched = true;
    contentResults = [];
    
    try {
      const filesToRead = selectedFiles;
      for (const path of filesToRead) {
        try {
          const fileData: any = await invoke('open_file', { path });
          const content: string = fileData.content;
          if (!content) continue;
          
          const lines = content.split('\n');
          const lowerQuery = query.toLowerCase();
          
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(lowerQuery)) {
              contentResults = [...contentResults, {
                path,
                line: i + 1,
                text: lines[i]
              }];
            }
          }
        } catch (err) {
          console.error("Error reading file", path, err);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      isSearchingContent = false;
    }
  }

  async function handleResultClick(res: SearchResult) {
    try {
      const name = res.path.split(/[\/\\]/).pop() || 'Unknown';
      const fileData: any = await invoke('open_file', { path: res.path });
      const language = await invoke<string>('detect_language', { path: res.path });
      
      editorStore.addTab({ id: res.path, path: res.path, name, content: fileData.content, language, isPreview: true });
      
      const queryLower = query.toLowerCase();
      const startCol = res.text.toLowerCase().indexOf(queryLower);
      const col = startCol >= 0 ? startCol + 1 : 1;
      const endCol = startCol >= 0 ? startCol + 1 + queryLower.length : col;
      
      editorStore.updateCursor(res.path, res.line, col, endCol);
      window.dispatchEvent(new CustomEvent('editor:action', {
        detail: { action: 'goto', line: res.line, column: col, endColumn: endCol }
      }));
      onClose();
    } catch (err) {
      console.error(err);
    }
  }

  function highlightMatches(text: string, q: string) {
    if (!q) return [{ text, isMatch: false }];
    let lowerText = text.toLowerCase();
    const lowerQuery = q.toLowerCase();
    
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
      parts.push({ text: text.substring(idx, idx + q.length), isMatch: true });
      start = idx + q.length;
      idx = lowerText.indexOf(lowerQuery, start);
    }
    if (start < text.length) parts.push({ text: text.substring(start), isMatch: false });
    return parts;
  }
</script>

<Modal {isOpen} title="Smart Search" {onClose} widthClass="max-w-2xl" heightClass="h-[750px]">
  <div class="p-4 flex flex-col gap-4 text-primary h-full">
    <!-- Query Input -->
    <div class="flex flex-col gap-1.5">
      <label for="smart-search-query" class="text-xs font-semibold text-secondary">Search Query</label>
      <div class="flex items-center border rounded px-2 py-1.5 border-subtle bg-canvas focus-within:border-focus transition-colors">
        <Search size={14} class="text-muted mr-2" />
        <input id="smart-search-query" type="text" bind:value={query} oninput={() => hasSearched = false} onkeydown={(e) => e.key === 'Enter' && performSmartSearch()} placeholder="Enter search term..." class="flex-1 bg-transparent text-sm outline-none placeholder-muted" />
      </div>
    </div>

    <!-- File Input -->
    <div class="flex flex-col gap-1.5 relative">
      <label for="smart-search-file" class="text-xs font-semibold text-secondary">Search in specific files</label>
      <MultiSelect 
        id="smart-search-file"
        placeholder="Type to add files..."
        bind:query={fileQuery}
        bind:selected={selectedFiles}
        options={fileResults}
        Icon={File}
        onselect={addFile}
        onremove={removeFile}
      />
    </div>
    
    <!-- Results -->
    <div class="flex-1 flex flex-col min-h-0 mt-4">
      {#if isSearchingContent}
        <div class="flex-1 flex flex-col items-center justify-center text-muted gap-2">
          <Loader2 size={24} class="animate-spin text-accent" />
          <span class="text-sm">Searching...</span>
        </div>
      {:else if hasSearched}
        {#if contentResults.length > 0}
          <div class="flex flex-col h-full">
            <h3 class="text-xs font-semibold text-secondary flex items-center justify-between shrink-0 mb-2">
              <span>Results ({contentResults.length})</span>
            </h3>
            <div class="flex-1 flex flex-col border border-subtle rounded bg-canvas overflow-y-auto">
              {#each contentResults as res}
                <button onclick={() => handleResultClick(res)} class="flex items-start gap-2 px-3 py-2 h-[46px] text-left hover:bg-hover border-b border-subtle/50 last:border-0 transition-colors group shrink-0">
                  <div class="flex flex-col flex-1 min-w-0">
                    <div class="flex items-center justify-between gap-2">
                      <span class="text-xs font-medium text-primary truncate">{res.path.split('/').pop()}</span>
                      <span class="text-[10px] text-muted opacity-60">Line {res.line}</span>
                    </div>
                    <span class="text-[11px] font-mono text-secondary truncate mt-0.5 group-hover:text-primary transition-colors">
                      {#each highlightMatches(res.text.trim(), query) as part}
                        {#if part.isMatch}
                          <span class="border border-accent bg-accent/20 text-accent rounded-[2px] px-[1px]">{part.text}</span>
                        {:else}
                          {part.text}
                        {/if}
                      {/each}
                    </span>
                  </div>
                </button>
              {/each}
            </div>
          </div>
        {:else}
          <div class="px-3 py-4 text-xs text-muted text-center border border-subtle rounded bg-canvas shrink-0">
            No matches found for "{query}" in the selected files.
          </div>
        {/if}
      {/if}
    </div>
  </div>
</Modal>
