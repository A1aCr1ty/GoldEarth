import unittest
import pandas as pd

from index_rule_strategies import (
    classic_grid_backtest,
    oversold_indicators,
    oversold_swing_backtest,
    profit_retaining_quantity,
)


def frame(prices, volumes=None, positive_cmf=False):
    dates = pd.bdate_range('2020-01-01', periods=len(prices)).strftime('%Y-%m-%d')
    return pd.DataFrame({
        'date': dates, 'open': prices, 'close': prices,
        'high': [price + 0.02 if positive_cmf else price * 1.01 for price in prices],
        'low': [price - 0.2 if positive_cmf else price * 0.99 for price in prices],
        'volume': volumes or [1000000] * len(prices),
    })


class ClassicGridTest(unittest.TestCase):
    def test_equal_grid_trades_complete_cycles_with_costs_and_benchmark(self):
        history = [9, 9.5, 10, 10.5, 11] * 12
        prices = history + [10, 9.5, 9, 9.4, 9.8, 10.4, 10.8, 11, 10.4, 9.8, 9.3, 9.8, 10.4]
        result = classic_grid_backtest(frame(prices), lookback=60, step_pct=0.05)
        self.assertGreater(result['trades'], 4)
        self.assertGreater(result['sell_trades'], 0)
        self.assertIsNotNone(result['win_rate'])
        self.assertIn('buyhold100_return', result)
        for trade in result['trade_log']:
            self.assertEqual(trade['quantity'] % 100, 0)
            self.assertGreater(trade['commission'], 0)
            self.assertGreaterEqual(trade['price'], 0)

    def test_atr_step_is_bounded_and_pyramid_budgets_increase(self):
        history = [9, 9.5, 10, 10.5, 11] * 12
        prices = history + [10, 9.5, 9, 8.5, 8.2, 8.0]
        result = classic_grid_backtest(frame(prices), lookback=60, allocation='pyramid')
        self.assertGreaterEqual(result['latest']['step_pct'], 0.02)
        self.assertLessEqual(result['latest']['step_pct'], 0.05)
        buys = [trade for trade in result['trade_log'] if trade['side'] == 'buy']
        self.assertGreater(len(buys), 1)
        self.assertGreater(buys[1]['budget_weight'], buys[0]['budget_weight'])

    def test_break_protection_stops_adding_below_lower_boundary(self):
        prices = [9, 9.5, 10, 10.5, 11] * 12 + [8, 7, 6, 5, 4, 3]
        result = classic_grid_backtest(frame(prices), lookback=60, step_pct=0.05)
        self.assertTrue(result['latest']['break_protection'])
        self.assertEqual(result['latest']['next_action'], 'stop_adding')
        self.assertGreater(result['protection_days'], 0)

    def test_profit_mode_keeps_share_difference_out_of_future_grid_lots(self):
        self.assertEqual(profit_retaining_quantity(100, 1005, 10.5), 95)
        history = [9, 9.5, 10, 10.5, 11] * 12
        prices = history + [10, 9, 9.2, 10.5, 11, 11.5]
        result = classic_grid_backtest(frame(prices), lookback=60, step_pct=0.05, leave_profit=True)
        self.assertGreater(result['retained_shares'], 0)
        sells = [trade for trade in result['trade_log'] if trade['side'] == 'sell']
        self.assertTrue(any(trade['retained_quantity'] > 0 for trade in sells))


class OversoldSwingTest(unittest.TestCase):
    def test_indicators_use_expected_bias_wr_and_positive_cmf(self):
        prices = [10] * 30 + [9, 8, 7]
        data = oversold_indicators(frame(prices, positive_cmf=True))
        latest = data.iloc[-1]
        self.assertLess(latest.bias20, -6)
        self.assertGreater(latest.wr14, 85)
        self.assertGreater(latest.cmf20, 0)
        self.assertGreater(latest.prior_low, latest.low)
        self.assertTrue(pd.notna(latest.supertrend), 'SuperTrend must initialize at the first valid ATR')

    def test_double_confirmation_opens_swing_and_recovery_closes_only_swing(self):
        history = [12 - i * 0.01 for i in range(260)]
        bottom = 7.5
        decline = [history[-1] - (i + 1) * (history[-1] - bottom) / 6 for i in range(6)] + [7.6]
        recovery = [7.6 + i * 0.25 for i in range(1, 13)]
        prices = history + decline + recovery + [12.72] * 5
        result = oversold_swing_backtest(frame(prices, positive_cmf=True))
        kinds = [trade.get('kind') for trade in result['trade_log']]
        self.assertIn('base', kinds)
        self.assertIn('swing', kinds)
        self.assertIn('right', kinds)
        self.assertGreaterEqual(result['swing_round_trips'], 1)
        self.assertEqual(result['latest']['swing_current_weight'], 0)
        self.assertGreater(result['latest']['base_current_weight'], 0)

    def test_volume_break_or_hard_stop_exits_swing_but_keeps_base(self):
        prices = [12] * 260 + [11, 10, 9, 8, 7.2, 6.9, 6.8, 6.7, 6.8, 6.6, 6.3, 6.0, 5.5]
        volumes = [1000000] * (len(prices) - 1) + [3000000]
        result = oversold_swing_backtest(frame(prices, volumes=volumes))
        self.assertGreaterEqual(result['stop_exits'], 1)
        self.assertEqual(result['latest']['swing_current_weight'], 0)
        self.assertGreater(result['latest']['base_current_weight'], 0)
        stops = [trade for trade in result['trade_log'] if trade.get('reason') == 'stop']
        self.assertTrue(stops)

    def test_invalid_risk_configuration_is_rejected(self):
        with self.assertRaises(ValueError):
            oversold_swing_backtest(frame([10] * 100), stop_pct=0.1)
        with self.assertRaises(ValueError):
            classic_grid_backtest(frame([10] * 100), step_pct=0.1)


if __name__ == '__main__':
    unittest.main()
