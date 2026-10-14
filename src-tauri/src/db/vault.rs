//! 笔记仓库：笔记以 Markdown 文件形式存放在 vault 目录下，
//! App 与外部 Agent（codex）读写同一批文件。
//!
//! 目录结构：
//! ```text
//! vault/
//!   categories.json      分类元数据
//!   日常/2026-10-13-周会-a1b2c3d4.md
//!   未分类/随手记-e5f6a7b8.md
//! ```
//!
//! 单个笔记使用 Typora 兼容的 YAML frontmatter，值一律用 JSON 字面量编码，
//! 便于安全解析，也方便 LLM 直接按行编辑。
//!
//! ```markdown
//! ---
//! id: 550e8400-e29b-41d4-a716-446655440000
//! categoryId: 7c9e6679-7425-40de-944b-e07fc1f90ae7
//! title: "周会记录"
//! tags: ["会议"]
//! createdAt: "2026-10-13T09:00:00+00:00"
//! updatedAt: "2026-10-13T09:30:00+00:00"
//! ---
//!
//! 正文……
//! ```

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use super::models::{Category, Note, NoteFormat};

pub const VAULT_DIR: &str = "vault";
const CATEGORIES_FILE: &str = "categories.json";
pub const UNASSIGNED: &str = "未分类";
const FRONTMATTER_FENCE: &str = "---";

pub struct Vault {
    root: PathBuf,
}

