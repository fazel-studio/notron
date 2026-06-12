import { writable, derived } from 'svelte/store';

export interface EditorTab {
  id: string;
  path: string;
  name: string;
  content: string | null;
  originalContent: string | null;
  isModified: boolean;
  language: string;
  isPreview?: boolean;
  isPinned?: boolean;
  cursor?: { line: number; column: number };
  scroll?: { top: number; left: number };
  lastAccessed: number;
  isLargeFile?: boolean;
  isLoading?: boolean;
  isUnsupported?: boolean;
  status?: 'active' | 'loaded' | 'suspended' | 'modified' | 'deleted' | 'conflict';
}

export type TabInput = {
  id: string;
  path: string;
  name: string;
  content: string | null;
  language: string;
  isPreview?: boolean;
  isLargeFile?: boolean;
  isLoading?: boolean;
  isUnsupported?: boolean;
};

// Section 4.4: Tab Suspension (LRU Eviction)
const SUSPEND_AFTER_MS = 300_000;   // 5 minutes without access → suspend
const MAX_ACTIVE_TABS  = 8;         // Max tabs with loaded content in memory
const DEBOUNCE_SAVE_MS = 1500;

function createEditorStore() {
  const tabs = writable<EditorTab[]>([]);
  const activeTabId = writable<string | null>(null);
  const saveStatus = writable<string | null>(null);
  let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

  const activeTab = derived([tabs, activeTabId], ([$tabs, $id]) =>
    $tabs.find(t => t.id === $id) || null
  );

  function addTab(input: TabInput) {
    tabs.update(state => {
      const exists = state.find(t => t.id === input.id || (t.path === input.path && t.language === input.language));
      if (exists) {
        activeTabId.set(exists.id);
        return state.map(t => {
          if (t.id === exists.id) {
            // Allow pinning an existing preview tab
            const isPreview = input.isPreview === false ? false : t.isPreview;
            return { ...t, lastAccessed: Date.now(), isPreview };
          }
          return t;
        });
      }

      const newTab: EditorTab = {
        ...input,
        originalContent: input.content,
        isModified: false,
        isPreview: input.isPreview ?? false,
        isUnsupported: input.isUnsupported ?? false,
        lastAccessed: Date.now(),
        status: input.content !== null ? 'active' : 'loaded',
      };

      let currentTabs = [...state];
      if (newTab.language !== 'welcome') {
        currentTabs = currentTabs.filter(t => t.language !== 'welcome');
      }

      if (newTab.isPreview) {
        const previewIndex = currentTabs.findIndex(t => t.isPreview && !t.isModified);
        if (previewIndex !== -1) {
          currentTabs[previewIndex] = newTab;
          activeTabId.set(newTab.id);
          return currentTabs;
        }
      }

      activeTabId.set(newTab.id);
      return [...currentTabs, newTab];
    });
  }

  function closeTab(id: string) {
    tabs.update(state => {
      const newTabs = state.filter(t => t.id !== id);
      activeTabId.update(current => {
        if (current === id) {
          return newTabs.length > 0 ? newTabs[newTabs.length - 1].id : null;
        }
        return current;
      });
      return newTabs;
    });
  }

  function setActiveTab(id: string) {
    activeTabId.set(id);
    tabs.update(state =>
      state.map(t => ({
        ...t,
        lastAccessed: t.id === id ? Date.now() : t.lastAccessed,
        status: t.id === id ? 'active' : t.status === 'active' ? 'loaded' : t.status,
      }))
    );
  }

  function setInitialContent(id: string, content: string) {
    tabs.update(state =>
      state.map(t => {
        if (t.id === id) {
          return {
            ...t,
            content,
            originalContent: content,
            isModified: false,
            status: 'active',
            lastAccessed: Date.now(),
          };
        }
        return t;
      })
    );
  }

  function updateContent(id: string, content: string) {
    tabs.update(state =>
      state.map(t => {
        if (t.id === id) {
          const isModified = content !== t.originalContent;
          return {
            ...t, content, isModified,
            status: isModified ? 'modified' : 'active',
            isPreview: isModified ? false : t.isPreview,
            lastAccessed: Date.now(),
          };
        }
        return t;
      })
    );
    scheduleAutoSave(id);
  }

  function updateCursor(id: string, line: number, column: number) {
    tabs.update(state =>
      state.map(t => {
        if (t.id === id) {
          return { ...t, cursor: { line, column } };
        }
        return t;
      })
    );
  }

  function updateScroll(id: string, top: number, left: number) {
    tabs.update(state =>
      state.map(t => {
        if (t.id === id) {
          return { ...t, scroll: { top, left } };
        }
        return t;
      })
    );
  }

  function markSaved(id: string) {
    tabs.update(state =>
      state.map(t => {
        if (t.id === id) {
          return {
            ...t, originalContent: t.content, isModified: false,
            status: t.content !== null ? 'active' : 'loaded',
          };
        }
        return t;
      })
    );
  }

  function markTabDeleted(id: string) {
    tabs.update(state =>
      state.map(t => {
        if (t.id === id) {
          return { ...t, status: 'deleted' as const };
        }
        return t;
      })
    );
  }

  function markTabConflict(id: string) {
    tabs.update(state =>
      state.map(t => {
        if (t.id === id) {
          return { ...t, status: 'conflict' as const };
        }
        return t;
      })
    );
  }

  function pinTab(id: string) {
    tabs.update(state =>
      state.map(t => {
        if (t.id === id) {
          return { ...t, isPreview: false };
        }
        return t;
      })
    );
  }

  function togglePin(id: string) {
    tabs.update(state =>
      state.map(t => {
        if (t.id === id) {
          return { ...t, isPinned: !t.isPinned };
        }
        return t;
      })
    );
  }

  function setTabs(newTabs: EditorTab[], newActiveId: string | null) {
    tabs.set(newTabs);
    activeTabId.set(newActiveId);
  }

  function suspendTab(id: string) {
    tabs.update(state =>
      state.map(t => {
        if (t.id === id && !t.isModified && t.content !== null) {
          return { ...t, content: null, originalContent: null, status: 'suspended' as const };
        }
        return t;
      })
    );
  }

  /**
   * Section 4.4: LRU Tab Suspension
   * If tab count with loaded content > MAX_ACTIVE_TABS,
   * suspend the Least Recently Used non-modified tabs.
   */
  function enforceMemoryLimit() {
    tabs.update(state => {
      const activeId = getActiveTabIdSnapshot();
      const now = Date.now();

      // Collect non-active, non-modified tabs that have content in memory
      const candidates = state
        .filter(t => t.id !== activeId && !t.isModified && t.content !== null)
        .sort((a, b) => a.lastAccessed - b.lastAccessed); // oldest first

      let inMemoryCount = state.filter(t => t.content !== null && !t.isModified && t.id !== activeId).length;

      for (const tab of candidates) {
        // Suspend if either: over memory limit OR idle too long
        const isIdleTooLong = now - tab.lastAccessed > SUSPEND_AFTER_MS;
        const isOverLimit   = inMemoryCount > MAX_ACTIVE_TABS;

        if (isIdleTooLong || isOverLimit) {
          state = state.map(t =>
            t.id === tab.id
              ? { ...t, content: null, originalContent: null, status: 'suspended' as const }
              : t
          );
          inMemoryCount--;
        }

        if (inMemoryCount <= MAX_ACTIVE_TABS) break;
      }

      return state;
    });
  }

  function scheduleAutoSave(tabId: string) {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
      const snapshot = getTabsSnapshot();
      const tab = snapshot.find(t => t.id === tabId);
      if (tab && tab.isModified && !tab.path.startsWith('Untitled') && tab.content !== null) {
        saveStatus.set('Saving...');
      }
    }, DEBOUNCE_SAVE_MS);
  }

  function clearSaveStatus() {
    saveStatus.set(null);
  }

  function setTabLoading(id: string, loading: boolean) {
    tabs.update(state =>
      state.map(t => t.id === id ? { ...t, isLoading: loading } : t)
    );
  }

  function setTabUnsupported(id: string, unsupported: boolean) {
    tabs.update(state =>
      state.map(t => t.id === id ? { ...t, isUnsupported: unsupported } : t)
    );
  }

  function getTabsSnapshot(): EditorTab[] {
    let val: EditorTab[] = [];
    tabs.subscribe(v => val = v)();
    return val;
  }

  function getActiveTabIdSnapshot(): string | null {
    let val: string | null = null;
    activeTabId.subscribe(v => val = v)();
    return val;
  }

  return {
    tabs: { subscribe: tabs.subscribe },
    activeTabId: { subscribe: activeTabId.subscribe },
    activeTab,
    saveStatus: { subscribe: saveStatus.subscribe },
    addTab,
    closeTab,
    setActiveTab,
    setInitialContent,
    updateContent,
    updateCursor,
    updateScroll,
    markSaved,
    markTabDeleted,
    markTabConflict,
    setTabLoading,
    setTabUnsupported,
    clearSaveStatus,
    pinTab,
    togglePin,
    setTabs,
    suspendTab,
    enforceMemoryLimit,
    getTabsSnapshot,
    getActiveTabIdSnapshot,
  };
}

export const editorStore = createEditorStore();