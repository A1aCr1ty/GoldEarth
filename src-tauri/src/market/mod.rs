//! 行情数据源。
//!
//! - 实时快照、五档盘口：[腾讯](https://qt.gtimg.cn)
//! - 历史 K 线、当日分时、榜单、资金流：[东方财富](https://push2his.eastmoney.com)
//!
//! 抓取在 Rust 侧完成，绕开 WebView 的跨域限制。带一个短 TTL 的内存缓存，
//! 防止页面频繁刷新把公开接口打爆；接口挂了但缓存里有数据时返回缓存，
//! 保证界面不至于整块空掉。

pub mod eastmoney;
pub mod symbol;
pub mod tencent;
pub mod types;

use std::collections::HashMap;
use std::time::{Duration, Instant};

use once_cell::sync::Lazy;
use parking_lot::Mutex;

use types::{Candle, FundFlow, Period, Quote, RankItem, RankKind, Trend};

/// 缓存条目：存原始 JSON，接口换结构了也不会把缓存打穿
static CACHE: Lazy<Mutex<HashMap<String, (Instant, serde_json::Value)>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// 实时行情缓存得短一点，K 线可以留久一点
const TTL_QUOTE: Duration = Duration::from_secs(15);
const TTL_KLINE: Duration = Duration::from_secs(300);

fn cache_get(key: &str, ttl: Duration) -> Option<serde_json::Value> {
    let guard = CACHE.lock();
    let (at, value) = guard.get(key)?;
    if at.elapsed() > ttl {
        return None;
    }
    Some(value.clone())
}

fn cache_put(key: &str, value: &serde_json::Value) {
    let mut guard = CACHE.lock();
    // 顺手清掉过期的，避免长时间运行后无限增长
    guard.retain(|_, (at, _)| at.elapsed() < TTL_KLINE * 4);
    guard.insert(key.to_string(), (Instant::now(), value.clone()));
}

fn client() -> &'static reqwest::Client {
    static CLIENT: Lazy<reqwest::Client> = Lazy::new(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(12))
            .connect_timeout(Duration::from_secs(6))
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
            .build()
            .expect("构建 HTTP 客户端失败")
    });
    &CLIENT
}

/// 腾讯返回 GBK，这里只解码 ASCII 部分——中文名称会变成乱码占位，
/// 但真正要用的数字字段全是 ASCII，不受影响。名称改用东方财富的榜单接口补。
async fn fetch_tencent(codes: &[String]) -> Result<String, String> {
    let q = codes.join(",");
    let text = client()
        .get(format!("https://qt.gtimg.cn/q={q}"))
        .header("Referer", "https://gu.qq.com/")
        .send()
        .await
        .map_err(|e| format!("腾讯行情请求失败：{e}"))?
        .text()
        .await
        .map_err(|e| format!("腾讯行情读取失败：{e}"))?;
    // 只保留 ASCII 可解析的行；非 ASCII 字节会让 UTF-8 解码整体失败，
    // 所以逐字节过滤后再交给解析器。
    Ok(text)
}

async fn fetch_json(url: &str) -> Result<serde_json::Value, String> {
    client()
        .get(url)
        .header("Referer", "https://quote.eastmoney.com/")
        .send()
        .await
        .map_err(|e| format!("东方财富请求失败：{e}"))?
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("东方财富响应解析失败：{e}"))
}

/// 可供用户勾选展示的指数清单。
/// 代码与名称都对着线上接口逐个核过——`sz899050`（北证50）在腾讯接口取不到，已剔除。
pub const AVAILABLE_INDICES: [(&str, &str); 12] = [
    ("sh000001", "上证指数"),
    ("sz399001", "深证成指"),
    ("sz399006", "创业板指"),
    ("sh000688", "科创50"),
    ("sh000300", "沪深300"),
    ("sh000905", "中证500"),
    ("sh000016", "上证50"),
    ("sh000852", "中证1000"),
    ("sz399005", "中小100"),
    ("sh000922", "中证红利"),
    ("sz399295", "创价值"),
    ("sz399106", "深证综指"),
];

/// 默认展示的指数
pub const INDEX_CODES: [&str; 6] = [
    "sh000001", // 上证指数
    "sz399001", // 深证成指
    "sz399006", // 创业板指
    "sh000688", // 科创50
    "sh000300", // 沪深300
    "sh000905", // 中证500
];

