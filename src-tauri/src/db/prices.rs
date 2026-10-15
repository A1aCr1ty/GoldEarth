//! 价格追踪的纯计算：按天聚合、算均价、算涨跌。
//!
//! 单独成文件是因为这些都要能单测。`Storage` 得拿 Tauri 句柄才建得起来，
//! 这里全是「给一组样本就算出结果」的纯函数，测试里喂真实形状的数据即可。

use std::collections::BTreeMap;

use super::models::{PriceOverview, PriceSample, PriceTarget, TrendPoint};

/// 记录时间的 ISO 串 → 当天 `YYYY-MM-DD`（本地时区）。
///
/// 按本地时区切天：凌晨 1 点记的价格要算到「今天」，
/// 用 UTC 切的话在东八区会被归到前一天，趋势线整体错开一格。
///
/// 解析不了就取前 10 位。手写或降级进来的时间串未必合法，
/// 但宁可日期歪一天，也不能把整条记录丢掉——丢了那天的均价就断了一截。
pub fn day_of_iso(iso: &str) -> String {
    chrono::DateTime::parse_from_rfc3339(iso)
        .map(|dt| dt.with_timezone(&chrono::Local).date_naive())
        .map(|d| d.format("%Y-%m-%d").to_string())
        .unwrap_or_else(|_| iso.get(..10).unwrap_or("").to_string())
}

/// 一天记好几次时，先压成一个均价再画线。
///
/// 不压的话同一天的点会在折线上抖成一团毛刺，看不出价格到底是涨了还是跌了。
/// 用 `BTreeMap` 是因为 key 天然按日期字典序排好，省掉一次排序。
pub fn build_trend(samples: &[PriceSample], days: i64) -> Vec<TrendPoint> {
    let mut buckets: BTreeMap<String, (f64, f64, f64, u32)> = BTreeMap::new();
    for s in samples {
        let day = day_of_iso(&s.recorded_at);
        if day.is_empty() {
            continue;
        }
        let e = buckets.entry(day).or_insert((0.0, f64::MAX, f64::MIN, 0));
        e.0 += s.price;
        e.1 = e.1.min(s.price);
        e.2 = e.2.max(s.price);
        e.3 += 1;
    }
    let mut out: Vec<TrendPoint> = buckets
        .into_iter()
        .map(|(day, (sum, min, max, count))| TrendPoint {
            day,
            avg: round2(sum / count as f64),
            min: round2(min),
            max: round2(max),
            count,
        })
        .collect();

    // days <= 0 表示不限；否则按日历天裁掉太久以前的点。
    // 按日历切而不是「只留 N 个有数据的天」：中间某几天没记数据时，
    // 后者会把空档悄悄抹掉，让人以为那几天价格没动过。
    if days > 0 {
        if let Some(cutoff) = out
            .last()
            .and_then(|last| chrono::NaiveDate::parse_from_str(&last.day, "%Y-%m-%d").ok())
            .and_then(|last| last.checked_sub_signed(chrono::Duration::days(days - 1)))
        {
            let cutoff = cutoff.format("%Y-%m-%d").to_string();
            out.retain(|p| p.day >= cutoff);
        }
    }
    out
}

