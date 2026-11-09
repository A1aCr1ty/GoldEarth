# -*- coding: utf-8 -*-
"""Walk-forward validation on a broad A-share universe and write platform/results.json.

Trend book: signal at close, earn the next close-to-close return.
Repair book: after a 30% drop from the 120-day high, try to get back to that high.
Train < 2022, validate 2022-2023, test 2024 onward. Test numbers are never used to pick parameters.
"""
from __future__ import annotations

import json
import os
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

import numpy as np
import pandas as pd

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "data")
OUT = os.path.join(ROOT, "platform", "results.json")
os.makedirs(DATA, exist_ok=True)
os.makedirs(os.path.dirname(OUT), exist_ok=True)

TRAIN_END = "2022-01-01"
VALID_END = "2024-01-01"
TREND_START = "2015-01-01"
BEG = "20150101"
TODAY = datetime.now().strftime("%Y-%m-%d")
END = datetime.now().strftime("%Y%m%d")
COST_TURNOVER = 0.0015
REPAIR_TH = 0.70
DEEP_TH = 0.60
TARGET_N = 560
MANIFEST_PATH = os.path.join(DATA, "fetch_manifest.json")
MANIFEST_LOCK = threading.Lock()
PACE_LOCK = threading.Lock()
PACE_NEXT = 0.0

UNIVERSE = [
    ("002463", "沪电股份", "持仓"),
    ("000426", "兴业银锡", "持仓"),
    ("002916", "深南电路", "电子"),
    ("600183", "生益科技", "电子"),
    ("002475", "立讯精密", "电子"),
    ("000725", "京东方A", "电子"),
    ("002415", "海康威视", "电子"),
    ("603986", "兆易创新", "电子"),
    ("300308", "中际旭创", "电子"),
    ("002230", "科大讯飞", "电子"),
    ("002371", "北方华创", "电子"),
    ("000960", "锡业股份", "有色"),
    ("000975", "银泰黄金", "有色"),
    ("601899", "紫金矿业", "有色"),
    ("600111", "北方稀土", "有色"),
    ("600519", "贵州茅台", "消费"),
    ("000858", "五粮液", "消费"),
    ("000568", "泸州老窖", "消费"),
    ("600887", "伊利股份", "消费"),
    ("601888", "中国中免", "消费"),
    ("601318", "中国平安", "金融"),
    ("600036", "招商银行", "金融"),
    ("601398", "工商银行", "金融"),
    ("000001", "平安银行", "金融"),
    ("600030", "中信证券", "金融"),
    ("300059", "东方财富", "金融"),
    ("300750", "宁德时代", "新能源"),
    ("002594", "比亚迪", "新能源"),
    ("601012", "隆基绿能", "新能源"),
    ("300274", "阳光电源", "新能源"),
    ("600276", "恒瑞医药", "医药"),
    ("300760", "迈瑞医疗", "医药"),
    ("603259", "药明康德", "医药"),
    ("000538", "云南白药", "医药"),
    ("000333", "美的集团", "制造"),
    ("000651", "格力电器", "制造"),
    ("600031", "三一重工", "制造"),
    ("002352", "顺丰控股", "制造"),
    ("600309", "万华化学", "周期"),
    ("601857", "中国石油", "周期"),
    ("600028", "中国石化", "周期"),
    ("600900", "长江电力", "公用"),
    ("000002", "万科A", "地产"),
    ("601668", "中国建筑", "基建"),
    ("002714", "牧原股份", "农业"),
    ("002027", "分众传媒", "传媒"),
]
HOLDINGS = {
    "002463": {"shares": 300, "cost": 123.0, "wave": 100, "add": 100},
    "000426": {"shares": 800, "cost": 37.0, "wave": 200, "add": 100},
}


def secid_of(code: str) -> str:
    if code == "000300":
        return "1.000300"
    if code == "399006":
        return "0.399006"
    return ("1." if code.startswith("6") else "0.") + code


def pace():
    global PACE_NEXT
    with PACE_LOCK:
        now = time.time()
        wait = PACE_NEXT - now
        PACE_NEXT = max(now, PACE_NEXT) + 0.15
    if wait > 0:
        time.sleep(wait)


def load_manifest() -> dict:
    if os.path.exists(MANIFEST_PATH):
        with open(MANIFEST_PATH, encoding="utf-8") as f:
            return json.load(f)
    return {}


MANIFEST = load_manifest()


def save_manifest():
    with MANIFEST_LOCK:
        with open(MANIFEST_PATH, "w", encoding="utf-8") as f:
            json.dump(MANIFEST, f, ensure_ascii=False)


def fetch_page(pn: int):
    url = (
        "https://push2.eastmoney.com/api/qt/clist/get"
        f"?pn={pn}&pz=200&po=1&np=1&fltt=2&invt=2&fid=f20"
        "&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23"
        "&fields=f12,f14,f20,f26,f100"
    )
    for attempt in range(6):
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Referer": "https://quote.eastmoney.com/"})
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                raw = json.loads(resp.read().decode("utf-8"))
            diff = (raw.get("data") or {}).get("diff") or []
            if isinstance(diff, dict):
                diff = list(diff.values())
            if diff:
                return diff
        except Exception as exc:
            print("list page", pn, "attempt", attempt, exc)
            time.sleep(1.2 * (attempt + 1))
    return None


