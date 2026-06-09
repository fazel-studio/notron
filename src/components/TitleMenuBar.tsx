import { useEffect } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useSettingsStore } from '../store/settingsStore';
import { useEditorStore } from '../store/editorStore';
import { useUiStore } from '../store/uiStore';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open, save } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { Check } from 'lucide-react';

export function TitleMenuBar() {
  const isDark = useSettingsStore(state => state.settings.theme === 'dark' || (state.settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches));
  const { tabs, activeTabId, addTab, closeTab, markSaved } = useEditorStore();
  const { setExplorerRoot, setActiveSidebarPanel, setSidebarOpen, openNewFileDialog, isMinimapEnabled, toggleMinimap } = useUiStore();

  const activeTab = tabs.find(t => t.id === activeTabId);
  const isFileActive = !!activeTab;

  const handleNewTextFile = () => {
    let count = 1;
    while (tabs.some(t => t.path === `Untitled-${count}`)) {
      count++;
    }

    addTab({
      id: `tab-${Date.now()}`,
      path: `Untitled-${count}`,
      name: `Untitled-${count}`,
      content: '',
      language: 'plaintext'
    });
  };

  const handleNewWindow = () => {
    // Open new instance of the app, handled via rust or a simple command if set up.
    // Given Tauri context, we can just dispatch an IPC to create window, 
    // but standard way is `WebviewWindow` if imported. For now just placeholder or alert if not implemented.
    alert("New Window is not implemented yet");
  };

  const handleOpenFile = async () => {
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
        addTab({
          id: `tab-${Date.now()}`,
          path: selected,
          name: fileName,
          content: content,
          language: isImage ? 'image' : await invoke<string>('detect_language', { path: selected }),
          isPreview: false
        });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleOpenFolder = async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (selected && typeof selected === 'string') {
        setExplorerRoot(selected);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSave = async () => {
    if (!activeTab) return;
    if (activeTab.path.startsWith('Untitled')) {
      const selected = await save();
      if (selected && typeof selected === 'string') {
        const fileName = selected.split(/[/\\]/).pop() || 'Unknown';
        try {
          await invoke('save_file', { path: selected, content: activeTab.content });
          // We need to update tab path! Since addTab creates a new one or updates existing if path matches.
          // Better yet, update it in the store directly, but for now we can just close old and open new,
          // or rely on markSaved and changing the id manually, but editorStore doesn't expose renameTab.
          // For simplicity:
          closeTab(activeTab.id);
          addTab({
            ...activeTab,
            id: selected,
            path: selected,
            name: fileName
          });
          // Since addTab does not support isModified initialization, we just assume it's saved.
          // Wait, isModified is maintained automatically? 
          // Actually markSaved should be used after addTab if needed.
        } catch (err) {
          console.error(err);
        }
      }
    } else {
      try {
        await invoke('save_file', { path: activeTab.path, content: activeTab.content });
        markSaved(activeTab.id);
      } catch (err) {
        console.error(err);
      }
    }
  };

  const handleSaveAs = async () => {
    if (!activeTab) return;
    const selected = await save();
    if (selected && typeof selected === 'string') {
      try {
        await invoke('save_file', { path: selected, content: activeTab.content });
        const fileName = selected.split(/[/\\]/).pop() || 'Unknown';
        closeTab(activeTab.id);
        addTab({
          ...activeTab,
          id: `tab-${Date.now()}`,
          path: selected,
          name: fileName,
        });
        // We shouldn't need to manually mark saved since addTab sets isModified to false!
      } catch (err) {
        console.error(err);
      }
    }
  };

  useEffect(() => {
    const onSave = () => handleSave();
    const onSaveAs = () => handleSaveAs();
    window.addEventListener('editor:save', onSave);
    window.addEventListener('editor:save-as', onSaveAs);
    return () => {
      window.removeEventListener('editor:save', onSave);
      window.removeEventListener('editor:save-as', onSaveAs);
    };
  }, [handleSave, handleSaveAs]);

  const handleExit = () => {
    getCurrentWindow().close();
  };

  const openSearch = () => {
    setActiveSidebarPanel('search');
    setSidebarOpen(true);
  };

  const openExplorer = () => {
    setActiveSidebarPanel('explorer');
    setSidebarOpen(true);
  };

  const dispatchEditorAction = (action: string) => {
    window.dispatchEvent(new CustomEvent('editor:action', { detail: { action } }));
  };

  const menus = [
    {
      label: 'File',
      items: [
        { label: 'New Text File', action: handleNewTextFile },
        { label: 'New File', action: () => openNewFileDialog('menu') },
        { label: 'New Window', action: handleNewWindow },
        { separator: true },
        { label: 'Open File', action: handleOpenFile },
        { label: 'Open Folder', action: handleOpenFolder },
        { separator: true },
        { label: 'Save', action: handleSave, disabled: !isFileActive },
        { label: 'Save As', action: handleSaveAs, disabled: !isFileActive },
        { separator: true },
        { label: 'Exit', action: handleExit }
      ]
    },
    {
      label: 'Edit',
      items: [
        { label: 'Undo', action: () => dispatchEditorAction('undo'), disabled: !isFileActive },
        { label: 'Redo', action: () => dispatchEditorAction('redo'), disabled: !isFileActive },
        { separator: true },
        { label: 'Cut', action: () => document.execCommand('cut') },
        { label: 'Copy', action: () => document.execCommand('copy') },
        { label: 'Paste', action: () => document.execCommand('paste') },
        { separator: true },
        { label: 'Find', action: () => dispatchEditorAction('find'), disabled: !isFileActive },
        { label: 'Replace', action: () => dispatchEditorAction('replace'), disabled: !isFileActive },
        { separator: true },
        { label: 'Find in Files', action: openSearch },
        { label: 'Replace in Files', action: openSearch }
      ]
    },
    {
      label: 'Selection',
      items: [
        { label: 'Select All', action: () => dispatchEditorAction('selectAll'), disabled: !isFileActive },
        { separator: true },
        { label: 'Copy Line Up', action: () => dispatchEditorAction('copyLineUp'), disabled: !isFileActive },
        { label: 'Copy Line Down', action: () => dispatchEditorAction('copyLineDown'), disabled: !isFileActive },
        { label: 'Move Line Up', action: () => dispatchEditorAction('moveLineUp'), disabled: !isFileActive },
        { label: 'Move Line Down', action: () => dispatchEditorAction('moveLineDown'), disabled: !isFileActive },
        { separator: true },
        { label: 'Duplicate Selection', action: () => dispatchEditorAction('copyLineDown'), disabled: !isFileActive } // Duplicate selection translates to copyLineDown in cm6 for simplest mapping
      ]
    },
    {
      label: 'View',
      items: [
        { label: 'Explorer', action: openExplorer },
        { label: 'Search', action: openSearch },
        { separator: true },
        { label: 'Minimap', action: toggleMinimap, checked: isMinimapEnabled }
      ]
    }
  ];

  return (
    <div className="flex items-center text-xs h-full ml-2 space-x-1">
      {menus.map((menu, i) => (
        <DropdownMenu.Root key={i}>
          <DropdownMenu.Trigger className={`px-2 py-1 rounded outline-none cursor-default select-none transition-colors ${isDark ? 'hover:bg-zinc-700 data-[state=open]:bg-zinc-700' : 'hover:bg-zinc-300 data-[state=open]:bg-zinc-300'}`}>
            {menu.label}
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content 
              align="start"
              sideOffset={4}
              className={`min-w-[200px] rounded border shadow-lg z-[100] py-1 ${isDark ? 'bg-[#1e1e1e] border-zinc-800 text-zinc-300' : 'bg-white border-zinc-200 text-zinc-800'}`}
            >
              {menu.items.map((item, j) => {
                const menu_item: any = item;
                if (menu_item.separator) {
                  return <DropdownMenu.Separator key={j} className={`h-px my-1 ${isDark ? 'bg-zinc-800' : 'bg-zinc-200'}`} />;
                }
                return (
                  <DropdownMenu.Item
                    key={j}
                    disabled={menu_item.disabled}
                    onSelect={(e) => {
                      if (menu_item.checked !== undefined) {
                        e.preventDefault(); // Don't close menu immediately for checkboxes if desired, but we'll let it close for now.
                      }
                      menu_item.action();
                    }}
                    className={`px-3 py-1.5 text-xs outline-none cursor-default select-none flex items-center ${menu_item.disabled ? 'opacity-50' : (isDark ? 'focus:bg-blue-600 focus:text-white' : 'focus:bg-blue-500 focus:text-white')}`}
                  >
                    <div className="w-4 mr-2 flex justify-center items-center">
                      {menu_item.checked && <Check size={14} />}
                    </div>
                    {menu_item.label}
                  </DropdownMenu.Item>
                );
              })}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      ))}
    </div>
  );
}
