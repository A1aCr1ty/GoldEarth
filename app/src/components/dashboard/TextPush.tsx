import { useEffect, useMemo, useState } from "react";
import { Shuffle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { lineContext, pickPushLine } from "@/lib/lines";
import { tauri } from "@/lib/tauri";
import type { Horoscope } from "@/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface TextPushProps {
  compact?: boolean;
  /** 选中的日期（和天气、日历共用同一个值），点日历上的雨雪天这里也会跟着换 */
  date: string;
  /** 当前小时：用来区分早晚 */
  hour: number;
  /** 选中日期的天气代码；拿不到就传 null */
  code: number | null;
  isDay: boolean;
  isToday: boolean;
}

/** 十二星座的接口 key，顺序和后端 Zodiac::ALL 一致 */
const SIGN_KEYS = [
  "aries",
  "taurus",
  "gemini",
  "cancer",
  "leo",
  "virgo",
  "libra",
  "scorpio",
  "sagittarius",
  "capricorn",
  "aquarius",
  "pisces",
] as const;

/** 一年里的第几天，用来在没填生日时决定先亮出哪个星座 */
function dayOfYear(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return 0;
  const days = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return days[m - 1] + d + (leap && m > 2 ? 1 : 0);
}

/** 星级：上游只保证 1–5，越界就不画，免得界面上冒出 9 颗星 */
function Stars({ value }: { value: number }) {
  if (value < 1) return null;
  const filled = Math.min(value, 5);
  return (
    <span aria-label={`${value} 星`} className="text-[0.6875rem] tracking-tight text-primary">
      {"★".repeat(filled)}
      <span className="text-muted-foreground/40">{"★".repeat(5 - filled)}</span>
    </span>
  );
}

/**
 * 天气页空白处的推送：上面一句短句（古典诗词或近现代名句），下面是当日星座运势。
 *
 * 选句跟着季节、天气和早晚走——点日历上的雨天，推送也会换成写雨的那几句。
 * 同一天同一时段看到的是同一句（seed 固定），点「换一句」才往下走一步，
 * 所以刷新页面、切走再回来都不会乱跳。
 *
 * 「换一句」同时推进两块内容：诗句换成下一句，运势也走到下一个维度——
 * 填了生日就轮整体/爱情/事业/财运/健康，没填就轮十二星座。
 */
