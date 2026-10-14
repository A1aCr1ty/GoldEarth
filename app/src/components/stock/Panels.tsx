import { X } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
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
}: {
  items: { code: string; name: string }[];
  quotes: Record<string, Quote>;
  current: string;
  onSelect: (code: string) => void;
  onRemove: (code: string) => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <PanelTitle>自选股</PanelTitle>
      <ScrollArea className="min-h-0 flex-1">
        {items.length === 0 && <p className="p-3 text-xs text-muted-foreground">还没有自选股，在下方输入代码添加。</p>}
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
              className={`flex items-center gap-1 border-b py-1.5 pl-2.5 pr-1.5 text-xs transition-colors hover:bg-accent ${
                current === w.code ? "bg-accent" : ""
              }`}
            >
              <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => onSelect(w.code)}>
                <span className="w-16 shrink-0 truncate font-medium">{name}</span>
                <span className="w-14 shrink-0 font-mono text-[0.625rem] text-muted-foreground">{w.code.replace(/^(sh|sz|bj)/, "")}</span>
                <span className={`flex-1 text-right font-mono tabular-nums ${color}`}>{q ? fixed(q.price, 2) : "--"}</span>
                <span className={`w-16 shrink-0 text-right font-mono tabular-nums ${color}`}>{q ? signed(q.changePct) : "--"}</span>
              </button>
              {/* 常驻显示：之前只在悬停行时才 opacity-100，等于让人猜这里能不能删 */}
              <button
                type="button"
                className="shrink-0 rounded p-0.5 text-muted-foreground/70 transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
            className="flex w-full items-center gap-2 border-b px-2.5 py-1 text-left text-xs transition-colors hover:bg-accent"
          >
            <span className="w-4 shrink-0 text-[0.625rem] text-muted-foreground">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate">{r.name}</span>
            <span className={`w-14 shrink-0 text-right font-mono tabular-nums ${color}`}>{fixed(r.price, 2)}</span>
            <span className={`w-14 shrink-0 text-right font-mono tabular-nums ${color}`}>{signed(r.changePct)}</span>
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