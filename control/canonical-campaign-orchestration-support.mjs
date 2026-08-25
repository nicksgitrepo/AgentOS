#!/usr/bin/env node

/*
 * Canonical campaign contracts and deterministic record helpers.
 *
 * This module owns the typed admission, handoff, evidence, checkpoint,
 * acceptance, delivery, and closure projections used by the public
 * orchestration entrypoint. Existing subsystem modules remain authoritative
 * for Bootstrap, Runtime, lifecycle, and native-session behavior.
 */

import {
  assertPersistedRecordSafe,
  canonicalDigest,
  compareUtf8,
} from "./content-addressing.mjs";
import {
  validateBootstrapRunnablePlan,
} from "./bootstrap-compiler.mjs";
import {
  DELIVERY_FINISHES,
  validateDeliveryPolicy,
} from "./delivery-policy.mjs";
import {
  ACTIVATION_STATUS,
  MEANINGFUL_RESULT_TYPES as RUNTIME_MEANINGFUL_RESULT_TYPES,
  PROTECTED_ACTIONS,
  validateIntentRegulatorCheckpoint,
  validateIntentRegulatorSnapshot,
} from "./persistent-intent-runtime.mjs";
import {
  assertUniversalDevelopmentMode,
  compileUniversalTaskCloseoutReceipts,
  validateUniversalTaskCloseoutReceipts,
} from "./governance-library.mjs";
import {
  compileParallelCampaignPlan,
  MEANINGFUL_RESULT_TYPES as CAMPAIGN_MEANINGFUL_RESULT_TYPES,
  validateParallelCampaignPlan,
} from "./parallel-campaign-lifecycle.mjs";
import {
  NATIVE_SESSION_ROLES,
  NATIVE_SESSION_WORKTREE_MODES,
} from "./native-session-team.mjs";

export const CANONICAL_CAMPAIGN_ADMISSION_SCHEMA = "agentos.canonical_campaign_admission.v1";
export const CANONICAL_CAMPAIGN_CLOSURE_SCHEMA = "agentos.canonical_campaign_closure.v1";
export const CANONICAL_CAMPAIGN_ORCHESTRATION_SCHEMA = "agentos.canonical_campaign_orchestration.v1";
export const CANONICAL_CAMPAIGN_VERSION = 1;
export const DEFAULT_PROGRESS_REVIEW_MINUTES = 15;
export const CANONICAL_AUDITOR_ROLE = "INDEPENDENT_AUDITOR";
export const CANONICAL_SUPPORTED_OWNER_DELIVERY = "REVIEW";

const IDENTIFIER = /^[A-Z][A-Z0-9._:-]*$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const SOURCE_SHA1 = /^[0-9a-f]{40}$/u;
const OPAQUE_SESSION_REF = /^opaque:session:[0-9a-f]{64}$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

const ADMISSION_KEYS = [
  "schema", "version", "status", "activation_status", "team_id", "project_id", "environment_id",
  "campaign_id", "campaign_version", "logical_lineage_id", "goal_id", "goal_sha256", "source",
  "bootstrap_plan_sha256", "bootstrap_context_sha256", "delivery", "review_interval_minutes",
  "progress_window_minutes", "max_concurrent_workers", "auditor_role", "lanes", "parallel_plan_sha256",
  "admission_sha256",
];
const SOURCE_KEYS = ["commit", "tree", "worktree_id"];
const DELIVERY_KEYS = ["policy_sha256", "owner_choice"];
const LANE_KEYS = ["lane_id", "native_role", "worktree_mode", "dependencies", "writable_scope", "task_sha256"];
const RUNTIME_RESULT_KEYS = ["runtime_ref", "status", "state_sha256", "checkpoint_sha256", "event_cursor", "roles_sha256"];
const WORKER_RESULT_KEYS = [
  "worker_ref", "lane_id", "session_ref", "progress_sha256", "handoff_sha256", "audit_sha256",
  "auditor_ref", "auditor_session_ref", "native_request_sha256", "native_session_sha256", "native_closure_sha256",
  "native_auditor_request_sha256", "native_auditor_session_sha256", "native_auditor_closure_sha256",
];
const ACCEPTANCE_KEYS = ["status", "accepted_worker_count", "final_evidence_sha256"];
const DELIVERY_RESULT_KEYS = ["status", "owner_choice", "policy_sha256", "result", "result_sha256"];
const CLOSURE_KEYS = [
  "schema", "version", "status", "activation_status", "campaign_id", "campaign_version", "parallel_plan_sha256",
  "campaign_state_sha256", "runtime_state_sha256", "runtime_checkpoint_sha256", "final_acceptance_sha256",
  "owner_delivery_choice", "delivery_policy_sha256", "worker_count", "accepted_worker_count", "closed_worker_count",
  "active_native_session_count", "exact_worker_closure", "evidence_identity_ok", "universal_closeout_receipts", "protected_actions", "closed_at_utc",
  "closure_sha256",
];
const ORCHESTRATION_KEYS = [
  "schema", "version", "status", "activation_status", "admission_sha256", "bootstrap_plan_sha256", "parallel_plan_sha256",
  "runtime", "workers", "acceptance", "delivery", "closure", "result_sha256",
];

function assert(condition, message, code = "CANONICAL_CAMPAIGN_INVALID") {
  if (!condition) {
    const error = new Error(message);
    error.code = code;
    throw error;
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected, label) {
  assert(isRecord(value), `${label} must be an object`);
  const actual = Object.keys(value).sort(compareUtf8);
  const wanted = [...expected].sort(compareUtf8);
  assert(JSON.stringify(actual) === JSON.stringify(wanted), `${label} fields mismatch`);
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains a control character`);
}

function requireIdentifier(value, label) {
  requireString(value, label);
  assert(IDENTIFIER.test(value), `${label} is not a stable uppercase identifier`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function requireSourceSha(value, label) {
  assert(typeof value === "string" && SOURCE_SHA1.test(value), `${label} must be a lowercase source digest`);
}

function requireUtc(value, label) {
  requireString(value, label);
  assert(ISO_UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} must be UTC`);
}

function requireBoolean(value, label) {
  assert(typeof value === "boolean", `${label} must be boolean`);
}

