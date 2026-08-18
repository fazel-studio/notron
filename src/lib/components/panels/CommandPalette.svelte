<script lang="ts">
  import Modal from '../common/Modal.svelte';
  import { paletteStore, type PaletteItem } from '../../stores/palette';
  import { 
    FileText, Command as CmdIcon, CircleDot, Clock
  } from 'lucide-svelte';

  let { isOpen, onClose, initialQuery = '' }: { isOpen: boolean; onClose: () => void; initialQuery?: string } = $props();

  let query = $state('');
  let selectedIndex = $state(0);
  let inputEl: HTMLInputElement | undefined = $state();
  
  let filteredItems = $derived.by(() => {
    if (!$paletteStore.isLoaded) return [];
    
    let isCommandMode = query.startsWith('>');
    let actualQuery = isCommandMode ? query.slice(1).trim() : query.trim();

    let pool = $paletteStore.items.filter((i: any) => isCommandMode ? i.category === 'command' : i.category !== 'command');

    if (!actualQuery) return pool.slice(0, 15);
    if (!$paletteStore.fzfInstance) return [];

    const results = $paletteStore.fzfInstance.find(actualQuery);
    return results
      .map((r: any) => r.item)
      .filter((item: any) => isCommandMode ? item.category === 'command' : item.category !== 'command');
  });

  function handleSelect(item: PaletteItem) {
    item.action();
    onClose();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!isOpen) return;
    // Escape is handled by Modal, but let's keep arrow keys and enter
    if (e.key === 'ArrowDown') { e.preventDefault(); selectedIndex = (selectedIndex + 1) % filteredItems.length; }
    if (e.key === 'ArrowUp') { e.preventDefault(); selectedIndex = (selectedIndex - 1 + filteredItems.length) % filteredItems.length; }
    if (e.key === 'Enter') { e.preventDefault(); if (filteredItems[selectedIndex]) handleSelect(filteredItems[selectedIndex]); }
  }

  $effect(() => {
    if (isOpen) {
      query = initialQuery;
      selectedIndex = 0;
      requestAnimationFrame(() => inputEl?.focus());
    }
  });

  function getIcon(category: string) {
    switch (category) {
      case 'file': return FileText;
      case 'symbol': return CircleDot;
      case 'recent': return Clock;
      default: return CmdIcon;
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<Modal {isOpen} title="Command Palette" widthClass="max-w-xl" {onClose}>
  {#snippet children()}
    <div class="flex flex-col h-full">
      <div class="flex items-center px-4 py-3 border-b border-subtle shrink-0">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-icon-default shrink-0"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        <input
          bind:this={inputEl}
          class="flex-1 bg-transparent border-none outline-none px-3 text-sm text-primary placeholder-muted"
          placeholder="Type a command or search..."
          bind:value={query}
          oninput={() => selectedIndex = 0}
        />
      </div>
      <div class="h-[460px] overflow-y-auto py-2 scrollbar-hide flex flex-col">
        {#if !$paletteStore.isLoaded}
          <div class="px-4 py-3 text-sm text-center text-muted flex-1 flex items-center justify-center">
            <span class="flex items-center gap-2">
              <span class="inline-block w-3 h-3 rounded-full border-2 border-muted border-t-transparent animate-spin"></span>
              Loading workspace files...
            </span>
          </div>
        {:else if filteredItems.length === 0}
          <div class="px-4 py-3 text-sm text-center text-muted flex-1 flex items-center justify-center">No items found</div>
        {:else}
          {#each filteredItems as cmd, i (cmd.id)}
            {@const Icon = getIcon(cmd.category)}
            <div
              role="option"
              tabindex="0"
              aria-selected={i === selectedIndex}
              class="flex items-center justify-between px-4 py-2 cursor-pointer transition-colors"
              class:bg-selected={i === selectedIndex}
              class:text-primary={i === selectedIndex}
              class:text-secondary={i !== selectedIndex}
              onclick={() => handleSelect(cmd)}
              onkeydown={(e) => { if (e.key === 'Enter') handleSelect(cmd); }}
              onmouseenter={() => selectedIndex = i}
            >
              <div class="flex items-center gap-3 overflow-hidden">
                <span class="text-muted shrink-0">
                  <Icon size={14} />
                </span>
                <div class="flex flex-col truncate">
                  <span class="text-sm truncate">{cmd.label}</span>
                  {#if cmd.description}
                    <span class="text-[10px] text-muted truncate">{cmd.description}</span>
                  {/if}
                </div>
              </div>
              {#if cmd.shortcut}
                  <kbd class="text-xs px-2 py-0.5 rounded bg-surface-2 text-muted shrink-0">{cmd.shortcut}</kbd>
              {/if}
            </div>
          {/each}
        {/if}
      </div>
    </div>
  {/snippet}
</Modal>

<style>
  .scrollbar-hide::-webkit-scrollbar { display: none; }
  .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
</style>