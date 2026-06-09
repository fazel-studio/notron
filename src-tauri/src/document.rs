use calamine::{Reader, open_workbook_auto, Data};
use serde::{Deserialize, Serialize};
use docx_rs::*;
use std::fs::File;
use std::io::Write;

#[derive(Serialize, Deserialize, Debug)]
pub struct CsvData {
    pub headers: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub delimiter: char,
}

#[tauri::command]
pub fn read_csv(path: String) -> Result<CsvData, String> {
    let mut workbook = open_workbook_auto(&path).map_err(|e| e.to_string())?;
    
    let sheets = workbook.sheet_names().to_owned();
    if sheets.is_empty() {
        return Err("No sheets found in file".to_string());
    }
    
    let range = workbook.worksheet_range(&sheets[0])
        .map_err(|e| e.to_string())?;
    
    let mut rows: Vec<Vec<String>> = Vec::new();
    for row in range.rows() {
        let mut r = Vec::new();
        for cell in row {
            let val = match cell {
                Data::String(s) => s.to_string(),
                Data::Float(f) => f.to_string(),
                Data::Int(i) => i.to_string(),
                Data::Bool(b) => b.to_string(),
                Data::Error(e) => e.to_string(),
                Data::Empty => String::new(),
                Data::DateTime(d) => d.to_string(),
                _ => format!("{:?}", cell),
            };
            r.push(val);
        }
        rows.push(r);
    }
    
    let headers = if !rows.is_empty() { rows.remove(0) } else { Vec::new() };
    
    Ok(CsvData {
        headers,
        rows,
        delimiter: ',',
    })
}

#[tauri::command]
pub fn write_csv(path: String, headers: Vec<String>, rows: Vec<Vec<String>>, delimiter: char) -> Result<(), String> {
    let mut file = File::create(&path).map_err(|e| e.to_string())?;
    
    let header_line = headers.join(&delimiter.to_string());
    writeln!(file, "{}", header_line).map_err(|e| e.to_string())?;
    
    for row in rows {
        let row_line = row.join(&delimiter.to_string());
        writeln!(file, "{}", row_line).map_err(|e| e.to_string())?;
    }
    
    Ok(())
}

#[tauri::command]
pub fn read_docx(path: String) -> Result<String, String> {
    // docx-rs reader has limited extraction capabilities in free form
    // A simplified extraction reading raw text nodes
    let file = File::open(&path).map_err(|e| e.to_string())?;
    let mut content = String::new();
    
    // We can fallback to basic text extraction reading docx as a zip if docx-rs reader fails
    if let Ok(mut archive) = zip::ZipArchive::new(file) {
        if let Ok(mut doc_xml) = archive.by_name("word/document.xml") {
            let mut xml = String::new();
            std::io::Read::read_to_string(&mut doc_xml, &mut xml).unwrap_or_default();
            
            let mut inside_tag = false;
            let mut last_char = ' ';
            for c in xml.chars() {
                if c == '<' {
                    inside_tag = true;
                    continue;
                }
                if c == '>' {
                    inside_tag = false;
                    // replace tag close with space to avoid words joining
                    if last_char != '\n' {
                        content.push('\n');
                        last_char = '\n';
                    }
                    continue;
                }
                if !inside_tag {
                    content.push(c);
                    last_char = c;
                }
            }
        }
    }
    
    Ok(content.trim().to_string())
}

#[tauri::command]
pub fn write_docx(path: String, markdown_content: String) -> Result<(), String> {
    let file = File::create(&path).map_err(|e| e.to_string())?;
    
    let mut doc = Docx::new();
    for line in markdown_content.lines() {
        if line.starts_with("# ") {
            let p = Paragraph::new().add_run(Run::new().add_text(&line[2..]).bold());
            doc = doc.add_paragraph(p);
        } else if line.starts_with("## ") {
            let p = Paragraph::new().add_run(Run::new().add_text(&line[3..]).bold());
            doc = doc.add_paragraph(p);
        } else {
            let p = Paragraph::new().add_run(Run::new().add_text(line));
            doc = doc.add_paragraph(p);
        }
    }
    
    doc.build().pack(file).map_err(|e| e.to_string())?;
    Ok(())
}