impl Vault {
    pub fn new(app_data_root: &Path) -> Self {
        Self { root: app_data_root.join(VAULT_DIR) }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn ensure(&self) -> std::io::Result<()> {
        fs::create_dir_all(&self.root)?;
        fs::create_dir_all(self.root.join(UNASSIGNED))?;
        let cats = self.root.join(CATEGORIES_FILE);
        if !cats.exists() {
            fs::write(&cats, "[]")?;
        }
        Ok(())
    }

    // ---------- 分类 ----------

    pub fn categories_path(&self) -> PathBuf {
        self.root.join(CATEGORIES_FILE)
    }

    pub fn list_categories(&self) -> Vec<Category> {
        read_json::<Vec<Category>>(&self.categories_path()).unwrap_or_default()
    }

    pub fn save_categories(&self, items: &[Category]) -> std::io::Result<()> {
        self.ensure()?;
        write_json(&self.categories_path(), items)
    }

    /// 分类对应的子目录名。不存在则创建。
    pub fn category_dir(&self, name: &str) -> std::io::Result<PathBuf> {
        let dir = self.root.join(sanitize_dir_name(name));
        fs::create_dir_all(&dir)?;
        Ok(dir)
    }

    // ---------- 笔记 ----------

    pub fn list_notes(&self, category_id: Option<&str>) -> Vec<Note> {
        let mut notes: Vec<Note> = Vec::new();
        let Ok(entries) = fs::read_dir(&self.root) else {
            return notes;
        };
        for entry in entries.flatten() {
            if !entry.path().is_dir() {
                continue;
            }
            let Ok(files) = fs::read_dir(entry.path()) else {
                continue;
            };
            for f in files.flatten() {
                let path = f.path();
                if path.extension().and_then(|e| e.to_str()) != Some("md") {
                    continue;
                }
                if let Some(n) = read_note_file(&path) {
                    notes.push(n);
                }
            }
        }
        notes.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        notes
            .into_iter()
            .filter(|n| category_id.is_none_or(|cid| n.category_id.as_deref() == Some(cid)))
            .collect()
    }

    pub fn find(&self, id: &str) -> Option<Note> {
        self.list_notes(None).into_iter().find(|n| n.id == id)
    }

    /// 定位笔记对应的磁盘路径
    pub fn path_of(&self, id: &str) -> Option<PathBuf> {
        let entries = fs::read_dir(&self.root).ok()?;
        for entry in entries.flatten() {
            let dir = entry.path();
            if !dir.is_dir() {
                continue;
            }
            let Ok(files) = fs::read_dir(&dir) else { continue };
            for f in files.flatten() {
                let p = f.path();
                if p.extension().and_then(|e| e.to_str()) != Some("md") {
                    continue;
                }
                if let Some(n) = read_note_file(&p) {
                    if n.id == id {
                        return Some(p);
                    }
                }
            }
        }
        None
    }

    pub fn write(&self, note: &Note, dir_name: &str) -> std::io::Result<PathBuf> {
        let dir = self.category_dir(dir_name)?;
        let path = dir.join(note_file_name(note));
        write_atomic(&path, render_note(note).as_bytes())?;
        Ok(path)
    }

    pub fn delete(&self, id: &str) -> std::io::Result<()> {
        if let Some(p) = self.path_of(id) {
            fs::remove_file(p)?;
        }
        Ok(())
    }
}

// ---------- 单个笔记文件 ----------

fn read_note_file(path: &Path) -> Option<Note> {
    let raw = fs::read_to_string(path).ok()?;
    let (front, body) = split_front_matter(&raw);
    let meta = parse_front_matter(front);
    let id = meta.get("id")?.clone();
    let title = meta.get("title").map(|v| front_str(v)).unwrap_or_default();
    let tags = meta
        .get("tags")
        .and_then(|v| serde_json::from_str::<Vec<String>>(v).ok())
        .unwrap_or_default();
    let created_at = meta.get("createdAt").map(|v| front_str(v)).unwrap_or_default();
    let updated_at = meta
        .get("updatedAt")
        .map(|v| front_str(v))
        .unwrap_or_else(|| created_at.clone());
    let category_id = meta.get("categoryId").filter(|s| !s.is_empty()).cloned();

    let mtime = modified_ms(path).unwrap_or(0);
    let stamp = SystemTime::UNIX_EPOCH + std::time::Duration::from_millis(mtime as u64);

    Some(Note {
        id,
        category_id,
        title,
        format: NoteFormat::Markdown,
        content: body,
        tags,
        created_at,
        updated_at,
        modified: stamp_iso(stamp),
    })
}

fn split_front_matter(raw: &str) -> (Option<&str>, String) {
    let rest = raw
        .strip_prefix(FRONTMATTER_FENCE)
        .and_then(|s| s.strip_prefix('\r').or_else(|| s.strip_prefix('\n')));
    let Some(rest) = rest else {
        return (None, raw.to_string());
    };
    match rest.find(&format!("\n{FRONTMATTER_FENCE}")) {
        Some(end) => {
            let front = &rest[..end];
            let after = &rest[end + 1 + FRONTMATTER_FENCE.len()..];
            let body = after.strip_prefix('\r').or_else(|| after.strip_prefix('\n')).unwrap_or(after);
            (Some(front), body.to_string())
        }
        None => (None, raw.to_string()),
    }
}

/// 解析 `key: value`，value 保持原始 JSON 字面量文本
fn parse_front_matter(front: Option<&str>) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    let Some(front) = front else { return map };
    for line in front.lines() {
        let line = line.trim_end_matches('\r');
        if line.trim().is_empty() {
            continue;
        }
        let Some((k, v)) = line.split_once(':') else { continue };
        map.insert(k.trim().to_string(), v.trim().to_string());
    }
    map
}

fn json_str(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_else(|_| "\"\"".into())
}

/// 读回 JSON 字面量文本：写的时候 title / createdAt / updatedAt 是用
/// `json_str` 编码的，所以读的时候要把引号和转义解掉，否则标题会带着
/// 引号显示、时间戳解析失败，保存时还会再套一层引号。
/// 手写或旧格式的裸值解析不了，就按原文用。
fn front_str(v: &str) -> String {
    serde_json::from_str::<String>(v).unwrap_or_else(|_| v.to_string())
}

fn render_note(note: &Note) -> String {
    let tags = serde_json::to_string(&note.tags).unwrap_or_else(|_| "[]".into());
    format!(
        "{FRONTMATTER_FENCE}\nid: {}\ncategoryId: {}\ntitle: {}\ntags: {}\ncreatedAt: {}\nupdatedAt: {}\n{FRONTMATTER_FENCE}\n\n{}",
        note.id,
        note.category_id.clone().unwrap_or_default(),
        json_str(&note.title),
        tags,
        json_str(&note.created_at),
        json_str(&note.updated_at),
        note.content
    )
}

