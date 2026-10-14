//! 天气数据源：Open-Meteo（免密钥、免登录）。
//!
//! - 城市检索：`https://geocoding-api.open-meteo.com/v1/search`
//! - 实时天气与 7 日预报：`https://api.open-meteo.com/v1/forecast`
//!
//! 抓取放在 Rust 侧完成，绕开 WebView 的跨域限制；带一层短 TTL 的内存缓存，
//! 避免首页反复刷新时把公开接口打爆。天气现象只回传 WMO 代码，
//! 中文描述与图标交给前端映射（见 app/src/lib/weatherCodes.ts）。

use std::collections::HashMap;
use std::time::{Duration, Instant};

use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};

const GEO_URL: &str = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL: &str = "https://api.open-meteo.com/v1/forecast";

/// 实时天气缓存短一点，城市检索结果可以留一天。
const TTL_REPORT: Duration = Duration::from_secs(600);
const TTL_GEO: Duration = Duration::from_secs(24 * 3600);

/// 用户没配置城市时用的默认城市
pub const DEFAULT_CITY: &str = "北京";

static CACHE: Lazy<Mutex<HashMap<String, (Instant, serde_json::Value)>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

fn cache_get(key: &str, ttl: Duration) -> Option<serde_json::Value> {
    let guard = CACHE.lock();
    let (at, value) = guard.get(key)?;
    if at.elapsed() > ttl {
        return None;
    }
    Some(value.clone())
}

fn cache_put(key: &str, value: &serde_json::Value) {
    let mut guard = CACHE.lock();
    // 顺手清掉过期条目，避免长时间运行后无限增长
    guard.retain(|_, (at, _)| at.elapsed() < TTL_GEO);
    guard.insert(key.to_string(), (Instant::now(), value.clone()));
}

fn client() -> &'static reqwest::Client {
    static CLIENT: Lazy<reqwest::Client> = Lazy::new(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(12))
            .connect_timeout(Duration::from_secs(6))
            .user_agent("GoldEarth/0.1")
            .build()
            .expect("构建天气 HTTP 客户端失败")
    });
    &CLIENT
}

/// 城市检索结果，坐标用来查天气
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CityOption {
    pub name: String,
    /// 省 / 州
    #[serde(default)]
    pub admin1: String,
    #[serde(default)]
    pub country: String,
    pub latitude: f64,
    pub longitude: f64,
}

/// 实时天气
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeatherNow {
    /// 摄氏度
    pub temperature: f64,
    /// 体感温度
    pub apparent: f64,
    /// 相对湿度 %
    pub humidity: f64,
    /// 当前小时降水量 mm
    pub precipitation: f64,
    /// 风速 km/h
    pub wind_speed: f64,
    pub is_day: bool,
    /// WMO 天气代码
    pub code: i64,
    /// 观测时间（当地时区，形如 2026-10-14T10:30）
    pub time: String,
}

/// 一天的预报
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeatherDay {
    /// YYYY-MM-DD
    pub date: String,
    pub code: i64,
    pub max: f64,
    pub min: f64,
    /// HH:MM
    pub sunrise: String,
    /// HH:MM
    pub sunset: String,
    /// 最大降水概率 %
    pub precipitation_probability: f64,
}

/// 首页天气卡片要的一整份数据
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeatherReport {
    pub city: CityOption,
    /// 地理时区名，例如 Asia/Shanghai
    pub timezone: String,
    pub now: WeatherNow,
    pub days: Vec<WeatherDay>,
    /// 抓取时间（UTC，RFC3339；前端显示时转本地时区）
    pub updated_at: String,
}

#[derive(Deserialize)]
struct GeoResponse {
    #[serde(default)]
    results: Vec<GeoResult>,
}

#[derive(Deserialize)]
struct GeoResult {
    name: String,
    #[serde(default)]
    latitude: Option<f64>,
    #[serde(default)]
    longitude: Option<f64>,
    #[serde(default)]
    country: Option<String>,
    #[serde(default)]
    admin1: Option<String>,
}

#[derive(Deserialize)]
struct ForecastResponse {
    #[serde(default)]
    timezone: String,
    #[serde(default)]
    current: Option<CurrentBlock>,
    #[serde(default)]
    daily: Option<DailyBlock>,
}

#[derive(Deserialize)]
struct CurrentBlock {
    #[serde(default)]
    time: Option<String>,
    #[serde(default)]
    temperature_2m: Option<f64>,
    #[serde(default)]
    relative_humidity_2m: Option<f64>,
    #[serde(default)]
    apparent_temperature: Option<f64>,
    #[serde(default)]
    is_day: Option<i64>,
    #[serde(default)]
    precipitation: Option<f64>,
    #[serde(default)]
    weather_code: Option<i64>,
    #[serde(default)]
    wind_speed_10m: Option<f64>,
}

