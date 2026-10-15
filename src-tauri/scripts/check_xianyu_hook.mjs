// 把 xianyu_webview.rs 里的 HOOK_JS / POLL_JS 原样抠出来，在假 DOM 上跑一遍。
//
// 为什么需要这个：DOM 抓价和回传协议都是页面脚本干的活，Rust 单测碰不到。
// 而它一旦写错，失败方式和对岸一样——安静地什么都抓不到。
// 这里用一份仿真的闲鱼结果卡跑真实代码，把「会认出几个价格、认出来
// 的对不对、原生回调能否保留完整响应和中文」当场验掉，
// 而不是等用户点一次按钮才知道。
//
// 跑法：node scripts/check_xianyu_hook.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const rs = readFileSync(join(here, '..', 'src', 'xianyu_webview.rs'), 'utf8');

function grab(name) {
  const m = rs.match(new RegExp(`const ${name}: &str = r#"([\\s\\S]*?)"#;`));
  if (!m) {
    console.error(`没找到 ${name}，正则或 raw string 的写法变了`);
    process.exit(1);
  }
  return m[1].trim();
}
const hook = grab('HOOK_JS');
const keyword = 'macbook air m5';
const pollJs = grab('POLL_JS').replace('__XY_KEYWORD_JSON__', JSON.stringify(keyword));

function fail(msg, extra) {
  console.error('\n不通过：' + msg);
  if (extra !== undefined) console.error('实际：', JSON.stringify(extra));
  process.exit(1);
}

// ---- 假 DOM ------------------------------------------------------------
// 仿闲鱼结果卡的真实形状。刻意带上三种坑：
//   ① 外层容器会把内层文字抄一遍（单件商品时容器整段就等于那个价格）
//   ② 价格被拆成 ¥<span>数字</span>，整段仍在父节点上
//   ③ 销量/想要人数是纯数字，不能混进来；「1.2万」这种解析不了，也不能收
function el(text, children = []) {
  return { textContent: text, children, parent: null };
}

const tree = [];
function mount(nodes, parent) {
  nodes.forEach((n) => {
    n.parent = parent;
    n.parentElement = parent;
    tree.push(n);
    mount(n.children, n);
  });
}
function contains(a, b) {
  let p = b;
  while (p) {
    if (a === p) return true;
    p = p.parent;
  }
  return false;
}

mount(
  [
    el('MacBook Air M5 13寸 ¥8,499.00 想要 12 人 上海', [
      el('MacBook Air M5 13寸'),
      el('¥8,499.00'),
      el('想要 12 人'),
      el('上海'),
    ]),
    el('MacBook Air M5 国行 ¥8,299 想要 3 人', [
      el('MacBook Air M5 国行'),
      el('¥8,299', [el('8,299')]),
      el('想要 3 人'),
    ]),
    el('MacBook Air M5 ¥1,317.94', [
      el('MacBook Air M5'),
      el('¥1,317.94', [el('¥1,317.94')]),
    ]),
    el('AirPods Pro 2 ¥1.2万 想要 5 人', [
      el('AirPods Pro 2'),
      el('¥1.2万'),
      el('想要 5 人'),
    ]),
    el('MacBook Air M5 已售 300 件 ¥7,999.00', [el('MacBook Air M5'), el('已售 300 件'), el('¥7,999.00')]),
    el('MacBook Air M5 保护壳 ¥3', [el('MacBook Air M5 保护壳'), el('¥3')]),
    el('MacBook Air M5 定金 ¥100', [el('MacBook Air M5 定金'), el('¥100')]),
    el('iPhone 17 ¥4999', [el('iPhone 17'), el('¥4999')]),
    el('¥2', [el('¥2')]),
  ],
  null,
);
// nodes 已经是扁的（mount 就是这么收集的）。真 DOM 的 querySelectorAll('*')
// 每个元素只出现一次，递归两遍等于伪造出一个真页面不会有的情况。
for (const n of tree) n.contains = (t) => contains(n, t);

const docBody = { querySelectorAll: () => tree };

function makeSandbox(body, href, title) {
  const sent = [];
  const sb = {
    document: { body, title },
    location: { href },
    // location.hash = x 在真浏览器里会更新 location.href（走同文档导航），
    // 这里用 getter 把这个行为做出来，否则测的就不是页面真正会遇到的东西了
    XMLHttpRequest: function () {},
    setInterval: () => {},
    console,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  };
  sb.XMLHttpRequest.prototype = { open() {}, send() {} };
  sb.window = sb;
  sb.__TAURI_INTERNALS__ = {
    invoke: (cmd, payload) => {
      sent.push({ cmd, payload });
      return Promise.resolve();
    },
  };
  // location.hash 赋值 → href 末尾追加/替换 # 段
  let hash = href.includes('#') ? href.slice(href.indexOf('#')) : '';
  const base = href.split('#')[0];
  sb.location = {
    get href() {
      return base + hash;
    },
    get hash() {
      return hash;
    },
    set hash(v) {
      const s = String(v);
      hash = s.startsWith('#') ? s : '#' + s;
    },
  };
  vm.createContext(sb);
  vm.runInContext(hook, sb, { filename: 'HOOK_JS' });
  return { sb, sent };
}

