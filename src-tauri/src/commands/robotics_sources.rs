//! Direct discovery of technical documents from official sites and GitHub.
use super::{plain, valid_url, Item, Source, CLIENT};
use serde_json::Value;
use std::collections::HashSet;

pub(super) fn defaults() -> Vec<Source> {
    let mut result = Vec::new();
    for (id, name, category, url) in [
        (
            "unitree-docs",
            "宇树 · 开发文档",
            "humanoid",
            "https://support.unitree.com/home/zh/H1_developer",
        ),
        (
            "unitree-h1-specs",
            "宇树 H1 · 官方参数",
            "humanoid",
            "https://www.unitree.com/h1",
        ),
        (
            "agilex-manuals",
            "松灵 · 产品手册",
            "wheeled",
            "https://www.agilex.ai/more/69a7a6bd0a52fd338d02ab37",
        ),
        (
            "ufactory-docs",
            "UFACTORY · 硬件与开发手册",
            "arm",
            "https://docs.ufactory.cc/",
        ),
        (
            "dobot-docs",
            "越疆 · 协作臂手册与二次开发",
            "cobot",
            "https://www.dobot.cn/service/download-center",
        ),
        (
            "myactuator-docs",
            "MyActuator · 关节规格与手册",
            "joint",
            "https://www.myactuator.com/downloads-xseries",
        ),
        (
            "livox-docs",
            "Livox · 传感器资料下载",
            "sensor",
            "https://www.livoxtech.com/downloads",
        ),
        (
            "agibot-x2-docs",
            "智元灵犀 X2 · 开发文档",
            "humanoid",
            "https://x2-aimdk.agibot.com/en/latest/index.html",
        ),
        (
            "limx-docs",
            "逐际动力 · 文档中心",
            "humanoid",
            "https://www.limxdynamics.com/en/documents",
        ),
        (
            "robstride-manual",
            "灵足时代 · RobStride03 关节使用手册",
            "joint",
            "https://www.robstride.com/assets/product_manual_robStride03-9c54db7a.pdf",
        ),
        (
            "orbbec-docs",
            "奥比中光 · 产品规格与开发资料",
            "sensor",
            "https://www.orbbec.com.cn/index/Download2025/info.html?cate=121&id=1",
        ),
    ] {
        result.push(Source {
            id: id.into(),
            name: name.into(),
            category: category.into(),
            url: url.into(),
            kind: "website".into(),
        });
    }
    for (repo, category, label) in [
        ("unitreerobotics/unitree_sdk2", "humanoid", "宇树 · SDK2"),
        ("agilexrobotics/ugv_sdk", "wheeled", "松灵 · 移动机器人 SDK"),
        (
            "xArm-Developer/xArm-Python-SDK",
            "arm",
            "UFACTORY · 机械臂 Python SDK",
        ),
        (
            "Dobot-Arm/TCP-IP-Python-V4",
            "cobot",
            "越疆 · 协作臂 TCP/IP SDK",
        ),
        ("Livox-SDK/Livox-SDK2", "sensor", "览沃 Livox · 雷达 SDK2"),
        ("orbbec/OrbbecSDK", "sensor", "奥比中光 · 深度视觉 SDK"),
        (
            "unitreerobotics/unitree_rl_gym",
            "algorithm",
            "宇树 · 强化学习与运动控制",
        ),
        (
            "unitreerobotics/unitree_ros2",
            "system",
            "宇树 · ROS 2 系统适配",
        ),
    ] {
        result.push(Source {
            id: format!("github:{repo}"),
            name: format!("{label}（GitHub）"),
            category: category.into(),
            url: format!("https://github.com/{repo}"),
            kind: "github".into(),
        });
    }
    result
}

