# -*- coding: utf-8 -*-
import unittest

import numpy as np

from strategy_lab import BUY_COST, SELL_COST, execute


class ExecutionTests(unittest.TestCase):
    def book(self, opens):
        n = len(opens)
        return {
            "date": [f"2026-01-{i + 1:02d}" for i in range(n)],
            "open": np.array(opens, dtype=float),
            "close": np.full(n, 10.0),
        }

    def test_close_signal_enters_next_open(self):
        daily, trades = execute("000001", self.book([10, 10.5, 12, 13, 14]), np.array([1, 0, 0, 0, 0], dtype=float))
        self.assertAlmostEqual(daily["position"].iloc[0], 1.0)
        self.assertAlmostEqual(daily["strategy"].iloc[0], 12 / 10.5 - 1 - BUY_COST)
        self.assertEqual(trades[0]["entry"], "2026-01-02")

    def test_limit_up_open_blocks_entry(self):
        daily, trades = execute("000001", self.book([10, 11, 12, 13, 14]), np.array([1, 0, 0, 0, 0], dtype=float))
        self.assertEqual(daily["position"].max(), 0.0)
        self.assertEqual(trades, [])

    def test_partial_position_round_trip_includes_all_cash_flows(self):
        daily, trades = execute("000001", self.book([10, 10, 12, 14, 16, 18]), np.array([1, 0.5, 0, 0, 0, 0], dtype=float))
        self.assertAlmostEqual(daily["position"].iloc[0], 1.0)
        self.assertAlmostEqual(daily["position"].iloc[1], 0.5)
        invested = 10 * (1 + BUY_COST)
        proceeds = (0.5 * 12 + 0.5 * 14) * (1 - SELL_COST)
        self.assertEqual(len(trades), 1)
        self.assertAlmostEqual(trades[0]["return"], proceeds / invested - 1.0)


if __name__ == "__main__":
    unittest.main()
