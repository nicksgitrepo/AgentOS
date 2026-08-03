#!/usr/bin/env node

import crypto from "node:crypto";

const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Z][A-Z0-9._:-]*$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

export const POLICY_CLASSES = Object.freeze([
  "CONSTITUTIONAL",
  "OWNER_MUTABLE",
  "DERIVED",
  "CAMPAIGN_LOCAL",
  "EPHEMERAL",
]);

export const EFFECTIVE_BOUNDARIES = Object.freeze([
  "IMMEDIATE_SAFE",
  "NEXT_ASSIGNMENT",
  "NEXT_CHECKPOINT",
  "NEXT_CAMPAIGN",
  "GOVERNANCE_VERSION",
  "OWNER_AUTHENTICATED_APPROVAL",
]);

export const POLICY_CHANGE_CLASSES = Object.freeze([
  "CURRENT_CAMPAIGN_COMPATIBLE",
  "CURRENT_CAMPAIGN_RECOMPILE",
  "NEXT_CAMPAIGN",
  "PROJECT_COURSE_CHANGE",
  "MIGRATION_REQUIRED",
  "OWNER_BOUNDARY",
  "GOVERNANCE_VERSION",
]);

export const MODEL_CLASSES = Object.freeze([
  "HOST_DEFAULT",
  "ECONOMICAL",
  "BALANCED",
  "PERFORMANCE",
  "FRONTIER",
]);

export const POLICY_TIME_BASES = Object.freeze(["OBSERVED_UTC", "DETERMINISTIC_SYNTHETIC_EPOCH"]);

const MODEL_ROLES = [
  "CAMPAIGN_ORCHESTRATOR",
  "INDEPENDENT_AUDITOR",
  "FEATURE_AGENT",
  "PLATFORM_AGENT",
  "AUDIT_WORKER",
  "CAMPAIGN_FINALIZER",
  "RUNTIME",
];

const sorted = (values) => [...values].sort((left, right) =>
  Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")));
const compareUtf8 = (left, right) => Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function requireRecord(value, label) {
  assert(isRecord(value), `${label} must be an object`);
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains control characters`);
}

function requireIdentifier(value, label) {
  requireString(value, label);
  assert(IDENTIFIER.test(value), `${label} is not a stable policy identifier`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function requireUtc(value, label) {
  requireString(value, label);
  assert(ISO_UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} must be UTC`);
}

