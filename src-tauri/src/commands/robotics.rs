//! Robotics feeds are retrieved in Rust so the desktop UI needs no CORS proxy.
use crate::AppState;
use chrono::{DateTime, Utc};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashSet},
    fs,
    path::Path,
    time::Duration,
};
use tauri::State;
#[path = "robotics_sources.rs"]
mod source_reader;

static LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static COLLECTION_LOCK: parking_lot::Mutex<()> = parking_lot::Mutex::new(());
static CONFIG_LOCK: parking_lot::Mutex<()> = parking_lot::Mutex::new(());
static CLIENT: Lazy<reqwest::Client> = Lazy::new(|| {
    reqwest::Client::builder()
        .user_agent("GoldEarth/0.1 robotics research reader")
        .connect_timeout(Duration::from_secs(4))
        .timeout(Duration::from_secs(12))
        .build()
        .expect("robotics HTTP client")
});

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub title: String,
    pub url: String,
    pub summary: String,
    pub category: String,
    pub source: String,
    #[serde(default)]
    pub source_kind: String,
    pub kind: String,
    pub published_at: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceStatus {
    pub id: String,
    pub name: String,
    pub category: String,
    #[serde(default)]
    pub kind: String,
    pub url: String,
    pub checked_at: String,
    pub fetched_at: Option<String>,
    pub error: Option<String>,
    pub items: Vec<Item>,
}
#[derive(Clone, Default, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub sources: Vec<SourceStatus>,
    pub warning: Option<String>,
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Collection {
    pub saved: BTreeMap<String, Item>,
    pub read: HashSet<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Source {
    pub id: String,
    pub name: String,
    pub category: String,
    pub url: String,
    pub kind: String,
}

fn sources() -> Vec<Source> {
    source_reader::defaults()
}

#[derive(Default, Serialize, Deserialize)]
struct SourceConfig {
    #[serde(default)]
    custom: Vec<Source>,
    #[serde(default)]
    disabled: HashSet<String>,
}
#[derive(Serialize)]
pub struct SourceSettings {
    sources: Vec<Source>,
    disabled: HashSet<String>,
}
fn config(path: &Path) -> Result<SourceConfig, String> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|e| format!("来源配置无法读取，已保留原文件：{e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(SourceConfig::default()),
        Err(e) => Err(e.to_string()),
    }
}
fn validate_source(mut source: Source) -> Result<Source, String> {
    if ![
        "humanoid",
        "wheeled",
        "arm",
        "cobot",
        "joint",
        "sensor",
        "algorithm",
        "system",
    ]
    .contains(&source.category.as_str())
    {
        return Err("请选择有效的机器人分类".into());
    }
    source.name = source.name.trim().chars().take(120).collect();
    if source.name.is_empty() {
        return Err("请填写来源名称".into());
    }
    if source.url.len() > 2048 || !valid_url(&source.url) {
        return Err("请填写有效的 HTTPS 地址".into());
    }
    let mut url = reqwest::Url::parse(source.url.trim()).map_err(|_| "来源 URL 无效")?;
    if url.scheme() != "https" {
        return Err("请使用 HTTPS 官网或 GitHub 地址".into());
    }
    url.set_fragment(None);
    let host = url.host_str().ok_or("来源地址缺少域名")?;
    if host == "localhost" || host.ends_with(".local") || host.parse::<std::net::IpAddr>().is_ok() {
        return Err("请使用公开网站的域名".into());
    }
    match source.kind.as_str() {
        "github" => {
            let path: Vec<_> = url
                .path_segments()
                .ok_or("仓库地址无效")?
                .filter(|s| !s.is_empty())
                .collect();
            if host != "github.com"
                || path.len() != 2
                || path.iter().any(|p| {
                    !p.chars()
                        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
                })
            {
                return Err(
                    "GitHub 来源请填写 https://github.com/组织/仓库，不要填写用户首页或子目录"
                        .into(),
                );
            }
            source.url = format!(
                "https://github.com/{}/{}",
                path[0],
                path[1].trim_end_matches(".git")
            );
        }
        "website" => source.url = url.into(),
        _ => return Err("来源类型应为 GitHub 仓库或公司官网".into()),
    }
    Ok(source)
}
fn update_sources(
    path: &Path,
    action: &str,
    source: Option<Source>,
    id: Option<String>,
) -> Result<SourceSettings, String> {
    let mut cfg = config(path)?;
    match action {
        "list" => {}
        "add" => {
            if cfg.custom.len() >= 50 {
                return Err("最多可添加 50 个自定义来源".into());
            }
            let mut source = validate_source(source.ok_or("缺少来源信息")?)?;
            if sources()
                .iter()
                .chain(cfg.custom.iter())
                .any(|s| s.url == source.url && s.category == source.category)
            {
                return Err("该地址已在此分类中订阅".into());
            }
            source.id = format!("custom:{}", uuid::Uuid::new_v4());
            cfg.custom.push(source);
        }
        "toggle" => {
            let id = id.ok_or("缺少来源 ID")?;
            if !sources()
                .iter()
                .chain(cfg.custom.iter())
                .any(|s| s.id == id)
            {
                return Err("来源不存在".into());
            }
            if !cfg.disabled.remove(&id) {
                cfg.disabled.insert(id);
            }
        }
        "remove" => {
            let id = id.ok_or("缺少来源 ID")?;
            if !cfg.custom.iter().any(|s| s.id == id) {
                return Err("预置来源可停用，自定义来源可移除".into());
            }
            cfg.custom.retain(|s| s.id != id);
            cfg.disabled.remove(&id);
        }
        _ => return Err("未知来源操作".into()),
    }
    if action != "list" {
        write_json(path, &cfg)?;
    }
    let mut all = sources();
    all.extend(cfg.custom);
    Ok(SourceSettings {
        sources: all,
        disabled: cfg.disabled,
    })
}
#[tauri::command]
pub fn robot_sources(
    state: State<'_, AppState>,
    action: Option<String>,
    source: Option<Source>,
    id: Option<String>,
) -> Result<SourceSettings, String> {
    let _guard = CONFIG_LOCK.lock();
    update_sources(
        &state.storage.root().join("data/robotics/sources.json"),
        action.as_deref().unwrap_or("list"),
        source,
        id,
    )
}

