"""A-share 63/126/252-session research. No orders or automatic promotion.

Current vendor financials become available only after collection. Verified
historical vintages can be imported; notice dates alone never imply PIT safety.
"""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import sys
import time
import urllib.parse
import urllib.request
import uuid

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent
TECH = ['momentum63', 'momentum126', 'momentum252', 'ma60', 'ma120', 'ma250',
        'macd', 'macd_hist', 'kdj_k', 'kdj_d', 'kdj_j', 'volume_ratio', 'volatility63', 'drawdown252']
FIN = ['roe', 'revenue_growth', 'profit_growth', 'gross_margin', 'debt_ratio', 'cash_profit']
WARNINGS = ['当前股票池存在幸存者偏差，未覆盖完整退市历史。',
            '复权行情来自第三方，未完成历史复权因子与分红现金流审计。',
            '结果为持有期预测检验，不是可执行组合回测；未模拟涨跌停、停牌、整手和交易成本。',
            '候选模型不会自动上线或真实下单；重复查看测试集后，该区间不再是独立证据。']


def now():
    return datetime.now(timezone.utc).isoformat()


def save(path, obj):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    pending = path.with_name(f'.{path.name}.{uuid.uuid4().hex}.pending')
    try:
        pending.write_text(json.dumps(obj, ensure_ascii=False, allow_nan=False, indent=2), encoding='utf-8')
        for attempt in range(8):
            try:
                pending.replace(path)
                return
            except PermissionError as exc:
                # Windows may briefly block replacement while a reader holds the old file.
                if getattr(exc, 'winerror', None) not in (5, 32, 33) or attempt == 7:
                    raise
                time.sleep(.05 * (attempt + 1))
    finally:
        pending.unlink(missing_ok=True)


def read(path, default):
    return json.loads(Path(path).read_text(encoding='utf-8')) if Path(path).exists() else default


