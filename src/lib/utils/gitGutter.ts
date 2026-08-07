import { StateField, StateEffect, RangeSet, RangeSetBuilder } from '@codemirror/state';
import { gutter, GutterMarker } from '@codemirror/view';
import { mount, unmount } from 'svelte';
import WorkingTreeWidget from '../components/WorkingTreeWidget.svelte';

export class GitMarker extends GutterMarker {
  constructor(public type: 'added' | 'modified' | 'deleted', public originalText: string = '') {
    super();
  }
  toDOM() {
    const div = document.createElement('div');
    div.className = `git-gutter-marker git-gutter-${this.type}`;
    return div;
  }
}

export interface GitChange {
  from: number;
  to: number;
  type: 'added' | 'modified' | 'deleted';
  originalText: string;
}

export const gitChangesEffect = StateEffect.define<GitChange[]>();

export const gitChangesState = StateField.define<RangeSet<GitMarker>>({
  create() {
    return RangeSet.empty;
  },
  update(value, tr) {
    value = value.map(tr.changes);
    for (let e of tr.effects) {
      if (e.is(gitChangesEffect)) {
        let builder = new RangeSetBuilder<GitMarker>();
        // Sort and deduplicate changes to prevent RangeSetBuilder crash
        const sortedChanges = [...e.value].sort((a, b) => a.from - b.from);
        let lastFrom = -1;
        for (let change of sortedChanges) {
          if (change.from <= tr.state.doc.length && change.from > lastFrom) {
            builder.add(
              change.from,
              change.from,
              new GitMarker(change.type, change.originalText)
            );
            lastFrom = change.from;
          }
        }
        value = builder.finish();
      }
    }
    return value;
  }
});

import { Decoration, WidgetType, EditorView, DecorationSet } from '@codemirror/view';

export const toggleInlineDiffEffect = StateEffect.define<{ pos: number, originalText: string, type: 'added' | 'modified' | 'deleted' }>();

class InlineDiffWidgetType extends WidgetType {
  private dom: HTMLElement | null = null;
  private app: any = null;

  constructor(public originalText: string, public pos: number, public type: 'added' | 'modified' | 'deleted') {
    super();
  }

  eq(other: InlineDiffWidgetType) {
    return this.originalText === other.originalText && this.pos === other.pos && this.type === other.type;
  }

  toDOM(view: EditorView) {
    this.dom = document.createElement('div');
    this.dom.className = 'inline-diff-widget-container';
    this.dom.style.width = '100%';
    this.dom.style.display = 'block';
    this.dom.style.minHeight = '60px'; // Prevent CodeMirror from measuring 0 height
    this.dom.style.backgroundColor = 'var(--bg-canvas)';
    this.dom.style.borderTop = '1px solid var(--border-subtle)';
    this.dom.style.borderBottom = '1px solid var(--border-subtle)';
    
    // Get current line text
    const currentText = view.state.doc.lineAt(this.pos).text;
    
    // Mount the Svelte component
    this.app = mount(WorkingTreeWidget, {
      target: this.dom,
      props: {
        view: view,
        lineNumber: view.state.doc.lineAt(this.pos).number,
        originalText: this.originalText,
        currentText: currentText,
        changeType: this.type,
        onClose: () => {
          view.dispatch({
            effects: toggleInlineDiffEffect.of({ pos: this.pos, originalText: this.originalText, type: this.type })
          });
        }
      }
    });

    return this.dom;
  }

  destroy() {
    if (this.app) {
      unmount(this.app);
    }
    this.dom = null;
  }
}

