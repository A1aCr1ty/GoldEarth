use std::{fs, io::Read, path::{Path, PathBuf}, time::UNIX_EPOCH};
use serde::Serialize;
use super::{models::Category, vault::{sanitize_dir_name, UNASSIGNED}};

const MAX_HTML_BYTES: u64 = 20_000_000;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryHtmlFile {
    pub category_id: Option<String>,
    pub name: String,
    pub size: u64,
    pub updated_at: String,
}

fn is_html(path: &Path) -> bool {
    path.extension().and_then(|s| s.to_str()).is_some_and(|s| s.eq_ignore_ascii_case("html") || s.eq_ignore_ascii_case("htm"))
}

fn directory(root: &Path, name: &str) -> Result<PathBuf, String> {
    let root = fs::canonicalize(root).map_err(|e| e.to_string())?;
    let path = root.join(sanitize_dir_name(name));
    if !path.exists() { return Ok(path); }
    let path = fs::canonicalize(path).map_err(|e| e.to_string())?;
    if !path.starts_with(&root) || path == root { return Err("分类目录不在笔记仓库内".into()); }
    Ok(path)
}

pub fn list_html(root: &Path, categories: &[Category]) -> Result<Vec<CategoryHtmlFile>, String> {
    let mut files = Vec::new();
    let folders = categories.iter().map(|c| (Some(c.id.clone()), c.name.as_str()))
        .chain(std::iter::once((None, UNASSIGNED)));
    for (id, name) in folders {
        let dir = directory(root, name)?;
        if !dir.exists() { continue; }
        for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            if !entry.file_type().map_err(|e| e.to_string())?.is_file() || !is_html(&entry.path()) { continue; }
            let metadata = entry.metadata().map_err(|e| e.to_string())?;
            files.push(CategoryHtmlFile { category_id: id.clone(), name: entry.file_name().to_string_lossy().into_owned(),
                size: metadata.len(), updated_at: chrono::DateTime::<chrono::Utc>::from(metadata.modified().unwrap_or(UNIX_EPOCH)).to_rfc3339() });
        }
    }
    files.sort_by(|a, b| b.updated_at.cmp(&a.updated_at).then_with(|| a.name.cmp(&b.name)));
    Ok(files)
}

pub fn read_html(root: &Path, categories: &[Category], id: Option<&str>, name: &str) -> Result<String, String> {
    if name.is_empty() || name.contains(['/', '\\', ':']) || !is_html(Path::new(name)) {
        return Err("只能打开分类文件夹中的 HTML 文件".into());
    }
    let category_name = match id {
        Some(id) => categories.iter().find(|c| c.id == id).map(|c| c.name.as_str()).ok_or("分类已不存在")?,
        None => UNASSIGNED,
    };
    let dir = directory(root, category_name)?;
    let file = fs::canonicalize(dir.join(name)).map_err(|e| format!("无法打开 HTML 文件：{e}"))?;
    if !file.starts_with(&dir) { return Err("HTML 文件不在所选分类目录内".into()); }
    let mut source = String::new();
    fs::File::open(file).map_err(|e| e.to_string())?.take(MAX_HTML_BYTES + 1).read_to_string(&mut source).map_err(|e| e.to_string())?;
    if source.len() as u64 > MAX_HTML_BYTES { return Err("HTML 文件不能超过 20 MB".into()); }
    Ok(source)
}

/// HTML and its same-name JSON remain together when a category moves. Never overwrite files.
pub fn move_exports(from: &Path, to: &Path) -> std::io::Result<()> {
    if from == to || !from.is_dir() { return Ok(()); }
    fs::create_dir_all(to)?;
    let entries: Vec<_> = fs::read_dir(from)?.collect::<Result<_, _>>()?;
    for entry in &entries {
        let source = entry.path();
        if !source.is_file() || !is_html(&source) { continue; }
        let companion = source.with_extension("json");
        let mut target = to.join(entry.file_name());
        if target.exists() || (companion.exists() && target.with_extension("json").exists()) {
            target = to.join(format!("{}-{}.{}", source.file_stem().unwrap_or_default().to_string_lossy(), uuid::Uuid::new_v4(), source.extension().unwrap_or_default().to_string_lossy()));
        }
        fs::rename(&source, &target)?;
        if companion.is_file() { fs::rename(companion, target.with_extension("json"))?; }
    }
    for entry in entries {
        let source = entry.path();
        if !source.is_file() || !entry.file_name().to_string_lossy().starts_with("Archify-") || source.extension().and_then(|s| s.to_str()) != Some("json") { continue; }
        let mut target = to.join(entry.file_name());
        if target.exists() { target = to.join(format!("{}-{}.json", source.file_stem().unwrap_or_default().to_string_lossy(), uuid::Uuid::new_v4())); }
        fs::rename(source, target)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture(PathBuf);
    impl Drop for Fixture { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
    fn fixture() -> Fixture {
        let path = std::env::temp_dir().join(format!("goldearth-html-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(path.join(UNASSIGNED)).unwrap(); Fixture(path)
    }
    #[test]
    fn list_and_open_html_without_exposing_other_files() {
        let root = fixture(); let dir = root.0.join(UNASSIGNED);
        fs::write(dir.join("图表.HTML"), "<h1>图表</h1>").unwrap();
        fs::write(dir.join("note.md"), "笔记").unwrap(); fs::write(dir.join("图表.json"), "{}").unwrap();
        let files = list_html(&root.0, &[]).unwrap(); assert_eq!(files.len(), 1); assert_eq!(files[0].name, "图表.HTML");
        assert_eq!(read_html(&root.0, &[], None, "图表.HTML").unwrap(), "<h1>图表</h1>");
        for name in ["../secret.html", r"..\secret.html", "C:secret.html", "note.md"] { assert!(read_html(&root.0, &[], None, name).is_err()); }
        assert!(read_html(&root.0, &[], Some("deleted"), "图表.HTML").is_err());
    }
    #[test]
    fn html_and_source_follow_category_moves_without_overwriting() {
        let root = fixture(); let from = root.0.join("研究"); let to = root.0.join(UNASSIGNED); fs::create_dir_all(&from).unwrap();
        fs::write(from.join("Archify-test.html"), "new html").unwrap(); fs::write(from.join("Archify-test.json"), "new json").unwrap();
        fs::write(to.join("Archify-test.html"), "old html").unwrap(); fs::write(to.join("Archify-test.json"), "old json").unwrap();
        move_exports(&from, &to).unwrap();
        assert_eq!(fs::read_to_string(to.join("Archify-test.html")).unwrap(), "old html");
        let moved = fs::read_dir(&to).unwrap().flatten().find(|e| e.file_name().to_string_lossy().starts_with("Archify-test-") && is_html(&e.path())).unwrap().path();
        assert_eq!(fs::read_to_string(&moved).unwrap(), "new html"); assert_eq!(fs::read_to_string(moved.with_extension("json")).unwrap(), "new json");
        assert!(fs::read_dir(from).unwrap().next().is_none());
    }
}
