use std::io::Read;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use encoding_rs::Encoding;
use serde::{Deserialize, Serialize};
use tokio::fs;
use std::collections::HashMap;
use tokio::sync::Mutex;
use tauri::{AppHandle, State, Emitter};
use chardetng::EncodingDetector;

#[derive(Serialize, Deserialize, Debug)]
pub struct FileContent {
    pub content: String,
    pub encoding: String,
    pub size: u64,
    pub line_count: usize,
}

/// Single-IPC result for opening a file.
/// Combines size check + content read into one round-trip.
#[derive(Serialize, Deserialize, Debug)]
pub struct FileOpenMeta {
    pub content: Vec<u8>,
    pub size: u64,
    pub is_large: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SearchResult {
    pub path: String,
    pub line: usize,
    pub text: String,
}



#[derive(Serialize, Deserialize, Debug)]
pub struct FileInfo {
    pub name: String,
    pub extension: String,
    pub size: u64,
    pub last_modified: i64,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct FileMetadata {
    pub path: String,
    pub size: u64,
    pub modified: Option<u64>,
    pub is_dir: bool,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub has_children: bool,
    pub children: Option<Vec<FileNode>>,
}

const LARGE_FILE_THRESHOLD: u64 = 1_048_576; // 1MB
// Chunked Loading thresholds
const CHUNK_THRESHOLD_LOW: u64  = 512 * 1024;   // 500KB — load chunked
const CHUNK_THRESHOLD_HIGH: u64 = 5 * 1024 * 1024; // 5MB — disable syntax highlight
const INITIAL_CHUNK_SIZE: usize = 100 * 1024;    // 100KB first chunk

pub struct SearchRegistry {
    pub active_searches: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchOptions {
    pub case_sensitive: bool,
    #[allow(dead_code)]
    pub use_regex: bool,
}

#[derive(Serialize, Clone)]
pub struct SearchBatchPayload {
    pub results: Vec<SearchResult>,
    pub files_scanned: usize,
    pub total_matches: usize,
    pub is_done: bool,
}

#[tauri::command]
pub async fn open_file(path: String) -> Result<FileContent, String> {
    let bytes = fs::read(&path).await.map_err(|e| e.to_string())?;
    let size = bytes.len() as u64;

    if let Ok(content) = String::from_utf8(bytes.clone()) {
        let line_count = content.lines().count();
        return Ok(FileContent {
            content,
            encoding: "UTF-8".to_string(),
            size,
            line_count,
        });
    }

    let (encoding, _confidence, _) = Encoding::for_bom(&bytes)
        .map(|(e, _)| (e, 1.0, false))
        .unwrap_or_else(|| {
            let mut detector = EncodingDetector::new(chardetng::Iso2022JpDetection::Allow);
            detector.feed(&bytes, true);
            (detector.guess(None, chardetng::Utf8Detection::Allow), 0.5, false)
        });

    let (cow, _, _) = encoding.decode(&bytes);
    let content = cow.into_owned();
    let line_count = content.lines().count();

    Ok(FileContent {
        content,
        encoding: encoding.name().to_string(),
        size,
        line_count,
    })
}

#[tauri::command]
pub async fn open_file_with_meta(path: String) -> Result<FileOpenMeta, String> {
    let metadata = fs::metadata(&path).await.map_err(|e| e.to_string())?;
    let size = metadata.len();
    let is_large = size > LARGE_FILE_THRESHOLD;
    let bytes = if is_large {
        Vec::new()
    } else {
        fs::read(&path).await.map_err(|e| e.to_string())?
    };
    Ok(FileOpenMeta { content: bytes, size, is_large })
}

/// Chunked loading for large files.
/// Returns the first INITIAL_CHUNK_SIZE bytes immediately.
/// The caller should use this for files > CHUNK_THRESHOLD_LOW.
#[derive(Serialize, Deserialize, Debug)]
pub struct ChunkedFileResult {
    pub content: String,    // First chunk as text
    pub total_size: u64,
    pub is_complete: bool,  // true if entire file was returned
    pub disable_highlight: bool, // true if > 5MB
}

#[tauri::command]
pub async fn read_file_chunked(path: String) -> Result<ChunkedFileResult, String> {
    use tokio::io::AsyncReadExt;
    let file = tokio::fs::File::open(&path).await.map_err(|e| e.to_string())?;
    let metadata = file.metadata().await.map_err(|e| e.to_string())?;
    let total_size = metadata.len();

    // For files under threshold, read normally
    if total_size <= CHUNK_THRESHOLD_LOW {
        let bytes = tokio::fs::read(&path).await.map_err(|e| e.to_string())?;
        let content = String::from_utf8_lossy(&bytes).replace("\r\n", "\n");
        return Ok(ChunkedFileResult {
            content,
            total_size,
            is_complete: true,
            disable_highlight: false,
        });
    }

    // Read only the first INITIAL_CHUNK_SIZE bytes
    let mut reader = tokio::io::BufReader::new(file);
    let mut buf = vec![0u8; INITIAL_CHUNK_SIZE];
    let n = reader.read(&mut buf).await.map_err(|e| e.to_string())?;
    buf.truncate(n);

    let content = String::from_utf8_lossy(&buf).replace("\r\n", "\n");
    Ok(ChunkedFileResult {
        content,
        total_size,
        is_complete: false,
        disable_highlight: total_size > CHUNK_THRESHOLD_HIGH,
    })
}

#[tauri::command]
pub async fn read_file_binary(path: String) -> Result<Vec<u8>, String> {
    fs::read(&path).await.map_err(|e| e.to_string())
}

/// Read file as text directly. Returns String, avoiding the massive JSON array
/// overhead of read_file_binary (which serializes bytes as [72,101,108,...]).
/// For a 100KB file, this reduces IPC payload from ~500KB to ~100KB.
#[tauri::command]
pub async fn read_file_text(path: String) -> Result<String, String> {
    let bytes = fs::read(&path).await.map_err(|e| e.to_string())?;

    // Check for binary content (NUL bytes in first 8KB)
    let check_len = bytes.len().min(8000);
    for &b in &bytes[..check_len] {
        if b == 0 {
            return Err("__BINARY__".to_string());
        }
    }

    let content = String::from_utf8_lossy(&bytes).replace("\r\n", "\n");
    Ok(content)
}

/// Batch read multiple directories in a single IPC call.
/// Replaces N sequential invoke('read_directory') calls with 1 call.
/// Critical for restoreExpandedChildren() during startup.
#[derive(Serialize, Deserialize, Debug)]
pub struct DirBatchEntry {
    pub path: String,
    pub children: Vec<FileNode>,
}

#[tauri::command]
pub async fn read_directory_batch(
    paths: Vec<String>,
    show_dot_files: Option<bool>,
) -> Result<Vec<DirBatchEntry>, String> {
    let show_dot = show_dot_files.unwrap_or(false);

    // Read all directories concurrently using tokio::spawn
    let mut handles = Vec::with_capacity(paths.len());
    for path in paths {
        let show_dot = show_dot;
        handles.push(tokio::spawn(async move {
            read_single_dir(&path, show_dot).await
        }));
    }

    let mut results = Vec::with_capacity(handles.len());
    for handle in handles {
        match handle.await {
            Ok(Ok(entry)) => results.push(entry),
            Ok(Err(e)) => {
                // Skip failed directories silently (may have been deleted)
                eprintln!("read_directory_batch: skipping failed dir: {}", e);
            }
            Err(e) => {
                eprintln!("read_directory_batch: task join error: {}", e);
            }
        }
    }
    Ok(results)
}

/// Internal helper for batch directory reading
async fn read_single_dir(path: &str, show_dot: bool) -> Result<DirBatchEntry, String> {
    let dir_path = std::path::Path::new(path);
    if !fs::metadata(dir_path).await.map(|m| m.is_dir()).unwrap_or(false) {
        return Err(format!("Not a directory: {}", path));
    }

    let mut children = Vec::new();
    if let Ok(mut entries) = fs::read_dir(dir_path).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let child_name = entry.file_name().to_string_lossy().into_owned();
            if is_ignored_dir(&child_name) { continue; }
            if !show_dot && is_dot_file(&child_name) { continue; }

            let is_dir = entry.file_type().await.map(|t| t.is_dir()).unwrap_or(false);
            children.push(FileNode {
                name: child_name,
                path: entry.path().to_string_lossy().into_owned(),
                is_dir,
                has_children: is_dir,
                children: None,
            });
        }
    }

