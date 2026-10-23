//! Public NBA news and Hupu section listings. Fetch only followed sections.
use crate::AppState;
use chrono::Utc;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet, HashSet},
    fs,
    path::Path,
    sync::Arc,
    time::Duration,
};
use tauri::State;

#[derive(Clone, Deserialize)]
struct Team {
    id: String,
    name: String,
    english: String,
    espn: u64,
    forum: String,
}
static TEAMS: Lazy<Vec<Team>> = Lazy::new(|| {
    serde_json::from_str(include_str!("../../../app/src/lib/nba-teams.json"))
        .expect("NBA team catalog")
});
static LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static CLIENT: Lazy<reqwest::Client> = Lazy::new(|| {
    reqwest::Client::builder()
        .user_agent(crate::trending::http::UA)
        .connect_timeout(Duration::from_secs(4))
        .timeout(Duration::from_secs(12))
        .build()
        .expect("NBA feed client")
});

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedItem {
    pub title: String,
    pub url: String,
    pub summary: String,
    pub teams: Vec<String>,
    pub kind: String,
    pub source: String,
    pub published_at: Option<String>,
    pub time_label: String,
    pub author: String,
    pub replies: Option<u64>,
    pub views: Option<u64>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedSource {
    pub id: String,
    pub name: String,
    pub url: String,
    pub kind: String,
    pub team: Option<String>,
    pub checked_at: String,
    pub fetched_at: Option<String>,
    pub error: Option<String>,
    pub items: Vec<FeedItem>,
}
#[derive(Default, Serialize, Deserialize)]
pub struct FeedReport {
    pub sources: Vec<FeedSource>,
    pub warning: Option<String>,
}

fn plain(raw: &str, limit: usize) -> String {
    let doc = dom_query::Document::from(raw);
    doc.select("script, style").remove();
    doc.text()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(limit)
        .collect()
}
fn url(raw: &str, host: &str) -> Option<String> {
    let mut url = reqwest::Url::parse(raw).ok()?;
    let actual = url.host_str()?;
    if !matches!(url.scheme(), "http" | "https")
        || !(actual == host || actual.ends_with(&format!(".{host}")))
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return None;
    }
    url.set_fragment(None);
    Some(url.into())
}
fn post_url(raw: &str) -> Option<String> {
    let base = reqwest::Url::parse("https://bbs.hupu.com/").unwrap();
    let value = base.join(raw).ok()?;
    let path = value.path().strip_prefix('/')?.strip_suffix(".html")?;
    if path.is_empty() || !path.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    url(value.as_str(), "hupu.com")
}
fn title_teams(title: &str) -> Vec<String> {
    let text = title.to_lowercase();
    TEAMS
        .iter()
        .filter(|t| text.contains(&t.name) || text.contains(&t.english.to_lowercase()))
        .map(|t| t.id.clone())
        .collect()
}
fn timestamp(raw: Option<&str>) -> Option<String> {
    chrono::DateTime::parse_from_rfc3339(raw?)
        .ok()
        .map(|d| d.with_timezone(&Utc).to_rfc3339())
}
fn parse_espn(raw: &str) -> Result<Vec<FeedItem>, String> {
    let data: Value = serde_json::from_str(raw).map_err(|e| format!("ESPN 新闻格式异常：{e}"))?;
    let rows = data["articles"].as_array().ok_or("ESPN 未返回新闻列表")?;
    let mut seen = HashSet::new();
    Ok(rows
        .iter()
        .filter_map(|row| {
            let title = plain(row["headline"].as_str()?, 300);
            let url = url(row["links"]["web"]["href"].as_str()?, "espn.com")?;
            if title.is_empty() || !seen.insert(url.clone()) {
                return None;
            }
            let ids: HashSet<u64> = row["categories"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|c| c["type"] == "team")
                .filter_map(|c| c["teamId"].as_u64().or_else(|| c["team"]["id"].as_u64()))
                .collect();
            let teams = TEAMS
                .iter()
                .filter(|t| ids.contains(&t.espn))
                .map(|t| t.id.clone())
                .collect();
            Some(FeedItem {
                title,
                url,
                summary: plain(row["description"].as_str().unwrap_or(""), 650),
                teams,
                kind: "news".into(),
                source: "ESPN".into(),
                published_at: timestamp(row["published"].as_str()),
                time_label: String::new(),
                author: String::new(),
                replies: None,
                views: None,
            })
        })
        .take(100)
        .collect())
}
fn parse_hupu_news(raw: &str) -> Result<Vec<FeedItem>, String> {
    let doc = checked_document(raw)?;
    let json = doc.select_single("script#__NEXT_DATA__").text();
    let data: Value =
        serde_json::from_str(&json).map_err(|_| "虎扑新闻页面结构变化，未找到可读取的新闻数据")?;
    let rows = data["props"]["pageProps"]["data"]
        .as_array()
        .ok_or("虎扑新闻未返回列表")?;
    let mut seen = HashSet::new();
    Ok(rows
        .iter()
        .filter_map(|row| {
            let title = plain(row["title"].as_str()?, 300);
            let url = post_url(row["url"].as_str()?)?;
            if title.is_empty() || !seen.insert(url.clone()) {
                return None;
            }
            Some(FeedItem {
                teams: title_teams(&title),
                title,
                url,
                summary: String::new(),
                kind: "news".into(),
                source: "虎扑篮球资讯".into(),
                published_at: None,
                time_label: plain(row["time"].as_str().unwrap_or(""), 80),
                author: plain(row["origin"].as_str().unwrap_or(""), 80),
                replies: row["replies"].as_u64(),
                views: None,
            })
        })
        .take(80)
        .collect())
}
fn checked_document(raw: &str) -> Result<dom_query::Document, String> {
    let doc = dom_query::Document::from(raw);
    let title = doc.select_single("title").text().to_string();
    if [
        "安全验证",
        "验证码",
        "访问验证",
        "Access Denied",
        "Just a moment",
    ]
    .iter()
    .any(|s| title.contains(s))
    {
        return Err("虎扑要求验证，请打开原专区查看或稍后重试".into());
    }
    Ok(doc)
}
fn parse_posts(raw: &str, team: &Team) -> Result<Vec<FeedItem>, String> {
    let doc = checked_document(raw)?;
    let title = doc.select_single("title").text().to_string();
    if !title.contains(&format!("{}专区", team.name)) {
        return Err("虎扑未返回所选球队专区，未将其他页面当作帖子列表".into());
    }
    if doc.select(".bbs-sl-web-post").is_empty() {
        return Err("虎扑帖子列表无法读取，可能需要登录、验证或页面结构变化".into());
    }
    let mut seen = HashSet::new();
    Ok(doc
        .select(".bbs-sl-web-post-body")
        .iter()
        .filter_map(|row| {
            let link = row.select_single(".post-title a.p-title");
            let title = plain(&link.text(), 300);
            let url = post_url(&link.attr("href")?)?;
            if title.is_empty() || !seen.insert(url.clone()) {
                return None;
            }
            let datum = row.select_single(".post-datum").text().to_string();
            let mut counts = datum.split('/').map(|n| n.trim().parse::<u64>().ok());
            Some(FeedItem {
                title,
                url,
                summary: String::new(),
                teams: vec![team.id.clone()],
                kind: "post".into(),
                source: format!("虎扑 · {}专区", team.name),
                published_at: None,
                time_label: plain(&row.select_single(".post-time").text(), 80),
                author: plain(&row.select_single(".post-auth").text(), 120),
                replies: counts.next().flatten(),
                views: counts.next().flatten(),
            })
        })
        .take(50)
        .collect())
}
async fn fetch_text(url: &str) -> Result<String, String> {
    let mut response = CLIENT
        .get(url)
        .send()
        .await
        .map_err(|e| format!("来源连接失败：{e}"))?
        .error_for_status()
        .map_err(|e| format!("来源请求失败：{e}"))?;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if bytes.len() + chunk.len() > 4 * 1024 * 1024 {
            return Err("来源页面超出 4 MB 限制".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}
fn specs(team_ids: &[String]) -> Result<Vec<FeedSource>, String> {
    let ids: BTreeSet<_> = team_ids.iter().collect();
    if ids.len() > 30 || ids.iter().any(|id| !TEAMS.iter().any(|t| &t.id == *id)) {
        return Err("请选择有效的 NBA 球队".into());
    }
    let empty =
        |id: String, name: String, url: String, kind: &str, team: Option<String>| FeedSource {
            id,
            name,
            url,
            kind: kind.into(),
            team,
            checked_at: String::new(),
            fetched_at: None,
            error: None,
            items: Vec::new(),
        };
    let mut sources = vec![
        empty(
            "espn-news".into(),
            "ESPN · NBA 新闻".into(),
            "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/news?limit=100".into(),
            "news",
            None,
        ),
        empty(
            "hupu-news".into(),
            "虎扑 · 篮球资讯".into(),
            "https://voice.hupu.com/nba".into(),
            "news",
            None,
        ),
    ];
    for team in TEAMS.iter().filter(|t| ids.contains(&t.id)) {
        sources.push(empty(
            format!("hupu-{}", team.id),
            format!("虎扑 · {}专区", team.name),
            format!("https://bbs.hupu.com/{}", team.forum),
            "post",
            Some(team.id.clone()),
        ));
    }
    Ok(sources)
}
fn fresh(source: &FeedSource) -> bool {
    chrono::DateTime::parse_from_rfc3339(&source.checked_at).is_ok_and(|time| {
        let age = (Utc::now() - time.with_timezone(&Utc)).num_seconds();
        age >= 0 && age < if source.error.is_some() { 60 } else { 600 }
    })
}
async fn refresh_source(
    mut source: FeedSource,
    old: Option<FeedSource>,
    force: bool,
) -> FeedSource {
    if !force {
        if let Some(old) = old.as_ref().filter(|s| fresh(s)) {
            return old.clone();
        }
    }
    let result = match fetch_text(&source.url).await {
        Ok(raw) => {
            if source.id == "espn-news" {
                parse_espn(&raw)
            } else if source.id == "hupu-news" {
                parse_hupu_news(&raw)
            } else {
                parse_posts(
                    &raw,
                    TEAMS
                        .iter()
                        .find(|t| Some(&t.id) == source.team.as_ref())
                        .unwrap(),
                )
            }
        }
        Err(error) => Err(error),
    };
    source.checked_at = Utc::now().to_rfc3339();
    match result {
        Ok(items) => {
            source.items = items;
            source.fetched_at = Some(source.checked_at.clone());
        }
        Err(error) => {
            source.error = Some(error);
            if let Some(old) = old {
                source.items = old.items;
                source.fetched_at = old.fetched_at;
            }
        }
    }
    source
}
async fn report(path: &Path, team_ids: &[String], force: bool) -> Result<FeedReport, String> {
    let selected = specs(team_ids)?;
    let _guard = LOCK.lock().await;
    let mut cache: BTreeMap<String, FeedSource> = fs::read(path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default();
    let permits = Arc::new(tokio::sync::Semaphore::new(4));
    let mut jobs = tokio::task::JoinSet::new();
    for source in selected {
        let old = cache
            .get(&source.id)
            .filter(|s| s.url == source.url)
            .cloned();
        let permits = permits.clone();
        jobs.spawn(async move {
            let _permit = permits.acquire_owned().await.unwrap();
            refresh_source(source, old, force).await
        });
    }
    let mut sources = Vec::new();
    while let Some(result) = jobs.join_next().await {
        let source = result.map_err(|e| e.to_string())?;
        cache.insert(source.id.clone(), source.clone());
        sources.push(source);
    }
    sources.sort_by(|a, b| a.id.cmp(&b.id));
    let saved = (|| -> Result<(), String> {
        fs::create_dir_all(path.parent().ok_or("无效 NBA 缓存路径")?).map_err(|e| e.to_string())?;
        let temp = path.with_extension("tmp");
        fs::write(
            &temp,
            serde_json::to_vec_pretty(&cache).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        fs::rename(temp, path).map_err(|e| e.to_string())
    })();
    Ok(FeedReport {
        sources,
        warning: saved
            .err()
            .map(|e| format!("本次结果未能写入本地缓存：{e}")),
    })
}
#[tauri::command]
pub async fn nba_feed(
    state: State<'_, AppState>,
    team_ids: Vec<String>,
    force: Option<bool>,
) -> Result<FeedReport, String> {
    report(
        &state.storage.root().join("data/nba/feeds.json"),
        &team_ids,
        force.unwrap_or(false),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn refresh_failure_keeps_previous_items_and_success_timestamp() {
        let mut old = specs(&[]).unwrap().remove(0);
        old.fetched_at = Some("2026-10-22T00:00:00Z".into());
        old.items = parse_espn(r#"{"articles":[{"headline":"Saved report","links":{"web":{"href":"https://www.espn.com/nba/story/1"}}}]}"#).unwrap();
        let mut failing = old.clone();
        failing.url = "unsupported-scheme://offline".into();
        let result = refresh_source(failing, Some(old.clone()), true).await;
        assert!(result.error.is_some());
        assert_eq!(result.items[0].title, "Saved report");
        assert_eq!(result.fetched_at, old.fetched_at);
    }
    #[tokio::test]
    async fn disk_cache_reuses_fresh_sources_and_does_not_leak_unfollowed_sections() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join(format!("nba-feed-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("feeds.json");
        let mut cache = BTreeMap::new();
        for mut source in specs(&["LAL".into(), "BOS".into()]).unwrap() {
            source.checked_at = Utc::now().to_rfc3339();
            source.fetched_at = Some(source.checked_at.clone());
            cache.insert(source.id.clone(), source);
        }
        fs::write(&path, serde_json::to_vec(&cache).unwrap()).unwrap();
        let result = report(&path, &["LAL".into()], false).await.unwrap();
        assert_eq!(result.sources.len(), 3);
        assert!(result
            .sources
            .iter()
            .all(|s| s.team.as_deref() != Some("BOS")));
        let saved: BTreeMap<String, FeedSource> =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert!(saved.contains_key("hupu-BOS"));
        assert!(result.warning.is_none());
        fs::remove_file(path).unwrap();
        fs::remove_dir(dir).unwrap();
    }
    #[test]
    fn section_posts_are_classified_by_section_not_player_names() {
        let team = TEAMS.iter().find(|t| t.id == "LAL").unwrap();
        let raw = r#"<title>湖人专区 - 虎扑社区</title><div class="bbs-sl-web-post"><li class="bbs-sl-web-post-body"><div class="post-title"><a class="p-title" href="/12345.html">不含球队名称的球员讨论</a></div><div class="post-datum">12 / 345</div><div class="post-auth">作者</div><div class="post-time">10-23 10:00</div></li></div>"#;
        let items = parse_posts(raw, team).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].teams, vec!["LAL"]);
        assert_eq!(items[0].replies, Some(12));
        assert_eq!(items[0].views, Some(345));
        assert!(items[0].published_at.is_none());
        assert!(parse_posts(&raw.replace("湖人专区", "勇士专区"), team).is_err());
        assert!(parse_posts("<title>安全验证</title>", team).is_err());
    }
    #[test]
    fn espn_uses_team_id_not_category_id() {
        let raw = serde_json::json!({"articles":[{"headline":"Game report","links":{"web":{"href":"https://www.espn.com/nba/story/1"}},"published":"2026-10-23T02:00:00Z","categories":[{"type":"team","id":999,"teamId":13},{"type":"team","team":{"id":9}}]}]});
        let items = parse_espn(&raw.to_string()).unwrap();
        assert_eq!(items[0].teams, vec!["LAL", "GSW"]);
        assert!(parse_espn("{}").is_err());
        assert!(post_url("javascript:alert(1)").is_none());
        assert!(post_url("https://example.com/123.html").is_none());
    }
    #[test]
    fn subscriptions_validate_deduplicate_and_only_fetch_selected_sections() {
        assert_eq!(TEAMS.len(), 30);
        let sources = specs(&["LAL".into(), "LAL".into(), "BOS".into()]).unwrap();
        assert_eq!(sources.len(), 4);
        assert_eq!(specs(&[]).unwrap().len(), 2);
        assert!(specs(&["../../secret".into()]).is_err());
    }
    #[test]
    fn hupu_news_keeps_unknown_teams_unclassified_and_rejects_app_urls() {
        let raw = r#"<script id="__NEXT_DATA__">{"props":{"pageProps":{"data":[{"title":"湖人对阵勇士","url":"https://bbs.hupu.com/123.html","time":"2小时前"},{"title":"某球员采访","url":"https://bbs.hupu.com/456.html"},{"title":"广告","url":"huputiyu://123"}]}}}</script>"#;
        let items = parse_hupu_news(raw).unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].teams, vec!["LAL", "GSW"]);
        assert!(items[1].teams.is_empty());
    }
    #[tokio::test]
    #[ignore = "requires public NBA news and Hupu network access"]
    async fn live_news_and_sections() {
        let mut failures = Vec::new();
        for source in specs(&["LAL".into(), "GSW".into(), "BOS".into()]).unwrap() {
            let result = refresh_source(source, None, true).await;
            println!(
                "{}: {} items, {:?}",
                result.name,
                result.items.len(),
                result.error
            );
            if let Some(error) = result.error {
                failures.push(error);
            } else {
                assert!(!result.items.is_empty());
            }
        }
        assert!(failures.is_empty(), "{}", failures.join("\n"));
    }
}
