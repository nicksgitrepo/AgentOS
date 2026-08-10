#!/usr/bin/env node

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";

export const BOOTSTRAP_SAFETY_SCHEMA = "agentos.bootstrap_safety_analysis.v1";
export const BOOTSTRAP_OPERATING_MODES = Object.freeze(["JSA", "EXACT_PLAN_APPROVAL"]);
export const DEFAULT_BOOTSTRAP_OPERATING_MODE = "JSA";
export const JSA_PLAN_STATUS = "JSA_READY_WITHIN_SCOPE";
export const LOCAL_CAMPAIGN_START_ACTION = "START_IN_SCOPE_LOCAL_CAMPAIGN";
export const LOCAL_CAMPAIGN_START_SCHEMA = "agentos.bootstrap_local_campaign_start.v1";
export const HOST_RUNTIME_READBACK_SCHEMA = "agentos.host_runtime_readbacks.v1";
export const LEGACY_GUI_HOST_READBACK_SCHEMA = "agentos.gui_host_readbacks.v1";
export const LOCAL_CAMPAIGN_PROTECTED_ACTIONS = Object.freeze({
  publication: false,
  push: false,
  merge: false,
  deployment: false,
  spending: false,
  remote_authentication: false,
  secrets: false,
  destructive_overwrite: false,
  product_custody: false,
  product_write: false,
  generic_campaign_activation: false,
});
export const JSA_IN_SCOPE_ACTIONS = Object.freeze([
  "CREATE_CONTROL_PLANE_STAGING",
  "CREATE_SOURCE_PRESERVATION_RECORDS",
  "PROMOTE_CONTROL_PLANE_STATE",
  "RUN_LOCAL_READ_ONLY_PROBES",
  "RUN_SETUP_AUDIT",
  "START_IN_SCOPE_LOCAL_CAMPAIGN",
  "WRITE_TYPED_PROJECT_CONTEXT",
]);
export const JSA_SOFT_BOUNDARIES = Object.freeze([
  "CONFLICTING_DISCOVERY",
  "DELIVERY_ROUTE_NOT_YET_CHOSEN",
  "MATERIAL_OWNER_CHOICE",
  "UNSUPPORTED_OPTION",
]);
export const JSA_HARD_BOUNDARIES = Object.freeze([
  "DECLARED_SCOPE_CHANGED",
  "OWNER_INTENT_CHANGED",
  "PROTECTED_ACTION_REQUESTED",
  "SECRET_OR_PRIVATE_DATA_DETECTED",
  "SOURCE_OR_DISCOVERY_CHANGED",
  "UNVERIFIED_HOST_CAPABILITY",
]);
export const PROTECTED_BOOTSTRAP_ACTIONS = Object.freeze([
  "CAMPAIGN_ACTIVATION",
  "DEPLOYMENT",
  "DESTRUCTIVE_OVERWRITE",
  "MERGE",
  "PRODUCT_CUSTODY",
  "PRODUCT_WRITE",
  "PUBLICATION",
  "PUSH",
  "REMOTE_AUTHENTICATION",
  "ROLLBACK",
  "SECRETS",
  "SPENDING",
]);

const SHA256 = /^[0-9a-f]{64}$/u;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value, label) {
  assert(isRecord(value), `${label} must be an object`);
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
}

