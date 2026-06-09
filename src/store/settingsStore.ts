import { create } from 'zustand';

interface AppSettings {
  theme: string;
  font_size: number;
  font_family: string;
  tab_size: number;
  word_wrap: boolean;
  line_numbers: boolean;
  auto_save: boolean;
  auto_save_delay_ms: number;
  default_encoding: string;
}

interface SettingsState {
  settings: AppSettings;
  setSettings: (settings: Partial<AppSettings>) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: {
    theme: 'system',
    font_size: 14,
    font_family: 'JetBrains Mono, Consolas, monospace',
    tab_size: 4,
    word_wrap: false,
    line_numbers: true,
    auto_save: false,
    auto_save_delay_ms: 2000,
    default_encoding: 'UTF-8',
  },
  setSettings: (newSettings) => set((state) => ({
    settings: { ...state.settings, ...newSettings }
  })),
}));
