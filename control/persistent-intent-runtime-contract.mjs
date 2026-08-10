/* Durable record contracts and pure state transitions for the persistent runtime. */

import {
  MAX_REVIEW_INTERVAL_MINUTES,
  MIN_REVIEW_INTERVAL_MINUTES,
  PROTECTED_ACTIONS,
  assert,
  clone,
  compareUtf8,
  digestWithout,
  exactKeys,
  privacyCheck,
  requireBoolean,
  requireIdentifier,
  requireInterval,
  requireNonnegativeInteger,
  requireNullable,
  requireOpaqueReference,
  requireRecord,
  requireSha,
  requireSortedUnique,
  requireSourceSha,
  requireString,
  requireUtc,
  stateContentDigest,
  validateProtectedActions,
} from "./persistent-intent-runtime-primitives.mjs";
import {canonicalDigest} from "./content-addressing.mjs";

export const PERSISTENT_INTENT_RUNTIME_SCHEMA = "agentos.persistent_intent_runtime.v1";
export const PERSISTENT_INTENT_RUNTIME_VERSION = 1;
export const PERSISTENT_INTENT_RUNTIME_CONTRACT_SCHEMA = "agentos.persistent_intent_runtime_contract.v1";
export const PERSISTENT_INTENT_RUNTIME_CONTRACT_VERSION = 1;
export const SNAPSHOT_SCHEMA = "agentos.campaign_snapshot.v1";
export const SNAPSHOT_VERSION = 1;
export const DECISION_SCHEMA = "agentos.intent_regulator_decision.v1";
export const DECISION_VERSION = 1;
export const STATE_SCHEMA = "agentos.intent_regulator_runtime_state.v1";
export const STATE_VERSION = 1;
export const LEASE_SCHEMA = "agentos.intent_regulator_runtime_lease.v1";
export const LEASE_VERSION = 1;
export const EVENT_SCHEMA = "agentos.intent_regulator_runtime_event.v1";
export const EVENT_VERSION = 1;
export const CHECKPOINT_SCHEMA = "agentos.intent_regulator_checkpoint.v1";
export const CHECKPOINT_VERSION = 1;
export const TRANSACTION_SCHEMA = "agentos.intent_regulator_runtime_transaction.v1";
export const TRANSACTION_VERSION = 1;
export const PERSISTENT_ROLE_SCHEMA = "agentos.persistent_intent_runtime_role.v1";
export const PERSISTENT_ROLE_VERSION = 1;
export const OWNER_DECISION_SCHEMA = "agentos.intent_regulator_owner_decision.v1";
export const OWNER_DECISION_VERSION = 1;

export const DEFAULT_REVIEW_INTERVAL_MINUTES = 15;
export const GENESIS_EVENT_HEAD_SHA256 = "0".repeat(64);
export const ACTIVATION_STATUS = "PREPARED_NOT_ACTIVATED";
export const INTENT_REGULATOR_ROLE = "INTENT_REGULATOR";
export const RUNTIME_ROLE = "RUNTIME";
export const PERSISTENT_ROLE_IDS = Object.freeze([INTENT_REGULATOR_ROLE, RUNTIME_ROLE]);
export const PERSISTENT_ROLE_DISPLAY_NAMES = Object.freeze({
  [INTENT_REGULATOR_ROLE]: "Intent Regulator",
  [RUNTIME_ROLE]: "Runtime",
});

export const REGULATOR_DECISIONS = Object.freeze([
  "CONTINUE_CAMPAIGN",
  "STOP_HARD_BOUNDARY",
  "REASSESS_AND_REPLACE_GOAL",
  "ORCHESTRATOR_REVIEW",
  "REPLACE_STALLED_WORKER",
  "AWAIT_ACCEPTANCE",
]);

export const REGULATOR_STATUSES = Object.freeze([
  "READY",
  "ACTIVE",
  "SOFT_REVIEW",
  "HARD_STOPPED",
  "REASSESSMENT_REQUIRED",
  "REPLACEMENT_REQUIRED",
  "AWAITING_ACCEPTANCE",
  "BLOCKED",
  "CLOSED",
]);

export const PROGRESS_STATUSES = Object.freeze([
  "OPEN",
  "PROGRESS_RECORDED",
  "STALLED",
  "CLOSED",
]);

export const ACCEPTANCE_STATUSES = Object.freeze(["NONE", "CANDIDATE", "ACCEPTED"]);
export const MEANINGFUL_RESULT_TYPES = Object.freeze(["ARTIFACT", "VERIFIED_BEHAVIOR", "BOUNDED_HANDOFF"]);
export const CHECKPOINT_NEXT_ACTIONS = Object.freeze([
  "CAMPAIGN_ORCHESTRATOR",
  "INDEPENDENT_AUDITOR",
  "OWNER_REVIEW",
  "REPLACE_STALLED_WORKER",
  "STOPPED",
  "COMPLETE",
]);

// Protected actions are intentionally always false in this prepared, inactive slice.
export {MAX_REVIEW_INTERVAL_MINUTES, MIN_REVIEW_INTERVAL_MINUTES, PROTECTED_ACTIONS};

export const REGULATOR_DECISION_CAPABILITY = Symbol("agentos.intent-regulator.decision-capability");
export const OWNER_DECISION_CAPABILITY = Symbol("agentos.intent-regulator.owner-decision-capability");
export const OWNER_DECISIONS = Object.freeze(["REPLACE_GOAL"]);

export function defaultGovernanceDigest() {
  return canonicalDigest({schema: PERSISTENT_INTENT_RUNTIME_SCHEMA, version: PERSISTENT_INTENT_RUNTIME_VERSION});
}

export function compilePersistentIntentRuntimeContract({records} = {}) {
  requireRecord(records, "persistent Intent Regulator/Runtime contract records");
  const contract = {
    schema: PERSISTENT_INTENT_RUNTIME_CONTRACT_SCHEMA,
    version: PERSISTENT_INTENT_RUNTIME_CONTRACT_VERSION,
    status: ACTIVATION_STATUS,
    authority: {
      regulator_role: INTENT_REGULATOR_ROLE,
      runtime_role: RUNTIME_ROLE,
      sole_state_writer: RUNTIME_ROLE,
      regulator_mode: "GUIDE_ONLY",
      protected_actions: clone(PROTECTED_ACTIONS),
    },
    storage: {
      authority_root: "OUTSIDE_REPOSITORY",
      event_log: "APPEND_ONLY_HASH_CHAIN",
      snapshot_cas: "ATOMIC_RENAME_FSYNC",
      transaction_recovery: "PREPARED_TRANSACTION_REPLAY_OR_FAIL_CLOSED",
      fencing: "MONOTONIC_LEASE_EPOCH",
    },
    records: clone(records),
    decisions: [...REGULATOR_DECISIONS].sort(compareUtf8),
    activation: {
      status: ACTIVATION_STATUS,
      requires_explicit_owner_approval: true,
      product_writes_allowed: false,
      protected_actions_enabled: false,
    },
  };
  return validatePersistentIntentRuntimeContract(contract);
}

