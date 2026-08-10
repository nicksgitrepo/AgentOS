#!/usr/bin/env node

/*
 * Capability-based task/model routing.
 *
 * This module is deliberately integration-neutral. Bootstrap, campaign, and
 * native-host controllers can consume these records, but this slice never
 * creates a host session or treats a requested model as execution proof.
 */

import {assertPersistedRecordSafe, canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {
  validateTaskContextPolicy,
  validateTaskContextSelection,
  TASK_CONTEXT_SELECTION_SCHEMA,
} from "./task-context-firewall.mjs";
import {
  compileEffectiveModelReadbackRecord,
  compileFallbackBoundaryRecord as compileFallbackBoundary,
  requireVerifiedEffectiveModelRecord,
  validateEffectiveModelReadbackRecord,
  validateFallbackBoundaryRecord,
} from "./task-model-routing-support.mjs";
import {RoutingBoundaryError} from "./task-model-routing-support.mjs";
export {RoutingBoundaryError} from "./task-model-routing-support.mjs";

export const TASK_PROFILE_SCHEMA = "agentos.task_profile.v1";
export const TASK_MODEL_POLICY_SCHEMA = "agentos.task_model_policy.v1";
export const HOST_CAPABILITY_CATALOG_SCHEMA = "agentos.host_capability_catalog.v1";
export const EXECUTION_ROUTE_SCHEMA = "agentos.execution_route.v1";
export const EFFECTIVE_MODEL_READBACK_SCHEMA = "agentos.effective_model_readback.v1";
export const FALLBACK_BOUNDARY_SCHEMA = "agentos.routing_fallback_boundary.v1";
export const HOST_CAPABILITY_ATTESTATION_SCHEMA = "agentos.host_capability_attestation.v1";
export const ROUTING_UNAVAILABLE_SCHEMA = "agentos.routing_unavailable.v1";

export const DEFAULT_MODEL = "HOST_DEFAULT";
export const DEFAULT_REASONING_EFFORT = "max";
export const DEFAULT_MINIMUM_SUCCESS_PROBABILITY = 0.8;
export const DEFAULT_COST_UNIT = "RELATIVE_ACCEPTED_RESULT_UNIT";

export const REASONING_EFFORTS = Object.freeze(["low", "medium", "high", "max"]);
export const VERIFIER_STRENGTHS = Object.freeze([
  "NONE",
  "DETERMINISTIC",
  "INDEPENDENT_AUDITOR",
  "HIGH_ASSURANCE",
]);
export const MODEL_PREFERENCES = Object.freeze([
  "BALANCED",
  "SAVE_EFFORT",
  "FINISH_SOONER",
  "TAKE_EXTRA_CARE",
]);
export const TASK_SENSITIVITIES = Object.freeze(["NORMAL", "SENSITIVE", "CRITICAL"]);
export const WORKER_SHAPES = Object.freeze(["SINGLE_BOUNDED_WORKER", "SMALL_PARALLEL_TEAM", "INDEPENDENT_REVIEW_TEAM"]);
export const WORKSPACE_CAPABILITIES = Object.freeze(["READ_ONLY_SOURCE", "ASSIGNED_WORKTREE", "HOST_BOUND_WORKSPACE"]);
export const EVIDENCE_PATHS = Object.freeze(["TASK_EVIDENCE_RECORD", "CAMPAIGN_HANDOFF_RECORD", "INDEPENDENT_REVIEW_RECORD"]);
export const PERMISSION_CLASSES = Object.freeze([
  "READ_SOURCE",
  "READ_ASSIGNED_WORKTREE",
  "WRITE_ASSIGNED_WORKTREE",
  "HOST_LIFECYCLE",
  "EMIT_EVIDENCE",
  "INDEPENDENT_REVIEW",
  "PROTECTED_EXTERNAL_ACTION",
]);
export const ROUTABLE_PERMISSION_CLASSES = Object.freeze(
  PERMISSION_CLASSES.filter((value) => value !== "PROTECTED_EXTERNAL_ACTION"),
);
export const SAFE_FALLBACK_TRIGGERS = Object.freeze([
  "MODEL_UNAVAILABLE",
  "RATE_LIMITED",
  "CAPACITY_UNAVAILABLE",
  "CONTEXT_UNAVAILABLE",
  "BUDGET_EXCEEDED",
]);
export const HARD_BOUNDARY_TRIGGERS = Object.freeze([
  "READBACK_UNKNOWN",
  "READBACK_MISMATCH",
  "PERMISSION_MISMATCH",
  "SCOPE_MISMATCH",
  "PRIVACY_BOUNDARY",
  "VERIFIER_TOO_WEAK",
  "SOURCE_MISMATCH",
]);

const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const TOOL_IDENTIFIER = /^[a-z][a-z0-9._:-]*$/u;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const REASONING_RANK = new Map(REASONING_EFFORTS.map((value, index) => [value, index + 1]));
const VERIFIER_RANK = new Map(VERIFIER_STRENGTHS.map((value, index) => [value, index]));
const WORKER_RANK = new Map(WORKER_SHAPES.map((value, index) => [value, index + 1]));
const SENSITIVITY_MINIMUMS = Object.freeze({
  NORMAL: {reasoning: "low", verifier: "DETERMINISTIC"},
  SENSITIVE: {reasoning: "high", verifier: "INDEPENDENT_AUDITOR"},
  CRITICAL: {reasoning: "max", verifier: "HIGH_ASSURANCE"},
});

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value, label) {
  assertCondition(isRecord(value), `${label} must be an object`);
  return value;
}

function exactKeys(value, expected, label) {
  requireRecord(value, label);
  const actual = Object.keys(value).sort(compareUtf8);
  const keys = [...expected].sort(compareUtf8);
  assertCondition(JSON.stringify(actual) === JSON.stringify(keys), `${label} fields mismatch`);
}

function requireString(value, label) {
  assertCondition(typeof value === "string" && value.length > 0 && value === value.trim(), `${label} must be a trimmed nonempty string`);
  assertCondition(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains control characters`);
  return value;
}

function requireIdentifier(value, label, {tool = false} = {}) {
  requireString(value, label);
  assertCondition((tool ? TOOL_IDENTIFIER : IDENTIFIER).test(value), `${label} is not a safe identifier`);
  return value;
}

function requireSha(value, label) {
  assertCondition(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
  return value;
}

function requireUtc(value, label) {
  requireString(value, label);
  assertCondition(UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} must be UTC`);
  return value;
}

function requireEnum(value, values, label) {
  requireString(value, label);
  assertCondition(values.includes(value), `${label} is invalid`);
  return value;
}

function requirePositiveInteger(value, label) {
  assertCondition(Number.isSafeInteger(value) && value > 0, `${label} must be a positive safe integer`);
  return value;
}

function requireNonnegativeInteger(value, label) {
  assertCondition(Number.isSafeInteger(value) && value >= 0, `${label} must be a nonnegative safe integer`);
  return value;
}

function requireProbability(value, label) {
  assertCondition(typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 1, `${label} must be in (0, 1]`);
  return value;
}

function requireNonnegativeFinite(value, label) {
  assertCondition(typeof value === "number" && Number.isFinite(value) && value >= 0, `${label} must be finite and nonnegative`);
  return value;
}

function requirePositiveFinite(value, label) {
  assertCondition(typeof value === "number" && Number.isFinite(value) && value > 0, `${label} must be finite and positive`);
  return value;
}

function sortedUnique(values, label, {tool = false} = {}) {
  assertCondition(Array.isArray(values), `${label} must be an array`);
  const normalized = values.map((value) => requireIdentifier(value, `${label} item`, {tool}));
  const sorted = [...normalized].sort(compareUtf8);
  assertCondition(new Set(sorted).size === sorted.length, `${label} must not contain duplicates`);
  return sorted;
}

function requireSortedUnique(values, label, {tool = false} = {}) {
  const sorted = sortedUnique(values, label, {tool});
  assertCondition(JSON.stringify(values) === JSON.stringify(sorted), `${label} must be UTF-8 sorted and unique`);
  return values;
}

