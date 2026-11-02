# -*- coding: utf-8 -*-
"""可复现的 A 股策略比较、样本外回测和概率型走势判断。

信号在收盘后生成，下一交易日开盘成交；收益按开盘到开盘计算。
参数只由训练期和验证期决定，2024 年以后只用于样本外评价。
"""
from __future__ import annotations

import json
import os
from datetime import datetime

import numpy as np
import pandas as pd

import build_platform as bp
import research_rules
import prediction_review
import fusion_model

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "platform", "adaptive_results.json")
HISTORY = os.path.join(ROOT, "platform", "daily_review_history.jsonl")
TRAIN_END = "2022-01-01"
VALID_END = "2024-01-01"
BUY_COST = 0.00125  # 佣金 + 买入滑点
SELL_COST = 0.00175  # 佣金 + 印花税 + 卖出滑点


def candidates() -> list[dict]:
    rows = []
    for ma in (20, 60, 120):
        rows.append({"family": "均线趋势", "name": f"MA{ma}+市场过滤", "kind": "ma", "ma": ma})
    for fast, slow in ((10, 40), (20, 60), (20, 120)):
        rows.append({"family": "均线趋势", "name": f"MA{fast}/{slow}+市场过滤", "kind": "dual", "fast": fast, "slow": slow})
    for entry, exit_ in ((20, 10), (55, 20)):
        rows.append({"family": "通道突破", "name": f"Donchian{entry}/{exit_}", "kind": "donchian", "entry": entry, "exit": exit_})
    for target in (0.15, 0.25, 0.40):
        rows.append({
            "family": "波动率控制",
            "name": f"Donchian20/10+波动目标{target:.0%}",
            "kind": "donchian",
            "entry": 20,
            "exit": 10,
            "vol_target": target,
        })
    rows.extend([
        {"family": "趋势回调", "name": "RSI2(10/70)+MA60", "kind": "rsi", "entry_rsi": 10, "exit_rsi": 70},
        {"family": "趋势回调", "name": "RSI2(5/80)+MA60", "kind": "rsi", "entry_rsi": 5, "exit_rsi": 80},
        {"family": "短期反转", "name": "RSI3<20，收复MA20退出", "kind": "reversal", "entry_rsi": 20},
    ])
    return rows + research_rules.candidates()


def enrich(book: dict) -> dict:
    b = {k: (v.copy() if isinstance(v, np.ndarray) else v) for k, v in book.items()}
    c = pd.Series(b["close"], dtype=float)
    h = pd.Series(b["high"], dtype=float)
    l = pd.Series(b["low"], dtype=float)
    for n in (2, 3):
        b[f"rsi{n}"] = bp.rsi_wilder(c.to_numpy(), n)
    for n in (10, 20, 40, 60, 120):
        b[f"ma{n}"] = c.rolling(n).mean().to_numpy()
    for n in (10, 20, 55):
        b[f"hi{n}"] = h.rolling(n).max().shift(1).to_numpy()
        b[f"lo{n}"] = l.rolling(n).min().shift(1).to_numpy()
    b["vol20"] = (c.pct_change().rolling(20).std() * np.sqrt(244)).to_numpy()
    return research_rules.enrich(b)


def raw_signal(b: dict, p: dict, regime: dict) -> np.ndarray:
    c = b["close"]
    gate = np.array([regime.get(d, 1) != 0 for d in b["date"]])
    n = len(c)
    kind = p["kind"]
    if kind in ("z_b1", "z_b2", "chang_five", "chang_five_v2", "chang_wave"):
        return research_rules.signal(b, p, regime)
    if kind == "ma":
        desired = (c > b[f"ma{p['ma']}"]).astype(float)
    elif kind == "dual":
        desired = ((c > b[f"ma{p['fast']}"]) & (b[f"ma{p['fast']}"] > b[f"ma{p['slow']}"])).astype(float)
    elif kind == "donchian":
        desired = np.zeros(n)
        held = 0.0
        for i in range(n):
            if held and c[i] < b[f"lo{p['exit']}"][i]:
                held = 0.0
            elif not held and c[i] > b[f"hi{p['entry']}"][i] and c[i] > b["ma60"][i]:
                held = 1.0
            desired[i] = held
    elif kind == "rsi":
        desired = np.zeros(n)
        held = 0.0
        for i in range(n):
            if held and (b["rsi2"][i] > p["exit_rsi"] or c[i] < b["ma60"][i]):
                held = 0.0
            elif not held and c[i] > b["ma60"][i] and b["rsi2"][i] < p["entry_rsi"]:
                held = 1.0
            desired[i] = held
    else:
        desired = np.zeros(n)
        held = 0.0
        for i in range(n):
            if held and (c[i] > b["ma20"][i] or c[i] < b["ma60"][i]):
                held = 0.0
            elif not held and c[i] > b["ma60"][i] and b["rsi3"][i] < p["entry_rsi"]:
                held = 1.0
            desired[i] = held
    desired[~np.isfinite(c)] = np.nan
    desired = desired * gate
    if p.get("vol_target"):
        desired = desired * np.clip(p["vol_target"] / b["vol20"], 0.0, 1.0)
    return desired


