# -*- coding: utf-8 -*-
"""A-share recovery backtest for 002463 / 000426 as of the latest bar.

Costs: commission 0.025% (min 5 yuan), sell stamp 0.05%, slippage 0.1% each side.
Execution: signal on prior close, fill on next open. T+1. Lot size 100.
"""
from __future__ import annotations

import json
import math
import os
import time
import urllib.request
from datetime import datetime

import numpy as np
import pandas as pd

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(OUT_DIR, "data")
os.makedirs(DATA_DIR, exist_ok=True)

POSITIONS = {
    "002463": {"name": "沪电股份", "secid": "0.002463", "shares": 300, "cost": 123.0, "t_lots": 1, "max_add_lots": 1},
    "000426": {"name": "兴业银锡", "secid": "0.000426", "shares": 800, "cost": 37.0, "t_lots": 2, "max_add_lots": 2},
}
PEERS = {
    "002916": "0.002916",
    "600183": "1.600183",
    "000960": "0.000960",
    "000975": "0.000975",
}
INDEXES = {"000300": "1.000300", "399006": "0.399006"}


def fetch_kline(secid: str, beg: str = "20160101", end: str = "20261102", fqt: int = 1) -> pd.DataFrame:
    urls = [
        "https://push2his.eastmoney.com/api/qt/stock/kline/get",
        "https://82.push2delay.eastmoney.com/api/qt/stock/kline/get",
    ]
    query = (
        f"?secid={secid}&ut=fa5fd1943c7b386f172d6893dbfba10b"
        "&fields1=f1,f2,f3,f4,f5,f6"
        "&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61"
        f"&klt=101&fqt={fqt}&beg={beg}&end={end}"
    )
    last_err = None
    raw = None
    for attempt in range(6):
        base = urls[attempt % len(urls)]
        req = urllib.request.Request(
            base + query,
            headers={"User-Agent": "Mozilla/5.0", "Referer": "https://quote.eastmoney.com/"},
        )
        try:
            with urllib.request.urlopen(req, timeout=40) as resp:
                raw = json.loads(resp.read().decode("utf-8"))
            if raw.get("data") and raw["data"].get("klines"):
                break
        except Exception as exc:  # noqa: BLE001
            last_err = exc
            time.sleep(1.5 + attempt * 1.2)
    if not raw or not raw.get("data") or not raw["data"].get("klines"):
        raise RuntimeError(f"no kline for {secid}: {last_err}")
    rows = []
    for line in raw["data"]["klines"]:
        p = line.split(",")
        rows.append(
            {
                "date": p[0],
                "open": float(p[1]),
                "close": float(p[2]),
                "high": float(p[3]),
                "low": float(p[4]),
                "volume": float(p[5]),
                "amount": float(p[6]),
                "pct": float(p[8]) if p[8] not in ("-", "") else 0.0,
            }
        )
    df = pd.DataFrame(rows)
    df["date"] = pd.to_datetime(df["date"])
    return df.drop_duplicates("date").sort_values("date").reset_index(drop=True)


def rsi_wilder(close: np.ndarray, n: int = 14) -> np.ndarray:
    delta = np.diff(close, prepend=close[0])
    gain = np.clip(delta, 0, None)
    loss = np.clip(-delta, 0, None)
    alpha = 1.0 / n
    ag = np.zeros_like(close)
    al = np.zeros_like(close)
    ag[0] = gain[:n].mean() if len(close) > n else gain.mean()
    al[0] = loss[:n].mean() if len(close) > n else loss.mean()
    for i in range(1, len(close)):
        ag[i] = ag[i - 1] + alpha * (gain[i] - ag[i - 1])
        al[i] = al[i - 1] + alpha * (loss[i] - al[i - 1])
    rs = np.divide(ag, al, out=np.full_like(ag, np.inf), where=al > 1e-12)
    return 100.0 - 100.0 / (1.0 + rs)


def enrich(df: pd.DataFrame) -> pd.DataFrame:
    c = df["close"]
    df = df.copy()
    df["ma10"] = c.rolling(10).mean()
    df["ma20"] = c.rolling(20).mean()
    df["ma60"] = c.rolling(60).mean()
    df["ma120"] = c.rolling(120).mean()
    df["rsi"] = rsi_wilder(c.to_numpy())
    df["hi120"] = df["high"].rolling(120).max()
    df["hi60"] = df["high"].rolling(60).max()
    df["ret5"] = c / c.shift(5) - 1.0
    df["ret20"] = c / c.shift(20) - 1.0
    return df


