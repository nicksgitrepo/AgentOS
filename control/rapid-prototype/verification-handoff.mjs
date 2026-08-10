#!/usr/bin/env node

/*
 * Fail-closed finalization for a bounded verification run.
 *
 * A check may fail, time out, or become unavailable.  None of those outcomes
 * may strand the run before it emits a typed terminal handoff.  The active
 * check is deliberately scoped outside the execution try/finally so cleanup
 * cannot lose the check that failed.
 */

import crypto from "node:crypto";

const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const OPAQUE_REF = /^opaque:[A-Za-z0-9:_-]+$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

export const VERIFICATION_HANDOFF_SCHEMA = "agentos.verification_handoff.v1";
export const VERIFICATION_SCHEDULER_REQUIRED = "SCHEDULER_REQUIRED";
export const VERIFICATION_CHECKS = Object.freeze([
  "bounded_scan",
  "focused_hostile",
  "full_direct_node_suite",
]);
export const VERIFICATION_HANDOFF_STATUSES = Object.freeze(["PASS", "FAILURE", "UNKNOWN"]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
  assert(value === value.trim(), `${label} must not have surrounding whitespace`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains control characters`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a complete SHA-256`);
}

function requireUtc(value, label) {
  requireString(value, label);
  assert(ISO_UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} must be UTC`);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
}

function digestWithout(value, field) {
  const body = structuredClone(value);
  body[field] = null;
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(body)), "utf8").digest("hex");
}

export function normalizeSchedulerTerminalReceipt(schedulerReceipt, {sourceCommit, sourceTree, requestId = null} = {}) {
  requireExactGitObject(sourceCommit, "scheduler source commit");
  requireExactGitObject(sourceTree, "scheduler source tree");
  const records = Array.isArray(schedulerReceipt)
    ? schedulerReceipt
    : schedulerReceipt?.receipts;
  if (Array.isArray(records)) {
    const checks = {};
    const requestIds = new Set();
    const jobIds = new Set();
    for (const record of records) {
      assert(isRecord(record), "scheduler terminal record is invalid", "SCHEDULER_REQUIRED");
      assert(record.schema === "agentos.hybrid_scheduler_result.v1" && record.version === 1, "scheduler terminal record identity is invalid", "SCHEDULER_REQUIRED");
      assert(record.status === "SUCCEEDED" && record.result === "PASS" && record.exit_code === 0, "scheduler terminal record did not pass", "SCHEDULER_REQUIRED");
      assert(record.candidate_commit === sourceCommit && record.candidate_tree_or_digest === sourceTree, "scheduler terminal record is not source-bound", "SCHEDULER_REQUIRED");
      requireSha(record.result_sha256, "scheduler terminal result digest");
      assert(record.result_sha256 === digestWithout(record, "result_sha256"), "scheduler terminal result digest mismatch", "SCHEDULER_REQUIRED");
      requireString(record.request_id, "scheduler terminal request ID");
      requireString(record.job_id, "scheduler terminal job ID");
      if (requestId === null) {
        assert(!requestIds.has(record.request_id), "scheduler terminal records are duplicated", "SCHEDULER_REQUIRED");
        requestIds.add(record.request_id);
      } else {
        assert(record.request_id === requestId, "scheduler terminal record is not bound to the admitted request", "SCHEDULER_REQUIRED");
      }
      assert(!jobIds.has(record.job_id), "scheduler terminal records are duplicated", "SCHEDULER_REQUIRED");
      jobIds.add(record.job_id);
      assert(VERIFICATION_CHECKS.includes(record.proof_scope) && !Object.hasOwn(checks, record.proof_scope), "scheduler terminal proof scope is not a required verification check", "SCHEDULER_REQUIRED");
      checks[record.proof_scope] = {
        status: "PASS",
        source_commit: sourceCommit,
        source_tree: sourceTree,
        evidence_sha256: record.result_sha256,
        exit_code: record.exit_code,
      };
    }
    for (const name of VERIFICATION_CHECKS) assert(Object.hasOwn(checks, name), `scheduler terminal receipt lacks check ${name}`, "SCHEDULER_REQUIRED");
    return {status: "PASS", source_commit: sourceCommit, source_tree: sourceTree, checks};
  }
  assert(isRecord(schedulerReceipt), "scheduler terminal receipt is required", "SCHEDULER_REQUIRED");
  assert(schedulerReceipt.status === "PASS"
    && schedulerReceipt.source_commit === sourceCommit
    && schedulerReceipt.source_tree === sourceTree,
  "scheduler terminal receipt is not source-bound",
  "SCHEDULER_REQUIRED");
  if (requestId !== null) assert(schedulerReceipt.request_id === requestId, "scheduler terminal receipt is not bound to the admitted request", "SCHEDULER_REQUIRED");
  const checks = schedulerReceipt.checks ?? schedulerReceipt.result?.checks ?? null;
  assert(isRecord(checks), "scheduler terminal receipt lacks an aggregate checks map", "SCHEDULER_REQUIRED");
  for (const name of VERIFICATION_CHECKS) {
    assert(Object.hasOwn(checks, name), `scheduler terminal receipt lacks check ${name}`, "SCHEDULER_REQUIRED");
    const normalized = normalizeCheckResult(name, checks[name], {source_commit: sourceCommit, source_tree: sourceTree});
    assert(normalized.status === "PASS", `scheduler terminal check ${name} did not pass`, "SCHEDULER_REQUIRED");
  }
  return {status: "PASS", source_commit: sourceCommit, source_tree: sourceTree, checks};
}

function requireExactGitObject(value, label) {
  requireString(value, label);
  assert(GIT_OBJECT.test(value), `${label} must be an exact 40-character lowercase Git identity`);
}

export function normalizeVerificationSourceBinding(sourceBinding) {
  assert(isRecord(sourceBinding), "verification source binding must be an object");
  for (const field of ["project_ref", "host_ref"]) {
    requireString(sourceBinding[field], `verification source ${field}`);
    assert(OPAQUE_REF.test(sourceBinding[field]), `verification source ${field} must be opaque`);
  }
  for (const field of ["source_commit", "source_tree"]) {
    requireExactGitObject(sourceBinding[field], `verification source ${field}`);
  }
  return Object.freeze({
    project_ref: sourceBinding.project_ref,
    host_ref: sourceBinding.host_ref,
    source_commit: sourceBinding.source_commit,
    source_tree: sourceBinding.source_tree,
  });
}

export function validateCleanVerificationSnapshot({expected, observed} = {}) {
  const expectedBinding = normalizeVerificationSourceBinding(expected);
  const observedBinding = normalizeVerificationSourceBinding(observed);
  for (const field of ["project_ref", "host_ref", "source_commit", "source_tree"]) {
    assert(observedBinding[field] === expectedBinding[field], `verification source snapshot ${field} differs from the attested source`);
  }
  const clean = observed?.clean === true || observed?.working_tree_status === "";
  assert(clean, "verification source snapshot is not clean");
  return Object.freeze({source_binding: observedBinding, clean: true});
}

export function runDirectNodeCheck() {
  const error = new Error("verification checks require the hybrid scheduler boundary");
  error.code = VERIFICATION_SCHEDULER_REQUIRED;
  throw error;
}

function validateSourceBinding(sourceBinding) {
  return normalizeVerificationSourceBinding(sourceBinding);
}

function normalizeStatus(value) {
  if (typeof value !== "string") return null;
  const status = value.trim().toUpperCase().replace(/[ -]+/gu, "_");
  if (status === "PASS" || status === "PASSED" || status === "SUCCESS") return "PASS";
  if (status === "FAIL" || status === "FAILED" || status === "ERROR") return "FAILURE";
  if (status === "UNKNOWN" || status === "UNAVAILABLE" || status === "UNPROVEN" || status === "TIMEOUT" || status === "TIMED_OUT") return "UNKNOWN";
  return null;
}

function emptyCheck(code = "NOT_RUN_AFTER_TERMINAL_FAILURE") {
  return {
    status: "UNKNOWN",
    code,
    evidence_sha256: null,
    source_commit: null,
    source_tree: null,
    exit_code: null,
  };
}

function normalizeCheckResult(name, result, sourceBinding) {
  if (!isRecord(result)) return emptyCheck("CHECK_RESULT_UNAVAILABLE");
  const status = normalizeStatus(result.status ?? result.outcome ?? result.result);
  if (status === null) return emptyCheck("CHECK_RESULT_UNAVAILABLE");
  const evidence = result.evidence_sha256 ?? result.result_sha256 ?? null;
  const commit = result.source_commit ?? null;
  const tree = result.source_tree ?? null;
  if (evidence !== null && !SHA256.test(evidence)) return emptyCheck("CHECK_EVIDENCE_INVALID");
  if (commit === null || tree === null || !GIT_OBJECT.test(commit) || !GIT_OBJECT.test(tree)) return emptyCheck("CHECK_SOURCE_UNAVAILABLE");
  if (commit !== sourceBinding.source_commit || tree !== sourceBinding.source_tree) {
    return {
      status: "FAILURE",
      code: "STALE_SOURCE_EVIDENCE",
      evidence_sha256: evidence,
      source_commit: commit,
      source_tree: tree,
      exit_code: Number.isSafeInteger(result.exit_code) ? result.exit_code : null,
    };
  }
  if (status === "PASS" && (evidence === null || result.exit_code !== 0)) return emptyCheck("CHECK_EVIDENCE_INCOMPLETE");
  return {
    status,
    code: status === "PASS" ? "CHECK_PASS" : (result.code ?? "CHECK_FAILED"),
    evidence_sha256: evidence,
    source_commit: commit,
    source_tree: tree,
    exit_code: Number.isSafeInteger(result.exit_code) ? result.exit_code : null,
  };
}

function overallStatus(checks) {
  const values = Object.values(checks);
  if (values.some((check) => check.status === "FAILURE")) return "FAILURE";
  if (values.some((check) => check.status === "UNKNOWN")) return "UNKNOWN";
  return "PASS";
}

function validateChecks(checks) {
  assert(isRecord(checks), "verification checks must be an object");
  assert(JSON.stringify(Object.keys(checks).sort()) === JSON.stringify([...VERIFICATION_CHECKS].sort()), "verification checks are incomplete or contain an unexpected check");
  for (const name of VERIFICATION_CHECKS) {
    const check = checks[name];
    assert(isRecord(check), `${name} check result must be an object`);
    assert(VERIFICATION_HANDOFF_STATUSES.includes(check.status), `${name} check status is invalid`);
    requireString(check.code, `${name} check code`);
    if (check.evidence_sha256 !== null) requireSha(check.evidence_sha256, `${name} check evidence`);
    if (check.source_commit !== null) assert(GIT_OBJECT.test(check.source_commit), `${name} check source commit is invalid`);
    if (check.source_tree !== null) assert(GIT_OBJECT.test(check.source_tree), `${name} check source tree is invalid`);
    if (check.exit_code !== null) assert(Number.isSafeInteger(check.exit_code), `${name} check exit code is invalid`);
  }
}

export function validateVerificationHandoff(handoff) {
  assert(isRecord(handoff), "verification handoff must be an object");
  assert(handoff.schema === VERIFICATION_HANDOFF_SCHEMA && handoff.version === 1, "verification handoff identity is invalid");
  assert(VERIFICATION_HANDOFF_STATUSES.includes(handoff.status), "verification handoff status is invalid");
  assert(handoff.terminal === true, "verification handoff must be terminal");
  validateSourceBinding(handoff.source_binding);
  validateChecks(handoff.checks);
  assert(isRecord(handoff.failure), "verification handoff failure is missing");
  if (handoff.failure.code !== null) requireString(handoff.failure.code, "verification handoff failure code");
  if (handoff.failure.check !== null) assert(VERIFICATION_CHECKS.includes(handoff.failure.check), "verification handoff failure check is invalid");
  if (handoff.failure.evidence_sha256 !== null) requireSha(handoff.failure.evidence_sha256, "verification handoff failure evidence");
  assert(handoff.stale_evidence_rejected === true, "stale verification evidence was not rejected");
  assert(handoff.acceptance === false, "verification handoff cannot accept its own result");
  assert(isRecord(handoff.protected_actions) && Object.values(handoff.protected_actions).every((value) => value === false), "verification protected actions are not disabled");
  requireString(handoff.next_action, "verification handoff next action");
  requireUtc(handoff.observed_at_utc, "verification handoff observation time");
  requireSha(handoff.handoff_sha256, "verification handoff digest");
  assert(handoff.handoff_sha256 === digestWithout(handoff, "handoff_sha256"), "verification handoff digest mismatch");
  return handoff;
}

export function compileVerificationHandoff({sourceBinding, checks, failure = null, observedAtUtc = new Date().toISOString()} = {}) {
  const source = validateSourceBinding(sourceBinding);
  validateChecks(checks);
  requireUtc(observedAtUtc, "verification handoff observation time");
  const status = overallStatus(checks);
  const firstFailureName = failure?.check ?? Object.entries(checks).find(([, check]) => check.status !== "PASS")?.[0] ?? null;
  const firstFailure = failure ?? (firstFailureName === null ? null : checks[firstFailureName]);
  const handoff = {
    schema: VERIFICATION_HANDOFF_SCHEMA,
    version: 1,
    status,
    terminal: true,
    source_binding: source,
    checks: structuredClone(checks),
    failure: {
      code: firstFailure?.code ?? null,
      check: firstFailureName,
      evidence_sha256: firstFailure?.evidence_sha256 ?? null,
    },
    stale_evidence_rejected: true,
    acceptance: false,
    protected_actions: {
      activation: false,
      acceptance: false,
      publication: false,
      deletion: false,
    },
    next_action: status === "PASS"
      ? "HOLD_FOR_INDEPENDENT_PRIVACY_CLEARANCE"
      : status === "UNKNOWN"
        ? "ROUTE_VERIFICATION_CAPABILITY_REPAIR"
        : "ROUTE_ONE_BOUNDED_REPAIR_THEN_FRESH_VERIFICATION",
    observed_at_utc: observedAtUtc,
    handoff_sha256: null,
  };
  handoff.handoff_sha256 = digestWithout(handoff, "handoff_sha256");
  return validateVerificationHandoff(handoff);
}

export async function runBoundedVerification({sourceBinding, runCheck = null, schedulerReceipt = null, schedulerAdmissionReceipt = null, observedAtUtc = new Date().toISOString()} = {}) {
  const source = validateSourceBinding(sourceBinding);
  const admittedRequestId = schedulerAdmissionReceipt?.request_id ?? null;
  validateSchedulerAdmissionReceipt(schedulerAdmissionReceipt, {candidateCommit: source.source_commit, candidateTree: source.source_tree, requestId: admittedRequestId});
  const normalizedSchedulerReceipt = normalizeSchedulerTerminalReceipt(schedulerReceipt, {sourceCommit: source.source_commit, sourceTree: source.source_tree, requestId: admittedRequestId});
  assert(typeof runCheck !== "function", "direct verification execution is forbidden", "SCHEDULER_REQUIRED");
  const checks = {};
  let activeCheck = null;
  let terminalFailure = null;

  try {
    for (const name of VERIFICATION_CHECKS) {
      activeCheck = name;
      try {
        const raw = normalizedSchedulerReceipt.checks?.[name] ?? null;
    assert(raw !== null, `scheduler terminal receipt lacks check ${name}`, "SCHEDULER_REQUIRED");
        const normalized = normalizeCheckResult(name, raw, source);
        checks[name] = normalized;
        if (normalized.status !== "PASS") {
          terminalFailure = {code: normalized.code, check: name, evidence_sha256: normalized.evidence_sha256};
          break;
        }
      } catch (error) {
        // Never persist command text.  The category is enough to route repair.
        const code = error?.code === VERIFICATION_SCHEDULER_REQUIRED
          ? VERIFICATION_SCHEDULER_REQUIRED
          : "CHECK_EXECUTION_FAILED";
        checks[name] = {
          ...emptyCheck(code),
          status: "FAILURE",
        };
        terminalFailure = {code, check: name, evidence_sha256: null};
        break;
      } finally {
        activeCheck = null;
      }
    }
  } catch {
    // Finalization itself is fail-closed and still emits a typed terminal handoff.
    const name = activeCheck ?? VERIFICATION_CHECKS[0];
    checks[name] = {
      ...emptyCheck("VERIFICATION_FINALIZATION_FAILED"),
      status: "FAILURE",
    };
    terminalFailure = {code: "VERIFICATION_FINALIZATION_FAILED", check: name, evidence_sha256: null};
  } finally {
    activeCheck = null;
  }

  for (const name of VERIFICATION_CHECKS) {
    if (!Object.hasOwn(checks, name)) checks[name] = emptyCheck();
  }
  return compileVerificationHandoff({sourceBinding: source, checks, failure: terminalFailure, observedAtUtc});
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("verification handoff finalizer loaded\n");
import {validateSchedulerAdmissionReceipt} from "../scheduler-admission.mjs";
