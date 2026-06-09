import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { FileDown, X } from 'lucide-react';

interface ConvertDialogProps {
  isOpen: boolean;
  onClose: () => void;
  activeFilePath?: string;
}

export default function ConvertDialog({ isOpen, onClose, activeFilePath }: ConvertDialogProps) {
  const [formats, setFormats] = useState<[string, string][]>([]);
  const [inputPath, setInputPath] = useState(activeFilePath || '');
  const [outputPath, setOutputPath] = useState('');
  const [toFormat, setToFormat] = useState('pdf');
  const [converting, setConverting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      invoke('get_conversion_formats').then(res => setFormats(res as [string, string][]));
      setInputPath(activeFilePath || '');
    }
  }, [isOpen, activeFilePath]);

  const handleConvert = async () => {
    if (!inputPath || !outputPath) return alert('Please specify input and output paths');
    
    setConverting(true);
    try {
      const result: any = await invoke('convert_file', {
        inputPath,
        outputPath,
        fromFormat: null,
        toFormat,
        options: {
          standalone: true,
          toc: false,
          highlight_style: null,
          pdf_engine: null,
          extra_args: []
        }
      });
      
      if (result.success) {
        alert('Conversion successful!');
        onClose();
      } else {
        alert('Error: ' + result.error);
      }
    } catch (err) {
      alert('Error during conversion: ' + err);
    } finally {
      setConverting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-700 w-full max-w-md rounded-lg shadow-2xl flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <h2 className="text-zinc-100 font-semibold flex items-center gap-2">
            <FileDown size={18} /> Convert File
          </h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-white"><X size={18} /></button>
        </div>
        
        <div className="p-4 flex flex-col gap-4 text-sm text-zinc-300">
          <div className="flex flex-col gap-1">
            <label>Input File</label>
            <input 
              className="bg-zinc-800 border border-zinc-700 rounded p-2 outline-none focus:border-blue-500"
              value={inputPath}
              onChange={e => setInputPath(e.target.value)}
              placeholder="C:\path\to\input.md"
            />
          </div>
          
          <div className="flex flex-col gap-1">
            <label>Output Format</label>
            <select 
              className="bg-zinc-800 border border-zinc-700 rounded p-2 outline-none focus:border-blue-500"
              value={toFormat}
              onChange={e => setToFormat(e.target.value)}
            >
              {formats.map(f => (
                <option key={f[0]} value={f[0]}>{f[1]}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label>Output Path</label>
            <input 
              className="bg-zinc-800 border border-zinc-700 rounded p-2 outline-none focus:border-blue-500"
              value={outputPath}
              onChange={e => setOutputPath(e.target.value)}
              placeholder="C:\path\to\output.pdf"
            />
          </div>
        </div>

        <div className="p-4 border-t border-zinc-800 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-zinc-300 hover:text-white">Cancel</button>
          <button 
            onClick={handleConvert} 
            disabled={converting}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {converting ? 'Converting...' : 'Convert'}
          </button>
        </div>
      </div>
    </div>
  );
}
