import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Sunrise, Sunset, Umbrella } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  WEEKDAY_NAMES,
  dayOfYear,
  isSameDay,
  isoWeek,
  monthGrid,
  monthLabel,
  parseYmd,
  relativeToToday,
  weekdayLabel,
  ymd,
} from "@/lib/datetime";
import { cn } from "@/lib/utils";
import { weatherIcon, weatherText } from "@/lib/weatherCodes";
import type { WeatherDay } from "@/types";

interface CalendarCardProps {
  compact?: boolean;
  /** 当前选中的日期（YYYY-MM-DD），和天气卡片共用同一个值 */
  selected: string;
  onSelect: (date: string) => void;
  /** 天气预报表；有就能在日历格子里标出天气 */
  forecast: WeatherDay[];
}

export function CalendarCard({ selected, onSelect, forecast, compact = false }: CalendarCardProps) {
  const today = useMemo(() => new Date(), []);
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));

  const cells = useMemo(() => monthGrid(cursor), [cursor]);
  // 预报只有 7 天，按日期索引方便格子里直接取
  const forecastByDate = useMemo(() => {
    const map = new Map<string, WeatherDay>();
    for (const day of forecast) map.set(day.date, day);
    return map;
  }, [forecast]);

  const selectedDate = useMemo(() => parseYmd(selected), [selected]);
  const selectedWeather = forecastByDate.get(selected) ?? null;

  function shiftMonth(delta: number) {
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1));
  }

  function backToToday() {
    setCursor(new Date(today.getFullYear(), today.getMonth(), 1));
    onSelect(ymd(today));
  }

  return (
    <Card className="min-w-0">
      <CardHeader className={cn("flex-row items-center justify-between space-y-0", compact ? "p-2.5 pb-1" : "p-4 pb-2")}>
        <CardTitle className="text-sm">{monthLabel(cursor)}</CardTitle>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="上个月" onClick={() => shiftMonth(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={backToToday}>
            今天
          </Button>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="下个月" onClick={() => shiftMonth(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className={compact ? "p-2.5 pt-0" : "p-4 pt-0"}>
        <div className={cn("grid grid-cols-7 text-center", compact ? "gap-y-0" : "gap-y-1")}>
          {WEEKDAY_NAMES.map((name, index) => (
            <span
              key={name}
              className={cn("pb-1 text-[0.6875rem]", index >= 5 ? "text-muted-foreground/70" : "text-muted-foreground")}
            >
              {name}
            </span>
          ))}
          {cells.map((date) => {
            const value = ymd(date);
            const inMonth = date.getMonth() === cursor.getMonth();
            const isToday = isSameDay(date, today);
            const isSelected = value === selected;
            const day = forecastByDate.get(value);
            const Icon = day ? weatherIcon(day.code) : null;
            return (
              <button
                key={value}
                type="button"
                onClick={() => onSelect(value)}
                title={day ? `${value} ${weatherText(day.code)}` : value}
                className={cn(
                  "mx-auto flex min-w-0 w-full flex-col items-center justify-center rounded-md text-xs transition-colors",
                  compact ? "h-6" : "h-11",
                  inMonth ? "text-foreground" : "text-muted-foreground/50",
                  isToday && !isSelected && "font-semibold text-primary ring-1 ring-primary/40",
                  isSelected ? "bg-primary font-semibold text-primary-foreground" : "hover:bg-accent"
                )}
              >
                <span className="leading-none tabular-nums">{date.getDate()}</span>
                {/* 占位符让有/没有天气的格子高度一致 */}
                {Icon ? (
                  <Icon className={cn(compact ? "mt-px h-2.5 w-2.5" : "mt-0.5 h-3 w-3", isSelected ? "text-primary-foreground" : "text-primary/70")} />
                ) : (
                  <span className={compact ? "mt-px h-2.5 w-2.5" : "mt-0.5 h-3 w-3"} />
                )}
              </button>
            );
          })}
        </div>

        {compact ? <p className="mt-1 border-t pt-1 text-[0.625rem] text-muted-foreground">{selected} · {weekdayLabel(selectedDate)}</p> : <div className="mt-3 space-y-1 border-t pt-3 text-xs">
          <p className="flex items-center gap-1.5 font-medium">
            <CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            {`${selected} ${weekdayLabel(selectedDate)}`}
          </p>
          {!compact && <p className="text-muted-foreground">
            {`${relativeToToday(selectedDate, today)} · 第 ${isoWeek(selectedDate)} 周 · 全年第 ${dayOfYear(selectedDate)} 天`}
          </p>}
          {selectedWeather ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
              <span className="text-foreground">
                {`${weatherText(selectedWeather.code)} ${Math.round(selectedWeather.min)}° ~ ${Math.round(selectedWeather.max)}°`}
              </span>
              <span className="inline-flex items-center gap-1">
                <Umbrella className="h-3 w-3" />
                {`${Math.round(selectedWeather.precipitationProbability)}%`}
              </span>
              {!compact && <span className="inline-flex items-center gap-1">
                <Sunrise className="h-3 w-3" />
                {selectedWeather.sunrise || "--"}
              </span>}
              {!compact && <span className="inline-flex items-center gap-1">
                <Sunset className="h-3 w-3" />
                {selectedWeather.sunset || "--"}
              </span>}
            </div>
          ) : (
            <p className="text-muted-foreground/70">这一天不在 7 天预报范围内</p>
          )}
        </div>}
      </CardContent>
    </Card>
  );
}
