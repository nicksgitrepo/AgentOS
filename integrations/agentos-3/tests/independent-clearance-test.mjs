import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { reviewAgentBuilderUtilityHarm } from "../tools/review-agent-builder-utility-harm.mjs";
import { reviewSpecialistUtilityHarm } from "../tools/review-specialist-utility-harm.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (path) => JSON.parse(await readFile(join(ROOT, path), "utf8"));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const agentBuilderExpected = await readJson("contracts/agent-builder-independent-clearance.v1.json");
const specialistLegacy = await readJson("contracts/specialist-independent-clearance.v1.json");
assert.deepEqual(reviewAgentBuilderUtilityHarm(), agentBuilderExpected);
assert.deepEqual(reviewSpecialistUtilityHarm({ repositoryRoot: join(ROOT, "..", "..") }), specialistLegacy);
assert.equal(agentBuilderExpected.status, "PASS_FOR_INACTIVE_TEST_BUILD_INTAKE");
assert.equal(specialistLegacy.status, "LEGACY_LOCAL_REVIEW_EXCLUDED_NOT_VALID_FOR_CURRENT_INTAKE");
assert.match(agentBuilderExpected.authority, /NO_ADMISSION_ACTIVATION_DEPLOYMENT_OR_RELEASE_AUTHORITY/u);
const packageManifest = await readJson("agent-builder/package-manifest.json");
for (const entry of packageManifest.included_entries) {
  const bytes = await readFile(join(ROOT, "agent-builder", entry.path));
  assert.equal(bytes.length, entry.size, `Agent Builder package size mismatch: ${entry.path}`);
  assert.equal(digest(bytes), entry.sha256, `Agent Builder package digest mismatch: ${entry.path}`);
}
console.log("PASS independent clearance: Agent Builder package and 14 utility/harm cases are digest-bound; Specialist Gate Library remains external and not received");