def fee_buy(amount: float) -> float:
    return max(5.0, amount * 0.00025) + amount * 0.001


def fee_sell(amount: float) -> float:
    return max(5.0, amount * 0.00025) + amount * 0.0005 + amount * 0.001


def max_drawdown(equity: np.ndarray) -> float:
    peak = np.maximum.accumulate(equity)
    dd = equity / peak - 1.0
    return float(dd.min()) if len(dd) else 0.0


def simulate_market(df: pd.DataFrame, fast: int, slow: int, start: int, end: int) -> dict:
    """Next-open timing. 100% above slow MA and fast>slow, else 0% if close<slow and fast<slow, else 50%."""
    close = df["close"].to_numpy()
    open_ = df["open"].to_numpy()
    ma_f = df["close"].rolling(fast).mean().to_numpy()
    ma_s = df["close"].rolling(slow).mean().to_numpy()
    equity = 1.0
    hold = 1.0
    pos = 0.0
    switches = 0
    curve = []
    hold_curve = []
    for i in range(start, end - 1):
        if np.isnan(ma_f[i]) or np.isnan(ma_s[i]):
            curve.append(equity)
            hold_curve.append(hold)
            continue
        if close[i] > ma_s[i] and ma_f[i] > ma_s[i]:
            target = 1.0
        elif close[i] < ma_s[i] and ma_f[i] < ma_s[i]:
            target = 0.0
        else:
            target = 0.5
        if abs(target - pos) > 1e-9:
            equity *= 1.0 - abs(target - pos) * 0.0015
            switches += 1
            pos = target
        ret = open_[i + 1] / open_[i] - 1.0 if i + 1 < end else 0.0
        # overnight+session approximated by next open / this open, position set at this close for next session
        # Use close-to-close of the NEXT day so the signal at i earns return i->i+1
        ret = close[i + 1] / close[i] - 1.0
        equity *= 1.0 + pos * ret
        hold *= 1.0 + ret
        curve.append(equity)
        hold_curve.append(hold)
    eq = np.array(curve) if curve else np.array([1.0])
    hq = np.array(hold_curve) if hold_curve else np.array([1.0])
    return {
        "timing_return": round(float(eq[-1] - 1.0), 4),
        "hold_return": round(float(hq[-1] - 1.0), 4),
        "timing_maxdd": round(max_drawdown(eq), 4),
        "hold_maxdd": round(max_drawdown(hq), 4),
        "switches": switches,
    }


def regime_at(close, ma20, ma60) -> str:
    if np.isnan(ma20) or np.isnan(ma60):
        return "未知"
    if close < ma60 and ma20 < ma60:
        return "防守"
    if close > ma60 and ma20 > ma60:
        return "进攻"
    return "修复"


def find_entry(df: pd.DataFrame, cost: float) -> int | None:
    hit = df.index[(df["low"] <= cost) & (df["high"] >= cost)].tolist()
    if not hit:
        # nearest close in the last year
        tail = df.tail(250)
        j = (tail["close"] - cost).abs().idxmin()
        return int(j)
    # last touch that is followed by the price staying below cost through the end,
    # otherwise the last touch
    last = hit[-1]
    return int(last)


def recovery_episodes(df: pd.DataFrame, ratio_th: float, need_up: float, gap: int = 90) -> list[dict]:
    """First day close/120d-high drops to ratio_th. Success if later high reaches entry*(1+need_up)."""
    close = df["close"].to_numpy()
    high = df["high"].to_numpy()
    low = df["low"].to_numpy()
    hi120 = df["hi120"].to_numpy()
    dates = df["date"].dt.strftime("%Y-%m-%d").tolist()
    out = []
    last_i = -10_000
    for i in range(120, len(df) - 1):
        if np.isnan(hi120[i]) or hi120[i] <= 0:
            continue
        ratio = close[i] / hi120[i]
        prev = close[i - 1] / hi120[i - 1] if hi120[i - 1] > 0 else 1
        if ratio <= ratio_th and prev > ratio_th and i - last_i >= gap:
            last_i = i
            target = close[i] * (1.0 + need_up)
            hit_d = {"60": None, "120": None, "250": None}
            fut_low = close[i]
            for hzn in (60, 120, 250):
                j2 = min(len(df) - 1, i + hzn)
                if j2 <= i:
                    continue
                window_high = high[i + 1 : j2 + 1]
                window_low = low[i + 1 : j2 + 1]
                if len(window_low):
                    fut_low = min(fut_low, float(window_low.min()))
                hits = np.where(window_high >= target)[0]
                if len(hits):
                    hit_d[str(hzn)] = int(hits[0] + 1)
                elif j2 < i + hzn:
                    hit_d[str(hzn)] = "censored"
            complete = {}
            for k, v in hit_d.items():
                hzn = int(k)
                if i + hzn < len(df) - 1:
                    complete[k] = v  # None or day
                else:
                    complete[k] = "censored" if v is None else v
            out.append(
                {
                    "date": dates[i],
                    "i": i,
                    "close": round(float(close[i]), 2),
                    "peak": round(float(hi120[i]), 2),
                    "extra_dd": round(fut_low / close[i] - 1.0, 4),
                    "hit": hit_d,
                    "complete": complete,
                }
            )
    return out