fn plain(raw: &str, limit: usize) -> String {
    // Feed text is always displayed as text, never inserted into the UI as HTML.
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
fn valid_url(raw: &str) -> bool {
    reqwest::Url::parse(raw).is_ok_and(|u| {
        matches!(u.scheme(), "http" | "https")
            && u.host_str().is_some()
            && u.username().is_empty()
            && u.password().is_none()
    })
}
fn date(raw: &str) -> Option<String> {
    DateTime::parse_from_rfc2822(raw)
        .or_else(|_| DateTime::parse_from_rfc3339(raw))
        .ok()
        .map(|d| d.with_timezone(&Utc).to_rfc3339())
}

fn parse(raw: &str, source: &Source) -> Result<Vec<Item>, String> {
    #[derive(Default, Deserialize)]
    struct Rss {
        channel: Channel,
    }
    #[derive(Default, Deserialize)]
    struct Channel {
        #[serde(default)]
        item: Vec<RssItem>,
    }
    #[derive(Default, Deserialize)]
    struct RssItem {
        #[serde(default)]
        title: String,
        #[serde(default)]
        link: String,
        #[serde(default)]
        description: String,
        #[serde(default, rename = "pubDate")]
        published: String,
    }
    #[derive(Default, Deserialize)]
    struct Atom {
        #[serde(default)]
        entry: Vec<Entry>,
    }
    #[derive(Default, Deserialize)]
    struct Entry {
        #[serde(default)]
        title: String,
        #[serde(default)]
        link: Vec<Link>,
        #[serde(default)]
        content: String,
        #[serde(default)]
        updated: String,
        #[serde(default)]
        published: String,
    }
    #[derive(Default, Deserialize)]
    struct Link {
        #[serde(rename = "@href")]
        href: String,
        #[serde(default, rename = "@rel")]
        rel: String,
    }
    let entries: Vec<(String, String, String, String)> = if source.kind == "release" {
        let feed: Atom = quick_xml::de::from_str(raw).map_err(|e| format!("Atom 格式异常：{e}"))?;
        feed.entry
            .into_iter()
            .filter_map(|e| {
                let link = e
                    .link
                    .into_iter()
                    .find(|l| l.rel.is_empty() || l.rel == "alternate")?;
                Some((
                    e.title,
                    link.href,
                    e.content,
                    if e.published.is_empty() {
                        e.updated
                    } else {
                        e.published
                    },
                ))
            })
            .collect()
    } else {
        let feed: Rss = quick_xml::de::from_str(raw).map_err(|e| format!("RSS 格式异常：{e}"))?;
        feed.channel
            .item
            .into_iter()
            .map(|i| (i.title, i.link, i.description, i.published))
            .collect()
    };
    let mut seen = HashSet::new();
    let items: Vec<Item> = entries
        .into_iter()
        .filter_map(|(title, url, summary, published)| {
            let title = plain(&title, 240);
            let url = url.trim().to_string();
            if title.is_empty() || !valid_url(&url) || !seen.insert(url.clone()) {
                return None;
            }
            Some(Item {
                title,
                url,
                summary: plain(&summary, 650),
                category: source.category.clone(),
                source: source.name.clone(),
                source_kind: if source.kind == "release" {
                    "github".into()
                } else {
                    source.kind.clone()
                },
                kind: source.kind.clone(),
                published_at: date(&published),
            })
        })
        .take(30)
        .collect();
    if items.is_empty() {
        return Err("来源未返回有效条目，可能暂无更新或暂时无法访问".into());
    }
    Ok(items)
}

async fn fetch(source: &Source) -> Result<Vec<Item>, String> {
    if source.kind == "github" {
        return source_reader::github(source).await;
    }
    if source.kind == "website" {
        return source_reader::website_fetch(source).await;
    }
    let mut response = CLIENT
        .get(&source.url)
        .send()
        .await
        .map_err(|e| format!("连接失败：{e}"))?
        .error_for_status()
        .map_err(|e| format!("请求失败：{e}"))?;
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if body.len() + chunk.len() > 3 * 1024 * 1024 {
            return Err("来源内容超出大小限制".into());
        }
        body.extend_from_slice(&chunk);
    }
    parse(&String::from_utf8_lossy(&body), source)
}

