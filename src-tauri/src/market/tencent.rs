//! 腾讯行情 `qt.gtimg.cn` 的实时快照解析。
//!
//! 接口返回 GBK 文本，每只股票一行：
//!
//! ```text
//! v_sh600519="1~贵州茅台~600519~1278.02~1274.89~1270.10~7825~4178~3642~1278.01~2~...";
//! ```
//!
//! 字段用 `~` 分隔，顺序是固定的（下标从 0 开始）：
//!
//! ```text
//! 1 名称        2 代码        3 现价        4 昨收       5 今开
//! 6 成交量(手)   7 外盘        8 内盘
//! 9..18 买一~买五（价、量交替）
//! 19..28 卖一~卖五
//! 30 时间       31 涨跌       32 涨跌%      33 最高      34 最低
//! 36 成交量(手)  37 成交额(万)  38 换手率     39 市盈率TTM
//! 43 振幅       44 流通市值(亿) 45 总市值(亿) 46 市净率
//! 47 涨停价     48 跌停价      49 量比       50 委差     51 均价
//! 52 市盈(动)   53 市盈(静)
//! ```

use super::symbol;
use super::types::{OrderLevel, Quote};

/// 按下标取数值，越界或空串都当 0
fn num(fields: &[&str], idx: usize) -> f64 {
    fields
        .get(idx)
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(0.0)
}

