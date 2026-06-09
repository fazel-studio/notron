import { Files, X } from 'lucide-react';

export default function BatchConvertDialog({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-700 w-full max-w-2xl rounded-lg shadow-2xl flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <h2 className="text-zinc-100 font-semibold flex items-center gap-2">
            <Files size={18} /> Batch Convert
          </h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-white"><X size={18} /></button>
        </div>
        
        <div className="p-8 flex flex-col items-center justify-center text-zinc-500 min-h-[300px]">
          <Files size={48} className="mb-4 opacity-50" />
          <p>Drag and drop files here to convert multiple files at once.</p>
          <p className="text-xs mt-2">(Batch conversion UI placeholder)</p>
        </div>
      </div>
    </div>
  );
}
