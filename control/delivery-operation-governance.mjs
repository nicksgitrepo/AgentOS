#!/usr/bin/env node

/*
 * Project-bound governance for protected operations.
 *
 * Bootstrap compiles the route and cost rules into project context. Agents,
 * Controllers, Auditors, and Spawners may prepare evidence and a decision
 * packet, but only the persistent Runtime may authorize an external effect.
 * A route or policy deviation is never implicit: it requires a complete cost
 * projection and an explicit owner decision.
 */

import crypto from "node:crypto";

export const DELIVERY_OPERATION_GOVERNANCE_SCHEMA = "agentos.delivery_operation_governance.v1";
export const RUNTIME_OPERATION_AUTHORIZATION_SCHEMA = "agentos.runtime_operation_authorization.v1";
export const RUNTIME_OPERATION_COST_PROJECTION_SCHEMA = "agentos.runtime_operation_cost_projection.v1";
export const RUNTIME_OPERATION_OWNER_DECISION_SCHEMA = "agentos.runtime_operation_owner_decision.v1";

export const RUNTIME_OPERATIONS = Object.freeze([
  "GIT_PUSH",
  "GIT_MERGE",
  "CI_RUN",
  "HOSTING_DEPLOY",
  "HOSTING_ROLLBACK",
  "RELEASE",
]);

export const RUNTIME_OPERATION_STATUSES = Object.freeze([
  "PREPARED_FOR_OWNER",
  "APPROVED",
  "REJECTED",
]);

export const RUNTIME_OWNER_DECISION_STATUSES = Object.freeze(["PENDING_OWNER", "APPROVED", "REJECTED"]);
export const RUNTIME_OWNER_DECISION_KINDS = Object.freeze(["WITHIN_POLICY", "ONE_TIME_EXCEPTION", "POLICY_REBIND_REQUIRED"]);
export const OPERATION_ROUTE_CLASSES = Object.freeze(["SOURCE_CONTROL", "LOCAL", "HOSTED", "VPS", "MANAGED", "HYBRID", "PROJECT_DEFINED"]);
export const COST_CONFIDENCE = Object.freeze(["MEASURED", "ESTIMATED", "UNKNOWN"]);
export const COST_BOUNDARY_STATUS = Object.freeze(["WITHIN", "EXCEEDS", "UNKNOWN"]);

