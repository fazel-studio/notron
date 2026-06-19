mod config;
mod db;
mod file_ops;
mod fs_watcher;
mod symbol_index;

use tauri::Manager;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
async fn show_main_window(window: tauri::Window) {
    let _ = window.show();
    let _ = window.set_focus();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_pty::init())
        .setup(|app| {
            // Initialize DB with connection pool (replaces single Mutex<Connection>)
            let pool = db::init_db(app.handle()).expect("Failed to initialize database");
            app.manage(db::DbState(pool));

            let config = config::load_config(app.handle());
            app.manage(config::ConfigState(std::sync::Mutex::new(config)));

            // Initialize FS Watcher state
            app.manage(fs_watcher::WatcherState::new());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
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
            // ── Tiered State Commands ──
            db::load_critical_state,
            db::save_critical_state,
            db::load_ui_state,
            db::save_ui_state,
            db::load_session_state,
            db::save_session_state,
            // ── IPC Batch Query ──
            db::batch_query,
            // ── Config ──
            config::get_config,
            config::set_config,
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
            file_ops::search_in_files,
            file_ops::search_in_files_stream,
            file_ops::cancel_search,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
