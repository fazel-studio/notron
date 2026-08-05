import { StateField, StateEffect } from '@codemirror/state';
import { gutter, GutterMarker } from '@codemirror/view';
import { EditorView, Decoration, type DecorationSet } from '@codemirror/view';
import { debugStore } from '../stores/debug';
import { get } from 'svelte/store';

export const toggleBreakpointEffect = StateEffect.define<{ line: number; file: string }>();

class BreakpointMarker extends GutterMarker {
  constructor(public verified: boolean) {
    super();
  }
  toDOM() {
    const wrap = document.createElement('div');
    wrap.className = 'cm-breakpoint-marker';
    wrap.style.display = 'flex';
    wrap.style.alignItems = 'center';
    wrap.style.justifyContent = 'center';
    wrap.style.width = '100%';
    wrap.style.height = '100%';
    
    const circle = document.createElement('div');
    circle.style.width = '10px';
    circle.style.height = '10px';
    circle.style.borderRadius = '50%';
    circle.style.backgroundColor = this.verified ? '#ef4444' : '#ef444480';
    if (this.verified) {
      circle.style.boxShadow = '0 0 4px rgba(239, 68, 68, 0.8)';
    }
    
    wrap.appendChild(circle);
    return wrap;
  }
}

export function createBreakpointGutter(filePath: string) {
  return gutter({
    class: 'cm-breakpoint-gutter',
    lineMarker: (view, line) => {
      const state = get(debugStore);
      const docLine = view.state.doc.lineAt(line.from);
      const bp = state.breakpoints.find(b => b.file === filePath && b.line === docLine.number);
      if (bp) {
        return new BreakpointMarker(bp.verified);
      }
      return null;
    },
    initialSpacer: () => new BreakpointMarker(true),
    domEventHandlers: {
      mousedown(view, line, _event) {
        const docLine = view.state.doc.lineAt(line.from);
        debugStore.toggleBreakpoint(filePath, docLine.number);
        return true;
      }
    }
  });
}

const activeLineDeco = Decoration.line({
  attributes: { class: 'cm-debug-active-line', style: 'background-color: rgba(234, 179, 8, 0.2); border-top: 1px solid rgba(234, 179, 8, 0.4); border-bottom: 1px solid rgba(234, 179, 8, 0.4);' }
});

export function createActiveLineExtension(filePath: string) {
  return StateField.define<DecorationSet>({
    create(state) {
      const debug = get(debugStore);
      if (debug.state === 'paused' && debug.activeFrame && debug.activeFrame.source.path === filePath) {
        try {
          const line = state.doc.line(debug.activeFrame.line);
          return Decoration.set([activeLineDeco.range(line.from, line.from)]);
        } catch {
          return Decoration.none;
        }
      }
      return Decoration.none;
    },
    update(_decorations, tr) {
      // Re-evaluate on every transaction for simplicity in reactivity
      const debug = get(debugStore);
      if (debug.state === 'paused' && debug.activeFrame && debug.activeFrame.source.path === filePath) {
        try {
          const line = tr.state.doc.line(debug.activeFrame.line);
          return Decoration.set([activeLineDeco.range(line.from, line.from)]);
        } catch {
          return Decoration.none;
        }
      }
      return Decoration.none;
    },
    provide: f => EditorView.decorations.from(f)
  });
}
