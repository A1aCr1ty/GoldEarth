import type { LocalIndexRuleResult } from "@/lib/indexRuleLocal";

const pct = (value: number | null) => value === null ? "—" : `${(value * 100).toFixed(1)}%`;

export function IndexCustomBacktest({ result, error }: { result: LocalIndexRuleResult | null; error: string }) {
  if (error) return <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-destructive">本地回测失败：{error}</p>;
  if (!result) return <p className="rounded-md bg-muted/20 p-3 text-muted-foreground">等待日线完成后运行本地双策略回测…</p>;
  const { grid, oversold } = result;
  return <div className="rounded-lg border bg-muted/10 p-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><b>自定义ETF本地回测</b><span className="text-muted-foreground">{grid.start} 至 {grid.end} · 实际可用日线</span></div>
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <div className="rounded-md border bg-card p-3"><b>ATR 等分网格</b><div className="mt-2 grid grid-cols-2 gap-2"><span>收益<br /><b className={grid.total_return >= 0 ? "text-emerald-600" : "text-red-600"}>{pct(grid.total_return)}</b></span><span>最大回撤<br /><b>{pct(grid.max_drawdown)}</b></span><span>买入持有<br /><b>{pct(grid.buyhold100_return)}</b></span><span>交易 / 卖出<br /><b>{grid.trades} / {grid.sell_trades}</b></span></div><p className="mt-2 text-muted-foreground">当前仓位 {pct(grid.latest.current_weight)} · 开放 {grid.open_grids} 格 · 破位保护 {grid.protection_days} 日</p></div>
      <div className="rounded-md border bg-card p-3"><b>BIAS + W&R 超跌波段</b><div className="mt-2 grid grid-cols-2 gap-2"><span>收益<br /><b className={oversold.total_return >= 0 ? "text-emerald-600" : "text-red-600"}>{pct(oversold.total_return)}</b></span><span>最大回撤<br /><b>{pct(oversold.max_drawdown)}</b></span><span>机动回合 / 止损<br /><b>{oversold.swing_round_trips} / {oversold.stop_exits}</b></span><span>右侧追加<br /><b>{oversold.right_adds}</b></span></div><p className="mt-2 text-muted-foreground">底仓 {pct(oversold.latest.base_current_weight)} · 机动仓 {pct(oversold.latest.swing_current_weight)} · 卖出胜率 {pct(oversold.win_rate)}</p></div>
    </div>
    <p className="mt-3 leading-5 text-muted-foreground">与内置策略使用同一 Python 引擎、费用和滑点假设；结果随可用历史区间变化。回测后的模型仓位用于上方实时指示。{result.natr ? " NATR结果已同步到下方对照表和操作建议卡片。" : " 历史不足122根，暂不生成NATR对照。"}</p>
  </div>;
}
