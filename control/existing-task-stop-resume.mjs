#!/usr/bin/env node

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";

export const EXISTING_TASK_STOP_RESUME_SCHEMA = "agentos.existing_task_stop_resume.v1";
export const EXISTING_TASK_STOP_RESUME_VERSION = 1;
export const EXISTING_TASK_STATES = Object.freeze([
  "OBSERVING",
  "STUCK_CONFIRMED",
  "STOP_SENT",
  "TURN_ENDED_IDLE",
  "CUSTODY_REVALIDATED",
  "RESUME_SENT",
  "SAME_TASK_RETRY_FAILED",
  "RESUMED_SAME_TASK",
  "REPLACEMENT_AUTHORIZED",
  "REPLACEMENT_ACTIVE",
  "RETIRED",
  "ESCALATED_FAIL_CLOSED",
]);

const SHA256 = /^[0-9a-f]{64}$/u;
const STABLE = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u;
const TERMINAL_EVENTS = new Set(["completed", "systemError", "stopped", "cancelled"]);
const ORDINARY_ROUTES = new Set(["CANDIDATE", "AUDIT", "REMEDIATION", "NEXT_SEAM"]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireStable(value, label) {
  assert(typeof value === "string" && STABLE.test(value), `${label} must be stable`);
}

function requireText(value, label) {
  assert(typeof value === "string" && value.trim().length > 0 && !/[\u0000-\u001f\u007f]/u.test(value), `${label} must be nonempty text`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function sortedUnique(values, label) {
  assert(Array.isArray(values), `${label} must be an array`);
  values.forEach((value, index) => requireStable(value, `${label}[${index}]`));
  const sorted = [...values].sort(compareUtf8);
  assert(new Set(sorted).size === sorted.length && JSON.stringify(values) === JSON.stringify(sorted), `${label} must be sorted and unique`);
}

function body(record) {
  const copy = structuredClone(record);
  copy.record_sha256 = null;
  return copy;
}

function reseal(record) {
  const copy = structuredClone(record);
  copy.record_sha256 = canonicalDigest(body(copy));
  return copy;
}

function immutableBinding(binding) {
  assert(isRecord(binding), "lifecycle binding must be an object");
  const required = ["role", "model", "reasoning_effort", "cwd", "branch", "worktree", "queue_id", "seam_id", "basis_sha256"];
  assert(JSON.stringify(Object.keys(binding).sort(compareUtf8)) === JSON.stringify([...required].sort(compareUtf8)), "lifecycle binding fields mismatch");
  for (const key of required.slice(0, -1)) {
    if (key === "cwd" || key === "worktree") requireText(binding[key], `lifecycle binding ${key}`);
    else requireStable(binding[key], `lifecycle binding ${key}`);
  }
  requireSha(binding.basis_sha256, "lifecycle binding basis");
  return structuredClone(binding);
}

function packetBody(packet) {
  return {packet_id: packet.packet_id, queue_id: packet.queue_id, payload_refs: [...packet.payload_refs]};
}

function validatePacket(packet) {
  assert(isRecord(packet), "lifecycle packet must be an object");
  requireStable(packet.packet_id, "lifecycle packet ID");
  requireStable(packet.queue_id, "lifecycle packet queue ID");
  assert(Number.isInteger(packet.delivery_count) && packet.delivery_count >= 0, "lifecycle packet delivery count is invalid");
  assert(Array.isArray(packet.payload_refs), "lifecycle packet payload refs must be an array");
  sortedUnique(packet.payload_refs, "lifecycle packet payload refs");
  requireSha(packet.packet_sha256, "lifecycle packet digest");
  assert(packet.packet_sha256 === canonicalDigest(packetBody(packet)), "lifecycle packet digest mismatch");
}

export function compileExistingTaskLifecycle({operationId, nonce, projectCampaignId, taskId, hostId, activeTurnId, pinnedThreads, binding, custodySha256, packetId, payloadRefs = [], checkpointRef, checkpointSha256, preservationTerms, smallestPendingTransition} = {}) {
  requireStable(operationId, "lifecycle operation ID");
  requireStable(nonce, "lifecycle nonce");
  requireStable(taskId, "lifecycle task ID");
  requireStable(projectCampaignId, "project and campaign identity");
  requireStable(hostId, "lifecycle host ID");
  requireStable(activeTurnId, "active turn ID");
  requireStable(checkpointRef, "checkpoint reference");
  requireSha(checkpointSha256, "checkpoint digest");
  requireText(preservationTerms, "STOP preservation terms");
  requireText(smallestPendingTransition, "smallest pending transition");
  requireSha(custodySha256, "lifecycle custody digest");
  sortedUnique(pinnedThreads, "fresh pinnedThreads");
  assert(pinnedThreads.includes(taskId), "fresh pinnedThreads does not contain the exact task ID");
  sortedUnique(payloadRefs, "packet payload refs");
  const exactBinding = immutableBinding(binding);
  const packet = {packet_id: packetId, queue_id: exactBinding.queue_id, delivery_count: 0, payload_refs: [...payloadRefs], packet_sha256: null};
  packet.packet_sha256 = canonicalDigest(packetBody(packet));
  const record = {
    schema: EXISTING_TASK_STOP_RESUME_SCHEMA,
    version: EXISTING_TASK_STOP_RESUME_VERSION,
    operation_id: operationId,
    nonce,
    state: "OBSERVING",
    project_campaign_id: projectCampaignId,
    task_id: taskId,
    host_id: hostId,
    active_turn_id: activeTurnId,
    replacement_task_id: null,
    binding: exactBinding,
    custody_sha256: custodySha256,
    pinned_task_id: taskId,
    old_task_retired: false,
    writer_task_id: taskId,
    observations: [],
    last_material_receipt_sha256: null,
    checkpoint: {reference: checkpointRef, sha256: checkpointSha256},
    preservation_terms: preservationTerms,
    smallest_pending_transition: smallestPendingTransition,
    escalation_reason: null,
    stop: {requested: false, event_finalized: false, finalized_status: null},
    same_task: {harmless_probe_attempted: false, substantive_retry_attempted: false, exhausted: false},
    replacement: {role_lock_nonce: null, authorized: false, consumed: false},
    replacement_output: null,
    recovery_prompt_count: 0,
    packet,
    transition_sequence: 0,
    transition_parent_sha256: null,
    record_sha256: null,
  };
  return reseal(validateExistingTaskLifecycle(reseal(record)));
}

export function validateExistingTaskLifecycle(record) {
  assert(isRecord(record), "existing-task lifecycle must be an object");
  assert(record.schema === EXISTING_TASK_STOP_RESUME_SCHEMA && record.version === 1, "existing-task lifecycle identity is invalid");
  requireStable(record.operation_id, "lifecycle operation ID");
  requireStable(record.nonce, "lifecycle nonce");
  assert(EXISTING_TASK_STATES.includes(record.state), "existing-task lifecycle state is invalid");
  requireStable(record.task_id, "lifecycle task ID");
  requireStable(record.project_campaign_id, "project and campaign identity");
  requireStable(record.host_id, "lifecycle host ID");
  requireStable(record.active_turn_id, "active turn ID");
  if (record.replacement_task_id !== null) requireStable(record.replacement_task_id, "replacement task ID");
  immutableBinding(record.binding);
  requireSha(record.custody_sha256, "lifecycle custody digest");
  requireStable(record.pinned_task_id, "pinned task ID");
  requireStable(record.writer_task_id, "writer task ID");
  assert(Array.isArray(record.observations), "lifecycle observations must be an array");
  if (record.last_material_receipt_sha256 !== null) requireSha(record.last_material_receipt_sha256, "last material receipt digest");
  assert(isRecord(record.checkpoint), "lifecycle checkpoint must be an object");
  requireStable(record.checkpoint.reference, "lifecycle checkpoint reference");
  requireSha(record.checkpoint.sha256, "lifecycle checkpoint digest");
  requireText(record.preservation_terms, "STOP preservation terms");
  requireText(record.smallest_pending_transition, "smallest pending transition");
  if (record.escalation_reason !== null) requireStable(record.escalation_reason, "lifecycle escalation reason");
  assert(typeof record.old_task_retired === "boolean", "old task retirement flag is invalid");
  assert(isRecord(record.stop) && typeof record.stop.requested === "boolean" && typeof record.stop.event_finalized === "boolean", "lifecycle stop state is invalid");
  assert(record.stop.finalized_status === null || typeof record.stop.finalized_status === "string", "lifecycle finalized status is invalid");
  assert(isRecord(record.same_task) && typeof record.same_task.harmless_probe_attempted === "boolean" && typeof record.same_task.substantive_retry_attempted === "boolean" && typeof record.same_task.exhausted === "boolean", "same-task state is invalid");
  assert(isRecord(record.replacement) && (record.replacement.role_lock_nonce === null || typeof record.replacement.role_lock_nonce === "string") && typeof record.replacement.authorized === "boolean" && typeof record.replacement.consumed === "boolean", "replacement state is invalid");
  assert(record.replacement_output === null || isRecord(record.replacement_output), "replacement output custody is invalid");
  assert(Number.isInteger(record.recovery_prompt_count) && record.recovery_prompt_count >= 0, "recovery prompt count is invalid");
  assert(Number.isSafeInteger(record.transition_sequence) && record.transition_sequence >= 0, "lifecycle transition sequence is invalid");
  assert(record.transition_parent_sha256 === null || SHA256.test(record.transition_parent_sha256), "lifecycle transition parent digest is invalid");
  if (record.transition_sequence === 0) {
    assert(record.transition_parent_sha256 === null && record.state === "OBSERVING", "lifecycle genesis provenance is invalid");
  } else {
    assert(record.transition_parent_sha256 !== null && record.transition_parent_sha256 !== record.record_sha256, "lifecycle transition provenance is missing or self-referential");
  }
  validatePacket(record.packet);
  requireSha(record.record_sha256, "lifecycle record digest");
  assert(record.record_sha256 === canonicalDigest(body(record)), "lifecycle record digest mismatch");
  validateStateInvariants(record);
  return record;
}

function validateStateInvariants(record) {
  const {state, stop, same_task: sameTask, replacement, replacement_task_id: replacementTaskId} = record;
  const stopFinalized = stop.event_finalized;
  const terminal = TERMINAL_EVENTS.has(stop.finalized_status);
  const preStop = ["OBSERVING", "STUCK_CONFIRMED"];
  const postStop = ["TURN_ENDED_IDLE", "CUSTODY_REVALIDATED", "RESUME_SENT", "RESUMED_SAME_TASK", "SAME_TASK_RETRY_FAILED", "REPLACEMENT_AUTHORIZED", "REPLACEMENT_ACTIVE", "RETIRED"];
  const initialReplacement = replacementTaskId === null && !record.old_task_retired && !replacement.authorized && !replacement.consumed && replacement.role_lock_nonce === null;
  const oldTaskPinned = record.pinned_task_id === record.task_id && record.writer_task_id === record.task_id;

  if (stopFinalized) {
    assert(stop.requested && terminal, "finalized host event lacks STOP request or terminal status");
  } else {
    assert(stop.finalized_status === null, "unfinalized host event carries a terminal status");
  }

  if (preStop.includes(state)) {
    assert(!stop.requested && !stopFinalized && initialReplacement && oldTaskPinned, "pre-STOP lifecycle state contains post-STOP mutations");
    assert(!sameTask.harmless_probe_attempted && !sameTask.substantive_retry_attempted && !sameTask.exhausted, "pre-STOP lifecycle state contains retry evidence");
    assert(record.escalation_reason === null, "ordinary lifecycle state contains an escalation reason");
    return;
  }

  if (state === "STOP_SENT") {
    assert(stop.requested && !stopFinalized && initialReplacement && oldTaskPinned, "STOP_SENT lifecycle state is not an unfinalized STOP");
    assert(!sameTask.harmless_probe_attempted && !sameTask.substantive_retry_attempted && !sameTask.exhausted, "STOP_SENT lifecycle state contains retry evidence");
    assert(record.escalation_reason === null, "ordinary lifecycle state contains an escalation reason");
    return;
  }

  if (postStop.includes(state)) {
    assert(stop.requested && stopFinalized && terminal, "post-STOP lifecycle state lacks a finalized terminal host event");
  }

  if (["TURN_ENDED_IDLE", "CUSTODY_REVALIDATED", "RESUME_SENT"].includes(state)) {
    assert(initialReplacement && oldTaskPinned, "pre-retry lifecycle state contains replacement metadata");
    assert(!sameTask.harmless_probe_attempted && !sameTask.substantive_retry_attempted && !sameTask.exhausted, "pre-retry lifecycle state contains retry evidence");
    assert(record.escalation_reason === null, "ordinary lifecycle state contains an escalation reason");
    return;
  }

  if (state === "RESUMED_SAME_TASK") {
    assert(initialReplacement && oldTaskPinned, "same-task resume contains replacement metadata");
    assert(sameTask.harmless_probe_attempted && sameTask.substantive_retry_attempted && !sameTask.exhausted, "same-task resume evidence is incomplete");
    assert(record.escalation_reason === null, "ordinary lifecycle state contains an escalation reason");
    return;
  }

  if (state === "SAME_TASK_RETRY_FAILED") {
    assert(sameTask.harmless_probe_attempted && sameTask.substantive_retry_attempted && sameTask.exhausted, "same-task exhaustion evidence is incomplete");
    if (replacement.consumed) {
      assert(record.old_task_retired && replacement.authorized && replacementTaskId !== null && record.pinned_task_id === replacementTaskId && record.writer_task_id === replacementTaskId, "consumed replacement lacks retired-task and single-writer evidence");
    } else {
      assert(initialReplacement && oldTaskPinned, "unconsumed retry failure contains replacement metadata");
    }
    assert(record.escalation_reason === null, "ordinary lifecycle state contains an escalation reason");
    return;
  }

  if (state === "REPLACEMENT_AUTHORIZED") {
    assert(sameTask.harmless_probe_attempted && sameTask.substantive_retry_attempted && sameTask.exhausted, "replacement authorization lacks same-task exhaustion evidence");
    assert(replacementTaskId !== null && record.old_task_retired && replacement.authorized && !replacement.consumed && replacement.role_lock_nonce !== null && oldTaskPinned, "replacement authorization is not single, retired, and pinned to the old task");
    assert(record.escalation_reason === null, "ordinary lifecycle state contains an escalation reason");
    return;
  }

  if (["REPLACEMENT_ACTIVE", "RETIRED"].includes(state)) {
    assert(sameTask.harmless_probe_attempted && sameTask.substantive_retry_attempted && sameTask.exhausted, "active replacement lacks same-task exhaustion evidence");
    assert(replacementTaskId !== null && record.old_task_retired && replacement.authorized && replacement.consumed && record.pinned_task_id === replacementTaskId && record.writer_task_id === replacementTaskId, "replacement permits duplicate writers or pin rollback");
    assert(record.escalation_reason === null, "ordinary lifecycle state contains an escalation reason");
    return;
  }

  if (state === "ESCALATED_FAIL_CLOSED") {
    assert(record.escalation_reason !== null, "fail-closed lifecycle state lacks an escalation reason");
    assert(initialReplacement && oldTaskPinned && !sameTask.harmless_probe_attempted && !sameTask.substantive_retry_attempted && !sameTask.exhausted, "fail-closed escalation carries replacement or retry authority");
  }
}

function transition(record, mutate) {
  validateExistingTaskLifecycle(record);
  const next = structuredClone(record);
  mutate(next);
  next.transition_sequence += 1;
  next.transition_parent_sha256 = record.record_sha256;
  return validateExistingTaskLifecycle(reseal(next));
}

export function requestExistingTaskStop(record, {operationId, nonce, taskId} = {}) {
  return transition(record, (next) => {
    assert(next.state === "STUCK_CONFIRMED", "STOP requires repeated fresh stuck observations");
    assert(operationId === next.operation_id && nonce === next.nonce && taskId === next.task_id, "STOP identity mismatch");
    next.stop.requested = true;
    next.state = "STOP_SENT";
  });
}

export function observeExistingTaskLiveness(record, {taskId, hostId, turnId, observationSha256, processCount, materialReceiptSha256, recoveryPromptConsumed} = {}) {
  return transition(record, (next) => {
    assert(["OBSERVING", "STUCK_CONFIRMED"].includes(next.state), "liveness observation is out of order");
    assert(taskId === next.task_id && hostId === next.host_id && turnId === next.active_turn_id, "liveness observation task, host, or turn mismatch");
    requireSha(observationSha256, "liveness observation digest");
    requireSha(materialReceiptSha256, "material receipt digest");
    assert(Number.isInteger(processCount) && processCount >= 0, "relevant process count is invalid");
    assert(typeof recoveryPromptConsumed === "boolean", "recovery prompt readback is invalid");
    assert(!next.observations.some((entry) => entry.observation_sha256 === observationSha256), "liveness observation replay detected");
    const stale = processCount === 0 && !recoveryPromptConsumed && (next.last_material_receipt_sha256 === null || materialReceiptSha256 === next.last_material_receipt_sha256);
    if (!stale) {
      next.observations = [];
      next.state = "OBSERVING";
    } else {
      next.observations.push({observation_sha256: observationSha256, process_count: processCount, material_receipt_sha256: materialReceiptSha256, recovery_prompt_consumed: recoveryPromptConsumed});
      next.state = next.observations.length >= 2 ? "STUCK_CONFIRMED" : "OBSERVING";
    }
    next.last_material_receipt_sha256 = materialReceiptSha256;
  });
}

export function compileExactStopMessage(record, {operationId, nonce, preservationTerms} = {}) {
  validateExistingTaskLifecycle(record);
  assert(record.state === "STUCK_CONFIRMED", "STOP message requires confirmed stuck state");
  assert(operationId === record.operation_id && nonce === record.nonce, "STOP message identity mismatch");
  assert(preservationTerms === record.preservation_terms, "STOP preservation terms changed");
  return `STOP\n${record.preservation_terms}`;
}

export function finalizeExistingTaskHostEvent(record, {taskIndex, turnStatus, processes, materialReceiptSha256} = {}) {
  return transition(record, (next) => {
    assert(next.state === "STOP_SENT", "host event finalization is out of order");
    assert(isRecord(taskIndex) && taskIndex.task_id === next.task_id && taskIndex.host_id === next.host_id, "fresh task index identity mismatch");
    assert(TERMINAL_EVENTS.has(turnStatus), "host event is not finalized");
    assert(Array.isArray(processes) && processes.length === 0, "task still owns a live process");
    requireSha(materialReceiptSha256, "material receipt digest");
    assert(next.last_material_receipt_sha256 === materialReceiptSha256, "finalized host event material receipt is not bound to the latest material evidence");
    assert(taskIndex.active !== true || turnStatus === "systemError", "stale active task index may only be overridden by finalized systemError");
    next.stop.event_finalized = true;
    next.stop.finalized_status = turnStatus;
    next.state = "TURN_ENDED_IDLE";
  });
}

export function revalidateExistingTaskCustody(record, {custodySha256, unstagedCount, untrackedCount, processes} = {}) {
  return transition(record, (next) => {
    assert(next.state === "TURN_ENDED_IDLE", "custody revalidation is out of order");
    requireSha(custodySha256, "revalidated custody digest");
    assert(custodySha256 === next.custody_sha256, "task custody changed across STOP");
    assert(unstagedCount === 0 && untrackedCount === 0, "task custody is dirty");
    assert(Array.isArray(processes) && processes.length === 0, "task still owns a process");
    next.state = "CUSTODY_REVALIDATED";
  });
}

export function sendExistingTaskResume(record, {taskId, hostId, checkpointRef, checkpointSha256, smallestPendingTransition} = {}) {
  return transition(record, (next) => {
    assert(next.state === "CUSTODY_REVALIDATED", "same-task resume is out of order");
    assert(taskId === next.task_id && hostId === next.host_id, "same-task resume identity mismatch");
    assert(checkpointRef === next.checkpoint.reference && checkpointSha256 === next.checkpoint.sha256, "same-task resume checkpoint mismatch");
    assert(smallestPendingTransition === next.smallest_pending_transition, "same-task resume transition mismatch");
    next.state = "RESUME_SENT";
  });
}

export function resumeExistingTask(record, {taskId, pinnedThreads, harmlessProbeAvailable, substantiveRetryAvailable, custodySha256} = {}) {
  return transition(record, (next) => {
    assert(next.state === "RESUME_SENT", "same-task resume readback is out of order");
    sortedUnique(pinnedThreads, "fresh pinnedThreads");
    assert(taskId === next.task_id && pinnedThreads.includes(next.task_id), "fresh pinnedThreads does not contain the exact resumed task ID");
    assert(custodySha256 === next.custody_sha256, "same-task resume changed custody");
    assert(harmlessProbeAvailable === true && substantiveRetryAvailable === true, "same-task retry is unavailable");
    next.same_task.harmless_probe_attempted = true;
    next.same_task.substantive_retry_attempted = true;
    next.state = "RESUMED_SAME_TASK";
  });
}

export function exhaustExistingTask(record, {taskId, pinnedThreads, harmlessProbeOutcome, substantiveRetryOutcome} = {}) {
  return transition(record, (next) => {
    assert(next.state === "CUSTODY_REVALIDATED", "same-task exhaustion is out of order");
    sortedUnique(pinnedThreads, "fresh pinnedThreads");
    assert(taskId === next.task_id && pinnedThreads.includes(next.task_id), "fresh pinnedThreads does not retain the exact task ID");
    assert(["PASSED", "FAILED", "UNAVAILABLE"].includes(harmlessProbeOutcome), "harmless same-task probe outcome is invalid");
    assert(["FAILED", "UNAVAILABLE"].includes(substantiveRetryOutcome), "same-task exhaustion is incomplete");
    next.same_task.harmless_probe_attempted = true;
    // UNAVAILABLE is still a completed substantive attempt; it cannot silently
    // manufacture an exhausted state with a missing retry leg.
    next.same_task.substantive_retry_attempted = true;
    next.same_task.exhausted = true;
    next.state = "SAME_TASK_RETRY_FAILED";
  });
}

export function escalateExistingTaskLifecycle(record, {reason} = {}) {
  return transition(record, (next) => {
    assert(["STOP_UNCONSUMED", "CUSTODY_CHANGED", "SAME_TASK_RESUME_UNAVAILABLE"].includes(reason), "lifecycle escalation reason is invalid");
    next.escalation_reason = reason;
    next.state = "ESCALATED_FAIL_CLOSED";
  });
}

export function authorizeSingleReplacement(record, {replacementTaskId, roleLockNonce, binding, oldTaskRetired, oldTaskProcesses, pinnedThreads} = {}) {
  return transition(record, (next) => {
    assert(next.state === "SAME_TASK_RETRY_FAILED" && next.same_task.exhausted, "replacement requires same-task exhaustion");
    requireStable(replacementTaskId, "replacement task ID");
    assert(replacementTaskId !== next.task_id, "replacement task must be distinct");
    assert(roleLockNonce === next.nonce, "replacement role lock nonce mismatch");
    assert(JSON.stringify(immutableBinding(binding)) === JSON.stringify(next.binding), "replacement changed role or custody binding");
    const retirementEvidence = next.stop.event_finalized && TERMINAL_EVENTS.has(next.stop.finalized_status) && next.last_material_receipt_sha256 !== null && Array.isArray(oldTaskProcesses) && oldTaskProcesses.length === 0;
    assert(retirementEvidence, "old task retirement evidence is missing or not inert");
    // The caller flag is only a consistency attestation. Retirement authority
    // comes from the validated finalized event and inert-process reread above.
    assert(oldTaskRetired === true, "old task retirement attestation contradicts lifecycle evidence");
    sortedUnique(pinnedThreads, "fresh pinnedThreads");
    assert(!pinnedThreads.includes(replacementTaskId), "replacement pin transferred before retirement authorization");
    assert(next.replacement.authorized === false && next.replacement.consumed === false, "replacement role lock already consumed");
    next.old_task_retired = true;
    next.replacement_task_id = replacementTaskId;
    next.replacement.role_lock_nonce = roleLockNonce;
    next.replacement.authorized = true;
    next.state = "REPLACEMENT_AUTHORIZED";
  });
}

export function activateSingleReplacement(record, {replacementTaskId, pinnedThreads, writerTaskIds} = {}) {
  return transition(record, (next) => {
    assert(next.state === "REPLACEMENT_AUTHORIZED" && next.replacement.authorized && !next.replacement.consumed, "replacement is not singly authorized");
    sortedUnique(pinnedThreads, "fresh pinnedThreads");
    sortedUnique(writerTaskIds, "writer task IDs");
    assert(replacementTaskId === next.replacement_task_id, "replacement task identity mismatch");
    assert(pinnedThreads.includes(replacementTaskId) && !pinnedThreads.includes(next.task_id), "pin transfer did not follow retirement");
    assert(writerTaskIds.length === 1 && writerTaskIds[0] === replacementTaskId, "duplicate writer detected");
    next.pinned_task_id = replacementTaskId;
    next.writer_task_id = replacementTaskId;
    next.replacement.consumed = true;
    next.state = "REPLACEMENT_ACTIVE";
  });
}

export function deliverLifecyclePacket(record, {taskId, packetSha256, expectedDeliveryCount} = {}) {
  return transition(record, (next) => {
    assert(taskId === next.writer_task_id, "packet delivery target is not the sole writer");
    assert(packetSha256 === next.packet.packet_sha256, "packet digest changed during delivery");
    assert(expectedDeliveryCount === next.packet.delivery_count, "packet delivery replay or reset detected");
    next.packet.delivery_count += 1;
  });
}

export function recordReplacementMaterialOutput(record, {taskId, priorCustodySha256, custodySha256, trackedStateSha256, untrackedStateSha256, materialReceiptSha256} = {}) {
  return transition(record, (next) => {
    assert(next.state === "REPLACEMENT_ACTIVE" && taskId === next.replacement_task_id, "replacement material output identity mismatch");
    for (const [value, label] of [[priorCustodySha256, "prior custody"], [custodySha256, "material custody"], [trackedStateSha256, "tracked state"], [untrackedStateSha256, "untracked state"], [materialReceiptSha256, "material receipt"]]) requireSha(value, label);
    assert(priorCustodySha256 === next.custody_sha256 && custodySha256 !== priorCustodySha256, "replacement output is not a material custody transition");
    next.custody_sha256 = custodySha256;
    next.replacement_output = {tracked_state_sha256: trackedStateSha256, untracked_state_sha256: untrackedStateSha256, material_receipt_sha256: materialReceiptSha256};
  });
}

export function recordReplacementRecoveryPrompt(record, {taskId, packetSha256, expectedPromptCount} = {}) {
  return transition(record, (next) => {
    assert(next.state === "REPLACEMENT_ACTIVE" && taskId === next.replacement_task_id, "replacement recovery prompt identity mismatch");
    assert(packetSha256 === next.packet.packet_sha256, "replacement recovery prompt packet mismatch");
    assert(expectedPromptCount === next.recovery_prompt_count && expectedPromptCount === 0, "duplicate replacement recovery prompt denied");
    next.recovery_prompt_count += 1;
  });
}

export function finalizeReplacementHostRecovery(record, {taskIndex, turnStatus, processes, custodySha256, trackedStateSha256, untrackedStateSha256, materialReceiptSha256} = {}) {
  return transition(record, (next) => {
    assert(next.state === "REPLACEMENT_ACTIVE" && next.recovery_prompt_count === 1, "replacement recovery finalization is out of order");
    assert(isRecord(taskIndex) && taskIndex.task_id === next.replacement_task_id && taskIndex.host_id === next.host_id, "replacement task index identity mismatch");
    assert(TERMINAL_EVENTS.has(turnStatus), "replacement host event is not finalized");
    assert(Array.isArray(processes) && processes.length === 0, "replacement task still owns a live process");
    assert(next.replacement_output !== null, "replacement material output custody is missing");
    assert(custodySha256 === next.custody_sha256, "replacement custody changed during host recovery");
    assert(trackedStateSha256 === next.replacement_output.tracked_state_sha256 && untrackedStateSha256 === next.replacement_output.untracked_state_sha256, "tracked or untracked replacement bytes changed");
    requireSha(materialReceiptSha256, "replacement recovery material receipt digest");
    assert(materialReceiptSha256 === next.replacement_output.material_receipt_sha256, "replacement final receipt is not bound to material output evidence");
    next.same_task.harmless_probe_attempted = true;
    next.same_task.substantive_retry_attempted = true;
    next.same_task.exhausted = true;
    next.state = "SAME_TASK_RETRY_FAILED";
  });
}

export function archiveExistingTask(record, {taskId, processes, custodySha256} = {}) {
  return transition(record, (next) => {
    assert(next.old_task_retired && next.replacement.consumed && taskId === next.task_id, "archive attempted before replacement retirement");
    assert(Array.isArray(processes) && processes.length === 0, "archive attempted while old task is live");
    assert(custodySha256 === next.custody_sha256, "archive attempted after custody changed");
    next.state = "RETIRED";
  });
}

export function routeExistingTaskLifecycleWork({routeClass, laneLead, trueBlocked = null} = {}) {
  assert(ORDINARY_ROUTES.has(routeClass), "lifecycle route class is invalid");
  requireStable(laneLead, "lifecycle lane lead");
  if (trueBlocked !== null) {
    assert(isRecord(trueBlocked) && trueBlocked.classification === "TRUE_BLOCKED", "Orchestrator escalation lacks typed TRUE_BLOCKED evidence");
    requireSha(trueBlocked.evidence_sha256, "TRUE_BLOCKED evidence digest");
    return {handler: "CAMPAIGN_ORCHESTRATOR", route_class: routeClass, evidence_sha256: trueBlocked.evidence_sha256};
  }
  return {handler: laneLead, route_class: routeClass, evidence_sha256: null};
}

export function validateExistingTaskLifecycleAuthority({action, actor, independentPassSha256 = null} = {}) {
  requireStable(action, "lifecycle authority action");
  requireStable(actor, "lifecycle authority actor");
  const exact = {
    HOST_STOP: "AGENTOS.SPAWNER",
    HOST_RESUME: "AGENTOS.SPAWNER",
    IMPLEMENT: "AGENTOS.AGENT_PROTOTYPER",
    EVALUATE: "INDEPENDENT_EVALUATOR",
    BIND_CUSTODY: "AGENTOS.ORCHESTRATOR",
  };
  assert(exact[action] !== undefined && actor === exact[action], "lifecycle authority split violation");
  if (action === "BIND_CUSTODY") requireSha(independentPassSha256, "independent PASS digest");
  else assert(independentPassSha256 === null, "unexpected independent PASS binding");
  return true;
}

export function classifyExistingTaskMaterialProgress({status, beforeCustodySha256, afterCustodySha256, materialReceiptSha256 = null} = {}) {
  requireStable(status, "lifecycle task status");
  requireSha(beforeCustodySha256, "before custody digest");
  requireSha(afterCustodySha256, "after custody digest");
  if (materialReceiptSha256 !== null) requireSha(materialReceiptSha256, "material receipt digest");
  return materialReceiptSha256 !== null && beforeCustodySha256 !== afterCustodySha256;
}
