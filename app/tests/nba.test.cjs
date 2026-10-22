const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function harness(core = {}, extra = {}) {
const m = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/lib/nba.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { module: m, exports: m.exports, Date, Intl, Map, Number, Error,
  require: name => { assert.equal(name, '@tauri-apps/api/core'); return core; }, ...extra,
});
return m.exports;
}
const N = harness();
const event = (id, date) => ({ id, date, status: { type: { state: 'pre' } }, competitions: [{ competitors: ['a', 'b'].map(id => ({ team: { id, abbreviation: id, displayName: id } })) }] });

test('Beijing schedule changes day at 16:00 UTC, regardless of host timezone', () => {
  assert.equal(N.beijingDate(new Date('2026-10-21T15:59:59Z')), '2026-10-21');
  assert.equal(N.beijingDate(new Date('2026-10-21T16:00:00Z')), '2026-10-22');
  assert.equal(N.shiftDate('2026-01-01', -1), '2025-12-31');
  assert.equal(N.shiftDate('2024-02-28', 1), '2024-02-29');
});
test('merged scoreboards filter by Beijing day, remove duplicates and sort chronologically', () => {
  const a = event('a', '2026-10-21T23:00:00Z');
  const b = event('b', '2026-10-21T16:00:00Z');
  const rows = N.gamesForDate({ events: [a, b, a, event('yesterday', '2026-10-21T15:59:59Z'), event('tomorrow', '2026-10-22T16:00:00Z')] }, '2026-10-22');
  assert.deepEqual(Array.from(rows, row => row.id), ['b', 'a']);
  assert.equal(N.gamesForDate({ events: [] }, '2026-10-22').length, 0);
  assert.throws(() => N.gamesForDate({}, '2026-10-22'), /响应不完整/);
});

test('malformed schedule data is rejected before rendering', () => {
  for (const row of [null, event('bad', 'bad'), { ...event('a', '2026-10-22T00:00:00Z'), status: null }, { id: 'broken' }]) {
    assert.throws(() => N.gamesForDate({ events: [row] }, '2026-10-22'), /响应不完整/);
  }
  assert.throws(() => N.gamesForDate(null, '2026-10-22'), /响应不完整/);
});

test('concurrent requests share one invocation and failed refresh preserves the last success', async () => {
  let calls = 0, finish;
  const api = harness({ isTauri: () => true, invoke: () => { calls++; return new Promise(resolve => { finish = resolve; }); } });
  const first = api.loadScoreboard('2026-10-22');
  const second = api.loadScoreboard('2026-10-22');
  await Promise.resolve();
  assert.equal(calls, 1);
  finish({ events: [event('a', '2026-10-22T00:00:00Z')] });
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a, b);
  const saved = api.nbaSnapshot('scoreboard:2026-10-22');
  assert.equal(saved.data[0].id, 'a');
  const failed = api.loadScoreboard('2026-10-22');
  await Promise.resolve();
  finish({ events: [null] });
  await assert.rejects(failed, /响应不完整/);
  assert.equal(api.nbaSnapshot('scoreboard:2026-10-22'), saved);
  const retry = api.loadScoreboard('2026-10-22');
  await Promise.resolve();
  finish({ events: [] });
  await retry;
  assert.equal(calls, 3);
});

test('malformed box scores fail validation and allow a subsequent retry', async () => {
  let response = { boxscore: { players: [{ team: { id: 'a', abbreviation: 'A', displayName: 'A' }, statistics: [{ labels: [], athletes: [null] }] }] } };
  const api = harness({ isTauri: () => true, invoke: async () => response });
  await assert.rejects(api.loadSummary('1'), /响应不完整/);
  response = { header: { id: '1' } };
  await api.loadSummary('1');
  assert.equal(api.nbaSnapshot('summary:1').data, response);
});

test('polling backs off, skips hidden pages, resumes online and cleans up', async () => {
  const timers = new Map(), listeners = new Map();
  let sequence = 0, calls = 0, fail = true;
  const document = { visibilityState: 'visible', addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key) };
  const window = { addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key) };
  const api = harness({}, { document, window, setTimeout: (fn, ms) => { const id = ++sequence; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id) });
  const stop = api.pollNba(async () => { calls++; if (fail) throw Error('offline'); }, true);
  await new Promise(setImmediate);
  assert.equal([...timers.values()][0].ms, 30000);
  document.visibilityState = 'hidden';
  listeners.get('online')();
  assert.equal(calls, 1);
  document.visibilityState = 'visible'; fail = false;
  listeners.get('visibilitychange')();
  listeners.get('online')();
  await new Promise(setImmediate);
  assert.equal(calls, 2);
  assert.equal([...timers.values()][0].ms, 15000);
  stop();
  assert.equal(timers.size, 0);
  assert.equal(listeners.size, 0);
});
test('live clock, overtime and exceptional game states are distinguished', () => {
  assert.equal(N.statusText({ type: { state: 'in' }, period: 5, displayClock: '2:34' }), '加时 1 · 2:34');
  assert.equal(N.statusText({ type: { state: 'in', name: 'STATUS_HALFTIME' } }), '中场休息');
  assert.equal(N.statusText({ type: { state: 'pre', name: 'STATUS_POSTPONED' } }), '已延期');
  assert.equal(N.statusText({ type: { state: 'post', completed: true } }), '已结束');
});
