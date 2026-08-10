#!/usr/bin/env node

import crypto from "node:crypto";

export const BOOTSTRAP_CONTEXT_SCHEMA = "agentos.rapid_bootstrap_context.v1";
export const SOURCE_BINDING_VERIFICATION_SCHEMA = "agentos.rapid_source_binding_verification.v1";
export const SOURCE_BINDING_FIELDS = Object.freeze([
  "project_id",
  "cwd",
  "git_top_level",
  "source_commit",
  "source_tree",
]);
export const SOURCE_BINDING_STATUSES = Object.freeze(["MATCH", "SOURCE_BINDING_MISMATCH", "UNAVAILABLE"]);
export const BOUNDED_CHECK_STATUSES = Object.freeze(["PASS", "FAIL", "TIMEOUT", "UNAVAILABLE"]);

const OPTIONAL_SOURCE_BINDING_FIELDS = Object.freeze(["project_root", "git_common_directory"]);
const FIELD_ALIASES = Object.freeze({
  project_id: Object.freeze(["project_id", "projectId", "project"]),
  cwd: Object.freeze(["cwd", "current_working_directory", "currentWorkingDirectory"]),
  git_top_level: Object.freeze(["git_top_level", "gitTopLevel", "top_level", "topLevel", "git_root", "gitRoot"]),
  source_commit: Object.freeze(["source_commit", "sourceCommit", "head", "HEAD", "git_head", "gitHead", "commit"]),
  source_tree: Object.freeze(["source_tree", "sourceTree", "tree", "git_tree", "gitTree"]),
  project_root: Object.freeze(["project_root", "projectRoot", "workspace_root", "workspaceRoot"]),
  git_common_directory: Object.freeze(["git_common_directory", "gitCommonDirectory", "common_directory", "commonDirectory"]),
});
const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
const ABSOLUTE_PATH = /(?:^|[\s("'`])(?:\/|[A-Za-z]:[\\/]|\\\\)[^\s)]*/u;
const MAX_BINDING_VALUE_LENGTH = 4096;
const MAX_CHECKS = 16;
const MAX_CHECK_NAME_LENGTH = 96;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value)
      .sort((left, right) => Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")))
      .map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function bootstrapContextDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value)), "utf8").digest("hex");
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function requireCheckText(value, label, maxLength = MAX_CHECK_NAME_LENGTH) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
  assert(value.length <= maxLength, `${label} is too long for a bounded context`);
  assert(!CONTROL_CHARACTERS.test(value), `${label} contains control characters`);
  assert(!ABSOLUTE_PATH.test(value), `${label} contains a private absolute path`);
  return value;
}

function requireBindingText(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
  assert(value.length <= MAX_BINDING_VALUE_LENGTH, `${label} is too long for a bounded source binding`);
  assert(!CONTROL_CHARACTERS.test(value), `${label} contains control characters`);
  return value;
}

function unwrapBinding(value) {
  if (!isRecord(value)) return value;
  const directFieldPresent = Object.values(FIELD_ALIASES).some((aliases) => aliases.some((alias) => Object.hasOwn(value, alias)));
  if (!directFieldPresent && isRecord(value.source_binding)) return value.source_binding;
  return value;
}

function nestedValue(record, field) {
  if (!isRecord(record)) return {present: false, value: undefined};
  const aliases = FIELD_ALIASES[field];
  for (const alias of aliases) {
    if (Object.hasOwn(record, alias)) {
      const value = record[alias];
      if (field === "project_id" && isRecord(value)) {
        for (const nestedAlias of ["project_id", "projectId", "id"]) {
          if (Object.hasOwn(value, nestedAlias)) return {present: true, value: value[nestedAlias]};
        }
      }
      return {present: true, value};
    }
  }
  const git = isRecord(record.git) ? record.git : null;
  if (git !== null) {
    const gitAliases = {
      git_top_level: ["top_level", "topLevel", "root"],
      source_commit: ["head", "HEAD", "commit", "source_commit", "sourceCommit"],
      source_tree: ["tree", "source_tree", "sourceTree"],
      git_common_directory: ["common_directory", "commonDirectory", "common_dir", "commonDir"],
    }[field] ?? [];
    for (const alias of gitAliases) {
      if (Object.hasOwn(git, alias)) return {present: true, value: git[alias]};
    }
  }
  return {present: false, value: undefined};
}

