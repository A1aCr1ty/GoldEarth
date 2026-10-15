//! 网上冲浪：把 B 站、微博、雪球、小红书的热榜收进同一个页面。
//!
//! 设计要点：
//! - **抓取全在 Rust 侧**，绕开 WebView 的跨域限制，也不用把 Cookie 暴露给前端。
//! - **四个平台并发抓**，谁快谁先回；单个平台失败不影响其他平台，
//!   失败原因塞进 [`HotBoard::error`]，前端自己渲染降级态。
//! - **两层缓存**：短 TTL 内直接复用，避免手滑连点把接口打爆；
//!   超过新鲜期但还在兜底期内，刷新失败时退回旧数据并标注「缓存」，
//!   这样断网时页面不会突然空掉。

pub mod baidu;
pub mod bilibili;
pub mod browser;
/// 共用的 HTTP 客户端也拿给别处用（闲鱼探针同样要挂桌面 UA）
pub(crate) mod http;
pub mod sina_finance;
pub mod ths_news;
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

/// 把「只有 B 站才有意义」的口径归一化，再拿去算缓存键。
///
/// 顺序不能反：先归一再算键，否则 `kind=None` 会算出一个不带后缀的
/// `bilibili`，而 `kind=Some(Popular)` 算出的是 `bilibili:popular`——
/// 同一份数据占两个格子，每次切口径都白抓一轮，兜底缓存也互相看不见。
fn effective_kind(source: Source, kind: Option<Kind>) -> Option<Kind> {
    match source {
        // B 站没指定口径时按「综合热门」算
        Source::Bilibili => Some(kind.unwrap_or(Kind::Popular)),
        // 其余平台一律丢掉 kind，否则用户在 B 站切口径时，
        // 微博的缓存键会跟着从 `weibo` 变成 `weibo:ranking`，白白多抓一轮
        _ => None,
    }
}

fn cache_key(source: Source, kind: Option<Kind>) -> CacheKey {
    match kind {
        Some(k) => format!("{}:{}", source.id(), k_label(k)),
        None => source.id().to_string(),
    }
}

fn k_label(k: Kind) -> &'static str {
    match k {
        Kind::Popular => "popular",
        Kind::Ranking => "ranking",
    }
}

/// 取一份新鲜缓存；没有就返回 None
///
/// **注意这里不标 `cached`**：90 秒内的数据和刚抓的没有实质区别，
/// 挂个「缓存」标签只会让人以为数据是旧的。真正需要提醒的是
/// `cache_get_stale` 那条兜底路径——网络挂了显示半小时前的数据，
/// 那种才标 `cached`，界面也才会多挂一条琥珀色说明。
fn cache_get(key: &str) -> Option<HotBoard> {
    let guard = CACHE.lock();
    let (at, board) = guard.get(key)?;
    if at.elapsed() > TTL_FRESH {
        return None;
    }
    Some(board.clone())
}

/// 取一份「还能用但已经过期」的缓存，连同它已经放了多久
/// （文案里要如实说「多少分钟前的数据」，不能一律写 30 分钟）
fn cache_get_stale(key: &str) -> Option<(HotBoard, Duration)> {
    let guard = CACHE.lock();
    let (at, board) = guard.get(key)?;
    let age = at.elapsed();
    if age > TTL_STALE {
        return None;
    }
    Some((board.clone(), age))
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
                items: rank(source, items),
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
            match cache_get_stale(key).filter(|(b, _)| !b.items.is_empty()) {
                Some((mut old, age)) => {
                    // 不足一分钟也按一分钟说，不然会出现「0 分钟前的数据」
                    let mins = (age.as_secs() / 60).max(1);
                    old.error = Some(format!("刷新失败，显示 {mins} 分钟前的数据：{message}"));
                    old.cached = true;
                    // updated_at 保留缓存里那个**真实抓取时间**：
                    // 卡片页脚显示的就是它，写成 now 等于谎报新鲜度
                    old
                }
                None => HotBoard::failed(source, message, needs_cookie),
            }
        }
    }
}

