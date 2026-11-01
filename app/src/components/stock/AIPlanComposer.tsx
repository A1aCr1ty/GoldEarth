import { useEffect, useRef, useState } from "react";
import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useAgents } from "@/store/agents";
import { tauri } from "@/lib/tauri";
import { accountQuoteCode } from "@/lib/stockAccountMarket";
import { buildAccountReviewContext } from "@/lib/stockAccountReview";
import { draftPlanPrompt, parseGeneratedTradePlan, planInputSignature, HORIZON_LABELS, INTENT_LABELS, planThresholds, type AccountTradePlan, type GeneratedTradePlan } from "@/lib/accountTradePlan";
import type { StockAccount } from "@/lib/stockAccountImport";
import type { AgentRun, Quote } from "@/types";

interface Generation {
  id: string; scopeId: string; agentId: string; runId: string; request: string; base?: AccountTradePlan;
  status: "running" | "finished"; raw?: string; error?: string; result?: GeneratedTradePlan;
}
const selectClass = "h-9 rounded-md border bg-background px-2 text-sm max-w-full";
const price = (n: number | null) => n == null || !n ? "待补充" : `¥${n.toFixed(3)}`;

export function AIPlanComposer({ account, onReview }: { account: StockAccount; onReview: (plan: AccountTradePlan) => void }) {
  const key = `goldearth.ai-plan-composer.v1.${account.id}`;
  const [job, setJob] = useState<Generation | null>(() => { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; } });
  const [request, setRequest] = useState(job?.request ?? "");
  const [target, setTarget] = useState(job?.base?.id ?? "new");
  const [agentId, setAgentId] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const agents = useAgents(s => s.agents);
  const runs = useAgents(s => s.runs);
  const enabled = agents.filter(a => a.enabled);
  const busy = preparing || job?.status === "running";
  useEffect(() => { if (!enabled.some(a => a.id === agentId)) setAgentId(enabled[0]?.id ?? ""); }, [agents, agentId]);
  useEffect(() => {
    try { if (job) localStorage.setItem(key, JSON.stringify(job)); else localStorage.removeItem(key); }
    catch { setError("本机存储空间不足，生成记录未保存；请保留当前页面并及时确认计划。"); }
  }, [key, job]);

  function complete(run: AgentRun) {
    if (run.status === "running" || run.status === "pending") return;
    setJob(current => {
      if (!current || current.status !== "running" || current.runId !== run.id) return current;
      const next: Generation = { ...current, status: "finished", raw: run.output, error: run.error };
      if (run.status !== "succeeded") return { ...next, error: run.error || (run.status === "cancelled" ? "已停止制定计划" : "AI 制定计划失败，请重试") };
      try {
        const result = parseGeneratedTradePlan(run.output, current.id, current.request, current.base);
        if (result.plan) result.plan.aiDraftRunId = run.id;
        return { ...next, result };
      }
      catch (e) { return { ...next, error: String(e) }; }
    });
  }
  useEffect(() => { if (job?.status === "running") { const run = runs.find(r => r.id === job.runId); if (run) complete(run); } }, [runs, job?.runId, job?.status]);
  useEffect(() => {
    if (job?.status !== "running") return;
    let alive = true;
    const poll = async () => {
      try { const records = await tauri.listStockPlanRuns(job.scopeId, job.agentId); const run = records.find(r => r.id === job.runId); if (alive && run) complete(run); }
      catch (e) { if (alive) setError(`读取生成状态失败：${e}`); }
    };
    void poll(); const timer = window.setInterval(() => void poll(), 5000);
    return () => { alive = false; clearInterval(timer); };
  }, [job?.runId, job?.status]);

  async function generate() {
    if (lock.current || busy || !request.trim() || !agentId) return;
    const base = (account.tradePlans ?? []).find(p => p.id === target);
    if (target !== "new" && !base) { setError("原计划已不存在，请选择新建计划。"); return; }
    lock.current = true; setPreparing(true); setError("");
    try {
      await useAgents.getState().initStream();
      const mentioned = [...request.matchAll(/(?<!\d)(?:(?:sh|sz|bj)\s*)?\d{6}(?!\d)/gi)].map(m => m[0]);
      const candidates = [...mentioned, ...(base ? [base.code] : []), ...account.positions.map(p => p.code)];
      const codes = [...new Set(candidates.map(accountQuoteCode).filter((c): c is string => !!c))].slice(0, 5);
      const [q, ...charts] = await Promise.allSettled([codes.length ? tauri.stockQuotes(codes) : Promise.resolve([] as Quote[]), ...codes.map(c => tauri.stockKline(c, "day", 500))]);
      const quotes: Record<string, Quote> = {};
      if (q.status === "fulfilled") for (const item of q.value as Quote[]) { const code = accountQuoteCode(item.code); if (code && codes.includes(code)) quotes[code] = item; }
      const context = buildAccountReviewContext(account, quotes, charts.map((c, i) => ({ code: codes[i], bars: c.status === "fulfilled" ? c.value as import("@/types").Candle[] : [], error: c.status === "rejected" ? String(c.reason) : undefined })), { focus: "all", horizon: "以用户本轮输入为准", riskBudget: "以用户本轮明确给出的风险限制为准，未提供则缺失", quoteError: codes.some(c => !quotes[c]) ? "部分证券报价缺失，不能推断当前价格" : "", asOf: new Date().toISOString() });
      const id = base?.id ?? crypto.randomUUID();
      // 与已保存计划的建议运行隔离，避免未确认的修改混入旧计划历史。
      const scopeId = crypto.randomUUID();
      if (!alive.current) return;
      const run = await useAgents.getState().run(agentId, draftPlanPrompt(id, request.trim(), base), undefined, undefined, context, undefined, undefined, account.id, scopeId);
      if (!alive.current) { await useAgents.getState().cancel(run.id); return; }
      setJob({ id, scopeId, agentId, runId: run.id, request: request.trim(), base, status: "running" });
    } catch (e) { setError(`AI 制定计划失败：${e}`); }
    finally { lock.current = false; setPreparing(false); }
  }

  function review() {
    if (!job?.result?.plan) return;
    if (!job.base && account.tradePlans?.some(p => p.id === job.id)) { setError("这条 AI 草稿已经保存。需要调整时，请在上方选择修改对应计划后重新生成。"); return; }
    const current = account.tradePlans?.find(p => p.id === job.base?.id);
    if (job.base && (!current || planInputSignature(current) !== planInputSignature(job.base))) { setError("原计划在生成后已被修改，请重新生成以免覆盖新设置。"); return; }
    onReview(job.result.plan);
  }
  const result = job?.result;
  const plan = result?.plan;
  const thresholds = plan && planThresholds(plan);
  const edited = !!job && (request.trim() !== job.request || target !== (job.base?.id ?? "new"));
  const saved = !!job && !!account.tradePlans?.some(p => p.id === job.id && (p.aiDraftRunId === job.runId || (!job.base || (!!job.result?.plan && p.aiRequest === job.request && planInputSignature(p) === planInputSignature(job.result.plan)))));
  return <Card><CardHeader><CardTitle className="flex items-center gap-2"><Bot className="h-4 w-4" />让 AI 帮你制定交易计划</CardTitle></CardHeader><CardContent className="space-y-3">
    <p className="text-sm text-muted-foreground">说出你的交易想法，AI 重点制定波段方案：底仓与机动仓、回调买入、冲高卖出、接回条件和停止波段条件；已有长线目标会保留。</p>
    <div className="flex flex-wrap gap-2"><select aria-label="制定计划 Agent" className={selectClass} value={agentId} disabled={busy} onChange={e => setAgentId(e.target.value)}><option value="" disabled>选择已启用的 Agent</option>{enabled.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select><select aria-label="制定或修改计划" className={selectClass} value={target} disabled={busy} onChange={e => setTarget(e.target.value)}><option value="new">制定新计划</option>{(account.tradePlans ?? []).map(p => <option key={p.id} value={p.id}>修改：{p.name} · {p.code} · {HORIZON_LABELS[p.horizon]}</option>)}</select></div>
    <Textarea aria-label="告诉 AI 你的交易想法" value={request} disabled={busy} onChange={e => setRequest(e.target.value)} className="min-h-[80px]" placeholder="例如：为沪电股份制定未来数周的波段计划，底仓继续长线持有，机动仓回调买入、冲高卖出后择机接回。请说明支撑压力依据、量价确认、接回和停止波段条件；仓位待我确认。" />
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-muted-foreground">点击生成后向所选 Agent 发送输入、持仓与交易摘要和行情，账号不发送。</p><div className="flex gap-2">{job?.status === "running" && <Button size="sm" variant="outline" onClick={() => void useAgents.getState().cancel(job.runId).catch(e => setError(String(e)))}>停止</Button>}<Button size="sm" disabled={busy || !request.trim() || !agentId} onClick={() => void generate()}>{preparing ? "正在准备行情…" : job?.status === "running" ? "AI 正在制定计划…" : "根据我的输入制定计划"}</Button></div></div>
    {!enabled.length && <p className="text-xs text-muted-foreground">请先在 Agent 页面配置并启用分析助手。</p>}
    {edited && <p className="text-xs text-amber-600">输入或修改对象已改变，以下仍是上一次生成结果，请重新生成。</p>}
    {result && <div className="space-y-3 rounded-lg border bg-primary/5 p-4"><h3 className="text-sm font-semibold">{job?.base ? "AI 修改后的计划草稿" : "AI 生成的计划草稿"}</h3><p className="text-sm whitespace-pre-wrap">{result.summary}</p>
      {plan && thresholds && <><div className="overflow-x-auto rounded-md border"><table className="w-full min-w-[560px] text-xs"><thead className="bg-muted/40 text-muted-foreground"><tr>{["股票", "周期 / 操作", "参考价", "数量", "止盈", "止损", "复核日期"].map(label => <th className="px-3 py-2 text-left font-medium" key={label}>{label}</th>)}</tr></thead><tbody><tr className="border-t"><td className="px-3 py-3">{plan.name}<div className="text-muted-foreground">{plan.code}</div></td><td className="px-3 py-3">{HORIZON_LABELS[plan.horizon]} / {INTENT_LABELS[plan.intent]}</td><td className="px-3 py-3">{price(plan.referencePrice)}</td><td className="px-3 py-3">{plan.quantity ?? "待定"}</td><td className="px-3 py-3">{price(thresholds.takeProfitPrice)}</td><td className="px-3 py-3">{price(thresholds.stopLossPrice)}</td><td className="px-3 py-3">{plan.expiresOn || "待定"}</td></tr></tbody></table></div><details className="text-xs text-muted-foreground"><summary className="cursor-pointer">计划执行说明</summary><p className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap leading-5">{plan.objective}</p></details></>}
      {!!result.missingData.length && <details className="text-xs text-muted-foreground" open={!plan}><summary className="cursor-pointer">待补充 / 确认（{result.missingData.length}项）</summary><ul className="mt-2 list-disc space-y-1 pl-4">{result.missingData.map((v, i) => <li key={i}>{v}</li>)}</ul></details>}
      <div className="flex flex-wrap gap-2">{plan ? <Button size="sm" disabled={edited || saved} onClick={review}>{saved ? "这条计划已保存" : "确认并编辑计划"}</Button> : <p className="text-sm text-muted-foreground">请补充上方信息，再次点击制定计划。</p>}<Button size="sm" variant="outline" disabled={busy} onClick={() => { setJob(null); setError(""); }}>清除生成结果</Button></div>
    </div>}
    {(error || job?.error) && <p role="alert" className="text-sm text-destructive whitespace-pre-wrap">{error || job?.error}</p>}
    {job?.raw && <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">查看 AI 原始回复</summary><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words">{job.raw}</pre></details>}
    <p className="text-xs text-muted-foreground">生成结果为待确认草稿；确认并保存后才加入计划列表。缺失参考价时需先补齐才能保存；止盈止损可留空，未设置的价格条件不触发提示。</p>
  </CardContent></Card>;
}
