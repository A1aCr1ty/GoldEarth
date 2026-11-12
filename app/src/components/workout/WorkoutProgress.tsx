import { useMemo, useState } from "react";
import { Activity, Download, Target, TrendingUp, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { bestLifts, muscleTraining, trainingCalendar, gymToCsv, volume, type GymData } from "@/lib/workouts";

function downloadFile(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function WorkoutProgress({ data, onTargetWeightChange }: { data: GymData; onTargetWeightChange: (kg: number | null) => boolean }) {
  const [target, setTarget] = useState(data.targetWeight?.toString() ?? "");
  const [message, setMessage] = useState("");
  const lifts = useMemo(() => bestLifts(data.history), [data.history]);
  const muscles = useMemo(() => muscleTraining(data.history), [data.history]);
  const calendar = useMemo(() => trainingCalendar(data.history), [data.history]);
  const weights = useMemo(() => [...data.weights].sort((a, b) => a.date.localeCompare(b.date)).slice(-14), [data.weights]);
  const totalVolume = data.history.reduce((sum, workout) => sum + volume(workout.sets), 0);
  const activeDays = calendar.filter(day => day.sets > 0).length;
  const panel = "rounded-xl border bg-card p-5";

  function saveTarget() {
    const kg = Number(target);
    if (!Number.isFinite(kg) || kg < 20 || kg > 500) { setMessage("目标体重需在 20～500 kg 之间。"); return; }
    if (onTargetWeightChange(kg)) setMessage("目标体重已保存。");
  }
  function exportData(kind: "json" | "csv") {
    const date = new Date().toLocaleDateString("sv-SE");
    if (kind === "json") downloadFile(`goldearth-gym-${date}.json`, JSON.stringify(data, null, 2), "application/json;charset=utf-8");
    else downloadFile(`goldearth-gym-${date}.csv`, `\ufeff${gymToCsv(data)}`, "text/csv;charset=utf-8");
    setMessage(`已导出 ${kind.toUpperCase()} 文件。`);
  }

  const chartWidth = 640;
  const chartHeight = 190;
  const padding = 28;
  const chartValues = [...weights.map(w => w.kg), ...(data.targetWeight ? [data.targetWeight] : [])];
  const minWeight = chartValues.length ? Math.floor(Math.min(...chartValues) - 1) : 0;
  const maxWeight = chartValues.length ? Math.ceil(Math.max(...chartValues) + 1) : 1;
  const y = (kg: number) => padding + (maxWeight - kg) / Math.max(1, maxWeight - minWeight) * (chartHeight - padding * 2);
  const points = weights.map((w, index) => ({
    ...w,
    x: weights.length === 1 ? chartWidth / 2 : padding + index / (weights.length - 1) * (chartWidth - padding * 2),
    y: y(w.kg),
  }));
  const maxMuscleSets = Math.max(1, ...muscles.map(m => m.sets));

  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-xl font-semibold">训练进展</h2><p className="mt-1 text-sm text-muted-foreground">从已完成组计算趋势、纪录和肌群训练量。</p></div>
      <div className="flex gap-2"><Button variant="outline" onClick={() => exportData("json")}><Download className="mr-2 h-4 w-4" />导出 JSON</Button><Button variant="outline" onClick={() => exportData("csv")}><Download className="mr-2 h-4 w-4" />导出 CSV</Button></div>
    </div>
    {message && <p role="status" className="rounded-lg border p-3 text-sm">{message}</p>}
    <div className="grid gap-3 sm:grid-cols-3">
      <div className={panel}><Activity className="mb-3 h-5 w-5 text-primary" /><p className="text-xs text-muted-foreground">近一年活跃天数</p><p className="mt-1 text-xl font-semibold">{activeDays} 天</p></div>
      <div className={panel}><TrendingUp className="mb-3 h-5 w-5 text-primary" /><p className="text-xs text-muted-foreground">累计外部负重</p><p className="mt-1 text-xl font-semibold">{totalVolume.toFixed(0)} kg</p></div>
      <div className={panel}><Trophy className="mb-3 h-5 w-5 text-primary" /><p className="text-xs text-muted-foreground">已追踪负重动作</p><p className="mt-1 text-xl font-semibold">{lifts.length} 个</p></div>
    </div>

    <section className={panel}>
      <div className="flex flex-wrap items-start justify-between gap-4"><div><h3 className="font-semibold">体重趋势</h3><p className="mt-1 text-xs text-muted-foreground">最近 14 次记录{data.targetWeight ? ` · 目标 ${data.targetWeight} kg` : ""}</p></div><Target className="h-5 w-5 text-primary" /></div>
      <form className="my-4 flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); saveTarget(); }}>
        <label className="w-40 text-xs">目标体重（kg）<Input aria-label="目标体重" className="mt-1" type="number" min="20" max="500" step="0.1" required placeholder="例如 70" value={target} onChange={event => setTarget(event.target.value)} /></label>
        <Button size="sm" type="submit">保存目标</Button>
        {data.targetWeight != null && <Button size="sm" type="button" variant="ghost" onClick={() => { if (onTargetWeightChange(null)) { setTarget(""); setMessage("已清除目标体重。"); } }}>清除目标</Button>}
      </form>
      {points.length ? <div className="overflow-x-auto"><svg role="img" aria-label="体重趋势图" viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="min-w-[560px]">
        {[minWeight, (minWeight + maxWeight) / 2, maxWeight].map(value => <g key={value}><line x1={padding} x2={chartWidth - padding} y1={y(value)} y2={y(value)} className="stroke-border" strokeDasharray="3 5" /><text x={padding} y={y(value) - 5} className="fill-muted-foreground text-[10px]">{value.toFixed(1)} kg</text></g>)}
        {data.targetWeight != null && <g><line x1={padding} x2={chartWidth - padding} y1={y(data.targetWeight)} y2={y(data.targetWeight)} className="stroke-primary" strokeDasharray="7 5" /><text x={chartWidth - padding} y={y(data.targetWeight) - 6} textAnchor="end" className="fill-primary text-[10px]">目标 {data.targetWeight} kg</text></g>}
        <polyline points={points.map(point => `${point.x},${point.y}`).join(" ")} fill="none" className="stroke-primary" strokeWidth="2.5" />
        {points.map(point => <g key={point.date}><circle cx={point.x} cy={point.y} r="4" className="fill-primary"><title>{point.date} · {point.kg} kg</title></circle><text x={point.x} y={chartHeight - 7} textAnchor="middle" className="fill-muted-foreground text-[9px]">{point.date.slice(5)}</text></g>)}
      </svg></div> : <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">记录体重后，这里会显示趋势与目标线。</p>}
    </section>

    <div className="grid items-start gap-5 lg:grid-cols-2">
      <section className={panel}><h3 className="font-semibold">最佳估算 1RM</h3><p className="mt-1 text-xs text-muted-foreground">使用 Epley 公式估算，仅用于相同动作的趋势比较。</p><div className="mt-4 space-y-3">{lifts.slice(0, 6).map(lift => <div key={lift.exercise.id} className="flex items-center justify-between gap-3 border-b pb-3 last:border-0 last:pb-0"><div><p className="text-sm font-medium">{lift.exercise.name}</p><p className="mt-1 text-xs text-muted-foreground">{lift.load} kg × {lift.reps} 次 · {new Date(lift.date).toLocaleDateString()}</p></div><p className="font-semibold text-primary">{lift.oneRepMax.toFixed(1)} kg</p></div>)}{!lifts.length && <p className="py-6 text-center text-sm text-muted-foreground">完成负重训练后，将在这里显示估算结果。</p>}</div></section>
      <section className={panel}><h3 className="font-semibold">近 30 天肌群训练量</h3><p className="mt-1 text-xs text-muted-foreground">按完成组数统计，同时显示外部负重容量。</p><div className="mt-4 space-y-3">{muscles.map(muscle => <div key={muscle.muscle}><div className="mb-1 flex justify-between gap-3 text-xs"><span>{muscle.muscle}</span><span className="text-muted-foreground">{muscle.sets} 组 · {muscle.volume.toFixed(0)} kg</span></div><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${muscle.sets / maxMuscleSets * 100}%` }} /></div></div>)}{!muscles.length && <p className="py-6 text-center text-sm text-muted-foreground">近 30 天暂无已完成的训练组。</p>}</div></section>
    </div>

    <section className={panel}><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-semibold">年度训练热力图</h3><p className="mt-1 text-xs text-muted-foreground">颜色越深，当天完成组数越多。</p></div><div className="flex items-center gap-1 text-xs text-muted-foreground">少{[0, 1, 2, 3].map(level => <span key={level} className={`h-3 w-3 rounded-sm ${["bg-muted", "bg-primary/30", "bg-primary/60", "bg-primary"][level]}`} />)}多</div></div><div className="mt-5 overflow-x-auto pb-2"><div className="grid w-max grid-flow-col grid-rows-7 gap-1">{calendar.map(day => <span key={day.date} title={`${day.date} · ${day.sets} 组`} aria-label={`${day.date}，完成 ${day.sets} 组`} className={`h-3 w-3 rounded-sm ${["bg-muted", "bg-primary/30", "bg-primary/60", "bg-primary"][day.level]}`} />)}</div></div></section>
  </div>;
}