function subset(required, available) {
  const set = new Set(available);
  return required.every((value) => set.has(value));
}

function intersection(...arrays) {
  if (arrays.length === 0) return [];
  const [first, ...rest] = arrays;
  const sets = rest.map((values) => new Set(values));
  return [...new Set(first)].filter((value) => sets.every((set) => set.has(value))).sort(compareUtf8);
}

function maxReasoning(left, right) {
  return REASONING_RANK.get(left) >= REASONING_RANK.get(right) ? left : right;
}

function maxVerifier(left, right) {
  return VERIFIER_RANK.get(left) >= VERIFIER_RANK.get(right) ? left : right;
}

function sensitivityMinimums(sensitivity) {
  return SENSITIVITY_MINIMUMS[sensitivity];
}

function digestWithout(record, field) {
  return canonicalDigest({...record, [field]: null});
}

function privacyCheck(record, label) {
  try {
    assertPersistedRecordSafe(record);
  } catch (error) {
    throw new Error(`${label} failed persisted-record privacy check: ${error.message}`);
  }
  return record;
}

function requireDigestMatch(record, field, label) {
  requireSha(record[field], `${label}.${field}`);
  assertCondition(record[field] === digestWithout(record, field), `${label} digest does not match content`);
}

function validatePermissionList(values, label, {allowProtected = false} = {}) {
  assertCondition(Array.isArray(values), `${label} must be an array`);
  const normalized = [...values];
  normalized.forEach((value) => requireEnum(value, PERMISSION_CLASSES, `${label} permission`));
  if (!allowProtected) assertCondition(!normalized.includes("PROTECTED_EXTERNAL_ACTION"), `${label} cannot grant protected external actions`);
  const sorted = [...normalized].sort(compareUtf8);
  assertCondition(new Set(sorted).size === sorted.length && JSON.stringify(normalized) === JSON.stringify(sorted), `${label} must be unique and UTF-8 sorted`);
  return normalized;
}

function validateFallbackPolicy(value, label = "fallback policy") {
  exactKeys(value, ["enabled", "max_attempts", "allowed_triggers", "ordered_models", "preserve_requirements", "deny_downgrade"], label);
  assertCondition(typeof value.enabled === "boolean", `${label}.enabled is invalid`);
  requireNonnegativeInteger(value.max_attempts, `${label}.max_attempts`);
  if (value.enabled) assertCondition(value.max_attempts > 0, `${label}.max_attempts must be positive when enabled`);
  const triggers = requireSortedUnique(value.allowed_triggers, `${label}.allowed_triggers`);
  assertCondition(triggers.every((trigger) => SAFE_FALLBACK_TRIGGERS.includes(trigger)), `${label} contains a hard-boundary trigger`);
  const models = sortedUnique(value.ordered_models, `${label}.ordered_models`);
  assertCondition(value.preserve_requirements === true && value.deny_downgrade === true, `${label} must preserve requirements and deny downgrade`);
  if (!value.enabled) assertCondition(triggers.length === 0 && models.length === 0 && value.max_attempts === 0, `${label} disabled form is invalid`);
  return value;
}

function normalizeOverride(value, index) {
  exactKeys(value, ["scope", "scope_ref", "model", "reasoning_effort"], `model override ${index}`);
  const scope = requireEnum(value.scope, ["ROLE", "LANE"], `model override ${index}.scope`);
  const scopeRef = requireIdentifier(value.scope_ref, `model override ${index}.scope_ref`);
  const model = requireIdentifier(value.model, `model override ${index}.model`);
  const reasoningEffort = requireEnum(value.reasoning_effort, REASONING_EFFORTS, `model override ${index}.reasoning_effort`);
  return {scope, scope_ref: scopeRef, model, reasoning_effort: reasoningEffort};
}

function validateOverrides(values) {
  assertCondition(Array.isArray(values), "model overrides must be an array");
  const normalized = values.map(normalizeOverride);
  const keys = normalized.map((value) => `${value.scope}\u0000${value.scope_ref}`);
  assertCondition(new Set(keys).size === keys.length, "model overrides contain duplicate scopes");
  normalized.sort((left, right) => compareUtf8(`${left.scope}\u0000${left.scope_ref}`, `${right.scope}\u0000${right.scope_ref}`));
  return normalized;
}

function overrideFor(profile, policy) {
  const lane = policy.overrides.find((value) => value.scope === "LANE" && value.scope_ref === profile.lane);
  if (lane) return {value: lane, source: "OWNER_LANE_OVERRIDE"};
  const role = policy.overrides.find((value) => value.scope === "ROLE" && value.scope_ref === profile.role);
  if (role) return {value: role, source: "OWNER_ROLE_OVERRIDE"};
  return {value: {model: policy.default_model, reasoning_effort: policy.default_reasoning_effort}, source: "POLICY_DEFAULT"};
}

function candidateKey(candidate) {
  return `${candidate.model}\u0000${candidate.reasoning_effort}`;
}

function compareCandidateIdentity(left, right) {
  return compareUtf8(candidateKey(left), candidateKey(right));
}

function validateModelCandidate(value, index) {
  const label = `capability catalog model ${index}`;
  exactKeys(value, [
    "model", "reasoning_effort", "capabilities", "context_tokens", "tools", "verifier_strength", "permissions",
    "expected_cost", "estimated_wall_seconds", "estimated_success_probability", "cost_unit", "spawnable",
    "worker_shapes", "workspace_capabilities", "evidence_paths",
  ], label);
  requireIdentifier(value.model, `${label}.model`);
  requireEnum(value.reasoning_effort, REASONING_EFFORTS, `${label}.reasoning_effort`);
  requireSortedUnique(value.capabilities, `${label}.capabilities`);
  requirePositiveInteger(value.context_tokens, `${label}.context_tokens`);
  requireSortedUnique(value.tools, `${label}.tools`, {tool: true});
  requireEnum(value.verifier_strength, VERIFIER_STRENGTHS, `${label}.verifier_strength`);
  validatePermissionList(value.permissions, `${label}.permissions`, {allowProtected: true});
  requireNonnegativeFinite(value.expected_cost, `${label}.expected_cost`);
  requirePositiveFinite(value.estimated_wall_seconds, `${label}.estimated_wall_seconds`);
  requireProbability(value.estimated_success_probability, `${label}.estimated_success_probability`);
  requireIdentifier(value.cost_unit, `${label}.cost_unit`);
  assertCondition(typeof value.spawnable === "boolean", `${label}.spawnable is invalid`);
  requireSortedUnique(value.worker_shapes, `${label}.worker_shapes`);
  assertCondition(value.worker_shapes.every((shape) => WORKER_SHAPES.includes(shape)), `${label}.worker_shapes contains an invalid worker shape`);
  requireSortedUnique(value.workspace_capabilities, `${label}.workspace_capabilities`);
  assertCondition(value.workspace_capabilities.every((capability) => WORKSPACE_CAPABILITIES.includes(capability)), `${label}.workspace_capabilities contains an invalid workspace capability`);
  requireSortedUnique(value.evidence_paths, `${label}.evidence_paths`);
  assertCondition(value.evidence_paths.every((path) => EVIDENCE_PATHS.includes(path)), `${label}.evidence_paths contains an invalid evidence path`);
  return value;
}

