import React, { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useSettingsStore } from '../store/settingsStore';
import { useUiStore } from '../store/uiStore';
import { useEditorStore } from '../store/editorStore';

interface NewFileDialogProps {
  isOpen: boolean;
  onClose: () => void;
  isFromWelcome?: boolean;
}

export function NewFileDialog({ isOpen, onClose, isFromWelcome = false }: NewFileDialogProps) {
  const [fileName, setFileName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  
  const isDark = useSettingsStore(state => state.settings.theme === 'dark' || (state.settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches));
  const { explorerRoot, selectedExplorerPath } = useUiStore();
  const { addTab } = useEditorStore();

  useEffect(() => {
    if (isOpen) {
      setFileName('');
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCreate = async () => {
    if (!fileName.trim()) return;
    if (!explorerRoot) {
      alert("Silakan buka sebuah folder workspace terlebih dahulu.");
      onClose();
      return;
    }

    try {
      let targetDir = explorerRoot;
      
      if (!isFromWelcome && selectedExplorerPath) {
        // Find if selected path is file or directory. We can assume if it has an extension it might be a file,
        // or we can just ask rust if it's a directory. For simplicity we can check the path via rust,
        // but to avoid async overhead we can just do a heuristic or let rust handle it.
        // Actually we can check if selectedExplorerPath has a children array in the tree, but that's hard to get here.
        // Let's use a quick rust call to check if it's a directory.
        await invoke<boolean>('file_exists', { path: selectedExplorerPath }); // Wait, file_exists doesn't tell if dir
        // Let's just assume it's a file if it has a file extension, or better, rust can figure it out.
        // Let's do a trick: we can just check if it's a directory by trying to read it.
        try {
          await invoke('read_directory', { path: selectedExplorerPath });
          targetDir = selectedExplorerPath; // It is a directory
        } catch {
          // It's a file, get parent
          const sep = selectedExplorerPath.includes('\\') ? '\\' : '/';
          const parts = selectedExplorerPath.split(sep);
          parts.pop(); // Remove file name
          targetDir = parts.join(sep);
        }
      }

      const sep = targetDir.includes('\\') ? '\\' : '/';
      const fullPath = `${targetDir}${sep}${fileName}`;

      await invoke('create_file', { path: fullPath });
      
      // Refresh explorer
      useUiStore.getState().triggerExplorerRefresh();
      
      // Open the file
      addTab({
        id: `tab-${Date.now()}`,
        path: fullPath,
        name: fileName.split(/[/\\]/).pop() || fileName,
        content: '',
        language: 'plaintext', // Will be updated by detection
        isPreview: false
      });

      onClose();
    } catch (err) {
      alert(`Gagal membuat file: ${err}`);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleCreate();
    if (e.key === 'Escape') onClose();
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className={`w-full max-w-sm rounded-lg shadow-2xl flex flex-col border ${isDark ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-zinc-200'}`}>
        <div className={`flex items-center justify-between p-3 border-b ${isDark ? 'border-zinc-800' : 'border-zinc-200'}`}>
          <h2 className={`text-sm font-semibold ${isDark ? 'text-zinc-100' : 'text-zinc-900'}`}>
            New File
          </h2>
          <button onClick={onClose} className={isDark ? 'text-zinc-400 hover:text-white' : 'text-zinc-500 hover:text-black'}>
            <X size={16} />
          </button>
        </div>
        
        <div className="p-4 space-y-4">
          <input
            ref={inputRef}
            type="text"
            placeholder="File name (e.g. index.tsx)"
            value={fileName}
            onChange={(e) => setFileName(e.target.value)}
            onKeyDown={handleKeyDown}
            className={`w-full px-3 py-2 text-sm rounded outline-none border focus:border-blue-500 ${isDark ? 'bg-zinc-800 border-zinc-700 text-zinc-100 placeholder-zinc-500' : 'bg-white border-zinc-300 text-zinc-900 placeholder-zinc-400'}`}
          />
          
          <div className="flex justify-end">
            <button
              onClick={handleCreate}
              disabled={!fileName.trim()}
              className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 rounded outline-none"
            >
              Create
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