const { sb, sent } = makeSandbox(
  docBody,
  'https://www.goofish.com/search?q=macbook+air+m5',
  'macbook air M5 - 闲鱼',
);

console.log('钩子装上 =', sb.window.__xyHooked);

// ---- 钩子不该再发话 ----------------------------------------------------
// 页面向 Rust 回传改成 Rust 用 eval 主动取。钩子里要是还留着 invoke，
// 那条路在远程页面上是会永远挂住的（见 xianyu_webview.rs 模块注释）。
if (sent.length !== 0) {
  fail('钩子还在自己 invoke，页面不该发话', sent);
}
if (typeof sb.window.__xyScan !== 'function') fail('没有挂上 __xyScan');
if (sb.window.__xyScan().length !== 0) fail('缺少关键词时不应全页取价');

// ---- 扫价 --------------------------------------------------------------
const got = sb.window.__xyScan(keyword);
console.log('认出价格 =', JSON.stringify(got));
if (got.length) {
  console.log('均价     =', (got.reduce((a, b) => a + b, 0) / got.length).toFixed(2));
}

// 期望 4 个：8499 / 8299 / 1317.94 / 7999
//   ① 容器抄的那一遍要去重   ② ¥<span>8,299</span> 要认得出
//   ③ ¥1.2万 收不了（单位解析不了），销量数字更不能混进来
const expect = [8499, 8299, 1317.94, 7999];
if (
  got.length !== expect.length ||
  !got.every((v, i) => Math.abs(v - expect[i]) < 0.01)
) {
  fail('扫价结果不对', { 期望: expect, 实际: got });
}

// 原生回调返回对象；不写 hash，完整保留中文和响应内容。
const result = vm.runInContext(pollJs, sb);
if (JSON.stringify(result.prices) !== JSON.stringify(expect)) fail('回调价格不一致', result);
if (result.page_title !== 'macbook air M5 - 闲鱼') fail('中文标题被破坏', result);
if (sb.location.hash) fail('原生回调不应修改网页地址', sb.location.href);

const empty = makeSandbox({ querySelectorAll: () => [] }, 'https://www.goofish.com/search?q=x', '');
empty.sb.__xyRaw = JSON.stringify({ret:['SUCCESS::调用成功'],data:{items:Array.from({length:50},(_,i)=>({price:100+i,title:'商品'.repeat(50)}))}});
empty.sb.__xyRawRet = 'SUCCESS::调用成功';
const rawResult = vm.runInContext(pollJs, empty.sb);
if (rawResult.raw !== empty.sb.__xyRaw || rawResult.raw.length <= 400) fail('响应被截断', rawResult.raw.length);
if (rawResult.raw_ret !== 'SUCCESS::调用成功') fail('ret 未保留中文');

// 必须 clone 响应，钩子读取不能消耗网页自身的 fetch body。
let cloned = false;
let responseBody = '{"api":"mtop.taobao.idlemtopsearch.pc.search","ret":["SUCCESS::调用成功"],"data":{"price":123}}';
const fetchCase = makeSandbox({ querySelectorAll: () => [] }, 'https://www.goofish.com/search?q=x', '');
fetchCase.sb.__xyHooked = false;
fetchCase.sb.fetch = () => Promise.resolve({
  text() { fail('钩子消耗了原响应体'); },
  clone() { cloned = true; return { text: () => Promise.resolve(responseBody) }; }
});
vm.runInContext(hook, fetchCase.sb);
await fetchCase.sb.fetch('https://h5api.m.goofish.com/h5/mtop.taobao.idlemtopsearch.pc.search/1.0/');
await new Promise(resolve => setImmediate(resolve));
if (!cloned || !fetchCase.sb.__xyRaw.includes('123')) fail('fetch 响应未完整截获');
const searchRaw = fetchCase.sb.__xyRaw;
responseBody = '{"api":"mtop.taobao.idlemtopsearch.pc.search.shade","ret":["SUCCESS::调用成功"],"data":{"price":3}}';
await fetchCase.sb.fetch('https://h5api.m.goofish.com/h5/mtop.taobao.idlemtopsearch.pc.search.shade/1.0/');
await new Promise(resolve => setImmediate(resolve));
if (fetchCase.sb.__xyRaw !== searchRaw) fail('shade 接口覆盖了商品搜索响应');
responseBody = '{"api":"mtop.taobao.idlemtopsearch.pc.item.search.activate","ret":["SUCCESS::调用成功"],"data":{"price":1}}';
await fetchCase.sb.fetch('https://h5api.m.goofish.com/h5/mtop.taobao.idlemtopsearch.pc.item.search.activate/1.0/');
await new Promise(resolve => setImmediate(resolve));
if (fetchCase.sb.__xyRaw !== searchRaw) fail('辅助接口覆盖了商品搜索响应');
console.log('通过：关键词匹配、配件/定金过滤、DOM 去重、拆分价格、原生回调、辅助接口隔离、fetch body 均正常。');
