// ── Module F — Run and Debug (Debug Adapter Protocol) ───────────────────────
//
// Implements modules/06-Notron-Module-RunAndDebug.md. Key architectural
// decisions (all faithful to the module):
//
//   F.5.1 — The debug adapter is spawned and managed from Rust (the webview
//           only renders UI and issues user commands via `invoke`). Notron has
//           no VS Code-style Extension Host, so there is no Node.js side
//           process to own the adapter.
//
//   F.1.1 — Adapter communication uses the DAP base protocol (a
//           `Content-Length` header followed by a JSON body) over a byte
//           stream. Both supported adapter families expose DAP over a TCP
//           endpoint that Notron attaches to (`Plan::Socket`):
//             • Node.js uses the bundled standalone `js-debug-dap` server
//               (`resources/js-debug/src/dapDebugServer.js <port> <host>`).
//             • Python uses `debugpy --listen <addr> --wait-for-client`.
//               debugpy is NOT bundled (keeps the installer light); if the
//               active interpreter cannot import it, Notron auto-installs it
//               via `pip install debugpy` into that environment (VSCode-style
//               provisioning, strategy C + A2 in module §F.5.3).
//
//   F.5.1 / §0.3 — Every session streams DAP frames + program output to the
//           frontend over a tauri `Channel`, NOT `emit`. Channel guarantees
//           ordering for the frequent/sequential frames (output stream,
//           stepping), which `emit` does not for async listeners.
//
//   F.5.3 — Static internal adapter registry (`detect_debug_type`) since the
//           v1 has no contribution-point/plugin system yet.
//
//   F.5.4 — Auto-detect an entry point (Run/Debug with zero launch.json) by
//           extension + well-known entry file names + project manifests.
//
//   F.6 #5 — `envFile` (.env) is parsed natively in Rust and merged into the
//           child process environment (the module's recommended strategy,
//           rather than forcing users to hand-write every var in config).
//
//   F.6 #6 — Cleanup kills the whole process tree (`taskkill /T` on Windows)
//           and not just the direct child, to avoid zombie servers and port
//           conflicts on the next session.
//
//   F.6 #7 — DebugSessionManager is a map of sessions
//           (`HashMap<sessionId, Session>`) from day one, ready for compound
//           configurations.
//
//   Breakpoint & exception-breakpoint source of truth (F.1.3 / F.4): stored on
//   the FRONTEND (editor owns state); every new session the client re-sends
//   them via `setBreakpoints` / `setExceptionBreakpoints` over this channel.

use std::collections::HashMap;
use std::io::ErrorKind as IoErrorKind;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::Manager;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::process::{Child, Command};
use tokio::sync::mpsc;
use tokio::sync::Mutex;

// ── Data shapes shared with the frontend ─────────────────────────────────────

/// Every event a debug session emits to the webview Channel.
#[derive(Serialize, Clone)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SessionEvent {
    /// A raw DAP message received from the adapter (request/response/event).
    /// `payload` is the JSON text of the frame; the client protocol machine
    /// parses and routes it.
    Dap { payload: String },
    /// Program output from the debuggee process (Debug Console / terminal).
    Output { stream: String, line: String },
    /// The session finished (process exited).
    Terminated { code: Option<i32> },
}

/// Configuration accepted by `debug_start_session`. Field names map directly
/// to the relevant subset of `launch.json`. Variable substitution
/// (`${workspaceFolder}`, `${file}`, `${env:…}`) is already resolved by the
/// frontend per F.2.2.
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DebugConfig {
    /// Adapter family: "node" | "python".
    pub debug_type: String,
    /// "launch" | "attach" (attach is reported as unsupported for now).
    pub request: String,
    /// Entry point (absolute path).
    pub program: Option<String>,
    /// Working directory for the debuggee.
    pub cwd: Option<String>,
    pub args: Vec<String>,
    /// Explicit environment overrides merged on top of the environment file.
    pub env: Option<HashMap<String, String>>,
    /// Path to a `.env`/`envFile` to load (F.6 #5).
    pub env_file: Option<String>,
    /// Optional override for the Python interpreter when `debug_type = python`.
    pub python_path: Option<String>,
    /// Optional override for the Ruby debugger executable (`rdbg`) path.
    pub ruby_path: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: u64,
    pub debug_type: String,
    pub label: String,
    pub state: String,
}

