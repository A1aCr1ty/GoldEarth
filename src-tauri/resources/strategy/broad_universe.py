"""Discover the current Shanghai/Shenzhen A-share universe without a 2015 IPO cutoff."""
import json
import os
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
import pandas as pd

MINIMUM = 4000

def page(pn):
    url = ('https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData'
           f'?page={pn}&num=100&sort=symbol&asc=1&node=hs_a')
    for attempt in range(3):
        try:
            req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0','Referer':'https://quote.eastmoney.com/'})
            with urllib.request.urlopen(req,timeout=20) as response:
                data=json.load(response) or []
            return [{'f12':r['code'],'f14':r['name'],'f100':'未分类'} for r in data if str(r.get('symbol','')).startswith(('sh','sz'))]
        except Exception:
            time.sleep(attempt+1)
    raise RuntimeError(f'A股列表第{pn}页获取失败，保留旧股票池')

def load(directory):
    path=os.path.join(directory,'broad_universe.csv')
    if os.path.exists(path) and time.time()-os.path.getmtime(path)<7*86400:
        cached=pd.read_csv(path,dtype={'code':str})
        if len(cached)>=MINIMUM:
            return cached
    with ThreadPoolExecutor(max_workers=4) as pool:
        pages=list(pool.map(page,range(1,61)))
    rows={}
    for items in pages:
        for row in items:
            code=str(row.get('f12') or '')
            if len(code)!=6 or not code.isdigit(): continue
            name=str(row.get('f14') or code)
            if 'ST' in name.upper() or '退' in name: continue
            rows[code]={'code':code,'name':str(row.get('f14') or code),'sector':str(row.get('f100') or '其他'),'listed':row.get('f26')}
    if len(rows)<MINIMUM:
        raise RuntimeError(f'列表去重后仅{len(rows)}只，至少需要4000只，停止发布')
    frame=pd.DataFrame(sorted(rows.values(),key=lambda r:r['code']))
    frame.to_csv(path,index=False)
    return frame
