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
const report = (date, days = 3) => ({ date, status: 'live', sources: [], destination: { days } });

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

test('different durations have separate requests and a late response cannot replace the selected plan', async () => {
  const requests = new Map();
  const store = setup((date, force, days) => new Promise(resolve => requests.set(days, resolve)));
  const short = store.getState().load('2026-10-22', false, 3);
  const long = store.getState().load('2026-10-22', false, 7);
  requests.get(7)(report('2026-10-22', 7)); await long;
  requests.get(3)(report('2026-10-22', 3)); await short;
  assert.equal(store.getState().report.destination.days, 7);
  assert.equal(store.getState().loading, false);
});

test('switching back to a cached plan supersedes an in-flight different duration', async () => {
  let finish;
  const store = setup(async (date, force, days) => days === 3 ? report(date, days) : new Promise(resolve => { finish = resolve; }));
  await store.getState().load('2026-10-22', false, 3);
  const long = store.getState().load('2026-10-22', false, 7);
  await store.getState().load('2026-10-22', false, 3);
  finish(report('2026-10-22', 7)); await long;
  assert.equal(store.getState().report.destination.days, 3);
  assert.equal(store.getState().loading, false);
});

test('rapidly returning to a pending duration shares its original backend request', async () => {
  const finishes = new Map(); let calls = 0;
  const store = setup((date, force, days) => { calls++; return new Promise(resolve => finishes.set(days, resolve)); });
  const first = store.getState().load('2026-10-22', false, 3);
  const second = store.getState().load('2026-10-22', false, 5);
  const third = store.getState().load('2026-10-22', false, 3);
  assert.equal(calls, 2);
  finishes.get(5)(report('2026-10-22', 5)); await second;
  finishes.get(3)(report('2026-10-22', 3)); await Promise.all([first, third]);
  assert.equal(store.getState().report.destination.days, 3);
});

function renderCard(days = 3, compact = false) {
  const React = require('react');
  const destination = JSON.parse(fs.readFileSync(require.resolve('../../src-tauri/src/travel/destinations.json'), 'utf8'))[0];
  const extra = JSON.parse(fs.readFileSync(require.resolve('../../src-tauri/src/travel/extensions.json'), 'utf8'))[destination.id];
  destination.days = days;
  destination.route = [destination.route[0], extra.secondDay, ...extra.extraDays.slice(0, days - 2)];
  destination.lodgingAreas = extra.lodgingAreas;
  destination.reservations = extra.reservations;
  destination.rainyDay = extra.rainyDay;
  destination.budgetItems = [{ label: '住宿', amount: '规划估算明细' }];
  const { DailyTravelCard } = load('../src/components/dashboard/DailyTravelCard.tsx', name => {
    if (name === 'react') return { ...React, useState: initial => React.useState(initial === 3 ? days : initial === false ? true : initial) };
    if (name === 'react/jsx-runtime') return require('react/jsx-runtime');
    if (name === '@/store/travel') return { useTravel: () => ({ report: {
      schemaVersion: 1, date: '2026-10-16', status: 'offline', destination,
      sources: [], researchedAt: null, warning: '联网搜索失败', diagnostics: ['搜狗：请求超时', 'Bing RSS：RSS 为空或仅返回无关结果'],
    }, loading: false, load: async () => {} }) };
    if (name === '@/lib/tauri') return { tauri: {} };
    return new Proxy({}, { get: () => ({ children }) => React.createElement('div', null, children) });
  });
  return require('react-dom/server').renderToStaticMarkup(React.createElement(DailyTravelCard, { date: '2026-10-16', compact }));
}

test('the travel card labels offline plans honestly and renders the complete guide', () => {
  const html = renderCard();
  assert.match(html, /本地路线参考/);
  assert.doesNotMatch(html, /已联网检索/);
  assert.match(html, /检索详情/);
  assert.match(html, /搜狗：请求超时/);
  for (const text of ['杭州', '断桥', '交通与住宿', '吃点当地的', '不含往返大交通', '联网搜索失败']) assert.ok(html.includes(text), text);
});

test('all supported durations render the correct night count and complete routes', () => {
  for (const days of [2, 3, 5, 7]) {
    const html = renderCard(days);
    assert.match(html, new RegExp(`${days} 天 ${days - 1} 晚`));
    assert.match(html, new RegExp(`第 ${days} 天`));
    for (const text of ['想玩几天', '住在哪个片区', '提前预约与购票', '雨天与天气变化备选', '预算明细', '规划估算明细']) assert.ok(html.includes(text), text);
  }
});

test('the compact guide exposes every day in its complete itinerary dialog', () => {
  const html = renderCard(7, true);
  for (const text of ['查看完整 7 天攻略', '每日行程', '交通预算', '美食准备', '第 7 天', '浙博与城市留白', '6 晚']) assert.ok(html.includes(text), text);
});
