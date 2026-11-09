type Month = { month: string; closing_equity: number; net_profit: number; net_return: number; trading_cost: number; service_fee: number; covered: boolean; partial?: boolean };
type Performance = { net_profit: number; cagr: number; max_drawdown: number; coverage_rate: number | null; longest_uncovered_months: number; trading_cost: number; service_fees: number; trade_count: number; slippage: number; monthly: Month[] };
export type ValuePrediction = {
  code: string; score: number; asof: string;
  analysis?: {
    metrics: Record<"momentum126" | "ma120" | "macd_hist" | "kdj_k" | "volume_ratio" | "volatility63" | "drawdown252", number>;
    impacts: Record<"trend" | "momentum" | "oscillators" | "volume" | "risk", number>;
    levels?: { reference_close: number; ma120_next: number; momentum126_next: number; macd_next: number };
  };
};
export type Evaluation = { run_id: string; created_at: string; horizon: number; capital: number; monthly_fee: number; max_drawdown_limit: number; candidates: Record<string,{development:Performance;review:Performance}>; chosen: string; chosen_qualified: boolean; samples: number; mature_samples: number; universe: number; stress: Performance[]; scenarios: {capital:number;monthly_fee:number;net_profit:number;max_drawdown:number;coverage_rate:number|null;insolvent:boolean}[]; gates: Record<string,boolean>; bootstrap: {mean_monthly_95pct:number[];note:string}|null; model_path:string; onnx_max_error:number; warnings:string[]; predictions?: ValuePrediction[]; latest_market_date?: string };
const percent=(x:number|null)=>x===null?'不足':`${(x*100).toFixed(2)}%`;
const money=(x:number)=>x.toLocaleString('zh-CN',{maximumFractionDigits:0});
const names:Record<string,string>={ridge:'原特征线性模型',rank_ridge:'横截面排序线性模型',hist_rank:'非线性排序模型',momentum:'简单动量',low_volatility:'简单低波动',hs300:'沪深300价格指数代理'};
Object.assign(names,{ridge_risk:'线性模型＋仓位控制',rank_ridge_risk:'排序线性＋仓位控制',hist_rank_risk:'非线性排序＋仓位控制'});
export const valueModelName = (key: string) => names[key] ?? key;
const gates:Record<string,string>={development_qualified:'开发期盈利且回撤达标',review_months:'至少24个完整复核月',positive_net:'复核期扣费后盈利',beats_simple:'超过简单策略基线',within_drawdown:'回撤不超过情景上限',double_slippage_positive:'双倍滑点仍盈利',covers_60pct_months:'至少60%月份覆盖费用',profit_twice_service:'净利润超过服务费两倍',audited_execution_data:'完整交易数据核验',independent_forward_validation:'独立前瞻模拟验证'};

