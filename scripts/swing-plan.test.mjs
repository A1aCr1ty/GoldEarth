import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require=createRequire(new URL('../app/package.json',import.meta.url));
const ts=require('typescript');
const exports={};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../app/src/lib/swingPlan.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports});
const position={code:'002463',name:'sample',quantity:800,available:250,cost:30,price:32,profit:1600,quoteTime:'20261102150000'};
const item={asof:'2026-11-02',adjusted_close:16,atr14:0.8,ma20:15,technical:{signal:'B1',yellow:14,reference_stop_adjusted:13},support20:13,resistance20:18};
test('tradable swing inventory respects availability and lot size',()=>{
  const p=exports.holdingSwingPlan(position,item,400,2,'2026-11-02');
  assert.equal(p.core,400); assert.equal(p.sellable,200);
});
test('missing availability and stale history block the plan',()=>{
  assert.match(exports.holdingSwingPlan({...position,available:null},item,400,2,'2026-11-02').blocked,/未知/);
  assert.match(exports.holdingSwingPlan(position,item,400,2,'2026-11-20').blocked,/过期/);
});
test('invalid and unallocated inventory never becomes an instruction',()=>{
  assert.equal(exports.holdingSwingPlan(position,item,900,2,'2026-11-02').valid,false);
  assert.ok(exports.holdingSwingPlan(position,item,0,2,'2026-11-02').blocked);
  assert.equal(exports.holdingSwingPlan(position,item,100.5,2,'2026-11-02').valid,false);
});
test('market or technical risk takes priority over a swing setup',()=>{
  assert.match(exports.holdingSwingPlan(position,item,400,0,'2026-11-02').action,/减仓/);
  assert.match(exports.holdingSwingPlan(position,{...item,technical:{...item.technical,signal:'risk_exit'}},400,2,'2026-11-02').action,/减仓/);
});
test('current price and ATR create an ordered swing price ladder',()=>{
  const p=exports.holdingSwingPlan(position,item,400,2,'2026-11-02');
  assert.deepEqual(JSON.parse(JSON.stringify(p.prices)),{current:32,atr:1.6,entryLow:30.4,entryHigh:31.2,breakout:32.8,takeProfit:33.6,stop:29.6});
  assert.ok(p.prices.stop<p.prices.entryLow && p.prices.entryHigh<p.prices.current);
  assert.ok(p.prices.current<p.prices.breakout && p.prices.breakout<p.prices.takeProfit);
  assert.match(p.entry,/¥30\.400–¥31\.200/);
  assert.match(p.takeProfit,/¥33\.600/);
  assert.match(p.buyback,/¥30\.400–¥31\.200/);
  assert.match(p.exit,/¥29\.600/);
});
test('price levels follow the current quote even when the review is older',()=>{
  const p=exports.holdingSwingPlan({...position,price:40,quoteTime:'20261103150000'},item,400,2,'2026-11-03');
  assert.deepEqual(JSON.parse(JSON.stringify(p.prices)),{current:40,atr:2,entryLow:38,entryHigh:39,breakout:41,takeProfit:42,stop:37});
  const stale=exports.holdingSwingPlan({...position,quoteTime:undefined},item,400,2,'2026-11-20');
  assert.match(stale.blocked,/过期/);
  assert.equal(stale.prices.entryLow,30.4);
});
test('reported 22.840 quote no longer produces an entry zone above current price',()=>{
  const reported={...item,asof:'2026-11-13',adjusted_close:22.84,atr14:1.405,ma20:25.286,technical:{signal:'risk_exit',yellow:29.086},support20:21.53,resistance20:29.25};
  const p=exports.holdingSwingPlan({...position,price:22.84},reported,400,2,'2026-11-13');
  assert.deepEqual(JSON.parse(JSON.stringify(p.prices)),{current:22.84,atr:1.405,entryLow:21.435,entryHigh:22.138,breakout:23.543,takeProfit:24.245,stop:20.733});
  assert.ok(p.prices.entryHigh<p.prices.current);
  assert.match(p.entry,/暂停新增买入/);
});
test('missing or invalid current prices and ATR never fabricate order references',()=>{
  assert.equal(exports.swingPriceLevels({...position,price:null},item),null);
  assert.equal(exports.swingPriceLevels({...position,price:0},item),null);
  assert.equal(exports.swingPriceLevels(position,{...item,adjusted_close:0}),null);
  assert.equal(exports.swingPriceLevels(position,{...item,atr14:0}),null);
  assert.equal(exports.swingPriceLevels(position,{...item,atr14:20}),null);
  assert.match(exports.holdingSwingPlan({...position,price:null},item,400,2,'2026-11-02').entry,/暂不生成具体价格/);
});
test('risk signals suppress new buying even when an entry range is available',()=>{
  const p=exports.holdingSwingPlan(position,{...item,technical:{...item.technical,signal:'risk_exit'}},400,2,'2026-11-02');
  assert.match(p.entry,/暂停新增买入/);
  assert.equal(p.prices.entryLow,30.4);
});
