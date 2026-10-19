//! 每日国内旅行灵感：日期轮换路线参考，联网聚合相关攻略，保存当天检索结果。
use chrono::{Datelike, NaiveDate, Utc};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, fs, path::Path};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouteDay {
    pub title: String,
    pub stops: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Destination {
    pub id: String,
    pub name: String,
    pub region: String,
    pub theme: String,
    pub intro: String,
    pub season: String,
    pub days: usize,
    pub route: Vec<RouteDay>,
    pub transport: String,
    pub stay: String,
    pub food: Vec<String>,
    pub budget: String,
    pub tips: Vec<String>,
    pub reference_title: String,
    pub reference_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TravelSource {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyTravel {
    pub schema_version: u8,
    pub date: String,
    pub destination: Destination,
    pub sources: Vec<TravelSource>,
    pub researched_at: Option<String>,
    /// live / cached / offline；不能把无检索结果的本地路线标作联网生成。
    pub status: String,
    pub warning: Option<String>,
}

static CATALOG: Lazy<Vec<Destination>> = Lazy::new(|| {
    serde_json::from_str(include_str!("destinations.json")).expect("旅行目的地配置无效")
});
static LOAD_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn destination_for(date: NaiveDate) -> Destination {
    CATALOG[date.num_days_from_ce().rem_euclid(CATALOG.len() as i32) as usize].clone()
}

fn read_cache(path: &Path, date: &str, destination: &Destination) -> Option<DailyTravel> {
    let mut saved: DailyTravel = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
    if saved.schema_version != 1
        || saved.date != date
        || saved.destination.id != destination.id
        || saved.sources.is_empty()
        || saved.researched_at.is_none()
        || saved.sources.iter().any(|source| !safe_url(&source.url))
    {
        return None;
    }
    // 路线升级后使用当前版本的参考内容。
    saved.destination = destination.clone();
    saved.status = "cached".into();
    saved.warning = None;
    Some(saved)
}

pub async fn daily(path: &Path, date: &str, force: bool) -> Result<DailyTravel, String> {
    let day =
        NaiveDate::parse_from_str(date, "%Y-%m-%d").map_err(|_| "推荐日期格式应为 YYYY-MM-DD")?;
    if !(2000..=2200).contains(&day.year()) {
        return Err("推荐日期超出支持范围".into());
    }
    let _guard = LOAD_LOCK.lock().await;
    let destination = destination_for(day);
    let cached = read_cache(path, date, &destination);
    if !force {
        if let Some(saved) = cached.as_ref() {
            return Ok(saved.clone());
        }
    }
    let guide_query = format!("{}旅游攻略", destination.name);
    let reservation_query = format!("{}景点预约交通攻略", destination.name);
    let (guide, reservations) = tokio::join!(
        search(&guide_query, &destination),
        search(&reservation_query, &destination)
    );
    let mut seen = HashSet::new();
    let mut sources = Vec::new();
    for list in [guide, reservations].into_iter().flatten() {
        for source in list {
            if seen.insert(source.url.clone()) {
                sources.push(source);
            }
        }
    }
    sources.sort_by_key(|s| {
        !reqwest::Url::parse(&s.url)
            .ok()
            .and_then(|u| u.host_str().map(|h| h.ends_with(".gov.cn")))
            .unwrap_or(false)
    });
    sources.truncate(6);
    if sources.is_empty() {
        if let Some(mut saved) = cached {
            saved.warning = Some("本次联网检索未成功，保留今天上次检索到的攻略。".into());
            return Ok(saved);
        }
        return Ok(DailyTravel {
            schema_version: 1,
            date: date.into(),
            destination,
            sources,
            researched_at: None,
            status: "offline".into(),
            warning: Some(
                "暂未检索到可用的相关攻略，当前展示本地路线参考，可稍后重试联网搜索。".into(),
            ),
        });
    }
    let mut report = DailyTravel {
        schema_version: 1,
        date: date.into(),
        destination,
        sources,
        researched_at: Some(Utc::now().to_rfc3339()),
        status: "live".into(),
        warning: None,
    };
    if let Err(error) = save_cache(path, &report) {
        report.warning = Some(format!("攻略已获取，但本地缓存未保存：{error}"));
    }
    Ok(report)
}

fn save_cache(path: &Path, report: &DailyTravel) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let temporary = path.with_extension("json.tmp");
    fs::write(
        &temporary,
        serde_json::to_vec_pretty(report).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    fs::rename(temporary, path).map_err(|e| e.to_string())
}

#[derive(Deserialize)]
struct Rss {
    channel: Channel,
}
#[derive(Deserialize)]
struct Channel {
    #[serde(default)]
    item: Vec<RssItem>,
}
#[derive(Deserialize)]
struct RssItem {
    #[serde(default)]
    title: String,
    #[serde(default)]
    link: String,
    #[serde(default)]
    description: String,
}

fn safe_url(raw: &str) -> bool {
    reqwest::Url::parse(raw)
        .map(|u| {
            matches!(u.scheme(), "https" | "http")
                && u.host_str().is_some()
                && u.username().is_empty()
                && u.password().is_none()
        })
        .unwrap_or(false)
}

fn plain_text(raw: &str, limit: usize) -> String {
    let mut inside = false;
    let without_tags: String = raw
        .chars()
        .filter(|c| {
            if *c == '<' {
                inside = true;
                return false;
            }
            if *c == '>' {
                inside = false;
                return false;
            }
            !inside
        })
        .collect();
    let cleaned = without_tags.replace("&nbsp;", " ");
    let decoded = quick_xml::escape::unescape(&cleaned)
        .map(|v| v.into_owned())
        .unwrap_or(cleaned);
    decoded
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(limit)
        .collect()
}

fn parse_results(raw: &str, destination: &Destination) -> Result<Vec<TravelSource>, String> {
    let rss: Rss = quick_xml::de::from_str(raw).map_err(|e| format!("搜索结果解析失败：{e}"))?;
    Ok(rss
        .channel
        .item
        .into_iter()
        .filter_map(|item| {
            let title = plain_text(&item.title, 100);
            let snippet = plain_text(&item.description, 160);
            let text = format!("{title} {snippet}");
            // 搜索服务偶尔返回无关结果，必须同时匹配目的地和旅游主题。
            if !text.contains(&destination.name)
                || !["旅游", "旅行", "攻略", "游玩", "景点", "预约", "行程"]
                    .iter()
                    .any(|word| text.contains(word))
                || !safe_url(&item.link)
            {
                return None;
            }
            Some(TravelSource {
                title,
                url: item.link,
                snippet,
            })
        })
        .take(6)
        .collect())
}

async fn search(query: &str, destination: &Destination) -> Result<Vec<TravelSource>, String> {
    let response = crate::trending::http::client()
        .get("https://www.bing.com/search")
        .query(&[("format", "rss"), ("q", query)])
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    let raw = response.text().await.map_err(|e| e.to_string())?;
    if raw.len() > 1_000_000 {
        return Err("搜索结果过大".into());
    }
    parse_results(&raw, destination)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn daily_selection_is_stable_and_changes_across_midnight() {
        let day = NaiveDate::from_ymd_opt(2026, 10, 16).unwrap();
        assert_eq!(destination_for(day).id, destination_for(day).id);
        for offset in 0..30 {
            let date = day + chrono::Duration::days(offset);
            assert_ne!(
                destination_for(date).id,
                destination_for(date.succ_opt().unwrap()).id
            );
        }
        assert!(CATALOG
            .iter()
            .all(|d| d.route.len() == d.days && safe_url(&d.reference_url)));
    }
    #[test]
    fn parses_cdata_and_rejects_irrelevant_or_unsafe_search_results() {
        let destination = CATALOG.iter().find(|d| d.name == "杭州").unwrap();
        let xml = r#"<rss><channel>
          <item><title>杭州旅游攻略</title><link>https://example.com/guide?a=1&amp;b=2</link><description><![CDATA[<b>杭州</b>西湖游玩路线]]></description></item>
          <item><title>Today in history</title><link>https://example.com/irrelevant</link></item>
          <item><title>杭州旅游</title><link>javascript:alert(1)</link></item>
        </channel></rss>"#;
        let list = parse_results(xml, destination).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].url, "https://example.com/guide?a=1&b=2");
        assert_eq!(list[0].snippet, "杭州西湖游玩路线");
        assert!(parse_results("<html>verification</html>", destination).is_err());
    }
    #[test]
    fn cache_only_applies_to_the_matching_day_and_can_be_replaced() {
        let root = std::env::temp_dir().join(format!("goldearth-travel-{}", uuid::Uuid::new_v4()));
        let path = root.join("daily-travel.json");
        let day = NaiveDate::from_ymd_opt(2026, 10, 16).unwrap();
        let destination = destination_for(day);
        let report = DailyTravel {
            schema_version: 1,
            date: "2026-10-16".into(),
            destination: destination.clone(),
            sources: vec![TravelSource {
                title: "guide".into(),
                url: "https://example.com/guide".into(),
                snippet: "".into(),
            }],
            researched_at: Some("2026-10-16T00:00:00Z".into()),
            status: "live".into(),
            warning: None,
        };
        save_cache(&path, &report).unwrap();
        save_cache(&path, &report).unwrap();
        assert_eq!(
            read_cache(&path, "2026-10-16", &destination)
                .unwrap()
                .status,
            "cached"
        );
        assert!(read_cache(&path, "2026-10-17", &destination).is_none());
        fs::remove_dir_all(root).unwrap();
    }
    #[tokio::test]
    #[ignore = "访问真实联网搜索"]
    async fn live_search_finds_related_travel_sources() {
        let destination = CATALOG.iter().find(|d| d.name == "杭州").unwrap();
        let result = search("杭州旅游攻略", destination).await.unwrap();
        assert!(!result.is_empty());
    }
}
