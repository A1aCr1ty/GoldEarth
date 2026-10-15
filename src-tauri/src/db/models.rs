use serde::{Deserialize, Serialize};

pub type CategoryId = String;
pub type NoteId = String;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub id: CategoryId,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(alias = "created_at")]
    pub created_at: String,
    #[serde(alias = "updated_at")]
    pub updated_at: String,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum NoteFormat {
    Markdown,
    Plain,
    Todo,
}

impl NoteFormat {
    pub fn as_str(&self) -> &'static str {
        match self {
            NoteFormat::Markdown => "markdown",
            NoteFormat::Plain => "plain",
            NoteFormat::Todo => "todo",
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: NoteId,
    #[serde(alias = "category_id")]
    pub category_id: Option<CategoryId>,
    pub title: String,
    pub format: NoteFormat,
    pub content: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(alias = "created_at")]
    pub created_at: String,
    #[serde(alias = "updated_at")]
    pub updated_at: String,
    /// 文件在磁盘上的最后修改时间，用于检测笔记是否被外部 Agent 改动
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub modified: String,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AgentKind {
    Codex,
    Custom,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Agent {
    pub id: String,
    pub name: String,
    pub kind: AgentKind,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub enabled: bool,
    #[serde(alias = "created_at")]
    pub created_at: String,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AgentRunStatus {
    Pending,
    Running,
    Succeeded,
    Failed,
    Cancelled,
}

impl AgentRunStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            AgentRunStatus::Pending => "pending",
            AgentRunStatus::Running => "running",
            AgentRunStatus::Succeeded => "succeeded",
            AgentRunStatus::Failed => "failed",
            AgentRunStatus::Cancelled => "cancelled",
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRun {
    pub id: String,
    #[serde(alias = "agent_id")]
    pub agent_id: String,
    pub prompt: String,
    pub status: AgentRunStatus,
    #[serde(default)]
    pub output: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(alias = "started_at")]
    pub started_at: String,
    #[serde(
        default,
        alias = "finished_at",
        skip_serializing_if = "Option::is_none"
    )]
    pub finished_at: Option<String>,
    /// codex 的会话 ID，用于 `codex exec resume <id>` 接着上一轮对话
    #[serde(default, alias = "session_id", skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    /// 这轮对话是为哪篇笔记发起的；笔记页按「每篇笔记一个独立会话」用它分区
    #[serde(default, alias = "note_id", skip_serializing_if = "Option::is_none")]
    pub note_id: Option<NoteId>,
    /// 这轮对话是为哪只股票发起的；股票看板按「每只股票一个独立会话」用它分区
    #[serde(default, alias = "stock_code", skip_serializing_if = "Option::is_none")]
    pub stock_code: Option<String>,
    /// 这轮对话是为哪个知识库分类发起的；知识库按「每个分类一个独立会话」用它分区
    #[serde(default, alias = "library_id", skip_serializing_if = "Option::is_none")]
    pub library_id: Option<String>,
}

/// 关注的物品：想盯着看看它跌到多少再入
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PriceTarget {
    pub id: String,
    /// 展示用的名字，比如「AirPods Pro2」
    pub name: String,
    /// 搜价时用的关键词。留空就直接拿 name 去搜
    #[serde(default)]
    pub keyword: String,
    #[serde(default)]
    pub note: String,
    #[serde(alias = "created_at")]
    pub created_at: String,
}

/// 一条价格记录。
///
/// 存的是**均价**而不是单条在售价：闲鱼同款能搜出几十条，
/// 逐条画线噪声太大，先在采集时求平均，再按天聚合成趋势。
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PriceSample {
    pub id: String,
    pub target_id: String,
    /// 均价，单位元
    pub price: f64,
    /// manual = 手动记的；xianyu = 闲鱼搜的
    #[serde(default)]
    pub source: String,
    /// 这个均价背后统计了几条在售；手动记的记 1
    #[serde(default)]
    pub samples: u32,
    #[serde(alias = "recorded_at")]
    pub recorded_at: String,
}

