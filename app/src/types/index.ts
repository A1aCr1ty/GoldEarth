export type CategoryId = string;
export interface CategoryHtmlFile { categoryId: CategoryId | null; name: string; size: number; updatedAt: string }
export interface Category {
  id: CategoryId;
  name: string;
  icon?: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}
export type NoteFormat = "markdown" | "plain" | "todo";
export type NoteId = string;
export interface Note {
  id: NoteId;
  categoryId: CategoryId | null;
  title: string;
  format: NoteFormat;
  content: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  /** 文件在磁盘上的最后修改时间，用于检测是否被外部 Agent 改动 */
  modified?: string;
}
export type AgentKind = "codex" | "custom";
export interface Agent {
  id: string;
  name: string;
  kind: AgentKind;
  command: string;
  args: string[];
  description?: string;
  enabled: boolean;
  createdAt: string;
}
export type AgentRunStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled";
export interface AgentRunRequest {
  agentId: string;
  prompt: string;
  contextNoteIds?: NoteId[];
}
export interface AgentRun {
  id: string;
  agentId: string;
  prompt: string;
  status: AgentRunStatus;
  output: string;
  error?: string;
  startedAt: string;
  finishedAt?: string;
  /** codex 会话 ID，用于接着上一轮继续聊 */
  sessionId?: string;
  /** 这轮对话是为哪篇笔记发起的；笔记页按「每篇笔记一个独立会话」用它分区 */
  noteId?: string;
  /** 这轮对话是为哪只股票发起的；股票看板按「每只股票一个独立会话」用它分区 */
  stockCode?: string;
  /** 这轮对话是为哪个知识库分类发起的；知识库按「每个分类一个独立会话」用它分区 */
  libraryId?: string;
}
/** 后端 agent://stream 事件的载荷，text 是相对已收到内容的新增片段 */
export interface AgentStreamEvent {
  runId: string;
  agentId: string;
  noteId?: string;
  libraryId?: string;
  text: string;
}
export interface AppSettings {
  /** 外部 Agent 可执行文件地址：可执行文件本身或其所在目录，留空则只查系统 PATH */
  agentBinPath: string;
  /** 股票看板顶部展示哪些指数，空表示用默认那六个 */
  indexCodes?: string[];
  /** 首页天气卡片显示的城市，留空则用默认城市（北京） */
  weatherCity?: string;
  /** 界面主题模式：light / dark / system（跟随系统） */
  theme?: string;
  /** 主题色 key：default / blue / violet / teal / green / amber / rose */
  accent?: string;
  /** 字体 key：system / sans / serif / kai / mono */
  font?: string;
  /** 字号倍数：0.85 – 1.35 */
  fontScale?: number;
  /** 生日 YYYY-MM-DD，用来推星座运势；留空则首页轮播十二星座 */
  birthDate?: string;
  /** 雪球登录 Cookie（雪球有 WAF，匿名抓不到） */
  xueqiuCookie?: string;
  /** 小红书登录 Cookie（小红书还要 x-s 签名，填了也未必放行） */
  xiaohongshuCookie?: string;
  /** 冲浪页勾选的平台；未配置（null/缺省）= 默认全选，空数组 = 用户全取消了 */
  exploreSources?: string[] | null;
  /** 冲浪页是否自动刷新；未配置（null/缺省）= 默认开 */
  exploreAutoRefresh?: boolean | null;
}

// ===== 星座运势 =====

/** 运势的一个维度：整体 / 爱情 / 事业 / 财运 / 健康 */
export interface HoroscopeAspect {
  /** all / love / work / money / health */
  key: string;
  /** 整体 / 爱情 / … */
  label: string;
  /** 星级 1–5；上游给的不是这个范围就是 0，界面上不画星 */
  stars: number;
  /** 指数，形如 "66%" */
  index: string;
  /** 解读正文（后端已清掉句尾残留） */
  text: string;
}