/// 名次统一按返回顺序编，平台自己给的 rank 字段不可靠。
/// 时间流（财经快讯 / 新闻）没有名次这回事，编了反而像热度排名——不编。
fn rank(source: Source, items: Vec<HotItem>) -> Vec<HotItem> {
    if !source.ranked() {
        return items;
    }
    let mut items = items;
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
    force: bool,
) -> HotBoard {
    // 先把口径归一化再算缓存键，两种口径各自占一个格子
    let kind = effective_kind(source, kind);
    let key = cache_key(source, kind);

    // `force` 是用户明确点了刷新：必须真的重新抓一遍，不能拿缓存交差。
    // 缓存只是防手滑连点的护栏（前端在刷期间会禁用按钮），不该拦住显式操作。
    let fresh = !force;

    // 「点了刷新但内容没变」这类问题光看界面分不清是没发请求还是数据真没变，
    // 所以开发模式下把后端实际收到的指令打印出来，一眼能对上前端有没有传过来。
    #[cfg(debug_assertions)]
    if force {
        eprintln!("[trending] 强制刷新 {} (key={key})", source.id());
    }

    if matches!(source, Source::Bilibili) {
        if fresh {
            if let Some(hit) = cache_get(&key) {
                return hit;
            }
        }
        // 上面已经兜成 Some，取不到说明归一化漏了平台
        let kind = kind.expect("B 站的 kind 已由 effective_kind 归一化");
        return finish(
            source,
            &key,
            bilibili::fetch(kind, 50).await,
            source.needs_cookie(),
        );
    }

    if fresh {
        if let Some(hit) = cache_get(&key) {
            return hit;
        }
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
        Source::Baidu => baidu::fetch(50).await,
        Source::ThsNews => ths_news::fetch(30).await,
        Source::SinaFinance => sina_finance::fetch(30).await,
        Source::Xueqiu => xueqiu::fetch(&cookie, 30).await,
        Source::Xiaohongshu => xiaohongshu::fetch(&cookie, 30).await,
        Source::Bilibili => unreachable!("B 站在上面已经处理完了"),
    };

    finish(source, &key, result, source.needs_cookie())
}

/// 并发抓一批平台。单平台失败不抛错，结果里带上原因即可。
///
/// 每个平台各起一个 task，所以**平台数量增加不用改这里**。
/// 之前用的是 `tokio::join!` 定长宏（只覆盖到 4 个），一旦超过 4 个平台
/// 就会退化成按批次串行——加财经两个源正好踩到那儿。
pub async fn fetch_for_app(
    app: tauri::AppHandle,
    source: Source,
    kind: Option<Kind>,
    settings: &AppSettings,
    force: bool,
) -> HotBoard {
    if !source.uses_browser() {
        return fetch_board(source, kind, settings, force).await;
    }
    let key = format!("{}:browser", source.id());
    if !force {
        if let Some(hit) = cache_get(&key) {
            return hit;
        }
    }
    finish(source, &key, browser::fetch(app, source).await, false)
}