export function validatePersistentIntentRuntimeContract(contract) {
  exactKeys(contract, ["schema", "version", "status", "authority", "storage", "records", "decisions", "activation"],
    "persistent Intent Regulator/Runtime contract");
  assert(contract.schema === PERSISTENT_INTENT_RUNTIME_CONTRACT_SCHEMA && contract.version === PERSISTENT_INTENT_RUNTIME_CONTRACT_VERSION,
    "persistent Intent Regulator/Runtime contract identity is invalid");
  assert(contract.status === ACTIVATION_STATUS, "persistent Intent Regulator/Runtime contract status is invalid");

  exactKeys(contract.authority, ["regulator_role", "runtime_role", "sole_state_writer", "regulator_mode", "protected_actions"],
    "persistent Runtime authority contract");
  assert(contract.authority.regulator_role === INTENT_REGULATOR_ROLE, "persistent Runtime regulator role is invalid");
  assert(contract.authority.runtime_role === RUNTIME_ROLE, "persistent Runtime role is invalid");
  assert(contract.authority.sole_state_writer === RUNTIME_ROLE, "Runtime must remain the sole state writer", "RUNTIME_AUTHORITY_BOUNDARY");
  assert(contract.authority.regulator_mode === "GUIDE_ONLY", "Intent Regulator mode is invalid", "REGULATOR_AUTHORITY_BOUNDARY");
  validateProtectedActions(contract.authority.protected_actions, "persistent Runtime authority protected actions");

  exactKeys(contract.storage, ["authority_root", "event_log", "snapshot_cas", "transaction_recovery", "fencing"],
    "persistent Runtime storage contract");
  assert(contract.storage.authority_root === "OUTSIDE_REPOSITORY", "persistent Runtime authority root boundary is invalid");
  assert(contract.storage.event_log === "APPEND_ONLY_HASH_CHAIN", "persistent Runtime event log contract is invalid");
  assert(contract.storage.snapshot_cas === "ATOMIC_RENAME_FSYNC", "persistent Runtime snapshot storage contract is invalid");
  assert(contract.storage.transaction_recovery === "PREPARED_TRANSACTION_REPLAY_OR_FAIL_CLOSED", "persistent Runtime recovery contract is invalid");
  assert(contract.storage.fencing === "MONOTONIC_LEASE_EPOCH", "persistent Runtime fencing contract is invalid");

  requireRecord(contract.records, "persistent Runtime contract records");
  const requiredRecordKeys = ["state", "persistent_roles", "lease", "event", "checkpoint", "transaction", "decision"];
  const allowedRecordKeys = [...requiredRecordKeys, "owner_goal_replacement"];
  const recordKeys = Object.keys(contract.records).sort(compareUtf8);
  const requiredSorted = [...requiredRecordKeys].sort(compareUtf8);
  const allowedSorted = [...allowedRecordKeys].sort(compareUtf8);
  assert(JSON.stringify(recordKeys) === JSON.stringify(requiredSorted) || JSON.stringify(recordKeys) === JSON.stringify(allowedSorted),
    "persistent Runtime contract record fields mismatch");
  validatePersistentIntentRuntimeState(contract.records.state);
  assert(Array.isArray(contract.records.persistent_roles) && contract.records.persistent_roles.length === PERSISTENT_ROLE_IDS.length,
    "persistent Runtime contract role records are incomplete");
  for (const role of contract.records.persistent_roles) validatePersistentRoleRecord(role);
  assert(persistentRolesDigest(contract.records.persistent_roles) === contract.records.state.persistent_roles_sha256,
    "persistent Runtime contract role set differs from state");
  validateLeaseRecord(contract.records.lease);
  validateEvent(contract.records.event);
  validateIntentRegulatorCheckpoint(contract.records.checkpoint);
  validateTransaction(contract.records.transaction);
  validateIntentRegulatorDecision(contract.records.decision);
  assert(contract.records.transaction.event.event_sha256 === contract.records.event.event_sha256,
    "persistent Runtime contract event differs from transaction");
  assert(contract.records.transaction.next_state.state_sha256 === contract.records.state.state_sha256,
    "persistent Runtime contract state differs from transaction");
  if (Object.hasOwn(contract.records, "owner_goal_replacement")) validateOwnerGoalReplacement(contract.records.owner_goal_replacement);

  requireSortedUnique(contract.decisions, "persistent Runtime contract decisions");
  assert(JSON.stringify(contract.decisions) === JSON.stringify([...REGULATOR_DECISIONS].sort(compareUtf8)),
    "persistent Runtime contract decision set is incomplete");

  exactKeys(contract.activation, ["status", "requires_explicit_owner_approval", "product_writes_allowed", "protected_actions_enabled"],
    "persistent Runtime activation contract");
  assert(contract.activation.status === ACTIVATION_STATUS, "persistent Runtime activation status is invalid");
  assert(contract.activation.requires_explicit_owner_approval === true, "persistent Runtime activation requires owner approval");
  assert(contract.activation.product_writes_allowed === false, "persistent Runtime product writes must remain disabled", "PROTECTED_ACTION_BLOCKED");
  assert(contract.activation.protected_actions_enabled === false, "persistent Runtime protected actions must remain disabled", "PROTECTED_ACTION_BLOCKED");
  privacyCheck(contract, "persistent Runtime contract");
  return contract;
}

export function compilePersistentRoleRecord({roleId, projectId, environmentId, sourceCommit, sourceTree, governanceDigest = defaultGovernanceDigest(), createdAtUtc, updatedAtUtc = createdAtUtc} = {}) {
  assert(PERSISTENT_ROLE_IDS.includes(roleId), "persistent role ID is invalid");
  requireIdentifier(projectId, "persistent role project ID");
  requireIdentifier(environmentId, "persistent role environment ID");
  requireSourceSha(sourceCommit, "persistent role source commit");
  requireSourceSha(sourceTree, "persistent role source tree");
  requireSha(governanceDigest, "persistent role governance digest");
  requireUtc(createdAtUtc, "persistent role creation time");
  requireUtc(updatedAtUtc, "persistent role update time");
  const role = {
    schema: PERSISTENT_ROLE_SCHEMA,
    version: PERSISTENT_ROLE_VERSION,
    activation_status: ACTIVATION_STATUS,
    role_id: roleId,
    display_name: PERSISTENT_ROLE_DISPLAY_NAMES[roleId],
    lifetime: "PERSISTENT",
    status: "CONTROL_PLANE_READY",
    binding_status: "UNBOUND_HOST_SESSION",
    project_id: projectId,
    environment_id: environmentId,
    host_session_ref: null,
    source_commit: sourceCommit,
    source_tree: sourceTree,
    governance_digest: governanceDigest,
    created_at_utc: createdAtUtc,
    updated_at_utc: updatedAtUtc,
    role_sha256: null,
  };
  role.role_sha256 = digestWithout(role, "role_sha256");
  return validatePersistentRoleRecord(role);
}