pub(super) fn document_kind(text: &str) -> Option<&'static str> {
    let text = text.to_lowercase();
    let has = |words: &[&str]| words.iter().any(|w| text.contains(w));
    if has(&["changelog", "release notes", "更新日志"]) {
        Some("release")
    } else if has(&[
        "datasheet",
        "data sheet",
        "specification",
        "specs",
        "规格",
        "参数",
        "产品单页",
        "product information",
    ]) {
        Some("datasheet")
    } else if has(&["sdk", "software development kit"]) {
        Some("sdk")
    } else if has(&[
        "api",
        "protocol",
        "interface",
        "接口",
        "协议",
        "modbus",
        "ethercat",
        "can总线",
    ]) {
        Some("api")
    } else if has(&[
        "release",
        "changelog",
        "firmware",
        "版本",
        "固件",
        "更新日志",
    ]) {
        Some("release")
    } else if has(&[
        "manual",
        "handbook",
        "user guide",
        "hardware",
        "手册",
        "操作指南",
        "硬件",
    ]) {
        Some("manual")
    } else if has(&[
        "tutorial",
        "quickstart",
        "quick-start",
        "getting_started",
        "getting-started",
        "教程",
        "入门",
        "example",
    ]) {
        Some("tutorial")
    } else if has(&[
        ".pdf",
        ".md",
        ".rst",
        "readme",
        "documentation",
        "document",
        "/docs/",
        "/doc/",
        "guide",
        "download",
        "文档",
        "开发",
        "下载",
    ]) || matches!(text.as_str(), "doc" | "docs")
        || text.ends_with("/doc")
        || text.ends_with("/docs")
    {
        Some("document")
    } else {
        None
    }
}

pub(super) async fn text(url: &str) -> Result<String, String> {
    text_with_url(url).await.map(|(body, _)| body)
}

async fn text_with_url(url: &str) -> Result<(String, String), String> {
    let response = CLIENT
        .get(url)
        .header(
            "Accept",
            "application/vnd.github+json, text/html, application/atom+xml",
        )
        .send()
        .await
        .map_err(|e| format!("连接失败：{e}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(if status.as_u16() == 403 || status.as_u16() == 429 {
            format!("来源限制访问或请求频率（HTTP {status}），请稍后重试或打开来源查看")
        } else {
            format!("来源请求失败（HTTP {status}）")
        });
    }
    let final_url = response.url().to_string();
    let mut response = response;
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if body.len() + chunk.len() > 5 * 1024 * 1024 {
            return Err("来源内容超过 5 MB 限制".into());
        }
        body.extend_from_slice(&chunk);
    }
    Ok((String::from_utf8_lossy(&body).into_owned(), final_url))
}

