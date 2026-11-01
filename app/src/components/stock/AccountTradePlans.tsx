import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, Bot, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AIPlanComposer } from "./AIPlanComposer";
import { PlanRecommendationView } from "./PlanRecommendationView";
import { PlanReminderSettings } from "./PlanReminderSettings";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useAgents } from "@/store/agents";
import { tauri } from "@/lib/tauri";
import { accountQuoteCode, accountQuoteTime } from "@/lib/stockAccountMarket";
import { buildAccountReviewContext } from "@/lib/stockAccountReview";
import { HORIZON_LABELS, INTENT_LABELS, PLAN_STATUS_LABELS, planMetrics, planSignal, planInputSignature, planGenerationPrompt, parsePlanRecommendation, recommendationPlanText, validateTradePlan, type AccountTradePlan, type PlanSeed, type PriceRule } from "@/lib/accountTradePlan";
import type { StockAccount } from "@/lib/stockAccountImport";
import type { AgentRun, Quote } from "@/types";

const price = (n: number | null | undefined) => n == null ? "—" : `¥${n.toLocaleString("zh-CN", { maximumFractionDigits: 3 })}`;
const selectClass = "h-9 rounded-md border bg-background px-2 text-sm";
type Props = { account: StockAccount; quotes: Record<string, Quote>; seed: PlanSeed | null; consumeSeed: () => void; update: (id: string, change: (p: AccountTradePlan) => AccountTradePlan) => void; add: (p: AccountTradePlan) => void; remove: (id: string) => void };

