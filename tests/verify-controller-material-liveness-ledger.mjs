#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  compileMaterialLivenessLedger,
  evaluateMaterialLivenessLedger,
  evaluateSilentCompletion,
  materialLivenessSignature,
  validateMaterialLivenessLedger,
  compileCrossThreadDeliveryState,
  crossThreadDeliverySignature,
  evaluateCrossThreadDelivery,
  applyCrossThreadDeliveryReadback,
  validateCrossThreadDeliveryState,
} from "../control/controller-material-liveness-ledger.mjs";
import {canonicalDigest} from "../control/content-addressing.mjs";

const sha = (label) => canonicalDigest({label});
const parent = {
  parent_id: "PARENT.CONTROLLER.001",
  state: "ADVANCING",
  responsible_consumer_id: "CONSUMER.CONTROLLER.001",
  expected_transition: "CONSUME.EXACT.MATERIAL.OUTCOME",
  consumer_state: "IDLE",
};

function executor(id, kind = "PASS", overrides = {}) {
  const value = {
    executor_id: id,
    parent_id: parent.parent_id,
    consumer_id: parent.responsible_consumer_id,
    depends_on_executor_ids: [],
    candidate_sha256: sha(`${id}:candidate`),
    outcome_sha256: sha(`${id}:outcome`),
    outcome_kind: kind,
    expected_transition: "CONSUME.EXACT.MATERIAL.OUTCOME",
    admitted_at_utc: "2026-08-25T17:00:00.000Z",
    latest_material_signature_sha256: null,
    delivery_state: "DELIVERED",
    consumption_state: "UNCONSUMED",
    closeout: null,
    ...overrides,
  };
  value.latest_material_signature_sha256 = materialLivenessSignature(value);
  return value;
}

function readback(value, overrides = {}) {
  return {
    executor_id: value.executor_id,
    candidate_sha256: value.candidate_sha256,
    outcome_sha256: value.outcome_sha256,
    consumer_id: value.consumer_id,
    expected_transition: value.expected_transition,
    material_signature_sha256: value.latest_material_signature_sha256,
    post_delivery_readback_sha256: sha(`${value.executor_id}:post-readback`),
    readback_at_utc: "2026-08-25T17:01:00.000Z",
    fresh_readback: true,
    transition_started: true,
    ...overrides,
  };
}

const admitted = [executor("EXECUTOR.AUDIT.001", "PASS"), executor("EXECUTOR.REPAIR.002", "FAIL")];
const initial = compileMaterialLivenessLedger({parent, admittedExecutors: admitted});
validateMaterialLivenessLedger(initial);
const first = evaluateMaterialLivenessLedger(initial);
assert.equal(first.parent_state, "STALLED", "an advancing parent cannot hide completed admitted outcomes");
assert.equal(first.parent_transition_allowed, false);
assert.deepEqual(first.open_stalls.map((stall) => stall.executor_id), ["EXECUTOR.AUDIT.001", "EXECUTOR.REPAIR.002"]);
assert.equal(first.open_stalls.find((stall) => stall.executor_id === "EXECUTOR.AUDIT.001").reason, "IDLE_AFTER_PASS");
assert.equal(first.new_reports.length, 2);

const repeated = compileMaterialLivenessLedger({
  parent,
  admittedExecutors: admitted,
  priorReports: first.new_reports.map(({stall_signature_sha256}) => ({stall_signature_sha256, reported_at_utc: first.evaluated_at_utc})),
});
const repeatedResult = evaluateMaterialLivenessLedger(repeated);
assert.equal(repeatedResult.new_reports.length, 0, "unchanged signatures must deduplicate reports");
assert.equal(repeatedResult.unchanged_report_count, 2);

