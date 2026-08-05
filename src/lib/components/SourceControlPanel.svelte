<script lang="ts">
  import { uiStore } from '../stores/ui';
  import { editorStore } from '../stores/editor';
  import { invoke } from '@tauri-apps/api/core';
  import { onMount } from 'svelte';
  import { gitRepoStore } from '../stores/gitRepo';
  import type { GitFileStatus } from '../services/git';
  import { Plus, Minus, RefreshCw, Upload, Download, Loader2, FileText, ChevronDown, ChevronRight, GitBranch, MoreHorizontal, Target, Cloud, Undo2, Settings, X } from 'lucide-svelte';
  import Tooltip from './Tooltip.svelte';
  import { getFileIcon } from './TreeNode.svelte';
  import { settingsStore } from '../stores/settings.svelte';

  const ui = uiStore;

  let isCommitting = $state(false);
  let commitMessage = $state('');

  // Manual git path UI (D.1)
  let showManualPath = $state(false);
  let manualPathInput = $state('');

  // Split view states
  let changesVisible = $state(true);
  let graphVisible = $state(true);
  let changesFlex = $state(1);
  let graphFlex = $state(1);
  let isResizing = $state(false);

  let availability = $derived($gitRepoStore.availability);
  let repo = $derived($gitRepoStore.repo);
  let commits = $derived($gitRepoStore.commits);
  let lastError = $derived($gitRepoStore.lastError);
  let syncing = $derived($gitRepoStore.syncing);
  let progress = $derived($gitRepoStore.progress);
  let repoLoading = $derived($gitRepoStore.repoLoading);
  let availabilityLoading = $derived($gitRepoStore.availabilityLoading);

  const isGitInstalled = $derived(availability.status === 'Available');
  const isRepo = $derived(repo?.status === 'Repo');

  function startResize(e: MouseEvent) {
    isResizing = true;
    e.preventDefault();
  }

  function onMouseMove(e: MouseEvent) {
    if (!isResizing) return;
    const container = document.getElementById('sc-container');
    if (!container) return;
    const rect = container.getBoundingClientRect();
    let ratio = (e.clientY - rect.top) / rect.height;
    if (ratio < 0.1) ratio = 0.1;
    if (ratio > 0.9) ratio = 0.9;
    changesFlex = ratio;
    graphFlex = 1 - ratio;
  }

  function onMouseUp() {
    isResizing = false;
  }

  async function handleInit() {
    if (!$ui.explorerRoot) return;
    await gitRepoStore.initRepo();
    await gitRepoStore.refresh();
  }

  async function handleCommit() {
    if (!commitMessage.trim()) return;
    isCommitting = true;
    const ok = await gitRepoStore.commit(commitMessage);
    isCommitting = false;
    if (ok) commitMessage = '';
  }

  async function handleStage(file: GitFileStatus) {
    await gitRepoStore.stage(file.path);
  }

  async function handleUnstage(file: GitFileStatus) {
    await gitRepoStore.unstage(file.path);
  }

  async function handleStageAll() {
    await gitRepoStore.stageAll();
  }

  async function handleUnstageAll() {
    await gitRepoStore.unstageAll();
  }

  async function handleDiscard(file: GitFileStatus) {
    if (!confirm(`Discard changes to ${file.path}? This cannot be undone.`)) return;
    await gitRepoStore.discard(file.path);
  }

  async function handlePush() {
    const ok = await gitRepoStore.sync('git_push', 'push');
    if (ok) uiStore.addToast('Git Push', 'success', 'Successfully pushed to remote');
  }

  async function handlePull() {
    const ok = await gitRepoStore.sync('git_pull', 'pull');
    if (ok) {
      uiStore.addToast('Git Pull', 'success', 'Successfully pulled from remote');
    }
  }

  async function handleFetch() {
    const ok = await gitRepoStore.sync('git_fetch', 'fetch');
    if (ok) uiStore.addToast('Git Fetch', 'success', 'Fetched from remote');
  }

  async function handleCancelSync() {
    await gitRepoStore.cancelSync();
  }

  async function handleRedetect() {
    await gitRepoStore.reDetect();
  }

  function openManualPathSettings() {
    showManualPath = !showManualPath;
    manualPathInput = availability.path || '';
  }

  async function saveManualPath() {
    await gitRepoStore.setManualPath(manualPathInput.trim());
    showManualPath = false;
  }

  async function clearManualPath() {
    await gitRepoStore.setManualPath('');
    showManualPath = false;
  }

  import { getGitFileContent } from '../services/git';

  async function openFile(file: GitFileStatus) {
    if (!$ui.explorerRoot) return;
    const fullPath = `${$ui.explorerRoot}/${file.path}`;
    const name = file.path.split('/').pop() || file.path;

    let originalContent = '';
    if (file.status !== 'U' && file.status !== 'A') {
      originalContent = await getGitFileContent($ui.explorerRoot, file.path, "HEAD");
    }

    const tabId = fullPath + "-diff";

    editorStore.addTab({ 
      id: tabId, 
      path: fullPath, 
      name: `${name} (Working Tree)`, 
      content: null, 
      language: 'plaintext', 
      isPreview: true, 
      isLoading: true,
      isDiff: true,
      diffOriginalContent: originalContent
    });

    invoke<string>('read_file_text', { path: fullPath }).then((content) => {
      editorStore.setInitialContent(tabId, content);
    }).catch(err => {
      console.error(err);
      editorStore.setInitialContent(tabId, '');
      editorStore.setTabLoading(tabId, false);
    });
  }

  const statusCodeColor = (code: string) => {
    if (code === 'A' || code === 'U' || code === 'R' || code === 'C') return 'text-green-500';
    if (code === 'M') return 'text-yellow-500';
    if (code === 'D') return 'text-red-500';
    if (code === 'Conflict') return 'text-purple-500';
    return 'text-muted';
  };

  onMount(() => {
    gitRepoStore.init();
    gitRepoStore.setWorkspace($ui.explorerRoot);

    const focusListener = () => {
      gitRepoStore.refreshRepoOnly();
    };
    window.addEventListener('focus', focusListener);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      window.removeEventListener('focus', focusListener);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  });

  // Watch for workspace changes
  let lastRoot = $ui.explorerRoot;
  $effect(() => {
    if ($ui.explorerRoot !== lastRoot) {
      lastRoot = $ui.explorerRoot;
      gitRepoStore.setWorkspace($ui.explorerRoot);
    }
  });
