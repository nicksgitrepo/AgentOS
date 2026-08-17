#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import {
  compileIndependentClearanceApplicability,
  INDEPENDENT_CLEARANCE_APPLICABILITY_ACTIONS,
  INDEPENDENT_CLEARANCE_APPLICABILITY_DECISIONS,
  INDEPENDENT_CLEARANCE_APPLICABILITY_PHASES,
  validateIndependentClearanceApplicability,
} from "../control/independent-clearance-applicability.mjs";

const schema = JSON.parse(fs.readFileSync(new URL("../schemas/independent-clearance-applicability.v1.json", import.meta.url), "utf8"));
assert.equal(schema.properties.schema.const, "agentos.independent_clearance_applicability.v1");
assert.deepEqual(schema.properties.phase.enum, INDEPENDENT_CLEARANCE_APPLICABILITY_PHASES);
assert.deepEqual(schema.properties.decision.enum, INDEPENDENT_CLEARANCE_APPLICABILITY_DECISIONS);
assert.deepEqual(schema.properties.action.enum, INDEPENDENT_CLEARANCE_APPLICABILITY_ACTIONS);
assert.deepEqual(schema.required, [
  "schema", "version", "applicability_id", "phase", "decision", "action", "independent_clearance_required",
  "protected_event_id", "facts", "evidence_sha256", "evidence_ceiling", "restart_event", "invalidation_rule",
  "hostile_fixture_refs", "applicability_sha256",
]);

const base = {
  applicabilityId: "APPLICABILITY.INDEPENDENT_CLEARANCE.SYNTHETIC",
  phase: "COMPILER_ONLY_LOCAL_QA_IMPORT_PLANNING",
  spawnerMode: "COMPILER_ONLY",
  temporaryWorkerAdmission: false,
  spawnAuthority: false,
  waveActivation: "OFF",
  productMutation: false,
  providerAccess: false,
  credentialAccess: false,
  externalSync: false,
  materialSpendAuthorized: false,
  destructiveWorkAuthorized: false,
  liveProviderWorkflow: false,
  activeWorkerCount: 0,
  schedulerJobCount: 0,
  heavyweightProcessCount: 0,
  timerCount: 0,
  polling: false,
};

const local = compileIndependentClearanceApplicability(base);
validateIndependentClearanceApplicability(local);
assert.equal(local.decision, "NOT_APPLICABLE_LOCAL_COMPILER_QA");
assert.equal(local.action, "CONTINUE_LOCAL_COMPILER_QA");
assert.equal(local.independent_clearance_required, false);
assert.equal(local.protected_event_id, null);

const isolated = compileIndependentClearanceApplicability({
  ...base,
  applicabilityId: "APPLICABILITY.INDEPENDENT_CLEARANCE.ISOLATED_AUDIT",
  phase: "ISOLATED_LOCAL_AUDIT_REPAIR",
  spawnerMode: "GOVERNED_SPAWN",
  temporaryWorkerAdmission: true,
  spawnAuthority: true,
  isolatedWorktreeCustody: true,
  sourceRootsPreserved: true,
  sharedWorkspaceReadOnly: true,
  activeLaneCount: 6,
  activeWorkerCount: 6,
  schedulerJobCount: 6,
  heavyweightProcessCount: 1,
  heavyweightProcessLimit: 1,
});
validateIndependentClearanceApplicability(isolated);
assert.equal(isolated.decision, "NOT_APPLICABLE_LOCAL_AUDIT_REPAIR");
assert.equal(isolated.action, "CONTINUE_ISOLATED_LOCAL_AUDIT_REPAIR");
assert.equal(isolated.independent_clearance_required, false);
assert.equal(isolated.protected_event_id, null);

const isolatedPreflight = compileIndependentClearanceApplicability({
  ...base,
  applicabilityId: "APPLICABILITY.INDEPENDENT_CLEARANCE.ISOLATED_PREFLIGHT",
  phase: "ISOLATED_LOCAL_AUDIT_REPAIR",
  spawnerMode: "GOVERNED_SPAWN",
  temporaryWorkerAdmission: true,
  spawnAuthority: true,
  isolatedWorktreeCustody: true,
  sourceRootsPreserved: true,
  sharedWorkspaceReadOnly: true,
});
assert.equal(isolatedPreflight.decision, "NOT_APPLICABLE_LOCAL_AUDIT_REPAIR");
assert.equal(isolatedPreflight.action, "CONTINUE_ISOLATED_LOCAL_AUDIT_REPAIR");

