#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  COMMAND_PATH_CORRELATED_SUCCESS,
  COMMAND_PATH_CORRELATION_OPEN,
  COMMAND_PATH_DUPLICATE_RETRY_REJECTED,
  COMMAND_PATH_RETRY_ALLOWED,
  authorizeSameTaskBoundedRetry,
  correlateRuntimeReceiptCommandPath,
  consumeCommandPathSuccessOnce,
  createCommandPathConsumptionLedger,
  CORRELATED_READBACK,
  LOW_CONFIDENCE_CORRELATION_BLOCKER,
  THREAD_READBACK_PROJECTION_DIVERGENCE,
  compileProjectionDivergenceReceipt,
  consumeRecoveredResultOnce,
  createCloseoutLifecycle,
  createConsumptionLedger,
  createDurableHistoryAdapter,
  compileStorageAutopilotDecision,
  validateStorageAutopilotDecision,
  reconcileThreadReadbackProjection,
  readStableAuthorityDigest,
  validateProjectionDivergenceReceipt,
  DUAL_KEY_AUDITOR_ROLE,
  DUAL_KEY_CONTROLLER_ROLE,
  DUAL_KEY_RUNTIME_ROLE,
  DUAL_KEY_WORKER_ROLE,
  authorizeRuntimeOnlyDelivery,
  createBlankProjectionFallback,
  createDualKeyRepairLoop,
  createFailureDedupeLedger,
  deduplicateFailure,
  freezeDualKeyCandidate,
  recordDualKeyAuditorVerdict,
  routeDualKeyCandidateToAuditor,
  transitionDualKeyRepairLoop,
  ACTIVE_OR_PROJECTION_LAG,
  MATERIAL_LIVENESS_ACTIVE,
  MATERIAL_LIVENESS_STAGNANT,
  SAME_TASK_RECOVERY_REQUIRED,
  TYPED_HOST_CAPABILITY_ESCALATION,
  compileSchedulerProjectionLivenessObservation,
  validateSchedulerProjectionLivenessObservation,
  createMaterialLivenessEscalationLedger,
  deduplicateMaterialLivenessEscalation,
} from "../control/campaign-closeout-lifecycle.mjs";
import {canonicalDigest} from "../control/content-addressing.mjs";

const taskId = "TASK-SYNTHETIC-037";
const turnId = "TURN-SYNTHETIC-037";
const itemId = "msg-final-pass";
const item = {
  item_id: itemId,
  task_id: taskId,
  turn_id: turnId,
  item_type: "agentMessage",
  semantic_result: "ASSET_PRODUCER_PASS",
  candidate: "MODEL-EQ-031-R1-CANDIDATE-001",
};
item.item_json_sha256 = canonicalDigest(item);
const durable = {
  source: "SYNTHETIC_READ_ONLY_HISTORY",
  turn: {task_id: taskId, turn_id: turnId, final_agent_item_id: itemId, item_count: 4},
  items: [item],
};
const emptyProjection = {status: "completed", items: [], items_count: 0, source: "codex_app__read_thread"};

const pass = reconcileThreadReadbackProjection({taskId, turnId, projection: emptyProjection, durableHistory: durable});
assert.equal(pass.status, THREAD_READBACK_PROJECTION_DIVERGENCE);
assert.equal(pass.semantic_output.classification, "ASSET_PRODUCER_PASS");
assert.equal(pass.confidence, "HIGH_EXACT_ITEM_ID");
assert.equal(pass.provenance.exact_correlation, true);
validateProjectionDivergenceReceipt(pass);

const adapter = createDurableHistoryAdapter({
  source: "SYNTHETIC_INJECTED_SQL_READ_ONLY",
  readTurn: () => durable.turn,
  readItem: () => item,
});
const adapterPass = compileProjectionDivergenceReceipt({taskId, turnId, projection: emptyProjection, adapter});
assert.equal(adapterPass.status, THREAD_READBACK_PROJECTION_DIVERGENCE);
assert.equal(adapterPass.provenance.durable_adapter_version, "1");

