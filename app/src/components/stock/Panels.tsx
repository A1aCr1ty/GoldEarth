import { X } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fixed, signed } from "@/lib/format";
import type { Quote } from "@/types";

/** 顶部指数条 */
export function IndexTicker({ indices }: { indices: Quote[] }) {
  if (indices.length === 0) return null;
  return (
    <div className="flex items-stretch gap-0 overflow-x-auto border-b bg-card/40">
      {indices.map((q) => {
        const color =
          q.changePct > 0 ? "text-red-500" : q.changePct < 0 ? "text-emerald-500" : "text-muted-foreground";
        return (
          <div key={q.code} className="flex min-w-[8rem] shrink-0 flex-col justify-center border-r px-3 py-1.5">
            <span className="truncate text-[0.6875rem] text-muted-foreground">{q.name}</span>
            <span className={`font-mono text-sm font-semibold tabular-nums ${color}`}>{fixed(q.price, 2)}</span>
            <span className={`font-mono text-[0.6875rem] tabular-nums ${color}`}>{signed(q.changePct)}</span>
          </div>
        );
      })}
    </div>
  );
}

/** 自选股列表 */
export function WatchList({
  items,
  quotes,
  current,
  onSelect,
  onRemove,
  toolbar,
}: {
  items: { code: string; name: string }[];
  quotes: Record<string, Quote>;
  current: string;
  onSelect: (code: string) => void;
  onRemove: (code: string) => void;
  toolbar?: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <PanelTitle extra={<span className="rounded bg-background px-1.5 py-0.5 text-[0.625rem] tabular-nums text-muted-foreground">{items.length} 只</span>}>自选股</PanelTitle>
      {toolbar}
      <ScrollArea className="min-h-0 flex-1">
        {items.length === 0 && <p className="px-3 py-6 text-center text-xs leading-relaxed text-muted-foreground">还没有自选股<br />在上方搜索名称或代码添加</p>}
        {items.map((w) => {
          const q = quotes[w.code];
          const name = q?.name || w.name || w.code;
          const color = !q
            ? "text-muted-foreground"
            : q.changePct > 0
              ? "text-red-500"
              : q.changePct < 0
                ? "text-emerald-500"
                : "text-muted-foreground";
          return (
            <div
              key={w.code}
              className={`flex min-w-0 items-center gap-1 border-b border-l-2 py-2 pl-2 pr-1.5 text-xs transition-colors hover:bg-accent/60 ${
                current === w.code ? "border-l-primary bg-accent/70" : "border-l-transparent"
              }`}
            >
              <button type="button" title={name} aria-pressed={current === w.code}
                className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 rounded text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                onClick={() => onSelect(w.code)}>
                <span className="min-w-0">
                  <span className="block truncate font-medium leading-5">{name}</span>
                  <span className="block truncate font-mono text-[0.625rem] leading-4 text-muted-foreground">{w.code.replace(/^(sh|sz|bj)/, "")}</span>
                </span>
                <span className={`min-w-0 text-right font-mono tabular-nums ${color}`}>
                  <span className="block whitespace-nowrap leading-5">{q ? fixed(q.price, 2) : "--"}</span>
                  <span className="block whitespace-nowrap text-[0.625rem] leading-4">{q ? signed(q.changePct) : "--"}</span>
                </span>
              </button>
              {/* 常驻显示：之前只在悬停行时才 opacity-100，等于让人猜这里能不能删 */}
              <button
                type="button"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                onClick={() => onRemove(w.code)}
                aria-label={`移出自选：${name}`}
                title="移出自选"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </ScrollArea>
    </div>
  );
}

/** 榜单 */
export function RankBoard({
  items,
  onSelect,
}: {
  items: { code: string; name: string; price: number; changePct: number; amount: number; mainNet: number }[];
  onSelect: (code: string) => void;
}) {
  return (
    <div>
      {items.length === 0 && <p className="p-3 text-xs text-muted-foreground">加载中…</p>}
      {items.map((r, i) => {
        const color = r.changePct > 0 ? "text-red-500" : r.changePct < 0 ? "text-emerald-500" : "text-muted-foreground";
        return (
          <button
            key={r.code}
            onClick={() => onSelect(r.code)}
            className="flex w-full min-w-0 items-center gap-2 border-b px-2.5 py-2 text-left text-xs transition-colors hover:bg-accent"
          >
            <span className="w-3 shrink-0 text-[0.625rem] text-muted-foreground">{i + 1}</span>
            <span className="min-w-0 flex-1"><span className="block truncate font-medium leading-5">{r.name}</span>
              <span className="block font-mono text-[0.625rem] leading-4 text-muted-foreground">{r.code.replace(/^(sh|sz|bj)/, "")}</span></span>
            <span className={`shrink-0 text-right font-mono tabular-nums ${color}`}><span className="block leading-5">{fixed(r.price, 2)}</span>
              <span className="block text-[0.625rem] leading-4">{signed(r.changePct)}</span></span>
          </button>
        );
      })}
    </div>
  );
}

export function PanelTitle({ children, extra }: { children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div className="flex h-8 shrink-0 items-center justify-between border-b bg-muted/40 px-2.5">
      <span className="text-[0.6875rem] font-semibold tracking-wide text-muted-foreground">{children}</span>
      {extra}
    </div>
  );
}

/** 涨跌幅色块，榜单里用 */
export function ChangeBadge({ value }: { value: number }) {
  const cls =
    value > 0
      ? "bg-red-500/90 text-white"
      : value < 0
        ? "bg-emerald-500/90 text-white"
        : "bg-muted text-muted-foreground";
  return <span className={`rounded px-1.5 py-0.5 font-mono text-[0.6875rem] tabular-nums ${cls}`}>{signed(value)}</span>;
}