export function validatePersistentRoleRecord(role) {
  const keys = [
    "schema", "version", "activation_status", "role_id", "display_name", "lifetime", "status", "binding_status",
    "project_id", "environment_id", "host_session_ref", "source_commit", "source_tree", "governance_digest", "created_at_utc", "updated_at_utc", "role_sha256",
  ];
  exactKeys(role, keys, "persistent role record");
  assert(role.schema === PERSISTENT_ROLE_SCHEMA && role.version === PERSISTENT_ROLE_VERSION, "persistent role record identity is invalid");
  assert(role.activation_status === ACTIVATION_STATUS, "persistent role activation status is invalid");
  assert(PERSISTENT_ROLE_IDS.includes(role.role_id), "persistent role ID is invalid");
  assert(role.display_name === PERSISTENT_ROLE_DISPLAY_NAMES[role.role_id], "persistent role display name is invalid");
  assert(role.lifetime === "PERSISTENT", "persistent role lifetime is invalid");
  assert(role.status === "CONTROL_PLANE_READY", "persistent role status is invalid");
  assert(role.binding_status === "UNBOUND_HOST_SESSION", "persistent role binding status is invalid");
  requireIdentifier(role.project_id, "persistent role project ID");
  requireIdentifier(role.environment_id, "persistent role environment ID");
  assert(role.host_session_ref === null, "host session binding belongs to the host adapter lane", "PERSISTENT_ROLE_AUTHORITY_BOUNDARY");
  requireSourceSha(role.source_commit, "persistent role source commit");
  requireSourceSha(role.source_tree, "persistent role source tree");
  requireSha(role.governance_digest, "persistent role governance digest");
  requireUtc(role.created_at_utc, "persistent role creation time");
  requireUtc(role.updated_at_utc, "persistent role update time");
  requireSha(role.role_sha256, "persistent role digest");
  assert(role.role_sha256 === digestWithout(role, "role_sha256"), "persistent role digest mismatch");
  privacyCheck(role, "persistent role record");
  return role;
}

export function persistentRolesDigest(roles) {
  const ordered = [...roles].sort((left, right) => compareUtf8(left.role_id, right.role_id));
  assert(JSON.stringify(ordered.map((role) => role.role_id)) === JSON.stringify([...PERSISTENT_ROLE_IDS].sort(compareUtf8)), "persistent role set is incomplete");
  return canonicalDigest(ordered.map((role) => ({role_id: role.role_id, role_sha256: role.role_sha256})));
}

export function validateCampaignSnapshot(snapshot) {
  const keys = [
    "schema", "version", "project_id", "campaign_id", "campaign_version", "goal_id", "goal_sha256",
    "source_commit", "source_tree", "progress_status", "scope_changed", "intent_changed", "conditions_changed",
    "hard_boundary_detected", "soft_boundary_detected", "evidence_identity_ok", "roster_exact", "acceptance_status",
  ];
  exactKeys(snapshot, keys, "campaign snapshot");
  assert(snapshot.schema === SNAPSHOT_SCHEMA && snapshot.version === SNAPSHOT_VERSION, "campaign snapshot identity is invalid");
  for (const field of ["project_id", "campaign_id", "campaign_version", "goal_id"]) requireIdentifier(snapshot[field], `campaign snapshot ${field}`);
  requireSha(snapshot.goal_sha256, "campaign snapshot goal digest");
  requireSourceSha(snapshot.source_commit, "campaign snapshot source commit");
  requireSourceSha(snapshot.source_tree, "campaign snapshot source tree");
  assert(PROGRESS_STATUSES.includes(snapshot.progress_status), "campaign snapshot progress status is invalid");
  assert(ACCEPTANCE_STATUSES.includes(snapshot.acceptance_status), "campaign snapshot acceptance status is invalid");
  for (const field of [
    "scope_changed", "intent_changed", "conditions_changed", "hard_boundary_detected", "soft_boundary_detected",
    "evidence_identity_ok", "roster_exact",
  ]) requireBoolean(snapshot[field], `campaign snapshot ${field}`);
  privacyCheck(snapshot, "campaign snapshot");
  return snapshot;
}

export function validateIntentRegulatorSnapshot(snapshot) {
  return validateCampaignSnapshot(snapshot);
}

function decisionForSnapshot(snapshot) {
  if (snapshot.hard_boundary_detected) {
    return {
      decision: "STOP_HARD_BOUNDARY",
      route: "OWNER_REVIEW",
      target_role: "OWNER",
      reasons: ["A hard boundary was detected; dependent work must stop."],
    };
  }
  if (snapshot.scope_changed || snapshot.intent_changed || snapshot.conditions_changed) {
    return {
      decision: "REASSESS_AND_REPLACE_GOAL",
      route: "OWNER_REVIEW",
      target_role: "OWNER",
      reasons: ["The bound goal, scope, intent, or operating conditions changed."],
    };
  }
  if (!snapshot.evidence_identity_ok || !snapshot.roster_exact) {
    return {
      decision: "STOP_HARD_BOUNDARY",
      route: "OWNER_REVIEW",
      target_role: "OWNER",
      reasons: ["Evidence identity or active roster binding is not exact."],
    };
  }
  if (snapshot.soft_boundary_detected) {
    return {
      decision: "ORCHESTRATOR_REVIEW",
      route: "CAMPAIGN_ORCHESTRATOR",
      target_role: "CAMPAIGN_ORCHESTRATOR",
      reasons: ["A soft boundary requires Orchestrator review before dependent work continues."],
    };
  }
  if (snapshot.progress_status === "STALLED") {
    return {
      decision: "REPLACE_STALLED_WORKER",
      route: "CAMPAIGN_ORCHESTRATOR",
      target_role: "CAMPAIGN_ORCHESTRATOR",
      reasons: ["The meaningful-progress window expired without an acceptable result."],
    };
  }
  if (snapshot.acceptance_status === "CANDIDATE") {
    return {
      decision: "AWAIT_ACCEPTANCE",
      route: "INDEPENDENT_AUDITOR",
      target_role: "INDEPENDENT_AUDITOR",
      reasons: ["A candidate result is waiting for independent Auditor acceptance."],
    };
  }
  return {
    decision: "CONTINUE_CAMPAIGN",
    route: "CAMPAIGN_ORCHESTRATOR",
    target_role: "CAMPAIGN_ORCHESTRATOR",
    reasons: ["The bound source, scope, evidence, roster, and progress state remain healthy."],
  };
}

