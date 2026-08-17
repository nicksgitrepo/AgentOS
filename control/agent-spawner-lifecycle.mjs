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
      if (next.mode === "GOVERNED_SPAWN" && next.qa.incomplete_block_count === 0) {
        next.state = "SPAWN_ADMITTED";
        next.authority.temporary_worker_admission = true;
        next.authority.spawn_authority = true;
      }
      break;
    case "ADMIT_GOVERNED_SPAWN":
      assert(lifecycle.mode === "GOVERNED_SPAWN", "Governed spawn admission requires governed-spawn mode");
      assert(lifecycle.qa.incomplete_block_count === 0 && (lifecycle.qa.independent_clearance_status === "CLEARED" || lifecycle.authority.isolated_local_custody === true), "Governed spawn admission requires complete blocks and clearance or isolated local custody");
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
