import { useEffect, useMemo, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { accountQuoteCode, type AccountMarketPosition } from "@/lib/stockAccountMarket";
import { positionMarketValue, sumPositionValues } from "@/lib/stockAccountImport";
import { holdingValueAction } from "@/lib/holdingValueAction";
import { chinaDate } from "@/lib/stockQuant";
import { valueModelName, type Evaluation, type ValuePrediction } from "./ProfitEvaluation";

type HoldingEvaluation = Pick<Evaluation, "run_id" | "horizon" | "chosen" | "chosen_qualified" | "predictions" | "latest_market_date">;
type RankedPrediction = ValuePrediction & { rank: number };
const impactLabels = { trend: "均线", momentum: "动量", oscillators: "MACD / KDJ", volume: "成交量", risk: "波动与回撤" } as const;
const percent = (value: number) => `${(value * 100).toFixed(2)}%`;
const money = (value: number) => value.toLocaleString("zh-CN", { style: "currency", currency: "CNY" });
const levelPrice = (value: number) => `${value.toFixed(3)} 元`;

function HoldingPriceLevels({ prediction, marketDate }: {
  prediction: RankedPrediction; marketDate?: string;
}) {
  const levels = prediction.analysis?.levels;
  if (!levels) return <p className="text-muted-foreground">这版研究结果没有可核对的价位，更新研究结果后再计算。</p>;
  const { reference_close, ma120_next, momentum126_next, macd_next } = levels;
  const weakPrice = Math.min(ma120_next, momentum126_next);
  const strongPrice = Math.max(ma120_next, momentum126_next, macd_next);
  return <div className="space-y-2 rounded-md border bg-muted/20 p-3">
    <p className="font-semibold">操作观察价（前复权）</p>
    <p className="text-muted-foreground">以 {prediction.asof} 收盘 {levelPrice(reference_close)} 为基准，计算下一交易日的收盘临界价。</p>
    <dl className="grid gap-2 sm:grid-cols-3">
      <div><dt className="font-medium">120 日均线</dt><dd>高于 {levelPrice(ma120_next)} 则站上</dd></div>
      <div><dt className="font-medium">半年动量</dt><dd>高于 {levelPrice(momentum126_next)} 则转正</dd></div>
      <div><dt className="font-medium">MACD 柱</dt><dd>{macd_next > 0 ? `高于 ${levelPrice(macd_next)} 则转正` : "正价区间内为正"}</dd></div>
    </dl>
    <p><b>减仓复核价</b> · 收盘低于 {levelPrice(weakPrice)} 时，均线与半年动量同时偏弱。下次复核排名仍在后 20% 时，再评估减仓。</p>
    <p><b>加仓观察价</b> · 收盘高于 {levelPrice(strongPrice)} 时，三项价格条件同时满足。仍需核对前 20% 排名、财报、公告和仓位预算。</p>
    <p className="text-muted-foreground">{marketDate && marketDate > prediction.asof ? "已有较新的市场日线，更新评分后再以新价位复核。" : "日线更新后重新计算价位。"} 前复权价用于看盘复核，委托价格以券商行情为准。</p>
  </div>;
}

function HoldingAnalysis({ holding, prediction, total, marketSize, isReturnModel, cap, modelFresh, sameDayQuotes, marketDate }: {
  holding: AccountMarketPosition; prediction?: RankedPrediction; total: number | null; marketSize: number; isReturnModel: boolean;
  cap: number | null; modelFresh: boolean; sameDayQuotes: boolean; marketDate?: string;
}) {
  const value = positionMarketValue(holding);
  const weight = total !== null && total > 0 && value !== null ? value / total : null;
  const relativeRank = prediction ? prediction.rank / marketSize : null;
  const band = relativeRank === null ? "暂无模型覆盖" : relativeRank <= 0.2 ? "相对排名靠前" : relativeRank > 0.8 ? "相对排名靠后" : "相对排名居中";
  const analysis = prediction?.analysis;
  const m = analysis?.metrics;
  const impacts = analysis ? Object.entries(impactLabels)
    .map(([key, label]) => ({ label, change: analysis.impacts[key as keyof typeof impactLabels] }))
    .filter(item => Number.isFinite(item.change) && Math.abs(item.change) > 0.000001) : [];
  const support = impacts.filter(item => item.change > 0).sort((a, b) => b.change - a.change);
  const drag = impacts.filter(item => item.change < 0).sort((a, b) => a.change - b.change);
  const formatImpact = (change: number) => `${change > 0 ? "+" : ""}${isReturnModel ? `${(change * 100).toFixed(2)} 个百分点` : `${change.toFixed(4)} 分`}`;
  const describe = (items: typeof impacts) => items.length ? items.map(item => `${item.label} ${formatImpact(item.change)}`).join("、") : "无明显影响";
  const plan = holdingValueAction({ holding, total, cap, rank: relativeRank, metrics: m, modelFresh, sameDayQuotes });

  return <details className="rounded-md border px-3 py-2 text-sm">
    <summary className="cursor-pointer">
      <span className="font-medium">{holding.name}</span> · {band}
      <span className="font-medium"> · {plan.action}</span>
      {support[0] && <span className="text-muted-foreground"> · 主要支撑 {support[0].label}</span>}
      {drag[0] && <span className="text-muted-foreground"> · 主要拖累 {drag[0].label}</span>}
    </summary>
    <div className="mt-2 space-y-2 text-xs leading-relaxed">
      <p><b>账户持仓</b> · {holding.quantity.toLocaleString("zh-CN")} 股 · 每股成本 {holding.cost == null ? "未知" : money(holding.cost)} · 估算盈亏 {holding.profit == null ? "未知" : money(holding.profit)} · 持仓市值占比 {weight === null ? "待估值" : percent(weight)}</p>
      {m && <>
        <dl className="grid gap-2 sm:grid-cols-2">
          <div><dt className="font-medium">120 日均线偏离 {percent(m.ma120)}</dt><dd>60、120、250 日均线观察不同长度的趋势。{m.ma120 < 0 ? "收盘在 120 日均线下方，复核能否收复。" : m.ma120 > 0 ? "收盘在 120 日均线上方，跟踪回调时能否守住。" : "收盘接近 120 日均线，观察后续方向。"}</dd></div>
          <div><dt className="font-medium">半年动量 {percent(m.momentum126)}</dt><dd>动量衡量过去 63、126、252 个交易日的涨跌幅。当前半年动量{m.momentum126 > 0 ? "为正，观察中期涨势能否延续。" : m.momentum126 < 0 ? "为负，复核前期弱势是否缓解。" : "接近中性。"}</dd></div>
          <div><dt className="font-medium">归一化 MACD 柱 {percent(m.macd_hist)}</dt><dd>快慢均线差反映趋势，柱值反映该差值与其信号线的距离。{m.macd_hist < 0 ? "当前偏弱，观察负柱是否收窄。" : m.macd_hist > 0 ? "当前偏强，观察正柱是否缩短。" : "当前接近中性。"}</dd></div>
          <div><dt className="font-medium">KDJ 的 K 值 {m.kdj_k.toFixed(2)}</dt><dd>K 越高，近期价格越靠近区间上端。D 对 K 再做平滑，J 放大 K 与 D 的差异。极端值可在趋势中持续。</dd></div>
          <div><dt className="font-medium">成交量 {m.volume_ratio.toFixed(2)} 倍</dt><dd>相对 20 日均量，超过 1 倍表示成交较活跃。结合当天涨跌判断是放量上涨还是放量下跌。</dd></div>
          <div><dt className="font-medium">年化波动 {percent(m.volatility63)} · 高点回落 {percent(-m.drawdown252)}</dt><dd>波动率用近 63 日衡量价格起伏，高点回落衡量距 252 日最高收盘价的跌幅。两项都可用于核对持仓风险。</dd></div>
        </dl>
        <p><b>评分支撑</b> · {describe(support)}</p>
        <p><b>评分拖累</b> · {describe(drag)}</p>
      </>}
      {prediction && !analysis && <p className="text-muted-foreground">这一版只有排名。生成带指标影响的研究结果后，这里会显示评分依据。</p>}
      <p><b>操作建议</b> · {plan.action}。{plan.reason}</p>
      {prediction && <HoldingPriceLevels prediction={prediction} marketDate={marketDate} />}
    </div>
  </details>;
}

function modelCode(code: string) {
  const symbol = accountQuoteCode(code);
  if (!symbol || symbol.startsWith("bj")) return null;
  const digits = symbol.slice(2);
  return accountQuoteCode(digits) === symbol ? digits : null;
}

export function HoldingValuePanel({ positions, accountId }: { positions: AccountMarketPosition[]; accountId: string }) {
  const [result, setResult] = useState<HoldingEvaluation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const capKey = `holdingValue.stockCap.${accountId}`;
  const [capText, setCapText] = useState(() => localStorage.getItem(capKey) ?? "");
  const holdings = positions.filter(position => position.quantity > 0);
  const enabled = holdings.length > 0 && isTauri();

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let pending = false;
    async function refresh() {
      if (pending) return;
      pending = true;
      try {
        const { evaluation } = await invoke<{ evaluation: HoldingEvaluation | null }>("value_research_status");
        if (active) {
          setResult(evaluation);
          setError(false);
        }
      } catch {
        if (active) setError(true);
      } finally {
        pending = false;
        if (active) setLoading(false);
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [enabled]);

  const { asof, ranks } = useMemo(() => {
    const predictions = (result?.predictions ?? []).filter(row =>
      /^\d{6}$/.test(row.code) && /^\d{4}-\d{2}-\d{2}$/.test(row.asof) && Number.isFinite(row.score));
    const asof = predictions.reduce((latest, row) => row.asof > latest ? row.asof : latest, "");
    const current = new Map(predictions.filter(row => row.asof === asof).map(row => [row.code, row]));
    const ordered = [...current.values()].sort((a, b) => b.score - a.score);
    const ranks = new Map<string, RankedPrediction>();
    let rank = 0;
    ordered.forEach((row, index) => {
      if (row.score !== ordered[index - 1]?.score) rank = index + 1;
      ranks.set(row.code, { ...row, rank });
    });
    return { asof, ranks };
  }, [result]);

  if (!holdings.length) return null;
  const rows = holdings.map(holding => ({ holding, prediction: ranks.get(modelCode(holding.code) ?? "") }));
  const covered = rows.filter(row => row.prediction).length;
  const total = sumPositionValues(holdings, positionMarketValue);
  const today = chinaDate();
  const ageDays = (Date.parse(today) - Date.parse(asof)) / 86400000;
  const capPercent = Number(capText);
  const cap = capPercent > 0 && capPercent < 100 ? capPercent / 100 : null;
  const quoteDate = today.replace(/-/g, "");
  const sameDayQuotes = holdings.every(holding => holding.priceSource === "market" &&
    holding.quoteTime?.replace(/-/g, "").startsWith(quoteDate));
  const modelFresh = !error && Boolean(result?.chosen_qualified) && ageDays >= 0 && ageDays <= 7;
  const isReturnModel = result?.chosen === "ridge" || result?.chosen === "ridge_risk";

  return <Card>
    <CardHeader>
      <CardTitle>持仓长期模型</CardTitle>
      <CardDescription>{result
        ? `${result.horizon} 个交易日 · ${valueModelName(result.chosen)} · 覆盖 ${covered} / ${rows.length} 只持仓`
        : "按当前账户持仓匹配最近一次长期研究结果"}</CardDescription>
    </CardHeader>
    <CardContent className="space-y-3">
      {!enabled && <p className="text-sm text-muted-foreground">请在 GoldEarth 桌面端查看本机模型结果。</p>}
      {enabled && loading && <p role="status" className="text-sm text-muted-foreground">正在读取模型结果…</p>}
      {error && <p role="status" className="text-sm text-destructive">{result ? "暂时无法更新，当前显示上次读取的结果。" : "暂时无法读取长期研究结果。"}</p>}
      {enabled && !loading && !error && !ranks.size && <p className="text-sm text-muted-foreground">暂无评分。完成「长期研究」的滚动训练与盈利评估后，结果会自动显示在这里。</p>}
      {asof && <div className="space-y-2">
        <p className="text-xs text-muted-foreground">评分数据截至 {asof} · {ageDays > 7 ? "距今超过 7 天，请更新研究结果 · " : ""}{result?.chosen_qualified ? "研究候选" : "仅供诊断，开发期门槛未通过"}</p>
        {result?.latest_market_date && result.latest_market_date > asof && <p className="text-xs text-muted-foreground">{result.latest_market_date} 的行情覆盖较少，评分沿用最近覆盖充分的交易日。</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted-foreground"><tr><th className="py-2">持仓</th><th className="py-2 text-right">{isReturnModel ? "预测超额收益" : "模型评分"}</th><th className="py-2 text-right">全样本排名</th></tr></thead>
            <tbody>{rows.map(({ holding, prediction }) => <tr key={holding.code} className="border-t">
              <td className="py-2">{holding.name} <span className="text-xs text-muted-foreground">{holding.code}</span></td>
              <td className="py-2 text-right tabular-nums">{prediction
                ? isReturnModel ? `${(prediction.score * 100).toFixed(2)}%` : prediction.score.toFixed(4)
                : "未覆盖"}</td>
              <td className="py-2 text-right tabular-nums">{prediction ? `${prediction.rank.toLocaleString("zh-CN")} / ${ranks.size.toLocaleString("zh-CN")}` : "—"}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">{isReturnModel ? "超额收益以沪深 300 为参照。" : "分数越高，模型对该股票的相对排序越靠前。"} 排名范围为同日有评分的全部股票。评分随最新研究结果更新。</p>
        <details className="text-xs text-muted-foreground"><summary>实验版本</summary><p className="mt-1 break-all">{result?.run_id}</p></details>
      </div>}
      <div className="space-y-2">
        <h3 className="text-sm font-medium">逐只持仓分析</h3>
        <label className="flex flex-wrap items-center gap-2 text-xs">单股占股票市值上限（%）
          <input type="number" min="0.01" max="99.99" step="any" className="w-24 rounded border bg-background px-2 py-1" placeholder="可选"
            value={capText} onChange={event => { setCapText(event.target.value); localStorage.setItem(capKey, event.target.value); }} />
        </label>
        {capText && cap === null && <p className="text-xs text-destructive">请输入大于 0 且小于 100 的比例。</p>}
        {cap !== null && !sameDayQuotes && <p className="text-xs text-muted-foreground">等待全部持仓的当日报价后计算超限减仓参考。</p>}
        {rows.map(({ holding, prediction }) => <HoldingAnalysis key={holding.code} holding={holding} prediction={prediction}
          total={total} marketSize={ranks.size} isReturnModel={isReturnModel} cap={cap} modelFresh={modelFresh} sameDayQuotes={sameDayQuotes}
          marketDate={result?.latest_market_date} />)}
        <p className="text-xs text-muted-foreground">操作建议为基于指标和账户约束的复核规则。股数仅供参考，委托前以券商当时的可卖数量及申报规则为准。指标影响来自 ONNX 与当日中位数的对照，组间影响不可相加。财报尚未进入当前模型。</p>
      </div>
    </CardContent>
  </Card>;
}