function validateTaskProfileShape(profile) {
  exactKeys(profile, [
    "schema", "version", "status", "task_ref_sha256", "goal_ref_sha256", "project_context_sha256", "role", "lane",
    "task_class", "sensitivity", "required_capabilities", "required_context_tokens", "required_tools",
    "minimum_reasoning_effort", "verifier_strength", "required_permissions", "permission_ceiling", "max_expected_cost",
    "deadline_seconds", "required_worker_shape", "required_workspace_capability", "required_evidence_path",
    "fallback_allowed", "fallback_triggers", "digest",
  ], "task profile");
  assertCondition(profile.schema === TASK_PROFILE_SCHEMA && profile.version === 1 && profile.status === "VALIDATED", "task profile identity is invalid");
  for (const field of ["task_ref_sha256", "goal_ref_sha256", "project_context_sha256"]) requireSha(profile[field], `task profile ${field}`);
  for (const field of ["role", "lane", "task_class"]) requireIdentifier(profile[field], `task profile ${field}`);
  requireEnum(profile.sensitivity, TASK_SENSITIVITIES, "task profile sensitivity");
  requireSortedUnique(profile.required_capabilities, "task profile required_capabilities");
  requirePositiveInteger(profile.required_context_tokens, "task profile required_context_tokens");
  requireSortedUnique(profile.required_tools, "task profile required_tools", {tool: true});
  requireEnum(profile.minimum_reasoning_effort, REASONING_EFFORTS, "task profile minimum_reasoning_effort");
  requireEnum(profile.verifier_strength, VERIFIER_STRENGTHS, "task profile verifier_strength");
  validatePermissionList(profile.required_permissions, "task profile required_permissions");
  validatePermissionList(profile.permission_ceiling, "task profile permission_ceiling");
  assertCondition(subset(profile.required_permissions, profile.permission_ceiling), "task profile required permissions exceed its ceiling");
  if (profile.max_expected_cost !== null) requireNonnegativeFinite(profile.max_expected_cost, "task profile max_expected_cost");
  if (profile.deadline_seconds !== null) requirePositiveFinite(profile.deadline_seconds, "task profile deadline_seconds");
  requireEnum(profile.required_worker_shape, WORKER_SHAPES, "task profile required_worker_shape");
  requireEnum(profile.required_workspace_capability, WORKSPACE_CAPABILITIES, "task profile required_workspace_capability");
  requireEnum(profile.required_evidence_path, EVIDENCE_PATHS, "task profile required_evidence_path");
  assertCondition(typeof profile.fallback_allowed === "boolean", "task profile fallback_allowed is invalid");
  const triggers = requireSortedUnique(profile.fallback_triggers, "task profile fallback_triggers");
  assertCondition(triggers.every((trigger) => SAFE_FALLBACK_TRIGGERS.includes(trigger)), "task profile fallback contains a hard-boundary trigger");
  if (!profile.fallback_allowed) assertCondition(triggers.length === 0, "task profile disabled fallback must have no triggers");
  const minimums = sensitivityMinimums(profile.sensitivity);
  assertCondition(REASONING_RANK.get(profile.minimum_reasoning_effort) >= REASONING_RANK.get(minimums.reasoning), "task profile reasoning floor is unsafe for sensitivity");
  assertCondition(VERIFIER_RANK.get(profile.verifier_strength) >= VERIFIER_RANK.get(minimums.verifier), "task profile verifier floor is unsafe for sensitivity");
  assertCondition(!profile.permission_ceiling.includes("PROTECTED_EXTERNAL_ACTION"), "task profile cannot grant protected external actions");
  requireDigestMatch(profile, "digest", "task profile");
  return privacyCheck(profile, "task profile");
}

export function compileTaskProfile({
  taskRefSha256,
  goalRefSha256,
  projectContextSha256,
  role,
  lane,
  taskClass,
  sensitivity = "NORMAL",
  requiredCapabilities = [],
  requiredContextTokens,
  requiredTools = [],
  minimumReasoningEffort = null,
  verifierStrength = null,
  requiredPermissions = [],
  permissionCeiling = [...ROUTABLE_PERMISSION_CLASSES],
  maxExpectedCost = null,
  deadlineSeconds = null,
  requiredWorkerShape = "SINGLE_BOUNDED_WORKER",
  requiredWorkspaceCapability = "ASSIGNED_WORKTREE",
  requiredEvidencePath = "TASK_EVIDENCE_RECORD",
  fallbackAllowed = true,
  fallbackTriggers = [...SAFE_FALLBACK_TRIGGERS],
}) {
  requireSha(taskRefSha256, "taskRefSha256");
  requireSha(goalRefSha256, "goalRefSha256");
  requireSha(projectContextSha256, "projectContextSha256");
  requireIdentifier(role, "role");
  requireIdentifier(lane, "lane");
  requireIdentifier(taskClass, "taskClass");
  requireEnum(sensitivity, TASK_SENSITIVITIES, "sensitivity");
  assertCondition(typeof fallbackAllowed === "boolean", "fallbackAllowed must be boolean");
  const minimums = sensitivityMinimums(sensitivity);
  const profile = {
    schema: TASK_PROFILE_SCHEMA,
    version: 1,
    status: "VALIDATED",
    task_ref_sha256: taskRefSha256,
    goal_ref_sha256: goalRefSha256,
    project_context_sha256: projectContextSha256,
    role,
    lane,
    task_class: taskClass,
    sensitivity,
    required_capabilities: sortedUnique(requiredCapabilities, "requiredCapabilities"),
    required_context_tokens: requirePositiveInteger(requiredContextTokens, "requiredContextTokens"),
    required_tools: sortedUnique(requiredTools, "requiredTools", {tool: true}),
    minimum_reasoning_effort: minimumReasoningEffort ?? minimums.reasoning,
    verifier_strength: verifierStrength ?? minimums.verifier,
    required_permissions: validatePermissionList([...requiredPermissions].sort(compareUtf8), "requiredPermissions"),
    permission_ceiling: validatePermissionList([...permissionCeiling].sort(compareUtf8), "permissionCeiling"),
    max_expected_cost: maxExpectedCost,
    deadline_seconds: deadlineSeconds,
    required_worker_shape: requireEnum(requiredWorkerShape, WORKER_SHAPES, "requiredWorkerShape"),
    required_workspace_capability: requireEnum(requiredWorkspaceCapability, WORKSPACE_CAPABILITIES, "requiredWorkspaceCapability"),
    required_evidence_path: requireEnum(requiredEvidencePath, EVIDENCE_PATHS, "requiredEvidencePath"),
    fallback_allowed: fallbackAllowed,
    fallback_triggers: fallbackAllowed ? sortedUnique(fallbackTriggers, "fallbackTriggers") : [],
    digest: null,
  };
  profile.digest = digestWithout(profile, "digest");
  return validateTaskProfileShape(profile);
}

export function validateTaskProfile(profile) {
  return validateTaskProfileShape(profile);
}

function validatePolicyShape(policy) {
  exactKeys(policy, [
    "schema", "version", "status", "default_model", "default_reasoning_effort", "preference", "minimum_success_probability",
    "minimum_reasoning_effort", "required_verifier_strength", "max_context_tokens", "max_expected_cost", "cost_unit",
    "allowed_permissions", "overrides", "fallback", "digest",
  ], "task model policy");
  assertCondition(policy.schema === TASK_MODEL_POLICY_SCHEMA && policy.version === 1 && policy.status === "VALIDATED", "task model policy identity is invalid");
  requireIdentifier(policy.default_model, "task model policy default_model");
  requireEnum(policy.default_reasoning_effort, REASONING_EFFORTS, "task model policy default_reasoning_effort");
  requireEnum(policy.preference, MODEL_PREFERENCES, "task model policy preference");
  requireProbability(policy.minimum_success_probability, "task model policy minimum_success_probability");
  requireEnum(policy.minimum_reasoning_effort, REASONING_EFFORTS, "task model policy minimum_reasoning_effort");
  requireEnum(policy.required_verifier_strength, VERIFIER_STRENGTHS, "task model policy required_verifier_strength");
  if (policy.max_context_tokens !== null) requirePositiveInteger(policy.max_context_tokens, "task model policy max_context_tokens");
  if (policy.max_expected_cost !== null) requireNonnegativeFinite(policy.max_expected_cost, "task model policy max_expected_cost");
  requireIdentifier(policy.cost_unit, "task model policy cost_unit");
  validatePermissionList(policy.allowed_permissions, "task model policy allowed_permissions");
  const normalizedOverrides = validateOverrides(policy.overrides);
  assertCondition(JSON.stringify(normalizedOverrides) === JSON.stringify(policy.overrides), "task model policy overrides must be canonical");
  validateFallbackPolicy(policy.fallback, "task model policy fallback");
  requireDigestMatch(policy, "digest", "task model policy");
  return privacyCheck(policy, "task model policy");
}

