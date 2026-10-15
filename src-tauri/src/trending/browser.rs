//! 雪球和小红书使用平台原生网页请求，不再要求手动复制 Cookie。
use std::time::Duration;

use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::Deserialize;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use super::{HotItem, Source};

const HOOK: &str = include_str!("browser_feed.js");
static XUEQIU_LOCK: Lazy<tokio::sync::Mutex<()>> = Lazy::new(|| tokio::sync::Mutex::new(()));
static XHS_LOCK: Lazy<tokio::sync::Mutex<()>> = Lazy::new(|| tokio::sync::Mutex::new(()));
static WINDOW_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

fn page(source: Source) -> Result<(&'static str, &'static str), String> {
    match source {
        Source::Xueqiu => Ok(("feed-xueqiu", "https://xueqiu.com/")),
        Source::Xiaohongshu => Ok(("feed-xiaohongshu", "https://www.xiaohongshu.com/explore")),
        _ => Err("该平台不使用网页会话".into()),
    }
}

fn window(app: &AppHandle, source: Source) -> Result<WebviewWindow, String> {
    let _creation = WINDOW_LOCK.lock();
    let (label, url) = page(source)?;
    if let Some(window) = app.get_webview_window(label) {
        return Ok(window);
    }
    let window = WebviewWindowBuilder::new(app, label, WebviewUrl::External(url.parse().unwrap()))
        .title(format!("{} · 登录与推荐", source.label()))
        .inner_size(1100.0, 800.0)
        .visible(false)
        .initialization_script(HOOK)
        .build()
        .map_err(|e| format!("打开{}失败：{e}", source.label()))?;
    let hidden = window.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = hidden.hide();
        }
    });
    Ok(window)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    id: String,
    page_url: String,
    items: Vec<HotItem>,
}

async fn snapshot(window: &WebviewWindow) -> Result<Snapshot, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let tx = Mutex::new(Some(tx));
    window
        .eval_with_callback(
            "window.__geFeed ? window.__geFeed.read() : null",
            move |result| {
                if let Some(tx) = tx.lock().take() {
                    let _ = tx.send(result);
                }
            },
        )
        .map_err(|e| e.to_string())?;
    let result = tokio::time::timeout(Duration::from_secs(2), rx)
        .await
        .map_err(|_| "网页读取超时".to_string())?
        .map_err(|e| e.to_string())?;
    serde_json::from_str(&result).map_err(|_| "网页正在加载".into())
}

fn is_feed(source: Source, raw: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(raw) else {
        return false;
    };
    if url.scheme() != "https" {
        return false;
    }
    match source {
        Source::Xueqiu => is_xueqiu_host(url.host_str()) && url.path() == "/",
        Source::Xiaohongshu => {
            url.host_str() == Some("www.xiaohongshu.com")
                && url.path().trim_end_matches('/') == "/explore"
        }
        _ => false,
    }
}

fn valid_item(source: Source, item: &HotItem) -> bool {
    let Ok(url) = reqwest::Url::parse(&item.url) else {
        return false;
    };
    if item.title.trim().is_empty() || url.scheme() != "https" {
        return false;
    }
    let segments: Vec<_> = url.path().trim_matches('/').split('/').collect();
    match source {
        Source::Xueqiu => {
            is_xueqiu_host(url.host_str())
                && segments.len() == 2
                && segments
                    .iter()
                    .all(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()))
        }
        Source::Xiaohongshu => {
            url.host_str() == Some("www.xiaohongshu.com")
                && segments.len() == 2
                && segments[0] == "explore"
                && !segments[1].is_empty()
        }
        _ => false,
    }
}

fn is_xueqiu_host(host: Option<&str>) -> bool {
    matches!(host, Some("xueqiu.com" | "www.xueqiu.com"))
}

