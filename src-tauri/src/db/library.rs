//! 知识库：把资料文件按「分类」收在一起，每个分类绑一个 agent，
//! agent 就在这个分类的目录里干活，所以它读到的就是这一类的资料。
//!
//! 目录结构（在 app data 根目录下，和 vault 平级）：
//! ```text
//! knowledge/
//!   library.json          分类元数据（含分类绑定的 agent）
//!   行业研究/2026-10-14 白酒渠道调研.pdf
//!   行业研究/茅台历年财报.xlsx
//!   随手存/xxx.md
//! ```
//!
//! 文件原样拷进来，不转格式，所以 xlsx / pdf / 图片都能收；
//! agent 能不能读懂取决于它自己的工具，但至少它能按文件名和目录了解到手上有哪些资料。

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use super::models::{LibraryCategory, LibraryFile};
use super::vault::{read_json, sanitize_dir_name, write_json};

pub const LIBRARY_DIR: &str = "knowledge";
/// 分类元数据放在知识库根目录：不在任何分类目录里，所以不会被当成用户资料列出来
const META_FILE: &str = "library.json";

/// 预览文本时最多读这么多字节，免得手滑收了个几百 MB 的日志把界面拖死
const TEXT_PREVIEW_LIMIT: u64 = 256 * 1024;

/// 按扩展名判断能不能当文本预览
const TEXT_EXTS: [&str; 20] = [
    "md", "markdown", "txt", "text", "json", "yaml", "yml", "toml", "csv", "tsv", "log", "ini",
    "rs", "ts", "tsx", "js", "jsx", "py", "html", "sql",
];

pub struct Library {
    root: PathBuf,
}

