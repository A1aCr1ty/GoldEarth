import { invoke } from "@tauri-apps/api/core";
export interface HousingCity { id: string; name: string }
export interface Community { id: string; name: string }
export interface HousingQuery { city: string; kind: "all" | "new" | "second"; community: Community | null }
export interface HousingPoint { month: string; value: number; mom: number | null; yoy: number | null; anchorMonth?: string | null }
export interface HousingSeries { id: string; name: string; kind: string; basis: string; unit: string; sourceUrl: string; points: HousingPoint[] }
export interface HousingSource { name: string; url: string; status: string; message: string }
export interface HousingReport { query: HousingQuery; cityName: string; fetchedAt: string; series: HousingSeries[]; sources: HousingSource[]; communities: Community[]; links: { title: string; url: string; snippet: string }[] }
export interface HousingWatch { id: string; query: HousingQuery }
export interface HousingObservation { id: string; city: string; communityId: string | null; communityName?: string | null; kind: string; basis: string; month: string; price: number; sourceUrl: string }
export interface HousingSaved { watches: HousingWatch[]; observations: HousingObservation[] }
export const housing = {
  bootstrap: () => invoke<{ cities: HousingCity[]; saved: HousingSaved }>("housing_bootstrap"),
  report: (query: HousingQuery, force = false) => invoke<HousingReport>("housing_report", { query, force }),
  communities: (city: string, keyword: string) => invoke<Community[]>("housing_communities", { city, keyword }),
  watch: (query: HousingQuery) => invoke<HousingWatch[]>("housing_watch", { query }),
  remove: (id: string, observation = false) => invoke<HousingSaved>("housing_remove", { id, observation }),
  observe: (query: HousingQuery, observation: HousingObservation) => invoke<HousingSaved>("housing_observe", { query, observation }),
  sourceOpen: (query: HousingQuery, year: number) => invoke<void>("housing_source_open", { query, year }),
  sourceRead: (query: HousingQuery, year: number) => invoke<HousingReport>("housing_source_read", { query, year }),
};

export function monthIndex(month: string): number {
  if (!/^\d{4}-\d{2}$/.test(month)) return NaN;
  const [y, m] = month.split("-").map(Number);
  return m >= 1 && m <= 12 ? y * 12 + m - 1 : NaN;
}
export function pct(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}
export function windowPoints(series: HousingSeries, months: number): HousingPoint[] {
  const points = series.points.filter(p => Number.isFinite(monthIndex(p.month)) && Number.isFinite(p.value) && p.value > 0).sort((a, b) => a.month.localeCompare(b.month));
  const cutoff = monthIndex(points[points.length - 1]?.month ?? "") - months + 1;
  return points.filter(p => monthIndex(p.month) >= cutoff);
}
export function analyzeHousing(series: HousingSeries, months = 12) {
  const points = windowPoints(series, months);
  const latest = points[points.length - 1];
  const all = series.points;
  const findBack = (n: number) => latest ? all.find(p => monthIndex(p.month) === monthIndex(latest.month) - n && p.value > 0) : undefined;
  const comparable = points.filter(p => !latest?.anchorMonth || p.anchorMonth === latest.anchorMonth);
  const change = (p: HousingPoint | undefined) => latest && p && (!latest.anchorMonth || p.anchorMonth === latest.anchorMonth) ? (latest.value / p.value - 1) * 100 : null;
  const mom = latest?.mom ?? change(findBack(1));
  const yoy = latest?.yoy ?? change(findBack(12));
  const changes: number[] = [];
  let peak = comparable[0]?.value ?? 0, drawdown = 0;
  comparable.forEach(p => { peak = Math.max(peak, p.value); if (peak > 0) drawdown = Math.min(drawdown, (p.value / peak - 1) * 100); });
  points.forEach((p, i) => {
    if (i && monthIndex(p.month) - monthIndex(points[i - 1].month) === 1 && p.anchorMonth === points[i - 1].anchorMonth) changes.push((p.value / points[i - 1].value - 1) * 100);
  });
  const mean = changes.length ? changes.reduce((a, b) => a + b, 0) / changes.length : null;
  const volatility = changes.length >= 3 && mean != null ? Math.sqrt(changes.reduce((s, c) => s + (c - mean) ** 2, 0) / changes.length) : null;
  const gaps = latest ? monthIndex(latest.month) - monthIndex(points[0].month) + 1 - points.length : 0;
  const periodChange = comparable.length >= 2 && latest ? (latest.value / comparable[0].value - 1) * 100 : null;
  const insights: string[] = [];
  if (!latest) insights.push("没有同口径数据，无法计算价格变化。可刷新来源或补充带来源的月度记录。");
  else {
    insights.push(`最新样本为 ${latest.month}，口径为「${series.basis}」。${series.unit === "元/㎡" ? "平台或手动单价不能直接视为成交均价。" : "该序列按连续月度环比链式计算，每段首期归一为100，不表示每平方米价格。"}`);
    insights.push(mom == null ? "缺少相邻月份数据，环比留空；没有用跨月变化代替环比。" : `最新月度变动 ${pct(mom)}${mom > 0 ? "，本月较上月走高" : mom < 0 ? "，本月较上月回落" : "，本月与上月持平"}。`);
    if (periodChange != null) insights.push(`${comparable[0].month} 至 ${latest.month} 的区间变化为 ${pct(periodChange)}，观测最大回撤 ${pct(drawdown)}；仅反映该来源与该口径。`);
    if (latest.anchorMonth && comparable.length !== points.length) insights.push("指数存在不同基期的连续片段，累计变动与回撤仅计算末段；不同片段不比较价格高低。");
    if (gaps) insights.push(`区间缺少 ${gaps} 个月，图表保留断点，波动统计只采用相邻月。`);
    if (points.length < 6) insights.push(`目前只有 ${points.length} 个有效月份，长期趋势依据不足。`);
    if (series.id.startsWith("manual:")) insights.push("这是用户手动录入的记录，未自动核验成交真实性或样本代表性。");
    insights.push("均价变化可能来自在售房源结构、面积和板块变化；还需结合成交量、去化周期、同户型实际成交及政策核对原因，不能据此确定未来涨跌。");
  }
  return { points, latest, mom, yoy, periodChange, drawdown: comparable.length >= 2 ? drawdown : null, volatility, gaps, insights };
}
export function mortgage(total: number, downPercent: number, annualRate: number, years: number) {
  if (![total, downPercent, annualRate, years].every(Number.isFinite) || total <= 0 || downPercent < 0 || downPercent > 100 || annualRate < 0 || years < 1 || years > 50) return null;
  const principal = total * (1 - downPercent / 100), n = years * 12, r = annualRate / 1200;
  const payment = r === 0 ? principal / n : principal * r / (1 - (1 + r) ** -n);
  return { down: total - principal, principal, payment, interest: payment * n - principal };
}
export function housingContext(report: HousingReport, series: HousingSeries | undefined, months: number): string {
  return JSON.stringify({ scope: { city: report.cityName, community: report.query.community?.name ?? "全市", kind: report.query.kind }, retrievedAt: report.fetchedAt, sources: report.sources, selectedSeries: series ? { ...series, points: windowPoints(series, months) } : null, analysis: series ? analyzeHousing(series, months) : null, otherSeries: report.series.filter(s => s.id !== series?.id).slice(0, 6).map(s => ({ ...s, points: windowPoints(s, months) })), relatedArticles: report.links.slice(0, 6) }, null, 2);
}