export function ProfitEvaluation({result}:{result:Evaluation}) {
  const chosen=result.candidates[result.chosen];
  return <section className="rounded-lg border p-4 space-y-3">
    <h3 className="font-medium">盈利效果评估 · {result.horizon}日预测 / 月度调仓</h3>
    <p className="text-sm">研究情景：本金 {money(result.capital)} 元 · AI及数据月费 {money(result.monthly_fee)} 元 · 回撤上限 {percent(result.max_drawdown_limit)}。这是模拟参数，不代表你的实际账户。</p>
    <p className="text-xs text-muted-foreground">{result.universe}只股票 · 周度及月末观察 {result.samples.toLocaleString()} 条 · 已成熟标签 {result.mature_samples.toLocaleString()} 条。样本重叠，不等于独立观察数量。</p>
    <p className="text-sm font-medium">{result.chosen_qualified ? `按开发期筛出的研究候选：${names[result.chosen]}。` : `本轮没有模型通过开发期门槛；${names[result.chosen]}仅保留作诊断。`} 未开放自动实盘。</p>
    <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr><th>模型 / 简单基线</th><th>开发期净利润</th><th>复核期净利润</th><th>复核年化</th><th>最大回撤</th><th>费用覆盖月份</th><th>最长未覆盖</th></tr></thead><tbody>{Object.entries(result.candidates).map(([key,r])=><tr className="border-t" key={key}><td className="py-2">{names[key]||key}{key===result.chosen?'（诊断候选）':''}</td><td>{money(r.development.net_profit)}元</td><td>{money(r.review.net_profit)}元</td><td>{percent(r.review.cagr)}</td><td>{percent(r.review.max_drawdown)}</td><td>{percent(r.review.coverage_rate)}</td><td>{r.review.longest_uncovered_months}个月</td></tr>)}</tbody></table></div>
    <p className="text-xs text-muted-foreground">开发期2020—2023年；2024年后为已经查看过的历史复核期，不能称为独立测试。候选按开发期选择；所有组合均扣同样月费。收益包含浮动盈亏，不等于每月已实现现金收入。</p>
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{Object.entries(result.gates).map(([key,pass])=><p className={`text-xs rounded border p-2 ${pass?'text-emerald-700 dark:text-emerald-400':'text-amber-700 dark:text-amber-400'}`} key={key}>{pass?'通过':'未通过'} · {gates[key]||key}</p>)}</div>
    <p className="text-xs">诊断候选复核期：交易成本 {money(chosen.review.trading_cost)} 元 · 服务费 {money(chosen.review.service_fees)} 元 · {chosen.review.trade_count}笔交易。</p>
    {result.bootstrap&&<p className="text-xs">6个月区块重采样：平均月净收益区间 {result.bootstrap.mean_monthly_95pct.map(percent).join(' 至 ')}。{result.bootstrap.note}</p>}
    <details><summary className="text-sm cursor-pointer">滑点压力与本金 / 费用敏感性</summary><div className="mt-2 space-y-2 text-xs">{result.stress.map(r=><p key={r.slippage}>单边滑点 {percent(r.slippage)}：净利润 {money(r.net_profit)} 元，回撤 {percent(r.max_drawdown)}，费用覆盖 {percent(r.coverage_rate)}。</p>)}<table className="w-full text-left"><thead><tr><th>本金</th><th>月费</th><th>净利润</th><th>最大回撤</th><th>覆盖月份</th></tr></thead><tbody>{result.scenarios.map(r=><tr className="border-t" key={`${r.capital}-${r.monthly_fee}`}><td className="py-1">{money(r.capital)}</td><td>{money(r.monthly_fee)}</td><td>{money(r.net_profit)}{r.insolvent?'（资不抵债）':''}</td><td>{percent(r.max_drawdown)}</td><td>{percent(r.coverage_rate)}</td></tr>)}</tbody></table></div></details>
    <details><summary className="text-sm cursor-pointer">诊断候选逐月扣费账本</summary><div className="mt-2 max-h-80 overflow-auto"><table className="w-full text-left text-xs"><thead><tr><th>月份</th><th>期末权益</th><th>净盈亏</th><th>交易费</th><th>AI及数据费</th><th>覆盖费用</th></tr></thead><tbody>{chosen.review.monthly.map(m=><tr className="border-t" key={m.month}><td className="py-1">{m.month}{m.partial?'（末月未完成）':''}</td><td>{money(m.closing_equity)}</td><td>{money(m.net_profit)}</td><td>{money(m.trading_cost)}</td><td>{money(m.service_fee)}</td><td>{m.partial?'不计成功率':m.covered?'是':'否'}</td></tr>)}</tbody></table></div></details>
    {result.warnings.map(w=><p className="text-xs text-muted-foreground" key={w}>{w}</p>)}
    <details className="text-xs"><summary>实验与模型文件</summary><p>{result.run_id} · {result.created_at}</p><p className="break-all">{result.model_path}</p><p>ONNX推理最大误差 {result.onnx_max_error.toExponential(2)}。同目录保留各候选逐笔交易、每日权益和滚动预测文件。</p></details>
  </section>;
}
