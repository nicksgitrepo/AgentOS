/*
 * Project-agnostic import campaign Orchestrator.
 *
 * The Orchestrator owns the project-bound campaign sequence.  The persistent
 * Controller supervises its liveness and repairs the workflow when it stops;
 * it does not become the worker, wave planner, or handoff owner.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {
  validateControllerImportCampaignPlan,
  validateControllerImportRosterProjection,
  validateControllerImportRunState,
} from "./controller-import-planner.mjs";
import {validateAgentSpawnerLifecycle} from "./agent-spawner-lifecycle.mjs";
import {validateAgentSpawnerDefectIntake} from "./agent-spawner-defect-intake.mjs";

export const IMPORT_ORCHESTRATOR_SCHEMA = "agentos.import_orchestrator.v1";
export const IMPORT_ORCHESTRATOR_VERSION = 1;
export const IMPORT_ORCHESTRATOR_ROLE = "CAMPAIGN_ORCHESTRATOR";
export const IMPORT_ORCHESTRATOR_MODE = "IMPORT";
export const IMPORT_ORCHESTRATOR_STATES = Object.freeze([
  "ACTIVE",
  "REPAIRING",
  "PROTECTED_WAIT",
  "CANDIDATE_REVIEW",
  "RETIRED",
]);
export const IMPORT_ORCHESTRATOR_ACTIONS = Object.freeze([
  "REQUEST_SPAWNER_QA",
  "REPAIR_BLOCKS",
  "START_SPECIALIST_WAVE",
  "START_PLATFORM_REVIEW",
  "START_CENTRAL_INTEGRATION",
  "START_INDEPENDENT_REAUDIT",
  "PREPARE_CANDIDATE_REVIEW",
  "WAIT_FOR_PROTECTED_EVENT",
  "NONE",
]);

const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Z][A-Z0-9._:-]{0,191}$/u;

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

function requireIdentifier(value, label) {
  assert(typeof value === "string" && IDENTIFIER.test(value), `${label} must be a stable identifier`);
}

function requireSha(value, label, {nullable = false} = {}) {
  if (nullable && value === null) return;
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function requireBoolean(value, label) {
  assert(typeof value === "boolean", `${label} must be boolean`);
}

function requireNonNegativeInteger(value, label) {
  assert(Number.isSafeInteger(value) && value >= 0, `${label} must be a non-negative integer`);
}

function requireRecordPath(value, label) {
  assert(typeof value === "string" && value.length > 0, `${label} must be a non-empty relative path`);
  assert(!path.isAbsolute(value) && !value.includes("\\"), `${label} must be a relative POSIX path`);
  assert(!value.split("/").includes(".."), `${label} may not contain parent traversal`);
}

function nullableIdentifier(value, label) {
  if (value !== null) requireIdentifier(value, label);
}

function body(value) {
  const copy = structuredClone(value);
  copy.orchestrator_sha256 = null;
  return copy;
}

function summarizeDefectIntakes(defectIntakes = []) {
  assert(Array.isArray(defectIntakes), "Import Orchestrator defect intake queue must be an array");
  const ordered = [...defectIntakes].sort((left, right) => compareUtf8(left.defect_id, right.defect_id));
  ordered.forEach((intake) => validateAgentSpawnerDefectIntake(intake));
  assert(new Set(ordered.map((intake) => intake.defect_id)).size === ordered.length, "Import Orchestrator defect intake queue is duplicated");
  const digestInput = ordered.map((intake) => ({
    defect_id: intake.defect_id,
    defect_sha256: intake.defect_sha256,
    status: intake.status,
    route: intake.route,
  }));
  return {
    defectIntakeSha256: canonicalDigest(digestInput),
    repairCandidateCount: ordered.filter((intake) => intake.status === "REPAIR_CANDIDATE_READY").length,
    controllerCustodyCount: ordered.filter((intake) => intake.status === "ACCEPTED_FOR_CONTROLLER_CUSTODY").length,
    protectedDefectCount: ordered.filter((intake) => intake.status === "PENDING_PROTECTED_DECISION").length,
    rejectedDuplicateCount: ordered.filter((intake) => intake.status === "REJECTED_DUPLICATE").length,
  };
}

function deriveOrchestration({runState, rosterProjection, spawnerLifecycle, defectSummary}) {
  if (defectSummary.repairCandidateCount > 0 || defectSummary.controllerCustodyCount > 0) {
    return {state: "REPAIRING", nextAction: "REPAIR_BLOCKS", dependencyId: null};
  }
  if (runState.status === "BLOCKED_PROTECTED" || spawnerLifecycle.state === "STALLED") {
    return {
      state: "PROTECTED_WAIT",
      nextAction: "WAIT_FOR_PROTECTED_EVENT",
      dependencyId: runState.protected_boundary_id ?? "SPAWNER.INDEPENDENT_CLEARANCE",
    };
  }
  if (defectSummary.protectedDefectCount > 0) {
    return {state: "PROTECTED_WAIT", nextAction: "WAIT_FOR_PROTECTED_EVENT", dependencyId: "SPAWNER.DEFECT.PROTECTED_DECISION"};
  }
  if (runState.status === "BLOCKED_RECOVERY") {
    return {state: "REPAIRING", nextAction: "REPAIR_BLOCKS", dependencyId: null};
  }
  if (runState.status === "SPAWNER_QA_PENDING") {
    if (rosterProjection.pending_role_request_ids.length === 0
      && rosterProjection.available_wave_ids.length === 0
      && rosterProjection.activation_blocked_wave_ids.length > 0) {
      return {state: "PROTECTED_WAIT", nextAction: "WAIT_FOR_PROTECTED_EVENT", dependencyId: "SPAWNER.INDEPENDENT_CLEARANCE"};
    }
    return {state: "ACTIVE", nextAction: "REQUEST_SPAWNER_QA", dependencyId: null};
  }
  if (runState.status === "SPECIALIST_WAVE_ACTIVE") return {state: "ACTIVE", nextAction: "START_SPECIALIST_WAVE", dependencyId: null};
  if (runState.status === "PLATFORM_REVIEW_PENDING") return {state: "ACTIVE", nextAction: "START_PLATFORM_REVIEW", dependencyId: null};
  if (runState.status === "CENTRAL_INTEGRATION_PENDING") return {state: "ACTIVE", nextAction: "START_CENTRAL_INTEGRATION", dependencyId: null};
  if (runState.status === "INDEPENDENT_REAUDIT_PENDING") return {state: "ACTIVE", nextAction: "START_INDEPENDENT_REAUDIT", dependencyId: null};
  if (runState.status === "COMPLETE") return {state: "CANDIDATE_REVIEW", nextAction: "PREPARE_CANDIDATE_REVIEW", dependencyId: null};
  assert(false, `Unsupported import run state: ${runState.status}`);
}

function validateAuthority(authority) {
  exactKeys(authority, [
    "campaign_planning", "wave_routing", "spawner_qa_request", "worker_spawn_request", "custody_transfer",
    "handoff_acceptance", "repair_intake", "platform_review_routing", "central_integration_routing",
    "candidate_advance", "product_mutation", "provider_access", "credential_access", "external_sync", "protected_release",
  ], "Import Orchestrator authority");
  for (const field of [
    "campaign_planning", "wave_routing", "spawner_qa_request", "worker_spawn_request", "custody_transfer",
    "handoff_acceptance", "repair_intake", "platform_review_routing", "central_integration_routing", "candidate_advance",
    "product_mutation", "provider_access", "credential_access", "external_sync", "protected_release",
  ]) requireBoolean(authority[field], `Import Orchestrator ${field}`);
  for (const field of ["campaign_planning", "wave_routing", "spawner_qa_request", "worker_spawn_request", "custody_transfer", "handoff_acceptance", "repair_intake", "platform_review_routing", "central_integration_routing", "candidate_advance"]) assert(authority[field] === true, `Import Orchestrator ${field} authority is required`);
  for (const field of ["product_mutation", "provider_access", "credential_access", "external_sync", "protected_release"]) assert(authority[field] === false, `Import Orchestrator crossed protected boundary: ${field}`);
}

function validateOwnership(ownership) {
  exactKeys(ownership, [
    "plan", "wave_order", "spawner_qa", "spawning", "custody", "worker_handoffs", "repair_intake",
    "platform_review", "central_integration", "candidate_advance",
  ], "Import Orchestrator ownership");
  const expected = {
    plan: "IMPORT_PLAN_AND_REPLAN",
    wave_order: "DERIVE_AND_SEQUENCE_WAVES",
    spawner_qa: "REQUEST_TYPED_SPAWNER_QA",
    spawning: "START_ONLY_QA_READY_WORKERS",
    custody: "ASSIGN_AND_VERIFY_WORKTREE_CUSTODY",
    worker_handoffs: "ACCEPT_SOURCE_BOUND_TYPED_HANDOFFS",
    repair_intake: "ADMIT_FINDINGS_AND_REPAIR_CANDIDATES",
    platform_review: "REQUIRE_PLATFORM_REVIEW_TEST_AND_TYPED_HANDOFF",
    central_integration: "CONSUME_ACCEPTED_PLATFORM_HANDOFFS_ONLY",
    candidate_advance: "ADVANCE_ONLY_AFTER_INDEPENDENT_REAUDIT",
  };
  for (const [field, expectedValue] of Object.entries(expected)) assert(ownership[field] === expectedValue, `Import Orchestrator ownership ${field} is not canonical`);
}

function validateHandoffContract(contract) {
  exactKeys(contract, ["spawn_request", "worker_handoff", "spawner_defect_intake", "platform_review", "central_integration", "candidate_advance"], "Import Orchestrator handoff contract");
  assert(contract.spawn_request === "TYPED_SPAWNER_REQUEST", "Import Orchestrator spawn request contract is invalid");
  assert(contract.worker_handoff === "SOURCE_BOUND_TYPED_HANDOFF", "Import Orchestrator worker handoff contract is invalid");
  assert(contract.spawner_defect_intake === "TYPED_SPAWNER_DEFECT_INTAKE", "Import Orchestrator Spawner defect intake contract is invalid");
  assert(contract.platform_review === "INDEPENDENT_PLATFORM_TYPED_HANDOFF", "Import Orchestrator platform review contract is invalid");
  assert(contract.central_integration === "ACCEPTED_PLATFORM_HANDOFFS_ONLY", "Import Orchestrator central integration contract is invalid");
  assert(contract.candidate_advance === "INDEPENDENT_REAUDIT_REQUIRED", "Import Orchestrator candidate advance contract is invalid");
}

function validateContinuation(continuation) {
  exactKeys(continuation, ["mode", "same_turn_next_action", "heartbeat_is_not_progress", "timer_is_not_progress", "active_worker_counts_as_progress", "protected_wait_requires_exact_event"], "Import Orchestrator continuation");
  assert(continuation.mode === "EVENT_DRIVEN_AUTOMATIC", "Import Orchestrator continuation mode is invalid");
  for (const field of ["same_turn_next_action", "heartbeat_is_not_progress", "timer_is_not_progress", "active_worker_counts_as_progress", "protected_wait_requires_exact_event"]) assert(continuation[field] === true, `Import Orchestrator continuation rule is weakened: ${field}`);
}

export function validateImportOrchestrator(orchestrator, {plan, rosterProjection, runState, spawnerLifecycle, defectIntakes} = {}) {
  exactKeys(orchestrator, [
    "schema", "version", "orchestrator_id", "role_id", "mode", "state", "campaign_plan_sha256", "roster_projection_sha256",
    "run_state_sha256", "spawner_lifecycle_sha256", "defect_intake_sha256", "repair_candidate_count", "controller_custody_count",
    "protected_defect_count", "rejected_duplicate_count", "current_wave_id", "blocked_dependency_id", "ownership", "authority",
    "handoff_contract", "continuation", "transition_sequence", "next_action", "orchestrator_sha256",
  ], "Import Orchestrator");
  assert(orchestrator.schema === IMPORT_ORCHESTRATOR_SCHEMA && orchestrator.version === IMPORT_ORCHESTRATOR_VERSION, "Import Orchestrator identity is invalid");
  requireIdentifier(orchestrator.orchestrator_id, "Import Orchestrator ID");
  assert(orchestrator.role_id === IMPORT_ORCHESTRATOR_ROLE && orchestrator.mode === IMPORT_ORCHESTRATOR_MODE, "Import Orchestrator role or mode is invalid");
  assert(IMPORT_ORCHESTRATOR_STATES.includes(orchestrator.state), "Import Orchestrator state is invalid");
  assert(IMPORT_ORCHESTRATOR_ACTIONS.includes(orchestrator.next_action), "Import Orchestrator action is invalid");
  for (const field of ["campaign_plan_sha256", "roster_projection_sha256", "run_state_sha256", "spawner_lifecycle_sha256"]) requireSha(orchestrator[field], `Import Orchestrator ${field}`);
  requireSha(orchestrator.defect_intake_sha256, "Import Orchestrator defect intake binding");
  for (const field of ["repair_candidate_count", "controller_custody_count", "protected_defect_count", "rejected_duplicate_count"]) requireNonNegativeInteger(orchestrator[field], `Import Orchestrator ${field}`);
  nullableIdentifier(orchestrator.current_wave_id, "Import Orchestrator current wave");
  nullableIdentifier(orchestrator.blocked_dependency_id, "Import Orchestrator blocked dependency");
  requireNonNegativeInteger(orchestrator.transition_sequence, "Import Orchestrator transition sequence");
  validateOwnership(orchestrator.ownership);
  validateAuthority(orchestrator.authority);
  validateHandoffContract(orchestrator.handoff_contract);
  validateContinuation(orchestrator.continuation);
  if (plan !== undefined) {
    validateControllerImportCampaignPlan(plan);
    assert(orchestrator.campaign_plan_sha256 === plan.plan_sha256, "Import Orchestrator plan binding is stale");
  }
  if (rosterProjection !== undefined) {
    validateControllerImportRosterProjection(rosterProjection, {plan});
    assert(orchestrator.roster_projection_sha256 === rosterProjection.projection_sha256, "Import Orchestrator roster binding is stale");
  }
  if (runState !== undefined) {
    validateControllerImportRunState(runState, {plan});
    assert(orchestrator.run_state_sha256 === runState.state_sha256, "Import Orchestrator run-state binding is stale");
    assert(orchestrator.current_wave_id === runState.current_wave_id, "Import Orchestrator current wave is stale");
  }
  if (spawnerLifecycle !== undefined) {
    validateAgentSpawnerLifecycle(spawnerLifecycle);
    assert(orchestrator.spawner_lifecycle_sha256 === spawnerLifecycle.lifecycle_sha256, "Import Orchestrator Spawner binding is stale");
    if (rosterProjection !== undefined) assert(spawnerLifecycle.roster_projection_sha256 === rosterProjection.projection_sha256, "Spawner roster binding is stale");
  }
  if (defectIntakes !== undefined) {
    const defectSummary = summarizeDefectIntakes(defectIntakes);
    assert(orchestrator.defect_intake_sha256 === defectSummary.defectIntakeSha256, "Import Orchestrator defect intake binding is stale");
    assert(orchestrator.repair_candidate_count === defectSummary.repairCandidateCount, "Import Orchestrator repair candidate count is stale");
    assert(orchestrator.controller_custody_count === defectSummary.controllerCustodyCount, "Import Orchestrator Controller custody count is stale");
    assert(orchestrator.protected_defect_count === defectSummary.protectedDefectCount, "Import Orchestrator protected defect count is stale");
    assert(orchestrator.rejected_duplicate_count === defectSummary.rejectedDuplicateCount, "Import Orchestrator duplicate count is stale");
  }
  if (runState !== undefined || rosterProjection !== undefined || spawnerLifecycle !== undefined) {
    const derived = deriveOrchestration({runState: runState ?? {status: "COMPLETE", current_wave_id: null}, rosterProjection: rosterProjection ?? {pending_role_request_ids: [], available_wave_ids: [], activation_blocked_wave_ids: []}, spawnerLifecycle: spawnerLifecycle ?? {state: "COMPILER_ACTIVE"}, defectSummary: summarizeDefectIntakes(defectIntakes ?? [])});
    assert(orchestrator.state === derived.state && orchestrator.next_action === derived.nextAction, "Import Orchestrator action is not derived from current run state");
    assert(orchestrator.blocked_dependency_id === derived.dependencyId, "Import Orchestrator protected dependency is stale");
    if (orchestrator.state === "PROTECTED_WAIT") assert(orchestrator.next_action === "WAIT_FOR_PROTECTED_EVENT", "Protected Orchestrator wait is not explicit");
    if (orchestrator.state !== "PROTECTED_WAIT") assert(orchestrator.blocked_dependency_id === null, "Non-protected Orchestrator retains a blocker");
  }
  if (orchestrator.state === "RETIRED") assert(orchestrator.next_action === "NONE", "Retired Orchestrator must have no action");
  requireSha(orchestrator.orchestrator_sha256, "Import Orchestrator digest");
  assert(orchestrator.orchestrator_sha256 === canonicalDigest(body(orchestrator)), "Import Orchestrator digest mismatch");
  return orchestrator;
}

export function compileImportOrchestrator({orchestratorId, plan, rosterProjection, runState, spawnerLifecycle, defectIntakes = []} = {}) {
  validateControllerImportCampaignPlan(plan);
  validateControllerImportRosterProjection(rosterProjection, {plan});
  validateControllerImportRunState(runState, {plan});
  validateAgentSpawnerLifecycle(spawnerLifecycle);
  const defectSummary = summarizeDefectIntakes(defectIntakes);
  assert(spawnerLifecycle.roster_projection_sha256 === rosterProjection.projection_sha256, "Spawner roster binding is stale");
  requireIdentifier(orchestratorId, "Import Orchestrator ID");
  const derived = deriveOrchestration({runState, rosterProjection, spawnerLifecycle, defectSummary});
  const orchestrator = {
    schema: IMPORT_ORCHESTRATOR_SCHEMA,
    version: IMPORT_ORCHESTRATOR_VERSION,
    orchestrator_id: orchestratorId,
    role_id: IMPORT_ORCHESTRATOR_ROLE,
    mode: IMPORT_ORCHESTRATOR_MODE,
    state: derived.state,
    campaign_plan_sha256: plan.plan_sha256,
    roster_projection_sha256: rosterProjection.projection_sha256,
    run_state_sha256: runState.state_sha256,
    spawner_lifecycle_sha256: spawnerLifecycle.lifecycle_sha256,
    defect_intake_sha256: defectSummary.defectIntakeSha256,
    repair_candidate_count: defectSummary.repairCandidateCount,
    controller_custody_count: defectSummary.controllerCustodyCount,
    protected_defect_count: defectSummary.protectedDefectCount,
    rejected_duplicate_count: defectSummary.rejectedDuplicateCount,
    current_wave_id: runState.current_wave_id,
    blocked_dependency_id: derived.dependencyId,
    ownership: {
      plan: "IMPORT_PLAN_AND_REPLAN",
      wave_order: "DERIVE_AND_SEQUENCE_WAVES",
      spawner_qa: "REQUEST_TYPED_SPAWNER_QA",
      spawning: "START_ONLY_QA_READY_WORKERS",
      custody: "ASSIGN_AND_VERIFY_WORKTREE_CUSTODY",
      worker_handoffs: "ACCEPT_SOURCE_BOUND_TYPED_HANDOFFS",
      repair_intake: "ADMIT_FINDINGS_AND_REPAIR_CANDIDATES",
      platform_review: "REQUIRE_PLATFORM_REVIEW_TEST_AND_TYPED_HANDOFF",
      central_integration: "CONSUME_ACCEPTED_PLATFORM_HANDOFFS_ONLY",
      candidate_advance: "ADVANCE_ONLY_AFTER_INDEPENDENT_REAUDIT",
    },
    authority: {
      campaign_planning: true,
      wave_routing: true,
      spawner_qa_request: true,
      worker_spawn_request: true,
      custody_transfer: true,
      handoff_acceptance: true,
      repair_intake: true,
      platform_review_routing: true,
      central_integration_routing: true,
      candidate_advance: true,
      product_mutation: false,
      provider_access: false,
      credential_access: false,
      external_sync: false,
      protected_release: false,
    },
    handoff_contract: {
      spawn_request: "TYPED_SPAWNER_REQUEST",
      worker_handoff: "SOURCE_BOUND_TYPED_HANDOFF",
      spawner_defect_intake: "TYPED_SPAWNER_DEFECT_INTAKE",
      platform_review: "INDEPENDENT_PLATFORM_TYPED_HANDOFF",
      central_integration: "ACCEPTED_PLATFORM_HANDOFFS_ONLY",
      candidate_advance: "INDEPENDENT_REAUDIT_REQUIRED",
    },
    continuation: {
      mode: "EVENT_DRIVEN_AUTOMATIC",
      same_turn_next_action: true,
      heartbeat_is_not_progress: true,
      timer_is_not_progress: true,
      active_worker_counts_as_progress: true,
      protected_wait_requires_exact_event: true,
    },
    transition_sequence: 0,
    next_action: derived.nextAction,
    orchestrator_sha256: null,
  };
  orchestrator.orchestrator_sha256 = canonicalDigest(body(orchestrator));
  return validateImportOrchestrator(orchestrator, {plan, rosterProjection, runState, spawnerLifecycle, defectIntakes});
}

export function advanceImportOrchestrator({orchestrator, plan, rosterProjection, runState, spawnerLifecycle, defectIntakes = []} = {}) {
  validateImportOrchestrator(orchestrator);
  const next = compileImportOrchestrator({orchestratorId: orchestrator.orchestrator_id, plan, rosterProjection, runState, spawnerLifecycle, defectIntakes});
  const changed = ["campaign_plan_sha256", "roster_projection_sha256", "run_state_sha256", "spawner_lifecycle_sha256", "defect_intake_sha256", "repair_candidate_count", "controller_custody_count", "protected_defect_count", "rejected_duplicate_count", "current_wave_id", "blocked_dependency_id", "state", "next_action"].some((field) => next[field] !== orchestrator[field]);
  assert(changed, "Import Orchestrator cannot advance without a material bound transition");
  next.transition_sequence = orchestrator.transition_sequence + 1;
  next.orchestrator_sha256 = canonicalDigest(body(next));
  return validateImportOrchestrator(next, {plan, rosterProjection, runState, spawnerLifecycle, defectIntakes});
}

/*
 * The Controller must be able to observe and resume the Orchestrator across
 * turns and process restarts.  Persistence is deliberately generic: the
 * record is the same digest-bound contract above, written only beneath an
 * explicit authority root with a filesystem CAS.  No project source, provider
 * state, credentials, or consumer path is ever touched by these helpers.
 */
