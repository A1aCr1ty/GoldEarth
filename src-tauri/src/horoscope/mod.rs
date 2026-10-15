//! 星座运势：xxapi v2（免密钥、免登录）。
//!
//! - 接口：`https://v2.xxapi.cn/api/horoscope?type=<英文星座>&time=<today|week|month|year>`
//!
//! 实测记录（2026-10-14 定接口时逐个打出来的，别凭印象改）：
//! - **只有 `v2.xxapi.cn` 有效**，`xxapi.cn/api/horoscope` 是 404；
//! - `type` 只认英文小写（aries…pisces），传中文名会返回「type参数无效」；
//! - `api.ruseo.cn/api/horoscope` 是同一份上游数据的转发层
//!   （响应里带 `"source":"xxapi"`，内容逐字一致），所以直接用上游，少一跳依赖。
//!
//! 上游有两处**脏数据**，必须在解析时清掉，不然会直接显示到界面上：
//! 1. `fortunetext.all` 句尾会拖着占位残留，例如
//!    「……按部就班处理事务可避免不必要麻烦。**星2座2屋**」；
//! 2. 幸运色 / 幸运星座 / 幸运数字三个字段会**串位**，实测出现过
//!    `luckycolor:""`、`luckyconstellation:"3"`、`luckynumber:"绛紫"`
//!    （数字字段塞了颜色）。所以这三个字段一律按形态校验，不合法就不显示。
//!
//! 抓取放在 Rust 侧，绕开 WebView 跨域；带一层按天分键的内存缓存。

use std::collections::HashMap;
use std::time::{Duration, Instant};

use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::Serialize;

const HOROSCOPE_URL: &str = "https://v2.xxapi.cn/api/horoscope";

/// 今日运势一天之内不变，缓存半小时足够挡住首页反复刷新。
const TTL: Duration = Duration::from_secs(1800);

static CACHE: Lazy<Mutex<HashMap<String, (Instant, Horoscope)>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

fn cache_get(key: &str) -> Option<Horoscope> {
    let guard = CACHE.lock();
    let (at, value) = guard.get(key)?;
    if at.elapsed() > TTL {
        return None;
    }
    Some(value.clone())
}

fn cache_put(key: &str, value: &Horoscope) {
    let mut guard = CACHE.lock();
    guard.retain(|_, (at, _)| at.elapsed() < TTL);
    guard.insert(key.to_string(), (Instant::now(), value.clone()));
}

fn client() -> &'static reqwest::Client {
    static CLIENT: Lazy<reqwest::Client> = Lazy::new(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(12))
            .connect_timeout(Duration::from_secs(6))
            .user_agent("GoldEarth/0.1")
            .build()
            .expect("构建星座运势 HTTP 客户端失败")
    });
    &CLIENT
}

/// 十二星座。顺序就是一年里从白羊到双鱼的顺序。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Zodiac {
    Aries,
    Taurus,
    Gemini,
    Cancer,
    Leo,
    Virgo,
    Libra,
    Scorpio,
    Sagittarius,
    Capricorn,
    Aquarius,
    Pisces,
}

impl Zodiac {
    pub const ALL: [Zodiac; 12] = [
        Zodiac::Aries,
        Zodiac::Taurus,
        Zodiac::Gemini,
        Zodiac::Cancer,
        Zodiac::Leo,
        Zodiac::Virgo,
        Zodiac::Libra,
        Zodiac::Scorpio,
        Zodiac::Sagittarius,
        Zodiac::Capricorn,
        Zodiac::Aquarius,
        Zodiac::Pisces,
    ];