const consumedOne = compileMaterialLivenessLedger({
  parent: {...parent, state: "WAITING", consumer_state: "ACTIVE"},
  admittedExecutors: admitted,
  consumerReadbacks: [readback(admitted[0])],
  priorReports: first.new_reports.map(({stall_signature_sha256}) => ({stall_signature_sha256, reported_at_utc: first.evaluated_at_utc})),
});
const consumedResult = evaluateMaterialLivenessLedger(consumedOne);
assert.deepEqual(consumedResult.closed_executor_ids, ["EXECUTOR.AUDIT.001"]);
assert.deepEqual(consumedResult.monitoring_executor_ids, ["EXECUTOR.REPAIR.002"]);
assert.equal(consumedResult.open_stalls.length, 1, "consumption closes only the exact matching executor");

const staleCandidate = readback(admitted[0], {candidate_sha256: sha("stale-candidate")});
assert.throws(() => compileMaterialLivenessLedger({parent, admittedExecutors: admitted, consumerReadbacks: [staleCandidate]}), /candidate mismatch/u);
const staleConsumer = readback(admitted[0], {consumer_id: "CONSUMER.OTHER.999"});
assert.throws(() => compileMaterialLivenessLedger({parent, admittedExecutors: admitted, consumerReadbacks: [staleConsumer]}), /consumer mismatch/u);
const activeOnly = readback(admitted[0], {transition_started: false});
assert.throws(() => compileMaterialLivenessLedger({parent, admittedExecutors: admitted, consumerReadbacks: [activeOnly]}), /transition/u);

const malformed = structuredClone(initial);
malformed.admitted_executors.push(structuredClone(malformed.admitted_executors[0]));
assert.throws(() => validateMaterialLivenessLedger(malformed), /duplicate executor_id/u);
const cyclic = [executor("EXECUTOR.CYCLE.A"), executor("EXECUTOR.CYCLE.B")];
cyclic[0].depends_on_executor_ids = [cyclic[1].executor_id];
cyclic[1].depends_on_executor_ids = [cyclic[0].executor_id];
assert.throws(() => compileMaterialLivenessLedger({parent, admittedExecutors: cyclic}), /cycle/u);
const unknownDependency = executor("EXECUTOR.UNKNOWN.001", "HANDOFF", {depends_on_executor_ids: ["EXECUTOR.MISSING.001"]});
assert.throws(() => compileMaterialLivenessLedger({parent, admittedExecutors: [unknownDependency]}), /not admitted/u);

assert.equal(first.admitted_executor_ids.length, 2, "every admitted executor belongs to the monitoring universe");

const silentBase = {
  task_id: "TASK.SILENT.001",
  custody_sha256: sha("silent-custody"),
  generation: "GENERATION.SILENT.001",
  turn_status: "COMPLETED",
  visible_item_count: 0,
  assistant_message_present: false,
  tool_marker_present: false,
  typed_outcome_sha256: null,
  owning_process_state: "ABSENT",
  custody_state: "CHANGED",
  custody_mutability: "MUTABLE",
  candidate_state: "NONE",
  expected_transition: "RESUME.SAME.TASK.MATERIAL.OUTPUT",
  recovery_count: 0,
  prior_stall_signature_sha256: null,
  fresh_closeout: null,
};
const silent = evaluateSilentCompletion(silentBase);
assert.equal(silent.status, "SILENT_COMPLETED_TURN_WITH_PRESERVED_UNFROZEN_CUSTODY");
assert.equal(silent.report_action, "EMIT_CONTROLLER_REPORT");
const silentRetry = evaluateSilentCompletion({...silentBase, recovery_count: 1, prior_stall_signature_sha256: silent.stall_signature_sha256});
assert.equal(silentRetry.stall_signature_sha256, silent.stall_signature_sha256);
assert.equal(silentRetry.report_action, "DEDUPLICATED");
assert.equal(silentRetry.recovery_exhausted, true);
assert.equal(evaluateSilentCompletion({...silentBase, custody_mutability: "READ_ONLY"}).status, "NO_SILENT_COMPLETION_STALL");
assert.equal(evaluateSilentCompletion({...silentBase, custody_state: "CLEAN"}).status, "NO_SILENT_COMPLETION_STALL");
assert.equal(evaluateSilentCompletion({...silentBase, candidate_state: "IMMUTABLE"}).status, "MATERIAL_OUTCOME_HANDLED");
assert.equal(evaluateSilentCompletion({...silentBase, typed_outcome_sha256: sha("typed-pass")}).status, "MATERIAL_OUTCOME_HANDLED");
assert.equal(evaluateSilentCompletion({...silentBase, fresh_closeout: {
  task_id: silentBase.task_id,
  custody_sha256: silentBase.custody_sha256,
  generation: silentBase.generation,
  expected_transition: silentBase.expected_transition,
  stall_signature_sha256: silent.stall_signature_sha256,
  readback_sha256: sha("silent-readback"),
}}).status, "CLOSED");
assert.throws(() => evaluateSilentCompletion({...silentBase, fresh_closeout: {
  task_id: "TASK.OTHER.001",
  custody_sha256: silent.custody_sha256,
  generation: silent.generation,
  expected_transition: silent.expected_transition,
  stall_signature_sha256: silent.stall_signature_sha256,
  readback_sha256: sha("silent-readback"),
}}), /task mismatch/u);

