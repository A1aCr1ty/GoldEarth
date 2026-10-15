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
        Self {
            root: app_data_root.join(VAULT_DIR),
        }
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
        let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
        for (note, path) in self.scan_note_files() {
            if seen.insert(note.id.clone()) {
                notes.push(note);
            } else {
                // 同一 id 的旧副本：改名/换分类后没删干净，或写新文件时崩在中途。
                // 真机上就出现过两条一模一样的「机械臂和关节模组重要参数」——
                // 光在列表里藏起来没用，下次扫描还会冒出来，所以连文件一起清掉。
                // 删不掉（文件被外部程序占用）只记日志，不能让整个列表读取失败。
                if let Err(e) = fs::remove_file(&path) {
                    eprintln!("[vault] 清理重复笔记 {:?} 失败：{e}", path);
                }
            }
        }
        notes
            .into_iter()
            .filter(|n| category_id.is_none_or(|cid| n.category_id.as_deref() == Some(cid)))
            .collect()
    }

    /// 扫描 vault 下所有 `.md`，按 `updated_at` 倒序（相同再按文件修改时间）。
    /// 路径一起返回：清理重复副本时得知道该删哪个文件。
    fn scan_note_files(&self) -> Vec<(Note, PathBuf)> {
        let mut found: Vec<(Note, PathBuf)> = Vec::new();
        let Ok(entries) = fs::read_dir(&self.root) else {
            return found;
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
                // `.md.tmp` 的扩展名是 tmp，这里天然被排除，不会读到写了一半的内容
                if path.extension().and_then(|e| e.to_str()) != Some("md") {
                    continue;
                }
                if let Some(n) = read_note_file(&path) {
                    found.push((n, path));
                }
            }
        }
        found.sort_by(|a, b| {
            b.0.updated_at
                .cmp(&a.0.updated_at)
                .then_with(|| b.0.modified.cmp(&a.0.modified))
        });
        found
    }

    pub fn find(&self, id: &str) -> Option<Note> {
        self.scan_note_files()
            .into_iter()
            .find(|(n, _)| n.id == id)
            .map(|(n, _)| n)
    }

    /// 定位笔记对应的磁盘路径。同一 id 存在多份副本时取最新的那份，
    /// 不能像以前那样命中第一个就返回：清理旧副本时删的必须是旧的那份。
    pub fn path_of(&self, id: &str) -> Option<PathBuf> {
        self.scan_note_files()
            .into_iter()
            .find(|(n, _)| n.id == id)
            .map(|(_, p)| p)
    }

    pub fn write(&self, note: &Note, dir_name: &str) -> std::io::Result<PathBuf> {
        let dir = self.category_dir(dir_name)?;
        let path = dir.join(note_file_name(note));
        write_atomic(&path, render_note(note).as_bytes())?;
        Ok(path)
    }

    /// 写笔记，并顺手清掉同一 id 的旧文件。
    ///
    /// 旧路径必须在写之前取：写完之后磁盘上已经有两份同 id 的文件，
    /// `path_of` 只返回其中一份，分不出哪个是旧的。这正是笔记改名后
    /// 列表里出现两条一模一样条目的真凶（旧代码写完再查两次同一个 id，
    /// 比较恒为真，删除分支从未执行过）。
    ///
    /// 这里不再判断「标题或分类有没有变」：文件名由标题 + id 决定、目录由
    /// 分类决定，二者没变的话新旧路径本来就相同，删了等于删自己。
    pub fn write_replacing(&self, note: &Note, dir_name: &str) -> std::io::Result<PathBuf> {
        let old_path = self.path_of(&note.id);
        let new_path = self.write(note, dir_name)?;
        if let Some(old) = old_path {
            if old != new_path {
                if let Err(e) = fs::remove_file(&old) {
                    eprintln!("[vault] 清理旧笔记 {:?} 失败：{e}", old);
                }
            }
        }
        Ok(new_path)
    }

    /// 删除笔记。同一个 id 的所有副本都要删——只删一份的话，剩下的那份
    /// 下次扫描还会冒出来，用户看着就像「删了又回来」。
    pub fn delete(&self, id: &str) -> std::io::Result<()> {
        let mut first_err = None;
        for (_, path) in self
            .scan_note_files()
            .into_iter()
            .filter(|(n, _)| n.id == id)
        {
            if let Err(e) = fs::remove_file(&path) {
                if first_err.is_none() {
                    first_err = Some(e);
                }
            }
        }
        match first_err {
            Some(e) => Err(e),
            None => Ok(()),
        }
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
    let created_at = meta
        .get("createdAt")
        .map(|v| front_str(v))
        .unwrap_or_default();
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
            let body = after
                .strip_prefix('\r')
                .or_else(|| after.strip_prefix('\n'))
                .unwrap_or(after);
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
        let Some((k, v)) = line.split_once(':') else {
            continue;
        };
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
    if s.is_empty() {
        UNASSIGNED.to_string()
    } else {
        s
    }
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
    let secs = t
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
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

pub(crate) fn write_json<T: serde::Serialize + ?Sized>(
    path: &Path,
    value: &T,
) -> std::io::Result<()> {
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

    // ---------- 重复副本：改名 / 异常关闭后的残留文件 ----------

    /// 真机上那对重复文件的 id（两条一模一样，只差文件名和 updatedAt）
    const DUP_ID: &str = "6b32af44-15fc-41d8-a4e1-7c1b939fe635";
    const EARLIER: &str = "2026-10-15T03:22:52+00:00";
    const LATER: &str = "2026-10-15T03:32:11+00:00";

    /// 每个测试一个独立目录。`cargo test` 默认多线程并行，共用临时目录会互相踩，
    /// 再叠加上一轮遗留的文件，断言就成了薛定谔的失败。
    struct TempVault(PathBuf);

    impl TempVault {
        fn new(tag: &str) -> Self {
            let dir =
                std::env::temp_dir().join(format!("goldearth-vault-{tag}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).unwrap();
            let v = Vault::new(&dir);
            v.ensure().unwrap();
            Self(dir)
        }

        fn vault(&self) -> Vault {
            Vault::new(&self.0)
        }
    }

    impl Drop for TempVault {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn note(id: &str, title: &str, updated_at: &str, content: &str) -> Note {
        Note {
            id: id.to_string(),
            category_id: None,
            title: title.to_string(),
            format: NoteFormat::Markdown,
            content: content.to_string(),
            tags: Vec::new(),
            created_at: "2026-10-15T03:00:00+00:00".to_string(),
            updated_at: updated_at.to_string(),
            modified: String::new(),
        }
    }

    /// 未分类目录下的 `.md` 文件名，用来确认文件真的被删了，
    /// 而不是只在返回的列表里被藏起来。
    fn md_files(v: &Vault) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(v.root().join(UNASSIGNED))
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn changing_category_moves_the_file_and_persists_membership() {
        let tmp = TempVault::new("move-category");
        let v = tmp.vault();
        let mut n = note(DUP_ID, "分类移动", EARLIER, "正文不能丢失");
        let old_path = v.write(&n, UNASSIGNED).unwrap();

        n.category_id = Some("work".to_string());
        n.updated_at = LATER.to_string();
        let new_path = v.write_replacing(&n, "工作").unwrap();
        assert!(!old_path.exists(), "换分类后旧文件应被移除");
        assert_eq!(new_path.parent(), Some(v.root().join("工作").as_path()));
        assert_eq!(v.list_notes(None).len(), 1);
        let saved = v.find(DUP_ID).unwrap();
        assert_eq!(saved.category_id.as_deref(), Some("work"));
        // Markdown frontmatter 与正文之间保留一个空行。
        assert_eq!(saved.content.trim_start_matches('\n'), "正文不能丢失");
        assert_eq!(v.list_notes(Some("work")).len(), 1);

        n.category_id = None;
        let unassigned = v.write_replacing(&n, UNASSIGNED).unwrap();
        assert!(!new_path.exists());
        assert!(unassigned.exists());
        assert_eq!(v.find(DUP_ID).unwrap().category_id, None);
        assert!(v.list_notes(Some("work")).is_empty());
        assert_eq!(v.list_notes(None).len(), 1);
    }

    #[test]
    fn renaming_a_note_leaves_exactly_one_file() {
        let tmp = TempVault::new("rename");
        let v = tmp.vault();
        v.write(&note(DUP_ID, "未命名笔记", EARLIER, ""), UNASSIGNED)
            .unwrap();

        // 旧实现：写完新文件后再拿同一个 id 查两次路径，两次结果必然相同，
        // 删除分支一次都没执行过 —— 磁盘上就此多出一份同 id 的空壳。
        v.write_replacing(
            &note(DUP_ID, "机械臂和关节模组重要参数", LATER, "正文"),
            UNASSIGNED,
        )
        .unwrap();

        // 必须先查磁盘：等 list_notes 顺手清完残骸再看文件数，这个断言就永远成立，
        // 测不到 write_replacing 自己还清没清。
        assert_eq!(
            md_files(&v),
            vec!["机械臂和关节模组重要参数-6b32af44.md".to_string()],
            "旧文件要在这一步就从磁盘上消失，光少返回一条不算修好"
        );
        let notes = v.list_notes(None);
        assert_eq!(notes.len(), 1, "改名后只能剩一条笔记");
        assert_eq!(notes[0].title, "机械臂和关节模组重要参数");
    }

    #[test]
    fn a_leftover_duplicate_is_dropped_and_removed_from_disk() {
        let tmp = TempVault::new("dup");
        let v = tmp.vault();
        // 复刻真机现场：同一 id 落了两个文件，正文在新的那份，空壳留在原地
        v.write(&note(DUP_ID, "未命名笔记", EARLIER, ""), UNASSIGNED)
            .unwrap();
        v.write(
            &note(DUP_ID, "机械臂和关节模组重要参数", LATER, "正文"),
            UNASSIGNED,
        )
        .unwrap();
        assert_eq!(md_files(&v).len(), 2, "先确认真的造出了两份");

        let notes = v.list_notes(None);
        assert_eq!(notes.len(), 1, "列表不该出现两条一模一样的笔记");
        assert_eq!(
            notes[0].title, "机械臂和关节模组重要参数",
            "要保留 updatedAt 更新的那份，正文在那儿"
        );
        assert_eq!(
            md_files(&v),
            vec!["机械臂和关节模组重要参数-6b32af44.md".to_string()],
            "残骸文件顺手清掉，否则下次扫描还会再撞见"
        );
    }

    #[test]
    fn path_of_prefers_the_newest_copy() {
        let tmp = TempVault::new("path-of");
        let v = tmp.vault();
        v.write(&note(DUP_ID, "未命名笔记", EARLIER, ""), UNASSIGNED)
            .unwrap();
        v.write(&note(DUP_ID, "新标题", LATER, "正文"), UNASSIGNED)
            .unwrap();

        let p = v.path_of(DUP_ID).expect("两份都在，应该能找到");
        assert!(
            p.to_string_lossy().contains("新标题"),
            "要指向最新的那份，清理时才不会把正文删掉，实际 {p:?}"
        );
    }

    #[test]
    fn deleting_a_note_removes_every_copy() {
        let tmp = TempVault::new("delete");
        let v = tmp.vault();
        v.write(&note(DUP_ID, "未命名笔记", EARLIER, ""), UNASSIGNED)
            .unwrap();
        v.write(&note(DUP_ID, "新标题", LATER, "正文"), UNASSIGNED)
            .unwrap();

        v.delete(DUP_ID).unwrap();
        assert!(v.list_notes(None).is_empty());
        assert!(
            md_files(&v).is_empty(),
            "只删一份的话，另一份下次扫描又会冒出来"
        );
    }
}
