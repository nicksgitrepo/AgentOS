#!/usr/bin/env node

/* Portable temporary-worker closure: preserve evidence before host lifecycle calls. */

import crypto from "node:crypto";
import {
  assertUniversalDevelopmentMode,
  compileUniversalTaskCloseoutReceipts,
  validateUniversalTaskCloseoutReceipts,
} from "../governance-library.mjs";

const SHA256 = /^[0-9a-f]{64}$/u;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
const HANDOFF_SCHEMA = "DELIVERY_AND_CLOSURE_HANDOFF_V1";
const CLOSURE_RECEIPT_SCHEMA = "agentos.rapid_prototype.closure_receipt.v1";
const LIFECYCLE = Object.freeze([
  "PRESERVE_TYPED_HANDOFF",
  "UNPIN",
  "ARCHIVE",
  "REMOVE_FROM_ACTIVE_ROSTER",
  "VERIFY_ZERO_ACTIVE",
]);
const HANDOFF_STATUSES = Object.freeze([
  "READY_FOR_INDEPENDENT_CLEARANCE",
  "UNAVAILABLE",
  "HARD_STOP",
  "DEFERRED",
]);
const SOURCE_RESULTS = Object.freeze(["MATCH", "STALE", "MISMATCH", "UNAVAILABLE"]);
const PROGRESS_STATES = Object.freeze(["NOT_STARTED", "IN_PROGRESS", "MEANINGFUL", "BLOCKED"]);
const LOCAL_REVIEW_RESULTS = Object.freeze(["READY", "NOT_READY", "UNAVAILABLE"]);
const EXTERNAL_EFFECT_RESULTS = Object.freeze(["NONE", "NOT_RUN_OWNER_BOUNDARY", "UNAVAILABLE"]);
const INDEPENDENT_CHECK_STATUSES = Object.freeze(["REQUESTED", "PASS", "FAIL", "UNAVAILABLE"]);
const TEMPORARY_WORK_STATES = Object.freeze(["PENDING", "CLOSED", "ARCHIVED", "REMOVED", "UNAVAILABLE"]);
const RECEIPT_STATUSES = Object.freeze(["PRESERVED", "CLOSED"]);
const TERMINAL_ROSTER_STATES = new Set(["ARCHIVED", "CLOSED", "INACTIVE", "REMOVED"]);
const HOST_FAILURE_STATUSES = new Set(["FAILED", "ERROR", "HARD_STOP", "UNAVAILABLE"]);
const PRE_ARCHIVE_CLOSEOUT_EVIDENCE_KEYS = Object.freeze([
  "PERSIST_HANDOFF",
  "AUDIT_CANDIDATE",
  "INTEGRATE_ACCEPTED_WORK",
  "CLOSE_STALE_WORKTREE",
  "REMOVE_ACTIVE_TASK_SCOPE",
  "MARK_CHAT_OUT_OF_SCOPE",
]);
const CLOSEOUT_RECEIPT_REF = /^(?:opaque|ref|sha1|sha256|digest):[A-Za-z0-9._:-]+$/u;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value, label) {
  assert(isRecord(value), `${label} must be an object`);
}

