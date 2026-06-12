import { writable } from 'svelte/store';

export interface AppSettings {
  theme: string;
  font_size: number;
  font_family: string;
  tab_size: number;
  word_wrap: boolean;
  line_numbers: boolean;
  auto_save: boolean;
  auto_save_delay_ms: number;
  default_encoding: string;
  icon_theme: 'off' | 'default' | 'advance';
}

const defaultSettings: AppSettings = {
  theme: 'system',
  font_size: 14,
  font_family: 'JetBrains Mono, Consolas, monospace',
  tab_size: 4,
  word_wrap: false,
  line_numbers: true,
  auto_save: false,
  auto_save_delay_ms: 2000,
  default_encoding: 'UTF-8',
  icon_theme: 'default',
};

function createSettingsStore() {
  const settings = writable<AppSettings>({ ...defaultSettings });

  function setSettings(newSettings: Partial<AppSettings>) {
    settings.update(s => ({ ...s, ...newSettings }));
  }

  function getSnapshot(): AppSettings {
    let val: AppSettings = null!;
    settings.subscribe(v => val = v)();
    return val;
  }

  function updateKey<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    settings.update(s => ({ ...s, [key]: value }));
  }

  return {
    subscribe: settings.subscribe,
    setSettings,
    getSnapshot,
    update: updateKey,
  };
}

export const settingsStore = createSettingsStore();