def limit_rate(code: str) -> float:
    return .295 if code.startswith(("4", "8", "92")) else 0.195 if code.startswith(("300", "301", "688")) else 0.095


def execute(code: str, b: dict, desired: np.ndarray) -> tuple[pd.DataFrame, list[dict]]:
    """在 t+1 开盘执行 t 收盘信号；涨跌停开盘不允许成交。"""
    c, o = b["close"], b["open"]
    dates = pd.to_datetime(b["date"])
    n = len(c)
    pos = np.zeros(n)
    turn = np.zeros(n)
    trade_cost = np.zeros(n)
    trades = []
    held = 0.0
    entry_date = None
    invested = 0.0
    proceeds = 0.0
    targets = np.nan_to_num(desired[:n-2], nan=0.).tolist()
    gaps = np.divide(o[1:n-1], c[:n-2], out=np.ones(n-2), where=c[:n-2]>0)-1
    rate = limit_rate(code)
    for i, (target, gap) in enumerate(zip(targets, gaps.tolist())):
        new = target
        if target > held and gap >= rate:
            new = held
        elif target < held and gap <= -rate:
            new = held
        if new != held:
            delta = new - held
            turn[i] = abs(delta)
            trade_cost[i] = turn[i] * (BUY_COST if delta > 0 else SELL_COST)
            if delta > 0:
                if held == 0:
                    entry_date = b["date"][i + 1]
                    invested = 0.0
                    proceeds = 0.0
                invested += delta * o[i + 1] * (1.0 + BUY_COST)
            else:
                proceeds += -delta * o[i + 1] * (1.0 - SELL_COST)
            held = new
            if held == 0 and invested > 0:
                trades.append({"entry": entry_date, "exit": b["date"][i + 1], "return": proceeds / invested - 1.0})
                invested = 0.0
                proceeds = 0.0
        pos[i] = held
    denominator = o[1:-1].copy()
    denominator[denominator <= 0] = np.nan
    ret = np.r_[o[2:] / denominator - 1.0, np.nan, np.nan]
    strategy = pos * ret - trade_cost
    part = pd.DataFrame({"hold": ret, "strategy": strategy, "position": pos, "turnover": turn}, index=dates)
    part = part[np.isfinite(part["hold"]) & (part["hold"].abs() <= 0.44)]
    return part, trades


def metrics(daily: pd.DataFrame, start: str, end: str | None) -> dict:
    x = daily[daily.index >= start]
    if end:
        x = x[x.index < end]
    if len(x) < 20:
        return {"n": int(len(x))}
    eq = (1.0 + x["strategy"]).cumprod()
    hold = (1.0 + x["hold"]).cumprod()
    years = len(x) / 244.0
    ret = float(eq.iloc[-1] - 1.0)
    hret = float(hold.iloc[-1] - 1.0)
    sd = float(x["strategy"].std())
    return {
        "n": int(len(x)),
        "start": str(x.index[0].date()),
        "end": str(x.index[-1].date()),
        "return": round(ret, 4),
        "annual_return": round(float(eq.iloc[-1] ** (1.0 / years) - 1.0), 4),
        "hold_return": round(hret, 4),
        "excess": round(ret - hret, 4),
        "maxdd": round(bp.max_dd(eq.to_numpy()), 4),
        "hold_maxdd": round(bp.max_dd(hold.to_numpy()), 4),
        "sharpe": round(float(x["strategy"].mean() / sd * np.sqrt(244)), 3) if sd > 1e-10 else 0.0,
        "daily_win_rate": round(float((x["strategy"] > 0).mean()), 4),
        "exposure": round(float(x["position"].mean()), 4),
        "annual_turnover": round(float(x["turnover"].sum() / years), 4),
    }


