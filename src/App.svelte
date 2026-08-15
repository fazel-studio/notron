<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { open, save } from '@tauri-apps/plugin-dialog';
  import { listen } from '@tauri-apps/api/event';
  import { editorStore } from './lib/stores/editor';
  import { uiStore } from './lib/stores/ui';
  import { getHumanReadableError } from './lib/utils/error';
  import { settingsStore } from './lib/stores/settings.svelte';
  import { themeStore } from './lib/stores/theme';
  import { getFileIcon } from './lib/components/TreeNode.svelte';
  import FileTree from './lib/components/FileTree.svelte';
  import Tooltip from './lib/components/Tooltip.svelte';
  import MaterialIcon from './lib/components/MaterialIcon.svelte';
  import { preloadMaterialIcons } from './lib/utils/materialIconRenderer.svelte';
  import TitleMenuBar from './lib/components/TitleMenuBar.svelte';
  import CloseTabDialog from './lib/components/CloseTabDialog.svelte';
  import WelcomeTab from './lib/components/WelcomeTab.svelte';
  import NewFileDialog from './lib/components/NewFileDialog.svelte';
  import TrustModal from './lib/components/TrustModal.svelte';
  import RecentFoldersModal from './lib/components/RecentFoldersModal.svelte';
  import TerminalPanel from './lib/components/TerminalPanel.svelte';
  import SmartSearchModal from './lib/components/SmartSearchModal.svelte';
  import ToastContainer from './lib/components/ToastContainer.svelte';
  import SvgViewToggle from './lib/components/SvgViewToggle.svelte';
  import { terminalStore } from './lib/stores/terminal';
  import { paletteStore, type PaletteItem } from './lib/stores/palette';
  import { navigationStore } from './lib/stores/navigation';
  import { gitDecorationStore } from './lib/stores/gitDecoration';
  import { gitRepoStore } from './lib/stores/gitRepo';
  import { onMount } from 'svelte';

  const tabs = editorStore.tabs;
  const activeTabId = editorStore.activeTabId;
  const saveStatus = editorStore.saveStatus;
  const ui = uiStore;

  let gitRepo = $derived($gitRepoStore.repo);
  let gitLoading = $derived($gitRepoStore.repoLoading || $gitRepoStore.syncing || $gitRepoStore.availabilityLoading);
  let gitChangesCount = $derived(gitRepo ? gitRepo.staged.length + repoUnstagedLength(gitRepo) + gitRepo.conflicted.length : 0);

  function repoUnstagedLength(repo: any) {
    return repo.unstaged.length + repo.untracked.length;
  }

  let closingTabId = $state<string | null>(null);
  let isClosingWindow = $state(false);
  let closeQueue = $state<string[]>([]);
  let pendingCloseConfirmed = $state(false);
  let isCommandPaletteOpen = $state(false);
  let commandPaletteInitialQuery = $state('');
  let isSettingsOpen = $state(false);
  let isGoToLineOpen = $state(false);
  let appReady = $state(false);
  let currentCursorPos = $state('Ln 1, Col 1');
  let isMaximized = $state(false);

  let CommandPaletteComponent = $state<any>(null);
  let SettingsPageComponent = $state<any>(null);
  let GoToLineComponent = $state<any>(null);
  let SearchPanelComponent = $state<any>(null);
  let SourceControlPanelComponent = $state<any>(null);
  let RunPanelComponent = $state<any>(null);
  let MarkdownPreviewComponent = $state<any>(null);
  let ImageViewerComponent = $state<any>(null);
  let EditorComponent = $state<any>(null);
  let DiffEditorComponent = $state<any>(null);

  let showSmartSearchModal = $state(false);
  let activeTab = $derived($tabs.find((t: any) => t.id === $activeTabId) || null);
  let isDark = $derived($themeStore.isDark);

  // Precomputed name→count map so the tab bar avoids an O(n²) filter per render.
  const tabNameCounts = $derived(
    $tabs.reduce((m, t: any) => {
      if (t.path?.startsWith('Untitled')) return m;
      m.set(t.name, (m.get(t.name) ?? 0) + 1);
      return m;
    }, new Map<string, number>())
  );

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

  $effect(() => {
    const appWindow = getCurrentWindow();
    const syncMaximized = () => appWindow.isMaximized().then((v) => { isMaximized = v; }).catch(() => {});
    syncMaximized();
    const unlisten = appWindow.onResized(syncMaximized);
    return () => { unlisten.then((fn) => fn()).catch(() => {}); };
  });

  // Record navigation history when active tab changes
  let lastActiveTabId = $state<string | null>(null);
  $effect(() => {
    const tabId = $activeTabId;
    if (!tabId || tabId === lastActiveTabId) return;
    const tab = $tabs.find((t: any) => t.id === tabId);
    if (tab && tab.path && !tab.path.startsWith('Untitled') && tab.language !== 'welcome' && tab.language !== 'settings') {
      const cursor = editorStore.getCursor(tabId);
      navigationStore.recordNavigation({
        path: tab.path,
        line: cursor?.line || 1,
        col: cursor?.column || 1
      });
    }
    lastActiveTabId = tabId;
  });

  // Intercept window close: prompt for unsaved changes before closing.
  // Tauri's onCloseRequested wrapper destroys the window when the handler does
  // NOT call event.preventDefault(). Closes are therefore forced with
  // destroy() (not a re-entrant close()) so the guard flag + beforeunload stay
  // consistent and the window reliably shuts down.
  $effect(() => {
    const appWindow = getCurrentWindow();
    const unlisten = appWindow.onCloseRequested((event) => {
      // A close was already confirmed earlier, so stop guarding the window.
      if (pendingCloseConfirmed) return;

      const modified = editorStore.getTabsSnapshot().filter((t: any) =>
        t.isModified || (t.path.startsWith('Untitled') && t.content && t.content.trim() !== '')
      );

      // No unsaved changes → close the window immediately, persisting the
      // session and clearing the crash flag so next launch isn't flagged as
      // "unexpected close".
      if (modified.length === 0) {
        event.preventDefault();
        pendingCloseConfirmed = true;
        saveWorkspaceSession().then(() => {
          invoke('set_crash_flag', { value: false }).catch(() => {});
          appWindow.destroy();
        });
        return;
      }

      // Unsaved changes → block the close and prompt the user.
      event.preventDefault();
      isClosingWindow = true;
      closeQueue = modified.map((t: any) => t.id);
      closingTabId = closeQueue[0];
    });
    return () => { unlisten.then((fn) => fn()).catch(() => {}); };
  });

  // Sync settings theme to themeStore
  $effect(() => {
    if (settingsStore.effectiveSettings.theme) {
      themeStore.setTheme(settingsStore.effectiveSettings.theme);
    }
  });

  // Warm the material icon cache as soon as the material theme is active, so
  // first renders are synchronous (no <img> load flash).
  let prevIconTheme = $state(settingsStore.effectiveSettings.icon_theme);
  $effect(() => {
    const t = settingsStore.effectiveSettings.icon_theme;
    if (t === 'material' && prevIconTheme !== 'material') {
      preloadMaterialIcons();
    }
    prevIconTheme = t;
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
    if ($ui.activeSidebarPanel === 'git' && $ui.isSidebarOpen && !SourceControlPanelComponent) {
      import('./lib/components/SourceControlPanel.svelte').then(m => SourceControlPanelComponent = m.default);
    }
    if ($ui.activeSidebarPanel === 'run' && $ui.isSidebarOpen && !RunPanelComponent) {
      import('./lib/components/RunPanel.svelte').then(m => RunPanelComponent = m.default);
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
      gitRepoStore.refreshRepoOnly();
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
        shortcut: 'Ctrl+W',
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
        let isLargeFile = false;
        let isPreview = false;
        if (!isImage) {
          try {
            content = await invoke<string>('read_file_text', { path: selected });
          } catch (e) {
            if (String(e) === '__BINARY__') content = '';
            else if (String(e) === '__LARGE_FILE__') {
              const chunked = await invoke<any>('read_file_chunked', { path: selected });
              content = chunked.content;
              isLargeFile = true;
              isPreview = true;
            } else throw e;
          }
        }
        editorStore.addTab({
          id: `tab-${Date.now()}`, path: selected, name: fileName, content,
          language: isImage ? 'image' : await invoke<string>('detect_language', { path: selected }),
          isPreview,
          isLargeFile
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
        shortcut: 'Ctrl+N',
        action: handleNewTextFile
      },
      {
        id: 'open_file',
        label: 'Open File',
        shortcut: 'Ctrl+O',
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
    if ((activeTab?.language === 'image' || activeTab?.path.toLowerCase().endsWith('.svg')) && !ImageViewerComponent) {
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
        terminalActivePanel: termVal.activePanel,
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
          tabs: session.tabs.filter((t: any) => t.isModified && t.content !== undefined && !t.isLargeFile).map((t: any) => ({
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

  // 0.6 — record a frontend startup phase in the Rust StartupTimers store,
  // queryable later via `get_startup_timers`.
  function recordStartupPhase(name: string) {
    invoke('record_startup_timer', { name }).catch(() => {});
  }

  // ============================================================
  // Section 1.2: Shell-First Rendering + Tiered State Loading
  // Section 1.4 + 6.1: IPC Batching — all startup queries in ONE round-trip
  // ============================================================
  async function stagedStartup() {
    // Phase 0: Shell renders immediately (appReady=false shows skeleton)
    // Theme + dimensions already loaded from localStorage (sync)
    appReady = false;
    recordStartupPhase('frontend-start');

    const root = uiStore.getSnapshot().explorerRoot;

    // Hoisted so the crash-recovery phase (outside the try block) can read it.
    let crashFlag = false;

    try {
      // Phase 2: Single IPC round-trip for ALL startup state
      const startupState = await invoke<{
        config: any;
        critical: any;
        ui_state: any | null;
        session_pairs: [string, string][];
        global_settings: Record<string, any>;
        workspace_settings: Record<string, any>;
        crash_flag: boolean;
      }>('load_startup_state', { workspaceId: root || null });

      // Apply settings from the folded startup payload (no extra round-trips)
      settingsStore.applyLoadedSettings(
        startupState.global_settings,
        startupState.workspace_settings,
        root || undefined
      );

      // Capture crash flag before leaving the try block's scope
      crashFlag = startupState.crash_flag === true;

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
            
            // Apply terminal state
            terminalStore.setTerminals(parsed.terminals || [], parsed.activeTerminalId || null);
            if (parsed.terminalMaximized !== undefined) terminalStore.setMaximize(parsed.terminalMaximized);
            if (parsed.terminalHeight !== undefined) terminalStore.setHeight(parsed.terminalHeight);
            if (parsed.terminalActivePanel !== undefined) terminalStore.setActivePanel(parsed.terminalActivePanel);
            if (parsed.terminalVisible !== undefined) terminalStore.setVisibility(parsed.terminalVisible);

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

    recordStartupPhase('frontend-state-loaded');

    appReady = true;
    if (root) {
      gitRepoStore.setWorkspace(root);
    }
    recordStartupPhase('frontend-ready');
    setTimeout(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          invoke('show_main_window').catch(e => console.error('Failed to show window', e));
        });
      });
    }, 150);

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

    // Phase 4: Crash Recovery Check (flag is now included in startup state)
    try {
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
    recordStartupPhase('frontend-done');
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
    // Warm the file index for Ctrl+P in the background (non-blocking)
    idle(() => {
      if (uiStore.getSnapshot().explorerRoot) {
        ensurePaletteLoaded();
      }
    });
    // Preload material icon SVGs so first renders are instant (no <img> flash)
    idle(() => {
      if (settingsStore.effectiveSettings.icon_theme === 'material') {
        preloadMaterialIcons();
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
        } else if (String(err) === '__LARGE_FILE__') {
          const chunked = await invoke<any>('read_file_chunked', { path });
          editorStore.setInitialContent(tabId, chunked.content);
          // Set isLargeFile to true and disable editing to prevent data loss
          editorStore.updateTab(tabId, { isLargeFile: true, isPreview: true });
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
        global_settings: Record<string, any>;
        workspace_settings: Record<string, any>;
        crash_flag: boolean;
      }>('load_startup_state', { workspaceId: root || null });

      settingsStore.applyLoadedSettings(
        startupState.global_settings,
        startupState.workspace_settings,
        root
      );

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

            terminalStore.setTerminals(parsed.terminals || [], parsed.activeTerminalId || null);
            if (parsed.terminalMaximized !== undefined) terminalStore.setMaximize(parsed.terminalMaximized);
            if (parsed.terminalHeight !== undefined) terminalStore.setHeight(parsed.terminalHeight);
            if (parsed.terminalActivePanel !== undefined) terminalStore.setActivePanel(parsed.terminalActivePanel);
            if (parsed.terminalVisible !== undefined) terminalStore.setVisibility(parsed.terminalVisible);

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
      }).catch(async err => {
        if (String(err) === '__BINARY__') {
          editorStore.setTabUnsupported(tabId, true);
          editorStore.setInitialContent(tabId, '');
        } else if (String(err) === '__LARGE_FILE__') {
          try {
            const { Channel } = await import('@tauri-apps/api/core');
            const channel = new Channel<{ chunk: string; done: boolean }>();
            let firstChunk = true;
            channel.onmessage = (message) => {
               if (message.done) {
                  editorStore.updateTab(tabId, { isLoading: false });
                  return;
               }
               if (firstChunk) {
                   editorStore.setInitialContent(tabId, message.chunk);
                   editorStore.updateTab(tabId, { isLargeFile: true, isPreview: true });
                   firstChunk = false;
               } else {
                   window.dispatchEvent(new CustomEvent('editor:append-chunk', {
                       detail: { tabId, chunk: message.chunk }
                   }));
               }
            };
            await invoke('read_file_stream', { path, channel });
          } catch(e) { console.error(e); }
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
    if (activeTab && activeTab.language !== 'markdown-preview' && activeTab.language !== 'image' && activeTab.language !== 'welcome' && !EditorComponent && !activeTab.isDiff) {
      import('./lib/components/Editor.svelte').then(m => EditorComponent = m.default);
    }
    if (activeTab && activeTab.isDiff && !DiffEditorComponent) {
      import('./lib/components/DiffEditor.svelte').then(m => DiffEditorComponent = m.default);
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

  // Palette file index is built lazily (on first palette open) so startup never
  // blocks on a full workspace walk. An idle prefetch warms it afterwards.
  let paletteLoadedFor = $state<string | null>(null);

  function openFileFromPalette(path: string) {
    const name = path.split(/[/\\]/).pop() || 'Unknown';
    editorStore.addTab({ id: path, path, name, content: null, language: 'plaintext', isPreview: false });
    editorStore.setActiveTab(path);
  }

  function ensurePaletteLoaded() {
    const root = uiStore.getSnapshot().explorerRoot;
    if (root) {
      if (paletteLoadedFor === root) return;
      paletteLoadedFor = root;
      paletteStore.loadWorkspaceFiles(root, baseCommands, openFileFromPalette);
    } else {
      paletteStore.initItems(baseCommands);
    }
  }

  function openCommandPalette(initialQuery = '') {
    commandPaletteInitialQuery = initialQuery;
    ensurePaletteLoaded();
    isCommandPaletteOpen = true;
  }

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

  function advanceCloseQueue() {
    closeQueue = closeQueue.slice(1);
    if (closeQueue.length > 0) {
      closingTabId = closeQueue[0];
    } else {
      isClosingWindow = false;
      closingTabId = null;
      pendingCloseConfirmed = true;
      // Persist the session + clear the crash flag, then force-close. destroy()
      // bypasses beforeunload, so save explicitly instead of relying on it.
      saveWorkspaceSession().then(() => {
        invoke('set_crash_flag', { value: false }).catch(() => {});
        getCurrentWindow().destroy();
      });
    }
  }

  function handleCloseDialogCancel() {
    if (isClosingWindow) {
      isClosingWindow = false;
      closeQueue = [];
    }
    closingTabId = null;
  }

  function handleCloseDialogDontSave() {
    if (!closingTabId) return;
    editorStore.closeTab(closingTabId);
    if (isClosingWindow) {
      advanceCloseQueue();
    } else {
      closingTabId = null;
      debouncedSaveFullSession();
    }
  }

  async function handleCloseSave() {
    if (!closingTabId) return;
    const tab = $tabs.find((t: any) => t.id === closingTabId);
    if (!tab) { closingTabId = null; return; }
    try {
      if (tab.path.startsWith('Untitled')) {
        const selected = await save();
        if (!selected || typeof selected !== 'string') return;
        await invoke('save_file', { path: selected, content: tab.content ?? '' });
      } else {
        if (tab.content !== null) {
          await invoke('save_file', { path: tab.path, content: tab.content });
        }
      }
    } catch (err) {
      uiStore.addToast('Save Failed', 'alert', getHumanReadableError(err));
      return;
    }
    editorStore.closeTab(closingTabId);
    if (isClosingWindow) {
      advanceCloseQueue();
    } else {
      closingTabId = null;
      debouncedSaveFullSession();
    }
  }

  function openGlobalSearch() {
    uiStore.setSidebarOpen(true);
    uiStore.setActiveSidebarPanel('search');
    setTimeout(() => {
      const el = document.querySelector<HTMLInputElement>('#global-search-input');
      el?.focus();
      el?.select();
    }, 50);
  }

  let chordPrefix: string | null = null;
  let chordTimeout: number | null = null;

  function clearChord() {
    chordPrefix = null;
    if (chordTimeout) clearTimeout(chordTimeout);
    chordTimeout = null;
    uiStore.setGlobalStatus(null);
  }

  function handleGlobalKeydown(e: KeyboardEvent) {
    const isMac = navigator.userAgent.toLowerCase().includes('mac');
    const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;
    const key = e.key.toLowerCase();

    // ── CHORD LOGIC (e.g. Ctrl+K -> Ctrl+W) ──
    if (chordPrefix === 'Ctrl+K') {
      e.preventDefault();
      e.stopPropagation();
      if ((cmdOrCtrl && key === 'w') || key === 'w') {
        const tabs = editorStore.getTabsSnapshot();
        tabs.forEach((t: any) => handleTabClose(t.id));
      } else if ((cmdOrCtrl && key === 'o') || key === 'o') {
        import('@tauri-apps/plugin-dialog').then(({ open }) => {
          open({ directory: true }).then((selected) => {
            if (selected) {
              const path = Array.isArray(selected) ? selected[0] : selected;
              window.dispatchEvent(new CustomEvent('request-workspace-switch', { detail: { path } }));
            }
          });
        });
      }
      clearChord();
      return;
    }

    if (cmdOrCtrl && key === 'k' && !e.shiftKey) {
      e.preventDefault();
      chordPrefix = 'Ctrl+K';
      uiStore.setGlobalStatus("Ctrl+K was pressed. Waiting for second key of chord...");
      chordTimeout = setTimeout(() => {
        clearChord();
      }, 3000) as unknown as number;
      return;
    }

    // Close Tab (Ctrl+W / Ctrl+F4)
    if ((cmdOrCtrl && key === 'w') || e.key === 'F4') {
      if (cmdOrCtrl && !e.shiftKey) {
        e.preventDefault();
        const activeTabId = editorStore.getActiveTabIdSnapshot();
        if (activeTabId) editorStore.closeTab(activeTabId);
      }
    }

    // ── BLOKIR FITUR BAWAAN BROWSER ──
    // 1. Find / Search / Sidebar panels
    if ((cmdOrCtrl && (key === 'f' || key === 'g' || key === 'e')) || e.key === 'F3') {
      if (!e.shiftKey) e.preventDefault();
      // Ctrl+F opens the per-file find widget via the editor keymap; F3 /
      // Ctrl+G remain blocked. Ctrl+Shift+F opens the global search panel.
    }
    if (cmdOrCtrl && e.shiftKey && key === 'f') {
      e.preventDefault();
      openGlobalSearch();
    }
    if (cmdOrCtrl && e.shiftKey && key === 'e') {
      e.preventDefault();
      uiStore.setSidebarOpen(true);
      uiStore.setActiveSidebarPanel('explorer');
    }
    if (cmdOrCtrl && e.shiftKey && key === 'g') {
      e.preventDefault();
      uiStore.setSidebarOpen(true);
      uiStore.setActiveSidebarPanel('git');
    }
    // 2. Print & Save
    if (cmdOrCtrl && key === 'p') {
      e.preventDefault();
      if (e.shiftKey) {
        openCommandPalette('>');
      } else {
        openCommandPalette('');
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
    // 3. DevTools & View Source (Unblocked for debugging)
    // if (e.key === 'F12' || 
    //    (cmdOrCtrl && e.shiftKey && (key === 'i' || key === 'j')) || 
    //    (cmdOrCtrl && key === 'u')) {
    //   e.preventDefault();
    // }
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
    if (cmdOrCtrl && e.shiftKey && key === 'd') {
      e.preventDefault();
      uiStore.setSidebarOpen(true);
      uiStore.setActiveSidebarPanel('run');
    }
    if (cmdOrCtrl && key === 'd') {
      e.preventDefault();
      // Per-file find widget (VS Code "Ctrl+D" habit). The editor ignores the
      // event when no tab is open.
      window.dispatchEvent(new CustomEvent('editor:action', { detail: { action: 'find' } }));
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
    gitRepoStore.init();

    // Start staged startup
    lastLoadedRoot = uiStore.getSnapshot().explorerRoot;
    stagedStartup().catch(console.error);
  });

  $effect(() => {
    const root = $ui.explorerRoot;
    if (appReady && root && root !== lastLoadedRoot) {
      lastLoadedRoot = root;
      gitRepoStore.setWorkspace(root);
      loadWorkspaceState(root).catch(console.error);
    }
  });

  // Unified file watcher — the Rust backend owns watching (debounce 0.4,
  // coalescing, shared ignore rules 5.2) and fans out ONE `fs-change` event
  // per quiet window (5.1). The frontend only reacts:
  //   - FileTree.svelte   → Explorer cache/tree refresh
  //   - Here             → open-tab state (deleted / reload / renamed)
  interface FsChangeItem {
    type: 'created' | 'deleted' | 'renamed' | 'modified';
    path: string;
    parentPath?: string;
    oldPath?: string;
    newPath?: string;
  }

  $effect(() => {
    const explorerRoot = $ui.explorerRoot;
    if (!explorerRoot || !appReady) return;

    let unsubTabs = editorStore.tabs.subscribe(debouncedSaveFullSession);
    let unsubActive = editorStore.activeTabId.subscribe(debouncedSaveFullSession);

    let watchStarted = false;
    let unlistenFs: (() => void) | null = null;
    let watchTimer: number | undefined;

    watchTimer = setTimeout(async () => {
      // Delegate watching to the Rust unified service (5.1).
      try {
        await invoke('start_fs_watch', { root: explorerRoot });
        watchStarted = true;
      } catch (e) { console.error("Failed to start Rust file watcher:", e); }

      // D.2/D.7 — populate Git decorations for the Explorer immediately on
      // workspace open (the backend emits `git-decorations-changed`).
      try {
        await invoke('get_repo_state', { cwd: explorerRoot });
      } catch (e) { /* not a repo, git unavailable, etc. */ }

      unlistenFs = await listen('fs-change', async (event) => {
        const payload = (event.payload ?? {}) as { changes: FsChangeItem[] };
        const changes = payload.changes ?? [];
        if (changes.length === 0) return;

        const changedPaths = new Set<string>();
        const removedDecoPaths: string[] = [];

        for (const change of changes) {
          if (change.type === 'renamed') {
            if (change.oldPath && change.newPath) {
              editorStore.updateTabPath(change.oldPath, change.newPath);
              changedPaths.add(change.newPath);
              // Optimistically drop the stale decoration for the old path (D.7);
              // the backend's git-status-refresh will recompute the delta.
              removedDecoPaths.push(change.oldPath);
            }
          } else {
            if (change.path) changedPaths.add(change.path);
            if (change.type === 'deleted') {
              editorStore.markTabDeleted(change.path);
              removedDecoPaths.push(change.path);
            }
          }
        }

        if (removedDecoPaths.length > 0) {
          gitDecorationStore.removePaths(removedDecoPaths);
        }

        if (changedPaths.size === 0) return;

        // Reload open tabs affected by create/modify events — batched into
        // 2 IPC calls (get_files_metadata + batch_read_files) instead of N×2
        // per tab.
        const affectedTabs = editorStore.getTabsSnapshot().filter((tab: any) => {
          if (!tab.path || tab.path.startsWith('Untitled')) return false;
          return changedPaths.has(tab.path) && tab.content !== null;
        });

        if (affectedTabs.length === 0) return;

        const affectedPaths = affectedTabs.map((t: any) => t.path);
        const metadata = await invoke<any[]>('get_files_metadata', { paths: affectedPaths }).catch(() => []);
        const existing = new Set<string>(metadata.map((m: any) => m.path));
        const sizeByPath = new Map<string, number>(metadata.map((m: any) => [m.path, m.size]));

        // Mark deleted tabs
        for (const tab of affectedTabs) {
          if (!existing.has(tab.path)) editorStore.markTabDeleted(tab.id);
        }

        // Reload small files in one batch (large files via chunked reads)
        const smallTabs = affectedTabs.filter((t: any) => existing.has(t.path) && (sizeByPath.get(t.path) ?? 0) <= 1_048_576);
        const largeTabs = affectedTabs.filter((t: any) => existing.has(t.path) && (sizeByPath.get(t.path) ?? 0) > 1_048_576);

        if (smallTabs.length > 0) {
          const contents = await invoke<Record<string, string | null>>('batch_read_files', {
            paths: smallTabs.map((t: any) => t.path)
          }).catch(() => ({} as Record<string, string | null>));

          for (const tab of smallTabs) {
            const content = contents[tab.path];
            if (content === null || content === undefined) continue; // binary / unreadable
            const latestTab = editorStore.getTabsSnapshot().find((t: any) => t.id === tab.id);
            if (!latestTab) continue;
            if (!latestTab.isModified && content !== latestTab.content) {
              editorStore.setInitialContent(tab.id, content);
            } else if (latestTab.isModified && content !== latestTab.originalContent) {
              editorStore.markTabConflict(tab.id);
              console.warn(`External change detected for ${tab.path} while modified in editor`);
            }
          }
        }

        for (const tab of largeTabs) {
          try {
            const chunked = await invoke<any>('read_file_chunked', { path: tab.path });
            const latestTab = editorStore.getTabsSnapshot().find((t: any) => t.id === tab.id);
            if (latestTab && !latestTab.isModified && chunked.content !== latestTab.content) {
              editorStore.setInitialContent(tab.id, chunked.content);
              editorStore.updateTab(tab.id, { isLargeFile: true, isPreview: true });
            }
          } catch (e) { /* file may have been removed mid-read */ }
        }
      });
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
      if (unlistenFs) unlistenFs();
      if (watchStarted) invoke('stop_fs_watch', { root: explorerRoot }).catch(() => {});
      unsubTabs();
      unsubActive();
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  });

  // Auto-save is handled inside editorStore.scheduleAutoSave (triggered by
  // updateContent), which honors the auto_save setting and auto_save_delay_ms.
  // Keeping it in one place avoids double-saving and makes the unsaved dot
  // clear at the configured delay.

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
  function handleGlobalMouseUp(e: MouseEvent) {
    if (e.button === 3) { // Mouse Back
      e.preventDefault();
      import('./lib/stores/navigation').then(m => m.navigationStore.navigateBack());
    } else if (e.button === 4) { // Mouse Forward
      e.preventDefault();
      import('./lib/stores/navigation').then(m => m.navigationStore.navigateForward());
    }
  }

  $effect(() => {
    window.addEventListener('keydown', handleGlobalKeydown);
    window.addEventListener('mouseup', handleGlobalMouseUp);
    const preventCM = (e: MouseEvent) => e.preventDefault();
    window.addEventListener('contextmenu', preventCM);
    const openCmd = () => openCommandPalette('>');
    window.addEventListener('open-command-palette', openCmd);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeydown);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
      window.removeEventListener('contextmenu', preventCM);
      window.removeEventListener('open-command-palette', openCmd);
    };
  });
</script>

<div class="h-screen w-screen flex flex-col overflow-hidden bg-canvas text-primary"
  class:dark={isDark}
>


  <div class="h-9 flex items-center justify-between px-2 select-none bg-surface-2 text-primary border-b border-subtle" data-tauri-drag-region>
    <div class="flex items-center h-full" data-tauri-drag-region="false">
      <img src="/notron.png" alt="Notron Logo" class="w-4 h-4 ml-1 pointer-events-none" />
      <TitleMenuBar />
    </div>
    
    <div class="flex-1 h-full pointer-events-none"></div>

    <div class="h-full flex items-center justify-center" data-tauri-drag-region="false">
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
          class="flex items-center justify-center w-72 h-6 px-3 mx-2 rounded-md border border-subtle bg-surface hover:bg-hover transition-colors text-xs text-secondary hover:text-primary cursor-pointer shadow-sm"
          onclick={() => openCommandPalette('')}
          title="Search files (Ctrl+P)"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2 opacity-70"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <span class="truncate">{$ui.explorerRoot ? $ui.explorerRoot.split(/[/\\]/).pop() : 'Notron'}</span>
        </button>
      </div>
    </div>
    
    <div class="flex-1 h-full pointer-events-none"></div>

    <div class="flex items-center justify-end h-full" data-tauri-drag-region="false">
      <button
        aria-label="Minimize"
        onclick={() => getCurrentWindow().minimize()}
        class="w-[46px] h-full flex items-center justify-center text-icon-default hover:bg-hover hover:text-icon-active transition-colors"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>
      <button
        aria-label={isMaximized ? 'Restore' : 'Maximize'}
        onclick={() => getCurrentWindow().toggleMaximize()}
        class="w-[46px] h-full flex items-center justify-center text-icon-default hover:bg-hover hover:text-icon-active transition-colors"
      >
        {#if isMaximized}
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
        {:else}
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/></svg>
        {/if}
      </button>
      <button
        aria-label="Close"
        onclick={() => getCurrentWindow().close()}
        class="w-[46px] h-full flex items-center justify-center text-icon-default hover:bg-[var(--color-error)] hover:text-[var(--text-inverse)] transition-colors"
      >
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
          <div class="shrink-0 border-t border-subtle bg-surface-2" style="height: {$terminalStore.isMaximized ? 'calc(100vh - 2.25rem)' : `${$terminalStore.height}px`};"></div>
        {/if}
      </div>
    </div>
  {:else}
  <div class="flex flex-1 overflow-hidden">
    <div class="w-12 flex flex-col items-center py-0 justify-between z-10 border-r border-subtle bg-surface-2">
      <div class="flex flex-col items-center gap-1 w-full mt-2">
        <Tooltip content="Explorer (Ctrl+Shift+E)" side="right" hoverDelay={300}>
          <button aria-label="Explorer" onclick={() => { if ($ui.isSidebarOpen && $ui.activeSidebarPanel === 'explorer') uiStore.setSidebarOpen(false); else { uiStore.setActiveSidebarPanel('explorer'); uiStore.setSidebarOpen(true); } }} class="p-2 mb-2 bg-transparent cursor-pointer relative transition-colors hover:text-icon-active"
            class:text-icon-active-tab={$ui.activeSidebarPanel === 'explorer' && $ui.isSidebarOpen}
            class:text-icon-default={!($ui.activeSidebarPanel === 'explorer' && $ui.isSidebarOpen)}
          >
            {#if $ui.activeSidebarPanel === 'explorer' && $ui.isSidebarOpen}
              <div class="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-8 bg-indicator-active"></div>
            {/if}
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
          </button>
        </Tooltip>
        <Tooltip content="Search (Ctrl+Shift+F)" side="right" hoverDelay={300}>
          <button aria-label="Search" onclick={() => { if ($ui.isSidebarOpen && $ui.activeSidebarPanel === 'search') uiStore.setSidebarOpen(false); else { uiStore.setActiveSidebarPanel('search'); uiStore.setSidebarOpen(true); } }} class="p-2 mb-2 bg-transparent cursor-pointer relative transition-colors hover:text-icon-active"
            class:text-icon-active-tab={$ui.activeSidebarPanel === 'search' && $ui.isSidebarOpen}
            class:text-icon-default={!($ui.activeSidebarPanel === 'search' && $ui.isSidebarOpen)}
          >
            {#if $ui.activeSidebarPanel === 'search' && $ui.isSidebarOpen}
              <div class="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-8 bg-indicator-active"></div>
            {/if}
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </button>
        </Tooltip>
        <Tooltip content="Source Control (Ctrl+Shift+G)" side="right" hoverDelay={300}>
          <button aria-label="Source Control" onclick={() => { if ($ui.isSidebarOpen && $ui.activeSidebarPanel === 'git') uiStore.setSidebarOpen(false); else { uiStore.setActiveSidebarPanel('git'); uiStore.setSidebarOpen(true); } }} class="p-2 mb-2 bg-transparent cursor-pointer relative transition-colors hover:text-icon-active"
            class:text-icon-active-tab={$ui.activeSidebarPanel === 'git' && $ui.isSidebarOpen}
            class:text-icon-default={!($ui.activeSidebarPanel === 'git' && $ui.isSidebarOpen)}
          >
            {#if $ui.activeSidebarPanel === 'git' && $ui.isSidebarOpen}
              <div class="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-8 bg-indicator-active"></div>
            {/if}
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M6 9v6"/><path d="M18 9v2a2 2 0 0 1-2 2h-4a2 2 0 0 0-2 2v6"/></svg>
            
            {#if gitLoading}
              <div class="absolute bottom-0 -right-1 bg-accent text-on-accent rounded-full h-4 min-w-4 flex items-center justify-center border-2 border-surface-2 shadow-sm pointer-events-none" title="Git is analyzing...">
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="animate-spin"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>
              </div>
            {:else if gitChangesCount > 0}
              <div class="absolute bottom-0 -right-1 bg-accent text-on-accent text-[9px] font-bold rounded-full h-4 min-w-4 px-1 flex items-center justify-center border-2 border-surface-2 shadow-sm pointer-events-none">
                {gitChangesCount > 99 ? '99+' : gitChangesCount}
              </div>
            {/if}
          </button>
        </Tooltip>
        <Tooltip content="Run (Ctrl+Shift+D)" side="right" hoverDelay={300}>
          <button aria-label="Run" onclick={() => { if ($ui.isSidebarOpen && $ui.activeSidebarPanel === 'run') uiStore.setSidebarOpen(false); else { uiStore.setActiveSidebarPanel('run'); uiStore.setSidebarOpen(true); } }} class="p-2 mb-2 bg-transparent cursor-pointer relative transition-colors hover:text-icon-active"
            class:text-icon-active-tab={$ui.activeSidebarPanel === 'run' && $ui.isSidebarOpen}
            class:text-icon-default={!($ui.activeSidebarPanel === 'run' && $ui.isSidebarOpen)}
          >
            {#if $ui.activeSidebarPanel === 'run' && $ui.isSidebarOpen}
              <div class="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-8 bg-indicator-active"></div>
            {/if}
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 18 12 6 21 6 3"/></svg>
          </button>
        </Tooltip>
      </div>
      <Tooltip content="Settings (Ctrl+,)" side="right" hoverDelay={300}>
        <button aria-label="Settings" onclick={openSettings} class="p-2 bg-transparent cursor-pointer mb-2 text-icon-default hover:text-icon-active transition-colors">
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        </button>
      </Tooltip>
    </div>

    {#if $ui.isSidebarOpen}
      <div style="width: {$ui.sidebarWidth}px" class="flex flex-col border-r z-50 relative shrink-0 border-subtle bg-surface">
        <div
          role="presentation"
          class="absolute right-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-[var(--accent)] active:bg-[var(--accent-active)] z-50 transition-colors delay-100"
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
          <span>{$ui.activeSidebarPanel === 'explorer' ? 'Explorer' : $ui.activeSidebarPanel === 'search' ? 'Search' : $ui.activeSidebarPanel === 'git' ? 'Source Control' : 'Run'}</span>
          {#if $ui.activeSidebarPanel === 'explorer'}
            <Tooltip content="Toggle VCS/System Hidden Files (.git, .svn, …)">
              <button aria-label="Toggle Hidden VCS Files" onclick={() => uiStore.toggleShowDotFiles()} class="p-1 rounded transition-colors hover:bg-hover" class:text-accent={$ui.showDotFiles} class:text-icon-default={!$ui.showDotFiles} class:hover:text-icon-active={true}>
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
          {:else if $ui.activeSidebarPanel === 'search' && SearchPanelComponent}
            <div class="flex flex-col h-full overflow-hidden">
              <SearchPanelComponent />
            </div>
          {:else if $ui.activeSidebarPanel === 'git' && SourceControlPanelComponent}
            <div class="flex flex-col h-full overflow-hidden">
              <SourceControlPanelComponent />
            </div>
          {:else if $ui.activeSidebarPanel === 'run' && RunPanelComponent}
            <div class="flex flex-col h-full overflow-hidden">
              <RunPanelComponent />
            </div>
          {/if}
        </div>
      </div>
    {/if}

    <div class="flex flex-1 flex-col overflow-hidden bg-canvas">
      {#if $tabs.length > 0}
        <div class="flex h-9 shrink-0 bg-surface-2 border-b border-subtle relative z-20">
          <div role="region" aria-label="Tabs" class="flex-1 flex overflow-x-auto scrollbar-hide" oncontextmenu={handleEmptyTabAreaContextMenu}>
            {#each $tabs as tab (tab.id)}
              <div
                role="tab"
                tabindex="0"
                class="flex shrink-0 items-center gap-2 px-3 min-w-32 max-w-48 cursor-pointer border-t border-l border-r border-subtle -ml-px first:ml-0"
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
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1536 1024" fill="currentColor" class="w-3.5 h-auto opacity-80 pointer-events-none text-primary shrink-0" aria-hidden="true">
                    <path fill-rule="evenodd" d="M 472 343 L 473 347 L 473 355 L 472 356 L 473 357 L 472 358 L 472 372 L 473 373 L 472 374 L 472 385 L 473 386 L 472 387 L 473 388 L 472 389 L 473 394 L 472 395 L 473 396 L 472 397 L 473 398 L 472 399 L 473 401 L 472 403 L 473 404 L 473 423 L 472 424 L 473 426 L 473 431 L 472 432 L 473 433 L 473 439 L 472 440 L 473 441 L 473 454 L 472 455 L 473 456 L 473 463 L 472 464 L 473 466 L 473 754 L 476 762 L 484 770 L 494 774 L 503 774 L 523 767 L 597 735 L 613 726 L 620 716 L 622 710 L 622 482 L 506 381 L 492 370 L 479 356 L 473 343 Z "/>
                    <path fill-rule="evenodd" d="M 480 260 L 475 267 L 473 273 L 473 333 L 475 340 L 481 351 L 495 365 L 508 375 L 517 384 L 522 387 L 538 402 L 678 522 L 696 536 L 729 565 L 963 761 L 972 765 L 986 765 L 998 760 L 1046 735 L 1052 731 L 1059 724 L 1063 715 L 1063 645 L 1058 629 L 1052 620 L 1041 609 L 1006 581 L 861 458 L 721 336 L 592 221 L 582 215 L 577 214 L 568 214 L 562 216 L 498 249 Z "/>
                    <path fill-rule="evenodd" d="M 1029 196 L 999 208 L 994 209 L 961 223 L 956 224 L 943 230 L 938 231 L 928 236 L 918 239 L 911 243 L 905 249 L 902 254 L 900 261 L 900 484 L 1041 601 L 1056 617 L 1061 627 L 1063 635 L 1063 217 L 1058 207 L 1051 200 L 1042 196 Z "/>
                  </svg>
                {:else if tab.language === 'image'}
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-icon-default"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
                {:else if tab.language === 'settings'}
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-icon-default"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
                {:else if tab.language === 'markdown-preview'}
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-icon-default"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>
                {:else}
                  {@const iconTheme = settingsStore.effectiveSettings.icon_theme}
                  {#if iconTheme === 'default' || !iconTheme}
                    {@const Icon = getFileIcon(tab.name)}
                    <Icon size={14} class="shrink-0 text-icon-default" />
                  {:else if iconTheme === 'material'}
                    <MaterialIcon name={tab.name} size={14} />
                  {/if}
                {/if}
                <span class="text-xs truncate flex-1" class:italic={tab.isPreview}>
                  {(() => {
                    if ((tabNameCounts.get(tab.name) ?? 0) > 1 && !tab.path.startsWith('Untitled')) {
                      const parts = tab.path.split(/[/\\]/);
                      if (parts.length >= 2) {
                        return `${tab.name} \u00A0...${parts[parts.length - 2]}`;
                      }
                    }
                    return tab.name;
                  })()}
                </span>
                {#if tab.language !== 'welcome'}
                  {#if tab.isModified}
                    <div class="w-2 h-2 rounded-full bg-accent shrink-0"></div>
                  {:else if tab.status === 'conflict'}
                    <div class="w-2 h-2 rounded-full bg-status-warning shrink-0" title="External changes detected"></div>
                  {:else if tab.status === 'deleted'}
                    <div class="w-2 h-2 rounded-full bg-status-error shrink-0" title="File deleted"></div>
                  {/if}
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
          <!-- Breadcrumbs handled by @fazelstudio/codemirror-breadcrumbs in Editor -->
        {/if}
      {/if}

      <div class="flex-1 relative overflow-hidden" class:hidden={$terminalStore.isMaximized}>
        {#if $tabs.length === 0}
<div class="absolute inset-0 flex flex-col items-center justify-center gap-6 text-muted">
             <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1536 1024" fill="currentColor" class="w-[min(50vw,400px)] h-auto pointer-events-none text-primary/60" role="img" aria-label="Notron">
               <path fill-rule="evenodd" d="M 472 343 L 473 347 L 473 355 L 472 356 L 473 357 L 472 358 L 472 372 L 473 373 L 472 374 L 472 385 L 473 386 L 472 387 L 473 388 L 472 389 L 473 394 L 472 395 L 473 396 L 472 397 L 473 398 L 472 399 L 473 401 L 472 403 L 473 404 L 473 423 L 472 424 L 473 426 L 473 431 L 472 432 L 473 433 L 473 439 L 472 440 L 473 441 L 473 454 L 472 455 L 473 456 L 473 463 L 472 464 L 473 466 L 473 754 L 476 762 L 484 770 L 494 774 L 503 774 L 523 767 L 597 735 L 613 726 L 620 716 L 622 710 L 622 482 L 506 381 L 492 370 L 479 356 L 473 343 Z "/>
               <path fill-rule="evenodd" d="M 480 260 L 475 267 L 473 273 L 473 333 L 475 340 L 481 351 L 495 365 L 508 375 L 517 384 L 522 387 L 538 402 L 678 522 L 696 536 L 729 565 L 963 761 L 972 765 L 986 765 L 998 760 L 1046 735 L 1052 731 L 1059 724 L 1063 715 L 1063 645 L 1058 629 L 1052 620 L 1041 609 L 1006 581 L 861 458 L 721 336 L 592 221 L 582 215 L 577 214 L 568 214 L 562 216 L 498 249 Z "/>
               <path fill-rule="evenodd" d="M 1029 196 L 999 208 L 994 209 L 961 223 L 956 224 L 943 230 L 938 231 L 928 236 L 918 239 L 911 243 L 905 249 L 902 254 L 900 261 L 900 484 L 1041 601 L 1056 617 L 1061 627 L 1063 635 L 1063 217 L 1058 207 L 1051 200 L 1042 196 Z "/>
             </svg>
             <div class="flex flex-col gap-2">
               <div class="flex items-center gap-4"><span class="w-24 text-right">New File</span><kbd class="px-2 py-0.5 rounded text-xs bg-surface-2 border border-subtle">Ctrl+N</kbd></div>
               <div class="flex items-center gap-4"><span class="w-24 text-right">Open File</span><kbd class="px-2 py-0.5 rounded text-xs bg-surface-2 border border-subtle">Ctrl+O</kbd></div>
               <div class="flex items-center gap-4"><span class="w-24 text-right">Commands</span><kbd class="px-2 py-0.5 rounded text-xs bg-surface-2 border border-subtle">Ctrl+Shift+P</kbd></div>
             </div>
           </div>
        {:else if activeTab}
          {#if activeTab.language === 'markdown-preview' && MarkdownPreviewComponent}
            <MarkdownPreviewComponent key={activeTab.id} path={activeTab.path} />
          {:else if activeTab.path.toLowerCase().endsWith('.svg')}
            {@const viewMode = activeTab.svgViewMode || settingsStore.effectiveSettings.default_svg_view || 'image'}
            
            {#if EditorComponent && activeTab.content !== null}
              {#if viewMode === 'image'}
                <EditorComponent tabId={activeTab.id} content={activeTab.content} filePath={activeTab.path} hideContent={true}>
                  {#snippet topRightOverlay()}
                    <SvgViewToggle {activeTab} />
                  {/snippet}
                  {#if ImageViewerComponent}
                    <ImageViewerComponent key={activeTab.id} filePath={activeTab.path} />
                  {:else}
                    <div class="absolute inset-0 flex items-center justify-center">
                      <div class="flex items-center gap-3">
                        <svg class="animate-spin h-4 w-4 text-muted" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                        <span class="text-xs text-muted">Loading viewer...</span>
                      </div>
                    </div>
                  {/if}
                </EditorComponent>
              {:else if viewMode === 'split'}
                <div class="flex h-full w-full">
                  <div class="flex-1 border-r border-subtle overflow-hidden relative">
                    {#if ImageViewerComponent}
                      <ImageViewerComponent key={activeTab.id} filePath={activeTab.path} />
                    {:else}
                      <div class="absolute inset-0 flex items-center justify-center">
                        <svg class="animate-spin h-4 w-4 text-muted" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                      </div>
                    {/if}
                  </div>
                  <div class="flex-1 overflow-hidden relative">
                    <EditorComponent tabId={activeTab.id} content={activeTab.content} filePath={activeTab.path}>
                      {#snippet topRightOverlay()}
                        <SvgViewToggle {activeTab} />
                      {/snippet}
                    </EditorComponent>
                  </div>
                </div>
              {:else}
                <EditorComponent tabId={activeTab.id} content={activeTab.content} filePath={activeTab.path}>
                  {#snippet topRightOverlay()}
                    <SvgViewToggle {activeTab} />
                  {/snippet}
                </EditorComponent>
              {/if}
            {:else}
               <div class="absolute inset-0 flex items-center justify-center">
                 <div class="flex items-center gap-3">
                   <svg class="animate-spin h-4 w-4 text-muted" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                   <span class="text-xs text-muted">Loading editor...</span>
                 </div>
               </div>
            {/if}
          {:else if activeTab.language === 'image' && ImageViewerComponent}
            <ImageViewerComponent key={activeTab.id} filePath={activeTab.path} />
          {:else if activeTab.language === 'welcome'}
            <WelcomeTab />
          {:else if activeTab.language === 'settings' && SettingsPageComponent}
            <SettingsPageComponent />
          {:else if activeTab.isLoading}
            <!-- Content not ready yet: keep the editor area empty instead of
                 showing a spinner / partial editor, then everything (content +
                 minimap) appears together once loaded. -->
            <div class="absolute inset-0 bg-canvas"></div>
          {:else if activeTab.isUnsupported}
            <div class="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted bg-canvas select-none">
              <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" class="opacity-50"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
              <span class="text-sm">The file is not displayed in the editor because it is either binary or uses an unsupported text encoding.</span>
            </div>
          {:else if activeTab.content === null && !activeTab.isDiff}
            <!-- Suspended (content not in memory): keep it blank — the tab will
                 reload on next activation. -->
            <div class="absolute inset-0 bg-canvas"></div>
          {:else if activeTab.isDiff && DiffEditorComponent}
            <DiffEditorComponent originalContent={activeTab.diffOriginalContent} currentContent={activeTab.content} filePath={activeTab.path} />
          {:else if !activeTab.isDiff && EditorComponent}
            <EditorComponent tabId={activeTab.id} content={activeTab.content} filePath={activeTab.path} />
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
      {#if $saveStatus}
        <span class="text-muted animate-in fade-in duration-200">{$saveStatus}</span>
      {:else}
        <span class="animate-in fade-in duration-200">Ready</span>
      {/if}
      {#if activeTab}<span>{activeTab.language}</span>{/if}
      {#if $ui.globalStatus}
        <span class="animate-in fade-in duration-200" title={$ui.globalStatus}>
          {$ui.globalStatus.length > 40 ? $ui.globalStatus.slice(0, 40) + '...' : $ui.globalStatus}
        </span>
      {/if}
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
  onCancel={handleCloseDialogCancel}
  onDontSave={handleCloseDialogDontSave}
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