//! 网上冲浪：把 B 站、微博、雪球、小红书的热榜收进同一个页面。
//!
//! 设计要点：
//! - **抓取全在 Rust 侧**，绕开 WebView 的跨域限制，也不用把 Cookie 暴露给前端。
//! - **四个平台并发抓**，谁快谁先回；单个平台失败不影响其他平台，
//!   失败原因塞进 [`HotBoard::error`]，前端自己渲染降级态。
//! - **两层缓存**：短 TTL 内直接复用，避免手滑连点把接口打爆；
//!   超过新鲜期但还在兜底期内，刷新失败时退回旧数据并标注「缓存」，
//!   这样断网时页面不会突然空掉。

pub mod bilibili;
mod http;
pub mod types;
pub mod weibo;
pub mod xiaohongshu;
pub mod xueqiu;

use std::collections::HashMap;
use std::time::{Duration, Instant};

use once_cell::sync::Lazy;
use parking_lot::Mutex;

use crate::db::models::AppSettings;

pub use bilibili::Kind;
pub use types::{HotBoard, HotItem, Source};

/// 新鲜期：这段时间内重复刷新直接吃缓存
const TTL_FRESH: Duration = Duration::from_secs(90);
/// 兜底期：新鲜期过了但还在这个窗口内，抓取失败就退回它
const TTL_STALE: Duration = Duration::from_secs(30 * 60);
/// 兜底条目最多留多久，防止用户几天没开导致展示过期榜单
const TTL_KEEP: Duration = Duration::from_secs(6 * 3600);

type CacheKey = String;

static CACHE: Lazy<Mutex<HashMap<CacheKey, (Instant, HotBoard)>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

fn cache_key(source: Source, kind: Option<Kind>) -> CacheKey {
    // kind 只对 B 站有「热门 / 排行榜」两种口径。其余平台如果也跟着拼进去，
    // 用户在 B 站切口径时，微博的缓存键会跟着从 `weibo` 变成 `weibo:ranking`，
    // 白白多抓一轮。所以这里按平台过滤掉。
    match kind {
        Some(k) if source == Source::Bilibili => format!("{}:{}", source.id(), k_label(k)),
        _ => source.id().to_string(),
    }
}

fn k_label(k: Kind) -> &'static str {
    match k {
        Kind::Popular => "popular",
        Kind::Ranking => "ranking",
    }
}

/// 取一份新鲜缓存；没有就返回 None
fn cache_get(key: &str) -> Option<HotBoard> {
    let guard = CACHE.lock();
    let (at, board) = guard.get(key)?;
    if at.elapsed() > TTL_FRESH {
        return None;
    }
    Some(HotBoard {
        cached: true,
        ..board.clone()
    })
}

/// 取一份「还能用但已经过期」的缓存，用于抓取失败时兜底
fn cache_get_stale(key: &str) -> Option<HotBoard> {
    let guard = CACHE.lock();
    let (at, board) = guard.get(key)?;
    if at.elapsed() > TTL_STALE {
        return None;
    }
    Some(board.clone())
}

fn cache_put(key: &str, board: &HotBoard) {
    let mut guard = CACHE.lock();
    guard.retain(|_, (at, _)| at.elapsed() < TTL_KEEP);
    guard.insert(key.to_string(), (Instant::now(), board.clone()));
}

/// 单个平台出结果了才记缓存，失败的不记
fn finish(
    source: Source,
    key: &str,
    result: Result<Vec<HotItem>, String>,
    needs_cookie: bool,
) -> HotBoard {
    match result {
        Ok(items) => {
            let mut board = HotBoard {
                source: source.id().to_string(),
                label: source.label().to_string(),
                accent: source.accent().to_string(),
                updated_at: types::now_rfc3339(),
                items: rank(items),
                error: None,
                needs_cookie: false,
                cached: false,
            };
            cache_put(key, &board);
            board.cached = false;
            board
        }
        Err(message) => {
            // 抓挂了先看有没有能兜底的旧数据：有就把条目还回去，
            // 并在卡片上说明这是缓存，别让用户对着空列表发呆。
            // 存下来的空榜不算数——那还不如直接显示错误。
            match cache_get_stale(key).filter(|b| !b.items.is_empty()) {
                Some(old) => HotBoard {
                    updated_at: types::now_rfc3339(),
                    error: Some(format!(
                        "刷新失败，显示 {} 分钟前的数据：{message}",
                        TTL_STALE.as_secs() / 60
                    )),
                    cached: true,
                    ..old
                },
                None => HotBoard::failed(source, message, needs_cookie),
            }
        }
    }
}

/// 名次统一按返回顺序编，平台自己给的 rank 字段不可靠
fn rank(mut items: Vec<HotItem>) -> Vec<HotItem> {
    for (i, it) in items.iter_mut().enumerate() {
        it.rank = i + 1;
    }
    items
}