// ── Session manager state (F.6 #7 — map of sessions, not a global singleton) ─

struct Session {
    info: SessionInfo,
    /// Frontend → adapter message sink (framed & written by a writer task).
    tx: Option<mpsc::Sender<String>>,
    /// Whatever process the session owns and must kill/clean on stop.
    child: Option<Child>,
}

pub struct DebugState {
    sessions: Arc<Mutex<HashMap<u64, Session>>>,
    next_id: AtomicU64,
}

impl DebugState {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            next_id: AtomicU64::new(1),
        }
    }
}

// ── F.5.3 / F.5.4 — static adapter registry + auto-detect ────────────────────

const NODE_ENTRY_POINTS: &[&str] = &["index.js", "main.js", "app.js", "server.js"];
const PY_ENTRY_POINTS: &[&str] = &["main.py", "app.py", "__main__.py", "manage.py"];
const GO_ENTRY_POINTS: &[&str] = &["main.go", "cmd/main.go", "cmd/app/main.go"];
const RB_ENTRY_POINTS: &[&str] = &["main.rb", "app.rb", "bin/rails"];

/// Auto-detect the debug adapter family for a given path (file or folder).
pub fn detect_debug_type(path: &Path) -> Option<String> {
    if let Some(ext) = path.extension() {
        let ext = ext.to_string_lossy().to_ascii_lowercase();
        match ext.as_str() {
            "js" | "cjs" | "mjs" | "ts" | "mts" | "cts" | "jsx" | "tsx" => {
                return Some("node".to_string())
            }
            "py" | "pyw" => return Some("python".to_string()),
            "go" => return Some("go".to_string()),
            "rb" | "rake" | "gemspec" => return Some("ruby".to_string()),
            _ => {}
        }
    }

    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    if NODE_ENTRY_POINTS.contains(&name.as_str()) {
        return Some("node".to_string());
    }
    if PY_ENTRY_POINTS.contains(&name.as_str()) {
        return Some("python".to_string());
    }
    if GO_ENTRY_POINTS.contains(&name.as_str()) {
        return Some("go".to_string());
    }
    if RB_ENTRY_POINTS.contains(&name.as_str()) {
        return Some("ruby".to_string());
    }

    if path.is_dir() {
        if path.join("package.json").exists() {
            return Some("node".to_string());
        }
        if path.join("pyproject.toml").exists() || path.join("requirements.txt").exists() {
            return Some("python".to_string());
        }
        if path.join("go.mod").exists() || path.join("Gopkg.toml").exists() {
            return Some("go".to_string());
        }
        if path.join("Gemfile").exists() || path.join(".ruby-version").exists() {
            return Some("ruby".to_string());
        }
    }

    None
}



// ── .env loader (F.6 #5) ─────────────────────────────────────────────────────

/// Minimal, robust `.env` parser: `KEY=VALUE`, `#`/`;` comments, and `export `
/// prefixes. Surrounding quotes are stripped from values.
fn parse_env_file(raw: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with(';') {
            continue;
        }
        let line = line.strip_prefix("export ").unwrap_or(line).trim();
        let Some(eq) = line.find('=') else { continue };
        let key = line[..eq].trim();
        if key.is_empty() {
            continue;
        }
        let mut value = line[eq + 1..].trim().to_string();
        if value.len() >= 2
            && ((value.starts_with('"') && value.ends_with('"'))
                || (value.starts_with('\'') && value.ends_with('\'')))
        {
            value = value[1..value.len() - 1].to_string();
        }
        map.insert(key.to_string(), value);
    }
    map
}

