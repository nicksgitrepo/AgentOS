#!/usr/bin/env node

/*
 * Project-agnostic cross-record liveness digest gate.
 *
 * The action-result contract protects the result record itself and the typed
 * successor contract protects its semantic readback.  This gate closes the
 * boundary between those records: a liveness handoff is admissible only when
 * all four digest slots, the successor route, the authority binding, and the
 * roster binding are present and mutually consistent.
 */

import {canonicalDigest, canonicalJson, compareUtf8} from "./content-addressing.mjs";
import {validateActionResultContinuation} from "./action-result-continuation.mjs";
import {validateTypedSuccessorReadback} from "./typed-successor-readback.mjs";

export const LIVENESS_DIGEST_GATE_SCHEMA = "agentos.liveness_digest_gate.v1";
export const LIVENESS_DIGEST_GATE_VERSION = 1;
export const LIVENESS_DIGEST_GATE_STATUS = "PASS";
export const LIVENESS_ROSTER_INVALIDATION_RULE = "INVALIDATE_AND_REBUILD_DEPENDENTS_ON_BLOCK_CHANGE";
export const LIVENESS_ROSTER_REFRESH_TRIGGERS = Object.freeze([
  "ACTION_MAPPING_CHANGE",
  "APPLICABILITY_CHANGE",
  "AUTHORITY_CHANGE",
  "CONTINUATION_CHANGE",
  "READBACK_CHANGE",
  "RESULT_CHANGE",
  "ROSTER_CHANGE",
].sort(compareUtf8));