export const inlineDiffState = StateField.define<DecorationSet>({
  create() {
    return RangeSet.empty;
  },
  update(value, tr) {
    value = value.map(tr.changes);
    
    let activeDiffs: { pos: number, originalText: string, type: 'added' | 'modified' | 'deleted' }[] = [];
    let changed = false;

    // Collect existing diffs
    value.between(0, tr.state.doc.length, (from: number, _to: number, dec: Decoration) => {
      const widget = dec.spec.widget as InlineDiffWidgetType;
      if (widget) {
        activeDiffs.push({ pos: from, originalText: widget.originalText, type: widget.type });
      }
    });

    for (let e of tr.effects) {
      if (e.is(toggleInlineDiffEffect)) {
        const idx = activeDiffs.findIndex(d => d.pos === e.value.pos);
        if (idx >= 0) {
            activeDiffs.splice(idx, 1);
        } else {
            activeDiffs.push(e.value);
        }
        changed = true;
      }
    }

    if (changed) {
      activeDiffs.sort((a, b) => a.pos - b.pos);
      let builder = new RangeSetBuilder<Decoration>();
      let lastPos = -1;
      for (let diff of activeDiffs) {
        if (diff.pos > lastPos) {
          builder.add(diff.pos, diff.pos, Decoration.widget({
            widget: new InlineDiffWidgetType(diff.originalText, diff.pos, diff.type),
            block: true,
            side: 1
          }));
          lastPos = diff.pos;
        }
      }
      return builder.finish();
    }
    
    return value;
  },
  provide: f => EditorView.decorations.from(f)
});

export const gitGutter = [
  gitChangesState,
  inlineDiffState,
  gutter({
    class: 'cm-git-gutter',
    markers: v => v.state.field(gitChangesState),
    domEventHandlers: {
      mousedown(view, line, event) {
        const markers = view.state.field(gitChangesState);
        let isGitLine = false;
        
        let originalText = '';
        let changeType: 'added' | 'modified' | 'deleted' = 'modified';
        markers.between(line.from, line.to, (_from, _to, value: GitMarker) => { 
          isGitLine = true; 
          if (value.originalText) originalText = value.originalText;
          changeType = value.type;
        });
        
        if (!isGitLine) return false;
        
        view.dispatch({
            effects: toggleInlineDiffEffect.of({ pos: line.from, originalText, type: changeType })
        });
        
        event.preventDefault();
        event.stopPropagation();
        return true;
      }
    }
  })
];

// A helper to parse the unified diff output from git diff -U0
export function parseGitDiff(diff: string, doc: any): GitChange[] {
  const changes: GitChange[] = [];
  const lines = diff.split('\n');
  
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('@@ ')) {
      // e.g. @@ -1 +2,3 @@ or @@ -1,0 +2 @@
      const match = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (match) {
        const oldCount = match[2] ? parseInt(match[2]) : (line.includes(`-${match[1]},0`) ? 0 : 1);
        const newLine = parseInt(match[3]);
        const newCount = match[4] ? parseInt(match[4]) : (line.includes(`+${match[3]},0`) ? 0 : 1);
        
        let type: 'added' | 'modified' | 'deleted' = 'modified';
        if (newCount === 0) type = 'deleted';
        else if (oldCount === 0) type = 'added';
        
        // collect original text
        let originalText = '';
        let j = i + 1;
        while (j < lines.length && !lines[j].startsWith('@@ ')) {
          if (lines[j].startsWith('-')) {
            originalText += lines[j].substring(1) + '\n';
          }
          j++;
        }
        if (originalText.endsWith('\n')) originalText = originalText.slice(0, -1);
        
        if (type !== 'deleted') {
            for (let k = 0; k < newCount; k++) {
                const targetLine = newLine + k;
                if (targetLine >= 1 && targetLine <= doc.lines) {
                    const pos = doc.line(targetLine).from;
                    changes.push({
                        from: pos,
                        to: pos,
                        type,
                        originalText
                    });
                }
            }
        } else {
            // Deleted line, show marker at the line before or after
            const targetLine = Math.max(1, Math.min(doc.lines, newLine));
            if (targetLine >= 1 && targetLine <= doc.lines) {
                const pos = doc.line(targetLine).from;
                changes.push({
                    from: pos,
                    to: pos,
                    type,
                    originalText
                });
            }
        }
      }
    }
    i++;
  }
  return changes;
}
