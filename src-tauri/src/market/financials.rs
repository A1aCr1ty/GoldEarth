//! 公司定期报告的主要财务指标，来源为东方财富 F10。
//! 所有金额保留上游的人民币元口径，缺失值保持 `None`，不能用零填充。

use std::collections::HashMap;
use std::time::{Duration, Instant};

use chrono::Local;
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::symbol;

const FRESH_TTL: Duration = Duration::from_secs(6 * 60 * 60);
const STALE_TTL: Duration = Duration::from_secs(24 * 60 * 60);
const PAGE_SIZE: usize = 12;

static CACHE: Lazy<Mutex<HashMap<String, (Instant, FinancialReports)>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinancialReport {
    pub code: String,
    pub name: String,
    pub org_type: String,
    pub report_date: String,
    pub report_date_name: String,
    pub report_type: String,
    pub notice_date: String,
    pub currency: String,
    pub revenue: Option<f64>,
    pub net_profit: Option<f64>,
    pub deducted_net_profit: Option<f64>,
    pub operating_cash_flow: Option<f64>,
    pub revenue_yoy: Option<f64>,
    pub net_profit_yoy: Option<f64>,
    pub deducted_net_profit_yoy: Option<f64>,
    pub quarter_revenue_yoy: Option<f64>,
    pub quarter_net_profit_yoy: Option<f64>,
    pub eps: Option<f64>,
    pub bps: Option<f64>,
    pub roe_weighted: Option<f64>,
    pub gross_margin: Option<f64>,
    pub net_margin: Option<f64>,
    pub debt_ratio: Option<f64>,
    pub current_ratio: Option<f64>,
    pub quick_ratio: Option<f64>,
    pub total_assets: Option<f64>,
    pub total_equity: Option<f64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinancialReports {
    pub code: String,
    pub name: String,
    pub source: String,
    pub source_url: String,
    pub report_url: String,
    pub updated_at: String,
    pub from_cache: bool,
    pub warning: Option<String>,
    pub reports: Vec<FinancialReport>,
}

fn client() -> &'static reqwest::Client {
    static CLIENT: Lazy<reqwest::Client> = Lazy::new(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .connect_timeout(Duration::from_secs(6))
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
            .build()
            .expect("构建财务数据 HTTP 客户端失败")
    });
    &CLIENT
}

fn secucode(normalized: &str) -> Result<String, String> {
    let digits = symbol::symbol_of(normalized);
    if digits.len() != 6 || !digits.chars().all(|c| c.is_ascii_digit()) {
        return Err(format!("无效的股票代码：{normalized}"));
    }
    let suffix = match normalized.get(..2) {
        Some("sh") => "SH",
        Some("sz") => "SZ",
        Some("bj") => "BJ",
        _ => return Err(format!("无法识别交易所：{normalized}")),
    };
    Ok(format!("{digits}.{suffix}"))
}

fn endpoint(normalized: &str) -> Result<String, String> {
    Ok(format!(
        "https://datacenter.eastmoney.com/securities/api/data/v1/get?reportName=RPT_F10_FINANCE_MAINFINADATA&columns=ALL&filter=(SECUCODE%3D%22{}%22)&pageNumber=1&pageSize={PAGE_SIZE}&sortTypes=-1&sortColumns=REPORT_DATE&source=HSF10&client=PC",
        secucode(normalized)?
    ))
}

