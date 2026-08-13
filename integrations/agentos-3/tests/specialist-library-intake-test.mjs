import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertSpecialistLibraryExternalContract } from "../bootstrap.mjs";
import { compileSpecialistLibraryIntakeState, specialistLibraryIntakeDigest, validateSpecialistLibraryIntake } from "../specialist-library-intake.mjs";

const INTEGRATION_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const REPOSITORY_ROOT = join(INTEGRATION_ROOT, "..", "..");
const binding = JSON.parse(await readFile(join(INTEGRATION_ROOT, "contracts", "specialist-library-intake-binding.v1.json"), "utf8"));
const bindingBody = structuredClone(binding);
delete bindingBody.binding_sha256;
assert.equal(binding.binding_sha256, specialistLibraryIntakeDigest(bindingBody));
for (const entry of binding.entries) {
  const bytes = await readFile(join(REPOSITORY_ROOT, entry.path));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256, `specialist intake binding mismatch: ${entry.path}`);
}
const integrationContract = JSON.parse(await readFile(join(INTEGRATION_ROOT, "contracts", "agentos-3-integration.v1.json"), "utf8"));
assert.equal(assertSpecialistLibraryExternalContract(integrationContract).admission, "NOT_ADMITTED");
for (const mutate of [
  (value) => { value.components.find((component) => component.id === "specialist-block-library").admission = "ACCEPTED"; },
  (value) => { value.components.push(structuredClone(value.components.find((component) => component.id === "specialist-block-library"))); },
]) {
  const hostile = structuredClone(integrationContract);
  mutate(hostile);
  assert.throws(() => assertSpecialistLibraryExternalContract(hostile), /SPECIALIST_LIBRARY_CONTRACT_NOT_EXTERNAL_AND_INACTIVE/u);
}

const commit = "a".repeat(40);
const tree = "b".repeat(40);
const packet = {
  schema: "agentos.specialist_library_intake_handoff.v1",
  version: 1,
  status: "SPECIALIST_GATE_LIBRARY_READY_FOR_AGENTOS_INTAKE",
  lifecycle: "CANDIDATE_INACTIVE",
  activation: "OFF",
  candidate: {commit, tree, manifest_sha256: "c".repeat(64), roster_sha256: "d".repeat(64)},
  truth: {address_count: 621, compileable_count: 17, planned_count: 603, not_applicable_count: 1, dependency_complete: true},
  artifacts: {
    manifest_path: "registry/intake-manifest.v1.json",
    roster_path: "registry/roster.v1.json",
    coverage_path: "registry/coverage.v1.json",
    migration_path: "registry/migration.v1.json",
    invalidation_path: "registry/invalidation.v1.json",
  },
  proof: {focused_tests_sha256: "e".repeat(64), independent_clearance_sha256: "f".repeat(64), remote_readback_commit: commit, remote_readback_tree: tree},
  authority: {self_admission: false, product_mutation: false, activation: false, merge: false},
  intake_sha256: null,
};
packet.intake_sha256 = specialistLibraryIntakeDigest({...packet, intake_sha256: null});

const absent = compileSpecialistLibraryIntakeState();
assert.equal(absent.intake_status, "NOT_RECEIVED");
assert.equal(absent.admitted, false);
assert.equal(absent.accepted_candidate, null);
assert.deepEqual(absent.authority_effect_grants, []);

assert.equal(validateSpecialistLibraryIntake(packet).truth.compileable_count, 17);
const verified = compileSpecialistLibraryIntakeState(packet);
assert.equal(verified.intake_status, "PACKET_VERIFIED_PENDING_INDEPENDENT_AGENTOS_ADMISSION");
assert.equal(verified.admitted, false);
assert.equal(verified.accepted_candidate.commit, commit);

for (const mutate of [
  (value) => { value.activation = "ON"; },
  (value) => { value.truth.planned_count = 602; },
  (value) => { value.truth.dependency_complete = false; },
  (value) => { value.authority.self_admission = true; },
  (value) => { value.proof.remote_readback_commit = "1".repeat(40); },
  (value) => { value.artifacts.roster_path = "../escape"; },
  (value) => { value.intake_sha256 = "0".repeat(64); },
]) {
  const hostile = structuredClone(packet);
  mutate(hostile);
  assert.throws(() => validateSpecialistLibraryIntake(hostile), /SPECIALIST_LIBRARY_INTAKE_/u);
}

console.log("PASS AgentOS 3 specialist-library intake: external NOT_RECEIVED, contract-bound inactivity, truthful typed packet, and nine hostile denials");
