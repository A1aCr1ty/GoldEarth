import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { readStockAccounts, STOCK_ACCOUNTS_CHANGED } from "@/lib/stockAccountStorage";
import { accountQuoteCode } from "@/lib/stockAccountMarket";
import { evaluatePlanAlerts, planReminderReady, tradingSession, chinaDay, TRADE_ALERTS_KEY, type TradePlanAlert } from "@/lib/tradePlanAlerts";
import { tauri } from "@/lib/tauri";
import type { Quote } from "@/types";

type AlertStore = { events: TradePlanAlert[]; fired: Record<string, string> };
function readStore(): AlertStore { try { const v = JSON.parse(localStorage.getItem(TRADE_ALERTS_KEY) || "null"); return v && Array.isArray(v.events) && v.fired ? v : { events: [], fired: {} }; } catch { return { events: [], fired: {} }; } }

export function TradePlanAlertMonitor() {
  const [accounts, setAccounts] = useState(readStockAccounts);
  const [store, setStore] = useState(readStore);
  const [open, setOpen] = useState(false);
  const [popup, setPopup] = useState<TradePlanAlert | null>(null);
  const [status, setStatus] = useState("");
  const navigate = useNavigate();
  const count = accounts.reduce((n, a) => n + (a.tradePlans ?? []).filter(planReminderReady).length, 0);
  const unread = store.events.filter(e => !e.read).length;
  function persist(next: AlertStore) {
    localStorage.setItem(TRADE_ALERTS_KEY, JSON.stringify(next)); setStore(next);
  }
  useEffect(() => {
    const refresh = () => setAccounts(readStockAccounts());
    window.addEventListener(STOCK_ACCOUNTS_CHANGED, refresh); window.addEventListener("storage", refresh);
    return () => { window.removeEventListener(STOCK_ACCOUNTS_CHANGED, refresh); window.removeEventListener("storage", refresh); };
  }, []);
  useEffect(() => {
    let alive = true, running = false;
    const poll = async () => {
      if (running || !alive) return;
      running = true;
      try {
        const plans = readStockAccounts().flatMap(a => (a.tradePlans ?? []).filter(planReminderReady).map(plan => ({ accountId: a.id, plan })));
        if (!plans.length) { setStatus("未启用计划提醒"); return; }
        const now = Date.now();
        const codes = [...new Set(plans.map(({ plan }) => accountQuoteCode(plan.code)).filter((c): c is string => !!c))];
        const quotes: Record<string, Quote> = {};
        let quoteError = "";
        if (tradingSession(now)) {
          try { const list = await tauri.stockQuotes(codes); for (const q of list) { const key = accountQuoteCode(q.code); if (key) quotes[key] = q; } }
          catch (e) { quoteError = `行情获取失败，价格提醒暂停：${e}`; }
        }
        if (!alive) return;
        const current = readStockAccounts().flatMap(a => (a.tradePlans ?? []).map(plan => ({ accountId: a.id, plan })));
        const candidates = current.flatMap(({ accountId, plan }) => evaluatePlanAlerts(accountId, plan, quotes[accountQuoteCode(plan.code) ?? ""], Date.now()));
        const saved = readStore(); const day = chinaDay(Date.now());
        const fired = Object.fromEntries(Object.entries(saved.fired).filter(([, value]) => value === day));
        const fresh = candidates.filter(e => { if (fired[e.key]) return false; fired[e.key] = day; return true; });
        if (fresh.length) {
          const next = { events: [...fresh, ...saved.events].slice(0, 100), fired };
          localStorage.setItem(TRADE_ALERTS_KEY, JSON.stringify(next));
          setStore(next); setPopup(fresh[0]);
        }
        setStatus(quoteError || (tradingSession(Date.now()) ? `跟踪 ${plans.length} 条计划 · 每 10 秒检查 · 仅有效新报价触发` : `跟踪 ${plans.length} 条计划 · 非交易时段，等待有效新报价`));
      } catch (e) { if (alive) setStatus(`提醒处理失败：${e}`); }
      finally { running = false; }
    };
    void poll(); const timer = window.setInterval(() => void poll(), 10000);
    return () => { alive = false; clearInterval(timer); };
  }, [accounts]);
  function visit(event: TradePlanAlert) {
    try { const saved = readStore(); persist({ ...saved, events: saved.events.map(e => e.id === event.id ? { ...e, read: true } : e) }); } catch { setStatus("提醒已触发，但已读状态保存失败"); }
    setPopup(null); setOpen(false);
    navigate(`/stock-accounts?account=${encodeURIComponent(event.accountId)}&plan=${encodeURIComponent(event.planId)}`);
  }
  if (!count && !store.events.length) return null;
  return <div className="fixed bottom-5 right-5 z-50 max-w-[calc(100vw-2.5rem)] space-y-2">
    {popup && !open && <div role="alert" className="w-96 max-w-full rounded-lg border border-primary/40 bg-background p-4 shadow-xl"><div className="flex justify-between gap-2"><strong className="text-sm">{popup.title}</strong><button aria-label="关闭本次提醒" onClick={() => setPopup(null)}><X className="h-4 w-4" /></button></div><p className="my-2 text-xs leading-5">{popup.detail}</p><Button size="sm" onClick={() => visit(popup)}>查看计划</Button></div>}
    {open && <section className="w-[440px] max-w-full rounded-lg border bg-background p-4 shadow-xl"><div className="flex items-center justify-between"><h3 className="font-semibold text-sm">交易操作提醒</h3><button aria-label="关闭提醒列表" onClick={() => setOpen(false)}><X className="h-4 w-4" /></button></div><p className="mt-2 text-xs text-muted-foreground">{status}</p><p className="mt-1 text-xs text-muted-foreground">应用运行期间检查；同一条件每天提醒一次，提醒不自动下单。</p><div className="mt-3 max-h-80 overflow-auto space-y-2">{store.events.length ? store.events.map(e => <button key={e.id} onClick={() => visit(e)} className="w-full rounded-md border p-3 text-left text-xs hover:bg-accent"><p className={e.read ? "text-muted-foreground" : "font-semibold"}>{e.read ? "" : "● "}{e.title}</p><p className="my-1 text-muted-foreground">{new Date(e.createdAt).toLocaleString("zh-CN")}</p><p className="leading-5">{e.detail}</p></button>) : <p className="text-xs text-muted-foreground">暂未触发提醒</p>}</div><Button className="mt-3" size="sm" variant="ghost" onClick={() => { try { const saved = readStore(); persist({ ...saved, events: saved.events.map(e => ({ ...e, read: true })) }); setPopup(null); } catch { setStatus("已读状态保存失败"); } }}>全部标为已读</Button></section>}
    <div className="flex justify-end"><Button size="sm" variant="outline" className="bg-background shadow-md" onClick={() => { setOpen(v => !v); setPopup(null); }}><Bell className="h-4 w-4" />操作提醒 {unread ? `(${unread})` : count ? `· ${count} 条跟踪中` : ""}</Button></div>
  </div>;
}
