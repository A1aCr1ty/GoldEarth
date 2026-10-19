import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { File, Folder, FolderOpen, Search, RefreshCw, Copy, ChevronLeft, ChevronRight, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errText } from "@/lib/errors";

interface Status { building: boolean; indexed: number; progress: number; root: string; skipped: number; updated: string | null }
interface Entry { path: string; name: string; isDir: boolean }
interface Results { items: Entry[]; total: number; hasMore: boolean; elapsedMs: number }

export default function FileSearchPage() {
  const [status, setStatus] = useState<Status>();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [fullPath, setFullPath] = useState(false);
  const [offset, setOffset] = useState(0);
  const [result, setResult] = useState<Results>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState(0);
  const search = useRef<HTMLInputElement>(null);
  const request = useRef(0);
  const desktop = isTauri();

  useEffect(() => {
    document.getElementById(`file-result-${selected}`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  useEffect(() => {
    if (!desktop) return;
    let live = true;
    const poll = () => invoke<Status>("file_search_status").then(s => {
      if (!live) return;
      setStatus(s);
    }).catch(e => { if (live) setError(errText(e)); });
    void poll();
    const timer = window.setInterval(poll, 1000);
    return () => { live = false; clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (!desktop) { setError("请在 GoldEarth 桌面应用内使用文件搜索；浏览器预览无法访问本机文件索引。"); return; }
    const id = ++request.current;
    setLoading(true); setResult(undefined); setSelected(0); setError("");
    const timer = window.setTimeout(() => {
      invoke<Results>("file_search_query", { query, kind, fullPath, offset })
        .then(r => { if (request.current === id) setResult(r); })
        .catch(e => { if (request.current === id) setError(errText(e)); })
        .finally(() => { if (request.current === id) setLoading(false); });
    }, 100);
    return () => { clearTimeout(timer); request.current++; };
  }, [query, kind, fullPath, offset, status?.updated]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === "f") { e.preventDefault(); search.current?.focus(); search.current?.select(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function build(changeRoot: boolean) {
    if (!desktop) return;
    try {
      const root = changeRoot || !status?.root ? await open({ directory: true, multiple: false, title: "选择要建立文件索引的目录或磁盘" }) : status.root;
      if (typeof root !== "string") return;
      setError("");
      await invoke("file_search_index", { root });
      setStatus(await invoke<Status>("file_search_status"));
    } catch (e) { setError(errText(e)); }
  }
  async function reveal(item: Entry) {
    try { await invoke("file_search_reveal", { path: item.path }); } catch (e) { setError(errText(e)); }
  }
  async function copy(item: Entry) {
    try { await navigator.clipboard.writeText(item.path); setNotice("已复制路径"); } catch (e) { setError(errText(e)); }
  }

  const items = result?.items ?? [];
  return (
    <div className="flex h-full flex-col p-6 gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-2xl font-semibold flex items-center gap-2"><Search className="h-6 w-6 text-primary" />文件搜索</h1><p className="text-sm text-muted-foreground mt-1">让文件随输入出现 · 本地文件名与路径检索</p></div>
        <span className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs text-muted-foreground"><Zap className="h-3.5 w-3.5 text-primary" />内置本地索引</span>
      </header>
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <div className="relative"><Search className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" /><Input ref={search} autoFocus aria-label="搜索文件名" className="h-11 pl-10 pr-16 text-base" placeholder="输入文件名，空格分隔关键词，例如：报告 ext:pdf;docx" value={query} onChange={e => { setQuery(e.target.value); setOffset(0); }} onKeyDown={e => { if (e.key === "Escape") { setQuery(""); setOffset(0); } }} /><span className="absolute right-3 top-3 text-xs text-muted-foreground">Ctrl F</span></div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <div className="inline-flex rounded-md border p-0.5">{[["all", "全部"], ["file", "文件"], ["folder", "文件夹"]].map(([value, label]) => <button key={value} aria-pressed={kind === value} className={`rounded px-3 py-1 ${kind === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`} onClick={() => { setKind(value); setOffset(0); }}>{label}</button>)}</div>
          <label className="flex items-center gap-2"><input type="checkbox" checked={fullPath} onChange={e => { setFullPath(e.target.checked); setOffset(0); }} />匹配完整路径</label>
          <Button size="sm" variant="outline" disabled={status?.building} onClick={() => { setOffset(0); void build(false); }}><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${status?.building ? "animate-spin" : ""}`} />{status?.building ? "构建中" : "刷新索引"}</Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span className="truncate max-w-[50%]" title={status?.root}>范围：{status?.root || "尚未选择目录"}</span><Button size="sm" variant="ghost" disabled={status?.building} onClick={() => void build(true)}><FolderOpen className="mr-1 h-3.5 w-3.5" />选择目录 / 磁盘</Button><span className="ml-auto">{status?.building ? `正在读取 ${status.progress.toLocaleString()} 项，完成后切换索引` : `${(status?.indexed ?? 0).toLocaleString()} 项 · 快照索引，文件变化后请刷新`}</span>{!!status?.skipped && <span>跳过 {status.skipped} 个无权限项或链接</span>}{status?.updated && <span title={status.updated}>更新于 {new Date(status.updated).toLocaleTimeString()}</span>}</div>
      {error && <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
      <div className="flex min-h-0 flex-1 flex-col rounded-xl border bg-card overflow-hidden">
        <div className="grid grid-cols-[minmax(150px,1fr)_minmax(160px,2fr)_100px] gap-3 border-b bg-muted/40 px-4 py-2 text-xs text-muted-foreground"><span>名称</span><span>完整路径</span><span>操作</span></div>
        <div className="min-h-0 flex-1 overflow-auto outline-none" tabIndex={0} role="listbox" aria-label="搜索结果" aria-busy={loading} aria-activedescendant={items.length ? `file-result-${selected}` : undefined} onKeyDown={e => { if (e.key === "ArrowDown") { e.preventDefault(); setSelected(n => Math.min(n + 1, items.length - 1)); } if (e.key === "ArrowUp") { e.preventDefault(); setSelected(n => Math.max(n - 1, 0)); } if (e.key === "Enter" && items[selected]) { e.preventDefault(); void reveal(items[selected]); } }}>
          {items.map((item, n) => <div id={`file-result-${n}`} key={item.path} role="option" aria-selected={selected === n} onClick={() => { setSelected(n); setNotice(""); }} onDoubleClick={() => void reveal(item)} className={`grid grid-cols-[minmax(150px,1fr)_minmax(160px,2fr)_100px] items-center gap-3 border-b px-4 py-2 text-sm cursor-default ${selected === n ? "bg-primary/10" : "hover:bg-muted/50"}`}><span className="flex min-w-0 items-center gap-2">{item.isDir ? <Folder className="h-4 w-4 shrink-0 text-amber-500" /> : <File className="h-4 w-4 shrink-0 text-muted-foreground" />}<span className="truncate" title={item.name}>{item.name}</span></span><span className="truncate text-xs text-muted-foreground" title={item.path}>{item.path}</span><span className="flex gap-1"><Button size="icon" variant="ghost" className="h-7 w-7" title="在资源管理器中定位" aria-label={`定位 ${item.name}`} onClick={() => void reveal(item)}><FolderOpen className="h-4 w-4" /></Button><Button size="icon" variant="ghost" className="h-7 w-7" title="复制完整路径" aria-label={`复制 ${item.name} 的路径`} onClick={() => void copy(item)}><Copy className="h-3.5 w-3.5" /></Button></span></div>)}
          {!items.length && <div className="flex h-full min-h-40 flex-col items-center justify-center gap-3 p-8 text-muted-foreground"><Search className="h-10 w-10 opacity-25" /><p>{loading ? "正在搜索…" : error ? "查询未完成，请查看上方提示" : !status?.updated ? "选择一个目录或磁盘，建立第一份索引" : "没有匹配的文件，试试更短的关键词"}</p>{!status?.updated && <Button variant="outline" disabled={status?.building} onClick={() => void build(true)}>选择索引目录</Button>}</div>}
        </div>
        <footer className="flex flex-wrap items-center gap-3 border-t px-4 py-2 text-xs text-muted-foreground" aria-live="polite"><span>{loading ? "搜索中…" : result ? `${result.total.toLocaleString()} 个结果 · ${result.elapsedMs.toFixed(1)} ms` : "等待搜索"}</span><span>{notice || "↑ ↓ 选择 · Enter / 双击定位"}</span><div className="ml-auto flex items-center gap-2"><Button size="icon" variant="ghost" className="h-7 w-7" aria-label="上一页" disabled={offset === 0 || loading} onClick={() => setOffset(n => Math.max(0, n - 100))}><ChevronLeft className="h-4 w-4" /></Button><span>第 {Math.floor(offset / 100) + 1} 页</span><Button size="icon" variant="ghost" className="h-7 w-7" aria-label="下一页" disabled={!result?.hasMore || loading} onClick={() => setOffset(n => n + 100)}><ChevronRight className="h-4 w-4" /></Button></div></footer>
      </div>
    </div>
  );
}
