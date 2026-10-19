import { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  FileText,
  FolderOpen,
  FolderOutput,
  Image as ImageIcon,
  Pencil,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LibraryAgentChat } from "@/components/library/LibraryAgentChat";
import { useAgents } from "@/store/agents";
import { currentCategory, useLibrary } from "@/store/library";
import { errText } from "@/lib/errors";
import { tauri } from "@/lib/tauri";
import { open as pickFiles } from "@tauri-apps/plugin-dialog";
import { open as openPath } from "@tauri-apps/plugin-shell";
import type { LibraryCategory, LibraryFile } from "@/types";

/** 没绑 agent 时下拉框用的占位值 */
const NO_AGENT = "__none__";

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function shortTime(stamp: string): string {
  if (!stamp) return "";
  const date = new Date(stamp);
  return Number.isNaN(date.getTime()) ? stamp : date.toLocaleString();
}

export default function LibraryPage() {
  const category = useLibrary(currentCategory);
  const categories = useLibrary((s) => s.categories);
  const files = useLibrary((s) => s.files);
  const currentId = useLibrary((s) => s.currentId);
  const currentDir = useLibrary((s) => s.currentDir);
  const error = useLibrary((s) => s.error);
  const filesLoading = useLibrary((s) => s.filesLoading);
  const refresh = useLibrary((s) => s.refresh);
  const select = useLibrary((s) => s.select);
  const deleteCategory = useLibrary((s) => s.deleteCategory);
  const importFiles = useLibrary((s) => s.importFiles);
  const deleteFile = useLibrary((s) => s.deleteFile);
  const detachFile = useLibrary((s) => s.detachFile);

  const agents = useAgents((s) => s.agents);
  const refreshAgents = useAgents((s) => s.refresh);

  const [editing, setEditing] = useState<LibraryCategory | null>(null);
  const [creating, setCreating] = useState(false);
  const [preview, setPreview] = useState<{ name: string; text: string | null } | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [retainedPath, setRetainedPath] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
    void refreshAgents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const agentName = useMemo(() => {
    const map = new Map(agents.map((a) => [a.id, a.name]));
    return (id: string) => map.get(id) ?? "";
  }, [agents]);

  async function handleImport() {
    if (!currentId) return;
    setLocalError(null);
    try {
      const picked = await pickFiles({
        multiple: true,
        directory: false,
        title: "选择要收进知识库的资料",
      });
      if (!picked) return;
      const sources = Array.isArray(picked) ? picked : [picked];
      if (sources.length === 0) return;
      setBusy(true);
      await importFiles(sources);
    } catch (e) {
      setLocalError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleOpenFolder() {
    if (!currentDir) return;
    try {
      await openPath(currentDir);
    } catch (e) {
      setLocalError(errText(e));
    }
  }

  async function handlePreview(file: LibraryFile) {
    if (!currentId) return;
    try {
      const text = await tauri.readLibraryText(currentId, file.name);
      setPreview({ name: file.name, text });
    } catch (e) {
      setLocalError(errText(e));
    }
  }

  async function handleDeleteFile(file: LibraryFile) {
    if (busy || !confirm(`删除「${file.name}」？\n知识库中的这份文件会从磁盘删除，无法撤销。若要保留文件，请使用「移出并保留」。`)) return;
    setBusy(true);
    setLocalError(null);
    try {
      await deleteFile(file.name);
    } catch (e) {
      setLocalError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleDetachFile(file: LibraryFile) {
    if (busy || !confirm(`将「${file.name}」移出知识库并保留文件？\n文件会移至当前存储位置下独立的 knowledge-removed 文件夹，完成后显示保存路径。以后删除原分类也不会删除这份文件。`)) return;
    setBusy(true);
    setLocalError(null);
    try {
      const path = await detachFile(file.name);
      setRetainedPath(path);
      if (preview?.name === file.name) setPreview(null);
    } catch (e) {
      setLocalError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteCategory(target: LibraryCategory) {
    if (busy) return;
    if (!confirm(`删除分类「${target.name}」？\n里面的 ${target.fileCount} 份资料会一起删除，无法撤销。`)) return;
    try {
      await deleteCategory(target.id);
    } catch (e) {
      setLocalError(errText(e));
    }
  }

  const message = localError ?? error;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b px-4">
        <div className="min-w-0">
          <h1 className="text-base font-semibold">知识库</h1>
          <p className="truncate text-[0.6875rem] text-muted-foreground">
            按分类收藏资料，每个分类绑一个 agent —— 它会直接读这个目录里的文件
          </p>
        </div>
        <Button size="sm" className="shrink-0" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> 新建分类
        </Button>
      </header>

      {message && (
        <div className="shrink-0 border-b bg-destructive/10 px-4 py-1.5 text-xs text-destructive">{message}</div>
      )}

      {retainedPath && (
        <div role="status" className="shrink-0 border-b bg-primary/5 px-4 py-2 text-xs">
          <p className="mb-1">已移出知识库，文件已保留在以下位置，可通过「导入文件」重新加入：</p>
          <div className="flex items-center gap-2">
            <Input aria-label="保留文件的位置" readOnly value={retainedPath} className="h-7 min-w-0 flex-1 text-xs" onFocus={(e) => e.target.select()} />
            <Button size="sm" variant="outline" className="h-7" onClick={() => void navigator.clipboard.writeText(retainedPath).catch(e => setLocalError(errText(e)))}>复制路径</Button>
            <Button size="sm" variant="ghost" className="h-7" onClick={() => setRetainedPath(null)}>关闭</Button>
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* 左：分类 */}
        <aside className="flex w-[clamp(8.5rem,18%,16rem)] shrink-0 flex-col border-r">
          <div className="flex h-8 shrink-0 items-center border-b bg-muted/40 px-2.5 text-[0.6875rem] font-semibold tracking-wide text-muted-foreground">
            分类
          </div>
          <ScrollArea className="min-h-0 flex-1">
            {categories.length === 0 && (
              <p className="p-3 text-xs text-muted-foreground">
                还没有分类。先建一个（比如「行业研究」「读过的报告」），再把资料收进去。
              </p>
            )}
            {categories.map((c) => {
              const bound = agentName(c.agentId);
              return (
                <div
                  key={c.id}
                  className={`group flex items-start gap-1 border-b px-2.5 py-2 text-xs transition-colors hover:bg-accent ${
                    currentId === c.id ? "bg-accent" : ""
                  }`}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => void select(c.id)}
                  >
                    <span className="flex items-center gap-1.5">
                      <BookOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate font-medium">{c.name}</span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 pl-5 text-[0.625rem] text-muted-foreground">
                      <span className="shrink-0">{c.fileCount} 份资料</span>
                      <span className="truncate">· {bound || "未绑 agent"}</span>
                    </span>
                  </button>
                  <span className="flex shrink-0 items-center gap-0.5">
                    <button
                      type="button"
                      className="rounded p-1 text-muted-foreground/70 transition-colors hover:bg-background hover:text-foreground"
                      onClick={() => setEditing(c)}
                      aria-label={`编辑分类：${c.name}`}
                      title="编辑"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      className="rounded p-1 text-muted-foreground/70 transition-colors hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => void handleDeleteCategory(c)}
                      aria-label={`删除分类：${c.name}`}
                      title="删除分类（连同资料）"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </span>
                </div>
              );
            })}
          </ScrollArea>
        </aside>

        {/* 中：这一类收的资料 */}
        <section className="flex min-w-[16rem] flex-1 flex-col">
          {!category ? (
            <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
              从左边选一个分类，或者新建一个来收藏资料。
            </div>
          ) : (
            <>
              <div className="flex h-8 shrink-0 items-center gap-2 border-b bg-muted/40 px-2.5">
                <span className="truncate text-[0.6875rem] font-semibold tracking-wide text-muted-foreground">
                  资料 · {category.name}
                </span>
                <span className="ml-auto flex shrink-0 items-center gap-1">
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={busy} onClick={() => void handleImport()}>
                    <Upload className="h-3.5 w-3.5" /> 导入文件
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-xs"
                    disabled={!currentDir}
                    onClick={() => void handleOpenFolder()}
                  >
                    <FolderOpen className="h-3.5 w-3.5" /> 打开文件夹
                  </Button>
                </span>
              </div>

              <ScrollArea className="min-h-0 flex-1">
                {filesLoading && files.length === 0 && (
                  <p className="p-3 text-xs text-muted-foreground">正在读取…</p>
                )}
                {!filesLoading && files.length === 0 && (
                  <div className="p-3 text-xs text-muted-foreground">
                    <p>这一类还没有资料。</p>
                    <p className="mt-1">
                      点右上角「导入文件」选几份收进来；也可以点「打开文件夹」直接把文件拷进去，之后回这里刷新。
                    </p>
                  </div>
                )}
                {files.map((f) => (
                  <div
                    key={f.name}
                    className="flex items-center gap-2 border-b px-2.5 py-1.5 text-xs transition-colors hover:bg-accent"
                  >
                    {f.isText ? (
                      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <ImageIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => void handlePreview(f)}
                      title={f.isText ? "预览内容" : "二进制文件，先打开文件夹查看"}
                    >
                      <span className="block truncate font-medium">{f.name}</span>
                      <span className="block truncate text-[0.625rem] text-muted-foreground">
                        {humanSize(f.size)} · {shortTime(f.modified)}
                      </span>
                    </button>
                    {f.ext && <Badge variant="secondary" className="shrink-0 text-[0.625rem]">{f.ext}</Badge>}
                    <button
                      type="button"
                      disabled={busy}
                      className="flex shrink-0 items-center gap-1 rounded p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground disabled:opacity-50"
                      onClick={() => void handleDetachFile(f)}
                      aria-label={`移出并保留：${f.name}`}
                      title="移出知识库，保留文件"
                    >
                      <FolderOutput className="h-3 w-3" /> 移出并保留
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      className="shrink-0 rounded p-1 text-muted-foreground/70 transition-colors hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => void handleDeleteFile(f)}
                      aria-label={`删除文件：${f.name}`}
                      title="删除文件（从磁盘删除）"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </ScrollArea>
            </>
          )}
        </section>

        {/* 右：这个分类的 agent 对话 */}
        <aside className="flex w-[clamp(11rem,28%,26rem)] shrink-0 flex-col border-l">
          {category ? (
            <LibraryAgentChat
              category={category}
              files={files}
              dir={currentDir}
              onFinished={() => void useLibrary.getState().refreshFiles()}
            />
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
              选中一个分类后，可以在这里让 agent 读它的资料。
            </div>
          )}
        </aside>
      </div>

      <CategoryDialog
        open={creating || editing !== null}
        category={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onError={setLocalError}
      />

      <Dialog open={preview !== null} onOpenChange={(v) => !v && setPreview(null)}>
        <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="truncate">{preview?.name}</DialogTitle>
            <DialogDescription>
              {preview?.text === null ? "这是二进制文件，没法直接预览，用「打开文件夹」查看。" : "文本预览"}
            </DialogDescription>
          </DialogHeader>
          {preview?.text !== null && (
            <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
              {preview?.text}
            </pre>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPreview(null)}>关闭</Button>
            <Button size="sm" disabled={!currentDir} onClick={() => void handleOpenFolder()}>
              <FolderOpen className="h-3.5 w-3.5" /> 打开文件夹
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** 新建 / 编辑分类：名字、说明，以及「分类对应哪个 agent」 */
function CategoryDialog({
  open,
  category,
  onClose,
  onError,
}: {
  open: boolean;
  category: LibraryCategory | null;
  onClose: () => void;
  onError: (message: string | null) => void;
}) {
  const agents = useAgents((s) => s.agents);
  const createCategory = useLibrary((s) => s.createCategory);
  const updateCategory = useLibrary((s) => s.updateCategory);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [agentId, setAgentId] = useState(NO_AGENT);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(category?.name ?? "");
    setDescription(category?.description ?? "");
    setAgentId(category?.agentId || NO_AGENT);
  }, [open, category]);

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    onError(null);
    try {
      const input = { name: trimmed, description: description.trim(), agentId: agentId === NO_AGENT ? "" : agentId };
      if (category) await updateCategory(category.id, input);
      else await createCategory(input);
      onClose();
    } catch (e) {
      onError(errText(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{category ? "编辑分类" : "新建分类"}</DialogTitle>
          <DialogDescription>
            名字会变成资料目录名；绑定的 agent 就是这个分类的「专属助手」。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="library-name">名称</Label>
            <Input
              id="library-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：行业研究 / 读过的报告 / 学习资料"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="library-desc">说明（可选）</Label>
            <Textarea
              id="library-desc"
              className="min-h-[3.75rem] resize-none text-sm"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="这一类收什么资料，留给自己或 agent 看"
            />
          </div>
          <div className="space-y-1.5">
            <Label>绑定 agent</Label>
            <Select value={agentId} onValueChange={setAgentId}>
              <SelectTrigger><SelectValue placeholder="选择一个 agent" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_AGENT}>暂不绑定</SelectItem>
                {agents.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}{a.enabled ? "" : "（已停用）"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {agents.length === 0 && (
              <p className="text-[0.6875rem] text-muted-foreground">
                还没有配置 agent，可以先建分类，之后在 Agent 页添加再回来绑定。
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>取消</Button>
          <Button size="sm" disabled={!name.trim() || saving} onClick={() => void handleSave()}>
            {category ? "保存" : "创建"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