function secretFree(value, label) {
  if (value === null) return;
  requireString(value, label);
  assert(!/(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]/iu.test(value), `${label} appears to contain secret material`);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort((left, right) =>
      Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")))
      .map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function policyDigest(value) {
  return crypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function sortedUnique(values, label, {allowEmpty = false} = {}) {
  assert(Array.isArray(values), `${label} must be an array`);
  if (!allowEmpty) assert(values.length > 0, `${label} must not be empty`);
  assert(values.every((value) => typeof value === "string" && value.trim().length > 0), `${label} contains an invalid value`);
  const normalized = sorted(values);
  assert(new Set(normalized).size === normalized.length, `${label} contains duplicates`);
  assert(JSON.stringify(values) === JSON.stringify(normalized), `${label} must be sorted by UTF-8`);
  return normalized;
}

function clone(value) {
  return structuredClone(value);
}

function variable({
  variable_id,
  class: variableClass,
  type,
  allowed_values = null,
  default_value,
  authority,
  mutability,
  effective_boundary,
  dependencies = [],
  invalidation_roots = [],
  recompile_targets = [],
  rotation_required = [],
  change_class,
  description,
}) {
  return Object.freeze({
    variable_id,
    class: variableClass,
    type,
    allowed_values,
    default_value,
    authority,
    mutability,
    effective_boundary,
    dependencies: Object.freeze(sorted(dependencies)),
    invalidation_roots: Object.freeze(sorted(invalidation_roots)),
    recompile_targets: Object.freeze(sorted(recompile_targets)),
    rotation_required: Object.freeze(sorted(rotation_required)),
    change_class,
    description,
  });
}

const DEFINITIONS = [
  variable({
    variable_id: "ACCEPTANCE.ROOTS", class: "CONSTITUTIONAL", type: "ORDERED_ENUM_ARRAY",
    allowed_values: ["FUNCTION_REQUIREMENTS", "DESIGN_BIBLE", "SECURITY"],
    default_value: ["FUNCTION_REQUIREMENTS", "DESIGN_BIBLE", "SECURITY"],
    authority: "GOVERNANCE", mutability: "GOVERNANCE_VERSION", effective_boundary: "GOVERNANCE_VERSION",
    invalidation_roots: ["FUNCTION_REQUIREMENTS", "DESIGN_BIBLE", "SECURITY"],
    recompile_targets: ["QUESTION_TREE", "CAMPAIGN_ACCEPTANCE"], change_class: "GOVERNANCE_VERSION",
    description: "The ordered Product acceptance roots; no project may remove one.",
  }),
  variable({
    variable_id: "ACCEPTANCE.INDEPENDENT_AUDIT", class: "CONSTITUTIONAL", type: "BOOLEAN",
    default_value: true, authority: "GOVERNANCE", mutability: "GOVERNANCE_VERSION", effective_boundary: "GOVERNANCE_VERSION",
    invalidation_roots: ["FUNCTION_REQUIREMENTS", "DESIGN_BIBLE", "SECURITY"], recompile_targets: ["AUDIT_PLAN", "CAMPAIGN_ACCEPTANCE"], change_class: "GOVERNANCE_VERSION",
    description: "Product acceptance remains independent from implementation custody.",
  }),
  variable({
    variable_id: "ACCEPTANCE.NO_SELF_ACCEPTANCE", class: "CONSTITUTIONAL", type: "BOOLEAN",
    default_value: true, authority: "GOVERNANCE", mutability: "GOVERNANCE_VERSION", effective_boundary: "GOVERNANCE_VERSION",
    recompile_targets: ["CUSTODY", "CAMPAIGN_ACCEPTANCE"], change_class: "GOVERNANCE_VERSION",
    description: "Builders, Finalizers, and Runtime cannot accept their own work.",
  }),
  variable({
    variable_id: "RECOVERY.INTERNAL_CHECKPOINTS", class: "CONSTITUTIONAL", type: "ENUM",
    allowed_values: ["REQUIRED"], default_value: "REQUIRED", authority: "GOVERNANCE", mutability: "GOVERNANCE_VERSION", effective_boundary: "GOVERNANCE_VERSION",
    recompile_targets: ["CAMPAIGN_STATE", "HANDOFFS"], change_class: "GOVERNANCE_VERSION",
    description: "Internal recovery checkpoints remain present even when the user chooses a simple delivery route.",
  }),
  variable({
    variable_id: "SAFETY.SECRET_RETENTION", class: "CONSTITUTIONAL", type: "ENUM",
    allowed_values: ["FORBIDDEN"], default_value: "FORBIDDEN", authority: "GOVERNANCE", mutability: "GOVERNANCE_VERSION", effective_boundary: "GOVERNANCE_VERSION",
    recompile_targets: ["EVIDENCE", "HANDOFFS"], change_class: "GOVERNANCE_VERSION",
    description: "Secrets are never retained in authority, prompts, logs, or receipts.",
  }),
  variable({
    variable_id: "CAMPAIGN.MODE", class: "OWNER_MUTABLE", type: "ENUM",
    allowed_values: ["SMALL_DETERMINISTIC", "STANDARD_SUBSTANTIAL", "FOUNDATIONAL_HIGH_CONSEQUENCE"], default_value: "STANDARD_SUBSTANTIAL",
    authority: "OWNER_INTENT", mutability: "OWNER", effective_boundary: "NEXT_CAMPAIGN",
    invalidation_roots: ["FUNCTION_REQUIREMENTS", "DESIGN_BIBLE", "SECURITY"], recompile_targets: ["CAMPAIGN_CASCADE", "AUDIT_PLAN", "MODEL_PLAN"], rotation_required: ["CAMPAIGN_ORCHESTRATOR", "INDEPENDENT_AUDITOR"], change_class: "NEXT_CAMPAIGN",
    description: "The amount of assurance and work retained for the campaign.",
  }),
  variable({
    variable_id: "PROJECT.NORTH_STAR", class: "OWNER_MUTABLE", type: "TEXT", default_value: null,
    authority: "OWNER_INTENT", mutability: "OWNER", effective_boundary: "NEXT_CAMPAIGN",
    invalidation_roots: ["FUNCTION_REQUIREMENTS", "DESIGN_BIBLE", "SECURITY"], recompile_targets: ["PROJECT_CONTEXT", "QUESTION_TREE", "CAMPAIGN_ACCEPTANCE"], change_class: "PROJECT_COURSE_CHANGE",
    description: "The owner-confirmed durable outcome that orients Product decisions.",
  }),
  variable({
    variable_id: "PROJECT.FIRST_USEFUL_WORKFLOW", class: "OWNER_MUTABLE", type: "TEXT", default_value: null,
    authority: "OWNER_INTENT", mutability: "OWNER", effective_boundary: "NEXT_CAMPAIGN",
    invalidation_roots: ["FUNCTION_REQUIREMENTS", "DESIGN_BIBLE", "SECURITY"], recompile_targets: ["CAMPAIGN_ACCEPTANCE", "EVIDENCE_PLAN"], change_class: "NEXT_CAMPAIGN",
    description: "The smallest complete user workflow that must work before the campaign stops.",
  }),
  variable({
    variable_id: "PROJECT.ASSURANCE_CLASS", class: "OWNER_MUTABLE", type: "ENUM",
    allowed_values: ["PROTOTYPE", "LIMITED_PRODUCT", "STANDARD_PRODUCTION", "HIGH_CONSEQUENCE_PRODUCTION"], default_value: "LIMITED_PRODUCT",
    authority: "OWNER_BOUNDARY", mutability: "OWNER", effective_boundary: "NEXT_CAMPAIGN",
    invalidation_roots: ["FUNCTION_REQUIREMENTS", "DESIGN_BIBLE", "SECURITY"], recompile_targets: ["SECURITY_BASELINE", "AUDIT_PLAN", "DELIVERY_POLICY"], rotation_required: ["INDEPENDENT_AUDITOR", "RUNTIME"], change_class: "PROJECT_COURSE_CHANGE",
    description: "The consequence envelope that determines proof and release strictness.",
  }),
  variable({
    variable_id: "MODEL.PROFILE", class: "OWNER_MUTABLE", type: "ENUM", allowed_values: MODEL_CLASSES, default_value: "BALANCED",
    authority: "OWNER_BOUNDARY", mutability: "OWNER", effective_boundary: "NEXT_ASSIGNMENT",
    dependencies: ["CAMPAIGN.MODE"], recompile_targets: ["MODEL_PLAN"], rotation_required: MODEL_ROLES, change_class: "CURRENT_CAMPAIGN_RECOMPILE",
    description: "The model-class preference used when a role-specific assignment is not explicitly supplied.",
  }),
  ...MODEL_ROLES.map((role) => variable({
    variable_id: `MODEL.ROLE.${role}`, class: "OWNER_MUTABLE", type: "ENUM", allowed_values: MODEL_CLASSES, default_value: role === "RUNTIME" ? "HOST_DEFAULT" : "BALANCED",
    authority: "OWNER_BOUNDARY", mutability: "OWNER", effective_boundary: "NEXT_ASSIGNMENT",
    dependencies: ["MODEL.PROFILE"], recompile_targets: ["MODEL_PLAN", "ROSTER"], rotation_required: [role], change_class: "CURRENT_CAMPAIGN_RECOMPILE",
    description: `The model class floor and preference for the ${role} role.`,
  })),
  variable({
    variable_id: "REVIEW.USER_REVIEW_MODE", class: "OWNER_MUTABLE", type: "ENUM",
    allowed_values: ["OFF", "OPTIONAL", "RECOMMENDED", "REQUIRED_FOR_ROUTE_CHANGE", "REQUIRED_FOR_SUBSTANTIAL_CAMPAIGNS"], default_value: "RECOMMENDED",
    authority: "OWNER_BOUNDARY", mutability: "OWNER", effective_boundary: "NEXT_CAMPAIGN",
    recompile_targets: ["OWNER_REVIEW", "CAMPAIGN_ADMISSION"], change_class: "NEXT_CAMPAIGN",
    description: "When the advisory User Review Campaign is recommended or required.",
  }),
  variable({
    variable_id: "REVIEW.TRANSPORT", class: "OWNER_MUTABLE", type: "ENUM",
    allowed_values: ["PRIVATE_MARKDOWN", "PRIVATE_GIT", "CONNECTED_PRIVATE_CHAT", "SHARED_LINK_ADVISORY"], default_value: "PRIVATE_MARKDOWN",
    authority: "OWNER_BOUNDARY", mutability: "OWNER", effective_boundary: "NEXT_CAMPAIGN",
    recompile_targets: ["OWNER_REVIEW", "HANDOFFS"], change_class: "NEXT_CAMPAIGN",
    description: "The transport used for an owner review packet and its structured return.",
  }),
  variable({
    variable_id: "REVIEW.MEMORY_POSTURE", class: "OWNER_MUTABLE", type: "ENUM",
    allowed_values: ["PROJECT_ONLY", "DEFAULT", "NONE"], default_value: "PROJECT_ONLY",
    authority: "OWNER_BOUNDARY", mutability: "OWNER", effective_boundary: "NEXT_CAMPAIGN",
    recompile_targets: ["OWNER_REVIEW"], change_class: "NEXT_CAMPAIGN",
    description: "The allowed continuity context for ordinary Chat; memory never outranks the current handoff.",
  }),
  variable({
    variable_id: "REVIEW.VOICE_RECOMMENDED", class: "OWNER_MUTABLE", type: "BOOLEAN", default_value: true,
    authority: "OWNER_BOUNDARY", mutability: "OWNER", effective_boundary: "NEXT_CAMPAIGN", recompile_targets: ["OWNER_REVIEW"], change_class: "NEXT_CAMPAIGN",
    description: "Whether Bootstrap recommends voice for owner review conversations.",
  }),
  variable({
    variable_id: "REVIEW.MODEL_SELECTION", class: "OWNER_MUTABLE", type: "ENUM", allowed_values: ["AUTO_RECOMMEND", "USER_SELECTED"], default_value: "AUTO_RECOMMEND",
    authority: "OWNER_BOUNDARY", mutability: "OWNER", effective_boundary: "NEXT_CAMPAIGN", dependencies: ["MODEL.PROFILE"], recompile_targets: ["OWNER_REVIEW", "MODEL_PLAN"], change_class: "NEXT_CAMPAIGN",
    description: "Whether the owner receives a context-aware model recommendation or supplies a preference.",
  }),
  variable({
    variable_id: "REVIEW.APPROVAL_ROUTE", class: "OWNER_MUTABLE", type: "ENUM", allowed_values: ["DIRECT_AGENTOS_CONFIRMATION", "AUTHENTICATED_CONNECTOR", "AUTHORIZED_SIGNED_GIT"], default_value: "DIRECT_AGENTOS_CONFIRMATION",
    authority: "OWNER_BOUNDARY", mutability: "OWNER", effective_boundary: "OWNER_AUTHENTICATED_APPROVAL", recompile_targets: ["OWNER_REVIEW", "CAMPAIGN_ADMISSION"], change_class: "OWNER_BOUNDARY",
    description: "The route that can turn an exact owner review digest into an admitted campaign candidate.",
  }),
  variable({
    variable_id: "OPERATIONS.HEARTBEAT_INTERVAL_MINUTES", class: "OWNER_MUTABLE", type: "INTEGER", default_value: 15,
    authority: "OWNER_BOUNDARY", mutability: "OWNER", effective_boundary: "NEXT_CHECKPOINT", recompile_targets: ["RECONCILIATION"], change_class: "CURRENT_CAMPAIGN_COMPATIBLE",
    description: "The maximum interval between compact Orchestrator health reconciliations.",
  }),
];

export const POLICY_VARIABLES = Object.freeze(Object.fromEntries(
  DEFINITIONS.sort((left, right) => compareUtf8(left.variable_id, right.variable_id)).map((definition) => [definition.variable_id, definition]),
));

const BOUNDARY_RANK = new Map(EFFECTIVE_BOUNDARIES.map((value, index) => [value, index]));

function definition(variableId) {
  const result = POLICY_VARIABLES[variableId];
  assert(result, `unknown policy variable: ${variableId}`);
  return result;
}

function validateValue(definitionValue, value, label) {
  if (value === null) {
    assert(definitionValue.default_value === null, `${label} cannot be null`);
    return;
  }
  switch (definitionValue.type) {
    case "BOOLEAN": assert(typeof value === "boolean", `${label} must be boolean`); break;
    case "INTEGER": assert(Number.isSafeInteger(value) && value >= 1 && value <= 1440, `${label} must be an integer from 1 to 1440`); break;
    case "ENUM": assert(typeof value === "string" && definitionValue.allowed_values.includes(value), `${label} is not an allowed value`); break;
    case "ENUM_ARRAY": {
      const values = sortedUnique(value, label);
      assert(values.every((item) => definitionValue.allowed_values.includes(item)), `${label} contains an unallowed value`);
      break;
    }
    case "ORDERED_ENUM_ARRAY": {
      assert(Array.isArray(value) && value.length > 0, `${label} must be a nonempty array`);
      assert(new Set(value).size === value.length && value.every((item) => definitionValue.allowed_values.includes(item)), `${label} contains an invalid or duplicate value`);
      break;
    }
    case "TEXT": secretFree(value, label); break;
    default: throw new Error(`unsupported policy variable type: ${definitionValue.type}`);
  }
}

function variableRecord(definitionValue, currentValue, changedAtEpoch = 1) {
  validateValue(definitionValue, currentValue, `${definitionValue.variable_id} value`);
  const record = {
    variable_id: definitionValue.variable_id,
    class: definitionValue.class,
    type: definitionValue.type,
    allowed_values: definitionValue.allowed_values,
    current_value: clone(currentValue),
    default_value: clone(definitionValue.default_value),
    authority: definitionValue.authority,
    mutability: definitionValue.mutability,
    effective_boundary: definitionValue.effective_boundary,
    dependencies: definitionValue.dependencies,
    invalidation_roots: definitionValue.invalidation_roots,
    recompile_targets: definitionValue.recompile_targets,
    rotation_required: definitionValue.rotation_required,
    sensitivity: "PUBLIC_POLICY_METADATA",
    changed_at_epoch: changedAtEpoch,
    value_sha256: policyDigest(currentValue),
  };
  return record;
}

function validateVariableRecord(record) {
  const expectedKeys = [
    "variable_id", "class", "type", "allowed_values", "current_value", "default_value", "authority", "mutability",
    "effective_boundary", "dependencies", "invalidation_roots", "recompile_targets", "rotation_required", "sensitivity",
    "changed_at_epoch", "value_sha256",
  ];
  assert(isRecord(record), "policy variable record must be an object");
  assert(JSON.stringify(Object.keys(record).sort()) === JSON.stringify(expectedKeys.sort()), "policy variable fields mismatch");
  const definitionValue = definition(record.variable_id);
  for (const key of ["class", "type", "authority", "mutability", "sensitivity"]) requireString(record[key], `policy variable ${key}`);
  assert(record.class === definitionValue.class && record.type === definitionValue.type, `policy variable ${record.variable_id} declaration mismatch`);
  assert(JSON.stringify(record.allowed_values) === JSON.stringify(definitionValue.allowed_values), `policy variable ${record.variable_id} allowed values mismatch`);
  assert(JSON.stringify(record.default_value) === JSON.stringify(definitionValue.default_value), `policy variable ${record.variable_id} default mismatch`);
  assert(record.authority === definitionValue.authority && record.mutability === definitionValue.mutability, `policy variable ${record.variable_id} authority mismatch`);
  assert(record.effective_boundary === definitionValue.effective_boundary, `policy variable ${record.variable_id} boundary mismatch`);
  for (const field of ["dependencies", "invalidation_roots", "recompile_targets", "rotation_required"]) {
    assert(JSON.stringify(record[field]) === JSON.stringify(definitionValue[field]), `policy variable ${record.variable_id} ${field} mismatch`);
  }
  assert(Number.isSafeInteger(record.changed_at_epoch) && record.changed_at_epoch >= 1, `policy variable ${record.variable_id} epoch invalid`);
  validateValue(definitionValue, record.current_value, `policy variable ${record.variable_id}`);
  requireSha(record.value_sha256, `policy variable ${record.variable_id} value digest`);
  assert(record.value_sha256 === policyDigest(record.current_value), `policy variable ${record.variable_id} value digest mismatch`);
}

function stateBody(state) {
  const body = clone(state);
  body.policy_state_sha256 = null;
  return body;
}

export function policyStateDigest(state) {
  return policyDigest(stateBody(state));
}

export function compileGlobalPolicyState({projectId, values = {}, nowUtc, timeBasis = "OBSERVED_UTC"}) {
  requireString(projectId, "policy project ID");
  requireUtc(nowUtc, "policy state time");
  assert(POLICY_TIME_BASES.includes(timeBasis), "policy state time basis is invalid");
  requireRecord(values, "policy values");
  const unknown = Object.keys(values).filter((key) => !POLICY_VARIABLES[key]);
  assert(unknown.length === 0, `unknown policy values: ${unknown.join(", ")}`);
  const variables = Object.keys(POLICY_VARIABLES).sort(compareUtf8).map((variableId) => {
    const definitionValue = definition(variableId);
    const currentValue = Object.hasOwn(values, variableId) ? values[variableId] : definitionValue.default_value;
    return variableRecord(definitionValue, currentValue);
  });
  const dependencyGraph = variables.flatMap((item) => item.dependencies.map((dependsOn) => ({variable_id: item.variable_id, depends_on: dependsOn})))
    .sort((left, right) => compareUtf8(`${left.variable_id}\u0000${left.depends_on}`, `${right.variable_id}\u0000${right.depends_on}`));
  const state = {
    schema: "agentos.global_policy_state.v1",
    governance_version: "2.1rc",
    status: "PREPARED_NOT_ACTIVATED",
    time_basis: timeBasis,
    project_id: projectId,
    policy_epoch: 1,
    parent_policy_state_sha256: null,
    amendment_head_sha256: null,
    variables,
    dependency_graph: dependencyGraph,
    amendment_ledger: [],
    created_at_utc: nowUtc,
    updated_at_utc: nowUtc,
    policy_state_sha256: null,
  };
  state.policy_state_sha256 = policyStateDigest(state);
  validatePolicyState(state);
  return state;
}

export function validatePolicyState(state) {
  const expectedKeys = [
    "schema", "governance_version", "status", "time_basis", "project_id", "policy_epoch", "parent_policy_state_sha256", "amendment_head_sha256",
    "variables", "dependency_graph", "amendment_ledger", "created_at_utc", "updated_at_utc", "policy_state_sha256",
  ];
  requireRecord(state, "global policy state");
  assert(JSON.stringify(Object.keys(state).sort()) === JSON.stringify(expectedKeys.sort()), "global policy state fields mismatch");
  assert(state.schema === "agentos.global_policy_state.v1" && state.governance_version === "2.1rc", "global policy state identity mismatch");
  assert(state.status === "PREPARED_NOT_ACTIVATED", "global policy state cannot activate AgentOS");
  assert(POLICY_TIME_BASES.includes(state.time_basis), "policy state time basis is invalid");
  requireString(state.project_id, "policy project ID");
  assert(Number.isSafeInteger(state.policy_epoch) && state.policy_epoch >= 1, "policy epoch invalid");
  if (state.parent_policy_state_sha256 !== null) requireSha(state.parent_policy_state_sha256, "parent policy state");
  if (state.amendment_head_sha256 !== null) requireSha(state.amendment_head_sha256, "amendment head");
  requireUtc(state.created_at_utc, "policy creation time");
  requireUtc(state.updated_at_utc, "policy update time");
  assert(Array.isArray(state.variables) && state.variables.length === Object.keys(POLICY_VARIABLES).length, "policy variable registry is incomplete");
  const ids = state.variables.map((item) => item.variable_id);
  assert(JSON.stringify(ids) === JSON.stringify(sorted(ids)), "policy variables must be UTF-8 sorted");
  assert(new Set(ids).size === ids.length, "policy variables are duplicated");
  state.variables.forEach(validateVariableRecord);
  assert(Array.isArray(state.dependency_graph), "policy dependency graph is required");
  const expectedGraph = state.variables.flatMap((item) => item.dependencies.map((dependsOn) => ({variable_id: item.variable_id, depends_on: dependsOn})))
    .sort((left, right) => compareUtf8(`${left.variable_id}\u0000${left.depends_on}`, `${right.variable_id}\u0000${right.depends_on}`));
  assert(JSON.stringify(state.dependency_graph) === JSON.stringify(expectedGraph), "policy dependency graph is not declared deterministically");
  for (const edge of state.dependency_graph) {
    assert(isRecord(edge) && typeof edge.variable_id === "string" && typeof edge.depends_on === "string", "policy dependency edge is invalid");
    definition(edge.variable_id); definition(edge.depends_on);
  }
  assert(Array.isArray(state.amendment_ledger), "policy amendment ledger is required");
  state.amendment_ledger.forEach((entry, index) => {
    const ledgerKeys = [
      "amendment_id", "project_id", "parent_policy_state_sha256", "amendment_sha256", "approval_sha256", "effective_boundary",
      "requested_by", "authority", "reason", "requested_at_utc", "changes", "approved_at_utc", "actor_digest_sha256", "policy_epoch", "record_sha256",
    ];
    assert(isRecord(entry) && JSON.stringify(Object.keys(entry).sort()) === JSON.stringify(ledgerKeys.sort()), "policy ledger entry fields mismatch");
    requireString(entry.amendment_id, "policy ledger amendment ID");
    assert(entry.project_id === state.project_id, "policy ledger project differs from state");
    requireSha(entry.parent_policy_state_sha256, "policy ledger parent state");
    requireSha(entry.amendment_sha256, "policy ledger amendment");
    requireSha(entry.approval_sha256, "policy ledger approval");
    assert(["OWNER", "ORCHESTRATOR"].includes(entry.requested_by), "policy ledger requester is invalid");
    assert(["OWNER_INTENT", "OWNER_BOUNDARY", "GOVERNANCE"].includes(entry.authority), "policy ledger authority is invalid");
    secretFree(entry.reason, "policy ledger reason");
    requireUtc(entry.requested_at_utc, "policy ledger request time");
    assert(Array.isArray(entry.changes) && entry.changes.length > 0, "policy ledger changes are missing");
    entry.changes.forEach((change) => {
      assert(isRecord(change) && JSON.stringify(Object.keys(change).sort()) === JSON.stringify(["new_value", "variable_id"].sort()), "policy ledger change fields mismatch");
      const definitionValue = definition(change.variable_id);
      validateValue(definitionValue, change.new_value, `policy ledger ${change.variable_id}`);
    });
    requireUtc(entry.approved_at_utc, "policy ledger approval time");
    requireSha(entry.actor_digest_sha256, "policy ledger actor");
    assert(Number.isSafeInteger(entry.policy_epoch) && entry.policy_epoch === index + 2, "policy ledger epoch is not append-only");
    assert(EFFECTIVE_BOUNDARIES.includes(entry.effective_boundary), "policy ledger boundary invalid");
    requireSha(entry.record_sha256, "policy ledger record digest");
    assert(entry.record_sha256 === policyDigest({...entry, record_sha256: null}), "policy ledger record is not content-addressed");
  });
  if (state.policy_epoch === 1) {
    assert(state.parent_policy_state_sha256 === null && state.amendment_head_sha256 === null && state.amendment_ledger.length === 0, "initial policy state has amendment history");
  } else {
    assert(state.parent_policy_state_sha256 !== null && state.amendment_head_sha256 !== null && state.amendment_ledger.length === state.policy_epoch - 1, "policy epoch and amendment history disagree");
    assert(state.amendment_ledger.at(-1).amendment_sha256 === state.amendment_head_sha256, "amendment head is not the newest amendment");
  }
  requireSha(state.policy_state_sha256, "policy state digest");
  assert(state.policy_state_sha256 === policyStateDigest(state), "policy state digest mismatch");
  return state;
}

function dependentsOf(changed) {
  const result = new Set(changed);
  let changedSomething = true;
  while (changedSomething) {
    changedSomething = false;
    for (const definitionValue of Object.values(POLICY_VARIABLES)) {
      if (!result.has(definitionValue.variable_id) && definitionValue.dependencies.some((dependency) => result.has(dependency))) {
        result.add(definitionValue.variable_id);
        changedSomething = true;
      }
    }
  }
  return sorted([...result]);
}

function findVariable(state, variableId) {
  const result = state.variables.find((item) => item.variable_id === variableId);
  assert(result, `policy state lacks ${variableId}`);
  return result;
}

function questionIdsForRoots(questionIdsByRoot, roots) {
  const values = roots.flatMap((root) => questionIdsByRoot?.[root] ?? []);
  return sortedUnique(values, "invalidated question IDs", {allowEmpty: true});
}

function validateRequest(request) {
  const keys = ["requested_by", "authority", "reason", "requested_at_utc", "effective_boundary", "approval_state"];
  requireRecord(request, "policy amendment request");
  assert(JSON.stringify(Object.keys(request).sort()) === JSON.stringify(keys.sort()), "policy amendment request fields mismatch");
  assert(["OWNER", "ORCHESTRATOR"].includes(request.requested_by), "policy amendment requester is invalid");
  assert(["OWNER_INTENT", "OWNER_BOUNDARY", "GOVERNANCE"].includes(request.authority), "policy amendment authority is invalid");
  secretFree(request.reason, "policy amendment reason");
  requireUtc(request.requested_at_utc, "policy amendment request time");
  assert(EFFECTIVE_BOUNDARIES.includes(request.effective_boundary), "policy amendment boundary is invalid");
  assert(["PENDING_EXACT_APPROVAL", "OWNER_STATED_EXACT_APPROVAL", "OWNER_AUTHENTICATED_EXACT_APPROVAL"].includes(request.approval_state), "policy amendment approval state is invalid");
}

function amendmentBody(amendment) {
  const body = clone(amendment);
  body.amendment_sha256 = null;
  return body;
}

export function validatePolicyAmendment(amendment) {
  const keys = [
    "schema", "amendment_id", "project_id", "requested_by", "authority", "reason", "requested_at_utc", "parent_policy_state_sha256",
    "changes", "classification", "effective_boundary", "affected_variable_ids", "invalidation_roots", "invalidated_question_ids", "rotations_required",
    "recompile_targets", "rollback_state_sha256", "approval_state", "amendment_sha256",
  ];
  requireRecord(amendment, "policy amendment");
  assert(JSON.stringify(Object.keys(amendment).sort()) === JSON.stringify(keys.sort()), "policy amendment fields mismatch");
  assert(amendment.schema === "agentos.policy_amendment.v1", "policy amendment schema mismatch");
  requireIdentifier(amendment.amendment_id, "policy amendment ID");
  requireString(amendment.project_id, "policy amendment project ID");
  validateRequest({
    requested_by: amendment.requested_by, authority: amendment.authority, reason: amendment.reason,
    requested_at_utc: amendment.requested_at_utc, effective_boundary: amendment.effective_boundary, approval_state: amendment.approval_state,
  });
  requireSha(amendment.parent_policy_state_sha256, "policy amendment parent state");
  assert(Array.isArray(amendment.changes) && amendment.changes.length > 0, "policy amendment has no changes");
  const changeIds = amendment.changes.map((change) => change.variable_id);
  assert(JSON.stringify(changeIds) === JSON.stringify(sorted(changeIds)), "policy amendment changes must be sorted");
  assert(new Set(changeIds).size === changeIds.length, "policy amendment changes are duplicated");
  for (const change of amendment.changes) {
    assert(isRecord(change) && JSON.stringify(Object.keys(change).sort()) === JSON.stringify(["new_value", "variable_id"].sort()), "policy amendment change fields mismatch");
    const definitionValue = definition(change.variable_id);
    assert(definitionValue.class === "OWNER_MUTABLE", `${change.variable_id} is not owner-mutable`);
    validateValue(definitionValue, change.new_value, `${change.variable_id} amendment value`);
  }
  assert(POLICY_CHANGE_CLASSES.includes(amendment.classification), "policy amendment classification is invalid");
  assert(EFFECTIVE_BOUNDARIES.includes(amendment.effective_boundary), "policy amendment boundary is invalid");
  sortedUnique(amendment.affected_variable_ids, "affected policy variables");
  sortedUnique(amendment.invalidation_roots, "policy invalidation roots", {allowEmpty: true});
  sortedUnique(amendment.invalidated_question_ids, "invalidated question IDs", {allowEmpty: true});
  sortedUnique(amendment.rotations_required, "policy rotations", {allowEmpty: true});
  sortedUnique(amendment.recompile_targets, "policy recompile targets", {allowEmpty: true});
  const changedIds = amendment.changes.map((change) => change.variable_id);
  const affected = dependentsOf(changedIds);
  const affectedDefinitions = affected.map((variableId) => definition(variableId));
  const expectedRoots = sorted([...new Set(affectedDefinitions.flatMap((item) => item.invalidation_roots))]);
  const expectedRotations = sorted([...new Set(affectedDefinitions.flatMap((item) => item.rotation_required))], {allowEmpty: true});
  const expectedRecompileTargets = sorted([...new Set(affectedDefinitions.flatMap((item) => item.recompile_targets))], {allowEmpty: true});
  const expectedClassification = affectedDefinitions.some((item) => item.change_class === "PROJECT_COURSE_CHANGE")
    ? "PROJECT_COURSE_CHANGE"
    : affectedDefinitions.some((item) => item.change_class === "NEXT_CAMPAIGN")
      ? "NEXT_CAMPAIGN"
      : affectedDefinitions.some((item) => item.change_class === "CURRENT_CAMPAIGN_RECOMPILE")
        ? "CURRENT_CAMPAIGN_RECOMPILE"
        : "CURRENT_CAMPAIGN_COMPATIBLE";
  assert(JSON.stringify(amendment.affected_variable_ids) === JSON.stringify(affected), "policy amendment affected variables are not derived");
  assert(JSON.stringify(amendment.invalidation_roots) === JSON.stringify(expectedRoots), "policy amendment invalidation roots are not derived");
  assert(JSON.stringify(amendment.rotations_required) === JSON.stringify(expectedRotations), "policy amendment rotations are not derived");
  assert(JSON.stringify(amendment.recompile_targets) === JSON.stringify(expectedRecompileTargets), "policy amendment recompilation targets are not derived");
  assert(amendment.classification === expectedClassification, "policy amendment classification is not derived");
  const minimumBoundary = Math.max(...amendment.changes.map((change) => BOUNDARY_RANK.get(definition(change.variable_id).effective_boundary)));
  assert(BOUNDARY_RANK.get(amendment.effective_boundary) >= minimumBoundary, "policy amendment boundary is earlier than a changed variable permits");
  requireSha(amendment.rollback_state_sha256, "policy amendment rollback state");
  if (amendment.approval_state === "PENDING_EXACT_APPROVAL") assert(amendment.amendment_sha256 === policyDigest(amendmentBody(amendment)), "policy amendment digest mismatch");
  else assert(amendment.amendment_sha256 === policyDigest(amendmentBody(amendment)), "policy amendment digest mismatch");
  return amendment;
}

export function compilePolicyAmendment({state, amendmentId, changes, request, questionIdsByRoot = {}}) {
  validatePolicyState(state);
  requireIdentifier(amendmentId, "policy amendment ID");
  validateRequest(request);
  assert(Array.isArray(changes) && changes.length > 0, "policy amendment changes are required");
  const normalizedChanges = changes.map((change) => {
    assert(isRecord(change) && typeof change.variable_id === "string", "policy amendment change is invalid");
    const definitionValue = definition(change.variable_id);
    assert(definitionValue.class === "OWNER_MUTABLE", `${change.variable_id} is not owner-mutable`);
    assert(request.authority === definitionValue.authority || request.authority === "OWNER_INTENT", `${change.variable_id} requires ${definitionValue.authority}`);
    validateValue(definitionValue, change.new_value, `${change.variable_id} amendment value`);
    const current = findVariable(state, change.variable_id).current_value;
    assert(JSON.stringify(current) !== JSON.stringify(change.new_value), `${change.variable_id} is unchanged`);
    const minimumBoundary = BOUNDARY_RANK.get(definitionValue.effective_boundary);
    assert(BOUNDARY_RANK.get(request.effective_boundary) >= minimumBoundary, `${change.variable_id} cannot take effect before ${definitionValue.effective_boundary}`);
    return {variable_id: change.variable_id, new_value: clone(change.new_value)};
  }).sort((left, right) => compareUtf8(left.variable_id, right.variable_id));
  const changedIds = normalizedChanges.map((change) => change.variable_id);
  const affected = dependentsOf(changedIds);
  const affectedDefinitions = affected.map((variableId) => definition(variableId));
  const roots = sorted([...new Set(affectedDefinitions.flatMap((item) => item.invalidation_roots))]);
  const classification = affectedDefinitions.some((item) => item.change_class === "PROJECT_COURSE_CHANGE")
    ? "PROJECT_COURSE_CHANGE"
    : affectedDefinitions.some((item) => item.change_class === "NEXT_CAMPAIGN")
      ? "NEXT_CAMPAIGN"
      : affectedDefinitions.some((item) => item.change_class === "CURRENT_CAMPAIGN_RECOMPILE")
        ? "CURRENT_CAMPAIGN_RECOMPILE"
        : "CURRENT_CAMPAIGN_COMPATIBLE";
  const amendment = {
    schema: "agentos.policy_amendment.v1",
    amendment_id: amendmentId,
    project_id: state.project_id,
    requested_by: request.requested_by,
    authority: request.authority,
    reason: request.reason,
    requested_at_utc: request.requested_at_utc,
    parent_policy_state_sha256: state.policy_state_sha256,
    changes: normalizedChanges,
    classification,
    effective_boundary: request.effective_boundary,
    affected_variable_ids: affected,
    invalidation_roots: roots,
    invalidated_question_ids: questionIdsForRoots(questionIdsByRoot, roots),
    rotations_required: sorted([...new Set(affectedDefinitions.flatMap((item) => item.rotation_required))]),
    recompile_targets: sorted([...new Set(affectedDefinitions.flatMap((item) => item.recompile_targets))]),
    rollback_state_sha256: state.policy_state_sha256,
    approval_state: request.approval_state,
    amendment_sha256: null,
  };
  amendment.amendment_sha256 = policyDigest(amendmentBody(amendment));
  validatePolicyAmendment(amendment);
  return amendment;
}

export function compilePolicyApproval({amendment, approvalState = "OWNER_AUTHENTICATED_EXACT_APPROVAL", approvedAtUtc, actorDigestSha256}) {
  validatePolicyAmendment(amendment);
  assert(["OWNER_STATED_EXACT_APPROVAL", "OWNER_AUTHENTICATED_EXACT_APPROVAL"].includes(approvalState), "policy approval is not exact");
  requireUtc(approvedAtUtc, "policy approval time");
  requireSha(actorDigestSha256, "policy approval actor digest");
  const approval = {
    approval_state: approvalState,
    amendment_sha256: amendment.amendment_sha256,
    approved_at_utc: approvedAtUtc,
    actor_digest_sha256: actorDigestSha256,
    approval_sha256: null,
  };
  approval.approval_sha256 = policyDigest({...approval, approval_sha256: null});
  return approval;
}

function validatePolicyApproval(approval, amendment) {
  const keys = ["approval_state", "amendment_sha256", "approved_at_utc", "actor_digest_sha256", "approval_sha256"];
  requireRecord(approval, "policy approval");
  assert(JSON.stringify(Object.keys(approval).sort()) === JSON.stringify(keys.sort()), "policy approval fields mismatch");
  assert(approval.approval_state === "OWNER_AUTHENTICATED_EXACT_APPROVAL", "policy application requires authenticated exact approval");
  requireSha(approval.amendment_sha256, "policy approval amendment");
  assert(approval.amendment_sha256 === amendment.amendment_sha256, "policy approval targets a different amendment");
  requireUtc(approval.approved_at_utc, "policy approval time");
  requireSha(approval.actor_digest_sha256, "policy approval actor digest");
  requireSha(approval.approval_sha256, "policy approval digest");
  assert(approval.approval_sha256 === policyDigest({...approval, approval_sha256: null}), "policy approval digest mismatch");
}

export function applyPolicyAmendment({state, amendment, approval, currentBoundary = amendment.effective_boundary}) {
  validatePolicyState(state);
  validatePolicyAmendment(amendment);
  validatePolicyApproval(approval, amendment);
  assert(amendment.project_id === state.project_id, "policy amendment targets a different project");
  assert(amendment.parent_policy_state_sha256 === state.policy_state_sha256, "policy amendment is based on stale policy state");
  assert(BOUNDARY_RANK.get(currentBoundary) >= BOUNDARY_RANK.get(amendment.effective_boundary), "policy amendment is being applied before its effective boundary");
  const changes = new Map(amendment.changes.map((change) => [change.variable_id, change.new_value]));
  const nextEpoch = state.policy_epoch + 1;
  const variables = state.variables.map((record) => changes.has(record.variable_id)
    ? variableRecord(definition(record.variable_id), changes.get(record.variable_id), nextEpoch)
    : clone(record));
  const ledgerEntry = {
    amendment_id: amendment.amendment_id,
    project_id: state.project_id,
    parent_policy_state_sha256: state.policy_state_sha256,
    amendment_sha256: amendment.amendment_sha256,
    approval_sha256: approval.approval_sha256,
    policy_epoch: nextEpoch,
    effective_boundary: amendment.effective_boundary,
    requested_by: amendment.requested_by,
    authority: amendment.authority,
    reason: amendment.reason,
    requested_at_utc: amendment.requested_at_utc,
    changes: clone(amendment.changes),
    approved_at_utc: approval.approved_at_utc,
    actor_digest_sha256: approval.actor_digest_sha256,
    record_sha256: null,
  };
  ledgerEntry.record_sha256 = policyDigest({...ledgerEntry, record_sha256: null});
  const next = {
    ...clone(state),
    policy_epoch: nextEpoch,
    parent_policy_state_sha256: state.policy_state_sha256,
    amendment_head_sha256: amendment.amendment_sha256,
    variables,
    amendment_ledger: [...state.amendment_ledger, ledgerEntry],
    updated_at_utc: approval.approved_at_utc,
    policy_state_sha256: null,
  };
  next.policy_state_sha256 = policyStateDigest(next);
  validatePolicyState(next);
  return next;
}

export function getPolicyValue(state, variableId) {
  validatePolicyState(state);
  return clone(findVariable(state, variableId).current_value);
}

export function evaluatePolicyQuestion({state, variableId, requestedValue, authority, currentBoundary = null}) {
  validatePolicyState(state);
  const definitionValue = definition(variableId);
  if (definitionValue.class === "CONSTITUTIONAL") {
    return {decision: "OWNER_ONLY", reason: "constitutional governance cannot be weakened by a project amendment", effective_boundary: "GOVERNANCE_VERSION"};
  }
  validateValue(definitionValue, requestedValue, `${variableId} requested value`);
  if (JSON.stringify(getPolicyValue(state, variableId)) === JSON.stringify(requestedValue)) {
    return {decision: "NO_CHANGE", reason: "requested value is already current", effective_boundary: definitionValue.effective_boundary};
  }
  if (authority !== definitionValue.authority && authority !== "OWNER_INTENT") {
    return {decision: "OWNER_ONLY", reason: `the variable requires ${definitionValue.authority}`, effective_boundary: definitionValue.effective_boundary};
  }
  const effective = currentBoundary && BOUNDARY_RANK.get(currentBoundary) >= BOUNDARY_RANK.get(definitionValue.effective_boundary)
    ? "EFFECTIVE_NOW" : "PENDING_BOUNDARY";
  return {decision: "COMPILE_AMENDMENT", reason: effective === "EFFECTIVE_NOW" ? "safe boundary is available" : "record the amendment and apply it at its declared boundary", effective_boundary: definitionValue.effective_boundary};
}