function safeOrchestratorRecordPath(authorityRoot, recordPath) {
  assert(typeof authorityRoot === "string" && path.isAbsolute(authorityRoot), "Orchestrator authority root must be absolute");
  requireRecordPath(recordPath, "Orchestrator record path");
  const inputRootStat = fs.lstatSync(authorityRoot);
  assert(inputRootStat.isDirectory() && !inputRootStat.isSymbolicLink(), "Orchestrator authority root must be a real directory");
  const root = fs.realpathSync.native(authorityRoot);
  const rootStat = fs.lstatSync(root);
  assert(rootStat.isDirectory() && !rootStat.isSymbolicLink(), "Orchestrator authority root must be a real directory");
  const target = path.resolve(root, recordPath);
  assert(target.startsWith(`${root}${path.sep}`), "Orchestrator record path escapes authority root");
  for (let cursor = target; cursor !== root; cursor = path.dirname(cursor)) {
    if (fs.existsSync(cursor)) assert(!fs.lstatSync(cursor).isSymbolicLink(), "Orchestrator record path may not contain symlinks");
  }
  return target;
}

function fsyncOrchestratorDirectory(directory) {
  const descriptor = fs.openSync(directory, fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY ?? 0));
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

export function readImportOrchestratorRecord({authorityRoot, recordPath}) {
  const target = safeOrchestratorRecordPath(authorityRoot, recordPath);
  let stat;
  try { stat = fs.lstatSync(target); } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  assert(stat.isFile() && !stat.isSymbolicLink(), "Orchestrator record must be a regular file");
  let record;
  try { record = JSON.parse(fs.readFileSync(target, "utf8")); }
  catch (error) { throw new Error(`Orchestrator record JSON is invalid: ${error.message}`); }
  return validateImportOrchestrator(record);
}

