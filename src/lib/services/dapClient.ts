import { Channel, invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { debugStore, type DebugConfiguration } from '../stores/debug';
import { editorStore } from '../stores/editor';
import { uiStore } from '../stores/ui';
import { terminalStore } from '../stores/terminal';
import { get } from 'svelte/store';

// ── DAP client ──────────────────────────────────────────────────────────────
// The frontend is the DAP *client* (like VS Code): it owns the protocol state
// machine (initialize → launch → setBreakpoints → configurationDone → step).
// The adapter process and the raw framing live in Rust (§F.5.1). Frames are
// streamed to us over a per-session tauri Channel (ordering guaranteed, §0.3)
// and user requests are forwarded back through `debug_send_message`.

let seqCounter = 1;
const pendingRequests = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>();

async function sendRequest(command: string, args: any = {}) {
  const seq = seqCounter++;
  const payload = {
    seq,
    type: 'request',
    command,
    arguments: args
  };

  const sessionId = get(debugStore).sessionId;
  if (sessionId === null) return Promise.reject(new Error('No active debug session'));

  return new Promise((resolve, reject) => {
    pendingRequests.set(seq, { resolve, reject });
    invoke('debug_send_message', { sessionId, message: JSON.stringify(payload) }).catch(reject);
  });
}

// ── Config helpers (F.2.2 variable substitution, shared run/debug schema) ──

function getWorkspaceRoot() {
  return uiStore.getSnapshot().explorerRoot || '';
}

function getActiveFilePath() {
  const tabs = editorStore.getTabsSnapshot();
  const activeId = editorStore.getActiveTabIdSnapshot();
  const activeTab = tabs.find(t => t.id === activeId) || null;
  if (!activeTab?.path) return null;
  if (activeTab.path.startsWith('Untitled') || activeTab.language === 'welcome') return null;
  return activeTab.path;
}

function dirname(path: string) {
  const normalized = path.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  return idx === -1 ? path : path.slice(0, idx);
}

function basename(path: string) {
  return path.split(/[/\\]/).pop() || path;
}

function basenameNoExt(path: string) {
  const name = basename(path);
  const idx = name.lastIndexOf('.');
  return idx === -1 ? name : name.slice(0, idx);
}

function normalizeToArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(v => String(v));
  if (typeof value === 'string' && value.trim()) return [value];
  return [];
}

function stripJsonComments(input: string) {
  let output = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const next = input[i + 1];

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }

    if (char === '/' && next === '/') {
      while (i < input.length && input[i] !== '\n') i++;
      output += '\n';
      continue;
    }

    if (char === '/' && next === '*') {
      i += 2;
      while (i < input.length && !(input[i] === '*' && input[i + 1] === '/')) i++;
      i++;
      continue;
    }

    output += char;
  }

  return output;
}

function substituteVariables(value: string, workspaceFolder: string, activeFile: string | null) {
  const replaceToken = (input: string, token: string, replacement: string) => input.split(token).join(replacement);
  let resolved = value;
  resolved = replaceToken(resolved, '${workspaceFolder}', workspaceFolder);
  resolved = replaceToken(resolved, '${file}', activeFile || '');
  resolved = replaceToken(resolved, '${fileBasename}', activeFile ? basename(activeFile) : '');
  resolved = replaceToken(resolved, '${fileBasenameNoExtension}', activeFile ? basenameNoExt(activeFile) : '');
  resolved = replaceToken(resolved, '${fileDirname}', activeFile ? dirname(activeFile) : workspaceFolder);
  resolved = replaceToken(resolved, '${relativeFile}', activeFile && workspaceFolder ? activeFile.replace(`${workspaceFolder}\\`, '').replace(`${workspaceFolder}/`, '') : '');
  return value ? resolved : value;
}

function resolveConfiguration(config: DebugConfiguration, workspaceFolder: string, activeFile: string | null): DebugConfiguration {
  const resolveValue = (value?: string) => value ? substituteVariables(value, workspaceFolder, activeFile) : value;
  return {
    ...config,
    program: resolveValue(config.program),
    cwd: resolveValue(config.cwd) || workspaceFolder,
    runtimeExecutable: resolveValue(config.runtimeExecutable),
    runtimeArgs: config.runtimeArgs?.map(arg => substituteVariables(arg, workspaceFolder, activeFile)),
    args: config.args?.map(arg => substituteVariables(arg, workspaceFolder, activeFile)),
    url: resolveValue(config.url),
    env: config.env
      ? Object.fromEntries(Object.entries(config.env).map(([key, value]) => [key, substituteVariables(value, workspaceFolder, activeFile)]))
      : undefined
  };
}