def request(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0', 'Referer': 'https://emweb.securities.eastmoney.com/'})
    with urllib.request.urlopen(req, timeout=25) as response:
        return json.load(response)


def financials(code, directory):
    suffix = 'SH' if code.startswith('6') else 'BJ' if code.startswith(('4', '8', '92')) else 'SZ'
    query = urllib.parse.urlencode(dict(reportName='RPT_F10_FINANCE_MAINFINADATA', columns='ALL',
        filter=f'(SECUCODE="{code}.{suffix}")', pageNumber=1, pageSize=200,
        sortTypes=-1, sortColumns='REPORT_DATE', source='HSF10', client='PC'))
    url = 'https://datacenter.eastmoney.com/securities/api/data/v1/get?' + query
    payload = request(url)
    rows = (payload.get('result') or {}).get('data') or []
    if not payload.get('success') or not rows:
        raise ValueError('财报接口无数据')
    stamp = now()
    raw = directory / 'raw' / code / (datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S') + '.json')
    save(raw, {'retrieved_at': stamp, 'source': url, 'payload': payload})
    result = []
    mapping = dict(roe='ROEJQ', revenue_growth='TOTALOPERATEREVETZ', profit_growth='PARENTNETPROFITTZ',
                   gross_margin='XSMLL', debt_ratio='ZCFZL')
    for r in rows:
        if r.get('SECURITY_CODE') != code:
            continue
        record = dict(code=code, report_date=str(r.get('REPORT_DATE', ''))[:10],
                      published_on=str(r.get('NOTICE_DATE', ''))[:10], observed_at=stamp,
                      available_on=stamp[:10], vintage_verified=False, source=url)
        for key, field in mapping.items():
            v = pd.to_numeric(r.get(field), errors='coerce')
            record[key] = float(v) / 100 if pd.notna(v) and np.isfinite(v) else None
        cf, profit = [pd.to_numeric(r.get(k), errors='coerce') for k in ('NETCASH_OPERATE_PK', 'PARENTNETPROFIT')]
        record['cash_profit'] = float(cf / profit) if pd.notna(cf) and pd.notna(profit) and profit > 0 and np.isfinite(cf / profit) else None
        result.append(record)
    if not result:
        raise ValueError('财报股票代码不匹配')
    # Immutable raw downloads retain revisions; normalized records accumulate by observation.
    path = directory / 'financials' / f'{code}.json'
    old = read(path, [])
    save(path, old + result)
    return len(result)


def cached_financials(code, directory):
    previous = read(directory / 'financials' / f'{code}.json', [])
    if previous and max(r.get('observed_at', '') for r in previous)[:10] == now()[:10]:
        return len(previous)
    return financials(code, directory)


def collect(root, limit):
    from broad_universe import load
    from build_platform import load_code
    directory = root / 'value'
    checkpoint = directory / 'collection.json'
    selection = directory / 'universe.json'
    status = read(checkpoint, {})
    # Recover the legacy checkpoint left by an interrupted Windows rename.
    try:
        pending = read(directory / 'collection.pending', {})
    except (OSError, ValueError):
        pending = {}
    if (pending.get('started_at') == status.get('started_at')
            and pending.get('requested') == status.get('requested')
            and status.get('completed', 0) < pending.get('completed', 0) <= status.get('requested', 0)):
        status = pending
    selected = read(selection, [])
    previous_limit = status.get('limit', 6000 if len(selected) > 1500 else len(selected))
    resume = (status.get('kind', 'collect') == 'collect'
              and 0 < status.get('completed', 0) < status.get('requested', 0) == len(selected)
              and previous_limit == limit)
    if not resume:
        universe = load(str(root / 'data'))
        positions = np.linspace(0, len(universe) - 1, min(limit, len(universe)), dtype=int)
        selected = universe.iloc[positions].to_dict('records')
        status = dict(started_at=now(), kind='collect', limit=limit, requested=len(selected),
                      prices=0, financials=0, failures=[], completed=0, updated_at=now())
        save(checkpoint, status)
        save(selection, selected)
    codes = [str(row['code']) for row in selected]

    def fetch(code, kind):
        try:
            if kind == 'price':
                if load_code(code, min_rows=1, require_volume=True) is None:
                    raise ValueError('行情源未返回有效日线及成交量')
                status['prices'] += int(code != '000300')
            else:
                cached_financials(code, directory)
                status['financials'] += 1
        except Exception as exc:
            status['failures'].append({'code': code, 'kind': kind, 'error': str(exc)[:200]})

    if resume:
        for failure in list(status['failures']):
            status['failures'].remove(failure)
            fetch(failure['code'], failure['kind'])
            status['updated_at'] = now()
            save(checkpoint, status)

    remaining = codes[status['completed']:]
    for code in remaining if resume else ['000300'] + remaining:
        fetch(code, 'price')
        if code != '000300':
            fetch(code, 'financial')
            status['completed'] += 1
        status['updated_at'] = now()
        save(checkpoint, status)
        time.sleep(.2)
    return status


def collect_financials(root, limit):
    directory = root / 'value'
    codes = sorted(p.stem for p in (root / 'data').glob('*.csv')
                   if re.fullmatch(r'\d{6}', p.stem) and p.stem not in ('000300', '399006'))
    if not codes:
        raise ValueError('请先采集行情数据')
    codes = [codes[i] for i in np.linspace(0, len(codes)-1, min(limit,len(codes)), dtype=int)]
    status = dict(started_at=now(), kind='financials_only', requested=len(codes), prices=0, financials=0, failures=[], completed=0)
    def fetch(code):
        time.sleep(.3)
        return cached_financials(code, directory)
    with ThreadPoolExecutor(max_workers=3) as pool:
        jobs = {pool.submit(fetch, code):code for code in codes}
        for job in as_completed(jobs):
            code = jobs[job]
            try:
                job.result()
                status['financials'] += 1
            except Exception as exc:
                status['failures'].append({'code':code, 'kind':'financial', 'error':str(exc)[:200]})
            status['completed'] += 1
            status['updated_at'] = now()
            save(directory / 'collection.json', status)
    return status


def price_features(frame):
    f = frame.copy()
    f['date'] = pd.to_datetime(f.date, errors='raise')
    f = f.sort_values('date').drop_duplicates('date').reset_index(drop=True)
    for col in ['open', 'close', 'high', 'low', 'volume']:
        f[col] = pd.to_numeric(f[col], errors='coerce')
    if (f[['open', 'close', 'high', 'low']] <= 0).any().any():
        raise ValueError('价格必须大于零')
    c = f.close
    for h in (63, 126, 252):
        f[f'momentum{h}'] = c.pct_change(h, fill_method=None)
    for h in (60, 120, 250):
        f[f'ma{h}'] = c / c.rolling(h).mean() - 1
    dif = c.ewm(span=12, adjust=False).mean() - c.ewm(span=26, adjust=False).mean()
    f['macd'] = dif / c
    f['macd_hist'] = (dif - dif.ewm(span=9, adjust=False).mean()) * 2 / c
    low, high = f.low.rolling(9).min(), f.high.rolling(9).max()
    rsv = ((c - low) / (high - low).replace(0, np.nan)).fillna(.5)
    f['kdj_k'] = rsv.ewm(alpha=1/3, adjust=False).mean()
    f['kdj_d'] = f.kdj_k.ewm(alpha=1/3, adjust=False).mean()
    f['kdj_j'] = 3 * f.kdj_k - 2 * f.kdj_d
    f['volume_ratio'] = f.volume / f.volume.rolling(20).mean().replace(0, np.nan)
    f['volatility63'] = c.pct_change(fill_method=None).rolling(63).std() * np.sqrt(252)
    f['drawdown252'] = c / c.rolling(252).max() - 1
    return f.replace([np.inf, -np.inf], np.nan)


def join_financials(frame, records):
    f = frame.copy()
    for key in FIN:
        f[key] = np.nan
    eligible = []
    for r in records:
        # Historical imports require a provenance document and an explicit vintage assertion.
        verified = r.get('vintage_verified') is True and bool(r.get('vintage_evidence'))
        try:
            published = pd.Timestamp(r['published_on'])
            observed = pd.Timestamp(r['observed_at']).tz_localize(None)
            if pd.isna(published) or pd.isna(observed):
                continue
            available = max(published, pd.Timestamp(r.get('available_on', r['published_on'])))
            if not verified:
                available = max(available, observed.normalize())
            report = pd.Timestamp(r['report_date'])
            if not r.get('source') or pd.isna(available) or pd.isna(report) or report > published:
                continue
            eligible.append((available, report, observed, r))
        except (ValueError, KeyError, TypeError):
            continue
    for idx, row in f.iterrows():
        # Conservative next-session usability; exclude same-day announcements.
        candidates = [x for x in eligible if x[0] < row.date and (row.date - x[1]).days <= 550]
        if candidates:
            record = max(candidates, key=lambda x: (x[1], x[0], x[2]))[3]
            for key in FIN:
                f.at[idx, key] = pd.to_numeric(record.get(key), errors='coerce')
    return f.replace([np.inf, -np.inf], np.nan)


def samples(frame, benchmark, horizon):
    # Signal after close; hypothetical entry at next session open, exit h sessions later.
    b = benchmark.set_index('date')
    f = frame.copy()
    f['entry_date'] = f.date.shift(-1)
    f['end_date'] = f.date.shift(-(horizon + 1))
    f['stock_return'] = f.open.shift(-(horizon + 1)) / f.open.shift(-1) - 1
    f['benchmark_return'] = f.end_date.map(b.open) / f.entry_date.map(b.open) - 1
    f['target'] = f.stock_return - f.benchmark_return
    # Month-end signals only; no artificial repeated daily financial observations.
    # Use a shared market calendar: suspended stocks' last quote is NOT month end.
    month_ends = benchmark.groupby(benchmark.date.dt.to_period('M'), sort=True).date.max()
    monthly = f[f.date.isin(month_ends)]
    return monthly.dropna(subset=['target'] + TECH)


def split(frame):
    dates = sorted(frame.date.unique())
    if len(dates) < 48:
        raise ValueError('至少需要48个月的成熟样本，建议10年以上日线')
    valid_start, test_start = pd.Timestamp(dates[int(len(dates)*.60)]), pd.Timestamp(dates[int(len(dates)*.80)])
    train = frame[(frame.date < valid_start) & (frame.end_date < valid_start)]
    valid = frame[(frame.date >= valid_start) & (frame.date < test_start) & (frame.end_date < test_start)]
    test = frame[frame.date >= test_start]
    if min(len(train), len(valid), len(test)) < 30:
        raise ValueError('隔离重叠持有期后样本不足；请增加历史长度和股票数量')
    return train, valid, test


def fit(x, y, alpha):
    mean, scale = x.mean(axis=0), x.std(axis=0)
    scale[scale < 1e-8] = 1
    z = (x-mean)/scale
    center = y.mean()
    weights = np.linalg.solve(z.T @ z + alpha * np.eye(z.shape[1]), z.T @ (y-center))
    return mean, scale, weights, float(center)


def predict(model, x):
    mean, scale, weights, bias = model
    return (x-mean)/scale @ weights + bias


def metrics(frame, pred):
    y = frame.target.to_numpy()
    ranked = frame.assign(pred=pred)
    correlations, top = [], []
    for _, group in ranked.groupby('date'):
        if len(group) >= 5 and group.pred.nunique() > 1 and group.target.nunique() > 1:
            correlations.append(float(group.pred.rank().corr(group.target.rank())))
        top.append(float(group.nlargest(max(1, int(len(group)*.2)), 'pred').target.mean()))
    return dict(rows=len(y), months=int(frame.date.nunique()), mae=float(np.mean(abs(y-pred))),
                zero_baseline_mae=float(np.mean(abs(y))), rank_ic=float(np.mean(correlations)) if correlations else None,
                top_quintile_excess=float(np.mean(top)), first=str(frame.date.min().date()), last=str(frame.date.max().date()))


def export(model, features, path, test_x):
    import onnx
    from onnx import helper, numpy_helper, TensorProto
    import onnxruntime as ort
    mean, scale, weights, bias = model
    values = {'mean': mean, 'scale': scale, 'weights': weights.reshape(-1, 1), 'bias': np.array([bias])}
    graph = helper.make_graph([
        helper.make_node('Sub', ['features', 'mean'], ['centered']),
        helper.make_node('Div', ['centered', 'scale'], ['scaled']),
        helper.make_node('MatMul', ['scaled', 'weights'], ['linear']),
        helper.make_node('Add', ['linear', 'bias'], ['excess_return'])], 'GoldEarthValue',
        [helper.make_tensor_value_info('features', TensorProto.FLOAT, [None, len(features)])],
        [helper.make_tensor_value_info('excess_return', TensorProto.FLOAT, [None, 1])],
        [numpy_helper.from_array(np.asarray(v, dtype=np.float32), name=k) for k, v in values.items()])
    artifact = helper.make_model(graph, opset_imports=[helper.make_opsetid('', 17)])
    artifact.ir_version = 9
    helper.set_model_props(artifact, {'features': json.dumps(features), 'status': 'research_candidate'})
    onnx.checker.check_model(artifact)
    onnx.save(artifact, str(path))
    session = ort.InferenceSession(str(path), providers=['CPUExecutionProvider'])
    x = test_x.astype(np.float32)
    actual = session.run(None, {'features': x})[0].ravel()
    expected = predict(model, x)
    if not np.allclose(actual, expected, rtol=1e-4, atol=1e-5):
        raise ValueError('ONNX与训练模型推理不一致，停止发布候选结果')
    return float(np.max(abs(actual-expected))), session


def train(root, horizon, mode):
    directory = root / 'value'
    features = TECH + FIN if mode == 'fused' else TECH
    files = sorted((root / 'data').glob('*.csv'))
    benchmark = price_features(pd.read_csv(root / 'data' / '000300.csv'))
    panels, latest, failed = [], [], []
    digest = hashlib.sha256()
    digest.update((root / 'data' / '000300.csv').read_bytes())
    for path in files:
        if not re.fullmatch(r'\d{6}', path.stem) or path.stem in ('000300', '399006'):
            continue
        try:
            digest.update(path.name.encode()); digest.update(path.read_bytes())
            frame = price_features(pd.read_csv(path))
            if mode == 'fused':
                finpath = directory / 'financials' / f'{path.stem}.json'
                records = read(finpath, [])
                digest.update(json.dumps(records, sort_keys=True).encode())
                frame = join_financials(frame, [r for r in records if r.get('code') == path.stem])
            panel = samples(frame, benchmark, horizon).dropna(subset=features)
            panel['code'] = path.stem
            panels.append(panel)
            row = frame.tail(1).dropna(subset=features).copy()
            row['code'] = path.stem
            latest.append(row)
        except Exception as exc:
            failed.append({'code': path.stem, 'error': str(exc)[:160]})
    if not panels or sum(len(p) for p in panels) < 300:
        raise ValueError('可训练样本不足。融合模式需要可核验历史版本的财报；新采集财报不会回填历史。可先训练技术面基线。')
    panel = pd.concat(panels, ignore_index=True).sort_values(['date', 'code'])
    if panel.code.nunique() < 5:
        raise ValueError('至少需要5只股票的有效样本')
    a, v, t = split(panel)
    x = lambda d: d[features].to_numpy(dtype=float)
    trials = []
    for alpha in (1., 10., 100.):
        model = fit(x(a), a.target.to_numpy(), alpha)
        score = float(np.mean(abs(predict(model, x(v)) - v.target.to_numpy())))
        trials.append((score, alpha, model))
    _, alpha, model = min(trials, key=lambda trial: trial[0])
    # Keep the selected training fit; do not refit into the validation/test boundary.
    run_id = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S') + '-' + uuid.uuid4().hex[:8]
    run = directory / 'runs' / run_id
    run.mkdir(parents=True)
    error, session = export(model, features, run / 'model.onnx', x(t)[:256])
    predictions = []
    if latest:
        current = pd.concat(latest, ignore_index=True)
        if len(current):
            scores = session.run(None, {'features': x(current).astype(np.float32)})[0].ravel()
            predictions = [dict(code=r.code, asof=str(r.date.date()), excess_return=float(score))
                           for (_, r), score in zip(current.iterrows(), scores)]
            predictions.sort(key=lambda r: r['excess_return'], reverse=True)
    result = dict(run_id=run_id, created_at=now(), status='research_candidate', horizon=horizon, mode=mode,
        features=features, universe=int(panel.code.nunique()), samples=len(panel), data_sha256=digest.hexdigest(),
        alpha=alpha, trials=[{'alpha': r[1], 'validation_mae': r[0]} for r in trials],
        train=metrics(a, predict(model, x(a))), validation=metrics(v, predict(model, x(v))),
        test=metrics(t, predict(model, x(t))), onnx_max_error=error, model_path=str(run / 'model.onnx'),
        predictions=predictions, failures=failed, warnings=WARNINGS,
        financial_used=mode == 'fused', source_code_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest())
    save(run / 'result.json', result)
    save(directory / 'latest.json', result)
    return result


def status(root):
    directory = root / 'value'
    files = [p for p in (root / 'data').glob('*.csv') if re.fullmatch(r'\d{6}', p.stem) and p.stem not in ('000300', '399006')]
    return dict(price_files=len(files), financial_files=len(list((directory / 'financials').glob('*.json'))),
                collection=read(directory / 'collection.json', None), latest=read(directory / 'latest.json', None),
                sources=read(root / 'value_sources.json', []), warnings=WARNINGS,
                root=str(directory))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['status', 'collect', 'financials', 'train'])
    parser.add_argument('--limit', type=int, default=500)
    parser.add_argument('--horizon', type=int, choices=[63,126,252], default=126)
    parser.add_argument('--mode', choices=['technical','fused'], default='technical')
    args = parser.parse_args()
    if not 5 <= args.limit <= 6000:
        raise ValueError('股票数量应为5至6000')
    if args.action == 'collect':
        collect(ROOT, args.limit)
    elif args.action == 'financials':
        collect_financials(ROOT, args.limit)
    elif args.action == 'train':
        train(ROOT, args.horizon, args.mode)
    print(json.dumps(status(ROOT), ensure_ascii=False, allow_nan=False))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
