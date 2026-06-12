use std::io::Read;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use encoding_rs::Encoding;
use serde::{Deserialize, Serialize};
use tokio::fs;

#[derive(Serialize, Deserialize, Debug)]
pub struct FileContent {
    pub content: String,
    pub encoding: String,
    pub size: u64,
    pub line_count: usize,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct SearchResult {
    pub path: String,
    pub line: usize,
    pub text: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct SearchBatchResult {
    pub results: Vec<SearchResult>,
    pub total_scanned: usize,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct FileInfo {
    pub name: String,
    pub extension: String,
    pub size: u64,
    pub last_modified: i64,
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
// Section 4.3: Chunked Loading thresholds
const CHUNK_THRESHOLD_LOW: u64  = 512 * 1024;   // 500KB — load chunked
const CHUNK_THRESHOLD_HIGH: u64 = 5 * 1024 * 1024; // 5MB — disable syntax highlight
const INITIAL_CHUNK_SIZE: usize = 100 * 1024;    // 100KB first chunk

static SEARCH_CANCELLED: AtomicBool = AtomicBool::new(false);

#[tauri::command]
pub async fn open_file(path: String) -> Result<FileContent, String> {
    let bytes = fs::read(&path).await.map_err(|e| e.to_string())?;
    let size = bytes.len() as u64;

    let default_encoding = encoding_rs::UTF_8;
    let (cow, encoding_used, _) = default_encoding.decode(&bytes);

    let content = cow.into_owned();
    let line_count = content.lines().count();

    Ok(FileContent {
        content,
        encoding: encoding_used.name().to_string(),
        size,
        line_count,
    })
}

/// Section 4.3: Chunked loading for large files.
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
    name.starts_with('.') && name != ".."
}

/// Reads ONE level of a directory (non-recursive) for lazy loading.
/// Returns a FileNode with immediate children only. Children of subdirectories
/// are not populated (they use empty Vec to save space).
#[tauri::command]
pub async fn read_directory(path: String, show_dot_files: Option<bool>) -> Result<FileNode, String> {
    let show_dot = show_dot_files.unwrap_or(false);
    let dir_path = Path::new(&path);

    if fs::metadata(dir_path).await.is_err() {
        return Err("Path does not exist".to_string());
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

            // Check if directory has any children (for expand arrow indication)
            let has_children = if is_dir {
                if let Ok(mut sub_entries) = fs::read_dir(entry.path()).await {
                    let mut found = false;
                    while let Ok(Some(e)) = sub_entries.next_entry().await {
                        let ename = e.file_name().to_string_lossy().into_owned();
                        if !show_dot && is_dot_file(&ename) { continue; }
                        if !is_ignored_dir(&ename) {
                            found = true;
                            break;
                        }
                    }
                    found
                } else {
                    false
                }
            } else {
                false
            };

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
pub async fn cancel_search() -> Result<(), String> {
    SEARCH_CANCELLED.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub async fn search_in_files(root: String, pattern: String, batch_size: Option<usize>) -> Result<Vec<SearchResult>, String> {
    SEARCH_CANCELLED.store(false, Ordering::SeqCst);
    
    tokio::task::spawn_blocking(move || {
        let mut results = Vec::new();
        let root_path = Path::new(&root);
        let max_batch = batch_size.unwrap_or(20);

        if !root_path.exists() { return Ok(results); }

        let ignored_extensions = [
            "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg",
            "woff", "woff2", "ttf", "eot", "otf",
            "mp3", "mp4", "avi", "mov", "mkv",
            "zip", "tar", "gz", "bz2", "7z", "rar",
            "pdf", "doc", "docx", "xls", "xlsx",
            "lock",
        ];

        for entry in walkdir::WalkDir::new(root_path)
            .into_iter()
            .filter_entry(|e| {
                let name = e.file_name().to_string_lossy();
                !is_ignored_dir(&name) && !is_dot_file(&name)
            })
            .flatten() {

            if SEARCH_CANCELLED.load(Ordering::SeqCst) {
                return Ok(results);
            }

            if entry.file_type().is_file() {
                let path_str = entry.path().to_string_lossy();
                if path_str.len() > 5_000_000 { continue; }

                let ext = entry.path().extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_lowercase();
                if ignored_extensions.contains(&ext.as_str()) { continue; }

                if let Ok(metadata) = entry.path().metadata() {
                    if metadata.len() > LARGE_FILE_THRESHOLD * 5 { continue; }
                }

                let content = std::fs::read_to_string(entry.path()).unwrap_or_default();
                let pattern_lower = pattern.to_lowercase();
                let mut line_num = 1;
                for line in content.lines() {
                    if line.to_lowercase().contains(&pattern_lower) {
                        results.push(SearchResult {
                            path: entry.path().to_string_lossy().into_owned(),
                            line: line_num,
                            text: line.trim().to_string(),
                        });
                        if results.len() >= max_batch {
                            return Ok(results);
                        }
                    }
                    line_num += 1;
                }
            }
        }
        Ok(results)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Streaming search that returns results in batches with progress info (Bagian 6.2)
#[tauri::command]
pub async fn search_in_files_stream(root: String, pattern: String, batch_size: Option<usize>) -> Result<SearchBatchResult, String> {
    SEARCH_CANCELLED.store(false, Ordering::SeqCst);
    
    tokio::task::spawn_blocking(move || {
        let mut results = Vec::new();
        let root_path = Path::new(&root);
        let max_batch = batch_size.unwrap_or(20);
        let mut total_scanned: usize = 0;

        if !root_path.exists() {
            return Ok(SearchBatchResult { results, total_scanned });
        }

        let ignored_extensions = [
            "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg",
            "woff", "woff2", "ttf", "eot", "otf",
            "mp3", "mp4", "avi", "mov", "mkv",
            "zip", "tar", "gz", "bz2", "7z", "rar",
            "pdf", "doc", "docx", "xls", "xlsx",
            "lock", "min.js", "min.css", "map",
        ];

        // Prioritize: open tabs > recently opened > root files (Bagian 6.4)
        let root_path_obj = root_path.to_path_buf();
        let mut entries: Vec<_> = walkdir::WalkDir::new(&root_path_obj)
            .into_iter()
            .filter_entry(|e| {
                let name = e.file_name().to_string_lossy();
                !is_ignored_dir(&name) && !is_dot_file(&name)
            })
            .flatten()
            .filter(|e| e.file_type().is_file())
            .collect();

        entries.sort_by(|a, b| {
            let a_depth = a.path().ancestors().count();
            let b_depth = b.path().ancestors().count();
            a_depth.cmp(&b_depth)
        });

        for entry in &entries {
            if SEARCH_CANCELLED.load(Ordering::SeqCst) {
                return Ok(SearchBatchResult { results, total_scanned });
            }

            let path_str = entry.path().to_string_lossy();
            if path_str.len() > 5_000_000 { total_scanned += 1; continue; }

            // Exclude binary files by checking first 4 magic bytes (Bagian 6.5)
            if let Ok(mut file) = std::fs::File::open(entry.path()) {
                let mut magic = [0u8; 4];
                if file.read_exact(&mut magic).is_ok() {
                    if magic.starts_with(&[0x7f, 0x45, 0x4c, 0x46]) // ELF
                        || magic.starts_with(&[0x4d, 0x5a]) // PE
                        || magic.starts_with(&[0x89, 0x50, 0x4e, 0x47]) // PNG
                        || magic.starts_with(&[0xff, 0xd8, 0xff]) // JPEG
                        || magic.starts_with(&[0x47, 0x49, 0x46]) // GIF
                    {
                        total_scanned += 1;
                        continue;
                    }
                }
            }

            let ext = entry.path().extension()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_lowercase();
            if ignored_extensions.contains(&ext.as_str()) { total_scanned += 1; continue; }

            if let Ok(metadata) = entry.path().metadata() {
                if metadata.len() > LARGE_FILE_THRESHOLD * 5 { total_scanned += 1; continue; }
            }

            total_scanned += 1;
            let content = std::fs::read_to_string(entry.path()).unwrap_or_default();
            let pattern_lower = pattern.to_lowercase();
            let mut line_num = 1;
            for line in content.lines() {
                if line.to_lowercase().contains(&pattern_lower) {
                    results.push(SearchResult {
                        path: entry.path().to_string_lossy().into_owned(),
                        line: line_num,
                        text: line.trim().to_string(),
                    });
                    if results.len() >= max_batch {
                        return Ok(SearchBatchResult { results, total_scanned });
                    }
                }
                line_num += 1;
            }
        }
        Ok(SearchBatchResult { results, total_scanned })
    })
    .await
    .map_err(|e| e.to_string())?
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
