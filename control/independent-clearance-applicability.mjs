/*
 * Project-agnostic applicability gate for independent utility/harm clearance.
 *
 * Clearance is mandatory for governed worker or wave activation. It is not a
 * prerequisite for a compiler-only, no-side-effect local QA/import-planning
 * phase or an isolated local audit/repair phase when typed custody, source
 * preservation, and resource ceilings prove that no protected action can occur.
 * The decision is derived from typed facts and is invalidated when any fact
 * changes.
 */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";

export const INDEPENDENT_CLEARANCE_APPLICABILITY_SCHEMA = "agentos.independent_clearance_applicability.v1";
export const INDEPENDENT_CLEARANCE_APPLICABILITY_VERSION = 1;
export const INDEPENDENT_CLEARANCE_APPLICABILITY_PHASES = Object.freeze([
  "COMPILER_ONLY_LOCAL_QA_IMPORT_PLANNING",
  "ISOLATED_LOCAL_AUDIT_REPAIR",
  "GOVERNED_WORKER_ACTIVATION",
  "WAVE_ACTIVATION",
  "EXTERNAL_OR_DESTRUCTIVE_ACTION",
]);
export const INDEPENDENT_CLEARANCE_APPLICABILITY_DECISIONS = Object.freeze([
  "NOT_APPLICABLE_LOCAL_COMPILER_QA",
  "NOT_APPLICABLE_LOCAL_AUDIT_REPAIR",
  "REQUIRED_PROTECTED_ROUTE",
]);
export const INDEPENDENT_CLEARANCE_APPLICABILITY_ACTIONS = Object.freeze([
  "CONTINUE_LOCAL_COMPILER_QA",
  "CONTINUE_ISOLATED_LOCAL_AUDIT_REPAIR",
  "WAIT_FOR_INDEPENDENT_CLEARANCE",
]);
export const INDEPENDENT_CLEARANCE_PROTECTED_EVENT = "INDEPENDENT.UTILITY_HARM_CLEARANCE";

const IDENTIFIER = /^[A-Z][A-Z0-9._:-]{0,191}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const LOCAL_PHASE = "COMPILER_ONLY_LOCAL_QA_IMPORT_PLANNING";
const ISOLATED_AUDIT_PHASE = "ISOLATED_LOCAL_AUDIT_REPAIR";
const LOCAL_EVIDENCE_CEILING = "Independent utility/harm clearance is not applicable to this bounded compiler-only local QA/import-planning phase because admission, activation, provider, credential, product, external sync, spend, destructive work, and live execution are all disabled.";
const ISOLATED_AUDIT_EVIDENCE_CEILING = "Independent utility/harm clearance is not applicable to this bounded isolated local audit/repair phase because typed isolated-worktree custody, source preservation, read-only shared workspace access, no protected capabilities, and the six-lane/one-heavyweight resource ceiling are proven.";
const PROTECTED_EVIDENCE_CEILING = "Independent utility/harm clearance remains required before governed worker activation, wave activation, or any external, spend-bearing, product-mutating, or destructive route.";
const LOCAL_RESTART_EVENT = "REEVALUATE_BEFORE_ANY_GOVERNED_SPAWN_WAVE_ACTIVATION_EXTERNAL_PROVIDER_PRODUCT_SPEND_OR_DESTRUCTIVE_ROUTE";
const ISOLATED_AUDIT_RESTART_EVENT = "REEVALUATE_BEFORE_GOVERNED_WORKER_WAVE_ACTIVATION_EXTERNAL_PROVIDER_PRODUCT_SPEND_OR_DESTRUCTIVE_ROUTE";
const PROTECTED_RESTART_EVENT = "EXPLICIT_INDEPENDENT_UTILITY_HARM_CLEARANCE_RECEIPT_OR_EXPLICIT_OWNER_RESUMPTION_FOR_AFFECTED_LOCAL_ROUTE";
const INVALIDATION_RULE = "Any change to phase, authority facts, resource facts, or protected-route scope invalidates this applicability receipt and requires recompilation.";

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

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function requireBoolean(value, label) {
  assert(typeof value === "boolean", `${label} must be boolean`);
}

function requireCount(value, label) {
  assert(Number.isSafeInteger(value) && value >= 0, `${label} must be a non-negative integer`);
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
}

