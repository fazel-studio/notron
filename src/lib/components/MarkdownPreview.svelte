<script lang="ts">
  import { marked } from 'marked';
  import { editorStore } from '../stores/editor';
  import { themeStore } from '../stores/theme';
  
  let isDark = $derived($themeStore.isDark);
  
  let { path }: { path: string } = $props();

  
  const tabs = editorStore.tabs;

  let content = $derived(
    $tabs.find(t => t.path === path && t.language !== 'markdown-preview')?.content || $tabs.find(t => t.path === path)?.content || ''
  );

  let html = $derived.by(() => {
    if (!content) return '';
    return marked.parse(content) as string;
  });

  // Lazy load mermaid only when content contains mermaid code blocks (Bagian 17.1)
  $effect(() => {
    if (!content || !content.includes('```mermaid')) return;
    import('mermaid').then(({ default: mermaid }) => {
      mermaid.initialize({ theme: isDark ? 'dark' : 'default', startOnLoad: false, securityLevel: 'loose' });
      requestAnimationFrame(() => {
        try { mermaid.run({ nodes: document.querySelectorAll('.mermaid') }); }
        catch (e) { console.error('Mermaid error', e); }
      });
    });
  });
</script>

<div class="w-full h-full p-6 overflow-y-auto prose max-w-none bg-canvas text-primary" class:prose-invert={isDark} role="document">
  {#if html}
    {@html html}
  {/if}
</div>