const SHA256 = /^[0-9a-f]{64}$/u;
const SOURCE_ID = /^[0-9a-f]{40}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const OPAQUE_REF = /^opaque:[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const SECRET_PATTERN = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|credential)\s*[:=]/iu;
const CREDENTIAL_URL = /https?:\/\/[^\s]+[?&](?:token|secret|key|signature)=/iu;
const ABSOLUTE_PATH = /(?:^|[\s("'])\/(?:Users|home|private|tmp|var|etc|opt|srv|workspace|workspaces)(?:[\/\s)"]|$)/iu;
const WINDOWS_PATH = /(?:^|[\s("'])[A-Za-z]:[\\/]/u;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value, label) {
  assert(isRecord(value), `${label} must be an object`);
}

function exactKeys(value, expected, label) {
  requireRecord(value, label);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  assert(JSON.stringify(actual) === JSON.stringify(wanted), `${label} fields mismatch`);
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains control characters`);
  assert(!SECRET_PATTERN.test(value), `${label} contains secret material`);
  assert(!CREDENTIAL_URL.test(value), `${label} contains a credential-bearing URL`);
  assert(!ABSOLUTE_PATH.test(value) && !WINDOWS_PATH.test(value), `${label} contains a private path`);
}

function requireId(value, label) {
  requireString(value, label);
  assert(SAFE_ID.test(value) && !value.includes("/") && !value.includes("\\") && !value.includes(".."), `${label} is unsafe`);
}

function nullableId(value, label) {
  if (value === null) return;
  requireId(value, label);
}

function opaqueRef(value, label) {
  requireString(value, label);
  assert(OPAQUE_REF.test(value), `${label} must be an opaque reference`);
}

function nullableOpaqueRef(value, label) {
  if (value === null) return;
  opaqueRef(value, label);
}

function sha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function nullableSha(value, label) {
  if (value === null) return;
  sha(value, label);
}

function sourceId(value, label) {
  assert(typeof value === "string" && SOURCE_ID.test(value), `${label} must be a source identity`);
}

function utc(value, label) {
  assert(typeof value === "string" && ISO_UTC.test(value) && !Number.isNaN(Date.parse(value)), `${label} must be an ISO UTC timestamp`);
}

function finiteNumber(value, label, {minimum = 0} = {}) {
  assert(typeof value === "number" && Number.isFinite(value) && value >= minimum, `${label} is invalid`);
}

function nullableFiniteNumber(value, label) {
  if (value === null) return;
  finiteNumber(value, label);
}

function enumValue(value, values, label) {
  assert(values.includes(value), `${label} is invalid`);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))).map((key) => [key, canonicalize(value[key])]));
  return value;
}

export function canonicalDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value)), "utf8").digest("hex");
}

function secretFree(value, label) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  assert(!SECRET_PATTERN.test(text), `${label} contains secret material`);
  assert(!CREDENTIAL_URL.test(text), `${label} contains a credential-bearing URL`);
  assert(!ABSOLUTE_PATH.test(text) && !WINDOWS_PATH.test(text), `${label} contains a private path`);
}

function sortedStrings(value, label) {
  assert(Array.isArray(value) && value.length > 0, `${label} must be a nonempty array`);
  assert(value.every((entry) => typeof entry === "string" && entry.trim().length > 0), `${label} contains an invalid entry`);
  const normalized = [...new Set(value)].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  assert(normalized.length === value.length, `${label} must be unique`);
  return normalized;
}

function validateGovernanceRoute(route, label) {
  requireRecord(route, label);
  exactKeys(route, ["route_class", "provider_id", "environment_ids"], label);
  enumValue(route.route_class, OPERATION_ROUTE_CLASSES, `${label}.route_class`);
  nullableId(route.provider_id, `${label}.provider_id`);
  assert(Array.isArray(route.environment_ids), `${label}.environment_ids must be an array`);
  route.environment_ids.forEach((value, index) => requireId(value, `${label}.environment_ids[${index}]`));
  assert(new Set(route.environment_ids).size === route.environment_ids.length, `${label}.environment_ids must be unique`);
}

function assertConcreteRuntimeRoute(route, label) {
  assert(route.route_class !== "PROJECT_DEFINED", `${label} requires an exact project route binding before Runtime authorization`);
  if (["HOSTED", "VPS", "MANAGED", "HYBRID"].includes(route.route_class)) {
    assert(route.provider_id !== null, `${label} requires an exact provider binding before Runtime authorization`);
  }
}

export function validateDeliveryOperationGovernance(governance) {
  exactKeys(governance, [
    "schema", "version", "status", "runtime_authority", "preparation_authority", "protected_operations",
    "route_bindings", "cost_policy", "owner_decision_policy", "governance_sha256",
  ], "delivery operation governance");
  assert(governance.schema === DELIVERY_OPERATION_GOVERNANCE_SCHEMA && governance.version === 1, "delivery operation governance identity is invalid");
  enumValue(governance.status, ["PROJECT_GOVERNANCE_BOUND", "PROJECT_GOVERNANCE_WITH_BINDING_GAPS"], "delivery operation governance status");
  exactKeys(governance.runtime_authority, ["external_operations", "bypass_rule", "receipt_rule"], "operation Runtime authority");
  assert(governance.runtime_authority.external_operations === "RUNTIME_ONLY", "external operation authority is not Runtime-only");
  assert(governance.runtime_authority.bypass_rule === "NO_SILENT_POLICY_OR_ROUTE_OVERRIDE", "operation bypass rule is weakened");
  assert(governance.runtime_authority.receipt_rule === "TYPED_RECEIPT_BOUND_TO_POLICY_AND_PROJECTION", "operation receipt rule is weakened");
  exactKeys(governance.preparation_authority, ["allowed_roles", "allowed_actions", "external_effects"], "operation preparation authority");
  assert(JSON.stringify(governance.preparation_authority.allowed_roles) === JSON.stringify(["BOOTSTRAP", "CONTROLLER", "AUDITOR", "AGENT", "SPAWNER"]), "operation preparation roles are not canonical");
  assert(JSON.stringify(governance.preparation_authority.allowed_actions) === JSON.stringify(["DISCOVER", "PROPOSE", "PREPARE_COST_PROJECTION", "RETURN_OWNER_DECISION_PACKET"]), "operation preparation actions are not canonical");
  assert(governance.preparation_authority.external_effects === false, "preparation authority permits external effects");
  assert(JSON.stringify(governance.protected_operations) === JSON.stringify([...RUNTIME_OPERATIONS]), "protected operation roster is incomplete or not canonical");
  exactKeys(governance.route_bindings, RUNTIME_OPERATIONS, "operation route bindings");
  for (const operation of RUNTIME_OPERATIONS) validateGovernanceRoute(governance.route_bindings[operation], `route binding ${operation}`);
  exactKeys(governance.cost_policy, [
    "projection_required", "required_fields", "currency", "weekly_runner_minutes", "monthly_spend_ceiling",
    "unknown_cost_behavior", "exceed_behavior", "route_change_behavior", "hidden_costs_forbidden",
  ], "operation cost policy");
  assert(governance.cost_policy.projection_required === true, "operation cost projection is not required");
  assert(JSON.stringify(governance.cost_policy.required_fields) === JSON.stringify([
    "currency", "one_time_cost", "recurring_monthly_cost", "runner_minutes", "expected_duration_minutes",
    "worst_case_duration_minutes", "max_concurrency", "rollback_one_time_cost", "rollback_recurring_monthly_cost",
    "confidence", "basis", "boundary_status",
  ]), "operation cost projection fields are not canonical");
  assert(governance.cost_policy.currency === null || /^[A-Z]{3}$/u.test(governance.cost_policy.currency), "operation cost policy currency is invalid");
  nullableFiniteNumber(governance.cost_policy.weekly_runner_minutes, "operation weekly runner minutes");
  nullableFiniteNumber(governance.cost_policy.monthly_spend_ceiling, "operation monthly spend ceiling");
  assert(governance.cost_policy.unknown_cost_behavior === "RETURN_OWNER_DECISION_PACKET", "unknown operation cost behavior is unsafe");
  assert(governance.cost_policy.exceed_behavior === "RETURN_OWNER_DECISION_PACKET", "excess operation cost behavior is unsafe");
  assert(governance.cost_policy.route_change_behavior === "FULL_COST_PROJECTION_AND_OWNER_DECISION", "route-change operation behavior is unsafe");
  assert(governance.cost_policy.hidden_costs_forbidden === true, "hidden operation costs are allowed");
  exactKeys(governance.owner_decision_policy, ["required_for", "status_before_runtime", "route_change", "policy_change", "packet_schema"], "operation owner decision policy");
  assert(JSON.stringify(governance.owner_decision_policy.required_for) === JSON.stringify([...RUNTIME_OPERATIONS]), "owner decision roster is incomplete");
  assert(governance.owner_decision_policy.status_before_runtime === "REQUIRED_BEFORE_RUNTIME_AUTHORIZATION", "owner decision is not required before Runtime");
  assert(governance.owner_decision_policy.route_change === "OWNER_ONLY_WITH_FULL_COST_PROJECTION", "route-change owner boundary is weakened");
  assert(governance.owner_decision_policy.policy_change === "RECOMPILE_POLICY_AND_REAUTHORIZE", "policy-change owner boundary is weakened");
  assert(governance.owner_decision_policy.packet_schema === RUNTIME_OPERATION_AUTHORIZATION_SCHEMA, "owner packet schema is invalid");
  sha(governance.governance_sha256, "delivery operation governance digest");
  assert(governance.governance_sha256 === canonicalDigest({...governance, governance_sha256: null}), "delivery operation governance is not content-addressed");
  secretFree(governance, "delivery operation governance");
  return governance;
}

export function compileDeliveryOperationGovernance({
  runner_route = "PROJECT_DEFINED",
  runner_provider_id = null,
  runner_environment_ids = [],
  weekly_runner_minutes = null,
  deployment_route = "PROJECT_DEFINED",
  deployment_provider_id = null,
  deployment_environment_ids = [],
  monthly_spend_ceiling = null,
  currency = null,
} = {}) {
  enumValue(runner_route, ["HOSTED", "VPS", "LOCAL", "HYBRID", "PROJECT_DEFINED"], "operation runner route");
  enumValue(deployment_route, ["MANAGED", "VPS", "LOCAL", "HYBRID", "PROJECT_DEFINED"], "operation deployment route");
  nullableId(runner_provider_id, "operation runner provider ID");
  nullableId(deployment_provider_id, "operation deployment provider ID");
  if (currency !== null) assert(typeof currency === "string" && /^[A-Z]{3}$/u.test(currency), "operation currency is invalid");
  const runnerEnvironments = [...runner_environment_ids].sort();
  const deploymentEnvironments = [...deployment_environment_ids].sort();
  const routeBindings = {
    GIT_PUSH: {route_class: "SOURCE_CONTROL", provider_id: null, environment_ids: []},
    GIT_MERGE: {route_class: "SOURCE_CONTROL", provider_id: null, environment_ids: []},
    CI_RUN: {route_class: runner_route, provider_id: runner_provider_id, environment_ids: runnerEnvironments},
    HOSTING_DEPLOY: {route_class: deployment_route, provider_id: deployment_provider_id, environment_ids: deploymentEnvironments},
    HOSTING_ROLLBACK: {route_class: deployment_route, provider_id: deployment_provider_id, environment_ids: deploymentEnvironments},
    RELEASE: {route_class: deployment_route, provider_id: deployment_provider_id, environment_ids: deploymentEnvironments},
  };
  const status = runner_route !== "PROJECT_DEFINED" && deployment_route !== "PROJECT_DEFINED"
    && (runner_route === "LOCAL" || runner_provider_id !== null)
    && (deployment_route === "LOCAL" || deployment_provider_id !== null)
    && deploymentEnvironments.length > 0
    ? "PROJECT_GOVERNANCE_BOUND"
    : "PROJECT_GOVERNANCE_WITH_BINDING_GAPS";
  const governance = {
    schema: DELIVERY_OPERATION_GOVERNANCE_SCHEMA,
    version: 1,
    status,
    runtime_authority: {
      external_operations: "RUNTIME_ONLY",
      bypass_rule: "NO_SILENT_POLICY_OR_ROUTE_OVERRIDE",
      receipt_rule: "TYPED_RECEIPT_BOUND_TO_POLICY_AND_PROJECTION",
    },
    preparation_authority: {
      allowed_roles: ["BOOTSTRAP", "CONTROLLER", "AUDITOR", "AGENT", "SPAWNER"],
      allowed_actions: ["DISCOVER", "PROPOSE", "PREPARE_COST_PROJECTION", "RETURN_OWNER_DECISION_PACKET"],
      external_effects: false,
    },
    protected_operations: [...RUNTIME_OPERATIONS],
    route_bindings: routeBindings,
    cost_policy: {
      projection_required: true,
      required_fields: [
        "currency", "one_time_cost", "recurring_monthly_cost", "runner_minutes", "expected_duration_minutes",
        "worst_case_duration_minutes", "max_concurrency", "rollback_one_time_cost", "rollback_recurring_monthly_cost",
        "confidence", "basis", "boundary_status",
      ],
      currency,
      weekly_runner_minutes,
      monthly_spend_ceiling,
      unknown_cost_behavior: "RETURN_OWNER_DECISION_PACKET",
      exceed_behavior: "RETURN_OWNER_DECISION_PACKET",
      route_change_behavior: "FULL_COST_PROJECTION_AND_OWNER_DECISION",
      hidden_costs_forbidden: true,
    },
    owner_decision_policy: {
      required_for: [...RUNTIME_OPERATIONS],
      status_before_runtime: "REQUIRED_BEFORE_RUNTIME_AUTHORIZATION",
      route_change: "OWNER_ONLY_WITH_FULL_COST_PROJECTION",
      policy_change: "RECOMPILE_POLICY_AND_REAUTHORIZE",
      packet_schema: RUNTIME_OPERATION_AUTHORIZATION_SCHEMA,
    },
    governance_sha256: null,
  };
  governance.governance_sha256 = canonicalDigest({...governance, governance_sha256: null});
  return validateDeliveryOperationGovernance(governance);
}

export function operationForDeliveryAction(action) {
  const mapping = {PUSH: "GIT_PUSH", MERGE: "GIT_MERGE", DEPLOY: "HOSTING_DEPLOY", RELEASE: "RELEASE", ROLLBACK: "HOSTING_ROLLBACK"};
  assert(Object.prototype.hasOwnProperty.call(mapping, action), `unsupported delivery action for operation governance: ${action}`);
  return mapping[action];
}

export function validateRuntimeOperationCostProjection(projection) {
  exactKeys(projection, [
    "schema", "version", "currency", "one_time_cost", "recurring_monthly_cost", "runner_minutes", "expected_duration_minutes",
    "worst_case_duration_minutes", "max_concurrency", "rollback_one_time_cost", "rollback_recurring_monthly_cost", "confidence", "basis", "boundary_status", "projection_sha256",
  ], "Runtime operation cost projection");
  assert(projection.schema === RUNTIME_OPERATION_COST_PROJECTION_SCHEMA && projection.version === 1, "Runtime cost projection identity is invalid");
  assert(projection.currency === null || /^[A-Z]{3}$/u.test(projection.currency), "Runtime cost projection currency is invalid");
  for (const field of ["one_time_cost", "recurring_monthly_cost", "runner_minutes", "expected_duration_minutes", "worst_case_duration_minutes", "rollback_one_time_cost", "rollback_recurring_monthly_cost"]) nullableFiniteNumber(projection[field], `Runtime cost projection ${field}`);
  assert(Number.isInteger(projection.max_concurrency) && projection.max_concurrency >= 1, "Runtime cost projection max concurrency is invalid");
  assert(projection.worst_case_duration_minutes === null || projection.expected_duration_minutes === null || projection.worst_case_duration_minutes >= projection.expected_duration_minutes, "Runtime cost projection worst case is below expected duration");
  enumValue(projection.confidence, COST_CONFIDENCE, "Runtime cost projection confidence");
  const basis = sortedStrings(projection.basis, "Runtime cost projection basis");
  assert(JSON.stringify(projection.basis) === JSON.stringify(basis), "Runtime cost projection basis is not canonical");
  enumValue(projection.boundary_status, COST_BOUNDARY_STATUS, "Runtime cost projection boundary status");
  if (projection.confidence === "UNKNOWN") assert(projection.boundary_status === "UNKNOWN", "unknown cost confidence cannot claim a known boundary");
  sha(projection.projection_sha256, "Runtime cost projection digest");
  assert(projection.projection_sha256 === canonicalDigest({...projection, projection_sha256: null}), "Runtime cost projection is not content-addressed");
  secretFree(projection, "Runtime cost projection");
  return projection;
}

export function compileRuntimeOperationCostProjection({
  currency = null,
  one_time_cost = null,
  recurring_monthly_cost = null,
  runner_minutes = null,
  expected_duration_minutes = null,
  worst_case_duration_minutes = null,
  max_concurrency = 1,
  rollback_one_time_cost = null,
  rollback_recurring_monthly_cost = null,
  confidence = "UNKNOWN",
  basis = ["OWNER_OR_PROVIDER_ESTIMATE_REQUIRED"],
  boundary_status = "UNKNOWN",
} = {}) {
  const projection = {
    schema: RUNTIME_OPERATION_COST_PROJECTION_SCHEMA,
    version: 1,
    currency,
    one_time_cost,
    recurring_monthly_cost,
    runner_minutes,
    expected_duration_minutes,
    worst_case_duration_minutes,
    max_concurrency,
    rollback_one_time_cost,
    rollback_recurring_monthly_cost,
    confidence,
    basis: [...basis],
    boundary_status,
    projection_sha256: null,
  };
  projection.projection_sha256 = canonicalDigest({...projection, projection_sha256: null});
  return validateRuntimeOperationCostProjection(projection);
}

function operationScopeDigest(auth) {
  return canonicalDigest({
    operation_id: auth.operation_id,
    operation: auth.operation,
    policy_digest: auth.policy_digest,
    adapter_contract_digest: auth.adapter_contract_digest,
    choice_digest: auth.choice_digest,
    candidate: auth.candidate,
    route: auth.route,
    projection_sha256: auth.cost_projection.projection_sha256,
    route_change: auth.route_change,
    policy_change: auth.policy_change,
  });
}

function validateOwnerDecision(decision, {scopeDigest, projectionDigest, operationStatus, routeChange, policyChange, boundaryStatus} = {}) {
  exactKeys(decision, ["schema", "version", "status", "decision_ref", "decision_kind", "scope_digest", "projection_sha256", "decided_at_utc", "decision_sha256"], "Runtime operation owner decision");
  assert(decision.schema === RUNTIME_OPERATION_OWNER_DECISION_SCHEMA && decision.version === 1, "Runtime owner decision identity is invalid");
  enumValue(decision.status, RUNTIME_OWNER_DECISION_STATUSES, "Runtime owner decision status");
  nullableOpaqueRef(decision.decision_ref, "Runtime owner decision reference");
  if (decision.status === "PENDING_OWNER") {
    assert(decision.decision_ref === null && decision.decision_kind === null && decision.decided_at_utc === null, "pending owner decision contains approval data");
  } else {
    enumValue(decision.decision_kind, RUNTIME_OWNER_DECISION_KINDS, "Runtime owner decision kind");
    opaqueRef(decision.decision_ref, "Runtime owner decision reference");
    utc(decision.decided_at_utc, "Runtime owner decision time");
    assert(operationStatus === "APPROVED" ? decision.status === "APPROVED" : true, "approved operation lacks owner approval");
    if (operationStatus === "APPROVED") {
      if (routeChange) assert(decision.decision_kind === "ONE_TIME_EXCEPTION", "route changes require an explicit one-time owner exception");
      if (policyChange) assert(decision.decision_kind === "POLICY_REBIND_REQUIRED", "policy changes require a policy rebind decision");
      if (boundaryStatus === "UNKNOWN" || boundaryStatus === "EXCEEDS") assert(decision.decision_kind === "ONE_TIME_EXCEPTION", "unknown or excess operation cost requires an explicit one-time owner exception");
    }
  }
  assert(decision.scope_digest === scopeDigest, "Runtime owner decision scope differs from operation authorization");
  assert(decision.projection_sha256 === projectionDigest, "Runtime owner decision projection differs");
  sha(decision.decision_sha256, "Runtime owner decision digest");
  assert(decision.decision_sha256 === canonicalDigest({...decision, decision_sha256: null}), "Runtime owner decision is not content-addressed");
  secretFree(decision, "Runtime owner decision");
  return decision;
}

export function validateRuntimeOperationAuthorization(auth, {requireApproved = false, expected = {}} = {}) {
  exactKeys(auth, [
    "schema", "version", "status", "operation_id", "operation", "authority", "runtime_only", "policy_digest", "adapter_contract_digest", "choice_digest",
    "candidate", "route", "cost_projection", "route_change", "policy_change", "owner_decision", "requested_at_utc", "authorization_sha256",
  ], "Runtime operation authorization");
  assert(auth.schema === RUNTIME_OPERATION_AUTHORIZATION_SCHEMA && auth.version === 1, "Runtime operation authorization identity is invalid");
  enumValue(auth.status, RUNTIME_OPERATION_STATUSES, "Runtime operation authorization status");
  enumValue(auth.operation, RUNTIME_OPERATIONS, "Runtime operation authorization operation");
  assert(auth.authority === "RUNTIME_ONLY" && auth.runtime_only === true, "Runtime operation authorization is not Runtime-only");
  sha(auth.policy_digest, "Runtime operation authorization policy digest");
  nullableSha(auth.adapter_contract_digest, "Runtime operation authorization adapter digest");
  nullableSha(auth.choice_digest, "Runtime operation authorization choice digest");
  exactKeys(auth.candidate, ["source_commit", "source_tree", "artifact_digest", "environment_ref"], "Runtime operation candidate");
  sourceId(auth.candidate.source_commit, "Runtime operation candidate source commit");
  sourceId(auth.candidate.source_tree, "Runtime operation candidate source tree");
  sha(auth.candidate.artifact_digest, "Runtime operation candidate artifact digest");
  nullableOpaqueRef(auth.candidate.environment_ref, "Runtime operation candidate environment");
  validateGovernanceRoute(auth.route, "Runtime operation route");
  validateRuntimeOperationCostProjection(auth.cost_projection);
  assert(typeof auth.route_change === "boolean" && typeof auth.policy_change === "boolean", "Runtime operation change flags are invalid");
  if (auth.policy_change && auth.status === "APPROVED") throw new Error("policy change requires recompile and reauthorization");
  if (auth.status === "APPROVED") assertConcreteRuntimeRoute(auth.route, "Runtime operation route");
  const scopeDigest = operationScopeDigest(auth);
  validateOwnerDecision(auth.owner_decision, {
    scopeDigest,
    projectionDigest: auth.cost_projection.projection_sha256,
    operationStatus: auth.status,
    routeChange: auth.route_change,
    policyChange: auth.policy_change,
    boundaryStatus: auth.cost_projection.boundary_status,
  });
  if (requireApproved) assert(auth.status === "APPROVED" && auth.owner_decision.status === "APPROVED", "Runtime operation lacks explicit owner approval");
  if (expected.policy_digest !== undefined) assert(auth.policy_digest === expected.policy_digest, "Runtime operation policy differs");
  if (expected.adapter_contract_digest !== undefined) assert(auth.adapter_contract_digest === expected.adapter_contract_digest, "Runtime operation adapter differs");
  if (expected.choice_digest !== undefined) assert(auth.choice_digest === expected.choice_digest, "Runtime operation choice differs");
  if (expected.operation !== undefined) assert(auth.operation === expected.operation, "Runtime operation differs");
  sha(auth.authorization_sha256, "Runtime operation authorization digest");
  assert(auth.authorization_sha256 === canonicalDigest({...auth, authorization_sha256: null}), "Runtime operation authorization is not content-addressed");
  secretFree(auth, "Runtime operation authorization");
  return auth;
}

export function compileRuntimeOperationAuthorization({
  operation_id,
  operation,
  policy_digest,
  adapter_contract_digest = null,
  choice_digest = null,
  source_commit,
  source_tree,
  artifact_digest,
  environment_ref = null,
  route_class = "PROJECT_DEFINED",
  provider_id = null,
  environment_ids = [],
  cost_projection,
  route_change = false,
  policy_change = false,
  requested_at_utc,
} = {}) {
  requireId(operation_id, "Runtime operation ID");
  enumValue(operation, RUNTIME_OPERATIONS, "Runtime operation");
  sha(policy_digest, "Runtime operation policy digest");
  nullableSha(adapter_contract_digest, "Runtime operation adapter digest");
  nullableSha(choice_digest, "Runtime operation choice digest");
  sourceId(source_commit, "Runtime operation source commit");
  sourceId(source_tree, "Runtime operation source tree");
  sha(artifact_digest, "Runtime operation artifact digest");
  nullableOpaqueRef(environment_ref, "Runtime operation environment");
  enumValue(route_class, OPERATION_ROUTE_CLASSES, "Runtime operation route class");
  nullableId(provider_id, "Runtime operation provider ID");
  assert(Array.isArray(environment_ids) && new Set(environment_ids).size === environment_ids.length, "Runtime operation environment IDs are invalid");
  environment_ids.forEach((value, index) => requireId(value, `Runtime operation environment ID ${index}`));
  validateRuntimeOperationCostProjection(cost_projection);
  utc(requested_at_utc, "Runtime operation requested time");
  const auth = {
    schema: RUNTIME_OPERATION_AUTHORIZATION_SCHEMA,
    version: 1,
    status: "PREPARED_FOR_OWNER",
    operation_id,
    operation,
    authority: "RUNTIME_ONLY",
    runtime_only: true,
    policy_digest,
    adapter_contract_digest,
    choice_digest,
    candidate: {source_commit, source_tree, artifact_digest, environment_ref},
    route: {route_class, provider_id, environment_ids: [...environment_ids].sort()},
    cost_projection,
    route_change,
    policy_change,
    owner_decision: {
      schema: RUNTIME_OPERATION_OWNER_DECISION_SCHEMA,
      version: 1,
      status: "PENDING_OWNER",
      decision_ref: null,
      decision_kind: null,
      scope_digest: null,
      projection_sha256: cost_projection.projection_sha256,
      decided_at_utc: null,
      decision_sha256: null,
    },
    requested_at_utc,
    authorization_sha256: null,
  };
  auth.owner_decision.scope_digest = operationScopeDigest(auth);
  auth.owner_decision.decision_sha256 = canonicalDigest({...auth.owner_decision, decision_sha256: null});
  auth.authorization_sha256 = canonicalDigest({...auth, authorization_sha256: null});
  return validateRuntimeOperationAuthorization(auth);
}

export function approveRuntimeOperationAuthorization(prepared, {decision_ref, decision_kind = "WITHIN_POLICY", decided_at_utc} = {}) {
  validateRuntimeOperationAuthorization(prepared);
  assert(prepared.status === "PREPARED_FOR_OWNER", "Runtime operation is not awaiting an owner decision");
  opaqueRef(decision_ref, "Runtime operation decision reference");
  enumValue(decision_kind, RUNTIME_OWNER_DECISION_KINDS, "Runtime operation decision kind");
  utc(decided_at_utc, "Runtime operation decision time");
  if (prepared.policy_change) throw new Error("policy change requires recompile and reauthorization");
  if (decision_kind === "POLICY_REBIND_REQUIRED") throw new Error("policy rebind decisions require recompilation and reauthorization");
  assertConcreteRuntimeRoute(prepared.route, "Runtime operation route");
  if (prepared.route_change || prepared.cost_projection.boundary_status === "UNKNOWN" || prepared.cost_projection.boundary_status === "EXCEEDS") {
    assert(decision_kind === "ONE_TIME_EXCEPTION", "route, unknown-cost, and excess-cost operations require an explicit one-time owner exception");
  }
  const approved = structuredClone(prepared);
  approved.status = "APPROVED";
  approved.owner_decision.status = "APPROVED";
  approved.owner_decision.decision_ref = decision_ref;
  approved.owner_decision.decision_kind = decision_kind;
  approved.owner_decision.decided_at_utc = decided_at_utc;
  approved.owner_decision.decision_sha256 = canonicalDigest({...approved.owner_decision, decision_sha256: null});
  approved.authorization_sha256 = canonicalDigest({...approved, authorization_sha256: null});
  return validateRuntimeOperationAuthorization(approved, {requireApproved: true});
}

export function rejectRuntimeOperationAuthorization(prepared, {decision_ref, decided_at_utc} = {}) {
  validateRuntimeOperationAuthorization(prepared);
  assert(prepared.status === "PREPARED_FOR_OWNER", "Runtime operation is not awaiting an owner decision");
  opaqueRef(decision_ref, "Runtime operation decision reference");
  utc(decided_at_utc, "Runtime operation decision time");
  const rejected = structuredClone(prepared);
  rejected.status = "REJECTED";
  rejected.owner_decision.status = "REJECTED";
  rejected.owner_decision.decision_ref = decision_ref;
  rejected.owner_decision.decision_kind = "WITHIN_POLICY";
  rejected.owner_decision.decided_at_utc = decided_at_utc;
  rejected.owner_decision.decision_sha256 = canonicalDigest({...rejected.owner_decision, decision_sha256: null});
  rejected.authorization_sha256 = canonicalDigest({...rejected, authorization_sha256: null});
  return validateRuntimeOperationAuthorization(rejected);
}

export function createRuntimeOperationDecisionPacket(prepared) {
  validateRuntimeOperationAuthorization(prepared);
  assert(prepared.status === "PREPARED_FOR_OWNER", "decision packet requires a prepared operation");
  return {
    schema: RUNTIME_OPERATION_AUTHORIZATION_SCHEMA,
    status: "PENDING_OWNER",
    operation_id: prepared.operation_id,
    operation: prepared.operation,
    policy_digest: prepared.policy_digest,
    candidate: structuredClone(prepared.candidate),
    route: structuredClone(prepared.route),
    cost_projection: structuredClone(prepared.cost_projection),
    route_change: prepared.route_change,
    policy_change: prepared.policy_change,
    owner_decision_required: true,
    next_action: "OWNER_APPROVE_REJECT_OR_RECOMPILE_POLICY",
    packet_sha256: canonicalDigest({
      schema: RUNTIME_OPERATION_AUTHORIZATION_SCHEMA,
      status: "PENDING_OWNER",
      operation_id: prepared.operation_id,
      operation: prepared.operation,
      policy_digest: prepared.policy_digest,
      candidate: prepared.candidate,
      route: prepared.route,
      cost_projection: prepared.cost_projection,
      route_change: prepared.route_change,
      policy_change: prepared.policy_change,
      owner_decision_required: true,
      next_action: "OWNER_APPROVE_REJECT_OR_RECOMPILE_POLICY",
    }),
  };
}
