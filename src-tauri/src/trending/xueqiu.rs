//! 雪球热门讨论。
//!
//! ⚠️ 这个平台没法匿名抓。`xueqiu.com` 整站架了阿里云 WAF：直接 GET
//! 首页只会拿到一段 `<textarea id="renderData">{"_waf_...":...}` 的
//! JS 挑战页，`acw_tc` 之外的 `xq_a_token` 根本发不出来，随后调
//! `statuses/hot/listV2.json` 返回的还是挑战 HTML 而不是 JSON
//! （实测 2026-10）。备用子域也一样：`stock.xueqiu.com` 回
//! `error_code 400016`（要求登录），`api.xueqiu.com` 直接 403 + antidom。
//!
//! 所以这里的设计是：**用户把自己浏览器里的 Cookie 粘进来**，
//! 带登录态的请求能过 WAF。没配 Cookie 时不在这里报错，
//! 而是让上层回 `needs_cookie`，前端渲染成「点这里配置」的空态。

use serde::Deserialize;

use super::http::{client, UA};
use super::types::{compact, HotItem};

const HOT_URL: &str = "https://xueqiu.com/statuses/hot/listV2.json";

#[derive(Deserialize)]
struct Resp {
    #[serde(default)]
    list: Vec<Post>,
}

#[derive(Default, Deserialize)]
struct Post {
    #[serde(default)]
    id: Option<i64>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    excerpt: Option<String>,
    /// 形如 `/1234567890/987654321`
    #[serde(default)]
    target: Option<String>,
    #[serde(default)]
    target_url: Option<String>,
    #[serde(default)]
    user: Option<User>,
    #[serde(default)]
    reply_count: Option<i64>,
    #[serde(default)]
    like_count: Option<i64>,
    #[serde(default)]
    view_count: Option<i64>,
}

#[derive(Deserialize)]
struct User {
    #[serde(default)]
    screen_name: Option<String>,
}

impl Post {
    fn summary(&self) -> String {
        let raw = self.excerpt.as_deref().or(self.text.as_deref()).unwrap_or("");
        // 先把中间那个 String 绑出来，再 trim，
        // 否则 trim 借的是个马上就被丢掉的临时值
        let stripped = raw
            .replace("<span class=\"url-icon\">", "")
            .replace("</span>", "");
        // 微博正文里的长话题串没必要整段显示
        truncate(stripped.trim(), 90)
    }

    fn path(&self) -> String {
        if let Some(p) = self.target_url.as_deref().filter(|s| !s.is_empty()) {
            return p.to_string();
        }
        if let Some(t) = self.target.as_deref().filter(|s| !s.is_empty()) {
            return t.to_string();
        }
        match self.id {
            Some(id) => format!("/{id}"),
            None => String::new(),
        }
    }
}

/// 按字符（不是字节）截断，中文不会被切出半个字
fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let cut: String = s.chars().take(max).collect();
    format!("{cut}…")
}

/// 抓雪球热帖。`cookie` 为空时上层会先拦下，这里再兜一层。
pub async fn fetch(cookie: &str, limit: usize) -> Result<Vec<HotItem>, String> {
    let cookie = cookie.trim();
    if cookie.is_empty() {
        return Err("雪球需要登录 Cookie：请在设置里粘贴浏览器中的 xueqiu.com Cookie".to_string());
    }

    let url = format!("{HOT_URL}?since_id=-1&max_id=-1&size={}", limit.clamp(1, 50));
    let body = client()
        .get(&url)
        .header("User-Agent", UA)
        .header("Referer", "https://xueqiu.com/")
        .header("Accept", "application/json, text/plain, */*")
        .header("X-Requested-With", "XMLHttpRequest")
        .header("Cookie", cookie)
        .send()
        .await
        .map_err(|e| format!("请求失败：{e}"))?;

    let status = body.status();
    let text = body.text().await.map_err(|e| format!("读取失败：{e}"))?;

    // WAF 挑战页返回的是 200 的 HTML，这里显式识别出来，
    // 免得 serde 报一句看不懂的「expected value」
    if text.trim_start().starts_with("<") {
        if text.contains("_waf_") || text.contains("aliyun_waf") {
            return Err("雪球 WAF 挑战未通过：Cookie 可能已过期或格式不对".to_string());
        }
        return Err(format!("雪球返回了网页而不是数据（HTTP {status}）"));
    }

    let resp: Resp =
        serde_json::from_str(&text).map_err(|e| format!("解析失败：{e}"))?;

    let items: Vec<HotItem> = resp
        .list
        .into_iter()
        .filter_map(|p| convert(p))
        .take(limit)
        .collect();

    if items.is_empty() {
        return Err("雪球返回了空列表".to_string());
    }
    Ok(items)
}

fn convert(p: Post) -> Option<HotItem> {
    let title = p
        .title
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| truncate(s, 70))?;
    let path = p.path();
    if path.is_empty() {
        return None;
    }
    let path = if path.starts_with('/') {
        path
    } else {
        format!("/{path}")
    };
    let view = p.view_count.unwrap_or(0);
    let reply = p.reply_count.unwrap_or(0);
    let like = p.like_count.unwrap_or(0);

    Some(HotItem {
        rank: 0,
        title,
        url: format!("https://xueqiu.com{path}"),
        cover: String::new(),
        summary: p.summary(),
        author: p
            .user
            .and_then(|u| u.screen_name)
            .unwrap_or_default(),
        hot_text: [
            (view > 0).then(|| format!("{} 浏览", compact(view))),
            (like > 0).then(|| format!("{} 点赞", compact(like))),
            (reply > 0).then(|| format!("{} 回复", compact(reply))),
        ]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(" · "),
        hot_value: view,
        tag: String::new(),
        meta: String::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn rejects_empty_cookie_before_network() {
        assert!(fetch("", 10).await.err_contains("Cookie"));
    }

    /// 小工具：让断言写起来短一点，避免为了测这个去真的发请求
    trait ErrContains {
        fn err_contains(self, needle: &str) -> bool;
    }
    impl<T, E: std::fmt::Display> ErrContains for Result<T, E> {
        fn err_contains(self, needle: &str) -> bool {
            self.err().map(|e| e.to_string().contains(needle)).unwrap_or(false)
        }
    }

    #[test]
    fn maps_post_into_hot_item() {
        let p = Post {
            id: Some(42),
            title: Some("雪球热帖".into()),
            text: Some("正文内容".into()),
            excerpt: Some("摘要".into()),
            target: Some("/1/2".into()),
            target_url: None,
            user: Some(User {
                screen_name: Some("某人".into()),
            }),
            reply_count: Some(12),
            like_count: Some(99),
            view_count: Some(300_000),
        };
        let item = convert(p).expect("应该能转成条目");
        assert_eq!(item.url, "https://xueqiu.com/1/2");
        assert_eq!(item.author, "某人");
        assert_eq!(item.summary, "摘要");
        assert_eq!(item.hot_value, 300_000);
        assert_eq!(item.hot_text, "30.0万 浏览 · 99 点赞 · 12 回复");
    }

    #[test]
    fn truncates_by_chars_not_bytes() {
        assert_eq!(truncate("短", 5), "短");
        let long = "中".repeat(20);
        let out = truncate(&long, 5);
        assert_eq!(out.chars().count(), 6, "5 个字加一个省略号");
        assert!(out.ends_with('…'));
    }

    #[test]
    fn drops_posts_without_title() {
        assert!(convert(Post {
            target: Some("/1/2".into()),
            ..Default::default()
        })
        .is_none());
    }
}
