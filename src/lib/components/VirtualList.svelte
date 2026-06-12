<script lang="ts">
  /**
   * VirtualList.svelte — Section 3.2: UI Virtualization (Virtual List Engine)
   *
   * Renders only the visible slice of a flat array with an overscan buffer.
   * Item height MUST be constant (ITEM_HEIGHT) for accurate position calculation.
   *
   * Section 3.2 Principles:
   *  - Fixed item height (22px default) for O(1) position calculation without DOM measurement
   *  - startIndex / endIndex calculated from scrollTop and container height
   *  - Only slice flatList[startIndex..endIndex] + OVERSCAN buffer rendered
   *  - Single spacer div at totalItems * ITEM_HEIGHT for accurate scrollbar
   *  - Items positioned with translateY(startIndex * ITEM_HEIGHT)
   *  - NEVER render all nodes, even for only 200 items
   */

  import type { Snippet } from 'svelte';

  interface Props<T> {
    items: T[];
    itemHeight?: number;
    overscan?: number;
    class?: string;
    item: Snippet<[{ item: T; index: number }]>;
  }

  let {
    items,
    itemHeight = 22,
    overscan = 5,
    class: className = '',
    item: itemSnippet,
  }: Props<any> = $props();

  let containerEl: HTMLDivElement;
  let scrollTop = $state(0);
  let containerHeight = $state(0);

  // Derived virtual window calculations
  let startIndex = $derived(
    Math.max(0, Math.floor(scrollTop / itemHeight) - overscan)
  );
  let endIndex = $derived(
    Math.min(
      items.length - 1,
      Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan
    )
  );

  let totalHeight = $derived(items.length * itemHeight);
  let offsetY = $derived(startIndex * itemHeight);
  let visibleItems = $derived(items.slice(startIndex, endIndex + 1));

  function handleScroll(e: Event) {
    scrollTop = (e.target as HTMLDivElement).scrollTop;
  }

  // Use ResizeObserver for container height (avoids layout thrashing)
  $effect(() => {
    if (!containerEl) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        containerHeight = entry.contentRect.height;
      }
    });
    ro.observe(containerEl);
    containerHeight = containerEl.clientHeight;
    return () => ro.disconnect();
  });
</script>

<div
  bind:this={containerEl}
  class="overflow-y-auto overflow-x-hidden h-full outline-none {className}"
  role="presentation"
  onscroll={handleScroll}
>
  <!-- Spacer that creates accurate scrollbar height -->
  <div style="height: {totalHeight}px; position: relative;">
    <!-- Only render visible slice, offset with translateY -->
    <div style="transform: translateY({offsetY}px);">
      {#each visibleItems as item, i (item.path ?? i)}
        <div style="height: {itemHeight}px;">
          {@render itemSnippet({ item, index: startIndex + i })}
        </div>
      {/each}
    </div>
  </div>
</div>