function requireIdentifier(value, label) {
  requireString(value, label);
  assert(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value), `${label} is not a stable identifier`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function sortedUnique(values, label) {
  assert(Array.isArray(values) && values.length > 0, `${label} must not be empty`);
  assert(values.every((value) => typeof value === "string" && value.length > 0), `${label} contains an invalid value`);
  const sorted = [...values].sort(compareUtf8);
  assert(new Set(values).size === values.length && JSON.stringify(values) === JSON.stringify(sorted), `${label} must be sorted and unique`);
}

function exactKeys(value, keys, label) {
  requireRecord(value, label);
  const actual = Object.keys(value).sort(compareUtf8);
  const expected = [...keys].sort(compareUtf8);
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} fields mismatch`);
}

function scopeInputsDigest({authorityBoundaries, deliveryPolicy, projectLifeContract}) {
  return canonicalDigest({authority_boundaries: authorityBoundaries, delivery_policy: deliveryPolicy, project_life_contract: projectLifeContract});
}

export function compileBootstrapSafetyAnalysis({
  operatingMode = DEFAULT_BOOTSTRAP_OPERATING_MODE,
  authorityBoundaries,
  deliveryPolicy,
  projectLifeContract,
} = {}) {
  assert(BOOTSTRAP_OPERATING_MODES.includes(operatingMode), `unknown Bootstrap operating mode: ${operatingMode}`);
  requireRecord(authorityBoundaries, "Bootstrap authority boundaries");
  requireRecord(deliveryPolicy, "Bootstrap delivery policy");
  requireRecord(projectLifeContract, "Bootstrap project life contract");
  const analysis = {
    schema: BOOTSTRAP_SAFETY_SCHEMA,
    version: 1,
    status: "PREPARED_NOT_ACTIVATED",
    operating_mode: operatingMode,
    scope_inputs_sha256: scopeInputsDigest({authorityBoundaries, deliveryPolicy, projectLifeContract}),
    in_scope_actions: [...JSA_IN_SCOPE_ACTIONS],
    soft_boundaries: [...JSA_SOFT_BOUNDARIES],
    hard_boundaries: [...JSA_HARD_BOUNDARIES],
    reassess_when: [
      "A_PROTECTED_ACTION_IS_REQUESTED",
      "A_SOFT_BOUNDARY_REQUIRES_A_NEW_OWNER_CHOICE",
      "OWNER_INTENT_OR_DECLARED_SCOPE_CHANGES",
      "SOURCE_OR_DISCOVERY_READBACK_CHANGES",
    ],
    protected_activation: {
      exact_owner_approval_required: true,
      protected_actions: [...PROTECTED_BOOTSTRAP_ACTIONS],
      rule: "JSA may continue declared setup actions and the source-bound local AgentOS campaign start; protected actions always require their own protected authority and are never implied by JSA.",
    },
    safety_sha256: null,
  };
  analysis.safety_sha256 = canonicalDigest({...analysis, safety_sha256: null});
  return validateBootstrapSafetyAnalysis(analysis);
}

export function validateBootstrapSafetyAnalysis(analysis) {
  exactKeys(analysis, [
    "schema", "version", "status", "operating_mode", "scope_inputs_sha256", "in_scope_actions", "soft_boundaries",
    "hard_boundaries", "reassess_when", "protected_activation", "safety_sha256",
  ], "Bootstrap safety analysis");
  assert(analysis.schema === BOOTSTRAP_SAFETY_SCHEMA && analysis.version === 1, "Bootstrap safety analysis identity is invalid");
  assert(analysis.status === "PREPARED_NOT_ACTIVATED", "Bootstrap safety analysis cannot activate AgentOS");
  assert(BOOTSTRAP_OPERATING_MODES.includes(analysis.operating_mode), "Bootstrap operating mode is invalid");
  requireSha(analysis.scope_inputs_sha256, "Bootstrap safety scope digest");
  sortedUnique(analysis.in_scope_actions, "Bootstrap in-scope actions");
  sortedUnique(analysis.soft_boundaries, "Bootstrap soft boundaries");
  sortedUnique(analysis.hard_boundaries, "Bootstrap hard boundaries");
  sortedUnique(analysis.reassess_when, "Bootstrap reassessment triggers");
  exactKeys(analysis.protected_activation, ["exact_owner_approval_required", "protected_actions", "rule"], "Bootstrap protected activation");
  assert(analysis.protected_activation.exact_owner_approval_required === true, "Bootstrap protected activation approval was weakened");
  sortedUnique(analysis.protected_activation.protected_actions, "Bootstrap protected actions");
  assert(JSON.stringify(analysis.protected_activation.protected_actions) === JSON.stringify(PROTECTED_BOOTSTRAP_ACTIONS), "Bootstrap protected action set changed");
  requireString(analysis.protected_activation.rule, "Bootstrap protected activation rule");
  requireSha(analysis.safety_sha256, "Bootstrap safety digest");
  assert(analysis.safety_sha256 === canonicalDigest({...analysis, safety_sha256: null}), "Bootstrap safety analysis is not content-addressed");
  return analysis;
}

export function validateBootstrapActionScope(actions, analysis) {
  validateBootstrapSafetyAnalysis(analysis);
  sortedUnique(actions, "Bootstrap requested actions");
  const protectedActions = actions.filter((action) => PROTECTED_BOOTSTRAP_ACTIONS.includes(action));
  if (protectedActions.length > 0) throw new Error(`JSA_HARD_BOUNDARY_PROTECTED_ACTION: ${protectedActions.join(",")}`);
  const outsideScope = actions.filter((action) => !analysis.in_scope_actions.includes(action));
  if (outsideScope.length > 0) throw new Error(`JSA_REASSESS_REQUIRED_OUT_OF_SCOPE: ${outsideScope.join(",")}`);
  return {status: "CONTINUE_WITHIN_SCOPE", actions: [...actions]};
}

function validateHostCampaignReadbacks(hostReadbacks, binding) {
  requireRecord(hostReadbacks, "local campaign host readbacks");
  assert([HOST_RUNTIME_READBACK_SCHEMA, LEGACY_GUI_HOST_READBACK_SCHEMA].includes(hostReadbacks.schema) && hostReadbacks.version === 1, "local campaign host readback schema is invalid");
  for (const field of ["project_id", "project_root", "source_commit", "source_tree", "environment_identity"]) requireString(hostReadbacks[field], `local campaign host readback ${field}`);
  requireSha(binding.plan_sha256, "local campaign Bootstrap plan");
  assert(hostReadbacks.project_root === binding.project_root, "local campaign host project differs from Bootstrap");
  assert(hostReadbacks.source_commit === binding.source_commit && hostReadbacks.source_tree === binding.source_tree, "local campaign host source differs from Bootstrap");
  requireRecord(hostReadbacks.workspace_readback, "local campaign workspace readback");
  assert(hostReadbacks.workspace_readback.project_root === hostReadbacks.project_root
    && hostReadbacks.workspace_readback.source_commit === hostReadbacks.source_commit
    && hostReadbacks.workspace_readback.source_tree === hostReadbacks.source_tree,
  "local campaign workspace readback differs from the host binding");
  requireRecord(hostReadbacks.runtime_readback, "local campaign Runtime readback");
  assert(hostReadbacks.runtime_readback.session_id === hostReadbacks.proof?.listed_runtime_thread_id
    && hostReadbacks.runtime_readback.persistent === true
    && hostReadbacks.runtime_readback.pinned === true
    && hostReadbacks.runtime_readback.resume_readback === true,
  "local campaign Runtime readback does not prove the pinned resumable Runtime");
  requireRecord(hostReadbacks.controller_runtime_readback, "local campaign Controller Runtime readback");
  assert(hostReadbacks.controller_runtime_readback.project_id === hostReadbacks.project_id
    && hostReadbacks.controller_runtime_readback.controller_runtime_id === hostReadbacks.proof?.listed_controller_thread_id
    && hostReadbacks.controller_runtime_readback.runtime_id === hostReadbacks.proof?.listed_runtime_thread_id
    && hostReadbacks.controller_runtime_readback.status === "ACTIVE",
  "local campaign Controller Runtime readback is not bound to the host tasks");
  requireRecord(hostReadbacks.proof, "local campaign host proof");
  for (const field of [
    "listed_controller_thread_id", "listed_runtime_thread_id", "controller_read_thread_id", "runtime_read_thread_id",
    "runtime_send_thread_id", "runtime_resume_turn_id",
  ]) requireString(hostReadbacks.proof[field], `local campaign host proof ${field}`);
  assert(hostReadbacks.proof.listed_controller_thread_id === hostReadbacks.proof.controller_read_thread_id
    && hostReadbacks.proof.listed_runtime_thread_id === hostReadbacks.proof.runtime_read_thread_id
    && hostReadbacks.proof.runtime_send_thread_id === hostReadbacks.proof.listed_runtime_thread_id
    && hostReadbacks.proof.controller_pinned === true
    && hostReadbacks.proof.runtime_pinned === true
    && hostReadbacks.proof.controller_active === true
    && hostReadbacks.proof.runtime_resumed === true,
  "local campaign host proof is incomplete");
  return hostReadbacks;
}

export function compileInScopeLocalCampaignStart({
  bootstrapBinding,
  safetyAnalysis,
  hostReadbacks,
  campaignId = "FIRST-LOCAL-CAMPAIGN",
  campaignVersion = "V1",
  firstCampaignStatus = "MINIMAL_EMPTY_SYNTHETIC_CAMPAIGN",
  observedAtUtc,
} = {}) {
  requireRecord(bootstrapBinding, "local campaign Bootstrap binding");
  requireRecord(safetyAnalysis, "local campaign safety analysis");
  requireRecord(hostReadbacks, "local campaign host readbacks");
  assert(bootstrapBinding.status === JSA_PLAN_STATUS && bootstrapBinding.operating_mode === "JSA", "local campaign Bootstrap binding is not JSA-ready");
  assert(bootstrapBinding.recorded_plan_is_launch_gate === true
    && bootstrapBinding.separate_owner_approval_required === false
    && bootstrapBinding.owner_approval_pause === false,
  "local campaign is still on an approval-only path");
  validateBootstrapActionScope([LOCAL_CAMPAIGN_START_ACTION], safetyAnalysis);
  requireIdentifier(campaignId, "local campaign ID");
  requireString(campaignVersion, "local campaign version");
  requireString(firstCampaignStatus, "local campaign status");
  requireString(observedAtUtc, "local campaign start time");
  assert(!Number.isNaN(Date.parse(observedAtUtc)) && observedAtUtc.endsWith("Z"), "local campaign start time must be UTC");
  for (const field of ["project_root", "source_commit", "source_tree"]) requireString(bootstrapBinding[field], `local campaign Bootstrap binding ${field}`);
  const bound = validateHostCampaignReadbacks(hostReadbacks, bootstrapBinding);
  const record = {
    schema: LOCAL_CAMPAIGN_START_SCHEMA,
    version: 1,
    status: "CAMPAIGN_STARTED_EMPTY_ROSTER",
    action: LOCAL_CAMPAIGN_START_ACTION,
    project_id: bound.project_id,
    project_root: bound.project_root,
    source_commit: bound.source_commit,
    source_tree: bound.source_tree,
    environment_identity: bound.environment_identity,
    plan_sha256: bootstrapBinding.plan_sha256,
    campaign_id: campaignId,
    campaign_version: campaignVersion,
    first_campaign_status: firstCampaignStatus,
    recorded_plan_is_launch_gate: true,
    separate_owner_approval_required: false,
    owner_approval_pause: false,
    active_campaign: true,
    active_worker_count: 0,
    roster_status: "EMPTY_BEFORE_FOUNDATION_LANES",
    next_phase: "ASSEMBLE_FOUNDATION_LANES",
    controller_runtime_id: bound.controller_runtime_readback.controller_runtime_id,
    runtime_id: bound.runtime_readback.session_id,
    controller_pinned: bound.proof.controller_pinned,
    runtime_pinned: bound.proof.runtime_pinned,
    runtime_resumed: bound.proof.runtime_resumed,
    protected_actions: {...LOCAL_CAMPAIGN_PROTECTED_ACTIONS},
    external_actions_attempted: false,
    observed_at_utc: observedAtUtc,
    host_proof: {
      controller_thread_id: bound.proof.listed_controller_thread_id,
      runtime_thread_id: bound.proof.listed_runtime_thread_id,
      runtime_resume_turn_id: bound.proof.runtime_resume_turn_id,
    },
    start_sha256: null,
  };
  record.start_sha256 = canonicalDigest({...record, start_sha256: null});
  return record;
}

export function isJsaPlan(plan) {
  return isRecord(plan) && plan.status === JSA_PLAN_STATUS && plan.bootstrap_safety_analysis?.operating_mode === "JSA";
}

export function isExactApprovalPlan(plan) {
  return isRecord(plan) && plan.status === "APPROVED_EXACT_DIGEST";
}