pub async fn fetch(app: AppHandle, source: Source) -> Result<Vec<HotItem>, String> {
    let lock = match source {
        Source::Xueqiu => &*XUEQIU_LOCK,
        Source::Xiaohongshu => &*XHS_LOCK,
        _ => return Err("该平台不使用网页会话".into()),
    };
    let _guard = lock.lock().await;
    let (label, url) = page(source)?;
    let existing = app.get_webview_window(label);
    let mut expected_query = None;
    let old_id = if let Some(ref window) = existing {
        let previous = snapshot(window).await.ok();
        // 有内容时刷新网页；登录和验证尚未完成时只读取，避免打断用户操作。
        if !window.is_visible().unwrap_or(false)
            || previous
                .as_ref()
                .is_some_and(|s| is_feed(source, &s.page_url) && !s.items.is_empty())
        {
            let old = previous.map(|s| s.id);
            let nonce = uuid::Uuid::new_v4().to_string();
            let target = format!("{url}?_ge_feed={nonce}");
            if old.is_none() {
                expected_query = Some(nonce);
            }
            window
                .navigate(target.parse().unwrap())
                .map_err(|e| e.to_string())?;
            old
        } else {
            None
        }
    } else {
        None
    };
    let window = window(&app, source)?;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(22);
    loop {
        if let Ok(snapshot) = snapshot(&window).await {
            let fresh_page = expected_query
                .as_ref()
                .map(|nonce| {
                    reqwest::Url::parse(&snapshot.page_url)
                        .ok()
                        .is_some_and(|url| {
                            url.query_pairs()
                                .any(|(key, value)| key == "_ge_feed" && value == nonce.as_str())
                        })
                })
                .unwrap_or(true);
            if fresh_page
                && old_id.as_ref() != Some(&snapshot.id)
                && is_feed(source, &snapshot.page_url)
            {
                let items: Vec<_> = snapshot
                    .items
                    .into_iter()
                    .filter(|i| valid_item(source, i))
                    .take(30)
                    .collect();
                if !items.is_empty() {
                    return Ok(items);
                }
            }
        }
        if tokio::time::Instant::now() >= deadline {
            break;
        }
        tokio::time::sleep(Duration::from_millis(600)).await;
    }
    Err(format!(
        "暂未读取到{}推荐内容。请点「打开{}」完成登录或页面验证，回到推荐首页后刷新。",
        source.label(),
        source.label()
    ))
}

pub async fn show(app: AppHandle, source: Source) -> Result<(), String> {
    let window = window(&app, source)?;
    if !window
        .url()
        .map(|url| is_feed(source, url.as_str()))
        .unwrap_or(false)
    {
        window
            .navigate(page(source)?.1.parse().unwrap())
            .map_err(|e| e.to_string())?;
    }
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_platform_feed_pages_and_post_links() {
        assert!(is_feed(Source::Xueqiu, "https://www.xueqiu.com/"));
        assert!(is_feed(Source::Xueqiu, "https://www.xueqiu.com/#/?t=1792059222352"));
        assert!(!is_feed(Source::Xueqiu, "https://www.xueqiu.com.evil.com/"));
        assert!(is_feed(
            Source::Xiaohongshu,
            "https://www.xiaohongshu.com/explore?channel_id=homefeed_recommend"
        ));
        assert!(!is_feed(
            Source::Xiaohongshu,
            "https://www.xiaohongshu.com/explore/abc"
        ));
        assert!(!is_feed(Source::Xueqiu, "https://xueqiu.com.evil.com/"));
        assert!(!is_feed(Source::Xueqiu, "https://xueqiu.com/123/456"));
        let item = HotItem {
            title: "帖子".into(),
            url: "https://xueqiu.com/123/456".into(),
            ..Default::default()
        };
        assert!(valid_item(Source::Xueqiu, &item));
        assert!(valid_item(Source::Xueqiu, &HotItem {
            url: "https://www.xueqiu.com/123/456".into(), ..item.clone()
        }));
        assert!(!valid_item(Source::Xiaohongshu, &item));
        assert!(!valid_item(
            Source::Xueqiu,
            &HotItem {
                url: "https://xueqiu.com/123".into(),
                ..item
            }
        ));
    }
}