export function compileIntentRegulatorDecision(snapshot, {observedAtUtc = new Date().toISOString(), intervalMinutes = DEFAULT_REVIEW_INTERVAL_MINUTES} = {}) {
  validateCampaignSnapshot(snapshot);
  requireUtc(observedAtUtc, "Intent Regulator observation time");
  requireInterval(intervalMinutes);
  const selected = decisionForSnapshot(snapshot);
  const decision = {
    schema: DECISION_SCHEMA,
    version: DECISION_VERSION,
    activation_status: ACTIVATION_STATUS,
    actor_role: INTENT_REGULATOR_ROLE,
    authority_mode: "GUIDE_ONLY",
    project_id: snapshot.project_id,
    campaign_id: snapshot.campaign_id,
    campaign_version: snapshot.campaign_version,
    goal_id: snapshot.goal_id,
    goal_sha256: snapshot.goal_sha256,
    source_commit: snapshot.source_commit,
    source_tree: snapshot.source_tree,
    snapshot_sha256: canonicalDigest(snapshot),
    interval_minutes: intervalMinutes,
    decision: selected.decision,
    route: selected.route,
    target_role: selected.target_role,
    reasons: [...selected.reasons].sort(compareUtf8),
    observed_at_utc: observedAtUtc,
    protected_actions: clone(PROTECTED_ACTIONS),
    decision_sha256: null,
  };
  decision.decision_sha256 = digestWithout(decision, "decision_sha256");
  validateIntentRegulatorDecision(decision);
  Object.defineProperty(decision, REGULATOR_DECISION_CAPABILITY, {value: true, enumerable: false, configurable: false, writable: false});
  return Object.freeze(decision);
}

export function validateIntentRegulatorDecision(decision) {
  const keys = [
    "schema", "version", "activation_status", "actor_role", "authority_mode", "project_id", "campaign_id",
    "campaign_version", "goal_id", "goal_sha256", "source_commit", "source_tree", "snapshot_sha256",
    "interval_minutes", "decision", "route", "target_role", "reasons", "observed_at_utc", "protected_actions", "decision_sha256",
  ];
  exactKeys(decision, keys, "Intent Regulator decision");
  assert(decision.schema === DECISION_SCHEMA && decision.version === DECISION_VERSION, "Intent Regulator decision identity is invalid");
  assert(decision.activation_status === ACTIVATION_STATUS, "Intent Regulator decision activation status is invalid");
  assert(decision.actor_role === INTENT_REGULATOR_ROLE, "only Intent Regulator may author a regulator decision", "REGULATOR_AUTHORITY_BOUNDARY");
  assert(decision.authority_mode === "GUIDE_ONLY", "Intent Regulator decision authority mode is invalid", "REGULATOR_AUTHORITY_BOUNDARY");
  for (const field of ["project_id", "campaign_id", "campaign_version", "goal_id"]) requireIdentifier(decision[field], `Intent Regulator decision ${field}`);
  requireSha(decision.goal_sha256, "Intent Regulator decision goal digest");
  requireSourceSha(decision.source_commit, "Intent Regulator decision source commit");
  requireSourceSha(decision.source_tree, "Intent Regulator decision source tree");
  requireSha(decision.snapshot_sha256, "Intent Regulator decision snapshot digest");
  requireInterval(decision.interval_minutes, "Intent Regulator decision interval");
  assert(REGULATOR_DECISIONS.includes(decision.decision), "Intent Regulator decision kind is invalid");
  assert(typeof decision.route === "string" && decision.route.length > 0, "Intent Regulator decision route is invalid");
  assert(typeof decision.target_role === "string" && decision.target_role.length > 0, "Intent Regulator decision target role is invalid");
  requireSortedUnique(decision.reasons, "Intent Regulator decision reasons");
  requireUtc(decision.observed_at_utc, "Intent Regulator decision observation time");
  validateProtectedActions(decision.protected_actions);
  requireSha(decision.decision_sha256, "Intent Regulator decision digest");
  assert(decision.decision_sha256 === digestWithout(decision, "decision_sha256"), "Intent Regulator decision digest mismatch");
  privacyCheck(decision, "Intent Regulator decision");
  return decision;
}

export function compileOwnerGoalReplacement({state, goalId, goalSha256, sourceCommit = state?.source_commit, sourceTree = state?.source_tree, ownerDecisionRef, approvedAtUtc = new Date().toISOString()} = {}) {
  validatePersistentIntentRuntimeState(state);
  assert(state.status === "REASSESSMENT_REQUIRED", "owner goal replacement requires a pending reassessment", "OWNER_DECISION_REQUIRED");
  requireIdentifier(goalId, "owner replacement goal ID");
  requireSha(goalSha256, "owner replacement goal digest");
  requireSourceSha(sourceCommit, "owner replacement source commit");
  requireSourceSha(sourceTree, "owner replacement source tree");
  assert(sourceCommit === state.source_commit && sourceTree === state.source_tree,
    "owner goal replacement requires a fresh source-bound Runtime when source identity changes", "SOURCE_BINDING_MISMATCH");
  requireIdentifier(ownerDecisionRef, "owner replacement decision reference");
  requireUtc(approvedAtUtc, "owner replacement approval time");
  assert(goalId !== state.goal_id || goalSha256 !== state.goal_sha256, "owner replacement must change the goal identity", "OWNER_DECISION_INVALID");
  const decision = {
    schema: OWNER_DECISION_SCHEMA,
    version: OWNER_DECISION_VERSION,
    activation_status: ACTIVATION_STATUS,
    decision: "REPLACE_GOAL",
    authority_mode: "OWNER_REVIEW",
    project_id: state.project_id,
    campaign_id: state.campaign_id,
    campaign_version: state.campaign_version,
    prior_goal_id: state.goal_id,
    prior_goal_sha256: state.goal_sha256,
    goal_id: goalId,
    goal_sha256: goalSha256,
    source_commit: sourceCommit,
    source_tree: sourceTree,
    owner_decision_ref: ownerDecisionRef,
    approved_at_utc: approvedAtUtc,
    protected_actions: clone(PROTECTED_ACTIONS),
    decision_sha256: null,
  };
  decision.decision_sha256 = digestWithout(decision, "decision_sha256");
  validateOwnerGoalReplacement(decision);
  Object.defineProperty(decision, OWNER_DECISION_CAPABILITY, {value: true, enumerable: false, configurable: false, writable: false});
  return Object.freeze(decision);
}

export function validateOwnerGoalReplacement(decision) {
  const keys = [
    "schema", "version", "activation_status", "decision", "authority_mode", "project_id", "campaign_id", "campaign_version",
    "prior_goal_id", "prior_goal_sha256", "goal_id", "goal_sha256", "source_commit", "source_tree", "owner_decision_ref",
    "approved_at_utc", "protected_actions", "decision_sha256",
  ];
  exactKeys(decision, keys, "owner goal replacement decision");
  assert(decision.schema === OWNER_DECISION_SCHEMA && decision.version === OWNER_DECISION_VERSION, "owner goal replacement decision identity is invalid");
  assert(decision.activation_status === ACTIVATION_STATUS, "owner goal replacement activation status is invalid");
  assert(decision.decision === "REPLACE_GOAL", "owner goal replacement decision kind is invalid");
  assert(decision.authority_mode === "OWNER_REVIEW", "owner goal replacement authority mode is invalid", "OWNER_DECISION_REQUIRED");
  for (const field of ["project_id", "campaign_id", "campaign_version", "prior_goal_id", "goal_id", "owner_decision_ref"]) requireIdentifier(decision[field], `owner goal replacement ${field}`);
  for (const field of ["prior_goal_sha256", "goal_sha256"]) requireSha(decision[field], `owner goal replacement ${field}`);
  requireSourceSha(decision.source_commit, "owner goal replacement source commit");
  requireSourceSha(decision.source_tree, "owner goal replacement source tree");
  requireUtc(decision.approved_at_utc, "owner goal replacement approval time");
  validateProtectedActions(decision.protected_actions, "owner goal replacement protected actions");
  assert(decision.goal_id !== decision.prior_goal_id || decision.goal_sha256 !== decision.prior_goal_sha256, "owner goal replacement must change the goal identity", "OWNER_DECISION_INVALID");
  requireSha(decision.decision_sha256, "owner goal replacement decision digest");
  assert(decision.decision_sha256 === digestWithout(decision, "decision_sha256"), "owner goal replacement decision digest mismatch");
  privacyCheck(decision, "owner goal replacement decision");
  return decision;
}

