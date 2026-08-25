#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  CORRELATED_READBACK,
  LOW_CONFIDENCE_CORRELATION_BLOCKER,
  THREAD_READBACK_PROJECTION_DIVERGENCE,
  compileProjectionDivergenceReceipt,
  consumeRecoveredResultOnce,
  createCloseoutLifecycle,
  createConsumptionLedger,
  createDurableHistoryAdapter,
  reconcileThreadReadbackProjection,
  readStableAuthorityDigest,
  validateProjectionDivergenceReceipt,
} from "../control/campaign-closeout-lifecycle.mjs";
import {canonicalDigest} from "../control/content-addressing.mjs";

const taskId = "01a037a6-c7b9-7783-ad85-04aeb3d95da8";
const turnId = "01a03a6b-21a7-7cc0-a6f0-4f5d17bc0189";
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

console.log("PASS campaign closeout lifecycle: durable projection divergence, PASS/FAIL/blocker recovery, exact correlation, stability gating, exactly-once consumption, no replay, and ordered audit closeout");
