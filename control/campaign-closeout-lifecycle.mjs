#!/usr/bin/env node

/*
 * Portable closeout/readback boundary.
 *
 * The host projection and the durable thread history are deliberately two
 * independent sources.  A completed turn with an empty projected item list
 * is therefore not an absence claim.  This module only accepts an injected,
 * read-only durable adapter; it never opens a host database or writes task
 * state.  That keeps the contract useful on hosts other than Codex while
 * preserving the privacy and custody boundary of the Controller.
 */

import {canonicalDigest} from "./content-addressing.mjs";

export const CLOSEOUT_LIFECYCLE_SCHEMA = "agentos.campaign_closeout_lifecycle.v1";
export const PROJECTION_DIVERGENCE_SCHEMA = "agentos.thread_readback_projection_divergence.v1";
export const THREAD_READBACK_PROJECTION_DIVERGENCE = "THREAD_READBACK_PROJECTION_DIVERGENCE";
export const LOW_CONFIDENCE_CORRELATION_BLOCKER = "LOW_CONFIDENCE_DURABLE_HISTORY_CORRELATION_BLOCKER";
export const CORRELATED_READBACK = "CORRELATED_READBACK";

const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const ITEM_TYPES = new Set(["agentMessage", "commandExecution", "userMessage", "reasoning", "contextCompaction", "dynamicToolCall"]);
const FALSE_BLOCKERS = new Set([
  "HOST_SAME_TASK_BLOCKED",
  "HOST_SAME_TASK_EXHAUSTED",
  "TRUE_BLOCKED_HOST_SAME_TASK_VISIBLE_OUTPUT_PIPELINE",
  "AUDIT_ROUTE_RECIPIENT_CONSUMPTION_FAILED",
  "AUDIT_RECIPIENT_CONSUMPTION_FAILED",
  "HOST_OUTPUT_FAILURE",
  "EMPTY_PROJECTION_HOST_FAILURE",
]);

