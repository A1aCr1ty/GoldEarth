import { create } from "zustand";
import { errText } from "@/lib/errors";
import { tauri } from "@/lib/tauri";
import type { AppSettings, HotBoard, HotKindInfo, HotSourceInfo } from "@/types";

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
  /** 是否已经读过一次设置。用它区分「还没初始化」和「用户主动全取消了」，
   *  后者不能在下一次进页面时被重置回全选 */
  ready: boolean;
  /** 只有一个平台失败时才提示，且提示会被下次刷新覆盖 */
  error?: string;

  init: () => Promise<void>;
  /**
   * 不传 source 就是全平台刷新。
   *
   * `force` 默认 **true**：用户点了刷新就该真的重新抓一遍，不能拿
   * 90 秒前的缓存交差（后端也有同一条防线）。只有页面首屏载入传 false，
   * 让来回切页时能吃到缓存、少打一轮接口。
   */
  refresh: (source?: string, force?: boolean) => Promise<void>;
  setKind: (kind: string) => void;
  toggleSource: (value: string) => void;
  setAutoRefresh: (on: boolean) => void;
  /** 保存某平台的 Cookie 并立即重刷那一张卡 */
  saveCookie: (value: string, cookie: string) => Promise<void>;
  clearCookie: (value: string) => Promise<void>;
}

/** 平台 → settings.json 里的 Cookie 字段。
 *  雪球（WAF）和小红书（x-s 签名）都已从后端清单下线，这里保留映射：
 *  哪天恢复，`Source::all()` 加回去就能直接用，Cookie 框和保存逻辑都不用再改 */
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
  ready: false,
  error: undefined,

  async init() {
    // 只认第一次读设置：用户把平台全取消后再切走又切回来，
    // 不该被当成「还没初始化」而重置成全选
    if (get().ready) {
      await get().refresh();
      return;
    }
    try {
      const [sources, kinds, settings] = await Promise.all([
        tauri.trendingSources(),
        tauri.trendingKinds(),
        tauri.getSettings(),
      ]);
      // exploreSources 为 null 表示从没配过 → 默认全选；
      // 空数组是用户的主动选择，照着空着
      const wanted = settings.exploreSources ?? sources.map((s) => s.value);
      set({
        sources,
        kinds,
        // 后端已经把认识的平台规范化过了，这里再按当前清单滤一道
        active: wanted.filter((v) => sources.some((s) => s.value === v)),
        autoRefresh: settings.exploreAutoRefresh ?? true,
        ready: true,
      });
    } catch (e) {
      // 这次不算初始化完成，下次进页面还能重试
      set({ error: errText(e) });
      return;
    }
    // 首屏用缓存：来回切页时不必重复打一轮接口，数据也就 90 秒内的
    void get().refresh(undefined, false);
  },

  async refresh(source, force = true) {
    const { active, kind } = get();
    const targets = source ? [source] : active;
    if (targets.length === 0) return;
    // 已经在刷的别重复发，手滑连点只留最后一次。
    // 单卡刷新也守这条：force 开着的时候连点就是连着打接口
    if (targets.some((t) => get().loading[t])) return;

    set((s) => ({ loading: markLoading(s.loading, targets, true) }));
    try {
      const boards = source
        ? [await tauri.trendingBoard(source, kind, PAGE_SIZE, force)]
        : await tauri.trendingBoards(targets, kind, PAGE_SIZE, force);

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
    const current = get().active;
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    set({ active: next });
    // 勾选写进 settings.json，下次进来还是这一批平台
    void persist({ exploreSources: next });
  },

  setAutoRefresh(on) {
    set({ autoRefresh: on });
    void persist({ exploreAutoRefresh: on });
  },

  async saveCookie(value, cookie) {
    const field = COOKIE_FIELD[value];
    if (!field) return;
    await tauri.updateSettings({ [field]: cookie } as Partial<AppSettings>);
    await refreshSourceMeta();
    await get().refresh(value);
  },

  async clearCookie(value) {
    const field = COOKIE_FIELD[value];
    if (!field) return;
    await tauri.updateSettings({ [field]: "" } as Partial<AppSettings>);
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

/** 顺手把界面上的选择落盘。写不进去也不打断当前会话——界面上的效果已经生效了 */
async function persist(patch: Partial<AppSettings>) {
  try {
    await tauri.updateSettings(patch);
  } catch {
    // 落盘失败只在下次进页面时才会暴露，这里不弹窗打断操作
  }
}
