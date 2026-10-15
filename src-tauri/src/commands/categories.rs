use serde::Deserialize;
use tauri::State;

use crate::db::{models::Category, now_iso};
use crate::AppState;

fn state_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

#[tauri::command]
pub fn list_categories(state: State<'_, AppState>) -> Result<Vec<Category>, String> {
    Ok(state.storage.list_categories())
}

#[derive(Debug, Deserialize)]
pub struct CategoryInput {
    pub name: String,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
}

#[tauri::command]
pub fn create_category(
    state: State<'_, AppState>,
    input: CategoryInput,
) -> Result<Category, String> {
    let now = now_iso();
    let cat = Category {
        id: uuid::Uuid::new_v4().to_string(),
        name: input.name,
        icon: input.icon,
        description: input.description,
        created_at: now.clone(),
        updated_at: now,
    };
    state.storage.insert_category(cat).map_err(state_err)
}

#[tauri::command]
pub fn update_category(
    state: State<'_, AppState>,
    id: String,
    input: CategoryInput,
) -> Result<Category, String> {
    state
        .storage
        .update_category(&id, Some(input.name), input.icon, input.description)
        .map_err(state_err)
}

#[tauri::command]
pub fn delete_category(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.storage.delete_category(&id).map_err(state_err)
}
