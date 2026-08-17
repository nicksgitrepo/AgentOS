/*
 * Project-agnostic semantic successor persistence.
 *
 * A successor is not valid merely because its JSON digest is valid.  This
 * contract binds the queue snapshot, derived counts, registered next action,
 * and a non-null semantic readback in one atomically replaced record.  It is
 * deliberately independent of any product, provider, or project vocabulary.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";

export const TYPED_SUCCESSOR_READBACK_SCHEMA = "agentos.typed_successor_readback.v1";
export const TYPED_SUCCESSOR_READBACK_VERSION = 1;

const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Z][A-Z0-9._:-]{0,191}$/u;
const STATES = new Set(["ACTIVE", "REPAIRING", "PROTECTED_WAIT", "CANDIDATE_REVIEW"]);
const AUTHORITY_STATUSES = new Set(["CURRENT", "STALE", "INVALID", "PENDING"]);
const COLLECTION_STATUSES = new Set(["COLLECTED", "HELD", "PENDING"]);
const SLOT_STATUSES = new Set(["RELEASED", "HELD"]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, keys, label) {
  assert(isRecord(value), `${label} must be an object`);
  const actual = Object.keys(value).sort(compareUtf8);
  const expected = [...keys].sort(compareUtf8);
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} fields mismatch`);
}

function requireIdentifier(value, label, {nullable = false} = {}) {
  if (nullable && value === null) return;
  assert(typeof value === "string" && IDENTIFIER.test(value), `${label} must be a stable identifier`);
}

function requireSha(value, label, {nullable = false} = {}) {
  if (nullable && value === null) return;
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function requireNonNegativeInteger(value, label) {
  assert(Number.isSafeInteger(value) && value >= 0, `${label} must be a non-negative integer`);
}

function requireRecordPath(value, label) {
  assert(typeof value === "string" && value.length > 0, `${label} must be a non-empty relative path`);
  assert(!path.isAbsolute(value) && !value.includes("\\"), `${label} must be a relative POSIX path`);
  assert(!value.split("/").includes(".."), `${label} may not contain parent traversal`);
}

function orderedEntries(entries) {
  assert(Array.isArray(entries), "Typed successor queue entries must be an array");
  const ordered = [...entries].sort((left, right) => compareUtf8(left.entry_id, right.entry_id));
  assert(new Set(ordered.map((entry) => entry.entry_id)).size === ordered.length, "Typed successor queue contains duplicate entry IDs");
  return ordered;
}

function queueProjection(entries) {
  return {entries: orderedEntries(entries)};
}

function semanticProjection(record, entries = record.queue.entries) {
  return {
    state: record.state,
    next_action: record.next_action,
    next_handler: record.next_handler,
    queue_sha256: record.queue.queue_sha256,
    accepted_current_authority_count: record.accepted_current_authority_count,
    collected_count: record.collected_count,
    released_slot_count: record.released_slot_count,
    entry_record_sha256s: orderedEntries(entries).map((entry) => entry.record_sha256),
  };
}

function body(record) {
  const copy = structuredClone(record);
  copy.successor_sha256 = null;
  return copy;
}

function validateEntry(entry) {
  exactKeys(entry, ["entry_id", "record_sha256", "authority_status", "collection_status", "slot_status"], "Typed successor queue entry");
  requireIdentifier(entry.entry_id, "Typed successor entry ID");
  requireSha(entry.record_sha256, "Typed successor entry record digest");
  assert(AUTHORITY_STATUSES.has(entry.authority_status), "Typed successor entry authority status is invalid");
  assert(COLLECTION_STATUSES.has(entry.collection_status), "Typed successor entry collection status is invalid");
  assert(SLOT_STATUSES.has(entry.slot_status), "Typed successor entry slot status is invalid");
  if (entry.authority_status === "CURRENT") assert(entry.collection_status === "COLLECTED", "Current-authority successor entries must be collected");
}

function validateResourceBoundary(boundary) {
  exactKeys(boundary, ["active_lane_count", "lane_limit", "heavyweight_process_count", "heavyweight_process_limit", "wave_activation"], "Typed successor resource boundary");
  for (const field of ["active_lane_count", "lane_limit", "heavyweight_process_count", "heavyweight_process_limit"]) requireNonNegativeInteger(boundary[field], `Typed successor ${field}`);
  assert(boundary.active_lane_count <= boundary.lane_limit, "Typed successor active lanes exceed limit");
  assert(boundary.heavyweight_process_count <= boundary.heavyweight_process_limit, "Typed successor heavyweight processes exceed limit");
  assert(boundary.wave_activation === "ON" || boundary.wave_activation === "OFF", "Typed successor wave activation is invalid");
}

export function validateTypedSuccessorReadback(record) {
  exactKeys(record, [
    "schema", "version", "successor_id", "parent_successor_sha256", "parent_next_action", "transition_sequence",
    "state", "next_action", "next_handler", "queue", "accepted_current_authority_count", "collected_count",
    "released_slot_count", "resource_boundary", "readback", "readback_sha256", "successor_sha256",
  ], "Typed successor readback");
  assert(record.schema === TYPED_SUCCESSOR_READBACK_SCHEMA && record.version === TYPED_SUCCESSOR_READBACK_VERSION, "Typed successor identity is invalid");
  requireIdentifier(record.successor_id, "Typed successor ID");
  requireSha(record.parent_successor_sha256, "Typed successor parent digest", {nullable: true});
  requireIdentifier(record.parent_next_action, "Typed successor parent action", {nullable: true});
  requireNonNegativeInteger(record.transition_sequence, "Typed successor transition sequence");
  if (record.transition_sequence === 0) {
    assert(record.parent_successor_sha256 === null && record.parent_next_action === null, "Initial successor cannot bind a parent");
  } else {
    requireSha(record.parent_successor_sha256, "Typed successor parent digest");
    requireIdentifier(record.parent_next_action, "Typed successor parent action");
  }
  assert(STATES.has(record.state), "Typed successor state is invalid");
  requireIdentifier(record.next_action, "Typed successor next action");
  requireIdentifier(record.next_handler, "Typed successor next handler");
  exactKeys(record.queue, ["entries", "queue_sha256"], "Typed successor queue");
  const ordered = orderedEntries(record.queue.entries);
  assert(JSON.stringify(record.queue.entries) === JSON.stringify(ordered), "Typed successor queue entries must be sorted");
  ordered.forEach(validateEntry);
  requireSha(record.queue.queue_sha256, "Typed successor queue digest");
  assert(record.queue.queue_sha256 === canonicalDigest(queueProjection(ordered)), "Typed successor queue digest mismatch");
  for (const field of ["accepted_current_authority_count", "collected_count", "released_slot_count"]) requireNonNegativeInteger(record[field], `Typed successor ${field}`);
  const accepted = ordered.filter((entry) => entry.authority_status === "CURRENT" && entry.collection_status === "COLLECTED").length;
  const collected = ordered.filter((entry) => entry.collection_status === "COLLECTED").length;
  const released = ordered.filter((entry) => entry.slot_status === "RELEASED").length;
  assert(record.accepted_current_authority_count === accepted, "Typed successor accepted count diverges from queue");
  assert(record.collected_count === collected, "Typed successor collected count diverges from queue");
  assert(record.released_slot_count === released, "Typed successor released-slot count diverges from queue");
  validateResourceBoundary(record.resource_boundary);
  exactKeys(record.readback, ["state", "next_action", "next_handler", "queue_sha256", "accepted_current_authority_count", "collected_count", "released_slot_count", "entry_record_sha256s"], "Typed successor semantic readback");
  const expectedReadback = semanticProjection(record, ordered);
  assert(JSON.stringify(record.readback) === JSON.stringify(expectedReadback), "Typed successor semantic readback diverges from queue state");
  requireSha(record.readback_sha256, "Typed successor semantic readback digest");
  assert(record.readback_sha256 === canonicalDigest(record.readback), "Typed successor semantic readback digest mismatch");
  if (record.transition_sequence > 0) {
    const semanticChange = record.next_action !== record.parent_next_action || record.accepted_current_authority_count > 0 || record.collected_count > 0 || record.released_slot_count > 0 || ordered.length > 0;
    assert(semanticChange, "Typed successor is a zero-progress loop");
  }
  requireSha(record.successor_sha256, "Typed successor digest");
  assert(record.successor_sha256 === canonicalDigest(body(record)), "Typed successor digest mismatch");
  return record;
}

export function compileTypedSuccessorReadback({successorId, parentSuccessorSha256 = null, parentNextAction = null, transitionSequence = 0, state, nextAction, nextHandler, entries = [], resourceBoundary} = {}) {
  requireIdentifier(successorId, "Typed successor ID");
  const ordered = orderedEntries(entries);
  ordered.forEach(validateEntry);
  const queue = {entries: ordered, queue_sha256: null};
  queue.queue_sha256 = canonicalDigest(queueProjection(ordered));
  const accepted = ordered.filter((entry) => entry.authority_status === "CURRENT" && entry.collection_status === "COLLECTED").length;
  const collected = ordered.filter((entry) => entry.collection_status === "COLLECTED").length;
  const released = ordered.filter((entry) => entry.slot_status === "RELEASED").length;
  const record = {
    schema: TYPED_SUCCESSOR_READBACK_SCHEMA,
    version: TYPED_SUCCESSOR_READBACK_VERSION,
    successor_id: successorId,
    parent_successor_sha256: parentSuccessorSha256,
    parent_next_action: parentNextAction,
    transition_sequence: transitionSequence,
    state,
    next_action: nextAction,
    next_handler: nextHandler,
    queue,
    accepted_current_authority_count: accepted,
    collected_count: collected,
    released_slot_count: released,
    resource_boundary: resourceBoundary,
    readback: null,
    readback_sha256: null,
    successor_sha256: null,
  };
  record.readback = semanticProjection(record, ordered);
  record.readback_sha256 = canonicalDigest(record.readback);
  record.successor_sha256 = canonicalDigest(body(record));
  return validateTypedSuccessorReadback(record);
}

function safeRecordPath(authorityRoot, recordPath) {
  assert(typeof authorityRoot === "string" && path.isAbsolute(authorityRoot), "Typed successor authority root must be absolute");
  requireRecordPath(recordPath, "Typed successor record path");
  const inputRootStat = fs.lstatSync(authorityRoot);
  assert(inputRootStat.isDirectory() && !inputRootStat.isSymbolicLink(), "Typed successor authority root must be a real directory");
  const root = fs.realpathSync.native(authorityRoot);
  const target = path.resolve(root, recordPath);
  assert(target.startsWith(`${root}${path.sep}`), "Typed successor record path escapes authority root");
  for (let cursor = target; cursor !== root; cursor = path.dirname(cursor)) if (fs.existsSync(cursor)) assert(!fs.lstatSync(cursor).isSymbolicLink(), "Typed successor record path may not contain symlinks");
  return target;
}

function fsyncDirectory(directory) {
  const descriptor = fs.openSync(directory, fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY ?? 0));
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

export function readTypedSuccessorReadback({authorityRoot, recordPath}) {
  const target = safeRecordPath(authorityRoot, recordPath);
  let stat;
  try { stat = fs.lstatSync(target); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
  assert(stat.isFile() && !stat.isSymbolicLink(), "Typed successor record must be a regular file");
  let record;
  try { record = JSON.parse(fs.readFileSync(target, "utf8")); } catch (error) { throw new Error(`Typed successor record JSON is invalid: ${error.message}`); }
  return validateTypedSuccessorReadback(record);
}

export function writeTypedSuccessorReadbackCompareAndSwap({authorityRoot, recordPath, expectedSuccessorSha256 = null, record} = {}) {
  const validated = validateTypedSuccessorReadback(record);
  requireSha(expectedSuccessorSha256, "Typed successor compare-and-swap parent", {nullable: true});
  let target = safeRecordPath(authorityRoot, recordPath);
  fs.mkdirSync(path.dirname(target), {recursive: true});
  target = safeRecordPath(authorityRoot, recordPath);
  const lockPath = `${target}.lock`;
  let lockDescriptor;
  let lockHeld = false;
  let temporary;
  try {
    lockDescriptor = fs.openSync(lockPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
    lockHeld = true;
    const current = readTypedSuccessorReadback({authorityRoot, recordPath});
    if (expectedSuccessorSha256 === null) assert(current === null, "Typed successor record already exists");
    else assert(current !== null && current.successor_sha256 === expectedSuccessorSha256, "Typed successor compare-and-swap parent is stale");
    temporary = `${target}.${process.pid}.${crypto.randomUUID()}.stage`;
    const descriptor = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
    try { fs.writeFileSync(descriptor, `${JSON.stringify(validated, null, 2)}\n`, "utf8"); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    fs.renameSync(temporary, target);
    fsyncDirectory(path.dirname(target));
    temporary = null;
  } finally {
    if (temporary !== undefined && fs.existsSync(temporary)) fs.unlinkSync(temporary);
    if (lockDescriptor !== undefined) fs.closeSync(lockDescriptor);
    if (lockHeld) {
      try { fs.unlinkSync(lockPath); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  }
  const readback = readTypedSuccessorReadback({authorityRoot, recordPath});
  assert(readback.successor_sha256 === validated.successor_sha256 && readback.readback_sha256 === validated.readback_sha256, "Typed successor readback differs");
  return {path: recordPath, successor_sha256: readback.successor_sha256, readback_sha256: readback.readback_sha256};
}