export function TextPush({ date, hour, code, isDay, isToday, compact = false }: TextPushProps) {
  const context = useMemo(
    () => lineContext({ date, hour, code, isDay, isToday }),
    [date, hour, code, isDay, isToday]
  );
  const [step, setStep] = useState(0);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [hasBirthday, setHasBirthday] = useState(true);
  const [data, setData] = useState<Horoscope | null>(null);
  const [loading, setLoading] = useState(false);
  const [horoError, setHoroError] = useState<string | null>(null);

  // 换了日期、时段或天气样貌，就从头开始推
  useEffect(() => {
    setStep(0);
  }, [context.seed, context.keys.join(",")]);

  useEffect(() => {
    tauri
      .getSettings()
      .then((s) => setHasBirthday(Boolean(s.birthDate)))
      .catch(() => setHasBirthday(false));
  }, []);

  // 没填生日时自己轮星座：按日期定起点，所以同一天进来看到的第一个是固定的
  const rotateSign = !hasBirthday;
  const signKey = useMemo(
    () => SIGN_KEYS[(dayOfYear(date) + step) % SIGN_KEYS.length],
    [date, step]
  );

  // 运势只有当日这一份，所以不是今天就不去请求
  useEffect(() => {
    if (!isToday) return;
    let alive = true;
    setLoading(true);
    setHoroError(null);
    tauri
      .horoscopeToday(rotateSign ? signKey : undefined)
      .then((d) => {
        if (alive) setData(d);
      })
      .catch((e) => {
        if (alive) {
          setData(null);
          setHoroError(String(e));
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [isToday, rotateSign, signKey]);

  const line = useMemo(() => pickPushLine(context, step), [context, step]);
  // 填了生日：step 轮维度；没填：step 已经在轮星座了，维度固定停在整体
  const aspect = data?.aspects[rotateSign ? 0 : step % data.aspects.length];

  if (compact) return (
    <>
      <Card className="relative shrink-0 overflow-hidden bg-gradient-to-br from-primary/5 to-background">
        <CardContent className="space-y-1.5 p-2">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground"><Sparkles className="h-3 w-3" />{isToday ? "今日推送" : "这天推送"}<span className="text-primary">{context.label}</span></span>
            <div className="flex shrink-0 gap-1">
              <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[0.6875rem]" onClick={() => setStep(value => value + 1)}><Shuffle className="h-3 w-3" />换一句</Button>
              <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[0.6875rem]" onClick={() => setDetailsOpen(true)}>详情</Button>
            </div>
          </div>
          <blockquote aria-live="polite" className="border-l-2 border-primary/40 pl-2">
            <p title={line.text} className="font-quote line-clamp-2 text-sm leading-relaxed">{line.text}</p>
            <footer className="truncate text-right text-[0.625rem] leading-4 text-muted-foreground" title={line.from}>—— {line.from}</footer>
          </blockquote>
          <div aria-live="polite" className="border-t pt-1.5">
            {isToday && data && aspect && !horoError ? <>
              <div className="flex flex-wrap items-center gap-x-2 text-[0.6875rem]"><span className="font-medium text-primary">{data.title}</span><span className="text-muted-foreground">{aspect.label}</span><Stars value={aspect.stars} /></div>
              <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{aspect.text || "今天这一项暂时没有内容"}</p>
            </> : <p className="line-clamp-2 text-[0.6875rem] text-muted-foreground">{!isToday ? "运势只提供当日这一份，切回今天即可查看。" : horoError ? `取运势失败：${horoError}` : loading ? "正在取运势…" : "暂时拿不到运势。"}</p>}
          </div>
        </CardContent>
      </Card>
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto"><DialogHeader><DialogTitle className="text-base">{date} · 文字推送</DialogTitle></DialogHeader>
          <blockquote className="border-l-2 border-primary/40 pl-3"><p className="font-quote text-lg leading-relaxed">{line.text}</p><footer className="mt-2 text-right text-xs text-muted-foreground">—— {line.from}</footer></blockquote>
          {isToday && data && aspect && <div className="space-y-2 border-t pt-3 text-sm leading-relaxed">
            <p className="flex flex-wrap items-center gap-2 font-medium text-primary">{data.title} · {aspect.label}<Stars value={aspect.stars} /></p>
            {data.shortComment && <p className="text-xs text-muted-foreground">{data.shortComment}</p>}
            <p>{aspect.text}</p>
            <p className="text-xs text-muted-foreground">{[data.todoYi, data.todoJi, data.luckyColor && `幸运色 ${data.luckyColor}`, data.luckyNumber && `幸运数 ${data.luckyNumber}`, data.luckyConstellation && `贵人星座 ${data.luckyConstellation}`].filter(Boolean).join(" · ")}</p>
          </div>}
        </DialogContent>
      </Dialog>
    </>
  );

  return (
    <Card className="relative flex min-h-[10rem] flex-1 flex-col overflow-hidden">
      {/* 主题色淡淡的斜向渐变；选什么主色这里就跟着染什么色 */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/10" />
      <CardContent className="relative flex h-full flex-col justify-center gap-4 p-5">
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5" />
            {isToday ? "今日推送" : "这天推送"}
            {context.label && (
              <span className="rounded-full border border-primary/30 px-1.5 py-px text-primary">
                {context.label}
              </span>
            )}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            title={rotateSign ? "换一句，换一个星座" : "换一句，换一个维度"}
            onClick={() => setStep((value) => value + 1)}
          >
            <Shuffle className="h-3.5 w-3.5" />
            换一句
          </Button>
        </div>

        {/* key 换掉就重放一次淡入，让「换一句」有个轻轻的过渡 */}
        <blockquote
          key={line.text}
          aria-live="polite"
          className="animate-fade-up border-l-2 border-primary/40 pl-4"
        >
          <p className="font-quote text-lg leading-loose tracking-wide sm:text-xl">{line.text}</p>
          <footer className="mt-1.5 text-right text-xs text-muted-foreground">—— {line.from}</footer>
        </blockquote>

        <div className="h-px w-full bg-border/60" />

        <div aria-live="polite" className="space-y-2">
          {!isToday ? (
            <p className="text-[0.6875rem] text-muted-foreground">
              运势只提供当日这一份，切回今天就能看到。
            </p>
          ) : loading && !data ? (
            <p className="text-[0.6875rem] text-muted-foreground">正在取运势…</p>
          ) : horoError ? (
            <p className="text-[0.6875rem] text-destructive">取运势失败：{horoError}</p>
          ) : data && aspect ? (
            <>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-sm font-medium text-primary">{data.title}</span>
                <span className="text-[0.6875rem] text-muted-foreground">
                  {data.period}
                  {aspect.label === "整体" ? "" : ` · ${aspect.label}`}
                </span>
                <Stars value={aspect.stars} />
                {aspect.index && (
                  <span className="text-[0.6875rem] text-muted-foreground">{aspect.index}</span>
                )}
              </div>
              {aspect.label === "整体" && data.shortComment && (
                <p className="text-[0.6875rem] text-muted-foreground">「{data.shortComment}」</p>
              )}
              <p className="text-sm leading-relaxed text-foreground/90">
                {aspect.text || "（今天这一项暂时没有内容）"}
              </p>
              {(data.todoYi || data.todoJi || data.luckyColor || data.luckyNumber || data.luckyConstellation) && (
                <p className="flex flex-wrap gap-x-3 gap-y-1 text-[0.6875rem] text-muted-foreground">
                  {data.todoYi && <span>{data.todoYi}</span>}
                  {data.todoJi && <span>{data.todoJi}</span>}
                  {data.luckyColor && <span>幸运色 {data.luckyColor}</span>}
                  {data.luckyNumber && <span>幸运数 {data.luckyNumber}</span>}
                  {data.luckyConstellation && <span>贵人星座 {data.luckyConstellation}</span>}
                </p>
              )}
            </>
          ) : (
            <p className="text-[0.6875rem] text-muted-foreground">暂时拿不到运势。</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
