use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::models::AppSettingsPatch;
use crate::market::types::{Period, Quote, RankItem, RankKind};
use crate::market::{self, symbol};
use crate::AppState;

fn state_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// 可供勾选的指数清单，供前端渲染选择器。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexOption {
    pub code: String,
    pub name: String,
}

/// 全部可选指数
#[tauri::command]
pub fn available_indices() -> Vec<IndexOption> {
    market::AVAILABLE_INDICES
        .iter()
        .map(|(code, name)| IndexOption {
            code: code.to_string(),
            name: name.to_string(),
        })
        .collect()
}

/// 顶部指数条。用户没配过就展示默认那六个。
#[tauri::command]
pub async fn market_indices(state: State<'_, AppState>) -> Result<Vec<Quote>, String> {
    let configured = state.storage.settings().index_codes;
    let codes: Vec<String> = if configured.is_empty() {
        market::INDEX_CODES.iter().map(|c| c.to_string()).collect()
    } else {
        // 过滤掉已经不在清单里的代码，避免设置文件里留了脏数据就整个板块报错
        configured
            .into_iter()
            .filter(|c| market::AVAILABLE_INDICES.iter().any(|(code, _)| code == c))
            .collect()
    };
    if codes.is_empty() {
        return Ok(Vec::new());
    }
    let mut list = market::quotes(&codes).await?;
    market::enrich_names(&mut list).await;
    Ok(list)
}

/// 批量实时快照（自选股列表用）
#[tauri::command]
pub async fn stock_quotes(codes: Vec<String>) -> Result<Vec<Quote>, String> {
    if codes.is_empty() {
        return Ok(Vec::new());
    }
    let mut list = market::quotes(&codes).await?;
    market::enrich_names(&mut list).await;
    Ok(list)
}

/// 单只股票的完整快照
#[tauri::command]
pub async fn stock_quote(code: String) -> Result<Quote, String> {
    market::quote_with_name(&code).await
}

/// 历史 K 线
#[tauri::command]
pub async fn stock_kline(code: String, period: String, limit: Option<usize>) -> Result<Vec<market::types::Candle>, String> {
    let p = Period::parse(&period).ok_or_else(|| format!("未知的 K 线周期：{period}"))?;
    market::kline(&code, p, limit.unwrap_or(500)).await
}

/// 当日分时
#[tauri::command]
pub async fn stock_trends(code: String) -> Result<market::types::Trend, String> {
    market::trends(&code).await
}

/// 榜单：gainers / losers / amount / turnover
#[tauri::command]
pub async fn market_rankings(kind: String, limit: Option<usize>) -> Result<Vec<RankItem>, String> {
    let k = RankKind::parse(&kind).ok_or_else(|| format!("未知的榜单类型：{kind}"))?;
    market::rankings(k, limit.unwrap_or(20)).await
}

/// 个股资金流
#[tauri::command]
pub async fn stock_fund_flow(code: String) -> Result<market::types::FundFlow, String> {
    market::fund_flow(&code).await
}

/// 自选股条目
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchItem {
    pub code: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub group: String,
}

/// 自选股列表一次最多留这么多条
const WATCHLIST_MAX: usize = 200;

/// 规范化一份自选股：丢掉空代码、统一成带交易所前缀的形式、按代码去重并保留原顺序
fn normalize_watch_list(items: Vec<WatchItem>) -> Vec<WatchItem> {
    let mut cleaned: Vec<WatchItem> = Vec::new();
    for mut it in items {
        let normalized = symbol::normalize(&it.code);
        if normalized.is_empty() {
            continue;
        }
        // 去重，保留第一次出现的顺序
        if cleaned.iter().any(|x| x.code == normalized) {
            continue;
        }
        it.code = normalized;
        cleaned.push(it);
        if cleaned.len() >= WATCHLIST_MAX {
            break;
        }
    }
    cleaned
}

/// 记下「用户已经自己管过自选股了」，只在第一次真正需要时写一次设置文件
fn mark_watchlist_seeded(state: &AppState) -> Result<(), String> {
    if state.storage.settings().watchlist_seeded {
        return Ok(());
    }
    state
        .storage
        .update_settings(AppSettingsPatch {
            watchlist_seeded: Some(true),
            ..Default::default()
        })
        .map(|_| ())
        .map_err(state_err)
}

/// 写入自选股。用户增删过就算接管了这份列表，之后不再自动补默认值。
fn write_watch_list(state: &AppState, items: Vec<WatchItem>) -> Result<Vec<WatchItem>, String> {
    let cleaned = normalize_watch_list(items);
    state.storage.save_watchlist(&cleaned).map_err(state_err)?;
    mark_watchlist_seeded(state)?;
    Ok(cleaned)
}

/// 读取自选股
#[tauri::command]
pub fn get_watchlist(state: State<'_, AppState>) -> Result<Vec<WatchItem>, String> {
    Ok(state.storage.list_watchlist())
}

/// 覆盖保存自选股
#[tauri::command]
pub fn save_watchlist(state: State<'_, AppState>, items: Vec<WatchItem>) -> Result<Vec<WatchItem>, String> {
    write_watch_list(&state, items)
}

/// 首次进入看板时铺一份默认自选股。
///
/// 只在从没初始化过的时候铺：用户把自选删空是明确意图，
/// 之后（哪怕列表是空的）都不再自动塞回去，否则删了又会自己冒出来。
#[tauri::command]
pub fn seed_watchlist(state: State<'_, AppState>, items: Vec<WatchItem>) -> Result<Vec<WatchItem>, String> {
    if state.storage.settings().watchlist_seeded {
        return Ok(state.storage.list_watchlist());
    }
    let existing = state.storage.list_watchlist();
    if !existing.is_empty() {
        // 列表里已经有东西：只补标记，不动数据
        mark_watchlist_seeded(&state)?;
        return Ok(existing);
    }
    write_watch_list(&state, items)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_watch_list_cleans_and_keeps_order() {
        let items = vec![
            WatchItem { code: "sh600519".into(), name: "贵州茅台".into(), group: "".into() },
            // 同一个代码换种写法：应当被去重，且保留第一次出现的位置
            WatchItem { code: "SH600519".into(), name: "重复".into(), group: "".into() },
            // 裸代码要补上交易所前缀
            WatchItem { code: "000001".into(), name: "平安银行".into(), group: "".into() },
            WatchItem { code: "   ".into(), name: "空代码".into(), group: "".into() },
        ];
        let cleaned = normalize_watch_list(items);
        let codes: Vec<&str> = cleaned.iter().map(|w| w.code.as_str()).collect();
        assert_eq!(codes, vec!["sh600519", "sz000001"], "去重/补前缀/丢空代码");
        assert_eq!(cleaned[0].name, "贵州茅台", "保留第一次出现的那条");
    }

    #[test]
    fn normalize_watch_list_caps_the_list() {
        let items = (0..WATCHLIST_MAX + 50)
            .map(|i| WatchItem { code: format!("sh{:06}", i), name: String::new(), group: String::new() })
            .collect();
        assert_eq!(normalize_watch_list(items).len(), WATCHLIST_MAX);
    }

    #[test]
    fn watch_item_serializes_camel_case() {
        let item = WatchItem {
            code: "sh600519".into(),
            name: "贵州茅台".into(),
            group: "核心".into(),
        };
        let v = serde_json::to_value(&item).unwrap();
        assert_eq!(v["code"], "sh600519");
        assert!(v.get("note_id").is_none());
    }
}