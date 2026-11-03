const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(path, dependencies = {}, globals = {}) {
  const m = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve(path), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { module: m, exports: m.exports, require: name => {
    if (name in dependencies) return dependencies[name];
    throw Error(name);
  }, URL, URLSearchParams, Blob, AbortSignal, Uint8Array, ArrayBuffer, ...globals });
  return m.exports;
}
const api = load('../src/lib/onlineMusic.ts', { '@tauri-apps/api/core': { isTauri: () => false } });
const catalog = load('../src/lib/musicCatalog.ts', { '@tauri-apps/api/core': { isTauri: () => false }, './onlineMusic': api });
function page(id = 10, extra = {}) {
  return { pageid: id, title: 'File:Piano.ogg', index: id, imageinfo: [{
    url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Piano.ogg',
    mime: 'audio/ogg', size: 1024, duration: 65,
    extmetadata: { Artist: { value: '<a href="x">Artist &amp; Band</a>' }, LicenseShortName: { value: 'CC BY-SA 4.0' } },
    ...extra,
  }] };
}

test('online results keep playable files, source attribution, search order and continuation', () => {
  const response = api.parseOnlineMusic({ query: { pages: { 20: page(20), 10: page(10) } }, continue: { gsroffset: 20 } });
  assert.equal(response.items.length, 2);
  assert.equal(response.items[0].pageId, 10);
  assert.equal(response.items[0].artist, 'Artist & Band');
  assert.equal(response.items[0].license, 'CC BY-SA 4.0');
  assert.equal(response.items[0].pageUrl, 'https://commons.wikimedia.org/w/index.php?curid=10');
  assert.equal(response.nextOffset, 20);
  assert.equal(api.onlineMusicId(response.items[0]), 'commons:10');
});

test('bad hosts, video files, oversized files and missing metadata cannot be imported', () => {
  const bad = [page(1, { url: 'https://upload.wikimedia.org.evil.test/music.ogg' }),
    page(2, { url: 'http://upload.wikimedia.org/wikipedia/commons/a/x.ogg' }),
    page(3, { mime: 'video/ogg' }), page(4, { size: api.MAX_ONLINE_AUDIO_BYTES + 1 }),
    page(5, { size: 0 }), { pageid: 6 }];
  assert.equal(api.parseOnlineMusic({ query: { pages: Object.fromEntries(bad.map(p => [p.pageid, p])) } }).items.length, 0);
  assert.equal(api.parseOnlineMusic({ batchcomplete: '' }).items.length, 0);
  assert.throws(() => api.parseOnlineMusic({ error: { info: 'bad search' } }));
  assert.throws(() => api.parseOnlineMusic('<html>not json</html>'));
  assert.equal(api.isAudioBytes(new Uint8Array(Buffer.from('<html>error</html>'))), false);
  assert.equal(api.isAudioBytes(new Uint8Array(Buffer.from('OggSdata'))), true);
});

function storeHarness(download = async () => new Blob(['OggSdata'])) {
  const saved = [];
  const { useMusic } = load('../src/store/music.ts', {
    zustand: { create: require('zustand').create },
    '@/lib/music': { readMusic: async () => [], saveMusic: async tracks => saved.push(...tracks) },
    '@/lib/onlineMusic': { onlineMusicId: api.onlineMusicId, downloadOnlineMusic: download },
    '@/lib/musicCatalog': { downloadCatalogMusic: download, musicProviderName: catalog.musicProviderName },
  });
  return { store: useMusic, saved };
}

test('downloaded audio is saved with attribution and importing it twice creates no duplicate', async () => {
  let count = 0;
  const { store, saved } = storeHarness(async () => { count++; return new Blob(['OggSdata']); });
  const item = api.parseOnlineMusic({ query: { pages: { 10: page() } } }).items[0];
  await store.getState().importOnline(item);
  await store.getState().importOnline(item);
  assert.equal(count, 1);
  assert.equal(store.getState().tracks.length, 1);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].source.license, 'CC BY-SA 4.0');
  assert.equal(saved[0].duration, 65);
  assert.equal(saved[0].size, 8);
  assert.equal(store.getState().importing, false);
});

