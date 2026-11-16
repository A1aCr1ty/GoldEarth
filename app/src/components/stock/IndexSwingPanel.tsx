import { useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { tauri } from "@/lib/tauri";
import { BOSS_MO_SOURCES, evaluateIndexSwing, INDEX_ETFS, mergeIndexEtfs, normalizeEtfCode, type IndexEtf } from "@/lib/indexSwing";
import { IndexGridBacktestPanel } from "@/components/stock/IndexGridBacktestPanel";
import { IndexRuleBacktestPanel } from "@/components/stock/IndexRuleBacktestPanel";
import { IndexRuleLiveSignals } from "@/components/stock/IndexRuleLiveSignals";
import { IndexCustomBacktest } from "@/components/stock/IndexCustomBacktest";
import { useLocalRecord } from "@/lib/useLocalRecord";
import type { Candle, Quote } from "@/types";
import type { LocalIndexRuleResult } from "@/lib/indexRuleLocal";

interface EtfData {
  quote: Quote | null;
  bars: Candle[];
  error: string;
  backtest: LocalIndexRuleResult | null;
  backtestError: string;
}

const number = (value: number, digits = 3) => Number.isFinite(value) ? value.toFixed(digits) : "—";
const percent = (value: number) => Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${value.toFixed(2)}%` : "—";

export function IndexSwingPanel() {
  const customStore = useLocalRecord<IndexEtf[]>("goldearth.index-etfs.v1", []);
  const savedCustom = Array.isArray(customStore.value) ? customStore.value : [];
  const etfs = useMemo(() => mergeIndexEtfs(savedCustom), [savedCustom]);
  const customEtfs = etfs.slice(INDEX_ETFS.length);
  const [data, setData] = useState<Record<string, EtfData>>({});
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [updatedAt, setUpdatedAt] = useState("");
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [formMessage, setFormMessage] = useState("");

  function addEtf() {
    try {
      const code = normalizeEtfCode(newCode);
      if (etfs.some(etf => etf.code === code)) { setFormMessage("这只ETF已在关注列表中。"); return; }
      const name = newName.trim() || `指数ETF ${code.slice(2)}`;
      if (customStore.save([...savedCustom, { code, name }])) {
        setNewCode(""); setNewName(""); setFormMessage(`已添加 ${name}，正在获取行情。`);
      }
    } catch (error) {
      setFormMessage(error instanceof Error ? error.message : "ETF代码无效。");
    }
  }

  useEffect(() => {
    let active = true;
    setBusy(true);
    void Promise.all(etfs.map(async etf => {
      const [quote, bars] = await Promise.allSettled([
        tauri.stockQuote(etf.code),
        tauri.stockKline(etf.code, "day", 1023),
      ]);
      const errors: string[] = [];
      if (quote.status === "rejected") errors.push(`实时行情：${String(quote.reason)}`);
      if (bars.status === "rejected") errors.push(`日线：${String(bars.reason)}`);
      let backtest: LocalIndexRuleResult | null = null;
      let backtestError = "";
      if (!INDEX_ETFS.some(item => item.code === etf.code) && bars.status === "fulfilled") {
        try { backtest = await tauri.indexRuleBacktest(etf.code, bars.value); }
        catch (error) { backtestError = String(error); }
      }
      return [etf.code, {
        quote: quote.status === "fulfilled" ? quote.value : null,
        bars: bars.status === "fulfilled" ? bars.value : [],
        error: errors.join("；"), backtest, backtestError,
      }] as const;
    })).then(results => {
      if (!active) return;
      setData(previous => ({ ...previous, ...Object.fromEntries(results) }));
      setUpdatedAt(new Date().toLocaleString("zh-CN"));
    }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [revision, etfs]);

  const customNatr = customEtfs.map(etf => ({ code: etf.code, name: etf.name, result: data[etf.code]?.backtest?.natr ?? null }));

  return <div className="flex-1 space-y-4 overflow-y-auto p-5 text-xs">
    <div className="flex flex-wrap items-center gap-3">
      <div className="mr-auto"><h2 className="text-lg font-semibold">指数波段操作</h2><p className="mt-1 text-muted-foreground">只分析ETF价格、均线、MACD、RSI、成交量与ATR，不使用财报、行业判断、ONNX或Agent。</p></div>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => setRevision(value => value + 1)}><RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />{busy ? "正在计算…" : "刷新行情与波段建议"}</Button>
    </div>
    <div className="rounded-lg border bg-muted/20 p-3 leading-5 text-muted-foreground">规则参考BOSS墨公开视频中的MACD、右侧跟随、回调确认与交易系统思路。公开接口未提供全部视频字幕，因此不宣称逐字还原UP主方法；页面中的ATR倍数、RSI阈值和价格区均为本应用工程规则，不是UP主原公式。建议仅供复核，不自动下单。</div>
    <form className="flex flex-wrap items-end gap-2 rounded-lg border bg-card p-3" onSubmit={event => { event.preventDefault(); addEtf(); }}>
      <div className="mr-auto"><b className="text-sm">添加关注的指数ETF</b><p className="mt-1 text-muted-foreground">支持6位代码或 sh / sz 前缀；保存后自动加入行情刷新。</p></div>
      <label>ETF代码<Input aria-label="ETF代码" className="mt-1 w-40" required maxLength={9} placeholder="例如 510300" value={newCode} onChange={event => setNewCode(event.target.value)} /></label>
      <label>名称（可选）<Input aria-label="ETF名称（可选）" className="mt-1 w-48" maxLength={30} placeholder="例如 沪深300ETF" value={newName} onChange={event => setNewName(event.target.value)} /></label>
      <Button type="submit" size="sm"><Plus className="mr-1 h-3.5 w-3.5" />添加关注</Button>
      {(customStore.error || formMessage) && <p role="status" className="w-full text-muted-foreground">{customStore.error || formMessage}</p>}
      {customEtfs.length > 0 && <div className="flex w-full flex-wrap gap-2 border-t pt-2">{customEtfs.map(etf => <span className="inline-flex items-center rounded-md bg-muted px-2 py-1" key={etf.code}>{etf.name} · {etf.code.slice(2)}<Button type="button" size="sm" variant="ghost" className="ml-1 h-6 w-6 p-0" aria-label={`移除${etf.name}`} onClick={() => { if (customStore.save(savedCustom.filter(item => item.code !== etf.code))) setFormMessage(`已移除 ${etf.name}。`); }}><Trash2 className="h-3 w-3" /></Button></span>)}</div>}
    </form>
    {updatedAt && <p className="text-muted-foreground">最近计算 {updatedAt} · 当前价用于生成波段价位，MACD与均线只使用已完成日线。新关注ETF先以空仓模型生成指示，本地回测后使用最新模型仓位。</p>}
    <div className="grid gap-4 2xl:grid-cols-2">
      {etfs.map(etf => {
        const item = data[etf.code];
        const result = item ? evaluateIndexSwing(item.bars, item.quote) : null;
        return <section className="space-y-3 rounded-lg border bg-card p-4" key={etf.code}>
          <div className="flex flex-wrap items-center gap-2"><div className="mr-auto"><h3 className="text-sm font-semibold">{etf.name}</h3><p className="mt-1 text-muted-foreground">{etf.code.slice(2)}</p></div>{result?.ready && <span className={`rounded px-2 py-1 font-semibold ${/买入/.test(result.action) ? "bg-emerald-500/10 text-emerald-600" : /减仓|空仓/.test(result.action) ? "bg-amber-500/10 text-amber-600" : "bg-secondary"}`}>{result.action}</span>}</div>
          {!item && <p className="py-6 text-center text-muted-foreground">等待行情与日线数据…</p>}
          {item?.error && <p role="alert" className="text-destructive">{item.error}</p>}
          {result && !result.ready && <p className="rounded-md bg-muted/30 p-3 text-amber-600">{result.reason}</p>}
          {result?.ready && <>
            <div className="flex flex-wrap items-end gap-3"><div><span className="text-muted-foreground">当前价 </span><b className="text-2xl">{number(result.current)}</b><span className="ml-2">{percent(result.changePct)}</span></div><span className="text-muted-foreground">{result.trend} · MACD{result.macdState} · RSI {result.rsi14.toFixed(1)}</span></div>
            <p className="text-sm leading-6">{result.summary}</p>
            <IndexRuleLiveSignals code={etf.code} bars={item.bars} quote={item.quote} localResult={item.backtest} />
            <div className="grid gap-2 rounded-md bg-muted/30 p-3 sm:grid-cols-2 lg:grid-cols-4">
              <div><b className="block">回调买入 / 接回区</b><span className="mt-1 block text-base font-semibold">{number(result.prices.entryLow)} – {number(result.prices.entryHigh)}</span><span className="text-muted-foreground">当前价下方0.5–1 ATR</span></div>
              <div><b className="block">右侧突破观察</b><span className="mt-1 block text-base font-semibold">{number(result.prices.breakout)}</span><span className="text-muted-foreground">当前价上方0.5 ATR</span></div>
              <div><b className="block">冲高兑现参考</b><span className="mt-1 block text-base font-semibold">{number(result.prices.takeProfit)}</span><span className="text-muted-foreground">当前价上方1.5 ATR</span></div>
              <div><b className="block">停止波段参考</b><span className="mt-1 block text-base font-semibold">{number(result.prices.stop)}</span><span className="text-muted-foreground">当前价下方1.5 ATR</span></div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <p><b>均线</b><br />MA5 {number(result.ma5)} · MA20 {number(result.ma20)} · MA60 {number(result.ma60)}<br /><span className="text-muted-foreground">当前价相对MA20 {result.extensionAtr.toFixed(2)} ATR</span></p>
              <p><b>MACD</b><br />DIF {result.dif.toFixed(4)} · DEA {result.dea.toFixed(4)}<br /><span className="text-muted-foreground">柱 {result.histogram.toFixed(4)} · {result.macdState}</span></p>
              <p><b>量价与波动</b><br />量比 {result.volumeRatio.toFixed(2)} · ATR {number(result.atr14)}<br /><span className="text-muted-foreground">RSI14 {result.rsi14.toFixed(1)}</span></p>
              <p><b>20日技术位置</b><br />支撑 {number(result.support20)} · 压力 {number(result.resistance20)}<br /><span className="text-muted-foreground">日线 {result.asof} · 报价 {result.quoteTime}</span></p>
            </div>
            <p className="border-t pt-2 text-muted-foreground">买入区需结合上述信号，不能到价机械买入；停止价触发后先复核退出，取消接回。刷新后所有价格随当前价重新计算。</p>
          </>}
          {!INDEX_ETFS.some(item => item.code === etf.code) && item && <IndexCustomBacktest result={item.backtest} error={item.backtestError} />}
        </section>;
      })}
    </div>
    <IndexRuleBacktestPanel />
    <IndexGridBacktestPanel custom={customNatr} />
    <details className="rounded-lg border p-4"><summary className="cursor-pointer font-medium">BOSS墨公开视频参考与核实范围</summary><div className="mt-3 grid gap-3 lg:grid-cols-2">{BOSS_MO_SOURCES.map(source => <div className="rounded border p-3" key={source.url}><a className="text-primary hover:underline" href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a><p className="mt-1 text-muted-foreground">{source.use}</p></div>)}</div><p className="mt-3 leading-5 text-muted-foreground">视频UP主：BOSS墨，B站UID 25270495。已核对公开视频标题与作者信息；未取得完整字幕的内容不作为精确规则引用。数值阈值与操作结果由本地行情计算，不是UP主对当前ETF的观点。</p></details>
  </div>;
}
