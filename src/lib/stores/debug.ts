import { writable } from 'svelte/store';

export type DebugState = 'idle' | 'running' | 'paused' | 'terminated';
export type DebugSessionMode = 'dap' | 'run' | 'terminal';

export interface Breakpoint {
  id: string;
  file: string;
  line: number;
  verified: boolean;
}

export interface Variable {
  name: string;
  value: string;
  type: string;
  variablesReference: number;
}

export interface CallStackFrame {
  id: number;
  name: string;
  source: { path: string };
  line: number;
  column: number;
}

export interface DebugConfiguration {
  name: string;
  type: string;
  request: 'launch' | 'attach';
  program?: string;
  cwd?: string;
  args?: string[];
  runtimeExecutable?: string;
  runtimeArgs?: string[];
  url?: string;
  port?: number;
  env?: Record<string, string>;
  envFile?: string;
  pythonPath?: string;
  stopOnEntry?: boolean;
  source: 'launch.json' | 'detected';
}

interface DebugStoreState {
  state: DebugState;
  sessionMode: DebugSessionMode | null;
  sessionId: number | null;
  breakpoints: Breakpoint[];
  activeFrame: CallStackFrame | null;
  variables: Variable[];
  callStack: CallStackFrame[];
  configurations: DebugConfiguration[];
  selectedConfigurationName: string | null;
  exceptionBreakpoints: {
    caught: boolean;
    uncaught: boolean;
  };
  lastRunLabel: string | null;
  /** Debug Console output (REPL/evaluate results + program stdout/stderr). */
  consoleLogs: string[];
}

const initialState: DebugStoreState = {
  state: 'idle',
  sessionMode: null,
  sessionId: null,
  breakpoints: [],
  activeFrame: null,
  variables: [],
  callStack: [],
  configurations: [],
  selectedConfigurationName: null,
  exceptionBreakpoints: {
    caught: false,
    uncaught: false
  },
  lastRunLabel: null,
  consoleLogs: []
};

function createDebugStore() {
  const { subscribe, set, update } = writable<DebugStoreState>(initialState);

  return {
    subscribe,
    set,
    update,

    toggleBreakpoint: (file: string, line: number) => {
      update(s => {
        const existingIdx = s.breakpoints.findIndex(b => b.file === file && b.line === line);
        if (existingIdx >= 0) {
          s.breakpoints.splice(existingIdx, 1);
        } else {
          s.breakpoints.push({ id: `${file}:${line}`, file, line, verified: false });
        }
        return s;
      });
    },

    clearBreakpoints: (file?: string) => {
      update(s => {
        if (file) {
          s.breakpoints = s.breakpoints.filter(b => b.file !== file);
        } else {
          s.breakpoints = [];
        }
        return s;
      });
    },

    setConfigurations: (configurations: DebugConfiguration[]) => {
      update(s => {
        const selectedConfigurationName =
          s.selectedConfigurationName && configurations.some(c => c.name === s.selectedConfigurationName)
            ? s.selectedConfigurationName
            : (configurations[0]?.name ?? null);

        return {
          ...s,
          configurations,
          selectedConfigurationName
        };
      });
    },

    selectConfiguration: (name: string | null) => {
      update(s => ({ ...s, selectedConfigurationName: name }));
    },

    setSessionMode: (sessionMode: DebugSessionMode | null) => {
      update(s => ({ ...s, sessionMode }));
    },

    setSessionId: (sessionId: number | null) => {
      update(s => ({ ...s, sessionId }));
    },

    addConsoleOutput: (line: string) => {
      update(s => ({ ...s, consoleLogs: [...s.consoleLogs, line].slice(-2000) }));
    },

    clearConsole: () => {
      update(s => ({ ...s, consoleLogs: [] }));
    },

    setLastRunLabel: (lastRunLabel: string | null) => {
      update(s => ({ ...s, lastRunLabel }));
    },

    setExceptionBreakpoint: (kind: 'caught' | 'uncaught', enabled: boolean) => {
      update(s => ({
        ...s,
        exceptionBreakpoints: {
          ...s.exceptionBreakpoints,
          [kind]: enabled
        }
      }));
    },

    setState: (newState: DebugState) => {
      update(s => ({ ...s, state: newState }));
    },

    setActiveFrame: (frame: CallStackFrame | null) => {
      update(s => ({ ...s, activeFrame: frame }));
    },

    setVariables: (variables: Variable[]) => {
      update(s => ({ ...s, variables }));
    },

    setCallStack: (callStack: CallStackFrame[]) => {
      update(s => ({ ...s, callStack }));
    },

    reset: () => {
      update(s => ({
        ...s,
        state: 'idle',
        sessionMode: null,
        sessionId: null,
        activeFrame: null,
        variables: [],
        callStack: [],
        lastRunLabel: null,
        consoleLogs: []
      }));
    }
  };
}

export const debugStore = createDebugStore();
