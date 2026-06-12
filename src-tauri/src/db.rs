use rusqlite::{Connection, Result as SqlResult, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
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

// ============================================================
// Tiered State Structs (Section 1.1 - Tiered State Loading)
// ============================================================

/// Tier 1: Critical State — must load before first render (<20ms)
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct CriticalState {
    pub window_width: Option<i64>,
    pub window_height: Option<i64>,
    pub window_x: Option<i64>,
    pub window_y: Option<i64>,
    pub active_workspace_id: Option<String>,
    pub active_tab_path: Option<String>,
}

/// Tier 2: UI State — layout info (<50ms)
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct UiStateRow {
    pub sidebar_width: Option<i64>,
    pub panel_height: Option<i64>,
    pub sidebar_visible: Option<bool>,
    pub expanded_folder_paths: Option<String>, // JSON array
    pub active_sidebar_panel: Option<String>,
    pub is_minimap_enabled: Option<bool>,
}

/// Tier 3: Session State — tab metadata (<300ms, can be background)
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct SessionStateRow {
    pub open_tabs_json: Option<String>,    // JSON array of tab metadata
    pub active_tab_id: Option<String>,
    pub scroll_positions_json: Option<String>, // JSON
    pub editor_snapshots_json: Option<String>, // JSON
}

// IPC batch query types (Section 1.4 + 6.1)
#[derive(Deserialize, Debug)]
pub struct BatchOperation {
    pub op: String,
    pub args: Value,
}

#[derive(Serialize, Debug)]
pub struct BatchResult {
    pub ok: bool,
    pub data: Value,
    pub error: Option<String>,
}

const SCHEMA_VERSION: i64 = 2;

pub fn init_db(app_handle: &AppHandle) -> SqlResult<Connection> {
    let app_dir = app_handle.path().app_data_dir().expect("failed to get app data dir");
    std::fs::create_dir_all(&app_dir).expect("failed to create app data dir");
    let db_path = app_dir.join("notron_db.sqlite");

    let conn = Connection::open(db_path)?;

    // === Section 2.1: Full PRAGMA set for maximum performance ===
    conn.execute_batch("
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous  = NORMAL;
        PRAGMA cache_size   = -65536;
        PRAGMA mmap_size    = 268435456;
        PRAGMA temp_store   = MEMORY;
        PRAGMA foreign_keys = ON;
    ")?;

    // Legacy tables (kept for backwards compat)
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

    conn.execute(
        "CREATE TABLE IF NOT EXISTS workspace_state (
            workspace_path TEXT NOT NULL,
            key TEXT NOT NULL,
            value TEXT NOT NULL,
            updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
            PRIMARY KEY (workspace_path, key)
        )",
        [],
    )?;

    // === Section 1.1: Tiered State Tables ===
    // Tier 1 — Critical State (window geometry, active workspace)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS critical_state (
            workspace_id TEXT PRIMARY KEY,
            window_width  INTEGER,
            window_height INTEGER,
            window_x      INTEGER,
            window_y      INTEGER,
            active_tab_path TEXT,
            updated_at    INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        )",
        [],
    )?;

    // Tier 2 — UI State (sidebar widths, panel sizes, expanded folders)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS ui_state (
            workspace_id          TEXT PRIMARY KEY,
            sidebar_width         INTEGER,
            panel_height          INTEGER,
            sidebar_visible       INTEGER,
            expanded_folder_paths TEXT,
            active_sidebar_panel  TEXT,
            is_minimap_enabled    INTEGER,
            updated_at            INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        )",
        [],
    )?;

    // Tier 3 — Session State (tab list, scroll positions, editor snapshots)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS session_state (
            workspace_id          TEXT PRIMARY KEY,
            open_tabs_json        TEXT,
            active_tab_id         TEXT,
            scroll_positions_json TEXT,
            editor_snapshots_json TEXT,
            updated_at            INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        )",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER PRIMARY KEY
        )",
        [],
    )?;

    let current_version: i64 = conn
        .query_row("SELECT COALESCE(MAX(version), 0) FROM schema_version", [], |row| row.get(0))
        .unwrap_or(0);

    if current_version < SCHEMA_VERSION {
        run_migrations(&conn, current_version)?;
    }

    // === Section 2.3: Optimized indexes ===
    conn.execute_batch("
        CREATE INDEX IF NOT EXISTS idx_recent_files_opened    ON recent_files(opened_at DESC);
        CREATE INDEX IF NOT EXISTS idx_workspace_state_ws     ON workspace_state(workspace_path);
        CREATE INDEX IF NOT EXISTS idx_bookmarks_file         ON bookmarks(file_path);
        CREATE INDEX IF NOT EXISTS idx_ui_state_workspace     ON ui_state(workspace_id);
        CREATE INDEX IF NOT EXISTS idx_session_state_ws       ON session_state(workspace_id);
        CREATE INDEX IF NOT EXISTS idx_critical_state_ws      ON critical_state(workspace_id);
    ")?;

    Ok(conn)
}

