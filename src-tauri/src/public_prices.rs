//! 国内公开在售样本与跨平台参考价；缺失来源明确列出，不以估价、缓存或海外价代替。
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

const READ: &str = include_str!("public_price_scrape.js");
static LOCK: Lazy<tokio::sync::Mutex<()>> = Lazy::new(|| tokio::sync::Mutex::new(()));

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Listing {
    pub title: String,
    pub price: f64,
    pub currency: String,
    pub url: String,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub condition: String,
}
#[derive(Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct Snapshot {
    page_url: String,
    page_title: String,
    ready: bool,
    status: String,
    message: String,
    items: Vec<Listing>,
    candidate_ids: Vec<String>,
    matched_ids: Vec<String>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceReport {
    pub id: String,
    pub name: String,
    pub url: String,
    pub status: String,
    pub message: String,
    pub count: usize,
    pub median: Option<f64>,
    pub min: Option<f64>,
    pub max: Option<f64>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub ok: bool,
    pub needs_verification: bool,
    pub count: usize,
    /// 保留旧协议字段名，数值含义由 method 明确说明：平台中位数的中位数。
    pub avg: Option<f64>,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub ret: String,
    pub message: String,
    pub source: String,
    pub currency: String,
    pub source_url: String,
    pub query: String,
    pub method: String,
    pub coverage: usize,
    pub sources: Vec<SourceReport>,
    pub listings: Vec<Listing>,
}
#[derive(Clone, Copy)]
enum Provider {
    Nine,
    Xianyu,
    Jd,
    Suning,
    Taobao,
}
impl Provider {
    fn id(self) -> &'static str {
        match self {
            Self::Nine => "nine",
            Self::Xianyu => "xianyu",
            Self::Jd => "jd",
            Self::Suning => "suning",
            Self::Taobao => "taobao",
        }
    }
    fn name(self) -> &'static str {
        match self {
            Self::Nine => "九机良品",
            Self::Xianyu => "闲鱼",
            Self::Jd => "京东二手",
            Self::Suning => "苏宁二手",
            Self::Taobao => "淘宝二手",
        }
    }
    fn host(self) -> &'static str {
        match self {
            Self::Nine => "m2.9ji.com",
            Self::Xianyu => "www.goofish.com",
            Self::Jd => "search.jd.com",
            Self::Suning => "search.suning.com",
            Self::Taobao => "s.taobao.com",
        }
    }
    fn search(self, keyword: &str) -> reqwest::Url {
        let (base, key) = match self {
            Self::Nine => ("https://m2.9ji.com/search", "keyword"),
            Self::Xianyu => ("https://www.goofish.com/search", "q"),
            Self::Jd => ("https://search.jd.com/Search", "keyword"),
            Self::Suning => ("https://search.suning.com/", "keyword"),
            Self::Taobao => ("https://s.taobao.com/search", "q"),
        };
        let mut url = reqwest::Url::parse(base).unwrap();
        let query = if matches!(self, Self::Jd | Self::Suning | Self::Taobao) {
            format!("{keyword} 二手")
        } else if matches!(self, Self::Nine) && keyword == "REDMI Book 14 2026" {
            "REDMI Book 14".into()
        } else {
            keyword.into()
        };
        if matches!(self, Self::Suning) {
            url.set_path(&format!("{query}/"));
        } else {
            url.query_pairs_mut().append_pair(key, &query);
        }
        if matches!(self, Self::Nine) {
            url.query_pairs_mut().append_pair("searchType", "3");
        }
        url
    }
}
fn normalize_query(keyword: &str) -> String {
    match keyword.to_lowercase().replace([' ', '-'], "").as_str() {
        "2026xiaomibook14" | "xiaomibook142026" | "2026redmibook14" | "redmibook142026"
        | "redmibook142026款" | "红米book142026" | "红米book142026款" => "REDMI Book 14 2026".into(),
        "pocket3" => "pocket 3".into(),
        "pocket4" => "pocket 4".into(),
        "pocket4p" => "pocket 4p".into(),
        _ => keyword.trim().to_string(),
    }
}
fn is_current_page(raw: &str, provider: Provider, keyword: &str, request: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(raw) else {
        return false;
    };
    if url.scheme() != "https" {
        return false;
    }
    if matches!(provider, Provider::Jd) && url.host_str() == Some("passport.jd.com") {
        return url
            .query_pairs()
            .find(|(k, _)| k.eq_ignore_ascii_case("ReturnUrl"))
            .is_some_and(|(_, target)| is_current_page(&target, provider, keyword, request));
    }
    let expected = provider.search(keyword);
    url.host_str() == Some(provider.host())
        && url.path() == expected.path()
        && expected
            .query_pairs()
            .all(|(key, value)| url.query_pairs().any(|(k, v)| k == key && v == value))
        && url
            .query_pairs()
            .any(|(k, v)| k == "_ge_probe" && v == request)
}
async fn snapshot(
    w: &tauri::WebviewWindow,
    provider: Provider,
    keyword: &str,
) -> Result<Snapshot, String> {
    let js = READ.replace(
        "__INPUT_JSON__",
        &serde_json::json!({"provider":provider.id(),"keyword":keyword}).to_string(),
    );
    let (tx, rx) = tokio::sync::oneshot::channel();
    let tx = Mutex::new(Some(tx));
    w.eval_with_callback(&js, move |value| {
        if let Some(tx) = tx.lock().take() {
            let _ = tx.send(value);
        }
    })
    .map_err(|e| e.to_string())?;
    let raw = tokio::time::timeout(Duration::from_secs(3), rx)
        .await
        .map_err(|_| "读取页面超时".to_string())?
        .map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}
