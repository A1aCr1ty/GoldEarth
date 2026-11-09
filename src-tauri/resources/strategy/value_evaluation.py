"""Pre-registered walk-forward research and fee-aware portfolio simulation.

Adjusted fractional units, historical current-universe bias and incomplete
execution metadata prevent live approval even if numerical gates pass.
"""
from __future__ import annotations
import os
os.environ.setdefault('OMP_NUM_THREADS', '2')
os.environ.setdefault('OPENBLAS_NUM_THREADS', '2')
import argparse
import hashlib
import json
from pathlib import Path
import uuid
import numpy as np
import pandas as pd
from value_lab import ROOT, TECH, price_features, read, save, now

SOURCE_BYTES = Path(__file__).read_bytes()
FEATURE_SOURCE_BYTES = Path(__file__).with_name('value_lab.py').read_bytes()

CANDIDATES = ('ridge', 'rank_ridge', 'hist_rank')
TRIALS = CANDIDATES + tuple(name+'_risk' for name in CANDIDATES)
EXPLANATION_GROUPS = {
    'trend': ('ma60', 'ma120', 'ma250'),
    'momentum': ('momentum63', 'momentum126', 'momentum252'),
    'oscillators': ('macd', 'macd_hist', 'kdj_k', 'kdj_d', 'kdj_j'),
    'volume': ('volume_ratio',),
    'risk': ('volatility63', 'drawdown252'),
}
PRICE_LEVELS = ('reference_close', 'ma120_next', 'momentum126_next', 'macd_next')


def next_close_levels(close):
    """Break-even close for each indicator on the next stock trading session."""
    fast_alpha, slow_alpha = 2 / 13, 2 / 27
    fast = close.ewm(span=12, adjust=False).mean()
    slow = close.ewm(span=26, adjust=False).mean()
    signal = (fast - slow).ewm(span=9, adjust=False).mean()
    macd_next = (signal - (1-fast_alpha)*fast + (1-slow_alpha)*slow) / (fast_alpha-slow_alpha)
    return pd.DataFrame(dict(reference_close=close, ma120_next=close.rolling(119).mean(),
                             momentum126_next=close.shift(125), macd_next=macd_next))
RULES = dict(version=2, top=30, retain=60, commission=.0003, minimum_commission=5.,
             slippage=.001, gap_guard=.048, training_years=6, candidates=list(TRIALS),
             risk_policy='close<MA200:25%; otherwise clip(12%/vol63,20%,80%), monthly at next open',
             first_year=2020, development_end='2024-01-01', bootstrap_block=6,
             max_iter=80, max_leaf_nodes=15, min_samples_leaf=100, l2_regularization=10.)


def progress(root, stage, **kwargs):
    save(root / 'value' / 'evaluation_progress.json', dict(stage=stage, updated_at=now(), **kwargs))


