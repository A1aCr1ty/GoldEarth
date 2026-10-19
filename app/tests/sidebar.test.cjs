const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const m = { exports: {} };
const source = fs.readFileSync(require.resolve('../src/lib/sidebar.ts'), 'utf8');
vm.runInNewContext(
  ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
  { module: m, exports: m.exports, require: n => { throw Error(n); } }
);
const S = m.exports;

/** 全部路由必须落在目录里，否则改完侧栏会有一条路进不去 */
test('every app route stays reachable from the sidebar tree', () => {
  const routes = fs.readFileSync(require.resolve('../src/App.tsx'), 'utf8')
    .match(/path="(\/[^"]*)"/g).map(x => x.slice(6, -1))
    .filter(x => x !== '/');
  const leaves = S.flattenNav(S.NAV_TREE);
  assert.ok(routes.length > 0);
  for (const route of routes) assert.ok(leaves.some(l => l.to === route), `${route} missing from sidebar`);
  assert.equal(new Set(leaves.map(l => l.to)).size, leaves.length, 'duplicate sidebar routes');
  assert.equal(leaves.length, routes.length);
});

test('deep routes expand every ancestor directory', () => {
  // vm 里造出来的数组原型不同，摊平到本 realm 再比较
  assert.deepEqual([...S.ancestorsOf(S.NAV_TREE, '/metals')], ['market', 'market-goods']);
  assert.deepEqual([...S.ancestorsOf(S.NAV_TREE, '/notes')], ['create']);
  assert.deepEqual([...S.ancestorsOf(S.NAV_TREE, '/nope')], []);
  // 手动折叠的目录，遇到当前路由仍然要展开，深层链接才看得见自己
  const open = S.resolveOpen(S.NAV_TREE, '/stocks', []);
  assert.deepEqual([...open].sort(), ['market', 'market-finance']);
  const kept = S.resolveOpen(S.NAV_TREE, '/home', ['create', 'market-goods']);
  assert.ok(kept.has('create') && kept.has('market-goods') && kept.has('daily'));
  assert.equal(S.containsRoute(S.NAV_TREE[1], '/metals'), true);
  assert.equal(S.containsRoute(S.NAV_TREE[1], '/notes'), false);
});

test('group ids are unique so expansion state cannot leak across directories', () => {
  const ids = S.collectGroupIds(S.NAV_TREE);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes('market-goods'));
});

test('sidebar width is clamped and stored values cannot break layout', () => {
  assert.equal(S.clampSidebarWidth(10), S.SIDEBAR_MIN_WIDTH);
  assert.equal(S.clampSidebarWidth(9999), S.SIDEBAR_MAX_WIDTH);
  assert.equal(S.clampSidebarWidth(Number.NaN), S.SIDEBAR_DEFAULT_WIDTH);
  assert.equal(S.clampSidebarWidth(200.4), 200);
  const store = new Map();
  const storage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) };
  assert.equal(S.readSidebarWidth(storage), S.SIDEBAR_DEFAULT_WIDTH);
  assert.equal(S.readSidebarCollapsed(storage), false);
  S.writeJson(storage, S.SIDEBAR_WIDTH_KEY, 500);
  assert.equal(S.readSidebarWidth(storage), S.SIDEBAR_MAX_WIDTH);
  store.set(S.SIDEBAR_OPEN_KEY, '["create", "nope", 3]');
  assert.deepEqual([...S.readOpenGroups(storage, S.NAV_TREE)], ['create']);
});

test('broken or unavailable storage falls back to defaults instead of throwing', () => {
  const broken = { getItem: () => 'not json', setItem: () => { throw Error('quota'); } };
  assert.equal(S.readSidebarWidth(broken), S.SIDEBAR_DEFAULT_WIDTH);
  assert.equal(S.readSidebarCollapsed(broken), false);
  assert.deepEqual([...S.readOpenGroups(broken, S.NAV_TREE)], []);
  assert.deepEqual([...S.readOpenGroups(null, S.NAV_TREE)], []);
  assert.equal(S.readSidebarWidth(null), S.SIDEBAR_DEFAULT_WIDTH);
});
