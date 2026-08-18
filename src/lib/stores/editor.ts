import { writable, derived } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { getHumanReadableError } from '../utils/error';
import { settingsStore } from './settings.svelte';
import {
  UNTITLED_PREFIX,
  UNKNOWN_NAME,
  BINARY_SENTINEL,
  LARGE_FILE_SENTINEL,
  SUSPEND_TAB_AFTER_MS,
  MAX_IN_MEMORY_TABS,
  MAX_CLOSED_TABS,
  AUTOSAVE_FALLBACK_DELAY_MS,
  SAVE_STATUS_CLEAR_MS,
  generateId,
} from '../constants';
import { isImageFile } from '../utils/path';
import { buildReplaceRegex, applyReplacement, type ReplaceMatchOptions } from '../utils/replace';

export interface ClosedTabEntry {
  path: string;
  cursorPos?: { line: number; column: number; endColumn?: number };
  scrollTop?: { top: number; left: number };
}

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
  autoSavePaused?: boolean;
  status?: 'active' | 'loaded' | 'suspended' | 'modified' | 'deleted' | 'conflict';
  undoHistory?: any;
  redoHistory?: any;
  cursorHistory?: any[];
  currentHistoryIndex?: number;
  isDiff?: boolean;
  diffOriginalContent?: string | null;
  svgViewMode?: 'image' | 'code' | 'split';
  mdViewMode?: 'preview' | 'code' | 'split';
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
  undoHistory?: any;
  isDiff?: boolean;
  diffOriginalContent?: string | null;
  svgViewMode?: 'image' | 'code' | 'split';
};

// Cursor/scroll state lives in separate Maps (not in the tabs array) so the
// tab bar and other subscribers are not re-rendered on every cursor move or
// scroll event. cursorSignal is a lightweight change notification for the
// consumers that do care.
const cursorPositions = new Map<string, { line: number; column: number; endColumn?: number }>();
const scrollPositions = new Map<string, { top: number; left: number }>();
const cursorSignal = writable<number>(0);

