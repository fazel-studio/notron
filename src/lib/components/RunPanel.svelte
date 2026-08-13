<script lang="ts">
  import { onMount } from 'svelte';
  import { runStore } from '../stores/run';
  import { ChevronDown, ChevronRight, Play } from 'lucide-svelte';
  import {
    createLaunchJsonFile,
    openFileForRunning,
    refreshRunConfigurations,
    runSelectedConfiguration,
    saveResolvedEntryAsConfig
  } from '../services/runService';

  let configurations = $derived($runStore.configurations);
  let selectedConfigurationName = $derived($runStore.selectedConfigurationName);

  let isRunExpanded = $state(true);

  let selectedConfig = $derived(
    configurations.find(c => c.name === selectedConfigurationName) || configurations[0] || null
  );
  let isSelectedDetected = $derived(selectedConfig?.source === 'detected');

  function tierLabel(tier: string | undefined) {
    if (!tier) return 'detected';
    return tier; // manifest | framework | heuristic | active
  }

  function selectConfiguration(event: Event) {
    runStore.selectConfiguration((event.currentTarget as HTMLSelectElement).value || null);
  }

  function saveSelectedConfig() {
    const cfg = selectedConfig;
    if (!cfg) return;
    saveResolvedEntryAsConfig({
      name: cfg.name,
      type: cfg.type as any,
      program: cfg.program || '',
      cwd: cfg.cwd || '',
      source: cfg.detectedTier || 'heuristic',
      tier: cfg.detectedTier || 'heuristic'
    });
  }

  function run() {
    runSelectedConfiguration();
  }

  onMount(() => {
    refreshRunConfigurations();
  });
</script>

<div class="h-full flex flex-col bg-canvas text-primary overflow-hidden font-sans select-none">
  <div class="flex items-center gap-2 h-9 px-4 uppercase text-[11px] font-bold tracking-wider text-secondary shrink-0">
    <span>Run</span>
  </div>

  <div class="flex-1 min-h-0 flex flex-col">
    <div class="flex-1 overflow-y-auto hover-scrollbar">
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
                aria-label="Run configuration"
                class="w-full h-6 bg-surface-2 border border-subtle text-[12px] text-primary outline-none px-2 pr-7 rounded-sm hover:border-accent focus:border-accent"
                value={selectedConfigurationName || ''}
                onchange={selectConfiguration}
              >
                {#if configurations.length === 0}
                  <option value="">No Configurations</option>
                {:else}
                  {#each configurations as config}
                    <option value={config.name}>
                      {config.name}{config.source === 'detected' ? ` (${tierLabel(config.detectedTier)})` : ''}
                    </option>
                  {/each}
                {/if}
              </select>
            </div>

            <button
              class="flex items-center justify-center gap-1.5 w-full h-7 border border-accent bg-accent text-on-accent hover:bg-accent-hover text-[13px] rounded-sm transition-colors font-medium"
              onclick={run}
              title="Run the selected configuration in the integrated terminal"
            >
              <Play size={13} fill="currentColor" />
              Run
            </button>

            {#if isSelectedDetected}
              <div class="flex items-center gap-1">
                <button
                  class="flex-1 h-6 border border-subtle text-[11px] text-secondary hover:text-primary hover:bg-hover rounded-sm transition-colors"
                  onclick={saveSelectedConfig}
                >
                  Save as launch configuration
                </button>
              </div>
            {/if}

            <div class="space-y-4">
              <p class="text-[12px] text-secondary leading-snug">
                <button class="link-button" onclick={openFileForRunning}>Open a file</button> which can be run.
              </p>

              <p class="text-[12px] text-secondary leading-snug">
                To customize Run <button class="link-button" onclick={createLaunchJsonFile}>create a launch.json file</button>.
              </p>

              <p class="text-[11px] text-muted leading-snug">
                Notron runs the selected configuration in the integrated terminal.
              </p>
            </div>
          </div>
        {/if}
      </div>
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
</style>