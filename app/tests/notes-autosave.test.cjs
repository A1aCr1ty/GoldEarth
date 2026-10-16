const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

// Run the page's hooks and handlers with deterministic timers and a fake disk.
// No WebView or real user notes are needed for the persistence race checks.
function mount() {
  let cursor = 0, pending = true, tree, effects = [], clock = 0;
  const hooks = [], timers = new Map(), writes = [];
  const note = (id) => ({ id, title: id, content: '', categoryId: null,
    format: 'plain', tags: [], modified: '1', updatedAt: '', createdAt: '' });
  const store = {
    items: [note('a'), note('b')], currentId: 'a',
    refresh: async () => {}, select(id) { store.currentId = id; pending = true; },
    create: async () => { throw Error('unused'); }, remove: async () => {},
    async update(id, input, beforePublish) {
      writes.push({ id, ...input });
      if (api.writeGate) await api.writeGate;
      if (api.failure) throw Error(api.failure);
      const saved = { ...store.items.find(n => n.id === id), ...input,
        modified: String(Number(input.expectedModified) + 1) };
      beforePublish?.(saved);
      store.items = store.items.map(n => n.id === id ? saved : n);
      pending = true;
      if (api.publishImmediately) render();
      return saved;
    },
  };
  const equal = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useState(initial) {
      const i = cursor++;
      if (!(i in hooks)) hooks[i] = initial;
      return [hooks[i], value => {
        const next = typeof value === 'function' ? value(hooks[i]) : value;
        if (!Object.is(next, hooks[i])) { hooks[i] = next; pending = true; }
      }];
    },
    useRef(initial) { const i = cursor++; return hooks[i] ||= { current: initial }; },
    useMemo(fn, deps) {
      const i = cursor++;
      if (!hooks[i] || !equal(hooks[i].deps, deps)) hooks[i] = { deps, value: fn() };
      return hooks[i].value;
    },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!hooks[i] || !equal(hooks[i].deps, deps)) effects.push(() => {
        hooks[i]?.cleanup?.();
        hooks[i] = { deps, cleanup: fn() };
      });
    },
  };
  const jsx = (type, props) => ({ type, props });
  const listeners = {};
  const events = { addEventListener(name, fn) { listeners[name] = fn; },
    removeEventListener(name) { delete listeners[name]; } };
  const module = { exports: {} };
  const source = fs.readFileSync(require.resolve('../src/pages/NotesPage.tsx'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, {
    module, exports: module.exports,
    require(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
      if (name === '@/store/notes') return {
        useNotes: selector => selector ? selector(store) : store,
        currentNote: s => s.items.find(n => n.id === s.currentId),
      };
      if (name === '@/store/categories') return { useCategories: selector => selector({ items: [], refresh: store.refresh }) };
      return new Proxy({}, { get: (_, key) => key });
    },
    setTimeout(fn) { const id = ++clock; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); }, window: events, document: events,
    confirm: () => true,
  });
  function render() {
    for (let guard = 0; pending; guard++) {
      assert.ok(guard < 30, 'render should settle');
      pending = false; cursor = 0; effects = [];
      tree = module.exports.default();
      effects.forEach(fn => fn());
    }
  }
  function find(predicate, node = tree) {
    if (!node || typeof node !== 'object') return;
    if (predicate(node)) return node;
    for (const child of [node.props?.children].flat(Infinity)) {
      if (child == null) continue;
      const match = find(predicate, child);
      if (match) return match;
    }
  }
  const api = {
    store, writes, listeners, render, find, writeGate: null, failure: null, publishImmediately: true,
    edit(value) { find(n => n.type === 'Textarea').props.onChange({ target: { value } }); render(); },
    async settle() { for (let i = 0; i < 12; i++) { await Promise.resolve(); render(); } },
    async tick() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(fn => fn()); await api.settle(); },
    unmount() { hooks.forEach(hook => hook?.cleanup?.()); },
  };
  render();
  return api;
}

test('debounces edits and saves all fields without resetting raw input', async () => {
  const page = mount();
  assert.equal(page.writes.length, 0);
  page.edit('first'); page.edit('latest');
  page.find(n => n.props?.placeholder === '标题').props.onChange({ target: { value: ' title ' } });
  page.find(n => n.props?.placeholder === '标签（逗号分隔）').props.onChange({ target: { value: 'one, two' } });
  page.find(n => n.type === 'Select' && n.props.value === '__none__').props.onValueChange('work');
  page.find(n => n.type === 'Select' && n.props.value === 'plain').props.onValueChange('todo');
  page.render();
  await page.tick();
  assert.equal(page.writes.length, 1);
  assert.equal(page.writes[0].content, 'latest');
  assert.equal(page.writes[0].title, 'title');
  assert.equal(page.writes[0].tags.join(','), 'one,two');
  assert.equal(page.writes[0].categoryId, 'work');
  assert.equal(page.writes[0].format, 'todo');
  assert.equal(page.find(n => n.props?.placeholder === '标题').props.value, ' title ');
  assert.equal(page.find(n => n.props?.role === 'status').props.children, '已自动保存');
  await page.tick();
  assert.equal(page.writes.length, 1);
});

