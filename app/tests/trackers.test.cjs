const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const m = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/lib/trackers.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, { module: m, exports: m.exports, require: n => { if (n === '@tauri-apps/api/core') return { invoke: () => { throw Error('unexpected call'); } }; throw Error(n); } });
const { trackerStats, trackerWindow, trackerInsights, METALS } = m.exports;
const p = (date, value) => ({ date, value, url: 'https://source.example' });
const s = (points, frequency = 'monthly') => ({ id: 'sales-1', subject: '1', name: '销量', basis: '月销榜', unit: '辆/月', frequency, points });
test('missing sales months never become false MoM or zeros', () => { const a = trackerStats(s([p('2025-01', 100), p('2025-03', 80)])); assert.equal(a.latestChange, null); assert.equal(a.gaps, 1); assert.ok(Math.abs(a.periodChange + 20) < 1e-8); assert.equal(a.yoy, null); });
test('YoY matches exact calendar month and zero sales stay valid', () => { const a = trackerStats(s([p('2024-03', 100), p('2025-02', 80), p('2025-03', 0)]), 24); assert.equal(a.yoy, -100); assert.equal(a.latestChange, -100); const b = trackerStats(s([p('2025-01', 0), p('2025-02', 100)])); assert.equal(b.latestChange, null); });
test('daily change labels the previous actual observation rather than calendar daily change', () => { const a = trackerStats(s([p('2025-03-07', 100), p('2025-03-10', 110)], 'daily')); assert.equal(a.previous.date, '2025-03-07'); assert.ok(Math.abs(a.latestChange - 10) < 1e-8); assert.equal(a.gaps, null); });
test('calendar windows and observed drawdown exclude earlier peak', () => { const data = s([p('2024-01', 300), p('2025-01', 100), p('2025-02', 120), p('2025-03', 90)]); const a = trackerStats(data, 6); assert.equal(a.points.length, 3); assert.equal(a.drawdown, -25); assert.equal(a.high, 120); assert.equal(a.low, 90); assert.equal(trackerWindow(data, 1).length, 1); });
test('single observations provide no invented price history or percentage', () => { const data = { ...s([p('2025-03-10', 64800)], 'daily'), id: 'price-1-low', unit: '元/辆' }; const a = trackerStats(data); assert.equal(a.latestChange, null); assert.equal(a.periodChange, null); assert.equal(a.drawdown, null); assert.ok(trackerInsights(data, 12).some(x => x.includes('配置'))); assert.equal(trackerStats(s([])).last, undefined); });
test('required metals and Tauri command ACL are complete', () => { for (const id of ['AU0', 'AG0', 'CU0', 'AL0', 'LC0', 'APT']) assert.ok(METALS.some(m => m.id === id)); for (const command of ['tracker_bootstrap', 'tracker_report', 'tracker_mutate']) for (const path of ['src-tauri/build.rs', 'src-tauri/src/lib.rs', 'src-tauri/permissions/app.toml']) assert.ok(fs.readFileSync(require('node:path').join(__dirname, '../..', path), 'utf8').includes(command), `${command} in ${path}`); });

test('12 month chart retains full calendar axis when only one sales point is available', () => {
  const data = s([p('2026-09', 14577)]); const axis = m.exports.trackerAxis(data, 12, '2026-09');
  assert.equal(axis.labels.length, 12); assert.equal(axis.labels[0], '2025-10'); assert.equal(axis.labels[11], '2026-09');
  assert.equal(axis.values.filter(x => x == null).length, 11); assert.equal(axis.values[11], 14577);
  const a = trackerStats(data, 12, '2026-09'); assert.equal(a.gaps, 11); assert.equal(a.latestChange, null);
});
test('selected month anchors history rather than pulling data outside selected range', () => {
  const data = s([p('2024-01', 100), p('2025-09', 200), p('2026-09', 300)]);
  const a = trackerStats(data, 12, '2025-09'); assert.equal(a.points.length, 1); assert.equal(a.last.value, 200); assert.equal(a.gaps, 11);
  const axis = m.exports.trackerAxis(s([]), 12, '2026-09'); assert.equal(axis.labels.length, 12); assert.ok(axis.values.every(x => x === null));
});