/// 按天聚合出来的一个点，画趋势线用
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrendPoint {
    pub day: String,
    pub avg: f64,
    pub min: f64,
    pub max: f64,
    /// 这一天记了几次
    pub count: u32,
}

/// 首页「价格追踪」卡里的一行：物品 + 当前价 + 涨跌 + 迷你走势
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PriceOverview {
    pub target: PriceTarget,
    /// 最近一次的均价
    pub latest: Option<f64>,
    /// 最新价相对上一条的涨跌幅；只有一条记录时算不出来
    pub change_pct: Option<f64>,
    /// 一共记了几次
    pub samples: u32,
    /// 跨了多少天
    pub days: u32,
    /// 最近几天的均价，画迷你走势图
    pub spark: Vec<f64>,
    pub updated_at: Option<String>,
}

/// 知识库里的一类资料：分类绑一个 agent，agent 就在这个分类的目录里工作
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryCategory {
    pub id: String,
    pub name: String,
    /// 绑定哪个 agent；空串表示还没绑
    #[serde(default)]
    pub agent_id: String,
    #[serde(default)]
    pub description: String,
    #[serde(alias = "created_at")]
    pub created_at: String,
    #[serde(alias = "updated_at")]
    pub updated_at: String,
}

/// 知识库里的一个资料文件（原样存放，不改格式）
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryFile {
    pub name: String,
    #[serde(default)]
    pub ext: String,
    #[serde(default)]
    pub size: u64,
    /// 磁盘修改时间
    #[serde(default)]
    pub modified: String,
    /// 能不能当文本预览
    #[serde(default)]
    pub is_text: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    /// 外部 Agent 可执行文件地址：可以填可执行文件本身（如
    /// C:\...\codex.cmd），也可以填它所在的目录。留空则只按系统 PATH 查找。
    pub agent_bin_path: String,
    /// 股票看板顶部展示哪些指数。空表示用默认那六个。
    pub index_codes: Vec<String>,
    /// 首页天气卡片显示的城市（中文名），留空则用默认城市
    pub weather_city: String,
    /// 是否已经铺过默认自选股。用户把自选删空后不要再自动塞回去，
    /// 所以用这个标记区分「第一次进看板」和「用户主动清空」。
    pub watchlist_seeded: bool,
    /// 界面主题模式：light / dark / system（跟随系统）
    pub theme: String,
    /// 主题色 key，取值见 ACCENTS；前端的 ACCENT_PRESETS 是同一份名单
    pub accent: String,
    /// 字体 key，取值见 FONTS；前端的 FONT_PRESETS 是同一份名单
    pub font: String,
    /// 字号倍数：基准字号 16px 乘它一次，再由窗口缩放乘一次
    pub font_scale: f64,
    /// 生日（YYYY-MM-DD），用来推星座运势。留空表示没填，
    /// 首页运势那栏会改成轮播十二星座。
    pub birth_date: String,
    /// 雪球登录 Cookie。雪球整站架了阿里云 WAF，匿名抓不到，
    /// 得靠用户自己浏览器里的 Cookie 过 WAF。留空则该平台显示「需要 Cookie」。
    pub xueqiu_cookie: String,
    /// 小红书登录 Cookie。注意小红书还要 x-s 签名，
    /// 光有 Cookie 未必放行；填了至少值得一试。
    pub xiaohongshu_cookie: String,
    /// 闲鱼登录 Cookie。
    ///
    /// **目前没有任何代码读它**——抓价走的是 App 自带的 WebView2，
    /// 登录态由那扇窗自己管（点「打开闲鱼」登录一次就会一直复用）。
    /// 这个字段先留着：用户真需要手动带 Cookie 时有个落点，
    /// 但别以为填了它就会生效。
    pub xianyu_cookie: String,
    /// 冲浪页勾选展示哪些平台。
    /// `None` = 还没配过（前端按默认全选处理）；
    /// `Some(vec![])` = 用户主动把四个都取消了——这两种必须分得清，
    /// 否则重进页面会把「我不要看」当成「还没设置」又全勾回来。
    pub explore_sources: Option<Vec<String>>,
    /// 冲浪页要不要自动刷新。`None` = 没配过，默认开。
    pub explore_auto_refresh: Option<bool>,
}

