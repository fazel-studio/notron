import { create } from 'zustand';

export interface EditorTab {
  id: string;
  path: string;
  name: string;
  content: string;
  originalContent: string;
  isModified: boolean;
  language: string;
  isPreview?: boolean;
}

interface EditorState {
  tabs: EditorTab[];
  activeTabId: string | null;
  addTab: (tab: Omit<EditorTab, 'isModified' | 'originalContent' | 'isPreview'> & { content: string, isPreview?: boolean }) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  updateContent: (id: string, content: string) => void;
  markSaved: (id: string) => void;
  pinTab: (id: string) => void;
  setTabs: (tabs: EditorTab[], activeTabId: string | null) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  tabs: [],
  activeTabId: null,

  addTab: (tab) => set((state) => {
    const exists = state.tabs.find((t) => t.id === tab.id || (t.path === tab.path && t.language === tab.language));
    if (exists) {
      return { activeTabId: exists.id };
    }
    
    const newTab = { ...tab, originalContent: tab.content, isModified: false, isPreview: tab.isPreview ?? false };

    let currentTabs = [...state.tabs];

    // Remove welcome tab if we are adding a real tab
    if (newTab.language !== 'welcome') {
      currentTabs = currentTabs.filter(t => t.language !== 'welcome');
    }

    if (newTab.isPreview) {
      const previewIndex = currentTabs.findIndex(t => t.isPreview && !t.isModified);
      if (previewIndex !== -1) {
        currentTabs[previewIndex] = newTab;
        return { tabs: currentTabs, activeTabId: newTab.id };
      }
    }

    return { tabs: [...currentTabs, newTab], activeTabId: newTab.id };
  }),

  closeTab: (id) => set((state) => {
    const newTabs = state.tabs.filter((t) => t.id !== id);
    let newActiveId = state.activeTabId;
    if (state.activeTabId === id) {
      newActiveId = newTabs.length > 0 ? newTabs[newTabs.length - 1].id : null;
    }
    return { tabs: newTabs, activeTabId: newActiveId };
  }),

  setActiveTab: (id) => set({ activeTabId: id }),

  updateContent: (id, content) => set((state) => {
    const newTabs = state.tabs.map((t) => {
      if (t.id === id) {
        const isModified = content !== t.originalContent;
        return { ...t, content, isModified, isPreview: isModified ? false : t.isPreview };
      }
      return t;
    });
    return { tabs: newTabs };
  }),

  markSaved: (id) => set((state) => {
    const newTabs = state.tabs.map((t) => {
      if (t.id === id) {
        return { ...t, originalContent: t.content, isModified: false };
      }
      return t;
    });
    return { tabs: newTabs };
  }),

  pinTab: (id) => set((state) => {
    const newTabs = state.tabs.map((t) => {
      if (t.id === id) {
        return { ...t, isPreview: false };
      }
      return t;
    });
    return { tabs: newTabs };
  }),

  setTabs: (tabs, activeTabId) => set({ tabs, activeTabId }),
}));
