//! 东方财富接口的 JSON 解析。
//!
//! 四个接口共用一套字段编号（f1、f2…），这里把编号的含义固定下来：
//!
//! | 编号 | 含义        | 编号 | 含义      |
//! |------|-------------|------|-----------|
//! | f2   | 最新价      | f3   | 涨跌幅 %  |
//! | f4   | 涨跌额      | f5   | 成交量(手) |
//! | f6   | 成交额(元)  | f7   | 振幅 %    |
//! | f8   | 换手率 %    | f9   | 市盈率    |
//! | f10  | 量比        | f12  | 代码      |
//! | f14  | 名称        | f15  | 最高      |
//! | f16  | 最低        | f17  | 今开      |
//! | f18  | 昨收        | f20  | 总市值    |
//! | f21  | 流通市值    | f23  | 市净率    |
//! | f62  | 主力净流入  | f184 | 主力净占比 |
//! | f66/f69 | 超大单净额 / 占比 | f72/f75 | 大单 |
//! | f78/f81 | 中单 | f84/f87 | 小单 |

use serde_json::Value;

use super::symbol;
use super::types::{Candle, FundFlow, FundTier, RankItem, Trend, TrendPoint};

/// 东财的市值/成交额字段是「元」，展示习惯是「亿元」
const YI: f64 = 100_000_000.0;

fn f(v: &Value, key: &str) -> f64 {
    v.get(key).and_then(|x| x.as_f64()).unwrap_or(0.0)
}

/// 解析 K 线。`klines` 里每行是逗号分隔的：
/// `日期,开盘,收盘,最高,最低,成交量,成交额,振幅,涨跌幅,涨跌额,换手率`
pub fn parse_klines(json: &Value) -> Vec<Candle> {
    let Some(list) = json
        .get("data")
        .and_then(|d| d.get("klines"))
        .and_then(|k| k.as_array())
    else {
        return Vec::new();
    };
    list.iter()
        .filter_map(|item| {
            let line = item.as_str()?;
            let p: Vec<&str> = line.split(',').collect();
            if p.len() < 11 {
                return None;
            }
            let num = |i: usize| p.get(i).and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0);
            Some(Candle {
                date: p[0].to_string(),
                open: num(1),
                close: num(2),
                high: num(3),
                low: num(4),
                volume: num(5),
                amount: num(6),
                amplitude: num(7),
                change_pct: num(8),
                change: num(9),
                turnover: num(10),
            })
        })
        .collect()
}

/// 解析当日分时。
///
/// `trends` 每行：`时间,最新,均价,最高,最低,成交量,成交额,均价`。接口给的「均价」
/// 口径不统一，这里自己用累计成交额 / 累计成交量算分时均价线，
/// 口径明确且和常见行情软件一致。
pub fn parse_trends(json: &Value) -> Trend {
    let Some(data) = json.get("data") else {
        return Trend::default();
    };
    let pre_close = data.get("preClose").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let Some(list) = data.get("trends").and_then(|t| t.as_array()) else {
        return Trend {
            pre_close,
            points: Vec::new(),
        };
    };

    let mut cum_amount = 0.0;
    let mut cum_volume = 0.0;
    let points: Vec<TrendPoint> = list
        .iter()
        .filter_map(|item| {
            let line = item.as_str()?;
            let p: Vec<&str> = line.split(',').collect();
            if p.len() < 7 {
                return None;
            }
            let num = |i: usize| p.get(i).and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0);
            cum_amount += num(6);
            cum_volume += num(5);
            // 成交量单位是手，换算成股
            let avg_price = if cum_volume > 0.0 {
                cum_amount / (cum_volume * 100.0)
            } else {
                0.0
            };
            // 时间字段是 `2026-10-14 09:30`，只留时分
            let time = p[0].rsplit(' ').next().unwrap_or("").to_string();
            Some(TrendPoint {
                time,
                price: num(1),
                avg_price,
                volume: num(5),
                amount: num(6),
            })
        })
        .collect();

    Trend { pre_close, points }
}

/// 解析榜单（涨跌幅 / 成交额 / 换手率）
pub fn parse_ranks(json: &Value) -> Vec<RankItem> {
    let Some(list) = json
        .get("data")
        .and_then(|d| d.get("diff"))
        .and_then(|d| d.as_array())
    else {
        return Vec::new();
    };
    list.iter()
        .map(|d| {
            let raw = d.get("f12").and_then(|v| v.as_str()).unwrap_or("");
            RankItem {
                code: symbol::normalize(raw),
                name: d
                    .get("f14")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                price: f(d, "f2"),
                change_pct: f(d, "f3"),
                change: f(d, "f4"),
                open: f(d, "f17"),
                high: f(d, "f15"),
                low: f(d, "f16"),
                prev_close: f(d, "f18"),
                volume: f(d, "f5"),
                amount: f(d, "f6"),
                amplitude: f(d, "f7"),
                turnover_rate: f(d, "f8"),
                pe: f(d, "f9"),
                pb: f(d, "f23"),
                volume_ratio: f(d, "f10"),
                total_mv: f(d, "f20") / YI,
                float_mv: f(d, "f21") / YI,
                main_net: f(d, "f62"),
            }
        })
        .collect()
}