/// 主题模式白名单
pub const THEME_MODES: [&str; 3] = ["light", "dark", "system"];
/// 主题色白名单：和前端 ACCENT_PRESETS 一一对应
pub const ACCENTS: [&str; 7] = [
    "default", "blue", "violet", "teal", "green", "amber", "rose",
];
/// 字体白名单：和前端 FONT_PRESETS 一一对应
pub const FONTS: [&str; 5] = ["system", "sans", "serif", "kai", "mono"];
/// 字号倍数上下限：再小看不清，再大一屏放不下几行
pub const MIN_FONT_SCALE: f64 = 0.85;
pub const MAX_FONT_SCALE: f64 = 1.35;
pub const DEFAULT_THEME: &str = "system";
pub const DEFAULT_ACCENT: &str = "default";
pub const DEFAULT_FONT: &str = "system";

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            agent_bin_path: String::new(),
            index_codes: Vec::new(),
            weather_city: String::new(),
            watchlist_seeded: false,
            theme: DEFAULT_THEME.to_string(),
            accent: DEFAULT_ACCENT.to_string(),
            font: DEFAULT_FONT.to_string(),
            font_scale: 1.0,
            birth_date: String::new(),
            xueqiu_cookie: String::new(),
            xiaohongshu_cookie: String::new(),
            xianyu_cookie: String::new(),
            explore_sources: None,
            explore_auto_refresh: None,
        }
    }
}

/// 字号倍数：NaN / 越界都收进合法区间，再保留两位小数
pub fn normalize_font_scale(value: f64) -> f64 {
    if !value.is_finite() {
        return 1.0;
    }
    ((value.clamp(MIN_FONT_SCALE, MAX_FONT_SCALE)) * 100.0).round() / 100.0
}

/// 白名单校验：不认识的取值一律退回默认值。
/// settings.json 是纯文本，手改或降级都可能塞进奇怪的值，
/// 而前端会把它直接写进 CSS 变量，所以这里必须收紧。
pub fn normalize_choice(value: &str, allowed: &[&str], fallback: &str) -> String {
    let trimmed = value.trim();
    // 大小写不敏感：手改成 "Dark" 也当合法，存下来的是名单里的标准写法
    allowed
        .iter()
        .find(|candidate| candidate.eq_ignore_ascii_case(trimmed))
        .map(|candidate| (*candidate).to_string())
        .unwrap_or_else(|| fallback.to_string())
}

/// 生日只认 `YYYY-MM-DD`。非法值一律当没填——
/// 运势那栏拿不到星座时本来就退化成轮播十二星座，存一个半截日期反而更麻烦。
/// 合法性直接问星座模块，顺带把「2 月 30 号」这种也挡掉。
pub fn normalize_birth_date(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let mut parts = trimmed.split('-');
    let year = parts.next().and_then(|v| v.parse::<i32>().ok());
    let month = parts.next().and_then(|v| v.parse::<u32>().ok());
    let day = parts.next().and_then(|v| v.parse::<u32>().ok());
    // 多一段说明格式不对，比如 2026-1-1-1
    if parts.next().is_some() {
        return String::new();
    }
    match (year, month, day) {
        (Some(y), Some(m), Some(d))
            if (1900..=2100).contains(&y) && crate::horoscope::zodiac_of(y, m, d).is_some() =>
        {
            format!("{y:04}-{m:02}-{d:02}")
        }
        _ => String::new(),
    }
}

