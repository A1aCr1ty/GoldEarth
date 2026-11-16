const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const moduleUnderTest = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/lib/peerComparison.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { module: moduleUnderTest, exports: moduleUnderTest.exports });
const { parseAgentPeerSelection } = moduleUnderTest.exports;

const reply = peers => JSON.stringify({ schemaVersion: 1, currentCode: '600519', industry: '白酒', peers });

test('Agent peer selection parses fenced JSON and normalizes A-share codes', () => {
  const result = parseAgentPeerSelection(`筛选结果：\n\`\`\`json\n${reply([
    { code: '000858', name: '五粮液', reason: '同属白酒主业' },
    { code: 'sh600809', name: '山西汾酒', reason: '产品与渠道可比' },
  ])}\n\`\`\``, 'sh600519');
  assert.equal(result.industry, '白酒');
  assert.deepEqual(JSON.parse(JSON.stringify(result.peers)), [
    { code: 'sz000858', name: '五粮液', reason: '同属白酒主业' },
    { code: 'sh600809', name: '山西汾酒', reason: '产品与渠道可比' },
  ]);
});

test('Agent peer selection removes current company, duplicates and malformed candidates', () => {
  const result = parseAgentPeerSelection(reply([
    { code: '600519', name: '当前公司', reason: '排除自身' },
    { code: '000858', name: '五粮液', reason: '首家' },
    { code: 'sz000858', name: '重复公司', reason: '重复' },
    { code: 'bad', name: '无效代码', reason: '排除' },
    { code: '600809', name: '山西汾酒', reason: '第二家' },
    { code: '000568', name: '泸州老窖', reason: '第三家' },
    { code: '600702', name: '舍得酒业', reason: '第四家' },
    { code: '600559', name: '老白干酒', reason: '超过上限' },
  ]), '600519');
  assert.deepEqual(Array.from(result.peers, peer => peer.code), ['sz000858', 'sh600809', 'sz000568', 'sh600702']);
});

test('Agent peer selection rejects wrong company, invalid schema and empty valid peers', () => {
  assert.throws(() => parseAgentPeerSelection(reply([{ code: '000858', name: '五粮液', reason: '同行' }]), 'sz000001'), /未匹配当前公司/);
  assert.throws(() => parseAgentPeerSelection('{"schemaVersion":2}', 'sh600519'), /未匹配当前公司/);
  assert.throws(() => parseAgentPeerSelection(reply([{ code: 'bad', name: '无效', reason: '无效' }]), 'sh600519'), /没有返回可验证/);
  assert.throws(() => parseAgentPeerSelection('没有JSON', 'sh600519'), /有效的同行筛选 JSON/);
});
