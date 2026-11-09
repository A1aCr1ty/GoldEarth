import { useEffect, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { Button } from '@/components/ui/button';
import { ProfitEvaluation, type Evaluation } from './ProfitEvaluation';

type Metric = { rows: number; months: number; mae: number; zero_baseline_mae: number; rank_ic: number | null; top_quintile_excess: number; first: string; last: string };
type Result = { run_id: string; created_at: string; horizon: number; mode: string; universe: number; samples: number; model_path: string; onnx_max_error: number; train: Metric; validation: Metric; test: Metric; warnings: string[]; predictions: { code: string; asof: string; excess_return: number }[] };
type Status = { busy?: boolean; price_files: number; financial_files: number; root: string; latest: Result | null; collection: { kind?: string; limit?: number; requested: number; completed: number; prices: number; financials: number; updated_at: string; failures: { code: string; kind: string; error: string }[] } | null; sources: { title: string; url: string; use: string }[] };
const pct = (n: number) => `${(n * 100).toFixed(2)}%`;

export function ValueResearch() {
  const [status, setStatus] = useState<(Status & { evaluation?: Evaluation | null; evaluation_progress?: { stage: string; candidate?: string; year?: number; completed?: number; total?: number } | null }) | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [limit, setLimit] = useState(500);
  const [horizon, setHorizon] = useState(126);
  const [mode, setMode] = useState('technical');
  const [capital, setCapital] = useState(() => localStorage.getItem('value.capital') || '');
  const [fee, setFee] = useState(() => localStorage.getItem('value.fee') || '');
  const [dataFee, setDataFee] = useState(() => localStorage.getItem('value.dataFee') || '0');
  const [drawdown, setDrawdown] = useState(() => localStorage.getItem('value.drawdown') || '');
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (!isTauri()) return;
    let active = true;
    const refresh = () => invoke<Status>('value_research_status').then(s => { if (active) setStatus(s); }).catch(e => { if (active) setError(String(e)); });
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  async function run(action: 'collect' | 'financials' | 'train' | 'evaluate', collectionLimit = limit) {
    if (action === 'evaluate' && ((capital !== '' && (!Number.isFinite(Number(capital)) || Number(capital) <= 0)) ||
      (fee !== '' && (!Number.isFinite(Number(fee)) || Number(fee) < 0)) || !Number.isFinite(Number(dataFee)) || Number(dataFee) < 0 ||
      (drawdown !== '' && (!Number.isFinite(Number(drawdown)) || Number(drawdown) <= 0 || Number(drawdown) > 100)))) {
      setError('请填写有效的正数本金、非负费用和0至100之间的回撤上限。'); return;
    }
    setBusy(true); setError('');
    try { setStatus(await invoke<Status>('value_research_run', { action, limit: collectionLimit, horizon, mode,
      capital: action !== 'evaluate' || capital === '' ? null : Number(capital),
      monthlyFee: action !== 'evaluate' ? null : (fee === '' ? 300 : Number(fee))+Number(dataFee),
      maxDrawdown: action !== 'evaluate' || drawdown === '' ? null : Number(drawdown)/100 })); }
    catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }
  const working = busy || status?.busy;
  const collection = status?.collection;
  const resumeLimit = collection && collection.kind !== 'financials_only' &&
    collection.completed > 0 && collection.completed < collection.requested
    ? collection.limit ?? (collection.requested > 1500 ? 6000 : collection.requested) : null;
  const result = status?.latest;
  const validBudget = Number(capital) > 0 && Number(fee) >= 0 && fee !== '';
  const inputClass = 'rounded border bg-background px-2 py-1 text-sm';
  return <div className="flex-1 overflow-auto p-5 space-y-5">
    <div><h2 className="font-semibold text-lg">A股长期投资研究</h2><p className="text-sm text-muted-foreground">3—12个月 · 基本面与技术面 · ONNX候选模型 · 每次训练独立留档</p></div>
    <section className="rounded-lg border p-4 space-y-3">
      <h3 className="font-medium">费用覆盖目标</h3>
      <div className="flex flex-wrap gap-3 text-sm">
        <label>研究本金（元） <input aria-label="研究本金" className={inputClass} type="number" min="1" value={capital} onChange={e => { setCapital(e.target.value); localStorage.setItem('value.capital', e.target.value); }} /></label>
        <label>每月AI费用（元） <input aria-label="每月AI费用" className={inputClass} type="number" min="0" value={fee} onChange={e => { setFee(e.target.value); localStorage.setItem('value.fee', e.target.value); }} /></label>
        <label>最大可接受回撤（%） <input aria-label="最大可接受回撤" className={inputClass} type="number" min="0" max="100" value={drawdown} onChange={e => { setDrawdown(e.target.value); localStorage.setItem('value.drawdown', e.target.value); }} /></label>
        <label>每月数据费用（元） <input aria-label="每月数据费用" className={inputClass} type="number" min="0" value={dataFee} onChange={e => { setDataFee(e.target.value); localStorage.setItem('value.dataFee', e.target.value); }} /></label>
      </div>
      <p className="text-sm">{validBudget ? `仅覆盖AI费用，每年需净赚 ${(Number(fee)*12).toFixed(0)} 元，相当于初始本金的 ${pct(Number(fee)*12/Number(capital))}；交易成本和数据费用另计。` : '填入本金和费用后计算收支平衡门槛。'}</p>
      <p className="text-xs text-muted-foreground">这是费用门槛，不是预测收益。月度盈利不稳定；长期持有期的超额收益不能当作每月现金收入。回撤上限仅记录目标，当前研究模型尚未实现组合风控或真实下单。</p>
      <p className="text-xs text-muted-foreground">未填写时，滚动评估使用10万元本金、AI及数据月费300元、最大回撤20%的研究情景。回测将逐笔扣费，再逐月检查能否覆盖服务费；已有历史复核不是独立测试。</p>
    </section>
    <section className="rounded-lg border p-4 space-y-3">
      <h3 className="font-medium">数据与训练</h3>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label>采集规模 <select className={inputClass} value={limit} onChange={e => setLimit(Number(e.target.value))}>{[50,500,1500,6000].map(n => <option key={n} value={n}>{n === 6000 ? '全部沪深股票（最多6000）' : `${n}只`}</option>)}</select></label>
        <label>持有期 <select className={inputClass} value={horizon} onChange={e => setHorizon(Number(e.target.value))}><option value={63}>约3个月 / 63交易日</option><option value={126}>约6个月 / 126交易日</option><option value={252}>约12个月 / 252交易日</option></select></label>
        <label>模型 <select className={inputClass} value={mode} onChange={e => setMode(e.target.value)}><option value="technical">技术面基线</option><option value="fused">基本面＋技术面（需历史财报版本）</option></select></label>
        <Button disabled={working || !isTauri()} onClick={() => void run('collect')}>采集 / 更新数据</Button>
        {resumeLimit !== null && <Button variant="outline" disabled={working || !isTauri()} onClick={() => void run('collect', resumeLimit)}>继续上次采集</Button>}
        <Button variant="outline" disabled={working || !isTauri() || !status?.price_files} onClick={() => void run('financials')}>补充历史财报</Button>
        <Button variant="outline" disabled={working || !isTauri()} onClick={() => void run('train')}>训练并验证ONNX</Button>
        <Button variant="outline" disabled={working || !isTauri() || mode !== 'technical'} onClick={() => void run('evaluate')}>技术面滚动训练与盈利评估</Button>
      </div>
      <p className="text-sm">行情文件 {status?.price_files ?? 0} 只 · 财报文件 {status?.financial_files ?? 0} 只（文件数量不代表有效训练覆盖）</p>
      {working && <p role="status" className="text-sm">任务运行中，界面每5秒刷新进度；全市场采集可能耗时数小时，请保持应用运行。</p>}
      {status?.evaluation_progress && <p className="text-xs">最近评估阶段：{status.evaluation_progress.stage} {status.evaluation_progress.candidate ?? ''} {status.evaluation_progress.year ?? ''} {status.evaluation_progress.total ? `${status.evaluation_progress.completed}/${status.evaluation_progress.total}` : ''}</p>}
      {status?.collection && <p className="text-xs">最近采集进度 {status.collection.completed}/{status.collection.requested} · 行情成功 {status.collection.prices} · 财报成功 {status.collection.financials} · 失败 {status.collection.failures.length} · {status.collection.updated_at}</p>}
      <p className="text-xs text-muted-foreground">采集规模只控制本次下载。新股的短历史也会保存，达到指标及持有期所需长度后才会纳入训练。自动发现沪深当前股票池，暂不包含北交所及完整退市历史。历史行情从2015年起按来源实际返回范围保存；财报请求最近200期，保留原始响应和采集时间。</p>
      <p className="text-xs text-muted-foreground">新下载的历史财报不视为历史时点版本，因此可能暂时无法训练融合模型。技术面基线包含MACD、KDJ、均线、成交量、动量和波动；融合模型增加盈利、成长、杠杆及现金流指标，尚未接入历史估值与行业专用模型。</p>
      <details className="text-xs"><summary>运行环境与数据目录</summary><p className="my-2 break-all">{status?.root || '桌面应用数据目录 / strategy/value'}</p><p>需要Python、numpy、pandas、onnx、onnxruntime；依赖清单为 value_requirements.txt。可通过 GOLDEARTH_PYTHON 指定Python解释器，设置后重启应用。</p></details>
      {!!status?.collection?.failures.length && <details className="text-xs"><summary>查看采集失败记录</summary>{status.collection.failures.slice(-30).map((f,i) => <p key={i}>{f.code} · {f.kind} · {f.error}</p>)}</details>}
      {error && <p role="alert" className="text-sm text-destructive whitespace-pre-wrap">{error}（保留上次成功结果）</p>}
    </section>
    {status?.evaluation && <ProfitEvaluation result={status.evaluation} />}
    {result && <section className="rounded-lg border p-4 space-y-3">
      <h3 className="font-medium">最近候选模型：{result.mode === 'fused' ? '基本面＋技术面' : '技术面基线'} / {result.horizon}交易日</h3>
      <p className="text-sm font-medium">{result.validation.mae < result.validation.zero_baseline_mae && (result.validation.rank_ic ?? -1) > 0 ? '验证集通过误差与排序初筛，仍需独立前瞻验证和可执行组合回测。' : '未通过验证集基线：暂不具备上线依据，保留为研究实验。'}</p>
      <p className="text-xs">{result.created_at} · {result.universe}只股票 · {result.samples}个月度样本 · ONNX最大误差 {result.onnx_max_error.toExponential(2)}</p>
      <div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead><tr><th>区间</th><th>样本 / 月份</th><th>平均绝对误差</th><th>预测零超额基线</th><th>月度排名相关</th><th>前20%持有期超额均值</th></tr></thead><tbody>{(['train','validation','test'] as const).map((key,i) => { const m = result[key]; return <tr key={key} className="border-t"><td className="py-2">{['训练','验证','测试'][i]}<div className="text-xs text-muted-foreground">{m.first}—{m.last}</div></td><td>{m.rows} / {m.months}</td><td>{pct(m.mae)}</td><td>{pct(m.zero_baseline_mae)}</td><td>{m.rank_ic?.toFixed(3) ?? '不足'}</td><td>{pct(m.top_quintile_excess)}</td></tr>; })}</tbody></table></div>
      <p className="text-xs text-muted-foreground">以上持有期存在重叠，不能相加或年化为组合收益。按时间分组，训练/验证标签结束日严格早于下一区间；仅用验证集选择正则参数。预测目标为相对沪深300的收益差，不是上涨概率。</p>
      {result.warnings.map(w => <p key={w} className="text-xs text-amber-600 dark:text-amber-400">{w}</p>)}
      <details className="text-xs"><summary>模型文件与实验版本</summary><p className="break-all">{result.model_path}</p><p>{result.run_id} · 同目录 result.json 保存特征、数据与代码摘要、参数及评估结果。</p></details>
      <label className="block text-sm">查看预测 <input className={inputClass} placeholder="输入股票代码" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <div className="max-h-72 overflow-auto"><table className="w-full text-sm text-left"><thead><tr><th>代码</th><th>数据截至</th><th>持有期预测超额收益（研究值）</th></tr></thead><tbody>{result.predictions.filter(p => p.code.includes(query)).slice(0,100).map(p => <tr key={p.code} className="border-t"><td className="py-1">{p.code}</td><td>{p.asof}</td><td>{pct(p.excess_return)}</td></tr>)}</tbody></table></div>
    </section>}
    <section className="rounded-lg border p-4 space-y-2"><h3 className="font-medium">研究资料与数据来源</h3><p className="text-xs text-muted-foreground">这些资料用于指标定义与方法核验；尚未建立书籍全文检索或语言模型微调。行情和主要财务指标通过现有腾讯 / 东方财富接口采集，官方披露用于后续核验。</p>{status?.sources.map(s => <div key={s.url} className="text-sm"><a className="underline" href={s.url} target="_blank" rel="noreferrer">{s.title}</a><p className="text-xs text-muted-foreground">{s.use}</p></div>)}</section>
  </div>;
}
