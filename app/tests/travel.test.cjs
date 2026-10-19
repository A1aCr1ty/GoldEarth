const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(path, requireMock, context = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve(path), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { module, exports: module.exports, require: requireMock, ...context });
  return module.exports;
}
function setup(request, clock) {
  const { useTravel } = load('../src/store/travel.ts', name => {
    if (name === 'zustand') return require('zustand');
    if (name === '@/lib/tauri') return { tauri: { dailyTravel: request } };
    throw Error(name);
  }, clock ? { Date: clock } : {});
  return useTravel;
}
const report = date => ({ date, status: 'live', sources: [] });

test('one day shares pending requests and reuses the completed recommendation', async () => {
  let calls = 0, complete;
  const store = setup(() => { calls++; return new Promise(resolve => { complete = resolve; }); });
  const first = store.getState().load('2026-10-16');
  const second = store.getState().load('2026-10-16');
  assert.equal(first, second);
  assert.equal(first, store.getState().load('2026-10-16', true));
  complete(report('2026-10-16')); await first;
  await store.getState().load('2026-10-16');
  assert.equal(calls, 1);
  assert.equal(store.getState().loading, false);
});

test('an offline recommendation is retried after cooldown instead of cached for the entire day', async () => {
  let calls = 0, now = 1000;
  const store = setup(async date => { calls++; return { ...report(date), status: 'offline' }; }, { now: () => now });
  await store.getState().load('2026-10-19');
  await store.getState().load('2026-10-19');
  assert.equal(calls, 1);
  now += 31_000;
  await store.getState().load('2026-10-19');
  assert.equal(calls, 2);
  await store.getState().load('2026-10-19', true);
  assert.equal(calls, 3);
});

test('crossing midnight ignores a late response for the previous day', async () => {
  const pending = {};
  const store = setup(date => new Promise(resolve => { pending[date] = resolve; }));
  const old = store.getState().load('2026-10-16');
  const today = store.getState().load('2026-10-17');
  pending['2026-10-17'](report('2026-10-17')); await today;
  pending['2026-10-16'](report('2026-10-16')); await old;
  assert.equal(store.getState().report.date, '2026-10-17');
});

test('refresh failure preserves the successful recommendation and exposes an error', async () => {
  let calls = 0;
  const store = setup(async () => { if (++calls > 1) throw Error('offline'); return report('2026-10-16'); });
  await store.getState().load('2026-10-16');
  await store.getState().load('2026-10-16', true);
  assert.equal(calls, 2);
  assert.equal(store.getState().report.date, '2026-10-16');
  assert.match(store.getState().error, /offline/);
  assert.equal(store.getState().loading, false);
});

test('the travel card labels offline plans honestly and renders the complete guide', () => {
  const React = require('react');
  const destination = JSON.parse(fs.readFileSync(require.resolve('../../src-tauri/src/travel/destinations.json'), 'utf8'))[0];
  const { DailyTravelCard } = load('../src/components/dashboard/DailyTravelCard.tsx', name => {
    if (name === 'react') return React;
    if (name === 'react/jsx-runtime') return require('react/jsx-runtime');
    if (name === '@/store/travel') return { useTravel: () => ({ report: {
      schemaVersion: 1, date: '2026-10-16', status: 'offline', destination,
      sources: [], researchedAt: null, warning: '联网搜索失败', diagnostics: ['搜狗：请求超时', 'Bing RSS：RSS 为空或仅返回无关结果'],
    }, loading: false, load: async () => {} }) };
    if (name === '@/lib/tauri') return { tauri: {} };
    return new Proxy({}, { get: () => ({ children }) => React.createElement('div', null, children) });
  });
  const html = require('react-dom/server').renderToStaticMarkup(React.createElement(DailyTravelCard, { date: '2026-10-16' }));
  assert.match(html, /本地路线参考/);
  assert.doesNotMatch(html, /已联网检索/);
  assert.match(html, /检索详情/);
  assert.match(html, /搜狗：请求超时/);
  for (const text of ['杭州', '断桥', '交通与住宿', '吃点当地的', '不含往返大交通', '联网搜索失败']) assert.ok(html.includes(text), text);
});
