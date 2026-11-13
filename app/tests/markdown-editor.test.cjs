const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

test('mode buttons explicitly synchronize the editor preview without remounting', () => {
  let cursor = 0, effects = [], tree;
  const hooks = [], calls = [];
  const instance = { togglePreview(value) { calls.push(value); } };
  const react = {
    useState(initial) { const i = cursor++; if (!(i in hooks)) hooks[i] = initial; return [hooks[i], v => { hooks[i] = v; }]; },
    useRef(initial) { const i = cursor++; return hooks[i] ||= { current: initial }; },
    useEffect(fn, deps) { const i = cursor++; if (!hooks[i] || deps.some((v, j) => v !== hooks[i][j])) { hooks[i] = deps; effects.push(fn); } },
  };
  const jsx = (type, props) => { if (type === 'MdEditor') props.ref.current = instance; return { type, props }; };
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/components/markdown/MarkdownEditor.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    module, exports: module.exports,
    document: { documentElement: { classList: { contains: () => false } } },
    MutationObserver: class { observe() {} disconnect() {} },
    require(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'md-editor-rt') return { MdEditor: 'MdEditor', MdPreview: 'MdPreview' };
      return {};
    },
  });
  function render() { cursor = 0; effects = []; tree = module.exports.MarkdownEditor({ value: '# Heading', onChange() {} }); effects.forEach(fn => fn()); }
  function find(type, label, node = tree) {
    if (!node || typeof node !== 'object') return;
    if (node.type === type && (!label || node.props.children === label)) return node;
    for (const child of [node.props?.children].flat(Infinity)) { if (child == null) continue; const found = find(type, label, child); if (found) return found; }
  }
  render();
  for (const label of ['双栏', '源码', '阅读', '双栏']) {
    find('button', label).props.onClick(); render();
    assert.ok(find('MdEditor'), 'editor stays mounted');
  }
  assert.deepEqual(calls, [false, true, false, false, true]);
});

