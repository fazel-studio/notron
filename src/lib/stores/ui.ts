import { writable } from 'svelte/store';

interface UiState {
  isSidebarOpen: boolean;
  sidebarWidth: number;
  activeSidebarPanel: 'explorer' | 'search' | 'git' | 'extensions' | 'run';
  explorerRoot: string | null;
  selectedExplorerPath: string | null;
  creatingItem: { type: 'file' | 'folder'; parentPath: string } | null;
  clipboard: { path: string; type: 'copy' | 'cut' } | null;
  renamingItem: string | null;
  isNewFileDialogOpen: boolean;
  newFileDialogSource: 'welcome' | 'menu' | null;
  explorerRefreshCounter: number;
  explorerCollapseCounter: number;
  isMinimapEnabled: boolean;
  recentWorkspaces: string[];
  showDotFiles: boolean;
  globalStatus: string | null;
  pendingTrustPath: string | null;
  isRecentFoldersModalOpen: boolean;
  searchQuery: string;
  replaceQuery: string;
  isFileSearchOpen: boolean;
  fileSearchQuery: string;
  fileReplaceQuery: string;
  searchRefreshCounter: number;
  searchCollapseCounter: number;
  searchResultCount: number;
  toasts: { id: string; type: 'success' | 'alert' | 'process'; title: string; message?: string }[];
  isCloneRepositoryModalOpen: boolean;
  cloneStatus: { name: string; opId: string } | null;
}

// PERF FIX: expandedPaths is now a SEPARATE writable<Set>.
// Previously it was string[] inside UiState, meaning:
//   1. Every toggleExpandedPath rebuilt the entire UiState object
//   2. Array.includes() = O(n) per node render
// Now: Set.has() = O(1), and changes only notify Set subscribers.
const expandedPathsStore = writable<Set<string>>(new Set());
const selectedPathsStore = writable<Set<string>>(new Set());