function requirePositiveInteger(value, label, maximum = Number.MAX_SAFE_INTEGER) {
  assert(Number.isSafeInteger(value) && value > 0 && value <= maximum, `${label} must be a positive integer`);
}

function requireNullableSha(value, label) {
  if (value !== null) requireSha(value, label);
}

function requireNullableOpaqueSessionRef(value, label) {
  if (value !== null) {
    requireString(value, label);
    assert(OPAQUE_SESSION_REF.test(value), `${label} must be opaque`);
  }
}

function clone(value) {
  return structuredClone(value);
}

function seal(value, field) {
  return {...value, [field]: canonicalDigest({...value, [field]: null})};
}

function stableKey(prefix, value) {
  return `${prefix}_${canonicalDigest(value).slice(0, 32).toUpperCase()}`;
}

function bootstrapIntentDigest(bootstrapPlan) {
  return canonicalDigest({
    north_star: bootstrapPlan.north_star,
    first_useful_workflow: bootstrapPlan.first_useful_workflow,
    first_campaign: bootstrapPlan.first_campaign,
  });
}

function bootstrapContextDigest(bootstrapPlan) {
  return canonicalDigest({
    project_definition: bootstrapPlan.project_definition,
    authority_boundaries: bootstrapPlan.authority_boundaries,
    project_life_contract_sha256: bootstrapPlan.project_life_contract.life_contract_sha256,
    delivery_policy_sha256: bootstrapPlan.delivery_policy.policy_sha256,
    controller_supervision_sha256: bootstrapPlan.controller_supervision.supervision_sha256,
  });
}

function validateSource(source, label = "campaign source") {
  exactKeys(source, SOURCE_KEYS, label);
  requireSourceSha(source.commit, `${label}.commit`);
  requireSourceSha(source.tree, `${label}.tree`);
  requireIdentifier(source.worktree_id, `${label}.worktree_id`);
  return source;
}

function validateDelivery(delivery, label = "campaign delivery") {
  exactKeys(delivery, DELIVERY_KEYS, label);
  requireSha(delivery.policy_sha256, `${label}.policy_sha256`);
  assert(DELIVERY_FINISHES.includes(delivery.owner_choice), `${label}.owner_choice is not a supported delivery finish`);
  return delivery;
}

function validateLane(lane, laneIds, label = "campaign lane") {
  exactKeys(lane, LANE_KEYS, label);
  requireIdentifier(lane.lane_id, `${label}.lane_id`);
  requireString(lane.native_role, `${label}.native_role`);
  assert(NATIVE_SESSION_ROLES.some(({role}) => role === lane.native_role), `${label}.native_role is not a native session role`);
  assert(!/AUDITOR/u.test(lane.native_role), `${label}.native_role cannot be an Auditor role`, "AUDITOR_INDEPENDENCE_BOUNDARY");
  assert(NATIVE_SESSION_WORKTREE_MODES.includes(lane.worktree_mode), `${label}.worktree_mode is invalid`);
  assert(Array.isArray(lane.dependencies), `${label}.dependencies must be an array`);
  const sortedDependencies = [...lane.dependencies].sort(compareUtf8);
  assert(JSON.stringify(lane.dependencies) === JSON.stringify(sortedDependencies), `${label}.dependencies must be sorted`);
  assert(new Set(lane.dependencies).size === lane.dependencies.length, `${label}.dependencies must be unique`);
  for (const dependency of lane.dependencies) {
    requireIdentifier(dependency, `${label}.dependency`);
    assert(dependency !== lane.lane_id, `${label} cannot depend on itself`);
    assert(laneIds.has(dependency), `${label} depends on an unknown lane`);
  }
  requireIdentifier(lane.writable_scope, `${label}.writable_scope`);
  requireSha(lane.task_sha256, `${label}.task_sha256`);
  return lane;
}

function expectedParallelPlan(admission) {
  return compileParallelCampaignPlan({
    campaignId: admission.campaign_id,
    campaignVersion: admission.campaign_version,
    logicalLineageId: admission.logical_lineage_id,
    goalId: admission.goal_id,
    goalSha256: admission.goal_sha256,
    source: admission.source,
    progressWindowMinutes: admission.progress_window_minutes,
    maxConcurrentWorkers: admission.max_concurrent_workers,
    lanes: admission.lanes.map((lane) => ({
      lane_id: lane.lane_id,
      dependencies: lane.dependencies,
      writable_scope: lane.writable_scope,
      task_sha256: lane.task_sha256,
    })),
  });
}

function validateBootstrapBinding(admission, bootstrapPlan) {
  validateBootstrapRunnablePlan(bootstrapPlan);
  validateDeliveryPolicy(bootstrapPlan.delivery_policy);
  assert(admission.bootstrap_plan_sha256 === bootstrapPlan.plan_sha256, "campaign admission is bound to a different Bootstrap plan", "BOOTSTRAP_BINDING_MISMATCH");
  assert(admission.bootstrap_context_sha256 === bootstrapContextDigest(bootstrapPlan), "campaign admission Bootstrap context binding differs", "BOOTSTRAP_BINDING_MISMATCH");
  assert(admission.goal_sha256 === bootstrapIntentDigest(bootstrapPlan), "campaign goal is not the exact Bootstrap intent projection", "BOOTSTRAP_INTENT_BINDING_MISMATCH");
  assert(admission.delivery.policy_sha256 === bootstrapPlan.delivery_policy.policy_sha256, "campaign delivery policy is not bound to Bootstrap", "DELIVERY_POLICY_BINDING_MISMATCH");
  assert(admission.delivery.owner_choice === bootstrapPlan.delivery_policy.finish.selected, "campaign owner delivery choice differs from Bootstrap", "DELIVERY_CHOICE_BINDING_MISMATCH");
  assert(bootstrapPlan.delivery_policy.finish.selected !== null, "Bootstrap has no owner-selected delivery finish", "OWNER_DELIVERY_REQUIRED");
  const environmentIdentity = bootstrapPlan.persistent_runtime?.environment_identity;
  requireIdentifier(environmentIdentity, "Bootstrap persistent Runtime environment identity");
  assert(admission.environment_id === environmentIdentity, "campaign environment differs from Bootstrap Runtime binding", "RUNTIME_BINDING_MISMATCH");
  assert(admission.review_interval_minutes === bootstrapPlan.controller_supervision.audit_interval_minutes, "campaign review interval differs from Bootstrap supervision", "REVIEW_INTERVAL_BINDING_MISMATCH");
  assert(admission.progress_window_minutes === bootstrapPlan.controller_supervision.meaningful_progress_window_minutes, "campaign progress window differs from Bootstrap supervision", "PROGRESS_WINDOW_BINDING_MISMATCH");
}

