import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';

(function preloadTheme() {
  try {
    const stored = localStorage.getItem('notron_theme');
    const theme = stored || 'system';
    const isDark = theme === 'dark' || theme === 'hc-dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
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
