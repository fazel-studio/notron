import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ZoomIn, ZoomOut, Maximize } from 'lucide-react';

export default function ImageViewer({ filePath }: { filePath: string }) {
  const [src, setSrc] = useState<string>('');
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let url: string | null = null;
    if (filePath) {
      setLoading(true);
      invoke<number[]>('read_file_binary', { path: filePath })
        .then((bytes) => {
          const uint8Array = new Uint8Array(bytes);
          
          const ext = filePath.split('.').pop()?.toLowerCase();
          let mimeType = 'image/png';
          if (ext === 'jpg' || ext === 'jpeg') mimeType = 'image/jpeg';
          else if (ext === 'gif') mimeType = 'image/gif';
          else if (ext === 'webp') mimeType = 'image/webp';
          else if (ext === 'svg') mimeType = 'image/svg+xml';
          else if (ext === 'ico') mimeType = 'image/x-icon';

          const blob = new Blob([uint8Array], { type: mimeType });
          url = URL.createObjectURL(blob);
          setSrc(url);
          setLoading(false);
        })
        .catch((err) => {
          console.error(err);
          setLoading(false);
        });
    }

    return () => {
      if (url) {
        URL.revokeObjectURL(url);
      }
    };
  }, [filePath]);

  const handleZoomIn = () => setZoom(z => Math.min(z + 0.25, 5));
  const handleZoomOut = () => setZoom(z => Math.max(z - 0.25, 0.25));
  const handleResetZoom = () => setZoom(1);

  return (
    <div className="w-full h-full flex flex-col bg-[#1e1e1e] text-zinc-300">
      <div className="h-10 flex items-center justify-center gap-2 px-4 border-b border-zinc-800 bg-[#181818] shrink-0">
        <button onClick={handleZoomOut} className="p-1.5 rounded hover:bg-zinc-700 text-zinc-400 hover:text-white" title="Zoom Out">
          <ZoomOut size={16} />
        </button>
        <span className="text-xs text-zinc-400 min-w-12 text-center">{Math.round(zoom * 100)}%</span>
        <button onClick={handleZoomIn} className="p-1.5 rounded hover:bg-zinc-700 text-zinc-400 hover:text-white" title="Zoom In">
          <ZoomIn size={16} />
        </button>
        <div className="w-px h-4 bg-zinc-700 mx-2" />
        <button onClick={handleResetZoom} className="p-1.5 rounded hover:bg-zinc-700 text-zinc-400 hover:text-white" title="Reset Zoom">
          <Maximize size={16} />
        </button>
      </div>
      <div className="flex-1 overflow-auto flex items-center justify-center p-4">
        {loading ? (
          <span className="text-zinc-500">Loading image...</span>
        ) : src ? (
          <img 
            src={src} 
            alt="viewer" 
            style={{ 
              transform: `scale(${zoom})`, 
              transformOrigin: 'center center',
              transition: 'transform 0.2s ease-in-out'
            }} 
            className="max-w-none"
          />
        ) : (
          <span className="text-zinc-500">Failed to load image.</span>
        )}
      </div>
    </div>
  );
}
