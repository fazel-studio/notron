# Product Requirements Document (PRD) — Notron

## 1. Project Overview

**Notron** is a modern desktop code editor designed for speed, efficiency, and a minimal yet powerful user experience. Built with **Tauri** for the backend (Rust) and **Svelte 5** for the frontend, Notron delivers native application performance with the flexibility of web technologies.

### 1.1. Architecture

- **Package Manager:** Bun
- **Stack:** Tauri + Svelte + Rust
- **Editor Engine:** CodeMirror 6

### 1.2. Goals

- Provide a lightweight alternative to Electron-based editors with significantly lower memory and CPU usage.
- Achieve fast startup and responsive interaction even on large workspaces.
- Offer a modern, minimal UI that remains fully featured.

### 1.3. Non-Goals (Out of Scope for v1)

- Full IntelliSense / language server integration (planned for later via LSP).
- Collaborative real-time editing (planned for a future phase).
- Plugin ecosystem / extension marketplace (planned).

## 2. Target Users

- **Software Engineers:** Developers who need a lightweight editor for quick edits or medium-sized project management.
- **Web Developers:** Users familiar with modern ecosystems such as VS Code who want a more resource-efficient application.
- **Writers / Note-takers:** Users who frequently work with Markdown.

## 3. Core Features

### 3.1. File & Workspace Management

- **File Tree Explorer:** Hierarchical navigation of the folder structure.
- **File Operations (CRUD):** Create files/folders, rename, delete, plus Copy, Cut, and Paste operations (single and multi-select).
- **Workspace Restoration:** Remembers the last opened folder, sidebar layout, expanded folders, and open tabs when the app is relaunched.
- **File Watcher:** Real-time synchronization between files on disk and the editor view (using an optimized recursive watcher).
- **Ignore & Exclude Rules:** Respect `.gitignore` and user-defined ignore patterns (e.g. `node_modules`, `.git`) to keep the tree and global search clean.

### 3.2. Code Editor (Core)

- **CodeMirror 6 Engine:** World-class editor integration with high performance.
- **Multi-tab Interface:** Open many files simultaneously in tabs.
- **Syntax Highlighting:** Automatic support for many languages (JS, TS, Rust, Python, Go, C++, HTML, CSS, JSON, Markdown, and more).
- **Lazy Loading:** File contents are only loaded into memory when the tab is active to save RAM.
- **Auto-save:** Automatic saving based on a configurable duration.
- **Search & Replace:** In-editor find/replace with regex support.

### 3.3. Navigation & Code Intelligence

- **Command Palette** (`Ctrl+Shift+P`): Quick access to every application command.
- **Symbol Engine:** Extraction of symbols (functions, classes, variables) via regex to power "Go to Definition" and "Find References".
- **Go To Line** (`Ctrl+G`): Quick navigation to a specific line in a file.
- **Global Search:** Search text across the entire workspace with automatic directory filtering (ripgrep engine).

### 3.4. User Interface (UI/UX)

- **Custom Title Bar:** Frameless window for a modern, integrated look.
- **Theming:** Dark and Light themes, plus an option to follow the OS scheme.
- **Skeleton Loading:** Fast initial rendering with placeholders while workspace data loads.
- **Markdown Preview:** Real-time visual rendering for `.md` files.
- **Image Viewer:** Preview image files directly in a tab.

### 3.5. Terminal & Developer Tools

- **Integrated Terminal:** xterm.js-powered terminal (via `tauri-pty`) with multiple instances.
- **Source Control (Git):** Stage, commit, push/pull, discard, logs, and diff viewing.
- **Run & Debug:** DAP (Debug Adapter Protocol) integration with breakpoints, call stack, and variables.

## 4. Technology Stack

| Category            | Technology                                              |
| ------------------- | ------------------------------------------------------- |
| Frontend Framework  | Svelte 5 (using Runes for efficient reactivity)         |
| Backend Runtime     | Tauri 2.0 (Rust)                                        |
| Runtime / Package Mgr | Bun                                                |
| Editor Engine       | CodeMirror 6                                            |
| Database            | SQLite (via rusqlite) for settings and file history     |
| Styling             | Vanilla CSS & Tailwind CSS                              |

## 5. Non-Functional Requirements

### 5.1. Performance

- **Startup Time:** The app must show a functional UI in under 2 seconds.
- **Memory Usage:** Memory usage should stay below 200MB for standard use (significantly lower than Electron).
- **Reactivity:** The UI must not hang during deep file tree operations or global search.

### 5.2. Security

- **File Isolation:** The app only has access to directories granted permission by the OS through the Tauri API.
- **Data Persistence:** User settings are stored locally in the `AppData` directory (Windows) or equivalent on other OSes.
- **Input Validation:** All IPC inputs are validated; paths are normalized and confined to allowed scopes.

### 5.3. Reliability

- **Crash Recovery:** On abnormal exit, dirty tab snapshots are persisted and restored on next launch.
- **Logging:** Structured logging in debug builds and rolling file logs in production.

## 6. Technical Architecture

The application is optimized using the modern **Svelte 5 Store Pattern**:

- Avoids manual `.subscribe()` calls in components.
- Uses `$derived` for derived state.
- Uses isolated `$effect` implementations for heavy features such as the file watcher.

### 6.1. Frontend (Svelte 5)

- `src/lib/components/` — UI components (Editor, FileTree, Terminal, CommandPalette, etc.).
- `src/lib/stores/` — Svelte stores and runes (`editor`, `settings`, `terminal`, `theme`, `run`, `git`, `palette`, `navigation`, `ui`).
- `src/lib/services/` — Service layer (`runService`, `git`).
- `src/lib/utils/` — Utilities (explorer, symbol engine, language detector, markdown renderer, stream helpers).

### 6.2. Backend (Tauri / Rust)

- `src-tauri/src/config.rs` — Application and critical configuration management.
- `src-tauri/src/db.rs` — SQLite connection pool and tiered settings/state persistence.
- `src-tauri/src/file_ops.rs` — File/directory operations and streaming reads.
- `src-tauri/src/search.rs` — Global search (ripgrep engine) and replace-all.
- `src-tauri/src/watcher_service.rs` — Unified file watcher service.
- `src-tauri/src/workspace_cache.rs` — Rust-side explorer cache (source of truth for the tree).
- `src-tauri/src/symbol_index.rs` — Symbol extraction and workspace indexing.
- `src-tauri/src/git_service.rs` — Git integration and detection.

## 7. Development Roadmap

- [x] Core editor, file tree, global search, and ignore rules.
- [x] Integrated terminal.
- [x] Git source control and Run/Debug (DAP).
- [ ] Extension/plugin system (basic).
- [ ] Full Git integration enhancements (branching, merge, rebase).
- [ ] Collaborative editing via WebSockets.
- [ ] Symbol Engine accuracy improvements using LSP (Language Server Protocol).

## 8. Success Metrics

- Startup time under 2 seconds on typical hardware.
- Memory usage below 200MB during standard editing sessions.
- Global search across a 100k+ file repository completes without blocking the UI.
- Community adoption: number of GitHub stars, contributors, and open issues resolved.