test('failed downloads do not add broken library entries and allow retry', async () => {
  const { store, saved } = storeHarness(async () => { throw Error('network unavailable'); });
  await assert.rejects(store.getState().importOnline({ pageId: 10 }), /network unavailable/);
  assert.equal(store.getState().tracks.length, 0);
  assert.equal(saved.length, 0);
  assert.equal(store.getState().importing, false);
});

test('overlapping imports cannot duplicate downloads or overwrite the busy flag', async () => {
  let finish;
  const { store } = storeHarness(() => new Promise(resolve => { finish = resolve; }));
  const item = api.parseOnlineMusic({ query: { pages: { 10: page() } } }).items[0];
  const first = store.getState().importOnline(item);
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(store.getState().importOnline(item), /正在导入/);
  assert.equal(store.getState().importing, true);
  finish(new Blob(['OggSdata']));
  await first;
  assert.equal(store.getState().tracks.length, 1);
});

test('Audius only exposes available free full streams, excluding gated, deleted and inaccessible music', () => {
  const free = { id: 'Ab123', title: 'A Song', user: { name: 'Artist' }, duration: 120, is_available: true,
    is_streamable: true, is_stream_gated: false, access: { stream: true }, permalink: '/artist/song', license: 'All rights reserved' };
  const result = catalog.parseAudiusMusic({ data: [free, { ...free, id: 'Paid', is_stream_gated: true },
    { ...free, id: 'Locked', access: { stream: false } }, { ...free, id: 'Gone', is_available: false },
    { ...free, id: 'Deleted', is_delete: true }, { ...free, id: 'Preview', is_streamable: false }] });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].downloadable, false);
  assert.equal(api.onlineMusicId(result.items[0]), 'audius:Ab123');
  assert.equal(result.items[0].streamUrl, 'https://api.audius.co/v1/tracks/Ab123/stream?app_name=GoldEarth');
});

test('Archive search chooses one audio format per recording and rejects restricted or unlicensed files', () => {
  const record = { metadata: { identifier: 'test-music', creator: ['Artist A', 'Artist B'], licenseurl: 'https://creativecommons.org/licenses/by-nc/4.0/' },
    files: [{ name: 'song.flac', size: '10000', title: 'Song' }, { name: 'song.mp3', original: 'song.flac', size: '2000', title: 'Song', length: '03:12' },
      { name: 'secret.mp3', private: 'true', size: 1000 }, { name: 'huge.wav', size: api.MAX_ONLINE_AUDIO_BYTES + 1 }] };
  const result = catalog.parseArchiveMusic({ records: [record], nextOffset: 6 });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].format, 'MP3');
  assert.equal(result.items[0].duration, 192);
  assert.equal(result.items[0].artist, 'Artist A / Artist B');
  assert.equal(result.items[0].license, 'CC BY-NC 4.0');
  assert.equal(result.nextOffset, 6);
  assert.equal(catalog.parseArchiveMusic({ records: [{ ...record, metadata: { ...record.metadata, nodownload: 'true' } }] }).items.length, 0);
  assert.equal(catalog.parseArchiveMusic({ records: [{ ...record, metadata: { ...record.metadata, licenseurl: null } }] }).items.length, 0);
});

test('stream-only songs persist as online entries without downloading audio or trusting supplied URLs', async () => {
  let downloads = 0;
  const { store, saved } = storeHarness(async () => { downloads++; throw Error('should not download'); });
  const item = { provider: 'audius', sourceId: 'Ab123', pageId: 0, title: 'Free song', artist: 'Artist', filename: 'Free song.mp3', format: 'MP3',
    duration: 120, downloadable: false, streamUrl: 'https://untrusted.example/audio.mp3', pageUrl: 'https://audius.co/artist/song', license: 'All rights reserved' };
  await store.getState().importOnline(item);
  assert.equal(downloads, 0);
  assert.equal(saved[0].blob, null);
  assert.equal(saved[0].streamUrl, 'https://api.audius.co/v1/tracks/Ab123/stream?app_name=GoldEarth');
  assert.equal(saved[0].source.name, 'Audius');
});
