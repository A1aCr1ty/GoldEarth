/**
 * 股票 Agent 分析面板。
 *
 * 复用笔记页那套流式机制（`agent://stream` / `agent://done`），
 * 区别在于：会话按股票分区，上下文里带的是行情数据而不是笔记正文。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, MessageSquarePlus, Send, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MarkdownView } from "@/components/markdown/MarkdownView";
import { useAgents } from "@/store/agents";
import { useStocks } from "@/store/stocks";
import { buildMarketContext } from "@/lib/marketContext";
import { tauri } from "@/lib/tauri";

/** 常用分析请求，点一下填进输入框 */
const PRESETS = [
  { key: "analyze", label: "综合分析", prompt: "请综合分析这只股票：趋势、均线形态、MACD/RSI/KDJ 指标状态、量价配合、资金流向，并指出关键支撑位和压力位。" },
  { key: "trend", label: "趋势研判", prompt: "这只股票目前处于什么趋势阶段？请结合均线排列和近期K线说明依据。" },
  { key: "risk", label: "风险点", prompt: "这只股票当前有哪些风险信号？请从指标背离、量价异常、估值和资金流角度分析。" },
  { key: "flow", label: "资金面", prompt: "根据资金流向数据，这只股票的主力资金态度如何？和股价走势是否背离？" },
];

const AGENT_KEY = "goldearth.stockAgentId";

