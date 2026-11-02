"""On-demand per-holding backtests and auditable forecast corrections."""
import contextlib
import json
import os
import sys
import numpy as np
import pandas as pd
import build_platform as bp
import strategy_lab as lab
import prediction_review
import fusion_model


def main(codes):
    with open(os.path.join(lab.ROOT,'snapshot.json'),encoding='utf-8') as f:
        snapshot=json.load(f)
    selected=snapshot['adaptive']['selected']
    stocks=[]; errors=[]
    with contextlib.redirect_stdout(sys.stderr):
        index=bp.load_code('000300')
        if index is None: raise ValueError('沪深300行情不可用')
        regime, macro=bp.build_regime(index)
        for code in codes:
            try:
                frame=bp.load_code(code)
                if frame is None or len(frame)<400 or 'volume' not in frame or not np.isfinite(frame['volume']).all():
                    raise ValueError('需要至少400根完整量价日线')
                stocks.append({'code':code,'name':code,'book':lab.enrich(bp.prepare(frame))})
            except Exception as e: errors.append({'code':code,'error':str(e)})
    forecasts=[]; items=[]
    for stock in stocks:
        code,b=stock['code'],stock['book']
        daily,trades=lab.execute(code,b,lab.raw_signal(b,selected,regime))
        forecasts.append({'code':code,'forecast':lab.forecast_stock(stock)})
        close=pd.Series(b['close']); high=pd.Series(b['high']); low=pd.Series(b['low'])
        atr=float(b['atr14'][-1])
        items.append({'code':code,'asof':b['date'][-1],'adjusted_close':float(close.iloc[-1]),
                      'ma5':float(b['ma5'][-1]),'ma20':float(b['ma20'][-1]),'atr14':atr,
                      'support20':float(low.iloc[-20:].min()),'resistance20':float(high.iloc[-20:].max()),
                      'technical':fusion_model.technical(b),'backtest':lab.metrics(daily,lab.VALID_END,None),
                      'trades':lab.trade_metrics([t for t in trades if t['exit']>=lab.VALID_END])})
    review=prediction_review.review(os.path.join(lab.ROOT,'platform','swing_prediction_ledger.json'),forecasts,stocks)
    for item,forecast in zip(items,forecasts):
        item['forecast']=forecast['forecast']; item['prediction_review']=review['by_code'][item['code']]
    return {'model':selected['name'],'model_asof':snapshot['adaptive']['asof'],
            'generated':pd.Timestamp.now(tz='Asia/Shanghai').isoformat(),'macro':macro,'items':items,'errors':errors,
            'prediction_note':review['note'],'validated':False,
            'note':'逐股回测是当前冻结策略回溯，不是个人实际波段收益；融合基本面尚未完成验证。预测上涨概率与交易胜率分别统计，不保证修正后更准确。'}

if __name__=='__main__':
    try:
        result=main(json.loads(sys.argv[1]))
        print(json.dumps(result,ensure_ascii=False,allow_nan=False))
    except Exception as e:
        print(str(e),file=sys.stderr); sys.exit(1)
