<script module>
  import { keymap, highlightSpecialChars, dropCursor, rectangularSelection, crosshairCursor, highlightActiveLine } from '@codemirror/view';
  import { EditorState } from '@codemirror/state';
  import { defaultKeymap, history, historyKeymap, undo, redo, selectAll, copyLineUp, copyLineDown, moveLineUp, moveLineDown, historyField } from '@codemirror/commands';
  import { highlightSelectionMatches } from '@codemirror/search';
  import { bracketMatching, foldKeymap, indentOnInput, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
  import { closeBrackets, autocompletion, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
  import { EditorView } from '@codemirror/view';

  const COMMON_EXTENSIONS = [
    EditorView.theme({
      "&": { backgroundColor: "transparent !important", height: "100%" },
      ".cm-gutters": { backgroundColor: "var(--bg-canvas) !important", borderRight: "1px solid var(--border-subtle) !important", paddingLeft: "0px !important", paddingRight: "0px !important" },
      ".cm-lineNumbers .cm-gutterElement": { paddingLeft: "4px !important", paddingRight: "4px !important", minWidth: "20px !important", textAlign: "right" },
      ".cm-foldGutter .cm-gutterElement": { paddingLeft: "0px !important", paddingRight: "0px !important", width: "12px !important", textAlign: "center" },
      ".cm-scroller": { overflow: "auto !important", overscrollBehaviorX: "none !important" }
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
  import { onMount, onDestroy, mount, unmount } from 'svelte';
  import { Compartment } from '@codemirror/state';
  import { lineNumbers, highlightActiveLineGutter } from '@codemirror/view';
  import { foldGutter } from '@codemirror/language';
  import { lintGutter } from '@codemirror/lint';
  import HorizontalScrollbar from './HorizontalScrollbar.svelte';
  import EditorSearchWidget from './EditorSearchWidget.svelte';
  import EditorFoldMarker from './EditorFoldMarker.svelte';
  import { oneDark } from '@codemirror/theme-one-dark';
  import { showMinimap } from '@replit/codemirror-minimap';
  import { gitChangesState, type GitMarker } from '../utils/gitGutter';
  import { invoke } from '@tauri-apps/api/core';
  import { settingsStore } from '../stores/settings.svelte';
  import { editorStore, buildReplaceRegex, applyReplacement } from '../stores/editor';
  import { uiStore } from '../stores/ui';
  import { themeStore } from '../stores/theme';
  import { debugStore } from '../stores/debug';
  import { createBreakpointGutter, createActiveLineExtension } from '../utils/debugExtensions';
  import { gitGutter, parseGitDiff, gitChangesEffect } from '../utils/gitGutter';
  import { getGitFileDiff } from '../services/git';
  
  let { tabId, content, filePath }: { tabId: string; content: string; filePath: string } = $props();

  let currentTabId: string | null = null;
  const editorStates = new Map<string, EditorState>();
  let editorEl: HTMLDivElement;
  let editorView = $state<EditorView | null>(null);
  let scrollDOM: HTMLElement | null = $state(null);
  let isDark = $derived($themeStore.isDark);
  let gutterWidth = $state(0);
  let docChangedCount = $state(0);
  let searchWidget = $state<ReturnType<typeof EditorSearchWidget> | null>(null);
  
  const tabsStore = editorStore.tabs;
  let currentTab = $derived($tabsStore.find((t: any) => t.id === tabId));
  let tabStatus = $derived(currentTab?.status);
  let isLargeFile = $derived(currentTab?.isLargeFile || (content && content.length > 250000));
  
  const foldMarkers = new Set<{ app: any, marker: HTMLElement }>();

  const customFoldGutter = foldGutter({
    markerDOM: (open) => {
      const marker = document.createElement("span");
      marker.className = "custom-fold-marker-wrapper";
      marker.style.display = "flex";
      marker.style.width = "100%";
      marker.style.height = "100%";
      
      const app = mount(EditorFoldMarker, {
        target: marker,
        props: { open }
      });
      foldMarkers.add({ app, marker });

      // Strip native title from parent so it doesn't conflict with Tooltip
      setTimeout(() => {
        const parent = marker.parentElement;
        if (parent) {
          parent.removeAttribute("title");
          const observer = new MutationObserver(() => {
            if (parent.hasAttribute("title")) parent.removeAttribute("title");
          });
          observer.observe(parent, { attributes: true, attributeFilter: ["title"] });
        }
      }, 0);

      return marker;
    }
  });

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
  const debugCompartment = new Compartment();
  const gitGutterCompartment = new Compartment();

  const settings = settingsStore;
  const ui = uiStore;
  let minimapDom: HTMLElement | null = null;

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
    if (!editorView) {
        editorView = new EditorView({ parent: editorEl });
        scrollDOM = editorView.scrollDOM;
    }
    
    // Save old state
    if (currentTabId && editorStates.has(currentTabId)) {
        editorStates.set(currentTabId, editorView.state);
    }
    currentTabId = tabId;

    let cursorScrollTimeout: ReturnType<typeof setTimeout> | null = null;

    // CodeMirror manages its own internal state (immutable document tree).
    // Svelte only needs the content at specific moments (see 4.2).
    let contentExtractTimer: ReturnType<typeof setTimeout> | null = null;
    const CONTENT_DEBOUNCE_MS = 500; // Extract only after user stops typing

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        docChangedCount++; // Trigger search match updates
        // Debounced extraction — don't extract on every keystroke
        if (contentExtractTimer) clearTimeout(contentExtractTimer);
        contentExtractTimer = setTimeout(() => {
          if (!editorView) return;
          // Mark as modified immediately (cheap — just set isDirty flag)
          const content = editorView.state.doc.toString();
          editorStore.updateContent(tabId, content);
        }, CONTENT_DEBOUNCE_MS);
      }

      if (update.viewportChanged || update.docChanged || update.geometryChanged) {
        for (const item of foldMarkers) {
          if (!item.marker.isConnected) {
            unmount(item.app);
            foldMarkers.delete(item);
          }
        }
      }

      if (update.selectionSet || update.geometryChanged) {
        // Measure gutter width efficiently on geometry change
        if (update.geometryChanged && editorEl) {
          const gutters = editorEl.querySelector('.cm-gutters');
          if (gutters) {
            const w = (gutters as HTMLElement).offsetWidth;
            if (gutterWidth !== w) gutterWidth = w;
          }
        }

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
      keymap.of([{
        key: 'Mod-f',
        run: () => {
          uiStore.setFileSearchOpen(true);
          // Wait for DOM to render the widget if it wasn't open
          setTimeout(() => searchWidget?.focusInput(), 10);
          return true;
        }
      }]),
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
      lineNumbersCompartment.of(settings.effectiveSettings.line_numbers ? [
        lineNumbers(), 
        customFoldGutter, 
        highlightActiveLineGutter()
      ] : []),
      wordWrapCompartment.of(settings.effectiveSettings.word_wrap ? EditorView.lineWrapping : []),
      tabSizeCompartment.of(EditorState.tabSize.of(settings.effectiveSettings.tab_size)),
      gutterCompartment.of([lintGutter()]),
      minimapCompartment.of(!isLargeFile && $ui.isMinimapEnabled ? [
        showMinimap.compute([gitChangesState], (state) => {
          let gitGutterRecord: Record<number, string> = {};
          
          try {
            const markers = state.field(gitChangesState) as any;
            markers.between(0, state.doc.length, (from: number, _to: number, value: any) => {
              const line = state.doc.lineAt(from);
              const marker = value as GitMarker;
              let color = '#34d399'; // default success green
              if (marker.type === 'modified') color = '#60a5fa'; // info blue
              else if (marker.type === 'deleted') color = '#f87171'; // error red
              else if (marker.type === 'added') color = '#34d399'; // success green
              gitGutterRecord[line.number] = color;
            });
          } catch (e) {
            // State might not be fully initialized
          }

          return {
            create: (view) => {
              const dom = document.createElement('div');
              dom.className = 'cm-minimap-container';
              
              // Add custom drag and scroll functionality
              let isDragging = false;
              
              dom.addEventListener('wheel', (e) => {
                e.preventDefault();
                view.scrollDOM.scrollTop += e.deltaY;
                view.scrollDOM.scrollLeft += e.deltaX;
              }, { passive: false });

              dom.addEventListener('mousedown', (e) => {
                // Only initiate drag if left button
                if (e.button !== 0) return;
                isDragging = true;
                
                // Calculate proportion and scroll immediately
                const updateScroll = (evt: MouseEvent) => {
                    const rect = dom.getBoundingClientRect();
                    const y = Math.max(0, Math.min(rect.height, evt.clientY - rect.top));
                    const percentage = y / rect.height;
                    const targetScroll = percentage * (view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight);
                    view.scrollDOM.scrollTop = targetScroll;
                };
                
                updateScroll(e);

                const onMouseMove = (evt: MouseEvent) => {
                  if (isDragging) {
                      updateScroll(evt);
                  }
                };

                const onMouseUp = () => {
                  isDragging = false;
                  window.removeEventListener('mousemove', onMouseMove);
                  window.removeEventListener('mouseup', onMouseUp);
                };

                window.addEventListener('mousemove', onMouseMove);
                window.addEventListener('mouseup', onMouseUp);
              });

              // FORCE it out of the scroller to guarantee it sits on top of text
              setTimeout(() => {
                if (view.dom) {
                  view.dom.appendChild(dom);
                }
              }, 50);
              minimapDom = dom;
              return { dom };
            },
            displayText: 'characters',
            showOverlay: 'always',
            gutters: [gitGutterRecord]
          };
        })
      ] : []),
      debugCompartment.of([
        createBreakpointGutter(filePath),
        createActiveLineExtension(filePath)
      ]),
      gitGutterCompartment.of(isLargeFile ? [] : [gitGutter]),
    ];

    let state = editorStates.get(tabId);
    if (!state) {
        const tabData = editorStore.getTabsSnapshot().find(t => t.id === tabId);
        if (tabData && tabData.undoHistory && !isLargeFile) {
          try {
            state = EditorState.fromJSON(
              { doc: content || '', history: tabData.undoHistory },
              { extensions: extBase },
              { history: historyField }
            );
          } catch (e) {
            console.warn('Failed to restore history', e);
            state = EditorState.create({ doc: content || '', extensions: extBase });
          }
        } else {
          state = EditorState.create({ doc: content || '', extensions: extBase });
        }
        editorStates.set(tabId, state);
    }
    
    editorView.setState(state);

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
        const anchor = Math.min(line.from + cursor.column - 1, line.to);
        const head = cursor.endColumn ? Math.min(line.from + cursor.endColumn - 1, line.to) : anchor;
        editorView.dispatch({
          selection: { anchor, head },
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

  // Re-render debug extensions when debug state or breakpoints change
  let debugState = $derived($debugStore.state);
  let debugBps = $derived($debugStore.breakpoints);
  let debugFrame = $derived($debugStore.activeFrame);

  $effect(() => {
    debugState; debugBps; debugFrame; // subscribe
    if (!editorView) return;
    editorView.dispatch({
      effects: debugCompartment.reconfigure([
        createBreakpointGutter(filePath),
        createActiveLineExtension(filePath)
      ])
    });
  });

  $effect(() => {
    const ln = settings.effectiveSettings.line_numbers;
    if (!editorView) return;
    editorView.dispatch({
      effects: lineNumbersCompartment.reconfigure(ln ? [lineNumbers(), customFoldGutter, highlightActiveLineGutter()] : [])
    });
  });

  $effect(() => {
    const wrap = settings.effectiveSettings.word_wrap;
    if (!editorView) return;
    editorView.dispatch({
      effects: wordWrapCompartment.reconfigure(wrap ? EditorView.lineWrapping : [])
    });
  });

  $effect(() => {
    const ts = settings.effectiveSettings.tab_size;
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

  async function updateGitGutter() {
    if (isLargeFile || !editorView || !$ui.explorerRoot) return;
    try {
      const diff = await getGitFileDiff($ui.explorerRoot, filePath);
      const changes = parseGitDiff(diff, editorView.state.doc);
      editorView.dispatch({
        effects: gitChangesEffect.of(changes)
      });
    } catch (e) {
      console.warn('Failed to update git gutter', e);
    }
  }

  $effect(() => {
    // Whenever tabStatus changes (e.g. to saved) or on mount
    tabStatus;
    if (editorView) {
      updateGitGutter();
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
    else if (action === 'find') uiStore.setFileSearchOpen(true);
    else if (action === 'replace') uiStore.setFileSearchOpen(true);
    else if (action === 'replaceAll' && customEvent.detail?.options) {
      // Replace All on the active (live) tab via a single CodeMirror
      // transaction — undoable with Ctrl+Z, and the updateListener keeps
      // the store + autosave in sync.
      const { path: targetPath, options } = customEvent.detail;
      if (currentTab?.path !== targetPath) return;
      const re = buildReplaceRegex(options.query, options);
      const doc = editorView.state.doc.toString();
      const changes: { from: number; to: number; insert: string }[] = [];
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(doc)) !== null) {
        if (m[0].length === 0) { re.lastIndex++; continue; }
        changes.push({ from: m.index, to: m.index + m[0].length, insert: applyReplacement(m[0], re, options) });
      }
      if (changes.length > 0) {
        editorView.dispatch({ changes });
        editorView.focus();
      }
    }
    else if (action === 'goto' && customEvent.detail?.line !== undefined) {
      const lineNum = customEvent.detail.line;
      if (lineNum > 0 && lineNum <= editorView.state.doc.lines) {
        const line = editorView.state.doc.line(lineNum);
        const col = customEvent.detail.column || 1;
        const endCol = customEvent.detail.endColumn || col;
        const anchor = Math.min(line.from + col - 1, line.to);
        const head = Math.min(line.from + endCol - 1, line.to);
        editorView.dispatch({
          selection: { anchor, head },
          scrollIntoView: true
        });
        editorView.focus();
      }
    }
  }

  function handleEditorMouseOver() {
    // Left empty as we handle tooltip in markerDOM now
  }

  let style = $derived(`font-size: ${settings.effectiveSettings.font_size}px; font-family: ${settings.effectiveSettings.font_family};`);
  let rightGap = $derived((!isLargeFile && $ui.isMinimapEnabled) ? 164 : 0);

  onMount(() => {
    setupEditor();
    window.addEventListener('editor:action', handleAction);
    window.addEventListener('editor:append-chunk', handleAppendChunk);
  });
  
  function handleAppendChunk(e: any) {
      if (!editorView) return;
      const { tabId: tId, chunk } = e.detail;
      let state = editorStates.get(tId);
      if (state) {
          if (tId === currentTabId) {
              editorView.dispatch({
                  changes: { from: editorView.state.doc.length, insert: chunk }
              });
              editorStates.set(tId, editorView.state);
          } else {
              const tr = state.update({
                  changes: { from: state.doc.length, insert: chunk }
              });
              editorStates.set(tId, tr.state);
          }
      } else {
          // Store chunk so when we create state we have it
          const tabData = editorStore.getTabsSnapshot().find(t => t.id === tId);
          if (tabData) {
               editorStore.updateContent(tId, (tabData.content || '') + chunk);
          }
      }
  }
  
  (() => {
      // Re-run setupEditor when tabId changes
      if (tabId && tabId !== currentTabId && editorView) {
          setupEditor();
      }
  });

  onDestroy(() => {
    window.removeEventListener('editor:action', handleAction);
    // Instead of just current tab, save history for all tracked states
    if (editorView) {
      for (const [id, state] of editorStates.entries()) {
          const t = editorStore.getTabsSnapshot().find(tb => tb.id === id);
          const isL = t?.isLargeFile || (state.doc.length > 250000);
          if (!isL) {
             try {
                const serializedHistory = state.toJSON({ history: historyField }).history;
                editorStore.updateUndoHistory(id, serializedHistory);
             } catch(e) {}
          }
          editorStore.updateContent(id, state.doc.toString());
      }
      if (currentTabId) {
          const pos = editorView.state.selection.main.head;
          const line = editorView.state.doc.lineAt(pos);
          editorStore.updateCursor(currentTabId, line.number, pos - line.from + 1);
          editorStore.updateScroll(currentTabId, editorView.scrollDOM.scrollTop, editorView.scrollDOM.scrollLeft);
      }
      editorView.destroy();
      editorView = null;
    }
    
    // Clean up all fold markers on destroy
    for (const item of foldMarkers) {
      unmount(item.app);
    }
    foldMarkers.clear();
  });
</script>

<div class="absolute inset-0 [&_.cm-editor]:h-full editor-wrapper" style={style} role="none" onmouseover={handleEditorMouseOver} onfocus={() => {}}>

  {#if isLargeFile}
    <div class="absolute top-0 left-0 right-0 bg-yellow-900/50 text-yellow-300 text-[10px] px-3 py-1 text-center z-10">
      Large file — syntax highlighting and some features disabled for performance
    </div>
  {/if}
  {#if tabStatus === 'deleted'}
    <div class="absolute top-0 left-0 right-0 bg-red-900/50 text-red-200 text-xs px-3 py-2 text-center z-10 flex justify-center items-center gap-4">
      <span>This file has been deleted from disk.</span>
      <button class="bg-red-700/80 hover:bg-red-600 px-3 py-1 rounded cursor-pointer" onclick={() => editorStore.closeTab(tabId)}>Close Tab</button>
    </div>
  {:else if tabStatus === 'conflict'}
    <div class="absolute top-0 left-0 right-0 bg-orange-900/50 text-orange-200 text-xs px-3 py-2 text-center z-10 flex justify-center items-center gap-4">
      <span>This file has been modified by another program. You have unsaved changes.</span>
      <button class="bg-orange-700/80 hover:bg-orange-600 px-3 py-1 rounded cursor-pointer" onclick={() => editorStore.markSaved(tabId)}>Ignore</button>
      <button class="bg-surface-3 hover:bg-surface-4 px-3 py-1 rounded cursor-pointer" onclick={() => {
        if (!currentTab) return;
        invoke('read_file_text', { path: currentTab.path }).then((content) => {
          editorStore.setInitialContent(tabId, content as string);
        }).catch(async (err) => {
          if (String(err) === '__LARGE_FILE__') {
            try {
              const chunked = await invoke<any>('read_file_chunked', { path: currentTab.path });
              editorStore.setInitialContent(tabId, chunked.content);
              editorStore.updateTab(tabId, { isLargeFile: true, isPreview: true });
            } catch(e) {}
          }
        });
      }}>Reload from Disk</button>
    </div>
  {/if}
  <div bind:this={editorEl} class="h-full relative editor-container {tabStatus === 'deleted' || tabStatus === 'conflict' ? 'pt-8' : ''}"></div>
  
  {#if scrollDOM}
    <HorizontalScrollbar target={scrollDOM} leftGap={gutterWidth} rightGap={rightGap} />
  {/if}
    
  {#if $uiStore.isFileSearchOpen}
    <EditorSearchWidget 
      bind:this={searchWidget} 
      {editorView} 
      onDocChanged={docChangedCount} 
      {rightGap}
    />
  {/if}
</div>
