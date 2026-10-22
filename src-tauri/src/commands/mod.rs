pub mod agents;
pub mod archify;
pub mod categories;
pub mod file_search;
pub mod horoscope;
pub mod housing;
pub mod library;
pub mod market;
pub mod notes;
pub mod nba;
pub mod prices;
pub mod reader;
pub mod trackers;
pub mod trending;
pub mod travel;
pub mod weather;

use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::AppState;

#[tauri::command]
pub fn ping() -> String {
    "pong".to_string()
}

#[derive(serde::Serialize)]
pub struct StorageInfo {
    pub root: String,
    pub total_notes: usize,
    pub total_categories: usize,
}

fn display_storage_path(path: &std::path::Path) -> String {
    let path = path.to_string_lossy();
    #[cfg(target_os = "windows")]
    {
        if let Some(unc) = path.strip_prefix("\\\\?\\UNC\\") {
            return format!("\\\\{unc}");
        }
        return path.strip_prefix("\\\\?\\").unwrap_or(&path).to_string();
    }
    #[cfg(not(target_os = "windows"))]
    path.into_owned()
}

#[tauri::command]
pub fn get_storage_info(state: State<'_, AppState>) -> Result<StorageInfo, String> {
    let storage: Arc<crate::db::Storage> = state.storage.clone();
    let info = StorageInfo {
        root: display_storage_path(storage.root()),
        total_notes: storage.list_notes(None).len(),
        total_categories: storage.list_categories().len(),
    };
    Ok(info)
}

/// 用系统文件管理器打开本地存储目录。Shell 插件的 open 命令只接受 URL，
/// Windows 本地路径不适用该命令的默认 URL 正则范围。
#[tauri::command]
pub fn open_storage_folder(state: State<'_, AppState>) -> Result<(), String> {
    let path = state.storage.root().to_string_lossy().into_owned();
    #[cfg(target_os = "windows")]
    let mut command = {
        let path = if let Some(unc) = path.strip_prefix("\\\\?\\UNC\\") {
            format!("\\\\{unc}")
        } else {
            path.strip_prefix("\\\\?\\").unwrap_or(&path).to_string()
        };
        let mut command = std::process::Command::new("explorer.exe");
        command.arg(path);
        command
    };
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = std::process::Command::new("open");
        command.arg(path);
        command
    };
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    let mut command = {
        let mut command = std::process::Command::new("xdg-open");
        command.arg(path);
        command
    };
    command
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("无法打开本地存储文件夹：{e}"))
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> crate::db::models::AppSettings {
    state.storage.settings()
}

#[tauri::command]
pub fn update_settings(
    state: State<'_, AppState>,
    input: crate::db::models::AppSettingsPatch,
) -> Result<crate::db::models::AppSettings, String> {
    state
        .storage
        .update_settings(input)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn change_storage_location(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<(), String> {
    state
        .storage
        .change_root(std::path::Path::new(&path))
        .map_err(|e| e.to_string())?;
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(700));
        app.restart();
    });
    Ok(())
}