impl Library {
    pub fn new(app_data_root: &Path) -> Self {
        Self {
            root: app_data_root.join(LIBRARY_DIR),
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn ensure(&self) -> std::io::Result<()> {
        fs::create_dir_all(&self.root)?;
        let meta = self.meta_path();
        if !meta.exists() {
            fs::write(&meta, "[]")?;
        }
        Ok(())
    }

    fn meta_path(&self) -> PathBuf {
        self.root.join(META_FILE)
    }

    // ---------- 分类 ----------

    pub fn list_categories(&self) -> Vec<LibraryCategory> {
        read_json::<Vec<LibraryCategory>>(&self.meta_path()).unwrap_or_default()
    }

    fn save_categories(&self, items: &[LibraryCategory]) -> std::io::Result<()> {
        self.ensure()?;
        write_json(&self.meta_path(), items)
    }

    pub fn get_category(&self, id: &str) -> Option<LibraryCategory> {
        self.list_categories().into_iter().find(|c| c.id == id)
    }

    pub fn insert_category(&self, category: LibraryCategory) -> std::io::Result<LibraryCategory> {
        let mut items = self.list_categories();
        // 名字撞了就加后缀，免得两个分类落到同一个目录里
        let mut category = category;
        category.name = self.unique_name(&items, &category.name, None);
        fs::create_dir_all(self.category_dir(&category.name))?;
        items.push(category.clone());
        self.save_categories(&items)?;
        Ok(category)
    }

    pub fn update_category(
        &self,
        id: &str,
        name: Option<String>,
        agent_id: Option<String>,
        description: Option<String>,
    ) -> std::io::Result<LibraryCategory> {
        let mut items = self.list_categories();
        let mut current = items
            .iter()
            .find(|c| c.id == id)
            .cloned()
            .ok_or_else(|| std::io::Error::other(format!("没有这个分类：{id}")))?;
        let old_dir = self.category_dir(&current.name);

        if let Some(next_name) = name.map(|n| n.trim().to_string()).filter(|n| !n.is_empty()) {
            if next_name != current.name {
                let unique = self.unique_name(&items, &next_name, Some(id));
                let new_dir = self.category_dir(&unique);
                // 改名顺手把目录也搬过去，资料不会走丢
                if old_dir.is_dir() {
                    fs::rename(&old_dir, &new_dir)?;
                } else {
                    fs::create_dir_all(&new_dir)?;
                }
                current.name = unique;
            }
        }
        if let Some(v) = agent_id {
            current.agent_id = v.trim().to_string();
        }
        if let Some(v) = description {
            current.description = v.trim().to_string();
        }
        current.updated_at = super::now_iso();

        if let Some(slot) = items.iter_mut().find(|c| c.id == id) {
            *slot = current.clone();
        }
        self.save_categories(&items)?;
        Ok(current)
    }

    /// 删分类：连目录里的资料一起删。调用方负责先跟用户确认。
    pub fn delete_category(&self, id: &str) -> std::io::Result<()> {
        let items = self.list_categories();
        let target = items
            .iter()
            .find(|c| c.id == id)
            .ok_or_else(|| std::io::Error::other(format!("没有这个分类：{id}")))?;
        let dir = self.category_dir(&target.name);
        // 只删知识库目录底下的东西：resolve 之后仍要落在 root 里面
        if dir.is_dir() && dir.starts_with(&self.root) {
            fs::remove_dir_all(&dir)?;
        }
        let rest: Vec<LibraryCategory> = items.into_iter().filter(|c| c.id != id).collect();
        self.save_categories(&rest)
    }

    /// 分类目录（不建目录，只算路径）
    pub fn category_dir(&self, name: &str) -> PathBuf {
        self.root.join(dir_name_for(name))
    }

    /// 分类目录，存在才返回，给 agent 当工作目录用
    pub fn existing_category_dir(&self, id: &str) -> Option<PathBuf> {
        let dir = self.category_dir(&self.get_category(id)?.name);
        dir.is_dir().then_some(dir)
    }

    fn unique_name(&self, items: &[LibraryCategory], wanted: &str, skip_id: Option<&str>) -> String {
        let taken = |candidate: &str, skip: Option<&str>| {
            items
                .iter()
                .any(|c| c.name == candidate && skip != Some(c.id.as_str()))
        };
        if !taken(wanted, skip_id) {
            return wanted.to_string();
        }
        for n in 2..1000 {
            let candidate = format!("{wanted} ({n})");
            if !taken(&candidate, skip_id) {
                return candidate;
            }
        }
        format!("{wanted} ({})", super::now_iso())
    }

    // ---------- 文件 ----------

    pub fn list_files(&self, id: &str) -> Vec<LibraryFile> {
        let Some(category) = self.get_category(id) else {
            return Vec::new();
        };
        let dir = self.category_dir(&category.name);
        let Ok(entries) = fs::read_dir(&dir) else {
            return Vec::new();
        };
        let mut out: Vec<LibraryFile> = entries
            .flatten()
            .filter(|e| e.path().is_file())
            .map(|e| describe_file(&e.path()))
            .collect();
        // 最近收进来的排前面
        out.sort_by(|a, b| b.modified.cmp(&a.modified).then_with(|| a.name.cmp(&b.name)));
        out
    }

    pub fn file_count(&self, id: &str) -> usize {
        self.list_files(id).len()
    }

    /// 把外部文件拷进分类目录；重名就加 (2)、(3) 后缀
    pub fn import_files(&self, id: &str, sources: &[String]) -> std::io::Result<Vec<LibraryFile>> {
        let category = self
            .get_category(id)
            .ok_or_else(|| std::io::Error::other(format!("没有这个分类：{id}")))?;
        let dir = self.category_dir(&category.name);
        fs::create_dir_all(&dir)?;
        for source in sources {
            let from = PathBuf::from(source);
            if !from.is_file() {
                continue;
            }
            let Some(stem) = from.file_stem().map(|s| s.to_string_lossy().to_string()) else {
                continue;
            };
            let ext = from
                .extension()
                .map(|e| e.to_string_lossy().to_string())
                .unwrap_or_default();
            let mut target = dir.join(from.file_name().unwrap_or_default());
            for n in 2..1000 {
                if !target.exists() {
                    break;
                }
                let candidate = if ext.is_empty() {
                    format!("{stem} ({n})")
                } else {
                    format!("{stem} ({n}).{ext}")
                };
                target = dir.join(candidate);
            }
            fs::copy(&from, &target)?;
        }
        Ok(self.list_files(id))
    }

    /// 删一个文件。name 必须是纯文件名，不接受任何路径成分。
    pub fn delete_file(&self, id: &str, name: &str) -> std::io::Result<()> {
        let path = self.resolve_file(id, name)?;
        fs::remove_file(path)
    }

    /// 文本类文件的内容，给界面做预览；二进制返回 None。
    pub fn read_text(&self, id: &str, name: &str) -> std::io::Result<Option<String>> {
        let path = self.resolve_file(id, name)?;
        let ext = path
            .extension()
            .map(|e| e.to_string_lossy().to_ascii_lowercase())
            .unwrap_or_default();
        if !TEXT_EXTS.contains(&ext.as_str()) {
            return Ok(None);
        }
        let size = fs::metadata(&path)?.len();
        let bytes = if size > TEXT_PREVIEW_LIMIT {
            // 太大就只读前面一段，并说明是截断过的
            let full = fs::read(&path)?;
            let head = &full[..TEXT_PREVIEW_LIMIT as usize];
            let mut text = String::from_utf8_lossy(head).to_string();
            text.push_str("\n\n…（文件较大，只预览了前 256 KB）");
            return Ok(Some(text));
        } else {
            fs::read(&path)?
        };
        Ok(Some(String::from_utf8_lossy(&bytes).to_string()))
    }

    /// 把 (分类, 文件名) 解析成磁盘路径，并确保它没有跑出知识库。
    fn resolve_file(&self, id: &str, name: &str) -> std::io::Result<PathBuf> {
        let category = self
            .get_category(id)
            .ok_or_else(|| std::io::Error::other(format!("没有这个分类：{id}")))?;
        // 只收纯文件名：带分隔符或 .. 的一律拒掉，避免越权读写
        if name.is_empty()
            || name.contains('/')
            || name.contains('\\')
            || name.contains("..")
            || Path::new(name).file_name().map(|f| f.to_string_lossy().to_string()) != Some(name.to_string())
        {
            return Err(std::io::Error::other(format!("非法的文件名：{name}")));
        }
        let dir = self.category_dir(&category.name);
        if !dir.starts_with(&self.root) {
            return Err(std::io::Error::other("分类目录不在知识库里面"));
        }
        let path = dir.join(name);
        if !path.starts_with(&self.root) {
            return Err(std::io::Error::other("文件不在知识库里面"));
        }
        Ok(path)
    }
}

fn dir_name_for(name: &str) -> String {
    sanitize_dir_name(name)
}

fn describe_file(path: &Path) -> LibraryFile {
    let meta = fs::metadata(path).ok();
    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    LibraryFile {
        name: path
            .file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_default(),
        is_text: TEXT_EXTS.contains(&ext.as_str()),
        ext,
        size: meta.as_ref().map(|m| m.len()).unwrap_or_default(),
        modified: meta
            .and_then(|m| m.modified().ok())
            .map(stamp_iso)
            .unwrap_or_default(),
    }
}

fn stamp_iso(t: SystemTime) -> String {
    let secs = t.duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    chrono::DateTime::from_timestamp(secs as i64, 0)
        .map(|dt| dt.to_rfc3339())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_library(tag: &str) -> (Library, PathBuf) {
        let dir = std::env::temp_dir().join(format!("goldearth_library_{tag}_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let lib = Library::new(&dir);
        lib.ensure().unwrap();
        (lib, dir)
    }

    fn category(id: &str, name: &str) -> LibraryCategory {
        LibraryCategory {
            id: id.into(),
            name: name.into(),
            agent_id: String::new(),
            description: String::new(),
            created_at: super::super::now_iso(),
            updated_at: super::super::now_iso(),
        }
    }

    #[test]
    fn creates_category_with_its_own_directory() {
        let (lib, dir) = temp_library("create");
        let created = lib.insert_category(category("c1", "行业研究")).unwrap();
        assert_eq!(created.name, "行业研究");
        assert!(lib.category_dir("行业研究").is_dir(), "分类目录应该建出来");
        assert_eq!(lib.list_categories().len(), 1);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn dedupes_category_names_so_directories_do_not_collide() {
        let (lib, dir) = temp_library("dup");
        lib.insert_category(category("c1", "资料")).unwrap();
        let second = lib.insert_category(category("c2", "资料")).unwrap();
        assert_eq!(second.name, "资料 (2)", "同名分类要自动加后缀");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn rename_moves_the_directory_with_the_materials() {
        let (lib, dir) = temp_library("rename");
        lib.insert_category(category("c1", "旧名")).unwrap();
        let old = lib.category_dir("旧名");
        fs::write(old.join("note.md"), "hello").unwrap();

        lib.update_category("c1", Some("新名".into()), Some("agent-1".into()), None)
            .unwrap();

        assert!(!old.exists(), "旧目录应该已经搬走");
        let moved = lib.category_dir("新名");
        assert!(moved.join("note.md").is_file(), "资料要跟着目录一起走");
        assert_eq!(lib.get_category("c1").unwrap().agent_id, "agent-1");
        assert_eq!(lib.file_count("c1"), 1);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn imports_files_and_renames_on_collision() {
        let (lib, dir) = temp_library("import");
        lib.insert_category(category("c1", "资料")).unwrap();
        let src_dir = dir.join("src");
        fs::create_dir_all(&src_dir).unwrap();
        let a = src_dir.join("报表.csv");
        fs::write(&a, "a,b\n1,2\n").unwrap();

        lib.import_files("c1", &[a.to_string_lossy().to_string()]).unwrap();
        // 再导一次同名文件：不应覆盖，而是加后缀
        lib.import_files("c1", &[a.to_string_lossy().to_string()]).unwrap();

        let names: Vec<String> = lib.list_files("c1").into_iter().map(|f| f.name).collect();
        assert!(names.contains(&"报表.csv".to_string()));
        assert!(names.contains(&"报表 (2).csv".to_string()), "重名要加后缀：{names:?}");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn describes_files_for_the_ui() {
        let (lib, dir) = temp_library("describe");
        lib.insert_category(category("c1", "资料")).unwrap();
        let src = dir.join("readme.md");
        fs::write(&src, "# hi\n").unwrap();
        let bin = dir.join("photo.png");
        fs::write(&bin, [0x89, 0x50, 0x4e, 0x47]).unwrap();
        lib.import_files("c1", &[src.to_string_lossy().to_string(), bin.to_string_lossy().to_string()])
            .unwrap();

        let files = lib.list_files("c1");
        let md = files.iter().find(|f| f.name == "readme.md").unwrap();
        assert!(md.is_text && md.ext == "md" && md.size == 5);
        let png = files.iter().find(|f| f.name == "photo.png").unwrap();
        assert!(!png.is_text, "图片不该当文本预览");
        assert!(!png.modified.is_empty(), "要有修改时间给界面排序");

        assert_eq!(lib.read_text("c1", "readme.md").unwrap().as_deref(), Some("# hi\n"));
        assert_eq!(lib.read_text("c1", "photo.png").unwrap(), None, "二进制不给预览");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn rejects_path_traversal_in_file_names() {
        let (lib, dir) = temp_library("traversal");
        lib.insert_category(category("c1", "资料")).unwrap();
        for bad in ["../secret.txt", "..\\secret.txt", "sub/dir.txt", ""] {
            assert!(
                lib.delete_file("c1", bad).is_err(),
                "越界的文件名必须被拒：{bad:?}"
            );
            assert!(lib.read_text("c1", bad).is_err(), "读也要拒：{bad:?}");
        }
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn delete_category_removes_its_materials() {
        let (lib, dir) = temp_library("delete");
        lib.insert_category(category("c1", "临时")).unwrap();
        let src = dir.join("a.md");
        fs::write(&src, "x").unwrap();
        lib.import_files("c1", &[src.to_string_lossy().to_string()]).unwrap();
        let folder = lib.category_dir("临时");
        assert!(folder.is_dir());

        lib.delete_category("c1").unwrap();
        assert!(!folder.exists(), "分类目录要一起删掉");
        assert!(lib.list_categories().is_empty());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn category_serializes_camel_case() {
        let v = serde_json::to_value(category("c1", "资料")).unwrap();
        assert_eq!(v["agentId"], "");
        assert!(v.get("createdAt").is_some());
    }
}