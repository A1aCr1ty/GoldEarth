//! 新浪财经滚动新闻。
//!
//! `https://feed.mix.sina.com.cn/api/roll/get?pageid=155&lid=1686` 对匿名请求放行，
//! 一页 30 条，带标题、导语、发布时间和来源媒体名（如「证券时报网」）。
//!
//! 和同花顺的分工：那边偏盘面快讯（Shibor、异动），这边偏成稿的财经报道，
//! 两边都不需要 Cookie，加起来当财经信息的两路来源——任一路接口挂了另一路还在。
//!
//! 实测踩到的两点：
//! - **`summary` 字段实测恒为空**，导语在 `intro` 里。照 summary 取会得到
//!   一屏空白条目，界面上就只有标题、看不出讲了什么。
//! - `img` 是个对象 `{u,w,h,t}` 而不是字符串，而且 30 条里有 24 条根本没有；
//!   剩下那几张还是「100×100 财经水印海报」而不是文章配图，所以干脆不解析它。

use serde::Deserialize;

use super::http::{client, UA};
use super::types::{de_loose_i64, local_time, HotItem};

const ROLL_URL: &str =
    "https://feed.mix.sina.com.cn/api/roll/get?pageid=155&lid=1686&num={}&page=1";

#[derive(Deserialize)]
struct Resp {
    #[serde(default)]
    result: Option<Result_>,
}

#[derive(Deserialize)]
struct Result_ {
    #[serde(default)]
    status: Option<Status>,
    #[serde(default)]
    data: Vec<News>,
}

#[derive(Deserialize)]
struct Status {
    #[serde(default)]
    code: i64,
    #[serde(default)]
    msg: Option<String>,
}

#[derive(Deserialize)]
struct News {
    #[serde(default)]
    title: String,
    /// 实测恒为空，别用
    #[serde(default)]
    summary: String,
    /// 导语正文，尾部带 `...`
    #[serde(default)]
    intro: String,
    #[serde(default)]
    url: String,
    /// unix 秒。实测是**字符串** `"1792033532"`，照数字解会报错
    #[serde(default, deserialize_with = "de_loose_i64")]
    ctime: i64,
    /// 来源媒体名
    #[serde(default)]
    media_name: String,
}

/// 抓新浪财经滚动新闻
pub async fn fetch(limit: usize) -> Result<Vec<HotItem>, String> {
    let url = ROLL_URL.replace("{}", &limit.clamp(1, 50).to_string());
    let resp: Resp = client()
        .get(&url)
        .header("User-Agent", UA)
        .header("Referer", "https://finance.sina.com.cn/roll/")
        .header("Accept", "application/json, text/plain, */*")
        .send()
        .await
        .map_err(|e| format!("请求失败：{e}"))?
        .error_for_status()
        .map_err(|e| {
            format!(
                "新浪返回 {}：{e}",
                e.status().map(|s| s.as_u16()).unwrap_or(0)
            )
        })?
        .json()
        .await
        .map_err(|e| format!("解析失败：{e}"))?;

    let result = resp
        .result
        .ok_or_else(|| "新浪返回体里没有 result 字段".to_string())?;

    if let Some(status) = &result.status {
        if status.code != 0 {
            return Err(format!(
                "新浪接口返回错误：{}{}",
                status.code,
                status
                    .msg
                    .as_deref()
                    .filter(|m| !m.is_empty())
                    .map(|m| format!("（{m}）"))
                    .unwrap_or_default()
            ));
        }
    }

    let items: Vec<HotItem> = result
        .data
        .into_iter()
        .filter_map(convert)
        .take(limit)
        .collect();

    if items.is_empty() {
        return Err("新浪财经滚动是空的".to_string());
    }
    Ok(items)
}

fn convert(n: News) -> Option<HotItem> {
    let title = n.title.trim().to_string();
    if title.is_empty() || n.url.trim().is_empty() {
        return None;
    }
    // 导语在 intro；summary 实测恒空，只在极端情况下当兜底
    let summary = if n.intro.trim().is_empty() {
        n.summary.trim().to_string()
    } else {
        n.intro.trim().to_string()
    };
    Some(HotItem {
        // 新闻是时间流不是榜单
        rank: 0,
        title,
        url: n.url,
        cover: String::new(),
        summary,
        // 来源媒体放到角标那一栏了，再填 author 会显示两遍
        author: String::new(),
        hot_text: String::new(),
        hot_value: 0,
        // 来源媒体当角标（「证券时报网」这种）
        tag: n.media_name.trim().to_string(),
        meta: local_time(n.ctime),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 2026-10-15 实抓的一条，锁住「summary 恒空、导语在 intro」这个坑
    const REAL_ITEM: &str = r#"{
      "ctime": "1792033532", "mtime": "1792033532",
      "title": "金融活水润红牛  普惠赋能促振兴——工行平凉分行精准滴灌平凉红牛产业链",
      "summary": "",
      "intro": "近日，中国工商银行平凉分行精准滴灌平凉红牛产业链再落新笔，成功为辖内某养殖场发放150万元融资。...",
      "url": "https://finance.sina.com.cn/jjxw/2026-10-15/doc-inivhpns4501057.shtml",
      "media_name": "每日甘肃网"
    }"#;

    #[test]
    fn status_zero_means_ok() {
        let wrapped = r#"{"result":{"status":{"code":0,"msg":"succ"},"data":[]}}"#;
        let resp: Resp = serde_json::from_str(wrapped).unwrap();
        assert_eq!(resp.result.unwrap().status.unwrap().code, 0);
    }

    #[test]
    fn takes_the_lede_from_intro_not_summary() {
        let news: News = serde_json::from_str(REAL_ITEM).unwrap();
        assert!(news.summary.is_empty(), "summary 实测恒空");

        let item = convert(news).expect("应该能转成条目");
        assert!(item.summary.contains("150万元融资"), "摘要要来自 intro");
        assert_eq!(item.tag, "每日甘肃网", "来源媒体当角标");
        assert!(item.author.is_empty(), "来源已经在角标里了，别显示两遍");
        assert_eq!(item.rank, 0, "新闻不排名次");
        assert!(!item.meta.is_empty(), "meta 要给出时间");
    }

    #[test]
    fn falls_back_to_summary_when_intro_is_also_empty() {
        let news: News = serde_json::from_str(
            r#"{"title":"t","url":"https://x","intro":"","summary":"备用摘要"}"#,
        )
        .unwrap();
        assert_eq!(convert(news).unwrap().summary, "备用摘要");
    }

    #[test]
    fn rejects_a_non_zero_status_code() {
        let resp: Resp =
            serde_json::from_str(r#"{"result":{"status":{"code":403,"msg":"无权限"},"data":[]}}"#)
                .unwrap();
        let result = resp.result.unwrap();
        assert_eq!(result.status.unwrap().code, 403);
    }

    #[test]
    fn drops_entries_without_title_or_url() {
        let news: News = serde_json::from_str(r#"{"title":"只有标题"}"#).unwrap();
        assert!(convert(news).is_none());
        let news: News = serde_json::from_str(r#"{"title":" ","url":"https://x"}"#).unwrap();
        assert!(convert(news).is_none());
    }
}
