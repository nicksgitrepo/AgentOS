#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  CLOSEOUT_LIFECYCLE_SCHEMA,
  PROJECTION_DIVERGENCE_SCHEMA,
  THREAD_READBACK_PROJECTION_DIVERGENCE,
  createConsumptionLedger,
  correctFalseBlocker,
  reconcileThreadReadbackProjection,
  validateProjectionDivergenceReceipt,
} from "../control/campaign-closeout-contracts.mjs";
import {canonicalDigest} from "../control/content-addressing.mjs";

assert.equal(CLOSEOUT_LIFECYCLE_SCHEMA, "agentos.campaign_closeout_lifecycle.v1");
assert.equal(PROJECTION_DIVERGENCE_SCHEMA, "agentos.thread_readback_projection_divergence.v1");

const taskId = "TASK-037";
const turnId = "TURN-037";
const item = {
  item_id: "ITEM-037",
  task_id: taskId,
  turn_id: turnId,
  item_type: "agentMessage",
  classification: "ASSET_PRODUCER_PASS",
};
item.item_json_sha256 = canonicalDigest(item);
const receipt = reconcileThreadReadbackProjection({
  taskId,
  turnId,
  projection: {status: "completed", items: [], items_count: 0},
  durableHistory: {
    turn: {task_id: taskId, turn_id: turnId, final_agent_item_id: item.item_id, item_count: 1},
    items: [item],
  },
});
assert.equal(receipt.status, THREAD_READBACK_PROJECTION_DIVERGENCE);
validateProjectionDivergenceReceipt(receipt);
const ledger = createConsumptionLedger();
const corrected = correctFalseBlocker({originalClassification: "HOST_SAME_TASK_EXHAUSTED", recovered: receipt, consumptionLedger: ledger});
assert.equal(corrected.corrected, true);
assert.equal(corrected.replay_completed_work, false);
assert.equal(corrected.wake_completed_task, false);
assert.equal(corrected.duplicate_route, false);
const duplicate = correctFalseBlocker({originalClassification: "HOST_SAME_TASK_EXHAUSTED", recovered: receipt, consumptionLedger: ledger});
assert.equal(duplicate.duplicate, true);
assert.throws(() => correctFalseBlocker({originalClassification: "UNRELATED_FAILURE", recovered: receipt, consumptionLedger: ledger}), /exact projection-derived false blocker/u);

console.log("PASS campaign closeout contracts: project-agnostic divergence identity, false-blocker correction, and exactly-once route contract");
