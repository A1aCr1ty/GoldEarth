import math
import numpy as np
import pandas as pd

from index_grid import INITIAL_CAPITAL, COMMISSION_RATE, MIN_COMMISSION, SLIPPAGE


def _clean(frame):
    data = frame.sort_values('date').drop_duplicates('date').reset_index(drop=True).copy()
    required = {'date', 'open', 'close', 'high', 'low', 'volume'}
    if not required.issubset(data.columns):
        raise ValueError('缺少回测所需日线字段')
    return data


def _indices(data, start, end, minimum=2):
    dates = data['date'].astype(str)
    eligible = pd.Series(True, index=data.index)
    if start:
        eligible &= dates >= start
    if end:
        eligible &= dates <= end
    indices = [i for i in range(1, len(data)) if eligible.iloc[i]]
    if len(indices) < minimum:
        raise ValueError('回测区间有效样本不足')
    return indices


def _buy(cash, budget, open_price):
    price = open_price * (1 + SLIPPAGE)
    quantity = math.floor(min(cash, budget) / (price * (1 + COMMISSION_RATE)) / 100) * 100
    commission = max(MIN_COMMISSION, quantity * price * COMMISSION_RATE) if quantity else 0.0
    while quantity and quantity * price + commission > cash:
        quantity -= 100
        commission = max(MIN_COMMISSION, quantity * price * COMMISSION_RATE) if quantity else 0.0
    if not quantity:
        return None
    return quantity, price, commission, quantity * price + commission


def _performance(equities, trades, first_open, final_close):
    if not equities or first_open is None:
        raise ValueError('回测没有有效权益记录')
    final_equity = equities[-1][1]
    peak = -math.inf
    max_drawdown = 0.0
    for _, equity in equities:
        peak = max(peak, equity)
        max_drawdown = max(max_drawdown, (peak - equity) / peak if peak > 0 else 0)
    sells = [trade for trade in trades if trade['side'] == 'sell']
    wins = [trade for trade in sells if trade.get('realized', 0) > 0]
    days = max((pd.Timestamp(equities[-1][0]) - pd.Timestamp(equities[0][0])).days, 1)
    buyhold = []
    for weight in (0.5, 1.0):
        bought = _buy(INITIAL_CAPITAL, INITIAL_CAPITAL * weight, first_open)
        if bought:
            quantity, price, commission, _ = bought
            remaining = INITIAL_CAPITAL - quantity * price - commission
            buyhold.append((remaining + quantity * final_close) / INITIAL_CAPITAL - 1)
        else:
            buyhold.append(0.0)
    return {
        'start': equities[0][0], 'end': equities[-1][0], 'days': days,
        'final_equity': final_equity, 'total_return': final_equity / INITIAL_CAPITAL - 1,
        'annual_return': (final_equity / INITIAL_CAPITAL) ** (365 / days) - 1,
        'max_drawdown': max_drawdown, 'trades': len(trades), 'sell_trades': len(sells),
        'win_rate': len(wins) / len(sells) if sells else None,
        'buyhold50_return': buyhold[0], 'buyhold100_return': buyhold[1],
    }


def profit_retaining_quantity(quantity, cost, sale_price):
    if quantity <= 0 or cost <= 0 or sale_price <= 0:
        return 0
    return min(quantity, max(0, math.floor(cost / sale_price)))


def _grid_spec(data, signal_index, lookback, step_pct, atr_multiple):
    if signal_index < 0:
        return None
    close = data['close']
    history = close.iloc[max(0, signal_index - lookback + 1):signal_index + 1]
    if len(history) < min(lookback, 60):
        return None
    lower = float(history.quantile(0.1))
    upper = float(history.quantile(0.9))
    previous = close.shift(1)
    tr = pd.concat([data['high'] - data['low'], (data['high'] - previous).abs(), (data['low'] - previous).abs()], axis=1).max(axis=1)
    atr = float(tr.iloc[max(0, signal_index - 13):signal_index + 1].mean())
    signal_close = float(close.iloc[signal_index])
    fraction = float(step_pct) if step_pct is not None else float(np.clip(atr_multiple * atr / signal_close, 0.02, 0.05))
    if not np.isfinite([lower, upper, atr, fraction]).all() or lower <= 0 or upper <= lower or fraction <= 0:
        return None
    count = max(2, min(50, math.ceil(math.log(upper / lower) / math.log1p(fraction))))
    levels = lower * np.power(1 + fraction, np.arange(count + 1))
    return lower, upper, atr, fraction, levels


