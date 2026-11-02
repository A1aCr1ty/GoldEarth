import { useEffect, useState } from 'react';
import { tauri } from '@/lib/tauri';
import type { StockAccount } from '@/lib/stockAccountImport';
import type { StrategySnapshot } from '@/lib/strategyPlatform';
import { strategyAdvice } from '@/lib/strategyAdvice';
import { INTENT_LABELS } from '@/lib/accountTradePlan';

export function AccountStrategyAdvice({ account }: { account: StockAccount }) {
  const [snapshot, setSnapshot] = useState<StrategySnapshot | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    const refresh = () => void tauri.strategySnapshot().then(s => { if(alive) { setSnapshot(s); setError(''); } }).catch(e => { if(alive) setError(String(e)); });
    refresh(); window.addEventListener('strategy:updated', refresh);
    const timer = setInterval(refresh, 60000);
    return () => { alive = false; clearInterval(timer); window.removeEventListener('strategy:updated', refresh); };
  }, []);
  const codes = [...new Set(account.positions.map(p => p.code))];
  return <div className="rounded-lg border p-4 text-xs space-y-2"><h3 className="font-semibold">模型同步操作建议</h3><p className="text-muted-foreground">每次成功复盘自动更新；模型暴露是独立回测仓位，不换算为账户股数。人工计划止损及可卖数量优先。</p>{error && <p role="alert">{error}</p>}{codes.map(code => {
    const p = account.positions.find(p => p.code === code);
    const advice = strategyAdvice(snapshot, code, p?.quantity ?? 0);
    return <div key={code} className="border-t py-2"><b>{p?.name ?? code} · {INTENT_LABELS[advice.action as keyof typeof INTENT_LABELS]}</b><p>{advice.summary} · {advice.asof ?? '无数据'}</p></div>;
  })}</div>;
}
