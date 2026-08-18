import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';

(function preloadTheme() {
  try {
    const stored = localStorage.getItem('notron_theme');
    const theme = stored || 'system';
    const darkThemesList = ['dracula', 'darcula', 'tokyo-night', 'tokyo-night-storm', 'nord', 'bespin', 'okaidia', 'aura', 'sublime', 'atomone', 'androidstudio', 'abcdef', 'red', 'abyss', 'andromeda', 'copilot', 'kimbie', 'material', 'monokai', 'monokai-dimmed', 'tomorrow-night-blue'];
    const isDark = theme === 'dark' || theme === 'hc-dark' || theme.includes('dark') || darkThemesList.includes(theme) || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
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
