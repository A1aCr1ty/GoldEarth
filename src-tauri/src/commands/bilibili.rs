use serde_json::Value;

fn valid_id(value: &str) -> bool {
    !value.is_empty() && value.len() <= 20 && value.bytes().all(|b| b.is_ascii_digit())
}

#[tauri::command]
pub async fn bilibili_data(kind: String, id: String, offset: Option<String>, page: Option<u32>, reply_type: Option<u32>, cookie: Option<String>, sort: Option<u32>) -> Result<Value, String> {
    if !valid_id(&id) { return Err("无效的 Bilibili ID".into()); }
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(20))
        .user_agent("Mozilla/5.0 GoldEarth/1.0").build().map_err(|e| e.to_string())?;
    let mut request = match kind.as_str() {
        "feed" => client.get("https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space")
            .query(&[("host_mid", id), ("offset", offset.unwrap_or_default())]),
        "comments" => {
            let order = sort.unwrap_or(0);
            if ![0, 2].contains(&order) { return Err("不支持的评论排序".into()); }
            let t = reply_type.unwrap_or(17);
            if ![1, 11, 12, 17].contains(&t) { return Err("暂不支持此动态的评论类型".into()); }
            client.get("https://api.bilibili.com/x/v2/reply").query(&[
                ("oid", id), ("type", t.to_string()), ("pn", page.unwrap_or(1).max(1).to_string()),
                ("ps", "20".into()), ("sort", order.to_string())])
        },
        _ => return Err("不支持的请求".into()),
    }.header("Referer", "https://www.bilibili.com/");
    if let Some(cookie) = cookie.filter(|v| !v.trim().is_empty()) {
        if cookie.contains('\n') || cookie.contains('\r') { return Err("Cookie 格式不正确".into()); }
        request = request.header("Cookie", cookie);
    }
    let response = request.send().await.map_err(|_| "连接 Bilibili 失败，请稍后重试".to_string())?;
    if !response.status().is_success() { return Err(format!("Bilibili HTTP {}，请稍后重试", response.status())); }
    let body: Value = response.json().await.map_err(|_| "Bilibili 返回了非 JSON 数据，可能需要登录或验证".to_string())?;
    match body.get("code").and_then(Value::as_i64) {
        Some(0) => body.get("data").filter(|v| !v.is_null()).cloned().ok_or_else(|| "未返回数据".into()),
        Some(code) => Err(format!("Bilibili 返回 {code}：{}。可能需要登录 Cookie，或稍后再试。", body["message"].as_str().unwrap_or("请求被拒绝"))),
        None => Err("Bilibili 响应格式异常".into()),
    }
}

#[cfg(windows)]
fn protect_cookie(bytes: &[u8], decrypt: bool) -> Result<Vec<u8>, String> {
    #[repr(C)]
    struct Blob { len: u32, data: *mut u8 }
    #[link(name = "crypt32")]
    extern "system" {
        fn CryptProtectData(input: *const Blob, description: *const u16, entropy: *const Blob, reserved: *mut std::ffi::c_void, prompt: *mut std::ffi::c_void, flags: u32, output: *mut Blob) -> i32;
        fn CryptUnprotectData(input: *const Blob, description: *mut *mut u16, entropy: *const Blob, reserved: *mut std::ffi::c_void, prompt: *mut std::ffi::c_void, flags: u32, output: *mut Blob) -> i32;
    }
    #[link(name = "kernel32")]
    extern "system" { fn LocalFree(ptr: *mut std::ffi::c_void) -> *mut std::ffi::c_void; }
    let input = Blob { len: bytes.len() as u32, data: bytes.as_ptr() as *mut u8 };
    let mut output = Blob { len: 0, data: std::ptr::null_mut() };
    unsafe {
        let ok = if decrypt {
            CryptUnprotectData(&input, std::ptr::null_mut(), std::ptr::null(), std::ptr::null_mut(), std::ptr::null_mut(), 1, &mut output)
        } else {
            CryptProtectData(&input, std::ptr::null(), std::ptr::null(), std::ptr::null_mut(), std::ptr::null_mut(), 1, &mut output)
        };
        if ok == 0 { return Err("Windows 凭据加密或解密失败，请重新保存 Cookie".into()); }
        let result = std::slice::from_raw_parts(output.data, output.len as usize).to_vec();
        LocalFree(output.data.cast());
        Ok(result)
    }
}
#[cfg(not(windows))]
fn protect_cookie(_bytes: &[u8], _decrypt: bool) -> Result<Vec<u8>, String> { Err("此平台暂不支持加密保存 Cookie".into()) }

#[tauri::command]
pub fn bilibili_cookie(app: tauri::AppHandle, value: Option<String>) -> Result<String, String> {
    use tauri::Manager;
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let path = dir.join("bilibili-cookie.dpapi");
    if let Some(value) = value {
        if value.is_empty() {
            match std::fs::remove_file(&path) {
                Ok(()) => (),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
                Err(_) => return Err("清除 Cookie 失败".into()),
            }
        } else {
            if value.len() > 65536 || value.contains(['\r', '\n']) { return Err("Cookie 格式不正确".into()); }
            let encrypted = protect_cookie(value.as_bytes(), false)?;
            std::fs::create_dir_all(dir).map_err(|_| "无法创建凭据目录")?;
            std::fs::write(path, encrypted).map_err(|_| "保存 Cookie 失败")?;
        }
        return Ok(String::new());
    }
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(String::new()),
        Err(_) => return Err("读取已保存 Cookie 失败".into()),
    };
    String::from_utf8(protect_cookie(&bytes, true)?).map_err(|_| "Cookie 数据损坏，请重新保存".into())
}

#[cfg(all(test, windows))]
mod cookie_tests {
    #[test]
    fn encrypted_cookie_roundtrip() {
        let original = b"SESSDATA=test-only; bili_jct=test";
        let encrypted = super::protect_cookie(original, false).unwrap();
        assert_ne!(encrypted, original);
        assert_eq!(super::protect_cookie(&encrypted, true).unwrap(), original);
        assert!(super::protect_cookie(b"corrupt", true).is_err());
    }
}
