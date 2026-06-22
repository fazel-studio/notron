import { writable } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { Fzf } from 'fzf';

export interface PaletteItem {
  id: string;
  label: string;
  description?: string;
  category: 'command' | 'file' | 'symbol' | 'recent';
  action: () => void;
  keywords?: string[];
  shortcut?: string;
}

function createPaletteStore() {
  const { subscribe, set } = writable({
    items: [] as PaletteItem[],
    fzfInstance: null as Fzf<PaletteItem[]> | null,
    isLoaded: false
  });

  return {
    subscribe,
    initItems(items: PaletteItem[]) {
      const fzf = new Fzf(items, {
        selector: (item) => `${item.label} ${item.keywords?.join(' ') ?? ''}`,
        limit: 15,
      });
      set({ items, fzfInstance: fzf, isLoaded: true });
    },
    async loadWorkspaceFiles(workspacePath: string, baseCommands: PaletteItem[], openFileAction: (path: string) => void) {
      try {
        const files = await invoke<string[]>('list_all_files', { 
          path: workspacePath,
          excludeDirs: ['node_modules', '.git', 'target', 'dist']
        }).catch(() => []); // graceful fallback
        
        const fileItems: PaletteItem[] = files.map(path => {
          const relativePath = path.replace(workspacePath + (path.includes('\\') ? '\\' : '/'), '');
          return {
            id: `file:${path}`,
            label: path.split(/[/\\]/).pop() || path,
            description: relativePath,
            category: 'file',
            action: () => openFileAction(path),
          };
        });

        this.initItems([...baseCommands, ...fileItems]);
      } catch (err) {
        console.error("Failed to load workspace files for palette", err);
        this.initItems(baseCommands);
      }
    }
  };
}

export const paletteStore = createPaletteStore();
