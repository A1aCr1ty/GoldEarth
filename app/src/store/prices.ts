import { create } from "zustand";
import { tauri } from "@/lib/tauri";
import type { PriceOverview, PriceTarget, TrendPoint, XianyuFetchSummary } from "@/types";

interface PricesState {
  items: PriceOverview[];
  loading: boolean;
  error?: string;
  /** 展开看趋势的那个物品 */
  selectedId: string | null;
  trend: TrendPoint[];
  trendLoading: boolean;
  /** 记价 / 搜价的即时反馈 */
  notice: string | null;
  results: Record<string, XianyuFetchSummary>;
  probing: boolean;
  /** 正在抓的是哪一件，列表里那行才能显示「正在搜…」 */
  probingFor: string | null;
  /** 「全部查一遍」的进度 */
  refreshingAll: boolean;
  progress: { done: number; total: number } | null;

  refresh: () => Promise<void>;
  select: (id: string | null) => Promise<void>;
  /** 只重载趋势，保留每件物品的查询结果。 */
  reloadTrend: (id: string) => Promise<void>;
  add: (input: { name: string; keyword?: string; note?: string }) => Promise<PriceTarget>;
  remove: (id: string) => Promise<void>;
  runProbe: (targetId: string) => Promise<void>;
  /** 挨个查一遍。必须串行：所有抓价共用同一扇隐藏的浏览器窗，
   *  并发会让它们互相导航，谁的结果都拿不到 */
  refreshAll: () => Promise<void>;
  showXianyu: () => Promise<void>;
  clearNotice: () => void;
}

export const usePrices = create<PricesState>((set, get) => ({
  items: [],
  loading: false,
  selectedId: null,
  trend: [],
  trendLoading: false,
  notice: null,
  results: {},
  probing: false,
  probingFor: null,
  refreshingAll: false,
  progress: null,

  async refresh() {
    set({ loading: true, error: undefined });
    try {
      const items = await tauri.priceOverview();
      set({ items, loading: false });
      // 展开的那件如果已经被删了，别把选中状态留成空壳
      const sel = get().selectedId;
      if (sel && !items.some((i) => i.target.id === sel)) {
        set({ selectedId: null, trend: [] });
      }
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  async select(id) {
    if (id === null) {
      set({ selectedId: null, trend: [], notice: null });
      return;
    }
    set({ selectedId: id, trend: [], trendLoading: true, notice: null });
    await get().reloadTrend(id);
  },

  async reloadTrend(id) {
    set({ trendLoading: true });
    try {
      const trend = await tauri.priceTrend(id, 0);
      if (get().selectedId === id) set({ trend, trendLoading: false });
    } catch (e) {
      set({ error: String(e), trendLoading: false });
    }
  },

  async add(input) {
    const t = await tauri.addPriceTarget(input);
    await get().refresh();
    // 加完直接展开，省得再点一下
    await get().select(t.id);
    return t;
  },

  async remove(id) {
    await tauri.removePriceTarget(id);
    if (get().selectedId === id) {
      set({ selectedId: null, trend: [] });
    }
    set((state) => {
      const results = { ...state.results };
      delete results[id];
      return { results };
    });
    await get().refresh();
  },

  async runProbe(targetId) {
    if (get().probing || get().refreshingAll) return;
    set({ probing: true, probingFor: targetId, notice: null });
    try {
      const probe = await tauri.fetchPublicPrice(targetId);
      set((state) => ({
        probing: false,
        probingFor: null,
        results: { ...state.results, [targetId]: probe },
      }));
      // 只有成功落库的查询才刷新历史价格和趋势。
      if (probe.ok) {
        await get().refresh();
        if (get().selectedId === targetId) await get().reloadTrend(targetId);
      }
    } catch (e) {
      set((state) => ({
        probing: false,
        probingFor: null,
        results: {
          ...state.results,
          [targetId]: { ok: false, needsVerification: false, count: 0, avg: null, min: null, max: null, ret: "", message: String(e) },
        },
      }));
    }
  },

  async refreshAll() {
    if (get().probing || get().refreshingAll) return;
    const targets = get().items;
    if (targets.length === 0) return;
    set({ refreshingAll: true, error: undefined, progress: { done: 0, total: targets.length } });
    const failed: string[] = [];
    for (const [i, row] of targets.entries()) {
      set({ probingFor: row.target.id });
      try {
        const r = await tauri.fetchPublicPrice(row.target.id);
        set((state) => ({ results: { ...state.results, [row.target.id]: r } }));
        if (!r.ok) failed.push(`${row.target.name}：${r.message.split("\n")[0]}`);
        if (r.needsVerification) {
          const remaining = targets.length - i - 1;
          if (remaining > 0) failed.push(`批量查询已暂停，另有 ${remaining} 件尚未查询`);
          break;
        }
      } catch (e) {
        set((state) => ({
          results: {
            ...state.results,
            [row.target.id]: { ok: false, needsVerification: false, count: 0, avg: null, min: null, max: null, ret: "", message: String(e) },
          },
        }));
        failed.push(`${row.target.name}：${String(e)}`);
      }
      set({ progress: { done: i + 1, total: targets.length } });
    }
    set({ refreshingAll: false, probingFor: null, progress: null });
    await get().refresh();
    const sel = get().selectedId;
    if (sel) await get().reloadTrend(sel);
    // 每件物品保留自己的结果，页头汇总本轮失败和暂停原因。
    set({
      error:
        failed.length === 0
          ? undefined
          : `查价失败：${failed.join("；")}`,
    });
  },

  async showXianyu() {
    await tauri.showXianyuWindow();
  },

  clearNotice() {
    set({ notice: null });
  },
}));
