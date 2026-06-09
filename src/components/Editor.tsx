import { useCallback, useMemo, useEffect, useRef } from 'react';
import CodeMirror, { ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, undo, redo, selectAll, copyLineUp, copyLineDown, moveLineUp, moveLineDown } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches, openSearchPanel } from '@codemirror/search';
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { closeBrackets, autocompletion, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { oneDark } from '@codemirror/theme-one-dark';
import { useSettingsStore } from '../store/settingsStore';
import { useEditorStore } from '../store/editorStore';
import { useUiStore } from '../store/uiStore';
import { getLanguageExtension } from '../utils/languageDetector';
import { showMinimap } from '@replit/codemirror-minimap';

interface EditorProps {
  tabId: string;
  content: string;
  filePath: string;
  readOnly?: boolean;
}

export default function Editor({ tabId, content, filePath, readOnly = false }: EditorProps) {
  const { settings } = useSettingsStore();
  const { updateContent } = useEditorStore();
  const { isMinimapEnabled } = useUiStore();
  const editorRef = useRef<ReactCodeMirrorRef>(null);

  useEffect(() => {
    const handleAction = (e: Event) => {
      const customEvent = e as CustomEvent;
      const view = editorRef.current?.view;
      if (!view) return;
      
      switch (customEvent.detail.action) {
        case 'undo': undo(view); break;
        case 'redo': redo(view); break;
        case 'selectAll': selectAll(view); break;
        case 'copyLineUp': copyLineUp(view); break;
        case 'copyLineDown': copyLineDown(view); break;
        case 'moveLineUp': moveLineUp(view); break;
        case 'moveLineDown': moveLineDown(view); break;
        case 'find': openSearchPanel(view); break;
        case 'replace': openSearchPanel(view); break; // CM6 search panel includes replace toggle
      }
    };
    
    window.addEventListener('editor:action', handleAction);
    return () => window.removeEventListener('editor:action', handleAction);
  }, []);

  const onChange = useCallback((value: string) => {
    updateContent(tabId, value);
  }, [tabId, updateContent]);

  const extensions = useMemo(() => {
    const exts = [
      EditorView.theme({
        "&": { backgroundColor: "transparent !important", height: "100%" },
        ".cm-gutters": { backgroundColor: "transparent !important", border: "none" },
        ".cm-scroller": { overflow: "auto !important" }
      }),
      highlightSpecialChars(),
      history(),
      drawSelection(),
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
      ]),
      getLanguageExtension(filePath)
    ];

    if (settings.line_numbers) {
      exts.push(lineNumbers());
      exts.push(foldGutter());
      exts.push(highlightActiveLineGutter());
    }

    if (settings.word_wrap) {
      exts.push(EditorView.lineWrapping);
    }

    if (settings.tab_size) {
      exts.push(EditorState.tabSize.of(settings.tab_size));
    }

    if (settings.theme === 'dark' || settings.theme === 'system') {
      exts.push(oneDark);
    }

    if (isMinimapEnabled) {
      exts.push(
        showMinimap.compute(['doc'], () => {
          return {
            create: () => {
              const dom = document.createElement('div');
              dom.className = 'cm-minimap-container';
              return { dom };
            },
            displayText: 'blocks',
            showOverlay: 'mouse-over'
          };
        })
      );
    }

    return exts;
  }, [filePath, settings.line_numbers, settings.theme, settings.word_wrap, settings.tab_size, isMinimapEnabled]);

  const style = {
    fontSize: `${settings.font_size}px`,
    fontFamily: settings.font_family,
  };

  return (
    <div className="absolute inset-0 [&>div]:h-full [&_.cm-editor]:h-full" style={style}>
      <CodeMirror
        ref={editorRef}
        value={content}
        height="100%"
        theme={settings.theme === 'dark' || settings.theme === 'system' ? 'dark' : 'light'}
        extensions={extensions}
        onChange={onChange}
        readOnly={readOnly}
        basicSetup={false}
      />
    </div>
  );
}
