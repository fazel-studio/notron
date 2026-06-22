<script lang="ts">
  import { terminalStore, type TerminalType } from '../stores/terminal';
  import { uiStore } from '../stores/ui';
  import { editorStore } from '../stores/editor';
  import TerminalInstance from './TerminalInstance.svelte';
  import Tooltip from './Tooltip.svelte';
  const termStore = terminalStore;
  const { activeTabId } = editorStore;
  
  let isDropdownOpen = $state(false);
  let prevTabId = $state<string | null>(null);

  $effect(() => {
    // Un-maximize when switching tabs
    const currentTabId = $activeTabId;
    if (currentTabId !== prevTabId) {
      prevTabId = currentTabId;
      if ($termStore.isMaximized) {
        terminalStore.setMaximize(false);
      }
    }
  });

  function createTerminal(type: TerminalType) {
    const cwd = uiStore.getSnapshot().explorerRoot || '';
    terminalStore.newTerminal(type, cwd);
    isDropdownOpen = false;
  }
  
  function startResize(e: MouseEvent) {
    if ($termStore.isMaximized) return;
    e.preventDefault();
    terminalStore.setResizing(true);
    const startY = e.clientY;
    const startHeight = $termStore.height;

    function onMouseMove(me: MouseEvent) {
      if (!$termStore.isResizing) return;
      const delta = startY - me.clientY;
      terminalStore.setHeight(Math.max(100, Math.min(window.innerHeight - 100, startHeight + delta)));
    }

    function onMouseUp() {
      terminalStore.setResizing(false);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }
</script>

<div 
  class="flex flex-col border-t border-subtle bg-surface-2 transition-all z-40 relative"
  class:hidden={!$termStore.isVisible || $termStore.terminals.length === 0}
  class:flex-1={$termStore.isMaximized}
  style="{$termStore.isMaximized ? '' : `height: ${$termStore.height}px`};"
>
    <!-- Drag Overlay to prevent text selection while resizing -->
    {#if $termStore.isResizing}
      <div class="fixed inset-0 z-[9999] cursor-ns-resize"></div>
    {/if}
    <!-- Resizer -->
    {#if !$termStore.isMaximized}
      <div 
        role="presentation"
        class="absolute top-0 left-0 right-0 h-1 -mt-0.5 cursor-ns-resize hover:bg-indicator-active z-50 transition-colors"
        onmousedown={startResize}
      ></div>
    {/if}

    <!-- Header -->
    <div class="flex items-center justify-between h-9 px-4 border-b border-subtle bg-surface shrink-0 select-none">
      <div class="text-xs font-semibold uppercase tracking-widest text-secondary flex items-center gap-2">
        <span>Terminal</span>
      </div>
      <div class="flex items-center gap-1 text-icon-default relative">
        <div class="relative">
          <Tooltip content="New Terminal" side="top">
            <button 
              aria-label="New Terminal" 
              onclick={() => isDropdownOpen = !isDropdownOpen} 
              class="p-1 rounded hover:bg-hover hover:text-icon-active transition-colors flex items-center gap-0.5"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
          </Tooltip>
          
          {#if isDropdownOpen}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="fixed inset-0 z-[99]"
              role="presentation"
              onclick={() => isDropdownOpen = false}
              oncontextmenu={(e) => { e.preventDefault(); isDropdownOpen = false; }}
              onkeydown={(e) => { if (e.key === 'Escape') isDropdownOpen = false; }}
            ></div>
            <div 
              class="absolute top-full right-0 mt-1 min-w-[160px] rounded-md border p-1 shadow-md z-[100] animate-in fade-in duration-100 bg-surface-2 border-subtle text-primary flex flex-col"
            >
              <button 
                class="flex items-center justify-between w-full px-2 py-1.5 text-xs rounded-sm cursor-pointer select-none outline-none transition-colors hover:bg-selected focus:bg-selected hover:text-primary focus:text-primary text-secondary" 
                onclick={() => createTerminal('powershell')}
              >
                <span>PowerShell</span>
              </button>
              <button 
                class="flex items-center justify-between w-full px-2 py-1.5 text-xs rounded-sm cursor-pointer select-none outline-none transition-colors hover:bg-selected focus:bg-selected hover:text-primary focus:text-primary text-secondary" 
                onclick={() => createTerminal('cmd')}
              >
                <span>Command Prompt</span>
              </button>
            </div>
          {/if}
        </div>
        
        <Tooltip content="Kill Terminal" side="top">
          <button 
            aria-label="Delete Active Terminal" 
            onclick={() => $termStore.activeTerminalId && terminalStore.closeTerminal($termStore.activeTerminalId)} 
            class="p-1 rounded hover:bg-hover hover:text-red-400 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
          </button>
        </Tooltip>
        
        <Tooltip content="Maximize Terminal Panel" side="top">
          <button 
            aria-label="Maximize Terminal" 
            onclick={() => terminalStore.toggleMaximize()} 
            class="p-1 rounded hover:bg-hover hover:text-icon-active transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              {#if $termStore.isMaximized}
                <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
              {:else}
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              {/if}
            </svg>
          </button>
        </Tooltip>
        
        <Tooltip content="Hide Terminal" side="top">
          <button 
            aria-label="Close Terminal Panel" 
            onclick={() => terminalStore.setVisibility(false)} 
            class="p-1 rounded hover:bg-hover hover:text-icon-active transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </Tooltip>
      </div>
    </div>

    <!-- Body -->
    <div class="flex-1 flex overflow-hidden">
      <!-- Active Terminal Content -->
      <div class="flex-1 overflow-hidden relative">
        {#each $termStore.terminals as term (term.id)}
          <div 
            class="absolute inset-0 transition-opacity" 
            class:opacity-100={$termStore.activeTerminalId === term.id} 
            class:opacity-0={$termStore.activeTerminalId !== term.id} 
            class:pointer-events-none={$termStore.activeTerminalId !== term.id}
            class:z-10={$termStore.activeTerminalId === term.id}
            class:-z-10={$termStore.activeTerminalId !== term.id}
          >
            <TerminalInstance tabId={term.id} type={term.type} cwd={term.cwd} />
          </div>
        {/each}
      </div>

      <!-- Sidebar -->
      {#if $termStore.terminals.length > 1}
        <div class="w-48 border-l border-subtle bg-surface flex flex-col overflow-y-auto shrink-0">
          {#each $termStore.terminals as term (term.id)}
            <button 
              class="px-3 py-2 text-xs text-left truncate transition-colors flex items-center justify-between group"
              class:bg-selected={$termStore.activeTerminalId === term.id}
              class:text-primary={$termStore.activeTerminalId === term.id}
              class:text-secondary={$termStore.activeTerminalId !== term.id}
              class:hover:bg-hover={$termStore.activeTerminalId !== term.id}
              onclick={() => terminalStore.setActive(term.id)}
            >
              <span class="truncate flex-1 pr-2">{term.name}</span>
              <div 
                role="button"
                tabindex="0"
                class="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-500 hover:text-white transition-all text-icon-default"
                onclick={(e) => { e.stopPropagation(); terminalStore.closeTerminal(term.id); }}
                onkeydown={(e) => { if (e.key === 'Enter') terminalStore.closeTerminal(term.id); }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
              </div>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </div>
