import type { StrategySnapshot } from './strategyPlatform';
import { fusionOf } from './fusionStrategy';
export function strategyAdvice(snapshot: StrategySnapshot | null, code: string, quantity: number, today = new Date().toISOString().slice(0,10)): { action: 'wait' | 'reduce' | 'hold' | 'buy'; summary: string; asof?: string } {
  const a = snapshot?.adaptive;
  const fusion = fusionOf(a);
  const combined = fusion?.operations.find(s => s.code === code.replace(/^(sh|sz|bj)/, ''));
  if (fusion && combined) {
    const age = (Date.parse(today)-Date.parse(combined.asof))/86400000;
    const detail = `大盘${fusion.macro.regime}；Z哥${combined.technical.signal}（J ${combined.technical.j}、DIF ${combined.technical.dif}）；基本面${combined.fundamental.status === 'unknown' ? '待核实' : combined.fundamental.status === 'pass' ? '通过' : '未通过'}`;
    // The combined model has not passed a point-in-time financial backtest.
    if (!Number.isFinite(age) || age<0 || age>7 || !fusion.validated || combined.fundamental.status !== 'pass' || combined.action !== 'buy_candidate') return {action:'wait' as const,summary:`${detail}。组合待验证或条件不齐，观望${combined.action==='reduce' && quantity>0 ? '，优先复核减仓及原止损' : ''}`,asof:combined.asof};
  }
  const signal = a?.operations?.find(s => s.code === code.replace(/^(sh|sz|bj)/, ''));
  if (!signal || signal.target == null) return { action: 'wait' as const, summary: '策略未覆盖，等待复盘', asof: signal?.asof };
  const age = (Date.parse(today) - Date.parse(signal.asof)) / 86400000;
  const gate = a!.validation_gate;
  if (age < 0 || age > 7 || !gate.sample_out_profitable || !gate.positive_excess || !gate.risk_adjusted_improvement)
    return { action: 'wait' as const, summary: '数据过期或样本外验证未通过，观望', asof: signal.asof };
  const action = signal.target === 0 ? (quantity > 0 ? 'reduce' : 'wait') : quantity > 0 ? 'hold' : 'buy';
  return { action, summary: `${a!.selected.name}：${signal.target === 0 ? '模型空仓' : `模型暴露${(signal.target*100).toFixed(0)}%`}；账户数量及风险预算需另核对`, asof: signal.asof };
}
