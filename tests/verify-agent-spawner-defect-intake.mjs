#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {
  acceptAgentSpawnerDefectRepair,
  compileCanonicalLivenessDefect,
  compileCanonicalDeliveryBlockedDefect,
  compileAgentSpawnerDefectIntake,
  validateAgentSpawnerDefectIntake,
} from "../control/agent-spawner-defect-intake.mjs";

const hash = (value) => canonicalDigest({value});
const sourceBinding = {candidate_sha256: hash("candidate"), context_sha256: hash("context"), roster_projection_sha256: hash("roster"), source_identity_sha256: hash("source")};
const evidenceRefs = [
  {evidence_id: "EVIDENCE.RECHECK", kind: "HOST_READBACK", reference: "opaque:recheck", sha256: hash("recheck")},
  {evidence_id: "EVIDENCE.FAILURE", kind: "REPRODUCIBLE_CHECK", reference: "ref:failure", sha256: hash("failure")},
];
const common = {
  defectId: "DEFECT.CHECK.001",
  defectKind: "QA_FINDING",
  sourceBinding,
  evidenceRefs,
  observation: {summary: "The route stopped before the required next action.", expected: "The next action starts in the same turn.", observed: "No next action was started.", observed_at_utc: "2026-08-16T20:00:00.000Z", details_sha256: hash("details")},
  classification: "REPAIRABLE_GATE_GAP",
  rootCause: {category: "MISSING_CONTINUATION_RULE", statement: "Closeout did not bind a successor transition.", evidence_class: "OBSERVED"},
  blockId: "BLOCK.CONTINUATION",
  gateId: "GATE.CONTINUATION.NEXT_ACTION",
  graphId: "GRAPH.WORKFLOW",
};
const ready = compileAgentSpawnerDefectIntake(common);
validateAgentSpawnerDefectIntake(ready);
assert.equal(ready.status, "REPAIR_CANDIDATE_READY");
assert.equal(ready.route, "COMPILE_BLOCK_PATCH");
assert.equal(ready.repair.kind, "REUSABLE_BLOCK_PATCH");
assert.equal(ready.admission.spawnable, false);
assert.equal(ready.admission.independent_evaluation_required, true);
assert.equal(ready.handoff.next_action, "ROUTE_TO_CONTROLLER_CUSTODY");
const accepted = acceptAgentSpawnerDefectRepair(ready, {controllerReceiptSha256: hash("controller-receipt")});
assert.equal(accepted.status, "ACCEPTED_FOR_CONTROLLER_CUSTODY");
assert.equal(accepted.handoff.status, "ACCEPTED_FOR_TYPED_CONTROLLER_CUSTODY");
assert.equal(accepted.admission.spawnable, false);
assert.notEqual(accepted.defect_sha256, ready.defect_sha256);

const protectedDefect = compileAgentSpawnerDefectIntake({...common, defectId: "DEFECT.PROTECTED.001", defectKind: "CONTRADICTION", classification: "PROTECTED_BOUNDARY"});
assert.equal(protectedDefect.status, "PENDING_PROTECTED_DECISION");
assert.equal(protectedDefect.route, "ESCALATE_PROTECTED");
assert.equal(protectedDefect.handoff.next_action, "WAIT_FOR_PROTECTED_DECISION");
assert.throws(() => acceptAgentSpawnerDefectRepair(protectedDefect, {controllerReceiptSha256: hash("not-allowed")}), /ready local repair/u);

const duplicate = compileAgentSpawnerDefectIntake({...common, defectId: "DEFECT.DUPLICATE.001", defectKind: "REJECTED_ROUTE", classification: "DUPLICATE_OR_STALE_BLOCK"});
assert.equal(duplicate.status, "REJECTED_DUPLICATE");
assert.equal(duplicate.handoff.next_action, "INVALIDATE_DEPENDENTS");
assert.equal(duplicate.admission.roster_status, "INVALIDATE_DEPENDENTS");

const tampered = structuredClone(ready);
tampered.admission.spawnable = true;
tampered.defect_sha256 = canonicalDigest({...tampered, defect_sha256: null});
assert.throws(() => validateAgentSpawnerDefectIntake(tampered), /must never be spawnable/u);
const staleHandoff = structuredClone(ready);
staleHandoff.handoff.route = "REBUILD_DEPENDENT_ROSTER";
staleHandoff.handoff.handoff_sha256 = canonicalDigest({...staleHandoff.handoff, handoff_sha256: null});
staleHandoff.defect_sha256 = canonicalDigest({...staleHandoff, defect_sha256: null});
assert.throws(() => validateAgentSpawnerDefectIntake(staleHandoff), /handoff route is stale/u);

