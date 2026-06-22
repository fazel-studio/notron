<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Terminal } from 'xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import { spawn } from "tauri-pty";
  import { themeStore } from '../stores/theme';
  import 'xterm/css/xterm.css';

  let { tabId, type, cwd } = $props<{ tabId: string, type: 'powershell' | 'cmd', cwd: string }>();

  let isDark = $derived($themeStore.isDark);

  let terminalContainer = $state<HTMLElement | null>(null);
  let term: Terminal;
  let fitAddon: FitAddon;
  let resizeObserver: ResizeObserver;
  let ptyProcess: any = null;

  import { terminalStore } from '../stores/terminal';
  let isResizing = $derived($terminalStore.isResizing);

  $effect(() => {
    // When the user completely stops dragging, we send the final resize to the PTY.
    if (!isResizing && ptyProcess && term && term.cols && term.rows) {
      ptyProcess.resize(term.cols, term.rows);
    }
  });

  async function startShell() {
    try {
      const cmdStr = type === 'powershell' ? 'powershell.exe' : 'cmd.exe';
      ptyProcess = spawn(cmdStr, [], {
        cols: term.cols || 80,
        rows: term.rows || 24,
        cwd: cwd || undefined
      });

      // Catch inner initialization errors (e.g. capabilities)
      if (ptyProcess._init) {
        ptyProcess._init.catch((err: any) => {
          term.writeln(`\r\n[PTY Init Error: ${err}]`);
        });
      }

      ptyProcess.onData((data: Uint8Array) => {
        term.write(new TextDecoder().decode(data));
      });

      ptyProcess.onExit(() => {
        terminalStore.closeTerminal(tabId);
      });

      term.onData(data => {
        if (!ptyProcess) return;
        ptyProcess.write(data);
      });
    } catch (e) {
      term.writeln(`\r\n[Failed to spawn PTY shell: ${e}]`);
    }
  }

  $effect(() => {
    // This effect runs whenever `isDark` changes
    const currentDark = isDark;
    if (term && typeof window !== 'undefined') {
      // Use setTimeout to ensure DOM has updated the .dark class on document element
      setTimeout(() => {
        const style = getComputedStyle(document.body);
        const foreground = style.getPropertyValue('--text-primary').trim() || (currentDark ? '#f3f4f6' : '#1f2937');
        const cursor = style.getPropertyValue('--text-primary').trim() || (currentDark ? '#f3f4f6' : '#1f2937');
        const selection = style.getPropertyValue('--bg-selected').trim() || (currentDark ? '#374151' : '#e5e7eb');
        const red = style.getPropertyValue('--color-error').trim() || '#ef4444';
        const green = style.getPropertyValue('--color-success').trim() || '#10b981';
        const yellow = style.getPropertyValue('--color-warning').trim() || '#f59e0b';
        const blue = style.getPropertyValue('--color-info').trim() || '#3b82f6';

        term.options.theme = {
          background: 'transparent',
          foreground,
          cursor,
          selectionBackground: selection,
          red, brightRed: red,
          green, brightGreen: green,
          yellow, brightYellow: yellow,
          blue, brightBlue: blue,
        };
      }, 10);
    }
  });

  onMount(() => {
    if (!terminalContainer) return;

    term = new Terminal({
      theme: { background: 'transparent' },
      fontFamily: 'Consolas, "Courier New", monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
    });

    fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(terminalContainer);
    fitAddon.fit();

    // Copy on Ctrl+C if text is selected
    term.attachCustomKeyEventHandler((e) => {
      if (e.ctrlKey && e.code === 'KeyC' && e.type === 'keydown') {
        if (term.hasSelection()) {
          navigator.clipboard.writeText(term.getSelection());
          term.clearSelection();
          return false; // Prevent sending SIGINT
        }
      }
      return true;
    });

    startShell();

    let resizeTimeout: ReturnType<typeof setTimeout>;
    resizeObserver = new ResizeObserver(() => {
      try { 
        fitAddon.fit(); 
        if (ptyProcess && term.cols && term.rows && !isResizing) {
          clearTimeout(resizeTimeout);
          resizeTimeout = setTimeout(() => {
            if (ptyProcess && term.cols && term.rows && !isResizing) {
              ptyProcess.resize(term.cols, term.rows);
            }
          }, 150);
        }
      } catch (e) {}
    });
    resizeObserver.observe(terminalContainer);
  });

  onDestroy(() => {
    if (resizeObserver) resizeObserver.disconnect();
    try {
      if (ptyProcess) ptyProcess.kill();
    } catch (e) {}
    if (term) term.dispose();
  });
</script>

<div class="w-full h-full p-2 flex flex-col overflow-hidden">
  <div class="flex-1 w-full relative overflow-hidden" bind:this={terminalContainer}></div>
  <!-- physical gap to ensure the last line is never perceived as covered by status bar -->
  <div class="h-4 w-full shrink-0"></div>
</div>

<style>
  /* Optional CSS to make sure xterm inherits Notron's theme nicely */
  :global(.xterm-viewport) {
    background-color: transparent !important;
    overflow-y: auto !important;
  }
</style>