function createEditorStore() {
  const tabs = writable<EditorTab[]>([]);
  const activeTabId = writable<string | null>(null);
  const saveStatus = writable<string | null>(null);
  const closedTabStack: ClosedTabEntry[] = [];
  let autoSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const activeTab = derived([tabs, activeTabId], ([$tabs, $id]) =>
    $tabs.find((t) => t.id === $id) || null
  );

  function addTab(input: TabInput) {
    tabs.update((state) => {
      const exists = state.find((t) => t.id === input.id || (t.path === input.path && t.language === input.language));
      if (exists) {
        activeTabId.set(exists.id);
        return state.map((t) => {
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
        undoHistory: input.undoHistory,
        lastAccessed: Date.now(),
        status: input.content !== null ? 'active' : 'loaded',
        svgViewMode: input.svgViewMode,
      };

      let currentTabs = [...state];
      if (newTab.language !== 'welcome') {
        currentTabs = currentTabs.filter((t) => t.language !== 'welcome');
      }

      if (newTab.isPreview) {
        const previewIndex = currentTabs.findIndex((t) => t.isPreview && !t.isModified);
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
    // Save to closed tab stack before closing
    tabs.update((state) => {
      const tab = state.find((t) => t.id === id);
      if (tab && tab.path && !tab.path.startsWith(UNTITLED_PREFIX)) {
        closedTabStack.push({
          path: tab.path,
          cursorPos: cursorPositions.get(id),
          scrollTop: scrollPositions.get(id),
        });
        if (closedTabStack.length > MAX_CLOSED_TABS) closedTabStack.shift();
      }
      return state;
    });

    // Cleanup cursor/scroll data
    cursorPositions.delete(id);
    scrollPositions.delete(id);

    tabs.update((state) => {
      const newTabs = state.filter((t) => t.id !== id);
      activeTabId.update((current) => {
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
    tabs.update((state) =>
      state.map((t) => ({
        ...t,
        lastAccessed: t.id === id ? Date.now() : t.lastAccessed,
        status: t.id === id ? 'active' : t.status === 'active' ? 'loaded' : t.status,
      }))
    );
  }

  function setInitialContent(id: string, content: string) {
    tabs.update((state) =>
      state.map((t) => {
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
    tabs.update((state) =>
      state.map((t) => {
        if (t.id === id) {
          const isModified = content !== t.originalContent;
          return {
            ...t,
            content,
            isModified,
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

  function updateCursor(id: string, line: number, column: number, endColumn?: number) {
    cursorPositions.set(id, { line, column, endColumn });
    cursorSignal.update((n) => n + 1);
  }

  function updateUndoHistory(id: string, history: any) {
    tabs.update((state) =>
      state.map((t) => (t.id === id ? { ...t, undoHistory: history } : t))
    );
  }

  function updateScroll(id: string, top: number, left: number) {
    scrollPositions.set(id, { top, left });
  }

  function getCursor(id: string): { line: number; column: number; endColumn?: number } | undefined {
    return cursorPositions.get(id);
  }

  function getScroll(id: string): { top: number; left: number } | undefined {
    return scrollPositions.get(id);
  }

  function markSaved(id: string) {
    tabs.update((state) =>
      state.map((t) => {
        if (t.id === id) {
          return {
            ...t,
            originalContent: t.content,
            isModified: false,
            autoSavePaused: false,
            status: t.content !== null ? 'active' : 'loaded',
          };
        }
        return t;
      })
    );
  }

  function markTabDeleted(id: string) {
    tabs.update((state) =>
      state.map((t) => {
        if (t.id === id) {
          return { ...t, status: 'deleted' as const };
        }
        return t;
      })
    );
  }

  function markTabConflict(id: string) {
    tabs.update((state) =>
      state.map((t) => {
        if (t.id === id) {
          return { ...t, status: 'conflict' as const };
        }
        return t;
      })
    );
  }

  function pinTab(id: string) {
    tabs.update((state) =>
      state.map((t) => {
        if (t.id === id) {
          return { ...t, isPreview: false };
        }
        return t;
      })
    );
  }

  function togglePin(id: string) {
    tabs.update((state) =>
      state.map((t) => {
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
    tabs.update((state) =>
      state.map((t) => {
        if (t.id === id && !t.isModified && t.content !== null) {
          return { ...t, content: null, originalContent: null, status: 'suspended' as const, undoHistory: undefined };
        }
        return t;
      })
    );
  }

  /**
   * LRU tab suspension: if the number of tabs holding content in memory
   * exceeds MAX_IN_MEMORY_TABS, suspend the least-recently-used unmodified
   * tabs (or any tab idle for longer than SUSPEND_TAB_AFTER_MS).
   */
  function enforceMemoryLimit() {
    tabs.update((state) => {
      const activeId = getActiveTabIdSnapshot();
      const now = Date.now();

      // Non-active, non-modified tabs that have content in memory, oldest first
      const candidates = state
        .filter((t) => t.id !== activeId && !t.isModified && t.content !== null)
        .sort((a, b) => a.lastAccessed - b.lastAccessed);

      let inMemoryCount = state.filter((t) => t.content !== null && !t.isModified && t.id !== activeId).length;

      for (const tab of candidates) {
        const isIdleTooLong = now - tab.lastAccessed > SUSPEND_TAB_AFTER_MS;
        const isOverLimit = inMemoryCount > MAX_IN_MEMORY_TABS;

        if (isIdleTooLong || isOverLimit) {
          state = state.map((t) =>
            t.id === tab.id
              ? { ...t, content: null, originalContent: null, status: 'suspended' as const, undoHistory: undefined }
              : t
          );
          inMemoryCount--;
        }

        if (inMemoryCount <= MAX_IN_MEMORY_TABS) break;
      }

      return state;
    });
  }

  function scheduleAutoSave(tabId: string) {
    // Only auto-save when the setting is enabled, using the configured delay.
    if (!settingsStore.effectiveSettings.auto_save) return;
    if (autoSaveTimers.has(tabId)) clearTimeout(autoSaveTimers.get(tabId)!);
    const delay = settingsStore.effectiveSettings.auto_save_delay_ms || AUTOSAVE_FALLBACK_DELAY_MS;

    const timer = setTimeout(async () => {
      autoSaveTimers.delete(tabId);
      const snapshot = getTabsSnapshot();
      const tab = snapshot.find((t) => t.id === tabId);
      if (tab && tab.isModified && !tab.path.startsWith(UNTITLED_PREFIX) && tab.content !== null && !tab.autoSavePaused) {
        saveStatus.set('Saving...');
        // Snapshot what we are writing so edits made *while* the save was in
        // flight still leave the tab marked as modified afterwards.
        const savedContent = tab.content;
        try {
          await invoke('save_file', { path: tab.path, content: savedContent });
          tabs.update((state) =>
            state.map((t) =>
              t.id === tabId && t.content === savedContent
                ? {
                    ...t,
                    originalContent: savedContent,
                    isModified: false,
                    autoSavePaused: false,
                    status: 'active',
                  }
                : t
            )
          );
          saveStatus.set('Saved');
          setTimeout(() => clearSaveStatus(), SAVE_STATUS_CLEAR_MS);
        } catch (err) {
          console.error('Auto-save failed:', err);
          saveStatus.set(`Save failed: ${getHumanReadableError(err)}`);
          tabs.update((state) => state.map((t) => (t.id === tabId ? { ...t, autoSavePaused: true } : t)));
        }
      }
    }, delay);

    autoSaveTimers.set(tabId, timer);
  }

  function clearSaveStatus() {
    saveStatus.set(null);
  }

  function setTabLoading(id: string, loading: boolean) {
    tabs.update((state) => state.map((t) => (t.id === id ? { ...t, isLoading: loading } : t)));
  }

  function setTabUnsupported(id: string, unsupported: boolean) {
    tabs.update((state) => state.map((t) => (t.id === id ? { ...t, isUnsupported: unsupported } : t)));
  }

  function pauseAutoSave(id: string) {
    tabs.update((state) => state.map((t) => (t.id === id ? { ...t, autoSavePaused: true } : t)));
  }

  /**
   * Apply a Replace All to an open (in-memory) tab via the store. The new
   * content is pushed through `updateContent`, which marks the tab modified
   * and schedules an auto-save — the disk write happens through the same
   * pipeline as manual edits.
   *
   * Returns the number of replaced occurrences, or 0 if none matched.
   */
  function applyReplacements(path: string, opts: ReplaceMatchOptions): number {
    const tab = getTabsSnapshot().find((t) => t.path === path && t.content !== null);
    if (!tab || tab.content === null) return 0;
    const re = buildReplaceRegex(opts.query, opts);
    const matches = tab.content.match(re);
    if (!matches || matches.length === 0) return 0;
    const newContent = tab.content.replace(re, (m) => applyReplacement(m, re, opts));
    if (newContent === tab.content) return 0;
    updateContent(tab.id, newContent);
    return matches.length;
  }

  function getTabsSnapshot(): EditorTab[] {
    let val: EditorTab[] = [];
    tabs.subscribe((v) => (val = v))();
    return val;
  }

  function getActiveTabIdSnapshot(): string | null {
    let val: string | null = null;
    activeTabId.subscribe((v) => (val = v))();
    return val;
  }

  /**
   * Snapshot of cursor/scroll positions for all tabs (for workspace session
   * save). Returns an array of { id, cursor, scroll } objects.
   */
  function getCursorScrollSnapshot() {
    const result: Array<{ id: string; cursor?: { line: number; column: number; endColumn?: number }; scroll?: { top: number; left: number } }> = [];
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

  function updateTabPath(oldPath: string, newPath: string) {
    // Migrate cursor/scroll data
    if (cursorPositions.has(oldPath)) {
      cursorPositions.set(newPath, cursorPositions.get(oldPath)!);
      cursorPositions.delete(oldPath);
    }
    if (scrollPositions.has(oldPath)) {
      scrollPositions.set(newPath, scrollPositions.get(oldPath)!);
      scrollPositions.delete(oldPath);
    }

    tabs.update((state) =>
      state.map((t) => {
        if (t.path === oldPath) {
          const name = newPath.split(/[/\\]/).pop() || t.name;
          return { ...t, id: newPath, path: newPath, name };
        }
        return t;
      })
    );
    activeTabId.update((current) => (current === oldPath ? newPath : current));
  }

  async function reopenClosedTab() {
    const entry = closedTabStack.pop();
    if (!entry) return;

    const fileName = entry.path.split(/[/\\]/).pop() || UNKNOWN_NAME;
    let content = '';
    let isLargeFile = false;
    if (!isImageFile(fileName)) {
      try {
        content = await invoke<string>('read_file_text', { path: entry.path });
      } catch (e) {
        if (String(e) === BINARY_SENTINEL) content = '';
        else if (String(e) === LARGE_FILE_SENTINEL) {
          try {
            const chunked = await invoke<any>('read_file_chunked', { path: entry.path });
            content = chunked.content;
            isLargeFile = true;
          } catch (err) {
            return;
          }
        } else return; // If file doesn't exist anymore, abort
      }
    }

    let language = 'plaintext';
    if (isImageFile(fileName)) language = 'image';
    else {
      try {
        language = await invoke<string>('detect_language', { path: entry.path });
      } catch {}
    }

    const id = generateId('tab');
    addTab({
      id,
      path: entry.path,
      name: fileName,
      content,
      language,
      isPreview: isLargeFile,
      isLargeFile,
    });
    setActiveTab(id);

    if (entry.cursorPos) updateCursor(id, entry.cursorPos.line, entry.cursorPos.column, entry.cursorPos.endColumn);
    if (entry.scrollTop) updateScroll(id, entry.scrollTop.top, entry.scrollTop.left);
  }

  function updateTab(id: string, props: Partial<EditorTab>) {
    tabs.update((tbs) =>
      tbs.map((t) => (t.id === id ? { ...t, ...props } : t))
    );
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
    updateUndoHistory,
    updateTab,
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
    updateTabPath,
    reopenClosedTab,
    pauseAutoSave,
    applyReplacements,
  };
}

export const editorStore = createEditorStore();