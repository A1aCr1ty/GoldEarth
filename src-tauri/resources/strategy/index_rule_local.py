import json
import sys

import pandas as pd

from index_grid import backtest as natr_backtest, public_result as natr_public
from index_rule_strategies import classic_grid_backtest, oversold_swing_backtest, public_result


def run_natr(frame):
    candidates = []
    for period in (60, 120):
        for step in (0.5, 1.0, 1.5):
            try:
                result = natr_backtest(frame, period, step, '2022-01-01', '2023-12-31', trend_filter=True)
            except ValueError:
                continue
            if result['days'] >= 180 and result['sell_trades'] >= 3:
                score = result['annual_return'] - result['max_drawdown']
                candidates.append((score, result['win_rate'] or 0, period, step, result))
    if candidates:
        _, _, period, step, training = max(candidates, key=lambda value: (value[0], value[1]))
    else:
        period, step, training = 120, 1.0, None
    end = str(frame['date'].max())
    return {
        'training': natr_public(training) if training else None,
        'selected': natr_public(natr_backtest(frame, period, step, '2024-01-01', end, trend_filter=True)),
        'grid_only': natr_public(natr_backtest(frame, period, step, '2024-01-01', end)),
        'baseline': natr_public(natr_backtest(frame, 120, 1.0, '2024-01-01', end)),
    }


def main():
    payload = json.load(sys.stdin)
    code = str(payload['code'])
    bars = payload['bars']
    if not isinstance(bars, list) or len(bars) < 60 or len(bars) > 5000:
        raise ValueError('本地回测需要60至5000根日线')
    frame = pd.DataFrame(bars)
    result = {
        'code': code,
        'grid': public_result(classic_grid_backtest(frame)),
        'oversold': public_result(oversold_swing_backtest(frame)),
        'natr': run_natr(frame) if len(frame) >= 122 else None,
    }
    json.dump(result, sys.stdout, ensure_ascii=False, allow_nan=False)


if __name__ == '__main__':
    main()