def summarize_episodes(eps: list[dict], today_i: int) -> dict:
    def rate(hzn: str, only_complete: bool) -> dict:
        succ = 0
        fail = 0
        cens = 0
        days = []
        for e in eps:
            v = e["complete"][hzn] if only_complete else e["hit"][hzn]
            if v == "censored" or (isinstance(v, str)):
                cens += 1
            elif v is None:
                if only_complete:
                    fail += 1
                else:
                    # unfinished window counts as not yet success
                    if e["i"] + int(hzn) >= today_i:
                        cens += 1
                    else:
                        fail += 1
            else:
                succ += 1
                days.append(v)
        denom = succ + fail
        return {
            "success": succ,
            "fail": fail,
            "censored": cens,
            "rate": round(succ / denom, 4) if denom else None,
            "median_days": int(np.median(days)) if days else None,
        }

    extra = [e["extra_dd"] for e in eps]
    return {
        "n": len(eps),
        "d60": rate("60", True),
        "d120": rate("120", True),
        "d250": rate("250", True),
        "median_extra_dd": round(float(np.median(extra)), 4) if extra else None,
        "p25_extra_dd": round(float(np.percentile(extra, 25)), 4) if extra else None,
        "episodes": [{k: e[k] for k in ("date", "close", "peak", "extra_dd", "hit")} for e in eps],
    }


