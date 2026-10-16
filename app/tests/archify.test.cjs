const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const ts = require('typescript');

const root = path.resolve(__dirname, '../../src-tauri/resources/archify');
let saved;
const moduleValue = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../src/lib/archify.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, {
  module: moduleValue, exports: moduleValue.exports,
  require: () => ({ invoke: () => { throw Error('unexpected IPC'); } }),
  localStorage: { getItem: () => saved, setItem: (_, value) => { saved = value; } },
});
const api = moduleValue.exports;

test('automatic diagram repair stops after two retries and never retries runtime failures', () => {
  const failed = { ok: false, html: null, failureKind: 'diagram', receipt: { diagnostics: [] } };
  assert.equal(api.shouldRepairDiagram(failed, 0), true);
  assert.equal(api.shouldRepairDiagram(failed, 1), true);
  for (const attempt of [2, 3, -1, NaN]) assert.equal(api.shouldRepairDiagram(failed, attempt), false);
  assert.equal(api.shouldRepairDiagram({ ...failed, failureKind: 'runtime' }, 0), false);
  assert.equal(api.shouldRepairDiagram({ ...failed, ok: true }, 0), false);
});

test('runtime failures retain their real cause and are distinct from diagram diagnostics', () => {
  const message = api.renderFailureMessage({ ok: false, html: null, failureKind: 'runtime', receipt: { error: "EISDIR: lstat 'D:'" } });
  assert.match(message, /运行失败/);
  assert.match(message, /EISDIR/);
  assert.doesNotMatch(message, /图表未通过校验/);
  const invalid = api.renderFailureMessage({ ok: false, html: null, failureKind: 'diagram', receipt: { diagnostics: [{ message: 'Participant missing' }] } });
  assert.match(invalid, /图表未通过校验/);
  assert.match(invalid, /Participant missing/);
});

test('agent JSON extraction supports fences, prose and braces in labels without accepting the wrong diagram type', () => {
  const source = { diagram_type: 'workflow', meta: { title: 'Parse {request}' } };
  for (const output of [JSON.stringify(source), '结果：\n```json\n' + JSON.stringify(source) + '\n```', '结果：\n' + JSON.stringify(source) + '\n结束']) {
    assert.deepEqual(JSON.parse(api.extractDiagram(output, 'workflow')), source);
  }
  assert.throws(() => api.extractDiagram('```json\n{"diagram_type":"architecture"}\n```', 'workflow'));
  assert.throws(() => api.extractDiagram('{"diagram_type":"workflow",}', 'workflow'));
});

test('draft restore tolerates corrupt storage and inherited object keys', () => {
  for (const value of ['{broken', 'null', '{"type":"toString"}', '{"type":"__proto__"}']) {
    saved = value; assert.equal(api.loadArchifyDraft().type, 'architecture');
  }
  api.saveArchifyDraft({ type: 'sequence', source: '{}', prompt: '请求链', agentId: 'agent', runId: 'run' });
  assert.equal(api.loadArchifyDraft().runId, 'run');
});

const examples = {
  architecture: 'web-app.architecture.json', workflow: 'agent-tool-call.workflow.json',
  sequence: 'async-job-roundtrip.sequence.json', dataflow: 'product-analytics.dataflow.json', lifecycle: 'agent-run.lifecycle.json',
};
const logRoot = path.resolve(__dirname, '../../.runlogs');
fs.mkdirSync(logRoot, { recursive: true });
const work = fs.mkdtempSync(path.join(logRoot, 'archify-test-'));

for (const [type, name] of Object.entries(examples)) {
  test(`bundled ${type} template delivers a self-contained viewer with all nine showcase checks`, () => {
    const template = JSON.parse(fs.readFileSync(path.join(root, 'examples', name), 'utf8'));
    template.meta.locale = 'zh-CN';
    delete template.meta.output; delete template.meta.animation; delete template.meta.visual_preset;
    if (type === 'workflow') assert.equal(template.schema_version, 2);
    const input = path.join(work, `${type}.json`), output = path.join(work, `${type}.html`);
    fs.writeFileSync(input, JSON.stringify(template));
    const child = spawnSync(process.execPath, [path.join(root, 'bin/archify.mjs'), 'deliver', type, input, output, '--quality', 'showcase', '--json'], { encoding: 'utf8', timeout: 30000 });
    assert.equal(child.status, 0, child.stdout + child.stderr);
    const receipt = JSON.parse(child.stdout);
    assert.equal(receipt.validation.checkCount, 9);
    assert.equal(receipt.validation.checksPassed, 9);
    assert.equal(receipt.validation.errors, 0);
    assert.equal(receipt.validation.warnings, 0);
    const html = fs.readFileSync(output, 'utf8');
    assert.match(html, /<html lang="zh-CN"/);
    assert.match(html, /<svg/);
    assert.match(receipt.artifact.sha256, /^[a-f0-9]{64}$/);
    assert.equal(receipt.artifact.bytes, Buffer.byteLength(html));
  });
}

test('invalid input produces a failed receipt and preserves the last valid HTML', () => {
  const input = path.join(work, 'invalid.json'), output = path.join(work, 'last-good.html');
  fs.writeFileSync(input, '{"diagram_type":"architecture","meta":{"title":"Invalid"}}');
  fs.writeFileSync(output, 'previous verified artifact');
  const child = spawnSync(process.execPath, [path.join(root, 'bin/archify.mjs'), 'deliver', 'architecture', input, output, '--quality', 'showcase', '--json'], { encoding: 'utf8', timeout: 30000 });
  assert.notEqual(child.status, 0);
  assert.equal(JSON.parse(child.stdout).ok, false);
  assert.equal(fs.readFileSync(output, 'utf8'), 'previous verified artifact');
});

