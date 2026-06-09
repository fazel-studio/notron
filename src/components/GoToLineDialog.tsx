import { useState, useRef, useEffect } from 'react';
// import { X } from 'lucide-react';

interface GoToLineDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onGoToLine: (line: number) => void;
}

export default function GoToLineDialog({ isOpen, onClose, onGoToLine }: GoToLineDialogProps) {
  const [lineStr, setLineStr] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setLineStr('');
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const line = parseInt(lineStr, 10);
    if (!isNaN(line) && line > 0) {
      onGoToLine(line);
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <form 
        className="w-full max-w-sm bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className="flex items-center px-4 py-3 border-b border-zinc-800">
          <span className="text-zinc-500 mr-3 text-sm font-semibold">Go to line:</span>
          <input
            ref={inputRef}
            type="number"
            min="1"
            className="flex-1 bg-transparent border-none outline-none text-zinc-100 placeholder-zinc-500"
            placeholder="Line number..."
            value={lineStr}
            onChange={e => setLineStr(e.target.value)}
          />
        </div>
      </form>
    </div>
  );
}