#[derive(Deserialize)]
struct DailyBlock {
    #[serde(default)]
    time: Vec<String>,
    #[serde(default)]
    weather_code: Vec<i64>,
    #[serde(default)]
    temperature_2m_max: Vec<Option<f64>>,
    #[serde(default)]
    temperature_2m_min: Vec<Option<f64>>,
    #[serde(default)]
    sunrise: Vec<String>,
    #[serde(default)]
    sunset: Vec<String>,
    #[serde(default)]
    precipitation_probability_max: Vec<Option<f64>>,
}

/// 按名字检索城市；命中缓存就不打接口
pub async fn search_cities(query: &str, limit: usize) -> Result<Vec<CityOption>, String> {
    let name = query.trim();
    if name.is_empty() {
        return Err("请先输入城市名称".to_string());
    }
    let limit = limit.clamp(1, 20);
    let key = format!("geo:{name}");
    if let Some(v) = cache_get(&key, TTL_GEO) {
        if let Ok(list) = serde_json::from_value::<Vec<CityOption>>(v) {
            if !list.is_empty() {
                return Ok(list);
            }
        }
    }
    let count = limit.to_string();
    let resp = client()
        .get(GEO_URL)
        .query(&[
            ("name", name),
            ("count", count.as_str()),
            ("language", "zh"),
            ("format", "json"),
        ])
        .send()
        .await
        .map_err(|e| format!("城市检索请求失败：{e}"))?
        .json::<GeoResponse>()
        .await
        .map_err(|e| format!("城市检索响应解析失败：{e}"))?;

    let out: Vec<CityOption> = resp
        .results
        .into_iter()
        .filter_map(|r| {
            Some(CityOption {
                name: r.name,
                admin1: r.admin1.unwrap_or_default(),
                country: r.country.unwrap_or_default(),
                latitude: r.latitude?,
                longitude: r.longitude?,
            })
        })
        .take(limit)
        .collect();
    if out.is_empty() {
        return Err(format!("没有找到「{name}」对应的城市"));
    }
    if let Ok(v) = serde_json::to_value(&out) {
        cache_put(&key, &v);
    }
    Ok(out)
}

/// 取某城市的实时天气与 7 日预报
pub async fn report(city: &str) -> Result<WeatherReport, String> {
    let name = if city.trim().is_empty() {
        DEFAULT_CITY
    } else {
        city.trim()
    };
    let key = format!("w:{name}");
    if let Some(v) = cache_get(&key, TTL_REPORT) {
        if let Ok(report) = serde_json::from_value::<WeatherReport>(v) {
            return Ok(report);
        }
    }
    let city_option = search_cities(name, 1)
        .await?
        .into_iter()
        .next()
        .ok_or_else(|| format!("没有找到「{name}」对应的城市"))?;
    let value = fetch_forecast(&city_option).await?;
    let report = build_report(city_option, &value)?;
    if let Ok(v) = serde_json::to_value(&report) {
        cache_put(&key, &v);
    }
    Ok(report)
}

async fn fetch_forecast(city: &CityOption) -> Result<serde_json::Value, String> {
    let url = format!(
        "{FORECAST_URL}?latitude={}&longitude={}\
         &current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m\
         &daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max\
         &timezone=auto&forecast_days=7",
        city.latitude, city.longitude
    );
    client()
        .get(url)
        .send()
        .await
        .map_err(|e| format!("天气请求失败：{e}"))?
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("天气响应解析失败：{e}"))
}

/// 把 Open-Meteo 的响应整理成前端要的形状
fn build_report(city: CityOption, value: &serde_json::Value) -> Result<WeatherReport, String> {
    let resp: ForecastResponse =
        serde_json::from_value(value.clone()).map_err(|e| format!("天气数据结构不符合预期：{e}"))?;
    let current = resp
        .current
        .ok_or_else(|| "天气数据里没有实时部分".to_string())?;
    let now = WeatherNow {
        temperature: current.temperature_2m.unwrap_or_default(),
        apparent: current.apparent_temperature.unwrap_or_default(),
        humidity: current.relative_humidity_2m.unwrap_or_default(),
        precipitation: current.precipitation.unwrap_or_default(),
        wind_speed: current.wind_speed_10m.unwrap_or_default(),
        is_day: current.is_day.unwrap_or(1) != 0,
        code: current.weather_code.unwrap_or_default(),
        time: current.time.unwrap_or_default(),
    };

    let daily = resp
        .daily
        .ok_or_else(|| "天气数据里没有预报部分".to_string())?;
    let mut days: Vec<WeatherDay> = Vec::with_capacity(daily.time.len());
    for (i, date) in daily.time.iter().enumerate() {
        days.push(WeatherDay {
            date: date.clone(),
            code: daily.weather_code.get(i).copied().unwrap_or_default(),
            max: daily.temperature_2m_max.get(i).copied().flatten().unwrap_or_default(),
            min: daily.temperature_2m_min.get(i).copied().flatten().unwrap_or_default(),
            sunrise: hhmm(daily.sunrise.get(i).map(String::as_str).unwrap_or_default()),
            sunset: hhmm(daily.sunset.get(i).map(String::as_str).unwrap_or_default()),
            precipitation_probability: daily
                .precipitation_probability_max
                .get(i)
                .copied()
                .flatten()
                .unwrap_or_default(),
        });
    }

    Ok(WeatherReport {
        city,
        timezone: resp.timezone,
        now,
        days,
        updated_at: crate::db::now_iso(),
    })
}

