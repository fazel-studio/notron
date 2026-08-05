import { writable } from 'svelte/store';

export type TerminalType = 'powershell' | 'cmd';

export interface TerminalInstance {
  id: string;
  name: string;
  type: TerminalType;
  cwd: string;
}

interface TerminalState {
  terminals: TerminalInstance[];
  activeTerminalId: string | null;
  isVisible: boolean;
  isMaximized: boolean;
  height: number;
  isResizing: boolean;
  activePanel: 'problems' | 'output' | 'terminal';
  outputLogs: string[];
}

function createTerminalStore() {
  const state = writable<TerminalState>({
    terminals: [],
    activeTerminalId: null,
    isVisible: typeof window !== 'undefined' ? localStorage.getItem('terminal_isVisible') === 'true' : false,
    isMaximized: typeof window !== 'undefined' ? localStorage.getItem('terminal_isMaximized') === 'true' : false,
    height: typeof window !== 'undefined' ? parseInt(localStorage.getItem('terminal_height') || '250', 10) : 250,
    isResizing: false,
    activePanel: 'terminal',
    outputLogs: []
  });

  function update(fn: (s: TerminalState) => Partial<TerminalState>) {
    state.update(s => ({ ...s, ...fn(s) }));
  }

  return {
    subscribe: state.subscribe,
    newTerminal: (type: TerminalType = 'powershell', cwd: string = '') => {
      state.update(s => {
        const id = `term-${Date.now()}`;
        const name = type === 'powershell' ? 'PowerShell' : 'Command Prompt';
        const newTerm = { id, name: `${name} ${s.terminals.length + 1}`, type, cwd };
        localStorage.setItem('terminal_isVisible', 'true');
        return {
          ...s,
          terminals: [...s.terminals, newTerm],
          activeTerminalId: id,
          isVisible: true
        };
      });
    },
    closeTerminal: (id: string) => {
      state.update(s => {
        const filtered = s.terminals.filter(t => t.id !== id);
        let activeId = s.activeTerminalId;
        if (activeId === id) {
          activeId = filtered.length > 0 ? filtered[0].id : null;
        }
        const v = filtered.length > 0 ? s.isVisible : false;
        if (s.isVisible !== v) localStorage.setItem('terminal_isVisible', String(v));
        return {
          ...s,
          terminals: filtered,
          activeTerminalId: activeId,
          isVisible: v
        };
      });
    },
    setTerminals: (terminals: TerminalInstance[], activeTerminalId: string | null) => update(() => ({ terminals, activeTerminalId })),
    setActive: (id: string) => update(() => ({ activeTerminalId: id })),
    setActivePanel: (panel: 'problems' | 'output' | 'terminal') => {
      state.update(s => {
        localStorage.setItem('terminal_isVisible', 'true');
        return { ...s, activePanel: panel, isVisible: true };
      });
    },
    addOutputLog: (log: string) => update(s => {
      const ts = new Date().toISOString().replace('T', ' ').substring(0, 23);
      return { outputLogs: [...s.outputLogs, `${ts} [info] ${log}`] };
    }),
    clearOutput: () => update(() => ({ outputLogs: [] })),
    setResizing: (val: boolean) => update(() => ({ isResizing: val })),
    toggleVisibility: () => state.update(s => {
      const v = !s.isVisible;
      localStorage.setItem('terminal_isVisible', String(v));
      return { ...s, isVisible: v };
    }),
    setVisibility: (visible: boolean) => update(() => {
      localStorage.setItem('terminal_isVisible', String(visible));
      return { isVisible: visible };
    }),
    toggleMaximize: () => state.update(s => {
      const v = !s.isMaximized;
      localStorage.setItem('terminal_isMaximized', String(v));
      return { ...s, isMaximized: v };
    }),
    setMaximize: (val: boolean) => update(() => {
      localStorage.setItem('terminal_isMaximized', String(val));
      return { isMaximized: val };
    }),
    setHeight: (h: number) => update(() => {
      localStorage.setItem('terminal_height', String(h));
      return { height: h };
    }),
    getSnapshot: (): TerminalState => {
      let val: TerminalState = null!;
      state.subscribe(v => val = v)();
      return val;
    },
    initFromState: (savedState: TerminalState) => {
      state.set(savedState);
    },
    initFromStorage: () => {
      const isVisible = localStorage.getItem('terminal_isVisible') === 'true';
      const isMaximized = localStorage.getItem('terminal_isMaximized') === 'true';
      const height = parseInt(localStorage.getItem('terminal_height') || '250', 10);
      update(() => ({ isVisible, isMaximized, height }));
    }
  };
}

export const terminalStore = createTerminalStore();
