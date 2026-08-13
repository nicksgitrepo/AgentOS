import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (path) => JSON.parse(readFileSync(join(root, path), "utf8"));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const inventory = readJson("docs/feature-inventory.v1.json");
const receipt = readJson("integrations/agentos-3/contracts/test-build-receipt.json");
const contract = readJson("integrations/agentos-3/contracts/agentos-3-integration.v1.json");
const manifestPath = join(root, "integrations/agentos-3/dist/AGENTOS_3_TEST_BUILD.manifest.json");
const bundlePath = join(root, "integrations/agentos-3/dist/AGENTOS_3_TEST_BUILD.bundle.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

assert.equal(inventory.features.length, 37);
assert.equal(inventory.governance_lanes.length, 12);
assert.equal(inventory.platform_lanes.length, 3);
for (const item of [...inventory.features, ...inventory.governance_lanes, ...inventory.platform_lanes]) {
  assert.ok(existsSync(join(root, item.report_path)), `${item.feature_id ?? item.lane_id} report is missing`);
}
for (const feature of inventory.features) {
  for (const source of feature.sources) {
    if (source === "research-records-linked-by-owner") continue;
    assert.ok(existsSync(join(root, source)), `${feature.feature_id} source is missing: ${source}`);
  }
}
assert.equal(receipt.disposition, "INDEPENDENTLY_CLEARED_REAL_HOST_TESTABLE_RELEASE_CANDIDATE");
assert.equal(receipt.proof.real_host_new_project, "PASS_INSTALLED_BOOTSTRAP_READ_ONLY_ZERO_TRACE_ROLLBACK");
assert.equal(receipt.proof.real_host_import_adoption, "PASS_INSTALLED_BOOTSTRAP_READ_ONLY_ZERO_TRACE_ROLLBACK");
assert.equal(receipt.proof.memory_authority, "PASS_M2_ONLY_EXPOSED_ROOT_PROJECT_MEMORY_PRESERVED_OFF");
assert.equal(receipt.proof.specialist_roster_materialization, "PASS_620_COMPILEABLE_ONE_PROTECTED_EXTERNAL");
assert.equal(contract.lifecycle, "CANDIDATE_INACTIVE");
assert.equal(contract.activation, "OFF");
assert.ok(!contract.proof_ceiling.includes("independent_utility_harm_evaluation"));
assert.ok(contract.proof_ceiling.includes("provider_model_quality_evaluation_at_activation"));
assert.ok(!contract.proof_ceiling.includes("real_host_new_project"));
assert.ok(manifest.entries.length > 0, "release manifest has no entries");
const manifestPaths = manifest.entries.map((entry) => entry.path);
assert.equal(new Set(manifestPaths).size, manifestPaths.length, "release manifest has duplicate paths");
assert.deepEqual(manifestPaths, [...manifestPaths].sort(), "release manifest paths are not deterministic");
assert.equal(manifest.source_base, manifest.release_source.source_commit);
assert.equal(manifest.source_tree, manifest.release_source.source_tree);
assert.equal(manifest.release_source.status, "EXACT_SOURCE_OR_GENERATED_DESCENDANT");
assert.deepEqual(manifest.release_source.non_generated_drift, []);
assert.equal(manifest.activation, "OFF");
assert.equal(manifest.lifecycle, "CANDIDATE_INACTIVE");
assert.equal(manifest.bundle_sha256, digest(readFileSync(bundlePath)));

console.log("PASS AgentOS 3.0 completion coverage: 37 capabilities, 12 governance lanes, 3 platform projections, real-host zero-trace proof, inactive release boundary");