function normalizeBinding(value, label) {
  const record = unwrapBinding(value);
  const normalized = {};
  const present = new Set();
  const invalid = [];
  if (!isRecord(record)) return {normalized, present, invalid: SOURCE_BINDING_FIELDS.map((field) => `${label}.${field}`)};
  for (const field of [...SOURCE_BINDING_FIELDS, ...OPTIONAL_SOURCE_BINDING_FIELDS]) {
    const entry = nestedValue(record, field);
    if (!entry.present) continue;
    present.add(field);
    try {
      requireBindingText(entry.value, `${label}.${field}`);
      if (["source_commit", "source_tree"].includes(field)) {
        assert(GIT_OBJECT.test(entry.value), `${label}.${field} must be a 40-character Git object`);
      }
      normalized[field] = entry.value;
    } catch {
      invalid.push(`${label}.${field}`);
    }
  }
  return {normalized, present, invalid};
}

function resolveBindingArguments(first, second) {
  if (second !== undefined) return {expected: first, observed: second};
  if (isRecord(first) && (Object.hasOwn(first, "expected") || Object.hasOwn(first, "observed")
    || Object.hasOwn(first, "expected_source_binding") || Object.hasOwn(first, "observed_source_binding")
    || Object.hasOwn(first, "expectedSourceBinding") || Object.hasOwn(first, "observedSourceBinding"))) {
    return {
      expected: first.expected ?? first.expected_source_binding ?? first.expectedSourceBinding,
      observed: first.observed ?? first.observed_source_binding ?? first.observedSourceBinding,
    };
  }
  return {expected: first, observed: undefined};
}

function resultDigest(result) {
  return bootstrapContextDigest({...result, result_sha256: null});
}

export function verifySourceBinding(expectedOrInput, observedMaybe) {
  const {expected, observed} = resolveBindingArguments(expectedOrInput, observedMaybe);
  const expectedReadback = normalizeBinding(expected, "expected");
  const observedReadback = normalizeBinding(observed, "observed");
  const fields = [...SOURCE_BINDING_FIELDS, ...OPTIONAL_SOURCE_BINDING_FIELDS.filter((field) => expectedReadback.present.has(field))];
  const missingFields = [];
  const invalidFields = [...expectedReadback.invalid, ...observedReadback.invalid];
  for (const field of fields) {
    if (!expectedReadback.present.has(field)) missingFields.push(`expected.${field}`);
    if (!observedReadback.present.has(field)) missingFields.push(`observed.${field}`);
  }
  const mismatchFields = fields.filter((field) => expectedReadback.present.has(field)
    && observedReadback.present.has(field)
    && !invalidFields.includes(`expected.${field}`)
    && !invalidFields.includes(`observed.${field}`)
    && expectedReadback.normalized[field] !== observedReadback.normalized[field]);
  const status = invalidFields.length > 0 || missingFields.length > 0
    ? "UNAVAILABLE"
    : mismatchFields.length > 0
      ? "SOURCE_BINDING_MISMATCH"
      : "MATCH";
  const bindingSha256 = bootstrapContextDigest({
    expected: expectedReadback.normalized,
    observed: observedReadback.normalized,
    checked_fields: fields,
    status,
  });
  const result = {
    schema: SOURCE_BINDING_VERIFICATION_SCHEMA,
    version: 1,
    status,
    ok: status === "MATCH",
    failure: status === "SOURCE_BINDING_MISMATCH"
      ? "WRONG_SOURCE_REPOSITORY / SOURCE_BINDING_MISMATCH"
      : status === "UNAVAILABLE"
        ? "REQUIRED_SOURCE_READBACK_UNAVAILABLE"
        : null,
    checked_fields: fields,
    missing_fields: [...new Set(missingFields)].sort(),
    invalid_fields: [...new Set(invalidFields)].sort(),
    mismatch_fields: mismatchFields,
    binding_sha256: bindingSha256,
    result_sha256: null,
  };
  result.result_sha256 = resultDigest(result);
  return result;
}

function resolveDigest(input, names, label) {
  for (const name of names) {
    if (Object.hasOwn(input, name)) {
      requireSha(input[name], label);
      return input[name];
    }
  }
  throw new Error(`${label} is required`);
}

function scanForPrivatePath(value, label, depth = 0) {
  if (typeof value === "string") {
    assert(!ABSOLUTE_PATH.test(value), `${label} contains a private absolute path`);
    return;
  }
  if (depth > 2 || value === null || typeof value !== "object") return;
  const entries = Array.isArray(value) ? value.entries() : Object.entries(value);
  let count = 0;
  for (const [key, child] of entries) {
    count += 1;
    assert(count <= 32, `${label} is not bounded`);
    scanForPrivatePath(child, `${label}.${key}`, depth + 1);
  }
}

