import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, Check, ChevronDown, ExternalLink, MessageSquare, Newspaper, RefreshCw, Search, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { errText } from "@/lib/errors";
import { tauri } from "@/lib/tauri";
import { NBA_FEED_KEY, NBA_TEAMS, nbaTeamLabel, readNbaFeedPreferences, loadNbaFeed, filterNbaFeed, NbaFeedItem, NbaFeedReport } from "@/lib/nbaFeed";

const when = (value: string | null) => value ? new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "尚无成功记录";
const READ_KEY = "goldearth.nba.feed.read";
function readUrls(): string[] {
  try { const values = JSON.parse(localStorage.getItem(READ_KEY) || "[]"); return Array.isArray(values) ? values.filter(v => typeof v === "string") : []; } catch { return []; }
}

export function NbaFeed() {
  const [prefs, setPrefs] = useState(() => readNbaFeedPreferences(localStorage));
  const [settings, setSettings] = useState(() => !prefs.followed.length);
  const [kind, setKind] = useState<"news" | "post">("news");
  const [team, setTeam] = useState("all");
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("all");
  const [report, setReport] = useState<NbaFeedReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [storageError, setStorageError] = useState("");
  const [revision, setRevision] = useState(0);
  const consumedRevision = useRef(0);
  const [read, setRead] = useState(readUrls);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const followedKey = [...prefs.followed].sort().join(",");

  useEffect(() => {
    try { localStorage.setItem(NBA_FEED_KEY, JSON.stringify(prefs)); setStorageError(""); }
    catch { setStorageError("关注设置未能保存，本次页面仍可使用。"); }
    if (team !== "all" && !prefs.followed.includes(team)) setTeam("all");
  }, [prefs, team]);
  useEffect(() => {
    let disposed = false, busy = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = async (force = false) => {
      if (disposed || busy || document.hidden) return;
      busy = true; setLoading(true); setError("");
      try { const next = await loadNbaFeed(followedKey ? followedKey.split(",") : [], force); if (!disposed) setReport(next); }
      catch (e) { if (!disposed) setError(errText(e)); }
      finally {
        busy = false;
        if (!disposed) { setLoading(false); if (prefs.auto) timer = setTimeout(() => void update(), 10 * 60 * 1000); }
      }
    };
    const resume = () => { if (prefs.auto && !document.hidden) { clearTimeout(timer); void update(); } };
    // Team selection is debounced so checking several teams does not queue many crawls.
    timer = setTimeout(() => {
      const force = revision !== consumedRevision.current;
      consumedRevision.current = revision;
      void update(force);
    }, 350);
    document.addEventListener("visibilitychange", resume); window.addEventListener("online", resume);
    return () => { disposed = true; clearTimeout(timer); document.removeEventListener("visibilitychange", resume); window.removeEventListener("online", resume); };
  }, [followedKey, prefs.auto, revision]);

  function markRead(item: NbaFeedItem) {
    setRead(previous => {
      const next = [...new Set([...previous, item.url])].slice(-5000);
      try { localStorage.setItem(READ_KEY, JSON.stringify(next)); } catch { setStorageError("已读记录未能保存，本次页面仍可使用。"); }
      return next;
    });
  }
  async function open(item: NbaFeedItem) {
    try { await tauri.openReader(item.url, item.title); markRead(item); }
    catch (e) { setActionError(`打开原文失败：${errText(e)}`); }
  }
  async function openUrl(url: string, title: string) {
    try { await tauri.openReader(url, title); } catch (e) { setActionError(errText(e)); }
  }
  const visible = useMemo(() => filterNbaFeed(report, { followed: prefs.followed, team, kind, query, includeLeague: prefs.includeLeague, source }).filter(({ item }) => !unreadOnly || !read.includes(item.url)), [report, prefs, team, kind, query, source, unreadOnly, read]);
  const selectedStatuses = report?.sources.filter(s => s.kind === kind && (team === "all" || !s.team || s.team === team) && (s.kind !== "post" || !!s.team && prefs.followed.includes(s.team))) || [];
  const failures = selectedStatuses.filter(s => s.error);
  const followedTeams = NBA_TEAMS.filter(t => prefs.followed.includes(t.id));
  const allCurrent = filterNbaFeed(report, { followed: prefs.followed, team, kind, query: "", includeLeague: prefs.includeLeague, source: "all" });

  return <div className="flex h-full min-w-0 flex-col overflow-hidden">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4"><div className="flex items-center gap-3"><span className="rounded-xl bg-orange-500/10 p-2.5 text-orange-600 dark:text-orange-400"><Bell className="h-5 w-5" /></span><div><h1 className="text-base font-semibold">NBA 新闻与社区</h1><p className="mt-1 text-xs text-muted-foreground">关注球队 · 新闻推送 · 虎扑专区帖子</p></div></div><div className="flex flex-wrap items-center gap-2"><Button size="sm" variant={settings ? "secondary" : "outline"} onClick={() => setSettings(!settings)} aria-expanded={settings}><Settings2 className="h-3.5 w-3.5" />关注球队（{prefs.followed.length}）</Button><Button size="sm" variant="outline" disabled={loading} onClick={() => setRevision(r => r + 1)}><RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />{loading ? "获取中…" : "刷新资讯"}</Button></div></header>
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 lg:p-6">
      {settings && <section className="space-y-4 rounded-xl border bg-card p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold">选择想看的球队</h2><p className="mt-1 text-xs text-muted-foreground">新闻按球队标签筛选，虎扑仅抓取已关注球队的公开专区列表。</p></div><div className="flex gap-2"><Button size="sm" variant="ghost" onClick={() => setPrefs(p => ({ ...p, followed: NBA_TEAMS.map(t => t.id) }))}>全部关注</Button><Button size="sm" variant="ghost" onClick={() => setPrefs(p => ({ ...p, followed: [] }))}>清空关注</Button></div></div>{[["west", "西部球队"], ["east", "东部球队"]].map(([conference, label]) => <div key={conference}><h3 className="mb-2 text-xs font-medium text-muted-foreground">{label}</h3><div className="grid grid-cols-3 gap-2 sm:grid-cols-5 xl:grid-cols-8">{NBA_TEAMS.filter(t => t.conference === conference).map(t => <label key={t.id} className={cn("flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 text-xs", prefs.followed.includes(t.id) && "border-orange-500/40 bg-orange-500/5")} title={t.english}><input type="checkbox" checked={prefs.followed.includes(t.id)} onChange={e => setPrefs(p => ({ ...p, followed: e.target.checked ? [...p.followed, t.id] : p.followed.filter(id => id !== t.id) }))} className="accent-orange-500" />{t.name}</label>)}</div></div>)}<div className="flex flex-wrap items-center gap-4 border-t pt-3 text-xs"><label className="flex items-center gap-2"><input type="checkbox" checked={prefs.auto} onChange={e => setPrefs(p => ({ ...p, auto: e.target.checked }))} />每 10 分钟自动更新</label><label className="flex items-center gap-2"><input type="checkbox" checked={prefs.includeLeague} onChange={e => setPrefs(p => ({ ...p, includeLeague: e.target.checked }))} />同时显示未归类的联盟新闻</label></div></section>}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-gradient-to-br from-orange-500/10 via-background to-background p-5"><div><h2 className="font-semibold">{team === "all" ? followedTeams.length ? "我的球队动态" : "NBA 联盟资讯" : `${nbaTeamLabel(team)}专区`}</h2><p className="mt-2 text-xs leading-6 text-muted-foreground">{prefs.followed.length ? `已关注 ${prefs.followed.length} 支球队，点击下方球队即可查看专区。` : "当前展示联盟新闻，选择关注球队后可定向查看新闻与虎扑帖子。"}</p></div><div className="flex gap-6 text-center"><div><p className="font-mono text-2xl font-semibold">{allCurrent.length}</p><p className="mt-1 text-[11px] text-muted-foreground">当前内容</p></div><div><p className="font-mono text-2xl font-semibold">{allCurrent.filter(({ item }) => !read.includes(item.url)).length}</p><p className="mt-1 text-[11px] text-muted-foreground">未读</p></div></div></div>
      <div className="flex flex-wrap gap-2" aria-label="按球队专区筛选"><Button size="sm" variant={team === "all" ? "default" : "outline"} aria-pressed={team === "all"} onClick={() => setTeam("all")}>{prefs.followed.length ? "全部关注" : "联盟资讯"}</Button>{followedTeams.map(t => <Button key={t.id} size="sm" variant={team === t.id ? "default" : "outline"} aria-pressed={team === t.id} onClick={() => setTeam(t.id)}>{t.name}专区</Button>)}</div>
      <div className="flex flex-wrap items-center gap-3"><div className="flex gap-1 rounded-lg bg-muted p-1">{([["news", "新闻推送", Newspaper], ["post", "虎扑帖子", MessageSquare]] as const).map(([id, label, Icon]) => <Button key={id} size="sm" variant={kind === id ? "secondary" : "ghost"} aria-pressed={kind === id} onClick={() => { setKind(id); setSource("all"); }}><Icon className="h-3.5 w-3.5" />{label}</Button>)}</div><div className="relative min-w-44 flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input aria-label="搜索新闻或帖子" placeholder="搜索标题、球队或作者…" className="pl-9" value={query} onChange={e => setQuery(e.target.value)} /></div>{kind === "news" && <select aria-label="新闻来源" value={source} onChange={e => setSource(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-xs"><option value="all">全部新闻来源</option><option value="hupu-news">虎扑中文资讯</option><option value="espn-news">ESPN 英文新闻</option></select>}<label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={unreadOnly} onChange={e => setUnreadOnly(e.target.checked)} />只看未读</label></div>
      {(error || storageError || actionError || report?.warning) && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">{[error, storageError, actionError, report?.warning].filter(Boolean).join("；")}</div>}
      {!!failures.length && <div role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-muted-foreground">{failures.length} 个来源暂不可用，已有历史数据的来源保留缓存。可在下方查看抓取状态或打开原专区。</div>}
      <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground"><span>{visible.length} 条{kind === "post" ? "帖子 · 按专区分组，保留来源列表顺序" : "新闻 · 虎扑中文资讯与 ESPN 新闻"}</span><span>{prefs.auto ? "页面可见时每 10 分钟更新" : "手动刷新"}{loading ? " · 正在获取来源…" : ""}</span></div>
      {kind === "post" && !prefs.followed.length ? <Empty text="先关注想看的球队，即可获取对应虎扑专区帖子。" onClick={() => setSettings(true)} /> : !visible.length ? <Empty text={loading ? "正在获取新闻与球队专区帖子…" : "暂无匹配内容，可调整球队、关键词或来源后重试。"} /> : kind === "post" ? <div className="grid gap-4 xl:grid-cols-2">{followedTeams.filter(t => team === "all" || t.id === team).map(t => {
        const rows = visible.filter(({ item }) => item.teams.includes(t.id));
        return rows.length ? <section key={t.id} className="min-w-0 rounded-xl border bg-card"><div className="flex items-center justify-between gap-2 border-b px-4 py-3"><h3 className="text-sm font-semibold">{t.name}专区 <span className="ml-1 text-xs font-normal text-muted-foreground">{rows.length} 条</span></h3><Button size="sm" variant="ghost" onClick={() => void openUrl(`https://bbs.hupu.com/${t.forum}`, `${t.name}专区`)}><ExternalLink className="h-3.5 w-3.5" />原专区</Button></div><div className="divide-y">{rows.map(({ item, status }) => <FeedCard key={item.url} item={item} stale={!!status.error} read={read.includes(item.url)} onOpen={() => void open(item)} onRead={() => markRead(item)} />)}</div></section> : null;
      })}</div> : <div className="grid gap-3 xl:grid-cols-2">{visible.map(({ item, status }) => <div key={item.url} className="min-w-0 rounded-xl border bg-card"><FeedCard item={item} stale={!!status.error} read={read.includes(item.url)} onOpen={() => void open(item)} onRead={() => markRead(item)} /></div>)}</div>}
      <details className="rounded-xl border"><summary className="flex cursor-pointer items-center gap-2 p-3 text-xs font-medium"><ChevronDown className="h-3.5 w-3.5" />新闻与专区抓取状态</summary><div className="divide-y border-t">{!selectedStatuses.length && <p className="p-3 text-xs text-muted-foreground">{kind === "post" && !prefs.followed.length ? "尚未选择球队专区" : "尚无抓取状态"}</p>}{selectedStatuses.map(s => <div key={s.id} className="space-y-1 p-3 text-xs"><div className="flex flex-wrap justify-between gap-2"><span className="font-medium">{s.name}</span><span className={s.error ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}>{s.error ? s.items.length ? "历史缓存" : "获取失败" : `已获取 ${s.items.length} 条`}</span></div><p className="text-[11px] text-muted-foreground">最近成功：{when(s.fetchedAt)} · 最近检查：{when(s.checkedAt)}</p>{s.error && <p className="break-words text-[11px] text-muted-foreground">{s.error}</p>}</div>)}</div></details>
      <p className="pb-2 text-[11px] leading-6 text-muted-foreground">新闻取各来源最近列表。ESPN 通过球队标签归类，虎扑新闻通过标题中明确出现的球队名归类，未归类内容不推断球员所属球队。帖子按真实专区归类；专区时间可能是最后回复时间，保留原始标签，不作为发帖时间。虎扑仅读取公开列表，完整正文、评论和更多内容请打开原文。自动更新在此页打开且窗口可见时运行。</p>
    </div>
  </div>;
}
function Empty({ text, onClick }: { text: string; onClick?: () => void }) { return <div className="rounded-xl border border-dashed p-12 text-center"><MessageSquare className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" /><p className="text-sm text-muted-foreground">{text}</p>{onClick && <Button className="mt-4" size="sm" onClick={onClick}>选择关注球队</Button>}</div>; }
function FeedCard({ item, stale, read, onOpen, onRead }: { item: NbaFeedItem; stale: boolean; read: boolean; onOpen: () => void; onRead: () => void }) {
  return <article className={cn("p-4", read && "opacity-70")}><div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]"><span className="rounded bg-orange-500/10 px-2 py-1 text-orange-700 dark:text-orange-400">{item.source}</span>{item.teams.map(id => <span key={id} className="text-muted-foreground">{nbaTeamLabel(id)}</span>)}{!item.teams.length && <span className="text-muted-foreground">未归类 / 联盟</span>}{stale && <span className="text-amber-600 dark:text-amber-400">缓存</span>}{!read && <span className="ml-auto text-primary">未读</span>}</div><button className="text-left text-sm font-semibold leading-7 hover:text-primary" onClick={onOpen}>{item.title}</button>{item.summary && <p className="mt-2 line-clamp-3 text-xs leading-6 text-muted-foreground">{item.summary}</p>}<div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">{item.author && <span>{item.kind === "post" ? "作者" : "原始来源"}：{item.author}</span>}<span>{item.kind === "post" ? "专区时间：" : ""}{item.publishedAt ? when(item.publishedAt) : item.timeLabel || "来源未提供时间"}</span>{item.replies !== null && <span>{item.replies} 回复</span>}{item.views !== null && <span>{item.views} 浏览</span>}</div><div className="mt-3 flex justify-between gap-2"><Button size="sm" variant="ghost" onClick={onOpen}><ExternalLink className="h-3.5 w-3.5" />{item.kind === "post" ? "阅读帖子" : "阅读新闻"}</Button><Button size="sm" variant="ghost" disabled={read} onClick={onRead}><Check className="h-3.5 w-3.5" />{read ? "已读" : "标为已读"}</Button></div></article>;
}