def build_dataset(root, horizon, progress_root=None):
    benchmark = price_features(pd.read_csv(root / 'data/000300.csv')).set_index('date')
    calendar = benchmark.index
    week_ends = calendar.to_series().groupby(calendar.to_period('W-FRI')).max().values
    month_ends = calendar.to_series().groupby(calendar.to_period('M')).max().values
    selected_dates = pd.DatetimeIndex(sorted(set(week_ends) | set(month_ends)))
    files = [p for p in sorted((root / 'data').glob('*.csv')) if len(p.stem)==6 and p.stem.isdigit() and p.stem not in ('000300','399006')]
    panels, opens, previous, valid_codes, failed = [], [], [], [], []
    digest = hashlib.sha256((root / 'data/000300.csv').read_bytes())
    for index, path in enumerate(files, start=1):
        try:
            digest.update(path.name.encode()); digest.update(path.read_bytes())
            f = price_features(pd.read_csv(path)).set_index('date')
            # Reindex first: horizon always counts market sessions, never stock observations.
            aligned = f.reindex(calendar)
            part = aligned.reindex(selected_dates)[TECH].copy()
            # Rolling levels count the stock's own observations, like its model features.
            part[list(PRICE_LEVELS)] = next_close_levels(f.close).reindex(selected_dates)
            stock_return = aligned.open.shift(-(horizon+1)) / aligned.open.shift(-1) - 1
            benchmark_return = benchmark.open.shift(-(horizon+1)) / benchmark.open.shift(-1) - 1
            part['target'] = (stock_return-benchmark_return).reindex(selected_dates)
            end_dates = pd.Series(calendar, index=calendar).shift(-(horizon+1))
            part['end_date'] = end_dates.reindex(selected_dates)
            part['code'] = path.stem
            part['is_month_end'] = part.index.isin(month_ends)
            part = part.dropna(subset=TECH)
            if len(part) >= 52:
                panels.append(part.reset_index(names='date'))
                opens.append(aligned.open.to_numpy(dtype=np.float32))
                previous.append(aligned.close.ffill().shift(1).to_numpy(dtype=np.float32))
                valid_codes.append(path.stem)
        except Exception as exc:
            failed.append(dict(code=path.stem,error=str(exc)[:200]))
        if index % 100 == 0 or index == len(files):
            progress(progress_root or root,'构建周度样本', completed=index, total=len(files),
                     eligible_stocks=len(valid_codes))
    progress(progress_root or root, '整理横截面特征', eligible_stocks=len(valid_codes))
    if not panels:
        raise ValueError('没有有效行情样本')
    panel = pd.concat(panels, ignore_index=True).sort_values(['date','code']).reset_index(drop=True)
    # Rank features before filtering mature labels: cross-section is based only on signal data.
    rank_names = [f'rank_{name}' for name in TECH]
    panel[rank_names] = panel.groupby('date')[TECH].rank(pct=True).astype(np.float32) - .5
    panel['target_rank'] = panel.groupby('date').target.rank(pct=True) - .5
    panel[TECH] = panel[TECH].astype(np.float32)
    panel['code'] = panel.code.astype('category')
    prices = pd.DataFrame(np.array(opens).T,index=calendar,columns=valid_codes)
    prior = pd.DataFrame(np.array(previous).T,index=calendar,columns=valid_codes)
    return panel, prices, prior, benchmark, digest.hexdigest(), failed


def fit_candidate(name, train):
    from sklearn.ensemble import HistGradientBoostingRegressor
    from sklearn.linear_model import Ridge
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler
    features = TECH if name=='ridge' else ['rank_'+key for key in TECH]
    target = 'target' if name=='ridge' else 'target_rank'
    if name=='hist_rank':
        model = HistGradientBoostingRegressor(max_iter=80,max_leaf_nodes=15,min_samples_leaf=100,
            l2_regularization=10,learning_rate=.05,early_stopping=False,random_state=20261108)
    else:
        model = make_pipeline(StandardScaler(),Ridge(alpha=100))
    # Equal aggregate weight per observation date; dense recent universes do not dominate.
    weights = (1/train.groupby('date').date.transform('size')).to_numpy()
    weights *= len(weights)/weights.sum()
    x, y = train[features].to_numpy(np.float32), train[target].to_numpy(float)
    if name=='hist_rank':
        model.fit(x,y,sample_weight=weights)
    else:
        model.fit(x,y,ridge__sample_weight=weights)
    return model, features


def walk_forward(root, panel, name):
    rows, folds = [], []
    for year in sorted(panel[panel.date.dt.year>=RULES['first_year']].date.dt.year.unique()):
        cutoff = pd.Timestamp(year=int(year),month=1,day=1)
        train = panel[(panel.end_date < cutoff) & (panel.date >= cutoff-pd.DateOffset(years=6))].dropna(subset=['target','target_rank'])
        test = panel[(panel.date.dt.year==year) & panel.is_month_end]
        if train.date.nunique()<104 or len(test)==0:
            continue
        progress(root,'滚动训练', candidate=name, year=int(year), training_rows=len(train))
        model, features = fit_candidate(name,train)
        pred = model.predict(test[features].to_numpy(np.float32))
        out = test[['date','code','target','end_date']].copy()
        out['score'] = pred
        rows.append(out)
        folds.append(dict(year=int(year),train_rows=len(train),train_last_label=str(train.end_date.max().date()),
                          prediction_first=str(test.date.min().date()),prediction_rows=len(test)))
    if not rows:
        raise ValueError('至少需要2016年以来足够成熟历史样本')
    return pd.concat(rows,ignore_index=True), folds


