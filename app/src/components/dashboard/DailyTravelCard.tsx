import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Compass, GripHorizontal, MapPin, RefreshCw, Route } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { tauri } from "@/lib/tauri";
import { useTravel } from "@/store/travel";
import type { TravelDestination } from "@/types";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function readSize(key: string, fallback: number, min: number, max: number): number {
  try {
    const saved = window.localStorage.getItem(key);
    const value = saved === null ? NaN : Number(saved);
    return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
  } catch { return fallback; }
}
function saveSize(key: string, value: number | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, String(value));
  } catch { /* Viewing and resizing remain available when storage is disabled. */ }
}
const MIN_HEIGHT = 420, MAX_HEIGHT = 1400;

function RouteDays({ place }: { place: TravelDestination }) {
  return <div className="grid gap-3 sm:grid-cols-2">
    {place.route.map(day => <div key={day.title} className="min-w-0 rounded-lg border bg-muted/20 p-3">
      <h4 className="mb-2 text-xs font-medium">{day.title}</h4>
      <ol className="space-y-2">{day.stops.map((stop, index) => <li key={`${index}:${stop}`} className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
        <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[0.625rem] text-primary">{index + 1}</span>{stop}
      </li>)}</ol>
      {day.note && <p className="mt-3 border-t pt-2 text-[0.6875rem] leading-relaxed text-muted-foreground">{day.note}</p>}
    </div>)}
  </div>;
}

function GuideList({ title, items }: { title: string; items?: string[] }) {
  if (!items?.length) return null;
  return <section><h4 className="mb-2 text-xs font-medium">{title}</h4><ul className="list-disc space-y-2 pl-4 text-xs leading-relaxed text-muted-foreground">{items.map(item => <li key={item}>{item}</li>)}</ul></section>;
}

function Transport({ place }: { place: TravelDestination }) {
  return <div className="space-y-4 text-xs leading-relaxed">
    <section><h4 className="mb-2 font-medium">交通与住宿</h4><p className="text-muted-foreground">{place.transport}</p><p className="mt-2 text-muted-foreground">{place.stay}</p></section>
    <GuideList title="住在哪个片区" items={place.lodgingAreas} />
    <section><h4 className="mb-2 font-medium">预算明细 · {place.days} 天 {Math.max(0, place.days - 1)} 晚</h4>
      <p className="mb-2 font-semibold text-primary">{place.budget}</p>
      <dl className="space-y-2">{place.budgetItems?.map(item => <div key={item.label} className="rounded-md bg-muted/40 p-2"><dt className="font-medium">{item.label}</dt><dd className="mt-1 text-muted-foreground">{item.amount}</dd></div>)}</dl>
    </section>
    <p className="rounded-lg bg-muted/40 p-3 text-muted-foreground">{place.planningNote || "预算为规划估算，含住宿、餐饮、市内交通及游览，不含往返大交通；以实际报价为准。"}</p>
  </div>;
}

function Preparation({ place }: { place: TravelDestination }) {
  return <div className="space-y-4 text-xs leading-relaxed">
    <section><h4 className="mb-2 font-medium">吃点当地的</h4><p className="text-muted-foreground">{place.food.join(" · ")}</p></section>
    <section><h4 className="mb-2 font-medium">适合什么时候去</h4><p className="text-muted-foreground">{place.season}</p></section>
    <GuideList title="提前预约与购票" items={place.reservations} />
    <GuideList title="出行准备与避坑" items={place.tips} />
    <GuideList title="雨天与天气变化备选" items={place.rainyDay} />
  </div>;
}

