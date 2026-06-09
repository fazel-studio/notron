use std::fs;
use std::path::Path;
use encoding_rs::Encoding;
use serde::{Deserialize, Serialize};

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
    pub children: Option<Vec<FileNode>>,
}

#[tauri::command]
pub fn open_file(path: String) -> Result<FileContent, String> {
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
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

#[tauri::command]
pub fn read_file_binary(path: String) -> Result<Vec<u8>, String> {
    fs::read(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_file(path: String, content: String, encoding: Option<String>) -> Result<(), String> {
    let enc_str = encoding.unwrap_or_else(|| "UTF-8".to_string());
    let enc = Encoding::for_label(enc_str.as_bytes()).unwrap_or(encoding_rs::UTF_8);
    let (cow, _, _) = enc.encode(&content);
    fs::write(path, cow).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn read_directory(path: String) -> Result<FileNode, String> {
    fn build_tree(dir_path: &Path, depth: u8) -> Result<FileNode, String> {
        let name = dir_path.file_name().unwrap_or_default().to_string_lossy().into_owned();
        let path_str = dir_path.to_string_lossy().into_owned();
        
        if dir_path.is_file() {
            return Ok(FileNode {
                name,
                path: path_str,
                is_dir: false,
                children: None,
            });
        }
        
        // LIMIT DEPTH to 1 to avoid freezing the app on large directories!
        // The frontend should lazy-load deeper levels when expanded.
        if depth > 1 {
            return Ok(FileNode {
                name,
                path: path_str,
                is_dir: true,
                children: Some(vec![]), // Empty children to indicate it's a directory
            });
        }

        let mut children = Vec::new();
        if let Ok(entries) = fs::read_dir(dir_path) {
            for entry in entries.flatten() {
                let child_name = entry.file_name().to_string_lossy().into_owned();
                // Filter out common unnecessary files/folders
                if child_name == ".git" || child_name == ".svn" || child_name == ".hg" || child_name == ".DS_Store" {
                    continue;
                }
                
                if let Ok(child_node) = build_tree(&entry.path(), depth + 1) {
                    children.push(child_node);
                }
            }
        }
        
        children.sort_by(|a, b| {
            b.is_dir.cmp(&a.is_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });

        Ok(FileNode {
            name,
            path: path_str,
            is_dir: true,
            children: Some(children),
        })
    }

    let start_path = Path::new(&path);
    if !start_path.exists() {
        return Err("Path does not exist".to_string());
    }
    
    build_tree(start_path, 0)
}

#[tauri::command]
pub fn get_file_info(path: String) -> Result<FileInfo, String> {
    let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;
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
pub fn file_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[tauri::command]
pub fn create_dir(path: String) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn detect_language(path: String) -> String {
    let path_obj = Path::new(&path);
    match path_obj.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase().as_str() {
        "js" | "jsx" => "javascript",
        "ts" | "tsx" => "typescript",
        "py" | "pyw" => "python",
        "rs" => "rust",
        "go" => "go",
        "java" => "java",
        "cpp" | "cxx" | "cc" | "c" | "h" | "hpp" => "cpp",
        "cs" => "csharp",
        "html" | "htm" => "html",
        "css" => "css",
        "scss" | "sass" => "scss",
        "json" => "json",
        "xml" => "xml",
        "md" | "markdown" => "markdown",
        "sql" => "sql",
        "php" => "php",
        "sh" | "bash" => "shell",
        "yaml" | "yml" => "yaml",
        "toml" => "toml",
        "txt" => "plaintext",
        _ => "plaintext",
    }.to_string()
}

#[tauri::command]
pub fn rename_item(old_path: String, new_path: String) -> Result<(), String> {
    fs::rename(old_path, new_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_item(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.is_dir() {
        fs::remove_dir_all(p).map_err(|e| e.to_string())
    } else {
        fs::remove_file(p).map_err(|e| e.to_string())
    }
}

fn copy_dir_all(src: impl AsRef<Path>, dst: impl AsRef<Path>) -> std::io::Result<()> {
    fs::create_dir_all(&dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        if ty.is_dir() {
            copy_dir_all(entry.path(), dst.as_ref().join(entry.file_name()))?;
        } else {
            fs::copy(entry.path(), dst.as_ref().join(entry.file_name()))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn copy_item(src_path: String, dst_path: String) -> Result<(), String> {
    let src = Path::new(&src_path);
    if src.is_dir() {
        copy_dir_all(src, Path::new(&dst_path)).map_err(|e| e.to_string())
    } else {
        fs::copy(src, Path::new(&dst_path)).map_err(|e| e.to_string()).map(|_| ())
    }
}

#[tauri::command]
pub fn create_file(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if let Some(parent) = p.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }
    fs::File::create(path).map_err(|e| e.to_string()).map(|_| ())
}

#[tauri::command]
pub fn search_in_files(path: String, query: String) -> Result<Vec<SearchResult>, String> {
    use walkdir::WalkDir;
    let mut results = Vec::new();
    
    // Limit files to avoid hanging the app
    let mut file_count = 0;

    let search_path = Path::new(&path);
    if !search_path.exists() {
        return Err("Path does not exist".to_string());
    }

    for entry in WalkDir::new(search_path).into_iter().filter_map(|e| e.ok()) {
        if file_count > 10000 { break; }
        
        let path_str = entry.path().to_string_lossy().into_owned();
        
        // Skip common ignored directories
        if path_str.contains(".git") || path_str.contains("node_modules") || path_str.contains("dist") || path_str.contains("target") {
            continue;
        }

        if entry.file_type().is_file() {
            let ext = entry.path().extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
            match ext.as_str() {
                "png" | "jpg" | "jpeg" | "gif" | "exe" | "dll" | "so" | "zip" | "tar" | "gz" | "bin" | "ttf" | "woff" | "ico" => continue,
                _ => {}
            }
            
            if let Ok(content) = fs::read_to_string(entry.path()) {
                let mut line_num = 1;
                for line in content.lines() {
                    if line.to_lowercase().contains(&query.to_lowercase()) {
                        results.push(SearchResult {
                            path: path_str.clone(),
                            line: line_num,
                            text: line.to_string(),
                        });
                        // Limit to top 200 matches to prevent UI lag
                        if results.len() > 200 {
                            return Ok(results);
                        }
                    }
                    line_num += 1;
                }
            }
            file_count += 1;
        }
    }
    
    Ok(results)
}

