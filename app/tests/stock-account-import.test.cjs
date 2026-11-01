const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const moduleRef = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/lib/stockAccountImport.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { module: moduleRef, exports: moduleRef.exports, require, TextDecoder, Date });
const { parseHoldingSheets, parseCsv, importHoldingsFile, positionMarketValue, sumPositionValues, parseTransactionSheets, parseClosedPositions, mergeTransactions } = moduleRef.exports;
const account = { name: '主账户', number: '1234' };
const header = ['代码', '名称', '持有金额', '当日盈亏', '当日盈亏率', '持有盈亏率', '持有盈亏', '持有数量', '最新价', '单位成本'];
const holding = ['000001', '示例证券', 2000, 20, 0.01, 0.25, 400, 100, 20, 16];
const sheet = (data, name = '持仓数据') => ({ sheet: name, data });

test('THS workbook selects holdings and maps held profit rather than daily profit or percentage', () => {
  const result = parseHoldingSheets([
    sheet([['清仓日期', '代码', '名称', '总盈亏'], ['2026-01-01', '000002', '已清仓证券', 1]], '已清仓'),
    sheet([header, holding, ['汇总', null, 2000]]),
    sheet([['成交日期', '代码', '名称', '成交数量'], ['2026-01-01', '000003', '交易证券', 300]], '交易记录'),
  ], account);
  assert.equal(result.positions.length, 1);
  assert.equal(result.positions[0].code, '000001');
  assert.equal(result.positions[0].cost, 16);
  assert.equal(result.positions[0].profit, 400);
  assert.equal(result.positions[0].available, null);
  assert.equal(result.sourceSheet, '持仓数据');
  assert.equal(result.hasAccountColumn, false);
});

test('account filtering excludes other accounts and rejects a file with no matching account', () => {
  const headers = [...header, '资金账号'];
  const result = parseHoldingSheets([sheet([headers, [...holding, '9999'], [...holding, '1234']])], account);
  assert.equal(result.positions.length, 1);
  assert.equal(result.hasAccountColumn, true);
  assert.throws(() => parseHoldingSheets([sheet([headers, [...holding, '9999']])], account), /核对账户/);
});

test('numeric stock codes preserve leading zeroes and explicit zero metrics stay zero', () => {
  const result = parseHoldingSheets([sheet([header, [1, '示例证券', 0, 99, 1, 1, 0, 100, 20, 16]])], account);
  assert.equal(result.positions[0].code, '000001');
  assert.equal(result.positions[0].profit, 0);
  assert.equal(positionMarketValue(result.positions[0]), 0);
});

test('missing optional fields stay unavailable and do not produce a false zero total', () => {
  const { positions } = parseHoldingSheets([sheet([['代码', '名称', '持有数量'], ['000001', '示例证券', 100]])], account);
  assert.equal(positions[0].cost, null);
  assert.equal(positions[0].profit, null);
  assert.equal(sumPositionValues(positions, positionMarketValue), null);
  assert.equal(sumPositionValues(positions, p => p.profit), null);
});

test('invalid numbers and duplicate securities fail rather than partially importing', () => {
  const bad = [...holding]; bad[7] = '无法读取';
  assert.throws(() => parseHoldingSheets([sheet([header, holding, bad])], account), /有效数字/);
  assert.throws(() => parseHoldingSheets([sheet([header, holding, holding])], account), /证券代码重复/);
});

test('CSV still supports BOM, quoted commas, Chinese unit suffixes and prefixed title rows', () => {
  const rows = parseCsv('\uFEFF证券代码,证券名称,持仓数量（股）,成本价（元）,最新价（元）,浮动盈亏\r\n000001,"示例,证券",100,16,20,"400.00"');
  const result = parseHoldingSheets([sheet([['导出时间：2026-10-31'], ...rows], 'CSV')], account);
  assert.equal(result.positions[0].name, '示例,证券');
  assert.equal(result.positions[0].profit, 400);
  assert.equal(positionMarketValue(result.positions[0]), 2000);
  assert.throws(() => parseCsv('代码,名称\n000001,"未闭合'), /引号未闭合/);
});

