use std::{path::Path, process::Stdio, time::Duration};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

pub(super) static REVIEW: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[tauri::command]
pub async fn stock_swing_review(app: AppHandle, codes: Vec<String>) -> Result<Value, String> {
    if codes.is_empty() || codes.len()>50 || codes.iter().any(|s| s.len()!=6 || !s.bytes().all(|b| b.is_ascii_digit())) {
        return Err("请选择1至50只持仓证券".into());
    }
    let _guard=REVIEW.try_lock().map_err(|_| "复盘正在运行，请完成后重试".to_string())?;
    let root=app.path().app_data_dir().map_err(|e| e.to_string())?.join("strategy");
    prepare_engine(&root)?;
    if !root.join("snapshot.json").exists() {
        std::fs::write(root.join("snapshot.json"),serde_json::to_vec(&strategy_snapshot(app.clone())?).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
    }
    let python=std::env::var_os("GOLDEARTH_PYTHON").unwrap_or_else(|| "python".into());
    let mut cmd=Command::new(python);
    cmd.arg("swing_review.py").arg(serde_json::to_string(&codes).map_err(|e|e.to_string())?).current_dir(root)
        .env("PYTHONIOENCODING","utf-8").stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x08000000);
    let output=tokio::time::timeout(Duration::from_secs(1800),cmd.output()).await.map_err(|_|"持仓复盘超过30分钟，已停止".to_string())?
        .map_err(|e|format!("Python启动失败：{e}"))?;
    if !output.status.success() { return Err(String::from_utf8_lossy(&output.stderr).chars().rev().take(1500).collect::<String>().chars().rev().collect()); }
    serde_json::from_slice(&output.stdout).map_err(|e|format!("持仓复盘解析失败：{e}"))
}

#[tauri::command]
pub async fn index_rule_backtest(app: AppHandle, code: String, bars: Vec<crate::market::types::Candle>) -> Result<Value, String> {
    let digits = code.strip_prefix("sh").or_else(|| code.strip_prefix("sz")).unwrap_or("");
    if digits.len()!=6 || !digits.bytes().all(|b| b.is_ascii_digit()) || !((code.starts_with("sh") && matches!(digits.as_bytes()[0], b'5' | b'6')) || (code.starts_with("sz") && matches!(digits.as_bytes()[0], b'0' | b'1' | b'2' | b'3'))) {
        return Err("ETF代码或交易所无效".into());
    }
    if !(60..=5000).contains(&bars.len()) { return Err("本地回测需要60至5000根日线".into()); }
    let root=app.path().app_data_dir().map_err(|e| e.to_string())?.join("strategy");
    prepare_engine(&root)?;
    let python=std::env::var_os("GOLDEARTH_PYTHON").unwrap_or_else(|| "python".into());
    let mut cmd=Command::new(python);
    cmd.arg("index_rule_local.py").current_dir(root).env("PYTHONIOENCODING","utf-8")
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x08000000);
    let mut child=cmd.spawn().map_err(|e|format!("无法启动 Python：{e}。请安装 Python、numpy、pandas；可通过 GOLDEARTH_PYTHON 指定解释器"))?;
    let payload=serde_json::to_vec(&json!({"code":code,"bars":bars})).map_err(|e|e.to_string())?;
    child.stdin.take().ok_or("无法打开回测输入")?.write_all(&payload).await.map_err(|e|format!("写入回测数据失败：{e}"))?;
    let output=tokio::time::timeout(Duration::from_secs(120),child.wait_with_output()).await
        .map_err(|_|"指数双策略回测超过2分钟，已停止".to_string())?
        .map_err(|e|format!("指数回测运行失败：{e}"))?;
    if !output.status.success() {
        let stderr=String::from_utf8_lossy(&output.stderr);
        return Err(stderr.chars().rev().take(2000).collect::<String>().chars().rev().collect());
    }
    let value:Value=serde_json::from_slice(&output.stdout).map_err(|e|format!("指数回测结果解析失败：{e}"))?;
    if value["code"].as_str()!=Some(code.as_str()) || !value["grid"]["latest"].is_object() || !value["oversold"]["latest"].is_object()
        || !(value["natr"].is_null() || value["natr"]["selected"]["latest"].is_object()) {
        return Err("指数回测结果不完整".into());
    }
    Ok(value)
}

fn read_snapshot(path: &Path) -> Result<Value, String> {
    let value: Value = serde_json::from_slice(&std::fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|e| format!("策略结果解析失败：{e}"))?;
    validate(&value)?;
    Ok(value)
}

fn validate(value: &Value) -> Result<(), String> {
    if !value["results"]["asof"].is_string()
        || !value["results"]["stocks"].is_array()
        || !value["adaptive"]["selected"].is_object()
    { return Err("策略结果不完整，请重新复盘".into()); }
    Ok(())
}