for (const semanticResult of ["ASSET_PRODUCER_FAIL", "TYPED_BLOCKER"]) {
  const resultItem = {...item, item_id: `${itemId}-${semanticResult}`, semantic_result: semanticResult};
  delete resultItem.item_json_sha256;
  resultItem.item_json_sha256 = canonicalDigest(resultItem);
  const result = reconcileThreadReadbackProjection({
    taskId,
    turnId,
    projection: emptyProjection,
    durableHistory: {turn: {...durable.turn, final_agent_item_id: resultItem.item_id}, items: [resultItem]},
  });
  assert.equal(result.semantic_output.classification, semanticResult);
}

const noDurable = reconcileThreadReadbackProjection({taskId, turnId, projection: emptyProjection});
assert.equal(noDurable.status, LOW_CONFIDENCE_CORRELATION_BLOCKER);
assert.equal(noDurable.blocked, true);
assert.equal(noDurable.semantic_output, null);
assert.throws(() => reconcileThreadReadbackProjection({taskId, turnId, projection: emptyProjection, durableHistory: {
  turn: {...durable.turn, task_id: "different-task"}, items: [item],
}}), /task identity/u);
assert.throws(() => reconcileThreadReadbackProjection({taskId, turnId, projection: emptyProjection, durableHistory: {
  turn: durable.turn, items: [item, item],
}}), /ambiguous|duplicated/u);
const tamperedItem = {...item, semantic_result: "TAMPERED"};
assert.throws(() => reconcileThreadReadbackProjection({taskId, turnId, projection: emptyProjection, durableHistory: {
  turn: {...durable.turn, final_agent_item_id: tamperedItem.item_id}, items: [{...tamperedItem, item_json_sha256: "f".repeat(64)}],
}}), /digest/u);

const stableReads = ["a".repeat(64), "b".repeat(64), "b".repeat(64)];
const stable = readStableAuthorityDigest(() => stableReads.shift(), {maxReads: 5, requiredStableReads: 2});
assert.equal(stable.status, "STABLE");
assert.equal(stable.digest, "b".repeat(64));
const unstable = readStableAuthorityDigest(() => "c".repeat(64), {maxReads: 2, requiredStableReads: 2});
assert.equal(unstable.status, "STABLE");
const neverStable = ["d", "e", "f", "0"].map((value) => value.repeat(64));
const unstableResult = readStableAuthorityDigest(() => neverStable.shift(), {maxReads: 4, requiredStableReads: 2});
assert.equal(unstableResult.status, "UNSTABLE");
assert.equal(unstableResult.semantic_failure, false);

const ledger = createConsumptionLedger();
const first = consumeRecoveredResultOnce({receipt: pass, ledger});
const second = consumeRecoveredResultOnce({receipt: pass, ledger});
assert.equal(first.consumed, true);
assert.equal(second.duplicate, true);
assert.throws(() => consumeRecoveredResultOnce({receipt: pass, ledger, route: {rerun: true}}), /replay|rerun/u);

const lifecycle = createCloseoutLifecycle({
  taskId,
  turnId,
  laneId: "ROUTE-037",
  candidate: {commit: "a".repeat(40), tree: "b".repeat(40)},
  handoffSha256: "c".repeat(64),
  auditor: "AUDITOR-037",
  custodyGeneration: "CUSTODY-1",
});
assert.deepEqual(lifecycle.read().state, "CHECKPOINT_REACHED");
lifecycle.transition("HANDOFF_READY");
lifecycle.transition("AUDIT_ROUTED");
assert.throws(() => lifecycle.transition("AUDIT_ROUTED"), /not allowed|idempotent/u);
lifecycle.transition("AUDIT_CONSUMED", {recipient_consumed: true});
lifecycle.transition("CLOSED");
assert.equal(lifecycle.read().state, "CLOSED");

