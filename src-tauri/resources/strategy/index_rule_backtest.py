import json
from pathlib import Path

import pandas as pd

from index_grid_backtest import ETFS, load_etf
from index_rule_strategies import classic_grid_backtest, oversold_swing_backtest, public_result


def main():
    items = []
    for etf in ETFS:
        frame = load_etf(etf['code'])
        grid = classic_grid_backtest(frame, start='2024-01-01')
        pyramid = classic_grid_backtest(frame, start='2024-01-01', allocation='pyramid')
        profit = classic_grid_backtest(frame, start='2024-01-01', leave_profit=True)
        swing = oversold_swing_backtest(frame, start='2024-01-01')
        items.append({
            **etf,
            'grid': public_result(grid),
            'grid_pyramid': public_result(pyramid),
            'grid_profit': public_result(profit),
            'oversold': public_result(swing),
        })
        print(f"{etf['name']} 网格 {grid['total_return']:.2%} / 回撤 {grid['max_drawdown']:.2%} / {grid['trades']}笔；"
              f"超跌 {swing['total_return']:.2%} / 回撤 {swing['max_drawdown']:.2%} / {swing['swing_round_trips']}轮 / {swing['stop_exits']}次止损")
    result = {
        'generated': pd.Timestamp.now(tz='Asia/Shanghai').isoformat(),
        'test_start': '2024-01-01',
        'grid_model': '滚动250日收盘价10%/90%分位为上下限；0.5×ATR14/价格作为网格比例并限制在2%～5%；等分每格1万元，最多10个开仓格；跌破下限停止加仓。另保留金字塔加码与卖出留利润对照。',
        'swing_model': 'BIAS20<-6且W&R14>85并拐头向下时，下一交易日开盘买入20%机动仓；可得历史价格分位≤15%时建立60%底仓（价格代理，不是估值）；CMF20>0、收盘>MA20且位于SuperTrend(10,3)上方时追加20%；W&R<20或BIAS20>5退出机动仓；放量跌破买入前20日低点或成本回撤6%止损，底仓不参与波段卖出。',
        'execution': '初始10万元；信号仅使用已完成日线，下一交易日开盘执行；买入100份整数倍；佣金万1最低5元；单边滑点万5；不计印花税；留利润模式按1份取整计算本金卖出数量，保留份额不再参与网格卖出。',
        'limitations': '固定规则直接做历史检验，不进行参数寻优。底仓使用最长1250日、至少250日的价格分位代理，不是五年PE/PB估值分位；未接入估值历史前不应据此宣称低估。日频网格按开盘价和跨格信号近似，不模拟盘中逐档成交、涨跌停、停牌、申赎与分红现金流。历史收益不代表未来表现。',
        'items': items,
    }
    output = Path(__file__).resolve().parents[3] / 'app' / 'src' / 'lib' / 'indexRuleBacktest.json'
    output.write_text(json.dumps(result, ensure_ascii=False, allow_nan=False, indent=2), encoding='utf-8')
    print(f'已写入 {output}')


if __name__ == '__main__':
    main()
