import { useEffect, useMemo, useState } from "react";
import { Shuffle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { lineContext, pickPushLine } from "@/lib/lines";

interface TextPushProps {
  /** 选中的日期（和天气、日历共用同一个值），点日历上的雨雪天这里也会跟着换 */
  date: string;
  /** 当前小时：用来区分早晚 */
  hour: number;
  /** 选中日期的天气代码；拿不到就传 null */
  code: number | null;
  isDay: boolean;
  isToday: boolean;
}

/**
 * 天气页空白处的「文字推送」：一句古典短句。
 *
 * 选句跟着季节、天气和早晚走——点日历上的雨天，推送也会换成写雨的那几句。
 * 同一天同一时段看到的是同一句（seed 固定），点「换一句」才往下走一步，
 * 所以刷新页面、切走再回来都不会乱跳。
 */
export function TextPush({ date, hour, code, isDay, isToday }: TextPushProps) {
  const context = useMemo(
    () => lineContext({ date, hour, code, isDay, isToday }),
    [date, hour, code, isDay, isToday]
  );
  const [step, setStep] = useState(0);

  // 换了日期、时段或天气样貌，就从头开始推
  useEffect(() => {
    setStep(0);
  }, [context.seed, context.keys.join(",")]);

  const line = useMemo(() => pickPushLine(context, step), [context, step]);

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
            title="换一句"
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
      </CardContent>
    </Card>
  );
}
