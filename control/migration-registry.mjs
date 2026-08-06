import {access, readFile, readdir} from "node:fs/promises";
import path from "node:path";
import {assert, digestWithout} from "./canonical-json.mjs";

export const MIGRATION_REGISTRY_SCHEMA = "agentos.migration_registry.v1";
export const MIGRATION_STATUSES = Object.freeze(["MIGRATED", "PARTIAL", "EXTERNAL_HOST_REQUIRED"]);

const SEAMS = Object.freeze([
  {seam_id: "GOVERNANCE_GRAPH", replacement_paths: ["control/canonical-json.mjs", "control/gate-dsl.mjs", "control/gate-model.mjs", "control/gate-engine.mjs"], evidence_test: "tests/verify-core.mjs", status: "MIGRATED"},
  {seam_id: "PORTABLE_PRIVACY_BOUNDARY", replacement_paths: ["control/portable-record.mjs", "control/opaque-reference.mjs", "control/workspace-boundary.mjs"], evidence_test: "tests/verify-portable-record.mjs", status: "MIGRATED"},
  {seam_id: "BOOTSTRAP_AND_CONVERSATION", replacement_paths: ["control/bootstrap-plan.mjs", "control/owner-conversation.mjs", "control/owner-continuation.mjs", "control/campaign-admission.mjs", "control/bootstrap-runtime.mjs", "control/agentos-3.mjs", "schemas/owner-continuation.v1.json", "schemas/agentos3-launch.v1.json"], evidence_test: "tests/verify-agentos-3.mjs", status: "MIGRATED"},
  {seam_id: "ROLE_GOVERNANCE", replacement_paths: ["control/role-packet.mjs", "control/role-library.mjs"], evidence_test: "tests/verify-role-library.mjs", status: "MIGRATED"},
  {seam_id: "CAMPAIGN_ORCHESTRATION", replacement_paths: ["control/campaign-admission.mjs", "control/campaign-orchestrator.mjs", "control/campaign-records.mjs", "control/campaign-prompts.mjs", "control/campaign-runner.mjs", "control/campaign-state.mjs"], evidence_test: "tests/verify-campaign-orchestrator.mjs", status: "MIGRATED"},
  {seam_id: "NATIVE_SESSION_LIFECYCLE", replacement_paths: ["control/native-session.mjs", "control/native-host-attachment.mjs", "control/native-host-loader.mjs", "control/host-worker-boundary.mjs", "schemas/native-host-attachment.v1.json", "schemas/host-worker-boundary.v1.json"], evidence_test: "tests/verify-bootstrap-runtime.mjs", status: "EXTERNAL_HOST_REQUIRED"},
  {seam_id: "PERSISTENT_CONTROL", replacement_paths: ["control/intent-regulator.mjs", "control/persistent-role.mjs", "control/runtime-authority.mjs"], evidence_test: "tests/verify-intent-regulator.mjs", status: "MIGRATED"},
  {seam_id: "PROGRESS_AND_REASSESSMENT", replacement_paths: ["control/campaign-state.mjs", "control/intent-regulator.mjs"], evidence_test: "tests/verify-campaign-state.mjs", status: "MIGRATED"},
  {seam_id: "OWNER_ACCEPTANCE", replacement_paths: ["control/owner-conversation.mjs", "control/owner-continuation.mjs", "control/campaign-admission.mjs", "control/bootstrap-runtime.mjs", "control/campaign-runner.mjs"], evidence_test: "tests/verify-bootstrap-runtime.mjs", status: "MIGRATED"},
  {seam_id: "DELIVERY_CLOSURE", replacement_paths: ["control/delivery-closure.mjs", "control/live-closure.mjs", "control/runtime-authority.mjs", "schemas/delivery-choice.v1.json", "schemas/live-closure.v1.json", "schemas/repository-checkpoint.v1.json", "schemas/live-deployment-receipt.v1.json", "schemas/live-audit-receipt.v1.json"], evidence_test: "tests/verify-delivery-closure.mjs", status: "EXTERNAL_HOST_REQUIRED"},
  {seam_id: "TWELVE_LANE_EXECUTION", replacement_paths: ["control/campaign-orchestrator.mjs", "control/campaign-runner.mjs"], evidence_test: "tests/verify-full-native-campaign.mjs", status: "EXTERNAL_HOST_REQUIRED"},
  {seam_id: "LEGACY_AGENTOS_CONTROLLER", replacement_paths: ["control/intent-regulator.mjs", "control/campaign-orchestrator.mjs", "control/campaign-admission.mjs", "control/persistent-role.mjs", "control/runtime-authority.mjs"], evidence_test: "tests/verify-legacy-boundary-extraction.mjs", status: "MIGRATED"},
  {seam_id: "LEGACY_BOOTSTRAP_COMPILER", replacement_paths: ["control/bootstrap-plan.mjs", "control/owner-conversation.mjs", "control/campaign-admission.mjs"], evidence_test: "tests/verify-legacy-boundary-extraction.mjs", status: "MIGRATED"},
  {seam_id: "LEGACY_BOOTSTRAP_COVERAGE", replacement_paths: ["control/bootstrap-plan.mjs", "control/role-library.mjs", "governance/general-manifest.json", "governance/lane-manifest.json"], evidence_test: "tests/verify-legacy-boundary-extraction.mjs", status: "MIGRATED"},
  {seam_id: "LEGACY_CAMPAIGN_LIFECYCLE", replacement_paths: ["control/campaign-state.mjs", "control/campaign-orchestrator.mjs", "control/campaign-runner.mjs", "control/live-closure.mjs"], evidence_test: "tests/verify-legacy-boundary-extraction.mjs", status: "MIGRATED"},
  {seam_id: "LEGACY_CAMPAIGN_CASCADE", replacement_paths: ["control/campaign-orchestrator.mjs", "control/campaign-runner.mjs", "control/delivery-closure.mjs", "control/live-closure.mjs"], evidence_test: "tests/verify-legacy-boundary-extraction.mjs", status: "MIGRATED"},
  {seam_id: "LEGACY_NATIVE_SESSION_TEAM", replacement_paths: ["control/native-session.mjs", "control/native-host-attachment.mjs", "control/native-host-loader.mjs"], evidence_test: "tests/verify-legacy-boundary-extraction.mjs", status: "MIGRATED"},
  {seam_id: "LEGACY_OWNER_REVIEW", replacement_paths: ["control/owner-conversation.mjs", "control/campaign-runner.mjs", "control/delivery-closure.mjs"], evidence_test: "tests/verify-legacy-boundary-extraction.mjs", status: "MIGRATED"},
  {seam_id: "LEGACY_LOCAL_AGENT_WORKER", replacement_paths: ["control/campaign-admission.mjs", "control/campaign-runner.mjs", "control/native-session.mjs"], evidence_test: "tests/verify-legacy-boundary-extraction.mjs", status: "MIGRATED"},
  {seam_id: "LEGACY_SUPERVISOR", replacement_paths: ["control/intent-regulator.mjs", "control/campaign-state.mjs", "control/campaign-orchestrator.mjs"], evidence_test: "tests/verify-legacy-boundary-extraction.mjs", status: "MIGRATED"},
]);
const slash = String.fromCharCode(47);
const backslash = String.fromCharCode(92);