def run_recovery_strategy(
    df: pd.DataFrame,
    index_regime: pd.Series,
    start: int,
    end: int,
    init_shares: int,
    cost: float,
    t_shares: int,
    max_add_shares: int,
    bounce: float,
    dip: float,
    rsi_sell: float,
    add_stop: float,
    enable_t: bool,
    enable_add: bool,
) -> dict:
    """Signal at close t-1, trade at open t. Core is never sold by the T module."""
    o = df["open"].to_numpy()
    h = df["high"].to_numpy()
    l = df["low"].to_numpy()
    c = df["close"].to_numpy()
    ma20 = df["ma20"].to_numpy()
    ma60 = df["ma60"].to_numpy()
    rsi = df["rsi"].to_numpy()
    ret5 = df["ret5"].to_numpy()
    dates = df["date"].dt.strftime("%Y-%m-%d").tolist()

    shares = init_shares
    pocket = 0.0
    extra = 0.0
    initial = init_shares * cost
    free = init_shares  # bought in the past
    # satellite inventory currently held (subset of shares)
    sat_held = t_shares if enable_t else 0
    sat_sold_px = None
    sat_sold_n = 0
    pending = []  # (available_index, shares)
    adds = []  # {n, px, alive}
    add_used = 0
    last_add_i = -10_000
    trades = []
    equities = []
    be_path = []
    recovered_i = None

    def wealth(px):
        return pocket + shares * px

    def breakeven(px_fallback):
        if shares <= 0:
            return None
        # price that makes wealth == initial + extra
        return (initial + extra - pocket) / shares

    for i in range(start + 1, end):
        # release T+1
        still = []
        for avail, n in pending:
            if avail <= i:
                free += n
            else:
                still.append((avail, n))
        pending = still

        px = float(o[i])
        prev = i - 1
        reg = index_regime.get(df["date"].iloc[prev], "未知") if hasattr(index_regime, "get") else "未知"
        # index_regime is a Series indexed by timestamp
        reg = "未知"
        key = df["date"].iloc[prev]
        if key in index_regime.index:
            reg = index_regime.loc[key]

        # 1) stop added lots (gap-aware)
        for ad in adds:
            if not ad["alive"]:
                continue
            if ad["free_i"] > i:
                continue
            stop_px = ad["px"] * (1.0 - add_stop)
            if l[i] <= stop_px and ad["n"] <= shares and ad["n"] <= free:
                fill = px if px < stop_px else stop_px
                gross = ad["n"] * fill
                pocket += gross - fee_sell(gross)
                shares -= ad["n"]
                free -= ad["n"]
                if sat_held >= ad["n"]:
                    sat_held -= ad["n"]
                ad["alive"] = False
                trades.append({"date": dates[i], "side": "卖出加仓止损", "shares": ad["n"], "price": round(fill, 2)})

        # 2) buy back T
        if enable_t and sat_sold_n > 0 and sat_sold_px is not None:
            fell = c[prev] <= sat_sold_px * (1.0 - dip)
            stabilized = c[prev] >= c[prev - 1] if prev >= 1 else False
            not_freefall = (not np.isnan(ret5[prev])) and ret5[prev] > -0.12
            if fell and stabilized and not_freefall:
                n = sat_sold_n
                gross = n * px
                need = gross + fee_buy(gross)
                if pocket >= need:
                    pocket -= need
                else:
                    extra += need - pocket
                    pocket = 0.0
                shares += n
                pending.append((i + 1, n))
                sat_held += n
                trades.append({"date": dates[i], "side": "买回波段", "shares": n, "price": round(px, 2)})
                sat_sold_n = 0
                sat_sold_px = None

        # 3) sell T on dead-cat bounce only while below MA60 (do not sell a real repair)
        below_slow = (not np.isnan(ma60[prev])) and c[prev] < ma60[prev]
        if (
            enable_t
            and sat_sold_n == 0
            and sat_held > 0
            and sat_held <= free
            and below_slow
            and (not np.isnan(ret5[prev]))
            and ret5[prev] >= bounce
            and (not np.isnan(rsi[prev]))
            and rsi[prev] >= rsi_sell
            and c[prev] < cost * 0.98
        ):
            n = sat_held
            gross = n * px
            pocket += gross - fee_sell(gross)
            shares -= n
            free -= n
            sat_held = 0
            sat_sold_n = n
            sat_sold_px = px
            trades.append({"date": dates[i], "side": "卖出波段", "shares": n, "price": round(px, 2)})

        # 4) add on MA20 reclaim, only if index is not in full defense
        reclaim = (
            (not np.isnan(ma20[prev]))
            and (not np.isnan(ma20[prev - 1] if prev >= 1 else np.nan))
            and c[prev] > ma20[prev]
            and c[prev - 1] <= ma20[prev - 1]
        )
        if (
            enable_add
            and reclaim
            and reg != "防守"
            and add_used + 100 <= max_add_shares
            and i - last_add_i >= 20
            and (not np.isnan(rsi[prev]))
            and rsi[prev] < 68
        ):
            n = 100
            gross = n * px
            need = gross + fee_buy(gross)
            if pocket >= need:
                pocket -= need
            else:
                extra += need - pocket
                pocket = 0.0
            shares += n
            pending.append((i + 1, n))
            add_used += n
            last_add_i = i
            adds.append({"n": n, "px": px, "alive": True, "free_i": i + 1})
            trades.append({"date": dates[i], "side": "右侧加仓", "shares": n, "price": round(px, 2)})

        # 5) lock break-even of ALL cash in (initial + extra)
        hurdle = initial + extra
        if shares > 0 and wealth(c[prev]) >= hurdle and free >= shares and shares > 0 and c[prev] > 0:
            # sell all next open to lock
            if wealth(px) >= hurdle * 0.995 and free >= shares:
                gross = shares * px
                pocket += gross - fee_sell(gross)
                trades.append({"date": dates[i], "side": "回本卖出", "shares": shares, "price": round(px, 2)})
                free = 0
                sat_held = 0
                shares = 0
                if recovered_i is None:
                    recovered_i = i

        eq = wealth(c[i])
        equities.append(eq)
        be = breakeven(c[i])
        be_path.append(None if be is None or shares == 0 else round(float(be), 2))
        if recovered_i is None and eq >= initial + extra - 1e-6 and shares == 0:
            recovered_i = i

    eq_arr = np.array(equities) if equities else np.array([initial])
    final_px = float(c[end - 1])
    final_wealth = float(pocket + shares * final_px)
    final_be = None if shares == 0 else (initial + extra - pocket) / shares
    return {
        "final_wealth": round(final_wealth, 2),
        "final_shares": int(shares),
        "pocket": round(pocket, 2),
        "extra_cash": round(extra, 2),
        "breakeven_price": None if final_be is None else round(float(final_be), 2),
        "recovered": bool(final_wealth >= initial + extra - 1.0 and (shares == 0 or final_px + 1e-9 >= (final_be or 9e9))),
        "recovered_date": dates[recovered_i] if recovered_i is not None else None,
        "maxdd_from_entry_mtm": round(float(eq_arr.min() / (init_shares * c[start]) - 1.0), 4) if c[start] else None,
        "trades": trades,
        "n_trades": len(trades),
        "equity_end": round(final_wealth, 2),
        "be_path_last": be_path[-1] if be_path else None,
    }


