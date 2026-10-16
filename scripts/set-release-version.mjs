import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function setReleaseVersion(tag, root) {
  // Accept stable versions and SemVer prereleases; reject paths and shell text.
  const core = '(0|[1-9]\\d*)';
  const identifier = '(?:0|[1-9]\\d*|[\\da-zA-Z-]*[a-zA-Z-][\\da-zA-Z-]*)';
  const pattern = new RegExp(`^v${core}\\.${core}\\.${core}(?:-${identifier}(?:\\.${identifier})*)?$`);
  if (typeof tag !== 'string' || !pattern.test(tag)) {
    throw new Error('Expected a version tag such as v0.1.0 or v0.2.0-beta.1');
  }
  const version = tag.slice(1);
  const changes = ['app/package.json', 'src-tauri/tauri.conf.json'].map(path => {
    const absolute = resolve(root, path);
    const data = JSON.parse(readFileSync(absolute, 'utf8'));
    data.version = version;
    return [absolute, `${JSON.stringify(data, null, 2)}\n`];
  });
  for (const path of ['src-tauri/Cargo.toml', 'src-tauri/Cargo.lock']) {
    const absolute = resolve(root, path);
    const source = readFileSync(absolute, 'utf8');
    const packageVersion = /(^name = "gold-earth"\r?\nversion = ")[^"]+(")/m;
    if (!packageVersion.test(source)) throw new Error(`Cannot find gold-earth version in ${path}`);
    changes.push([absolute, source.replace(packageVersion, (_, prefix, suffix) => `${prefix}${version}${suffix}`)]);
  }
  // Validate every input before changing any files.
  for (const [path, content] of changes) writeFileSync(path, content);
  return version;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  console.log(`Release version: ${setReleaseVersion(process.argv[2], root)}`);
}