const deliveryHash = (label) => canonicalDigest({delivery: label});
const deliveryBase = compileCrossThreadDeliveryState({
  reportId: "REPORT.STALL.001",
  stallSignatureSha256: deliveryHash("stall"),
  sourceTaskId: "TASK.SOURCE.001",
  affectedTaskId: "TASK.AFFECTED.001",
  custodySha256: deliveryHash("custody"),
  generation: "GENERATION.001",
  recipientRole: "AGENTOS.CONTROLLER",
  recipientTaskId: "TASK.CONTROLLER.001",
  retryLimit: 2,
});
assert.equal(crossThreadDeliverySignature(deliveryBase).length, 64);
let hostAttempt;
const hostDelivered = evaluateCrossThreadDelivery(deliveryBase, {
  collaborationTreeAvailable: false,
  recipientVisible: false,
  hostAdapter: (payload) => {
    hostAttempt = payload.attempt_id;
    return {
      receipt: {
        report_id: payload.report_id,
        stall_signature_sha256: payload.stall_signature_sha256,
        recipient_task_id: payload.recipient_task_id,
        generation: payload.generation,
        attempt_id: payload.attempt_id,
        delivered_at_utc: "2026-08-25T18:20:00.000Z",
      },
      recipient_readback: {
        report_id: payload.report_id,
        stall_signature_sha256: payload.stall_signature_sha256,
        recipient_task_id: payload.recipient_task_id,
        source_task_id: payload.source_task_id,
        custody_sha256: payload.custody_sha256,
        generation: payload.generation,
        attempt_id: payload.attempt_id,
        readback_sha256: deliveryHash("readback"),
        read_at_utc: "2026-08-25T18:20:01.000Z",
        fresh: true,
      },
    };
  },
});
assert.equal(hostDelivered.report_action, "CONSUMED");
assert.equal(hostDelivered.state.route, "HOST_CROSS_THREAD");
assert.equal(hostDelivered.state.consumption_state, "CONSUMED");
assert.equal(hostAttempt, "ATTEMPT.001");

const ackOnly = evaluateCrossThreadDelivery(deliveryBase, {
  collaborationTreeAvailable: false,
  recipientVisible: false,
  hostAdapter: (payload) => ({acknowledgement: {status: "ACKNOWLEDGED", attempt_id: payload.attempt_id, at_utc: "2026-08-25T18:20:00.000Z"}}),
});
assert.equal(ackOnly.report_action, "ACKNOWLEDGED_UNCONSUMED");
assert.equal(ackOnly.state.consumption_state, "UNCONSUMED");
assert.equal(ackOnly.state.receipt, null);

