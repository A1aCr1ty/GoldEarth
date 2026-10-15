//! 同花顺财经快讯（7×24 盘面）。
//!
//! `https://news.10jqka.com.cn/tapp/news/push/stock/` 对匿名请求放行，
//! 一页给 30 条：标题、摘要、链接、发布时间都是齐的，是几个财经源里
//! 最贴近「盘面发生了什么」的一个（实测首屏是 Shibor、L 货币供应、
//! 个股异动这类，不像综合财经那样混一堆地方民生新闻）。
//!
//! 实测踩到的两点：
//! - `code` 是**字符串** `"200"`，照数字解会报错，用 `de_loose_i64` 接住。
//! - `source` 字段实测**恒为空**，`picUrl` 也恒为空，所以不展示来源站和封面；
//!   分类标签看 `tag`（逗号串，如 `港股,异动,A股`），只取第一个当角标。

use serde::Deserialize;

use super::http::{client, UA};
use super::types::{de_loose_i64, local_time, HotItem};

const NEWS_URL: &str = "https://news.10jqka.com.cn/tapp/news/push/stock/";

#[derive(Deserialize)]
struct Resp {
    /// 注意是字符串 `"200"`
    #[serde(default, deserialize_with = "de_loose_i64")]
    code: i64,
    #[serde(default)]
    msg: Option<String>,
    #[serde(default)]
    data: Option<Data>,
}

#[derive(Deserialize)]
struct Data {
    #[serde(default)]
    list: Vec<News>,
}

#[derive(Clone, Deserialize)]
struct News {
    #[serde(default)]
    title: String,
    #[serde(default)]
    digest: String,
    #[serde(default)]
    url: String,
    /// unix 秒
    #[serde(default, deserialize_with = "de_loose_i64")]
    ctime: i64,
    /// 逗号串，如 `港股,异动,A股`
    #[serde(default)]
    tag: String,
}

/// 抓同花顺快讯
pub async fn fetch(limit: usize) -> Result<Vec<HotItem>, String> {
    let url = format!(
        "{NEWS_URL}?page=1&tag=&track=website&pagesize={}",
        limit.clamp(1, 50)
    );
    let resp: Resp = client()
        .get(&url)
        .header("User-Agent", UA)
        .header("Referer", "https://news.10jqka.com.cn/")
        .header("Accept", "application/json, text/plain, */*")
        .send()
        .await
        .map_err(|e| format!("请求失败：{e}"))?
        .error_for_status()
        .map_err(|e| {
            format!(
                "同花顺返回 {}：{e}",
                e.status().map(|s| s.as_u16()).unwrap_or(0)
            )
        })?
        .json()
        .await
        .map_err(|e| format!("解析失败：{e}"))?;

    if resp.code != 200 {
        return Err(format!(
            "同花顺接口返回错误：{}{}",
            resp.code,
            resp.msg
                .filter(|m| !m.is_empty())
                .map(|m| format!("（{m}）"))
                .unwrap_or_default()
        ));
    }

    let items: Vec<HotItem> = resp
        .data
        .map(|d| d.list)
        .unwrap_or_default()
        .into_iter()
        .filter_map(convert)
        .take(limit)
        .collect();

    if items.is_empty() {
        return Err("同花顺快讯是空的".to_string());
    }
    Ok(items)
}

fn convert(n: News) -> Option<HotItem> {
    let title = n.title.trim().to_string();
    if title.is_empty() || n.url.trim().is_empty() {
        return None;
    }
    Some(HotItem {
        // 快讯是时间流不是榜单，名次由上层决定不给
        rank: 0,
        title,
        url: n.url,
        // 同花顺实测不带封面图
        cover: String::new(),
        summary: n.digest.trim().to_string(),
        // source 字段恒为空，作者位置留空，不编
        author: String::new(),
        // 没有热度值，但热度文案是空的正好——界面会跳过它
        hot_text: String::new(),
        hot_value: 0,
        tag: n
            .tag
            .split(',')
            .map(str::trim)
            .find(|s| !s.is_empty())
            .unwrap_or("")
            .to_string(),
        meta: local_time(n.ctime),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 2026-10-15 实抓的一条，锁住「code 是字符串」这个坑
    const REAL_ITEM: &str = r#"{
      "code": "200", "msg": "成功", "time": "1792033631",
      "data": { "total": 9615, "list": [ {
        "id": "5393639", "seq": "680720017",
        "title": "长鑫科技总市值跌破3万亿元，工商银行总市值最高个股",
        "digest": "长鑫科技早盘跌超4%，总市值跌破3万亿元，工商银行成总市值最高个股。",
        "url": "https://news.10jqka.com.cn/20261015/c680720017.shtml",
        "ctime": 1792033631, "source": "", "picUrl": "",
        "tag": "港股,异动,A股", "stock": ""
      } ] }
    }"#;

    #[test]
    fn parses_the_real_response() {
        let resp: Resp = serde_json::from_str(REAL_ITEM).unwrap();
        assert_eq!(resp.code, 200, "code 是字符串 \"200\"，不能照数字解");

        let news = resp.data.unwrap().list;
        let item = convert(news[0].clone()).expect("应该能转成条目");
        assert_eq!(
            item.title,
            "长鑫科技总市值跌破3万亿元，工商银行总市值最高个股"
        );
        assert_eq!(
            item.url,
            "https://news.10jqka.com.cn/20261015/c680720017.shtml"
        );
        assert!(item.summary.contains("早盘跌超4%"));
        assert_eq!(item.tag, "港股", "标签是逗号串，取第一个当角标");
        assert!(item.cover.is_empty(), "picUrl 实测恒为空");
        assert!(item.author.is_empty(), "source 实测恒为空，不能编一个");
        assert_eq!(item.rank, 0, "快讯不排名次");
        assert_eq!(item.hot_text, "", "没有热度，别显示热度文案");
        assert!(!item.meta.is_empty(), "meta 要给出时间");
    }

    #[test]
    fn accepts_a_numeric_code_too() {
        let json = r#"{"code":200,"data":{"list":[]}}"#;
        let resp: Resp = serde_json::from_str(json).unwrap();
        assert_eq!(resp.code, 200);
    }

    #[test]
    fn reports_an_error_code_instead_of_a_blank_list() {
        let resp: Resp = serde_json::from_str(r#"{"code":"401","msg":"请登录"}"#).unwrap();
        assert_ne!(resp.code, 200);
    }

    #[test]
    fn drops_entries_without_title_or_url() {
        assert!(convert(News {
            title: "  ".into(),
            url: "https://x".into(),
            ..serde_json::from_str::<News>(r#"{"title":"占位"}"#).unwrap()
        })
        .is_none());
        assert!(convert(News {
            title: "有标题".into(),
            url: String::new(),
            ..serde_json::from_str::<News>(r#"{"title":"占位"}"#).unwrap()
        })
        .is_none());
    }

    #[test]
    fn empty_tag_leaves_no_badge() {
        let item = convert(News {
            title: "标题".into(),
            url: "https://x".into(),
            tag: " , ,".into(),
            ..serde_json::from_str::<News>(r#"{"title":"占位"}"#).unwrap()
        })
        .expect("应该能转成条目");
        assert_eq!(item.tag, "");
    }
}
