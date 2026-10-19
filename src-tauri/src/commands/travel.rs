use crate::{travel, AppState};
use tauri::State;

#[tauri::command]
pub async fn daily_travel(
    state: State<'_, AppState>,
    date: String,
    force: Option<bool>,
) -> Result<travel::DailyTravel, String> {
    let cache = state.storage.root().join("data").join("daily-travel.json");
    travel::daily(&cache, &date, force.unwrap_or(false)).await
}
