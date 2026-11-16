import type { Candle, Quote } from "@/types";

const chinaDate = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

export interface GridModel {
  date: string;
  openGrids: number;
  maxOpenGrids?: number;
}
export interface OversoldModel {
  date: string;
  biasThreshold?: number;
  baseWeight: number;
  swingWeight: number;
  swingAverageCost: number | null;
  entryLow: number | null;
  rightAdded: boolean;
  stopPct?: number;
}
interface Preparation { ok: true; bars: Candle[]; last: Candle }
interface PreparationFailure { ok: false; reason: string }
type SignalFailure = { ready: false; reason: string };

function prepare(input: Candle[], quote: Quote | null, today: string): Preparation | PreparationFailure {
  if (!quote || !Number.isFinite(quote.price) || quote.price <= 0 || !/^\d{14}$/.test(quote.time)) return { ok: false, reason: "缺少有效实时价格，暂不生成双策略指示。" };
  const quoteDay = `${quote.time.slice(0, 4)}-${quote.time.slice(4, 6)}-${quote.time.slice(6, 8)}`;
  const quoteAge = (Date.parse(today) - Date.parse(quoteDay)) / 86400000;
  if (!Number.isFinite(quoteAge) || quoteAge < 0 || quoteAge > 7) return { ok: false, reason: `报价日期 ${quoteDay} 过旧，暂停双策略指示。` };
  const bars = input.filter(bar => bar.date < today).sort((a, b) => a.date.localeCompare(b.date));
  if (bars.length < 60) return { ok: false, reason: "至少需要60根已完成日线。" };
  if (bars.some((bar, index) => ![bar.open, bar.close, bar.high, bar.low, bar.volume].every(Number.isFinite) ||
    Math.min(bar.open, bar.close, bar.low) <= 0 || bar.volume < 0 || bar.high < Math.max(bar.open, bar.close, bar.low) ||
    bar.low > Math.min(bar.open, bar.close) || (index > 0 && bar.date <= bars[index - 1].date))) return { ok: false, reason: "日线存在异常价格、成交量或日期，暂停双策略指示。" };
  const last = bars[bars.length - 1];
  const age = (Date.parse(today) - Date.parse(last.date)) / 86400000;
  if (!Number.isFinite(age) || age < 0 || age > 7) return { ok: false, reason: `最新已完成日线为 ${last.date}，请先刷新历史行情。` };
  return { ok: true, bars, last };
}

function quantile(values: number[], ratio: number) {
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * ratio;
  const lower = Math.floor(position);
  const fraction = position - lower;
  return sorted[lower] + (sorted[Math.min(lower + 1, sorted.length - 1)] - sorted[lower]) * fraction;
}

function trueRanges(bars: Candle[]) {
  return bars.slice(1).map((bar, index) => Math.max(bar.high - bar.low, Math.abs(bar.high - bars[index].close), Math.abs(bar.low - bars[index].close)));
}

export function evaluateClassicGridSignal(input: Candle[], quote: Quote | null, model: GridModel, today = chinaDate()) {
  const prepared = prepare(input, quote, today);
  if (!prepared.ok) return { ready: false as const, reason: prepared.reason };
  if (model.date !== prepared.last.date) return { ready: false as const, reason: `网格模型仓位截至 ${model.date}，与最新日线 ${prepared.last.date} 不一致，请先更新回测。` };
  const { bars, last } = prepared;
  const current = quote!.price;
  const history = bars.slice(-250).map(bar => bar.close);
  const lower = quantile(history, 0.1);
  const upper = quantile(history, 0.9);
  const atr = average(trueRanges(bars).slice(-14));
  const stepPct = clamp(0.5 * atr / last.close, 0.02, 0.05);
  if (!(lower > 0 && upper > lower && stepPct > 0)) return { ready: false as const, reason: "当前网格边界或 ATR 无效。" };
  const count = Math.max(2, Math.min(50, Math.ceil(Math.log(upper / lower) / Math.log1p(stepPct))));
  const levels = Array.from({ length: count + 1 }, (_, index) => lower * (1 + stepPct) ** index);
  const levelOf = (price: number) => clamp(levels.filter(level => level <= price).length - 1, 0, count);
  const previousLevel = levelOf(last.close);
  const currentLevel = levelOf(current);
  const maxOpen = model.maxOpenGrids ?? 10;
  const belowLower = current < lower;
  let action = "持有等待，未跨越新网格";
  let kind = "hold";
  let summary = `当前位于第 ${currentLevel} 格，上一收盘位于第 ${previousLevel} 格。`;
  if (belowLower) {
    action = "跌破网格下限，停止新增仓位";
    kind = "stop";
    summary = `当前价低于滚动下限 ${lower.toFixed(3)}，破位保护生效，不继续摊低成本。`;
  } else if (currentLevel < previousLevel) {
    const available = Math.max(0, maxOpen - model.openGrids);
    const grids = Math.min(previousLevel - currentLevel, available);
    if (grids > 0) {
      action = `买入复核 ${grids} 格，等分每格约 1 万元`;
      kind = "buy";
      summary = `当前价向下跨越 ${previousLevel - currentLevel} 格，模型还可开 ${available} 格；按下一交易日价格和实际可用资金复核。`;
    } else {
      action = "达到最大开放格数，暂停加仓";
      kind = "stop";
      summary = `模型已有 ${model.openGrids} 个开放格，达到 ${maxOpen} 格上限，即使价格下跌也不新增。`;
    }
  } else if (currentLevel > previousLevel && model.openGrids > 0) {
    const grids = Math.min(currentLevel - previousLevel, model.openGrids);
    action = `卖出复核 ${grids} 个网格批次`;
    kind = "sell";
    summary = `当前价向上跨越 ${currentLevel - previousLevel} 格；按模型批次先进先出复核，实际成交以账户持仓为准。`;
  }
  return {
    ready: true as const, action, kind, summary, current, lower, upper, atr, stepPct,
    currentLevel, previousLevel, openGrids: model.openGrids,
    nextBuy: levels[Math.max(0, currentLevel - 1)], nextSell: levels[Math.min(count, currentLevel + 1)],
    modelDate: model.date,
  };
}

