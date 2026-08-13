import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const result = spawnSync(process.execPath, [join(root, "integrations", "agentos-3", "tests", "memory-authority-test.mjs")], {
  cwd: root,
  encoding: "utf8",
});
assert.equal(result.status, 0, `memory authority proof failed\n${result.stdout}\n${result.stderr}`);
assert.match(result.stdout, /PASS AgentOS 3 memory authority/u);
console.log("PASS AgentOS 3 memory-authority focused proof");