pub(super) fn website(raw: &str, source: &Source) -> Result<Vec<Item>, String> {
    let doc = dom_query::Document::from(raw);
    let title = plain(&doc.select_single("title").text(), 200);
    if [
        "Access Denied",
        "Just a moment",
        "Oh noes",
        "Robot Check",
        "验证码",
        "安全验证",
    ]
    .iter()
    .any(|s| title.contains(s))
    {
        return Err("官网要求验证，未将验证页当作文档；可点击来源手动查看".into());
    }
    let base = reqwest::Url::parse(&source.url).map_err(|_| "官网 URL 无效")?;
    let mut seen = HashSet::new();
    let mut items = Vec::new();
    // Some official download centers expose file metadata as JSON rather than <a> links.
    // Read that public data without executing scripts (including Nuxt's indexed table format).
    for script in doc.select("script[type='application/json']").iter() {
        if let Ok(data) = serde_json::from_str::<Value>(&script.text()) {
            embedded_documents(&data, data.as_array(), source, &base, &mut seen, &mut items);
        }
    }
    for link in doc.select("a[href]").iter() {
        let Some(href) = link.attr("href") else {
            continue;
        };
        if href.starts_with('#') {
            continue;
        }
        let Ok(mut url) = base.join(&href) else {
            continue;
        };
        url.set_fragment(None);
        if !valid_url(url.as_str()) || url.as_str() == source.url || !seen.insert(url.to_string()) {
            continue;
        }
        let label = plain(&link.text(), 200);
        // Download buttons often have no useful label: their enclosing row carries the model and document name.
        let mut context = plain(&link.parent().text(), 420);
        let generic = label.is_empty()
            || matches!(
                label.to_lowercase().as_str(),
                "download" | "下载" | "查看更多" | "learn more"
            );
        if generic && context.trim() == label.trim() {
            let broader = plain(&link.parent().parent().text(), 420);
            if broader.chars().count() < 240 {
                context = broader;
            }
        }
        let combined = format!(
            "{label} {} {}",
            url.path(),
            if generic { context.as_str() } else { "" }
        );
        let Some(kind) = document_kind(&combined) else {
            continue;
        };
        if [
            "privacy", "cookie", "terms", "login", "sign-in", "contact", "careers", "newsroom",
        ]
        .iter()
        .any(|s| url.path().to_lowercase().contains(s))
        {
            continue;
        }
        let name = if label.is_empty()
            || matches!(
                label.to_lowercase().as_str(),
                "download" | "下载" | "查看更多" | "learn more"
            ) {
            if context.len() > label.len() && context.chars().count() < 180 {
                context.clone()
            } else {
                let filename = url
                    .path_segments()
                    .and_then(|mut p| p.next_back())
                    .unwrap_or("技术文档")
                    .to_string();
                let mut decoder = reqwest::Url::parse("https://example.com/").unwrap();
                decoder.set_query(Some(&format!("name={}", filename.replace('+', "%2B"))));
                let decoded = decoder
                    .query_pairs()
                    .next()
                    .map(|(_, name)| name.into_owned())
                    .unwrap_or(filename);
                decoded
            }
        } else {
            label
        };
        if name.trim().is_empty() {
            continue;
        }
        items.push(Item {
            title: name,
            url: url.into(),
            summary: context,
            category: source.category.clone(),
            source: source.name.clone(),
            source_kind: source.kind.clone(),
            kind: kind.into(),
            published_at: None,
        });
    }
    // The watched page itself is useful when it actually contains specifications or documentation.
    doc.select("script, style, nav, header, footer").remove();
    let content = plain(&doc.text(), 1200);
    let page_kind = document_kind(&format!("{title} {}", source.name));
    if let Some(kind) = page_kind {
        if content.chars().count() > 100 && !title.is_empty() {
            items.insert(
                0,
                Item {
                    title: title.clone(),
                    url: source.url.clone(),
                    summary: content.chars().take(650).collect(),
                    category: source.category.clone(),
                    source: source.name.clone(),
                    source_kind: source.kind.clone(),
                    kind: kind.into(),
                    published_at: None,
                },
            );
        }
    }
    if items.is_empty() && document_kind(&title).is_some() && raw.contains("<script") {
        items.push(Item {
            title: format!("{title} · 文档入口"), url: source.url.clone(),
            summary: "该官网文档由浏览器动态加载，当前仅收录文档入口，尚未读取具体文档目录或文件。请打开官网后查找型号参数、开发手册和 SDK。".into(),
            category: source.category.clone(), source: source.name.clone(), source_kind: source.kind.clone(),
            kind: "portal".into(), published_at: None,
        });
    }
    items.sort_by_key(|i| match i.kind.as_str() {
        "datasheet" => 0,
        "manual" => 1,
        "api" | "sdk" => 2,
        _ => 3,
    });
    items.truncate(60);
    if items.is_empty() {
        return Err(
            "未识别到参数或技术文档链接；页面可能需要 JavaScript、登录，或应改为具体文档/下载页"
                .into(),
        );
    }
    Ok(items)
}

fn embedded_documents(
    value: &Value,
    table: Option<&Vec<Value>>,
    source: &Source,
    base: &reqwest::Url,
    seen: &mut HashSet<String>,
    items: &mut Vec<Item>,
) {
    match value {
        Value::Array(values) => {
            for value in values {
                embedded_documents(value, table, source, base, seen, items);
            }
        }
        Value::Object(fields) => {
            let string = |key: &str| -> Option<&str> {
                let value = fields.get(key)?;
                value
                    .as_str()
                    .or_else(|| table?.get(value.as_u64()? as usize)?.as_str())
            };
            if let Some(raw_url) = ["url", "fileUrl", "downloadUrl", "href"]
                .iter()
                .find_map(|key| string(key))
            {
                if let Ok(url) = base.join(raw_url) {
                    let path = url.path().to_lowercase();
                    if valid_url(url.as_str())
                        && [".pdf", ".md", ".rst"]
                            .iter()
                            .any(|ext| path.ends_with(ext))
                        && seen.insert(url.to_string())
                    {
                        let name = ["originalName", "fileName", "title", "name"]
                            .iter()
                            .find_map(|key| string(key))
                            .unwrap_or(raw_url);
                        let kind =
                            document_kind(&format!("{name} {raw_url}")).unwrap_or("document");
                        items.push(Item { title: plain(name, 240), url: url.into(), summary: format!("官网公开下载文件：{name}。由文档中心公开的文件目录提取，可打开原始文档。"), category: source.category.clone(), source: source.name.clone(), source_kind: source.kind.clone(), kind: kind.into(), published_at: None });
                    }
                }
            }
            for value in fields.values() {
                if value.is_object() || value.is_array() {
                    embedded_documents(value, table, source, base, seen, items);
                }
            }
        }
        _ => {}
    }
}

