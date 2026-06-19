<script lang="ts">
    import { Fzf } from 'fzf';

  interface Command {
    id: string;
    name: string;
    shortcut?: string;
    action: () => void;
  }

  let { isOpen, commands, onClose }: { isOpen: boolean; commands: Command[]; onClose: () => void } = $props();

  let query = $state('');
  let selectedIndex = $state(0);
  let inputEl: HTMLInputElement | undefined = $state();
  const MAX_RESULTS = 15;



  // Use fzf for fuzzy search 
  let filteredCommands = $derived.by(() => {
    if (!query.trim()) return commands.slice(0, MAX_RESULTS);
    const fuzzy = new Fzf(commands, {
      selector: (item: Command) => item.name,
    });
    const results = fuzzy.find(query);
    return results.slice(0, MAX_RESULTS).map((r: any) => r.item);
  });

  function handleSelect(cmd: Command) {
    cmd.action();
    onClose();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!isOpen) return;
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); selectedIndex = (selectedIndex + 1) % filteredCommands.length; }
    if (e.key === 'ArrowUp') { e.preventDefault(); selectedIndex = (selectedIndex - 1 + filteredCommands.length) % filteredCommands.length; }
    if (e.key === 'Enter') { e.preventDefault(); if (filteredCommands[selectedIndex]) handleSelect(filteredCommands[selectedIndex]); }
  }

  $effect(() => {
    if (isOpen) {
      query = '';
      selectedIndex = 0;
      requestAnimationFrame(() => inputEl?.focus());
    }
  });
</script>

<svelte:window onkeydown={handleKeydown} />

{#if isOpen}
  <div class="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-black/50 backdrop-blur-sm" role="presentation" onclick={onClose} onkeydown={(e) => { if (e.key === 'Escape') onClose(); }}>
    <div
      role="presentation"
      class="w-full max-w-lg rounded-xl shadow-2xl overflow-hidden border bg-surface border-subtle text-primary"
      onclick={(e) => e.stopPropagation()}
    >
      <div class="flex items-center px-4 py-3 border-b border-subtle">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-icon-default"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        <input
          bind:this={inputEl}
          class="flex-1 bg-transparent border-none outline-none px-3 text-sm text-primary placeholder-muted"
          placeholder="Type a command or search..."
          bind:value={query}
          oninput={() => selectedIndex = 0}
        />
      </div>
      <div class="max-h-80 overflow-y-auto py-2">
        {#if filteredCommands.length === 0}
          <div class="px-4 py-3 text-sm text-center text-muted">No commands found</div>
        {:else}
          {#each filteredCommands as cmd, i (cmd.id)}
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
              <span class="text-sm">{cmd.name}</span>
              {#if cmd.shortcut}
                  <kbd class="text-xs px-2 py-0.5 rounded bg-surface-2 text-muted">{cmd.shortcut}</kbd>
              {/if}
            </div>
          {/each}
        {/if}
      </div>
    </div>
  </div>
{/if}