function exactKeys(value, keys, label) {
  requireRecord(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} fields mismatch`);
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
  assert(!CONTROL_CHARACTERS.test(value), `${label} contains control characters`);
}

function requireNullableString(value, label) {
  if (value !== null) requireString(value, label);
}

function requireEnum(value, allowed, label) {
  assert(allowed.includes(value), `${label} is invalid`);
}

function requireBoolean(value, label) {
  assert(typeof value === "boolean", `${label} must be boolean`);
}

function requireCount(value, label, {allowNull = false} = {}) {
  if (allowNull && value === null) return;
  assert(Number.isSafeInteger(value) && value >= 0, `${label} must be a nonnegative integer${allowNull ? " or null" : ""}`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function requireNullableSha(value, label) {
  if (value !== null) requireSha(value, label);
}

function validatePreArchiveCloseoutEvidence(evidence) {
  exactKeys(evidence, PRE_ARCHIVE_CLOSEOUT_EVIDENCE_KEYS, "rapid-prototype pre-archive closeout evidence");
  const refs = new Set();
  for (const step of PRE_ARCHIVE_CLOSEOUT_EVIDENCE_KEYS) {
    const reference = evidence[step];
    assert(typeof reference === "string" && CLOSEOUT_RECEIPT_REF.test(reference), `rapid-prototype ${step} closeout evidence reference is invalid`);
    assert(!refs.has(reference), `rapid-prototype closeout evidence reference is duplicated: ${step}`);
    refs.add(reference);
  }
  return structuredClone(evidence);
}

function requireUtc(value, label) {
  requireString(value, label);
  assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) && Number.isFinite(Date.parse(value)), `${label} must be UTC`);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function closureDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value)), "utf8").digest("hex");
}

function digestWithout(value, field) {
  const body = structuredClone(value);
  body[field] = null;
  return closureDigest(body);
}

function field(value, names) {
  if (!isRecord(value)) return undefined;
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(value, name)) return value[name];
  }
  return undefined;
}

function requireStringArray(value, label) {
  assert(Array.isArray(value), `${label} must be an array`);
  for (const item of value) requireString(item, `${label} item`);
}

function requireSafeList(value, label) {
  assert(Array.isArray(value), `${label} must be an array`);
  for (const item of value) {
    if (typeof item === "string") requireString(item, `${label} item`);
    else requireRecord(item, `${label} item`);
  }
}

function validateOptionalWorkerIdentity(handoff, threadId, hostId) {
  const identityRecords = [
    handoff,
    field(handoff, ["identity", "worker_identity", "temporary_worker"]),
  ].filter((candidate) => candidate !== undefined);
  for (const identity of identityRecords) {
    requireRecord(identity, "typed handoff worker identity");
    const observedThreadId = field(identity, ["threadId", "thread_id", "worker_thread_id", "worker_thread_id"]);
    const observedHostId = field(identity, ["hostId", "host_id", "worker_host_id"]);
    if (observedThreadId !== undefined) {
      requireString(observedThreadId, "typed handoff thread identity");
      assert(observedThreadId === threadId, "typed handoff thread identity differs");
    }
    if (observedHostId !== undefined) {
      requireString(observedHostId, "typed handoff host identity");
      assert(observedHostId === hostId, "typed handoff host identity differs");
    }
  }
}

export function validateTypedHandoff(handoff, {threadId = null, hostId = null} = {}) {
  requireRecord(handoff, "typed handoff");
  assert(handoff.schema === HANDOFF_SCHEMA, "typed handoff schema mismatch");
  requireEnum(handoff.status, HANDOFF_STATUSES, "typed handoff status");
  assert(handoff.public_lane === "Delivery and closure", "typed handoff lane mismatch");

  requireRecord(handoff.task_scope, "typed handoff task scope");
  requireStringArray(handoff.task_scope.in_scope, "typed handoff in-scope list");
  requireStringArray(handoff.task_scope.out_of_scope, "typed handoff out-of-scope list");
  requireStringArray(handoff.task_scope.changed_paths, "typed handoff changed-path list");

  requireRecord(handoff.source_binding, "typed handoff source binding");
  requireString(handoff.source_binding.commit, "typed handoff source commit");
  requireString(handoff.source_binding.tree, "typed handoff source tree");
  requireEnum(handoff.source_binding.result, SOURCE_RESULTS, "typed handoff source result");

  requireRecord(handoff.progress, "typed handoff progress");
  requireEnum(handoff.progress.state, PROGRESS_STATES, "typed handoff progress state");
  requireString(handoff.progress.summary, "typed handoff progress summary");

  requireRecord(handoff.result, "typed handoff result");
  requireEnum(handoff.result.local_review, LOCAL_REVIEW_RESULTS, "typed handoff local review result");
  requireEnum(handoff.result.external_effects, EXTERNAL_EFFECT_RESULTS, "typed handoff external-effects result");

  requireRecord(handoff.independent_check, "typed handoff independent check");
  requireEnum(handoff.independent_check.status, INDEPENDENT_CHECK_STATUSES, "typed handoff independent-check status");
  requireNullableSha(handoff.independent_check.evidence_digest, "typed handoff independent-check evidence digest");

  requireRecord(handoff.closure, "typed handoff closure");
  requireBoolean(handoff.closure.handoff_preserved, "typed handoff preservation flag");
  requireEnum(handoff.closure.temporary_work, TEMPORARY_WORK_STATES, "typed handoff temporary-work state");
  requireCount(handoff.closure.active_temporary_count, "typed handoff active temporary count", {allowNull: true});
  requireNullableSha(handoff.closure.receipt_digest, "typed handoff closure receipt digest");

  requireRecord(handoff.iteration, "typed handoff iteration");
  requireSafeList(handoff.iteration.items, "typed handoff iteration items");
  requireSafeList(handoff.open_risks, "typed handoff open risks");
  requireString(handoff.next_handoff, "typed handoff next handoff");
  assert(handoff.clearance === "NOT_CLAIMED", "typed handoff clearance must remain unclaimed");

  if (threadId !== null || hostId !== null) {
    requireString(threadId, "temporary worker thread ID");
    requireString(hostId, "temporary worker host ID");
    validateOptionalWorkerIdentity(handoff, threadId, hostId);
  }
  return handoff;
}

export function validateClosureReceipt(receipt) {
  requireRecord(receipt, "closure receipt");
  assert(receipt.schema === CLOSURE_RECEIPT_SCHEMA && receipt.version === 1, "closure receipt identity is invalid");
  requireEnum(receipt.status, RECEIPT_STATUSES, "closure receipt status");
  requireString(receipt.thread_id, "closure receipt thread ID");
  requireString(receipt.host_id, "closure receipt host ID");
  requireSha(receipt.handoff_sha256, "closure receipt handoff digest");
  requireNullableSha(receipt.preservation_receipt_sha256, "closure receipt preservation digest");
  requireBoolean(receipt.handoff_preserved, "closure receipt preservation flag");
  requireNullableBoolean(receipt.pinned, "closure receipt pinned state");
  requireNullableBoolean(receipt.archived, "closure receipt archived state");
  requireBoolean(receipt.roster_removed, "closure receipt roster-removal flag");
  requireCount(receipt.active_workers_for_worker, "closure receipt active worker count", {allowNull: true});
  assert(JSON.stringify(receipt.lifecycle) === JSON.stringify(LIFECYCLE.slice(0, receipt.status === "CLOSED" ? LIFECYCLE.length : 1)), "closure receipt lifecycle is incomplete or out of order");
  if (receipt.status === "PRESERVED") {
    assert(receipt.handoff_preserved === true && receipt.pinned === null && receipt.archived === null, "preserved receipt state is invalid");
  }
  if (receipt.status === "CLOSED") {
    assert(receipt.handoff_preserved === true && receipt.pinned === false && receipt.archived === true, "closed receipt host state is invalid");
    assert(receipt.roster_removed === true && receipt.active_workers_for_worker === 0, "closed receipt roster state is invalid");
    requireSha(receipt.preservation_receipt_sha256, "closed receipt preservation digest");
  }
  requireUtc(receipt.observed_at_utc, "closure receipt observation time");
  requireSha(receipt.receipt_sha256, "closure receipt digest");
  assert(receipt.receipt_sha256 === digestWithout(receipt, "receipt_sha256"), "closure receipt digest mismatch");
  return receipt;
}

function requireNullableBoolean(value, label) {
  if (value !== null) requireBoolean(value, label);
}

export function compileClosureReceipt({
  threadId,
  hostId,
  handoff,
  status = "PRESERVED",
  pinned = null,
  archived = null,
  rosterRemoved = false,
  activeWorkersForWorker = null,
  preservationReceiptSha256 = null,
  observedAtUtc = new Date().toISOString(),
} = {}) {
  requireString(threadId, "closure receipt thread ID");
  requireString(hostId, "closure receipt host ID");
  validateTypedHandoff(handoff, {threadId, hostId});
  requireEnum(status, RECEIPT_STATUSES, "closure receipt status");
  requireNullableBoolean(pinned, "closure receipt pinned state");
  requireNullableBoolean(archived, "closure receipt archived state");
  requireBoolean(rosterRemoved, "closure receipt roster-removal flag");
  requireCount(activeWorkersForWorker, "closure receipt active worker count", {allowNull: true});
  requireNullableSha(preservationReceiptSha256, "closure receipt preservation digest");
  requireUtc(observedAtUtc, "closure receipt observation time");
  if (status === "PRESERVED") {
    assert(pinned === null && archived === null && rosterRemoved === false, "preserved receipt cannot claim lifecycle progress");
  }
  if (status === "CLOSED") {
    assert(pinned === false && archived === true && rosterRemoved === true && activeWorkersForWorker === 0, "closed receipt requires completed lifecycle state");
    requireSha(preservationReceiptSha256, "closed receipt preservation digest");
  }
  const receipt = {
    schema: CLOSURE_RECEIPT_SCHEMA,
    version: 1,
    status,
    thread_id: threadId,
    host_id: hostId,
    handoff_sha256: closureDigest(handoff),
    preservation_receipt_sha256: preservationReceiptSha256,
    handoff_preserved: true,
    pinned,
    archived,
    roster_removed: rosterRemoved,
    active_workers_for_worker: activeWorkersForWorker,
    lifecycle: LIFECYCLE.slice(0, status === "CLOSED" ? LIFECYCLE.length : 1),
    observed_at_utc: observedAtUtc,
    receipt_sha256: null,
  };
  receipt.receipt_sha256 = digestWithout(receipt, "receipt_sha256");
  return validateClosureReceipt(receipt);
}

class ClosureError extends Error {
  constructor(status, code, reason) {
    super(reason);
    this.status = status;
    this.code = code;
  }
}

function failureResult({status, code, reason, phase, preservedReceipt = null, activeRoster = null, universalCloseoutReceipts = null}) {
  const activeWorkersForWorker = preservedReceipt?.active_workers_for_worker ?? null;
  return {
    status,
    code,
    reason,
    phase,
    receipt: preservedReceipt,
    universal_closeout_receipts: universalCloseoutReceipts,
    preserved_handoff: preservedReceipt !== null,
    closure: {
      status: "CLOSE_FAILED",
      handoff_preserved: preservedReceipt !== null,
      temporary_work: status === "UNAVAILABLE" ? "UNAVAILABLE" : "PENDING",
      active_workers_for_worker: activeWorkersForWorker,
    },
    active_roster: activeRoster,
  };
}

function rosterRecords(activeRoster) {
  if (Array.isArray(activeRoster)) return structuredClone(activeRoster);
  if (isRecord(activeRoster) && Array.isArray(activeRoster.active_roster)) return structuredClone(activeRoster.active_roster);
  if (isRecord(activeRoster) && Array.isArray(activeRoster.activeRoster)) return structuredClone(activeRoster.activeRoster);
  if (isRecord(activeRoster) && Array.isArray(activeRoster.workers)) return structuredClone(activeRoster.workers);
  if (isRecord(activeRoster) && Array.isArray(activeRoster.active_workers)) return structuredClone(activeRoster.active_workers);
  throw new ClosureError("HARD_STOP", "INVALID_ACTIVE_ROSTER", "active roster is unavailable or invalid");
}

function validateRosterRecord(record, index) {
  requireRecord(record, `active roster record ${index}`);
  const recordThreadId = field(record, ["threadId", "thread_id"]);
  const recordHostId = field(record, ["hostId", "host_id"]);
  requireString(recordThreadId, `active roster record ${index} thread ID`);
  requireString(recordHostId, `active roster record ${index} host ID`);
  const active = field(record, ["active"]);
  if (active !== undefined) requireBoolean(active, `active roster record ${index} active state`);
  assert(active !== false, `active roster record ${index} is not active`);
  const state = field(record, ["status", "state"]);
  if (state !== undefined) {
    requireString(state, `active roster record ${index} state`);
    assert(!TERMINAL_ROSTER_STATES.has(state.toUpperCase()), `active roster record ${index} is already closed`);
  }
  return {threadId: recordThreadId, hostId: recordHostId};
}

function prepareRoster(activeRoster, threadId, hostId) {
  const records = rosterRecords(activeRoster);
  const identities = records.map(validateRosterRecord);
  const exactMatches = identities.filter((identity) => identity.threadId === threadId && identity.hostId === hostId);
  const sameThread = identities.some((identity) => identity.threadId === threadId);
  if (exactMatches.length !== 1 || (sameThread && exactMatches.length !== 1)) {
    throw new ClosureError("HARD_STOP", "IDENTITY_MISMATCH", "active roster does not identify exactly one temporary worker");
  }
  return {records, targetIndex: identities.findIndex((identity) => identity.threadId === threadId && identity.hostId === hostId)};
}

function activeCountForWorker(records, threadId, hostId) {
  return records.filter((record) => field(record, ["threadId", "thread_id"]) === threadId
    && field(record, ["hostId", "host_id"]) === hostId).length;
}

function inspectHostReadback(readback, {operation, threadId, hostId}) {
  if (readback === undefined || readback === null || readback === true) return;
  if (readback === false) throw new ClosureError("HARD_STOP", "HOST_FAILURE", `${operation} returned failure`);
  if (typeof readback === "string") {
    if (HOST_FAILURE_STATUSES.has(readback.toUpperCase())) {
      const status = readback.toUpperCase() === "UNAVAILABLE" ? "UNAVAILABLE" : "HARD_STOP";
      throw new ClosureError(status, "HOST_FAILURE", `${operation} returned failure`);
    }
    return;
  }
  requireRecord(readback, `${operation} host readback`);
  const observedThreadId = field(readback, ["threadId", "thread_id"]);
  const observedHostId = field(readback, ["hostId", "host_id"]);
  if (observedThreadId !== undefined) {
    requireString(observedThreadId, `${operation} host thread identity`);
    if (observedThreadId !== threadId) throw new ClosureError("HARD_STOP", "IDENTITY_MISMATCH", `${operation} host thread identity differs`);
  }
  if (observedHostId !== undefined) {
    requireString(observedHostId, `${operation} host identity`);
    if (observedHostId !== hostId) throw new ClosureError("HARD_STOP", "IDENTITY_MISMATCH", `${operation} host identity differs`);
  }
  if (readback.ok === false || readback.success === false) {
    throw new ClosureError("HARD_STOP", "HOST_FAILURE", `${operation} host readback failed`);
  }
  const status = typeof readback.status === "string" ? readback.status.toUpperCase() : null;
  if (status !== null && HOST_FAILURE_STATUSES.has(status)) {
    throw new ClosureError(status === "UNAVAILABLE" ? "UNAVAILABLE" : "HARD_STOP", "HOST_FAILURE", `${operation} host readback failed`);
  }
  const operationValue = field(readback, ["operation", "method", "action", "phase"]);
  if (operationValue !== undefined) {
    requireString(operationValue, `${operation} host operation`);
    const normalized = operationValue.toLowerCase();
    if (!normalized.includes(operation)) {
      throw new ClosureError("HARD_STOP", "BAD_ORDER", `${operation} host operation readback is out of order`);
    }
  }
  if (operation === "pinned" && readback.pinned !== undefined && readback.pinned !== false) {
    throw new ClosureError("HARD_STOP", "BAD_ORDER", "host did not confirm the worker was unpinned");
  }
  if (operation === "archived" && readback.archived !== undefined && readback.archived !== true) {
    throw new ClosureError("HARD_STOP", "BAD_ORDER", "host did not confirm the worker was archived");
  }
}

async function invokeHost(host, method, payload, operation, threadId, hostId) {
  if (!isRecord(host) || typeof host[method] !== "function") {
    throw new ClosureError("UNAVAILABLE", "HOST_CAPABILITY_UNAVAILABLE", `${method} is unavailable`);
  }
  try {
    const readback = await host[method](payload);
    inspectHostReadback(readback, {operation, threadId, hostId});
    return readback;
  } catch (error) {
    if (error instanceof ClosureError) throw error;
    throw new ClosureError("HARD_STOP", "HOST_FAILURE", `${method} failed`);
  }
}

export async function completeTemporaryWorker({threadId, hostId, handoff, activeRoster, host, universalCloseoutEvidence = null, universalCloseoutReceiptResolver} = {}) {
  assertUniversalDevelopmentMode("RAPID_PROTOTYPE", ["HANDOFF", "CLOSURE"]);
  if (handoff === undefined || handoff === null) {
    return failureResult({status: "HARD_STOP", code: "MISSING_TYPED_HANDOFF", reason: "typed handoff is required", phase: "PRESERVE_TYPED_HANDOFF", activeRoster});
  }

  try {
    validateTypedHandoff(handoff, {threadId, hostId});
  } catch (error) {
    return failureResult({status: "HARD_STOP", code: "INVALID_TYPED_HANDOFF", reason: "typed handoff is invalid", phase: "PRESERVE_TYPED_HANDOFF", activeRoster});
  }

  let preArchiveCloseoutEvidence;
  try {
    preArchiveCloseoutEvidence = validatePreArchiveCloseoutEvidence(universalCloseoutEvidence);
  } catch (error) {
    return failureResult({
      status: "HARD_STOP",
      code: "UNIVERSAL_CLOSEOUT_EVIDENCE_REQUIRED",
      reason: "rapid-prototype archive requires the complete pre-archive closeout evidence set",
      phase: "PRESERVE_TYPED_HANDOFF",
      activeRoster,
    });
  }

  let preservedReceipt;
  try {
    preservedReceipt = compileClosureReceipt({
      threadId,
      hostId,
      handoff,
      status: "PRESERVED",
      observedAtUtc: new Date().toISOString(),
    });
  } catch (error) {
    return failureResult({status: "HARD_STOP", code: "INVALID_WORKER_IDENTITY", reason: "temporary worker identity is invalid", phase: "PRESERVE_TYPED_HANDOFF", activeRoster});
  }

  let roster;
  try {
    roster = prepareRoster(activeRoster, threadId, hostId);
    preservedReceipt.active_workers_for_worker = 1;
    preservedReceipt.receipt_sha256 = digestWithout(preservedReceipt, "receipt_sha256");
    validateClosureReceipt(preservedReceipt);
  } catch (error) {
    const status = error instanceof ClosureError ? error.status : "HARD_STOP";
    const code = error instanceof ClosureError ? error.code : "INVALID_ACTIVE_ROSTER";
    return failureResult({status, code, reason: error instanceof ClosureError ? error.message : "active roster is invalid", phase: "PRESERVE_TYPED_HANDOFF", preservedReceipt, activeRoster});
  }

  const closeoutBindings = new Map();
  const resolveCloseoutReceipt = (reference, context) => {
    const local = closeoutBindings.get(reference);
    if (local !== undefined) return {...local, authority: context.authority};
    assert(typeof universalCloseoutReceiptResolver === "function", "rapid-prototype closeout receipt resolver is missing");
    const resolved = universalCloseoutReceiptResolver(reference, context);
    assert(isRecord(resolved), "rapid-prototype closeout receipt did not resolve");
    return resolved;
  };
  closeoutBindings.set(`digest:${preservedReceipt.receipt_sha256}`, {
    payload: {...preservedReceipt, receipt_sha256: null},
    receipt_sha256: preservedReceipt.receipt_sha256,
    status: "PROVEN",
  });

  let unpinReceiptRef;
  let unpinPayload;
  try {
    await invokeHost(host, "set_thread_pinned", {threadId, pinned: false}, "pinned", threadId, hostId);
    unpinPayload = {mode: "RAPID_PROTOTYPE", step: "UNPIN_SESSION", thread_id: threadId, host_id: hostId, status: "PROVEN"};
    unpinReceiptRef = `digest:${closureDigest(unpinPayload)}`;
    closeoutBindings.set(unpinReceiptRef, {payload: unpinPayload, receipt_sha256: unpinReceiptRef.slice("digest:".length), status: "PROVEN"});
  } catch (error) {
    return failureResult({
      status: error instanceof ClosureError ? error.status : "HARD_STOP",
      code: error instanceof ClosureError ? error.code : "HOST_FAILURE",
      reason: error instanceof ClosureError ? error.message : "host unpin failed",
      phase: "UNPIN",
      preservedReceipt,
      activeRoster,
    });
  }

  let archiveReceiptRef;
  let archivePayload;
  try {
    await invokeHost(host, "set_thread_archived", {threadId, hostId, archived: true}, "archived", threadId, hostId);
    archivePayload = {mode: "RAPID_PROTOTYPE", step: "ARCHIVE_VISIBLE_TASK", thread_id: threadId, host_id: hostId, status: "PROVEN"};
    archiveReceiptRef = `digest:${closureDigest(archivePayload)}`;
    closeoutBindings.set(archiveReceiptRef, {payload: archivePayload, receipt_sha256: archiveReceiptRef.slice("digest:".length), status: "PROVEN"});
  } catch (error) {
    return failureResult({
      status: error instanceof ClosureError ? error.status : "HARD_STOP",
      code: error instanceof ClosureError ? error.code : "HOST_FAILURE",
      reason: error instanceof ClosureError ? error.message : "host archive failed",
      phase: "ARCHIVE",
      preservedReceipt,
      activeRoster,
    });
  }

  try {
    const beforeRemovalCount = activeCountForWorker(roster.records, threadId, hostId);
    if (beforeRemovalCount !== 1) {
      throw new ClosureError("HARD_STOP", "BAD_ORDER", "active roster changed before worker removal");
    }
    const hostRosterReadback = await invokeHost(host, "list_threads", {}, "list_threads", threadId, hostId);
    const hostActiveRoster = rosterRecords(hostRosterReadback);
    const hostActiveIdentities = hostActiveRoster.map(validateRosterRecord);
    assert(!hostActiveIdentities.some((identity) => identity.threadId === threadId && identity.hostId === hostId),
      "host active roster still contains the temporary worker");
    roster.records.splice(roster.targetIndex, 1);
    const afterRemovalCount = activeCountForWorker(roster.records, threadId, hostId);
    if (afterRemovalCount !== 0) {
      throw new ClosureError("HARD_STOP", "NONZERO_ACTIVE_ROSTER", "temporary worker remains active after removal");
    }
    const universalCloseoutReceipts = compileUniversalTaskCloseoutReceipts({
      mode: "RAPID_PROTOTYPE",
      receiptRefs: {
        PRESERVE_HANDOFF: `digest:${preservedReceipt.receipt_sha256}`,
        PERSIST_HANDOFF: preArchiveCloseoutEvidence.PERSIST_HANDOFF,
        AUDIT_CANDIDATE: preArchiveCloseoutEvidence.AUDIT_CANDIDATE,
        INTEGRATE_ACCEPTED_WORK: preArchiveCloseoutEvidence.INTEGRATE_ACCEPTED_WORK,
        UNPIN_SESSION: unpinReceiptRef,
        CLOSE_STALE_WORKTREE: preArchiveCloseoutEvidence.CLOSE_STALE_WORKTREE,
        REMOVE_ACTIVE_TASK_SCOPE: preArchiveCloseoutEvidence.REMOVE_ACTIVE_TASK_SCOPE,
        MARK_CHAT_OUT_OF_SCOPE: preArchiveCloseoutEvidence.MARK_CHAT_OUT_OF_SCOPE,
        ARCHIVE_VISIBLE_TASK: archiveReceiptRef,
      },
      observedAt: new Date().toISOString(),
      label: "rapid-prototype universal closeout receipts",
      receiptResolver: resolveCloseoutReceipt,
    });
    validateUniversalTaskCloseoutReceipts(universalCloseoutReceipts, {closed: true, label: "rapid-prototype universal closeout receipts", receiptResolver: resolveCloseoutReceipt});
    const receipt = compileClosureReceipt({
      threadId,
      hostId,
      handoff,
      status: "CLOSED",
      pinned: false,
      archived: true,
      rosterRemoved: true,
      activeWorkersForWorker: afterRemovalCount,
      preservationReceiptSha256: preservedReceipt.receipt_sha256,
      observedAtUtc: new Date().toISOString(),
    });
    return {
      status: "CLOSED",
      code: "TEMPORARY_WORKER_CLOSED",
      phase: "VERIFY_ZERO_ACTIVE",
      handoff: structuredClone(handoff),
      preserved_handoff: true,
      receipt,
      universal_closeout_receipts: universalCloseoutReceipts,
      active_roster: roster.records,
      lifecycle: [...LIFECYCLE],
    };
  } catch (error) {
    return failureResult({
      status: error instanceof ClosureError ? error.status : "HARD_STOP",
      code: error instanceof ClosureError ? error.code : "ROSTER_REMOVAL_FAILED",
      reason: error instanceof ClosureError ? error.message : "active roster removal or verification failed",
      phase: "REMOVE_FROM_ACTIVE_ROSTER",
      preservedReceipt,
      activeRoster,
    });
  }
}

export const DELIVERY_CLOSURE_LIFECYCLE = LIFECYCLE;
