import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8");
const registered = read("../src/lib.rs").match(/generate_handler!\[([\s\S]*?)\]\)/)?.[1]
  .split(",").map(s => s.trim().split("::").pop()).filter(Boolean);
assert.ok(registered?.length, "Could not read registered application commands");
const build = new Set([...read("../build.rs").matchAll(/"([a-z_]+)"/g)].map(m => m[1]));
const permission = read("../permissions/app.toml").match(/commands\.allow\s*=\s*\[([\s\S]*?)\]/)?.[1] || "";
const allowed = new Set([...permission.matchAll(/"([a-z_]+)"/g)].map(m => m[1]));
for (const name of registered) {
  assert.ok(build.has(name), name + " is missing from the build manifest");
  assert.ok(allowed.has(name), name + " is missing from allow-app-commands");
}
const capability = JSON.parse(read("../capabilities/default.json"));
assert.ok(capability.windows.includes("main"));
assert.ok(capability.permissions.includes("allow-app-commands"));
assert.equal(capability.remote, undefined, "Application commands must not be granted to remote quote pages");
console.log("通过：" + registered.length + " 个命令的注册、构建清单、主窗口权限白名单一致，远程报价页无应用命令权限。");
