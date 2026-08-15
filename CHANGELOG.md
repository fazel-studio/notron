# Changelog

All notable changes to the Notron project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Refactored
- Replaced `DebugConfiguration` with `RunConfiguration` and removed the debug store:
- Updated `entryPointResolver` to use `RunConfiguration` instead of `DebugConfiguration`.
- Removed `debug.ts` store and its related functionalities.
- Modified `ui.ts` to reflect the sidebar panel change from `'debug'` to `'run'`.
- Deleted `debugExtensions.ts` as debugging features were removed.
- Added `RunPanel` component for managing run configurations.
- Introduced `runService` for handling run configurations and execution.
- Created the run store to manage run configurations and selected state.

### Removed
- Removed the **Debug** feature (DAP) entirely — Rust module `debug_adapter.rs`, `debug_*` commands, the bundled `resources/js-debug` assets, `debug.ts` store, `debugExtensions.ts` editor extensions, `DebugPanel.svelte`, and the `dapClient.ts` client.
- Kept only the **Run** feature: `run.ts` store, `runService.ts` service, and `RunPanel.svelte` (runs a configuration in the integrated terminal).

### Added
- **Rust/Cargo** support in the entry point resolver — a `Cargo.toml` workspace resolves to `cargo run`.
- **Deno** support — `deno.json` / `deno.jsonc` / `deno.lock` projects resolve to `deno run <entry>`.
- New Node.js framework detection: SvelteKit (`vite dev`), Nuxt (`nuxt dev`), Gatsby (`gatsby develop`), and Create React App (`npm start`).
- **Go** and **Ruby** "Run Current File" fallbacks for the active file.
- `RunPanel` now uses the shared `DropdownMenu` component for the configuration selector (full-width trigger).

### Changed
- Removed the collapsible "RUN >" section — `RunPanel` now shows a static "RUN" header with the controls always visible.
- Cleaned up remaining "Run and Debug" wording in `entryPointResolver.ts` and `runService.ts` comments.

## [0.1.0] — 2026-08-13

### Changed
- Removed the old Git Gutter implementation and integrated new CodeMirror extensions (git gutter markers + sticky scroll).
- Updated the editor component to use the new extensions and improved minimap functionality.
- Refactored session save logic to properly handle workspace state on window close.
- Adjusted styles for better UI consistency.
- Updated TypeScript configuration (paths for CodeMirror modules) and Vite config (deduplicated CodeMirror dependencies).

## [0.1.0-alpha] — 2026-08-07

### Added
- `getGitFileDiff` function to retrieve the diff of a specified file.
- `WorkingTreeWidget.svelte` component for displaying file changes in the working tree.
- `entryPointResolver.ts` — entry point resolution for Node.js, Python, Go, and Ruby with caching.
- `gitGutter.ts` — Git change visualization in the editor (inline diff widgets + gutter markers).
- Svelte and Lezer language detection in `languageDetector.ts`.

### Changed
- Extended `DebugConfiguration` with `rubyPath`, `detectedTier`, and `command` properties.
- Simplified `show_main_window` and improved window display logic.
- Fixed gitignore matching to check the path or any of its parents.
- Adjusted the commit notification toast message in `SourceControlPanel`.

## [0.1.0-alpha] — 2026-08-05

### Added
- New `debug` store for managing debug session state, breakpoints, call stack, and console output.
- Functions to toggle/clear breakpoints and manage debug configurations.
- UI support for breakpoint indicators in the editor.
- Active-line decoration utilities during debug sessions.
- `remote_url` field on `RepoState` to track the remote repository URL.
- `getCommitFiles` function to retrieve files associated with a commit.
- Repository refresh debouncing for better performance.
- Timestamped, leveled terminal logging for git operations.
- `'debug'` option for the active sidebar panel.
- `is_ignored` property on tree nodes + flattening logic for gitignored files.
- **Search & Replace** in the editor: `buildReplaceRegex`, `applyReplacement`, `applyReplacements`, `ReplaceMatchOptions`, diff-state support on tabs, tab suspension, and undo history.
- `gitDecoration` and `gitRepo` stores for Git integration.
- Workspace file list caching in the palette store.
- Search exclude/include patterns in the settings store.
- Output log and active panel state management in the terminal store.
- `'black'` theme support.
- Markdown rendering and streaming command utilities.

## [2026-06-22] — Project Architecture Initialization

### Added
- Migrated the UI architecture from React/TSX to **Svelte 5**:
  - Core Svelte components (Editor, FileTree, Terminal, CommandPalette, TitleMenuBar, WelcomeTab, etc.).
  - Svelte stores (`editor`, `settings`, `theme`, `ui`, `terminal`).
  - Svelte utilities (`iconMap`, `languageDetector`, `symbolEngine`, `treeFlattener`).
- Tauri backend integration:
  - Rust modules `config.rs`, `db.rs`, `file_ops.rs`, `symbol_index.rs`, `fs_watcher.rs`.
  - Large additions to `db.rs` (tiered settings/state), `file_ops.rs`, and `symbol_index.rs`.
- File/folder icon set `public/icons/material/**` (VSCode Material icons).
- Terminal store with PTY support and initial commands.

## [2026-06-19] — Update 2

- Further updates and fixes.

## [2026-06-13] — Update 1

- Initial updates and fixes.

## [2026-06-09] — Initial Release

### Added
- Project scaffolding: Tauri 2 + Svelte structure, README, Vite config, `package.json`, `bun.lock`.
- Initial React-based components (`src/App.tsx`, editor/file tree/settings components, etc.).
- Base Rust backend (`config.rs`, `converter.rs`, `db.rs`, `document.rs`, `file_ops.rs`).
- App icon assets (`src-tauri/icons/**`) and `public/notron.png` logo.
