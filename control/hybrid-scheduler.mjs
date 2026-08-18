#!/usr/bin/env node

/*
 * Shared AgentOS hybrid scheduler.
 *
 * This is the mechanical side of the build boundary.  It does not decide
 * whether Product work is correct.  It only admits a typed candidate plan,
 * owns one durable resource lease at a time by default, rechecks candidate
 * identity immediately before execution, records bounded terminal state, and
 * releases only leases that belong to the current execution unit.
 *
 * The scheduler root is host-local authority state.  It is deliberately never
 * written into a persisted record.  Persisted requests contain opaque
 * worktree references, not private paths, credentials, or environment dumps.
 * A file-backed lease is mandatory. There is no in-memory fallback: every
 * caller must bind this service to a durable authority root.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  assertPersistedRecordSafe,
  canonicalDigest,
  canonicalJson,
} from "./content-addressing.mjs";
import {assertOperationalGlobalGovernanceContext} from "./global-governance-operational-context.mjs";

export const HYBRID_SCHEDULER_POLICY_SCHEMA = "agentos.hybrid_scheduler_policy.v1";
export const HYBRID_SCHEDULER_REQUEST_SCHEMA = "agentos.hybrid_scheduler_request.v1";
export const HYBRID_SCHEDULER_JOB_SCHEMA = "agentos.hybrid_scheduler_job.v1";
export const HYBRID_SCHEDULER_RESULT_SCHEMA = "agentos.hybrid_scheduler_result.v1";
export const HYBRID_SCHEDULER_VERSION = 1;

export const HYBRID_RESOURCE_CLASSES = Object.freeze([
  "AGENT_BUILD",
  "COMPILE_HEAVY",
  "RUNTIME_HEAVY",
  "DATABASE_EXCLUSIVE",
  "ARTIFACT_GENERATION",
  "IO_HEAVY",
  "NETWORK_BOUNDED",
  "LIGHTWEIGHT_SOURCE_CHECK",
]);

export const HYBRID_JOB_STATES = Object.freeze([
  "SUBMITTED",
  "VALIDATING",
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "INTERRUPTED",
]);

const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const IDENTIFIER = /^[A-Z][A-Z0-9._:-]*$/u;
const OPAQUE_REF = /^opaque:[a-z][a-z0-9._-]*:[0-9a-f]{64}$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const SHELL_EXECUTABLES = new Set(["sh", "bash", "zsh", "fish", "csh", "ksh", "cmd", "powershell", "pwsh"]);
const SCHEDULER_DIR = "scheduler-v1";
const DEFAULT_WAIT_MS = 30 * 60 * 1000;
const MAX_WAIT_MS = 24 * 60 * 60 * 1000;
const POLL_MS = 250;

function assert(condition, message, code = null) {
  if (!condition) {
    const error = new Error(message);
    if (code !== null) error.code = code;
    throw error;
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value, label) {
  assert(isRecord(value), `${label} must be an object`);
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains control characters`);
  assert(!value.includes("\\"), `${label} contains a private path separator`);
}

function requireIdentifier(value, label) {
  requireString(value, label);
  assert(IDENTIFIER.test(value), `${label} is not a stable identifier`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function requireCandidateIdentity(value, label) {
  assert(typeof value === "string" && (GIT_OBJECT.test(value) || SHA256.test(value) || value === "PRELIMINARY_DIAGNOSTIC"), `${label} is invalid`);
}

function requireUtc(value, label) {
  requireString(value, label);
  assert(ISO_UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} must be UTC`);
}

function exactKeys(value, keys, label) {
  requireRecord(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  assert(actual.length === expected.length && actual.every((key, index) => key === expected[index]), `${label} fields mismatch`);
}

function clone(value) {
  return structuredClone(value);
}

function digestWithout(value, field) {
  return canonicalDigest({...clone(value), [field]: null});
}

function schedulerError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function sleepSync(milliseconds) {
  const duration = Math.max(1, Math.min(milliseconds, 1000));
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, duration);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(1, Math.min(milliseconds, 1000))));
}

function opaqueRef(kind, value) {
  assert(/^[a-z][a-z0-9._-]*$/u.test(kind), "opaque scheduler reference kind is invalid");
  return `opaque:${kind}:${canonicalDigest(value)}`;
}

export function opaqueSchedulerWorktreeRef(worktreePath) {
  requireString(worktreePath, "scheduler worktree path");
  return opaqueRef("worktree", worktreePath);
}

function validateResourceClass(value, label) {
  requireString(value, label);
  assert(HYBRID_RESOURCE_CLASSES.includes(value), `${label} is not a supported resource class`);
}

function validateResourcePolicy(policy, label) {
  requireRecord(policy, label);
  exactKeys(policy, ["max_concurrent", "child_parallelism", "timeout_minutes"], label);
  for (const [value, field] of [[policy.max_concurrent, "max_concurrent"], [policy.child_parallelism, "child_parallelism"], [policy.timeout_minutes, "timeout_minutes"]]) {
    assert(Number.isSafeInteger(value) && value > 0, `${label}.${field} must be a positive integer`);
  }
  assert(policy.max_concurrent <= 32, `${label}.max_concurrent is unbounded`);
}

function defaultResourcePolicies() {
  return Object.fromEntries(HYBRID_RESOURCE_CLASSES.map((resourceClass) => [resourceClass, {
    max_concurrent: 1,
    child_parallelism: 1,
    timeout_minutes: 30,
  }]));
}

export function compileHybridSchedulerPolicy({
  resourceClasses = null,
  defaultResourceClass = "AGENT_BUILD",
  maxActivePlans = 64,
  policyRevision = "POLICY-1",
} = {}) {
  validateResourceClass(defaultResourceClass, "scheduler default resource class");
  requireIdentifier(policyRevision, "scheduler policy revision");
  assert(Number.isSafeInteger(maxActivePlans) && maxActivePlans > 0 && maxActivePlans <= 10000, "scheduler active-plan limit is invalid");
  const policies = defaultResourcePolicies();
  if (resourceClasses !== null) {
    requireRecord(resourceClasses, "scheduler resource classes");
    for (const [resourceClass, policy] of Object.entries(resourceClasses)) {
      validateResourceClass(resourceClass, "scheduler resource class");
      validateResourcePolicy(policy, `scheduler ${resourceClass}`);
      policies[resourceClass] = clone(policy);
    }
  }
  const policy = {
    schema: HYBRID_SCHEDULER_POLICY_SCHEMA,
    version: HYBRID_SCHEDULER_VERSION,
    status: "PREPARED_NOT_ACTIVATED",
    policy_revision: policyRevision,
    default_resource_class: defaultResourceClass,
    resource_classes: policies,
    queue: {
      one_active_plan_per_lane_per_class: true,
      semantic_deduplication: true,
      proof_subsumption: true,
      fail_fast_within_plan: true,
      max_active_plans: maxActivePlans,
    },
    candidate_binding: {
      require_tree_or_content_digest: true,
      cancel_when_stale: true,
      preliminary_diagnostic_not_reusable: true,
    },
    logs: {
      redact_secrets: true,
      preserve_terminal_diagnostics: true,
    },
    drain_mode: false,
    policy_sha256: null,
  };
  policy.policy_sha256 = digestWithout(policy, "policy_sha256");
  return validateHybridSchedulerPolicy(policy);
}

export function validateHybridSchedulerPolicy(policy) {
  exactKeys(policy, [
    "schema", "version", "status", "policy_revision", "default_resource_class", "resource_classes",
    "queue", "candidate_binding", "logs", "drain_mode", "policy_sha256",
  ], "hybrid scheduler policy");
  assert(policy.schema === HYBRID_SCHEDULER_POLICY_SCHEMA && policy.version === HYBRID_SCHEDULER_VERSION, "hybrid scheduler policy identity is invalid");
  assert(policy.status === "PREPARED_NOT_ACTIVATED", "hybrid scheduler policy must remain prepared and inactive");
  requireIdentifier(policy.policy_revision, "hybrid scheduler policy revision");
  validateResourceClass(policy.default_resource_class, "hybrid scheduler default resource class");
  requireRecord(policy.resource_classes, "hybrid scheduler resource policies");
  for (const resourceClass of HYBRID_RESOURCE_CLASSES) {
    assert(policy.resource_classes[resourceClass] !== undefined, `hybrid scheduler resource class is missing: ${resourceClass}`);
    validateResourcePolicy(policy.resource_classes[resourceClass], `hybrid scheduler ${resourceClass}`);
  }
  exactKeys(policy.queue, ["one_active_plan_per_lane_per_class", "semantic_deduplication", "proof_subsumption", "fail_fast_within_plan", "max_active_plans"], "hybrid scheduler queue policy");
  for (const field of ["one_active_plan_per_lane_per_class", "semantic_deduplication", "proof_subsumption", "fail_fast_within_plan"]) assert(policy.queue[field] === true, `hybrid scheduler queue policy must require ${field}`);
  assert(Number.isSafeInteger(policy.queue.max_active_plans) && policy.queue.max_active_plans > 0, "hybrid scheduler active-plan limit is invalid");
  exactKeys(policy.candidate_binding, ["require_tree_or_content_digest", "cancel_when_stale", "preliminary_diagnostic_not_reusable"], "hybrid scheduler candidate policy");
  for (const field of Object.keys(policy.candidate_binding)) assert(policy.candidate_binding[field] === true, `hybrid scheduler candidate policy must require ${field}`);
  exactKeys(policy.logs, ["redact_secrets", "preserve_terminal_diagnostics"], "hybrid scheduler log policy");
  assert(policy.logs.redact_secrets === true && policy.logs.preserve_terminal_diagnostics === true, "hybrid scheduler log policy is unsafe");
  assert(typeof policy.drain_mode === "boolean", "hybrid scheduler drain mode is invalid");
  requireSha(policy.policy_sha256, "hybrid scheduler policy digest");
  assert(policy.policy_sha256 === digestWithout(policy, "policy_sha256"), "hybrid scheduler policy digest mismatch");
  assertPersistedRecordSafe(policy);
  return policy;
}

const REQUEST_KEYS = [
  "schema", "version", "status", "request_id", "requester_id", "lane", "repository_id", "worktree_id",
  "candidate_commit", "candidate_tree_or_digest", "clean_state", "resource_class", "working_directory_ref",
  "command_argv", "toolchain_profile", "proof_class", "why_needed", "expected_proof", "coverage", "depends_on",
  "supersedes", "timeout_class", "cache_policy", "secret_policy", "semantic_key", "request_sha256",
];

function validateArgv(argv, label) {
  assert(Array.isArray(argv) && argv.length > 0 && argv.every((value) => typeof value === "string" && value.length > 0), `${label} must be a nonempty argument vector`);
  const executable = argv[0];
  assert(!SHELL_EXECUTABLES.has(path.basename(executable)), `${label} may not invoke a shell`);
  for (const value of argv) {
    assert(!/[\u0000\u001f\u007f]/u.test(value), `${label} contains control characters`);
    assert(!value.startsWith("/"), `${label} may not persist an absolute private path`);
    assert(!/(?:^|=)\/[^\s]*/u.test(value), `${label} contains an absolute private path`);
    assert(!/(?:^|\/)\.\.(?:\/|$)/u.test(value), `${label} escapes the admitted scope`);
  }
}