export interface Horoscope {
  /** 接口用的英文星座名，如 aquarius */
  sign: string;
  /** 中文星座名，如 水瓶座 */
  title: string;
  /** 「今日运势」 */
  period: string;
  /** 「10月14日」 */
  date: string;
  /** 一句话提要 */
  shortComment: string;
  aspects: HoroscopeAspect[];
  /** 幸运色 / 幸运星座 / 幸运数字：上游会串位，后端校验不过就不给 */
  luckyColor?: string;
  luckyConstellation?: string;
  luckyNumber?: string;
  /** 「宜户外散步舒展」 */
  todoYi?: string;
  /** 「忌冲动购置闲置」 */
  todoJi?: string;
}

// ===== 行情 =====

/** 带交易所前缀的代码，如 sh600519 */
export type StockCode = string;
export type KlinePeriod = "minute" | "day" | "week" | "month";
export type RankKind = "gainers" | "losers" | "amount" | "turnover";

/** 五档盘口的一档 */
export interface OrderLevel {
  price: number;
  /** 手 */
  volume: number;
}

/** 实时快照；单位已在后端统一，这里只做格式化 */
export interface Quote {
  code: StockCode;
  symbol: string;
  name: string;
  price: number;
  prevClose: number;
  open: number;
  high: number;
  low: number;
  change: number;
  changePct: number;
  /** 手 */
  volume: number;
  /** 元 */
  amount: number;
  turnoverRate: number;
  amplitude: number;
  outer: number;
  inner: number;
  volumeRatio: number;
  orderRatio: number;
  pe: number;
  pb: number;
  /** 亿元 */
  totalMv: number;
  /** 亿元 */
  floatMv: number;
  limitUp: number;
  limitDown: number;
  avgPrice: number;
  /** 形如 20261014102853 */
  time: string;
  bids: OrderLevel[];
  asks: OrderLevel[];
}

export interface Candle {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  /** 手 */
  volume: number;
  /** 元 */
  amount: number;
  amplitude: number;
  changePct: number;
  change: number;
  turnover: number;
}

export interface TrendPoint {
  /** HH:MM */
  time: string;
  price: number;
  avgPrice: number;
  volume: number;
  amount: number;
}

export interface Trend {
  preClose: number;
  points: TrendPoint[];
}

export interface RankItem {
  code: StockCode;
  name: string;
  price: number;
  changePct: number;
  change: number;
  open: number;
  high: number;
  low: number;
  prevClose: number;
  volume: number;
  amount: number;
  amplitude: number;
  turnoverRate: number;
  pe: number;
  pb: number;
  volumeRatio: number;
  /** 亿元 */
  totalMv: number;
  /** 亿元 */
  floatMv: number;
  /** 元 */
  mainNet: number;
}

export interface FundTier {
  /** 元 */
  net: number;
  pct: number;
}

export interface FundFlow {
  code: StockCode;
  name: string;
  main: FundTier;
  superLarge: FundTier;
  large: FundTier;
  medium: FundTier;
  small: FundTier;
}

export interface WatchItem {
  code: StockCode;
  name: string;
  group: string;
}

/** 可勾选的指数 */
export interface IndexOption {
  code: StockCode;
  name: string;
}


/** 城市检索结果，坐标用来查天气 */
export interface CityOption {
  name: string;
  /** 省 / 州 */
  admin1: string;
  country: string;
  latitude: number;
  longitude: number;
}

/** 实时天气 */
export interface WeatherNow {
  /** 摄氏度 */
  temperature: number;
  /** 体感温度 */
  apparent: number;
  /** 相对湿度 % */
  humidity: number;
  /** 当前小时降水量 mm */
  precipitation: number;
  /** 风速 km/h */
  windSpeed: number;
  isDay: boolean;
  /** WMO 天气代码，中文与图标见 lib/weatherCodes.ts */
  code: number;
  /** 观测时间（当地时区，形如 2026-10-14T10:30） */
  time: string;
}

/** 一天的预报 */
export interface WeatherDay {
  /** YYYY-MM-DD */
  date: string;
  code: number;
  max: number;
  min: number;
  /** HH:MM */
  sunrise: string;
  /** HH:MM */
  sunset: string;
  /** 最大降水概率 % */
  precipitationProbability: number;
}

/** 首页天气卡片要的一整份数据 */
export interface WeatherReport {
  city: CityOption;
  /** 地理时区名，例如 Asia/Shanghai */
  timezone: string;
  now: WeatherNow;
  days: WeatherDay[];
  /** 本地抓取时间 */
  updatedAt: string;
}

