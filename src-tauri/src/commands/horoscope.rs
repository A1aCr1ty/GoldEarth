use tauri::State;

use crate::horoscope::{self, Horoscope, Zodiac};
use crate::AppState;

/// 首页运势。
///
/// `sign` 传了就按它查（用户没填生日时，前端会轮着传十二星座）；
/// 不传就按设置里的生日推星座——生日推算只在后端做一份，
/// 前端不再自己记 cusp 边界，免得两边对不上。
#[tauri::command]
pub async fn horoscope_today(
    state: State<'_, AppState>,
    sign: Option<String>,
) -> Result<Horoscope, String> {
    let zodiac = match sign.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(key) => Zodiac::from_key(key).ok_or_else(|| format!("不认识的星座：{key}"))?,
        None => zodiac_from_settings(&state)?,
    };
    horoscope::daily(zodiac).await
}

fn zodiac_from_settings(state: &AppState) -> Result<Zodiac, String> {
    let birth = state.storage.settings().birth_date;
    let mut parts = birth.split('-');
    let year = parts.next().and_then(|v| v.parse::<i32>().ok());
    let month = parts.next().and_then(|v| v.parse::<u32>().ok());
    let day = parts.next().and_then(|v| v.parse::<u32>().ok());
    match (year, month, day) {
        (Some(y), Some(m), Some(d)) => {
            horoscope::zodiac_of(y, m, d).ok_or_else(|| "设置里的生日不合法".to_string())
        }
        _ => Err("还没填生日，没法算运势".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sign_lookup_accepts_key_forms() {
        assert_eq!(Zodiac::from_key("leo"), Some(Zodiac::Leo));
        assert_eq!(Zodiac::from_key("  Leo "), Some(Zodiac::Leo));
        assert_eq!(Zodiac::from_key("libra"), Some(Zodiac::Libra));
        assert_eq!(Zodiac::from_key("狮子座"), None, "上游只认英文小写，中文名不行");
        assert_eq!(Zodiac::from_key(""), None);
    }
}