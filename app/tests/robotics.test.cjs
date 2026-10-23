const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const m = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/lib/robotics.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { module: m, exports: m.exports, URL, require: () => ({ invoke() {} }) });
const R = m.exports;
const item = (url, category, publishedAt = '2026-10-22T10:00:00Z') => ({ url, category, publishedAt, title: '机器人 ROS', summary: '版本更新', source: 'GitHub', kind: 'release' });
const opts = (more = {}) => ({ category: 'all', subscribed: ['system', 'algorithm'], query: '', view: 'all', read: [], days: 0, ...more });
test('cross-topic deduplication preserves category membership before filtering', () => {
  const items = R.feedItems({ sources: [{ items: [item('https://a.com', 'system'), item('https://a.com', 'algorithm')] }] });
  assert.equal(items.length, 2);
  assert.equal(R.filterRobotItems(items, opts()).length, 1);
  assert.equal(R.filterRobotItems(items, opts({ category: 'algorithm' })).length, 1);
});
test('subscriptions, read state, keywords and saved items filter independently', () => {
  const items = [item('https://a.com', 'system'), item('https://b.com', 'sensor')];
  assert.equal(R.filterRobotItems(items, opts()).length, 1);
  assert.equal(R.filterRobotItems(items, opts({ view: 'unread', read: ['https://a.com'] })).length, 0);
  assert.equal(R.filterRobotItems(items, opts({ view: 'saved', subscribed: [] })).length, 2);
  assert.equal(R.filterRobotItems(items, opts({ query: 'ros 更新' })).length, 1);
  assert.equal(R.filterRobotItems(items, opts({ query: '不存在' })).length, 0);
});
test('date filters exclude unknown dates and old items; unknown dates sort last', () => {
  const items = [item('https://a.com', 'system', null), item('https://b.com', 'system'), item('https://c.com', 'system', '2020-01-01T00:00:00Z')];
  const filtered = R.filterRobotItems(items, opts({ days: 7 }), Date.parse('2026-10-23T10:00:00Z'));
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].url, 'https://b.com');
  assert.equal(R.filterRobotItems(items, opts()).at(-1).url, 'https://a.com');
});
test('notes retain source links and distinguish summaries from article contents', () => {
  const text = R.robotMarkdown([item('https://example.com/release', 'system', null)]);
  assert.ok(text.includes('<https://example.com/release>'));
  assert.ok(text.includes('来源未提供'));
  assert.ok(text.includes('标题与摘要'));
});
test('technical document and source filters find specifications before releases', () => {
  const items = [
    { ...item('https://example.com/sdk', 'system'), kind: 'sdk', sourceKind: 'github' },
    { ...item('https://example.com/spec.pdf', 'system', null), kind: 'datasheet', sourceKind: 'website' },
    { ...item('https://example.com/release', 'system'), sourceKind: 'github' },
  ];
  assert.equal(R.filterRobotItems(items, opts())[0].kind, 'datasheet');
  assert.equal(R.filterRobotItems(items, opts({ kind: 'sdk' })).length, 1);
  assert.equal(R.filterRobotItems(items, opts({ sourceKind: 'website' }))[0].url, 'https://example.com/spec.pdf');
  assert.equal(R.filterRobotItems(items, opts({ kind: 'sdk', sourceKind: 'website' })).length, 0);
  assert.ok(R.robotMarkdown(items).includes('资料类型：参数 / 规格书'));
});
test('encoded filenames in cached feeds and saved items display readable names without changing links', () => {
  const cached = { ...item('https://cdn.example.com/LVX2%20Specifications.pdf?download=1', 'sensor'), title: 'LVX2%20Specifications.pdf' };
  const readable = R.feedItems({ sources: [{ items: [cached] }] })[0];
  assert.equal(readable.title, 'LVX2 Specifications.pdf');
  assert.equal(readable.url, cached.url);
  assert.equal(cached.title, 'LVX2%20Specifications.pdf');
  const saved = R.filterRobotItems([cached], opts({ view: 'saved', subscribed: [], query: 'LVX2 Specifications.pdf' }));
  assert.equal(saved[0].title, 'LVX2 Specifications.pdf');
  const text = R.robotMarkdown([cached]);
  assert.ok(text.includes('原始标题：LVX2 Specifications.pdf'));
  assert.ok(text.includes(`<${cached.url}>`));
  const second = { ...cached, url: 'https://cdn.example.com/LVX%20Specifications%20EN_20190924.pdf', title: 'LVX%20Specifications%20EN_20190924.pdf' };
  assert.equal(R.normalizeRobotItem(second).title, 'LVX Specifications EN_20190924.pdf');
});
test('headings identify company, explicit product and document purpose without rewriting originals', () => {
  const examples = [
    [{ title: 'LVX2%20Specifications.pdf', url: 'https://cdn.example.com/LVX2%20Specifications.pdf', source: 'Livox · 传感器资料下载', category: 'sensor', kind: 'datasheet' }, '览沃 Livox｜LVX2｜参数规格'],
    [{ title: 'H1 User Manual', url: 'https://www.unitree.com/h1', source: '宇树 H1 · 官方参数', kind: 'manual' }, '宇树｜H1｜用户手册'],
    [{ title: 'SDK_API文档_完整版.md', url: 'https://github.com/Dobot-Arm/TCP-IP-Python-V4/blob/main/assets/SDK_API.md', source: '越疆 · 协作臂 TCP/IP SDK（GitHub）', kind: 'api' }, '越疆｜协作臂 TCP/IP Python SDK V4｜API / 通信协议'],
    [{ title: 'README_zh.md', url: 'https://github.com/unitreerobotics/unitree_rl_gym/blob/main/README_zh.md', source: '宇树 · 强化学习与运动控制（GitHub）', category: 'algorithm', kind: 'readme' }, '宇树｜强化学习与运动控制｜项目说明 README'],
    [{ title: 'docs/SCOUT_UserManual_EN.pdf', url: 'https://github.com/agilexrobotics/ugv_sdk/blob/main/docs/SCOUT_UserManual_EN.pdf', source: '松灵 · 移动机器人 SDK', kind: 'manual' }, '松灵｜SCOUT｜用户手册'],
  ];
  for (const [fields, expected] of examples) {
    const input = { ...item(fields.url, fields.category || 'arm'), ...fields };
    const original = input.title;
    assert.equal(R.robotHeading(input).title, expected);
    assert.equal(input.title, original);
    assert.ok(R.robotMarkdown([input]).includes('## ' + expected));
  }
});
test('generic documents use honest topic context and never infer models from site-wide summaries', () => {
  const input = { ...item('https://www.orbbec.com.cn/downloads/hashed.pdf', 'sensor'), title: '中文参数表', source: '奥比中光 · 产品资料', summary: 'Gemini 335 Femto Bolt Astra DaBai', kind: 'datasheet' };
  assert.equal(R.robotHeading(input).title, '奥比中光｜传感器资料｜参数规格');
  const unknown = { ...input, source: '我的资料源', url: 'https://example.com/guide.pdf', title: '宇树 G1 手册' };
  assert.equal(R.robotHeading(unknown).company, '来源：我的资料源');
  assert.equal(R.robotHeading(unknown).subject, '传感器资料');
});
test('repository README headings preserve technology context and release versions', () => {
  const sdk = { ...item('https://github.com/xArm-Developer/xArm-Python-SDK/blob/main/README.md', 'arm'), title: 'UFACTORY · 机械臂 Python SDK（GitHub） · README.md', source: 'UFACTORY · 机械臂 Python SDK（GitHub）', kind: 'readme' };
  assert.equal(R.robotHeading(sdk).subject, '机械臂 Python SDK');
  const release = { ...item('https://github.com/unitreerobotics/unitree_ros2/releases/tag/v2.1.0', 'system'), title: 'v2.1.0', source: '宇树 · ROS 2 系统适配（GitHub）' };
  assert.equal(R.robotHeading(release).title, '宇树｜ROS 2 系统适配｜版本更新 v2.1.0');
  assert.equal(R.filterRobotItems([{ ...sdk, source: 'GitHub · xArm-Developer/xArm-Python-SDK' }], opts({ subscribed: ['arm'], query: 'UFACTORY Python' })).length, 1);
});
test('filename decoding preserves plus, Unicode, authored titles and literal escapes; malformed names never crash', () => {
  for (const [name, expected] of [['%E6%89%8B%E5%86%8C%20A+B.pdf', '手册 A+B.pdf'], ['100%25.pdf', '100%.pdf'], ['literal%2520.pdf', 'literal%20.pdf']]) {
    const input = { ...item(`https://example.com/${name}`, 'system'), title: name };
    const normalized = R.normalizeRobotItem(input);
    assert.equal(normalized.title, expected);
    assert.equal(R.normalizeRobotItem(normalized).title, expected);
  }
  for (const [title, path] of [['产品效率提升 20%20', 'guide.pdf'], ['bad%20%XX.pdf', 'bad%20%XX.pdf'], ['control%0A.pdf', 'control%0A.pdf']]) {
    const input = { ...item(`https://example.com/${path}`, 'system'), title };
    assert.equal(R.normalizeRobotItem(input).title, title);
  }
});
