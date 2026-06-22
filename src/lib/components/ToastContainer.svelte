<script lang="ts">
  import { uiStore } from '../stores/ui';
  import { fly, fade, slide } from 'svelte/transition';

  let toasts = $derived($uiStore.toasts);
  let expandedToasts = $state<Set<string>>(new Set());

  function toggleExpand(id: string) {
    const next = new Set(expandedToasts);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expandedToasts = next;
  }
</script>

<div class="fixed bottom-4 right-4 z-[200] flex flex-col gap-2 w-80 pointer-events-none">
  {#each toasts as toast (toast.id)}
    <div 
      in:fly={{ y: 20, duration: 300 }} 
      out:fade={{ duration: 200 }}
      class="pointer-events-auto rounded-md shadow-lg border border-subtle bg-surface-2 p-3 relative flex flex-col transition-all"
    >
      <button 
        class="absolute top-2 right-2 text-icon-default hover:text-icon-active" 
        onclick={() => uiStore.removeToast(toast.id)}
        aria-label="Close"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
      
      <div class="flex items-start gap-3 mt-0.5">
        {#if toast.type === 'success'}
          <div class="text-green-500 shrink-0 mt-0.5">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
          </div>
          <div class="text-sm text-primary flex-1 break-words leading-relaxed pr-6">
            <span class="font-medium">{toast.title}</span>
            {#if toast.message}
              <div class="mt-1 opacity-80 text-xs">{toast.message}</div>
            {/if}
          </div>
        {:else}
          <div class="text-red-500 shrink-0 mt-0.5">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
          </div>
          <div class="flex-1 min-w-0 pr-6">
            {#if toast.message}
              <button 
                type="button"
                class="flex items-center gap-2 cursor-pointer group select-none w-full text-left" 
                onclick={() => toggleExpand(toast.id)}
                aria-expanded={expandedToasts.has(toast.id)}
              >
                <span class="text-sm font-medium text-primary break-words flex-1">{toast.title}</span>
                <div class="text-icon-default group-hover:text-icon-active transition-transform {expandedToasts.has(toast.id) ? 'rotate-90' : ''}" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                </div>
              </button>
              {#if expandedToasts.has(toast.id)}
                <div transition:slide={{ duration: 200 }} class="text-xs text-primary opacity-80 mt-2 bg-surface-3 p-2 rounded break-words whitespace-pre-wrap max-h-40 overflow-y-auto">
                  {toast.message}
                </div>
              {/if}
            {:else}
              <div class="text-sm font-medium text-primary break-words flex-1">{toast.title}</div>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  {/each}
</div>