/// 首页卡的一行。
///
/// 涨跌拿的是「最新一次 vs 上一次」，不是「最新 vs 最早」——
/// 用户关心的是刚才又降了多少，而不是三个月前降了多少。
pub fn build_overview(
    target: &PriceTarget,
    samples: &[PriceSample],
    spark_days: usize,
) -> PriceOverview {
    let mut sorted: Vec<&PriceSample> = samples.iter().collect();
    sorted.sort_by(|a, b| b.recorded_at.cmp(&a.recorded_at));

    let latest = sorted.first().map(|s| round2(s.price));
    let previous = sorted.get(1).map(|s| s.price);
    let change_pct = match (latest, previous) {
        (Some(cur), Some(prev)) if prev > 0.0 => Some(round2((cur - prev) / prev * 100.0)),
        // 只有一条记录算不出涨跌。这里不能拿 0 顶替：
        // 「没跌」和「没法比」在图上长得一样，看的人会以为价格稳住了
        _ => None,
    };

    let trend = build_trend(samples, 0);
    let spark_days = spark_days.max(1);
    let spark: Vec<f64> = trend
        .iter()
        .rev()
        .take(spark_days)
        .rev()
        .map(|p| p.avg)
        .collect();

    PriceOverview {
        target: target.clone(),
        latest,
        change_pct,
        samples: samples.len() as u32,
        days: trend.len() as u32,
        spark,
        updated_at: sorted.first().map(|s| s.recorded_at.clone()),
    }
}

/// 均价算出来要保留两位：价格全是元，算出 1234.567891 没人看，
/// 存进 JSON 还会让文件越来越大。
fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

