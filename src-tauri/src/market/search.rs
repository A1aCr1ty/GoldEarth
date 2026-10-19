//! 股票名称、代码和拼音补全；只返回当前看板支持的沪深京 A 股。
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StockSuggestion {
    pub code: String,
    pub name: String,
    pub market: String,
}

pub async fn search_stocks(query: &str) -> Result<Vec<StockSuggestion>, String> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    if query.chars().count() > 64 {
        return Err("搜索内容最多 64 个字符".into());
    }
    // 保留带交易所代码的输入习惯，搜索接口按数字查询，再按交易所过滤。
    let lower = query.to_ascii_lowercase();
    let (prefix, input) = ["sh", "sz", "bj"]
        .iter()
        .find_map(|prefix| {
            let code = lower.strip_prefix(prefix)?.trim_start_matches('.');
            (code.len() == 6 && code.bytes().all(|b| b.is_ascii_digit())).then_some((*prefix, code))
        })
        .unwrap_or(("", query));
    let key = format!("stock-search:{lower}");
    if let Some(cached) = super::cache_get(&key, Duration::from_secs(60)) {
        if let Ok(items) = serde_json::from_value(cached) {
            return Ok(items);
        }
    }
    let data = super::client()
        .get("https://searchapi.eastmoney.com/api/suggest/get")
        .query(&[("input", input), ("type", "14"), ("count", "30")])
        .header("Referer", "https://quote.eastmoney.com/")
        .send()
        .await
        .map_err(|e| format!("股票搜索请求失败：{e}"))?
        .error_for_status()
        .map_err(|e| format!("股票搜索服务异常：{e}"))?
        .json::<Value>()
        .await
        .map_err(|e| format!("股票搜索响应解析失败：{e}"))?;
    let items: Vec<_> = parse_suggestions(&data)?
        .into_iter()
        .filter(|item| prefix.is_empty() || item.code.starts_with(prefix))
        .take(10)
        .collect();
    if let Ok(value) = serde_json::to_value(&items) {
        super::cache_put(&key, &value);
    }
    Ok(items)
}

fn parse_suggestions(data: &Value) -> Result<Vec<StockSuggestion>, String> {
    let table = data
        .get("QuotationCodeTable")
        .ok_or("股票搜索响应缺少结果表，请稍后重试")?;
    let rows = match table.get("Data") {
        Some(Value::Null) => return Ok(Vec::new()),
        Some(Value::Array(rows)) => rows,
        _ => return Err("股票搜索响应格式异常，请稍后重试".into()),
    };
    let mut seen = HashSet::new();
    Ok(rows
        .iter()
        .filter_map(|row| {
            let code = row.get("Code")?.as_str()?;
            let name = row.get("Name")?.as_str()?.trim();
            let market = row.get("SecurityTypeName")?.as_str()?;
            let prefix = match market {
                "沪A" => "sh",
                "深A" => "sz",
                "京A" => "bj",
                _ => return None,
            };
            if code.len() != 6 || !code.bytes().all(|b| b.is_ascii_digit()) || name.is_empty() {
                return None;
            }
            let code = format!("{prefix}{code}");
            if !seen.insert(code.clone()) {
                return None;
            }
            Some(StockSuggestion {
                code,
                name: name.to_string(),
                market: market.to_string(),
            })
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn maps_chinese_names_and_exchange_codes_without_confusing_indices_or_funds() {
        let rows = json!({"QuotationCodeTable":{"Data":[
            {"Code":"000001","Name":"平安银行","SecurityTypeName":"深A"},
            {"Code":"000001","Name":"上证指数","SecurityTypeName":"指数"},
            {"Code":"000001","Name":"华夏成长混合","SecurityTypeName":"基金"},
            {"Code":"600519","Name":"贵州茅台","SecurityTypeName":"沪A"},
            {"Code":"920002","Name":"万达轴承","SecurityTypeName":"京A"},
            {"Code":"835688","Name":"平安环保","SecurityTypeName":"三板"},
            {"Code":"01833","Name":"平安好医生","SecurityTypeName":"港股"},
            {"Code":"600519","Name":"贵州茅台","SecurityTypeName":"沪A"},
            {"Code":"INVALID","Name":"坏数据","SecurityTypeName":"深A"}
        ]}});
        let items = parse_suggestions(&rows).unwrap();
        assert_eq!(items.len(), 3);
        assert_eq!(items[0].code, "sz000001");
        assert_eq!(items[1].name, "贵州茅台");
        assert_eq!(items[2].code, "bj920002");
    }

    #[test]
    fn distinguishes_no_matches_from_a_broken_response() {
        assert!(
            parse_suggestions(&json!({"QuotationCodeTable":{"Data":null}}))
                .unwrap()
                .is_empty()
        );
        assert!(
            parse_suggestions(&json!({"QuotationCodeTable":{"Data":[]}}))
                .unwrap()
                .is_empty()
        );
        assert!(parse_suggestions(&json!({"error":"unavailable"})).is_err());
    }

    #[tokio::test]
    #[ignore = "访问真实股票搜索服务"]
    async fn live_chinese_stock_search() {
        let items = search_stocks("茅台").await.unwrap();
        assert!(items
            .iter()
            .any(|item| item.code == "sh600519" && item.name == "贵州茅台"));
        assert!(search_stocks("平安").await.unwrap().len() >= 2);
        assert!(search_stocks("sz000001")
            .await
            .unwrap()
            .iter()
            .any(|item| item.name == "平安银行"));
    }
}