function sortedIdentifiers(values, label) {
  assert(Array.isArray(values) && values.length > 0, `${label} must be a non-empty array`);
  values.forEach((value, index) => requireIdentifier(value, `${label} item ${index}`));
  const sorted = [...values].sort(compareUtf8);
  assert(new Set(sorted).size === sorted.length, `${label} contains duplicates`);
  assert(JSON.stringify(values) === JSON.stringify(sorted), `${label} must be sorted`);
}

function receiptBody(receipt) {
  const body = structuredClone(receipt);
  body.applicability_sha256 = null;
  return body;
}

function localFactsAreSafe(facts) {
  return facts.phase === LOCAL_PHASE
    && facts.spawner_mode === "COMPILER_ONLY"
    && facts.temporary_worker_admission === false
    && facts.spawn_authority === false
    && facts.wave_activation === "OFF"
    && facts.product_mutation === false
    && facts.provider_access === false
    && facts.credential_access === false
    && facts.external_sync === false
    && facts.material_spend_authorized === false
    && facts.destructive_work_authorized === false
    && facts.live_provider_workflow === false
    && facts.active_worker_count === 0
    && facts.scheduler_job_count === 0
    && facts.heavyweight_process_count === 0
    && facts.timer_count === 0
    && facts.polling === false;
}

function isolatedAuditFactsAreSafe(facts) {
  return facts.phase === ISOLATED_AUDIT_PHASE
    && facts.spawner_mode === "GOVERNED_SPAWN"
    && facts.temporary_worker_admission === true
    && facts.spawn_authority === true
    && facts.wave_activation === "OFF"
    && facts.isolated_worktree_custody === true
    && facts.source_roots_preserved === true
    && facts.shared_workspace_read_only === true
    && facts.product_mutation === false
    && facts.provider_access === false
    && facts.credential_access === false
    && facts.external_sync === false
    && facts.material_spend_authorized === false
    && facts.destructive_work_authorized === false
    && facts.live_provider_workflow === false
    && facts.active_lane_count >= 0
    && facts.active_lane_count <= facts.lane_limit
    && facts.lane_limit === 6
    && facts.active_worker_count >= 0
    && facts.active_worker_count <= facts.lane_limit
    && facts.heavyweight_process_count <= facts.heavyweight_process_limit
    && facts.heavyweight_process_limit === 1
    && facts.scheduler_job_count <= facts.lane_limit
    && facts.timer_count === 0
    && facts.polling === false;
}

function expectedDecision(facts) {
  if (localFactsAreSafe(facts)) return "NOT_APPLICABLE_LOCAL_COMPILER_QA";
  if (isolatedAuditFactsAreSafe(facts)) return "NOT_APPLICABLE_LOCAL_AUDIT_REPAIR";
  return "REQUIRED_PROTECTED_ROUTE";
}

function validateFacts(facts) {
  exactKeys(facts, [
    "phase", "spawner_mode", "temporary_worker_admission", "spawn_authority", "wave_activation",
    "isolated_worktree_custody", "source_roots_preserved", "shared_workspace_read_only", "active_lane_count", "lane_limit",
    "product_mutation", "provider_access", "credential_access", "external_sync", "material_spend_authorized",
    "destructive_work_authorized", "live_provider_workflow", "active_worker_count", "scheduler_job_count", "heavyweight_process_count",
    "heavyweight_process_limit", "timer_count", "polling",
  ], "Independent clearance applicability facts");
  assert(INDEPENDENT_CLEARANCE_APPLICABILITY_PHASES.includes(facts.phase), "Independent clearance applicability phase is invalid");
  assert(facts.spawner_mode === "COMPILER_ONLY" || facts.spawner_mode === "GOVERNED_SPAWN", "Independent clearance Spawner mode is invalid");
  for (const field of [
    "temporary_worker_admission", "spawn_authority", "product_mutation", "provider_access", "credential_access",
    "external_sync", "material_spend_authorized", "destructive_work_authorized", "live_provider_workflow", "polling",
    "isolated_worktree_custody", "source_roots_preserved", "shared_workspace_read_only",
  ]) requireBoolean(facts[field], `Independent clearance ${field}`);
  assert(facts.wave_activation === "OFF" || facts.wave_activation === "ON", "Independent clearance wave activation is invalid");
  for (const field of ["active_worker_count", "scheduler_job_count", "heavyweight_process_count", "active_lane_count", "lane_limit", "heavyweight_process_limit", "timer_count"]) requireCount(facts[field], `Independent clearance ${field}`);
  assert(facts.lane_limit === 6, "Independent clearance lane limit must be six");
  assert(facts.heavyweight_process_limit === 1, "Independent clearance heavyweight limit must be one");
}

