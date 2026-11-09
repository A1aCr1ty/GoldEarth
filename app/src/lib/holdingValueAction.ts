import { positionMarketValue } from "./stockAccountImport";
import type { AccountMarketPosition } from "./stockAccountMarket";

export function holdingValueAction({ holding, total, cap, rank, metrics, modelFresh, sameDayQuotes }: {
  holding: AccountMarketPosition;
  total: number | null;
  cap: number | null;
  rank: number | null;
  metrics?: { ma120: number; momentum126: number; macd_hist: number };
  modelFresh: boolean;
  sameDayQuotes: boolean;
}) {
  const value = positionMarketValue(holding);
  if (cap !== null && sameDayQuotes && total !== null && total > 0 && value !== null && value > total * cap) {
    if (value >= total) return {
      action: "先处理单股集中",
      reason: "账户股票市值集中在这一只。若卖出资金留作现金，部分卖出后它仍占剩余股票市值的 100%。先明确是否按总资产设置上限，或是否补充分散持仓。",
    };
    // Cash from the sale is outside the stock-value denominator.
    const trimValue = (value - cap * total) / (1 - cap);
    const code = holding.code.toLowerCase().replace(/^(sh|sz)[.\s]?|[.\s]?(sh|sz)$/g, "");
    const standardLot = /^(60|00|30)\d{4}$/.test(code);
    const price = holding.price;
    const available = holding.available;
    const canSize = standardLot && price !== null && price > 0 && available !== null && Number.isFinite(available);
    const target = canSize ? Math.ceil(trimValue / price / 100) * 100 : null;
    // Keep sizing within ordinary whole lots and the recorded sellable position.
    const maxPartial = Math.floor(Math.min(available ?? 0, holding.quantity - 1) / 100) * 100;
    const shares = target !== null ? Math.min(target, maxPartial) : 0;
    const sizing = shares > 0
      ? `按当前报价，首批可参考 ${shares} 股。${shares < (target ?? 0) ? "单批无法降到上限，成交后再核算。" : "成交后复算实际占比。"}`
      : "下单前先核对券商可卖股数、申报单位和实时报价，再确定数量。";
    return {
      action: "考虑分批减仓至上限",
      reason: `持仓已超过你设定的上限。按卖出资金留作现金估算，需减少约 ${Math.round(trimValue).toLocaleString("zh-CN")} 元股票市值。${sizing}`,
    };
  }
  if (!modelFresh || rank === null || !metrics) return {
    action: "暂缓模型交易，先核对数据",
    reason: "更新持仓和长期研究结果，确认股票有完整评分及指标后再判断。已有的止损或仓位约束按你的计划复核。",
  };
  if (rank > .8 && metrics.ma120 < 0 && metrics.momentum126 < 0) return {
    action: "停止补仓，评估分批减仓",
    reason: "排名落在后 20%，且收盘低于 120 日均线、半年动量为负。下一次周度复核仍同时满足这三项时，结合原交易计划及券商可卖数量评估减仓；若先触及已设止损，按原计划复核。",
  };
  if (rank <= .2 && metrics.ma120 > 0 && metrics.momentum126 > 0 && metrics.macd_hist > 0) return {
    action: "维持持仓，列入加仓观察",
    reason: "排名在前 20%，中期趋势与近期动能同向。下次周度复核仍满足这些条件、财报和公告已核对、加仓后未超预算，再评估是否加仓。",
  };
  return {
    action: "维持持仓，等待信号一致",
    reason: "下一次周度复核，若进入后 20%且半年动量为负、收盘低于 120 日均线，评估减仓；若进入前 20%且站上均线、半年动量和 MACD 柱均为正，才列入加仓观察。",
  };
}