export function validateCanonicalCampaignAdmission(admission, {bootstrapPlan = null} = {}) {
  exactKeys(admission, ADMISSION_KEYS, "canonical campaign admission");
  assert(admission.schema === CANONICAL_CAMPAIGN_ADMISSION_SCHEMA && admission.version === CANONICAL_CAMPAIGN_VERSION, "canonical campaign admission identity is invalid");
  assert(admission.status === "ADMITTED", "canonical campaign admission is not admitted");
  assert(admission.activation_status === ACTIVATION_STATUS, "canonical campaign admission activation status is invalid");
  for (const field of ["team_id", "project_id", "environment_id", "campaign_id", "campaign_version", "logical_lineage_id", "goal_id"]) requireIdentifier(admission[field], `canonical campaign ${field}`);
  requireSha(admission.goal_sha256, "canonical campaign goal digest");
  validateSource(admission.source);
  requireSha(admission.bootstrap_plan_sha256, "canonical campaign Bootstrap plan digest");
  requireSha(admission.bootstrap_context_sha256, "canonical campaign Bootstrap context digest");
  validateDelivery(admission.delivery);
  assert(Number.isSafeInteger(admission.review_interval_minutes) && admission.review_interval_minutes >= 1 && admission.review_interval_minutes <= 1440, "canonical campaign review interval is invalid");
  assert(Number.isSafeInteger(admission.progress_window_minutes) && admission.progress_window_minutes >= 1 && admission.progress_window_minutes <= 240, "canonical campaign progress window is invalid");
  requirePositiveInteger(admission.max_concurrent_workers, "canonical campaign maximum concurrency");
  assert(admission.auditor_role === CANONICAL_AUDITOR_ROLE, "canonical campaign Auditor role is invalid");
  assert(Array.isArray(admission.lanes) && admission.lanes.length > 0, "canonical campaign lanes are missing");
  const laneIds = new Set(admission.lanes.map((lane) => lane?.lane_id));
  assert(laneIds.size === admission.lanes.length, "canonical campaign lanes are duplicated");
  let previousLane = null;
  const nativeRoles = new Set();
  for (const lane of admission.lanes) {
    validateLane(lane, laneIds);
    if (previousLane !== null) assert(compareUtf8(previousLane, lane.lane_id) < 0, "canonical campaign lanes must be sorted");
    previousLane = lane.lane_id;
    assert(!nativeRoles.has(lane.native_role), "canonical campaign native worker roles must be unique", "NATIVE_SESSION_ROLE_COLLISION");
    nativeRoles.add(lane.native_role);
  }
  assert(admission.max_concurrent_workers <= admission.lanes.length, "canonical campaign concurrency exceeds lane count");
  const parallelPlan = expectedParallelPlan(admission);
  assert(admission.parallel_plan_sha256 === parallelPlan.plan_sha256, "canonical campaign parallel plan digest differs", "PARALLEL_PLAN_BINDING_MISMATCH");
  validateParallelCampaignPlan(parallelPlan);
  requireSha(admission.admission_sha256, "canonical campaign admission digest");
  assert(admission.admission_sha256 === canonicalDigest({...admission, admission_sha256: null}), "canonical campaign admission digest mismatch");
  assertPersistedRecordSafe(admission);
  if (bootstrapPlan !== null) validateBootstrapBinding(admission, bootstrapPlan);
  return admission;
}

export function compileCanonicalCampaignAdmission({
  bootstrapPlan,
  projectId,
  environmentId,
  campaignId,
  campaignVersion,
  logicalLineageId,
  goalId,
  goalSha256,
  source,
  lanes,
  teamId = null,
  reviewIntervalMinutes = null,
  progressWindowMinutes = DEFAULT_PROGRESS_REVIEW_MINUTES,
  maxConcurrentWorkers = null,
} = {}) {
  assert(bootstrapPlan !== null, "canonical campaign admission requires the Bootstrap plan");
  validateBootstrapRunnablePlan(bootstrapPlan);
  validateDeliveryPolicy(bootstrapPlan.delivery_policy);
  for (const [value, label] of [
    [projectId, "campaign project ID"], [environmentId, "campaign environment ID"], [campaignId, "campaign ID"],
    [campaignVersion, "campaign version"], [logicalLineageId, "campaign logical lineage ID"], [goalId, "campaign goal ID"],
  ]) requireIdentifier(value, label);
  requireSha(goalSha256, "campaign goal digest");
  assert(goalSha256 === bootstrapIntentDigest(bootstrapPlan), "campaign goal digest must be the Bootstrap intent projection", "BOOTSTRAP_INTENT_BINDING_MISMATCH");
  validateSource(source);
  assert(Array.isArray(lanes) && lanes.length > 0, "canonical campaign admission requires lanes");
  const normalizedLanes = lanes.map((input) => {
    assert(isRecord(input), "canonical campaign lane input must be an object");
    requireIdentifier(input.lane_id, "campaign lane ID");
    requireString(input.task, `${input.lane_id} task`);
    const nativeRole = input.native_role ?? "RAPID_SLICE_BUILDER";
    const lane = {
      lane_id: input.lane_id,
      native_role: nativeRole,
      worktree_mode: input.worktree_mode ?? "PROJECT_LOCAL_SESSION",
      dependencies: [...(input.dependencies ?? [])].sort(compareUtf8),
      writable_scope: input.writable_scope,
      task_sha256: canonicalDigest(input.task),
    };
    validateLane(lane, new Set(lanes.map((candidate) => candidate?.lane_id)));
    return lane;
  }).sort((left, right) => compareUtf8(left.lane_id, right.lane_id));
  const normalizedTeamId = teamId ?? `TEAM_${canonicalDigest({projectId, campaignId, campaignVersion, logicalLineageId}).slice(0, 32).toUpperCase()}`;
  requireIdentifier(normalizedTeamId, "campaign native team ID");
  const normalizedReviewInterval = reviewIntervalMinutes ?? bootstrapPlan.controller_supervision.audit_interval_minutes ?? DEFAULT_REVIEW_INTERVAL_MINUTES;
  const admission = {
    schema: CANONICAL_CAMPAIGN_ADMISSION_SCHEMA,
    version: CANONICAL_CAMPAIGN_VERSION,
    status: "ADMITTED",
    activation_status: ACTIVATION_STATUS,
    team_id: normalizedTeamId,
    project_id: projectId,
    environment_id: environmentId,
    campaign_id: campaignId,
    campaign_version: campaignVersion,
    logical_lineage_id: logicalLineageId,
    goal_id: goalId,
    goal_sha256: goalSha256,
    source: clone(source),
    bootstrap_plan_sha256: bootstrapPlan.plan_sha256,
    bootstrap_context_sha256: bootstrapContextDigest(bootstrapPlan),
    delivery: {
      policy_sha256: bootstrapPlan.delivery_policy.policy_sha256,
      owner_choice: bootstrapPlan.delivery_policy.finish.selected,
    },
    review_interval_minutes: normalizedReviewInterval,
    progress_window_minutes: progressWindowMinutes,
    max_concurrent_workers: maxConcurrentWorkers ?? 1,
    auditor_role: CANONICAL_AUDITOR_ROLE,
    lanes: normalizedLanes,
    parallel_plan_sha256: null,
    admission_sha256: null,
  };
  const parallelPlan = expectedParallelPlan(admission);
  admission.parallel_plan_sha256 = parallelPlan.plan_sha256;
  const sealed = seal(admission, "admission_sha256");
  validateCanonicalCampaignAdmission(sealed, {bootstrapPlan});
  return sealed;
}

