//! 冲浪热榜的统一数据模型。
//!
//! 四个平台的原始结构差别很大（B 站有封面、播放量和 UP 主，微博热搜只有
//! 词条和热度，雪球/小红书又各有各的鉴权方式），这里收敛成同一套
//! `HotItem`，前端一个列表组件就能渲染所有平台，平台差异留在 fetcher 里。
//!
//! 约定：抓取放 Rust 侧完成，绕开 WebView 跨域；热度文案由后端拼好
//! （`hot_text`），前端只负责展示，不再做单位换算。

use serde::{Deserialize, Serialize};

/// 支持的平台
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Source {
    Bilibili,
    Weibo,
    Baidu,
    /// 同花顺财经快讯（7×24 盘面）
    ThsNews,
    /// 新浪财经滚动新闻
    SinaFinance,
    Xueqiu,
    Xiaohongshu,
}

impl Source {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "bilibili" => Some(Source::Bilibili),
            "weibo" => Some(Source::Weibo),
            "baidu" => Some(Source::Baidu),
            "ths" => Some(Source::ThsNews),
            "sina" => Some(Source::SinaFinance),
            "xueqiu" => Some(Source::Xueqiu),
            "xiaohongshu" => Some(Source::Xiaohongshu),
            _ => None,
        }
    }

    pub fn id(self) -> &'static str {
        match self {
            Source::Bilibili => "bilibili",
            Source::Weibo => "weibo",
            Source::Baidu => "baidu",
            Source::ThsNews => "ths",
            Source::SinaFinance => "sina",
            Source::Xueqiu => "xueqiu",
            Source::Xiaohongshu => "xiaohongshu",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Source::Bilibili => "哔哩哔哩",
            Source::Weibo => "微博",
            Source::Baidu => "百度热搜",
            Source::ThsNews => "同花顺快讯",
            Source::SinaFinance => "新浪财经",
            Source::Xueqiu => "雪球",
            Source::Xiaohongshu => "小红书",
        }
    }

    /// 首页色标用的十六进制色值，前端直接拿去画圆点 / 进度条
    pub fn accent(self) -> &'static str {
        match self {
            Source::Bilibili => "#fb7299",
            Source::Weibo => "#e6162d",
            Source::Baidu => "#2932e1",
            Source::ThsNews => "#f39800",
            Source::SinaFinance => "#c62f2f",
            Source::Xueqiu => "#ff6600",
            Source::Xiaohongshu => "#ff2442",
        }
    }

    /// 这是不是**榜单**：榜单有名次，时间流（财经快讯 / 新闻）没有。
    ///
    /// 榜单的条目按返回顺序编 1、2、3…，前三条还会用色标强调；
    /// 时间流那样编会让人误以为是热度排名，所以不编，界面也就不显示序号。
    pub fn ranked(self) -> bool {
        matches!(self, Source::Bilibili | Source::Weibo | Source::Baidu)
    }

    /// 旧 HTTP 抓取器的鉴权要求；网页会话入口不使用手动 Cookie。
    pub fn needs_cookie(self) -> bool {
        matches!(self, Source::Xueqiu | Source::Xiaohongshu)
    }

    pub fn uses_browser(self) -> bool {
        matches!(self, Source::Xueqiu | Source::Xiaohongshu)
    }

    /// 页面上要展示的平台。雪球和小红书通过应用内网页会话读取推荐。
    pub fn all() -> [Source; 7] {
        [
            Source::Bilibili,
            Source::Weibo,
            Source::Baidu,
            Source::ThsNews,
            Source::SinaFinance,
            Source::Xueqiu,
            Source::Xiaohongshu,
        ]
    }

    /// 从设置里取该平台的 Cookie
    pub fn cookie_of(self, settings: &crate::db::models::AppSettings) -> &str {
        match self {
            Source::Xueqiu => settings.xueqiu_cookie.as_str(),
            Source::Xiaohongshu => settings.xiaohongshu_cookie.as_str(),
            _ => "",
        }
    }
}

/// 榜单里的一条
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HotItem {
    /// 展示用名次，从 1 开始
    pub rank: usize,
    pub title: String,
    /// 点击时用系统浏览器打开
    pub url: String,
    /// 封面图；纯文字榜单（如微博热搜）为空串
    pub cover: String,
    /// 简介 / 摘要
    pub summary: String,
    /// 作者（UP 主、博主、发帖人）
    pub author: String,
    /// 热度展示文案，如「197.4万 播放 · 9.0万 点赞」
    pub hot_text: String,
    /// 原始热度数值，用于比较和排序
    pub hot_value: i64,
    /// 平台自己的标签（B 站分区、微博的「新 / 爆」角标）
    pub tag: String,
    /// 附加信息（B 站时长、视频发布日期等）
    pub meta: String,
}

