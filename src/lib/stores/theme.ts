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
    const t = localStorage.getItem(THEME_KEY) || 'system';
    if (t === 'light') return 'vscode-light';
    if (t === 'dark') return 'vscode-dark';
    return t;
  } catch {
    return 'system';
  }
}

function computeIsDark(theme: string): boolean {
  if (theme === 'system') return getSystemTheme();
  if (theme === 'light') return false;
  if (theme === 'dark' || theme === 'hc-dark') return true;
  return theme.includes('dark') || ['dracula', 'darcula', 'tokyo-night', 'tokyo-night-storm', 'nord', 'bespin', 'okaidia', 'aura', 'sublime', 'atomone', 'androidstudio', 'abcdef'].includes(theme);
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
        const html = document.documentElement;
        html.classList.toggle('dark', isDark);
        html.classList.toggle('hc-dark', theme === 'hc-dark');
        html.classList.toggle('hc-light', theme === 'hc-light');
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