def trade_metrics(trades: list[dict]) -> dict:
    r = np.array([t["return"] for t in trades], dtype=float)
    if not len(r):
        return {"n": 0, "win_rate": None, "profit_factor": None, "expectancy": None}
    gains = r[r > 0].sum()
    losses = -r[r < 0].sum()
    return {
        "n": int(len(r)),
        "win_rate": round(float((r > 0).mean()), 4),
        "profit_factor": round(float(gains / losses), 3) if losses > 0 else None,
        "expectancy": round(float(r.mean()), 4),
    }


def curve_of(daily: pd.DataFrame, start: str, end: str | None) -> dict:
    x = daily[daily.index >= start]
    if end:
        x = x[x.index < end]
    if x.empty:
        return {"dates": [], "strategy": [], "hold": [], "drawdown": [], "exposure": []}
    eq = (1.0 + x["strategy"]).cumprod()
    hold = (1.0 + x["hold"]).cumprod()
    dd = eq / eq.cummax() - 1.0
    weekly = pd.DataFrame({
        "strategy": eq,
        "hold": hold,
        "drawdown": dd,
        "exposure": x["position"],
    }).resample("W-FRI").last().dropna()
    return {
        "dates": [d.strftime("%Y-%m-%d") for d in weekly.index],
        "strategy": [round(float(v), 4) for v in weekly["strategy"]],
        "hold": [round(float(v), 4) for v in weekly["hold"]],
        "drawdown": [round(float(v), 4) for v in weekly["drawdown"]],
        "exposure": [round(float(v), 4) for v in weekly["exposure"]],
    }


def yearly_table(daily: pd.DataFrame, start: str) -> list[dict]:
    rows = []
    for year, chunk in daily[daily.index >= start].groupby(daily[daily.index >= start].index.year):
        if len(chunk) < 15:
            continue
        m = metrics(chunk, "1900-01-01", None)
        rows.append({
            "year": int(year),
            "return": m["return"],
            "hold_return": m["hold_return"],
            "excess": m["excess"],
            "maxdd": m["maxdd"],
            "sharpe": m["sharpe"],
            "exposure": m["exposure"],
        })
    return rows


def run_candidate(stocks: list[dict], regime: dict, p: dict) -> dict:
    total = None
    counts = None
    trades = []
    for s in stocks:
        part, tr = execute(s["code"], s["book"], raw_signal(s["book"], p, regime))
        values = part.fillna(0)
        valid = part.notna().astype(int)
        total = values if total is None else total.add(values, fill_value=0)
        counts = valid if counts is None else counts.add(valid, fill_value=0)
        if not part.empty and part.index[-1] >= pd.Timestamp(VALID_END):
            trades.extend(t for t in tr if t["exit"] >= VALID_END)
    daily = (total / counts.replace(0, np.nan)).sort_index()
    return {
        **p,
        "train": metrics(daily, "2015-01-01", TRAIN_END),
        "valid": metrics(daily, TRAIN_END, VALID_END),
        "test": metrics(daily, VALID_END, None),
        "test_trades": trade_metrics(trades),
        "_daily": daily,
    }


def feature_frame(b: dict) -> pd.DataFrame:
    c = pd.Series(b["close"])
    ret = c.pct_change()
    return pd.DataFrame({
        "ret1": ret,
        "ret5": c.pct_change(5),
        "ret20": c.pct_change(20),
        "rsi": b["rsi"] / 100.0,
        "ma20": c / pd.Series(b["ma20"]) - 1.0,
        "ma60": c / pd.Series(b["ma60"]) - 1.0,
        "vol20": ret.rolling(20).std(),
    })


