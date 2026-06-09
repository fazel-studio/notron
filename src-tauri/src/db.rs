use rusqlite::{Connection, Result as SqlResult, params};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use std::sync::Mutex;

pub struct DbState(pub Mutex<Option<Connection>>);

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RecentFile {
    pub id: i64,
    pub path: String,
    pub name: String,
    pub opened_at: i64,
    pub file_type: String,
}

#[allow(dead_code)]
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Bookmark {
    pub id: i64,
    pub file_path: String,
    pub line_number: i64,
    pub label: String,
    pub created_at: i64,
}

pub fn init_db(app_handle: &AppHandle) -> SqlResult<Connection> {
    let app_dir = app_handle.path().app_data_dir().expect("failed to get app data dir");
    std::fs::create_dir_all(&app_dir).expect("failed to create app data dir");
    let db_path = app_dir.join("notron_db.sqlite");
    
    let conn = Connection::open(db_path)?;
    
    conn.execute(
        "CREATE TABLE IF NOT EXISTS recent_files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            opened_at INTEGER NOT NULL,
            file_type TEXT NOT NULL
        )",
        [],
    )?;
    
    conn.execute(
        "CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS bookmarks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_path TEXT NOT NULL,
            line_number INTEGER NOT NULL,
            label TEXT,
            created_at INTEGER NOT NULL
        )",
        [],
    )?;

    Ok(conn)
}

#[tauri::command]
pub fn add_recent_file(
    path: String,
    name: String,
    file_type: String,
    state: tauri::State<DbState>,
) -> Result<(), String> {
    let lock = state.0.lock().unwrap();
    let conn = lock.as_ref().ok_or("Database not initialized")?;
    
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    conn.execute(
        "INSERT INTO recent_files (path, name, opened_at, file_type) 
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(path) DO UPDATE SET opened_at = ?3",
        params![path, name, now, file_type],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn get_recent_files(state: tauri::State<DbState>) -> Result<Vec<RecentFile>, String> {
    let lock = state.0.lock().unwrap();
    let conn = lock.as_ref().ok_or("Database not initialized")?;
    
    let mut stmt = conn.prepare("SELECT id, path, name, opened_at, file_type FROM recent_files ORDER BY opened_at DESC LIMIT 20").map_err(|e| e.to_string())?;
    
    let files_iter = stmt.query_map([], |row| {
        Ok(RecentFile {
            id: row.get(0)?,
            path: row.get(1)?,
            name: row.get(2)?,
            opened_at: row.get(3)?,
            file_type: row.get(4)?,
        })
    }).map_err(|e| e.to_string())?;
    
    let mut files = Vec::new();
    for file in files_iter {
        files.push(file.map_err(|e| e.to_string())?);
    }
    
    Ok(files)
}

#[tauri::command]
pub fn clear_recent_files(state: tauri::State<DbState>) -> Result<(), String> {
    let lock = state.0.lock().unwrap();
    let conn = lock.as_ref().ok_or("Database not initialized")?;
    
    conn.execute("DELETE FROM recent_files", []).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_setting(key: String, state: tauri::State<DbState>) -> Result<Option<String>, String> {
    let lock = state.0.lock().unwrap();
    let conn = lock.as_ref().ok_or("Database not initialized")?;
    
    let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1").map_err(|e| e.to_string())?;
    
    let mut rows = stmt.query(params![key]).map_err(|e| e.to_string())?;
    
    if let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let value: String = row.get(0).map_err(|e| e.to_string())?;
        Ok(Some(value))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub fn set_setting(key: String, value: String, state: tauri::State<DbState>) -> Result<(), String> {
    let lock = state.0.lock().unwrap();
    let conn = lock.as_ref().ok_or("Database not initialized")?;
    
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2",
        params![key, value],
    ).map_err(|e| e.to_string())?;
    
    Ok(())
}
