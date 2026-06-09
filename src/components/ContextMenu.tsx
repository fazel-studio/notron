import React from 'react';
import * as ContextMenuPrimitive from '@radix-ui/react-context-menu';
import { useSettingsStore } from '../store/settingsStore';

export interface ContextMenuItem {
  id: string;
  label: string;
  action: () => void;
  disabled?: boolean;
  shortcut?: string;
  separator?: boolean;
}

interface ContextMenuProps {
  children: React.ReactNode;
  items: ContextMenuItem[];
}

export function ContextMenu({ children, items }: ContextMenuProps) {
  const isDark = useSettingsStore(state => state.settings.theme === 'dark' || (state.settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches));

  return (
    <ContextMenuPrimitive.Root>
      <ContextMenuPrimitive.Trigger asChild>
        {children}
      </ContextMenuPrimitive.Trigger>

      <ContextMenuPrimitive.Portal>
        <ContextMenuPrimitive.Content
          className={`min-w-[160px] rounded-md border p-1 shadow-md z-50 animate-in fade-in zoom-in-95 duration-100 ${
            isDark 
              ? 'bg-zinc-800 border-zinc-700 text-zinc-200' 
              : 'bg-white border-zinc-200 text-zinc-800'
          }`}
        >
          {items.map((item) => (
            <React.Fragment key={item.id}>
              {item.separator && (
                <ContextMenuPrimitive.Separator
                  className={`h-px my-1 ${isDark ? 'bg-zinc-700' : 'bg-zinc-200'}`}
                />
              )}
              <ContextMenuPrimitive.Item
                disabled={item.disabled}
                onSelect={item.action}
                className={`
                  flex items-center justify-between px-2 py-1.5 text-xs rounded-sm cursor-default select-none outline-none
                  ${item.disabled 
                    ? (isDark ? 'text-zinc-500' : 'text-zinc-400') 
                    : (isDark 
                        ? 'focus:bg-blue-600 focus:text-white' 
                        : 'focus:bg-blue-500 focus:text-white')
                  }
                `}
              >
                <span>{item.label}</span>
                {item.shortcut && (
                  <span className={`ml-auto text-[10px] ${item.disabled ? '' : (isDark ? 'opacity-60' : 'opacity-50')} focus:opacity-100`}>
                    {item.shortcut}
                  </span>
                )}
              </ContextMenuPrimitive.Item>
            </React.Fragment>
          ))}
        </ContextMenuPrimitive.Content>
      </ContextMenuPrimitive.Portal>
    </ContextMenuPrimitive.Root>
  );
}
