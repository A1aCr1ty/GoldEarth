"""Refresh current fusion diagnostics without relabelling old backtests."""
import json
import os
import pandas as pd
import build_platform as bp
import strategy_lab as lab
import fusion_model

if __name__ == '__main__':
    with open(lab.OUT,encoding='utf-8') as f: payload=json.load(f)
    stocks=[]
    for i,row in enumerate(payload['operations']):
        frame=pd.read_csv(os.path.join(bp.DATA,row['code']+'.csv'))
        frame['date']=pd.to_datetime(frame['date'])
        stocks.append({'code':row['code'],'book':lab.enrich(bp.prepare(frame))})
        if i%500==0: print('fusion',i,flush=True)
    index=pd.read_csv(os.path.join(bp.DATA,'000300.csv'))
    index['date']=pd.to_datetime(index['date'])
    payload['fusion']=fusion_model.build(stocks,index,lab.ROOT)
    with open(os.path.join(lab.ROOT,'research_sources.json'),encoding='utf-8') as f: payload['sources']=json.load(f)
    pending=lab.OUT+'.pending'
    with open(pending,'w',encoding='utf-8') as f: json.dump(payload,f,ensure_ascii=False,indent=2,allow_nan=False)
    os.replace(pending,lab.OUT)
    print('fusion complete',len(stocks),payload['fusion']['fundamental_covered'],flush=True)