const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40,64}$/u;
const IDENTIFIER = /^[A-Z][A-Z0-9._:-]{0,191}$/u;
const REFERENCE = /^(?:opaque:|ref:)[^\s]+$/u;
const GATE_KEYS = Object.freeze([
  "schema", "version", "gate_id", "defect_id", "action_id", "action_result",
  "result_sha256", "continuation_sha256", "record_sha256", "typed_successor",
  "readback", "readback_sha256", "authority_binding", "roster_binding",
  "evidence_refs", "hostile_fixture_refs", "status", "gate_sha256",
]);
const AUTHORITY_BINDING_KEYS = Object.freeze([
  "authority_commit", "authority_tree", "authority_receipt_ref", "authority_receipt_sha256", "source_mapping_sha256",
]);
const ROSTER_BINDING_KEYS = Object.freeze([
  "roster_projection_sha256", "applicability_sha256", "invalidation_rule", "refresh_triggers",
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

function requireIdentifier(value, label) {
  assert(typeof value === "string" && IDENTIFIER.test(value), `${label} must be a stable uppercase identifier`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function requireCanonicalSha(value, label) {
  requireSha(value, label);
  assert(value !== "0".repeat(64) && value !== "f".repeat(64), `${label} may not be a placeholder digest`);
}

function requireGitObject(value, label) {
  assert(typeof value === "string" && GIT_OBJECT.test(value), `${label} must be a Git object id`);
  assert(!/^0+$/u.test(value) && !/^f+$/u.test(value), `${label} may not be a placeholder object id`);
}

function requireReference(value, label) {
  assert(typeof value === "string" && REFERENCE.test(value), `${label} must be an opaque/reference URI`);
}

function validateAuthorityBinding(binding) {
  exactKeys(binding, AUTHORITY_BINDING_KEYS, "Liveness authority binding");
  requireGitObject(binding.authority_commit, "Liveness authority commit");
  requireGitObject(binding.authority_tree, "Liveness authority tree");
  requireReference(binding.authority_receipt_ref, "Liveness authority receipt reference");
  requireCanonicalSha(binding.authority_receipt_sha256, "Liveness authority receipt digest");
  requireCanonicalSha(binding.source_mapping_sha256, "Liveness source mapping digest");
  return binding;
}

function validateNestedAuthorityProvenance(actionResult, authorityBinding, gateEvidenceRefs) {
  const provenance = actionResult.result;
  requireGitObject(provenance.authority_commit, "Nested liveness authority commit");
  requireGitObject(provenance.authority_tree, "Nested liveness authority tree");
  requireReference(provenance.authority_receipt_ref, "Nested liveness authority receipt reference");
  requireCanonicalSha(provenance.authority_receipt_sha256, "Nested liveness authority receipt digest");
  assert(provenance.authority_commit === authorityBinding.authority_commit, "Nested liveness authority commit diverges from gate authority");
  assert(provenance.authority_tree === authorityBinding.authority_tree, "Nested liveness authority tree diverges from gate authority");
  assert(provenance.authority_receipt_ref === authorityBinding.authority_receipt_ref, "Nested liveness authority receipt reference diverges from gate authority");
  assert(provenance.authority_receipt_sha256 === authorityBinding.authority_receipt_sha256, "Nested liveness authority receipt digest diverges from gate authority");
  const boundEvidence = actionResult.evidence_refs.some((ref) => ref.reference === authorityBinding.authority_receipt_ref && ref.sha256 === authorityBinding.authority_receipt_sha256);
  assert(boundEvidence, "Nested liveness evidence does not carry the current authority receipt binding");
  assert(canonicalJson(actionResult.evidence_refs) === canonicalJson(gateEvidenceRefs), "Nested liveness evidence refs diverge from gate evidence refs");
}

function validateRosterBinding(binding) {
  exactKeys(binding, ROSTER_BINDING_KEYS, "Liveness roster binding");
  requireCanonicalSha(binding.roster_projection_sha256, "Liveness roster projection digest");
  requireCanonicalSha(binding.applicability_sha256, "Liveness applicability digest");
  assert(binding.invalidation_rule === LIVENESS_ROSTER_INVALIDATION_RULE, "Liveness roster invalidation rule is incomplete");
  assert(Array.isArray(binding.refresh_triggers), "Liveness roster refresh triggers are required");
  const ordered = [...binding.refresh_triggers].sort(compareUtf8);
  assert(JSON.stringify(binding.refresh_triggers) === JSON.stringify(ordered), "Liveness roster refresh triggers must be sorted");
  assert(new Set(binding.refresh_triggers).size === binding.refresh_triggers.length, "Liveness roster refresh triggers must be unique");
  assert(JSON.stringify(binding.refresh_triggers) === JSON.stringify(LIVENESS_ROSTER_REFRESH_TRIGGERS), "Liveness roster refresh triggers are incomplete");
  return binding;
}

function validateEvidenceRefs(refs) {
  assert(Array.isArray(refs) && refs.length > 0, "Liveness digest gate evidence refs are required");
  const ids = refs.map((ref, index) => {
    exactKeys(ref, ["evidence_id", "reference", "sha256"], `Liveness evidence ref ${index}`);
    requireIdentifier(ref.evidence_id, `Liveness evidence ref ${index} id`);
    requireReference(ref.reference, `Liveness evidence ref ${index} reference`);
    requireCanonicalSha(ref.sha256, `Liveness evidence ref ${index} digest`);
    return ref.evidence_id;
  });
  const ordered = [...ids].sort(compareUtf8);
  assert(new Set(ids).size === ids.length && JSON.stringify(ids) === JSON.stringify(ordered), "Liveness evidence refs must be sorted and unique");
  return refs;
}

function validateHostileRefs(refs) {
  assert(Array.isArray(refs) && refs.length > 0, "Liveness digest gate hostile fixtures are required");
  assert(refs.every((ref) => typeof ref === "string" && IDENTIFIER.test(ref)), "Liveness hostile fixture id is invalid");
  const ordered = [...refs].sort(compareUtf8);
  assert(new Set(refs).size === refs.length && JSON.stringify(refs) === JSON.stringify(ordered), "Liveness hostile fixtures must be sorted and unique");
  return refs;
}

function gateBody(gate) {
  const copy = structuredClone(gate);
  copy.gate_sha256 = null;
  return copy;
}

function assertExpectedBinding(actual, expected, label) {
  if (expected === null || expected === undefined) return;
  assert(canonicalJson(actual) === canonicalJson(expected), `${label} is stale; dependent roster must be rebuilt`);
}

export function validateLivenessDigestGate(gate, {expectedAuthorityBinding = null, expectedRosterBinding = null} = {}) {
  exactKeys(gate, GATE_KEYS, "Liveness digest gate");
  assert(gate.schema === LIVENESS_DIGEST_GATE_SCHEMA && gate.version === LIVENESS_DIGEST_GATE_VERSION, "Liveness digest gate identity is invalid");
  requireIdentifier(gate.gate_id, "Liveness gate id");
  requireIdentifier(gate.defect_id, "Liveness defect id");
  requireIdentifier(gate.action_id, "Liveness action id");
  assert(gate.status === LIVENESS_DIGEST_GATE_STATUS, "Liveness digest gate did not pass");

  validateActionResultContinuation(gate.action_result);
  assert(gate.action_result.action_id === gate.action_id, "Liveness action id diverges from action result");
  assert(gate.action_result.continuation.mode === "IMMEDIATE_SAME_TURN", "Liveness digest gate requires same-turn continuation");
  assert(gate.action_result.continuation.same_turn_dispatch === true, "Liveness digest gate requires same-turn dispatch");
  assert(gate.action_result.continuation.timer_deferral === false && gate.action_result.continuation.heartbeat_deferral === false, "Liveness digest gate rejects timer-only continuation");
  assert(gate.action_result.continuation.protected_event_id === null, "Liveness digest gate cannot authorize a protected event");
  requireCanonicalSha(gate.result_sha256, "Liveness result digest");
  requireCanonicalSha(gate.continuation_sha256, "Liveness continuation digest");
  requireCanonicalSha(gate.record_sha256, "Liveness record digest");
  assert(gate.result_sha256 === gate.action_result.result_sha256, "Liveness result digest does not bind the action result");
  assert(gate.continuation_sha256 === gate.action_result.continuation_sha256, "Liveness continuation digest does not bind the action result");
  assert(gate.record_sha256 === gate.action_result.record_sha256, "Liveness record digest does not bind the action result");

  validateTypedSuccessorReadback(gate.typed_successor);
  assert(gate.typed_successor.state !== "PROTECTED_WAIT", "Liveness digest gate cannot authorize a protected successor");
  assert(gate.typed_successor.parent_successor_sha256 === gate.record_sha256, "Liveness typed successor parent is not the action result record");
  assert(gate.typed_successor.parent_next_action === gate.action_result.next_action, "Liveness typed successor parent action is stale");
  assert(gate.typed_successor.next_action === gate.action_result.next_action, "Liveness successor action diverges from action result");
  assert(gate.typed_successor.next_handler === gate.action_result.next_handler, "Liveness successor handler diverges from action result");
  assert(canonicalJson(gate.readback) === canonicalJson(gate.typed_successor.readback), "Liveness semantic readback diverges from typed successor");
  requireCanonicalSha(gate.readback_sha256, "Liveness readback digest");
  assert(gate.readback_sha256 === gate.typed_successor.readback_sha256, "Liveness readback digest does not bind the typed successor");
  assert(gate.readback_sha256 === canonicalDigest(gate.readback), "Liveness readback digest mismatch");

  const authorityBinding = validateAuthorityBinding(gate.authority_binding);
  const rosterBinding = validateRosterBinding(gate.roster_binding);
  assertExpectedBinding(authorityBinding, expectedAuthorityBinding, "Liveness authority binding");
  assertExpectedBinding(rosterBinding, expectedRosterBinding, "Liveness roster binding");
  validateEvidenceRefs(gate.evidence_refs);
  validateNestedAuthorityProvenance(gate.action_result, authorityBinding, gate.evidence_refs);
  validateHostileRefs(gate.hostile_fixture_refs);
  requireCanonicalSha(gate.gate_sha256, "Liveness gate digest");
  assert(gate.gate_sha256 === canonicalDigest(gateBody(gate)), "Liveness gate digest mismatch");
  return gate;
}

export function compileLivenessDigestGate({
  gateId,
  defectId,
  actionResult,
  typedSuccessor,
  authorityBinding,
  rosterBinding,
  evidenceRefs,
  hostileFixtureRefs,
} = {}) {
  const gate = {
    schema: LIVENESS_DIGEST_GATE_SCHEMA,
    version: LIVENESS_DIGEST_GATE_VERSION,
    gate_id: gateId,
    defect_id: defectId,
    action_id: isRecord(actionResult) ? actionResult.action_id : null,
    action_result: structuredClone(actionResult),
    result_sha256: isRecord(actionResult) ? actionResult.result_sha256 : null,
    continuation_sha256: isRecord(actionResult) ? actionResult.continuation_sha256 : null,
    record_sha256: isRecord(actionResult) ? actionResult.record_sha256 : null,
    typed_successor: structuredClone(typedSuccessor),
    readback: isRecord(typedSuccessor) ? structuredClone(typedSuccessor.readback) : null,
    readback_sha256: isRecord(typedSuccessor) ? typedSuccessor.readback_sha256 : null,
    authority_binding: structuredClone(authorityBinding),
    roster_binding: structuredClone(rosterBinding),
    evidence_refs: structuredClone(evidenceRefs),
    hostile_fixture_refs: structuredClone(hostileFixtureRefs),
    status: LIVENESS_DIGEST_GATE_STATUS,
    gate_sha256: null,
  };
  gate.gate_sha256 = canonicalDigest(gateBody(gate));
  return validateLivenessDigestGate(gate);
}

export function evaluateLivenessBindingFreshness(gate, {authorityBinding = null, rosterBinding = null} = {}) {
  validateLivenessDigestGate(gate);
  if (authorityBinding !== null) {
    validateAuthorityBinding(authorityBinding);
    if (canonicalJson(gate.authority_binding) !== canonicalJson(authorityBinding)) {
      return {status: "STALE", invalidation_required: true, reason: "AUTHORITY_BINDING_CHANGED", next_action: "REBUILD_DEPENDENT_ROSTER"};
    }
  }
  if (rosterBinding !== null) {
    validateRosterBinding(rosterBinding);
    if (canonicalJson(gate.roster_binding) !== canonicalJson(rosterBinding)) {
      return {status: "STALE", invalidation_required: true, reason: "ROSTER_BINDING_CHANGED", next_action: "REBUILD_DEPENDENT_ROSTER"};
    }
  }
  return {status: "CURRENT", invalidation_required: false, reason: null, next_action: "CONTINUE_NEXT_ACTION"};
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("Liveness digest gate contract loaded\n");