export function DailyTravelCard({ date, compact = false }: { date: string; compact?: boolean }) {
  const { report: saved, loading, error, load } = useTravel();
  const [days, setDays] = useState(3);
  const [linkError, setLinkError] = useState("");
  const [guideOpen, setGuideOpen] = useState(false);
  const [sourcePage, setSourcePage] = useState(0);
  const [cardHeight, setCardHeight] = useState<number | null>(() => readSize("travel-card-height", 0, MIN_HEIGHT, MAX_HEIGHT) || null);
  const cardRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; height: number } | null>(null);
  const heightRef = useRef(cardHeight);
  const report = saved?.date === date && saved.destination.days === days ? saved : null;
  const place = report?.destination;
  useEffect(() => { void load(date, false, days); setLinkError(""); setGuideOpen(false); setSourcePage(0); }, [date, days, load]);
  useEffect(() => { setSourcePage(0); }, [report]);

  function changeHeight(value: number | null) {
    const next = value === null ? null : Math.round(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, value)));
    heightRef.current = next; setCardHeight(next);
    return next;
  }

  async function openSource(url: string, title: string) {
    setLinkError("");
    try { await tauri.openReader(url, title); }
    catch (e) { setLinkError(`打开攻略失败：${String(e)}`); }
  }

  const sources = report && place && <div className="space-y-3 text-xs leading-relaxed">
    <h4 className="font-medium">联网检索的攻略原文</h4>
    <p className="text-muted-foreground">{report.researchedAt ? `检索于 ${new Date(report.researchedAt).toLocaleString()}，搜索摘要用于补充核对。` : "当前没有可用的联网结果，可点击刷新攻略重试。"}</p>
    {report.sources.slice(sourcePage * 3, sourcePage * 3 + 3).map(source => <a key={source.url} href={source.url}
      onClick={e => { e.preventDefault(); void openSource(source.url, source.title); }} className="block rounded-md border p-3 hover:bg-accent">
      <span className="block break-words font-medium text-primary">{source.title} ↗</span><span className="mt-1 block break-words text-muted-foreground">{source.snippet}</span>
    </a>)}
    {report.sources.length > 3 && <div className="flex items-center justify-between gap-2">
      <Button size="sm" variant="ghost" disabled={sourcePage === 0} onClick={() => setSourcePage(page => page - 1)}>上一页</Button>
      <span className="text-muted-foreground">{sourcePage + 1} / {Math.ceil(report.sources.length / 3)}</span>
      <Button size="sm" variant="ghost" disabled={(sourcePage + 1) * 3 >= report.sources.length} onClick={() => setSourcePage(page => page + 1)}>下一页</Button>
    </div>}
    <a className="block text-primary underline underline-offset-2" href={place.referenceUrl} onClick={e => { e.preventDefault(); void openSource(place.referenceUrl, place.referenceTitle); }}>{place.referenceTitle} ↗</a>
    <p className="text-[0.625rem] text-muted-foreground">路线为本地整理的旅行参考，开放、预约、票价与班次请核对官方原文。</p>
  </div>;

  return <>
    <Card ref={cardRef} style={compact ? { height: cardHeight ?? undefined, minHeight: MIN_HEIGHT } : undefined} className={`min-w-0 overflow-hidden ${compact ? "flex h-full flex-col" : ""}`}>
      <CardContent className={`p-0 ${compact ? "flex min-h-0 flex-1 flex-col" : ""}`}>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
          <div className="flex items-center gap-2"><Compass className="h-4 w-4 text-primary" /><h2 className="text-sm font-semibold">每日旅行推荐</h2><span className="rounded-full bg-muted px-2 py-0.5 text-[0.625rem] text-muted-foreground">国内</span></div>
          <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-xs" disabled={loading} onClick={() => void load(date, true, days)} aria-label="重新联网检索今日旅行攻略">
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />{loading ? "正在检索" : "刷新攻略"}
          </Button>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b px-3 py-2" role="group" aria-label="旅行天数">
          <span className="mr-1 text-xs text-muted-foreground">想玩几天</span>
          {[2, 3, 5, 7].map(value => <Button key={value} size="sm" variant={days === value ? "default" : "ghost"} className="h-7 px-2.5 text-xs" aria-pressed={days === value} onClick={() => setDays(value)}>{value} 天</Button>)}
        </div>
        {!place || !report ? <div className={`space-y-3 p-4 ${compact ? "min-h-0 flex-1 overflow-y-auto" : ""}`} role="status">
          <p className="text-sm text-muted-foreground">{loading ? `正在准备 ${days} 天路线，并联网检索相关攻略…` : error || "暂时无法获取今日推荐"}</p>
          {loading ? <div className="h-24 animate-pulse rounded-lg bg-muted/60" /> : <Button size="sm" variant="outline" onClick={() => void load(date, true, days)}>重试</Button>}
        </div> : <>
          <div className={compact ? "min-h-0 flex-1 overflow-y-auto" : ""}>
          <div className="shrink-0 bg-gradient-to-br from-primary/10 via-background to-muted/40 px-3 py-3">
            <div className="flex flex-wrap items-center gap-2 text-[0.6875rem] text-muted-foreground"><span>{report.date} · 每天一个目的地</span><span className="rounded-full border bg-background/80 px-2 py-0.5">{report.status === "live" ? "已联网检索" : report.status === "cached" ? "今日检索缓存" : "本地路线参考"}</span></div>
            <div className="mt-2 flex flex-wrap items-end justify-between gap-2"><div className="min-w-0"><div className="flex items-baseline gap-2"><h3 className="text-2xl font-semibold tracking-tight">{place.name}</h3><span className="text-xs text-muted-foreground">{place.region}</span></div><p className="mt-1 text-sm text-primary">{place.theme}</p></div><span className="rounded-md border bg-background/80 px-2.5 py-1.5 text-xs">{place.days} 天 {place.days - 1} 晚 · {place.budget}</span></div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{place.intro}</p>
            <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground"><MapPin className="mt-0.5 h-3 w-3 shrink-0" />{place.season}</p>
          </div>
          {(report.warning || error) && <div role="status" className="shrink-0 border-y border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
            <p>{error || report.warning}</p>
            {!!report.diagnostics?.length && <details className="mt-1"><summary className="cursor-pointer">检索详情</summary><ul className="mt-1 space-y-1">{report.diagnostics.map((detail, index) => <li key={index}>{detail}</li>)}</ul></details>}
            {report.status === "offline" && <button type="button" className="mt-1 underline underline-offset-2" onClick={() => void openSource(`https://www.so.com/s?q=${encodeURIComponent(`${place.name} ${days}天 旅游攻略`)}`, `${place.name} · 手动搜索攻略`)}>打开搜索页面手动查看 ↗</button>}
          </div>}
          <div className={compact ? "p-3" : "p-4"}>
            <div className="mb-3 flex items-center gap-1.5 text-xs font-medium"><Route className="h-3.5 w-3.5 text-primary" />{place.days} 天完整路线 · 向下滚动查看</div>
            <RouteDays place={place} />
            <p className="mt-3 text-[0.625rem] leading-relaxed text-muted-foreground">预算为规划估算，不含往返大交通；住宿按双人分摊，以实际报价为准。</p>
            {!compact && <details className="mt-4 border-t pt-3"><summary className="cursor-pointer text-xs font-medium text-primary">查看完整攻略与来源</summary><div className="mt-4 space-y-5"><Transport place={place} /><Preparation place={place} />{sources}</div></details>}
            {linkError && <p role="alert" className="mt-3 text-xs text-destructive">{linkError}</p>}
          </div>
          </div>
          {compact && <div className="shrink-0 border-t p-3"><Button className="h-8 w-full gap-1.5 text-xs" variant="outline" onClick={() => setGuideOpen(true)}>查看完整 {place.days} 天攻略与来源<ArrowUpRight className="h-3 w-3" /></Button></div>}
        </>}
      </CardContent>
      {compact && <div role="separator" tabIndex={0} aria-label="调整旅行卡片高度" aria-orientation="horizontal" aria-valuemin={MIN_HEIGHT} aria-valuemax={MAX_HEIGHT} aria-valuenow={cardHeight ?? undefined} aria-valuetext={cardHeight ? `${cardHeight} 像素` : "自动适应窗口"}
        title="上下拖动调整高度，双击恢复；方向键微调"
        className="flex h-5 shrink-0 touch-none select-none items-center justify-center gap-1.5 border-t text-[0.625rem] text-muted-foreground cursor-row-resize hover:bg-primary/10 focus-visible:bg-primary/10 focus-visible:outline-none"
        onPointerDown={event => {
          if (event.button !== 0 || !event.isPrimary) return;
          event.preventDefault();
          drag.current = { y: event.clientY, height: cardRef.current?.getBoundingClientRect().height ?? 600 };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => { if (drag.current) changeHeight(drag.current.height + event.clientY - drag.current.y); }}
        onPointerUp={event => {
          if (!drag.current) return;
          drag.current = null; saveSize("travel-card-height", heightRef.current);
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => { drag.current = null; saveSize("travel-card-height", heightRef.current); }}
        onLostPointerCapture={() => { drag.current = null; }}
        onDoubleClick={() => { changeHeight(null); saveSize("travel-card-height", null); }}
        onKeyDown={event => {
          if (!["ArrowUp", "ArrowDown", "Home"].includes(event.key)) return;
          event.preventDefault();
          const current = heightRef.current ?? cardRef.current?.getBoundingClientRect().height ?? 600;
          saveSize("travel-card-height", changeHeight(event.key === "Home" ? null : current + (event.key === "ArrowDown" ? 40 : -40)));
        }}><GripHorizontal className="h-3 w-3" />拖动调整高度</div>}
    </Card>
    {compact && place && report && <Dialog open={guideOpen} onOpenChange={setGuideOpen}>
      <DialogContent className="flex max-h-[85vh] w-[calc(100vw-3rem)] max-w-3xl flex-col gap-3 p-4">
        <DialogHeader className="pr-6"><DialogTitle className="text-base">{place.name} · {place.days} 天完整攻略</DialogTitle><DialogDescription className="text-xs">{report.date} · {place.days} 天 {place.days - 1} 晚 · {place.budget}（规划估算）</DialogDescription></DialogHeader>
        <Tabs defaultValue="route" className="min-h-0 overflow-y-auto">
          <TabsList className="grid h-auto w-full grid-cols-4">
            <TabsTrigger value="route" className="px-1 text-xs">每日行程</TabsTrigger><TabsTrigger value="transport" className="px-1 text-xs">交通预算</TabsTrigger><TabsTrigger value="tips" className="px-1 text-xs">美食准备</TabsTrigger><TabsTrigger value="sources" className="px-1 text-xs">攻略来源</TabsTrigger>
          </TabsList>
          <TabsContent value="route" className="py-2"><p className="mb-3 text-xs leading-relaxed text-muted-foreground">按游览顺序提供上午、下午和晚间参考，抵达日与返程日按实际交通删减。</p><RouteDays place={place} /></TabsContent>
          <TabsContent value="transport" className="py-2"><Transport place={place} /></TabsContent>
          <TabsContent value="tips" className="py-2"><Preparation place={place} /></TabsContent>
          <TabsContent value="sources" className="py-2">{sources}</TabsContent>
        </Tabs>
        {linkError && <p role="alert" className="text-xs text-destructive">{linkError}</p>}
      </DialogContent>
    </Dialog>}
  </>;
}
