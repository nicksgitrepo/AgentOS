#!/usr/bin/env node

/*
 * Same-turn compiler -> governed-admission adapter contract.
 *
 * A compiler-only Spawner may not grant itself worker authority, but a
 * complete local roster must not become a prose-only handoff.  This contract
 * makes the bounded adapter invocation explicit and digest-bound: it proves
 * that the compiler successor was consumed, isolated local custody was
 * established, no protected capability opened, and the next governed action
 * was started in the same turn.  It does not start workers or activate a
 * wave; that remains the next registered lifecycle action.
 */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {
  admitAgentSpawnerIsolatedLocalCustody,
  validateAgentSpawnerCompilerContinuation,
  validateAgentSpawnerLifecycle,
} from "./agent-spawner-lifecycle.mjs";

export const AGENT_SPAWNER_GOVERNED_ADMISSION_SCHEMA = "agentos.agent_spawner_governed_admission.v1";
export const AGENT_SPAWNER_GOVERNED_ADMISSION_VERSION = 1;
export const AGENT_SPAWNER_GOVERNED_ADMISSION_STATUS = "ADAPTER_STARTED";
export const AGENT_SPAWNER_GOVERNED_ADMISSION_NEXT_ACTION = "START_GOVERNED_SPAWN";
export const AGENT_SPAWNER_GOVERNED_ADMISSION_NEXT_HANDLER = "HANDLER.GOVERNED_SPAWN_ADAPTER";

/*
 * Atomic project-bound admission is deliberately a readback contract.  The
 * adapter never calls a host API or starts a process: it accepts only the
 * persisted facts returned by those APIs, compares every identity, and emits
 * one durable admission receipt.  Project identity is supplied as typed
 * context rather than embedded in this portable module.
 */
export const AGENT_SPAWNER_ATOMIC_ADMISSION_SCHEMA = "agentos.agent_spawner_atomic_admission.v1";
export const AGENT_SPAWNER_ATOMIC_ADMISSION_REQUEST_SCHEMA = "agentos.agent_spawner_atomic_admission_request.v1";
export const AGENT_SPAWNER_ATOMIC_ADMISSION_CLAIMS_READBACK_SCHEMA = "agentos.agent_spawner_identity_claims_readback.v1";
export const AGENT_SPAWNER_ATOMIC_ADMISSION_READBACK_VERSION = 1;
export const AGENT_SPAWNER_ATOMIC_ADMISSION_STATUS = "ADMITTED";
export const AGENT_SPAWNER_ATOMIC_ADMISSION_REQUIRED_MODEL = "gpt-5.6-luna";
export const AGENT_SPAWNER_ATOMIC_ADMISSION_REQUIRED_REASONING = "max";
export const AGENT_SPAWNER_ATOMIC_ADMISSION_CLAIMS_AUTHORITY = "AGENTOS.SPAWNER.IDENTITY_CLAIMS_READBACK";
export const AGENT_SPAWNER_ATOMIC_ADMISSION_CLAIMS_PROVENANCE = "ref:spawner/identity-claims-readback";
export const AGENT_SPAWNER_ATOMIC_ADMISSION_BLOCKER_CODES = Object.freeze({
  FRESH_READBACK_REQUIRED: "ATOMIC_ADMISSION_FRESH_READBACK_REQUIRED",
  PROJECT_BINDING_MISMATCH: "ATOMIC_ADMISSION_PROJECT_BINDING_MISMATCH",
  ROLE_BINDING_MISMATCH: "ATOMIC_ADMISSION_ROLE_BINDING_MISMATCH",
  MODEL_BINDING_MISMATCH: "ATOMIC_ADMISSION_MODEL_BINDING_MISMATCH",
  CUSTODY_BINDING_MISMATCH: "ATOMIC_ADMISSION_CUSTODY_BINDING_MISMATCH",
  DUPLICATE_OR_COLLISION: "ATOMIC_ADMISSION_DUPLICATE_OR_COLLISION",
  SUBSTANTIVE_WORK_STARTED: "ATOMIC_ADMISSION_SUBSTANTIVE_WORK_STARTED",
  READBACK_DIGEST_MISMATCH: "ATOMIC_ADMISSION_READBACK_DIGEST_MISMATCH",
  REQUEST_INVALID: "ATOMIC_ADMISSION_REQUEST_INVALID",
});
export const AGENT_SPAWNER_ATOMIC_ADMISSION_HOSTILE_FIXTURE_REFS = Object.freeze([
  "FIXTURE.ATOMIC_ADMISSION.CREATION_ACK_WITHOUT_READBACK",
  "FIXTURE.ATOMIC_ADMISSION.DUPLICATE_IDENTITY_COLLISION",
  "FIXTURE.ATOMIC_ADMISSION.FAILED_ROW_INDEPENDENCE",
  "FIXTURE.ATOMIC_ADMISSION.FAILED_TASK_HOLD_ARCHIVE_ONCE",
  "FIXTURE.ATOMIC_ADMISSION.MISSING_IDENTITY_CLAIMS_READBACK",
  "FIXTURE.ATOMIC_ADMISSION.PROJECT_CWD_ROOT_MISMATCH",
  "FIXTURE.ATOMIC_ADMISSION.PROMPT_TITLE_CANNOT_SUBSTITUTE_READBACK",
  "FIXTURE.ATOMIC_ADMISSION.ROLE_PROJECT_CWD_DRIFT",
  "FIXTURE.ATOMIC_ADMISSION.SUCCESS_DURABLE_RECEIPT",
]);

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
  assert(admission.isolated_local_custody === true, "Governed-admission adapter requires isolated local custody");
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
    assert(lifecycleAfter.authority.isolated_local_custody === true, "Governed-admission lifecycle lacks isolated custody");
    assert(lifecycleAfter.next_action === "START_GOVERNED_SPAWN", "Governed-admission lifecycle did not expose the next action");
  }
  return readback;
}

