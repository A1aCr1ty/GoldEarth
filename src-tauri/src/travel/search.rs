//! Bounded, independent search providers. A working provider does not wait for a
//! stalled one; HTTP 200, verification pages and irrelevant RSS are not success.
use super::{plain_text, safe_url, Destination, TravelSource};
use dom_query::Document;
use once_cell::sync::Lazy;
use std::{collections::HashSet, time::Duration};
use tokio::task::JoinSet;

const MAX_BODY: usize = 4 * 1024 * 1024;
static CLIENT: Lazy<reqwest::Client> = Lazy::new(|| {
    reqwest::Client::builder()
        .user_agent(crate::trending::http::UA)
        .connect_timeout(Duration::from_secs(3))
        .timeout(Duration::from_secs(7))
        .redirect(reqwest::redirect::Policy::limited(4))
        .build()
        .expect("构建旅行检索客户端失败")
});

#[derive(Clone, Copy)]
enum Provider {
    So360,
    Sogou,
    Baidu,
    Bing,
}
impl Provider {
    fn name(self) -> &'static str {
        match self {
            Self::So360 => "360 搜索",
            Self::Sogou => "搜狗",
            Self::Baidu => "百度",
            Self::Bing => "Bing RSS",
        }
    }
    fn endpoint(self) -> &'static str {
        match self {
            Self::So360 => "https://www.so.com/s",
            Self::Sogou => "https://www.sogou.com/web",
            Self::Baidu => "https://www.baidu.com/s",
            Self::Bing => "https://www.bing.com/search",
        }
    }
}

pub(super) struct SearchOutcome {
    pub sources: Vec<TravelSource>,
    pub diagnostics: Vec<String>,
}

pub(super) fn relevant(title: &str, snippet: &str, destination: &Destination) -> bool {
    let text = format!("{title} {snippet}");
    text.contains(&destination.name)
        && [
            "旅游",
            "旅行",
            "攻略",
            "游玩",
            "景点",
            "预约",
            "行程",
            "自由行",
            "自驾",
            "交通",
            "住宿",
            "门票",
        ]
        .iter()
        .any(|word| text.contains(word))
}

fn result_url(raw: &str, provider: Provider) -> Option<String> {
    let base = reqwest::Url::parse(provider.endpoint()).ok()?;
    let mut url = base.join(raw.trim()).ok()?;
    if !safe_url(url.as_str()) {
        return None;
    }
    let host = url.host_str()?;
    if host == "ai.so.com" || (host == "www.so.com" && url.path() != "/link") {
        return None;
    }
    // Only permit result redirects on the search provider itself, not search
    // forms, account links, advertisements or javascript navigation.
    if host == "sogou.com"
        || host.ends_with(".sogou.com")
        || host == "baidu.com"
        || host.ends_with(".baidu.com")
    {
        if url.path() != "/link" && url.path() != "/link/" {
            // Actual articles on e.g. baike.baidu.com are ordinary result URLs.
            if matches!(
                host,
                "www.baidu.com" | "www.sogou.com" | "baidu.com" | "sogou.com"
            ) {
                return None;
            }
        }
        if host == "www.baidu.com" && url.scheme() == "http" {
            url.set_scheme("https").ok()?;
        }
    }
    url.set_fragment(None);
    Some(url.into())
}

fn parse_html(
    raw: &str,
    provider: Provider,
    destination: &Destination,
) -> Result<Vec<TravelSource>, String> {
    let document = Document::from(raw);
    let page_title = document.select_single("title").text().to_string();
    if ["验证码", "安全验证", "访问验证", "访问过于频繁"]
        .iter()
        .any(|s| page_title.contains(s))
    {
        return Err("搜索服务要求验证，请稍后重试".into());
    }
    let selector = match provider {
        Provider::So360 => "li.res-list",
        Provider::Sogou => ".vrwrap, .rb",
        Provider::Baidu => {
            "#content_left .result, #content_left .result-op, #content_left .c-container"
        }
        Provider::Bing => unreachable!(),
    };
    let mut sources = Vec::new();
    let mut seen = HashSet::new();
    for block in document.select(selector).iter() {
        let link = block.select_single("h3 a[href]");
        let Some(href) = link.attr("data-mdurl").or_else(|| link.attr("href")) else {
            continue;
        };
        let Some(url) = result_url(&href, provider) else {
            continue;
        };
        let title = plain_text(&link.text(), 100);
        let summary = block.select_single(".res-desc, .res-rich, [id^='cacheresult_summary_'], .str_info, .text-layout, .c-abstract, .content-right_8Zs40, [class*='content-wrapper']").text();
        let snippet = plain_text(&summary, 160);
        if !relevant(&title, &snippet, destination) || !seen.insert(url.clone()) {
            continue;
        }
        sources.push(TravelSource {
            title,
            url,
            snippet,
        });
        if sources.len() == 6 {
            break;
        }
    }
    if sources.is_empty() {
        if raw.contains("static/css/anti.min.css") || raw.contains("newstatic/css/verify.css") {
            return Err("搜索服务要求验证，请稍后重试".into());
        }
        return Err("未返回相关攻略（可能为空结果或页面结构变化）".into());
    }
    Ok(sources)
}

