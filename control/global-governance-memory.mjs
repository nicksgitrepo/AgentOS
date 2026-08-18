#!/usr/bin/env node

/* Append-only project-agnostic governance memory; never stores project memory. */

import fs from "node:fs";
import path from "node:path";
import {canonicalDigest, canonicalJson, compareUtf8} from "./content-addressing.mjs";
import {MODEL_POLICY_ROLE_CLASSES, MODEL_POLICY_SNAPSHOT_SCHEMA, validateModelPolicySnapshot} from "./eco-model-policy.mjs";

export const GLOBAL_GOVERNANCE_MEMORY_EVENT_SCHEMA = "agentos.global_governance_memory_event.v1";
export const GLOBAL_GOVERNANCE_MEMORY_READBACK_SCHEMA = "agentos.global_governance_memory_readback.v1";
export const GLOBAL_GOVERNANCE_MEMORY_GENESIS = canonicalDigest({schema: "agentos.global_governance_memory_genesis.v1"});
export const GLOBAL_GOVERNANCE_MEMORY_WRITERS = Object.freeze(["SPAWNER", "GOVERNED_MEMORY_ADAPTER"]);

const SHA256 = /^[0-9a-f]{64}$/u;
const EVENT_KEYS = ["schema", "version", "event_id", "sequence", "event_type", "writer_role", "prior_event_sha256", "snapshot", "target_snapshot_sha256", "reason_code", "observed_at_utc", "event_sha256"];
const READBACK_KEYS = ["schema", "version", "status", "historical_activation_receipt_sha256", "live_event_count", "live_ledger_head_sha256", "current_snapshot_sha256", "observed_at_utc", "readback_sha256"];
const LOCK_KEYS = ["schema", "version", "process_id", "target_relative_path", "acquired_at_utc", "fence_sha256"];

function assert(condition, message, code = "GLOBAL_GOVERNANCE_MEMORY_INVALID") {
  if (!condition) { const error = new Error(message); error.code = code; throw error; }
}
function requireSha(value, label) { assert(typeof value === "string" && SHA256.test(value), `${label} must be a SHA-256`); }
function digestBody(value, field) { return {...structuredClone(value), [field]: null}; }
function exactKeys(value, keys, label) {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert(JSON.stringify(Object.keys(value).sort(compareUtf8)) === JSON.stringify([...keys].sort(compareUtf8)), `${label} fields mismatch; unknown project/private data is forbidden`, "CROSS_PROJECT_MEMORY_FORBIDDEN");
}
function resolveRegularRoot(authorityRoot, relativePath) {
  assert(typeof authorityRoot === "string" && path.isAbsolute(authorityRoot), "Global governance memory root must be absolute");
  assert(typeof relativePath === "string" && !path.isAbsolute(relativePath) && !relativePath.split(/[\\/]/u).some((part) => part === ".." || part === ""), "Global governance memory path is unsafe");
  const target = path.resolve(authorityRoot, relativePath);
  assert(target.startsWith(`${path.resolve(authorityRoot)}${path.sep}`), "Global governance memory path escaped its root");
  return target;
}

function validateGlobalEvent(event, {nowUtc = event?.observed_at_utc} = {}) {
  exactKeys(event, EVENT_KEYS, "Global governance memory event");
  assert(event.schema === GLOBAL_GOVERNANCE_MEMORY_EVENT_SCHEMA && event.version === 1, "Global governance memory event identity is invalid");
  assert(GLOBAL_GOVERNANCE_MEMORY_WRITERS.includes(event.writer_role), "Global governance memory writer is forbidden", "GLOBAL_MEMORY_WRITER_FORBIDDEN");
  assert(["MODEL_POLICY_ACCEPTED", "MODEL_POLICY_SUPERSEDED", "MODEL_POLICY_INVALIDATED"].includes(event.event_type), "Global governance memory event type is invalid");
  assert(Number.isSafeInteger(event.sequence) && event.sequence >= 0, "Global governance memory sequence is invalid");
  requireSha(event.prior_event_sha256, "Global governance memory prior head");
  if (event.event_type === "MODEL_POLICY_ACCEPTED") {
    assert(event.target_snapshot_sha256 === null && event.reason_code === null, "Policy acceptance cannot target or explain another snapshot");
    validateModelPolicySnapshot(event.snapshot, {nowUtc, requireActive: true});
  } else {
    assert(event.snapshot === null, "Supersession/invalidation cannot inject a replacement snapshot");
    requireSha(event.target_snapshot_sha256, "Global governance target snapshot");
    assert(typeof event.reason_code === "string" && /^[A-Z][A-Z0-9_]{2,127}$/u.test(event.reason_code), "Global governance reason code is invalid");
  }
  requireSha(event.event_sha256, "Global governance memory event digest");
  assert(event.event_sha256 === canonicalDigest(digestBody(event, "event_sha256")), "Global governance memory event digest mismatch");
  return event;
}

