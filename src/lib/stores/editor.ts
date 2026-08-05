import { writable, derived } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { getHumanReadableError } from '../utils/error';

export interface ReplaceMatchOptions {
  query: string;
  replace: string;
  caseSensitive: boolean;
  useRegex: boolean;
  wholeWord: boolean;
}

/** Escape a literal query so it can be embedded in a RegExp safely. */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a RegExp mirroring the Rust backend (`search.rs`):
 *  * literal queries are escaped, regex queries pass through,
 *  * whole-word wraps the pattern in `\b(?:...)\b`,
 *  * case sensitivity maps to the `i` flag.
 */
export function buildReplaceRegex(query: string, opts: { caseSensitive: boolean; useRegex: boolean; wholeWord: boolean }): RegExp {
  let pattern = opts.useRegex ? query : escapeRegExp(query);
  if (opts.wholeWord) pattern = `\\b(?:${pattern})\\b`;
  return new RegExp(pattern, opts.caseSensitive ? 'g' : 'gi');
}

/** Compute the replacement string for a matched substring (handles `$1` backrefs). */
export function applyReplacement(matched: string, re: RegExp, opts: { useRegex: boolean; replace: string }): string {
  const replacer = opts.useRegex ? opts.replace : opts.replace.replace(/\$/g, '$$');
  const oneShot = new RegExp(re.source, re.flags.replace('g', ''));
  return matched.replace(oneShot, replacer);
}

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
  isDiff?: boolean;
  diffOriginalContent?: string | null;
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
};

// Removed duplicate invoke

// Tab Suspension (LRU Eviction)
const SUSPEND_AFTER_MS = 300_000;   // 5 minutes without access → suspend
const MAX_ACTIVE_TABS  = 8;         // Max tabs with loaded content in memory
const DEBOUNCE_SAVE_MS = 1500;

function createEditorStore() {
  const tabs = writable<EditorTab[]>([]);
  const activeTabId = writable<string | null>(null);
  const saveStatus = writable<string | null>(null);
  const closedTabStack: ClosedTabEntry[] = [];
  let autoSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // PERF FIX: Separate cursor/scroll state from tab metadata.
  // Previously, updateCursor/updateScroll called tabs.update()
  // which rebuilt the entire tabs array every 500ms, causing
  // tab bar and all subscribers to re-render unnecessarily.
  //
  // Now cursor/scroll positions are stored in separate Maps
  // and exposed via a separate writable store. Tab bar does
  // NOT subscribe to cursor changes.
  const cursorPositions = new Map<string, { line: number; column: number; endColumn?: number }>();
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
        undoHistory: input.undoHistory,
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
    // Save to closed tab stack before closing
    tabs.update(state => {
      const tab = state.find(t => t.id === id);
      if (tab && tab.path && !tab.path.startsWith('Untitled')) {
        closedTabStack.push({
          path: tab.path,
          cursorPos: cursorPositions.get(id),
          scrollTop: scrollPositions.get(id),
        });
        if (closedTabStack.length > 10) closedTabStack.shift();
      }
      return state;
    });

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
  function updateCursor(id: string, line: number, column: number, endColumn?: number) {
    cursorPositions.set(id, { line, column, endColumn });
    cursorSignal.update(n => n + 1);
  }

  function updateUndoHistory(id: string, history: any) {
    tabs.update(state =>
      state.map(t => (t.id === id ? { ...t, undoHistory: history } : t))
    );
  }

  // PERF: scroll updates do NOT touch tabs store anymore
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
    tabs.update(state =>
      state.map(t => {
        if (t.id === id) {
          return {
            ...t, originalContent: t.content, isModified: false, autoSavePaused: false,
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
          return { ...t, content: null, originalContent: null, status: 'suspended' as const, undoHistory: undefined };
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
              ? { ...t, content: null, originalContent: null, status: 'suspended' as const, undoHistory: undefined }
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
    if (autoSaveTimers.has(tabId)) clearTimeout(autoSaveTimers.get(tabId)!);
    
    const timer = setTimeout(async () => {
      autoSaveTimers.delete(tabId);
      const snapshot = getTabsSnapshot();
      const tab = snapshot.find(t => t.id === tabId);
      if (tab && tab.isModified && !tab.path.startsWith('Untitled') && tab.content !== null && !tab.autoSavePaused) {
        saveStatus.set('Saving...');
        try {
          await invoke('save_file', { path: tab.path, content: tab.content });
          markSaved(tabId);
          saveStatus.set('Saved');
          setTimeout(() => clearSaveStatus(), 2000);
        } catch (err) {
          console.error('Auto-save failed:', err);
          saveStatus.set(`Save failed: ${getHumanReadableError(err)}`);
          tabs.update(state => state.map(t => t.id === tabId ? { ...t, autoSavePaused: true } : t));
        }
      }
    }, DEBOUNCE_SAVE_MS);
    
    autoSaveTimers.set(tabId, timer);
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

  function pauseAutoSave(id: string) {
    tabs.update(state =>
      state.map(t => t.id === id ? { ...t, autoSavePaused: true } : t)
    );
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
    const tab = getTabsSnapshot().find(t => t.path === path && t.content !== null);
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

    tabs.update(state =>
      state.map(t => {
        if (t.path === oldPath) {
          const name = newPath.split(/[/\\]/).pop() || t.name;
          return { ...t, id: newPath, path: newPath, name };
        }
        return t;
      })
    );
    activeTabId.update(current => current === oldPath ? newPath : current);
  }

  async function reopenClosedTab() {
    const entry = closedTabStack.pop();
    if (!entry) return;
    
    const fileName = entry.path.split(/[/\\]/).pop() || 'Unknown';
    let content = '';
    const isImage = /\.(png|jpe?g|gif|webp|svg|ico)$/i.test(fileName);
    let isLargeFile = false;
    if (!isImage) {
      try {
        content = await invoke<string>('read_file_text', { path: entry.path });
      } catch (e) {
        if (String(e) === '__BINARY__') content = '';
        else if (String(e) === '__LARGE_FILE__') {
          try {
            const chunked = await invoke<any>('read_file_chunked', { path: entry.path });
            content = chunked.content;
            isLargeFile = true;
          } catch(err) { return; }
        }
        else return; // If file doesn't exist anymore, abort
      }
    }
    
    let language = 'plaintext';
    if (isImage) language = 'image';
    else {
      try { language = await invoke<string>('detect_language', { path: entry.path }); } catch {}
    }
    
    const id = `tab-${Date.now()}`;
    addTab({
      id,
      path: entry.path,
      name: fileName,
      content,
      language,
      isPreview: isLargeFile,
      isLargeFile
    });
    setActiveTab(id);
    
    if (entry.cursorPos) updateCursor(id, entry.cursorPos.line, entry.cursorPos.column, entry.cursorPos.endColumn);
    if (entry.scrollTop) updateScroll(id, entry.scrollTop.top, entry.scrollTop.left);
  }

  function updateTab(id: string, props: Partial<EditorTab>) {
    tabs.update(tbs => {
      const idx = tbs.findIndex(t => t.id === id);
      if (idx !== -1) {
        tbs[idx] = { ...tbs[idx], ...props };
      }
      return tbs;
    });
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