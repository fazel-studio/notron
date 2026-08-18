import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';
import { THEMES } from './lib/themes';

// Pre-emptively apply the stored theme class before the app mounts to
// avoid a flash of the wrong color scheme. The dark-theme list is derived
// from THEMES so it stays in sync with the theme catalog.
(function preloadTheme() {
  try {
    const stored = localStorage.getItem('notron_theme');
    const theme = stored || 'system';
    const darkThemes = Object.entries(THEMES)
      .filter(([, t]) => t.isDark)
      .map(([id]) => id);
    const isDark =
      theme === 'dark' ||
      theme === 'hc-dark' ||
      theme.includes('dark') ||
      darkThemes.includes(theme) ||
      (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    const html = document.documentElement;
    html.classList.toggle('dark', isDark);
    html.classList.toggle('hc-dark', theme === 'hc-dark');
    html.classList.toggle('hc-light', theme === 'hc-light');
  } catch {
    // fallback: no-op
  }
})();

const app = mount(App, {
  target: document.getElementById('root')!,
});

export default app;
