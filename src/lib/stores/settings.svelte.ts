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
  icon_theme: 'off' | 'default' | 'material';
  search_exclude: string[];
  search_include: string[];
  default_svg_view: 'image' | 'code' | 'split';
  discord_presence: boolean;
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
  search_exclude: [],
  search_include: [],
  default_svg_view: 'image',
  discord_presence: true,
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
      
      this.applyLoadedSettings(globalSettings, workspaceSettings, workspaceId);
    } catch (e) {
      console.error("Failed to load settings:", e);
    }
  }

  // Apply settings that were already fetched (e.g. folded into the single
  // load_startup_state IPC round-trip). Avoids 2 extra startup calls.
  applyLoadedSettings(
    global: Partial<AppSettings> | null | undefined,
    workspace: Partial<AppSettings> | null | undefined,
    workspaceId?: string
  ) {
    if (workspaceId !== undefined) this.workspaceId = workspaceId ?? null;
    this.rawGlobalSettings = global || {};
    this.rawWorkspaceSettings = workspace || {};
    this.effectiveSettings = this.resolveSettings(this.rawGlobalSettings, this.rawWorkspaceSettings);
  }
  
  resolveSettings(global: Partial<AppSettings>, workspace: Partial<AppSettings>): AppSettings {
    const result = { ...HARDCODED_DEFAULTS };
    const apply = (map: Partial<AppSettings>) => {
      for (const [key, val] of Object.entries(map)) {
        if (val === undefined || val === null) continue;
        if (Array.isArray(val)) {
          const existing = (result as any)[key];
          (result as any)[key] = Array.isArray(existing) ? [...existing, ...val] : [...val];
        } else {
          (result as any)[key] = val;
        }
      }
    };
    apply(global);
    apply(workspace);
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

  // Module E — Layer 2 search exclude / include pattern lists.
  private updatePatternList(
    field: 'search_exclude' | 'search_include',
    pattern: string,
    remove: boolean,
    scope: 'global' | 'workspace'
  ) {
    const p = pattern.trim();
    if (!p) return;
    const cur: string[] = (this.effectiveSettings as any)[field] ?? [];
    const next = remove ? cur.filter((x) => x !== p) : cur.includes(p) ? cur : [...cur, p];
    if (next === cur) return;
    (this.effectiveSettings as any)[field] = next;
    if (scope === 'workspace') (this.rawWorkspaceSettings as any)[field] = next;
    else (this.rawGlobalSettings as any)[field] = next;
    this.scheduleSave(field, next, scope);
  }

  addSearchExclude(pattern: string) {
    this.updatePatternList('search_exclude', pattern, false, 'workspace');
  }
  removeSearchExclude(pattern: string) {
    this.updatePatternList('search_exclude', pattern, true, 'workspace');
  }
  addSearchInclude(pattern: string) {
    this.updatePatternList('search_include', pattern, false, 'workspace');
  }
  removeSearchInclude(pattern: string) {
    this.updatePatternList('search_include', pattern, true, 'workspace');
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
