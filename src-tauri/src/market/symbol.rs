//! 代码规范化：把用户随手输入的代码变成各家接口都能认的形式。

/// 判断交易所前缀。
///
/// 沪市：6 开头（主板/科创板 688）、5 开头（基金）、11/12 开头（可转债）
/// 深市：0/3 开头（主板/创业板）、1/2 开头（基金）、12 开头（可转债）
/// 北交所：4/8 开头
pub fn exchange_of(symbol: &str) -> &'static str {
    let s: Vec<char> = symbol.chars().collect();
    let Some(first) = s.first() else { return "sh" };
    match first {
        '6' | '5' => "sh",
        '9' => "sh", // B 股
        '0' | '3' | '1' | '2' => "sz",
        '4' | '8' => "bj",
        _ => "sh",
    }
}

/// 规范化成 `sh600519` 这种带前缀的小写形式。
///
/// 已经带前缀的（`sh600519` / `SH.600519`）直接清洗，
/// 纯数字或带 `.` 的按首位数字推断交易所。
pub fn normalize(input: &str) -> String {
    let cleaned: String = input
        .trim()
        .to_ascii_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect();
    if cleaned.is_empty() {
        return cleaned;
    }
    if let Some(rest) = cleaned.strip_prefix("sh") {
        return format!("sh{rest}");
    }
    if let Some(rest) = cleaned.strip_prefix("sz") {
        return format!("sz{rest}");
    }
    if let Some(rest) = cleaned.strip_prefix("bj") {
        return format!("bj{rest}");
    }
    // 纯数字（或已经把交易所前缀去掉了）
    format!("{}{}", exchange_of(&cleaned), cleaned)
}

/// 取纯数字代码
pub fn symbol_of(normalized: &str) -> &str {
    normalized
        .trim_start_matches("sh")
        .trim_start_matches("sz")
        .trim_start_matches("bj")
}

/// 转成东方财富的 secid：沪市 `1.600519`，深市/北交所 `0.000001`
pub fn secid(normalized: &str) -> String {
    if let Some(rest) = normalized.strip_prefix("sh") {
        format!("1.{rest}")
    } else {
        let symbol = symbol_of(normalized);
        format!("0.{symbol}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_plain_symbols_by_exchange() {
        assert_eq!(normalize("600519"), "sh600519");
        assert_eq!(normalize("000001"), "sz000001");
        assert_eq!(normalize("300750"), "sz300750");
        assert_eq!(normalize("688981"), "sh688981");
        assert_eq!(normalize("430047"), "bj430047");
        assert_eq!(normalize(" 600519 "), "sh600519");
    }

    #[test]
    fn keeps_existing_prefix_and_cleans_noise() {
        assert_eq!(normalize("SH600519"), "sh600519");
        assert_eq!(normalize("sz.000001"), "sz000001");
        assert_eq!(normalize("sh 600519"), "sh600519");
        assert_eq!(normalize(""), "");
    }

    #[test]
    fn builds_secid_for_eastmoney() {
        assert_eq!(secid("sh600519"), "1.600519");
        assert_eq!(secid("sz000001"), "0.000001");
        assert_eq!(secid("sh000001"), "1.000001");
        assert_eq!(secid("bj430047"), "0.430047");
    }
}