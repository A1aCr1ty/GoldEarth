const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const moduleUnderTest = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/lib/stockQuant.ts'),'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { module: moduleUnderTest, exports: moduleUnderTest.exports });
const { evaluateQuant, evaluateProfit } = moduleUnderTest.exports;
const planModule={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/lib/stockPlan.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{module:planModule,exports:planModule.exports,require:()=>moduleUnderTest.exports});
const {tradePlan,researchState}=planModule.exports;
const bars = () => Array.from({length:80}, (_,i) => {
  const close = 100 + i * .1;
  return { date: new Date(Date.UTC(2026,6,1+i)).toISOString().slice(0,10), open:close, close, high:close+.02, low:close-.02, volume:100, amount:10000 };
});
const today = '2026-09-19';
test('warmup, duplicate, invalid OHLC, stale data and zero volume suppress signals', () => {
  assert.equal(evaluateQuant([],today).ready,false);
  const a = bars();
  assert.equal(evaluateQuant([...a,a[79]],today).ready,false);
  assert.equal(evaluateQuant(a,'2026-10-23').ready,false);
  a[79].high = 1;
  assert.equal(evaluateQuant(a,today).ready,false);
  const b = bars(); b[79].volume = 0;
  assert.equal(evaluateQuant(b,today).ready,false);
  const c = bars(); c[20].date = '2026-07-32';
  assert.equal(evaluateQuant(c,today).ready,false);
});
test('buy requires prior-window breakout with volume; current and future bars cannot affect result', () => {
  const a = bars();
  assert.notEqual(evaluateQuant(a,today).action,'买入候选');
  a[79].volume = 150;
  const result = evaluateQuant(a,today);
  assert.equal(result.action,'买入候选'); assert.equal(result.score,100);
  assert.equal(result.volumeRatio,1.5);
  assert.equal(evaluateQuant([...a,{...a[79],date:today,close:9999}],today).score,100);
  assert.equal(evaluateQuant([...a].reverse(),today).score,100);
});
test('weak trend takes priority over entry and neutral bars do not imply buys', () => {
  const a = bars();
  for (let i=75;i<80;i++) a[i] = {...a[i],open:90,close:90,high:90,low:90};
  assert.equal(evaluateQuant(a,today).action,'减仓观察');
});
test('profit stages, market regime and invalid costs', () => {
  assert.equal(evaluateProfit(110,0,'normal'),null);
  assert.equal(evaluateProfit(Infinity,100,'normal'),null);
  assert.match(evaluateProfit(99,100,'normal').advice,/浮亏/);
  assert.match(evaluateProfit(110,100,'normal').advice,/首次止盈区/);
  assert.match(evaluateProfit(120,100,'normal').advice,/第二止盈区/);
  assert.match(evaluateProfit(130,100,'normal').advice,/阶梯退出区/);
  assert.match(evaluateProfit(150,100,'normal').advice,/阶梯退出区/);
  assert.match(evaluateProfit(151,100,'normal').advice,/充分兑现区/);
  assert.match(evaluateProfit(119,100,'strong').advice,/未到/);
  assert.match(evaluateProfit(120,100,'strong').advice,/达到强势/);
});
test('dated reports expire and future dates never become active',()=>{
  assert.match(researchState('2026-10-16','daily','2026-10-23'),/过期/);
  assert.match(researchState('2026-10-11','weekly','2026-10-23'),/过期/);
  assert.match(researchState('2026-10-24','daily','2026-10-23'),/待核实/);
});
test('risk limits, stop priority and missing evidence constrain operation plan',()=>{
 const q={ready:true,fiveEntry:true,fiveExit:false,bias:2};
 const o={total:20,stock:0,cap:15,totalCap:50,risk:1,stop:10,verified:true,quoteFresh:true};
 assert.equal(tradePlan(q,100,0,o).allowance,10);
 assert.match(tradePlan(q,100,0,{...o,verified:false}).action,/暂不交易/);
 assert.match(tradePlan(q,100,0,{...o,quoteFresh:false}).action,/暂不交易/);
 assert.match(tradePlan(q,80,100,{...o,stock:5}).action,/止损/);
 assert.match(tradePlan(q,100,100,{...o,stock:12}).action,/超限/);
 assert.match(tradePlan({...q,fiveExit:true},100,100,{...o,stock:5}).action,/五日线/);
 assert.match(tradePlan(q,100,0,{...o,stock:5}).action,/暂不交易/);
});