const deliveredOnly = evaluateCrossThreadDelivery(deliveryBase, {
  collaborationTreeAvailable: false,
  recipientVisible: false,
  hostAdapter: (payload) => ({receipt: {
    report_id: payload.report_id,
    stall_signature_sha256: payload.stall_signature_sha256,
    recipient_task_id: payload.recipient_task_id,
    generation: payload.generation,
    attempt_id: payload.attempt_id,
    delivered_at_utc: "2026-08-25T18:20:00.000Z",
  }}),
});
assert.equal(deliveredOnly.report_action, "DELIVERED_UNCONSUMED");
const exactReadback = applyCrossThreadDeliveryReadback(deliveredOnly.state, {
  report_id: deliveryBase.report_id,
  stall_signature_sha256: deliveryBase.stall_signature_sha256,
  recipient_task_id: deliveryBase.recipient_task_id,
  source_task_id: deliveryBase.source_task_id,
  custody_sha256: deliveryBase.custody_sha256,
  generation: deliveryBase.generation,
  attempt_id: deliveredOnly.state.attempt_id,
  readback_sha256: deliveryHash("later-readback"),
  read_at_utc: "2026-08-25T18:20:02.000Z",
  fresh: true,
});
assert.equal(exactReadback.consumption_state, "CONSUMED");
assert.throws(() => compileCrossThreadDeliveryState({...deliveryBase, recipient_task_id: null}), /recipient_task_id/u);

assert.throws(() => evaluateCrossThreadDelivery(deliveryBase, {
  collaborationTreeAvailable: false,
  recipientVisible: false,
  hostAdapter: (payload) => ({
    receipt: {
      report_id: payload.report_id,
      stall_signature_sha256: payload.stall_signature_sha256,
      recipient_task_id: payload.recipient_task_id,
      generation: payload.generation,
      attempt_id: payload.attempt_id,
      delivered_at_utc: "2026-08-25T18:20:00.000Z",
    },
    recipient_readback: {
      report_id: payload.report_id,
      stall_signature_sha256: deliveryHash("wrong-signature"),
      recipient_task_id: payload.recipient_task_id,
      source_task_id: payload.source_task_id,
      custody_sha256: payload.custody_sha256,
      generation: payload.generation,
      attempt_id: payload.attempt_id,
      readback_sha256: deliveryHash("readback"),
      read_at_utc: "2026-08-25T18:20:01.000Z",
      fresh: true,
    },
  }),
}), /readback signature mismatch/u);

const blocked = evaluateCrossThreadDelivery(deliveryBase, {collaborationTreeAvailable: false, recipientVisible: false});
assert.equal(blocked.report_action, "EMIT_STALL_REPORT_DELIVERY_BLOCKED");
assert.equal(blocked.state.delivery_state, "BLOCKED");
assert.equal(blocked.state.fallback.original_signature_sha256, deliveryBase.stall_signature_sha256);
const malformedBlocked = structuredClone(blocked);
malformedBlocked.state.fallback.errors[0] = "";
assert.throws(() => validateCrossThreadDeliveryState(malformedBlocked.state), /fallback error/u);
const dedupedBlocked = evaluateCrossThreadDelivery(blocked.state, {collaborationTreeAvailable: false, recipientVisible: false});
assert.equal(dedupedBlocked.report_action, "DEDUPLICATED");
const consumedFallback = evaluateCrossThreadDelivery(blocked.state, {fallbackOwner: "AGENTOS.CONTROLLER", nowUtc: "2026-08-25T18:20:02.000Z"});
assert.equal(consumedFallback.report_action, "FALLBACK_CONSUMED");
assert.equal(consumedFallback.state.fallback.consumption_state, "CONSUMED");
validateCrossThreadDeliveryState(consumedFallback.state);

const retryable = evaluateCrossThreadDelivery(deliveryBase, {
  collaborationTreeAvailable: false,
  recipientVisible: false,
  retry: true,
  hostAdapter: () => ({available: false, error: "TEMPORARY_ROUTE_UNAVAILABLE"}),
});
assert.equal(retryable.report_action, "RETRY_RETAINED");
assert.equal(retryable.state.retry_count, 1);
const collaborationPending = evaluateCrossThreadDelivery(deliveryBase, {collaborationTreeAvailable: true, recipientVisible: true});
assert.equal(collaborationPending.report_action, "ROUTE_SELECTED");
assert.equal(collaborationPending.state.route, "COLLABORATION_TREE");

console.log("PASS Controller material-liveness ledger: admitted executors, immutable outcomes, idle/pass stalls, exact consumption, deduplication, malformed evidence, dependency cycles, and correlated monitoring closure verified");