    children.sort_by(|a, b| {
        b.is_dir.cmp(&a.is_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(DirBatchEntry {
        path: path.to_string(),
        children,
    })
}

#[tauri::command]
pub async fn save_file(path: String, content: String, encoding: Option<String>) -> Result<(), String> {
    let enc_str = encoding.unwrap_or_else(|| "UTF-8".to_string());
    let enc = Encoding::for_label(enc_str.as_bytes()).unwrap_or(encoding_rs::UTF_8);
    let (cow, _, _) = enc.encode(&content);
    fs::write(path, cow).await.map_err(|e| e.to_string())?;
    Ok(())
}

fn is_ignored_dir(name: &str) -> bool {
    matches!(name, ".git" | ".svn" | ".hg" | ".DS_Store" | "node_modules" | "target" | "dist" | "build" | ".cache" | ".next" | ".nuxt" | ".svelte-kit" | "__pycache__" | ".venv" | "vendor")
}

fn is_dot_file(name: &str) -> bool {
    name.starts_with('.') && name != ".." && name != "."
}

#[allow(dead_code)]
pub fn resolve_symlink_safe(path: &Path, workspace_root: &Path) -> Option<std::path::PathBuf> {
    let resolved = std::fs::canonicalize(path).ok()?;
  
    if resolved == path.parent()? || resolved.starts_with(path) {
        return None;
    }
  
    if !resolved.starts_with(workspace_root) {
        return None;
    }
  
    Some(resolved)
}

/// Reads ONE level of a directory (non-recursive) for lazy loading.
/// Returns a FileNode with immediate children only. Children of subdirectories
/// are not populated (they use empty Vec to save space).
#[tauri::command]
pub async fn read_directory(path: String, show_dot_files: Option<bool>) -> Result<FileNode, String> {
    let show_dot = show_dot_files.unwrap_or(false);
    let dir_path = Path::new(&path);

    if !fs::metadata(dir_path).await.map(|m| m.is_dir()).unwrap_or(false) {
        return Err("Path is not a directory".to_string());
    }

    let name = dir_path.file_name().unwrap_or_default().to_string_lossy().into_owned();
    let path_str = dir_path.to_string_lossy().into_owned();

    let mut children = Vec::new();
    if let Ok(mut entries) = fs::read_dir(dir_path).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let child_name = entry.file_name().to_string_lossy().into_owned();
            if is_ignored_dir(&child_name) { continue; }
            if !show_dot && is_dot_file(&child_name) { continue; }

            let is_dir = entry.file_type().await.map(|t| t.is_dir()).unwrap_or(false);
            let has_children = is_dir;

            children.push(FileNode {
                name: child_name,
                path: entry.path().to_string_lossy().into_owned(),
                is_dir,
                has_children,
                children: None,
            });
        }
    }

    children.sort_by(|a, b| {
        b.is_dir.cmp(&a.is_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(FileNode {
        name,
        path: path_str,
        is_dir: true,
        has_children: !children.is_empty(),
        children: Some(children),
    })
}

#[tauri::command]
pub async fn read_directory_flat(path: String, show_dot_files: Option<bool>) -> Result<Vec<FileNode>, String> {
    let show_dot = show_dot_files.unwrap_or(false);
    let dir_path = Path::new(&path);

    if !fs::metadata(dir_path).await.map(|m| m.is_dir()).unwrap_or(false) {
        return Err("Path is not a directory".to_string());
    }

    let mut items = Vec::new();
    if let Ok(mut entries) = fs::read_dir(dir_path).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let name = entry.file_name().to_string_lossy().into_owned();
            if is_ignored_dir(&name) { continue; }
            if !show_dot && is_dot_file(&name) { continue; }

            let is_dir = entry.file_type().await.map(|t| t.is_dir()).unwrap_or(false);
            items.push(FileNode {
                name,
                path: entry.path().to_string_lossy().into_owned(),
                is_dir,
                has_children: is_dir,
                children: None,
            });
        }
    }

    items.sort_by(|a, b| {
        b.is_dir.cmp(&a.is_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(items)
}

#[tauri::command]
pub async fn get_file_info(path: String) -> Result<FileInfo, String> {
    let metadata = fs::metadata(&path).await.map_err(|e| e.to_string())?;
    let path_obj = Path::new(&path);

    let name = path_obj.file_name().unwrap_or_default().to_string_lossy().into_owned();
    let extension = path_obj.extension().unwrap_or_default().to_string_lossy().into_owned();
    let size = metadata.len();

    let last_modified = metadata.modified()
        .map(|time| time.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs() as i64)
        .unwrap_or(0);

    Ok(FileInfo {
        name,
        extension,
        size,
        last_modified,
    })
}

#[tauri::command]
pub async fn is_large_file(path: String) -> Result<bool, String> {
    let metadata = fs::metadata(&path).await.map_err(|e| e.to_string())?;
    Ok(metadata.len() > LARGE_FILE_THRESHOLD)
}

#[tauri::command]
pub async fn create_file(path: String) -> Result<(), String> {
    fs::write(path, "").await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_directory(path: String) -> Result<(), String> {
    fs::create_dir_all(path).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rename_item(old_path: String, new_path: String) -> Result<(), String> {
    fs::rename(old_path, new_path).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_item(path: String) -> Result<(), String> {
    let metadata = fs::metadata(&path).await.map_err(|e| e.to_string())?;
    if metadata.is_dir() {
        fs::remove_dir_all(path).await.map_err(|e| e.to_string())
    } else {
        fs::remove_file(path).await.map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub async fn copy_item(src_path: String, dst_path: String) -> Result<(), String> {
    let metadata = fs::metadata(&src_path).await.map_err(|e| e.to_string())?;
    if metadata.is_dir() {
        copy_dir_recursive(&src_path, &dst_path).await
    } else {
        fs::copy(src_path, dst_path).await.map(|_| ()).map_err(|e| e.to_string())
    }
}

use std::future::Future;
use std::pin::Pin;

fn copy_dir_recursive<'a>(src: &'a str, dst: &'a str) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'a>> {
    Box::pin(async move {
        fs::create_dir_all(dst).await.map_err(|e| e.to_string())?;
        let mut entries = fs::read_dir(src).await.map_err(|e| e.to_string())?;
        while let Ok(Some(entry)) = entries.next_entry().await {
            let file_type = entry.file_type().await.map_err(|e| e.to_string())?;
            let src_path = entry.path();
            let dst_path = Path::new(dst).join(entry.file_name());
            if file_type.is_dir() {
                copy_dir_recursive(&src_path.to_string_lossy(), &dst_path.to_string_lossy()).await?;
            } else {
                fs::copy(src_path, dst_path).await.map(|_| ()).map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    })
}

#[tauri::command]
pub async fn file_exists(path: String) -> Result<bool, String> {
    Ok(fs::metadata(path).await.is_ok())
}

#[tauri::command]
pub async fn cancel_search(
    token: Option<String>,
    registry: State<'_, SearchRegistry>,
) -> Result<(), String> {
    if let Some(t) = token {
        if let Some(flag) = registry.active_searches.lock().await.get(&t) {
            flag.store(true, Ordering::Relaxed);
        }
    } else {
        for flag in registry.active_searches.lock().await.values() {
            flag.store(true, Ordering::Relaxed);
        }
    }
    Ok(())
}

fn collect_files_by_priority(workspace_path: &str) -> Vec<std::path::PathBuf> {
    let mut priority_3 = vec![]; // root
    let mut priority_4 = vec![]; // level 1
    let mut priority_5 = vec![]; // level 2+
  
    for entry in walkdir::WalkDir::new(workspace_path)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            !is_ignored_dir(&name) && !is_dot_file(&name)
        })
        .filter_map(|e| e.ok())
    {
        if entry.file_type().is_file() {
            let path = entry.path().to_path_buf();
            let depth = entry.depth();
          
            let ext = path.extension()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_lowercase();
            let ignored_extensions = [
                "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg",
                "woff", "woff2", "ttf", "eot", "otf",
                "mp3", "mp4", "avi", "mov", "mkv",
                "zip", "tar", "gz", "bz2", "7z", "rar",
                "pdf", "doc", "docx", "xls", "xlsx",
                "lock", "min.js", "min.css", "map",
            ];
            if ignored_extensions.contains(&ext.as_str()) { continue; }
            if let Ok(metadata) = std::fs::metadata(&path) {
                if metadata.len() > 5_000_000 { continue; }
            }
          
            match depth {
                1 => priority_3.push(path),
                2 => priority_4.push(path),
                _ => priority_5.push(path),
            }
        }
    }
  
    [priority_3, priority_4, priority_5].concat()
}

#[tauri::command]
pub async fn search_workspace(
    query: String,
    workspace_path: String,
    cancel_token: String,
    options: SearchOptions,
    app: AppHandle,
    registry: State<'_, SearchRegistry>,
) -> Result<(), String> {
    let cancel_flag = Arc::new(AtomicBool::new(false));
    registry.active_searches.lock().await
        .insert(cancel_token.clone(), cancel_flag.clone());
  
    let registry_clone = registry.inner().active_searches.clone();
    
    tokio::task::spawn_blocking(move || {
        let files_by_priority = collect_files_by_priority(&workspace_path);
        let mut batch_results: Vec<SearchResult> = Vec::new();
        let mut last_emit = std::time::Instant::now();
        let mut files_scanned = 0;
        let mut total_matches = 0;
        let query_lower = if options.case_sensitive { query.clone() } else { query.to_lowercase() };

        for file_path in files_by_priority {
            if cancel_flag.load(Ordering::Relaxed) {
                break;
            }
          
            files_scanned += 1;
            
            // Basic exclusion
            if let Ok(mut file) = std::fs::File::open(&file_path) {
                let mut magic = [0u8; 4];
                if file.read_exact(&mut magic).is_ok() {
                    if magic.starts_with(&[0x7f, 0x45, 0x4c, 0x46]) || magic.starts_with(&[0x4d, 0x5a]) || magic.starts_with(&[0x89, 0x50, 0x4e, 0x47]) || magic.starts_with(&[0xff, 0xd8, 0xff]) || magic.starts_with(&[0x47, 0x49, 0x46]) {
                        continue;
                    }
                }
            }
            
            if let Ok(content) = std::fs::read_to_string(&file_path) {
                let mut line_num = 1;
                for line in content.lines() {
                    let text_to_check = if options.case_sensitive { line.to_string() } else { line.to_lowercase() };
                    if text_to_check.contains(&query_lower) {
                        batch_results.push(SearchResult {
                            path: file_path.to_string_lossy().into_owned(),
                            line: line_num,
                            text: line.to_string(),
                        });
                        total_matches += 1;
                    }
                    line_num += 1;
                }
            }
          
            let should_emit = last_emit.elapsed().as_millis() >= 50 || batch_results.len() >= 20;
          
            if should_emit && !batch_results.is_empty() {
                let payload = SearchBatchPayload {
                    results: std::mem::take(&mut batch_results),
                    files_scanned,
                    total_matches,
                    is_done: false,
                };
                let _ = app.emit("search-batch", payload);
                last_emit = std::time::Instant::now();
            }
        }
      
        let payload = SearchBatchPayload {
            results: batch_results,
            files_scanned,
            total_matches,
            is_done: true,
        };
        let _ = app.emit("search-batch", payload);
        
        let mut searches = registry_clone.blocking_lock();
        searches.remove(&cancel_token);
    });
  
    Ok(())
}

#[tauri::command]
pub async fn detect_language(path: String) -> String {
    let ext = Path::new(&path)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        "js" | "jsx" => "javascript",
        "ts" | "tsx" => "typescript",
        "rs" => "rust",
        "py" => "python",
        "go" => "go",
        "cpp" | "cxx" | "cc" | "c" | "h" | "hpp" => "cpp",
        "html" | "htm" => "html",
        "css" => "css",
        "json" => "json",
        "md" => "markdown",
        "svelte" => "svelte",
        "yaml" | "yml" => "yaml",
        "toml" => "toml",
        "sql" => "sql",
        "php" => "php",
        _ => "plaintext",
    }.to_string()
}

/// List all files in the workspace
#[tauri::command]
pub async fn list_all_files(path: String, exclude_dirs: Option<Vec<String>>) -> Result<Vec<String>, String> {
    tokio::task::spawn_blocking(move || {
        let mut results = Vec::new();
        let excludes = exclude_dirs.unwrap_or_default();
        
        let walker = walkdir::WalkDir::new(&path).into_iter();

        for entry in walker.filter_entry(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with('.') && name.len() > 1 {
                return false;
            }
            if e.file_type().is_dir() {
                if excludes.iter().any(|ex| ex == &name) {
                    return false;
                }
            }
            true
        }) {
            if let Ok(entry) = entry {
                if entry.file_type().is_file() {
                    results.push(entry.path().to_string_lossy().to_string());
                }
            }
        }
        Ok(results)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Batch read multiple files in one IPC call (Phase 4: restore other tabs)
#[tauri::command]
pub async fn batch_read_files(
    paths: Vec<String>,
) -> Result<std::collections::HashMap<String, Option<String>>, String> {
    use std::collections::HashMap;
    let mut result = HashMap::new();

    let handles: Vec<_> = paths.into_iter().map(|path| {
        let p = path.clone();
        (path, tokio::spawn(async move {
            tokio::fs::read(&p).await.ok().and_then(|bytes| {
                // Check if binary
                if bytes.iter().take(8192).any(|&b| b == 0) {
                    return None;
                }
                String::from_utf8(bytes).ok()
            })
        }))
    }).collect();

    for (path, handle) in handles {
        match handle.await {
            Ok(content) => { result.insert(path, content); }
            Err(_) => { result.insert(path, None); }
        }
    }
    Ok(result)
}

#[tauri::command]
pub async fn get_files_metadata(paths: Vec<String>) -> Result<Vec<FileMetadata>, String> {
    let mut handles = Vec::new();
    for path in paths {
        let p = path.clone();
        handles.push(tokio::spawn(async move {
            tokio::fs::metadata(&p).await.map(|m| FileMetadata {
                path: p,
                size: m.len(),
                modified: m.modified().ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs()),
                is_dir: m.is_dir(),
            })
        }));
    }
  
    let mut results = Vec::new();
    for handle in handles {
        if let Ok(Ok(meta)) = handle.await {
            results.push(meta);
        }
    }
    Ok(results)
}