/// 价格得是个人话能接受的数字。
///
/// 0 和负数一律挡掉：均价为 0 会让涨跌百分比炸掉（除零），
/// 而 0 元本身也不可能是真实行情。1000 万这种离谱值同样挡掉，
/// 基本都是把「价格区间」误当成单个数字填进来了。
pub fn validate_price(price: f64) -> Result<f64, String> {
    if !price.is_finite() {
        return Err("价格得是数字".into());
    }
    if price <= 0.0 {
        return Err("价格要大于 0".into());
    }
    if price > 10_000_000.0 {
        return Err("价格大得离谱，确认一下是不是把价格区间当成了单价".into());
    }
    Ok(round2(price))
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "6b32af44-15fc-41d8-a4e1-7c1b939fe635";

    fn target() -> PriceTarget {
        PriceTarget {
            id: ID.into(),
            name: "AirPods Pro2".into(),
            keyword: String::new(),
            note: String::new(),
            created_at: "2026-10-01T00:00:00+00:00".into(),
        }
    }

    fn sample(price: f64, at: &str) -> PriceSample {
        PriceSample {
            id: format!("s-{at}-{price}"),
            target_id: ID.into(),
            price,
            source: "manual".into(),
            samples: 1,
            recorded_at: at.into(),
        }
    }

    #[test]
    fn buckets_a_day_into_one_average() {
        // 同一天记了三次：1200 / 1500 / 1800，均价 1500，区间 1200~1800
        let rows = vec![
            sample(1200.0, "2026-10-15T01:00:00+00:00"),
            sample(1800.0, "2026-10-15T05:00:00+00:00"),
            sample(1500.0, "2026-10-15T09:00:00+00:00"),
        ];
        let trend = build_trend(&rows, 0);
        assert_eq!(trend.len(), 1, "一天只该出一个点");
        assert_eq!(trend[0].day, "2026-10-15");
        assert_eq!(trend[0].avg, 1500.0);
        assert_eq!(trend[0].min, 1200.0);
        assert_eq!(trend[0].max, 1800.0);
        assert_eq!(trend[0].count, 3);
    }

    #[test]
    fn trend_is_ordered_oldest_first() {
        // 故意乱序塞：画折线要按时间从早到晚，反了就成了「跌回去」
        let rows = vec![
            sample(300.0, "2026-10-17T09:00:00+00:00"),
            sample(100.0, "2026-10-15T09:00:00+00:00"),
            sample(200.0, "2026-10-16T09:00:00+00:00"),
        ];
        let trend = build_trend(&rows, 0);
        let days: Vec<&str> = trend.iter().map(|p| p.day.as_str()).collect();
        assert_eq!(days, vec!["2026-10-15", "2026-10-16", "2026-10-17"]);
        assert_eq!(
            trend.iter().map(|p| p.avg).collect::<Vec<_>>(),
            vec![100.0, 200.0, 300.0]
        );
    }

    #[test]
    fn day_cutoff_keeps_gaps_visible() {
        // 5 天的数据，只要最近 3 天：10-12 必须留着，哪怕 10-13 没记录
        let rows: Vec<PriceSample> = ["10-12", "10-14", "10-15", "10-16", "10-17"]
            .iter()
            .map(|d| sample(100.0, &format!("2026-{d}T09:00:00+00:00")))
            .collect();
        let trend = build_trend(&rows, 3);
        let days: Vec<&str> = trend.iter().map(|p| p.day.as_str()).collect();
        assert_eq!(
            days,
            vec!["2026-10-15", "2026-10-16", "2026-10-17"],
            "中间空着的天不能被悄悄抹掉：那不等于价格没动过"
        );
    }

    #[test]
    fn overview_compares_latest_against_the_one_before_it() {
        let rows = vec![
            sample(1500.0, "2026-10-15T09:00:00+00:00"),
            sample(1200.0, "2026-10-14T09:00:00+00:00"),
            sample(1000.0, "2026-10-13T09:00:00+00:00"),
        ];
        let o = build_overview(&target(), &rows, 7);
        assert_eq!(o.latest, Some(1500.0));
        assert_eq!(o.change_pct, Some(25.0), "1500 比 1200 涨了 25%");
        assert_eq!(o.samples, 3);
        assert_eq!(o.days, 3);
        assert_eq!(o.spark, vec![1000.0, 1200.0, 1500.0], "迷你线也要从早到晚");
    }

    #[test]
    fn a_single_record_has_no_change_to_report() {
        let rows = vec![sample(1500.0, "2026-10-15T09:00:00+00:00")];
        let o = build_overview(&target(), &rows, 7);
        assert_eq!(o.latest, Some(1500.0));
        assert_eq!(o.change_pct, None, "只有一条记录算不出涨跌，不能拿 0 顶替");
        assert_eq!(o.spark, vec![1500.0]);
    }

    #[test]
    fn spark_line_is_capped_at_the_requested_days() {
        let rows: Vec<PriceSample> = ["10-11", "10-12", "10-13", "10-14", "10-15"]
            .iter()
            .enumerate()
            .map(|(i, d)| {
                sample(
                    100.0 + i as f64 * 100.0,
                    &format!("2026-{d}T09:00:00+00:00"),
                )
            })
            .collect();
        let o = build_overview(&target(), &rows, 3);
        assert_eq!(
            o.spark,
            vec![300.0, 400.0, 500.0],
            "只留最近三天，且从早到晚"
        );
    }

    #[test]
    fn day_is_cut_in_local_time_not_utc() {
        // UTC 的 10-15 21:00 在东八区已经是 10-16 凌晨 5 点，归到「今天」才对
        let out = day_of_iso("2026-10-15T21:00:00+00:00");
        let local = chrono::DateTime::parse_from_rfc3339("2026-10-15T21:00:00+00:00")
            .unwrap()
            .with_timezone(&chrono::Local)
            .date_naive()
            .format("%Y-%m-%d")
            .to_string();
        assert_eq!(out, local);
    }

    #[test]
    fn broken_timestamps_still_yield_a_usable_day() {
        // 降级/手写进来的时间串可能压根不是 RFC3339，但前 10 位通常还是日期
        assert_eq!(day_of_iso("2026-10-15 08:30:00"), "2026-10-15");
        assert_eq!(day_of_iso("2026-10-15"), "2026-10-15");
        assert_eq!(day_of_iso(""), "");
    }

    #[test]
    fn refuses_prices_that_are_not_real_money() {
        assert_eq!(validate_price(1234.567), Ok(1234.57));
        assert!(validate_price(0.0).is_err(), "0 会让涨跌百分比除零");
        assert!(validate_price(-5.0).is_err());
        assert!(validate_price(f64::NAN).is_err());
        assert!(
            validate_price(99_999_999.0).is_err(),
            "多半是把价格区间当单价填了"
        );
    }
}
