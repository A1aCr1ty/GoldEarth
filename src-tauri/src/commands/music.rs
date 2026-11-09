use once_cell::sync::Lazy;
use reqwest::{redirect::Policy, Url};
use serde_json::Value;
use std::time::Duration;

const API: &str = "https://commons.wikimedia.org/w/api.php";
const MAX_AUDIO_BYTES: usize = 80 * 1024 * 1024;
static CLIENT: Lazy<reqwest::Client> = Lazy::new(|| {
    reqwest::Client::builder()
        .user_agent("GoldEarth/1.0 (personal audio library; https://github.com/A1aCr1ty/GoldEarth)")
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(25))
        .redirect(Policy::custom(|attempt| {
            if attempt.previous().len() >= 4 || !allowed_url(attempt.url()) {
                attempt.error("音频服务重定向到不支持的地址")
            } else {
                attempt.follow()
            }
        }))
        .build()
        .expect("Music HTTP client")
});

fn allowed_url(url: &Url) -> bool {
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port_or_known_default() == Some(443)
        && matches!(
            url.host_str(),
            Some("commons.wikimedia.org" | "upload.wikimedia.org")
        )
}

pub(super) async fn read_limited(
    mut response: reqwest::Response,
    limit: usize,
) -> Result<Vec<u8>, String> {
    if response
        .content_length()
        .is_some_and(|size| size > limit as u64)
    {
        return Err("文件超过大小限制（音频最大 80 MB）".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("音频服务读取失败：{e}"))?
    {
        if bytes.len().saturating_add(chunk.len()) > limit {
            return Err("文件超过大小限制（音频最大 80 MB）".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

async fn metadata(params: &[(&str, String)]) -> Result<Value, String> {
    let response = CLIENT
        .get(API)
        .query(&[
            ("action", "query"),
            ("format", "json"),
            ("prop", "imageinfo"),
            ("iiprop", "url|size|mime|extmetadata"),
            ("iiextmetadatalanguage", "zh"),
        ])
        .query(params)
        .send()
        .await
        .map_err(|e| format!("无法连接公开音频服务，请检查网络后重试：{e}"))?
        .error_for_status()
        .map_err(|e| format!("公开音频服务暂不可用：{e}"))?;
    let data: Value = serde_json::from_slice(&read_limited(response, 4 * 1024 * 1024).await?)
        .map_err(|_| "音频搜索返回了无效数据".to_string())?;
    if data.get("error").is_some() {
        return Err("音频服务无法处理此搜索，请换个关键词重试".into());
    }
    Ok(data)
}

#[tauri::command]
pub async fn music_search(query: String, offset: u32) -> Result<Value, String> {
    let query = query.trim();
    if query.is_empty() || query.chars().count() > 120 || offset > 10000 {
        return Err("请输入 1–120 字的搜索词，或重新开始搜索".into());
    }
    metadata(&[
        ("generator", "search".into()),
        ("gsrsearch", format!("{query} filetype:audio")),
        ("gsrnamespace", "6".into()),
        ("gsrlimit", "20".into()),
        ("gsroffset", offset.to_string()),
    ])
    .await
}

fn audio_info(data: &Value, page_id: u64) -> Result<(&str, &str), String> {
    let page = &data["query"]["pages"][page_id.to_string()];
    let info = &page["imageinfo"][0];
    let url = info["url"]
        .as_str()
        .ok_or("音频已下架或无法下载，请重新搜索")?;
    let parsed = Url::parse(url).map_err(|_| "音频下载地址无效")?;
    let mime = info["mime"].as_str().unwrap_or("");
    let title = page["title"].as_str().unwrap_or("");
    let extension = title.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    if !allowed_url(&parsed)
        || parsed.host_str() != Some("upload.wikimedia.org")
        || !parsed.path().starts_with("/wikipedia/commons/")
        || !(mime.starts_with("audio/") || mime == "application/ogg")
        || !matches!(
            extension.as_str(),
            "mp3"
                | "wav"
                | "flac"
                | "m4a"
                | "aac"
                | "ogg"
                | "oga"
                | "opus"
                | "webm"
                | "aif"
                | "aiff"
        )
    {
        return Err("此结果不是可导入的音频文件".into());
    }
    if info["size"].as_u64().unwrap_or(0) > MAX_AUDIO_BYTES as u64 {
        return Err("此音频超过 80 MB，请选择较小的文件".into());
    }
    Ok((url, mime))
}

pub(super) fn has_audio_header(bytes: &[u8]) -> bool {
    bytes.starts_with(b"ID3")
        || bytes.starts_with(b"OggS")
        || bytes.starts_with(b"fLaC")
        || (bytes.len() >= 12
            && ((&bytes[..4] == b"RIFF" && &bytes[8..12] == b"WAVE")
                || &bytes[4..8] == b"ftyp"
                || (&bytes[..4] == b"FORM" && matches!(&bytes[8..12], b"AIFF" | b"AIFC"))))
        || (bytes.len() >= 2 && bytes[0] == 0xff && bytes[1] & 0xe0 == 0xe0)
        || bytes.starts_with(&[0x1a, 0x45, 0xdf, 0xa3])
}

async fn download(page_id: u64) -> Result<Vec<u8>, String> {
    if page_id == 0 {
        return Err("音频编号无效".into());
    }
    // Re-resolve the API's file URL; the webview cannot turn this command into an arbitrary URL fetcher.
    let data = metadata(&[("pageids", page_id.to_string())]).await?;
    let (url, _) = audio_info(&data, page_id)?;
    let response = CLIENT
        .get(url)
        .timeout(Duration::from_secs(90))
        .send()
        .await
        .map_err(|e| format!("音频下载失败，请重试：{e}"))?
        .error_for_status()
        .map_err(|e| format!("音频无法下载：{e}"))?;
    let bytes = read_limited(response, MAX_AUDIO_BYTES).await?;
    if !has_audio_header(&bytes) {
        return Err("下载内容不是有效音频，未加入曲库".into());
    }
    Ok(bytes)
}

#[tauri::command]
pub async fn music_download(page_id: u64) -> Result<tauri::ipc::Response, String> {
    Ok(tauri::ipc::Response::new(download(page_id).await?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn urls_and_file_types_are_restricted() {
        for url in [
            "http://upload.wikimedia.org/a",
            "https://upload.wikimedia.org.evil.test/a",
            "https://127.0.0.1/a",
            "https://upload.wikimedia.org:8443/a",
            "https://user@upload.wikimedia.org/a",
        ] {
            assert!(!allowed_url(&Url::parse(url).unwrap()), "{url}");
        }
        let mut data = json!({"query":{"pages":{"1":{"title":"File:Song.ogg","imageinfo":[{
            "url":"https://upload.wikimedia.org/wikipedia/commons/a/ab/Song.ogg","mime":"audio/ogg","size":100
        }]}}}});
        assert!(audio_info(&data, 1).is_ok());
        data["query"]["pages"]["1"]["imageinfo"][0]["size"] = json!(MAX_AUDIO_BYTES + 1);
        assert!(audio_info(&data, 1).is_err());
        data["query"]["pages"]["1"]["title"] = json!("File:Page.html");
        assert!(audio_info(&data, 1).is_err());
        assert!(audio_info(&json!({}), 1).is_err());
    }

    #[test]
    fn downloaded_html_and_invalid_files_are_rejected() {
        assert!(!has_audio_header(b"<!doctype html><html>error</html>"));
        assert!(!has_audio_header(b""));
        for bytes in [
            &b"OggSdata"[..],
            b"ID3data",
            b"fLaCdata",
            b"RIFF1234WAVEdata",
        ] {
            assert!(has_audio_header(bytes));
        }
    }

    #[tokio::test]
    async fn rejects_invalid_search_input_without_network() {
        assert!(music_search(" ".into(), 0).await.is_err());
        assert!(music_search("a".repeat(121), 0).await.is_err());
        assert!(music_search("piano".into(), 10001).await.is_err());
    }

    #[tokio::test]
    #[ignore = "requires Wikimedia network access"]
    async fn live_search_and_audio_download() {
        let data = music_search("piano".into(), 0).await.unwrap();
        let pages = data["query"]["pages"]
            .as_object()
            .expect("real search results");
        let (id, _) = pages
            .iter()
            .find(|(_, page)| page["imageinfo"][0]["size"].as_u64().unwrap_or(u64::MAX) < 2_000_000)
            .expect("small audio result");
        let bytes = download(id.parse().unwrap()).await.unwrap();
        assert!(has_audio_header(&bytes));
    }
}