    /// 接口要的英文小写名
    pub fn key(self) -> &'static str {
        match self {
            Zodiac::Aries => "aries",
            Zodiac::Taurus => "taurus",
            Zodiac::Gemini => "gemini",
            Zodiac::Cancer => "cancer",
            Zodiac::Leo => "leo",
            Zodiac::Virgo => "virgo",
            Zodiac::Libra => "libra",
            Zodiac::Scorpio => "scorpio",
            Zodiac::Sagittarius => "sagittarius",
            Zodiac::Capricorn => "capricorn",
            Zodiac::Aquarius => "aquarius",
            Zodiac::Pisces => "pisces",
        }
    }

    /// 中文名，带「座」
    pub fn name(self) -> &'static str {
        match self {
            Zodiac::Aries => "白羊座",
            Zodiac::Taurus => "金牛座",
            Zodiac::Gemini => "双子座",
            Zodiac::Cancer => "巨蟹座",
            Zodiac::Leo => "狮子座",
            Zodiac::Virgo => "处女座",
            Zodiac::Libra => "天秤座",
            Zodiac::Scorpio => "天蝎座",
            Zodiac::Sagittarius => "射手座",
            Zodiac::Capricorn => "摩羯座",
            Zodiac::Aquarius => "水瓶座",
            Zodiac::Pisces => "双鱼座",
        }
    }

    pub fn from_key(key: &str) -> Option<Zodiac> {
        Zodiac::ALL
            .into_iter()
            .find(|z| z.key() == key.trim().to_ascii_lowercase())
    }
}

/// 某年某月的天数，用来挡掉「2 月 30 号」这种非法生日。
fn days_in_month(year: i32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if (year % 4 == 0 && year % 100 != 0) || year % 400 == 0 {
                29
            } else {
                28
            }
        }
        _ => 0,
    }
}

/// 生日 → 星座。边界日按「当天即换星座」处理（3/21 起白羊，1/20 起水瓶）。
/// 月份或日期不合法返回 None。
pub fn zodiac_of(year: i32, month: u32, day: u32) -> Option<Zodiac> {
    if !(1..=12).contains(&month) || day == 0 || day > days_in_month(year, month) {
        return None;
    }
    let sign = match (month, day) {
        (3, 21..=31) | (4, 1..=19) => Zodiac::Aries,
        (4, 20..=31) | (5, 1..=20) => Zodiac::Taurus,
        (5, 21..=31) | (6, 1..=21) => Zodiac::Gemini,
        (6, 22..=30) | (7, 1..=22) => Zodiac::Cancer,
        (7, 23..=31) | (8, 1..=22) => Zodiac::Leo,
        (8, 23..=31) | (9, 1..=22) => Zodiac::Virgo,
        (9, 23..=30) | (10, 1..=23) => Zodiac::Libra,
        (10, 24..=31) | (11, 1..=22) => Zodiac::Scorpio,
        (11, 23..=30) | (12, 1..=21) => Zodiac::Sagittarius,
        (12, 22..=31) | (1, 1..=19) => Zodiac::Capricorn,
        (1, 20..=31) | (2, 1..=18) => Zodiac::Aquarius,
        (2, 19..=29) | (3, 1..=20) => Zodiac::Pisces,
        _ => return None,
    };
    Some(sign)
}

/// 运势的五个维度。顺序固定：整体、爱情、事业、财运、健康。
pub const ASPECT_KEYS: [(&str, &str); 5] = [
    ("all", "整体"),
    ("love", "爱情"),
    ("work", "事业"),
    ("money", "财运"),
    ("health", "健康"),
];

/// 运势的一个维度
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HoroscopeAspect {
    /// all / love / work / money / health
    pub key: &'static str,
    /// 整体 / 爱情 / …
    pub label: &'static str,
    /// 星级，1..=5；上游给的不是这个范围就当 0，界面上不画星
    pub stars: u8,
    /// 指数，形如 "66%"
    pub index: String,
    /// 解读正文（已清掉句尾残留）
    pub text: String,
}

/// 一次运势查询的结果
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Horoscope {
    /// 接口用的英文星座名
    pub sign: &'static str,
    /// 中文星座名
    pub title: &'static str,
    /// 「今日运势」
    pub period: String,
    /// 「10月14日」
    pub date: String,
    /// 一句话提要
    pub short_comment: String,
    pub aspects: Vec<HoroscopeAspect>,
    pub lucky_color: Option<String>,
    pub lucky_constellation: Option<String>,
    pub lucky_number: Option<String>,
    /// 「宜户外散步舒展」
    pub todo_yi: Option<String>,
    /// 「忌冲动购置闲置」
    pub todo_ji: Option<String>,
}

fn str_field(value: &serde_json::Value, key: &str) -> String {
    value
        .get(key)
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .trim()
        .to_string()
}

