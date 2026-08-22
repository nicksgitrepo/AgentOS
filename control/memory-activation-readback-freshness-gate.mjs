#!/usr/bin/env node

/*
 * Project-agnostic memory activation/readback freshness gate.
 *
 * An activation receipt is a historical baseline.  It is not a live ledger
 * or snapshot readback when later valid events advance the cursor.  This
 * compiler-only gate makes that distinction explicit and rejects any
 * closeout that silently presents the activation baseline as current state.
 */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";

export const MEMORY_ACTIVATION_READBACK_FRESHNESS_GATE_SCHEMA = "agentos.memory_activation_readback_freshness_gate.v1";
export const MEMORY_ACTIVATION_READBACK_FRESHNESS_GATE_VERSION = 1;
export const MEMORY_ACTIVATION_READBACK_REPAIR_ACTION = "REPAIR_BLOCKS";
export const MEMORY_ACTIVATION_READBACK_REPAIR_HANDLER = "HANDLER.ORCHESTRATOR_BLOCK_REPAIR";
export const MEMORY_ACTIVATION_READBACK_HOSTILE_FIXTURE_REFS = Object.freeze([
  "FIXTURE.MEMORY.ACTIVATION_BASELINE_AS_LIVE",
  "FIXTURE.MEMORY.CANONICAL_ACTIVATION_DIGEST_DRIFT",
  "FIXTURE.MEMORY.LEDGER_HEAD_DRIFT",
  "FIXTURE.MEMORY.SNAPSHOT_CURSOR_DRIFT",
  "FIXTURE.MEMORY.SNAPSHOT_DIGEST_DRIFT",
]);

