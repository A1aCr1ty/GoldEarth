import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Bot, Plus, Trash2, Save } from "lucide-react";
import { useNotes, currentNote } from "@/store/notes";
import { useCategories } from "@/store/categories";
import { MarkdownEditor } from "@/components/markdown/MarkdownEditor";
import { NoteAgentChat } from "@/components/agent/NoteAgentChat";
import type { AgentRun, Note, NoteFormat } from "@/types";
/** 表单载入时的快照，用来判断用户之后有没有改动过 */
type NoteSnapshot = { id: string; modified?: string; title: string; content: string; categoryId: string | null; format: NoteFormat; tags: string };
function sameForm(a: NoteSnapshot, b: NoteSnapshot) {
  return a.id === b.id && a.title === b.title && a.content === b.content &&
    a.categoryId === b.categoryId && a.format === b.format && a.tags === b.tags;
}
function snapshotOf(n: Note): NoteSnapshot {
  return {
    id: n.id,
    modified: n.modified,
    title: n.title,
    content: n.content,
    categoryId: n.categoryId,
    format: n.format,
    tags: n.tags.join(", "),
  };
}
export default function NotesPage() {
  const { items, refresh, currentId, select, create, update, remove } = useNotes();
  const categories = useCategories((s) => s.items);
  const refreshCategories = useCategories((s) => s.refresh);
  const note = useNotes(currentNote);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [format, setFormat] = useState<NoteFormat>("markdown");
  const [tagsInput, setTagsInput] = useState("");
  const [conflict, setConflict] = useState<string | null>(null);
  /** Agent 在磁盘上改了笔记，但你本地还有没保存的改动 */
  const [external, setExternal] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);
  const [reloadTick, setReloadTick] = useState(0);
  const [saveStatus, setSaveStatus] = useState("已自动保存");
  /** 已载入进表单的那份内容 */
  const loaded = useRef<NoteSnapshot | null>(null);
  /** 表单相对载入内容是否有改动，用它决定能不能覆盖编辑区 */
  const formDirty = useRef(false);
  const draft = useRef<NoteSnapshot | null>(null);
  const saving = useRef<Promise<boolean> | null>(null);
  const blocked = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const handleSave = useCallback((): Promise<boolean> => {
    clearTimeout(timer.current);
    if (saving.current) return saving.current;
    if (blocked.current) return Promise.resolve(false);
    const task = async () => {
      // 串行写入；保存期间继续输入的内容在下一轮写入，不能被旧响应覆盖。
      while (draft.current && loaded.current && !sameForm(draft.current, loaded.current)) {
        const submitted = { ...draft.current };
        const base = loaded.current;
        setSaveStatus("正在保存…");
        try {
          await update(submitted.id, {
            title: submitted.title.trim() || "未命名笔记",
            content: submitted.content,
            categoryId: submitted.categoryId,
            format: submitted.format,
            tags: submitted.tags.split(/[,\s]+/).map((t) => t.trim()).filter(Boolean),
            expectedModified: base.modified,
          }, (saved) => {
            if (loaded.current?.id !== submitted.id) return;
            // 在 store 通知页面前确认新版本，避免自己的保存被当成外部修改。
            // 保留输入框原文，避免规范化标题/标签导致光标跳动或重复保存。
            const savedSnapshot = { ...submitted, modified: saved.modified };
            loaded.current = savedSnapshot;
            formDirty.current = !!draft.current && !sameForm(draft.current, savedSnapshot);
          });
          if (loaded.current?.id !== submitted.id) return true;
          setExternal(false);
          setConflict(null);
        } catch (e) {
          const msg = String(e);
          blocked.current = true;
          setSaveStatus("保存失败");
          setConflict(msg.includes("ERR_CONFLICT")
            ? msg.replace("ERR_CONFLICT:", "").trim()
            : `保存失败：${msg}`);
          return false;
        }
      }
      setSaveStatus("已自动保存");
      return true;
    };
    saving.current = task().finally(() => { saving.current = null; });
    return saving.current;
  }, [update]);
  useEffect(() => { refresh(); refreshCategories(); }, [refresh, refreshCategories]);
  // 先算脏状态，「重新载入」的判断才能用到本次渲染之前的结论
  useEffect(() => {
    const base = loaded.current;
    draft.current = base ? { ...base, title, content, categoryId, format, tags: tagsInput } : null;
    formDirty.current = !!base && !!draft.current && !sameForm(draft.current, base);
  }, [title, content, categoryId, format, tagsInput]);
  useEffect(() => {
    if (!note) {
      loaded.current = null;
      draft.current = null;
      formDirty.current = false;
      blocked.current = false;
      setConflict(null);
      setExternal(false);
      setTitle(""); setContent(""); setCategoryId(null); setFormat("markdown"); setTagsInput("");
      return;
    }
    // 自己保存的响应不重新填充表单，保留期间的新输入和光标位置。
    if (loaded.current?.id === note.id && loaded.current.modified === note.modified) return;
    // 同一篇笔记的磁盘内容被外部改了：本地有未保存改动时不要覆盖，交给用户决定
    if (loaded.current?.id === note.id && formDirty.current) {
      setExternal(true);
      blocked.current = true;
      setSaveStatus("自动保存已暂停");
      return;
    }
    loaded.current = snapshotOf(note);
    draft.current = loaded.current;
    formDirty.current = false;
    blocked.current = false;
    setConflict(null);
    setSaveStatus("已自动保存");
    setTitle(note.title);
    setContent(note.content);
    setCategoryId(note.categoryId);
    setFormat(note.format);
    setTagsInput(note.tags.join(", "));
    setExternal(false);
  }, [note?.id, note?.modified, reloadTick]);
  useEffect(() => {
    if (blocked.current) return;
    if (!formDirty.current) {
      if (!saving.current) setSaveStatus("已自动保存");
      return;
    }
    setSaveStatus("等待自动保存…");
    timer.current = setTimeout(() => { void handleSave(); }, 600);
    return () => clearTimeout(timer.current);
  }, [title, content, categoryId, format, tagsInput, handleSave]);
  useEffect(() => {
    const flush = () => { void handleSave(); };
    const onVisibility = () => { if (document.hidden) flush(); };
    window.addEventListener("blur", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      flush();
    };
  }, [handleSave]);
  async function handleSelect(id: string) {
    if (id !== currentId && await handleSave()) select(id);
  }
  async function handleCreate() {
    if (!await handleSave()) return;
    const n = await create({ categoryId: null, title: "未命名笔记", format: "markdown", content: "", tags: [] });
    select(n.id);
  }
  /** 丢弃本地改动，重新读取磁盘上的最新内容 */
  async function handleReload() {
    clearTimeout(timer.current);
    if (saving.current) await saving.current;
    // 先清快照，让「表单是否改动」重新算成干净状态
    loaded.current = null;
    draft.current = null;
    blocked.current = false;
    formDirty.current = false;
    setConflict(null);
    setExternal(false);
    setReloadTick((t) => t + 1);
    await refresh();
  }
  /** Agent 跑完可能改了 vault 里的文件，重新读一遍让它显示出来 */
  function handleAgentFinished(_run: AgentRun) {
    void refresh();
  }
  async function handleDelete() {
    if (!note) return;
    if (!confirm("确定删除这条笔记？")) return;
    clearTimeout(timer.current);
    if (saving.current) await saving.current;
    draft.current = null;
    loaded.current = null;
    await remove(note.id);
  }
  const placeholder = useMemo(() => {
    if (format === "markdown") return "# 标题\n\n开始用 Markdown 记录…";
    if (format === "todo") return "- [ ] 待办 1\n- [ ] 待办 2";
    return "在此输入纯文本…";
  }, [format]);
  return (
    <div className="flex h-full">
      {/* 三栏都用比例宽度：以前列表 18rem + 对话 23.75rem 是写死的，
          窗口缩到最小 900px、扣掉侧边栏只剩 676px 时，编辑区被挤到几乎为零。
          clamp() 让两侧跟着窗口缩，编辑区永远保底 16rem。 */}
      <aside className="flex w-[clamp(11rem,26%,17rem)] shrink-0 flex-col border-r">
        <div className="flex h-14 items-center justify-between gap-1 border-b px-4">
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">笔记列表</h2>
          <Button size="sm" variant="ghost" className="shrink-0 gap-1.5" onClick={handleCreate}>
            <Plus className="h-4 w-4" /> 新建
          </Button>
        </div>
        <ScrollArea className="flex-1">
          {items.length === 0 && <p className="p-4 text-xs text-muted-foreground">还没有笔记，点击右上角 “新建”。</p>}
          {items.map((n) => (
            <button
              key={n.id}
              onClick={() => void handleSelect(n.id)}
              title={n.title || "未命名笔记"}
              className={"flex w-full flex-col items-start gap-1 border-b px-4 py-3 text-left text-sm transition-colors hover:bg-accent " + (currentId === n.id ? "bg-accent" : "")}
            >
              <span className="line-clamp-1 w-full font-medium">{n.title || "未命名笔记"}</span>
              <span className="line-clamp-2 w-full text-xs text-muted-foreground">{n.content.slice(0, 60) || "空白笔记"}</span>
              <span className="text-[0.625rem] text-muted-foreground">{new Date(n.updatedAt).toLocaleString()}</span>
            </button>
          ))}
        </ScrollArea>
      </aside>
      <section className="flex min-h-0 min-w-[16rem] flex-1 flex-col">
        {!note ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">从左侧选择或新建一条笔记。</div>
        ) : (
          <>
            <div className="flex min-h-14 flex-wrap items-center gap-2 border-y-0 border-b px-4 py-1.5">
              <Input className="h-8 min-w-0 flex-1 max-w-md" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="标题" />
              <Select value={categoryId ?? "__none__"} onValueChange={(v) => setCategoryId(v === "__none__" ? null : v)}>
                <SelectTrigger className="h-8 w-40 shrink-0"><SelectValue placeholder="选择分类" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">未分类</SelectItem>
                  {categories.map((c) => (<SelectItem key={c.id} value={c.id}>{c.icon} {c.name}</SelectItem>))}
                </SelectContent>
              </Select>
              <Select value={format} onValueChange={(v) => setFormat(v as NoteFormat)}>
                <SelectTrigger className="h-8 w-28 shrink-0"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="markdown">Markdown</SelectItem>
                  <SelectItem value="plain">纯文本</SelectItem>
                  <SelectItem value="todo">待办</SelectItem>
                </SelectContent>
              </Select>
              <Input className="h-8 w-36 shrink-0" value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} placeholder="标签（逗号分隔）" />
              <span role="status" className="text-xs text-muted-foreground">{saveStatus}</span>
              <Button size="sm" className="shrink-0" onClick={() => { if (!external) blocked.current = false; void handleSave(); }}><Save className="h-4 w-4" /> 保存</Button>
              <Button size="sm" className="shrink-0" variant={chatOpen ? "default" : "outline"} onClick={() => setChatOpen((v) => !v)}>
                <Bot className="h-4 w-4" /> Agent
              </Button>
              <Button size="icon" variant="ghost" className="shrink-0" onClick={() => handleDelete()} aria-label="删除"><Trash2 className="h-4 w-4 text-destructive" /></Button>
            </div>
            {conflict && (
              <div className="flex items-center gap-2 border-b bg-destructive/10 px-4 py-2 text-xs text-destructive">
                <span className="flex-1">{conflict}</span>
                <Button size="sm" variant="outline" onClick={() => void handleReload()}>重新载入</Button>
              </div>
            )}
            {external && (
              <div className="flex items-center gap-2 border-b bg-amber-500/10 px-4 py-2 text-xs text-amber-600 dark:text-amber-400">
                <span className="flex-1">Agent 在磁盘上改了这篇笔记，你本地还有未保存的改动。</span>
                <Button size="sm" variant="outline" onClick={() => void handleReload()}>放弃本地改动并载入</Button>
              </div>
            )}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {format === "markdown" ? (
                <MarkdownEditor value={content} onChange={setContent} placeholder={placeholder} />
              ) : (
                <Textarea
                  className="h-full min-h-0 flex-1 resize-none rounded-none border-0 p-4 font-mono text-sm focus-visible:ring-0"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder={placeholder}
                />
              )}
            </div>
          </>
        )}
      </section>
      {chatOpen && (
        <aside className="w-[clamp(11rem,30%,23.75rem)] shrink-0 border-l">
          {note ? (
            <NoteAgentChat note={note} content={content} onFinished={handleAgentFinished} />
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
              先从左边选一篇笔记，再和 agent 对话。
            </div>
          )}
        </aside>
      )}
    </div>
  );
}
