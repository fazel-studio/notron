<script lang="ts">
  import { X, ChevronUp, ChevronDown, Replace, ReplaceAll } from 'lucide-svelte';
  import { uiStore } from '../stores/ui';
  import { untrack } from 'svelte';
  import { SearchCursor } from '@codemirror/search';
  import type { EditorView } from '@codemirror/view';
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import Tooltip from './Tooltip.svelte';

  let { editorView, onDocChanged, rightGap = 0 }: { editorView: EditorView | null, onDocChanged: number, rightGap?: number } = $props();

  let query = $state($uiStore.fileSearchQuery);
  let replaceQuery = $state($uiStore.fileReplaceQuery);
  let isReplaceVisible = $state(false);
  
  let matches = $state<{from: number, to: number}[]>([]);
  let currentMatchIndex = $state(-1);
  let inputEl: HTMLInputElement;

  $effect(() => {
    uiStore.setFileSearchQuery(query);
  });
  
  $effect(() => {
    uiStore.setFileReplaceQuery(replaceQuery);
  });

  let lastQuery = untrack(() => query);

  $effect(() => {
    onDocChanged;
    
    untrack(() => {
      recalcMatchesOnly();
    });
  });

  $effect(() => {
    query;
    
    untrack(() => {
      if (query !== lastQuery) {
        lastQuery = query;
        recalcMatchesOnly();
        if (matches.length > 0) {
          selectMatch(currentMatchIndex);
        }
      }
    });
  });

  export function focusInput() {
    setTimeout(() => {
      if (inputEl) {
        inputEl.focus();
        inputEl.select();
      }
    }, 50);
  }

  function recalcMatchesOnly() {
    if (!editorView || !query) {
      matches = [];
      currentMatchIndex = -1;
      return;
    }
    const doc = editorView.state.doc;
    const cursor = new SearchCursor(doc, query, 0, doc.length);
    const newMatches = [];
    while (!cursor.next().done) {
      newMatches.push({ from: cursor.value.from, to: cursor.value.to });
    }
    matches = newMatches;
    
    if (matches.length > 0) {
      const pos = editorView.state.selection.main.head;
      let idx = matches.findIndex(m => m.from >= pos);
      if (idx === -1) idx = 0;
      currentMatchIndex = idx;
    } else {
      currentMatchIndex = -1;
    }
  }

  function selectMatch(index: number) {
    if (index >= 0 && index < matches.length && editorView) {
      const m = matches[index];
      editorView.dispatch({
        selection: { anchor: m.from, head: m.to },
        scrollIntoView: true
      });
    }
  }

  function nextMatch() {
    if (matches.length === 0) return;
    currentMatchIndex = (currentMatchIndex + 1) % matches.length;
    selectMatch(currentMatchIndex);
  }

  function prevMatch() {
    if (matches.length === 0) return;
    currentMatchIndex = (currentMatchIndex - 1 + matches.length) % matches.length;
    selectMatch(currentMatchIndex);
  }

  function replaceCurrent() {
    if (currentMatchIndex >= 0 && currentMatchIndex < matches.length && editorView) {
      const m = matches[currentMatchIndex];
      editorView.dispatch({
        changes: { from: m.from, to: m.to, insert: replaceQuery }
      });
      // The docChanged event will re-trigger updateMatches, which will automatically select the next match!
    }
  }

  function replaceAllMatches() {
    if (matches.length === 0 || !editorView) return;
    const changes = matches.map(m => ({ from: m.from, to: m.to, insert: replaceQuery }));
    // Dispatch all changes at once
    editorView.dispatch({ changes });
  }

  function close() {
    uiStore.setFileSearchOpen(false);
    editorView?.focus();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        prevMatch();
      } else {
        nextMatch();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }

</script>

<div 
  transition:fly={{ y: -20, duration: 250, easing: cubicOut }}
  class="absolute top-3 z-50 bg-surface border border-subtle rounded shadow-elevated flex flex-col w-[480px] text-sm text-primary overflow-hidden"
  style="right: {Math.max(32, rightGap + 32)}px;"
>
  <div class="flex items-center p-1.5 gap-1.5">
    <Tooltip content="Toggle Replace">
      <button class="p-1 hover:bg-hover rounded text-muted transition-colors focus:outline-none" onclick={() => isReplaceVisible = !isReplaceVisible}>
        <ChevronDown size={14} class="transition-transform {isReplaceVisible ? '' : '-rotate-90'}" />
      </button>
    </Tooltip>
    <div class="flex items-center bg-canvas border border-subtle rounded px-2 py-0.5 flex-1 focus-within:border-focus focus-within:ring-1 focus-within:ring-focus transition-all">
      <input bind:this={inputEl} type="text" bind:value={query} onkeydown={handleKeydown} placeholder="Find" class="bg-transparent border-none outline-none w-full text-[13px] placeholder-muted" />
    </div>
    <div class="text-[11px] text-muted whitespace-nowrap min-w-[50px] text-center shrink-0">
      {#if matches.length > 0}
        {currentMatchIndex + 1} of {matches.length}
      {:else if query.length > 0}
        No results
      {/if}
    </div>
    <div class="flex items-center border-l border-subtle pl-1 gap-0.5 shrink-0">
      <Tooltip content="Previous Match (Shift+Enter)">
        <button class="p-1 hover:bg-hover rounded text-icon-default disabled:opacity-30 disabled:cursor-not-allowed transition-colors focus:outline-none" disabled={matches.length === 0} onclick={prevMatch}>
          <ChevronUp size={14} />
        </button>
      </Tooltip>
      <Tooltip content="Next Match (Enter)">
        <button class="p-1 hover:bg-hover rounded text-icon-default disabled:opacity-30 disabled:cursor-not-allowed transition-colors focus:outline-none" disabled={matches.length === 0} onclick={nextMatch}>
          <ChevronDown size={14} />
        </button>
      </Tooltip>
      <Tooltip content="Close (Esc)">
        <button class="p-1 hover:bg-error hover:text-on-accent rounded text-icon-default ml-1 transition-colors focus:outline-none" onclick={close}>
          <X size={14} />
        </button>
      </Tooltip>
    </div>
  </div>
  
  {#if isReplaceVisible}
    <div class="flex items-center p-1.5 gap-1.5 pt-0">
      <div class="w-[22px] shrink-0"></div>
      <div class="flex items-center bg-canvas border border-subtle rounded px-2 py-0.5 flex-1 focus-within:border-focus focus-within:ring-1 focus-within:ring-focus transition-all">
        <input type="text" bind:value={replaceQuery} onkeydown={(e) => e.key === 'Enter' && replaceCurrent()} placeholder="Replace" class="bg-transparent border-none outline-none w-full text-[13px] placeholder-muted" />
      </div>
      <div class="flex items-center gap-0.5 shrink-0 pr-1">
        <Tooltip content="Replace (Enter)">
          <button class="p-1 hover:bg-hover rounded text-icon-default disabled:opacity-30 disabled:cursor-not-allowed transition-colors focus:outline-none" disabled={matches.length === 0} onclick={replaceCurrent}>
            <Replace size={14} />
          </button>
        </Tooltip>
        <Tooltip content="Replace All">
          <button class="p-1 hover:bg-hover rounded text-icon-default disabled:opacity-30 disabled:cursor-not-allowed transition-colors focus:outline-none" disabled={matches.length === 0} onclick={replaceAllMatches}>
            <ReplaceAll size={14} />
          </button>
        </Tooltip>
      </div>
    </div>
  {/if}
</div>