/// 把 `2026-10-14T06:12` 裁成 `06:12`，格式不对就原样返回
fn hhmm(stamp: &str) -> String {
    match stamp.split_once('T') {
        Some((_, time)) => time.get(..5).unwrap_or(time).to_string(),
        None => stamp.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> serde_json::Value {
        serde_json::json!({
            "timezone": "Asia/Shanghai",
            "current": {
                "time": "2026-10-14T10:30",
                "temperature_2m": 21.4,
                "relative_humidity_2m": 58,
                "apparent_temperature": 20.1,
                "is_day": 1,
                "precipitation": 0.0,
                "weather_code": 1,
                "wind_speed_10m": 9.4
            },
            "daily": {
                "time": ["2026-10-14", "2026-10-15"],
                "weather_code": [1, 3],
                "temperature_2m_max": [24.0, 22.5],
                "temperature_2m_min": [14.2, 13.8],
                "sunrise": ["2026-10-14T06:12", "2026-10-15T06:13"],
                "sunset": ["2026-10-14T17:48", "2026-10-15T17:47"],
                "precipitation_probability_max": [5, null]
            }
        })
    }

    fn city() -> CityOption {
        CityOption {
            name: "北京".into(),
            admin1: "北京市".into(),
            country: "中国".into(),
            latitude: 39.9075,
            longitude: 116.39723,
        }
    }

    #[test]
    fn builds_report_from_open_meteo_shape() {
        let report = build_report(city(), &sample()).unwrap();
        assert_eq!(report.timezone, "Asia/Shanghai");
        assert_eq!(report.now.temperature, 21.4);
        assert_eq!(report.now.wind_speed, 9.4);
        assert!(report.now.is_day);
        assert_eq!(report.days.len(), 2);
        assert_eq!(report.days[0].sunrise, "06:12", "日出应裁成 HH:MM");
        assert_eq!(report.days[0].max, 24.0);
        assert_eq!(report.days[1].code, 3);
        assert_eq!(report.days[1].precipitation_probability, 0.0, "null 应退化成 0");
    }

    #[test]
    fn report_serializes_camel_case() {
        let report = build_report(city(), &sample()).unwrap();
        let v = serde_json::to_value(&report).unwrap();
        assert_eq!(v["now"]["windSpeed"], 9.4);
        assert_eq!(v["days"][0]["precipitationProbability"], 5.0);
        assert_eq!(v["city"]["admin1"], "北京市");
        assert!(v["updatedAt"].is_string());
    }

    #[test]
    fn missing_current_is_reported_as_error() {
        let value = serde_json::json!({ "timezone": "Asia/Shanghai" });
        assert!(build_report(city(), &value).is_err());
    }

    /// 打真实公开接口的端到端验证。
    /// 默认跳过（需要联网），用 `cargo test -- --ignored live_fetch` 手动跑。
    #[tokio::test]
    #[ignore = "需要联网"]
    async fn live_fetch_returns_sane_data() {
        let report = report("北京").await.expect("北京天气");
        println!(
            "{} 实时 {}°C（代码 {}），未来 {} 天",
            report.city.name,
            report.now.temperature,
            report.now.code,
            report.days.len()
        );
        assert_eq!(report.city.name, "北京");
        assert!(report.now.humidity >= 0.0 && report.now.humidity <= 100.0);
        assert_eq!(report.days.len(), 7, "应该拿到 7 天预报");
        assert!(report.days.iter().all(|d| d.max >= d.min), "最高温不该低于最低温");
        assert!(
            report.days.iter().all(|d| d.sunrise.len() == 5 && d.sunset.len() == 5),
            "日出日落应裁成 HH:MM"
        );

        let cities = search_cities("上海", 3).await.expect("上海检索");
        println!("检索上海 → {:?}", cities.iter().map(|c| &c.name).collect::<Vec<_>>());
        assert!(cities.iter().any(|c| c.name == "上海"), "应能检索到上海");
    }
}