<script lang="ts">
    
  let { content, side = 'top', wrapperClass = '', children }: { content: string; side?: 'top' | 'bottom' | 'left' | 'right'; wrapperClass?: string; children: import('svelte').Snippet } = $props();
  let visible = $state(false);
  let coords = $state({ x: 0, y: 0 });
  
  function handleMouseEnter(e: MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (side === 'top') {
      coords = { x: rect.left + rect.width / 2, y: rect.top - 4 };
    } else if (side === 'bottom') {
      coords = { x: rect.left + rect.width / 2, y: rect.bottom + 4 };
    } else if (side === 'left') {
      coords = { x: rect.left - 4, y: rect.top + rect.height / 2 };
    } else if (side === 'right') {
      coords = { x: rect.right + 4, y: rect.top + rect.height / 2 };
    }
    visible = true;
  }

  let positionClass = $derived.by(() => {
    const classes: string[] = ['fixed', 'z-[9999]', 'px-2', 'py-1', 'text-[10px]', 'rounded', 'shadow-xl', 'whitespace-nowrap', 'pointer-events-none'];
    if (side === 'bottom') classes.push('-translate-x-1/2');
    else if (side === 'top') classes.push('-translate-x-1/2', '-translate-y-full');
    else if (side === 'left') classes.push('-translate-x-full', '-translate-y-1/2');
    else if (side === 'right') classes.push('-translate-y-1/2');
    return classes.join(' ');
  });
</script>

<div class="relative inline-flex {wrapperClass}" role="presentation" onmouseenter={handleMouseEnter} onmouseleave={() => visible = false}>
  {@render children()}
  {#if visible}
    <div class="{positionClass} bg-surface-2 border border-subtle text-primary" style="left: {coords.x}px; top: {coords.y}px;">
      {content}
    </div>
  {/if}
</div>
