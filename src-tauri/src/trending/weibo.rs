//! 微博热搜榜。
//!
//! `https://weibo.com/ajax/side/hotSearch` 对匿名请求直接放行（实测
//! `ok:1`，带约 50 条词条），比 `m.weibo.cn` 那套稳——后者会跳
//! 新浪访客系统。所以这里用 ajax 接口。

use serde::Deserialize;

use super::http::{client, UA};
use super::types::{compact, HotItem};

const HOT_SEARCH_URL: &str = "https://weibo.com/ajax/side/hotSearch";

#[derive(Deserialize)]
struct Resp {
    #[serde(default)]
    ok: i32,
    data: Option<Data>,
}

#[derive(Deserialize)]
struct Data {
    /// 置顶的时政条目，结构同下面的词条
    #[serde(default)]
    hotgov: Option<Word>,
    #[serde(default)]
    realtime: Vec<Word>,
}

#[derive(Default, Deserialize)]
struct Word {
    #[serde(default)]
    word: Option<String>,
    /// 同一条热搜的不同展示形态，优先用 word，word 为空时退回它
    #[serde(default)]
    note: Option<String>,
    /// 热度数值
    #[serde(default)]
    num: Option<i64>,
    /// 官方给的名次，0 表示未上榜
    #[serde(default)]
    rank: Option<i64>,
    /// 真实展示位次，比 rank 更可靠
    #[serde(default)]
    realpos: Option<i64>,
    /// 「新」「热」「爆」角标
    #[serde(default)]
    icon_desc: Option<String>,
    #[serde(default)]
    label_name: Option<String>,
    /// 1 表示是广告，要过滤掉
    #[serde(default)]
    is_ad: Option<i64>,
    #[serde(default)]
    category: Option<String>,
}

impl Word {
    fn text(&self) -> String {
        self.word
            .as_deref()
            .or(self.note.as_deref())
            .unwrap_or("")
            .trim()
            .to_string()
    }

    fn badge(&self) -> String {
        self.icon_desc
            .as_deref()
            .or(self.label_name.as_deref())
            .unwrap_or("")
            .trim()
            .to_string()
    }
}

/// 抓取微博热搜
pub async fn fetch(limit: usize) -> Result<Vec<HotItem>, String> {
    let resp: Resp = client()
        .get(HOT_SEARCH_URL)
        .header("User-Agent", UA)
        .header("Referer", "https://weibo.com")
        .header("Accept", "application/json, text/plain, */*")
        .send()
        .await
        .map_err(|e| format!("请求失败：{e}"))?
        .error_for_status()
        .map_err(|e| format!("微博返回 {}：{e}", e.status().map(|s| s.as_u16()).unwrap_or(0)))?
        .json()
        .await
        .map_err(|e| format!("解析失败：{e}"))?;

    if resp.ok != 1 {
        return Err("微博接口未放行（ok != 1），可能需要 Cookie".to_string());
    }

    let data = resp
        .data
        .ok_or_else(|| "微博返回体里没有 data 字段".to_string())?;

    // 置顶的时政条目排最前，其余按 realpos 排序；广告直接丢掉
    let mut words: Vec<Word> = Vec::new();
    if let Some(gov) = data.hotgov {
        words.push(gov);
    }
    words.extend(data.realtime.into_iter().filter(|w| w.is_ad != Some(1)));

    words.sort_by_key(|w| w.realpos.or(w.rank).unwrap_or(i64::MAX));

    let items: Vec<HotItem> = words
        .into_iter()
        .filter_map(|w| convert(w))
        .take(limit)
        .collect();

    if items.is_empty() {
        return Err("微博热搜是空的".to_string());
    }
    Ok(items)
}

fn convert(w: Word) -> Option<HotItem> {
    let text = w.text();
    if text.is_empty() {
        return None;
    }
    // 官方词条自带 #（如 #话题#），普通词条要自己包一层
    let query = if text.starts_with('#') && text.ends_with('#') {
        text.clone()
    } else {
        format!("#{text}#")
    };
    let hot = w.num.unwrap_or(0);

    Some(HotItem {
        rank: 0,
        title: text,
        url: format!(
            "https://s.weibo.com/weibo?q={}",
            urlencode(&query)
        ),
        cover: String::new(),
        summary: String::new(),
        author: String::new(),
        hot_text: if hot > 0 {
            format!("{} 热度", compact(hot))
        } else {
            String::new()
        },
        hot_value: hot,
        tag: w.badge(),
        meta: w.category.unwrap_or_default(),
    })
}

/// 只编码 URL 查询串里真正会出事的几个字符，够用且不引额外依赖
fn urlencode(s: &str) -> String {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wraps_plain_words_with_hashtags() {
        let item = convert(Word {
            word: Some("入职第一天因截图社死".into()),
            num: Some(1_442_360),
            realpos: Some(3),
            icon_desc: Some("新".into()),
            ..Default::default()
        })
        .expect("应该有条目");

        assert_eq!(item.title, "入职第一天因截图社死");
        assert!(item.url.contains("%23"), "井号要转义");
        assert!(item.url.ends_with("%23"));
        assert_eq!(item.hot_text, "144.2万 热度");
        assert_eq!(item.hot_value, 1_442_360);
        assert_eq!(item.tag, "新");
    }

    #[test]
    fn keeps_official_hashtag_and_falls_back_to_note() {
        let item = convert(Word {
            word: Some("#加粗话题#".into()),
            note: None,
            ..Default::default()
        })
        .expect("应该有条目");
        assert!(!item.url.contains("%23%23"), "自带井号不要再包一层");

        let fallback = convert(Word {
            word: None,
            note: Some("备注文案".into()),
            ..Default::default()
        })
        .expect("word 空时退回 note");
        assert_eq!(fallback.title, "备注文案");
    }

    #[test]
    fn drops_empty_words() {
        assert!(convert(Word::default()).is_none());
    }

    #[test]
    fn encodes_reserved_characters() {
        assert_eq!(urlencode("a b"), "a%20b");
        assert_eq!(urlencode("#a#"), "%23a%23");
        assert_eq!(urlencode("中文"), "%E4%B8%AD%E6%96%87");
        assert_eq!(urlencode("ok-_.~"), "ok-_.~");
    }
}
