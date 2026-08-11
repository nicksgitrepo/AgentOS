#!/usr/bin/env node

/*
 * Pre-work route admission. This boundary verifies host/session readbacks
 * before a consuming adapter is allowed to invoke work. It creates no host,
 * session, worker, worktree, Product file, or child task.
 */

import {assertPersistedRecordSafe, canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {
  compileEffectiveModelReadback,
  requireVerifiedEffectiveModel,
  validateEffectiveModelReadback,
  validateRoute,
  RoutingBoundaryError,
} from "./task-model-routing.mjs";

export const EXECUTION_ADMISSION_SCHEMA = "agentos.execution_admission.v1";

const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function requireString(value, label) {
  assertCondition(typeof value === "string" && value.length > 0 && value === value.trim(), `${label} must be a trimmed nonempty string`);
  assertCondition(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains control characters`);
  return value;
}

function requireIdentifier(value, label) {
  requireString(value, label);
  assertCondition(IDENTIFIER.test(value), `${label} is not a safe identifier`);
  return value;
}

function requireSha(value, label) {
  assertCondition(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
  return value;
}

function exactKeys(value, expected, label) {
  assertCondition(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  const actual = Object.keys(value).sort(compareUtf8);
  const keys = [...expected].sort(compareUtf8);
  assertCondition(JSON.stringify(actual) === JSON.stringify(keys), `${label} fields mismatch`);
}

function digestWithout(record, field) {
  return canonicalDigest({...record, [field]: null});
}

function validateAdmissionShape(admission) {
  exactKeys(admission, [
    "schema", "version", "status", "route_sha256", "readback_sha256", "reason_code", "execution_admitted",
    "product_acceptance", "protected_actions_enabled", "digest",
  ], "execution admission");
  assertCondition(admission.schema === EXECUTION_ADMISSION_SCHEMA && admission.version === 1, "execution admission identity is invalid");
  assertCondition(["ADMITTED", "UNAVAILABLE", "BLOCKED"].includes(admission.status), "execution admission status is invalid");
  requireSha(admission.route_sha256, "execution admission route_sha256");
  requireSha(admission.readback_sha256, "execution admission readback_sha256");
  requireIdentifier(admission.reason_code, "execution admission reason_code");
  assertCondition(typeof admission.execution_admitted === "boolean" && typeof admission.product_acceptance === "boolean" && typeof admission.protected_actions_enabled === "boolean", "execution admission booleans are invalid");
  assertCondition(admission.execution_admitted === (admission.status === "ADMITTED"), "execution admission status is inconsistent");
  assertCondition(admission.product_acceptance === false && admission.protected_actions_enabled === false, "execution admission crossed a protected boundary");
  assertCondition(admission.digest === digestWithout(admission, "digest"), "execution admission digest does not match content");
  return assertPersistedRecordSafe(admission) && admission;
}

export function compileExecutionAdmission({route, readback}) {
  validateRoute(route);
  validateEffectiveModelReadback(readback);
  assertCondition(readback.route_sha256 === route.digest, "execution admission route mismatch");
  const status = readback.status === "VERIFIED" ? "ADMITTED" : readback.status === "UNKNOWN" ? "UNAVAILABLE" : "BLOCKED";
  const admission = {
    schema: EXECUTION_ADMISSION_SCHEMA,
    version: 1,
    status,
    route_sha256: route.digest,
    readback_sha256: readback.digest,
    reason_code: status === "ADMITTED" ? "HOST_SESSION_READBACK_VERIFIED" : readback.reason_code,
    execution_admitted: status === "ADMITTED",
    product_acceptance: false,
    protected_actions_enabled: false,
    digest: null,
  };
  admission.digest = digestWithout(admission, "digest");
  return validateAdmissionShape(admission);
}

export function validateExecutionAdmission(admission) {
  return validateAdmissionShape(admission);
}

export function admitExecutionRoute({route, hostReadback = null, sessionReadback = null, observedAtUtc}) {
  validateRoute(route);
  const readback = compileEffectiveModelReadback({route, hostReadback, sessionReadback, observedAtUtc});
  const admission = compileExecutionAdmission({route, readback});
  return {admission, readback};
}

export function runAdmittedTask({route, hostReadback = null, sessionReadback = null, observedAtUtc, work}) {
  assertCondition(typeof work === "function", "admitted task work callback is required");
  const result = admitExecutionRoute({route, hostReadback, sessionReadback, observedAtUtc});
  if (!result.admission.execution_admitted) {
    throw new RoutingBoundaryError(result.admission.reason_code, result.admission.reason_code, result.admission);
  }
  requireVerifiedEffectiveModel(result.readback, route);
  return work({route, readback: result.readback, admission: result.admission});
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("task-routing-admission module loaded\n");

