<script lang="ts">
  import type { Snippet } from 'svelte';
  
  let { 
    isOpen, 
    title, 
    onClose, 
    widthClass = 'max-w-md',
    heightClass = '',
    children, 
    footer 
  }: { 
    isOpen: boolean; 
    title: string; 
    onClose: () => void; 
    widthClass?: string;
    heightClass?: string;
    children: Snippet; 
    footer?: Snippet 
  } = $props();
</script>

{#if isOpen}
  <div class="fixed inset-0 z-[200] flex items-center justify-center bg-canvas/50 backdrop-blur-sm" role="presentation">
    <div
      class="w-full {widthClass} {heightClass} rounded-lg shadow-elevated flex flex-col border bg-surface-2 border-subtle text-primary overflow-hidden"
      role="dialog"
      tabindex="0"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div class="flex items-center justify-between p-3 border-b border-subtle shrink-0">
        <h2 class="text-sm font-semibold text-primary">{title}</h2>
        <button aria-label="Close" onclick={onClose} class="text-icon-default hover:text-icon-active transition-colors">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="flex-1 overflow-y-auto">
        {@render children()}
      </div>
      {#if footer}
        <div class="p-3 border-t border-subtle bg-surface-2 shrink-0">
          {@render footer()}
        </div>
      {/if}
    </div>
  </div>
{/if}