export function compileGlobalGovernanceMemoryEvent({eventId, sequence, eventType, writerRole, snapshot = null, targetSnapshotSha256 = null, reasonCode = null, priorEventSha256, observedAtUtc}) {
  assert(GLOBAL_GOVERNANCE_MEMORY_WRITERS.includes(writerRole), "Global governance memory writer is forbidden", "GLOBAL_MEMORY_WRITER_FORBIDDEN");
  assert(["MODEL_POLICY_ACCEPTED", "MODEL_POLICY_SUPERSEDED", "MODEL_POLICY_INVALIDATED"].includes(eventType), "Global governance memory event type is invalid");
  assert(Number.isSafeInteger(sequence) && sequence >= 0, "Global governance memory sequence is invalid");
  requireSha(priorEventSha256, "Global governance memory prior head");
  const event = {schema: GLOBAL_GOVERNANCE_MEMORY_EVENT_SCHEMA, version: 1, event_id: eventId, sequence, event_type: eventType, writer_role: writerRole, prior_event_sha256: priorEventSha256, snapshot, target_snapshot_sha256: targetSnapshotSha256, reason_code: reasonCode, observed_at_utc: observedAtUtc, event_sha256: null};
  event.event_sha256 = canonicalDigest(digestBody(event, "event_sha256"));
  return validateGlobalEvent(event, {nowUtc: observedAtUtc});
}

export function replayGlobalGovernanceMemory(events, {observedAtUtc = events.at(-1)?.observed_at_utc ?? new Date().toISOString()} = {}) {
  assert(Array.isArray(events), "Global governance memory events must be an array");
  let head = GLOBAL_GOVERNANCE_MEMORY_GENESIS;
  let current = null;
  const history = [];
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    validateGlobalEvent(event, {nowUtc: event.observed_at_utc});
    assert(event.sequence === index && event.prior_event_sha256 === head, "Global governance memory chain is stale or noncontiguous", "GLOBAL_MEMORY_CAS_STALE");
    if (event.event_type === "MODEL_POLICY_ACCEPTED") {
      assert(current === null, "A current model policy must be superseded or invalidated before replacement", "GLOBAL_MEMORY_INVALID_SUPERSESSION");
      current = event.snapshot;
      history.push(event.snapshot.snapshot_sha256);
    } else {
      assert(current !== null && current.snapshot_sha256 === event.target_snapshot_sha256, "Supersession/invalidation target is stale or unknown", "GLOBAL_MEMORY_INVALID_SUPERSESSION");
      current = null;
    }
    head = event.event_sha256;
  }
  if (current !== null) validateModelPolicySnapshot(current, {nowUtc: observedAtUtc, requireActive: true});
  return Object.freeze({status: current === null ? "UNAVAILABLE" : "READY", event_count: events.length, head_sha256: head, current_snapshot: current, history: [...history]});
}

export function readGlobalGovernanceMemory({authorityRoot, relativePath = "global-governance/model-policy-events.jsonl"}) {
  const target = resolveRegularRoot(authorityRoot, relativePath);
  if (!fs.existsSync(target)) return [];
  const stat = fs.lstatSync(target);
  assert(stat.isFile() && !stat.isSymbolicLink(), "Global governance memory ledger must be a regular non-symlink file");
  const text = fs.readFileSync(target, "utf8");
  if (text.length === 0) return [];
  assert(text.endsWith("\n"), "Global governance memory ledger is truncated");
  return text.trimEnd().split("\n").map((line) => JSON.parse(line));
}