function compileSnapshot(admission, {progressStatus, acceptanceStatus, evidenceIdentityOk = true, rosterExact = true, hardBoundaryDetected = false, softBoundaryDetected = false} = {}) {
  const snapshot = {
    schema: "agentos.campaign_snapshot.v1",
    version: 1,
    project_id: admission.project_id,
    campaign_id: admission.campaign_id,
    campaign_version: admission.campaign_version,
    goal_id: admission.goal_id,
    goal_sha256: admission.goal_sha256,
    source_commit: admission.source.commit,
    source_tree: admission.source.tree,
    progress_status: progressStatus,
    scope_changed: false,
    intent_changed: false,
    conditions_changed: false,
    hard_boundary_detected: hardBoundaryDetected,
    soft_boundary_detected: softBoundaryDetected,
    evidence_identity_ok: evidenceIdentityOk,
    roster_exact: rosterExact,
    acceptance_status: acceptanceStatus,
  };
  return validateIntentRegulatorSnapshot(snapshot);
}

function meaningfulProgressFromHandoff(handoff) {
  if (handoff === null) return null;
  const value = {
    result_type: handoff.result_type,
    artifact_sha256: handoff.artifact_sha256,
    evidence_sha256: handoff.evidence_sha256,
    handoff_sha256: handoff.handoff_sha256,
    summary_sha256: canonicalDigest(handoff.summary),
  };
  assert(RUNTIME_MEANINGFUL_RESULT_TYPES.includes(value.result_type), "handoff result type is not meaningful");
  return value;
}

function compileCheckpoint(admission, {checkpointId, laneIndex, step, nextAction, progressStatus, meaningfulProgress, lastMeaningfulProgressAtUtc, evidenceIdentityOk, createdAtUtc}) {
  const checkpoint = {
    schema: "agentos.intent_regulator_checkpoint.v1",
    version: 1,
    activation_status: ACTIVATION_STATUS,
    checkpoint_id: checkpointId,
    project_id: admission.project_id,
    campaign_id: admission.campaign_id,
    campaign_version: admission.campaign_version,
    goal_id: admission.goal_id,
    goal_sha256: admission.goal_sha256,
    source_commit: admission.source.commit,
    source_tree: admission.source.tree,
    phase_index: 0,
    lane_index: laneIndex,
    step,
    next_action: nextAction,
    progress_status: progressStatus,
    meaningful_progress: meaningfulProgress,
    last_meaningful_progress_at_utc: lastMeaningfulProgressAtUtc,
    evidence_identity_ok: evidenceIdentityOk,
    created_at_utc: createdAtUtc,
    checkpoint_sha256: null,
  };
  const sealed = seal(checkpoint, "checkpoint_sha256");
  return validateIntentRegulatorCheckpoint(sealed);
}

function lookupLaneWork(laneWork, lane) {
  const value = laneWork instanceof Map ? laneWork.get(lane.lane_id) : laneWork?.[lane.lane_id];
  assert(isRecord(value), `native work input is missing for ${lane.lane_id}`, "NATIVE_SESSION_WORK_REQUIRED");
  requireString(value.task, `${lane.lane_id} native task`);
  requireString(value.prompt, `${lane.lane_id} native prompt`);
  assert(canonicalDigest(value.task) === lane.task_sha256, `${lane.lane_id} native task differs from its admitted digest`, "TASK_BINDING_MISMATCH");
  return value;
}

