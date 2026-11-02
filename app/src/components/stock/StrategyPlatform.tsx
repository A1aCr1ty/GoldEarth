import { useEffect, useMemo, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { bundledStrategy, strategyDocument } from "@/lib/strategyPlatform";
import { tauri } from "@/lib/tauri";
import { useStocks } from "@/store/stocks";
import { fusionOf } from "@/lib/fusionStrategy";

export function StrategyPlatform({ onOpenStock }: { onOpenStock: () => void }) {
  const [snapshot, setSnapshot] = useState(bundledStrategy);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [auto, setAuto] = useState(() => localStorage.getItem('strategy.auto.enabled') !== 'false');
  const frame = useRef<HTMLIFrameElement>(null);
  const current = useStocks(s => s.current);
  const html = useMemo(() => strategyDocument(snapshot), [snapshot]);
  const fusion = fusionOf(snapshot.adaptive);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (isTauri()) void tauri.strategySnapshot().then(value => { if (active) setSnapshot(value); })
        .catch(e => { if (active) setError(String(e)); });
    };
    refresh(); window.addEventListener('strategy:updated', refresh);
    return () => { active = false; window.removeEventListener('strategy:updated', refresh); };
  }, []);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.type !== "strategy-stock") return;
      const code = event.data.code;
      if (typeof code !== "string" || !/^\d{6}$/.test(code)) return;
      useStocks.getState().setCurrent(`${/^[569]/.test(code) ? "sh" : /^[48]/.test(code) ? "bj" : "sz"}${code}`);
      onOpenStock();
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [onOpenStock]);

  async function review() {
    setBusy(true); setError("");
    try { setSnapshot(await tauri.strategyReview()); window.dispatchEvent(new Event('strategy:updated')); }
    catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }

  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2 text-xs">
      <label><input type="checkbox" checked={auto} onChange={e => { setAuto(e.target.checked); localStorage.setItem('strategy.auto.enabled', String(e.target.checked)); }} />工作日16点后自动复盘（应用需运行）</label>
      <span className="mr-auto text-muted-foreground">模型 {snapshot.adaptive.universe} 只 · 截至 {snapshot.adaptive.asof} · 原基线 {snapshot.results.universe} 只／{snapshot.results.asof} · 信号同步账户</span>
      <Button size="sm" variant="outline" disabled={!current} onClick={() => frame.current?.contentWindow?.postMessage({ type: "strategy-filter", code: current?.replace(/^(sh|sz|bj)/, "") }, "*")}>筛选当前股票</Button>
      <Button size="sm" disabled={busy || !isTauri()} onClick={() => void review()}>{busy ? "正在更新行情与回测…" : "更新并复盘"}</Button>
    </div>
    {busy && <p className="border-b px-4 py-2 text-xs text-muted-foreground">首次运行需要 Python、numpy、pandas，并下载股票池历史行情，可能耗时较长。</p>}
    {fusion && <div className="shrink-0 border-b px-4 py-2 text-xs"><b>常士杉环境/基本面 × Z哥技术执行</b><p>大盘：{fusion.macro.regime} · 收盘 {fusion.macro.close} / MA20 {fusion.macro.ma20} / MA60 {fusion.macro.ma60} / RSI {fusion.macro.rsi} · 财报覆盖 {fusion.fundamental_covered}/{fusion.operations.length}</p><p className="text-muted-foreground">{fusion.macro_method} {fusion.note}</p></div>}
    {fusion?.macro_forecast && <p className="shrink-0 border-b px-4 py-2 text-xs">大盘概率研究（工程模型）：{Object.entries(fusion.macro_forecast.horizons).map(([h,f]) => `${h}日：${f.direction}${f.probability_up == null ? '' : `，上涨概率${(f.probability_up*100).toFixed(1)}%`}`).join('；')}</p>}
    {error && <p role="alert" className="border-b px-4 py-2 text-xs text-destructive">{error}（保留上次成功结果）</p>}
    <details className="shrink-0 border-b px-4 py-2 text-xs"><summary>研究来源与预测修正</summary>{snapshot.adaptive.sources?.sources.map(s => <p key={s.id} className="my-2"><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a> · {s.evidence}<br />{s.implementation}</p>)}<p>预测已成熟样本 {snapshot.adaptive.prediction_review?.matured ?? 0}；Brier误差 {snapshot.adaptive.prediction_review?.brier ?? '待积累'}。新增规则是研究近似，需继续积累前瞻样本。</p></details>
    <iframe ref={frame} title="股票策略验证台" sandbox="allow-scripts" srcDoc={html} className="min-h-0 w-full flex-1 border-0 bg-white" />
  </div>;
}
