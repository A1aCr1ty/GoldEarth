import { create } from "zustand";
import { tauri } from "@/lib/tauri";
import type { Candle, FundFlow, KlinePeriod, Quote, RankItem, RankKind, StockCode, Trend, WatchItem } from "@/types";

/** 首次进入时给一份默认自选，避免空荡荡的 */
const DEFAULT_WATCH: WatchItem[] = [
  { code: "sh600519", name: "贵州茅台", group: "" },
  { code: "sz000001", name: "平安银行", group: "" },
  { code: "sz300750", name: "宁德时代", group: "" },
  { code: "sh601318", name: "中国平安", group: "" },
  { code: "sz000858", name: "五粮液", group: "" },
];

interface StocksState {
  indices: Quote[];
  /** 自选股快照，按代码索引 */
  quotes: Record<StockCode, Quote>;
  /** 当前选中个股的完整快照（含五档） */
  detail: Quote | null;
  klines: Candle[];
  trend: Trend | null;
  flow: FundFlow | null;
  rankings: Partial<Record<RankKind, RankItem[]>>;
  watchlist: WatchItem[];
  /** 用户勾选的指数，空表示用后端默认 */
  indexCodes: string[];
  current: StockCode;
  period: KlinePeriod;
  sub: "macd" | "kdj" | "rsi";
  showBoll: boolean;
  loading: boolean;
  chartLoading: boolean;
  error?: string;

  setCurrent: (code: StockCode) => void;
  setPeriod: (period: KlinePeriod) => void;
  setSub: (sub: "macd" | "kdj" | "rsi") => void;
  toggleBoll: () => void;
  loadIndexCodes: () => Promise<void>;

  loadWatchlist: () => Promise<void>;
  addWatch: (code: string) => Promise<void>;
  removeWatch: (code: StockCode) => Promise<void>;
  refreshAll: () => Promise<void>;
  refreshQuotes: () => Promise<void>;
  refreshChart: () => Promise<void>;
  loadRankings: (kind: RankKind) => Promise<void>;
}

function errText(e: unknown): string {
  const s = String(e);
  return s.startsWith("Error:") ? s.slice(7).trim() : s;
}

export const useStocks = create<StocksState>((set, get) => ({
  indices: [],
  quotes: {},
  detail: null,
  klines: [],
  trend: null,
  flow: null,
  rankings: {},
  watchlist: [],
  indexCodes: [],
  current: "",
  period: "day",
  sub: "macd",
  showBoll: true,
  loading: false,
  chartLoading: false,

  setCurrent(code) {
    if (get().current === code) return;
    // 换股票时先清空，避免旧图短暂显示在新股票上
    set({ current: code, detail: null, klines: [], trend: null, flow: null });
    void get().refreshChart();
  },
  setPeriod(period) {
    set({ period });
    void get().refreshChart();
  },
  setSub(sub) {
    set({ sub });
  },
  toggleBoll() {
    set((s) => ({ showBoll: !s.showBoll }));
  },

  async loadIndexCodes() {
    try {
      const s = await tauri.getSettings();
      set({ indexCodes: s.indexCodes ?? [] });
    } catch {
      // 设置读不到就按后端默认走
    }
  },

  async loadWatchlist() {
    try {
      let list = await tauri.getWatchlist();
      // 空列表未必是「第一次」：可能用户自己删空的，后端会回空列表不再补默认值
      if (list.length === 0) list = await tauri.seedWatchlist(DEFAULT_WATCH);
      set({ watchlist: list });
    } catch (e) {
      set({ error: errText(e) });
    }
  },

  async addWatch(code) {
    try {
      const next = [...get().watchlist, { code: code.trim(), name: "", group: "" }];
      const saved = await tauri.saveWatchlist(next);
      set({ watchlist: saved });
      void get().refreshQuotes();
    } catch (e) {
      set({ error: errText(e) });
    }
  },

  async removeWatch(code) {
    try {
      const saved = await tauri.saveWatchlist(get().watchlist.filter((w) => w.code !== code));
      set({ watchlist: saved });
      if (get().current === code) {
        // 删掉的正好是当前标的：先清空再走 setCurrent，
        // 否则 K 线、五档、资金流这些会继续停在已删股票的数据上。
        const next = saved[0]?.code ?? "";
        set({ current: "", detail: null, klines: [], trend: null, flow: null });
        if (next) get().setCurrent(next);
      }
      void get().refreshQuotes();
    } catch (e) {
      set({ error: errText(e) });
    }
  },

  async refreshAll() {
    await Promise.all([get().loadWatchlist()]);
    set({ loading: true });
    try {
      const indices = await tauri.marketIndices();
      set({ indices, error: undefined });
    } catch (e) {
      set({ error: `指数行情获取失败：${errText(e)}` });
    }
    await get().refreshQuotes();
    set({ loading: false });
    const cur = get().current || get().watchlist[0]?.code || "";
    if (cur && cur !== get().current) set({ current: cur });
    await get().refreshChart();
    void get().loadRankings("gainers");
  },

  async refreshQuotes() {
    const codes = get().watchlist.map((w) => w.code);
    if (codes.length === 0) return;
    try {
      const list = await tauri.stockQuotes(codes);
      const map: Record<StockCode, Quote> = {};
      for (const q of list) map[q.code] = q;
      set((s) => ({ quotes: { ...s.quotes, ...map }, error: undefined }));
      // 名称回填到自选股，省得下次再查
      const named = get().watchlist.map((w) => ({ ...w, name: map[w.code]?.name || w.name }));
      if (named.some((w, i) => w.name !== get().watchlist[i]?.name)) {
        const saved = await tauri.saveWatchlist(named);
        set({ watchlist: saved });
      }
    } catch (e) {
      set({ error: `自选股行情获取失败：${errText(e)}` });
    }
  },

  async refreshChart() {
    const { current, period } = get();
    if (!current) return;
    set({ chartLoading: true });
    try {
      if (period === "minute") {
        const trend = await tauri.stockTrends(current);
        set({ trend, klines: [] });
      } else {
        const klines = await tauri.stockKline(current, period, 500);
        set({ klines, trend: null });
      }
      set({ error: undefined });
    } catch (e) {
      set({ error: `K 线获取失败：${errText(e)}` });
    }
    // 详情和资金流并发拉，不阻塞 K 线
    const code = current;
    tauri
      .stockQuote(code)
      .then((detail) => set((s) => (s.current === code ? { detail } : {})))
      .catch(() => {});
    tauri
      .stockFundFlow(code)
      .then((flow) => set((s) => (s.current === code ? { flow } : {})))
      .catch(() => {});
    set({ chartLoading: false });
  },

  async loadRankings(kind) {
    try {
      const items = await tauri.marketRankings(kind, 20);
      set((s) => ({ rankings: { ...s.rankings, [kind]: items } }));
    } catch {
      // 榜单失败不影响主流程，静默即可
    }
  },
}));