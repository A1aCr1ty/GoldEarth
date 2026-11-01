import type { Quote } from "@/types";
import { positionMarketValue, type Position } from "./stockAccountImport";

export function accountQuoteCode(code: string): string | null {
  const clean = code.trim().toLowerCase().replace(/[.\s]/g, "");
  if (/^(sh|sz|bj)\d{6}$/.test(clean)) return clean;
  if (!/^\d{6}$/.test(clean)) return null;
  return `${/^(4|8|92)/.test(clean) ? "bj" : /^[569]/.test(clean) ? "sh" : "sz"}${clean}`;
}

export interface AccountMarketPosition extends Position {
  priceSource: "market" | "import";
  quoteTime?: string;
}

export function valueAccountPositions(positions: Position[], quotes: Record<string, Quote>): AccountMarketPosition[] {
  return positions.map((position) => {
    const key = accountQuoteCode(position.code);
    const quote = key ? quotes[key] : undefined;
    if (!quote || !Number.isFinite(quote.price) || quote.price <= 0) return { ...position, priceSource: "import" };
    const marketValue = quote.price * position.quantity;
    const baseValue = positionMarketValue(position);
    // 账本盈亏可能计入手续费/分红。用市值变动更新账本基数，保留其原始口径。
    const profit = position.profit != null && baseValue != null
      ? position.profit + marketValue - baseValue
      : position.cost == null ? null : (quote.price - position.cost) * position.quantity;
    return { ...position, price: quote.price, marketValue, profit, priceSource: "market", quoteTime: quote.time };
  });
}

export function accountQuoteTime(time?: string) {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(time ?? "");
  return match ? `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}:${match[6]}` : time || "时间未知";
}