export function compileTaskModelPolicy({
  defaultModel = DEFAULT_MODEL,
  defaultReasoningEffort = DEFAULT_REASONING_EFFORT,
  preference = "BALANCED",
  minimumSuccessProbability = DEFAULT_MINIMUM_SUCCESS_PROBABILITY,
  minimumReasoningEffort = "low",
  requiredVerifierStrength = "DETERMINISTIC",
  maxContextTokens = null,
  maxExpectedCost = null,
  costUnit = DEFAULT_COST_UNIT,
  allowedPermissions = ["EMIT_EVIDENCE", "HOST_LIFECYCLE", "READ_ASSIGNED_WORKTREE", "READ_SOURCE", "WRITE_ASSIGNED_WORKTREE"],
  overrides = [],
  fallback = {},
} = {}) {
  const fallbackEnabled = fallback.enabled ?? true;
  const normalizedFallback = {
    enabled: fallbackEnabled,
    max_attempts: fallbackEnabled ? (fallback.max_attempts ?? 2) : 0,
    allowed_triggers: fallbackEnabled ? [...(fallback.allowed_triggers ?? SAFE_FALLBACK_TRIGGERS)].sort(compareUtf8) : [],
    ordered_models: fallbackEnabled ? [...(fallback.ordered_models ?? [])].sort(compareUtf8) : [],
    preserve_requirements: fallback.preserve_requirements ?? true,
    deny_downgrade: fallback.deny_downgrade ?? true,
  };
  const policy = {
    schema: TASK_MODEL_POLICY_SCHEMA,
    version: 1,
    status: "VALIDATED",
    default_model: defaultModel,
    default_reasoning_effort: defaultReasoningEffort,
    preference,
    minimum_success_probability: minimumSuccessProbability,
    minimum_reasoning_effort: minimumReasoningEffort,
    required_verifier_strength: requiredVerifierStrength,
    max_context_tokens: maxContextTokens,
    max_expected_cost: maxExpectedCost,
    cost_unit: costUnit,
    allowed_permissions: [...allowedPermissions].sort(compareUtf8),
    overrides: validateOverrides(overrides),
    fallback: normalizedFallback,
    digest: null,
  };
  policy.digest = digestWithout(policy, "digest");
  return validatePolicyShape(policy);
}

export function validateTaskModelPolicy(policy) {
  return validatePolicyShape(policy);
}

function validateCatalogShape(catalog) {
  exactKeys(catalog, ["schema", "version", "status", "attestation_mode", "attachment_ref_sha256", "observed_at_utc", "models", "digest"], "host capability catalog");
  assertCondition(catalog.schema === HOST_CAPABILITY_CATALOG_SCHEMA && catalog.version === 1 && catalog.status === "DECLARED", "host capability catalog identity is invalid");
  assertCondition(catalog.attestation_mode === "DECLARATION", "host capability catalog must remain an unverified declaration");
  requireSha(catalog.attachment_ref_sha256, "host capability catalog attachment_ref_sha256");
  requireUtc(catalog.observed_at_utc, "host capability catalog observed_at_utc");
  assertCondition(Array.isArray(catalog.models) && catalog.models.length > 0, "host capability catalog models are missing");
  catalog.models.forEach(validateModelCandidate);
  const identities = catalog.models.map(candidateKey);
  assertCondition(new Set(identities).size === identities.length, "host capability catalog model combinations are duplicated");
  const sorted = [...catalog.models].sort(compareCandidateIdentity);
  assertCondition(JSON.stringify(catalog.models) === JSON.stringify(sorted), "host capability catalog models must be sorted");
  requireDigestMatch(catalog, "digest", "host capability catalog");
  return privacyCheck(catalog, "host capability catalog");
}

function canonicalModelCandidate(value) {
  const candidate = structuredClone(value);
  for (const field of ["capabilities", "tools", "permissions", "worker_shapes", "workspace_capabilities", "evidence_paths"]) {
    if (Array.isArray(candidate[field])) candidate[field] = [...candidate[field]].sort(compareUtf8);
  }
  return candidate;
}

export function compileHostCapabilityCatalog({
  attachmentRefSha256,
  observedAtUtc,
  models,
}) {
  const catalog = {
    schema: HOST_CAPABILITY_CATALOG_SCHEMA,
    version: 1,
    status: "DECLARED",
    attestation_mode: "DECLARATION",
    attachment_ref_sha256: attachmentRefSha256,
    observed_at_utc: observedAtUtc,
    models: structuredClone(models).map(canonicalModelCandidate).sort(compareCandidateIdentity),
    digest: null,
  };
  catalog.digest = digestWithout(catalog, "digest");
  return validateCatalogShape(catalog);
}

export function validateHostCapabilityCatalog(catalog) {
  return validateCatalogShape(catalog);
}

function validateAttestationShape(attestation, catalog = null) {
  exactKeys(attestation, [
    "schema", "version", "status", "source_binding_sha256", "project_context_sha256", "catalog_sha256", "host_ref_sha256",
    "observed_at_utc", "expires_at_utc", "digest",
  ], "host capability attestation");
  assertCondition(attestation.schema === HOST_CAPABILITY_ATTESTATION_SCHEMA && attestation.version === 1 && attestation.status === "HOST_ATTESTED", "host capability attestation identity is invalid");
  for (const field of ["source_binding_sha256", "project_context_sha256", "catalog_sha256", "host_ref_sha256"]) requireSha(attestation[field], `host capability attestation ${field}`);
  requireUtc(attestation.observed_at_utc, "host capability attestation observed_at_utc");
  requireUtc(attestation.expires_at_utc, "host capability attestation expires_at_utc");
  assertCondition(Date.parse(attestation.expires_at_utc) > Date.parse(attestation.observed_at_utc), "host capability attestation expiry must follow observation");
  if (catalog !== null) {
    validateCatalogShape(catalog);
    assertCondition(attestation.catalog_sha256 === catalog.digest, "host capability attestation catalog does not match");
  }
  requireDigestMatch(attestation, "digest", "host capability attestation");
  return privacyCheck(attestation, "host capability attestation");
}

export function compileHostCapabilityAttestation({catalog, sourceBindingSha256, projectContextSha256, hostRefSha256, observedAtUtc, expiresAtUtc}) {
  validateHostCapabilityCatalog(catalog);
  const attestation = {
    schema: HOST_CAPABILITY_ATTESTATION_SCHEMA,
    version: 1,
    status: "HOST_ATTESTED",
    source_binding_sha256: requireSha(sourceBindingSha256, "sourceBindingSha256"),
    project_context_sha256: requireSha(projectContextSha256, "projectContextSha256"),
    catalog_sha256: catalog.digest,
    host_ref_sha256: requireSha(hostRefSha256, "hostRefSha256"),
    observed_at_utc: requireUtc(observedAtUtc, "observedAtUtc"),
    expires_at_utc: requireUtc(expiresAtUtc, "expiresAtUtc"),
    digest: null,
  };
  attestation.digest = digestWithout(attestation, "digest");
  return validateAttestationShape(attestation, catalog);
}

export function validateHostCapabilityAttestation(attestation, catalog = null) {
  return validateAttestationShape(attestation, catalog);
}

function validateAttestationForRoute({attestation, catalog, sourceBindingSha256, projectContextSha256, observedAtUtc}) {
  validateAttestationShape(attestation, catalog);
  requireSha(sourceBindingSha256, "sourceBindingSha256");
  requireSha(projectContextSha256, "projectContextSha256");
  requireUtc(observedAtUtc, "observedAtUtc");
  assertCondition(attestation.source_binding_sha256 === sourceBindingSha256, "host capability attestation source binding mismatch");
  assertCondition(attestation.project_context_sha256 === projectContextSha256, "host capability attestation project context mismatch");
  assertCondition(Date.parse(observedAtUtc) >= Date.parse(attestation.observed_at_utc) && Date.parse(observedAtUtc) < Date.parse(attestation.expires_at_utc), "host capability attestation is stale or not yet effective");
}

