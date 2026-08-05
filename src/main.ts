import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';

(function preloadTheme() {
  try {
    const stored = localStorage.getItem('notron_theme');
    const theme = stored || 'system';
    const isDark = theme === 'dark' || theme === 'black' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', isDark);
    document.documentElement.classList.toggle('black', theme === 'black');
  } catch {
    // fallback: no-op
  }
})();

const app = mount(App, {
  target: document.getElementById('root')!,
});

export default app;
