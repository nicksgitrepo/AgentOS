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
const FORBIDDEN_KEYS = new Set(["project_ref", "project_id", "consumer", "credential", "secret", "deployment", "raw_transcript", "conversation"]);

function assert(condition, message, code = "GLOBAL_GOVERNANCE_MEMORY_INVALID") {
  if (!condition) { const error = new Error(message); error.code = code; throw error; }
}
function requireSha(value, label) { assert(typeof value === "string" && SHA256.test(value), `${label} must be a SHA-256`); }
function digestBody(value, field) { return {...structuredClone(value), [field]: null}; }
function assertProjectAgnostic(value, pathLabel = "global governance memory") {
  if (Array.isArray(value)) return value.forEach((entry, index) => assertProjectAgnostic(entry, `${pathLabel}[${index}]`));
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert(!FORBIDDEN_KEYS.has(key.toLowerCase()), `${pathLabel} contains forbidden project/private key: ${key}`, "CROSS_PROJECT_MEMORY_FORBIDDEN");
    assertProjectAgnostic(child, `${pathLabel}.${key}`);
  }
}
function resolveRegularRoot(authorityRoot, relativePath) {
  assert(typeof authorityRoot === "string" && path.isAbsolute(authorityRoot), "Global governance memory root must be absolute");
  assert(typeof relativePath === "string" && !path.isAbsolute(relativePath) && !relativePath.split(/[\\/]/u).some((part) => part === ".." || part === ""), "Global governance memory path is unsafe");
  const target = path.resolve(authorityRoot, relativePath);
  assert(target.startsWith(`${path.resolve(authorityRoot)}${path.sep}`), "Global governance memory path escaped its root");
  return target;
}

export function compileGlobalGovernanceMemoryEvent({eventId, sequence, eventType, writerRole, snapshot, priorEventSha256, observedAtUtc}) {
  assert(GLOBAL_GOVERNANCE_MEMORY_WRITERS.includes(writerRole), "Global governance memory writer is forbidden", "GLOBAL_MEMORY_WRITER_FORBIDDEN");
  assert(["MODEL_POLICY_ACCEPTED", "MODEL_POLICY_SUPERSEDED", "MODEL_POLICY_INVALIDATED"].includes(eventType), "Global governance memory event type is invalid");
  assert(Number.isSafeInteger(sequence) && sequence >= 0, "Global governance memory sequence is invalid");
  requireSha(priorEventSha256, "Global governance memory prior head");
  validateModelPolicySnapshot(snapshot, {nowUtc: observedAtUtc, requireActive: eventType === "MODEL_POLICY_ACCEPTED"});
  assertProjectAgnostic(snapshot);
  const event = {schema: GLOBAL_GOVERNANCE_MEMORY_EVENT_SCHEMA, version: 1, event_id: eventId, sequence, event_type: eventType, writer_role: writerRole, prior_event_sha256: priorEventSha256, snapshot, observed_at_utc: observedAtUtc, event_sha256: null};
  event.event_sha256 = canonicalDigest(digestBody(event, "event_sha256"));
  return event;
}

export function replayGlobalGovernanceMemory(events) {
  assert(Array.isArray(events), "Global governance memory events must be an array");
  let head = GLOBAL_GOVERNANCE_MEMORY_GENESIS;
  let current = null;
  const history = [];
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    assert(event.schema === GLOBAL_GOVERNANCE_MEMORY_EVENT_SCHEMA && event.version === 1, "Global governance memory event identity is invalid");
    assert(event.sequence === index && event.prior_event_sha256 === head, "Global governance memory chain is stale or noncontiguous", "GLOBAL_MEMORY_CAS_STALE");
    requireSha(event.event_sha256, "Global governance memory event digest");
    assert(event.event_sha256 === canonicalDigest(digestBody(event, "event_sha256")), "Global governance memory event digest mismatch");
    assert(GLOBAL_GOVERNANCE_MEMORY_WRITERS.includes(event.writer_role), "Global governance memory writer is forbidden");
    assertProjectAgnostic(event.snapshot);
    history.push(event.snapshot.snapshot_sha256);
    if (event.event_type === "MODEL_POLICY_ACCEPTED") current = event.snapshot;
    if (["MODEL_POLICY_SUPERSEDED", "MODEL_POLICY_INVALIDATED"].includes(event.event_type) && current?.snapshot_sha256 === event.snapshot.snapshot_sha256) current = null;
    head = event.event_sha256;
  }
  return Object.freeze({status: current === null ? "UNAVAILABLE" : "READY", event_count: events.length, head_sha256: head, current_snapshot: current, history: [...history].sort(compareUtf8)});
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
  const events = readGlobalGovernanceMemory({authorityRoot, relativePath});
  const replay = replayGlobalGovernanceMemory(events);
  assert(replay.head_sha256 === expectedHeadSha256, "Global governance memory compare-and-swap head is stale", "GLOBAL_MEMORY_CAS_STALE");
  if (events.some((entry) => entry.event_sha256 === event.event_sha256)) return {status: "IDEMPOTENT", replay};
  assert(event.sequence === events.length && event.prior_event_sha256 === replay.head_sha256, "Global governance memory append is not bound to the current head");
  replayGlobalGovernanceMemory([...events, event]);
  fs.mkdirSync(path.dirname(target), {recursive: true});
  const descriptor = fs.openSync(target, "a", 0o600);
  try { fs.writeFileSync(descriptor, `${JSON.stringify(event)}\n`); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  return {status: "APPENDED", replay: replayGlobalGovernanceMemory([...events, event])};
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

