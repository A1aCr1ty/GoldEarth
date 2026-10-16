use std::{path::PathBuf, process::Stdio, time::Duration};
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use tokio::process::Command;
use crate::{AppState, db::{models::Category, vault::{sanitize_dir_name, UNASSIGNED}}};

// Tauri resource paths may be canonical Windows verbatim paths. Node's entry
// point loader fails on these (EISDIR, lstat 'D:') even though Rust can read them.
fn node_path(path: &std::path::Path) -> PathBuf {
    #[cfg(windows)]
    {
        let value = path.to_string_lossy();
        if let Some(unc) = value.strip_prefix("\\\\?\\UNC\\") {
            return PathBuf::from(format!("\\\\{unc}"));
        }
        if let Some(disk) = value.strip_prefix("\\\\?\\") {
            if disk.as_bytes().get(1) == Some(&b':') { return PathBuf::from(disk); }
        }
    }
    path.to_path_buf()
}

fn example_name(kind: &str) -> Result<&'static str, String> {
    match kind {
        "architecture" => Ok("web-app.architecture.json"),
        "workflow" => Ok("agent-tool-call.workflow.json"),
        "sequence" => Ok("async-job-roundtrip.sequence.json"),
        "dataflow" => Ok("product-analytics.dataflow.json"),
        "lifecycle" => Ok("agent-run.lifecycle.json"),
        _ => Err("不支持的图表类型".into()),
    }
}

fn resource_root(app: &AppHandle) -> Result<PathBuf, String> {
    let bundled = node_path(&app.path().resource_dir().map_err(|e| e.to_string())?
        .join("resources/archify"));
    if bundled.join("bin/archify.mjs").is_file() { return Ok(bundled); }
    #[cfg(debug_assertions)]
    {
        let local = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/archify");
        if local.join("bin/archify.mjs").is_file() { return Ok(local); }
    }
    Err("Archify 资源未找到，请重新安装完整应用".into())
}

