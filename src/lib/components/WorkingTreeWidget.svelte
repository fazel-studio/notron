<script lang="ts">
  import { EditorView } from '@codemirror/view';
  import { Undo2, Plus, X } from 'lucide-svelte';

  let { view, lineNumber, originalText, currentText, changeType, onClose }: { view: EditorView, lineNumber: number, originalText: string, currentText: string, changeType: 'added' | 'modified' | 'deleted', onClose: () => void } = $props();

  $effect(() => {
    // Close on click outside
    const clickHandler = (e: MouseEvent) => {
      if (!(e.target as Element).closest('.working-tree-widget-container')) {
        onClose();
      }
    };
    setTimeout(() => document.addEventListener('mousedown', clickHandler), 10);
    return () => document.removeEventListener('mousedown', clickHandler);
  });

  async function handleRevert() {
    const line = view.state.doc.line(lineNumber);
    
    if (changeType === 'added') {
      view.dispatch({ changes: { from: line.from, to: line.to + (line.to < view.state.doc.length ? 1 : 0) } });
    } else {
      view.dispatch({ changes: { from: line.from, to: line.to, insert: originalText } });
    }
    onClose();
  }

  async function handleStage() {
    onClose();
  }
</script>

<div class="bg-surface-1 flex flex-col w-full">
  <div class="flex items-center justify-between px-3 py-1 bg-surface-2 border-b border-border-subtle text-sm text-text-muted">
    <div class="flex items-center gap-2">
      <span class="font-medium text-text-primary">Working Tree</span>
    </div>
    <div class="flex items-center gap-1">
      <button class="p-1 hover:bg-bg-hover rounded text-text-muted hover:text-text-primary transition-colors" onclick={handleRevert} title="Revert Change">
        <Undo2 size={14} />
      </button>
      <button class="p-1 hover:bg-bg-hover rounded text-text-muted hover:text-text-primary transition-colors" onclick={handleStage} title="Stage Change">
        <Plus size={14} />
      </button>
      <button class="p-1 hover:bg-bg-hover rounded text-text-muted hover:text-text-primary transition-colors" onclick={onClose} title="Close">
        <X size={14} />
      </button>
    </div>
  </div>
  
  <div class="flex flex-col min-h-[40px] max-h-[300px] overflow-auto text-sm font-mono whitespace-pre-wrap bg-bg-canvas">
    {#if changeType === 'modified'}
      <div class="p-3 border-b border-border-subtle" style="background-color: color-mix(in srgb, var(--color-error) 10%, transparent); color: var(--color-error)">
        <del class="no-underline">- {originalText}</del>
      </div>
      <div class="p-3" style="background-color: color-mix(in srgb, var(--color-success) 10%, transparent); color: var(--color-success)">
        <ins class="no-underline">+ {currentText}</ins>
      </div>
    {:else if changeType === 'added'}
      <div class="p-3" style="background-color: color-mix(in srgb, var(--color-success) 10%, transparent); color: var(--color-success)">
        <ins class="no-underline">+ {currentText}</ins>
      </div>
    {:else}
      <div class="p-3" style="background-color: color-mix(in srgb, var(--color-error) 10%, transparent); color: var(--color-error)">
        <del class="no-underline">- {originalText}</del>
      </div>
    {/if}
  </div>
</div>


