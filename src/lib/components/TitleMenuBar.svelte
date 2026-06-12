<script lang="ts">
  import { editorStore } from '../stores/editor';
  import { uiStore } from '../stores/ui';
    import { getCurrentWindow } from '@tauri-apps/api/window';
  import { open, save } from '@tauri-apps/plugin-dialog';
  import { invoke } from '@tauri-apps/api/core';

  const tabs = editorStore.tabs;
  const activeTabId = editorStore.activeTabId;
  const ui = uiStore;

  let activeTab = $derived($tabs.find(t => t.id === $activeTabId) || null);
  let isFileActive = $derived(!!activeTab);

  let openMenu = $state<string | null>(null);

  function handleNewTextFile() {
    let count = 1;
    const tabsSnapshot = editorStore.getTabsSnapshot();
    while (tabsSnapshot.some((t: any) => t.path === `Untitled-${count}`)) count++;
    const name = `Untitled-${count}`;
    const id = `tab-${Date.now()}`;
    editorStore.addTab({ id, path: name, name, content: '', language: 'plaintext', isPreview: false });
    editorStore.setActiveTab(id);
    closeAll();
  }

  function handleNewWindow() { alert("New Window is not implemented yet"); }

  async function handleOpenFile() {
    try {
      const selected = await open({ multiple: false });
      if (selected && typeof selected === 'string') {
        const fileName = selected.split(/[/\\]/).pop() || 'Unknown';
        let content = '';
        const isImage = /\.(png|jpe?g|gif|webp|svg|ico)$/i.test(fileName);
        if (!isImage) {
          const bytes = await invoke<number[]>('read_file_binary', { path: selected });
          content = new TextDecoder('utf-8').decode(new Uint8Array(bytes)).replace(/\r\n/g, '\n');
        }
        editorStore.addTab({
          id: `tab-${Date.now()}`, path: selected, name: fileName, content,
          language: isImage ? 'image' : await invoke<string>('detect_language', { path: selected }),
          isPreview: false
        });
      }
    } catch (err) { console.error(err); }
    closeAll();
  }

  async function handleOpenFolder() {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (selected && typeof selected === 'string') uiStore.setExplorerRoot(selected);
    } catch (err) { console.error(err); }
    closeAll();
  }

  async function handleSave() {
    if (!activeTab) return;
    if (activeTab.path.startsWith('Untitled')) {
      const selected = await save();
      if (selected && typeof selected === 'string') {
        const fileName = selected.split(/[/\\]/).pop() || 'Unknown';
        try {
          await invoke('save_file', { path: selected, content: activeTab.content });
          editorStore.closeTab(activeTab.id);
          editorStore.addTab({ ...activeTab, id: selected, path: selected, name: fileName });
        } catch (err) { console.error(err); }
      }
    } else {
      try {
        await invoke('save_file', { path: activeTab.path, content: activeTab.content });
        editorStore.markSaved(activeTab.id);
      } catch (err) { console.error(err); }
    }
    closeAll();
  }

  async function handleSaveAs() {
    if (!activeTab) return;
    const selected = await save();
    if (selected && typeof selected === 'string') {
      try {
        await invoke('save_file', { path: selected, content: activeTab.content });
        const fileName = selected.split(/[/\\]/).pop() || 'Unknown';
        editorStore.closeTab(activeTab.id);
        editorStore.addTab({ ...activeTab, id: `tab-${Date.now()}`, path: selected, name: fileName });
      } catch (err) { console.error(err); }
    }
    closeAll();
  }

  function handleExit() { getCurrentWindow().close(); }

  function openSearch() { uiStore.setActiveSidebarPanel('search'); uiStore.setSidebarOpen(true); closeAll(); }
  function openExplorer() { uiStore.setActiveSidebarPanel('explorer'); uiStore.setSidebarOpen(true); closeAll(); }

  function dispatchEditorAction(action: string) {
    window.dispatchEvent(new CustomEvent('editor:action', { detail: { action } }));
    closeAll();
  }

  function closeAll() { openMenu = null; }

  $effect(() => {
    const onSave = () => handleSave();
    const onSaveAs = () => handleSaveAs();
    window.addEventListener('editor:save', onSave);
    window.addEventListener('editor:save-as', onSaveAs);
    return () => {
      window.removeEventListener('editor:save', onSave);
      window.removeEventListener('editor:save-as', onSaveAs);
    };
  });

  function toggleMenu(name: string) {
    openMenu = openMenu === name ? null : name;
  }

  function isDisabled() { return !isFileActive; }
  function isMinimapChecked() { return $ui.isMinimapEnabled; }

  const menus = [
    {
      label: 'File', items: [
        { label: 'New Text File', action: handleNewTextFile },
        { label: 'New File', action: () => { uiStore.openNewFileDialog('menu'); closeAll(); } },
        { label: 'New Window', action: handleNewWindow, sep: true },
        { label: 'Open File', action: handleOpenFile },
        { label: 'Open Folder', action: handleOpenFolder, sep: true },
        { label: 'Save', action: handleSave, disabled: isDisabled },
        { label: 'Save As', action: handleSaveAs, disabled: isDisabled, sep: true },
        { label: 'Exit', action: handleExit }
      ]
    },
    {
      label: 'Edit', items: [
        { label: 'Undo', action: () => dispatchEditorAction('undo'), disabled: isDisabled },
        { label: 'Redo', action: () => dispatchEditorAction('redo'), disabled: isDisabled, sep: true },
        { label: 'Cut', action: () => document.execCommand('cut') },
        { label: 'Copy', action: () => document.execCommand('copy') },
        { label: 'Paste', action: () => document.execCommand('paste'), sep: true },
        { label: 'Find', action: () => dispatchEditorAction('find'), disabled: isDisabled },
        { label: 'Replace', action: () => dispatchEditorAction('replace'), disabled: isDisabled, sep: true },
        { label: 'Find in Files', action: openSearch },
        { label: 'Replace in Files', action: openSearch }
      ]
    },
    {
      label: 'Selection', items: [
        { label: 'Select All', action: () => dispatchEditorAction('selectAll'), disabled: isDisabled, sep: true },
        { label: 'Copy Line Up', action: () => dispatchEditorAction('copyLineUp'), disabled: isDisabled },
        { label: 'Copy Line Down', action: () => dispatchEditorAction('copyLineDown'), disabled: isDisabled },
        { label: 'Move Line Up', action: () => dispatchEditorAction('moveLineUp'), disabled: isDisabled },
        { label: 'Move Line Down', action: () => dispatchEditorAction('moveLineDown'), disabled: isDisabled, sep: true },
        { label: 'Duplicate Selection', action: () => dispatchEditorAction('copyLineDown'), disabled: isDisabled }
      ]
    },
    {
      label: 'View', items: [
        { label: 'Explorer', action: openExplorer },
        { label: 'Search', action: openSearch, sep: true },
        { label: 'Welcome Page', action: () => {
            const w = $tabs.find((t: any) => t.language === 'welcome');
            if (w) editorStore.setActiveTab(w.id);
            else editorStore.addTab({ id: 'welcome', path: 'Welcome', name: 'Welcome', content: '', language: 'welcome', isPreview: true });
            closeAll();
          }, checked: () => $tabs.some((t: any) => t.language === 'welcome') },
        { label: 'Minimap', action: () => { uiStore.toggleMinimap(); closeAll(); }, checked: isMinimapChecked }
      ]
    }
  ];
