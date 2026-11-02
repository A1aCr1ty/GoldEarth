const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const moduleUnderTest = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/lib/fundamental.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { module: moduleUnderTest, exports: moduleUnderTest.exports });
const { analyzeFundamentals, buildFinancialContext, combineOperationAdvice, latestFinancialReport } = moduleUnderTest.exports;

function report(overrides = {}) {
  return {
    code: 'sh600519', name: '测试公司', orgType: '通用', reportDate: '2026-09-30', reportDateName: '2026三季报',
    reportType: '三季报', noticeDate: '2026-10-31', currency: 'CNY', revenue: 120e8, netProfit: 20e8,
    deductedNetProfit: 19e8, operatingCashFlow: 24e8, revenueYoy: 12, netProfitYoy: 15,
    deductedNetProfitYoy: 14, quarterRevenueYoy: 9, quarterNetProfitYoy: 8, eps: 2.5, bps: 20,
    roeWeighted: 12, grossMargin: 40, netMargin: 18, debtRatio: 40, currentRatio: 2, quickRatio: 1.5,
    totalAssets: 300e8, totalEquity: 180e8, ...overrides,
  };
}

function bundle(reports) {
  return { code: 'sh600519', name: '测试公司', source: '测试来源', sourceUrl: 'https://example.com/data',
    reportUrl: 'https://example.com/reports', updatedAt: '2026-11-02T10:00:00+08:00', fromCache: false, warning: null, reports };
}

test('latest report rejects future notices, invalid dates and another security', () => {
  const current = report();
  const future = report({ reportDate: '2026-12-31', noticeDate: '2026-12-01' });
  const wrong = report({ code: 'sz000001', reportDate: '2026-06-30', noticeDate: '2026-08-01' });
  const invalid = report({ reportDate: '2026-02-30', noticeDate: '2026-03-01' });
  assert.equal(latestFinancialReport(bundle([future, wrong, invalid, current]), '2026-11-02').reportDate, '2026-09-30');
  assert.equal(latestFinancialReport(bundle([future]), '2026-11-02'), null);
});

test('strong general-company report earns transparent full score and derived ratios', () => {
  const result = analyzeFundamentals(report());
  assert.equal(result.score, 100);
  assert.equal(result.coverage, 100);
  assert.equal(result.rating, '较稳健');
  assert.equal(result.annualizedRoe, 16);
  assert.equal(result.cashToProfit, 1.2);
  assert.ok(result.strengths.length >= 3);
  assert.equal(result.risks.length, 0);
  assert.ok(result.factors.every(factor => factor.earned !== null));
});

test('financial institutions do not use entity cash-flow and debt thresholds', () => {
  const result = analyzeFundamentals(report({ orgType: '银行', operatingCashFlow: -100, debtRatio: 92, grossMargin: null }));
  assert.equal(result.financialInstitution, true);
  assert.equal(result.coverage, 65);
  assert.equal(result.factors.find(factor => factor.key === 'debt').earned, null);
  assert.equal(result.factors.find(factor => factor.key === 'cash').earned, null);
  assert.ok(!result.risks.some(item => item.includes('资产负债率')));
  assert.ok(!result.risks.some(item => item.includes('现金流为负')));
  assert.ok(result.observations.some(item => item.includes('行业专属')));
});

test('missing metrics lower coverage instead of becoming zero', () => {
  const result = analyzeFundamentals(report({ revenueYoy: null, netProfitYoy: null, roeWeighted: null,
    operatingCashFlow: null, debtRatio: null, netMargin: null }));
  assert.equal(result.score, null);
  assert.equal(result.coverage, 0);
  assert.equal(result.rating, '数据不足');
  assert.ok(result.factors.every(factor => factor.status === 'missing'));
});

test('loss, falling profit and weak cash conversion create risks and suppress buy candidates', () => {
  const result = analyzeFundamentals(report({ netProfit: -1, netProfitYoy: -120, revenueYoy: -20,
    operatingCashFlow: -10, debtRatio: 90, roeWeighted: -2, netMargin: -1 }));
  assert.ok(result.score < 40);
  assert.ok(result.risks.length >= 5);
  const advice = combineOperationAdvice({ fundamental: result, quant: { ready: true, action: '买入候选' }, quantity: 0, quoteFresh: true });
  assert.equal(advice.action, '观望');
  assert.match(advice.summary, /不生成新买入候选/);
});

test('combined advice requires fundamental, quant, quote and model gates', () => {
  const fundamental = analyzeFundamentals(report());
  const buy = { ready: true, action: '买入候选', bias: 2, date: '2026-10-30' };
  assert.equal(combineOperationAdvice({ fundamental, quant: buy, quantity: 0, quoteFresh: true }).action, '买入候选');
  assert.equal(combineOperationAdvice({ fundamental, quant: buy, quantity: 0, quoteFresh: false }).action, '观望');
  assert.equal(combineOperationAdvice({ fundamental, quant: buy, quantity: 0, quoteFresh: true,
    model: { action: 'wait', summary: '样本外验证未通过，观望' } }).action, '观望');
  assert.equal(combineOperationAdvice({ fundamental, quant: buy, quantity: 0, quoteFresh: true,
    model: { action: 'wait', summary: '策略未覆盖，等待复盘' } }).action, '买入候选');
  assert.equal(combineOperationAdvice({ fundamental, quant: { ...buy, action: '持有 / 等待确认', bias: 8 }, quantity: 0, quoteFresh: true }).action, '暂缓追涨');
  assert.equal(combineOperationAdvice({ fundamental, quant: { ...buy, action: '减仓观察' }, quantity: 100, quoteFresh: true }).action, '减仓复核');
  assert.equal(combineOperationAdvice({ fundamental, quant: buy, quantity: 100, quoteFresh: true,
    model: { action: 'reduce', summary: '模型空仓' } }).action, '减仓复核');
});

test('Agent context contains actual report values, rules and no null placeholders', () => {
  const data = bundle([report()]);
  const context = buildFinancialContext(data, analyzeFundamentals(data.reports[0]));
  assert.match(context, /12000000000/);
  assert.match(context, /累计值不能当成单季度值/);
  assert.match(context, /规则评分 100\/100/);
  assert.doesNotMatch(context, /\bnull\b/);
});