const runtimeTaskId = "TASK-RUNTIME-CORRELATION-037";
const runtimeTurnId = "TURN-RUNTIME-CORRELATION-037";
const runtimeCommand = {
  command_id: "CMD-RUNTIME-CLEANUP-037",
  command_path: "agentos-cleanup",
  command_argv: ["agentos-cleanup", "--bounded"],
};
const runtimeCommandItem = {
  item_id: "CMD-ITEM-037",
  task_id: runtimeTaskId,
  turn_id: runtimeTurnId,
  item_type: "commandExecution",
  ...runtimeCommand,
  exit_code: 0,
  status: "SUCCEEDED",
  mutation_count: 1,
  deletion_count: 1,
};
runtimeCommandItem.item_json_sha256 = canonicalDigest(runtimeCommandItem);
const runtimeFinalItem = {
  item_id: "MSG-RUNTIME-FINAL-037",
  task_id: runtimeTaskId,
  turn_id: runtimeTurnId,
  item_type: "agentMessage",
  semantic_output: {classification: "MUTATION_ACKNOWLEDGED"},
};
runtimeFinalItem.item_json_sha256 = canonicalDigest(runtimeFinalItem);
const runtimeDurable = {
  source: "SYNTHETIC_RUNTIME_HISTORY",
  turn: {task_id: runtimeTaskId, turn_id: runtimeTurnId, final_agent_item_id: runtimeFinalItem.item_id, item_count: 2},
  items: [runtimeCommandItem, runtimeFinalItem],
};
const runtimeReceipt = {
  schema: "agentos.runtime.typed_execution_receipt.v1",
  version: 1,
  task_id: runtimeTaskId,
  turn_id: runtimeTurnId,
  command_id: runtimeCommand.command_id,
  command_path: runtimeCommand.command_path,
  exit_code: 0,
  status: "SUCCEEDED",
  terminal: true,
  mutation: true,
  mutation_count: 1,
  deletion_count: 1,
  receipt_sha256: null,
};
runtimeReceipt.receipt_sha256 = canonicalDigest({...runtimeReceipt, receipt_sha256: null});
const runtimeAfterState = {
  schema: "agentos.runtime.fresh_after_state.v1",
  version: 1,
  task_id: runtimeTaskId,
  turn_id: runtimeTurnId,
  command_id: runtimeCommand.command_id,
  fresh_revalidation: true,
  mutation_applied: true,
  after_state_sha256: null,
};
runtimeAfterState.after_state_sha256 = canonicalDigest({...runtimeAfterState, after_state_sha256: null});
const runtimeCommandPath = {authorized_command: runtimeCommand, execution_receipt: runtimeReceipt, after_state: runtimeAfterState};
const runtimeSuccess = correlateRuntimeReceiptCommandPath({
  taskId: runtimeTaskId,
  turnId: runtimeTurnId,
  projection: {status: "completed", items: [], items_count: 0},
  durableHistory: runtimeDurable,
  commandPath: runtimeCommandPath,
});
assert.equal(runtimeSuccess.status, COMMAND_PATH_CORRELATED_SUCCESS);
assert.equal(runtimeSuccess.success, true);
assert.equal(runtimeSuccess.projection.empty, true);
assert.equal(runtimeSuccess.durable_evidence.command_count, 1);
assert.equal(runtimeSuccess.replay_inferred, false);
assert.equal(runtimeSuccess.wake_inferred, false);
assert.equal(runtimeSuccess.deletion_inferred, false);

const noCommand = correlateRuntimeReceiptCommandPath({
  taskId: runtimeTaskId,
  turnId: runtimeTurnId,
  projection: {status: "completed", items: [], items_count: 0},
  durableHistory: {turn: {...runtimeDurable.turn, item_count: 1, final_agent_item_id: runtimeFinalItem.item_id}, items: [runtimeFinalItem]},
  commandPath: runtimeCommandPath,
});
assert.equal(noCommand.status, COMMAND_PATH_CORRELATION_OPEN);
assert.equal(noCommand.reason, "AUTHORIZED_COMMAND_PATH_REQUIRED");
const emptyProjectionWithCommands = correlateRuntimeReceiptCommandPath({
  taskId: runtimeTaskId,
  turnId: runtimeTurnId,
  projection: {status: "completed", items: [], items_count: 0},
  durableHistory: runtimeDurable,
});
assert.equal(emptyProjectionWithCommands.status, COMMAND_PATH_CORRELATION_OPEN);
assert.equal(emptyProjectionWithCommands.success, false);