def classic_grid_backtest(frame, lookback=250, step_pct=None, atr_multiple=0.5,
                          allocation='equal', max_open_grids=10, leave_profit=False,
                          start=None, end=None):
    if allocation not in ('equal', 'pyramid') or max_open_grids < 1:
        raise ValueError('网格资金分配参数无效')
    if step_pct is not None and not 0.02 <= step_pct <= 0.05:
        raise ValueError('静态网格步长需在2%到5%之间')
    data = _clean(frame)
    indices = _indices(data, start, end)
    cash = INITIAL_CAPITAL
    shares = 0
    lots = []
    level = None
    trades = []
    equities = []
    first_open = None
    retained_shares = 0
    protection_days = 0
    last_spec = None
    last_index = indices[-1]
    for i in indices:
        row = data.iloc[i]
        open_price = float(row.open)
        close_price = float(row.close)
        if min(open_price, close_price) <= 0:
            continue
        spec = _grid_spec(data, i - 1, lookback, step_pct, atr_multiple)
        if spec is None:
            continue
        lower, upper, atr, fraction, levels = spec
        last_spec = spec
        if first_open is None:
            first_open = open_price
        current_level = int(np.clip(np.searchsorted(levels, open_price, side='right') - 1, 0, len(levels) - 1))
        below_lower = open_price < lower
        if below_lower:
            protection_days += 1
        if level is None:
            level = current_level
        elif current_level < level and not below_lower:
            count = min(level - current_level, max_open_grids - len(lots))
            for step in range(count):
                multiplier = min(2.5, 1 + 0.5 * len(lots)) if allocation == 'pyramid' else 1.0
                bought = _buy(cash, INITIAL_CAPITAL / 10 * multiplier, open_price)
                if bought is None:
                    break
                quantity, price, commission, cost = bought
                cash -= cost
                shares += quantity
                buy_level = max(0, level - step - 1)
                lots.append({'quantity': quantity, 'cost': cost, 'level': buy_level})
                trades.append({'date': str(row.date), 'side': 'buy', 'quantity': quantity, 'price': price,
                               'commission': commission, 'level': buy_level, 'budget_weight': multiplier})
        elif current_level > level and lots:
            count = min(current_level - level, len(lots))
            price = open_price * (1 - SLIPPAGE)
            for _ in range(count):
                lot = lots.pop(0)
                original_quantity = lot['quantity']
                quantity = profit_retaining_quantity(original_quantity, lot['cost'], price) if leave_profit else original_quantity
                if quantity <= 0:
                    continue
                commission = max(MIN_COMMISSION, quantity * price * COMMISSION_RATE)
                proceeds = quantity * price - commission
                basis = lot['cost'] * quantity / original_quantity
                retained = original_quantity - quantity
                cash += proceeds
                shares -= quantity
                retained_shares += retained
                trades.append({'date': str(row.date), 'side': 'sell', 'quantity': quantity, 'price': price,
                               'commission': commission, 'level': lot['level'], 'realized': proceeds - basis,
                               'retained_quantity': retained})
        level = current_level
        equities.append((str(row.date), cash + shares * close_price))
    final_close = float(data.iloc[last_index].close)
    result = _performance(equities, trades, first_open, final_close)
    lower, upper, atr, fraction, levels = last_spec
    close_level = int(np.clip(np.searchsorted(levels, final_close, side='right') - 1, 0, len(levels) - 1))
    below_lower = final_close < lower
    result.update({
        'strategy': 'classic_grid', 'lookback': lookback, 'atr_multiple': atr_multiple,
        'allocation': allocation, 'leave_profit': leave_profit,
        'open_grids': len(lots), 'retained_shares': retained_shares, 'protection_days': protection_days,
        'latest': {
            'date': str(data.iloc[last_index].date), 'close': final_close, 'lower': lower, 'upper': upper,
            'atr14': atr, 'step_pct': fraction, 'grid_count': len(levels) - 1,
            'current_weight': shares * final_close / result['final_equity'] if result['final_equity'] > 0 else 0,
            'next_buy_price': float(levels[max(0, close_level - 1)]),
            'next_sell_price': float(levels[min(len(levels) - 1, close_level + 1)]),
            'next_action': 'stop_adding' if below_lower else 'hold',
            'break_protection': below_lower,
        },
        'trade_log': trades,
    })
    return result