export function validateIndependentClearanceApplicability(receipt) {
  exactKeys(receipt, [
    "schema", "version", "applicability_id", "phase", "decision", "action", "independent_clearance_required",
    "protected_event_id", "facts", "evidence_sha256", "evidence_ceiling", "restart_event", "invalidation_rule",
    "hostile_fixture_refs", "applicability_sha256",
  ], "Independent clearance applicability");
  assert(receipt.schema === INDEPENDENT_CLEARANCE_APPLICABILITY_SCHEMA && receipt.version === INDEPENDENT_CLEARANCE_APPLICABILITY_VERSION, "Independent clearance applicability identity is invalid");
  requireIdentifier(receipt.applicability_id, "Independent clearance applicability ID");
  assert(receipt.phase === receipt.facts.phase, "Independent clearance applicability phase is not bound to facts");
  assert(INDEPENDENT_CLEARANCE_APPLICABILITY_DECISIONS.includes(receipt.decision), "Independent clearance applicability decision is invalid");
  assert(INDEPENDENT_CLEARANCE_APPLICABILITY_ACTIONS.includes(receipt.action), "Independent clearance applicability action is invalid");
  validateFacts(receipt.facts);
  requireSha(receipt.evidence_sha256, "Independent clearance applicability evidence digest");
  assert(receipt.evidence_sha256 === canonicalDigest(receipt.facts), "Independent clearance applicability evidence digest mismatch");
  const expected = expectedDecision(receipt.facts);
  assert(receipt.decision === expected, "Independent clearance applicability decision is not derived from typed facts");
  if (expected === "NOT_APPLICABLE_LOCAL_COMPILER_QA") {
    assert(receipt.action === "CONTINUE_LOCAL_COMPILER_QA", "Local compiler applicability must continue local QA");
    assert(receipt.independent_clearance_required === false, "Local compiler applicability cannot require clearance");
    assert(receipt.protected_event_id === null, "Local compiler applicability cannot bind a protected event");
    assert(receipt.evidence_ceiling === LOCAL_EVIDENCE_CEILING, "Local compiler applicability evidence ceiling is invalid");
    assert(receipt.restart_event === LOCAL_RESTART_EVENT, "Local compiler applicability restart event is invalid");
  } else if (expected === "NOT_APPLICABLE_LOCAL_AUDIT_REPAIR") {
    assert(receipt.action === "CONTINUE_ISOLATED_LOCAL_AUDIT_REPAIR", "Isolated local audit applicability must continue isolated audit/repair");
    assert(receipt.independent_clearance_required === false, "Isolated local audit applicability cannot require clearance");
    assert(receipt.protected_event_id === null, "Isolated local audit applicability cannot bind a protected event");
    assert(receipt.evidence_ceiling === ISOLATED_AUDIT_EVIDENCE_CEILING, "Isolated local audit applicability evidence ceiling is invalid");
    assert(receipt.restart_event === ISOLATED_AUDIT_RESTART_EVENT, "Isolated local audit applicability restart event is invalid");
  } else {
    assert(receipt.action === "WAIT_FOR_INDEPENDENT_CLEARANCE", "Protected applicability must wait for clearance");
    assert(receipt.independent_clearance_required === true, "Protected applicability must require clearance");
    assert(receipt.protected_event_id === INDEPENDENT_CLEARANCE_PROTECTED_EVENT, "Protected applicability event is invalid");
    assert(receipt.evidence_ceiling === PROTECTED_EVIDENCE_CEILING, "Protected applicability evidence ceiling is invalid");
    assert(receipt.restart_event === PROTECTED_RESTART_EVENT, "Protected applicability restart event is invalid");
  }
  requireString(receipt.invalidation_rule, "Independent clearance applicability invalidation rule");
  assert(receipt.invalidation_rule === INVALIDATION_RULE, "Independent clearance applicability invalidation rule is weakened");
  sortedIdentifiers(receipt.hostile_fixture_refs, "Independent clearance applicability hostile fixtures");
  requireSha(receipt.applicability_sha256, "Independent clearance applicability digest");
  assert(receipt.applicability_sha256 === canonicalDigest(receiptBody(receipt)), "Independent clearance applicability digest mismatch");
  return receipt;
}