fn load_env_file(path: Option<&str>) -> HashMap<String, String> {
    if let Some(p) = path {
        if let Ok(raw) = std::fs::read_to_string(p) {
            return parse_env_file(&raw);
        }
    }
    HashMap::new()
}

// ── Process-tree termination (F.6 #6) ───────────────────────────────────────

/// Kill the process identified by `pid` together with its entire descendancy.
#[cfg(windows)]
fn kill_process_tree(pid: u32) {
    use std::os::windows::process::CommandExt;
    // taskkill /PID <pid> /T /F kills the child and all of its descendants.
    let _ = std::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
        .status();
}

#[cfg(not(windows))]
fn kill_process_tree(pid: u32) {
    // The adapter/debuggee child is spawned in its own process group
    // (process_group(0)), so SIGKILL on the negative pid terminates the group.
    let _ = std::process::Command::new("kill")
        .args(["-KILL", &format!("-{pid}"), &pid.to_string()])
        .status();
}

// ── DAP base-protocol framing ────────────────────────────────────────────────

async fn write_dap_frame<W: AsyncWriteExt + Unpin>(w: &mut W, msg: &str) -> std::io::Result<()> {
    let header = format!("Content-Length: {}\r\n\r\n", msg.len());
    w.write_all(header.as_bytes()).await?;
    w.write_all(msg.as_bytes()).await?;
    w.flush().await
}

/// Read one DAP frame. Returns `Ok(None)` on clean EOF.
async fn read_dap_frame<R: AsyncBufReadExt + Unpin>(r: &mut R) -> std::io::Result<Option<String>> {
    let mut content_len: Option<usize> = None;
    loop {
        let mut line = String::new();
        let n = r.read_line(&mut line).await?;
        if n == 0 {
            return Ok(None); // EOF before/after headers
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            break; // end of headers
        }
        if let Some(rest) = trimmed.strip_prefix("Content-Length:") {
            if let Ok(len) = rest.trim().parse::<usize>() {
                content_len = Some(len);
            }
        }
    }
    let len = content_len
        .ok_or_else(|| std::io::Error::new(IoErrorKind::InvalidData, "missing Content-Length"))?;
    let mut buf = vec![0u8; len];
    r.read_exact(&mut buf).await?;
    Ok(Some(String::from_utf8_lossy(&buf).into_owned()))
}

// ── Adapter resolution ───────────────────────────────────────────────────────

/// A debuggee/adapter process that exposes DAP on a TCP endpoint we attach to
/// (Node `js-debug-dap` server, Python `debugpy`). Its stdout/stderr is
/// streamed to the Debug Console; DAP flows over the TCP connection.
enum AdapterPlan {
    Socket {
        host: String,
        port: u16,
        program: Vec<String>,
        cwd: Option<String>,
    },
}

/// Check whether `candidate` resolves to a runnable executable on PATH.
fn which(candidate: &str) -> Option<String> {
    let status = std::process::Command::new(candidate)
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    if status.map(|s| s.success()).unwrap_or(false) {
        Some(candidate.to_string())
    } else {
        None
    }
}

fn find_node_runtime() -> Option<String> {
    for c in ["node", "nodejs"] {
        if let Some(found) = which(c) {
            return Some(found);
        }
    }
    None
}

/// Locate `dlv` (Go: the Delve debugger with DAP support, §F.5.2 strategy C).
/// Prefers a workspace-local install, then GOPATH/bin, then PATH.
fn find_dlv(cwd: Option<&Path>) -> Option<String> {
    if let Some(dir) = cwd {
        for rel in ["bin/dlv", "vendor/bin/dlv", "dlv"] {
            let p = dir.join(rel);
            if p.exists() {
                return Some(p.to_string_lossy().into_owned());
            }
        }
    }
    for c in ["dlv"] {
        if let Some(found) = which(c) {
            return Some(found);
        }
    }
    // GOPATH/bin fallback (developer Go toolchains install it there)
    if let Ok(gopath) = std::env::var("GOPATH") {
        let p = Path::new(&gopath).join("bin").join(if cfg!(windows) { "dlv.exe" } else { "dlv" });
        if p.exists() {
            return Some(p.to_string_lossy().into_owned());
        }
    }
    None
}

