import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { reviewAgentBuilderUtilityHarm } from "../tools/review-agent-builder-utility-harm.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (path) => JSON.parse(await readFile(join(ROOT, path), "utf8"));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const [agentBuilderExpected, specialistExpected] = await Promise.all([
  readJson("contracts/agent-builder-independent-clearance.v1.json"),
  readJson("contracts/specialist-independent-clearance.v1.json"),
]);
assert.deepEqual(reviewAgentBuilderUtilityHarm(), agentBuilderExpected);
// The specialist receipt belongs to this frozen integration candidate.  It is
// historical evidence only and must not be recomputed from the evolving
// canonical specialist library or treated as current permanent-role admission.
assert.equal(agentBuilderExpected.status, "PASS_FOR_INACTIVE_TEST_BUILD_INTAKE");
assert.equal(specialistExpected.status, "PASS_PENDING_INTEGRATION_INTAKE");
assert.match(agentBuilderExpected.authority, /NO_ADMISSION_ACTIVATION_DEPLOYMENT_OR_RELEASE_AUTHORITY/u);
assert.match(specialistExpected.authority, /NO_ADMISSION_ACTIVATION_DEPLOYMENT_OR_RELEASE_AUTHORITY/u);
const packageManifest = await readJson("agent-builder/package-manifest.json");
for (const entry of packageManifest.included_entries) {
  const bytes = await readFile(join(ROOT, "agent-builder", entry.path));
  assert.equal(bytes.length, entry.size, `Agent Builder package size mismatch: ${entry.path}`);
  assert.equal(digest(bytes), entry.sha256, `Agent Builder package digest mismatch: ${entry.path}`);
}
console.log("PASS independent clearance: Agent Builder package is rechecked; the frozen specialist receipt is historical, read-only, and grants no current admission");
