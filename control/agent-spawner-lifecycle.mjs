/*
 * Project-agnostic Agent Spawner lifecycle.
 *
 * The compiler is a persistent, no-side-effect role.  COMPILER_ONLY work is
 * local QA/import planning, so it must not stop merely because the later
 * governed route still needs independent clearance.  Once its blocks and
 * roster are complete it emits the governed-admission successor; only the
 * explicit adapter/readback can cross into worker admission or activation.
 * Compiler-only state cannot be converted into a protected hold; only a
 * governed activation route may wait on an external/owner boundary.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";

export const AGENT_SPAWNER_LIFECYCLE_SCHEMA = "agentos.agent_spawner_lifecycle.v1";
export const AGENT_SPAWNER_LIFECYCLE_VERSION = 1;
export const AGENT_SPAWNER_ROLE_ID = "AGENT.SPAWNER_COMPILER";
export const AGENT_SPAWNER_MODES = Object.freeze(["COMPILER_ONLY", "GOVERNED_SPAWN"]);
export const AGENT_SPAWNER_STATES = Object.freeze([
  "PREPARED",
  "QA_READY",
  "COMPILER_ACTIVE",
  "SPAWN_ADMITTED",
  "SPAWN_ACTIVE",
  "STALLED",
  "RETIRED",
]);
export const AGENT_SPAWNER_PERSISTENT_STATES = Object.freeze(["PREPARED", "QA_READY", "COMPILER_ACTIVE", "ADMITTED", "ACTIVE", "STALLED", "RETIRED"]);
export const AGENT_SPAWNER_WAVE_ACTIVATION_STATES = Object.freeze(["OFF", "ON"]);
export const AGENT_SPAWNER_NEXT_ACTIONS = Object.freeze([
  "START_COMPILER",
  "COMPILE_NEXT_BLOCK",
  "PUBLISH_TYPED_ROSTER",
  "WAIT_FOR_INDEPENDENT_CLEARANCE",
  "ADMIT_GOVERNED_SPAWN",
  "START_GOVERNED_SPAWN",
  "WAIT_FOR_OWNER_OR_PROTECTED_DEPENDENCY_EVENT",
  "NONE",
]);
export const AGENT_SPAWNER_EVENT_TYPES = Object.freeze([
  "START_COMPILER",
  "BLOCK_LIBRARY_UPDATED",
  "INDEPENDENT_CLEARANCE_GRANTED",
  "ADMIT_GOVERNED_SPAWN",
  "START_GOVERNED_SPAWN",
  "PROTECTED_HOLD",
  "RETIRE",
]);
export const AGENT_SPAWNER_COMPILER_CONTINUATION_SCHEMA = "agentos.agent_spawner_compiler_continuation.v1";
export const AGENT_SPAWNER_COMPILER_CONTINUATION_VERSION = 1;
export const AGENT_SPAWNER_COMPILER_OUTCOMES = Object.freeze(["BLOCK_COMPILED", "TYPED_ROSTER_PUBLISHED", "PROTECTED_EVENT_WAIT"]);
export const AGENT_SPAWNER_COMPILER_CONTINUATION_ACTIONS = Object.freeze(["COMPILE_NEXT_BLOCK", "PUBLISH_TYPED_ROSTER", "WAIT_FOR_INDEPENDENT_CLEARANCE"]);
export const AGENT_SPAWNER_COMPILER_NEXT_ACTIONS = Object.freeze(["COMPILE_NEXT_BLOCK", "PUBLISH_TYPED_ROSTER", "WAIT_FOR_PROTECTED_EVENT", "ADMIT_GOVERNED_SPAWN"]);
export const AGENT_SPAWNER_PROTECTED_HOLD_EVENT_SHA256 = canonicalDigest({event_type: "PROTECTED_HOLD", event_sha256: null});

/*
 * Audit-routing receipts are immutable evidence records, not a mutable route
 * status flag.  The final receipt is sealed first, then a separate route
 * payload carries the exact bytes digest to the consumer.  A correction is a
 * new receipt path which retains the historical identity but never inherits a
 * product verdict.
 */
export const AGENT_SPAWNER_ROUTING_RECEIPT_SCHEMA = "agentos.agent_spawner_routing_receipt.v1";
export const AGENT_SPAWNER_ROUTING_RECEIPT_VERSION = 1;
export const AGENT_SPAWNER_ROUTING_RECEIPT_PROVENANCE_BLOCKER = "ROUTING_RECEIPT_PROVENANCE_BLOCKED";
export const AGENT_SPAWNER_ROUTING_RECEIPT_STATUSES = Object.freeze(["FINALIZED"]);
export const AGENT_SPAWNER_ROUTING_HOSTILE_FIXTURE_REFS = Object.freeze([
  "FIXTURE.ROUTING_RECEIPT.DIGEST_BEFORE_FINAL_WRITE",
  "FIXTURE.ROUTING_RECEIPT.SAME_PATH_POST_ROUTE_MUTATION",
  "FIXTURE.ROUTING_RECEIPT.HISTORICAL_DIGESTS_SEPARATE",
  "FIXTURE.ROUTING_RECEIPT.CORRECTION_NO_VERDICT_INHERITANCE",
  "FIXTURE.ROUTING_RECEIPT.REPLACEMENT_REQUIRES_FRESH_AUTHORITY",
  "FIXTURE.ROUTING_RECEIPT.SUCCESSOR_EXACT_BYTE_RECOMPUTATION",
]);

const IDENTIFIER = /^[A-Z][A-Z0-9._:-]{0,191}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const OPAQUE_REF = /^(?:opaque:|ref:)[^\s]+$/u;
const QA_STATUSES = new Set(["NOT_READY", "STATIC_PASS_REVIEW_REQUIRED", "INDEPENDENT_PASS"]);
const CLEARANCE_STATUSES = new Set(["PENDING_EXTERNAL_AUTHORITY", "CLEARED", "REJECTED"]);
const ADAPTER_STATUSES = new Set(["UNAVAILABLE", "READY"]);
const SAFE_COMPILER_ACTIONS = new Set(["COMPILE_NEXT_BLOCK", "PUBLISH_TYPED_ROSTER", "WAIT_FOR_INDEPENDENT_CLEARANCE"]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, keys, label) {
  assert(isRecord(value), `${label} must be an object`);
  const actual = Object.keys(value).sort(compareUtf8);
  const expected = [...keys].sort(compareUtf8);
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} fields mismatch`);
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains control characters`);
}

