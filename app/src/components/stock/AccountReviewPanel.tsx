import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Loader2, MessageSquarePlus, Send, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { MarkdownView } from "@/components/markdown/MarkdownView";
import { useAgents } from "@/store/agents";
import { tauri } from "@/lib/tauri";
import { accountQuoteCode } from "@/lib/stockAccountMarket";
import { ACCOUNT_REVIEW_PROMPTS, buildAccountReviewContext, reviewSymbols } from "@/lib/stockAccountReview";
import type { StockAccount } from "@/lib/stockAccountImport";
import type { AgentRun, Quote } from "@/types";

export function AccountReviewPanel({ account, quotes, quoteError }: { account: StockAccount; quotes: Record<string, Quote>; quoteError: string }) {
  const agents = useAgents((s) => s.agents);
  const refreshAgents = useAgents((s) => s.refresh);
  const initStream = useAgents((s) => s.initStream);
  const runs = useAgents((s) => s.runs);
  const stream = useAgents((s) => s.stream);
  const runAgent = useAgents((s) => s.run);
  const cancel = useAgents((s) => s.cancel);
  const enabledAgents = useMemo(() => agents.filter((a) => a.enabled), [agents]);
  const [agentId, setAgentId] = useState("");
  const [history, setHistory] = useState<AgentRun[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [error, setError] = useState("");
  const [input, setInput] = useState("");
  const [focus, setFocus] = useState("all");
  const [horizon, setHorizon] = useState("");
  const [riskBudget, setRiskBudget] = useState("");
  const aliveRef = useRef(true);
  const sendLock = useRef(false);
  const busy = preparing || activeId !== null;
  const securityOptions = [...new Map([...account.positions, ...(account.tradePlans ?? []), ...(account.transactions ?? []).filter((t) => t.side !== "other")].map((p) => [p.code, p.name])).entries()];
  const selectClass = "h-8 rounded-md border bg-background px-2 text-xs";

  useEffect(() => {
    aliveRef.current = true;
    void refreshAgents();
    void initStream().catch((e) => aliveRef.current && setError(String(e)));
    return () => { aliveRef.current = false; };
  }, [refreshAgents, initStream]);
  useEffect(() => {
    if (!enabledAgents.some((a) => a.id === agentId)) setAgentId(enabledAgents[0]?.id ?? "");
  }, [enabledAgents, agentId]);
  useEffect(() => {
    let alive = true;
    setHistory([]); setSessionId(null); setActiveId(null); setError("");
    if (!agentId) return;
    setLoadingHistory(true);
    void Promise.all([tauri.listStockAccountRuns(account.id, agentId), tauri.getStockAccountAgentSession(account.id, agentId)])
      .then(([records, sid]) => {
        if (!alive) return;
        setHistory(records); setSessionId(sid);
        setActiveId(records.find((r) => r.status === "running" || r.status === "pending")?.id ?? null);
      }).catch((e) => alive && setError(`读取复盘记录失败：${e}`))
      .finally(() => alive && setLoadingHistory(false));
    return () => { alive = false; };
  }, [account.id, agentId]);
  const finished = activeId ? runs.find((r) => r.id === activeId) : undefined;
  useEffect(() => {
    if (!finished || finished.status === "running" || finished.status === "pending") return;
    setHistory((previous) => [finished, ...previous.filter((r) => r.id !== finished.id)]);
    setSessionId(finished.status === "succeeded" ? finished.sessionId ?? null : null);
    setActiveId(null);
  }, [finished]);

  async function send(override?: string) {
    const text = (override ?? input).trim();
    if (!text || !agentId || busy || loadingHistory || sendLock.current) return;
    sendLock.current = true; setPreparing(true); setError("");
    try {
      await initStream();
      const codes = reviewSymbols(account, focus);
      const [quoteResult, ...chartResults] = await Promise.allSettled([
        codes.length ? tauri.stockQuotes(codes) : Promise.resolve([] as Quote[]),
        ...codes.map((code) => tauri.stockKline(code, "day", 500)),
      ]);
      const latestQuotes = { ...quotes };
      let marketError = quoteError;
      if (quoteResult.status === "fulfilled") {
        for (const code of codes) delete latestQuotes[code];
        for (const quote of quoteResult.value as Quote[]) {
          const code = accountQuoteCode(quote.code);
          if (code && codes.includes(code) && Number.isFinite(quote.price) && quote.price > 0) latestQuotes[code] = quote;
        }
        marketError = codes.filter((code) => !latestQuotes[code]).length ? "部分标的本轮缺少报价，沿用导入价，详见每项来源" : "";
      } else marketError = `本轮行情获取失败，以下可能包含上次报价：${String(quoteResult.reason)}`;
      const charts = chartResults.map((r, i) => ({ code: codes[i], bars: r.status === "fulfilled" ? r.value as import("@/types").Candle[] : [], error: r.status === "rejected" ? String(r.reason) : undefined }));
      if (!aliveRef.current) return;
      const context = buildAccountReviewContext(account, latestQuotes, charts, { focus, horizon, riskBudget, quoteError: marketError, asOf: new Date().toISOString() });
      const run = await runAgent(agentId, text, sessionId ?? undefined, undefined, context, undefined, undefined, account.id);
      if (!aliveRef.current) return;
      setHistory((previous) => [run, ...previous]); setActiveId(run.id); setInput("");
    } catch (e) { if (aliveRef.current) setError(`复盘启动失败：${e}`); }
    finally { sendLock.current = false; if (aliveRef.current) setPreparing(false); }
  }

  return <Card>
    <CardHeader><CardTitle className="flex items-center gap-2"><Bot className="h-4 w-4" />AI 交易复盘与后续计划</CardTitle><CardDescription>每轮附带当前交易计划（最多 30 条）、最新估值、最近 120 条流水、30 条清仓结果与最多 5 只股票的历史日K；可选择单只证券深入复盘。记录按账户与 Agent 保存。</CardDescription></CardHeader>
    <CardContent className="space-y-3">
      {enabledAgents.length ? <>
        <div className="flex flex-wrap gap-2">
          <select aria-label="复盘 Agent" className={selectClass} value={agentId} disabled={busy} onChange={(e) => setAgentId(e.target.value)}>{enabledAgents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          <select aria-label="复盘范围" className={selectClass} value={focus} disabled={busy} onChange={(e) => setFocus(e.target.value)}><option value="all">全部账户持仓与交易</option>{securityOptions.map(([code, name]) => <option key={code} value={code}>{name} · {code}</option>)}</select>
          <select aria-label="计划持有周期" className={selectClass} value={horizon} disabled={busy} onChange={(e) => setHorizon(e.target.value)}><option value="">持有周期：未设置</option>{["短线（数日）", "波段（数周）", "中长期（数月及以上）"].map((v) => <option key={v}>{v}</option>)}</select>
          <select aria-label="风险预算" className={selectClass} value={riskBudget} disabled={busy} onChange={(e) => setRiskBudget(e.target.value)}><option value="">风险预算：未设置</option>{["保守，优先控制回撤", "均衡，接受中等波动", "积极，接受较高波动"].map((v) => <option key={v}>{v}</option>)}</select>
          <Button size="sm" variant="ghost" disabled={busy || loadingHistory} onClick={() => setSessionId(null)}><MessageSquarePlus className="h-3.5 w-3.5" />新会话</Button>
        </div>
        <div className="max-h-[480px] space-y-4 overflow-y-auto rounded-md border p-3">
          {loadingHistory ? <p className="text-xs text-muted-foreground">正在读取复盘记录…</p> : !history.length && <p className="text-sm text-muted-foreground">选择下方快捷复盘，或输入你想分析的交易。还未导入交易流水时，可先重新导入账本文件。</p>}
          {[...history].reverse().map((run) => <div key={run.id} className="space-y-2"><div className="rounded-md bg-primary/5 p-2 text-sm"><div className="mb-1 text-xs text-muted-foreground">{new Date(run.startedAt).toLocaleString("zh-CN")}</div>{run.prompt}</div>{run.output && run.status !== "running" ? <MarkdownView source={run.output} /> : null}{run.error && <p className="text-sm text-destructive">{run.error}</p>}{run.status === "cancelled" && <p className="text-xs text-muted-foreground">已停止</p>}</div>)}
          {activeId && <div className="text-sm">{stream[activeId] ? <MarkdownView source={stream[activeId]} /> : <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />正在分析…</p>}</div>}
          {preparing && <p className="text-xs text-muted-foreground">正在准备最新行情与交易上下文…</p>}
        </div>
        <div className="flex flex-wrap gap-2">{ACCOUNT_REVIEW_PROMPTS.map((p) => <Button key={p.label} size="sm" variant="outline" disabled={busy || loadingHistory} onClick={() => void send(p.text)}>{p.label}</Button>)}</div>
        <Textarea aria-label="交易复盘问题" placeholder="例如：最近这几次加仓是否合理？后续什么条件下考虑减仓？" value={input} disabled={busy} onChange={(e) => setInput(e.target.value)} className="min-h-[80px]" />
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="max-w-xl text-xs leading-5 text-muted-foreground">点击发送将持仓、交易摘要和行情交给所选 Agent，账号不发送；建议生成后由你决定是否操作。</span>{activeId ? <Button size="sm" variant="outline" onClick={() => void cancel(activeId).catch((e) => setError(String(e)))}><Square className="h-3.5 w-3.5" />停止</Button> : <Button size="sm" disabled={!input.trim() || busy || loadingHistory} onClick={() => void send()}><Send className="h-3.5 w-3.5" />发送</Button>}</div>
      </> : <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground"><span>先在 Agent 页面配置并启用分析助手，再开始账户复盘。</span><Button size="sm" variant="outline" onClick={() => { window.location.hash = "#/agents"; }}>配置 Agent</Button></div>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </CardContent>
  </Card>;
}
