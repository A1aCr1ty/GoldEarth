# -*- coding: utf-8 -*-
"""每日收盘复盘：更新行情、重建基线、比较候选策略并保存历史。"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime

ROOT = os.path.dirname(os.path.abspath(__file__))
LOG_DIR = os.path.join(ROOT, "platform", "logs")
os.makedirs(LOG_DIR, exist_ok=True)


def run(script: str) -> None:
    log = os.path.join(LOG_DIR, datetime.now().strftime("%Y-%m-%d") + ".log")
    with open(log, "a", encoding="utf-8") as f:
        f.write(f"\n===== {datetime.now():%Y-%m-%d %H:%M:%S} {script} =====\n")
        f.flush()
        subprocess.run([sys.executable, os.path.join(ROOT, script)], cwd=ROOT, stdout=f, stderr=subprocess.STDOUT, check=True)


def main() -> None:
    run("build_platform.py")
    run("strategy_lab.py")
    with open(os.path.join(ROOT, "platform", "adaptive_results.json"), encoding="utf-8") as f:
        result = json.load(f)
    selected = result["selected"]
    print(f"复盘日期：{result['asof']}")
    print(f"当前策略：{selected['name']}")
    print(f"样本外收益：{selected['test']['return']:.2%}，最大回撤：{selected['test']['maxdd']:.2%}")
    for holding in result["holdings"]:
        views = []
        for horizon, forecast in holding["forecast"]["horizons"].items():
            views.append(f"{horizon} 日 {forecast['direction']}")
        print(f"{holding['name']}：次日目标仓位 {holding['next_session_position']:.0%}；{'；'.join(views)}")
    print("结果已保存到 platform/adaptive_results.json；历史已追加到 daily_review_history.jsonl。")


if __name__ == "__main__":
    main()
