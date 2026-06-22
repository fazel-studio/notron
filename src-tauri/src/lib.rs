mod config;
mod db;
mod file_ops;
mod fs_watcher;
mod symbol_index;

use serde::Serialize;
use tauri::{Manager, Emitter};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn show_main_window(window: tauri::Window, state: tauri::State<'_, config::CriticalConfigState>) -> Result<(), String> {
    let critical_config = state.0.lock().unwrap().clone();
    
    if !critical_config.window_maximized {
        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
            width: critical_config.window_width as f64,
            height: critical_config.window_height as f64,
        }));
        if let (Some(x), Some(y)) = (critical_config.window_x, critical_config.window_y) {
            let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }));
        }
    }

    if critical_config.window_maximized {
        let _ = window.maximize();
    }
    let _ = window.show();
    let _ = window.set_focus();
    
    Ok(())
}

#[tauri::command]
async fn open_new_window(app_handle: tauri::AppHandle) -> Result<(), String> {
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let label = format!("notron-{}", timestamp);
    
    tauri::WebviewWindowBuilder::new(
        &app_handle,
        label,
        tauri::WebviewUrl::App("/?clean=true".into())
    )
    .title("Notron")
    .inner_size(1200.0, 800.0)
    .decorations(false)
    .transparent(true)
    .visible(false) // Wait for show_main_window
    .build()
    .map_err(|e| e.to_string())?;
    
    Ok(())
}

// ── Startup State: Single IPC round-trip for ALL startup data ──

#[derive(Serialize, Debug, Clone)]
struct StartupState {
    config: config::AppConfig,
    critical: config::CriticalConfig,
    ui_state: Option<db::UiStateRow>,
    session_pairs: Vec<(String, String)>,
}

#[tauri::command]
async fn load_startup_state(
    workspace_id: Option<String>,
    config_state: tauri::State<'_, config::ConfigState>,
    critical_state: tauri::State<'_, config::CriticalConfigState>,
    db_state: tauri::State<'_, db::DbState>,
) -> Result<StartupState, String> {
    // Read config and critical from memory (fast, sync via mutex)
    let app_config = config_state.0.lock().unwrap().clone();
    let critical_config = critical_state.0.lock().unwrap().clone();

    // If workspace_id provided, query UI state and session from DB
    let (ui_state, session_pairs) = if let Some(ref wid) = workspace_id {
        let w = wid.clone();
        let pool = db_state.0.clone();
        tokio::task::spawn_blocking(move || {
            let conn = pool.get().map_err(|e| format!("Pool error: {}", e))?;
            // Apply per-connection PRAGMAs
            let _ = conn.execute_batch("
                PRAGMA cache_size = -65536;
                PRAGMA mmap_size  = 268435456;
                PRAGMA temp_store = MEMORY;
            ");

            // Query UI state
            let ui = match conn.query_row(
                "SELECT sidebar_width, panel_height, sidebar_visible, expanded_folder_paths,
                        active_sidebar_panel, is_minimap_enabled
                 FROM ui_state WHERE workspace_id = ?1",
                rusqlite::params![w],
                |row| {
                    Ok(db::UiStateRow {
                        sidebar_width: row.get(0)?,
                        panel_height: row.get(1)?,
                        sidebar_visible: row.get::<_, Option<i64>>(2)?.map(|v| v != 0),
                        expanded_folder_paths: row.get(3)?,
                        active_sidebar_panel: row.get(4)?,
                        is_minimap_enabled: row.get::<_, Option<i64>>(5)?.map(|v| v != 0),
                    })
                },
            ) {
                Ok(s) => Some(s),
                Err(rusqlite::Error::QueryReturnedNoRows) => None,
                Err(e) => return Err(e.to_string()),
            };

            // Query legacy session pairs from workspace_state
            let mut stmt = conn.prepare(
                "SELECT key, value FROM workspace_state WHERE workspace_path = ?1"
            ).map_err(|e| e.to_string())?;
            let rows = stmt.query_map(rusqlite::params![w], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            }).map_err(|e| e.to_string())?;

            let mut pairs = Vec::new();
            for row in rows {
                pairs.push(row.map_err(|e| e.to_string())?);
            }

            Ok::<_, String>((ui, pairs))
        })
        .await
        .map_err(|e| e.to_string())??
    } else {
        (None, Vec::new())
    };

    Ok(StartupState {
        config: app_config,
        critical: critical_config,
        ui_state,
        session_pairs,
    })
}

