#!/usr/bin/env node

import assert from "node:assert/strict";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {
  DUAL_KEY_AUDITOR_ROLE,
  DUAL_KEY_CONTROLLER_ROLE,
  DUAL_KEY_HOSTILE_CASES,
  DUAL_KEY_RUNTIME_ROLE,
  DUAL_KEY_STATES,
  DUAL_KEY_WORKER_ROLE,
  PAIR_LOCAL_CONDITIONS,
  PAIR_LOCAL_CONTINUATION,
  TRUE_BLOCKED,
  TRUE_BLOCKER_CONDITIONS,
  TRUE_BLOCKED_LIVENESS,
  authorizeRuntimeOnlyDelivery,
  classifyDualKeyLaneCondition,
  compileZeroRecoveryScopeInventory,
  createBlankProjectionFallback,
  createDualKeyRepairLoop,
  createFailureDedupeLedger,
  deduplicateFailure,
  freezeDualKeyCandidate,
  recoverBlankProjectionResult,
  recordDualKeyAuditorVerdict,
  routeDualKeyCandidateToAuditor,
  transitionDualKeyRepairLoop,
  validateDualKeyRepairLoop,
} from "../control/hygiene-dual-key-repair-loop.mjs";

function rejected(action, pattern) {
  assert.throws(action, pattern);
}

const requiredHostileCases = [
  "PROTOTYPER_SUBSTITUTION_DENIED",
  "GENERAL_ROSTER_AUDITOR_SUBSTITUTION_DENIED",
  "DUPLICATE_OR_MISSING_WRITER_DENIED",
  "DUPLICATE_OR_MISSING_AUDITOR_DENIED",
  "INTERMEDIARY_QUEUE_GATE_DENIED",
  "STALE_DUPLICATE_OR_WRONG_CANDIDATE_VERDICT_DENIED",
  "MULTIPLE_ACTIVE_ISSUES_OR_CANDIDATES_DENIED",
  "WRITER_SELF_ACCEPTANCE_DENIED",
  "NON_RUNTIME_DELIVERY_DENIED",
  "BLANK_UI_WITH_DURABLE_PASS_OR_FAIL_RECOVERED_EXACTLY_ONCE",
  "BLANK_UI_WITHOUT_VALID_FALLBACK_EMITS_TYPED_TRUE_BLOCKED_NOT_FALSE_STALL",
  "REPEATED_FAILURE_DEDUPLICATED",
  "ORDINARY_PAIR_LOCAL_TRANSITION_CANNOT_ESCALATE_CENTRALLY",
  "BOUNDED_FAIL_RETURNS_DIRECTLY_TO_SAME_WORKER",
  "EVIDENCE_CORRECTION_REMAINS_PAIR_LOCAL",
  "BLOCKED_SEAM_CANNOT_STOP_UNRELATED_LANES",
  "TRUE_BLOCKER_REQUIRES_EXTERNAL_DECISION_AND_COMPLETE_EVIDENCE",
  "AGGREGATE_DIRECTORY_BYTES_MAPPED_TO_TINY_RECEIPT_FILES_DENIED",
  "AGGREGATE_ROOT_AND_SELECTED_CHILD_IDENTITIES_REQUIRED_SEPARATELY",
  "CHILD_SIZE_OR_TYPE_MISMATCH_DENIED",
  "EMPTY_SELECTED_OBJECT_SET_FORCES_ZERO_RECOVERY",
  "SELECTED_RECOVERY_SUM_CANNOT_EXCEED_EXACT_ELIGIBLE_CHILD_SUM",
];
assert.deepEqual([...DUAL_KEY_HOSTILE_CASES], requiredHostileCases);
assert.deepEqual(DUAL_KEY_STATES, [
  "ISSUE_READY",
  "WORKING",
  "CANDIDATE_FROZEN",
  "AUDITING",
  "PASS",
  "REPAIR_REQUIRED",
  "RUNTIME_ONLY_DELIVERY_HANDOFF",
]);