function williams(bars: Candle[]) {
  const highest = Math.max(...bars.map(bar => bar.high));
  const lowest = Math.min(...bars.map(bar => bar.low));
  const close = bars[bars.length - 1].close;
  return highest > lowest ? (highest - close) / (highest - lowest) * 100 : 50;
}

function currentSupertrend(bars: Candle[], period = 10, multiplier = 3) {
  const tr = trueRanges(bars);
  const atr = bars.map((_, index) => index >= period ? average(tr.slice(index - period, index)) : NaN);
  let finalUpper = NaN;
  let finalLower = NaN;
  let trend = NaN;
  for (let i = 1; i < bars.length; i++) {
    if (!Number.isFinite(atr[i])) continue;
    const middle = (bars[i].high + bars[i].low) / 2;
    const basicUpper = middle + multiplier * atr[i];
    const basicLower = middle - multiplier * atr[i];
    if (!Number.isFinite(atr[i - 1])) {
      finalUpper = basicUpper;
      finalLower = basicLower;
      trend = finalUpper;
      continue;
    }
    const previousUpper = finalUpper;
    const previousLower = finalLower;
    finalUpper = basicUpper < previousUpper || bars[i - 1].close > previousUpper ? basicUpper : previousUpper;
    finalLower = basicLower > previousLower || bars[i - 1].close < previousLower ? basicLower : previousLower;
    if (trend === previousUpper) trend = bars[i].close > finalLower ? finalLower : finalUpper;
    else trend = bars[i].close < finalUpper ? finalUpper : finalLower;
  }
  return trend;
}

export interface OversoldMetrics {
  current: number;
  bias20: number;
  wr14: number;
  previousWr14: number;
  cmf20: number;
  ma20: number;
  supertrend: number;
  pricePercentile: number | null;
  volumeRatio: number;
}
export interface OversoldAction {
  action: string;
  kind: string;
  summary: string;
  baseAction: string | null;
  stopPrice: number | null;
}