fn text(row: &Value, key: &str) -> String {
    row.get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn number(row: &Value, key: &str) -> Option<f64> {
    match row.get(key) {
        Some(Value::Number(n)) => n.as_f64().filter(|v| v.is_finite()),
        Some(Value::String(s)) => s.trim().parse::<f64>().ok().filter(|v| v.is_finite()),
        _ => None,
    }
}

fn date(row: &Value, key: &str) -> String {
    text(row, key).chars().take(10).collect()
}

fn parse_report(normalized: &str, row: &Value) -> Option<FinancialReport> {
    let digits = symbol::symbol_of(normalized);
    if text(row, "SECURITY_CODE") != digits {
        return None;
    }
    let report_date = date(row, "REPORT_DATE");
    if report_date.len() != 10 {
        return None;
    }
    Some(FinancialReport {
        code: normalized.to_string(),
        name: text(row, "SECURITY_NAME_ABBR"),
        org_type: text(row, "ORG_TYPE"),
        report_date,
        report_date_name: text(row, "REPORT_DATE_NAME"),
        report_type: text(row, "REPORT_TYPE"),
        notice_date: date(row, "NOTICE_DATE"),
        currency: text(row, "CURRENCY"),
        revenue: number(row, "TOTALOPERATEREVE"),
        net_profit: number(row, "PARENTNETPROFIT"),
        deducted_net_profit: number(row, "KCFJCXSYJLR"),
        operating_cash_flow: number(row, "NETCASH_OPERATE_PK"),
        revenue_yoy: number(row, "TOTALOPERATEREVETZ"),
        net_profit_yoy: number(row, "PARENTNETPROFITTZ"),
        deducted_net_profit_yoy: number(row, "KCFJCXSYJLRTZ"),
        quarter_revenue_yoy: number(row, "DJD_TOI_YOY"),
        quarter_net_profit_yoy: number(row, "DJD_DPNP_YOY"),
        eps: number(row, "EPSJB"),
        bps: number(row, "BPS"),
        roe_weighted: number(row, "ROEJQ"),
        gross_margin: number(row, "XSMLL"),
        net_margin: number(row, "XSJLL"),
        debt_ratio: number(row, "ZCFZL"),
        current_ratio: number(row, "LD"),
        quick_ratio: number(row, "SD"),
        total_assets: number(row, "TOTAL_ASSETS_PK"),
        total_equity: number(row, "TOTAL_EQUITY_PK"),
    })
}

fn parse_reports(normalized: &str, value: &Value) -> Result<Vec<FinancialReport>, String> {
    if value.get("success").and_then(Value::as_bool) != Some(true) {
        return Err(value
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("财务数据接口返回失败")
            .to_string());
    }
    let rows = value
        .get("result")
        .and_then(|r| r.get("data"))
        .and_then(Value::as_array)
        .ok_or_else(|| "财务数据接口缺少 result.data".to_string())?;
    let mut reports: Vec<FinancialReport> = rows
        .iter()
        .filter_map(|row| parse_report(normalized, row))
        .collect();
    reports.sort_by(|a, b| b.report_date.cmp(&a.report_date));
    reports.dedup_by(|a, b| a.report_date == b.report_date);
    if reports.is_empty() {
        return Err("没有取到该股票的定期报告主要指标".into());
    }
    Ok(reports)
}

pub async fn financial_reports(code: &str, force: bool) -> Result<FinancialReports, String> {
    let normalized = symbol::normalize(code);
    let source_url = endpoint(&normalized)?;
    if !force {
        if let Some((at, cached)) = CACHE.lock().get(&normalized).cloned() {
            if at.elapsed() <= FRESH_TTL {
                return Ok(cached);
            }
        }
    }

    let result = async {
        let value = client()
            .get(&source_url)
            .header("Referer", "https://emweb.securities.eastmoney.com/")
            .send()
            .await
            .map_err(|e| format!("财报请求失败：{e}"))?
            .error_for_status()
            .map_err(|e| format!("财报接口状态异常：{e}"))?
            .json::<Value>()
            .await
            .map_err(|e| format!("财报响应解析失败：{e}"))?;
        let reports = parse_reports(&normalized, &value)?;
        let name = reports[0].name.clone();
        Ok::<FinancialReports, String>(FinancialReports {
            code: normalized.clone(),
            name,
            source: "东方财富 F10 · 定期报告主要指标".into(),
            source_url: source_url.clone(),
            report_url: format!(
                "https://data.eastmoney.com/notices/stock/{}.html",
                symbol::symbol_of(&normalized)
            ),
            updated_at: Local::now().to_rfc3339(),
            from_cache: false,
            warning: None,
            reports,
        })
    }
    .await;

    match result {
        Ok(data) => {
            CACHE
                .lock()
                .insert(normalized, (Instant::now(), data.clone()));
            Ok(data)
        }
        Err(error) => {
            if let Some((at, mut cached)) = CACHE.lock().get(&normalized).cloned() {
                if at.elapsed() <= STALE_TTL {
                    cached.from_cache = true;
                    cached.warning = Some(format!("实时财报获取失败，显示上次成功数据：{error}"));
                    return Ok(cached);
                }
            }
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_real_main_indicator_fields_and_missing_values() {
        let raw = serde_json::json!({
            "success": true,
            "result": {"data": [{
                "SECURITY_CODE": "600519",
                "SECURITY_NAME_ABBR": "贵州茅台",
                "ORG_TYPE": "通用",
                "REPORT_DATE": "2026-09-30 00:00:00",
                "REPORT_DATE_NAME": "2026三季报",
                "REPORT_TYPE": "三季报",
                "NOTICE_DATE": "2026-10-31 00:00:00",
                "CURRENCY": "CNY",
                "TOTALOPERATEREVE": 133283652508.95,
                "PARENTNETPROFIT": 64467425981.95,
                "KCFJCXSYJLR": null,
                "NETCASH_OPERATE_PK": 84058979832.29,
                "TOTALOPERATEREVETZ": 1.817946648268,
                "PARENTNETPROFITTZ": -0.246524447439,
                "DJD_TOI_YOY": 3.002887537637,
                "DJD_DPNP_YOY": 3.780531087717,
                "EPSJB": 51.53,
                "ROEJQ": 24.47,
                "XSMLL": 89.581093798,
                "XSJLL": 50.9404935478,
                "ZCFZL": 11.9015685357,
                "LD": 7.186652766903,
                "SD": "-",
                "TOTAL_ASSETS_PK": 318304891882.72,
                "TOTAL_EQUITY_PK": 280421617022.85
            }]}
        });
        let rows = parse_reports("sh600519", &raw).unwrap();
        assert_eq!(rows.len(), 1);
        let row = &rows[0];
        assert_eq!(row.report_date, "2026-09-30");
        assert_eq!(row.notice_date, "2026-10-31");
        assert_eq!(row.revenue, Some(133283652508.95));
        assert_eq!(row.net_profit_yoy, Some(-0.246524447439));
        assert_eq!(row.quarter_revenue_yoy, Some(3.002887537637));
        assert_eq!(row.roe_weighted, Some(24.47));
        assert_eq!(row.deducted_net_profit, None);
        assert_eq!(row.quick_ratio, None, "占位符不能解析成零");
    }

    #[test]
    fn rejects_other_securities_and_builds_exchange_suffixes() {
        assert_eq!(secucode("sh600519").unwrap(), "600519.SH");
        assert_eq!(secucode("sz000001").unwrap(), "000001.SZ");
        assert_eq!(secucode("bj430047").unwrap(), "430047.BJ");
        assert!(secucode("60051").is_err());
        let raw = serde_json::json!({
            "success": true,
            "result": {"data": [{"SECURITY_CODE": "000001", "REPORT_DATE": "2026-09-30"}]}
        });
        assert!(parse_reports("sh600519", &raw).is_err());
    }

    #[tokio::test]
    #[ignore = "需要联网"]
    async fn live_fetch_financial_reports() {
        for code in ["sh600519", "sz000001"] {
            let data = financial_reports(code, true).await.expect("真实财报");
            println!(
                "{} {} 最新 {:?}",
                data.code,
                data.name,
                data.reports.first()
            );
            assert_eq!(data.code, code);
            assert!(!data.reports.is_empty());
            assert!(data.reports[0].revenue.is_some());
            assert!(data.reports[0].net_profit.is_some());
            assert!(!data.reports[0].notice_date.is_empty());
        }
    }
}