export function compileHybridSchedulerCommandDescriptor(argv) {
  assert(Array.isArray(argv) && argv.length > 0 && argv.every((value) => typeof value === "string" && value.length > 0), "scheduler runtime command argument vector is invalid");
  return argv.map((value) => /^-{1,2}[A-Za-z][A-Za-z0-9._:-]*$/u.test(value) ? value : `ARG-${canonicalDigest(value).slice(0, 32).toUpperCase()}`);
}

function validateAllowedScope(scope) {
  assert(Array.isArray(scope) && scope.length > 0, "scheduler allowed scope is required", "SCHEDULER_SCOPE_REQUIRED");
  const sorted = [...scope].sort();
  assert(JSON.stringify(scope) === JSON.stringify(sorted), "scheduler allowed scope must be sorted", "SCHEDULER_SCOPE_INVALID");
  assert(new Set(scope).size === scope.length, "scheduler allowed scope must be unique", "SCHEDULER_SCOPE_INVALID");
  for (const entry of scope) {
    requireString(entry, "scheduler allowed scope entry");
    assert(!entry.startsWith("/") && !entry.includes("\\"), "scheduler allowed scope may not contain private paths", "SCHEDULER_SCOPE_INVALID");
    assert(!/(?:^|\/)\.\.(?:\/|$)/u.test(entry), "scheduler allowed scope escapes its root", "SCHEDULER_SCOPE_INVALID");
  }
  return [...scope];
}

function argumentPathTokens(argv) {
  return argv.flatMap((value) => value.split(/\s+/u).filter(Boolean).map((token) => token.includes("=") ? token.slice(token.indexOf("=") + 1) : token))
    .filter((token) => token.includes("/") || token.startsWith("."));
}

function validateArgumentScope(argv, allowedScope) {
  for (const token of argumentPathTokens(argv)) {
    if (path.isAbsolute(token)) continue;
    assert(!token.startsWith("/") && !token.includes("\\"), "scheduler command path is outside the admitted worktree", "SCHEDULER_SCOPE_MISMATCH");
    assert(!/(?:^|\/)\.\.(?:\/|$)/u.test(token), "scheduler command path escapes the admitted scope", "SCHEDULER_SCOPE_MISMATCH");
    const normalized = path.posix.normalize(token);
    assert(allowedScope.some((scope) => scope === "." || normalized === scope || normalized.startsWith(`${scope}/`)), `scheduler command path is outside the allowed scope: ${token}`, "SCHEDULER_SCOPE_MISMATCH");
  }
}

function validateRuntimeAllowedScope(scope) {
  assert(Array.isArray(scope) && scope.length > 0, "scheduler runtime allowed scope is required", "SCHEDULER_RUNTIME_SCOPE_REQUIRED");
  const normalized = scope.map((value) => {
    requireString(value, "scheduler runtime allowed scope entry");
    assert(path.isAbsolute(value), "scheduler runtime allowed scope must be absolute", "SCHEDULER_RUNTIME_SCOPE_INVALID");
    return path.resolve(value);
  }).sort();
  assert(new Set(normalized).size === normalized.length, "scheduler runtime allowed scope must be unique", "SCHEDULER_RUNTIME_SCOPE_INVALID");
  return normalized;
}

function absolutePathTokens(argv) {
  return argv.flatMap((value) => {
    const tokens = [];
    if (path.isAbsolute(value)) tokens.push(value);
    for (const match of value.matchAll(/(?:^|=)(\/[^\s]+)/gu)) tokens.push(match[1]);
    return tokens;
  });
}

function validateRuntimeArgumentScope(argv, runtimeAllowedScope) {
  for (const token of absolutePathTokens(argv)) {
    const resolved = path.resolve(token);
    assert(runtimeAllowedScope.some((scope) => resolved === scope || resolved.startsWith(`${scope}${path.sep}`)), `scheduler runtime path is outside admitted custody: ${token}`, "SCHEDULER_CUSTODY_MISMATCH");
  }
}

