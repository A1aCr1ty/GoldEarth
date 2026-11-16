const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const moduleUnderTest = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/lib/indexSwing.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { module: moduleUnderTest, exports: moduleUnderTest.exports });
const { evaluateIndexSwing, INDEX_ETFS, mergeIndexEtfs, normalizeEtfCode } = moduleUnderTest.exports;

function bars(count, start, step) {
  return Array.from({ length: count }, (_, i) => {
    const close = start + i * step;
    const date = new Date(Date.UTC(2026, 10, 13 - (count - 1 - i))).toISOString().slice(0, 10);
    return { date, open: close - step / 2, close, high: close + 0.02, low: close - 0.02, volume: 1000 + i % 5 * 100 };
  });
}
function quote(price, time = '20261113150000') {
  return { code: 'sh510300', price, changePct: 1, time };
}

test('six requested ETFs use verified securities codes', () => {
  assert.deepEqual(Array.from(INDEX_ETFS, item => item.code), ['sz159915', 'sh510300', 'sh512890', 'sz159516', 'sh588200', 'sh588000']);
});

test('custom ETF codes normalize exchange prefixes and reject invalid identifiers', () => {
  assert.equal(normalizeEtfCode('510300'), 'sh510300');
  assert.equal(normalizeEtfCode(' SZ159915 '), 'sz159915');
  assert.equal(normalizeEtfCode('588000'), 'sh588000');
  assert.throws(() => normalizeEtfCode('51030'), /6位/);
  assert.throws(() => normalizeEtfCode('999999'), /交易所/);
});

test('custom watchlist merges without duplicates and ignores malformed saved records', () => {
  const merged = mergeIndexEtfs([
    { code: '159941', name: '纳指ETF' },
    { code: 'sh510300', name: '重复内置' },
    { code: '513100', name: '' },
    { code: 'bad', name: '无效记录' },
  ]);
  assert.equal(merged.length, 8);
  assert.equal(merged[6].code, 'sz159941');
  assert.equal(merged[6].name, '纳指ETF');
  assert.equal(merged[7].name, '指数ETF 513100');
  assert.equal(mergeIndexEtfs([{ code: 'bad', name: '无效记录' }]).length, 6);
});

test('current price and ATR form an ordered technical price ladder', () => {
  const result = evaluateIndexSwing(bars(100, 2, 0.002), quote(2.25), '2026-11-15');
  assert.equal(result.ready, true);
  assert.ok(result.prices.stop < result.prices.entryLow);
  assert.ok(result.prices.entryHigh < result.current);
  assert.ok(result.current < result.prices.breakout);
  assert.ok(result.prices.breakout < result.prices.takeProfit);
  assert.ok(['右侧买入观察', '冲高减仓复核', '等待回调，不追涨'].includes(result.action));
});

test('bearish trend and weak MACD prioritize exit review', () => {
  const result = evaluateIndexSwing(bars(100, 3, -0.01), quote(1.95), '2026-11-15');
  assert.equal(result.ready, true);
  assert.equal(result.trend, '空头');
  assert.equal(result.action, '空仓等待 / 减仓复核');
});

test('extended current price suppresses chasing', () => {
  const result = evaluateIndexSwing(bars(100, 2, 0.002), quote(2.45), '2026-11-15');
  assert.equal(result.ready, true);
  assert.equal(result.action, '等待回调，不追涨');
  assert.ok(result.extensionAtr > 2);
});

test('short, stale and invalid inputs do not produce advice', () => {
  assert.equal(evaluateIndexSwing(bars(20, 2, 0.002), quote(2.1), '2026-11-15').ready, false);
  assert.equal(evaluateIndexSwing(bars(100, 2, 0.002), quote(2.2, '20260101150000'), '2026-11-15').ready, false);
  assert.equal(evaluateIndexSwing(bars(100, 2, 0.002), null, '2026-11-15').ready, false);
});