/// Locate the Ruby debugger (`rdbg` from the `debug` gem, default since Ruby
/// 3.1, §F.5.2 strategy C). Checks PATH, then `bundle exec rdbg`, then
/// `gem which`-style resolution is left to a probe on the resolved executable.
fn find_rdbg(cwd: Option<&Path>, explicit: Option<&str>) -> Option<String> {
    if let Some(p) = explicit {
        if Path::new(p).exists() || which(p).is_some() {
            return Some(p.to_string());
        }
    }
    // In project bundler context, bundle exec rdbg is authoritative.
    if let Some(dir) = cwd {
        let has_gemfile = dir.join("Gemfile").exists() || dir.join("gems.rb").exists();
        let has_bundler = which("bundle").is_some();
        if has_gemfile && has_bundler && which("bundle").is_some() {
            return Some("bundle".to_string()); // invoked as `bundle exec rdbg …`
        }
    }
    if let Some(found) = which("rdbg") {
        return Some(found);
    }
    // Ruby 3.1+ bundles the `debug` gem but `rdbg` may be a gem executable.
    if let Some(ruby) = which("ruby") {
        if ruby_has_debug_gem(&ruby) {
            return Some("ruby".to_string()); // invoked as `ruby -r debug/open …`
        }
    }
    None
}