function validateRuntimeArgv(argv, allowedScope, runtimeAllowedScope) {
  assert(Array.isArray(argv) && argv.length > 0 && argv.every((value) => typeof value === "string" && value.length > 0), "scheduler runtime command argument vector is invalid", "SCHEDULER_COMMAND_MISMATCH");
  assert(!SHELL_EXECUTABLES.has(path.basename(argv[0])), "scheduler runtime command may not invoke a shell", "SCHEDULER_COMMAND_MISMATCH");
  for (const value of argv) {
    assert(!/[\u0000-\u001f\u007f]/u.test(value), "scheduler runtime command contains control characters", "SCHEDULER_COMMAND_MISMATCH");
    assert(!value.includes("\\"), "scheduler runtime command contains a private path separator", "SCHEDULER_COMMAND_MISMATCH");
    assert(!/(?:^|\/)\.\.(?:\/|$)/u.test(value), "scheduler runtime command escapes its admitted scope", "SCHEDULER_SCOPE_MISMATCH");
  }
  validateRuntimeArgumentScope(argv, runtimeAllowedScope);
  validateArgumentScope(argv, allowedScope);
}

function validateExecutionAdmission(request, admission) {
  requireRecord(admission, "scheduler runtime admission");
  const effectiveArgv = admission.effectiveArgv;
  let runtimeAllowedScope = null;
  if (admission.runtimeAllowedScope !== undefined) {
    runtimeAllowedScope = validateRuntimeAllowedScope(admission.runtimeAllowedScope);
    validateRuntimeArgv(effectiveArgv, validateAllowedScope(admission.allowedScope), runtimeAllowedScope);
    assert(JSON.stringify(compileHybridSchedulerCommandDescriptor(effectiveArgv)) === JSON.stringify(request.command_argv), "scheduler effective argv differs from its privacy-safe admitted descriptor", "SCHEDULER_COMMAND_MISMATCH");
  } else {
    validateArgv(effectiveArgv, "scheduler effective command argument vector");
    assert(JSON.stringify(effectiveArgv) === JSON.stringify(request.command_argv), "scheduler effective argv differs from admitted command argv", "SCHEDULER_COMMAND_MISMATCH");
  }
  assert(admission.workingDirectoryRef === request.working_directory_ref, "scheduler working-directory custody differs from the admitted worktree reference", "SCHEDULER_CUSTODY_MISMATCH");
  const allowedScope = validateAllowedScope(admission.allowedScope);
  if (runtimeAllowedScope === null) validateArgumentScope(effectiveArgv, allowedScope);
  if (admission.workingDirectory !== undefined && admission.workingDirectory !== null) {
    requireString(admission.workingDirectory, "scheduler working directory");
    assert(path.isAbsolute(admission.workingDirectory), "scheduler working directory must be absolute", "SCHEDULER_CUSTODY_MISMATCH");
    assert(opaqueSchedulerWorktreeRef(admission.workingDirectory) === request.working_directory_ref, "scheduler working directory does not match its opaque worktree reference", "SCHEDULER_CUSTODY_MISMATCH");
    assert(fs.existsSync(admission.workingDirectory) && !fs.lstatSync(admission.workingDirectory).isSymbolicLink() && fs.statSync(admission.workingDirectory).isDirectory(), "scheduler working directory is not admitted custody", "SCHEDULER_CUSTODY_MISMATCH");
  }
  assert(typeof admission.dependencyPreflight === "function", "scheduler dependency preflight is required", "SCHEDULER_PREFLIGHT_REQUIRED");
  assert(typeof admission.runtimePreflight === "function", "scheduler runtime preflight is required", "SCHEDULER_PREFLIGHT_REQUIRED");
  return {...admission, effectiveArgv: [...effectiveArgv], allowedScope, runtimeAllowedScope};
}

function validatePreflightOutcome(outcome, label) {
  requireRecord(outcome, label);
  assert(["READY", "BLOCKED", "UNAVAILABLE", "MISMATCH"].includes(outcome.status), `${label} status is invalid`, "SCHEDULER_PREFLIGHT_FAILED");
  requireIdentifier(outcome.identity, `${label} identity`);
  assert(outcome.status === "READY", `${label} did not admit the request`, "SCHEDULER_PREFLIGHT_FAILED");
  return outcome;
}

function runPreflightSync(callback, label, context) {
  let outcome;
  try {
    outcome = callback(context);
  } catch (error) {
    throw schedulerError(error?.code ?? "SCHEDULER_PREFLIGHT_FAILED", `${label} failed closed`);
  }
  assert(!(outcome && typeof outcome.then === "function"), `${label} must be synchronous for runSync`, "SCHEDULER_PREFLIGHT_ASYNC");
  return validatePreflightOutcome(outcome, label);
}

async function runPreflight(callback, label, context) {
  let outcome;
  try {
    outcome = await callback(context);
  } catch (error) {
    throw schedulerError(error?.code ?? "SCHEDULER_PREFLIGHT_FAILED", `${label} failed closed`);
  }
  return validatePreflightOutcome(outcome, label);
}

function runAdmissionPreflightSync(request, admission) {
  const validated = validateExecutionAdmission(request, admission);
  const context = {request, admission: validated};
  runPreflightSync(validated.dependencyPreflight, "scheduler dependency preflight", context);
  runPreflightSync(validated.runtimePreflight, "scheduler runtime preflight", context);
  return validated;
}

async function runAdmissionPreflight(request, admission) {
  const validated = validateExecutionAdmission(request, admission);
  const context = {request, admission: validated};
  await runPreflight(validated.dependencyPreflight, "scheduler dependency preflight", context);
  await runPreflight(validated.runtimePreflight, "scheduler runtime preflight", context);
  return validated;
}

function validateStringList(values, label, {allowPaths = false} = {}) {
  assert(Array.isArray(values), `${label} must be an array`);
  const sorted = [...values].sort();
  assert(JSON.stringify(values) === JSON.stringify(sorted), `${label} must be sorted`);
  assert(new Set(values).size === values.length, `${label} must be unique`);
  for (const value of values) {
    requireString(value, `${label} entry`);
    if (!allowPaths) requireIdentifier(value, `${label} entry`);
  }
}

function schedulerSemanticDigest(request) {
  const semantic = {
    repository_id: request.repository_id,
    candidate_commit: request.candidate_commit,
    candidate_tree_or_digest: request.candidate_tree_or_digest,
    working_directory_ref: request.working_directory_ref,
    command_argv: request.command_argv,
    toolchain_profile: request.toolchain_profile,
    resource_class: request.resource_class,
    proof_class: request.proof_class,
    coverage: request.coverage,
    expected_proof: request.expected_proof,
  };
  // A native session is an execution identity, not reusable proof. Its
  // session readback cannot be reconstructed from a prior scheduler result.
  if (request.proof_class === "AGENT_SESSION") semantic.request_id = request.request_id;
  return canonicalDigest(semantic);
}