pub(super) async fn website_fetch(source: &Source) -> Result<Vec<Item>, String> {
    if reqwest::Url::parse(&source.url).is_ok_and(|u| u.path().to_lowercase().ends_with(".pdf")) {
        let response = CLIENT
            .get(&source.url)
            .send()
            .await
            .map_err(|e| e.to_string())?
            .error_for_status()
            .map_err(|e| e.to_string())?;
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        if content_type.contains("application/pdf") {
            return Ok(vec![Item {
                title: source.name.clone(),
                url: source.url.clone(),
                summary: "官网直连 PDF 文档。已确认文件类型，可打开查看或下载全文。".into(),
                category: source.category.clone(),
                source: source.name.clone(),
                source_kind: source.kind.clone(),
                kind: document_kind(&source.name).unwrap_or("document").into(),
                published_at: None,
            }]);
        }
        return Err("该 PDF 地址未返回 PDF 文件，可能需要登录或已失效".into());
    }
    let (body, final_url) = text_with_url(&source.url).await?;
    website_at(&body, source, &final_url)
}

fn website_at(raw: &str, source: &Source, final_url: &str) -> Result<Vec<Item>, String> {
    let mut resolved = source.clone();
    resolved.url = final_url.to_string();
    website(raw, &resolved)
}

pub(super) fn github_documents(data: &Value, source: &Source, branch: &str) -> Vec<Item> {
    let Some(tree) = data["tree"].as_array() else {
        return Vec::new();
    };
    let mut files: Vec<_> = tree
        .iter()
        .filter_map(|entry| {
            if entry["type"] != "blob" {
                return None;
            }
            let path = entry["path"].as_str()?;
            let lower = path.to_lowercase();
            if ![".md", ".rst", ".pdf", ".ipynb"]
                .iter()
                .any(|ext| lower.ends_with(ext))
                || lower.contains("node_modules/")
            {
                return None;
            }
            if [
                "license",
                "contributing",
                "code_of_conduct",
                "pull_request",
                "issue_template",
                "agents.md",
                ".agents/",
                ".codex/",
                ".claude/",
                ".github/",
            ]
            .iter()
            .any(|part| lower.contains(part))
            {
                return None;
            }
            let kind = if lower.starts_with("readme.") {
                "readme"
            } else {
                document_kind(path)?
            };
            Some((path, kind))
        })
        .collect();
    files.sort_by_key(|(path, kind)| {
        (
            match *kind {
                "readme" => 0,
                "datasheet" => 1,
                "manual" | "api" | "sdk" => 2,
                _ => 3,
            },
            path.len(),
        )
    });
    files.into_iter().take(40).map(|(path, kind)| {
        let mut url = reqwest::Url::parse(&source.url).unwrap();
        { let mut segments = url.path_segments_mut().unwrap(); segments.push("blob").push(branch); for part in path.split('/') { segments.push(part); } }
        Item { title: format!("{} · {path}", source.name.trim_start_matches("GitHub · ")), url: url.into(), summary: format!("GitHub 仓库中的技术资料：{path}。打开可阅读原文、查看提交历史或下载文件。分支：{branch}。"), category: source.category.clone(), source: source.name.clone(), source_kind: source.kind.clone(), kind: kind.into(), published_at: None }
    }).collect()
}

async fn github_tree(source: &Source) -> Result<Vec<Item>, String> {
    let repo = source
        .url
        .trim_end_matches('/')
        .trim_start_matches("https://github.com/");
    let metadata: Value =
        serde_json::from_str(&text(&format!("https://api.github.com/repos/{repo}")).await?)
            .map_err(|e| e.to_string())?;
    let branch = metadata["default_branch"]
        .as_str()
        .ok_or("GitHub 未提供默认分支")?;
    let mut endpoint =
        reqwest::Url::parse(&format!("https://api.github.com/repos/{repo}/git/trees/")).unwrap();
    endpoint
        .path_segments_mut()
        .unwrap()
        .pop_if_empty()
        .push(branch);
    endpoint.query_pairs_mut().append_pair("recursive", "1");
    let data: Value =
        serde_json::from_str(&text(endpoint.as_str()).await?).map_err(|e| e.to_string())?;
    if data["truncated"] == true {
        return Err("GitHub 文档目录过大，返回被截断；请改为具体文档官网来源".into());
    }
    Ok(github_documents(&data, source, branch))
}