function candidateRejectionReasons(candidate, profile, policy, contextSelection) {
  const reasons = [];
  if (candidate.spawnable !== true) reasons.push("MODEL_UNAVAILABLE");
  if (candidate.estimated_success_probability < policy.minimum_success_probability) reasons.push("BELOW_COMPLETION_FLOOR");
  const requiredReasoning = maxReasoning(profile.minimum_reasoning_effort, policy.minimum_reasoning_effort);
  if (REASONING_RANK.get(candidate.reasoning_effort) < REASONING_RANK.get(requiredReasoning)) reasons.push("REASONING_TOO_WEAK");
  const requiredVerifier = maxVerifier(profile.verifier_strength, policy.required_verifier_strength);
  if (VERIFIER_RANK.get(candidate.verifier_strength) < VERIFIER_RANK.get(requiredVerifier)) reasons.push("VERIFIER_TOO_WEAK");
  const contextLimit = policy.max_context_tokens ?? candidate.context_tokens;
  if (contextSelection?.status !== "SELECTED" || contextSelection.selected_tokens > Math.min(candidate.context_tokens, contextLimit)) reasons.push("CONTEXT_UNAVAILABLE");
  if (!subset(profile.required_capabilities, candidate.capabilities)) reasons.push("CAPABILITY_UNAVAILABLE");
  if (!subset(profile.required_tools, candidate.tools)) reasons.push("TOOL_UNAVAILABLE");
  const granted = intersection(policy.allowed_permissions, profile.permission_ceiling, candidate.permissions, ROUTABLE_PERMISSION_CLASSES);
  if (!subset(profile.required_permissions, granted)) reasons.push("PERMISSION_UNAVAILABLE");
  if (profile.max_expected_cost !== null && candidate.expected_cost > profile.max_expected_cost) reasons.push("BUDGET_EXCEEDED");
  if (policy.max_expected_cost !== null && candidate.expected_cost > policy.max_expected_cost) reasons.push("BUDGET_EXCEEDED");
  if (profile.deadline_seconds !== null && candidate.estimated_wall_seconds > profile.deadline_seconds) reasons.push("DEADLINE_UNMET");
  if (candidate.cost_unit !== policy.cost_unit) reasons.push("COST_UNIT_MISMATCH");
  if (!candidate.worker_shapes.includes(profile.required_worker_shape)) reasons.push("WORKER_SHAPE_UNAVAILABLE");
  if (!candidate.workspace_capabilities.includes(profile.required_workspace_capability)) reasons.push("WORKSPACE_CAPABILITY_UNAVAILABLE");
  if (!candidate.evidence_paths.includes(profile.required_evidence_path)) reasons.push("EVIDENCE_PATH_UNAVAILABLE");
  return [...new Set(reasons)].sort(compareUtf8);
}

function preferenceComparator(preference, preferred, left, right) {
  const preferredRank = (candidate) => preferred && candidate.model === preferred.model && candidate.reasoning_effort === preferred.reasoning_effort ? 0 : 1;
  const compareNumber = (leftValue, rightValue) => leftValue - rightValue;
  const compareDescending = (leftValue, rightValue) => rightValue - leftValue;
  const preferenceUsesPreferred = preference === "BALANCED";
  const preferredDifference = preferenceUsesPreferred ? preferredRank(left) - preferredRank(right) : 0;
  if (preferredDifference !== 0) return preferredDifference;
  if (preference === "FINISH_SOONER") {
    return compareNumber(left.estimated_wall_seconds, right.estimated_wall_seconds)
      || compareNumber(left.expected_cost, right.expected_cost)
      || compareDescending(left.estimated_success_probability, right.estimated_success_probability)
      || compareCandidateIdentity(left, right);
  }
  if (preference === "TAKE_EXTRA_CARE") {
    return compareDescending(VERIFIER_RANK.get(left.verifier_strength), VERIFIER_RANK.get(right.verifier_strength))
      || compareDescending(left.estimated_success_probability, right.estimated_success_probability)
      || compareDescending(REASONING_RANK.get(left.reasoning_effort), REASONING_RANK.get(right.reasoning_effort))
      || compareNumber(left.expected_cost, right.expected_cost)
      || compareCandidateIdentity(left, right);
  }
  return compareNumber(left.expected_cost, right.expected_cost)
    || compareDescending(left.estimated_success_probability, right.estimated_success_probability)
    || compareDescending(REASONING_RANK.get(left.reasoning_effort), REASONING_RANK.get(right.reasoning_effort))
    || compareCandidateIdentity(left, right);
}

function routeCandidateSummary(candidate) {
  return {
    model: candidate.model,
    reasoning_effort: candidate.reasoning_effort,
    context_tokens: candidate.context_tokens,
    verifier_strength: candidate.verifier_strength,
    expected_cost: candidate.expected_cost,
    estimated_wall_seconds: candidate.estimated_wall_seconds,
    estimated_success_probability: candidate.estimated_success_probability,
    worker_shapes: [...candidate.worker_shapes],
    workspace_capabilities: [...candidate.workspace_capabilities],
    evidence_paths: [...candidate.evidence_paths],
  };
}

