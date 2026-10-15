//! 百度热搜榜。
//!
//! `https://top.baidu.com/api/board?platform=pc&tab=realtime` 对匿名请求直接放行，
//! 不用 Cookie、不用签名，实测一次给 50 条，带热度数值、摘要和封面图——
//! 是这几个平台里字段最全、也最省事的一个。
//!
//! 两个实测出来的坑：
//! - **必须用 `platform=pc`**。`platform=wise`（移动端）那份每条只有
//!   `word` / `url` / `image` 三个字段，热度和摘要都没有。
//! - **`hotScore` 是字符串不是数字**（`"7809527"`），照数字解析会整页失败。
//!   见 [`de_score`]，两种写法都接住。

use serde::Deserialize;

use super::http::{client, UA};
use super::types::{compact, de_loose_i64, urlencode, HotItem};

const BOARD_URL: &str = "https://top.baidu.com/api/board?platform=pc&tab=realtime";

#[derive(Deserialize)]
struct Resp {
    #[serde(default)]
    success: Option<bool>,
    #[serde(default)]
    data: Option<Data>,
}

#[derive(Deserialize)]
struct Data {
    #[serde(default)]
    cards: Vec<Card>,
}

#[derive(Deserialize)]
struct Card {
    /// pc 版这一层直接就是条目；别的卡片类型这层可能是别的东西，
    /// 反正 `convert` 会把没有词条的过滤掉
    #[serde(default)]
    content: Vec<Entry>,
}

#[derive(Clone, Deserialize)]
struct Entry {
    word: String,
    #[serde(default)]
    desc: String,
    /// `hotScore` 实测是字符串，但接口偶尔也给数字，解析方式见
    /// [`de_loose_i64`](super::types::de_loose_i64)，认不出来就当 0
    #[serde(default, rename = "hotScore", deserialize_with = "de_loose_i64")]
    hot_score: i64,
    /// 角标码，文字由 [`tag_label`] 映射
    #[serde(default, rename = "hotTag")]
    hot_tag: String,
    #[serde(default)]
    img: String,
    #[serde(default)]
    raw_url: String,
}

/// 角标码 → 文字。对着接口给的角标图（`hotTagImg`）逐个看过：
/// `1` 是红色「新」，`3` 是橙色「热」，`0` 表示没有角标。
fn tag_label(code: &str) -> &'static str {
    match code.trim() {
        "1" => "新",
        "3" => "热",
        _ => "",
    }
}

/// 抓百度热搜
pub async fn fetch(limit: usize) -> Result<Vec<HotItem>, String> {
    let resp: Resp = client()
        .get(BOARD_URL)
        .header("User-Agent", UA)
        .header("Referer", "https://top.baidu.com/board")
        .header("Accept", "application/json, text/plain, */*")
        .send()
        .await
        .map_err(|e| format!("请求失败：{e}"))?
        .error_for_status()
        .map_err(|e| {
            format!(
                "百度返回 {}：{e}",
                e.status().map(|s| s.as_u16()).unwrap_or(0)
            )
        })?
        .json()
        .await
        .map_err(|e| format!("解析失败：{e}"))?;

    if resp.success == Some(false) {
        return Err("百度热搜接口返回 success: false".to_string());
    }

    // 实测只有一张卡，但别把结构写死：多张就按顺序摊平
    let entries: Vec<Entry> = resp
        .data
        .map(|d| d.cards)
        .unwrap_or_default()
        .into_iter()
        .flat_map(|c| c.content)
        .collect();

    let items: Vec<HotItem> = entries
        .into_iter()
        .filter_map(convert)
        .take(limit)
        .collect();

    if items.is_empty() {
        return Err("百度热搜返回了空列表".to_string());
    }
    Ok(items)
}

