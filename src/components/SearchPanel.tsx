import { useState, useEffect } from "react";
import { ChevronRight, ChevronDown, Replace as ReplaceIcon, File } from "lucide-react";
import { useSettingsStore } from "../store/settingsStore";
import { useUiStore } from "../store/uiStore";
import { useEditorStore } from "../store/editorStore";
import { invoke } from "@tauri-apps/api/core";

interface SearchResult {
  path: string;
  line: number;
  text: string;
}

export default function SearchPanel() {
  const { settings } = useSettingsStore();
  const isDark = settings.theme === 'dark' || (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  
  const [isReplaceVisible, setIsReplaceVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [replaceQuery, setReplaceQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const { explorerRoot } = useUiStore();
  const { addTab } = useEditorStore();

  useEffect(() => {
    const handler = setTimeout(() => {
      if (searchQuery.trim().length > 0 && explorerRoot) {
        performSearch();
      } else {
        setResults([]);
      }
    }, 1000);

    return () => clearTimeout(handler);
  }, [searchQuery, explorerRoot]);

  const performSearch = async () => {
    setIsSearching(true);
    try {
      const res = await invoke<SearchResult[]>('search_in_files', { path: explorerRoot, query: searchQuery });
      setResults(res || []);
    } catch (err) {
      console.error(err);
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleResultClick = async (path: string) => {
    try {
      const name = path.split(/[\/\\]/).pop() || 'Unknown';
      const isImage = /\.(png|jpe?g|gif|webp|svg|ico)$/i.test(name);
      let content = '';
      if (!isImage) {
        const result = await invoke<any>('open_file', { path });
        content = result.content;
      }
      
      let language = 'plaintext';
      if (!isImage) {
          language = await invoke<string>('detect_language', { path });
      }

      addTab({
        id: path,
        path: path,
        name: name,
        content,
        language: isImage ? 'image' : language,
        isPreview: true
      });
    } catch (err) {
      console.error("Failed to open file from search", err);
    }
  };

  // Group results by file path
  const groupedResults = results.reduce((acc, curr) => {
    if (!acc[curr.path]) acc[curr.path] = [];
    acc[curr.path].push(curr);
    return acc;
  }, {} as Record<string, SearchResult[]>);

  const renderHighlightedText = (text: string, query: string) => {
    if (!query) return text;
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')})`, 'gi');
    const parts = text.split(regex);
    
    return parts.map((part, i) => {
      if (part.toLowerCase() === query.toLowerCase()) {
        return (
          <span 
            key={i} 
            className={isDark ? "bg-orange-500/30 border border-orange-500/50 rounded-[2px]" : "bg-orange-500/20 border border-orange-500/40 rounded-[2px]"}
          >
            {part}
          </span>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  return (
    <div className={`flex flex-col p-2 gap-2 h-full ${isDark ? 'text-zinc-300' : 'text-zinc-700'}`}>
      <div className="flex flex-col gap-1.5 shrink-0">
        <div className="flex items-start gap-1">
          <button 
            onClick={() => setIsReplaceVisible(!isReplaceVisible)}
            className={`mt-1 p-0.5 rounded cursor-pointer transition-colors ${isDark ? 'hover:bg-zinc-700' : 'hover:bg-zinc-300'}`}
          >
            {isReplaceVisible ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
          
          <div className="flex flex-col flex-1 gap-1.5 min-w-0">
            <div className={`flex items-center flex-1 border rounded px-1.5 py-1 ${isDark ? 'border-zinc-700 bg-[#1e1e1e] focus-within:border-blue-500' : 'border-zinc-300 bg-white focus-within:border-blue-500'}`}>
              <input 
                type="text" 
                placeholder="Search" 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-500 min-w-0"
              />
            </div>

            {isReplaceVisible && (
              <div className={`flex items-center flex-1 border rounded px-1.5 py-1 ${isDark ? 'border-zinc-700 bg-[#1e1e1e] focus-within:border-blue-500' : 'border-zinc-300 bg-white focus-within:border-blue-500'}`}>
                <input 
                  type="text" 
                  placeholder="Replace" 
                  value={replaceQuery}
                  onChange={(e) => setReplaceQuery(e.target.value)}
                  className="flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-500 min-w-0"
                />
                <button 
                  title="Replace All"
                  className={`ml-1 p-0.5 rounded cursor-pointer transition-colors shrink-0 ${isDark ? 'text-zinc-400 hover:text-white hover:bg-zinc-700' : 'text-zinc-500 hover:text-black hover:bg-zinc-200'}`}
                >
                  <ReplaceIcon size={14} />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto mt-2 text-sm">
        {isSearching ? (
          <div className="px-6 text-xs text-zinc-500">Searching...</div>
        ) : results.length > 0 ? (
          <div className="flex flex-col">
            {Object.entries(groupedResults).map(([path, pathResults]) => {
              const fileName = path.split(/[\/\\]/).pop() || 'Unknown';
              // Calculate relative path for display if needed, but we can just show filename
              return (
                <div key={path} className="flex flex-col mb-1">
                  <div 
                    className={`flex items-center gap-1.5 px-2 py-1 cursor-pointer select-none group w-full overflow-hidden ${isDark ? 'hover:bg-zinc-800' : 'hover:bg-zinc-200'}`}
                    onClick={() => handleResultClick(path)}
                  >
                    <ChevronDown size={14} className="shrink-0 text-zinc-500" />
                    <File size={14} className="shrink-0 text-blue-400" />
                    <span className="text-xs truncate min-w-0 font-medium" title={path}>{fileName}</span>
                    <span className="text-[10px] text-zinc-500 bg-zinc-800/50 px-1 rounded-full shrink-0">{pathResults.length}</span>
                  </div>
                  <div className="flex flex-col">
                    {pathResults.map((res, i) => (
                      <div 
                        key={i} 
                        className={`flex items-start gap-2 pl-8 pr-2 py-0.5 cursor-pointer text-xs group ${isDark ? 'hover:bg-zinc-800/70 text-zinc-400' : 'hover:bg-zinc-200/70 text-zinc-600'}`}
                        onClick={() => handleResultClick(path)}
                        title={res.text.trim()}
                      >
                        <span className="shrink-0 w-8 text-right text-zinc-500 select-none opacity-50">{res.line}</span>
                        <span className="truncate flex-1 group-hover:text-zinc-200 font-mono text-[11px] mt-[1px]">
                          {renderHighlightedText(res.text.trim(), searchQuery)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : searchQuery.length > 0 ? (
          <div className="px-6 text-xs text-zinc-500">No results found.</div>
        ) : (
          <div className="px-6 text-xs text-zinc-500">Type to search across workspace.</div>
        )}
      </div>
    </div>
  );
}