/// 批量拉取实时快照
pub async fn quotes(codes: &[String]) -> Result<Vec<Quote>, String> {
    let normalized: Vec<String> = codes.iter().map(|c| symbol::normalize(c)).collect();
    if normalized.is_empty() {
        return Ok(Vec::new());
    }
    let key = format!("q:{}", normalized.join(","));
    if let Some(v) = cache_get(&key, TTL_QUOTE) {
        let out = parse_cached_quotes(&v);
        if !out.is_empty() {
            return Ok(out);
        }
    }
    // 腾讯一次最多给几十个代码，超了会静默截断，所以分批
    let mut all: Vec<Quote> = Vec::new();
    for chunk in normalized.chunks(30) {
        let raw = fetch_tencent(chunk).await?;
        let parsed = tencent::parse_quotes(&sanitize_tencent(&raw));
        all.extend(parsed);
    }
    if all.is_empty() {
        // 实时接口挂了但缓存里有，就用缓存兜底
        if let Some(v) = cache_get(&key, TTL_QUOTE * 20) {
            let cached = parse_cached_quotes(&v);
            if !cached.is_empty() {
                return Ok(cached);
            }
        }
        return Err("腾讯行情返回空数据".into());
    }
    let value = serde_json::to_value(&all).map_err(|e| e.to_string())?;
    cache_put(&key, &value);
    Ok(all)
}

fn parse_cached_quotes(v: &serde_json::Value) -> Vec<Quote> {
    serde_json::from_value(v.clone()).unwrap_or_default()
}

/// 腾讯响应是 GBK，其中中文名称会让整体 UTF-8 解码失败。
/// 这里把非 ASCII 字节替换成 `?`——名称会变成 `?????`，
/// 但所有数字字段完好。名称由 `enrich_names` 用东财补齐。
fn sanitize_tencent(raw: &str) -> String {
    raw.chars()
        .map(|c| if c.is_ascii() { c } else { '\u{fffd}' })
        .collect()
}

/// 用东方财富的接口补齐中文名称（腾讯那条路的名称是乱码）
pub async fn enrich_names(quotes: &mut [Quote]) {
    if quotes.is_empty() {
        return;
    }
    // 东财批量接口一次最多 50 个
    for chunk in quotes.chunks_mut(50) {
        let secids: Vec<String> = chunk
            .iter()
            .map(|q| symbol::secid(&q.code))
            .collect();
        let url = format!(
            "https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids={}&fields=f12,f14",
            secids.join(",")
        );
        if let Ok(v) = fetch_json(&url).await {
            if let Some(list) = v.get("data").and_then(|d| d.get("diff")).and_then(|d| d.as_array()) {
                for q in chunk.iter_mut() {
                    let want = symbol::symbol_of(&q.code);
                    if let Some(hit) = list.iter().find(|d| {
                        d.get("f12").and_then(|x| x.as_str()).map(|s| s == want).unwrap_or(false)
                    }) {
                        if let Some(name) = hit.get("f14").and_then(|x| x.as_str()) {
                            if !name.is_empty() {
                                q.name = name.to_string();
                            }
                        }
                    }
                }
            }
        }
    }
}

/// 拉取 K 线
pub async fn kline(code: &str, period: Period, limit: usize) -> Result<Vec<Candle>, String> {
    let normalized = symbol::normalize(code);
    let key = format!("k:{normalized}:{}:{}", period.klt(), limit);
    if let Some(v) = cache_get(&key, TTL_KLINE) {
        if let Ok(out) = serde_json::from_value::<Vec<Candle>>(v) {
            if !out.is_empty() {
                return Ok(out);
            }
        }
    }
    let url = format!(
        "https://push2his.eastmoney.com/api/qt/stock/kline/get?secid={}&klt={}&fqt=1&lmt={}&end=20500101\
         &fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
        symbol::secid(&normalized),
        period.klt(),
        limit.clamp(30, 5000)
    );
    let v = fetch_json(&url).await?;
    let candles = eastmoney::parse_klines(&v);
    if candles.is_empty() {
        return Err("没有取到 K 线数据".into());
    }
    if let Ok(serialized) = serde_json::to_value(&candles) {
        cache_put(&key, &serialized);
    }
    Ok(candles)
}

/// 当日分时
pub async fn trends(code: &str) -> Result<Trend, String> {
    let normalized = symbol::normalize(code);
    let url = format!(
        "https://push2his.eastmoney.com/api/qt/stock/trends2/get?secid={}&iscr=0&ndays=1\
         &fields1=f1,f2,f3,f4,f5,f6,f7,f8&fields2=f51,f52,f53,f54,f55,f56,f57,f58",
        symbol::secid(&normalized)
    );
    let v = fetch_json(&url).await?;
    let t = eastmoney::parse_trends(&v);
    if t.points.is_empty() {
        return Err("没有取到分时数据".into());
    }
    Ok(t)
}

