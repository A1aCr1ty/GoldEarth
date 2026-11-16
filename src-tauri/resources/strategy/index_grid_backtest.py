import json
from pathlib import Path
import pandas as pd
import urllib.request
import time
from index_grid import backtest, public_result


def load_etf(code):
    cache_dir = Path(__file__).resolve().parents[3] / '.runlogs' / 'index-grid'
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache = cache_dir / f'{code}.csv'
    if cache.exists():
        cached = pd.read_csv(cache)
        if not cached.empty and str(cached['date'].max()) >= '2026-11-13':
            return cached
    symbol = ('sh' if code.startswith(('5', '6')) else 'sz') + code
    url = f'https://quotes.sina.cn/cn/api/jsonp_v2.php/var%20grid=/CN_MarketDataService.getKLineData?symbol={symbol}&scale=240&ma=no&datalen=1023'
    for attempt in range(3):
        try:
            request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0', 'Referer': 'https://finance.sina.com.cn/'})
            with urllib.request.urlopen(request, timeout=40) as response:
                text = response.read().decode('utf-8')
            start = text.find('([')
            end = text.rfind('])')
            if start < 0 or end < 0:
                raise ValueError('新浪日线格式无效')
            records = json.loads(text[start + 1:end + 1])
            break
        except Exception:
            if attempt == 2:
                raise
            time.sleep(attempt + 1)
    rows = [(r['day'], float(r['open']), float(r['close']), float(r['high']), float(r['low']), float(r['volume'])) for r in records]
    frame = pd.DataFrame(rows, columns=['date', 'open', 'close', 'high', 'low', 'volume']).drop_duplicates('date').sort_values('date').reset_index(drop=True)
    if len(frame) < 201:
        raise ValueError(f'{code} 有效日线不足')
    frame.to_csv(cache, index=False)
    return frame


ETFS = [
    {'code': '159915', 'name': '创业板ETF易方达'},
    {'code': '510300', 'name': '沪深300ETF华泰柏瑞'},
    {'code': '512890', 'name': '红利低波ETF华泰柏瑞'},
    {'code': '159516', 'name': '半导体设备ETF国泰'},
    {'code': '588200', 'name': '科创芯片ETF嘉实'},
    {'code': '588000', 'name': '科创50ETF华夏'},
]
VARIANTS = [(period, step) for period in (60, 120) for step in (0.5, 1.0, 1.5)]
SOURCES = [
    {'title': '广发金工：基于平均真实波幅(ATR)的ETF网格交易策略', 'url': 'https://finance.sina.com.cn/stock/stockzmt/2025-11-17/doc-infxspkn3873930.shtml'},
    {'title': '上海证券交易所：网格交易策略', 'url': 'https://etf.sse.com.cn/fund/learning/strategy/c/5734937.shtml'},
]


def main():
    items = []
    for etf in ETFS:
        frame = load_etf(etf['code'])
        candidates = []
        for period, step in VARIANTS:
            try:
                result = backtest(frame, period, step, '2022-01-01', '2023-12-31', trend_filter=True)
            except ValueError:
                continue
            if result['days'] >= 180 and result['sell_trades'] >= 3:
                score = result['annual_return'] - result['max_drawdown']
                candidates.append((score, result['win_rate'] or 0, period, step, result))
        if candidates:
            _, _, period, step, training = max(candidates, key=lambda value: (value[0], value[1]))
        else:
            period, step, training = 120, 1.0, None
        selected = backtest(frame, period, step, '2024-01-01', '2026-11-13', trend_filter=True)
        grid_only = backtest(frame, period, step, '2024-01-01', '2026-11-13')
        baseline = backtest(frame, 120, 1.0, '2024-01-01', '2026-11-13')
        items.append({**etf, 'training': public_result(training) if training else None, 'selected': public_result(selected), 'grid_only': public_result(grid_only), 'baseline': public_result(baseline)})
        print(f"{etf['name']} {period}日/{step}ATR 样本外收益 {selected['total_return']:.2%} 回撤 {selected['max_drawdown']:.2%} 胜率 {selected['win_rate'] if selected['win_rate'] is not None else '待积累'}")
    result = {
        'generated': pd.Timestamp.now(tz='Asia/Shanghai').isoformat(),
        'training_window': '2022-01-01/2023-12-31', 'test_window': '2024-01-01/2026-11-13',
        'model': 'NATR网格＋波段过滤：50%仓位中枢，每格调整10%；收盘>MA20>MA60且DIF>DEA时至少保留50%底仓，收盘<MA20<MA60且DIF<DEA时目标仓位上限20%；训练期仅按年化收益减最大回撤选参，样本外不重选，并与同参数纯网格对照。',
        'execution': '初始10万元；上一交易日信号在下一交易日开盘执行；每日最多一次调仓；100份整数倍；最低权益偏离5%才调仓；佣金万1最低5元；单边滑点万5；不计印花税；新浪不复权价格模拟，不含分红现金流。',
        'limitations': '网格胜率只统计已卖出批次，不含未平仓浮动盈亏。参数选择存在研究偏差，样本外也不等于未来收益。日频模型不模拟盘中成交、涨跌停、停牌、申赎、分红现金流和真实券商费用差异；不复权价格不包含ETF分红，不能与此前前复权结果直接拼接。',
        'sources': SOURCES, 'items': items,
    }
    output = Path(__file__).resolve().parents[3] / 'app' / 'src' / 'lib' / 'indexGridBacktest.json'
    output.write_text(json.dumps(result, ensure_ascii=False, allow_nan=False, indent=2), encoding='utf-8')
    print(f'已写入 {output}')


if __name__ == '__main__':
    main()