fn node_command() -> Command {
    // Pass arguments directly; source text and filenames never become shell code.
    let program = PathBuf::from(std::env::var_os("GOLDEARTH_NODE").unwrap_or_else(|| "node".into()));
    let mut cmd = Command::new(node_path(&program));
    cmd.kill_on_drop(true).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(0x08000000);
    cmd
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchifyTemplate { example: Value, schema: Value, common_schema: Value, runtime: Option<String> }

#[tauri::command]
pub async fn archify_template(app: AppHandle, diagram_type: String) -> Result<ArchifyTemplate, String> {
    let name = example_name(&diagram_type)?;
    let root = resource_root(&app)?;
    let read = |path: PathBuf| -> Result<Value, String> {
        serde_json::from_str(&std::fs::read_to_string(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
    };
    let mut example = read(root.join("examples").join(name))?;
    // The shipped examples keep their original domain wording; only Viewer UI is localized.
    if let Some(meta) = example.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("locale".into(), Value::String("zh-CN".into()));
        meta.remove("output");
        meta.remove("animation");
        meta.remove("visual_preset");
    }
    let runtime = match tokio::time::timeout(Duration::from_secs(5), node_command().arg("--version").output()).await {
        Ok(Ok(output)) if output.status.success() => {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_owned();
            let major = version.trim_start_matches('v').split('.').next().and_then(|v| v.parse::<u32>().ok()).unwrap_or(0);
            (major >= 18).then_some(version)
        },
        _ => None,
    };
    Ok(ArchifyTemplate { example, schema: read(root.join("schemas").join(format!("{diagram_type}.schema.json")))?,
        common_schema: read(root.join("schemas/common.schema.json"))?, runtime })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchifyResult { ok: bool, html: Option<String>, receipt: Value, failure_kind: Option<&'static str> }

/// Keep large schemas/Mermaid out of Windows command lines (including npm .cmd shims).
#[tauri::command]
pub fn prepare_archify_generation(app: AppHandle, context: String, prompt: String, diagram_type: Option<String>) -> Result<String, String> {
    if context.len() + prompt.len() > 2_000_000 { return Err("图表生成上下文过大".into()); }
    let kind = diagram_type.as_deref().unwrap_or("architecture");
    example_name(kind)?;
    let root = resource_root(&app)?;
    let directory = node_path(&app.path().app_cache_dir().map_err(|e| e.to_string())?.join("archify-prompts").join(uuid::Uuid::new_v4().to_string()));
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let file = directory.join("task.txt");
    let candidate = directory.join("candidate.json");
    let program = node_path(&PathBuf::from(std::env::var_os("GOLDEARTH_NODE").unwrap_or_else(|| "node".into())));
    let quote = |path: &std::path::Path| format!("'{}'", path.display().to_string().replace('\'', "''"));
    let command = format!("& {} {} validate {} {} --quality showcase --json", quote(&program), quote(&root.join("bin/archify.mjs")), kind, quote(&candidate));
    let instructions = format!("\n\n本轮临时校验流程：\n1. 只允许在临时目录 {} 中写候选 JSON，不修改用户笔记、应用代码或其他文件。\n2. 将候选图表写入 UTF-8 文件 {}。\n3. 执行以下 PowerShell 命令，读取真实诊断：\n{}\n4. 若失败，每轮只针对诊断指定的 subject 修正一个布局字段并重新校验；保留所有关系、数值和标签，不能降低 showcase 标准。最多修正 3 轮；若连续 2 轮错误数未创新低则停止。\n5. 最终回复仅输出临时文件中的完整 JSON。即使校验未通过也返回最佳候选，应用会显示真实诊断；不得声称校验通过。", directory.display(), candidate.display(), command);
    std::fs::write(&file, format!("{context}\n\n用户要求：\n{prompt}{instructions}")).map_err(|e| e.to_string())?;
    Ok(format!("请先用文件读取工具完整读取 UTF-8 图表任务文件：{}\n按文件中的 Schema、用户要求和临时校验流程生成 Archify JSON。只允许在任务指定的临时目录写候选文件；最终回复只输出完整 JSON。", file.display()))
}

// RAII cleanup also runs on errors/timeouts, so transient sources do not accumulate.
struct WorkDir(PathBuf);
impl Drop for WorkDir { fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); } }

#[tauri::command]
pub async fn render_archify(app: AppHandle, diagram_type: String, source: String) -> Result<ArchifyResult, String> {
    example_name(&diagram_type)?;
    if source.len() > 1_000_000 { return Err("图表 JSON 不能超过 1 MB".into()); }
    let parsed: Value = serde_json::from_str(&source).map_err(|e| format!("JSON 格式错误：{e}"))?;
    if parsed.get("diagram_type").and_then(Value::as_str) != Some(&diagram_type) {
        return Err("JSON 的 diagram_type 与当前类型不一致".into());
    }
    let root = resource_root(&app)?;
    let directory = node_path(&app.path().app_cache_dir().map_err(|e| e.to_string())?
        .join("archify").join(uuid::Uuid::new_v4().to_string()));
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let work = WorkDir(directory);
    let input = work.0.join("source.json");
    let output = work.0.join("diagram.html");
    std::fs::write(&input, source).map_err(|e| e.to_string())?;
    let result = tokio::time::timeout(Duration::from_secs(60), node_command()
        .arg(root.join("bin/archify.mjs")).arg("deliver").arg(&diagram_type)
        .arg(&input).arg(&output).args(["--quality", "showcase", "--json"])
        .current_dir(&work.0).output()).await
        .map_err(|_| "Archify 渲染超时，请简化图表后重试".to_string())?
        .map_err(|e| format!("无法启动 Node.js，请安装 Node.js 18+ 或设置 GOLDEARTH_NODE：{e}"))?;
    let parsed_receipt = serde_json::from_slice::<Value>(&result.stdout).ok().filter(Value::is_object);
    let runtime_failure = parsed_receipt.is_none();
    let receipt = parsed_receipt.unwrap_or_else(|| serde_json::json!({
        "ok": false, "error": format!("Archify 进程执行失败（退出码 {:?}）：\n{}\n{}", result.status.code(),
            String::from_utf8_lossy(&result.stderr).chars().take(12000).collect::<String>(),
            String::from_utf8_lossy(&result.stdout).chars().take(4000).collect::<String>())
    }));
    let ok = result.status.success() && receipt.get("ok").and_then(Value::as_bool) == Some(true);
    let html = if ok { Some(std::fs::read_to_string(&output).map_err(|e| e.to_string())?) } else { None };
    Ok(ArchifyResult { ok, html, receipt, failure_kind: if ok { None } else if runtime_failure { Some("runtime") } else { Some("diagram") } })
}

#[tauri::command]
pub async fn export_archify(app: AppHandle, content: String, format: String) -> Result<Option<String>, String> {
    if !["html", "json"].contains(&format.as_str()) || content.len() > 20_000_000 {
        return Err("不支持的导出格式或文件过大".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let selected = app.dialog().file().set_title("导出 Archify 图表")
            .add_filter(format.to_uppercase(), &[format.as_str()])
            .set_file_name(format!("diagram.{format}")).blocking_save_file();
        let Some(selected) = selected else { return Ok(None); };
        let path = selected.into_path().map_err(|e| e.to_string())?;
        std::fs::write(&path, content).map_err(|e| e.to_string())?;
        Ok(Some(path.to_string_lossy().into_owned()))
    }).await.map_err(|e| e.to_string())?
}

fn category_name(categories: &[Category], id: Option<&str>) -> Result<String, String> {
    match id {
        None => Ok(UNASSIGNED.into()),
        Some(id) => categories.iter().find(|category| category.id == id).map(|category| category.name.clone())
            .ok_or_else(|| "所选分类已不存在，请重新选择".into()),
    }
}

fn category_export_dir(vault_root: &std::path::Path, name: &str) -> Result<PathBuf, String> {
    let root = std::fs::canonicalize(vault_root).map_err(|e| e.to_string())?;
    let dir = root.join(sanitize_dir_name(name));
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let resolved = std::fs::canonicalize(&dir).map_err(|e| e.to_string())?;
    if !resolved.starts_with(&root) || resolved == root { return Err("分类文件夹不在当前笔记仓库内".into()); }
    Ok(resolved)
}

fn write_category_exports(dir: &std::path::Path, stem: &str, files: &[(&str, &str)]) -> Result<Vec<String>, String> {
    use std::io::Write;
    let mut created = Vec::new();
    for (extension, content) in files {
        let path = dir.join(format!("{stem}.{extension}"));
        let write = (|| -> std::io::Result<()> {
            let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(&path)?;
            created.push(path.clone());
            file.write_all(content.as_bytes())?;
            file.sync_all()
        })();
        if let Err(error) = write {
            // Roll back only the files this invocation exclusively created.
            for created_path in &created { let _ = std::fs::remove_file(created_path); }
            return Err(format!("导出失败：{error}"));
        }
    }
    Ok(created.iter().map(|path| node_path(path).to_string_lossy().into_owned()).collect())
}

#[derive(Serialize)]
pub struct ArchifyCategoryExport { directory: String, files: Vec<String> }

#[tauri::command]
pub async fn export_archify_to_category(app: AppHandle, state: tauri::State<'_, AppState>,
    category_id: Option<String>, source: String, format: String) -> Result<ArchifyCategoryExport, String> {
    if !["html", "json", "both"].contains(&format.as_str()) { return Err("不支持的导出格式".into()); }
    if source.len() > 1_000_000 { return Err("图表 JSON 不能超过 1 MB".into()); }
    let diagram: Value = serde_json::from_str(&source).map_err(|e| format!("JSON 格式错误：{e}"))?;
    let kind = diagram["diagram_type"].as_str().ok_or("缺少 diagram_type")?;
    example_name(kind)?;
    let storage = state.storage.clone();
    category_name(&storage.list_categories(), category_id.as_deref())?;
    let html = if format != "json" {
        let rendered = render_archify(app, kind.into(), source.clone()).await?;
        if !rendered.ok { return Err(format!("图表未通过校验，未写入分类文件夹：{}", rendered.receipt)); }
        Some(rendered.html.ok_or("图表 HTML 未生成")?)
    } else { None };
    // Resolve again after rendering so deleted/renamed categories never silently fall back.
    let name = category_name(&storage.list_categories(), category_id.as_deref())?;
    let dir = category_export_dir(storage.vault_root(), &name)?;
    let title = sanitize_dir_name(diagram["meta"]["title"].as_str().unwrap_or("图表"));
    let stem = format!("Archify-{}-{}-{}", title, chrono::Local::now().format("%Y%m%d-%H%M%S"), &uuid::Uuid::new_v4().to_string()[..8]);
    let mut files = Vec::new();
    if let Some(html) = html.as_deref() { files.push(("html", html)); }
    if format != "html" { files.push(("json", source.as_str())); }
    let exported = write_category_exports(&dir, &stem, &files)?;
    Ok(ArchifyCategoryExport { directory: node_path(&dir).to_string_lossy().into_owned(), files: exported })
}

#[tauri::command]
pub fn open_archify_category_folder(state: tauri::State<'_, AppState>, category_id: Option<String>) -> Result<(), String> {
    let name = category_name(&state.storage.list_categories(), category_id.as_deref())?;
    let directory = node_path(&category_export_dir(state.storage.vault_root(), &name)?);
    #[cfg(windows)]
    let mut command = std::process::Command::new("explorer.exe");
    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("open");
    #[cfg(all(not(windows), not(target_os = "macos")))]
    let mut command = std::process::Command::new("xdg-open");
    command.arg(directory).spawn().map(|_| ()).map_err(|e| format!("无法打开分类文件夹：{e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_known_types_can_resolve_resource_paths() {
        for kind in ["architecture", "workflow", "sequence", "dataflow", "lifecycle"] { assert!(example_name(kind).is_ok()); }
        for kind in ["../architecture", "", "workflow/../../bin"] { assert!(example_name(kind).is_err()); }
    }

    #[test]
    fn category_export_writes_a_pair_and_never_overwrites_existing_files() {
        let cache = std::env::temp_dir().join(format!("goldearth-category-export-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&cache).unwrap();
        let work = WorkDir(cache);
        let dir = category_export_dir(&work.0, "研究/图表").unwrap();
        assert!(dir.starts_with(std::fs::canonicalize(&work.0).unwrap()));
        let files = write_category_exports(&dir, "Archify-测试", &[("html", "<html>图表</html>"), ("json", "{\"test\":true}")]).unwrap();
        assert_eq!(files.len(), 2);
        assert_eq!(std::fs::read_to_string(&files[0]).unwrap(), "<html>图表</html>");
        assert!(write_category_exports(&dir, "Archify-测试", &[("html", "replace")]).is_err());
        assert_eq!(std::fs::read_to_string(&files[0]).unwrap(), "<html>图表</html>");
        // A second-file collision must roll back the new HTML and preserve the old JSON.
        std::fs::write(dir.join("Archify-conflict.json"), "original").unwrap();
        assert!(write_category_exports(&dir, "Archify-conflict", &[("html", "new"), ("json", "replacement")]).is_err());
        assert!(!dir.join("Archify-conflict.html").exists());
        assert_eq!(std::fs::read_to_string(dir.join("Archify-conflict.json")).unwrap(), "original");
    }

    #[test]
    fn missing_category_is_rejected_instead_of_exporting_to_unassigned() {
        assert_eq!(category_name(&[], None).unwrap(), UNASSIGNED);
        assert!(category_name(&[], Some("deleted-category")).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn windows_node_paths_preserve_disk_and_unc_meaning() {
        for (input, expected) in [
            (r"\\?\D:\GoldEarth\resources\图表.json", r"D:\GoldEarth\resources\图表.json"),
            (r"\\?\UNC\server\share\图表.json", r"\\server\share\图表.json"),
            (r"C:\folder with spaces\node.exe", r"C:\folder with spaces\node.exe"),
            ("node", "node"),
        ] { assert_eq!(node_path(std::path::Path::new(input)), PathBuf::from(expected)); }
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn canonicalized_tauri_style_resource_path_delivers_through_real_node() {
        let root = std::fs::canonicalize(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/archify")).unwrap();
        assert!(root.to_string_lossy().starts_with(r"\\?\"));
        let cache = std::env::temp_dir().join(format!("goldearth-archify-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&cache).unwrap();
        let work = WorkDir(cache);
        let output = node_path(&work.0.join("diagram.html"));
        let result = node_command().arg(node_path(&root.join("bin/archify.mjs")))
            .args(["deliver", "sequence"]).arg(node_path(&root.join("examples/async-job-roundtrip.sequence.json")))
            .arg(&output).args(["--quality", "showcase", "--json"])
            .current_dir(node_path(&work.0)).output().await.unwrap();
        assert!(result.status.success(), "{} {}", String::from_utf8_lossy(&result.stdout), String::from_utf8_lossy(&result.stderr));
        let receipt: Value = serde_json::from_slice(&result.stdout).unwrap();
        assert_eq!(receipt["validation"]["checksPassed"], 9);
        assert!(output.is_file());
    }
}
