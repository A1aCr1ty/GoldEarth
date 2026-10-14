/**
 * 把行情数据拼成给 Agent 看的文字上下文。
 *
 * Agent 跑在命令行里，默认拿不到 App 拉到的这些数据（也不该指望它自己去联网查），
 * 所以把快照、最近 K 线和技术指标算好一起发过去，它才能做真正的分析而不是泛泛而谈。
 *
 * 只在一段会话的第一轮发送，之后靠 resume 里的上下文接着聊，避免每轮重复贴数据。
 */

import { computeAll, lastOf } from "@/lib/indicators";
import { amountText, fixed, netText, quoteTime, signed, volumeText } from "@/lib/format";
import type { Candle, FundFlow, Quote, Trend } from "@/types";

/** 最近多少根 K 线进上下文；再多 token 消耗大且收益递减 */
const RECENT_BARS = 60;

function num(v: number | null | undefined, digits = 2): string {
  return v === null || v === undefined || !Number.isFinite(v) ? "--" : v.toFixed(digits);
}

export function buildMarketContext(
  quote: Quote | null,
  klines: Candle[],
  trend: Trend | null,
  flow: FundFlow | null
): string {
  const lines: string[] = [];
  if (!quote) return "";

  lines.push(`你在分析一只 A 股标的：${quote.name}（${quote.code.toUpperCase()}）。`);
  lines.push("");
  lines.push("【实时快照】");
  lines.push(`现价 ${fixed(quote.price)}　涨跌 ${quote.change >= 0 ? "+" : ""}${fixed(quote.change)}（${signed(quote.changePct)}）`);
  lines.push(`昨收 ${fixed(quote.prevClose)}　今开 ${fixed(quote.open)}　最高 ${fixed(quote.high)}　最低 ${fixed(quote.low)}　均价 ${fixed(quote.avgPrice)}`);
  lines.push(
    `成交量 ${volumeText(quote.volume)}　成交额 ${amountText(quote.amount)}　换手率 ${fixed(quote.turnoverRate)}%　振幅 ${fixed(quote.amplitude)}%`
  );
  lines.push(`量比 ${fixed(quote.volumeRatio)}　市盈率(TTM) ${fixed(quote.pe)}　市净率 ${fixed(quote.pb)}`);
  lines.push(`流通市值 ${fixed(quote.floatMv)} 亿　总市值 ${fixed(quote.totalMv)} 亿`);
  lines.push(`涨停价 ${fixed(quote.limitUp)}　跌停价 ${fixed(quote.limitDown)}　委比 ${fixed(quote.orderRatio)}%`);
  lines.push(`外盘 ${volumeText(quote.outer)}　内盘 ${volumeText(quote.inner)}　行情时间 ${quoteTime(quote.time)}`);

  const bids = quote.bids.filter((b) => b.price > 0);
  const asks = quote.asks.filter((a) => a.price > 0);
  if (bids.length || asks.length) {
    lines.push("");
    lines.push("【五档盘口】");
    if (asks.length) {
      lines.push(`卖盘 ${[...asks].reverse().map((a, i) => `${fixed(a.price)}×${a.volume}`).join("　")}`);
    }
    if (bids.length) {
      lines.push(`买盘 ${bids.map((b, i) => `${fixed(b.price)}×${b.volume}`).join("　")}`);
    }
  }

  if (flow) {
    lines.push("");
    lines.push("【资金流向】");
    lines.push(
      `主力 ${netText(flow.main.net)}（${signed(flow.main.pct)}）　超大单 ${netText(flow.superLarge.net)}　大单 ${netText(flow.large.net)}`
    );
    lines.push(`中单 ${netText(flow.medium.net)}　小单 ${netText(flow.small.net)}`);
  }

  if (klines.length > 0) {
    const recent = klines.slice(-RECENT_BARS);
    lines.push("");
    lines.push(`【最近 ${recent.length} 个交易日 K 线（日线，前复权）】`);
    lines.push("日期\t开盘\t收盘\t最高\t最低\t涨跌幅%\t成交量(手)");
    for (const k of recent) {
      lines.push(
        `${k.date}\t${num(k.open)}\t${num(k.close)}\t${num(k.high)}\t${num(k.low)}\t${num(k.changePct)}\t${k.volume}`
      );
    }

    const t = computeAll(klines);
    const last = (a: (number | null)[]) => lastOf(a);
    lines.push("");
    lines.push("【技术指标（基于上述全部K线计算，最新值）】");
    lines.push(
      `MA5 ${num(last(t.ma5))}　MA10 ${num(last(t.ma10))}　MA20 ${num(last(t.ma20))}　MA60 ${num(last(t.ma60))}`
    );
    lines.push(
      `BOLL 上轨 ${num(last(t.boll.upper))}　中轨 ${num(last(t.boll.mid))}　下轨 ${num(last(t.boll.lower))}`
    );
    lines.push(
      `MACD DIF ${num(last(t.macd.dif), 3)}　DEA ${num(last(t.macd.dea), 3)}　MACD柱 ${num(last(t.macd.hist), 3)}`
    );
    lines.push(`KDJ K ${num(last(t.kdj.k))}　D ${num(last(t.kdj.d))}　J ${num(last(t.kdj.j))}`);
    lines.push(`RSI6 ${num(last(t.rsi6))}　RSI12 ${num(last(t.rsi12))}　RSI24 ${num(last(t.rsi24))}`);

    // 区间统计的窗口比上面列出的 K 线长得多，要说清楚，否则 Agent 会以为
    // 「最近 500 天」就是它看到的那 60 根，据此推高位会出错
    const periodHigh = Math.max(...klines.map((k) => k.high));
    const periodLow = Math.min(...klines.map((k) => k.low));
    const first = klines[0];
    const changePct = ((quote.price - first.close) / first.close) * 100;
    lines.push(
      `更长周期参考（近 ${klines.length} 个交易日，超出上面列出的 ${recent.length} 根）：` +
        `最高 ${num(periodHigh)}　最低 ${num(periodLow)}　区间涨跌 ${changePct >= 0 ? "+" : ""}${num(changePct)}%`
    );

    // 盘中时最后一根 K 线还没走完，成交量天然偏低，不说明就是缩量
    const today = new Date().toISOString().slice(0, 10);
    const lastBar = klines[klines.length - 1];
    if (lastBar.date === today) {
      lines.push(
        `注意：最后一根 K 线（${lastBar.date}）是今天的盘中数据，尚未收盘，` +
          "成交量和涨跌幅都可能与收盘后不同，判断缩放量时请结合前一日对比。"
      );
    }
  } else if (trend && trend.points.length > 0) {
    lines.push("");
    lines.push(`【当日分时】昨收 ${num(trend.preClose)}　最新 ${num(trend.points[trend.points.length - 1].price)}`);
  }

  lines.push("");
  lines.push("以上是 App 拉到的行情数据，请基于这些数据回答，不要凭空编造数字。");
  lines.push("数据来自第三方公开接口，仅供参考，不构成投资建议。");
  return lines.join("\n");
}