#!/usr/bin/env node

/* Provider-neutral capability and permission contract for protected delivery. */

import crypto from "node:crypto";

export const DELIVERY_ADAPTER_SCHEMA = "agentos.delivery_adapter_contract.v1";
export const DELIVERY_ADAPTER_ACTIONS = Object.freeze(["PUSH", "MERGE", "DEPLOY", "RELEASE", "ROLLBACK"]);
export const DELIVERY_ADAPTER_STATUS = "PREPARED_NOT_ACTIVATED";

const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const SECRET_PATTERN = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|credential)\s*[:=]/iu;
const ACTION_PERMISSION = "RUNTIME_AUTHORIZATION_AFTER_OWNER_DECISION";
const RECEIPT_CONTRACT = "TYPED_EXTERNAL_RECEIPT";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value, label) {
  assert(isRecord(value), `${label} must be an object`);
}

function requireId(value, label) {
  assert(typeof value === "string" && value.trim().length > 0 && SAFE_ID.test(value), `${label} is invalid`);
  assert(!value.includes("//") && !value.split("/").includes(".."), `${label} contains an unsafe path fragment`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort(compareUtf8).map((key) => [key, canonicalize(value[key])]));
  return value;
}

export function canonicalDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value)), "utf8").digest("hex");
}

function secretFree(value, label) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  assert(!SECRET_PATTERN.test(text), `${label} contains secret material`);
  assert(!/https?:\/\/[^\s]+[?&](?:token|secret|key|signature)=/iu.test(text), `${label} contains a credential-bearing URL`);
}

function rejectUnknown(record, allowed, label) {
  for (const key of Object.keys(record)) assert(allowed.includes(key), `${label} contains unsupported field: ${key}`);
}

function sortedUnique(values, choices, label) {
  assert(Array.isArray(values) && values.length > 0, `${label} must be a nonempty array`);
  const normalized = [...new Set(values)];
  assert(normalized.length === values.length && normalized.every((value) => choices.includes(value)), `${label} contains an unsupported or duplicate action`);
  return normalized.sort(compareUtf8);
}

function normalizePermissions(capabilities, permissions) {
  const input = permissions ?? capabilities.map((action) => ({action, authority: ACTION_PERMISSION, receipt: RECEIPT_CONTRACT}));
  assert(Array.isArray(input) && input.length === capabilities.length, "delivery adapter permissions must cover every capability");
  const normalized = input.map((permission, index) => {
    requireRecord(permission, `delivery adapter permission ${index}`);
    rejectUnknown(permission, ["action", "authority", "receipt"], `delivery adapter permission ${index}`);
    assert(DELIVERY_ADAPTER_ACTIONS.includes(permission.action), `delivery adapter permission ${index} action is invalid`);
    assert(permission.authority === ACTION_PERMISSION, `delivery adapter permission ${index} authority is invalid`);
    assert(permission.receipt === RECEIPT_CONTRACT, `delivery adapter permission ${index} receipt contract is invalid`);
    return {action: permission.action, authority: permission.authority, receipt: permission.receipt};
  }).sort((left, right) => compareUtf8(left.action, right.action));
  assert(JSON.stringify(normalized.map((permission) => permission.action)) === JSON.stringify(capabilities), "delivery adapter permissions do not match capabilities");
  return normalized;
}

function validateAdapterDigest(contract) {
  requireSha(contract.digest, "delivery adapter contract digest");
  const body = structuredClone(contract);
  delete body.digest;
  assert(contract.digest === canonicalDigest(body), "delivery adapter contract is not content-addressed");
}

