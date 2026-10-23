import { invoke } from "@tauri-apps/api/core";

export const ROBOT_CATEGORIES = [
  { id: "humanoid", label: "人形机器人整机", hint: "双足、全尺寸与具身平台" },
  { id: "wheeled", label: "轮式机器人整机", hint: "AMR、AGV 与轮式底盘" },
  { id: "arm", label: "机械臂", hint: "工业机械臂与操作平台" },
  { id: "cobot", label: "协作臂", hint: "人机协作与柔性作业" },
  { id: "joint", label: "关节模组", hint: "一体化关节、驱动与执行器" },
  { id: "sensor", label: "传感器", hint: "力觉、视觉、触觉与雷达" },
  { id: "algorithm", label: "算法", hint: "具身智能、操作与运动控制" },
  { id: "system", label: "系统更新", hint: "ROS 2、仿真、SDK 与软件版本" },
] as const;
export interface RobotItem {
  title: string; url: string; summary: string; category: string; source: string;
  kind: string; publishedAt: string | null;
  sourceKind?: string;
}
export interface RobotSource {
  id: string; name: string; category: string; url: string; checkedAt: string;
  fetchedAt: string | null; error: string | null; items: RobotItem[];
  kind: string;
}
export interface RobotSourceConfig { id: string; name: string; category: string; url: string; kind: "github" | "website" }
export interface RobotSourceSettings { sources: RobotSourceConfig[]; disabled: string[] }
export const robotSources = (action = "list", source?: RobotSourceConfig, id?: string) =>
  invoke<RobotSourceSettings>("robot_sources", { action, source: source ?? null, id: id ?? null });
export const DOCUMENT_KINDS = [
  ["datasheet", "参数 / 规格书"], ["manual", "用户 / 硬件手册"], ["sdk", "SDK"],
  ["api", "API / 通信协议"], ["tutorial", "教程 / 示例"], ["readme", "README"],
  ["document", "技术文档"], ["release", "版本 / 固件更新"],
  ["portal", "文档入口（需浏览器）"],
] as const;
export const documentLabel = (kind: string) => DOCUMENT_KINDS.find(([id]) => id === kind)?.[1] || (kind === "news" ? "历史资讯" : "技术文档");
export interface RobotReport { sources: RobotSource[]; warning: string | null }
export interface RobotCollection { saved: Record<string, RobotItem>; read: string[] }
export const categoryLabel = (id: string) => ROBOT_CATEGORIES.find(c => c.id === id)?.label || id;
export const loadRobotFeed = (force = false) => invoke<RobotReport>("robot_feed", { force });
/** Repair old X2 relative-link caches without changing saved/read identities. */
export function robotDocumentUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.protocol === "https:" && url.hostname === "x2-aimdk.agibot.com" &&
      !/^\/(?:en|zh|zh_CN|zh-cn)\//i.test(url.pathname) && /\.html$/i.test(url.pathname)) {
      url.pathname = `/en/latest${url.pathname}`;
      return url.href;
    }
  } catch { /* Preserve unknown URLs. */ }
  return raw;
}
export const robotCollection = (action = "list", item?: RobotItem, url?: string) =>
  invoke<RobotCollection>("robot_collection", { action, item: item ?? null, url: url ?? null });

/** Older caches used the encoded URL basename as the title. Decode that exact
 * fallback once; leave authored titles and the actual download URL untouched. */
export function normalizeRobotItem(item: RobotItem): RobotItem {
  try {
    const filename = new URL(item.url).pathname.split("/").pop() || "";
    if (item.title.trim() !== filename || !/%[0-9a-f]{2}/i.test(filename)) return item;
    const title = decodeURIComponent(filename);
    if (/[\u0000-\u001f\u007f]/.test(title)) return item;
    return { ...item, title };
  } catch { return item; }
}

