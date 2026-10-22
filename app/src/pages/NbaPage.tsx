import { useEffect, useState } from "react";
import { Activity, CalendarDays, ChevronLeft, ChevronRight, CircleDot, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { beijingDate, loadScoreboard, loadSummary, nbaSnapshot, pollNba, NbaCompetitor, NbaEvent, NbaSummary, NbaTeam, shiftDate, statusText, teamName } from "@/lib/nba";

const time = (date: string | number) => new Date(date).toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", ...(typeof date === "number" ? { second: "2-digit" } : {}) });
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const LABELS: Record<string, string> = { MIN: "时间", PTS: "得分", REB: "篮板", AST: "助攻", STL: "抢断", BLK: "盖帽", TO: "失误", FG: "投篮", "3PT": "三分", FT: "罚球", OREB: "前板", DREB: "后板", PF: "犯规", "+/-": "正负值" };
function TeamLogo({ team }: { team: NbaTeam }) {
  const [failed, setFailed] = useState(false);
  return <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-[10px] font-bold">{team.logo && !failed ? <img src={team.logo} alt="" className="h-8 w-8 object-contain" onError={() => setFailed(true)} /> : team.abbreviation}</span>;
}
function TeamRow({ side, scheduled }: { side: NbaCompetitor; scheduled: boolean }) {
  return <div className="flex items-center gap-3"><TeamLogo team={side.team} /><span className="min-w-0 flex-1 truncate font-semibold">{teamName(side.team)} <span className="text-xs font-normal text-muted-foreground">{side.homeAway === "home" ? "主" : "客"}</span></span><span className="font-mono text-2xl font-semibold tabular-nums">{scheduled ? "—" : side.score ?? "—"}</span></div>;
}
function BoxScore({ data, game }: { data: NbaSummary; game: NbaEvent }) {
  const teams = data.boxscore?.teams || [];
  const players = data.boxscore?.players || [];
  const [tab, setTab] = useState("teams");
  const sides = game.competitions[0].competitors;
  const periods = Math.max(0, ...sides.map(s => s.linescores?.length || 0));
  return <div className="space-y-5">
    {periods > 0 && <div className="overflow-x-auto rounded-xl border"><table className="w-full text-sm tabular-nums"><thead className="bg-muted/60 text-muted-foreground"><tr><th className="p-3 text-left font-medium">分节比分</th>{Array.from({ length: periods }, (_, i) => <th key={i} className="px-3 font-medium">{i < 4 ? `Q${i + 1}` : `OT${i - 3}`}</th>)}<th className="px-3">总分</th></tr></thead><tbody>{sides.map(s => <tr key={s.team.id} className="border-t"><td className="whitespace-nowrap p-3 font-medium">{teamName(s.team)}</td>{Array.from({ length: periods }, (_, i) => <td key={i} className="px-3 text-center">{s.linescores?.[i]?.displayValue ?? s.linescores?.[i]?.value ?? "—"}</td>)}<td className="px-3 text-center font-bold">{s.score ?? "—"}</td></tr>)}</tbody></table></div>}
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="技术统计">{[["teams", "球队对比"], ...players.map(t => [t.team.id, teamName(t.team)])].map(([id, label]) => <Button key={id} role="tab" aria-selected={tab === id} size="sm" variant={tab === id ? "default" : "outline"} onClick={() => setTab(id)}>{label}{id !== "teams" ? "球员" : ""}</Button>)}</div>
    {tab === "teams" ? teams.length === 2 && teams.some(t => t.statistics?.length) ? <div className="rounded-xl border p-4"><div className="mb-4 flex justify-between text-sm font-semibold"><span>{teamName(teams[0].team)}</span><span>{teamName(teams[1].team)}</span></div><div className="space-y-1">{(teams[0].statistics || []).map(stat => {
      const other = teams[1].statistics?.find(s => s.name === stat.name);
      const labels: Record<string, string> = { "fieldGoalsMade-fieldGoalsAttempted": "投篮命中 / 出手", "threePointFieldGoalsMade-threePointFieldGoalsAttempted": "三分命中 / 出手", "freeThrowsMade-freeThrowsAttempted": "罚球命中 / 出手", teamTurnovers: "球队失误", totalTechnicalFouls: "总技术犯规", pointsOffTurnovers: "失误转化得分", leadChanges: "领先交替", percentLed: "领先时间占比", fieldGoalsMade: "投篮命中", fieldGoalsAttempted: "投篮出手", fieldGoalPct: "投篮命中率", threePointFieldGoalsMade: "三分命中", threePointFieldGoalsAttempted: "三分出手", threePointFieldGoalPct: "三分命中率", freeThrowsMade: "罚球命中", freeThrowsAttempted: "罚球出手", freeThrowPct: "罚球命中率", totalRebounds: "篮板", offensiveRebounds: "进攻篮板", defensiveRebounds: "防守篮板", assists: "助攻", steals: "抢断", blocks: "盖帽", turnovers: "失误", totalTurnovers: "总失误", fouls: "犯规", pointsInPaint: "内线得分", fastBreakPoints: "快攻得分", largestLead: "最大领先", rebounds: "篮板", technicalFouls: "技术犯规", flagrantFouls: "恶意犯规" };
      return <div key={stat.name} className="grid grid-cols-[1fr_2fr_1fr] items-center gap-2 rounded-lg px-3 py-2 text-sm even:bg-muted/50"><span className="font-mono font-semibold">{stat.displayValue}</span><span className="text-center text-xs text-muted-foreground">{labels[stat.name] || stat.label}</span><span className="text-right font-mono font-semibold">{other?.displayValue ?? "—"}</span></div>;
    })}</div></div> : <Empty text="暂无球队技术统计，开赛后自动更新" /> : players.filter(t => t.team.id === tab).map(t => <div key={t.team.id} className="space-y-3">{t.statistics?.length ? t.statistics.map((group, i) => <div key={i} className="overflow-x-auto rounded-xl border"><table className="w-full whitespace-nowrap text-xs tabular-nums"><thead className="bg-muted/60 text-muted-foreground"><tr><th className="p-3 text-left font-medium">球员</th>{group.labels.map(label => <th key={label} className="px-3 py-3 text-right font-medium">{LABELS[label] || label}</th>)}</tr></thead><tbody>{group.athletes.map(p => <tr key={p.athlete.id} className="border-t hover:bg-muted/40"><td className="p-3"><div className="font-medium">{p.athlete.displayName}</div><div className="mt-1 text-[10px] text-muted-foreground">#{p.athlete.jersey || "—"} · {p.didNotPlay ? "未出场" : p.starter ? "首发" : "替补"}</div></td>{group.labels.map((label, j) => <td key={label} className={cn("px-3 text-right font-mono", label === "PTS" && "font-bold text-orange-600 dark:text-orange-400")}>{p.didNotPlay ? "—" : p.stats[j] ?? "—"}</td>)}</tr>)}</tbody></table></div>) : <Empty text="暂无球员统计，开赛后自动更新" />}</div>)}
  </div>;
}
function Empty({ text }: { text: string }) { return <div className="flex min-h-44 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground"><CircleDot className="h-8 w-8 opacity-40" />{text}</div>; }

export default function NbaPage() {
  const [date, setDate] = useState(beijingDate);
  const [games, setGames] = useState<NbaEvent[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [summary, setSummary] = useState<NbaSummary | null>(null);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [updated, setUpdated] = useState<number | null>(null);
  const [detailUpdated, setDetailUpdated] = useState<number | null>(null);
  const [auto, setAuto] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const saved = nbaSnapshot<NbaEvent[]>(`scoreboard:${date}`);
    setGames(saved?.data || []); setUpdated(saved?.updated || null); setSelected(saved?.data[0]?.id || null); setError(""); setLoading(true);
  }, [date]);
  useEffect(() => {
    let disposed = false;
    const update = async () => {
      setLoading(true);
      try {
        const result = await loadScoreboard(date);
        if (!disposed) {
          setGames(result); setUpdated(Date.now()); setError("");
          setSelected(previous => result.some(g => g.id === previous) ? previous : result.find(g => g.status.type.state === "in")?.id || result[0]?.id || null);
        }
      } catch (e) { if (!disposed) setError(message(e)); throw e; }
      finally { if (!disposed) setLoading(false); }
    };
    const stop = pollNba(update, auto);
    return () => { disposed = true; stop(); };
  }, [date, auto, refresh]);
  useEffect(() => {
    const saved = selected ? nbaSnapshot<NbaSummary>(`summary:${selected}`) : undefined;
    setSummary(saved?.data || null); setDetailError(""); setDetailUpdated(saved?.updated || null);
  }, [selected]);
  useEffect(() => {
    let disposed = false;
    if (!selected) { setDetailLoading(false); return; }
    const update = async () => {
      setDetailLoading(true);
      try { const result = await loadSummary(selected); if (!disposed) { setSummary(result); setDetailUpdated(Date.now()); setDetailError(""); } }
      catch (e) { if (!disposed) setDetailError(message(e)); throw e; }
      finally { if (!disposed) setDetailLoading(false); }
    };
    const stop = pollNba(update, auto);
    return () => { disposed = true; stop(); };
  }, [selected, auto, refresh]);
  const active = games.find(g => g.id === selected);
  const live = games.filter(g => g.status.type.state === "in").length;
  const visible = games.filter(g => (filter === "all" || g.status.type.state === filter) && (!search.trim() || g.competitions[0].competitors.some(c => `${teamName(c.team)} ${c.team.displayName} ${c.team.abbreviation}`.toLowerCase().includes(search.trim().toLowerCase()))));
  return <div className="flex h-full min-w-0 flex-col overflow-hidden">
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-5 py-3"><div className="flex items-center gap-3"><span className="rounded-xl bg-orange-500/10 p-2.5 text-orange-600 dark:text-orange-400"><CircleDot className="h-5 w-5" /></span><div><h1 className="text-base font-semibold">NBA 赛事中心</h1><p className="mt-0.5 text-xs text-muted-foreground">每日赛程 · 实时比分 · 技术统计</p></div></div><div className="flex flex-wrap items-center gap-3"><label className="flex cursor-pointer items-center gap-2 text-xs"><input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} className="accent-orange-500" />15 秒自动刷新</label><Button size="sm" variant="outline" disabled={loading || detailLoading} onClick={() => setRefresh(n => n + 1)}><RefreshCw className={cn("mr-2 h-3.5 w-3.5", loading && "animate-spin")} />刷新</Button></div></header>
    <div className="min-h-0 flex-1 overflow-y-auto p-4 lg:p-6"><div className="mx-auto max-w-[1600px] space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap items-center gap-2"><CalendarDays className="mr-1 h-4 w-4 text-muted-foreground" /><Button size="icon" variant="outline" aria-label="前一天" onClick={() => setDate(shiftDate(date, -1))}><ChevronLeft className="h-4 w-4" /></Button><input type="date" aria-label="赛程日期（北京时间）" value={date} min="2000-01-01" max="2100-12-31" onChange={e => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) setDate(e.target.value); }} className="h-10 rounded-md border bg-background px-3 text-sm [color-scheme:light] dark:[color-scheme:dark]" /><Button size="icon" variant="outline" aria-label="后一天" onClick={() => setDate(shiftDate(date, 1))}><ChevronRight className="h-4 w-4" /></Button><Button variant="ghost" size="sm" onClick={() => setDate(beijingDate())}>今天</Button><span className="text-xs text-muted-foreground">北京时间 UTC+8</span></div><div className="flex items-center gap-2 text-xs text-muted-foreground"><span className={cn("h-1.5 w-1.5 rounded-full", error ? "bg-red-500" : updated ? "bg-emerald-500" : "bg-muted-foreground")} />{error ? "连接异常 · 数据可能已过期" : updated ? `比分更新于 ${time(updated)}` : "正在连接赛事数据…"}</div></div>
      <div className="grid grid-cols-3 gap-3">{[["当日比赛", games.length, CalendarDays], ["正在进行", live, Activity], ["已经结束", games.filter(g => g.status.type.completed).length, CircleDot]].map(([label, value, Icon]) => { const I = Icon as typeof Activity; return <div key={String(label)} className="flex items-center justify-between rounded-xl border bg-card p-4"><div><p className="text-xs text-muted-foreground">{String(label)}</p><p className="mt-2 font-mono text-2xl font-semibold">{updated ? String(value) : "—"}<span className="ml-2 text-xs font-normal text-muted-foreground">场</span></p></div><I className="hidden h-5 w-5 text-orange-500/70 sm:block" /></div>; })}</div>
      {error && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}。可点击刷新重试。{updated ? "当前保留上次成功获取的数据。" : ""}</div>}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(240px,300px)_minmax(0,1fr)]">
        <section className="min-w-0 space-y-3"><div className="flex flex-wrap gap-1">{[["all", "全部"], ["in", "进行中"], ["pre", "未开始"], ["post", "已结束"]].map(([id, label]) => <Button key={id} size="sm" variant={filter === id ? "default" : "ghost"} onClick={() => setFilter(id)}>{label}</Button>)}</div><div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><input aria-label="搜索球队" placeholder="搜索球队名称或缩写" value={search} onChange={e => setSearch(e.target.value)} className="h-10 w-full rounded-lg border bg-background pl-9 pr-3 text-sm" /></div>
          <div className="max-h-[65vh] space-y-3 overflow-y-auto p-1 lg:max-h-[calc(100vh-19rem)]">{visible.map(game => { const competition = game.competitions[0]; const inPlay = game.status.type.state === "in"; return <button key={game.id} onClick={() => setSelected(game.id)} aria-pressed={selected === game.id} className={cn("w-full space-y-4 rounded-xl border bg-card p-4 text-left transition-colors hover:border-orange-400", selected === game.id && "border-orange-500 ring-1 ring-orange-500/20")}><div className="flex items-center justify-between gap-2 text-xs"><span className={cn("flex items-center gap-1.5", inPlay ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>{inPlay && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />}{statusText(game.status)}</span><span className="text-muted-foreground">{time(game.date)}</span></div><div className="space-y-3">{[...competition.competitors].sort((a, b) => (a.homeAway === "away" ? 0 : 1) - (b.homeAway === "away" ? 0 : 1)).map(side => <TeamRow key={side.team.id} side={side} scheduled={game.status.type.state === "pre"} />)}</div><div className="flex justify-between border-t pt-3 text-[11px] text-muted-foreground"><span className="truncate">{competition.venue?.fullName || "场馆待公布"}</span><span className="ml-2 shrink-0">查看数据 →</span></div></button>; })}{!visible.length && <div className="rounded-xl border bg-card"><Empty text={loading ? "正在获取每日赛程…" : error && !updated ? "赛程加载失败，请刷新重试" : games.length ? "没有符合筛选条件的比赛" : "当日暂无 NBA 比赛，试试其他日期"} /></div>}</div>
        </section>
        <section className="min-w-0 rounded-xl border bg-card"><div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-4"><h2 className="text-sm font-semibold">{active ? active.competitions[0].competitors.map(c => teamName(c.team)).join(" vs ") : "比赛详情"}</h2><span className="text-xs text-muted-foreground">{detailUpdated ? `统计更新 ${time(detailUpdated)}` : "技术统计"}</span></div><div className="p-4 lg:p-5">{detailError && <div role="alert" className="mb-4 rounded-lg bg-destructive/5 p-3 text-xs text-destructive">统计获取失败：{detailError}。{summary ? "保留上次数据，等待重试。" : "请点击刷新重试。"}</div>}{active ? summary ? <BoxScore key={active.id} data={summary} game={active} /> : <Empty text={detailLoading ? "正在获取比赛技术统计…" : "暂无技术统计"} /> : <Empty text="选择一场比赛，查看球队对比与球员表现" />}</div></section>
      </div><footer className="pb-2 text-xs leading-5 text-muted-foreground">数据来源 ESPN · 所有赛程日期和开赛时间均为北京时间 · 比分与统计以数据源更新为准{auto ? " · 页面在后台时暂停请求" : " · 自动刷新已暂停"}</footer>
    </div></div>
  </div>;
}
