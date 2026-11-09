import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import numpy as np
import pandas as pd
from value_evaluation import simulate, fee, block_interval, fit_candidate, export_candidate, explain_predictions, scoring_date, next_close_levels, walk_forward, TECH
from value_lab import price_features


class EvaluationTests(unittest.TestCase):
    def fixture(self):
        days=pd.bdate_range('2023-01-02','2023-06-30')
        prices=pd.DataFrame({'600001':10.,'600002':20.},index=days)
        prior=prices.copy()
        scores=pd.DataFrame({'date':pd.to_datetime(['2023-01-31','2023-02-28','2023-03-31']),
                             'code':'600001','score':1.})
        return scores,prices,prior

    def test_constant_price_loses_exactly_costs_and_expenses(self):
        scores,prices,prior=self.fixture()
        result=simulate(scores,prices,prior,capital=10000,monthly_fee=100,top=1)
        self.assertAlmostEqual(result['net_profit'],-result['trading_cost']-result['service_fees'],places=6)
        self.assertEqual(result['coverage_rate'],0)
        self.assertTrue(all(t['date']>'2023-01-31' for t in result['trades']))
        self.assertTrue(all(r['cash']>=-1e-6 for r in result['equity']))

    def test_missing_open_does_not_fill_from_future(self):
        scores,prices,prior=self.fixture()
        prices.loc['2023-02-01','600001']=np.nan
        result=simulate(scores,prices,prior,monthly_fee=0,top=1)
        self.assertFalse(any(t['date']=='2023-02-01' for t in result['trades']))
        self.assertGreater(result['blocked']['missing'],0)

    def test_open_gap_blocks_fill_without_using_daily_high_low(self):
        scores,prices,prior=self.fixture()
        prices.loc['2023-02-01','600001']=11
        result=simulate(scores,prices,prior,monthly_fee=0,top=1)
        self.assertFalse(any(t['date']=='2023-02-01' for t in result['trades']))
        self.assertGreater(result['blocked']['gap_guard'],0)

    def test_stamp_date_and_minimum_commission(self):
        self.assertAlmostEqual(fee(1000,'buy','2023-08-01',slippage=0),5)
        self.assertAlmostEqual(fee(1000,'sell','2023-08-27',slippage=0),6)
        self.assertAlmostEqual(fee(1000,'sell','2023-08-28',slippage=0),5.5)

    def test_risk_budget_limits_allocation_and_retains_cash(self):
        scores,prices,prior=self.fixture()
        scores['risk_exposure']=.25
        result=simulate(scores,prices,prior,capital=10000,monthly_fee=0,top=1)
        self.assertGreater(result['equity'][0]['cash'],7500)
        self.assertLess(sum(t['amount'] for t in result['trades'] if t['date']=='2023-02-01'),2500)
        scores['risk_exposure']=2.
        with self.assertRaises(ValueError): simulate(scores,prices,prior)

    def test_unpayable_fees_reduce_equity_and_stop_on_insolvency(self):
        scores,prices,prior=self.fixture()
        result=simulate(scores,prices,prior,capital=100,monthly_fee=200,top=1)
        self.assertTrue(result['insolvent'])
        self.assertLessEqual(result['final_equity'],0)

    def test_bootstrap_deterministic_and_excludes_partial(self):
        rows=[{'net_return':.01,'partial':False} for _ in range(24)]+[{'net_return':10,'partial':True}]
        interval=block_interval(rows)
        np.testing.assert_allclose(interval['mean_monthly_95pct'],[.01,.01])

    def training_frame(self):
        rng=np.random.default_rng(12)
        x=rng.normal(size=(1000,len(TECH))).astype(np.float32)
        frame=pd.DataFrame(x,columns=TECH)
        for i,key in enumerate(TECH): frame['rank_'+key]=np.tanh(x[:,i])*.5
        frame['target']=x[:,0]*.1+x[:,1]**2*.02
        frame['target_rank']=np.tanh(frame.target)
        frame['date']=pd.bdate_range('2017-01-01',periods=len(frame))
        frame['end_date']=frame.date+pd.Timedelta(days=180)
        frame['is_month_end']=True
        frame['code']='600001'
        return frame

    def test_all_candidates_onnx(self):
        frame=self.training_frame()
        scratch=Path(__file__).resolve().parents[3]/'.runlogs'
        with tempfile.TemporaryDirectory(dir=scratch) as temp:
            for name in ('ridge','rank_ridge','hist_rank'):
                model,features=fit_candidate(name,frame.iloc[:800])
                error=export_candidate(model,features,Path(temp)/f'{name}.onnx',frame.iloc[800:][features].to_numpy())
                self.assertLess(error,1e-5)

    def test_explanations_reconcile_score_by_stock_code(self):
        frame = self.training_frame()
        model, features = fit_candidate('hist_rank', frame.iloc[:800])
        latest = frame.iloc[800:805].assign(code=['600001','600002','600003','600004','600005'],
                                            date=pd.Timestamp('2025-01-02'))
        x = latest[features].to_numpy(np.float32)
        predictions = [dict(code=code, score=float(score), asof='2025-01-02')
                       for code, score in zip(latest.code, model.predict(x))]
        predictions.reverse()
        scratch = Path(__file__).resolve().parents[3] / '.runlogs'
        with tempfile.TemporaryDirectory(dir=scratch) as temp:
            artifact = Path(temp) / 'candidate.onnx'
            export_candidate(model, features, artifact, x)
            explain_predictions(artifact, features, latest, predictions)
            self.assertAlmostEqual(predictions[0]['analysis']['metrics']['ma120'], latest.ma120.iloc[-1])
            self.assertTrue(any(predictions[0]['analysis']['impacts'].values()))
            predictions[0]['score'] += 1
            with self.assertRaisesRegex(ValueError, '复算评分'):
                explain_predictions(artifact, features, latest, predictions)

    def test_scoring_date_avoids_partial_market_refresh(self):
        older, newer = pd.to_datetime(['2026-11-06', '2026-11-09'])
        panel = pd.DataFrame({'date': [older] * 100 + [newer] * 51})
        self.assertEqual(scoring_date(panel), older)
        self.assertEqual(scoring_date(pd.DataFrame({'date': [older] * 100 + [newer] * 97})), newer)

    def test_price_levels_match_next_close_indicator_signs(self):
        rng = np.random.default_rng(121)
        closes = pd.Series(30 + rng.normal(0, 1, 300).cumsum() / 3)
        levels = next_close_levels(closes).iloc[-1]
        for indicator, level in [('ma120', 'ma120_next'), ('momentum126', 'momentum126_next'),
                                 ('macd_hist', 'macd_next')]:
            for change in (-.01, .01):
                price = pd.concat([closes, pd.Series([levels[level] + change])], ignore_index=True)
                frame = pd.DataFrame(dict(date=pd.bdate_range('2024-01-01', periods=len(price)),
                                          open=price, close=price, high=price*1.01, low=price*.99, volume=100))
                self.assertEqual(np.sign(price_features(frame)[indicator].iloc[-1]), np.sign(change))

    def test_walk_forward_labels_end_before_predict_year(self):
        frame=self.training_frame()
        with patch('value_evaluation.progress'):
            _,folds=walk_forward(Path('.'),frame,'rank_ridge')
        self.assertGreater(len(folds),0)
        for fold in folds:
            self.assertLess(fold['train_last_label'],f"{fold['year']}-01-01")


if __name__=='__main__': unittest.main()