def knn_forecast(feat: pd.DataFrame, forward: pd.Series, i: int, horizon: int, k: int = 80) -> dict | None:
    # 标签必须在当前时点已经完整实现，避免训练集窥视未来。
    train = feat.iloc[: max(0, i - horizon)].copy()
    y = forward.iloc[: max(0, i - horizon)]
    ok = train.notna().all(axis=1) & y.notna()
    train, y = train[ok], y[ok]
    if len(train) < 150 or not np.isfinite(feat.iloc[i].to_numpy(dtype=float)).all():
        return None
    x = feat.iloc[[i]]
    mu, sd = train.mean(), train.std().replace(0, np.nan)
    z = ((train - mu) / sd).to_numpy(dtype=float)
    q = ((x - mu) / sd).to_numpy(dtype=float)[0]
    valid = np.isfinite(z).all(axis=1) & np.isfinite(q).all()
    z, yy = z[valid], y.to_numpy(dtype=float)[valid]
    if len(yy) < 100:
        return None
    dist = np.sqrt(((z - q) ** 2).mean(axis=1))
    take = np.argpartition(dist, min(k, len(dist)) - 1)[: min(k, len(dist))]
    w = 1.0 / (dist[take] + 0.05)
    vals = yy[take]
    prob = float(np.sum(w * (vals > 0)) / w.sum())
    return {
        "probability_up": round(prob, 4),
        "expected_return": round(float(np.sum(w * vals) / w.sum()), 4),
        "neighbors": int(len(vals)),
        "direction": "偏强" if prob >= 0.55 else "偏弱" if prob <= 0.45 else "中性",
    }


def forecast_stock(stock: dict) -> dict:
    b = stock["book"]
    feat = feature_frame(b)
    o = pd.Series(b["open"])
    out = {"code": stock["code"], "name": stock["name"], "asof": b["date"][-1], "horizons": {}, "walk_forward": {}}
    for horizon in (5, 20):
        # 当前信号对应下一交易日开盘，之后持有 horizon 个开盘间隔。
        fwd = o.shift(-(horizon + 1)) / o.shift(-1) - 1.0
        now = knn_forecast(feat, fwd, len(b["close"]) - 1, horizon)
        actual, probs = [], []
        first = next((j for j, d in enumerate(b["date"]) if d >= VALID_END), len(b["close"]))
        for i in range(max(160, first), len(b["close"]) - horizon - 1, horizon + 1):
            f = knn_forecast(feat, fwd, i, horizon)
            if f and np.isfinite(fwd.iloc[i]):
                actual.append(float(fwd.iloc[i] > 0))
                probs.append(f["probability_up"])
        reliable = False
        if len(actual) >= 20:
            a, p = np.array(actual), np.array(probs)
            baseline = max(a.mean(), 1 - a.mean())
            accuracy = float(((p >= 0.5) == a).mean())
            brier = float(np.mean((p - a) ** 2))
            reliable = bool(accuracy > baseline and brier < 0.25)
            out["walk_forward"][str(horizon)] = {
                "n": int(len(a)),
                "direction_accuracy": round(accuracy, 4),
                "baseline_accuracy": round(float(baseline), 4),
                "brier": round(brier, 4),
                "reliable": reliable,
            }
        if now:
            now["reliable"] = reliable
            if not reliable:
                now["raw_direction"] = now["direction"]
                now["direction"] = "中性（预测未通过验证）"
        out["horizons"][str(horizon)] = now or {"direction": "数据不足", "reliable": False}
    return out


