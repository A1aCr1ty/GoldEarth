import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, Bookmark, Check, ChevronDown, ExternalLink, FilePlus2, RefreshCw, Search, Settings2, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { errText } from "@/lib/errors";
import { tauri } from "@/lib/tauri";
import { SourceManager } from "@/components/robotics/SourceManager";
import { DOCUMENT_KINDS, documentLabel, robotHeading, ROBOT_CATEGORIES, categoryLabel, feedItems, filterRobotItems, loadRobotFeed, robotCollection, robotMarkdown, RobotCollection, RobotItem, RobotReport } from "@/lib/robotics";

const PREF_KEY = "goldearth.robotics.preferences";
function preferences(): { subscribed: string[]; auto: boolean } {
  try {
    const raw = JSON.parse(localStorage.getItem(PREF_KEY) || "null");
    return { subscribed: Array.isArray(raw?.subscribed) ? raw.subscribed.filter((id: string) => ROBOT_CATEGORIES.some(c => c.id === id)) : ROBOT_CATEGORIES.map(c => c.id), auto: raw?.auto !== false };
  } catch { return { subscribed: ROBOT_CATEGORIES.map(c => c.id), auto: true }; }
}
const when = (value: string | null) => value ? new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", year: "numeric" }) : "来源未提供时间";