export function compileAgentSpawnerGovernedAdmission({adapterId, sourceContinuation, lifecycleBefore, evidenceRefs, hostileFixtureRefs} = {}) {
  validateAgentSpawnerCompilerContinuation(sourceContinuation);
  validateAgentSpawnerLifecycle(lifecycleBefore);
  assert(sourceContinuation.next_action === "ADMIT_GOVERNED_SPAWN", "Governed-admission source must be the compiler admission successor");
  assert(sourceContinuation.lifecycle_after_sha256 === lifecycleBefore.lifecycle_sha256, "Governed-admission source lifecycle does not match compiler continuation");
  const lifecycleAfter = admitAgentSpawnerIsolatedLocalCustody(lifecycleBefore);
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
    admission: {spawnable: true, worker_spawned: false, wave_activation: "OFF", isolated_local_custody: true},
    evidence_refs: structuredClone(evidenceRefs).sort((left, right) => compareUtf8(left.evidence_id, right.evidence_id)),
    hostile_fixture_refs: [...hostileFixtureRefs].sort(compareUtf8),
    readback_sha256: null,
  };
  readback.readback_sha256 = canonicalDigest(body(readback));
  return validateAgentSpawnerGovernedAdmission(readback, {sourceContinuation, lifecycleBefore, lifecycleAfter});
}

const ATOMIC_REQUEST_KEYS = Object.freeze([
  "schema", "version", "request_id", "task_id", "role_id", "role_kind", "model", "reasoning_effort",
  "target", "cwd", "worktree", "custody_ref", "queue", "seam", "prompt_ref", "title",
]);
const ATOMIC_TARGET_KEYS = Object.freeze(["projectId", "environment"]);
const ATOMIC_HOST_READBACK_KEYS = Object.freeze([
  "schema", "version", "fresh", "project_id", "cwd", "role_id", "role_kind", "model", "reasoning_effort",
  "queue", "seam", "worktree", "custody_ref", "worktree_clean", "readback_sha256",
]);
const ATOMIC_TASK_INDEX_KEYS = Object.freeze([
  "schema", "version", "fresh", "project_id", "cwd", "queue", "seam", "rows", "readback_sha256",
]);
const ATOMIC_TASK_ROW_KEYS = Object.freeze([
  "task_id", "role_id", "role_kind", "project_id", "cwd", "worktree", "custody_ref", "model",
  "reasoning_effort", "queue", "seam", "status", "lifecycle",
]);
const ATOMIC_STATE_READBACK_KEYS = Object.freeze([
  "schema", "version", "fresh", "task_id", "role_id", "role_kind", "project_id", "cwd", "worktree",
  "custody_ref", "model", "reasoning_effort", "queue", "seam", "status", "lifecycle",
  "substantive_prompt_sent", "process_started", "readback_sha256",
]);
const ATOMIC_PROCESS_READBACK_KEYS = Object.freeze(["schema", "version", "fresh", "processes", "readback_sha256"]);
const ATOMIC_PROCESS_KEYS = Object.freeze(["process_id", "task_id", "role_id", "worktree", "command"]);
const ATOMIC_CLAIM_KEYS = Object.freeze(["kind", "identity", "status"]);
const ATOMIC_CLAIMS_READBACK_KEYS = Object.freeze(["schema", "version", "fresh", "authority", "provenance", "claims", "readback_sha256"]);
const ATOMIC_RECEIPT_KEYS = Object.freeze([
  "schema", "version", "admission_id", "task_id", "role_id", "role_kind", "project_id", "environment", "cwd",
  "worktree", "custody_ref", "model", "reasoning_effort", "queue", "seam", "status",
  "host_readback_sha256", "task_index_readback_sha256", "state_readback_sha256", "process_readback_sha256",
  "existing_claims_readback_sha256", "existing_claims_authority", "existing_claims_provenance",
  "substantive_prompt_sent", "process_started", "cleanup_action", "retry_allowed", "material_transition",
  "hostile_fixture_refs", "receipt_sha256",
]);
const ATOMIC_READBACK_SCHEMAS = Object.freeze({
  host: "agentos.agent_spawner_host_readback.v1",
  taskIndex: "agentos.agent_spawner_task_index_readback.v1",
  state: "agentos.agent_spawner_task_state_readback.v1",
  process: "agentos.agent_spawner_process_readback.v1",
});
const ATOMIC_RECEIPT_CLEANUP = "NONE";
const ATOMIC_FAILED_ROW_STATUSES = new Set(["FAILED", "ARCHIVED", "HELD"]);
const ATOMIC_PRE_ADMISSION_STATUS = "PENDING";
const ATOMIC_PRE_ADMISSION_LIFECYCLE = "PENDING";
const ATOMIC_BLOCKER_CODES = AGENT_SPAWNER_ATOMIC_ADMISSION_BLOCKER_CODES;

