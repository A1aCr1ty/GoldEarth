const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function mount() {
  let cursor = 0, pending = true, effects = [], state, accountId = 'A', positions = [{ code: '000001' }];
  const hooks = [], requests = [], timers = new Map(), listeners = new Map();
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useState(initial) { const i = cursor++; if (!(i in hooks)) hooks[i] = initial; return [hooks[i], value => { hooks[i] = typeof value === 'function' ? value(hooks[i]) : value; pending = true; }]; },
    useRef(initial) { const i = cursor++; return hooks[i] ||= { current: initial }; },
    useCallback(fn, deps) { const i = cursor++; if (!hooks[i] || !same(hooks[i].deps, deps)) hooks[i] = { fn, deps }; return hooks[i].fn; },
    useEffect(fn, deps) { const i = cursor++; if (!hooks[i] || !same(hooks[i].deps, deps)) effects.push(() => { hooks[i]?.cleanup?.(); hooks[i] = { deps, cleanup: fn() }; }); },
  };
  const document = { hidden: false, addEventListener(name, fn) { listeners.set(name, fn); }, removeEventListener(name) { listeners.delete(name); } };
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/lib/useAccountQuotes.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { module, exports: module.exports, Date, document,
    window: { setInterval(fn) { const id = timers.size + 1; timers.set(id, fn); return id; }, clearInterval(id) { timers.delete(id); } },
    require(name) {
      if (name === 'react') return react;
      if (name === './stockAccountMarket') return { accountQuoteCode: code => /^[a-z]/.test(code) ? code : `sz${code}` };
      if (name === '@/lib/tauri') return { tauri: { stockQuotes(codes) { return new Promise((resolve, reject) => requests.push({ codes, resolve, reject })); } } };
      throw new Error(name);
    },
  });
  const render = () => { for (let guard = 0; pending; guard++) { assert.ok(guard < 20); pending = false; cursor = 0; effects = []; state = module.exports.useAccountQuotes(accountId, positions); effects.forEach(fn => fn()); } };
  const api = {
    requests, get state() { render(); return state; },
    switchAccount(id, code) { accountId = id; positions = [{ code }]; pending = true; render(); },
    tick() { for (const fn of timers.values()) fn(); render(); },
    visible(value) { document.hidden = !value; listeners.get('visibilitychange')?.(); render(); },
    async settle() { for (let i = 0; i < 12; i++) { await Promise.resolve(); render(); } },
  };
  render(); return api;
}

test('late quote responses from a previous account cannot replace the newly selected account', async () => {
  const page = mount();
  page.switchAccount('B', '000002');
  assert.equal(Object.keys(page.state.quotes).length, 0);
  page.requests[1].resolve([{ code: 'sz000002', price: 25, time: '20261030150000' }]);
  await page.settle();
  page.requests[0].resolve([{ code: 'sz000001', price: 99 }]);
  await page.settle();
  assert.equal(page.state.quotes.sz000002.price, 25);
  assert.equal(page.state.quotes.sz000001, undefined);
});

test('polling does not overlap requests, pauses while hidden, and shows errors without deleting the last quote', async () => {
  const page = mount();
  page.tick(); page.tick(); assert.equal(page.requests.length, 1);
  page.requests[0].resolve([{ code: 'sz000001', price: 20 }]); await page.settle();
  page.visible(false); page.tick(); assert.equal(page.requests.length, 1);
  page.visible(true); assert.equal(page.requests.length, 2);
  page.requests[1].reject(new Error('offline')); await page.settle();
  assert.equal(page.state.quotes.sz000001.price, 20);
  assert.match(page.state.error, /行情刷新失败/);
  assert.equal(page.state.loading, false);
});
