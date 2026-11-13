const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const moduleUnderTest = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/pages/BilibiliPage.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText, { module: moduleUnderTest, exports: moduleUnderTest.exports, URL, require: () => ({}) });
const parse = moduleUnderTest.exports.parseBilibiliUid;
test('accepts UID and official space links without numeric precision loss', () => {
  assert.equal(parse(' 12345678901234567890 '), '12345678901234567890');
  assert.equal(parse('https://space.bilibili.com/123/dynamic?x=1'), '123');
});
test('rejects unrelated hosts, invalid IDs and executable URLs', () => {
  for (const value of ['', '0', '-123', 'name', 'https://space.bilibili.com.evil.test/123', 'javascript:alert(1)', 'https://space.bilibili.com/nope']) assert.equal(parse(value), null);
});
