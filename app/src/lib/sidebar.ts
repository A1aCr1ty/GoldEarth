/**
 * 侧边栏的目录结构与几何规则。
 *
 * 这里刻意不 import React / lucide：图标名用字符串描述，真正的图标映射放在
 * Sidebar 组件里。这样目录结构、展开规则、宽度夹取都是可以脱离渲染层单测的纯函数。
 *
 * 目录按内容分类，支持任意层级嵌套：目录 -> 子目录 -> 页面。分组只是排版和
 * 折叠单位，路由仍然是扁平的 to 路径，所以刷新和收藏链接都不受影响。
 */

/** 图标名；Sidebar 里用同名组件渲染 */
export type SidebarIconName =
  | "dashboard" | "compass" | "tags" | "building" | "car" | "gem"
  | "trending" | "book" | "search" | "note" | "folder" | "network"
  | "bot" | "settings" | "basketball";

export interface SidebarLeaf {
  /** 叶子节点：可导航页面，to 唯一 */
  to: string;
  label: string;
  icon?: SidebarIconName;
  /** 一句话说明，折叠成图标栏时没有 tooltip 也能读懂 */
  hint?: string;
}

export interface SidebarGroup {
  id: string;
  label: string;
  icon?: SidebarIconName;
  children: SidebarNode[];
}

export type SidebarNode = SidebarLeaf | SidebarGroup;

export const isGroup = (node: SidebarNode): node is SidebarGroup =>
  Array.isArray((node as SidebarGroup).children);

/** 侧边栏目录：按内容分类，多级嵌套 */
export const NAV_TREE: SidebarGroup[] = [
  {
    id: "daily",
    label: "每日",
    icon: "compass",
    children: [
      { to: "/home", label: "天气", icon: "dashboard", hint: "天气、日历与每日推荐" },
      { to: "/explore", label: "冲浪", icon: "compass", hint: "热门社区与热榜" },
      { to: "/nba", label: "NBA", icon: "basketball", hint: "赛程、技术统计、新闻与关注球队的虎扑专区" },
      { to: "/robotics", label: "机器人推送", icon: "bot", hint: "整机、零部件、算法与系统更新，收藏整理资料" },
    ],
  },
  {
    id: "market",
    label: "市场",
    icon: "trending",
    children: [
      {
        id: "market-goods",
        label: "价格与销量",
        children: [
          { to: "/prices", label: "价格", icon: "tags", hint: "多品类商品价格追踪" },
          { to: "/housing", label: "房价趋势", icon: "building", hint: "二手房挂牌与成交趋势" },
          { to: "/cars", label: "汽车销量", icon: "car", hint: "车型月榜与车系报价" },
          { to: "/metals", label: "金属价格", icon: "gem", hint: "金银铜铝锂等期货行情" },
        ],
      },
      {
        id: "market-finance",
        label: "金融",
        children: [{ to: "/stocks", label: "股票", icon: "trending", hint: "指数、个股与 Agent 分析" }],
      },
    ],
  },
  {
    id: "library",
    label: "资料",
    icon: "book",
    children: [
      { to: "/library", label: "知识库", icon: "book", hint: "本地知识库检索与问答" },
      { to: "/files", label: "文件搜索", icon: "search", hint: "跨文件全文搜索" },
    ],
  },
  {
    id: "create",
    label: "创作",
    icon: "note",
    children: [
      { to: "/notes", label: "笔记", icon: "note", hint: "Markdown 笔记与 Agent 对话" },
      { to: "/categories", label: "分类", icon: "folder", hint: "笔记分类管理" },
      { to: "/archify", label: "Archify", icon: "network", hint: "架构图与流程图工作台" },
    ],
  },
  {
    id: "system",
    label: "系统",
    icon: "bot",
    children: [
      { to: "/agents", label: "Agent", icon: "bot", hint: "Agent 配置与调试" },
      { to: "/settings", label: "设置", icon: "settings", hint: "外观、数据与关于" },
    ],
  },
];

/** 按顺序摊平所有可导航页面，用于校验和搜索 */
export function flattenNav(tree: SidebarNode[]): SidebarLeaf[] {
  const out: SidebarLeaf[] = [];
  for (const node of tree) {
    if (isGroup(node)) out.push(...flattenNav(node.children));
    else out.push(node);
  }
  return out;
}