/// 解析资金流
pub fn parse_fund_flow(json: &Value) -> Vec<FundFlow> {
    let Some(list) = json
        .get("data")
        .and_then(|d| d.get("diff"))
        .and_then(|d| d.as_array())
    else {
        return Vec::new();
    };
    list.iter()
        .map(|d| FundFlow {
            code: symbol::normalize(d.get("f12").and_then(|v| v.as_str()).unwrap_or("")),
            name: d
                .get("f14")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            main: FundTier {
                net: f(d, "f62"),
                pct: f(d, "f184"),
            },
            super_large: FundTier {
                net: f(d, "f66"),
                pct: f(d, "f69"),
            },
            large: FundTier {
                net: f(d, "f72"),
                pct: f(d, "f75"),
            },
            medium: FundTier {
                net: f(d, "f78"),
                pct: f(d, "f81"),
            },
            small: FundTier {
                net: f(d, "f84"),
                pct: f(d, "f87"),
            },
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_kline_field_order() {
        let j = json!({"data":{"klines":[
            "2026-10-13,1287.00,1274.89,1288.48,1268.11,26573,3393315572.00,1.58,-1.02,-13.11,0.21",
            "2026-10-14,1270.10,1278.02,1281.30,1266.00,7825,998025885.00,1.20,0.25,3.13,0.06"
        ]}});
        let ks = parse_klines(&j);
        assert_eq!(ks.len(), 2);
        let last = &ks[1];
        assert_eq!(last.date, "2026-10-14");
        assert_eq!(last.open, 1270.10);
        assert_eq!(last.close, 1278.02);
        assert_eq!(last.high, 1281.30);
        assert_eq!(last.low, 1266.00);
        assert_eq!(last.volume, 7825.0);
        assert_eq!(last.amount, 998_025_885.0);
        assert_eq!(last.amplitude, 1.20);
        assert_eq!(last.change_pct, 0.25);
        assert_eq!(last.change, 3.13);
        assert_eq!(last.turnover, 0.06);
    }

    #[test]
    fn kline_is_internally_consistent() {
        // 最高 >= max(开,收) >= min(开,收) >= 最低，字段序错了这条就会挂
        let j = json!({"data":{"klines":[
            "2026-10-14,1270.10,1278.02,1281.30,1266.00,7825,998025885.00,1.20,0.25,3.13,0.06"
        ]}});
        let k = parse_klines(&j).remove(0);
        assert!(k.high >= k.open && k.high >= k.close);
        assert!(k.low <= k.open && k.low <= k.close);
        assert!((k.high - k.low) / 1266.00 * 100.0 - k.amplitude < 0.1);
    }

    #[test]
    fn parses_trends_and_computes_avg_price() {
        let j = json!({"data":{"preClose":1274.89,"trends":[
            "2026-10-14 09:30,1270.10,1270.10,1270.10,1270.10,83,10541830.00,1270.100",
            "2026-10-14 09:31,1270.50,1271.99,1271.99,1266.00,620,78668754.00,1268.998"
        ]}});
        let t = parse_trends(&j);
        assert_eq!(t.pre_close, 1274.89);
        assert_eq!(t.points.len(), 2);
        assert_eq!(t.points[0].time, "09:30");
        assert_eq!(t.points[1].price, 1270.50);
        assert_eq!(t.points[1].volume, 620.0);
        // 均价线用累计成交额/累计成交量算，落在两根 K 线价格之间
        let cum_amount = 10_541_830.0 + 78_668_754.0;
        let cum_volume = (83.0 + 620.0) * 100.0;
        let expect = cum_amount / cum_volume;
        assert!((t.points[1].avg_price - expect).abs() < 1e-6);
        assert!(t.points[1].avg_price > 1266.0 && t.points[1].avg_price < 1271.0);
    }

    #[test]
    fn parses_rank_and_normalizes_code() {
        let j = json!({"data":{"diff":[
            {"f12":"300338","f14":"*ST开元","f2":2.92,"f3":20.16,"f4":0.49,"f17":2.46,
             "f15":2.92,"f16":2.46,"f18":2.43,"f5":202360,"f6":55629477,"f7":18.93,
             "f8":5.78,"f9":-16.52,"f10":8.45,"f20":1175664101,"f21":1021822587,
             "f23":-7.95,"f62":9562097}
        ]}});
        let r = parse_ranks(&j);
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].code, "sz300338", "3 开头应规范化成深市");
        assert_eq!(r[0].name, "*ST开元");
        assert_eq!(r[0].price, 2.92);
        assert_eq!(r[0].change_pct, 20.16);
        assert_eq!(r[0].main_net, 9562097.0);
        // 市值从元换算成亿
        assert!((r[0].total_mv - 11.7566).abs() < 0.001);
    }

    #[test]
    fn fund_flow_tiers_add_up_to_main() {
        let j = json!({"data":{"diff":[
            {"f12":"600519","f14":"贵州茅台","f62":39678194,"f184":3.93,
             "f66":45508050,"f69":4.5,"f72":-5829856,"f75":-0.58,
             "f78":-41433104,"f81":-4.1,"f84":-164853,"f87":-0.02}
        ]}});
        let fl = parse_fund_flow(&j);
        assert_eq!(fl[0].code, "sh600519");
        // 超大单 + 大单 应该等于主力净额，字段错位这条立刻挂
        let sum = fl[0].super_large.net + fl[0].large.net;
        assert!(
            (sum - fl[0].main.net).abs() < 1.0,
            "超大单+大单应等于主力净额"
        );
        assert_eq!(fl[0].main.pct, 3.93);
        assert_eq!(fl[0].small.pct, -0.02);
    }

    #[test]
    fn handles_empty_or_broken_payloads() {
        assert!(parse_klines(&json!({"data":null})).is_empty());
        assert!(parse_ranks(&json!({"rc":0})).is_empty());
        assert!(parse_fund_flow(&json!({})).is_empty());
        assert_eq!(parse_trends(&json!({})).points.len(), 0);
        // 字段不足的行要被丢掉，不能 panic
        let short = json!({"data":{"klines":["2026-10-14,1,2"]}});
        assert!(parse_klines(&short).is_empty());
    }
}
