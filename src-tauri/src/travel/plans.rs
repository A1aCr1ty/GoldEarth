//! Curated extensions; these are planning estimates, never live booking quotes.
use super::{BudgetItem, Destination, RouteDay};
use once_cell::sync::Lazy;
use serde::Deserialize;
use std::collections::HashMap;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Extension {
    second_day: RouteDay,
    extra_days: Vec<RouteDay>,
    first_day_note: String,
    lodging: [u32; 2],
    lodging_areas: Vec<String>,
    reservations: Vec<String>,
    rainy_day: Vec<String>,
}

static EXTENSIONS: Lazy<HashMap<String, Extension>> = Lazy::new(|| {
    serde_json::from_str(include_str!("extensions.json")).expect("旅行扩展路线配置无效")
});

pub(super) fn for_days(mut destination: Destination, days: usize) -> Result<Destination, String> {
    if ![2, 3, 5, 7].contains(&days) {
        return Err("旅行天数请选择 2、3、5 或 7 天".into());
    }
    let extra = EXTENSIONS.get(&destination.id).ok_or("该目的地暂无完整路线")?;
    if destination.route.len() != 2 || extra.extra_days.len() < days - 2 {
        return Err("旅行路线配置不完整".into());
    }
    destination.route[0].note = extra.first_day_note.clone();
    destination.route[1] = extra.second_day.clone();
    destination.route.extend(extra.extra_days.iter().take(days - 2).cloned());
    for (index, day) in destination.route.iter_mut().enumerate() {
        for (slot, stop) in day.stops.iter_mut().enumerate() {
            if !stop.starts_with("上午") && !stop.starts_with("下午") && !stop.starts_with("晚上") {
                *stop = format!("{}：{}", ["上午", "下午", "晚上"][slot.min(2)], stop);
            }
        }
        if index + 1 == days {
            day.note.push_str(" 返程日请按车次或航班删减下午、晚间活动，并预留接驳与安检时间。");
        }
    }
    destination.days = days;
    destination.intro = format!("{}天分区游览，以每天一个主要片区安排景点、当地餐饮和休息；周边游单独留出一天，可按天气、体力与预约情况互换。", days);
    destination.lodging_areas = extra.lodging_areas.clone();
    destination.reservations = extra.reservations.clone();
    destination.rainy_day = extra.rainy_day.clone();
    // Per-person room share, with nights calculated independently of days.
    let nights = (days - 1) as u32;
    let rows = [
        ("住宿", extra.lodging[0] * nights, extra.lodging[1] * nights, format!("{nights} 晚，双人间两人分摊 / 人")),
        ("餐饮", 70 * days as u32, 140 * days as u32, format!("{days} 天 / 人")),
        ("市内与近郊交通", 30 * days as u32, 100 * days as u32, "公共交通为主 / 人".into()),
        ("游览与体验", 40 * days as u32, 120 * days as u32, "按可选项目估算 / 人".into()),
    ];
    let lower: u32 = rows.iter().map(|r| r.1).sum();
    let upper: u32 = rows.iter().map(|r| r.2).sum();
    destination.budget = format!("约 {lower}–{upper} 元 / 人");
    destination.budget_items = rows.into_iter().map(|(label, low, high, basis)| BudgetItem {
        label: label.into(), amount: format!("{low}–{high} 元（{basis}）"),
    }).collect();
    destination.planning_note = "以上为本地整理的自由行规划，非实时生成或报价。预算按普通住宿双人分摊、公共交通和常规餐饮估算，不含往返大交通、购物及大型演出；单人入住、节假日、包车另加。预约、开放、票价与班次请在出发前核对官方渠道；抵达日和返程日可删减活动。".into();
    Ok(destination)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_destination_has_distinct_complete_plans_and_scaled_budgets() {
        for base in super::super::CATALOG.iter() {
            let mut previous = 0;
            for days in [2, 3, 5, 7] {
                let plan = for_days(base.clone(), days).unwrap();
                assert_eq!(plan.route.len(), days);
                assert_eq!(plan.days, days);
                let titles: std::collections::HashSet<_> = plan.route.iter().map(|d| &d.title).collect();
                assert_eq!(titles.len(), days);
                assert!(plan.route.iter().all(|d| d.stops.len() == 3 && !d.note.is_empty()));
                assert!(plan.route.last().unwrap().note.contains("返程日"));
                assert_eq!(plan.budget_items.len(), 4);
                assert!(!plan.lodging_areas.is_empty() && !plan.reservations.is_empty() && !plan.rainy_day.is_empty());
                let low = plan.budget.split_whitespace().nth(1).unwrap().split('–').next().unwrap().parse::<u32>().unwrap();
                assert!(low > previous);
                previous = low;
                assert!(for_days(base.clone(), 4).is_err());
                assert!(for_days(base.clone(), usize::MAX).is_err());
            }
        }
    }
}
