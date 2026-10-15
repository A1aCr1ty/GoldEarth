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
    related_urls: Vec<String>,
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
    Zhuanzhuan,
    Nine,
    Xianyu,
    Jd,
}
impl Provider {
    fn id(self) -> &'static str {
        match self {
            Self::Zhuanzhuan => "zhuanzhuan",
            Self::Nine => "nine",
            Self::Xianyu => "xianyu",
            Self::Jd => "jd",
        }
    }
    fn name(self) -> &'static str {
        match self {
            Self::Zhuanzhuan => "转转",
            Self::Nine => "九机良品",
            Self::Xianyu => "闲鱼",
            Self::Jd => "京东二手",
        }
    }
    fn host(self) -> &'static str {
        match self {
            Self::Zhuanzhuan => "m.zhuanzhuan.com",
            Self::Nine => "m2.9ji.com",
            Self::Xianyu => "www.goofish.com",
            Self::Jd => "search.jd.com",
        }
    }
    fn search(self, keyword: &str) -> reqwest::Url {
        let (base, key) = match self {
            Self::Zhuanzhuan => (
                "https://m.zhuanzhuan.com/u/streamline_detail/new-goods-detail",
                "keyword",
            ),
            Self::Nine => ("https://m2.9ji.com/search", "keyword"),
            Self::Xianyu => ("https://www.goofish.com/search", "q"),
            Self::Jd => ("https://search.jd.com/Search", "keyword"),
        };
        let mut url = reqwest::Url::parse(base).unwrap();
        let query = if matches!(self, Self::Jd) {
            format!("{keyword} 二手")
        } else {
            keyword.into()
        };
        url.query_pairs_mut().append_pair(key, &query);
        if matches!(self, Self::Nine) {
            url.query_pairs_mut().append_pair("searchType", "3");
        }
        url
    }
}
fn normalize_query(keyword: &str) -> String {
    match keyword.to_lowercase().replace([' ', '-'], "").as_str() {
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
                        Provider::Zhuanzhuan => zhuanzhuan_url(&item.url).is_some(),
                        Provider::Nine => {
                            u.host_str() == Some("m2.9ji.com")
                                && u.path().starts_with("/secondHand/detail/")
                        }
                        Provider::Xianyu => {
                            u.host_str() == Some("www.goofish.com")
                                && u.path() == "/item"
                                && u.query_pairs().any(|(k, v)| k == "id" && !v.is_empty())
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
    SourceReport {
        id: provider.id().into(),
        name: provider.name().into(),
        url: provider.search(keyword).into(),
        status: if usable { "ok" } else { "unavailable" }.into(),
        message: if usable {
            "已取得公开在售样本；配置与成色见商品明细".into()
        } else if !items.is_empty() {
            "样本不足 3 条，仅供查看，未参与综合参考价".into()
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
    let result: Result<(Vec<Listing>, String), String> = async {
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
        let deadline = tokio::time::Instant::now() + Duration::from_secs(18);
        let mut items = Vec::new();
        let mut detail = String::new();
        loop {
            match snapshot(&w, provider, &keyword).await {
                Ok(page) if is_current_page(&page.page_url, provider, &keyword, &request) => {
                    detail = format!("{}：未取得匹配的公开在售样本", page.page_title);
                    if page.ready {
                        items = valid_listings(page.items, provider);
                        if !page.message.is_empty() {
                            detail = page.message;
                        }
                        if items.len() >= 3 || page.status == "restricted" {
                            break;
                        }
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
        Ok((items, detail))
    }
    .await;
    match result {
        Ok((items, detail)) => (report(provider, &keyword, &items, &detail), items),
        Err(e) => (report(provider, &keyword, &[], &e), Vec::new()),
    }
}
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
/// 仅接受已核实的转转 H5 商品页，去掉分享追踪参数及任意外部跳转。
pub(crate) fn zhuanzhuan_url(raw: &str) -> Option<reqwest::Url> {
    let url = reqwest::Url::parse(raw).ok()?;
    if url.scheme() != "https"
        || url.host_str() != Some("m.zhuanzhuan.com")
        || url.path() != "/u/streamline_detail/new-goods-detail"
    {
        return None;
    }
    let id = url
        .query_pairs()
        .find(|(key, _)| key == "infoId")?
        .1
        .into_owned();
    if id.is_empty() || id.len() > 30 || !id.bytes().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let mut canonical =
        reqwest::Url::parse("https://m.zhuanzhuan.com/u/streamline_detail/new-goods-detail")
            .ok()?;
    canonical.query_pairs_mut().append_pair("infoId", &id);
    Some(canonical)
}
async fn read_zhuanzhuan(
    w: &tauri::WebviewWindow,
    keyword: &str,
    mut url: reqwest::Url,
) -> Result<Snapshot, String> {
    let expected = zhuanzhuan_url(url.as_str()).ok_or("转转商品链接无效")?;
    let request = uuid::Uuid::new_v4().to_string();
    url.query_pairs_mut().append_pair("_ge_probe", &request);
    w.navigate(url).map_err(|e| e.to_string())?;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(15);
    loop {
        if let Ok(page) = snapshot(w, Provider::Zhuanzhuan, keyword).await {
            let same = zhuanzhuan_url(&page.page_url).as_ref() == Some(&expected)
                && reqwest::Url::parse(&page.page_url).ok().is_some_and(|u| {
                    u.query_pairs()
                        .any(|(k, v)| k == "_ge_probe" && v == request)
                });
            if same && page.ready {
                return Ok(page);
            }
        }
        if tokio::time::Instant::now() >= deadline {
            return Err("转转详情页读取超时，未取得有效商品价格".into());
        }
        tokio::time::sleep(Duration::from_millis(700)).await;
    }
}
async fn collect_zhuanzhuan(
    app: AppHandle,
    keyword: String,
    raw: String,
) -> (SourceReport, Vec<Listing>) {
    let Some(url) = zhuanzhuan_url(&raw) else {
        return (
            unavailable(
                "zhuanzhuan",
                "转转",
                "https://www.zhuanzhuan.com/",
                "尚未绑定商品分享链接；绑定后免登录读取详情页并核对同款在售商品",
            ),
            Vec::new(),
        );
    };
    let source_url = url.to_string();
    let result: Result<(Vec<Listing>, String), String> = async {
        let label = "domestic-prices-zhuanzhuan";
        let w = if let Some(w) = app.get_webview_window(label) {
            w
        } else {
            WebviewWindowBuilder::new(&app, label, WebviewUrl::External(url.clone()))
                .title("国内二手报价 · 转转")
                .inner_size(1100.0, 800.0)
                .visible(false)
                .build()
                .map_err(|e| e.to_string())?
        };
        let seed = read_zhuanzhuan(&w, &keyword, url).await?;
        let mut items = valid_listings(seed.items, Provider::Zhuanzhuan);
        let Some(first) = items.first() else {
            return Ok((items, seed.message));
        };
        let configuration = zhuanzhuan_configuration(&first.title);
        // 同款卡片没有完整配置：逐页核对型号、内存、容量、版本；颜色保留在样本中。
        for raw in seed.related_urls.into_iter().take(4) {
            let Some(url) = zhuanzhuan_url(&raw) else {
                continue;
            };
            if let Ok(page) = read_zhuanzhuan(&w, &keyword, url).await {
                items.extend(
                    valid_listings(page.items, Provider::Zhuanzhuan)
                        .into_iter()
                        .filter(|i| zhuanzhuan_configuration(&i.title) == configuration),
                );
            }
        }
        Ok((valid_listings(items, Provider::Zhuanzhuan), String::new()))
    }
    .await;
    let (items, detail) = match result {
        Ok(r) => r,
        Err(e) => (Vec::new(), e),
    };
    let mut source = report(Provider::Zhuanzhuan, &keyword, &items, &detail);
    source.url = source_url;
    if source.status == "ok" {
        source.message =
            "分享商品及其同款：逐页核实主售价、型号配置和成色；颜色分别展示，仅代表该配置在售样本"
                .into();
    }
    (source, items)
}
fn zhuanzhuan_configuration(title: &str) -> String {
    let mut value = title.to_lowercase();
    for color in [
        "深空灰色",
        "深空黑色",
        "深空灰",
        "深空黑",
        "午夜色",
        "星光色",
        "天蓝色",
        "银色",
        "金色",
        "黑色",
        "白色",
    ] {
        value = value.replace(color, "");
    }
    value.split_whitespace().collect()
}
/// 各平台中位数等权，避免单个平台样本多就支配整个参考价。
fn reference(sources: &[SourceReport]) -> (Option<f64>, Vec<String>) {
    let mut ids = Vec::new();
    let values: Vec<_> = sources
        .iter()
        .filter(|s| s.status == "ok" && s.count >= 3)
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
    let (nine, xy, jd, zz) = tokio::join!(
        collect(app.clone(), Provider::Nine, query.clone()),
        collect(app.clone(), Provider::Xianyu, query.clone()),
        collect(app.clone(), Provider::Jd, query.clone()),
        collect_zhuanzhuan(app, query.clone(), target.zhuanzhuan_url)
    );
    let mut sources = vec![
        zz.0,
        nine.0,
        xy.0,
        jd.0,
        unavailable(
            "zhaoliangji",
            "找靓机（转转旗下）",
            "https://www.zhaoliangji.com/",
            "官网展示 App 入口，尚未取得公开在售样本；不作为独立有效报价来源",
        ),
    ];
    let listings: Vec<_> = nine
        .1
        .into_iter()
        .chain(xy.1)
        .chain(jd.1)
        .chain(zz.1)
        .collect();
    let (avg, ids) = reference(&sources);
    let coverage = ids.len();
    let count = listings.iter().filter(|i| ids.contains(&i.source)).count();
    let min = listings
        .iter()
        .filter(|i| ids.contains(&i.source))
        .map(|i| i.price)
        .reduce(f64::min);
    let max = listings
        .iter()
        .filter(|i| ids.contains(&i.source))
        .map(|i| i.price)
        .reduce(f64::max);
    let label = if coverage >= 2 {
        "国内多平台参考"
    } else {
        "国内单平台参考"
    };
    let message = if let Some(price) = avg {
        let source = format!("domestic:v1:{}", ids.join("+"));
        state
            .storage
            .add_price_sample(&target_id, price, &source, count as u32)
            .map_err(|e| format!("保存参考价失败：{e}"))?;
        format!("{label} ¥{price:.2}，来自 {coverage} 个有效平台、{count} 条在售样本。按各平台中位数等权计算；配置与成色不同，请核对明细。{}",
            if coverage < 2 { "目前仅一个平台有有效样本，尚不能代表跨平台行情。" } else { "" })
    } else {
        "本次未取得足够的国内公开在售样本，未更新价格。各平台失败原因见下方，不会要求登录，也不会用旧价或海外价替代。".into()
    };
    let source_url = sources
        .iter()
        .find(|s| s.status == "ok")
        .map(|s| s.url.clone())
        .unwrap_or_else(|| Provider::Nine.search(&query).into());
    sources.sort_by_key(|s| s.status != "ok");
    Ok(Summary {
        ok: avg.is_some(),
        needs_verification: false,
        count,
        avg,
        min,
        max,
        ret: String::new(),
        message,
        source: label.into(),
        currency: "CNY".into(),
        source_url,
        query,
        method: "平台内中位数，再对有效平台的中位数等权取中位数".into(),
        coverage,
        sources,
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
        assert_eq!(reference(&[]).0, None);
    }
}
