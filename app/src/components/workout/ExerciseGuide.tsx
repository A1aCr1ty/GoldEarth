import { useEffect, useState } from "react";
import { BookOpen, Pause, Play, ExternalLink, ImageOff } from "lucide-react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { Exercise } from "@/lib/workouts";
import { exerciseMedia } from "@/lib/exerciseMedia";

function Photo({ src, alt, className = "" }: { src: string; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return failed ? <div role="status" className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-lg bg-muted p-4 text-sm text-muted-foreground"><ImageOff className="h-6 w-6" />示范图片未能加载，请查看下方步骤或来源资料。</div> : <img src={src} alt={alt} loading="lazy" decoding="async" className={className} onError={() => setFailed(true)} />;
}

/** Card preview shares the same reviewed local asset as the full guide. */
export function ExercisePreview({ exercise }: { exercise: Exercise }) {
  const media = exerciseMedia[exercise.id];
  if (!media) return null;
  return <div className="relative mb-4 overflow-hidden rounded-lg bg-zinc-950"><Photo src={media.frames[0].src} alt={`${exercise.name}真人姿势预览`} className="h-40 w-full object-contain" /><span className="absolute bottom-2 left-2 rounded bg-black/70 px-2 py-1 text-[10px] text-white">真人示范 · {media.frames.length > 1 ? `${media.frames.length} 张分解图` : "姿势参考"}</span></div>;
}

function GuideContent({ exercise }: { exercise: Exercise }) {
  const media = exerciseMedia[exercise.id];
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [intervalMs, setIntervalMs] = useState(1800);
  const [sourceError, setSourceError] = useState("");
  useEffect(() => {
    if (!playing || !media || media.frames.length < 2) return;
    const timer = window.setInterval(() => setFrame(index => (index + 1) % media.frames.length), intervalMs);
    return () => window.clearInterval(timer);
  }, [playing, intervalMs, media]);
  async function showSource(url: string) {
    try {
      if ("__TAURI_INTERNALS__" in window) await openExternal(url);
      else window.open(url, "_blank", "noopener,noreferrer");
    } catch { setSourceError("未能打开浏览器，来源地址：" + url); }
  }
  return <>
    <DialogHeader><DialogTitle>{exercise.name}</DialogTitle><DialogDescription>{exercise.muscle} · {exercise.equipment} · 真人姿势参考与分步讲解</DialogDescription></DialogHeader>
    <div className="grid gap-6 md:grid-cols-[1.2fr_1fr]">
      <div className="min-w-0">
        {media ? <>
          <div className="overflow-hidden rounded-xl bg-zinc-950"><Photo src={media.frames[frame].src} alt={`${exercise.name}：${media.frames[frame].caption}`} className="aspect-[4/3] w-full object-contain" /></div>
          <p className="mt-3 text-center text-sm font-medium">{frame + 1} / {media.frames.length} · {media.frames[frame].caption}</p>
          {media.frames.length > 1 && <>
            <div className="mt-3 grid grid-cols-2 gap-2">{media.frames.map((item, index) => <button key={item.src} type="button" aria-label={`查看${item.caption}`} aria-pressed={frame === index} onClick={() => { setPlaying(false); setFrame(index); }} className={`overflow-hidden rounded-lg border-2 text-left ${frame === index ? "border-primary" : "border-transparent"}`}><Photo src={item.src} alt={item.caption} className="h-24 w-full bg-zinc-950 object-contain" /><span className="block bg-muted px-2 py-1.5 text-xs">{index + 1}. {item.caption}</span></button>)}</div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><Button size="sm" variant="outline" onClick={() => setPlaying(!playing)}>{playing ? <Pause className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}{playing ? "暂停轮播" : "轮播分解图"}</Button><label className="flex items-center gap-2 text-xs text-muted-foreground">切换间隔<select aria-label="分解图切换间隔" value={intervalMs} onChange={e => setIntervalMs(Number(e.target.value))} className="rounded border bg-background p-1"><option value={1800}>1.8 秒</option><option value={3000}>3 秒</option><option value={5000}>5 秒</option></select></label></div>
          </>}
          <p className="mt-3 text-xs leading-5 text-muted-foreground">离线真人照片{media.frames.length > 1 ? "，展示关键姿势；轮播不是连续动作视频，不代表训练节奏。" : "，展示保持姿势。"}</p>
          {media.note && <p className="mt-3 rounded-lg border bg-muted/40 p-3 text-xs leading-6"><span className="font-semibold">示范说明：</span>{media.note}</p>}
          <details className="mt-4 border-t pt-3 text-xs text-muted-foreground"><summary className="cursor-pointer">素材来源与许可</summary><p className="mt-2 leading-5">Free Exercise DB · {media.sourceId}<br />仓库声明采用 Unlicense，照片原样保留；中文图注由本应用补充。</p><div className="mt-2 flex flex-wrap gap-2"><Button size="sm" variant="ghost" onClick={() => void showSource(media.sourceUrl)}><ExternalLink className="mr-1 h-3 w-3" />原始资料</Button><Button size="sm" variant="ghost" onClick={() => void showSource("https://github.com/yuhonas/free-exercise-db/blob/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/LICENSE.md")}>查看许可</Button></div></details>
          {sourceError && <p role="alert" className="mt-2 break-all text-xs text-destructive">{sourceError}</p>}
        </> : <p className="rounded-lg bg-muted p-6 text-sm">此动作暂无已核验的示范素材，请参考文字步骤。</p>}
      </div>
      <div className="space-y-4">
        <section><h3 className="mb-2 text-sm font-semibold">动作步骤</h3><ol className="space-y-3">{exercise.steps.map((step, index) => <li key={step} className="flex gap-3 text-sm leading-6"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">{index + 1}</span><span>{step}</span></li>)}</ol></section>
        <section className="rounded-lg bg-muted/60 p-3"><h3 className="text-sm font-semibold">呼吸节奏</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">{exercise.breathing}</p></section>
        <section className="rounded-lg border border-destructive/30 p-3"><h3 className="text-sm font-semibold">常见错误</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">{exercise.mistake}</p></section>
      </div>
    </div>
    <p className="text-xs text-muted-foreground">先用可控的轻负重熟悉动作，幅度按个人活动能力调整；疼痛时停止。</p>
  </>;
}

export function ExerciseGuide({ exercise }: { exercise: Exercise }) {
  return <Dialog><DialogTrigger asChild><Button size="sm" variant="outline"><BookOpen className="mr-2 h-4 w-4" />动作示范</Button></DialogTrigger><DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto"><GuideContent key={exercise.id} exercise={exercise} /></DialogContent></Dialog>;
}
