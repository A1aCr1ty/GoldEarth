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
  probe: XianyuFetchSummary | null;
  probing: boolean;
  probeTargetId: string | null;
  /** 正在抓的是哪一件，列表里那行才能显示「正在搜…」 */
  probingFor: string | null;
  /** 「全部查一遍」的进度 */
  refreshingAll: boolean;
  progress: { done: number; total: number } | null;

  refresh: () => Promise<void>;
  select: (id: string | null) => Promise<void>;
  /** 只重载趋势，不碰 probe / notice —— 抓价成功后刷新曲线要用它，
   *  走 select() 的话会把刚显示出来的抓价结果一起清掉（踩过） */
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
  probe: null,
  probing: false,
  probeTargetId: null,
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
      set({ selectedId: null, trend: [], probe: null, notice: null });
      return;
    }
    set({ selectedId: id, trend: [], probe: null, trendLoading: true, notice: null });
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
      set({ selectedId: null, trend: [], probe: null });
    }
    await get().refresh();
  },

  async runProbe(targetId) {
    if (get().probing || get().refreshingAll) return;
    set({ probing: true, probingFor: targetId, probeTargetId: targetId, probe: null, notice: null });
    try {
      const probe = await tauri.fetchXianyuPrice(targetId);
      set({ probing: false, probingFor: null, probe });
      // 抓到了就刷新列表和趋势，均价已经落库了。
      // 这里必须走 reloadTrend 而不是 select()：select() 会把 probe 清掉，
      // 结果框刚显示就被抹掉，看起来像「点了没反应」
      if (probe.ok) {
        await get().refresh();
        if (get().selectedId === targetId) await get().reloadTrend(targetId);
      }
    } catch (e) {
      set({
        probing: false,
        probingFor: null,
        probe: { ok: false, count: 0, avg: null, min: null, max: null, ret: "", message: String(e) },
      });
    }
  },

  async refreshAll() {
    if (get().probing || get().refreshingAll) return;
    const targets = get().items;
    if (targets.length === 0) return;
    set({ refreshingAll: true, probe: null, error: undefined, progress: { done: 0, total: targets.length } });
    const failed: string[] = [];
    for (const [i, row] of targets.entries()) {
      set({ probingFor: row.target.id });
      try {
        const r = await tauri.fetchXianyuPrice(row.target.id);
        if (!r.ok) failed.push(`${row.target.name}：${r.message.split("\n")[0]}`);
      } catch (e) {
        failed.push(`${row.target.name}：${String(e)}`);
      }
      set({ progress: { done: i + 1, total: targets.length } });
    }
    set({ refreshingAll: false, probingFor: null, progress: null });
    await get().refresh();
    const sel = get().selectedId;
    if (sel) await get().reloadTrend(sel);
    // 失败的单独说一句：全查一遍时只有最后一件事的结果留在详情页里，
    // 中间几件失败就悄悄过去了，用户会以为全都成功了
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
