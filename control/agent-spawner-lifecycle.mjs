/*
 * Project-agnostic Agent Spawner lifecycle.
 *
 * The compiler is a persistent, no-side-effect role.  It may remain alive in
 * COMPILER_ONLY mode while independent admission is pending, but that state
 * can never be mistaken for permission to spawn workers or mutate a product.
 */

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
export const AGENT_SPAWNER_PERSISTENT_STATES = Object.freeze(["PREPARED", "QA_READY", "ADMITTED", "ACTIVE", "STALLED"]);
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

const IDENTIFIER = /^[A-Z][A-Z0-9._:-]{0,191}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
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
    if (lifecycle.qa.independent_clearance_status !== "CLEARED") return "WAIT_FOR_INDEPENDENT_CLEARANCE";
    return "PUBLISH_TYPED_ROSTER";
  }
  if (lifecycle.state === "QA_READY") return "ADMIT_GOVERNED_SPAWN";
  if (lifecycle.state === "SPAWN_ADMITTED") return "START_GOVERNED_SPAWN";
  if (lifecycle.state === "SPAWN_ACTIVE") return "START_GOVERNED_SPAWN";
  return "START_COMPILER";
}

function derivePersistentState(lifecycle) {
  if (lifecycle.state === "PREPARED") return "PREPARED";
  if (lifecycle.state === "QA_READY") return "QA_READY";
  if (lifecycle.state === "SPAWN_ADMITTED") return "ADMITTED";
  if (lifecycle.state === "SPAWN_ACTIVE") return "ACTIVE";
  if (lifecycle.state === "STALLED" || lifecycle.state === "RETIRED") return "STALLED";
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
    "provider_access", "credential_access", "external_sync", "independent_evaluation_required",
  ], "Agent Spawner authority");
  assert(typeof authority.compiler_authority === "boolean", "Agent Spawner compiler authority is invalid");
  for (const field of ["temporary_worker_admission", "spawn_authority", "product_mutation", "provider_access", "credential_access", "external_sync", "independent_evaluation_required"]) assert(typeof authority[field] === "boolean", `Agent Spawner ${field} authority is invalid`);
  assert(authority.compiler_authority === true, "Agent Spawner compiler authority is required");
  if (lifecycle.mode === "COMPILER_ONLY") {
    assert(authority.temporary_worker_admission === false && authority.spawn_authority === false, "Compiler-only Spawner cannot admit or spawn workers");
    assert(authority.product_mutation === false && authority.provider_access === false && authority.credential_access === false && authority.external_sync === false, "Compiler-only Spawner crossed a protected boundary");
  }
  if (authority.spawn_authority) {
    assert(lifecycle.mode === "GOVERNED_SPAWN", "Spawn authority requires governed-spawn mode");
    assert(authority.temporary_worker_admission === true, "Spawn authority requires worker admission");
    assert(lifecycle.qa.independent_clearance_status === "CLEARED", "Spawn authority requires independent clearance");
    assert(lifecycle.qa.incomplete_block_count === 0, "Spawn authority cannot use incomplete blocks");
  }
}

