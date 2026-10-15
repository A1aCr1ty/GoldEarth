import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { BookOpen, ChevronDown, ChevronRight, FileText, FolderOpen, ListTodo, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { useCategories } from "@/store/categories";
import { useNotes } from "@/store/notes";
import { useLibrary } from "@/store/library";
import { errText } from "@/lib/errors";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
export default function CategoriesPage() {
  const { items, refresh, create, remove, loading, error } = useCategories();
  const notes = useNotes((s) => s.items);
  const refreshNotes = useNotes((s) => s.refresh);
  const notesLoading = useNotes((s) => s.loading);
  const notesError = useNotes((s) => s.error);
  const selectNote = useNotes((s) => s.select);
  const libraryCategories = useLibrary((s) => s.categories);
  const refreshLibrary = useLibrary((s) => s.refresh);
  const importNotesTo = useLibrary((s) => s.importNotesTo);
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [localError, setLocalError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [libraryCategoryId, setLibraryCategoryId] = useState("");
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [selectedNotes, setSelectedNotes] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("📁");
  const [description, setDescription] = useState("");
  useEffect(() => { void refresh(); void refreshNotes(); void refreshLibrary(); }, [refresh, refreshNotes, refreshLibrary]);
  const folders = useMemo(() => {
    const grouped = new Map<string | null, typeof notes>();
    const knownIds = new Set(items.map((c) => c.id));
    for (const note of notes) {
      const id = note.categoryId && knownIds.has(note.categoryId) ? note.categoryId : null;
      const group = grouped.get(id) ?? [];
      group.push(note);
      grouped.set(id, group);
    }
    const all = [
      ...items.map((c) => ({ ...c, notes: grouped.get(c.id) ?? [] })),
      { id: "__unassigned__", name: "未分类", icon: "📂", description: "尚未放入分类的笔记", notes: grouped.get(null) ?? [] },
    ];
    const keyword = query.trim().toLocaleLowerCase();
    return all.map((folder) => {
      const matchesFolder = folder.name.toLocaleLowerCase().includes(keyword);
      const visibleNotes = folder.notes
        .filter((note) => matchesFolder || note.title.toLocaleLowerCase().includes(keyword))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return { ...folder, visibleNotes, matchesFolder };
    }).filter((folder) => !keyword || folder.matchesFolder || folder.visibleNotes.length > 0);
  }, [items, notes, query]);

  function toggleFolder(id: string) {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleRemove(id: string, folderName: string) {
    if (!window.confirm(`删除分类「${folderName}」？里面的笔记会移到「未分类」。`)) return;
    setLocalError(null);
    try { await remove(id); await refreshNotes(); }
    catch (e) { setLocalError(errText(e)); }
  }

  async function handleCreate() {
    if (!name.trim() || creating) return;
    setCreating(true); setLocalError(null);
    try {
      await create({ name: name.trim(), icon: icon.trim() || "📁", description: description.trim() || undefined });
      setName(""); setIcon("📁"); setDescription(""); setOpen(false);
    } catch (e) { setLocalError(errText(e)); }
    finally { setCreating(false); }
  }

  async function handleImportToLibrary() {
    if (!libraryCategoryId || importing || selectedNotes.size === 0) return;
    setImporting(true);
    setLocalError(null);
    setImportMessage(null);
    try {
      const noteIds = [...selectedNotes];
      await importNotesTo(libraryCategoryId, noteIds);
      const target = libraryCategories.find((category) => category.id === libraryCategoryId);
      setImportMessage(`已将 ${noteIds.length} 个文件加入知识库「${target?.name ?? "分类"}」。`);
      setSelectedNotes(new Set());
      setImportOpen(false);
    } catch (e) {
      setLocalError(`加入知识库失败：${errText(e)}`);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex min-h-14 flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
        <div>
          <h1 className="text-lg font-semibold">分类</h1>
          <p className="text-xs text-muted-foreground">按文件夹浏览笔记，点击文件直接打开</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
        <Dialog open={importOpen} onOpenChange={setImportOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" disabled={selectedNotes.size === 0} onClick={() => setImportOpen(true)}><BookOpen className="h-4 w-4" /> 加入知识库{selectedNotes.size ? ` (${selectedNotes.size})` : ""}</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>加入知识库</DialogTitle>
              <DialogDescription>将分类文件夹中已选的 {selectedNotes.size} 个文件复制到知识库，原文件会保留。</DialogDescription>
            </DialogHeader>
            {libraryCategories.length ? (
              <Select value={libraryCategoryId} onValueChange={setLibraryCategoryId}>
                <SelectTrigger><SelectValue placeholder="选择知识库分类" /></SelectTrigger>
                <SelectContent>
                  {libraryCategories.map((category) => <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-sm text-muted-foreground">知识库还没有分类，请先到知识库页面新建一个分类。</p>
            )}
            <DialogFooter>
              {libraryCategories.length ? (
                  <Button onClick={() => void handleImportToLibrary()} disabled={!libraryCategoryId || importing || selectedNotes.size === 0}>
                  <BookOpen className="h-4 w-4" />{importing ? "正在导入…" : "加入所选文件"}
                </Button>
              ) : (
                <Button variant="outline" onClick={() => { setImportOpen(false); navigate("/library"); }}><BookOpen className="h-4 w-4" />前往知识库</Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4" /> 新建分类</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>新建分类</DialogTitle>
              <DialogDescription>例如：工作 / 学习 / 生活 / 财务 / 项目 A</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Input className="w-16 text-center" value={icon} onChange={(e) => setIcon(e.target.value)} maxLength={4} />
                <Input placeholder="分类名称" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <Textarea placeholder="可选：分类描述" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>取消</Button>
              <Button onClick={() => void handleCreate()} disabled={!name.trim() || creating}>{creating ? "创建中…" : "创建"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
      </header>
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <div className="relative min-w-40 flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} className="h-9 pl-9" placeholder="搜索文件夹或文件标题" aria-label="搜索文件夹或文件标题" />
        </div>
        <span className="text-xs text-muted-foreground">{items.length} 个分类 · {notes.length} 个文件</span>
        <Button size="sm" variant="ghost" disabled={loading || notesLoading} onClick={() => { void refresh(); void refreshNotes(); }}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading || notesLoading ? "animate-spin" : ""}`} /> 刷新
        </Button>
      </div>
      {(localError || error || notesError || importMessage) && <p role={localError || error || notesError ? "alert" : "status"} className={`border-b px-4 py-2 text-xs ${localError || error || notesError ? "bg-destructive/10 text-destructive" : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"}`}>{localError || error || notesError || importMessage}</p>}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {loading || notesLoading ? (
          <p role="status" className="py-10 text-center text-sm text-muted-foreground">正在读取文件夹和文件…</p>
        ) : folders.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">没有匹配的文件夹或文件，试试其他关键词。</p>
        ) : (
          <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
            {folders.map((folder) => {
              const expanded = Boolean(query.trim()) || !collapsed.has(folder.id);
              return (
                <Card key={folder.id} className="min-w-0 overflow-hidden">
                  <CardHeader className="flex-row items-start gap-1 space-y-0 p-3">
                    <button className="flex min-w-0 flex-1 items-start gap-2 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => toggleFolder(folder.id)} aria-expanded={expanded} aria-controls={`folder-${folder.id}`}>
                      {expanded ? <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />}
                      <span className="shrink-0 text-xl" aria-hidden>{folder.icon || "📁"}</span>
                      <div className="min-w-0 flex-1">
                        <CardTitle className="break-words text-sm leading-6">{folder.name}</CardTitle>
                        {folder.description && <CardDescription className="mt-0.5 line-clamp-2 text-xs">{folder.description}</CardDescription>}
                      </div>
                      <Badge variant="secondary" className="mt-0.5 shrink-0">{folder.notes.length}</Badge>
                    </button>
                    {folder.id !== "__unassigned__" && (
                      <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => void handleRemove(folder.id, folder.name)} aria-label={`删除分类 ${folder.name}`}>
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    )}
                  </CardHeader>
                  {expanded && (
                    <CardContent id={`folder-${folder.id}`} className="border-t p-0">
                      {folder.visibleNotes.length === 0 ? (
                        <div className="flex items-center gap-2 px-4 py-6 text-xs text-muted-foreground">
                          <FolderOpen className="h-4 w-4" />{folder.notes.length ? "没有匹配的文件" : "文件夹里还没有笔记"}
                        </div>
                      ) : (
                        <ul className="max-h-80 divide-y overflow-y-auto">
                          {folder.visibleNotes.map((note) => {
                            const Icon = note.format === "todo" ? ListTodo : FileText;
                            return (
                              <li key={note.id} className="flex items-stretch">
                                <div className="flex items-center gap-2 px-3">
                                  <input
                                    type="checkbox"
                                    aria-label={`选择 ${note.title || "未命名笔记"} 加入知识库`}
                                    checked={selectedNotes.has(note.id)}
                                    onChange={(event) => setSelectedNotes((current) => {
                                      const next = new Set(current);
                                      if (event.target.checked) next.add(note.id); else next.delete(note.id);
                                      return next;
                                    })}
                                    className="h-4 w-4 accent-primary"
                                  />
                                </div>
                                <button className="group flex min-w-0 flex-1 items-center gap-3 py-3 pr-4 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none" onClick={() => { selectNote(note.id); navigate("/notes"); }} title={`打开 ${note.title || "未命名笔记"}`}>
                                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary" />
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm">{note.title || "未命名笔记"}</p>
                                    <p className="mt-0.5 text-[0.6875rem] text-muted-foreground">{note.format === "todo" ? "待办" : note.format === "plain" ? "纯文本" : "Markdown"} · 更新于 {new Date(note.updatedAt).toLocaleDateString()}</p>
                                  </div>
                                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </CardContent>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
