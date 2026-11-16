const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const moduleUnderTest = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/lib/indexRuleSignals.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { module: moduleUnderTest, exports: moduleUnderTest.exports });
const { evaluateClassicGridSignal, evaluateOversoldSignal, oversoldAction } = moduleUnderTest.exports;

function history(closes) {
  return closes.map((close, index) => ({
    date: new Date(Date.UTC(2026, 10, 13 - (closes.length - 1 - index))).toISOString().slice(0, 10),
    open: close, close, high: close * 1.01, low: close * 0.99, volume: 1000,
  }));
}
function quote(price, time = '20261116150000') {
  return { price, time, open: price, high: price * 1.01, low: price * 0.99, volume: 1200 };
}
const gridModel = { date: '2026-11-13', openGrids: 2 };

test('live grid converts current price crossings into buy and sell grid counts', () => {
  const bars = history([9, 9.5, 10, 10.5, 11].flatMap(value => Array(60).fill(value)));
  const buy = evaluateClassicGridSignal(bars, quote(10), gridModel, '2026-11-16');
  assert.equal(buy.ready, true);
  assert.equal(buy.kind, 'buy');
  assert.match(buy.action, /买入复核 [1-9]/);
  assert.ok(buy.nextBuy < buy.current);
  const sell = evaluateClassicGridSignal(bars, quote(12), gridModel, '2026-11-16');
  assert.equal(sell.kind, 'sell');
  assert.match(sell.action, /卖出复核 1 个/);
});

test('live grid enforces maximum open grids and lower-bound protection', () => {
  const bars = history([9, 9.5, 10, 10.5, 11].flatMap(value => Array(60).fill(value)));
  const capped = evaluateClassicGridSignal(bars, quote(10), { date: '2026-11-13', openGrids: 10 }, '2026-11-16');
  assert.equal(capped.kind, 'stop');
  assert.match(capped.action, /最大开放格数/);
  const broken = evaluateClassicGridSignal(bars, quote(8), gridModel, '2026-11-16');
  assert.equal(broken.kind, 'stop');
  assert.match(broken.action, /跌破网格下限/);
  assert.equal(evaluateClassicGridSignal(bars, quote(10), { date: '2026-11-12', openGrids: 2 }, '2026-11-16').ready, false);
  assert.equal(evaluateClassicGridSignal(bars, quote(10, '20260101150000'), gridModel, '2026-11-16').ready, false);
});

const metrics = {
  current: 10, bias20: -10, wr14: 90, previousWr14: 95, cmf20: 0.1,
  ma20: 11, supertrend: 9.5, pricePercentile: 0.1, volumeRatio: 1,
};
const emptyModel = { date: '2026-11-13', baseWeight: 0, swingWeight: 0, swingAverageCost: null, entryLow: null, rightAdded: false };
const holdingModel = { ...emptyModel, swingWeight: 0.2, swingAverageCost: 10, entryLow: 9.5 };

test('oversold action requires double confirmation and exposes separate base instruction', () => {
  const result = oversoldAction(metrics, emptyModel);
  assert.equal(result.kind, 'buy');
  assert.match(result.action, /买入20%机动仓/);
  assert.match(result.baseAction, /60%底仓/);
  assert.equal(oversoldAction({ ...metrics, wr14: 80 }, emptyModel).kind, 'wait');
  assert.equal(oversoldAction({ ...metrics, previousWr14: 89 }, emptyModel).kind, 'wait');
});

test('hard stop and volume break take priority over indicator exit', () => {
  const hard = oversoldAction({ ...metrics, current: 9.3, wr14: 10 }, holdingModel);
  assert.equal(hard.kind, 'stop');
  assert.match(hard.action, /硬止损/);
  assert.ok(Math.abs(hard.stopPrice - 9.4) < 1e-10);
  const volume = oversoldAction({ ...metrics, current: 9.45, entryLow: 9.6, volumeRatio: 1.6 }, holdingModel);
  assert.equal(volume.kind, 'stop');
  assert.match(volume.action, /放量跌破/);
});

test('oversold holding distinguishes indicator exit, right-side add and hold', () => {
  const exit = oversoldAction({ ...metrics, wr14: 15 }, holdingModel);
  assert.equal(exit.kind, 'sell');
  const add = oversoldAction({ ...metrics, current: 10.5, ma20: 10, supertrend: 10, bias20: 1, wr14: 50 }, holdingModel);
  assert.equal(add.kind, 'add');
  assert.match(add.action, /追加20%/);
  assert.equal(oversoldAction({ ...metrics, bias20: 1, wr14: 50, cmf20: -0.1 }, holdingModel).kind, 'hold');
  assert.equal(oversoldAction({ ...metrics, current: 10.5, ma20: 10, supertrend: 10, bias20: 1, wr14: 50 }, { ...holdingModel, rightAdded: true }).kind, 'hold');
});

test('full current-price evaluation forms a fresh oversold signal from completed bars and quote', () => {
  const closes = Array(260).fill(12).concat([11, 10, 9, 8, 7.2, 6.9, 6.8, 6.7, 6.8]);
  const result = evaluateOversoldSignal(history(closes), quote(6.9), emptyModel, '2026-11-16');
  assert.equal(result.ready, true);
  assert.equal(result.kind, 'buy');
  assert.ok(result.bias20 < -6);
  assert.ok(result.wr14 > 85);
  assert.ok(result.wr14 < result.previousWr14);
  assert.ok(result.pricePercentile <= 0.15);
});