const worker = {role: DUAL_KEY_WORKER_ROLE, task_id: "WORKER-ZERO-RECOVERY", model: "gpt-5.6-luna"};
const writer = worker;
const auditor = {role: DUAL_KEY_AUDITOR_ROLE, task_id: "AUDITOR-ZERO-RECOVERY", model: "gpt-5.6-luna", read_only: true, can_write: false};
const issueId = "AGENTOS-GOV-HYGIENE-DUAL-KEY-ZERO-RECOVERY-SCOPE-INTEGRITY-001";

rejected(() => createDualKeyRepairLoop({issueId, writer: {role: "AGENTOS.PROTOTYPER", task_id: "WRONG-WRITER", model: "gpt-5.6-luna"}, auditor}), /SUBSTITUTION_DENIED/u);
rejected(() => createDualKeyRepairLoop({issueId, writer: worker, auditor: {role: "GENERAL_ROSTER_AUDITOR", task_id: "WRONG-AUDITOR", model: "gpt-5.6-luna"}}), /SUBSTITUTION_DENIED/u);
rejected(() => createDualKeyRepairLoop({issueId, writer: [worker], auditor}), /duplicate or missing/u);
rejected(() => createDualKeyRepairLoop({issueId, writer: worker, auditor: [auditor]}), /duplicate or missing/u);

let loop = createDualKeyRepairLoop({issueId, writer, auditor});
validateDualKeyRepairLoop(loop);
assert.equal(loop.routing.standing_lane_authority, true);
assert.equal(loop.routing.serial_successors_allowed, true);
assert.equal(loop.routing.fresh_central_approval_for_ordinary_transition, false);
assert.equal(loop.routing.blocked_seam_stops_other_lanes, false);
assert.equal(loop.routing.auditor_researches_next_ready_seam_while_waiting, true);

for (const condition of PAIR_LOCAL_CONDITIONS) {
  const decision = classifyDualKeyLaneCondition({condition});
  assert.equal(decision.classification, PAIR_LOCAL_CONTINUATION);
  assert.equal(decision.central_approval_required, false);
  assert.equal(decision.controller_route_allowed, false);
  assert.equal(decision.orchestrator_route_allowed, false);
  assert.equal(decision.spawner_route_allowed, false);
  assert.equal(decision.owner_route_allowed, false);
}
assert.equal(classifyDualKeyLaneCondition({condition: "BOUNDED_AUDIT_FAIL"}).route, "DIRECT_AUDITOR_TO_SAME_WORKER");
rejected(() => classifyDualKeyLaneCondition({condition: "EVIDENCE_CORRECTION", externalDecisionRequired: true}), /cannot claim an external decision/u);
rejected(() => classifyDualKeyLaneCondition({condition: "BOUNDED_AUDIT_FAIL", existingAuthorityCovers: false}), /standing authority/u);
rejected(() => classifyDualKeyLaneCondition({condition: "UNKNOWN_ESCALATION", evidenceComplete: true, existingAuthorityCovers: false, externalDecisionRequired: true}), /unknown lane condition/u);
for (const condition of TRUE_BLOCKER_CONDITIONS) {
  const decision = classifyDualKeyLaneCondition({condition, evidenceComplete: true, existingAuthorityCovers: false, externalDecisionRequired: true});
  assert.equal(decision.classification, TRUE_BLOCKED);
  assert.equal(decision.preserve_custody, true);
}
rejected(() => classifyDualKeyLaneCondition({condition: "HOST_CAPABILITY_UNAVAILABLE", evidenceComplete: false, existingAuthorityCovers: false, externalDecisionRequired: true}), /evidence-complete/u);
rejected(() => classifyDualKeyLaneCondition({condition: "EXTERNAL_DEPENDENCY_AUTHORITY_REQUIRED", evidenceComplete: true, existingAuthorityCovers: true, externalDecisionRequired: true}), /standing lane authority covers/u);
loop = transitionDualKeyRepairLoop(loop, {to: "WORKING", actor: worker});
const candidate = {
  candidate_id: "CANDIDATE-ZERO-RECOVERY-R1",
  commit: "a".repeat(40),
  tree: "b".repeat(40),
  parent: "c".repeat(40),
  paths: ["control/hygiene-dual-key-repair-loop.mjs", "schemas/hygiene-dual-key-repair-loop.v1.json"],
};
loop = freezeDualKeyCandidate(loop, {actor: worker, candidate});
rejected(() => routeDualKeyCandidateToAuditor(loop, {actor: worker, recipientTaskId: auditor.task_id, intermediaryQueue: true}), /intermediary queue|direct/u);
rejected(() => routeDualKeyCandidateToAuditor(loop, {actor: worker, recipientTaskId: "OTHER-AUDITOR"}), /direct|candidate/u);
loop = routeDualKeyCandidateToAuditor(loop, {actor: worker, recipientTaskId: auditor.task_id});
const wrongCandidate = {...candidate, candidate_id: "STALE-CANDIDATE"};
rejected(() => recordDualKeyAuditorVerdict(loop, {actor: auditor, candidate: wrongCandidate, verdict: {status: "PASS"}}), /stale|wrong|candidate/u);
rejected(() => recordDualKeyAuditorVerdict(loop, {actor: worker, verdict: {status: "PASS"}}), /Auditor|authorized/u);
rejected(() => transitionDualKeyRepairLoop(loop, {
  to: "PASS",
  actor: auditor,
  verdict: {status: "REPAIR_REQUIRED", evidence_sha256: "d".repeat(64)},
}), /VERDICT_STATE_MISMATCH_DENIED/u);

