#!/usr/bin/env node

/* Spawner-exclusive, receipt-driven agent lifecycle and safe despawn. */

import {canonicalDigest} from "./content-addressing.mjs";
import {assertOperationalGlobalGovernanceContext} from "./global-governance-operational-context.mjs";
import {resolveCanonicalPermanentRole} from "./permanent-role-registry.mjs";
import {openSpawnerLifecycleStore, readSpawnerLifecycleStore, consumeSpawnerLifecycleReceipt, commitGovernedSpawnerLifecycleTransition} from "./spawner-lifecycle-store.mjs";

export const AGENT_LIFECYCLE_CUSTODY_SCHEMA = "agentos.agent_lifecycle_custody.v2";
export const SPAWN_AUTHORITIES = Object.freeze(["SPAWNER"]);
export const TEMPORARY_ROLE_KINDS = Object.freeze(["BUILDER", "AUDITOR", "VALIDATOR", "HOSTILE_CRITIC", "ESCALATION_BUILDER"]);
export const LIFECYCLE_TRANSITION_KINDS = Object.freeze(["HANDOFF_ACCEPTED", "SCOPE_CLOSED", "EVIDENCE_PRESERVED", "WORKTREE_RELEASED", "CUSTODY_RELEASED"]);

const ID = /^[A-Z][A-Z0-9._:-]{0,191}$/u;
const REF = /^ref:[a-z-]+\/[0-9a-f]{64}$/u;
const lifecycleAuthorities = new WeakMap();
const RECEIPT_KIND = Object.freeze({HANDOFF_ACCEPTED: "HANDOFF_ACCEPTANCE", SCOPE_CLOSED: "SCOPE_CLOSEOUT", EVIDENCE_PRESERVED: "EVIDENCE_PRESERVATION", WORKTREE_RELEASED: "WORKTREE_RELEASE", CUSTODY_RELEASED: "CUSTODY_RELEASE"});

