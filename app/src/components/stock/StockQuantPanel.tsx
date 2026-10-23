import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { tauri } from "@/lib/tauri";
import { useStocks } from "@/store/stocks";
import { chinaDate, evaluateProfit, evaluateQuant, QUANT_SOURCES, type ProfitMode } from "@/lib/stockQuant";
import type { Candle, Quote } from "@/types";
import { TradePlan } from "./TradePlan";

export function StockQuantPanel() {
  const code = useStocks(s => s.current);
  return code ? <QuantForStock key={code} code={code} /> : <p className="p-3 text-xs text-muted-foreground">请先选择股票。</p>;
}

function QuantForStock({ code }: { code: string }) {
  const [data, setData] = useState<{ bars: Candle[]; quote: Quote } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [cost, setCost] = useState("");
  const [mode, setMode] = useState<ProfitMode>("normal");
  useEffect(() => {
    let alive = true;
    setLoading(true); setError(""); setData(null);
    Promise.all([tauri.stockKline(code, "day", 500), tauri.stockQuote(code)])
      .then(([bars, quote]) => { if (alive) setData({ bars, quote }); })
      .catch(e => { if (alive) setError(String(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [code, revision]);
  const result = data ? evaluateQuant(data.bars) : null;
  const time = data?.quote.time ?? "";
  const quoteDate = /^\d{14}$/.test(time) ? `${time.slice(0,4)}-${time.slice(4,6)}-${time.slice(6,8)}` : "";
  const age = (Date.parse(chinaDate()) - Date.parse(quoteDate)) / 86400000;
  const quoteUsable = data?.quote.code === code && age >= 0 && age <= 7;
  const profit = quoteUsable && data ? evaluateProfit(data.quote.price, Number(cost), mode) : null;
  const n = (v: number) => v.toFixed(2);
  return <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3 text-xs">
    <div className="flex items-center justify-between gap-2"><div><h3 className="font-semibold">量化评价 · {code}</h3><p className="mt-1 text-muted-foreground">量价评分 + 常士杉视频止盈参考</p></div><Button size="sm" variant="outline" disabled={loading} onClick={() => setRevision(v => v + 1)}>刷新</Button></div>
    {loading && <p role="status">正在读取独立日 K 与报价…</p>}
    {error && <p role="alert" className="text-destructive">读取失败：{error}</p>}
    {result && !result.ready && <p className="rounded border p-2 text-muted-foreground">{result.reason}</p>}
    {result?.ready && <>
      <section className="space-y-2 rounded-lg border bg-muted/30 p-3"><div className="flex items-end justify-between"><strong className="text-lg">{result.score}<span className="text-xs font-normal text-muted-foreground"> / 100</span></strong><span className="font-medium">{result.action}</span></div><p>{result.advice}</p><p className="text-[11px] text-muted-foreground">截至 {result.date} · 前复权日 K · 始终排除当日 K 线。评分为规则符合度，不是上涨概率。</p></section>
      <div className="grid grid-cols-2 gap-2 text-[11px]">{[["收盘",result.close],["MA5",result.ma5],["MA20",result.ma20],["MA60",result.ma60],["20日量比",result.volumeRatio],["MA20乖离 %",result.bias]].map(([label,value]) => <div key={label} className="rounded border p-2"><span className="text-muted-foreground">{label}</span><strong className="ml-2">{n(Number(value))}</strong></div>)}</div>
      <details className="space-y-2"><summary className="cursor-pointer font-medium">查看评分规则与依据</summary><p className="text-muted-foreground">以下权重与阈值是本应用基础模型，未归属于常士杉，尚未回测验证。</p>{result.factors.map(f => <div key={f.label} className="space-y-1 border-b py-2"><div>{f.pass ? "✓" : "—"} {f.label} · {f.pass ? f.weight : 0}/{f.weight}</div><p className="text-muted-foreground">{f.rule}</p></div>)}<p>买入候选需要五项全部满足；收盘价和 MA5 都低于 MA20 时提示减仓观察。</p></details>
    </>}
    {result?.ready && <section className="space-y-2 rounded border p-3"><h4 className="font-semibold">星球五日战法 · 技术条件</h4><p>{result.close>result.ma5?'✓':'—'} 收盘站上MA5 · {result.threeVolume?'✓':'—'} 连续三日增量 · {result.giantVolume?'✓':'—'} 七日内1.45倍量</p><p>{result.fiveExit?'已触发MA5下方7.5%的减仓条件':result.fiveEntry?'入场技术条件满足，仍需价格、基本面及仓位审核':'入场条件尚未齐备'}</p><p className="text-muted-foreground">连续增量是对原文“逐日放大或保持活跃”的保守实现；巨量按前日成交量解释，原文均量口径仍有歧义。不能据此断言主力行为。</p></section>}
    <TradePlan quant={result} price={data?.quote.price??0} cost={Number(cost)} fresh={!!quoteUsable && age<=1} />
    <section className="space-y-3 rounded-lg border p-3"><h4 className="font-semibold">3221 分阶段止盈</h4><p className="text-muted-foreground">按你输入的实际持仓成本计算，独立于量价评分。尚未达到止盈区不代表可以买入。</p>
      <label className="block space-y-1"><span>每股持仓成本（元，含费用）</span><input aria-label="每股持仓成本" type="number" min="0.0001" step="any" value={cost} onChange={e => setCost(e.target.value)} className="w-full rounded border bg-background px-2 py-1.5" placeholder="输入当前实际成本" /></label>
      <label className="block space-y-1"><span>市场环境（自行判断）</span><select aria-label="止盈市场环境" value={mode} onChange={e => setMode(e.target.value as ProfitMode)} className="w-full rounded border bg-background px-2 py-1.5"><option value="normal">一般 / 震荡 / 弱势</option><option value="strong">强势牛市</option></select></label>
      {data && <p className="text-muted-foreground">报价 {n(data.quote.price)} 元 · {quoteDate || "时间未知"} {time.slice(8,10)}:{time.slice(10,12)}（未复权快照）</p>}
      {data && !quoteUsable && <p>报价时间过旧、未知或代码不匹配，暂停止盈计算。</p>}
      {cost && !(Number(cost) > 0 && Number.isFinite(Number(cost))) && <p>请输入大于零的有效持仓成本。</p>}
      {profit && <div className="space-y-2"><strong>相对成本收益 {n(profit.profit)}%</strong><p>{profit.advice}</p></div>}
      <p className="text-[11px] text-muted-foreground">视频未明确各次减仓比例按原始还是剩余仓位计算；这里只提示阶段，不计算下单股数。请结合已完成的减仓记录，避免重复减仓。除权、分红后请更新成本。</p>
    </section>
    <details className="space-y-2" open><summary className="cursor-pointer font-medium">视频出处与核实范围</summary>{QUANT_SOURCES.map(s => <div key={s.url} className="space-y-1 py-1"><button className="text-left text-primary hover:underline" onClick={() => { void tauri.openReader(s.url,s.title).catch(e => setError(String(e))); }}>{s.title} ↗</button><p className="text-[11px] text-muted-foreground">{s.status}</p></div>)}<p className="text-[11px] text-muted-foreground">来源：杉门tepu大弟子（直播切片整理账号）。自动字幕可能有误；已排除不明确或主题不符的规则。</p></details>
    <p className="border-t pt-3 text-[11px] text-muted-foreground">仅作研究与交易计划参考，不自动下单。未纳入基本面、行业比较与交易成本回测；执行前需核对实时价格、停牌、涨跌停和可卖数量。数据仅在进入此面板或点击刷新时更新。</p>
  </div>;
}