/// 星级只认 1..=5，上游偶尔给 0 或越界值，那种情况宁可不画星
fn stars_of(value: Option<&serde_json::Value>) -> u8 {
    match value.and_then(|v| v.as_i64()) {
        Some(n) if (1..=5).contains(&n) => n as u8,
        _ => 0,
    }
}

/// 截到最后一个句号为止。
///
/// 上游会把占位符拼在句尾，实测见过「……可避免不必要麻烦。星2座2屋」
/// 和「……保持现有状态即可稳步推进。星O座O屋」，特征是最后一个「。」后面
/// 还跟着一截无意义字符。统一截到最后一个句号，既能清掉残留，
/// 又不会误伤正常句子（正文里本身不会有句号后面的内容）。
fn trim_tail_garbage(text: &str) -> String {
    let text = text.trim();
    match text.rfind('。') {
        // rfind 返回的是字节下标，而「。」占 3 字节，
        // 直接切到 idx 会落在字符中间，必须按字符长度往后挪
        Some(idx) => text[..idx + '。'.len_utf8()].trim().to_string(),
        None => text.to_string(),
    }
}

fn is_cjk(c: char) -> bool {
    ('\u{4e00}'..='\u{9fff}').contains(&c)
}

/// 幸运数字：必须是 1..=3 位纯数字。实测串位时这里出现过颜色名「绛紫」。
fn clean_lucky_number(raw: &str) -> Option<String> {
    let raw = raw.trim();
    if raw.is_empty() || raw.len() > 3 || !raw.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    Some(raw.to_string())
}

/// 幸运星座：必须正好是十二星座之一。实测串位时这里出现过数字「3」。
fn clean_lucky_constellation(raw: &str) -> Option<String> {
    let raw = raw.trim();
    Zodiac::ALL
        .into_iter()
        .find(|z| z.name() == raw)
        .map(|z| z.name().to_string())
}

/// 幸运色：非空、2..=6 个汉字、且不能是星座名（否则说明串位到了这个字段）
fn clean_lucky_color(raw: &str) -> Option<String> {
    let raw = raw.trim();
    let len = raw.chars().count();
    if len < 2 || len > 6 {
        return None;
    }
    if !raw.chars().all(is_cjk) {
        return None;
    }
    if Zodiac::ALL.into_iter().any(|z| z.name() == raw) {
        return None;
    }
    Some(raw.to_string())
}

/// 宜 / 忌：空字符串就当没有
fn clean_todo(raw: &str) -> Option<String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    Some(raw.to_string())
}

/// 把接口返回的 JSON 变成结构体。字段名和层级都对着真实响应核过，
/// 单测里锁了一份线上原文，改字段时先改测试。
pub fn parse(payload: &serde_json::Value, sign: Zodiac) -> Result<Horoscope, String> {
    if payload.get("code").and_then(|v| v.as_i64()) != Some(200) {
        let msg = str_field(payload, "msg");
        return Err(format!("星座接口返回异常：{msg}"));
    }
    let data = payload
        .get("data")
        .filter(|v| v.is_object())
        .ok_or_else(|| "星座接口没有返回数据".to_string())?;

    // 上游偶尔会用同一份文案糊弄所有星座（不同星座 text 完全相同），
    // 这里至少守住最关键的一条：title 必须和请求的星座对得上。
    let title = str_field(data, "title");
    if !title.is_empty() && title != sign.name() {
        return Err(format!(
            "星座接口对不上号：请求 {} 却返回 {title}",
            sign.name()
        ));
    }

    let fortune = data.get("fortune");
    let texts = data.get("fortunetext");
    let index = data.get("index");

    let aspects: Vec<HoroscopeAspect> = ASPECT_KEYS
        .iter()
        .map(|(key, label)| {
            let text = texts
                .and_then(|t| t.get(*key))
                .and_then(|v| v.as_str())
                .map(trim_tail_garbage)
                .unwrap_or_default();
            HoroscopeAspect {
                key,
                label,
                stars: stars_of(fortune.and_then(|f| f.get(*key))),
                index: str_field(index.unwrap_or(&serde_json::Value::Null), *key),
                text,
            }
        })
        .collect();

    let todo = data.get("todo");
    let todo_field = |k: &str| {
        todo.and_then(|t| t.get(k))
            .and_then(|v| v.as_str())
            .map(clean_todo)
            .unwrap_or_default()
    };

    Ok(Horoscope {
        sign: sign.key(),
        title: sign.name(),
        period: str_field(data, "type"),
        date: str_field(data, "time"),
        short_comment: str_field(data, "shortcomment"),
        aspects,
        lucky_color: clean_lucky_color(&str_field(data, "luckycolor")),
        lucky_constellation: clean_lucky_constellation(&str_field(data, "luckyconstellation")),
        lucky_number: clean_lucky_number(&str_field(data, "luckynumber")),
        todo_yi: todo_field("yi"),
        todo_ji: todo_field("ji"),
    })
}