def hold_result(df, start, end, shares, cost) -> dict:
    c = df["close"].to_numpy()
    initial = shares * cost
    wealth = shares * float(c[end - 1])
    window = c[start:end] * shares
    return {
        "final_wealth": round(float(wealth), 2),
        "final_shares": shares,
        "pocket": 0.0,
        "extra_cash": 0.0,
        "breakeven_price": cost,
        "recovered": bool(df["high"].iloc[start:end].max() >= cost),
        "recovered_date": None,
        "maxdd_from_entry_mtm": round(float(window.min() / window[0] - 1.0), 4),
        "trades": [],
        "n_trades": 0,
    }


def episode_strategy_stats(df, index_regime, episodes, shares, cost, t_shares, max_add, params, horizon=120) -> dict:
    deltas = []
    succ_s = 0
    succ_h = 0
    n = 0
    extra_dds = []
    for e in episodes:
        i = e["i"]
        j = min(len(df) - 1, i + horizon)
        if j <= i + 40:
            continue
        n += 1
        # Same hole as the live position: synthetic cost is the rally still required.
        cost_syn = float(df["close"].iloc[i]) * (1.0 + params["need_up"])
        h = hold_result(df, i, j + 1, shares, cost_syn)
        s = run_recovery_strategy(
            df,
            index_regime,
            i,
            j + 1,
            shares,
            cost_syn,
            t_shares,
            max_add,
            params["bounce"],
            params["dip"],
            params["rsi_sell"],
            params["add_stop"],
            params["enable_t"],
            params["enable_add"],
        )
        deltas.append((s["final_wealth"] - h["final_wealth"]) / (shares * cost_syn))
        succ_s += int(s["final_wealth"] + 1 >= shares * cost_syn + s["extra_cash"])
        succ_h += int(h["recovered"])
        extra_dds.append(s["maxdd_from_entry_mtm"])
    if n == 0:
        return {"n": 0}
    return {
        "n": n,
        "median_wealth_lift": round(float(np.median(deltas)), 4),
        "mean_wealth_lift": round(float(np.mean(deltas)), 4),
        "strategy_recover_rate": round(succ_s / n, 4),
        "hold_recover_rate": round(succ_h / n, 4),
        "median_strategy_dd": round(float(np.median(extra_dds)), 4) if extra_dds else None,
    }


def load_or_fetch(code: str, secid: str) -> pd.DataFrame:
    path = os.path.join(DATA_DIR, f"{code}.csv")
    if os.path.exists(path):
        old = pd.read_csv(path, parse_dates=["date"])
        if len(old) > 200 and str(old["date"].iloc[-1].date()) >= "2026-11-02":
            return enrich(old)
    df = fetch_kline(secid)
    df.to_csv(path, index=False)
    time.sleep(0.7)
    return enrich(df)


