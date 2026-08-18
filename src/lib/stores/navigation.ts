import { writable, get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { editorStore } from './editor';
import { MAX_NAV_STACK, NAV_LINE_DELTA, GOTO_DISPATCH_MS, UNKNOWN_NAME } from '../constants';
import { basename, isImageFile } from '../utils/path';

export interface NavLocation {
  path: string;
  line: number;
  col: number;
}

function createNavigationStore() {
  const { subscribe, update } = writable({
    backStack: [] as NavLocation[],
    forwardStack: [] as NavLocation[],
    currentLocation: null as NavLocation | null,
  });

  return {
    subscribe,
    isSignificantNavigation(prev: NavLocation | null, next: NavLocation): boolean {
      if (!prev) return true;
      if (prev.path !== next.path) return true;
      if (Math.abs(prev.line - next.line) > NAV_LINE_DELTA) return true;
      return false;
    },

    recordNavigation(location: NavLocation) {
      update((state) => {
        if (!this.isSignificantNavigation(state.currentLocation, location)) return state;

        const newBackStack = [...state.backStack];
        if (state.currentLocation) {
          newBackStack.push(state.currentLocation);
          if (newBackStack.length > MAX_NAV_STACK) newBackStack.shift();
        }

        return {
          backStack: newBackStack,
          forwardStack: [],
          currentLocation: location,
        };
      });
    },

    async navigateBack() {
      const state = get(this);
      const target = state.backStack[state.backStack.length - 1];
      if (!target) return;

      const newBackStack = state.backStack.slice(0, -1);
      const newForwardStack = [...state.forwardStack];
      if (state.currentLocation) {
        newForwardStack.push(state.currentLocation);
      }

      update((s) => ({
        ...s,
        backStack: newBackStack,
        forwardStack: newForwardStack,
        currentLocation: target,
      }));

      await this.navigateTo(target, { recordNav: false });
    },

    async navigateForward() {
      const state = get(this);
      const target = state.forwardStack[state.forwardStack.length - 1];
      if (!target) return;

      const newForwardStack = state.forwardStack.slice(0, -1);
      const newBackStack = [...state.backStack];
      if (state.currentLocation) {
        newBackStack.push(state.currentLocation);
      }

      update((s) => ({
        ...s,
        backStack: newBackStack,
        forwardStack: newForwardStack,
        currentLocation: target,
      }));

      await this.navigateTo(target, { recordNav: false });
    },

    async navigateTo(location: NavLocation, options = { recordNav: true }) {
      try {
        const fileExists = await invoke<boolean>('file_exists', { path: location.path });
        if (!fileExists) {
          console.warn('File no longer exists, skipped');
          const state = get(this);
          if (state.backStack.length > 0) this.navigateBack();
          return;
        }

        let lang = 'plaintext';
        if (isImageFile(location.path)) {
          lang = 'image';
        } else {
          lang = await invoke<string>('detect_language', { path: location.path }).catch(() => 'plaintext');
        }

        // Switch to or open tab
        const fileName = basename(location.path) || UNKNOWN_NAME;
        editorStore.addTab({
          id: location.path,
          path: location.path,
          name: fileName,
          content: null,
          language: lang,
          isPreview: true,
        });

        // Trigger scroll in editor
        setTimeout(() => {
          window.dispatchEvent(
            new CustomEvent('editor:action', {
              detail: { action: 'goto', line: location.line, col: location.col },
            })
          );
        }, GOTO_DISPATCH_MS);

        if (options.recordNav) this.recordNavigation(location);
      } catch (e) {
        console.error('Failed to navigate', e);
      }
    },
  };
}

export const navigationStore = createNavigationStore();