/// Ask `ruby` whether the `debug` gem is resolvable.
fn ruby_has_debug_gem(ruby: &str) -> bool {
    std::process::Command::new(ruby)
        .args(["-e", "require 'debug'; puts 'ok'"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn find_python(cwd: Option<&Path>, explicit: Option<&str>) -> Option<String> {
    if let Some(p) = explicit {
        if Path::new(p).exists() || which(p).is_some() {
            return Some(p.to_string());
        }
    }
    if let Some(dir) = cwd {
        for rel in [
            ".venv/Scripts/python.exe",
            ".venv/bin/python",
            "venv/Scripts/python.exe",
            "venv/bin/python",
        ] {
            let p = dir.join(rel);
            if p.exists() {
                return Some(p.to_string_lossy().into_owned());
            }
        }
    }
    for c in ["python", "python3", "py"] {
        if let Some(found) = which(c) {
            return Some(found);
        }
    }
    None
}

/// Locate the bundled `js-debug-dap` standalone DAP server (strategy A). In dev
/// builds it lives in `src-tauri/resources`; in release builds it is copied to
/// the resource directory by Tauri's `bundle.resources` configuration.
fn find_node_dap_server(app: &tauri::AppHandle) -> Result<String, String> {
    const REL: &str = "js-debug/src/dapDebugServer.js";
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let dev_candidate = manifest.join("resources").join(REL);
    if dev_candidate.exists() {
        return Ok(dev_candidate.to_string_lossy().into_owned());
    }
    if let Ok(res_dir) = app.path().resource_dir() {
        let release_candidate = res_dir.join(REL);
        if release_candidate.exists() {
            return Ok(release_candidate.to_string_lossy().into_owned());
        }
    }
    Err("Bundled Node.js DAP server (js-debug-dap) not found under resources. \
         Re-run with the `resources/js-debug` folder present."
        .to_string())
}

fn pick_free_port() -> Result<u16, String> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    drop(listener);
    Ok(port)
}

/// Connect to a DAP server with a short retry loop (the server process needs a
/// moment to bind its socket after spawning). Tries both loopback families so
/// a server bound to either IPv4 or IPv6 localhost is reachable.
async fn connect_with_retry(host: &str, port: u16) -> std::io::Result<TcpStream> {
    let mut candidates = vec![format!("{host}:{port}")];
    candidates.push(format!("[::1]:{port}"));
    if host.eq_ignore_ascii_case("localhost") {
        candidates.push(format!("127.0.0.1:{port}"));
    }
    let attempts = 50;
    for i in 0..attempts {
        for addr in &candidates {
            if let Ok(s) = TcpStream::connect(addr.as_str()).await {
                return Ok(s);
            }
        }
        if i + 1 < attempts {
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        }
    }
    Err(std::io::Error::new(
        std::io::ErrorKind::TimedOut,
        "timed out connecting to the debug server",
    ))
}

// ━━ Adapter resolution ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Ask the given interpreter whether it can already import `debugpy`.
fn debugpy_importable(python: &str) -> bool {
    std::process::Command::new(python)
        .arg("-c")
        .arg("import debugpy")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Strategy C + A2 (VSCode-style auto-provision): use the environment's
/// `debugpy` if importable; otherwise transparently `pip install debugpy` into
/// that same interpreter and re-check. This keeps the installer light (no
/// bundled ~30 MB copy) while giving a zero-manual-step first-run experience.
fn ensure_debugpy(python: &str) -> Result<(), String> {
    if debugpy_importable(python) {
        return Ok(());
    }
    let result = std::process::Command::new(python)
        .args(["-m", "pip", "install", "debugpy"])
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("Failed to run `{python} -m pip install debugpy`: {e}"))?;
    if !result.status.success() {
        let stderr = String::from_utf8_lossy(&result.stderr);
        return Err(format!(
            "`debugpy` was not available and auto-install failed. Installing manually: `{python} -m pip install debugpy`\n{stderr}"
        ));
    }
    if !debugpy_importable(python) {
        return Err(format!(
            "`debugpy` was installed but is still not importable with {python}. \
             Running a virtual environment? Install into it: `{python} -m pip install debugpy`"
        ));
    }
    Ok(())
}

fn resolve_adapter(app: &tauri::AppHandle, config: &DebugConfig) -> Result<AdapterPlan, String> {
    match config.debug_type.as_str() {
        "node" | "pwa-node" | "node-terminal" => {
            if config.request != "launch" {
                return Err("Node attach is not supported yet".to_string());
            }
            let server = find_node_dap_server(app)?;
            let node = find_node_runtime()
                .ok_or_else(|| "Node.js runtime not found on PATH".to_string())?;
            let port = pick_free_port()?;
            Ok(AdapterPlan::Socket {
                host: "localhost".to_string(),
                port,
                // `dapDebugServer.js <port> <host>`: a standalone DAP server that
                // listens on the given TCP endpoint; we attach to it. The target
                // program is spawned by the server itself on the DAP `launch`
                // request.
                program: vec![node, server, port.to_string(), "localhost".to_string()],
                cwd: None,
            })
        }
        "python" | "debugpy" => {
            if config.request != "launch" {
                return Err("Python attach is not supported yet".to_string());
            }
            let program = config
                .program
                .clone()
                .ok_or_else(|| "Debug config requires a \"program\"".to_string())?;
            let cwd = config.cwd.as_ref().map(|c| Path::new(c));
            let python = find_python(cwd, config.python_path.as_deref())
                .ok_or_else(|| "Python interpreter not found. Set \"pythonPath\" or use a venv.".to_string())?;

            // Strategy C + A2: prefer the environment's `debugpy`, auto-install
            // into it if missing (like VS Code). No manual pip step needed.
            ensure_debugpy(&python)?;

            let port = pick_free_port()?;
            let listen = format!("127.0.0.1:{port}");
            let mut program_args = vec![
                python.clone(),
                "-m".to_string(),
                "debugpy".to_string(),
                "--listen".to_string(),
                listen,
                "--wait-for-client".to_string(),
                program,
            ];
            program_args.extend(config.args.iter().cloned());

            Ok(AdapterPlan::Socket {
                host: "127.0.0.1".to_string(),
                port,
                program: program_args,
                cwd: config.cwd.clone(),
            })
        }
        "go" => {
            if config.request != "launch" {
                return Err("Go attach is not supported yet".to_string());
            }
            // §F.5.2 strategy C — detect `dlv` first (strategy A download
            // on-demand is a future AdapterProvisioningService enhancement).
            let cwd = config.cwd.as_ref().map(|c| Path::new(c));
            let dlv = find_dlv(cwd)
                .ok_or_else(|| "Delve (`dlv`) not found on PATH/GOPATH. Install: `go install github.com/go-delve/delve/cmd/dlv@latest`".to_string())?;
            let port = pick_free_port()?;
            let listen = format!("127.0.0.1:{port}");
            // `dlv dap --listen=addr` runs Delve as a headless DAP server; the
            // target program is spawned by Delve itself on the DAP `launch`
            // request. We attach as the DAP client.
            Ok(AdapterPlan::Socket {
                host: "127.0.0.1".to_string(),
                port,
                program: vec![dlv, "dap".to_string(), format!("--listen={listen}")],
                cwd: config.cwd.clone(),
            })
        }
        "ruby" | "rdbg" => {
            if config.request != "launch" {
                return Err("Ruby attach is not supported yet".to_string());
            }
            let program = config
                .program
                .clone()
                .ok_or_else(|| "Debug config requires a \"program\"".to_string())?;
            let cwd = config.cwd.as_ref().map(|c| Path::new(c));
            let rdbg = find_rdbg(cwd, config.ruby_path.as_deref())
                .ok_or_else(|| "Ruby debugger (`rdbg` / `debug` gem) not found on PATH. Ruby 3.1+ bundles it; otherwise run `gem install debug`.".to_string())?;
            let port = pick_free_port()?;

            // `rdbg --open --port N <script>` runs the program as a debuggee and
            // serves the DAP protocol on a local TCP port we attach to.
            let mut program_args = if rdbg == "bundle" {
                vec![
                    "bundle".to_string(),
                    "exec".to_string(),
                    "rdbg".to_string(),
                    "--open".to_string(),
                    "--port".to_string(),
                    port.to_string(),
                    program,
                ]
            } else {
                vec![
                    rdbg,
                    "--open".to_string(),
                    "--port".to_string(),
                    port.to_string(),
                    program,
                ]
            };
            program_args.extend(config.args.iter().cloned());

            Ok(AdapterPlan::Socket {
                host: "127.0.0.1".to_string(),
                port,
                program: program_args,
                cwd: config.cwd.clone(),
            })
        }
        other => Err(format!("Debug type \"{other}\" is not supported yet")),
    }
}

fn build_env(config: &DebugConfig) -> std::collections::HashMap<String, String> {
    let mut merged = load_env_file(config.env_file.as_deref());
    if let Some(overrides) = &config.env {
        for (k, v) in overrides {
            merged.insert(k.clone(), v.clone());
        }
    }
    merged
}

// ── Task helpers ─────────────────────────────────────────────────────────────

/// Reader: pull DAP frames off the adapter stream and forward them to the Channel.
fn spawn_dap_reader<R>(reader: R, channel: Channel<SessionEvent>) -> tokio::task::JoinHandle<()>
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut reader = BufReader::new(reader);
        loop {
            match read_dap_frame(&mut reader).await {
                Ok(Some(payload)) => {
                    let _ = channel.send(SessionEvent::Dap { payload });
                }
                Ok(None) | Err(_) => break,
            }
        }
        let _ = channel.send(SessionEvent::Terminated { code: None });
    })
}