export function StockAgentPanel() {
  const { current, detail, klines, trend, flow } = useStocks();
  const agents = useAgents((s) => s.agents);
  const refreshAgents = useAgents((s) => s.refresh);
  const runs = useAgents((s) => s.runs);
  const stream = useAgents((s) => s.stream);
  const initStream = useAgents((s) => s.initStream);
  const clearStream = useAgents((s) => s.clearStream);
  const runAgent = useAgents((s) => s.run);
  const cancelRun = useAgents((s) => s.cancel);

  const [agentId, setAgentId] = useState("");
  const [history, setHistory] = useState<import("@/types").AgentRun[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const enabledAgents = useMemo(() => agents.filter((a) => a.enabled), [agents]);
  const busy = activeRunId !== null;
  const streaming = activeRunId ? (stream[activeRunId] ?? "") : "";

  useEffect(() => {
    void initStream();
    void refreshAgents();
  }, [initStream, refreshAgents]);

  useEffect(() => {
    if (agentId) return;
    const saved = localStorage.getItem(AGENT_KEY);
    if (saved && enabledAgents.some((a) => a.id === saved)) setAgentId(saved);
    else if (enabledAgents.length > 0) setAgentId(enabledAgents[0].id);
  }, [agentId, enabledAgents]);

  // 换股票：换一套会话线，历史跟着切
  useEffect(() => {
    let alive = true;
    if (!current || !agentId) {
      setHistory([]);
      setSessionId(null);
      return;
    }
    (async () => {
      const [runs, sid] = await Promise.all([
        tauri.listStockRuns(current, agentId),
        tauri.getStockAgentSession(current, agentId),
      ]);
      if (!alive) return;
      setHistory(runs);
      setSessionId(sid);
      setError(null);
    })().catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, [current, agentId]);

  const finished = activeRunId ? runs.find((r) => r.id === activeRunId) : undefined;
  useEffect(() => {
    if (!activeRunId || !finished || finished.status === "running") return;
    const done = finished;
    setActiveRunId(null);
    clearStream(done.id);
    if (done.stockCode === current) {
      if (done.sessionId) setSessionId(done.sessionId);
      void tauri.listStockRuns(current, agentId).then(setHistory).catch(() => {});
    }
  }, [activeRunId, finished, clearStream, current, agentId]);

  useEffect(() => {
    // 新增消息才做平滑滚动；流式出字期间改用瞬时滚动，
    // 否则每来一段都会排一个平滑动画，动画队列足以把主线程压满
    bottomRef.current?.scrollIntoView({ behavior: streaming ? "auto" : "smooth" });
  }, [history.length, streaming]);

  async function handleSend(textOverride?: string) {
    const text = (textOverride ?? input).trim();
    if (!text || !agentId || busy || !current) return;
    setInput("");
    setError(null);
    try {
      let context: string | undefined;
      if (!sessionId) {
        // 停在「分时」标签时 klines 是空的，但分析仍然需要历史数据和技术指标，
        // 所以这里临时补一次日 K，而不是把空数据发给 Agent。
        let bars = klines;
        if (bars.length === 0) {
          try {
            bars = await tauri.stockKline(current, "day", 500);
          } catch {
            bars = [];
          }
        }
        context = buildMarketContext(detail, bars, trend, flow);
      }
      const run = await runAgent(agentId, text, sessionId ?? undefined, undefined, context, current);
      setActiveRunId(run.id);
      setHistory((prev) => [run, ...prev]);
    } catch (e) {
      setError(`发送失败：${e}`);
    }
  }

  async function handleStop() {
    if (!activeRunId) return;
    try {
      await cancelRun(activeRunId);
    } catch (e) {
      setError(`停止失败：${e}`);
    }
  }

  if (enabledAgents.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-xs text-muted-foreground">还没有可用的 agent，先到「Agent」页新建一个。</p>
        <Button size="sm" onClick={() => (window.location.hash = "#/agents")}>去新建</Button>
      </div>
    );
  }

  const messages = [...history].reverse();
  const stockName = detail?.name || current;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b bg-muted/40 px-2.5">
        <span className="text-[0.6875rem] font-semibold text-muted-foreground">Agent 分析</span>
        <Select value={agentId} onValueChange={(v) => { setAgentId(v); localStorage.setItem(AGENT_KEY, v); }}>
          <SelectTrigger className="h-6 w-32"><SelectValue placeholder="agent" /></SelectTrigger>
          <SelectContent>
            {enabledAgents.map((a) => (<SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>))}
          </SelectContent>
        </Select>
        <Button
          size="icon"
          variant="ghost"
          className="ml-auto h-6 w-6"
          aria-label="开新会话"
          title="开新会话"
          onClick={() => setSessionId(null)}
        >
          <MessageSquarePlus className="h-3.5 w-3.5" />
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 p-2.5">
          {messages.length === 0 && !busy && (
            <p className="text-[0.6875rem] text-muted-foreground">
              还没有分析记录。可以直接问「这只票还能拿吗」，或用下面的快捷请求开始。
            </p>
          )}
          {messages.map((r) => (
            <div key={r.id} className="space-y-2">
              <Bubble role="user">{r.prompt}</Bubble>
              {r.status === "running" ? null : r.output && r.output !== "(无输出)" ? (
                <Bubble role="agent">{r.output}</Bubble>
              ) : r.error ? (
                <Bubble role="error">{r.error}</Bubble>
              ) : null}
            </div>
          ))}
          {busy && (
            streaming ? (
              <Bubble role="agent">{streaming}</Bubble>
            ) : (
              <div className="rounded-lg bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">正在分析…</div>
            )
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {error && <div className="border-t bg-destructive/10 px-2.5 py-1 text-[0.6875rem] text-destructive">{error}</div>}

      <div className="space-y-2 border-t p-2.5">
        <div className="flex flex-wrap gap-1">
          {PRESETS.map((p) => (
            <Badge
              key={p.key}
              variant="secondary"
              className="cursor-pointer select-none text-[0.625rem] hover:bg-accent"
              onClick={() => void handleSend(p.prompt)}
            >
              {p.label}
            </Badge>
          ))}
          {sessionId && <Badge variant="outline" className="ml-auto text-[0.625rem]">可续聊</Badge>}
        </div>
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          placeholder={`问点什么关于 ${stockName} 的…`}
          className="min-h-[3.75rem] resize-none text-xs"
          disabled={busy}
        />
        <div className="flex items-center justify-between">
          <span className="text-[0.625rem] text-muted-foreground">{current || "未选择标的"}</span>
          {busy ? (
            <Button size="sm" variant="outline" className="h-7" onClick={() => void handleStop()}>
              <Square className="h-3 w-3" /> 停止
            </Button>
          ) : (
            <Button size="sm" className="h-7" disabled={!input.trim()} onClick={() => void handleSend()}>
              <Send className="h-3 w-3" /> 发送
            </Button>
          )}
        </div>
        {busy && (
          <p className="flex items-center justify-end gap-1 text-[0.625rem] text-muted-foreground">
            <Loader2 className="h-2.5 w-2.5 animate-spin" /> 运行中
          </p>
        )}
      </div>
    </div>
  );
}

function Bubble({ role, children }: { role: "user" | "agent" | "error"; children: React.ReactNode }) {
  if (role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[90%] whitespace-pre-wrap rounded-lg bg-primary px-2.5 py-1.5 text-xs text-primary-foreground">
          {children}
        </div>
      </div>
    );
  }
  if (role === "error") {
    return (
      <div className="whitespace-pre-wrap rounded-lg bg-destructive/10 px-2.5 py-1.5 text-[0.6875rem] text-destructive">
        {children}
      </div>
    );
  }
  return (
    <div className="rounded-lg bg-muted px-2.5 py-1.5 text-xs">
      <MarkdownView source={String(children)} />
    </div>
  );
}