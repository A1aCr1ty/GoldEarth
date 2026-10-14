import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FolderOpen, Loader2, MessageSquarePlus, Send, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MarkdownView } from "@/components/markdown/MarkdownView";
import { useAgents } from "@/store/agents";
import { useLibrary } from "@/store/library";
import { tauri } from "@/lib/tauri";
import type { AgentRun, LibraryCategory, LibraryFile } from "@/types";

interface Props {
  category: LibraryCategory;
  /** 这一类里收的资料，发给 agent 让它知道手上有哪些文件 */
  files: LibraryFile[];
  /** 分类目录的绝对路径，agent 的工作目录就是它 */
  dir: string | null;
  /** 运行结束（含失败/取消）后回调，父组件据此刷新资料列表 */
  onFinished: (run: AgentRun) => void;
}

/** 知识库里的快捷指令：都围绕「这一类资料」而不是单篇文件 */
const QUICK_ACTIONS = [
  {
    key: "index",
    label: "生成索引",
    prompt:
      "请浏览当前目录下的所有文件，为这一类资料生成一份 README.md 索引：按主题分组，每份资料一行，写清楚文件名和它的用途。写到当前目录的 README.md 里。",
  },
  {
    key: "summary",
    label: "汇总要点",
    prompt: "请阅读当前目录下的资料，汇总出这一类资料的核心要点，用 5-10 条列出，并注明每条出自哪个文件。",
  },
  {
    key: "gaps",
    label: "找缺口",
    prompt: "请通读当前目录下的资料，指出还缺哪些关键信息、哪些结论缺少数据支撑，按优先级列出来。",
  },
] as const;