// ===== 知识库 =====

/** 知识库里的一类资料：分类绑一个 agent */
export interface LibraryCategory {
  id: string;
  name: string;
  /** 绑定哪个 agent；空串表示还没绑 */
  agentId: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  /** 这一类收了多少份资料（后端顺手算好，省得前端逐个问） */
  fileCount: number;
}

/** 知识库里的一个资料文件，原样存放不改格式 */
export interface LibraryFile {
  name: string;
  ext: string;
  /** 字节 */
  size: number;
  /** 磁盘修改时间 */
  modified: string;
  /** 能不能当文本预览 */
  isText: boolean;
}

// ===== 网上冲浪 / 热榜 =====

/** 一个平台 */
export interface HotSourceInfo {
  /** 后端标识：bilibili / weibo / xueqiu / xiaohongshu */
  value: string;
  label: string;
  /** 平台主色，画色块用 */
  accent: string;
  /** 这个平台必须登录 Cookie 才拿得到数据 */
  needsCookie: boolean;
  /** 用户已经配了 Cookie 吗（不返回 Cookie 内容） */
  cookieReady: boolean;
  /** 使用应用内网页会话，登录后自动复用 */
  usesBrowser: boolean;
}

/** B 站的榜单口径 */
export interface HotKindInfo {
  value: string;
  label: string;
}

/** 榜单里的一条 */
export interface HotItem {
  /** 从 1 开始 */
  rank: number;
  title: string;
  /** 点击用系统浏览器打开 */
  url: string;
  /** 封面图，纯文字榜单为空串 */
  cover: string;
  summary: string;
  author: string;
  /** 热度展示文案，如「197.4万播放」 */
  hotText: string;
  /** 原始热度数值 */
  hotValue: number;
  /** 平台自己的标签（分区、「新 / 爆」角标） */
  tag: string;
  /** 附加信息 */
  meta: string;
}

/** 单个平台的榜单。失败时 items 为空、error 有值，页面照常显示其余平台 */
export interface HotBoard {
  source: string;
  label: string;
  accent: string;
  updatedAt: string;
  items: HotItem[];
  error?: string;
  /** 平台要 Cookie 但用户还没配 */
  needsCookie: boolean;
  /** 数据来自缓存 */
  cached: boolean;
}

// ===== 首页「价格追踪」 =====

/** 盯着的一件东西 */
export interface PriceTarget {
  id: string;
  name: string;
  /** 搜价关键词，留空就用 name */
  keyword: string;
  zhuanzhuanUrl?: string;
  note: string;
  createdAt: string;
}

/** 一条价格记录，存的是均价不是单条在售价 */
export interface PriceSample {
  id: string;
  targetId: string;
  price: number;
  /** manual = 手动记的；xianyu = 闲鱼搜的 */
  source: string;
  /** 这个均价背后统计了几条在售 */
  samples: number;
  recordedAt: string;
}

/** 按天聚合出来的一个点 */
export interface TrendPoint {
  day: string;
  avg: number;
  min: number;
  max: number;
  count: number;
}

/** 首页卡里的一行 */
export interface PriceOverview {
  target: PriceTarget;
  source: string;
  currency: string;
  latest: number | null;
  /** 最新价相对上一条的涨跌幅；只有一条记录时是 null */
  changePct: number | null;
  samples: number;
  days: number;
  /** 最近几天的均价，画迷你走势图 */
  spark: number[];
  updatedAt: string | null;
}

/** 借 App 自己的 WebView2 搜价的结果 */
export interface XianyuFetchSummary {
  ok: boolean;
  needsVerification: boolean;
  source?: string;
  currency?: string;
  sourceUrl?: string;
  query?: string;
  method?: string;
  coverage?: number;
  sources?: { id: string; name: string; url: string; status: string; message: string; count: number; median: number | null; min: number | null; max: number | null }[];
  listings?: { title: string; price: number; currency: string; url: string; source?: string; condition?: string }[];
  /** 从响应里认出几个在售价 */
  count: number;
  avg: number | null;
  min: number | null;
  max: number | null;
  ret: string;
  /** 直接显示给用户看的话，包括失败原因 */
  message: string;
}

