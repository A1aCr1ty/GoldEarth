import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Trash2, Play, Bot, Pencil } from "lucide-react";
import { useAgents } from "@/store/agents";
import type { Agent, AgentKind } from "@/types";
/** Codex 的 prompt 是位置参数，不能写成 --prompt；非 git 目录要加 --skip-git-repo-check */
const CODEX_DEFAULT_ARGS = "exec --skip-git-repo-check";
export default function AgentsPage() {
  const { agents, runs, refresh, refreshRuns, create, update, remove, run, cancel } = useAgents();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Agent | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<AgentKind>("codex");
  const [command, setCommand] = useState("codex");
  const [args, setArgs] = useState(CODEX_DEFAULT_ARGS);
  const [description, setDescription] = useState("");
  const [prompts, setPrompts] = useState<Record<string, string>>({});
  const [sessions, setSessions] = useState<Record<string, string | undefined>>({});
  useEffect(() => { refresh(); refreshRuns(); }, [refresh, refreshRuns]);
  function resetForm() {
    setName(""); setDescription(""); setCommand("codex");
    setArgs(CODEX_DEFAULT_ARGS); setKind("codex"); setEditing(null);
  }
  function openCreate() { resetForm(); setOpen(true); }
  function openEdit(a: Agent) {
    setEditing(a);
    setName(a.name); setKind(a.kind); setCommand(a.command);
    setArgs(a.args.join(" ")); setDescription(a.description ?? "");
    setOpen(true);
  }
  async function handleSave() {
    if (!name.trim() || !command.trim()) return;
    const payload = {
      name: name.trim(), kind, command: command.trim(),
      args: args.split(/\s+/).filter(Boolean),
      description: description.trim() || undefined, enabled: true,
    };
    if (editing) await update(editing.id, payload);
    else await create(payload);
    setOpen(false);
    resetForm();
  }
  async function handleRun(a: Agent) {
    const text = (prompts[a.id] ?? "").trim();
    if (!text) return;
    try {
      const r = await run(a.id, text, sessions[a.id]);
      setPrompts((p) => ({ ...p, [a.id]: "" }));
      const id = r.id;
      const timer = setInterval(async () => {
        await refreshRuns();
        const cur = useAgents.getState().runs.find((x) => x.id === id);
        if (cur && cur.status !== "running") {
          clearInterval(timer);
          // 记下会话 ID，下一条消息就能接着聊
          if (cur.sessionId) setSessions((s) => ({ ...s, [a.id]: cur.sessionId }));
        }
      }, 1200);
    } catch (e) {
      setPrompts((p) => ({ ...p, [a.id]: `发送失败：${e}` }));
    }
  }
  function startNewSession(agentId: string) {
    setSessions((s) => ({ ...s, [agentId]: undefined }));
  }
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 items-center justify-between border-b px-6">
        <div>
          <h1 className="text-lg font-semibold">外部 Agent</h1>
          <p className="text-xs text-muted-foreground">通过命令行调用本地 agent 处理个人事务</p>
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null); }}>
          <DialogTrigger asChild>
            <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4" /> 新建 Agent</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editing ? "编辑 Agent" : "新建 Agent"}</DialogTitle>
              <DialogDescription>
                通过命令行列出本地可执行文件（如 <code>codex</code>、<code>claude</code>）以接入。
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <Input placeholder="名称（如：Codex CLI）" value={name} onChange={(e) => setName(e.target.value)} />
              <Select value={kind} onValueChange={(v) => setKind(v as AgentKind)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="codex">Codex</SelectItem>
                  <SelectItem value="custom">自定义</SelectItem>
                </SelectContent>
              </Select>
              <Input placeholder="可执行命令" value={command} onChange={(e) => setCommand(e.target.value)} />
              <div className="space-y-1.5">
                <Input placeholder="参数（空格分隔，使用 {prompt} 作为占位符）" value={args} onChange={(e) => setArgs(e.target.value)} />
                <p className="text-xs text-muted-foreground">
                  不写 <code>{"{prompt}"}</code> 时，prompt 会自动作为最后一个参数追加。
                  Codex 的用法是 <code>codex exec [PROMPT]</code>，prompt 是位置参数，
                  参数填 <code>exec --skip-git-repo-check</code>，不要写成 <code>exec --prompt</code>。
                  运行目录不是 git 仓库时 Codex 会以 “Not inside a trusted directory” 拒绝执行，
                  <code>--skip-git-repo-check</code> 就是解这个的，漏填时 App 也会自动补上。
                </p>
              </div>
              <Textarea placeholder="说明（可选）" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>取消</Button>
              <Button onClick={handleSave} disabled={!name.trim() || !command.trim()}>{editing ? "保存" : "创建"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </header>
      <div className="grid flex-1 grid-cols-1 gap-4 overflow-hidden p-6 lg:grid-cols-2">
        <div className="flex flex-col gap-3 overflow-hidden">
          <h2 className="text-sm font-medium">已配置</h2>
          <ScrollArea className="min-h-0 flex-1 pr-2">
            <div className="space-y-2">
              {agents.length === 0 && (
                <Card className="border-dashed">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2"><Bot className="h-4 w-4" /> 还没有 Agent</CardTitle>
                    <CardDescription>新建一个来调用本地的 Codex CLI。</CardDescription>
                  </CardHeader>
                </Card>
              )}
              {agents.map((a: Agent) => (
                <Card key={a.id}>
                  <CardHeader className="flex flex-row items-start justify-between space-y-0">
                    <div>
                      <CardTitle className="flex items-center gap-2">{a.name}<Badge variant="secondary">{a.kind}</Badge></CardTitle>
                      {a.description && <CardDescription className="mt-1">{a.description}</CardDescription>}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" onClick={() => openEdit(a)} aria-label="编辑"><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => remove(a.id)} aria-label="删除"><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="rounded-md bg-muted px-2 py-1 font-mono text-xs">{a.command} {a.args.join(" ")}</div>
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button size="sm" variant="outline" className="w-full justify-start">
                          <Bot className="h-4 w-4" /> 打开对话（{runs.filter((r) => r.agentId === a.id).length} 条）
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-2xl">
                        <DialogHeader>
                          <DialogTitle>与 {a.name} 对话</DialogTitle>
                          <DialogDescription>
                            Agent 在笔记仓库目录内工作，可以直接新建和修改你的 Markdown 笔记。
                            {sessions[a.id] ? "当前是续接上一轮的会话。" : "这是新会话。"}
                          </DialogDescription>
                        </DialogHeader>
                        <ScrollArea className="min-h-0 flex-1 pr-3">
                          <div className="space-y-2">
                            {runs.filter((r) => r.agentId === a.id).length === 0 && (
                              <p className="text-xs text-muted-foreground">还没有对话记录。</p>
                            )}
                            {runs
                              .filter((r) => r.agentId === a.id)
                              .slice()
                              .reverse()
                              .map((r) => (
                                <div key={r.id} className="space-y-1 rounded-md border p-2">
                                  <div className="text-xs font-medium text-muted-foreground">你 · {new Date(r.startedAt).toLocaleTimeString()}</div>
                                  <div className="whitespace-pre-wrap text-sm">{r.prompt}</div>
                                  <div className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
                                    {a.name}
                                    <Badge variant={r.status === "succeeded" ? "default" : r.status === "failed" ? "destructive" : "secondary"}>{r.status}</Badge>
                                  </div>
                                  <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">{r.output || r.error || "(无输出)"}</pre>
                                </div>
                              ))}
                          </div>
                        </ScrollArea>
                        <div className="space-y-2">
                          <Textarea
                            placeholder="接着说…（Enter 发送，Shift+Enter 换行）"
                            value={prompts[a.id] ?? ""}
                            onChange={(e) => setPrompts((p) => ({ ...p, [a.id]: e.target.value }))}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                void handleRun(a);
                              }
                            }}
                            rows={3}
                          />
                          <DialogFooter className="gap-2 sm:justify-between">
                            <Button variant="ghost" size="sm" onClick={() => startNewSession(a.id)}>新会话</Button>
                            <Button size="sm" onClick={() => void handleRun(a)} disabled={!(prompts[a.id] ?? "").trim()}>
                              <Play className="h-4 w-4" /> 发送
                            </Button>
                          </DialogFooter>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollArea>
        </div>
        <div className="flex flex-col gap-3 overflow-hidden">
          <h2 className="text-sm font-medium">全部运行记录</h2>
          <ScrollArea className="min-h-0 flex-1 pr-2">
            <div className="space-y-2">
              {runs.length === 0 && <p className="text-xs text-muted-foreground">尚无运行记录。</p>}
              {runs.map((r) => (
                <Card key={r.id}>
                  <CardHeader className="flex flex-row items-start justify-between space-y-0">
                    <div>
                      <CardTitle className="text-sm">{r.prompt.slice(0, 80)}</CardTitle>
                      <CardDescription>{new Date(r.startedAt).toLocaleString()}</CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={r.status === "succeeded" ? "default" : r.status === "failed" ? "destructive" : "secondary"}>{r.status}</Badge>
                      {r.status === "running" && (<Button size="sm" variant="outline" onClick={() => cancel(r.id)}>取消</Button>)}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 text-xs">{r.output || r.error || "(无输出)"}</pre>
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}