#[cfg(debug_assertions)]
fn start_memory_monitor(_app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut sys = sysinfo::System::new();
        let pid = sysinfo::get_current_pid().unwrap();
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
            sys.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[pid]), true);
            if let Some(process) = sys.process(pid) {
                let usage = process.memory(); // memory in bytes
                if usage > 500 * 1024 * 1024 { // > 500MB
                    eprintln!("Memory usage high: {}MB", usage / 1024 / 1024);
                } else {
                    println!("Memory usage: {}MB", usage / 1024 / 1024);
                }
            }
        }
    });
}

#[cfg(debug_assertions)]
fn setup_logging() {
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::DEBUG)
        .init();
}

#[cfg(not(debug_assertions))]
fn setup_logging(app: &tauri::App) {
    use tracing_appender::rolling;
    let log_dir = app.path().app_log_dir().expect("failed to get log dir");
    std::fs::create_dir_all(&log_dir).expect("failed to create log dir");
    let file_appender = rolling::daily(log_dir, "ide.log");
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::WARN)
        .with_writer(file_appender)
        .init();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_pty::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(path) = argv.get(1) {
                let _ = app.emit("open-path", path);
            }
        
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            #[cfg(debug_assertions)]
            setup_logging();
            
            #[cfg(not(debug_assertions))]
            setup_logging(app);

            // Phase 0: Read critical config synchronously BEFORE anything else
            let critical_cfg = config::read_critical_config(app.handle());
            app.manage(config::CriticalConfigState(std::sync::Mutex::new(critical_cfg)));

            // Initialize DB with connection pool
            let pool = db::init_db(app.handle()).expect("Failed to initialize database");
            app.manage(db::DbState(pool));

            let config = config::load_config(app.handle());
            app.manage(config::ConfigState(std::sync::Mutex::new(config)));

            // Initialize FS Watcher state
            app.manage(fs_watcher::WatcherState::new());
            
            app.manage(file_ops::SearchRegistry {
                active_searches: std::sync::Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new())),
            });

            #[cfg(debug_assertions)]
            start_memory_monitor(app.handle().clone());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            // ── Startup ──
            load_startup_state,
            // ── Legacy DB Commands ──
            db::add_recent_file,
            db::get_recent_files,
            db::clear_recent_files,
            db::get_setting,
            db::set_setting,
            db::save_workspace_state,
            db::load_workspace_state,
            db::delete_workspace_state,
            db::save_workspace_sidebar_width,
            db::save_workspace_expanded_paths,
            db::save_workspace_session,
            // ── Tiered Settings Commands ──
            db::load_global_settings,
            db::load_workspace_settings,
            db::save_global_setting,
            db::save_workspace_setting,
            db::delete_workspace_setting,
            // ── Tiered State Commands ──
            db::load_critical_state,
            db::save_critical_state,
            db::load_ui_state,
            db::save_ui_state,
            db::load_session_state,
            db::save_session_state,
            db::check_crash_flag,
            db::set_crash_flag,
            db::save_dirty_tab_snapshots,
            db::get_dirty_tab_snapshots,
            // ── IPC Batch Query ──
            db::batch_query,
            // ── Config ──
            config::get_config,
            config::set_config,
            config::get_critical_config,
            config::save_critical_config,
            // ── File Operations ──
            file_ops::open_file,
            file_ops::open_file_with_meta,
            file_ops::read_file_binary,
            file_ops::read_file_text,
            file_ops::read_file_chunked,
            file_ops::save_file,
            file_ops::read_directory,
            file_ops::read_directory_flat,
            file_ops::read_directory_batch,
            file_ops::get_file_info,
            file_ops::file_exists,
            file_ops::is_large_file,
            file_ops::create_directory,
            file_ops::detect_language,
            file_ops::rename_item,
            file_ops::delete_item,
            file_ops::copy_item,
            file_ops::create_file,
            file_ops::search_workspace,
            file_ops::cancel_search,
            file_ops::list_all_files,
            file_ops::batch_read_files,
            file_ops::get_files_metadata,
            // ── FS Watcher ──
            fs_watcher::start_fs_watch,
            fs_watcher::stop_fs_watch,
            // ── Symbol Index ──
            symbol_index::index_workspace,
            symbol_index::get_symbol_index,
            symbol_index::get_file_symbols,
            symbol_index::goto_definition,
            symbol_index::find_references,
            symbol_index::rename_symbol,
            show_main_window,
            open_new_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
