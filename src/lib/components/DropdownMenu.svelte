<script lang="ts">
  import type { Snippet } from 'svelte';
  
  export interface DropdownMenuItem {
    id?: string;
    label: string;
    action: () => void;
    disabled?: boolean;
    shortcut?: string;
    separator?: boolean;
  }

  let { 
    items, 
    trigger,
    align = 'left'
  }: { 
    items: DropdownMenuItem[], 
    trigger: Snippet,
    align?: 'left' | 'right'
  } = $props();

  let open = $state(false);

  function toggle(e: MouseEvent) {
    e.stopPropagation();
    open = !open;
  }

  function close() {
    open = false;
  }

  function handleItemAction(item: DropdownMenuItem) {
    if (!item.disabled) {
      item.action();
    }
    open = false;
  }
</script>

<div class="relative inline-block text-left">
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div onclick={toggle} class="h-full flex items-center cursor-pointer">
    {@render trigger()}
  </div>

  {#if open}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="fixed inset-0 z-[99]"
      role="presentation"
      onclick={close}
      oncontextmenu={(e) => { e.preventDefault(); close(); }}
      onkeydown={(e) => { if (e.key === 'Escape') close(); }}
    ></div>
    
    <div
      class="absolute top-full mt-1 min-w-[160px] rounded-md border p-1 shadow-md z-[100] animate-in fade-in duration-100 bg-surface-2 border-subtle text-primary {align === 'right' ? 'right-0' : 'left-0'}"
    >
      {#each items as item (item.id || item.label)}
        {#if item.separator}
          <div class="h-px my-1 bg-subtle"></div>
        {:else}
          <button
            class="flex items-center justify-between w-full px-2 py-1.5 text-xs rounded-sm cursor-pointer select-none outline-none transition-colors {!item.disabled ? 'hover:bg-selected focus:bg-selected hover:text-primary focus:text-primary text-secondary' : 'text-muted'}"
            disabled={item.disabled}
            onclick={() => handleItemAction(item)}
            onmouseenter={(e) => (e.target as HTMLElement).focus()}
          >
            <span>{item.label}</span>
            {#if item.shortcut}
              <span class="ml-auto text-[10px] text-muted opacity-80">{item.shortcut}</span>
            {/if}
          </button>
        {/if}
      {/each}
    </div>
  {/if}
</div>
