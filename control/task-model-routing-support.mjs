#!/usr/bin/env node

/* Internal record validators for task/model routing. */

import {assertPersistedRecordSafe, canonicalDigest, compareUtf8} from "./content-addressing.mjs";

const EFFECTIVE_MODEL_READBACK_SCHEMA = "agentos.effective_model_readback.v1";
const FALLBACK_BOUNDARY_SCHEMA = "agentos.routing_fallback_boundary.v1";
const REASONING_EFFORTS = Object.freeze(["low", "medium", "high", "max"]);
const SAFE_FALLBACK_TRIGGERS = Object.freeze([
  "MODEL_UNAVAILABLE",
  "RATE_LIMITED",
  "CAPACITY_UNAVAILABLE",
  "CONTEXT_UNAVAILABLE",
  "BUDGET_EXCEEDED",
]);
const HARD_BOUNDARY_TRIGGERS = Object.freeze([
  "READBACK_UNKNOWN",
  "READBACK_MISMATCH",
  "PERMISSION_MISMATCH",
  "SCOPE_MISMATCH",
  "PRIVACY_BOUNDARY",
  "VERIFIER_TOO_WEAK",
  "SOURCE_MISMATCH",
]);
const PERMISSION_CLASSES = Object.freeze([
  "READ_SOURCE",
  "READ_ASSIGNED_WORKTREE",
  "WRITE_ASSIGNED_WORKTREE",
  "HOST_LIFECYCLE",
  "EMIT_EVIDENCE",
  "INDEPENDENT_REVIEW",
  "PROTECTED_EXTERNAL_ACTION",
]);
const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const TOOL_IDENTIFIER = /^[a-z][a-z0-9._:-]*$/u;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

const REASONING_RANK = new Map(REASONING_EFFORTS.map((value, index) => [value, index + 1]));

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

function sortedUnique(values, label, {tool = false} = {}) {
  assertCondition(Array.isArray(values), `${label} must be an array`);
  const normalized = values.map((value) => requireIdentifier(value, `${label} item`, {tool}));
  const sorted = [...normalized].sort(compareUtf8);
  assertCondition(new Set(sorted).size === sorted.length, `${label} must not contain duplicates`);
  assertCondition(JSON.stringify(values) === JSON.stringify(sorted), `${label} must be UTF-8 sorted and unique`);
  return values;
}

