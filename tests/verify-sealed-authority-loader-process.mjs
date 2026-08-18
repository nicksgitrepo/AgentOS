#!/usr/bin/env node

import assert from "node:assert/strict";
import {execFileSync, spawnSync} from "node:child_process";
import {resolve} from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const moduleUrl = new URL("../control/sealed-canonical-authority.mjs", import.meta.url).href;
const expected = JSON.parse(execFileSync(process.execPath, ["-e", `import(${JSON.stringify(moduleUrl)}).then(m=>console.log(JSON.stringify(m.sealedAuthorityIdentity(m.getSealedCanonicalAuthority()))))`], {cwd: root, encoding: "utf8"}));

for (const patch of [
  `const fs=(await import('node:fs')).default; fs.readFileSync=()=>Buffer.from('{"attacker":true}');`,
  `const fs=(await import('node:fs')).default; fs.readFileSync=()=>Buffer.from('{"attacker":true}'); (await import('node:module')).syncBuiltinESMExports();`,
  `const cp=(await import('node:child_process')).default; cp.execFileSync=()=>'{"attacker":true}';`,
]) {
  const source = `${patch} const m=await import(${JSON.stringify(moduleUrl)}); console.log(JSON.stringify(m.sealedAuthorityIdentity(m.getSealedCanonicalAuthority())));`;
  const actual = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", source], {cwd: root, encoding: "utf8"}));
  assert.deepEqual(actual, expected);
}

const hook = spawnSync(process.execPath, ["-e", `import(${JSON.stringify(moduleUrl)}).then(m=>m.getSealedCanonicalAuthority())`], {cwd: root, encoding: "utf8", env: {...process.env, NODE_OPTIONS: "--no-warnings"}});
assert.notEqual(hook.status, 0);
assert.match(hook.stderr, /NODE_OPTIONS|runtime.*hook/iu);
console.log("PASS sealed authority loader process: default/named fs and child-process monkeypatches cannot substitute authority bytes, while preload-capable runtime configuration fails closed");
