#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  COMMAND_PATH_CORRELATION_SCHEMA,
  COMMAND_PATH_CORRELATED_SUCCESS,
  COMMAND_PATH_CORRELATION_OPEN,
  COMMAND_PATH_DUPLICATE_RETRY_REJECTED,
  COMMAND_PATH_RETRY_ALLOWED,
  CLOSEOUT_LIFECYCLE_SCHEMA,
  FRESH_AFTER_STATE_SCHEMA,
  PROJECTION_DIVERGENCE_SCHEMA,
  TYPED_EXECUTION_RECEIPT_SCHEMA,
  THREAD_READBACK_PROJECTION_DIVERGENCE,
  authorizeSameTaskBoundedRetry,
  consumeCommandPathSuccessOnce,
  createCommandPathConsumptionLedger,
  correlateRuntimeReceiptCommandPath,
  createConsumptionLedger,
  correctFalseBlocker,
  reconcileThreadReadbackProjection,
  validateProjectionDivergenceReceipt,
} from "../control/campaign-closeout-contracts.mjs";
import {canonicalDigest} from "../control/content-addressing.mjs";

assert.equal(CLOSEOUT_LIFECYCLE_SCHEMA, "agentos.campaign_closeout_lifecycle.v1");
assert.equal(PROJECTION_DIVERGENCE_SCHEMA, "agentos.thread_readback_projection_divergence.v1");
assert.equal(COMMAND_PATH_CORRELATION_SCHEMA, "agentos.runtime.command_path_correlation.v1");
assert.equal(TYPED_EXECUTION_RECEIPT_SCHEMA, "agentos.runtime.typed_execution_receipt.v1");
assert.equal(FRESH_AFTER_STATE_SCHEMA, "agentos.runtime.fresh_after_state.v1");
assert.equal(COMMAND_PATH_CORRELATED_SUCCESS, "COMMAND_PATH_CORRELATED_SUCCESS");
assert.equal(COMMAND_PATH_CORRELATION_OPEN, "COMMAND_PATH_CORRELATION_OPEN");
assert.equal(COMMAND_PATH_RETRY_ALLOWED, "COMMAND_PATH_RETRY_ALLOWED");
assert.equal(COMMAND_PATH_DUPLICATE_RETRY_REJECTED, "COMMAND_PATH_DUPLICATE_RETRY_REJECTED");

const runtimeTaskId = "TASK-CONTRACT-RUNTIME-037";
const runtimeTurnId = "TURN-CONTRACT-RUNTIME-037";
const runtimeCommand = {command_id: "CMD-CONTRACT-CLEANUP-037", command_path: "agentos-cleanup", command_argv: ["agentos-cleanup", "--bounded"]};
const commandItem = {item_id: "CMD-CONTRACT-ITEM-037", task_id: runtimeTaskId, turn_id: runtimeTurnId, item_type: "commandExecution", ...runtimeCommand};
commandItem.item_json_sha256 = canonicalDigest(commandItem);
const finalItem = {item_id: "MSG-CONTRACT-FINAL-037", task_id: runtimeTaskId, turn_id: runtimeTurnId, item_type: "agentMessage", semantic_output: {classification: "MUTATION_ACKNOWLEDGED"}};
finalItem.item_json_sha256 = canonicalDigest(finalItem);
const durable = {turn: {task_id: runtimeTaskId, turn_id: runtimeTurnId, final_agent_item_id: finalItem.item_id, item_count: 2}, items: [commandItem, finalItem]};
const receiptBody = {schema: TYPED_EXECUTION_RECEIPT_SCHEMA, version: 1, task_id: runtimeTaskId, turn_id: runtimeTurnId, command_id: runtimeCommand.command_id, command_path: runtimeCommand.command_path, exit_code: 0, terminal: true, status: "SUCCEEDED", receipt_sha256: null};
receiptBody.receipt_sha256 = canonicalDigest(receiptBody);
const afterBody = {schema: FRESH_AFTER_STATE_SCHEMA, version: 1, task_id: runtimeTaskId, turn_id: runtimeTurnId, command_id: runtimeCommand.command_id, fresh_revalidation: true, after_state_sha256: null};
afterBody.after_state_sha256 = canonicalDigest(afterBody);
const correlated = correlateRuntimeReceiptCommandPath({taskId: runtimeTaskId, turnId: runtimeTurnId, projection: {status: "completed", items: [], items_count: 0}, durableHistory: durable, commandPath: {authorized_command: runtimeCommand, execution_receipt: receiptBody, after_state: afterBody}});
assert.equal(correlated.status, COMMAND_PATH_CORRELATED_SUCCESS);
const commandLedger = createCommandPathConsumptionLedger();
assert.equal(consumeCommandPathSuccessOnce({correlation: correlated, ledger: commandLedger}).consumed, true);
assert.throws(() => consumeCommandPathSuccessOnce({correlation: correlated, ledger: commandLedger, retry: true}), /duplicate retry/u);
const retryAuthority = {status: "STABLE", digest: "c".repeat(64)};
const retryLedger = createCommandPathConsumptionLedger();
const retryArgs = {correlation: {status: COMMAND_PATH_CORRELATION_OPEN, task_id: runtimeTaskId, turn_id: runtimeTurnId, authority_digest: retryAuthority.digest, execution: {exit_code: 130, mutation_count: 0}}, retry: {same_task: true, task_id: runtimeTaskId, turn_id: runtimeTurnId, attempt: 1}, authorityDigest: retryAuthority, preflight: {fresh: true, mutation_count: 0, authority_digest: retryAuthority.digest}, ledger: retryLedger};
assert.equal(authorizeSameTaskBoundedRetry(retryArgs).status, COMMAND_PATH_RETRY_ALLOWED);
assert.equal(authorizeSameTaskBoundedRetry(retryArgs).status, COMMAND_PATH_DUPLICATE_RETRY_REJECTED);

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
