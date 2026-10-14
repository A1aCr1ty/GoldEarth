//! 冲浪热榜的 command 层。
//!
//! 对外只暴露三件事：列平台、拉榜单、看某平台的 Cookie 有没有配。
//! Cookie 的写入复用 `update_settings`，不另外开口子，避免设置散在两处。

use tauri::State;

use crate::trending::{self, Kind, Source};
use crate::AppState;

/// 页面上有哪些平台、每个平台什么状态（含「需不需要 Cookie」）
#[tauri::command]
pub fn trending_sources(state: State<'_, AppState>) -> Vec<SourceInfo> {
    let settings = state.storage.settings();
    Source::all()
        .into_iter()
        .map(|s| SourceInfo::from_source(s, &settings))
        .collect()
}

/// 拉一批平台的热榜。`sources` 为空表示全部都要。
#[tauri::command]
pub async fn trending_boards(
    state: State<'_, AppState>,
    sources: Option<Vec<String>>,
    kind: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<trending::HotBoard>, String> {
    let wanted: Vec<Source> = match sources {
        // 空列表等价于「全都要」，前端初始化时不用先拉一遍平台清单
        None => Source::all().to_vec(),
        Some(list) => {
            let parsed: Vec<Source> = list.iter().filter_map(|s| Source::parse(s.trim())).collect();
            if parsed.is_empty() {
                Source::all().to_vec()
            } else {
                parsed
            }
        }
    };

    let kind = kind.as_deref().and_then(Kind::parse);
    let settings = state.storage.settings();
    let boards = trending::feed(&wanted, kind, &settings).await;

    // limit 在后端统一截，前端就不用每张卡片自己切一刀
    Ok(match limit {
        Some(n) if n > 0 => boards
            .into_iter()
            .map(|mut b| {
                b.items.truncate(n);
                b
            })
            .collect(),
        _ => boards,
    })
}

/// 单平台查询，冲浪页局部刷新用（比如只刷 B 站那一张卡）
#[tauri::command]
pub async fn trending_board(
    state: State<'_, AppState>,
    source: String,
    kind: Option<String>,
    limit: Option<usize>,
) -> Result<trending::HotBoard, String> {
    let source = Source::parse(source.trim()).ok_or_else(|| format!("未知平台：{source}"))?;
    let kind = kind.as_deref().and_then(Kind::parse);
    let settings = state.storage.settings();
    let mut board = trending::fetch_board(source, kind, &settings).await;
    if let Some(n) = limit.filter(|n| *n > 0) {
        board.items.truncate(n);
    }
    Ok(board)
}

/// B 站可切换的榜单口径
#[tauri::command]
pub fn trending_kinds() -> Vec<KindInfo> {
    trending::kinds()
        .into_iter()
        .map(|(value, label)| KindInfo {
            value: value.to_string(),
            label: label.to_string(),
        })
        .collect()
}

/// 平台元信息：名字、色标、要不要 Cookie、用户配了没
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceInfo {
    pub value: String,
    pub label: String,
    pub accent: String,
    pub needs_cookie: bool,
    /// 用户已经填了 Cookie 吗（不返回 Cookie 内容本身）
    pub cookie_ready: bool,
}

impl SourceInfo {
    fn from_source(s: Source, settings: &crate::db::models::AppSettings) -> Self {
        let cookie_ready = !s.cookie_of(settings).trim().is_empty();
        Self {
            value: s.id().to_string(),
            label: s.label().to_string(),
            accent: s.accent().to_string(),
            needs_cookie: s.needs_cookie(),
            cookie_ready,
        }
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KindInfo {
    pub value: String,
    pub label: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_all_four_sources_with_labels() {
        let settings = crate::db::models::AppSettings::default();
        let list: Vec<SourceInfo> = Source::all()
            .into_iter()
            .map(|s| SourceInfo::from_source(s, &settings))
            .collect();

        assert_eq!(list.len(), 4);
        assert_eq!(list[0].value, "bilibili");
        assert_eq!(list[1].label, "微博");
        assert!(list[2].needs_cookie, "雪球要 Cookie");
        assert!(list[3].needs_cookie, "小红书要 Cookie");
        assert!(!list[0].needs_cookie, "B 站匿名可取");
        assert!(!list[2].cookie_ready, "默认没配 Cookie");
    }

    #[test]
    fn detects_configured_cookie_without_leaking_it() {
        let mut settings = crate::db::models::AppSettings::default();
        settings.xueqiu_cookie = "xq_a_token=abc".into();
        let info = SourceInfo::from_source(Source::Xueqiu, &settings);
        assert!(info.cookie_ready);
        // 只回「配没配」，不回内容本身
        let v = serde_json::to_value(&info).unwrap();
        assert!(!v.to_string().contains("abc"));
    }

    #[test]
    fn kind_info_uses_camel_case_keys() {
        let v = serde_json::to_value(trending_kinds()).unwrap();
        assert_eq!(v[0]["value"], "popular");
        assert_eq!(v[1]["label"], "全站排行榜");
    }
}