test('serializes slow saves and retains edits typed during the write', async () => {
  const page = mount();
  let release;
  page.writeGate = new Promise(resolve => { release = resolve; });
  page.edit('first'); await page.tick();
  page.edit('second'); await page.tick();
  assert.equal(page.writes.length, 1);
  release(); await page.settle();
  assert.equal(page.writes.length, 2);
  assert.equal(page.writes[1].content, 'second');
  assert.equal(page.writes[1].expectedModified, '2');
  assert.equal(page.find(n => n.type === 'Textarea').props.value, 'second');
});

test('flushes before switching notes and when leaving the page', async () => {
  const page = mount();
  page.edit('a draft');
  const switching = page.find(n => n.type === 'button' && n.props.title === 'b').props.onClick();
  await switching; await page.settle();
  assert.equal(page.writes[0].id, 'a');
  assert.equal(page.writes[0].content, 'a draft');
  assert.equal(page.store.currentId, 'b');
  page.edit('b draft'); page.unmount(); await page.settle();
  assert.equal(page.writes[1].id, 'b');
  assert.equal(page.writes[1].content, 'b draft');
});

test('pauses on conflicts and keeps the unsaved text', async () => {
  const page = mount();
  page.failure = 'ERR_CONFLICT: disk changed';
  page.edit('keep me'); await page.tick();
  page.edit('keep this too'); await page.tick();
  assert.equal(page.writes.length, 1);
  assert.equal(page.find(n => n.type === 'Textarea').props.value, 'keep this too');
  page.find(n => n.type === 'button' && n.props.title === 'b').props.onClick();
  await page.settle();
  assert.equal(page.store.currentId, 'a');
});

test('external updates pause autosaving instead of overwriting the disk', async () => {
  const page = mount();
  page.edit('local');
  page.store.items[0] = { ...page.store.items[0], content: 'agent', modified: '2' };
  // A store notification triggers a React render.
  page.store.select('a'); page.render();
  await page.tick();
  assert.equal(page.writes.length, 0);
  assert.equal(page.find(n => n.type === 'Textarea').props.value, 'local');
});

test('undoing an unsaved edit clears the pending status without writing', async () => {
  const page = mount();
  page.edit('temporary'); page.edit(''); await page.tick();
  assert.equal(page.writes.length, 0);
  assert.equal(page.find(n => n.props?.role === 'status').props.children, '已自动保存');
});

test('losing window focus flushes the pending debounce', async () => {
  const page = mount();
  page.edit('save on blur'); page.listeners.blur(); await page.settle();
  assert.equal(page.writes.length, 1);
  assert.equal(page.writes[0].content, 'save on blur');
});

test('continues saving when the store renders before the save promise resolves', async () => {
  const page = mount();
  page.publishImmediately = true;
  for (let round = 1; round <= 5; round++) {
    page.edit(`revision ${round}`);
    await page.tick();
    assert.equal(page.writes.length, round, `revision ${round} must be saved`);
    assert.equal(page.store.items[0].content, `revision ${round}`);
    assert.equal(page.writes[round - 1].expectedModified, String(round));
    assert.equal(page.find(n => n.props?.role === 'status').props.children, '已自动保存');
  }
});

test('the actual notes store acknowledges each saved version before notifying subscribers', async () => {
  const module = { exports: {} };
  const source = fs.readFileSync(require.resolve('../src/store/notes.ts'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS,
  } }).outputText, {
    module, exports: module.exports,
    require(name) {
      if (name === 'zustand') return require('zustand');
      if (name === '@/lib/tauri') return { tauri: {
        updateNote: async (id, input) => ({ id, ...input,
          modified: String(Number(input.expectedModified) + 1) }),
      } };
      throw Error(`Unexpected module: ${name}`);
    },
  });
  const store = module.exports.useNotes;
  let baseline = '1', notifications = 0;
  store.setState({ items: [{ id: 'a', modified: baseline }] });
  const unsubscribe = store.subscribe(state => {
    notifications++;
    assert.equal(state.items[0].modified, baseline, 'snapshot must be ready before publishing');
  });
  try {
    for (let round = 1; round <= 5; round++) {
      await store.getState().update('a', { content: `revision ${round}`, expectedModified: baseline },
        saved => { baseline = saved.modified; });
      assert.equal(store.getState().items[0].content, `revision ${round}`);
    }
    assert.equal(notifications, 5);
  } finally { unsubscribe(); }
});
