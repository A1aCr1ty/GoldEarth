import snapshot from "@/lib/indexRuleBacktest.json";
import { evaluateClassicGridSignal, evaluateOversoldSignal } from "@/lib/indexRuleSignals";
import type { Candle, Quote } from "@/types";
import type { LocalIndexRuleResult } from "@/lib/indexRuleLocal";

type Item = {
  code: string;
  grid: { open_grids: number; latest: { date: string } };
  oversold: {
    bias_threshold: number; stop_pct: number;
    latest: { date: string; base_current_weight: number; swing_current_weight: number; swing_average_cost: number | null; entry_low: number | null; right_added: boolean };
  };
};
const items = snapshot.items as Item[];
const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

function actionClass(kind: string) {
  if (kind === "buy" || kind === "add") return "border-emerald-500/30 bg-emerald-500/5";
  if (kind === "sell") return "border-amber-500/30 bg-amber-500/5";
  if (kind === "stop") return "border-red-500/30 bg-red-500/5";
  return "bg-muted/20";
}

export function IndexRuleLiveSignals({ code, bars, quote, localResult = null }: { code: string; bars: Candle[]; quote: Quote | null; localResult?: LocalIndexRuleResult | null }) {
  const item = items.find(candidate => candidate.code === code);
  const local = item ? null : localResult;
  const completed = bars.filter(bar => bar.date < new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)).sort((a, b) => a.date.localeCompare(b.date));
  const modelDate = completed[completed.length - 1]?.date ?? "";
  const latest = item?.oversold.latest ?? local?.oversold.latest ?? { date: modelDate, base_current_weight: 0, swing_current_weight: 0, swing_average_cost: null, entry_low: null, right_added: false };
  const grid = evaluateClassicGridSignal(bars, quote, { date: item?.grid.latest.date ?? local?.grid.latest.date ?? modelDate, openGrids: item?.grid.open_grids ?? local?.grid.open_grids ?? 0 });
  const swing = evaluateOversoldSignal(bars, quote, {
    date: latest.date,
    biasThreshold: item?.oversold.bias_threshold ?? local?.oversold.bias_threshold ?? -6,
    stopPct: item?.oversold.stop_pct ?? local?.oversold.stop_pct ?? 0.06,
    baseWeight: latest.base_current_weight,
    swingWeight: latest.swing_current_weight,
    swingAverageCost: latest.swing_average_cost,
    entryLow: latest.entry_low,
    rightAdded: latest.right_added,
  });
  return <div className="rounded-lg border p-3">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><b>当前双策略操作指示</b><span className="text-muted-foreground">{item || local ? "回测模型仓位" : "新关注 · 空仓模型"} · 非实际账户 · 不自动下单</span></div>
    <div className="grid gap-3 xl:grid-cols-2">
      <div className={`rounded-md border p-3 ${grid.ready ? actionClass(grid.kind) : "bg-muted/20"}`}>
        <div className="flex flex-wrap items-center justify-between gap-2"><b>ATR 自适应网格</b>{grid.ready && <span>模型开放 {grid.openGrids}/10 格</span>}</div>
        {grid.ready ? <>
          <p className="mt-2 text-sm font-semibold">{grid.action}</p>
          <p className="mt-1 leading-5 text-muted-foreground">{grid.summary}</p>
          <p className="mt-2">边界 {grid.lower.toFixed(3)}–{grid.upper.toFixed(3)} · 步长 {pct(grid.stepPct)}<br />下一买档 {grid.nextBuy.toFixed(3)} · 下一卖档 {grid.nextSell.toFixed(3)}</p>
        </> : <p className="mt-2 leading-5 text-muted-foreground">{grid.reason}</p>}
      </div>
      <div className={`rounded-md border p-3 ${swing.ready ? actionClass(swing.kind) : "bg-muted/20"}`}>
        <div className="flex flex-wrap items-center justify-between gap-2"><b>BIAS + W&R 超跌波段</b>{swing.ready && <span>模型底仓/机动 {pct(latest.base_current_weight)} / {pct(latest.swing_current_weight)}</span>}</div>
        {swing.ready ? <>
          <p className="mt-2 text-sm font-semibold">{swing.action}</p>
          <p className="mt-1 leading-5 text-muted-foreground">{swing.summary}</p>
          <p className="mt-2">BIAS20 {swing.bias20.toFixed(2)}% · W&R14 {swing.wr14.toFixed(2)} · CMF20 {swing.cmf20.toFixed(3)}<br />MA20 {swing.ma20.toFixed(3)} · SuperTrend {Number.isFinite(swing.supertrend) ? swing.supertrend.toFixed(3) : "—"}{swing.stopPrice !== null && ` · 硬止损 ${swing.stopPrice.toFixed(3)}`}</p>
          {swing.baseAction && <p className="mt-2 rounded bg-primary/5 p-2 leading-5 text-primary">{swing.baseAction}</p>}
        </> : <p className="mt-2 leading-5 text-muted-foreground">{swing.reason}</p>}
      </div>
    </div>
  </div>;
}