function normalizeCheck(value, index) {
  if (typeof value === "string") {
    return {name: requireCheckText(value, `bounded check ${index} name`), status: "PASS", evidence_digest: null};
  }
  assert(isRecord(value), `bounded check ${index} must be an object or name`);
  scanForPrivatePath(value, `bounded check ${index}`);
  const name = value.name ?? value.check ?? value.id;
  const status = value.status ?? value.result ?? "PASS";
  const evidenceDigest = value.evidence_digest ?? value.evidenceDigest ?? null;
  requireCheckText(name, `bounded check ${index} name`);
  assert(BOUNDED_CHECK_STATUSES.includes(status), `bounded check ${index} status is invalid`);
  if (evidenceDigest !== null) requireSha(evidenceDigest, `bounded check ${index} evidence digest`);
  return {name, status, evidence_digest: evidenceDigest};
}

function normalizeChecks(value) {
  if (value === undefined || value === null) return [];
  const values = Array.isArray(value)
    ? value
    : isRecord(value)
      ? Object.entries(value).map(([name, check]) => isRecord(check) ? {name, ...check} : {name, status: check})
      : null;
  assert(values !== null, "bounded checks must be an array or object map");
  assert(values.length <= MAX_CHECKS, `bounded checks exceed the limit of ${MAX_CHECKS}`);
  return values.map(normalizeCheck);
}

function checkSummary(checks) {
  const summary = {total: checks.length, pass: 0, fail: 0, timeout: 0, unavailable: 0};
  for (const check of checks) {
    if (check.status === "PASS") summary.pass += 1;
    if (check.status === "FAIL") summary.fail += 1;
    if (check.status === "TIMEOUT") summary.timeout += 1;
    if (check.status === "UNAVAILABLE") summary.unavailable += 1;
  }
  return summary;
}

function contextStatus(sourceBinding, checks) {
  if (sourceBinding.status === "SOURCE_BINDING_MISMATCH") return "SOURCE_BINDING_MISMATCH";
  if (sourceBinding.status === "UNAVAILABLE") return "UNAVAILABLE";
  if (checks.length === 0 || checks.some(({status}) => ["TIMEOUT", "UNAVAILABLE"].includes(status))) return "UNAVAILABLE";
  if (checks.some(({status}) => status === "FAIL")) return "HARD_STOP";
  return "READY";
}

export function compileBootstrapContext(input = {}) {
  assert(isRecord(input), "bootstrap context input must be an object");
  const expected = input.expected_source_binding ?? input.expectedSourceBinding ?? input.expected;
  const observed = input.observed_source_binding ?? input.observedSourceBinding ?? input.observed;
  const sourceBinding = verifySourceBinding({expected, observed});
  const planDigest = resolveDigest(input, ["plan_digest", "planDigest", "launch_plan_digest", "launchPlanDigest"], "bootstrap plan digest");
  const contractDigest = resolveDigest(input, ["contract_digest", "contractDigest", "machine_contract_digest", "machineContractDigest", "rapid_machine_contract_digest", "rapidMachineContractDigest"], "bootstrap contract digest");
  const controllerDigest = input.native_session_controller_digest
    ?? input.nativeSessionControllerDigest
    ?? input.controller_digest
    ?? input.controllerDigest
    ?? null;
  if (controllerDigest !== null) requireSha(controllerDigest, "native session controller digest");
  const checks = normalizeChecks(input.bounded_checks ?? input.boundedChecks ?? input.checks);
  const status = contextStatus(sourceBinding, checks);
  const context = {
    schema: BOOTSTRAP_CONTEXT_SCHEMA,
    version: 1,
    status,
    portable: true,
    private_paths_included: false,
    source_binding: {
      status: sourceBinding.status,
      ok: sourceBinding.ok,
      failure: sourceBinding.failure,
      checked_fields: sourceBinding.checked_fields,
      missing_fields: sourceBinding.missing_fields,
      invalid_fields: sourceBinding.invalid_fields,
      mismatch_fields: sourceBinding.mismatch_fields,
      binding_sha256: sourceBinding.binding_sha256,
      verification_sha256: sourceBinding.result_sha256,
    },
    plan_digest: planDigest,
    contract_digest: contractDigest,
    native_session_controller_digest: controllerDigest,
    bounded_checks: checks,
    check_summary: checkSummary(checks),
    context_sha256: null,
  };
  context.context_sha256 = bootstrapContextDigest({...context, context_sha256: null});
  return context;
}

