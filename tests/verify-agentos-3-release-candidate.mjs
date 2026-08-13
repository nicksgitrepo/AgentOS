import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = (relativePath, env = {}) => {
  const result = spawnSync(process.execPath, [join(root, relativePath)], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${relativePath} failed\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
};

const independent = run("integrations/agentos-3/tests/independent-clearance-test.mjs");
const memoryAuthority = run("integrations/agentos-3/tests/memory-authority-test.mjs");
const integrated = run("integrations/agentos-3/tests/integration-test.mjs", { AGENTOS_MAIN_SOURCE_ROOT: join(root, "control") });
const realHost = run("integrations/agentos-3/tests/real-host-proof.mjs");
assert.match(independent, /PASS independent clearance/u);
assert.match(memoryAuthority, /PASS AgentOS 3 memory authority/u);
assert.match(integrated, /AGENTOS_3_TEST_PROOF PASS/u);
assert.match(realHost, /AGENTOS_3_REAL_HOST_PROOF PASS/u);
console.log("PASS AgentOS 3.0 inactive candidate: existing independent clearances, memory-authority P0 self-test, combined integration, and real-host zero-trace proof; memory-authority independent clearance remains pending");
