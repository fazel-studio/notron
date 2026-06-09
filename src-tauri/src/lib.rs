mod config;
mod db;
mod file_ops;
mod document;
mod converter;

use std::sync::Mutex;
use tauri::Manager;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let conn = db::init_db(app.handle()).expect("Failed to initialize database");
            app.manage(db::DbState(Mutex::new(Some(conn))));
            
            let config = config::load_config(app.handle());
            app.manage(config::ConfigState(Mutex::new(config)));
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            db::add_recent_file,
            db::get_recent_files,
            db::clear_recent_files,
            db::get_setting,
            db::set_setting,
            config::get_config,
            config::set_config,
            file_ops::open_file,
            file_ops::read_file_binary,
            file_ops::save_file,
            file_ops::read_directory,
            file_ops::get_file_info,
            file_ops::file_exists,
            file_ops::create_dir,
            file_ops::detect_language,
            file_ops::rename_item,
            file_ops::delete_item,
            file_ops::copy_item,
            file_ops::create_file,
            file_ops::search_in_files,
            document::read_csv,
            document::write_csv,
            document::read_docx,
            document::write_docx,
            converter::convert_file,
            converter::get_conversion_formats,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
