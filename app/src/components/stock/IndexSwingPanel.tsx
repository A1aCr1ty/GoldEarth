import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { tauri } from "@/lib/tauri";
import { BOSS_MO_SOURCES, evaluateIndexSwing, INDEX_ETFS } from "@/lib/indexSwing";
import { IndexGridBacktestPanel } from "@/components/stock/IndexGridBacktestPanel";
import type { Candle, Quote } from "@/types";

interface EtfData {
  quote: Quote | null;
  bars: Candle[];
  error: string;
}

const number = (value: number, digits = 3) => Number.isFinite(value) ? value.toFixed(digits) : "—";
const percent = (value: number) => Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${value.toFixed(2)}%` : "—";

export function IndexSwingPanel() {
  const [data, setData] = useState<Record<string, EtfData>>({});
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [updatedAt, setUpdatedAt] = useState("");

  useEffect(() => {
    let active = true;
    setBusy(true);
    void Promise.all(INDEX_ETFS.map(async etf => {
      const [quote, bars] = await Promise.allSettled([
        tauri.stockQuote(etf.code),
        tauri.stockKline(etf.code, "day", 500),
      ]);
      const errors: string[] = [];
      if (quote.status === "rejected") errors.push(`实时行情：${String(quote.reason)}`);
      if (bars.status === "rejected") errors.push(`日线：${String(bars.reason)}`);
      return [etf.code, {
        quote: quote.status === "fulfilled" ? quote.value : null,
        bars: bars.status === "fulfilled" ? bars.value : [],
        error: errors.join("；"),
      }] as const;
    })).then(results => {
      if (!active) return;
      setData(previous => ({ ...previous, ...Object.fromEntries(results) }));
      setUpdatedAt(new Date().toLocaleString("zh-CN"));
    }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [revision]);

  return <div className="flex-1 space-y-4 overflow-y-auto p-5 text-xs">
    <div className="flex flex-wrap items-center gap-3">
      <div className="mr-auto"><h2 className="text-lg font-semibold">指数波段操作</h2><p className="mt-1 text-muted-foreground">只分析ETF价格、均线、MACD、RSI、成交量与ATR，不使用财报、行业判断、ONNX或Agent。</p></div>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => setRevision(value => value + 1)}><RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />{busy ? "正在计算…" : "刷新行情与波段建议"}</Button>
    </div>
    <div className="rounded-lg border bg-muted/20 p-3 leading-5 text-muted-foreground">规则参考BOSS墨公开视频中的MACD、右侧跟随、回调确认与交易系统思路。公开接口未提供全部视频字幕，因此不宣称逐字还原UP主方法；页面中的ATR倍数、RSI阈值和价格区均为本应用工程规则，不是UP主原公式。建议仅供复核，不自动下单。</div>
    {updatedAt && <p className="text-muted-foreground">最近计算 {updatedAt} · 当前价用于生成波段价位，MACD与均线只使用已完成日线。</p>}
    <div className="grid gap-4 2xl:grid-cols-2">
      {INDEX_ETFS.map(etf => {
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
        </section>;
      })}
    </div>
    <IndexGridBacktestPanel />
    <details className="rounded-lg border p-4"><summary className="cursor-pointer font-medium">BOSS墨公开视频参考与核实范围</summary><div className="mt-3 grid gap-3 lg:grid-cols-2">{BOSS_MO_SOURCES.map(source => <div className="rounded border p-3" key={source.url}><a className="text-primary hover:underline" href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a><p className="mt-1 text-muted-foreground">{source.use}</p></div>)}</div><p className="mt-3 leading-5 text-muted-foreground">视频UP主：BOSS墨，B站UID 25270495。已核对公开视频标题与作者信息；未取得完整字幕的内容不作为精确规则引用。数值阈值与操作结果由本地行情计算，不是UP主对当前ETF的观点。</p></details>
  </div>;
}
