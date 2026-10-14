import { useEffect, useState } from "react";
import {
  Cloud,
  Droplets,
  MapPin,
  Pencil,
  RefreshCw,
  RotateCcw,
  Search,
  Sunrise,
  Sunset,
  Umbrella,
  Wind,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { errText } from "@/lib/errors";
import { parseYmd, timeOf, WEEKDAY_NAMES, ymd } from "@/lib/datetime";
import { tauri } from "@/lib/tauri";
import { weatherIcon, weatherText } from "@/lib/weatherCodes";
import { useWeather } from "@/store/weather";
import type { CityOption, WeatherDay } from "@/types";

interface WeatherCardProps {
  /** 当前选中的日期（YYYY-MM-DD），和日历共用同一个值 */
  selectedDate: string;
  onSelectDate: (date: string) => void;
}

/** 温度、湿度这些都取整显示，省得每个模板再写一遍 */
function round(value: number): string {
  return `${Math.round(value)}`;
}

/** 北京 · 北京市；国外城市再补上国家名 */
function cityLabel(city: CityOption): string {
  const parts = [city.name];
  if (city.admin1 && city.admin1 !== city.name) parts.push(city.admin1);
  if (city.country && city.country !== "中国") parts.push(city.country);
  return parts.join(" · ");
}

/** 10-16 周五 */
function dayLabel(date: string): string {
  const parsed = parseYmd(date);
  const [, month, day] = date.split("-");
  return `${`${month}-${day}`} 周${WEEKDAY_NAMES[(parsed.getDay() + 6) % 7]}`;
}

export function WeatherCard({ selectedDate, onSelectDate }: WeatherCardProps) {
  const { report, loading, error, load, setCity } = useWeather();
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const today = ymd(new Date());
  // 选中日期落在 7 天预报里，就把这一天的天气顶上来和日历对齐
  const selectedDay = report?.days.find((day) => day.date === selectedDate) ?? null;
  const showingOtherDay = selectedDay !== null && selectedDay.date !== today;
  const heroIcon = showingOtherDay
    ? weatherIcon(selectedDay.code)
    : weatherIcon(report?.now.code ?? 0, report?.now.isDay ?? true);
  const HeroIcon: LucideIcon = report ? heroIcon : Cloud;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-1.5 text-sm">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate font-medium">{report ? cityLabel(report.city) : "天气"}</span>
            {report && (
              <span className="shrink-0 text-xs text-muted-foreground">更新于 {timeOf(report.updatedAt)}</span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              title="切换城市"
              onClick={() => setEditing((v) => !v)}
            >
              {editing ? <X className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              title="刷新"
              disabled={loading}
              onClick={() => void load()}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            </Button>
          </div>
        </div>

        {editing && (
          <CityEditor
            onPick={(city) => {
              void setCity(city);
              setEditing(false);
            }}
          />
        )}

        {error && (
          <div className="mt-4 rounded-md border border-dashed p-3 text-xs">
            <p className="text-destructive">{error}</p>
            {!report && <p className="mt-1 text-muted-foreground">天气要联网取，检查网络后再试一次。</p>}
            <Button variant="outline" size="sm" className="mt-2 h-7" onClick={() => void load()}>
              重试
            </Button>
          </div>
        )}

        {!report && !error && <p className="mt-4 text-xs text-muted-foreground">正在获取天气…</p>}

        {report && (
          <>
            <div className="mt-4 flex items-center gap-5">
              <HeroIcon className="h-14 w-14 shrink-0 text-primary" strokeWidth={1.5} />
              {showingOtherDay ? (
                <div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-4xl font-semibold tabular-nums">{round(selectedDay.min)}</span>
                    <span className="text-3xl text-muted-foreground tabular-nums">{round(selectedDay.max)}</span>
                    <span className="text-sm text-muted-foreground">°C</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {weatherText(selectedDay.code)} · 降水 {round(selectedDay.precipitationProbability)}%
                  </p>
                  <div className="mt-1 flex items-center gap-2 text-[0.6875rem] text-muted-foreground">
                    <span>{dayLabel(selectedDay.date)}</span>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                      onClick={() => onSelectDate(today)}
                    >
                      <RotateCcw className="h-3 w-3" />
                      回到今天
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-semibold tabular-nums">{round(report.now.temperature)}</span>
                    <span className="text-lg text-muted-foreground">°C</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {weatherText(report.now.code)} · 体感 {round(report.now.apparent)}°
                  </p>
                </div>
              )}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-muted-foreground sm:grid-cols-3">
              {showingOtherDay ? (
                <>
                  <Meta icon={Sunrise} label="日出" value={selectedDay.sunrise || "--"} />
                  <Meta icon={Sunset} label="日落" value={selectedDay.sunset || "--"} />
                  <Meta icon={Umbrella} label="降水概率" value={`${round(selectedDay.precipitationProbability)}%`} />
                  <Meta
                    icon={Droplets}
                    label="现在"
                    value={`${round(report.now.temperature)}° · 湿度 ${round(report.now.humidity)}%`}
                  />
                  <Meta icon={Wind} label="风速" value={`${round(report.now.windSpeed)} km/h`} />
                  <Meta icon={Cloud} label="时区" value={report.timezone || "--"} />
                </>
              ) : (
                <>
                  <Meta icon={Droplets} label="湿度" value={`${round(report.now.humidity)}%`} />
                  <Meta icon={Wind} label="风速" value={`${round(report.now.windSpeed)} km/h`} />
                  <Meta icon={Umbrella} label="降水" value={`${report.now.precipitation.toFixed(1)} mm`} />
                  <Meta icon={Sunrise} label="日出" value={report.days[0]?.sunrise || "--"} />
                  <Meta icon={Sunset} label="日落" value={report.days[0]?.sunset || "--"} />
                  <Meta icon={Cloud} label="时区" value={report.timezone || "--"} />
                </>
              )}
            </div>

            <div className="mt-4 grid grid-cols-7 gap-1 border-t pt-3">
              {report.days.map((day, index) => (
                <ForecastCell
                  key={day.date}
                  day={day}
                  index={index}
                  selected={day.date === selectedDate}
                  onSelect={onSelectDate}
                />
              ))}
            </div>
            <p className="mt-2 text-[0.6875rem] text-muted-foreground">点一天，日历会同步跳到这一天</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Meta({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="shrink-0">{label}</span>
      <span className="truncate tabular-nums text-foreground">{value}</span>
    </span>
  );
}

function ForecastCell({
  day,
  index,
  selected,
  onSelect,
}: {
  day: WeatherDay;
  index: number;
  selected: boolean;
  onSelect: (date: string) => void;
}) {
  const Icon = weatherIcon(day.code);
  const date = parseYmd(day.date);
  const label = index === 0 ? "今天" : `周${WEEKDAY_NAMES[(date.getDay() + 6) % 7]}`;
  return (
    <button
      type="button"
      onClick={() => onSelect(day.date)}
      title={`${day.date} ${weatherText(day.code)} ${round(day.min)}°~${round(day.max)}°`}
      className={cn(
        "flex flex-col items-center gap-0.5 rounded-md px-1 py-2 text-center transition-colors",
        selected ? "bg-primary/10 ring-1 ring-primary/40" : "hover:bg-accent"
      )}
    >
      <span className={cn("text-[0.6875rem]", selected ? "font-medium text-foreground" : "text-muted-foreground")}>
        {label}
      </span>
      <Icon className="my-0.5 h-4 w-4" />
      <span className="text-xs tabular-nums">{round(day.max)}°</span>
      <span className="text-[0.6875rem] text-muted-foreground tabular-nums">{round(day.min)}°</span>
      <span className="text-[0.625rem] text-muted-foreground">
        {day.precipitationProbability > 0 ? `${round(day.precipitationProbability)}%` : "—"}
      </span>
    </button>
  );
}

/** 城市检索：输入名字 → 列出候选 → 选中即保存 */
function CityEditor({ onPick }: { onPick: (city: CityOption) => void }) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<CityOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function search() {
    const keyword = query.trim();
    if (!keyword) return;
    setBusy(true);
    setError(null);
    try {
      setOptions(await tauri.searchCities(keyword));
    } catch (e) {
      setOptions([]);
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-md border bg-muted/40 p-2">
      <div className="flex items-center gap-2">
        <Input
          className="h-8"
          value={query}
          placeholder="输入城市名，例如 上海 / Tokyo"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void search();
          }}
        />
        <Button size="sm" className="h-8 px-3" disabled={busy} onClick={() => void search()}>
          <Search className="h-3.5 w-3.5" />
        </Button>
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      {options.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {options.map((city) => (
            <button
              key={`${city.latitude},${city.longitude}`}
              type="button"
              className="rounded-md border bg-background px-2 py-1 text-xs hover:bg-accent"
              onClick={() => onPick(city)}
            >
              {cityLabel(city)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}