fn convert(e: Entry) -> Option<HotItem> {
    let title = e.word.trim().to_string();
    if title.is_empty() {
        return None;
    }
    // raw_url 是 baidu.com/s?wd=… 的搜索链接；万一没给就按词条自己拼一个，
    // 免得点进去是空白页
    let url = match e.raw_url.trim() {
        "" => format!("https://www.baidu.com/s?wd={}", urlencode(&title)),
        u => u.to_string(),
    };
    let hot = e.hot_score;

    Some(HotItem {
        // 名次统一由上层按返回顺序编
        rank: 0,
        title,
        url,
        cover: e.img.replace("http://", "https://"),
        summary: e.desc.trim().to_string(),
        author: String::new(),
        hot_text: if hot > 0 {
            format!("{} 热度", compact(hot))
        } else {
            String::new()
        },
        hot_value: hot,
        tag: tag_label(&e.hot_tag).to_string(),
        meta: String::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 2026-10-15 实抓的响应片段，锁住「hotScore 是字符串」这个坑：
    /// 照数字解析会整页报「invalid type: string」，而它随时可能变回数字
    const REAL_SNIPPET: &str = r#"{
      "success": true,
      "data": { "cards": [ { "component": "tabTextList", "content": [
        { "index": 0, "word": "以后办退休只需一张身份证",
          "desc": "10月10日，人社部宣布全面推进退休预服务",
          "hotScore": "7809527", "hotTag": "3",
          "img": "https://fyb-2.cdn.bcebos.com/hotboard_image/b8c7.jpg",
          "rawUrl": "https://www.baidu.com/s?wd=%E4%BB%A5%E5%90%8E",
          "show": 1, "url": "https://www.baidu.com/s?wd=%E4%BB%A5%E5%90%8E" },
        { "index": 1, "word": "DeepSeek崩了", "desc": "",
          "hotScore": "5103512", "hotTag": "1",
          "img": "https://fyb-2.cdn.bcebos.com/hotboard_image/aa11.jpg",
          "rawUrl": "https://www.baidu.com/s?wd=DeepSeek", "show": 1 }
      ] } ] }
    }"#;

    #[test]
    fn parses_the_real_response_shape() {
        let resp: Resp = serde_json::from_str(REAL_SNIPPET).unwrap();
        assert_eq!(resp.success, Some(true));
        let entries: Vec<Entry> = resp
            .data
            .unwrap()
            .cards
            .into_iter()
            .flat_map(|c| c.content)
            .collect();
        assert_eq!(entries.len(), 2);

        let first = convert(entries[0].clone()).expect("应该能转成条目");
        assert_eq!(first.title, "以后办退休只需一张身份证");
        assert_eq!(first.hot_value, 7_809_527, "字符串数字要能解出来");
        assert_eq!(first.hot_text, "781.0万 热度");
        assert_eq!(first.tag, "热", "码 3 是「热」角标");
        assert!(first.summary.contains("人社部"));
        assert_eq!(
            first.cover,
            "https://fyb-2.cdn.bcebos.com/hotboard_image/b8c7.jpg"
        );

        let second = convert(entries[1].clone()).expect("应该能转成条目");
        assert_eq!(second.tag, "新", "码 1 是「新」角标");
        assert!(second.summary.is_empty(), "desc 为空就是空，不能塞占位文字");
    }

    #[test]
    fn accepts_score_as_number_too() {
        let json = r#"[{"word":"x","hotScore":12345,"hotTag":"0"}]"#;
        let entries: Vec<Entry> = serde_json::from_str(json).unwrap();
        assert_eq!(entries[0].hot_score, 12_345, "接口哪天改成数字也不能挂");
    }

    #[test]
    fn unparsable_score_degrades_to_zero() {
        let json = r#"[{"word":"x","hotScore":"N/A"}]"#;
        let entries: Vec<Entry> = serde_json::from_str(json).unwrap();
        let item = convert(entries[0].clone()).expect("热度读不出来不该丢掉整条");
        assert_eq!(item.hot_value, 0);
        assert_eq!(item.hot_text, "", "没有热度就不显示热度文案");
    }

    #[test]
    fn maps_only_the_verified_tag_codes() {
        assert_eq!(tag_label("1"), "新");
        assert_eq!(tag_label("3"), "热");
        assert_eq!(tag_label("0"), "", "0 表示没有角标");
        assert_eq!(tag_label("9"), "", "没核过的码宁可空着，别显示错标签");
        assert_eq!(tag_label(" 3 "), "热");
    }

    #[test]
    fn falls_back_to_a_search_url_when_raw_url_is_missing() {
        let item = convert(Entry {
            word: "中文 词条".into(),
            raw_url: String::new(),
            ..serde_json::from_str::<Entry>(r#"{"word":"占位"}"#).unwrap()
        })
        .expect("应该能转成条目");
        assert_eq!(
            item.url,
            "https://www.baidu.com/s?wd=%E4%B8%AD%E6%96%87%20%E8%AF%8D%E6%9D%A1"
        );
    }

    #[test]
    fn drops_entries_without_a_word() {
        let entries: Vec<Entry> =
            serde_json::from_str(r#"[{"word":"  "},{"word":"正常"}]"#).unwrap();
        let items: Vec<HotItem> = entries.into_iter().filter_map(convert).collect();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].title, "正常");
    }
}