async function openEditorTab(path: string) {
  const name = basename(path);
  const isImage = /\.(png|jpe?g|gif|webp|svg|ico)$/i.test(name);

  if (isImage) {
    editorStore.addTab({ id: path, path, name, content: '', language: 'image', isPreview: false });
    editorStore.setActiveTab(path);
    return;
  }

  let content = '';
  let isLargeFile = false;
  let isPreview = false;

  try {
    content = await invoke<string>('read_file_text', { path });
  } catch (err) {
    if (String(err) === '__LARGE_FILE__') {
      content = '';
      isLargeFile = true;
      isPreview = true;
    } else {
      throw err;
    }
  }

  editorStore.addTab({
    id: path,
    path,
    name,
    content,
    language: isImage ? 'image' : await invoke<string>('detect_language', { path }),
    isPreview,
    isLargeFile
  });
  editorStore.setActiveTab(path);
}

export async function openFileForDebugging() {
  const selected = await openDialog({ multiple: false });
  if (selected && typeof selected === 'string') {
    await openEditorTab(selected);
    await refreshDebugConfigurations();
  }
}

async function readLaunchJson(workspaceFolder: string) {
  if (!workspaceFolder) return null;
  const launchPath = `${workspaceFolder}\\.vscode\\launch.json`;
  try {
    const raw = await invoke<string>('read_file_text', { path: launchPath });
    return { launchPath, raw };
  } catch {
    return null;
  }
}

async function detectConfigurations(workspaceFolder: string, activeFile: string | null): Promise<DebugConfiguration[]> {
  const configs: DebugConfiguration[] = [];
  const launch = await readLaunchJson(workspaceFolder);

  if (launch) {
    try {
      const parsed = JSON.parse(stripJsonComments(launch.raw));
      const parsedConfigs = Array.isArray(parsed?.configurations) ? parsed.configurations : [];
      for (const item of parsedConfigs) {
        if (!item || typeof item !== 'object' || typeof item.name !== 'string' || typeof item.type !== 'string') continue;
        configs.push({
          name: item.name,
          type: item.type,
          request: item.request === 'attach' ? 'attach' : 'launch',
          program: typeof item.program === 'string' ? item.program : undefined,
          cwd: typeof item.cwd === 'string' ? item.cwd : undefined,
          args: normalizeToArray(item.args),
          runtimeExecutable: typeof item.runtimeExecutable === 'string' ? item.runtimeExecutable : undefined,
          runtimeArgs: normalizeToArray(item.runtimeArgs),
          url: typeof item.url === 'string' ? item.url : undefined,
          port: typeof item.port === 'number' ? item.port : undefined,
          env: item.env && typeof item.env === 'object'
            ? Object.fromEntries(Object.entries(item.env).map(([key, value]) => [key, String(value)]))
            : undefined,
          envFile: typeof item.envFile === 'string' ? item.envFile : undefined,
          pythonPath: typeof item.pythonPath === 'string' ? item.pythonPath : undefined,
          stopOnEntry: item.stopOnEntry === true,
          source: 'launch.json'
        });
      }
    } catch (err) {
      uiStore.addToast('launch.json invalid', 'alert', String(err));
    }
  }

  if (activeFile) {
    const lower = activeFile.toLowerCase();
    if (/\.(js|cjs|mjs|ts)$/.test(lower)) {
      configs.push({
        name: 'Launch Current File',
        type: 'node',
        request: 'launch',
        program: activeFile,
        cwd: dirname(activeFile),
        source: 'detected'
      });
    } else if (lower.endsWith('.py')) {
      configs.push({
        name: 'Python: Current File',
        type: 'python',
        request: 'launch',
        program: activeFile,
        cwd: dirname(activeFile),
        source: 'detected'
      });
    }
  }

  return configs;
}

export async function refreshDebugConfigurations() {
  const workspaceFolder = getWorkspaceRoot();
  const activeFile = getActiveFilePath();
  const configurations = await detectConfigurations(workspaceFolder, activeFile);
  debugStore.setConfigurations(configurations);
  return configurations;
}