def fee(amount, side, day, commission=.0003, minimum=5., slippage=.001):
    if amount<=0: return 0.
    stamp = (.001 if pd.Timestamp(day)<pd.Timestamp('2023-08-28') else .0005) if side=='sell' else 0.
    return max(minimum,amount*commission) + amount*(stamp+slippage)


def simulate(scores, prices, prior, capital=100000., monthly_fee=300., slippage=.001, top=30, retain=60):
    """Opening-mark ledger; no intraday high/low/volume used for opening fills.

    Missing marks are held at their previous value, never magically liquidated.
    Expense shortfalls remain a liability and reduce NAV.
    """
    if capital<=0 or monthly_fee<0 or not np.isfinite(capital+monthly_fee):
        raise ValueError('本金须为正，费用须非负且有限')
    scores = scores.sort_values(['date','score','code'],ascending=[True,False,True])
    calendar = prices.index
    signals = {}
    exposures = {}
    for day, group in scores.groupby('date'):
        i = calendar.searchsorted(day,side='right')
        if i < len(calendar):
            signals[calendar[i]] = group.code.astype(str).tolist()
            exposures[calendar[i]] = float(group.risk_exposure.iloc[0]) if 'risk_exposure' in group else 1.
            if not np.isfinite(exposures[calendar[i]]) or not 0<=exposures[calendar[i]]<=1:
                raise ValueError('目标风险仓位须在0至1之间')
    if not signals:
        raise ValueError('没有可执行的下一交易日')
    start = min(signals)
    days = calendar[calendar>=start]
    codes = list(prices.columns)
    mapping = {code:i for i,code in enumerate(codes)}
    opens = prices.reindex(days).to_numpy(dtype=float)
    previous = prior.reindex(days).to_numpy(dtype=float)
    held = np.zeros(len(codes))
    marks = np.zeros(len(codes))
    ages = np.zeros(len(codes),dtype=int)
    cash, expenses, total_cost = float(capital), 0., 0.
    ledger, trades, month_rows = [], [], []
    month_start_nav, current_month = float(capital), None
    month_cost, month_expenses = 0., 0.
    blocked = dict(missing=0,gap_guard=0)
    insolvent = False
    for position, day in enumerate(days):
        quotes, pclose = opens[position], previous[position]
        available = np.isfinite(quotes) & (quotes>0)
        marks[available] = quotes[available]
        ages[available] = 0; ages[~available] += 1
        nav = cash + float(held@marks)
        if current_month is None:
            current_month = str(day.to_period('M'))
        current_day_month = str(day.to_period('M'))
        if current_day_month!=current_month:
            # Prior close is not available here: previous ledger row is last opening mark.
            prev_nav = ledger[-1]['equity']
            month_rows.append(dict(month=current_month, opening_equity=month_start_nav,closing_equity=prev_nav,
                net_profit=prev_nav-month_start_nav, net_return=prev_nav/month_start_nav-1 if month_start_nav>0 else -1.,
                trading_cost=month_cost,service_fee=month_expenses, covered=prev_nav-month_start_nav>=0))
            month_start_nav=prev_nav; month_cost=0.; month_expenses=0.; current_month=current_day_month
        guard = available & np.isfinite(pclose) & (pclose>0) & (np.abs(quotes/pclose-1)<=RULES['gap_guard'])
        if position==0 or str(days[position-1].to_period('M'))!=current_month:
            cash -= monthly_fee; expenses += monthly_fee; month_expenses += monthly_fee
        def transact(i, units, side, reason):
            nonlocal cash,total_cost,month_cost
            amount = float(units*quotes[i])
            cost = fee(amount,side,day,slippage=slippage)
            if side=='sell':
                held[i]-=units; cash+=amount-cost
            else:
                held[i]+=units; cash-=amount+cost
            total_cost+=cost; month_cost+=cost
            trades.append(dict(date=str(day.date()),code=codes[i],side=side,adjusted_units=float(units),
                               amount=amount,cost=cost,reason=reason))
        ranking = signals.get(day)
        if ranking is not None:
            upper=set(ranking[:retain])
            targets=[c for c in ranking if c in upper and c in mapping and held[mapping[c]]>0][:top]
            targets += [c for c in ranking if c in mapping and c not in targets][:max(0,top-len(targets))]
            nav = cash + float(held@marks)
            target_amount = max(nav,0)*.98*exposures[day]/max(len(targets),1)
            desired = np.zeros(len(codes))
            for c in targets:
                i=mapping[c]
                if available[i]: desired[i]=target_amount/quotes[i]
                else: desired[i]=held[i]  # missing quote is not a zero-price exit
            for i in np.flatnonzero(held>desired+1e-8):
                if guard[i]: transact(i,float(held[i]-desired[i]),'sell','rebalance')
                else: blocked['missing' if not available[i] else 'gap_guard']+=1
            for c in targets:
                i=mapping[c]
                if not guard[i]:
                    blocked['missing' if not available[i] else 'gap_guard']+=1
                    continue
                units=max(0.,desired[i]-held[i])
                amount=units*quotes[i]
                if amount<=0: continue
                # Reserve minimum commission and proportional charges without borrowing.
                affordable=max(0.,(cash-5.)/(1+.0003+slippage))
                amount=min(amount,affordable)
                if amount>5.: transact(i,float(amount/quotes[i]),'buy','rebalance')
        if cash<0:
            for i in np.flatnonzero((held>0)&guard):
                if cash>=0: break
                wanted=(-cash+5.)/(1-.0003-slippage-.001)
                amount=min(float(held[i]*quotes[i]),wanted)
                if amount>fee(amount,'sell',day,slippage=slippage):
                    transact(i,float(amount/quotes[i]),'sell','service_fee')
        nav=cash+float(held@marks)
        ledger.append(dict(date=str(day.date()),equity=nav,cash=cash,holdings=int((held>1e-8).sum()),
                           stale_value=float((held*marks)[ages>20].sum())))
        if nav<=0:
            insolvent=True
            break
    # Last partial month is retained but excluded from monthly success metrics.
    last_nav=ledger[-1]['equity']
    month_rows.append(dict(month=current_month,opening_equity=month_start_nav,closing_equity=last_nav,
        net_profit=last_nav-month_start_nav,net_return=last_nav/month_start_nav-1 if month_start_nav>0 else -1.,
        trading_cost=month_cost,service_fee=month_expenses,covered=last_nav-month_start_nav>=0,partial=True))
    equity=np.array([capital]+[r['equity'] for r in ledger])
    drawdown=equity/np.maximum.accumulate(equity)-1
    full=[r for r in month_rows if not r.get('partial')]
    monthly=np.array([r['net_return'] for r in full])
    years=max((pd.Timestamp(ledger[-1]['date'])-pd.Timestamp(ledger[0]['date'])).days/365.25,1/365.25)
    annualized=(max(last_nav,0)/capital)**(1/years)-1
    streak=longest=0
    for r in full:
        streak=0 if r['covered'] else streak+1
        longest=max(longest,streak)
    sharpe=float(monthly.mean()/monthly.std(ddof=1)*np.sqrt(12)) if len(monthly)>1 and monthly.std()>0 else None
    yearly=[]
    for year in sorted({r['month'][:4] for r in month_rows}):
        group=[r for r in month_rows if r['month'].startswith(year)]
        yearly.append(dict(year=year,months=len(group),net_profit=sum(r['net_profit'] for r in group),
                           service_fee=sum(r['service_fee'] for r in group),
                           complete=all(not r.get('partial') for r in group) and len(group)==12))
    return dict(capital=capital,monthly_fee=monthly_fee,slippage=slippage,final_equity=last_nav,
        net_profit=last_nav-capital,total_return=last_nav/capital-1,cagr=annualized,max_drawdown=float(drawdown.min()),
        monthly_sharpe=sharpe,complete_months=len(full),coverage_rate=float(np.mean([r['covered'] for r in full])) if full else None,
        longest_uncovered_months=longest,trading_cost=total_cost,service_fees=expenses,trade_count=len(trades),
        turnover=float(sum(t['amount'] for t in trades)/max(np.mean(equity),1)/years),
        max_stale_value=max(r['stale_value'] for r in ledger),blocked=blocked,insolvent=insolvent,
        monthly=month_rows,yearly=yearly,equity=ledger,trades=trades)


