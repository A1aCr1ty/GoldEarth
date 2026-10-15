//! 应用内阅读：把外部链接开在 App 自己的窗口里，而不是甩给系统浏览器。
//!
//! 为什么用独立窗口、而不是在页面上盖一层 `<iframe>`：
//! 这几个平台的页面大多带 `X-Frame-Options` / CSP `frame-ancestors`，
//! iframe 里会直接拒绝渲染。独立 WebView 走的是 App 自己的 WebView2，
//! 不受跨源限制，页面也能正常跑自己的脚本。
//!
//! 安全上刻意不给它开任何远程权限：capability 的 `windows` 只授予
//! `Local` 上下文，远程页面必须命中 `remote.urls` 才能调 IPC，
//! 而我们没有配置任何 `remote` 条目——所以阅读器里打开的网页
//! （包括它自己后续的跳转）拿不到任何 App 权限。

use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};

/// 阅读器窗口的 label。全 App 只开一个，反复点条目时复用同一个窗口，
/// 而不是每次甩出一扇新窗把桌面铺满
const READER_LABEL: &str = "reader";
/// 相对主窗口的大小比例
const RATIO: f64 = 0.82;
/// 太小就没法读了，但也不该小到装不下一个列表
const MIN_W: u32 = 900;
const MIN_H: u32 = 620;
/// 找不到主窗口时的兜底尺寸
const FALLBACK: (i32, i32, u32, u32) = (120, 80, 1100, 720);

/// 只放行 http/https。
///
/// `file:` 会把本地文件开进窗口，`javascript:` / `data:` 更不用说——
/// 这条校验的价值在于：URL 来自热榜接口（外部数据），
/// 不该由它决定我们往 WebView 里塞什么。
fn parse_reader_url(raw: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(raw.trim()).map_err(|e| format!("链接格式不对：{e}"))?;
    match url.scheme() {
        "http" | "https" => Ok(url),
        other => Err(format!("不支持的链接协议：{other}")),
    }
}

/// 窗口标题栏放不下太长的标题，按字符截（中文不会被切出半个字）
fn clip_title(title: &str) -> String {
    const MAX: usize = 60;
    let t = title.trim();
    if t.chars().count() <= MAX {
        return t.to_string();
    }
    let cut: String = t.chars().take(MAX).collect();
    format!("{cut}…")
}

/// 按主窗口的位置和大小，算阅读器的落点与尺寸。
///
/// 覆盖主窗口的 82%，并且**永远不会比主窗口还大**：主窗口没开满屏时，
/// 阅读器大过主窗口会显得很怪。最小尺寸也一并夹住。
fn reader_geometry(pos: (i32, i32), size: (u32, u32)) -> (i32, i32, u32, u32) {
    let (mx, my) = pos;
    let (mw, mh) = size;
    if mw == 0 || mh == 0 {
        return FALLBACK;
    }
    fn fit(px: u32, min: u32) -> u32 {
        let want = (px as f64 * RATIO).round() as u32;
        // min(px) 封顶、max(min.min(px)) 保底：主窗口比 min 还小时就取主窗口大小
        want.min(px).max(min.min(px))
    }
    let w = fit(mw, MIN_W);
    let h = fit(mh, MIN_H);
    let x = mx + (mw.saturating_sub(w) / 2) as i32;
    let y = my + (mh.saturating_sub(h) / 2) as i32;
    (x, y, w, h)
}

/// 读主窗口的物理尺寸；主窗口还没建好就用兜底值
fn geometry_of(app: &AppHandle) -> (i32, i32, u32, u32) {
    let Some(main) = app.get_webview_window("main") else {
        return FALLBACK;
    };
    let pos = main.outer_position().unwrap_or(PhysicalPosition::new(0, 0));
    let size = main.outer_size().unwrap_or(PhysicalSize::new(1200, 780));
    reader_geometry((pos.x, pos.y), (size.width, size.height))
}