export function transitionForOwnerGoalReplacement(current, decision, nowUtc) {
  validatePersistentIntentRuntimeState(current);
  validateOwnerGoalReplacement(decision);
  assert(current.status === "REASSESSMENT_REQUIRED", "Runtime has no pending goal reassessment", "OWNER_DECISION_NOT_EXPECTED");
  assert(decision.project_id === current.project_id && decision.campaign_id === current.campaign_id && decision.campaign_version === current.campaign_version,
    "owner replacement campaign differs from Runtime state", "REGULATOR_BINDING_MISMATCH");
  assert(decision.prior_goal_id === current.goal_id && decision.prior_goal_sha256 === current.goal_sha256,
    "owner replacement predecessor goal differs from Runtime state", "REGULATOR_BINDING_MISMATCH");
  assert(decision.source_commit === current.source_commit && decision.source_tree === current.source_tree,
    "owner replacement cannot carry a stale Runtime across a source change", "SOURCE_BINDING_MISMATCH");
  requireUtc(nowUtc, "owner replacement transition time");
  return {
    ...current,
    status: "ACTIVE",
    goal_id: decision.goal_id,
    goal_sha256: decision.goal_sha256,
    source_commit: decision.source_commit,
    source_tree: decision.source_tree,
    last_observation_sha256: null,
    last_decision_sha256: null,
    last_decision: null,
    last_idempotency_key: null,
    route_status: "CAMPAIGN_ORCHESTRATOR",
    pending_owner_decision: null,
    dependent_work_allowed: true,
    checkpoint_id: null,
    checkpoint_sha256: null,
    updated_at_utc: nowUtc,
    state_sha256: null,
  };
}

function validateMeaningfulProgress(value, label = "meaningful progress") {
  if (value === null) return null;
  const keys = ["result_type", "artifact_sha256", "evidence_sha256", "handoff_sha256", "summary_sha256"];
  exactKeys(value, keys, label);
  assert(MEANINGFUL_RESULT_TYPES.includes(value.result_type), `${label} result type is not meaningful`);
  for (const field of ["artifact_sha256", "evidence_sha256", "handoff_sha256", "summary_sha256"]) requireSha(value[field], `${label} ${field}`);
  privacyCheck(value, label);
  return value;
}

export function validateIntentRegulatorCheckpoint(checkpoint) {
  const keys = [
    "schema", "version", "activation_status", "checkpoint_id", "project_id", "campaign_id", "campaign_version",
    "goal_id", "goal_sha256", "source_commit", "source_tree", "phase_index", "lane_index", "step", "next_action",
    "progress_status", "meaningful_progress", "last_meaningful_progress_at_utc", "evidence_identity_ok", "created_at_utc", "checkpoint_sha256",
  ];
  exactKeys(checkpoint, keys, "Intent Regulator checkpoint");
  assert(checkpoint.schema === CHECKPOINT_SCHEMA && checkpoint.version === CHECKPOINT_VERSION, "Intent Regulator checkpoint identity is invalid");
  assert(checkpoint.activation_status === ACTIVATION_STATUS, "Intent Regulator checkpoint activation status is invalid");
  for (const field of ["checkpoint_id", "project_id", "campaign_id", "campaign_version", "goal_id"]) requireIdentifier(checkpoint[field], `checkpoint ${field}`);
  requireSha(checkpoint.goal_sha256, "checkpoint goal digest");
  requireSourceSha(checkpoint.source_commit, "checkpoint source commit");
  requireSourceSha(checkpoint.source_tree, "checkpoint source tree");
  requireNonnegativeInteger(checkpoint.phase_index, "checkpoint phase index");
  requireNonnegativeInteger(checkpoint.lane_index, "checkpoint lane index");
  requireIdentifier(checkpoint.step, "checkpoint step");
  assert(CHECKPOINT_NEXT_ACTIONS.includes(checkpoint.next_action), "checkpoint next action is invalid");
  assert(PROGRESS_STATUSES.includes(checkpoint.progress_status), "checkpoint progress status is invalid");
  validateMeaningfulProgress(checkpoint.meaningful_progress);
  requireNullable(checkpoint.last_meaningful_progress_at_utc, requireUtc, "checkpoint last meaningful progress time");
  requireBoolean(checkpoint.evidence_identity_ok, "checkpoint evidence identity");
  if (checkpoint.progress_status === "PROGRESS_RECORDED") {
    assert(checkpoint.meaningful_progress !== null, "progress-recorded checkpoint requires meaningful progress");
    assert(checkpoint.last_meaningful_progress_at_utc !== null, "progress-recorded checkpoint requires a progress time");
    assert(checkpoint.evidence_identity_ok === true, "progress-recorded checkpoint requires identity-bound evidence");
  }
  if (checkpoint.progress_status === "OPEN") {
    assert(checkpoint.meaningful_progress === null, "open checkpoint cannot claim meaningful progress");
  }
  requireUtc(checkpoint.created_at_utc, "checkpoint creation time");
  requireSha(checkpoint.checkpoint_sha256, "checkpoint digest");
  assert(checkpoint.checkpoint_sha256 === digestWithout(checkpoint, "checkpoint_sha256"), "checkpoint digest mismatch");
  privacyCheck(checkpoint, "Intent Regulator checkpoint");
  return checkpoint;
}

export function createGenesisDigest({projectId, environmentId, campaignId, campaignVersion, goalId, goalSha256, sourceCommit, sourceTree, createdAtUtc}) {
  return canonicalDigest({
    schema: "agentos.intent_regulator_runtime_genesis.v1",
    version: 1,
    project_id: projectId,
    environment_id: environmentId,
    campaign_id: campaignId,
    campaign_version: campaignVersion,
    goal_id: goalId,
    goal_sha256: goalSha256,
    source_commit: sourceCommit,
    source_tree: sourceTree,
    created_at_utc: createdAtUtc,
  });
}