const failed = recordDualKeyAuditorVerdict(loop, {actor: auditor, verdict: {status: "FAIL", evidence_sha256: "d".repeat(64)}});
assert.equal(failed.state, "REPAIR_REQUIRED");
const repaired = transitionDualKeyRepairLoop(failed, {to: "WORKING", actor: worker});
assert.equal(repaired.generation, 2);
assert.equal(repaired.issue_id, issueId);
const candidateR2 = {...candidate, candidate_id: "CANDIDATE-ZERO-RECOVERY-R2", commit: "d".repeat(40)};
loop = routeDualKeyCandidateToAuditor(freezeDualKeyCandidate(repaired, {actor: worker, candidate: candidateR2}), {actor: worker, recipientTaskId: auditor.task_id});
loop = recordDualKeyAuditorVerdict(loop, {actor: auditor, verdict: {status: "PASS", evidence_sha256: "e".repeat(64)}});
const forgedVerdictState = structuredClone(loop);
forgedVerdictState.verdict = {...forgedVerdictState.verdict, status: "REPAIR_REQUIRED", verdict_sha256: null};
forgedVerdictState.verdict.verdict_sha256 = canonicalDigest({...forgedVerdictState.verdict, verdict_sha256: null});
forgedVerdictState.loop_sha256 = canonicalDigest({...forgedVerdictState, loop_sha256: null});
rejected(() => validateDualKeyRepairLoop(forgedVerdictState), /VERDICT_STATE_MISMATCH_DENIED/u);
rejected(() => authorizeRuntimeOnlyDelivery(forgedVerdictState, {actor: {role: DUAL_KEY_RUNTIME_ROLE, task_id: "R-R1-TAMPER"}}), /VERDICT_STATE_MISMATCH_DENIED/u);
const tamperedCounts = {...loop, active_issue_count: 2};
rejected(() => validateDualKeyRepairLoop(tamperedCounts), /multiple active issues|active issue/u);
const tamperedCandidates = {...loop, active_candidate_count: 2};
rejected(() => validateDualKeyRepairLoop(tamperedCandidates), /multiple active candidates|candidate count/u);
rejected(() => authorizeRuntimeOnlyDelivery(loop, {actor: auditor}), /Runtime|authorized/u);
const delivered = authorizeRuntimeOnlyDelivery(loop, {actor: {role: DUAL_KEY_RUNTIME_ROLE, task_id: "RUNTIME-ZERO-RECOVERY"}});
assert.equal(delivered.allowed, true);
assert.equal(delivered.state.state, "RUNTIME_ONLY_DELIVERY_HANDOFF");
assert.equal(delivered.role, DUAL_KEY_RUNTIME_ROLE);