/// 冲浪页勾选的平台：只留认识的，并按 `Source::all()` 的固定顺序去重。
///
/// settings.json 是纯文本，手改可能塞进 `douyin` 这种已经摘掉的平台，
/// 也可能大小写不对；前端是拿这个数组去查卡片的，塞进不认识的就会
/// 渲染出一块永远加载不出来的空卡。
///
/// 注意空列表要原样保留：那是「用户把四个都取消了」，和 `None`（没配过）不是一回事。
pub fn normalize_explore_sources(values: Option<Vec<String>>) -> Option<Vec<String>> {
    let values = values?;
    let wanted: Vec<String> = values
        .iter()
        .map(|v| v.trim().to_ascii_lowercase())
        .collect();
    let out: Vec<String> = crate::trending::Source::all()
        .iter()
        .filter(|s| wanted.iter().any(|w| w == s.id()))
        .map(|s| s.id().to_string())
        .collect();
    Some(out)
}

impl AppSettings {
    /// 读盘、落盘前统一过一遍：外观字段按白名单收紧，其余原样
    pub fn normalized(mut self) -> Self {
        self.theme = normalize_choice(&self.theme, &THEME_MODES, DEFAULT_THEME);
        self.accent = normalize_choice(&self.accent, &ACCENTS, DEFAULT_ACCENT);
        self.font = normalize_choice(&self.font, &FONTS, DEFAULT_FONT);
        self.font_scale = normalize_font_scale(self.font_scale);
        self.birth_date = normalize_birth_date(&self.birth_date);
        // Cookie 粘进来常带首尾空白和换行，发请求前统一收拾干净
        self.xueqiu_cookie = self.xueqiu_cookie.trim().to_string();
        self.xiaohongshu_cookie = self.xiaohongshu_cookie.trim().to_string();
        self.xianyu_cookie = self.xianyu_cookie.trim().to_string();
        self.explore_sources = normalize_explore_sources(self.explore_sources);
        self
    }
}

