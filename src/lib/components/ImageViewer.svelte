<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  
  let { filePath }: { filePath: string } = $props();


  let src = $state('');
  let zoom = $state(1);
  let loading = $state(true);

  $effect(() => {
    let cancelled = false;
    let url: string | null = null;
    if (filePath) {
      loading = true;
      invoke<number[]>('read_file_binary', { path: filePath })
        .then((bytes) => {
          if (cancelled) return;
          const uint8Array = new Uint8Array(bytes);
          const ext = filePath.split('.').pop()?.toLowerCase();
          let mimeType = 'image/png';
          if (ext === 'jpg' || ext === 'jpeg') mimeType = 'image/jpeg';
          else if (ext === 'gif') mimeType = 'image/gif';
          else if (ext === 'webp') mimeType = 'image/webp';
          else if (ext === 'svg') mimeType = 'image/svg+xml';
          else if (ext === 'ico') mimeType = 'image/x-icon';
          const blob = new Blob([uint8Array], { type: mimeType });
          url = URL.createObjectURL(blob);
          src = url;
          loading = false;
        })
        .catch((err) => { if (!cancelled) { console.error(err); loading = false; } });
    }
    return () => {
      cancelled = true;
      if (url) { URL.revokeObjectURL(url); url = null; }
    };
  });

  function handleZoomIn() { zoom = Math.min(zoom + 0.25, 5); }
  function handleZoomOut() { zoom = Math.max(zoom - 0.25, 0.25); }
  function handleResetZoom() { zoom = 1; }
</script>

<div class="w-full h-full flex flex-col bg-canvas text-primary">
  <div class="h-10 flex items-center justify-center gap-2 px-4 border-b shrink-0 bg-surface border-subtle">
    <button onclick={handleZoomOut} class="p-1.5 rounded transition-colors text-icon-default hover:text-icon-active hover:bg-hover" title="Zoom Out">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
    </button>
    <span class="text-xs min-w-12 text-center text-muted">{Math.round(zoom * 100)}%</span>
    <button onclick={handleZoomIn} class="p-1.5 rounded transition-colors text-icon-default hover:text-icon-active hover:bg-hover" title="Zoom In">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
    </button>
    <div class="w-px h-4 mx-2 bg-subtle"></div>
    <button onclick={handleResetZoom} class="p-1.5 rounded transition-colors text-icon-default hover:text-icon-active hover:bg-hover" title="Reset Zoom">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
    </button>
  </div>
  <div class="flex-1 overflow-auto flex items-center justify-center p-4">
    {#if loading}
      <span class="text-muted">Loading image...</span>
    {:else if src}
      <img src={src} alt="viewer" style="transform: scale({zoom}); transform-origin: center center; transition: transform 0.2s ease-in-out" class="max-w-none" />
    {:else}
      <span class="text-muted">Failed to load image.</span>
    {/if}
  </div>
</div>