function fail(message, code = "AGENT_LIFECYCLE_CUSTODY_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(condition, message, code) { if (!condition) fail(message, code); }
function id(value, label) { assert(typeof value === "string" && ID.test(value), `${label} is invalid`); }
function reference(value, label) { assert(typeof value === "string" && REF.test(value), `${label} is invalid`); }
function exactOptions(value, keys, label) { assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`); assert(Object.keys(value).every((key) => keys.includes(key)), `${label} rejects caller roots, paths, role objects, evidence arrays, booleans, PASS claims, clocks, and adapters`); }
function receiptBody(value) { return {...structuredClone(value), receipt_sha256: null}; }

export function prepareSpawnerLifecycleAuthority(options = {}) {
  exactOptions(options, ["spawnerContext", "globalGovernanceAuthorityStore", "projectLifecycleCustody", "spawnerAdmissionReceiptRef", "spawnerLifecycleReceiptRef", "spawnerAdmissionRequestId", "spawnerAgentId"], "Spawner lifecycle preparation");
  const {spawnerContext, globalGovernanceAuthorityStore, projectLifecycleCustody, spawnerAdmissionReceiptRef, spawnerLifecycleReceiptRef, spawnerAdmissionRequestId, spawnerAgentId} = options;
  assertOperationalGlobalGovernanceContext(spawnerContext, {authorityStore: globalGovernanceAuthorityStore, expectedRoleClass: "SPAWNER"});
  assert(spawnerContext.compact_selection?.model_id && spawnerContext.compact_selection?.reasoning_effort, "Spawner lifecycle authority requires a current model route");
  reference(spawnerAdmissionReceiptRef, "Spawner admission receipt"); reference(spawnerLifecycleReceiptRef, "Spawner lifecycle admission receipt"); id(spawnerAdmissionRequestId, "Spawner admission request"); id(spawnerAgentId, "Spawner agent");
  const lifecycleStore = openSpawnerLifecycleStore({spawnerContext, globalGovernanceAuthorityStore, projectLifecycleCustody});
  consumeSpawnerLifecycleReceipt(lifecycleStore, {receiptRef: spawnerLifecycleReceiptRef, expectedKind: "SPAWNER_ADMISSION", requestId: spawnerAdmissionRequestId, agentId: spawnerAgentId, roleId: "AGENTOS.SPAWNER", admissionReceiptRef: spawnerAdmissionReceiptRef});
  const authority = Object.freeze(Object.create(null));
  lifecycleAuthorities.set(authority, Object.freeze({spawnerContext, globalGovernanceAuthorityStore, lifecycleStore, spawnerAdmissionReceiptRef, spawnerAgentId})); return authority;
}

function authorityState(authority) {
  const state = lifecycleAuthorities.get(authority); assert(state, "Spawner lifecycle authority must be an opaque current capability", "SPAWNER_LIFECYCLE_AUTHORITY_REQUIRED");
  assertOperationalGlobalGovernanceContext(state.spawnerContext, {authorityStore: state.globalGovernanceAuthorityStore, expectedRoleClass: "SPAWNER"}); readSpawnerLifecycleStore(state.lifecycleStore); return state;
}
function appendFromReceipt(state, {eventKind, requestId, agentId, roleId, admissionReceiptRef, transitionReceiptRef}) {
  const ledger = readSpawnerLifecycleStore(state.lifecycleStore);
  return commitGovernedSpawnerLifecycleTransition(state.lifecycleStore, {expectedHeadSha256: ledger.head_sha256, eventKind, receiptRef: transitionReceiptRef, requestId, agentId, roleId, admissionReceiptRef});
}

export function authorizeAgentSpawn(options = {}) {
  exactOptions(options, ["authority", "requestId", "requestedRoleId", "admissionReceiptRef", "transitionReceiptRef", "agentId"], "Spawn request");
  const {authority, requestId, requestedRoleId, admissionReceiptRef, transitionReceiptRef, agentId} = options, state = authorityState(authority);
  id(requestId, "Spawn request"); id(agentId, "Spawn agent"); reference(admissionReceiptRef, "Role admission receipt"); reference(transitionReceiptRef, "Spawn transition receipt");
  const role = resolveCanonicalPermanentRole(requestedRoleId);
  const appended = appendFromReceipt(state, {eventKind: "SPAWN_AUTHORIZED", requestId, agentId, roleId: role.role_id, admissionReceiptRef, transitionReceiptRef});
  const receipt = {schema: "agentos.agent_spawn_authorization.v2", version: 2, issuer_role: "AGENTOS.SPAWNER", requested_role: role.role_id, authority: "SPAWNER", request_id: requestId, agent_id: agentId, admission_receipt_ref: admissionReceiptRef, transition_receipt_ref: transitionReceiptRef, lifecycle_event_sha256: appended.event.event_sha256, project_identity_sha256: readSpawnerLifecycleStore(state.lifecycleStore).project_identity_sha256, model_snapshot_sha256: state.spawnerContext.snapshot_sha256, model_selection_sha256: canonicalDigest(state.spawnerContext.compact_selection), receipt_sha256: null};
  receipt.receipt_sha256 = canonicalDigest(receiptBody(receipt)); return Object.freeze(receipt);
}

export function recordAgentLifecycleTransition(options = {}) {
  exactOptions(options, ["authority", "eventKind", "requestId", "agentId", "transitionReceiptRef"], "Lifecycle transition");
  const {authority, eventKind, requestId, agentId, transitionReceiptRef} = options, state = authorityState(authority); assert(LIFECYCLE_TRANSITION_KINDS.includes(eventKind), "Lifecycle transition kind is not a governed intermediate transition"); id(requestId, "Lifecycle transition request"); id(agentId, "Lifecycle transition agent"); reference(transitionReceiptRef, "Lifecycle transition receipt");
  const events = readSpawnerLifecycleStore(state.lifecycleStore).events.filter((event) => event.agent_id === agentId), spawn = events.find((event) => event.event_kind === "SPAWN_AUTHORIZED"); assert(spawn, "Agent has no canonical spawn record");
  return appendFromReceipt(state, {eventKind, requestId, agentId, roleId: spawn.role_id, admissionReceiptRef: spawn.admission_receipt_ref, transitionReceiptRef});
}

export function authorizeAgentDespawn(options = {}) {
  exactOptions(options, ["authority", "requestId", "agentId", "transitionReceiptRef"], "Despawn request");
  const {authority, requestId, agentId, transitionReceiptRef} = options, state = authorityState(authority); id(requestId, "Despawn request"); id(agentId, "Despawn agent"); reference(transitionReceiptRef, "Despawn transition receipt");
  const events = readSpawnerLifecycleStore(state.lifecycleStore).events.filter((event) => event.agent_id === agentId), spawn = events.find((event) => event.event_kind === "SPAWN_AUTHORIZED"); assert(spawn, "Agent has no canonical spawn record");
  const required = ["HANDOFF_ACCEPTED", "SCOPE_CLOSED", "EVIDENCE_PRESERVED", "WORKTREE_RELEASED", "CUSTODY_RELEASED"], missing = required.filter((kind) => !events.some((event) => event.event_kind === kind)); assert(missing.length === 0, `Agent despawn evidence is incomplete: ${missing.join(",")}`); assert(!events.some((event) => event.event_kind === "DESPAWN_AUTHORIZED"), "Agent is already despawned");
  const appended = appendFromReceipt(state, {eventKind: "DESPAWN_AUTHORIZED", requestId, agentId, roleId: spawn.role_id, admissionReceiptRef: spawn.admission_receipt_ref, transitionReceiptRef});
  const receipt = {schema: "agentos.agent_despawn_authorization.v2", version: 2, issuer_role: "AGENTOS.SPAWNER", request_id: requestId, agent_id: agentId, role_id: spawn.role_id, transition_receipt_ref: transitionReceiptRef, lifecycle_event_sha256: appended.event.event_sha256, project_identity_sha256: readSpawnerLifecycleStore(state.lifecycleStore).project_identity_sha256, recoverability: "HANDOFF_EVIDENCE_AND_ZERO_REFERENCES_PROVEN", receipt_sha256: null}; receipt.receipt_sha256 = canonicalDigest(receiptBody(receipt)); return Object.freeze(receipt);
}

export function requiredAuditorCloseout(options = {}) {
  exactOptions(options, ["authority", "agentId"], "Auditor closeout request"); const {authority, agentId} = options, state = authorityState(authority); id(agentId, "Auditor agent");
  const events = readSpawnerLifecycleStore(state.lifecycleStore).events.filter((event) => event.agent_id === agentId), spawn = events.find((event) => event.event_kind === "SPAWN_AUTHORIZED"); assert(spawn, "Auditor closeout requires a canonical spawn record");
  return events.some((event) => event.event_kind === "HANDOFF_ACCEPTED") ? "SPAWNER_DESPAWN_REQUIRES_REMAINING_TYPED_RECEIPTS" : "PRESERVE_READ_ONLY_AUDITOR_UNTIL_HANDOFF";
}