export function compileHybridSchedulerRequest({
  requestId,
  requesterId,
  lane,
  repositoryId,
  worktreeId,
  candidateCommit,
  candidateTreeOrDigest,
  cleanState,
  resourceClass,
  workingDirectoryRef,
  commandArgv,
  toolchainProfile,
  proofClass,
  whyNeeded,
  expectedProof,
  coverage = [],
  dependsOn = [],
  supersedes = [],
  timeoutClass = "BOUNDED",
  cachePolicy = "NO_SHARED_OUTPUT",
  secretPolicy = "REDACTED",
} = {}) {
  for (const [value, label] of [[requestId, "scheduler request ID"], [requesterId, "scheduler requester ID"], [lane, "scheduler lane"], [repositoryId, "scheduler repository ID"], [worktreeId, "scheduler worktree ID"], [toolchainProfile, "scheduler toolchain profile"], [proofClass, "scheduler proof class"], [whyNeeded, "scheduler reason"], [expectedProof, "scheduler expected proof"], [timeoutClass, "scheduler timeout class"], [cachePolicy, "scheduler cache policy"], [secretPolicy, "scheduler secret policy"]]) requireIdentifier(value, label);
  requireCandidateIdentity(candidateCommit, "scheduler candidate commit");
  requireCandidateIdentity(candidateTreeOrDigest, "scheduler candidate tree or digest");
  assert(typeof cleanState === "boolean", "scheduler candidate clean state is invalid");
  validateResourceClass(resourceClass, "scheduler resource class");
  assert(typeof workingDirectoryRef === "string" && OPAQUE_REF.test(workingDirectoryRef), "scheduler working directory must be opaque");
  validateArgv(commandArgv, "scheduler command argument vector");
  validateStringList(coverage, "scheduler coverage", {allowPaths: true});
  validateStringList(dependsOn, "scheduler dependencies");
  validateStringList(supersedes, "scheduler superseded requests");
  if (candidateCommit === "PRELIMINARY_DIAGNOSTIC") assert(cleanState === false, "preliminary scheduler diagnostics must be dirty or explicitly incomplete");
  const request = {
    schema: HYBRID_SCHEDULER_REQUEST_SCHEMA,
    version: HYBRID_SCHEDULER_VERSION,
    status: "SUBMITTED",
    request_id: requestId,
    requester_id: requesterId,
    lane,
    repository_id: repositoryId,
    worktree_id: worktreeId,
    candidate_commit: candidateCommit,
    candidate_tree_or_digest: candidateTreeOrDigest,
    clean_state: cleanState,
    resource_class: resourceClass,
    working_directory_ref: workingDirectoryRef,
    command_argv: [...commandArgv],
    toolchain_profile: toolchainProfile,
    proof_class: proofClass,
    why_needed: whyNeeded,
    expected_proof: expectedProof,
    coverage: [...coverage],
    depends_on: [...dependsOn],
    supersedes: [...supersedes],
    timeout_class: timeoutClass,
    cache_policy: cachePolicy,
    secret_policy: secretPolicy,
    semantic_key: null,
    request_sha256: null,
  };
  request.semantic_key = schedulerSemanticDigest(request);
  request.request_sha256 = digestWithout(request, "request_sha256");
  return validateHybridSchedulerRequest(request);
}

export function validateHybridSchedulerRequest(request) {
  exactKeys(request, REQUEST_KEYS, "hybrid scheduler request");
  assert(request.schema === HYBRID_SCHEDULER_REQUEST_SCHEMA && request.version === HYBRID_SCHEDULER_VERSION, "hybrid scheduler request identity is invalid");
  assert(request.status === "SUBMITTED", "hybrid scheduler request status is invalid");
  for (const [value, label] of [[request.request_id, "scheduler request ID"], [request.requester_id, "scheduler requester ID"], [request.lane, "scheduler lane"], [request.repository_id, "scheduler repository ID"], [request.worktree_id, "scheduler worktree ID"], [request.toolchain_profile, "scheduler toolchain profile"], [request.proof_class, "scheduler proof class"], [request.why_needed, "scheduler reason"], [request.expected_proof, "scheduler expected proof"], [request.timeout_class, "scheduler timeout class"], [request.cache_policy, "scheduler cache policy"], [request.secret_policy, "scheduler secret policy"]]) requireIdentifier(value, label);
  requireCandidateIdentity(request.candidate_commit, "scheduler candidate commit");
  requireCandidateIdentity(request.candidate_tree_or_digest, "scheduler candidate tree or digest");
  assert(typeof request.clean_state === "boolean", "scheduler clean state is invalid");
  validateResourceClass(request.resource_class, "scheduler resource class");
  assert(OPAQUE_REF.test(request.working_directory_ref), "scheduler working directory ref is invalid");
  validateArgv(request.command_argv, "scheduler command argument vector");
  validateStringList(request.coverage, "scheduler coverage", {allowPaths: true});
  validateStringList(request.depends_on, "scheduler dependencies");
  validateStringList(request.supersedes, "scheduler superseded requests");
  requireSha(request.semantic_key, "scheduler semantic key");
  requireSha(request.request_sha256, "scheduler request digest");
  assert(request.request_sha256 === digestWithout(request, "request_sha256"), "scheduler request digest mismatch");
  assert(request.semantic_key === schedulerSemanticDigest(request), "scheduler semantic key mismatch");
  assertPersistedRecordSafe(request);
  return request;
}

function nowUtc(clock) {
  const value = clock();
  requireUtc(value, "scheduler time");
  return value;
}

function jobId(request, observedAtUtc) {
  return `JOB-${canonicalDigest({request_sha256: request.request_sha256, observed_at_utc: observedAtUtc, pid: process.pid}).slice(0, 40).toUpperCase()}`;
}

