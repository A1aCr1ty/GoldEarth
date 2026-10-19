import { useEffect, useState } from "react";
import { ArrowUpRight, Compass, MapPin, RefreshCw, Route, Train, Utensils } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { tauri } from "@/lib/tauri";
import { useTravel } from "@/store/travel";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function DailyTravelCard({ date, compact = false }: { date: string; compact?: boolean }) {
  const { report: saved, loading, error, load } = useTravel();
  const [linkError, setLinkError] = useState("");
  const [guideOpen, setGuideOpen] = useState(false);
  const [sourcePage, setSourcePage] = useState(0);
  const report = saved?.date === date ? saved : null;
  const place = report?.destination;
  useEffect(() => { void load(date); setLinkError(""); setGuideOpen(false); setSourcePage(0); }, [date, load]);

  async function openSource(url: string, title: string) {
    setLinkError("");
    try { await tauri.openReader(url, title); }
    catch (e) { setLinkError(`打开攻略失败：${String(e)}`); }
  }

  return (
    <>
    <Card className={`min-w-0 overflow-hidden ${compact ? "flex h-full min-h-0 flex-col" : ""}`}>
      <CardContent className={`p-0 ${compact ? "flex min-h-0 flex-1 flex-col" : ""}`}>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
          <div className="flex items-center gap-2">
            <Compass className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">每日旅行推荐</h2>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[0.625rem] text-muted-foreground">国内</span>
          </div>
          <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-xs" disabled={loading}
            onClick={() => void load(date, true)} aria-label="重新联网检索今日旅行攻略">
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />{loading ? "正在检索" : "刷新攻略"}
          </Button>
        </div>
        {!place ? (
          <div className="space-y-3 p-4" role="status">
            <p className="text-sm text-muted-foreground">{loading ? "正在准备今天的目的地，并联网检索相关攻略…" : error || "暂时无法获取今日推荐"}</p>
            {loading && <div className="h-24 animate-pulse rounded-lg bg-muted/60" />}
            {!loading && <Button size="sm" variant="outline" onClick={() => void load(date, true)}>重试</Button>}
          </div>
        ) : (
          <>
            <div className={`shrink-0 bg-gradient-to-br from-primary/10 via-background to-muted/40 px-3 ${compact ? "py-3" : "py-4"}`}>
              <div className="flex flex-wrap items-center gap-2 text-[0.6875rem] text-muted-foreground">
                <span>{report.date} · 每天一个目的地</span>
                <span className="rounded-full border bg-background/80 px-2 py-0.5">
                  {report.status === "live" ? "已联网检索" : report.status === "cached" ? "今日检索缓存" : "本地路线参考"}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-end justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2"><h3 className="text-2xl font-semibold tracking-tight">{place.name}</h3><span className="text-xs text-muted-foreground">{place.region}</span></div>
                  <p className="mt-1 text-sm text-primary">{place.theme}</p>
                </div>
                <span className="rounded-md border bg-background/80 px-2.5 py-1.5 text-xs">{place.days} 天 1 晚 · {place.budget}</span>
              </div>
              <p className={`${compact ? "mt-2 line-clamp-2 text-xs" : "mt-3 text-sm"} leading-relaxed text-muted-foreground`}>{place.intro}</p>
              <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground"><MapPin className="mt-0.5 h-3 w-3 shrink-0" />{place.season}</p>
            </div>
            {(report.warning || error) && <p role="status" className="border-y border-amber-500/20 bg-amber-500/5 px-4 py-2 text-xs leading-relaxed text-amber-700 dark:text-amber-300">{error || report.warning}</p>}
            <div className={compact ? "min-h-0 flex-1 overflow-y-auto p-3" : "p-4"}>
              <div className="mb-2 flex items-center gap-1.5 text-xs font-medium"><Route className="h-3.5 w-3.5 text-primary" />轻松游 · 参考路线</div>
              <div className="grid gap-2 sm:grid-cols-2">
                {place.route.map((day, index) => <div key={day.title} className="min-w-0 rounded-lg border bg-muted/20 p-3">
                  <p className="mb-2 text-xs font-medium">{day.title}</p>
                  <ol className={compact ? "space-y-1" : "space-y-2"}>{day.stops.map((stop, step) => <li key={stop} className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[0.625rem] text-primary">{index * 3 + step + 1}</span>{stop}
                  </li>)}</ol>
                </div>)}
              </div>
              <p className="mt-3 text-[0.625rem] leading-relaxed text-muted-foreground">预算为规划估算，含住宿、餐饮、市内交通及游览，不含往返大交通；以实际报价为准。</p>
              {!compact && <details className="mt-4 border-t pt-3">
                <summary className="cursor-pointer text-xs font-medium text-primary">查看完整攻略与来源</summary>
                <div className="mt-4 space-y-4 text-xs leading-relaxed">
                  <div><h4 className="mb-1 flex items-center gap-1.5 font-medium"><Train className="h-3.5 w-3.5" />交通与住宿</h4><p className="text-muted-foreground">{place.transport}</p><p className="mt-1 text-muted-foreground">{place.stay}</p></div>
                  <div><h4 className="mb-1 flex items-center gap-1.5 font-medium"><Utensils className="h-3.5 w-3.5" />吃点当地的</h4><p className="text-muted-foreground">{place.food.join(" · ")}</p></div>
                  <div><h4 className="mb-1 font-medium">出行准备</h4><ul className="list-disc space-y-1 pl-4 text-muted-foreground">{place.tips.map(tip => <li key={tip}>{tip}</li>)}</ul></div>
                  <div className="space-y-2 border-t pt-3">
                    <h4 className="font-medium">联网检索的攻略原文</h4>
                    {report.researchedAt && <p className="text-[0.625rem] text-muted-foreground">检索于 {new Date(report.researchedAt).toLocaleString()}；以下为搜索摘要，开放、预约及票价请核对原文。</p>}
                    {report.sources.length === 0 && <p className="text-muted-foreground">当前没有可用的联网搜索结果，点击“刷新攻略”重试。</p>}
                    {report.sources.map(source => <a key={source.url} href={source.url} onClick={e => { e.preventDefault(); void openSource(source.url, source.title); }}
                      className="block min-w-0 rounded-md border p-2.5 transition-colors hover:bg-accent">
                      <span className="flex items-start gap-1.5 font-medium"><span className="min-w-0 break-words">{source.title}</span><ArrowUpRight className="mt-0.5 h-3 w-3 shrink-0" /></span>
                      <span className="mt-1 line-clamp-2 block text-muted-foreground">{source.snippet}</span>
                    </a>)}
                    <p className="pt-1 text-[0.625rem] text-muted-foreground">路线为本地整理的旅行参考，联网原文用于补充核对。</p>
                    <a href={place.referenceUrl} onClick={e => { e.preventDefault(); void openSource(place.referenceUrl, place.referenceTitle); }} className="inline-flex items-center gap-1 text-primary underline underline-offset-2">{place.referenceTitle}<ArrowUpRight className="h-3 w-3" /></a>
                  </div>
                </div>
              </details>}
              {linkError && <p role="alert" className="mt-3 text-xs text-destructive">{linkError}</p>}
            </div>
            {compact && <div className="shrink-0 border-t p-3">
              <Button className="h-8 w-full gap-1.5 text-xs" variant="outline" onClick={() => { setSourcePage(0); setGuideOpen(true); }}>查看完整攻略与来源<ArrowUpRight className="h-3 w-3" /></Button>
            </div>}
          </>
        )}
      </CardContent>
    </Card>
    {compact && place && report && <Dialog open={guideOpen} onOpenChange={setGuideOpen}>
      <DialogContent className="flex max-h-[85vh] w-[calc(100vw-3rem)] max-w-2xl flex-col gap-3 p-4">
        <DialogHeader className="pr-6"><DialogTitle className="text-base">{place.name} · 完整攻略</DialogTitle>
          <DialogDescription className="text-xs">{report.date} · {place.days} 天路线参考 · 预算 {place.budget}</DialogDescription></DialogHeader>
        <Tabs defaultValue="transport" className="min-h-0">
          <TabsList className="grid h-8 w-full grid-cols-3">
            <TabsTrigger value="transport" className="h-7 text-xs">交通住宿</TabsTrigger>
            <TabsTrigger value="tips" className="h-7 text-xs">美食与准备</TabsTrigger>
            <TabsTrigger value="sources" className="h-7 text-xs">攻略来源</TabsTrigger>
          </TabsList>
          <TabsContent value="transport" className="max-h-[55vh] space-y-3 overflow-y-auto py-2 text-xs leading-relaxed">
            <p className="text-muted-foreground">{place.intro}</p>
            <div><h4 className="mb-1 font-medium">怎么到达与市内交通</h4><p className="text-muted-foreground">{place.transport}</p></div>
            <div><h4 className="mb-1 font-medium">住宿建议</h4><p className="text-muted-foreground">{place.stay}</p></div>
            <p className="rounded-md bg-muted/40 p-3 text-muted-foreground">预算为规划估算，含住宿、餐饮、市内交通及游览，不含往返大交通；以实际报价为准。</p>
          </TabsContent>
          <TabsContent value="tips" className="max-h-[55vh] space-y-3 overflow-y-auto py-2 text-xs leading-relaxed">
            <div><h4 className="mb-1 font-medium">吃点当地的</h4><p className="text-muted-foreground">{place.food.join(" · ")}</p></div>
            <div><h4 className="mb-1 font-medium">适合什么时候去</h4><p className="text-muted-foreground">{place.season}</p></div>
            <ul className="list-disc space-y-2 pl-4 text-muted-foreground">{place.tips.map(tip => <li key={tip}>{tip}</li>)}</ul>
          </TabsContent>
          <TabsContent value="sources" className="space-y-2 py-2 text-xs leading-relaxed">
            <p className="text-muted-foreground">{report.researchedAt ? `检索于 ${new Date(report.researchedAt).toLocaleString()}` : "当前没有可用的联网结果，可关闭窗口后刷新攻略。"}</p>
            {report.sources.slice(sourcePage * 2, sourcePage * 2 + 2).map(source => <a key={source.url} href={source.url}
              onClick={e => { e.preventDefault(); void openSource(source.url, source.title); }} className="block rounded-md border p-3 hover:bg-accent">
              <span className="line-clamp-2 font-medium text-primary">{source.title} ↗</span><span className="mt-1 line-clamp-2 text-muted-foreground">{source.snippet}</span>
            </a>)}
            {report.sources.length > 2 && <div className="flex items-center justify-between gap-2">
              <Button size="sm" variant="ghost" disabled={sourcePage === 0} onClick={() => setSourcePage(page => page - 1)}>上一页</Button>
              <span className="text-muted-foreground">{sourcePage + 1} / {Math.ceil(report.sources.length / 2)}</span>
              <Button size="sm" variant="ghost" disabled={(sourcePage + 1) * 2 >= report.sources.length} onClick={() => setSourcePage(page => page + 1)}>下一页</Button>
            </div>}
            <a className="block text-primary underline underline-offset-2" href={place.referenceUrl} onClick={e => { e.preventDefault(); void openSource(place.referenceUrl, place.referenceTitle); }}>{place.referenceTitle} ↗</a>
            <p className="text-[0.625rem] text-muted-foreground">路线为本地整理的旅行参考，开放、预约与票价请核对原文。</p>
          </TabsContent>
        </Tabs>
        {linkError && <p role="alert" className="text-xs text-destructive">{linkError}</p>}
      </DialogContent>
    </Dialog>}
    </>
  );
}