export function appendGlobalGovernanceMemoryEvent({authorityRoot, relativePath = "global-governance/model-policy-events.jsonl", expectedHeadSha256, event}) {
  const target = resolveRegularRoot(authorityRoot, relativePath);
  fs.mkdirSync(path.dirname(target), {recursive: true});
  const lockPath = `${target}.lock`;
  const lock = {schema: "agentos.global_governance_memory_lock.v1", version: 1, process_id: process.pid, target_relative_path: relativePath, acquired_at_utc: new Date().toISOString(), fence_sha256: null};
  lock.fence_sha256 = canonicalDigest(digestBody(lock, "fence_sha256"));
  let lockFd;
  try {
    lockFd = fs.openSync(lockPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
    fs.writeFileSync(lockFd, `${canonicalJson(lock)}\n`); fs.fsyncSync(lockFd); fs.closeSync(lockFd); lockFd = undefined;
  } catch (error) {
    if (lockFd !== undefined) fs.closeSync(lockFd);
    if (error.code === "EEXIST") assert(false, "Global governance memory ledger is locked", "GLOBAL_MEMORY_LOCKED");
    throw error;
  }
  try {
    const events = readGlobalGovernanceMemory({authorityRoot, relativePath});
    const replay = replayGlobalGovernanceMemory(events, {observedAtUtc: event.observed_at_utc});
    assert(replay.head_sha256 === expectedHeadSha256, "Global governance memory compare-and-swap head is stale", "GLOBAL_MEMORY_CAS_STALE");
    if (events.some((entry) => entry.event_sha256 === event.event_sha256)) return {status: "IDEMPOTENT", replay, fence_sha256: lock.fence_sha256};
    assert(event.sequence === events.length && event.prior_event_sha256 === replay.head_sha256, "Global governance memory append is not bound to the current head");
    const nextReplay = replayGlobalGovernanceMemory([...events, event], {observedAtUtc: event.observed_at_utc});
    const temporary = `${target}.tmp.${lock.fence_sha256}`;
    const descriptor = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
    try { fs.writeFileSync(descriptor, `${[...events, event].map((entry) => canonicalJson(entry)).join("\n")}\n`); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    fs.renameSync(temporary, target);
    const directoryFd = fs.openSync(path.dirname(target), fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY ?? 0));
    try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
    const readback = readGlobalGovernanceMemory({authorityRoot, relativePath});
    assert(readback.length === events.length + 1 && readback.at(-1).event_sha256 === event.event_sha256, "Global governance memory durable readback differs");
    return {status: "APPENDED", replay: nextReplay, fence_sha256: lock.fence_sha256};
  } finally {
    try { fs.unlinkSync(lockPath); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

export function recoverGlobalGovernanceMemoryLock({authorityRoot, relativePath = "global-governance/model-policy-events.jsonl", isProcessAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === "ESRCH") return false; throw error; } }} = {}) {
  const target = resolveRegularRoot(authorityRoot, relativePath);
  const lockPath = `${target}.lock`;
  if (!fs.existsSync(lockPath)) return {status: "NO_LOCK", recovered_lock_path: null};
  const stat = fs.lstatSync(lockPath); assert(stat.isFile() && !stat.isSymbolicLink(), "Global governance lock is unsafe");
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8")); exactKeys(lock, LOCK_KEYS, "Global governance memory lock");
  assert(lock.schema === "agentos.global_governance_memory_lock.v1" && lock.version === 1 && Number.isSafeInteger(lock.process_id) && lock.process_id > 0 && lock.target_relative_path === relativePath, "Global governance lock lease is invalid");
  requireSha(lock.fence_sha256, "Global governance lock fence"); assert(lock.fence_sha256 === canonicalDigest(digestBody(lock, "fence_sha256")), "Global governance lock fence mismatch");
  assert(isProcessAlive(lock.process_id) === false, "Global governance lock owner is still alive", "GLOBAL_MEMORY_LOCKED");
  const recovered = `${lockPath}.recovered.${lock.fence_sha256}`; fs.renameSync(lockPath, recovered);
  return {status: "RECOVERED_DEAD_LOCK", recovered_lock_path: recovered, fence_sha256: lock.fence_sha256};
}

export function compileGlobalGovernanceMemoryReadback({events, historicalActivationReceiptSha256, observedAtUtc}) {
  requireSha(historicalActivationReceiptSha256, "Historical activation receipt");
  const replay = replayGlobalGovernanceMemory(events);
  assert(replay.status === "READY", "Global governance model policy is unavailable", "MODEL_POLICY_UNAVAILABLE");
  validateModelPolicySnapshot(replay.current_snapshot, {nowUtc: observedAtUtc, requireActive: true});
  const readback = {schema: GLOBAL_GOVERNANCE_MEMORY_READBACK_SCHEMA, version: 1, status: "CURRENT", historical_activation_receipt_sha256: historicalActivationReceiptSha256, live_event_count: replay.event_count, live_ledger_head_sha256: replay.head_sha256, current_snapshot_sha256: replay.current_snapshot.snapshot_sha256, observed_at_utc: observedAtUtc, readback_sha256: null};
  readback.readback_sha256 = canonicalDigest(digestBody(readback, "readback_sha256"));
  return readback;
}

export function validateGlobalGovernanceMemoryReadback(readback, {events, observedAtUtc = readback?.observed_at_utc} = {}) {
  exactKeys(readback, READBACK_KEYS, "Global governance memory readback");
  assert(readback?.schema === GLOBAL_GOVERNANCE_MEMORY_READBACK_SCHEMA && readback.version === 1 && readback.status === "CURRENT", "Global governance memory readback identity is invalid");
  const replay = replayGlobalGovernanceMemory(events);
  assert(readback.live_event_count === replay.event_count && readback.live_ledger_head_sha256 === replay.head_sha256 && readback.current_snapshot_sha256 === replay.current_snapshot?.snapshot_sha256, "Global governance memory readback is stale", "GLOBAL_MEMORY_READBACK_STALE");
  validateModelPolicySnapshot(replay.current_snapshot, {nowUtc: observedAtUtc, requireActive: true});
  requireSha(readback.readback_sha256, "Global governance memory readback digest");
  assert(readback.readback_sha256 === canonicalDigest(digestBody(readback, "readback_sha256")), "Global governance memory readback digest mismatch");
  return readback;
}

export function assertGlobalPolicyVisibility(roleClass, readback) {
  assert(MODEL_POLICY_ROLE_CLASSES.includes(roleClass), "Global policy reader role is invalid");
  assert(readback?.status === "CURRENT", "Global model policy is not visible to the reader");
  return Object.freeze({role_class: roleClass, read_only: true, snapshot_sha256: readback.current_snapshot_sha256, readback_sha256: readback.readback_sha256});
}