/// `<标题slug>-<id前8位>.md`，保证同名不互相覆盖且文件名可读
fn note_file_name(note: &Note) -> String {
    let slug = sanitize_file_stem(&note.title);
    let short: String = note.id.chars().take(8).collect();
    if slug.is_empty() {
        format!("{short}.md")
    } else {
        format!("{slug}-{short}.md")
    }
}

fn sanitize_file_stem(title: &str) -> String {
    let cleaned: String = title
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            c if (c as u32) < 0x20 => '-',
            c => c,
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').to_string();
    trimmed.chars().take(60).collect()
}

pub fn sanitize_dir_name(name: &str) -> String {
    let s = sanitize_file_stem(name);
    if s.is_empty() { UNASSIGNED.to_string() } else { s }
}

// ---------- 工具 ----------

fn modified_ms(path: &Path) -> Option<u128> {
    fs::metadata(path)
        .ok()?
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|d| d.as_millis())
}

fn stamp_iso(t: SystemTime) -> String {
    let secs = t.duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    chrono::DateTime::from_timestamp(secs as i64, 0)
        .map(|dt| dt.to_rfc3339())
        .unwrap_or_default()
}

/// 先写临时文件再改名，避免读到写了一半的内容
fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let tmp = path.with_extension("md.tmp");
    fs::write(&tmp, bytes)?;
    match fs::rename(&tmp, path) {
        Ok(()) => Ok(()),
        Err(e) => {
            let _ = fs::remove_file(&tmp);
            Err(e)
        }
    }
}

pub(crate) fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Option<T> {
    let raw = fs::read_to_string(path).ok()?;
    if raw.trim().is_empty() {
        return None;
    }
    serde_json::from_str(&raw).ok()
}

pub(crate) fn write_json<T: serde::Serialize + ?Sized>(path: &Path, value: &T) -> std::io::Result<()> {
    let body = serde_json::to_string_pretty(value).map_err(std::io::Error::other)?;
    write_atomic(path, body.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unquotes_json_front_matter_values() {
        assert_eq!(front_str(r#""2026.10.13 A股""#), "2026.10.13 A股");
        assert_eq!(front_str(r#""带 \"引号\" 的标题""#), r#"带 "引号" 的标题"#);
        // 手写或旧格式的裸值解析不了，按原文用，不能吞掉
        assert_eq!(front_str("周会记录"), "周会记录");
        assert_eq!(front_str(""), "");
    }

    #[test]
    fn reads_note_file_without_leaving_quotes_or_raw_timestamps() {
        let dir = std::env::temp_dir().join("goldearth-vault-test");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("t-1234abcd.md");
        fs::write(
            &path,
            concat!(
                "---\n",
                "id: 1234abcd\n",
                "categoryId: \n",
                "title: \"2026.10.13 A股\"\n",
                "tags: [\"复盘\",\"行情\"]\n",
                "createdAt: \"2026-01-01T00:00:00+00:00\"\n",
                "updatedAt: \"2026-01-02T00:00:00+00:00\"\n",
                "---\n",
                "\n",
                "正文\n"
            ),
        )
        .unwrap();

        let note = read_note_file(&path).expect("应能解析笔记");
        assert_eq!(note.title, "2026.10.13 A股", "标题不该带引号");
        assert_eq!(note.created_at, "2026-01-01T00:00:00+00:00");
        assert_eq!(note.updated_at, "2026-01-02T00:00:00+00:00");
        assert_eq!(note.tags, vec!["复盘".to_string(), "行情".to_string()]);
        assert_eq!(note.content.trim(), "正文");

        // 写回去再读一遍，标题不能被再套一层引号
        let rendered = render_note(&note);
        assert!(
            rendered.contains("title: \"2026.10.13 A股\""),
            "回写不应二次转义: {rendered}"
        );
        let _ = fs::remove_file(&path);
    }
}
