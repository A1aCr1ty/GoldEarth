const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const teams = require('../src/lib/nba-teams.json');
function harness(invoke = () => {}) {
  const m = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/lib/nbaFeed.ts'), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText, { module: m, exports: m.exports, require: name => name.endsWith('.json') ? teams : { invoke } });
  return m.exports;
}
const F = harness();
const row = (id, kind, teams) => ({ title: `title ${id}`, url: `https://bbs.hupu.com/${id}.html`, summary: '', teams, kind, source: '虎扑', publishedAt: null, timeLabel: '10-23 10:00', author: '作者', replies: 3, views: 10 });
const report = { sources: [
  { id: 'hupu-news', kind: 'news', items: [row('1', 'news', ['LAL', 'GSW']), row('2', 'news', ['BOS']), row('3', 'news', [])] },
  { id: 'hupu-LAL', kind: 'post', items: [row('4', 'post', ['LAL'])] },
  { id: 'hupu-BOS', kind: 'post', items: [row('5', 'post', ['BOS'])] },
] };
const opts = more => ({ followed: ['LAL'], team: 'all', kind: 'news', query: '', includeLeague: false, source: 'all', ...more });
test('team catalog contains 30 unique real sections and ESPN team IDs', () => {
  assert.equal(teams.length, 30);
  for (const key of ['id', 'espn', 'forum']) assert.equal(new Set(teams.map(t => t[key])).size, 30);
  assert.equal(teams.filter(t => t.conference === 'west').length, 15);
  assert.equal(teams.filter(t => t.conference === 'east').length, 15);
});
test('followed teams filter news and actual forum sections independently', () => {
  assert.deepEqual(Array.from(F.filterNbaFeed(report, opts()), r => r.item.teams.join(',')), ['LAL,GSW']);
  assert.equal(F.filterNbaFeed(report, opts({ kind: 'post' }))[0].status.id, 'hupu-LAL');
  assert.equal(F.filterNbaFeed(report, opts({ team: 'BOS' })).length, 0);
  assert.equal(F.filterNbaFeed(report, opts({ followed: ['LAL', 'BOS'], kind: 'post', team: 'BOS' }))[0].item.url, 'https://bbs.hupu.com/5.html');
});
test('unclassified news is opt-in and never guesses player affiliations', () => {
  assert.equal(F.filterNbaFeed(report, opts({ includeLeague: true })).length, 2);
  assert.equal(F.filterNbaFeed(report, opts({ includeLeague: true, team: 'LAL' })).length, 1);
  assert.equal(F.filterNbaFeed(report, opts({ followed: [] })).length, 3);
  assert.equal(F.filterNbaFeed(report, opts({ followed: [], kind: 'post' })).length, 0);
});
test('search, source filtering and deduplication preserve source status', () => {
  assert.equal(F.filterNbaFeed(report, opts({ query: '湖人 作者' })).length, 1);
  assert.equal(F.filterNbaFeed(report, opts({ source: 'espn-news' })).length, 0);
  const duplicate = { sources: [...report.sources, { ...report.sources[0], id: 'copy', error: 'offline' }] };
  assert.equal(F.filterNbaFeed(duplicate, opts()).length, 1);
});
test('preferences survive empty selections and reject corrupted or unknown team ids', () => {
  const read = value => F.readNbaFeedPreferences({ getItem: () => value });
  assert.equal(read('{bad').followed.length, 0);
  assert.equal(read(JSON.stringify({ followed: [] })).followed.length, 0);
  assert.deepEqual(Array.from(read(JSON.stringify({ followed: ['LAL', 'bad', 'LAL', null], auto: false })).followed), ['LAL']);
  assert.equal(read(JSON.stringify({ auto: false })).auto, false);
});
test('concurrent identical subscriptions share one backend crawl', async () => {
  let count = 0, resolve;
  const api = harness(() => { count++; return new Promise(done => { resolve = done; }); });
  const a = api.loadNbaFeed(['GSW', 'LAL']);
  const b = api.loadNbaFeed(['LAL', 'GSW', 'LAL']);
  await Promise.resolve();
  assert.equal(count, 1);
  resolve({ sources: [] });
  assert.equal(await a, await b);
});