export function createInitialState({snapshot, environmentId, reviewIntervalMinutes, persistentRolesSha256, createdAtUtc}) {
  validateCampaignSnapshot(snapshot);
  requireIdentifier(environmentId, "runtime environment ID");
  requireInterval(reviewIntervalMinutes);
  requireSha(persistentRolesSha256, "persistent role set digest");
  requireUtc(createdAtUtc, "runtime creation time");
  const state = {
    schema: STATE_SCHEMA,
    version: STATE_VERSION,
    activation_status: ACTIVATION_STATUS,
    status: "READY",
    project_id: snapshot.project_id,
    environment_id: environmentId,
    campaign_id: snapshot.campaign_id,
    campaign_version: snapshot.campaign_version,
    goal_id: snapshot.goal_id,
    goal_sha256: snapshot.goal_sha256,
    source_commit: snapshot.source_commit,
    source_tree: snapshot.source_tree,
    review_interval_minutes: reviewIntervalMinutes,
    intent_regulator_role: INTENT_REGULATOR_ROLE,
    runtime_role: RUNTIME_ROLE,
    persistent_role_ids: [...PERSISTENT_ROLE_IDS].sort(compareUtf8),
    persistent_roles_sha256: persistentRolesSha256,
    last_observation_sha256: canonicalDigest(snapshot),
    last_decision_sha256: null,
    last_decision: null,
    last_idempotency_key: null,
    route_status: "WAITING",
    pending_owner_decision: null,
    dependent_work_allowed: true,
    checkpoint_id: null,
    checkpoint_sha256: null,
    event_cursor: 0,
    event_ledger_head_sha256: GENESIS_EVENT_HEAD_SHA256,
    genesis_state_sha256: createGenesisDigest({
      projectId: snapshot.project_id,
      environmentId,
      campaignId: snapshot.campaign_id,
      campaignVersion: snapshot.campaign_version,
      goalId: snapshot.goal_id,
      goalSha256: snapshot.goal_sha256,
      sourceCommit: snapshot.source_commit,
      sourceTree: snapshot.source_tree,
      createdAtUtc,
    }),
    protected_actions: clone(PROTECTED_ACTIONS),
    created_at_utc: createdAtUtc,
    updated_at_utc: createdAtUtc,
    state_sha256: null,
  };
  state.state_sha256 = stateContentDigest(state);
  return validatePersistentIntentRuntimeState(state);
}

export function validatePersistentIntentRuntimeState(state) {
  const keys = [
    "schema", "version", "activation_status", "status", "project_id", "environment_id", "campaign_id", "campaign_version",
    "goal_id", "goal_sha256", "source_commit", "source_tree", "review_interval_minutes", "intent_regulator_role", "runtime_role",
    "persistent_role_ids", "persistent_roles_sha256",
    "last_observation_sha256", "last_decision_sha256", "last_decision", "last_idempotency_key", "route_status", "pending_owner_decision",
    "dependent_work_allowed", "checkpoint_id", "checkpoint_sha256", "event_cursor", "event_ledger_head_sha256", "genesis_state_sha256",
    "protected_actions", "created_at_utc", "updated_at_utc", "state_sha256",
  ];
  exactKeys(state, keys, "persistent Intent Regulator/Runtime state");
  assert(state.schema === STATE_SCHEMA && state.version === STATE_VERSION, "persistent state identity is invalid");
  assert(state.activation_status === ACTIVATION_STATUS, "persistent state activation status is invalid");
  assert(REGULATOR_STATUSES.includes(state.status), "persistent state status is invalid");
  for (const field of ["project_id", "environment_id", "campaign_id", "campaign_version", "goal_id"]) requireIdentifier(state[field], `persistent state ${field}`);
  requireSha(state.goal_sha256, "persistent state goal digest");
  requireSourceSha(state.source_commit, "persistent state source commit");
  requireSourceSha(state.source_tree, "persistent state source tree");
  requireInterval(state.review_interval_minutes, "persistent state review interval");
  assert(state.intent_regulator_role === INTENT_REGULATOR_ROLE, "persistent state Intent Regulator role is invalid");
  assert(state.runtime_role === RUNTIME_ROLE, "persistent state Runtime role is invalid");
  assert(JSON.stringify(state.persistent_role_ids) === JSON.stringify([...PERSISTENT_ROLE_IDS].sort(compareUtf8)), "persistent state role set is invalid");
  requireSha(state.persistent_roles_sha256, "persistent role set digest");
  requireNullable(state.last_observation_sha256, requireSha, "persistent state observation digest");
  requireNullable(state.last_decision_sha256, requireSha, "persistent state decision digest");
  requireNullable(state.last_idempotency_key, requireIdentifier, "persistent state idempotency key");
  assert(state.last_decision === null || REGULATOR_DECISIONS.includes(state.last_decision), "persistent state last decision is invalid");
  assert(["WAITING", "CAMPAIGN_ORCHESTRATOR", "OWNER_REVIEW", "INDEPENDENT_AUDITOR"].includes(state.route_status), "persistent state route is invalid");
  assert(state.pending_owner_decision === null || ["REPLACE_GOAL", "HARD_BOUNDARY_REVIEW", "SOFT_BOUNDARY_REVIEW", "REPLACE_STALLED_WORKER"].includes(state.pending_owner_decision), "persistent state owner decision is invalid");
  requireBoolean(state.dependent_work_allowed, "persistent state dependent-work flag");
  requireNullable(state.checkpoint_id, requireIdentifier, "persistent state checkpoint ID");
  requireNullable(state.checkpoint_sha256, requireSha, "persistent state checkpoint digest");
  requireNonnegativeInteger(state.event_cursor, "persistent state event cursor");
  requireSha(state.event_ledger_head_sha256, "persistent state event head");
  requireSha(state.genesis_state_sha256, "persistent state genesis digest");
  validateProtectedActions(state.protected_actions, "persistent state protected actions");
  requireUtc(state.created_at_utc, "persistent state creation time");
  requireUtc(state.updated_at_utc, "persistent state update time");
  requireSha(state.state_sha256, "persistent state digest");
  assert(state.state_sha256 === stateContentDigest(state), "persistent state digest mismatch");
  privacyCheck(state, "persistent state");
  return state;
}

export function validateLeaseRecord(lease) {
  const keys = [
    "schema", "version", "role", "status", "runtime_ref", "lease_id", "fencing_epoch", "acquired_at_utc", "renewed_at_utc",
    "expires_at_utc", "released_at_utc", "lease_sha256",
  ];
  exactKeys(lease, keys, "Runtime lease");
  assert(lease.schema === LEASE_SCHEMA && lease.version === LEASE_VERSION, "Runtime lease identity is invalid");
  assert(lease.role === RUNTIME_ROLE, "Runtime lease role is invalid");
  assert(["ACTIVE", "RELEASED"].includes(lease.status), "Runtime lease status is invalid");
  requireOpaqueReference(lease.runtime_ref, "Runtime lease runtime reference");
  requireOpaqueReference(lease.lease_id, "Runtime lease ID");
  assert(Number.isSafeInteger(lease.fencing_epoch) && lease.fencing_epoch >= 1, "Runtime lease fencing epoch is invalid");
  requireUtc(lease.acquired_at_utc, "Runtime lease acquisition time");
  requireUtc(lease.renewed_at_utc, "Runtime lease renewal time");
  requireUtc(lease.expires_at_utc, "Runtime lease expiry time");
  requireNullable(lease.released_at_utc, requireUtc, "Runtime lease release time");
  if (lease.status === "ACTIVE") assert(lease.released_at_utc === null, "active Runtime lease cannot have a release time");
  if (lease.status === "RELEASED") assert(lease.released_at_utc !== null, "released Runtime lease requires a release time");
  requireSha(lease.lease_sha256, "Runtime lease digest");
  assert(lease.lease_sha256 === digestWithout(lease, "lease_sha256"), "Runtime lease digest mismatch");
  privacyCheck(lease, "Runtime lease");
  return lease;
}

