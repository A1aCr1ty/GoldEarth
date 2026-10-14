import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, MessageSquarePlus, Send, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MarkdownView } from "@/components/markdown/MarkdownView";
import { useAgents } from "@/store/agents";
import { tauri } from "@/lib/tauri";
import type { AgentRun, Note } from "@/types";

interface Props {
  note: Note;
  /** 编辑器里当前的内容（可能含未保存改动），作为发给 agent 的上下文 */
  content: string;
  /** 本轮运行结束（含失败/取消）后回调，父组件据此提示笔记可能被外部改动 */
  onFinished: (run: AgentRun) => void;
}

/** 快捷指令：点一下就把请求填进输入框，改完再发 */
const QUICK_ACTIONS = [
  { key: "summary", label: "总结本篇", prompt: "请总结这篇笔记的核心要点，用 3-5 条要点列出，简洁直接。" },
  { key: "polish", label: "润色", prompt: "请润色这篇笔记的措辞，让表达更清晰易读，保持原意和结构不变。" },
  { key: "tags", label: "生成标签", prompt: "请为这篇笔记生成 3-6 个标签，只输出标签，用逗号分隔，不要其他内容。" },
] as const;

const AGENT_KEY = "goldearth.noteAgentId";

/** 开新会话时不带笔记全文，让 agent 自己按文件名去读 */
function buildContext(note: Note, content: string, filePath: string | null): string {
  return [
    "你在一个本地笔记应用里工作，当前目录就是笔记仓库（vault），可以直接读写里面的 .md 文件。",
    filePath ? `当前笔记的文件路径：${filePath}` : "当前笔记的文件路径未找到，请先在笔记列表里确认这篇笔记还在。",
    "",
    "以下是这篇笔记现在的内容：",
    "-----",
    content || "（空）",
    "-----",
    "",
    "如果需要改这篇笔记，请直接编辑上面那个文件；只回答问题则不要动文件。",
  ].join("\n");
}

export function NoteAgentChat({ note, content, onFinished }: Props) {
  const navigate = useNavigate();
  const agents = useAgents((s) => s.agents);
  const refreshAgents = useAgents((s) => s.refresh);
  const runs = useAgents((s) => s.runs);
  const stream = useAgents((s) => s.stream);
  const initStream = useAgents((s) => s.initStream);
  const clearStream = useAgents((s) => s.clearStream);
  const runAgent = useAgents((s) => s.run);
  const cancelRun = useAgents((s) => s.cancel);

  const [agentId, setAgentId] = useState<string>("");
  const [history, setHistory] = useState<AgentRun[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const enabledAgents = useMemo(() => agents.filter((a) => a.enabled), [agents]);
  /** 这一轮是为哪篇笔记发起的；切到别的笔记时就不该显示成「正在对话」 */
  const activeNoteId = activeRunId ? runs.find((r) => r.id === activeRunId)?.noteId : undefined;
  const busy = activeRunId !== null && (activeNoteId === undefined || activeNoteId === note.id);
  const streaming = activeRunId ? (stream[activeRunId] ?? "") : "";

  useEffect(() => {
    void initStream();
    void refreshAgents();
  }, [initStream, refreshAgents]);

  // 选中的 agent 记在本地，换笔记回来还是同一个
  useEffect(() => {
    if (agentId) return;
    const saved = localStorage.getItem(AGENT_KEY);
    if (saved && enabledAgents.some((a) => a.id === saved)) setAgentId(saved);
    else if (enabledAgents.length > 0) setAgentId(enabledAgents[0].id);
  }, [agentId, enabledAgents]);

  // 换笔记或换 agent：重新载入这段对话的历史和可续话的会话 ID
  useEffect(() => {
    let alive = true;
    if (!note || !agentId) {
      setHistory([]);
      setSessionId(null);
      return;
    }
    (async () => {
      const [runs, sid, path] = await Promise.all([
        tauri.listNoteRuns(note.id, agentId),
        tauri.getNoteAgentSession(note.id, agentId),
        tauri.getNoteFilePath(note.id),
      ]);
      if (!alive) return;
      setHistory(runs);
      setSessionId(sid);
      setFilePath(path);
      setError(null);
    })().catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, [note?.id, agentId]);

  // 运行结束：把流式缓冲换成落库的最终结果，并同步会话 ID
  const finished = activeRunId ? runs.find((r) => r.id === activeRunId) : undefined;
  useEffect(() => {
    if (!activeRunId || !finished || finished.status === "running") return;
    const done = finished;
    setActiveRunId(null);
    clearStream(done.id);
    // 会话 ID 属于发起它的那篇笔记，别把别的笔记的会话串过来
    if (done.noteId === note.id) {
      if (done.sessionId) setSessionId(done.sessionId);
      void tauri.listNoteRuns(note.id, agentId).then(setHistory).catch(() => {});
    }
    onFinished(done);
  }, [activeRunId, finished, clearStream, note.id, agentId, onFinished]);

  useEffect(() => {
    // 新增消息才做平滑滚动；流式出字期间改用瞬时滚动，
    // 否则每来一段都会排一个平滑动画，动画队列足以把主线程压满
    bottomRef.current?.scrollIntoView({ behavior: streaming ? "auto" : "smooth" });
  }, [history.length, streaming]);

  function handleAgentChange(next: string) {
    setAgentId(next);
    localStorage.setItem(AGENT_KEY, next);
  }

  /** 新会话：丢掉 resume 用的会话 ID，历史记录仍保留 */
  function handleNewSession() {
    setSessionId(null);
  }

  async function handleSend(textOverride?: string) {
    const text = (textOverride ?? input).trim();
    if (!text || !agentId || busy) return;
    setInput("");
    setError(null);
    try {
      // 只在这段会话的第一轮带上笔记全文，之后靠 resume 里的上下文接着聊
      const context = sessionId ? undefined : buildContext(note, content, filePath);
      const run = await runAgent(agentId, text, sessionId ?? undefined, note.id, context);
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
        <p className="text-sm text-muted-foreground">还没有可用的 agent。</p>
        <Button size="sm" onClick={() => navigate("/agents")}>去新建一个</Button>
      </div>
    );
  }

  // 历史是「最新在前」，这里翻成时间正序展示
  const messages = [...history].reverse();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-14 items-center gap-2 border-b px-3">
        <Select value={agentId} onValueChange={handleAgentChange}>
          <SelectTrigger className="h-8 flex-1"><SelectValue placeholder="选择 agent" /></SelectTrigger>
          <SelectContent>
            {enabledAgents.map((a) => (<SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>))}
          </SelectContent>
        </Select>
        <Button size="icon" variant="ghost" aria-label="开新会话" title="开新会话" onClick={handleNewSession}>
          <MessageSquarePlus className="h-4 w-4" />
        </Button>
      </div>

      {filePath && (
        <div className="flex items-center gap-2 border-b px-3 py-1.5 text-[0.6875rem] text-muted-foreground">
          笔记文件：<span className="font-mono">{filePath}</span>
        </div>
      )}

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 p-3">
          {messages.length === 0 && !busy && (
            <p className="text-xs text-muted-foreground">
              还没有对话。可以直接问「这篇讲了什么」，或让 agent 直接改这篇笔记。
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
              <div className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                正在思考…
              </div>
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
          placeholder="让 agent 处理这篇笔记…（Enter 发送，Shift+Enter 换行）"
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
        <div className="max-w-[90%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground whitespace-pre-wrap">
          {children}
        </div>
      </div>
    );
  }
  if (role === "error") {
    return (
      <div className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive whitespace-pre-wrap">
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