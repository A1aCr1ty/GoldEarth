const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const bank = { code: 'sz000001', name: '平安银行', market: '深A' };
const insurance = { code: 'sh601318', name: '中国平安', market: '沪A' };
const moutai = { code: 'sh600519', name: '贵州茅台', market: '沪A' };
function load(path, requireMock, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve(path), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { module, exports: module.exports, require: requireMock, ...globals });
  return module.exports;
}

function mount(items = []) {
  let cursor = 0, pending = true, tree, effects = [], timerId = 0;
  const hooks = [], timers = new Map(), queries = [], additions = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useId: () => 'stock-results',
    useRef(initial) { const i = cursor++; return hooks[i] ||= { current: initial }; },
    useState(initial) {
      const i = cursor++;
      if (!(i in hooks)) hooks[i] = initial;
      return [hooks[i], value => {
        const next = typeof value === 'function' ? value(hooks[i]) : value;
        if (!Object.is(hooks[i], next)) { hooks[i] = next; pending = true; }
      }];
    },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!hooks[i] || !same(hooks[i].deps, deps)) effects.push(() => {
        hooks[i]?.cleanup?.(); hooks[i] = { deps, cleanup: fn() };
      });
    },
  };
  const jsx = (type, props) => ({ type, props });
  const { StockSearch } = load('../src/components/stock/StockSearch.tsx', name => {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === '@/lib/tauri') return { tauri: { searchStocks: query => {
      queries.push(query); return api.search(query);
    } } };
    return new Proxy({}, { get: (_, key) => key });
  }, { setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); } });
  function render() {
    for (let guard = 0; pending; guard++) {
      assert.ok(guard < 30, 'render settles');
      pending = false; cursor = 0; effects = [];
      tree = StockSearch({ items, onAdd: async stock => { additions.push(stock); return api.add(stock); } });
      effects.forEach(fn => fn());
    }
  }
  function find(predicate, node = tree) {
    if (!node || typeof node !== 'object') return;
    if (predicate(node)) return node;
    for (const child of [node.props?.children].flat(Infinity)) {
      if (child == null) continue;
      const found = find(predicate, child); if (found) return found;
    }
  }
  const api = {
    queries, additions, find, render,
    search: async () => [bank, insurance], add: async () => true,
    input: () => find(node => node.type === 'Input').props,
    edit(value) { api.input().onChange({ target: { value } }); render(); },
    key(key, composing = false) {
      api.input().onKeyDown({ key, nativeEvent: { isComposing: composing }, preventDefault() {} }); render();
    },
    async settle() { for (let i = 0; i < 10; i++) { await Promise.resolve(); render(); } },
    async tick() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(fn => fn()); await api.settle(); },
  };
  render(); return api;
}

test('debounces Chinese names and adds the keyboard-selected stock with its name', async () => {
  const page = mount();
  page.edit('平'); page.edit('平安'); await page.tick();
  assert.deepEqual(page.queries, ['平安']);
  page.key('ArrowDown'); page.key('Enter'); await page.settle();
  assert.deepEqual(page.additions, [insurance]);
  assert.equal(page.input().value, '');
});

test('does not submit or search during Chinese IME composition', async () => {
  const page = mount();
  page.input().onCompositionStart(); page.render();
  page.edit('平安'); page.key('Enter', true); await page.tick();
  assert.equal(page.queries.length, 0); assert.equal(page.additions.length, 0);
  page.input().onCompositionEnd(); page.render(); await page.tick();
  assert.deepEqual(page.queries, ['平安']);
});

test('ignores late responses and never adds a stale candidate', async () => {
  const page = mount(); let release;
  page.search = query => query === '茅台' ? new Promise(resolve => { release = resolve; }) : Promise.resolve([bank]);
  page.edit('茅台'); await page.tick();
  page.edit('平安'); page.key('Enter');
  assert.equal(page.additions.length, 0);
  await page.tick(); release([moutai]); await page.settle();
  page.key('Enter'); await page.settle();
  assert.deepEqual(page.additions, [bank]);
});

test('mouse selection works and failed persistence keeps the query for retry', async () => {
  const page = mount([bank]); page.add = async () => false;
  page.edit('平安'); await page.tick();
  assert.ok(page.find(node => node.props?.children === '已添加'));
  page.find(node => node.props?.role === 'option').props.onClick(); await page.settle();
  assert.equal(page.input().value, '平安');
  assert.ok(page.find(node => node.props?.role === 'alert'));
  assert.deepEqual(page.additions, [bank]);
});

test('search failure cannot add arbitrary Chinese text as a stock code', async () => {
  const page = mount(); page.search = async () => { throw Error('offline'); };
  page.edit('不存在的股票'); await page.tick(); page.key('Enter');
  assert.equal(page.additions.length, 0);
  assert.ok(page.find(node => node.props?.role === 'alert'));
});

test('the actual stock store persists names, avoids duplicates, and reports save failures', async () => {
  const savedLists = []; let fail = false;
  const { useStocks } = load('../src/store/stocks.ts', name => {
    if (name === 'zustand') return require('zustand');
    if (name === '@/lib/tauri') return { tauri: { saveWatchlist: async items => {
      if (fail) throw Error('disk unavailable'); savedLists.push(items); return items;
    } } };
    throw Error(name);
  });
  useStocks.setState({ refreshQuotes: async () => {} });
  assert.equal(await useStocks.getState().addWatch(bank.code, bank.name), true);
  assert.equal(useStocks.getState().watchlist[0].name, bank.name);
  assert.equal(await useStocks.getState().addWatch(bank.code, bank.name), true);
  assert.equal(savedLists.length, 1);
  fail = true;
  assert.equal(await useStocks.getState().addWatch(moutai.code, moutai.name), false);
  assert.equal(useStocks.getState().watchlist.length, 1);
});