/// 设置的部分更新：只带要改的字段，没带的保持原值。
/// 这样前端只传一个字段，也不会把别的配置顺手抹掉。
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettingsPatch {
    pub agent_bin_path: Option<String>,
    pub index_codes: Option<Vec<String>>,
    pub weather_city: Option<String>,
    pub watchlist_seeded: Option<bool>,
    /// 外观：只传要改的项，没传的保持原值
    pub theme: Option<String>,
    pub accent: Option<String>,
    pub font: Option<String>,
    pub font_scale: Option<f64>,
    pub birth_date: Option<String>,
    /// 冲浪页的平台 Cookie：只传要改的那个
    pub xueqiu_cookie: Option<String>,
    pub xiaohongshu_cookie: Option<String>,
    /// 闲鱼登录 Cookie（目前只存不用，留个落点）
    pub xianyu_cookie: Option<String>,
    /// 冲浪页勾选的平台：传 `[]` 表示四个都取消（和「不传」是两回事）
    pub explore_sources: Option<Vec<String>>,
    pub explore_auto_refresh: Option<bool>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_camel_case_to_match_frontend_types() {
        let run = AgentRun {
            id: "r1".into(),
            agent_id: "a1".into(),
            prompt: "p".into(),
            status: AgentRunStatus::Succeeded,
            output: String::new(),
            error: None,
            started_at: "2026-01-01T00:00:00Z".into(),
            finished_at: Some("2026-01-01T00:00:01Z".into()),
            session_id: None,
            note_id: None,
            stock_code: None,
            library_id: None,
        };
        let v = serde_json::to_value(&run).unwrap();
        assert_eq!(v["agentId"], "a1");
        assert_eq!(v["startedAt"], "2026-01-01T00:00:00Z");
        assert_eq!(v["finishedAt"], "2026-01-01T00:00:01Z");
        assert!(v.get("agent_id").is_none());
        assert!(v.get("started_at").is_none());
        assert!(v.get("note_id").is_none(), "没关联笔记时不该出现该字段");
        assert!(
            v.get("library_id").is_none(),
            "没关联知识库分类时不该出现该字段"
        );

        // 知识库分类的 run：scope 字段用 camelCase，前端按它分区对话
        let scoped = AgentRun {
            library_id: Some("c1".into()),
            ..run.clone()
        };
        let sv = serde_json::to_value(&scoped).unwrap();
        assert_eq!(sv["libraryId"], "c1");
    }

    #[test]
    fn reads_legacy_snake_case_run_files() {
        let legacy = r#"{
            "id": "r1", "agent_id": "a1", "prompt": "p", "status": "succeeded",
            "output": "", "error": null,
            "started_at": "2026-01-01T00:00:00Z", "finished_at": "2026-01-01T00:00:01Z"
        }"#;
        let run: AgentRun = serde_json::from_str(legacy).unwrap();
        assert_eq!(run.agent_id, "a1");
        assert_eq!(run.started_at, "2026-01-01T00:00:00Z");
        assert_eq!(run.finished_at.as_deref(), Some("2026-01-01T00:00:01Z"));
    }

    #[test]
    fn settings_round_trips_watchlist_seeded() {
        // 老配置文件里没有这个字段，读出来应该是 false 而不是报错
        let legacy: AppSettings =
            serde_json::from_str(r#"{"agentBinPath":"","indexCodes":[]}"#).unwrap();
        assert!(!legacy.watchlist_seeded, "缺字段要退回 false");

        let settings = AppSettings {
            agent_bin_path: String::new(),
            index_codes: vec![],
            weather_city: "北京".into(),
            watchlist_seeded: true,
            ..AppSettings::default()
        };
        let v = serde_json::to_value(&settings).unwrap();
        assert_eq!(v["watchlistSeeded"], true, "前端读的是 camelCase");
        assert_eq!(v["weatherCity"], "北京");

        // 前端只传一个字段也要能解析（局部更新）
        let patch: AppSettingsPatch = serde_json::from_str(r#"{"watchlistSeeded":true}"#).unwrap();
        assert_eq!(patch.watchlist_seeded, Some(true));
        assert_eq!(patch.weather_city, None, "没传的字段保持 None");
    }

    #[test]
    fn reads_legacy_note_with_category_id() {
        let legacy = r#"{
            "id": "n1", "category_id": "c1", "title": "t", "format": "markdown",
            "content": "", "tags": [], "created_at": "a", "updated_at": "b"
        }"#;
        let note: Note = serde_json::from_str(legacy).unwrap();
        assert_eq!(note.category_id.as_deref(), Some("c1"));
        assert_eq!(note.updated_at, "b");
        let v = serde_json::to_value(&note).unwrap();
        assert_eq!(v["categoryId"], "c1");
    }
    #[test]
    fn normalizes_appearance_fields() {
        // 不认识的取值一律退回默认：手改 settings.json 也吃不进怪值
        let raw: AppSettings = serde_json::from_str(
            r#"{"theme":"neon","accent":"rainbow","font":"comic","fontScale":9.9}"#,
        )
        .unwrap();
        let fixed = raw.normalized();
        assert_eq!(fixed.theme, "system");
        assert_eq!(fixed.accent, "default");
        assert_eq!(fixed.font, "system");
        assert_eq!(fixed.font_scale, 1.35, "越界的字号要收进上限");

        // 合法值原样保留（大小写、空格都不算合法）
        let ok = AppSettings {
            theme: "dark".into(),
            accent: "violet".into(),
            font: "serif".into(),
            font_scale: 1.1,
            ..AppSettings::default()
        };
        let kept = ok.normalized();
        assert_eq!(kept.theme, "dark");
        assert_eq!(kept.accent, "violet");
        assert_eq!(kept.font, "serif");
        assert_eq!(kept.font_scale, 1.1);

        let spaced = AppSettings {
            theme: " Dark ".into(),
            ..AppSettings::default()
        }
        .normalized();
        assert_eq!(spaced.theme, "dark", "前后空格应该被去掉");
    }

    #[test]
    fn font_scale_is_clamped_and_rounded() {
        assert_eq!(normalize_font_scale(f64::NAN), 1.0, "NaN 退回 1.0");
        assert_eq!(normalize_font_scale(f64::INFINITY), 1.0);
        assert_eq!(normalize_font_scale(0.1), MIN_FONT_SCALE);
        assert_eq!(normalize_font_scale(5.0), MAX_FONT_SCALE);
        assert_eq!(normalize_font_scale(1.234), 1.23);
        assert_eq!(normalize_font_scale(1.0), 1.0);
    }

    #[test]
    fn missing_appearance_fields_fall_back_to_defaults() {
        // 老配置文件里没有外观字段：f64 缺失必须退回 1.0，而不是 0.0
        let legacy: AppSettings = serde_json::from_str(r#"{"agentBinPath":"x"}"#).unwrap();
        assert_eq!(legacy.theme, "system");
        assert_eq!(legacy.accent, "default");
        assert_eq!(legacy.font, "system");
        assert_eq!(legacy.font_scale, 1.0, "f64 缺字段不能退成 0");

        let patch: AppSettingsPatch =
            serde_json::from_str(r#"{"theme":"dark","fontScale":1.1}"#).unwrap();
        assert_eq!(patch.theme.as_deref(), Some("dark"));
        assert_eq!(patch.font_scale, Some(1.1));
        assert_eq!(patch.font, None, "没传的字段保持 None");
    }

    #[test]
    fn explore_sources_keep_canonical_order_and_drop_unknowns() {
        // 大小写、手抖重复、已经不存在的平台，一起收拾掉
        let out = normalize_explore_sources(Some(vec![
            "Weibo".into(),
            "douyin".into(),
            "bilibili".into(),
            " weibo ".into(),
        ]))
        .expect("配过就该有值");
        assert_eq!(out, vec!["bilibili".to_string(), "weibo".to_string()]);

        // 空列表是「用户把四个都取消了」，必须原样留着
        assert_eq!(
            normalize_explore_sources(Some(vec![])),
            Some(vec![]),
            "全取消不能被当成没配过"
        );
        assert_eq!(normalize_explore_sources(None), None, "没配过就是 None");

        // 全是垃圾值时归零，前端会显示「一个平台都没选」而不是渲染出空卡
        assert_eq!(
            normalize_explore_sources(Some(vec!["douyin".into()])),
            Some(vec![])
        );
    }

    #[test]
    fn explore_settings_survive_a_round_trip() {
        let legacy: AppSettings = serde_json::from_str(r#"{"agentBinPath":"x"}"#).unwrap();
        assert_eq!(legacy.explore_sources, None, "老配置读出来是没配过");
        assert_eq!(legacy.explore_auto_refresh, None, "老配置默认交给前端决定");

        let tuned = AppSettings {
            explore_sources: Some(vec!["weibo".into(), "bogus".into()]),
            explore_auto_refresh: Some(false),
            ..AppSettings::default()
        }
        .normalized();
        let v = serde_json::to_value(&tuned).unwrap();
        assert_eq!(v["exploreSources"][0], "weibo");
        assert_eq!(v["exploreAutoRefresh"], false);

        // 局部更新：传空数组要能表达「全取消」，不传则是保持原值
        let patch: AppSettingsPatch =
            serde_json::from_str(r#"{"exploreSources":[],"exploreAutoRefresh":false}"#).unwrap();
        assert_eq!(patch.explore_sources, Some(vec![]));
        assert_eq!(patch.explore_auto_refresh, Some(false));

        let partial: AppSettingsPatch =
            serde_json::from_str(r#"{"exploreAutoRefresh":true}"#).unwrap();
        assert_eq!(partial.explore_sources, None, "没传的字段保持 None");
    }
}
