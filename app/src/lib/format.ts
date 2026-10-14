/**
 * 复用的图表配色与格式化工具。
 *
 * 颜色约定按 A 股习惯：**红涨绿跌**，和欧美的绿涨红跌相反。
 * 这是最容易搞错的地方，改配色前先确认这一条。
 */

/** 涨 / 跌 / 平 */
export const UP = "#e5464b";
export const DOWN = "#17a86b";
export const FLAT = "#8b93a7";

export function colorOf(value: number): string {
  if (value > 0) return UP;
  if (value < 0) return DOWN;
  return FLAT;
}

/** 固定小数位，非数字显示占位符 */
export function fixed(value: number | null | undefined, digits = 2, dash = "--"): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return dash;
  return value.toFixed(digits);
}

/** 带正负号的百分比 */
export function signed(value: number | null | undefined, digits = 2, dash = "--"): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return dash;
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

/** 带正负号的数值 */
export function signedNum(value: number | null | undefined, digits = 2, dash = "--"): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return dash;
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}

/** 成交量：手 → 万手 / 亿手 */
export function volumeText(hand: number | null | undefined): string {
  if (hand === null || hand === undefined || !Number.isFinite(hand)) return "--";
  if (hand >= 1e8) return `${(hand / 1e8).toFixed(2)}亿手`;
  if (hand >= 1e4) return `${(hand / 1e4).toFixed(2)}万手`;
  return `${hand.toFixed(0)}手`;
}

/** 金额：元 → 万 / 亿 */
export function amountText(yuan: number | null | undefined): string {
  if (yuan === null || yuan === undefined || !Number.isFinite(yuan)) return "--";
  const abs = Math.abs(yuan);
  if (abs >= 1e12) return `${(yuan / 1e12).toFixed(2)}万亿`;
  if (abs >= 1e8) return `${(yuan / 1e8).toFixed(2)}亿`;
  if (abs >= 1e4) return `${(yuan / 1e4).toFixed(2)}万`;
  return yuan.toFixed(0);
}

/** 资金净额：元 → 万 / 亿，带正负号 */
export function netText(yuan: number | null | undefined): string {
  if (yuan === null || yuan === undefined || !Number.isFinite(yuan)) return "--";
  const sign = yuan > 0 ? "+" : "";
  const abs = Math.abs(yuan);
  if (abs >= 1e8) return `${sign}${(yuan / 1e8).toFixed(2)}亿`;
  if (abs >= 1e4) return `${sign}${(yuan / 1e4).toFixed(2)}万`;
  return `${sign}${yuan.toFixed(0)}`;
}

/** 把 20261014102853 变成 2026-10-14 10:28:53 */
export function quoteTime(raw: string): string {
  if (!raw || raw.length < 14) return raw || "--";
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)} ${raw.slice(8, 10)}:${raw.slice(10, 12)}:${raw.slice(12, 14)}`;
}