<script lang="ts">
  import { onMount } from 'svelte';
  import { debugStore } from '../stores/debug';
  import {
    Play,
    Pause,
    ArrowRightToLine,
    ArrowDownToLine,
    ArrowUpFromLine,
    RotateCcw,
    Square,
    ChevronRight,
    ChevronDown,
    MoreHorizontal,
    Plus,
    Ban,
    Trash2
  } from 'lucide-svelte';
  import {
    continueDebug,
    createLaunchJsonFile,
    debugEvaluate,
    openFileForDebugging,
    openJavaScriptDebugTerminal,
    pauseDebugSession,
    prepareDebugUrlConfiguration,
    refreshDebugConfigurations,
    runSelectedConfiguration,
    stepInto,
    stepOut,
    stepOver,
    stopDebugSession
  } from '../services/dapClient';

  let debugState = $derived($debugStore.state);
  let variables = $derived($debugStore.variables);
  let callStack = $derived($debugStore.callStack);
  let breakpoints = $derived($debugStore.breakpoints);
  let configurations = $derived($debugStore.configurations);
  let selectedConfigurationName = $derived($debugStore.selectedConfigurationName);
  let exceptionBreakpoints = $derived($debugStore.exceptionBreakpoints);
  let sessionMode = $derived($debugStore.sessionMode);
  let consoleLogs = $derived($debugStore.consoleLogs);

  let isRunExpanded = $state(true);
  let isVariablesExpanded = $state(true);
  let isWatchExpanded = $state(true);
  let isCallStackExpanded = $state(true);
  let isBreakpointsExpanded = $state(true);
  let isConsoleExpanded = $state(true);
  let consoleInput = $state('');
  let breakpointsMuted = $state(false);

  let consoleEl: HTMLDivElement | null = $state(null);

  $effect(() => {
    if (isConsoleExpanded && consoleEl) {
      consoleEl.scrollTop = consoleEl.scrollHeight;
    }
  });

  function onConsoleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && consoleInput.trim()) {
      const expr = consoleInput.trim();
      consoleInput = '';
      debugEvaluate(expr);
    }
  }

  onMount(() => {
    refreshDebugConfigurations();
  });

  function selectConfiguration(event: Event) {
    debugStore.selectConfiguration((event.currentTarget as HTMLSelectElement).value || null);
  }

  function runDebug() {
    runSelectedConfiguration('debug');
  }

  function restartDebug() {
    stopDebugSession();
    setTimeout(runDebug, 250);
  }

  function breakpointCountFor(file: string) {
    return breakpoints.filter(bp => bp.file === file).length;
  }
</script>