def main():
    print("downloading...")
    frames = {}
    for code, meta in {**{k: {"secid": v} for k, v in {**INDEXES, **PEERS}.items()}, **{k: {"secid": v["secid"]} for k, v in POSITIONS.items()}}.items():
        secid = meta["secid"]
        df = load_or_fetch(code, secid)
        frames[code] = df
        print(code, df["date"].iloc[0].date(), df["date"].iloc[-1].date(), round(float(df["close"].iloc[-1]), 2), len(df))

    hs = frames["000300"]
    reg_map = {}
    for i, row in hs.iterrows():
        reg_map[row["date"]] = regime_at(row["close"], row["ma20"], row["ma60"])
    index_regime = pd.Series(reg_map)

    last_hs = hs.iloc[-1]
    market_regime = regime_at(last_hs["close"], last_hs["ma20"], last_hs["ma60"])
    cy = frames["399006"].iloc[-1]

    # market strategy: choose on 2018-2022, test 2023-now, also report preset 20/60
    def slc(df, a, b):
        m = (df["date"] >= a) & (df["date"] <= b)
        idx = df.index[m]
        return int(idx.min()), int(idx.max())

    grid = [(10, 60), (20, 60), (20, 120), (60, 120)]
    train_a, train_b = slc(hs, "2018-01-01", "2022-12-31")
    test_a, test_b = slc(hs, "2023-01-01", "2026-11-02")
    full_a, full_b = slc(hs, "2018-01-01", "2026-11-02")
    train_scores = []
    for f, s in grid:
        r = simulate_market(hs, f, s, train_a, train_b + 1)
        calmar = (r["timing_return"]) / abs(r["timing_maxdd"]) if r["timing_maxdd"] < 0 else 0
        train_scores.append((calmar, f, s, r))
    train_scores.sort(reverse=True)
    best_f, best_s = train_scores[0][1], train_scores[0][2]
    market = {
        "asof": str(last_hs["date"].date()),
        "hs300": round(float(last_hs["close"]), 2),
        "hs300_ma20": round(float(last_hs["ma20"]), 2),
        "hs300_ma60": round(float(last_hs["ma60"]), 2),
        "hs300_rsi": round(float(last_hs["rsi"]), 1),
        "cyb": round(float(cy["close"]), 2),
        "cyb_ma60": round(float(cy["ma60"]), 2),
        "regime": market_regime,
        "preset_20_60_full": simulate_market(hs, 20, 60, full_a, full_b + 1),
        "preset_20_60_oos": simulate_market(hs, 20, 60, test_a, test_b + 1),
        "selected_ma": [best_f, best_s],
        "selected_train": train_scores[0][3],
        "selected_oos": simulate_market(hs, best_f, best_s, test_a, test_b + 1),
        "grid_oos": [
            {"ma": [f, s], **simulate_market(hs, f, s, test_a, test_b + 1)} for _, f, s, _ in train_scores
        ],
    }

    param_grid = []
    for bounce in (0.06, 0.08, 0.10):
        for dip in (0.04, 0.06, 0.08):
            for rsi_sell in (60, 70):
                for add_stop in (0.08, 0.12):
                    param_grid.append(
                        {
                            "bounce": bounce,
                            "dip": dip,
                            "rsi_sell": rsi_sell,
                            "add_stop": add_stop,
                            "enable_t": True,
                            "enable_add": True,
                        }
                    )

    positions_out = []
    for code, meta in POSITIONS.items():
        df = frames[code]
        last = df.iloc[-1]
        price = float(last["close"])
        shares = meta["shares"]
        cost = meta["cost"]
        initial = shares * cost
        mv = shares * price
        need_up = cost / price - 1.0
        ratio_th = price / float(last["hi120"]) if last["hi120"] and not np.isnan(last["hi120"]) else price / cost
        # trigger historical episodes at a similar drawdown from the 120-day peak
        # Use the position's drawdown versus its own cost as the rally needed,
        # and trigger when price/peak <= price/cost (same percentage hole versus the peak).
        th = min(0.85, price / cost)
        eps = recovery_episodes(df, th, need_up, gap=90)
        ep_sum = summarize_episodes(eps, len(df) - 1)

        peer_eps = []
        peer_names = ["002916", "600183"] if code == "002463" else ["000960", "000975"]
        for pcode in peer_names:
            pdf = frames[pcode]
            # same numerical hole as this position
            peer_eps.extend(recovery_episodes(pdf, th, need_up, gap=90))
        peer_sum = summarize_episodes(peer_eps, 10**9)

        entry_i = find_entry(df, cost)
        # strategy on the actual open position: from entry through today
        preset = {
            "bounce": 0.08,
            "dip": 0.06,
            "rsi_sell": 65,
            "add_stop": 0.08,
            "enable_t": True,
            "enable_add": True,
            "need_up": need_up,
        }
        user_hold = hold_result(df, entry_i, len(df), shares, cost)
        user_preset = run_recovery_strategy(
            df,
            index_regime,
            entry_i,
            len(df),
            shares,
            cost,
            meta["t_lots"] * 100,
            meta["max_add_lots"] * 100,
            0.08,
            0.06,
            65,
            0.08,
            True,
            True,
        )
        user_t_only = run_recovery_strategy(
            df,
            index_regime,
            entry_i,
            len(df),
            shares,
            cost,
            meta["t_lots"] * 100,
            0,
            0.08,
            0.06,
            65,
            0.08,
            True,
            False,
        )

        # train / test split of episodes
        train_eps = [e for e in eps if e["date"] < "2023-01-01"]
        test_eps = [e for e in eps if e["date"] >= "2023-01-01"]
        # If the stock itself has too few episodes, optimize on stock+peers but
        # report peer-trained params tested on the stock's own test episodes.
        train_pool = train_eps if len(train_eps) >= 4 else [e for e in (eps + peer_eps) if e["date"] < "2023-01-01"]
        # peer episodes don't share the same df. Optimization must run per dataframe.
        # Keep optimization ON THIS STOCK only. If n is small, skip and say so.
        best = None
        best_score = -1e9
        train_board = []
        if len([e for e in eps if e["date"] < "2024-01-01" and e["i"] + 120 < len(df) - 1]) >= 3:
            train_eps2 = [e for e in eps if e["date"] < "2024-01-01"]
            test_eps2 = [e for e in eps if e["date"] >= "2024-01-01"]
            for p in param_grid:
                p = dict(p)
                p["need_up"] = need_up
                st = episode_strategy_stats(
                    df, index_regime, train_eps2, shares, cost, meta["t_lots"] * 100, meta["max_add_lots"] * 100, p, 120
                )
                if st.get("n", 0) == 0:
                    continue
                # constraint: do not buy success with much worse drawdown; lift is the objective
                score = st["median_wealth_lift"] + 0.15 * (st["strategy_recover_rate"] - st["hold_recover_rate"])
                train_board.append((score, p, st))
                if score > best_score:
                    best_score = score
                    best = (p, st)
            train_board.sort(key=lambda x: x[0], reverse=True)
            test_stats = None
            preset_test = None
            if best and test_eps2:
                test_stats = episode_strategy_stats(
                    df, index_regime, test_eps2, shares, cost, meta["t_lots"] * 100, meta["max_add_lots"] * 100, best[0], 120
                )
                pp = dict(preset)
                preset_test = episode_strategy_stats(
                    df, index_regime, test_eps2, shares, cost, meta["t_lots"] * 100, meta["max_add_lots"] * 100, pp, 120
                )
            opt = {
                "trained": True,
                "train_n": best[1]["n"] if best else 0,
                "best_params": {k: best[0][k] for k in ("bounce", "dip", "rsi_sell", "add_stop")} if best else None,
                "train": best[1] if best else None,
                "test": test_stats,
                "preset_test": preset_test,
                "top3": [
                    {
                        "params": {k: p[k] for k in ("bounce", "dip", "rsi_sell", "add_stop")},
                        "train_lift": st["median_wealth_lift"],
                        "train_recover": st["strategy_recover_rate"],
                        "hold_recover": st["hold_recover_rate"],
                    }
                    for _, p, st in train_board[:3]
                ],
            }
        else:
            opt = {"trained": False, "reason": "独立样本不足，拒绝为提高胜率而拟合参数", "train_n": len(eps)}

        # add-on price table at predefined levels
        add_rows = []
        for extra_lots, label in ((0, "不加仓"), (1, "加1手"), (meta["max_add_lots"], f"加满{meta['max_add_lots']}手")):
            n = extra_lots * 100
            if n == 0:
                add_rows.append(
                    {
                        "label": label,
                        "add_shares": 0,
                        "extra_cash": 0,
                        "breakeven": cost,
                        "need_up_pct": round(need_up * 100, 1),
                    }
                )
                continue
            extra_cash = n * price
            be = (initial + extra_cash) / (shares + n)
            add_rows.append(
                {
                    "label": label,
                    "add_shares": n,
                    "extra_cash": round(extra_cash, 0),
                    "breakeven": round(be, 2),
                    "need_up_pct": round((be / price - 1) * 100, 1),
                }
            )

        # what the preset rule says TODAY (signal on last bar, no fill yet)
        ret5 = float(last["ret5"]) if not np.isnan(last["ret5"]) else 0.0
        action = []
        if market_regime == "防守" and price < float(last["ma60"]):
            action.append("指数与个股都在60日线下，禁止加仓")
        if price < float(last["ma20"]):
            action.append("尚未站回20日线，右侧加仓条件不成立")
        if ret5 < 0.08 or float(last["rsi"]) < 65:
            action.append("未出现可做正T的反弹（5日涨幅≥8%且RSI≥65），波段仓继续持有")
        if not action:
            action.append("满足波段卖出观察条件")
        # distance to ma
        weekly = df.set_index("date").resample("W-FRI").last().dropna(subset=["close"]).tail(28)
        positions_out.append(
            {
                "code": code,
                "name": meta["name"],
                "shares": shares,
                "cost": cost,
                "initial": round(initial, 2),
                "last": round(price, 2),
                "asof": str(last["date"].date()),
                "market_value": round(mv, 2),
                "pnl": round(mv - initial, 2),
                "pnl_pct": round(mv / initial - 1, 4),
                "need_up_pct": round(need_up * 100, 1),
                "breakeven": cost,
                "ma20": round(float(last["ma20"]), 2),
                "ma60": round(float(last["ma60"]), 2),
                "rsi": round(float(last["rsi"]), 1),
                "ret5_pct": round(ret5 * 100, 2),
                "dd_from_120high": round(price / float(last["hi120"]) - 1, 4),
                "high120": round(float(last["hi120"]), 2),
                "entry_date": str(df["date"].iloc[entry_i].date()),
                "entry_close": round(float(df["close"].iloc[entry_i]), 2),
                "base_rate": ep_sum,
                "peer_base_rate": {
                    "names": peer_names,
                    "n": peer_sum["n"],
                    "d120": peer_sum["d120"],
                    "d250": peer_sum["d250"],
                    "median_extra_dd": peer_sum["median_extra_dd"],
                },
                "user_hold": {k: user_hold[k] for k in ("final_wealth", "recovered", "n_trades", "extra_cash", "breakeven_price")},
                "user_preset": {
                    "final_wealth": user_preset["final_wealth"],
                    "final_shares": user_preset["final_shares"],
                    "extra_cash": user_preset["extra_cash"],
                    "breakeven_price": user_preset["breakeven_price"],
                    "recovered": user_preset["recovered"],
                    "recovered_date": user_preset["recovered_date"],
                    "n_trades": user_preset["n_trades"],
                    "trades": user_preset["trades"][-12:],
                },
                "user_t_only": {
                    "final_wealth": user_t_only["final_wealth"],
                    "extra_cash": user_t_only["extra_cash"],
                    "breakeven_price": user_t_only["breakeven_price"],
                    "n_trades": user_t_only["n_trades"],
                    "recovered": user_t_only["recovered"],
                    "trades": user_t_only["trades"][-8:],
                },
                "optimization": opt,
                "add_table": add_rows,
                "action_now": action,
                "weekly_dates": [d.strftime("%m-%d") for d in weekly.index],
                "weekly_close": [round(float(x), 2) for x in weekly["close"]],
            }
        )
        print(meta["name"], "last", price, "episodes", ep_sum["n"], "entry", positions_out[-1]["entry_date"])

    # t-only math: how much one round trip can shave
    math_note = []
    for code, meta in POSITIONS.items():
        df = frames[code]
        price = float(df["close"].iloc[-1])
        n = meta["t_lots"] * 100
        # a dip capture of `dip` after a bounce, net of a round trip at current price
        for swing in (0.04, 0.06, 0.08):
            gross = n * price * swing
            cost_rt = fee_sell(n * price) + fee_buy(n * price * (1 - swing))
            net = gross - cost_rt
            hole = meta["shares"] * meta["cost"] - meta["shares"] * price
            math_note.append(
                {
                    "code": code,
                    "swing": swing,
                    "lots": meta["t_lots"],
                    "net": round(net, 0),
                    "hole": round(hole, 0),
                    "trips_to_fill": math.ceil(hole / net) if net > 0 else None,
                }
            )

    summary = {
        "generated": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "market": market,
        "positions": positions_out,
        "t_math": math_note,
        "rules": {
            "preset": "5日反弹≥8%且RSI≥65且仍在60日线下，才卖出波段仓；回落6%且止跌才买回；指数不在防守且重新站上20日线才加仓；加仓跌8%只砍加仓；权益回到全部本金则卖出锁定。",
            "costs": "佣金万2.5最低5元，印花税万5，滑点每边0.1%，T+1，100股一手",
        },
    }
    path = os.path.join(OUT_DIR, "results_summary.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    print("wrote", path)


if __name__ == "__main__":
    main()