/// 在应用内打开一个链接。
///
/// 已经开着阅读器就复用：直接导航过去 + 聚焦，
/// 不再新开一扇窗（连续点十条热榜只会有一扇窗在原地换页）。
///
/// **必须是 `async` 命令**：Tauri 文档在 `WebviewWindowBuilder::new` 上写明
/// 「On Windows, this function deadlocks when used in a synchronous command
/// and event handlers... You should use `async` commands and separate threads
/// when creating windows.」（tauri 2.12.3 `src/webview/webview_window.rs`）
///
/// 症状就是窗口照常弹出来、标题也对，但内容一片空白还卡住——
/// 以为是渲染问题，其实是建窗口时死锁了。改成 `async`（命令跑在线程池上）就好。
#[tauri::command]
pub async fn open_reader(app: AppHandle, url: String, title: Option<String>) -> Result<(), String> {
    let url = parse_reader_url(&url)?;
    let title = clip_title(title.as_deref().unwrap_or(""));
    let heading = if title.is_empty() {
        "阅读".to_string()
    } else {
        title
    };

    if let Some(reader) = app.get_webview_window(READER_LABEL) {
        reader
            .navigate(url)
            .map_err(|e| format!("切换页面失败：{e}"))?;
        let _ = reader.set_title(&heading);
        let _ = reader.show();
        return reader
            .set_focus()
            .map_err(|e| format!("聚焦阅读器失败：{e}"));
    }

    let (x, y, w, h) = geometry_of(&app);
    // 构建器收的是逻辑单位（逻辑像素），换算回主窗口的缩放比，
    // 这样 125% / 150% 缩放下阅读器不会比主窗口大一圈
    let scale = app
        .get_webview_window("main")
        .and_then(|m| m.scale_factor().ok())
        .unwrap_or(1.0);

    WebviewWindowBuilder::new(&app, READER_LABEL, WebviewUrl::External(url))
        .title(heading)
        .position(x as f64 / scale, y as f64 / scale)
        .inner_size(w as f64 / scale, h as f64 / scale)
        .min_inner_size(MIN_W as f64 / scale, MIN_H as f64 / scale)
        .resizable(true)
        .build()
        .map_err(|e| format!("打开阅读器失败：{e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_http_urls_are_accepted() {
        assert!(parse_reader_url("https://www.bilibili.com/video/BV1").is_ok());
        assert!(parse_reader_url("  http://a.example/x  ").is_ok());

        // URL 来自热榜接口，是外部数据：不该由它决定我们往 WebView 里塞什么
        for bad in [
            "file:///C:/Windows/System32/cmd.exe",
            "javascript:alert(1)",
            "data:text/html,<h1>hi</h1>",
            "ftp://example.com/x",
        ] {
            let err = parse_reader_url(bad).unwrap_err();
            assert!(err.contains("协议"), "{bad} 应该被拒：{err}");
        }
        assert!(parse_reader_url("不是链接").is_err());
    }

    #[test]
    fn clips_long_titles_by_chars() {
        assert_eq!(clip_title("  短标题  "), "短标题");
        assert_eq!(clip_title(""), "");
        let long = "词".repeat(80);
        let out = clip_title(&long);
        assert_eq!(out.chars().count(), 61, "60 个字加一个省略号");
        assert!(out.ends_with('…'));
    }

    #[test]
    fn reader_covers_the_main_window_without_exceeding_it() {
        // 常见的最大化窗口
        let (x, y, w, h) = reader_geometry((0, 0), (1920, 1080));
        assert_eq!((w, h), (1574, 886));
        assert_eq!(
            (x, y),
            ((1920 - 1574) / 2, (1080 - 886) / 2),
            "要在主窗口里居中"
        );

        // 基准尺寸（1200×780）下略小一点
        let (_, _, w, h) = reader_geometry((100, 50), (1200, 780));
        assert_eq!((w, h), (984, 640));

        // 主窗口比最小尺寸还小：取主窗口大小，不能大过主窗口
        let (x, y, w, h) = reader_geometry((10, 20), (700, 500));
        assert_eq!((w, h), (700, 500));
        assert_eq!((x, y), (10, 20), "一样大时就贴齐左上角");

        // 尺寸异常时退回兜底值，别算出乱七八糟的位置
        assert_eq!(reader_geometry((0, 0), (0, 780)), FALLBACK);
    }

    #[test]
    fn geometry_stays_inside_the_main_window() {
        for (mw, mh) in [
            (1920u32, 1080u32),
            (1440, 900),
            (1200, 780),
            (960, 640),
            (700, 500),
        ] {
            let (mx, my) = (37, 53);
            let (x, y, w, h) = reader_geometry((mx, my), (mw, mh));
            assert!(x >= mx && y >= my, "({mw},{mh}) 阅读器跑到主窗口外面了");
            assert!(x + w as i32 <= mx + mw as i32, "({mw},{mh}) 右边超出去");
            assert!(y + h as i32 <= my + mh as i32, "({mw},{mh}) 下边超出去");
        }
    }
}