function validateNativeProgress(progress, {session, request, admission}) {
  const keys = [
    "schema", "version", "status", "thread_id", "host_id", "project_id", "campaign_id", "campaign_version", "role",
    "source_commit", "source_tree", "result_type", "summary", "artifact_sha256", "evidence_sha256", "observed_at_utc", "progress_sha256",
  ];
  exactKeys(progress, keys, "native worker progress");
  assert(progress.schema === "agentos.native_worker_progress.v1" && progress.version === 1 && progress.status === "MEANINGFUL_PROGRESS", "native worker progress identity is invalid");
  requireString(progress.thread_id, "native worker progress thread identity");
  requireString(progress.host_id, "native worker progress host identity");
  assert(progress.thread_id === session.thread_id && progress.host_id === session.host_id, "native worker progress session identity differs", "EVIDENCE_IDENTITY_MISMATCH");
  assert(progress.project_id === admission.project_id && progress.campaign_id === admission.campaign_id && progress.campaign_version === admission.campaign_version && progress.role === request.role, "native worker progress campaign identity differs", "EVIDENCE_IDENTITY_MISMATCH");
  assert(progress.source_commit === admission.source.commit && progress.source_tree === admission.source.tree, "native worker progress source identity differs", "EVIDENCE_IDENTITY_MISMATCH");
  assert(CAMPAIGN_MEANINGFUL_RESULT_TYPES.includes(progress.result_type), "native worker progress result is not meaningful", "MEANINGFUL_PROGRESS_REQUIRED");
  requireString(progress.summary, "native worker progress summary");
  assertPersistedRecordSafe({summary: progress.summary});
  requireSha(progress.artifact_sha256, "native worker progress artifact digest");
  requireSha(progress.evidence_sha256, "native worker progress evidence digest");
  requireUtc(progress.observed_at_utc, "native worker progress observation time");
  requireSha(progress.progress_sha256, "native worker progress digest");
  assert(progress.progress_sha256 === canonicalDigest({...progress, progress_sha256: null}), "native worker progress digest mismatch");
  return progress;
}

function validateNativeAudit(audit, {session, request, handoff, admission}) {
  const keys = [
    "schema", "version", "status", "thread_id", "host_id", "project_id", "campaign_id", "campaign_version", "role",
    "source_commit", "source_tree", "handoff_sha256", "accepted", "evidence_sha256", "observed_at_utc", "audit_sha256",
  ];
  exactKeys(audit, keys, "native Auditor result");
  assert(audit.schema === "agentos.native_auditor_result.v1" && audit.version === 1 && audit.status === "AUDIT_COMPLETE", "native Auditor result identity is invalid");
  requireString(audit.thread_id, "native Auditor thread identity");
  requireString(audit.host_id, "native Auditor host identity");
  assert(audit.thread_id === session.thread_id && audit.host_id === session.host_id, "native Auditor session identity differs", "EVIDENCE_IDENTITY_MISMATCH");
  assert(audit.project_id === admission.project_id && audit.campaign_id === admission.campaign_id && audit.campaign_version === admission.campaign_version && audit.role === request.role, "native Auditor campaign identity differs", "EVIDENCE_IDENTITY_MISMATCH");
  assert(audit.source_commit === admission.source.commit && audit.source_tree === admission.source.tree, "native Auditor source identity differs", "EVIDENCE_IDENTITY_MISMATCH");
  assert(audit.handoff_sha256 === handoff.handoff_sha256, "native Auditor evaluated a different handoff", "AUDITOR_HANDOFF_BINDING_MISMATCH");
  requireBoolean(audit.accepted, "native Auditor acceptance");
  requireSha(audit.evidence_sha256, "native Auditor evidence digest");
  requireUtc(audit.observed_at_utc, "native Auditor observation time");
  requireSha(audit.audit_sha256, "native Auditor digest");
  assert(audit.audit_sha256 === canonicalDigest({...audit, audit_sha256: null}), "native Auditor digest mismatch");
  return audit;
}

function hostReadbackFromOperation(operation) {
  const hostReadback = operation?.readback?.host_readback;
  assert(isRecord(hostReadback), "native session operation has no typed host readback", "NATIVE_SESSION_READBACK_REQUIRED");
  return hostReadback;
}

function workerEvidenceRecord(worker, nativeEvidence, auditorEvidence = null) {
  const native = nativeEvidence?.get(worker.session_ref) ?? null;
  return {
    worker_ref: worker.worker_ref,
    lane_id: worker.lane_id,
    session_ref: worker.session_ref,
    progress_sha256: worker.progress?.progress_sha256 ?? null,
    handoff_sha256: worker.handoff?.handoff_sha256 ?? null,
    audit_sha256: worker.audit?.audit_sha256 ?? null,
    auditor_ref: worker.audit?.auditor_ref ?? null,
    auditor_session_ref: worker.audit?.auditor_session_ref ?? null,
    native_request_sha256: native?.request_sha256 ?? native?.request?.request_sha256 ?? null,
    native_session_sha256: native?.session_sha256 ?? native?.session?.session_sha256 ?? null,
    native_closure_sha256: native?.closure_sha256 ?? null,
    native_auditor_request_sha256: auditorEvidence?.get(worker.audit?.auditor_session_ref)?.request_sha256 ?? null,
    native_auditor_session_sha256: auditorEvidence?.get(worker.audit?.auditor_session_ref)?.session_sha256 ?? null,
    native_auditor_closure_sha256: auditorEvidence?.get(worker.audit?.auditor_session_ref)?.closure_sha256 ?? null,
  };
}

function validateWorkerResult(worker) {
  exactKeys(worker, WORKER_RESULT_KEYS, "canonical campaign worker result");
  requireIdentifier(worker.worker_ref, "canonical campaign worker reference");
  requireIdentifier(worker.lane_id, "canonical campaign worker lane");
  requireNullableOpaqueSessionRef(worker.session_ref, "canonical campaign worker session reference");
  for (const field of ["progress_sha256", "handoff_sha256", "audit_sha256", "native_request_sha256", "native_session_sha256", "native_closure_sha256", "native_auditor_request_sha256", "native_auditor_session_sha256", "native_auditor_closure_sha256"]) requireNullableSha(worker[field], `canonical campaign worker ${field}`);
  for (const field of ["auditor_ref"]) {
    if (worker[field] !== null) {
      requireString(worker[field], `canonical campaign worker ${field}`);
      assert(/^[A-Za-z][A-Za-z0-9._:-]*$/u.test(worker[field]), `canonical campaign worker ${field} is not a stable reference`);
    }
  }
  requireNullableOpaqueSessionRef(worker.auditor_session_ref, "canonical campaign worker Auditor session reference");
  return worker;
}