const ROBOT_COMPANIES = [
  { name: "宇树", evidence: /宇树|unitree/i, models: /(?:^|[^a-z0-9])(H1[-_ ]?2|G1[-_ ]?D|H1|G1|R1|Go2|B2|Z1)(?=$|[^a-z0-9])/gi },
  { name: "智元", evidence: /智元|agibot/i, models: /(?:^|[^a-z0-9])(X2)(?=$|[^a-z0-9])/gi },
  { name: "逐际动力", evidence: /逐际|limx/i, models: /(?:^|[^a-z0-9])(TRON[-_ ]?[12]|Luna|Oli)(?=$|[^a-z0-9])/gi },
  { name: "松灵", evidence: /松灵|agilex/i, models: /(?:^|[^a-z0-9])(SCOUT(?:[-_ ]?(?:MINI|2\.0))?|RANGER(?:[-_ ]?(?:MINI|AIR))?|HUNTER(?:[-_ ]?(?:SE|2\.0))?|BUNKER(?:[-_ ]?(?:MINI|PRO))?|TRACER(?:[-_ ]?2\.0)?|PIPER|ALOHA)(?=$|[^a-z0-9])/gi },
  { name: "越疆", evidence: /越疆|dobot/i, models: /(?:^|[^a-z0-9])(MG400|M1[-_ ]?Pro|CR\d+(?:A|H)?|Nova(?:[-_ ]?\d+)?|Magician[-_ ]?E6)(?=$|[^a-z0-9])/gi },
  { name: "UFACTORY", evidence: /UFACTORY|xarm-developer/i, models: /(?:^|[^a-z0-9])(xArm(?:[-_ ]?[567])?|Lite[-_ ]?6|850)(?=$|[^a-z0-9])/gi },
  { name: "灵足时代", evidence: /灵足|robstride/i, models: /(?:^|[^a-z0-9])(RobStride[-_ ]?\d{2})(?=$|[^a-z0-9])/gi },
  { name: "MyActuator", evidence: /myactuator/i, models: /(?:^|[^a-z0-9])(RMD[-_ ]?[XLH](?:[-_ ]?\d+[a-z0-9-]*)?)(?=$|[^a-z0-9])/gi },
  { name: "览沃 Livox", evidence: /览沃|livox/i, models: /(?:^|[^a-z0-9])(LVX2|LVX|MID[-_ ]?360[LS]?|MID[-_ ]?70|MID[-_ ]?40|AVIA(?:[-_ ]?2)?|HAP|TELE[-_ ]?15)(?=$|[^a-z0-9])/gi },
  { name: "奥比中光", evidence: /奥比中光|orbbec/i, models: /(?:^|[^a-z0-9])(Gemini(?:[-_ ]?(?:\d+[a-z]*|Pro))?|Femto[-_ ]?(?:Bolt|Mega)|Astra(?:[-_ ]?2)?|DaBai(?:[-_ ]?Pro)?)(?=$|[^a-z0-9])/gi },
] as const;
const REPO_TOPICS: Record<string, string> = {
  "unitreerobotics/unitree_sdk2": "机器人 SDK2",
  "unitreerobotics/unitree_rl_gym": "强化学习与运动控制",
  "unitreerobotics/unitree_ros2": "ROS 2 系统适配",
  "agilexrobotics/ugv_sdk": "移动底盘 SDK",
  "xarm-developer/xarm-python-sdk": "机械臂 Python SDK",
  "dobot-arm/tcp-ip-python-v4": "协作臂 TCP/IP Python SDK V4",
  "livox-sdk/livox-sdk2": "激光雷达 SDK2",
  "orbbec/orbbecsdk": "深度视觉 SDK",
};
const TOPIC_FALLBACKS: Record<string, string> = {
  humanoid: "人形机器人资料", wheeled: "轮式机器人资料", arm: "机械臂资料", cobot: "协作臂资料",
  joint: "关节模组资料", sensor: "传感器资料", algorithm: "机器人算法", system: "机器人系统",
};
function headingModels(text: string, pattern: RegExp): string[] {
  const found = new Set<string>();
  return [...text.matchAll(new RegExp(pattern.source, "gi"))].map(match => {
    const model = match[1].replace(/_/g, "-");
    if (/^(?:H1(?:[- ]?2)?|G1(?:[- ]?D)?|R1|B2|Z1|LVX2?|MID[- ]?\d+[a-z]*|HAP|MG400|CR\d+[a-z]?)$/i.test(model)) return model.toUpperCase();
    return model;
  }).filter(model => {
    const key = model.toLowerCase(); if (found.has(key)) return false; found.add(key); return true;
  });
}