/** 告诉 agent 它在哪、手上有哪些资料 —— 只在每段会话的第一轮带上 */
function buildContext(category: LibraryCategory, files: LibraryFile[], dir: string | null): string {
  const listing = files.length
    ? files.map((f) => `- ${f.name}（${humanSize(f.size)}）`).join("\n")
    : "（当前这一类还没有资料）";
  return [
    "你在一个本地知识库里工作，当前目录就是这个分类的资料目录，可以直接读写里面的文件。",
    dir ? `资料目录：${dir}` : "资料目录未找到，请确认这个分类还在。",
    `分类：${category.name}${category.description ? `（${category.description}）` : ""}`,
    "",
    "这一类已经收好的资料：",
    listing,
    "",
    "这些资料是用户珍藏的原始文件，除非用户明确要求，否则不要修改或删除它们；",
    "要产出新内容就新建文件（例如 README.md），并在回答里说明你新建或改了哪个文件。",
  ].join("\n");
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function LibraryAgentChat({ category, files, dir, onFinished }: Props) {
  const navigate = useNavigate();
  const agents = useAgents((s) => s.agents);
  const refreshAgents = useAgents((s) => s.refresh);
  const runs = useAgents((s) => s.runs);
  const stream = useAgents((s) => s.stream);
  const initStream = useAgents((s) => s.initStream);
  const clearStream = useAgents((s) => s.clearStream);
  const runAgent = useAgents((s) => s.run);
  const cancelRun = useAgents((s) => s.cancel);
  const setAgentOnCategory = useLibrary((s) => s.setAgent);

  const [agentId, setAgentId] = useState("");
  const [history, setHistory] = useState<AgentRun[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const enabledAgents = useMemo(() => agents.filter((a) => a.enabled), [agents]);
  /** 这一轮是为哪个分类跑的；切到别的分类就不该显示成「正在对话」 */
  const activeLibraryId = activeRunId ? runs.find((r) => r.id === activeRunId)?.libraryId : undefined;
  const busy = activeRunId !== null && (activeLibraryId === undefined || activeLibraryId === category.id);
  const streaming = activeRunId ? (stream[activeRunId] ?? "") : "";

  useEffect(() => {
    void initStream();
    void refreshAgents();
  }, [initStream, refreshAgents]);

  // 分类绑了哪个 agent 就用哪个；没绑或它被删了，退回第一个可用的
  useEffect(() => {
    const bound = category.agentId && enabledAgents.some((a) => a.id === category.agentId) ? category.agentId : "";
    if (bound) {
      setAgentId(bound);
      return;
    }
    setAgentId((current) => {
      if (current && enabledAgents.some((a) => a.id === current)) return current;
      return enabledAgents[0]?.id ?? "";
    });
  }, [category.agentId, category.id, enabledAgents]);

  // 换分类或换 agent：重新载入这段对话的历史和可续聊的会话 ID
  useEffect(() => {
    let alive = true;
    if (!agentId) {
      setHistory([]);
      setSessionId(null);
      return;
    }
    (async () => {
      const [runs, sid] = await Promise.all([
        tauri.listLibraryRuns(category.id, agentId),
        tauri.getLibraryAgentSession(category.id, agentId),
      ]);
      if (!alive) return;
      setHistory(runs);
      setSessionId(sid);
      setError(null);
    })().catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, [category.id, agentId]);

  // 运行结束：把流式缓冲换成落库的最终结果，并同步会话 ID
  const finished = activeRunId ? runs.find((r) => r.id === activeRunId) : undefined;
  useEffect(() => {
    if (!activeRunId || !finished || finished.status === "running") return;
    const done = finished;
    setActiveRunId(null);
    clearStream(done.id);
    // 会话 ID 属于发起它的那个分类，别把别的分类的会话串过来
    if (done.libraryId === category.id) {
      if (done.sessionId) setSessionId(done.sessionId);
      void tauri.listLibraryRuns(category.id, agentId).then(setHistory).catch(() => {});
      // agent 可能新建了文件（比如 README.md），让资料列表跟着刷新
      void useLibrary.getState().refreshFiles();
    }
    onFinished(done);
  }, [activeRunId, finished, clearStream, category.id, agentId, onFinished]);

  useEffect(() => {
    // 新增消息才做平滑滚动；流式出字期间改用瞬时滚动，
    // 否则每来一段都会排一个平滑动画，动画队列足以把主线程压满
    bottomRef.current?.scrollIntoView({ behavior: streaming ? "auto" : "smooth" });
  }, [history.length, streaming]);

  function handleAgentChange(next: string) {
    setAgentId(next);
    // 分类绑定的 agent 就记在分类上：「分类对应 agent」这件事是持久的
    void setAgentOnCategory(category.id, next);
  }

  function handleNewSession() {
    setSessionId(null);
  }

  async function handleSend(textOverride?: string) {
    const text = (textOverride ?? input).trim();
    if (!text || !agentId || busy) return;
    setInput("");
    setError(null);
    try {
      // 第一轮带上「目录 + 资料清单」，之后靠 resume 里的上下文接着聊
      const context = sessionId ? undefined : buildContext(category, files, dir);
      const run = await runAgent(agentId, text, sessionId ?? undefined, undefined, context, undefined, category.id);
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
        <p className="text-sm text-muted-foreground">还没有可用的 agent，知识库需要它来读这些资料。</p>
        <Button size="sm" onClick={() => navigate("/agents")}>去新建一个</Button>
      </div>
    );
  }

  const messages = [...history].reverse();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-14 flex-wrap items-center gap-2 border-b px-3 py-1.5">
        <Select value={agentId} onValueChange={handleAgentChange}>
          <SelectTrigger className="h-8 min-w-0 flex-1"><SelectValue placeholder="选择 agent" /></SelectTrigger>
          <SelectContent>
            {enabledAgents.map((a) => (<SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>))}
          </SelectContent>
        </Select>
        <Button size="icon" variant="ghost" aria-label="开新会话" title="开新会话" onClick={handleNewSession}>
          <MessageSquarePlus className="h-4 w-4" />
        </Button>
      </div>

      {dir && (
        <div className="flex items-center gap-2 border-b px-3 py-1.5 text-[0.6875rem] text-muted-foreground">
          <FolderOpen className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate font-mono" title={dir}>{dir}</span>
          <span className="ml-auto shrink-0">{files.length} 份资料</span>
        </div>
      )}

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 p-3">
          {messages.length === 0 && !busy && (
            <p className="text-xs text-muted-foreground">
              还没有对话。agent 的工作目录就是「{category.name}」的资料目录，
              可以让它读这些资料回答问题，或者整理出一份索引。
            </p>
          )}
          {messages.map((r) => (
            <div key={r.id} className="space-y-3">
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
              <div className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">正在思考…</div>
            )
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {error && <div className="border-t bg-destructive/10 px-3 py-1.5 text-[0.6875rem] text-destructive">{error}</div>}

      <div className="space-y-2 border-t p-3">
        <div className="flex flex-wrap gap-1.5">
          {QUICK_ACTIONS.map((q) => (
            <Badge
              key={q.key}
              variant="secondary"
              className="cursor-pointer select-none hover:bg-accent"
              onClick={() => setInput(q.prompt)}
            >
              {q.label}
            </Badge>
          ))}
          {sessionId && <Badge variant="outline" className="ml-auto">可续聊</Badge>}
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
          placeholder="让 agent 读这些资料……（Enter 发送，Shift+Enter 换行）"
          className="min-h-[4.5rem] resize-none text-sm"
          disabled={busy}
        />
        <div className="flex justify-end">
          {busy ? (
            <Button size="sm" variant="outline" onClick={() => void handleStop()}>
              <Square className="h-3.5 w-3.5" /> 停止
            </Button>
          ) : (
            <Button size="sm" disabled={!input.trim()} onClick={() => void handleSend()}>
              <Send className="h-3.5 w-3.5" /> 发送
            </Button>
          )}
        </div>
        {busy && (
          <p className="flex items-center justify-end gap-1 text-[0.6875rem] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> 运行中
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
        <div className="max-w-[90%] whitespace-pre-wrap rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
          {children}
        </div>
      </div>
    );
  }
  if (role === "error") {
    return (
      <div className="whitespace-pre-wrap rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
        {children}
      </div>
    );
  }
  return (
    <div className="rounded-lg bg-muted px-3 py-2 text-sm">
      <MarkdownView source={String(children)} />
    </div>
  );
}