function validateRouteShape(route) {
  exactKeys(route, [
    "schema", "version", "status", "attempt", "predecessor_route_sha256", "fallback_trigger", "task_profile_sha256",
    "policy_sha256", "context_policy_sha256", "capability_catalog_sha256", "context_selection_sha256", "host_attestation_sha256", "task_ref_sha256", "goal_ref_sha256", "project_context_sha256", "source_binding_sha256", "observed_at_utc",
    "role", "lane", "selection_source", "preference", "preferred_model", "preferred_reasoning_effort", "model", "reasoning_effort",
    "worker_shape", "workspace_capability", "evidence_path", "estimated_success_probability", "context", "tools", "verifier", "permissions", "cost", "fallback_candidates", "fallback", "excluded_candidates", "digest",
  ], "execution route");
  assertCondition(route.schema === EXECUTION_ROUTE_SCHEMA && route.version === 1 && route.status === "ADMITTED", "execution route identity is invalid");
  requireNonnegativeInteger(route.attempt, "execution route attempt");
  if (route.predecessor_route_sha256 !== null) requireSha(route.predecessor_route_sha256, "execution route predecessor_route_sha256");
  if (route.fallback_trigger !== null) requireEnum(route.fallback_trigger, SAFE_FALLBACK_TRIGGERS, "execution route fallback_trigger");
  for (const field of ["task_profile_sha256", "policy_sha256", "context_policy_sha256", "capability_catalog_sha256", "context_selection_sha256", "host_attestation_sha256", "task_ref_sha256", "goal_ref_sha256", "project_context_sha256", "source_binding_sha256"]) requireSha(route[field], `execution route ${field}`);
  requireUtc(route.observed_at_utc, "execution route observed_at_utc");
  for (const field of ["role", "lane", "preferred_model", "model"]) requireIdentifier(route[field], `execution route ${field}`);
  for (const field of ["preferred_reasoning_effort", "reasoning_effort"]) requireEnum(route[field], REASONING_EFFORTS, `execution route ${field}`);
  requireEnum(route.worker_shape, WORKER_SHAPES, "execution route worker_shape");
  requireEnum(route.workspace_capability, WORKSPACE_CAPABILITIES, "execution route workspace_capability");
  requireEnum(route.evidence_path, EVIDENCE_PATHS, "execution route evidence_path");
  requireProbability(route.estimated_success_probability, "execution route estimated_success_probability");
  requireEnum(route.selection_source, ["POLICY_DEFAULT", "OWNER_ROLE_OVERRIDE", "OWNER_LANE_OVERRIDE", "FALLBACK"], "execution route selection_source");
  requireEnum(route.preference, MODEL_PREFERENCES, "execution route preference");
  exactKeys(route.context, ["selection_sha256", "required_tokens", "selected_tokens", "host_max_tokens"], "execution route context");
  requireSha(route.context.selection_sha256, "execution route context.selection_sha256");
  assertCondition(route.context.selection_sha256 === route.context_selection_sha256, "execution route context selection binding is inconsistent");
  requirePositiveInteger(route.context.required_tokens, "execution route context.required_tokens");
  requirePositiveInteger(route.context.selected_tokens, "execution route context.selected_tokens");
  requirePositiveInteger(route.context.host_max_tokens, "execution route context.host_max_tokens");
  assertCondition(route.context.required_tokens <= route.context.selected_tokens && route.context.selected_tokens <= route.context.host_max_tokens, "execution route context bounds are invalid");
  exactKeys(route.tools, ["required", "allowed"], "execution route tools");
  requireSortedUnique(route.tools.required, "execution route tools.required", {tool: true});
  requireSortedUnique(route.tools.allowed, "execution route tools.allowed", {tool: true});
  assertCondition(subset(route.tools.required, route.tools.allowed), "execution route required tools exceed allowed tools");
  exactKeys(route.verifier, ["required", "selected"], "execution route verifier");
  requireEnum(route.verifier.required, VERIFIER_STRENGTHS, "execution route verifier.required");
  requireEnum(route.verifier.selected, VERIFIER_STRENGTHS, "execution route verifier.selected");
  assertCondition(VERIFIER_RANK.get(route.verifier.selected) >= VERIFIER_RANK.get(route.verifier.required), "execution route selected verifier is weaker than required");
  exactKeys(route.permissions, ["required", "granted"], "execution route permissions");
  validatePermissionList(route.permissions.required, "execution route permissions.required");
  validatePermissionList(route.permissions.granted, "execution route permissions.granted");
  assertCondition(subset(route.permissions.required, route.permissions.granted), "execution route required permissions are not granted");
  exactKeys(route.cost, ["unit", "expected", "max_allowed", "estimated_wall_seconds"], "execution route cost");
  requireIdentifier(route.cost.unit, "execution route cost.unit");
  requireNonnegativeFinite(route.cost.expected, "execution route cost.expected");
  if (route.cost.max_allowed !== null) requireNonnegativeFinite(route.cost.max_allowed, "execution route cost.max_allowed");
  requirePositiveFinite(route.cost.estimated_wall_seconds, "execution route cost.estimated_wall_seconds");
  if (route.cost.max_allowed !== null) assertCondition(route.cost.expected <= route.cost.max_allowed, "execution route exceeds cost bound");
  assertCondition(Array.isArray(route.fallback_candidates), "execution route fallback_candidates must be an array");
  route.fallback_candidates.forEach((candidate, index) => {
    exactKeys(candidate, ["model", "reasoning_effort", "context_tokens", "verifier_strength", "expected_cost", "estimated_wall_seconds", "estimated_success_probability", "worker_shapes", "workspace_capabilities", "evidence_paths"], `execution route fallback candidate ${index}`);
    requireIdentifier(candidate.model, `execution route fallback candidate ${index}.model`);
    requireEnum(candidate.reasoning_effort, REASONING_EFFORTS, `execution route fallback candidate ${index}.reasoning_effort`);
    requirePositiveInteger(candidate.context_tokens, `execution route fallback candidate ${index}.context_tokens`);
    requireEnum(candidate.verifier_strength, VERIFIER_STRENGTHS, `execution route fallback candidate ${index}.verifier_strength`);
    requireNonnegativeFinite(candidate.expected_cost, `execution route fallback candidate ${index}.expected_cost`);
    requirePositiveFinite(candidate.estimated_wall_seconds, `execution route fallback candidate ${index}.estimated_wall_seconds`);
    requireProbability(candidate.estimated_success_probability, `execution route fallback candidate ${index}.estimated_success_probability`);
    requireSortedUnique(candidate.worker_shapes, `execution route fallback candidate ${index}.worker_shapes`);
    requireSortedUnique(candidate.workspace_capabilities, `execution route fallback candidate ${index}.workspace_capabilities`);
    requireSortedUnique(candidate.evidence_paths, `execution route fallback candidate ${index}.evidence_paths`);
    assertCondition(candidate.worker_shapes.every((shape) => WORKER_SHAPES.includes(shape)), `execution route fallback candidate ${index}.worker_shapes contains an invalid shape`);
    assertCondition(candidate.workspace_capabilities.every((capability) => WORKSPACE_CAPABILITIES.includes(capability)), `execution route fallback candidate ${index}.workspace_capabilities contains an invalid capability`);
    assertCondition(candidate.evidence_paths.every((path) => EVIDENCE_PATHS.includes(path)), `execution route fallback candidate ${index}.evidence_paths contains an invalid path`);
  });
  validateFallbackPolicy(route.fallback, "execution route fallback");
  assertCondition(Array.isArray(route.excluded_candidates), "execution route excluded_candidates must be an array");
  route.excluded_candidates.forEach((candidate, index) => {
    exactKeys(candidate, ["model", "reasoning_effort", "reasons"], `execution route excluded candidate ${index}`);
    requireIdentifier(candidate.model, `execution route excluded candidate ${index}.model`);
    requireEnum(candidate.reasoning_effort, REASONING_EFFORTS, `execution route excluded candidate ${index}.reasoning_effort`);
    sortedUnique(candidate.reasons, `execution route excluded candidate ${index}.reasons`);
  });
  requireDigestMatch(route, "digest", "execution route");
  return privacyCheck(route, "execution route");
}

function fallbackPolicyForSelection(profile, policy) {
  const enabled = profile.fallback_allowed && policy.fallback.enabled;
  return {
    enabled,
    max_attempts: enabled ? policy.fallback.max_attempts : 0,
    allowed_triggers: enabled ? profile.fallback_triggers.filter((trigger) => policy.fallback.allowed_triggers.includes(trigger)).sort(compareUtf8) : [],
    ordered_models: enabled ? [...policy.fallback.ordered_models] : [],
    preserve_requirements: true,
    deny_downgrade: true,
  };
}

function selectCandidate({profile, policy, catalog, contextSelection, preferred, forcedModel = null, excluded = []}) {
  const excludedSet = new Set(excluded.map((value) => typeof value === "string" ? value : candidateKey(value)));
  const eligible = [];
  const rejected = [];
  for (const candidate of catalog.models) {
    if (excludedSet.has(candidateKey(candidate)) || excludedSet.has(candidate.model)) continue;
    if (forcedModel && (candidate.model !== forcedModel.model || candidate.reasoning_effort !== forcedModel.reasoning_effort)) continue;
    const reasons = candidateRejectionReasons(candidate, profile, policy, contextSelection);
    if (reasons.length > 0) rejected.push({model: candidate.model, reasoning_effort: candidate.reasoning_effort, reasons});
    else eligible.push(candidate);
  }
  eligible.sort((left, right) => preferenceComparator(policy.preference, preferred, left, right));
  return {eligible, rejected};
}

