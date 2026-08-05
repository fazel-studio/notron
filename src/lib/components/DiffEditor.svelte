<script module>
  import { EditorState } from '@codemirror/state';
  import { EditorView, lineNumbers, highlightSpecialChars } from '@codemirror/view';
  import { keymap } from '@codemirror/view';
  import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
  import { MergeView } from '@codemirror/merge';
  import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from '@codemirror/language';
  import { oneDark } from '@codemirror/theme-one-dark';
  import { closeBrackets } from '@codemirror/autocomplete';

  const basicExtensions = [
    lineNumbers(),
    highlightSpecialChars(),
    history(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    bracketMatching(),
    closeBrackets(),
    keymap.of([
      ...defaultKeymap,
      ...historyKeymap,
    ])
  ];
</script>

<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { themeStore } from '../stores/theme';

  let { originalContent, currentContent, filePath }: { originalContent: string, currentContent: string, filePath: string } = $props();

  let diffContainer: HTMLDivElement;
  let mergeView: MergeView | null = $state(null);
  let isDark = $derived($themeStore.isDark);

  const baseTheme = EditorView.theme({
    "&": { backgroundColor: "transparent !important", height: "100%" },
    ".cm-gutters": { backgroundColor: "var(--bg-canvas) !important", borderRight: "1px solid var(--border-subtle) !important", paddingLeft: "12px !important", paddingRight: "0px !important" },
    ".cm-scroller": { overflow: "auto !important", overscrollBehaviorX: "none !important" },
    ".cm-mergeView": { overflow: "hidden", height: "100%", width: "100%", display: "flex", flexDirection: "column" },
    ".cm-mergeViewEditors": { flex: "1 1 auto", display: "flex", height: "100%", overflow: "hidden" },
    ".cm-mergeViewEditor": { flex: "1 1 50%", overflow: "hidden", display: "flex", flexDirection: "column" }
  });

  async function loadLanguage() {
    const { getLanguageExtension } = await import('../utils/languageDetector');
    return await getLanguageExtension(filePath);
  }

  onMount(async () => {
    const langExt = await loadLanguage();
    
    let themeExt = isDark || $themeStore.theme === 'black' ? oneDark : [];
    
    const extensions = [
      ...basicExtensions,
      baseTheme,
      themeExt,
      langExt,
      EditorState.readOnly.of(true) // diff views are typically read-only
    ];

    mergeView = new MergeView({
      a: {
        doc: originalContent || "",
        extensions: extensions
      },
      b: {
        doc: currentContent || "",
        extensions: extensions
      },
      parent: diffContainer,
      orientation: "a-b" // side-by-side
    });
  });

  onDestroy(() => {
    if (mergeView) {
      mergeView.destroy();
    }
  });
</script>

<div class="h-full w-full flex flex-col bg-canvas text-primary relative" bind:this={diffContainer} style="height: 100%;">
  <div class="h-8 shrink-0 flex items-center border-b border-subtle px-4 bg-surface-2 text-xs text-muted justify-between">
    <div class="flex-1 text-center font-mono">Original (HEAD)</div>
    <div class="flex-1 text-center font-mono border-l border-subtle">Working Tree</div>
  </div>
</div>

<style>
  :global(.cm-mergeView) {
    height: 100%;
    width: 100%;
  }
</style>
