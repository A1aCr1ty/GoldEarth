import { useEffect, useMemo, useState } from "react";
import { ExternalLink, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StockSearch } from "@/components/stock/StockSearch";
import { tauri } from "@/lib/tauri";
import { amountText, fixed, signed } from "@/lib/format";
import { chinaDate, evaluateQuant } from "@/lib/stockQuant";
import { strategyAdvice } from "@/lib/strategyAdvice";
import type { StrategySnapshot } from "@/lib/strategyPlatform";
import {
  analyzeFundamentals,
  combineOperationAdvice,
  latestFinancialReport,
  valuationObservations,
} from "@/lib/fundamental";
import { useStocks } from "@/store/stocks";
import type { Candle, FinancialReports, Quote } from "@/types";
import { institutionalSources, researchChecklist } from '@/lib/institutionalResearch';

interface LoadedData {
  financial: FinancialReports | null;
  quote: Quote | null;
  bars: Candle[];
  strategy: StrategySnapshot | null;
}

export function StockFundamentalPanel({ onAskAgent }: { onAskAgent: () => void }) {
  const current = useStocks(state => state.current);
  const watchlist = useStocks(state => state.watchlist);
  const setCurrent = useStocks(state => state.setCurrent);
  const addWatch = useStocks(state => state.addWatch);
  const [data, setData] = useState<LoadedData>({ financial: null, quote: null, bars: [], strategy: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [quantityText, setQuantityText] = useState("0");

  useEffect(() => {
    let alive = true;
    if (!current) {
      setData({ financial: null, quote: null, bars: [], strategy: null });
      setError("");
      return;
    }
    setLoading(true);
    setError("");
    setData({ financial: null, quote: null, bars: [], strategy: null });
    void Promise.allSettled([
      tauri.stockFinancialReports(current, revision > 0),
      tauri.stockQuote(current),
      tauri.stockKline(current, "day", 500),
      tauri.strategySnapshot(),
    ]).then(([financial, quote, bars, strategy]) => {
      if (!alive) return;
      const next: LoadedData = {
        financial: financial.status === "fulfilled" ? financial.value : null,
        quote: quote.status === "fulfilled" ? quote.value : null,
        bars: bars.status === "fulfilled" ? bars.value : [],
        strategy: strategy.status === "fulfilled" ? strategy.value : null,
      };
      setData(next);
      const errors: string[] = [];
      if (financial.status === "rejected") errors.push(`财报：${String(financial.reason)}`);
      if (quote.status === "rejected") errors.push(`行情：${String(quote.reason)}`);
      if (bars.status === "rejected") errors.push(`日 K：${String(bars.reason)}`);
      if (strategy.status === "rejected") errors.push(`复盘模型：${String(strategy.reason)}`);
      setError(errors.join("；"));
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [current, revision]);

  const latest = useMemo(() => latestFinancialReport(data.financial), [data.financial]);
  const analysis = useMemo(() => latest ? analyzeFundamentals(latest) : null, [latest]);
  const quant = useMemo(() => data.bars.length ? evaluateQuant(data.bars) : null, [data.bars]);
  const quantity = Number(quantityText);
  const validQuantity = Number.isInteger(quantity) && quantity >= 0;
  const model = useMemo(() => data.strategy && validQuantity
    ? strategyAdvice(data.strategy, current, quantity, chinaDate())
    : null, [data.strategy, current, quantity, validQuantity]);
  const quoteDate = data.quote && /^\d{14}$/.test(data.quote.time)
    ? `${data.quote.time.slice(0, 4)}-${data.quote.time.slice(4, 6)}-${data.quote.time.slice(6, 8)}`
    : "";
  const quoteAge = quoteDate ? (Date.parse(chinaDate()) - Date.parse(quoteDate)) / 86400000 : Infinity;
  const quoteFresh = data.quote?.code === current && quoteAge >= 0 && quoteAge <= 7;
  const advice = useMemo(() => combineOperationAdvice({ fundamental: analysis, quant, model,
    quantity: validQuantity ? quantity : 0, quoteFresh }), [analysis, quant, model, quantity, validQuantity, quoteFresh]);

  async function open(url: string, title: string) {
    try { await tauri.openReader(url, title); } catch (e) { setError(`打开来源失败：${String(e)}`); }
  }

  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2">
      <select aria-label="财报分析股票" value={current} onChange={event => setCurrent(event.target.value)}
        className="h-8 min-w-40 rounded-md border bg-background px-2 text-xs">
        <option value="">选择股票</option>
        {watchlist.map(item => <option key={item.code} value={item.code}>{item.name || item.code} · {item.code.slice(2)}</option>)}
      </select>
      <div className="w-56 [&>div]:border-0 [&>div]:p-0"><StockSearch items={watchlist} onAdd={async stock => {
        const added = await addWatch(stock.code, stock.name);
        if (added) setCurrent(stock.code);
        return added;
      }} /></div>
      <Button size="sm" variant="outline" disabled={!current || loading} onClick={() => setRevision(value => value + 1)}>
        <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />刷新财报
      </Button>
      {data.financial && <>
        <Button size="sm" variant="ghost" onClick={() => void open(data.financial!.reportUrl, `${data.financial!.name} 定期报告公告`)}>
          <ExternalLink className="h-3.5 w-3.5" />原始公告
        </Button>
        <Button size="sm" disabled={!analysis} onClick={onAskAgent}><Sparkles className="h-3.5 w-3.5" />Agent 综合解读</Button>
      </>}
      {data.financial && <span className="ml-auto text-[0.6875rem] text-muted-foreground">更新于 {formatTime(data.financial.updatedAt)}</span>}
    </div>

    <div className="min-h-0 flex-1 overflow-y-auto p-4 text-xs">
      {!current && <Empty text="请先选择或添加一只股票。" />}
      {current && loading && !data.financial && <Empty text="正在获取定期报告、实时估值和模型数据…" />}
      {error && <div role="alert" className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive">{error}</div>}
      {data.financial?.warning && <div className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2">{data.financial.warning}</div>}
      {current && !loading && !data.financial && !error && <Empty text="没有取得可用财报，请稍后重试。" />}
      {data.financial && !latest && <Empty text="报告缺少有效报告期，或公告日期尚未到达，暂不用于分析。" />}

      {data.financial && analysis && <div className="mx-auto max-w-[90rem] space-y-4">
        <section className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
          <div className="rounded-lg border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><h2 className="text-base font-semibold">{data.financial.name} · 基本面分析</h2>
                <p className="mt-1 text-muted-foreground">{analysis.report.reportDateName || analysis.report.reportDate} · 公告日 {analysis.report.noticeDate || "暂无"} · {analysis.report.orgType || "企业类型未知"}</p></div>
              <div className="text-right"><div className="text-2xl font-semibold">{analysis.score ?? "--"}<span className="text-xs font-normal text-muted-foreground"> / 100</span></div>
                <div className="font-medium">{analysis.rating} · 指标覆盖 {analysis.coverage}%</div></div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
              <Metric label="营业总收入" value={amountText(analysis.report.revenue)} note={`累计同比 ${signed(analysis.report.revenueYoy)}`} />
              <Metric label="归母净利润" value={amountText(analysis.report.netProfit)} note={`累计同比 ${signed(analysis.report.netProfitYoy)}`} />
              <Metric label="扣非净利润" value={amountText(analysis.report.deductedNetProfit)} note={`累计同比 ${signed(analysis.report.deductedNetProfitYoy)}`} />
              <Metric label="经营现金流" value={amountText(analysis.report.operatingCashFlow)} note={finiteText(analysis.cashToProfit, "现金 / 归母净利")} />
              <Metric label="基本每股收益" value={numberText(analysis.report.eps, " 元")} note={`每股净资产 ${numberText(analysis.report.bps, " 元")}`} />
              <Metric label="加权 ROE" value={numberText(analysis.report.roeWeighted, "%")} note={finiteText(analysis.annualizedRoe, "简单年化", "%")} />
              <Metric label="毛利率 / 净利率" value={`${numberText(analysis.report.grossMargin, "%")} / ${numberText(analysis.report.netMargin, "%")}`} note="报告期累计口径" />
              <Metric label="资产负债率" value={numberText(analysis.report.debtRatio, "%")} note={analysis.financialInstitution ? "金融行业不按通用阈值评分" : `流动比率 ${numberText(analysis.report.currentRatio)}`} />
            </div>
            <p className="mt-3 text-[0.6875rem] text-muted-foreground">单季度营收同比 {signed(analysis.report.quarterRevenueYoy)} · 单季度归母净利润同比 {signed(analysis.report.quarterNetProfitYoy)}。累计指标与单季度指标不可混用。</p>
          </div>

          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between gap-3"><h3 className="font-semibold">模型综合操作建议</h3><span className="rounded bg-secondary px-2 py-1 font-semibold">{advice.action}</span></div>
            <p className="mt-3 leading-5">{advice.summary}</p>
            <label className="mt-3 flex items-center gap-2"><span className="shrink-0 text-muted-foreground">当前持仓（股）</span>
              <Input aria-label="财报建议当前持仓" type="number" min="0" step="1" value={quantityText} onChange={event => setQuantityText(event.target.value)} className="h-7 w-28 text-xs" />
              <span className="text-[0.6875rem] text-muted-foreground">仅用于区分有无持仓</span></label>
            {!validQuantity && <p className="mt-1 text-destructive">请输入大于等于 0 的整数；无效输入按未持仓处理，且不读取复盘模型信号。</p>}
            <ul className="mt-3 space-y-1.5 text-[0.6875rem] text-muted-foreground">{advice.reasons.map(reason => <li key={reason}>· {reason}</li>)}</ul>
            <p className="mt-3 border-t pt-2 text-[0.6875rem] text-muted-foreground">不自动下单、不计算买卖数量。财报分数不是上涨概率，模型候选也须经过仓位和止损审核。</p>
          </div>
        </section>

        <section className="rounded-lg border bg-card p-4">
          <h3 className="font-semibold">机构研究方法 · 3—12个月投资价值</h3>
          <p className="mt-1 text-muted-foreground">借鉴公开研究的分析结构。下方数值来自公司财报；资料入口并不代表这些机构已对当前股票给出观点。</p>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">{researchChecklist(analysis).map(item => <div key={item.title} className="rounded border p-3"><h4 className="font-medium">{item.title}</h4><p className="mt-2 leading-5">{item.evidence}</p><p className="mt-1 leading-5 text-muted-foreground">{item.next}</p></div>)}</div>
          <details className="mt-3"><summary className="cursor-pointer">机构资料与核验范围</summary>{institutionalSources.map(source => <div key={source.url} className="mt-3 border-t pt-2"><button className="text-left underline" onClick={() => void open(source.url, source.title)}>{source.institution} · {source.title}</button><p className="mt-1 text-muted-foreground">{source.published ? `发布 ${source.published}` : '动态资料入口'} · 核验 {source.reviewed} · {source.access} · {source.kind}</p><p className="mt-1">{source.lesson}</p></div>)}</details>
        </section>
        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border bg-card p-4"><h3 className="font-semibold">关键优势</h3>
            {analysis.strengths.length ? <ul className="mt-2 space-y-2 leading-5">{analysis.strengths.map(item => <li key={item}>· {item}</li>)}</ul> : <p className="mt-2 text-muted-foreground">当前没有达到规则阈值的明显优势。</p>}</div>
          <div className="rounded-lg border bg-card p-4"><h3 className="font-semibold">风险与待核查项</h3>
            {analysis.risks.length ? <ul className="mt-2 space-y-2 leading-5">{analysis.risks.map(item => <li key={item}>· {item}</li>)}</ul> : <p className="mt-2 text-muted-foreground">未触发通用规则风险阈值，不代表没有经营、行业或估值风险。</p>}
            <div className="mt-3 border-t pt-2 text-muted-foreground">{valuationObservations(data.quote).map(item => <p key={item} className="mt-1">{item}</p>)}</div></div>
        </section>

        <section className="overflow-hidden rounded-lg border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3"><div><h3 className="font-semibold">历史定期报告主要指标</h3><p className="mt-1 text-[0.6875rem] text-muted-foreground">金额按人民币元换算为万 / 亿；利润与现金流均为年初至报告期累计值。</p></div>
            <button className="inline-flex items-center gap-1 text-primary hover:underline" onClick={() => void open(data.financial!.sourceUrl, `${data.financial!.name} 财务数据来源`)}>查看数据来源 <ExternalLink className="h-3 w-3" /></button></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[76rem] border-collapse text-right text-[0.6875rem]">
            <thead className="bg-muted/50 text-muted-foreground"><tr>{["报告期", "营业总收入", "营收同比", "归母净利润", "净利同比", "扣非净利润", "经营现金流", "EPS(元)", "ROE", "毛利率", "净利率", "资产负债率"].map(label => <th key={label} className="whitespace-nowrap px-3 py-2 font-medium first:text-left">{label}</th>)}</tr></thead>
            <tbody>{data.financial.reports.map(report => <tr key={report.reportDate} className={`border-t ${report.reportDate === analysis.report.reportDate ? "bg-accent/40" : ""}`}>
              <td className="whitespace-nowrap px-3 py-2 text-left"><div className="font-medium">{report.reportDateName || report.reportDate}</div><div className="text-muted-foreground">公告 {report.noticeDate || "--"}</div></td>
              <Cell value={amountText(report.revenue)} /><Cell value={signed(report.revenueYoy)} tone={report.revenueYoy} />
              <Cell value={amountText(report.netProfit)} /><Cell value={signed(report.netProfitYoy)} tone={report.netProfitYoy} />
              <Cell value={amountText(report.deductedNetProfit)} /><Cell value={amountText(report.operatingCashFlow)} />
              <Cell value={fixed(report.eps)} /><Cell value={numberText(report.roeWeighted, "%")} /><Cell value={numberText(report.grossMargin, "%")} />
              <Cell value={numberText(report.netMargin, "%")} /><Cell value={numberText(report.debtRatio, "%")} />
            </tr>)}</tbody>
          </table></div>
        </section>

        <section className="rounded-lg border bg-card p-4"><h3 className="font-semibold">评分规则与实际结果</h3><p className="mt-1 text-muted-foreground">得分按可用指标权重归一化；可用权重不足 50% 时不评分。简单年化 ROE 只用于初筛，未考虑季节性。</p>
          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{analysis.factors.map(item => <div key={item.key} className="rounded border p-3">
            <div className="flex items-center justify-between gap-2"><span className="font-medium">{item.label}</span><span>{item.earned === null ? "不计分" : `${item.earned} / ${item.weight}`}</span></div>
            <p className="mt-1">{item.value}</p><p className="mt-1 text-[0.6875rem] text-muted-foreground">{item.rule}</p></div>)}</div>
          <ul className="mt-3 space-y-1 text-[0.6875rem] text-muted-foreground">{analysis.observations.map(item => <li key={item}>· {item}</li>)}</ul></section>
        <p className="pb-2 text-center text-[0.6875rem] text-muted-foreground">数据来源：{data.financial.source}。公开接口和公司公告可能存在修订或延迟，请以交易所正式公告为准。本页仅作研究参考，不构成投资建议。</p>
      </div>}
    </div>
  </div>;
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className="rounded-md border bg-muted/20 p-3"><p className="text-muted-foreground">{label}</p><p className="mt-1 text-sm font-semibold">{value}</p><p className="mt-1 text-[0.6875rem] text-muted-foreground">{note}</p></div>;
}

function Cell({ value, tone }: { value: string; tone?: number | null }) {
  return <td className={`whitespace-nowrap px-3 py-2 ${tone !== null && tone !== undefined ? tone > 0 ? "text-red-500" : tone < 0 ? "text-emerald-600" : "" : ""}`}>{value}</td>;
}

function Empty({ text }: { text: string }) {
  return <div role="status" className="flex h-40 items-center justify-center rounded-lg border border-dashed text-muted-foreground">{text}</div>;
}

function numberText(value: number | null, suffix = "") {
  return value === null || !Number.isFinite(value) ? "--" : `${value.toFixed(2)}${suffix}`;
}

function finiteText(value: number | null, prefix: string, suffix = "") {
  return value === null || !Number.isFinite(value) ? `${prefix} --` : `${prefix} ${value.toFixed(2)}${suffix}`;
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("zh-CN", { hour12: false }) : value;
}
