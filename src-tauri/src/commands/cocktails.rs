use serde::{Deserialize, Serialize};
use std::time::Duration;
#[derive(Default, Deserialize)]
struct Rss { channel: Channel }
#[derive(Default, Deserialize)]
struct Channel { #[serde(default)] item: Vec<Entry> }
#[derive(Deserialize)]
struct Entry { title: String, link: String, #[serde(default)] description: String }
#[derive(Serialize)]
pub struct Source { platform: String, items: Vec<Item>, error: Option<String> }
#[derive(Serialize)]
pub struct Item { title: String, url: String, summary: String, platform: String }
fn canonical(raw: &str, domain: &str) -> Option<String> {
 let mut u = reqwest::Url::parse(raw).ok()?;
 if u.scheme() != "https" || !u.host_str().is_some_and(|h| h == domain || h.ends_with(&format!(".{domain}"))) { return None; }
 let p = u.path();
 if !(p.starts_with("/video/") || p.starts_with("/explore/") || p.starts_with("/discovery/item/")) { return None; }
 // Xiaohongshu signed query parameters are required to open some notes.
 if domain != "xiaohongshu.com" { u.set_query(None); }
 u.set_fragment(None); Some(u.into())
}
async fn search(client: &reqwest::Client, platform: &str, domain: &str, keyword: &str) -> Source {
 let result = async {
  let text = client.get("https://www.bing.com/search").query(&[("q",format!("site:{domain} {keyword} 调酒 配方")),("format","rss".into())]).send().await.map_err(|e|e.to_string())?.error_for_status().map_err(|e|e.to_string())?.text().await.map_err(|e|e.to_string())?;
  let rss: Rss = quick_xml::de::from_str(&text).map_err(|_|"搜索源未返回有效结果，可能需要在平台内搜索".to_string())?;
  let items: Vec<Item> = rss.channel.item.into_iter().filter_map(|e| { let url=canonical(&e.link,domain)?; if !format!("{}{}",e.title,e.description).contains("酒") {return None;} Some(Item{title:e.title,url,summary:e.description,platform:platform.into()}) }).take(12).collect();
  if items.is_empty() { return Err("公开搜索未找到可用原帖；可点击平台搜索，登录后查看。".into()); } Ok(items)
 }.await;
 match result { Ok(items)=>Source{platform:platform.into(),items,error:None},Err(error)=>Source{platform:platform.into(),items:vec![],error:Some(error)} }
}
#[tauri::command]
pub async fn cocktail_social_search(keyword: String) -> Result<Vec<Source>, String> {
 let keyword=keyword.trim(); if keyword.is_empty() || keyword.chars().count()>80 {return Err("搜索词需为 1–80 个字".into());}
 let client=reqwest::Client::builder().user_agent("Mozilla/5.0 GoldEarth/0.1").timeout(Duration::from_secs(18)).build().map_err(|e|e.to_string())?;
 let (a,b,c)=tokio::join!(search(&client,"小红书","xiaohongshu.com",keyword),search(&client,"抖音","douyin.com",keyword),search(&client,"Bilibili","bilibili.com",keyword)); Ok(vec![a,b,c])
}
#[cfg(test)] mod tests { use super::*; #[test] fn rejects_untrusted_and_search_urls(){ assert!(canonical("https://bilibili.com.evil.org/video/BV1","bilibili.com").is_none()); assert!(canonical("https://www.bilibili.com/search?q=x","bilibili.com").is_none()); assert_eq!(canonical("https://www.bilibili.com/video/BV1/?x=2","bilibili.com").unwrap(),"https://www.bilibili.com/video/BV1/"); } }