async fn fetch(provider: Provider, destination: &Destination) -> Result<Vec<TravelSource>, String> {
    let query = format!("{} {}天 自由行 旅游攻略 交通 住宿 预约", destination.name, destination.days);
    let key = match provider {
        Provider::So360 => "q",
        Provider::Sogou => "query",
        Provider::Baidu => "wd",
        Provider::Bing => "q",
    };
    let mut url = reqwest::Url::parse(provider.endpoint()).map_err(|_| "检索地址无效")?;
    url.query_pairs_mut().append_pair(key, &query);
    if matches!(provider, Provider::Bing) {
        url.query_pairs_mut().append_pair("format", "rss");
    }
    // Some search frontends return an empty HTTP 200 shell for '+' spaces,
    // while the equivalent percent-encoded URL returns real results.
    let url = url.as_str().replace('+', "%20");
    let request = CLIENT
        .get(url)
        .header(
            reqwest::header::ACCEPT,
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        )
        .header(reqwest::header::ACCEPT_LANGUAGE, "zh-CN,zh;q=0.9");
    let mut response = request
        .send()
        .await
        .map_err(network_error)?
        .error_for_status()
        .map_err(network_error)?;
    if response
        .content_length()
        .is_some_and(|len| len > MAX_BODY as u64)
    {
        return Err("响应超出大小限制".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(network_error)? {
        if bytes.len() + chunk.len() > MAX_BODY {
            return Err("响应超出大小限制".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let raw = String::from_utf8_lossy(&bytes);
    match provider {
        Provider::Bing => {
            let list = super::parse_results(&raw, destination)?;
            if list.is_empty() {
                Err("RSS 为空或仅返回无关结果".into())
            } else {
                Ok(list)
            }
        }
        _ => parse_html(&raw, provider, destination),
    }
}

fn network_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        "请求超时".into()
    } else if let Some(status) = error.status() {
        format!("HTTP {}", status.as_u16())
    } else if error.is_connect() {
        "连接失败，请检查网络或代理".into()
    } else {
        "响应传输失败".into()
    }
}

type ProviderTasks = JoinSet<(&'static str, Result<Vec<TravelSource>, String>)>;
async fn collect(mut tasks: ProviderTasks) -> SearchOutcome {
    let mut outcome = SearchOutcome {
        sources: vec![],
        diagnostics: vec![],
    };
    let mut seen = HashSet::new();
    while let Some(result) = tasks.join_next().await {
        match result {
            Ok((name, Ok(list))) => {
                outcome
                    .diagnostics
                    .push(format!("{name}：找到 {} 条相关攻略", list.len()));
                for source in list {
                    if seen.insert(source.url.clone()) {
                        outcome.sources.push(source);
                    }
                }
                // A sufficient successful response can render immediately; dropping
                // JoinSet aborts the remaining in-flight requests.
                if outcome.sources.len() >= 3 {
                    break;
                }
            }
            Ok((name, Err(error))) => outcome.diagnostics.push(format!("{name}：{error}")),
            Err(_) => outcome.diagnostics.push("一个检索任务未完成".into()),
        }
    }
    outcome
}

pub(super) async fn search(destination: &Destination) -> SearchOutcome {
    let mut tasks = JoinSet::new();
    for provider in [
        Provider::So360,
        Provider::Sogou,
        Provider::Baidu,
        Provider::Bing,
    ] {
        let destination = destination.clone();
        tasks.spawn(async move {
            let result =
                tokio::time::timeout(Duration::from_secs(8), fetch(provider, &destination))
                    .await
                    .unwrap_or_else(|_| Err("检索超时".into()));
            (provider.name(), result)
        });
    }
    collect(tasks).await
}

#[cfg(test)]
mod tests {
    use super::*;
    fn dali() -> Destination {
        super::super::CATALOG
            .iter()
            .find(|d| d.name == "大理")
            .unwrap()
            .clone()
    }
    #[test]
    fn parses_chinese_html_and_filters_irrelevant_unsafe_and_ad_links() {
        let html = r#"<div class="vrwrap"><h3><a href="/link?url=one">大理<em>旅游</em>攻略</a></h3><div class="str_info">洱海 &amp; 古城</div></div>
        <div class="vrwrap"><h3><a href="javascript:alert(1)">大理旅游攻略</a></h3></div>
        <div class="vrwrap"><h3><a href="https://example.com/no">英语考试</a></h3></div>
        <div class="vrwrap"><h3><a href="/web?query=大理">大理旅游攻略</a></h3></div>"#;
        let sources = parse_html(html, Provider::Sogou, &dali()).unwrap();
        assert_eq!(sources.len(), 1);
        assert_eq!(sources[0].title, "大理旅游攻略");
        assert_eq!(sources[0].snippet, "洱海 & 古城");
        assert_eq!(sources[0].url, "https://www.sogou.com/link?url=one");
        assert!(parse_html("<title>百度安全验证</title>", Provider::Baidu, &dali()).is_err());
        assert!(parse_html("<html>empty</html>", Provider::Sogou, &dali()).is_err());
    }
    #[test]
    fn baidu_normalizes_redirects_and_deduplicates_nested_result_containers() {
        let html = r#"<div id="content_left"><div class="result c-container"><h3><a href="http://www.baidu.com/link?url=one">大理自由行攻略</a></h3><div class="c-abstract">古城住宿</div></div><div class="result"><h3><a href="https://www.baidu.com/baidu.php?url=ad">大理旅游攻略</a></h3></div></div>"#;
        let sources = parse_html(html, Provider::Baidu, &dali()).unwrap();
        assert_eq!(sources.len(), 1);
        assert_eq!(sources[0].url, "https://www.baidu.com/link?url=one");
    }

    #[test]
    fn so360_uses_real_article_urls_and_ignores_ai_and_search_navigation() {
        let html = r#"<ul class="result"><li class="res-list"><h3><a href="https://www.so.com/link?m=one" data-mdurl="https://travel.example.com/dali">大理旅游攻略</a></h3><div class="res-rich">洱海自由行路线</div></li>
        <li class="res-list"><h3><a href="https://ai.so.com/search/one">大理旅游攻略</a></h3></li>
        <li class="res-list"><h3><a href="https://www.so.com/s?q=大理">大理旅游攻略</a></h3></li></ul>"#;
        let sources = parse_html(html, Provider::So360, &dali()).unwrap();
        assert_eq!(sources.len(), 1);
        assert_eq!(sources[0].url, "https://travel.example.com/dali");
        assert_eq!(sources[0].snippet, "洱海自由行路线");
    }

    #[tokio::test]
    async fn all_provider_failures_remain_visible_instead_of_becoming_empty_success() {
        let mut tasks = JoinSet::new();
        tasks.spawn(async { ("来源一", Err("请求超时".into())) });
        tasks.spawn(async { ("来源二", Err("搜索服务要求验证".into())) });
        let outcome = collect(tasks).await;
        assert!(outcome.sources.is_empty());
        assert_eq!(outcome.diagnostics.len(), 2);
        assert!(outcome.diagnostics.iter().any(|d| d.contains("请求超时")));
    }
    #[tokio::test]
    async fn working_provider_does_not_wait_for_stalled_provider() {
        let mut tasks = JoinSet::new();
        tasks.spawn(async { ("故障源", Err("连接失败".into())) });
        tasks.spawn(async {
            std::future::pending::<()>().await;
            ("慢源", Ok(vec![]))
        });
        tasks.spawn(async {
            (
                "正常源",
                Ok((0..3)
                    .map(|n| TravelSource {
                        title: "大理旅游攻略".into(),
                        url: format!("https://example.com/{n}"),
                        snippet: "".into(),
                    })
                    .collect()),
            )
        });
        let outcome = tokio::time::timeout(Duration::from_secs(1), collect(tasks))
            .await
            .unwrap();
        assert_eq!(outcome.sources.len(), 3);
    }
    #[tokio::test]
    #[ignore = "访问真实联网搜索"]
    async fn live_dali_and_hangzhou_return_relevant_sources() {
        for destination in [
            super::super::plans::for_days(dali(), 7).unwrap(),
            super::super::plans::for_days(super::super::CATALOG
                .iter()
                .find(|d| d.name == "杭州")
                .unwrap()
                .clone(), 3).unwrap(),
        ] {
            let start = std::time::Instant::now();
            let outcome = search(&destination).await;
            println!(
                "{}: {} sources in {:?}; {:?}",
                destination.name,
                outcome.sources.len(),
                start.elapsed(),
                outcome.diagnostics
            );
            assert!(!outcome.sources.is_empty(), "{:?}", outcome.diagnostics);
            assert!(outcome
                .sources
                .iter()
                .all(|s| relevant(&s.title, &s.snippet, &destination) && safe_url(&s.url)));
        }
    }
}