const interruptedReceipt = {...runtimeReceipt, exit_code: 130, status: "INTERRUPTED", terminal: false, receipt_sha256: null};
interruptedReceipt.receipt_sha256 = canonicalDigest({...interruptedReceipt, receipt_sha256: null});
const interrupted = correlateRuntimeReceiptCommandPath({taskId: runtimeTaskId, turnId: runtimeTurnId, projection: {status: "completed", items: [], items_count: 0}, durableHistory: runtimeDurable, commandPath: {...runtimeCommandPath, execution_receipt: interruptedReceipt}});
assert.equal(interrupted.status, COMMAND_PATH_CORRELATION_OPEN);
assert.match(interrupted.reason, /TERMINAL|RECEIPT/u);

const noAfterState = correlateRuntimeReceiptCommandPath({taskId: runtimeTaskId, turnId: runtimeTurnId, projection: {status: "completed", items: [], items_count: 0}, durableHistory: runtimeDurable, commandPath: {authorized_command: runtimeCommand, execution_receipt: runtimeReceipt}});
assert.equal(noAfterState.status, COMMAND_PATH_CORRELATION_OPEN);
assert.equal(noAfterState.reason, "FRESH_AFTER_STATE_REQUIRED");

const commandLedger = createCommandPathConsumptionLedger();
const consumed = consumeCommandPathSuccessOnce({correlation: runtimeSuccess, ledger: commandLedger});
assert.equal(consumed.consumed, true);
assert.throws(() => consumeCommandPathSuccessOnce({correlation: runtimeSuccess, ledger: commandLedger, retry: true}), /duplicate retry/u);
const duplicateRetry = correlateRuntimeReceiptCommandPath({taskId: runtimeTaskId, turnId: runtimeTurnId, projection: {status: "completed", items: [], items_count: 0}, durableHistory: runtimeDurable, commandPath: runtimeCommandPath, retry: {requested: true}});
assert.equal(duplicateRetry.status, COMMAND_PATH_DUPLICATE_RETRY_REJECTED === duplicateRetry.status ? COMMAND_PATH_DUPLICATE_RETRY_REJECTED : COMMAND_PATH_CORRELATION_OPEN);
assert.equal(duplicateRetry.success, false);

const retryAuthority = {status: "STABLE", digest: "a".repeat(64)};
const retryLedger = createCommandPathConsumptionLedger();
const retryRequest = {same_task: true, task_id: runtimeTaskId, turn_id: runtimeTurnId, attempt: 1};
const retryPreflight = {fresh: true, mutation_count: 0, deletion_count: 0, authority_digest: retryAuthority.digest};
const retryMutationCommandItem = {
  ...runtimeCommandItem,
  item_id: "CMD-ITEM-RETRY-MUTATION-037",
  exit_code: 130,
  status: "INTERRUPTED",
  mutation_count: 1,
  deletion_count: 1,
};
delete retryMutationCommandItem.item_json_sha256;
retryMutationCommandItem.item_json_sha256 = canonicalDigest(retryMutationCommandItem);
const retryMutationDurable = {
  ...runtimeDurable,
  items: [retryMutationCommandItem, runtimeFinalItem],
};
const retryMutationReceipt = {
  ...runtimeReceipt,
  exit_code: 130,
  status: "INTERRUPTED",
  terminal: true,
  receipt_sha256: null,
};
retryMutationReceipt.receipt_sha256 = canonicalDigest({...retryMutationReceipt, receipt_sha256: null});
const retryMutationAuthority = {status: "STABLE", digest: "b".repeat(64)};
const retryMutationLedger = createCommandPathConsumptionLedger();
const retryMutationResult = correlateRuntimeReceiptCommandPath({
  taskId: runtimeTaskId,
  turnId: runtimeTurnId,
  projection: {status: "completed", items: [], items_count: 0},
  durableHistory: retryMutationDurable,
  commandPath: {...runtimeCommandPath, execution_receipt: retryMutationReceipt},
  retry: retryRequest,
  authorityDigest: retryMutationAuthority,
  preflight: retryPreflight,
  consumptionLedger: retryMutationLedger,
});
assert.equal(retryMutationResult.status, COMMAND_PATH_CORRELATION_OPEN);
assert.equal(retryMutationResult.execution.mutation_count, 1);
assert.equal(retryMutationResult.execution.deletion_count, 1);
assert.equal(retryMutationResult.retry.allowed, false);
assert.equal(retryMutationResult.retry.reason, "SAME_TASK_RETRY_MUTATION_STATE_NOT_ZERO");
assert.deepEqual(retryMutationLedger.retry_keys, []);
const retryAllowed = authorizeSameTaskBoundedRetry({correlation: {status: COMMAND_PATH_CORRELATION_OPEN, task_id: runtimeTaskId, turn_id: runtimeTurnId, authority_digest: retryAuthority.digest, execution: {exit_code: 130, mutation_count: 0, deletion_count: 0}}, retry: retryRequest, authorityDigest: retryAuthority, preflight: retryPreflight, ledger: retryLedger});
assert.equal(retryAllowed.status, COMMAND_PATH_RETRY_ALLOWED);
const retryDuplicate = authorizeSameTaskBoundedRetry({correlation: {status: COMMAND_PATH_CORRELATION_OPEN, task_id: runtimeTaskId, turn_id: runtimeTurnId, authority_digest: retryAuthority.digest, execution: {exit_code: 130, mutation_count: 0, deletion_count: 0}}, retry: retryRequest, authorityDigest: retryAuthority, preflight: retryPreflight, ledger: retryLedger});
assert.equal(retryDuplicate.status, COMMAND_PATH_DUPLICATE_RETRY_REJECTED);

