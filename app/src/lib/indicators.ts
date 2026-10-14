/**
 * 技术指标计算。
 *
 * 全部是纯函数：输入按时间正序排列的收盘价序列，输出等长数组，
 * 数据不足的位置填 `null`（ECharts 画线时会自动跳过）。
 *
 * 参数用业界通用默认值，和主流行情软件一致：
 * - MA：5 / 10 / 20 / 60
 * - BOLL：20，±2 倍标准差
 * - RSI：6 / 12 / 24
 * - KDJ：9, 3, 3
 * - MACD：12, 26, 9
 */

import type { Candle } from "@/types";

/** 取收盘价序列 */
export function closesOf(candles: Candle[]): number[] {
  return candles.map((c) => c.close);
}

/** 简单移动平均 */
export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** 指数移动平均，EMA 的标准递推：yesterday * (1-α) + today * α，α = 2/(n+1) */
export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length === 0) return out;
  const alpha = 2 / (period + 1);
  let prev = values[0];
  out[0] = prev;
  for (let i = 1; i < values.length; i++) {
    prev = values[i] * alpha + prev * (1 - alpha);
    out[i] = prev;
  }
  return out;
}

export interface Boll {
  mid: (number | null)[];
  upper: (number | null)[];
  lower: (number | null)[];
}

/** 布林带 */
export function boll(values: number[], period = 20, mult = 2): Boll {
  const mid = sma(values, period);
  const upper: (number | null)[] = new Array(values.length).fill(null);
  const lower: (number | null)[] = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    const m = mid[i];
    if (m === null) continue;
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = values[j] - m;
      variance += d * d;
    }
    const sd = Math.sqrt(variance / period);
    upper[i] = m + mult * sd;
    lower[i] = m - mult * sd;
  }
  return { mid, upper, lower };
}

/** 相对强弱指标，用 Wilder 平滑（和通达信/同花顺一致） */
export function rsi(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  // 前 period 个涨跌幅取简单平均作为初始值
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  gain /= period;
  loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    gain = (gain * (period - 1) + g) / period;
    loss = (loss * (period - 1) + l) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export interface Kdj {
  k: (number | null)[];
  d: (number | null)[];
  j: (number | null)[];
}

/** 随机指标 KDJ。RSV 用 n 日最高最低，K/D 用 1/3 平滑，J = 3K - 2D */
export function kdj(candles: Candle[], n = 9, m1 = 3, m2 = 3): Kdj {
  const len = candles.length;
  const k: (number | null)[] = new Array(len).fill(null);
  const d: (number | null)[] = new Array(len).fill(null);
  const j: (number | null)[] = new Array(len).fill(null);
  let prevK = 50;
  let prevD = 50;
  for (let i = 0; i < len; i++) {
    if (i < n - 1) continue;
    let hh = -Infinity;
    let ll = Infinity;
    for (let p = i - n + 1; p <= i; p++) {
      if (candles[p].high > hh) hh = candles[p].high;
      if (candles[p].low < ll) ll = candles[p].low;
    }
    // 一字板等极端情况下 hh === ll，RSV 取 50 避免除零
    const rsv = hh === ll ? 50 : ((candles[i].close - ll) / (hh - ll)) * 100;
    prevK = (prevK * (m1 - 1) + rsv) / m1;
    prevD = (prevD * (m2 - 1) + prevK) / m2;
    k[i] = prevK;
    d[i] = prevD;
    j[i] = 3 * prevK - 2 * prevD;
  }
  return { k, d, j };
}

export interface Macd {
  dif: (number | null)[];
  dea: (number | null)[];
  hist: (number | null)[];
}

/** MACD。柱状值按国内习惯放大 2 倍展示 */
export function macd(values: number[], fast = 12, slow = 26, signal = 9): Macd {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const dif: (number | null)[] = values.map((_, i) =>
    emaFast[i] !== null && emaSlow[i] !== null ? (emaFast[i] as number) - (emaSlow[i] as number) : null
  );
  // DEA 是 DIF 的 EMA，DIF 前段是 null，按有效起点重新递推
  const firstValid = dif.findIndex((v) => v !== null);
  const dea: (number | null)[] = new Array(values.length).fill(null);
  const hist: (number | null)[] = new Array(values.length).fill(null);
  if (firstValid >= 0) {
    const difSlice = dif.slice(firstValid) as number[];
    const deaSlice = ema(difSlice, signal) as number[];
    for (let i = 0; i < deaSlice.length; i++) {
      dea[firstValid + i] = deaSlice[i];
    }
    for (let i = 0; i < values.length; i++) {
      if (dif[i] !== null && dea[i] !== null) {
        hist[i] = ((dif[i] as number) - (dea[i] as number)) * 2;
      }
    }
  }
  return { dif, dea, hist };
}

/** 取最后一个非 null 值 */
export function lastOf(series: (number | null)[]): number | null {
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i] !== null) return series[i];
  }
  return null;
}

/** 把 `(number|null)[]` 转成 ECharts 能直接吃的 `[number|null][]` */
export function toPairs(dates: string[], values: (number | null)[]): [string, number | null][] {
  return dates.map((d, i) => [d, values[i]]);
}

/** 一次算齐所有指标，供图表和读数面板共用，保证两边数值永远一致 */
export interface TechBundle {
  ma5: (number | null)[];
  ma10: (number | null)[];
  ma20: (number | null)[];
  ma60: (number | null)[];
  boll: Boll;
  rsi6: (number | null)[];
  rsi12: (number | null)[];
  rsi24: (number | null)[];
  kdj: Kdj;
  macd: Macd;
}

export function computeAll(candles: Candle[]): TechBundle {
  const close = closesOf(candles);
  return {
    ma5: sma(close, 5),
    ma10: sma(close, 10),
    ma20: sma(close, 20),
    ma60: sma(close, 60),
    boll: boll(close, 20, 2),
    rsi6: rsi(close, 6),
    rsi12: rsi(close, 12),
    rsi24: rsi(close, 24),
    kdj: kdj(candles, 9, 3, 3),
    macd: macd(close, 12, 26, 9),
  };
}