import { useEffect, useState } from "react";
import { useUiStore } from "./store/uiStore";
import { useEditorStore } from "./store/editorStore";
import { useSettingsStore } from "./store/settingsStore";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";
import { watch } from "@tauri-apps/plugin-fs";
import { X, Minus, Square, File, Search, Settings, FilePlus, FolderPlus, RefreshCw, ListCollapse, Eye } from "lucide-react";
import Editor from "./components/Editor";
import CommandPalette from "./components/CommandPalette";
import CsvEditor from "./components/CsvEditor";
import ImageViewer from "./components/ImageViewer";
import FileTree from "./components/FileTree";
import SettingsPage from "./components/SettingsPage";
import MarkdownPreview from "./components/MarkdownPreview";
import GoToLineDialog from "./components/GoToLineDialog";
import ConvertDialog from "./components/ConvertDialog";
import SearchPanel from "./components/SearchPanel";
import { Tooltip, TooltipProvider } from "./components/Tooltip";
import { TitleMenuBar } from "./components/TitleMenuBar";
import { CloseTabDialog } from "./components/CloseTabDialog";
import { WelcomeTab } from "./components/WelcomeTab";
import { NewFileDialog } from "./components/NewFileDialog";

function App() {
  const { isSidebarOpen, sidebarWidth, toggleSidebar, activeSidebarPanel, setActiveSidebarPanel, setSidebarOpen, explorerRoot, setExplorerRoot, setSidebarWidth, selectedExplorerPath, setSelectedExplorerPath, setCreatingItem, triggerExplorerRefresh, triggerExplorerCollapse, isNewFileDialogOpen, newFileDialogSource, closeNewFileDialog } = useUiStore();
  const { tabs, activeTabId, addTab, closeTab, setActiveTab, pinTab } = useEditorStore();
  const { settings, setSettings } = useSettingsStore();
  
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isGoToLineOpen, setIsGoToLineOpen] = useState(false);
  const [isConvertOpen, setIsConvertOpen] = useState(false);
  const [closingTabId, setClosingTabId] = useState<string | null>(null);

  useEffect(() => {
    // Load config from Rust
    invoke("get_config").then((config) => {
      if (config) setSettings(config as any);
    }).catch(console.error);

    const timer = setTimeout(() => {
      if (!sessionStorage.getItem('hasOpenedApp')) {
        sessionStorage.setItem('hasOpenedApp', 'true');
        const currentTabs = useEditorStore.getState().tabs;
        if (currentTabs.length === 0) {
          useEditorStore.getState().addTab({
            id: 'welcome',
            path: 'Welcome',
            name: 'Welcome',
            content: '',
            language: 'welcome',
            isPreview: true
          });
        }
      }
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!explorerRoot) return;

    // Reset to default state first to prevent bleed-over from previous workspace
    useUiStore.getState().setExpandedPaths([]);
    useUiStore.getState().setSidebarWidth(240);
    useUiStore.getState().setActiveSidebarPanel('explorer');
    useEditorStore.getState().setTabs([], null);

    // Load state
    const saved = localStorage.getItem(`workspace_${explorerRoot}`);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.sidebarWidth !== undefined) useUiStore.getState().setSidebarWidth(parsed.sidebarWidth);
        if (parsed.expandedPaths !== undefined) useUiStore.getState().setExpandedPaths(parsed.expandedPaths);
        if (parsed.tabs !== undefined) {
          useEditorStore.getState().setTabs(parsed.tabs, parsed.activeTabId || null);
        }
        if (parsed.activeSidebarPanel !== undefined) {
          useUiStore.getState().setActiveSidebarPanel(parsed.activeSidebarPanel);
        }
        if (parsed.isMinimapEnabled !== undefined) {
          useUiStore.getState().setMinimapEnabled(parsed.isMinimapEnabled);
        }
      } catch (e) {
        console.error("Failed to load workspace state", e);
      }
    }

    const saveState = () => {
      const ui = useUiStore.getState();
      const editor = useEditorStore.getState();
      const state = {
        sidebarWidth: ui.sidebarWidth,
        expandedPaths: ui.expandedPaths,
        activeSidebarPanel: ui.activeSidebarPanel,
        isMinimapEnabled: ui.isMinimapEnabled,
        tabs: editor.tabs,
        activeTabId: editor.activeTabId,
      };
      localStorage.setItem(`workspace_${explorerRoot}`, JSON.stringify(state));
    };

    const unsubUi = useUiStore.subscribe(saveState);
    const unsubEditor = useEditorStore.subscribe(saveState);

    let unwatch: (() => void) | null = null;
    let debounceTimer: number | undefined = undefined;
    let pendingPaths = new Set<string>();

    const startWatching = async () => {
      try {
        unwatch = await watch(explorerRoot, (event) => {
          clearTimeout(debounceTimer);
          (event.paths || []).forEach(p => pendingPaths.add(p));
          
          debounceTimer = setTimeout(() => {
            const changedPaths = new Set(pendingPaths);
            pendingPaths.clear();
            
            useUiStore.getState().triggerExplorerRefresh();
            
            const tabsToSync = useEditorStore.getState().tabs.filter(tab => {
              if (!tab.path || tab.path.startsWith('Untitled')) return false;
              return changedPaths.has(tab.path) || changedPaths.has(explorerRoot);
            });
            
            tabsToSync.forEach(async tab => {
              try {
                const exists = await invoke<boolean>('file_exists', { path: tab.path });
                if (!exists) {
                  useEditorStore.getState().closeTab(tab.id);
                  return;
                }
                const bytes = await invoke<number[]>('read_file_binary', { path: tab.path });
                const newContent = new TextDecoder('utf-8').decode(new Uint8Array(bytes)).replace(/\r\n/g, '\n');
                const latestTab = useEditorStore.getState().tabs.find(t => t.id === tab.id);
                if (latestTab && !latestTab.isModified && newContent !== latestTab.content) {
                  useEditorStore.getState().updateContent(tab.id, newContent);
                  useEditorStore.getState().markSaved(tab.id);
                }
              } catch (err) {}
            });
          }, 200);
        }, { recursive: true, delayMs: 0 });
      } catch (e) {
        console.error("Failed to watch explorer root:", e);
      }
    };
    
    startWatching();

    return () => {
      if (unwatch) unwatch();
      if (debounceTimer) clearTimeout(debounceTimer);
      unsubUi();
      unsubEditor();
    };
  }, [explorerRoot]);

  const handleOpenFolder = async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (selected && typeof selected === 'string') {
        setExplorerRoot(selected);
      }
    } catch (err) {
      console.error("Failed to open folder:", err);
    }
  };

  const handleOpenFile = async () => {
    try {
      const selected = await open({ multiple: false });
      if (selected && typeof selected === 'string') {
        setExplorerRoot(selected);
      }
    } catch (err) {
      console.error("Failed to open file:", err);
    }
  };

  useEffect(() => {
    if (!settings.auto_save) return;

    const modifiedTabs = tabs.filter(t => t.isModified && !t.path.startsWith('Untitled'));
    if (modifiedTabs.length === 0) return;

    const timer = setTimeout(() => {
      modifiedTabs.forEach(async (tab) => {
        try {
          await invoke('save_file', { path: tab.path, content: tab.content });
          useEditorStore.getState().markSaved(tab.id);
        } catch (err) {
          console.error("Auto save failed for", tab.path, err);
        }
      });
    }, settings.auto_save_delay_ms || 2000);

    return () => clearTimeout(timer);
  }, [tabs, settings.auto_save, settings.auto_save_delay_ms]);

  const commands = [
    { id: 'new-file', name: 'New File', shortcut: 'Ctrl+N', action: () => {
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
    }},
    { id: 'toggle-sidebar', name: 'Toggle Sidebar', shortcut: 'Ctrl+B', action: toggleSidebar },
    { id: 'settings', name: 'Settings', shortcut: 'Ctrl+,', action: () => setIsSettingsOpen(true) },
    { id: 'go-to-line', name: 'Go to Line', shortcut: 'Ctrl+G', action: () => setIsGoToLineOpen(true) },
    { id: 'convert-file', name: 'Convert File', action: () => setIsConvertOpen(true) }
  ];

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setIsCommandPaletteOpen(true);
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        commands.find(c => c.id === 'new-file')?.action();
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggleSidebar();
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        setIsGoToLineOpen(true);
      }
      if (e.ctrlKey && e.key === ',') {
        e.preventDefault();
        setIsSettingsOpen(true);
      }
      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('editor:save'));
      }
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('editor:save-as'));
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      // Prevent the default browser context menu globally
      // so we can build custom context menus in the future
      e.preventDefault();
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    window.addEventListener('contextmenu', handleContextMenu);
    
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
      window.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [commands, toggleSidebar]);

  const activeTab = tabs.find(t => t.id === activeTabId);
  const isDark = settings.theme === 'dark' || (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  const handleTabClose = (tabId: string) => {
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return;
    
    if (tab.isModified || (tab.path.startsWith('Untitled') && tab.content.trim() !== '')) {
      setClosingTabId(tabId);
    } else {
      closeTab(tabId);
    }
  };

  const handleCloseSave = async () => {
    if (!closingTabId) return;
    const tab = tabs.find(t => t.id === closingTabId);
    if (!tab) return;
    
    if (tab.path.startsWith('Untitled')) {
      const selected = await save();
      if (selected && typeof selected === 'string') {
        // Here we should save the file via rust, assuming it succeeds:
        closeTab(closingTabId);
      }
    } else {
      // Save existing file via rust, assuming it succeeds:
      closeTab(closingTabId);
    }
    setClosingTabId(null);
  };

  return (
    <TooltipProvider>
    <div className={`h-screen w-screen flex flex-col overflow-hidden ${isDark ? 'bg-zinc-900 text-zinc-100' : 'bg-white text-zinc-900'}`}>
      <CommandPalette isOpen={isCommandPaletteOpen} onClose={() => setIsCommandPaletteOpen(false)} commands={commands} />
      <SettingsPage isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
      <GoToLineDialog isOpen={isGoToLineOpen} onClose={() => setIsGoToLineOpen(false)} onGoToLine={(line) => console.log('Go to line', line)} />
      <ConvertDialog isOpen={isConvertOpen} onClose={() => setIsConvertOpen(false)} activeFilePath={activeTab?.path} />
      <CloseTabDialog 
        isOpen={!!closingTabId} 
        fileName={tabs.find(t => t.id === closingTabId)?.name || 'Untitled'}
        onClose={() => setClosingTabId(null)}
        onCancel={() => setClosingTabId(null)}
        onDontSave={() => {
          if (closingTabId) closeTab(closingTabId);
          setClosingTabId(null);
        }}
        onSave={handleCloseSave}
      />
      <NewFileDialog
        isOpen={isNewFileDialogOpen}
        onClose={closeNewFileDialog}
        isFromWelcome={newFileDialogSource === 'welcome'}
      />

      {/* Titlebar */}
      <div data-tauri-drag-region className={`h-8 flex items-center justify-between px-2 select-none ${isDark ? 'bg-zinc-800 text-zinc-300' : 'bg-zinc-200 text-zinc-700'}`}>
        <div className="flex items-center">
          <img src="/notron.png" alt="Notron Logo" className="w-4 h-4 ml-1 pointer-events-none" />
          <TitleMenuBar />
        </div>
        <div className="text-xs opacity-70 pointer-events-none">
          {activeTab?.name || ''}
        </div>
        <div className="flex items-center">
          {/* Custom window controls for Tauri - Transparent background */}
          <button onClick={() => getCurrentWindow().minimize()} className={`p-2 bg-transparent transition-colors ${isDark ? 'hover:bg-zinc-700 text-zinc-400 hover:text-zinc-100' : 'hover:bg-zinc-300 text-zinc-600 hover:text-zinc-900'}`}><Minus size={14} /></button>
          <button onClick={() => getCurrentWindow().toggleMaximize()} className={`p-2 bg-transparent transition-colors ${isDark ? 'hover:bg-zinc-700 text-zinc-400 hover:text-zinc-100' : 'hover:bg-zinc-300 text-zinc-600 hover:text-zinc-900'}`}><Square size={12} /></button>
          <button onClick={() => getCurrentWindow().close()} className={`p-2 bg-transparent transition-colors ${isDark ? 'hover:bg-red-500 text-zinc-400 hover:text-white' : 'hover:bg-red-500 text-zinc-600 hover:text-white'}`}><X size={14} /></button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Activity Bar */}
        <div className={`w-12 flex flex-col items-center py-0 justify-between z-10 border-r ${isDark ? 'bg-zinc-800 border-zinc-900' : 'bg-zinc-100 border-zinc-300'}`}>
          <div className="flex flex-col items-center gap-1 w-full mt-2">
            <button 
              onClick={() => {
                if (activeSidebarPanel === 'explorer' && isSidebarOpen) setSidebarOpen(false);
                else { setActiveSidebarPanel('explorer'); setSidebarOpen(true); }
              }} 
              className={`p-2 bg-transparent cursor-pointer relative ${activeSidebarPanel === 'explorer' && isSidebarOpen ? 'text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
              title="Explorer"
            >
              <File size={24} strokeWidth={1.5} />
              {activeSidebarPanel === 'explorer' && isSidebarOpen && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-8 bg-blue-500 rounded-r-full" />}
            </button>
            <button 
              onClick={() => {
                if (activeSidebarPanel === 'search' && isSidebarOpen) setSidebarOpen(false);
                else { setActiveSidebarPanel('search'); setSidebarOpen(true); }
              }}
              className={`p-2 bg-transparent cursor-pointer relative ${activeSidebarPanel === 'search' && isSidebarOpen ? 'text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
              title="Search"
            >
              <Search size={24} strokeWidth={1.5} />
              {activeSidebarPanel === 'search' && isSidebarOpen && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-8 bg-blue-500 rounded-r-full" />}
            </button>
          </div>
          <button onClick={() => setIsSettingsOpen(true)} className="p-2 bg-transparent text-zinc-500 hover:text-zinc-300 cursor-pointer mb-2" title="Settings">
            <Settings size={24} strokeWidth={1.5} />
          </button>
        </div>

        {/* Sidebar */}
        {isSidebarOpen && (
          <div style={{ width: sidebarWidth }} className={`flex flex-col border-r z-0 relative shrink-0 ${isDark ? 'border-zinc-800 bg-[#181818]' : 'border-zinc-300 bg-zinc-50'}`}>
            {/* Drag Handle for Resizing */}
            <div 
              className="absolute right-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-blue-500 active:bg-blue-500 z-50 transition-colors delay-100"
              onMouseDown={(e) => {
                e.preventDefault();
                const startX = e.clientX;
                const startWidth = sidebarWidth;
                
                const handleMouseMove = (mouseEvent: MouseEvent) => {
                  const newWidth = Math.max(160, Math.min(startWidth + (mouseEvent.clientX - startX), 600));
                  setSidebarWidth(newWidth);
                };
                
                const handleMouseUp = (mouseEvent: MouseEvent) => {
                  document.removeEventListener('mousemove', handleMouseMove);
                  document.removeEventListener('mouseup', handleMouseUp);
                  const finalWidth = Math.max(160, Math.min(startWidth + (mouseEvent.clientX - startX), 600));
                  if (explorerRoot) {
                    localStorage.setItem(`workspace_${explorerRoot}`, JSON.stringify({ sidebarWidth: finalWidth }));
                  }
                };
                
                document.addEventListener('mousemove', handleMouseMove);
                document.addEventListener('mouseup', handleMouseUp);
              }}
            />
            {/* Sidebar Title matched to Tab height (h-9) */}
            <div className="h-9 flex items-center px-4 text-xs font-semibold text-zinc-300 tracking-widest select-none uppercase">
              {activeSidebarPanel === 'explorer' ? 'Explorer' : 'Search'}
            </div>
            <div className="flex-1 overflow-y-auto text-sm">
              {activeSidebarPanel === 'explorer' ? (
                <div className="flex flex-col h-full">
                  {explorerRoot ? (
                    <div className="flex flex-col h-full">
                      <div className="group flex items-center justify-between px-4 py-2 border-b border-zinc-800">
                        <span className="text-xs font-semibold text-zinc-400 uppercase truncate pr-2">
                          {explorerRoot.split(/[/\\]/).pop() || 'WORKSPACE'}
                        </span>
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                          <Tooltip content="New File">
                            <button 
                              onClick={() => setCreatingItem({ type: 'file', parentPath: selectedExplorerPath || explorerRoot || '' })}
                              className="p-1 hover:bg-zinc-700 rounded text-zinc-400 hover:text-white transition-colors"
                            >
                              <FilePlus size={14} />
                            </button>
                          </Tooltip>
                          <Tooltip content="New Folder">
                            <button 
                              onClick={() => setCreatingItem({ type: 'folder', parentPath: selectedExplorerPath || explorerRoot || '' })}
                              className="p-1 hover:bg-zinc-700 rounded text-zinc-400 hover:text-white transition-colors"
                            >
                              <FolderPlus size={14} />
                            </button>
                          </Tooltip>
                          <Tooltip content="Refresh Explorer">
                            <button 
                              onClick={triggerExplorerRefresh}
                              className="p-1 hover:bg-zinc-700 rounded text-zinc-400 hover:text-white transition-colors"
                            >
                              <RefreshCw size={14} />
                            </button>
                          </Tooltip>
                          <Tooltip content="Collapse Folders in Explorer">
                            <button 
                              onClick={triggerExplorerCollapse}
                              className="p-1 hover:bg-zinc-700 rounded text-zinc-400 hover:text-white transition-colors"
                            >
                              <ListCollapse size={14} />
                            </button>
                          </Tooltip>
                        </div>
                      </div>
                      <div 
                        className={`flex-1 flex flex-col overflow-y-auto p-2 outline-none transition-all ${selectedExplorerPath === explorerRoot ? 'bg-blue-500/5 ring-1 ring-inset ring-blue-500/50' : ''}`}
                        onClick={(e) => {
                          if (e.target === e.currentTarget) {
                            setSelectedExplorerPath(explorerRoot);
                          }
                        }}
                      >
                        <FileTree rootPath={explorerRoot} />
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 flex flex-col gap-3">
                      <span className="text-xs text-zinc-500">You have not yet opened a folder.</span>
                      <div className="flex flex-col gap-2">
                        <button onClick={handleOpenFolder} className="bg-blue-600 hover:bg-blue-500 text-white text-xs py-1.5 px-3 rounded text-center w-full cursor-pointer transition-colors">
                          Open Folder
                        </button>
                        <button onClick={handleOpenFile} className="bg-zinc-700 hover:bg-zinc-600 text-white text-xs py-1.5 px-3 rounded text-center w-full cursor-pointer transition-colors">
                          Open File
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col h-full overflow-hidden">
                  <SearchPanel />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Main Content Area */}
        <div className={`flex flex-1 flex-col overflow-hidden ${isDark ? 'bg-[#1e1e1e]' : 'bg-white'}`}>
          {/* Tabs */}
          <div className={`flex h-9 overflow-hidden ${isDark ? 'bg-zinc-900' : 'bg-zinc-200'} shrink-0`}>
            <div className="flex-1 flex overflow-x-auto scrollbar-hide">
              {tabs.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-zinc-500 text-sm">
                  No tabs open
                </div>
              ) : (
                tabs.map((tab) => (
                  <div 
                    key={tab.id} 
                    className={`flex shrink-0 items-center gap-2 px-3 min-w-32 max-w-48 border-r cursor-pointer ${isDark ? 'border-zinc-800' : 'border-zinc-300'} ${activeTabId === tab.id ? (isDark ? 'bg-[#1e1e1e] text-blue-400 border-t-2 border-t-blue-500' : 'bg-white text-blue-600 border-t-2 border-t-blue-500') : (isDark ? 'bg-zinc-900 text-zinc-500 hover:bg-zinc-800' : 'bg-zinc-200 text-zinc-600 hover:bg-zinc-100')}`}
                    onClick={() => setActiveTab(tab.id)}
                    onDoubleClick={() => pinTab(tab.id)}
                  >
                    {tab.language === 'welcome' ? (
                      <img src="/notron.png" alt="Welcome" className="w-3.5 h-3.5 grayscale opacity-80 pointer-events-none" />
                    ) : (
                      <File size={14} />
                    )}
                    <span className={`text-xs truncate flex-1 ${tab.isPreview ? 'italic' : ''}`}>
                      {(() => {
                        const duplicates = tabs.filter(t => t.name === tab.name);
                        if (duplicates.length > 1 && !tab.path.startsWith('Untitled')) {
                          const parts = tab.path.split(/[/\\]/);
                          if (parts.length >= 2) {
                            return (
                              <>
                                {tab.name} <span className="opacity-50 text-[10px] ml-1">...\{parts[parts.length - 2]}</span>
                              </>
                            );
                          }
                        }
                        return tab.name;
                      })()}
                    </span>
                    {tab.isModified && <div className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />}
                    <button 
                      className={`p-0.5 rounded ${isDark ? 'hover:bg-zinc-700' : 'hover:bg-zinc-300'}`}
                      onClick={(e) => { e.stopPropagation(); handleTabClose(tab.id); }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))
              )}
            </div>
            
            {/* Tab Actions (Right side) */}
            {(() => {
              const activeTab = tabs.find(t => t.id === activeTabId);
              if (activeTab && activeTab.path.toLowerCase().endsWith('.md')) {
                return (
                  <div className={`flex items-center shrink-0 px-2 border-l ${isDark ? 'border-zinc-800 bg-zinc-900' : 'border-zinc-300 bg-zinc-200'} sticky right-0 z-10`}>
                    <Tooltip content="Open Preview">
                      <button 
                        onClick={() => {
                          addTab({
                            id: `${activeTab.id}-preview`,
                            path: activeTab.path,
                            name: `${activeTab.name} (Preview)`,
                            content: activeTab.content,
                            language: 'markdown-preview',
                            isPreview: false
                          });
                        }}
                        className={`p-1.5 rounded-md transition-colors ${isDark ? 'text-zinc-400 hover:text-white hover:bg-zinc-700' : 'text-zinc-600 hover:text-black hover:bg-zinc-300'}`}
                      >
                        <Eye size={16} />
                      </button>
                    </Tooltip>
                  </div>
                );
              }
              return null;
            })()}
          </div>

          {/* Editor Area */}
          <div className="flex-1 relative overflow-hidden">
            {tabs.length === 0 ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-500 gap-4">
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-4"><span className="w-24 text-right">New File</span><kbd className="bg-zinc-800 px-2 py-0.5 rounded text-xs">Ctrl+N</kbd></div>
                  <div className="flex items-center gap-4"><span className="w-24 text-right">Open File</span><kbd className="bg-zinc-800 px-2 py-0.5 rounded text-xs">Ctrl+O</kbd></div>
                  <div className="flex items-center gap-4"><span className="w-24 text-right">Commands</span><kbd className="bg-zinc-800 px-2 py-0.5 rounded text-xs">Ctrl+Shift+P</kbd></div>
                </div>
              </div>
            ) : (
              activeTab && (
                activeTab.language === 'markdown-preview' ? (
                  <MarkdownPreview key={activeTab.id} path={activeTab.path} />
                ) : activeTab.language === 'image' ? (
                  <ImageViewer key={activeTab.id} filePath={activeTab.path} />
                ) : activeTab.path.toLowerCase().endsWith('.csv') ? (
                  <CsvEditor key={activeTab.id} filePath={activeTab.path} />
                ) : activeTab.language === 'welcome' ? (
                  <WelcomeTab />
                ) : (
                  <Editor 
                    key={activeTab.id} 
                    tabId={activeTab.id} 
                    content={activeTab.content} 
                    filePath={activeTab.path} 
                  />
                )
              )
            )}
          </div>
        </div>
      </div>

      {/* Status Bar */}
      <div className={`h-6 flex items-center justify-between px-3 text-xs select-none border-t ${isDark ? 'bg-zinc-800 text-zinc-300 border-zinc-900' : 'bg-zinc-200 text-zinc-700 border-zinc-300'}`}>
        <div className="flex items-center gap-4">
          <span>Ready</span>
          {activeTab && <span>{activeTab.language}</span>}
        </div>
        <div className="flex items-center gap-4">
          <span>Ln 1, Col 1</span>
          <span>UTF-8</span>
          <span>LF</span>
        </div>
      </div>
    </div>
    </TooltipProvider>
  );
}

export default App;