const durableLedger = {consumed_keys: []};
for (const status of ["PASS", "FAIL"]) {
  const durable = {status, task_id: "TASK-BLANK-PROJECTION", turn_id: `TURN-BLANK-${status}`, evidence_sha256: status === "PASS" ? "f".repeat(64) : "1".repeat(64)};
  const recovered = recoverBlankProjectionResult({taskId: durable.task_id, turnId: durable.turn_id, projection: {status: "completed", items: [], items_count: 0}, durableResult: durable, ledger: durableLedger});
  const duplicate = recoverBlankProjectionResult({taskId: durable.task_id, turnId: durable.turn_id, projection: {status: "completed", items: [], items_count: 0}, durableResult: durable, ledger: durableLedger});
  assert.equal(recovered.classification, "BLANK_UI_WITH_DURABLE_PASS_OR_FAIL_RECOVERED_EXACTLY_ONCE");
  assert.equal(recovered.consumed, true);
  assert.equal(duplicate.duplicate, true);
}
const trueBlocked = createBlankProjectionFallback({
  taskId: "TASK-BLANK-BLOCKED",
  turnId: "TURN-BLANK-BLOCKED",
  projection: {status: "completed", items: [], items_count: 0},
  controllerEvidence: {role: DUAL_KEY_CONTROLLER_ROLE, evidence_complete: true, evidence_sha256: "2".repeat(64)},
});
assert.equal(trueBlocked.status, TRUE_BLOCKED);
assert.equal(trueBlocked.classification, TRUE_BLOCKED_LIVENESS);
assert.equal(trueBlocked.false_stall, false);
rejected(() => createBlankProjectionFallback({taskId: "TASK-BLANK-BLOCKED", turnId: "TURN-BLANK-BLOCKED", projection: {items: [], items_count: 0}, controllerEvidence: {role: DUAL_KEY_RUNTIME_ROLE, evidence_complete: true, evidence_sha256: "2".repeat(64)}}), /Controller-only|Controller/u);

const failureLedger = createFailureDedupeLedger();
const failure = {issue_id: issueId, candidate_id: "CANDIDATE-ZERO-RECOVERY-R2", failure_class: "BOUNDED_AUDIT_FAIL", evidence_sha256: "3".repeat(64)};
const firstFailure = deduplicateFailure({failure, ledger: failureLedger});
const repeatedFailure = deduplicateFailure({failure, ledger: failureLedger});
assert.equal(firstFailure.duplicate, false);
assert.equal(repeatedFailure.duplicate, true);