/// 取下标处的文本
fn text<'a>(fields: &'a [&'a str], idx: usize) -> &'a str {
    fields.get(idx).copied().unwrap_or("")
}

/// 解析整段响应（可能包含多只股票）
pub fn parse_quotes(raw: &str) -> Vec<Quote> {
    raw.lines().filter_map(parse_line).collect()
}

/// 解析单只股票的一行
pub fn parse_line(line: &str) -> Option<Quote> {
    let start = line.find('"')?;
    let end = line.rfind('"')?;
    if end <= start {
        return None;
    }
    let body = &line[start + 1..end];
    let fields: Vec<&str> = body.split('~').collect();
    // 正常至少要有 50 多段；少于这个数说明不是行情行（可能是错误提示）
    if fields.len() < 50 {
        return None;
    }

    // 腾讯返回的是 `sh600519`，直接当规范化代码用
    let code = text(&fields, 2);
    let normalized = symbol::normalize(&format!("{}{}", prefix_of(line), code));

    let mut bids = Vec::new();
    for i in 0..5 {
        bids.push(OrderLevel {
            price: num(&fields, 9 + i * 2),
            volume: num(&fields, 10 + i * 2),
        });
    }
    let mut asks = Vec::new();
    for i in 0..5 {
        asks.push(OrderLevel {
            price: num(&fields, 19 + i * 2),
            volume: num(&fields, 20 + i * 2),
        });
    }

    Some(Quote {
        code: normalized,
        symbol: code.to_string(),
        name: text(&fields, 1).to_string(),
        price: num(&fields, 3),
        prev_close: num(&fields, 4),
        open: num(&fields, 5),
        high: num(&fields, 33),
        low: num(&fields, 34),
        change: num(&fields, 31),
        change_pct: num(&fields, 32),
        volume: num(&fields, 36),
        // 成交额单位是「万」，这里统一换算成元
        amount: num(&fields, 37) * 10_000.0,
        turnover_rate: num(&fields, 38),
        amplitude: num(&fields, 43),
        outer: num(&fields, 7),
        inner: num(&fields, 8),
        volume_ratio: num(&fields, 49),
        order_ratio: num(&fields, 50),
        pe: num(&fields, 39),
        pb: num(&fields, 46),
        float_mv: num(&fields, 44),
        total_mv: num(&fields, 45),
        limit_up: num(&fields, 47),
        limit_down: num(&fields, 48),
        avg_price: num(&fields, 51),
        time: text(&fields, 30).to_string(),
        bids,
        asks,
    })
}

/// 从 `v_sh600519="..."` 里取出交易所前缀
fn prefix_of(line: &str) -> &str {
    for p in ["sh", "sz", "bj"] {
        if line.contains(&format!("v_{p}")) {
            return p;
        }
    }
    ""
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 2026-10-14 贵州茅台的真实返回，字段序照抄自线上接口
    const SAMPLE: &str = "v_sh600519=\"1~贵州茅台~600519~1278.02~1274.89~1270.10~7825~4178~3642~1278.01~2~1278.00~2~1277.97~1~1277.90~4~1277.21~1~1278.91~6~1278.99~1~1279.00~12~1279.12~2~1279.13~2~~20261014102853~3.13~0.25~1281.30~1266.00~1278.02/7825/998025885~7825~99803~0.06~19.62~~1281.30~1266.00~1.20~15976.29~15976.29~6.36~1402.38~1147.40~1.02~-13~1275.38~17.94~19.41~~0.06~99802.5885~0.0000~0~   A~GP-A\";";

    #[test]
    fn parses_realtime_quote_fields() {
        let q = parse_line(SAMPLE).expect("应能解析");
        assert_eq!(q.code, "sh600519");
        assert_eq!(q.symbol, "600519");
        assert_eq!(q.name, "贵州茅台");
        assert_eq!(q.price, 1278.02);
        assert_eq!(q.prev_close, 1274.89);
        assert_eq!(q.open, 1270.10);
        assert_eq!(q.high, 1281.30);
        assert_eq!(q.low, 1266.00);
        assert_eq!(q.change, 3.13);
        assert_eq!(q.change_pct, 0.25);
        assert_eq!(q.volume, 7825.0);
        assert_eq!(q.time, "20261014102853");
        assert_eq!(q.turnover_rate, 0.06);
        assert_eq!(q.amplitude, 1.20);
        assert_eq!(q.volume_ratio, 1.02);
        assert_eq!(q.avg_price, 1275.38);
        assert_eq!(q.limit_up, 1402.38);
        assert_eq!(q.limit_down, 1147.40);
        assert_eq!(q.total_mv, 15976.29);
        assert_eq!(q.outer, 4178.0);
        assert_eq!(q.inner, 3642.0);
    }

    #[test]
    fn converts_amount_from_wan_to_yuan() {
        let q = parse_line(SAMPLE).unwrap();
        // 接口给的是 99803 万，页面要展示的是元
        assert_eq!(q.amount, 998_030_000.0);
    }

    #[test]
    fn parses_five_level_order_book() {
        let q = parse_line(SAMPLE).unwrap();
        assert_eq!(q.bids.len(), 5);
        assert_eq!(
            q.bids[0],
            OrderLevel {
                price: 1278.01,
                volume: 2.0
            }
        );
        assert_eq!(
            q.bids[4],
            OrderLevel {
                price: 1277.21,
                volume: 1.0
            }
        );
        assert_eq!(q.asks.len(), 5);
        assert_eq!(
            q.asks[0],
            OrderLevel {
                price: 1278.91,
                volume: 6.0
            }
        );
        assert_eq!(
            q.asks[4],
            OrderLevel {
                price: 1279.13,
                volume: 2.0
            }
        );
    }

    #[test]
    fn cross_checks_against_derived_values() {
        // 用接口自己给的涨跌额和昨收反推现价，验证字段没串位
        let q = parse_line(SAMPLE).unwrap();
        assert!(
            (q.price - (q.prev_close + q.change)).abs() < 0.02,
            "现价应等于昨收+涨跌"
        );
        assert!(
            (q.change_pct - q.change / q.prev_close * 100.0).abs() < 0.02,
            "涨跌幅应自洽"
        );
        assert!(
            (q.amplitude - (q.high - q.low) / q.prev_close * 100.0).abs() < 0.05,
            "振幅应自洽"
        );
    }

    #[test]
    fn parses_index_line_without_order_book() {
        // 指数的五档全是 0，但不能因此解析失败
        let line = "v_sh000001=\"1~上证指数~000001~3803.83~3800.86~3790.63~203238484~0~0~0.00~0~0.00~0~0.00~0~0.00~0~0.00~0~0.00~0~0.00~0~0.00~0~0.00~0~0.00~0~~20261014102830~2.97~0.08~3811.81~3786.21~3803.83/203238484/295936974560~203238484~29593697~0.42~16.53~~3811.81~3786.21~0.67~596130.83~668470.23~0.00~-1~-1~1.74~0~3798.02~\";";
        let q = parse_line(line).expect("指数也应能解析");
        assert_eq!(q.code, "sh000001");
        assert_eq!(q.name, "上证指数");
        assert_eq!(q.price, 3803.83);
        assert_eq!(q.bids[0].price, 0.0, "指数没有盘口");
    }

    #[test]
    fn rejects_garbage_line() {
        assert!(parse_line("v_sh600519=\"行情异常\"").is_none());
        assert!(parse_line("").is_none());
        assert!(
            parse_line("v_sh600519=\"1~2~3\";").is_none(),
            "字段太少应拒绝"
        );
    }
}
