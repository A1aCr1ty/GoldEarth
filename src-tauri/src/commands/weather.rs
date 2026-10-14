use tauri::State;

use crate::weather::{self, CityOption, WeatherReport};
use crate::AppState;

/// 首页天气：city 为空时用设置里的城市，设置里也空就用默认城市。
#[tauri::command]
pub async fn weather_report(
    state: State<'_, AppState>,
    city: Option<String>,
) -> Result<WeatherReport, String> {
    let name = city
        .map(|c| c.trim().to_string())
        .filter(|c| !c.is_empty())
        .unwrap_or_else(|| {
            let saved = state.storage.settings().weather_city;
            if saved.trim().is_empty() {
                weather::DEFAULT_CITY.to_string()
            } else {
                saved
            }
        });
    weather::report(&name).await
}

/// 城市检索，给城市选择器出候选
#[tauri::command]
pub async fn search_cities(query: String) -> Result<Vec<CityOption>, String> {
    weather::search_cities(&query, 8).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn city_option_serializes_camel_case() {
        let city = CityOption {
            name: "北京".into(),
            admin1: "北京市".into(),
            country: "中国".into(),
            latitude: 39.9,
            longitude: 116.4,
        };
        let v = serde_json::to_value(&city).unwrap();
        assert_eq!(v["name"], "北京");
        assert_eq!(v["latitude"], 39.9);
    }
}