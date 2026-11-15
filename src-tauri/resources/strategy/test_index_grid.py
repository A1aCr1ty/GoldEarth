import unittest
import pandas as pd
from index_grid import backtest


def frame(prices):
    dates = pd.bdate_range('2024-01-01', periods=len(prices)).strftime('%Y-%m-%d')
    return pd.DataFrame({
        'date': dates, 'open': prices, 'close': prices,
        'high': [price * 1.01 for price in prices], 'low': [price * 0.99 for price in prices],
        'volume': [1000000] * len(prices),
    })


class IndexGridTest(unittest.TestCase):
    def test_constant_price_keeps_half_position_without_grid_churn(self):
        result = backtest(frame([10.0] * 80), period=20, step=1)
        self.assertEqual(result['trades'], 1)
        self.assertEqual(result['sell_trades'], 0)
        self.assertIsNone(result['win_rate'])
        self.assertLess(result['total_return'], 0)
        self.assertEqual(result['latest']['next_action'], 'hold')

    def test_zigzag_trades_in_lots_once_per_day_and_has_audit_metrics(self):
        prices = [10.0] * 20 + [10.0, 9.5, 9.0, 9.5, 10.0, 10.5, 11.0, 10.5, 10.0, 9.5, 9.0, 9.5, 10.0, 10.5, 11.0, 10.5, 10.0]
        result = backtest(frame(prices), period=20, step=0.5)
        self.assertGreater(result['trades'], 2)
        self.assertGreaterEqual(result['max_drawdown'], 0)
        self.assertIsNotNone(result['win_rate'])
        dates = set()
        for trade in result['trade_log']:
            self.assertEqual(trade['quantity'] % 100, 0)
            self.assertNotIn(trade['date'], dates)
            dates.add(trade['date'])
        self.assertIn('buyhold100_return', result)
        self.assertIn('next_buy_price', result['latest'])

    def test_declining_market_limits_exposure_compared_with_full_buyhold(self):
        prices = [20.0] * 20 + [20 - i * 0.1 for i in range(40)]
        result = backtest(frame(prices), period=20, step=0.5)
        self.assertGreater(result['total_return'], result['buyhold100_return'])
        self.assertGreaterEqual(result['latest']['target_weight'], 0.5)

    def test_swing_filter_caps_bearish_grid_and_keeps_bullish_base(self):
        declining = [20.0] * 20 + [20 - i * 0.1 for i in range(40)]
        bear = backtest(frame(declining), period=20, step=0.5, trend_filter=True)
        self.assertLessEqual(bear['latest']['target_weight'], 0.2)
        self.assertEqual(bear['latest']['regime'], 'bear')
        rising = [10.0] * 20 + [10 + i * 0.1 for i in range(40)]
        bull = backtest(frame(rising), period=20, step=0.5, trend_filter=True)
        self.assertGreaterEqual(bull['latest']['target_weight'], 0.5)
        self.assertEqual(bull['latest']['regime'], 'bull')


if __name__ == '__main__':
    unittest.main()