function requireIdentifier(value, label) {
  assert(typeof value === "string" && IDENTIFIER.test(value), `${label} must be a stable identifier`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function requireNonNegativeInteger(value, label) {
  assert(Number.isSafeInteger(value) && value >= 0, `${label} must be a non-negative integer`);
}

function sortedIdentifiers(values, label) {
  assert(Array.isArray(values), `${label} must be an array`);
  values.forEach((value, index) => requireIdentifier(value, `${label} item ${index}`));
  const sorted = [...values].sort(compareUtf8);
  assert(new Set(sorted).size === sorted.length, `${label} contains duplicates`);
  assert(JSON.stringify(values) === JSON.stringify(sorted), `${label} must be sorted`);
}

function sortedFieldNames(values, label) {
  assert(Array.isArray(values), `${label} must be an array`);
  values.forEach((value, index) => assert(typeof value === "string" && /^[a-z][a-z0-9_]{0,127}$/u.test(value), `${label} item ${index} must be a stable field name`));
  const sorted = [...values].sort(compareUtf8);
  assert(new Set(sorted).size === sorted.length, `${label} contains duplicates`);
  assert(JSON.stringify(values) === JSON.stringify(sorted), `${label} must be sorted`);
}

function lifecycleBody(lifecycle) {
  const body = structuredClone(lifecycle);
  body.lifecycle_sha256 = null;
  return body;
}

function deriveCompilerAction(lifecycle) {
  if (lifecycle.state === "RETIRED") return "NONE";
  if (lifecycle.state === "STALLED") return "WAIT_FOR_OWNER_OR_PROTECTED_DEPENDENCY_EVENT";
  if (lifecycle.mode === "COMPILER_ONLY") {
    if (lifecycle.qa.incomplete_block_count > 0) return "COMPILE_NEXT_BLOCK";
    if (lifecycle.qa.pending_route_count > 0) return "PUBLISH_TYPED_ROSTER";
    // Independent utility/harm clearance applies to governed activation and
    // protected/external work, not to this no-side-effect compiler phase.
    // Keep the compiler moving and hand off to the bounded admission adapter;
    // the adapter/readback still forbids workers, waves, Product mutation,
    // providers, credentials, spend, and destructive actions at this stage.
    return "ADMIT_GOVERNED_SPAWN";
  }
  if (lifecycle.state === "QA_READY") return "ADMIT_GOVERNED_SPAWN";
  if (lifecycle.state === "SPAWN_ADMITTED") return "START_GOVERNED_SPAWN";
  if (lifecycle.state === "SPAWN_ACTIVE") return "START_GOVERNED_SPAWN";
  return "START_COMPILER";
}

function derivePersistentState(lifecycle) {
  if (lifecycle.state === "PREPARED") return "PREPARED";
  if (lifecycle.state === "QA_READY") return "QA_READY";
  if (lifecycle.state === "COMPILER_ACTIVE") return "COMPILER_ACTIVE";
  if (lifecycle.state === "SPAWN_ADMITTED") return "ADMITTED";
  if (lifecycle.state === "SPAWN_ACTIVE") return "ACTIVE";
  if (lifecycle.state === "STALLED") return "STALLED";
  if (lifecycle.state === "RETIRED") return "RETIRED";
  return lifecycle.mode === "COMPILER_ONLY" ? "QA_READY" : "ACTIVE";
}

function validateQa(qa) {
  exactKeys(qa, [
    "status", "complete_block_count", "incomplete_block_count", "pending_route_count",
    "independent_clearance_status", "independent_clearance_receipt_sha256",
  ], "Agent Spawner QA");
  assert(QA_STATUSES.has(qa.status), "Agent Spawner QA status is invalid");
  for (const field of ["complete_block_count", "incomplete_block_count", "pending_route_count"]) requireNonNegativeInteger(qa[field], `Agent Spawner QA ${field}`);
  assert(CLEARANCE_STATUSES.has(qa.independent_clearance_status), "Agent Spawner independent clearance status is invalid");
  if (qa.independent_clearance_status === "CLEARED") requireSha(qa.independent_clearance_receipt_sha256, "Agent Spawner clearance receipt");
  else assert(qa.independent_clearance_receipt_sha256 === null, "Agent Spawner uncleared QA cannot carry a clearance receipt");
  if (qa.status === "INDEPENDENT_PASS") assert(qa.independent_clearance_status === "CLEARED", "Independent pass requires independent clearance");
  if (qa.incomplete_block_count === 0) assert(qa.status !== "NOT_READY", "Complete blocks cannot retain NOT_READY QA");
}

function validateAuthority(authority, lifecycle) {
  exactKeys(authority, [
    "compiler_authority", "temporary_worker_admission", "spawn_authority", "product_mutation",
    "provider_access", "credential_access", "external_sync", "isolated_local_custody", "independent_evaluation_required",
  ], "Agent Spawner authority");
  assert(typeof authority.compiler_authority === "boolean", "Agent Spawner compiler authority is invalid");
  for (const field of ["temporary_worker_admission", "spawn_authority", "product_mutation", "provider_access", "credential_access", "external_sync", "isolated_local_custody", "independent_evaluation_required"]) assert(typeof authority[field] === "boolean", `Agent Spawner ${field} authority is invalid`);
  assert(authority.compiler_authority === true, "Agent Spawner compiler authority is required");
  if (lifecycle.mode === "COMPILER_ONLY") {
    assert(authority.temporary_worker_admission === false && authority.spawn_authority === false, "Compiler-only Spawner cannot admit or spawn workers");
    assert(authority.isolated_local_custody === false, "Compiler-only Spawner cannot claim isolated spawn custody");
    assert(authority.product_mutation === false && authority.provider_access === false && authority.credential_access === false && authority.external_sync === false, "Compiler-only Spawner crossed a protected boundary");
  }
  if (authority.isolated_local_custody) {
    assert(lifecycle.mode === "GOVERNED_SPAWN", "Isolated local custody requires governed-spawn mode");
    assert(authority.product_mutation === false && authority.provider_access === false && authority.credential_access === false && authority.external_sync === false, "Isolated local custody crossed a protected boundary");
  }
  if (authority.spawn_authority) {
    assert(lifecycle.mode === "GOVERNED_SPAWN", "Spawn authority requires governed-spawn mode");
    assert(authority.temporary_worker_admission === true, "Spawn authority requires worker admission");
    assert(lifecycle.qa.independent_clearance_status === "CLEARED" || authority.isolated_local_custody === true, "Spawn authority requires independent clearance or proven isolated local custody");
    assert(lifecycle.qa.incomplete_block_count === 0, "Spawn authority cannot use incomplete blocks");
    assert(lifecycle.qa.pending_route_count === 0, "Spawn authority cannot use an unpublished roster");
  }
}

function validateExecution(execution, lifecycle) {
  exactKeys(execution, ["compiler_ticks", "active_worker_count", "scheduler_job_count", "heavyweight_process_count", "timer_count", "polling"], "Agent Spawner execution");
  for (const field of ["compiler_ticks", "active_worker_count", "scheduler_job_count", "heavyweight_process_count", "timer_count"]) requireNonNegativeInteger(execution[field], `Agent Spawner execution ${field}`);
  assert(typeof execution.polling === "boolean", "Agent Spawner polling state is invalid");
  if (lifecycle.authority.isolated_local_custody) {
    assert(execution.active_worker_count <= 6, "Isolated local Spawner custody exceeds six workers");
    assert(execution.scheduler_job_count <= 6, "Isolated local Spawner custody exceeds six scheduler jobs");
    assert(execution.heavyweight_process_count <= 1, "Isolated local Spawner custody exceeds one heavyweight process");
    assert(execution.timer_count === 0 && execution.polling === false, "Isolated local Spawner custody cannot use timers or polling");
  }
  if (lifecycle.mode === "COMPILER_ONLY") {
    assert(execution.active_worker_count === 0, "Compiler-only Spawner cannot own active workers");
    assert(execution.scheduler_job_count === 0 && execution.heavyweight_process_count === 0, "Compiler-only Spawner cannot own heavyweight jobs");
    assert(execution.polling === false, "Compiler-only Spawner cannot poll protected dependencies");
  }
  if (lifecycle.state === "STALLED" || lifecycle.state === "RETIRED") assert(execution.timer_count === 0, "Stalled or retired Spawner cannot retain timers");
}

export function validateAgentSpawnerLifecycle(lifecycle) {
  exactKeys(lifecycle, [
    "schema", "version", "lifecycle_id", "role_id", "mode", "state", "persistent_state", "wave_activation", "candidate_sha256",
    "roster_projection_sha256", "context_sha256", "qa", "authority", "execution", "protected_hold_event_sha256", "next_action",
    "lifecycle_sha256",
  ], "Agent Spawner lifecycle");
  assert(lifecycle.schema === AGENT_SPAWNER_LIFECYCLE_SCHEMA && lifecycle.version === AGENT_SPAWNER_LIFECYCLE_VERSION, "Agent Spawner lifecycle identity is invalid");
  requireIdentifier(lifecycle.lifecycle_id, "Agent Spawner lifecycle ID");
  assert(lifecycle.role_id === AGENT_SPAWNER_ROLE_ID, "Agent Spawner role identity is invalid");
  assert(AGENT_SPAWNER_MODES.includes(lifecycle.mode), "Agent Spawner mode is invalid");
  assert(AGENT_SPAWNER_STATES.includes(lifecycle.state), "Agent Spawner state is invalid");
  assert(AGENT_SPAWNER_PERSISTENT_STATES.includes(lifecycle.persistent_state), "Agent Spawner persistent lifecycle state is invalid");
  assert(AGENT_SPAWNER_WAVE_ACTIVATION_STATES.includes(lifecycle.wave_activation), "Agent Spawner wave activation state is invalid");
  assert(lifecycle.persistent_state === derivePersistentState(lifecycle), "Agent Spawner persistent lifecycle state is not bound to its operational state");
  for (const field of ["candidate_sha256", "roster_projection_sha256", "context_sha256"]) requireSha(lifecycle[field], `Agent Spawner ${field}`);
  if (lifecycle.state === "STALLED") {
    assert(lifecycle.mode === "GOVERNED_SPAWN", "Compiler-only Spawner cannot enter a protected stall");
    assert(lifecycle.qa.incomplete_block_count === 0 && lifecycle.qa.pending_route_count === 0, "Protected Spawner stall cannot hide local block or roster work");
    assert(lifecycle.qa.independent_clearance_status === "PENDING_EXTERNAL_AUTHORITY", "Protected Spawner stall requires a pending external decision");
    requireSha(lifecycle.protected_hold_event_sha256, "Agent Spawner protected hold receipt");
    assert(lifecycle.protected_hold_event_sha256 === AGENT_SPAWNER_PROTECTED_HOLD_EVENT_SHA256, "Stalled Spawner lacks the canonical protected-hold receipt");
  } else {
    assert(lifecycle.protected_hold_event_sha256 === null, "Non-stalled Spawner cannot retain a protected-hold receipt");
  }
  validateQa(lifecycle.qa);
  validateAuthority(lifecycle.authority, lifecycle);
  validateExecution(lifecycle.execution, lifecycle);
  assert(AGENT_SPAWNER_NEXT_ACTIONS.includes(lifecycle.next_action), "Agent Spawner next action is invalid");
  assert(lifecycle.next_action === deriveCompilerAction(lifecycle), "Agent Spawner next action does not match lifecycle state");
  if (lifecycle.state === "COMPILER_ACTIVE") assert(lifecycle.mode === "COMPILER_ONLY", "Compiler-active state requires compiler-only mode");
  if (lifecycle.state === "SPAWN_ADMITTED" || lifecycle.state === "SPAWN_ACTIVE") {
    assert(lifecycle.mode === "GOVERNED_SPAWN", "Governed spawn state requires governed-spawn mode");
    assert(lifecycle.authority.spawn_authority === true, "Governed spawn state lacks spawn authority");
    assert(lifecycle.qa.incomplete_block_count === 0 && lifecycle.qa.pending_route_count === 0, "Governed spawn state cannot hide incomplete blocks or pending roster routes");
  }
  if (lifecycle.qa.independent_clearance_status === "PENDING_EXTERNAL_AUTHORITY") {
    assert(!(lifecycle.mode === "GOVERNED_SPAWN" && (lifecycle.state === "SPAWN_ADMITTED" || lifecycle.state === "SPAWN_ACTIVE") && lifecycle.authority.isolated_local_custody === false), "Pending utility/harm cannot admit or activate non-isolated governed spawning");
    if (lifecycle.authority.isolated_local_custody === false) assert(lifecycle.persistent_state !== "ACTIVE" && lifecycle.wave_activation === "OFF", "Pending utility/harm must keep governed activation off");
  }
  if (lifecycle.wave_activation === "ON") {
    assert(lifecycle.mode === "GOVERNED_SPAWN" && lifecycle.state === "SPAWN_ACTIVE", "Wave activation requires governed active spawn");
    assert(lifecycle.qa.independent_clearance_status === "CLEARED" || lifecycle.authority.isolated_local_custody === true, "Wave activation requires independent clearance or isolated local custody");
  }
  if (lifecycle.state === "STALLED") assert(lifecycle.next_action === "WAIT_FOR_OWNER_OR_PROTECTED_DEPENDENCY_EVENT", "Stalled Spawner must wait on an event");
  requireSha(lifecycle.lifecycle_sha256, "Agent Spawner lifecycle digest");
  assert(lifecycle.lifecycle_sha256 === canonicalDigest(lifecycleBody(lifecycle)), "Agent Spawner lifecycle digest mismatch");
  return lifecycle;
}

export function compileAgentSpawnerLifecycle({
  lifecycleId,
  mode = "COMPILER_ONLY",
  state = null,
  waveActivation = "OFF",
  candidateSha256,
  rosterProjectionSha256,
  contextSha256,
  qa,
  isolatedLocalCustody = false,
  protectedHoldEventSha256 = null,
  execution = {compiler_ticks: 0, active_worker_count: 0, scheduler_job_count: 0, heavyweight_process_count: 0, timer_count: 0, polling: false},
} = {}) {
  requireIdentifier(lifecycleId, "Agent Spawner lifecycle ID");
  assert(AGENT_SPAWNER_MODES.includes(mode), "Agent Spawner mode is invalid");
  const complete = qa.incomplete_block_count === 0;
  const clearance = qa.independent_clearance_status === "CLEARED";
  const derivedState = state ?? (mode === "COMPILER_ONLY" ? "COMPILER_ACTIVE" : complete && (clearance || isolatedLocalCustody) ? "SPAWN_ADMITTED" : "QA_READY");
  const governed = mode === "GOVERNED_SPAWN";
  assert(!(isolatedLocalCustody && !governed), "Isolated local custody requires governed-spawn mode");
  const localAdmission = governed && isolatedLocalCustody && complete;
  const lifecycle = {
    schema: AGENT_SPAWNER_LIFECYCLE_SCHEMA,
    version: AGENT_SPAWNER_LIFECYCLE_VERSION,
    lifecycle_id: lifecycleId,
    role_id: AGENT_SPAWNER_ROLE_ID,
    mode,
    state: derivedState,
    persistent_state: null,
    wave_activation: waveActivation,
    candidate_sha256: candidateSha256,
    roster_projection_sha256: rosterProjectionSha256,
    context_sha256: contextSha256,
    qa: structuredClone(qa),
    authority: {
      compiler_authority: true,
      temporary_worker_admission: governed && (clearance || localAdmission) && complete && (derivedState === "SPAWN_ADMITTED" || derivedState === "SPAWN_ACTIVE"),
      spawn_authority: governed && (clearance || localAdmission) && complete && (derivedState === "SPAWN_ADMITTED" || derivedState === "SPAWN_ACTIVE"),
      product_mutation: false,
      provider_access: false,
      credential_access: false,
      external_sync: false,
      isolated_local_custody: isolatedLocalCustody,
      independent_evaluation_required: true,
    },
    execution: structuredClone(execution),
    protected_hold_event_sha256: protectedHoldEventSha256,
    next_action: null,
    lifecycle_sha256: null,
  };
  lifecycle.persistent_state = derivePersistentState(lifecycle);
  lifecycle.next_action = deriveCompilerAction(lifecycle);
  lifecycle.lifecycle_sha256 = canonicalDigest(lifecycleBody(lifecycle));
  return validateAgentSpawnerLifecycle(lifecycle);
}

/*
 * The compiler is intentionally not allowed to admit workers itself.  Once it
 * emits ADMIT_GOVERNED_SPAWN, however, the Controller needs a concrete,
 * project-agnostic adapter rather than a prose handoff that can strand the
 * campaign.  This adapter performs only the bounded local transition: the
 * source roots remain preserved, the candidate is isolated, and every
 * provider/credential/product/external capability stays closed.  Protected
 * clearance is still required for any non-isolated route.
 */
export function admitAgentSpawnerIsolatedLocalCustody(lifecycle, {isolatedLocalCustody = true} = {}) {
  validateAgentSpawnerLifecycle(lifecycle);
  assert(lifecycle.mode === "COMPILER_ONLY", "Isolated governed admission must start from the compiler lifecycle");
  assert(lifecycle.state === "COMPILER_ACTIVE" && ["ADMIT_GOVERNED_SPAWN", "WAIT_FOR_INDEPENDENT_CLEARANCE"].includes(lifecycle.next_action), "Spawner is not at a governed-admission successor");
  assert(isolatedLocalCustody === true, "Isolated governed admission requires explicit local custody proof");
  assert(lifecycle.qa.incomplete_block_count === 0 && lifecycle.qa.pending_route_count === 0, "Isolated governed admission requires complete blocks and a published roster");
  return compileAgentSpawnerLifecycle({
    lifecycleId: lifecycle.lifecycle_id,
    mode: "GOVERNED_SPAWN",
    state: "SPAWN_ADMITTED",
    waveActivation: "OFF",
    candidateSha256: lifecycle.candidate_sha256,
    rosterProjectionSha256: lifecycle.roster_projection_sha256,
    contextSha256: lifecycle.context_sha256,
    isolatedLocalCustody: true,
    qa: structuredClone(lifecycle.qa),
    execution: structuredClone(lifecycle.execution),
  });
}

const ATOMIC_BRIDGE_REQUEST_KEYS = Object.freeze([
  "schema", "version", "request_id", "task_id", "role_id", "role_kind", "model", "reasoning_effort",
  "target", "cwd", "worktree", "custody_ref", "queue", "seam", "prompt_ref", "title",
]);
const ATOMIC_BRIDGE_TARGET_KEYS = Object.freeze(["projectId", "environment"]);
const ATOMIC_BRIDGE_RECEIPT_KEYS = Object.freeze([
  "schema", "version", "admission_id", "task_id", "role_id", "role_kind", "project_id", "environment", "cwd",
  "worktree", "custody_ref", "model", "reasoning_effort", "queue", "seam", "status", "host_readback_sha256",
  "task_index_readback_sha256", "state_readback_sha256", "process_readback_sha256", "existing_claims_readback_sha256",
  "existing_claims_authority", "existing_claims_provenance", "substantive_prompt_sent", "process_started", "cleanup_action",
  "retry_allowed", "material_transition", "hostile_fixture_refs", "receipt_sha256",
]);
const ATOMIC_BRIDGE_HOST_KEYS = Object.freeze([
  "schema", "version", "fresh", "project_id", "cwd", "role_id", "role_kind", "model", "reasoning_effort",
  "queue", "seam", "worktree", "custody_ref", "worktree_clean", "readback_sha256",
]);
const ATOMIC_BRIDGE_INDEX_KEYS = Object.freeze(["schema", "version", "fresh", "project_id", "cwd", "queue", "seam", "rows", "readback_sha256"]);
const ATOMIC_BRIDGE_ROW_KEYS = Object.freeze([
  "task_id", "role_id", "role_kind", "project_id", "cwd", "worktree", "custody_ref", "model", "reasoning_effort",
  "queue", "seam", "status", "lifecycle",
]);
const ATOMIC_BRIDGE_STATE_KEYS = Object.freeze([
  "schema", "version", "fresh", "task_id", "role_id", "role_kind", "project_id", "cwd", "worktree", "custody_ref",
  "model", "reasoning_effort", "queue", "seam", "status", "lifecycle", "substantive_prompt_sent", "process_started", "readback_sha256",
]);
const ATOMIC_BRIDGE_PROCESS_KEYS = Object.freeze(["schema", "version", "fresh", "processes", "readback_sha256"]);
const ATOMIC_BRIDGE_PROCESS_ITEM_KEYS = Object.freeze(["process_id", "task_id", "role_id", "worktree", "command"]);
const ATOMIC_BRIDGE_CLAIMS_KEYS = Object.freeze(["schema", "version", "fresh", "authority", "provenance", "claims", "readback_sha256"]);
const ATOMIC_BRIDGE_READBACK_SCHEMAS = Object.freeze({
  host: "agentos.agent_spawner_host_readback.v1",
  taskIndex: "agentos.agent_spawner_task_index_readback.v1",
  state: "agentos.agent_spawner_task_state_readback.v1",
  process: "agentos.agent_spawner_process_readback.v1",
  claims: "agentos.agent_spawner_identity_claims_readback.v1",
});
const ATOMIC_BRIDGE_READBACK_VERSION = 1;
const ATOMIC_BRIDGE_CLAIM_KEYS = Object.freeze(["kind", "identity", "status"]);
const ATOMIC_BRIDGE_FAILED_ROW_STATUSES = new Set(["FAILED", "ARCHIVED", "HELD"]);
const ATOMIC_BRIDGE_PRE_ADMISSION_STATUS = "PENDING";
const ATOMIC_BRIDGE_PRE_ADMISSION_LIFECYCLE = "PENDING";
const ATOMIC_BRIDGE_HOSTILE_FIXTURE_REFS = Object.freeze([
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

function bridgeAtomicText(value, label) {
  requireString(value, label);
}

function bridgeAtomicIdentifier(value, label) {
  bridgeAtomicText(value, label);
  assert(value.length <= 191, `${label} is too long`);
}

function bridgeAtomicAbsolutePath(value, label) {
  bridgeAtomicText(value, label);
  assert(value.startsWith("/") && value !== "/", `${label} must be an absolute non-root path`);
}

function bridgeAtomicCanonicalPath(value, label) {
  bridgeAtomicAbsolutePath(value, label);
  const root = path.parse(value).root;
  let current = root;
  for (const component of value.slice(root.length).split(path.sep)) {
    if (component === "" || component === ".") continue;
    if (component === "..") {
      current = path.dirname(current);
      continue;
    }
    const candidate = path.join(current, component);
    try {
      const stat = fs.lstatSync(candidate);
      current = stat.isSymbolicLink() ? fs.realpathSync.native(candidate) : candidate;
    } catch (error) {
      if (error?.code !== "ENOENT") throw new Error(`${label} cannot be canonicalized`);
      current = candidate;
    }
  }
  return current;
}

function bridgeAssertWorktreeWithinCwd(cwd, worktree) {
  const resolvedCwd = bridgeAtomicCanonicalPath(cwd, "Atomic admission cwd");
  const resolvedWorktree = bridgeAtomicCanonicalPath(worktree, "Atomic admission worktree");
  assert(resolvedCwd !== path.parse(resolvedCwd).root, "Atomic admission cwd resolves to the host root");
  assert(resolvedWorktree !== path.parse(resolvedWorktree).root, "Atomic admission worktree resolves to the host root");
  assert(resolvedWorktree === resolvedCwd || resolvedWorktree.startsWith(`${resolvedCwd}${path.sep}`), "Atomic admission worktree is outside the bound project cwd");
}

function bridgeAtomicReference(value, label) {
  assert(typeof value === "string" && /^(?:opaque:|ref:)[^\s]+$/u.test(value), `${label} must be an opaque reference`);
}

function validateAtomicAdmissionBridgeReceipt(receipt, readbacks) {
  exactKeys(receipt, ATOMIC_BRIDGE_RECEIPT_KEYS, "Atomic admission receipt");
  assert(receipt.schema === "agentos.agent_spawner_atomic_admission.v1" && receipt.version === 1, "Atomic admission receipt identity is invalid");
  assert(receipt.status === "ADMITTED" && receipt.environment === "local", "Atomic admission receipt status or environment is invalid");
  for (const field of ["admission_id", "task_id", "role_id", "role_kind", "project_id", "cwd", "worktree", "custody_ref", "model", "reasoning_effort", "queue", "seam", "material_transition"]) requireString(receipt[field], `Atomic admission receipt ${field}`);
  for (const field of ["host_readback_sha256", "task_index_readback_sha256", "state_readback_sha256", "process_readback_sha256", "existing_claims_readback_sha256"]) requireSha(receipt[field], `Atomic admission receipt ${field}`);
  assert(receipt.existing_claims_authority === "AGENTOS.SPAWNER.IDENTITY_CLAIMS_READBACK", "Atomic admission receipt existing claims authority is invalid");
  assert(typeof receipt.existing_claims_provenance === "string" && OPAQUE_REF.test(receipt.existing_claims_provenance), "Atomic admission receipt existing claims provenance is invalid");
  assert(receipt.substantive_prompt_sent === false && receipt.process_started === false && receipt.cleanup_action === "NONE" && receipt.retry_allowed === false, "Atomic admission receipt crossed the substantive-work boundary");
  assert(receipt.material_transition === "ADMISSION_RECORDED_NEXT_GOVERNED_ACTION", "Atomic admission receipt next transition is invalid");
  sortedIdentifiers(receipt.hostile_fixture_refs, "Atomic admission hostile fixtures");
  assert(JSON.stringify(receipt.hostile_fixture_refs) === JSON.stringify([...ATOMIC_BRIDGE_HOSTILE_FIXTURE_REFS]), "Atomic admission hostile fixture coverage is incomplete");
  requireSha(receipt.receipt_sha256, "Atomic admission receipt");
  assert(receipt.receipt_sha256 === canonicalDigest({...receipt, receipt_sha256: null}), "Atomic admission receipt digest mismatch");
  assert(isRecord(readbacks) && isRecord(readbacks.request), "Atomic admission request readback is required");
  exactKeys(readbacks.request, ATOMIC_BRIDGE_REQUEST_KEYS, "Atomic admission request");
  const request = readbacks.request;
  assert(request.schema === "agentos.agent_spawner_atomic_admission_request.v1" && request.version === 1, "Atomic admission request identity is invalid");
  exactKeys(request.target, ATOMIC_BRIDGE_TARGET_KEYS, "Atomic admission request target");
  for (const field of ["request_id", "task_id", "role_id", "role_kind", "queue", "seam"]) bridgeAtomicText(request[field], `Atomic admission request ${field}`);
  bridgeAtomicIdentifier(request.request_id, "Atomic admission request ID");
  bridgeAtomicIdentifier(request.role_id, "Atomic admission role ID");
  bridgeAtomicText(request.model, "Atomic admission model");
  bridgeAtomicText(request.reasoning_effort, "Atomic admission reasoning effort");
  assert(request.model === "gpt-5.6-luna" && request.reasoning_effort === "max", "Atomic admission model or reasoning effort is not admitted");
  bridgeAtomicText(request.target.projectId, "Atomic admission project ID");
  assert(request.target.environment === "local", "Atomic admission request target environment is invalid");
  bridgeAtomicAbsolutePath(request.cwd, "Atomic admission cwd");
  assert(request.cwd !== "/", "Atomic admission cwd cannot be the host root");
  bridgeAtomicAbsolutePath(request.worktree, "Atomic admission worktree");
  bridgeAssertWorktreeWithinCwd(request.cwd, request.worktree);
  bridgeAtomicReference(request.custody_ref, "Atomic admission custody reference");
  bridgeAtomicReference(request.prompt_ref, "Atomic admission prompt reference");
  bridgeAtomicText(request.title, "Atomic admission title");
  for (const [field, expected] of [["admission_id", request.request_id], ["task_id", request.task_id], ["role_id", request.role_id], ["role_kind", request.role_kind], ["project_id", request.target.projectId], ["cwd", request.cwd], ["worktree", request.worktree], ["custody_ref", request.custody_ref], ["model", request.model], ["reasoning_effort", request.reasoning_effort], ["queue", request.queue], ["seam", request.seam]]) assert(receipt[field] === expected, `Atomic admission receipt ${field} is not bound to the request`);
  const binding = readbacks.projectBinding;
  const bindingProjectId = binding?.project_id ?? binding?.projectId;
  assert(isRecord(binding) && typeof bindingProjectId === "string" && bindingProjectId.length > 0 && typeof binding.cwd === "string" && binding.cwd.length > 0, "Atomic admission authoritative project binding is required");
  assert((binding.environment === undefined || binding.environment === "local") && bindingProjectId === request.target.projectId && binding.cwd === request.cwd, "Atomic admission authoritative project binding is required");
  const digestReadback = (value, keys, expectedSchema, label) => {
    assert(isRecord(value), `${label} is required`);
    exactKeys(value, keys, label);
    assert(value.schema === expectedSchema && value.version === ATOMIC_BRIDGE_READBACK_VERSION, `${label} schema or version is invalid`);
    assert(value.fresh === true, `${label} must be fresh`);
    requireSha(value.readback_sha256, `${label} digest`);
    assert(value.readback_sha256 === canonicalDigest({...value, readback_sha256: null}), `${label} digest mismatch`);
    return value;
  };
  const host = digestReadback(readbacks.hostReadback, ATOMIC_BRIDGE_HOST_KEYS, ATOMIC_BRIDGE_READBACK_SCHEMAS.host, "Atomic host readback");
  for (const [field, expected] of [["project_id", request.target.projectId], ["cwd", request.cwd], ["role_id", request.role_id], ["role_kind", request.role_kind], ["model", request.model], ["reasoning_effort", request.reasoning_effort], ["queue", request.queue], ["seam", request.seam], ["worktree", request.worktree], ["custody_ref", request.custody_ref]]) assert(host[field] === expected, `host readback ${field} differs from the request`);
  assert(host.worktree_clean === true, "host readback does not prove clean custody");
  const index = digestReadback(readbacks.taskIndexReadback, ATOMIC_BRIDGE_INDEX_KEYS, ATOMIC_BRIDGE_READBACK_SCHEMAS.taskIndex, "Atomic task-index readback");
  assert(index.project_id === request.target.projectId && index.cwd === request.cwd && index.queue === request.queue && index.seam === request.seam && Array.isArray(index.rows), "task-index readback binding is invalid");
  index.rows.forEach((row, rowIndex) => {
    exactKeys(row, ATOMIC_BRIDGE_ROW_KEYS, `Atomic task-index row ${rowIndex}`);
    for (const field of ATOMIC_BRIDGE_ROW_KEYS) bridgeAtomicText(row[field], `Atomic task-index row ${rowIndex} ${field}`);
  });
  const targetRows = index.rows.filter((row) => row && row.task_id === request.task_id && row.status !== "FAILED" && row.status !== "ARCHIVED" && row.status !== "HELD" && row.lifecycle !== "FAILED" && row.lifecycle !== "ARCHIVED" && row.lifecycle !== "HELD");
  assert(targetRows.length === 1, "task-index must contain exactly one nonfailed target task row");
  exactKeys(targetRows[0], ATOMIC_BRIDGE_ROW_KEYS, "Atomic task-index target row");
  assert(targetRows[0].status === ATOMIC_BRIDGE_PRE_ADMISSION_STATUS && targetRows[0].lifecycle === ATOMIC_BRIDGE_PRE_ADMISSION_LIFECYCLE, "task-index target is not in the pre-admission state");
  for (const [field, expected] of [["role_id", request.role_id], ["role_kind", request.role_kind], ["project_id", request.target.projectId], ["cwd", request.cwd], ["worktree", request.worktree], ["custody_ref", request.custody_ref], ["model", request.model], ["reasoning_effort", request.reasoning_effort], ["queue", request.queue], ["seam", request.seam]]) assert(targetRows[0][field] === expected, `task-index target ${field} differs from the request`);
  const nonFailedRows = index.rows.filter((row) => !ATOMIC_BRIDGE_FAILED_ROW_STATUSES.has(row.status) && !ATOMIC_BRIDGE_FAILED_ROW_STATUSES.has(row.lifecycle));
  const seenIdentities = new Map(["task_id", "role_id", "worktree", "custody_ref"].map((field) => [field, new Set()]));
  for (const row of nonFailedRows) {
    for (const field of seenIdentities.keys()) {
      const identities = seenIdentities.get(field);
      assert(!identities.has(row[field]), `task-index contains a duplicate ${field} identity`);
      identities.add(row[field]);
    }
  }
  const state = digestReadback(readbacks.stateReadback, ATOMIC_BRIDGE_STATE_KEYS, ATOMIC_BRIDGE_READBACK_SCHEMAS.state, "Atomic task-state readback");
  for (const [field, expected] of [["task_id", request.task_id], ["role_id", request.role_id], ["role_kind", request.role_kind], ["project_id", request.target.projectId], ["cwd", request.cwd], ["worktree", request.worktree], ["custody_ref", request.custody_ref], ["model", request.model], ["reasoning_effort", request.reasoning_effort], ["queue", request.queue], ["seam", request.seam]]) assert(state[field] === expected, `task state ${field} differs from the request`);
  assert(state.status === ATOMIC_BRIDGE_PRE_ADMISSION_STATUS && state.lifecycle === ATOMIC_BRIDGE_PRE_ADMISSION_LIFECYCLE, "task state is not in the pre-admission state");
  assert(state.substantive_prompt_sent === false && state.process_started === false, "task state crossed the substantive-work boundary");
  const process = digestReadback(readbacks.processReadback, ATOMIC_BRIDGE_PROCESS_KEYS, ATOMIC_BRIDGE_READBACK_SCHEMAS.process, "Atomic process readback");
  assert(Array.isArray(process.processes), "process readback processes are required");
  const processIds = new Set();
  process.processes.forEach((entry, processIndex) => {
    exactKeys(entry, ATOMIC_BRIDGE_PROCESS_ITEM_KEYS, `Atomic process ${processIndex}`);
    for (const field of ATOMIC_BRIDGE_PROCESS_ITEM_KEYS) bridgeAtomicText(entry[field], `Atomic process ${processIndex} ${field}`);
    assert(!processIds.has(entry.process_id), "process readback contains a duplicate process identity");
    processIds.add(entry.process_id);
    assert(!(entry.task_id === request.task_id || entry.role_id === request.role_id || entry.worktree === request.worktree), "process readback contains a conflicting task, role, or worktree");
  });
  const claims = readbacks.existingClaims;
  assert(Array.isArray(claims), "Atomic existing identity claims readback is required");
  const claimsReadback = digestReadback(readbacks.existingClaimsReadback, ATOMIC_BRIDGE_CLAIMS_KEYS, ATOMIC_BRIDGE_READBACK_SCHEMAS.claims, "Atomic existing identity claims readback");
  assert(claimsReadback.authority === "AGENTOS.SPAWNER.IDENTITY_CLAIMS_READBACK" && OPAQUE_REF.test(claimsReadback.provenance), "Atomic existing identity claims readback authority/provenance is invalid");
  assert(Array.isArray(claimsReadback.claims) && JSON.stringify(claimsReadback.claims) === JSON.stringify(claims), "Atomic existing identity claims readback does not match supplied claims");
  const seenClaimIdentities = new Set();
  claims.forEach((claim, index) => {
    exactKeys(claim, ATOMIC_BRIDGE_CLAIM_KEYS, `Atomic existing claim ${index}`);
    for (const field of ATOMIC_BRIDGE_CLAIM_KEYS) bridgeAtomicText(claim[field], `Atomic existing claim ${index} ${field}`);
    if (!ATOMIC_BRIDGE_FAILED_ROW_STATUSES.has(claim.status)) {
      assert(!seenClaimIdentities.has(claim.identity), "existing identity claims contain a duplicate identity");
      seenClaimIdentities.add(claim.identity);
      assert(![request.task_id, request.role_id, request.worktree, request.custody_ref].includes(claim.identity), "existing identity claim collides with the requested admission");
    }
  });
  assert(receipt.host_readback_sha256 === host.readback_sha256 && receipt.task_index_readback_sha256 === index.readback_sha256 && receipt.state_readback_sha256 === state.readback_sha256 && receipt.process_readback_sha256 === process.readback_sha256, "Atomic admission receipt operational readback binding is stale");
  assert(receipt.existing_claims_readback_sha256 === claimsReadback.readback_sha256 && receipt.existing_claims_authority === claimsReadback.authority && receipt.existing_claims_provenance === claimsReadback.provenance, "Atomic admission receipt existing claims binding is stale");
}

/*
 * The governed-admission adapter records the host-bound admission receipt
 * separately from this lifecycle record.  This bridge is intentionally
 * non-mutating: it proves that the receipt belongs to the already admitted
 * governed lifecycle and exposes the one next action without starting a
 * worker.  All project/task/custody facts are compared from the receipt;
 * caller-supplied prompt text or a creation acknowledgement cannot stand in
 * for those persisted facts.
 */
export function recordAgentSpawnerAtomicAdmission(lifecycle, admissionReceipt, readbacks = null) {
  validateAgentSpawnerLifecycle(lifecycle);
  assert(isRecord(admissionReceipt), "Atomic admission receipt must be an object");
  assert(isRecord(readbacks), "Atomic admission fresh readbacks are required");
  assert(isRecord(readbacks.request) && isRecord(readbacks.hostReadback) && isRecord(readbacks.taskIndexReadback) && isRecord(readbacks.stateReadback) && isRecord(readbacks.processReadback) && isRecord(readbacks.existingClaimsReadback), "Atomic admission request and every operational readback are required");
  validateAtomicAdmissionBridgeReceipt(admissionReceipt, readbacks);
  assert(lifecycle.mode === "GOVERNED_SPAWN" && lifecycle.state === "SPAWN_ADMITTED" && lifecycle.next_action === "START_GOVERNED_SPAWN", "Atomic admission must follow the governed spawn admission lifecycle");
  assert(lifecycle.authority.product_mutation === false && lifecycle.authority.provider_access === false && lifecycle.authority.credential_access === false && lifecycle.authority.external_sync === false, "Atomic admission crossed a protected capability");
  return {
    accepted: true,
    status: "ATOMIC_ADMISSION_RECORDED",
    task_id: admissionReceipt.task_id,
    lifecycle_sha256: lifecycle.lifecycle_sha256,
    next_action: "START_GOVERNED_SPAWN",
    substantive_work_started: false,
  };
}

export const validateAgentSpawnerAtomicAdmissionTransition = recordAgentSpawnerAtomicAdmission;

function eventBody(event) {
  const body = structuredClone(event);
  body.event_sha256 = null;
  return body;
}

function validateEvent(event) {
  exactKeys(event, ["event_type", "event_sha256"], "Agent Spawner lifecycle event");
  assert(AGENT_SPAWNER_EVENT_TYPES.includes(event.event_type), "Agent Spawner lifecycle event type is invalid");
  requireSha(event.event_sha256, "Agent Spawner lifecycle event digest");
  assert(event.event_sha256 === canonicalDigest(eventBody(event)), "Agent Spawner lifecycle event digest mismatch");
}

export function advanceAgentSpawnerLifecycle(lifecycle, event) {
  validateAgentSpawnerLifecycle(lifecycle);
  validateEvent(event);
  const next = structuredClone(lifecycle);
  switch (event.event_type) {
    case "START_COMPILER":
      assert(lifecycle.mode === "COMPILER_ONLY", "Only compiler-only mode may start without spawn admission");
      assert(["PREPARED", "QA_READY", "STALLED"].includes(lifecycle.state), "Spawner cannot start compiler from its current state");
      next.state = "COMPILER_ACTIVE";
      next.protected_hold_event_sha256 = null;
      next.execution.compiler_ticks += 1;
      break;
    case "BLOCK_LIBRARY_UPDATED":
      assert(lifecycle.mode === "COMPILER_ONLY", "Block-library updates must use compiler-only mode");
      assert(lifecycle.state !== "RETIRED", "Retired Spawner cannot update its library");
      next.state = "COMPILER_ACTIVE";
      next.protected_hold_event_sha256 = null;
      next.execution.compiler_ticks += 1;
      break;
    case "INDEPENDENT_CLEARANCE_GRANTED":
      next.qa.independent_clearance_status = "CLEARED";
      next.qa.independent_clearance_receipt_sha256 = event.event_sha256;
      if (next.mode === "GOVERNED_SPAWN" && next.qa.incomplete_block_count === 0 && next.qa.pending_route_count === 0) {
        next.state = "SPAWN_ADMITTED";
        next.authority.temporary_worker_admission = true;
        next.authority.spawn_authority = true;
      }
      break;
    case "ADMIT_GOVERNED_SPAWN":
      assert(lifecycle.mode === "GOVERNED_SPAWN", "Governed spawn admission requires governed-spawn mode");
      assert(lifecycle.qa.incomplete_block_count === 0 && lifecycle.qa.pending_route_count === 0 && (lifecycle.qa.independent_clearance_status === "CLEARED" || lifecycle.authority.isolated_local_custody === true), "Governed spawn admission requires complete blocks, a published roster, and clearance or isolated local custody");
      next.state = "SPAWN_ADMITTED";
      next.authority.temporary_worker_admission = true;
      next.authority.spawn_authority = true;
      break;
    case "START_GOVERNED_SPAWN":
      assert(lifecycle.state === "SPAWN_ADMITTED", "Governed spawn must be admitted before activation");
      assert(lifecycle.authority.spawn_authority === true, "Governed spawn lacks spawn authority");
      next.state = "SPAWN_ACTIVE";
      next.wave_activation = "ON";
      break;
    case "PROTECTED_HOLD":
      assert(lifecycle.state !== "RETIRED", "Retired Spawner cannot enter a protected hold");
      assert(lifecycle.mode === "GOVERNED_SPAWN", "Compiler-only Spawner cannot enter a protected hold");
      assert(lifecycle.qa.incomplete_block_count === 0 && lifecycle.qa.pending_route_count === 0, "Protected Spawner hold cannot hide local block or roster work");
      assert(lifecycle.qa.independent_clearance_status === "PENDING_EXTERNAL_AUTHORITY", "Protected Spawner hold requires a pending external decision");
      next.state = "STALLED";
      next.protected_hold_event_sha256 = event.event_sha256;
      next.authority.temporary_worker_admission = false;
      next.authority.spawn_authority = false;
      next.wave_activation = "OFF";
      next.execution.active_worker_count = 0;
      next.execution.scheduler_job_count = 0;
      next.execution.heavyweight_process_count = 0;
      next.execution.timer_count = 0;
      next.execution.polling = false;
      break;
    case "RETIRE":
      next.state = "RETIRED";
      next.protected_hold_event_sha256 = null;
      next.authority.temporary_worker_admission = false;
      next.authority.spawn_authority = false;
      next.wave_activation = "OFF";
      next.execution.active_worker_count = 0;
      next.execution.scheduler_job_count = 0;
      next.execution.heavyweight_process_count = 0;
      next.execution.timer_count = 0;
      next.execution.polling = false;
      break;
    default:
      assert(false, "Unhandled Agent Spawner lifecycle event");
  }
  next.persistent_state = derivePersistentState(next);
  next.next_action = deriveCompilerAction(next);
  next.lifecycle_sha256 = canonicalDigest(lifecycleBody(next));
  return validateAgentSpawnerLifecycle(next);
}

function continuationBody(continuation) {
  const body = structuredClone(continuation);
  body.continuation_sha256 = null;
  return body;
}

function progressDeltaBody({lifecycleBeforeSha256, lifecycleAfterSha256, outcome, action, changedFields}) {
  return {lifecycle_before_sha256: lifecycleBeforeSha256, lifecycle_after_sha256: lifecycleAfterSha256, outcome, action, changed_fields: changedFields};
}

function validateContinuationEvidence(evidenceRefs) {
  assert(Array.isArray(evidenceRefs) && evidenceRefs.length > 0, "Compiler continuation evidence refs are required");
  const ordered = [...evidenceRefs].sort((left, right) => compareUtf8(left.evidence_id, right.evidence_id));
  assert(JSON.stringify(evidenceRefs) === JSON.stringify(ordered), "Compiler continuation evidence refs must be sorted");
  const ids = new Set();
  for (const [index, evidence] of evidenceRefs.entries()) {
    exactKeys(evidence, ["evidence_id", "reference", "sha256"], `Compiler continuation evidence ${index}`);
    requireIdentifier(evidence.evidence_id, `Compiler continuation evidence ${index} ID`);
    assert(!ids.has(evidence.evidence_id), `Compiler continuation evidence ${index} is duplicated`);
    ids.add(evidence.evidence_id);
    assert(typeof evidence.reference === "string" && OPAQUE_REF.test(evidence.reference), `Compiler continuation evidence ${index} reference is invalid`);
    requireSha(evidence.sha256, `Compiler continuation evidence ${index} digest`);
  }
}

function changedLifecycleFields(before, after) {
  return ["candidate_sha256", "roster_projection_sha256", "context_sha256", "qa", "state", "persistent_state", "wave_activation", "execution", "protected_hold_event_sha256", "next_action"]
    .filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]))
    .sort(compareUtf8);
}

function nextCompilerContinuationAction(lifecycle) {
  if (lifecycle.next_action === "COMPILE_NEXT_BLOCK") return "COMPILE_NEXT_BLOCK";
  if (lifecycle.next_action === "PUBLISH_TYPED_ROSTER") return "PUBLISH_TYPED_ROSTER";
  if (lifecycle.next_action === "WAIT_FOR_INDEPENDENT_CLEARANCE" || lifecycle.next_action === "WAIT_FOR_OWNER_OR_PROTECTED_DEPENDENCY_EVENT") return "WAIT_FOR_PROTECTED_EVENT";
  if (lifecycle.next_action === "ADMIT_GOVERNED_SPAWN") return "ADMIT_GOVERNED_SPAWN";
  throw new Error("Compiler continuation cannot bind an unsafe lifecycle successor");
}

function validateCompilerSemanticProgress(lifecycleBefore, lifecycleAfter, outcome) {
  if (outcome === "BLOCK_COMPILED") {
    const reducedIncompleteBlocks = lifecycleAfter.qa.incomplete_block_count < lifecycleBefore.qa.incomplete_block_count;
    const advancedCompileRoute = lifecycleBefore.next_action === "COMPILE_NEXT_BLOCK" && lifecycleAfter.next_action !== "COMPILE_NEXT_BLOCK";
    assert(reducedIncompleteBlocks || advancedCompileRoute, "BLOCK_COMPILED must reduce incomplete_block_count or advance the bound compile route");
    return;
  }
  if (outcome === "TYPED_ROSTER_PUBLISHED") {
    const reducedPendingRoutes = lifecycleAfter.qa.pending_route_count < lifecycleBefore.qa.pending_route_count;
    const advancedRosterRoute = lifecycleBefore.next_action === "PUBLISH_TYPED_ROSTER" && lifecycleAfter.next_action !== "PUBLISH_TYPED_ROSTER";
    assert(reducedPendingRoutes || advancedRosterRoute, "TYPED_ROSTER_PUBLISHED must reduce pending_route_count or advance beyond the publish route");
    return;
  }
  assert(outcome === "PROTECTED_EVENT_WAIT", "Only PROTECTED_EVENT_WAIT may represent a protected compiler outcome");
}

function validateCompilerTickResult(result, action, lifecycleBefore) {
  exactKeys(result, ["outcome", "lifecycle_after", "evidence_refs", "hostile_fixture_refs"], "Agent Spawner compiler tick result");
  const expectedOutcome = action === "COMPILE_NEXT_BLOCK" ? "BLOCK_COMPILED" : "TYPED_ROSTER_PUBLISHED";
  assert(result.outcome === expectedOutcome, `Compiler tick outcome must be ${expectedOutcome}`);
  validateAgentSpawnerLifecycle(result.lifecycle_after);
  validateCompilerSemanticProgress(lifecycleBefore, result.lifecycle_after, result.outcome);
  validateContinuationEvidence(result.evidence_refs);
  sortedIdentifiers(result.hostile_fixture_refs, "Compiler continuation hostile fixtures");
  assert(result.hostile_fixture_refs.length > 0, "Compiler continuation hostile fixtures are required");
}

export function validateAgentSpawnerCompilerContinuation(continuation) {
  exactKeys(continuation, [
    "schema", "version", "role_id", "outcome", "action", "lifecycle_before_sha256", "lifecycle_after_sha256",
    "progress_delta_sha256", "changed_fields", "evidence_refs", "hostile_fixture_refs", "next_action",
    "continuation", "authority", "admission", "continuation_sha256",
  ], "Agent Spawner compiler continuation");
  assert(continuation.schema === AGENT_SPAWNER_COMPILER_CONTINUATION_SCHEMA && continuation.version === AGENT_SPAWNER_COMPILER_CONTINUATION_VERSION, "Compiler continuation identity is invalid");
  assert(continuation.role_id === AGENT_SPAWNER_ROLE_ID, "Compiler continuation role identity is invalid");
  assert(AGENT_SPAWNER_COMPILER_OUTCOMES.includes(continuation.outcome), "Compiler continuation outcome is invalid");
  assert(AGENT_SPAWNER_COMPILER_CONTINUATION_ACTIONS.includes(continuation.action), "Compiler continuation action is invalid");
  requireSha(continuation.lifecycle_before_sha256, "Compiler continuation lifecycle-before digest");
  requireSha(continuation.lifecycle_after_sha256, "Compiler continuation lifecycle-after digest");
  requireSha(continuation.progress_delta_sha256, "Compiler continuation progress delta digest");
  sortedFieldNames(continuation.changed_fields, "Compiler continuation changed fields");
  assert(continuation.changed_fields.length > 0, "Compiler continuation requires a real progress delta");
  validateContinuationEvidence(continuation.evidence_refs);
  sortedIdentifiers(continuation.hostile_fixture_refs, "Compiler continuation hostile fixtures");
  assert(continuation.hostile_fixture_refs.length > 0, "Compiler continuation hostile fixtures are required");
  assert(AGENT_SPAWNER_COMPILER_NEXT_ACTIONS.includes(continuation.next_action), "Compiler continuation next action is invalid");
  exactKeys(continuation.continuation, ["mode", "timer_deferral", "heartbeat_deferral", "same_turn_next_action", "protected_event_id", "resume_condition"], "Compiler continuation continuation");
  assert(continuation.continuation.mode === "EVENT_DRIVEN_AUTOMATIC", "Compiler continuation mode is invalid");
  assert(continuation.continuation.timer_deferral === false && continuation.continuation.heartbeat_deferral === false, "Compiler continuation cannot defer to a timer or heartbeat");
  assert(continuation.continuation.same_turn_next_action === true, "Compiler continuation must bind the next action");
  if (continuation.next_action === "WAIT_FOR_PROTECTED_EVENT") requireIdentifier(continuation.continuation.protected_event_id, "Compiler continuation protected event");
  else assert(continuation.continuation.protected_event_id === null, "Non-protected compiler continuation cannot bind a protected event");
  requireString(continuation.continuation.resume_condition, "Compiler continuation resume condition");
  if (continuation.next_action === "ADMIT_GOVERNED_SPAWN") assert(continuation.continuation.resume_condition === "Hand off to governed admission; adapter/readback still required.", "Governed admission successor lacks the explicit adapter/readback boundary");
  exactKeys(continuation.authority, ["compiler_only", "admission", "activation", "product_mutation", "provider_access", "credential_access"], "Compiler continuation authority");
  assert(continuation.authority.compiler_only === true, "Compiler continuation must remain compiler-only");
  for (const field of ["admission", "activation", "product_mutation", "provider_access", "credential_access"]) assert(continuation.authority[field] === false, `Compiler continuation crossed protected boundary: ${field}`);
  exactKeys(continuation.admission, ["spawnable", "wave_activation"], "Compiler continuation admission");
  assert(continuation.admission.spawnable === false && continuation.admission.wave_activation === "OFF", "Compiler continuation cannot admit or activate");
  assert(continuation.progress_delta_sha256 === canonicalDigest(progressDeltaBody({
    lifecycleBeforeSha256: continuation.lifecycle_before_sha256,
    lifecycleAfterSha256: continuation.lifecycle_after_sha256,
    outcome: continuation.outcome,
    action: continuation.action,
    changedFields: continuation.changed_fields,
  })), "Compiler continuation progress delta digest mismatch");
  requireSha(continuation.continuation_sha256, "Compiler continuation digest");
  assert(continuation.continuation_sha256 === canonicalDigest(continuationBody(continuation)), "Compiler continuation digest mismatch");
  if (continuation.outcome === "PROTECTED_EVENT_WAIT") {
    assert(continuation.action === "WAIT_FOR_INDEPENDENT_CLEARANCE" && continuation.next_action === "WAIT_FOR_PROTECTED_EVENT", "Protected compiler continuation binding is invalid");
  } else if (continuation.outcome === "BLOCK_COMPILED") {
    assert(continuation.action === "COMPILE_NEXT_BLOCK", "Block continuation action is invalid");
  } else {
    assert(continuation.action === "PUBLISH_TYPED_ROSTER", "Roster continuation action is invalid");
  }
  return continuation;
}

function compileAgentSpawnerCompilerContinuation({lifecycle, action, outcome, lifecycleAfter, evidenceRefs, hostileFixtureRefs, protectedEventId = null} = {}) {
  validateAgentSpawnerLifecycle(lifecycle);
  validateAgentSpawnerLifecycle(lifecycleAfter);
  assert(lifecycle.mode === "COMPILER_ONLY" && lifecycleAfter.mode === "COMPILER_ONLY", "Compiler continuation requires compiler-only lifecycle states");
  assert(lifecycleAfter.execution.active_worker_count === 0 && lifecycleAfter.execution.scheduler_job_count === 0 && lifecycleAfter.execution.heavyweight_process_count === 0, "Compiler continuation cannot carry worker or heavyweight execution");
  assert(lifecycleAfter.execution.timer_count === 0 && lifecycleAfter.execution.polling === false, "Compiler continuation cannot carry timers or polling");
  assert(lifecycleAfter.lifecycle_sha256 !== lifecycle.lifecycle_sha256, "Compiler continuation requires a real lifecycle progress delta");
  const changedFields = changedLifecycleFields(lifecycle, lifecycleAfter);
  assert(changedFields.length > 0, "Compiler continuation requires a meaningful lifecycle change");
  const nextAction = nextCompilerContinuationAction(lifecycleAfter);
  const continuation = {
    schema: AGENT_SPAWNER_COMPILER_CONTINUATION_SCHEMA,
    version: AGENT_SPAWNER_COMPILER_CONTINUATION_VERSION,
    role_id: AGENT_SPAWNER_ROLE_ID,
    outcome,
    action,
    lifecycle_before_sha256: lifecycle.lifecycle_sha256,
    lifecycle_after_sha256: lifecycleAfter.lifecycle_sha256,
    progress_delta_sha256: canonicalDigest(progressDeltaBody({lifecycleBeforeSha256: lifecycle.lifecycle_sha256, lifecycleAfterSha256: lifecycleAfter.lifecycle_sha256, outcome, action, changedFields})),
    changed_fields: changedFields,
    evidence_refs: [...evidenceRefs].sort((left, right) => compareUtf8(left.evidence_id, right.evidence_id)),
    hostile_fixture_refs: [...hostileFixtureRefs].sort(compareUtf8),
    next_action: nextAction,
    continuation: {
      mode: "EVENT_DRIVEN_AUTOMATIC",
      timer_deferral: false,
      heartbeat_deferral: false,
      same_turn_next_action: true,
      protected_event_id: nextAction === "WAIT_FOR_PROTECTED_EVENT" ? protectedEventId : null,
      resume_condition: nextAction === "WAIT_FOR_PROTECTED_EVENT"
        ? "Resume only on the explicitly bound protected event; owner resumption is not clearance."
        : nextAction === "ADMIT_GOVERNED_SPAWN"
          ? "Hand off to governed admission; adapter/readback still required."
          : "Start the bound local compiler action in the same continuation.",
    },
    authority: {compiler_only: true, admission: false, activation: false, product_mutation: false, provider_access: false, credential_access: false},
    admission: {spawnable: false, wave_activation: "OFF"},
    continuation_sha256: null,
  };
  continuation.continuation_sha256 = canonicalDigest(continuationBody(continuation));
  return validateAgentSpawnerCompilerContinuation(continuation);
}

export function runAgentSpawnerCompilerTick(lifecycle, {onCompileBlock = null, onPublishRoster = null, protectedEventId = "INDEPENDENT.UTILITY_HARM_CLEARANCE"} = {}) {
  validateAgentSpawnerLifecycle(lifecycle);
  assert(lifecycle.mode === "COMPILER_ONLY" && lifecycle.state === "COMPILER_ACTIVE", "Spawner compiler tick requires COMPILER_ACTIVE compiler-only state");
  if (lifecycle.next_action === "COMPILE_NEXT_BLOCK") {
    assert(typeof onCompileBlock === "function", "Compiler tick requires a block compiler callback");
    const result = onCompileBlock({role_id: AGENT_SPAWNER_ROLE_ID, action: lifecycle.next_action, lifecycle_before_sha256: lifecycle.lifecycle_sha256, product_mutation: false, spawn_authority: false});
    validateCompilerTickResult(result, lifecycle.next_action, lifecycle);
    return compileAgentSpawnerCompilerContinuation({lifecycle, action: lifecycle.next_action, outcome: result.outcome, lifecycleAfter: result.lifecycle_after, evidenceRefs: result.evidence_refs, hostileFixtureRefs: result.hostile_fixture_refs, protectedEventId});
  }
  if (lifecycle.next_action === "PUBLISH_TYPED_ROSTER") {
    assert(typeof onPublishRoster === "function", "Compiler tick requires a typed roster callback");
    const result = onPublishRoster({role_id: AGENT_SPAWNER_ROLE_ID, action: lifecycle.next_action, lifecycle_before_sha256: lifecycle.lifecycle_sha256, product_mutation: false, spawn_authority: false});
    validateCompilerTickResult(result, lifecycle.next_action, lifecycle);
    return compileAgentSpawnerCompilerContinuation({lifecycle, action: lifecycle.next_action, outcome: result.outcome, lifecycleAfter: result.lifecycle_after, evidenceRefs: result.evidence_refs, hostileFixtureRefs: result.hostile_fixture_refs, protectedEventId});
  }
  if (lifecycle.next_action === "WAIT_FOR_INDEPENDENT_CLEARANCE") {
    assert(lifecycle.qa.incomplete_block_count === 0 && lifecycle.qa.pending_route_count === 0, "Protected compiler wait cannot hide local block or roster work");
    requireIdentifier(protectedEventId, "Compiler protected event");
    const event = {event_type: "PROTECTED_HOLD", event_sha256: canonicalDigest({event_type: "PROTECTED_HOLD", event_sha256: null})};
    const lifecycleAfter = advanceAgentSpawnerLifecycle(lifecycle, event);
    const evidenceDigest = canonicalDigest({lifecycle_sha256: lifecycle.lifecycle_sha256, protected_event_id: protectedEventId});
    return compileAgentSpawnerCompilerContinuation({
      lifecycle,
      action: lifecycle.next_action,
      outcome: "PROTECTED_EVENT_WAIT",
      lifecycleAfter,
      evidenceRefs: [{evidence_id: "EVIDENCE.SPAWNER.PROTECTED.CLEARANCE.PENDING", reference: `opaque:lifecycle:${evidenceDigest}`, sha256: evidenceDigest}],
      hostileFixtureRefs: ["FIXTURE.SPAWNER.PROTECTED_EVENT.ADMISSION_BYPASS", "FIXTURE.SPAWNER.PROTECTED_EVENT.HEARTBEAT_DEFERRAL", "FIXTURE.SPAWNER.PROTECTED_EVENT.TIMER_DEFERRAL"],
      protectedEventId,
    });
  }
  if (lifecycle.next_action === "ADMIT_GOVERNED_SPAWN") throw new Error("Compiler tick must hand off to governed admission adapter/readback; compiler cannot admit or activate");
  assert(SAFE_COMPILER_ACTIONS.has(lifecycle.next_action), "Compiler tick has an unsafe action");
  throw new Error("Compiler tick cannot close without a typed continuation");
}

/*
 * Controller-owned storage governance is deliberately separate from the
 * Spawner's compiler state machine.  A storage reading is an observation,
 * not a worker admission signal: only the Controller may produce the daily
 * receipt and only a typed threshold transition may affect next-issue
 * admission.  Keeping this contract here lets the lifecycle and its schema
 * travel together without making ordinary agents poll the host.
 */
export const AGENT_SPAWNER_STORAGE_GOVERNANCE_SCHEMA = "agentos.agent_spawner_storage_governance.v1";
export const AGENT_SPAWNER_STORAGE_GOVERNANCE_VERSION = 1;
export const AGENT_SPAWNER_STORAGE_POLICY = Object.freeze({
  monitor_owner: "CONTROLLER_ONLY",
  monitor_interval_hours: 24,
  ordinary_agents_poll_storage: false,
  cleanup_target_free_gib: Object.freeze({minimum: 80, maximum: 100, work_stopping_floor: false}),
  owner_warning_at_or_below_free_gib: 50,
  hard_operating_floor_at_or_below_free_gib: 25,
  below_target_current_issue_transition: Object.freeze([
    "FINISH_AND_VERIFY_CURRENT_ISSUE",
    "FREEZE_EXACT_CANDIDATE",
    "HANDOFF_AND_COMPLETE_AUTHORIZED_RUNTIME_DELIVERY",
    "ADMIT_NO_NEXT_ISSUE",
    "CONTROLLER_RUNS_CUSTODY_SAFE_CLEANUP_TOWARD_80_TO_100_GIB",
    "RESUME_NEXT_ISSUE_AFTER_CLEANUP_TRANSITION_CLOSES",
  ]),
  cleanup_safety: Object.freeze({
    preserve_active_or_unmerged_work: true,
    ambiguous_custody_cleanup_forbidden: true,
    allowed_classes: Object.freeze([
      "PROVEN_SAFE_DISPOSABLE_DATA",
      "STALE_CACHES",
      "REDUNDANT_BUILD_OUTPUTS",
      "CLEAN_RELEASED_WORKTREES",
    ]),
  }),
});
export const AGENT_SPAWNER_STORAGE_HOSTILE_FIXTURE_REFS = Object.freeze([
  "FIXTURE.STORAGE.79_GIB_ORDINARY_COMPILE_AND_TEST",
  "FIXTURE.STORAGE.79_GIB_CONTROLLER_DAILY_CLEANUP",
  "FIXTURE.STORAGE.CLEANUP_FAILURE_ALERT_RESUME_ABOVE_25",
  "FIXTURE.STORAGE.50_GIB_OWNER_WARNING",
  "FIXTURE.STORAGE.25_GIB_HARD_STOP",
  "FIXTURE.STORAGE.ORDINARY_AGENT_POLL_REJECTED",
  "FIXTURE.STORAGE.DUPLICATE_DAILY_CHECK_REJECTED",
  "FIXTURE.STORAGE.AMBIGUOUS_CUSTODY_CLEANUP_REJECTED",
  "FIXTURE.STORAGE.NEXT_ISSUE_DURING_CLEANUP_REJECTED",
  "FIXTURE.STORAGE.HISTORICAL_RECEIPT_CANNOT_OVERRIDE",
]);
export const CONTROLLER_STORAGE_HOSTILE_FIXTURE_REFS = AGENT_SPAWNER_STORAGE_HOSTILE_FIXTURE_REFS;

const STORAGE_THRESHOLD_CLASSES = Object.freeze([
  "HARD_FLOOR",
  "OWNER_WARNING",
  "BELOW_CLEANUP_TARGET",
  "CLEANUP_TARGET",
  "ABOVE_CLEANUP_TARGET",
]);
const STORAGE_DECISION_KEYS = Object.freeze([
  "schema", "version", "receipt_id", "monitor_role", "observed_at_utc", "free_gib", "threshold_class",
  "policy", "current_issue", "next_issue", "cleanup", "ordinary_agents", "custody", "previous_receipt_sha256",
  "hostile_fixture_refs", "receipt_sha256",
]);
const STORAGE_POLICY_KEYS = Object.freeze([
  "monitor_owner", "monitor_interval_hours", "ordinary_agents_poll_storage", "cleanup_target_free_gib",
  "owner_warning_at_or_below_free_gib", "hard_operating_floor_at_or_below_free_gib",
  "below_target_current_issue_transition", "cleanup_safety",
]);
const STORAGE_CURRENT_ISSUE_KEYS = Object.freeze([
  "status", "work_allowed", "storage_heavy_work_allowed", "finish_verify_freeze_handoff_required", "runtime_delivery_allowed",
]);
const STORAGE_NEXT_ISSUE_KEYS = Object.freeze(["admission", "allowed", "blocked_reason"]);
const STORAGE_CLEANUP_KEYS = Object.freeze([
  "required", "action", "target_min_gib", "target_max_gib", "attempted", "reached_target", "owner_alert", "resume_above_gib",
]);
const STORAGE_ORDINARY_AGENT_KEYS = Object.freeze(["polling_allowed", "decision"]);
const STORAGE_CUSTODY_KEYS = Object.freeze(["active_or_unmerged_preserved", "ambiguous_custody_cleanup_forbidden", "cleanup_allowed"]);
const STORAGE_SHA256 = /^[0-9a-f]{64}$/u;
const STORAGE_IDENTIFIER = /^[A-Z][A-Z0-9._:-]{0,191}$/u;
const STORAGE_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

function storageRequireSha(value, label, {nullable = false} = {}) {
  if (nullable && value === null) return;
  assert(typeof value === "string" && STORAGE_SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function storageExactKeys(value, expected, label) {
  exactKeys(value, expected, label);
}

function storageRequireFiniteGib(value) {
  assert(typeof value === "number" && Number.isFinite(value) && value >= 0, "Controller storage free_gib must be a non-negative finite number");
}

function storageDecisionBody(decision) {
  const body = structuredClone(decision);
  body.receipt_sha256 = null;
  return body;
}

function storageThresholdClass(freeGib) {
  if (freeGib <= AGENT_SPAWNER_STORAGE_POLICY.hard_operating_floor_at_or_below_free_gib) return "HARD_FLOOR";
  if (freeGib <= AGENT_SPAWNER_STORAGE_POLICY.owner_warning_at_or_below_free_gib) return "OWNER_WARNING";
  if (freeGib < AGENT_SPAWNER_STORAGE_POLICY.cleanup_target_free_gib.minimum) return "BELOW_CLEANUP_TARGET";
  if (freeGib <= AGENT_SPAWNER_STORAGE_POLICY.cleanup_target_free_gib.maximum) return "CLEANUP_TARGET";
  return "ABOVE_CLEANUP_TARGET";
}

function storageTransitionFor(freeGib, {
  currentIssueStatus = "ACTIVE",
  currentIssueCustody = "ACTIVE",
  nextIssueRequested = false,
  cleanupAttempted = false,
  cleanupReachedTarget = null,
  cleanupFailed = false,
} = {}) {
  storageRequireFiniteGib(freeGib);
  assert(typeof currentIssueStatus === "string" && currentIssueStatus.length > 0, "Controller current issue status is required");
  assert(typeof currentIssueCustody === "string" && currentIssueCustody.length > 0, "Controller current issue custody is required");
  assert(typeof nextIssueRequested === "boolean", "Controller next-issue request must be boolean");
  assert(typeof cleanupAttempted === "boolean", "Controller cleanup attempted flag must be boolean");
  assert(cleanupReachedTarget === null || typeof cleanupReachedTarget === "boolean", "Controller cleanup target result must be boolean or null");
  assert(typeof cleanupFailed === "boolean", "Controller cleanup failure flag must be boolean");
  const thresholdClass = storageThresholdClass(freeGib);
  const hardFloor = thresholdClass === "HARD_FLOOR";
  const belowTarget = hardFloor || thresholdClass === "OWNER_WARNING" || thresholdClass === "BELOW_CLEANUP_TARGET";
  const protectedCustody = ["ACTIVE", "UNMERGED", "AMBIGUOUS", "UNKNOWN"].includes(currentIssueCustody);
  if (cleanupAttempted && protectedCustody) throw new Error("Ambiguous or active custody cleanup is rejected");
  if (cleanupFailed && cleanupReachedTarget === true) throw new Error("Cleanup result cannot be both failed and at target");
  const ownerAlert = hardFloor || thresholdClass === "OWNER_WARNING" || cleanupFailed;
  const currentIssue = hardFloor
    ? {
      status: currentIssueStatus,
      work_allowed: false,
      storage_heavy_work_allowed: false,
      finish_verify_freeze_handoff_required: true,
      runtime_delivery_allowed: false,
    }
    : {
      status: currentIssueStatus,
      work_allowed: true,
      storage_heavy_work_allowed: true,
      finish_verify_freeze_handoff_required: belowTarget,
      runtime_delivery_allowed: belowTarget,
    };
  const nextBlocked = hardFloor || belowTarget || cleanupAttempted && cleanupReachedTarget !== true;
  if (nextIssueRequested && nextBlocked) throw new Error("Next issue admission is rejected while Controller cleanup transition is open");
  const nextIssue = {
    admission: nextBlocked ? (hardFloor ? "DENY_HARD_OPERATING_FLOOR" : "DENY_DURING_CLEANUP") : "ADMIT_AFTER_DAILY_TRANSITION",
    allowed: !nextBlocked,
    blocked_reason: nextBlocked ? (hardFloor ? "FREE_GIB_AT_OR_BELOW_25_HARD_OPERATING_FLOOR" : "BELOW_80_CLEANUP_TARGET_CONTROLLER_TRANSITION") : null,
  };
  const cleanupRequired = belowTarget && !hardFloor;
  const cleanup = {
    required: cleanupRequired || hardFloor,
    action: hardFloor
      ? "ALERT_OWNER_AND_WAIT_FOR_RECOVERY_AUTHORITY"
      : belowTarget
        ? "CONTROLLER_RUNS_CUSTODY_SAFE_CLEANUP_TOWARD_80_TO_100_GIB"
        : "NO_CLEANUP_REQUIRED",
    target_min_gib: AGENT_SPAWNER_STORAGE_POLICY.cleanup_target_free_gib.minimum,
    target_max_gib: AGENT_SPAWNER_STORAGE_POLICY.cleanup_target_free_gib.maximum,
    attempted: cleanupAttempted,
    reached_target: cleanupReachedTarget,
    owner_alert: ownerAlert,
    resume_above_gib: AGENT_SPAWNER_STORAGE_POLICY.hard_operating_floor_at_or_below_free_gib,
  };
  return {thresholdClass, currentIssue, nextIssue, cleanup, ownerAlert, protectedCustody};
}

function validateStoragePolicy(policy) {
  storageExactKeys(policy, STORAGE_POLICY_KEYS, "Controller storage policy");
  assert(policy.monitor_owner === "CONTROLLER_ONLY", "Controller storage monitor owner is invalid");
  assert(policy.monitor_interval_hours === 24, "Controller storage monitor interval is invalid");
  assert(policy.ordinary_agents_poll_storage === false, "Ordinary agents may not poll storage");
  storageExactKeys(policy.cleanup_target_free_gib, ["minimum", "maximum", "work_stopping_floor"], "Controller cleanup target");
  assert(policy.cleanup_target_free_gib.minimum === 80 && policy.cleanup_target_free_gib.maximum === 100 && policy.cleanup_target_free_gib.work_stopping_floor === false, "Controller cleanup target policy is invalid");
  assert(policy.owner_warning_at_or_below_free_gib === 50, "Controller owner warning threshold is invalid");
  assert(policy.hard_operating_floor_at_or_below_free_gib === 25, "Controller hard operating floor is invalid");
  assert(Array.isArray(policy.below_target_current_issue_transition) && JSON.stringify(policy.below_target_current_issue_transition) === JSON.stringify(AGENT_SPAWNER_STORAGE_POLICY.below_target_current_issue_transition), "Controller below-target transition is invalid");
  storageExactKeys(policy.cleanup_safety, ["preserve_active_or_unmerged_work", "ambiguous_custody_cleanup_forbidden", "allowed_classes"], "Controller cleanup safety");
  assert(policy.cleanup_safety.preserve_active_or_unmerged_work === true && policy.cleanup_safety.ambiguous_custody_cleanup_forbidden === true, "Controller cleanup safety boundary is invalid");
  assert(JSON.stringify(policy.cleanup_safety.allowed_classes) === JSON.stringify(AGENT_SPAWNER_STORAGE_POLICY.cleanup_safety.allowed_classes), "Controller cleanup classes are invalid");
}

function validateStorageDecisionParts(decision) {
  storageExactKeys(decision.policy, STORAGE_POLICY_KEYS, "Controller storage decision policy");
  validateStoragePolicy(decision.policy);
  storageExactKeys(decision.current_issue, STORAGE_CURRENT_ISSUE_KEYS, "Controller current issue storage transition");
  storageExactKeys(decision.next_issue, STORAGE_NEXT_ISSUE_KEYS, "Controller next issue storage transition");
  storageExactKeys(decision.cleanup, STORAGE_CLEANUP_KEYS, "Controller cleanup transition");
  storageExactKeys(decision.ordinary_agents, STORAGE_ORDINARY_AGENT_KEYS, "Controller ordinary-agent storage rule");
  storageExactKeys(decision.custody, STORAGE_CUSTODY_KEYS, "Controller storage custody");
  for (const field of ["work_allowed", "storage_heavy_work_allowed", "finish_verify_freeze_handoff_required", "runtime_delivery_allowed"]) assert(typeof decision.current_issue[field] === "boolean", `Controller current issue ${field} must be boolean`);
  assert(typeof decision.next_issue.allowed === "boolean", "Controller next issue allowed must be boolean");
  if (decision.next_issue.allowed) assert(decision.next_issue.blocked_reason === null, "Allowed next issue cannot have a blocked reason");
  else assert(typeof decision.next_issue.blocked_reason === "string", "Denied next issue requires a blocked reason");
  for (const field of ["required", "attempted", "owner_alert"]) assert(typeof decision.cleanup[field] === "boolean", `Controller cleanup ${field} must be boolean`);
  assert(decision.cleanup.action === "NO_CLEANUP_REQUIRED" || decision.cleanup.action === "CONTROLLER_RUNS_CUSTODY_SAFE_CLEANUP_TOWARD_80_TO_100_GIB" || decision.cleanup.action === "ALERT_OWNER_AND_WAIT_FOR_RECOVERY_AUTHORITY", "Controller cleanup action is invalid");
  assert(Number.isSafeInteger(decision.cleanup.target_min_gib) && decision.cleanup.target_min_gib === 80, "Controller cleanup minimum is invalid");
  assert(Number.isSafeInteger(decision.cleanup.target_max_gib) && decision.cleanup.target_max_gib === 100, "Controller cleanup maximum is invalid");
  assert(decision.cleanup.reached_target === null || typeof decision.cleanup.reached_target === "boolean", "Controller cleanup target result is invalid");
  assert(decision.cleanup.resume_above_gib === 25, "Controller cleanup resume floor is invalid");
  assert(decision.ordinary_agents.polling_allowed === false && decision.ordinary_agents.decision === "REJECT_REPEATED_STORAGE_POLL", "Ordinary-agent polling rule is invalid");
  assert(decision.custody.active_or_unmerged_preserved === true && decision.custody.ambiguous_custody_cleanup_forbidden === true, "Controller storage custody preservation is invalid");
  if (decision.threshold_class === "HARD_FLOOR") assert(decision.custody.cleanup_allowed === false, "Hard-floor cleanup custody must remain closed");
}

export function validateControllerStorageDecision(decision, {previousReceipt = null, nowMs = null} = {}) {
  storageExactKeys(decision, STORAGE_DECISION_KEYS, "Controller storage decision");
  assert(decision.schema === AGENT_SPAWNER_STORAGE_GOVERNANCE_SCHEMA && decision.version === AGENT_SPAWNER_STORAGE_GOVERNANCE_VERSION, "Controller storage decision identity is invalid");
  assert(typeof decision.receipt_id === "string" && STORAGE_IDENTIFIER.test(decision.receipt_id), "Controller storage receipt ID is invalid");
  assert(decision.monitor_role === "CONTROLLER", "Controller storage receipt must be Controller-owned");
  assert(typeof decision.observed_at_utc === "string" && STORAGE_TIMESTAMP.test(decision.observed_at_utc), "Controller storage observation timestamp is invalid");
  storageRequireFiniteGib(decision.free_gib);
  assert(STORAGE_THRESHOLD_CLASSES.includes(decision.threshold_class), "Controller storage threshold class is invalid");
  assert(decision.threshold_class === storageThresholdClass(decision.free_gib), "Controller storage threshold class is stale");
  validateStorageDecisionParts(decision);
  assert(decision.hostile_fixture_refs && JSON.stringify(decision.hostile_fixture_refs) === JSON.stringify(AGENT_SPAWNER_STORAGE_HOSTILE_FIXTURE_REFS), "Controller storage hostile coverage is incomplete");
  storageRequireSha(decision.previous_receipt_sha256, "Controller previous storage receipt", {nullable: true});
  storageRequireSha(decision.receipt_sha256, "Controller storage receipt digest");
  assert(decision.receipt_sha256 === canonicalDigest(storageDecisionBody(decision)), "Controller storage receipt digest mismatch");
  if (previousReceipt !== null) {
    validateControllerStorageDecision(previousReceipt);
    assert(decision.previous_receipt_sha256 === previousReceipt.receipt_sha256, "Controller storage receipt parent is stale");
    const elapsed = Date.parse(decision.observed_at_utc) - Date.parse(previousReceipt.observed_at_utc);
    assert(elapsed >= AGENT_SPAWNER_STORAGE_POLICY.monitor_interval_hours * 60 * 60 * 1000, "Controller daily storage check is duplicated or too early");
    if (nowMs !== null) assert(Date.parse(decision.observed_at_utc) <= nowMs, "Controller storage observation is from the future");
  }
  // A parent digest may be carried without its payload when the caller is
  // crossing a custody boundary.  When the parent payload is available, the
  // elapsed-window and exact parent binding above are enforced.
  return decision;
}

export function compileControllerStorageDecision({
  receiptId,
  observedAtUtc,
  freeGib,
  currentIssueStatus = "ACTIVE",
  currentIssueCustody = "ACTIVE",
  nextIssueRequested = false,
  cleanupAttempted = false,
  cleanupReachedTarget = null,
  cleanupFailed = false,
  previousReceiptSha256 = null,
  previousReceipt = null,
  actorRole = "CONTROLLER",
  storagePoll = false,
} = {}) {
  assert(actorRole === "CONTROLLER", "Only the Controller may produce a daily storage receipt");
  assert(storagePoll === false, "Ordinary-agent repeated storage polling is rejected");
  assert(typeof receiptId === "string" && STORAGE_IDENTIFIER.test(receiptId), "Controller storage receipt ID is invalid");
  assert(typeof observedAtUtc === "string" && STORAGE_TIMESTAMP.test(observedAtUtc), "Controller storage observation timestamp is invalid");
  if (previousReceipt !== null) {
    validateControllerStorageDecision(previousReceipt);
    if (previousReceiptSha256 !== null) assert(previousReceiptSha256 === previousReceipt.receipt_sha256, "Controller previous storage receipt digest differs from bound receipt");
    previousReceiptSha256 = previousReceipt.receipt_sha256;
    assert(Date.parse(observedAtUtc) - Date.parse(previousReceipt.observed_at_utc) >= AGENT_SPAWNER_STORAGE_POLICY.monitor_interval_hours * 60 * 60 * 1000, "Controller daily storage check is duplicated or too early");
  }
  storageRequireSha(previousReceiptSha256, "Controller previous storage receipt", {nullable: true});
  const transition = storageTransitionFor(freeGib, {currentIssueStatus, currentIssueCustody, nextIssueRequested, cleanupAttempted, cleanupReachedTarget, cleanupFailed});
  const decision = {
    schema: AGENT_SPAWNER_STORAGE_GOVERNANCE_SCHEMA,
    version: AGENT_SPAWNER_STORAGE_GOVERNANCE_VERSION,
    receipt_id: receiptId,
    monitor_role: "CONTROLLER",
    observed_at_utc: observedAtUtc,
    free_gib: freeGib,
    threshold_class: transition.thresholdClass,
    policy: structuredClone(AGENT_SPAWNER_STORAGE_POLICY),
    current_issue: transition.currentIssue,
    next_issue: transition.nextIssue,
    cleanup: transition.cleanup,
    ordinary_agents: {polling_allowed: false, decision: "REJECT_REPEATED_STORAGE_POLL"},
    custody: {
      active_or_unmerged_preserved: true,
      ambiguous_custody_cleanup_forbidden: true,
    cleanup_allowed: !transition.protectedCustody && transition.thresholdClass !== "HARD_FLOOR",
    },
    previous_receipt_sha256: previousReceiptSha256,
    hostile_fixture_refs: [...AGENT_SPAWNER_STORAGE_HOSTILE_FIXTURE_REFS],
    receipt_sha256: null,
  };
  decision.receipt_sha256 = canonicalDigest(storageDecisionBody(decision));
  return validateControllerStorageDecision(decision, {previousReceipt});
}

export const compileControllerDailyStorageReceipt = compileControllerStorageDecision;
export const validateControllerDailyStorageReceipt = validateControllerStorageDecision;
export const evaluateControllerStorageDecision = storageTransitionFor;
export const deriveControllerStorageDecision = compileControllerStorageDecision;
export const compileAgentSpawnerStorageGovernance = compileControllerStorageDecision;
export const validateAgentSpawnerStorageGovernance = validateControllerStorageDecision;
export const STORAGE_POLICY = AGENT_SPAWNER_STORAGE_POLICY;
export const STORAGE_HOSTILE_FIXTURE_REFS = AGENT_SPAWNER_STORAGE_HOSTILE_FIXTURE_REFS;

export function advanceControllerStorageDecision(previousReceipt, options = {}) {
  validateControllerStorageDecision(previousReceipt);
  return compileControllerStorageDecision({...options, previousReceipt});
}

export const advanceControllerStorageGovernance = advanceControllerStorageDecision;

/*
 * Immutable audit-routing receipt contract.
 *
 * A routing receipt names the exact bytes of the final audit receipt, while a
 * route payload is a separate immutable message sent to the consumer.  The
 * receipt itself is always FINALIZED and never changes to represent routing;
 * corrections therefore use a distinct successor receipt path.  Keeping the
 * two records separate makes a same-path post-route edit observable as either
 * a raw-byte digest mismatch or a receipt/payload identity mismatch.
 */
const ROUTING_RECEIPT_KEYS = Object.freeze([
  "schema", "version", "routing_receipt_id", "route_id", "recipient_ref", "receipt_path", "final_receipt_ref",
  "final_receipt_bytes_sha256", "final_receipt_bytes_verified", "status", "finalized_before_route", "route_emitted",
  "post_route_mutation_forbidden", "historical_receipt_ref", "historical_receipt_bytes_sha256", "successor_receipt_ref",
  "fresh_replacement_authority_sha256", "product_verdict_inherited", "product_verdict", "hostile_fixture_refs", "receipt_sha256",
]);
const ROUTING_PAYLOAD_KEYS = Object.freeze([
  "schema", "version", "route_id", "recipient_ref", "routing_receipt_ref", "routing_receipt_sha256", "receipt_path",
  "final_receipt_ref", "final_receipt_bytes_sha256", "finalized_before_route", "same_path_mutation_forbidden",
  "replacement_audit_requires_fresh_authority", "payload_sha256",
]);

export class AgentSpawnerRoutingReceiptProvenanceError extends Error {
  constructor(message) {
    super(`${AGENT_SPAWNER_ROUTING_RECEIPT_PROVENANCE_BLOCKER}: ${message}`);
    this.name = "AgentSpawnerRoutingReceiptProvenanceError";
    this.code = AGENT_SPAWNER_ROUTING_RECEIPT_PROVENANCE_BLOCKER;
  }
}

function routingBlocker(condition, message) {
  if (!condition) throw new AgentSpawnerRoutingReceiptProvenanceError(message);
}

function routingSha(value, label) {
  routingBlocker(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function routingIdentifier(value, label) {
  routingBlocker(typeof value === "string" && IDENTIFIER.test(value), `${label} must be a stable identifier`);
}

function routingReference(value, label) {
  routingBlocker(typeof value === "string" && OPAQUE_REF.test(value), `${label} must be an opaque control reference`);
}

function routingBytes(value, label) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === "string") return Buffer.from(value, "utf8");
  throw new AgentSpawnerRoutingReceiptProvenanceError(`${label} must be exact UTF-8 bytes, a Buffer, or a Uint8Array`);
}

function routingRawSha(value, label) {
  const bytes = routingBytes(value, label);
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function routingReceiptBody(receipt) {
  const body = structuredClone(receipt);
  body.receipt_sha256 = null;
  return body;
}

function routingPayloadBody(payload) {
  const body = structuredClone(payload);
  body.payload_sha256 = null;
  return body;
}

function validateRoutingHostileRefs(refs) {
  routingBlocker(Array.isArray(refs), "routing receipt hostile fixture refs are required");
  routingBlocker(JSON.stringify(refs) === JSON.stringify([...AGENT_SPAWNER_ROUTING_HOSTILE_FIXTURE_REFS]), "routing receipt hostile fixture coverage is incomplete");
}

function resolveFinalReceiptBytesSha256({finalReceiptBytes, finalReceiptBytesSha256}) {
  const hasBytes = finalReceiptBytes !== undefined && finalReceiptBytes !== null;
  if (hasBytes) {
    const computed = routingRawSha(finalReceiptBytes, "final receipt bytes");
    if (finalReceiptBytesSha256 !== undefined && finalReceiptBytesSha256 !== null) {
      routingSha(finalReceiptBytesSha256, "final receipt bytes digest");
      routingBlocker(computed === finalReceiptBytesSha256, "final receipt bytes digest does not match the supplied immutable bytes");
    }
    return {sha256: computed, verified: true};
  }
  routingSha(finalReceiptBytesSha256, "final receipt bytes digest");
  return {sha256: finalReceiptBytesSha256, verified: false};
}

function validateRoutingCorrectionFields(receipt) {
  const hasHistory = receipt.historical_receipt_ref !== null;
  if (!hasHistory) {
    routingBlocker(receipt.historical_receipt_bytes_sha256 === null, "historical receipt digest is present without a historical receipt reference");
    routingBlocker(receipt.successor_receipt_ref === null, "successor receipt reference is present on an original receipt");
    routingBlocker(receipt.fresh_replacement_authority_sha256 === null, "replacement authority is present on an original receipt");
    return;
  }
  routingReference(receipt.historical_receipt_ref, "historical receipt reference");
  routingSha(receipt.historical_receipt_bytes_sha256, "historical receipt bytes digest");
  routingReference(receipt.successor_receipt_ref, "successor receipt reference");
  routingReference(receipt.receipt_path, "receipt path");
  routingBlocker(receipt.successor_receipt_ref === receipt.receipt_path, "successor receipt reference must identify the current distinct receipt path");
  routingBlocker(receipt.historical_receipt_ref !== receipt.receipt_path, "a correction may not reuse the historical receipt path");
  routingSha(receipt.fresh_replacement_authority_sha256, "fresh replacement-audit authority digest");
}

export function validateAgentSpawnerRoutingReceipt(receipt) {
  try {
    exactKeys(receipt, ROUTING_RECEIPT_KEYS, "Agent Spawner routing receipt");
  } catch (error) {
    throw new AgentSpawnerRoutingReceiptProvenanceError(error.message);
  }
  routingBlocker(receipt.schema === AGENT_SPAWNER_ROUTING_RECEIPT_SCHEMA && receipt.version === AGENT_SPAWNER_ROUTING_RECEIPT_VERSION, "routing receipt identity is invalid");
  routingIdentifier(receipt.routing_receipt_id, "routing receipt ID");
  routingIdentifier(receipt.route_id, "routing route ID");
  routingReference(receipt.recipient_ref, "routing recipient reference");
  routingReference(receipt.receipt_path, "routing receipt path");
  routingReference(receipt.final_receipt_ref, "final receipt reference");
  routingSha(receipt.final_receipt_bytes_sha256, "final receipt bytes digest");
  routingBlocker(typeof receipt.final_receipt_bytes_verified === "boolean", "final receipt byte-validation state is invalid");
  routingBlocker(AGENT_SPAWNER_ROUTING_RECEIPT_STATUSES.includes(receipt.status), "routing receipt status is invalid");
  routingBlocker(receipt.finalized_before_route === true, "routing receipt must be finalized before routing");
  routingBlocker(receipt.route_emitted === false, "a finalized receipt may not be mutated to record route emission");
  routingBlocker(receipt.post_route_mutation_forbidden === true, "post-route mutation protection is required");
  routingBlocker(receipt.product_verdict_inherited === false, "a routing receipt may not inherit a product verdict");
  routingBlocker(receipt.product_verdict === null, "product verdict must remain unset on a routing receipt");
  validateRoutingCorrectionFields(receipt);
  validateRoutingHostileRefs(receipt.hostile_fixture_refs);
  routingSha(receipt.receipt_sha256, "routing receipt digest");
  routingBlocker(receipt.receipt_sha256 === canonicalDigest(routingReceiptBody(receipt)), "routing receipt digest mismatch");
  return receipt;
}

export function compileAgentSpawnerRoutingReceipt({
  routingReceiptId,
  routeId,
  recipientRef,
  receiptPath,
  finalReceiptRef,
  finalReceiptBytes,
  finalReceiptBytesSha256,
  correctionOf = null,
  historicalReceiptRef = null,
  historicalReceiptBytesSha256 = null,
  freshReplacementAuthoritySha256 = null,
} = {}) {
  routingIdentifier(routingReceiptId, "routing receipt ID");
  routingIdentifier(routeId, "routing route ID");
  routingReference(recipientRef, "routing recipient reference");
  routingReference(receiptPath, "routing receipt path");
  routingReference(finalReceiptRef, "final receipt reference");
  const finalBytes = resolveFinalReceiptBytesSha256({finalReceiptBytes, finalReceiptBytesSha256});
  let historicalRef = historicalReceiptRef;
  let historicalSha = historicalReceiptBytesSha256;
  let successorRef = null;
  let replacementAuthority = freshReplacementAuthoritySha256;
  if (correctionOf !== null) {
    validateAgentSpawnerRoutingReceipt(correctionOf);
    historicalRef = correctionOf.receipt_path;
    historicalSha = correctionOf.final_receipt_bytes_sha256;
    successorRef = receiptPath;
    routingSha(replacementAuthority, "fresh replacement-audit authority digest");
    routingBlocker(replacementAuthority !== null, "fresh replacement-audit authority is required for a correction");
    routingBlocker(receiptPath !== historicalRef, "a correction must use a distinct successor receipt path");
  }
  const receipt = {
    schema: AGENT_SPAWNER_ROUTING_RECEIPT_SCHEMA,
    version: AGENT_SPAWNER_ROUTING_RECEIPT_VERSION,
    routing_receipt_id: routingReceiptId,
    route_id: routeId,
    recipient_ref: recipientRef,
    receipt_path: receiptPath,
    final_receipt_ref: finalReceiptRef,
    final_receipt_bytes_sha256: finalBytes.sha256,
    final_receipt_bytes_verified: finalBytes.verified,
    status: "FINALIZED",
    finalized_before_route: true,
    route_emitted: false,
    post_route_mutation_forbidden: true,
    historical_receipt_ref: historicalRef,
    historical_receipt_bytes_sha256: historicalSha,
    successor_receipt_ref: successorRef,
    fresh_replacement_authority_sha256: replacementAuthority,
    product_verdict_inherited: false,
    product_verdict: null,
    hostile_fixture_refs: [...AGENT_SPAWNER_ROUTING_HOSTILE_FIXTURE_REFS],
    receipt_sha256: null,
  };
  receipt.receipt_sha256 = canonicalDigest(routingReceiptBody(receipt));
  return validateAgentSpawnerRoutingReceipt(receipt);
}

export function finalizeAgentSpawnerRoutingReceipt(receipt, {finalReceiptBytes} = {}) {
  validateAgentSpawnerRoutingReceipt(receipt);
  routingBlocker(receipt.route_emitted === false, "a routed receipt path cannot be finalized again");
  routingBlocker(receipt.final_receipt_bytes_verified === false, "a byte-validated receipt cannot be finalized again; use a distinct successor receipt with fresh replacement authority");
  const finalBytes = resolveFinalReceiptBytesSha256({finalReceiptBytes});
  routingBlocker(finalBytes.verified, "exact final receipt bytes are required before route emission");
  const next = structuredClone(receipt);
  next.final_receipt_bytes_sha256 = finalBytes.sha256;
  next.final_receipt_bytes_verified = true;
  next.receipt_sha256 = canonicalDigest(routingReceiptBody(next));
  return validateAgentSpawnerRoutingReceipt(next);
}

export function compileAgentSpawnerRoutingRoutePayload(receipt) {
  validateAgentSpawnerRoutingReceipt(receipt);
  routingBlocker(receipt.final_receipt_bytes_verified === true, "route payload requires byte-validated final receipt");
  const payload = {
    schema: AGENT_SPAWNER_ROUTING_RECEIPT_SCHEMA,
    version: AGENT_SPAWNER_ROUTING_RECEIPT_VERSION,
    route_id: receipt.route_id,
    recipient_ref: receipt.recipient_ref,
    routing_receipt_ref: receipt.receipt_path,
    routing_receipt_sha256: receipt.receipt_sha256,
    receipt_path: receipt.receipt_path,
    final_receipt_ref: receipt.final_receipt_ref,
    final_receipt_bytes_sha256: receipt.final_receipt_bytes_sha256,
    finalized_before_route: true,
    same_path_mutation_forbidden: true,
    replacement_audit_requires_fresh_authority: true,
    payload_sha256: null,
  };
  payload.payload_sha256 = canonicalDigest(routingPayloadBody(payload));
  return payload;
}

function validateRoutingPayload(payload) {
  try {
    exactKeys(payload, ROUTING_PAYLOAD_KEYS, "Agent Spawner routing payload");
  } catch (error) {
    throw new AgentSpawnerRoutingReceiptProvenanceError(error.message);
  }
  routingBlocker(payload.schema === AGENT_SPAWNER_ROUTING_RECEIPT_SCHEMA && payload.version === AGENT_SPAWNER_ROUTING_RECEIPT_VERSION, "routing payload identity is invalid");
  routingIdentifier(payload.route_id, "routing payload route ID");
  routingReference(payload.recipient_ref, "routing payload recipient reference");
  routingReference(payload.routing_receipt_ref, "routing payload receipt reference");
  routingSha(payload.routing_receipt_sha256, "routing payload receipt digest");
  routingReference(payload.receipt_path, "routing payload receipt path");
  routingReference(payload.final_receipt_ref, "routing payload final receipt reference");
  routingSha(payload.final_receipt_bytes_sha256, "routing payload final receipt bytes digest");
  routingBlocker(payload.finalized_before_route === true, "routing payload must bind a finalized receipt");
  routingBlocker(payload.same_path_mutation_forbidden === true, "routing payload must forbid same-path mutation");
  routingBlocker(payload.replacement_audit_requires_fresh_authority === true, "routing payload must require fresh replacement authority");
  routingSha(payload.payload_sha256, "routing payload digest");
  routingBlocker(payload.payload_sha256 === canonicalDigest(routingPayloadBody(payload)), "routing payload digest mismatch");
  return payload;
}

export function validateAgentSpawnerRouteConsumer({receipt, routePayload, finalReceiptBytes, observedReceiptPath = null} = {}) {
  validateAgentSpawnerRoutingReceipt(receipt);
  validateRoutingPayload(routePayload);
  routingBlocker(routePayload.route_id === receipt.route_id, "route payload route identity differs from the finalized receipt");
  routingBlocker(routePayload.recipient_ref === receipt.recipient_ref, "route payload recipient differs from the finalized receipt");
  routingBlocker(routePayload.routing_receipt_ref === receipt.receipt_path && routePayload.receipt_path === receipt.receipt_path, "route payload receipt path differs from the finalized receipt");
  routingBlocker(routePayload.routing_receipt_sha256 === receipt.receipt_sha256, "route payload carries a stale routing receipt digest");
  routingBlocker(routePayload.final_receipt_ref === receipt.final_receipt_ref, "route payload final receipt reference differs from the finalized receipt");
  routingBlocker(routePayload.final_receipt_bytes_sha256 === receipt.final_receipt_bytes_sha256, "route payload carries a stale final receipt bytes digest");
  const actualPath = observedReceiptPath ?? receipt.receipt_path;
  routingBlocker(actualPath === receipt.receipt_path, "same-path post-route mutation or receipt-path substitution detected");
  routingBlocker(finalReceiptBytes !== undefined && finalReceiptBytes !== null, "consumer must recompute the exact final receipt bytes digest");
  const computedFinalSha = routingRawSha(finalReceiptBytes, "consumer final receipt bytes");
  routingBlocker(computedFinalSha === routePayload.final_receipt_bytes_sha256, "consumer final receipt bytes digest disagrees with the routed payload");
  return {accepted: true, status: "ROUTING_RECEIPT_CONSUMER_VERIFIED", receipt_sha256: receipt.receipt_sha256, final_receipt_bytes_sha256: computedFinalSha};
}

export function correctAgentSpawnerRoutingReceipt(previousReceipt, options = {}) {
  validateAgentSpawnerRoutingReceipt(previousReceipt);
  routingBlocker(options.receiptPath !== previousReceipt.receipt_path, "replacement audit must use a distinct successor receipt path");
  routingSha(options.freshReplacementAuthoritySha256, "fresh replacement-audit authority digest");
  routingBlocker(options.freshReplacementAuthoritySha256 !== null && options.freshReplacementAuthoritySha256 !== undefined, "explicit fresh replacement-audit authority is required");
  const next = compileAgentSpawnerRoutingReceipt({...options, correctionOf: previousReceipt});
  routingBlocker(next.historical_receipt_ref === previousReceipt.receipt_path, "historical receipt identity was not preserved");
  routingBlocker(next.product_verdict_inherited === false && next.product_verdict === null, "replacement receipt inherited a product verdict");
  return next;
}

// Short aliases keep the public contract easy to consume without exposing a
// second implementation or allowing callers to bypass the strict validators.
export const compileRoutingReceipt = compileAgentSpawnerRoutingReceipt;
export const validateRoutingReceipt = validateAgentSpawnerRoutingReceipt;
export const finalizeRoutingReceipt = finalizeAgentSpawnerRoutingReceipt;
export const compileRoutingRoutePayload = compileAgentSpawnerRoutingRoutePayload;
export const validateRoutingRouteConsumer = validateAgentSpawnerRouteConsumer;
export const correctRoutingReceipt = correctAgentSpawnerRoutingReceipt;