function validateRuntimeResult(runtime) {
  exactKeys(runtime, RUNTIME_RESULT_KEYS, "canonical campaign Runtime result");
  requireString(runtime.runtime_ref, "canonical campaign Runtime reference");
  assert(/^RUNTIME_REF_[0-9a-f]{64}$/u.test(runtime.runtime_ref), "canonical campaign Runtime reference is not opaque");
  assert(["ACTIVE", "AWAITING_ACCEPTANCE", "CLOSED", "HARD_STOPPED", "REPLACEMENT_REQUIRED"].includes(runtime.status), "canonical campaign Runtime result status is invalid");
  requireSha(runtime.state_sha256, "canonical campaign Runtime state digest");
  requireNullableSha(runtime.checkpoint_sha256, "canonical campaign Runtime checkpoint digest");
  requirePositiveInteger(runtime.event_cursor, "canonical campaign Runtime event cursor");
  requireSha(runtime.roles_sha256, "canonical campaign Runtime role set digest");
  return runtime;
}

function validateAcceptanceResult(acceptance, {status = "CLOSED"} = {}) {
  exactKeys(acceptance, ACCEPTANCE_KEYS, "canonical campaign acceptance result");
  assert(["ACCEPTED", "NOT_REACHED", "REJECTED"].includes(acceptance.status), "canonical campaign acceptance status is invalid");
  if (status === "CLOSED") assert(acceptance.status === "ACCEPTED", "closed campaign must have independent acceptance");
  assert(Number.isSafeInteger(acceptance.accepted_worker_count) && acceptance.accepted_worker_count >= 0, "canonical campaign accepted worker count is invalid");
  requireNullableSha(acceptance.final_evidence_sha256, "canonical campaign final evidence digest");
  if (acceptance.status === "ACCEPTED") requireSha(acceptance.final_evidence_sha256, "canonical campaign accepted evidence digest");
  return acceptance;
}

function validateDeliveryResult(delivery, {status = "CLOSED"} = {}) {
  exactKeys(delivery, DELIVERY_RESULT_KEYS, "canonical campaign delivery result");
  assert(DELIVERY_FINISHES.includes(delivery.owner_choice), "canonical campaign delivery choice is invalid");
  requireSha(delivery.policy_sha256, "canonical campaign delivery policy digest");
  assert(["COMPLETE", "NOT_REACHED"].includes(delivery.status), "canonical campaign delivery status is invalid");
  if (status === "CLOSED") assert(delivery.status === "COMPLETE", "closed campaign delivery is incomplete");
  if (delivery.result !== null) requireString(delivery.result, "canonical campaign delivery result");
  requireSha(delivery.result_sha256, "canonical campaign delivery result digest");
  return delivery;
}

export function validateCanonicalCampaignClosure(closure, {receiptResolver} = {}) {
  if (closure === null) return null;
  exactKeys(closure, CLOSURE_KEYS, "canonical campaign closure");
  assert(closure.schema === CANONICAL_CAMPAIGN_CLOSURE_SCHEMA && closure.version === CANONICAL_CAMPAIGN_VERSION, "canonical campaign closure identity is invalid");
  assert(closure.status === "CLOSED", "canonical campaign closure is not closed");
  assert(closure.activation_status === ACTIVATION_STATUS, "canonical campaign closure activation status is invalid");
  for (const field of ["campaign_id", "campaign_version"]) requireIdentifier(closure[field], `canonical campaign closure ${field}`);
  for (const field of ["parallel_plan_sha256", "campaign_state_sha256", "runtime_state_sha256", "runtime_checkpoint_sha256", "final_acceptance_sha256", "delivery_policy_sha256"]) requireSha(closure[field], `canonical campaign closure ${field}`);
  assert(DELIVERY_FINISHES.includes(closure.owner_delivery_choice), "canonical campaign closure delivery choice is invalid");
  for (const field of ["worker_count", "accepted_worker_count", "closed_worker_count"]) requirePositiveInteger(closure[field], `canonical campaign closure ${field}`);
  assert(closure.accepted_worker_count === closure.worker_count && closure.closed_worker_count === closure.worker_count, "canonical campaign closure worker counts are incomplete");
  assert(closure.active_native_session_count === 0, "canonical campaign closure retains native sessions");
  requireBoolean(closure.exact_worker_closure, "canonical campaign closure exact worker closure");
  assert(closure.exact_worker_closure === true, "canonical campaign closure is not exact");
  requireBoolean(closure.evidence_identity_ok, "canonical campaign closure evidence identity");
  assert(closure.evidence_identity_ok === true, "canonical campaign closure evidence identity is not exact");
  validateUniversalTaskCloseoutReceipts(closure.universal_closeout_receipts, {
    closed: true,
    label: "canonical campaign universal closeout receipts",
    receiptResolver: receiptResolver ?? closure.__receiptResolver,
  });
  exactKeys(closure.protected_actions, Object.keys(PROTECTED_ACTIONS), "canonical campaign closure protected actions");
  for (const value of Object.values(closure.protected_actions)) assert(value === false, "canonical campaign closure enabled a protected action");
  requireUtc(closure.closed_at_utc, "canonical campaign closure time");
  requireSha(closure.closure_sha256, "canonical campaign closure digest");
  assert(closure.closure_sha256 === canonicalDigest({...closure, closure_sha256: null}), "canonical campaign closure digest mismatch");
  assertPersistedRecordSafe(closure);
  return closure;
}