test('IPC registration, build ACL and permission grant include every Archify command', () => {
  const read = name => fs.readFileSync(path.resolve(__dirname, '../../src-tauri', name), 'utf8');
  for (const command of ['archify_template', 'prepare_archify_generation', 'render_archify', 'export_archify', 'export_archify_to_category', 'open_archify_category_folder']) {
    assert.ok(read('src/lib.rs').includes(`commands::archify::${command}`));
    for (const file of ['build.rs', 'permissions/app.toml']) assert.ok(read(file).includes(`"${command}"`), `${command} missing in ${file}`);
  }
  assert.ok(JSON.parse(read('tauri.conf.json')).bundle.resources.includes('resources/archify/**/*'));
  for (const command of ['list_category_html_files', 'read_category_html_file']) {
    assert.ok(read('src/lib.rs').includes(`commands::categories::${command}`));
    for (const file of ['build.rs', 'permissions/app.toml']) assert.ok(read(file).includes(`"${command}"`));
  }
});

test('the preview pipeline repairs fan-out labels using real diagnostics and returns the validated source with HTML', async () => {
  const diagram = {
    schema_version: 1, diagram_type: 'architecture',
    meta: { title: 'Label clearance regression', locale: 'zh-CN', quality_profile: 'showcase', viewBox: [1400, 820] },
    components: [
      { id: 'previous', type: 'external', label: '前一阶段', sublabel: '三大指标集体下跌', pos: [60, 310], size: [190, 80] },
      { id: 'shanghai', type: 'database', label: '指标 A', sublabel: '下跌后小幅回升', pos: [460, 130], size: [200, 80] },
      { id: 'shenzhen', type: 'database', label: '指标 B', sublabel: '跌幅收窄，继续下跌', pos: [460, 310], size: [200, 80] },
      { id: 'chinext', type: 'database', label: '指标 C', sublabel: '前日跌幅最大，次日续跌', pos: [460, 490], size: [200, 80] },
      { id: 'current', type: 'backend', label: '当前阶段', sublabel: 'A 回升，B/C 续跌', pos: [880, 310], size: [200, 80] },
      { id: 'assessment', type: 'backend', label: '趋势分化', sublabel: '示例数据，仅验证布局', pos: [1160, 310], size: [210, 80] },
    ],
    connections: [
      ['previous', 'shanghai', '3707.48点｜−1.59%'], ['previous', 'shenzhen', '11816.79点｜−2.43%'],
      ['previous', 'chinext', '2783.17点｜−2.92%'], ['shanghai', 'current', '3716.28点｜+0.24%'],
      ['shenzhen', 'current', '11802.46点｜−0.12%'], ['chinext', 'current', '2772.38点｜−0.39%'],
      ['current', 'assessment', '修复力度有限'],
    ].map(([from, to, label]) => ({ id: `${from}-${to}`, from, to, label, route: 'auto' })), cards: [],
  };
  const input = path.join(work, 'fan-out.json'), output = path.join(work, 'fan-out.html');
  const deliver = () => spawnSync(process.execPath, [path.join(root, 'bin/archify.mjs'), 'deliver', 'architecture', input, output, '--quality', 'showcase', '--json'], { encoding: 'utf8', timeout: 30000 });
  fs.writeFileSync(input, JSON.stringify(diagram));
  const failed = deliver();
  assert.notEqual(failed.status, 0);
  assert.ok(JSON.parse(failed.stdout).diagnostics.some(d => d.code === 'composition/label-route-clearance'));
  const fixed = await api.renderWithLayoutRepair('architecture', JSON.stringify(diagram), async (type, source) => {
    fs.writeFileSync(input, source);
    const child = deliver();
    const receipt = JSON.parse(child.stdout);
    return { ok: child.status === 0, html: child.status === 0 ? fs.readFileSync(output, 'utf8') : null, receipt, failureKind: child.status === 0 ? null : 'diagram' };
  });
  assert.equal(fixed.ok, true, JSON.stringify(fixed.receipt));
  assert.equal(fixed.repairs, 3);
  assert.match(fixed.html, /<svg/);
  const receipt = fixed.receipt;
  assert.equal(receipt.validation.checksPassed, 9);
  assert.equal(receipt.validation.errors, 0);
  assert.equal(receipt.validation.warnings, 0);
  const restored = JSON.parse(fixed.source);
  assert.deepEqual(restored.connections[1].labelAt, [410, 340]);
  assert.deepEqual(restored.connections[4].labelAt, [715, 340]);
  delete restored.connections[1].labelAt;
  delete restored.connections[4].labelAt;
  restored.meta.viewBox[0] = diagram.meta.viewBox[0];
  assert.deepEqual(restored, diagram, 'only the diagnosed geometry fields may change');
  assert.equal(require('node:crypto').createHash('sha256').update(fixed.source).digest('hex'), receipt.specification.sha256);
});

test('preview does not retry runtime failures or unrecognized layout diagnostics', async () => {
  for (const failureKind of ['runtime', 'diagram']) {
    let calls = 0;
    const result = await api.renderWithLayoutRepair('architecture', '{}', async () => {
      calls++;
      return { ok: false, html: null, failureKind, receipt: { error: 'failure', diagnostics: [{ code: 'unrecognized' }] } };
    });
    assert.equal(calls, 1);
    assert.equal(result.repairs, 0);
    assert.equal(result.ok, false);
  }
});
