use std::{process::Stdio, time::Duration};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use tokio::process::Command;

static JOB: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn root(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("strategy"))
}

#[tauri::command]
pub fn value_research_status(app: AppHandle) -> Result<Value, String> {
    let root = root(&app)?;
    let read = |name: &str| -> Result<Value, String> {
        let path = root.join("value").join(name);
        if !path.exists() { return Ok(Value::Null); }
        serde_json::from_slice(&std::fs::read(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
    };
    let count = |path: std::path::PathBuf, ext: &str, prices: bool| -> usize {
        std::fs::read_dir(path).into_iter().flatten().filter_map(Result::ok)
            .filter(|e| {
                let p = e.path();
                let stem = p.file_stem().and_then(|s|s.to_str()).unwrap_or("");
                p.extension().and_then(|s|s.to_str()) == Some(ext) &&
                    (!prices || (stem.len()==6 && stem.bytes().all(|b|b.is_ascii_digit()) && stem!="000300" && stem!="399006"))
            }).count()
    };
    Ok(json!({"price_files":count(root.join("data"),"csv",true),
        "financial_files":count(root.join("value/financials"),"json",false),
        "collection":read("collection.json")?, "latest":read("latest.json")?,
        "evaluation":read("evaluation.json")?, "evaluation_progress":read("evaluation_progress.json")?,
        "sources":serde_json::from_str::<Value>(include_str!("../../resources/strategy/value_sources.json")).map_err(|e|e.to_string())?,
        "root":root.join("value").to_string_lossy(), "busy":JOB.try_lock().is_err()}))
}

#[tauri::command]
pub async fn value_research_run(app: AppHandle, action: String, limit: u32, horizon: u32, mode: String,
    capital: Option<f64>, monthly_fee: Option<f64>, max_drawdown: Option<f64>) -> Result<Value, String> {
    if !["collect", "financials", "train", "evaluate"].contains(&action.as_str()) || !(5..=6000).contains(&limit)
        || ![63,126,252].contains(&horizon) || !["technical","fused"].contains(&mode.as_str()) {
        return Err("长期研究参数无效".into());
    }
    let capital=capital.unwrap_or(100000.0);
    let monthly_fee=monthly_fee.unwrap_or(300.0);
    let max_drawdown=max_drawdown.unwrap_or(0.20);
    if !capital.is_finite() || capital<=0.0 || capital>1e9 || !monthly_fee.is_finite() || !(0.0..=1e6).contains(&monthly_fee)
        || !max_drawdown.is_finite() || max_drawdown<=0.0 || max_drawdown>1.0 {
        return Err("研究本金、费用或回撤参数无效".into());
    }
    let _guard = JOB.try_lock().map_err(|_|"长期研究任务正在运行".to_string())?;
    let _strategy_guard = super::strategy::REVIEW.try_lock().map_err(|_|"短期策略正在更新行情，请完成后重试".to_string())?;
    let root = root(&app)?;
    super::strategy::prepare_engine(&root)?;
    for (name, source) in [
        ("value_lab.py", include_str!("../../resources/strategy/value_lab.py")),
        ("value_evaluation.py", include_str!("../../resources/strategy/value_evaluation.py")),
        ("value_sources.json", include_str!("../../resources/strategy/value_sources.json")),
        ("value_requirements.txt", include_str!("../../resources/strategy/value_requirements.txt")),
    ] { std::fs::write(root.join(name), source).map_err(|e|e.to_string())?; }
    let python = std::env::var_os("GOLDEARTH_PYTHON").unwrap_or_else(||"python".into());
    let mut command = Command::new(python);
    if action=="evaluate" {
        command.arg("value_evaluation.py").arg("--horizon").arg(horizon.to_string())
            .arg("--capital").arg(capital.to_string()).arg("--monthly-fee").arg(monthly_fee.to_string())
            .arg("--max-drawdown").arg(max_drawdown.to_string());
    } else {
        command.arg("value_lab.py").arg(action).arg("--limit").arg(limit.to_string())
            .arg("--horizon").arg(horizon.to_string()).arg("--mode").arg(mode);
    }
    command.current_dir(&root)
        .env("PYTHONIOENCODING","utf-8").stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let output = tokio::time::timeout(Duration::from_secs(21600), command.output()).await
        .map_err(|_|"任务超过6小时已停止；已采集文件保留，可再次更新".to_string())?
        .map_err(|e|format!("无法启动Python：{e}；请配置GOLDEARTH_PYTHON并安装value_requirements.txt"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).chars().rev().take(2000).collect::<String>().chars().rev().collect());
    }
    // Read published files instead of relying on third-party helper stdout.
    let mut status = value_research_status(app)?;
    status["busy"] = Value::Bool(false);
    Ok(status)
}
