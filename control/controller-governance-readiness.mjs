#!/usr/bin/env node

/*
 * First bootstrap boundary for the persistent Controller.
 *
 * Governance is injected and verified before a Controller may accept work.
 * This module is project-agnostic: project bindings, Bootstrap handoffs, and
 * campaign work are deliberately outside this contract.
 */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";

export const CONTROLLER_GOVERNANCE_SCHEMA = "agentos.controller_governance.v1";
export const CONTROLLER_GOVERNANCE_READINESS_SCHEMA = "agentos.controller_governance_readiness.v1";
export const CONTROLLER_WORK_ACCEPTANCE_SCHEMA = "agentos.controller_work_acceptance.v1";
export const CONTROLLER_GOVERNANCE_VERSION = 1;

export const CONTROLLER_GOVERNANCE_GATE_IDS = Object.freeze([
  "CONTROLLER.GOVERNANCE.AUTHORITY",
  "CONTROLLER.GOVERNANCE.CUSTODY",
  "CONTROLLER.GOVERNANCE.EVIDENCE",
  "CONTROLLER.GOVERNANCE.HOSTILE_TESTS",
  "CONTROLLER.GOVERNANCE.IDENTITY",
  "CONTROLLER.GOVERNANCE.NO_SIDE_EFFECTS",
  "CONTROLLER.GOVERNANCE.SCOPE",
  "CONTROLLER.GOVERNANCE.STOP_CONDITIONS",
].sort(compareUtf8));

export const CONTROLLER_FORBIDDEN_CAPABILITIES = Object.freeze([
  "ACTIVATE_UNCLEARED_WORK",
  "ADMIT_INCOMPLETE_ROLE",
  "CHANGE_PROJECT_GOVERNANCE",
  "DEPLOY_OR_PUBLISH",
  "MUTATE_PRODUCT",
  "OVERRIDE_INDEPENDENT_CLEARANCE",
  "SPEND_MATERIAL_COST",
  "USE_CREDENTIALS_OR_PROVIDERS",
].sort(compareUtf8));

export const CONTROLLER_GOVERNANCE_READINESS_STATUSES = Object.freeze([
  "READY_TO_ACCEPT_WORK",
  "BLOCKED",
]);

export const CONTROLLER_GOVERNANCE_FAILURE_CODES = Object.freeze([
  "GOVERNANCE_MISSING",
  "GOVERNANCE_INVALID",
]);