function assert(condition, message, code = "THREAD_READBACK_INVALID") {
  if (!condition) {
    const error = new Error(message);
    error.code = code;
    throw error;
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value, label) {
  assert(isRecord(value), `${label} must be an object`);
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a non-empty string`);
}

function requireIdentifier(value, label) {
  requireString(value, label);
  assert(IDENTIFIER.test(value), `${label} is not a stable identifier`);
}

function requireSha(value, label, {nullable = false} = {}) {
  if (nullable && value === null) return;
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function nonNegativeInteger(value, label) {
  assert(Number.isSafeInteger(value) && value >= 0, `${label} must be a non-negative integer`);
}

function clone(value) {
  return structuredClone(value);
}

function digestBody(value, field) {
  const body = clone(value);
  body[field] = null;
  return canonicalDigest(body);
}

function pick(value, ...keys) {
  for (const key of keys) if (value?.[key] !== undefined) return value[key];
  return undefined;
}

function normalizeProjection(projection) {
  requireRecord(projection, "thread readback projection");
  const status = pick(projection, "status", "turn_status");
  requireString(status, "thread readback projection status");
  const items = projection.items === undefined ? [] : projection.items;
  assert(Array.isArray(items), "thread readback projection items must be an array");
  return {
    status,
    items: clone(items),
    items_count: projection.items_count === undefined ? items.length : projection.items_count,
    source: pick(projection, "source", "api", "source_api") ?? "codex_app__read_thread",
    observed_at_utc: projection.observed_at_utc ?? projection.observedAtUtc ?? null,
  };
}

function normalizeTurn(turn, taskId, turnId) {
  requireRecord(turn, "durable thread turn");
  const observedTask = pick(turn, "task_id", "thread_id", "taskId", "threadId");
  const observedTurn = pick(turn, "turn_id", "turnId", "id");
  requireIdentifier(observedTask, "durable thread task ID");
  requireIdentifier(observedTurn, "durable thread turn ID");
  assert(observedTask === taskId, "durable history task identity does not match projection");
  assert(observedTurn === turnId, "durable history turn identity does not match projection");
  const finalAgentItemId = pick(turn, "final_agent_item_id", "finalAgentItemId");
  assert(finalAgentItemId === null || typeof finalAgentItemId === "string", "durable final agent item ID is invalid");
  const itemCount = pick(turn, "item_count", "itemCount");
  nonNegativeInteger(itemCount, "durable thread item count");
  return {task_id: observedTask, turn_id: observedTurn, final_agent_item_id: finalAgentItemId, item_count: itemCount};
}

function normalizeItem(item, {taskId, turnId, itemId} = {}) {
  requireRecord(item, "durable thread item");
  const id = pick(item, "item_id", "itemId", "id");
  requireString(id, "durable thread item ID");
  assert(id === itemId, "durable final item identity does not match turn pointer");
  const task = pick(item, "task_id", "thread_id", "taskId", "threadId");
  const turn = pick(item, "turn_id", "turnId");
  requireIdentifier(task, "durable item task ID");
  requireIdentifier(turn, "durable item turn ID");
  assert(task === taskId && turn === turnId, "durable item is not correlated to the requested task and turn");
  const type = pick(item, "item_type", "itemType", "type") ?? "agentMessage";
  assert(ITEM_TYPES.has(type), "durable item type is unknown");
  const itemJsonSha256 = pick(item, "item_json_sha256", "itemJsonSha256", "json_sha256");
  if (itemJsonSha256 !== undefined && itemJsonSha256 !== null) {
    requireSha(itemJsonSha256, "durable item JSON digest");
    const rawJson = pick(item, "item_json", "itemJson");
    const withoutDigest = {...item};
    delete withoutDigest.item_json_sha256;
    delete withoutDigest.itemJsonSha256;
    delete withoutDigest.json_sha256;
    const expectedDigest = typeof rawJson === "string" ? canonicalDigest(rawJson) : canonicalDigest(withoutDigest);
    assert(itemJsonSha256 === expectedDigest, "durable item JSON digest does not match its immutable item bytes", "DURABLE_ITEM_DIGEST_MISMATCH");
  }
  return {id, task_id: task, turn_id: turn, type, item_json_sha256: itemJsonSha256 ?? canonicalDigest(item), item};
}

function semanticOutput(item) {
  const raw = item.item;
  const structured = pick(raw, "semantic_output", "semanticOutput", "result", "outcome");
  if (structured !== undefined) return clone(structured);
  const classification = pick(raw, "classification", "semantic_result", "semanticResult", "status");
  const candidate = pick(raw, "candidate", "candidate_id", "candidateId");
  const handoff = pick(raw, "handoff_sha256", "handoffSha256");
  const message = pick(raw, "final_message", "message", "text");
  const result = {};
  if (classification !== undefined) result.classification = classification;
  if (candidate !== undefined) result.candidate = candidate;
  if (handoff !== undefined) result.handoff_sha256 = handoff;
  if (message !== undefined) result.message = message;
  assert(Object.keys(result).length > 0, "durable final item has no recoverable semantic result", "DURABLE_FINAL_ITEM_UNREADABLE");
  return result;
}

function normalizeAdapterResult(result) {
  if (result === null || result === undefined) return null;
  if (isRecord(result) && (result.turn || result.item || result.items || result.source)) return result;
  if (isRecord(result)) return {turn: result};
  throw new Error("durable history adapter returned an invalid record");
}

/**
 * Build a read-only adapter.  The callbacks are intentionally injected so a
 * host can use SQLite, an API cache, or another durable source without this
 * package acquiring credentials or writing host state.
 */
export function createDurableHistoryAdapter({readTurn, readItem, readItems, source = "INJECTED_READ_ONLY_DURABLE_HISTORY", version = "1"} = {}) {
  assert(typeof readTurn === "function" || typeof readItems === "function", "durable history adapter requires a readTurn or readItems callback");
  assert(readItem === undefined || typeof readItem === "function", "durable history readItem must be a function");
  return Object.freeze({
    source,
    version,
    readOnly: true,
    readTurn,
    readItem,
    readItems,
    resolve(taskId, turnId) {
      const turnResult = typeof readTurn === "function" ? readTurn({taskId, turnId}) : null;
      const records = normalizeAdapterResult(turnResult) ?? {};
      const turn = records.turn ?? records;
      const items = Array.isArray(records.items) ? records.items : null;
      let item = records.item ?? null;
      if (!item && typeof readItem === "function" && turn?.final_agent_item_id) item = readItem({taskId, turnId, itemId: turn.final_agent_item_id});
      if (!item && typeof readItems === "function") {
        const listed = readItems({taskId, turnId});
        assert(Array.isArray(listed), "durable history readItems must return an array");
        return {turn, items: listed, source};
      }
      return {turn, item, items, source};
    },
  });
}

export const readOnlyDurableHistoryAdapter = createDurableHistoryAdapter;

function resolveDurable({durableHistory, adapter, taskId, turnId}) {
  if (adapter !== undefined) {
    assert(isRecord(adapter) && adapter.readOnly === true && typeof adapter.resolve === "function", "durable history adapter must be read-only and injectable");
    return normalizeAdapterResult(adapter.resolve(taskId, turnId));
  }
  if (typeof durableHistory === "function") return normalizeAdapterResult(durableHistory({taskId, turnId}));
  if (isRecord(durableHistory)) return clone(durableHistory);
  return null;
}

/**
 * Read a finalizing authority digest without confusing a transient digest
 * with semantic task failure.  A stable result needs two consecutive reads.
 */
export function readStableAuthorityDigest(readDigest, {maxReads = 5, requiredStableReads = 2} = {}) {
  assert(typeof readDigest === "function", "authority digest reader must be a function");
  nonNegativeInteger(maxReads, "authority digest max reads");
  nonNegativeInteger(requiredStableReads, "authority digest stable-read count");
  assert(maxReads >= requiredStableReads && requiredStableReads >= 2, "authority digest stability bounds are invalid");
  const reads = [];
  let previous = null;
  let stable = 0;
  for (let index = 0; index < maxReads; index += 1) {
    const value = readDigest({read_index: index});
    const digest = typeof value === "string" ? value : value?.digest;
    requireSha(digest, "authority digest observation");
    reads.push(digest);
    if (digest === previous) stable += 1;
    else stable = 1;
    previous = digest;
    if (stable >= requiredStableReads) {
      return {status: "STABLE", digest, reads, stable_reads: stable};
    }
  }
  return {status: "UNSTABLE", digest: previous, reads, stable_reads: stable, semantic_failure: false};
}

function emptyProjectionDiverges(projection, durable) {
  return projection.items.length === 0 && durable?.turn?.final_agent_item_id != null;
}

function historyRows(durable) {
  if (!durable) return [];
  if (Array.isArray(durable.items)) return durable.items;
  if (durable.item) return [durable.item];
  return [];
}

function sourceConfidence(durable, item) {
  if (item?.item_json_sha256 && durable?.turn?.final_agent_item_id) return "HIGH_EXACT_ITEM_ID";
  return "MEDIUM_DURABLE_CORRELATED";
}

function projectionDigest(projection) {
  return canonicalDigest({status: projection.status, items: projection.items, items_count: projection.items_count});
}

/**
 * Correlate the host projection with durable history.  The returned receipt
 * is data-only and contains no operation that could wake, replay, rerun, or
 * redeliver a completed task.
 */
export function reconcileThreadReadbackProjection({
  taskId,
  turnId,
  projection,
  durableHistory = null,
  adapter = undefined,
  originalClassification = null,
  consumptionLedger = undefined,
  authorityDigest = undefined,
  observedAtUtc = new Date().toISOString(),
} = {}) {
  requireIdentifier(taskId, "thread task ID");
  requireIdentifier(turnId, "thread turn ID");
  const normalizedProjection = normalizeProjection(projection);
  nonNegativeInteger(normalizedProjection.items_count, "projected item count");
  assert(normalizedProjection.items_count === normalizedProjection.items.length, "projected item count diverges from item array");
  const durable = resolveDurable({durableHistory, adapter, taskId, turnId});
  const base = {
    schema: PROJECTION_DIVERGENCE_SCHEMA,
    version: 1,
    task_id: taskId,
    turn_id: turnId,
    observed_at_utc: observedAtUtc,
    projection: {
      status: normalizedProjection.status,
      items_count: normalizedProjection.items_count,
      source: normalizedProjection.source,
      projection_sha256: projectionDigest(normalizedProjection),
    },
  };

  if (!durable) {
    return {
      ...base,
      status: LOW_CONFIDENCE_CORRELATION_BLOCKER,
      classification: LOW_CONFIDENCE_CORRELATION_BLOCKER,
      confidence: "LOW_UNAVAILABLE_DURABLE_HISTORY",
      provenance: {source: normalizedProjection.source, durable_source: null, exact_correlation: false},
      durable_evidence: null,
      semantic_output: null,
      correction: null,
      blocked: true,
      receipt_sha256: null,
    };
  }

  const turn = normalizeTurn(durable.turn ?? durable, taskId, turnId);
  const rows = historyRows(durable);
  assert(turn.final_agent_item_id !== null, "durable history has no final agent item for a completed turn", "DURABLE_FINAL_ITEM_MISSING");
  const matches = rows.filter((row) => pick(row, "item_id", "itemId", "id") === turn.final_agent_item_id);
  assert(matches.length === 1, matches.length === 0 ? "durable final agent item is missing" : "durable final agent item is ambiguous or duplicated", "DURABLE_FINAL_ITEM_AMBIGUOUS");
  const item = normalizeItem(matches[0], {taskId, turnId, itemId: turn.final_agent_item_id});
  const semantic = semanticOutput(item);
  const divergence = emptyProjectionDiverges(normalizedProjection, {turn});
  const status = divergence ? THREAD_READBACK_PROJECTION_DIVERGENCE : CORRELATED_READBACK;
  const receipt = {
    ...base,
    status,
    classification: status,
    confidence: sourceConfidence({turn}, item),
    provenance: {
      source: normalizedProjection.source,
      durable_source: adapter?.source ?? durable.source ?? "INJECTED_READ_ONLY_DURABLE_HISTORY",
      durable_adapter_version: adapter?.version ?? null,
      exact_correlation: true,
      task_id: taskId,
      turn_id: turnId,
      final_agent_item_id: turn.final_agent_item_id,
      item_count: turn.item_count,
      item_type: item.type,
    },
    durable_evidence: {
      final_agent_item_id: turn.final_agent_item_id,
      item_count: turn.item_count,
      item_json_sha256: item.item_json_sha256,
      item_type: item.type,
    },
    semantic_output: semantic,
    correction: null,
    blocked: false,
    receipt_sha256: null,
  };
  if (authorityDigest !== undefined) {
    assert(isRecord(authorityDigest) && authorityDigest.status === "STABLE", "unstable authority digest is a source-stability hold, not a semantic result");
    requireSha(authorityDigest.digest, "stable authority digest");
    receipt.authority_digest = authorityDigest.digest;
  }
  if (originalClassification !== null) {
    receipt.correction = consumptionLedger === undefined
      ? {
        original_classification: originalClassification,
        corrected: false,
        duplicate: false,
        blocked: true,
        reason: "CONSUMPTION_LEDGER_REQUIRED",
        replay_completed_work: false,
        wake_completed_task: false,
        rerun_completed_task: false,
        duplicate_route: false,
      }
      : correctFalseBlocker({originalClassification, recovered: receipt, consumptionLedger});
  }
  receipt.receipt_sha256 = digestBody(receipt, "receipt_sha256");
  return receipt;
}

export const correlateThreadReadback = reconcileThreadReadbackProjection;
export const reconcileReadbackProjection = reconcileThreadReadbackProjection;

function ledgerSet(ledger) {
  if (ledger instanceof Set) return ledger;
  if (isRecord(ledger) && ledger.consumed instanceof Set) return ledger.consumed;
  if (isRecord(ledger) && Array.isArray(ledger.consumed_keys)) {
    ledger.consumed = new Set(ledger.consumed_keys);
    return ledger.consumed;
  }
  return null;
}

export function createConsumptionLedger() {
  return {schema: "agentos.thread_result_consumption_ledger.v1", consumed: new Set(), consumed_keys: []};
}

export function consumptionKey(receipt) {
  requireRecord(receipt, "recovered result receipt");
  requireIdentifier(receipt.task_id, "recovered result task ID");
  requireIdentifier(receipt.turn_id, "recovered result turn ID");
  requireRecord(receipt.durable_evidence, "recovered result durable evidence");
  requireString(receipt.durable_evidence.final_agent_item_id, "recovered result final item ID");
  requireSha(receipt.durable_evidence.item_json_sha256, "recovered result item digest");
  return [receipt.task_id, receipt.turn_id, receipt.durable_evidence.final_agent_item_id, receipt.durable_evidence.item_json_sha256].join("\u0000");
}

/** Consume a correlated result exactly once; duplicates are a no-op receipt. */
export function consumeRecoveredResultOnce({receipt, ledger, route = undefined} = {}) {
  requireRecord(receipt, "recovered result receipt");
  const key = consumptionKey(receipt);
  const set = ledgerSet(ledger);
  assert(set !== null, "a consumption ledger is required");
  if (route && (route.replay === true || route.wake === true || route.rerun === true || route.redeliver === true || route.duplicate === true)) {
    throw new Error("recovered result consumption cannot replay, wake, rerun, redeliver, or duplicate a completed task");
  }
  if (set.has(key)) return {consumed: false, duplicate: true, key, next_action: "NO_OP_ALREADY_CONSUMED"};
  set.add(key);
  if (isRecord(ledger) && Array.isArray(ledger.consumed_keys)) {
    ledger.consumed_keys.push(key);
    ledger.consumed_keys.sort();
  }
  return {consumed: true, duplicate: false, key, next_action: "CORRECT_EXACT_FALSE_BLOCKER_ONLY"};
}

export function correctFalseBlocker({originalClassification, recovered, consumptionLedger} = {}) {
  requireString(originalClassification, "original classification");
  requireRecord(recovered, "recovered result");
  assert(FALSE_BLOCKERS.has(originalClassification), "only an exact projection-derived false blocker may be corrected");
  const consumed = consumeRecoveredResultOnce({receipt: recovered, ledger: consumptionLedger});
  return {
    original_classification: originalClassification,
    corrected: consumed.consumed || consumed.duplicate,
    duplicate: consumed.duplicate,
    replay_completed_work: false,
    wake_completed_task: false,
    rerun_completed_task: false,
    duplicate_route: false,
    consumption: consumed,
    next_action: consumed.duplicate ? "NO_OP_ALREADY_CONSUMED" : "PRESERVE_CORRELATED_RESULT_AND_CONTINUE_BOUNDDED_CLOSEOUT",
  };
}

export function validateProjectionDivergenceReceipt(receipt) {
  requireRecord(receipt, "projection divergence receipt");
  assert(receipt.schema === PROJECTION_DIVERGENCE_SCHEMA && receipt.version === 1, "projection divergence receipt identity is invalid");
  requireIdentifier(receipt.task_id, "projection divergence task ID");
  requireIdentifier(receipt.turn_id, "projection divergence turn ID");
  requireString(receipt.status, "projection divergence status");
  assert([THREAD_READBACK_PROJECTION_DIVERGENCE, CORRELATED_READBACK, LOW_CONFIDENCE_CORRELATION_BLOCKER].includes(receipt.status), "projection divergence status is invalid");
  requireRecord(receipt.projection, "projection divergence projection evidence");
  nonNegativeInteger(receipt.projection.items_count, "projection divergence projected item count");
  requireSha(receipt.projection.projection_sha256, "projection divergence projection digest");
  if (receipt.status === LOW_CONFIDENCE_CORRELATION_BLOCKER) {
    assert(receipt.blocked === true && receipt.semantic_output === null, "low-confidence correlation blocker must remain blocked");
  } else {
    requireRecord(receipt.durable_evidence, "projection divergence durable evidence");
    requireString(receipt.durable_evidence.final_agent_item_id, "projection divergence final item");
    requireSha(receipt.durable_evidence.item_json_sha256, "projection divergence item digest");
    assert(receipt.provenance?.exact_correlation === true, "projection divergence must preserve exact provenance");
    assert(receipt.semantic_output !== null && receipt.semantic_output !== undefined, "projection divergence must preserve semantic output");
  }
  if (receipt.authority_digest !== undefined) requireSha(receipt.authority_digest, "projection divergence authority digest");
  requireSha(receipt.receipt_sha256, "projection divergence receipt digest");
  assert(receipt.receipt_sha256 === digestBody(receipt, "receipt_sha256"), "projection divergence receipt digest mismatch");
  return receipt;
}

export function compileProjectionDivergenceReceipt(input) {
  const receipt = reconcileThreadReadbackProjection(input);
  validateProjectionDivergenceReceipt({...receipt, receipt_sha256: receipt.receipt_sha256});
  return receipt;
}

const CLOSEOUT_STATES = Object.freeze(["CHECKPOINT_REACHED", "HANDOFF_READY", "AUDIT_ROUTED", "AUDIT_CONSUMED", "CLOSED"]);
const CLOSEOUT_NEXT = Object.freeze({CHECKPOINT_REACHED: "HANDOFF_READY", HANDOFF_READY: "AUDIT_ROUTED", AUDIT_ROUTED: "AUDIT_CONSUMED", AUDIT_CONSUMED: "CLOSED"});

/** Minimal deterministic closeout state machine used by the hygiene gates. */
export function createCloseoutLifecycle({taskId, turnId, laneId, candidate, handoffSha256, auditor, custodyGeneration} = {}) {
  requireIdentifier(taskId, "closeout task ID");
  requireIdentifier(turnId, "closeout turn ID");
  requireIdentifier(laneId, "closeout lane ID");
  requireSha(handoffSha256, "closeout handoff digest");
  requireIdentifier(auditor, "closeout auditor");
  requireIdentifier(custodyGeneration, "closeout custody generation");
  const candidateIdentity = candidate ?? {};
  const key = canonicalDigest({taskId, turnId, laneId, candidate: candidateIdentity, handoffSha256, auditor, custodyGeneration});
  const record = {schema: CLOSEOUT_LIFECYCLE_SCHEMA, version: 1, task_id: taskId, turn_id: turnId, lane_id: laneId, candidate: clone(candidateIdentity), handoff_sha256: handoffSha256, auditor, custody_generation: custodyGeneration, state: "CHECKPOINT_REACHED", transition_sequence: 0, idempotency_key: key, route_attempts: 0, consumed: false};
  return Object.freeze({
    read() { return clone(record); },
    transition(next, details = {}) {
      assert(CLOSEOUT_STATES.includes(next), "closeout transition state is invalid");
      assert(next === CLOSEOUT_NEXT[record.state], `closeout transition ${record.state} -> ${next} is not allowed`);
      if (next === "AUDIT_ROUTED") {
        record.route_attempts += 1;
        assert(record.route_attempts === 1, "closeout audit route is not idempotent");
      }
      if (next === "AUDIT_CONSUMED") {
        assert(details.recipient_consumed === true || details.typed_blocker === true, "audit routing remains open until recipient consumption or typed blocker");
        record.consumed = details.recipient_consumed === true;
      }
      record.state = next;
      record.transition_sequence += 1;
      return clone(record);
    },
  });
}

export function closeoutStateOrder() {
  return [...CLOSEOUT_STATES];
}
