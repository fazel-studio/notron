import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ChevronRight, ChevronDown, File, Folder, FolderOpen } from 'lucide-react';
import { useEditorStore } from '../store/editorStore';
import { useUiStore } from '../store/uiStore';
import { ContextMenu, ContextMenuItem } from './ContextMenu';

interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  children?: FileNode[];
}

interface FileTreeProps {
  rootPath: string;
}

const CreationInput = ({ type, parentPath, onComplete, depth }: { type: 'file' | 'folder', parentPath: string, onComplete: () => void, depth: number }) => {
  const [val, setVal] = useState('');
  const handleKeyDown = async (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onComplete();
    if (e.key === 'Enter' && val.trim().length > 0) {
      try {
        const sep = parentPath.includes('\\') ? '\\' : '/';
        const fullPath = `${parentPath}${sep}${val.trim()}`;
        if (type === 'folder') {
          await invoke('create_dir', { path: fullPath });
        } else {
          await invoke('create_file', { path: fullPath });
        }
        useUiStore.getState().triggerExplorerRefresh();
        onComplete();
      } catch (err) {
        alert(err);
      }
    }
  };
  return (
    <div 
      className="flex items-center gap-1.5 px-2 py-1 text-zinc-300 w-full"
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
    >
      <span className="w-3.5 shrink-0 inline-block"></span>
      <span className="shrink-0 text-zinc-400">
        {type === 'folder' ? <Folder size={14} /> : <File size={14} />}
      </span>
      <input 
        autoFocus 
        value={val} 
        onChange={e => setVal(e.target.value)} 
        onKeyDown={handleKeyDown}
        onBlur={onComplete}
        className="flex-1 bg-zinc-800 border border-blue-500 outline-none text-xs px-1 py-0.5 rounded-sm"
      />
    </div>
  );
};

const RenameInput = ({ initialName, node, onComplete, depth }: { initialName: string, node: FileNode, onComplete: () => void, depth: number }) => {
  const [val, setVal] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      if (!node.is_dir) {
        const lastDot = initialName.lastIndexOf('.');
        if (lastDot > 0) {
          inputRef.current.setSelectionRange(0, lastDot);
        } else {
          inputRef.current.select();
        }
      } else {
        inputRef.current.select();
      }
    }
  }, [initialName, node.is_dir]);

  const handleKeyDown = async (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onComplete();
    if (e.key === 'Enter' && val.trim().length > 0 && val !== initialName) {
      try {
        const sep = node.path.includes('\\') ? '\\' : '/';
        const parts = node.path.split(sep);
        parts.pop(); // remove old name
        const newPath = [...parts, val.trim()].join(sep);
        
        await invoke('rename_item', { oldPath: node.path, newPath });
        useUiStore.getState().triggerExplorerRefresh();
        onComplete();
      } catch (err) {
        alert(err);
      }
    } else if (e.key === 'Enter' && val === initialName) {
      onComplete();
    }
  };

  return (
    <div 
      className="flex items-center gap-1.5 px-2 py-1 text-zinc-300 w-full"
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
    >
      <span className="w-3.5 shrink-0 inline-block"></span>
      <span className="shrink-0 text-zinc-400">
        {node.is_dir ? <Folder size={14} /> : <File size={14} />}
      </span>
      <input 
        ref={inputRef}
        value={val} 
        onChange={e => setVal(e.target.value)} 
        onKeyDown={handleKeyDown}
        onBlur={onComplete}
        className="flex-1 bg-zinc-800 border border-blue-500 outline-none text-xs px-1 py-0.5 rounded-sm"
      />
    </div>
  );
};