fn run_migrations(conn: &Connection, from_version: i64) -> SqlResult<()> {
    if from_version < 1 {
        conn.execute(
            "CREATE TABLE IF NOT EXISTS workspace_state (
                workspace_path TEXT NOT NULL,
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
                PRIMARY KEY (workspace_path, key)
            )",
            [],
        )?;
    }
    if from_version < 2 {
        // Tiered state tables — already created in init_db above, this is idempotent
        conn.execute_batch("
            CREATE TABLE IF NOT EXISTS critical_state (
                workspace_id TEXT PRIMARY KEY,
                window_width  INTEGER, window_height INTEGER,
                window_x      INTEGER, window_y      INTEGER,
                active_tab_path TEXT,
                updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
            );
            CREATE TABLE IF NOT EXISTS ui_state (
                workspace_id TEXT PRIMARY KEY,
                sidebar_width INTEGER, panel_height INTEGER,
                sidebar_visible INTEGER, expanded_folder_paths TEXT,
                active_sidebar_panel TEXT, is_minimap_enabled INTEGER,
                updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
            );
            CREATE TABLE IF NOT EXISTS session_state (
                workspace_id TEXT PRIMARY KEY,
                open_tabs_json TEXT, active_tab_id TEXT,
                scroll_positions_json TEXT, editor_snapshots_json TEXT,
                updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
            );
        ")?;
    }
    conn.execute("INSERT OR REPLACE INTO schema_version (version) VALUES (?1)", params![SCHEMA_VERSION])?;
    Ok(())
}

// ============================================================
// Helper: current unix timestamp
// ============================================================
fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

// ============================================================
// Legacy commands (kept for backwards compat)
// ============================================================

