use crate::{housing, AppState};
use tauri::State;
#[tauri::command]
pub async fn housing_source_open(
    app: tauri::AppHandle,
    query: housing::Query,
    year: i32,
) -> Result<(), String> {
    housing::source_open(&app, &query, year)
}
#[tauri::command]
pub async fn housing_source_read(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    query: housing::Query,
    year: i32,
) -> Result<housing::Report, String> {
    housing::source_read(&app, &root(&state), query, year).await
}
fn root(state: &AppState) -> std::path::PathBuf {
    state.storage.root().join("data").join("housing")
}
#[derive(serde::Serialize)]
pub struct Bootstrap {
    cities: Vec<housing::City>,
    saved: housing::Saved,
}
#[tauri::command]
pub async fn housing_bootstrap(state: State<'_, AppState>) -> Result<Bootstrap, String> {
    let (cities, saved) = housing::bootstrap(&root(&state)).await?;
    Ok(Bootstrap { cities, saved })
}
#[tauri::command]
pub async fn housing_report(
    state: State<'_, AppState>,
    query: housing::Query,
    force: bool,
) -> Result<housing::Report, String> {
    housing::report(&root(&state), query, force).await
}
#[tauri::command]
pub async fn housing_communities(
    city: String,
    keyword: String,
) -> Result<Vec<housing::Community>, String> {
    housing::communities(&city, &keyword).await
}
#[tauri::command]
pub async fn housing_watch(
    state: State<'_, AppState>,
    query: housing::Query,
) -> Result<Vec<housing::Watch>, String> {
    housing::watch(&root(&state), query).await
}
#[tauri::command]
pub async fn housing_remove(
    state: State<'_, AppState>,
    id: String,
    observation: bool,
) -> Result<housing::Saved, String> {
    housing::remove(&root(&state), &id, observation).await
}
#[tauri::command]
pub async fn housing_observe(
    state: State<'_, AppState>,
    query: housing::Query,
    observation: housing::Observation,
) -> Result<housing::Saved, String> {
    housing::observe(&root(&state), query, observation).await
}