fn valid_listings(items: Vec<Listing>, provider: Provider) -> Vec<Listing> {
    let mut seen = std::collections::HashSet::new();
    items
        .into_iter()
        .filter(|item| {
            let valid_url = reqwest::Url::parse(&item.url).ok().is_some_and(|u| {
                u.scheme() == "https"
                    && match provider {
                        Provider::Nine => {
                            u.host_str() == Some("m2.9ji.com")
                                && u.path().starts_with("/secondHand/detail/")
                        }
                        Provider::Xianyu => {
                            u.host_str() == Some("www.goofish.com")
                                && u.path() == "/item"
                                && u.query_pairs().any(|(k, v)| k == "id" && !v.is_empty())
                        }
                        Provider::Suning => {
                            u.host_str() == Some("product.suning.com")
                                && u.path().ends_with(".html")
                        }
                        Provider::Taobao => {
                            matches!(u.host_str(), Some("item.taobao.com" | "detail.tmall.com"))
                                && u.query_pairs().any(|(k, v)| {
                                    k == "id"
                                        && v.chars().all(|c| c.is_ascii_digit())
                                        && !v.is_empty()
                                })
                        }
                        Provider::Jd => u.host_str() == Some("item.jd.com") && u.path() != "/",
                    }
            });
            item.currency == "CNY"
                && item.source == provider.id()
                && item.price.is_finite()
                && item.price > 0.0
                && item.price <= 10_000_000.0
                && valid_url
                && seen.insert(item.url.clone())
        })
        .take(100)
        .collect()
}
fn median(values: &[f64]) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    let middle = sorted.len() / 2;
    let n = if sorted.len() % 2 == 0 {
        (sorted[middle - 1] + sorted[middle]) / 2.0
    } else {
        sorted[middle]
    };
    Some((n * 100.0).round() / 100.0)
}
fn report(provider: Provider, keyword: &str, items: &[Listing], detail: &str) -> SourceReport {
    let prices: Vec<_> = items.iter().map(|i| i.price).collect();
    let usable = prices.len() >= 3;
    let diagnostics = detail.split_once(" 本次读取 ").map(|(_, counts)| format!(" 本次读取 {counts}")).unwrap_or_default();
    SourceReport {
        id: provider.id().into(),
        name: provider.name().into(),
        url: provider.search(keyword).into(),
        status: if usable { "ok" } else if prices.is_empty() { "unavailable" } else { "sparse" }.into(),
        message: if usable {
            "已取得公开在售样本；配置与成色见商品明细".into()
        } else if !items.is_empty() {
            format!("样本较少，可参考当前挂牌价；本次不写入价格趋势。{diagnostics}")
        } else if detail.is_empty() {
            "未取得可验证的公开在售报价".into()
        } else {
            detail.into()
        },
        count: items.len(),
        median: median(&prices),
        min: prices.iter().cloned().reduce(f64::min),
        max: prices.iter().cloned().reduce(f64::max),
    }
}
async fn collect(
    app: AppHandle,
    provider: Provider,
    keyword: String,
) -> (SourceReport, Vec<Listing>) {
    let result: Result<(Vec<Listing>, String, bool), String> = async {
        let label = format!("domestic-prices-{}", provider.id());
        let request = uuid::Uuid::new_v4().to_string();
        let mut url = provider.search(&keyword);
        url.query_pairs_mut().append_pair("_ge_probe", &request);
        let w = if let Some(w) = app.get_webview_window(&label) {
            w.navigate(url).map_err(|e| e.to_string())?;
            w
        } else {
            let mut builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(url))
                .title(format!("国内二手报价 · {}", provider.name()))
                .inner_size(1100.0, 800.0)
                .visible(false);
            if matches!(provider, Provider::Xianyu) {
                builder = builder.initialization_script(crate::xianyu_webview::HOOK_JS);
            }
            let w = builder.build().map_err(|e| e.to_string())?;
            let hidden = w.clone();
            w.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = hidden.hide();
                }
            });
            w
        };
        let is_xianyu = matches!(provider, Provider::Xianyu);
        let deadline = tokio::time::Instant::now() + Duration::from_secs(if is_xianyu { 32 } else { 18 });
        let max_rounds = if is_xianyu { 24 } else { 8 };
        let mut items = Vec::new();
        let mut detail = String::new();
        let mut candidates = std::collections::HashSet::new();
        let mut matched = std::collections::HashSet::new();
        let mut rounds = 0;
        let mut needs_verification = false;
        loop {
            match snapshot(&w, provider, &keyword).await {
                Ok(page) if is_current_page(&page.page_url, provider, &keyword, &request) => {
                    detail = if page.page_title.trim().is_empty() {
                        "搜索页面未返回可识别的商品列表".into()
                    } else {
                        format!("{}：未取得匹配的公开在售样本", page.page_title)
                    };
                    if page.ready {
                        candidates.extend(page.candidate_ids);
                        matched.extend(page.matched_ids);
                        items.extend(valid_listings(page.items, provider));
                        items = valid_listings(items, provider);
                        if !page.message.is_empty() {
                            detail = page.message;
                        }
                        needs_verification = matches!(provider, Provider::Xianyu) && page.status == "restricted";
                        if items.len() >= 100 || rounds >= max_rounds || page.status == "restricted" {
                            break;
                        }
                        rounds += 1;
                        let scroll = if is_xianyu {
                            // Capture one viewport at a time, including nested scrollable result lists.
                            r#"(() => {
                                const card = document.querySelector('a[href*="/item?"][href*="id="]');
                                let container = card?.parentElement;
                                while (container && container !== document.body) {
                                    if (/auto|scroll/.test(getComputedStyle(container).overflowY) &&
                                        container.scrollHeight > container.clientHeight) {
                                        container.scrollTop += Math.max(1, Math.floor(container.clientHeight * 0.75));
                                        return;
                                    }
                                    container = container.parentElement;
                                }
                                window.scrollBy(0, Math.max(1, Math.floor(window.innerHeight * 0.75)));
                            })()"#
                        } else {
                            "window.scrollTo(0, document.documentElement.scrollHeight)"
                        };
                        let _ = w.eval(scroll);
                    }
                }
                Ok(_) => {}
                Err(e) => detail = format!("读取页面失败：{e}"),
            }
            if tokio::time::Instant::now() >= deadline {
                break;
            }
            tokio::time::sleep(Duration::from_millis(700)).await;
        }
        if is_xianyu && !candidates.is_empty() {
            detail.push_str(&format!(" 本次读取 {} 个不同商品，{} 个标题符合检索词，{} 个取得有效在售价格。", candidates.len(), matched.len(), items.len()));
        }
        Ok((items, detail, needs_verification))
    }
    .await;
    match result {
        Ok((items, detail, needs_verification)) => {
            let mut source = report(provider, &keyword, &items, &detail);
            if needs_verification && source.count == 0 {
                source.status = "verification_required".into();
            }
            (source, items)
        }
        Err(e) => (report(provider, &keyword, &[], &e), Vec::new()),
    }
}
#[cfg(test)]
fn unavailable(id: &str, name: &str, url: &str, message: &str) -> SourceReport {
    SourceReport {
        id: id.into(),
        name: name.into(),
        url: url.into(),
        status: "unavailable".into(),
        message: message.into(),
        count: 0,
        median: None,
        min: None,
        max: None,
    }
}
#[cfg(test)]
fn reference(sources: &[SourceReport]) -> (Option<f64>, Vec<String>) {
    let has_full_source = sources.iter().any(|s| s.status == "ok" && s.count >= 3 && s.median.is_some());
    let mut ids = Vec::new();
    let values: Vec<_> = sources
        .iter()
        .filter(|s| if has_full_source { s.status == "ok" && s.count >= 3 } else { s.status == "sparse" && s.count > 0 })
        .filter_map(|s| {
            s.median.map(|price| {
                ids.push(s.id.clone());
                price
            })
        })
        .collect();
    ids.sort();
    (median(&values), ids)
}
#[tauri::command]
pub async fn fetch_public_price(
    app: AppHandle,
    state: tauri::State<'_, crate::AppState>,
    target_id: String,
) -> Result<Summary, String> {
    let target = state
        .storage
        .list_price_targets()
        .into_iter()
        .find(|t| t.id == target_id)
        .ok_or("该物品已删除")?;
    let query = normalize_query(if target.keyword.trim().is_empty() {
        &target.name
    } else {
        &target.keyword
    });
    let _guard = LOCK.lock().await;
    let (source, listings) = collect(app, Provider::Xianyu, query.clone()).await;
    let count = source.count;
    let avg = source.median;
    let min = source.min;
    let max = source.max;
    let source_url = source.url.clone();
    let needs_verification = source.status == "verification_required";
    let message = match avg {
        Some(price) if count >= 3 => {
            state.storage.add_price_sample(&target_id, price, "domestic:v1:xianyu", count as u32)
                .map_err(|e| format!("保存参考价失败：{e}"))?;
            format!("闲鱼挂牌中位数 ¥{price:.2}，共 {count} 条在售样本。配置和成色见商品明细。")
        }
        Some(_) => format!("找到 {count} 条闲鱼在售挂牌，可作为询价参考。样本较少，本次不写入价格趋势。"),
        None => "本次未取得有效闲鱼在售报价。".into(),
    };
    Ok(Summary {
        ok: avg.is_some(),
        needs_verification,
        count,
        avg,
        min,
        max,
        ret: String::new(),
        message,
        source: "闲鱼".into(),
        currency: "CNY".into(),
        source_url,
        query,
        method: if count == 1 { "显示该商品的挂牌价" } else { "取闲鱼有效挂牌价的中位数" }.into(),
        coverage: usize::from(count > 0),
        sources: vec![source],
        listings,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn current_search_and_redirect_must_belong_to_this_request() {
        let mut url = Provider::Nine.search("pocket 3");
        url.query_pairs_mut().append_pair("_ge_probe", "new");
        assert!(is_current_page(
            url.as_str(),
            Provider::Nine,
            "pocket 3",
            "new"
        ));
        assert!(!is_current_page(
            url.as_str(),
            Provider::Nine,
            "pocket 4",
            "new"
        ));
        assert!(!is_current_page(
            url.as_str(),
            Provider::Nine,
            "pocket 3",
            "old"
        ));
        let mut target = Provider::Jd.search("pocket 3");
        target.query_pairs_mut().append_pair("_ge_probe", "new");
        let mut login = reqwest::Url::parse("https://passport.jd.com/new/login.aspx").unwrap();
        login
            .query_pairs_mut()
            .append_pair("ReturnUrl", target.as_str());
        assert!(is_current_page(
            login.as_str(),
            Provider::Jd,
            "pocket 3",
            "new"
        ));
        assert!(!is_current_page(
            login.as_str(),
            Provider::Jd,
            "pocket 3",
            "old"
        ));
    }
    #[test]
    fn new_marketplaces_keep_query_identity_and_reject_foreign_links() {
        for provider in [Provider::Suning, Provider::Taobao] {
            let mut url = provider.search("iPhone 15");
            url.query_pairs_mut().append_pair("_ge_probe", "current");
            assert!(is_current_page(
                url.as_str(),
                provider,
                "iPhone 15",
                "current"
            ));
            assert!(!is_current_page(
                url.as_str(),
                provider,
                "iPhone 16",
                "current"
            ));
            let good = if matches!(provider, Provider::Suning) {
                "https://product.suning.com/007/123.html"
            } else {
                "https://item.taobao.com/item.htm?id=123"
            };
            let row = |url: &str| Listing {
                title: "二手 iPhone 15".into(),
                price: 2000.0,
                currency: "CNY".into(),
                url: url.into(),
                source: provider.id().into(),
                condition: "99新".into(),
            };
            assert_eq!(
                valid_listings(
                    vec![
                        row(good),
                        row(good),
                        row("https://evil.example/123.html?id=123")
                    ],
                    provider
                )
                .len(),
                1
            );
        }
    }
    #[test]
    fn only_cny_and_trusted_domestic_listing_urls_are_accepted() {
        let item = |price, currency: &str, url: &str| Listing {
            title: "Pocket 3".into(),
            price,
            currency: currency.into(),
            url: url.into(),
            source: "nine".into(),
            condition: "9成新".into(),
        };
        let url = "https://m2.9ji.com/secondHand/detail/1207440";
        let rows = valid_listings(
            vec![
                item(1600.0, "CNY", url),
                item(1600.0, "CNY", url),
                item(200.0, "USD", url),
                item(f64::NAN, "CNY", url),
                item(3.0, "CNY", "https://evil.example/"),
            ],
            Provider::Nine,
        );
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].price, 1600.0);
    }
    #[test]
    fn platform_medians_are_equal_weighted_and_missing_sources_are_excluded() {
        let mut a = unavailable("nine", "Nine", "https://m2.9ji.com/", "");
        a.status = "ok".into();
        a.count = 50;
        a.median = Some(1800.0);
        let mut b = a.clone();
        b.id = "xianyu".into();
        b.count = 3;
        b.median = Some(1600.0);
        let missing = unavailable(
            "zhuanzhuan",
            "转转",
            "https://www.zhuanzhuan.com/",
            "App入口",
        );
        let (price, ids) = reference(&[a.clone(), b, missing]);
        assert_eq!(price, Some(1700.0));
        assert_eq!(ids.len(), 2);
        let (price, ids) = reference(&[a]);
        assert_eq!(price, Some(1800.0));
        assert_eq!(ids.len(), 1);
        let mut sparse = unavailable("xianyu", "闲鱼", "https://www.goofish.com/", "");
        sparse.status = "sparse".into();
        sparse.count = 1;
        sparse.median = Some(1500.0);
        assert_eq!(reference(&[sparse.clone()]), (Some(1500.0), vec!["xianyu".into()]));
        let full = report(Provider::Nine, "test", &[], "");
        let full = SourceReport { status: "ok".into(), count: 3, median: Some(1800.0), ..full };
        assert_eq!(reference(&[sparse, full]), (Some(1800.0), vec!["nine".into()]));
        assert_eq!(reference(&[]).0, None);
    }
}
