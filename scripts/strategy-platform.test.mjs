import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';

const require = createRequire(new URL('../app/package.json', import.meta.url));
const ts = require('typescript');
const base = new URL('../src-tauri/resources/strategy/platform/', import.meta.url);
const template = readFileSync(new URL('index.html', base), 'utf8');
const snapshot = {
  results: JSON.parse(readFileSync(new URL('results.json', base), 'utf8')),
  adaptive: JSON.parse(readFileSync(new URL('adaptive_results.json', base), 'utf8')),
};
const source = readFileSync(new URL('../app/src/lib/strategyPlatform.ts', import.meta.url), 'utf8');
const exports = {};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
  exports,
  require: path => ({ default: path.endsWith('?raw') ? template : path.endsWith('/results.json') ? snapshot.results : snapshot.adaptive }),
});

test('embedded platform renders all views and filters without network access', async () => {
  const html = exports.strategyDocument(snapshot);
  assert.equal(html.includes('fetch('), false);
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, { value: '', innerHTML: '', textContent: '', style: {}, classList: { toggle() {} }, setAttribute() {} });
    return elements.get(id);
  }
  const messages = {};
  const parent = { postMessage() {} };
  const context = vm.createContext({
    document: { getElementById: element, querySelectorAll: () => [], addEventListener() {} },
    parent, window: { addEventListener: (name, callback) => { messages[name] = callback; } },
  });
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1].replace('.catch(() => { $("subtitle")', '.catch(error => { globalThis.renderError = error; $("subtitle")'), context);
  await new Promise(resolve => setImmediate(resolve));
  if (context.renderError) throw context.renderError;
  assert.match(element('subtitle').textContent, /收盘/);
  assert.match(element('stocks').innerHTML, /data-stock="002463"/);
  for (const view of ['overview', 'backtest', 'decision', 'train']) vm.runInContext(`show('${view}')`, context);
  for (const period of ['train', 'valid', 'test']) {
    for (const model of ['adaptive', 'baseline']) vm.runInContext(`slice='${period}'; backtestModel='${model}'; drawBacktest();`, context);
  }
  messages.message({ source: parent, data: { type: 'strategy-filter', code: '002463' } });
  assert.match(element('count').textContent, /^1 \/ /);
  messages.message({ source: {}, data: { type: 'strategy-filter', code: '000426' } });
  assert.equal(element('q').value, '002463');
});

test('snapshot text cannot terminate the script or expand replacement tokens', () => {
  const altered = structuredClone(snapshot);
  altered.results.asof = '</script><script>alert(1)</script>$&';
  const html = exports.strategyDocument(altered);
  assert.equal((html.match(/<script>/g) || []).length, 1);
  assert.ok(html.includes('\\u003c/script>'));
  assert.ok(html.includes('$&'));
});

test('account sync blocks failed validation and stale results', () => {
  const adviceExports = {};
  const adviceSource = readFileSync(new URL('../app/src/lib/strategyAdvice.ts', import.meta.url), 'utf8');
  const fusionExports = {};
  const fusionSource = readFileSync(new URL('../app/src/lib/fusionStrategy.ts', import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(fusionSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: fusionExports });
  vm.runInNewContext(ts.transpileModule(adviceSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: adviceExports, require: () => fusionExports });
  const s = structuredClone(snapshot);
  delete s.adaptive.fusion;
  s.adaptive.operations = [{code:'002463',asof:'2026-11-02',target:1}];
  s.adaptive.validation_gate = {sample_out_profitable:true,positive_excess:true,risk_adjusted_improvement:true};
  assert.equal(adviceExports.strategyAdvice(s,'sz002463',0,'2026-11-02').action,'buy');
  assert.equal(adviceExports.strategyAdvice(s,'002463',300,'2026-11-02').action,'hold');
  assert.equal(adviceExports.strategyAdvice(s,'002463',0,'2026-11-12').action,'wait');
  s.adaptive.validation_gate.positive_excess = false;
  assert.equal(adviceExports.strategyAdvice(s,'002463',0,'2026-11-02').action,'wait');
  assert.equal(adviceExports.strategyAdvice(s,'600000',0,'2026-11-02').action,'wait');
  s.adaptive.fusion = {validated:false,macro:{regime:'进攻'},operations:[{code:'002463',asof:'2026-11-02',action:'buy_candidate',technical:{signal:'B1',j:10,dif:1},fundamental:{status:'unknown'}}]};
  s.adaptive.validation_gate.positive_excess = true;
  assert.equal(adviceExports.strategyAdvice(s,'002463',0,'2026-11-02').action,'wait');
});