</script>

<div class="flex flex-col h-full bg-surface">
  {#if availabilityLoading}
    <div class="flex flex-col items-center justify-center h-full p-4 gap-3 text-center">
      <Loader2 class="w-5 h-5 animate-spin text-accent" />
      <span class="text-sm text-muted">Detecting Git…</span>
    </div>
  {:else if !isGitInstalled}
    <div class="flex flex-col items-center justify-center h-full p-4 gap-3 text-center">
      <span class="text-sm font-semibold text-red-500">Git Not Found</span>
      <span class="text-xs text-muted">Install Git and Notron will detect it, or set the executable path manually.</span>

      {#if !showManualPath}
        <div class="flex items-center gap-2">
          <button
            onclick={handleRedetect}
            class="flex items-center gap-1 px-3 py-1.5 bg-surface-2 hover:bg-hover border border-subtle text-secondary rounded text-xs transition-colors font-medium"
          >
            <RefreshCw class="w-3.5 h-3.5" /> Re-detect
          </button>
          <button
            onclick={openManualPathSettings}
            class="flex items-center gap-1 px-3 py-1.5 bg-surface-2 hover:bg-hover border border-subtle text-secondary rounded text-xs transition-colors font-medium"
          >
            <Settings class="w-3.5 h-3.5" /> Set Path…
          </button>
        </div>
      {/if}

      {#if showManualPath}
        <div class="w-full max-w-[280px] flex flex-col gap-2">
          <input
            bind:value={manualPathInput}
            placeholder="/usr/bin/git or C:\Program Files\Git\cmd\git.exe"
            class="w-full bg-surface-2 border border-subtle focus:border-accent outline-none rounded p-2 text-xs text-primary"
          />
          <div class="flex items-center gap-2 justify-end">
            <button onclick={saveManualPath} class="px-3 py-1.5 bg-accent hover:bg-accent-hover text-on-accent rounded text-xs transition-colors font-medium">Save</button>
            {#if availability.path}
              <button onclick={clearManualPath} class="px-3 py-1.5 bg-surface-2 hover:bg-hover border border-subtle text-secondary rounded text-xs transition-colors">Clear</button>
            {/if}
            <button onclick={() => showManualPath = false} class="p-1.5 rounded hover:bg-hover text-icon-default"><X class="w-3.5 h-3.5" /></button>
          </div>
        </div>
      {/if}
    </div>
  {:else if repoLoading && !repo}
    <div class="flex flex-col items-center justify-center h-full p-4 gap-3 text-center">
      <Loader2 class="w-5 h-5 animate-spin text-accent" />
      <span class="text-sm text-muted">Checking repository…</span>
    </div>
  {:else if !isRepo}
    <div class="flex flex-col items-center justify-center h-full p-4 gap-4 text-center">
      <span class="text-sm text-muted">The workspace is not a Git repository.</span>
      <button
        onclick={handleInit}
        class="px-4 py-2 bg-accent hover:bg-accent-hover text-on-accent rounded text-sm transition-colors w-full"
      >
        Initialize Repository
      </button>
    </div>
  {:else if repo}
    <!-- Git Actions Header -->
    <div class="p-3 border-b border-subtle flex flex-col gap-2 bg-surface">
      <div class="flex items-center justify-between mb-1">
        <span class="text-xs font-semibold text-primary">Source Control</span>
        <div class="flex items-center gap-1">
          <Tooltip content="Fetch">
            <button onclick={handleFetch} disabled={syncing} class="p-1 rounded hover:bg-hover text-icon-default disabled:opacity-50">
              <RefreshCw class="w-3.5 h-3.5 {syncing ? 'animate-spin' : ''}" />
            </button>
          </Tooltip>
          <Tooltip content="Pull">
            <button onclick={handlePull} disabled={syncing} class="p-1 rounded hover:bg-hover text-icon-default disabled:opacity-50">
              <Download class="w-3.5 h-3.5" />
            </button>
          </Tooltip>
          <Tooltip content="Push">
            <button onclick={handlePush} disabled={syncing} class="p-1 rounded hover:bg-hover text-icon-default disabled:opacity-50">
              <Upload class="w-3.5 h-3.5" />
            </button>
          </Tooltip>
          {#if syncing}
            <Tooltip content="Cancel">
              <button onclick={handleCancelSync} class="p-1 rounded hover:bg-hover text-red-500">
                <X class="w-3.5 h-3.5" />
              </button>
            </Tooltip>
          {/if}
        </div>
      </div>
      
      <div class="relative">
        <textarea
          bind:value={commitMessage}
          placeholder="Message (Ctrl+Enter to commit)"
          class="w-full bg-surface-2 border border-subtle focus:border-accent outline-none rounded p-2 text-xs text-primary resize-none min-h-[64px]"
          onkeydown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              handleCommit();
            }
          }}
        ></textarea>
      </div>

      <button
        onclick={handleCommit}
        disabled={isCommitting || !commitMessage.trim() || repo.staged.length === 0}
        class="flex items-center justify-center gap-2 w-full py-1.5 bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-on-accent rounded text-xs transition-colors font-medium"
      >
        {#if isCommitting || repoLoading}
          <Loader2 class="w-3.5 h-3.5 animate-spin" />
        {/if}
        Commit
      </button>

      {#if syncing && progress}
        <div class="flex flex-col gap-1 mt-1">
          <div class="w-full h-1 bg-surface-3 rounded overflow-hidden">
            <div
              class="h-full bg-accent transition-all"
              style="width: {Math.min(progress.percent ?? 100, 100)}%"
            ></div>
          </div>
          <div class="text-[10px] text-muted truncate">{progress.phase}: {progress.message}</div>
        </div>
      {/if}

      {#if lastError}
        <div class="text-[10px] text-red-500 bg-red-500/10 border border-red-500/30 rounded px-2 py-1 break-words max-h-20 overflow-y-auto mt-1">
          {lastError}
        </div>
      {/if}
    </div>

    <!-- Split View Container -->
    <div class="flex-1 overflow-hidden flex flex-col" id="sc-container">

      <!-- Top Section: CHANGES -->
      <div class="flex flex-col overflow-hidden" style="flex: {changesVisible ? changesFlex : 0}; min-height: {changesVisible ? '40px' : '0'}; display: {changesVisible ? 'flex' : 'none'};">
        <div role="button" tabindex="0" class="flex items-center px-2 py-1 bg-surface-2 border-b border-subtle cursor-pointer hover:bg-hover shrink-0" onclick={() => changesVisible = !changesVisible} onkeydown={(e) => { if (e.key === 'Enter') changesVisible = !changesVisible; }}>
          <ChevronDown class="w-3.5 h-3.5 mr-1 text-icon-default" />
          <span class="text-xs font-semibold uppercase text-secondary">Changes</span>
          <span class="ml-auto bg-surface-3 rounded-full px-1.5 py-0.5 text-[10px]">{repo.staged.length + repo.unstaged.length + repo.conflicted.length}</span>
        </div>

        <div class="flex-1 overflow-y-auto">
          {#if repo.conflicted.length > 0}
            <div class="flex items-center justify-between px-3 py-1 bg-surface-2 group sticky top-0 z-10 border-b border-subtle shadow-sm">
              <span class="text-[10px] font-semibold uppercase text-purple-400">Conflicts</span>
            </div>
            <div class="flex flex-col mb-2">
              {#each repo.conflicted as file}
                {@const Icon = getFileIcon(file.path.split('/').pop() || '')}
                <div role="button" tabindex="0" class="flex items-center justify-between px-3 py-1 hover:bg-hover group cursor-pointer h-8" onclick={() => openFile(file)} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') openFile(file); }}>
                  <div class="flex items-center gap-2 overflow-hidden flex-1">
                    {#if settingsStore.effectiveSettings.icon_theme !== 'off'}
                      <Icon size={14} class="text-icon-default shrink-0" />
                    {/if}
                    <span class="text-sm truncate text-primary">{file.path.split('/').pop()}</span>
                    <span class="text-xs text-muted truncate">{file.path.split('/').slice(0, -1).join('/')}</span>
                  </div>
                  <div class="flex items-center gap-2 shrink-0">
                    <div class="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <Tooltip content="Open File">
                        <button onclick={(e) => { e.stopPropagation(); openFile(file); }} class="p-1 rounded hover:bg-hover text-icon-default hover:text-icon-active">
                          <FileText class="w-3.5 h-3.5" />
                        </button>
                      </Tooltip>
                    </div>
                    <span class="text-[10px] w-4 text-center shrink-0 font-bold text-purple-500">C</span>
                  </div>
                </div>
              {/each}
            </div>
          {/if}

          {#if repo.staged.length > 0}
            <div class="flex items-center justify-between px-3 py-1 bg-surface-2 group sticky top-0 z-10 border-b border-subtle shadow-sm">
              <span class="text-[10px] font-semibold uppercase text-secondary">Staged Changes</span>
              <div class="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                <Tooltip content="Unstage All Changes">
                  <button onclick={handleUnstageAll} class="p-1 rounded hover:bg-hover text-icon-default hover:text-icon-active">
                    <Minus class="w-3.5 h-3.5" />
                  </button>
                </Tooltip>
              </div>
            </div>
            <div class="flex flex-col mb-2">
              {#each repo.staged as file}
                {@const Icon = getFileIcon(file.path.split('/').pop() || '')}
                <div role="button" tabindex="0" class="flex items-center justify-between px-3 py-1 hover:bg-hover group cursor-pointer h-8" onclick={() => openFile(file)} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') openFile(file); }}>
                  <div class="flex items-center gap-2 overflow-hidden flex-1">
                    {#if settingsStore.effectiveSettings.icon_theme !== 'off'}
                      <Icon size={14} class="text-icon-default shrink-0" />
                    {/if}
                    <span class="text-sm truncate text-primary">{file.path.split('/').pop()}</span>
                    <span class="text-xs text-muted truncate">{file.path.split('/').slice(0, -1).join('/')}</span>
                  </div>
                  <div class="flex items-center gap-2 shrink-0">
                    <div class="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <Tooltip content="Open File">
                        <button onclick={(e) => { e.stopPropagation(); openFile(file); }} class="p-1 rounded hover:bg-hover text-icon-default hover:text-icon-active">
                          <FileText class="w-3.5 h-3.5" />
                        </button>
                      </Tooltip>
                      <Tooltip content="Unstage Changes">
                        <button onclick={(e) => { e.stopPropagation(); handleUnstage(file); }} class="p-1 rounded hover:bg-hover text-icon-default hover:text-icon-active">
                          <Minus class="w-3.5 h-3.5" />
                        </button>
                      </Tooltip>
                    </div>
                    <span class="text-[10px] w-4 text-center shrink-0 font-bold {statusCodeColor(file.status)}">{file.status === 'Conflict' ? 'C' : file.status}</span>
                  </div>
                </div>
              {/each}
            </div>
          {/if}

          {#if repo.unstaged.length > 0 || repo.untracked.length > 0}
            <div class="flex items-center justify-between px-3 py-1 bg-surface-2 group sticky top-0 z-10 border-y border-subtle shadow-sm mt-2">
              <span class="text-[10px] font-semibold uppercase text-secondary">Changes</span>
              <div class="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                <Tooltip content="Stage All Changes">
                  <button onclick={handleStageAll} class="p-1 rounded hover:bg-hover text-icon-default hover:text-icon-active">
                    <Plus class="w-3.5 h-3.5" />
                  </button>
                </Tooltip>
              </div>
            </div>
            <div class="flex flex-col">
              {#each repo.unstaged as file}
                {@const Icon = getFileIcon(file.path.split('/').pop() || '')}
                <div role="button" tabindex="0" class="flex items-center justify-between px-3 py-1 hover:bg-hover group cursor-pointer h-8" onclick={() => openFile(file)} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') openFile(file); }}>
                  <div class="flex items-center gap-2 overflow-hidden flex-1">
                    {#if settingsStore.effectiveSettings.icon_theme !== 'off'}
                      <Icon size={14} class="text-icon-default shrink-0" />
                    {/if}
                    <span class="text-sm truncate text-primary">{file.path.split('/').pop()}</span>
                    <span class="text-xs text-muted truncate">{file.path.split('/').slice(0, -1).join('/')}</span>
                  </div>
                  <div class="flex items-center gap-2 shrink-0">
                    <div class="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <Tooltip content="Open File">
                        <button onclick={(e) => { e.stopPropagation(); openFile(file); }} class="p-1 rounded hover:bg-hover text-icon-default hover:text-icon-active">
                          <FileText class="w-3.5 h-3.5" />
                        </button>
                      </Tooltip>
                      <Tooltip content="Stage Changes">
                        <button onclick={(e) => { e.stopPropagation(); handleStage(file); }} class="p-1 rounded hover:bg-hover text-icon-default hover:text-icon-active">
                          <Plus class="w-3.5 h-3.5" />
                        </button>
                      </Tooltip>
                      <Tooltip content="Discard Changes">
                        <button onclick={(e) => { e.stopPropagation(); handleDiscard(file); }} class="p-1 rounded hover:bg-hover text-icon-default hover:text-red-500">
                          <Undo2 class="w-3.5 h-3.5" />
                        </button>
                      </Tooltip>
                    </div>
                    <span class="text-[10px] w-4 text-center shrink-0 font-bold {statusCodeColor(file.status)}">{file.status === 'Conflict' ? 'C' : file.status}</span>
                  </div>
                </div>
              {/each}

              {#if repo.untracked.length > 0}
                <div class="px-3 py-1 text-[10px] font-semibold uppercase text-secondary bg-surface-2/50 mt-1">Untracked</div>
                {#each repo.untracked as file}
                  {@const Icon = getFileIcon(file.path.split('/').pop() || '')}
                  <div role="button" tabindex="0" class="flex items-center justify-between px-3 py-1 hover:bg-hover group cursor-pointer h-8" onclick={() => openFile(file)} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') openFile(file); }}>
                    <div class="flex items-center gap-2 overflow-hidden flex-1">
                      {#if settingsStore.effectiveSettings.icon_theme !== 'off'}
                        <Icon size={14} class="text-icon-default shrink-0" />
                      {/if}
                      <span class="text-sm truncate text-primary">{file.path.split('/').pop()}</span>
                      <span class="text-xs text-muted truncate">{file.path.split('/').slice(0, -1).join('/')}</span>
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                      <div class="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <Tooltip content="Stage File">
                          <button onclick={(e) => { e.stopPropagation(); handleStage(file); }} class="p-1 rounded hover:bg-hover text-icon-default hover:text-icon-active">
                            <Plus class="w-3.5 h-3.5" />
                          </button>
                        </Tooltip>
                      </div>
                      <span class="text-[10px] w-4 text-center shrink-0 font-bold text-green-500">U</span>
                    </div>
                  </div>
                {/each}
              {/if}
            </div>
          {:else if repo.staged.length === 0 && repo.conflicted.length === 0}
            <div class="flex items-center justify-center p-8">
              <span class="text-sm text-muted">No changes found.</span>
            </div>
          {/if}
        </div>
      </div>

      <!-- Splitter / Resizer -->
      {#if changesVisible && graphVisible}
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <div class="h-[3px] bg-subtle hover:bg-accent cursor-ns-resize transition-colors shrink-0 relative z-20" onmousedown={startResize} role="separator" tabindex="0"></div>
      {/if}

      <!-- Collapsed header for Changes if hidden -->
      {#if !changesVisible}
        <div role="button" tabindex="0" class="flex items-center px-2 py-1 bg-surface-2 border-b border-subtle cursor-pointer hover:bg-hover shrink-0" onclick={() => changesVisible = !changesVisible} onkeydown={(e) => { if (e.key === 'Enter') changesVisible = !changesVisible; }}>
          <ChevronRight class="w-3.5 h-3.5 mr-1 text-icon-default" />
          <span class="text-xs font-semibold uppercase text-secondary">Changes</span>
          <span class="ml-auto bg-surface-3 rounded-full px-1.5 py-0.5 text-[10px]">{repo.staged.length + repo.unstaged.length + repo.conflicted.length}</span>
        </div>
      {/if}

      <!-- Collapsed header for Graph if hidden -->
      {#if !graphVisible}
        <div role="button" tabindex="0" class="flex items-center px-2 py-1 bg-surface-2 border-b border-subtle cursor-pointer hover:bg-hover shrink-0" onclick={() => graphVisible = !graphVisible} onkeydown={(e) => { if (e.key === 'Enter') graphVisible = !graphVisible; }}>
          <ChevronRight class="w-3.5 h-3.5 mr-1 text-icon-default" />
          <span class="text-xs font-semibold uppercase text-secondary">Graph</span>
        </div>
      {/if}

      <!-- Bottom Section: GRAPH -->
      <div class="flex flex-col overflow-hidden" style="flex: {graphVisible ? graphFlex : 0}; min-height: {graphVisible ? '40px' : '0'}; display: {graphVisible ? 'flex' : 'none'};">
        <div class="flex items-center justify-between px-2 py-1 bg-surface-2 border-b border-y border-subtle shrink-0">
          <div role="button" tabindex="0" class="flex items-center cursor-pointer hover:bg-hover flex-1" onclick={() => graphVisible = !graphVisible} onkeydown={(e) => { if (e.key === 'Enter') graphVisible = !graphVisible; }}>
            <ChevronDown class="w-3.5 h-3.5 mr-1 text-icon-default" />
            <span class="text-xs font-semibold uppercase text-secondary">Graph</span>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <Tooltip content="Fetch"><button onclick={handleFetch} disabled={syncing} class="p-1 rounded hover:bg-hover text-icon-default"><RefreshCw class="w-3.5 h-3.5 {syncing ? 'animate-spin' : ''}" /></button></Tooltip>
            <Tooltip content="More Actions"><button class="p-1 rounded hover:bg-hover text-icon-default"><MoreHorizontal class="w-3.5 h-3.5" /></button></Tooltip>
          </div>
        </div>
        <div class="flex-1 overflow-y-auto bg-surface relative">
          {#if commits.length > 0}
            <div class="absolute left-[21px] top-0 bottom-0 w-[2px] bg-subtle z-0"></div>
            {#each commits as commit}
              <div class="flex items-center px-3 py-1 hover:bg-hover group cursor-pointer gap-2 h-7 relative z-10">
                <div class="flex items-center justify-center w-5 h-5 shrink-0 bg-surface rounded-full">
                  <div class="w-2 h-2 rounded-full border-2 border-accent bg-surface z-10"></div>
                </div>
                <div class="flex items-center flex-1 overflow-hidden">
                  <span class="text-xs text-primary truncate font-medium flex-1">{commit.message}</span>
                  {#if commit.refs}
                    <div class="ml-2 flex items-center gap-1 shrink-0">
                      {#each commit.refs.split(', ') as ref}
                        {#if ref.includes('origin/')}
                          <span class="flex items-center gap-0.5 text-[9px] border border-purple-500/50 text-purple-400 bg-purple-500/10 rounded-full px-1.5 py-0.5 whitespace-nowrap"><Cloud class="w-2.5 h-2.5" /> {ref.replace('origin/', '')}</span>
                        {:else if ref.includes('HEAD')}
                          <span class="flex items-center gap-0.5 text-[9px] border border-accent/50 text-accent bg-accent/10 rounded-full px-1.5 py-0.5 whitespace-nowrap"><Target class="w-2.5 h-2.5" /> {ref}</span>
                        {:else}
                          <span class="flex items-center gap-0.5 text-[9px] border border-green-500/50 text-green-400 bg-green-500/10 rounded-full px-1.5 py-0.5 whitespace-nowrap"><GitBranch class="w-2.5 h-2.5" /> {ref}</span>
                        {/if}
                      {/each}
                    </div>
                  {/if}
                </div>
                <span class="text-[10px] text-muted shrink-0 w-20 truncate text-right">{commit.author}</span>
              </div>
            {/each}
          {:else}
            <div class="flex items-center justify-center p-8">
              <span class="text-sm text-muted">No commits yet.</span>
            </div>
          {/if}
        </div>
      </div>
    </div>

    <!-- Branch info at the bottom -->
    {#if repo.branch}
      <div class="px-3 py-1.5 border-t border-subtle bg-surface-2 shrink-0">
        <span class="text-xs font-semibold text-muted flex items-center gap-1.5">
          <GitBranch class="w-3.5 h-3.5" /> {repo.branch}
          {#if repo.ahead > 0 || repo.behind > 0}
            <span class="text-[10px] text-muted">
              {#if repo.ahead > 0}↑{repo.ahead}{/if}
              {#if repo.behind > 0}↓{repo.behind}{/if}
            </span>
          {/if}
        </span>
      </div>
    {/if}
  {/if}
</div>