test('transactions-only, empty and ambiguous workbooks cannot replace holdings', () => {
  assert.throws(() => parseHoldingSheets([sheet([['代码', '名称', '成交数量']], '交易记录')], account), /未找到持仓/);
  assert.throws(() => parseHoldingSheets([sheet([header])], account), /没有可导入/);
  assert.throws(() => parseHoldingSheets([sheet([header, holding], '账户一'), sheet([header, holding], '账户二')], account), /多个持仓/);
});

test('corrupt XLSX produces a useful error and GB18030 CSV imports locally', async () => {
  await assert.rejects(importHoldingsFile({ name: '损坏.xlsx', arrayBuffer: async () => new ArrayBuffer(4) }, account), /未损坏、未加密/);
  // “代码,名称,持有数量\n000001,示例,100” encoded as GB18030.
  const gb = Buffer.from('b4fac2eb2cc3fbb3c62cb3d6d3d0cafdc1bf0a3030303030312ccabec0fd2c313030', 'hex');
  const result = await importHoldingsFile({ name: '持仓.csv', arrayBuffer: async () => gb.buffer.slice(gb.byteOffset, gb.byteOffset + gb.byteLength) }, account);
  assert.equal(result.positions[0].name, '示例');
});

test('buy/sell import retains legitimate identical fills, merges overlapping exports, and keeps cash flows separate', () => {
  const headers = ['成交日期', '成交时间', '代码', '名称', '交易类别', '成交数量', '成交价格', '成交金额', '发生金额', '费用'];
  const buy = ['2026-10-01', null, '000001', '示例证券', '买入', 100, 20, 2000, -2005, 5];
  const sell = ['2026-10-02', null, '000001', '示例证券', '卖出', 100, 22, 2200, 2195, 5];
  const transfer = ['2026-10-03', null, null, null, '银证转帐存', null, null, null, 10000, null];
  const first = parseTransactionSheets([sheet([headers, buy, buy, transfer], '交易记录')], account);
  assert.equal(first.length, 3);
  assert.equal(first.filter(t => t.side === 'buy').length, 2);
  assert.equal(first.find(t => t.side === 'other').cashAmount, 10000);
  assert.equal(new Set(first.map(t => t.id)).size, 3);
  const next = parseTransactionSheets([sheet([headers, buy, buy, sell, transfer], '交易记录')], account);
  const merged = mergeTransactions(first, next);
  assert.equal(merged.length, 4);
  assert.equal(mergeTransactions(merged, next).length, 4);
  assert.equal(merged.filter(t => t.side === 'sell').length, 1);
  assert.equal(merged[0].date, '2026-10-03');
});

test('transactions respect account identity and reject malformed trade data before saving', () => {
  const headers = ['成交日期', '代码', '名称', '交易类别', '成交数量', '成交价格', '账号'];
  const rows = [['2026-10-01', '000001', '示例证券', '买入', 100, 20, '9999'], ['2026-10-02', '000001', '示例证券', '买入', 100, 20, '1234']];
  const result = parseTransactionSheets([sheet([headers, ...rows], '交易记录')], account);
  assert.equal(result.length, 1);
  assert.equal(result[0].date, '2026-10-02');
  assert.throws(() => parseTransactionSheets([sheet([headers, ['2026-10-32', '000001', '示例证券', '买入', 100, 20, '1234']], '交易记录')], account), /日期/);
  assert.throws(() => parseTransactionSheets([sheet([headers, ['2026-10-01', '000001', '示例证券', '买入', null, 20, '1234']], '交易记录')], account), /有效的成交/);
  assert.equal(parseTransactionSheets([sheet([header, holding])], account), undefined);
});

test('closed results exclude totals and a valid empty holdings snapshot supports a fully sold account', () => {
  const result = parseClosedPositions([sheet([['清仓日期', '代码', '名称', '总盈亏', '买入均价', '卖出均价', '持仓天数'], ['2026-10-01', '000001', '示例证券', 195, 20, 22, 10], ['汇总', null, null, 195]], '已清仓')], account);
  assert.equal(result.length, 1);
  assert.equal(result[0].profit, 195);
  assert.equal(parseHoldingSheets([sheet([header, ['汇总']])], account, true).positions.length, 0);
});
