// Run with: node scripts/check_prices_store.mjs
// Exercise the real store with a stubbed Tauri bridge; no WebView or network required.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const rows = ["camera", "laptop"].map((id) => ({
  target: { id, name: id },
  latest: 178.82,
  changePct: -74,
  samples: 2,
  days: 1,
  spark: [178.82],
}));
const blocked = {
  ok: false, needsVerification: true, count: 0, avg: null, min: null, max: null,
  ret: "RGV587_ERROR::SM::需要验证", message: "本次未更新价格",
};
const success = {
  ok: true, needsVerification: false, count: 8, avg: 2100, min: 1800, max: 2400,
  ret: "SUCCESS::调用成功", message: "已记入趋势",
};
let calls = [];
let overviewReads = 0;
let replies = { camera: blocked, laptop: success };
const tauri = {
  fetchPublicPrice: async (id) => { calls.push(id); return replies[id]; },
  priceOverview: async () => { overviewReads++; return rows; },
  priceTrend: async () => [],
};
const module = { exports: {} };
const source = readFileSync(new URL("../src/store/prices.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
vm.runInNewContext(compiled, {
  exports: module.exports,
  require(name) {
    if (name === "@/lib/tauri") return { tauri };
    if (name !== "zustand") throw new Error("Unexpected import: " + name);
    return {
      create(init) {
        let state;
        const get = () => state;
        const set = (patch) => { state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) }; };
        state = init(set, get);
        return { getState: get, setState: set };
      },
    };
  },
});
const store = module.exports.usePrices;
const state = () => store.getState();
store.setState({ items: rows });

await state().runProbe("camera");
assert.equal(overviewReads, 0, "Failed queries must not be treated as a new stored price");
assert.equal(state().items[0].latest, 178.82, "The historical record is retained");
await state().select("laptop");
await state().select("camera");
assert.equal(state().results.camera.needsVerification, true, "Switching items must retain failure status");

calls = [];
await state().refreshAll();
assert.equal(JSON.stringify(calls), JSON.stringify(["camera"]), "Verification must pause the shared-session batch");
assert.match(state().error, /批量查询已暂停/);
assert.equal(state().refreshingAll, false);
assert.equal(state().probingFor, null);

replies = { camera: { ...blocked, needsVerification: false }, laptop: success };
calls = [];
await state().refreshAll();
assert.equal(JSON.stringify(calls), JSON.stringify(["camera", "laptop"]), "Ordinary errors should not stop the whole batch");
assert.equal(state().results.camera.ok, false);
assert.equal(state().results.laptop.ok, true);

replies.camera = success;
await state().runProbe("camera");
assert.equal(state().results.camera.ok, true, "A successful retry must replace the previous failure");
assert.equal(state().results.camera.needsVerification, false);
assert.equal(state().probing, false);
console.log("通过：失败保留历史、切换保留状态、验证暂停批量、普通失败继续、重试成功清除验证状态。");
