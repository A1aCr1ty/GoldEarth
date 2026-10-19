use crate::{trackers, AppState};
use tauri::State;
fn root(state: &AppState) -> std::path::PathBuf {
    state.storage.root().join("data").join("trackers")
}
#[tauri::command]
pub async fn tracker_bootstrap(state: State<'_, AppState>) -> Result<trackers::Saved, String> {
    trackers::bootstrap(&root(&state)).await
}
#[tauri::command]
pub async fn tracker_report(
    state: State<'_, AppState>,
    query: trackers::Query,
    force: bool,
) -> Result<trackers::Report, String> {
    trackers::report(&root(&state), query, force).await
}
#[tauri::command]
pub async fn tracker_mutate(
    state: State<'_, AppState>,
    action: String,
    watch: Option<trackers::Watch>,
    observation: Option<trackers::Observation>,
    id: Option<String>,
) -> Result<trackers::Saved, String> {
    trackers::mutate(&root(&state), &action, watch, observation, id).await
}
