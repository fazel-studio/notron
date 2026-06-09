import * as Dialog from '@radix-ui/react-dialog';
import { useSettingsStore } from '../store/settingsStore';

interface CloseTabDialogProps {
  isOpen: boolean;
  fileName: string;
  onClose: () => void;
  onSave: () => void;
  onDontSave: () => void;
  onCancel: () => void;
}

export function CloseTabDialog({ isOpen, fileName, onSave, onDontSave, onCancel }: CloseTabDialogProps) {
  const isDark = useSettingsStore(state => state.settings.theme === 'dark' || (state.settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches));

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-[200] animate-in fade-in" />
        <Dialog.Content className={`fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] rounded-lg shadow-xl border p-6 z-[201] animate-in zoom-in-95 ${isDark ? 'bg-zinc-900 border-zinc-800 text-zinc-100' : 'bg-white border-zinc-200 text-zinc-900'}`}>
          <Dialog.Title className="text-lg font-semibold mb-2">Unsaved Changes</Dialog.Title>
          <Dialog.Description className="text-sm mb-6 opacity-80">
            Do you want to save the changes you made to {fileName}?
          </Dialog.Description>
          
          <div className="flex justify-end gap-3">
            <button 
              onClick={onCancel}
              className={`px-4 py-2 rounded text-sm transition-colors ${isDark ? 'bg-zinc-800 hover:bg-zinc-700' : 'bg-zinc-200 hover:bg-zinc-300'}`}
            >
              Cancel
            </button>
            <button 
              onClick={onDontSave}
              className={`px-4 py-2 rounded text-sm transition-colors ${isDark ? 'bg-red-900/50 hover:bg-red-900/80 text-red-200' : 'bg-red-100 hover:bg-red-200 text-red-700'}`}
            >
              Don't Save
            </button>
            <button 
              onClick={onSave}
              className="px-4 py-2 rounded text-sm bg-blue-600 hover:bg-blue-500 text-white transition-colors"
            >
              Save
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
