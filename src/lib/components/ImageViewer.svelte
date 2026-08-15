<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  
  let { filePath }: { filePath: string } = $props();

  let src = $state('');
  let zoom = $state(1);
  let loading = $state(true);
  let isCtrlPressed = $state(false);

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

  function handleZoomIn() { zoom = Math.min(zoom * 1.25, 50); }
  function handleZoomOut() { zoom = Math.max(zoom / 1.25, 0.05); }

  function handleClick() {
    if (isCtrlPressed) {
      handleZoomOut();
    } else {
      handleZoomIn();
    }
  }

  function handleWheel(e: WheelEvent) {
    if (e.ctrlKey) {
      e.preventDefault();
      if (e.deltaY < 0) {
        handleZoomIn();
      } else {
        handleZoomOut();
      }
    }
  }
</script>

<svelte:window 
  onkeydown={(e) => { if (e.key === 'Control') isCtrlPressed = true; }} 
  onkeyup={(e) => { if (e.key === 'Control') isCtrlPressed = false; }} 
  onblur={() => { isCtrlPressed = false; }}
/>

<div 
  class="w-full h-full flex items-center justify-center bg-canvas text-primary overflow-auto p-4"
  onwheel={handleWheel}
  onclick={handleClick}
  style="cursor: {isCtrlPressed ? 'zoom-out' : 'zoom-in'};"
  role="presentation"
>
  {#if loading}
    <span class="text-muted select-none">Loading image...</span>
  {:else if src}
    <img src={src} alt="viewer" style="transform: scale({zoom}); transform-origin: center center; transition: transform 0.15s ease-out; background-color: #e5e5e5; background-image: conic-gradient(#fff 90deg, transparent 90deg 180deg, #fff 180deg 270deg, transparent 270deg); background-size: 20px 20px;" class="max-w-none pointer-events-none select-none" />
  {:else}
    <span class="text-muted select-none">Failed to load image.</span>
  {/if}
</div>
