import { Badge } from "@/components/ui/badge";
import { computeAll, lastOf } from "@/lib/indicators";
import { amountText, fixed, netText, signed, signedNum, volumeText } from "@/lib/format";
import type { Candle, FundFlow, Quote } from "@/types";

function Cell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[0.625rem] text-muted-foreground">{label}</span>
      <span className={`font-mono text-xs tabular-nums ${color ?? ""}`}>{value}</span>
    </div>
  );
}

/** 个股头部：名称、现价、各类盘口指标 */
export function StockHeader({ quote }: { quote: Quote | null }) {
  if (!quote) {
    return <div className="flex h-16 items-center px-4 text-sm text-muted-foreground">选择一只股票查看详情</div>;
  }
  const up = quote.changePct > 0;
  const down = quote.changePct < 0;
  const color = up ? "text-red-500" : down ? "text-emerald-500" : "text-muted-foreground";
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-2">
      <div className="flex items-baseline gap-2">
        <span className="text-base font-semibold">{quote.name}</span>
        <span className="font-mono text-xs text-muted-foreground">{quote.code.toUpperCase()}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className={`font-mono text-2xl font-bold tabular-nums ${color}`}>{fixed(quote.price)}</span>
        <span className={`font-mono text-sm tabular-nums ${color}`}>
          {signedNum(quote.change)}　{signed(quote.changePct)}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Cell label="今开" value={fixed(quote.open)} color={quote.open >= quote.prevClose ? "text-red-500" : "text-emerald-500"} />
        <Cell label="昨收" value={fixed(quote.prevClose)} />
        <Cell label="最高" value={fixed(quote.high)} color={up ? "text-red-500" : ""} />
        <Cell label="最低" value={fixed(quote.low)} color={down ? "text-emerald-500" : ""} />
        <Cell label="均价" value={fixed(quote.avgPrice)} />
        <Cell label="成交量" value={volumeText(quote.volume)} />
        <Cell label="成交额" value={amountText(quote.amount)} />
        <Cell label="换手率" value={`${fixed(quote.turnoverRate)}%`} />
        <Cell label="振幅" value={`${fixed(quote.amplitude)}%`} />
        <Cell label="量比" value={fixed(quote.volumeRatio)} />
        <Cell label="市盈率" value={fixed(quote.pe)} />
        <Cell label="市净率" value={fixed(quote.pb)} />
        <Cell label="流通市值" value={`${fixed(quote.floatMv)}亿`} />
        <Cell label="总市值" value={`${fixed(quote.totalMv)}亿`} />
        <Cell label="涨停" value={fixed(quote.limitUp)} color="text-red-500" />
        <Cell label="跌停" value={fixed(quote.limitDown)} color="text-emerald-500" />
      </div>
    </div>
  );
}

/** 五档盘口 */
export function OrderBook({ quote }: { quote: Quote | null }) {
  if (!quote) return null;
  const maxVol = Math.max(
    ...quote.bids.map((b) => b.volume),
    ...quote.asks.map((a) => a.volume),
    1
  );
  const row = (label: string, price: number, volume: number, isBid: boolean) => (
    <div key={label} className="relative flex items-center justify-between px-2.5 py-0.5 font-mono text-[0.6875rem] tabular-nums">
      <div
        className="absolute inset-y-0 right-0 opacity-15"
        style={{
          width: `${(volume / maxVol) * 100}%`,
          background: isBid ? "#e5464b" : "#17a86b",
        }}
      />
      <span className="relative text-muted-foreground">{label}</span>
      <span className={`relative ${isBid ? "text-red-500" : "text-emerald-500"}`}>{fixed(price)}</span>
      <span className="relative text-muted-foreground">{volume.toFixed(0)}</span>
    </div>
  );
  return (
    <div className="text-xs">
      <div className="flex items-center justify-between px-2.5 py-1 text-[0.625rem] text-muted-foreground">
        <span>买卖盘</span>
        <span>委比 {fixed(quote.orderRatio)}%</span>
      </div>
      {[...quote.asks].reverse().map((a, i) => row(`卖${5 - i}`, a.price, a.volume, false))}
      <div className="my-1 flex items-center justify-between border-y px-2.5 py-1">
        <span className="text-[0.625rem] text-muted-foreground">现价</span>
        <span
          className={`font-mono text-sm font-semibold tabular-nums ${
            quote.changePct > 0 ? "text-red-500" : quote.changePct < 0 ? "text-emerald-500" : ""
          }`}
        >
          {fixed(quote.price)}
        </span>
      </div>
      {quote.bids.map((b, i) => row(`买${i + 1}`, b.price, b.volume, true))}
      <div className="flex items-center justify-between px-2.5 py-1 text-[0.625rem] text-muted-foreground">
        <span>外盘 {volumeText(quote.outer)}</span>
        <span>内盘 {volumeText(quote.inner)}</span>
      </div>
    </div>
  );
}

