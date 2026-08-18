#!/usr/bin/env node

/* Append-only project-agnostic governance memory; never stores project memory. */

import fs from "node:fs";
import path from "node:path";
import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {MODEL_POLICY_ROLE_CLASSES, MODEL_POLICY_SNAPSHOT_SCHEMA, validateModelPolicySnapshot} from "./eco-model-policy.mjs";

export const GLOBAL_GOVERNANCE_MEMORY_EVENT_SCHEMA = "agentos.global_governance_memory_event.v1";
export const GLOBAL_GOVERNANCE_MEMORY_READBACK_SCHEMA = "agentos.global_governance_memory_readback.v1";
export const GLOBAL_GOVERNANCE_MEMORY_GENESIS = canonicalDigest({schema: "agentos.global_governance_memory_genesis.v1"});
export const GLOBAL_GOVERNANCE_MEMORY_WRITERS = Object.freeze(["SPAWNER", "GOVERNED_MEMORY_ADAPTER"]);

const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_EVENT_ID = /^GGM\.(?:ACCEPTED|SUPERSEDED|INVALIDATED)\.[0-9A-F]{48}$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const MAX_READBACK_AGE_MS = 24 * 60 * 60 * 1000;
const EVENT_KEYS = ["schema", "version", "event_id", "sequence", "event_type", "writer_role", "prior_event_sha256", "snapshot", "target_snapshot_sha256", "reason_code", "observed_at_utc", "event_sha256"];
const READBACK_KEYS = ["schema", "version", "status", "historical_activation_receipt_sha256", "live_event_count", "live_ledger_head_sha256", "current_snapshot_sha256", "observed_at_utc", "readback_sha256"];
const LOCK_KEYS = ["schema", "version", "process_id", "target_relative_path", "acquired_at_utc", "fence_sha256"];
const FORBIDDEN_KEY = /(?:consumer|customer|project_(?:id|name|path|context)|credential|secret|password|passkey|api_?key|access_?token|bearer|session_(?:id|state)|deployment|raw_(?:chat|prompt|transcript)|conversation)/iu;
const FORBIDDEN_VALUE = /(?:(?:consumer|customer)|project[._ -](?:name|id|data|context|path)|\b(?:user|assistant|system)\s*:|system prompt|prompt text|raw (?:chat|prompt|browsing transcript)|bearer\s+[a-z0-9._~+/-]+=*|(?:api[_ -]?key|password|credential|access[_ -]?token)\s*[:=]|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{12,}|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|(?:^|[\s"'])(?:\/U(?:sers)\/|\/home\/|\/tmp\/|\/var\/folders\/|~\/|[A-Za-z]:\\))/iu;
const SAFE_FALSE_KEYS = new Set(["contains_consumer_context", "raw_browsing_transcripts", "raw_transcript_stored"]);

function assert(condition, message, code = "GLOBAL_GOVERNANCE_MEMORY_INVALID") {
  if (!condition) { const error = new Error(message); error.code = code; throw error; }
}
function requireSha(value, label) { assert(typeof value === "string" && SHA256.test(value), `${label} must be a SHA-256`); }
function requireUtc(value, label) { assert(typeof value === "string" && ISO_UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} must be an exact UTC timestamp`); return Date.parse(value); }
function digestBody(value, field) { return {...structuredClone(value), [field]: null}; }
function eventIdentityBody(event) {
  const body = structuredClone(event);
  delete body.event_id;
  delete body.event_sha256;
  return body;
}
function mintedEventId(event) {
  const kind = event.event_type.replace("MODEL_POLICY_", "");
  return `GGM.${kind}.${canonicalDigest(eventIdentityBody(event)).slice(0, 48).toUpperCase()}`;
}
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

function decodedVariants(value) {
  const normalized = value.normalize("NFKC").replace(/\r\n?/gu, "\n");
  const variants = [normalized];
  let percent = normalized;
  for (let pass = 0; pass < 3; pass += 1) {
    try { const decoded = decodeURIComponent(percent); if (decoded === percent) break; percent = decoded.normalize("NFKC"); variants.push(percent); } catch { break; }
  }
  const escaped = normalized.replace(/\\u\{([0-9a-f]{1,6})\}|\\u([0-9a-f]{4})|\\x([0-9a-f]{2})/giu, (_match, braced, unicode, hex) => String.fromCodePoint(Number.parseInt(braced ?? unicode ?? hex, 16)));
  if (escaped !== normalized) variants.push(escaped);
  if (/^[A-Za-z0-9+/]{24,}={0,2}$/u.test(value) && value.length % 4 === 0) {
    try { const decoded = Buffer.from(value, "base64").toString("utf8"); if (/^[\x09\x0a\x0d\x20-\x7e]+$/u.test(decoded)) variants.push(decoded); } catch {}
  }
  if (/^[0-9a-f]{24,}$/iu.test(value) && value.length % 2 === 0) {
    try { const decoded = Buffer.from(value, "hex").toString("utf8"); if (/^[\x09\x0a\x0d\x20-\x7e]+$/u.test(decoded)) variants.push(decoded); } catch {}
  }
  return [...new Set(variants)];
}

export function assertProjectAgnosticGovernanceValue(value, trail = "global_governance") {
  if (Array.isArray(value)) { value.forEach((entry, index) => assertProjectAgnosticGovernanceValue(entry, `${trail}[${index}]`)); return value; }
  if (value !== null && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (SAFE_FALSE_KEYS.has(key)) assert(entry === false, `${trail}.${key} must remain false`, "GLOBAL_MEMORY_PRIVATE_CONTENT");
      else assert(!FORBIDDEN_KEY.test(key), `${trail}.${key} is a forbidden private/project field`, "GLOBAL_MEMORY_PRIVATE_CONTENT");
      assertProjectAgnosticGovernanceValue(entry, `${trail}.${key}`);
    }
    return value;
  }
  if (typeof value === "string") {
    assert(value.length <= 1024 && !/[\r\n]/u.test(value), `${trail} contains forbidden private multiline or unbounded prose`, "GLOBAL_MEMORY_PRIVATE_CONTENT");
    for (const decoded of decodedVariants(value)) {
      assert(!FORBIDDEN_VALUE.test(decoded), `${trail} contains encoded private content`, "GLOBAL_MEMORY_PRIVATE_CONTENT");
      assert(!/^https?:\/\//iu.test(decoded), `${trail} contains a raw URL; global memory requires a canonical source-registry identifier`, "GLOBAL_MEMORY_PRIVATE_CONTENT");
    }
  }
  return value;
}

function trustedNowUtc() { return new Date().toISOString(); }

function validateGlobalEvent(event) {
  exactKeys(event, EVENT_KEYS, "Global governance memory event");
  assertProjectAgnosticGovernanceValue(event);
  assert(event.schema === GLOBAL_GOVERNANCE_MEMORY_EVENT_SCHEMA && event.version === 1, "Global governance memory event identity is invalid");
  assert(typeof event.event_id === "string" && SAFE_EVENT_ID.test(event.event_id) && event.event_id === mintedEventId(event), "Global governance memory event ID is not internally derived", "GLOBAL_MEMORY_EVENT_ID_INVALID");
  assert(GLOBAL_GOVERNANCE_MEMORY_WRITERS.includes(event.writer_role), "Global governance memory writer is forbidden", "GLOBAL_MEMORY_WRITER_FORBIDDEN");
  assert(["MODEL_POLICY_ACCEPTED", "MODEL_POLICY_SUPERSEDED", "MODEL_POLICY_INVALIDATED"].includes(event.event_type), "Global governance memory event type is invalid");
  assert(Number.isSafeInteger(event.sequence) && event.sequence >= 0, "Global governance memory sequence is invalid");
  const observedMs = requireUtc(event.observed_at_utc, "Global governance observation time");
  const nowUtc = trustedNowUtc();
  const trustedMs = requireUtc(nowUtc, "Global governance trusted time");
  assert(observedMs <= trustedMs, "Global governance event is future-dated", "GLOBAL_MEMORY_EVENT_FUTURE");
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

export function compileGlobalGovernanceMemoryEvent(options = {}) {
  assert(options && typeof options === "object" && !Object.prototype.hasOwnProperty.call(options, "eventId") && !Object.prototype.hasOwnProperty.call(options, "event_id"), "Global governance event identity is minted internally", "GLOBAL_MEMORY_EVENT_ID_CALLER_FORBIDDEN");
  const {sequence, eventType, writerRole, snapshot = null, targetSnapshotSha256 = null, reasonCode = null, priorEventSha256, observedAtUtc} = options;
  assert(GLOBAL_GOVERNANCE_MEMORY_WRITERS.includes(writerRole), "Global governance memory writer is forbidden", "GLOBAL_MEMORY_WRITER_FORBIDDEN");
  assert(["MODEL_POLICY_ACCEPTED", "MODEL_POLICY_SUPERSEDED", "MODEL_POLICY_INVALIDATED"].includes(eventType), "Global governance memory event type is invalid");
  assert(Number.isSafeInteger(sequence) && sequence >= 0, "Global governance memory sequence is invalid");
  requireSha(priorEventSha256, "Global governance memory prior head");
  const event = {schema: GLOBAL_GOVERNANCE_MEMORY_EVENT_SCHEMA, version: 1, event_id: null, sequence, event_type: eventType, writer_role: writerRole, prior_event_sha256: priorEventSha256, snapshot, target_snapshot_sha256: targetSnapshotSha256, reason_code: reasonCode, observed_at_utc: observedAtUtc, event_sha256: null};
  event.event_id = mintedEventId(event);
  event.event_sha256 = canonicalDigest(digestBody(event, "event_sha256"));
  return validateGlobalEvent(event);
}

export function replayGlobalGovernanceMemory(events) {
  assert(Array.isArray(events), "Global governance memory events must be an array");
  let head = GLOBAL_GOVERNANCE_MEMORY_GENESIS;
  let current = null;
  const history = [];
  let priorObservedMs = -Infinity;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    assertProjectAgnosticGovernanceValue(event);
    validateGlobalEvent(event);
    const observedMs = Date.parse(event.observed_at_utc);
    assert(observedMs >= priorObservedMs, "Global governance event time is non-monotonic", "GLOBAL_MEMORY_TIME_NON_MONOTONIC");
    priorObservedMs = observedMs;
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
  if (current !== null) validateModelPolicySnapshot(current, {nowUtc: trustedNowUtc(), requireActive: true});
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
  requireUtc(observedAtUtc, "Global governance readback time");
  const trustedMs = Date.now();
  assert(Date.parse(observedAtUtc) <= trustedMs, "Global governance readback is future-dated", "GLOBAL_MEMORY_READBACK_STALE");
  assert(events.length === 0 || Date.parse(observedAtUtc) >= Date.parse(events.at(-1).observed_at_utc), "Global governance readback predates the live ledger head");
  assert(replay.status === "READY", "Global governance model policy is unavailable", "MODEL_POLICY_UNAVAILABLE");
  validateModelPolicySnapshot(replay.current_snapshot, {nowUtc: observedAtUtc, requireActive: true});
  const readback = {schema: GLOBAL_GOVERNANCE_MEMORY_READBACK_SCHEMA, version: 1, status: "CURRENT", historical_activation_receipt_sha256: historicalActivationReceiptSha256, live_event_count: replay.event_count, live_ledger_head_sha256: replay.head_sha256, current_snapshot_sha256: replay.current_snapshot.snapshot_sha256, observed_at_utc: observedAtUtc, readback_sha256: null};
  readback.readback_sha256 = canonicalDigest(digestBody(readback, "readback_sha256"));
  return readback;
}

export function validateGlobalGovernanceMemoryReadback(readback, {events, ...forbiddenClockOverrides} = {}) {
  assert(Object.keys(forbiddenClockOverrides).length === 0, "Global governance trusted time cannot be supplied by a caller", "GLOBAL_MEMORY_TRUSTED_TIME_OVERRIDE");
  exactKeys(readback, READBACK_KEYS, "Global governance memory readback");
  assert(readback?.schema === GLOBAL_GOVERNANCE_MEMORY_READBACK_SCHEMA && readback.version === 1 && readback.status === "CURRENT", "Global governance memory readback identity is invalid");
  requireUtc(readback.observed_at_utc, "Global governance readback time");
  const trustedMs = Date.now();
  assert(Date.parse(readback.observed_at_utc) <= trustedMs, "Global governance readback is future-dated", "GLOBAL_MEMORY_READBACK_STALE");
  assert(trustedMs - Date.parse(readback.observed_at_utc) <= MAX_READBACK_AGE_MS, "Global governance readback is stale", "GLOBAL_MEMORY_READBACK_STALE");
  const replay = replayGlobalGovernanceMemory(events);
  assert(readback.live_event_count === replay.event_count && readback.live_ledger_head_sha256 === replay.head_sha256 && readback.current_snapshot_sha256 === replay.current_snapshot?.snapshot_sha256, "Global governance memory readback is stale", "GLOBAL_MEMORY_READBACK_STALE");
  validateModelPolicySnapshot(replay.current_snapshot, {nowUtc: trustedNowUtc(), requireActive: true});
  requireSha(readback.readback_sha256, "Global governance memory readback digest");
  assert(readback.readback_sha256 === canonicalDigest(digestBody(readback, "readback_sha256")), "Global governance memory readback digest mismatch");
  return readback;
}

export function assertGlobalPolicyVisibility(roleClass, readback) {
  assert(MODEL_POLICY_ROLE_CLASSES.includes(roleClass), "Global policy reader role is invalid");
  assert(readback?.status === "CURRENT", "Global model policy is not visible to the reader");
  return Object.freeze({role_class: roleClass, read_only: true, snapshot_sha256: readback.current_snapshot_sha256, readback_sha256: readback.readback_sha256});
}