<div class="h-full flex flex-col bg-canvas text-primary overflow-hidden font-sans select-none">
  <div class="flex items-center gap-2 h-9 px-4 uppercase text-[11px] font-bold tracking-wider text-secondary shrink-0">
    <span>Run and Debug</span>
    <button class="p-1 hover:bg-hover rounded text-secondary hover:text-primary" title="More Actions">
      <MoreHorizontal size={16} />
    </button>
  </div>

  <div class="flex-1 min-h-0 flex flex-col">
    <div class="flex-1 overflow-y-auto hover-scrollbar">
      {#if debugState === 'idle' || debugState === 'terminated' || sessionMode === 'terminal'}
        <div class="border-b border-subtle">
          <button
            class="flex items-center w-full h-6 px-1 text-[11px] font-bold hover:bg-hover uppercase text-left"
            onclick={() => isRunExpanded = !isRunExpanded}
          >
            {#if isRunExpanded}<ChevronDown size={14} class="mr-1" />{:else}<ChevronRight size={14} class="mr-1" />{/if}
            RUN
          </button>

        {#if isRunExpanded}
          <div class="px-5 pt-2 pb-4 space-y-4">
            <div class="relative">
              <select
                aria-label="Debug configuration"
                class="w-full h-6 bg-surface-2 border border-subtle text-[12px] text-primary outline-none px-2 pr-7 rounded-sm hover:border-accent focus:border-accent"
                value={selectedConfigurationName || ''}
                onchange={selectConfiguration}
              >
                {#if configurations.length === 0}
                  <option value="">No Configurations</option>
                {:else}
                  {#each configurations as config}
                    <option value={config.name}>
                      {config.name}{config.source === 'detected' ? ' (detected)' : ''}
                    </option>
                  {/each}
                {/if}
              </select>
            </div>

            <div class="space-y-4">
              <p class="text-[12px] text-secondary leading-snug">
                <button class="link-button" onclick={openFileForDebugging}>Open a file</button> which can be debugged or run.
              </p>

              <p class="text-[12px] text-secondary leading-snug">
                To customize Run and Debug <button class="link-button" onclick={createLaunchJsonFile}>create a launch.json file</button>.
              </p>
            </div>

            <div class="space-y-3 pt-1">
              <p class="text-[12px] text-secondary leading-snug">
                Debug using a <button class="link-button" onclick={() => runSelectedConfiguration('run')}>terminal command</button> or in an <button class="link-button">interactive chat</button>.
              </p>

              <button
                class="w-full h-7 border border-accent text-primary bg-transparent hover:bg-hover text-[13px] rounded-sm transition-colors font-medium"
                onclick={openJavaScriptDebugTerminal}
              >
                JavaScript Debug Terminal
              </button>

              <p class="text-[12px] text-secondary leading-snug">
                You can use the JavaScript Debug Terminal to debug Node.js processes run on the command line.
              </p>

              <button
                class="w-full h-7 border border-accent text-primary bg-transparent hover:bg-hover text-[13px] rounded-sm transition-colors font-medium"
                onclick={prepareDebugUrlConfiguration}
              >
                Debug URL
              </button>
            </div>
          </div>
        {/if}
        </div>
      {:else}
        <div class="flex items-center justify-center gap-0.5 p-1 bg-surface-2 border-b border-subtle">
          <button class="debug-action text-status-success" disabled={debugState === 'running'} onclick={continueDebug} title="Continue (F5)">
            <Play size={16} fill="currentColor" />
          </button>
          <button class="debug-action text-accent" disabled={debugState !== 'running'} onclick={pauseDebugSession} title="Pause">
            <Pause size={16} fill="currentColor" />
          </button>
          <div class="w-px h-4 bg-subtle mx-0.5"></div>
          <button class="debug-action text-accent" disabled={debugState !== 'paused'} onclick={stepOver} title="Step Over (F10)">
            <ArrowRightToLine size={16} />
          </button>
          <button class="debug-action text-accent" disabled={debugState !== 'paused'} onclick={stepInto} title="Step Into (F11)">
            <ArrowDownToLine size={16} />
          </button>
          <button class="debug-action text-accent" disabled={debugState !== 'paused'} onclick={stepOut} title="Step Out (Shift+F11)">
            <ArrowUpFromLine size={16} />
          </button>
          <div class="w-px h-4 bg-subtle mx-0.5"></div>
          <button class="debug-action text-status-success" onclick={restartDebug} title="Restart (Ctrl+Shift+F5)">
            <RotateCcw size={16} />
          </button>
          <button class="debug-action text-status-error" onclick={stopDebugSession} title="Stop (Shift+F5)">
            <Square size={16} fill="currentColor" />
          </button>
        </div>

      <div class="border-b border-subtle">
        <button class="section-header" onclick={() => isVariablesExpanded = !isVariablesExpanded}>
          {#if isVariablesExpanded}<ChevronDown size={14} class="mr-1" />{:else}<ChevronRight size={14} class="mr-1" />{/if}
          VARIABLES
        </button>
        {#if isVariablesExpanded}
          <div class="py-1 text-[12px]">
            {#if variables.length === 0}
              <div class="empty-row">No variables</div>
            {:else}
              {#each variables as v}
                <div class="flex font-mono px-4 py-0.5 hover:bg-hover group truncate">
                  <span class="text-accent mr-2 shrink-0">{v.name}:</span>
                  <span class={v.type === 'string' ? 'text-status-warning truncate' : 'text-status-success truncate'}>{v.value}</span>
                </div>
              {/each}
            {/if}
          </div>
        {/if}
      </div>

      <div class="border-b border-subtle">
        <button class="section-header" onclick={() => isWatchExpanded = !isWatchExpanded}>
          {#if isWatchExpanded}<ChevronDown size={14} class="mr-1" />{:else}<ChevronRight size={14} class="mr-1" />{/if}
          WATCH
        </button>
        {#if isWatchExpanded}<div class="empty-row">No expressions</div>{/if}
      </div>

      <div class="border-b border-subtle">
        <button class="section-header" onclick={() => isCallStackExpanded = !isCallStackExpanded}>
          {#if isCallStackExpanded}<ChevronDown size={14} class="mr-1" />{:else}<ChevronRight size={14} class="mr-1" />{/if}
          CALL STACK
        </button>
        {#if isCallStackExpanded}
          <div class="py-1 text-[12px]">
            {#if callStack.length === 0}
              <div class="empty-row">Not paused</div>
            {:else}
              {#each callStack as frame}
                <div class="px-4 py-1 hover:bg-hover cursor-pointer flex flex-col leading-tight" title={frame.source.path}>
                  <div class="truncate text-primary font-medium">{frame.name}</div>
                  <div class="truncate opacity-50 text-[10px]">{frame.source.path.split(/[/\\]/).pop()}:{frame.line}</div>
                </div>
              {/each}
            {/if}
          </div>
        {/if}
      </div>

      <div class="border-b border-subtle">
        <button class="section-header" onclick={() => isConsoleExpanded = !isConsoleExpanded}>
          {#if isConsoleExpanded}<ChevronDown size={14} class="mr-1" />{:else}<ChevronRight size={14} class="mr-1" />{/if}
          DEBUG CONSOLE
        </button>
        {#if isConsoleExpanded}
          <div class="px-2 py-1">
            <div bind:this={consoleEl} class="console-viewport text-[11px] font-mono leading-snug">
              {#each consoleLogs as line}
                <div class="whitespace-pre-wrap break-words">{line}</div>
              {/each}
            </div>
            <div class="flex items-center gap-1 mt-1">
              <span class="text-accent text-[12px] font-mono">&gt;</span>
              <input
                class="flex-1 min-w-0 bg-transparent outline-none text-[12px] font-mono text-primary placeholder:text-secondary"
                placeholder="evaluate while paused"
                bind:value={consoleInput}
                onkeydown={onConsoleKeydown}
              />
            </div>
          </div>
        {/if}
      </div>
      {/if}
    </div>

    <div class="shrink-0 border-t border-b border-subtle bg-canvas">
      <div class="flex items-center justify-between group pr-2 hover:bg-hover">
        <button class="flex items-center flex-1 h-6 px-1 text-[11px] font-bold uppercase text-left" onclick={() => isBreakpointsExpanded = !isBreakpointsExpanded}>
          {#if isBreakpointsExpanded}<ChevronDown size={14} class="mr-1" />{:else}<ChevronRight size={14} class="mr-1" />{/if}
          BREAKPOINTS
        </button>
        <div class="hidden group-hover:flex items-center gap-1 text-secondary">
          <button title="Add Function Breakpoint" class="hover:text-primary"><Plus size={13} /></button>
          <button title="Deactivate Breakpoints" class="hover:text-primary" onclick={() => breakpointsMuted = !breakpointsMuted}><Ban size={13} /></button>
          <button title="Remove All Breakpoints" class="hover:text-primary" onclick={() => debugStore.clearBreakpoints()}><Trash2 size={13} /></button>
        </div>
      </div>

      {#if isBreakpointsExpanded}
        <div class="px-5 py-1 space-y-1" class:opacity-50={breakpointsMuted}>
          <label class="breakpoint-row">
            <input
              type="checkbox"
              class="debug-checkbox"
              checked={exceptionBreakpoints.caught}
              onchange={(event) => debugStore.setExceptionBreakpoint('caught', (event.currentTarget as HTMLInputElement).checked)}
            />
            <span>Caught Exceptions</span>
          </label>
          <label class="breakpoint-row">
            <input
              type="checkbox"
              class="debug-checkbox"
              checked={exceptionBreakpoints.uncaught}
              onchange={(event) => debugStore.setExceptionBreakpoint('uncaught', (event.currentTarget as HTMLInputElement).checked)}
            />
            <span>Uncaught Exceptions</span>
          </label>

          {#each breakpoints as bp}
            <div class="breakpoint-row" title={`${bp.file}:${bp.line}`}>
              <input type="checkbox" checked={!breakpointsMuted} class="debug-checkbox" readonly />
              <div class="w-2.5 h-2.5 rounded-full bg-status-error shadow-[0_0_4px_rgba(248,113,113,0.4)]"></div>
              <span class="truncate flex-1">{bp.file.split(/[/\\]/).pop()}</span>
              <span class="opacity-50">{breakpointCountFor(bp.file) > 1 ? `line ${bp.line}` : bp.line}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .link-button {
    color: var(--accent);
    background: transparent;
    border: none;
    padding: 0;
    cursor: pointer;
    text-align: left;
  }

  .link-button:hover {
    text-decoration: underline;
  }

  .debug-action {
    padding: 0.375rem;
    border-radius: 0.25rem;
    transition: background-color 120ms ease, opacity 120ms ease;
  }

  .debug-action:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  .debug-action:disabled {
    opacity: 0.3;
  }

  .section-header {
    display: flex;
    align-items: center;
    width: 100%;
    height: 1.5rem;
    padding: 0 0.25rem;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
  }

  .section-header:hover {
    background: var(--bg-hover);
  }

  .empty-row {
    padding: 0.25rem 1rem;
    font-size: 12px;
    color: var(--text-muted);
    font-style: italic;
  }

  .console-viewport {
    max-height: 9rem;
    min-height: 3rem;
    overflow-y: auto;
    padding: 0.25rem 0.25rem;
    color: var(--text-secondary);
  }

  .breakpoint-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.125rem 0;
    font-size: 12px;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .breakpoint-row:hover {
    color: var(--text-primary);
  }

  .debug-checkbox {
    width: 0.75rem;
    height: 0.75rem;
    border-radius: 0.125rem;
    accent-color: var(--accent);
  }
</style>
