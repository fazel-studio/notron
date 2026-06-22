/// fs_watcher.rs — Section 3.6: File System Watcher for Cache Invalidation
///
/// Uses notify crate to watch the file system and debounce events before emitting
/// them as a single `fs-change` batch to the frontend.

use notify::{Event, EventKind, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};
use serde::{Deserialize, Serialize};
use std::sync::mpsc;
use tokio::time::{Duration, Instant};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct FsChangeItem {
    #[serde(rename = "type")]
    pub kind: String,
    pub path: String,
    #[serde(rename = "parentPath")]
    pub parent_path: Option<String>,
    #[serde(rename = "oldPath")]
    pub old_path: Option<String>,
    #[serde(rename = "newPath")]
    pub new_path: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct FsChangePayload {
    pub changes: Vec<FsChangeItem>,
}

pub struct WatcherState {
    pub handles: Mutex<HashMap<String, tokio::sync::oneshot::Sender<()>>>,
}

impl WatcherState {
    pub fn new() -> Self {
        Self {
            handles: Mutex::new(HashMap::new()),
        }
    }
}

fn should_ignore_path(paths: &[PathBuf]) -> bool {
    paths.iter().any(|p| {
        let path_str = p.to_string_lossy().replace("\\", "/");
        path_str.contains("/node_modules/") ||
        path_str.contains("/.git/") ||
        path_str.contains("/target/") ||
        path_str.contains("/dist/") ||
        path_str.contains("/build/") ||
        path_str.contains("/.next/") ||
        path_str.contains("/__pycache__/") ||
        path_str.ends_with(".lock") ||
        path_str.ends_with(".log") ||
        path_str.ends_with(".tmp") ||
        path_str.ends_with(".swp")
    })
}

fn get_parent_path(path: &Path) -> Option<String> {
    path.parent().map(|p| p.to_string_lossy().to_string())
}

fn process_events_to_payload(events: Vec<Event>) -> FsChangePayload {
    let mut changes = Vec::new();

    for event in events {
        match event.kind {
            EventKind::Create(_) => {
                if let Some(path) = event.paths.get(0) {
                    changes.push(FsChangeItem {
                        kind: "created".to_string(),
                        path: path.to_string_lossy().to_string(),
                        parent_path: get_parent_path(path),
                        old_path: None,
                        new_path: None,
                    });
                }
            }
            EventKind::Remove(_) => {
                if let Some(path) = event.paths.get(0) {
                    changes.push(FsChangeItem {
                        kind: "deleted".to_string(),
                        path: path.to_string_lossy().to_string(),
                        parent_path: get_parent_path(path),
                        old_path: None,
                        new_path: None,
                    });
                }
            }
            EventKind::Modify(notify::event::ModifyKind::Name(notify::event::RenameMode::Both)) => {
                if event.paths.len() >= 2 {
                    let old_path = &event.paths[0];
                    let new_path = &event.paths[1];
                    changes.push(FsChangeItem {
                        kind: "renamed".to_string(),
                        path: old_path.to_string_lossy().to_string(),
                        parent_path: None,
                        old_path: Some(old_path.to_string_lossy().to_string()),
                        new_path: Some(new_path.to_string_lossy().to_string()),
                    });
                }
            }
            EventKind::Modify(_) => {
                if let Some(path) = event.paths.get(0) {
                    changes.push(FsChangeItem {
                        kind: "modified".to_string(),
                        path: path.to_string_lossy().to_string(),
                        parent_path: get_parent_path(path),
                        old_path: None,
                        new_path: None,
                    });
                }
            }
            _ => {}
        }
    }

    FsChangePayload { changes }
}

#[tauri::command]
pub async fn start_fs_watch(
    root: String,
    app: AppHandle,
    state: tauri::State<'_, WatcherState>,
) -> Result<(), String> {
    {
        let mut handles = state.handles.lock().unwrap();
        if let Some(tx) = handles.remove(&root) {
            let _ = tx.send(());
        }
    }

    let (stop_tx, mut stop_rx) = tokio::sync::oneshot::channel::<()>();

    {
        let mut handles = state.handles.lock().unwrap();
        handles.insert(root.clone(), stop_tx);
    }

    let root_clone = root.clone();
    let app_clone = app.clone();

    tokio::spawn(async move {
        let (tx, rx) = mpsc::channel();
        let mut watcher = match notify::recommended_watcher(tx) {
            Ok(w) => w,
            Err(e) => {
                eprintln!("Failed to create watcher: {}", e);
                return;
            }
        };

        if let Err(e) = watcher.watch(Path::new(&root_clone), RecursiveMode::Recursive) {
            eprintln!("Failed to watch {}: {}", root_clone, e);
            return;
        }

        let mut pending_events: Vec<Event> = Vec::new();
        let mut last_event_time = Instant::now();

        loop {
            tokio::select! {
                _ = &mut stop_rx => {
                    break;
                }
                _ = tokio::time::sleep(Duration::from_millis(50)) => {
                    if let Ok(event) = rx.try_recv() {
                        if let Ok(e) = event {
                            if !should_ignore_path(&e.paths) {
                                pending_events.push(e);
                                last_event_time = Instant::now();
                            }
                        }
                    }

                    if !pending_events.is_empty() && last_event_time.elapsed() > Duration::from_millis(300) {
                        let batch = std::mem::take(&mut pending_events);
                        let payload = process_events_to_payload(batch);
                        if !payload.changes.is_empty() {
                            let _ = app_clone.emit("fs-change", &payload);
                        }
                    }
                }
            }
        }
        drop(watcher);
    });

    Ok(())
}

#[tauri::command]
pub async fn stop_fs_watch(
    root: String,
    state: tauri::State<'_, WatcherState>,
) -> Result<(), String> {
    let mut handles = state.handles.lock().unwrap();
    if let Some(tx) = handles.remove(&root) {
        let _ = tx.send(());
    }
    Ok(())
}

#[allow(dead_code)]
pub fn emit_fs_change(app: &AppHandle, path: &str, parent_path: &str, kind: &str) {
    let payload = FsChangePayload {
        changes: vec![FsChangeItem {
            kind: kind.to_string(),
            path: path.to_string(),
            parent_path: Some(parent_path.to_string()),
            old_path: None,
            new_path: None,
        }],
    };
    let _ = app.emit("fs-change", &payload);
}