export default function RoboticsPage() {
  const [prefs, setPrefs] = useState(preferences);
  const [report, setReport] = useState<RobotReport | null>(null);
  const [collection, setCollection] = useState<RobotCollection>({ saved: {}, read: [] });
  const [ready, setReady] = useState(false);
  const [category, setCategory] = useState("all");
  const [view, setView] = useState("all");
  const [query, setQuery] = useState("");
  const [days, setDays] = useState(0);
  const [kind, setKind] = useState("all");
  const [sourceKind, setSourceKind] = useState("all");
  const [settings, setSettings] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const mounted = useRef(false);
  const fetching = useRef(false);
  const mutating = useRef(false);

  async function refresh(force = false) {
    if (fetching.current) return;
    fetching.current = true; setLoading(true); setError("");
    try { const data = await loadRobotFeed(force); if (mounted.current) setReport(data); }
    catch (e) { if (mounted.current) setError(errText(e)); }
    finally { fetching.current = false; if (mounted.current) setLoading(false); }
  }
  async function loadCollection() {
    try { const data = await robotCollection(); if (mounted.current) { setCollection(data); setReady(true); } }
    catch (e) { if (mounted.current) setError(`收藏读取失败：${errText(e)}`); }
  }
  useEffect(() => {
    mounted.current = true;
    void loadCollection(); void refresh();
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); }
    catch { setError("订阅偏好未能保存，当前设置仅在本次页面有效"); }
    if (!prefs.auto) return;
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 30 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [prefs]);

  async function mutate(action: string, item: RobotItem) {
    if (!ready || mutating.current) return;
    mutating.current = true; setBusy(true); setMessage("");
    try { const data = await robotCollection(action, action === "save" ? item : undefined, item.url); if (mounted.current) setCollection(data); }
    catch (e) { if (mounted.current) setError(errText(e)); }
    finally { mutating.current = false; if (mounted.current) setBusy(false); }
  }
  async function open(item: RobotItem) {
    try { await tauri.openReader(item.url, robotHeading(item).title); await mutate("read", item); }
    catch (e) { setError(`原文打开失败：${errText(e)}`); }
  }
  async function toNote(items: RobotItem[]) {
    if (!items.length || busy) return;
    setBusy(true); setMessage("");
    try {
      await tauri.createNote({ categoryId: null, title: items.length === 1 ? robotHeading(items[0]).title : `机器人资料摘录 · ${new Date().toLocaleDateString("zh-CN")}`, format: "markdown", content: robotMarkdown(items), tags: ["机器人", "资料收集"] });
      setMessage(`已将 ${items.length} 条资料的摘要与原文链接保存到「笔记 / 未分类」`);
    } catch (e) { setError(`保存笔记失败：${errText(e)}`); }
    finally { setBusy(false); }
  }
  const allItems = useMemo(() => feedItems(report), [report]);
  const visible = useMemo(() => filterRobotItems(view === "saved" ? Object.values(collection.saved) : allItems,
    { category, subscribed: prefs.subscribed, query, view, read: collection.read, days, kind, sourceKind }), [allItems, collection, category, query, view, prefs.subscribed, days, kind, sourceKind]);
  const read = new Set(collection.read);
  const total = new Set(allItems.filter(i => prefs.subscribed.includes(i.category)).map(i => i.url)).size;
  const unread = new Set(allItems.filter(i => prefs.subscribed.includes(i.category) && !read.has(i.url)).map(i => i.url)).size;
  const failed = report?.sources.filter(s => s.error).length || 0;

  return <div className="flex h-full min-w-0 flex-col overflow-hidden">
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-6 py-4">
      <div className="flex items-center gap-3"><span className="rounded-xl bg-primary/10 p-2.5 text-primary"><Bell className="h-5 w-5" /></span><div><h1 className="text-lg font-semibold">机器人推送</h1><p className="mt-1 text-xs text-muted-foreground">国内厂家优先 · 参数规格 · 技术文档 · 官方开源</p></div></div>
      <div className="flex items-center gap-2"><Button size="sm" variant={settings ? "secondary" : "outline"} onClick={() => setSettings(!settings)} aria-expanded={settings}><Settings2 className="h-3.5 w-3.5" />订阅与来源</Button><Button size="sm" disabled={loading} onClick={() => { void refresh(true); if (!ready) void loadCollection(); }}><RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />{loading ? "获取中…" : "刷新推送"}</Button></div>
    </header>
    <div className="flex-1 space-y-5 overflow-y-auto p-5 lg:p-6">
      <div className="rounded-xl border bg-gradient-to-br from-primary/10 via-background to-background p-5">
        <div className="flex flex-wrap items-center justify-between gap-4"><div><div className="text-xs font-medium tracking-widest text-primary">ROBOTICS RADAR</div><h2 className="mt-2 text-xl font-semibold">找到参数与技术文档，让资料收集更直接</h2><p className="mt-2 max-w-2xl text-xs leading-6 text-muted-foreground">以国内厂家为主，收集宇树、智元、逐际、松灵、越疆、UFACTORY、灵足、MyActuator、览沃和奥比中光的参数、手册与官方开源资料。</p></div><div className="flex gap-7"><Metric count={total} label="技术资料" /><Metric count={unread} label="未读" /><Metric count={Object.keys(collection.saved).length} label="已收藏" /></div></div>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3 text-xs text-muted-foreground"><span>{prefs.subscribed.length} / 8 个订阅分类</span><span>{prefs.auto ? "页面打开时每 30 分钟刷新" : "手动刷新"}</span><span>官网公开文档链接 · GitHub README、文档目录与版本记录</span></div>
      </div>
      {(error || report?.warning) && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">{error || report?.warning}</div>}
      {message && <div role="status" className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs text-primary">{message}</div>}
      {settings && <section className="space-y-4 rounded-xl border bg-card p-4"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-sm font-semibold">我的订阅</h2><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={prefs.auto} onChange={e => setPrefs(p => ({ ...p, auto: e.target.checked }))} />页面内自动刷新</label></div><div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">{ROBOT_CATEGORIES.map(c => <label key={c.id} className="flex cursor-pointer items-start gap-2 rounded-lg border p-3"><input type="checkbox" className="mt-0.5 accent-primary" checked={prefs.subscribed.includes(c.id)} onChange={e => setPrefs(p => ({ ...p, subscribed: e.target.checked ? [...p.subscribed, c.id] : p.subscribed.filter(id => id !== c.id) }))} /><span><span className="block text-xs font-medium">{c.label}</span><span className="mt-1 block text-[11px] text-muted-foreground">{c.hint}</span></span></label>)}</div><p className="text-xs text-muted-foreground">订阅决定资讯流的展示范围；已收藏资料始终保留。自动刷新在此页面打开且窗口可见时运行。</p><SourceManager loading={loading} onChange={() => refresh()} /><SourceDetails report={report} onOpen={async (url, title) => { try { await tauri.openReader(url, title); } catch (e) { setError(errText(e)); } }} /></section>}
      {!!failed && <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 px-4 py-3 text-xs text-muted-foreground"><span className="flex items-center gap-2"><WifiOff className="h-4 w-4 shrink-0" />{failed} 个来源暂不可用，有历史结果的来源显示缓存。官网验证或 GitHub 访问限制可在来源状态中查看。</span><button className="text-primary underline underline-offset-4" onClick={() => setSettings(true)}>查看来源状态</button></div>}
      <section className="space-y-4">
        <div className="flex flex-wrap gap-2" aria-label="内容分类">{[{ id: "all", label: "全部分类" }, ...ROBOT_CATEGORIES].map(c => <Button key={c.id} size="sm" variant={category === c.id ? "default" : "outline"} aria-pressed={category === c.id} onClick={() => setCategory(c.id)}>{c.label}</Button>)}</div>
        <div className="flex flex-wrap items-center gap-3"><div className="flex rounded-lg bg-muted p-1">{[["all", "技术资料"], ["unread", "未读"], ["saved", "我的收藏"]].map(([id, label]) => <button key={id} aria-pressed={view === id} onClick={() => setView(id)} className={cn("rounded-md px-3 py-1.5 text-xs transition-colors", view === id ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground")}>{label}</button>)}</div><div className="relative min-w-44 flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input aria-label="搜索机器人技术资料" placeholder="搜索品牌、产品、技术关键词…" value={query} onChange={e => setQuery(e.target.value)} className="pl-9" /></div><select aria-label="资料类型" value={kind} onChange={e => setKind(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-xs"><option value="all">全部资料类型</option>{DOCUMENT_KINDS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select><select aria-label="来源类型" value={sourceKind} onChange={e => setSourceKind(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-xs"><option value="all">全部来源</option><option value="website">公司官网</option><option value="github">GitHub</option></select><select aria-label="发布时间范围" value={days} onChange={e => setDays(Number(e.target.value))} className="h-9 rounded-md border bg-background px-2 text-xs"><option value={0}>不限发布时间</option><option value={1}>最近 24 小时</option><option value={7}>最近 7 天</option><option value={30}>最近 30 天</option></select></div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span>{visible.length} 条资料 · 参数规格优先，同类按来源发布时间排序{days > 0 && " · 不包含未提供时间的条目"}</span>{view === "saved" && <Button size="sm" variant="outline" disabled={!visible.length || busy} onClick={() => void toNote(visible)}><FilePlus2 className="h-3.5 w-3.5" />当前收藏整理为笔记</Button>}</div>
        {loading && !report && <div role="status" className="rounded-xl border border-dashed p-12 text-center text-sm text-muted-foreground">正在读取公司官网文档与 GitHub 仓库资料…</div>}
        {!visible.length && !(loading && !report) && <div className="rounded-xl border border-dashed p-12 text-center"><Bell className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" /><p className="text-sm font-medium">{view === "saved" ? "当前没有匹配的收藏" : !prefs.subscribed.length ? "选择感兴趣的分类，开启你的资料流" : "暂无匹配的技术资料"}</p><p className="mt-2 text-xs leading-6 text-muted-foreground">{view === "saved" ? "点击资料卡片上的收藏，文档链接和摘要会保存在本机。" : "可调整分类、关键词或时间范围；若来源无法连接，请查看来源状态后重试。"}</p></div>}
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">{visible.map(item => {
          const saved = !!collection.saved[item.url];
          const heading = robotHeading(item);
          const source = report?.sources.find(s => s.name === item.source);
          return <article key={item.url} className={cn("flex min-w-0 flex-col rounded-xl border bg-card p-5 transition-colors hover:border-primary/40", read.has(item.url) && "bg-muted/10")}>
            <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px]"><span className="rounded-md bg-primary/10 px-2 py-1 font-medium text-primary">{categoryLabel(item.category)}</span><span className="rounded-md bg-muted px-2 py-1 text-muted-foreground">{documentLabel(item.kind)}</span><span className="text-muted-foreground">{item.sourceKind === "github" ? "GitHub" : item.sourceKind === "website" ? "官网资料" : "历史收藏"}{/\.pdf(?:$|[?#])/i.test(item.url) ? " · PDF" : ""}</span>{source?.error && <span className="text-amber-600 dark:text-amber-400">历史缓存</span>}{!read.has(item.url) && <span className="ml-auto flex items-center gap-1 text-primary"><span className="h-1.5 w-1.5 rounded-full bg-primary" />未读</span>}</div>
            <button onClick={() => void open(item)} title={item.title} className="text-left text-base font-semibold leading-7 hover:text-primary">{heading.title}</button><p className="mt-1 line-clamp-2 break-words text-[11px] leading-5 text-muted-foreground" title={item.title}>原始标题：{item.title}</p><p className="mt-2 line-clamp-3 text-xs leading-6 text-muted-foreground">{item.summary || "来源未提供摘要，可打开原文查看详情。"}</p><div className="mt-auto pt-4"><p className="truncate text-[11px] text-muted-foreground" title={item.source}>{item.source}</p><p className="mt-1 text-[11px] text-muted-foreground">{item.publishedAt ? `发布于 ${when(item.publishedAt)}` : "来源未提供文档时间"}</p><div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-3"><Button size="sm" variant="outline" onClick={() => void open(item)}><ExternalLink className="h-3.5 w-3.5" />打开文档</Button><Button size="sm" variant={saved ? "secondary" : "ghost"} disabled={busy || !ready} onClick={() => void mutate(saved ? "remove" : "save", item)} aria-pressed={saved}><Bookmark className={cn("h-3.5 w-3.5", saved && "fill-current")} />{saved ? "已收藏" : "收藏"}</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => void toNote([item])}><FilePlus2 className="h-3.5 w-3.5" />存笔记</Button><Button size="sm" variant="ghost" className="ml-auto" disabled={busy || !ready || read.has(item.url)} onClick={() => void mutate("read", item)}><Check className="h-3.5 w-3.5" />{read.has(item.url) ? "已读" : "标已读"}</Button></div></div>
          </article>;
        })}</div>
      </section>
      <p className="pb-2 text-center text-[11px] leading-6 text-muted-foreground">资料摘要来自官网页面或仓库目录，完整参数请打开文档核对。收藏与笔记保存摘要和链接，不代表已下载全文。</p>
    </div>
  </div>;
}
function Metric({ count, label }: { count: number; label: string }) {
  return <div><div className="font-mono text-2xl font-semibold tabular-nums">{count}</div><div className="mt-1 text-[11px] text-muted-foreground">{label}</div></div>;
}
function SourceDetails({ report, onOpen }: { report: RobotReport | null; onOpen: (url: string, title: string) => Promise<void> }) {
  return <details className="rounded-lg border"><summary className="flex cursor-pointer items-center gap-2 p-3 text-xs font-medium"><ChevronDown className="h-3.5 w-3.5" />来源状态与最近获取时间</summary><div className="divide-y border-t">{!report && <p className="p-3 text-xs text-muted-foreground">正在读取来源状态…</p>}{report?.sources.map(s => <div key={s.id} className="space-y-1 p-3 text-xs"><div className="flex flex-wrap justify-between gap-2"><button className="text-left font-medium hover:text-primary" onClick={() => void onOpen(s.url, s.name)}>{s.name} ↗</button><span className={s.error ? "text-amber-600 dark:text-amber-400" : "text-primary"}>{s.error ? (s.items.length ? "缓存" : "不可用") : "已获取"} · {s.items.length} 条</span></div><p className="text-[11px] text-muted-foreground">最近检查：{when(s.checkedAt)} · 最近成功：{s.fetchedAt ? when(s.fetchedAt) : "尚无成功记录"}</p>{s.error && <p className="break-words text-[11px] text-muted-foreground">{s.error}</p>}</div>)}</div></details>;
}
