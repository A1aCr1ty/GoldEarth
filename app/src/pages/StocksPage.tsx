import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useStocks } from "@/store/stocks";
import { IndexTicker, PanelTitle, RankBoard, WatchList } from "@/components/stock/Panels";
import { FundFlowPanel, IndicatorPanel, OrderBook, StatusBar, StockHeader } from "@/components/stock/StockPanels";
import { KlineChart, type SubIndicator } from "@/components/stock/KlineChart";
import { TimeChart } from "@/components/stock/TimeChart";
import { StockAgentPanel } from "@/components/stock/StockAgentPanel";
import { IndexPicker } from "@/components/stock/IndexPicker";
import type { KlinePeriod, RankKind } from "@/types";

const PERIODS: { value: KlinePeriod; label: string }[] = [
  { value: "minute", label: "分时" },
  { value: "day", label: "日K" },
  { value: "week", label: "周K" },
  { value: "month", label: "月K" },
];

const SUBS: { value: SubIndicator; label: string }[] = [
  { value: "macd", label: "MACD" },
  { value: "kdj", label: "KDJ" },
  { value: "rsi", label: "RSI" },
];

const RANKS: { value: RankKind; label: string }[] = [
  { value: "gainers", label: "涨幅" },
  { value: "losers", label: "跌幅" },
  { value: "amount", label: "成交额" },
  { value: "turnover", label: "换手" },
];

export default function StocksPage() {
  const s = useStocks();
  const [rankKind, setRankKind] = useState<RankKind>("gainers");
  const [codeInput, setCodeInput] = useState("");
  const [rightTab, setRightTab] = useState<"market" | "agent">("market");

  useEffect(() => {
    void s.refreshAll();
    void s.loadIndexCodes();
    // 行情需要自动轮询，10 秒一次足够跟盘又不会把接口打爆
    const timer = setInterval(() => {
      void useStocks.getState().refreshQuotes();
      void useStocks.getState().refreshChart();
    }, 10000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!s.current && s.watchlist.length > 0) s.setCurrent(s.watchlist[0].code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.watchlist]);

  useEffect(() => {
    void s.loadRankings(rankKind);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rankKind]);

  async function handleAdd() {
    const code = codeInput.trim();
    if (!code) return;
    await s.addWatch(code);
    setCodeInput("");
    // 切到刚加的股票
    const list = useStocks.getState().watchlist;
    if (list.length > 0) s.setCurrent(list[list.length - 1].code);
  }

  const ranks = s.rankings[rankKind] ?? [];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b px-4">
        <div className="min-w-0">
          <h1 className="text-base font-semibold">股票看板</h1>
          <p className="text-[0.6875rem] text-muted-foreground">实时行情 · K线 · 技术分析</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <IndexPicker
            selected={s.indexCodes}
            onSaved={() => {
              void s.loadIndexCodes();
              void useStocks.getState().refreshAll();
            }}
          />
          <Button size="sm" variant="ghost" onClick={() => void s.refreshAll()}>
            <RefreshCw className="h-3.5 w-3.5" /> 全部刷新
          </Button>
        </div>
      </header>

      <IndexTicker indices={s.indices} />
      <StatusBar error={s.error} loading={s.loading} onRefresh={() => void s.refreshAll()} />

      <div className="flex min-h-0 flex-1">
        {/* 左列：自选股 + 榜单 */}
        <aside className="flex w-56 shrink-0 flex-col border-r xl:w-64">
          <div className="h-[45%] border-b">
            <WatchList
              items={s.watchlist}
              quotes={s.quotes}
              current={s.current}
              onSelect={(c) => s.setCurrent(c)}
              onRemove={(c) => void s.removeWatch(c)}
            />
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            <PanelTitle>
              <Tabs value={rankKind} onValueChange={(v) => setRankKind(v as RankKind)}>
                <TabsList className="h-6 p-0">
                  {RANKS.map((r) => (
                    <TabsTrigger key={r.value} value={r.value} className="h-6 px-2 text-[0.6875rem]">
                      {r.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </PanelTitle>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <RankBoard items={ranks} onSelect={(c) => s.setCurrent(c)} />
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 border-t p-2">
            <Input
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleAdd();
              }}
              placeholder="加自选，如 600519"
              className="h-7 text-xs"
            />
            <Button size="sm" className="h-7 shrink-0" onClick={() => void handleAdd()}>
              添加
            </Button>
          </div>
        </aside>

        {/* 中列：头部 + 图表 */}
        <section className="flex min-w-0 flex-1 flex-col">
          <StockHeader quote={s.detail} />
          <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b px-3 py-1.5">
            {PERIODS.map((p) => (
              <Button
                key={p.value}
                size="sm"
                variant={s.period === p.value ? "default" : "ghost"}
                className="h-7 px-2.5 text-xs"
                onClick={() => s.setPeriod(p.value)}
              >
                {p.label}
              </Button>
            ))}
            <span className="mx-1 h-4 w-px shrink-0 bg-border" />
            {SUBS.map((v) => (
              <Button
                key={v.value}
                size="sm"
                variant={s.sub === v.value ? "secondary" : "ghost"}
                className="h-7 px-2.5 text-xs"
                disabled={s.period === "minute"}
                onClick={() => s.setSub(v.value)}
              >
                {v.label}
              </Button>
            ))}
            <Button
              size="sm"
              variant={s.showBoll ? "secondary" : "ghost"}
              className="h-7 px-2.5 text-xs"
              disabled={s.period === "minute"}
              onClick={s.toggleBoll}
            >
              BOLL
            </Button>
            <span className="ml-auto shrink-0 pl-2 text-[0.625rem] text-muted-foreground">
              {s.chartLoading ? "加载中…" : `${s.klines.length || s.trend?.points.length || 0} 条数据`}
            </span>
          </div>
          <div className="min-h-0 flex-1">
            {s.period === "minute" ? (
              <TimeChart trend={s.trend} />
            ) : (
              <KlineChart candles={s.klines} sub={s.sub} showBoll={s.showBoll} />
            )}
          </div>
        </section>

        {/* 右栏：行情面板 / Agent 分析 两个 tab 切换 */}
        <aside className="flex w-72 shrink-0 flex-col border-l xl:w-80">
          <div className="flex h-8 shrink-0 items-center gap-1 border-b bg-muted/40 px-1.5">
            <TabButton active={rightTab === "market"} onClick={() => setRightTab("market")}>
              盘口 · 指标
            </TabButton>
            <TabButton active={rightTab === "agent"} onClick={() => setRightTab("agent")}>
              Agent 分析
            </TabButton>
          </div>
          {rightTab === "agent" ? (
            <div className="min-h-0 flex-1">
              <StockAgentPanel />
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="border-b">
                <PanelTitle>五档盘口</PanelTitle>
                <OrderBook quote={s.detail} />
              </div>
              <div className="border-b">
                <PanelTitle>资金流向</PanelTitle>
                <FundFlowPanel flow={s.flow} />
              </div>
              <div>
                <PanelTitle>技术指标</PanelTitle>
                <IndicatorPanel candles={s.klines} quote={s.detail} />
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded px-2 py-1 text-[0.6875rem] transition-colors ${
        active ? "bg-accent font-semibold text-accent-foreground" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}