const TreeNode = ({ node, depth, onFileClick }: { node: FileNode, depth: number, onFileClick: (node: FileNode) => void }) => {
  const { selectedExplorerPath, creatingItem, setCreatingItem, expandedPaths, toggleExpandedPath, renamingItem, setRenamingItem, clipboard, setClipboard, setSelectedExplorerPath } = useUiStore();
  const isExpanded = expandedPaths.includes(node.path);
  const [children, setChildren] = useState<FileNode[] | null>(node.children || null);

  const toggleExpand = async () => {
    if (!isExpanded && (!children || children.length === 0)) {
      try {
        const fullNode = await invoke<FileNode>('read_directory', { path: node.path });
        setChildren(fullNode.children || []);
      } catch (err) {
        console.error(err);
      }
    }
    toggleExpandedPath(node.path, !isExpanded);
  };

  const isCreatingInside = creatingItem?.parentPath === node.path && node.is_dir;
  const isCreatingAsSibling = children?.some(c => c.path === creatingItem?.parentPath && !c.is_dir);
  const shouldRenderCreation = isCreatingInside || isCreatingAsSibling;

  useEffect(() => {
    if (shouldRenderCreation && !isExpanded) {
      toggleExpand();
    }
  }, [shouldRenderCreation]);

  const isSelected = selectedExplorerPath === node.path;
  const isRenaming = renamingItem === node.path;

  const handleCopyPath = () => {
    navigator.clipboard.writeText(node.path);
  };

  const handleCut = () => setClipboard({ path: node.path, type: 'cut' });
  const handleCopy = () => setClipboard({ path: node.path, type: 'copy' });
  const handlePaste = async () => {
    if (!clipboard) return;
    try {
      const sep = node.path.includes('\\') ? '\\' : '/';
      const fileName = clipboard.path.split(sep).pop();
      const targetPath = node.is_dir ? `${node.path}${sep}${fileName}` : (() => {
        const parts = node.path.split(sep);
        parts.pop();
        return [...parts, fileName].join(sep);
      })();
      
      await invoke('copy_item', { srcPath: clipboard.path, dstPath: targetPath });
      if (clipboard.type === 'cut') {
        await invoke('delete_item', { path: clipboard.path });
        setClipboard(null);
      }
      useUiStore.getState().triggerExplorerRefresh();
    } catch (err) {
      alert(err);
    }
  };

  const handleDelete = async () => {
    if (confirm(`Are you sure you want to delete ${node.name}?`)) {
      try {
        await invoke('delete_item', { path: node.path });
        useUiStore.getState().triggerExplorerRefresh();
      } catch (err) {
        alert(err);
      }
    }
  };

  const menuItems: ContextMenuItem[] = node.is_dir ? [
    { id: 'new-file', label: 'New File', action: () => { setCreatingItem({ type: 'file', parentPath: node.path }); toggleExpandedPath(node.path, true); } },
    { id: 'new-folder', label: 'New Folder', action: () => { setCreatingItem({ type: 'folder', parentPath: node.path }); toggleExpandedPath(node.path, true); }, separator: true },
    { id: 'cut', label: 'Cut', shortcut: 'Ctrl+X', action: handleCut },
    { id: 'copy', label: 'Copy', shortcut: 'Ctrl+C', action: handleCopy },
    { id: 'paste', label: 'Paste', shortcut: 'Ctrl+V', action: handlePaste, disabled: !clipboard, separator: true },
    { id: 'copy-path', label: 'Copy Path', shortcut: 'Alt+C', action: handleCopyPath, separator: true },
    { id: 'rename', label: 'Rename', shortcut: 'F2', action: () => setRenamingItem(node.path) },
    { id: 'delete', label: 'Delete', shortcut: 'Del', action: handleDelete }
  ] : [
    { id: 'cut', label: 'Cut', shortcut: 'Ctrl+X', action: handleCut },
    { id: 'copy', label: 'Copy', shortcut: 'Ctrl+C', action: handleCopy, separator: true },
    { id: 'copy-path', label: 'Copy Path', shortcut: 'Alt+C', action: handleCopyPath, separator: true },
    { id: 'rename', label: 'Rename', shortcut: 'F2', action: () => setRenamingItem(node.path) },
    { id: 'delete', label: 'Delete', shortcut: 'Del', action: handleDelete }
  ];

  if (isRenaming) {
    return (
      <RenameInput initialName={node.name} node={node} depth={depth} onComplete={() => setRenamingItem(null)} />
    );
  }

  return (
    <div>
      <ContextMenu items={menuItems}>
        <div 
          className={`flex items-center gap-1.5 px-2 py-1 cursor-pointer select-none group w-full overflow-hidden ${
            isSelected 
              ? 'bg-blue-500/15 border border-blue-500/50 text-zinc-100' 
              : 'hover:bg-zinc-800 text-zinc-300 border border-transparent'
          }`}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          onClick={() => {
            if (node.is_dir) toggleExpand();
            onFileClick(node);
          }}
          onContextMenu={() => {
            // e.preventDefault();
            setSelectedExplorerPath(node.path);
          }}
        >
          {node.is_dir ? (
            <span className="text-zinc-500 shrink-0">
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </span>
          ) : (
            <span className="w-3.5 shrink-0 inline-block"></span>
          )}
          
          <span className={`shrink-0 ${node.is_dir ? "text-blue-400" : (isSelected ? "text-blue-300" : "text-zinc-400 group-hover:text-zinc-200")}`}>
            {node.is_dir ? (isExpanded ? <FolderOpen size={14} /> : <Folder size={14} />) : <File size={14} />}
          </span>
          
          <span className="text-xs truncate min-w-0" title={node.name}>{node.name}</span>
        </div>
      </ContextMenu>
      
      {node.is_dir && isExpanded && (
        <div>
          {shouldRenderCreation && creatingItem?.type === 'folder' && (
            <CreationInput type="folder" parentPath={node.path} onComplete={() => setCreatingItem(null)} depth={depth + 1} />
          )}
          {children?.filter(c => c.is_dir).map(child => (
            <TreeNode key={child.path} node={child} depth={depth + 1} onFileClick={onFileClick} />
          ))}
          {shouldRenderCreation && creatingItem?.type === 'file' && (
            <CreationInput type="file" parentPath={node.path} onComplete={() => setCreatingItem(null)} depth={depth + 1} />
          )}
          {children?.filter(c => !c.is_dir).map(child => (
            <TreeNode key={child.path} node={child} depth={depth + 1} onFileClick={onFileClick} />
          ))}
        </div>
      )}
    </div>
  );
};

