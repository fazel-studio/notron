import { writable, get } from 'svelte/store';
import type { Readable } from 'svelte/store';

const THEME_KEY = 'notron_theme';

function getSystemTheme(): boolean {
  if (typeof window === 'undefined') return true;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function loadTheme(): string {
  if (typeof window === 'undefined') return 'system';
  try {
    return localStorage.getItem(THEME_KEY) || 'system';
  } catch {
    return 'system';
  }
}

function computeIsDark(theme: string): boolean {
  if (theme === 'dark' || theme === 'black') return true;
  if (theme === 'light') return false;
  return getSystemTheme();
}

let themeState = { theme: loadTheme(), isDark: computeIsDark(loadTheme()) };

function createThemeStore(): Readable<{ theme: string; isDark: boolean }> & { setTheme: (theme: string) => void } {
  const store = writable(themeState);

  function setTheme(theme: string) {
    const isDark = computeIsDark(theme);
    themeState = { theme, isDark };
    store.set(themeState);
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem(THEME_KEY, theme);
        document.documentElement.classList.toggle('dark', isDark);
        document.documentElement.classList.toggle('black', theme === 'black');
      }
    } catch {
      // storage unavailable
    }
  }

  if (typeof window !== 'undefined') {
    const systemListener = (e: MediaQueryListEvent) => {
      const current = get(store).theme;
      if (current === 'system') {
        themeState = { theme: current, isDark: e.matches };
        store.set(themeState);
      }
    };

    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    mql.addEventListener('change', systemListener);

    const storageListener = (e: StorageEvent) => {
      if (e.key === THEME_KEY && e.newValue !== null) {
        themeState = { theme: e.newValue, isDark: computeIsDark(e.newValue) };
        store.set(themeState);
      }
    };

    window.addEventListener('storage', storageListener);
  }

  return {
    subscribe: store.subscribe,
    setTheme
  };
}

export const themeStore = createThemeStore();
