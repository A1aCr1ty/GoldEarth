import { useEffect, useState } from "react";
import { Check, Dumbbell, Plus, Sparkles, Timer, Trash2 } from "lucide-react";
import { ExerciseGuide, ExercisePreview } from "@/components/workout/ExerciseGuide";
import { WorkoutProgress } from "@/components/workout/WorkoutProgress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLocalRecord } from "@/lib/useLocalRecord";
import { createWorkoutPlan, emptyGym, exercises, latestExerciseSets, makeSet, personalRecords, progressionSuggestion, routines, validSet, volume, type WorkoutRoutine, type WorkoutSet } from "@/lib/workouts";

export default function WorkoutPage() {
  const store = useLocalRecord("goldearth.gym.v1", emptyGym);
  const data = store.value;
  const [tab, setTab] = useState("训练");
  const [query, setQuery] = useState("");
  const [muscle, setMuscle] = useState("全部");
  const [gear, setGear] = useState("全部");
  const [now, setNow] = useState(Date.now());
  const [rest, setRest] = useState(60);
  const [weight, setWeight] = useState("");
  const [height, setHeight] = useState(data.profile?.heightCm.toString() ?? "");
  const [bodyWeight, setBodyWeight] = useState(data.profile?.weightKg.toString() ?? "");
  const [message, setMessage] = useState("");
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const active = data.active;
  const completed = active?.sets.filter(s => s.done).length || 0;
  const remaining = Math.max(0, Math.ceil((data.restUntil - now) / 1000));
  function start(name: string, ids: string[], routine?: WorkoutRoutine) {
    if (active) { setMessage("已有进行中的训练，请先完成或放弃。"); return; }
    const sets = ids.flatMap(id => {
      const previous = latestExerciseSets(id, data.history);
      return Array.from({ length: routine?.sets ?? 3 }, (_, index) => {
        const last = previous[index] ?? previous[previous.length - 1];
        return makeSet(id, last?.reps ?? routine?.reps?.[id], last?.load ?? 0);
      });
    });
    store.save({ ...data, active: { id: crypto.randomUUID(), name, started: Date.now(), sets }, restUntil: 0 });
    setTab("训练"); setMessage("");
  }
  function addSet(exerciseId: string) {
    if (!active) return;
    const current = active.sets.filter(s => s.exerciseId === exerciseId);
    const previous = latestExerciseSets(exerciseId, data.history);
    const template = current[current.length - 1] ?? previous[previous.length - 1];
    store.save({ ...data, active: { ...active, sets: [...active.sets, makeSet(exerciseId, template?.reps, template?.load)] } });
  }
  function generatePlan() {
    try {
      const generated = createWorkoutPlan(Number(height), Number(bodyWeight));
      const date = new Date().toLocaleDateString("sv-SE");
      if (store.save({ ...data, profile: generated.profile, plan: generated.plan, weights: [{ date, kg: generated.profile.weightKg }, ...data.weights.filter(w => w.date !== date)] })) {
        setMessage("锻炼计划已生成并同步到每周安排，今日体重也已记录。");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法生成计划，请检查身高和体重。");
    }
  }
  function changeSet(id: string, patch: Partial<WorkoutSet>) {
    if (!active) return;
    store.save({ ...data, active: { ...active, sets: active.sets.map(s => s.id === id ? { ...s, ...patch, pr: [] } : s) } });
  }
  function toggleSet(set: WorkoutSet) {
    if (!active) return;
    if (!validSet(set)) { setMessage("请填写有效的负重、正整数次数 / 秒数和 0～10 的 RIR。"); return; }
    const records = set.done ? [] : personalRecords(set, data.history);
    store.save({ ...data, active: { ...active, sets: active.sets.map(s => s.id === set.id ? { ...s, done: !s.done, pr: records } : s) }, restUntil: set.done ? data.restUntil : Date.now() + rest * 1000 });
    const name = exercises.find(e => e.id === set.exerciseId)?.name;
    setMessage(records.length ? `新纪录：${name} ${records.join("、")} PR！` : "");
  }
  function finish() {
    if (!active || !completed) { setMessage("至少完成一组再保存训练。"); return; }
    const workout = { ...active, ended: Date.now(), sets: active.sets.filter(s => s.done) };
    if (store.save({ ...data, active: null, history: [workout, ...data.history], restUntil: 0 })) { setMessage("训练已保存，未完成的组未计入记录。"); setTab("进展"); }
  }
  const panel = "rounded-xl border bg-card p-5";
  return <div className="h-full overflow-y-auto p-5 md:p-8">
    <header className="mb-6 flex flex-wrap items-center justify-between gap-4"><div><p className="text-xs tracking-widest text-primary">MOVE · LOG · REPEAT</p><h1 className="mt-1 text-2xl font-semibold">锻炼</h1><p className="mt-1 text-sm text-muted-foreground">安排训练，记录每一组，看见自己的积累。</p></div><Dumbbell className="h-10 w-10 text-primary" /></header>
    <div className="mb-5 grid grid-cols-3 gap-3">{[["累计训练", `${data.history.length} 次`], ["完成组数", `${data.history.reduce((n, h) => n + h.sets.length, 0)} 组`], ["最近体重", data.weights.length ? `${data.weights[0].kg} kg` : "未记录"]].map(([label, value]) => <div className={panel} key={label}><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 text-xl font-semibold">{value}</p></div>)}</div>
    <nav className="mb-5 flex flex-wrap gap-2">{["训练", "计划", "动作库", "进展", "记录"].map(t => <Button key={t} variant={tab === t ? "default" : "outline"} onClick={() => setTab(t)}>{t}</Button>)}</nav>
    {(store.error || message) && <p role="status" className="mb-4 rounded-lg border p-3 text-sm">{store.error || message}</p>}
    {tab === "训练" && (!active ? <><div className="mb-5 rounded-2xl bg-primary/10 p-6"><h2 className="text-xl font-semibold">今天想练什么？</h2><p className="mt-2 text-sm text-muted-foreground">选择一个模板开始，训练中可增删动作和组数。先热身，再使用适合自己的强度。</p><Button className="mt-4" variant="outline" onClick={() => start("自由训练", [])}><Plus className="mr-2 h-4 w-4" />自由训练</Button></div><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{routines.map(r => <div key={r.name} className={panel}><Dumbbell className="mb-4 text-primary" /><h3 className="font-semibold">{r.name}</h3><p className="my-3 text-sm text-muted-foreground">{r.description}</p><p className="mb-4 text-xs text-muted-foreground">{r.ids.length} 个动作 · 每动作 {r.sets ?? 3} 组，可调整</p><Button onClick={() => start(r.name, r.ids, r)}>开始训练</Button></div>)}</div></> : <div className="space-y-4">
      <div className={panel}><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">{active.name}</h2><p className="mt-1 text-sm text-muted-foreground">{Math.max(0, Math.floor((now - active.started) / 60000))} 分钟 · {completed}/{active.sets.length} 组 · 外部负重总量 {volume(active.sets).toFixed(0)} kg</p></div><Button onClick={finish}>完成训练</Button></div><progress aria-label="训练完成进度" className="mt-4 h-2 w-full accent-primary" max={Math.max(1, active.sets.length)} value={completed} /><div className="mt-4 flex flex-wrap items-center gap-3"><Timer className="h-4 w-4" /><span role="timer" className="font-mono">{remaining ? `休息 ${remaining} 秒` : data.restUntil ? "休息结束" : "组间休息"}</span><select aria-label="组间休息时间" className="rounded border bg-background p-1 text-sm" value={rest} onChange={e => setRest(Number(e.target.value))}>{[30,60,90,120,180].map(n => <option key={n} value={n}>{n} 秒</option>)}</select><Button size="sm" variant="outline" onClick={() => store.save({ ...data, restUntil: Date.now() + rest * 1000 })}>开始计时</Button><Button size="sm" variant="ghost" onClick={() => store.save({ ...data, restUntil: 0 })}>跳过</Button></div></div>
      {[...new Set(active.sets.map(s => s.exerciseId))].map(id => {
        const e = exercises.find(x => x.id === id)!;
        const previous = latestExerciseSets(id, data.history);
        return <div key={id} className={panel}>
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{e.name}</h3><p className="mt-1 text-xs text-primary">{e.muscle} · {e.equipment}</p></div><div className="flex gap-2"><ExerciseGuide exercise={e} /><Button size="sm" variant="outline" onClick={() => addSet(id)}>加一组</Button></div></div>
          <p className="my-3 text-sm text-muted-foreground">{e.cue}</p>
          <p className="mb-3 rounded-lg bg-primary/5 p-2 text-xs leading-5 text-muted-foreground">{previous.length > 0 && `上次：${previous.map(s => e.timed ? `${s.reps} 秒` : `${s.load} kg × ${s.reps} 次`).join(" / ")} · `}{progressionSuggestion(id, data.history)}</p>
          <div className="space-y-2">{active.sets.filter(s => s.exerciseId === id).map((s, index) => <div key={s.id} className={`flex flex-wrap items-center gap-2 rounded-lg p-2 ${s.done ? "bg-primary/10" : "bg-muted/50"}`}>
            <span className="w-10 text-xs">第 {index + 1} 组</span>
            {!e.timed && <label className="flex items-center gap-1 text-xs"><Input aria-label={`${e.name}第${index+1}组负重`} type="number" min="0" max="1000" step="0.5" disabled={s.done} className="h-8 w-20" value={s.load} onChange={ev => changeSet(s.id, { load: Number(ev.target.value) })} />kg</label>}
            <label className="flex items-center gap-1 text-xs"><Input aria-label={`${e.name}第${index+1}组${e.timed ? "秒数" : "次数"}`} type="number" min="1" max="86400" disabled={s.done} className="h-8 w-20" value={s.reps} onChange={ev => changeSet(s.id, { reps: Number(ev.target.value) })} />{e.timed ? "秒" : "次"}</label>
            <label className="flex items-center gap-1 text-xs" title="RIR：完成本组后还能标准完成的次数，0 表示力竭">RIR<select aria-label={`${e.name}第${index+1}组RIR`} disabled={s.done} className="h-8 rounded border bg-background px-1" value={s.rir ?? ""} onChange={ev => changeSet(s.id, { rir: ev.target.value === "" ? undefined : Number(ev.target.value) })}><option value="">--</option>{[0, 1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value}{value === 0 ? " 力竭" : ""}</option>)}</select></label>
            <Button size="sm" variant={s.done ? "default" : "outline"} aria-label={`标记${e.name}第${index+1}组完成`} onClick={() => toggleSet(s)}><Check className="h-4 w-4" /></Button>
            <Button size="sm" variant="ghost" aria-label="删除本组" onClick={() => store.save({ ...data, active: { ...active, sets: active.sets.filter(x => x.id !== s.id) } })}><Trash2 className="h-3 w-3" /></Button>
            {!!s.pr?.length && <span className="rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground">{s.pr.join(" / ")} PR</span>}
          </div>)}</div>
        </div>;
      })}
      <div className="flex justify-between gap-3"><Button variant="outline" onClick={() => setTab("动作库")}><Plus className="mr-2 h-4 w-4" />添加动作</Button><Button variant="ghost" onClick={() => { if (window.confirm("放弃本次训练？未保存的组将被清除。")) store.save({ ...data, active: null, restUntil: 0 }); }}>放弃训练</Button></div><p className="text-xs text-muted-foreground">负重记录外部重量；哑铃双侧动作填写合计重量。徒手填写 0 kg，计时动作不计入负重总量。</p>
    </div>)}
    {tab === "计划" && <div className="space-y-5">
      <section className={panel}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><h2 className="font-semibold">按身高体重生成计划</h2><p className="mt-1 text-sm text-muted-foreground">填写最新身体数据，生成后会自动同步到下方每周安排。</p></div>
          <Sparkles className="h-6 w-6 text-primary" />
        </div>
        <form className="mt-5 flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); generatePlan(); }}>
          <label className="w-36 text-sm">身高（cm）<Input aria-label="计划身高（cm）" className="mt-2" type="number" min="80" max="250" step="0.1" required placeholder="例如 170" value={height} onChange={e => setHeight(e.target.value)} /></label>
          <label className="w-36 text-sm">体重（kg）<Input aria-label="计划体重（kg）" className="mt-2" type="number" min="20" max="500" step="0.1" required placeholder="例如 65" value={bodyWeight} onChange={e => setBodyWeight(e.target.value)} /></label>
          <Button type="submit"><Sparkles className="mr-2 h-4 w-4" />生成并同步计划</Button>
        </form>
        <p className="mt-3 text-xs text-muted-foreground">重新生成会覆盖当前每周安排，并更新今日体重记录。BMI 仅用于一般健康筛查，不区分肌肉与脂肪。</p>
        {data.profile && <div className="mt-5 rounded-xl bg-primary/5 p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div><p className="text-xs text-muted-foreground">身体数据</p><p className="mt-1 font-medium">{data.profile.heightCm} cm · {data.profile.weightKg} kg</p></div>
            <div><p className="text-xs text-muted-foreground">BMI / 分类</p><p className="mt-1 font-medium">{data.profile.bmi} · {data.profile.category}</p></div>
            <div><p className="text-xs text-muted-foreground">当前目标</p><p className="mt-1 font-medium">{data.profile.goal}</p></div>
          </div>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">{data.profile.advice}</p>
        </div>}
      </section>
      <section className={panel}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">每周安排</h2><span className="text-xs text-muted-foreground">可继续手动调整每一天</span></div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{["周一", "周二", "周三", "周四", "周五", "周六", "周日"].map((day, i) => {
          const routine = routines.find(r => r.name === data.plan[i]);
          return <div key={day} className="space-y-3 rounded-lg border p-4">
            <span className="block text-sm font-medium">{day}</span>
            <select aria-label={`${day}训练安排`} className="w-full rounded border bg-background p-2 text-sm" value={data.plan[i]} onChange={e => store.save({ ...data, plan: data.plan.map((p, j) => j === i ? e.target.value : p) })}>{["休息", ...routines.map(r => r.name)].map(n => <option key={n}>{n}</option>)}</select>
            <p className="min-h-8 text-xs leading-4 text-muted-foreground">{routine?.description ?? "恢复与自由活动"}</p>
            {routine && <Button size="sm" variant="outline" onClick={() => start(routine.name, routine.ids, routine)}>开始此计划</Button>}
          </div>;
        })}</div>
      </section>
    </div>}
    {tab === "动作库" && (() => { const matched = exercises.filter(e => (muscle === "全部" || e.muscle === muscle) && (gear === "全部" || e.equipment === gear) && `${e.name} ${e.muscle} ${e.equipment}`.includes(query.trim())); return <><div className="mb-4 flex flex-wrap gap-2"><Input aria-label="搜索动作" placeholder="搜索动作、肌群或器械" value={query} onChange={e => setQuery(e.target.value)} /><select aria-label="筛选肌群" className="rounded border bg-background p-2" value={muscle} onChange={e => setMuscle(e.target.value)}>{["全部", ...new Set(exercises.map(e => e.muscle))].map(m => <option key={m}>{m}</option>)}</select><select aria-label="筛选器械" className="rounded border bg-background p-2" value={gear} onChange={e => setGear(e.target.value)}>{["全部", ...new Set(exercises.map(e => e.equipment))].map(m => <option key={m}>{m}</option>)}</select></div><p className="mb-3 text-xs text-muted-foreground">{matched.length} 个动作 · 点开示范可看真人分解和与照片不一致的地方</p><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{matched.map(e => <div key={e.id} className={panel}><ExercisePreview exercise={e} /><p className="text-xs text-primary">{e.muscle} / {e.equipment}</p><h3 className="my-2 font-semibold">{e.name}</h3><p className="mb-4 text-sm leading-6 text-muted-foreground">{e.cue}</p><div className="flex flex-wrap gap-2"><ExerciseGuide exercise={e} /><Button size="sm" variant="outline" onClick={() => { if (!active) start("自由训练", [e.id]); else addSet(e.id); setTab("训练"); }}>加入训练</Button></div></div>)}</div>{!matched.length && <p className="py-10 text-center text-muted-foreground">没有匹配动作，试试其他关键词。</p>}</>; })()}
    {tab === "进展" && <WorkoutProgress data={data} onTargetWeightChange={kg => store.save({ ...data, targetWeight: kg })} />}
    {tab === "记录" && <div className="space-y-4"><div className={panel}><h2 className="mb-3 font-semibold">体重记录</h2><form className="flex gap-2" onSubmit={e => { e.preventDefault(); const kg = Number(weight); if (!Number.isFinite(kg) || kg <= 0 || kg > 500) { setMessage("请输入 0～500 kg 之间的体重。"); return; } const date = new Date().toLocaleDateString("sv-SE"); if (store.save({ ...data, weights: [{ date, kg }, ...data.weights.filter(w => w.date !== date)] })) { setWeight(""); setMessage("体重已保存，同一天重复记录会更新数值。"); } }}><Input aria-label="体重kg" type="number" step="0.1" min="0.1" max="500" required placeholder="今日体重（kg）" value={weight} onChange={e => setWeight(e.target.value)} /><Button type="submit">记录</Button></form><div className="mt-4 flex flex-wrap gap-2">{data.weights.slice(0, 14).map(w => <span key={w.date} className="rounded bg-muted px-3 py-2 text-xs">{w.date} · {w.kg} kg</span>)}</div></div><h2 className="font-semibold">训练历史</h2>{!data.history.length && <p className="p-8 text-center text-muted-foreground">完成第一场训练后，记录会显示在这里。</p>}{data.history.map(h => <details key={h.id} className={panel}><summary className="cursor-pointer font-medium">{h.name} <span className="ml-2 text-sm font-normal text-muted-foreground">{new Date(h.started).toLocaleDateString()} · {h.sets.length} 组 · {Math.round(((h.ended || h.started) - h.started) / 60000)} 分钟</span></summary><div className="mt-4 space-y-2">{h.sets.map(s => { const e = exercises.find(e => e.id === s.exerciseId); return <p key={s.id} className="text-sm">{e?.name} · {e?.timed ? `${s.reps} 秒` : `${s.load} kg × ${s.reps} 次`}{s.rir !== undefined && ` · RIR ${s.rir}`}{!!s.pr?.length && <span className="ml-2 rounded bg-primary/10 px-2 py-0.5 text-xs text-primary">{s.pr.join(" / ")} PR</span>}</p>; })}<p className="border-t pt-2 text-sm">外部负重总量 {volume(h.sets).toFixed(0)} kg</p></div></details>)}</div>}
    <footer className="mt-8 border-t pt-4 text-xs text-muted-foreground">记录与计划保存在当前设备浏览器存储中。训练模板为通用起点，可按能力调整；出现疼痛时停止。功能参考 openGym 的引导训练、PR、RIR 与进展统计，估算 1RM 不等于实际极限，请勿为刷新纪录贸然加重。</footer>
  </div>;
}