export function validateDeliveryAdapterContract(contract) {
  requireRecord(contract, "delivery adapter contract");
  const fields = [
    "schema", "version", "status", "adapter_ref", "protocol", "capabilities", "permissions", "dry_run",
    "partial_failure", "rollback", "receipt_verification", "spend_boundary", "secret_boundary", "environment_binding", "digest",
    "operation_authorization",
  ];
  assert(JSON.stringify(Object.keys(contract).sort()) === JSON.stringify(fields.sort()), "delivery adapter contract fields mismatch");
  assert(contract.schema === DELIVERY_ADAPTER_SCHEMA && contract.version === 1, "delivery adapter contract identity is invalid");
  assert(contract.status === DELIVERY_ADAPTER_STATUS, "delivery adapter contract must remain prepared and inactive");
  requireId(contract.adapter_ref, "delivery adapter reference");
  requireId(contract.protocol, "delivery adapter protocol");
  const capabilities = sortedUnique(contract.capabilities, DELIVERY_ADAPTER_ACTIONS, "delivery adapter capabilities");
  const permissions = normalizePermissions(capabilities, contract.permissions);
  assert(JSON.stringify(contract.capabilities) === JSON.stringify(capabilities), "delivery adapter capabilities are not canonical");
  assert(JSON.stringify(contract.permissions) === JSON.stringify(permissions), "delivery adapter permissions are not canonical");
  requireRecord(contract.dry_run, "delivery adapter dry-run contract");
  assert(contract.dry_run.supported === true && contract.dry_run.external_effects === false && contract.dry_run.receipt === RECEIPT_CONTRACT, "delivery adapter dry-run contract is weakened");
  requireRecord(contract.partial_failure, "delivery adapter partial-failure contract");
  assert(contract.partial_failure.supported === true
    && JSON.stringify(contract.partial_failure.statuses) === JSON.stringify(["FAILED", "UNKNOWN"])
    && contract.partial_failure.retry === "EXPLICIT_NEW_CHOICE", "delivery adapter partial-failure contract is incomplete");
  requireRecord(contract.rollback, "delivery adapter rollback contract");
  assert(contract.rollback.supported === true
    && contract.rollback.authority === "RUNTIME_WITH_OWNER_BOUNDARY"
    && contract.rollback.identity === "EXACT_LAST_ACCEPTED_DEPLOYMENT"
    && contract.rollback.test_required === true, "delivery adapter rollback contract is weakened");
  assert(contract.receipt_verification === RECEIPT_CONTRACT, "delivery adapter receipt verification is invalid");
  requireRecord(contract.spend_boundary, "delivery adapter spend boundary");
  requireSha(contract.spend_boundary.policy_digest, "delivery adapter spend policy digest");
  assert(contract.spend_boundary.enforcement === "HOST_MUST_ENFORCE"
    && contract.spend_boundary.exceed_behavior === "FAIL_CLOSED", "delivery adapter spend boundary is weakened");
  assert(contract.secret_boundary === "HOST_LOCAL_ONLY", "delivery adapter secret boundary is weakened");
  assert(contract.environment_binding === "PROJECT_CONTEXT_BOUND", "delivery adapter environment binding is invalid");
  requireRecord(contract.operation_authorization, "delivery adapter operation authorization");
  rejectUnknown(contract.operation_authorization, ["authority", "cost_projection", "owner_decision", "route_change", "policy_change"], "delivery adapter operation authorization");
  assert(contract.operation_authorization.authority === "RUNTIME_ONLY"
    && contract.operation_authorization.cost_projection === "REQUIRED"
    && contract.operation_authorization.owner_decision === "REQUIRED_BEFORE_RUNTIME_AUTHORIZATION"
    && contract.operation_authorization.route_change === "FULL_COST_PROJECTION_AND_OWNER_DECISION"
    && contract.operation_authorization.policy_change === "RECOMPILE_POLICY_AND_REAUTHORIZE",
  "delivery adapter operation authorization is weakened");
  secretFree(contract, "delivery adapter contract");
  validateAdapterDigest(contract);
  return contract;
}

export function compileDeliveryAdapterContract({
  adapter_ref,
  protocol,
  capabilities = [...DELIVERY_ADAPTER_ACTIONS],
  permissions = undefined,
  policy_digest,
} = {}) {
  requireId(adapter_ref, "delivery adapter reference");
  requireId(protocol, "delivery adapter protocol");
  requireSha(policy_digest, "delivery adapter policy digest");
  const normalizedCapabilities = sortedUnique(capabilities, DELIVERY_ADAPTER_ACTIONS, "delivery adapter capabilities");
  const contract = {
    schema: DELIVERY_ADAPTER_SCHEMA,
    version: 1,
    status: DELIVERY_ADAPTER_STATUS,
    adapter_ref,
    protocol,
    capabilities: normalizedCapabilities,
    permissions: normalizePermissions(normalizedCapabilities, permissions),
    dry_run: {supported: true, external_effects: false, receipt: RECEIPT_CONTRACT},
    partial_failure: {supported: true, statuses: ["FAILED", "UNKNOWN"], retry: "EXPLICIT_NEW_CHOICE"},
    rollback: {supported: true, authority: "RUNTIME_WITH_OWNER_BOUNDARY", identity: "EXACT_LAST_ACCEPTED_DEPLOYMENT", test_required: true},
    receipt_verification: RECEIPT_CONTRACT,
    spend_boundary: {policy_digest, enforcement: "HOST_MUST_ENFORCE", exceed_behavior: "FAIL_CLOSED"},
    secret_boundary: "HOST_LOCAL_ONLY",
    environment_binding: "PROJECT_CONTEXT_BOUND",
    operation_authorization: {
      authority: "RUNTIME_ONLY",
      cost_projection: "REQUIRED",
      owner_decision: "REQUIRED_BEFORE_RUNTIME_AUTHORIZATION",
      route_change: "FULL_COST_PROJECTION_AND_OWNER_DECISION",
      policy_change: "RECOMPILE_POLICY_AND_REAUTHORIZE",
    },
    digest: null,
  };
  secretFree(contract, "delivery adapter contract");
  const digestBody = structuredClone(contract);
  delete digestBody.digest;
  contract.digest = canonicalDigest(digestBody);
  return validateDeliveryAdapterContract(contract);
}

export function validateDeliveryAdapterForAction(contract, action, policyDigest = undefined) {
  validateDeliveryAdapterContract(contract);
  assert(DELIVERY_ADAPTER_ACTIONS.includes(action), "delivery adapter action is invalid");
  assert(contract.capabilities.includes(action), "delivery adapter does not support the requested action");
  if (policyDigest !== undefined) {
    requireSha(policyDigest, "delivery policy digest");
    assert(contract.spend_boundary.policy_digest === policyDigest, "delivery adapter is bound to a different delivery policy");
  }
  return contract;
}