def fetch_universe(n: int = TARGET_N) -> list[tuple[str, str, str]]:
    """Largest A-shares already listed by the end of 2015, so the 2015 history is real."""
    ready = os.path.join(DATA, "universe.ok")
    saved = os.path.join(DATA, "universe.csv")
    if os.path.exists(ready) and os.path.exists(saved):
        df = pd.read_csv(saved, dtype=str)
        rows = list(zip(df["code"].str.zfill(6), df["name"], df["sector"]))
        if len(rows) >= 500:
            print("universe cache", len(rows))
            return rows
    pages = []
    empty_streak = 0
    for pn in range(1, 40):
        diff = fetch_page(pn)
        if not diff:
            empty_streak += 1
            print("missing page", pn)
            if empty_streak >= 3:
                break
            continue
        empty_streak = 0
        pages.append(diff)
        print("universe page", pn, "rows", len(diff))
        if sum(len(p) for p in pages) > n * 4:
            break
        time.sleep(0.35)
    picked: list[tuple[str, str, str]] = []
    seen: set[str] = set()
    for diff in pages:
        for row in diff:
            code = str(row.get("f12") or "").zfill(6)
            name = str(row.get("f14") or "")
            if not code.isdigit() or code in seen:
                continue
            upper = name.upper()
            if "ST" in upper or "退" in name:
                continue
            listed = int(row.get("f26") or 0)
            if listed <= 0 or listed > 20151231:
                continue
            seen.add(code)
            picked.append((code, name, str(row.get("f100") or "其他")))
            if len(picked) >= n:
                break
        if len(picked) >= n:
            break
    if len(picked) < 500:
        raise SystemExit(f"stock list only kept {len(picked)}; list pages were incomplete")
    have = {c for c, _, _ in picked}
    for code, name in (("002463", "沪电股份"), ("000426", "兴业银锡")):
        if code not in have:
            picked.append((code, name, "持仓"))
    front = [(c, name, "持仓") for c, name, _ in picked if c in HOLDINGS]
    rest = [item for item in picked if item[0] not in HOLDINGS]
    seen_front: set[str] = set()
    uniq_front = []
    for item in front:
        if item[0] in seen_front:
            continue
        seen_front.add(item[0])
        uniq_front.append(item)
    rows = uniq_front + rest
    with open(saved, "w", encoding="utf-8") as f:
        f.write("code,name,sector\n")
        for code, name, sector in rows:
            f.write(f"{code},{name},{sector}\n")
    with open(ready, "w", encoding="utf-8") as f:
        f.write(str(len(rows)))
    return rows


def fetch_eastmoney(code: str, *, min_rows: int = 201) -> pd.DataFrame | None:
    query = (
        f"?secid={secid_of(code)}&ut=fa5fd1943c7b386f172d6893dbfba10b"
        "&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61"
        f"&klt=101&fqt=1&beg=20150101&end={END}"
    )
    urls = [
        "https://push2his.eastmoney.com/api/qt/stock/kline/get",
        "https://82.push2delay.eastmoney.com/api/qt/stock/kline/get",
    ]
    for attempt in range(5):
        req = urllib.request.Request(
            urls[attempt % 2] + query,
            headers={"User-Agent": "Mozilla/5.0", "Referer": "https://quote.eastmoney.com/"},
        )
        try:
            pace()
            with urllib.request.urlopen(req, timeout=40) as resp:
                raw = json.loads(resp.read().decode("utf-8"))
            lines = (raw.get("data") or {}).get("klines") or []
            if len(lines) >= min_rows:
                rows = []
                for line in lines:
                    p = line.split(",")
                    rows.append((p[0], float(p[1]), float(p[2]), float(p[3]), float(p[4]), float(p[5])))
                return pd.DataFrame(rows, columns=["date", "open", "close", "high", "low", "volume"])
        except Exception:
            time.sleep(0.8 + attempt * 0.7)
    return None


def fetch_tencent(code: str, *, min_rows: int = 201, require_volume: bool = False) -> pd.DataFrame | None:
    if code == "000300":
        pref = "sh"
    elif code == "399006":
        pref = "sz"
    else:
        pref = "sh" if code.startswith("6") else "sz"
    symbol = pref + code
    url = f"https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={symbol},day,2015-01-01,{TODAY},9000,qfq"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=40) as resp:
            raw = json.loads(resp.read().decode("utf-8"))
        node = raw.get("data", {}).get(symbol, {})
        lines = node.get("qfqday") or node.get("day") or []
        if len(lines) < min_rows:
            return None
        columns = ["date", "open", "close", "high", "low"]
        if require_volume:
            columns.append("volume")
        rows = []
        for p in lines:
            rows.append((p[0], *(float(p[i]) for i in range(1, len(columns)))))
        return pd.DataFrame(rows, columns=columns)
    except Exception:
        return None
    return None


def load_code(code: str, *, min_rows: int = 201, require_volume: bool = False) -> pd.DataFrame | None:
    def has_volume(frame):
        if frame is None or "volume" not in frame:
            return False
        volume = pd.to_numeric(frame["volume"], errors="coerce")
        return np.isfinite(volume).all() and (volume >= 0).all() and (volume > 0).any()

    path = os.path.join(DATA, f"{code}.csv")
    with MANIFEST_LOCK:
        man = MANIFEST.get(code) or {}
    if man.get("beg") == BEG and man.get("last", "") >= TODAY and os.path.exists(path):
        old = pd.read_csv(path)
        if len(old) >= min_rows and ("volume" in old.columns if not require_volume else has_volume(old)):
            df = old[["date", "open", "close", "high", "low", "volume"]].copy()
            df["date"] = pd.to_datetime(df["date"])
            return df.drop_duplicates("date").sort_values("date").reset_index(drop=True)
    df = fetch_eastmoney(code, min_rows=min_rows)
    if df is None or (require_volume and not has_volume(df)):
        time.sleep(0.4)
        df = fetch_tencent(code, min_rows=min_rows, require_volume=require_volume)
    if df is None or (require_volume and not has_volume(df)):
        return None
    df["date"] = pd.to_datetime(df["date"])
    df = df.drop_duplicates("date").sort_values("date").reset_index(drop=True)
    df.to_csv(path, index=False)
    with MANIFEST_LOCK:
        MANIFEST[code] = {
            "beg": BEG,
            "first": str(df["date"].iloc[0].date()),
            "last": str(df["date"].iloc[-1].date()),
            "n": int(len(df)),
        }
        with open(MANIFEST_PATH, "w", encoding="utf-8") as f:
            json.dump(MANIFEST, f, ensure_ascii=False)
    return df