export function oversoldAction(metrics: OversoldMetrics, model: OversoldModel): OversoldAction {
  const threshold = model.biasThreshold ?? -6;
  const stopPct = model.stopPct ?? 0.06;
  const stopPrice = model.swingAverageCost === null ? null : model.swingAverageCost * (1 - stopPct);
  const baseAction = model.baseWeight < 0.01 && metrics.pricePercentile !== null && metrics.pricePercentile <= 0.15
    ? `价格分位 ${(metrics.pricePercentile * 100).toFixed(1)}% ≤ 15%，下一交易日复核建立60%底仓（非估值分位）` : null;
  if (model.swingWeight > 0) {
    if (stopPrice !== null && metrics.current <= stopPrice) return {
      action: "触发6%硬止损，复核退出机动仓", kind: "stop", baseAction, stopPrice,
      summary: `当前价 ${metrics.current.toFixed(3)} 不高于成本止损价 ${stopPrice.toFixed(3)}；止损优先于其他信号，底仓不在此操作中。`,
    };
    if (model.entryLow !== null && metrics.current < model.entryLow && metrics.volumeRatio >= 1.5) return {
      action: "放量跌破买入前低，复核退出机动仓", kind: "stop", baseAction, stopPrice,
      summary: `当前价低于前低 ${model.entryLow.toFixed(3)}，且当前量达到20日均量 ${metrics.volumeRatio.toFixed(2)} 倍；底仓不在此操作中。`,
    };
    if (metrics.wr14 < 20 || metrics.bias20 > 5) return {
      action: "指标修复至退出区，下一交易日复核止盈", kind: "sell", baseAction, stopPrice,
      summary: `W&R14 ${metrics.wr14.toFixed(2)}、BIAS20 ${metrics.bias20.toFixed(2)}%，满足 W&R<20 或 BIAS>5 的机动仓退出条件。`,
    };
    if (!model.rightAdded && metrics.current > metrics.ma20 && metrics.cmf20 > 0 && metrics.current > metrics.supertrend) return {
      action: "右侧门禁通过，下一交易日复核追加20%", kind: "add", baseAction, stopPrice,
      summary: `价格站上MA20与SuperTrend，CMF20 ${metrics.cmf20.toFixed(3)} > 0；仅追加尚未使用的机动额度。`,
    };
    return {
      action: "持有机动仓，等待退出或追加条件", kind: "hold", baseAction, stopPrice,
      summary: `当前未触发止损、超买退出或首次右侧追加；持续复核前低与成本止损。`,
    };
  }
  if (metrics.bias20 < threshold && metrics.wr14 > 85 && metrics.wr14 < metrics.previousWr14) return {
    action: "双指标共振，下一交易日复核买入20%机动仓", kind: "buy", baseAction, stopPrice,
    summary: `BIAS20 ${metrics.bias20.toFixed(2)}% < ${threshold}%，W&R14 ${metrics.wr14.toFixed(2)} > 85 且较前一收盘拐头向下。`,
  };
  return {
    action: "等待超跌共振，不猜底", kind: "wait", baseAction, stopPrice,
    summary: `需同时满足 BIAS20<${threshold}%、W&R14>85且拐头向下；当前未形成完整组合。`,
  };
}

export function evaluateOversoldSignal(input: Candle[], quote: Quote | null, model: OversoldModel, today = chinaDate()) {
  const prepared = prepare(input, quote, today);
  if (!prepared.ok) return { ready: false as const, reason: prepared.reason };
  if (model.date !== prepared.last.date) return { ready: false as const, reason: `超跌模型仓位截至 ${model.date}，与最新日线 ${prepared.last.date} 不一致，请先更新回测。` };
  const { bars, last } = prepared;
  const current = quote!.price;
  const high = Math.max(current, quote!.high > 0 ? quote!.high : current);
  const low = Math.min(current, quote!.low > 0 ? quote!.low : current);
  if (!Number.isFinite(quote!.volume) || quote!.volume < 0) return { ready: false as const, reason: "实时成交量无效，暂停超跌指示。" };
  const change = current - last.close;
  const currentBar: Candle = {
    date: today, open: quote!.open > 0 ? quote!.open : current, close: current, high, low,
    volume: quote!.volume, amount: current * quote!.volume,
    amplitude: (high - low) / last.close * 100, changePct: change / last.close * 100, change, turnover: 0,
  };
  const ma20 = average([...bars.slice(-19).map(bar => bar.close), current]);
  const bias20 = (current / ma20 - 1) * 100;
  const previousWr14 = williams(bars.slice(-14));
  const wr14 = williams([...bars.slice(-13), currentBar]);
  const cmfBars = [...bars.slice(-19), currentBar];
  const volume = cmfBars.reduce((sum, bar) => sum + bar.volume, 0);
  const moneyVolume = cmfBars.reduce((sum, bar) => sum + (bar.high > bar.low ? ((bar.close - bar.low) - (bar.high - bar.close)) / (bar.high - bar.low) * bar.volume : 0), 0);
  const cmf20 = volume > 0 ? moneyVolume / volume : 0;
  const allBars = [...bars, currentBar];
  const supertrend = currentSupertrend(allBars);
  const percentileHistory = bars.slice(-1250).map(bar => bar.close);
  const pricePercentile = percentileHistory.length >= 250 ? percentileHistory.filter(value => value <= last.close).length / percentileHistory.length : null;
  const previousVolume = average(bars.slice(-20).map(bar => bar.volume));
  const metrics: OversoldMetrics = { current, bias20, wr14, previousWr14, cmf20, ma20, supertrend, pricePercentile, volumeRatio: previousVolume > 0 ? quote!.volume / previousVolume : 0 };
  return { ready: true as const, ...oversoldAction(metrics, model), ...metrics, modelDate: model.date };
}
