pub mod library;
pub mod models;
pub mod prices;
pub mod vault;

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use parking_lot::Mutex;
use serde::{de::DeserializeOwned, Serialize};
use tauri::{AppHandle, Manager};

use library::Library;
use models::{
    Agent, AgentRun, AppSettings, AppSettingsPatch, Category, Note, PriceOverview, PriceSample,
    PriceTarget,
};
use vault::{Vault, UNASSIGNED};

const DATA_DIR: &str = "data";
const STORAGE_LOCATION_FILE: &str = "storage_location.json";
const AGENTS_FILE: &str = "agents.json";
const RUNS_FILE: &str = "agent_runs.json";
const SETTINGS_FILE: &str = "settings.json";
const WATCHLIST_FILE: &str = "watchlist.json";
const PRICE_TARGETS_FILE: &str = "price_targets.json";
const PRICE_SAMPLES_FILE: &str = "price_samples.json";
/// 闲鱼最近一次的原始响应。抓价链路的响应结构还没被验证过，
/// 先留个档，等跑通了对着它把解析收窄
const XIANYU_RAW_FILE: &str = "xianyu_last_response.json";
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
    /// 用户填的东西不合理（空名字、离谱的价格等）。单独一类，
    /// 是为了让报错原样透到界面上，别被套成 "not found: xxx"
    #[error("{0}")]
    Invalid(String),
    #[error("{CONFLICT_PREFIX}: {0}")]
    Conflict(String),
}

pub type Result<T> = std::result::Result<T, StorageError>;

#[derive(Clone)]
struct Collections {
    agents: Arc<Mutex<Vec<Agent>>>,
    runs: Arc<Mutex<Vec<AgentRun>>>,
    /// 首页「价格追踪」盯着的物品
    price_targets: Arc<Mutex<Vec<PriceTarget>>>,
    /// 每个物品记过的价格（存的是均价，不是单条在售价）
    price_samples: Arc<Mutex<Vec<PriceSample>>>,
}

pub struct Storage {
    root: PathBuf,
    bootstrap_root: PathBuf,
    data_dir: PathBuf,
    vault: Vault,
    library: Library,
    cols: Collections,
    settings: Arc<Mutex<AppSettings>>,
}