fn write_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    fs::create_dir_all(path.parent().ok_or("无效存储路径")?).map_err(|e| e.to_string())?;
    let temp = path.with_extension("tmp");
    fs::write(
        &temp,
        serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    fs::rename(temp, path).map_err(|e| format!("保存失败：{e}"))
}

async fn report(path: &Path, force: bool) -> Result<Report, String> {
    let _guard = LOCK.lock().await;
    let mut previous: Report = fs::read(path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default();
    let now = Utc::now();
    let mut jobs = tokio::task::JoinSet::new();
    let cfg = {
        let _guard = CONFIG_LOCK.lock();
        config(&path.with_file_name("sources.json"))?
    };
    let mut active = sources();
    active.extend(cfg.custom);
    for source in active.into_iter().filter(|s| !cfg.disabled.contains(&s.id)) {
        let old = previous
            .sources
            .iter()
            .find(|s| {
                s.id == source.id
                    && s.name == source.name
                    && s.url == source.url
                    && s.category == source.category
                    && s.kind == source.kind
            })
            .cloned();
        // Failures retry after a minute. Successful results are fresh for 30 minutes.
        let fresh = old.as_ref().is_some_and(|s| {
            DateTime::parse_from_rfc3339(&s.checked_at).is_ok_and(|d| {
                let age = (now - d.with_timezone(&Utc)).num_seconds();
                age >= 0 && age < if s.error.is_some() { 60 } else { 1800 }
            })
        });
        jobs.spawn(async move {
            if fresh && !force {
                return old.unwrap();
            }
            let checked_at = Utc::now().to_rfc3339();
            let result = fetch(&source).await;
            let (items, fetched_at, error) = match result {
                Ok(items) => (items, Some(checked_at.clone()), None),
                Err(error) => (
                    old.as_ref().map(|s| s.items.clone()).unwrap_or_default(),
                    old.and_then(|s| s.fetched_at),
                    Some(error),
                ),
            };
            SourceStatus {
                id: source.id,
                name: source.name,
                category: source.category,
                kind: source.kind,
                url: source.url,
                checked_at,
                fetched_at,
                error,
                items,
            }
        });
    }
    let mut statuses = Vec::new();
    while let Some(result) = jobs.join_next().await {
        statuses.push(result.map_err(|e| e.to_string())?);
    }
    statuses.sort_by(|a, b| a.id.cmp(&b.id));
    previous = Report {
        sources: statuses,
        warning: None,
    };
    if let Err(error) = write_json(path, &previous) {
        previous.warning = Some(format!("结果已获取，但缓存未保存：{error}"));
    }
    Ok(previous)
}

#[tauri::command]
pub async fn robot_feed(state: State<'_, AppState>, force: Option<bool>) -> Result<Report, String> {
    report(
        &state.storage.root().join("data/robotics/feed.json"),
        force.unwrap_or(false),
    )
    .await
}

#[tauri::command]
pub fn robot_collection(
    state: State<'_, AppState>,
    action: Option<String>,
    item: Option<Item>,
    url: Option<String>,
) -> Result<Collection, String> {
    let _guard = COLLECTION_LOCK.lock();
    collection(
        &state.storage.root().join("data/robotics/collection.json"),
        action.as_deref().unwrap_or("list"),
        item,
        url,
    )
}

fn collection(
    path: &Path,
    action: &str,
    item: Option<Item>,
    url: Option<String>,
) -> Result<Collection, String> {
    let mut value: Collection = match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|e| format!("收藏文件无法读取，已保留原文件：{e}"))?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Collection::default(),
        Err(e) => return Err(e.to_string()),
    };
    match action {
        "list" => return Ok(value),
        "save" => {
            let item = item.ok_or("缺少条目")?;
            if !valid_url(&item.url) {
                return Err("链接无效".into());
            }
            value.saved.insert(item.url.clone(), item);
        }
        "remove" => {
            value.saved.remove(&url.ok_or("缺少链接")?);
        }
        "read" => {
            let url = url.ok_or("缺少链接")?;
            if !valid_url(&url) {
                return Err("链接无效".into());
            }
            value.read.insert(url);
        }
        _ => return Err("未知操作".into()),
    }
    write_json(path, &value)?;
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn custom_sources_are_normalized_persisted_and_removable() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join(format!("robotics-sources-{}", uuid::Uuid::new_v4()));
        let path = dir.join("sources.json");
        let source = Source {
            id: "ignored".into(),
            name: "我的 SDK".into(),
            category: "arm".into(),
            url: "https://github.com/example/robot.git/".into(),
            kind: "github".into(),
        };
        let settings = update_sources(&path, "add", Some(source.clone()), None).unwrap();
        let custom = settings.sources.last().unwrap();
        assert_eq!(custom.url, "https://github.com/example/robot");
        let id = custom.id.clone();
        assert!(update_sources(&path, "add", Some(source), None).is_err());
        let disabled = update_sources(&path, "toggle", None, Some(id.clone())).unwrap();
        assert!(disabled.disabled.contains(&id));
        assert!(update_sources(&path, "list", None, None)
            .unwrap()
            .disabled
            .contains(&id));
        let removed = update_sources(&path, "remove", None, Some(id.clone())).unwrap();
        assert!(!removed.sources.iter().any(|s| s.id == id));
        fs::write(&path, "broken").unwrap();
        assert!(update_sources(&path, "toggle", None, Some("unitree-docs".into())).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "broken");
        fs::remove_file(path).unwrap();
        fs::remove_dir(dir).unwrap();
    }
    #[test]
    fn invalid_sources_do_not_become_fetch_targets() {
        let source = Source {
            id: String::new(),
            name: "SDK".into(),
            category: "sensor".into(),
            url: "https://github.com/org/repo/tree/main".into(),
            kind: "github".into(),
        };
        assert!(validate_source(source.clone()).is_err());
        for url in [
            "javascript:alert(1)",
            "file:///etc/passwd",
            "https://localhost/docs",
            "https://127.0.0.1/docs",
            "https://user:secret@example.com/docs",
        ] {
            assert!(validate_source(Source {
                kind: "website".into(),
                url: url.into(),
                ..source.clone()
            })
            .is_err());
        }
    }
    #[tokio::test]
    async fn disabling_sources_removes_old_feed_items_without_touching_collection() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join(format!("robotics-disabled-{}", uuid::Uuid::new_v4()));
        let cfg = SourceConfig {
            custom: Vec::new(),
            disabled: sources().iter().map(|s| s.id.clone()).collect(),
        };
        write_json(&dir.join("sources.json"), &cfg).unwrap();
        let report = report(&dir.join("feed.json"), false).await.unwrap();
        assert!(report.sources.is_empty());
        fs::remove_file(dir.join("feed.json")).unwrap();
        fs::remove_file(dir.join("sources.json")).unwrap();
        fs::remove_dir(dir).unwrap();
    }
    #[test]
    fn rss_sanitizes_deduplicates_and_keeps_missing_dates_unknown() {
        let raw = r#"<rss><channel><item><title>机器人发布</title><link>https://example.com/a</link><description>&lt;b&gt;参数&lt;/b&gt;</description><pubDate>Tue, 20 Oct 2026 10:00:00 GMT</pubDate></item><item><title>duplicate</title><link>https://example.com/a</link></item><item><title>bad</title><link>javascript:alert(1)</link></item><item><title>unknown date</title><link>https://example.com/b</link></item></channel></rss>"#;
        let items = parse(raw, &sources()[0]).unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].summary, "参数");
        assert!(items[0]
            .published_at
            .as_ref()
            .unwrap()
            .starts_with("2026-10-20"));
        assert!(items[1].published_at.is_none());
        assert!(parse("<html>captcha</html>", &sources()[0]).is_err());
    }
    #[test]
    fn atom_uses_alternate_link_and_release_date() {
        let raw = r#"<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>v1.0</title><link rel="self" href="https://example.com/self"/><link rel="alternate" href="https://example.com/release"/><updated>2026-10-20T10:00:00Z</updated><content type="html">&lt;p&gt;Fixes&lt;/p&gt;</content></entry></feed>"#;
        let source = Source {
            kind: "release".into(),
            ..sources().into_iter().find(|s| s.kind == "github").unwrap()
        };
        let items = parse(raw, &source).unwrap();
        assert_eq!(items[0].url, "https://example.com/release");
        assert_eq!(items[0].summary, "Fixes");
        assert_eq!(items[0].kind, "release");
    }
    #[test]
    fn collection_survives_restart_and_corruption_is_not_overwritten() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join(format!("robotics-test-{}", uuid::Uuid::new_v4()));
        let path = dir.join("collection.json");
        let item = Item {
            title: "机器人".into(),
            url: "https://example.com/a".into(),
            summary: "参数".into(),
            category: "arm".into(),
            source: "test".into(),
            source_kind: "website".into(),
            kind: "news".into(),
            published_at: None,
        };
        collection(&path, "save", Some(item.clone()), None).unwrap();
        collection(&path, "read", None, Some(item.url.clone())).unwrap();
        let loaded = collection(&path, "list", None, None).unwrap();
        assert_eq!(loaded.saved.len(), 1);
        assert!(loaded.read.contains(&item.url));
        collection(&path, "remove", None, Some(item.url)).unwrap();
        assert!(collection(&path, "list", None, None)
            .unwrap()
            .saved
            .is_empty());
        fs::write(&path, "broken").unwrap();
        assert!(collection(&path, "read", None, Some("https://example.com".into())).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "broken");
        fs::remove_file(path).unwrap();
        fs::remove_dir(dir).unwrap();
    }
    #[tokio::test]
    #[ignore = "requires public feed network access"]
    async fn live_feeds() {
        let mut jobs = tokio::task::JoinSet::new();
        for source in sources() {
            jobs.spawn(async move {
                let result = fetch(&source).await;
                (source.name, result)
            });
        }
        let mut failures = Vec::new();
        while let Some(result) = jobs.join_next().await {
            let (name, result) = result.unwrap();
            println!(
                "{name}: {:?}",
                result.as_ref().map(|items| (
                    items.len(),
                    items
                        .iter()
                        .take(2)
                        .map(|i| format!("[{}] {}", i.kind, i.title))
                        .collect::<Vec<_>>()
                ))
            );
            if let Err(error) = result {
                failures.push(format!("{name}: {error}"));
            }
        }
        assert!(failures.is_empty(), "{}", failures.join("\n"));
    }
}