function validateRoutingUnavailableShape(record) {
  exactKeys(record, [
    "schema", "version", "status", "reason_code", "task_profile_sha256", "policy_sha256", "context_policy_sha256", "capability_catalog_sha256",
    "context_selection_sha256", "host_attestation_sha256", "source_binding_sha256", "rejected_candidates", "observed_at_utc",
    "acceptance", "protected_actions_enabled", "digest",
  ], "routing unavailable record");
  assertCondition(record.schema === ROUTING_UNAVAILABLE_SCHEMA && record.version === 1 && record.status === "UNAVAILABLE", "routing unavailable record identity is invalid");
  requireIdentifier(record.reason_code, "routing unavailable record reason_code");
  for (const field of ["task_profile_sha256", "policy_sha256", "context_policy_sha256", "capability_catalog_sha256", "context_selection_sha256", "host_attestation_sha256", "source_binding_sha256"]) requireSha(record[field], `routing unavailable record ${field}`);
  assertCondition(Array.isArray(record.rejected_candidates), "routing unavailable record rejected_candidates must be an array");
  record.rejected_candidates.forEach((candidate, index) => {
    exactKeys(candidate, ["model", "reasoning_effort", "reasons"], `routing unavailable candidate ${index}`);
    requireIdentifier(candidate.model, `routing unavailable candidate ${index}.model`);
    requireEnum(candidate.reasoning_effort, REASONING_EFFORTS, `routing unavailable candidate ${index}.reasoning_effort`);
    requireSortedUnique(candidate.reasons, `routing unavailable candidate ${index}.reasons`);
  });
  requireUtc(record.observed_at_utc, "routing unavailable record observed_at_utc");
  assertCondition(record.acceptance === false && record.protected_actions_enabled === false, "routing unavailable record crossed a protected boundary");
  requireDigestMatch(record, "digest", "routing unavailable record");
  return privacyCheck(record, "routing unavailable record");
}

export function compileRoutingUnavailable({taskProfile, policy, contextPolicy, capabilityCatalog, contextSelection, hostAttestation, sourceBindingSha256, reasonCode, rejectedCandidates = [], observedAtUtc}) {
  validateTaskProfile(taskProfile);
  validateTaskModelPolicy(policy);
  validateTaskContextPolicy(contextPolicy);
  validateHostCapabilityCatalog(capabilityCatalog);
  validateTaskContextSelection(contextSelection);
  assertCondition(contextSelection.policy_sha256 === contextPolicy.digest, "routing unavailable context policy mismatch");
  validateAttestationForRoute({attestation: hostAttestation, catalog: capabilityCatalog, sourceBindingSha256, projectContextSha256: taskProfile.project_context_sha256, observedAtUtc});
  requireSha(sourceBindingSha256, "sourceBindingSha256");
  requireIdentifier(reasonCode, "reasonCode");
  const record = {
    schema: ROUTING_UNAVAILABLE_SCHEMA,
    version: 1,
    status: "UNAVAILABLE",
    reason_code: reasonCode,
    task_profile_sha256: taskProfile.digest,
    policy_sha256: policy.digest,
    context_policy_sha256: contextPolicy.digest,
    capability_catalog_sha256: capabilityCatalog.digest,
    context_selection_sha256: contextSelection.digest,
    host_attestation_sha256: hostAttestation.digest,
    source_binding_sha256: sourceBindingSha256,
    rejected_candidates: rejectedCandidates.map((candidate) => ({
      model: candidate.model,
      reasoning_effort: candidate.reasoning_effort,
      reasons: [...candidate.reasons].sort(compareUtf8),
    })).sort(compareCandidateIdentity),
    observed_at_utc: requireUtc(observedAtUtc, "observedAtUtc"),
    acceptance: false,
    protected_actions_enabled: false,
    digest: null,
  };
  record.digest = digestWithout(record, "digest");
  return validateRoutingUnavailableShape(record);
}

export function validateRoutingUnavailable(record) {
  return validateRoutingUnavailableShape(record);
}

export function selectExecutionRoute({
  taskProfile,
  policy,
  contextPolicy,
  capabilityCatalog,
  contextSelection,
  hostAttestation,
  sourceBindingSha256,
  observedAtUtc,
  forcedModel = null,
  excluded = [],
  predecessorRouteSha256 = null,
  fallbackTrigger = null,
  attempt = 0,
}) {
  validateTaskProfile(taskProfile);
  validateTaskModelPolicy(policy);
  validateTaskContextPolicy(contextPolicy);
  validateHostCapabilityCatalog(capabilityCatalog);
  validateTaskContextSelection(contextSelection);
  requireSha(sourceBindingSha256, "sourceBindingSha256");
  requireUtc(observedAtUtc, "observedAtUtc");
  validateAttestationForRoute({attestation: hostAttestation, catalog: capabilityCatalog, sourceBindingSha256, projectContextSha256: taskProfile.project_context_sha256, observedAtUtc});
  if (!(contextSelection.schema === TASK_CONTEXT_SELECTION_SCHEMA && contextSelection.status === "SELECTED")) {
    const unavailable = compileRoutingUnavailable({
      taskProfile,
      policy,
      contextPolicy,
      capabilityCatalog,
      contextSelection,
      hostAttestation,
      sourceBindingSha256,
      reasonCode: "CONTEXT_UNAVAILABLE",
      observedAtUtc,
    });
    throw new RoutingBoundaryError("ROUTING_UNAVAILABLE", "CONTEXT_UNAVAILABLE", unavailable);
  }
  assertCondition(contextSelection.task_profile_sha256 === taskProfile.digest, "task context selection task profile mismatch");
  assertCondition(contextSelection.policy_sha256 === contextPolicy.digest, "task context selection policy mismatch");
  assertCondition(contextSelection.source_binding_sha256 === sourceBindingSha256, "task context selection source binding mismatch");
  requireNonnegativeInteger(attempt, "attempt");
  if (predecessorRouteSha256 !== null) requireSha(predecessorRouteSha256, "predecessorRouteSha256");
  if (fallbackTrigger !== null) requireEnum(fallbackTrigger, SAFE_FALLBACK_TRIGGERS, "fallbackTrigger");
  if (forcedModel !== null) {
    exactKeys(forcedModel, ["model", "reasoning_effort"], "forced model");
    requireIdentifier(forcedModel.model, "forced model.model");
    requireEnum(forcedModel.reasoning_effort, REASONING_EFFORTS, "forced model.reasoning_effort");
  }
  const selection = overrideFor(taskProfile, policy);
  const preferred = forcedModel ?? selection.value;
  const selected = selectCandidate({profile: taskProfile, policy, catalog: capabilityCatalog, contextSelection, preferred, forcedModel, excluded});
  if (selected.eligible.length === 0) {
    const unavailable = compileRoutingUnavailable({
      taskProfile,
      policy,
      contextPolicy,
      capabilityCatalog,
      contextSelection,
      hostAttestation,
      sourceBindingSha256,
      reasonCode: "NO_ELIGIBLE_CAPABILITY",
      rejectedCandidates: selected.rejected,
      observedAtUtc,
    });
    const error = new RoutingBoundaryError("ROUTING_UNAVAILABLE", "NO_ELIGIBLE_CAPABILITY", unavailable);
    error.rejected = selected.rejected;
    throw error;
  }
  const candidate = selected.eligible[0];
  const contextMax = policy.max_context_tokens ?? candidate.context_tokens;
  const grantedPermissions = intersection(policy.allowed_permissions, taskProfile.permission_ceiling, candidate.permissions, ROUTABLE_PERMISSION_CLASSES);
  const requiredVerifier = maxVerifier(taskProfile.verifier_strength, policy.required_verifier_strength);
  const fallback = fallbackPolicyForSelection(taskProfile, policy);
  const excludedCandidates = selected.rejected.sort((left, right) => compareUtf8(`${left.model}\u0000${left.reasoning_effort}`, `${right.model}\u0000${right.reasoning_effort}`));
  const fallbackCandidates = selected.eligible.slice(1).map(routeCandidateSummary);
  const route = {
    schema: EXECUTION_ROUTE_SCHEMA,
    version: 1,
    status: "ADMITTED",
    attempt,
    predecessor_route_sha256: predecessorRouteSha256,
    fallback_trigger: fallbackTrigger,
    task_profile_sha256: taskProfile.digest,
    policy_sha256: policy.digest,
    context_policy_sha256: contextPolicy.digest,
    capability_catalog_sha256: capabilityCatalog.digest,
    context_selection_sha256: contextSelection.digest,
    host_attestation_sha256: hostAttestation.digest,
    task_ref_sha256: taskProfile.task_ref_sha256,
    goal_ref_sha256: taskProfile.goal_ref_sha256,
    project_context_sha256: taskProfile.project_context_sha256,
    source_binding_sha256: sourceBindingSha256,
    observed_at_utc: observedAtUtc,
    role: taskProfile.role,
    lane: taskProfile.lane,
    selection_source: fallbackTrigger !== null ? "FALLBACK" : selection.source,
    preference: policy.preference,
    preferred_model: preferred.model,
    preferred_reasoning_effort: preferred.reasoning_effort,
    model: candidate.model,
    reasoning_effort: candidate.reasoning_effort,
    worker_shape: taskProfile.required_worker_shape,
    workspace_capability: taskProfile.required_workspace_capability,
    evidence_path: taskProfile.required_evidence_path,
    estimated_success_probability: candidate.estimated_success_probability,
    context: {
      selection_sha256: contextSelection.digest,
      required_tokens: taskProfile.required_context_tokens,
      selected_tokens: contextSelection.selected_tokens,
      host_max_tokens: candidate.context_tokens,
    },
    tools: {
      required: [...taskProfile.required_tools],
      allowed: [...candidate.tools].sort(compareUtf8),
    },
    verifier: {required: requiredVerifier, selected: candidate.verifier_strength},
    permissions: {required: [...taskProfile.required_permissions], granted: grantedPermissions},
    cost: {
      unit: candidate.cost_unit,
      expected: candidate.expected_cost,
      max_allowed: taskProfile.max_expected_cost === null
        ? policy.max_expected_cost
        : policy.max_expected_cost === null ? taskProfile.max_expected_cost : Math.min(taskProfile.max_expected_cost, policy.max_expected_cost),
      estimated_wall_seconds: candidate.estimated_wall_seconds,
    },
    fallback_candidates: fallbackCandidates,
    fallback,
    excluded_candidates: excludedCandidates,
    digest: null,
  };
  route.digest = digestWithout(route, "digest");
  return validateRoute(route);
}

