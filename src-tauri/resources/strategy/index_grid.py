import math
import numpy as np
import pandas as pd

INITIAL_CAPITAL = 100000.0
COMMISSION_RATE = 0.0001
MIN_COMMISSION = 5.0
SLIPPAGE = 0.0005


def _signal(frame, period, step, trend_filter):
    close = frame['close']
    previous = close.shift(1)
    tr = pd.concat([frame['high'] - frame['low'], (frame['high'] - previous).abs(), (frame['low'] - previous).abs()], axis=1).max(axis=1)
    atr = tr.rolling(period).mean()
    center = close.rolling(period).mean()
    natr = (close - center) / atr
    level = np.trunc((natr / step).fillna(0))
    valid = pd.Series(np.isfinite(natr.to_numpy(dtype=float)), index=natr.index)
    target = np.clip(0.5 - level * step * 0.1, 0, 1).where(valid)
    ma20 = close.rolling(20).mean()
    ma60 = close.rolling(60).mean()
    ema12 = close.ewm(span=12, adjust=False).mean()
    ema26 = close.ewm(span=26, adjust=False).mean()
    dif = ema12 - ema26
    dea = dif.ewm(span=9, adjust=False).mean()
    bull = (close > ma20) & (ma20 > ma60) & (dif > dea)
    bear = (close < ma20) & (ma20 < ma60) & (dif < dea)
    regime = pd.Series('neutral', index=frame.index).mask(bull, 'bull').mask(bear, 'bear')
    if trend_filter:
        target = target.mask(bull, np.maximum(target, 0.5)).mask(bear, np.minimum(target, 0.2))
    return center, atr, natr, level, target, regime