/// 拉一次当日运势。带按天分键的缓存。
pub async fn daily(sign: Zodiac) -> Result<Horoscope, String> {
    // 缓存键带上日期：跨零点时 TTL 还没到也不会把昨天的运势端上桌
    let key = format!(
        "{}|{}",
        sign.key(),
        crate::db::now_iso().chars().take(10).collect::<String>()
    );
    if let Some(hit) = cache_get(&key) {
        return Ok(hit);
    }

    let url = format!("{HOROSCOPE_URL}?type={}&time=today", sign.key());
    let resp = client()
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("请求星座接口失败：{e}"))?;
    if !resp.status().is_success() {
        return Err(format!("星座接口返回 HTTP {}", resp.status()));
    }
    let payload: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("星座接口返回的不是 JSON：{e}"))?;

    let parsed = parse(&payload, sign)?;
    cache_put(&key, &parsed);
    Ok(parsed)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 定接口时抓的线上原文（2026-10-14，水瓶座今日）。
    /// 解析相关的断言都对着它写，改字段时先改这里。
    const REAL_PAYLOAD: &str = r#"{
      "code": 200,
      "msg": "数据请求成功",
      "data": {
        "name": "aquarius",
        "title": "水瓶座",
        "type": "今日运势",
        "time": "10月14日",
        "shortcomment": "保持平和心态",
        "fortune": { "all": 3, "health": 4, "love": 3, "money": 2, "work": 4 },
        "fortunetext": {
          "all": "今日整体运势平稳中藏小起伏，人际互动顺畅但需留意情绪波动，部分事务推进需多花耐心，无重大突发状况，整体状态可控，按部就班处理事务可避免不必要麻烦。星2座2屋",
          "health": "今日健康状况良好，无明显不适，保持规律作息和适度运动即可，需注意避免久坐导致的腰部不适。",
          "love": "今日爱情运势中平，单身者难遇心动对象，已有伴侣者易因沟通不畅产生小分歧，需多站在对方角度思考，避免因小事引发矛盾，整体无明显进展。",
          "money": "今日财富运势欠佳，易因一时冲动产生非必要消费，比如被促销活动吸引购买闲置物品，或为凑单额外支出，需严格控制消费欲望，避免不必要的资金损耗。",
          "work": "无论是工作还是学习，在事务处理上都能保持清晰思路，前期积累的经验可发挥作用，推进效率较高，需注意细节把控避免疏漏。"
        },
        "index": { "all": "66%", "health": "70%", "love": "56%", "money": "33%", "work": "84%" },
        "luckycolor": "草绿",
        "luckyconstellation": "狮子座",
        "luckynumber": "12",
        "todo": { "yi": "宜户外散步舒展", "ji": "忌冲动购置闲置" }
      }
    }"#;

    #[test]
    fn parses_real_payload_and_keeps_every_aspect() {
        let payload: serde_json::Value = serde_json::from_str(REAL_PAYLOAD).unwrap();
        let h = parse(&payload, Zodiac::Aquarius).expect("应当解析成功");

        assert_eq!(h.title, "水瓶座");
        assert_eq!(h.sign, "aquarius");
        assert_eq!(h.period, "今日运势");
        assert_eq!(h.short_comment, "保持平和心态");
        assert_eq!(h.aspects.len(), 5, "五个维度都要在: {h:?}");
        assert_eq!(h.aspects[0].label, "整体");
        assert_eq!(h.aspects[0].stars, 3);
        assert_eq!(h.aspects[0].index, "66%");
        assert_eq!(h.lucky_color.as_deref(), Some("草绿"));
        assert_eq!(h.lucky_number.as_deref(), Some("12"));
        assert_eq!(h.lucky_constellation.as_deref(), Some("狮子座"));
        assert_eq!(h.todo_yi.as_deref(), Some("宜户外散步舒展"));
        assert_eq!(h.todo_ji.as_deref(), Some("忌冲动购置闲置"));
    }

    #[test]
    fn drops_trailing_placeholder_garbage() {
        // 上游把「星2座2屋」这类占位符拼在句尾，必须截掉
        let payload: serde_json::Value = serde_json::from_str(REAL_PAYLOAD).unwrap();
        let h = parse(&payload, Zodiac::Aquarius).unwrap();
        let all = &h.aspects[0].text;
        assert!(all.ends_with('。'), "正文应停在句号: {all}");
        assert!(!all.contains("星2座2屋"), "句尾残留没清干净: {all}");
        // 正常句子不能被误伤
        assert!(all.contains("按部就班处理事务"), "正文被截短了: {all}");
    }

    #[test]
    fn rejects_payload_for_a_different_sign() {
        // 拿水瓶的响应去解析白羊，说明上游串了，必须报错而不是悄悄显示错星座
        let payload: serde_json::Value = serde_json::from_str(REAL_PAYLOAD).unwrap();
        let err = parse(&payload, Zodiac::Aries).unwrap_err();
        assert!(err.contains("对不上号"), "应识别出星座错配: {err}");
    }

    #[test]
    fn rejects_non_200_envelope() {
        let payload = serde_json::json!({ "code": 422, "msg": "Missing required parameter: time" });
        let err = parse(&payload, Zodiac::Leo).unwrap_err();
        assert!(err.contains("Missing required parameter"), "{err}");
    }

    #[test]
    fn discards_shifted_lucky_fields() {
        // 实测周运那次三个幸运字段串位：颜色空、星座塞了数字、数字塞了颜色
        let shifted = serde_json::json!({
            "code": 200,
            "data": {
                "title": "狮子座",
                "type": "本周运势",
                "time": "10月14日",
                "shortcomment": "调整自身状态",
                "fortune": { "all": 4, "health": 3, "love": 3, "money": 2, "work": 4 },
                "fortunetext": { "all": "本周整体运势平稳。" },
                "index": { "all": "70%" },
                "luckycolor": "",
                "luckyconstellation": "3",
                "luckynumber": "绛紫",
                "todo": { "yi": "宜学习新技能", "ji": "忌拖延既定任务" }
            }
        });
        let h = parse(&shifted, Zodiac::Leo).unwrap();
        assert_eq!(h.lucky_color, None, "空颜色应丢掉");
        assert_eq!(h.lucky_constellation, None, "数字不该当星座显示");
        assert_eq!(h.lucky_number, None, "颜色名不该当幸运数字显示");
        // 干净的字段不能被牵连
        assert_eq!(h.todo_yi.as_deref(), Some("宜学习新技能"));
        assert_eq!(h.aspects[0].stars, 4);
    }

    #[test]
    fn out_of_range_stars_become_zero() {
        // 宁可少画几颗星，也不要把界面画成 9 颗
        let payload = serde_json::json!({
            "code": 200,
            "data": { "title": "白羊座", "fortune": { "all": 9, "love": 0, "work": 3 } }
        });
        let h = parse(&payload, Zodiac::Aries).unwrap();
        assert_eq!(h.aspects[0].stars, 0);
        assert_eq!(h.aspects[1].stars, 0);
        assert_eq!(h.aspects[2].stars, 3);
    }

    #[test]
    fn zodiac_covers_every_day_of_the_year() {
        // 用真实历法遍历一年，保证没有漏判的日期
        for year in [2000, 2024, 2026] {
            for month in 1..=12u32 {
                for day in 1..=days_in_month(year, month) {
                    assert!(
                        zodiac_of(year, month, day).is_some(),
                        "{year}-{month:02}-{day:02} 判不出星座"
                    );
                }
            }
        }
        // 二月只有 28/29 号，30 号必须判失败
        assert_eq!(zodiac_of(2026, 2, 30), None, "2 月没有 30 号");
        assert_eq!(zodiac_of(2026, 13, 1), None);
        assert_eq!(zodiac_of(2026, 0, 1), None);
        assert_eq!(zodiac_of(2026, 4, 31), None);
    }

    #[test]
    fn zodiac_gets_cusp_days_right() {
        // 边界日按「当天就换星座」处理
        assert_eq!(zodiac_of(2026, 3, 20), Some(Zodiac::Pisces));
        assert_eq!(zodiac_of(2026, 3, 21), Some(Zodiac::Aries));
        assert_eq!(zodiac_of(2026, 1, 19), Some(Zodiac::Capricorn));
        assert_eq!(zodiac_of(2026, 1, 20), Some(Zodiac::Aquarius));
        assert_eq!(zodiac_of(2026, 10, 23), Some(Zodiac::Libra));
        assert_eq!(zodiac_of(2026, 10, 24), Some(Zodiac::Scorpio));
        assert_eq!(zodiac_of(2026, 12, 21), Some(Zodiac::Sagittarius));
        assert_eq!(zodiac_of(2026, 12, 22), Some(Zodiac::Capricorn));
        // 平年 / 闰年的 2 月底都要能判出双鱼
        assert_eq!(zodiac_of(2026, 2, 28), Some(Zodiac::Pisces));
        assert_eq!(zodiac_of(2024, 2, 29), Some(Zodiac::Pisces));
    }

    #[test]
    fn zodiac_keys_round_trip_and_are_unique() {
        // 上游只认英文小写，key 和中文名都必须一一对应，不能重名
        let mut keys: Vec<&str> = Zodiac::ALL.iter().map(|z| z.key()).collect();
        let mut names: Vec<&str> = Zodiac::ALL.iter().map(|z| z.name()).collect();
        assert_eq!(keys.len(), 12);
        assert_eq!(names.len(), 12);
        keys.sort_unstable();
        keys.dedup();
        names.sort_unstable();
        names.dedup();
        assert_eq!(keys.len(), 12, "星座英文 key 有重复");
        assert_eq!(names.len(), 12, "星座中文名有重复");
        for sign in Zodiac::ALL {
            assert_eq!(Zodiac::from_key(sign.key()), Some(sign));
            assert_eq!(
                Zodiac::from_key(&sign.key().to_uppercase()),
                Some(sign),
                "应容许大写"
            );
        }
    }

    #[test]
    fn horoscope_serializes_camel_case() {
        let payload: serde_json::Value = serde_json::from_str(REAL_PAYLOAD).unwrap();
        let v = serde_json::to_value(parse(&payload, Zodiac::Aquarius).unwrap()).unwrap();
        assert_eq!(v["title"], "水瓶座");
        assert_eq!(v["shortComment"], "保持平和心态");
        assert_eq!(v["luckyColor"], "草绿");
        assert_eq!(v["aspects"][0]["key"], "all");
        assert_eq!(v["aspects"][0]["label"], "整体");
    }

    /// 真打一次线上接口，确认「取数 → 解析 → 清洗」这条链路是通的。
    /// `cargo test -- --ignored live_horoscope` 手动跑。
    #[test]
    #[ignore = "需要联网"]
    fn live_horoscope_returns_sane_data() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("建运行时失败");
        let h = rt
            .block_on(daily(Zodiac::Leo))
            .expect("应当取到今日运势，接口挂了的话先确认 v2.xxapi.cn 还活着");

        assert_eq!(h.title, "狮子座", "请求的星座和返回的对不上");
        assert_eq!(h.period, "今日运势");
        assert_eq!(h.aspects.len(), 5);
        for a in &h.aspects {
            assert!(
                a.stars <= 5,
                "{label} 星级越界: {stars}",
                label = a.label,
                stars = a.stars
            );
            assert!(!a.text.is_empty(), "{label} 解读是空的", label = a.label);
            assert!(
                a.text.ends_with('。'),
                "{label} 解读没停在句号，疑似句尾残留没清干净: {text}",
                label = a.label,
                text = a.text
            );
        }
        assert!(
            h.aspects.iter().any(|a| a.stars > 0),
            "五项星级全是 0，不像真实数据"
        );
    }
}