const governed = compileIndependentClearanceApplicability({...base, applicabilityId: "APPLICABILITY.INDEPENDENT_CLEARANCE.GOVERNED", phase: "GOVERNED_WORKER_ACTIVATION", spawnerMode: "GOVERNED_SPAWN"});
assert.equal(governed.decision, "REQUIRED_PROTECTED_ROUTE");
assert.equal(governed.action, "WAIT_FOR_INDEPENDENT_CLEARANCE");
assert.equal(governed.independent_clearance_required, true);
assert.equal(governed.protected_event_id, "INDEPENDENT.UTILITY_HARM_CLEARANCE");

const wave = compileIndependentClearanceApplicability({...base, applicabilityId: "APPLICABILITY.INDEPENDENT_CLEARANCE.WAVE", phase: "WAVE_ACTIVATION"});
assert.equal(wave.decision, "REQUIRED_PROTECTED_ROUTE");

for (const [label, change] of [
  ["WORKER_ADMISSION", {temporaryWorkerAdmission: true}],
  ["SPAWN_AUTHORITY", {spawnAuthority: true}],
  ["WAVE_ACTIVATION", {waveActivation: "ON"}],
  ["PROVIDER_WORKFLOW", {liveProviderWorkflow: true}],
  ["MATERIAL_SPEND", {materialSpendAuthorized: true}],
  ["DESTRUCTIVE_WORK", {destructiveWorkAuthorized: true}],
  ["ACTIVE_WORKER", {activeWorkerCount: 1}],
]) {
  const result = compileIndependentClearanceApplicability({...base, applicabilityId: `APPLICABILITY.INDEPENDENT_CLEARANCE.${label}`, ...change});
  assert.equal(result.decision, "REQUIRED_PROTECTED_ROUTE", `${label} must make the protected route applicable`);
}

for (const [label, change] of [
  ["NO_CUSTODY", {isolatedWorktreeCustody: false}],
  ["SOURCE_MUTATION", {sourceRootsPreserved: false}],
  ["SHARED_WRITE", {sharedWorkspaceReadOnly: false}],
  ["LANE_OVER_LIMIT", {activeLaneCount: 7}],
  ["HEAVYWEIGHT_OVER_LIMIT", {heavyweightProcessCount: 2}],
  ["PRODUCT_MUTATION", {productMutation: true}],
  ["PROVIDER_ACCESS", {providerAccess: true}],
]) {
  const result = compileIndependentClearanceApplicability({
    ...base,
    applicabilityId: `APPLICABILITY.INDEPENDENT_CLEARANCE.ISOLATED_${label}`,
    phase: "ISOLATED_LOCAL_AUDIT_REPAIR",
    spawnerMode: "GOVERNED_SPAWN",
    temporaryWorkerAdmission: true,
    spawnAuthority: true,
    isolatedWorktreeCustody: true,
    sourceRootsPreserved: true,
    sharedWorkspaceReadOnly: true,
    activeLaneCount: 6,
    activeWorkerCount: 6,
    schedulerJobCount: 6,
    heavyweightProcessCount: 1,
    heavyweightProcessLimit: 1,
    ...change,
  });
  assert.equal(result.decision, "REQUIRED_PROTECTED_ROUTE", `${label} must keep the protected route`);
}

const tampered = structuredClone(local);
tampered.facts.spawn_authority = true;
tampered.evidence_sha256 = local.evidence_sha256;
tampered.applicability_sha256 = "0".repeat(64);
assert.throws(() => validateIndependentClearanceApplicability(tampered), /evidence digest mismatch/u, "authority drift must invalidate applicability");

const staleDecision = structuredClone(local);
staleDecision.decision = "REQUIRED_PROTECTED_ROUTE";
staleDecision.action = "WAIT_FOR_INDEPENDENT_CLEARANCE";
staleDecision.independent_clearance_required = true;
staleDecision.protected_event_id = "INDEPENDENT.UTILITY_HARM_CLEARANCE";
staleDecision.evidence_ceiling = "bad";
staleDecision.restart_event = "bad";
staleDecision.applicability_sha256 = "0".repeat(64);
assert.throws(() => validateIndependentClearanceApplicability(staleDecision), /decision is not derived/u, "stale protected decision must be rejected");

console.log("PASS Independent clearance applicability: compiler-only local QA/import planning is safe; governed, activated, external, spend, destructive, and drifted routes remain protected");
