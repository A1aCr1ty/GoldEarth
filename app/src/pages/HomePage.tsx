import { useEffect, useMemo, useState } from "react";
import { CalendarCard } from "@/components/dashboard/CalendarCard";
import { QuickLinks } from "@/components/dashboard/QuickLinks";
import { TextPush } from "@/components/dashboard/TextPush";
import { WeatherCard } from "@/components/dashboard/WeatherCard";
import { DailyTravelCard } from "@/components/dashboard/DailyTravelCard";
import { clockText, isoWeek, weekdayLabel, ymd } from "@/lib/datetime";
import { useWeather } from "@/store/weather";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

function greeting(hour: number): string {
  if (hour < 5) return "夜深了";
  if (hour < 9) return "早上好";
  if (hour < 12) return "上午好";
  if (hour < 14) return "中午好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

export default function HomePage() {
  const [now, setNow] = useState(() => new Date());
  // 天气和日历共用一个选中日期：点日历看那天的天气，点预报格子日历跟着跳
  const [selected, setSelected] = useState(() => ymd(new Date()));
  const [linksOpen, setLinksOpen] = useState(false);
  const { report } = useWeather();

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // 本地时区下的今天，跨零点后选中项还能对上
  const today = useMemo(() => ymd(now), [now]);

  // 推送跟着选中的日期走：点了日历上的雨雪天，文字也会换成写雨写雪的
  const selectedDay = report?.days.find((day) => day.date === selected) ?? null;
  const pushCode = selectedDay ? selectedDay.code : report?.now.code ?? null;
  const pushIsDay = selectedDay ? true : report?.now.isDay ?? true;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-4">
        <div>
          <h1 className="text-base font-semibold">天气</h1>
          <p className="text-[0.6875rem] text-muted-foreground">
            {`${greeting(now.getHours())} · ${today} ${weekdayLabel(now)} · 第 ${isoWeek(now)} 周`}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Button size="sm" variant="ghost" className="text-xs" onClick={() => setLinksOpen(true)}>快捷入口</Button>
          <div className="text-right">
          <p className="text-2xl font-semibold leading-none tabular-nums">{clockText(now)}</p>
          <p className="text-[0.6875rem] text-muted-foreground">本地时间</p>
          </div>
        </div>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] gap-3 p-3">
          <div className="flex min-h-0 min-w-0 flex-col gap-2 overflow-y-auto overscroll-contain">
            <div className="shrink-0"><WeatherCard compact selectedDate={selected} onSelectDate={setSelected} /></div>
            <div className="shrink-0"><CalendarCard compact selected={selected} onSelect={setSelected} forecast={report?.days ?? []} /></div>
            <TextPush compact
              date={selected}
              hour={now.getHours()}
              code={pushCode}
              isDay={pushIsDay}
              isToday={selected === today}
            />
          </div>
          <DailyTravelCard compact date={today} />
      </div>
      <Dialog open={linksOpen} onOpenChange={setLinksOpen}>
        <DialogContent><DialogHeader><DialogTitle>快捷入口</DialogTitle></DialogHeader><QuickLinks /></DialogContent>
      </Dialog>
    </div>
  );
}
