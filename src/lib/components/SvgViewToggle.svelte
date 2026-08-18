<script lang="ts">
  import DropdownMenu, { type DropdownMenuItem } from './DropdownMenu.svelte';
  import { editorStore } from '../stores/editor';
  import { splitStore } from '../stores/split';
  import { settingsStore } from '../stores/settings.svelte';
  import { ChevronDown } from 'lucide-svelte';

  let { activeTab } = $props<{ activeTab: any }>();

  let svgViewMode = $derived(activeTab?.svgViewMode || settingsStore.effectiveSettings.default_svg_view || 'image');
  
  let currentSvgViewLabel = $derived.by(() => {
    if (svgViewMode === 'image') return 'Image Preview';
    if (svgViewMode === 'code') return 'Text Editor';
    if (svgViewMode === 'split') return 'Preview & Text';
    return 'Image Preview';
  });

  function setSvgViewMode(mode: 'image' | 'code' | 'split') {
    if (activeTab) {
      editorStore.updateTab(activeTab.id, { svgViewMode: mode });
      splitStore.updateTabInAllPanes({ id: activeTab.id, svgViewMode: mode });
    }
  }

  function setSvgDefault(mode: 'image' | 'code' | 'split') {
    settingsStore.updateSetting('default_svg_view', mode, 'global');
    if (activeTab) {
      editorStore.updateTab(activeTab.id, { svgViewMode: mode });
      splitStore.updateTabInAllPanes({ id: activeTab.id, svgViewMode: mode });
    }
  }

  let svgMenuItems = $derived<DropdownMenuItem[]>([
    { label: 'Image Preview', action: () => setSvgViewMode('image') },
    { label: 'Text Editor', action: () => setSvgViewMode('code') },
    { label: 'Preview & Text', action: () => setSvgViewMode('split') },
    { separator: true, label: '' },
    { 
      label: 'Set default...', 
      id: 'default',
      items: [
        { label: 'Image Preview', action: () => setSvgDefault('image') },
        { label: 'Text Editor', action: () => setSvgDefault('code') },
        { label: 'Preview & Text', action: () => setSvgDefault('split') }
      ]
    }
  ]);
</script>

<div>
  <DropdownMenu items={svgMenuItems} align="right">
    {#snippet trigger()}
      <button class="flex items-center gap-1.5 px-2 py-1.5 text-xs rounded-md transition-colors text-icon-default hover:text-icon-active hover:bg-hover">
        {currentSvgViewLabel}
        <ChevronDown size={14} class="opacity-50" />
      </button>
    {/snippet}
  </DropdownMenu>
</div>