function subset(required, available) {
  const set = new Set(available);
  return required.every((value) => set.has(value));
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

function validatePermissionList(values, label) {
  assertCondition(Array.isArray(values), `${label} must be an array`);
  values.forEach((value) => requireEnum(value, PERMISSION_CLASSES, `${label} permission`));
  assertCondition(!values.includes("PROTECTED_EXTERNAL_ACTION"), `${label} cannot grant protected external actions`);
  const sorted = [...values].sort(compareUtf8);
  assertCondition(new Set(sorted).size === sorted.length && JSON.stringify(values) === JSON.stringify(sorted), `${label} must be unique and UTF-8 sorted`);
  return values;
}

function candidateKey(candidate) {
  return `${candidate.model}\u0000${candidate.reasoning_effort}`;
}

function compareCandidateIdentity(left, right) {
  return compareUtf8(candidateKey(left), candidateKey(right));
}

function normalizeReadback(value, label) {
  if (value === null || value === undefined) return null;
  exactKeys(value, ["execution_ref_sha256", "route_sha256", "model", "reasoning_effort", "capability_catalog_sha256", "tools", "context_tokens", "permissions"], label);
  const normalized = structuredClone(value);
  assertCondition(Array.isArray(normalized.tools), `${label}.tools must be an array`);
  assertCondition(Array.isArray(normalized.permissions), `${label}.permissions must be an array`);
  normalized.tools = [...normalized.tools].sort(compareUtf8);
  normalized.permissions = [...normalized.permissions].sort(compareUtf8);
  requireSha(normalized.execution_ref_sha256, `${label}.execution_ref_sha256`);
  requireSha(normalized.route_sha256, `${label}.route_sha256`);
  requireIdentifier(normalized.model, `${label}.model`);
  requireEnum(normalized.reasoning_effort, REASONING_EFFORTS, `${label}.reasoning_effort`);
  requireSha(normalized.capability_catalog_sha256, `${label}.capability_catalog_sha256`);
  sortedUnique(normalized.tools, `${label}.tools`, {tool: true});
  requirePositiveInteger(normalized.context_tokens, `${label}.context_tokens`);
  validatePermissionList(normalized.permissions, `${label}.permissions`);
  return normalized;
}

function readbackMismatchFields(route, host, session) {
  const mismatches = [];
  for (const [label, value] of [["host", host], ["session", session]]) {
    if (value.route_sha256 !== route.digest) mismatches.push(`${label}.route_sha256`);
    if (value.model !== route.model) mismatches.push(`${label}.model`);
    if (value.reasoning_effort !== route.reasoning_effort) mismatches.push(`${label}.reasoning_effort`);
    if (value.capability_catalog_sha256 !== route.capability_catalog_sha256) mismatches.push(`${label}.capability_catalog_sha256`);
    if (!subset(route.tools.required, value.tools) || !subset(value.tools, route.tools.allowed)) mismatches.push(`${label}.tools`);
    if (value.context_tokens < route.context.required_tokens || value.context_tokens > route.context.host_max_tokens) mismatches.push(`${label}.context_tokens`);
    if (JSON.stringify(value.permissions) !== JSON.stringify(route.permissions.granted)) mismatches.push(`${label}.permissions`);
  }
  if (host.model !== session.model) mismatches.push("host_session.model");
  if (host.reasoning_effort !== session.reasoning_effort) mismatches.push("host_session.reasoning_effort");
  if (host.capability_catalog_sha256 !== session.capability_catalog_sha256) mismatches.push("host_session.capability_catalog_sha256");
  return [...new Set(mismatches)].sort(compareUtf8);
}

function validateEffectiveReadbackShape(record) {
  exactKeys(record, [
    "schema", "version", "status", "route_sha256", "requested_model", "requested_reasoning_effort", "host_execution_ref_sha256",
    "session_execution_ref_sha256", "host_model", "host_reasoning_effort", "session_model", "session_reasoning_effort",
    "host_capability_catalog_sha256", "session_capability_catalog_sha256", "host_tools", "session_tools", "host_context_tokens",
    "session_context_tokens", "host_permissions", "session_permissions", "effective_model", "effective_reasoning_effort",
    "missing_fields", "mismatch_fields", "reason_code", "acceptance", "protected_actions_enabled", "observed_at_utc", "digest",
  ], "effective model readback");
  assertCondition(record.schema === EFFECTIVE_MODEL_READBACK_SCHEMA && record.version === 1, "effective model readback identity is invalid");
  requireEnum(record.status, ["VERIFIED", "UNKNOWN", "MISMATCH"], "effective model readback status");
  requireSha(record.route_sha256, "effective model readback route_sha256");
  requireIdentifier(record.requested_model, "effective model readback requested_model");
  requireEnum(record.requested_reasoning_effort, REASONING_EFFORTS, "effective model readback requested_reasoning_effort");
  for (const field of ["host_execution_ref_sha256", "session_execution_ref_sha256", "host_capability_catalog_sha256", "session_capability_catalog_sha256"]) {
    if (record[field] !== null) requireSha(record[field], `effective model readback ${field}`);
  }
  for (const field of ["host_model", "session_model", "effective_model"]) if (record[field] !== null) requireIdentifier(record[field], `effective model readback ${field}`);
  for (const field of ["host_reasoning_effort", "session_reasoning_effort", "effective_reasoning_effort"]) if (record[field] !== null) requireEnum(record[field], REASONING_EFFORTS, `effective model readback ${field}`);
  sortedUnique(record.host_tools, "effective model readback host_tools", {tool: true});
  sortedUnique(record.session_tools, "effective model readback session_tools", {tool: true});
  for (const field of ["host_context_tokens", "session_context_tokens"]) if (record[field] !== null) requirePositiveInteger(record[field], `effective model readback ${field}`);
  validatePermissionList(record.host_permissions, "effective model readback host_permissions");
  validatePermissionList(record.session_permissions, "effective model readback session_permissions");
  sortedUnique(record.missing_fields, "effective model readback missing_fields");
  sortedUnique(record.mismatch_fields, "effective model readback mismatch_fields");
  requireIdentifier(record.reason_code, "effective model readback reason_code");
  assertCondition(typeof record.acceptance === "boolean" && typeof record.protected_actions_enabled === "boolean", "effective model readback acceptance fields are invalid");
  assertCondition(record.protected_actions_enabled === false, "routing cannot enable protected actions");
  requireUtc(record.observed_at_utc, "effective model readback observed_at_utc");
  if (record.status === "VERIFIED") {
    assertCondition(record.acceptance === true && record.effective_model !== null && record.effective_reasoning_effort !== null, "verified readback must expose effective execution");
    assertCondition(record.missing_fields.length === 0 && record.mismatch_fields.length === 0, "verified readback cannot contain gaps");
  } else {
    assertCondition(record.acceptance === false && record.effective_model === null && record.effective_reasoning_effort === null, "blocked readback cannot expose effective execution");
  }
  requireDigestMatch(record, "digest", "effective model readback");
  return privacyCheck(record, "effective model readback");
}

export function compileEffectiveModelReadbackRecord({route, hostReadback = null, sessionReadback = null, observedAtUtc, validateRoute}) {
  assertCondition(typeof validateRoute === "function", "route validator is required");
  validateRoute(route);
  requireUtc(observedAtUtc, "observedAtUtc");
  const host = normalizeReadback(hostReadback, "host readback");
  const session = normalizeReadback(sessionReadback, "session readback");
  const missingFields = [];
  if (host === null) missingFields.push("host.readback");
  if (session === null) missingFields.push("session.readback");
  if (host === null) missingFields.push("host.model", "host.reasoning_effort", "host.route_sha256", "host.capability_catalog_sha256");
  if (session === null) missingFields.push("session.model", "session.reasoning_effort", "session.route_sha256", "session.capability_catalog_sha256");
  const mismatchFields = host !== null && session !== null ? readbackMismatchFields(route, host, session) : [];
  const uniqueMissing = [...new Set(missingFields)].sort(compareUtf8);
  const status = uniqueMissing.length > 0 ? "UNKNOWN" : mismatchFields.length > 0 ? "MISMATCH" : "VERIFIED";
  const record = {
    schema: EFFECTIVE_MODEL_READBACK_SCHEMA,
    version: 1,
    status,
    route_sha256: route.digest,
    requested_model: route.model,
    requested_reasoning_effort: route.reasoning_effort,
    host_execution_ref_sha256: host?.execution_ref_sha256 ?? null,
    session_execution_ref_sha256: session?.execution_ref_sha256 ?? null,
    host_model: host?.model ?? null,
    host_reasoning_effort: host?.reasoning_effort ?? null,
    session_model: session?.model ?? null,
    session_reasoning_effort: session?.reasoning_effort ?? null,
    host_capability_catalog_sha256: host?.capability_catalog_sha256 ?? null,
    session_capability_catalog_sha256: session?.capability_catalog_sha256 ?? null,
    host_tools: host?.tools ?? [],
    session_tools: session?.tools ?? [],
    host_context_tokens: host?.context_tokens ?? null,
    session_context_tokens: session?.context_tokens ?? null,
    host_permissions: host?.permissions ?? [],
    session_permissions: session?.permissions ?? [],
    effective_model: status === "VERIFIED" ? host.model : null,
    effective_reasoning_effort: status === "VERIFIED" ? host.reasoning_effort : null,
    missing_fields: uniqueMissing,
    mismatch_fields: mismatchFields,
    reason_code: status === "VERIFIED" ? "HOST_SESSION_EXECUTION_MATCHED" : status === "UNKNOWN" ? "HOST_EXECUTION_READBACK_UNAVAILABLE" : "HOST_SESSION_EXECUTION_MISMATCH",
    acceptance: status === "VERIFIED",
    protected_actions_enabled: false,
    observed_at_utc: observedAtUtc,
    digest: null,
  };
  record.digest = digestWithout(record, "digest");
  return validateEffectiveReadbackShape(record);
}

export function validateEffectiveModelReadbackRecord(record) {
  return validateEffectiveReadbackShape(record);
}

export class RoutingBoundaryError extends Error {
  constructor(code, message, boundary = null) {
    super(message);
    this.name = "RoutingBoundaryError";
    this.code = code;
    this.boundary = boundary;
  }
}

export function requireVerifiedEffectiveModelRecord(readback, expectedRoute = null) {
  validateEffectiveReadbackShape(readback);
  if (expectedRoute === null) throw new RoutingBoundaryError("EXPECTED_ROUTE_REQUIRED", "verified readback requires an expected route", readback);
  if (readback.status !== "VERIFIED") throw new RoutingBoundaryError(readback.reason_code, readback.reason_code, readback);
  requireRecord(expectedRoute, "expected execution route");
  requireSha(expectedRoute.digest, "expected execution route.digest");
  if (readback.route_sha256 !== expectedRoute.digest
    || readback.requested_model !== expectedRoute.model
    || readback.requested_reasoning_effort !== expectedRoute.reasoning_effort
    || readback.effective_model !== expectedRoute.model
    || readback.effective_reasoning_effort !== expectedRoute.reasoning_effort) {
    throw new RoutingBoundaryError("READBACK_ROUTE_MISMATCH", "verified readback does not match the expected route", readback);
  }
  return readback;
}

function validateFallbackBoundaryShape(boundary) {
  exactKeys(boundary, ["schema", "version", "status", "reason_code", "predecessor_route_sha256", "trigger", "attempted_models", "acceptance", "protected_actions_enabled", "digest"], "routing fallback boundary");
  assertCondition(boundary.schema === FALLBACK_BOUNDARY_SCHEMA && boundary.version === 1 && boundary.status === "BLOCKED", "routing fallback boundary identity is invalid");
  requireIdentifier(boundary.reason_code, "routing fallback boundary reason_code");
  requireSha(boundary.predecessor_route_sha256, "routing fallback boundary predecessor_route_sha256");
  requireEnum(boundary.trigger, [...SAFE_FALLBACK_TRIGGERS, ...HARD_BOUNDARY_TRIGGERS], "routing fallback boundary trigger");
  assertCondition(Array.isArray(boundary.attempted_models), "routing fallback boundary attempted_models must be an array");
  boundary.attempted_models.forEach((candidate, index) => {
    exactKeys(candidate, ["model", "reasoning_effort"], `routing fallback boundary attempted model ${index}`);
    requireIdentifier(candidate.model, `routing fallback boundary attempted model ${index}.model`);
    requireEnum(candidate.reasoning_effort, REASONING_EFFORTS, `routing fallback boundary attempted model ${index}.reasoning_effort`);
  });
  const attempted = boundary.attempted_models.map(candidateKey);
  assertCondition(JSON.stringify(attempted) === JSON.stringify([...attempted].sort(compareUtf8)), "routing fallback boundary attempted_models must be sorted");
  assertCondition(boundary.acceptance === false && boundary.protected_actions_enabled === false, "routing fallback boundary crossed acceptance");
  requireDigestMatch(boundary, "digest", "routing fallback boundary");
  return privacyCheck(boundary, "routing fallback boundary");
}

export function compileFallbackBoundaryRecord({route, trigger, reasonCode, attemptedModels = []}) {
  const boundary = {
    schema: FALLBACK_BOUNDARY_SCHEMA,
    version: 1,
    status: "BLOCKED",
    reason_code: reasonCode,
    predecessor_route_sha256: route.digest,
    trigger,
    attempted_models: attemptedModels.map((candidate) => ({model: candidate.model, reasoning_effort: candidate.reasoning_effort})).sort(compareCandidateIdentity),
    acceptance: false,
    protected_actions_enabled: false,
    digest: null,
  };
  boundary.digest = digestWithout(boundary, "digest");
  return validateFallbackBoundaryShape(boundary);
}

export function validateFallbackBoundaryRecord(boundary) {
  return validateFallbackBoundaryShape(boundary);
}