/** 资金流向 */
export function FundFlowPanel({ flow }: { flow: FundFlow | null }) {
  if (!flow) return <p className="p-3 text-[0.6875rem] text-muted-foreground">加载中…</p>;
  const tiers = [
    { label: "主力净额", v: flow.main },
    { label: "超大单", v: flow.superLarge },
    { label: "大单", v: flow.large },
    { label: "中单", v: flow.medium },
    { label: "小单", v: flow.small },
  ];
  const maxAbs = Math.max(...tiers.map((t) => Math.abs(t.v.net)), 1);
  return (
    <div className="space-y-1 px-2.5 py-2 text-[0.6875rem]">
      {tiers.map((t) => {
        const c = t.v.net > 0 ? "text-red-500" : t.v.net < 0 ? "text-emerald-500" : "text-muted-foreground";
        const w = (Math.abs(t.v.net) / maxAbs) * 50;
        return (
          <div key={t.label} className="relative flex items-center justify-between">
            <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
            <div
              className="absolute inset-y-0 opacity-20"
              style={{
                width: `${w}%`,
                left: t.v.net >= 0 ? "50%" : `${50 - w}%`,
                background: t.v.net >= 0 ? "#e5464b" : "#17a86b",
              }}
            />
            <span className="relative w-14 text-muted-foreground">{t.label}</span>
            <span className={`relative flex-1 text-right font-mono tabular-nums ${c}`}>
              {netText(t.v.net)}　{signed(t.v.pct)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** 技术指标读数 */
export function IndicatorPanel({ candles, quote }: { candles: Candle[]; quote: Quote | null }) {
  if (candles.length === 0) return <p className="p-3 text-[0.6875rem] text-muted-foreground">暂无 K 线数据</p>;
  const t = computeAll(candles);
  const last = (a: (number | null)[]) => {
    const v = lastOf(a);
    return v === null ? "--" : v.toFixed(2);
  };
  const difV = lastOf(t.macd.dif);
  const deaV = lastOf(t.macd.dea);
  const histV = lastOf(t.macd.hist);
  const macdColor = (v: number | null) => (v === null ? "" : v > 0 ? "text-red-500" : v < 0 ? "text-emerald-500" : "");

  return (
    <div className="space-y-2 px-2.5 py-2 text-[0.6875rem]">
      <div>
        <SectionLabel>均线</SectionLabel>
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          <Row label="MA5" value={last(t.ma5)} />
          <Row label="MA10" value={last(t.ma10)} />
          <Row label="MA20" value={last(t.ma20)} />
          <Row label="MA60" value={last(t.ma60)} />
        </div>
      </div>
      <div>
        <SectionLabel>布林带</SectionLabel>
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          <Row label="上轨" value={last(t.boll.upper)} />
          <Row label="中轨" value={last(t.boll.mid)} />
          <Row label="下轨" value={last(t.boll.lower)} />
        </div>
      </div>
      <div>
        <SectionLabel>MACD</SectionLabel>
        <div className="grid grid-cols-3 gap-x-2 gap-y-1">
          <Row label="DIF" value={difV?.toFixed(3) ?? "--"} color={macdColor(difV)} />
          <Row label="DEA" value={deaV?.toFixed(3) ?? "--"} color={macdColor(deaV)} />
          <Row label="MACD" value={histV?.toFixed(3) ?? "--"} color={macdColor(histV)} />
        </div>
      </div>
      <div>
        <SectionLabel>KDJ</SectionLabel>
        <div className="grid grid-cols-3 gap-x-2 gap-y-1">
          <Row label="K" value={last(t.kdj.k)} />
          <Row label="D" value={last(t.kdj.d)} />
          <Row label="J" value={last(t.kdj.j)} />
        </div>
      </div>
      <div>
        <SectionLabel>RSI</SectionLabel>
        <div className="grid grid-cols-3 gap-x-2 gap-y-1">
          <Row label="RSI6" value={last(t.rsi6)} />
          <Row label="RSI12" value={last(t.rsi12)} />
          <Row label="RSI24" value={last(t.rsi24)} />
        </div>
      </div>
      {quote && quote.outer + quote.inner > 0 && (
        <div>
          <SectionLabel>内外盘</SectionLabel>
          <div className="flex justify-between font-mono tabular-nums">
            <span className="text-red-500">外盘 {volumeText(quote.outer)}</span>
            <span className="text-emerald-500">内盘 {volumeText(quote.inner)}</span>
          </div>
          <div className="mt-1 flex h-1.5 overflow-hidden rounded bg-muted">
            <div className="bg-red-500" style={{ width: `${(quote.outer / (quote.outer + quote.inner)) * 100}%` }} />
            <div className="bg-emerald-500" style={{ flex: 1 }} />
          </div>
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1 text-[0.625rem] font-semibold text-muted-foreground">{children}</div>;
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono tabular-nums ${color ?? ""}`}>{value}</span>
    </div>
  );
}

/** 顶部状态提示 */
export function StatusBar({ error, loading, onRefresh }: { error?: string; loading: boolean; onRefresh: () => void }) {
  return (
    <div className="flex items-center gap-2 border-b px-4 py-1.5 text-[0.6875rem]">
      {error ? (
        <span className="text-destructive">{error}</span>
      ) : (
        <span className="text-muted-foreground">
          {loading ? "加载中…" : "数据来自腾讯行情与东方财富公开接口，仅供参考，不构成投资建议"}
        </span>
      )}
      <Badge variant="outline" className="cursor-pointer" onClick={onRefresh}>
        刷新
      </Badge>
    </div>
  );
}