#[tauri::command]
pub fn strategy_snapshot(app: AppHandle) -> Result<Value, String> {
    let path = app.path().app_data_dir().map_err(|e| e.to_string())?.join("strategy/snapshot.json");
    if path.exists() { return read_snapshot(&path); }
    Ok(json!({
        "results": serde_json::from_str::<Value>(include_str!("../../resources/strategy/platform/results.json")).map_err(|e| e.to_string())?,
        "adaptive": serde_json::from_str::<Value>(include_str!("../../resources/strategy/platform/adaptive_results.json")).map_err(|e| e.to_string())?
    }))
}

#[tauri::command]
pub async fn strategy_review(app: AppHandle) -> Result<Value, String> {
    let _guard = REVIEW.try_lock().map_err(|_| "策略复盘正在运行，请稍后查看结果".to_string())?;
    let root = app.path().app_data_dir().map_err(|e| e.to_string())?.join("strategy");
    std::fs::create_dir_all(root.join("platform")).map_err(|e| e.to_string())?;
    // Refresh engine code on upgrades; keep downloaded prices and review history.
    prepare_engine(&root)?;
    let python = std::env::var_os("GOLDEARTH_PYTHON").unwrap_or_else(|| "python".into());
    // Keep the bundled baseline alongside the refreshed adaptive comparison.
    if !root.join("platform/results.json").exists() {
        std::fs::write(root.join("platform/results.json"), include_str!("../../resources/strategy/platform/results.json")).map_err(|e| e.to_string())?;
    }
    for script in ["refresh_research.py"] {
        let mut cmd = Command::new(&python);
        cmd.arg(script).current_dir(&root).env("PYTHONIOENCODING", "utf-8")
            .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
        #[cfg(windows)]
        cmd.creation_flags(0x08000000);
        let output = tokio::time::timeout(Duration::from_secs(7200), cmd.output()).await
            .map_err(|_| format!("{script} 超过 2 小时，已停止；请检查网络后重试"))?
            .map_err(|e| format!("无法启动 Python：{e}。请安装 Python、numpy、pandas；可通过 GOLDEARTH_PYTHON 指定解释器"))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let tail: String = stderr.chars().rev().take(2000).collect::<String>().chars().rev().collect();
            return Err(format!("{script} 运行失败：{tail}"));
        }
    }
    let read = |name: &str| -> Result<Value, String> {
        serde_json::from_slice(&std::fs::read(root.join("platform").join(name)).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())
    };
    let snapshot = json!({ "results": read("results.json")?, "adaptive": read("adaptive_results.json")? });
    validate(&snapshot)?;
    // Publish the two outputs together only after both engines succeed.
    let pending = root.join("snapshot.pending.json");
    std::fs::write(&pending, serde_json::to_vec(&snapshot).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(pending, root.join("snapshot.json")).map_err(|e| e.to_string())?;
    Ok(snapshot)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bundled_results_are_complete() {
        let snapshot = json!({
            "results": serde_json::from_str::<Value>(include_str!("../../resources/strategy/platform/results.json")).unwrap(),
            "adaptive": serde_json::from_str::<Value>(include_str!("../../resources/strategy/platform/adaptive_results.json")).unwrap()
        });
        assert!(validate(&snapshot).is_ok());
        assert!(validate(&json!({"results": snapshot["results"]})).is_err());
    }
}

pub(super) fn prepare_engine(root: &Path) -> Result<(), String> {
    std::fs::create_dir_all(root.join("platform")).map_err(|e| e.to_string())?;
    for (name, source) in [
        ("build_platform.py", include_str!("../../resources/strategy/build_platform.py")),
        ("strategy_lab.py", include_str!("../../resources/strategy/strategy_lab.py")),
        ("research_rules.py", include_str!("../../resources/strategy/research_rules.py")),
        ("prediction_review.py", include_str!("../../resources/strategy/prediction_review.py")),
        ("research_sources.json", include_str!("../../resources/strategy/research_sources.json")),
        ("refresh_research.py", include_str!("../../resources/strategy/refresh_research.py")),
        ("broad_universe.py", include_str!("../../resources/strategy/broad_universe.py")),
        ("fusion_model.py", include_str!("../../resources/strategy/fusion_model.py")),
        ("swing_review.py", include_str!("../../resources/strategy/swing_review.py")),
        ("index_grid.py", include_str!("../../resources/strategy/index_grid.py")),
        ("index_rule_strategies.py", include_str!("../../resources/strategy/index_rule_strategies.py")),
        ("index_rule_local.py", include_str!("../../resources/strategy/index_rule_local.py")),
    ] {
        std::fs::write(root.join(name), source).map_err(|e| e.to_string())?;
    }
    Ok(())
}
