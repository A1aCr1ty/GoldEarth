import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path
import numpy as np
import pandas as pd
from value_lab import collect, price_features, join_financials, samples, split, fit, predict, export, save, FIN

SCRATCH = Path(__file__).resolve().parents[3] / '.runlogs'


class ValueResearchTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        SCRATCH.mkdir(exist_ok=True)

    def test_progress_replace_retries_windows_sharing_error(self):
        locked = PermissionError('locked')
        locked.winerror = 5
        replace = Path.replace
        attempts = []

        def replace_after_unlock(path, target):
            attempts.append(path)
            if len(attempts) == 1:
                raise locked
            return replace(path, target)

        with tempfile.TemporaryDirectory(dir=SCRATCH) as temp, patch.object(Path, 'replace', replace_after_unlock):
            target = Path(temp) / 'collection.json'
            save(target, {'completed': 696})
            self.assertEqual(len(attempts), 2)
            self.assertEqual(list(Path(temp).iterdir()), [target])

    def test_resume_uses_newer_pending_and_retries_failed_price(self):
        with tempfile.TemporaryDirectory(dir=SCRATCH) as temp:
            root = Path(temp)
            codes = ['001220', '001232', '001399']
            save(root / 'value/universe.json', [{'code': code} for code in codes])
            status = dict(started_at='original', requested=3, completed=1, prices=0,
                          financials=1, failures=[dict(code=codes[0], kind='price')])
            save(root / 'value/collection.json', status)
            save(root / 'value/collection.pending', dict(status, completed=2, prices=1, financials=2))
            with patch('build_platform.load_code', return_value=pd.DataFrame()) as prices, \
                 patch('value_lab.cached_financials') as financials, patch('value_lab.time.sleep'):
                result = collect(root, 3)
            self.assertEqual([call.args[0] for call in prices.call_args_list], [codes[0], codes[2]])
            financials.assert_called_once_with(codes[2], root / 'value')
            self.assertEqual((result['completed'], result['prices'], result['financials']), (3, 3, 3))
            self.assertEqual(result['failures'], [])

    def prices(self, count=2500):
        rng = np.random.default_rng(42)
        close = 100 * np.exp(np.cumsum(rng.normal(.0002, .012, count)))
        return pd.DataFrame(dict(date=pd.bdate_range('2012-01-01', periods=count),
            open=close*.998, close=close, high=close*1.01, low=close*.99, volume=rng.uniform(100,1000,count)))

    def test_future_prices_do_not_change_past_features(self):
        data = self.prices(900)
        first = price_features(data)
        data.loc[700:, ['open','close','high','low']] *= 10
        second = price_features(data)
        pd.testing.assert_frame_equal(first.iloc[:700], second.iloc[:700])

    def test_new_download_never_backfills_notice_date(self):
        frame = pd.DataFrame({'date': pd.to_datetime(['2020-06-01', '2025-01-01', '2025-01-02'])})
        record = dict(report_date='2024-09-30', published_on='2024-10-30', observed_at='2025-01-01T12:00:00+00:00',
                      available_on='2024-10-30', source='https://example.org/report', roe=.2)
        joined = join_financials(frame, [record])
        self.assertTrue(pd.isna(joined.roe.iloc[0]))
        self.assertTrue(pd.isna(joined.roe.iloc[1]))
        self.assertEqual(joined.roe.iloc[2], .2)

    def test_verified_revision_only_changes_future(self):
        frame = pd.DataFrame({'date': pd.to_datetime(['2024-11-01','2024-12-02'])})
        old = dict(report_date='2024-09-30', published_on='2024-10-30', observed_at='2025-01-01',
                   available_on='2024-10-30', source='report', vintage_verified=True, vintage_evidence='original-sha256', roe=.1)
        new = dict(old, published_on='2024-12-01', available_on='2024-12-01', roe=.2)
        joined = join_financials(frame, [old,new])
        self.assertEqual(list(joined.roe), [.1,.2])

    def test_labels_and_purged_splits(self):
        frame = price_features(self.prices())
        panel = samples(frame, frame, 126)
        self.assertTrue(np.allclose(panel.target, 0))
        self.assertTrue((panel.entry_date > panel.date).all())
        a,v,t = split(pd.concat([panel]*5, ignore_index=True))
        self.assertLess(a.end_date.max(), v.date.min())
        self.assertLess(v.end_date.max(), t.date.min())
        self.assertTrue(set(a.date).isdisjoint(t.date))

    def test_suspended_stock_does_not_invent_month_end(self):
        benchmark = price_features(self.prices())
        month_end = benchmark.groupby(benchmark.date.dt.to_period('M')).date.max().iloc[20]
        stock = benchmark[benchmark.date != month_end].reset_index(drop=True)
        panel = samples(stock, benchmark, 63)
        self.assertFalse((panel.date.dt.to_period('M') == month_end.to_period('M')).any())

    def test_onnx_matches_unseen_inputs(self):
        try:
            import onnx
            import onnxruntime
        except ImportError:
            self.skipTest('ONNX dependencies not installed')
        rng = np.random.default_rng(7)
        x = rng.normal(size=(200,5))
        y = x @ np.array([.2,-.1,.03,.04,.1]) + .05
        model = fit(x[:100], y[:100], 1)
        with tempfile.TemporaryDirectory(dir=SCRATCH) as temp:
            error, session = export(model, list('abcde'), Path(temp)/'model.onnx', x[100:])
            self.assertLess(error, 1e-5)
        self.assertLess(np.mean(abs(predict(model,x[100:])-y[100:])), .02)


if __name__ == '__main__':
    unittest.main()
