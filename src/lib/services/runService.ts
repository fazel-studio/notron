import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { runStore, type RunConfiguration } from '../stores/run';
import { editorStore } from '../stores/editor';
import { uiStore } from '../stores/ui';
import { terminalStore } from '../stores/terminal';
import {
  entryToRunConfig,
  resolveEntries,
  resolvePythonInterpreter,
  type ResolvedEntry
} from './entryPointResolver';
import { get } from 'svelte/store';

// ── Run service ─────────────────────────────────────────────────────────────
// Runs a launch configuration in the integrated terminal (PTY).

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

function resolveConfiguration(config: RunConfiguration, workspaceFolder: string, activeFile: string | null): RunConfiguration {
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
  const isImage = /\.(png|jpe?g|gif|webp|ico)$/i.test(name);

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

export async function openFileForRunning() {
  const selected = await openDialog({ multiple: false });
  if (selected && typeof selected === 'string') {
    await openEditorTab(selected);
    await refreshRunConfigurations();
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

async function detectConfigurations(workspaceFolder: string, activeFile: string | null): Promise<RunConfiguration[]> {
  const configs: RunConfiguration[] = [];
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
          source: 'launch.json'
        });
      }
    } catch (err) {
      uiStore.addToast('launch.json invalid', 'alert', String(err));
    }
  }

  // ── Entry point resolution engine (manifest → framework → heuristic).
  // Replaces the old hardcoded extension check: reads package.json / pyproject
  // BEFORE guessing filenames, so "src/index.js" is honored over a root one.
  const activeDir = activeFile ? dirname(activeFile) : undefined;
  const resolved = await resolveEntries(workspaceFolder, activeDir);
  const resolvedConfigs = resolved.map(entryToRunConfig);

  // For Python we can pin the venv interpreter for the *manifest* entries so
  // the program runs in the same environment the developer uses.
  const pythonEntries = resolved.filter(e => e.type === 'python' && e.program);
  if (pythonEntries.length > 0) {
    const py = await resolvePythonInterpreter(workspaceFolder);
    if (py !== 'python') {
      for (const cfg of resolvedConfigs) {
        if (cfg.type === 'python') cfg.pythonPath = py;
      }
    }
  }

  // ── Active file fallback (only for explicit "Current File" runs).
  // Collected separately and appended last — it is the weakest tier.
  const currentFileConfigs: RunConfiguration[] = [];
  if (activeFile) {
    const lower = activeFile.toLowerCase();
    if (/\.(js|cjs|mjs|ts)$/.test(lower)) {
      currentFileConfigs.push({
        name: 'Launch Current File',
        type: 'node',
        request: 'launch',
        program: activeFile,
        cwd: dirname(activeFile),
        source: 'detected',
        detectedTier: 'active'
      });
    } else if (lower.endsWith('.py')) {
      currentFileConfigs.push({
        name: 'Python: Current File',
        type: 'python',
        request: 'launch',
        program: activeFile,
        cwd: dirname(activeFile),
        source: 'detected',
        detectedTier: 'active'
      });
    } else if (lower.endsWith('.go')) {
      currentFileConfigs.push({
        name: 'Go: Current File',
        type: 'go',
        request: 'launch',
        program: activeFile,
        cwd: dirname(activeFile),
        source: 'detected',
        detectedTier: 'active'
      });
    } else if (lower.endsWith('.rb')) {
      currentFileConfigs.push({
        name: 'Ruby: Current File',
        type: 'ruby',
        request: 'launch',
        program: activeFile,
        cwd: dirname(activeFile),
        source: 'detected',
        detectedTier: 'active'
      });
    }
  }

  // Confidence order: launch.json (explicit) → engine (manifest /
  // framework / heuristic) → "Current File" fallback. Dedup by (type + program)
  // while never collapsing framework dev-servers that have no program file.
  const ordered = [...configs, ...resolvedConfigs, ...currentFileConfigs];
  return ordered.filter((cfg, i, arr) => {
    if (!cfg.program) return true;
    const sig = `${cfg.type}|${cfg.program}`;
    // keep the first occurrence → launch.json/manifest precedence is preserved.
    return arr.findIndex(c => `${c.type}|${c.program}` === sig) === i;
  });
}

export async function refreshRunConfigurations() {
  const workspaceFolder = getWorkspaceRoot();
  const activeFile = getActiveFilePath();
  const configurations = await detectConfigurations(workspaceFolder, activeFile);
  runStore.setConfigurations(configurations);
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
    await refreshRunConfigurations();
  } catch (err) {
    uiStore.addToast('Failed to create launch.json', 'alert', String(err));
  }
}

/**
 * "Save as launch configuration": lift an auto-detected entry point
 * into an explicit launch.json entry so the heuristic can never be re-guessed.
 */
