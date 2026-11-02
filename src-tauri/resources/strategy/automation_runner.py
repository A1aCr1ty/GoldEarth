# -*- coding: utf-8 -*-
"""定时任务入口：执行本地复盘并返回结构化摘要。"""
import json
import os

import daily_review


def run(ctx):
    daily_review.main()
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "platform", "adaptive_results.json")
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    selected = data["selected"]
    holdings = []
    for item in data["holdings"]:
        holdings.append({
            "code": item["code"],
            "name": item["name"],
            "nextSessionPosition": item["next_session_position"],
            "forecast": item["forecast"]["horizons"],
        })
    summary = (
        f"{data['asof']} 复盘完成：{selected['name']}，"
        f"样本外收益 {selected['test']['return']:.2%}，"
        f"最大回撤 {selected['test']['maxdd']:.2%}。"
        "预测仅在滚动验证优于基准时提供方向，否则保持中性。"
    )
    return {"artifact": {
        "summary": summary,
        "asOf": data["asof"],
        "strategy": selected["name"],
        "testReturn": selected["test"]["return"],
        "maxDrawdown": selected["test"]["maxdd"],
        "holdings": holdings,
        "source": "东方财富前复权日线",
        "stale": False,
    }}