def rsi_wilder(close: np.ndarray, n: int = 14) -> np.ndarray:
    delta = np.diff(close, prepend=close[0])
    gain = np.clip(delta, 0, None)
    loss = np.clip(-delta, 0, None)
    alpha = 1.0 / n
    ag = np.zeros_like(close)
    al = np.zeros_like(close)
    ag[n] = gain[1 : n + 1].mean() if len(close) > n else gain.mean()
    al[n] = loss[1 : n + 1].mean() if len(close) > n else loss.mean()
    start = n + 1 if len(close) > n else 1
    for i in range(start, len(close)):
        ag[i] = ag[i - 1] + alpha * (gain[i] - ag[i - 1])
        al[i] = al[i - 1] + alpha * (loss[i] - al[i - 1])
    out = np.full_like(close, np.nan)
    ok = al > 1e-12
    out[ok] = 100.0 - 100.0 / (1.0 + ag[ok] / al[ok])
    return out


def prepare(df: pd.DataFrame) -> dict:
    df = df.copy()
    c = df["close"].to_numpy(float)
    h = df["high"].to_numpy(float)
    l = df["low"].to_numpy(float)
    o = df["open"].to_numpy(float)
    dates = df["date"].dt.strftime("%Y-%m-%d").tolist()
    s = pd.Series(c)
    return {
        "date": dates,
        "open": o,
        "high": h,
        "low": l,
        "close": c,
        "volume": df["volume"].to_numpy(float) if "volume" in df else np.full(len(c), np.nan),
        "ma20": s.rolling(20).mean().to_numpy(),
        "ma60": s.rolling(60).mean().to_numpy(),
        "ma120": s.rolling(120).mean().to_numpy(),
        "rsi": rsi_wilder(c),
        "ret5": (s / s.shift(5) - 1.0).to_numpy(),
        "hi120": pd.Series(h).rolling(120).max().to_numpy(),
    }


def fee_buy(amount: float) -> float:
    return max(5.0, amount * 0.00025) + amount * 0.001


def fee_sell(amount: float) -> float:
    return max(5.0, amount * 0.00025) + amount * 0.0005 + amount * 0.001


def max_dd(equity: np.ndarray) -> float:
    equity = np.asarray(equity, dtype=float)
    equity = equity[np.isfinite(equity) & (equity > 0)]
    if len(equity) == 0:
        return 0.0
    peak = np.maximum.accumulate(equity)
    return float((equity / peak - 1.0).min())


def regime_name(code: int) -> str:
    return ("防守", "修复", "进攻")[code]


def build_regime(index_df: pd.DataFrame) -> tuple[dict, dict]:
    d = prepare(index_df)
    mapping = {}
    last = {}
    for i, day in enumerate(d["date"]):
        ma20, ma60, c = d["ma20"][i], d["ma60"][i], d["close"][i]
        if np.isnan(ma20) or np.isnan(ma60):
            reg = 1
        elif c < ma60 and ma20 < ma60:
            reg = 0
        elif c > ma60 and ma20 > ma60:
            reg = 2
        else:
            reg = 1
        mapping[day] = reg
        last = {
            "date": day,
            "close": round(float(c), 2),
            "ma20": round(float(ma20), 2),
            "ma60": round(float(ma60), 2),
            "rsi": round(float(d["rsi"][i]), 1),
            "regime": regime_name(reg),
            "regime_code": reg,
        }
    return mapping, last


def find_episodes(book: dict, regime: dict, threshold: float) -> list[dict]:
    c, h, hi = book["close"], book["high"], book["hi120"]
    dates = book["date"]
    out = []
    last_i = -10_000
    reg = [regime.get(day, 1) for day in dates]
    for i in range(120, len(c) - 121):
        if np.isnan(hi[i]) or np.isnan(hi[i - 1]) or hi[i] <= 0 or hi[i - 1] <= 0 or c[i] <= 0:
            continue
        ratio = c[i] / hi[i]
        prev = c[i - 1] / hi[i - 1]
        if ratio <= threshold < prev and i - last_i >= 90:
            last_i = i
            out.append({"i": i, "date": dates[i], "peak": float(hi[i]), "close": float(c[i]), "regime": reg})
    return out