def backtest(frame, period=120, step=1.0, start=None, end=None, trend_filter=False):
    if period < 5 or step <= 0:
        raise ValueError('网格参数无效')
    data = frame.sort_values('date').drop_duplicates('date').reset_index(drop=True).copy()
    if len(data) < period + 2:
        raise ValueError('有效日线不足')
    center, atr, natr, level, target, regime = _signal(data, period, step, trend_filter)
    dates = data['date'].astype(str)
    eligible = pd.Series(True, index=data.index)
    if start:
        eligible &= dates >= start
    if end:
        eligible &= dates <= end
    indices = [i for i in range(period, len(data)) if eligible.iloc[i] and np.isfinite(target.iloc[i - 1])]
    if len(indices) < 2:
        raise ValueError('回测区间有效样本不足')
    cash = INITIAL_CAPITAL
    shares = 0
    lots = []
    trades = []
    equities = []
    first_open = None
    for i in indices:
        row = data.iloc[i]
        open_price = float(row.open)
        close_price = float(row.close)
        if min(open_price, close_price) <= 0:
            continue
        if first_open is None:
            first_open = open_price
        open_equity = cash + shares * open_price
        open_weight = shares * open_price / open_equity if open_equity > 0 else 0
        desired_weight = float(target.iloc[i - 1])
        if not equities:
            pass
        elif abs(desired_weight - open_weight) < 0.05:
            equities.append((str(row.date), cash + shares * close_price))
            continue
        desired_shares = math.floor(open_equity * desired_weight / open_price / 100) * 100
        delta = desired_shares - shares
        if delta > 0:
            price = open_price * (1 + SLIPPAGE)
            quantity = delta
            commission = max(MIN_COMMISSION, quantity * price * COMMISSION_RATE)
            if quantity * price + commission > cash:
                quantity = math.floor(max(cash - MIN_COMMISSION, 0) / (price * (1 + COMMISSION_RATE)) / 100) * 100
                commission = max(MIN_COMMISSION, quantity * price * COMMISSION_RATE) if quantity else 0
            if quantity > 0:
                cost = quantity * price + commission
                cash -= cost
                shares += quantity
                lots.append([quantity, cost])
                trades.append({'date': str(row.date), 'side': 'buy', 'quantity': quantity, 'price': price, 'commission': commission})
        elif delta < 0:
            price = open_price * (1 - SLIPPAGE)
            quantity = min(-delta, shares)
            if quantity > 0:
                commission = max(MIN_COMMISSION, quantity * price * COMMISSION_RATE)
                proceeds = quantity * price - commission
                remaining = quantity
                basis = 0.0
                while remaining and lots:
                    take = min(remaining, lots[0][0])
                    basis += lots[0][1] * take / lots[0][0]
                    lots[0][0] -= take
                    lots[0][1] *= 1 - take / (take + lots[0][0]) if take + lots[0][0] else 0
                    if lots[0][0] == 0:
                        lots.pop(0)
                    remaining -= take
                cash += proceeds
                shares -= quantity
                realized = proceeds - basis
                trades.append({'date': str(row.date), 'side': 'sell', 'quantity': quantity, 'price': price, 'commission': commission, 'realized': realized})
        equities.append((str(row.date), cash + shares * close_price))
    if not equities or first_open is None:
        raise ValueError('回测没有有效权益记录')
    last_equity = equities[-1][1]
    peak = -math.inf
    max_drawdown = 0.0
    for _, equity in equities:
        peak = max(peak, equity)
        max_drawdown = max(max_drawdown, (peak - equity) / peak if peak > 0 else 0)
    sells = [trade for trade in trades if trade['side'] == 'sell']
    wins = [trade for trade in sells if trade['realized'] > 0]
    first_date = equities[0][0]
    last_date = equities[-1][0]
    days = max((pd.Timestamp(last_date) - pd.Timestamp(first_date)).days, 1)
    final_close = float(data.iloc[indices[-1]].close)
    buyhold_returns = []
    for weight in (0.5, 1.0):
        price = first_open * (1 + SLIPPAGE)
        quantity = math.floor(INITIAL_CAPITAL * weight / (price * (1 + COMMISSION_RATE)) / 100) * 100
        commission = max(MIN_COMMISSION, quantity * price * COMMISSION_RATE)
        remaining_cash = INITIAL_CAPITAL - quantity * price - commission
        buyhold_returns.append((remaining_cash + quantity * final_close) / INITIAL_CAPITAL - 1)
    latest_center = float(center.iloc[indices[-1]])
    latest_atr = float(atr.iloc[indices[-1]])
    latest_natr = float(natr.iloc[indices[-1]])
    latest_level = int(level.iloc[indices[-1]])
    latest_target = float(target.iloc[indices[-1]])
    current_weight = shares * final_close / last_equity if last_equity > 0 else 0
    difference = latest_target - current_weight
    return {
        'period': period, 'step': step, 'start': first_date, 'end': last_date, 'days': days,
        'trend_filter': trend_filter,
        'final_equity': last_equity, 'total_return': last_equity / INITIAL_CAPITAL - 1,
        'annual_return': (last_equity / INITIAL_CAPITAL) ** (365 / days) - 1,
        'max_drawdown': max_drawdown, 'trades': len(trades), 'sell_trades': len(sells),
        'win_rate': len(wins) / len(sells) if sells else None,
        'buyhold50_return': buyhold_returns[0], 'buyhold100_return': buyhold_returns[1],
        'latest': {
            'date': last_date, 'close': final_close, 'center': latest_center, 'atr': latest_atr,
            'natr': latest_natr, 'current_weight': current_weight, 'target_weight': latest_target,
            'regime': str(regime.iloc[indices[-1]]),
            'next_buy_price': latest_center + (latest_level - 1) * step * latest_atr,
            'next_sell_price': latest_center + (latest_level + 1) * step * latest_atr,
            'next_action': 'buy' if difference >= 0.05 else 'sell' if difference <= -0.05 else 'hold',
        },
        'trade_log': trades,
    }


def public_result(result):
    return {key: value for key, value in result.items() if key != 'trade_log'}
