<script lang="ts">
  import Modal from './Modal.svelte';
  import Select from './Select.svelte';
  import { settingsStore } from '../stores/settings.svelte';
  import { themeStore } from '../stores/theme';


  let { isOpen, onClose }: { isOpen: boolean; onClose: () => void } = $props();

  let activeSection = $state('appearance');
  let searchQuery = $state('');
  let searchInputEl: HTMLInputElement | undefined = $state();

  const sections = [
    { id: 'appearance', label: 'Appearance', icon: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16z' },
    { id: 'editor', label: 'Editor', icon: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7' },
    { id: 'autosave', label: 'Auto Save', icon: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2zM17 21v-8H7v8M7 3v5h8' },
    { id: 'files', label: 'Files', icon: 'M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2zM14 2v6h6' },
  ];

  const allSettings: Record<string, Array<{ id: string; label: string; section: string }>> = {
    appearance: [
      { id: 'theme', label: 'Theme', section: 'appearance' },
      { id: 'fontFamily', label: 'Font Family', section: 'appearance' },
      { id: 'fontSize', label: 'Font Size', section: 'appearance' },
      { id: 'iconTheme', label: 'Icon Theme', section: 'appearance' },
    ],
    editor: [
      { id: 'tabSize', label: 'Tab Size', section: 'editor' },
      { id: 'wordWrap', label: 'Word Wrap', section: 'editor' },
      { id: 'lineNumbers', label: 'Line Numbers', section: 'editor' },
    ],
    autosave: [
      { id: 'autoSave', label: 'Enable Auto Save', section: 'autosave' },
      { id: 'autoSaveDelay', label: 'Auto Save Delay', section: 'autosave' },
    ],
    files: [
      { id: 'defaultEncoding', label: 'Default Encoding', section: 'files' },
    ],
  };

  let filteredSections = $derived.by(() => {
    if (!searchQuery.trim()) return null;
    const q = searchQuery.toLowerCase();
    const results: typeof allSettings['appearance'] = [];
    for (const items of Object.values(allSettings)) {
      for (const item of items) {
        if (item.label.toLowerCase().includes(q)) results.push(item);
      }
    }
    return results;
  });

  $effect(() => {
    if (isOpen) {
      searchQuery = '';
      requestAnimationFrame(() => searchInputEl?.focus());
    }
  });

  function handleSave(key: string, value: any) {
    // Update store immediately (synchronous) so UI reacts instantly
    settingsStore.updateSetting(key as any, value);
    // Apply theme directly - bypass the $effect chain in App.svelte
    if (key === 'theme') {
      themeStore.setTheme(value as string);
    }
  }

  function scrollToSetting(id: string) {
    const el = document.getElementById(`setting-${id}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // find which section this id belongs to
    for (const [sec, items] of Object.entries(allSettings)) {
      if (items.some(i => i.id === id)) {
        activeSection = sec;
        break;
      }
    }
    searchQuery = '';
  }
</script>

<Modal {isOpen} title="Settings" {onClose} widthClass="max-w-4xl" heightClass="h-[80vh]">
  {#snippet children()}
    <div class="flex h-full overflow-hidden">
      <!-- Sidebar -->
      <div class="w-44 shrink-0 border-r border-subtle bg-surface flex flex-col py-2">
        {#each sections as sec}
          <button
            onclick={() => activeSection = sec.id}
            class="flex items-center gap-2.5 px-3 py-2 text-sm rounded mx-1.5 my-0.5 transition-colors text-left"
            class:bg-selected={activeSection === sec.id}
            class:text-primary={activeSection === sec.id}
            class:text-secondary={activeSection !== sec.id}
            class:hover:bg-hover={activeSection !== sec.id}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d={sec.icon}/>
            </svg>
            {sec.label}
          </button>
        {/each}
      </div>

      <!-- Main content -->
      <div class="flex-1 flex flex-col overflow-hidden">
        <!-- Search bar -->
        <div class="px-4 py-3 border-b border-subtle shrink-0">
          <div class="relative">
            <svg class="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input
              bind:this={searchInputEl}
              type="text"
              placeholder="Search settings..."
              bind:value={searchQuery}
              class="w-full pl-8 pr-3 py-1.5 text-sm rounded outline-none border bg-canvas border-subtle text-primary placeholder-muted focus:border-focus"
            />
          </div>
          <!-- Search results dropdown -->
          {#if filteredSections && filteredSections.length > 0}
            <div class="mt-1 rounded border border-subtle bg-surface-2 shadow-lg overflow-hidden absolute z-50 w-72">
              {#each filteredSections as result}
                <button
                  onclick={() => scrollToSetting(result.id)}
                  class="w-full text-left px-3 py-2 text-sm hover:bg-hover text-secondary hover:text-primary transition-colors flex items-center gap-2"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                  <span>{result.label}</span>
                  <span class="ml-auto text-xs text-muted capitalize">{result.section}</span>
                </button>
              {/each}
            </div>
          {:else if searchQuery.trim() && filteredSections?.length === 0}
            <div class="mt-1 rounded border border-subtle bg-surface-2 shadow-lg overflow-hidden absolute z-50 w-72">
              <div class="px-3 py-2 text-sm text-muted">No settings found for "{searchQuery}"</div>
            </div>
          {/if}
        </div>

        <!-- Settings content -->
        <div class="flex-1 overflow-y-auto p-5 space-y-6 text-sm text-secondary">

          <!-- APPEARANCE -->
          {#if activeSection === 'appearance'}
            <div class="space-y-1">
              <h3 class="text-xs font-semibold uppercase tracking-wider text-accent pb-2 border-b border-subtle">Appearance</h3>
            </div>

            <div id="setting-theme" class="flex items-center justify-between py-2">
              <div>
                <label for="theme" class="font-medium text-primary block">Theme</label>
                <p class="text-xs text-muted mt-0.5">Controls the overall color scheme of the application.</p>
              </div>
              <Select id="theme"
                class="w-44"
                options={[{value: 'light', label: 'Light'}, {value: 'dark', label: 'Dark'}, {value: 'system', label: 'System Default'}]}
                value={settingsStore.effectiveSettings.theme}
                onchange={(v) => handleSave('theme', v)}
              />
            </div>

            <div id="setting-fontFamily" class="flex items-center justify-between py-2">
              <div>
                <label for="fontFamily" class="font-medium text-primary block">Font Family</label>
                <p class="text-xs text-muted mt-0.5">The font used in the code editor. Separate with commas for fallbacks.</p>
              </div>
              <input id="fontFamily"
                class="rounded p-1.5 text-sm outline-none w-56 border bg-canvas border-subtle text-primary focus:border-focus"
                value={settingsStore.effectiveSettings.font_family}
                oninput={(e) => handleSave('font_family', (e.target as HTMLInputElement).value)}
              />
            </div>

            <div id="setting-fontSize" class="flex items-center justify-between py-2">
              <div>
                <label for="fontSize" class="font-medium text-primary block">Font Size <span class="text-muted font-normal">({settingsStore.effectiveSettings.font_size}px)</span></label>
                <p class="text-xs text-muted mt-0.5">The font size used in the editor. Min 10px, Max 32px.</p>
              </div>
              <div class="flex items-center gap-2 w-44">
                <input id="fontSize" type="range" min="10" max="32" class="flex-1" value={settingsStore.effectiveSettings.font_size} oninput={(e) => handleSave('font_size', parseInt((e.target as HTMLInputElement).value))} />
                <span class="text-xs text-muted w-8 text-right">{settingsStore.effectiveSettings.font_size}</span>
              </div>
            </div>

            <div id="setting-iconTheme" class="flex items-center justify-between py-2">
              <div>
                <label for="iconTheme" class="font-medium text-primary block">Icon Theme</label>
                <p class="text-xs text-muted mt-0.5">File icons displayed in the explorer sidebar.</p>
              </div>
              <Select id="iconTheme"
                class="w-44"
                options={[{value: 'off', label: 'Disable'}, {value: 'default', label: 'Enable'}]}
                value={settingsStore.effectiveSettings.icon_theme || 'default'}
                onchange={(v) => handleSave('icon_theme', v)}
              />
            </div>
          {/if}

          <!-- EDITOR -->
          {#if activeSection === 'editor'}
            <div class="space-y-1">
              <h3 class="text-xs font-semibold uppercase tracking-wider text-accent pb-2 border-b border-subtle">Editor</h3>
            </div>

            <div id="setting-tabSize" class="flex items-center justify-between py-2">
              <div>
                <label for="tabSize" class="font-medium text-primary block">Tab Size</label>
                <p class="text-xs text-muted mt-0.5">Number of spaces inserted when pressing Tab.</p>
              </div>
              <input id="tabSize" type="number" min="2" max="8"
                class="rounded p-1.5 text-sm outline-none w-24 border bg-canvas border-subtle text-primary focus:border-focus"
                value={settingsStore.effectiveSettings.tab_size}
                oninput={(e) => handleSave('tab_size', parseInt((e.target as HTMLInputElement).value))} />
            </div>

            <div id="setting-wordWrap" class="flex items-center justify-between py-2">
              <div>
                <label for="wordWrap" class="font-medium text-primary block">Word Wrap</label>
                <p class="text-xs text-muted mt-0.5">Wrap long lines that exceed the editor width.</p>
              </div>
              <button
                id="wordWrap"
                role="switch"
                aria-label="Toggle Word Wrap"
                aria-checked={settingsStore.effectiveSettings.word_wrap}
                onclick={() => handleSave('word_wrap', !settingsStore.effectiveSettings.word_wrap)}
                class="relative inline-flex h-5 w-9 items-center rounded-full transition-colors {settingsStore.effectiveSettings.word_wrap ? 'bg-blue-600' : 'bg-surface-2 border border-subtle'}"
              >
                <span class="inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform {settingsStore.effectiveSettings.word_wrap ? 'translate-x-4' : 'translate-x-0.5'}"></span>
              </button>
            </div>

            <div id="setting-lineNumbers" class="flex items-center justify-between py-2">
              <div>
                <label for="lineNumbers" class="font-medium text-primary block">Line Numbers</label>
                <p class="text-xs text-muted mt-0.5">Show or hide line numbers in the editor gutter.</p>
              </div>
              <button
                id="lineNumbers"
                role="switch"
                aria-label="Toggle Line Numbers"
                aria-checked={settingsStore.effectiveSettings.line_numbers}
                onclick={() => handleSave('line_numbers', !settingsStore.effectiveSettings.line_numbers)}
                class="relative inline-flex h-5 w-9 items-center rounded-full transition-colors {settingsStore.effectiveSettings.line_numbers ? 'bg-blue-600' : 'bg-surface-2 border border-subtle'}"
              >
                <span class="inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform {settingsStore.effectiveSettings.line_numbers ? 'translate-x-4' : 'translate-x-0.5'}"></span>
              </button>
            </div>
          {/if}

          <!-- AUTO SAVE -->
          {#if activeSection === 'autosave'}
            <div class="space-y-1">
              <h3 class="text-xs font-semibold uppercase tracking-wider text-accent pb-2 border-b border-subtle">Auto Save</h3>
            </div>

            <div id="setting-autoSave" class="flex items-center justify-between py-2">
              <div>
                <label for="autoSaveToggle" class="font-medium text-primary block">Enable Auto Save</label>
                <p class="text-xs text-muted mt-0.5">Automatically save modified files after a delay.</p>
              </div>
              <button
                id="autoSaveToggle"
                role="switch"
                aria-label="Toggle Auto Save"
                aria-checked={settingsStore.effectiveSettings.auto_save}
                onclick={() => handleSave('auto_save', !settingsStore.effectiveSettings.auto_save)}
                class="relative inline-flex h-5 w-9 items-center rounded-full transition-colors {settingsStore.effectiveSettings.auto_save ? 'bg-blue-600' : 'bg-surface-2 border border-subtle'}"
              >
                <span class="inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform {settingsStore.effectiveSettings.auto_save ? 'translate-x-4' : 'translate-x-0.5'}"></span>
              </button>
            </div>

            {#if settingsStore.effectiveSettings.auto_save}
              <div id="setting-autoSaveDelay" class="flex items-center justify-between py-2">
                <div>
                  <label for="autoSaveDelay" class="font-medium text-primary block">Auto Save Delay <span class="text-muted font-normal">({settingsStore.effectiveSettings.auto_save_delay_ms}ms)</span></label>
                  <p class="text-xs text-muted mt-0.5">How long to wait after the last change before auto-saving.</p>
                </div>
                <div class="flex items-center gap-2 w-44">
                  <input id="autoSaveDelay" type="range" min="500" max="10000" step="500" class="flex-1" value={settingsStore.effectiveSettings.auto_save_delay_ms} oninput={(e) => handleSave('auto_save_delay_ms', parseInt((e.target as HTMLInputElement).value))} />
                  <span class="text-xs text-muted w-12 text-right">{settingsStore.effectiveSettings.auto_save_delay_ms}ms</span>
                </div>
              </div>
            {/if}
          {/if}

          <!-- FILES -->
          {#if activeSection === 'files'}
            <div class="space-y-1">
              <h3 class="text-xs font-semibold uppercase tracking-wider text-accent pb-2 border-b border-subtle">Files</h3>
            </div>

            <div id="setting-defaultEncoding" class="flex items-center justify-between py-2">
              <div>
                <label for="defaultEncoding" class="font-medium text-primary block">Default Encoding</label>
                <p class="text-xs text-muted mt-0.5">The character encoding used when reading and writing files.</p>
              </div>
              <Select id="defaultEncoding"
                class="w-44"
                options={['UTF-8', 'UTF-16', 'ISO-8859-1']}
                value={settingsStore.effectiveSettings.default_encoding}
                onchange={(v) => handleSave('default_encoding', v)}
              />
            </div>
          {/if}

        </div>
      </div>
    </div>
  {/snippet}
</Modal>
