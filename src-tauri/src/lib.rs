mod db;
mod agents;
mod commands;
mod market;
mod weather;

use std::sync::Arc;
use parking_lot::Mutex;
use tauri::Manager;

pub struct AppState {
    pub storage: Arc<db::Storage>,
    pub runs: Arc<Mutex<agents::RunRegistry>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let storage = db::Storage::new(app.handle())?;
            storage.init()?;
            let state = AppState {
                storage: Arc::new(storage),
                runs: Arc::new(Mutex::new(agents::RunRegistry::default())),
            };
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::ping,
            commands::get_storage_info,
            commands::get_settings,
            commands::update_settings,
            commands::categories::list_categories,
            commands::categories::create_category,
            commands::categories::update_category,
            commands::categories::delete_category,
            commands::notes::list_notes,
            commands::notes::get_note,
            commands::notes::create_note,
            commands::notes::update_note,
            commands::notes::delete_note,
            commands::agents::list_agents,
            commands::agents::create_agent,
            commands::agents::update_agent,
            commands::agents::delete_agent,
            commands::agents::run_agent,
            commands::agents::cancel_agent_run,
            commands::agents::list_agent_runs,
            commands::agents::list_note_runs,
            commands::agents::list_stock_runs,
            commands::agents::get_note_agent_session,
            commands::agents::get_stock_agent_session,
            commands::agents::get_note_file_path,
            commands::agents::list_library_runs,
            commands::agents::get_library_agent_session,
            commands::agents::get_library_dir,
            commands::library::list_library_categories,
            commands::library::create_library_category,
            commands::library::update_library_category,
            commands::library::set_library_category_agent,
            commands::library::delete_library_category,
            commands::library::list_library_files,
            commands::library::import_library_files,
            commands::library::delete_library_file,
            commands::library::read_library_text,
            commands::library::library_category_path,
            commands::market::available_indices,
            commands::market::market_indices,
            commands::market::stock_quotes,
            commands::market::stock_quote,
            commands::market::stock_kline,
            commands::market::stock_trends,
            commands::market::market_rankings,
            commands::market::stock_fund_flow,
            commands::market::get_watchlist,
            commands::market::save_watchlist,
            commands::market::seed_watchlist,
            commands::weather::weather_report,
            commands::weather::search_cities,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