export function validatePersistentRuntimeLease(lease) {
  return validateLeaseRecord(lease);
}

export function validateEvent(event) {
  const keys = [
    "schema", "version", "sequence", "event_id", "event_type", "actor_role", "committed_by_role", "fencing_epoch",
    "idempotency_key", "parent_state_sha256", "parent_event_ledger_head_sha256", "next_state_sha256", "payload", "payload_sha256",
    "occurred_at_utc", "event_sha256",
  ];
  exactKeys(event, keys, "Runtime authority event");
  assert(event.schema === EVENT_SCHEMA && event.version === EVENT_VERSION, "Runtime authority event identity is invalid");
  assert(Number.isSafeInteger(event.sequence) && event.sequence >= 1, "Runtime authority event sequence is invalid");
  requireIdentifier(event.event_id, "Runtime authority event ID");
  assert(["REGULATOR_DECISION_COMMITTED", "CHECKPOINT_RECORDED", "OWNER_GOAL_REPLACEMENT_COMMITTED"].includes(event.event_type), "Runtime authority event type is invalid");
  assert([INTENT_REGULATOR_ROLE, RUNTIME_ROLE].includes(event.actor_role), "Runtime authority event actor role is invalid");
  assert(event.committed_by_role === RUNTIME_ROLE, "only Runtime may commit authority events", "RUNTIME_AUTHORITY_BOUNDARY");
  assert(Number.isSafeInteger(event.fencing_epoch) && event.fencing_epoch >= 1, "Runtime authority event fencing epoch is invalid");
  requireIdentifier(event.idempotency_key, "Runtime authority event idempotency key");
  requireSha(event.parent_state_sha256, "Runtime authority event parent state digest");
  requireSha(event.parent_event_ledger_head_sha256, "Runtime authority event parent event head");
  requireSha(event.next_state_sha256, "Runtime authority event next state digest");
  requireRecord(event.payload, "Runtime authority event payload");
  requireSha(event.payload_sha256, "Runtime authority event payload digest");
  assert(event.payload_sha256 === canonicalDigest(event.payload), "Runtime authority event payload digest mismatch");
  if (event.event_type === "REGULATOR_DECISION_COMMITTED") {
    assert(event.actor_role === INTENT_REGULATOR_ROLE, "regulator event actor must be Intent Regulator");
    validateIntentRegulatorDecision(event.payload);
  }
  if (event.event_type === "CHECKPOINT_RECORDED") {
    assert(event.actor_role === RUNTIME_ROLE, "checkpoint event actor must be Runtime");
    validateIntentRegulatorCheckpoint(event.payload);
  }
  if (event.event_type === "OWNER_GOAL_REPLACEMENT_COMMITTED") {
    assert(event.actor_role === RUNTIME_ROLE, "owner replacement event actor must be Runtime");
    validateOwnerGoalReplacement(event.payload);
  }
  requireUtc(event.occurred_at_utc, "Runtime authority event time");
  requireSha(event.event_sha256, "Runtime authority event digest");
  assert(event.event_sha256 === digestWithout(event, "event_sha256"), "Runtime authority event digest mismatch");
  privacyCheck(event, "Runtime authority event");
  return event;
}

export function validateTransaction(transaction) {
  const keys = [
    "schema", "version", "status", "transaction_id", "expected_current_state_sha256", "expected_event_head_sha256", "expected_checkpoint_sha256",
    "event", "next_state", "next_checkpoint", "prepared_at_utc", "committed_at_utc", "transaction_sha256",
  ];
  exactKeys(transaction, keys, "Runtime authority transaction");
  assert(transaction.schema === TRANSACTION_SCHEMA && transaction.version === TRANSACTION_VERSION, "Runtime authority transaction identity is invalid");
  assert(["PREPARED", "COMMITTED"].includes(transaction.status), "Runtime authority transaction status is invalid");
  requireOpaqueReference(transaction.transaction_id, "Runtime authority transaction ID");
  requireSha(transaction.expected_current_state_sha256, "Runtime authority transaction expected state");
  requireSha(transaction.expected_event_head_sha256, "Runtime authority transaction expected event head");
  requireNullable(transaction.expected_checkpoint_sha256, requireSha, "Runtime authority transaction expected checkpoint");
  validateEvent(transaction.event);
  validatePersistentIntentRuntimeState(transaction.next_state);
  assert(transaction.event.next_state_sha256 === transaction.next_state.state_sha256, "transaction event and state differ");
  assert(transaction.event.parent_event_ledger_head_sha256 === transaction.expected_event_head_sha256, "transaction event parent head differs");
  requireNullable(transaction.next_checkpoint, validateIntentRegulatorCheckpoint, "Runtime authority transaction checkpoint");
  if (transaction.next_checkpoint !== null) assert(transaction.next_state.checkpoint_sha256 === transaction.next_checkpoint.checkpoint_sha256, "transaction checkpoint pointer differs");
  requireUtc(transaction.prepared_at_utc, "Runtime authority transaction preparation time");
  requireNullable(transaction.committed_at_utc, requireUtc, "Runtime authority transaction commit time");
  if (transaction.status === "COMMITTED") assert(transaction.committed_at_utc !== null, "committed transaction requires commit time");
  if (transaction.status === "PREPARED") assert(transaction.committed_at_utc === null, "prepared transaction cannot have commit time");
  requireSha(transaction.transaction_sha256, "Runtime authority transaction digest");
  assert(transaction.transaction_sha256 === digestWithout(transaction, "transaction_sha256"), "Runtime authority transaction digest mismatch");
  privacyCheck(transaction, "Runtime authority transaction");
  return transaction;
}

