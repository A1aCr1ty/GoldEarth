// 应用自己的 ACL 清单。
//
// 为什么需要这个：`#[tauri::command]` 注册的命令默认放行，但那**只对
// 本地页面成立**。Tauri 源码 `webview/mod.rs` 里写得很明确——
//
//   // Check ACL on plugin commands, when the app defined its ACL manifest,
//   // or when the request comes from a non-local (remote) origin. This
//   // ensures remote content can never reach custom commands unless an
//   // explicit `remote` capability has been configured for them.
//
// 代价是：一旦这里配了 app_manifest，`has_app_acl_manifest()` 就恒为真，
// 于是**每一个**应用命令都得在 `permissions/app.toml` 里显式声明，
// 少一条界面上就是「xxx not allowed. Command not found」（price_overview
// 之前就是这么被拒的）。所以这里必须是全量名单。
//
// 顺带把权限面收窄了：抓价窗改成「Rust 用 eval 主动去取、结果写进
// document.title」，页面不再 invoke 任何命令，所以
// capabilities/xianyu.json 和 allow-xianyu-report 都撤掉了——
// 远程页面现在一条应用命令都碰不到。
//
// 名单由 `src/lib.rs` 的 generate_handler! 生成，**别手改**：
// 加了新命令记得 build.rs 和 permissions/app.toml 两边都补。
//
fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "ping",
            "archify_template",
            "prepare_archify_generation",
            "render_archify",
            "export_archify",
            "export_archify_to_category",
            "open_archify_category_folder",
            "get_storage_info",
            "open_storage_folder",
            "change_storage_location",
            "import_notes_to_library",
            "show_trending_source",
            "get_settings",
            "update_settings",
            "list_categories",
            "list_category_html_files",
            "read_category_html_file",
            "create_category",
            "update_category",
            "delete_category",
            "list_notes",
            "get_note",
            "create_note",
            "update_note",
            "delete_note",
            "list_agents",
            "create_agent",
            "update_agent",
            "delete_agent",
            "run_agent",
            "cancel_agent_run",
            "list_agent_runs",
            "list_note_runs",
            "list_stock_runs",
            "get_note_agent_session",
            "get_stock_agent_session",
            "get_note_file_path",
            "list_library_runs",
            "get_library_agent_session",
            "get_library_dir",
            "list_library_categories",
            "create_library_category",
            "update_library_category",
            "set_library_category_agent",
            "delete_library_category",
            "list_library_files",
            "import_library_files",
            "delete_library_file",
            "read_library_text",
            "library_category_path",
            "available_indices",
            "market_indices",
            "stock_quotes",
            "stock_quote",
            "stock_kline",
            "stock_trends",
            "market_rankings",
            "stock_fund_flow",
            "get_watchlist",
            "save_watchlist",
            "seed_watchlist",
            "weather_report",
            "search_cities",
            "horoscope_today",
            "trending_sources",
            "trending_kinds",
            "trending_boards",
            "trending_board",
            "open_reader",
            "list_price_targets",
            "add_price_target",
            "set_price_zhuanzhuan_url",
            "remove_price_target",
            "list_price_samples",
            "price_trend",
            "price_overview",
            "fetch_xianyu_price",
            "fetch_public_price",
            "show_xianyu_window",
        ]),
    ))
    .expect("构建 Tauri 应用 ACL 清单失败");
}
