import type { Candle, Quote } from "@/types";

const chinaDate = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);

export const INDEX_ETFS = [
  { code: "sz159915", name: "创业板ETF易方达" },
  { code: "sh510300", name: "沪深300ETF华泰柏瑞" },
  { code: "sh512890", name: "红利低波ETF华泰柏瑞" },
  { code: "sz159516", name: "半导体设备ETF国泰" },
  { code: "sh588200", name: "科创芯片ETF嘉实" },
  { code: "sh588000", name: "科创50ETF华夏" },
] as const;

export const BOSS_MO_SOURCES = [
  { title: "墨派MACD法之模式1", url: "https://www.bilibili.com/video/BV13q4y1t71v/", use: "MACD图形与持仓思路参考" },
  { title: "墨派MACD法之模式2", url: "https://www.bilibili.com/video/BV11S4y1r7Yu/", use: "MACD判定与筛选思路参考" },
  { title: "抓转折好还是跟随好", url: "https://www.bilibili.com/video/BV1S34y1m7a2/", use: "右侧跟随优先于猜底" },
  { title: "黄金右侧回调参与的笨方式", url: "https://www.bilibili.com/video/BV1kDtu6TECj/", use: "回调与右侧确认思路参考" },
  { title: "稳定的交易系统结构组成", url: "https://www.bilibili.com/video/BV1zU4y187ij/", use: "信号、仓位与退出分开复核" },
] as const;

function ema(values: number[], period: number) {
  const alpha = 2 / (period + 1);
  const result = [values[0]];
  for (let i = 1; i < values.length; i++) result.push(alpha * values[i] + (1 - alpha) * result[i - 1]);
  return result;
}

const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const round = (value: number) => Math.round(value * 1000) / 1000;
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

