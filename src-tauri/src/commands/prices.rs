//! 首页「价格追踪」板块的命令。
//!
//! 物品清单和价格记录都在本地 JSON 里；闲鱼只作为**可选**的取价来源，
//! 抓不到就如实报错，不塞假价格进去（实测记录见 `xianyu.rs`）。

use tauri::State;

use crate::db::models::{PriceOverview, PriceSample, PriceTarget, TrendPoint};
use crate::AppState;

fn state_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

#[tauri::command]
pub fn list_price_targets(state: State<'_, AppState>) -> Vec<PriceTarget> {
    state.storage.list_price_targets()
}

#[tauri::command]
pub fn add_price_target(
    state: State<'_, AppState>,
    name: String,
    keyword: Option<String>,
    note: Option<String>,
) -> Result<PriceTarget, String> {
    state
        .storage
        .add_price_target(name, keyword.unwrap_or_default(), note.unwrap_or_default())
        .map_err(state_err)
}

#[tauri::command]
pub fn set_price_zhuanzhuan_url(
    state: State<'_, AppState>,
    target_id: String,
    url: String,
) -> Result<(), String> {
    let canonical = if url.trim().is_empty() {
        String::new()
    } else {
        crate::public_prices::zhuanzhuan_url(url.trim())
            .ok_or("请粘贴转转商品详情分享链接（含 infoId）")?
            .to_string()
    };
    state
        .storage
        .set_price_zhuanzhuan_url(&target_id, canonical)
        .map_err(state_err)
}

#[tauri::command]
pub fn remove_price_target(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.storage.remove_price_target(&id).map_err(state_err)
}

#[tauri::command]
pub fn list_price_samples(state: State<'_, AppState>, target_id: String) -> Vec<PriceSample> {
    state.storage.list_price_samples(&target_id)
}

/// 趋势图的数据；`days` 传 0 或负数表示不限
#[tauri::command]
pub fn price_trend(
    state: State<'_, AppState>,
    target_id: String,
    days: Option<i64>,
) -> Vec<TrendPoint> {
    state.storage.price_trend(&target_id, days.unwrap_or(90))
}

/// 首页卡：每个物品一行，带迷你走势图
#[tauri::command]
pub fn price_overview(state: State<'_, AppState>, spark_days: Option<usize>) -> Vec<PriceOverview> {
    state.storage.price_overview(spark_days.unwrap_or(14))
}

/// 借 App 自己的 WebView2 去闲鱼搜一次价。
///
/// 直连（reqwest）那条路被 baxia 风控挡着，理由和实测记录见
/// `xianyu.rs`；这里借 App 自带的真 Chromium 绕过去。
///
/// 命令名和模块里的 `xianyu_webview::xianyu_fetch` 故意不一样：
/// `#[tauri::command]` 生成的 `__cmd__<名字>` 是 crate 全局的，同名会撞车。
#[tauri::command]
pub async fn fetch_xianyu_price(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    target_id: String,
) -> Result<crate::xianyu_webview::FetchSummary, String> {
    let target = state
        .storage
        .list_price_targets()
        .into_iter()
        .find(|t| t.id == target_id)
        .ok_or_else(|| format!("物品 {target_id} 不在了"))?;
    let keyword = if target.keyword.trim().is_empty() {
        target.name.clone()
    } else {
        target.keyword.clone()
    };
    let wait = state.xianyu.clone();
    crate::xianyu_webview::xianyu_fetch(app, wait, state, target_id, keyword).await
}

/// 把那扇隐藏的抓价窗口显示出来。闲鱼要登录时用得上
#[tauri::command]
pub async fn show_xianyu_window(app: tauri::AppHandle) -> Result<(), String> {
    crate::xianyu_webview::xianyu_show(app).await
}
