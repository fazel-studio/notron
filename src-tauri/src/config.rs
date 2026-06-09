use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use std::sync::Mutex;

pub struct ConfigState(pub Mutex<AppConfig>);

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AppConfig {
    pub theme: String,
    pub font_size: u32,
    pub font_family: String,
    pub tab_size: u32,
    pub word_wrap: bool,
    pub line_numbers: bool,
    pub auto_save: bool,
    pub auto_save_delay_ms: u32,
    pub default_encoding: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            theme: "system".to_string(),
            font_size: 14,
            font_family: "JetBrains Mono, Consolas, monospace".to_string(),
            tab_size: 4,
            word_wrap: false,
            line_numbers: true,
            auto_save: false,
            auto_save_delay_ms: 1000,
            default_encoding: "UTF-8".to_string(),
        }
    }
}

fn get_config_path(app_handle: &AppHandle) -> PathBuf {
    let app_dir = app_handle.path().app_config_dir().expect("failed to get config dir");
    fs::create_dir_all(&app_dir).expect("failed to create config dir");
    app_dir.join("config.toml")
}

pub fn load_config(app_handle: &AppHandle) -> AppConfig {
    let config_path = get_config_path(app_handle);
    if config_path.exists() {
        if let Ok(content) = fs::read_to_string(&config_path) {
            if let Ok(config) = toml::from_str(&content) {
                return config;
            }
        }
    }
    
    let default_config = AppConfig::default();
    save_config_to_file(&config_path, &default_config).ok();
    default_config
}

fn save_config_to_file(path: &PathBuf, config: &AppConfig) -> Result<(), String> {
    let content = toml::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_config(state: tauri::State<ConfigState>) -> Result<AppConfig, String> {
    let lock = state.0.lock().unwrap();
    Ok(lock.clone())
}

#[tauri::command]
pub fn set_config(config: AppConfig, state: tauri::State<ConfigState>, app_handle: tauri::AppHandle) -> Result<(), String> {
    let mut lock = state.0.lock().unwrap();
    *lock = config.clone();
    
    let config_path = get_config_path(&app_handle);
    save_config_to_file(&config_path, &config)?;
    
    Ok(())
}