/// Reader: forward debuggee stdout/stderr to the Channel as Output events.
fn spawn_output_reader<R>(
    reader: R,
    stream: &'static str,
    channel: Channel<SessionEvent>,
) -> tokio::task::JoinHandle<()>
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut reader = BufReader::new(reader);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line).await {
                Ok(0) => break,
                Ok(_) => {
                    let _ = channel.send(SessionEvent::Output {
                        stream: stream.to_string(),
                        line: line.clone(),
                    });
                }
                Err(_) => break,
            }
        }
    })
}

/// Writer: take messages from the mpsc queue and frame them onto the stream.
fn spawn_dap_writer<W>(mut rx: mpsc::Receiver<String>, mut writer: W) -> tokio::task::JoinHandle<()>
where
    W: tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if write_dap_frame(&mut writer, &msg).await.is_err() {
                break;
            }
        }
        let _ = writer.shutdown().await;
    })
}

// ── Session lifecycle ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn debug_start_session(
    app: tauri::AppHandle,
    state: tauri::State<'_, DebugState>,
    config: DebugConfig,
    channel: Channel<SessionEvent>,
) -> Result<u64, String> {
    let plan = resolve_adapter(&app, &config)?;
    let session_id = state.next_id.fetch_add(1, Ordering::Relaxed);
    let label = config
        .program
        .clone()
        .unwrap_or_else(|| "<program>".to_string());
    let (tx, rx) = mpsc::channel::<String>(128);

    // Environment variables shared by every spawned process.
    let env_kvs: Vec<(String, String)> = build_env(&config).into_iter().collect();

    let session = match plan {
        AdapterPlan::Socket {
            host,
            port,
            program,
            cwd,
        } => {
            let mut cmd = Command::new(&program[0]);
            cmd.args(&program[1..]);
            if let Some(c) = &cwd {
                cmd.current_dir(c);
            }
            for (k, v) in &env_kvs {
                cmd.env(k, v);
            }
            cmd.stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            #[cfg(unix)]
            cmd.process_group(0);
            let mut child = cmd
                .spawn()
                .map_err(|e| format!("Failed to spawn debuggee: {e}"))?;

            let stdout = child.stdout.take().unwrap();
            let stderr = child.stderr.take().unwrap();
            spawn_output_reader(stderr, "stderr", channel.clone());
            spawn_output_reader(stdout, "stdout", channel.clone());

            // Attach to the adapter's DAP endpoint; on failure clean up.
            let sock = match connect_with_retry(&host, port).await {
                Ok(s) => s,
                Err(e) => {
                    if let Some(pid) = child.id() {
                        kill_process_tree(pid);
                    }
                    let _ = child.start_kill();
                    return Err(format!("Failed to attach to debug server at {host}:{port}: {e}"));
                }
            };

            let (read_half, write_half) = sock.into_split();
            spawn_dap_reader(read_half, channel.clone());
            spawn_dap_writer(rx, write_half);

            Session {
                info: SessionInfo {
                    id: session_id,
                    debug_type: config.debug_type.clone(),
                    label,
                    state: "running".to_string(),
                },
                tx: Some(tx),
                child: Some(child),
            }
        }
    };

    state.sessions.lock().await.insert(session_id, session);
    Ok(session_id)
}