def supertrend(data, period=10, multiplier=3.0):
    close = data['close'].astype(float).reset_index(drop=True)
    high = data['high'].astype(float).reset_index(drop=True)
    low = data['low'].astype(float).reset_index(drop=True)
    previous = close.shift(1)
    tr = pd.concat([high - low, (high - previous).abs(), (low - previous).abs()], axis=1).max(axis=1)
    atr = tr.rolling(period).mean()
    middle = (high + low) / 2
    basic_upper = middle + multiplier * atr
    basic_lower = middle - multiplier * atr
    final_upper = basic_upper.copy()
    final_lower = basic_lower.copy()
    trend = pd.Series(np.nan, index=data.index, dtype=float)
    for i in range(1, len(data)):
        if not np.isfinite(atr.iloc[i]):
            continue
        if not np.isfinite(atr.iloc[i - 1]):
            final_upper.iloc[i] = basic_upper.iloc[i]
            final_lower.iloc[i] = basic_lower.iloc[i]
            trend.iloc[i] = final_upper.iloc[i]
            continue
        final_upper.iloc[i] = basic_upper.iloc[i] if basic_upper.iloc[i] < final_upper.iloc[i - 1] or close.iloc[i - 1] > final_upper.iloc[i - 1] else final_upper.iloc[i - 1]
        final_lower.iloc[i] = basic_lower.iloc[i] if basic_lower.iloc[i] > final_lower.iloc[i - 1] or close.iloc[i - 1] < final_lower.iloc[i - 1] else final_lower.iloc[i - 1]
        if not np.isfinite(trend.iloc[i - 1]):
            trend.iloc[i] = final_upper.iloc[i]
        elif trend.iloc[i - 1] == final_upper.iloc[i - 1]:
            trend.iloc[i] = final_lower.iloc[i] if close.iloc[i] > final_lower.iloc[i] else final_upper.iloc[i]
        else:
            trend.iloc[i] = final_upper.iloc[i] if close.iloc[i] < final_upper.iloc[i] else final_lower.iloc[i]
    return trend


def oversold_indicators(frame, bias_period=20, wr_period=14):
    data = _clean(frame)
    close = data['close'].astype(float)
    high = data['high'].astype(float)
    low = data['low'].astype(float)
    volume = data['volume'].astype(float)
    ma20 = close.rolling(bias_period).mean()
    highest = high.rolling(wr_period).max()
    lowest = low.rolling(wr_period).min()
    spread = highest - lowest
    wr = ((highest - close) / spread.where(spread > 0) * 100).fillna(50)
    multiplier = ((close - low) - (high - close)) / (high - low).where(high > low)
    cmf = (multiplier.fillna(0) * volume).rolling(20).sum() / volume.rolling(20).sum().where(volume.rolling(20).sum() > 0)
    percentile = close.shift(1).rolling(1250, min_periods=250).apply(lambda values: float(np.mean(values <= values[-1])), raw=True)
    result = data.copy()
    result['ma20'] = ma20
    result['bias20'] = (close / ma20 - 1) * 100
    result['wr14'] = wr
    result['cmf20'] = cmf
    result['supertrend'] = supertrend(data)
    result['price_percentile'] = percentile
    result['prior_low'] = low.shift(1).rolling(20).min()
    result['volume_mean20'] = volume.shift(1).rolling(20).mean()
    return result