/** 某个路由所在的全部祖先目录 id，从外到内 */
export function ancestorsOf(tree: SidebarNode[], to: string): string[] {
  for (const node of tree) {
    if (!isGroup(node)) continue;
    if (node.children.some((child) => !isGroup(child) && child.to === to)) return [node.id];
    const nested = ancestorsOf(node.children, to);
    if (nested.length > 0) return [node.id, ...nested];
  }
  return [];
}

/** 节点最深一层里有没有命中当前路由（用于给整条祖先链高亮） */
export function containsRoute(node: SidebarNode, to: string): boolean {
  if (!isGroup(node)) return node.to === to;
  return node.children.some((child) => containsRoute(child, to));
}

/**
 * 展开状态：手动切换的结果，和「当前路由必须可见」取并集。
 * 命中的目录及其所有祖先都会展开，直接访问深层链接时不会出现空目录。
 */
export function resolveOpen(tree: SidebarNode[], to: string, manuallyOpen: string[]): Set<string> {
  const open = new Set(manuallyOpen);
  for (const id of ancestorsOf(tree, to)) open.add(id);
  return open;
}

/* 侧栏宽度：写死宽度在窄窗口下会先吃掉内容区，所以允许拖动，
   同时给出上下限，拖到两端也不会把三栏页面的内容挤没了。 */
export const SIDEBAR_MIN_WIDTH = 168;
export const SIDEBAR_MAX_WIDTH = 320;
export const SIDEBAR_DEFAULT_WIDTH = 224;
/** 折叠成图标栏时的宽度 */
export const SIDEBAR_RAIL_WIDTH = 56;
/** 键盘调整宽度的步长，与鼠标拖动一致 */
export const SIDEBAR_KEYBOARD_STEP = 16;

export function clampSidebarWidth(width: number, min = SIDEBAR_MIN_WIDTH, max = SIDEBAR_MAX_WIDTH): number {
  if (!Number.isFinite(width)) return SIDEBAR_DEFAULT_WIDTH;
  return Math.round(Math.min(max, Math.max(min, width)));
}

export const SIDEBAR_WIDTH_KEY = "goldearth.sidebar.width";
export const SIDEBAR_COLLAPSED_KEY = "goldearth.sidebar.collapsed";
export const SIDEBAR_OPEN_KEY = "goldearth.sidebar.open";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

const readJson = <T,>(storage: StorageLike | null, key: string): T | null => {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    return raw == null ? null : (JSON.parse(raw) as T);
  } catch {
    // 存储被禁用过或内容被写坏，都退回默认值，不影响启动
    return null;
  }
};

export const writeJson = (storage: StorageLike | null, key: string, value: unknown): void => {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // 写不进去（隐私模式、配额满）就只在本次会话生效
  }
};

/** 读取侧栏宽度：越界或损坏的值一律夹回合法区间 */
export function readSidebarWidth(storage: StorageLike | null): number {
  const raw = readJson<number>(storage, SIDEBAR_WIDTH_KEY);
  return typeof raw === "number" ? clampSidebarWidth(raw) : SIDEBAR_DEFAULT_WIDTH;
}

export function readSidebarCollapsed(storage: StorageLike | null): boolean {
  return readJson<boolean>(storage, SIDEBAR_COLLAPSED_KEY) === true;
}

/** 读取展开的目录 id：只保留当前目录树里仍然存在的 id */
export function readOpenGroups(storage: StorageLike | null, tree: SidebarNode[] = NAV_TREE): string[] {
  const raw = readJson<unknown[]>(storage, SIDEBAR_OPEN_KEY);
  if (!Array.isArray(raw)) return [];
  const known = new Set(groupIds(tree));
  return raw.filter((id): id is string => typeof id === "string" && known.has(id));
}

export function collectGroupIds(tree: SidebarNode[]): string[] {
  const ids: string[] = [];
  for (const node of tree) {
    if (!isGroup(node)) continue;
    ids.push(node.id, ...collectGroupIds(node.children));
  }
  return ids;
}

const groupIds = collectGroupIds;