#[tauri::command]
pub async fn add_recent_file(
    path: String,
    name: String,
    file_type: String,
    state: tauri::State<'_, DbState>,
) -> Result<(), String> {
    let lock = state.0.lock().unwrap();
    let conn = lock.as_ref().ok_or("Database not initialized")?;
    let now = now_secs();
    conn.execute(
        "INSERT INTO recent_files (path, name, opened_at, file_type)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(path) DO UPDATE SET opened_at = ?3",
        params![path, name, now, file_type],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn get_recent_files(state: tauri::State<'_, DbState>) -> Result<Vec<RecentFile>, String> {
    let lock = state.0.lock().unwrap();
    let conn = lock.as_ref().ok_or("Database not initialized")?;
    let mut stmt = conn.prepare(
        "SELECT id, path, name, opened_at, file_type FROM recent_files ORDER BY opened_at DESC LIMIT 20"
    ).map_err(|e| e.to_string())?;
    let files_iter = stmt.query_map([], |row| {
        Ok(RecentFile { id: row.get(0)?, path: row.get(1)?, name: row.get(2)?, opened_at: row.get(3)?, file_type: row.get(4)? })
    }).map_err(|e| e.to_string())?;
    let mut files = Vec::new();
    for file in files_iter { files.push(file.map_err(|e| e.to_string())?); }
    Ok(files)
}

#[tauri::command]
pub async fn clear_recent_files(state: tauri::State<'_, DbState>) -> Result<(), String> {
    let lock = state.0.lock().unwrap();
    let conn = lock.as_ref().ok_or("Database not initialized")?;
    conn.execute("DELETE FROM recent_files", []).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn get_setting(key: String, state: tauri::State<'_, DbState>) -> Result<Option<String>, String> {
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
pub async fn set_setting(key: String, value: String, state: tauri::State<'_, DbState>) -> Result<(), String> {
    let lock = state.0.lock().unwrap();
    let conn = lock.as_ref().ok_or("Database not initialized")?;
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2",
        params![key, value],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn save_workspace_state(
    workspace_path: String,
    pairs: Vec<(String, String)>,
    state: tauri::State<'_, DbState>,
) -> Result<(), String> {
    let lock = state.0.lock().unwrap();
    let conn = lock.as_ref().ok_or("Database not initialized")?;
    let now = now_secs();
    conn.execute("BEGIN TRANSACTION", []).map_err(|e| e.to_string())?;
    for (key, value) in &pairs {
        conn.execute(
            "INSERT INTO workspace_state (workspace_path, key, value, updated_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(workspace_path, key) DO UPDATE SET value = ?3, updated_at = ?4",
            params![workspace_path, key, value, now],
        ).map_err(|e| e.to_string())?;
    }
    conn.execute("COMMIT", []).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn load_workspace_state(
    workspace_path: String,
    state: tauri::State<'_, DbState>,
) -> Result<Vec<(String, String)>, String> {
    let lock = state.0.lock().unwrap();
    let conn = lock.as_ref().ok_or("Database not initialized")?;
    let mut stmt = conn.prepare(
        "SELECT key, value FROM workspace_state WHERE workspace_path = ?1"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params![workspace_path], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    }).map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    for row in rows { result.push(row.map_err(|e| e.to_string())?); }
    Ok(result)
}

#[tauri::command]
pub async fn delete_workspace_state(
    workspace_path: String,
    state: tauri::State<'_, DbState>,
) -> Result<(), String> {
    let lock = state.0.lock().unwrap();
    let conn = lock.as_ref().ok_or("Database not initialized")?;
    conn.execute(
        "DELETE FROM workspace_state WHERE workspace_path = ?1",
        params![workspace_path],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn save_workspace_sidebar_width(
    workspace_path: String,
    width: i32,
    state: tauri::State<'_, DbState>,
) -> Result<(), String> {
    let lock = state.0.lock().unwrap();
    let conn = lock.as_ref().ok_or("Database not initialized")?;
    let now = now_secs();
    conn.execute(
        "INSERT INTO workspace_state (workspace_path, key, value, updated_at) VALUES (?1, 'sidebar_width', ?2, ?3)
         ON CONFLICT(workspace_path, key) DO UPDATE SET value = ?2, updated_at = ?3",
        params![workspace_path, width.to_string(), now],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn save_workspace_expanded_paths(
    workspace_path: String,
    paths_json: String,
    state: tauri::State<'_, DbState>,
) -> Result<(), String> {
    let lock = state.0.lock().unwrap();
    let conn = lock.as_ref().ok_or("Database not initialized")?;
    let now = now_secs();
    conn.execute(
        "INSERT INTO workspace_state (workspace_path, key, value, updated_at) VALUES (?1, 'expanded_paths', ?2, ?3)
         ON CONFLICT(workspace_path, key) DO UPDATE SET value = ?2, updated_at = ?3",
        params![workspace_path, paths_json, now],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn save_workspace_session(
    workspace_path: String,
    session_json: String,
    state: tauri::State<'_, DbState>,
) -> Result<(), String> {
    let lock = state.0.lock().unwrap();
    let conn = lock.as_ref().ok_or("Database not initialized")?;
    let now = now_secs();
    conn.execute("BEGIN TRANSACTION", []).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO workspace_state (workspace_path, key, value, updated_at) VALUES (?1, 'session', ?2, ?3)
         ON CONFLICT(workspace_path, key) DO UPDATE SET value = ?2, updated_at = ?3",
        params![workspace_path, session_json, now],
    ).map_err(|e| e.to_string())?;
    conn.execute("COMMIT", []).map_err(|e| e.to_string())?;
    Ok(())
}

// ============================================================
// Section 1.1: Tiered State Load/Save Commands
// ============================================================

/// Load Tier 1 (Critical State) — fastest possible query
#[tauri::command]
pub async fn load_critical_state(
    workspace_id: String,
    state: tauri::State<'_, DbState>,
) -> Result<CriticalState, String> {
    let lock = state.0.lock().unwrap();
    let conn = lock.as_ref().ok_or("Database not initialized")?;

    let result = conn.query_row(
        "SELECT window_width, window_height, window_x, window_y, active_tab_path
         FROM critical_state WHERE workspace_id = ?1",
        params![workspace_id],
        |row| {
            Ok(CriticalState {
                active_workspace_id: Some(workspace_id.clone()),
                window_width: row.get(0)?,
                window_height: row.get(1)?,
                window_x: row.get(2)?,
                window_y: row.get(3)?,
                active_tab_path: row.get(4)?,
            })
        },
    );

    match result {
        Ok(s) => Ok(s),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(CriticalState {
            active_workspace_id: Some(workspace_id),
            ..Default::default()
        }),
        Err(e) => Err(e.to_string()),
    }
}

/// Save Tier 1 (Critical State)
#[tauri::command]
pub async fn save_critical_state(
    workspace_id: String,
    critical: CriticalState,
    state: tauri::State<'_, DbState>,
) -> Result<(), String> {
    let lock = state.0.lock().unwrap();
    let conn = lock.as_ref().ok_or("Database not initialized")?;
    let now = now_secs();
    conn.execute(
        "INSERT INTO critical_state (workspace_id, window_width, window_height, window_x, window_y, active_tab_path, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(workspace_id) DO UPDATE SET
           window_width=?2, window_height=?3, window_x=?4, window_y=?5,
           active_tab_path=?6, updated_at=?7",
        params![
            workspace_id,
            critical.window_width, critical.window_height,
            critical.window_x, critical.window_y,
            critical.active_tab_path, now
        ],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

/// Load Tier 2 (UI State)
#[tauri::command]
pub async fn load_ui_state(
    workspace_id: String,
    state: tauri::State<'_, DbState>,
) -> Result<UiStateRow, String> {
    let lock = state.0.lock().unwrap();
    let conn = lock.as_ref().ok_or("Database not initialized")?;

    let result = conn.query_row(
        "SELECT sidebar_width, panel_height, sidebar_visible, expanded_folder_paths,
                active_sidebar_panel, is_minimap_enabled
         FROM ui_state WHERE workspace_id = ?1",
        params![workspace_id],
        |row| {
            Ok(UiStateRow {
                sidebar_width: row.get(0)?,
                panel_height: row.get(1)?,
                sidebar_visible: row.get::<_, Option<i64>>(2)?.map(|v| v != 0),
                expanded_folder_paths: row.get(3)?,
                active_sidebar_panel: row.get(4)?,
                is_minimap_enabled: row.get::<_, Option<i64>>(5)?.map(|v| v != 0),
            })
        },
    );

    match result {
        Ok(s) => Ok(s),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(UiStateRow::default()),
        Err(e) => Err(e.to_string()),
    }
}

/// Save Tier 2 (UI State)
#[tauri::command]
pub async fn save_ui_state(
    workspace_id: String,
    ui: UiStateRow,
    state: tauri::State<'_, DbState>,
) -> Result<(), String> {
    let lock = state.0.lock().unwrap();
    let conn = lock.as_ref().ok_or("Database not initialized")?;
    let now = now_secs();
    let sidebar_visible_i: Option<i64> = ui.sidebar_visible.map(|b| b as i64);
    let minimap_i: Option<i64> = ui.is_minimap_enabled.map(|b| b as i64);
    conn.execute(
        "INSERT INTO ui_state (workspace_id, sidebar_width, panel_height, sidebar_visible,
          expanded_folder_paths, active_sidebar_panel, is_minimap_enabled, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)
         ON CONFLICT(workspace_id) DO UPDATE SET
           sidebar_width=?2, panel_height=?3, sidebar_visible=?4,
           expanded_folder_paths=?5, active_sidebar_panel=?6,
           is_minimap_enabled=?7, updated_at=?8",
        params![workspace_id, ui.sidebar_width, ui.panel_height, sidebar_visible_i,
                ui.expanded_folder_paths, ui.active_sidebar_panel, minimap_i, now],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

/// Load Tier 3 (Session State)
#[tauri::command]
pub async fn load_session_state(
    workspace_id: String,
    state: tauri::State<'_, DbState>,
) -> Result<SessionStateRow, String> {
    let lock = state.0.lock().unwrap();
    let conn = lock.as_ref().ok_or("Database not initialized")?;

    let result = conn.query_row(
        "SELECT open_tabs_json, active_tab_id, scroll_positions_json, editor_snapshots_json
         FROM session_state WHERE workspace_id = ?1",
        params![workspace_id],
        |row| {
            Ok(SessionStateRow {
                open_tabs_json: row.get(0)?,
                active_tab_id: row.get(1)?,
                scroll_positions_json: row.get(2)?,
                editor_snapshots_json: row.get(3)?,
            })
        },
    );

    match result {
        Ok(s) => Ok(s),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(SessionStateRow::default()),
        Err(e) => Err(e.to_string()),
    }
}

/// Save Tier 3 (Session State) — can be called in background
#[tauri::command]
pub async fn save_session_state(
    workspace_id: String,
    session: SessionStateRow,
    state: tauri::State<'_, DbState>,
) -> Result<(), String> {
    let lock = state.0.lock().unwrap();
    let conn = lock.as_ref().ok_or("Database not initialized")?;
    let now = now_secs();
    conn.execute(
        "INSERT INTO session_state (workspace_id, open_tabs_json, active_tab_id,
          scroll_positions_json, editor_snapshots_json, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6)
         ON CONFLICT(workspace_id) DO UPDATE SET
           open_tabs_json=?2, active_tab_id=?3,
           scroll_positions_json=?4, editor_snapshots_json=?5, updated_at=?6",
        params![workspace_id, session.open_tabs_json, session.active_tab_id,
                session.scroll_positions_json, session.editor_snapshots_json, now],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

// ============================================================
// Section 1.4 + 6.1: IPC Batch Query
// ============================================================

/// Execute multiple DB operations in a single IPC round-trip.
/// Supported ops: "get_setting", "set_setting", "load_critical_state",
///   "load_ui_state", "load_session_state", "load_workspace_state"
#[tauri::command]
pub async fn batch_query(
    operations: Vec<BatchOperation>,
    state: tauri::State<'_, DbState>,
) -> Result<Vec<BatchResult>, String> {
    let lock = state.0.lock().unwrap();
    let conn = lock.as_ref().ok_or("Database not initialized")?;

    let mut results = Vec::with_capacity(operations.len());

    for op in &operations {
        let result = execute_batch_op(conn, op);
        results.push(result);
    }

    Ok(results)
}

fn execute_batch_op(conn: &Connection, op: &BatchOperation) -> BatchResult {
    match op.op.as_str() {
        "get_setting" => {
            let key = op.args["key"].as_str().unwrap_or("").to_string();
            match conn.query_row(
                "SELECT value FROM settings WHERE key = ?1",
                params![key],
                |r| r.get::<_, String>(0),
            ) {
                Ok(v) => BatchResult { ok: true, data: Value::String(v), error: None },
                Err(rusqlite::Error::QueryReturnedNoRows) => BatchResult { ok: true, data: Value::Null, error: None },
                Err(e) => BatchResult { ok: false, data: Value::Null, error: Some(e.to_string()) },
            }
        }
        "load_workspace_state" => {
            let workspace_id = op.args["workspace_id"].as_str().unwrap_or("").to_string();
            // Collect rows in a block so stmt is dropped before we use the data
            let pairs_result: Result<Vec<(String, String)>, rusqlite::Error> = (|| {
                let mut stmt = conn.prepare(
                    "SELECT key, value FROM workspace_state WHERE workspace_path = ?1"
                )?;
                let rows = stmt.query_map(params![workspace_id], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })?;
                rows.collect()
            })();
            match pairs_result {
                Ok(pairs) => {
                    let json = serde_json::to_value(pairs).unwrap_or(Value::Null);
                    BatchResult { ok: true, data: json, error: None }
                }
                Err(e) => BatchResult { ok: false, data: Value::Null, error: Some(e.to_string()) },
            }
        }
        "load_critical_state" => {
            let workspace_id = op.args["workspace_id"].as_str().unwrap_or("").to_string();
            match conn.query_row(
                "SELECT window_width, window_height, window_x, window_y, active_tab_path
                 FROM critical_state WHERE workspace_id = ?1",
                params![workspace_id],
                |row| {
                    Ok(CriticalState {
                        active_workspace_id: Some(workspace_id.clone()),
                        window_width: row.get(0)?,
                        window_height: row.get(1)?,
                        window_x: row.get(2)?,
                        window_y: row.get(3)?,
                        active_tab_path: row.get(4)?,
                    })
                },
            ) {
                Ok(s) => BatchResult { ok: true, data: serde_json::to_value(s).unwrap_or(Value::Null), error: None },
                Err(rusqlite::Error::QueryReturnedNoRows) => {
                    let default = CriticalState { active_workspace_id: Some(workspace_id), ..Default::default() };
                    BatchResult { ok: true, data: serde_json::to_value(default).unwrap_or(Value::Null), error: None }
                }
                Err(e) => BatchResult { ok: false, data: Value::Null, error: Some(e.to_string()) },
            }
        }
        "load_ui_state" => {
            let workspace_id = op.args["workspace_id"].as_str().unwrap_or("").to_string();
            match conn.query_row(
                "SELECT sidebar_width, panel_height, sidebar_visible, expanded_folder_paths,
                        active_sidebar_panel, is_minimap_enabled
                 FROM ui_state WHERE workspace_id = ?1",
                params![workspace_id],
                |row| {
                    Ok(UiStateRow {
                        sidebar_width: row.get(0)?,
                        panel_height: row.get(1)?,
                        sidebar_visible: row.get::<_, Option<i64>>(2)?.map(|v| v != 0),
                        expanded_folder_paths: row.get(3)?,
                        active_sidebar_panel: row.get(4)?,
                        is_minimap_enabled: row.get::<_, Option<i64>>(5)?.map(|v| v != 0),
                    })
                },
            ) {
                Ok(s) => BatchResult { ok: true, data: serde_json::to_value(s).unwrap_or(Value::Null), error: None },
                Err(rusqlite::Error::QueryReturnedNoRows) => {
                    BatchResult { ok: true, data: serde_json::to_value(UiStateRow::default()).unwrap_or(Value::Null), error: None }
                }
                Err(e) => BatchResult { ok: false, data: Value::Null, error: Some(e.to_string()) },
            }
        }
        "load_session_state" => {
            let workspace_id = op.args["workspace_id"].as_str().unwrap_or("").to_string();
            match conn.query_row(
                "SELECT open_tabs_json, active_tab_id, scroll_positions_json, editor_snapshots_json
                 FROM session_state WHERE workspace_id = ?1",
                params![workspace_id],
                |row| {
                    Ok(SessionStateRow {
                        open_tabs_json: row.get(0)?,
                        active_tab_id: row.get(1)?,
                        scroll_positions_json: row.get(2)?,
                        editor_snapshots_json: row.get(3)?,
                    })
                },
            ) {
                Ok(s) => BatchResult { ok: true, data: serde_json::to_value(s).unwrap_or(Value::Null), error: None },
                Err(rusqlite::Error::QueryReturnedNoRows) => {
                    BatchResult { ok: true, data: serde_json::to_value(SessionStateRow::default()).unwrap_or(Value::Null), error: None }
                }
                Err(e) => BatchResult { ok: false, data: Value::Null, error: Some(e.to_string()) },
            }
        }
        _ => BatchResult {
            ok: false,
            data: Value::Null,
            error: Some(format!("Unknown batch operation: {}", op.op)),
        },
    }
}
