use crate::{travel, AppState};
use tauri::State;

#[tauri::command]
pub async fn daily_travel(
    state: State<'_, AppState>,
    date: String,
    force: Option<bool>,
    days: Option<usize>,
) -> Result<travel::DailyTravel, String> {
    let days = days.unwrap_or(3);
    let cache = state.storage.root().join("data").join(format!("daily-travel-{days}d.json"));
    travel::daily(&cache, &date, force.unwrap_or(false), days).await
}
