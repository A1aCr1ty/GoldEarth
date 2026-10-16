import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setReleaseVersion } from './set-release-version.mjs';

test('tag versions update every application manifest and only the application lock entry', () => {
  const root = mkdtempSync(join(tmpdir(), 'goldearth-release-'));
  try {
    mkdirSync(join(root, 'app'));
    mkdirSync(join(root, 'src-tauri'));
    writeFileSync(join(root, 'app/package.json'), '{"version":"0.1.0"}');
    writeFileSync(join(root, 'src-tauri/tauri.conf.json'), '{"version":"0.1.0"}');
    writeFileSync(join(root, 'src-tauri/Cargo.toml'), '[package]\nname = "gold-earth"\nversion = "0.1.0"\n');
    writeFileSync(join(root, 'src-tauri/Cargo.lock'), '[[package]]\nname = "dependency"\nversion = "1.2.3"\n\n[[package]]\nname = "gold-earth"\nversion = "0.1.0"\n');
    for (const tag of ['v0.1.1', 'v1.0.0-beta.2']) {
      const version = setReleaseVersion(tag, root);
      for (const path of ['app/package.json', 'src-tauri/tauri.conf.json']) {
        assert.equal(JSON.parse(readFileSync(join(root, path), 'utf8')).version, version);
      }
      assert.ok(readFileSync(join(root, 'src-tauri/Cargo.toml'), 'utf8').includes(`version = "${version}"`));
      const lock = readFileSync(join(root, 'src-tauri/Cargo.lock'), 'utf8');
      assert.ok(lock.includes('name = "dependency"\nversion = "1.2.3"'));
      assert.ok(lock.includes(`name = "gold-earth"\nversion = "${version}"`));
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('invalid tags fail before writing files', () => {
  for (const tag of [undefined, 'master', 'v01.2.3', 'v1.2', 'v1.2.3-01', 'v1.2.3; echo secret']) {
    assert.throws(() => setReleaseVersion(tag, 'nonexistent'), /Expected a version tag/);
  }
});
