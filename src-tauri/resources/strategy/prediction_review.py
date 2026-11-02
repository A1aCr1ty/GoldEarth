"""Append-only forecast identities; settle only once the full horizon is observed."""
import json
import os
import numpy as np


def review(path, holdings, stocks):
    rows = []
    if os.path.exists(path):
        with open(path, encoding='utf-8') as f:
            rows = json.load(f)
    books = {s['code']: s['book'] for s in stocks}
    for row in rows:
        b = books.get(row['code'])
        if not b or row.get('actual') is not None or row['asof'] not in b['date']:
            continue
        i = b['date'].index(row['asof'])
        end = i + row['horizon'] + 1
        if end < len(b['date']):
            row['actual'] = float(b['open'][end] / b['open'][i+1] - 1)
            row['settled_on'] = b['date'][end]
    for h in holdings:
        for horizon, forecast in h['forecast']['horizons'].items():
            if 'probability_up' not in forecast:
                continue
            key = (h['code'], h['forecast']['asof'], int(horizon))
            issued = next((r for r in rows if (r['code'], r['asof'], r['horizon']) == key), None)
            if issued:
                forecast['probability_up'] = issued['probability']
                forecast['raw_probability_up'] = issued['raw_probability']
                continue
            # Calibration only from already settled forecasts; preserve the originally issued value.
            past = [r for r in rows if r['code'] == h['code'] and r['horizon'] == int(horizon) and r.get('actual') is not None and r['settled_on'] < key[1]][-100:]
            bias = np.mean([float(r['actual'] > 0) - r['probability'] for r in past]) if len(past) >= 20 else 0.
            raw = forecast['probability_up']
            corrected = float(np.clip(raw + np.clip(bias, -.1, .1), .05, .95))
            forecast.update(raw_probability_up=raw, probability_up=round(corrected,4), calibration_samples=len(past))
            if not forecast.get('reliable'):
                forecast['direction'] = '中性（预测未通过验证）'
            else:
                forecast['direction'] = '偏强' if corrected >= .55 else '偏弱' if corrected <= .45 else '中性'
            rows.append({'code':key[0], 'asof':key[1], 'horizon':key[2], 'probability':corrected, 'raw_probability':raw, 'actual':None})
    pending = path + '.pending'
    with open(pending,'w',encoding='utf-8') as f:
        json.dump(rows,f,ensure_ascii=False,indent=2)
    os.replace(pending,path)
    mature = [r for r in rows if r.get('actual') is not None]
    def stats(items):
        n=len(items)
        raw_correct=sum((r.get('raw_probability',r['probability'])>=.5)==(r['actual']>0) for r in items)
        corrected=sum((r['probability']>=.5)==(r['actual']>0) for r in items)
        return {'matured':n,'raw_correct':int(raw_correct),'corrected_correct':int(corrected),'raw_accuracy':raw_correct/n if n else None,'corrected_accuracy':corrected/n if n else None,'brier':float(np.mean([(r['probability']-float(r['actual']>0))**2 for r in items])) if n else None,'raw_brier':float(np.mean([(r.get('raw_probability',r['probability'])-float(r['actual']>0))**2 for r in items])) if n else None}
    by_code={code:{str(h):stats([r for r in mature if r['code']==code and r['horizon']==h]) for h in (5,20)} for code in books}
    return {'issued':len(rows), **stats(mature), 'by_code':by_code,'note':'方向正确率按概率>=50%判断上涨，实际收益>0算上涨；只统计到期记录，日更预测的区间存在重叠，非独立样本。'}