export function validateCanonicalCampaignOrchestration(result, {receiptResolver} = {}) {
  exactKeys(result, ORCHESTRATION_KEYS, "canonical campaign orchestration result");
  assert(result.schema === CANONICAL_CAMPAIGN_ORCHESTRATION_SCHEMA && result.version === CANONICAL_CAMPAIGN_VERSION, "canonical campaign orchestration identity is invalid");
  assert(["CLOSED", "BLOCKED"].includes(result.status), "canonical campaign orchestration status is invalid");
  assert(result.activation_status === ACTIVATION_STATUS, "canonical campaign orchestration activation status is invalid");
  requireSha(result.admission_sha256, "canonical campaign orchestration admission digest");
  requireSha(result.bootstrap_plan_sha256, "canonical campaign orchestration Bootstrap plan digest");
  requireSha(result.parallel_plan_sha256, "canonical campaign orchestration parallel plan digest");
  validateRuntimeResult(result.runtime);
  assert(Array.isArray(result.workers) && result.workers.length > 0, "canonical campaign orchestration workers are missing");
  result.workers.forEach(validateWorkerResult);
  validateAcceptanceResult(result.acceptance, {status: result.status});
  validateDeliveryResult(result.delivery, {status: result.status});
  validateCanonicalCampaignClosure(result.closure, {receiptResolver: receiptResolver ?? result.__receiptResolver});
  if (result.status === "CLOSED") assert(result.closure !== null, "closed orchestration lacks exact closure");
  if (result.status === "BLOCKED") assert(result.closure === null, "blocked orchestration cannot claim closure");
  if (result.status === "CLOSED") {
    assert(result.workers.every((worker) => worker.session_ref !== null
      && worker.progress_sha256 !== null
      && worker.handoff_sha256 !== null
      && worker.audit_sha256 !== null
      && worker.auditor_ref !== null
      && worker.auditor_session_ref !== null
      && worker.native_request_sha256 !== null
      && worker.native_session_sha256 !== null
      && worker.native_closure_sha256 !== null
      && worker.native_auditor_request_sha256 !== null
      && worker.native_auditor_session_sha256 !== null
      && worker.native_auditor_closure_sha256 !== null), "closed orchestration lacks independent native closure evidence");
  }
  requireSha(result.result_sha256, "canonical campaign orchestration digest");
  assert(result.result_sha256 === canonicalDigest({...result, result_sha256: null}), "canonical campaign orchestration digest mismatch");
  assertPersistedRecordSafe(result);
  return result;
}

function compileResult({status, admission, runtimeResult, workers, acceptance, delivery, closure = null, receiptResolver} = {}) {
  const result = {
    schema: CANONICAL_CAMPAIGN_ORCHESTRATION_SCHEMA,
    version: CANONICAL_CAMPAIGN_VERSION,
    status,
    activation_status: ACTIVATION_STATUS,
    admission_sha256: admission.admission_sha256,
    bootstrap_plan_sha256: admission.bootstrap_plan_sha256,
    parallel_plan_sha256: admission.parallel_plan_sha256,
    runtime: runtimeResult,
    workers,
    acceptance,
    delivery,
    closure,
    result_sha256: null,
  };
  const sealed = seal(result, "result_sha256");
  if (receiptResolver !== undefined) Object.defineProperty(sealed, "__receiptResolver", {value: receiptResolver, enumerable: false});
  return validateCanonicalCampaignOrchestration(sealed, {receiptResolver});
}

function finalAcceptanceDigest(state) {
  return canonicalDigest(state.workers.map((worker) => ({
    worker_ref: worker.worker_ref,
    handoff_sha256: worker.handoff.handoff_sha256,
    audit_sha256: worker.audit.audit_sha256,
    evidence_sha256: worker.audit.evidence_sha256,
  })));
}

export function compileCanonicalCampaignUniversalCloseoutReceipts({admission, campaignState, closedNativeEvidence, auditorEvidence, acceptanceDigest, closedAtUtc}) {
  assertUniversalDevelopmentMode("CAMPAIGN");
  assert(campaignState?.status === "CLOSED", "campaign universal closeout requires a closed campaign state");
  assert(Array.isArray(campaignState.workers) && campaignState.workers.length > 0, "campaign universal closeout requires worker records");
  const handoffs = campaignState.workers.map((worker) => worker.handoff?.handoff_sha256).sort(compareUtf8);
  const audits = campaignState.workers.map((worker) => worker.audit?.audit_sha256).sort(compareUtf8);
  assert(handoffs.every((value) => typeof value === "string" && SHA256.test(value)), "campaign universal closeout has an unbound handoff");
  assert(audits.every((value) => typeof value === "string" && SHA256.test(value)), "campaign universal closeout has an unbound audit");
  assert(closedNativeEvidence instanceof Map, "campaign universal closeout requires native closure evidence");
  assert(auditorEvidence instanceof Map, "campaign universal closeout requires Auditor closure evidence");
  const nativeClosures = [...closedNativeEvidence.values(), ...auditorEvidence.values()].map((value) => value?.closure).filter(Boolean);
  assert(nativeClosures.length === campaignState.workers.length * 2, "campaign universal closeout lacks one native closure per worker and Auditor task");
  const nativeClosureDigests = nativeClosures.map((value) => value.receipt_sha256).sort(compareUtf8);
  assert(nativeClosureDigests.every((value) => typeof value === "string" && SHA256.test(value)), "campaign universal closeout has an unbound native closure");
  const bindings = new Map();
  const opaque = (kind, value) => {
    const payload = {kind, value};
    const receipt_sha256 = canonicalDigest(payload);
    const reference = `opaque:sha256:${receipt_sha256}`;
    bindings.set(reference, {payload, receipt_sha256, status: "PROVEN"});
    return reference;
  };
  const receiptResolver = (reference, {authority}) => ({...bindings.get(reference), authority});
  const receipts = compileUniversalTaskCloseoutReceipts({
    mode: "CAMPAIGN",
    observedAt: closedAtUtc,
    label: "canonical campaign universal closeout receipts",
    receiptRefs: {
      PRESERVE_HANDOFF: opaque("PRESERVE_HANDOFF", handoffs),
      PERSIST_HANDOFF: opaque("PERSIST_HANDOFF", campaignState.state_sha256),
      AUDIT_CANDIDATE: opaque("AUDIT_CANDIDATE", audits),
      INTEGRATE_ACCEPTED_WORK: opaque("INTEGRATE_ACCEPTED_WORK", {campaign_state_sha256: campaignState.state_sha256, acceptanceDigest}),
      UNPIN_SESSION: opaque("UNPIN_SESSION", nativeClosures.map((value) => ({receipt_sha256: value.receipt_sha256, lifecycle: value.lifecycle}))),
      CLOSE_STALE_WORKTREE: opaque("CLOSE_STALE_WORKTREE", {campaign_id: admission.campaign_id, campaign_state_sha256: campaignState.state_sha256, status: "CLOSED_BY_CONTROLLER_RECORD"}),
      REMOVE_ACTIVE_TASK_SCOPE: opaque("REMOVE_ACTIVE_TASK_SCOPE", {campaign_id: admission.campaign_id, active_native_session_count: 0, nativeClosureDigests}),
      MARK_CHAT_OUT_OF_SCOPE: opaque("MARK_CHAT_OUT_OF_SCOPE", {campaign_id: admission.campaign_id, nativeClosureDigests, status: "OUT_OF_SCOPE_AFTER_ARCHIVE"}),
      ARCHIVE_VISIBLE_TASK: opaque("ARCHIVE_VISIBLE_TASK", nativeClosures.map((value) => ({receipt_sha256: value.receipt_sha256, lifecycle: value.lifecycle}))),
    },
    receiptResolver,
  });
  Object.defineProperty(receipts, "__receiptResolver", {value: receiptResolver, enumerable: false});
  return receipts;
}