/// 榜单
pub async fn rankings(kind: RankKind, limit: usize) -> Result<Vec<RankItem>, String> {
    let key = format!("r:{:?}:{limit}", kind);
    if let Some(v) = cache_get(&key, TTL_QUOTE) {
        if let Ok(out) = serde_json::from_value::<Vec<RankItem>>(v) {
            if !out.is_empty() {
                return Ok(out);
            }
        }
    }
    // 沪深 A 股：沪主板/科创 + 深主板/创业板
    let url = format!(
        "https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz={}&po={}&np=1&fltt=2&invt=2&fid={}\
         &fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23\
         &fields=f2,f3,f4,f5,f6,f7,f8,f9,f10,f12,f14,f15,f16,f17,f18,f20,f21,f23,f62",
        limit.clamp(10, 100),
        kind.desc(),
        kind.fid()
    );
    let v = fetch_json(&url).await?;
    let items = eastmoney::parse_ranks(&v);
    if items.is_empty() {
        return Err("没有取到榜单数据".into());
    }
    if let Ok(serialized) = serde_json::to_value(&items) {
        cache_put(&key, &serialized);
    }
    Ok(items)
}

/// 个股资金流
pub async fn fund_flow(code: &str) -> Result<FundFlow, String> {
    let normalized = symbol::normalize(code);
    let url = format!(
        "https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids={}\
         &fields=f12,f14,f62,f184,f66,f69,f72,f75,f78,f81,f84,f87",
        symbol::secid(&normalized)
    );
    let v = fetch_json(&url).await?;
    let list = eastmoney::parse_fund_flow(&v);
    list.into_iter()
        .find(|f| f.code == normalized)
        .ok_or_else(|| "没有取到资金流数据".to_string())
}

/// 用东财批量快照把腾讯缺的中文名称补上
pub async fn quote_with_name(code: &str) -> Result<Quote, String> {
    let mut list = quotes(&[code.to_string()]).await?;
    let one = list
        .pop()
        .ok_or_else(|| format!("没有取到 {code} 的行情"))?;
    let mut one = one;
    enrich_names(std::slice::from_mut(&mut one)).await;
    Ok(one)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_round_trip_respects_ttl() {
        let key = "test:cache";
        assert!(cache_get(key, TTL_QUOTE).is_none());
        let value = serde_json::json!({"hello": "world"});
        cache_put(key, &value);
        assert!(cache_get(key, TTL_QUOTE).is_some());
        assert!(cache_get(key, Duration::from_nanos(0)).is_none(), "过期应读不到");
    }

    #[test]
    fn sanitize_keeps_digits_and_drops_chinese() {
        let raw = "v_sh600519=\"1~贵州茅台~600519~1278.02\";";
        let cleaned = sanitize_tencent(raw);
        assert!(cleaned.contains("1278.02"), "数字必须保留");
        assert!(!cleaned.contains('贵'), "中文必须被替换掉");
    }

    #[tokio::test]
    async fn period_and_code_helpers_line_up() {
        assert_eq!(symbol::secid("sh600519"), "1.600519");
        assert_eq!(Period::Day.klt(), "101");
    }

    /// 打真实公开接口的端到端验证。
    /// 默认跳过（需要联网），用 `cargo test -- --ignored live_fetch` 手动跑。
    #[tokio::test]
    #[ignore = "需要联网"]
    async fn live_fetch_returns_sane_data() {
        // 实时快照 + 中文名称回填
        let mut list = quotes(&["sh600519".into()]).await.expect("腾讯快照");
        enrich_names(&mut list).await;
        let q = &list[0];
        println!("快照: {} {} 现价={} 昨收={} 涨跌={}% 成交额={}", q.name, q.symbol, q.price, q.prev_close, q.change_pct, q.amount);
        assert!(q.price > 100.0 && q.price < 5000.0, "茅台价格区间明显不对: {}", q.price);
        assert_eq!(q.name, "贵州茅台", "中文名称回填失败");
        assert!(q.bids.len() == 5 && q.asks.len() == 5, "五档应有 5 档");
        assert!(q.amount > 1e8, "茅台日成交额不可能低于 1 亿");

        // K 线
        let k = kline("sh600519", Period::Day, 120).await.expect("日K");
        println!("日K {} 根，最后一根: {:?}", k.len(), k.last());
        assert!(k.len() > 100, "K 线数量异常: {}", k.len());
        let last = k.last().unwrap();
        assert!(last.high >= last.low, "K 线内部不自洽");

        // 分时
        let t = trends("sh600519").await.expect("分时");
        println!("分时 {} 个点，昨收={}", t.points.len(), t.pre_close);
        assert!(t.points.len() > 10, "分时点数异常");

        // 榜单
        let r = rankings(RankKind::Gainers, 20).await.expect("涨幅榜");
        println!("涨幅榜首: {} {}", r[0].name, r[0].change_pct);
        assert_eq!(r.len(), 20);
        assert!(r[0].code.starts_with("sh") || r[0].code.starts_with("sz") || r[0].code.starts_with("bj"));

        // 资金流
        let f = fund_flow("sh600519").await.expect("资金流");
        println!("资金流: 主力 {} / 超大 {} / 大 {}", f.main.net, f.super_large.net, f.large.net);
        assert!((f.super_large.net + f.large.net - f.main.net).abs() < 1.0, "资金流分档不自洽");
    }
}