function atomicText(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains control characters`);
}

function atomicIdentifier(value, label) {
  atomicText(value, label);
  assert(value.length <= 191, `${label} is too long`);
}

function atomicAbsolutePath(value, label) {
  atomicText(value, label);
  assert(value.startsWith("/"), `${label} must be an absolute path`);
  assert(value !== "/", `${label} cannot be the host root`);
}

function atomicReference(value, label) {
  assert(typeof value === "string" && /^(?:opaque:|ref:)[^\s]+$/u.test(value), `${label} must be an opaque reference`);
}

function atomicSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function atomicBody(value, digestField = "readback_sha256") {
  const copy = structuredClone(value);
  copy[digestField] = null;
  return copy;
}

function atomicDigest(value, digestField, label) {
  atomicSha(value[digestField], `${label} digest`);
  assert(value[digestField] === canonicalDigest(atomicBody(value, digestField)), `${label} digest mismatch`);
}

function atomicBlocker(code, message, details = {}) {
  const blocker = {
    schema: "agentos.agent_spawner_atomic_admission_blocker.v1",
    version: 1,
    code,
    message,
    cleanup_action: "HOLD_OR_ARCHIVE_ONCE",
    hold_or_archive_count: 1,
    substantive_work_started: false,
    retry_allowed: false,
    ...details,
    blocker_sha256: null,
  };
  blocker.blocker_sha256 = canonicalDigest(atomicBody(blocker, "blocker_sha256"));
  return blocker;
}

export class AgentSpawnerAtomicAdmissionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "AgentSpawnerAtomicAdmissionError";
    this.code = code;
    this.blocker = atomicBlocker(code, message, details);
  }
}

function atomicAssert(condition, code, message, details = {}) {
  if (!condition) throw new AgentSpawnerAtomicAdmissionError(code, message, details);
}

function atomicRequire(condition, code, message, details = {}) {
  try {
    assert(condition, message);
  } catch (error) {
    throw new AgentSpawnerAtomicAdmissionError(code, error.message, details);
  }
}

function atomicExact(value, keys, label, code = ATOMIC_BLOCKER_CODES.REQUEST_INVALID) {
  try {
    exactKeys(value, keys, label);
  } catch (error) {
    throw new AgentSpawnerAtomicAdmissionError(code, error.message);
  }
}

function atomicReadbackExact(value, keys, label) {
  atomicExact(value, keys, label, ATOMIC_BLOCKER_CODES.FRESH_READBACK_REQUIRED);
}

function validateAtomicRequest(request) {
  atomicExact(request, ATOMIC_REQUEST_KEYS, "Atomic admission request");
  atomicRequire(request.schema === AGENT_SPAWNER_ATOMIC_ADMISSION_REQUEST_SCHEMA && request.version === AGENT_SPAWNER_ATOMIC_ADMISSION_READBACK_VERSION, ATOMIC_BLOCKER_CODES.REQUEST_INVALID, "Atomic admission request identity is invalid");
  for (const [field, label] of [["request_id", "request ID"], ["task_id", "task ID"], ["role_id", "role ID"], ["role_kind", "role kind"], ["queue", "queue"], ["seam", "seam"]]) atomicRequire(typeof request[field] === "string" && request[field].length > 0, ATOMIC_BLOCKER_CODES.REQUEST_INVALID, `${label} is required`);
  atomicIdentifier(request.request_id, "Atomic admission request ID");
  atomicIdentifier(request.role_id, "Atomic admission role ID");
  atomicText(request.task_id, "Atomic admission task ID");
  atomicText(request.role_kind, "Atomic admission role kind");
  atomicText(request.model, "Atomic admission model");
  atomicText(request.reasoning_effort, "Atomic admission reasoning effort");
  atomicRequire(request.model === AGENT_SPAWNER_ATOMIC_ADMISSION_REQUIRED_MODEL, ATOMIC_BLOCKER_CODES.MODEL_BINDING_MISMATCH, "Atomic admission model is not the admitted model");
  atomicRequire(request.reasoning_effort === AGENT_SPAWNER_ATOMIC_ADMISSION_REQUIRED_REASONING, ATOMIC_BLOCKER_CODES.MODEL_BINDING_MISMATCH, "Atomic admission reasoning effort is not the admitted effort");
  atomicExact(request.target, ATOMIC_TARGET_KEYS, "Atomic admission target");
  atomicText(request.target.projectId, "Atomic admission project ID");
  atomicRequire(request.target.environment === "local", ATOMIC_BLOCKER_CODES.PROJECT_BINDING_MISMATCH, "Atomic admission target must use the local environment");
  atomicAbsolutePath(request.cwd, "Atomic admission cwd");
  atomicRequire(request.cwd !== "/" && request.cwd.startsWith("/"), ATOMIC_BLOCKER_CODES.PROJECT_BINDING_MISMATCH, "Atomic admission cwd cannot be the host root");
  atomicAbsolutePath(request.worktree, "Atomic admission worktree");
  atomicRequire(request.worktree.startsWith(`${request.cwd}/`) || request.worktree === request.cwd, ATOMIC_BLOCKER_CODES.CUSTODY_BINDING_MISMATCH, "Atomic admission worktree is outside the bound project cwd");
  atomicReference(request.custody_ref, "Atomic admission custody reference");
  atomicReference(request.prompt_ref, "Atomic admission prompt reference");
  atomicText(request.title, "Atomic admission title");
  return request;
}

function validateAtomicHostReadback(host, request) {
  atomicReadbackExact(host, ATOMIC_HOST_READBACK_KEYS, "Atomic host readback");
  atomicRequire(host.schema === ATOMIC_READBACK_SCHEMAS.host && host.version === 1 && host.fresh === true, ATOMIC_BLOCKER_CODES.FRESH_READBACK_REQUIRED, "fresh host readback is required");
  for (const [field, expected] of [["project_id", request.target.projectId], ["cwd", request.cwd], ["role_id", request.role_id], ["role_kind", request.role_kind], ["model", request.model], ["reasoning_effort", request.reasoning_effort], ["queue", request.queue], ["seam", request.seam], ["worktree", request.worktree], ["custody_ref", request.custody_ref]]) atomicRequire(host[field] === expected, field === "role_id" || field === "role_kind" ? ATOMIC_BLOCKER_CODES.ROLE_BINDING_MISMATCH : field === "worktree" || field === "custody_ref" ? ATOMIC_BLOCKER_CODES.CUSTODY_BINDING_MISMATCH : ATOMIC_BLOCKER_CODES.PROJECT_BINDING_MISMATCH, `host readback ${field} differs from the request`);
  atomicRequire(host.worktree_clean === true, ATOMIC_BLOCKER_CODES.CUSTODY_BINDING_MISMATCH, "host readback does not prove clean custody");
  atomicDigest(host, "readback_sha256", "Atomic host readback");
  return host;
}

function validateAtomicTaskRow(row, label) {
  atomicReadbackExact(row, ATOMIC_TASK_ROW_KEYS, label);
  for (const field of ["task_id", "role_id", "role_kind", "project_id", "cwd", "worktree", "custody_ref", "model", "reasoning_effort", "queue", "seam", "status", "lifecycle"]) atomicText(row[field], `${label} ${field}`);
}

function validateAtomicTaskIndex(index, request) {
  atomicReadbackExact(index, ATOMIC_TASK_INDEX_KEYS, "Atomic task-index readback");
  atomicRequire(index.schema === ATOMIC_READBACK_SCHEMAS.taskIndex && index.version === 1 && index.fresh === true, ATOMIC_BLOCKER_CODES.FRESH_READBACK_REQUIRED, "fresh task-index readback is required");
  atomicRequire(index.project_id === request.target.projectId && index.cwd === request.cwd && index.queue === request.queue && index.seam === request.seam, ATOMIC_BLOCKER_CODES.PROJECT_BINDING_MISMATCH, "task-index project/cwd/queue/seam binding differs from the request");
  atomicRequire(Array.isArray(index.rows), ATOMIC_BLOCKER_CODES.FRESH_READBACK_REQUIRED, "task-index rows are required");
  index.rows.forEach((row, i) => validateAtomicTaskRow(row, `Atomic task-index row ${i}`));
  atomicDigest(index, "readback_sha256", "Atomic task-index readback");
  const nonFailed = index.rows.filter((row) => !ATOMIC_FAILED_ROW_STATUSES.has(row.status) && !ATOMIC_FAILED_ROW_STATUSES.has(row.lifecycle));
  const targetRows = nonFailed.filter((row) => row.task_id === request.task_id);
  atomicRequire(targetRows.length === 1, ATOMIC_BLOCKER_CODES.ROLE_BINDING_MISMATCH, "task-index must contain exactly one nonfailed target task row");
  const target = targetRows[0];
  atomicRequire(target.status === ATOMIC_PRE_ADMISSION_STATUS && target.lifecycle === ATOMIC_PRE_ADMISSION_LIFECYCLE, ATOMIC_BLOCKER_CODES.READBACK_DIGEST_MISMATCH, "task-index target is not in the pre-admission state");
  for (const [field, expected] of [["role_id", request.role_id], ["role_kind", request.role_kind], ["project_id", request.target.projectId], ["cwd", request.cwd], ["worktree", request.worktree], ["custody_ref", request.custody_ref], ["model", request.model], ["reasoning_effort", request.reasoning_effort], ["queue", request.queue], ["seam", request.seam]]) atomicRequire(target[field] === expected, field === "role_id" || field === "role_kind" ? ATOMIC_BLOCKER_CODES.ROLE_BINDING_MISMATCH : field === "worktree" || field === "custody_ref" ? ATOMIC_BLOCKER_CODES.CUSTODY_BINDING_MISMATCH : ATOMIC_BLOCKER_CODES.PROJECT_BINDING_MISMATCH, `task-index target ${field} differs from the request`);
  for (const row of nonFailed) {
    const sameIdentity = row.task_id === request.task_id || row.role_id === request.role_id || row.worktree === request.worktree || row.custody_ref === request.custody_ref;
    if (row !== target) atomicRequire(!sameIdentity, ATOMIC_BLOCKER_CODES.DUPLICATE_OR_COLLISION, "task-index contains a duplicate task, role, worktree, or custody identity");
  }
  return {index, target};
}

function validateAtomicStateReadback(state, request) {
  atomicReadbackExact(state, ATOMIC_STATE_READBACK_KEYS, "Atomic task-state readback");
  atomicRequire(state.schema === ATOMIC_READBACK_SCHEMAS.state && state.version === 1 && state.fresh === true, ATOMIC_BLOCKER_CODES.FRESH_READBACK_REQUIRED, "fresh task state readback is required");
  for (const [field, expected] of [["task_id", request.task_id], ["role_id", request.role_id], ["role_kind", request.role_kind], ["project_id", request.target.projectId], ["cwd", request.cwd], ["worktree", request.worktree], ["custody_ref", request.custody_ref], ["model", request.model], ["reasoning_effort", request.reasoning_effort], ["queue", request.queue], ["seam", request.seam]]) atomicRequire(state[field] === expected, field === "role_id" || field === "role_kind" ? ATOMIC_BLOCKER_CODES.ROLE_BINDING_MISMATCH : field === "worktree" || field === "custody_ref" ? ATOMIC_BLOCKER_CODES.CUSTODY_BINDING_MISMATCH : ATOMIC_BLOCKER_CODES.PROJECT_BINDING_MISMATCH, `task state ${field} differs from the request`);
  atomicRequire(state.status === ATOMIC_PRE_ADMISSION_STATUS && state.lifecycle === ATOMIC_PRE_ADMISSION_LIFECYCLE, ATOMIC_BLOCKER_CODES.READBACK_DIGEST_MISMATCH, "task state is not in the pre-admission state");
  atomicRequire(state.substantive_prompt_sent === false && state.process_started === false, ATOMIC_BLOCKER_CODES.SUBSTANTIVE_WORK_STARTED, "substantive prompt or process started before atomic admission");
  atomicDigest(state, "readback_sha256", "Atomic task-state readback");
  return state;
}

function validateAtomicProcessReadback(processReadback, request) {
  atomicReadbackExact(processReadback, ATOMIC_PROCESS_READBACK_KEYS, "Atomic process readback");
  atomicRequire(processReadback.schema === ATOMIC_READBACK_SCHEMAS.process && processReadback.version === 1 && processReadback.fresh === true, ATOMIC_BLOCKER_CODES.FRESH_READBACK_REQUIRED, "fresh process readback is required");
  atomicRequire(Array.isArray(processReadback.processes), ATOMIC_BLOCKER_CODES.FRESH_READBACK_REQUIRED, "process readback processes are required");
  const processIds = new Set();
  processReadback.processes.forEach((process, i) => {
    atomicReadbackExact(process, ATOMIC_PROCESS_KEYS, `Atomic process ${i}`);
    for (const field of ATOMIC_PROCESS_KEYS) atomicText(process[field], `Atomic process ${i} ${field}`);
    atomicRequire(!processIds.has(process.process_id), ATOMIC_BLOCKER_CODES.DUPLICATE_OR_COLLISION, "process readback contains a duplicate process identity");
    processIds.add(process.process_id);
    const collision = process.task_id === request.task_id || process.role_id === request.role_id || process.worktree === request.worktree;
    atomicRequire(!collision, ATOMIC_BLOCKER_CODES.DUPLICATE_OR_COLLISION, "process readback contains a conflicting task, role, or worktree");
  });
  atomicDigest(processReadback, "readback_sha256", "Atomic process readback");
  return processReadback;
}

function validateAtomicClaims(existingClaims, request) {
  atomicRequire(Array.isArray(existingClaims), ATOMIC_BLOCKER_CODES.FRESH_READBACK_REQUIRED, "existing identity claims readback is required");
  existingClaims.forEach((claim, i) => {
    atomicReadbackExact(claim, ATOMIC_CLAIM_KEYS, `Atomic existing claim ${i}`);
    atomicText(claim.kind, `Atomic existing claim ${i} kind`);
    atomicText(claim.identity, `Atomic existing claim ${i} identity`);
    atomicText(claim.status, `Atomic existing claim ${i} status`);
    if (!ATOMIC_FAILED_ROW_STATUSES.has(claim.status)) atomicRequire(![request.task_id, request.role_id, request.worktree, request.custody_ref].includes(claim.identity), ATOMIC_BLOCKER_CODES.DUPLICATE_OR_COLLISION, "existing identity claim collides with the requested admission");
  });
}

function validateAtomicClaimsReadback(existingClaimsReadback, existingClaims, request) {
  atomicReadbackExact(existingClaimsReadback, ATOMIC_CLAIMS_READBACK_KEYS, "Atomic existing identity claims readback");
  atomicRequire(existingClaimsReadback.schema === AGENT_SPAWNER_ATOMIC_ADMISSION_CLAIMS_READBACK_SCHEMA && existingClaimsReadback.version === AGENT_SPAWNER_ATOMIC_ADMISSION_READBACK_VERSION && existingClaimsReadback.fresh === true, ATOMIC_BLOCKER_CODES.FRESH_READBACK_REQUIRED, "fresh existing identity claims readback is required");
  atomicRequire(Array.isArray(existingClaims), ATOMIC_BLOCKER_CODES.FRESH_READBACK_REQUIRED, "existing identity claims readback is required");
  atomicRequire(Array.isArray(existingClaimsReadback.claims), ATOMIC_BLOCKER_CODES.FRESH_READBACK_REQUIRED, "existing identity claims are required");
  atomicRequire(JSON.stringify(existingClaimsReadback.claims) === JSON.stringify(existingClaims), ATOMIC_BLOCKER_CODES.READBACK_DIGEST_MISMATCH, "existing identity claims readback does not match the supplied claims");
  atomicRequire(existingClaimsReadback.authority === AGENT_SPAWNER_ATOMIC_ADMISSION_CLAIMS_AUTHORITY, ATOMIC_BLOCKER_CODES.FRESH_READBACK_REQUIRED, "existing identity claims readback authority is invalid");
  atomicRequire(typeof existingClaimsReadback.provenance === "string" && /^(?:opaque:|ref:)[^\s]+$/u.test(existingClaimsReadback.provenance), ATOMIC_BLOCKER_CODES.FRESH_READBACK_REQUIRED, "existing identity claims readback provenance is required");
  atomicDigest(existingClaimsReadback, "readback_sha256", "Atomic existing identity claims readback");
  validateAtomicClaims(existingClaimsReadback.claims, request);
  return existingClaimsReadback;
}

function atomicReceiptBody(receipt) { return atomicBody(receipt, "receipt_sha256"); }

export function validateAgentSpawnerAtomicAdmission(receipt, {request = null, hostReadback = null, taskIndexReadback = null, stateReadback = null, processReadback = null, existingClaims = undefined, existingClaimsReadback = undefined, projectBinding = null, expectedProjectId = null, expectedCwd = null} = {}) {
  try {
    atomicExact(receipt, ATOMIC_RECEIPT_KEYS, "Atomic admission receipt", ATOMIC_BLOCKER_CODES.READBACK_DIGEST_MISMATCH);
    atomicRequire(receipt.schema === AGENT_SPAWNER_ATOMIC_ADMISSION_SCHEMA && receipt.version === 1, ATOMIC_BLOCKER_CODES.READBACK_DIGEST_MISMATCH, "Atomic admission receipt identity is invalid");
    atomicRequire(receipt.status === AGENT_SPAWNER_ATOMIC_ADMISSION_STATUS && receipt.cleanup_action === ATOMIC_RECEIPT_CLEANUP && receipt.retry_allowed === false && receipt.substantive_prompt_sent === false && receipt.process_started === false, ATOMIC_BLOCKER_CODES.READBACK_DIGEST_MISMATCH, "Atomic admission receipt crossed the substantive-work boundary");
    for (const field of ["admission_id", "task_id", "role_id", "role_kind", "project_id", "environment", "cwd", "worktree", "custody_ref", "model", "reasoning_effort", "queue", "seam", "material_transition"]) atomicText(receipt[field], `Atomic admission receipt ${field}`);
    atomicRequire(receipt.environment === "local", ATOMIC_BLOCKER_CODES.PROJECT_BINDING_MISMATCH, "Atomic admission receipt environment is invalid");
    for (const field of ["host_readback_sha256", "task_index_readback_sha256", "state_readback_sha256", "process_readback_sha256"]) atomicSha(receipt[field], `Atomic admission receipt ${field}`);
    atomicSha(receipt.existing_claims_readback_sha256, "Atomic admission receipt existing claims readback");
    atomicRequire(receipt.existing_claims_authority === AGENT_SPAWNER_ATOMIC_ADMISSION_CLAIMS_AUTHORITY, ATOMIC_BLOCKER_CODES.READBACK_DIGEST_MISMATCH, "Atomic admission receipt existing claims authority is invalid");
    atomicRequire(typeof receipt.existing_claims_provenance === "string" && /^(?:opaque:|ref:)[^\s]+$/u.test(receipt.existing_claims_provenance), ATOMIC_BLOCKER_CODES.READBACK_DIGEST_MISMATCH, "Atomic admission receipt existing claims provenance is invalid");
    sortedUniqueIdentifiers(receipt.hostile_fixture_refs, "Atomic admission hostile fixtures");
    atomicRequire(JSON.stringify(receipt.hostile_fixture_refs) === JSON.stringify([...AGENT_SPAWNER_ATOMIC_ADMISSION_HOSTILE_FIXTURE_REFS]), ATOMIC_BLOCKER_CODES.READBACK_DIGEST_MISMATCH, "Atomic admission hostile fixture coverage is incomplete");
    atomicDigest(receipt, "receipt_sha256", "Atomic admission receipt");
    if (request !== null) {
      const inputs = validateAtomicAdmissionInputs({request, hostReadback, taskIndexReadback, stateReadback, processReadback, existingClaims, existingClaimsReadback, projectBinding, expectedProjectId, expectedCwd});
      for (const [field, expected] of [["admission_id", request.request_id], ["task_id", request.task_id], ["role_id", request.role_id], ["role_kind", request.role_kind], ["project_id", request.target.projectId], ["cwd", request.cwd], ["worktree", request.worktree], ["custody_ref", request.custody_ref], ["model", request.model], ["reasoning_effort", request.reasoning_effort], ["queue", request.queue], ["seam", request.seam]]) atomicRequire(receipt[field] === expected, ATOMIC_BLOCKER_CODES.READBACK_DIGEST_MISMATCH, `Atomic admission receipt ${field} is not bound to the request`);
      atomicRequire(receipt.host_readback_sha256 === inputs.hostReadback.readback_sha256 && receipt.task_index_readback_sha256 === inputs.taskIndexReadback.readback_sha256 && receipt.state_readback_sha256 === inputs.stateReadback.readback_sha256 && receipt.process_readback_sha256 === inputs.processReadback.readback_sha256, ATOMIC_BLOCKER_CODES.READBACK_DIGEST_MISMATCH, "Atomic admission receipt readback digest binding is stale");
      atomicRequire(receipt.existing_claims_readback_sha256 === inputs.existingClaimsReadback.readback_sha256 && receipt.existing_claims_authority === inputs.existingClaimsReadback.authority && receipt.existing_claims_provenance === inputs.existingClaimsReadback.provenance, ATOMIC_BLOCKER_CODES.READBACK_DIGEST_MISMATCH, "Atomic admission receipt existing claims binding is stale");
    }
    return receipt;
  } catch (error) {
    if (error instanceof AgentSpawnerAtomicAdmissionError) throw error;
    throw new AgentSpawnerAtomicAdmissionError(ATOMIC_BLOCKER_CODES.READBACK_DIGEST_MISMATCH, error.message);
  }
}

export function validateAtomicAdmissionInputs({request, hostReadback, taskIndexReadback, stateReadback, processReadback, existingClaims = undefined, existingClaimsReadback = undefined, projectBinding = null, expectedProjectId = null, expectedCwd = null} = {}) {
  try {
    validateAtomicRequest(request);
    const binding = projectBinding ?? {project_id: expectedProjectId, cwd: expectedCwd, environment: "local"};
    const bindingProjectId = binding?.project_id ?? binding?.projectId;
    atomicRequire(isRecord(binding) && typeof bindingProjectId === "string" && bindingProjectId.length > 0 && typeof binding.cwd === "string" && binding.cwd.length > 0, ATOMIC_BLOCKER_CODES.PROJECT_BINDING_MISMATCH, "an authoritative saved-project binding is required");
    atomicRequire(binding.environment === undefined || binding.environment === "local", ATOMIC_BLOCKER_CODES.PROJECT_BINDING_MISMATCH, "saved-project binding must use the local environment");
    atomicRequire(request.target.projectId === bindingProjectId && request.cwd === binding.cwd, ATOMIC_BLOCKER_CODES.PROJECT_BINDING_MISMATCH, "request does not match the authoritative saved-project binding");
    atomicRequire(hostReadback !== null && taskIndexReadback !== null && stateReadback !== null && processReadback !== null, ATOMIC_BLOCKER_CODES.FRESH_READBACK_REQUIRED, "fresh host, task-index, state, and process readbacks are all required");
    validateAtomicHostReadback(hostReadback, request);
    validateAtomicTaskIndex(taskIndexReadback, request);
    validateAtomicStateReadback(stateReadback, request);
    validateAtomicProcessReadback(processReadback, request);
    validateAtomicClaimsReadback(existingClaimsReadback, existingClaims, request);
    return {request, hostReadback, taskIndexReadback, stateReadback, processReadback, existingClaims, existingClaimsReadback, projectBinding: binding};
  } catch (error) {
    if (error instanceof AgentSpawnerAtomicAdmissionError) throw error;
    throw new AgentSpawnerAtomicAdmissionError(ATOMIC_BLOCKER_CODES.REQUEST_INVALID, error.message);
  }
}

export function compileAgentSpawnerAtomicAdmission({request, hostReadback, taskIndexReadback, stateReadback, processReadback, existingClaims = undefined, existingClaimsReadback = undefined, projectBinding = null, expectedProjectId = null, expectedCwd = null} = {}) {
  const inputs = validateAtomicAdmissionInputs({request, hostReadback, taskIndexReadback, stateReadback, processReadback, existingClaims, existingClaimsReadback, projectBinding, expectedProjectId, expectedCwd});
  const receipt = {
    schema: AGENT_SPAWNER_ATOMIC_ADMISSION_SCHEMA,
    version: 1,
    admission_id: request.request_id,
    task_id: request.task_id,
    role_id: request.role_id,
    role_kind: request.role_kind,
    project_id: request.target.projectId,
    environment: request.target.environment,
    cwd: request.cwd,
    worktree: request.worktree,
    custody_ref: request.custody_ref,
    model: request.model,
    reasoning_effort: request.reasoning_effort,
    queue: request.queue,
    seam: request.seam,
    status: AGENT_SPAWNER_ATOMIC_ADMISSION_STATUS,
    host_readback_sha256: hostReadback.readback_sha256,
    task_index_readback_sha256: taskIndexReadback.readback_sha256,
    state_readback_sha256: stateReadback.readback_sha256,
    process_readback_sha256: processReadback.readback_sha256,
    existing_claims_readback_sha256: existingClaimsReadback.readback_sha256,
    existing_claims_authority: existingClaimsReadback.authority,
    existing_claims_provenance: existingClaimsReadback.provenance,
    substantive_prompt_sent: false,
    process_started: false,
    cleanup_action: ATOMIC_RECEIPT_CLEANUP,
    retry_allowed: false,
    material_transition: "ADMISSION_RECORDED_NEXT_GOVERNED_ACTION",
    hostile_fixture_refs: [...AGENT_SPAWNER_ATOMIC_ADMISSION_HOSTILE_FIXTURE_REFS],
    receipt_sha256: null,
  };
  receipt.receipt_sha256 = canonicalDigest(atomicReceiptBody(receipt));
  return validateAgentSpawnerAtomicAdmission(receipt, inputs);
}

export function evaluateAgentSpawnerAtomicAdmission(input = {}) {
  try {
    return {accepted: true, status: AGENT_SPAWNER_ATOMIC_ADMISSION_STATUS, receipt: compileAgentSpawnerAtomicAdmission(input)};
  } catch (error) {
    if (!(error instanceof AgentSpawnerAtomicAdmissionError)) throw error;
    return {accepted: false, status: "HELD", blocker: structuredClone(error.blocker)};
  }
}

// Concise aliases are intentionally additive; they all use the one strict
// implementation above and cannot bypass the persisted-readback checks.
export const compileAtomicSpawnerAdmission = compileAgentSpawnerAtomicAdmission;
export const validateAtomicSpawnerAdmission = validateAgentSpawnerAtomicAdmission;
export const evaluateAtomicSpawnerAdmission = evaluateAgentSpawnerAtomicAdmission;
export const ATOMIC_SPAWNER_ADMISSION_BLOCKER_CODES = AGENT_SPAWNER_ATOMIC_ADMISSION_BLOCKER_CODES;

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("Agent Spawner governed-admission contract loaded\n");