export function AccountTradePlans({ account, quotes, seed, consumeSeed, update, add, remove }: Props) {
  const [search] = useSearchParams();
  const plans = account.tradePlans ?? [];
  const agents = useAgents(s => s.agents);
  const runs = useAgents(s => s.runs);
  const [agentId, setAgentId] = useState("");
  const [selectedId, setSelectedId] = useState(plans[0]?.id ?? "");
  const [composerOpen, setComposerOpen] = useState(!plans.length);
  const [draft, setDraft] = useState<AccountTradePlan | null>(null);
  const [error, setError] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [filter, setFilter] = useState("current");
  const [deleting, setDeleting] = useState<AccountTradePlan | null>(null);
  const [notice, setNotice] = useState("");
  const [composerVersion, setComposerVersion] = useState(0);
  const [generateAfterSave, setGenerateAfterSave] = useState(true);
  const [draftOrigin, setDraftOrigin] = useState<"manual" | "ai" | "recommendation">("manual");
  const detailRef = useRef<HTMLDivElement>(null);
  const retiredIds = useRef(new Set<string>());
  const lock = useRef(false);
  const latest = useRef({ plans, update }); latest.current = { plans, update };
  const visiblePlans = plans.filter(p => filter === "all" || (filter === "ended" ? p.status === "cancelled" || p.status === "completed" : p.status === "active" || p.status === "draft"));
  const selected = visiblePlans.find(p => p.id === selectedId) ?? visiblePlans[0];
  useEffect(() => { const id = search.get("plan"); if (id && plans.some(p => p.id === id)) { setFilter("all"); setSelectedId(id); } }, [search, account.id]);
  const enabled = agents.filter(a => a.enabled);
  const showDetail = () => requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  useEffect(() => { void useAgents.getState().refresh(); void useAgents.getState().initStream().catch(e => setError(String(e))); }, []);
  useEffect(() => { if (!enabled.some(a => a.id === agentId)) setAgentId(enabled[0]?.id ?? ""); }, [agents, agentId]);

  function newPlan(s?: PlanSeed) {
    const now = new Date().toISOString();
    setError(""); setDraftOrigin("manual");
    setDraft({ id: crypto.randomUUID(), code: s?.code ?? "", name: s?.name ?? "", intent: s?.intent ?? "hold", horizon: "swing", quantity: s?.quantity ?? null, referencePrice: s?.price ?? 0, takeProfit: null, stopLoss: null, objective: "", expiresOn: "", status: "draft", sourceTransactionId: s?.transactionId, createdAt: now, updatedAt: now });
  }
  useEffect(() => { if (seed) { newPlan(seed); consumeSeed(); } }, [seed]);

  function finish(run: AgentRun) {
    if (run.status === "running" || run.status === "pending") return;
    const plan = latest.current.plans.find(p => p.analysis?.runId === run.id && p.analysis.status === "running");
    if (!plan?.analysis) return;
    let analysis = { ...plan.analysis, finishedAt: new Date().toISOString(), rawOutput: run.output, error: run.error, status: run.status as "succeeded" | "failed" | "cancelled" };
    if (run.status === "succeeded") {
      try { analysis = { ...analysis, result: parsePlanRecommendation(run.output ?? "", plan) }; }
      catch (e) { latest.current.update(plan.id, p => p.analysis?.runId === run.id ? { ...p, analysis: { ...analysis, status: "unstructured", error: String(e) } } : p); return; }
    }
    latest.current.update(plan.id, p => p.analysis?.runId === run.id ? { ...p, analysis } : p);
  }
  useEffect(() => { for (const run of runs) finish(run); }, [runs, plans]);
  // 恢复离开页面期间已结束的运行；事件和轮询均以 runId 校验，避免覆盖新建议。
  const runningKey = plans.filter(p => p.analysis?.status === "running").map(p => `${p.id}:${p.analysis!.runId}`).join("|");
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      for (const p of latest.current.plans.filter(p => p.analysis?.status === "running")) {
        try { const records = await tauri.listStockPlanRuns(p.id, p.analysis!.agentId); if (alive) { const run = records.find(r => r.id === p.analysis!.runId); if (run) finish(run); } }
        catch (e) { if (alive) setError(`读取建议状态失败：${e}`); }
      }
    };
    void poll(); const timer = window.setInterval(() => void poll(), 5000);
    return () => { alive = false; clearInterval(timer); };
  }, [runningKey]);

  function save(status: AccountTradePlan["status"]) {
    if (!draft) return;
    const next = { ...draft, code: accountQuoteCode(draft.code)?.slice(2) ?? draft.code.trim(), name: draft.name.trim(), status, updatedAt: new Date().toISOString() };
    const errors = validateTradePlan(next, status === "active");
    if (errors.length) { setError(errors.join("；")); return; }
    const current = latest.current.plans.find(p => p.id === next.id);
    const changed = !current || planInputSignature(current) !== planInputSignature(next);
    try {
      if (current) update(next.id, saved => ({ ...next, reminders: saved.reminders, savedRecommendation: draftOrigin === "recommendation" && next.savedRecommendation ? next.savedRecommendation : saved.savedRecommendation, analysis: saved.analysis })); else add(next);
    } catch (e) { setError(`计划未保存成功：${e}`); return; }
    retiredIds.current.delete(next.id);
    setFilter("current"); setSelectedId(next.id); setDraft(null); setError("");
    showDetail();
    setNotice(`${next.name}计划已保存，目标、止盈止损和执行条件已更新。${generateAfterSave && agentId ? "正在根据保存后的计划生成操作建议…" : changed ? "请根据新计划生成操作建议。" : ""}`);
    if (generateAfterSave && agentId) {
      if (current?.analysis?.status === "running") void useAgents.getState().cancel(current.analysis.runId).catch(e => setError(`停止旧分析失败：${e}`));
      void generate({ ...next, analysis: undefined });
    }
  }

  function saveRecommendation(plan: AccountTradePlan) {
    const analysis = plan.analysis;
    if (!analysis?.result || analysis.status !== "succeeded" || analysis.inputSignature !== planInputSignature(plan)) return;
    try {
      update(plan.id, current => {
        if (current.analysis?.runId !== analysis.runId || planInputSignature(current) !== analysis.inputSignature) throw new Error("计划或建议已更新，请刷新后重新保存");
        return { ...current, savedRecommendation: { result: analysis.result!, runId: analysis.runId, inputSignature: analysis.inputSignature, savedAt: new Date().toISOString() } };
      });
      setError(""); setNotice(`${plan.name}操作建议与后续执行计划已保存，可在该计划的“已保存的操作方案”中查看。`);
      showDetail();
    } catch (e) { setError(`建议未保存成功：${e}`); }
  }

  function adoptRecommendation(plan: AccountTradePlan) {
    const result = plan.analysis?.result;
    if (!result || plan.analysis?.inputSignature !== planInputSignature(plan)) return;
    setError(""); setDraftOrigin("recommendation");
    if (result.swingPlan) {
      setDraft({ ...plan, savedRecommendation: { result, runId: plan.analysis!.runId, inputSignature: planInputSignature(plan), savedAt: new Date().toISOString() } });
      return;
    }
    setDraft({ ...plan, objective: recommendationPlanText(result), intent: result.action === "wait" ? plan.intent : result.action, takeProfit: result.suggestedTakeProfitPrice == null ? null : { mode: "price", value: result.suggestedTakeProfitPrice }, stopLoss: result.suggestedStopLossPrice == null ? null : { mode: "price", value: result.suggestedStopLossPrice } });
  }

  function stopRelatedWork(plan: AccountTradePlan) {
    retiredIds.current.add(plan.id);
    const runIds = new Set<string>();
    if (plan.analysis?.status === "running") runIds.add(plan.analysis.runId);
    // 同时清理顶部 AI 制定器中关联此计划的草稿，避免删除后再次带入。
    const key = `goldearth.ai-plan-composer.v1.${account.id}`;
    try {
      const job = JSON.parse(localStorage.getItem(key) || "null");
      if (job && (job.id === plan.id || job.base?.id === plan.id)) {
        if (job.status === "running" && job.runId) runIds.add(job.runId);
        localStorage.removeItem(key); setComposerVersion(v => v + 1);
      }
    } catch { /* 已损坏的缓存不影响计划操作 */ }
    for (const id of runIds) void useAgents.getState().cancel(id).catch(e => setError(`计划已结束，但停止 AI 运行失败：${e}`));
  }

  function endPlan(plan: AccountTradePlan, status: "cancelled" | "completed") {
    setError(""); stopRelatedWork(plan);
    update(plan.id, p => ({ ...p, status, updatedAt: new Date().toISOString(), analysis: p.analysis?.status === "running" ? { ...p.analysis, status: "cancelled", finishedAt: new Date().toISOString() } : p.analysis }));
    setSelectedId("");
    setNotice(`${plan.name}计划已${status === "cancelled" ? "取消" : "完成"}，已停止跟踪，可在“已结束”中查看或删除。`);
  }

  function deletePlan() {
    if (!deleting) return;
    setError(""); stopRelatedWork(deleting); remove(deleting.id);
    if (draft?.id === deleting.id) setDraft(null);
    setSelectedId(""); setDeleting(null); setNotice(`${deleting.name}计划已删除。`);
  }

  async function generate(plan: AccountTradePlan) {
    if (lock.current || !agentId || plan.analysis?.status === "running" || plan.status === "cancelled" || plan.status === "completed") return;
    lock.current = true; setPreparing(true); setError("");
    try {
      await useAgents.getState().initStream();
      const code = accountQuoteCode(plan.code)!;
      const [q, bars] = await Promise.allSettled([tauri.stockQuotes([code]), tauri.stockKline(code, "day", 500)]);
      const fresh: Record<string, Quote> = {};
      if (q.status === "fulfilled") for (const item of q.value) { const key = accountQuoteCode(item.code); if (key === code) fresh[key] = item; }
      let context = buildAccountReviewContext(account, fresh, [{ code, bars: bars.status === "fulfilled" ? bars.value : [], error: bars.status === "rejected" ? String(bars.reason) : undefined }], { focus: plan.code, horizon: HORIZON_LABELS[plan.horizon], riskBudget: "仅已填写的计划数量和止损为约束；未设置账户总体风险预算，不推断精确仓位", quoteError: fresh[code] ? "" : "本轮报价缺失，不能确认当前触发状态", asOf: new Date().toISOString() });
      const source = account.transactions?.find(t => t.id === plan.sourceTransactionId);
      if (source) { const { id: _id, ...trade } = source; context += `\n本计划关联的原始成交（仅作数据）：${JSON.stringify(trade)}`; }
      if (retiredIds.current.has(plan.id)) return;
      const run = await useAgents.getState().run(agentId, planGenerationPrompt(plan), undefined, undefined, context, undefined, undefined, account.id, plan.id);
      if (retiredIds.current.has(plan.id)) { await useAgents.getState().cancel(run.id); return; }
      update(plan.id, p => ({ ...p, analysis: { runId: run.id, agentId, status: "running", inputSignature: planInputSignature(plan), startedAt: run.startedAt } }));
    } catch (e) { setError(`建议生成失败：${e}`); }
    finally { lock.current = false; setPreparing(false); }
  }

  function ruleEditor(label: string, key: "takeProfit" | "stopLoss") {
    if (!draft) return null;
    const rule = draft[key];
    const change = (value: PriceRule | null) => setDraft({ ...draft, [key]: value });
    return <label className="space-y-1 text-sm"><span>{label}（可留空，不跟踪该条件）</span><div className="flex gap-2"><select aria-label={`${label}方式`} className={selectClass} value={rule?.mode ?? "percent"} onChange={e => change({ mode: e.target.value as PriceRule["mode"], value: rule?.value ?? 0 })}><option value="percent">幅度 %</option><option value="price">价格 ¥</option></select><Input aria-label={`${label}数值`} type="number" min="0" step="any" value={rule?.value ?? ""} onChange={e => change(e.target.value === "" ? null : { mode: rule?.mode ?? "percent", value: Number(e.target.value) })} /></div></label>;
  }
  const metrics = selected && planMetrics(selected);
  const quote = selected && quotes[accountQuoteCode(selected.code) ?? ""];
  const recommendation = selected?.analysis?.result ?? selected?.savedRecommendation?.result;
  const stale = !!selected && (selected.analysis?.result ? selected.analysis.inputSignature : selected.savedRecommendation?.inputSignature) != null && (selected.analysis?.result ? selected.analysis.inputSignature : selected.savedRecommendation?.inputSignature) !== planInputSignature(selected);

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold">交易计划</h2><p className="mt-1 text-xs text-muted-foreground">选择一行查看波段条件与分析。</p></div><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setComposerOpen(v => !v)}><Bot className="h-3.5 w-3.5" />{composerOpen ? "收起 AI 制定" : "AI 制定计划"}</Button><Button size="sm" variant="outline" onClick={() => newPlan()}><Plus className="h-3.5 w-3.5" />手动新建</Button></div></div>
    <div hidden={!composerOpen}><AIPlanComposer key={`${account.id}-${composerVersion}`} account={account} onReview={plan => { setDraftOrigin("ai"); setDraft(plan); setError(""); }} /></div>
    <div className="flex flex-wrap gap-1" aria-label="计划状态筛选">{[["current", "当前"], ["ended", "已结束"], ["all", "全部"]].map(([key, label]) => <Button key={key} size="sm" variant={filter === key ? "secondary" : "ghost"} onClick={() => { setFilter(key); setSelectedId(""); }}>{label} ({plans.filter(p => key === "all" || (key === "ended" ? p.status === "cancelled" || p.status === "completed" : p.status === "active" || p.status === "draft")).length})</Button>)}</div>
    {notice && <p role="status" className="text-xs text-muted-foreground">{notice}</p>}
    <div className="overflow-x-auto rounded-lg border"><table className="w-full min-w-[880px] text-xs"><thead className="bg-muted/40 text-muted-foreground"><tr>{["股票 / 周期", "最新价", "计划操作", "止盈 / 止损", "当前建议", "状态", "提醒", "管理"].map(title => <th key={title} className="px-3 py-2.5 text-left font-medium">{title}</th>)}</tr></thead><tbody>{visiblePlans.map(p => {
      const q = quotes[accountQuoteCode(p.code) ?? ""]; const m = planMetrics(p); const signal = planSignal(p, q); const result = p.analysis?.result ?? p.savedRecommendation?.result;
      const signature = p.analysis?.result ? p.analysis.inputSignature : p.savedRecommendation?.inputSignature;
      const old = !!result && signature !== planInputSignature(p);
      return <tr key={p.id} className={`border-t ${selected?.id === p.id ? "bg-primary/5" : "hover:bg-muted/30"}`}><td className="px-3 py-3"><button className="text-left font-medium hover:underline" onClick={() => setSelectedId(p.id)}>{p.name}</button><div className="mt-1 text-muted-foreground">{p.code} · {HORIZON_LABELS[p.horizon]}</div></td><td className="px-3 py-3 tabular-nums">{price(q?.price)}</td><td className="px-3 py-3">{INTENT_LABELS[p.intent]}<div className="mt-1 text-muted-foreground">{p.quantity == null ? "数量待定" : `${p.quantity}股`}</div></td><td className="px-3 py-3 tabular-nums"><div>{price(m.takeProfitPrice)}</div><div className="mt-1 text-muted-foreground">{price(m.stopLossPrice)}</div></td><td className="max-w-[200px] px-3 py-3"><span>{p.analysis?.status === "running" ? "分析中…" : old ? "需更新" : result ? INTENT_LABELS[result.action] : "待分析"}</span>{result && <p className="mt-1 line-clamp-1 text-muted-foreground" title={result.summary}>{result.summary}</p>}</td><td className="px-3 py-3"><span className={["stop", "profit", "review"].includes(signal.kind) ? "text-amber-600" : "text-muted-foreground"}>{signal.label}</span></td><td className="px-3 py-3">{p.reminders?.enabled && p.status === "active" && p.reminders.inputSignature === planInputSignature(p) ? "已启用" : "未启用 / 暂停"}</td><td className="px-2 py-3 whitespace-nowrap"><Button size="sm" variant="ghost" onClick={() => { setSelectedId(p.id); showDetail(); }}>查看</Button><Button size="sm" variant="ghost" onClick={() => { setDraftOrigin("manual"); setDraft({ ...p }); setError(""); }}>编辑</Button><Button size="sm" variant="ghost" aria-label={`删除${p.name}计划`} onClick={() => setDeleting(p)}><Trash2 className="h-3.5 w-3.5" /></Button></td></tr>;
    })}{!visiblePlans.length && <tr><td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">{plans.length ? "此分类暂无计划" : "暂无计划，点击“AI 制定计划”开始。"}</td></tr>}</tbody></table></div>
    {selected && metrics && <div ref={detailRef} className="scroll-mt-4 space-y-3"><Card><CardHeader className="space-y-2 pb-3"><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle>{selected.name} · 波段操作表</CardTitle><div className="flex flex-wrap items-center gap-2"><select aria-label="计划分析 Agent" className={selectClass} value={agentId} disabled={preparing} onChange={e => setAgentId(e.target.value)}><option value="" disabled>选择 Agent</option>{enabled.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select><Button size="sm" disabled={!agentId || preparing || selected.analysis?.status === "running" || selected.status === "cancelled" || selected.status === "completed"} onClick={() => void generate(selected)}>{preparing ? "准备行情…" : selected.analysis?.status === "running" ? "分析中…" : "更新分析"}</Button>{selected.analysis?.status === "running" && <Button size="sm" variant="outline" onClick={() => void useAgents.getState().cancel(selected.analysis!.runId).catch(e => setError(String(e)))}>停止</Button>}</div></div><p className="text-xs text-muted-foreground">{PLAN_STATUS_LABELS[selected.status]} · 报价 {quote ? accountQuoteTime(quote.time) : "暂无"} · {selected.analysis?.startedAt ? `分析于 ${new Date(selected.analysis.startedAt).toLocaleString("zh-CN")}` : "尚未分析"}</p></CardHeader><CardContent className="space-y-3">
      {stale && <p className="text-xs text-amber-600">计划已修改，当前建议需重新生成。</p>}
      {recommendation ? <><PlanRecommendationView result={recommendation} /><div className="flex flex-wrap items-center gap-2"><Button size="sm" disabled={stale || selected.analysis?.status !== "succeeded" || selected.savedRecommendation?.runId === selected.analysis?.runId || selected.status === "cancelled" || selected.status === "completed"} onClick={() => saveRecommendation(selected)}>{selected.savedRecommendation?.runId === selected.analysis?.runId ? "已保存" : "保存方案"}</Button><Button size="sm" variant="outline" disabled={stale || !selected.analysis?.result || selected.status === "cancelled" || selected.status === "completed"} onClick={() => adoptRecommendation(selected)}>采用并编辑</Button>{selected.savedRecommendation && <span className="text-xs text-muted-foreground">已保存于 {new Date(selected.savedRecommendation.savedAt).toLocaleString("zh-CN")}</span>}</div></> : <p className="py-4 text-sm text-muted-foreground">{selected.analysis?.status === "running" ? "正在根据计划和行情生成波段方案…" : "点击“更新分析”，生成买入、卖出、接回与停止条件。"}</p>}
      {selected.analysis?.error && <p role="alert" className="text-xs text-destructive whitespace-pre-wrap">{selected.analysis.error}</p>}
      <details className="rounded-md border px-3 py-2 text-xs"><summary className="cursor-pointer text-muted-foreground">原计划、估算与管理</summary><div className="mt-3 space-y-3"><div className="overflow-x-auto"><table className="w-full text-left"><tbody>{[["计划参考价", price(selected.referencePrice)], ["账本持仓成本", price(account.positions.find(p => p.code === selected.code)?.cost)], ["收益 / 风险比", metrics.riskReward?.toFixed(2) ?? "—"], ["风险 / 目标收益", `${price(metrics.plannedRisk)} / ${price(metrics.plannedReward)}`], ["复核日期", selected.expiresOn || "未设置"]].map(([label, value]) => <tr key={label} className="border-b last:border-0"><th className="py-2 font-normal text-muted-foreground">{label}</th><td className="py-2">{value}</td></tr>)}</tbody></table></div><p className="whitespace-pre-wrap leading-5">{selected.objective || "未填写目标"}</p><p className="text-muted-foreground">估算不含费用、滑点与跳空。保存于 {new Date(selected.updatedAt).toLocaleString("zh-CN")}</p><div className="flex flex-wrap gap-2">{selected.status === "draft" && <Button size="sm" variant="outline" onClick={() => { const errors = validateTradePlan(selected, true); if (errors.length) setError(errors.join("；")); else update(selected.id, p => ({ ...p, status: "active", updatedAt: new Date().toISOString() })); }}>启用跟踪</Button>}{selected.status === "active" && <Button size="sm" variant="outline" onClick={() => update(selected.id, p => ({ ...p, status: "draft" }))}>暂停跟踪</Button>}{(selected.status === "draft" || selected.status === "active") ? <><Button size="sm" variant="ghost" onClick={() => endPlan(selected, "completed")}>标记完成</Button><Button size="sm" variant="ghost" onClick={() => endPlan(selected, "cancelled")}>取消计划</Button></> : <Button size="sm" variant="outline" onClick={() => { retiredIds.current.delete(selected.id); update(selected.id, p => ({ ...p, status: "draft", updatedAt: new Date().toISOString() })); setFilter("current"); setSelectedId(selected.id); }}>恢复草稿</Button>}<Button size="sm" variant="destructive" onClick={() => setDeleting(selected)}>删除计划</Button></div></div></details>
      <details className="rounded-md border px-3 py-2 text-xs"><summary className="cursor-pointer text-muted-foreground">操作提醒设置 · {selected.reminders?.enabled && selected.status === "active" && selected.reminders.inputSignature === planInputSignature(selected) ? "已启用" : "未启用 / 暂停"}</summary><div className="mt-3"><PlanReminderSettings key={selected.id} plan={selected} update={update} /></div></details>
      {selected.savedRecommendation && selected.analysis?.runId !== selected.savedRecommendation.runId && <details className="rounded-md border px-3 py-2 text-xs"><summary className="cursor-pointer text-muted-foreground">上次保存的方案</summary><div className="mt-3"><p className="mb-2 text-muted-foreground">{new Date(selected.savedRecommendation.savedAt).toLocaleString("zh-CN")} · {selected.savedRecommendation.inputSignature !== planInputSignature(selected) ? "基于旧计划" : "基于当前计划"}</p><PlanRecommendationView result={selected.savedRecommendation.result} /></div></details>}
      {selected.analysis?.rawOutput && <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">AI 原始回复</summary><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words">{selected.analysis.rawOutput}</pre></details>}
      <p className="text-[11px] text-muted-foreground">更新分析会将计划、相关持仓、流水与行情发送给所选 Agent，账号不发送。提醒仅判断已设置的价格条件，操作由你确认。</p>
    </CardContent></Card></div>}
    <Dialog open={!!deleting} onOpenChange={open => { if (!open) setDeleting(null); }}><DialogContent><DialogHeader><DialogTitle>删除交易计划</DialogTitle><DialogDescription>删除“{deleting?.name} · {deleting?.code}”的计划设置与本机计划内建议。此操作不可撤销；持仓和交易流水不受影响。</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setDeleting(null)}>保留计划</Button><Button variant="destructive" onClick={deletePlan}>确认删除</Button></DialogFooter></DialogContent></Dialog>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Dialog open={!!draft} onOpenChange={open => { if (!open) setDraft(null); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{draftOrigin === "recommendation" ? "将 AI 操作建议写入计划" : draftOrigin === "ai" ? "确认 AI 制定的计划" : "设置交易计划"}</DialogTitle><DialogDescription>保存后立即更新该计划；可同时根据保存后的计划生成操作建议。</DialogDescription></DialogHeader>{draft && <div className="space-y-4">
      {draftOrigin === "recommendation" && draft.savedRecommendation?.result.swingPlan && <div className="rounded-md border p-3 space-y-3"><p className="font-medium text-sm">本次保存波段操作方案，保留原计划目标、周期及底仓止盈止损。机动仓买卖条件在下方独立展示。</p><PlanRecommendationView result={draft.savedRecommendation.result} /></div>}
      {draftOrigin === "recommendation" && !draft.savedRecommendation?.result.swingPlan && <div className="rounded-md border bg-primary/5 p-3 text-sm space-y-2"><p className="font-medium">以下内容将在保存时应用到计划</p><p>操作：{INTENT_LABELS[draft.intent]}；止盈：{draft.takeProfit ? price(planMetrics(draft).takeProfitPrice) : "清空 / 未设置"}；止损：{draft.stopLoss ? price(planMetrics(draft).stopLossPrice) : "清空 / 未设置"}。</p><p>AI 未提供的价位已留空，保存后不会沿用原来的数值。请确认下方设置；可以手动补充，也可以留空。</p></div>}
      <label className="block text-sm space-y-1"><span>从当前持仓带入（可选）</span><select aria-label="选择持仓" className={`${selectClass} w-full`} value="" onChange={e => { const p = account.positions.find(p => p.code === e.target.value); if (p) setDraft({ ...draft, code: p.code, name: p.name, referencePrice: p.cost ?? p.price ?? 0, quantity: p.quantity || null }); }}><option value="">选择持仓，或手动填写下方证券</option>{account.positions.map(p => <option key={p.code} value={p.code}>{p.name} · {p.code}</option>)}</select></label>
      <div className="grid gap-3 sm:grid-cols-2">{[["证券代码", "code"], ["证券名称", "name"]].map(([label, key]) => <label key={key} className="text-sm space-y-1"><span>{label}</span><Input value={draft[key as "code" | "name"]} onChange={e => setDraft({ ...draft, [key]: e.target.value })} /></label>)}
      <label className="space-y-1 text-sm"><span>交易周期</span><select className={`${selectClass} w-full`} value={draft.horizon} onChange={e => setDraft({ ...draft, horizon: e.target.value as AccountTradePlan["horizon"] })}>{Object.entries(HORIZON_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label className="space-y-1 text-sm"><span>计划操作</span><select className={`${selectClass} w-full`} value={draft.intent} onChange={e => setDraft({ ...draft, intent: e.target.value as AccountTradePlan["intent"] })}>{Object.entries(INTENT_LABELS).filter(([k]) => k !== "wait").map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label className="space-y-1 text-sm"><span>计划参考价 ¥（可为建计划时报价，不等于账本成本）</span><Input type="number" min="0" step="any" value={draft.referencePrice || ""} onChange={e => setDraft({ ...draft, referencePrice: Number(e.target.value) })} /></label>
      <label className="space-y-1 text-sm"><span>计划数量（股，可留空）</span><Input type="number" min="1" step="1" value={draft.quantity ?? ""} onChange={e => setDraft({ ...draft, quantity: e.target.value === "" ? null : Number(e.target.value) })} /></label>
      {ruleEditor("止盈", "takeProfit")}{ruleEditor("止损", "stopLoss")}
      <label className="space-y-1 text-sm"><span>计划复核日期（可选）</span><Input type="date" value={draft.expiresOn} onChange={e => setDraft({ ...draft, expiresOn: e.target.value })} /></label></div>
      <p className="text-xs text-muted-foreground">百分比以计划参考价计算：止盈向上，止损向下。止盈止损都可留空，留空的条件不触发价格提示。</p>
      <label className="block space-y-1 text-sm"><span>交易目标、理由与执行条件</span><Textarea value={draft.objective} placeholder="例如：短线等待放量突破；长线观察业绩兑现；记录买入理由、退出条件与可接受的风险。" onChange={e => setDraft({ ...draft, objective: e.target.value })} /></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={generateAfterSave} disabled={preparing} onChange={e => setGenerateAfterSave(e.target.checked)} />保存后根据本计划生成 AI 操作建议和执行计划</label>
      {generateAfterSave && <div className="space-y-2"><select aria-label="保存后分析 Agent" className={`${selectClass} w-full`} value={agentId} disabled={preparing} onChange={e => setAgentId(e.target.value)}><option value="" disabled>选择已启用的 Agent</option>{enabled.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select><p className="text-xs text-muted-foreground">保存后将计划、相关持仓、流水和行情发送给所选 Agent，账号不发送。{!agentId ? "未启用 Agent 时仅保存计划。" : ""}</p></div>}
      <p className="text-xs text-muted-foreground">预览：止盈 {price(planMetrics(draft).takeProfitPrice)} · 止损 {price(planMetrics(draft).stopLossPrice)}</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>}<DialogFooter><Button variant="outline" onClick={() => setDraft(null)}>取消</Button><Button variant="outline" disabled={preparing} onClick={() => save("draft")}>保存计划（草稿）</Button><Button disabled={preparing} onClick={() => save("active")}>保存并跟踪</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
