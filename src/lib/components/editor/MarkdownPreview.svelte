<script lang="ts">
  import { onDestroy } from 'svelte';
  import { ChevronRight, ChevronDown } from 'lucide-svelte';
  import { editorStore } from '../../stores/editor';
  import { themeStore } from '../../stores/theme';
  import type { TocNode, RenderResult } from '../../utils/markdownRender';

  let isDark = $derived($themeStore.isDark);

  let { path }: { path: string } = $props();

  const tabs = editorStore.tabs;

  let content = $derived(
    $tabs.find(t => t.path === path && t.language !== 'markdown-preview')?.content || $tabs.find(t => t.path === path)?.content || ''
  );

  let html = $state('');
  let toc = $state<TocNode[]>([]);
  let isRendering = $state(false);
  let renderError = $state(false);

  let renderSeq = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function doRender() {
    const seq = ++renderSeq;
    const md = content;

    // Clear immediately: empty preview while rendering.
    html = '';
    toc = [];
    renderError = false;
    isRendering = true;

    // Defer the actual markdown render so the empty tab paints first
    // and the UI stays responsive (no worker = no cross-thread failures).
    timer = setTimeout(async () => {
      if (seq !== renderSeq) return;
      try {
        const { renderMarkdown } = await import('../../utils/markdownRender');
        if (seq !== renderSeq) return;
        const result: RenderResult = renderMarkdown(md);
        if (seq !== renderSeq) return;
        html = result.html;
        toc = result.toc;
        isRendering = false;
      } catch (e) {
        if (seq !== renderSeq) return;
        console.error('Markdown render error', e);
        renderError = true;
        isRendering = false;
      }
    }, 0);
  }

  $effect(() => {
    doRender();
  });

  onDestroy(() => {
    if (timer) clearTimeout(timer);
  });

  function flattenIds(nodes: TocNode[]): string[] {
    const out: string[] = [];
    for (const n of nodes) {
      out.push(n.id);
      if (n.children.length) out.push(...flattenIds(n.children));
    }
    return out;
  }

  function getMinLevel(nodes: TocNode[]): number {
    return nodes.length ? Math.min(...nodes.map(n => n.level)) : 1;
  }

  let allIds = $derived(flattenIds(toc));
  let minLevel = $derived(getMinLevel(toc));

  let collapsedIds = $state<Set<string>>(new Set());
  let activeId = $state('');
  let scrollEl: HTMLElement | null = $state(null);

  function toggle(id: string) {
    const next = new Set(collapsedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    collapsedIds = next;
  }

  function scrollTo(id: string) {
    activeId = id;
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function handleScroll() {
    if (!scrollEl) return;
    const offset = scrollEl.getBoundingClientRect().top + 80;
    let current = '';
    for (const id of allIds) {
      const el = document.getElementById(id);
      if (!el) continue;
      if (el.getBoundingClientRect().top <= offset) current = id;
      else break;
    }
    activeId = current;
  }

  $effect(() => {
    const el = scrollEl;
    if (!el) return;
    const handler = () => handleScroll();
    el.addEventListener('scroll', handler, { passive: true });
    handler();
    return () => el.removeEventListener('scroll', handler);
  });

  // Lazy load mermaid only when content contains mermaid code blocks (Bagian 17.1)
  $effect(() => {
    if (!html || !content.includes('```mermaid')) return;
    import('mermaid').then(({ default: mermaid }) => {
      mermaid.initialize({ theme: isDark ? 'dark' : 'default', startOnLoad: false, securityLevel: 'loose' });
      requestAnimationFrame(() => {
        try { mermaid.run({ nodes: document.querySelectorAll('.mermaid') }); }
        catch (e) { console.error('Mermaid error', e); }
      });
    });
  });
</script>

{#snippet tocItem(node: TocNode)}
  <div class="py-px">
    <div class="flex items-center rounded-md hover:bg-hover {activeId === node.id ? 'bg-selected/40' : ''}">
      {#if node.children.length > 0}
        <button
          class="w-5 h-5 shrink-0 flex items-center justify-center text-muted hover:text-primary rounded"
          onclick={() => toggle(node.id)}
          aria-label={collapsedIds.has(node.id) ? 'Expand section' : 'Collapse section'}
        >
          {#if collapsedIds.has(node.id)}
            <ChevronRight size={14} />
          {:else}
            <ChevronDown size={14} />
          {/if}
        </button>
      {:else}
        <span class="w-5 shrink-0"></span>
      {/if}
      <button
        class="flex-1 text-left text-[13px] leading-5 py-0.5 pr-2 truncate"
        class:text-primary={activeId === node.id}
        class:text-secondary={activeId !== node.id}
        style:padding-left={(node.level - minLevel) * 12 + 'px'}
        onclick={() => scrollTo(node.id)}
        title={node.text}
      >
        {node.text}
      </button>
    </div>
    {#if node.children.length > 0 && !collapsedIds.has(node.id)}
      <div class="ml-2 border-l border-subtle pl-1.5">
        {#each node.children as child}
          {@render tocItem(child)}
        {/each}
      </div>
    {/if}
  </div>
{/snippet}

<div class="w-full h-full flex overflow-hidden bg-canvas text-primary" role="document">
  {#if toc.length > 0}
    <aside class="w-60 shrink-0 flex flex-col border-r border-subtle bg-surface select-none">
      <div class="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted border-b border-subtle">
        Contents
      </div>
      <nav class="flex-1 overflow-y-auto hover-scrollbar py-2 px-1.5">
        {#each toc as node}
          {@render tocItem(node)}
        {/each}
      </nav>
    </aside>
  {/if}
  <div bind:this={scrollEl} class="flex-1 overflow-y-auto hover-scrollbar" onscroll={handleScroll}>
    {#if renderError}
      <div class="h-full flex items-center justify-center text-sm text-error">Failed to render preview</div>
    {:else if !isRendering && html}
      <div class="prose max-w-none px-[10%] py-8" class:prose-invert={isDark}>
        {@html html}
      </div>
    {:else}
      <div class="h-full"></div>
    {/if}
  </div>
</div>

<style>
  :global(.prose h1[id], .prose h2[id], .prose h3[id], .prose h4[id], .prose h5[id], .prose h6[id]) {
    scroll-margin-top: 24px;
  }
</style>
