"""Refresh the established research universe, then compare and review models."""
import os
from concurrent.futures import ThreadPoolExecutor
import pandas as pd
import build_platform as bp
import strategy_lab
import broad_universe

def main():
    frame = broad_universe.load(bp.DATA)
    frame.to_csv(os.path.join(bp.DATA,'universe.csv'),index=False)
    universe = [(str(r.code).zfill(6),r.name,r.sector) for r in frame.itertuples(index=False)]
    print('expanded universe', len(universe), flush=True)
    codes = ['000300','399006'] + [c for c,_,_ in universe]
    with ThreadPoolExecutor(max_workers=16) as pool:
        results = []
        for i, result in enumerate(pool.map(bp.load_code,codes)):
            results.append(result)
            if i % 25 == 0: print('download',i+1,'/',len(codes),flush=True)
    covered = sum(d is not None and 'volume' in d and len(d) >= 400 for d in results)
    print('volume coverage',covered,'/',len(codes),flush=True)
    if covered-2 < broad_universe.MINIMUM:
        raise RuntimeError(f'有效量价样本仅{covered-2}只，不足4000，保留旧结果')
    strategy_lab.main(cached=True)

if __name__ == '__main__':
    main()
