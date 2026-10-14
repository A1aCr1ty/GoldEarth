pub mod categories;
pub mod notes;
pub mod agents;
pub mod market;
pub mod weather;
pub mod library;
pub mod horoscope;
pub mod trending;

use std::sync::Arc;

use tauri::State;

use crate::AppState;

#[tauri::command]
pub fn ping() -> String { "pong".to_string() }

#[derive(serde::Serialize)]
pub struct StorageInfo {
    pub root: String,
    pub total_notes: usize,
    pub total_categories: usize,
}

#[tauri::command]
pub fn get_storage_info(state: State<'_, AppState>) -> Result<StorageInfo, String> {
    let storage: Arc<crate::db::Storage> = state.storage.clone();
    let info = StorageInfo {
        root: storage.root().display().to_string(),
        total_notes: storage.list_notes(None).len(),
        total_categories: storage.list_categories().len(),
    };
    Ok(info)
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
    state.storage.update_settings(input).map_err(|e| e.to_string())
}