const SHA256 = /^[0-9a-f]{64}$/u;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const GATE_ID = /^CONTROLLER\.GOVERNANCE\.[A-Z0-9_]+$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const PLACEHOLDER = /(?:^|[^A-Z])(TBD|TODO|FIXME|PLACEHOLDER|FILL[ _-]?ME|LATER)(?:$|[^A-Z])/iu;
const GOVERNANCE_KEYS = Object.freeze([
  "schema", "version", "role", "scope", "source_commit", "source_tree",
  "required_gate_ids", "gates", "forbidden_capabilities", "governance_sha256",
]);
const GATE_KEYS = Object.freeze([
  "gate_id", "status", "rule", "evidence_sha256", "hostile_fixture_ids", "authority", "stop_condition",
]);
const READINESS_KEYS = Object.freeze([
  "schema", "version", "controller_id", "injection_order", "observed_at_utc",
  "governance_sha256", "required_gate_ids", "verified_gate_ids", "status",
  "acceptance_state", "failure_code", "readiness_sha256",
]);
const ACCEPTANCE_KEYS = Object.freeze([
  "schema", "version", "controller_id", "readiness_sha256", "work_request_sha256",
  "status", "accepted_at_utc", "acceptance_sha256",
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected, label) {
  assert(isRecord(value), `${label} must be an object`);
  const actual = Object.keys(value).sort(compareUtf8);
  const required = [...expected].sort(compareUtf8);
  assert(JSON.stringify(actual) === JSON.stringify(required), `${label} fields mismatch`);
}

function requireToken(value, label) {
  assert(typeof value === "string" && TOKEN.test(value), `${label} must be a stable token`);
  assert(!PLACEHOLDER.test(value), `${label} cannot be a placeholder`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function requireUtc(value, label) {
  assert(typeof value === "string" && ISO_UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} must be UTC`);
}

function sortedUnique(values, label, {pattern = null, allowEmpty = false} = {}) {
  assert(Array.isArray(values), `${label} must be an array`);
  if (!allowEmpty) assert(values.length > 0, `${label} must not be empty`);
  assert(values.every((value) => typeof value === "string" && (pattern === null || pattern.test(value))), `${label} contains an invalid value`);
  const ordered = [...values].sort(compareUtf8);
  assert(new Set(ordered).size === ordered.length, `${label} must be unique`);
  assert(JSON.stringify(values) === JSON.stringify(ordered), `${label} must be sorted`);
  return values;
}

function digestWithout(value, field) {
  return canonicalDigest({...structuredClone(value), [field]: null});
}

function validateNonPlaceholderText(value, label, minimumLength) {
  assert(typeof value === "string" && value.trim().length >= minimumLength, `${label} is incomplete`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains control characters`);
  assert(!PLACEHOLDER.test(value), `${label} is a placeholder`);
}

export function validateControllerGovernance(governance) {
  exactKeys(governance, GOVERNANCE_KEYS, "Controller governance");
  assert(governance.schema === CONTROLLER_GOVERNANCE_SCHEMA && governance.version === CONTROLLER_GOVERNANCE_VERSION, "Controller governance identity is invalid");
  assert(governance.role === "AGENTOS_CONTROLLER", "Controller governance role is invalid");
  assert(governance.scope === "PROJECT_AGNOSTIC_CONTROL_PLANE", "Controller governance scope is invalid");
  requireToken(governance.source_commit, "Controller governance source commit");
  requireToken(governance.source_tree, "Controller governance source tree");
  sortedUnique(governance.required_gate_ids, "Controller governance required gates", {pattern: GATE_ID});
  assert(JSON.stringify(governance.required_gate_ids) === JSON.stringify(CONTROLLER_GOVERNANCE_GATE_IDS), "Controller governance required gates are incomplete");
  sortedUnique(governance.forbidden_capabilities, "Controller governance forbidden capabilities");
  assert(JSON.stringify(governance.forbidden_capabilities) === JSON.stringify(CONTROLLER_FORBIDDEN_CAPABILITIES), "Controller governance forbidden capabilities are incomplete");
  assert(Array.isArray(governance.gates) && governance.gates.length === CONTROLLER_GOVERNANCE_GATE_IDS.length, "Controller governance gates are incomplete");
  const seen = new Set();
  for (const gate of governance.gates) {
    exactKeys(gate, GATE_KEYS, "Controller governance gate");
    assert(GATE_ID.test(gate.gate_id) && CONTROLLER_GOVERNANCE_GATE_IDS.includes(gate.gate_id), "Controller governance gate id is invalid");
    assert(!seen.has(gate.gate_id), "Controller governance gate is duplicated");
    seen.add(gate.gate_id);
    assert(gate.status === "PASS", `Controller governance gate ${gate.gate_id} is not passing`);
    validateNonPlaceholderText(gate.rule, `Controller governance gate ${gate.gate_id} rule`, 24);
    requireSha(gate.evidence_sha256, `Controller governance gate ${gate.gate_id} evidence`);
    sortedUnique(gate.hostile_fixture_ids, `Controller governance gate ${gate.gate_id} hostile fixtures`, {pattern: TOKEN});
    assert(gate.authority === "PROJECT_AGNOSTIC_CONTROLLER", `Controller governance gate ${gate.gate_id} authority is invalid`);
    validateNonPlaceholderText(gate.stop_condition, `Controller governance gate ${gate.gate_id} stop condition`, 24);
  }
  assert(JSON.stringify([...seen].sort(compareUtf8)) === JSON.stringify(CONTROLLER_GOVERNANCE_GATE_IDS), "Controller governance gate coverage is incomplete");
  assert(JSON.stringify(governance.gates.map(({gate_id}) => gate_id)) === JSON.stringify(CONTROLLER_GOVERNANCE_GATE_IDS), "Controller governance gates must be sorted");
  requireSha(governance.governance_sha256, "Controller governance digest");
  assert(governance.governance_sha256 === digestWithout(governance, "governance_sha256"), "Controller governance digest mismatch");
  return governance;
}

export function compileControllerGovernance({sourceCommit, sourceTree, gates, forbiddenCapabilities = CONTROLLER_FORBIDDEN_CAPABILITIES} = {}) {
  const governance = {
    schema: CONTROLLER_GOVERNANCE_SCHEMA,
    version: CONTROLLER_GOVERNANCE_VERSION,
    role: "AGENTOS_CONTROLLER",
    scope: "PROJECT_AGNOSTIC_CONTROL_PLANE",
    source_commit: sourceCommit,
    source_tree: sourceTree,
    required_gate_ids: [...CONTROLLER_GOVERNANCE_GATE_IDS],
    gates: Array.isArray(gates) ? [...gates].sort((left, right) => compareUtf8(left.gate_id, right.gate_id)) : gates,
    forbidden_capabilities: [...forbiddenCapabilities].sort(compareUtf8),
    governance_sha256: null,
  };
  governance.governance_sha256 = digestWithout(governance, "governance_sha256");
  return validateControllerGovernance(governance);
}

function blockedReadiness({controllerId, observedAtUtc, failureCode}) {
  const readiness = {
    schema: CONTROLLER_GOVERNANCE_READINESS_SCHEMA,
    version: CONTROLLER_GOVERNANCE_VERSION,
    controller_id: controllerId,
    injection_order: 1,
    observed_at_utc: observedAtUtc,
    governance_sha256: null,
    required_gate_ids: [...CONTROLLER_GOVERNANCE_GATE_IDS],
    verified_gate_ids: [],
    status: "BLOCKED",
    acceptance_state: "WORK_REJECTED",
    failure_code: failureCode,
    readiness_sha256: null,
  };
  readiness.readiness_sha256 = digestWithout(readiness, "readiness_sha256");
  return validateControllerGovernanceReadiness(readiness);
}

export function validateControllerGovernanceReadiness(readiness) {
  exactKeys(readiness, READINESS_KEYS, "Controller governance readiness");
  assert(readiness.schema === CONTROLLER_GOVERNANCE_READINESS_SCHEMA && readiness.version === CONTROLLER_GOVERNANCE_VERSION, "Controller governance readiness identity is invalid");
  requireToken(readiness.controller_id, "Controller governance readiness controller");
  assert(readiness.injection_order === 1, "Controller governance must be injected first");
  requireUtc(readiness.observed_at_utc, "Controller governance readiness observation");
  sortedUnique(readiness.required_gate_ids, "Controller readiness required gates", {pattern: GATE_ID});
  assert(JSON.stringify(readiness.required_gate_ids) === JSON.stringify(CONTROLLER_GOVERNANCE_GATE_IDS), "Controller readiness required gates are incomplete");
  sortedUnique(readiness.verified_gate_ids, "Controller readiness verified gates", {pattern: GATE_ID, allowEmpty: true});
  requireSha(readiness.readiness_sha256, "Controller readiness digest");
  if (readiness.status === "READY_TO_ACCEPT_WORK") {
    requireSha(readiness.governance_sha256, "Controller readiness governance digest");
    assert(JSON.stringify(readiness.verified_gate_ids) === JSON.stringify(CONTROLLER_GOVERNANCE_GATE_IDS), "Controller readiness does not verify every gate");
    assert(readiness.acceptance_state === "WORK_ACCEPTANCE_ALLOWED", "Controller readiness acceptance state is invalid");
    assert(readiness.failure_code === null, "ready Controller readiness cannot carry a failure");
  } else {
    assert(readiness.status === "BLOCKED", "Controller readiness status is invalid");
    assert(readiness.governance_sha256 === null, "blocked Controller readiness cannot bind governance");
    assert(readiness.verified_gate_ids.length === 0, "blocked Controller readiness cannot verify gates");
    assert(readiness.acceptance_state === "WORK_REJECTED", "blocked Controller readiness must reject work");
    assert(CONTROLLER_GOVERNANCE_FAILURE_CODES.includes(readiness.failure_code), "blocked Controller readiness failure is invalid");
  }
  assert(readiness.readiness_sha256 === digestWithout(readiness, "readiness_sha256"), "Controller readiness digest mismatch");
  return readiness;
}

export function compileControllerGovernanceReadiness({controllerId, governance, observedAtUtc} = {}) {
  try {
    validateControllerGovernance(governance);
  } catch (error) {
    return blockedReadiness({
      controllerId,
      observedAtUtc,
      failureCode: governance === null || governance === undefined ? "GOVERNANCE_MISSING" : "GOVERNANCE_INVALID",
    });
  }
  const readiness = {
    schema: CONTROLLER_GOVERNANCE_READINESS_SCHEMA,
    version: CONTROLLER_GOVERNANCE_VERSION,
    controller_id: controllerId,
    injection_order: 1,
    observed_at_utc: observedAtUtc,
    governance_sha256: governance.governance_sha256,
    required_gate_ids: [...CONTROLLER_GOVERNANCE_GATE_IDS],
    verified_gate_ids: [...CONTROLLER_GOVERNANCE_GATE_IDS],
    status: "READY_TO_ACCEPT_WORK",
    acceptance_state: "WORK_ACCEPTANCE_ALLOWED",
    failure_code: null,
    readiness_sha256: null,
  };
  readiness.readiness_sha256 = digestWithout(readiness, "readiness_sha256");
  return validateControllerGovernanceReadiness(readiness);
}

export function compileControllerWorkAcceptance({readiness, workRequestSha256, acceptedAtUtc} = {}) {
  validateControllerGovernanceReadiness(readiness);
  assert(readiness.status === "READY_TO_ACCEPT_WORK", "Controller work is rejected until governance readiness passes");
  requireSha(workRequestSha256, "Controller work request digest");
  requireUtc(acceptedAtUtc, "Controller work acceptance time");
  const acceptance = {
    schema: CONTROLLER_WORK_ACCEPTANCE_SCHEMA,
    version: CONTROLLER_GOVERNANCE_VERSION,
    controller_id: readiness.controller_id,
    readiness_sha256: readiness.readiness_sha256,
    work_request_sha256: workRequestSha256,
    status: "ACCEPTED_AFTER_GOVERNANCE_READY",
    accepted_at_utc: acceptedAtUtc,
    acceptance_sha256: null,
  };
  acceptance.acceptance_sha256 = digestWithout(acceptance, "acceptance_sha256");
  return validateControllerWorkAcceptance(acceptance);
}

export function validateControllerWorkAcceptance(acceptance) {
  exactKeys(acceptance, ACCEPTANCE_KEYS, "Controller work acceptance");
  assert(acceptance.schema === CONTROLLER_WORK_ACCEPTANCE_SCHEMA && acceptance.version === CONTROLLER_GOVERNANCE_VERSION, "Controller work acceptance identity is invalid");
  requireToken(acceptance.controller_id, "Controller work acceptance controller");
  requireSha(acceptance.readiness_sha256, "Controller work acceptance readiness");
  requireSha(acceptance.work_request_sha256, "Controller work acceptance request");
  assert(acceptance.status === "ACCEPTED_AFTER_GOVERNANCE_READY", "Controller work acceptance status is invalid");
  requireUtc(acceptance.accepted_at_utc, "Controller work acceptance time");
  requireSha(acceptance.acceptance_sha256, "Controller work acceptance digest");
  assert(acceptance.acceptance_sha256 === digestWithout(acceptance, "acceptance_sha256"), "Controller work acceptance digest mismatch");
  return acceptance;
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("Controller governance readiness contract loaded\n");
