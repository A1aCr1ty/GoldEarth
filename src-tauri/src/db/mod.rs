pub mod library;
pub mod models;
pub mod vault;

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use parking_lot::Mutex;
use serde::{de::DeserializeOwned, Serialize};
use tauri::{AppHandle, Manager};

use library::Library;
use models::{Agent, AgentRun, AppSettings, AppSettingsPatch, Category, Note};
use vault::{Vault, UNASSIGNED};

const DATA_DIR: &str = "data";
const AGENTS_FILE: &str = "agents.json";
const RUNS_FILE: &str = "agent_runs.json";
const SETTINGS_FILE: &str = "settings.json";
const WATCHLIST_FILE: &str = "watchlist.json";
const LEGACY_CATEGORIES_FILE: &str = "categories.json";
const LEGACY_NOTES_FILE: &str = "notes.json";
const MAX_RUN_HISTORY: usize = 200;

/// 外部进程（codex）改动过文件时，保存会返回这个前缀的错误
pub const CONFLICT_PREFIX: &str = "ERR_CONFLICT";

#[derive(Debug, thiserror::Error)]
pub enum StorageError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("serde: {0}")]
    Serde(#[from] serde_json::Error),
    #[error("tauri: {0}")]
    Tauri(#[from] tauri::Error),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("{CONFLICT_PREFIX}: {0}")]
    Conflict(String),
}

pub type Result<T> = std::result::Result<T, StorageError>;

#[derive(Clone)]
struct Collections {
    agents: Arc<Mutex<Vec<Agent>>>,
    runs: Arc<Mutex<Vec<AgentRun>>>,
}

pub struct Storage {
    root: PathBuf,
    data_dir: PathBuf,
    vault: Vault,
    library: Library,
    cols: Collections,
    settings: Arc<Mutex<AppSettings>>,
}

impl Storage {
    pub fn new(app: &AppHandle) -> Result<Self> {
        let root = app
            .path()
            .app_data_dir()
            .map_err(|e| StorageError::NotFound(e.to_string()))?;
        let data_dir = root.join(DATA_DIR);
        let vault = Vault::new(&root);
        let library = Library::new(&root);
        Ok(Self {
            root,
            data_dir,
            vault,
            library,
            cols: Collections {
                agents: Arc::new(Mutex::new(Vec::new())),
                runs: Arc::new(Mutex::new(Vec::new())),
            },
            settings: Arc::new(Mutex::new(AppSettings::default())),
        })
    }

    pub fn init(&self) -> Result<()> {
        fs::create_dir_all(&self.data_dir)?;
        self.vault.ensure()?;
        self.library.ensure()?;
        self.migrate_legacy()?;
        self.load_into(&self.data_dir.join(AGENTS_FILE), &self.cols.agents)?;
        self.load_into(&self.data_dir.join(RUNS_FILE), &self.cols.runs)?;
        self.load_settings()?;
        Ok(())
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn vault_root(&self) -> &Path {
        self.vault.root()
    }

    pub fn library(&self) -> &Library {
        &self.library
    }

    /// 首次启动时把旧的 JSON 笔记导入 vault；原始文件保留作为备份
    fn migrate_legacy(&self) -> Result<()> {
        let legacy_notes = self.data_dir.join(LEGACY_NOTES_FILE);
        let legacy_categories = self.data_dir.join(LEGACY_CATEGORIES_FILE);

        if legacy_categories.exists() {
            let cats: Vec<Category> = read_json_or(&legacy_categories, Vec::new());
            if !cats.is_empty() {
                let _ = self.vault.save_categories(&cats);
            }
        }

        if legacy_notes.exists() && self.vault.list_notes(None).is_empty() {
            let mut notes: Vec<Note> = read_json_or(&legacy_notes, Vec::new());
            for n in &mut notes {
                n.modified = String::new();
            }
            for note in &notes {
                let dir = self.dir_name_for(note.category_id.as_deref());
                if let Err(e) = self.vault.write(note, &dir) {
                    eprintln!("迁移笔记 {} 失败: {e}", note.id);
                }
            }
            eprintln!("已将 {} 条笔记迁移到 vault 目录", notes.len());
        }
        Ok(())
    }

    fn load_into<T: DeserializeOwned>(&self, path: &Path, slot: &Arc<Mutex<Vec<T>>>) -> Result<()> {
        if !path.exists() {
            return Ok(());
        }
        let data = fs::read_to_string(path)?;
        if data.trim().is_empty() {
            return Ok(());
        }
        let parsed: Vec<T> = serde_json::from_str(&data)?;
        *slot.lock() = parsed;
        Ok(())
    }

    // ===== settings =====
    fn load_settings(&self) -> Result<()> {
        let path = self.data_dir.join(SETTINGS_FILE);
        if !path.exists() {
            return Ok(());
        }
        let data = fs::read_to_string(&path)?;
        if data.trim().is_empty() {
            return Ok(());
        }
        // 手改过的 settings.json 也在这里收紧一次，前端拿到的就是合法值
        *self.settings.lock() = serde_json::from_str::<AppSettings>(&data)?.normalized();
        Ok(())
    }

    pub fn settings(&self) -> AppSettings {
        self.settings.lock().clone()
    }

    /// 只改传进来的字段，其余保持原值；返回更新后的完整设置。
    pub fn update_settings(&self, patch: AppSettingsPatch) -> Result<AppSettings> {
        let mut next = self.settings();
        if let Some(v) = patch.agent_bin_path {
            next.agent_bin_path = v.trim().to_string();
        }
        if let Some(codes) = patch.index_codes {
            // 指数代码去重并规范化，用户手滑传了 "SH600000" 也能存成标准形式
            let mut out: Vec<String> = Vec::new();
            for c in codes {
                let n = crate::market::symbol::normalize(&c);
                if !n.is_empty() && !out.contains(&n) {
                    out.push(n);
                }
            }
            next.index_codes = out;
        }
        if let Some(v) = patch.weather_city {
            next.weather_city = v.trim().to_string();
        }
        if let Some(v) = patch.watchlist_seeded {
            next.watchlist_seeded = v;
        }
        if let Some(v) = patch.theme {
            next.theme = v;
        }
        if let Some(v) = patch.accent {
            next.accent = v;
        }
        if let Some(v) = patch.font {
            next.font = v;
        }
        if let Some(v) = patch.font_scale {
            next.font_scale = v;
        }
        // 外观字段按白名单收紧后再落盘，保证文件里永远是合法值
        let next = next.normalized();
        *self.settings.lock() = next.clone();
        let path = self.data_dir.join(SETTINGS_FILE);
        fs::write(&path, serde_json::to_string_pretty(&next)?)?;
        Ok(next)
    }

    // ===== 分类 =====
    pub fn list_categories(&self) -> Vec<Category> {
        self.vault.list_categories()
    }

    pub fn dir_name_for(&self, category_id: Option<&str>) -> String {
        match category_id {
            Some(cid) => self
                .list_categories()
                .into_iter()
                .find(|c| c.id == cid)
                .map(|c| c.name)
                .unwrap_or_else(|| UNASSIGNED.to_string()),
            None => UNASSIGNED.to_string(),
        }
    }

    pub fn insert_category(&self, c: Category) -> Result<Category> {
        self.vault.ensure()?;
        let mut items = self.vault.list_categories();
        items.push(c.clone());
        self.vault.save_categories(&items)?;
        let _ = self.vault.category_dir(&c.name);
        Ok(c)
    }

    pub fn update_category(
        &self,
        id: &str,
        name: Option<String>,
        icon: Option<String>,
        description: Option<String>,
    ) -> Result<Category> {
        let mut items = self.vault.list_categories();
        let item = items
            .iter_mut()
            .find(|c| c.id == id)
            .ok_or_else(|| StorageError::NotFound(format!("category {id}")))?;
        let old_name = item.name.clone();
        if let Some(n) = name {
            item.name = n;
        }
        if let Some(i) = icon {
            item.icon = Some(i);
        }
        if let Some(d) = description {
            item.description = Some(d);
        }
        item.updated_at = now_iso();
        let cloned = item.clone();
        self.vault.save_categories(&items)?;
        let _ = self.vault.category_dir(&cloned.name);
        if old_name != cloned.name {
            self.migrate_dir(&old_name, &cloned.name)?;
        }
        Ok(cloned)
    }

    /// 分类改名时把目录里的笔记一起搬过去
    fn migrate_dir(&self, old: &str, new: &str) -> Result<()> {
        let from = self.vault.root().join(vault::sanitize_dir_name(old));
        let to = self.vault.category_dir(new)?;
        if !from.is_dir() || from == to {
            return Ok(());
        }
        if let Ok(files) = fs::read_dir(&from) {
            for f in files.flatten() {
                let p = f.path();
                if p.extension().and_then(|e| e.to_str()) == Some("md") {
                    let _ = fs::rename(&p, to.join(p.file_name().unwrap_or_default()));
                }
            }
        }
        Ok(())
    }

    pub fn delete_category(&self, id: &str) -> Result<()> {
        let mut items = self.vault.list_categories();
        let Some(pos) = items.iter().position(|c| c.id == id) else {
            return Err(StorageError::NotFound(format!("category {id}")));
        };
        let removed = items.remove(pos);
        self.vault.save_categories(&items)?;
        // 该分类下的笔记移回「未分类」，而不是删掉
        let notes: Vec<Note> = self
            .vault
            .list_notes(None)
            .into_iter()
            .filter(|n| n.category_id.as_deref() == Some(id))
            .collect();
        for mut n in notes {
            n.category_id = None;
            n.updated_at = now_iso();
            if let Some(p) = self.vault.path_of(&n.id) {
                let _ = fs::remove_file(p);
            }
            let _ = self.vault.write(&n, UNASSIGNED);
        }
        let dir = self.vault.root().join(vault::sanitize_dir_name(&removed.name));
        let _ = fs::remove_dir(dir);
        Ok(())
    }

    // ===== 笔记 =====
    pub fn list_notes(&self, category_id: Option<&str>) -> Vec<Note> {
        self.vault.list_notes(category_id)
    }

    pub fn get_note(&self, id: &str) -> Result<Note> {
        self.vault
            .find(id)
            .ok_or_else(|| StorageError::NotFound(format!("note {id}")))
    }

    pub fn insert_note(&self, n: Note) -> Result<Note> {
        let dir = self.dir_name_for(n.category_id.as_deref());
        self.vault.write(&n, &dir)?;
        self.vault
            .find(&n.id)
            .ok_or_else(|| StorageError::NotFound(format!("note {}", n.id)))
    }

    /// `expected_modified` 是前端载入该笔记时看到的磁盘修改时间。
    /// 与当前磁盘不一致说明外部 Agent 改过，此时拒绝覆盖。
    #[allow(clippy::too_many_arguments)]
    pub fn update_note(
        &self,
        id: &str,
        category_id: Option<Option<String>>,
        title: Option<String>,
        format: Option<models::NoteFormat>,
        content: Option<String>,
        tags: Option<Vec<String>>,
        expected_modified: Option<String>,
    ) -> Result<Note> {
        let current = self.get_note(id)?;
        if let Some(expected) = expected_modified.as_deref().filter(|s| !s.is_empty()) {
            if !current.modified.is_empty() && current.modified != expected {
                return Err(StorageError::Conflict(format!(
                    "笔记《{}》已被外部程序修改，请重新载入后再保存",
                    current.title
                )));
            }
        }

        let old_dir = self.dir_name_for(current.category_id.as_deref());
        let mut next = current.clone();
        if let Some(c) = category_id {
            next.category_id = c;
        }
        if let Some(t) = title {
            next.title = t;
        }
        if let Some(f) = format {
            next.format = f;
        }
        if let Some(c) = content {
            next.content = c;
        }
        if let Some(t) = tags {
            next.tags = t;
        }
        next.updated_at = now_iso();
        next.modified = String::new();

        let new_dir = self.dir_name_for(next.category_id.as_deref());
        self.vault.write(&next, &new_dir)?;
        // 改名或换分类后旧文件要清掉，否则会留下重复副本
        if old_dir != new_dir || next.title != current.title {
            if let Some(p) = self.vault.path_of(&current.id) {
                let expected_new = self.vault.path_of(&next.id);
                if expected_new.as_deref() != Some(p.as_path()) {
                    let _ = fs::remove_file(p);
                }
            }
        }
        self.get_note(id)
    }

    pub fn delete_note(&self, id: &str) -> Result<()> {
        self.vault.delete(id).map_err(StorageError::Io)
    }

    // ===== agents =====
    pub fn list_agents(&self) -> Vec<Agent> {
        self.cols.agents.lock().clone()
    }
    pub fn get_agent(&self, id: &str) -> Result<Agent> {
        self.cols
            .agents
            .lock()
            .iter()
            .find(|a| a.id == id)
            .cloned()
            .ok_or_else(|| StorageError::NotFound(format!("agent {id}")))
    }
    pub fn insert_agent(&self, a: Agent) -> Result<Agent> {
        self.cols.agents.lock().push(a.clone());
        self.save(&self.data_dir.join(AGENTS_FILE), &self.cols.agents.lock())?;
        Ok(a)
    }
    pub fn update_agent(&self, id: &str, name: Option<String>, kind: Option<models::AgentKind>, command: Option<String>, args: Option<Vec<String>>, description: Option<String>, enabled: Option<bool>) -> Result<Agent> {
        let mut g = self.cols.agents.lock();
        let item = g.iter_mut().find(|a| a.id == id).ok_or_else(|| StorageError::NotFound(format!("agent {id}")))?;
        if let Some(n) = name { item.name = n; }
        if let Some(k) = kind { item.kind = k; }
        if let Some(c) = command { item.command = c; }
        if let Some(a) = args { item.args = a; }
        if let Some(d) = description { item.description = Some(d); }
        if let Some(e) = enabled { item.enabled = e; }
        let cloned = item.clone();
        drop(g);
        self.save(&self.data_dir.join(AGENTS_FILE), &self.cols.agents.lock())?;
        Ok(cloned)
    }
    pub fn delete_agent(&self, id: &str) -> Result<()> {
        self.cols.agents.lock().retain(|a| a.id != id);
        self.save(&self.data_dir.join(AGENTS_FILE), &self.cols.agents.lock())?;
        Ok(())
    }

    // ===== runs =====
    pub fn insert_run(&self, r: AgentRun) -> Result<AgentRun> {
        self.cols.runs.lock().insert(0, r.clone());
        self.trim_runs();
        self.save(&self.data_dir.join(RUNS_FILE), &self.cols.runs.lock())?;
        Ok(r)
    }
    pub fn update_run(&self, r: AgentRun) -> Result<()> {
        let mut g = self.cols.runs.lock();
        if let Some(item) = g.iter_mut().find(|x| x.id == r.id) {
            *item = r;
        }
        drop(g);
        self.save(&self.data_dir.join(RUNS_FILE), &self.cols.runs.lock())?;
        Ok(())
    }
    pub fn list_runs(&self, limit: usize) -> Vec<AgentRun> {
        self.cols.runs.lock().iter().take(limit).cloned().collect()
    }

    /// 一轮运行挂在哪个对象上：笔记页按笔记，股票看板按股票，知识库按分类。
    /// 三者互斥；都没有就是从 Agent 页发起的全局运行。
    fn run_scope(r: &AgentRun) -> Option<&str> {
        r.note_id
            .as_deref()
            .or(r.stock_code.as_deref())
            .or(r.library_id.as_deref())
            .filter(|s| !s.is_empty())
    }

    /// 某标的 + 某个 agent 最近一次留下的会话 ID，用来 resume 接着聊。
    /// runs 是按时间倒序存的（最新的在索引 0），所以第一个命中的就是最近一次。
    pub fn latest_session_for(&self, agent_id: &str, scope: &str) -> Option<String> {
        self.cols
            .runs
            .lock()
            .iter()
            .find(|r| r.agent_id == agent_id && Self::run_scope(r) == Some(scope))
            .and_then(|r| r.session_id.clone())
            .filter(|s| !s.is_empty())
    }

    /// 取某标的与某个 agent 的对话历史（最新在前）
    pub fn list_runs_for_scope(&self, scope: &str, agent_id: &str, limit: usize) -> Vec<AgentRun> {
        self.cols
            .runs
            .lock()
            .iter()
            .filter(|r| r.agent_id == agent_id && Self::run_scope(r) == Some(scope))
            .take(limit)
            .cloned()
            .collect()
    }

    /// 笔记在 vault 里的相对路径（正斜杠），用于告诉 Agent 该去改哪个文件
    pub fn relative_note_path(&self, id: &str) -> Option<String> {
        let path = self.vault.path_of(id)?;
        let rel = path.strip_prefix(self.vault.root()).ok()?;
        Some(
            rel.components()
                .map(|c| c.as_os_str().to_string_lossy().into_owned())
                .collect::<Vec<_>>()
                .join("/"),
        )
    }
    fn trim_runs(&self) {
        let mut g = self.cols.runs.lock();
        if g.len() > MAX_RUN_HISTORY {
            g.truncate(MAX_RUN_HISTORY);
        }
    }

    // ===== 自选股 =====
    pub fn list_watchlist(&self) -> Vec<crate::commands::market::WatchItem> {
        let path = self.data_dir.join(WATCHLIST_FILE);
        read_json_or(&path, Vec::new())
    }

    pub fn save_watchlist(
        &self,
        items: &[crate::commands::market::WatchItem],
    ) -> Result<()> {
        let path = self.data_dir.join(WATCHLIST_FILE);
        self.save(&path, &items)
    }

    fn save<T: Serialize>(&self, path: &Path, items: &[T]) -> Result<()> {
        let data = serde_json::to_string_pretty(items)?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(path, data)?;
        Ok(())
    }
}

fn read_json_or<T: DeserializeOwned>(path: &Path, fallback: T) -> T {
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or(fallback)
}

pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}