export default function FileTree({ rootPath }: FileTreeProps) {
  const [root, setRoot] = useState<FileNode | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const { addTab } = useEditorStore();
  const { setExplorerRoot, explorerRefreshCounter, creatingItem, setCreatingItem, setSelectedExplorerPath, clipboard, setClipboard } = useUiStore();

  useEffect(() => {
    if (rootPath) {
      loadTree(rootPath);
    }
  }, [rootPath, explorerRefreshCounter]);

  const loadTree = async (path: string) => {
    try {
      setErrorMsg(null);
      const node = await invoke<FileNode>('read_directory', { path });
      setRoot(node);
    } catch (err) {
      console.error("Failed to load directory", err);
      setErrorMsg(err as string);
      setTimeout(() => {
        setExplorerRoot(null);
      }, 2000);
    }
  };

  const handleFileClick = async (node: FileNode) => {
    setSelectedExplorerPath(node.path);
    if (node.is_dir) return;

    try {
      const isImage = /\.(png|jpe?g|gif|webp|svg|ico)$/i.test(node.name);
      let content = '';
      if (!isImage) {
        const bytes = await invoke<number[]>('read_file_binary', { path: node.path });
        content = new TextDecoder('utf-8').decode(new Uint8Array(bytes)).replace(/\r\n/g, '\n');
      }
      
      addTab({
        id: node.path,
        path: node.path,
        name: node.name,
        content,
        language: isImage ? 'image' : 'plaintext',
        isPreview: true
      });
    } catch (err) {
      alert("Failed to open file: " + err);
    }
  };

  if (errorMsg) return (
    <div className="p-4 text-xs text-red-500">
      Failed to load: {errorMsg}.<br/><br/>
      Resetting workspace...
    </div>
  );

  if (!root) return <div className="p-4 text-xs text-zinc-500">Loading...</div>;

  const isCreatingAtRoot = creatingItem?.parentPath === rootPath || root.children?.some(c => c.path === creatingItem?.parentPath && !c.is_dir);

  const handlePaste = async () => {
    if (!clipboard) return;
    const state = useUiStore.getState();
    const targetPath = state.selectedExplorerPath || rootPath;
    
    // Find if target is dir
    let isDir = true;
    if (targetPath !== rootPath && root) {
      const findNode = (nodes: FileNode[], path: string): FileNode | null => {
        for (const n of nodes) {
          if (n.path === path) return n;
          if (n.children) {
            const found = findNode(n.children, path);
            if (found) return found;
          }
        }
        return null;
      };
      const node = findNode(root.children || [], targetPath);
      if (node && !node.is_dir) isDir = false;
    }

    try {
      const sep = rootPath.includes('\\') ? '\\' : '/';
      const fileName = clipboard.path.split(sep).pop();
      const actualTargetPath = isDir ? `${targetPath}${sep}${fileName}` : (() => {
        const parts = targetPath.split(sep);
        parts.pop();
        return [...parts, fileName].join(sep);
      })();
      
      await invoke('copy_item', { srcPath: clipboard.path, dstPath: actualTargetPath });
      if (clipboard.type === 'cut') {
        await invoke('delete_item', { path: clipboard.path });
        setClipboard(null);
      }
      useUiStore.getState().triggerExplorerRefresh();
    } catch (err) {
      alert(err);
    }
  };

  const handleCopyPath = () => {
    navigator.clipboard.writeText(useUiStore.getState().selectedExplorerPath || rootPath);
  };

  const handleKeyDown = async (e: React.KeyboardEvent) => {
    if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
    const path = useUiStore.getState().selectedExplorerPath;
    if (!path) return;

    if (e.key === 'F2') {
      useUiStore.getState().setRenamingItem(path);
    } else if (e.key === 'Delete') {
      if (confirm(`Are you sure you want to delete ${path}?`)) {
        try {
          await invoke('delete_item', { path });
          useUiStore.getState().triggerExplorerRefresh();
        } catch (err) {
          alert(err);
        }
      }
    } else if (e.ctrlKey && e.key.toLowerCase() === 'c') {
      useUiStore.getState().setClipboard({ path, type: 'copy' });
    } else if (e.ctrlKey && e.key.toLowerCase() === 'x') {
      useUiStore.getState().setClipboard({ path, type: 'cut' });
    } else if (e.ctrlKey && e.key.toLowerCase() === 'v') {
      handlePaste();
    }
  };

  const rootMenuItems: ContextMenuItem[] = [
    { id: 'new-file', label: 'New File', action: () => setCreatingItem({ type: 'file', parentPath: rootPath }) },
    { id: 'new-folder', label: 'New Folder', action: () => setCreatingItem({ type: 'folder', parentPath: rootPath }), separator: true },
    { id: 'paste', label: 'Paste', shortcut: 'Ctrl+V', action: handlePaste, disabled: !clipboard, separator: true },
    { id: 'copy-path', label: 'Copy Path', shortcut: 'Alt+C', action: handleCopyPath }
  ];

  return (
    <ContextMenu items={rootMenuItems}>
      <div 
        className="flex-1 overflow-y-auto overflow-x-hidden h-full outline-none" 
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onClick={(e) => {
          // If clicking on empty space in the file tree, select the root
          if (e.target === e.currentTarget) {
            setSelectedExplorerPath(rootPath);
          }
        }}
        onContextMenu={() => {
          setSelectedExplorerPath(rootPath);
        }}
      >
        {isCreatingAtRoot && creatingItem?.type === 'folder' && (
          <CreationInput type="folder" parentPath={rootPath} onComplete={() => setCreatingItem(null)} depth={0} />
        )}
        {root.children?.filter(c => c.is_dir).map(child => (
          <TreeNode key={child.path} node={child} depth={0} onFileClick={handleFileClick} />
        ))}
        {isCreatingAtRoot && creatingItem?.type === 'file' && (
          <CreationInput type="file" parentPath={rootPath} onComplete={() => setCreatingItem(null)} depth={0} />
        )}
        {root.children?.filter(c => !c.is_dir).map(child => (
          <TreeNode key={child.path} node={child} depth={0} onFileClick={handleFileClick} />
        ))}
      </div>
    </ContextMenu>
  );
}