/** A display heading only: original titles, source URLs and saved identities stay intact. */
export function robotHeading(rawItem: RobotItem): { company: string; subject: string; detail: string; title: string } {
  const item = normalizeRobotItem(rawItem);
  let host = "", repo = "", path = "";
  try {
    const url = new URL(item.url); host = url.hostname;
    repo = host === "github.com" ? url.pathname.split("/").slice(1, 3).join("/").toLowerCase() : "";
    const documentPath = repo ? url.pathname.split("/").slice(5).join("/") : url.pathname;
    try { path = decodeURIComponent(documentPath); } catch { path = documentPath; }
  } catch { /* Keep usable source/title information when a cached URL is malformed. */ }
  const evidence = `${item.source} ${host} ${repo.split("/")[0] || ""}`;
  const companyInfo = ROBOT_COMPANIES.find(company => company.evidence.test(evidence));
  const company = companyInfo?.name || `来源：${item.source.trim() || host || "未标注"}`;
  // Model names must occur in this document's title or URL. Site-wide summaries
  // often contain many unrelated product names, so they are not model evidence.
  const documentTitle = repo && item.title.startsWith(`${item.source} · `) ? item.title.slice(item.source.length + 3) : item.title;
  const modelText = `${documentTitle} ${path}`;
  const models = companyInfo ? headingModels(modelText, companyInfo.models).slice(0, 3) : [];
  let subject = models.join(" / ") || REPO_TOPICS[repo] || "";
  if (!subject && companyInfo) {
    // A source dedicated to one named model can provide missing context for a
    // generic "Specifications" page, without guessing from a multi-model index.
    const sourceModels = headingModels(item.source, companyInfo.models);
    if (sourceModels.length === 1) subject = sourceModels[0];
  }
  if (!subject) subject = TOPIC_FALLBACKS[item.category] || "技术资料";
  const details: Record<string, string> = {
    datasheet: "参数规格", manual: "使用手册", sdk: "SDK 开发资料", api: "API / 通信协议",
    tutorial: "教程与示例", readme: "项目说明 README", document: "技术文档",
    release: "版本更新", portal: "文档中心入口", news: "行业资讯",
  };
  let detail = details[item.kind] || "技术文档";
  if (item.kind === "manual" && /hardware|硬件/i.test(item.title)) detail = "硬件手册";
  if (item.kind === "manual" && /user|用户/i.test(item.title)) detail = "用户手册";
  if (item.kind === "document" && /(?:setup|install|安装|配置)/i.test(item.title)) detail = "安装配置文档";
  if (item.kind === "release") {
    const version = item.title.match(/\bv\d+(?:\.\d+)+(?:[-+][\w.-]+)?/i)?.[0];
    if (version) detail += ` ${version}`;
  }
  return { company, subject, detail, title: `${company}｜${subject}｜${detail}` };
}

export function feedItems(report: RobotReport | null): RobotItem[] {
  const unique = new Map<string, RobotItem>();
  for (const source of report?.sources || []) {
    for (const item of source.items) {
      // Keep a multi-topic article available under each relevant category.
      unique.set(`${item.category}:${item.url}`, normalizeRobotItem(item));
    }
  }
  return [...unique.values()];
}
export function filterRobotItems(items: RobotItem[], options: {
  category: string; subscribed: string[]; query: string; view: string; read: string[]; days: number; kind?: string; sourceKind?: string;
}, now = Date.now()): RobotItem[] {
  const words = options.query.toLowerCase().split(/\s+/).filter(Boolean);
  const read = new Set(options.read);
  const unique = new Set<string>();
  return items.map(normalizeRobotItem).filter(item => {
    if (options.view !== "saved" && !options.subscribed.includes(item.category)) return false;
    if (options.category !== "all" && item.category !== options.category) return false;
    if (options.kind && options.kind !== "all" && item.kind !== options.kind) return false;
    if (options.sourceKind && options.sourceKind !== "all" && item.sourceKind !== options.sourceKind) return false;
    if (options.view === "unread" && read.has(item.url)) return false;
    if (options.days && (!item.publishedAt || Date.parse(item.publishedAt) < now - options.days * 86400000 || !Number.isFinite(Date.parse(item.publishedAt)))) return false;
    const text = `${robotHeading(item).title} ${item.title} ${item.summary} ${item.source} ${categoryLabel(item.category)} ${documentLabel(item.kind)}`.toLowerCase();
    if (!words.every(word => text.includes(word)) || unique.has(item.url)) return false;
    unique.add(item.url);
    return true;
  }).sort((a, b) => {
    const rank = (item: RobotItem) => item.kind === "datasheet" ? 0 : ["manual", "sdk", "api", "readme", "document", "tutorial"].includes(item.kind) ? 1 : 2;
    return rank(a) - rank(b) || (Date.parse(b.publishedAt || "") || 0) - (Date.parse(a.publishedAt || "") || 0);
  });
}
const markdownText = (text: string) => text.replace(/[\\`*_{}\[\]<>#]/g, "\\$&");
export function robotMarkdown(items: RobotItem[]): string {
  return `# 机器人资料摘录\n\n整理时间：${new Date().toLocaleString("zh-CN")}\n\n以下为来源提供的标题与摘要，完整内容见原文。\n\n` + items.map(normalizeRobotItem).map(item =>
    `## ${markdownText(robotHeading(item).title)}\n\n- 原始标题：${markdownText(item.title)}\n- 分类：${categoryLabel(item.category)}\n- 资料类型：${documentLabel(item.kind)}\n- 来源：${markdownText(item.source)}\n- 发布时间：${item.publishedAt || "来源未提供"}\n- 原文：<${robotDocumentUrl(item.url).replace(/[<>\r\n]/g, "")}>\n\n${markdownText(item.summary || "来源未提供摘要")}\n`
  ).join("\n---\n\n");
}