export function writeImportOrchestratorRecordCompareAndSwap({authorityRoot, recordPath, expectedOrchestratorSha256 = null, orchestrator} = {}) {
  const validated = validateImportOrchestrator(orchestrator);
  requireSha(expectedOrchestratorSha256, "Orchestrator compare-and-swap parent", {nullable: true});
  let target = safeOrchestratorRecordPath(authorityRoot, recordPath);
  fs.mkdirSync(path.dirname(target), {recursive: true});
  target = safeOrchestratorRecordPath(authorityRoot, recordPath);
  const lockPath = `${target}.lock`;
  let lockDescriptor;
  let lockHeld = false;
  let temporary;
  try {
    lockDescriptor = fs.openSync(lockPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
    lockHeld = true;
    const current = readImportOrchestratorRecord({authorityRoot, recordPath});
    if (expectedOrchestratorSha256 === null) assert(current === null, "Orchestrator record already exists");
    else assert(current !== null && current.orchestrator_sha256 === expectedOrchestratorSha256, "Orchestrator compare-and-swap parent is stale");
    temporary = `${target}.${process.pid}.${crypto.randomUUID()}.stage`;
    const descriptor = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
    try {
      fs.writeFileSync(descriptor, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
      fs.fsyncSync(descriptor);
    } finally { fs.closeSync(descriptor); }
    fs.renameSync(temporary, target);
    fsyncOrchestratorDirectory(path.dirname(target));
    temporary = null;
  } finally {
    if (temporary !== undefined && fs.existsSync(temporary)) fs.unlinkSync(temporary);
    if (lockDescriptor !== undefined) fs.closeSync(lockDescriptor);
    if (lockHeld) {
      try { fs.unlinkSync(lockPath); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  }
  const readback = readImportOrchestratorRecord({authorityRoot, recordPath});
  assert(readback.orchestrator_sha256 === validated.orchestrator_sha256, "Orchestrator record readback differs");
  return {path: recordPath, orchestrator_sha256: readback.orchestrator_sha256};
}

export function advanceImportOrchestratorRecord({authorityRoot, recordPath, expectedOrchestratorSha256, plan, rosterProjection, runState, spawnerLifecycle, defectIntakes = []} = {}) {
  requireSha(expectedOrchestratorSha256, "expected Orchestrator record");
  const current = readImportOrchestratorRecord({authorityRoot, recordPath});
  assert(current !== null, "Orchestrator record is missing");
  assert(current.orchestrator_sha256 === expectedOrchestratorSha256, "Orchestrator record parent is stale");
  const next = advanceImportOrchestrator({orchestrator: current, plan, rosterProjection, runState, spawnerLifecycle, defectIntakes});
  return writeImportOrchestratorRecordCompareAndSwap({authorityRoot, recordPath, expectedOrchestratorSha256, orchestrator: next});
}
