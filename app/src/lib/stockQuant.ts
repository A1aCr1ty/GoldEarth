import type { Candle } from "@/types";

export const QUANT_SOURCES = [
  { title: "3221 止盈手法，赚确定性的钱", url: "https://www.bilibili.com/video/BV18fjb6VEwo", status: "已核对自动字幕：00:56–02:55、03:45–04:15；比例基数未明示，建议人工确认。" },
  { title: "3570 战法实战版", url: "https://www.bilibili.com/video/BV1uUT96REz6", status: "未取得可核实字幕，暂不参与评价。" },
  { title: "底部超级爆量战法", url: "https://www.bilibili.com/video/BV1eVnA6XE2H", status: "接口字幕与主题不匹配，暂不参与评价。" },
];

export function chinaDate(now = new Date()) {
  return new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
}

/** Independent, transparent engineering baseline; not an attributed Chang formula. */
export function evaluateQuant(input: Candle[], today = chinaDate()) {
  const fail = (reason: string) => ({ ready: false as const, reason });
  const bars = input.filter(b => b.date < today).sort((a, b) => a.date.localeCompare(b.date));
  if (bars.length < 61) return fail("需要至少 61 根历史日 K；当日 K 线不参与计算。");
  if (bars.some((b, i) => !/^\d{4}-\d{2}-\d{2}$/.test(b.date) ||
    !Number.isFinite(Date.parse(b.date)) || new Date(b.date).toISOString().slice(0,10) !== b.date ||
    ![b.open,b.close,b.high,b.low,b.volume].every(Number.isFinite) ||
    Math.min(b.open,b.close,b.low) <= 0 || b.volume < 0 ||
    b.high < Math.max(b.open,b.close,b.low) || b.low > Math.min(b.open,b.close) ||
    (i > 0 && b.date === bars[i - 1].date))) return fail("日 K 包含异常价格、日期或重复记录，暂停评价。");
  const last = bars[bars.length - 1];
  const age = (Date.parse(today) - Date.parse(last.date)) / 86400000;
  if (!Number.isFinite(age) || age > 7) return fail(`最新日 K 为 ${last.date}，超过 7 天，暂停买卖参考（长假后请刷新）。`);
  if (last.volume === 0) return fail("最新日 K 成交量为零，可能停牌，暂停评价。");
  const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
  const ma = (n: number, offset = 0) => avg(bars.slice(-n - offset, offset ? -offset : undefined).map(b => b.close));
  const ma5 = ma(5), ma20 = ma(20), ma60 = ma(60);
  const volumeBase = avg(bars.slice(-21,-1).map(b => b.volume));
  if (volumeBase <= 0) return fail("历史成交量不足，暂停量价评价。");
  const volumeRatio = last.volume / volumeBase;
  const previousHigh = Math.max(...bars.slice(-21,-1).map(b => b.high));
  const bias = (last.close / ma20 - 1) * 100;
  const factors = [
    { label: "中期趋势", pass: last.close > ma20 && ma20 > ma60, weight: 30, rule: "收盘价 > MA20 > MA60" },
    { label: "趋势改善", pass: ma20 > ma(20,1), weight: 20, rule: "MA20 高于前一日 MA20" },
    { label: "短期强度", pass: last.close > ma5 && ma5 > ma20, weight: 15, rule: "收盘价 > MA5 > MA20" },
    { label: "放量突破", pass: last.close > previousHigh && volumeRatio >= 1.5, weight: 20, rule: "收盘突破此前 20 日最高价，成交量 ≥ 前 20 日均量 1.5 倍" },
    { label: "偏离控制", pass: bias >= 0 && bias <= 5, weight: 15, rule: "收盘价相对 MA20 乖离在 0%～5%" },
  ];
  const score = factors.reduce((s, f) => s + (f.pass ? f.weight : 0), 0);
  const weak = last.close < ma20 && ma5 < ma20;
  const buy = factors.every(f => f.pass);
  const recent = bars.slice(-4);
  // Conservative implementation of the source's alternative "increasing or active" volume condition.
  const threeVolume = recent.slice(1).every((b,i) => b.volume > recent[i].volume);
  const seven = bars.slice(-8);
  const giantVolume = seven.slice(1).some((b,i) => seven[i].volume > 0 && b.volume / seven[i].volume >= 1.45);
  const fiveEntry = last.close > ma5 && threeVolume && giantVolume;
  const fiveExit = last.close < ma5 * .925;
  return { ready: true as const, date: last.date, close: last.close, ma5, ma20, ma60, volumeRatio, bias, previousHigh, factors, score, threeVolume, giantVolume, fiveEntry, fiveExit,
    action: weak ? "减仓观察" : buy ? "买入候选" : bias > 5 ? "暂缓追涨" : "持有 / 等待确认",
    advice: weak ? "收盘价与 MA5 均低于 MA20。已有仓位可评估减仓；未持仓继续观望。" : buy ? "趋势、放量突破和偏离条件同时满足，可列入买入候选；下一交易日重新核对价格与成交条件。" : bias > 5 ? "价格偏离 MA20 超过 5%，暂缓新买入；已有仓位结合止盈计划管理。" : "尚未满足全部买入条件。未持仓等待；已有仓位继续观察 MA20 与止盈计划。" };
}

export type ProfitMode = "normal" | "strong";
/** Cost and price must both be actual, unadjusted prices. No trade execution or inferred holdings. */
export function evaluateProfit(price: number, cost: number, mode: ProfitMode) {
  if (![price, cost].every(n => Number.isFinite(n) && n > 0)) return null;
  const profit = Math.round(((price - cost) / cost) * 100 * 1e10) / 1e10;
  if (!Number.isFinite(profit)) return null;
  let advice: string;
  if (profit < 0) advice = "当前浮亏，止盈规则不适用；该视频未提供可直接量化的止损阈值。不要把止盈规则当作止损计划。";
  else if (mode === "strong") advice = profit < 20 ? "未到强势市场首次止盈参考点（盈利 20%）。" : "达到强势市场止盈参考区：先减仓 30%，之后每上涨 10%～15% 再减仓 20%，最终可留 10%～30% 底仓。后续涨幅与比例基数需人工确认。";
  else if (profit < 10) advice = "未到首次止盈参考区（盈利 10%～15%）。";
  else if (profit < 15) advice = "进入首次止盈区：参考减仓 30%；弱势或震荡市视频建议可兑现 30%～50%。";
  else if (profit < 30) advice = "进入第二止盈区：在首次减仓后，参考再减仓 20%，关注放量滞涨、长上影等信号。";
  else if (profit <= 50) advice = "进入阶梯退出区：分步兑现。此段未明确每一步比例，不自动补成“再卖 20%”。";
  else advice = "进入充分兑现区：参考全部退出，或中长线保留 10%～30% 底仓。";
  return { profit, advice };
}
