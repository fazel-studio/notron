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

// Tab Suspension (LRU Eviction)
const SUSPEND_AFTER_MS = 300_000;   // 5 minutes without access → suspend
const MAX_ACTIVE_TABS  = 8;         // Max tabs with loaded content in memory
const DEBOUNCE_SAVE_MS = 1500;

function createEditorStore() {
  const tabs = writable<EditorTab[]>([]);
  const activeTabId = writable<string | null>(null);
  const saveStatus = writable<string | null>(null);
  let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

  // PERF FIX: Separate cursor/scroll state from tab metadata.
  // Previously, updateCursor/updateScroll called tabs.update()
  // which rebuilt the entire tabs array every 500ms, causing
  // tab bar and all subscribers to re-render unnecessarily.
  //
  // Now cursor/scroll positions are stored in separate Maps
  // and exposed via a separate writable store. Tab bar does
  // NOT subscribe to cursor changes.
  const cursorPositions = new Map<string, { line: number; column: number }>();
  const scrollPositions = new Map<string, { top: number; left: number }>();
  // A lightweight signal that cursor/scroll consumers can subscribe to
  const cursorSignal = writable<number>(0);

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
    // Cleanup cursor/scroll data
    cursorPositions.delete(id);
    scrollPositions.delete(id);

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

  // PERF: cursor updates do NOT touch tabs store anymore
  function updateCursor(id: string, line: number, column: number) {
    cursorPositions.set(id, { line, column });
    cursorSignal.update(n => n + 1);
  }

  // PERF: scroll updates do NOT touch tabs store anymore
  function updateScroll(id: string, top: number, left: number) {
    scrollPositions.set(id, { top, left });
  }

  function getCursor(id: string): { line: number; column: number } | undefined {
    return cursorPositions.get(id);
  }

  function getScroll(id: string): { top: number; left: number } | undefined {
    return scrollPositions.get(id);
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
   * LRU Tab Suspension: If tab count with loaded content > MAX_ACTIVE_TABS,
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

  /**
   * Get snapshot of cursor/scroll for all tabs (for workspace session save).
   * Returns array of { id, cursor, scroll } objects.
   */
  function getCursorScrollSnapshot() {
    const result: Array<{ id: string; cursor?: { line: number; column: number }; scroll?: { top: number; left: number } }> = [];
    for (const [id, cursor] of cursorPositions) {
      result.push({ id, cursor, scroll: scrollPositions.get(id) });
    }
    // Include tabs with scroll but no cursor
    for (const [id, scroll] of scrollPositions) {
      if (!cursorPositions.has(id)) {
        result.push({ id, scroll });
      }
    }
    return result;
  }

  return {
    tabs: { subscribe: tabs.subscribe },
    activeTabId: { subscribe: activeTabId.subscribe },
    activeTab,
    saveStatus: { subscribe: saveStatus.subscribe },
    cursorSignal: { subscribe: cursorSignal.subscribe },
    addTab,
    closeTab,
    setActiveTab,
    setInitialContent,
    updateContent,
    updateCursor,
    updateScroll,
    getCursor,
    getScroll,
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
    getCursorScrollSnapshot,
  };
}

export const editorStore = createEditorStore();