def oversold_swing_backtest(frame, bias_threshold=-6.0, base_weight=0.6, swing_weight=0.2,
                            stop_pct=0.06, start=None, end=None):
    if bias_threshold >= 0 or not 0 <= base_weight <= 0.8 or not 0 < swing_weight <= 0.5 or base_weight + swing_weight * 2 > 1:
        raise ValueError('超跌波段参数或80/20分仓配置无效')
    if not 0.05 <= stop_pct <= 0.08:
        raise ValueError('单笔止损需在5%到8%之间')
    data = oversold_indicators(frame)
    indices = _indices(data, start, end)
    cash = INITIAL_CAPITAL
    base_shares = 0
    swing_lots = []
    trades = []
    equities = []
    first_open = None
    right_added = False
    entry_low = None
    right_adds = 0
    stop_exits = 0
    for i in indices:
        row = data.iloc[i]
        signal = data.iloc[i - 1]
        open_price = float(row.open)
        close_price = float(row.close)
        if min(open_price, close_price) <= 0:
            continue
        if first_open is None:
            first_open = open_price
        if base_shares == 0 and np.isfinite(signal.price_percentile) and signal.price_percentile <= 0.15:
            bought = _buy(cash, INITIAL_CAPITAL * base_weight, open_price)
            if bought:
                quantity, price, commission, cost = bought
                cash -= cost
                base_shares += quantity
                trades.append({'date': str(row.date), 'side': 'buy', 'kind': 'base', 'quantity': quantity,
                               'price': price, 'commission': commission})
        entered_today = False
        if not swing_lots and np.isfinite(signal.bias20) and signal.bias20 < bias_threshold:
            previous_wr = float(data.iloc[i - 2].wr14) if i >= 2 else np.nan
            if signal.wr14 > 85 and np.isfinite(previous_wr) and signal.wr14 < previous_wr:
                bought = _buy(cash, INITIAL_CAPITAL * swing_weight, open_price)
                if bought:
                    quantity, price, commission, cost = bought
                    cash -= cost
                    swing_lots.append({'quantity': quantity, 'cost': cost})
                    entry_low = float(signal.prior_low)
                    right_added = False
                    entered_today = True
                    trades.append({'date': str(row.date), 'side': 'buy', 'kind': 'swing', 'quantity': quantity,
                                   'price': price, 'commission': commission, 'bias20': float(signal.bias20),
                                   'wr14': float(signal.wr14), 'entry_low': entry_low})
        if swing_lots and not entered_today:
            total_quantity = sum(lot['quantity'] for lot in swing_lots)
            total_cost = sum(lot['cost'] for lot in swing_lots)
            average_cost = total_cost / total_quantity
            hard_stop = average_cost * (1 - stop_pct)
            stop_levels = [hard_stop] if float(row.low) <= hard_stop else []
            volume_break = (entry_low is not None and float(row.low) < entry_low and
                            np.isfinite(signal.volume_mean20) and float(row.volume) >= 1.5 * float(signal.volume_mean20))
            if volume_break:
                stop_levels.append(entry_low)
            indicator_exit = signal.wr14 < 20 or signal.bias20 > 5
            if stop_levels or indicator_exit:
                raw_price = open_price
                reason = 'indicator'
                if stop_levels:
                    stop_price = max(stop_levels)
                    raw_price = min(open_price, stop_price) if open_price > stop_price else open_price
                    reason = 'stop'
                price = raw_price * (1 - SLIPPAGE)
                commission = max(MIN_COMMISSION, total_quantity * price * COMMISSION_RATE)
                proceeds = total_quantity * price - commission
                cash += proceeds
                trades.append({'date': str(row.date), 'side': 'sell', 'kind': 'swing', 'quantity': total_quantity,
                               'price': price, 'commission': commission, 'realized': proceeds - total_cost,
                               'reason': reason})
                swing_lots = []
                right_added = False
                entry_low = None
                if reason == 'stop':
                    stop_exits += 1
            elif not right_added and signal.close > signal.ma20 and signal.cmf20 > 0 and signal.close > signal.supertrend:
                bought = _buy(cash, INITIAL_CAPITAL * swing_weight, open_price)
                if bought:
                    quantity, price, commission, cost = bought
                    cash -= cost
                    swing_lots.append({'quantity': quantity, 'cost': cost})
                    right_added = True
                    right_adds += 1
                    trades.append({'date': str(row.date), 'side': 'buy', 'kind': 'right', 'quantity': quantity,
                                   'price': price, 'commission': commission, 'cmf20': float(signal.cmf20)})
        swing_shares = sum(lot['quantity'] for lot in swing_lots)
        equities.append((str(row.date), cash + (base_shares + swing_shares) * close_price))
    last_index = indices[-1]
    latest_row = data.iloc[last_index]
    final_close = float(latest_row.close)
    result = _performance(equities, trades, first_open, final_close)
    swing_shares = sum(lot['quantity'] for lot in swing_lots)
    swing_cost = sum(lot['cost'] for lot in swing_lots)
    previous_wr = float(data.iloc[last_index - 1].wr14)
    entry_signal = latest_row.bias20 < bias_threshold and latest_row.wr14 > 85 and latest_row.wr14 < previous_wr
    result.update({
        'strategy': 'oversold_swing', 'bias_threshold': bias_threshold, 'base_weight': base_weight,
        'swing_weight': swing_weight, 'stop_pct': stop_pct, 'right_adds': right_adds,
        'stop_exits': stop_exits, 'swing_round_trips': result['sell_trades'],
        'latest': {
            'date': str(latest_row.date), 'close': final_close, 'bias20': float(latest_row.bias20),
            'wr14': float(latest_row.wr14), 'cmf20': float(latest_row.cmf20),
            'ma20': float(latest_row.ma20), 'supertrend': float(latest_row.supertrend),
            'price_percentile': float(latest_row.price_percentile) if np.isfinite(latest_row.price_percentile) else None,
            'base_current_weight': base_shares * final_close / result['final_equity'],
            'swing_current_weight': swing_shares * final_close / result['final_equity'],
            'swing_average_cost': swing_cost / swing_shares if swing_shares else None,
            'entry_low': entry_low,
            'right_added': right_added,
            'next_action': 'hold_swing' if swing_lots else 'buy_swing_next_open' if entry_signal else 'wait',
        },
        'trade_log': trades,
    })
    return result


def public_result(result):
    return {key: value for key, value in result.items() if key != 'trade_log'}