</script>

<svelte:window onclick={closeAll} />

<div class="flex items-center text-xs h-full ml-2 space-x-1">
  {#each menus as menu (menu.label)}
    <div class="relative">
      <button
        class="px-2 py-1 rounded outline-none cursor-pointer select-none transition-colors hover:bg-hover hover:text-primary"
        class:bg-selected={openMenu === menu.label}
        class:text-primary={openMenu === menu.label}
        onclick={(e) => { e.stopPropagation(); toggleMenu(menu.label); }}
      >
        {menu.label}
      </button>

      {#if openMenu === menu.label}
        <div
          role="menu"
          tabindex="0"
          class="absolute top-full left-0 min-w-[200px] rounded border shadow-lg z-[100] py-1 bg-surface-2 border-subtle text-primary"
          onclick={(e) => { e.stopPropagation(); closeAll(); }}
          onkeydown={(e) => { if (e.key === 'Escape') closeAll(); }}
        >
          {#each menu.items as item (item.label)}
              <button
                class="flex items-center w-full px-3 py-1.5 text-xs outline-none cursor-pointer select-none {!(item as any).disabled?.() ? 'hover:bg-selected focus:bg-selected text-secondary hover:text-primary transition-colors' : 'text-muted'}"
                disabled={(item as any).disabled?.()}
                onclick={() => { if (!((item as any).disabled?.())) { (item as any).action(); } }}
                onmouseenter={(e) => (e.target as HTMLElement).focus()}
              >
                <div class="w-4 mr-2 flex justify-center items-center">
                  {#if (item as any).checked?.()}<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>{/if}
                </div>
                {(item as any).label}
              </button>
            {#if (item as any).sep}
              <div class="h-px my-1 bg-subtle"></div>
            {/if}
          {/each}
        </div>
      {/if}
    </div>
  {/each}
</div>
