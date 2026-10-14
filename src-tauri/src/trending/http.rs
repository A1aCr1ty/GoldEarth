//! 热榜抓取共用的 HTTP 客户端。
//!
//! 这几个平台都会按 UA 粗筛爬虫，统一挂一个常见桌面浏览器的 UA。
//! 超时比行情那条链路短一点——冲浪页是并发展开四个平台，
//! 慢平台不能把整页拖住。

use std::time::Duration;

use once_cell::sync::Lazy;

pub const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

pub fn client() -> &'static reqwest::Client {
    static CLIENT: Lazy<reqwest::Client> = Lazy::new(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .connect_timeout(Duration::from_secs(5))
            .user_agent(UA)
            .build()
            .expect("构建热榜 HTTP 客户端失败")
    });
    &CLIENT
}
