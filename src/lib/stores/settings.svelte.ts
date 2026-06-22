import { invoke } from '@tauri-apps/api/core';

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
  icon_theme: 'off' | 'default';
}

export const HARDCODED_DEFAULTS: AppSettings = {
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

class SettingsStore {
  effectiveSettings = $state<AppSettings>({ ...HARDCODED_DEFAULTS });
  rawGlobalSettings = $state<Partial<AppSettings>>({});
  rawWorkspaceSettings = $state<Partial<AppSettings>>({});
  
  savePending = new Map<string, ReturnType<typeof setTimeout>>();
  workspaceId: string | null = null;
  
  async loadAllSettings(workspaceId?: string) {
    this.workspaceId = workspaceId ?? null;
    try {
      const [globalSettings, workspaceSettings] = await Promise.all([
        invoke<Partial<AppSettings>>('load_global_settings'),
        workspaceId ? invoke<Partial<AppSettings>>('load_workspace_settings', { workspaceId }) : Promise.resolve({}),
      ]);
      
      this.rawGlobalSettings = globalSettings || {};
      this.rawWorkspaceSettings = workspaceSettings || {};
      
      this.effectiveSettings = this.resolveSettings(this.rawGlobalSettings, this.rawWorkspaceSettings);
    } catch (e) {
      console.error("Failed to load settings:", e);
    }
  }
  
  resolveSettings(global: Partial<AppSettings>, workspace: Partial<AppSettings>): AppSettings {
    const result = { ...HARDCODED_DEFAULTS };
    for (const [key, val] of Object.entries(global)) {
      if (val !== undefined && val !== null) (result as any)[key] = val;
    }
    for (const [key, val] of Object.entries(workspace)) {
      if (val !== undefined && val !== null) (result as any)[key] = val;
    }
    return result;
  }
  
  updateSetting(key: keyof AppSettings, value: any, scope: 'global' | 'workspace' = 'global') {
    (this.effectiveSettings as any)[key] = value;
    if (scope === 'global') {
      (this.rawGlobalSettings as any)[key] = value;
    } else {
      (this.rawWorkspaceSettings as any)[key] = value;
    }
    this.scheduleSave(key as string, value, scope);
  }
  
  scheduleSave(key: string, value: any, scope: 'global' | 'workspace') {
    const existing = this.savePending.get(key);
    if (existing) clearTimeout(existing);
    
    this.savePending.set(key, setTimeout(async () => {
      try {
        if (scope === 'global') {
          await invoke('save_global_setting', { key, value });
        } else if (this.workspaceId) {
          await invoke('save_workspace_setting', { workspaceId: this.workspaceId, key, value });
        }
      } catch (e) {
        console.error("Failed to save setting:", e);
      }
      this.savePending.delete(key);
    }, 500));
  }
  
  async resetToGlobal(key: keyof AppSettings) {
    if (!this.workspaceId) return;
    try {
      await invoke('delete_workspace_setting', { workspaceId: this.workspaceId, key: key as string });
      delete (this.rawWorkspaceSettings as any)[key];
      const globalVal = (this.rawGlobalSettings as any)[key] ?? HARDCODED_DEFAULTS[key];
      (this.effectiveSettings as any)[key] = globalVal;
    } catch (e) {
      console.error("Failed to reset setting:", e);
    }
  }
}

export const settingsStore = new SettingsStore();