fn github_page(raw: &str, source: &Source) -> Vec<Item> {
    let doc = dom_query::Document::from(raw);
    let base = reqwest::Url::parse(&source.url).unwrap();
    let prefix = format!("{}/", base.path().trim_end_matches('/'));
    let mut seen = HashSet::new();
    let mut items = Vec::new();
    for link in doc.select("a[href]").iter() {
        let Some(href) = link.attr("href") else {
            continue;
        };
        let Ok(mut url) = base.join(&href) else {
            continue;
        };
        if url.host_str() != Some("github.com") || !url.path().starts_with(&prefix) {
            continue;
        }
        let path = url.path().trim_start_matches(prefix.as_str()).to_string();
        if !path.starts_with("blob/") && !path.starts_with("tree/") {
            continue;
        }
        let lower = path.to_lowercase();
        if path.starts_with("blob/")
            && ![".md", ".rst", ".pdf", ".ipynb"]
                .iter()
                .any(|ext| lower.ends_with(ext))
        {
            continue;
        }
        if ["agents.md", "contributing", ".github/", "license"]
            .iter()
            .any(|s| lower.contains(s))
        {
            continue;
        }
        let Some(kind) = (if lower.contains("readme.") {
            Some("readme")
        } else {
            document_kind(&path)
        }) else {
            continue;
        };
        url.set_fragment(None);
        if !seen.insert(url.to_string()) {
            continue;
        }
        let label = plain(&link.text(), 200);
        items.push(Item { title: if label.is_empty() { path.to_string() } else { label }, url: url.to_string(), summary: format!("GitHub 公共接口暂不可用，此资料由仓库网页公开链接识别。路径：{path}。文件目录可能不完整，可打开仓库继续查找。"), category: source.category.clone(), source: source.name.clone(), source_kind: "github".into(), kind: kind.into(), published_at: None });
    }
    items.truncate(40);
    items
}

