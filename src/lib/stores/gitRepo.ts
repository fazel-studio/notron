import { writable } from 'svelte/store';
import { listen } from '@tauri-apps/api/event';
import {
  getGitAvailability, getRepoState, getGitLog,
  initRepo, stageFile, stageAll, unstageFile, unstageAll,
  commit, discardFile, runNetworkOp, cancelOp,
  type GitAvailability, type RepoState, type GitLogEntry,
  type GitProgress,
} from '../services/git';

// Module D — cwd-aware Git repository store. Owns the source-control panel
// state (detection → repo state → log → operations) and reacts to the Rust
// watcher's `git-status-refresh` event instead of polling.

interface RepoUiState {
  availability: GitAvailability;
  availabilityLoading: boolean;
  repo: RepoState | null;
  repoLoading: boolean;
  commits: GitLogEntry[];
  commitsLoading: boolean;
  committing: boolean;
  syncing: boolean;
  syncingOp: string | null;      // op_id of the running push/pull/fetch
  progress: GitProgress | null;
  lastError: string | null;
  cwd: string | null;
}

function createGitRepoStore() {
  const { subscribe, update, set } = writable<RepoUiState>({
    availability: { status: 'Unknown', path: null, version: null, source: '' },
    availabilityLoading: false,
    repo: null,
    repoLoading: false,
    commits: [],
    commitsLoading: false,
    committing: false,
    syncing: false,
    syncingOp: null,
    progress: null,
    lastError: null,
    cwd: null,
  });

  let _cwd: string | null = null;
  let _opId: string | null = null;
  let refreshRepoTimeout: any = null;
  let unlistenStatus: (() => void) | null = null;
  let statusInFlight = false;

  function patch(p: Partial<RepoUiState>) {
    update(s => ({ ...s, ...p }));
  }

  async function detect() {
    patch({ availabilityLoading: true, lastError: null });
    try {
      const availability = await getGitAvailability();
      patch({ availability, availabilityLoading: false });
      return availability;
    } catch (e) {
      patch({ availabilityLoading: false, lastError: String(e) });
      return null;
    }
  }

  async function refreshRepo(cwd: string) {
    if (!cwd) return;
    
    if (refreshRepoTimeout) clearTimeout(refreshRepoTimeout);
    
    return new Promise<void>((resolve) => {
      refreshRepoTimeout = setTimeout(async () => {
        if (statusInFlight) {
          resolve();
          return;
        }
        statusInFlight = true;
        patch({ repoLoading: true, lastError: null });
        try {
          const repo = await getRepoState(cwd);
          patch({ repo, repoLoading: false, cwd });
        } catch (e) {
          patch({ repoLoading: false, lastError: String(e) });
        } finally {
          statusInFlight = false;
          resolve();
        }
      }, 300); // 300ms inherent debounce for ALL callers
    });
  }

  async function refreshCommits(cwd: string) {
    if (!cwd) return;
    patch({ commitsLoading: true });
    try {
      const commits = await getGitLog(cwd, 50);
      patch({ commits, commitsLoading: false });
    } catch {
      patch({ commitsLoading: false });
    }
  }

  async function setWorkspace(cwd: string | null) {
    if (cwd === _cwd) return;
    _cwd = cwd;

    const { terminalStore } = await import('./terminal');
    terminalStore.addOutputLog(`[main] Log level: Info`);

    if (!cwd) {
      patch({ repo: null, commits: [], syncingOp: null, progress: null, cwd: null });
      return;
    }
    patch({ cwd, repo: null, commits: [] });
    const availability = await detect();
    if (availability?.status === 'Available') {
      terminalStore.addOutputLog(`[main] Validating found git in: "${availability.path}"`);
      terminalStore.addOutputLog(`[main] Using git "${availability.version}" from "${availability.path}"`);
      terminalStore.addOutputLog(`[Model][doInitialScan] Initial repository scan started`);

      await refreshRepo(cwd);
      await refreshCommits(cwd);

      // Count repositories
      let repCount = 0;
      subscribe(s => { if (s.repo && s.repo.status === 'Repo') repCount = 1; })();
      terminalStore.addOutputLog(`[Model][doInitialScan] Initial repository scan completed - repositories (${repCount}), closed repositories (0), parent repositories (0), unsafe repositories (0)`);
    } else {
      patch({ repo: null, repoLoading: false });
    }
  }

  return {
    subscribe,

    init: () => {
      if (unlistenStatus) return;
      let timeoutId: any = null;

      // D.7 — react to Rust watcher's git-status-refresh event.
      // Debounce: 400ms (VSCode-equivalent responsiveness).
      // Fast-path: if gitignoreChanged, refresh immediately because
      // gitignore changes directly alter which files are tracked/untracked.
      listen<{ gitignoreChanged?: boolean }>('git-status-refresh', (e) => {
        if (!_cwd) return;
        const payload = e.payload ?? {};
        if (payload.gitignoreChanged) {
          // No extra debounce — gitignore change means git status changed NOW.
          if (timeoutId) clearTimeout(timeoutId);
          refreshRepo(_cwd);
        } else {
          if (timeoutId) clearTimeout(timeoutId);
          timeoutId = setTimeout(() => {
            refreshRepo(_cwd!);
          }, 400);
        }
      }).then(un => (unlistenStatus = un));
      
      listen<string>('git-output', async (e) => {
        const { terminalStore } = await import('./terminal');
        terminalStore.addOutputLog(e.payload, 'info');
      });
      listen<string>('git-output-warning', async (e) => {
        const { terminalStore } = await import('./terminal');
        terminalStore.addOutputLog(e.payload, 'warning');
      });
    },

    setWorkspace,

    async reDetect() {
      const { reDetectGit } = await import('../services/git');
      patch({ availabilityLoading: true });
      try {
        const availability = await reDetectGit();
        patch({ availability, availabilityLoading: false });
        if (_cwd) {
          await refreshRepo(_cwd);
          await refreshCommits(_cwd);
        }
      } catch (e) {
        patch({ availabilityLoading: false, lastError: String(e) });
      }
    },

    async setManualPath(path: string) {
      const { setGitManualPath } = await import('../services/git');
      patch({ availabilityLoading: true });
      try {
        const availability = await setGitManualPath(path);
        patch({ availability, availabilityLoading: false });
        if (availability.status === 'Available' && _cwd) {
          await refreshRepo(_cwd);
          await refreshCommits(_cwd);
        }
      } catch (e) {
        patch({ availabilityLoading: false, lastError: String(e) });
      }
    },

    refresh: async () => {
      if (_cwd) {
        await refreshRepo(_cwd);
        await refreshCommits(_cwd);
      }
    },

    refreshRepoOnly: async () => {
      if (_cwd) await refreshRepo(_cwd);
    },

    async initRepo() {
      if (!_cwd) return;
      try {
        await initRepo(_cwd);
        await refreshRepo(_cwd);
      } catch (e) {
        patch({ lastError: String(e) });
      }
    },

    async stage(path: string) {
      if (!_cwd) return;
      try {
        await stageFile(_cwd, path);
        await refreshRepo(_cwd);
      } catch (e) {
        patch({ lastError: String(e) });
      }
    },

    async unstage(path: string) {
      if (!_cwd) return;
      try {
        await unstageFile(_cwd, path);
        await refreshRepo(_cwd);
      } catch (e) {
        patch({ lastError: String(e) });
      }
    },

    async stageAll() {
      if (!_cwd) return;
      try {
        await stageAll(_cwd);
        await refreshRepo(_cwd);
      } catch (e) {
        patch({ lastError: String(e) });
      }
    },

    async unstageAll() {
      if (!_cwd) return;
      try {
        await unstageAll(_cwd);
        await refreshRepo(_cwd);
      } catch (e) {
        patch({ lastError: String(e) });
      }
    },

    async commit(message: string) {
      if (!_cwd || !message.trim()) return false;
      patch({ committing: true, lastError: null });
      try {
        await commit(_cwd, message);
        patch({ committing: false });
        await refreshRepo(_cwd);
        await refreshCommits(_cwd);
        return true;
      } catch (e) {
        patch({ committing: false, lastError: String(e) });
        return false;
      }
    },

    async discard(path: string) {
      if (!_cwd) return;
      try {
        await discardFile(_cwd, path);
        await refreshRepo(_cwd);
      } catch (e) {
        patch({ lastError: String(e) });
      }
    },

    /** Run push/pull/fetch with progress + cancel. Resolves when done. */
    async sync(command: 'git_push' | 'git_pull' | 'git_fetch', label: string) {
      if (!_cwd) return false;
      const opId = `${label}-${Date.now()}`;
      _opId = opId;
      patch({ syncing: true, syncingOp: opId, progress: null, lastError: null });
      try {
        const handle = runNetworkOp(command, _cwd, opId, (progress) => {
          patch({ progress });
        });
        await handle.promise;
        _opId = null;
        patch({ syncing: false, syncingOp: null, progress: null });
        await refreshRepo(_cwd);
        await refreshCommits(_cwd);
        return true;
      } catch (e) {
        _opId = null;
        patch({ syncing: false, syncingOp: null, progress: null, lastError: String(e) });
        return false;
      }
    },

    async cancelSync() {
      if (_opId) {
        await cancelOp(_opId);
        _opId = null;
        patch({ syncing: false, syncingOp: null, progress: null });
      }
    },

    clearError: () => patch({ lastError: null }),
    set: (s: RepoUiState) => set(s),
  };
}

export const gitRepoStore = createGitRepoStore();