#[tauri::command]
pub async fn debug_send_message(
    state: tauri::State<'_, DebugState>,
    session_id: u64,
    message: String,
) -> Result<(), String> {
    let tx = {
        let sessions = state.sessions.lock().await;
        sessions
            .get(&session_id)
            .ok_or_else(|| "No such debug session".to_string())?
            .tx
            .clone()
    };
    match tx {
        Some(tx) => tx.send(message).await.map_err(|e| e.to_string()),
        None => Err("Debug session is not writable".to_string()),
    }
}

#[tauri::command]
pub async fn debug_stop_session(
    state: tauri::State<'_, DebugState>,
    session_id: u64,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock().await;
    match sessions.remove(&session_id) {
        Some(mut session) => {
            if let Some(child) = session.child.as_mut() {
                if let Some(pid) = child.id() {
                    kill_process_tree(pid);
                }
                let _ = child.start_kill();
            }
            session.tx.take();
            Ok(())
        }
        None => Err("No such debug session".to_string()),
    }
}

#[tauri::command]
pub async fn debug_list_sessions(
    state: tauri::State<'_, DebugState>,
) -> Result<Vec<SessionInfo>, String> {
    let sessions = state.sessions.lock().await;
    let mut list: Vec<SessionInfo> = sessions.values().map(|s| s.info.clone()).collect();
    list.sort_by_key(|i| i.id);
    Ok(list)
}

#[tauri::command]
pub fn debug_detect_type(path: String) -> Result<Option<String>, String> {
    Ok(detect_debug_type(Path::new(&path)))
}