export function compileIndependentClearanceApplicability({
  applicabilityId,
  phase,
  spawnerMode,
  temporaryWorkerAdmission,
  spawnAuthority,
  waveActivation,
  productMutation,
  providerAccess,
  credentialAccess,
  externalSync,
  materialSpendAuthorized,
  destructiveWorkAuthorized,
  liveProviderWorkflow,
  isolatedWorktreeCustody = false,
  sourceRootsPreserved = false,
  sharedWorkspaceReadOnly = true,
  activeLaneCount = 0,
  laneLimit = 6,
  activeWorkerCount,
  schedulerJobCount,
  heavyweightProcessCount,
  heavyweightProcessLimit = 1,
  timerCount,
  polling,
  hostileFixtureRefs = [
    "FIXTURE.INDEPENDENT_CLEARANCE.LOCAL_QA_BYPASS",
    "FIXTURE.INDEPENDENT_CLEARANCE.PROTECTED_ROUTE_BYPASS",
  ],
} = {}) {
  requireIdentifier(applicabilityId, "Independent clearance applicability ID");
  const facts = {
    phase,
    spawner_mode: spawnerMode,
    temporary_worker_admission: temporaryWorkerAdmission,
    spawn_authority: spawnAuthority,
    wave_activation: waveActivation,
    isolated_worktree_custody: isolatedWorktreeCustody,
    source_roots_preserved: sourceRootsPreserved,
    shared_workspace_read_only: sharedWorkspaceReadOnly,
    active_lane_count: activeLaneCount,
    lane_limit: laneLimit,
    product_mutation: productMutation,
    provider_access: providerAccess,
    credential_access: credentialAccess,
    external_sync: externalSync,
    material_spend_authorized: materialSpendAuthorized,
    destructive_work_authorized: destructiveWorkAuthorized,
    live_provider_workflow: liveProviderWorkflow,
    active_worker_count: activeWorkerCount,
    scheduler_job_count: schedulerJobCount,
    heavyweight_process_count: heavyweightProcessCount,
    heavyweight_process_limit: heavyweightProcessLimit,
    timer_count: timerCount,
    polling,
  };
  validateFacts(facts);
  const decision = expectedDecision(facts);
  const receipt = {
    schema: INDEPENDENT_CLEARANCE_APPLICABILITY_SCHEMA,
    version: INDEPENDENT_CLEARANCE_APPLICABILITY_VERSION,
    applicability_id: applicabilityId,
    phase,
    decision,
    action: decision === "NOT_APPLICABLE_LOCAL_COMPILER_QA"
      ? "CONTINUE_LOCAL_COMPILER_QA"
      : decision === "NOT_APPLICABLE_LOCAL_AUDIT_REPAIR"
        ? "CONTINUE_ISOLATED_LOCAL_AUDIT_REPAIR"
        : "WAIT_FOR_INDEPENDENT_CLEARANCE",
    independent_clearance_required: decision === "REQUIRED_PROTECTED_ROUTE",
    protected_event_id: decision === "REQUIRED_PROTECTED_ROUTE" ? INDEPENDENT_CLEARANCE_PROTECTED_EVENT : null,
    facts,
    evidence_sha256: canonicalDigest(facts),
    evidence_ceiling: decision === "NOT_APPLICABLE_LOCAL_COMPILER_QA"
      ? LOCAL_EVIDENCE_CEILING
      : decision === "NOT_APPLICABLE_LOCAL_AUDIT_REPAIR"
        ? ISOLATED_AUDIT_EVIDENCE_CEILING
        : PROTECTED_EVIDENCE_CEILING,
    restart_event: decision === "NOT_APPLICABLE_LOCAL_COMPILER_QA"
      ? LOCAL_RESTART_EVENT
      : decision === "NOT_APPLICABLE_LOCAL_AUDIT_REPAIR"
        ? ISOLATED_AUDIT_RESTART_EVENT
        : PROTECTED_RESTART_EVENT,
    invalidation_rule: INVALIDATION_RULE,
    hostile_fixture_refs: [...hostileFixtureRefs].sort(compareUtf8),
    applicability_sha256: null,
  };
  receipt.applicability_sha256 = canonicalDigest(receiptBody(receipt));
  return validateIndependentClearanceApplicability(receipt);
}
