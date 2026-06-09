import { create } from 'zustand';

interface UiState {
  isSidebarOpen: boolean;
  sidebarWidth: number;
  activeSidebarPanel: 'explorer' | 'search' | 'git' | 'extensions';
  explorerRoot: string | null;
  selectedExplorerPath: string | null;
  toggleSidebar: () => void;
  setSidebarOpen: (isOpen: boolean) => void;
  setActiveSidebarPanel: (panel: 'explorer' | 'search' | 'git' | 'extensions') => void;
  setSidebarWidth: (width: number) => void;
  recentWorkspaces: string[];
  setExplorerRoot: (path: string | null) => void;
  setSelectedExplorerPath: (path: string | null) => void;
  creatingItem: { type: 'file' | 'folder', parentPath: string } | null;
  setCreatingItem: (item: { type: 'file' | 'folder', parentPath: string } | null) => void;
  clipboard: { path: string, type: 'copy' | 'cut' } | null;
  setClipboard: (item: { path: string, type: 'copy' | 'cut' } | null) => void;
  renamingItem: string | null;
  setRenamingItem: (path: string | null) => void;
  isNewFileDialogOpen: boolean;
  newFileDialogSource: 'welcome' | 'menu' | null;
  openNewFileDialog: (source: 'welcome' | 'menu') => void;
  closeNewFileDialog: () => void;
  explorerRefreshCounter: number;
  triggerExplorerRefresh: () => void;
  explorerCollapseCounter: number;
  triggerExplorerCollapse: () => void;
  expandedPaths: string[];
  toggleExpandedPath: (path: string, isExpanded: boolean) => void;
  setExpandedPaths: (paths: string[]) => void;
  isMinimapEnabled: boolean;
  toggleMinimap: () => void;
  setMinimapEnabled: (enabled: boolean) => void;
}

const savedWorkspace = localStorage.getItem('last_workspace');

export const useUiStore = create<UiState>((set) => ({
  isSidebarOpen: true,
  sidebarWidth: 240,
  activeSidebarPanel: 'explorer',
  explorerRoot: savedWorkspace || null,
  selectedExplorerPath: null,
  creatingItem: null,
  clipboard: null,
  renamingItem: null,
  isNewFileDialogOpen: false,
  newFileDialogSource: null,
  openNewFileDialog: (source) => set({ isNewFileDialogOpen: true, newFileDialogSource: source }),
  closeNewFileDialog: () => set({ isNewFileDialogOpen: false, newFileDialogSource: null }),
  explorerRefreshCounter: 0,
  explorerCollapseCounter: 0,
  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
  setSidebarOpen: (isOpen) => set({ isSidebarOpen: isOpen }),
  setActiveSidebarPanel: (panel) => set({ activeSidebarPanel: panel }),
  setClipboard: (item) => set({ clipboard: item }),
  setRenamingItem: (path) => set({ renamingItem: path }),
  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  recentWorkspaces: JSON.parse(localStorage.getItem('recent_workspaces') || '[]'),
  setExplorerRoot: (path) => set((state) => {
    if (path) {
      localStorage.setItem('last_workspace', path);
      // Update recent workspaces
      const currentRecent = (state as any).recentWorkspaces || JSON.parse(localStorage.getItem('recent_workspaces') || '[]');
      const newRecent = [path, ...currentRecent.filter((p: string) => p !== path)];
      localStorage.setItem('recent_workspaces', JSON.stringify(newRecent));
      return { explorerRoot: path, recentWorkspaces: newRecent };
    } else {
      localStorage.removeItem('last_workspace');
      return { explorerRoot: path };
    }
  }),
  setSelectedExplorerPath: (path) => set({ selectedExplorerPath: path }),
  setCreatingItem: (item) => set({ creatingItem: item }),
  triggerExplorerRefresh: () => set((state) => ({ explorerRefreshCounter: state.explorerRefreshCounter + 1 })),
  triggerExplorerCollapse: () => set((state) => ({ explorerCollapseCounter: state.explorerCollapseCounter + 1, expandedPaths: [] })),
  expandedPaths: [],
  toggleExpandedPath: (path, isExpanded) => set((state) => {
    if (isExpanded) {
      if (!state.expandedPaths.includes(path)) {
        return { expandedPaths: [...state.expandedPaths, path] };
      }
    } else {
      return { expandedPaths: state.expandedPaths.filter(p => p !== path) };
    }
    return state;
  }),
  setExpandedPaths: (paths) => set({ expandedPaths: paths }),
  isMinimapEnabled: true,
  toggleMinimap: () => set((state) => ({ isMinimapEnabled: !state.isMinimapEnabled })),
  setMinimapEnabled: (enabled) => set({ isMinimapEnabled: enabled }),
}));
