import unittest
import tempfile
import os
import numpy as np
import pandas as pd
import strategy_lab as lab
import prediction_review
import broad_universe
import fusion_model
from unittest.mock import patch

class ResearchTests(unittest.TestCase):
    def test_forecast_score_uses_only_settled_predictions(self):
        import json
        b=self.book(50)
        rows=[{'code':'000001','asof':b['date'][1],'horizon':5,'probability':.7,'raw_probability':.4,'actual':None},
              {'code':'000001','asof':b['date'][-1],'horizon':5,'probability':.7,'raw_probability':.4,'actual':None}]
        b['open']=np.arange(50,dtype=float)+10
        with tempfile.TemporaryDirectory(dir=os.path.dirname(__file__)) as root:
            path=os.path.join(root,'ledger.json')
            with open(path,'w',encoding='utf-8') as f: json.dump(rows,f)
            result=prediction_review.review(path,[],[{'code':'000001','book':b}])
            scores=result['by_code']['000001']['5']
            self.assertEqual(scores['matured'],1)
            self.assertEqual(scores['raw_accuracy'],0)
            self.assertEqual(scores['corrected_accuracy'],1)
    def test_financials_ignore_future_publications_and_missing_data(self):
        row={'code':'000001','published_on':'2026-11-03','source':'test','revenue_growth':.3,'gross_margin_change':.01,'operating_cashflow':100,'net_profit':100,'roe':.2,'valuation_percentile':.5}
        self.assertEqual(fusion_model.fundamentals([row],'000001','2026-11-02')['status'],'unknown')
        row['published_on']='2026-10-30'
        self.assertEqual(fusion_model.fundamentals([row],'000001','2026-11-02')['status'],'pass')
        row['operating_cashflow']=-1
        self.assertEqual(fusion_model.fundamentals([row],'000001','2026-11-02')['status'],'fail')
    def test_repeated_list_pages_cannot_satisfy_4000_requirement(self):
        repeated = [{'f12':f'{i:06d}','f14':'sample','f100':'test'} for i in range(100)]
        with tempfile.TemporaryDirectory(dir=os.path.dirname(__file__)) as root:
            with patch.object(broad_universe,'page',return_value=repeated):
                with self.assertRaisesRegex(RuntimeError,'100'):
                    broad_universe.load(root)

    def test_streaming_aggregate_matches_daily_mean_with_different_listing_dates(self):
        dates=pd.date_range('2020-01-01',periods=30)
        a=pd.DataFrame({'hold':.01,'strategy':.005,'position':1.,'turnover':0.},index=dates)
        b=pd.DataFrame({'hold':.02,'strategy':.01,'position':.5,'turnover':0.},index=dates[10:])
        stocks=[{'code':'000001','book':{}},{'code':'000002','book':{}}]
        with patch.object(lab,'raw_signal',return_value=np.array([])), patch.object(lab,'execute',side_effect=[(a,[]),(b,[])]):
            result=lab.run_candidate(stocks,{}, {'name':'test'})['_daily']
        expected=pd.concat([a,b]).groupby(level=0).mean()
        pd.testing.assert_frame_equal(result,expected,check_freq=False)
    def test_revised_five_halves_once_without_ma20_exit(self):
        b = self.book(70)
        for key in ['close','open','ma5','ma20']: b[key] = np.full(70,10.)
        b['volume'] = b['volume'].copy()
        b['close'][60] = 10.5
        b['volume'][57:61] = [100,150,200,300]
        b['close'][61:] = 9.2
        b['ma20'][61:] = 9.5
        gate = {d:1 for d in b['date']}
        p = next(p for p in lab.research_rules.candidates() if p['kind']=='chang_five_v2' and p['stop_pct']==.20)
        signal = lab.raw_signal(b,p,gate)
        self.assertEqual(signal[60],1)
        self.assertEqual(signal[61],.5)
        self.assertEqual(signal[62],.5)
    def book(self,n=200):
        c = 10 + np.sin(np.arange(n)/5) + np.arange(n)/100
        return lab.enrich({'date':pd.date_range('2020-01-01',periods=n).strftime('%Y-%m-%d').tolist(), 'open':c.copy(),'close':c,'high':c+.5,'low':c-.5,'volume':np.full(n,1000.),'rsi':np.full(n,50.)})
    def test_signals_do_not_read_future(self):
        full = self.book()
        short = {k:v[:150] for k,v in full.items()}
        gate = {d:1 for d in full['date']}
        for p in lab.research_rules.candidates():
            np.testing.assert_array_equal(lab.raw_signal(full,p,gate)[:150],lab.raw_signal(short,p,gate))
    def test_unmatured_forecast_not_scored_and_idempotent(self):
        b = self.book()
        holdings = [{'code':'000001','forecast':{'asof':b['date'][-1],'horizons':{'5':{'probability_up':.6,'reliable':False}}}}]
        with tempfile.TemporaryDirectory(dir=os.path.dirname(__file__)) as root:
            path = os.path.join(root,'ledger.json')
            for _ in range(2):
                result = prediction_review.review(path,holdings,[{'code':'000001','book':b}])
                self.assertEqual(result['issued'],1)
                self.assertEqual(result['matured'],0)
                self.assertIsNone(result['brier'])

if __name__ == '__main__': unittest.main()
