import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { tauri } from '@/lib/tauri';
import type { StockAccount } from '@/lib/stockAccountImport';
import { holdingSwingPlan, type SwingReview } from '@/lib/swingPlan';
const pct=(v:number|null|undefined)=>v==null?'待积累':`${(v*100).toFixed(2)}%`;
const num=(v:number)=>Number.isFinite(v)?v.toFixed(3):'—';
const pendingReviews=new Map<string,Promise<SwingReview>>();
function requestReview(codes:string[]) {
  const id=[...codes].sort().join(',');
  const pending=pendingReviews.get(id);
  if(pending)return pending;
  const run=tauri.stockSwingReview(codes);
  pendingReviews.set(id,run);
  void run.then(()=>pendingReviews.delete(id),()=>pendingReviews.delete(id));
  return run;
}
export function HoldingSwingPanel({account}:{account:StockAccount}) {
  const key=`goldearth.holding-swing.v1.${account.id}`;
  const [sizes,setSizes]=useState<Record<string,number>>(()=>{try{return JSON.parse(localStorage.getItem(key+'.sizes')||'{}')??{}}catch{return {}}});
  const [review,setReview]=useState<SwingReview|null>(()=>{try{const value=JSON.parse(localStorage.getItem(key+'.review')||'null');return Array.isArray(value?.items)?value:null}catch{return null}});
  const [busy,setBusy]=useState(false); const [error,setError]=useState(''); const [notice,setNotice]=useState('');
  const [revision,setRevision]=useState(0); const lock=useRef(false);
  const codes=[...new Set(account.positions.filter(p=>p.quantity>0).map(p=>p.code.replace(/^(sh|sz|bj)/,'')))];
  const signature=codes.join(',');
  useEffect(()=>{
    let active=true;
    if (!codes.length) {setReview(null);setBusy(false);return;}
    if(codes.length>50){setError('单次最多50只，请分账户查看持仓');setBusy(false);return;}
    setBusy(true);setError(''); lock.current=true;
    void requestReview(codes).then(value=>{if(active){setReview(value);localStorage.setItem(key+'.review',JSON.stringify(value));}})
      .catch(e=>{if(active)setError(String(e));}).finally(()=>{lock.current=false;if(active)setBusy(false);});
    return()=>{active=false;};
  },[signature,revision,key]);
  useEffect(()=>{
    const updated=()=>{if(!lock.current)setRevision(v=>v+1);};
    window.addEventListener('strategy:updated',updated);
    let day=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
    const timer=setInterval(()=>{const current=new Date(Date.now()+8*3600000).toISOString().slice(0,10);if(current!==day){day=current;updated();}},60000);
    return()=>{clearInterval(timer);window.removeEventListener('strategy:updated',updated);};
  },[]);
  function save() {
    try {
      if(account.positions.some(p=>!holdingSwingPlan(p,review?.items.find(i=>i.code===p.code),sizes[p.code]??0,review?.macro.regime_code??0).valid))throw new Error('请核对机动仓数量');
      localStorage.setItem(key+'.sizes',JSON.stringify(sizes));
      localStorage.setItem(key+'.plan',JSON.stringify({savedAt:new Date().toISOString(),holdingsImportedAt:account.syncedAt,positions:account.positions,sizes,review}));
      setNotice('波段计划快照已保存；最新计划会随持仓复盘更新，已保存版本供对照。');
    }catch(e){setError(String(e));}
  }
  return <div className="space-y-4"><div className="flex flex-wrap items-center gap-2"><h2 className="mr-auto font-semibold">持仓波段操作</h2><Button size="sm" variant="outline" disabled={busy||!codes.length} onClick={()=>setRevision(v=>v+1)}>{busy?'正在回测与预测复盘…':'同步回测和预测修正'}</Button><Button size="sm" disabled={busy||!review} onClick={save}>保存波段计划</Button></div>
    <p className="text-xs text-muted-foreground">只处理当前持仓。先设置机动仓，剩余为底仓；数量和可卖量以最近导入为准。所有技术价格为前复权观察位，不直接转换为委托价。</p>
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}{notice&&<p role="status" className="text-xs">{notice}</p>}
    {review&&<div className="rounded border p-3 text-xs"><b>{review.model} · 大盘{review.macro.regime}</b><p>模型截至 {review.model_asof} · 持仓复盘 {review.generated}</p><p>{review.note}</p><p>{review.prediction_note}</p></div>}
    {!codes.length&&<p className="py-8 text-center text-muted-foreground">当前无持仓，请先导入账本。</p>}
    {account.positions.filter(p=>p.quantity>0).map(p=>{
      const item=review?.items.find(i=>i.code===p.code.replace(/^(sh|sz|bj)/,''));
      const plan=holdingSwingPlan(p,item,sizes[p.code]??0,review?.macro.regime_code??0);
      return <section key={p.code} className="space-y-3 rounded-lg border p-4 text-sm"><div className="flex flex-wrap items-center gap-3"><b className="mr-auto">{p.name} · {p.code}</b><span>持仓 {p.quantity} / 可用 {p.available??'未知'}</span><label className="flex items-center gap-2">机动仓(股)<Input className="w-28" aria-label={`${p.name}机动仓`} type="number" min="0" max={p.quantity} step="100" value={sizes[p.code]??0} onChange={e=>setSizes(s=>({...s,[p.code]:Number(e.target.value)}))}/></label></div>
      <p>底仓 {plan.core??'待核对'} 股 · 本轮可卖机动仓上限 {plan.sellable??'待核对'} 股 · {plan.action}</p>{plan.blocked&&<p className="text-amber-600">{plan.blocked}</p>}
      <div className="grid gap-3 text-xs md:grid-cols-2"><p><b>回调观察：</b>{plan.entry}</p><p><b>冲高观察：</b>{plan.takeProfit}</p><p><b>卖出后接回：</b>{plan.buyback}</p><p><b>停止条件：</b>{plan.exit}</p></div>
      {item?<><p className="text-xs">日线 {item.asof} · 前复权收盘 {num(item.adjusted_close)} · MA5 {num(item.ma5)} / MA20 {num(item.ma20)} · 黄线 {num(item.technical.yellow)} · 20日支撑 {num(item.support20)} / 压力 {num(item.resistance20)} · ATR14 {num(item.atr14)} · {item.technical.signal}</p>
      <p className="text-xs">当前冻结策略逐股回溯：收益 {pct(item.backtest.return)} / 最大回撤 {pct(item.backtest.maxdd)} / 已完成交易 {item.trades.n} 笔 / 交易胜率 {pct(item.trades.win_rate)}</p>
      <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr>{['周期','预测方向/上涨概率','历史走步准确率','实发到期样本','原始→修正准确率','原始→修正Brier'].map(h=><th className="p-2" key={h}>{h}</th>)}</tr></thead><tbody>{['5','20'].map(h=>{const f=item.forecast.horizons[h],w=item.forecast.walk_forward[h],s=item.prediction_review[h];return <tr className="border-t" key={h}><td className="p-2">{h}日</td><td className="p-2">{f?.direction??'不足'} / {pct(f?.probability_up)}</td><td className="p-2">{pct(w?.direction_accuracy)}（n={w?.n??0}，多数基准{pct(w?.baseline_accuracy)}）</td><td className="p-2">{s?.matured??0}</td><td className="p-2">{pct(s?.raw_accuracy)} → {pct(s?.corrected_accuracy)}</td><td className="p-2">{s?.raw_brier==null?'待积累':num(s.raw_brier)} → {s?.brier==null?'待积累':num(s.brier)}</td></tr>})}</tbody></table></div></>:<p className="text-xs text-muted-foreground">{review?.errors.find(e=>e.code===p.code)?.error??'等待持仓回测'}</p>}
      <p className="text-xs text-muted-foreground">下个交易日开盘前复核；卖出成交、接回或重新导入持仓后重新生成。保存计划不代表成交。</p></section>;
    })}</div>;
}
