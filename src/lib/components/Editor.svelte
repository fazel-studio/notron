<script module>
  import { keymap, highlightSpecialChars, dropCursor, rectangularSelection, crosshairCursor, highlightActiveLine } from '@codemirror/view';
  import { EditorState } from '@codemirror/state';
  import { defaultKeymap, history, historyKeymap, undo, redo, selectAll, copyLineUp, copyLineDown, moveLineUp, moveLineDown } from '@codemirror/commands';
  import { searchKeymap, highlightSelectionMatches, openSearchPanel } from '@codemirror/search';
  import { bracketMatching, foldKeymap, indentOnInput, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
  import { closeBrackets, autocompletion, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
  import { EditorView } from '@codemirror/view';

  const COMMON_EXTENSIONS = [
    EditorView.theme({
      "&": { backgroundColor: "transparent !important", height: "100%" },
      ".cm-gutters": { backgroundColor: "transparent !important", border: "none" },
      ".cm-scroller": { overflow: "auto !important" }
    }),
    highlightSpecialChars(),
    history(),
    // drawSelection is removed so native CSS ::selection is used, covering only text
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    bracketMatching(),
    closeBrackets(),
    autocompletion(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    keymap.of([
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...completionKeymap,
      ...closeBracketsKeymap,
    ])
  ];

  const COMMON_EXTENSIONS_LARGE_FILE = COMMON_EXTENSIONS.filter(_e => {
    // We cannot easily compare objects directly if they return new instances,
    // but we can filter by the same logic used before by simply re-creating without the heavy ones
    return true; 
  });
</script>

<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { lineNumbers, highlightActiveLineGutter } from '@codemirror/view';
  import { foldGutter } from '@codemirror/language';
  import { Compartment } from '@codemirror/state';
  import { lintGutter } from '@codemirror/lint';
  import { oneDark } from '@codemirror/theme-one-dark';
  import { showMinimap } from '@replit/codemirror-minimap';
  import { invoke } from '@tauri-apps/api/core';
  import { settingsStore } from '../stores/settings';
  import { editorStore } from '../stores/editor';
  import { uiStore } from '../stores/ui';
  import { themeStore } from '../stores/theme';
  
  let { tabId, content, filePath }: { tabId: string; content: string; filePath: string } = $props();

  let editorEl: HTMLDivElement;
  let editorView: EditorView | null = null;
  let isLargeFile = $state(false);
  let isDark = $derived($themeStore.isDark);

  const lightTheme = EditorView.theme({
    "&.cm-editor": { backgroundColor: "transparent !important" },
    "&.cm-focused .cm-selectionBackground, & .cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: "var(--bg-selected) !important"
    },
    ".cm-content": { caretColor: "var(--text-primary)" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--text-primary)" },
    "&.cm-focused .cm-activeLine": { backgroundColor: "var(--bg-hover)" },
    ".cm-activeLineGutter": { backgroundColor: "var(--bg-surface-2)" },
    ".cm-gutters": { backgroundColor: "transparent !important" },
    ".cm-lineNumbers .cm-gutterElement": { color: "var(--text-muted)" },
    ".cm-foldPlaceholder": { backgroundColor: "var(--bg-surface)", color: "var(--text-muted)" },
    ".cm-matchingBracket": { backgroundColor: "var(--bg-selected)", outline: "1px solid var(--border-focus)" },
    ".cm-nonmatchingBracket": { backgroundColor: "var(--color-error)", outline: "1px solid var(--color-error)" },
  });

  const langCompartment = new Compartment();
  const themeCompartment = new Compartment();
  const lineNumbersCompartment = new Compartment();
  const wordWrapCompartment = new Compartment();
  const tabSizeCompartment = new Compartment();
  const minimapCompartment = new Compartment();
  const gutterCompartment = new Compartment();

  const settings = settingsStore;
  const ui = uiStore;
  let minimapDom: HTMLElement | null = null;

  
  $effect(() => {
    invoke<boolean>('is_large_file', { path: filePath }).then(large => {
      isLargeFile = large;
    }).catch(() => {});
  });

  async function loadLanguage() {
    if (isLargeFile) {
      return;
    }
    const { getLanguageExtension } = await import('../utils/languageDetector');
    const ext = await getLanguageExtension(filePath);
    if (editorView) {
      editorView.dispatch({
        effects: langCompartment.reconfigure(ext)
      });
    }
  }

  function setupEditor() {
    if (editorView) {
      editorView.destroy();
      editorView = null;
    }

    let cursorScrollTimeout: ReturnType<typeof setTimeout> | null = null;

    // CodeMirror manages its own internal state (immutable document tree).
    // Svelte only needs the content at specific moments (see 4.2).
    let contentExtractTimer: ReturnType<typeof setTimeout> | null = null;
    const CONTENT_DEBOUNCE_MS = 500; // Extract only after user stops typing

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        // Debounced extraction — don't extract on every keystroke
        if (contentExtractTimer) clearTimeout(contentExtractTimer);
        contentExtractTimer = setTimeout(() => {
          if (!editorView) return;
          // Mark as modified immediately (cheap — just set isDirty flag)
          const content = editorView.state.doc.toString();
          editorStore.updateContent(tabId, content);
        }, CONTENT_DEBOUNCE_MS);
      }

      if (update.selectionSet || update.geometryChanged) {
        if (cursorScrollTimeout) clearTimeout(cursorScrollTimeout);
        cursorScrollTimeout = setTimeout(() => {
          if (!editorView) return;
          const pos = editorView.state.selection.main.head;
          const line = editorView.state.doc.lineAt(pos);
          editorStore.updateCursor(tabId, line.number, pos - line.from + 1);

          const scroll = editorView.scrollDOM;
          editorStore.updateScroll(tabId, scroll.scrollTop, scroll.scrollLeft);
        }, 500);
      }
    });

    let extBase = [
      ...(isLargeFile ? COMMON_EXTENSIONS_LARGE_FILE : COMMON_EXTENSIONS),
      EditorView.domEventHandlers({
        click: (event) => {
          if (event.altKey) {
            handleGoToDefinition();
            event.preventDefault();
          }
        }
      }),
      updateListener,
      langCompartment.of([]),
      themeCompartment.of(isDark ? oneDark : lightTheme),
      lineNumbersCompartment.of($settings.line_numbers ? [lineNumbers(), foldGutter(), highlightActiveLineGutter()] : []),
      wordWrapCompartment.of($settings.word_wrap ? EditorView.lineWrapping : []),
      tabSizeCompartment.of(EditorState.tabSize.of($settings.tab_size)),
      gutterCompartment.of([lintGutter()]),
      minimapCompartment.of(!isLargeFile ? [
        showMinimap.of({
          create: () => {
            const dom = document.createElement('div');
            dom.className = 'cm-minimap-container';
            dom.style.display = $ui.isMinimapEnabled ? '' : 'none';
            minimapDom = dom;
            return { dom };
          },
          displayText: 'blocks',
          showOverlay: 'mouse-over'
        })
      ] : []),
    ];

    const state = EditorState.create({ doc: content, extensions: extBase });
    editorView = new EditorView({ state, parent: editorEl });

    const scroll = editorStore.getScroll(tabId);
    if (scroll) {
      requestAnimationFrame(() => {
        if (editorView && scroll) {
          editorView.scrollDOM.scrollTop = scroll.top;
          editorView.scrollDOM.scrollLeft = scroll.left;
        }
      });
    }
    const cursor = editorStore.getCursor(tabId);
    if (cursor && !isLargeFile) {
      try {
        const line = editorView.state.doc.line(cursor.line);
        const pos = Math.min(line.from + cursor.column - 1, line.to);
        editorView.dispatch({
          selection: { anchor: pos },
          scrollIntoView: true
        });
      } catch {}
    }

    loadLanguage();
  }

  $effect(() => {
    const dark = isDark;
    if (!editorView) return;
    editorView.dispatch({
      effects: themeCompartment.reconfigure(dark ? oneDark : lightTheme)
    });
  });

  $effect(() => {
    const ln = $settings.line_numbers;
    if (!editorView) return;
    editorView.dispatch({
      effects: lineNumbersCompartment.reconfigure(ln ? [lineNumbers(), foldGutter(), highlightActiveLineGutter()] : [])
    });
  });

  $effect(() => {
    const wrap = $settings.word_wrap;
    if (!editorView) return;
    editorView.dispatch({
      effects: wordWrapCompartment.reconfigure(wrap ? EditorView.lineWrapping : [])
    });
  });

  $effect(() => {
    const ts = $settings.tab_size;
    if (!editorView) return;
    editorView.dispatch({
      effects: tabSizeCompartment.reconfigure(EditorState.tabSize.of(ts))
    });
  });

  $effect(() => {
    const enabled = $ui.isMinimapEnabled;
    if (!editorView || isLargeFile) return;
    if (minimapDom) {
      minimapDom.style.display = enabled ? '' : 'none';
    }
    if (!enabled) {
      editorView.scrollDOM.style.paddingRight = '';
    }
  });

  async function handleGoToDefinition() {
    if (!editorView || !$ui.explorerRoot) return;
    const pos = editorView.state.selection.main.head;
    const word = editorView.state.wordAt(pos);
    if (!word) return;
    const symbol = editorView.state.sliceDoc(word.from, word.to);
    if (!symbol.trim()) return;
    try {
      const { gotoDefinition } = await import('../utils/symbolEngine');
      const results = await gotoDefinition($ui.explorerRoot, symbol, filePath);
      if (results.length > 0) {
        window.dispatchEvent(new CustomEvent('editor:open-file', {
          detail: { path: results[0].file_path, line: results[0].line }
        }));
      }
    } catch (err) { console.error('Go to definition failed', err); }
  }

  async function handleFindReferences() {
    if (!editorView || !$ui.explorerRoot) return;
    const pos = editorView.state.selection.main.head;
    const word = editorView.state.wordAt(pos);
    if (!word) return;
    const symbol = editorView.state.sliceDoc(word.from, word.to);
    if (!symbol.trim()) return;
    try {
      const { findReferences } = await import('../utils/symbolEngine');
      const results = await findReferences($ui.explorerRoot, symbol);
      window.dispatchEvent(new CustomEvent('editor:show-references', {
        detail: { symbol, results }
      }));
    } catch (err) { console.error('Find references failed', err); }
  }

  $effect(() => {
    window.addEventListener('editor:find-references', handleFindReferences);
    return () => window.removeEventListener('editor:find-references', handleFindReferences);
  });

  function handleAction(e: Event) {
    const customEvent = e as CustomEvent;
    if (!editorView) return;
    const action = customEvent.detail?.action;

    if (action === 'undo') undo(editorView);
    else if (action === 'redo') redo(editorView);
    else if (action === 'selectAll') { selectAll(editorView); editorView.focus(); }
    else if (action === 'copyLineUp') copyLineUp(editorView);
    else if (action === 'copyLineDown') copyLineDown(editorView);
    else if (action === 'moveLineUp') moveLineUp(editorView);
    else if (action === 'moveLineDown') moveLineDown(editorView);
    else if (action === 'find') openSearchPanel(editorView);
    else if (action === 'replace') openSearchPanel(editorView);
    else if (action === 'goto' && customEvent.detail?.line !== undefined) {
      const lineNum = customEvent.detail.line;
      if (lineNum > 0 && lineNum <= editorView.state.doc.lines) {
        const line = editorView.state.doc.line(lineNum);
        editorView.dispatch({
          selection: { anchor: line.from, head: line.from },
          scrollIntoView: true
        });
        editorView.focus();
      }
    }
  }

  let style = $derived(`font-size: ${$settings.font_size}px; font-family: ${$settings.font_family};`);

  onMount(() => {
    setupEditor();
    window.addEventListener('editor:action', handleAction);
  });

  onDestroy(() => {
    window.removeEventListener('editor:action', handleAction);
    if (editorView) {
      editorStore.updateContent(tabId, editorView.state.doc.toString());
      const pos = editorView.state.selection.main.head;
      const line = editorView.state.doc.lineAt(pos);
      editorStore.updateCursor(tabId, line.number, pos - line.from + 1);
      editorStore.updateScroll(tabId, editorView.scrollDOM.scrollTop, editorView.scrollDOM.scrollLeft);
      editorView.destroy();
      editorView = null;
    }
  });
</script>

<div class="absolute inset-0 [&>div]:h-full [&_.cm-editor]:h-full" style={style}>

  {#if isLargeFile}
    <div class="absolute top-0 left-0 right-0 bg-yellow-900/50 text-yellow-300 text-[10px] px-3 py-1 text-center z-10">
      Large file — syntax highlighting and some features disabled for performance
    </div>
  {/if}
  <div bind:this={editorEl} class="h-full"></div>
</div>