export function validateRoute(route) {
  return validateRouteShape(route);
}

function fallbackDowngradeReasons(previous, next) {
  const reasons = [];
  if (REASONING_RANK.get(next.reasoning_effort) < REASONING_RANK.get(previous.reasoning_effort)) reasons.push("REASONING_DOWNGRADE");
  if (VERIFIER_RANK.get(next.verifier.selected) < VERIFIER_RANK.get(previous.verifier.selected)) reasons.push("VERIFIER_DOWNGRADE");
  if (next.context.selected_tokens < previous.context.selected_tokens) reasons.push("CONTEXT_DOWNGRADE");
  if (!subset(previous.tools.allowed, next.tools.allowed)) reasons.push("TOOL_ENVELOPE_DOWNGRADE");
  if (!subset(previous.permissions.granted, next.permissions.granted)) reasons.push("PERMISSION_ENVELOPE_DOWNGRADE");
  if (next.estimated_success_probability < previous.estimated_success_probability) reasons.push("SUCCESS_PROBABILITY_DOWNGRADE");
  if (WORKER_RANK.get(next.worker_shape) < WORKER_RANK.get(previous.worker_shape)) reasons.push("WORKER_SHAPE_DOWNGRADE");
  if (next.workspace_capability !== previous.workspace_capability) reasons.push("WORKSPACE_CAPABILITY_DOWNGRADE");
  if (next.evidence_path !== previous.evidence_path) reasons.push("EVIDENCE_PATH_DOWNGRADE");
  return reasons.sort(compareUtf8);
}

function routeInputsMatch(route, {taskProfile, policy, contextPolicy, capabilityCatalog, contextSelection, hostAttestation, sourceBindingSha256}) {
  return route.task_profile_sha256 === taskProfile.digest
    && route.policy_sha256 === policy.digest
    && route.context_policy_sha256 === contextPolicy.digest
    && route.capability_catalog_sha256 === capabilityCatalog.digest
    && route.context_selection_sha256 === contextSelection.digest
    && route.host_attestation_sha256 === hostAttestation.digest
    && route.source_binding_sha256 === sourceBindingSha256;
}

export function selectFallbackRoute({route, taskProfile, policy, contextPolicy, capabilityCatalog, contextSelection, hostAttestation, observedAtUtc, trigger}) {
  validateRoute(route);
  validateTaskProfile(taskProfile);
  validateTaskModelPolicy(policy);
  validateTaskContextPolicy(contextPolicy);
  validateHostCapabilityCatalog(capabilityCatalog);
  validateTaskContextSelection(contextSelection);
  validateHostCapabilityAttestation(hostAttestation, capabilityCatalog);
  requireUtc(observedAtUtc, "observedAtUtc");
  requireEnum(trigger, [...SAFE_FALLBACK_TRIGGERS, ...HARD_BOUNDARY_TRIGGERS], "fallback trigger");
  requireSha(route.source_binding_sha256, "route.source_binding_sha256");
  if (!routeInputsMatch(route, {taskProfile, policy, contextPolicy, capabilityCatalog, contextSelection, hostAttestation, sourceBindingSha256: route.source_binding_sha256})) {
    return compileFallbackBoundary({route, trigger, reasonCode: "FALLBACK_INPUT_MISMATCH"});
  }
  if (HARD_BOUNDARY_TRIGGERS.includes(trigger)) return compileFallbackBoundary({route, trigger, reasonCode: "FALLBACK_FORBIDDEN_HARD_BOUNDARY"});
  if (!route.fallback.enabled || !route.fallback.allowed_triggers.includes(trigger)) {
    return compileFallbackBoundary({route, trigger, reasonCode: "FALLBACK_NOT_AUTHORIZED"});
  }
  if (route.attempt >= route.fallback.max_attempts) {
    return compileFallbackBoundary({route, trigger, reasonCode: "FALLBACK_ATTEMPTS_EXHAUSTED"});
  }
  const preferredModels = route.fallback.ordered_models;
  const candidates = route.fallback_candidates.filter((candidate) => candidate.model !== route.model || candidate.reasoning_effort !== route.reasoning_effort);
  candidates.sort((left, right) => {
    const leftOrder = preferredModels.indexOf(left.model);
    const rightOrder = preferredModels.indexOf(right.model);
    return (leftOrder < 0 ? Number.MAX_SAFE_INTEGER : leftOrder) - (rightOrder < 0 ? Number.MAX_SAFE_INTEGER : rightOrder)
      || compareCandidateIdentity(left, right);
  });
  if (candidates.length === 0) return compileFallbackBoundary({route, trigger, reasonCode: "NO_SAFE_FALLBACK"});
  try {
    const fallbackRoute = selectExecutionRoute({
      taskProfile,
      policy,
      contextPolicy,
      capabilityCatalog,
      contextSelection,
      hostAttestation,
      sourceBindingSha256: route.source_binding_sha256,
      observedAtUtc,
      forcedModel: {model: candidates[0].model, reasoning_effort: candidates[0].reasoning_effort},
      excluded: [route.model, candidateKey(route)],
      predecessorRouteSha256: route.digest,
      fallbackTrigger: trigger,
      attempt: route.attempt + 1,
    });
    const downgradeReasons = fallbackDowngradeReasons(route, fallbackRoute);
    if (downgradeReasons.length > 0) {
      return compileFallbackBoundary({route, trigger, reasonCode: "FALLBACK_QUALITY_DOWNGRADE", attemptedModels: [{model: candidates[0].model, reasoning_effort: candidates[0].reasoning_effort}]});
    }
    return fallbackRoute;
  } catch (error) {
    if (error.code === "ROUTING_UNAVAILABLE") return compileFallbackBoundary({route, trigger, reasonCode: "NO_SAFE_FALLBACK", attemptedModels: candidates});
    throw error;
  }
}

export function compileEffectiveModelReadback(args) {
  return compileEffectiveModelReadbackRecord({...args, validateRoute});
}

export function validateEffectiveModelReadback(record) {
  return validateEffectiveModelReadbackRecord(record);
}

export function requireVerifiedEffectiveModel(readback, expectedRoute = null) {
  return requireVerifiedEffectiveModelRecord(readback, expectedRoute);
}

export function validateFallbackBoundary(boundary) {
  return validateFallbackBoundaryRecord(boundary);
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("task-model-routing module loaded\n");
