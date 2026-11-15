import snapshot from "@/lib/indexGridBacktest.json";

type Result = {
  period: number; step: number; start: string; end: string; total_return: number; annual_return: number;
  max_drawdown: number; trades: number; sell_trades: number; win_rate: number | null;
  buyhold50_return: number; buyhold100_return: number;
  latest: { date: string; close: number; center: number; atr: number; natr: number; current_weight: number; target_weight: number; next_buy_price: number; next_sell_price: number; next_action: string; regime: string };
};

type Item = { code: string; name: string; training: Result | null; selected: Result; grid_only: Result; baseline: Result };
const items = snapshot.items as Item[];
const pct = (value: number | null, digits = 1) => value === null ? "待积累" : `${(value * 100).toFixed(digits)}%`;

function operation(item: Item) {
  const result = item.selected;
  const plain = item.grid_only;
  const latest = result.latest;
  if (result.total_return < 0 && plain.total_return > 0) return `本次波段过滤后收益低于纯网格（${pct(result.total_return)} / ${pct(plain.total_return)}），不强行使用融合策略；目标仓位已达 ${pct(latest.target_weight, 0)}，暂停新增。`;
  if (result.total_return < 0) return `融合策略仍为 ${pct(result.total_return)}，虽较纯网格 ${pct(plain.total_return)} 有改善也不追加；等待右侧趋势恢复，目标仓位 ${pct(latest.target_weight, 0)}。`;
  if (result.max_drawdown > 0.25) return `融合策略盈利但回撤 ${pct(result.max_drawdown)}，纯网格回撤 ${pct(plain.max_drawdown)}；仅小仓执行，不追高，目标仓位 ${pct(latest.target_weight, 0)}。`;
  if (result.max_drawdown < 0.15) return `融合策略收益 ${pct(result.total_return)}、回撤 ${pct(result.max_drawdown)}，可继续小仓按档位执行；不追价，目标仓位 ${pct(latest.target_weight, 0)}。`;
  return `可保留谨慎网格，但不增加风险预算；目标仓位 ${pct(latest.target_weight, 0)}，等待下一次信号。`;
}

export function IndexGridBacktestPanel() {
  return <section className="space-y-3 rounded-lg border bg-card p-4">
    <div><h2 className="text-base font-semibold">指数网格回测与当前操作建议</h2><p className="mt-1 text-muted-foreground">训练期 {snapshot.training_window} 选参，样本外 {snapshot.test_window} 固定参数检验。快照生成于 {new Date(snapshot.generated).toLocaleString("zh-CN")}。</p></div>
    <div className="rounded-md bg-muted/30 p-3 leading-5"><p>{snapshot.model}</p><p className="mt-1 text-muted-foreground">{snapshot.execution}</p></div>
    <div className="overflow-x-auto"><table className="w-full min-w-[1200px] text-left"><thead className="border-y bg-muted/40 text-muted-foreground"><tr>{["ETF", "参数", "融合收益", "纯网格收益", "融合/纯网格回撤", "卖出胜率", "100%持有", "当前/目标仓位", "波段", "下一买入档", "下一卖出档"].map(label => <th className="px-3 py-2 font-medium" key={label}>{label}</th>)}</tr></thead><tbody>{items.map(item => {
      const result = item.selected;
      return <tr className="border-b" key={item.code}><td className="px-3 py-2"><b>{item.name}</b><div className="text-muted-foreground">{item.code}</div></td><td className="px-3 py-2">{result.period}日 / {result.step} ATR{item.training ? "" : "（默认）"}</td><td className="px-3 py-2">{pct(result.total_return)}</td><td className="px-3 py-2">{pct(item.grid_only.total_return)}</td><td className="px-3 py-2">{pct(result.max_drawdown)} / {pct(item.grid_only.max_drawdown)}</td><td className="px-3 py-2">{pct(result.win_rate)}<div className="text-muted-foreground">{result.sell_trades}次卖出</div></td><td className="px-3 py-2">{pct(result.buyhold100_return)}</td><td className="px-3 py-2">{pct(result.latest.current_weight, 0)} / {pct(result.latest.target_weight, 0)}</td><td className="px-3 py-2">{result.latest.regime === "bull" ? "多头" : result.latest.regime === "bear" ? "空头" : "震荡"}</td><td className="px-3 py-2">{result.latest.next_buy_price.toFixed(3)}</td><td className="px-3 py-2">{result.latest.next_sell_price.toFixed(3)}</td></tr>;
    })}</tbody></table></div>
    <div className="grid gap-2 lg:grid-cols-2">{items.map(item => <div className="rounded-md border p-3" key={item.code}><b>{item.name}</b><p className="mt-1 leading-5">{operation(item)}</p><p className="mt-1 text-muted-foreground">截至 {item.selected.latest.date} · NATR {item.selected.latest.natr.toFixed(2)} · 仅当目标与当前权重偏离至少5%时在下一交易日复核调仓。</p></div>)}</div>
    <p className="text-[0.6875rem] leading-5 text-muted-foreground">{snapshot.limitations} 胜率高不代表组合收益高或回撤小，当前建议优先参考样本外收益、回撤和持仓状态。</p>
    <details className="text-[0.6875rem]"><summary className="cursor-pointer">网格研究来源</summary><div className="mt-2 space-y-2">{snapshot.sources.map(source => <p key={source.url}><a className="text-primary hover:underline" href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a></p>)}</div></details>
  </section>;
}