const storageDecision = compileStorageAutopilotDecision({
  receiptId: "STORAGE.CLOSEOUT.037",
  observedAtUtc: "2026-08-26T18:00:00.000Z",
  freeGib: 81,
});
validateStorageAutopilotDecision(storageDecision);
const storageLifecycle = createCloseoutLifecycle({
  taskId: "TASK-STORAGE-CLOSEOUT-037",
  turnId: "TURN-STORAGE-CLOSEOUT-037",
  laneId: "ROUTE-037",
  candidate: {commit: "d".repeat(40), tree: "e".repeat(40)},
  handoffSha256: "f".repeat(64),
  auditor: "AUDITOR-STORAGE-037",
  custodyGeneration: "CUSTODY-STORAGE-037",
  storageDecision,
});
assert.equal(storageLifecycle.read().storage_decision.receipt_sha256, storageDecision.receipt_sha256);

const dualKeyWriter = {role: DUAL_KEY_WORKER_ROLE, task_id: "WORKER-LIFECYCLE-DUAL-KEY", model: "gpt-5.6-luna"};
const dualKeyAuditor = {role: DUAL_KEY_AUDITOR_ROLE, task_id: "AUDITOR-LIFECYCLE-DUAL-KEY", model: "gpt-5.6-luna", read_only: true, can_write: false};
let dualKey = createDualKeyRepairLoop({issueId: "ISSUE-LIFECYCLE-DUAL-KEY", writer: dualKeyWriter, auditor: dualKeyAuditor});
dualKey = transitionDualKeyRepairLoop(dualKey, {to: "WORKING", actor: dualKeyWriter});
dualKey = freezeDualKeyCandidate(dualKey, {actor: dualKeyWriter, candidate: {candidate_id: "CANDIDATE-LIFECYCLE-DUAL-KEY", commit: "a".repeat(40), tree: "b".repeat(40), parent: "c".repeat(40)}});
dualKey = routeDualKeyCandidateToAuditor(dualKey, {actor: dualKeyWriter, recipientTaskId: dualKeyAuditor.task_id});
dualKey = recordDualKeyAuditorVerdict(dualKey, {actor: dualKeyAuditor, verdict: {status: "PASS", evidence_sha256: "d".repeat(64)}});
const runtimeDelivery = authorizeRuntimeOnlyDelivery(dualKey, {actor: {role: DUAL_KEY_RUNTIME_ROLE, task_id: "RUNTIME-LIFECYCLE-DUAL-KEY"}});
assert.equal(runtimeDelivery.allowed, true);
const fallback = createBlankProjectionFallback({
  taskId: "TASK-LIFECYCLE-FALLBACK",
  turnId: "TURN-LIFECYCLE-FALLBACK",
  projection: {status: "completed", items: [], items_count: 0},
  durableResult: {status: "PASS", task_id: "TASK-LIFECYCLE-FALLBACK", turn_id: "TURN-LIFECYCLE-FALLBACK", evidence_sha256: "e".repeat(64)},
});
assert.equal(fallback.classification, "DURABLE_RESULT_RECOVERED");
const fallbackBlocked = createBlankProjectionFallback({
  taskId: "TASK-LIFECYCLE-BLOCKED",
  turnId: "TURN-LIFECYCLE-BLOCKED",
  projection: {status: "completed", items: [], items_count: 0},
  controllerEvidence: {role: DUAL_KEY_CONTROLLER_ROLE, evidence_complete: true, evidence_sha256: "f".repeat(64)},
});
assert.equal(fallbackBlocked.status, "TRUE_BLOCKED");
const failureLedger = createFailureDedupeLedger();
const failure = {issue_id: "ISSUE-LIFECYCLE-DUAL-KEY", candidate_id: "CANDIDATE-LIFECYCLE-DUAL-KEY", failure_class: "BOUNDED_FAIL", evidence_sha256: "1".repeat(64)};
assert.equal(deduplicateFailure({failure, ledger: failureLedger}).duplicate, false);
assert.equal(deduplicateFailure({failure, ledger: failureLedger}).duplicate, true);