const identity = {device: 1, inode: 2, mode: 16877, links: 1, uid: 501, gid: 20, mtime_ns: 10, ctime_ns: 10, birthtime_ns: 9};
const aggregateLogical = 8664811 * 1024;
const aggregateAllocated = 9512788 * 1024;
const tinyInventory = compileZeroRecoveryScopeInventory({
  aggregateRoot: {path: "AgentOS/Temp", stable_identity: identity, logical_bytes_measured: aggregateLogical, allocated_bytes_measured: aggregateAllocated, object_type: "DIRECTORY", is_symlink: false, realpath: "AgentOS/Temp"},
  selectedObjects: [
    {path: "AgentOS/Temp/receipt-pass.json", stable_identity: {...identity, inode: 3, mode: 33188}, object_type: "FILE", logical_bytes_measured: 100, allocated_or_physical_estimate_bytes: 4096, cleanup_gate_result: "CLEANUP_ELIGIBLE", is_symlink: false, realpath: "AgentOS/Temp/receipt-pass.json"},
    {path: "AgentOS/Temp/receipt-fail.json", stable_identity: {...identity, inode: 4, mode: 33188}, object_type: "FILE", logical_bytes_measured: 356, allocated_or_physical_estimate_bytes: 4096, cleanup_gate_result: "CLEANUP_ELIGIBLE", is_symlink: false, realpath: "AgentOS/Temp/receipt-fail.json"},
  ],
});
assert.equal(tinyInventory.selected_recoverable_logical_bytes, 456);
assert.equal(tinyInventory.selected_recoverable_physical_bytes, 8192);
assert.equal(tinyInventory.aggregate_bytes_attributed_to_selected_children, false);
assert.equal(tinyInventory.aggregate_measurement_source, "AGGREGATE_ROOT_ONLY");
assert.equal(tinyInventory.recovery_measurement_source, "SELECTED_OBJECTS_ONLY");
rejected(() => compileZeroRecoveryScopeInventory({
  aggregateRoot: {path: "AgentOS/Temp", stable_identity: identity, logical_bytes_measured: aggregateLogical, allocated_bytes_measured: aggregateAllocated},
  selectedObjects: [{path: "AgentOS/Temp/tiny-receipt.json", stable_identity: {...identity, inode: 5}, object_type: "FILE", logical_bytes_measured: 456, allocated_or_physical_estimate_bytes: 8192, cleanup_gate_result: "CLEANUP_ELIGIBLE"}],
  selectedRecoverableLogicalBytes: aggregateLogical,
  selectedRecoverablePhysicalBytes: aggregateAllocated,
}), /exact eligible child sum|exceeds/u);
rejected(() => compileZeroRecoveryScopeInventory({aggregateRoot: {path: "AgentOS/Temp", stable_identity: {...identity, mtime_ns: undefined}, logical_bytes_measured: 1, allocated_bytes_measured: 1}, selectedObjects: []}), /undefined|concrete/u);
rejected(() => compileZeroRecoveryScopeInventory({aggregateRoot: {path: "AgentOS/Temp", stable_identity: identity, logical_bytes_measured: 1, allocated_bytes_measured: 1}, selectedObjects: [{path: "AgentOS/Temp", stable_identity: {...identity, inode: 6}, object_type: "DIRECTORY", logical_bytes_measured: 1, allocated_or_physical_estimate_bytes: 1, cleanup_gate_result: "CLEANUP_ELIGIBLE"}]}), /distinct|descendant/u);
rejected(() => compileZeroRecoveryScopeInventory({aggregateRoot: {path: "AgentOS/Temp", stable_identity: identity, logical_bytes_measured: 1, allocated_bytes_measured: 1}, selectedObjects: [{path: "AgentOS/Temp/not-a-file", stable_identity: {...identity, inode: 7}, object_type: "SYMLINK", logical_bytes_measured: 1, allocated_or_physical_estimate_bytes: 1, cleanup_gate_result: "CLEANUP_ELIGIBLE"}]}), /type/u);
rejected(() => compileZeroRecoveryScopeInventory({aggregateRoot: {path: "AgentOS/Temp", stable_identity: identity, logical_bytes_measured: 1, allocated_bytes_measured: 1}, selectedObjects: [], selectedRecoverableLogicalBytes: 1, selectedRecoverablePhysicalBytes: 1}), /exact eligible child sum/u);
rejected(() => compileZeroRecoveryScopeInventory({aggregateRoot: {path: "AgentOS/Temp", stable_identity: identity, logical_bytes_measured: 1, allocated_bytes_measured: 1}, selectedObjects: [{path: "AgentOS/Temp/tiny", stable_identity: {...identity, inode: 8}, object_type: "FILE", logical_bytes_measured: 1, allocated_or_physical_estimate_bytes: 1, cleanup_gate_result: "CLEANUP_ELIGIBLE"}], selectedRecoverableLogicalBytes: 2, selectedRecoverablePhysicalBytes: 2}), /exact eligible child sum/u);

console.log("PASS hygiene dual-key repair loop: dedicated Worker/Auditor custody, direct routing, Runtime-only delivery, durable blank-projection recovery, failure dedupe, and exact aggregate/selected-object zero-recovery granularity");
