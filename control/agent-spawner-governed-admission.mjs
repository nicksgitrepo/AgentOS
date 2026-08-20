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
  validateAgentSpawnerCompilerContinuation,
  validateAgentSpawnerLifecycle,
} from "./agent-spawner-lifecycle.mjs";
import {assertVerifiedIndependentClearance, verifyIndependentSpawnerClearance} from "./independent-spawner-clearance.mjs";
import {assertCanonicalExactSpawnerAdmission} from "./spawner-bootstrap-governance.mjs";

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
const canonicalGovernedAdmissions = new WeakSet();

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

function validateGovernedAdmissionStructure(readback, {sourceContinuation = null, lifecycleBefore = null, lifecycleAfter = null} = {}) {
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
    throw new Error("Governed admission no longer accepts a caller-constructed lifecycle-after");
  }
  return readback;
}

export function validateAgentSpawnerGovernedAdmission(readback, options = {}) {
  assert(canonicalGovernedAdmissions.has(readback), "Governed admission was not produced by the canonical clearance-consuming adapter");
  return validateGovernedAdmissionStructure(readback, options);
}

export function compileAgentSpawnerGovernedAdmission(options = {}) {
  assert(options && typeof options === "object" && !Array.isArray(options), "Governed admission input must be an object");
  assert(Object.keys(options).every((key) => ["adapterId", "sourceContinuation", "lifecycleBefore", "clearanceReceiptSha256", "exactAdmission"].includes(key)), "Governed admission rejects caller evidence, fixtures, clearance authority, roots, candidates, projections, and PASS claims");
  const {adapterId, sourceContinuation, lifecycleBefore, clearanceReceiptSha256, exactAdmission} = options;
  validateAgentSpawnerCompilerContinuation(sourceContinuation);
  validateAgentSpawnerLifecycle(lifecycleBefore);
  assert(sourceContinuation.next_action === "ADMIT_GOVERNED_SPAWN", "Governed-admission source must be the compiler admission successor");
  assert(sourceContinuation.lifecycle_after_sha256 === lifecycleBefore.lifecycle_sha256, "Governed-admission source lifecycle does not match compiler continuation");
  const clearance = verifyIndependentSpawnerClearance({receiptSha256: clearanceReceiptSha256});
  assertVerifiedIndependentClearance(clearance, clearance.candidate);
  assert(clearance.candidate.lifecycle_candidate_sha256 === lifecycleBefore.candidate_sha256 && clearance.candidate.roster_projection_sha256 === lifecycleBefore.roster_projection_sha256 && clearance.candidate.context_sha256 === lifecycleBefore.context_sha256, "Canonical independent clearance does not bind the current lifecycle");
  assert(lifecycleBefore.qa.independent_clearance_receipt_sha256 === clearance.receipt_sha256, "Lifecycle clearance reference does not bind the consumed canonical receipt");
  assert(lifecycleBefore.qa.incomplete_block_count === 0 && lifecycleBefore.qa.pending_route_count === 0, "Governed admission requires complete canonical blocks and roster");
  assertCanonicalExactSpawnerAdmission(exactAdmission);
  assert(exactAdmission.spawner_package_sha256 === clearance.candidate.package_sha256 && exactAdmission.spawner_package_file_sha256 === clearance.candidate.package_file_sha256, "Exact admission package differs from independent clearance");
  assert(exactAdmission.hostile_fixture_ids.length > 0 && exactAdmission.hostile_evaluation_sha256, "Governed admission requires canonical executed hostile evidence");
  const evidenceRefs = [
    {evidence_id: "EVIDENCE.SPAWNER.CLEARANCE", reference: `ref:clearance/${clearance.receipt_sha256}`, sha256: clearance.receipt_sha256},
    {evidence_id: "EVIDENCE.SPAWNER.EXACT_ADMISSION", reference: `ref:exact-admission/${exactAdmission.admission_sha256}`, sha256: exactAdmission.admission_sha256},
    {evidence_id: "EVIDENCE.SPAWNER.HOSTILE_EXECUTION", reference: `ref:hostile-evaluation/${exactAdmission.hostile_evaluation_sha256}`, sha256: exactAdmission.hostile_evaluation_sha256},
    {evidence_id: "EVIDENCE.SPAWNER.PACKAGE", reference: `ref:package/${exactAdmission.spawner_package_sha256}`, sha256: exactAdmission.spawner_package_file_sha256},
    {evidence_id: "EVIDENCE.SPAWNER.EXTERNAL_REVIEW", reference: `ref:external-review/${exactAdmission.external_review_receipt_sha256}`, sha256: exactAdmission.external_review_receipt_sha256},
  ].sort((left, right) => compareUtf8(left.evidence_id, right.evidence_id));
  const hostileFixtureRefs = [...exactAdmission.hostile_fixture_ids].sort(compareUtf8);
  const lifecycleAfterSha256 = canonicalDigest({source_lifecycle_sha256: lifecycleBefore.lifecycle_sha256, clearance_receipt_sha256: clearance.receipt_sha256, candidate_authority_sha256: clearance.candidate_authority_sha256, exact_admission_sha256: exactAdmission.admission_sha256, transition: "CANONICAL_GOVERNED_ADMISSION_VERIFIED"});
  const readback = {
    schema: AGENT_SPAWNER_GOVERNED_ADMISSION_SCHEMA,
    version: AGENT_SPAWNER_GOVERNED_ADMISSION_VERSION,
    adapter_id: adapterId,
    source_continuation_sha256: sourceContinuation.continuation_sha256,
    source_lifecycle_sha256: lifecycleBefore.lifecycle_sha256,
    lifecycle_after_sha256: lifecycleAfterSha256,
    status: AGENT_SPAWNER_GOVERNED_ADMISSION_STATUS,
    next_action: AGENT_SPAWNER_GOVERNED_ADMISSION_NEXT_ACTION,
    next_handler: AGENT_SPAWNER_GOVERNED_ADMISSION_NEXT_HANDLER,
    same_turn_dispatch: true,
    authority: {compiler_only: false, admission: true, activation: false, product_mutation: false, provider_access: false, credential_access: false},
    admission: {spawnable: true, worker_spawned: false, wave_activation: "OFF", isolated_local_custody: false},
    evidence_refs: evidenceRefs,
    hostile_fixture_refs: hostileFixtureRefs,
    readback_sha256: null,
  };
  readback.readback_sha256 = canonicalDigest(body(readback));
  canonicalGovernedAdmissions.add(readback);
  validateAgentSpawnerGovernedAdmission(readback, {sourceContinuation, lifecycleBefore});
  return Object.freeze(readback);
}

export function assertCanonicalGovernedAdmission(readback) {
  return validateAgentSpawnerGovernedAdmission(readback);
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("Agent Spawner governed-admission contract loaded\n");
