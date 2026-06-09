import { useState, useEffect, useRef } from 'react';
import { Search } from 'lucide-react';
import { useSettingsStore } from '../store/settingsStore';

interface Command {
  id: string;
  name: string;
  shortcut?: string;
  action: () => void;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  commands: Command[];
}

export default function CommandPalette({ isOpen, onClose, commands }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const { settings } = useSettingsStore();
  const isDark = settings.theme === 'dark' || (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  const filteredCommands = commands.filter(c => 
    c.name.toLowerCase().includes(query.toLowerCase())
  );

  const handleSelect = (cmd: Command) => {
    cmd.action();
    onClose();
  };

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => (prev + 1) % filteredCommands.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => (prev - 1 + filteredCommands.length) % filteredCommands.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredCommands[selectedIndex]) {
          handleSelect(filteredCommands[selectedIndex]);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, filteredCommands, selectedIndex, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div 
        className={`w-full max-w-lg rounded-xl shadow-2xl overflow-hidden border ${isDark ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-zinc-200'}`}
        onClick={e => e.stopPropagation()}
      >
        <div className={`flex items-center px-4 py-3 border-b ${isDark ? 'border-zinc-800' : 'border-zinc-200'}`}>
          <Search size={18} className={isDark ? 'text-zinc-500' : 'text-zinc-400'} />
          <input
            ref={inputRef}
            className={`flex-1 bg-transparent border-none outline-none px-3 text-sm ${isDark ? 'text-zinc-100 placeholder:text-zinc-500' : 'text-zinc-900 placeholder:text-zinc-400'}`}
            placeholder="Type a command or search..."
            value={query}
            onChange={e => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
          />
        </div>
        
        <div className="max-h-80 overflow-y-auto py-2">
          {filteredCommands.length === 0 ? (
            <div className={`px-4 py-3 text-sm text-center ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
              No commands found
            </div>
          ) : (
            filteredCommands.map((cmd, i) => (
              <div 
                key={cmd.id}
                className={`flex items-center justify-between px-4 py-2 cursor-pointer ${
                  i === selectedIndex 
                    ? (isDark ? 'bg-blue-600 text-white' : 'bg-blue-500 text-white') 
                    : (isDark ? 'text-zinc-300 hover:bg-zinc-800' : 'text-zinc-700 hover:bg-zinc-100')
                }`}
                onClick={() => handleSelect(cmd)}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                <span className="text-sm">{cmd.name}</span>
                {cmd.shortcut && (
                  <kbd className={`text-xs px-2 py-0.5 rounded ${
                    i === selectedIndex 
                      ? (isDark ? 'bg-blue-500 text-blue-100' : 'bg-blue-600 text-blue-50')
                      : (isDark ? 'bg-zinc-800 text-zinc-500' : 'bg-zinc-200 text-zinc-500')
                  }`}>
                    {cmd.shortcut}
                  </kbd>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
