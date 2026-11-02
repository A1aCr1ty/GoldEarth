"""Current-state research overlay: Chang market/fundamentals + Z technical execution.

No current financial statement is backfilled into historical tests.
"""
import json
import os
import numpy as np
import pandas as pd


def technical(book):
    c, v = pd.Series(book['close']), pd.Series(book['volume'])
    white = c.ewm(span=10,adjust=False).mean().ewm(span=10,adjust=False).mean()
    yellow = sum(c.rolling(n).mean() for n in (14,28,57,114))/4
    dif = c.ewm(span=12,adjust=False).mean()-c.ewm(span=26,adjust=False).mean()
    i=len(c)-1
    ratio = float(v.iloc[-1]/v.iloc[-6:-1].mean()) if v.iloc[-6:-1].mean()>0 else None
    shrinking = bool(v.iloc[-1] < .618*v.iloc[-20:].max())
    trend = bool(white.iloc[-1]>yellow.iloc[-1] and yellow.iloc[-1]>=yellow.iloc[-2])
    # N-shape is a declared rolling-window proxy, not a complete bowl-pattern recognizer.
    n_proxy = bool(c.iloc[-20:].min()>c.iloc[-60:-20].min() and c.iloc[-60:-20].max()/c.iloc[-60:-20].min()>=1.1)
    b1 = trend and n_proxy and book['j'][-1]<30 and shrinking and dif.iloc[-1]>0 and c.iloc[-1]/c.iloc[-60:].min()<2
    b2 = trend and min(book['j'][-6:-1])<=-10 and c.iloc[-1]/c.iloc[-2]>=1.04 and ratio is not None and ratio>=1.5 and book['j'][-1]<55
    previous_b2 = c.iloc[-2]/c.iloc[-3]>=1.04 and v.iloc[-2]>=1.5*v.iloc[-7:-2].mean() and min(book['j'][-7:-2])<=-10 and book['j'][-2]<55
    risk_exit = bool(c.iloc[-1]<yellow.iloc[-1] or (previous_b2 and c.iloc[-1]<book['open'][-1] and v.iloc[-1]>=.75*v.iloc[-2]))
    return {'signal':'risk_exit' if risk_exit else 'B2' if b2 else 'B1' if b1 else 'wait',
            'white':round(float(white.iloc[-1]),4),'yellow':round(float(yellow.iloc[-1]),4),
            'j':round(float(book['j'][-1]),2),'dif':round(float(dif.iloc[-1]),4),
            'volume_ratio5':round(ratio,3) if ratio is not None else None,
            'volume_shrink':shrinking,'trend':trend,'n_proxy':n_proxy,
            'reference_stop_adjusted':round(float(book['low'][-1]),4),
            'missing':['历史流通市值','换手及建仓波质量','完整N型/关键K识别']}


def fundamentals(records, code, asof):
    available=[r for r in records if r.get('code')==code and isinstance(r.get('published_on'),str) and r['published_on']<=asof and r.get('source')]
    if not available: return {'status':'unknown','reason':'缺带公告日期及来源的财报/估值记录'}
    r=max(available,key=lambda r:r['published_on'])
    fields=['revenue_growth','gross_margin_change','operating_cashflow','net_profit','roe','valuation_percentile']
    if any(not isinstance(r.get(k),(float,int)) or not np.isfinite(r[k]) for k in fields):
        return {'status':'unknown','reason':'财报或估值指标不完整'}
    if (pd.Timestamp(asof)-pd.Timestamp(r['published_on'])).days>180:
        return {'status':'unknown','reason':'财报快照超过180日，需复核'}
    checks={'revenue':r['revenue_growth']>=.20,'margin':r['gross_margin_change']>=0,
            'cashflow':r['operating_cashflow']>0,'profit':r['net_profit']>0,
            'roe':r['roe']>=.15,'valuation':r['valuation_percentile']<=.70}
    return {'status':'pass' if all(checks.values()) else 'fail','checks':checks,'published_on':r['published_on'],'source':r['source']}


def build(stocks, index, root):
    from build_platform import build_regime
    from strategy_lab import enrich, forecast_stock
    from build_platform import prepare
    _, macro=build_regime(index)
    path=os.path.join(root,'data','fundamentals.json')
    records=[]
    if os.path.exists(path):
        with open(path,encoding='utf-8') as f: records=json.load(f)
        if not isinstance(records,list): raise ValueError('fundamentals.json必须是记录数组')
    operations=[]
    for s in stocks:
        b=s['book']; asof=b['date'][-1]
        t=technical(b); f=fundamentals(records,s['code'],asof)
        allowed=macro['regime_code']==2 and f['status']=='pass' and t['signal'] in ('B1','B2')
        operations.append({'code':s['code'],'asof':asof,'technical':t,'fundamental':f,
                           'action':'reduce' if t['signal']=='risk_exit' or macro['regime_code']==0 else 'buy_candidate' if allowed else 'wait'})
    forecast=forecast_stock({'code':'000300','name':'沪深300','book':enrich(prepare(index))})
    return {'version':1,'status':'research_only','validated':False,'macro':macro,'macro_forecast':forecast,
            'macro_method':'沪深300 MA20/MA60市场状态代理；不是常士杉原版大盘预测，也不是已验证上涨概率。全球流动性、行业景气尚待数据。',
            'operations':operations,'fundamental_covered':sum(o['fundamental']['status']!='unknown' for o in operations),
            'note':'GitHub社区规则的部分研究实现。缺基本面不放行买入；完整组合尚无历史时点财报回测，账户仅作观察及风险复核。'}
