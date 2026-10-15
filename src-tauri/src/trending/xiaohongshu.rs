//! 小红书推荐流。
//!
//! ⚠️ 这个平台是四个里最难的，实测（2026-10）结论如下：
//! - `https://www.xiaohongshu.com/explore` 对未登录请求 **302 跳登录页**
//! - `edith.xiaohongshu.com/api/sns/web/v1/homefeed` 无鉴权时 **404**
//! - `fe_api/burdock/v1/search/hot_list` **404**
//!
//! 根因是 XHS 的 `x-s` / `x-t` 请求签名：要带上浏览器指纹哈希和时间戳
//! 由混淆 JS 算出来，再配合登录态 Cookie 才放行。这套算法官方没有公开，
//! 逆向实现既脆弱又随时会失效，所以这里**不做签名**。
//!
//! 那这里还留着一个 fetcher 的意义：用户把自己的 Cookie 填进来后，
//! 接口有可能凭登录态直接放行；万一哪天放行了就直接能用，不用改结构。
//! 拿不到数据时错误会如实透出到卡片上，不会拿假数据糊弄。
//! 如果实测下来这条路也走不通，最省事的做法是把这个源从
//! [`super::Source::all`] 里摘掉，前端会自动少一块卡片。

use serde::Deserialize;

use super::http::{client, UA};
use super::types::HotItem;

const HOME_FEED_URL: &str = "https://edith.xiaohongshu.com/api/sns/web/v1/homefeed";

#[derive(Deserialize)]
struct Resp {
    #[serde(default)]
    success: Option<bool>,
    #[serde(default)]
    msg: Option<String>,
    data: Option<Data>,
}

#[derive(Deserialize)]
struct Data {
    #[serde(default)]
    items: Vec<Item>,
}

#[derive(Default, Deserialize)]
struct Item {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    xsec_token: Option<String>,
    #[serde(default)]
    note_card: Option<Note>,
}

#[derive(Default, Deserialize)]
struct Note {
    /// 文案标题，不同卡片类型字段名不一样，所以都收
    #[serde(default)]
    display_title: Option<String>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    desc: Option<String>,
    #[serde(default)]
    user: Option<User>,
    #[serde(default)]
    interact_info: Option<Interact>,
    #[serde(default)]
    cover: Option<Cover>,
}

#[derive(Default, Deserialize)]
struct User {
    #[serde(default)]
    nickname: Option<String>,
}

/// 互动数在接口里已经是「1.2万」这种展示字符串，不是数字
#[derive(Default, Deserialize)]
struct Interact {
    #[serde(default)]
    liked_count: Option<String>,
    #[serde(default)]
    collected_count: Option<String>,
    #[serde(default)]
    comment_count: Option<String>,
}

#[derive(Default, Deserialize)]
struct Cover {
    #[serde(default)]
    url_default: Option<String>,
    #[serde(default)]
    url: Option<String>,
}

/// 把状态码翻译成「接下来该做什么」。
///
/// 关键在 406：实测（2026-10-15）带上完整登录 Cookie 仍然是 406。
/// 登录态和请求签名是两回事——Cookie 解决前者，`x-s` / `x-t` 解决后者，
/// 而后者由官方混淆 JS 现算、没有公开算法。所以这句不能写成「重试一下」，
/// 那只会让用户反复粘 Cookie。
fn describe_status(code: u16) -> String {
    match code {
        404 => "小红书接口返回 404：缺 x-s 签名或 Cookie 无效".to_string(),
        401 | 403 => {
            "小红书拒绝了请求（401/403）：Cookie 可能已过期，重新登录再复制一次".to_string()
        }
        406 => "小红书返回 406 Not Acceptable：x-s / x-t 签名没通过。这套签名由官方混淆 JS \
                现算、没有公开算法，登录 Cookie 只解决登录态、解决不了签名——\
                重试和换 Cookie 都没用，要取到数据只能逆向签名或走第三方聚合服务"
            .to_string(),
        other => format!("小红书返回 HTTP {other}"),
    }
}