export function evaluateIndexSwing(input: Candle[], quote: Quote | null, today = chinaDate()) {
  const fail = (reason: string) => ({ ready: false as const, reason });
  if (!quote || quote.price <= 0 || !Number.isFinite(quote.price) || !/^\d{14}$/.test(quote.time)) return fail("缺少有效实时价格。");
  const quoteDay = `${quote.time.slice(0, 4)}-${quote.time.slice(4, 6)}-${quote.time.slice(6, 8)}`;
  const quoteAge = (Date.parse(today) - Date.parse(quoteDay)) / 86400000;
  if (!Number.isFinite(quoteAge) || quoteAge < 0 || quoteAge > 7) return fail(`报价日期 ${quoteDay} 过旧，暂停波段建议。`);
  const bars = input.filter(bar => bar.date < today).sort((a, b) => a.date.localeCompare(b.date));
  if (bars.length < 80) return fail("至少需要80根已完成日线。");
  if (bars.some((bar, i) => !validDate(bar.date) || ![bar.open, bar.close, bar.high, bar.low, bar.volume].every(Number.isFinite) ||
    Math.min(bar.open, bar.close, bar.low) <= 0 || bar.volume < 0 || bar.high < Math.max(bar.open, bar.close, bar.low) ||
    bar.low > Math.min(bar.open, bar.close) || (i > 0 && bar.date === bars[i - 1].date))) return fail("日线包含异常价格、成交量或重复日期。");
  const last = bars[bars.length - 1];
  const age = (Date.parse(today) - Date.parse(last.date)) / 86400000;
  if (age < 0 || age > 7) return fail(`最新已完成日线为 ${last.date}，请先刷新历史行情。`);
  if (last.volume === 0) return fail("最新日线成交量为零，暂停评价。");
  const closes = bars.map(bar => bar.close);
  const ma = (period: number) => average(closes.slice(-period));
  const ma5 = ma(5), ma20 = ma(20), ma60 = ma(60);
  const ema12 = ema(closes, 12), ema26 = ema(closes, 26);
  const dif = ema12.map((value, i) => value - ema26[i]);
  const dea = ema(dif, 9);
  const histogram = dif.map((value, i) => (value - dea[i]) * 2);
  const currentDif = dif[dif.length - 1], currentDea = dea[dea.length - 1];
  const currentHistogram = histogram[histogram.length - 1], previousHistogram = histogram[histogram.length - 2];
  const goldenCross = currentDif > currentDea && dif[dif.length - 2] <= dea[dea.length - 2];
  const deathCross = currentDif < currentDea && dif[dif.length - 2] >= dea[dea.length - 2];
  const rising = currentHistogram > previousHistogram;
  const macdState = goldenCross ? "金叉" : deathCross ? "死叉" : `${currentHistogram >= 0 ? "多方" : "空方"}${rising ? "增强" : "减弱"}`;
  const trueRanges = bars.slice(1).map((bar, i) => Math.max(bar.high - bar.low, Math.abs(bar.high - bars[i].close), Math.abs(bar.low - bars[i].close)));
  const atr14 = average(trueRanges.slice(-14));
  if (!Number.isFinite(atr14) || atr14 <= 0 || quote.price <= atr14 * 1.5) return fail("ATR无效或相对价格过大，暂停生成价位。");
  const changes = closes.slice(1).map((close, i) => close - closes[i]);
  const recent = changes.slice(-14);
  const gains = average(recent.map(value => Math.max(value, 0)));
  const losses = average(recent.map(value => Math.max(-value, 0)));
  const rsi14 = losses === 0 ? gains === 0 ? 50 : 100 : 100 - 100 / (1 + gains / losses);
  const previousVolume = bars.slice(-21, -1).map(bar => bar.volume);
  const volumeRatio = last.volume / average(previousVolume);
  const support20 = Math.min(...bars.slice(-20).map(bar => bar.low));
  const resistance20 = Math.max(...bars.slice(-20).map(bar => bar.high));
  const current = quote.price;
  const extensionAtr = (current - ma20) / atr14;
  const bullish = last.close > ma20 && ma20 > ma60;
  const bearish = last.close < ma20 && ma20 < ma60;
  let action: string;
  let summary: string;
  if (extensionAtr > 2) {
    action = "等待回调，不追涨";
    summary = `当前价高于MA20达 ${extensionAtr.toFixed(2)} ATR，即使趋势偏强也等待回调，不追价。`;
  } else if (bearish && currentDif < currentDea) {
    action = "空仓等待 / 减仓复核";
    summary = `收盘低于MA20且MA20低于MA60，MACD处于${macdState}，弱势与退出信号优先。`;
  } else if (current >= resistance20 * 0.998 && rsi14 >= 72) {
    action = "冲高减仓复核";
    summary = `当前价接近20日压力且RSI14为 ${rsi14.toFixed(1)}，冲高后不追加，持仓复核分批兑现。`;
  } else if ((goldenCross || (currentHistogram > 0 && rising)) && current >= ma20 && volumeRatio >= 1) {
    action = "右侧买入观察";
    summary = `MACD${macdState}，当前价位于MA20上方，量能达到20日均量，按右侧确认复核买入条件。`;
  } else if (bullish && Math.abs(extensionAtr) <= 0.6 && currentHistogram >= previousHistogram) {
    action = "回调买入观察";
    summary = `中期趋势仍强，当前价回到MA20附近且MACD未继续走弱，等待回调企稳确认。`;
  } else if (current < ma20 && currentDif < currentDea) {
    action = "空仓等待";
    summary = `当前价在MA20下方且MACD偏弱，未出现右侧确认，不猜底。`;
  } else {
    action = "持有 / 等待确认";
    summary = `趋势、MACD与量能尚未形成一致的新买入条件，已有仓位观察，未持仓等待。`;
  }
  return {
    ready: true as const, action, summary, asof: last.date, quoteTime: quote.time,
    current, changePct: quote.changePct, ma5, ma20, ma60, atr14, rsi14, volumeRatio,
    support20, resistance20, dif: currentDif, dea: currentDea, histogram: currentHistogram, macdState,
    trend: bullish ? "多头" : bearish ? "空头" : "震荡", extensionAtr,
    prices: {
      entryLow: round(current - atr14), entryHigh: round(current - atr14 * 0.5),
      breakout: round(current + atr14 * 0.5), takeProfit: round(current + atr14 * 1.5),
      stop: round(current - atr14 * 1.5),
    },
  };
}
