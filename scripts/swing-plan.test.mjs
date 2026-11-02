import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require=createRequire(new URL('../app/package.json',import.meta.url));
const ts=require('typescript');
const exports={};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../app/src/lib/swingPlan.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports});
const position={code:'002463',name:'sample',quantity:800,available:250,cost:30,price:32,profit:1600};
const item={asof:'2026-11-02',ma20:30,technical:{signal:'B1',yellow:29}};
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
