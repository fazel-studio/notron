use serde::{Deserialize, Serialize};
use std::process::Command;
use tauri::{AppHandle, Manager};
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Debug)]
pub struct ConversionOptions {
    pub standalone: bool,
    pub toc: bool,
    pub highlight_style: Option<String>,
    pub pdf_engine: Option<String>,
    pub extra_args: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct ConversionResult {
    pub success: bool,
    pub output_path: String,
    pub error: Option<String>,
    pub warnings: Vec<String>,
}

fn get_pandoc_path(app: &AppHandle) -> PathBuf {
    if let Ok(res_dir) = app.path().resource_dir() {
        #[cfg(target_os = "windows")]
        let bin_name = "pandoc.exe";
        #[cfg(not(target_os = "windows"))]
        let bin_name = "pandoc";
        
        let path = res_dir.join("binaries").join(bin_name);
        if path.exists() {
            return path;
        }
    }
    
    // Fallback if not found in resource dir
    #[cfg(target_os = "windows")]
    return PathBuf::from("pandoc.exe");
    #[cfg(not(target_os = "windows"))]
    return PathBuf::from("pandoc");
}

#[tauri::command]
pub fn convert_file(
    app: AppHandle,
    input_path: String,
    output_path: String,
    from_format: Option<String>,
    to_format: Option<String>,
    options: ConversionOptions,
) -> Result<ConversionResult, String> {
    
    let pandoc_exe = get_pandoc_path(&app);
    let mut cmd = Command::new(pandoc_exe);
    
    cmd.arg(&input_path);
    cmd.arg("-o").arg(&output_path);

    if let Some(f) = from_format {
        cmd.arg("-f").arg(f);
    }
    if let Some(t) = to_format {
        cmd.arg("-t").arg(t);
    }
    if options.standalone {
        cmd.arg("--standalone");
    }
    if options.toc {
        cmd.arg("--toc");
    }
    if let Some(style) = options.highlight_style {
        cmd.arg(format!("--highlight-style={}", style));
    }
    if let Some(engine) = options.pdf_engine {
        cmd.arg(format!("--pdf-engine={}", engine));
    }
    
    for arg in options.extra_args {
        cmd.arg(arg);
    }

    let output = cmd.output().map_err(|e| format!("Failed to execute pandoc: {}", e))?;

    if output.status.success() {
        let warnings = String::from_utf8_lossy(&output.stderr)
            .lines()
            .map(|s| s.to_string())
            .filter(|s| !s.is_empty())
            .collect();
            
        Ok(ConversionResult {
            success: true,
            output_path,
            error: None,
            warnings,
        })
    } else {
        let error_msg = String::from_utf8_lossy(&output.stderr).to_string();
        Ok(ConversionResult {
            success: false,
            output_path,
            error: Some(error_msg),
            warnings: vec![],
        })
    }
}

#[tauri::command]
pub fn get_conversion_formats() -> Vec<(&'static str, &'static str)> {
    // Provides practical conversion pairs: (format id, Display Name)
    vec![
        ("markdown", "Markdown (.md)"),
        ("docx", "Microsoft Word (.docx)"),
        ("html", "HTML (.html)"),
        ("pdf", "PDF Document (.pdf)"),
        ("epub", "EPUB Book (.epub)"),
        ("latex", "LaTeX (.tex)"),
        ("pptx", "PowerPoint (.pptx)"),
        ("csv", "CSV (.csv)"),
    ]
}
