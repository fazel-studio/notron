<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { open, save } from '@tauri-apps/plugin-dialog';
  import { watch } from '@tauri-apps/plugin-fs';
  import { editorStore } from './lib/stores/editor';
  import { uiStore } from './lib/stores/ui';
  import { getHumanReadableError } from './lib/utils/error';
  import { settingsStore } from './lib/stores/settings.svelte';
  import { themeStore } from './lib/stores/theme';
  import FileTree from './lib/components/FileTree.svelte';
  import Tooltip from './lib/components/Tooltip.svelte';
  import TitleMenuBar from './lib/components/TitleMenuBar.svelte';
  import CloseTabDialog from './lib/components/CloseTabDialog.svelte';
  import WelcomeTab from './lib/components/WelcomeTab.svelte';
  import NewFileDialog from './lib/components/NewFileDialog.svelte';
  import TrustModal from './lib/components/TrustModal.svelte';
  import RecentFoldersModal from './lib/components/RecentFoldersModal.svelte';
  import Breadcrumbs from './lib/components/Breadcrumbs.svelte';
  import TerminalPanel from './lib/components/TerminalPanel.svelte';
  import SmartSearchModal from './lib/components/SmartSearchModal.svelte';
  import ToastContainer from './lib/components/ToastContainer.svelte';
  import { terminalStore } from './lib/stores/terminal';
  import { paletteStore, type PaletteItem } from './lib/stores/palette';
  import { navigationStore } from './lib/stores/navigation';
  import { onMount } from 'svelte';

  const tabs = editorStore.tabs;
  const activeTabId = editorStore.activeTabId;
  const saveStatus = editorStore.saveStatus;
  const ui = uiStore;

  let closingTabId = $state<string | null>(null);
  let isCommandPaletteOpen = $state(false);
  let commandPaletteInitialQuery = $state('');
  let isSettingsOpen = $state(false);
  let isGoToLineOpen = $state(false);
  let appReady = $state(false);
  let currentCursorPos = $state('Ln 1, Col 1');

  let CommandPaletteComponent = $state<any>(null);
  let SettingsPageComponent = $state<any>(null);
  let GoToLineComponent = $state<any>(null);
  let SearchPanelComponent = $state<any>(null);
  let MarkdownPreviewComponent = $state<any>(null);
  let ImageViewerComponent = $state<any>(null);
  let EditorComponent = $state<any>(null);

  let showSmartSearchModal = $state(false);
  let activeTab = $derived($tabs.find((t: any) => t.id === $activeTabId) || null);
  let isDark = $derived($themeStore.isDark);

  $effect(() => {
    const workspacePath = $ui.explorerRoot;
    const folderName = workspacePath ? workspacePath.split(/[/\\]/).pop() : null;
    let windowTitle = "Notron";

    if (folderName && activeTab?.name) {
      windowTitle = `${activeTab.name} - ${folderName} - Notron`;
    } else if (folderName) {
      windowTitle = `${folderName} - Notron`;
    }

    document.title = windowTitle;
    getCurrentWindow().setTitle(windowTitle).catch(() => {});
  });

  // Sync settings theme to themeStore
  $effect(() => {
    if (settingsStore.effectiveSettings.theme) {
      themeStore.setTheme(settingsStore.effectiveSettings.theme);
    }
  });

  // Lazy load components only when needed (Bagian 17.1)
  $effect(() => {
    if (isCommandPaletteOpen && !CommandPaletteComponent) {
      import('./lib/components/CommandPalette.svelte').then(m => CommandPaletteComponent = m.default);
    }
  });
  $effect(() => {
    if (isSettingsOpen && !SettingsPageComponent) {
      import('./lib/components/SettingsPage.svelte').then(m => SettingsPageComponent = m.default);
    }
  });
  $effect(() => {
    if (isGoToLineOpen && !GoToLineComponent) {
      import('./lib/components/GoToLineDialog.svelte').then(m => GoToLineComponent = m.default);
    }
  });
  $effect(() => {
    if ($ui.activeSidebarPanel === 'search' && $ui.isSidebarOpen && !SearchPanelComponent) {
      import('./lib/components/SearchPanel.svelte').then(m => SearchPanelComponent = m.default);
    }
  });

  let tabCtxMenu = $state({
    isOpen: false,
    x: 0,
    y: 0,
    targetTabId: null as string | null,
    items: [] as any[]
  });

  function closeAllContextMenus(e?: Event) {
    if (e && (e.target as Element)?.closest?.('[data-notron-context-menu]')) return;
    tabCtxMenu.isOpen = false;
  }

  onMount(() => {
    const switchHandler = async (e: Event) => {
      const path = (e as CustomEvent).detail?.path;
      if (path) {
        await saveWorkspaceSession();
        uiStore.setExplorerRoot(path);
      }
    };
    window.addEventListener('request-workspace-switch', switchHandler);
    window.addEventListener('click', closeAllContextMenus, { capture: true });
    window.addEventListener('contextmenu', closeAllContextMenus, { capture: true });
    window.addEventListener('editor:action', closeAllContextMenus);
    window.addEventListener('close-context-menus', closeAllContextMenus);
    
    const openSmartSearchHandler = () => showSmartSearchModal = true;
    window.addEventListener('open-smart-search', openSmartSearchHandler);

    const focusHandler = async () => {
      if (!appReady) return;
      const currentTabs = editorStore.getTabsSnapshot();
      const paths = currentTabs.filter((t: any) => !t.path.startsWith('Untitled') && t.status !== 'deleted').map((t: any) => t.path);
      if (paths.length === 0) return;
      
      try {
        const metadata = await invoke<any[]>('get_files_metadata', { paths });
        const existingPaths = new Set(metadata.map(m => m.path));
        
        currentTabs.forEach((tab: any) => {
          if (!tab.path.startsWith('Untitled') && tab.status !== 'deleted' && !existingPaths.has(tab.path)) {
            editorStore.markTabDeleted(tab.id);
          }
        });
      } catch (err) { console.error('Focus sync failed:', err); }
    };
    window.addEventListener('focus', focusHandler);

    return () => {
      window.removeEventListener('request-workspace-switch', switchHandler);
      window.removeEventListener('click', closeAllContextMenus, { capture: true });
      window.removeEventListener('contextmenu', closeAllContextMenus, { capture: true });
      window.removeEventListener('editor:action', closeAllContextMenus);
      window.removeEventListener('close-context-menus', closeAllContextMenus);
      window.removeEventListener('open-smart-search', openSmartSearchHandler);
      window.removeEventListener('focus', focusHandler);
    };
  });

  function handleTabContextMenu(e: MouseEvent, tabId: string) {
    e.preventDefault();
    e.stopPropagation();
    window.dispatchEvent(new CustomEvent('close-context-menus'));
    
    const tabs = editorStore.getTabsSnapshot();
    const tabIndex = tabs.findIndex((t: any) => t.id === tabId);
    const tab = tabs[tabIndex];
    if (!tab) return;
    
    tabCtxMenu.targetTabId = tabId;
    tabCtxMenu.items = [
      {
        id: 'close',
        label: 'Close Tab',
        action: () => { handleTabClose(tabId); }
      },
      {
        id: 'close_other',
        label: 'Close Other',
        disabled: tabs.length <= 1,
        action: () => {
          tabs.forEach((t: any) => {
            if (t.id !== tabId) handleTabClose(t.id);
          });
        }
      },
      {
        id: 'close_right',
        label: 'Close to the Right',
        disabled: tabIndex === -1 || tabIndex === tabs.length - 1,
        action: () => {
          for (let i = tabIndex + 1; i < tabs.length; i++) {
            handleTabClose(tabs[i].id);
          }
        }
      },
      { separator: true },
      {
        id: 'copy_path',
        label: 'Copy Path',
        action: () => {
          navigator.clipboard.writeText(tab.path).catch(console.error);
        }
      },
      {
        id: 'pin',
        label: tab.isPinned ? 'Unpin' : 'Pin',
        action: () => {
          editorStore.togglePin(tabId);
        }
      }
    ];
    
    tabCtxMenu.x = e.clientX;
    tabCtxMenu.y = e.clientY;
    tabCtxMenu.isOpen = true;
  }

  async function handleOpenFileCtx() {
    try {
      const selected = await open({ multiple: false });
      if (selected && typeof selected === 'string') {
        const fileName = selected.split(/[/\\]/).pop() || 'Unknown';
        let content = '';
        const isImage = /\.(png|jpe?g|gif|webp|svg|ico)$/i.test(fileName);
        if (!isImage) {
          try {
            content = await invoke<string>('read_file_text', { path: selected });
          } catch (e) {
            if (String(e) === '__BINARY__') content = '';
            else throw e;
          }
        }
        editorStore.addTab({
          id: `tab-${Date.now()}`, path: selected, name: fileName, content,
          language: isImage ? 'image' : await invoke<string>('detect_language', { path: selected }),
          isPreview: false
        });
      }
    } catch (err) { console.error(err); }
  }

  function handleEmptyTabAreaContextMenu(e: MouseEvent) {
    e.preventDefault();
    window.dispatchEvent(new CustomEvent('close-context-menus'));
    
    const tabs = editorStore.getTabsSnapshot();
    tabCtxMenu.targetTabId = null;
    tabCtxMenu.items = [
      {
        id: 'new_text_file',
        label: 'New Text File',
        action: handleNewTextFile
      },
      {
        id: 'open_file',
        label: 'Open File',
        action: handleOpenFileCtx
      },
      { separator: true },
      {
        id: 'close_all',
        label: 'Close All Tabs',
        disabled: tabs.length === 0,
        action: () => {
          tabs.forEach((t: any) => handleTabClose(t.id));
        }
      }
    ];
    
    tabCtxMenu.x = e.clientX;
    tabCtxMenu.y = e.clientY;
    tabCtxMenu.isOpen = true;
  }

  $effect(() => {
    if (activeTab?.language === 'markdown-preview' && !MarkdownPreviewComponent) {
      import('./lib/components/MarkdownPreview.svelte').then(m => MarkdownPreviewComponent = m.default);
    }
  });
  $effect(() => {
    if (activeTab?.language === 'image' && !ImageViewerComponent) {
      import('./lib/components/ImageViewer.svelte').then(m => ImageViewerComponent = m.default);
    }
  });



  $effect(() => {
    if (activeTab) {
      const cursor = editorStore.getCursor(activeTab.id);
      currentCursorPos = cursor
        ? `Ln ${cursor.line}, Col ${cursor.column}`
        : 'Ln 1, Col 1';
    }
  });

  // === Workspace State Persistence (Bagian 3) ===
  // Debounce timers for different data types
  let cursorScrollSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let expandStateSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let fullSessionSaveTimer: ReturnType<typeof setTimeout> | null = null;

  async function saveWorkspaceSession() {
    const explorerRoot = uiStore.getSnapshot().explorerRoot;
    if (!explorerRoot) return;
    try {
      const uiVal = uiStore.getSnapshot();
      const tabsSnapshot = editorStore.getTabsSnapshot();
      const termVal = terminalStore.getSnapshot();

      const validTabs = tabsSnapshot.filter((t: any) => 
        t.path.startsWith('Untitled') || 
        t.language === 'welcome' ||
        t.path.toLowerCase().startsWith(explorerRoot.toLowerCase())
      );
      const validTabIds = new Set(validTabs.map((t: any) => t.id));
      let activeTabId = editorStore.getActiveTabIdSnapshot();
      if (activeTabId && !validTabIds.has(activeTabId)) {
        activeTabId = validTabs.length > 0 ? validTabs[0].id : null;
      }

      const session = {
        sidebarWidth: uiVal.sidebarWidth,
        isSidebarOpen: uiVal.isSidebarOpen,
        expandedPaths: uiStore.getExpandedPathsSnapshot(),
        activeSidebarPanel: uiVal.activeSidebarPanel,
        isMinimapEnabled: uiVal.isMinimapEnabled,
        searchQuery: uiVal.searchQuery,
        replaceQuery: uiVal.replaceQuery,
        terminals: termVal.terminals,
        activeTerminalId: termVal.activeTerminalId,
        terminalVisible: termVal.isVisible,
        terminalMaximized: termVal.isMaximized,
        terminalHeight: termVal.height,
        tabs: validTabs.map((t: any) => ({
          id: t.id, path: t.path, name: t.name, language: t.language,
          isPreview: t.isPreview, isPinned: t.isPinned, 
          cursor: editorStore.getCursor(t.id), scroll: editorStore.getScroll(t.id),
          isModified: t.isModified,
          content: t.isModified ? t.content : undefined,
        })),
        activeTabId,
      };

      // Section 1.1: Save to both legacy table AND tiered tables in parallel
      await Promise.all([
        // Legacy (backward compat)
        invoke('save_workspace_session', {
          workspacePath: explorerRoot,
          sessionJson: JSON.stringify(session),
        }),
        // Tier 2: UI State
        invoke('save_ui_state', {
          workspaceId: explorerRoot,
          ui: {
            sidebar_width: uiVal.sidebarWidth,
            panel_height: null,
            sidebar_visible: uiVal.isSidebarOpen,
            expanded_folder_paths: JSON.stringify(uiStore.getExpandedPathsSnapshot()),
            active_sidebar_panel: uiVal.activeSidebarPanel,
            is_minimap_enabled: uiVal.isMinimapEnabled,
          },
        }).catch(() => {}),
        // Tier 3: Session State
        invoke('save_session_state', {
          workspaceId: explorerRoot,
          session: {
            open_tabs_json: JSON.stringify(session.tabs),
            active_tab_id: session.activeTabId,
            scroll_positions_json: null,
            editor_snapshots_json: null,
          },
        }).catch(() => {}),
        invoke('save_dirty_tab_snapshots', {
          tabs: session.tabs.filter((t: any) => t.isModified && t.content !== undefined).map((t: any) => ({
            path: t.path,
            content: t.content,
            cursor_pos: t.cursor?.line || 0,
          }))
        }).catch(() => {}),
      ]);
    } catch (err) {
      console.error("Failed to save workspace session:", err);
    }
  }

  async function saveCursorScroll() {
    const explorerRoot = uiStore.getSnapshot().explorerRoot;
    if (!explorerRoot) return;
    const cursorData = editorStore.getCursorScrollSnapshot();
    try {
      await invoke('save_workspace_state', {
        workspacePath: explorerRoot,
        pairs: [['cursor_scroll', JSON.stringify(cursorData)]],
      });
    } catch (err) {
      console.error("Failed to save cursor/scroll:", err);
    }
  }

  async function saveExpandedState() {
    const explorerRoot = uiStore.getSnapshot().explorerRoot;
    if (!explorerRoot) return;
    const paths = uiStore.getExpandedPathsSnapshot();
    try {
      await invoke('save_workspace_expanded_paths', {
        workspacePath: explorerRoot,
        pathsJson: JSON.stringify(paths),
      });
    } catch (err) {
      console.error("Failed to save expanded paths:", err);
    }
  }

  // Debounced save for cursor/scroll (3 second debounce per Bagian 3.3)
  function debouncedSaveCursorScroll() {
    if (cursorScrollSaveTimer) clearTimeout(cursorScrollSaveTimer);
    cursorScrollSaveTimer = setTimeout(saveCursorScroll, 3000);
  }

  // Debounced save for expanded folders (1 second debounce)
  function debouncedSaveExpanded() {
    if (expandStateSaveTimer) clearTimeout(expandStateSaveTimer);
    expandStateSaveTimer = setTimeout(saveExpandedState, 1000);
  }

  // Full session save with 2 second debounce
  function debouncedSaveFullSession() {
    if (fullSessionSaveTimer) clearTimeout(fullSessionSaveTimer);
    fullSessionSaveTimer = setTimeout(saveWorkspaceSession, 2000);
  }

  // ============================================================
  // Section 1.2: Shell-First Rendering + Tiered State Loading
  // Section 1.4 + 6.1: IPC Batching — all startup queries in ONE round-trip
  // ============================================================
  async function stagedStartup() {
    // Phase 0: Shell renders immediately (appReady=false shows skeleton)
    // Theme + dimensions already loaded from localStorage (sync)
    appReady = false;

    const root = uiStore.getSnapshot().explorerRoot;

    try {
      // Phase 2: Single IPC round-trip for ALL startup state
      const startupState = await invoke<{
        config: any;
        critical: any;
        ui_state: any | null;
        session_pairs: [string, string][];
      }>('load_startup_state', { workspaceId: root || null });

      // Apply config
      await settingsStore.loadAllSettings(root || undefined);

      // Apply UI state from DB (overrides localStorage if available)
      if (startupState.ui_state) {
        const u = startupState.ui_state;
        if (u.sidebar_width != null) uiStore.setSidebarWidth(Number(u.sidebar_width));
        if (u.sidebar_visible != null) uiStore.setSidebarOpen(Boolean(u.sidebar_visible));
        if (u.active_sidebar_panel) uiStore.setActiveSidebarPanel(u.active_sidebar_panel);
        if (u.is_minimap_enabled != null) uiStore.setMinimapEnabled(Boolean(u.is_minimap_enabled));
        if (u.expanded_folder_paths) {
          try { uiStore.setExpandedPaths(JSON.parse(u.expanded_folder_paths)); } catch {}
        }
      }

      // Apply session state (tabs, cursors)
      if (startupState.session_pairs && startupState.session_pairs.length > 0) {
        const stateMap = new Map<string, string>(startupState.session_pairs);
        const sessionStr = stateMap.get('session');
        if (sessionStr) {
          try {
            const parsed = JSON.parse(sessionStr);
            // Apply layout overrides from session
            if (parsed.sidebarWidth !== undefined) uiStore.setSidebarWidth(parsed.sidebarWidth);
            if (parsed.isSidebarOpen !== undefined) uiStore.setSidebarOpen(parsed.isSidebarOpen);
            if (parsed.expandedPaths !== undefined) uiStore.setExpandedPaths(parsed.expandedPaths);
            if (parsed.activeSidebarPanel !== undefined) uiStore.setActiveSidebarPanel(parsed.activeSidebarPanel);
            if (parsed.isMinimapEnabled !== undefined) uiStore.setMinimapEnabled(parsed.isMinimapEnabled);
            if (parsed.searchQuery !== undefined) uiStore.setSearchQuery(parsed.searchQuery);
            if (parsed.replaceQuery !== undefined) uiStore.setReplaceQuery(parsed.replaceQuery);
            
            // Apply terminal state ONLY if terminals exist in this workspace
            if (parsed.terminals && parsed.terminals.length > 0) {
              terminalStore.setTerminals(parsed.terminals, parsed.activeTerminalId || null);
              if (parsed.terminalVisible !== undefined) terminalStore.setVisibility(parsed.terminalVisible);
              if (parsed.terminalMaximized !== undefined) terminalStore.setMaximize(parsed.terminalMaximized);
              if (parsed.terminalHeight !== undefined) terminalStore.setHeight(parsed.terminalHeight);
            } else {
              terminalStore.setTerminals([], null);
              terminalStore.setVisibility(false);
            }

            // Phase 3: Lazy Tab Initialization
            if (parsed.tabs && parsed.tabs.length > 0) {
              const lazyTabs = parsed.tabs.map((t: any) => ({
                ...t,
                content: t.isModified && t.content !== undefined ? t.content : null,
                originalContent: null,
                lastAccessed: Date.now(),
                status: t.isModified && t.content !== undefined ? 'modified' : 'loaded',
              }));
              editorStore.setTabs(lazyTabs, parsed.activeTabId || null);
            } else {
              editorStore.setTabs([], null);
            }
          } catch (e) {
            console.error('Failed to parse session state', e);
            editorStore.setTabs([], null);
          }
        } else {
          editorStore.setTabs([], null);
        }

        // Restore cursor/scroll positions
        const cursorStr = stateMap.get('cursor_scroll');
        if (cursorStr) {
          try {
            const cursorData = JSON.parse(cursorStr);
            for (const item of cursorData) {
              if (item.cursor) editorStore.updateCursor(item.id, item.cursor.line, item.cursor.column);
              if (item.scroll) editorStore.updateScroll(item.id, item.scroll.top, item.scroll.left);
            }
          } catch { /* ignore */ }
        }
      } else {
        editorStore.setTabs([], null);
        uiStore.setExpandedPaths([]);
      }
    } catch (err) {
      console.error('Startup state load failed:', err);
      editorStore.setTabs([], null);
    }

    appReady = true;
    setTimeout(() => {
      invoke('show_main_window').catch(e => console.error('Failed to show window', e));
    }, 50);

    // Phase 3: Load active tab content + show welcome if no tabs
    await loadActiveTabContent();

    if ($tabs.length === 0) {
      if (root) {
        editorStore.addTab({
          id: 'welcome', path: 'Welcome', name: 'Welcome',
          content: 'Welcome to Notron', language: 'welcome', isPreview: true
        });
        editorStore.setActiveTab('welcome');
      }
    }

    // Phase 4: Crash Recovery Check
    try {
      const crashFlag = await invoke<boolean>('check_crash_flag');
      if (crashFlag) {
        try {
          const dirtySnapshots = await invoke<any[]>('get_dirty_tab_snapshots');
          if (dirtySnapshots && dirtySnapshots.length > 0) {
            dirtySnapshots.forEach(snap => {
              const name = snap.path.split(/[/\\]/).pop() || 'Unknown';
              const id = snap.path;
              // Check if already in tabs
              const existingTab = editorStore.getTabsSnapshot().find((t: any) => t.id === id);
              if (!existingTab) {
                editorStore.addTab({
                  id, path: snap.path, name, content: snap.content, language: 'plaintext', isPreview: false
                });
              } else {
                editorStore.setInitialContent(id, snap.content);
              }
              // Mark as modified so it can be saved again
              editorStore.updateContent(id, snap.content);
            });
            uiStore.addToast('Session restored', 'success', 'after unexpected close');
          } else {
            uiStore.addToast('Session restored', 'success', 'after unexpected close');
          }
        } catch(e) {}
      }
      // Set flag to true to indicate running state
      await invoke('set_crash_flag', { value: true });
    } catch (e) {
      console.error('Failed to check/set crash flag', e);
    }

    // Phase 5: Background tasks via requestIdleCallback
    scheduleBackgroundTasks();
  }

  function scheduleBackgroundTasks() {
    const idle = (window as any).requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 200));
    // Prefetch CommandPalette component
    idle(() => {
      if (!CommandPaletteComponent) {
        import('./lib/components/CommandPalette.svelte').then(m => CommandPaletteComponent = m.default);
      }
    });
    // Prefetch Editor component
    idle(() => {
      if (!EditorComponent) {
        import('./lib/components/Editor.svelte').then(m => EditorComponent = m.default);
      }
    });
  }

  async function loadActiveTabContent() {
    const currentActiveTab = editorStore.getTabsSnapshot().find(
      (t: any) => t.id === editorStore.getActiveTabIdSnapshot()
    );
    if (currentActiveTab && currentActiveTab.content === null &&
        currentActiveTab.path && !currentActiveTab.path.startsWith('Untitled')) {
      const tabId = currentActiveTab.id;
      const path = currentActiveTab.path;
      editorStore.setTabLoading(tabId, true);
      try {
        const content = await invoke<string>('read_file_text', { path });
        editorStore.setInitialContent(tabId, content);
      } catch (err) {
        if (String(err) === '__BINARY__') {
          editorStore.setTabUnsupported(tabId, true);
          editorStore.setInitialContent(tabId, '');
        } else {
          console.error('Failed to load active tab content:', err);
        }
      }
      editorStore.setTabLoading(tabId, false);
    }
  }

  async function loadWorkspaceState(root: string) {
    appReady = false; // Show skeleton during switch
    try {
      const startupState = await invoke<{
        config: any;
        critical: any;
        ui_state: any | null;
        session_pairs: [string, string][];
      }>('load_startup_state', { workspaceId: root || null });

      if (startupState.ui_state) {
        const u = startupState.ui_state;
        if (u.sidebar_width != null) uiStore.setSidebarWidth(Number(u.sidebar_width));
        if (u.sidebar_visible != null) uiStore.setSidebarOpen(Boolean(u.sidebar_visible));
        if (u.active_sidebar_panel) uiStore.setActiveSidebarPanel(u.active_sidebar_panel);
        if (u.is_minimap_enabled != null) uiStore.setMinimapEnabled(Boolean(u.is_minimap_enabled));
        if (u.expanded_folder_paths) {
          try { uiStore.setExpandedPaths(JSON.parse(u.expanded_folder_paths)); } catch {}
        }
      }

      if (startupState.session_pairs && startupState.session_pairs.length > 0) {
        const stateMap = new Map<string, string>(startupState.session_pairs);
        const sessionStr = stateMap.get('session');
        if (sessionStr) {
          try {
            const parsed = JSON.parse(sessionStr);
            if (parsed.sidebarWidth !== undefined) uiStore.setSidebarWidth(parsed.sidebarWidth);
            if (parsed.isSidebarOpen !== undefined) uiStore.setSidebarOpen(parsed.isSidebarOpen);
            if (parsed.expandedPaths !== undefined) uiStore.setExpandedPaths(parsed.expandedPaths);
            if (parsed.activeSidebarPanel !== undefined) uiStore.setActiveSidebarPanel(parsed.activeSidebarPanel);
            if (parsed.isMinimapEnabled !== undefined) uiStore.setMinimapEnabled(parsed.isMinimapEnabled);
            if (parsed.searchQuery !== undefined) uiStore.setSearchQuery(parsed.searchQuery);
            if (parsed.replaceQuery !== undefined) uiStore.setReplaceQuery(parsed.replaceQuery);

            if (parsed.terminals && parsed.terminals.length > 0) {
              terminalStore.setTerminals(parsed.terminals, parsed.activeTerminalId || null);
              if (parsed.terminalVisible !== undefined) terminalStore.setVisibility(parsed.terminalVisible);
              if (parsed.terminalMaximized !== undefined) terminalStore.setMaximize(parsed.terminalMaximized);
              if (parsed.terminalHeight !== undefined) terminalStore.setHeight(parsed.terminalHeight);
            } else {
              terminalStore.setTerminals([], null);
              terminalStore.setVisibility(false);
            }

            if (parsed.tabs !== undefined) {
              const lazyTabs = parsed.tabs.map((t: any) => ({
                ...t,
                content: t.isModified && t.content !== undefined ? t.content : null,
                originalContent: null,
                lastAccessed: Date.now(),
                status: t.isModified && t.content !== undefined ? 'modified' : 'loaded',
              }));
              editorStore.setTabs(lazyTabs, parsed.activeTabId || null);
            } else {
              editorStore.setTabs([], null);
            }
          } catch (e) {
            console.error('Failed to parse session state', e);
            editorStore.setTabs([], null);
          }
        } else {
          editorStore.setTabs([], null);
        }
        
        const cursorStr = stateMap.get('cursor_scroll');
        if (cursorStr) {
          try {
            const cursorData = JSON.parse(cursorStr);
            for (const item of cursorData) {
              if (item.cursor) editorStore.updateCursor(item.id, item.cursor.line, item.cursor.column);
              if (item.scroll) editorStore.updateScroll(item.id, item.scroll.top, item.scroll.left);
            }
          } catch { /* ignore */ }
        }
      } else {
        editorStore.setTabs([], null);
        uiStore.setExpandedPaths([]);
      }
    } catch (err) {
      console.error('Failed to load workspace state:', err);
    }
    appReady = true; // Hide skeleton after load completes
    await loadActiveTabContent();
  }



  // Guard set to prevent the $effect from re-triggering itself when setTabLoading updates the store
  const loadingTabIds = new Set<string>();

  // Lazy load content when active tab changes and content is null
  $effect(() => {
    if (
      activeTab &&
      activeTab.content === null &&
      activeTab.path &&
      !activeTab.path.startsWith('Untitled') &&
      !activeTab.isLargeFile &&
      !loadingTabIds.has(activeTab.id)
    ) {
      const tabId = activeTab.id;
      const path = activeTab.path;
      loadingTabIds.add(tabId);
      editorStore.setTabLoading(tabId, true);
      invoke<string>('read_file_text', { path }).then(content => {
        editorStore.setInitialContent(tabId, content);
      }).catch(err => {
        if (String(err) === '__BINARY__') {
          editorStore.setTabUnsupported(tabId, true);
          editorStore.setInitialContent(tabId, '');
        } else {
          console.error("Failed to lazy load tab content:", err);
        }
      }).finally(() => {
        editorStore.setTabLoading(tabId, false);
        loadingTabIds.delete(tabId);
      });
    }
  });

  // Trigger EditorComponent lazy load as soon as a non-special tab exists (even with null content)
  $effect(() => {
    if (activeTab && activeTab.language !== 'markdown-preview' && activeTab.language !== 'image' && activeTab.language !== 'welcome' && !EditorComponent) {
      import('./lib/components/Editor.svelte').then(m => EditorComponent = m.default);
    }
  });

  function setSidebarWidth(w: number) { uiStore.setSidebarWidth(w); }

  function handleNewTextFile() {
    let count = 1;
    const tabsSnapshot = editorStore.getTabsSnapshot();
    while (tabsSnapshot.some((t: any) => t.path === `Untitled-${count}`)) count++;
    const name = `Untitled-${count}`;
    const id = `tab-${Date.now()}`;
    editorStore.addTab({ id, path: name, name, content: '', language: 'plaintext', isPreview: false });
    editorStore.setActiveTab(id);
  }

  function openSettings() {
    isSettingsOpen = true;
  }

  const baseCommands: PaletteItem[] = [
    {
      id: 'new-file', label: 'New File', category: 'command', shortcut: 'Ctrl+N',
      action: handleNewTextFile, keywords: ['create', 'buat', 'file baru']
    },
    { id: 'toggle-sidebar', label: 'Toggle Sidebar', category: 'command', shortcut: 'Ctrl+B', action: () => uiStore.toggleSidebar() },
    { id: 'settings', label: 'Settings', category: 'command', shortcut: 'Ctrl+,', action: openSettings },
    { id: 'go-to-line', label: 'Go to Line', category: 'command', shortcut: 'Ctrl+G', action: () => isGoToLineOpen = true }
  ];

  $effect(() => {
    const root = $ui.explorerRoot;
    if (appReady && root) {
      paletteStore.loadWorkspaceFiles(
        root,
        baseCommands,
        (path) => {
          const name = path.split(/[/\\]/).pop() || 'Unknown';
          editorStore.addTab({ id: path, path, name, content: null, language: 'plaintext', isPreview: false });
          editorStore.setActiveTab(path);
        }
      );
    } else if (appReady && !root) {
      paletteStore.initItems(baseCommands);
    }
  });

  async function handleOpenFolder() {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (selected && typeof selected === 'string') {
        if (selected === uiStore.getSnapshot().explorerRoot) return;
        if (!$ui.recentWorkspaces.includes(selected)) {
          await saveWorkspaceSession();
          uiStore.setPendingTrustPath(selected);
        } else {
          window.dispatchEvent(new CustomEvent('request-workspace-switch', { detail: { path: selected } }));
        }
      }
    } catch (err) { console.error("Failed to open folder:", err); }
  }

  async function handleOpenFile() {
    try {
      const selected = await open({ multiple: false });
      if (selected && typeof selected === 'string') {
        const name = selected.split(/[/\\]/).pop() || 'Unknown';
        const id = `tab-${Date.now()}`;
        editorStore.addTab({ id, path: selected, name, content: null, language: 'plaintext', isPreview: false });
        editorStore.setActiveTab(id);
      }
    } catch (err) { console.error("Failed to open file:", err); }
  }

  function handleTabClose(tabId: string) {
    const tab = $tabs.find((t: any) => t.id === tabId);
    if (!tab) return;
    if (tab.isModified || (tab.path.startsWith('Untitled') && tab.content && tab.content.trim() !== '')) {
      closingTabId = tabId;
    } else {
      editorStore.closeTab(tabId);
      debouncedSaveFullSession();
    }
  }

  async function handleCloseSave() {
    if (!closingTabId) return;
    const tab = $tabs.find((t: any) => t.id === closingTabId);
    if (!tab) { closingTabId = null; return; }
    if (tab.path.startsWith('Untitled')) {
      const selected = await save();
      if (selected && typeof selected === 'string') editorStore.closeTab(closingTabId);
    } else {
      editorStore.closeTab(closingTabId);
    }
    closingTabId = null;
    debouncedSaveFullSession();
  }

  function handleGlobalKeydown(e: KeyboardEvent) {
    const isMac = navigator.userAgent.toLowerCase().includes('mac');
    const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;
    const key = e.key.toLowerCase();

    // ── BLOKIR FITUR BAWAAN BROWSER ──
    // 1. Find / Search
    if ((cmdOrCtrl && (key === 'f' || key === 'g')) || e.key === 'F3') {
      e.preventDefault();
      // Notron search not fully global yet, but we block browser default
    }
    // 2. Print & Save
    if (cmdOrCtrl && key === 'p') {
      e.preventDefault();
      if (e.shiftKey) {
        commandPaletteInitialQuery = '>';
        isCommandPaletteOpen = true; 
      } else {
        commandPaletteInitialQuery = '';
        isCommandPaletteOpen = true; 
      }
    }
    if (cmdOrCtrl && !e.shiftKey && key === 's') {
      e.preventDefault(); 
      window.dispatchEvent(new CustomEvent('editor:save'));
    }
    if (cmdOrCtrl && e.shiftKey && key === 's') {
      e.preventDefault(); 
      window.dispatchEvent(new CustomEvent('editor:save-as'));
    }
    // 3. DevTools & View Source
    if (e.key === 'F12' || 
       (cmdOrCtrl && e.shiftKey && (key === 'i' || key === 'j')) || 
       (cmdOrCtrl && key === 'u')) {
      e.preventDefault();
    }
    // 4. Refresh / Reload
    if (e.key === 'F5' || (cmdOrCtrl && key === 'r') || (cmdOrCtrl && e.shiftKey && key === 'r')) {
      e.preventDefault();
    }
    // 5. Zooming Browser
    if (cmdOrCtrl && (key === '+' || key === '=' || key === '-' || key === '0')) {
      e.preventDefault();
    }
    // 6. Navigation History
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      import('./lib/stores/navigation').then(m => {
        if (e.key === 'ArrowLeft') m.navigationStore.navigateBack();
        else m.navigationStore.navigateForward();
      });
    }
    // 7. Reopen Closed Tab
    if (cmdOrCtrl && e.shiftKey && key === 't') {
      e.preventDefault();
      editorStore.reopenClosedTab();
    }

    // ── NOTRON CUSTOM SHORTCUTS ──
    if (cmdOrCtrl && key === 'n') {
      e.preventDefault(); baseCommands[0].action();
    }
    if (cmdOrCtrl && key === 'b') {
      e.preventDefault(); uiStore.toggleSidebar();
    }
    if (cmdOrCtrl && key === ',') {
      e.preventDefault(); openSettings();
    }
    if (cmdOrCtrl && key === 'g') {
      e.preventDefault(); isGoToLineOpen = true;
    }
  }

  let lastLoadedRoot: string | null = null;

  onMount(() => {
    // Tahap 0: Theme already loaded from localStorage sync
    // Initialize UI from sync storage (localStorage for fast access)
    uiStore.initFromStorage();
    terminalStore.initFromStorage();

    // Start staged startup
    lastLoadedRoot = uiStore.getSnapshot().explorerRoot;
    stagedStartup().catch(console.error);
  });

  $effect(() => {
    const root = $ui.explorerRoot;
    if (appReady && root && root !== lastLoadedRoot) {
      lastLoadedRoot = root;
      loadWorkspaceState(root).catch(console.error);
    }
  });

  // File watcher with proper debounce and filtering (Bagian 4.3)
  $effect(() => {
    const explorerRoot = $ui.explorerRoot;
    if (!explorerRoot || !appReady) return;

    let unsubTabs = editorStore.tabs.subscribe(debouncedSaveFullSession);
    let unsubActive = editorStore.activeTabId.subscribe(debouncedSaveFullSession);

    let unwatch: (() => void) | null = null;
    let debounceTimer: number | undefined;
    let pendingPaths = new Set<string>();
    let watchTimer: number | undefined;

    watchTimer = setTimeout(async () => {
      try {
        unwatch = await watch(explorerRoot, (event) => {
          clearTimeout(debounceTimer);
          (event.paths || []).forEach((p: string) => pendingPaths.add(p));

          debounceTimer = setTimeout(async () => {
            const changedPaths = new Set(pendingPaths);
            pendingPaths.clear();

            // Filter ignored paths (Bagian 4.3 - Filtering)
            const ignorePatterns = ['node_modules', '.git', 'target', 'dist', 'build', '.cache', '.next', '.nuxt', '.svelte-kit', '__pycache__', '.pytest_cache'];
            const ignoreExts = ['.lock', '.log', '.tmp', '.temp', '.swp', '.swo'];
            const shouldIgnore = (p: string) => {
              const lower = p.toLowerCase();
              if (ignorePatterns.some(ig => lower.includes(ig))) return true;
              if (ignoreExts.some(ext => lower.endsWith(ext))) return true;
              return false;
            };
            const relevantChanges = [...changedPaths].filter(p => !shouldIgnore(p));

            // Batch processing - if 50+ events, do full refresh
            if (relevantChanges.length >= 50) {
              uiStore.triggerExplorerRefresh();
            } else if (relevantChanges.length > 0) {
              // Selective updates (Bagian 4.3 - Update UI)
              uiStore.triggerExplorerRefresh();
            }

            // Check if any open tabs were affected
            editorStore.getTabsSnapshot().filter((tab: any) => {
              if (!tab.path || tab.path.startsWith('Untitled')) return false;
              return (changedPaths.has(tab.path) || changedPaths.has(explorerRoot)) && tab.content !== null;
            }).forEach(async (tab: any) => {
              try {
                const exists = await invoke<boolean>('file_exists', { path: tab.path });
                if (!exists) {
                  // File deleted while open - mark tab (Bagian 13.2)
                  editorStore.markTabDeleted(tab.id);
                  return;
                }
                try {
                  const content = await invoke<string>('read_file_text', { path: tab.path });
                  const latestTab = editorStore.getTabsSnapshot().find((t: any) => t.id === tab.id);
                  if (latestTab && !latestTab.isModified && content !== latestTab.content) {
                    editorStore.setInitialContent(tab.id, content);
                  } else if (latestTab && latestTab.isModified && content !== latestTab.originalContent) {
                    editorStore.markTabConflict(tab.id);
                    console.warn(`External change detected for ${tab.path} while modified in editor`);
                  }
                } catch (err) {
                  if (String(err) === '__BINARY__') {
                    editorStore.setTabUnsupported(tab.id, true);
                  }
                }
              } catch (err) {}
            });
          }, 300);
        }, { recursive: true, delayMs: 0 });
      } catch (e) { console.error("Failed to watch explorer root:", e); }
    }, 1500);

    // Save session on beforeunload
    const handleBeforeUnload = () => {
      saveWorkspaceSession();
      // Save critical config for next startup skeleton
      const uiVal = uiStore.getSnapshot();
      const termVal = terminalStore.getSnapshot();
      invoke('save_critical_config', {
        config: {
          theme: $themeStore.theme || 'system',
          window_width: window.innerWidth,
          window_height: window.innerHeight,
          window_x: null,
          window_y: null,
          window_maximized: true,
          sidebar_width: uiVal.sidebarWidth,
          sidebar_visible: uiVal.isSidebarOpen,
          terminal_visible: termVal.isVisible,
          terminal_height: termVal.height,
          active_workspace: uiVal.explorerRoot || null,
        }
      }).catch(() => {});

      // Clear crash flag on normal close
      invoke('set_crash_flag', { value: false }).catch(() => {});
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      clearTimeout(watchTimer);
      if (unwatch) unwatch();
      if (debounceTimer) clearTimeout(debounceTimer);
      unsubTabs();
      unsubActive();
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  });

  // Auto-save with debounce (Bagian 5.4)
  $effect(() => {
    if (!settingsStore.effectiveSettings.auto_save) return;
    const modifiedTabs = $tabs.filter((t: any) => t.isModified && t.content !== null && !t.path.startsWith('Untitled'));
    if (modifiedTabs.length === 0) return;

    const timer = setTimeout(async () => {
      for (const tab of modifiedTabs) {
        try {
          if (tab.content !== null && !tab.autoSavePaused) {
            await invoke('save_file', { path: tab.path, content: tab.content });
            editorStore.markSaved(tab.id);
          }
        } catch (err) {
          console.error("Auto save failed for", tab.path, err);
          uiStore.addToast('Auto Save Failed', 'alert', getHumanReadableError(err));
          editorStore.pauseAutoSave(tab.id);
        }
      }
      editorStore.clearSaveStatus();
    }, settingsStore.effectiveSettings.auto_save_delay_ms || 1500);

    return () => clearTimeout(timer);
  });

  // Memory management: enforce tab suspension periodically (Bagian 8.2)
  $effect(() => {
    const interval = setInterval(() => {
      editorStore.enforceMemoryLimit();
    }, 30000);
    return () => clearInterval(interval);
  });

  // Debounced save for cursor/scroll changes
  const cursorSignal = editorStore.cursorSignal;
  $effect(() => {
    $cursorSignal;
    if (!activeTab) return;
    debouncedSaveCursorScroll();
  });

  // Debounced save for expanded paths
  const expandedPathsStore = uiStore.expandedPaths;
  $effect(() => {
    const paths = $expandedPathsStore;
    if (paths.size > 0) debouncedSaveExpanded();
  });

  // Global event listeners
  $effect(() => {
    window.addEventListener('keydown', handleGlobalKeydown);
    const preventCM = (e: MouseEvent) => e.preventDefault();
    window.addEventListener('contextmenu', preventCM);
    const openCmd = () => {
      commandPaletteInitialQuery = '>';
      isCommandPaletteOpen = true;
    };
    window.addEventListener('open-command-palette', openCmd);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeydown);
      window.removeEventListener('contextmenu', preventCM);
      window.removeEventListener('open-command-palette', openCmd);
    };
  });
