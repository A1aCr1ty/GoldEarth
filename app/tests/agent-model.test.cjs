const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const moduleRef = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/lib/agentModel.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { module: moduleRef, exports: moduleRef.exports });
const { readAgentModel, withoutAgentModel, withAgentModel } = moduleRef.exports;

test('a per-agent model replaces an old flag without altering the exec prompt or shared configuration', () => {
  const args = ['exec', '-m', 'old-model', '--json', '{prompt}'];
  const next = withAgentModel(args, 'gpt-6-luna');
  assert.equal(readAgentModel(next), 'gpt-6-luna');
  assert.deepEqual(Array.from(next), ['exec', '--json', '--model', 'gpt-6-luna', '{prompt}']);
  assert.deepEqual(args, ['exec', '-m', 'old-model', '--json', '{prompt}']);
});

test('editing can remove a model to inherit CLI defaults and keeps resume arguments intact', () => {
  const args = ['exec', 'resume', '--model=gpt-6-luna', 'session-id', '{prompt}'];
  assert.equal(readAgentModel(args), 'gpt-6-luna');
  assert.deepEqual(Array.from(withoutAgentModel(args)), ['exec', 'resume', 'session-id', '{prompt}']);
  assert.deepEqual(Array.from(withAgentModel(withoutAgentModel(args), '')), ['exec', 'resume', 'session-id', '{prompt}']);
});

test('literal arguments following -- are preserved and model overrides precede the separator', () => {
  const args = ['exec', '--', '-m', 'literal-prompt'];
  assert.equal(readAgentModel(args), '');
  assert.deepEqual(Array.from(withAgentModel(args, 'gpt-6-luna')), ['exec', '--model', 'gpt-6-luna', '--', '-m', 'literal-prompt']);
});
