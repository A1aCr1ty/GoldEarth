use super::music::{has_audio_header, read_limited};
use once_cell::sync::Lazy;
use reqwest::{redirect::Policy, Url};
use serde_json::{json, Value};
use std::time::Duration;

const MAX_AUDIO: usize = 80 * 1024 * 1024;
static CLIENT: Lazy<reqwest::Client> = Lazy::new(|| {
    reqwest::Client::builder()
        .user_agent("GoldEarth/1.0 (https://github.com/A1aCr1ty/GoldEarth)")
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(22))
        .redirect(Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 || !catalog_url(attempt.url()) {
                attempt.error("音源重定向地址不受支持")
            } else {
                attempt.follow()
            }
        }))
        .build()
        .expect("Music catalog client")
});

fn catalog_url(url: &Url) -> bool {
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port_or_known_default() == Some(443)
        && url.host_str().is_some_and(|host| {
            host == "api.audius.co" || host == "archive.org" || host.ends_with(".archive.org")
        })
}

async fn fetch_json(url: Url) -> Result<Value, String> {
    let response = CLIENT
        .get(url)
        .send()
        .await
        .map_err(|e| format!("音源连接失败，请重试：{e}"))?
        .error_for_status()
        .map_err(|e| format!("音源暂不可用：{e}"))?;
    serde_json::from_slice(&read_limited(response, 6 * 1024 * 1024).await?)
        .map_err(|_| "音源返回了无效数据".into())
}

fn valid_identifier(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 256
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
        && id != "."
        && id != ".."
}

pub(super) fn open_license(data: &Value) -> bool {
    let license = &data["metadata"]["licenseurl"];
    let values: Vec<&str> = if let Some(s) = license.as_str() {
        vec![s]
    } else {
        license
            .as_array()
            .map(|a| a.iter().filter_map(Value::as_str).collect())
            .unwrap_or_default()
    };
    values.iter().any(|value| {
        Url::parse(value).ok().is_some_and(|url| {
            matches!(url.scheme(), "http" | "https")
                && matches!(
                    url.host_str(),
                    Some("creativecommons.org" | "www.creativecommons.org")
                )
                && (url.path().starts_with("/licenses/")
                    || url.path().starts_with("/publicdomain/"))
        })
    })
}

fn is_true(value: &Value) -> bool {
    value.as_bool() == Some(true) || value.as_str() == Some("true")
}

fn archive_file<'a>(data: &'a Value, filename: &str) -> Result<&'a Value, String> {
    if !open_license(data)
        || is_true(&data["is_dark"])
        || is_true(&data["metadata"]["access-restricted-item"])
        || is_true(&data["metadata"]["nodownload"])
    {
        return Err("此录音没有可导入的开放授权，或已限制下载".into());
    }
    if filename.is_empty() || filename.split('/').any(|part| part == ".." || part == ".") {
        return Err("无效音频文件名".into());
    }
    let extension = filename
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(
        extension.as_str(),
        "mp3" | "ogg" | "oga" | "flac" | "wav" | "m4a" | "aac" | "opus" | "aif" | "aiff" | "webm"
    ) {
        return Err("文件格式不受支持".into());
    }
    let file = data["files"]
        .as_array()
        .and_then(|files| files.iter().find(|f| f["name"].as_str() == Some(filename)))
        .ok_or("音频文件已下架，请重新搜索")?;
    let size = file["size"]
        .as_u64()
        .or_else(|| file["size"].as_str().and_then(|s| s.parse().ok()))
        .unwrap_or(0);
    if is_true(&file["private"]) || size == 0 || size > MAX_AUDIO as u64 {
        return Err("音频无法下载或超过 80 MB".into());
    }
    Ok(file)
}

async fn archive_metadata(identifier: &str) -> Result<Value, String> {
    if !valid_identifier(identifier) {
        return Err("无效录音编号".into());
    }
    fetch_json(Url::parse(&format!("https://archive.org/metadata/{identifier}")).unwrap()).await
}

async fn archive_search(query: &str, offset: u32) -> Result<Value, String> {
    let escaped = query.replace('\\', "\\\\").replace('"', "\\\"");
    let filter = format!("mediatype:audio AND (\"{escaped}\") AND licenseurl:(*creativecommons.org*) AND (collection:netlabels OR collection:audio_music OR collection:opensource_audio)");
    let mut url = Url::parse("https://archive.org/advancedsearch.php").unwrap();
    url.query_pairs_mut().extend_pairs([
        ("q", filter.as_str()),
        ("fl[]", "identifier"),
        ("rows", "6"),
        ("page", &(offset / 6 + 1).to_string()),
        ("sort[]", "downloads desc"),
        ("output", "json"),
    ]);
    let result = fetch_json(url).await?;
    let docs = result["response"]["docs"]
        .as_array()
        .ok_or("录音搜索响应不完整")?;
    let total = result["response"]["numFound"]
        .as_u64()
        .ok_or("录音搜索缺少结果数量")?;
    let ids: Vec<String> = docs
        .iter()
        .filter_map(|d| d["identifier"].as_str())
        .filter(|id| valid_identifier(id))
        .map(str::to_string)
        .collect();
    let mut records = Vec::new();
    let mut warnings = Vec::new();
    // Three metadata requests at a time; one unavailable recording must not discard the others.
    for group in ids.chunks(3) {
        let mut tasks = tokio::task::JoinSet::new();
        for id in group {
            let id = id.clone();
            tasks.spawn(async move { archive_metadata(&id).await });
        }
        while let Some(result) = tasks.join_next().await {
            match result {
                Ok(Ok(data)) => records.push(data),
                _ => warnings.push("部分录音暂时无法读取，可加载更多或重试"),
            }
        }
    }
    // Keep the archive's relevance order despite parallel metadata requests.
    records.sort_by_key(|data| {
        ids.iter()
            .position(|id| Some(id.as_str()) == data["metadata"]["identifier"].as_str())
            .unwrap_or(usize::MAX)
    });
    Ok(
        json!({ "records": records, "nextOffset": if (offset as u64 + 6) < total { Some(offset + 6) } else { None }, "warnings": warnings }),
    )
}