// Scheduler projection/liveness triangulation: a blank app view never proves
// a stall while any durable, material, process, or lease source advances.
const projectionLivenessBase = {
  taskId: "TASK-PROJECTION-LAG-037",
  laneId: "LANE-PROJECTION-037",
  projection: {status: "COMPLETED", items: [], items_count: 0, source: "SYNTHETIC_APP"},
  durableSession: {session_id: "SESSION-PROJECTION-037", ordinal: 1, mtime: 100, activity: "activity-one"},
  observedAtUtc: "2026-08-28T15:00:00.000Z",
};
const recoveryRequired = compileSchedulerProjectionLivenessObservation(projectionLivenessBase);
assert.equal(recoveryRequired.classification, ACTIVE_OR_PROJECTION_LAG);
assert.equal(recoveryRequired.stalled, false);
assert.equal(recoveryRequired.replacement_allowed, false);
validateSchedulerProjectionLivenessObservation(recoveryRequired);
const recoveryRequiredAfterRecheck = compileSchedulerProjectionLivenessObservation({
  ...projectionLivenessBase,
  previousObservation: recoveryRequired,
  recoveryAttempt: 0,
});
assert.equal(recoveryRequiredAfterRecheck.classification, SAME_TASK_RECOVERY_REQUIRED);
const ordinalAdvanced = compileSchedulerProjectionLivenessObservation({
  ...projectionLivenessBase,
  durableSession: {...projectionLivenessBase.durableSession, ordinal: 2, mtime: 200, activity: "activity-two"},
  previousObservation: recoveryRequired,
});
assert.equal(ordinalAdvanced.classification, ACTIVE_OR_PROJECTION_LAG);
assert.equal(ordinalAdvanced.stalled, false);
assert.equal(ordinalAdvanced.same_task_recovery_required, false);
const materialReceipt = compileSchedulerProjectionLivenessObservation({
  ...projectionLivenessBase,
  previousObservation: recoveryRequired,
  receipts: [{receipt_id: "RECEIPT-MATERIAL-037", material: true, status: "PASS"}],
});
assert.equal(materialReceipt.classification, ACTIVE_OR_PROJECTION_LAG);
const liveProcess = compileSchedulerProjectionLivenessObservation({
  ...projectionLivenessBase,
  previousObservation: recoveryRequired,
  processes: [{process_id: "PROCESS-037", active: true}],
});
assert.equal(liveProcess.classification, ACTIVE_OR_PROJECTION_LAG);
const activeLease = compileSchedulerProjectionLivenessObservation({
  ...projectionLivenessBase,
  previousObservation: recoveryRequired,
  leases: [{lease_id: "LEASE-037", status: "ACTIVE"}],
});
assert.equal(activeLease.classification, ACTIVE_OR_PROJECTION_LAG);
assert.throws(() => compileSchedulerProjectionLivenessObservation({
  ...projectionLivenessBase,
  recoveryAttempt: 1,
  maxRecoveryAttempts: 1,
  escalationLedger: createMaterialLivenessEscalationLedger(),
}), /same-task prior observation is required/u);
assert.throws(() => compileSchedulerProjectionLivenessObservation({
  ...projectionLivenessBase,
  laneId: "LANE-PROJECTION-OTHER",
  previousObservation: recoveryRequired,
  recoveryAttempt: 1,
  maxRecoveryAttempts: 1,
  escalationLedger: createMaterialLivenessEscalationLedger(),
}), /same-task prior observation is required/u);
const forgedPriorObservation = structuredClone(recoveryRequired);
forgedPriorObservation.receipt_sha256 = "0".repeat(64);
assert.throws(() => compileSchedulerProjectionLivenessObservation({
  ...projectionLivenessBase,
  previousObservation: forgedPriorObservation,
  recoveryAttempt: 1,
  maxRecoveryAttempts: 1,
  escalationLedger: createMaterialLivenessEscalationLedger(),
}), /prior observation is not content-bound/u);
const stagnantLedger = createMaterialLivenessEscalationLedger();
const stagnant = compileSchedulerProjectionLivenessObservation({
  ...projectionLivenessBase,
  previousObservation: recoveryRequired,
  recoveryAttempt: 1,
  maxRecoveryAttempts: 1,
  escalationLedger: stagnantLedger,
});
assert.equal(stagnant.classification, MATERIAL_LIVENESS_STAGNANT);
assert.equal(stagnant.stalled, true);
assert.equal(stagnant.escalation.classification, TYPED_HOST_CAPABILITY_ESCALATION);
assert.equal(stagnant.escalation.emitted, true);
validateSchedulerProjectionLivenessObservation(stagnant);
const resealLivenessObservation = (observation) => {
  observation.receipt_sha256 = canonicalDigest({...observation, receipt_sha256: null});
  return observation;
};
const missingPriorAtValidator = structuredClone(stagnant);
delete missingPriorAtValidator.prior_observation;
delete missingPriorAtValidator.prior_observation_sha256;
resealLivenessObservation(missingPriorAtValidator);
assert.throws(() => validateSchedulerProjectionLivenessObservation(missingPriorAtValidator), /same-task prior observation is required/u);
const forgedPriorAtValidator = structuredClone(stagnant);
forgedPriorAtValidator.prior_observation.receipt_sha256 = "0".repeat(64);
forgedPriorAtValidator.prior_observation_sha256 = forgedPriorAtValidator.prior_observation.receipt_sha256;
resealLivenessObservation(forgedPriorAtValidator);
assert.throws(() => validateSchedulerProjectionLivenessObservation(forgedPriorAtValidator), /prior observation is not content-bound/u);
const wrongTaskPriorAtValidator = structuredClone(stagnant);
wrongTaskPriorAtValidator.prior_observation.task_id = "TASK-PROJECTION-OTHER";
resealLivenessObservation(wrongTaskPriorAtValidator.prior_observation);
wrongTaskPriorAtValidator.prior_observation_sha256 = wrongTaskPriorAtValidator.prior_observation.receipt_sha256;
resealLivenessObservation(wrongTaskPriorAtValidator);
assert.throws(() => validateSchedulerProjectionLivenessObservation(wrongTaskPriorAtValidator), /same-task prior observation is required/u);
const wrongOrderPriorAtValidator = structuredClone(stagnant);
wrongOrderPriorAtValidator.prior_observation.recovery.attempt = 1;
resealLivenessObservation(wrongOrderPriorAtValidator.prior_observation);
wrongOrderPriorAtValidator.prior_observation_sha256 = wrongOrderPriorAtValidator.prior_observation.receipt_sha256;
resealLivenessObservation(wrongOrderPriorAtValidator);
assert.throws(() => validateSchedulerProjectionLivenessObservation(wrongOrderPriorAtValidator), /prior observation must precede/u);
const duplicateEscalation = deduplicateMaterialLivenessEscalation({escalation: stagnant.escalation, ledger: stagnantLedger});
assert.equal(duplicateEscalation.duplicate, true);
assert.equal(duplicateEscalation.emitted, false);
assert.throws(() => validateSchedulerProjectionLivenessObservation({...stagnant, replacement_allowed: true}), /replacement/u);

console.log("PASS campaign closeout lifecycle: durable projection divergence, PASS/FAIL/blocker recovery, exact correlation, stability gating, exactly-once consumption, no replay, and ordered audit closeout");