export async function createLaunchJsonFile() {
  const workspaceFolder = getWorkspaceRoot();
  if (!workspaceFolder) {
    uiStore.addToast('Open a workspace first', 'alert');
    return;
  }

  const vsCodeDir = `${workspaceFolder}\\.vscode`;
  const launchPath = `${vsCodeDir}\\launch.json`;
  const activeFile = getActiveFilePath();
  const template = `{
  // Notron mirrors VS Code's launch.json structure for launch configurations.
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Launch Program",
      "program": "${activeFile ? '${file}' : '${workspaceFolder}\\\\index.js'}",
      "cwd": "${'${workspaceFolder}'}",
      "skipFiles": ["<node_internals>/**"]
    }
  ]
}
`;

  try {
    await invoke('create_directory', { path: vsCodeDir }).catch(() => {});
    await invoke('save_file', { path: launchPath, content: template });
    await openEditorTab(launchPath);
    uiStore.addToast('launch.json created', 'success');
    await refreshDebugConfigurations();
  } catch (err) {
    uiStore.addToast('Failed to create launch.json', 'alert', String(err));
  }
}

function quoteShellArg(arg: string) {
  if (!arg) return '""';
  return /[\s"]/g.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}

// ── Run (without debug): spawn the process in a terminal PTY, no DAP adapter ─
function buildTerminalCommand(config: DebugConfiguration, mode: 'run' | 'debug') {
  const workspaceFolder = getWorkspaceRoot();
  const activeFile = getActiveFilePath();
  const resolved = resolveConfiguration(config, workspaceFolder, activeFile);

  if (resolved.request === 'attach') {
    return { unsupported: `Attach request is not supported yet for "${resolved.name}".` };
  }

  if (resolved.type === 'node' || resolved.type === 'pwa-node' || resolved.type === 'node-terminal') {
    const runtimeExecutable = resolved.runtimeExecutable || 'node';
    const runtimeArgs = [...(resolved.runtimeArgs || [])];
    const args = [...(resolved.args || [])];
    if (!resolved.program) {
      return { unsupported: `Configuration "${resolved.name}" does not define a program.` };
    }

    if (mode === 'debug') {
      runtimeArgs.unshift('--inspect-brk');
    }

    return {
      cwd: resolved.cwd || workspaceFolder,
      label: resolved.name,
      command: [runtimeExecutable, ...runtimeArgs, resolved.program, ...args].map(quoteShellArg).join(' ')
    };
  }

  if (resolved.type === 'python' || resolved.type === 'debugpy') {
    if (!resolved.program) {
      return { unsupported: `Configuration "${resolved.name}" does not define a program.` };
    }

    const executable = resolved.runtimeExecutable || 'python';
    const args = mode === 'debug'
      ? ['-m', 'pdb', resolved.program, ...(resolved.args || [])]
      : [resolved.program, ...(resolved.args || [])];

    return {
      cwd: resolved.cwd || workspaceFolder,
      label: resolved.name,
      command: [executable, ...args].map(quoteShellArg).join(' ')
    };
  }

  if ((resolved.type === 'chrome' || resolved.type === 'pwa-chrome') && resolved.url) {
    return {
      unsupported: `Browser URL launch is not wired yet. Edit launch.json or use the generated Debug URL configuration scaffold.`
    };
  }

  return {
    unsupported: `Configuration type "${resolved.type}" is not supported by Notron yet.`
  };
}

function launchInTerminal(command: string, cwd: string, label: string) {
  terminalStore.newTerminal('powershell', cwd, {
    initialCommand: command,
    name: label
  });
  terminalStore.setActivePanel('terminal');
  debugStore.setSessionMode('terminal');
  debugStore.setLastRunLabel(label);
}

// ── Debug (with DAP): real adapter session driven from Rust ────────────────

function normalizeDebugType(type: string): string {
  if (type === 'pwa-node' || type === 'node-terminal') return 'node';
  if (type === 'debugpy') return 'python';
  return type;
}

async function startDebugSession(config: DebugConfiguration) {
  const workspaceFolder = getWorkspaceRoot();
  const activeFile = getActiveFilePath();
  const resolved = resolveConfiguration(config, workspaceFolder, activeFile);

  if (resolved.request === 'attach') {
    uiStore.addToast('Attach not supported yet', 'alert', `Configuration "${resolved.name}" uses attach.`);
    return;
  }
  if (!resolved.program) {
    uiStore.addToast('Missing program', 'alert', `Configuration "${resolved.name}" does not define a program.`);
    return;
  }

  const channel = new Channel<DebugSessionEvent>();
  channel.onmessage = handleSessionEvent;

  const rustConfig = {
    debugType: normalizeDebugType(resolved.type),
    request: 'launch',
    program: resolved.program,
    cwd: resolved.cwd,
    args: resolved.args || [],
    env: resolved.env,
    envFile: resolved.envFile,
    pythonPath: resolved.pythonPath
  };

  debugStore.setSessionMode('dap');
  debugStore.setState('running');
  debugStore.setVariables([]);
  debugStore.setCallStack([]);
  debugStore.setActiveFrame(null);
  debugStore.clearConsole();

  try {
    const sessionId = await invoke<number>('debug_start_session', { config: rustConfig, channel });
    debugStore.setSessionId(sessionId);

    await sendRequest('initialize', {
      clientID: 'notron',
      clientName: 'Notron Editor',
      adapterID: normalizeDebugType(resolved.type),
      pathFormat: 'path',
      linesStartAt1: true,
      columnsStartAt1: true,
      supportsVariableType: true,
      supportsVariablePaging: true,
      supportsRunInTerminalRequest: true,
      supportsMemoryReferences: true,
      locale: 'en'
    });

    // The rest (launch, breakpoints, exception breakpoints, configurationDone)
    // happens when the adapter emits "initialized" — see handleDapEvent.
    uiStore.setStatus(`Debugging ${resolved.name}`, 2200);
  } catch (e) {
    console.error('Failed to start debug session', e);
    uiStore.addToast('Debug failed to start', 'alert', String(e));
    await stopDebugSession();
  }
}

interface DebugSessionEvent {
  kind: 'dap' | 'output' | 'terminated';
  payload?: string;
  stream?: string;
  line?: string;
  code?: number | null;
}

function handleSessionEvent(event: DebugSessionEvent) {
  switch (event.kind) {
    case 'dap':
      try {
        const payload = JSON.parse(event.payload || '');
        if (payload.type === 'response') {
          const req = pendingRequests.get(payload.request_seq);
          if (req) {
            if (payload.success) req.resolve(payload.body);
            else req.reject(payload.message);
            pendingRequests.delete(payload.request_seq);
          }
        } else if (payload.type === 'event') {
          handleDapEvent(payload);
        }
      } catch {
        // ignore malformed debug frames
      }
      break;
    case 'output':
      debugStore.addConsoleOutput(event.line || '');
      break;
    case 'terminated':
      stopDebugSession();
      break;
  }
}

let initializedHandshake = false;

async function handleDapEvent(payload: any) {
  switch (payload.event) {
    case 'initialized': {
      // F.1.3 / F.4 — Notron is the breakpoint source of truth: re-send all
      // breakpoints & exception filters every time a session starts.
      if (initializedHandshake) return;
      initializedHandshake = true;

      const state = get(debugStore);
      try {
        await sendRequest('launch', {
          program: state.configurations.find(c => c.name === state.selectedConfigurationName)?.program
        });
      } catch {
        // launch args are optional; adapters resolve them from the session.
      }

      try {
        const filters: string[] = [];
        if (state.exceptionBreakpoints.caught) filters.push('all');
        if (state.exceptionBreakpoints.uncaught && !state.exceptionBreakpoints.caught) filters.push('uncaught');
        await sendRequest('setExceptionBreakpoints', { filters });
      } catch {
        // adapter may not support exception breakpoints
      }

      const bpsByFile = new Map<string, typeof state.breakpoints>();
      for (const bp of state.breakpoints) {
        if (!bpsByFile.has(bp.file)) bpsByFile.set(bp.file, []);
        bpsByFile.get(bp.file)!.push(bp);
      }
      for (const [file, bps] of bpsByFile.entries()) {
        try {
          await sendRequest('setBreakpoints', {
            source: { path: file },
            breakpoints: bps.map(b => ({ line: b.line }))
          });
        } catch {
          // ignore per-file failures
        }
      }

      await sendRequest('configurationDone');
      break;
    }
    case 'stopped':
      debugStore.setState('paused');
      fetchStackTrace(payload.body.threadId || 1);
      break;
    case 'continued':
      debugStore.setState('running');
      debugStore.setCallStack([]);
      debugStore.setVariables([]);
      debugStore.setActiveFrame(null);
      break;
    case 'output':
      debugStore.addConsoleOutput(payload.body?.output ?? '');
      break;
    case 'exited':
    case 'terminated':
      stopDebugSession();
      break;
  }
}

async function fetchStackTrace(threadId: number) {
  try {
    const res: any = await sendRequest('stackTrace', { threadId });
    if (res?.stackFrames) {
      debugStore.setCallStack(res.stackFrames);
      if (res.stackFrames.length > 0) {
        debugStore.setActiveFrame(res.stackFrames[0]);
        fetchVariables(res.stackFrames[0].id);
      }
    }
  } catch (e) {
    console.error(e);
  }
}

async function fetchVariables(frameId: number) {
  try {
    const scopesRes: any = await sendRequest('scopes', { frameId });
    if (scopesRes?.scopes?.length) {
      const localScope = scopesRes.scopes[0];
      const varRes: any = await sendRequest('variables', { variablesReference: localScope.variablesReference });
      if (varRes?.variables) {
        debugStore.setVariables(varRes.variables);
      }
    }
  } catch (e) {
    console.error(e);
  }
}

export async function stopDebugSession() {
  await sendRequest('disconnect', { terminateDebuggee: true }).catch(() => {});
  const sessionId = get(debugStore).sessionId;
  if (sessionId !== null) {
    await invoke('debug_stop_session', { sessionId }).catch(() => {});
  }
  debugStore.reset();
}

export async function pauseDebugSession() {
  await sendRequest('pause', { threadId: 1 });
}

export async function stepOver() {
  await sendRequest('next', { threadId: 1 });
  debugStore.setState('running');
}

export async function stepInto() {
  await sendRequest('stepIn', { threadId: 1 });
  debugStore.setState('running');
}

export async function stepOut() {
  await sendRequest('stepOut', { threadId: 1 });
  debugStore.setState('running');
}

export async function continueDebug() {
  await sendRequest('continue', { threadId: 1 });
  debugStore.setState('running');
}

// F.6 #8 — Debug Console is a REPL (DAP `evaluate`) architecturally separate
// from the Integrated Terminal (where a PTY runs the target stdin/stdout).
export async function debugEvaluate(expression: string) {
  const state = get(debugStore);
  if (state.state !== 'paused' || !state.activeFrame) {
    debugStore.addConsoleOutput('Expressions can only be evaluated while the program is paused.');
    return;
  }
  debugStore.addConsoleOutput(expression);
  try {
    const res: any = await sendRequest('evaluate', {
      expression,
      frameId: state.activeFrame.id,
      context: 'repl'
    });
    debugStore.addConsoleOutput(res?.result !== undefined ? String(res.result) : '');
  } catch (e) {
    debugStore.addConsoleOutput(String(e));
  }
}

export async function runSelectedConfiguration(mode: 'run' | 'debug' = 'debug') {
  const workspaceFolder = getWorkspaceRoot();

  if (!workspaceFolder) {
    uiStore.addToast('Open a workspace first', 'alert');
    return;
  }

  const snapshot = get(debugStore);
  if (snapshot.configurations.length === 0) {
    await refreshDebugConfigurations();
  }

  const latest = get(debugStore);
  const selected = latest.configurations.find(c => c.name === latest.selectedConfigurationName) || latest.configurations[0];
  if (!selected) {
    uiStore.addToast('No configuration found', 'alert', 'Open a runnable file or create a launch.json first.');
    return;
  }

  if (mode === 'debug') {
    await startDebugSession(selected);
    return;
  }

  const built = buildTerminalCommand(selected, mode);
  if ('unsupported' in built) {
    uiStore.addToast('Run not available', 'alert', built.unsupported);
    return;
  }

  launchInTerminal(built.command, built.cwd, `Run: ${built.label}`);
  uiStore.setStatus(`Running ${built.label}`, 2200);
}

export async function openJavaScriptDebugTerminal() {
  const workspaceFolder = getWorkspaceRoot();
  terminalStore.newTerminal('powershell', workspaceFolder, {
    initialCommand: 'node inspect',
    name: 'JavaScript Debug'
  });
  terminalStore.setActivePanel('terminal');
  uiStore.setStatus('JavaScript Debug Terminal ready', 2200);
}

export async function prepareDebugUrlConfiguration() {
  const workspaceFolder = getWorkspaceRoot();
  if (!workspaceFolder) {
    uiStore.addToast('Open a workspace first', 'alert');
    return;
  }

  const launchPath = `${workspaceFolder}\\.vscode\\launch.json`;
  const content = `{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "pwa-chrome",
      "request": "launch",
      "name": "Debug URL",
      "url": "http://localhost:3000",
      "webRoot": "${'${workspaceFolder}'}"
    }
  ]
}
`;

  try {
    await invoke('create_directory', { path: `${workspaceFolder}\\.vscode` }).catch(() => {});
    await invoke('save_file', { path: launchPath, content });
    await openEditorTab(launchPath);
    uiStore.addToast('Debug URL scaffold created', 'success');
    await refreshDebugConfigurations();
  } catch (err) {
    uiStore.addToast('Failed to prepare Debug URL', 'alert', String(err));
  }
}

// Legacy entrypoint kept for App.svelte compatibility: since v2 the debug
// transport is a per-session Channel (not a global event), there is nothing to
// pre-register here.
export function setupDapListeners() {}
