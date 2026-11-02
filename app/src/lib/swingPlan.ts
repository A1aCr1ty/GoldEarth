import type { Position } from './stockAccountImport';
export interface ForecastScore { matured: number; raw_accuracy: number | null; corrected_accuracy: number | null; raw_correct: number; corrected_correct: number; brier: number | null; raw_brier: number | null }
export interface SwingItem {
  code: string; asof: string; adjusted_close: number; ma5: number; ma20: number; atr14: number; support20: number; resistance20: number;
  technical: { signal: string; white: number; yellow: number; j: number; dif: number };
  backtest: { n: number; return?: number; maxdd?: number }; trades: { n: number; win_rate: number | null };
  forecast: { horizons: Record<string, { direction: string; probability_up?: number; reliable: boolean }>; walk_forward: Record<string, { n: number; direction_accuracy: number; baseline_accuracy: number }> };
  prediction_review: Record<string, ForecastScore>;
}
export interface SwingReview { generated: string; model: string; model_asof: string; macro: { regime: string; regime_code: number }; items: SwingItem[]; errors: { code: string; error: string }[]; note: string; prediction_note: string; validated: boolean }
export function holdingSwingPlan(position: Position, item: SwingItem | undefined, requested: number, macro: number, today = new Date().toISOString().slice(0,10)) {
  const valid = Number.isFinite(position.quantity) && position.quantity>=0 && Number.isInteger(requested) && requested>=0 && requested<=position.quantity;
  const available = position.available != null && Number.isFinite(position.available) && position.available>=0 ? position.available : null;
  const sellable = valid && available != null ? Math.floor(Math.min(requested, available, position.quantity)/100)*100 : null;
  const age=item ? (Date.parse(today)-Date.parse(item.asof))/86400000 : NaN;
  const fresh=Number.isFinite(age) && age>=0 && age<=7;
  const blocked = !valid ? '机动仓数量无效' : !item ? '等待持仓复盘' : !fresh ? '日线过期或日期无效，暂停计划触发' : available==null ? '可用股数未知，先核对账本' : requested===0 ? '请设置机动仓，保留底仓后再制定数量' : sellable===0 ? '可用机动仓不足一手' : '';
  return { valid, sellable, core:valid?position.quantity-requested:null, fresh, blocked,
    action:blocked ? '等待核对' : macro===0 || item?.technical.signal==='risk_exit' ? '优先复核减仓/停止波段' : '持有等待条件',
    buyback:'仅在机动仓卖出已实际成交并重新导入流水后，结合B1/B2、双线恢复及最新基本面复核接回；不得按未成交卖出重复买回。',
    exit:'若跌破黄线、突破次日出现3/4阴量或触及原有止损，先执行风险复核，取消接回；停牌、跌停及T+1可能无法成交。',
    takeProfit:'冲高至此前20日高点附近后，出现放量滞涨或转弱才复核机动仓卖出；突破并沿白线走强时不机械卖出底仓。',
    entry:item ? `回调至MA20 ${item.ma20.toFixed(3)} / 黄线 ${item.technical.yellow.toFixed(3)} 附近，等待缩量企稳及B1，或B2放量确认；基本面缺失、模型未验证时保持观察。` : '等待持仓日线与模型信号后确定回调观察区。' };
}