</script>

<div class="h-screen w-screen flex flex-col overflow-hidden bg-canvas text-primary"
  class:dark={isDark}
>


  <div class="h-8 flex items-center justify-between px-2 select-none bg-surface-2 text-primary">
    <div data-tauri-drag-region class="flex items-center h-full flex-1">
      <img src="/notron.png" alt="Notron Logo" class="w-4 h-4 ml-1 pointer-events-none" />
      <TitleMenuBar />
    </div>
    <div data-tauri-drag-region class="h-full flex items-center justify-center flex-1">
      <div class="flex items-center gap-1">
        <button 
          class="p-1 rounded transition-colors hover:bg-hover text-icon-default hover:text-icon-active disabled:opacity-50 disabled:cursor-not-allowed"
          onclick={() => navigationStore.navigateBack()}
          title="Go Back (Alt+LeftArrow)"
          disabled={$navigationStore.backStack.length === 0}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
        </button>
        <button 
          class="p-1 rounded transition-colors hover:bg-hover text-icon-default hover:text-icon-active disabled:opacity-50 disabled:cursor-not-allowed"
          onclick={() => navigationStore.navigateForward()}
          title="Go Forward (Alt+RightArrow)"
          disabled={$navigationStore.forwardStack.length === 0}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
        </button>

        <button 
          class="flex items-center justify-center w-72 h-6 px-3 mx-2 rounded-md border border-subtle bg-surface hover:bg-hover transition-colors text-xs text-secondary hover:text-primary cursor-pointer shadow-sm nodrag"
          onclick={() => {
            commandPaletteInitialQuery = '';
            isCommandPaletteOpen = true;
          }}
          title="Search files (Ctrl+P)"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2 opacity-70"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <span class="truncate">{$ui.explorerRoot ? $ui.explorerRoot.split(/[/\\]/).pop() : 'Notron'}</span>
        </button>
      </div>
    </div>
    <div class="flex items-center justify-end flex-1">
      <button aria-label="Minimize" onclick={() => getCurrentWindow().minimize()} class="p-2 bg-transparent transition-colors hover:bg-hover text-icon-default hover:text-icon-active">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>
      <button aria-label="Maximize" onclick={() => getCurrentWindow().toggleMaximize()} class="p-2 bg-transparent transition-colors hover:bg-hover text-icon-default hover:text-icon-active">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/></svg>
      </button>
      <button aria-label="Close" onclick={() => getCurrentWindow().close()} class="p-2 bg-transparent transition-colors hover:bg-red-500 text-icon-default hover:text-white">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  </div>

  {#if !appReady}
    <div class="flex flex-1 overflow-hidden">
      <!-- Activity Bar Skeleton -->
      <div class="w-12 shrink-0 border-r border-subtle bg-surface-2"></div>

      <!-- Sidebar Skeleton -->
      {#if $ui.isSidebarOpen}
        <div class="shrink-0 border-r border-subtle bg-surface" style="width: {$ui.sidebarWidth}px"></div>
      {/if}

      <!-- Main Editor Area & Terminal Skeleton -->
      <div class="flex flex-1 flex-col overflow-hidden bg-canvas">
        <!-- Editor Tabs Header Skeleton -->
        <div class="h-9 shrink-0 border-b border-subtle bg-surface-2"></div>
        
        <!-- Editor Body Skeleton -->
        <div class="flex-1 bg-canvas"></div>

        <!-- Terminal Panel Skeleton -->
        {#if $terminalStore.isVisible}
          <div class="shrink-0 border-t border-subtle bg-surface-2" style="height: {$terminalStore.isMaximized ? 'calc(100vh - 2rem)' : `${$terminalStore.height}px`};"></div>
        {/if}
      </div>
    </div>
  {:else}
  <div class="flex flex-1 overflow-hidden">
    <div class="w-12 flex flex-col items-center py-0 justify-between z-10 border-r border-subtle bg-surface-2">
      <div class="flex flex-col items-center gap-1 w-full mt-2">
        <button aria-label="Explorer" onclick={() => { if ($ui.isSidebarOpen && $ui.activeSidebarPanel === 'explorer') uiStore.setSidebarOpen(false); else { uiStore.setActiveSidebarPanel('explorer'); uiStore.setSidebarOpen(true); } }} class="p-2 mb-2 bg-transparent cursor-pointer relative transition-colors hover:text-icon-active"
          class:text-icon-active-tab={$ui.activeSidebarPanel === 'explorer' && $ui.isSidebarOpen}
          class:text-icon-default={!($ui.activeSidebarPanel === 'explorer' && $ui.isSidebarOpen)}
        >
          {#if $ui.activeSidebarPanel === 'explorer' && $ui.isSidebarOpen}
            <div class="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-8 bg-indicator-active"></div>
          {/if}
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
        </button>
        <button aria-label="Search" onclick={() => { if ($ui.isSidebarOpen && $ui.activeSidebarPanel === 'search') uiStore.setSidebarOpen(false); else { uiStore.setActiveSidebarPanel('search'); uiStore.setSidebarOpen(true); } }} class="p-2 mb-2 bg-transparent cursor-pointer relative transition-colors hover:text-icon-active"
          class:text-icon-active-tab={$ui.activeSidebarPanel === 'search' && $ui.isSidebarOpen}
          class:text-icon-default={!($ui.activeSidebarPanel === 'search' && $ui.isSidebarOpen)}
        >
          {#if $ui.activeSidebarPanel === 'search' && $ui.isSidebarOpen}
            <div class="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-8 bg-indicator-active"></div>
          {/if}
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        </button>
      </div>
      <button aria-label="Settings" onclick={openSettings} class="p-2 bg-transparent cursor-pointer mb-2 text-icon-default hover:text-icon-active transition-colors">
        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      </button>
    </div>

    {#if $ui.isSidebarOpen}
      <div style="width: {$ui.sidebarWidth}px" class="flex flex-col border-r z-50 relative shrink-0 border-subtle bg-surface">
        <div
          role="presentation"
          class="absolute right-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-blue-500 active:bg-blue-500 z-50 transition-colors delay-100"
          onmousedown={(e) => {
            e.preventDefault();
            const startX = e.clientX;
            const startWidth = $ui.sidebarWidth;
            function handleMouseMove(me: MouseEvent) { setSidebarWidth(Math.max(160, Math.min(startWidth + (me.clientX - startX), 600))); }
            function handleMouseUp(_me: MouseEvent) {
              document.removeEventListener('mousemove', handleMouseMove);
              document.removeEventListener('mouseup', handleMouseUp);
              // Save sidebar width immediately on drag end (Bagian 3.3)
              saveWorkspaceSession();
            }
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
          }}
        ></div>
        <div class="h-9 flex items-center justify-between px-4 text-xs font-semibold tracking-widest select-none uppercase text-secondary">
          <span>{$ui.activeSidebarPanel === 'explorer' ? 'Explorer' : 'Search'}</span>
          {#if $ui.activeSidebarPanel === 'explorer'}
            <Tooltip content="Toggle Dot Files">
              <button aria-label="Toggle Dot Files" onclick={() => uiStore.toggleShowDotFiles()} class="p-1 rounded transition-colors hover:bg-hover" class:text-accent={$ui.showDotFiles} class:text-icon-default={!$ui.showDotFiles} class:hover:text-icon-active={true}>
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
              </button>
            </Tooltip>
          {:else if $ui.activeSidebarPanel === 'search'}
            {@const canSearchAction = $ui.searchQuery.length > 0 && $ui.searchResultCount > 0}
            <div class="flex items-center gap-0.5">
              <Tooltip content="Smart Search">
                <button aria-label="Smart Search" onclick={() => showSmartSearchModal = true} class="p-1 rounded transition-colors hover:bg-hover text-accent hover:text-accent/90">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/></svg>
                </button>
              </Tooltip>
              <Tooltip content="Refresh">
                <button aria-label="Refresh" onclick={() => uiStore.triggerSearchRefresh()} class="p-1 rounded transition-colors hover:bg-hover text-icon-default" disabled={!canSearchAction} class:opacity-50={!canSearchAction} class:cursor-not-allowed={!canSearchAction} class:hover:text-icon-active={canSearchAction}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                </button>
              </Tooltip>
              <Tooltip content="Collapse All">
                <button aria-label="Collapse All" onclick={() => uiStore.triggerSearchCollapseAll()} class="p-1 rounded transition-colors hover:bg-hover text-icon-default" disabled={!canSearchAction} class:opacity-50={!canSearchAction} class:cursor-not-allowed={!canSearchAction} class:hover:text-icon-active={canSearchAction}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
                </button>
              </Tooltip>
            </div>
          {/if}
        </div>
        <div class="flex-1 overflow-y-auto text-sm hover-scrollbar">
          {#if $ui.activeSidebarPanel === 'explorer'}
            <div class="flex flex-col h-full">
              {#if $ui.explorerRoot}
                <div class="flex flex-col h-full">
                  <div class="group h-7 flex items-center justify-between px-4 border-b border-subtle shrink-0 bg-surface">
                    <span class="text-[11px] font-semibold uppercase truncate pr-2 text-primary">
                      {$ui.explorerRoot.split(/[/\\]/).pop() || 'WORKSPACE'}
                    </span>
                    <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <Tooltip content="New File">
                        <button aria-label="New File" onclick={(e) => { e.preventDefault(); e.stopPropagation(); document.dispatchEvent(new CustomEvent('notron-create-file')); }} class="p-1 rounded transition-colors hover:bg-hover text-icon-default hover:text-icon-active">
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
                        </button>
                      </Tooltip>
                      <Tooltip content="New Folder">
                        <button aria-label="New Folder" onclick={(e) => { e.preventDefault(); e.stopPropagation(); document.dispatchEvent(new CustomEvent('notron-create-folder')); }} class="p-1 rounded transition-colors hover:bg-hover text-icon-default hover:text-icon-active">
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/><line x1="12" y1="10" x2="12" y2="16"/><line x1="9" y1="13" x2="15" y2="13"/></svg>
                        </button>
                      </Tooltip>
                      <Tooltip content="Refresh Explorer">
                        <button aria-label="Refresh Explorer" onclick={() => uiStore.triggerExplorerRefresh()} class="p-1 rounded transition-colors hover:bg-hover text-icon-default hover:text-icon-active">
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                        </button>
                      </Tooltip>
                      <Tooltip content="Collapse Explorer">
                        <button aria-label="Collapse Explorer" onclick={() => uiStore.triggerExplorerCollapse()} class="p-1 rounded transition-colors hover:bg-hover text-icon-default hover:text-icon-active">
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
                        </button>
                      </Tooltip>
                    </div>
                  </div>
                  <div class="flex-1 flex flex-col overflow-hidden outline-none">
                    <FileTree rootPath={$ui.explorerRoot} />
                  </div>
                </div>
              {:else}
                <div class="p-4 flex flex-col gap-3">
                  <span class="text-xs text-muted">You have not yet opened a folder.</span>
                  <div class="flex flex-col gap-2">
                    <button onclick={handleOpenFolder} class="text-xs py-1.5 px-3 rounded text-center w-full cursor-pointer transition-colors bg-accent hover:bg-accent-hover text-on-accent">Open Folder</button>
                    <button onclick={handleOpenFile} class="text-xs py-1.5 px-3 rounded text-center w-full cursor-pointer transition-colors bg-surface-2 hover:bg-hover text-primary">Open File</button>
                  </div>
                </div>
              {/if}
            </div>
          {:else if SearchPanelComponent}
            <div class="flex flex-col h-full overflow-hidden">
              <SearchPanelComponent />
            </div>
          {/if}
        </div>
      </div>
    {/if}

    <div class="flex flex-1 flex-col overflow-hidden bg-canvas">
      {#if $tabs.length > 0}
        <div class="flex h-9 overflow-hidden shrink-0 bg-surface-2">
          <div role="region" aria-label="Tabs" class="flex-1 flex overflow-x-auto scrollbar-hide" oncontextmenu={handleEmptyTabAreaContextMenu}>
            {#each $tabs as tab (tab.id)}
              <div
                role="tab"
                tabindex="0"
                class="flex shrink-0 items-center gap-2 px-3 min-w-32 max-w-48 border-r cursor-pointer border-subtle"
                class:bg-canvas={$activeTabId === tab.id}
                class:text-primary={$activeTabId === tab.id}
                class:border-t-2={$activeTabId === tab.id}
                class:border-t-indicator-active={$activeTabId === tab.id}
                class:bg-surface-2={$activeTabId !== tab.id}
                class:text-secondary={$activeTabId !== tab.id}
                class:hover:bg-hover={$activeTabId !== tab.id}
                class:hover:text-primary={$activeTabId !== tab.id}
                onclick={() => editorStore.setActiveTab(tab.id)}
                ondblclick={() => editorStore.pinTab(tab.id)}
                onkeydown={(e) => { if (e.key === 'Enter') editorStore.setActiveTab(tab.id); }}
                oncontextmenu={(e) => handleTabContextMenu(e, tab.id)}
              >
                {#if tab.language === 'welcome'}
                  <img src="/notron.png" alt="Welcome" class="w-3.5 h-3.5 grayscale opacity-80 pointer-events-none" />
                {:else}
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
                {/if}
                <span class="text-xs truncate flex-1" class:italic={tab.isPreview}>
                  {(() => {
                    const duplicates = $tabs.filter((t: any) => t.name === tab.name);
                    if (duplicates.length > 1 && !tab.path.startsWith('Untitled')) {
                      const parts = tab.path.split(/[/\\]/);
                      if (parts.length >= 2) {
                        return `${tab.name} \u00A0...${parts[parts.length - 2]}`;
                      }
                    }
                    return tab.name;
                  })()}
                </span>
                {#if tab.isModified}
                  <div class="w-2 h-2 rounded-full bg-accent shrink-0"></div>
                {:else if tab.status === 'conflict'}
                  <div class="w-2 h-2 rounded-full bg-status-warning shrink-0" title="External changes detected"></div>
                {:else if tab.status === 'deleted'}
                  <div class="w-2 h-2 rounded-full bg-status-error shrink-0" title="File deleted"></div>
                {/if}
                {#if tab.content === null && !tab.isModified && !tab.isLargeFile}
                  <div class="w-2 h-2 rounded-full bg-muted shrink-0 animate-pulse"></div>
                {/if}
                {#if tab.isPinned}
                  <button aria-label="Unpin tab" class="p-0.5 rounded transition-colors hover:bg-active"
                    onclick={(e) => { e.stopPropagation(); editorStore.togglePin(tab.id); }}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="opacity-80 rotate-45"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>
                  </button>
                {:else}
                  <button aria-label="Close tab" class="p-0.5 rounded transition-colors hover:bg-active text-icon-default hover:text-icon-active"
                    onclick={(e) => { e.stopPropagation(); handleTabClose(tab.id); }}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                {/if}
              </div>
            {/each}
          </div>

          {#if activeTab && activeTab.path.toLowerCase().endsWith('.md')}
            <div class="flex items-center shrink-0 px-2 border-l border-subtle bg-surface-2">
              <Tooltip content="Open Preview">
                <button
                  aria-label="Open Preview"
                  onclick={() => {
                    editorStore.addTab({
                      id: `${activeTab.id}-preview`,
                      path: activeTab.path,
                      name: `${activeTab.name} (Preview)`,
                      content: activeTab.content,
                      language: 'markdown-preview',
                      isPreview: false
                    });
                  }}
                  class="p-1.5 rounded-md transition-colors text-icon-default hover:text-icon-active hover:bg-hover"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                </button>
              </Tooltip>
            </div>
          {/if}
        </div>

        {#if !(activeTab && (activeTab.path.startsWith('Untitled') || activeTab.language === 'settings'))}
          <Breadcrumbs />
        {/if}
      {/if}

      <div class="flex-1 relative overflow-hidden" class:hidden={$terminalStore.isMaximized}>
        {#if $tabs.length === 0}
<div class="absolute inset-0 flex flex-col items-center justify-center gap-4 text-muted">
             <div class="flex flex-col gap-2">
               <div class="flex items-center gap-4"><span class="w-24 text-right">New File</span><kbd class="px-2 py-0.5 rounded text-xs bg-surface-2 border border-subtle">Ctrl+N</kbd></div>
               <div class="flex items-center gap-4"><span class="w-24 text-right">Open File</span><kbd class="px-2 py-0.5 rounded text-xs bg-surface-2 border border-subtle">Ctrl+O</kbd></div>
               <div class="flex items-center gap-4"><span class="w-24 text-right">Commands</span><kbd class="px-2 py-0.5 rounded text-xs bg-surface-2 border border-subtle">Ctrl+Shift+P</kbd></div>
             </div>
           </div>
        {:else if activeTab}
          {#if activeTab.language === 'markdown-preview' && MarkdownPreviewComponent}
            <MarkdownPreviewComponent key={activeTab.id} path={activeTab.path} />
          {:else if activeTab.language === 'image' && ImageViewerComponent}
            <ImageViewerComponent key={activeTab.id} filePath={activeTab.path} />
          {:else if activeTab.language === 'welcome'}
            <WelcomeTab />
          {:else if activeTab.language === 'settings' && SettingsPageComponent}
            <SettingsPageComponent />
          {:else if activeTab.isLoading}
            <div class="absolute inset-0 flex items-center justify-center">
              <div class="flex items-center gap-3">
                <svg class="animate-spin h-4 w-4 text-muted" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                <span class="text-xs text-muted">Loading...</span>
              </div>
            </div>
          {:else if activeTab.isUnsupported}
            <div class="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted bg-canvas select-none">
              <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" class="opacity-50"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
              <span class="text-sm">The file is not displayed in the editor because it is either binary or uses an unsupported text encoding.</span>
            </div>
          {:else if activeTab.content === null}
            <div class="absolute inset-0 flex items-center justify-center text-xs text-muted">Suspended — click to reload</div>
          {:else if EditorComponent}
            {#key activeTab.id + (isDark ? '-d' : '-l')}
              <EditorComponent tabId={activeTab.id} content={activeTab.content} filePath={activeTab.path} />
            {/key}
          {:else}
            <div class="absolute inset-0 flex items-center justify-center">
              <div class="flex items-center gap-3">
                <svg class="animate-spin h-4 w-4 text-muted" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                <span class="text-xs text-muted">Loading editor...</span>
              </div>
            </div>
          {/if}
        {/if}
      </div>
      <TerminalPanel />
    </div>
  </div>
  {/if}

  <div class="h-6 flex items-center justify-between px-3 text-xs select-none border-t bg-surface-2 text-primary border-subtle">
    <div class="flex items-center gap-4 relative min-w-[200px]">
      {#if $ui.globalStatus}
        <span class="animate-in fade-in duration-200" title={$ui.globalStatus}>
          {$ui.globalStatus.length > 40 ? $ui.globalStatus.slice(0, 40) + '...' : $ui.globalStatus}
        </span>
      {:else if $saveStatus}
        <span class="text-muted animate-in fade-in duration-200">{$saveStatus}</span>
      {:else}
        <span class="animate-in fade-in duration-200">Ready</span>
      {/if}
      {#if activeTab}<span>{activeTab.language}</span>{/if}
    </div>
    <div class="flex items-center gap-4">
      <span>{currentCursorPos}</span>
      <span>UTF-8</span>
      <span>LF</span>
    </div>
  </div>
</div>

{#if CommandPaletteComponent && isCommandPaletteOpen}
  <CommandPaletteComponent isOpen={true} onClose={() => isCommandPaletteOpen = false} initialQuery={commandPaletteInitialQuery} />
{/if}

{#if SettingsPageComponent && isSettingsOpen}
  <SettingsPageComponent isOpen={true} onClose={() => isSettingsOpen = false} />
{/if}

{#if GoToLineComponent && isGoToLineOpen}
  <GoToLineComponent isOpen={true} onClose={() => isGoToLineOpen = false} onGoToLine={(line: number) => {
    import('./lib/stores/navigation').then(m => {
      if (activeTab) {
        m.navigationStore.recordNavigation({ path: activeTab.path, line, col: 1 });
      }
    });
    window.dispatchEvent(new CustomEvent('editor:action', { detail: { action: 'goto', line } }));
  }} />
{/if}

<CloseTabDialog
  isOpen={!!closingTabId}
  fileName={$tabs.find((t: any) => t.id === closingTabId)?.name || 'Untitled'}
  onCancel={() => closingTabId = null}
  onDontSave={() => { if (closingTabId) { editorStore.closeTab(closingTabId); } closingTabId = null; debouncedSaveFullSession(); }}
  onSave={handleCloseSave}
/>

<NewFileDialog 
  isOpen={$ui.isNewFileDialogOpen}
  isFromWelcome={$ui.newFileDialogSource === 'welcome'}
  onClose={() => uiStore.closeNewFileDialog()} 
/>

<TrustModal />
<RecentFoldersModal />

{#if tabCtxMenu.isOpen}
  <div
    data-notron-context-menu="true"
    class="fixed min-w-[160px] rounded-md border p-1 shadow-md z-[100] animate-in fade-in duration-100 bg-surface-2 border-subtle text-primary"
    style="left: {tabCtxMenu.x}px; top: {tabCtxMenu.y}px;"
    role="presentation"
    onclick={(e) => e.stopPropagation()}
    oncontextmenu={(e) => e.stopPropagation()}
  >
    {#each tabCtxMenu.items as item, i (item.id || i)}
      {#if item.separator}
        <div class="h-px my-1 bg-subtle"></div>
      {:else}
        <button
          class="flex items-center justify-between w-full px-2 py-1.5 text-xs rounded-sm cursor-pointer select-none outline-none transition-colors {!item.disabled ? 'hover:bg-selected focus:bg-selected hover:text-primary focus:text-primary text-secondary' : 'text-muted opacity-50 cursor-not-allowed'}"
          disabled={item.disabled}
          onclick={(e) => { 
            e.stopPropagation(); 
            if (item.action) item.action();
            tabCtxMenu.isOpen = false;
          }}
        >
          <span>{item.label}</span>
          {#if item.shortcut}
            <span class="ml-auto text-[10px] text-muted opacity-80">{item.shortcut}</span>
          {/if}
        </button>
      {/if}
    {/each}
  </div>
{/if}
<ToastContainer />
<SmartSearchModal isOpen={showSmartSearchModal} onClose={() => showSmartSearchModal = false} />

<style>
  .scrollbar-hide::-webkit-scrollbar { display: none; }
  .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
</style>