function buildClosedClosure({admission, campaignState, runtimeState, runtimeCheckpoint, acceptanceDigest, delivery, closedAtUtc, universalCloseoutReceipts, receiptResolver}) {
  validateUniversalTaskCloseoutReceipts(universalCloseoutReceipts, {closed: true, label: "canonical campaign universal closeout receipts", receiptResolver});
  const closure = {
    schema: CANONICAL_CAMPAIGN_CLOSURE_SCHEMA,
    version: CANONICAL_CAMPAIGN_VERSION,
    status: "CLOSED",
    activation_status: ACTIVATION_STATUS,
    campaign_id: admission.campaign_id,
    campaign_version: admission.campaign_version,
    parallel_plan_sha256: admission.parallel_plan_sha256,
    campaign_state_sha256: campaignState.state_sha256,
    runtime_state_sha256: runtimeState.state_sha256,
    runtime_checkpoint_sha256: runtimeCheckpoint.checkpoint_sha256,
    final_acceptance_sha256: acceptanceDigest,
    owner_delivery_choice: delivery.owner_choice,
    delivery_policy_sha256: delivery.policy_sha256,
    worker_count: campaignState.workers.length,
    accepted_worker_count: campaignState.workers.filter((worker) => worker.audit?.accepted === true).length,
    closed_worker_count: campaignState.workers.filter((worker) => worker.state === "CLOSED").length,
    active_native_session_count: 0,
    exact_worker_closure: campaignState.status === "CLOSED" && campaignState.workers.every((worker) => worker.state === "CLOSED" && worker.lease?.status === "RELEASED"),
    evidence_identity_ok: campaignState.workers.every((worker) => worker.audit?.accepted === true && worker.audit.evidence_sha256),
    universal_closeout_receipts: structuredClone(universalCloseoutReceipts),
    protected_actions: clone(PROTECTED_ACTIONS),
    closed_at_utc: closedAtUtc,
    closure_sha256: null,
  };
  const sealed = seal(closure, "closure_sha256");
  if (receiptResolver !== undefined) Object.defineProperty(sealed, "__receiptResolver", {value: receiptResolver, enumerable: false});
  return validateCanonicalCampaignClosure(sealed, {receiptResolver});
}

function blockedDelivery(admission) {
  const result = null;
  return {
    status: "NOT_REACHED",
    owner_choice: admission.delivery.owner_choice,
    policy_sha256: admission.delivery.policy_sha256,
    result,
    result_sha256: canonicalDigest({status: "NOT_REACHED", owner_choice: admission.delivery.owner_choice, policy_sha256: admission.delivery.policy_sha256, result}),
  };
}

function runtimeResult(runtime, runtimeReference) {
  const state = runtime.readState();
  return {
    runtime_ref: runtimeReference,
    status: state.status,
    state_sha256: state.state_sha256,
    checkpoint_sha256: state.checkpoint_sha256,
    event_cursor: state.event_cursor,
    roles_sha256: state.persistent_roles_sha256,
  };
}

function runtimeOperationKey(prefix, value) {
  return stableKey(prefix, value);
}

function makeNativeWorkerPrompt(lane, work) {
  return `${work.prompt} Return only the typed native worker progress record for ${lane.lane_id}; the record must bind the exact campaign, source, native session, meaningful result, artifact digest, evidence digest, and observation time. Submit every heavyweight build, compile, test, verification, database, runtime, or artifact operation as one typed candidate-level plan to the shared AgentOS Hybrid Scheduler; never run competing heavyweight operations directly. Do not self-accept and do not perform protected delivery actions.`;
}

function makeNativeAuditorPrompt(worker, handoff) {
  return `Independently audit the typed handoff digest ${handoff.handoff_sha256} for lane ${worker.lane_id}. Submit every heavyweight verification or evidence operation as one typed candidate-level plan to the shared AgentOS Hybrid Scheduler; never run competing heavyweight operations directly. Return only the typed native Auditor result bound to this handoff, the exact campaign source, an acceptance decision, and evidence digest. Do not modify the worker result, do not self-accept, and do not perform protected delivery actions.`;
}

function serialExecutor() {
  let tail = Promise.resolve();
  return (operation) => {
    const next = tail.then(operation, operation);
    tail = next.catch(() => undefined);
    return next;
  };
}

async function closeIfLive(team, session, handoff) {
  if (session === null) return null;
  const live = team.roster().some((record) => record.session_sha256 === session.session_sha256);
  if (!live) return null;
  const closed = await team.close(session, handoff);
  return closed.receipt;
}

export {
  assert,
  isRecord,
  exactKeys,
  requireString,
  requireIdentifier,
  requireSha,
  requireSourceSha,
  requireUtc,
  requireBoolean,
  requirePositiveInteger,
  requireNullableSha,
  requireNullableOpaqueSessionRef,
  clone,
  seal,
  stableKey,
  bootstrapIntentDigest,
  bootstrapContextDigest,
  validateSource,
  validateDelivery,
  validateLane,
  expectedParallelPlan,
  validateBootstrapBinding,
  compileSnapshot,
  meaningfulProgressFromHandoff,
  compileCheckpoint,
  lookupLaneWork,
  validateNativeProgress,
  validateNativeAudit,
  hostReadbackFromOperation,
  workerEvidenceRecord,
  validateWorkerResult,
  validateRuntimeResult,
  validateAcceptanceResult,
  validateDeliveryResult,
  compileResult,
  finalAcceptanceDigest,
  buildClosedClosure,
  blockedDelivery,
  runtimeResult,
  runtimeOperationKey,
  makeNativeWorkerPrompt,
  makeNativeAuditorPrompt,
  serialExecutor,
  closeIfLive,
};
