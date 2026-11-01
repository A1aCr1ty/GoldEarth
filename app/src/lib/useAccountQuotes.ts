import { useCallback, useEffect, useRef, useState } from "react";
import { tauri } from "@/lib/tauri";
import { accountQuoteCode } from "./stockAccountMarket";
import type { Position } from "./stockAccountImport";
import type { Quote } from "@/types";

export function useAccountQuotes(accountId: string, positions: Position[]) {
  const codes = [...new Set(positions.map((p) => accountQuoteCode(p.code)).filter((c): c is string => !!c))].sort().join(",");
  const key = `${accountId}:${codes}`;
  const [state, setState] = useState<{ key: string; quotes: Record<string, Quote>; loading: boolean; error: string; fetchedAt: string }>({ key: "", quotes: {}, loading: false, error: "", fetchedAt: "" });
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    let alive = true, running = false;
    setState({ key, quotes: {}, loading: false, error: "", fetchedAt: "" });
    const refresh = async () => {
      if (running || !codes || !alive) return;
      running = true;
      setState((s) => ({ ...s, loading: true }));
      try {
        const list = await tauri.stockQuotes(codes.split(","));
        if (!alive) return;
        const quotes: Record<string, Quote> = {};
        for (const quote of list) {
          const code = accountQuoteCode(quote.code);
          if (code && codes.split(",").includes(code) && Number.isFinite(quote.price) && quote.price > 0) quotes[code] = quote;
        }
        const missing = codes.split(",").filter((c) => !quotes[c]);
        setState({ key, quotes, loading: false, error: missing.length ? `部分标的未返回有效报价，沿用导入价：${missing.join("、")}` : "", fetchedAt: new Date().toLocaleTimeString("zh-CN", { hour12: false }) });
      } catch (e) {
        if (alive) setState((s) => ({ ...s, loading: false, error: `行情刷新失败，沿用上次报价或导入价：${String(e)}` }));
      } finally { running = false; }
    };
    refreshRef.current = refresh;
    const visibleRefresh = () => { if (!document.hidden) void refresh(); };
    visibleRefresh();
    const timer = window.setInterval(visibleRefresh, 10000);
    document.addEventListener("visibilitychange", visibleRefresh);
    return () => { alive = false; window.clearInterval(timer); document.removeEventListener("visibilitychange", visibleRefresh); };
  }, [key, codes]);
  return { ...(state.key === key ? state : { quotes: {}, loading: false, error: "", fetchedAt: "" }), refresh: useCallback(() => refreshRef.current(), []) };
}
