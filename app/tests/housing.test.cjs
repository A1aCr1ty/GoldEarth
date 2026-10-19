const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const moduleUnderTest = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/lib/housing.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
  module: moduleUnderTest, exports: moduleUnderTest.exports,
  require: name => { if (name === '@tauri-apps/api/core') return { invoke: () => { throw Error('unexpected backend call'); } }; throw Error(name); },
});
const { analyzeHousing, windowPoints, mortgage, housingContext } = moduleUnderTest.exports;
const point = (month, value, extra = {}) => ({ month, value, mom: null, yoy: null, ...extra });
const series = points => ({ id: 'anjuke-second', name: '参考价', basis: '平台参考单价', unit: '元/㎡', kind: 'second', sourceUrl: 'https://example.com/price', points });

test('missing months never become a false monthly or yearly comparison', () => {
  const a = analyzeHousing(series([point('2026-01', 10000), point('2026-03', 9000)]));
  assert.equal(a.mom, null); assert.equal(a.yoy, null); assert.equal(a.gaps, 1);
  assert.ok(Math.abs(a.periodChange + 10) < 1e-8);
  assert.equal(a.volatility, null);
});
test('year-over-year uses the same calendar month and official percentages retain their own basis', () => {
  const a = analyzeHousing(series([point('2025-09', 20000), point('2026-08', 18000), point('2026-09', 17000)]), 24);
  assert.ok(Math.abs(a.yoy + 15) < 1e-8); assert.ok(Math.abs(a.mom - (17000 / 18000 - 1) * 100) < 1e-8);
  const b = analyzeHousing({ ...series([point('2026-09', 100, { mom: -0.2, yoy: -3 })]), unit: '指数（首期=100）', basis: '官方销售价格指数' });
  assert.equal(b.mom, -0.2); assert.equal(b.yoy, -3); assert.equal(b.periodChange, null);
});
test('window uses calendar months and observed drawdown is measured from a prior peak', () => {
  const s = series([point('2025-01', 50), point('2026-01', 100), point('2026-02', 120), point('2026-03', 90)]);
  assert.equal(windowPoints(s, 6).length, 3);
  assert.ok(Math.abs(analyzeHousing(s).drawdown + 25) < 1e-8);
});
test('cashflow calculator handles zero interest and rejects invalid loan assumptions', () => {
  const a = mortgage(3000000, 30, 0, 30);
  assert.equal(a.down, 900000); assert.equal(a.principal, 2100000); assert.equal(a.payment, 2100000 / 360); assert.ok(Math.abs(a.interest) < 1e-6);
  const b = mortgage(3000000, 30, 3.2, 30);
  assert.ok(b.payment > a.payment); assert.ok(b.interest > 0);
  for (const args of [[0, 30, 3, 30], [3000000, 110, 3, 30], [3000000, 30, -1, 30], [3000000, 30, 3, 0]]) assert.equal(mortgage(...args), null);
});
test('rebased index segments cannot create a false cumulative change or drawdown', () => {
  const s = { ...series([point('2026-01', 100, { anchorMonth: '2026-01' }), point('2026-02', 120, { anchorMonth: '2026-01' }), point('2026-04', 100, { anchorMonth: '2026-04', mom: -0.2, yoy: -3 })]), unit: '指数（连续区间首期=100）' };
  const a = analyzeHousing(s);
  assert.equal(a.points.length, 3); assert.equal(a.periodChange, null); assert.equal(a.drawdown, null); assert.equal(a.mom, -0.2); assert.equal(a.yoy, -3);
});
test('analysis context includes evidence and does not mix source series', () => {
  const s = series([point('2026-09', 30000)]);
  const report = { cityName: '杭州', query: { kind: 'second', community: { name: '示例小区' } }, fetchedAt: '2026-10-19', series: [s, { ...s, id: 'manual:one', basis: '成交记录' }], sources: [{ name: '安居客', status: 'cached' }], links: [{ url: 'https://example.com/evidence', title: '数据来源' }] };
  const context = JSON.parse(housingContext(report, s, 12));
  assert.equal(context.scope.community, '示例小区'); assert.equal(context.selectedSeries.basis, '平台参考单价');
  assert.equal(context.otherSeries[0].basis, '成交记录'); assert.equal(context.relatedArticles[0].url, 'https://example.com/evidence');
});
test('housing commands are registered in all three ACL lists', () => {
  for (const name of ['housing_bootstrap', 'housing_report', 'housing_communities', 'housing_watch', 'housing_remove', 'housing_observe', 'housing_source_open', 'housing_source_read']) {
    for (const path of ['../../src-tauri/build.rs', '../../src-tauri/permissions/app.toml', '../../src-tauri/src/lib.rs']) assert.ok(fs.readFileSync(require.resolve(path), 'utf8').includes(name), `${path}: ${name}`);
  }
});