function createUiStore() {
  const state = writable<UiState>({
    isSidebarOpen: typeof window !== 'undefined' ? localStorage.getItem('isSidebarOpen') !== 'false' : true,
    sidebarWidth: typeof window !== 'undefined' ? parseInt(localStorage.getItem('sidebarWidth') || '240', 10) : 240,
    activeSidebarPanel: 'explorer',
    explorerRoot: typeof window !== 'undefined' 
      ? (window.location.search.includes('clean=true') ? null : (localStorage.getItem('last_workspace') || null)) 
      : null,
    selectedExplorerPath: null,
    creatingItem: null,
    clipboard: null,
    renamingItem: null,
    isNewFileDialogOpen: false,
    newFileDialogSource: null,
    explorerRefreshCounter: 0,
    explorerCollapseCounter: 0,
    isMinimapEnabled: true,
    recentWorkspaces: typeof window !== 'undefined' ? JSON.parse(localStorage.getItem('recent_workspaces') || '[]') : [],
    showDotFiles: typeof window !== 'undefined' ? localStorage.getItem('showDotFiles') === 'true' : false,
    globalStatus: null,
    pendingTrustPath: null,
    isRecentFoldersModalOpen: false,
    searchQuery: '',
    replaceQuery: '',
    isFileSearchOpen: false,
    fileSearchQuery: '',
    fileReplaceQuery: '',
    searchRefreshCounter: 0,
    searchCollapseCounter: 0,
    searchResultCount: 0,
    toasts: [],
    isCloneRepositoryModalOpen: false,
    cloneStatus: null,
  });

  let globalStatusTimeout: ReturnType<typeof setTimeout> | null = null;
  let operationCounter = 0;

  function update(fn: (s: UiState) => Partial<UiState>) {
    state.update(s => ({ ...s, ...fn(s) }));
  }

  function setStatus(msg: string | null, timeoutMs: number = 3000) {
    if (globalStatusTimeout) clearTimeout(globalStatusTimeout);
    state.update(s => ({ ...s, globalStatus: msg }));
    
    if (msg && timeoutMs > 0) {
      globalStatusTimeout = setTimeout(() => {
        state.update(s => ({ ...s, globalStatus: null }));
      }, timeoutMs);
    }
  }

  function addToast(title: string, type: 'success' | 'alert' | 'process' = 'success', message?: string): string {
    const id = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    state.update(s => {
      const newToasts = [...s.toasts, { id, type, title, message }];
      if (newToasts.length > 5) {
        newToasts.shift(); // Remove the oldest toast
      }
      return { ...s, toasts: newToasts };
    });
    
    if (type === 'success') {
      setTimeout(() => {
        removeToast(id);
      }, 5000);
    }
    return id;
  }

  /** Show the single persistent process toast. Any existing process toast is replaced. */
  function addProcessToast(title: string, message?: string): string {
    let id = '';
    state.update(s => {
      const cleaned = s.toasts.filter(t => t.type !== 'process');
      id = Date.now().toString() + Math.random().toString(36).substr(2, 9);
      const newToasts = [...cleaned, { id, type: 'process' as const, title, message }];
      if (newToasts.length > 5) {
        newToasts.shift();
      }
      return { ...s, toasts: newToasts };
    });
    return id;
  }

  function removeProcessToast() {
    state.update(s => ({ ...s, toasts: s.toasts.filter(t => t.type !== 'process') }));
  }

  function removeToast(id: string) {
    state.update(s => ({ ...s, toasts: s.toasts.filter(t => t.id !== id) }));
  }

  async function withStatus<T>(msg: string, promiseOrFn: Promise<T> | (() => Promise<T>), delayMs: number = 500): Promise<T> {
    const opId = ++operationCounter;
    
    // Set a timer to show the message ONLY if the operation takes longer than delayMs
    const timer = setTimeout(() => {
      if (operationCounter === opId) {
        state.update(s => ({ ...s, globalStatus: msg }));
      }
    }, delayMs);

    try {
      const isFunc = typeof promiseOrFn === 'function';
      return await (isFunc ? (promiseOrFn as Function)() : promiseOrFn);
    } finally {
      clearTimeout(timer);
      if (operationCounter === opId) {
        state.update(s => ({ ...s, globalStatus: null }));
      }
    }
  }

  return {
    subscribe: state.subscribe,
    // Expose expandedPaths as separate store for fine-grained reactivity
    expandedPaths: { subscribe: expandedPathsStore.subscribe },

    initFromStorage: () => {
      // New windows opened via "New Window" (clean=true) must always start
      // with no active workspace, regardless of what is stored in localStorage.
      const isCleanWindow = typeof window !== 'undefined' && window.location.search.includes('clean=true');
      const savedWorkspace = isCleanWindow ? null : localStorage.getItem('last_workspace');
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
    openRecentFoldersModal: () => update(() => ({ isRecentFoldersModalOpen: true })),
    closeRecentFoldersModal: () => update(() => ({ isRecentFoldersModalOpen: false })),
    openCloneRepositoryModal: () => update(() => ({ isCloneRepositoryModalOpen: true })),
    closeCloneRepositoryModal: () => update(() => ({ isCloneRepositoryModalOpen: false })),
    setCloneStatus: (status: { name: string; opId: string }) => update(() => ({ cloneStatus: status })),
    clearCloneStatus: () => update(() => ({ cloneStatus: null })),
    triggerExplorerRefresh: () => update(s => ({ explorerRefreshCounter: s.explorerRefreshCounter + 1 })),
    triggerExplorerCollapse: () => {
      expandedPathsStore.set(new Set());
      update(() => ({ explorerCollapseCounter: 0 }));
    },
    setSearchQuery: (q: string) => update(() => ({ searchQuery: q })),
    setReplaceQuery: (q: string) => update(() => ({ replaceQuery: q })),
    setFileSearchOpen: (isOpen: boolean) => update(() => ({ isFileSearchOpen: isOpen })),
    setFileSearchQuery: (q: string) => update(() => ({ fileSearchQuery: q })),
    setFileReplaceQuery: (q: string) => update(() => ({ fileReplaceQuery: q })),
    triggerSearchRefresh: () => update(s => ({ searchRefreshCounter: s.searchRefreshCounter + 1 })),
    triggerSearchCollapseAll: () => update(s => ({ searchCollapseCounter: s.searchCollapseCounter + 1 })),
    setSearchResultCount: (count: number) => update(() => ({ searchResultCount: count })),
    setGlobalStatus: (status: string | null) => update(() => ({ globalStatus: status })),
    addToast,
    removeToast,
    addProcessToast,
    removeProcessToast,
    toggleMinimap: () => update(s => ({ isMinimapEnabled: !s.isMinimapEnabled })),
    setMinimapEnabled: (enabled: boolean) => update(() => ({ isMinimapEnabled: enabled })),
    saveTierUiState: () => {
      // Delegates to the Tauri command; called by App.svelte effects
    },

    // ── expandedPaths operations (now using Set) ──
    setExpandedPaths: (paths: string[]) => {
      expandedPathsStore.set(new Set(paths));
    },
    setExpandedPathsSet: (pathSet: Set<string>) => {
      expandedPathsStore.set(pathSet);
    },
    toggleExpandedPath: (path: string, isExpanded: boolean) => {
      expandedPathsStore.update(s => {
        const next = new Set(s);
        if (isExpanded) {
          next.add(path);
        } else {
          next.delete(path);
        }
        return next;
      });
    },
    getExpandedPathsSnapshot: (): string[] => {
      let val: Set<string> = new Set();
      expandedPathsStore.subscribe(v => val = v)();
      return Array.from(val);
    },
    getExpandedPathsSetSnapshot: (): Set<string> => {
      let val: Set<string> = new Set();
      expandedPathsStore.subscribe(v => val = v)();
      return val;
    },

    // ── selectedPaths operations for multi-select ──
    selectedPaths: { subscribe: selectedPathsStore.subscribe },
    setSelectedPaths: (paths: string[]) => {
      selectedPathsStore.set(new Set(paths));
    },
    setSelectedPathsSet: (pathSet: Set<string>) => {
      selectedPathsStore.set(pathSet);
    },
    toggleSelectedPath: (path: string, isSelected: boolean) => {
      selectedPathsStore.update(s => {
        const next = new Set(s);
        if (isSelected) {
          next.add(path);
        } else {
          next.delete(path);
        }
        return next;
      });
    },
    getSelectedPathsSnapshot: (): string[] => {
      let val: Set<string> = new Set();
      selectedPathsStore.subscribe(v => val = v)();
      return Array.from(val);
    },
    getSelectedPathsSetSnapshot: (): Set<string> => {
      let val: Set<string> = new Set();
      selectedPathsStore.subscribe(v => val = v)();
      return val;
    },
    clearSelectedPaths: () => {
      selectedPathsStore.set(new Set());
    },

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
    clearRecentWorkspaces: () => update(s => {
      const currentWorkspace = s.explorerRoot;
      const newRecent = currentWorkspace ? [currentWorkspace] : [];
      localStorage.setItem('recent_workspaces', JSON.stringify(newRecent));
      return { recentWorkspaces: newRecent };
    }),
    removeRecentWorkspace: (path: string) => update(s => {
      const newRecent = s.recentWorkspaces.filter((p: string) => p !== path);
      localStorage.setItem('recent_workspaces', JSON.stringify(newRecent));
      return { recentWorkspaces: newRecent };
    }),
    setPendingTrustPath: (path: string | null) => update(() => ({ pendingTrustPath: path })),
    getSnapshot: (): UiState => {
      let val: UiState = null!;
      state.subscribe(v => val = v)();
      return val;
    },
    setStatus,
    withStatus,
  };
}

export const uiStore = createUiStore();