function pathSegments(value) {
  return value.split(slash).flatMap((item) => item.split(backslash));
}

function exactKeys(value, expected, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort()), `${label} fields mismatch`);
}

function safeRelativePath(value, label) {
  assert(typeof value === "string" && value.length > 0 && !path.isAbsolute(value), `${label} must be a relative path`);
  assert(!pathSegments(value).includes(".."), `${label} may not escape the milestone`);
}

export function compileMigrationRegistry() {
  const registry = {
    schema: MIGRATION_REGISTRY_SCHEMA,
    version: 1,
    status: "PREPARED_NOT_ACTIVATED",
    max_control_module_lines: 320,
    seams: SEAMS.map((seam) => ({...seam, replacement_paths: [...seam.replacement_paths]})),
    digest: null,
  };
  registry.digest = digestWithout(registry, "digest");
  return validateMigrationRegistry(registry);
}

export function validateMigrationRegistry(registry) {
  exactKeys(registry, ["schema", "version", "status", "max_control_module_lines", "seams", "digest"], "migration registry");
  assert(registry.schema === MIGRATION_REGISTRY_SCHEMA && registry.version === 1, "migration registry identity is invalid");
  assert(registry.status === "PREPARED_NOT_ACTIVATED", "migration registry must remain prepared");
  assert(Number.isInteger(registry.max_control_module_lines) && registry.max_control_module_lines > 0, "migration line limit is invalid");
  assert(Array.isArray(registry.seams) && registry.seams.length === SEAMS.length, "migration seam list is incomplete");
  const ids = new Set();
  for (const [index, seam] of registry.seams.entries()) {
    exactKeys(seam, ["seam_id", "replacement_paths", "evidence_test", "status"], `migration seam ${index}`);
    assert(typeof seam.seam_id === "string" && seam.seam_id.length > 0 && !ids.has(seam.seam_id), `migration seam ${index} ID is invalid or duplicated`);
    ids.add(seam.seam_id);
    assert(Array.isArray(seam.replacement_paths) && seam.replacement_paths.length > 0, `migration seam ${seam.seam_id} has no replacement paths`);
    seam.replacement_paths.forEach((item) => safeRelativePath(item, `${seam.seam_id}.replacement_path`));
    safeRelativePath(seam.evidence_test, `${seam.seam_id}.evidence_test`);
    assert(MIGRATION_STATUSES.includes(seam.status), `${seam.seam_id} status is invalid`);
  }
  assert(ids.size === SEAMS.length, "migration seam IDs are not unique");
  assert(JSON.stringify([...ids].sort()) === JSON.stringify(SEAMS.map((seam) => seam.seam_id).sort()), "migration seam inventory differs from the canonical registry");
  assert(/^[0-9a-f]{64}$/u.test(registry.digest) && registry.digest === digestWithout(registry, "digest"), "migration registry digest does not match content");
  return registry;
}

export async function verifyMigrationRegistry(root, registry = compileMigrationRegistry()) {
  validateMigrationRegistry(registry);
  for (const seam of registry.seams) {
    for (const relativePath of [...seam.replacement_paths, seam.evidence_test]) {
      await access(path.join(root, relativePath));
    }
  }
  const controlRoot = path.join(root, "control");
  const entries = await readdir(controlRoot, {withFileTypes: true});
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".mjs")) continue;
    const lines = (await readFile(path.join(controlRoot, entry.name), "utf8")).split(/\r?\n/u).length - 1;
    assert(lines <= registry.max_control_module_lines, `control/${entry.name} remains an oversized monolithic boundary`);
  }
  return registry;
}
