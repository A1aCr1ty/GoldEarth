mod agents;
mod commands;
mod db;
mod horoscope;
mod market;
mod public_prices;
mod trending;
mod travel;
mod weather;
mod xianyu_webview;

use parking_lot::Mutex;
use std::sync::Arc;
use tauri::Manager;

pub struct AppState {
    pub storage: Arc<db::Storage>,
    pub runs: Arc<Mutex<agents::RunRegistry>>,
    /// 闲鱼抓价：建隐藏 webview 的命令在等它，页面回调在叫醒它
    pub xianyu: Arc<xianyu_webview::XianyuWait>,
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
                xianyu: Arc::new(xianyu_webview::XianyuWait::default()),
            };
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::ping,
            commands::archify::archify_template,
            commands::archify::prepare_archify_generation,
            commands::archify::render_archify,
            commands::archify::export_archify,
            commands::archify::export_archify_to_category,
            commands::archify::open_archify_category_folder,
            commands::get_storage_info,
            commands::open_storage_folder,
            commands::get_settings,
            commands::update_settings,
            commands::change_storage_location,
            commands::categories::list_categories,
            commands::categories::list_category_html_files,
            commands::categories::read_category_html_file,
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
            commands::library::import_notes_to_library,
            commands::library::delete_library_file,
            commands::library::read_library_text,
            commands::library::library_category_path,
            commands::market::available_indices,
            commands::market::market_indices,
            commands::market::stock_quotes,
            commands::market::stock_quote,
            commands::market::search_stocks,
            commands::market::stock_kline,
            commands::market::stock_trends,
            commands::market::market_rankings,
            commands::market::stock_fund_flow,
            commands::market::get_watchlist,
            commands::market::save_watchlist,
            commands::market::seed_watchlist,
            commands::weather::weather_report,
            commands::travel::daily_travel,
            commands::weather::search_cities,
            commands::horoscope::horoscope_today,
            commands::trending::trending_sources,
            commands::trending::trending_kinds,
            commands::trending::show_trending_source,
            commands::trending::trending_boards,
            commands::trending::trending_board,
            commands::reader::open_reader,
            commands::prices::list_price_targets,
            commands::prices::add_price_target,
            commands::prices::set_price_zhuanzhuan_url,
            commands::prices::remove_price_target,
            commands::prices::list_price_samples,
            commands::prices::price_trend,
            commands::prices::price_overview,
            commands::prices::fetch_xianyu_price,
            public_prices::fetch_public_price,
            commands::prices::show_xianyu_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
