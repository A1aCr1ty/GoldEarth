use serde::Deserialize;
use tauri::State;

use crate::AppState;
use crate::db::{now_iso, models::{Note, NoteFormat}};

fn state_err<E: std::fmt::Display>(e: E) -> String { e.to_string() }

#[tauri::command]
pub fn list_notes(state: State<'_, AppState>, category_id: Option<String>) -> Result<Vec<Note>, String> {
    Ok(state.storage.list_notes(category_id.as_deref()))
}

#[tauri::command]
pub fn get_note(state: State<'_, AppState>, id: String) -> Result<Note, String> {
    state.storage.get_note(&id).map_err(state_err)
}

#[derive(Debug, Deserialize)]
pub struct NoteInput {
    pub category_id: Option<String>,
    pub title: String,
    pub format: NoteFormat,
    #[serde(default)]
    pub content: String,
    #[serde(default)]
    pub tags: Vec<String>,
    /// 载入时看到的磁盘修改时间；与磁盘不一致则拒绝覆盖（外部 Agent 改过）
    #[serde(default)]
    pub expected_modified: Option<String>,
}

#[tauri::command]
pub fn create_note(state: State<'_, AppState>, input: NoteInput) -> Result<Note, String> {
    let now = now_iso();
    let note = Note {
        id: uuid::Uuid::new_v4().to_string(),
        category_id: input.category_id,
        title: input.title,
        format: input.format,
        content: input.content,
        tags: input.tags,
        created_at: now.clone(),
        updated_at: now,
        modified: String::new(),
    };
    state.storage.insert_note(note).map_err(state_err)
}

#[tauri::command]
pub fn update_note(state: State<'_, AppState>, id: String, input: NoteInput) -> Result<Note, String> {
    state
        .storage
        .update_note(
            &id,
            Some(input.category_id),
            Some(input.title),
            Some(input.format),
            Some(input.content),
            Some(input.tags),
            input.expected_modified,
        )
        .map_err(state_err)
}

#[tauri::command]
pub fn delete_note(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.storage.delete_note(&id).map_err(state_err)
}
