import { useEffect, useMemo, useState } from "react";
import { CalendarCard } from "@/components/dashboard/CalendarCard";
import { QuickLinks } from "@/components/dashboard/QuickLinks";
import { TextPush } from "@/components/dashboard/TextPush";
import { WeatherCard } from "@/components/dashboard/WeatherCard";
import { clockText, isoWeek, weekdayLabel, ymd } from "@/lib/datetime";
import { useWeather } from "@/store/weather";

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
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-6">
        <div>
          <h1 className="text-base font-semibold">天气</h1>
          <p className="text-[0.6875rem] text-muted-foreground">
            {`${greeting(now.getHours())} · ${today} ${weekdayLabel(now)} · 第 ${isoWeek(now)} 周`}
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-semibold leading-none tabular-nums">{clockText(now)}</p>
          <p className="text-[0.6875rem] text-muted-foreground">本地时间</p>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid gap-4 lg:grid-cols-3">
          {/* 左栏撑满右栏的高度，剩下的空白交给文字推送占着 */}
          <div className="flex flex-col gap-4 lg:col-span-2">
            <WeatherCard selectedDate={selected} onSelectDate={setSelected} />
            <TextPush
              date={selected}
              hour={now.getHours()}
              code={pushCode}
              isDay={pushIsDay}
              isToday={selected === today}
            />
          </div>
          <div className="space-y-4">
            <CalendarCard selected={selected} onSelect={setSelected} forecast={report?.days ?? []} />
            <QuickLinks />
          </div>
        </div>
      </div>
    </div>
  );
}