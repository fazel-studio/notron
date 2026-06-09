// import { useState, useEffect } from 'react';
import { useSettingsStore } from '../store/settingsStore';
import { invoke } from '@tauri-apps/api/core';
import { X, Settings2 } from 'lucide-react';

interface SettingsPageProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SettingsPage({ isOpen, onClose }: SettingsPageProps) {
  const { settings, setSettings } = useSettingsStore();
  const isDark = settings.theme === 'dark' || (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  const handleSave = async (key: string, value: any) => {
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);
    // Sync to Rust
    try {
      await invoke('set_config', { config: newSettings });
    } catch (err) {
      console.error("Failed to save settings", err);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className={`w-full max-w-2xl rounded-lg shadow-2xl flex flex-col h-[80vh] border ${isDark ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-zinc-200'}`}>
        <div className={`flex items-center justify-between p-4 border-b ${isDark ? 'border-zinc-800' : 'border-zinc-200'}`}>
          <h2 className={`font-semibold flex items-center gap-2 ${isDark ? 'text-zinc-100' : 'text-zinc-900'}`}>
            <Settings2 size={18} /> Settings
          </h2>
          <button onClick={onClose} className={isDark ? 'text-zinc-400 hover:text-white' : 'text-zinc-500 hover:text-black'}><X size={18} /></button>
        </div>
        
        <div className={`flex-1 overflow-y-auto p-6 space-y-8 text-sm ${isDark ? 'text-zinc-300' : 'text-zinc-700'}`}>
          <section className="space-y-4">
            <h3 className="text-blue-500 font-semibold uppercase tracking-wider text-xs">Appearance</h3>
            
            <div className="flex flex-col gap-1">
              <label>Theme</label>
              <select 
                className={`rounded p-2 outline-none w-64 focus:border-blue-500 border ${isDark ? 'bg-zinc-800 border-zinc-700 text-white' : 'bg-zinc-50 border-zinc-300 text-black'}`}
                value={settings.theme}
                onChange={e => handleSave('theme', e.target.value)}
              >
                <option value="light">Light</option>
                <option value="dark">Dark</option>
                <option value="system">System Default</option>
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label>Font Family</label>
              <input 
                className={`rounded p-2 outline-none w-full focus:border-blue-500 border ${isDark ? 'bg-zinc-800 border-zinc-700 text-white' : 'bg-zinc-50 border-zinc-300 text-black'}`}
                value={settings.font_family}
                onChange={e => handleSave('font_family', e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1">
              <label>Font Size ({settings.font_size}px)</label>
              <input 
                type="range" min="10" max="32"
                className="w-64"
                value={settings.font_size}
                onChange={e => handleSave('font_size', parseInt(e.target.value, 10))}
              />
            </div>
          </section>

          <section className="space-y-4">
            <h3 className="text-blue-500 font-semibold uppercase tracking-wider text-xs">Editor</h3>
            
            <div className="flex flex-col gap-1">
              <label>Tab Size</label>
              <input 
                type="number" min="2" max="8"
                className={`rounded p-2 outline-none w-24 focus:border-blue-500 border ${isDark ? 'bg-zinc-800 border-zinc-700 text-white' : 'bg-zinc-50 border-zinc-300 text-black'}`}
                value={settings.tab_size}
                onChange={e => handleSave('tab_size', parseInt(e.target.value, 10))}
              />
            </div>

            <div className="flex items-center gap-2">
              <input 
                type="checkbox" id="wordWrap"
                checked={settings.word_wrap}
                onChange={e => handleSave('word_wrap', e.target.checked)}
              />
              <label htmlFor="wordWrap">Word Wrap</label>
            </div>

            <div className="flex items-center gap-2">
              <input 
                type="checkbox" id="lineNumbers"
                checked={settings.line_numbers}
                onChange={e => handleSave('line_numbers', e.target.checked)}
              />
              <label htmlFor="lineNumbers">Line Numbers</label>
            </div>
          </section>

          <section className="space-y-4">
            <h3 className="text-blue-400 font-semibold uppercase tracking-wider text-xs">Auto Save</h3>
            
            <div className="flex items-center gap-2">
              <input 
                type="checkbox" id="autoSave"
                checked={settings.auto_save}
                onChange={e => handleSave('auto_save', e.target.checked)}
              />
              <label htmlFor="autoSave">Enable Auto Save</label>
            </div>

            {settings.auto_save && (
              <div className="flex flex-col gap-1">
                <label>Auto Save Delay ({settings.auto_save_delay_ms} ms)</label>
                <input 
                  type="range" min="500" max="10000" step="500"
                  className="w-64"
                  value={settings.auto_save_delay_ms}
                  onChange={e => handleSave('auto_save_delay_ms', parseInt(e.target.value, 10))}
                />
              </div>
            )}
          </section>

          <section className="space-y-4">
            <h3 className="text-blue-500 font-semibold uppercase tracking-wider text-xs">Files</h3>
            
            <div className="flex flex-col gap-1">
              <label>Default Encoding</label>
              <select 
                className={`rounded p-2 outline-none w-64 focus:border-blue-500 border ${isDark ? 'bg-zinc-800 border-zinc-700 text-white' : 'bg-zinc-50 border-zinc-300 text-black'}`}
                value={settings.default_encoding}
                onChange={e => handleSave('default_encoding', e.target.value)}
              >
                <option value="UTF-8">UTF-8</option>
                <option value="UTF-16">UTF-16</option>
                <option value="ISO-8859-1">ISO-8859-1</option>
              </select>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
