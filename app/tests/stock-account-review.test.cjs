const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const cache = new Map();
function load(name) {
  if (cache.has(name)) return cache.get(name);
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../src/lib', `${name}.ts`), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { module, exports: module.exports, require: dep => dep.startsWith('./') ? load(dep.slice(2)) : require(dep), Date, TextDecoder });
  cache.set(name, module.exports); return module.exports;
}
const { valueAccountPositions, accountQuoteCode } = load('stockAccountMarket');
const { buildAccountReviewContext, reviewSymbols } = load('stockAccountReview');
const position = { code: '000001', name: '示例证券', quantity: 100, available: null, cost: 20, price: 21, profit: 95, marketValue: 2100 };

test('quote valuation preserves ledger costs, includes fee basis and never compounds on polling', () => {
  const quotes = { sz000001: { code: 'sz000001', price: 22, time: '20261030150000' } };
  const valued = valueAccountPositions([position], quotes)[0];
  assert.equal(valued.marketValue, 2200);
  assert.equal(valued.profit, 195);
  assert.equal(valued.cost, 20);
  assert.equal(valued.quantity, 100);
  assert.equal(position.price, 21);
  assert.equal(valueAccountPositions([position], quotes)[0].profit, 195);
  assert.equal(valueAccountPositions([position], { sz000001: { price: 23 } })[0].profit, 295);
});

test('missing or invalid quotes keep imported values and do not silently value a suspended stock at zero', () => {
  for (const price of [0, NaN, -1]) {
    const valued = valueAccountPositions([position], { sz000001: { price } })[0];
    assert.equal(valued.price, 21); assert.equal(valued.profit, 95); assert.equal(valued.priceSource, 'import');
  }
  assert.equal(valueAccountPositions([position], {})[0].marketValue, 2100);
  assert.equal(accountQuoteCode('SH.600519'), 'sh600519');
  assert.equal(accountQuoteCode('000001'), 'sz000001');
  assert.equal(accountQuoteCode('00700'), null);
});

test('review sends latest values with bounded history, without account identifiers, and exposes coverage', () => {
  const transactions = Array.from({ length: 130 }, (_, i) => ({ id: `fill-${i}`, date: '2026-10-01', time: '', code: '000001', name: '示例证券', kind: '买入', side: 'buy', quantity: 100, price: 20, amount: 2000, fee: 5, cashAmount: -2005 }));
  const account = { id: 'private-id', name: 'private-name', number: 'private-number', broker: 'private-broker', positions: [position], transactions, syncedAt: '2026-10-01' };
  const quotes = { sz000001: { code: 'sz000001', name: '示例证券', price: 23, prevClose: 22, time: '20261030150000' } };
  const text = buildAccountReviewContext(account, quotes, [{ code: 'sz000001', bars: [], error: '历史不可用' }], { focus: 'all', asOf: '2026-10-31T00:00:00Z', horizon: '', riskBudget: '', quoteError: '' });
  const data = JSON.parse(text.split('\n').at(-1));
  assert.equal(data.valuations[0].price, 23);
  assert.equal(data.valuations[0].profit, 295);
  assert.equal(data.transactionCoverage.total, 130);
  assert.equal(data.transactions.length, 120);
  assert.equal(data.history[0].error, '历史不可用');
  assert.equal(data.history[0].tradeDatesOutsideHistory.length, 120);
  for (const secret of ['private-id', 'private-name', 'private-number', 'private-broker', 'fill-1']) assert.ok(!text.includes(secret));
  assert.equal(data.preferences.riskBudget, '未设置');
});

test('review scope includes sold securities and limits quote requests without hiding that other holdings exist', () => {
  const account = { positions: [position], transactions: Array.from({ length: 10 }, (_, i) => ({ code: `60000${i}`, side: 'sell' })) };
  assert.equal(reviewSymbols(account, 'all').length, 5);
  assert.ok(reviewSymbols(account, 'all').includes('sh600000'));
  assert.equal(reviewSymbols(account, '600001')[0], 'sh600001');
});

test('single-security review excludes other positions, transactions and quote entries', () => {
  const account = { positions: [position, { ...position, code: '000002' }], transactions: [{ code: '000001', date: '2026-10-01', id: 'one' }, { code: '000002', date: '2026-10-01', id: 'two' }] };
  const text = buildAccountReviewContext(account, { sz000001: { price: 22 }, sz000002: { price: 33 } }, [], { focus: '000001', asOf: '2026-10-31T00:00:00Z', horizon: '', riskBudget: '', quoteError: '' });
  const data = JSON.parse(text.split('\n').at(-1));
  assert.equal(data.positionsAtImport.length, 1);
  assert.equal(data.transactions.length, 1);
  assert.equal(data.quotes.sz000002, undefined);
});