export function transitionForDecision(current, decision, nowUtc) {
  const transitions = {
    CONTINUE_CAMPAIGN: {status: "ACTIVE", route_status: "CAMPAIGN_ORCHESTRATOR", pending_owner_decision: null, dependent_work_allowed: true},
    STOP_HARD_BOUNDARY: {status: "HARD_STOPPED", route_status: "OWNER_REVIEW", pending_owner_decision: "HARD_BOUNDARY_REVIEW", dependent_work_allowed: false},
    REASSESS_AND_REPLACE_GOAL: {status: "REASSESSMENT_REQUIRED", route_status: "OWNER_REVIEW", pending_owner_decision: "REPLACE_GOAL", dependent_work_allowed: false},
    ORCHESTRATOR_REVIEW: {status: "SOFT_REVIEW", route_status: "CAMPAIGN_ORCHESTRATOR", pending_owner_decision: "SOFT_BOUNDARY_REVIEW", dependent_work_allowed: false},
    REPLACE_STALLED_WORKER: {status: "REPLACEMENT_REQUIRED", route_status: "CAMPAIGN_ORCHESTRATOR", pending_owner_decision: "REPLACE_STALLED_WORKER", dependent_work_allowed: false},
    AWAIT_ACCEPTANCE: {status: "AWAITING_ACCEPTANCE", route_status: "INDEPENDENT_AUDITOR", pending_owner_decision: null, dependent_work_allowed: false},
  };
  const next = transitions[decision.decision];
  assert(next !== undefined, "unsupported regulator decision", "REGULATOR_DECISION_INVALID");
  if (current.status === "HARD_STOPPED" && decision.decision !== "STOP_HARD_BOUNDARY") {
    throw Object.assign(new Error("hard-stopped Runtime cannot continue without an explicit owner-controlled transition"), {code: "HARD_BOUNDARY_TERMINAL"});
  }
  if (current.status === "REASSESSMENT_REQUIRED" && decision.decision !== "REASSESS_AND_REPLACE_GOAL") {
    throw Object.assign(new Error("goal reassessment must be completed before dependent work continues"), {code: "REASSESSMENT_REQUIRED"});
  }
  return {
    ...current,
    ...next,
    last_observation_sha256: decision.snapshot_sha256,
    last_decision_sha256: decision.decision_sha256,
    last_decision: decision.decision,
    last_idempotency_key: null,
    updated_at_utc: nowUtc,
    state_sha256: null,
  };
}

export function assertDecisionMatchesState(state, decision) {
  assert(decision.project_id === state.project_id, "regulator decision project differs from Runtime state", "REGULATOR_BINDING_MISMATCH");
  assert(decision.campaign_id === state.campaign_id && decision.campaign_version === state.campaign_version, "regulator decision campaign differs from Runtime state", "REGULATOR_BINDING_MISMATCH");
  if (decision.goal_id !== state.goal_id) assert(decision.decision === "REASSESS_AND_REPLACE_GOAL", "goal identity changed without reassessment", "REGULATOR_BINDING_MISMATCH");
  if (decision.source_commit !== state.source_commit || decision.source_tree !== state.source_tree) {
    assert(["REASSESS_AND_REPLACE_GOAL", "STOP_HARD_BOUNDARY"].includes(decision.decision), "source changed without reassessment or hard stop", "REGULATOR_BINDING_MISMATCH");
  }
}

export function buildEvent({current, nextState, eventType, actorRole, fencingEpoch, idempotencyKey, payload, occurredAtUtc}) {
  const sequence = current.event_cursor + 1;
  const event = {
    schema: EVENT_SCHEMA,
    version: EVENT_VERSION,
    sequence,
    event_id: `EVENT_${String(sequence).padStart(12, "0")}`,
    event_type: eventType,
    actor_role: actorRole,
    committed_by_role: RUNTIME_ROLE,
    fencing_epoch: fencingEpoch,
    idempotency_key: idempotencyKey,
    parent_state_sha256: current.event_cursor === 0 ? current.genesis_state_sha256 : current.state_sha256,
    parent_event_ledger_head_sha256: current.event_ledger_head_sha256,
    next_state_sha256: nextState.state_sha256,
    payload: clone(payload),
    payload_sha256: canonicalDigest(payload),
    occurred_at_utc: occurredAtUtc,
    event_sha256: null,
  };
  event.event_sha256 = digestWithout(event, "event_sha256");
  return validateEvent(event);
}

export function buildTransaction({current, nextState, nextCheckpoint, event, idempotencyKey, preparedAtUtc}) {
  const transactionId = `TRANSACTION_REF_${canonicalDigest({
    expected_current_state_sha256: current.state_sha256,
    event_sha256: event.event_sha256,
    idempotency_key: idempotencyKey,
  })}`;
  const transaction = {
    schema: TRANSACTION_SCHEMA,
    version: TRANSACTION_VERSION,
    status: "PREPARED",
    transaction_id: transactionId,
    expected_current_state_sha256: current.state_sha256,
    expected_event_head_sha256: current.event_ledger_head_sha256,
    expected_checkpoint_sha256: current.checkpoint_sha256,
    event,
    next_state: nextState,
    next_checkpoint: nextCheckpoint === null ? null : clone(nextCheckpoint),
    prepared_at_utc: preparedAtUtc,
    committed_at_utc: null,
    transaction_sha256: null,
  };
  transaction.transaction_sha256 = digestWithout(transaction, "transaction_sha256");
  return validateTransaction(transaction);
}

export function assertIdentityForCheckpoint(state, checkpoint) {
  assert(checkpoint.project_id === state.project_id && checkpoint.campaign_id === state.campaign_id && checkpoint.campaign_version === state.campaign_version,
    "checkpoint campaign differs from Runtime state", "RUNTIME_CHECKPOINT_BOUNDARY");
  assert(checkpoint.goal_id === state.goal_id && checkpoint.goal_sha256 === state.goal_sha256, "checkpoint goal differs from Runtime state", "RUNTIME_CHECKPOINT_BOUNDARY");
  assert(checkpoint.source_commit === state.source_commit && checkpoint.source_tree === state.source_tree, "checkpoint source differs from Runtime state", "RUNTIME_CHECKPOINT_BOUNDARY");
}

export function statusAfterCheckpoint(current, checkpoint) {
  if (checkpoint.progress_status === "STALLED" && !["HARD_STOPPED", "REASSESSMENT_REQUIRED"].includes(current.status)) {
    return {status: "REPLACEMENT_REQUIRED", route_status: "CAMPAIGN_ORCHESTRATOR", pending_owner_decision: "REPLACE_STALLED_WORKER", dependent_work_allowed: false};
  }
  if (checkpoint.progress_status === "PROGRESS_RECORDED" && ["READY", "ACTIVE"].includes(current.status)) {
    return {status: "ACTIVE", route_status: "CAMPAIGN_ORCHESTRATOR", pending_owner_decision: null, dependent_work_allowed: true};
  }
  if (checkpoint.progress_status === "CLOSED") return {status: "CLOSED", route_status: "WAITING", pending_owner_decision: null, dependent_work_allowed: false};
  return {};
}

export function ensureIdempotencyKey(value) {
  requireIdentifier(value, "Runtime operation idempotency key");
}

export function createOpaqueRuntimeReference(prefix, value) {
  assert(["RUNTIME_REF", "LEASE_REF", "TRANSACTION_REF"].includes(prefix), "opaque Runtime reference prefix is invalid");
  requireString(value, "opaque Runtime reference source");
  return `${prefix}_${canonicalDigest(value)}`;
}