def main(cached=False):
    def load(code):
        if not cached:
            return bp.load_code(code)
        path = os.path.join(bp.DATA, f'{code}.csv')
        if not os.path.exists(path): return None
        frame = pd.read_csv(path)
        frame['date'] = pd.to_datetime(frame['date'])
        return frame.drop_duplicates('date').sort_values('date').reset_index(drop=True)
    universe = pd.read_csv(os.path.join(bp.DATA, "universe.csv"), dtype={"code": str})
    hs = load("000300")
    if hs is None:
        raise SystemExit("缺少沪深300数据")
    regime, _ = bp.build_regime(hs)
    stocks = []
    for row in universe.itertuples(index=False):
        code = str(row.code).zfill(6)
        df = load(code)
        if df is None or len(df) < 400 or "volume" not in df or not np.isfinite(df["volume"]).all():
            continue
        stocks.append({"code": code, "name": row.name, "book": enrich(bp.prepare(df))})
    if len(stocks) < 4000:
        raise SystemExit(f"有效股票仅 {len(stocks)} 只")
    rows = []
    for p in candidates():
        print("backtest", p["name"], flush=True)
        rows.append(run_candidate(stocks, regime, p))
    eligible = [r for r in rows if r["train"].get("return", -1) > 0 and r["valid"].get("return", -1) > 0]
    pool = eligible or rows
    chosen = max(pool, key=lambda r: (r["valid"].get("sharpe", -99), r["valid"].get("maxdd", -99)))
    baseline = next(r for r in rows if r["name"] == "Donchian20/10")
    by_code = {s["code"]: s for s in stocks}
    holdings = []
    for code in ("002463", "000426"):
        s = by_code[code]
        signal = raw_signal(s["book"], chosen, regime)
        part, trades = execute(code, s["book"], signal)
        holdings.append({
            "code": code,
            "name": s["name"],
            "test": metrics(part, VALID_END, None),
            "test_trades": trade_metrics([t for t in trades if t["exit"] >= VALID_END]),
            "next_session_position": round(float(signal[-1]), 4),
            "forecast": forecast_stock(s),
        })
    clean_rows = [{k: v for k, v in r.items() if k != "_daily"} for r in rows]
    clean_chosen = {k: v for k, v in chosen.items() if k != "_daily"}
    clean_baseline = {k: v for k, v in baseline.items() if k != "_daily"}
    test = chosen["test"]
    operations = []
    for s in stocks:
        target = raw_signal(s["book"], chosen, regime)[-1]
        operations.append({"code": s["code"], "asof": s["book"]["date"][-1], "target": round(float(target), 4) if np.isfinite(target) else None})
    payload = {
        "generated": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "asof": max(s["book"]["date"][-1] for s in stocks),
        "universe": len(stocks),
        "coverage": {"requested": len(universe), "included": len(stocks), "excluded": len(universe)-len(stocks), "minimum_bars":400, "note":"当前沪深非ST A股池；新股从实际上市后进入，无历史补齐；存在幸存者偏差，历史ST状态未逐日建模。"},
        "selected": clean_chosen,
        "operations": operations,
        "fusion": fusion_model.build(stocks, hs, ROOT),
        "prediction_review": prediction_review.review(os.path.join(ROOT, 'platform', 'prediction_ledger.json'), holdings, stocks),
        "sources": json.load(open(os.path.join(ROOT, "research_sources.json"), encoding="utf-8")),
        "baseline": clean_baseline,
        "candidates": clean_rows,
        "curves": {
            "train": curve_of(chosen["_daily"], "2015-01-01", TRAIN_END),
            "valid": curve_of(chosen["_daily"], TRAIN_END, VALID_END),
            "test": curve_of(chosen["_daily"], VALID_END, None),
        },
        "yearly": yearly_table(chosen["_daily"], VALID_END),
        "holdings": holdings,
        "selection": {
            "objective": "训练和验证收益均为正，按验证期夏普、最大回撤排序；样本外数据不参与选择",
            "baseline": baseline["name"],
        },
        "validation_gate": {
            "sample_out_profitable": test.get("return", 0) > 0,
            "positive_excess": test.get("excess", 0) > 0,
            "risk_adjusted_improvement": test.get("sharpe", 0) > baseline["test"].get("sharpe", 0) and test.get("maxdd", -1) > baseline["test"].get("maxdd", -1),
            "note": "样本外盈利只表示历史验证通过，不代表未来盈利；未通过时应保持观察而非继续拟合测试集。",
        },
        "execution": "收盘信号，下一交易日开盘成交；开盘涨跌停不成交；计佣金、印花税和滑点；T+1；波动目标仓位按部分成交权重核算",
        "research_basis": [
            {"topic": "A股短期反转与行业动量", "url": "https://www.sinoss.net/uploadfile/2017/0410/20170410110505797.pdf"},
            {"topic": "均线与时间序列动量及成本", "url": "https://www.smallake.kr/wp-content/uploads/2015/10/SSRN-id2225551.pdf"},
            {"topic": "趋势系统胜率与盈亏比", "url": "https://www.quantifiedstrategies.com/trend-following-trading-strategy/"},
        ],
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    history_row = {"generated": payload["generated"], "asof": payload["asof"], "strategy": chosen["name"], "test": test}
    old = []
    if os.path.exists(HISTORY):
        with open(HISTORY, encoding="utf-8") as f:
            old = [json.loads(line) for line in f if line.strip()]
    old = [r for r in old if r.get("asof") != history_row["asof"]]
    old.append(history_row)
    with open(HISTORY, "w", encoding="utf-8") as f:
        for row in old:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    print("selected", chosen["name"], "test", test, flush=True)
    print("wrote", OUT, flush=True)


if __name__ == "__main__":
    import sys
    main(cached='--cached' in sys.argv)