const livenessFinding = {
  defect_id: "DEFECT.LIVENESS.CANONICAL.001",
  defect_kind: "NON_PASSING_CHECK",
  task_id: "TASK.LIVENESS.001",
  candidate_sha256: hash("liveness-candidate"),
  outcome_sha256: hash("liveness-outcome"),
  stall_signature_sha256: hash("liveness-stall"),
  expected_transition: "CONSUME.EXACT.OUTCOME",
  summary: "A material outcome remains unconsumed.",
  expected: "The responsible parent consumes the exact outcome.",
  observed: "No fresh exact consumer readback exists.",
  observed_at_utc: "2026-08-16T20:00:00.000Z",
  details_sha256: hash("liveness-details"),
  observation_kind: "COMPLETED_OUTCOME_NOT_CONSUMED",
};
const liveness = compileCanonicalLivenessDefect({finding: livenessFinding});
validateAgentSpawnerDefectIntake(liveness);
assert.equal(liveness.classification, "ORCHESTRATOR_LIVENESS_FAILURE");
assert.equal(liveness.route, "REPAIR_ORCHESTRATOR_ROUTE");
assert.equal(liveness.admission.spawnable, false);
const duplicateLiveness = compileCanonicalLivenessDefect({finding: {...livenessFinding, defect_id: "DEFECT.LIVENESS.CANONICAL.002"}, priorSignatures: [livenessFinding.stall_signature_sha256]});
assert.equal(duplicateLiveness.classification, "DUPLICATE_OR_STALE_BLOCK");
assert.equal(duplicateLiveness.route, "REJECT_DUPLICATE");
assert.equal(duplicateLiveness.status, "REJECTED_DUPLICATE");
assert.equal(duplicateLiveness.admission.spawnable, false);
const silentLiveness = compileCanonicalLivenessDefect({finding: {
  ...livenessFinding,
  defect_id: "DEFECT.LIVENESS.SILENT.001",
  candidate_sha256: hash("silent-custody-binding"),
  outcome_sha256: null,
  stall_signature_sha256: hash("silent-stall"),
  observation_kind: "SILENT_COMPLETED_TURN_WITH_PRESERVED_UNFROZEN_CUSTODY",
  summary: "A completed turn left changed mutable custody without a visible material outcome.",
  expected: "The same task emits a typed successor or remains explicitly open.",
  observed: "The turn completed silently and its expected transition remains unresolved.",
}});
assert.equal(silentLiveness.classification, "ORCHESTRATOR_LIVENESS_FAILURE");
assert.equal(silentLiveness.route, "REPAIR_ORCHESTRATOR_ROUTE");
assert.equal(silentLiveness.admission.spawnable, false);

const deliveryBlockedFinding = {
  ...livenessFinding,
  defect_id: "DEFECT.LIVENESS.DELIVERY_BLOCKED.001",
  stall_signature_sha256: hash("delivery-blocked-stall"),
  observation_kind: "STALL_REPORT_DELIVERY_BLOCKED",
  summary: "The exact stall report could not be delivered through an admitted route.",
  expected: "The Controller records one exact delivery-blocked fallback for its intended recipient.",
  observed: "The collaboration tree was unavailable and the host cross-thread adapter was rejected.",
};
const deliveryBlocked = compileCanonicalDeliveryBlockedDefect({finding: deliveryBlockedFinding});
validateAgentSpawnerDefectIntake(deliveryBlocked);
assert.equal(deliveryBlocked.classification, "ORCHESTRATOR_LIVENESS_FAILURE");
assert.equal(deliveryBlocked.route, "REPAIR_ORCHESTRATOR_ROUTE");
assert.equal(deliveryBlocked.admission.spawnable, false);
const duplicateDeliveryBlocked = compileCanonicalDeliveryBlockedDefect({finding: {...deliveryBlockedFinding, defect_id: "DEFECT.LIVENESS.DELIVERY_BLOCKED.002"}, priorSignatures: [deliveryBlockedFinding.stall_signature_sha256]});
assert.equal(duplicateDeliveryBlocked.classification, "DUPLICATE_OR_STALE_BLOCK");
assert.equal(duplicateDeliveryBlocked.status, "REJECTED_DUPLICATE");
assert.throws(() => compileCanonicalDeliveryBlockedDefect({finding: {...deliveryBlockedFinding, observation_kind: "COMPLETED_OUTCOME_NOT_CONSUMED"}}), /delivery-blocked finding kind/u);

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
for (const relative of ["control/agent-spawner-defect-intake.mjs", "schemas/agent-spawner-defect-intake.v1.json"]) {
  const text = fs.readFileSync(path.join(root, relative), "utf8");
  assert(!/Sociuna|JobSight|WellSight/iu.test(text), `${relative} contains consumer-specific policy`);
}

console.log("PASS Agent Spawner defect intake: failed checks, QA findings, contradictions, rejected routes, and protected boundaries become typed non-spawnable gate/block repairs with custody and invalidation");