pub async fn feed(
    app: tauri::AppHandle,
    sources: &[Source],
    kind: Option<Kind>,
    settings: &AppSettings,
    force: bool,
) -> Vec<HotBoard> {
    // 每个 task 都要自己持有一份设置（AppSettings 是可 Clone 的纯数据）
    let shared = settings.clone();
    let mut tasks: Vec<(Source, tokio::task::JoinHandle<HotBoard>)> =
        Vec::with_capacity(sources.len());
    // 用 `&source` 解构出**值**而不是引用：取引用会把 `sources` 的生命周期
    // 带进 spawn 的 future 里，编译器会要求它活成 'static
    for &source in sources {
        let settings = shared.clone();
        let app = app.clone();
        tasks.push((
            source,
            tokio::spawn(async move { fetch_for_app(app, source, kind, &settings, force).await }),
        ));
    }

    // 按请求的顺序收回结果，前端那边是按 source 标识索引的，顺序稳一点更省心
    let mut boards = Vec::with_capacity(sources.len());
    for (source, task) in tasks {
        match task.await {
            Ok(board) => boards.push(board),
            // task 真的 panic 了才走这里；不能静默少一张卡，
            // 补一个失败态让前端照常渲染出带说明的卡片
            Err(_) => boards.push(HotBoard::failed(
                source,
                "抓取任务异常退出",
                source.needs_cookie(),
            )),
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
        let popular = cache_key(
            Source::Bilibili,
            effective_kind(Source::Bilibili, Some(Kind::Popular)),
        );
        let ranking = cache_key(
            Source::Bilibili,
            effective_kind(Source::Bilibili, Some(Kind::Ranking)),
        );
        assert_ne!(popular, ranking, "两种口径不能共用一个缓存位");

        assert_eq!(
            cache_key(Source::Weibo, effective_kind(Source::Weibo, None)),
            "weibo"
        );
        assert_eq!(
            cache_key(
                Source::Weibo,
                effective_kind(Source::Weibo, Some(Kind::Ranking))
            ),
            "weibo",
            "非 B 站要丢掉口径后缀，否则切 B 站口径会把它的缓存键也搅乱"
        );
    }

    #[test]
    fn bilibili_without_kind_shares_the_popular_slot() {
        // 不传口径就是综合热门，两者必须落在同一个格子上。
        // 否则同一份数据占两个缓存位，每次切口径都白抓一轮。
        assert_eq!(
            cache_key(Source::Bilibili, effective_kind(Source::Bilibili, None)),
            cache_key(
                Source::Bilibili,
                effective_kind(Source::Bilibili, Some(Kind::Popular))
            )
        );
        assert_eq!(effective_kind(Source::Bilibili, None), Some(Kind::Popular));
        assert_eq!(effective_kind(Source::Xueqiu, Some(Kind::Ranking)), None);
    }

    #[test]
    fn stale_fallback_keeps_the_real_fetch_time() {
        let key = "test-stale";
        let cached = HotBoard {
            source: "weibo".into(),
            label: "微博".into(),
            accent: "#e6162d".into(),
            // 缓存里的真实抓取时间，必须原样透出
            updated_at: "2026-10-14T10:00:00+00:00".into(),
            items: vec![HotItem {
                title: "旧词条".into(),
                ..Default::default()
            }],
            error: None,
            needs_cookie: false,
            cached: false,
        };
        cache_put(key, &cached);

        let out = finish(
            Source::Weibo,
            key,
            Err("请求失败：connection reset".into()),
            false,
        );

        assert!(out.cached, "兜底数据要标成缓存");
        assert_eq!(out.items.len(), 1);
        assert_eq!(
            out.updated_at, cached.updated_at,
            "页脚显示的是抓取时间，改成 now 就等于谎报新鲜度"
        );
        let err = out.error.expect("要说明为什么退回旧数据");
        assert!(err.contains("分钟前的数据"), "实际文案：{err}");
        assert!(
            err.contains("connection reset"),
            "原始失败原因要透出：{err}"
        );
    }

    #[test]
    fn stale_fallback_is_not_used_for_empty_cached_board() {
        let key = "test-stale-empty";
        cache_put(
            key,
            &HotBoard {
                source: "weibo".into(),
                items: Vec::new(),
                ..HotBoard::failed(Source::Weibo, "旧错误", false)
            },
        );

        let out = finish(Source::Weibo, key, Err("又挂了".into()), false);

        assert!(out.items.is_empty());
        assert_eq!(out.error.as_deref(), Some("又挂了"), "空榜兜底等于没兜底");
        assert!(!out.cached);
    }

    #[test]
    fn fresh_cache_hit_is_not_flagged_as_cached() {
        // 「缓存」这个标签只留给真正该提醒的情况：网络挂了、显示半小时前的旧数据。
        // 90 秒内的缓存数据和刚抓的没区别，挂标签只会让人以为数据是旧的。
        let key = "test-fresh-hit";
        cache_put(
            key,
            &HotBoard {
                source: "weibo".into(),
                items: vec![HotItem::default()],
                updated_at: "2026-10-15T03:00:00+00:00".into(),
                ..HotBoard::failed(Source::Weibo, "", false)
            },
        );
        let hit = cache_get(key).expect("刚放进去的缓存应该命中");
        assert!(!hit.cached, "新鲜缓存不该被标成「缓存」");
        assert_eq!(hit.items.len(), 1);
    }

    #[test]
    fn renumbers_ranks_from_one_but_leaves_feeds_alone() {
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
        let out = rank(Source::Baidu, items.clone());
        assert_eq!(out[0].rank, 1);
        assert_eq!(out[1].rank, 2);

        // 时间流不编号：原样保留（这里就是 0 / 99，界面看到 0 就不画序号）
        let feed = rank(Source::SinaFinance, items);
        assert_eq!(feed[0].rank, 0);
        assert_eq!(feed[1].rank, 99);
    }

    /// Cookie 门控这条短路现在页面上用不到（在线的平台都匿名可取），
    /// 但 `fetch_board` 仍靠它兜底——平台恢复时不该静默发出一个没 Cookie 的请求。
    /// 此处只覆盖保留的旧 HTTP 路径；应用中的这两个源走 fetch_for_app 网页会话。
    #[tokio::test]
    async fn cookie_gated_sources_report_needs_cookie_without_network() {
        for source in [Source::Xueqiu, Source::Xiaohongshu] {
            let settings = AppSettings::default();
            let board = fetch_board(source, None, &settings, false).await;
            assert!(
                board.needs_cookie,
                "{} 缺 Cookie 时要标出来",
                source.label()
            );
            assert!(board.items.is_empty());
            assert!(board.error.unwrap().contains("Cookie"));
        }
    }

    #[test]
    fn exposes_both_bilibili_modes() {
        let k = kinds();
        assert_eq!(k.len(), 2);
        assert_eq!(k[0].1, "综合热门");
        assert_eq!(k[1].1, "全站排行榜");
    }

    /// 直接验证「显式刷新真的重新抓」——这个 bug 很隐蔽：
    /// 缓存照常返回时界面上看不出任何区别，只是数据一直没变。
    #[tokio::test]
    #[ignore = "需要联网"]
    async fn forced_refresh_bypasses_the_fresh_cache() {
        let settings = AppSettings::default();

        let first = fetch_board(Source::Baidu, None, &settings, false).await;
        assert!(first.error.is_none(), "取数失败：{:?}", first.error);

        // 不 force：命中新鲜缓存，抓取时间原样不动
        let cached = fetch_board(Source::Baidu, None, &settings, false).await;
        assert_eq!(
            cached.updated_at, first.updated_at,
            "不 force 时应当直接吃缓存"
        );
        assert!(!cached.cached, "新鲜缓存不该标成「缓存」");

        // force：必须真的重新发一次请求，抓取时间要往前推
        let forced = fetch_board(Source::Baidu, None, &settings, true).await;
        assert_ne!(
            forced.updated_at, first.updated_at,
            "force 时必须绕过缓存重新抓，否则「点刷新没反应」"
        );
        assert!(!forced.cached, "真抓到的数据不该标缓存");
    }

    /// 打真网络的冒烟测试。默认 `#[ignore]`，跑它要显式加 `-- --ignored`：
    /// ```
    /// cargo test --no-default-features --lib trending_smoke -- --ignored --nocapture
    /// ```
    /// 目的：确认清单里这几个平台的匿名接口现在还放行——它们哪天加了
    /// 风控会立刻在这里暴露。网页登录源需要桌面 WebView 与用户会话，
    /// 不走这个仅检查匿名 HTTP 数据源的循环。
    #[tokio::test]
    #[ignore = "需要联网"]
    async fn trending_smoke() {
        let settings = crate::db::models::AppSettings::default();
        for source in Source::all().into_iter().filter(|s| !s.uses_browser()) {
            let board = fetch_board(source, Some(Kind::Popular), &settings, false).await;
            println!(
                "[{}] 条目={} 需Cookie={} 缓存={} 错误={:?}",
                board.label,
                board.items.len(),
                board.needs_cookie,
                board.cached,
                board.error
            );
            if let Some(first) = board.items.first() {
                println!(
                    "    #1 {} | {} | {}",
                    first.title, first.hot_text, first.url
                );
            }
        }

        // 这三个平台实测是放行的，给硬断言；变了就是接口真的改了
        // 这些平台实测是放行的，给硬断言；变了就是接口真的改了。
        // 写死而不是遍历：清单会变，但「哪个该断言」是人的判断。
        for source in [
            Source::Bilibili,
            Source::Weibo,
            Source::Baidu,
            Source::ThsNews,
            Source::SinaFinance,
        ] {
            let b = fetch_board(source, Some(Kind::Popular), &settings, false).await;
            assert!(
                b.error.is_none(),
                "{} 取数失败：{:?}",
                source.label(),
                b.error
            );
            assert!(
                b.items.len() >= 10,
                "{} 条目太少：{}",
                source.label(),
                b.items.len()
            );
            // 榜单才有名次；快讯/新闻要是也编了名次，说明 ranked() 判断漏了
            if source.ranked() {
                assert_eq!(
                    b.items[0].rank,
                    1,
                    "{} 是榜单，首条应该是第 1 名",
                    source.label()
                );
            } else {
                assert_eq!(
                    b.items[0].rank,
                    0,
                    "{} 是时间流，不该有名次",
                    source.label()
                );
            }
        }
    }
}
