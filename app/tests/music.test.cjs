const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const m = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/lib/music.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { module: m, exports: m.exports });
const M = m.exports;
test('queue wraps in both directions and starts from the first available track', () => {
  assert.equal(M.nextTrackId([], null, 'loop'), null);
  assert.equal(M.nextTrackId(['a', 'b', 'c'], null, 'loop'), 'a');
  assert.equal(M.nextTrackId(['a', 'b', 'c'], 'c', 'loop'), 'a');
  assert.equal(M.nextTrackId(['a', 'b', 'c'], 'a', 'loop', -1), 'c');
  assert.equal(M.nextTrackId(['a'], 'a', 'loop'), 'a');
  assert.equal(M.nextTrackId(['b', 'c'], 'removed', 'loop'), 'b');
});
test('single repeat keeps the ended song but manual next still advances', () => {
  assert.equal(M.nextTrackId(['a', 'b'], 'a', 'single', 1, true), 'a');
  assert.equal(M.nextTrackId(['a', 'b'], 'a', 'single', 1, false), 'b');
});
test('shuffle never immediately repeats when other tracks exist', () => {
  for (const random of [0, 0.3, 0.99]) {
    assert.notEqual(M.nextTrackId(['a', 'b', 'c'], 'b', 'shuffle', 1, true, () => random), 'b');
  }
  assert.equal(M.nextTrackId(['a'], 'a', 'shuffle'), 'a');
});
test('filenames preserve Chinese titles and format, and invalid time stays readable', () => {
  assert.equal(M.musicFileInfo('歌手 - 歌名 - 现场版.FLAC').title, '歌名 - 现场版');
  assert.equal(M.musicFileInfo('歌手 - 歌名.mp3').artist, '歌手');
  assert.equal(M.musicFileInfo('纯音乐.wav').artist, '未知歌手');
  assert.equal(M.musicFileInfo('纯音乐.wav').format, 'WAV');
  assert.equal(M.musicTime(125.9), '02:05');
  assert.equal(M.musicTime(Infinity), '00:00');
  assert.equal(M.musicTime(-1), '00:00');
});
