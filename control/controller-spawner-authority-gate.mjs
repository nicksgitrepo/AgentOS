#!/usr/bin/env node

/*
 * Project-agnostic custody boundary for the Controller/Spawner split.
 *
 * Controller may validate its own governance/handoff, start or wake the
 * Spawner, observe liveness, and route typed defects.  The Spawner alone may
 * update blocks/QA/rosters, admit or spawn agents, emit lane handoffs, or
 * archive/despawn them.  Every allowed Controller event remains typed,
 * readback-bound, and same-turn successor-bound (or an explicit true stop).
 */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";

export const CONTROLLER_SPAWNER_AUTHORITY_GATE_SCHEMA = "agentos.controller_spawner_authority_gate.v1";
export const CONTROLLER_SPAWNER_AUTHORITY_GATE_VERSION = 1;
export const CONTROLLER_SPAWNER_ALLOWED_ACTIONS = Object.freeze([
  "OBSERVE_LIVENESS",
  "ROUTE_TYPED_DEFECT",
  "START_AGENT_SPAWNER",
  "VALIDATE_GOVERNANCE_HANDOFF",
  "WAKE_AGENT_SPAWNER",
]);
export const CONTROLLER_SPAWNER_ACTION_ROUTES = Object.freeze({
  OBSERVE_LIVENESS: Object.freeze({target_role: "CONTROLLER_GOVERNANCE", next_handler: "HANDLER.CONTROLLER_AVAILABLE_TRANSITION"}),
  ROUTE_TYPED_DEFECT: Object.freeze({target_role: "AGENT_SPAWNER", next_handler: "HANDLER.AGENTOS.SPAWNER.DEFECT.COMPILER"}),
  START_AGENT_SPAWNER: Object.freeze({target_role: "AGENT_SPAWNER", next_handler: "HANDLER.SPAWNER_COMPILER"}),
  VALIDATE_GOVERNANCE_HANDOFF: Object.freeze({target_role: "CONTROLLER_GOVERNANCE", next_handler: "HANDLER.CONTROLLER_AVAILABLE_TRANSITION"}),
  WAKE_AGENT_SPAWNER: Object.freeze({target_role: "AGENT_SPAWNER", next_handler: "HANDLER.SPAWNER_COMPILER"}),
});
export const CONTROLLER_SPAWNER_FORBIDDEN_MUTATIONS = Object.freeze([
  "archive_ordinary_agent",
  "admit_ordinary_agent",
  "complete_qa",
  "construct_ordinary_agent",
  "despawn_ordinary_agent",
  "emit_lane_handoff",
  "mutate_roster",
  "spawn_agent_or_seed",
  "update_governance_blocks",
]);
export const CONTROLLER_SPAWNER_HOSTILE_FIXTURE_REFS = Object.freeze([
  "FIXTURE.CONTROLLER_SPAWNER.DIRECT_AGENT_CONSTRUCTION",
  "FIXTURE.CONTROLLER_SPAWNER.DIRECT_ARCHIVE",
  "FIXTURE.CONTROLLER_SPAWNER.DIRECT_ROSTER_MUTATION",
  "FIXTURE.CONTROLLER_SPAWNER.DIRECT_SPAWN",
  "FIXTURE.CONTROLLER_SPAWNER.MISSING_READBACK",
  "FIXTURE.CONTROLLER_SPAWNER.MISSING_SUCCESSOR",
]);

const SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const IDENTIFIER = /^[A-Z][A-Z0-9._:-]{0,191}$/u;
const REFERENCE = /^(?:opaque:|ref:)[^\s]+$/u;
const GATE_KEYS = Object.freeze([
  "schema", "version", "gate_id", "status", "authority_binding", "action", "custody",
  "spawner_sole_authority", "evidence_refs", "hostile_fixture_refs", "next_action", "next_handler",
  "same_turn_successor", "true_stop_gate", "gate_sha256",
]);
const AUTHORITY_KEYS = Object.freeze(["commit", "tree", "receipt_ref", "receipt_sha256"]);
const ACTION_KEYS = Object.freeze(["actor_role", "action_id", "target_role", "requested_mutations", "typed_readback"]);
const MUTATION_KEYS = [...CONTROLLER_SPAWNER_FORBIDDEN_MUTATIONS];
const READBACK_KEYS = Object.freeze(["readback_sha256", "same_turn_successor", "true_stop_gate"]);
const CUSTODY_KEYS = Object.freeze([
  "controller_approval_required", "product_mutation", "provider_access", "credential_access", "spend", "destructive_work", "protected_action",
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

function requireCommit(value, label) {
  assert(typeof value === "string" && COMMIT.test(value), `${label} must be a 40-character lowercase commit`);
  assert(value !== "0".repeat(40) && value !== "f".repeat(40), `${label} may not be a placeholder commit`);
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

function validateAuthority(authority) {
  exactKeys(authority, AUTHORITY_KEYS, "Controller Spawner authority");
  requireCommit(authority.commit, "Controller Spawner authority commit");
  requireCommit(authority.tree, "Controller Spawner authority tree");
  requireReference(authority.receipt_ref, "Controller Spawner authority reference");
  requireSha(authority.receipt_sha256, "Controller Spawner authority digest");
  return authority;
}

function validateMutations(mutations) {
  exactKeys(mutations, MUTATION_KEYS, "Controller Spawner requested mutations");
  for (const key of MUTATION_KEYS) assert(mutations[key] === false, `Controller cannot ${key.replaceAll("_", " ")}`);
  return mutations;
}

function validateAction(action) {
  exactKeys(action, ACTION_KEYS, "Controller Spawner action");
  assert(action.actor_role === "CONTROLLER", "Controller Spawner actor role is invalid");
  assert(CONTROLLER_SPAWNER_ALLOWED_ACTIONS.includes(action.action_id), "Controller action is outside the custody-only allowlist");
  const route = CONTROLLER_SPAWNER_ACTION_ROUTES[action.action_id];
  assert(route !== undefined, "Controller action has no custody route");
  assert(action.target_role === route.target_role, "Controller Spawner target role is stale");
  validateMutations(action.requested_mutations);
  exactKeys(action.typed_readback, READBACK_KEYS, "Controller Spawner typed readback");
  requireSha(action.typed_readback.readback_sha256, "Controller Spawner typed readback digest");
  assert(action.typed_readback.same_turn_successor === true || action.typed_readback.true_stop_gate === true, "Controller action requires a same-turn successor or true stop gate");
  assert(!(action.typed_readback.same_turn_successor === true && action.typed_readback.true_stop_gate === true), "Controller action cannot claim both successor and true stop");
  assert(action.typed_readback.readback_sha256 === digestWithout(action.typed_readback, "readback_sha256"), "Controller Spawner typed readback digest mismatch");
  return action;
}

function validateCustody(custody) {
  exactKeys(custody, CUSTODY_KEYS, "Controller Spawner custody");
  assert(custody.controller_approval_required === false, "Controller custody cannot become an approval gate");
  for (const key of ["product_mutation", "provider_access", "credential_access", "spend", "destructive_work", "protected_action"]) {
    assert(custody[key] === false, `Controller custody ${key} must remain closed`);
  }
  return custody;
}

function validateEvidenceRefs(refs) {
  assert(Array.isArray(refs) && refs.length > 0, "Controller Spawner evidence refs are required");
  const ids = refs.map((ref, index) => {
    exactKeys(ref, ["evidence_id", "reference", "sha256"], `Controller Spawner evidence ${index}`);
    requireIdentifier(ref.evidence_id, `Controller Spawner evidence ${index} id`);
    requireReference(ref.reference, `Controller Spawner evidence ${index} reference`);
    requireSha(ref.sha256, `Controller Spawner evidence ${index} digest`);
    return ref.evidence_id;
  });
  const ordered = [...ids].sort(compareUtf8);
  assert(new Set(ids).size === ids.length && JSON.stringify(ids) === JSON.stringify(ordered), "Controller Spawner evidence refs must be sorted and unique");
  return refs;
}

function validateHostileRefs(refs) {
  assert(Array.isArray(refs), "Controller Spawner hostile fixture refs are required");
  const ordered = [...refs].sort(compareUtf8);
  assert(JSON.stringify(refs) === JSON.stringify(ordered), "Controller Spawner hostile fixtures must be sorted");
  assert(new Set(refs).size === refs.length, "Controller Spawner hostile fixtures must be unique");
  assert(JSON.stringify(refs) === JSON.stringify(CONTROLLER_SPAWNER_HOSTILE_FIXTURE_REFS), "Controller Spawner hostile fixture coverage is incomplete");
  return refs;
}

export function validateControllerSpawnerAuthorityGate(gate, {expectedAuthorityBinding = null} = {}) {
  exactKeys(gate, GATE_KEYS, "Controller Spawner authority gate");
  assert(gate.schema === CONTROLLER_SPAWNER_AUTHORITY_GATE_SCHEMA && gate.version === CONTROLLER_SPAWNER_AUTHORITY_GATE_VERSION, "Controller Spawner authority gate identity is invalid");
  requireIdentifier(gate.gate_id, "Controller Spawner authority gate id");
  assert(gate.status === "ENFORCED", "Controller Spawner authority gate must remain enforced");
  validateAuthority(gate.authority_binding);
  if (expectedAuthorityBinding !== null) assert(canonicalDigest(gate.authority_binding) === canonicalDigest(expectedAuthorityBinding), "Controller Spawner authority binding is stale");
  validateAction(gate.action);
  validateCustody(gate.custody);
  assert(gate.spawner_sole_authority === true, "Spawner must remain the sole ordinary-agent and roster authority");
  validateEvidenceRefs(gate.evidence_refs);
  validateHostileRefs(gate.hostile_fixture_refs);
  assert(gate.next_action === gate.action.action_id, "Controller custody next action must name the validated custody event");
  requireIdentifier(gate.next_handler, "Controller custody next handler");
  assert(gate.next_handler === CONTROLLER_SPAWNER_ACTION_ROUTES[gate.action.action_id].next_handler, "Controller Spawner handler is stale");
  assert(gate.same_turn_successor === gate.action.typed_readback.same_turn_successor, "Controller custody successor proof drifted");
  assert(gate.true_stop_gate === gate.action.typed_readback.true_stop_gate, "Controller custody stop proof drifted");
  requireSha(gate.gate_sha256, "Controller Spawner authority gate digest");
  assert(gate.gate_sha256 === canonicalDigest({...gate, gate_sha256: null}), "Controller Spawner authority gate digest mismatch");
  return gate;
}

export function compileControllerSpawnerAuthorityGate({
  gateId,
  authorityBinding,
  actionId,
  targetRole,
  requestedMutations = Object.fromEntries(MUTATION_KEYS.map((key) => [key, false])),
  readbackSha256,
  sameTurnSuccessor = true,
  trueStopGate = false,
  evidenceRefs,
  nextHandler,
  custody = {
    controller_approval_required: false,
    product_mutation: false,
    provider_access: false,
    credential_access: false,
    spend: false,
    destructive_work: false,
    protected_action: false,
  },
} = {}) {
  requireIdentifier(gateId, "Controller Spawner authority gate id");
  assert(CONTROLLER_SPAWNER_ALLOWED_ACTIONS.includes(actionId), "Controller action is outside the custody-only allowlist");
  const gate = {
    schema: CONTROLLER_SPAWNER_AUTHORITY_GATE_SCHEMA,
    version: CONTROLLER_SPAWNER_AUTHORITY_GATE_VERSION,
    gate_id: gateId,
    status: "ENFORCED",
    authority_binding: structuredClone(authorityBinding),
    action: {
      actor_role: "CONTROLLER",
      action_id: actionId,
      target_role: targetRole,
      requested_mutations: structuredClone(requestedMutations),
      typed_readback: {readback_sha256: readbackSha256, same_turn_successor: sameTurnSuccessor, true_stop_gate: trueStopGate},
    },
    custody: structuredClone(custody),
    spawner_sole_authority: true,
    evidence_refs: structuredClone(evidenceRefs),
    hostile_fixture_refs: [...CONTROLLER_SPAWNER_HOSTILE_FIXTURE_REFS],
    next_action: actionId,
    next_handler: nextHandler,
    same_turn_successor: sameTurnSuccessor,
    true_stop_gate: trueStopGate,
    gate_sha256: null,
  };
  gate.gate_sha256 = canonicalDigest({...gate, gate_sha256: null});
  return validateControllerSpawnerAuthorityGate(gate);
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("Controller Spawner authority gate loaded\n");
