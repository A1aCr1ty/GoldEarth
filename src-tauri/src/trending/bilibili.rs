//! 哔哩哔哩热榜。
//!
//! 两个公开接口，都对匿名请求放行（实测带普通 UA + Referer 即可）：
//! - 综合热门 `https://api.bilibili.com/x/web-interface/popular`
//! - 全站排行榜 `https://api.bilibili.com/x/web-interface/ranking/v2`
//!
//! 注意 `search/square`（热搜词）需要 WBI 签名，匿名会返回
//! `code:-400`，所以这里不接，榜单已经够用。

use serde::Deserialize;

use super::http::{client, UA};
use super::types::{compact, duration, day_of, HotItem};

const POPULAR_URL: &str = "https://api.bilibili.com/x/web-interface/popular";
const RANKING_URL: &str = "https://api.bilibili.com/x/web-interface/ranking/v2";

/// 榜单口径
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    /// 综合热门
    Popular,
    /// 全站排行榜
    Ranking,
}

impl Kind {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "popular" | "综合热门" => Some(Kind::Popular),
            "ranking" | "排行榜" => Some(Kind::Ranking),
            _ => None,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Kind::Popular => "综合热门",
            Kind::Ranking => "全站排行榜",
        }
    }
}

#[derive(Deserialize)]
struct Resp {
    code: i32,
    #[serde(default)]
    message: Option<String>,
    data: Option<Data>,
}

#[derive(Deserialize)]
struct Data {
    #[serde(default)]
    list: Vec<Video>,
}

#[derive(Deserialize)]
struct Video {
    bvid: String,
    title: String,
    #[serde(default)]
    pic: String,
    #[serde(default)]
    desc: String,
    #[serde(default)]
    duration: i64,
    #[serde(default)]
    pubdate: i64,
    #[serde(default)]
    tname: String,
    #[serde(default)]
    owner: Owner,
    #[serde(default)]
    stat: Stat,
}

#[derive(Default, Deserialize)]
struct Owner {
    #[serde(default)]
    name: String,
}

#[derive(Default, Deserialize)]
struct Stat {
    #[serde(default)]
    view: i64,
    #[serde(default)]
    like: i64,
    #[serde(default)]
    reply: i64,
}

/// 抓取 B 站榜单
pub async fn fetch(kind: Kind, limit: usize) -> Result<Vec<HotItem>, String> {
    let url = match kind {
        Kind::Popular => format!("{POPULAR_URL}?ps={}&pn=1", limit.clamp(1, 50)),
        Kind::Ranking => format!("{RANKING_URL}?rid=0&type=all"),
    };

    let resp: Resp = client()
        .get(&url)
        .header("User-Agent", UA)
        .header("Referer", "https://www.bilibili.com")
        .header("Accept", "application/json, text/plain, */*")
        .send()
        .await
        .map_err(|e| format!("请求失败：{e}"))?
        .error_for_status()
        .map_err(|e| format!("B 站返回 {}：{e}", e.status().map(|s| s.as_u16()).unwrap_or(0)))?
        .json()
        .await
        .map_err(|e| format!("解析失败：{e}"))?;

    if resp.code != 0 {
        return Err(format!(
            "B 站接口返回错误：{}{}",
            resp.code,
            resp.message
                .filter(|m| !m.is_empty())
                .map(|m| format!("（{m}）"))
                .unwrap_or_default()
        ));
    }

    let list = resp.data.map(|d| d.list).unwrap_or_default();
    if list.is_empty() {
        return Err("B 站返回了空榜单".to_string());
    }

    Ok(list
        .into_iter()
        .take(limit)
        .enumerate()
        .map(|(i, v)| convert(i + 1, v))
        .collect())
}

fn convert(rank: usize, v: Video) -> HotItem {
    let mins = duration(v.duration);
    let day = day_of(v.pubdate);
    HotItem {
        rank,
        title: v.title,
        // pic 常带 http://，统一升到 https，免得在打包版里触发混合内容拦截
        url: format!("https://www.bilibili.com/video/{}", v.bvid),
        cover: v.pic.replace("http://", "https://"),
        summary: v.desc,
        author: v.owner.name,
        hot_text: format!(
            "{}播放 · {}点赞 · {}评论",
            compact(v.stat.view),
            compact(v.stat.like),
            compact(v.stat.reply)
        ),
        hot_value: v.stat.view,
        tag: v.tname,
        meta: [mins, day]
            .into_iter()
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join(" · "),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_kind() {
        assert_eq!(Kind::parse("popular"), Some(Kind::Popular));
        assert_eq!(Kind::parse("ranking"), Some(Kind::Ranking));
        assert_eq!(Kind::parse("综合热门"), Some(Kind::Popular));
        assert_eq!(Kind::parse("whatever"), None);
    }

    #[test]
    fn maps_video_fields_into_hot_item() {
        let v = Video {
            bvid: "BV1fspq6cEty".into(),
            title: "标题".into(),
            pic: "http://i2.hdslb.com/a.jpg".into(),
            desc: "简介".into(),
            duration: 814,
            pubdate: 1_791_948_600,
            tname: "手机游戏".into(),
            owner: Owner {
                name: "明日方舟终末地".into(),
            },
            stat: Stat {
                view: 1_973_867,
                like: 89_957,
                reply: 9_466,
            },
        };
        let item = convert(1, v);
        assert_eq!(item.url, "https://www.bilibili.com/video/BV1fspq6cEty");
        assert_eq!(item.cover, "https://i2.hdslb.com/a.jpg", "封面要升到 https");
        assert_eq!(item.hot_text, "197.4万播放 · 9.0万点赞 · 9466评论");
        assert_eq!(item.hot_value, 1_973_867);
        assert_eq!(item.tag, "手机游戏");
        assert_eq!(item.meta, "13:34 · 2026-10-14");
    }
}
