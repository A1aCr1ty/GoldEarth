import { useEffect, useId, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { tauri } from "@/lib/tauri";
import type { StockSuggestion, WatchItem } from "@/types";

export function StockSearch({ items, onAdd }: {
  items: WatchItem[];
  onAdd: (stock: StockSuggestion) => Promise<boolean>;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StockSuggestion[]>([]);
  const [resultQuery, setResultQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [active, setActive] = useState(0);
  const [composing, setComposing] = useState(false);
  const addingRef = useRef(false);
  const listId = useId();
  const text = query.trim();
  // 清空旧候选，避免新查询尚未返回时误选上一次的结果。
  const suggestions = resultQuery === text && !composing ? results : [];

  useEffect(() => {
    if (!text || composing) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setError("");
    const timer = setTimeout(() => {
      void tauri.searchStocks(text).then((data) => {
        if (cancelled) return;
        setResults(data);
        setResultQuery(text);
        setActive(0);
      }).catch((e) => {
        if (!cancelled) {
          setResults([]);
          setResultQuery(text);
          setError(`搜索失败，请重新输入重试：${String(e)}`);
        }
      }).finally(() => { if (!cancelled) setLoading(false); });
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [text, composing]);

  async function add(stock: StockSuggestion) {
    if (addingRef.current) return;
    addingRef.current = true;
    setAdding(true);
    try {
      if (await onAdd(stock)) {
        setQuery(""); setResults([]); setResultQuery(""); setOpen(false); setError("");
      } else {
        setError("添加失败，请重试");
      }
    } catch (e) {
      setError(`添加失败：${String(e)}`);
    } finally { addingRef.current = false; setAdding(false); }
  }

  return (
    <div className="min-h-0 shrink-0 border-b bg-background/80 p-2" onBlur={(e) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
    }}>
      <div className="flex min-w-0 items-center gap-1.5">
        <Input
          role="combobox"
          aria-label="搜索股票名称或代码"
          aria-autocomplete="list"
          aria-expanded={open && !!text}
          aria-controls={listId}
          aria-activedescendant={open && suggestions[active] ? `${listId}-${active}` : undefined}
          autoComplete="off"
          maxLength={64}
          value={query}
          disabled={adding}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0); setError(""); }}
          onFocus={() => setOpen(true)}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || composing || e.keyCode === 229) return;
            if (e.key === "Escape") { setOpen(false); return; }
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setOpen(true);
              if (suggestions.length) setActive((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length);
            }
            if (e.key === "Enter") {
              e.preventDefault();
              if (!open) { setOpen(true); return; }
              if (!loading && suggestions[active]) void add(suggestions[active]);
            }
          }}
          placeholder="股票名称 / 代码"
          className="h-8 min-w-0 flex-1 bg-background text-xs"
        />
        <Button size="sm" className="h-8 shrink-0 px-2.5 text-xs" disabled={adding || loading || composing || !suggestions[active]}
          onClick={() => { if (suggestions[active]) void add(suggestions[active]); }}>
          {adding ? "添加中" : "添加"}
        </Button>
      </div>
      {open && text && (
        <div className="mt-2 min-w-0 overflow-hidden rounded-md border bg-background">
          <div className="border-b bg-muted/40 px-2 py-1 text-[0.625rem] text-muted-foreground">搜索结果 · ↑↓ 选择，回车添加</div>
          <div id={listId} role="listbox" aria-label="股票搜索结果" aria-busy={loading} className="max-h-[min(10rem,18vh)] overflow-y-auto overscroll-contain">
            {loading || composing ? (
              <p role="status" className="px-3 py-3 text-xs text-muted-foreground">{composing ? "输入名称后搜索…" : "正在搜索…"}</p>
            ) : suggestions.length ? suggestions.map((stock, index) => (
              <button key={stock.code} id={`${listId}-${index}`} type="button" role="option"
                aria-selected={index === active} disabled={adding}
                className={`flex w-full min-w-0 items-center justify-between gap-2 px-2 py-2 text-left text-xs hover:bg-accent ${index === active ? "bg-accent" : ""}`}
                onMouseEnter={() => setActive(index)} onMouseDown={(e) => e.preventDefault()}
                onClick={() => void add(stock)}>
                <span className="min-w-0"><span className="block truncate font-medium">{stock.name}</span>
                  <span className="text-muted-foreground">{stock.market} · {stock.code.slice(2)}</span></span>
                {items.some((item) => item.code === stock.code) && <span className="shrink-0 text-muted-foreground">已添加</span>}
              </button>
            )) : !error && <p role="status" className="px-3 py-3 text-xs text-muted-foreground">未找到匹配的沪深京 A 股</p>}
          </div>
          {error && <p role="alert" className="break-words border-t px-2 py-2 text-xs text-destructive">{error}</p>}
        </div>
      )}
    </div>
  );
}