#[tauri::command]
pub async fn music_catalog_search(
    source: String,
    query: String,
    offset: u32,
) -> Result<Value, String> {
    let query = query.trim();
    if query.is_empty() || query.chars().count() > 120 || offset > 10000 {
        return Err("请输入 1–120 字的搜索词，或重新开始搜索".into());
    }
    match source.as_str() {
        "archive" => archive_search(query, offset).await,
        "audius" => {
            let mut url = Url::parse("https://api.audius.co/v1/tracks/search").unwrap();
            url.query_pairs_mut().extend_pairs([
                ("query", query),
                ("limit", "20"),
                ("offset", &offset.to_string()),
                ("app_name", "GoldEarth"),
            ]);
            fetch_json(url).await
        }
        _ => Err("不支持的音乐来源".into()),
    }
}

async fn archive_download(identifier: &str, filename: &str) -> Result<Vec<u8>, String> {
    let data = archive_metadata(identifier).await?;
    archive_file(&data, filename)?;
    let mut url = Url::parse("https://archive.org/download/").unwrap();
    url.path_segments_mut()
        .unwrap()
        .pop_if_empty()
        .push(identifier)
        .extend(filename.split('/'));
    let response = CLIENT
        .get(url)
        .timeout(Duration::from_secs(90))
        .send()
        .await
        .map_err(|e| format!("录音下载失败：{e}"))?
        .error_for_status()
        .map_err(|e| format!("录音无法下载：{e}"))?;
    let bytes = read_limited(response, MAX_AUDIO).await?;
    if !has_audio_header(&bytes) {
        return Err("下载内容不是有效音频，未加入曲库".into());
    }
    Ok(bytes)
}

#[tauri::command]
pub async fn music_archive_download(
    identifier: String,
    filename: String,
) -> Result<tauri::ipc::Response, String> {
    Ok(tauri::ipc::Response::new(
        archive_download(&identifier, &filename).await?,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn archive_download_requires_open_license_and_public_audio() {
        let mut data = json!({"metadata":{"licenseurl":"https://creativecommons.org/licenses/by/4.0/"},
            "files":[{"name":"Song.mp3","size":"2048"}]});
        assert!(archive_file(&data, "Song.mp3").is_ok());
        assert!(archive_file(&data, "../Song.mp3").is_err());
        assert!(archive_file(&data, "page.html").is_err());
        data["files"][0]["private"] = json!(true);
        assert!(archive_file(&data, "Song.mp3").is_err());
        data["files"][0]["private"] = json!(false);
        data["metadata"]["licenseurl"] =
            json!("https://creativecommons.org.evil.test/licenses/by/4.0/");
        assert!(archive_file(&data, "Song.mp3").is_err());
        assert!(!valid_identifier("../secret"));
        assert!(!catalog_url(
            &Url::parse("https://archive.org.evil.test/a").unwrap()
        ));
        assert!(!catalog_url(&Url::parse("https://127.0.0.1/a").unwrap()));
    }

    #[tokio::test]
    #[ignore = "requires Audius and Archive network access"]
    async fn live_catalogs() {
        let audius = music_catalog_search("audius".into(), "jazz".into(), 0)
            .await
            .unwrap();
        assert!(!audius["data"].as_array().unwrap().is_empty());
        let archive = music_catalog_search("archive".into(), "jazz".into(), 0)
            .await
            .unwrap();
        let records = archive["records"].as_array().unwrap();
        assert!(records.iter().any(open_license));
        let (record, file) = records
            .iter()
            .flat_map(|r| {
                r["files"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(move |f| (r, f))
            })
            .find(|(r, f)| {
                f["name"].as_str().is_some_and(|name| {
                    name.ends_with(".mp3")
                        && archive_file(r, name).is_ok()
                        && f["size"]
                            .as_str()
                            .and_then(|s| s.parse::<usize>().ok())
                            .unwrap_or(usize::MAX)
                            < 5_000_000
                })
            })
            .expect("small licensed MP3");
        let bytes = archive_download(
            record["metadata"]["identifier"].as_str().unwrap(),
            file["name"].as_str().unwrap(),
        )
        .await
        .unwrap();
        assert!(has_audio_header(&bytes));
    }
}