impl Storage {
    pub fn new(app: &AppHandle) -> Result<Self> {
        let bootstrap_root = app
            .path()
            .app_data_dir()
            .map_err(|e| StorageError::NotFound(e.to_string()))?;
        let marker = bootstrap_root.join(STORAGE_LOCATION_FILE);
        let root = if marker.exists() {
            let selected: StorageLocation = serde_json::from_slice(&fs::read(&marker)?)?;
            let path = PathBuf::from(selected.root);
            if !path.is_absolute() {
                return Err(StorageError::Invalid("本地存储位置必须是绝对路径".into()));
            }
            path
        } else {
            bootstrap_root.clone()
        };
        let data_dir = root.join(DATA_DIR);
        let vault = Vault::new(&root);
        let library = Library::new(&root);
        Ok(Self {
            root,
            bootstrap_root,
            data_dir,
            vault,
            library,
            cols: Collections {
                agents: Arc::new(Mutex::new(Vec::new())),
                runs: Arc::new(Mutex::new(Vec::new())),
                price_targets: Arc::new(Mutex::new(Vec::new())),
                price_samples: Arc::new(Mutex::new(Vec::new())),
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
        self.load_into(
            &self.data_dir.join(PRICE_TARGETS_FILE),
            &self.cols.price_targets,
        )?;
        self.load_into(
            &self.data_dir.join(PRICE_SAMPLES_FILE),
            &self.cols.price_samples,
        )?;
        self.load_settings()?;
        Ok(())
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// 将当前存储完整复制到一个空目录，再写启动位置标记。旧目录保留作备份。
    pub fn change_root(&self, destination: &Path) -> Result<()> {
        let destination = destination
            .canonicalize()
            .map_err(|e| StorageError::Invalid(format!("无法访问目标文件夹：{e}")))?;
        let source = self.root.canonicalize()?;
        if destination == source
            || destination.starts_with(&source)
            || source.starts_with(&destination)
        {
            return Err(StorageError::Invalid(
                "新位置不能与当前存储目录相同，也不能互相包含".into(),
            ));
        }
        if fs::read_dir(&destination)?.next().is_some() {
            return Err(StorageError::Invalid(
                "请选择一个空文件夹，避免覆盖已有文件".into(),
            ));
        }
        copy_storage_tree(&source, &destination)?;
        fs::create_dir_all(&self.bootstrap_root)?;
        let marker = self.bootstrap_root.join(STORAGE_LOCATION_FILE);
        let temporary = self
            .bootstrap_root
            .join(format!("{STORAGE_LOCATION_FILE}.tmp"));
        fs::write(
            &temporary,
            serde_json::to_vec_pretty(&StorageLocation {
                root: destination.to_string_lossy().into_owned(),
            })?,
        )?;
        fs::rename(temporary, marker)?;
        Ok(())
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
        let next = apply_settings_patch(&self.settings(), patch);
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
            let _ = self.vault.write_replacing(&n, UNASSIGNED);
        }
        let dir = self
            .vault
            .root()
            .join(vault::sanitize_dir_name(&removed.name));
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
        self.vault.write_replacing(&n, &dir)?;
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
        // 写新文件并清掉改名/换分类前的旧文件。先写后删，中途出错也不会丢内容。
        self.vault.write_replacing(&next, &new_dir)?;
        self.get_note(id)
    }

    pub fn delete_note(&self, id: &str) -> Result<()> {
        self.vault.delete(id).map_err(StorageError::Io)
    }

    // ===== 价格追踪 =====

    pub fn list_price_targets(&self) -> Vec<PriceTarget> {
        self.cols.price_targets.lock().clone()
    }

    pub fn add_price_target(
        &self,
        name: String,
        keyword: String,
        note: String,
    ) -> Result<PriceTarget> {
        let trimmed = name.trim().to_string();
        if trimmed.is_empty() {
            return Err(StorageError::Invalid("物品名不能为空".into()));
        }
        let target = PriceTarget {
            id: uuid::Uuid::new_v4().to_string(),
            name: trimmed,
            keyword: keyword.trim().to_string(),
            note: note.trim().to_string(),
            zhuanzhuan_url: String::new(),
            created_at: now_iso(),
        };
        self.cols.price_targets.lock().push(target.clone());
        self.save(
            &self.data_dir.join(PRICE_TARGETS_FILE),
            &self.cols.price_targets.lock(),
        )?;
        Ok(target)
    }

    pub fn set_price_zhuanzhuan_url(&self, id: &str, url: String) -> Result<()> {
        let mut targets = self.cols.price_targets.lock();
        let target = targets
            .iter_mut()
            .find(|t| t.id == id)
            .ok_or_else(|| StorageError::Invalid("物品不存在".into()))?;
        let previous = std::mem::replace(&mut target.zhuanzhuan_url, url);
        if let Err(error) = self.save(&self.data_dir.join(PRICE_TARGETS_FILE), &*targets) {
            targets
                .iter_mut()
                .find(|t| t.id == id)
                .unwrap()
                .zhuanzhuan_url = previous;
            return Err(error);
        }
        Ok(())
    }

    /// 删物品时连它的价格记录一起删：留着就成了没人认领的孤儿行，
    /// 既看不见也删不掉，文件还一直变大。
    pub fn remove_price_target(&self, id: &str) -> Result<()> {
        self.cols.price_targets.lock().retain(|t| t.id != id);
        self.cols.price_samples.lock().retain(|s| s.target_id != id);
        self.save(
            &self.data_dir.join(PRICE_TARGETS_FILE),
            &self.cols.price_targets.lock(),
        )?;
        self.save(
            &self.data_dir.join(PRICE_SAMPLES_FILE),
            &self.cols.price_samples.lock(),
        )?;
        Ok(())
    }

    /// 某个物品记过的价格，最新的在前
    pub fn list_price_samples(&self, target_id: &str) -> Vec<PriceSample> {
        let mut rows: Vec<PriceSample> = self
            .cols
            .price_samples
            .lock()
            .iter()
            .filter(|s| s.target_id == target_id)
            .cloned()
            .collect();
        rows.sort_by(|a, b| b.recorded_at.cmp(&a.recorded_at));
        rows
    }

    /// 记一笔均价。`samples` 是这个均价背后统计了几条在售，
    /// 手动记的按 1 算，不然图上「样本 0 条」看着像没抓到东西。
    pub fn add_price_sample(
        &self,
        target_id: &str,
        price: f64,
        source: &str,
        samples: u32,
    ) -> Result<PriceSample> {
        if !self
            .cols
            .price_targets
            .lock()
            .iter()
            .any(|t| t.id == target_id)
        {
            return Err(StorageError::NotFound(format!("price target {target_id}")));
        }
        let price = prices::validate_price(price).map_err(StorageError::Invalid)?;
        let row = PriceSample {
            id: uuid::Uuid::new_v4().to_string(),
            target_id: target_id.to_string(),
            price,
            source: if source.trim().is_empty() {
                "manual".into()
            } else {
                source.trim().to_string()
            },
            samples: samples.max(1),
            recorded_at: now_iso(),
        };
        // 最新的放最前面，和 list_price_samples 的排序对得上
        self.cols.price_samples.lock().insert(0, row.clone());
        self.save(
            &self.data_dir.join(PRICE_SAMPLES_FILE),
            &self.cols.price_samples.lock(),
        )?;
        Ok(row)
    }

    /// 画趋势线的数据，按天聚合；days <= 0 表示不限
    pub fn price_trend(&self, target_id: &str, days: i64) -> Vec<models::TrendPoint> {
        prices::build_trend(&self.list_price_samples(target_id), days)
    }

    /// 首页那张卡：每个物品一行
    pub fn price_overview(&self, spark_days: usize) -> Vec<PriceOverview> {
        let targets = self.list_price_targets();
        let samples = self.cols.price_samples.lock();
        targets
            .iter()
            .map(|t| {
                let mine: Vec<PriceSample> = samples
                    .iter()
                    .filter(|s| s.target_id == t.id)
                    .cloned()
                    .collect();
                prices::build_overview(t, &mine, spark_days)
            })
            .collect()
    }

    /// 把闲鱼那次的原始响应落到 `data/xianyu_last_response.json`。
    ///
    /// 闲鱼页面会请求搜索结果以外的辅助接口（例如搜索词提示），它们也可能返回
    /// `SUCCESS`，但不含商品列表。保留最近一次响应，便于辨别采到的是哪类接口，
    /// 并据此校正 `xianyu_webview::extract_prices`。
    ///
    /// 写失败只打日志：存个调试文件不该让整次抓价跟着失败。
    pub fn dump_xianyu_response(&self, raw: &str) -> Result<()> {
        if raw.trim().is_empty() {
            return Ok(());
        }
        let path = self.data_dir.join(XIANYU_RAW_FILE);
        if let Err(e) = fs::write(&path, raw) {
            eprintln!("[xianyu] 存原始响应失败 {}：{e}", path.display());
        }
        Ok(())
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
    pub fn update_agent(
        &self,
        id: &str,
        name: Option<String>,
        kind: Option<models::AgentKind>,
        command: Option<String>,
        args: Option<Vec<String>>,
        description: Option<String>,
        enabled: Option<bool>,
    ) -> Result<Agent> {
        let mut g = self.cols.agents.lock();
        let item = g
            .iter_mut()
            .find(|a| a.id == id)
            .ok_or_else(|| StorageError::NotFound(format!("agent {id}")))?;
        if let Some(n) = name {
            item.name = n;
        }
        if let Some(k) = kind {
            item.kind = k;
        }
        if let Some(c) = command {
            item.command = c;
        }
        if let Some(a) = args {
            item.args = a;
        }
        if let Some(d) = description {
            item.description = Some(d);
        }
        if let Some(e) = enabled {
            item.enabled = e;
        }
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

    pub fn save_watchlist(&self, items: &[crate::commands::market::WatchItem]) -> Result<()> {
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

#[derive(serde::Serialize, serde::Deserialize)]
struct StorageLocation {
    root: String,
}

fn copy_storage_tree(source: &Path, destination: &Path) -> std::io::Result<()> {
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        if entry.file_name() == STORAGE_LOCATION_FILE {
            continue;
        }
        let metadata = fs::symlink_metadata(entry.path())?;
        if metadata.file_type().is_symlink() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "存储目录包含符号链接，无法安全迁移",
            ));
        }
        let target = destination.join(entry.file_name());
        if metadata.is_dir() {
            fs::create_dir(&target)?;
            copy_storage_tree(&entry.path(), &target)?;
        } else if metadata.is_file() {
            fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
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

/// 把补丁套到当前设置上，返回规范化之后的新值。
///
/// 刻意抽成纯函数：`Storage` 构造要 Tauri 句柄，测不了，
/// 于是以前这段逻辑直接写在 `update_settings` 里，加字段时漏掉一句
/// 编译期发现不了，现象是「界面提示保存成功、配置却什么都没变」。
/// ——冲浪页的雪球 / 小红书 Cookie 就是这么丢过一次的。
pub fn apply_settings_patch(base: &AppSettings, patch: AppSettingsPatch) -> AppSettings {
    let mut next = base.clone();
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
    if let Some(v) = patch.birth_date {
        next.birth_date = v;
    }
    // 冲浪页两个平台的登录 Cookie。这里必须显式接住：漏掉的话 Cookie
    // 会被静默丢掉，卡片永远停在「需要 Cookie」，存了等于没存。
    // 首尾空白交给 normalized() 统一收拾（浏览器复制常带换行）。
    if let Some(v) = patch.xueqiu_cookie {
        next.xueqiu_cookie = v;
    }
    if let Some(v) = patch.xiaohongshu_cookie {
        next.xiaohongshu_cookie = v;
    }
    // 闲鱼 Cookie：先存着备用，抓价目前走 WebView2，读不到这里
    if let Some(v) = patch.xianyu_cookie {
        next.xianyu_cookie = v;
    }
    // 勾选列表原样收下，空数组要能传得进去；
    // 不认识的值由 normalized() 按平台清单收紧
    if let Some(v) = patch.explore_sources {
        next.explore_sources = Some(v);
    }
    if let Some(v) = patch.explore_auto_refresh {
        next.explore_auto_refresh = Some(v);
    }
    // 外观等字段按白名单收紧后再落盘，保证文件里永远是合法值
    next.normalized()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 一份「每个字段都给值」的补丁。
    ///
    /// 这里刻意**不写** `..Default::default()`：给 `AppSettingsPatch` 加新字段时，
    /// 这个结构体字面量会直接编译不过，逼着同时补上 `apply_settings_patch` 里的
    /// 一行和下面的一条断言。以前正是缺这层守卫，雪球 / 小红书 Cookie 加了字段
    /// 却忘了接住，界面上「保存成功」但 Cookie 从来没存下来过。
    fn full_patch() -> AppSettingsPatch {
        AppSettingsPatch {
            agent_bin_path: Some("C:/tools/codex.cmd".into()),
            index_codes: Some(vec!["SH600000".into(), "600000".into()]),
            weather_city: Some("  上海 ".into()),
            watchlist_seeded: Some(true),
            theme: Some("dark".into()),
            accent: Some("teal".into()),
            font: Some("serif".into()),
            font_scale: Some(1.2),
            birth_date: Some("1990-05-06".into()),
            xueqiu_cookie: Some("xq_a_token=abc123".into()),
            xiaohongshu_cookie: Some("web_session=xyz789".into()),
            xianyu_cookie: Some("cookie2=xy001".into()),
            explore_sources: Some(vec!["weibo".into(), "douyin".into()]),
            explore_auto_refresh: Some(false),
        }
    }

    #[test]
    fn every_patch_field_actually_lands() {
        let next = apply_settings_patch(&AppSettings::default(), full_patch());

        assert_eq!(next.agent_bin_path, "C:/tools/codex.cmd");
        assert_eq!(
            next.index_codes,
            vec!["sh600000".to_string()],
            "要去重并规范化"
        );
        assert_eq!(next.weather_city, "上海", "首尾空格要收掉");
        assert!(next.watchlist_seeded);
        assert_eq!(next.theme, "dark");
        assert_eq!(next.accent, "teal");
        assert_eq!(next.font, "serif");
        assert_eq!(next.font_scale, 1.2);
        assert_eq!(next.birth_date, "1990-05-06");
        assert_eq!(
            next.explore_sources,
            Some(vec!["weibo".to_string()]),
            "不认识的平台要丢掉"
        );
        assert_eq!(next.explore_auto_refresh, Some(false));
    }

    #[test]
    fn trending_cookies_are_saved_and_trimmed() {
        let next = apply_settings_patch(&AppSettings::default(), full_patch());
        assert_eq!(
            next.xueqiu_cookie, "xq_a_token=abc123",
            "雪球 Cookie 必须真的存下来，否则卡片永远停在「需要 Cookie」"
        );
        assert_eq!(next.xiaohongshu_cookie, "web_session=xyz789");
        assert_eq!(
            next.xianyu_cookie, "cookie2=xy001",
            "闲鱼 Cookie 也要真的存下来，否则首页那个「去闲鱼查价」永远只是空按"
        );

        // 浏览器复制出来的 Cookie 常带换行和空格，落盘前要收拾干净
        let pasted = apply_settings_patch(
            &AppSettings::default(),
            AppSettingsPatch {
                xueqiu_cookie: Some("  xq_a_token=abc\n".into()),
                ..AppSettingsPatch::default()
            },
        );
        assert_eq!(pasted.xueqiu_cookie, "xq_a_token=abc");
        assert!(!pasted.xueqiu_cookie.contains('\n'));
    }

    #[test]
    fn cookie_round_trips_through_the_settings_file_shape() {
        // 前端实际发的是 camelCase，这条路径不能断
        let patch: AppSettingsPatch =
            serde_json::from_str(r#"{"xueqiuCookie":"xq_a_token=abc"}"#).unwrap();
        let next = apply_settings_patch(&AppSettings::default(), patch);
        assert_eq!(next.xueqiu_cookie, "xq_a_token=abc");

        let v = serde_json::to_value(&next).unwrap();
        assert_eq!(v["xueqiuCookie"], "xq_a_token=abc");
    }

    #[test]
    fn absent_fields_keep_their_previous_value() {
        let base = apply_settings_patch(&AppSettings::default(), full_patch());
        // 只改城市，其余一个都不该动
        let next = apply_settings_patch(
            &base,
            AppSettingsPatch {
                weather_city: Some("北京".into()),
                ..AppSettingsPatch::default()
            },
        );
        assert_eq!(next.weather_city, "北京");
        assert_eq!(next.xueqiu_cookie, base.xueqiu_cookie);
        assert_eq!(next.theme, base.theme);
        assert_eq!(next.explore_sources, base.explore_sources);
    }

    #[test]
    fn clearing_a_cookie_takes_effect() {
        let base = apply_settings_patch(&AppSettings::default(), full_patch());
        let next = apply_settings_patch(
            &base,
            AppSettingsPatch {
                xueqiu_cookie: Some(String::new()),
                ..AppSettingsPatch::default()
            },
        );
        assert!(next.xueqiu_cookie.is_empty(), "清空要真的清空");
        assert_eq!(next.xiaohongshu_cookie, base.xiaohongshu_cookie);
    }
}
