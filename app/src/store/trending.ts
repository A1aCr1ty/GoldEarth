import { create } from "zustand";
import { errText } from "@/lib/errors";
import { tauri } from "@/lib/tauri";
import type { HotBoard, HotKindInfo, HotSourceInfo } from "@/types";

/** 自动刷新间隔：3 分钟一轮，够跟得上热榜变化又不至于太吵 */
export const AUTO_REFRESH_MS = 180_000;

/** 单个平台最多渲染多少条，再多卡片就太长了 */
const PAGE_SIZE = 30;

interface TrendingState {
  /** 按平台标识索引的榜单；刷新期间保留旧数据，避免闪烁 */
  boards: Record<string, HotBoard>;
  sources: HotSourceInfo[];
  kinds: HotKindInfo[];
  /** B 站当前口径：popular / ranking */
  kind: string;
  /** 勾选要展示的平台 */
  active: string[];
  /** 每个平台各自的加载中，互不阻塞 */
  loading: Record<string, boolean>;
  autoRefresh: boolean;
  /** 上一次全部同步完成的时间 */
  lastSync: string | null;
  /** 只有一个平台失败时才提示，且提示会被下次刷新覆盖 */
  error?: string;

  init: () => Promise<void>;
  /** 不传 source 就是全平台刷新 */
  refresh: (source?: string) => Promise<void>;
  setKind: (kind: string) => void;
  toggleSource: (value: string) => void;
  setAutoRefresh: (on: boolean) => void;
  /** 保存某平台的 Cookie 并立即重刷那一张卡 */
  saveCookie: (value: string, cookie: string) => Promise<void>;
  clearCookie: (value: string) => Promise<void>;
}

const COOKIE_FIELD: Record<string, "xueqiuCookie" | "xiaohongshuCookie"> = {
  xueqiu: "xueqiuCookie",
  xiaohongshu: "xiaohongshuCookie",
};

/** 把后端回的数组并进 boards，不动其他平台的条目 */
function mergeBoards(prev: Record<string, HotBoard>, list: HotBoard[]): Record<string, HotBoard> {
  if (list.length === 0) return prev;
  const next = { ...prev };
  for (const b of list) next[b.source] = b;
  return next;
}

function markLoading(prev: Record<string, boolean>, targets: string[], value: boolean): Record<string, boolean> {
  const next = { ...prev };
  for (const t of targets) next[t] = value;
  return next;
}

export const useTrending = create<TrendingState>((set, get) => ({
  boards: {},
  sources: [],
  kinds: [],
  kind: "popular",
  active: [],
  loading: {},
  autoRefresh: true,
  lastSync: null,
  error: undefined,

  async init() {
    const { active, kind } = get();
    if (active.length > 0) {
      // 已经有数据了，直接补一次刷新即可
      await get().refresh();
      return;
    }
    try {
      const [sources, kinds] = await Promise.all([tauri.trendingSources(), tauri.trendingKinds()]);
      // 默认全选，但 Cookie 没配的平台也留着：卡片会提示怎么配，
      // 总比用户打开页面发现少两块强
      set({ sources, kinds, active: sources.map((s) => s.value) });
    } catch (e) {
      set({ error: errText(e) });
      return;
    }
    void get().refresh();
  },

  async refresh(source) {
    const { active, kind } = get();
    const targets = source ? [source] : active;
    if (targets.length === 0) return;
    // 已经在刷的别重复发，手滑连点只留最后一次
    if (!source && targets.some((t) => get().loading[t])) return;

    set((s) => ({ loading: markLoading(s.loading, targets, true) }));
    try {
      const boards = source
        ? [await tauri.trendingBoard(source, kind, PAGE_SIZE)]
        : await tauri.trendingBoards(targets, kind, PAGE_SIZE);

      set((s) => ({
        boards: mergeBoards(s.boards, boards),
        // 单个平台失败已经写进 board.error 了，这里只有整体挂掉才提示
        error: undefined,
        lastSync: new Date().toISOString(),
      }));
      // Cookie 状态可能变了（比如刚在卡片里配好），同步一下
      if (boards.some((b) => b.needsCookie)) void refreshSourceMeta();
    } catch (e) {
      set({ error: `热榜获取失败：${errText(e)}` });
    } finally {
      set((s) => ({ loading: markLoading(s.loading, targets, false) }));
    }
  },

  setKind(kind) {
    if (get().kind === kind) return;
    set({ kind });
    // 口径只影响 B 站，只重刷它，别带着其他三个平台陪跑
    void get().refresh("bilibili");
  },

  toggleSource(value) {
    set((s) => ({
      active: s.active.includes(value) ? s.active.filter((v) => v !== value) : [...s.active, value],
    }));
  },

  setAutoRefresh(on) {
    set({ autoRefresh: on });
  },

  async saveCookie(value, cookie) {
    const field = COOKIE_FIELD[value];
    if (!field) return;
    await tauri.updateSettings({ [field]: cookie } as Partial<import("@/types").AppSettings>);
    await refreshSourceMeta();
    await get().refresh(value);
  },

  async clearCookie(value) {
    const field = COOKIE_FIELD[value];
    if (!field) return;
    await tauri.updateSettings({ [field]: "" } as Partial<import("@/types").AppSettings>);
    await refreshSourceMeta();
    await get().refresh(value);
  },
}));

/** 只更新平台的 Cookie 就绪状态，不动已加载的榜单 */
async function refreshSourceMeta() {
  try {
    const sources = await tauri.trendingSources();
    useTrending.setState({ sources });
  } catch {
    // 元信息拿不到不影响已经显示的数据
  }
}
