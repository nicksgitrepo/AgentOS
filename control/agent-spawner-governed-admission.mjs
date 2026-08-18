#!/usr/bin/env node

/*
 * Same-turn compiler -> governed-admission adapter contract.
 *
 * A compiler-only Spawner may not grant itself worker authority, but a
 * complete local roster must not become a prose-only handoff.  This contract
 * makes the bounded adapter invocation explicit and digest-bound: it proves
 * that the compiler successor was consumed, independent clearance was
 * verified, no protected capability opened, and the next governed action
 * was started in the same turn.  It does not start workers or activate a
 * wave; that remains the next registered lifecycle action.
 */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {
  admitAgentSpawnerIndependentClearance,
  validateAgentSpawnerCompilerContinuation,
  validateAgentSpawnerLifecycle,
} from "./agent-spawner-lifecycle.mjs";

export const AGENT_SPAWNER_GOVERNED_ADMISSION_SCHEMA = "agentos.agent_spawner_governed_admission.v1";
export const AGENT_SPAWNER_GOVERNED_ADMISSION_VERSION = 1;
export const AGENT_SPAWNER_GOVERNED_ADMISSION_STATUS = "ADAPTER_STARTED";
export const AGENT_SPAWNER_GOVERNED_ADMISSION_NEXT_ACTION = "START_GOVERNED_SPAWN";
export const AGENT_SPAWNER_GOVERNED_ADMISSION_NEXT_HANDLER = "HANDLER.GOVERNED_SPAWN_ADAPTER";

const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Z][A-Z0-9._:-]{0,191}$/u;
const REFERENCE = /^(?:opaque:|ref:)[^\s]+$/u;
const KEYS = Object.freeze([
  "schema", "version", "adapter_id", "source_continuation_sha256", "source_lifecycle_sha256",
  "lifecycle_after_sha256", "status", "next_action", "next_handler", "same_turn_dispatch",
  "authority", "admission", "evidence_refs", "hostile_fixture_refs", "readback_sha256",
]);
const AUTHORITY_KEYS = Object.freeze([
  "compiler_only", "admission", "activation", "product_mutation", "provider_access", "credential_access",
]);
const ADMISSION_KEYS = Object.freeze(["spawnable", "worker_spawned", "wave_activation", "isolated_local_custody"]);

