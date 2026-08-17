#!/usr/bin/env node

/*
 * Project-agnostic fail-closed gate for local candidate proof.
 *
 * A dispatched proof may still be blocked: execution is not proof, and a
 * missing-evidence inventory is not permission to claim PASS.  This gate
 * binds the observed result/readback/successor, records each unresolved
 * required step explicitly, and routes only to the registered same-turn
 * block-repair handler.
 */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";

export const LOCAL_PROOF_EVIDENCE_GATE_SCHEMA = "agentos.local_proof_evidence_gate.v1";
export const LOCAL_PROOF_EVIDENCE_GATE_VERSION = 1;
export const LOCAL_PROOF_EVIDENCE_BLOCKED_STATUS = "BLOCKED_MISSING_REQUIRED_EVIDENCE";
export const LOCAL_PROOF_EVIDENCE_REPAIR_ACTION = "REPAIR_BLOCKS";
export const LOCAL_PROOF_EVIDENCE_REPAIR_HANDLER = "HANDLER.ORCHESTRATOR_BLOCK_REPAIR";

const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40,64}$/u;
const IDENTIFIER = /^[A-Z][A-Z0-9._:-]{0,191}$/u;
const REFERENCE = /^(?:opaque:|ref:)[^\s]+$/u;
const GATE_KEYS = Object.freeze([
  "schema", "version", "gate_id", "defect_id", "authority_binding", "proof_result", "required_steps", "missing_evidence",
  "decision", "successor", "custody", "evidence_refs", "hostile_fixture_refs", "status", "gate_sha256",
]);
const AUTHORITY_KEYS = Object.freeze([
  "authority_commit", "authority_tree", "authority_receipt_ref", "authority_receipt_sha256", "source_mapping_sha256",
]);
const PROOF_RESULT_KEYS = Object.freeze([
  "result_ref", "result_sha256", "readback_ref", "readback_sha256", "successor_ref", "successor_sha256",
  "observed_status", "proof_claimed", "all_mandatory_steps_satisfied", "unresolved_required_steps", "evidence_ceiling",
  "source_action", "source_handler", "handler_invoked", "direct_consumer", "controller_approval_required", "protected_event_id",
]);
const MISSING_EVIDENCE_KEYS = Object.freeze(["required_step", "status", "evidence_ref", "evidence_sha256", "reason"]);
const DECISION_KEYS = Object.freeze([
  "status", "proof_claimed", "all_mandatory_steps_satisfied", "next_action", "next_handler", "direct_consumer",
  "controller_approval_required", "same_turn_dispatch", "protected_event_id",
]);
const SUCCESSOR_KEYS = Object.freeze([
  "schema", "version", "successor_id", "next_action", "next_handler", "direct_consumer", "controller_approval_required",
  "lane_execution", "same_turn_dispatch", "protected_event_id", "persistence", "successor_sha256",
]);
const PERSISTENCE_KEYS = Object.freeze(["receipt_ref", "receipt_sha256", "atomic", "same_turn", "write_scope"]);
const CUSTODY_KEYS = Object.freeze([
  "control_plane_only", "source_roots_preserved", "consumer_product_mutated", "provider_access", "credential_access",
  "external_sync", "spend", "destructive_work", "deployment", "publication", "merge", "protected_event_id", "timers", "polling",
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

function requireGitObject(value, label) {
  assert(typeof value === "string" && GIT_OBJECT.test(value), `${label} must be a Git object id`);
  assert(!/^0+$/u.test(value) && !/^f+$/u.test(value), `${label} may not be a placeholder object id`);
}

function requireIdentifier(value, label) {
  assert(typeof value === "string" && IDENTIFIER.test(value), `${label} must be a stable identifier`);
}

function requireReference(value, label) {
  assert(typeof value === "string" && REFERENCE.test(value), `${label} must be an opaque/reference URI`);
}

function requireText(value, label, minimumLength = 8) {
  assert(typeof value === "string" && value.trim().length >= minimumLength && !/[\u0000-\u001f\u007f]/u.test(value), `${label} is incomplete`);
}

function validateAuthorityBinding(binding) {
  exactKeys(binding, AUTHORITY_KEYS, "Local proof evidence authority binding");
  requireGitObject(binding.authority_commit, "Local proof authority commit");
  requireGitObject(binding.authority_tree, "Local proof authority tree");
  requireReference(binding.authority_receipt_ref, "Local proof authority receipt reference");
  requireSha(binding.authority_receipt_sha256, "Local proof authority receipt digest");
  requireSha(binding.source_mapping_sha256, "Local proof source mapping digest");
  return binding;
}

function validateProofResult(result) {
  exactKeys(result, PROOF_RESULT_KEYS, "Local proof result binding");
  for (const [key, label] of [["result_ref", "Local proof result reference"], ["readback_ref", "Local proof readback reference"], ["successor_ref", "Local proof successor reference"]]) requireReference(result[key], label);
  for (const [key, label] of [["result_sha256", "Local proof result digest"], ["readback_sha256", "Local proof readback digest"], ["successor_sha256", "Local proof successor digest"]]) requireSha(result[key], label);
  assert(result.observed_status === "LOCAL_PROOF_REQUIRED_EVIDENCE_BLOCKED", "Local proof result status is not fail-closed");
  assert(result.proof_claimed === false, "Blocked local proof cannot claim proof");
  assert(result.all_mandatory_steps_satisfied === false, "Blocked local proof cannot claim all mandatory steps");
  assert(Array.isArray(result.unresolved_required_steps) && result.unresolved_required_steps.length > 0, "Local proof unresolved step inventory is required");
  const steps = [...result.unresolved_required_steps].sort(compareUtf8);
  assert(JSON.stringify(result.unresolved_required_steps) === JSON.stringify(steps), "Local proof unresolved steps must be sorted");
  assert(new Set(steps).size === steps.length && steps.every((step) => typeof step === "string" && IDENTIFIER.test(step)), "Local proof unresolved step inventory is invalid");
  requireText(result.evidence_ceiling, "Local proof evidence ceiling", 24);
  requireIdentifier(result.source_action, "Local proof source action");
  requireIdentifier(result.source_handler, "Local proof source handler");
  assert(result.handler_invoked === true, "Local proof handler invocation is not observed");
  assert(result.direct_consumer === "INDEPENDENT_PLATFORM_REVIEW", "Local proof direct consumer is not independent review");
  assert(result.controller_approval_required === false, "Local proof cannot require Controller approval");
  assert(result.protected_event_id === null, "Local proof evidence gate cannot bypass a protected event");
  return result;
}

function validateMissingEvidence(entries, requiredSteps) {
  assert(Array.isArray(entries) && entries.length > 0, "Local proof missing-evidence inventory is required");
  const actualSteps = entries.map((entry, index) => {
    exactKeys(entry, MISSING_EVIDENCE_KEYS, `Local proof missing evidence ${index}`);
    requireIdentifier(entry.required_step, `Local proof missing evidence ${index} step`);
    assert(entry.status === "MISSING", `Local proof missing evidence ${index} must remain MISSING`);
    assert(entry.evidence_ref === null && entry.evidence_sha256 === null, `Local proof missing evidence ${index} cannot carry false evidence`);
    requireText(entry.reason, `Local proof missing evidence ${index} reason`, 16);
    return entry.required_step;
  });
  const sortedActual = [...actualSteps].sort(compareUtf8);
  const sortedRequired = [...requiredSteps].sort(compareUtf8);
  assert(JSON.stringify(actualSteps) === JSON.stringify(sortedActual), "Local proof missing evidence must be sorted");
  assert(new Set(actualSteps).size === actualSteps.length, "Local proof missing evidence must be unique");
  assert(JSON.stringify(actualSteps) === JSON.stringify(sortedRequired), "Local proof missing evidence does not match unresolved required steps");
  return entries;
}

function validateDecision(decision) {
  exactKeys(decision, DECISION_KEYS, "Local proof evidence decision");
  assert(decision.status === LOCAL_PROOF_EVIDENCE_BLOCKED_STATUS, "Local proof evidence decision must remain blocked");
  assert(decision.proof_claimed === false && decision.all_mandatory_steps_satisfied === false, "Local proof decision contains a false PASS claim");
  assert(decision.next_action === LOCAL_PROOF_EVIDENCE_REPAIR_ACTION, "Local proof evidence route must repair blocks");
  assert(decision.next_handler === LOCAL_PROOF_EVIDENCE_REPAIR_HANDLER, "Local proof evidence route handler is invalid");
  assert(decision.direct_consumer === "INDEPENDENT_PLATFORM_REVIEW", "Local proof decision direct consumer is invalid");
  assert(decision.controller_approval_required === false, "Local proof decision cannot require Controller approval");
  assert(decision.same_turn_dispatch === true, "Local proof evidence repair must be same-turn");
  assert(decision.protected_event_id === null, "Local proof evidence repair cannot bypass a protected event");
  return decision;
}

function validatePersistence(persistence) {
  exactKeys(persistence, PERSISTENCE_KEYS, "Local proof evidence successor persistence");
  requireReference(persistence.receipt_ref, "Local proof evidence successor receipt reference");
  requireSha(persistence.receipt_sha256, "Local proof evidence successor receipt digest");
  assert(persistence.atomic === true && persistence.same_turn === true, "Local proof evidence successor must be atomic and same-turn");
  assert(persistence.write_scope === "CONTROL_PLANE_ONLY", "Local proof evidence successor crossed its write scope");
  return persistence;
}

function validateSuccessor(successor) {
  exactKeys(successor, SUCCESSOR_KEYS, "Local proof evidence successor");
  assert(successor.schema === "agentos.local_proof_evidence_successor.v1" && successor.version === 1, "Local proof evidence successor identity is invalid");
  requireIdentifier(successor.successor_id, "Local proof evidence successor id");
  assert(successor.next_action === LOCAL_PROOF_EVIDENCE_REPAIR_ACTION, "Local proof evidence successor action is invalid");
  assert(successor.next_handler === LOCAL_PROOF_EVIDENCE_REPAIR_HANDLER, "Local proof evidence successor handler is invalid");
  assert(successor.direct_consumer === "INDEPENDENT_PLATFORM_REVIEW", "Local proof evidence successor direct consumer is invalid");
  assert(successor.controller_approval_required === false, "Local proof evidence successor cannot require Controller approval");
  assert(successor.lane_execution === "AUTONOMOUS_TYPED_HANDOFF", "Local proof evidence successor lane is invalid");
  assert(successor.same_turn_dispatch === true && successor.protected_event_id === null, "Local proof evidence successor boundary is invalid");
  validatePersistence(successor.persistence);
  requireSha(successor.successor_sha256, "Local proof evidence successor digest");
  assert(successor.successor_sha256 === canonicalDigest({...successor, successor_sha256: null}), "Local proof evidence successor digest mismatch");
  return successor;
}

function validateCustody(custody) {
  exactKeys(custody, CUSTODY_KEYS, "Local proof evidence custody");
  assert(custody.control_plane_only === true && custody.source_roots_preserved === true, "Local proof evidence custody is not isolated");
  for (const field of ["consumer_product_mutated", "provider_access", "credential_access", "external_sync", "spend", "destructive_work", "deployment", "publication", "merge"]) assert(custody[field] === false, `Local proof evidence custody crossed boundary: ${field}`);
  assert(custody.protected_event_id === null && custody.timers === 0 && custody.polling === false, "Local proof evidence custody opened a protected or timer route");
  return custody;
}

function validateEvidenceRefs(refs) {
  assert(Array.isArray(refs) && refs.length > 0, "Local proof evidence refs are required");
  const ids = refs.map((ref, index) => {
    exactKeys(ref, ["evidence_id", "reference", "sha256"], `Local proof evidence ref ${index}`);
    requireIdentifier(ref.evidence_id, `Local proof evidence ref ${index} id`);
    requireReference(ref.reference, `Local proof evidence ref ${index} reference`);
    requireSha(ref.sha256, `Local proof evidence ref ${index} digest`);
    return ref.evidence_id;
  });
  const ordered = [...ids].sort(compareUtf8);
  assert(new Set(ids).size === ids.length && JSON.stringify(ids) === JSON.stringify(ordered), "Local proof evidence refs must be sorted and unique");
  return refs;
}

function validateHostileRefs(refs) {
  assert(Array.isArray(refs) && refs.length > 0, "Local proof evidence hostile fixtures are required");
  assert(refs.every((ref) => typeof ref === "string" && IDENTIFIER.test(ref)), "Local proof evidence hostile fixture is invalid");
  const ordered = [...refs].sort(compareUtf8);
  assert(new Set(refs).size === refs.length && JSON.stringify(refs) === JSON.stringify(ordered), "Local proof evidence hostile fixtures must be sorted and unique");
  return refs;
}

export function validateLocalProofEvidenceGate(gate, {expectedAuthorityBinding = null} = {}) {
  exactKeys(gate, GATE_KEYS, "Local proof evidence gate");
  assert(gate.schema === LOCAL_PROOF_EVIDENCE_GATE_SCHEMA && gate.version === LOCAL_PROOF_EVIDENCE_GATE_VERSION, "Local proof evidence gate identity is invalid");
  requireIdentifier(gate.gate_id, "Local proof evidence gate id");
  requireIdentifier(gate.defect_id, "Local proof evidence defect id");
  const authority = validateAuthorityBinding(gate.authority_binding);
  if (expectedAuthorityBinding !== null) assert(canonicalDigest(authority) === canonicalDigest(expectedAuthorityBinding), "Local proof evidence authority binding is stale");
  const proof = validateProofResult(gate.proof_result);
  const requiredSteps = gate.required_steps;
  assert(Array.isArray(requiredSteps) && requiredSteps.length > 0, "Local proof required step inventory is required");
  const sortedRequired = [...requiredSteps].sort(compareUtf8);
  assert(JSON.stringify(requiredSteps) === JSON.stringify(sortedRequired), "Local proof required steps must be sorted");
  assert(new Set(requiredSteps).size === requiredSteps.length && requiredSteps.every((step) => typeof step === "string" && IDENTIFIER.test(step)), "Local proof required steps are invalid");
  validateMissingEvidence(gate.missing_evidence, requiredSteps);
  validateDecision(gate.decision);
  validateSuccessor(gate.successor);
  validateCustody(gate.custody);
  validateEvidenceRefs(gate.evidence_refs);
  validateHostileRefs(gate.hostile_fixture_refs);
  assert(gate.status === LOCAL_PROOF_EVIDENCE_BLOCKED_STATUS, "Local proof evidence gate cannot report PASS");
  assert(gate.proof_result.proof_claimed === false && gate.decision.proof_claimed === false, "Local proof evidence gate contains a false PASS claim");
  requireSha(gate.gate_sha256, "Local proof evidence gate digest");
  assert(gate.gate_sha256 === canonicalDigest({...gate, gate_sha256: null}), "Local proof evidence gate digest mismatch");
  return gate;
}

export function compileLocalProofEvidenceGate({
  gateId,
  defectId,
  authorityBinding,
  proofResult,
  requiredSteps,
  evidenceRefs,
  hostileFixtureRefs,
  persistence,
} = {}) {
  const proof = structuredClone(proofResult);
  const steps = [...requiredSteps].sort(compareUtf8);
  const missingEvidence = steps.map((requiredStep) => ({
    required_step: requiredStep,
    status: "MISSING",
    evidence_ref: null,
    evidence_sha256: null,
    reason: "Required proof evidence was not observed within the bounded local proof route.",
  }));
  const successor = {
    schema: "agentos.local_proof_evidence_successor.v1",
    version: 1,
    successor_id: `SUCCESSOR.LOCAL.PROOF.EVIDENCE.REPAIR.${String(gateId).replace(/[^A-Z0-9]+/gu, ".")}`,
    next_action: LOCAL_PROOF_EVIDENCE_REPAIR_ACTION,
    next_handler: LOCAL_PROOF_EVIDENCE_REPAIR_HANDLER,
    direct_consumer: "INDEPENDENT_PLATFORM_REVIEW",
    controller_approval_required: false,
    lane_execution: "AUTONOMOUS_TYPED_HANDOFF",
    same_turn_dispatch: true,
    protected_event_id: null,
    persistence: structuredClone(persistence),
    successor_sha256: null,
  };
  successor.successor_sha256 = canonicalDigest({...successor, successor_sha256: null});
  const decision = {
    status: LOCAL_PROOF_EVIDENCE_BLOCKED_STATUS,
    proof_claimed: false,
    all_mandatory_steps_satisfied: false,
    next_action: LOCAL_PROOF_EVIDENCE_REPAIR_ACTION,
    next_handler: LOCAL_PROOF_EVIDENCE_REPAIR_HANDLER,
    direct_consumer: "INDEPENDENT_PLATFORM_REVIEW",
    controller_approval_required: false,
    same_turn_dispatch: true,
    protected_event_id: null,
  };
  const gate = {
    schema: LOCAL_PROOF_EVIDENCE_GATE_SCHEMA,
    version: LOCAL_PROOF_EVIDENCE_GATE_VERSION,
    gate_id: gateId,
    defect_id: defectId,
    authority_binding: structuredClone(authorityBinding),
    proof_result: proof,
    required_steps: steps,
    missing_evidence: missingEvidence,
    decision,
    successor,
    custody: {
      control_plane_only: true,
      source_roots_preserved: true,
      consumer_product_mutated: false,
      provider_access: false,
      credential_access: false,
      external_sync: false,
      spend: false,
      destructive_work: false,
      deployment: false,
      publication: false,
      merge: false,
      protected_event_id: null,
      timers: 0,
      polling: false,
    },
    evidence_refs: structuredClone(evidenceRefs),
    hostile_fixture_refs: structuredClone(hostileFixtureRefs),
    status: LOCAL_PROOF_EVIDENCE_BLOCKED_STATUS,
    gate_sha256: null,
  };
  gate.gate_sha256 = canonicalDigest({...gate, gate_sha256: null});
  return validateLocalProofEvidenceGate(gate, {expectedAuthorityBinding: authorityBinding});
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("Local proof evidence gate contract loaded\n");