def compact(result):
    return {k:v for k,v in result.items() if k not in ('equity','trades')}


def block_interval(monthly):
    values=np.array([r['net_return'] for r in monthly if not r.get('partial')])
    if len(values)<12: return None
    rng=np.random.default_rng(20261108)
    means=[]
    for _ in range(500):
        starts=rng.integers(0,len(values),size=int(np.ceil(len(values)/6)))
        sample=np.concatenate([values[(np.arange(6)+s)%len(values)] for s in starts])[:len(values)]
        means.append(float(sample.mean()))
    return dict(mean_monthly_95pct=[float(x) for x in np.quantile(means,[.025,.975])],block_months=6,
                repetitions=500,note='描述性区间；已触及历史且有多重试验，不是独立显著性证据')


def export_candidate(model,features,path,x):
    import onnx
    import onnxruntime as ort
    from skl2onnx import to_onnx
    if hasattr(model,'_predictors'):
        # Explicit integer attributes avoid bool/int incompatibility between
        # recent protobuf and third-party histogram-tree converters.
        from onnx import helper,TensorProto
        attributes={key:[] for key in ('nodes_treeids','nodes_nodeids','nodes_featureids','nodes_modes',
            'nodes_values','nodes_truenodeids','nodes_falsenodeids','nodes_missing_value_tracks_true',
            'target_treeids','target_nodeids','target_ids','target_weights')}
        for tree_id,trees in enumerate(model._predictors):
            for node_id,node in enumerate(trees[0].nodes):
                leaf=bool(node['is_leaf'])
                threshold=float(node['num_threshold'])
                rounded=np.float32(threshold)
                if float(rounded)>threshold: rounded=np.nextafter(rounded,np.float32(-np.inf))
                attributes['nodes_treeids'].append(tree_id)
                attributes['nodes_nodeids'].append(node_id)
                attributes['nodes_featureids'].append(int(node['feature_idx']) if not leaf else 0)
                attributes['nodes_modes'].append('LEAF' if leaf else 'BRANCH_LEQ')
                attributes['nodes_values'].append(float(rounded) if not leaf else 0.)
                attributes['nodes_truenodeids'].append(int(node['left']) if not leaf else 0)
                attributes['nodes_falsenodeids'].append(int(node['right']) if not leaf else 0)
                attributes['nodes_missing_value_tracks_true'].append(int(node['missing_go_to_left']))
                if leaf:
                    attributes['target_treeids'].append(tree_id)
                    attributes['target_nodeids'].append(node_id)
                    attributes['target_ids'].append(0)
                    attributes['target_weights'].append(float(node['value']))
        node=helper.make_node('TreeEnsembleRegressor',['features'],['score'],domain='ai.onnx.ml',
                             n_targets=1,base_values=[float(model._baseline_prediction.ravel()[0])],**attributes)
        graph=helper.make_graph([node],'GoldEarthHistogramRank',
            [helper.make_tensor_value_info('features',TensorProto.FLOAT,[None,len(features)])],
            [helper.make_tensor_value_info('score',TensorProto.FLOAT,[None,1])])
        artifact=helper.make_model(graph,opset_imports=[helper.make_opsetid('',17),helper.make_opsetid('ai.onnx.ml',3)])
    else:
        artifact=to_onnx(model,x[:1].astype(np.float32),target_opset=17)
    artifact.ir_version=min(artifact.ir_version,9)
    onnx.helper.set_model_props(artifact,{'features':json.dumps(features),'status':'research_only'})
    onnx.checker.check_model(artifact)
    onnx.save(artifact,str(path))
    session=ort.InferenceSession(str(path),providers=['CPUExecutionProvider'])
    actual=session.run(None,{session.get_inputs()[0].name:x.astype(np.float32)})[0].ravel()
    expected=model.predict(x.astype(np.float32))
    if not np.allclose(actual,expected,atol=1e-5,rtol=1e-4):
        raise ValueError('ONNX推理校验失败')
    return float(np.max(abs(actual-expected)))


