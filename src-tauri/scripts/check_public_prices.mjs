import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const script = readFileSync(new URL("../src/public_price_scrape.js", import.meta.url), "utf8");
function card(id, title, price, condition = "95成新", text = "") {
  return { href: "https://m2.9ji.com/secondHand/detail/" + id, innerText: text,
    querySelector(selector) {
      if (selector === ".product-name") return { textContent: title };
      if (selector === ".product-price") return { textContent: price };
      if (selector === ".level-tag-name") return condition ? { textContent: condition } : null;
      throw new Error("Unexpected selector: " + selector);
    },
  };
}
const cards = [
  card("1", "大疆 DJI Osmo Pocket 3 一英寸口袋云台相机 标准版", "￥1839", "99成新"),
  card("1", "大疆 DJI Osmo Pocket 3 一英寸口袋云台相机 标准版", "￥1839", "99成新"),
  card("2", "大疆 DJI Osmo Pocket 3 一英寸口袋云台相机 标准版", "￥1779"),
  card("3", "大疆 DJI Osmo Pocket 3 一英寸口袋云台相机 标准版", "￥1619", "9成新"),
  card("4", "大疆 DJI Osmo Pocket 3 全能套装", "￥1899"),
  card("5", "大疆 DJI Osmo Pocket 2 三轴云台相机", "￥899"),
  card("6", "大疆 Pocket 3 保护壳", "￥3"),
  card("7", "大疆 Pocket 3 相机租赁", "￥30"),
  card("8", "大疆 Pocket 3", "￥70.79×24"),
  card("9", "大疆 Pocket 3", "￥1800", ""),
  card("10", "大疆 Pocket 3", "￥1800", "9成新", "已售罄"),
];
function run(provider, keyword, rawRet = "", raw = "{}") {
  return vm.runInNewContext(script.replace("__INPUT_JSON__", JSON.stringify({ provider, keyword })), {
    document: { title: "公开商品搜索", querySelectorAll: () => cards },
    location: { href: "https://m2.9ji.com/search?keyword=pocket%203&searchType=3", hostname: provider === "jd" ? "passport.jd.com" : "m2.9ji.com" },
    window: { __xyRawRet: rawRet, __xyRaw: raw }, URL,
  });
}
const actual = JSON.parse(JSON.stringify(run("nine", "pocket 3")));
assert.deepEqual(actual.items.map(i => [i.price, i.currency, i.condition]), [
  [1839, "CNY", "99成新"], [1779, "CNY", "95成新"], [1619, "CNY", "9成新"],
]);
assert.equal(run("nine", "pocket 3 全能套装").items.length, 1);
assert.equal(run("nine", "pocket 4p").items.length, 0);
assert.equal(run("nine", "").items.length, 0);
const blocked = run("xianyu", "pocket 3", "RGV587_ERROR::SM::被拦截");
assert.equal(blocked.items.length, 0, "An API restriction must never turn recommendation prices into samples");
assert.equal(blocked.status, "restricted");
const raw = JSON.stringify({ data: { resultList: [1, 2, 3].map(id => ({
  data: { item: { main: { exContent: { title: "大疆 Pocket 3 标准版", itemId: id, price: "¥1,800" } } } },
})) } });
assert.equal(run("xianyu", "pocket 3", "SUCCESS::调用成功", raw).items.length, 3);
assert.equal(run("xianyu", "pocket 3", "SUCCESS::调用成功", '{"data":{"recommendations":[{"price":3}]}}').items.length, 0);
assert.equal(run("jd", "pocket 3").status, "restricted");
console.log("通过：国内整机型号、主售价、成色、去重、套装/配件/租赁/分期/已售过滤，以及闲鱼推荐隔离与京东登录跳转。");