pub(super) async fn github(source: &Source) -> Result<Vec<Item>, String> {
    let mut items = match github_tree(source).await {
        Ok(items) => items,
        Err(error) => {
            let raw = text(&source.url)
                .await
                .map_err(|e| format!("{error}；仓库网页也无法获取：{e}"))?;
            let items = github_page(&raw, source);
            if items.is_empty() {
                return Err(format!("{error}；仓库网页未识别到技术文档"));
            }
            items
        }
    };
    // No-release repositories still provide useful SDK/README documentation.
    let release_source = Source {
        kind: "release".into(),
        url: format!("{}/releases.atom", source.url),
        ..source.clone()
    };
    if let Ok(raw) = text(&release_source.url).await {
        if let Ok(releases) = super::parse(&raw, &release_source) {
            items.extend(releases);
        }
    }
    if items.is_empty() {
        return Err("仓库未提供可识别的 README、技术文档或发布记录".into());
    }
    Ok(items)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn redirected_document_links_use_the_response_directory() {
        let source = Source {
            id: "test".into(),
            name: "X2".into(),
            category: "humanoid".into(),
            url: "https://x2-aimdk.agibot.com/".into(),
            kind: "website".into(),
        };
        let items = website_at(
            r#"<title>SDK</title><a href="Interface/index.html">API interface</a>"#,
            &source,
            "https://x2-aimdk.agibot.com/en/latest/index.html",
        )
        .unwrap();
        assert!(items
            .iter()
            .any(|i| i.url == "https://x2-aimdk.agibot.com/en/latest/Interface/index.html"));
        assert!(!items
            .iter()
            .any(|i| i.url == "https://x2-aimdk.agibot.com/Interface/index.html"));
    }
    #[test]
    fn domestic_factory_defaults_cover_all_eight_topics() {
        let defaults = defaults();
        let ids: std::collections::HashSet<_> = defaults.iter().map(|s| &s.id).collect();
        assert_eq!(ids.len(), defaults.len());
        for category in [
            "humanoid",
            "wheeled",
            "arm",
            "cobot",
            "joint",
            "sensor",
            "algorithm",
            "system",
        ] {
            assert!(
                defaults.iter().any(|s| s.category == category),
                "missing {category}"
            );
        }
        for id in [
            "dobot-docs",
            "agibot-x2-docs",
            "limx-docs",
            "robstride-manual",
            "orbbec-docs",
        ] {
            assert!(defaults.iter().any(|s| s.id == id));
        }
        assert!(!defaults.iter().any(|s| s.id == "ur-docs"
            || s.id == "mujoco-docs"
            || s.url.contains("huggingface/lerobot")
            || s.url.contains("moveit/moveit2")
            || s.url.contains("ros2/ros2")
            || s.url.contains("google-deepmind/mujoco")));
        assert!(defaults
            .iter()
            .any(|s| s.url.contains("unitree_rl_gym") && s.category == "algorithm"));
        assert!(defaults
            .iter()
            .any(|s| s.url.contains("unitree_ros2") && s.category == "system"));
    }
    #[test]
    fn extracts_real_documents_and_ignores_marketing_and_unsafe_links() {
        let source = Source {
            id: "test".into(),
            name: "官网".into(),
            category: "sensor".into(),
            url: "https://example.com/downloads".into(),
            kind: "website".into(),
        };
        let raw = r#"<html><title>Download center</title><body><div>MID-360 User Manual <a href="https://cdn.example.net/manual.pdf">Download</a></div><a href="/specifications">参数规格</a><a href="/news/launch">新品新闻</a><a href="javascript:alert(1)">SDK</a><a href="/privacy">SDK privacy</a></body></html>"#;
        let items = website(raw, &source).unwrap();
        assert!(items
            .iter()
            .any(|i| i.url == "https://example.com/specifications" && i.kind == "datasheet"));
        assert!(items
            .iter()
            .any(|i| i.title.contains("MID-360") && i.url.ends_with("manual.pdf")));
        assert!(!items.iter().any(|i| i.url.contains("javascript")
            || i.url.contains("privacy")
            || i.url.contains("/news/")));
        assert!(items.iter().all(|i| i.published_at.is_none()));
        assert!(website("<title>Just a moment...</title>", &source).is_err());
    }
    #[test]
    fn repository_finds_docs_without_releases_and_encodes_paths() {
        let source = defaults().into_iter().find(|s| s.kind == "github").unwrap();
        let data = serde_json::json!({"tree":[{"type":"blob","path":"README.md"},{"type":"blob","path":"docs/Hardware Manual.pdf"},{"type":"blob","path":"CONTRIBUTING.md"},{"type":"blob","path":"src/main.cpp"}]});
        let items = github_documents(&data, &source, "main");
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].kind, "readme");
        assert!(items[1].url.contains("Hardware%20Manual.pdf"));
    }
    #[test]
    fn github_web_fallback_keeps_repo_documents_and_rejects_unrelated_links() {
        let source = Source {
            id: "test".into(),
            name: "SDK".into(),
            category: "arm".into(),
            url: "https://github.com/org/robot".into(),
            kind: "github".into(),
        };
        let raw = r#"<a href="/org/robot/blob/main/README.md">README.md</a><a href="/org/robot/tree/main/docs">docs</a><a href="/org/robot/tree/main/.docker">docker</a><a href="/org/robot/blob/main/.readthedocs.yml">doc config</a><a href="/org/robot/blob/main/AGENTS.md">AGENTS.md</a><a href="/other/robot/blob/main/README.md">Other</a><a href="https://docs.github.com/">GitHub Docs</a>"#;
        let items = github_page(raw, &source);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].kind, "readme");
        assert!(items.iter().all(|i| i.summary.contains("可能不完整")));
    }
    #[test]
    fn extracts_embedded_official_download_metadata_without_running_scripts() {
        let source = defaults()
            .into_iter()
            .find(|s| s.kind == "website")
            .unwrap();
        let raw = r#"<title>Downloads</title><script type="application/json">[{"url":1,"originalName":2},"/raw/product-documents/123.pdf","SCOUT 2.0 用户手册.pdf"]</script>"#;
        let items = website(raw, &source).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].kind, "manual");
        assert!(items[0].title.contains("SCOUT"));
        assert!(items[0].url.ends_with("/raw/product-documents/123.pdf"));
        let portal = website(
            "<title>机器人文档中心</title><script src='/app.js'></script>",
            &source,
        )
        .unwrap();
        assert_eq!(portal[0].kind, "portal");
        assert!(portal[0].summary.contains("尚未读取"));
    }
}