function assert(condition, message) { if (!condition) throw new Error(message); }
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function exactKeys(value, expected, label) {
  assert(isRecord(value), `${label} must be an object`);
  const actual = Object.keys(value).sort(compareUtf8);
  const required = [...expected].sort(compareUtf8);
  assert(JSON.stringify(actual) === JSON.stringify(required), `${label} fields mismatch`);
}
function requireSha(value, label) { assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`); }
function requireIdentifier(value, label) { assert(typeof value === "string" && IDENTIFIER.test(value), `${label} must be a stable identifier`); }
function requireReference(value, label) { assert(typeof value === "string" && REFERENCE.test(value), `${label} must be an opaque or reference URI`); }
function sortedUniqueIdentifiers(values, label) {
  assert(Array.isArray(values) && values.length > 0, `${label} are required`);
  values.forEach((value, index) => requireIdentifier(value, `${label} item ${index}`));
  const ordered = [...values].sort(compareUtf8);
  assert(new Set(ordered).size === ordered.length && JSON.stringify(values) === JSON.stringify(ordered), `${label} must be sorted and unique`);
}
function validateEvidenceRefs(values) {
  assert(Array.isArray(values) && values.length > 0, "Governed-admission evidence refs are required");
  const ids = [];
  values.forEach((entry, index) => {
    exactKeys(entry, ["evidence_id", "reference", "sha256"], `Governed-admission evidence ${index}`);
    requireIdentifier(entry.evidence_id, `Governed-admission evidence ${index} ID`);
    requireReference(entry.reference, `Governed-admission evidence ${index} reference`);
    requireSha(entry.sha256, `Governed-admission evidence ${index} digest`);
    ids.push(entry.evidence_id);
  });
  const ordered = [...ids].sort(compareUtf8);
  assert(new Set(ids).size === ids.length && JSON.stringify(ids) === JSON.stringify(ordered), "Governed-admission evidence refs must be sorted and unique");
}
function body(value) { const copy = structuredClone(value); copy.readback_sha256 = null; return copy; }

function validateAuthority(authority) {
  exactKeys(authority, AUTHORITY_KEYS, "Governed-admission authority");
  assert(authority.compiler_only === false, "Governed-admission adapter cannot remain compiler-only");
  assert(authority.admission === true && authority.activation === false, "Governed-admission adapter crossed the activation boundary");
  assert(authority.product_mutation === false && authority.provider_access === false && authority.credential_access === false, "Governed-admission adapter crossed a protected capability");
}

function validateAdmission(admission) {
  exactKeys(admission, ADMISSION_KEYS, "Governed-admission state");
  assert(admission.spawnable === true, "Governed-admission adapter must expose the next spawn action");
  assert(admission.worker_spawned === false, "Governed-admission adapter cannot spawn a worker");
  assert(admission.wave_activation === "OFF", "Governed-admission adapter cannot activate a wave");
  assert(admission.isolated_local_custody === false, "Governed admission cannot substitute isolated custody for independent clearance");
}

export function validateAgentSpawnerGovernedAdmission(readback, {sourceContinuation = null, lifecycleBefore = null, lifecycleAfter = null} = {}) {
  exactKeys(readback, KEYS, "Agent Spawner governed-admission readback");
  assert(readback.schema === AGENT_SPAWNER_GOVERNED_ADMISSION_SCHEMA && readback.version === AGENT_SPAWNER_GOVERNED_ADMISSION_VERSION, "Governed-admission identity is invalid");
  requireIdentifier(readback.adapter_id, "Governed-admission adapter id");
  requireSha(readback.source_continuation_sha256, "Governed-admission source continuation");
  requireSha(readback.source_lifecycle_sha256, "Governed-admission source lifecycle");
  requireSha(readback.lifecycle_after_sha256, "Governed-admission lifecycle after");
  assert(readback.status === AGENT_SPAWNER_GOVERNED_ADMISSION_STATUS, "Governed-admission status is invalid");
  assert(readback.next_action === AGENT_SPAWNER_GOVERNED_ADMISSION_NEXT_ACTION, "Governed-admission next action is invalid");
  assert(readback.next_handler === AGENT_SPAWNER_GOVERNED_ADMISSION_NEXT_HANDLER, "Governed-admission next handler is invalid");
  assert(readback.same_turn_dispatch === true, "Governed-admission adapter must dispatch in the same turn");
  validateAuthority(readback.authority);
  validateAdmission(readback.admission);
  validateEvidenceRefs(readback.evidence_refs);
  sortedUniqueIdentifiers(readback.hostile_fixture_refs, "Governed-admission hostile fixtures");
  requireSha(readback.readback_sha256, "Governed-admission readback digest");
  assert(readback.readback_sha256 === canonicalDigest(body(readback)), "Governed-admission readback digest mismatch");
  if (sourceContinuation !== null) {
    validateAgentSpawnerCompilerContinuation(sourceContinuation);
    assert(sourceContinuation.next_action === "ADMIT_GOVERNED_SPAWN", "Governed-admission source is not the compiler admission successor");
    assert(readback.source_continuation_sha256 === sourceContinuation.continuation_sha256, "Governed-admission source continuation is stale");
    assert(readback.source_lifecycle_sha256 === sourceContinuation.lifecycle_after_sha256, "Governed-admission source lifecycle is stale");
  }
  if (lifecycleBefore !== null) {
    validateAgentSpawnerLifecycle(lifecycleBefore);
    assert(lifecycleBefore.lifecycle_sha256 === readback.source_lifecycle_sha256, "Governed-admission lifecycle-before is stale");
    assert(lifecycleBefore.mode === "COMPILER_ONLY" && lifecycleBefore.state === "COMPILER_ACTIVE", "Governed-admission must start from an active compiler");
    assert(lifecycleBefore.next_action === "ADMIT_GOVERNED_SPAWN", "Governed-admission compiler route is stale");
  }
  if (lifecycleAfter !== null) {
    validateAgentSpawnerLifecycle(lifecycleAfter);
    assert(lifecycleAfter.lifecycle_sha256 === readback.lifecycle_after_sha256, "Governed-admission lifecycle-after is stale");
    assert(lifecycleAfter.mode === "GOVERNED_SPAWN" && lifecycleAfter.state === "SPAWN_ADMITTED", "Governed-admission did not establish the governed lifecycle");
    assert(lifecycleAfter.authority.isolated_local_custody === false, "Governed-admission lifecycle used the removed isolated-custody bypass");
    assert(lifecycleAfter.qa.independent_clearance_status === "CLEARED", "Governed-admission lifecycle lacks independent clearance");
    assert(lifecycleAfter.next_action === "START_GOVERNED_SPAWN", "Governed-admission lifecycle did not expose the next action");
  }
  return readback;
}

export function compileAgentSpawnerGovernedAdmission({adapterId, sourceContinuation, lifecycleBefore, evidenceRefs, hostileFixtureRefs} = {}) {
  validateAgentSpawnerCompilerContinuation(sourceContinuation);
  validateAgentSpawnerLifecycle(lifecycleBefore);
  assert(sourceContinuation.next_action === "ADMIT_GOVERNED_SPAWN", "Governed-admission source must be the compiler admission successor");
  assert(sourceContinuation.lifecycle_after_sha256 === lifecycleBefore.lifecycle_sha256, "Governed-admission source lifecycle does not match compiler continuation");
  assert(lifecycleBefore.qa.independent_clearance_status === "CLEARED" && lifecycleBefore.qa.status === "INDEPENDENT_PASS", "Governed admission requires independent clearance");
  const lifecycleAfter = admitAgentSpawnerIndependentClearance(lifecycleBefore);
  const readback = {
    schema: AGENT_SPAWNER_GOVERNED_ADMISSION_SCHEMA,
    version: AGENT_SPAWNER_GOVERNED_ADMISSION_VERSION,
    adapter_id: adapterId,
    source_continuation_sha256: sourceContinuation.continuation_sha256,
    source_lifecycle_sha256: lifecycleBefore.lifecycle_sha256,
    lifecycle_after_sha256: lifecycleAfter.lifecycle_sha256,
    status: AGENT_SPAWNER_GOVERNED_ADMISSION_STATUS,
    next_action: AGENT_SPAWNER_GOVERNED_ADMISSION_NEXT_ACTION,
    next_handler: AGENT_SPAWNER_GOVERNED_ADMISSION_NEXT_HANDLER,
    same_turn_dispatch: true,
    authority: {compiler_only: false, admission: true, activation: false, product_mutation: false, provider_access: false, credential_access: false},
    admission: {spawnable: true, worker_spawned: false, wave_activation: "OFF", isolated_local_custody: false},
    evidence_refs: structuredClone(evidenceRefs).sort((left, right) => compareUtf8(left.evidence_id, right.evidence_id)),
    hostile_fixture_refs: [...hostileFixtureRefs].sort(compareUtf8),
    readback_sha256: null,
  };
  readback.readback_sha256 = canonicalDigest(body(readback));
  return validateAgentSpawnerGovernedAdmission(readback, {sourceContinuation, lifecycleBefore, lifecycleAfter});
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("Agent Spawner governed-admission contract loaded\n");