/// 抓小红书推荐流
pub async fn fetch(cookie: &str, limit: usize) -> Result<Vec<HotItem>, String> {
    let cookie = cookie.trim();
    if cookie.is_empty() {
        return Err(
            "小红书需要登录 Cookie，且接口要 x-s 签名：请先在设置里粘贴 Cookie 再试".to_string(),
        );
    }

    let resp = client()
        .post(HOME_FEED_URL)
        .header("User-Agent", UA)
        .header("Referer", "https://www.xiaohongshu.com/")
        .header("Origin", "https://www.xiaohongshu.com")
        .header("Accept", "application/json, text/plain, */*")
        .header("Cookie", cookie)
        .header("x-s-common", "")
        .header("Content-Type", "application/json;charset=UTF-8")
        .body("{}")
        .send()
        .await
        .map_err(|e| format!("请求失败：{e}"))?;

    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("读取失败：{e}"))?;

    if !status.is_success() {
        return Err(describe_status(status.as_u16()));
    }

    let parsed: Resp =
        serde_json::from_str(&text).map_err(|_| format!("小红书没有返回 JSON（HTTP {status}）"))?;

    if parsed.success == Some(false) {
        return Err(format!(
            "小红书返回失败：{}",
            parsed.msg.unwrap_or_else(|| "未说明原因".into())
        ));
    }

    let items: Vec<HotItem> = parsed
        .data
        .map(|d| d.items)
        .unwrap_or_default()
        .into_iter()
        .filter_map(|i| convert(i))
        .take(limit)
        .collect();

    if items.is_empty() {
        return Err("小红书返回了空列表".to_string());
    }
    Ok(items)
}

fn convert(item: Item) -> Option<HotItem> {
    let id = item.id.filter(|s| !s.is_empty())?;
    let note = item.note_card?;
    let title = note
        .display_title
        .as_deref()
        .or(note.title.as_deref())
        .filter(|s| !s.trim().is_empty())?
        .trim()
        .to_string();

    let url = match item.xsec_token.filter(|s| !s.is_empty()) {
        Some(token) => format!("https://www.xiaohongshu.com/explore/{id}?xsec_token={token}"),
        None => format!("https://www.xiaohongshu.com/explore/{id}"),
    };

    let it = note.interact_info.unwrap_or_default();
    let hot_text = [
        it.liked_count.as_deref().map(|c| format!("{c} 赞")),
        it.collected_count.as_deref().map(|c| format!("{c} 收藏")),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join(" · ");

    let cover = note
        .cover
        .and_then(|c| c.url_default.or(c.url))
        .unwrap_or_default()
        .replace("http://", "https://");

    Some(HotItem {
        rank: 0,
        title,
        url,
        cover,
        summary: note.desc.unwrap_or_default(),
        author: note.user.and_then(|u| u.nickname).unwrap_or_default(),
        hot_text,
        // 接口给的是展示字符串，这里只留一个占位用于同平台内排序
        hot_value: 0,
        tag: String::new(),
        meta: it
            .comment_count
            .map(|c| format!("{c} 评论"))
            .unwrap_or_default(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explains_why_406_is_not_worth_retrying() {
        let msg = describe_status(406);
        assert!(msg.contains("签名"), "要说清是签名问题：{msg}");
        assert!(msg.contains("406"));
        assert!(
            !msg.contains("过期") && !msg.contains("重新登录"),
            "别把签名失败引到「Cookie 过期」上去，那是 401/403 的事：{msg}"
        );
        // 其余状态码各自有说法
        assert!(describe_status(401).contains("过期"));
        assert!(describe_status(404).contains("签名"));
        assert_eq!(describe_status(500), "小红书返回 HTTP 500");
    }

    #[test]
    fn builds_explore_url_with_token() {
        let item = convert(Item {
            id: Some("abc123".into()),
            xsec_token: Some("tok".into()),
            note_card: Some(Note {
                display_title: Some("笔记标题".into()),
                interact_info: Some(Interact {
                    liked_count: Some("1.2万".into()),
                    collected_count: Some("3000".into()),
                    comment_count: Some("88".into()),
                }),
                cover: Some(Cover {
                    url_default: Some("http://sns-img/1.jpg".into()),
                    url: None,
                }),
                ..Default::default()
            }),
        })
        .expect("应该能转成条目");

        assert_eq!(
            item.url,
            "https://www.xiaohongshu.com/explore/abc123?xsec_token=tok"
        );
        assert_eq!(item.cover, "https://sns-img/1.jpg", "封面要升到 https");
        assert_eq!(item.hot_text, "1.2万 赞 · 3000 收藏");
        assert_eq!(item.meta, "88 评论");
    }

    #[test]
    fn falls_back_when_token_missing() {
        let item = convert(Item {
            id: Some("abc".into()),
            xsec_token: None,
            note_card: Some(Note {
                title: Some("备用标题".into()),
                ..Default::default()
            }),
        })
        .expect("应该能转成条目");
        assert_eq!(item.url, "https://www.xiaohongshu.com/explore/abc");
        assert_eq!(item.title, "备用标题");
    }

    #[test]
    fn drops_items_without_id_or_title() {
        assert!(convert(Item {
            id: None,
            note_card: Some(Note::default()),
            ..Default::default()
        })
        .is_none());
        assert!(convert(Item {
            id: Some("x".into()),
            note_card: None,
            ..Default::default()
        })
        .is_none());
    }
}