def sized(price: float) -> tuple[int, int, int]:
    if not np.isfinite(price) or price <= 0.01:
        return 100, 0, 0
    shares = max(100, int(100000 / price / 100) * 100)
    shares = min(shares, 200000)
    wave = max(0, (shares // 5) // 100 * 100)
    if shares - wave < 100:
        wave = max(0, shares - 100)
    add = 0
    if 100 * price <= shares * price * 0.15:
        add = max(100, (shares // 10) // 100 * 100)
        while add * price > shares * price * 0.15 and add >= 100:
            add -= 100
    return shares, wave, add


def simulate_repair(book, ep, bounce, dip, rsi_sell, enable_add, add_stop=0.08) -> dict:
    i0 = ep["i"]
    end = i0 + 121
    o, h, l, c = book["open"], book["high"], book["low"], book["close"]
    ma20, ma60, rsi, ret5 = book["ma20"], book["ma60"], book["rsi"], book["ret5"]
    reg = ep["regime"]
    price = float(c[i0])
    cost = float(ep["peak"])
    shares0, wave, add_n = sized(price)
    shares = shares0
    free = shares0
    pocket = 0.0
    extra = 0.0
    initial = shares0 * cost
    sat = wave
    sold_n = 0
    sold_px = 0.0
    pending: list[tuple[int, int]] = []
    add_state = {"n": 0, "px": 0.0, "free_i": 10**9, "closed": True}
    add_used = 0
    last_add = -10_000
    trades = 0
    mtm0 = shares0 * price
    worst = mtm0
    for i in range(i0 + 1, end):
        still = []
        for avail, n in pending:
            if avail <= i:
                free += n
            else:
                still.append((avail, n))
        pending = still
        px = float(o[i])
        prev = i - 1
        if enable_add and add_used > 0 and not add_state["closed"] and i >= add_state["free_i"]:
            stop_px = add_state["px"] * (1.0 - add_stop)
            if l[i] <= stop_px and add_state["n"] <= free:
                fill = px if px < stop_px else stop_px
                gross = add_state["n"] * fill
                pocket += gross - fee_sell(gross)
                shares -= add_state["n"]
                free -= add_state["n"]
                add_state["closed"] = True
                trades += 1
        if wave > 0 and sold_n > 0:
            ok = (
                c[prev] <= sold_px * (1.0 - dip)
                and c[prev] >= c[prev - 1]
                and not np.isnan(ret5[prev])
                and ret5[prev] > -0.12
            )
            if ok:
                gross = sold_n * px
                need = gross + fee_buy(gross)
                if pocket >= need:
                    pocket -= need
                else:
                    extra += need - pocket
                    pocket = 0.0
                shares += sold_n
                pending.append((i + 1, sold_n))
                sat += sold_n
                sold_n = 0
                trades += 1
        below = (not np.isnan(ma60[prev])) and c[prev] < ma60[prev]
        if (
            wave > 0
            and sold_n == 0
            and sat > 0
            and sat <= free
            and below
            and not np.isnan(ret5[prev])
            and ret5[prev] >= bounce
            and not np.isnan(rsi[prev])
            and rsi[prev] >= rsi_sell
            and c[prev] < cost * 0.98
        ):
            gross = sat * px
            pocket += gross - fee_sell(gross)
            shares -= sat
            free -= sat
            sold_n = sat
            sold_px = px
            sat = 0
            trades += 1
        reclaim = (
            (not np.isnan(ma20[prev]))
            and (not np.isnan(ma20[prev - 1]))
            and c[prev] > ma20[prev]
            and c[prev - 1] <= ma20[prev - 1]
        )
        if (
            enable_add
            and add_n > 0
            and add_used == 0
            and reclaim
            and reg[prev] != 0
            and not np.isnan(rsi[prev])
            and rsi[prev] < 68
            and i - last_add >= 20
        ):
            gross = add_n * px
            need = gross + fee_buy(gross)
            if pocket >= need:
                pocket -= need
            else:
                extra += need - pocket
                pocket = 0.0
            shares += add_n
            pending.append((i + 1, add_n))
            add_used = add_n
            last_add = i
            add_state = {"n": add_n, "px": px, "free_i": i + 1, "closed": False}
            trades += 1
        hurdle = initial + extra
        if shares > 0 and free >= shares and pocket + shares * float(c[prev]) >= hurdle:
            if pocket + shares * px >= hurdle * 0.995:
                gross = shares * px
                pocket += gross - fee_sell(gross)
                trades += 1
                shares = 0
                free = 0
                sat = 0
                sold_n = 0
        mark = pocket + shares * float(c[i])
        if mark < worst:
            worst = mark
    final = pocket + shares * float(c[end - 1])
    hold_final = shares0 * float(c[end - 1])
    hold_hit = bool(np.max(h[i0 + 1 : end]) >= cost)
    return {
        "lift": (final - extra - hold_final) / initial,
        "recover": final + 1 >= initial + extra,
        "hold_recover": hold_hit,
        "dd": worst / mtm0 - 1.0,
        "trades": trades,
    }


def summarize_records(recs: list[dict]) -> dict:
    if not recs:
        return {"n": 0, "strategy_recover": None, "hold_recover": None, "lift": None, "dd": None, "trades": None}
    lifts = [r["lift"] for r in recs]
    dds = [r["dd"] for r in recs]
    trades = [r["trades"] for r in recs]
    n = len(recs)
    return {
        "n": n,
        "strategy_recover": round(sum(int(r["recover"]) for r in recs) / n, 4),
        "hold_recover": round(sum(int(r["hold_recover"]) for r in recs) / n, 4),
        "lift": round(float(np.median(lifts)), 4),
        "dd": round(float(np.median(dds)), 4),
        "trades": round(float(np.mean(trades)), 2),
    }


def eval_repair(books_eps, bounce, dip, rsi_sell, enable_add) -> dict:
    recs = []
    for book, episodes in books_eps:
        for ep in episodes:
            recs.append(simulate_repair(book, ep, bounce, dip, rsi_sell, enable_add))
    return summarize_records(recs)


def eval_repair_splits(bundles, bounce, dip, rsi_sell, enable_add) -> dict:
    buckets = {"train": [], "valid": [], "test": []}
    for book, episodes in bundles:
        for ep in episodes:
            day = ep["date"]
            key = "train" if day < TRAIN_END else "valid" if day < VALID_END else "test"
            buckets[key].append(simulate_repair(book, ep, bounce, dip, rsi_sell, enable_add))
    return {key: summarize_records(recs) for key, recs in buckets.items()}


def repair_grid_params():
    for bounce in (0.06, 0.08, 0.10):
        for dip in (0.04, 0.06, 0.08):
            for rsi_sell in (60, 70):
                for enable_add in (False, True):
                    yield {
                        "bounce": bounce,
                        "dip": dip,
                        "rsi_sell": rsi_sell,
                        "enable_add": enable_add,
                    }


def trend_panel(stocks: list[dict], regime: dict, ma_key: str, gate: bool) -> pd.DataFrame:
    frames = []
    for s in stocks:
        b = s["book"]
        dates = pd.to_datetime(b["date"])
        close = pd.Series(b["close"], index=dates)
        close = close.where(close > 0)
        ma = pd.Series(b[ma_key], index=dates)
        reg = pd.Series([regime.get(d, 1) for d in b["date"]], index=dates)
        signal = close > ma
        if gate:
            signal = signal & (reg != 0)
        signal = signal.astype(float)
        signal[ma.isna() | close.isna()] = np.nan
        ret = close.shift(-1) / close - 1.0
        ret = ret.where(ret.abs() <= 0.31)
        prev = signal.shift(1)
        prev = prev.fillna(0.0)
        turn = (signal - prev).abs()
        strat = signal * ret - turn * COST_TURNOVER
        part = pd.DataFrame({"hold": ret, "strategy": strat}).dropna()
        frames.append(part)
    if not frames:
        return pd.DataFrame(columns=["hold", "strategy"])
    # Equal-weight each day across names that have a return that day.
    cat = pd.concat(frames, keys=range(len(frames)), names=["name", "date"])
    daily = cat.groupby(level="date").mean().sort_index()
    daily = daily[daily.index >= TREND_START]
    return daily


def slice_metrics(daily: pd.DataFrame, start: str, end: str | None) -> dict:
    part = daily[daily.index >= start]
    if end:
        part = part[part.index < end]
    if len(part) < 20:
        return {"n": int(len(part)), "strategy_return": None, "hold_return": None, "strategy_maxdd": None, "hold_maxdd": None, "excess": None, "calmar": None}
    eq_s = (1.0 + part["strategy"]).cumprod().to_numpy()
    eq_h = (1.0 + part["hold"]).cumprod().to_numpy()
    rs, rh = float(eq_s[-1] - 1.0), float(eq_h[-1] - 1.0)
    ds, dh = max_dd(eq_s), max_dd(eq_h)
    calmar = rs / abs(ds) if ds < -1e-6 else 0.0
    return {
        "n": int(len(part)),
        "start": str(part.index[0].date()),
        "end": str(part.index[-1].date()),
        "strategy_return": round(rs, 4),
        "hold_return": round(rh, 4),
        "strategy_maxdd": round(ds, 4),
        "hold_maxdd": round(dh, 4),
        "excess": round(rs - rh, 4),
        "calmar": round(calmar, 4),
    }


def curve_of(daily: pd.DataFrame, start: str, end: str | None) -> dict:
    part = daily[daily.index >= start]
    if end:
        part = part[part.index < end]
    if part.empty:
        return {"dates": [], "strategy": [], "hold": []}
    eq_s = (1.0 + part["strategy"]).cumprod()
    eq_h = (1.0 + part["hold"]).cumprod()
    weekly = pd.DataFrame({"strategy": eq_s, "hold": eq_h}).resample("W-FRI").last().dropna()
    base_s = float(weekly["strategy"].iloc[0])
    base_h = float(weekly["hold"].iloc[0])
    return {
        "dates": [d.strftime("%Y-%m-%d") for d in weekly.index],
        "strategy": [round(float(v / base_s), 4) for v in weekly["strategy"]],
        "hold": [round(float(v / base_h), 4) for v in weekly["hold"]],
    }


def yearly_table(daily: pd.DataFrame, start: str) -> list[dict]:
    part = daily[daily.index >= start]
    rows = []
    for year, chunk in part.groupby(part.index.year):
        if len(chunk) < 15:
            continue
        rs = float((1.0 + chunk["strategy"]).prod() - 1.0)
        rh = float((1.0 + chunk["hold"]).prod() - 1.0)
        rows.append({"year": int(year), "strategy": round(rs, 4), "hold": round(rh, 4), "excess": round(rs - rh, 4)})
    return rows


def stock_test_stats(book: dict, regime: dict, ma_key: str, gate: bool) -> dict | None:
    dates = book["date"]
    c = book["close"]
    ma = book[ma_key]
    start = next((i for i, d in enumerate(dates) if d >= VALID_END), None)
    if start is None or start > len(c) - 30:
        return None
    eq_s = 1.0
    eq_h = 1.0
    prev = 0.0
    curve_s = []
    curve_h = []
    for i in range(start, len(c) - 1):
        if np.isnan(ma[i]) or np.isnan(c[i]) or c[i] <= 0 or np.isnan(c[i + 1]) or c[i + 1] <= 0:
            continue
        signal = 1.0 if c[i] > ma[i] and (not gate or regime.get(dates[i], 1) != 0) else 0.0
        turn = abs(signal - prev)
        prev = signal
        r = c[i + 1] / c[i] - 1.0
        if not np.isfinite(r) or abs(r) > 0.31:
            continue
        eq_s *= 1.0 + signal * r - turn * COST_TURNOVER
        eq_h *= 1.0 + r
        curve_s.append(eq_s)
        curve_h.append(eq_h)
    if len(curve_s) < 20:
        return None
    arr_s = np.array(curve_s)
    arr_h = np.array(curve_h)
    return {
        "test_strategy": round(float(arr_s[-1] - 1.0), 4),
        "test_hold": round(float(arr_h[-1] - 1.0), 4),
        "test_excess": round(float(arr_s[-1] - arr_h[-1]), 4),
        "test_maxdd": round(max_dd(arr_s), 4),
    }


def decide(book: dict, regime_today: int, ma_key: str, gate: bool, repair: dict) -> dict:
    c = float(book["close"][-1])
    ma20 = float(book["ma20"][-1])
    ma60 = float(book["ma60"][-1])
    ma = float(book[ma_key][-1])
    rsi = float(book["rsi"][-1])
    ret5 = float(book["ret5"][-1]) if not np.isnan(book["ret5"][-1]) else 0.0
    held = c > ma and (not gate or regime_today != 0)
    prev_c = float(book["close"][-2])
    prev_ma20 = float(book["ma20"][-2])
    reclaim = c > ma20 and prev_c <= prev_ma20
    if (not repair["enable_add"]) or regime_today == 0 or c <= ma20:
        repair_act = "不加仓"
    elif reclaim:
        repair_act = "可右侧加仓"
    else:
        repair_act = "已在20日线上，等回踩再看"
    if c < ma60 and ret5 >= repair["bounce"] and rsi >= repair["rsi_sell"]:
        repair_act = "可卖出波段"
    if c > ma60 and book["ma20"][-1] > ma60:
        repair_act = "个股在60日线上，不做反弹卖出"
    return {
        "close": round(c, 2),
        "ma20": round(ma20, 2),
        "ma60": round(ma60, 2),
        "rsi": round(rsi, 1),
        "ret5": round(ret5, 4),
        "trend": "持有" if held else "空仓",
        "repair": repair_act,
        "to_ma20": round(ma20 / c - 1.0, 4),
    }


def holding_plan(code: str, name: str, snap: dict, regime: str, repair: dict) -> dict:
    meta = HOLDINGS[code]
    close = snap["close"]
    cost = meta["cost"]
    shares = meta["shares"]
    pnl = shares * close - shares * cost
    steps = []
    if regime == "防守" and close < snap["ma60"]:
        title = "持有底仓，禁止加仓"
        steps.append(f"沪深300处于{regime}，收盘 {close:.2f} 仍低于60日线 {snap['ma60']:.2f}，不投入新钱。")
    elif close < snap["ma20"]:
        title = "持有底仓，等待站上20日线"
        steps.append(f"收盘还在20日线 {snap['ma20']:.2f} 下方，距离约 {snap['to_ma20']*100:.1f}%。")
    else:
        title = "持有，按右侧条件处理加仓"
    if repair["enable_add"]:
        steps.append(
            f"只有收盘站上 {snap['ma20']:.2f} 且指数不在防守时，才加 {meta['add']} 股。这 {meta['add']} 股单独跌 8% 就卖，底仓不动。"
        )
    else:
        steps.append("验证样本里打开加仓并没有提高回到前高的比例，这只持仓停止加仓。")
    steps.append(
        f"5日涨幅达到 {repair['bounce']*100:.0f}%、RSI达到 {repair['rsi_sell']:.0f}、且收盘仍低于 {snap['ma60']:.2f} 时，卖出波段仓 {meta['wave']} 股。"
    )
    steps.append(
        f"卖出后价格再回落 {repair['dip']*100:.0f}% 并且当天收盘不再低于前一日，才把这 {meta['wave']} 股买回。"
    )
    steps.append(f"价格回到成本 {cost:.2f} 元，卖出全部 {shares} 股。")
    return {
        "code": code,
        "name": name,
        "shares": shares,
        "cost": cost,
        "close": close,
        "pnl": round(pnl, 2),
        "pnl_pct": round(pnl / (shares * cost), 4),
        "need_up": round(cost / close - 1.0, 4),
        "market_value": round(shares * close, 2),
        "decision": title,
        "detail": steps,
        "trend": snap["trend"],
        "repair": snap["repair"],
    }


def main():
    print("universe")
    universe = fetch_universe(TARGET_N)
    with open(os.path.join(DATA, "universe.csv"), "w", encoding="utf-8") as f:
        f.write("code,name,sector\n")
        for code, name, sector in universe:
            f.write(f"{code},{name},{sector}\n")
    print("universe", len(universe))
    codes = ["000300", "399006"] + [c for c, _, _ in universe]
    failed_dl = []

    def grab(code: str):
        df = load_code(code)
        return code, df is not None and len(df) > 200

    print("download", len(codes))
    done = 0
    with ThreadPoolExecutor(max_workers=4) as pool:
        for code, ok in pool.map(grab, codes):
            done += 1
            if not ok:
                failed_dl.append(code)
            if done % 25 == 0 or done == len(codes):
                print("progress", done, "/", len(codes), "fail", len(failed_dl))
    if failed_dl:
        print("retry", len(failed_dl))
        time.sleep(2)
        still = []
        for code in failed_dl:
            df = load_code(code)
            if df is None or len(df) <= 200:
                still.append(code)
        failed_dl = still
    print("load index")
    hs = load_code("000300")
    cy = load_code("399006")
    if hs is None or cy is None:
        raise SystemExit("index download failed")
    regime, market_last = build_regime(hs)
    cyb = prepare(cy)
    market_last["cyb"] = round(float(cyb["close"][-1]), 2)
    market_last["cyb_ma60"] = round(float(cyb["ma60"][-1]), 2)

    stocks = []
    failed = []
    for code, name, sector in universe:
        df = load_code(code)
        if df is None or len(df) < 400:
            failed.append(code)
            continue
        book = prepare(df)
        stocks.append({"code": code, "name": name, "sector": sector, "book": book, "first": book["date"][0]})
    print("loaded", len(stocks), "failed", failed)
    if len(stocks) < 500:
        raise SystemExit(f"only {len(stocks)} stocks, need 500")

    # Repair episodes
    bundles = []
    deep_bundles = []
    for s in stocks:
        eps = find_episodes(s["book"], regime, REPAIR_TH)
        deep = find_episodes(s["book"], regime, DEEP_TH)
        for ep in eps:
            ep["code"] = s["code"]
        bundles.append((s["book"], eps))
        deep_bundles.append((s["book"], deep))

    def split_eps(items, a, b=None):
        out = []
        for book, eps in items:
            chosen = [e for e in eps if e["date"] >= a and (b is None or e["date"] < b)]
            out.append((book, chosen))
        return out

    train_eps = split_eps(bundles, "1900-01-01", TRAIN_END)
    valid_eps = split_eps(bundles, TRAIN_END, VALID_END)
    test_eps = split_eps(bundles, VALID_END, None)
    counts = {
        "train": sum(len(e) for _, e in train_eps),
        "valid": sum(len(e) for _, e in valid_eps),
        "test": sum(len(e) for _, e in test_eps),
    }
    print("episodes", counts)

    repair_rows = []
    preset = {"bounce": 0.08, "dip": 0.06, "rsi_sell": 70, "enable_add": False}
    for p in repair_grid_params():
        print("repair", p)
        parts = eval_repair_splits(bundles, **p)
        repair_rows.append({**p, "train": parts["train"], "valid": parts["valid"], "test": parts["test"]})

    def repair_ok(row):
        va = row["valid"]
        if not va["n"]:
            return False
        return (
            va["lift"] is not None
            and va["lift"] > 0
            and va["strategy_recover"] + 0.02 >= va["hold_recover"]
        )

    ranked = sorted(repair_rows, key=lambda r: (r["train"]["lift"] if r["train"]["lift"] is not None else -9), reverse=True)
    chosen = next((r for r in ranked if repair_ok(r)), None)
    if chosen is None:
        chosen = next(
            (r for r in repair_rows if r["bounce"] == 0.08 and r["dip"] == 0.06 and r["rsi_sell"] == 70 and not r["enable_add"]),
            repair_rows[0],
        )
        repair_source = "加仓未形成可验证超额，退回不加仓规则"
    else:
        same = (
            chosen["bounce"] == preset["bounce"]
            and chosen["dip"] == preset["dip"]
            and chosen["rsi_sell"] == preset["rsi_sell"]
            and chosen["enable_add"] == preset["enable_add"]
        )
        repair_source = "验证通过，与预设相同" if same else "验证通过，采用验证集上站得住的参数"
    frozen_repair = {
        "bounce": chosen["bounce"],
        "dip": chosen["dip"],
        "rsi_sell": chosen["rsi_sell"],
        "enable_add": bool(chosen["enable_add"]),
        "source": repair_source,
    }
    deep_test = eval_repair(
        split_eps(deep_bundles, VALID_END, None),
        frozen_repair["bounce"],
        frozen_repair["dip"],
        frozen_repair["rsi_sell"],
        frozen_repair["enable_add"],
    )

    # Trend
    trend_rows = []
    panels = {}
    for s in stocks:
        s["book"]["ma40"] = pd.Series(s["book"]["close"]).rolling(40).mean().to_numpy()
    for ma, key in ((20, "ma20"), (40, "ma40"), (60, "ma60"), (120, "ma120")):
        for gate in (False, True):
            print("trend", ma, gate)
            daily = trend_panel(stocks, regime, key, gate)
            panels[(ma, gate)] = daily
            tr = slice_metrics(daily, TREND_START, TRAIN_END)
            va = slice_metrics(daily, TRAIN_END, VALID_END)
            te = slice_metrics(daily, VALID_END, None)
            trend_rows.append({"ma": ma, "gate": gate, "train": tr, "valid": va, "test": te})

    def trend_pass(row):
        va = row["valid"]
        return va.get("excess") is not None and va["excess"] > 0

    trend_ranked = sorted(
        trend_rows,
        key=lambda r: r["train"]["calmar"] if r["train"].get("calmar") is not None else -9,
        reverse=True,
    )
    trend_choice = next((r for r in trend_ranked if trend_pass(r)), None)
    if trend_choice is None:
        defensive = [
            r
            for r in trend_rows
            if r["valid"].get("strategy_maxdd") is not None
            and r["valid"]["strategy_maxdd"] >= r["valid"]["hold_maxdd"] + 0.05
            and r["valid"]["strategy_return"] >= r["valid"]["hold_return"] - 0.03
        ]
        if defensive:
            trend_choice = sorted(defensive, key=lambda r: r["train"]["calmar"], reverse=True)[0]
            trend_source = "验证期没有超额，改用回撤更小且收益接近的参数"
        else:
            trend_choice = next(r for r in trend_rows if r["ma"] == 60 and r["gate"] is True)
            trend_source = "验证未通过，退回20/60日且指数防守时空仓的预设"
    else:
        trend_source = "验证通过" if not (trend_choice["ma"] == 60 and trend_choice["gate"]) else "验证通过，与预设一致"
        if trend_choice["ma"] == 60 and trend_choice["gate"]:
            trend_source = "验证通过，与预设一致"
        else:
            trend_source = "验证通过，采用验证集上仍有超额的参数"
    frozen_trend = {"ma": trend_choice["ma"], "gate": bool(trend_choice["gate"]), "source": trend_source}
    ma_key = {20: "ma20", 40: "ma40", 60: "ma60", 120: "ma120"}[frozen_trend["ma"]]
    frozen_daily = panels[(frozen_trend["ma"], frozen_trend["gate"])]

    decisions = []
    for s in stocks:
        snap = decide(s["book"], market_last["regime_code"], ma_key, frozen_trend["gate"], frozen_repair)
        stats = stock_test_stats(s["book"], regime, ma_key, frozen_trend["gate"]) or {}
        decisions.append(
            {
                "code": s["code"],
                "name": s["name"],
                "sector": s["sector"],
                "pinned": s["code"] in HOLDINGS,
                **snap,
                **stats,
            }
        )

    holdings = []
    by_code = {s["code"]: s for s in stocks}
    for code in ("002463", "000426"):
        s = by_code[code]
        snap = next(d for d in decisions if d["code"] == code)
        holdings.append(holding_plan(code, s["name"], snap, market_last["regime"], frozen_repair))

    def pack_repair(row, selected):
        return {
            "bounce": row["bounce"],
            "dip": row["dip"],
            "rsi_sell": row["rsi_sell"],
            "enable_add": row["enable_add"],
            "selected": selected,
            "train_lift": row["train"]["lift"],
            "train_recover": row["train"]["strategy_recover"],
            "train_hold_recover": row["train"]["hold_recover"],
            "valid_lift": row["valid"]["lift"],
            "valid_recover": row["valid"]["strategy_recover"],
            "valid_hold_recover": row["valid"]["hold_recover"],
            "test_lift": row["test"]["lift"],
            "test_recover": row["test"]["strategy_recover"],
            "test_hold_recover": row["test"]["hold_recover"],
            "test_n": row["test"]["n"],
        }

    selected_repair_key = (
        frozen_repair["bounce"],
        frozen_repair["dip"],
        frozen_repair["rsi_sell"],
        frozen_repair["enable_add"],
    )
    payload = {
        "generated": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "asof": market_last["date"],
        "universe": len(stocks),
        "failed": failed,
        "coverage": {
            "n": len(stocks),
            "n_from_2015": sum(1 for s in stocks if s["first"] <= "2015-12-31"),
            "earliest": min(s["first"] for s in stocks),
            "latest_start": max(s["first"] for s in stocks),
        },
        "market": {k: v for k, v in market_last.items() if k != "regime_code"},
        "trend": {
            "frozen": frozen_trend,
            "splits": {
                "train": trend_choice["train"],
                "valid": trend_choice["valid"],
                "test": trend_choice["test"],
            },
            "curves": {
                "train": curve_of(frozen_daily, TREND_START, TRAIN_END),
                "valid": curve_of(frozen_daily, TRAIN_END, VALID_END),
                "test": curve_of(frozen_daily, VALID_END, None),
            },
            "yearly": yearly_table(frozen_daily, VALID_END),
            "grid": [
                {
                    "ma": r["ma"],
                    "gate": r["gate"],
                    "selected": r["ma"] == frozen_trend["ma"] and r["gate"] == frozen_trend["gate"],
                    "train_return": r["train"].get("strategy_return"),
                    "train_calmar": r["train"].get("calmar"),
                    "valid_return": r["valid"].get("strategy_return"),
                    "valid_excess": r["valid"].get("excess"),
                    "valid_maxdd": r["valid"].get("strategy_maxdd"),
                    "test_return": r["test"].get("strategy_return"),
                    "test_excess": r["test"].get("excess"),
                    "test_maxdd": r["test"].get("strategy_maxdd"),
                    "hold_test": r["test"].get("hold_return"),
                    "hold_test_maxdd": r["test"].get("hold_maxdd"),
                }
                for r in trend_rows
            ],
        },
        "repair": {
            "frozen": frozen_repair,
            "counts": counts,
            "splits": {"train": chosen["train"], "valid": chosen["valid"], "test": chosen["test"]},
            "deep_test": deep_test,
            "grid": [
                pack_repair(r, (r["bounce"], r["dip"], r["rsi_sell"], r["enable_add"]) == selected_repair_key)
                for r in repair_rows
            ],
        },
        "stocks": decisions,
        "holdings": holdings,
        "method": {
            "train": "2015-01-01 至 2021-12-31（均线不满的开头几天自然空过；深跌样本用 2022 年以前）",
            "valid": "2022-01-01 至 2023-12-31",
            "test": "2024-01-01 至 " + market_last["date"],
            "cost": "趋势换仓单边 0.15%；修复策略另计佣金万2.5最低5元、印花税万5、滑点每边0.1%",
            "repair_rule": "从120日高点回撤30%的次日开始，最多持有120个交易日，目标是涨回那段高点",
        },
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)
    print("wrote", OUT)
    te = payload["trend"]["splits"]["test"]
    print("trend test", te["strategy_return"], "hold", te["hold_return"], frozen_trend)
    print("repair test", chosen["test"], frozen_repair)


if __name__ == "__main__":
    main()