/// 单个平台的抓取结果。
///
/// 刻意不用 `Result`：一个平台挂掉不应该拖垮整页，
/// 失败信息塞进 `error`，卡片自己显示降级提示。
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HotBoard {
    pub source: String,
    pub label: String,
    pub accent: String,
    /// 抓取时间（RFC3339）
    pub updated_at: String,
    pub items: Vec<HotItem>,
    /// 出错时的说明；成功时为空
    pub error: Option<String>,
    /// 平台本身要 Cookie，但用户还没填
    pub needs_cookie: bool,
    /// 数据来自缓存（TTL 内重复刷新命中），前端可以标成「已缓存」
    pub cached: bool,
}

impl HotBoard {
    pub fn failed(source: Source, message: impl Into<String>, needs_cookie: bool) -> Self {
        Self {
            source: source.id().to_string(),
            label: source.label().to_string(),
            accent: source.accent().to_string(),
            updated_at: now_rfc3339(),
            items: Vec::new(),
            error: Some(message.into()),
            needs_cookie,
            cached: false,
        }
    }
}

/// 抓取时间统一用 RFC3339，前端按本地时区显示
pub fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// 大数字压成「197.4万」这种中文习惯的写法
pub fn compact(n: i64) -> String {
    let v = n as f64;
    if v.abs() >= 100_000_000.0 {
        format!("{:.1}亿", v / 100_000_000.0)
    } else if v.abs() >= 10_000.0 {
        format!("{:.1}万", v / 10_000.0)
    } else {
        format!("{}", n)
    }
}

/// 秒数转 `mm:ss` / `h:mm:ss`
pub fn duration(secs: i64) -> String {
    if secs <= 0 {
        return String::new();
    }
    let h = secs / 3600;
    let m = (secs % 3600) / 60;
    let s = secs % 60;
    if h > 0 {
        format!("{h}:{m:02}:{s:02}")
    } else {
        format!("{m}:{s:02}")
    }
}

/// 有些接口同一个字段时而给数字、时而给字符串——百度的 `hotScore` 是
/// `"7809527"`，同花顺快讯的 `code` 是 `"200"`。照单一类型解会整页报错，
/// 这里两种都接住；实在认不出来就当 0（别为一个展示字段让整块卡片挂掉）。
pub fn de_loose_i64<'de, D: serde::Deserializer<'de>>(d: D) -> Result<i64, D::Error> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Num {
        Int(i64),
        Str(String),
    }
    Ok(match Num::deserialize(d)? {
        Num::Int(n) => n,
        Num::Str(s) => s.trim().parse().unwrap_or(0),
    })
}

/// unix 秒 → 当地时间的 `14:07`；不是今天就补上月日 `10-13 14:07`。
///
/// 财经快讯按「几点的消息」看更有用，所以走本地时区而不是 UTC。
pub fn local_time(ts: i64) -> String {
    let Some(dt) = chrono::DateTime::from_timestamp(ts, 0) else {
        return String::new();
    };
    let local = dt.with_timezone(&chrono::Local);
    if local.date_naive() == chrono::Local::now().date_naive() {
        local.format("%H:%M").to_string()
    } else {
        local.format("%m-%d %H:%M").to_string()
    }
}

/// 只编码 URL 查询串里真正会出事的几个字符，够用且不引额外依赖
pub fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => out.push(ch),
            _ => {
                let mut buf = [0u8; 4];
                for byte in ch.encode_utf8(&mut buf).as_bytes() {
                    out.push_str(&format!("%{byte:02X}"));
                }
            }
        }
    }
    out
}