function writeJsonAtomic(filePath, value) {
  const parent = path.dirname(filePath);
  fs.mkdirSync(parent, {recursive: true, mode: 0o700});
  if (fs.existsSync(parent)) {
    assert(!fs.lstatSync(parent).isSymbolicLink(), "scheduler state directory may not be a symlink");
  }
  if (fs.existsSync(filePath)) assert(!fs.lstatSync(filePath).isSymbolicLink(), "scheduler record may not be a symlink");
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.stage`;
  try {
    const handle = fs.openSync(temporary, "wx", 0o600);
    try {
      fs.writeFileSync(handle, `${canonicalJson(value)}\n`, "utf8");
      fs.fsyncSync(handle);
    } finally {
      fs.closeSync(handle);
    }
    fs.renameSync(temporary, filePath);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function writeJsonExclusive(filePath, value) {
  const parent = path.dirname(filePath);
  fs.mkdirSync(parent, {recursive: true, mode: 0o700});
  if (fs.existsSync(parent)) assert(!fs.lstatSync(parent).isSymbolicLink(), "scheduler state directory may not be a symlink");
  const handle = fs.openSync(filePath, "wx", 0o600);
  try {
    fs.writeFileSync(handle, `${canonicalJson(value)}\n`, "utf8");
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  assert(!fs.lstatSync(filePath).isSymbolicLink(), "scheduler record may not be a symlink");
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function pidAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function validateResolvedCandidate(request, resolved) {
  requireRecord(resolved, "scheduler resolved candidate");
  requireCandidateIdentity(resolved.commit, "resolved candidate commit");
  requireCandidateIdentity(resolved.tree, "resolved candidate tree");
  if (resolved.clean !== undefined) assert(typeof resolved.clean === "boolean", "resolved candidate clean state is invalid", "CANCELLED_STALE_CANDIDATE");
  if (request.candidate_commit === "PRELIMINARY_DIAGNOSTIC") {
    assert(resolved.tree === request.candidate_tree_or_digest, "scheduler preliminary candidate changed before dispatch", "CANCELLED_STALE_CANDIDATE");
    if (resolved.clean !== undefined) assert(resolved.clean === false, "scheduler diagnostic candidate changed before dispatch", "CANCELLED_DIAGNOSTIC_CANDIDATE");
    return;
  }
  assert(resolved.commit === request.candidate_commit && resolved.tree === request.candidate_tree_or_digest, "scheduler candidate changed before dispatch", "CANCELLED_STALE_CANDIDATE");
  if (request.clean_state === true && resolved.clean !== undefined) assert(resolved.clean === true, "scheduler candidate became dirty before dispatch", "CANCELLED_STALE_CANDIDATE");
}

function assertCompletionCandidate(request) {
  assert(
    request.clean_state === true && request.candidate_commit !== "PRELIMINARY_DIAGNOSTIC",
    "scheduler preliminary or diagnostic candidate cannot claim completion",
    "CANCELLED_DIAGNOSTIC_CANDIDATE",
  );
}

function candidateProofIsUnverified(error) {
  return ["CANCELLED_STALE_CANDIDATE", "CANCELLED_DIAGNOSTIC_CANDIDATE"].includes(error?.code);
}

function resultRecord({request, job, status, result, exitCode = null, terminalReason = null, observedAtUtc, diagnostics = null}) {
  const record = {
    schema: HYBRID_SCHEDULER_RESULT_SCHEMA,
    version: HYBRID_SCHEDULER_VERSION,
    request_id: request.request_id,
    job_id: job.job_id,
    requester_id: request.requester_id,
    candidate_commit: request.candidate_commit,
    candidate_tree_or_digest: request.candidate_tree_or_digest,
    resource_class: request.resource_class,
    command_argv: [...request.command_argv],
    status,
    result,
    exit_code: exitCode,
    started_at_utc: job.started_at_utc ?? job.queued_at_utc ?? job.submitted_at_utc,
    finished_at_utc: observedAtUtc,
    log_reference: job.log_reference,
    artifact_identities: [],
    terminal_reason: terminalReason,
    diagnosis: diagnostics === null ? null : {message_sha256: canonicalDigest(diagnostics)},
    proof_scope: request.expected_proof,
    result_sha256: null,
  };
  record.result_sha256 = digestWithout(record, "result_sha256");
  return record;
}

const JOB_KEYS = [
  "schema", "version", "job_id", "request_id", "request_sha256", "semantic_key", "lane", "resource_class",
  "status", "submitted_at_utc", "queued_at_utc", "started_at_utc", "finished_at_utc", "execution_unit_id",
  "exit_code", "log_reference", "artifact_identities", "terminal_reason", "job_sha256",
];

const RESULT_KEYS = [
  "schema", "version", "request_id", "job_id", "requester_id", "candidate_commit", "candidate_tree_or_digest",
  "resource_class", "command_argv", "status", "result", "exit_code", "started_at_utc", "finished_at_utc",
  "log_reference", "artifact_identities", "terminal_reason", "diagnosis", "proof_scope", "result_sha256",
];

function validateResult(result) {
  requireRecord(result, "hybrid scheduler result");
  exactKeys(result, RESULT_KEYS, "hybrid scheduler result");
  assert(result.schema === HYBRID_SCHEDULER_RESULT_SCHEMA && result.version === HYBRID_SCHEDULER_VERSION, "hybrid scheduler result identity is invalid");
  requireIdentifier(result.request_id, "scheduler result request ID");
  requireIdentifier(result.job_id, "scheduler result job ID");
  requireIdentifier(result.requester_id, "scheduler result requester ID");
  requireCandidateIdentity(result.candidate_commit, "scheduler result candidate commit");
  requireCandidateIdentity(result.candidate_tree_or_digest, "scheduler result candidate tree");
  validateResourceClass(result.resource_class, "scheduler result resource class");
  validateArgv(result.command_argv, "scheduler result command argument vector");
  assert(["SUCCEEDED", "FAILED", "CANCELLED", "INTERRUPTED"].includes(result.status), "scheduler result status is invalid");
  assert(["PASS", "FAIL", "UNTESTED"].includes(result.result), "scheduler result outcome is invalid");
  assert(result.exit_code === null || Number.isSafeInteger(result.exit_code), "scheduler result exit code is invalid");
  requireUtc(result.started_at_utc, "scheduler result start time");
  requireUtc(result.finished_at_utc, "scheduler result finish time");
  if (result.log_reference !== null) requireString(result.log_reference, "scheduler result log reference");
  assert(Array.isArray(result.artifact_identities), "scheduler result artifacts are invalid");
  if (result.terminal_reason !== null) requireIdentifier(result.terminal_reason, "scheduler result terminal reason");
  requireSha(result.result_sha256, "scheduler result digest");
  assert(result.result_sha256 === digestWithout(result, "result_sha256"), "scheduler result digest mismatch");
  assertPersistedRecordSafe(result);
  return result;
}

function activeStatuses() {
  return new Set(["SUBMITTED", "VALIDATING", "QUEUED", "RUNNING"]);
}

function jobPath(root, id) {
  return path.join(root, "jobs", `${id}.json`);
}

function requestPath(root, id) {
  return path.join(root, "requests", `${id}.json`);
}

function semanticPath(root, key) {
  return path.join(root, "semantic", `${key}.json`);
}

function admissionLockPath(root, key) {
  return path.join(root, "locks", `${key}.json`);
}

function leasePath(root, resourceClass, slot) {
  return path.join(root, "leases", `${resourceClass}-${slot}.json`);
}

function createJob(request, observedAtUtc) {
  const job = {
    schema: HYBRID_SCHEDULER_JOB_SCHEMA,
    version: HYBRID_SCHEDULER_VERSION,
    job_id: jobId(request, observedAtUtc),
    request_id: request.request_id,
    request_sha256: request.request_sha256,
    semantic_key: request.semantic_key,
    lane: request.lane,
    resource_class: request.resource_class,
    status: "SUBMITTED",
    submitted_at_utc: observedAtUtc,
    queued_at_utc: null,
    started_at_utc: null,
    finished_at_utc: null,
    execution_unit_id: null,
    exit_code: null,
    log_reference: null,
    artifact_identities: [],
    terminal_reason: null,
    job_sha256: null,
  };
  job.job_sha256 = digestWithout(job, "job_sha256");
  return job;
}

function updateJob(job, changes) {
  const next = {...clone(job), ...clone(changes), job_sha256: null};
  next.job_sha256 = digestWithout(next, "job_sha256");
  return next;
}

function validateJob(job) {
  requireRecord(job, "hybrid scheduler job");
  exactKeys(job, JOB_KEYS, "hybrid scheduler job");
  assert(job.schema === HYBRID_SCHEDULER_JOB_SCHEMA && job.version === HYBRID_SCHEDULER_VERSION, "hybrid scheduler job identity is invalid");
  for (const [value, label] of [[job.job_id, "scheduler job ID"], [job.request_id, "scheduler job request ID"], [job.request_sha256, "scheduler job request digest"], [job.semantic_key, "scheduler job semantic key"], [job.lane, "scheduler job lane"]]) requireString(value, label);
  validateResourceClass(job.resource_class, "scheduler job resource class");
  assert(HYBRID_JOB_STATES.includes(job.status), "scheduler job status is invalid");
  requireUtc(job.submitted_at_utc, "scheduler job submit time");
  if (job.queued_at_utc !== null) requireUtc(job.queued_at_utc, "scheduler job queue time");
  if (job.started_at_utc !== null) requireUtc(job.started_at_utc, "scheduler job start time");
  if (job.finished_at_utc !== null) requireUtc(job.finished_at_utc, "scheduler job finish time");
  if (job.execution_unit_id !== null) requireIdentifier(job.execution_unit_id, "scheduler execution unit");
  assert(job.exit_code === null || Number.isSafeInteger(job.exit_code), "scheduler job exit code is invalid");
  if (job.log_reference !== null) requireString(job.log_reference, "scheduler job log reference");
  assert(Array.isArray(job.artifact_identities), "scheduler job artifacts are invalid");
  if (job.terminal_reason !== null) requireIdentifier(job.terminal_reason, "scheduler job terminal reason");
  requireSha(job.job_sha256, "scheduler job digest");
  assert(job.job_sha256 === digestWithout(job, "job_sha256"), "scheduler job digest mismatch");
  assertPersistedRecordSafe(job);
  return job;
}

function collectJobs(root) {
  const directory = path.join(root, "jobs");
  if (!fs.existsSync(directory)) return [];
  assert(!fs.lstatSync(directory).isSymbolicLink(), "scheduler jobs directory may not be a symlink");
  return fs.readdirSync(directory).filter((name) => name.endsWith(".json")).sort().map((name) => validateJob(readJson(path.join(directory, name))));
}

function ensureSchedulerRoot(authorityRoot) {
  assert(authorityRoot !== null && authorityRoot !== undefined, "scheduler authority root is required", "SCHEDULER_AUTHORITY_REQUIRED");
  requireString(authorityRoot, "scheduler authority root");
  assert(path.isAbsolute(authorityRoot), "scheduler authority root must be absolute");
  fs.mkdirSync(authorityRoot, {recursive: true, mode: 0o700});
  assert(!fs.lstatSync(authorityRoot).isSymbolicLink(), "scheduler authority root may not be a symlink");
  const root = path.join(authorityRoot, SCHEDULER_DIR);
  fs.mkdirSync(root, {recursive: true, mode: 0o700});
  assert(!fs.lstatSync(root).isSymbolicLink(), "scheduler root may not be a symlink");
  return root;
}

function leaseIsStale(filePath, lease) {
  if (!isRecord(lease) || !Number.isSafeInteger(lease.pid)) return true;
  if (pidAlive(lease.pid)) return false;
  return true;
}

function acquireFileLeaseSync(root, request, policy, waitMs, clock) {
  const resourcePolicy = policy.resource_classes[request.resource_class];
  const deadline = Date.now() + waitMs;
  while (Date.now() <= deadline) {
    for (let slot = 0; slot < resourcePolicy.max_concurrent; slot += 1) {
      const filePath = leasePath(root, request.resource_class, slot);
      const lease = {
        schema: "agentos.hybrid_scheduler_lease.v1",
        version: 1,
        job_id: null,
        request_id: request.request_id,
        resource_class: request.resource_class,
        pid: process.pid,
        acquired_at_utc: nowUtc(clock),
      };
      try {
        lease.job_id = request.request_id;
        writeJsonExclusive(filePath, lease);
        return {filePath, lease};
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        const existing = readJson(filePath);
        if (leaseIsStale(filePath, existing)) {
          try {
            if (fs.existsSync(filePath) && !fs.lstatSync(filePath).isSymbolicLink()) fs.unlinkSync(filePath);
          } catch {
            // Another scheduler instance won the recovery race. Recheck below.
          }
        }
      }
    }
    sleepSync(POLL_MS);
  }
  throw schedulerError("SCHEDULER_CAPACITY_HOLD", `scheduler capacity is exhausted for ${request.resource_class}`);
}

async function acquireFileLease(root, request, policy, waitMs, clock) {
  const resourcePolicy = policy.resource_classes[request.resource_class];
  const deadline = Date.now() + waitMs;
  while (Date.now() <= deadline) {
    for (let slot = 0; slot < resourcePolicy.max_concurrent; slot += 1) {
      const filePath = leasePath(root, request.resource_class, slot);
      const lease = {
        schema: "agentos.hybrid_scheduler_lease.v1",
        version: 1,
        job_id: request.request_id,
        request_id: request.request_id,
        resource_class: request.resource_class,
        pid: process.pid,
        acquired_at_utc: nowUtc(clock),
      };
      try {
        writeJsonExclusive(filePath, lease);
        return {filePath, lease};
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        const existing = readJson(filePath);
        if (leaseIsStale(filePath, existing)) {
          try {
            if (fs.existsSync(filePath) && !fs.lstatSync(filePath).isSymbolicLink()) fs.unlinkSync(filePath);
          } catch {
            // Another scheduler instance won the recovery race. Recheck below.
          }
        }
      }
    }
    await sleep(POLL_MS);
  }
  throw schedulerError("SCHEDULER_CAPACITY_HOLD", `scheduler capacity is exhausted for ${request.resource_class}`);
}

function releaseFileLease(leaseRecord) {
  if (leaseRecord === null) return;
  if (!fs.existsSync(leaseRecord.filePath)) return;
  if (fs.lstatSync(leaseRecord.filePath).isSymbolicLink()) throw schedulerError("SCHEDULER_UNSAFE_STATE", "scheduler lease is a symlink");
  const existing = readJson(leaseRecord.filePath);
  if (existing?.request_id !== leaseRecord.lease.request_id || existing?.pid !== process.pid) return;
  fs.unlinkSync(leaseRecord.filePath);
}

function markJob(root, job, changes) {
  const next = validateJob(updateJob(job, changes));
  writeJsonAtomic(jobPath(root, next.job_id), next);
  return next;
}

function persistRequest(root, request) {
  const target = requestPath(root, request.request_id);
  const existing = readJson(target);
  if (existing !== null) {
    validateHybridSchedulerRequest(existing);
    assert(existing.request_sha256 === request.request_sha256, "scheduler request ID was reused for a different request", "SCHEDULER_REQUEST_ID_COLLISION");
    return;
  }
  try {
    writeJsonExclusive(target, request);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const raced = readJson(target);
    assert(raced !== null, "scheduler request record disappeared during admission", "SCHEDULER_INCOMPLETE_RECORD");
    validateHybridSchedulerRequest(raced);
    assert(raced.request_sha256 === request.request_sha256, "scheduler request ID was reused for a different request", "SCHEDULER_REQUEST_ID_COLLISION");
  }
}

function acquireAdmissionLock(root, request, clock) {
  const filePath = admissionLockPath(root, request.semantic_key);
  const lock = {
    schema: "agentos.hybrid_scheduler_admission_lock.v1",
    version: 1,
    semantic_key: request.semantic_key,
    pid: process.pid,
    acquired_at_utc: nowUtc(clock),
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeJsonExclusive(filePath, lock);
      return {filePath, lock};
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const existing = readJson(filePath);
      if (!leaseIsStale(filePath, existing)) break;
      try {
        if (fs.existsSync(filePath) && !fs.lstatSync(filePath).isSymbolicLink()) fs.unlinkSync(filePath);
      } catch {}
    }
  }
  throw schedulerError("SCHEDULER_QUEUE_ADMISSION_HOLD", "scheduler admission lock is held by another process");
}

function releaseAdmissionLock(lockRecord) {
  if (!fs.existsSync(lockRecord.filePath)) return;
  if (fs.lstatSync(lockRecord.filePath).isSymbolicLink()) throw schedulerError("SCHEDULER_UNSAFE_STATE", "scheduler admission lock is a symlink");
  const existing = readJson(lockRecord.filePath);
  if (existing?.semantic_key !== lockRecord.lock.semantic_key || existing?.pid !== process.pid) return;
  fs.unlinkSync(lockRecord.filePath);
}

function recoverAdmissionLocks(root) {
  const directory = path.join(root, "locks");
  if (!fs.existsSync(directory)) return;
  assert(!fs.lstatSync(directory).isSymbolicLink(), "scheduler locks directory may not be a symlink");
  for (const name of fs.readdirSync(directory).filter((value) => value.endsWith(".json"))) {
    const filePath = path.join(directory, name);
    const lock = readJson(filePath);
    if (leaseIsStale(filePath, lock)) {
      try {
        if (fs.existsSync(filePath) && !fs.lstatSync(filePath).isSymbolicLink()) fs.unlinkSync(filePath);
      } catch {}
    }
  }
}

function requestJobDuplicate(root, request, clock) {
  persistRequest(root, request);
  const lock = acquireAdmissionLock(root, request, clock);
  try {
    const indexPath = semanticPath(root, request.semantic_key);
    const existingIndex = readJson(indexPath);
    if (existingIndex === null) {
      const job = createJob(request, nowUtc(clock));
      try {
      writeJsonAtomic(jobPath(root, job.job_id), job);
      writeJsonExclusive(indexPath, {schema: "agentos.hybrid_scheduler_semantic_index.v1", version: 1, semantic_key: request.semantic_key, job_id: job.job_id});
        return {job, duplicate: false};
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
      }
    }
    const index = readJson(indexPath);
    assert(index?.job_id, "scheduler semantic index is malformed");
    const persistedJob = readJson(jobPath(root, index.job_id));
    assert(persistedJob !== null, "scheduler semantic index points to a missing job; manual recovery is required", "SCHEDULER_INCOMPLETE_RECORD");
    const job = validateJob(persistedJob);
    return {job, duplicate: true};
  } finally {
    releaseAdmissionLock(lock);
  }
}

function hasLiveLeaseForJob(root, job) {
  for (let slot = 0; slot < 32; slot += 1) {
    const target = leasePath(root, job.resource_class, slot);
    if (!fs.existsSync(target)) continue;
    const lease = readJson(target);
    if (lease?.request_id !== job.request_id) continue;
    if (pidAlive(lease.pid)) return true;
    if (!fs.lstatSync(target).isSymbolicLink()) fs.unlinkSync(target);
  }
  return false;
}

function recoverInterruptedJobs(root, clock) {
  recoverAdmissionLocks(root);
  for (const job of collectJobs(root)) {
    if (job.status !== "RUNNING" || hasLiveLeaseForJob(root, job)) continue;
    const request = readJson(requestPath(root, job.request_id));
    assert(request !== null, "scheduler cannot recover a running job without its request record", "SCHEDULER_INCOMPLETE_RECORD");
    validateHybridSchedulerRequest(request);
    const finished = nowUtc(clock);
    const interrupted = markJob(root, job, {
      status: "INTERRUPTED",
      finished_at_utc: finished,
      terminal_reason: "SCHEDULER_PROCESS_CRASH",
    });
    const result = resultRecord({
      request,
      job: interrupted,
      status: "INTERRUPTED",
      result: "UNTESTED",
      terminalReason: "SCHEDULER_PROCESS_CRASH",
      observedAtUtc: finished,
      diagnostics: {message: "scheduler recovered an unfinished job after its resource lease disappeared"},
    });
    writeJsonAtomic(path.join(root, "results", `${interrupted.job_id}.json`), validateResult(result));
  }
}

function activePlanCount(root) {
  return collectJobs(root).filter((job) => activeStatuses().has(job.status)).length;
}

function activeLaneJob(root, request) {
  return collectJobs(root).find((job) => activeStatuses().has(job.status)
    && job.lane === request.lane
    && job.resource_class === request.resource_class) ?? null;
}

function waitForDuplicateSync(root, duplicateJob, waitMs) {
  const deadline = Date.now() + waitMs;
  let job = duplicateJob;
  while (Date.now() <= deadline && activeStatuses().has(job.status)) {
    sleepSync(POLL_MS);
    job = validateJob(readJson(jobPath(root, job.job_id)));
  }
  return job;
}

async function waitForDuplicate(root, duplicateJob, waitMs) {
  const deadline = Date.now() + waitMs;
  let job = duplicateJob;
  while (Date.now() <= deadline && activeStatuses().has(job.status)) {
    await sleep(POLL_MS);
    job = validateJob(readJson(jobPath(root, job.job_id)));
  }
  return job;
}

function reuseOrRejectDuplicate(root, request, job, waitMs, sync) {
  const settled = sync ? waitForDuplicateSync(root, job, waitMs) : null;
  if (!sync) return waitForDuplicate(root, job, waitMs).then((result) => reuseOrRejectDuplicate(root, request, result, waitMs, true));
  if (settled.status === "SUCCEEDED") {
    assert(request.clean_state === true && request.candidate_commit !== "PRELIMINARY_DIAGNOSTIC", "scheduler diagnostic candidate cannot reuse completion proof", "CANCELLED_DIAGNOSTIC_CANDIDATE");
    const persistedRequest = readJson(requestPath(root, settled.request_id));
    assert(persistedRequest !== null, "scheduler duplicate proof request is missing", "SCHEDULER_INCOMPLETE_RECORD");
    validateHybridSchedulerRequest(persistedRequest);
    assert(persistedRequest.clean_state === true && persistedRequest.candidate_commit !== "PRELIMINARY_DIAGNOSTIC", "scheduler persisted duplicate proof is diagnostic-only", "CANCELLED_DIAGNOSTIC_CANDIDATE");
    assert(persistedRequest.candidate_commit === request.candidate_commit && persistedRequest.candidate_tree_or_digest === request.candidate_tree_or_digest, "scheduler duplicate proof candidate differs", "CANCELLED_STALE_CANDIDATE");
    const result = validateResult(readJson(path.join(root, "results", `${settled.job_id}.json`)));
    assert(result.request_id === settled.request_id && result.job_id === settled.job_id, "scheduler duplicate result identity differs", "SCHEDULER_INCOMPLETE_RECORD");
    assert(result.candidate_commit === persistedRequest.candidate_commit && result.candidate_tree_or_digest === persistedRequest.candidate_tree_or_digest && result.status === "SUCCEEDED" && result.result === "PASS", "scheduler duplicate result candidate is not reusable proof", "CANCELLED_DIAGNOSTIC_CANDIDATE");
    return {result, output: null, reused: true};
  }
  throw schedulerError("CANCELLED_DUPLICATE", `scheduler rejected duplicate proof for ${request.request_id}`);
}

function executeSync({root, policy, request, admission, execute, resolveCandidate, clock, waitMs}) {
  validateHybridSchedulerRequest(request);
  runAdmissionPreflightSync(request, admission);
  recoverInterruptedJobs(root, clock);
  if (policy.drain_mode) throw schedulerError("SCHEDULER_DRAINING", "scheduler is draining and is not accepting new work");
  assert(activePlanCount(root) < policy.queue.max_active_plans, "scheduler queue is overloaded", "SCHEDULER_QUEUE_OVERLOADED");
  const laneJob = activeLaneJob(root, request);
  if (laneJob !== null && laneJob.semantic_key !== request.semantic_key) throw schedulerError("SCHEDULER_LANE_CAPACITY_HOLD", `scheduler already has an active plan for ${request.lane}`);
  const submitted = requestJobDuplicate(root, request, clock);
  if (submitted.duplicate) return reuseOrRejectDuplicate(root, request, submitted.job, waitMs, true);
  let job = markJob(root, submitted.job, {status: "VALIDATING", queued_at_utc: nowUtc(clock)});
  try {
    validateResolvedCandidate(request, resolveCandidate?.());
    job = markJob(root, job, {status: "QUEUED"});
    const lease = acquireFileLeaseSync(root, request, policy, waitMs, clock);
    try {
      job = markJob(root, job, {status: "RUNNING", started_at_utc: nowUtc(clock), execution_unit_id: `EXEC-${process.pid}-${canonicalDigest(job.job_id).slice(0, 16).toUpperCase()}`});
      validateResolvedCandidate(request, resolveCandidate?.());
      const output = execute();
      assertCompletionCandidate(request);
      const finished = nowUtc(clock);
      job = markJob(root, job, {status: "SUCCEEDED", finished_at_utc: finished, exit_code: 0, terminal_reason: "COMPLETED"});
      const result = resultRecord({request, job, status: "SUCCEEDED", result: "PASS", exitCode: 0, terminalReason: "COMPLETED", observedAtUtc: finished});
      writeJsonAtomic(path.join(root, "results", `${job.job_id}.json`), validateResult(result));
      return {result, output, reused: false};
    } catch (error) {
      const stale = candidateProofIsUnverified(error);
      const interrupted = ["SCHEDULER_CAPACITY_HOLD", "SCHEDULER_DRAINING", "SCHEDULER_SERVICE_RESTART", "SCHEDULER_RESOURCE_PRESSURE"].includes(error?.code);
      const finished = nowUtc(clock);
      job = markJob(root, job, {status: stale ? "CANCELLED" : interrupted ? "INTERRUPTED" : "FAILED", finished_at_utc: finished, exit_code: Number.isSafeInteger(error?.status) ? error.status : null, terminal_reason: error?.code ?? "EXECUTION_FAILED"});
      const result = resultRecord({request, job, status: job.status, result: stale || interrupted ? "UNTESTED" : "FAIL", exitCode: job.exit_code, terminalReason: job.terminal_reason, observedAtUtc: finished, diagnostics: {message: String(error?.message ?? error)}});
      writeJsonAtomic(path.join(root, "results", `${job.job_id}.json`), validateResult(result));
      throw error;
    } finally {
      releaseFileLease(lease);
    }
  } catch (error) {
    if (!job.finished_at_utc) {
      const finished = nowUtc(clock);
      const stale = candidateProofIsUnverified(error);
      const interrupted = ["SCHEDULER_CAPACITY_HOLD", "SCHEDULER_DRAINING", "SCHEDULER_SERVICE_RESTART", "SCHEDULER_RESOURCE_PRESSURE", "SCHEDULER_LANE_CAPACITY_HOLD"].includes(error?.code);
      const status = stale ? "CANCELLED" : interrupted ? "INTERRUPTED" : "FAILED";
      const terminalReason = error?.code ?? "EXECUTION_FAILED";
      job = markJob(root, job, {status, finished_at_utc: finished, exit_code: Number.isSafeInteger(error?.status) ? error.status : null, terminal_reason: terminalReason});
      const result = resultRecord({request, job, status, result: stale || interrupted ? "UNTESTED" : "FAIL", exitCode: job.exit_code, terminalReason, observedAtUtc: finished, diagnostics: {message: String(error?.message ?? error)}});
      writeJsonAtomic(path.join(root, "results", `${job.job_id}.json`), validateResult(result));
    }
    throw error;
  }
}

async function executeAsync({root, policy, request, admission, execute, resolveCandidate, clock, waitMs}) {
  validateHybridSchedulerRequest(request);
  await runAdmissionPreflight(request, admission);
  recoverInterruptedJobs(root, clock);
  if (policy.drain_mode) throw schedulerError("SCHEDULER_DRAINING", "scheduler is draining and is not accepting new work");
  assert(activePlanCount(root) < policy.queue.max_active_plans, "scheduler queue is overloaded", "SCHEDULER_QUEUE_OVERLOADED");
  const laneJob = activeLaneJob(root, request);
  if (laneJob !== null && laneJob.semantic_key !== request.semantic_key) throw schedulerError("SCHEDULER_LANE_CAPACITY_HOLD", `scheduler already has an active plan for ${request.lane}`);
  const submitted = requestJobDuplicate(root, request, clock);
  if (submitted.duplicate) return reuseOrRejectDuplicate(root, request, submitted.job, waitMs, false);
  let job = markJob(root, submitted.job, {status: "VALIDATING", queued_at_utc: nowUtc(clock)});
  try {
    validateResolvedCandidate(request, resolveCandidate?.());
    job = markJob(root, job, {status: "QUEUED"});
    const lease = await acquireFileLease(root, request, policy, waitMs, clock);
    try {
      job = markJob(root, job, {status: "RUNNING", started_at_utc: nowUtc(clock), execution_unit_id: `EXEC-${process.pid}-${canonicalDigest(job.job_id).slice(0, 16).toUpperCase()}`});
      validateResolvedCandidate(request, resolveCandidate?.());
      const output = await execute();
      assertCompletionCandidate(request);
      const finished = nowUtc(clock);
      job = markJob(root, job, {status: "SUCCEEDED", finished_at_utc: finished, exit_code: 0, terminal_reason: "COMPLETED"});
      const result = resultRecord({request, job, status: "SUCCEEDED", result: "PASS", exitCode: 0, terminalReason: "COMPLETED", observedAtUtc: finished});
      writeJsonAtomic(path.join(root, "results", `${job.job_id}.json`), validateResult(result));
      return {result, output, reused: false};
    } catch (error) {
      const stale = candidateProofIsUnverified(error);
      const interrupted = ["SCHEDULER_CAPACITY_HOLD", "SCHEDULER_DRAINING", "SCHEDULER_SERVICE_RESTART", "SCHEDULER_RESOURCE_PRESSURE"].includes(error?.code);
      const finished = nowUtc(clock);
      job = markJob(root, job, {status: stale ? "CANCELLED" : interrupted ? "INTERRUPTED" : "FAILED", finished_at_utc: finished, exit_code: Number.isSafeInteger(error?.status) ? error.status : null, terminal_reason: error?.code ?? "EXECUTION_FAILED"});
      const result = resultRecord({request, job, status: job.status, result: stale || interrupted ? "UNTESTED" : "FAIL", exitCode: job.exit_code, terminalReason: job.terminal_reason, observedAtUtc: finished, diagnostics: {message: String(error?.message ?? error)}});
      writeJsonAtomic(path.join(root, "results", `${job.job_id}.json`), validateResult(result));
      throw error;
    } finally {
      releaseFileLease(lease);
    }
  } catch (error) {
    if (!job.finished_at_utc) {
      const finished = nowUtc(clock);
      const stale = candidateProofIsUnverified(error);
      const interrupted = ["SCHEDULER_CAPACITY_HOLD", "SCHEDULER_DRAINING", "SCHEDULER_SERVICE_RESTART", "SCHEDULER_RESOURCE_PRESSURE", "SCHEDULER_LANE_CAPACITY_HOLD"].includes(error?.code);
      const status = stale ? "CANCELLED" : interrupted ? "INTERRUPTED" : "FAILED";
      const terminalReason = error?.code ?? "EXECUTION_FAILED";
      job = markJob(root, job, {status, finished_at_utc: finished, exit_code: Number.isSafeInteger(error?.status) ? error.status : null, terminal_reason: terminalReason});
      const result = resultRecord({request, job, status, result: stale || interrupted ? "UNTESTED" : "FAIL", exitCode: job.exit_code, terminalReason, observedAtUtc: finished, diagnostics: {message: String(error?.message ?? error)}});
      writeJsonAtomic(path.join(root, "results", `${job.job_id}.json`), validateResult(result));
    }
    throw error;
  }
}

export function createHybridScheduler({
  authorityRoot,
  policy = compileHybridSchedulerPolicy(),
  clock = () => new Date().toISOString(),
  globalGovernanceContext,
  globalGovernanceAuthorityRoot,
  globalGovernanceBootstrapSha256,
} = {}) {
  assert(authorityRoot !== null && authorityRoot !== undefined, "hybrid scheduler requires a durable authority root", "SCHEDULER_AUTHORITY_REQUIRED");
  assertOperationalGlobalGovernanceContext(globalGovernanceContext, {authorityRoot: globalGovernanceAuthorityRoot, expectedRoleClass: "SCHEDULER", bootstrapSha256: globalGovernanceBootstrapSha256});
  validateHybridSchedulerPolicy(policy);
  assert(typeof clock === "function", "hybrid scheduler clock must be callable");
  const root = ensureSchedulerRoot(authorityRoot);

  const scheduler = {
    policy: () => clone(policy),
    globalGovernanceContext: () => globalGovernanceContext,
    root: () => root,
    runSync({request, admission, execute, resolveCandidate = null, waitMs = DEFAULT_WAIT_MS} = {}) {
      validateHybridSchedulerRequest(request);
      assert(typeof execute === "function", "hybrid scheduler execution callback must be callable");
      assert(Number.isSafeInteger(waitMs) && waitMs >= 0 && waitMs <= MAX_WAIT_MS, "hybrid scheduler wait limit is invalid");
      return executeSync({root, policy, request, admission, execute, resolveCandidate, clock, waitMs});
    },
    async run({request, admission, execute, resolveCandidate = null, waitMs = DEFAULT_WAIT_MS} = {}) {
      validateHybridSchedulerRequest(request);
      assert(typeof execute === "function", "hybrid scheduler execution callback must be callable");
      assert(Number.isSafeInteger(waitMs) && waitMs >= 0 && waitMs <= MAX_WAIT_MS, "hybrid scheduler wait limit is invalid");
      return executeAsync({root, policy, request, admission, execute, resolveCandidate, clock, waitMs});
    },
    inspect() {
      recoverInterruptedJobs(root, clock);
      const jobs = collectJobs(root);
      return {
        mode: "FILE_BACKED",
        active_jobs: jobs.filter((job) => activeStatuses().has(job.status)),
        terminal_jobs: jobs.filter((job) => !activeStatuses().has(job.status)),
        active_holders: jobs.filter((job) => job.status === "RUNNING").map((job) => ({job_id: job.job_id, resource_class: job.resource_class})),
        queue_depth: jobs.filter((job) => ["SUBMITTED", "VALIDATING", "QUEUED"].includes(job.status)).length,
        policy_sha256: policy.policy_sha256,
      };
    },
  };
  return Object.freeze(scheduler);
}

export function defaultHybridSchedulerPolicy() {
  return compileHybridSchedulerPolicy();
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("hybrid scheduler loaded\n");
