import { useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import mermaid from 'mermaid';
import { useSettingsStore } from '../store/settingsStore';
import { useEditorStore } from '../store/editorStore';

mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  securityLevel: 'loose',
});

interface MarkdownPreviewProps {
  path: string;
}

export default function MarkdownPreview({ path }: MarkdownPreviewProps) {
  const settings = useSettingsStore(state => state.settings);
  const isDark = settings.theme === 'dark' || (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  
  // Find the original tab to get the latest content (if it's open), otherwise fallback
  const content = useEditorStore(state => {
    const originalTab = state.tabs.find(t => t.path === path && t.language !== 'markdown-preview');
    return originalTab ? originalTab.content : state.tabs.find(t => t.path === path)?.content || '';
  });

  useEffect(() => {
    mermaid.initialize({
      theme: isDark ? 'dark' : 'default',
    });
    const timer = setTimeout(() => {
      try {
        mermaid.run({
          nodes: document.querySelectorAll('.mermaid'),
        });
      } catch (e) {
        console.error(e);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [content, isDark]);

  return (
    <div className={`w-full h-full p-6 overflow-y-auto ${isDark ? 'bg-[#1e1e1e] text-zinc-300' : 'bg-white text-zinc-900'} prose ${isDark ? 'prose-invert' : ''} max-w-none`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ node, inline, className, children, ...props }: any) {
            const match = /language-(\w+)/.exec(className || '');
            if (!inline && match && match[1] === 'mermaid') {
              return (
                <div className="mermaid">
                  {String(children).replace(/\n$/, '')}
                </div>
              );
            }
            if (inline) {
              return (
                <code 
                  className={`px-1.5 py-0.5 rounded text-[0.85em] font-mono whitespace-pre-wrap border ${isDark ? 'bg-black border-zinc-600 text-blue-400 shadow-sm' : 'bg-zinc-200 border-zinc-400 text-blue-700'} before:hidden after:hidden`} 
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
          pre({ children, ...props }: any) {
            return (
              <pre className={`p-4 rounded-lg overflow-x-auto border ${isDark ? 'bg-[#0d0d0d] border-zinc-800' : 'bg-zinc-50 border-zinc-200'}`} {...props}>
                {children}
              </pre>
            );
          }
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
