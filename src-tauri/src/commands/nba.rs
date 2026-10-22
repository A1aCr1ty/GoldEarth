use chrono::{Duration, NaiveDate};
use once_cell::sync::Lazy;
use serde_json::{json, Value};

static CLIENT: Lazy<reqwest::Client> = Lazy::new(|| {
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(8))
        .timeout(std::time::Duration::from_secs(20))
        .user_agent("GoldEarth/1.0")
        .build()
        .expect("NBA HTTP client")
});
const BASE: &str = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";

async fn fetch(url: String) -> Result<Value, String> {
    for attempt in 0..2 {
        let response = CLIENT.get(&url).send().await;
        let retry = match &response {
            Err(e) => e.is_timeout() || e.is_connect(),
            Ok(r) => r.status().is_server_error() || r.status().as_u16() == 429,
        };
        if attempt == 0 && retry {
            tokio::time::sleep(std::time::Duration::from_millis(750)).await;
            continue;
        }
        return response.map_err(|e| format!("NBA 数据连接失败：{e}"))?
            .error_for_status().map_err(|e| format!("NBA 数据服务暂不可用：{e}"))?
            .json().await.map_err(|e| format!("NBA 数据解析失败：{e}"));
    }
    unreachable!()
}

fn query_dates(date: &str) -> Result<(String, String), String> {
    let day = NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map_err(|_| "请选择有效日期".to_string())?;
    let previous = day.checked_sub_signed(Duration::days(1))
        .ok_or_else(|| "日期超出范围".to_string())?;
    Ok((previous.format("%Y%m%d").to_string(), day.format("%Y%m%d").to_string()))
}

/// 北京时间的一天横跨两个美国比赛日；前端按实际开赛时间再次筛选。
#[tauri::command]
pub async fn nba_scoreboard(date: String) -> Result<Value, String> {
    let (previous, current) = query_dates(&date)?;
    let (a, b) = tokio::try_join!(
        fetch(format!("{BASE}/scoreboard?dates={previous}&limit=100")),
        fetch(format!("{BASE}/scoreboard?dates={current}&limit=100"))
    )?;
    let mut events = Vec::new();
    for response in [&a, &b] {
        let rows = response["events"].as_array()
            .ok_or_else(|| "NBA 赛程响应不完整，请稍后重试".to_string())?;
        events.extend(rows.iter().cloned());
    }
    Ok(json!({ "events": events }))
}

#[tauri::command]
pub async fn nba_summary(event_id: String) -> Result<Value, String> {
    if event_id.is_empty() || event_id.len() > 20 || !event_id.bytes().all(|b| b.is_ascii_digit()) {
        return Err("无效的比赛编号".into());
    }
    fetch(format!("{BASE}/summary?event={event_id}")).await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn dates_cover_previous_day_and_year_boundary() {
        assert_eq!(query_dates("2026-01-01").unwrap(), ("20251231".into(), "20260101".into()));
        assert!(query_dates("2026-02-30").is_err());
        assert!(query_dates("invalid").is_err());
    }

    #[tokio::test]
    #[ignore = "requires ESPN network access"]
    async fn live_scoreboard_and_summary() {
        let board = nba_scoreboard("2025-06-23".into()).await.unwrap();
        let events = board["events"].as_array().unwrap();
        assert!(!events.is_empty(), "historical NBA finals scoreboard must contain games");
        let id = events[0]["id"].as_str().unwrap();
        let summary = nba_summary(id.into()).await.unwrap();
        assert!(summary["boxscore"]["teams"].as_array().is_some());
        assert!(summary["boxscore"]["players"].as_array().is_some());
    }
}