/// unix 秒 → `2026-10-14`
pub fn day_of(ts: i64) -> String {
    chrono::DateTime::from_timestamp(ts, 0)
        .map(|dt| dt.format("%Y-%m-%d").to_string())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_every_supported_source() {
        assert_eq!(Source::parse("bilibili"), Some(Source::Bilibili));
        assert_eq!(Source::parse("weibo"), Some(Source::Weibo));
        assert_eq!(Source::parse("baidu"), Some(Source::Baidu));
        assert_eq!(Source::parse("ths"), Some(Source::ThsNews));
        assert_eq!(Source::parse("sina"), Some(Source::SinaFinance));
        assert_eq!(Source::parse("xueqiu"), Some(Source::Xueqiu));
        assert_eq!(Source::parse("xiaohongshu"), Some(Source::Xiaohongshu));
        assert_eq!(Source::parse("douyin"), None);
    }

    #[test]
    fn encodes_reserved_characters() {
        assert_eq!(urlencode("a b"), "a%20b");
        assert_eq!(urlencode("#a#"), "%23a%23");
        assert_eq!(urlencode("中文"), "%E4%B8%AD%E6%96%87");
        assert_eq!(urlencode("ok-_.~"), "ok-_.~");
    }

    #[test]
    fn online_sources_are_unique_and_labelled() {
        // 页面上的卡片直接按这个数组渲染，标识重了前端会互相覆盖
        let ids: Vec<&str> = Source::all().iter().map(|s| s.id()).collect();
        let mut uniq = ids.clone();
        uniq.sort();
        uniq.dedup();
        assert_eq!(ids.len(), uniq.len(), "平台标识不能重复：{ids:?}");

        assert_eq!(
            ids,
            vec![
                "bilibili",
                "weibo",
                "baidu",
                "ths",
                "sina",
                "xueqiu",
                "xiaohongshu"
            ]
        );
        for s in Source::all() {
            assert!(!s.label().is_empty() && s.accent().starts_with('#'));
            assert_eq!(
                s.uses_browser(),
                matches!(s, Source::Xueqiu | Source::Xiaohongshu)
            );
        }
    }

    #[test]
    fn only_real_rankings_get_ranks() {
        // 财经快讯 / 新闻是时间流，编名次会让人误当成热度排名
        assert!(Source::Bilibili.ranked() && Source::Weibo.ranked() && Source::Baidu.ranked());
        assert!(!Source::ThsNews.ranked(), "同花顺快讯是时间流");
        assert!(!Source::SinaFinance.ranked(), "新浪财经是时间流");
    }

    #[test]
    fn loose_numbers_accept_both_quotes_and_bare() {
        #[derive(Deserialize)]
        struct Probe {
            #[serde(deserialize_with = "de_loose_i64")]
            n: i64,
        }
        let quoted: Probe = serde_json::from_str(r#"{"n":"7809527"}"#).unwrap();
        assert_eq!(quoted.n, 7_809_527);
        let bare: Probe = serde_json::from_str(r#"{"n":7809527}"#).unwrap();
        assert_eq!(bare.n, 7_809_527);
        // 认不出来就当 0，别为一个展示字段让整块卡片挂掉
        let junk: Probe = serde_json::from_str(r#"{"n":"N/A"}"#).unwrap();
        assert_eq!(junk.n, 0);
    }

    #[test]
    fn local_time_is_short_for_today_and_dated_otherwise() {
        // 不写死具体时刻：断言的是形状，跟运行机器的时区无关
        let now = chrono::Local::now().timestamp();
        let today = local_time(now);
        assert_eq!(today.len(), 5, "今天只给 HH:MM，实际：{today}");
        assert!(today.contains(':'), "实际：{today}");

        let old = local_time(now - 3 * 24 * 3600);
        assert!(old.contains('-'), "三天前要带日期，实际：{old}");
        assert!(old.len() > today.len());
    }

    #[test]
    fn cookie_gated_sources_are_marked() {
        assert!(!Source::Bilibili.needs_cookie());
        assert!(!Source::Weibo.needs_cookie());
        assert!(Source::Xueqiu.needs_cookie());
        assert!(Source::Xiaohongshu.needs_cookie());
    }

    #[test]
    fn formats_chinese_compact_numbers() {
        assert_eq!(compact(999), "999");
        assert_eq!(compact(18_645), "1.9万");
        assert_eq!(compact(1_973_867), "197.4万");
        assert_eq!(compact(1_973_867_000), "19.7亿");
    }

    #[test]
    fn formats_durations() {
        assert_eq!(duration(0), "");
        assert_eq!(duration(61), "1:01");
        assert_eq!(duration(814), "13:34");
        assert_eq!(duration(3661), "1:01:01");
    }

    #[test]
    fn item_serializes_camel_case() {
        let item = HotItem {
            hot_value: 12,
            hot_text: "1.2万".into(),
            ..Default::default()
        };
        let v = serde_json::to_value(&item).unwrap();
        assert_eq!(v["hotValue"], 12);
        assert_eq!(v["hotText"], "1.2万");
        assert!(v.get("hot_value").is_none());
    }
}
