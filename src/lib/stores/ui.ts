import { writable } from 'svelte/store';

interface UiState {
  isSidebarOpen: boolean;
  sidebarWidth: number;
  activeSidebarPanel: 'explorer' | 'search' | 'git' | 'extensions';
  explorerRoot: string | null;
  selectedExplorerPath: string | null;
  creatingItem: { type: 'file' | 'folder'; parentPath: string } | null;
  clipboard: { path: string; type: 'copy' | 'cut' } | null;
  renamingItem: string | null;
  isNewFileDialogOpen: boolean;
  newFileDialogSource: 'welcome' | 'menu' | null;
  explorerRefreshCounter: number;
  explorerCollapseCounter: number;
  expandedPaths: string[];
  isMinimapEnabled: boolean;
  recentWorkspaces: string[];
  showDotFiles: boolean;
}

function createUiStore() {
  const state = writable<UiState>({
    isSidebarOpen: true,
    sidebarWidth: 240,
    activeSidebarPanel: 'explorer',
    explorerRoot: null,
    selectedExplorerPath: null,
    creatingItem: null,
    clipboard: null,
    renamingItem: null,
    isNewFileDialogOpen: false,
    newFileDialogSource: null,
    explorerRefreshCounter: 0,
    explorerCollapseCounter: 0,
    expandedPaths: [],
    isMinimapEnabled: true,
    recentWorkspaces: [],
    showDotFiles: false,
  });

  function update(fn: (s: UiState) => Partial<UiState>) {
    state.update(s => ({ ...s, ...fn(s) }));
  }

  return {
    subscribe: state.subscribe,
    initFromStorage: () => {
      const savedWorkspace = localStorage.getItem('last_workspace');
      const savedRecent = JSON.parse(localStorage.getItem('recent_workspaces') || '[]');
      const savedSidebarWidth = parseInt(localStorage.getItem('sidebarWidth') || '240', 10);
      const savedSidebarOpen = localStorage.getItem('isSidebarOpen') !== 'false';
      const savedShowDotFiles = localStorage.getItem('showDotFiles') === 'true';

      update(() => ({
        explorerRoot: savedWorkspace || null,
        recentWorkspaces: savedRecent,
        sidebarWidth: savedSidebarWidth,
        isSidebarOpen: savedSidebarOpen,
        showDotFiles: savedShowDotFiles,
      }));
    },
    toggleSidebar: () => update(s => {
      const newVal = !s.isSidebarOpen;
      localStorage.setItem('isSidebarOpen', String(newVal));
      return { isSidebarOpen: newVal };
    }),
    setSidebarOpen: (isOpen: boolean) => update(() => {
      localStorage.setItem('isSidebarOpen', String(isOpen));
      return { isSidebarOpen: isOpen };
    }),
    setActiveSidebarPanel: (panel: UiState['activeSidebarPanel']) => update(() => ({ activeSidebarPanel: panel })),
    setSidebarWidth: (width: number) => update(() => {
      localStorage.setItem('sidebarWidth', String(width));
      return { sidebarWidth: width };
    }),
    setSelectedExplorerPath: (path: string | null) => update(() => ({ selectedExplorerPath: path })),
    setCreatingItem: (item: UiState['creatingItem']) => update(() => ({ creatingItem: item })),
    setRenamingItem: (path: string | null) => update(() => ({ renamingItem: path })),
    setClipboard: (item: UiState['clipboard']) => update(() => ({ clipboard: item })),
    openNewFileDialog: (source: 'welcome' | 'menu') => update(() => ({ isNewFileDialogOpen: true, newFileDialogSource: source })),
    closeNewFileDialog: () => update(() => ({ isNewFileDialogOpen: false, newFileDialogSource: null })),
    triggerExplorerRefresh: () => update(s => ({ explorerRefreshCounter: s.explorerRefreshCounter + 1 })),
    triggerExplorerCollapse: () => update(() => ({ explorerCollapseCounter: 0, expandedPaths: [] })),
    toggleMinimap: () => update(s => ({ isMinimapEnabled: !s.isMinimapEnabled })),
    setMinimapEnabled: (enabled: boolean) => update(() => ({ isMinimapEnabled: enabled })),
    // Section 1.2: Tiered startup — save UI tier to new tables
    saveTierUiState: () => {
      // Delegates to the Tauri command; called by App.svelte effects
    },
    setExpandedPaths: (paths: string[]) => update(() => ({ expandedPaths: paths })),
    toggleExpandedPath: (path: string, isExpanded: boolean) => update(s => {
      if (isExpanded) {
        if (!s.expandedPaths.includes(path)) {
          return { expandedPaths: [...s.expandedPaths, path] };
        }
      } else {
        return { expandedPaths: s.expandedPaths.filter(p => p !== path) };
      }
      return {};
    }),
    toggleShowDotFiles: () => update(s => {
      const newVal = !s.showDotFiles;
      localStorage.setItem('showDotFiles', String(newVal));
      return { showDotFiles: newVal };
    }),
    setExplorerRoot: (path: string | null) => update(s => {
      if (path) {
        localStorage.setItem('last_workspace', path);
        const currentRecent = s.recentWorkspaces;
        const newRecent = [path, ...currentRecent.filter((p: string) => p !== path)];
        localStorage.setItem('recent_workspaces', JSON.stringify(newRecent));
        return { explorerRoot: path, recentWorkspaces: newRecent };
      } else {
        localStorage.removeItem('last_workspace');
        return { explorerRoot: path };
      }
    }),
    getSnapshot: (): UiState => {
      let val: UiState = null!;
      state.subscribe(v => val = v)();
      return val;
    },
  };
}

export const uiStore = createUiStore();
