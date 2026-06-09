import { useState } from 'react';
import { File, Folder, Plus, History, X } from 'lucide-react';
import { useUiStore } from '../store/uiStore';
import { useEditorStore } from '../store/editorStore';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { exists } from '@tauri-apps/plugin-fs';

export function WelcomeTab() {
  const { recentWorkspaces, setExplorerRoot, openNewFileDialog } = useUiStore();
  const { addTab } = useEditorStore();
  const [showMoreModal, setShowMoreModal] = useState(false);

  const handleOpenRecent = async (path: string) => {
    try {
      const doesExist = await exists(path);
      if (!doesExist) {
        alert(`Path tidak ditemukan atau sudah dihapus: \n${path}`);
        return;
      }
      setExplorerRoot(path);
      setShowMoreModal(false);
    } catch (err) {
      alert(`Gagal memuat folder: ${err}`);
    }
  };

  const handleNewFile = () => {
    openNewFileDialog('welcome');
  };

  const handleOpenFile = async () => {
    try {
      const selected = await open({ multiple: false });
      if (selected && typeof selected === 'string') {
        const fileName = selected.split(/[/\\]/).pop() || 'Unknown';
        let content = '';
        const isImage = /\.(png|jpe?g|gif|webp|svg|ico)$/i.test(fileName);
        if (!isImage) {
          const bytes = await invoke<number[]>('read_file_binary', { path: selected });
          content = new TextDecoder('utf-8').decode(new Uint8Array(bytes)).replace(/\r\n/g, '\n');
        }
        addTab({
          id: `tab-${Date.now()}`,
          path: selected,
          name: fileName,
          content: content,
          language: isImage ? 'image' : await invoke<string>('detect_language', { path: selected }),
          isPreview: false
        });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleOpenFolder = async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (selected && typeof selected === 'string') {
        setExplorerRoot(selected);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const displayedRecent = recentWorkspaces.slice(0, 5);
  const hasMore = recentWorkspaces.length > 5;

  return (
    <div className="flex-1 flex flex-col items-center justify-center h-full w-full bg-transparent overflow-y-auto p-8">
      <div className="max-w-2xl w-full">
        <div className="flex items-center gap-4 mb-12 select-none">
          <img src="/notron.png" alt="Notron" className="w-16 h-16 pointer-events-none" />
          <h1 className="text-4xl font-semibold opacity-90">Notron</h1>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
          <div className="space-y-6">
            <h2 className="text-sm font-semibold opacity-60 uppercase tracking-wider mb-4">Start</h2>
            
            <button onClick={handleNewFile} className="flex items-center gap-3 w-full text-left opacity-80 hover:opacity-100 transition-opacity p-2 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800/50">
              <Plus className="w-5 h-5 text-blue-500" />
              <span>New File</span>
            </button>
            <button onClick={handleOpenFile} className="flex items-center gap-3 w-full text-left opacity-80 hover:opacity-100 transition-opacity p-2 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800/50">
              <File className="w-5 h-5 text-blue-500" />
              <span>Open File...</span>
            </button>
            <button onClick={handleOpenFolder} className="flex items-center gap-3 w-full text-left opacity-80 hover:opacity-100 transition-opacity p-2 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800/50">
              <Folder className="w-5 h-5 text-blue-500" />
              <span>Open Folder...</span>
            </button>
          </div>

          <div className="space-y-6">
            <h2 className="text-sm font-semibold opacity-60 uppercase tracking-wider mb-4">Recent</h2>
            
            {displayedRecent.length === 0 ? (
              <p className="text-sm opacity-50 p-2">No recent folders</p>
            ) : (
              <div className="flex flex-col">
                {displayedRecent.map((path, i) => (
                  <button 
                    key={i} 
                    onClick={() => handleOpenRecent(path)}
                    className="flex flex-col items-start w-full text-left opacity-80 hover:opacity-100 transition-opacity p-2 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800/50"
                  >
                    <span className="font-medium truncate w-full">{path.split(/[/\\]/).pop()}</span>
                    <span className="text-xs opacity-50 truncate w-full">{path}</span>
                  </button>
                ))}
                
                {hasMore && (
                  <button 
                    onClick={() => setShowMoreModal(true)}
                    className="flex items-center gap-2 w-full text-left text-blue-500 opacity-80 hover:opacity-100 transition-opacity p-2 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800/50 mt-2"
                  >
                    <History className="w-4 h-4" />
                    <span>More...</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {showMoreModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-lg shadow-2xl flex flex-col max-h-[80vh] border bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700">
            <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-800">
              <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">Recent Folders</h2>
              <button onClick={() => setShowMoreModal(false)} className="text-zinc-500 hover:text-black dark:text-zinc-400 dark:hover:text-white">
                <X size={18} />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-2">
              {recentWorkspaces.map((path, i) => (
                <button 
                  key={i} 
                  onClick={() => handleOpenRecent(path)}
                  className="flex flex-col items-start w-full text-left opacity-80 hover:opacity-100 transition-opacity p-3 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800/50"
                >
                  <span className="font-medium truncate w-full">{path.split(/[/\\]/).pop()}</span>
                  <span className="text-xs opacity-50 truncate w-full">{path}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