function validateExecution(execution, lifecycle) {
  exactKeys(execution, ["compiler_ticks", "active_worker_count", "scheduler_job_count", "heavyweight_process_count", "timer_count", "polling"], "Agent Spawner execution");
  for (const field of ["compiler_ticks", "active_worker_count", "scheduler_job_count", "heavyweight_process_count", "timer_count"]) requireNonNegativeInteger(execution[field], `Agent Spawner execution ${field}`);
  assert(typeof execution.polling === "boolean", "Agent Spawner polling state is invalid");
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
    "roster_projection_sha256", "context_sha256", "qa", "authority", "execution", "next_action",
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
  validateQa(lifecycle.qa);
  validateAuthority(lifecycle.authority, lifecycle);
  validateExecution(lifecycle.execution, lifecycle);
  assert(AGENT_SPAWNER_NEXT_ACTIONS.includes(lifecycle.next_action), "Agent Spawner next action is invalid");
  assert(lifecycle.next_action === deriveCompilerAction(lifecycle), "Agent Spawner next action does not match lifecycle state");
  if (lifecycle.state === "COMPILER_ACTIVE") assert(lifecycle.mode === "COMPILER_ONLY", "Compiler-active state requires compiler-only mode");
  if (lifecycle.state === "SPAWN_ADMITTED" || lifecycle.state === "SPAWN_ACTIVE") {
    assert(lifecycle.mode === "GOVERNED_SPAWN", "Governed spawn state requires governed-spawn mode");
    assert(lifecycle.authority.spawn_authority === true, "Governed spawn state lacks spawn authority");
  }
  if (lifecycle.qa.independent_clearance_status === "PENDING_EXTERNAL_AUTHORITY") {
    assert(!(lifecycle.mode === "GOVERNED_SPAWN" && (lifecycle.state === "SPAWN_ADMITTED" || lifecycle.state === "SPAWN_ACTIVE")), "Pending utility/harm cannot admit or activate governed spawning");
    assert(lifecycle.persistent_state !== "ACTIVE" && lifecycle.wave_activation === "OFF", "Pending utility/harm must keep governed activation off");
  }
  if (lifecycle.wave_activation === "ON") {
    assert(lifecycle.mode === "GOVERNED_SPAWN" && lifecycle.state === "SPAWN_ACTIVE", "Wave activation requires governed active spawn");
    assert(lifecycle.qa.independent_clearance_status === "CLEARED", "Wave activation requires independent clearance");
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
  execution = {compiler_ticks: 0, active_worker_count: 0, scheduler_job_count: 0, heavyweight_process_count: 0, timer_count: 0, polling: false},
} = {}) {
  requireIdentifier(lifecycleId, "Agent Spawner lifecycle ID");
  assert(AGENT_SPAWNER_MODES.includes(mode), "Agent Spawner mode is invalid");
  const complete = qa.incomplete_block_count === 0;
  const clearance = qa.independent_clearance_status === "CLEARED";
  const derivedState = state ?? (mode === "COMPILER_ONLY" ? "COMPILER_ACTIVE" : complete && clearance ? "SPAWN_ADMITTED" : "QA_READY");
  const governed = mode === "GOVERNED_SPAWN";
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
      temporary_worker_admission: governed && clearance && complete && (derivedState === "SPAWN_ADMITTED" || derivedState === "SPAWN_ACTIVE"),
      spawn_authority: governed && clearance && complete && (derivedState === "SPAWN_ADMITTED" || derivedState === "SPAWN_ACTIVE"),
      product_mutation: false,
      provider_access: false,
      credential_access: false,
      external_sync: false,
      independent_evaluation_required: true,
    },
    execution: structuredClone(execution),
    next_action: null,
    lifecycle_sha256: null,
  };
  lifecycle.persistent_state = derivePersistentState(lifecycle);
  lifecycle.next_action = deriveCompilerAction(lifecycle);
  lifecycle.lifecycle_sha256 = canonicalDigest(lifecycleBody(lifecycle));
  return validateAgentSpawnerLifecycle(lifecycle);
}

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
      next.execution.compiler_ticks += 1;
      break;
    case "BLOCK_LIBRARY_UPDATED":
      assert(lifecycle.mode === "COMPILER_ONLY", "Block-library updates must use compiler-only mode");
      assert(lifecycle.state !== "RETIRED", "Retired Spawner cannot update its library");
      next.state = "COMPILER_ACTIVE";
      next.execution.compiler_ticks += 1;
      break;
    case "INDEPENDENT_CLEARANCE_GRANTED":
      next.qa.independent_clearance_status = "CLEARED";
      next.qa.independent_clearance_receipt_sha256 = event.event_sha256;
      if (next.mode === "GOVERNED_SPAWN" && next.qa.incomplete_block_count === 0) {
        next.state = "SPAWN_ADMITTED";
        next.authority.temporary_worker_admission = true;
        next.authority.spawn_authority = true;
      }
      break;
    case "ADMIT_GOVERNED_SPAWN":
      assert(lifecycle.mode === "GOVERNED_SPAWN", "Governed spawn admission requires governed-spawn mode");
      assert(lifecycle.qa.incomplete_block_count === 0 && lifecycle.qa.independent_clearance_status === "CLEARED", "Governed spawn admission requires complete blocks and clearance");
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
      next.state = "STALLED";
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

export function runAgentSpawnerCompilerTick(lifecycle, {onCompileBlock = null, onPublishRoster = null} = {}) {
  validateAgentSpawnerLifecycle(lifecycle);
  assert(lifecycle.mode === "COMPILER_ONLY" && lifecycle.state === "COMPILER_ACTIVE", "Spawner compiler tick requires COMPILER_ACTIVE compiler-only state");
  if (lifecycle.next_action === "COMPILE_NEXT_BLOCK") {
    assert(typeof onCompileBlock === "function", "Compiler tick requires a block compiler callback");
    return {action: lifecycle.next_action, status: "COMPILER_TICK_STARTED", result: onCompileBlock({role_id: AGENT_SPAWNER_ROLE_ID, product_mutation: false, spawn_authority: false})};
  }
  if (lifecycle.next_action === "PUBLISH_TYPED_ROSTER") {
    assert(typeof onPublishRoster === "function", "Compiler tick requires a typed roster callback");
    return {action: lifecycle.next_action, status: "ROSTER_TICK_STARTED", result: onPublishRoster({role_id: AGENT_SPAWNER_ROLE_ID, product_mutation: false, spawn_authority: false})};
  }
  assert(SAFE_COMPILER_ACTIONS.has(lifecycle.next_action), "Compiler tick has an unsafe action");
  return {action: lifecycle.next_action, status: "COMPILER_EVENT_WAIT", product_mutation: false, spawn_authority: false, owner_resumption_is_clearance: false};
}