export async function saveResolvedEntryAsConfig(entry: ResolvedEntry) {
  const workspaceFolder = getWorkspaceRoot();
  if (!workspaceFolder) {
    uiStore.addToast('Open a workspace first', 'alert');
    return;
  }

  const vsCodeDir = `${workspaceFolder}\\.vscode`;
  const launchPath = `${vsCodeDir}\\launch.json`;
  const program = entry.program || '${workspaceFolder}\\index.js';
  const type = entry.type; // node | python | go | ruby

  const current = await readLaunchJson(workspaceFolder);
  let configurations: any[];
  if (current) {
    try {
      configurations = JSON.parse(stripJsonComments(current.raw)).configurations || [];
    } catch {
      configurations = [];
    }
  } else {
    configurations = [];
  }

  // Avoid duplicates by (type + program)
  if (!configurations.some(c => c && c.program === program && c.type === type)) {
    const entryCfg: Record<string, unknown> = {
      type,
      request: 'launch',
      name: entry.name,
      program,
      cwd: entry.cwd || '${workspaceFolder}'
    };
    // Preserve framework dev-server commands so they stay runnable.
    if (entry.command) entryCfg['runtimeExecutable'] = entry.command;
    configurations.push(entryCfg);
  }

  const body = {
    version: '0.2.0',
    configurations
  };

  try {
    await invoke('create_directory', { path: vsCodeDir }).catch(() => {});
    await invoke('save_file', { path: launchPath, content: JSON.stringify(body, null, 2) });
    uiStore.addToast(`${entry.name} saved to launch.json`, 'success');
    await refreshRunConfigurations();
  } catch (err) {
    uiStore.addToast('Failed to save configuration', 'alert', String(err));
  }
}

function quoteShellArg(arg: string) {
  if (!arg) return '""';
  return /[\s"]/g.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}

// ── Run: spawn the process in a terminal PTY ───────────────────────────────

function buildTerminalCommand(config: RunConfiguration) {
  const workspaceFolder = getWorkspaceRoot();
  const activeFile = getActiveFilePath();
  const resolved = resolveConfiguration(config, workspaceFolder, activeFile);

  if (resolved.request === 'attach') {
    return { unsupported: `Attach request is not supported yet for "${resolved.name}".` };
  }

  // Framework dev-server entries carry a `command` hint the resolver
  // produced (e.g. "next dev", "vite", "python manage.py runserver"). Their
  // `program` may be empty — run the command directly in the terminal.
  if (config.command) {
    return {
      cwd: config.cwd || workspaceFolder,
      label: config.name,
      command: config.command
    };
  }

  if (resolved.type === 'node' || resolved.type === 'pwa-node' || resolved.type === 'node-terminal') {
    const runtimeExecutable = resolved.runtimeExecutable || 'node';
    const runtimeArgs = [...(resolved.runtimeArgs || [])];
    const args = [...(resolved.args || [])];
    if (!resolved.program) {
      return { unsupported: `Configuration "${resolved.name}" does not define a program.` };
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
    const args = [resolved.program, ...(resolved.args || [])];

    return {
      cwd: resolved.cwd || workspaceFolder,
      label: resolved.name,
      command: [executable, ...args].map(quoteShellArg).join(' ')
    };
  }

  // Go: `go run <file>`
  if (resolved.type === 'go') {
    if (!resolved.program) {
      return { unsupported: `Configuration "${resolved.name}" does not define a program.` };
    }
    return {
      cwd: resolved.cwd || workspaceFolder,
      label: resolved.name,
      command: ['go', 'run', resolved.program, ...(resolved.args || [])].map(quoteShellArg).join(' ')
    };
  }

  // Ruby: `ruby <file>`
  if (resolved.type === 'ruby' || resolved.type === 'rdbg') {
    if (!resolved.program) {
      return { unsupported: `Configuration "${resolved.name}" does not define a program.` };
    }
    const executable = resolved.runtimeExecutable || 'ruby';
    return {
      cwd: resolved.cwd || workspaceFolder,
      label: resolved.name,
      command: [executable, resolved.program, ...(resolved.args || [])].map(quoteShellArg).join(' ')
    };
  }

  // Rust/Cargo: `cargo run` (root package)
  if (resolved.type === 'rust') {
    return {
      cwd: resolved.cwd || workspaceFolder,
      label: resolved.name,
      command: ['cargo', 'run', ...(resolved.args || [])].map(quoteShellArg).join(' ')
    };
  }

  // Deno: `deno run <file>`
  if (resolved.type === 'deno') {
    if (!resolved.program) {
      return { unsupported: `Configuration "${resolved.name}" does not define a program.` };
    }
    return {
      cwd: resolved.cwd || workspaceFolder,
      label: resolved.name,
      command: ['deno', 'run', resolved.program, ...(resolved.args || [])].map(quoteShellArg).join(' ')
    };
  }

  if ((resolved.type === 'chrome' || resolved.type === 'pwa-chrome') && resolved.url) {
    return {
      unsupported: `Browser URL launch is not wired yet. Edit launch.json to configure the URL.`
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
  runStore.setLastRunLabel(label);
}

export async function runSelectedConfiguration() {
  const workspaceFolder = getWorkspaceRoot();

  if (!workspaceFolder) {
    uiStore.addToast('Open a workspace first', 'alert');
    return;
  }

  const snapshot = get(runStore);
  if (snapshot.configurations.length === 0) {
    await refreshRunConfigurations();
  }

  const latest = get(runStore);
  const selected = latest.configurations.find(c => c.name === latest.selectedConfigurationName) || latest.configurations[0];
  if (!selected) {
    uiStore.addToast('No configuration found', 'alert', 'Open a runnable file or create a launch.json first.');
    return;
  }

  const built = buildTerminalCommand(selected);
  if ('unsupported' in built) {
    uiStore.addToast('Run not available', 'alert', built.unsupported);
    return;
  }

  launchInTerminal(built.command, built.cwd, `Run: ${built.label}`);
  uiStore.setStatus(`Running ${built.label}`, 2200);
}