const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Z][A-Z0-9._:-]{0,191}$/u;
const REFERENCE = /^(?:opaque:|ref:)[^\s]+$/u;
const GATE_KEYS = Object.freeze([
  "schema", "version", "gate_id", "status", "defect_id", "activation_baseline", "live_readback",
  "freshness_rule", "limitations", "custody", "evidence_refs", "hostile_fixture_refs", "source_action",
  "next_action", "next_handler", "spawnable", "same_turn_dispatch", "gate_sha256",
]);
const BASELINE_KEYS = Object.freeze([
  "activation_receipt_ref", "activation_receipt_sha256", "event_count", "ledger_head_sha256", "snapshot_sha256",
]);
const LIVE_KEYS = Object.freeze([
  "ledger_ref", "ledger_event_count", "ledger_head_sha256", "snapshot_ref", "snapshot_event_cursor",
  "snapshot_head_sha256", "snapshot_sha256", "ledger_snapshot_consistent", "readback_sha256",
]);
const RULE_KEYS = Object.freeze([
  "baseline_is_historical", "live_state_is_current", "activation_matches_live", "stale_mismatch_rejected",
  "ledger_snapshot_heads_must_match", "snapshot_digest_must_match", "readback_digest_revalidated",
]);
const LIMITATION_KEYS = Object.freeze(["snapshot_status", "graph_projection", "derived_index_sha256"]);
const CUSTODY_KEYS = Object.freeze([
  "compiler_only", "controller_approval_required", "execution_owner", "direct_consumer", "product_mutation",
  "provider_access", "credential_access", "spend", "destructive_work", "worker_activation", "wave_activation",
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected, label) {
  assert(isRecord(value), `${label} must be an object`);
  const actual = Object.keys(value).sort(compareUtf8);
  const required = [...expected].sort(compareUtf8);
  assert(JSON.stringify(actual) === JSON.stringify(required), `${label} fields mismatch`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
  assert(value !== "0".repeat(64) && value !== "f".repeat(64), `${label} may not be a placeholder digest`);
}

function requireIdentifier(value, label) {
  assert(typeof value === "string" && IDENTIFIER.test(value), `${label} must be a stable identifier`);
}

function requireReference(value, label) {
  assert(typeof value === "string" && REFERENCE.test(value), `${label} must be a control-plane reference`);
}

function digestWithout(value, field) {
  const body = structuredClone(value);
  body[field] = null;
  return canonicalDigest(body);
}

function validateBaseline(baseline) {
  exactKeys(baseline, BASELINE_KEYS, "Memory activation baseline");
  requireReference(baseline.activation_receipt_ref, "Memory activation receipt reference");
  requireSha(baseline.activation_receipt_sha256, "Memory activation receipt digest");
  assert(Number.isSafeInteger(baseline.event_count) && baseline.event_count >= 0, "Memory activation event count is invalid");
  requireSha(baseline.ledger_head_sha256, "Memory activation ledger head");
  requireSha(baseline.snapshot_sha256, "Memory activation snapshot digest");
  return baseline;
}

function validateLiveReadback(live, baseline) {
  exactKeys(live, LIVE_KEYS, "Memory live readback");
  requireReference(live.ledger_ref, "Memory live ledger reference");
  assert(Number.isSafeInteger(live.ledger_event_count) && live.ledger_event_count >= baseline.event_count, "Memory live ledger event count is stale or invalid");
  requireSha(live.ledger_head_sha256, "Memory live ledger head");
  requireReference(live.snapshot_ref, "Memory live snapshot reference");
  assert(Number.isSafeInteger(live.snapshot_event_cursor) && live.snapshot_event_cursor === live.ledger_event_count, "Memory snapshot cursor does not match live ledger");
  requireSha(live.snapshot_head_sha256, "Memory live snapshot head");
  requireSha(live.snapshot_sha256, "Memory live snapshot digest");
  assert(live.ledger_snapshot_consistent === true, "Memory live ledger/snapshot consistency is not proven");
  requireSha(live.readback_sha256, "Memory live readback digest");
  assert(live.ledger_head_sha256 === live.snapshot_head_sha256, "Memory ledger and snapshot heads diverge");
  assert(live.snapshot_sha256 !== baseline.snapshot_sha256 || live.ledger_event_count !== baseline.event_count || live.ledger_head_sha256 !== baseline.ledger_head_sha256, "Memory activation baseline was incorrectly presented as live");
  assert(live.ledger_event_count > baseline.event_count, "Memory live ledger did not advance beyond the activation baseline");
  assert(live.readback_sha256 === digestWithout(live, "readback_sha256"), "Memory live readback digest mismatch");
  return live;
}

function validateRule(rule) {
  exactKeys(rule, RULE_KEYS, "Memory freshness rule");
  assert(rule.baseline_is_historical === true, "Memory activation baseline must remain historical");
  assert(rule.live_state_is_current === true, "Memory live state freshness is not proven");
  assert(rule.activation_matches_live === false, "Memory stale activation baseline was accepted as live");
  for (const key of ["stale_mismatch_rejected", "ledger_snapshot_heads_must_match", "snapshot_digest_must_match", "readback_digest_revalidated"]) {
    assert(rule[key] === true, `Memory freshness rule ${key} is weakened`);
  }
  return rule;
}

function validateLimitations(limitations) {
  exactKeys(limitations, LIMITATION_KEYS, "Memory freshness limitations");
  assert(limitations.snapshot_status === "PARTIAL", "Memory snapshot limitation must remain PARTIAL");
  assert(limitations.graph_projection === "ADVISORY_ONLY_REBUILDABLE", "Memory graph projection limitation is weakened");
  assert(limitations.derived_index_sha256 === null, "Memory derived index limitation must remain explicit null");
  return limitations;
}

function validateCustody(custody) {
  exactKeys(custody, CUSTODY_KEYS, "Memory freshness custody");
  assert(custody.compiler_only === true, "Memory freshness gate must remain compiler-only");
  assert(custody.controller_approval_required === false, "Memory freshness gate cannot require Controller approval");
  assert(custody.execution_owner === "LANE_AGENT", "Memory freshness execution owner is invalid");
  assert(custody.direct_consumer === "INDEPENDENT_PLATFORM_REVIEW", "Memory freshness direct consumer is invalid");
  for (const key of ["product_mutation", "provider_access", "credential_access", "spend", "destructive_work", "worker_activation", "wave_activation"]) {
    assert(custody[key] === false, `Memory freshness custody ${key} must remain closed`);
  }
  return custody;
}

function validateEvidenceRefs(refs) {
  assert(Array.isArray(refs) && refs.length > 0, "Memory freshness evidence refs are required");
  const ids = refs.map((ref, index) => {
    exactKeys(ref, ["evidence_id", "reference", "sha256"], `Memory freshness evidence ${index}`);
    requireIdentifier(ref.evidence_id, `Memory freshness evidence ${index} id`);
    requireReference(ref.reference, `Memory freshness evidence ${index} reference`);
    requireSha(ref.sha256, `Memory freshness evidence ${index} digest`);
    return ref.evidence_id;
  });
  const ordered = [...ids].sort(compareUtf8);
  assert(new Set(ids).size === ids.length && JSON.stringify(ids) === JSON.stringify(ordered), "Memory freshness evidence refs must be sorted and unique");
  return refs;
}

function validateHostileRefs(refs) {
  assert(Array.isArray(refs), "Memory freshness hostile fixture refs are required");
  const ordered = [...refs].sort(compareUtf8);
  assert(JSON.stringify(refs) === JSON.stringify(ordered), "Memory freshness hostile fixtures must be sorted");
  assert(new Set(refs).size === refs.length, "Memory freshness hostile fixtures must be unique");
  assert(JSON.stringify(refs) === JSON.stringify(MEMORY_ACTIVATION_READBACK_HOSTILE_FIXTURE_REFS), "Memory freshness hostile fixture coverage is incomplete");
  return refs;
}

export function validateMemoryActivationReadbackFreshnessGate(gate) {
  exactKeys(gate, GATE_KEYS, "Memory activation/readback freshness gate");
  assert(gate.schema === MEMORY_ACTIVATION_READBACK_FRESHNESS_GATE_SCHEMA && gate.version === MEMORY_ACTIVATION_READBACK_FRESHNESS_GATE_VERSION, "Memory freshness gate identity is invalid");
  requireIdentifier(gate.gate_id, "Memory freshness gate id");
  assert(gate.status === "REPAIR_REQUIRED", "Memory freshness gate must remain a repair requirement");
  requireIdentifier(gate.defect_id, "Memory freshness defect id");
  validateBaseline(gate.activation_baseline);
  validateLiveReadback(gate.live_readback, gate.activation_baseline);
  validateRule(gate.freshness_rule);
  validateLimitations(gate.limitations);
  validateCustody(gate.custody);
  validateEvidenceRefs(gate.evidence_refs);
  validateHostileRefs(gate.hostile_fixture_refs);
  assert(gate.source_action === "COMPILE_BLOCK_PATCH", "Memory freshness source action is invalid");
  assert(gate.next_action === MEMORY_ACTIVATION_READBACK_REPAIR_ACTION, "Memory freshness next action is invalid");
  assert(gate.next_handler === MEMORY_ACTIVATION_READBACK_REPAIR_HANDLER, "Memory freshness next handler is invalid");
  assert(gate.spawnable === false, "Memory freshness gate must remain non-spawnable");
  assert(gate.same_turn_dispatch === true, "Memory freshness gate requires same-turn repair dispatch");
  requireSha(gate.gate_sha256, "Memory freshness gate digest");
  assert(gate.gate_sha256 === canonicalDigest({...gate, gate_sha256: null}), "Memory freshness gate digest mismatch");
  return gate;
}

export function compileMemoryActivationReadbackFreshnessGate({
  gateId,
  defectId,
  activationBaseline,
  liveReadback,
  limitations = {snapshot_status: "PARTIAL", graph_projection: "ADVISORY_ONLY_REBUILDABLE", derived_index_sha256: null},
  custody,
  evidenceRefs,
} = {}) {
  requireIdentifier(gateId, "Memory freshness gate id");
  requireIdentifier(defectId, "Memory freshness defect id");
  const gate = {
    schema: MEMORY_ACTIVATION_READBACK_FRESHNESS_GATE_SCHEMA,
    version: MEMORY_ACTIVATION_READBACK_FRESHNESS_GATE_VERSION,
    gate_id: gateId,
    status: "REPAIR_REQUIRED",
    defect_id: defectId,
    activation_baseline: structuredClone(activationBaseline),
    live_readback: structuredClone(liveReadback),
    freshness_rule: {
      baseline_is_historical: true,
      live_state_is_current: true,
      activation_matches_live: false,
      stale_mismatch_rejected: true,
      ledger_snapshot_heads_must_match: true,
      snapshot_digest_must_match: true,
      readback_digest_revalidated: true,
    },
    limitations: structuredClone(limitations),
    custody: structuredClone(custody),
    evidence_refs: structuredClone(evidenceRefs),
    hostile_fixture_refs: [...MEMORY_ACTIVATION_READBACK_HOSTILE_FIXTURE_REFS],
    source_action: "COMPILE_BLOCK_PATCH",
    next_action: MEMORY_ACTIVATION_READBACK_REPAIR_ACTION,
    next_handler: MEMORY_ACTIVATION_READBACK_REPAIR_HANDLER,
    spawnable: false,
    same_turn_dispatch: true,
    gate_sha256: null,
  };
  gate.gate_sha256 = canonicalDigest({...gate, gate_sha256: null});
  return validateMemoryActivationReadbackFreshnessGate(gate);
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("Memory activation/readback freshness gate loaded\n");
