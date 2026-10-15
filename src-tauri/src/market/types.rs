//! 行情数据模型。
//!
//! 数据来自两个公开接口：
//! - 腾讯 `qt.gtimg.cn`：实时快照（含五档盘口）
//! - 东方财富 `push2his` / `push2`：历史 K 线、当日分时、榜单、资金流
//!
//! 约定：所有字段都是「已经是真实数值」的形式（比如换手率是 0.06 表示 0.06%），
//! 前端只负责格式化，不再做单位换算。

use serde::{Deserialize, Serialize};

/// 五档盘口的一档
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderLevel {
    pub price: f64,
    /// 手
    pub volume: f64,
}

/// 实时快照。指数和个股共用同一个结构，指数没有的字段会是 0
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Quote {
    /// 带交易所前缀的规范化代码，如 `sh600519`
    pub code: String,
    /// 纯数字代码，如 `600519`
    pub symbol: String,
    pub name: String,
    pub price: f64,
    pub prev_close: f64,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub change: f64,
    pub change_pct: f64,
    /// 成交量（手）
    pub volume: f64,
    /// 成交额（元）
    pub amount: f64,
    /// 换手率 %
    pub turnover_rate: f64,
    /// 振幅 %
    pub amplitude: f64,
    /// 成交量（手）
    pub outer: f64,
    pub inner: f64,
    /// 量比
    pub volume_ratio: f64,
    /// 委比，正为买盘强
    pub order_ratio: f64,
    pub pe: f64,
    pub pb: f64,
    /// 总市值（亿元）
    pub total_mv: f64,
    /// 流通市值（亿元）
    pub float_mv: f64,
    pub limit_up: f64,
    pub limit_down: f64,
    pub avg_price: f64,
    /// 行情时间，形如 `20261014102853`
    pub time: String,
    pub bids: Vec<OrderLevel>,
    pub asks: Vec<OrderLevel>,
}

/// 一根 K 线
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Candle {
    /// `YYYY-MM-DD`
    pub date: String,
    pub open: f64,
    pub close: f64,
    pub high: f64,
    pub low: f64,
    /// 成交量（手）
    pub volume: f64,
    /// 成交额（元）
    pub amount: f64,
    /// 振幅 %
    pub amplitude: f64,
    /// 涨跌幅 %
    pub change_pct: f64,
    /// 涨跌额
    pub change: f64,
    /// 换手率 %
    pub turnover: f64,
}

/// K 线周期
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Period {
    /// 分时
    Minute,
    Day,
    Week,
    Month,
}

impl Period {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "minute" | "1" => Some(Period::Minute),
            "day" | "101" => Some(Period::Day),
            "week" | "102" => Some(Period::Week),
            "month" | "103" => Some(Period::Month),
            _ => None,
        }
    }

    /// 东方财富 klt 参数
    pub fn klt(self) -> &'static str {
        match self {
            Period::Minute => "1",
            Period::Day => "101",
            Period::Week => "102",
            Period::Month => "103",
        }
    }

    /// 腾讯复权 K 线接口的周期名；分钟线仍由东方财富提供。
    pub fn tencent_kline(self) -> Option<(&'static str, &'static str)> {
        match self {
            Period::Minute => None,
            Period::Day => Some(("day", "qfqday")),
            Period::Week => Some(("week", "qfqweek")),
            Period::Month => Some(("month", "qfqmonth")),
        }
    }
}

/// 当日分时的一个点
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrendPoint {
    /// `HH:MM`
    pub time: String,
    pub price: f64,
    /// 分时均价线
    pub avg_price: f64,
    /// 该分钟成交量（手）
    pub volume: f64,
    /// 该分钟成交额（元）
    pub amount: f64,
}

/// 当日分时
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Trend {
    pub pre_close: f64,
    pub points: Vec<TrendPoint>,
}

/// 榜单条目（涨幅榜 / 成交额榜…）
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RankItem {
    pub code: String,
    pub name: String,
    pub price: f64,
    pub change_pct: f64,
    pub change: f64,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub prev_close: f64,
    /// 成交量（手）
    pub volume: f64,
    /// 成交额（元）
    pub amount: f64,
    pub amplitude: f64,
    pub turnover_rate: f64,
    pub pe: f64,
    pub pb: f64,
    pub volume_ratio: f64,
    /// 总市值（亿元）
    pub total_mv: f64,
    /// 流通市值（亿元）
    pub float_mv: f64,
    /// 主力净流入（元）
    pub main_net: f64,
}

/// 资金流分档明细
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FundTier {
    /// 净额（元）
    pub net: f64,
    /// 净占比 %
    pub pct: f64,
}

/// 个股资金流
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FundFlow {
    pub code: String,
    pub name: String,
    pub main: FundTier,
    pub super_large: FundTier,
    pub large: FundTier,
    pub medium: FundTier,
    pub small: FundTier,
}

/// 榜单类型
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RankKind {
    /// 涨幅榜
    Gainers,
    /// 跌幅榜
    Losers,
    /// 成交额榜
    Amount,
    /// 换手率榜
    Turnover,
}

impl RankKind {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "gainers" => Some(RankKind::Gainers),
            "losers" => Some(RankKind::Losers),
            "amount" => Some(RankKind::Amount),
            "turnover" => Some(RankKind::Turnover),
            _ => None,
        }
    }

    /// 排序字段 fid
    pub fn fid(self) -> &'static str {
        match self {
            RankKind::Gainers | RankKind::Losers => "f3",
            RankKind::Amount => "f6",
            RankKind::Turnover => "f8",
        }
    }

    /// po：1 降序，0 升序
    pub fn desc(self) -> &'static str {
        match self {
            RankKind::Losers => "0",
            _ => "1",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_period_and_rank_kind() {
        assert_eq!(Period::parse("day"), Some(Period::Day));
        assert_eq!(Period::parse("102"), Some(Period::Week));
        assert_eq!(Period::parse("minute"), Some(Period::Minute));
        assert_eq!(Period::parse("nonsense"), None);

        assert_eq!(RankKind::parse("gainers"), Some(RankKind::Gainers));
        assert_eq!(RankKind::parse("losers"), Some(RankKind::Losers));
        assert_eq!(RankKind::parse("nope"), None);
        assert_eq!(RankKind::Losers.desc(), "0", "跌幅榜要升序");
        assert_eq!(RankKind::Amount.fid(), "f6");
    }
}
