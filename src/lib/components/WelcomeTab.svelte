<script lang="ts">
  import { uiStore } from '../stores/ui';
  import { editorStore } from '../stores/editor';
  import { invoke } from '@tauri-apps/api/core';
  import { open } from '@tauri-apps/plugin-dialog';
  import { exists } from '@tauri-apps/plugin-fs';

  const ui = uiStore;

  async function handleOpenRecent(path: string) {
    try {
      const doesExist = await exists(path);
      if (!doesExist) { alert(`Path not found: ${path}`); return; }
      window.dispatchEvent(new CustomEvent('request-workspace-switch', { detail: { path } }));
    } catch (err) { alert(`Failed to load folder: ${err}`); }
  }

  function handleNewFile() { uiStore.openNewFileDialog('welcome'); }

  async function handleOpenFile() {
    try {
      const selected = await open({ multiple: false });
      if (selected && typeof selected === 'string') {
        const fileName = selected.split(/[/\\]/).pop() || 'Unknown';
        let content = '';
        const isImage = /\.(png|jpe?g|gif|webp|svg|ico)$/i.test(fileName);
        if (!isImage) {
          try {
            content = await invoke<string>('read_file_text', { path: selected });
          } catch (e) {
            if (String(e) === '__BINARY__') content = '';
            else throw e;
          }
        }
        editorStore.addTab({
          id: `tab-${Date.now()}`, path: selected, name: fileName, content,
          language: isImage ? 'image' : await invoke<string>('detect_language', { path: selected }),
          isPreview: false
        });
      }
    } catch (err) { console.error(err); }
  }

  async function handleOpenFolder() {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (selected && typeof selected === 'string') {
        if (!$ui.recentWorkspaces.includes(selected)) {
          uiStore.setPendingTrustPath(selected);
        } else {
          window.dispatchEvent(new CustomEvent('request-workspace-switch', { detail: { path: selected } }));
        }
      }
    } catch (err) { console.error(err); }
  }

  let displayedRecent = $derived($ui.recentWorkspaces.slice(0, 5));
  let hasMore = $derived($ui.recentWorkspaces.length > 5);
</script>

<div class="flex-1 flex flex-col items-center justify-center h-full w-full bg-transparent overflow-y-auto p-8">
  <div class="max-w-2xl w-full">
    <div class="flex items-center gap-4 mb-12 select-none">
      <img src="/notron.png" alt="Notron" class="w-16 h-16 pointer-events-none" />
      <h1 class="text-4xl font-semibold opacity-90">Notron</h1>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-12">
      <div class="space-y-6">
        <h2 class="text-sm font-semibold opacity-60 uppercase tracking-wider mb-4">Start</h2>
        <button onclick={handleNewFile} class="flex items-center gap-3 w-full text-left opacity-80 hover:opacity-100 transition-opacity p-2 rounded hover:bg-hover">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-accent"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          <span>New File</span>
        </button>
        <button onclick={handleOpenFile} class="flex items-center gap-3 w-full text-left opacity-80 hover:opacity-100 transition-opacity p-2 rounded hover:bg-hover">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-accent"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
          <span>Open File...</span>
        </button>
        <button onclick={handleOpenFolder} class="flex items-center gap-3 w-full text-left opacity-80 hover:opacity-100 transition-opacity p-2 rounded hover:bg-hover">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-accent"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>
          <span>Open Folder...</span>
        </button>
      </div>
      <div class="space-y-6">
        <h2 class="text-sm font-semibold opacity-60 uppercase tracking-wider mb-4">Recent</h2>
        {#if displayedRecent.length === 0}
          <p class="text-sm opacity-50 p-2">No recent folders</p>
        {:else}
          <div class="flex flex-col">
            {#each displayedRecent as path (path)}
              <button onclick={() => handleOpenRecent(path)} class="flex flex-col items-start w-full text-left opacity-80 hover:opacity-100 transition-opacity p-2 rounded hover:bg-hover">
                <span class="font-medium truncate w-full">{path.split(/[/\\]/).pop()}</span>
                <span class="text-xs opacity-50 truncate w-full">{path}</span>
              </button>
            {/each}
            {#if hasMore}
              <button onclick={() => uiStore.openRecentFoldersModal()} class="flex items-center gap-2 w-full text-left text-accent opacity-80 hover:opacity-100 transition-opacity p-2 rounded hover:bg-hover mt-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                <span>More Recent...</span>
              </button>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </div>

</div>
