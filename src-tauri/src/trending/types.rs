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
    Xueqiu,
    Xiaohongshu,
}

impl Source {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "bilibili" => Some(Source::Bilibili),
            "weibo" => Some(Source::Weibo),
            "xueqiu" => Some(Source::Xueqiu),
            "xiaohongshu" => Some(Source::Xiaohongshu),
            _ => None,
        }
    }

    pub fn id(self) -> &'static str {
        match self {
            Source::Bilibili => "bilibili",
            Source::Weibo => "weibo",
            Source::Xueqiu => "xueqiu",
            Source::Xiaohongshu => "xiaohongshu",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Source::Bilibili => "哔哩哔哩",
            Source::Weibo => "微博",
            Source::Xueqiu => "雪球",
            Source::Xiaohongshu => "小红书",
        }
    }

    /// 首页色标用的十六进制色值，前端直接拿去画圆点 / 进度条
    pub fn accent(self) -> &'static str {
        match self {
            Source::Bilibili => "#fb7299",
            Source::Weibo => "#e6162d",
            Source::Xueqiu => "#ff6600",
            Source::Xiaohongshu => "#ff2442",
        }
    }

    /// 这个平台是不是必须带上用户自己的登录 Cookie 才拿得到数据。
    ///
    /// B 站和微博的榜单接口对匿名请求放行；雪球和小红书都架了登录墙，
    /// 没 Cookie 时前端要显示「需要 Cookie」而不是一个空白榜单。
    pub fn needs_cookie(self) -> bool {
        matches!(self, Source::Xueqiu | Source::Xiaohongshu)
    }

    /// 页面默认展示的平台，按用户给出的顺序
    pub fn all() -> [Source; 4] {
        [
            Source::Bilibili,
            Source::Weibo,
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
        assert_eq!(Source::parse("xueqiu"), Some(Source::Xueqiu));
        assert_eq!(Source::parse("xiaohongshu"), Some(Source::Xiaohongshu));
        assert_eq!(Source::parse("douyin"), None);
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
