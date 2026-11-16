import snapshot from "@/lib/indexRuleBacktest.json";

type CommonResult = {
  start: string; end: string; total_return: number; annual_return: number; max_drawdown: number;
  trades: number; sell_trades: number; win_rate: number | null; buyhold100_return: number;
};
type GridResult = CommonResult & {
  open_grids: number; retained_shares: number; protection_days: number;
  latest: { date: string; close: number; lower: number; upper: number; step_pct: number; current_weight: number; next_buy_price: number; next_sell_price: number; next_action: string; break_protection: boolean };
};
type OversoldResult = CommonResult & {
  right_adds: number; stop_exits: number; swing_round_trips: number;
  latest: { date: string; bias20: number; wr14: number; cmf20: number; price_percentile: number | null; base_current_weight: number; swing_current_weight: number; next_action: string };
};
type Item = { code: string; name: string; grid: GridResult; grid_pyramid: GridResult; grid_profit: GridResult; oversold: OversoldResult };

const items = snapshot.items as Item[];
const pct = (value: number | null, digits = 1) => value === null ? "—" : `${(value * 100).toFixed(digits)}%`;
const number = (value: number | null, digits = 2) => value === null || !Number.isFinite(value) ? "—" : value.toFixed(digits);

function ReturnText({ value }: { value: number }) {
  return <span className={value >= 0 ? "font-semibold text-emerald-600" : "font-semibold text-red-600"}>{pct(value)}</span>;
}

function swingState(result: OversoldResult) {
  if (result.latest.next_action === "buy_swing_next_open") return "双指标共振，下一交易日复核";
  if (result.latest.next_action === "hold_swing") return "机动仓持有中";
  if (result.swing_round_trips === 0) return "本区间未触发机动仓";
  return "等待双指标共振";
}

export function IndexRuleBacktestPanel() {
  return <section className="space-y-4 rounded-lg border bg-card p-4">
    <div>
      <h2 className="text-base font-semibold">指数网格 + 超跌波段规则回测</h2>
      <p className="mt-1 text-muted-foreground">固定规则从 {snapshot.test_start} 起检验至各 ETF 最新日线，不针对历史收益重新调参。快照 {new Date(snapshot.generated).toLocaleString("zh-CN")}。</p>
    </div>
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="rounded-md bg-muted/30 p-3 leading-5"><b>ATR 自适应价格网格</b><p className="mt-1 text-muted-foreground">{snapshot.grid_model}</p></div>
      <div className="rounded-md bg-muted/30 p-3 leading-5"><b>BIAS + W&R 超跌分仓波段</b><p className="mt-1 text-muted-foreground">{snapshot.swing_model}</p></div>
    </div>
    <p className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 leading-5 text-amber-700 dark:text-amber-400">{snapshot.limitations}</p>

    <div className="space-y-2">
      <div><h3 className="text-sm font-semibold">网格历史结果</h3><p className="text-muted-foreground">等分是主规则；金字塔与留利润只作同区间对照，不自动选择收益最高者。</p></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[1250px] text-left"><thead className="border-y bg-muted/40 text-muted-foreground"><tr>{["ETF", "等分收益", "最大回撤", "100%持有", "金字塔 / 留利润", "交易 / 卖出", "最新步长", "当前仓位", "网格边界", "破位保护", "下一买 / 卖档"].map(label => <th className="px-3 py-2 font-medium" key={label}>{label}</th>)}</tr></thead><tbody>{items.map(item => {
        const grid = item.grid;
        return <tr className="border-b" key={item.code}>
          <td className="px-3 py-2"><b>{item.name}</b><div className="text-muted-foreground">{item.code} · {grid.start} 起</div></td>
          <td className="px-3 py-2"><ReturnText value={grid.total_return} /></td>
          <td className="px-3 py-2">{pct(grid.max_drawdown)}</td>
          <td className="px-3 py-2"><ReturnText value={grid.buyhold100_return} /></td>
          <td className="px-3 py-2">{pct(item.grid_pyramid.total_return)} / {pct(item.grid_profit.total_return)}<div className="text-muted-foreground">留利润份额 {item.grid_profit.retained_shares}</div></td>
          <td className="px-3 py-2">{grid.trades} / {grid.sell_trades}<div className="text-muted-foreground">卖出胜率 {pct(grid.win_rate)}</div></td>
          <td className="px-3 py-2">{pct(grid.latest.step_pct)}<div className="text-muted-foreground">ATR 自适应</div></td>
          <td className="px-3 py-2">{pct(grid.latest.current_weight, 0)}<div className="text-muted-foreground">开放 {grid.open_grids} 格</div></td>
          <td className="px-3 py-2">{number(grid.latest.lower, 3)} – {number(grid.latest.upper, 3)}<div className="text-muted-foreground">{grid.latest.date}</div></td>
          <td className="px-3 py-2">{grid.latest.break_protection ? <span className="font-semibold text-amber-600">停止新增</span> : "未触发"}<div className="text-muted-foreground">累计 {grid.protection_days} 日</div></td>
          <td className="px-3 py-2">{number(grid.latest.next_buy_price, 3)} / {number(grid.latest.next_sell_price, 3)}</td>
        </tr>;
      })}</tbody></table></div>
    </div>

    <div className="space-y-2">
      <div><h3 className="text-sm font-semibold">超跌波段历史结果</h3><p className="text-muted-foreground">收益包含 60% 底仓、机动仓和现金；底仓使用价格分位代理，并非估值分位。</p></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[1250px] text-left"><thead className="border-y bg-muted/40 text-muted-foreground"><tr>{["ETF", "策略收益", "最大回撤", "100%持有", "机动回合", "止损 / 右侧追加", "底仓 / 机动仓", "BIAS20", "W&R14", "CMF20", "截至日期与规则状态"].map(label => <th className="px-3 py-2 font-medium" key={label}>{label}</th>)}</tr></thead><tbody>{items.map(item => {
        const result = item.oversold;
        return <tr className="border-b" key={item.code}>
          <td className="px-3 py-2"><b>{item.name}</b><div className="text-muted-foreground">{item.code} · {result.start} 起</div></td>
          <td className="px-3 py-2"><ReturnText value={result.total_return} /></td>
          <td className="px-3 py-2">{pct(result.max_drawdown)}</td>
          <td className="px-3 py-2"><ReturnText value={result.buyhold100_return} /></td>
          <td className="px-3 py-2">{result.swing_round_trips}<div className="text-muted-foreground">卖出胜率 {pct(result.win_rate)}</div></td>
          <td className="px-3 py-2">{result.stop_exits} / {result.right_adds}</td>
          <td className="px-3 py-2">{pct(result.latest.base_current_weight, 0)} / {pct(result.latest.swing_current_weight, 0)}</td>
          <td className="px-3 py-2">{number(result.latest.bias20)}%</td>
          <td className="px-3 py-2">{number(result.latest.wr14)}</td>
          <td className="px-3 py-2">{number(result.latest.cmf20, 3)}</td>
          <td className="px-3 py-2">{result.latest.date}<div className="text-muted-foreground">{swingState(result)}</div></td>
        </tr>;
      })}</tbody></table></div>
    </div>
    <p className="text-[0.6875rem] leading-5 text-muted-foreground">{snapshot.execution} 负收益或高回撤结果只说明该固定规则在本区间表现，不构成继续加仓或实盘启用建议。</p>
  </section>;
}