/// 抓一个平台。B 站的热门/排行榜共用这个入口，`kind` 只对它有意义。
pub async fn fetch_board(
    source: Source,
    kind: Option<Kind>,
    settings: &AppSettings,
) -> HotBoard {
    let key = cache_key(source, kind);

    // B 站两种口径各自缓存；其余平台忽略 kind
    if matches!(source, Source::Bilibili) {
        let kind = kind.unwrap_or(Kind::Popular);
        if let Some(hit) = cache_get(&key) {
            return hit;
        }
        return finish(
            source,
            &key,
            bilibili::fetch(kind, 50).await,
            source.needs_cookie(),
        );
    }

    if let Some(hit) = cache_get(&key) {
        return hit;
    }

    let cookie = source.cookie_of(settings).to_string();
    // 没配 Cookie 就不用发请求了，直接给前端一个「需要 Cookie」的空态
    if source.needs_cookie() && cookie.trim().is_empty() {
        return HotBoard::failed(
            source,
            format!("{} 需要登录 Cookie，去设置里配置一下就能用", source.label()),
            true,
        );
    }

    let result = match source {
        Source::Weibo => weibo::fetch(50).await,
        Source::Xueqiu => xueqiu::fetch(&cookie, 30).await,
        Source::Xiaohongshu => xiaohongshu::fetch(&cookie, 30).await,
        Source::Bilibili => unreachable!("B 站在上面单独处理了"),
    };

    finish(source, &key, result, source.needs_cookie())
}

/// 并发抓一批平台。单平台失败不抛错，结果里带上原因即可。
pub async fn feed(sources: &[Source], kind: Option<Kind>, settings: &AppSettings) -> Vec<HotBoard> {
    let mut boards = Vec::with_capacity(sources.len());
    // `tokio::join!` 是定长宏，最多同时挂四个；正好就是平台数量。
    // 多于四个时按批次来，避免以后加平台忘了改这里。
    for chunk in sources.chunks(4) {
        match chunk {
            [a, b, c, d] => {
                let (ra, rb, rc, rd) = tokio::join!(
                    fetch_board(*a, kind, settings),
                    fetch_board(*b, kind, settings),
                    fetch_board(*c, kind, settings),
                    fetch_board(*d, kind, settings),
                );
                boards.extend([ra, rb, rc, rd]);
            }
            _ => {
                for s in chunk {
                    boards.push(fetch_board(*s, kind, settings).await);
                }
            }
        }
    }
    boards
}

/// 平台上都有哪些可用口径，给前端渲染切换器
pub fn kinds() -> Vec<(&'static str, &'static str)> {
    vec![
        ("popular", Kind::Popular.label()),
        ("ranking", Kind::Ranking.label()),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn caches_distinct_bilibili_modes_separately() {
        let popular = cache_key(Source::Bilibili, Some(Kind::Popular));
        let ranking = cache_key(Source::Bilibili, Some(Kind::Ranking));
        assert_ne!(popular, ranking, "两种口径不能共用一个缓存位");

        assert_eq!(cache_key(Source::Weibo, None), "weibo");
        assert_eq!(cache_key(Source::Weibo, Some(Kind::Ranking)), "weibo");
    }

    #[test]
    fn renumbers_ranks_from_one() {
        let items = vec![
            HotItem {
                rank: 0,
                ..Default::default()
            },
            HotItem {
                rank: 99,
                ..Default::default()
            },
        ];
        let out = rank(items);
        assert_eq!(out[0].rank, 1);
        assert_eq!(out[1].rank, 2);
    }

    #[tokio::test]
    async fn cookie_gated_sources_report_needs_cookie_without_network() {
        let settings = AppSettings::default();
        let board = fetch_board(Source::Xueqiu, None, &settings).await;
        assert!(board.needs_cookie);
        assert!(board.items.is_empty());
        assert!(board.error.unwrap().contains("Cookie"));
    }

    #[test]
    fn exposes_both_bilibili_modes() {
        let k = kinds();
        assert_eq!(k.len(), 2);
        assert_eq!(k[0].1, "综合热门");
        assert_eq!(k[1].1, "全站排行榜");
    }

    /// 打真网络的冒烟测试。默认 `#[ignore]`，跑它要显式加 `-- --ignored`：
    /// ```
    /// cargo test --no-default-features --lib trending_smoke -- --ignored --nocapture
    /// ```
    /// 目的有两个：一是确认 B 站/微博的匿名接口现在还放行（它们哪天加了
    /// 风控会立刻在这里暴露），二是看雪球/小红书在没 Cookie 时是不是
    /// 老实地报 needs_cookie，而不是伪装成「没内容」。
    #[tokio::test]
    #[ignore = "需要联网"]
    async fn trending_smoke() {
        let settings = crate::db::models::AppSettings::default();
        for source in Source::all() {
            let board = fetch_board(source, Some(Kind::Popular), &settings).await;
            println!(
                "[{}] 条目={} 需Cookie={} 缓存={} 错误={:?}",
                board.label,
                board.items.len(),
                board.needs_cookie,
                board.cached,
                board.error
            );
            if let Some(first) = board.items.first() {
                println!("    #1 {} | {} | {}", first.title, first.hot_text, first.url);
            }
        }

        // 这两个平台实测是放行的，给硬断言；变了就是接口真的改了
        let bili = fetch_board(Source::Bilibili, Some(Kind::Popular), &settings).await;
        assert!(bili.error.is_none(), "B 站取数失败：{:?}", bili.error);
        assert!(bili.items.len() >= 10, "B 站条目太少：{}", bili.items.len());

        let weibo = fetch_board(Source::Weibo, None, &settings).await;
        assert!(weibo.error.is_none(), "微博取数失败：{:?}", weibo.error);
        assert!(weibo.items.len() >= 10, "微博条目太少：{}", weibo.items.len());

        // 需要 Cookie 的平台不该偷偷失败，而要明确告诉前端去配
        for source in [Source::Xueqiu, Source::Xiaohongshu] {
            let b = fetch_board(source, None, &settings).await;
            assert!(b.needs_cookie, "{} 应该标成需要 Cookie", source.label());
        }
    }
}