def explain_predictions(path, features, latest, predictions):
    """Compare each stock's score against replacing one group with same-date medians."""
    import onnxruntime as ort
    options = ort.SessionOptions()
    options.intra_op_num_threads = 2
    session = ort.InferenceSession(str(path), sess_options=options, providers=['CPUExecutionProvider'])
    if json.loads(session.get_modelmeta().custom_metadata_map['features']) != features:
        raise ValueError('ONNX 特征顺序与报告不匹配')
    input_name = session.get_inputs()[0].name
    by_code = latest.assign(code=latest.code.astype(str)).set_index('code')
    rows = by_code.loc[[row['code'] for row in predictions]]
    if len(rows) != len(latest) or not (rows.date.dt.strftime('%Y-%m-%d').to_numpy()
                                       == [row['asof'] for row in predictions]).all():
        raise ValueError('评分日期或覆盖范围与行情不匹配')
    x = rows[features].to_numpy(np.float32)
    score = session.run(None, {input_name: x})[0].ravel()
    if not np.allclose(score, [row['score'] for row in predictions], atol=1e-5, rtol=1e-4):
        raise ValueError('ONNX 复算评分与报告不匹配')
    medians = np.median(x, axis=0)
    impacts = {}
    for group, names in EXPLANATION_GROUPS.items():
        columns = [i for i, name in enumerate(features) if name.removeprefix('rank_') in names]
        neutral = x.copy()
        neutral[:, columns] = medians[columns]
        impacts[group] = score - session.run(None, {input_name: neutral})[0].ravel()
    metrics = ['momentum126', 'ma120', 'macd_hist', 'kdj_k', 'volume_ratio', 'volatility63', 'drawdown252']
    for index, (row, values) in enumerate(zip(predictions, rows[metrics].to_dict('records'))):
        row['analysis'] = dict(metrics=values, impacts={key: float(change[index]) for key, change in impacts.items()})
    if all(key in rows for key in PRICE_LEVELS):
        for row, levels in zip(predictions, rows[list(PRICE_LEVELS)].to_dict('records')):
            if all(np.isfinite(value) for value in levels.values()) and levels['reference_close'] > 0:
                row['analysis']['levels'] = levels


