import { invoke } from "@tauri-apps/api/core";
export type Domain = "cars" | "metals";
export interface TrackerQuery { domain: Domain; subject: string; month: string; segment: string }
export interface TrackerSubject { id: string; name: string; category: string }
export interface TrackerPoint { date: string; value: number; url: string }
export interface TrackerSeries { id: string; subject: string; name: string; basis: string; unit: string; frequency: "daily" | "monthly"; points: TrackerPoint[] }
export interface TrackerReport { query: TrackerQuery; fetchedAt: string; subjects: TrackerSubject[]; series: TrackerSeries[]; sources: { name: string; url: string; status: string; message: string }[]; notes: string[] }
export interface TrackerWatch { query: TrackerQuery; name: string }
export interface TrackerObservation { id: string; domain: Domain; subject: string; name: string; basis: string; unit: string; date: string; value: number; url: string }
export interface TrackerSaved { watches: TrackerWatch[]; observations: TrackerObservation[] }
export const tracker = {
  bootstrap: () => invoke<TrackerSaved>("tracker_bootstrap"),
  report: (query: TrackerQuery, force = false) => invoke<TrackerReport>("tracker_report", { query, force }),
  mutate: (action: string, data: { watch?: TrackerWatch; observation?: TrackerObservation; id?: string }) => invoke<TrackerSaved>("tracker_mutate", { action, watch: null, observation: null, id: null, ...data }),
};
export const METALS: TrackerSubject[] = [["AU0", "黄金", "贵金属"], ["AG0", "白银", "贵金属"], ["CU0", "铜", "工业金属"], ["AL0", "铝", "工业金属"], ["LC0", "锂 · 碳酸锂", "能源金属"], ["APT", "钨 · 仲钨酸铵", "小金属"], ["ZN0", "锌", "工业金属"], ["PB0", "铅", "工业金属"], ["NI0", "镍", "工业金属"], ["SN0", "锡", "工业金属"]].map(([id, name, category]) => ({ id, name, category }));
export function dateKey(date: string): number { const parts = date.split("-").map(Number); return parts.length >= 2 && parts[1] >= 1 && parts[1] <= 12 ? parts[0] * 12 + parts[1] - 1 : NaN; }
export function trackerWindow(series: TrackerSeries, months: number, endMonth?: string): TrackerPoint[] {
  const points = series.points.filter(p => Number.isFinite(p.value) && p.value >= 0 && /^\d{4}-\d{2}(-\d{2})?$/.test(p.date)).sort((a, b) => a.date.localeCompare(b.date));
  const end = dateKey(series.frequency === "monthly" && endMonth ? endMonth : points.at(-1)?.date ?? ""); return points.filter(p => dateKey(p.date) > end - months && dateKey(p.date) <= end);
}
export function trackerAxis(series: TrackerSeries, months: number, endMonth?: string) {
  const points = trackerWindow(series, months, endMonth), map = new Map(points.map(p => [p.date, p.value]));
  const labels: string[] = [], values: (number | null)[] = [];
  const last = series.frequency === "monthly" && endMonth ? endMonth : points.at(-1)?.date;
  if (!last) return { labels, values };
  if (series.frequency === "monthly") {
    const end = dateKey(last);
    for (let i = end - months + 1; i <= end; i++) { const date = `${Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, "0")}`; labels.push(date); values.push(map.get(date) ?? null); }
  } else if (points[0]) {
    const cursor = new Date(`${points[0].date}T00:00:00Z`), end = new Date(`${last}T00:00:00Z`);
    while (cursor <= end && labels.length < 5000) { const date = cursor.toISOString().slice(0, 10); labels.push(date); values.push(map.get(date) ?? null); cursor.setUTCDate(cursor.getUTCDate() + 1); }
  }
  return { labels, values };
}
export function trackerStats(series: TrackerSeries, months = 12, endMonth?: string) {
  const points = trackerWindow(series, months, endMonth), last = points.at(-1), first = points[0];
  const change = (p: TrackerPoint | undefined) => last && p && p.value > 0 ? (last.value / p.value - 1) * 100 : null;
  const prev = series.frequency === "monthly" ? series.points.find(p => dateKey(p.date) === dateKey(last?.date ?? "") - 1) : points.at(-2);
  const previousYear = last ? `${Number(last.date.slice(0, 4)) - 1}${last.date.slice(4)}` : "";
  let peak = first?.value ?? 0, drawdown = 0;
  for (const p of points) { peak = Math.max(peak, p.value); if (peak > 0) drawdown = Math.min(drawdown, (p.value / peak - 1) * 100); }
  const gaps = series.frequency === "monthly" ? endMonth ? months - points.length : first && last ? dateKey(last.date) - dateKey(first.date) + 1 - points.length : 0 : null;
  return { points, first, last, previous: prev, latestChange: change(prev), yoy: change(series.points.find(p => p.date === previousYear)), periodChange: points.length >= 2 ? change(first) : null, drawdown: points.length >= 2 ? drawdown : null, high: points.length ? Math.max(...points.map(p => p.value)) : null, low: points.length ? Math.min(...points.map(p => p.value)) : null, gaps };
}
export function trackerInsights(series: TrackerSeries, months: number, endMonth?: string): string[] {
  const s = trackerStats(series, months, endMonth); if (!s.last) return ["暂无可用于分析的数据，请刷新来源或补充带出处的报价记录。"];
  const notes = [`最新数据日期 ${s.last.date}，共 ${s.points.length} 个样本，单位 ${series.unit}；统计仅基于「${series.basis}」。`];
  if (s.latestChange != null) notes.push(`${series.frequency === "monthly" ? "环比" : `较上一有效观测（${s.previous?.date}）`} ${s.latestChange.toFixed(2)}%。${s.latestChange > 0 ? "最新观测走高。" : s.latestChange < 0 ? "最新观测回落。" : "最新观测持平。"}`);
  if (s.periodChange != null) notes.push(`${s.first?.date} 至 ${s.last.date} 的区间变化 ${s.periodChange.toFixed(2)}%，观测最大回撤 ${s.drawdown?.toFixed(2)}%。`);
  if (s.gaps) notes.push(`区间缺少 ${s.gaps} 个销量月份，缺失不补零；环比与同比只比较准确的日历月份。`);
  if (s.points.length < 6) notes.push("样本较少，尚不足以判断持续趋势；价格快照从首次获取开始积累。");
  if (series.id.startsWith("sales-")) notes.push("车型换代、交付节奏、渠道库存及促销可能影响销量，需要额外证据核验；榜单未覆盖车型不能视为零销量。");
  else if (series.id.startsWith("price-")) notes.push("车系报价范围可能随年款、配置调整而变化，上下限变动不能直接解释为同款车型降价。");
  else if (series.id.startsWith("futures-")) notes.push("连续合约存在换月与基差影响，不能直接等同现货涨跌；供需、库存、汇率和宏观因素需另行核查。");
  else if (series.id.startsWith("APT-")) notes.push("APT议价范围并非统一成交均价；报道缺失及产品规格差异会限制趋势判断。");
  else notes.push("手动记录未自动核验真实性；请保持同城市、配置或纯度、交货条件和报价来源的一致口径。");
  return notes;
}
