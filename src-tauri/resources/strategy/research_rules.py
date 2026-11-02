"""Source-labelled, predeclared research approximations. No future observations."""
import numpy as np
import pandas as pd


def candidates():
    return [
        {"family": "Z哥·研究近似", "name": f"Z-B1 J{j} / BBI", "kind": "z_b1", "j_entry": j, "source_id": "z-b1"}
        for j in (-10, -20)
    ] + [
        {"family": "Z哥·研究近似", "name": "Z-B2 放量确认", "kind": "z_b2", "source_id": "z-b2"},
        {"family": "常士杉·研究近似", "name": "常·五日量价", "kind": "chang_five", "source_id": "chang-five"},
        {"family": "常士杉·研究近似", "name": "常·波段反弹", "kind": "chang_wave", "source_id": "chang-wave"},
        {"family": "常士杉·文章修订", "name": "常·五日修订/20%研究止损", "kind": "chang_five_v2", "stop_pct": .20, "active_volume": False, "source_id": "chang-articles-v2"},
        {"family": "常士杉·文章修订", "name": "常·五日修订/活跃量/ATR", "kind": "chang_five_v2", "stop_pct": None, "active_volume": True, "source_id": "chang-articles-v2"},
    ]


def enrich(b):
    c, h, l = (pd.Series(b[k], dtype=float) for k in ("close", "high", "low"))
    v = pd.Series(b.get("volume", np.full(len(c), np.nan)), dtype=float)
    b["volume"] = v.to_numpy()
    b["bbi"] = sum(c.rolling(n).mean() for n in (3, 6, 12, 24)).to_numpy() / 4
    low, high = l.rolling(9).min(), h.rolling(9).max()
    rsv = ((c - low) / (high - low).replace(0, np.nan) * 100).fillna(50)
    k, d, js = 50., 50., []
    for r in rsv:
        k = k * 2 / 3 + r / 3
        d = d * 2 / 3 + k / 3
        js.append(3 * k - 2 * d)
    b["j"] = np.array(js)
    b["volume5"] = v.shift(1).rolling(5).mean().to_numpy()
    b["ma5"] = c.rolling(5).mean().to_numpy()
    b["atr14"] = pd.concat([h-l,(h-c.shift()).abs(),(l-c.shift()).abs()],axis=1).max(axis=1).rolling(14).mean().to_numpy()
    return b


def signal(b, p, regime):
    c, o, v, j, bbi = (b[k] for k in ("close", "open", "volume", "j", "bbi"))
    out = np.zeros(len(c))
    held, entry, stop, start, halved = 0., 0., 0., 0, False
    risk_stop = 0.
    for i in range(60, len(c)):
        # Entry-price checks use an already observed following open, not the signal close.
        if held and i == start + 1:
            entry = o[i]
            pct = p.get('stop_pct')
            risk_stop = entry * (1 - pct) if pct else entry - min(entry*.20, max(entry*.08, 3*b['atr14'][start]))
        if regime.get(b["date"][i], 0) == 0 or not np.isfinite(v[i]) or v[i] <= 0 or min(c[i], c[i-1], o[i]) <= 0:
            held = 0.
            out[i] = held
            continue
        kind = p["kind"]
        if held:
            exit_ = False
            if kind.startswith("z_"):
                exit_ = c[i] < stop or c[i] < bbi[i] or i - start >= 20
                if kind == "z_b2" and i == start + 1:
                    exit_ |= c[i] < o[i] and v[i] >= .75 * v[start]
            elif kind in ("chang_five", "chang_five_v2"):
                exit_ = c[i] < b["ma20"][i] if kind == 'chang_five' else c[i] <= risk_stop
                if not halved and c[i] < .925 * b["ma5"][i]:
                    held, halved = .5, True
            elif kind == "chang_wave":
                exit_ = c[i] >= entry * 1.05 or c[i] <= entry * .95 or i - start >= 5
            if exit_:
                held = 0.
            out[i] = held
            continue
        enter = False
        if kind == "z_b1":
            enter = min(j[i-5:i]) <= p["j_entry"] and j[i] > j[i-1] and c[i] > bbi[i] > bbi[i-1]
        elif kind == "z_b2":
            enter = min(j[i-5:i]) <= -10 and c[i] / c[i-1] >= 1.04 and c[i] > o[i] and c[i] > bbi[i] and v[i] >= 1.5 * b["volume5"][i]
        elif kind in ("chang_five", "chang_five_v2"):
            rising = all(v[t] > v[t-1] > 0 for t in range(i-2, i+1))
            active = p.get('active_volume') and all(v[t] >= b['volume5'][t] > 0 for t in range(i-2, i+1))
            enter = c[i] > b["ma5"][i] and (rising or active) and any(v[t] >= 1.45 * v[t-1] > 0 for t in range(i-6, i+1))
        elif kind == "chang_wave":
            enter = b["ma60"][i] > b["ma60"][i-1] and c[i] > b["ma60"][i] and c[i] / c[i-1] <= .97
        if enter:
            held, start, stop, entry, halved = 1., i, b["low"][i], c[i], False
        out[i] = held
    return out