def scoring_date(panel):
    recent = panel.groupby('date').size().sort_index().tail(8)
    # A partially synchronized final session must not redefine the ranking universe.
    return recent[recent >= .95 * recent.max()].index[-1]


def evaluate(root,horizon=126,capital=100000.,monthly_fee=300.,max_drawdown=.20,reuse_run=None,output_root=None):
    if not 0<max_drawdown<=1: raise ValueError('回撤上限须在0和1之间')
    data_root=root
    root=Path(output_root) if output_root is not None else root
    run_id='evaluation-'+now().replace(':','').replace('-','')[:15]+'-'+uuid.uuid4().hex[:8]
    run=root/'value/runs'/run_id
    run.mkdir(parents=True)
    (run/'value_evaluation.py').write_bytes(SOURCE_BYTES)
    (run/'value_lab.py').write_bytes(FEATURE_SOURCE_BYTES)
    save(run/'protocol.json',dict(rules=RULES,horizon=horizon,capital=capital,monthly_fee=monthly_fee,
                                 max_drawdown=max_drawdown,created_at=now(),status='pre_registered'))
    panel,prices,prior,benchmark,fingerprint,failed=build_dataset(data_root,horizon,root)
    all_scores,folds={},{}
    original=None
    if reuse_run:
        import re
        if not re.fullmatch(r'[a-zA-Z0-9-]+',reuse_run): raise ValueError('实验ID无效')
        original=read(root/'value/runs'/reuse_run/'evaluation.json',{})
        if original.get('data_sha256')!=fingerprint or original.get('horizon')!=horizon:
            raise ValueError('复用实验的数据或预测期不匹配')
    for name in CANDIDATES:
        if original:
            scores=pd.read_csv(root/'value/runs'/reuse_run/f'{name}-predictions.csv',dtype={'code':str},parse_dates=['date','end_date'])
            fold=original['folds'][name]
        else:
            scores,fold=walk_forward(root,panel,name)
        scores.to_csv(run/f'{name}-predictions.csv',index=False)
        all_scores[name]=scores; folds[name]=fold
    volatility=benchmark.close.pct_change(fill_method=None).rolling(63).std()*np.sqrt(252)
    exposure=(.12/volatility).clip(.2,.8)
    exposure[benchmark.close < benchmark.close.rolling(200).mean()]=.25
    exposure=exposure.fillna(.2)
    for name in CANDIDATES:
        all_scores[name+'_risk']=all_scores[name].assign(risk_exposure=all_scores[name].date.map(exposure))
    base=panel[panel.is_month_end & (panel.date.dt.year>=RULES['first_year'])]
    for name,key,sign in [('momentum','momentum126',1),('low_volatility','volatility63',-1)]:
        all_scores[name]=base[['date','code','target','end_date']].assign(score=base[key]*sign)
    # Benchmark is a price-index proxy; fund expenses/tracking error are not modeled.
    all_scores['hs300']=pd.DataFrame({'date':sorted(base.date.unique()),'code':'000300','score':1.})
    prices['000300']=benchmark.open
    prior['000300']=benchmark.close.shift(1)
    reports={}
    prediction_metrics={}
    boundary=pd.Timestamp(RULES['development_end'])
    for index, (name,scores) in enumerate(all_scores.items(), start=1):
        progress(root,'组合回测',candidate=name,completed=index-1,total=len(all_scores))
        reports[name]={}
        prediction_metrics[name]={}
        for period in ('development','review'):
            mask=scores.date<boundary if period=='development' else scores.date>=boundary
            subset=scores[mask]
            if 'target' in subset:
                ic=[]
                for _,group in subset.dropna(subset=['target']).groupby('date'):
                    if len(group)>=5 and group.score.nunique()>1 and group.target.nunique()>1:
                        ic.append(float(group.score.rank().corr(group.target.rank())))
                prediction_metrics[name][period]=dict(rank_ic=float(np.mean(ic)) if ic else None,mature_months=len(ic))
            p=prices.loc[prices.index<boundary] if period=='development' else prices
            result=simulate(subset,p,prior,capital,monthly_fee,top=1 if name=='hs300' else 30)
            save(run/f'{name}-{period}-ledger.json',result)
            reports[name][period]=compact(result)
    # Selection uses development data only, never review-period results.
    def score(name):
        r=reports[name]['development']
        return r['monthly_sharpe'] if r['net_profit']>0 and r['max_drawdown']>=-max_drawdown and r['monthly_sharpe'] is not None else -1e9
    chosen=max(TRIALS,key=score)
    qualified=score(chosen)>-1e9
    stress=[]
    scores=all_scores[chosen]
    review_scores=scores[scores.date>=boundary]
    progress(root,'压力测试与费用情景',candidate=chosen)
    for slip in (.002,.005):
        result=simulate(review_scores,prices,prior,capital,monthly_fee,slippage=slip)
        save(run/f'stress-{slip}-ledger.json',result)
        stress.append(compact(result))
    scenarios=[]
    for amount in (10000.,50000.,100000.):
        for service in (100.,300.,1000.):
            result=simulate(review_scores,prices,prior,amount,service)
            scenarios.append({k:result[k] for k in ('capital','monthly_fee','net_profit','max_drawdown','coverage_rate','insolvent')})
    review=reports[chosen]['review']
    simple_best=max(reports[n]['review']['net_profit'] for n in ('momentum','low_volatility','hs300'))
    gates=dict(development_qualified=qualified,review_months=review['complete_months']>=24,
        positive_net=review['net_profit']>0,beats_simple=review['net_profit']>simple_best,
        within_drawdown=review['max_drawdown']>=-max_drawdown,
        double_slippage_positive=stress[0]['net_profit']>0,
        covers_60pct_months=(review['coverage_rate'] or 0)>=.6,
        profit_twice_service=review['net_profit']>=2*review['service_fees'],
        audited_execution_data=False,independent_forward_validation=False)
    cutoff=scoring_date(panel)
    training=panel[(panel.end_date<cutoff)&(panel.date>=cutoff-pd.DateOffset(years=6))].dropna(subset=['target','target_rank'])
    progress(root,'训练最终候选并验证 ONNX',candidate=chosen,training_rows=len(training))
    model,features=fit_candidate(chosen.removesuffix('_risk'),training)
    latest=panel[panel.date==cutoff]
    error=export_candidate(model,features,run/'candidate.onnx',latest[features].to_numpy(np.float32))
    predictions=[dict(code=str(c),score=float(s),asof=str(cutoff.date())) for c,s in
                 zip(latest.code,model.predict(latest[features].to_numpy(np.float32)))]
    predictions.sort(key=lambda r:r['score'],reverse=True)
    explain_predictions(run/'candidate.onnx',features,latest,predictions)
    report=dict(run_id=run_id,created_at=now(),horizon=horizon,status='research_only',capital=capital,protocol=RULES,reused_predictions_from=reuse_run,
        monthly_fee=monthly_fee,max_drawdown_limit=max_drawdown,candidates=reports,chosen=chosen,
        chosen_qualified=qualified,samples=len(panel),mature_samples=int(panel.target.notna().sum()),
        universe=int(panel.code.nunique()),folds=folds,prediction_metrics=prediction_metrics,stress=stress,scenarios=scenarios,gates=gates,
        bootstrap=block_interval(review['monthly']),features=features,onnx_max_error=error,
        model_path=str(run/'candidate.onnx'),predictions=predictions,data_sha256=fingerprint,
        latest_market_date=str(panel.date.max().date()),
        source_sha256=hashlib.sha256(SOURCE_BYTES).hexdigest(),failures=failed,
        warnings=['已触及的历史研究区间，不是独立测试或实盘收益。','当前股票池幸存者偏差未修复；财报未进入本轮历史训练。',
                  '复权份额模拟，未处理真实整手、完整ST/涨跌停和交易容量；不能批准实盘。',
                  '本金和费用为研究情景，若未填写实际值不得解读为用户收益。',
                  '最后一个月按未完成处理；所有模型与基线均扣相同服务费用。'])
    save(run/'evaluation.json',report)
    save(root/'value/evaluation.json',report)
    progress(root,'完成',run_id=run_id)
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--horizon',type=int,choices=[63,126,252],default=126)
    parser.add_argument('--capital',type=float,default=100000.)
    parser.add_argument('--monthly-fee',type=float,default=300.)
    parser.add_argument('--max-drawdown',type=float,default=.20)
    parser.add_argument('--reuse-run')
    parser.add_argument('--data-root',type=Path,default=ROOT,help='行情数据所在的策略根目录')
    parser.add_argument('--output-root',type=Path,help='训练输出根目录，可放在源码监听范围以外')
    args=parser.parse_args()
    result=evaluate(args.data_root,args.horizon,args.capital,args.monthly_fee,args.max_drawdown,args.reuse_run,args.output_root)
    print(json.dumps({k:result[k] for k in ('run_id','samples','universe','chosen','gates','onnx_max_error')},ensure_ascii=False))
