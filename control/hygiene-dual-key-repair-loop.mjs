#!/usr/bin/env node

/*
 * Portable two-key repair governance.  Worker and Auditor bindings are
 * explicit runtime inputs; role names and task identifiers are never inferred
 * from a host roster or substituted by a general-purpose agent.
 */

import path from "node:path";
import {canonicalDigest} from "./content-addressing.mjs";

const SHA256 = /^[0-9a-f]{64}$/u;
const CONTENT_HASH = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function deny(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}

function record(value, label) {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
}

function string(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a non-empty string`);
}

function identifier(value, label) {
  string(value, label);
  assert(IDENTIFIER.test(value), `${label} is not a portable identifier`);
  return value;
}

function sha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
  return value;
}

function clone(value) {
  return structuredClone(value);
}

function digestBody(value, field) {
  return canonicalDigest({...value, [field]: null});
}

export const DUAL_KEY_REPAIR_LOOP_SCHEMA = "agentos.hygiene_dual_key_repair_loop.v1";
export const DUAL_KEY_REPAIR_LOOP_VERSION = 1;
export const DUAL_KEY_WORKER_ROLE = "AGENTOS.HYGIENE_REPAIR_WORKER";
export const DUAL_KEY_AUDITOR_ROLE = "AGENTOS.HYGIENE_AUDITOR";
export const DUAL_KEY_RUNTIME_ROLE = "AGENTOS.RUNTIME";
export const DUAL_KEY_CONTROLLER_ROLE = "AGENTOS.CONTROLLER";
export const DUAL_KEY_STATES = Object.freeze([
  "ISSUE_READY",
  "WORKING",
  "CANDIDATE_FROZEN",
  "AUDITING",
  "PASS",
  "REPAIR_REQUIRED",
  "RUNTIME_ONLY_DELIVERY_HANDOFF",
]);
export const DUAL_KEY_FORBIDDEN_SUBSTITUTIONS = Object.freeze([
  "AGENTOS.PROTOTYPER",
  "GENERAL_ROSTER_AUDITOR",
  "GENERAL_COMPLETE_ROSTER_AUDITOR",
]);
export const ZERO_RECOVERY_SCOPE_SCHEMA = "agentos.storage.zero_recovery_scope.v1";
export const ZERO_RECOVERY_SCOPE_SELECTION_DEFECT = "ZERO_RECOVERY_SCOPE_SELECTION_DEFECT";
export const ZERO_RECOVERY_SCOPE_HOSTILE_CASES = Object.freeze([
  "AGGREGATE_DIRECTORY_BYTES_MAPPED_TO_TINY_RECEIPT_FILES_DENIED",
  "AGGREGATE_ROOT_AND_SELECTED_CHILD_IDENTITIES_REQUIRED_SEPARATELY",
  "CHILD_SIZE_OR_TYPE_MISMATCH_DENIED",
  "EMPTY_SELECTED_OBJECT_SET_FORCES_ZERO_RECOVERY",
  "SELECTED_RECOVERY_SUM_CANNOT_EXCEED_EXACT_ELIGIBLE_CHILD_SUM",
]);
export const DUAL_KEY_HOSTILE_CASES = Object.freeze([
  "PROTOTYPER_SUBSTITUTION_DENIED",
  "GENERAL_ROSTER_AUDITOR_SUBSTITUTION_DENIED",
  "DUPLICATE_OR_MISSING_WRITER_DENIED",
  "DUPLICATE_OR_MISSING_AUDITOR_DENIED",
  "INTERMEDIARY_QUEUE_GATE_DENIED",
  "STALE_DUPLICATE_OR_WRONG_CANDIDATE_VERDICT_DENIED",
  "MULTIPLE_ACTIVE_ISSUES_OR_CANDIDATES_DENIED",
  "WRITER_SELF_ACCEPTANCE_DENIED",
  "NON_RUNTIME_DELIVERY_DENIED",
  "BLANK_UI_WITH_DURABLE_PASS_OR_FAIL_RECOVERED_EXACTLY_ONCE",
  "BLANK_UI_WITHOUT_VALID_FALLBACK_EMITS_TYPED_TRUE_BLOCKED_NOT_FALSE_STALL",
  "REPEATED_FAILURE_DEDUPLICATED",
  ...ZERO_RECOVERY_SCOPE_HOSTILE_CASES,
]);
export const DUAL_KEY_RECEIPT_LIMITS = Object.freeze({
  candidate_receipts_per_generation: 1,
  verdict_receipts_per_generation: 1,
  failure_receipts_per_key: 1,
});
export const DUAL_KEY_ROUTING = Object.freeze({
  candidate_route: "DIRECT_WORKER_TO_AUDITOR",
  repair_route: "DIRECT_AUDITOR_TO_SAME_WORKER",
  intermediary_queue_allowed: false,
  runtime_delivery_role: DUAL_KEY_RUNTIME_ROLE,
  controller_true_blocked_only: true,
});
export const TRUE_BLOCKED = "TRUE_BLOCKED";
export const TRUE_BLOCKED_LIVENESS = "TRUE_BLOCKED_LIVENESS";
export const DURABLE_RESULT_RECOVERED = "DURABLE_RESULT_RECOVERED";

function zeroRecoveryRecord(value, label) {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
}

function zeroRecoveryString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a non-empty string`);
}

function zeroRecoveryBytes(value, label) {
  assert(Number.isSafeInteger(value) && value >= 0, `${label} must be a non-negative integer`);
}

function assertNoUndefined(value, label, seen = new Set()) {
  if (value === undefined) throw new Error(`${label} contains an undefined stable-identity field`);
  if (value === null || typeof value !== "object") return;
  assert(!seen.has(value), `${label} contains a cyclic stable identity`);
  seen.add(value);
  if (Array.isArray(value)) value.forEach((entry, index) => assertNoUndefined(entry, `${label}[${index}]`, seen));
  else for (const [key, entry] of Object.entries(value)) assertNoUndefined(entry, `${label}.${key}`, seen);
  seen.delete(value);
}

function zeroRecoveryStableIdentity(value, label) {
  zeroRecoveryRecord(value, label);
  assert(Object.keys(value).length > 0, `${label} must contain concrete identity fields`);
  assertNoUndefined(value, label);
  return structuredClone(value);
}

function zeroRecoveryPath(value, label) {
  zeroRecoveryString(value, label);
  assert(!value.includes("\\"), `${label} must use one canonical POSIX spelling`);
  const normalized = path.posix.normalize(value);
  assert(normalized === value && normalized !== "." && !normalized.split("/").includes(".."), `${label} is not canonical or escapes its scope`);
  return normalized;
}

function zeroRecoveryDescendant(rootPath, childPath) {
  return childPath.startsWith(`${rootPath}/`);
}

function zeroRecoveryGate(value, label) {
  if (typeof value === "string") return value;
  zeroRecoveryRecord(value, label);
  const result = value.result ?? value.classification ?? value.disposition ?? value.status;
  zeroRecoveryString(result, `${label} result`);
  return result;
}

function zeroRecoveryAggregate(input) {
  zeroRecoveryRecord(input, "aggregate root");
  const aggregateRoot = input.aggregate_root ?? input.aggregateRoot ?? input;
  zeroRecoveryRecord(aggregateRoot, "aggregate root");
  const normalized = {
    path: zeroRecoveryPath(aggregateRoot.path, "aggregate root path"),
    stable_identity: zeroRecoveryStableIdentity(aggregateRoot.stable_identity ?? aggregateRoot.stableIdentity, "aggregate root stable identity"),
    logical_bytes_measured: aggregateRoot.logical_bytes_measured ?? aggregateRoot.logicalBytesMeasured,
    allocated_bytes_measured: aggregateRoot.allocated_bytes_measured ?? aggregateRoot.allocatedBytesMeasured ?? aggregateRoot.allocated_or_physical_estimate_bytes,
  };
  zeroRecoveryBytes(normalized.logical_bytes_measured, "aggregate root logical bytes");
  zeroRecoveryBytes(normalized.allocated_bytes_measured, "aggregate root allocated bytes");
  if (aggregateRoot.object_type !== undefined) assert(aggregateRoot.object_type === "DIRECTORY", "aggregate root must be a directory");
  if (aggregateRoot.is_symlink !== undefined) assert(aggregateRoot.is_symlink === false, "aggregate root symlink status is not admissible");
  if (aggregateRoot.realpath !== undefined) assert(zeroRecoveryPath(aggregateRoot.realpath, "aggregate root realpath") === normalized.path, "aggregate root realpath mismatch");
  return normalized;
}

function zeroRecoverySelected(input, rootPath) {
  zeroRecoveryRecord(input, "selected object");
  const selected = {
    path: zeroRecoveryPath(input.path, "selected object path"),
    stable_identity: zeroRecoveryStableIdentity(input.stable_identity ?? input.stableIdentity, "selected object stable identity"),
    object_type: input.object_type ?? input.objectType,
    logical_bytes_measured: input.logical_bytes_measured ?? input.logicalBytesMeasured,
    allocated_or_physical_estimate_bytes: input.allocated_or_physical_estimate_bytes
      ?? input.allocatedOrPhysicalEstimateBytes
      ?? input.allocated_bytes_measured
      ?? input.allocatedBytesMeasured,
    cleanup_gate_result: zeroRecoveryGate(input.cleanup_gate_result ?? input.cleanupGateResult, "selected object cleanup gate"),
  };
  assert(zeroRecoveryDescendant(rootPath, selected.path), "selected object must be a descendant of the aggregate root");
  assert(selected.path !== rootPath, "aggregate root and selected object must remain distinct identities");
  assert(["FILE", "DIRECTORY"].includes(selected.object_type), "selected object type is invalid");
  zeroRecoveryBytes(selected.logical_bytes_measured, "selected object logical bytes");
  zeroRecoveryBytes(selected.allocated_or_physical_estimate_bytes, "selected object allocated bytes");
  zeroRecoveryString(selected.cleanup_gate_result, "selected object cleanup gate result");
  if (input.is_symlink !== undefined) assert(input.is_symlink === false, "selected object symlink status is not admissible");
  if (input.realpath !== undefined) assert(zeroRecoveryPath(input.realpath, "selected object realpath") === selected.path, "selected object realpath mismatch");
  if (input.escaped !== undefined) assert(input.escaped === false, "selected object escape status is not admissible");
  return selected;
}

function zeroRecoveryDigestBody(inventory) {
  return {...inventory, inventory_sha256: null};
}

/** Compile an exact aggregate-root/selected-object inventory. */
export function compileZeroRecoveryScopeInventory({
  aggregate_root,
  aggregateRoot,
  selected_objects,
  selectedObjects,
  selected_recoverable_logical_bytes,
  selectedRecoverableLogicalBytes,
  selected_recoverable_physical_bytes,
  selectedRecoverablePhysicalBytes,
  observed_at_utc,
  observedAtUtc,
  defect = ZERO_RECOVERY_SCOPE_SELECTION_DEFECT,
} = {}) {
  const aggregate = zeroRecoveryAggregate(aggregate_root ?? aggregateRoot);
  const rawSelected = selected_objects ?? selectedObjects ?? [];
  assert(Array.isArray(rawSelected), "selected objects must be an array");
  const selected = rawSelected.map((entry) => zeroRecoverySelected(entry, aggregate.path));
  assert(new Set(selected.map((entry) => entry.path)).size === selected.length, "selected objects contain duplicate paths");
  const eligible = selected.filter((entry) => entry.cleanup_gate_result === "CLEANUP_ELIGIBLE");
  const logical = eligible.reduce((sum, entry) => sum + entry.logical_bytes_measured, 0);
  const physical = eligible.reduce((sum, entry) => sum + entry.allocated_or_physical_estimate_bytes, 0);
  zeroRecoveryBytes(logical, "selected recovery logical bytes");
  zeroRecoveryBytes(physical, "selected recovery physical bytes");
  const requestedLogical = selected_recoverable_logical_bytes ?? selectedRecoverableLogicalBytes ?? logical;
  const requestedPhysical = selected_recoverable_physical_bytes ?? selectedRecoverablePhysicalBytes ?? physical;
  zeroRecoveryBytes(requestedLogical, "reported selected recovery logical bytes");
  zeroRecoveryBytes(requestedPhysical, "reported selected recovery physical bytes");
  assert(requestedLogical === logical, "selected recovery logical bytes must equal the exact eligible child sum");
  assert(requestedPhysical === physical, "selected recovery physical bytes must equal the exact eligible child sum");
  assert(logical <= aggregate.logical_bytes_measured, "selected recovery exceeds aggregate logical measurement");
  assert(physical <= aggregate.allocated_bytes_measured, "selected recovery exceeds aggregate allocated measurement");
  if (defect !== undefined && defect !== null) zeroRecoveryString(defect, "zero-recovery defect");
  const inventory = {
    schema: ZERO_RECOVERY_SCOPE_SCHEMA,
    version: 1,
    defect: defect ?? ZERO_RECOVERY_SCOPE_SELECTION_DEFECT,
    observed_at_utc: observed_at_utc ?? observedAtUtc ?? null,
    aggregate_root: aggregate,
    selected_objects: selected,
    selection_granularity: "EXACT_SELECTED_OBJECTS",
    aggregate_measurement_source: "AGGREGATE_ROOT_ONLY",
    recovery_measurement_source: "SELECTED_OBJECTS_ONLY",
    selected_recoverable_logical_bytes: logical,
    selected_recoverable_physical_bytes: physical,
    empty_selection_forces_zero: selected.length === 0,
    aggregate_bytes_attributed_to_selected_children: false,
    inventory_sha256: null,
  };
  inventory.inventory_sha256 = canonicalDigest(zeroRecoveryDigestBody(inventory));
  return inventory;
}

export function validateZeroRecoveryScopeInventory(inventory) {
  zeroRecoveryRecord(inventory, "zero-recovery scope inventory");
  assert(inventory.schema === ZERO_RECOVERY_SCOPE_SCHEMA && inventory.version === 1, "zero-recovery scope inventory identity is invalid");
  const rebuilt = compileZeroRecoveryScopeInventory(inventory);
  assert(inventory.inventory_sha256 === rebuilt.inventory_sha256, "zero-recovery scope inventory digest mismatch");
  assert(inventory.selection_granularity === "EXACT_SELECTED_OBJECTS", "zero-recovery selection granularity is invalid");
  assert(inventory.aggregate_measurement_source === "AGGREGATE_ROOT_ONLY", "aggregate measurement source is invalid");
  assert(inventory.recovery_measurement_source === "SELECTED_OBJECTS_ONLY", "recovery measurement source is invalid");
  assert(inventory.aggregate_bytes_attributed_to_selected_children === false, "aggregate bytes may not be attributed to selected children");
  assert(inventory.empty_selection_forces_zero === (inventory.selected_objects.length === 0), "empty selection zero-recovery rule is invalid");
  return inventory;
}

function forbiddenRole(role, label) {
  if (DUAL_KEY_FORBIDDEN_SUBSTITUTIONS.includes(role)) {
    const code = role === "AGENTOS.PROTOTYPER"
      ? "PROTOTYPER_SUBSTITUTION_DENIED"
      : role === "GENERAL_ROSTER_AUDITOR"
        ? "GENERAL_ROSTER_AUDITOR_SUBSTITUTION_DENIED"
        : "GENERAL_COMPLETE_ROSTER_AUDITOR_SUBSTITUTION_DENIED";
    deny(code, `${label} cannot be substituted by ${role}`);
  }
  assert(role === DUAL_KEY_WORKER_ROLE || role === DUAL_KEY_AUDITOR_ROLE, `${label} role is not a dedicated Worker or Auditor`);
}

function normalizeActor(input, expectedRole, label) {
  record(input, label);
  const role = input.role ?? input.role_id;
  forbiddenRole(role, label);
  assert(role === expectedRole, `${label} role binding is invalid`);
  const taskId = input.task_id ?? input.taskId;
  const model = input.model ?? input.model_id;
  identifier(taskId, `${label} task ID`);
  identifier(model, `${label} model`);
  if (input.cwd !== undefined) string(input.cwd, `${label} cwd`);
  const readOnly = input.read_only ?? input.readOnly ?? expectedRole === DUAL_KEY_AUDITOR_ROLE;
  const canWrite = input.can_write ?? input.canWrite ?? expectedRole === DUAL_KEY_WORKER_ROLE;
  assert(typeof readOnly === "boolean", `${label} read-only flag must be boolean`);
  assert(typeof canWrite === "boolean", `${label} write flag must be boolean`);
  if (expectedRole === DUAL_KEY_AUDITOR_ROLE) {
    assert(readOnly === true && canWrite === false, "Auditor must remain strictly read-only");
  } else {
    assert(canWrite === true, "Worker must retain its sole write custody");
  }
  return {
    role,
    task_id: taskId,
    model,
    ...(input.cwd === undefined ? {} : {cwd: input.cwd}),
    read_only: readOnly,
    can_write: canWrite,
  };
}

function normalizeBoundActor(input, label) {
  record(input, label);
  const role = input.role ?? input.role_id;
  if (role === DUAL_KEY_RUNTIME_ROLE || role === DUAL_KEY_CONTROLLER_ROLE) {
    identifier(input.task_id ?? input.taskId, `${label} task ID`);
    return {role, task_id: input.task_id ?? input.taskId};
  }
  return normalizeActor(input, role, label);
}

function normalizeCandidate(input, label = "candidate") {
  record(input, label);
  const candidateId = input.candidate_id ?? input.candidateId ?? input.id;
  identifier(candidateId, `${label} ID`);
  const commit = input.commit ?? input.commit_sha ?? input.commitSha;
  const tree = input.tree ?? input.tree_sha ?? input.treeSha;
  const parent = input.parent ?? input.parent_commit ?? input.parentCommit;
  for (const [value, field] of [[commit, "commit"], [tree, "tree"], [parent, "parent"]]) {
    string(value, `${label} ${field}`);
    assert(CONTENT_HASH.test(value), `${label} ${field} must be a 40- or 64-hex content identity`);
  }
  const paths = input.paths ?? input.direct_paths ?? input.directPaths;
  if (paths !== undefined) {
    assert(Array.isArray(paths), `${label} paths must be an array`);
    const normalizedPaths = paths.map((entry) => {
      string(entry, `${label} path`);
      assert(!entry.includes("\\") && !entry.startsWith("/"), `${label} path must be a portable relative POSIX path`);
      assert(!entry.split("/").includes(".."), `${label} path may not traverse a parent`);
      return entry;
    });
    assert(new Set(normalizedPaths).size === normalizedPaths.length, `${label} paths contain duplicates`);
  }
  if (input.worktree !== undefined) string(input.worktree, `${label} worktree`);
  const candidate = {
    candidate_id: candidateId,
    commit,
    tree,
    parent,
    ...(paths === undefined ? {} : {paths: [...paths]}),
    ...(input.branch === undefined ? {} : {branch: identifier(input.branch, `${label} branch`)}),
    ...(input.worktree === undefined ? {} : {worktree: input.worktree}),
    candidate_sha256: null,
  };
  const computed = digestBody(candidate, "candidate_sha256");
  const supplied = input.candidate_sha256 ?? input.candidateSha256 ?? input.content_sha256 ?? input.contentSha256;
  if (supplied !== undefined) assert(sha(supplied, `${label} digest`) === computed, `${label} digest does not bind candidate content`);
  candidate.candidate_sha256 = computed;
  return candidate;
}

function candidateSame(left, right) {
  return left?.candidate_sha256 !== undefined
    && right?.candidate_sha256 !== undefined
    && left.candidate_sha256 === right.candidate_sha256
    && left.commit === right.commit
    && left.tree === right.tree
    && left.parent === right.parent;
}

function requireActor(actor, expectedRole, bound, action) {
  const normalized = normalizeBoundActor(actor, `${action} actor`);
  if (normalized.role !== expectedRole) {
    deny(expectedRole === DUAL_KEY_AUDITOR_ROLE ? "WRITER_SELF_ACCEPTANCE_DENIED" : "NON_RUNTIME_DELIVERY_DENIED", `${action} is not authorized for this role`);
  }
  assert(normalized.task_id === bound.task_id, `${action} actor is not the bound dedicated ${expectedRole === DUAL_KEY_WORKER_ROLE ? "Worker" : "Auditor"}`);
  return normalized;
}

function stateDigest(state) {
  return digestBody(state, "loop_sha256");
}

function stateCandidateRequired(state) {
  return ["CANDIDATE_FROZEN", "AUDITING", "PASS", "REPAIR_REQUIRED", "RUNTIME_ONLY_DELIVERY_HANDOFF"].includes(state);
}

function assertRouting(routing) {
  record(routing, "dual-key routing");
  assert(routing.candidate_route === DUAL_KEY_ROUTING.candidate_route, "candidate routing is not direct Worker to Auditor");
  assert(routing.repair_route === DUAL_KEY_ROUTING.repair_route, "repair routing is not direct Auditor to same Worker");
  assert(routing.intermediary_queue_allowed === false, "intermediary queue is not allowed");
  assert(routing.runtime_delivery_role === DUAL_KEY_RUNTIME_ROLE, "runtime-only delivery role is not bound");
  assert(routing.controller_true_blocked_only === true, "TRUE_BLOCKED/liveness ownership is not Controller-only");
}

function assertReceiptLimits(receipts) {
  record(receipts, "dual-key receipts");
  for (const [field, maximum] of [["candidate_receipts", 1], ["verdict_receipts", 1], ["failure_receipts", 1]]) {
    assert(Number.isSafeInteger(receipts[field]) && receipts[field] >= 0 && receipts[field] <= maximum, `${field} exceeds the compact receipt limit`);
  }
}

function normalizeVerdict(input, candidate, auditor) {
  record(input, "Auditor verdict");
  const status = input.status ?? input.verdict ?? input.result;
  assert(status === "PASS" || status === "FAIL" || status === "REPAIR_REQUIRED", "Auditor verdict must be PASS or bounded FAIL");
  const candidateDigest = input.candidate_sha256 ?? input.candidateSha256 ?? candidate.candidate_sha256;
  assert(candidateDigest === candidate.candidate_sha256, "STALE_DUPLICATE_OR_WRONG_CANDIDATE_VERDICT_DENIED: Auditor verdict candidate is stale or wrong");
  const evidence = input.evidence_sha256 ?? input.evidenceSha256 ?? canonicalDigest({status, candidate_sha256: candidate.candidate_sha256, auditor_task_id: auditor.task_id});
  sha(evidence, "Auditor verdict evidence digest");
  const verdict = {
    status: status === "FAIL" ? "REPAIR_REQUIRED" : status,
    candidate_sha256: candidate.candidate_sha256,
    auditor_task_id: auditor.task_id,
    evidence_sha256: evidence,
    verdict_sha256: null,
  };
  verdict.verdict_sha256 = digestBody(verdict, "verdict_sha256");
  return verdict;
}

function appendTransition(next, {from, to, actor, candidate = null, reason = null} = {}) {
  const entry = {
    sequence: next.transition_sequence + 1,
    from,
    to,
    actor_role: actor.role,
    actor_task_id: actor.task_id,
    generation: next.generation,
    ...(candidate === null ? {} : {candidate_sha256: candidate.candidate_sha256}),
    ...(reason === null ? {} : {reason}),
  };
  next.transition_history.push(entry);
  next.transition_sequence = entry.sequence;
}

/** Validate the full portable binding and its current transition state. */
export function validateDualKeyRepairLoop(loop) {
  record(loop, "dual-key repair loop");
  assert(loop.schema === DUAL_KEY_REPAIR_LOOP_SCHEMA && loop.version === DUAL_KEY_REPAIR_LOOP_VERSION, "dual-key repair loop identity is invalid");
  identifier(loop.issue_id, "dual-key issue ID");
  assert(DUAL_KEY_STATES.includes(loop.state), "dual-key repair loop state is invalid");
  assert(Number.isSafeInteger(loop.generation) && loop.generation >= 1, "dual-key generation is invalid");
  assert(loop.active_issue_count === 1, "MULTIPLE_ACTIVE_ISSUES_OR_CANDIDATES_DENIED: multiple active issues or missing active issue is denied");
  assert(loop.active_candidate_count === (loop.candidate === null ? 0 : 1), "MULTIPLE_ACTIVE_ISSUES_OR_CANDIDATES_DENIED: multiple active candidates or candidate count mismatch is denied");
  assert(loop.writers === undefined && loop.auditors === undefined, "DUPLICATE_OR_MISSING_WRITER_DENIED: duplicate writer or Auditor collections are denied");
  assert(!Array.isArray(loop.writer) && !Array.isArray(loop.auditor), "DUPLICATE_OR_MISSING_WRITER_DENIED: duplicate or missing dedicated bindings are denied");
  const writer = normalizeActor(loop.writer, DUAL_KEY_WORKER_ROLE, "dual-key Worker");
  const auditor = normalizeActor(loop.auditor, DUAL_KEY_AUDITOR_ROLE, "dual-key Auditor");
  assert(writer.task_id !== auditor.task_id, "Worker and Auditor may not share one task binding");
  assertRouting(loop.routing);
  assertReceiptLimits(loop.receipts);
  assert(Number.isSafeInteger(loop.transition_sequence) && loop.transition_sequence >= 0, "dual-key transition sequence is invalid");
  assert(Array.isArray(loop.transition_history) && loop.transition_history.length === loop.transition_sequence, "dual-key transition history is incomplete");
  assert(loop.loop_sha256 === stateDigest(loop), "dual-key repair loop digest mismatch");
  if (loop.candidate !== null) {
    const candidate = normalizeCandidate(loop.candidate);
    assert(candidateSame(candidate, loop.candidate), "dual-key candidate identity is not content-addressed");
    if (stateCandidateRequired(loop.state)) assert(loop.candidate.candidate_sha256 === candidate.candidate_sha256, "dual-key candidate is invalid");
  } else {
    assert(!stateCandidateRequired(loop.state), "candidate is required after candidate freeze");
  }
  if (["PASS", "REPAIR_REQUIRED"].includes(loop.state)) {
    record(loop.verdict, "dual-key verdict");
    assert(loop.verdict.candidate_sha256 === loop.candidate.candidate_sha256, "dual-key verdict is not bound to the current candidate");
    assert(loop.verdict.auditor_task_id === auditor.task_id, "dual-key verdict is not from the bound Auditor");
    sha(loop.verdict.verdict_sha256, "dual-key verdict digest");
    assert(loop.verdict.verdict_sha256 === digestBody(loop.verdict, "verdict_sha256"), "dual-key verdict digest mismatch");
  }
  if (loop.state === "RUNTIME_ONLY_DELIVERY_HANDOFF") {
    record(loop.delivery, "runtime delivery handoff");
    assert(loop.delivery.role === DUAL_KEY_RUNTIME_ROLE, "delivery is not Runtime-only");
    assert(loop.delivery.candidate_sha256 === loop.candidate.candidate_sha256, "runtime delivery candidate mismatch");
  }
  return loop;
}

/** Admit exactly one issue, one Worker, one read-only Auditor, and no substitute. */
export function createDualKeyRepairLoop({issueId, issue_id, writer, auditor, writers, auditors, generation = 1} = {}) {
  const issue = issueId ?? issue_id;
  identifier(issue, "dual-key issue ID");
  assert(writers === undefined, "DUPLICATE_OR_MISSING_WRITER_DENIED: a writer collection cannot accompany the sole Worker");
  assert(auditors === undefined, "DUPLICATE_OR_MISSING_AUDITOR_DENIED: an Auditor collection cannot accompany the sole Auditor");
  assert(writer !== undefined && !Array.isArray(writer), "DUPLICATE_OR_MISSING_WRITER_DENIED: duplicate or missing dedicated Worker is denied");
  assert(auditor !== undefined && !Array.isArray(auditor), "DUPLICATE_OR_MISSING_AUDITOR_DENIED: duplicate or missing dedicated Auditor is denied");
  assert(Number.isSafeInteger(generation) && generation >= 1, "dual-key generation is invalid");
  const normalizedWriter = normalizeActor(writer, DUAL_KEY_WORKER_ROLE, "dual-key Worker");
  const normalizedAuditor = normalizeActor(auditor, DUAL_KEY_AUDITOR_ROLE, "dual-key Auditor");
  assert(normalizedWriter.task_id !== normalizedAuditor.task_id, "Worker and Auditor may not share one task binding");
  const loop = {
    schema: DUAL_KEY_REPAIR_LOOP_SCHEMA,
    version: DUAL_KEY_REPAIR_LOOP_VERSION,
    issue_id: issue,
    generation,
    state: "ISSUE_READY",
    writer: normalizedWriter,
    auditor: normalizedAuditor,
    active_issue_count: 1,
    active_candidate_count: 0,
    candidate: null,
    verdict: null,
    routing: {...DUAL_KEY_ROUTING},
    receipts: {candidate_receipts: 0, verdict_receipts: 0, failure_receipts: 0},
    transition_sequence: 0,
    transition_history: [],
    loop_sha256: null,
  };
  loop.loop_sha256 = stateDigest(loop);
  return validateDualKeyRepairLoop(loop);
}

function transitionTargetAllowed(from, to) {
  const allowed = {
    ISSUE_READY: ["WORKING"],
    WORKING: ["CANDIDATE_FROZEN"],
    CANDIDATE_FROZEN: ["AUDITING"],
    AUDITING: ["PASS", "REPAIR_REQUIRED"],
    REPAIR_REQUIRED: ["WORKING"],
    PASS: ["RUNTIME_ONLY_DELIVERY_HANDOFF"],
    RUNTIME_ONLY_DELIVERY_HANDOFF: [],
  };
  assert(allowed[from]?.includes(to), `dual-key transition ${from} -> ${to} is not allowed`);
}

/** Apply one authorized transition and return a new digest-bound state. */
export function transitionDualKeyRepairLoop(loop, {to, actor, candidate = null, verdict = null, recipientTaskId = null, intermediaryQueue = false, reason = null} = {}) {
  validateDualKeyRepairLoop(loop);
  string(to, "dual-key transition target");
  transitionTargetAllowed(loop.state, to);
  const next = clone(loop);
  let normalizedActor;
  if (loop.state === "ISSUE_READY" || loop.state === "WORKING" || loop.state === "CANDIDATE_FROZEN" || loop.state === "REPAIR_REQUIRED") {
    normalizedActor = requireActor(actor, DUAL_KEY_WORKER_ROLE, loop.writer, `Worker ${loop.state} transition`);
  } else if (loop.state === "AUDITING") {
    normalizedActor = requireActor(actor, DUAL_KEY_AUDITOR_ROLE, loop.auditor, "Auditor verdict");
  } else if (loop.state === "PASS") {
    const bound = {task_id: actor?.task_id ?? actor?.taskId};
    normalizedActor = requireActor(actor, DUAL_KEY_RUNTIME_ROLE, bound, "Runtime delivery");
  }
  if (to === "WORKING" && loop.state === "REPAIR_REQUIRED") {
    if (actor.issue_id !== undefined) assert(actor.issue_id === loop.issue_id, "repair may not change the issue");
    next.generation += 1;
    next.candidate = null;
    next.verdict = null;
    next.active_candidate_count = 0;
    next.receipts = {candidate_receipts: 0, verdict_receipts: 0, failure_receipts: 0};
    next.repair_of_candidate_sha256 = loop.candidate.candidate_sha256;
  } else if (to === "CANDIDATE_FROZEN") {
    assert(candidate !== null, "candidate freeze requires one immutable candidate");
    assert(loop.candidate === null, "only one active candidate may be frozen");
    next.candidate = normalizeCandidate(candidate);
    next.active_candidate_count = 1;
    next.receipts.candidate_receipts = 1;
  } else if (to === "AUDITING") {
    assert(intermediaryQueue === false && recipientTaskId === loop.auditor.task_id, "INTERMEDIARY_QUEUE_GATE_DENIED: direct Worker to Auditor route is required; intermediary queue denied");
    assert(candidateSame(loop.candidate, candidate === null ? loop.candidate : normalizeCandidate(candidate)), "STALE_DUPLICATE_OR_WRONG_CANDIDATE_VERDICT_DENIED: auditor route candidate is stale or wrong");
  } else if (to === "PASS" || to === "REPAIR_REQUIRED") {
    assert(candidateSame(loop.candidate, candidate === null ? loop.candidate : normalizeCandidate(candidate)), "STALE_DUPLICATE_OR_WRONG_CANDIDATE_VERDICT_DENIED: verdict candidate is stale or wrong");
    next.verdict = normalizeVerdict(verdict, loop.candidate, loop.auditor);
    next.receipts.verdict_receipts = 1;
  } else if (to === "RUNTIME_ONLY_DELIVERY_HANDOFF") {
    assert(candidateSame(loop.candidate, candidate === null ? loop.candidate : normalizeCandidate(candidate)), "STALE_DUPLICATE_OR_WRONG_CANDIDATE_VERDICT_DENIED: runtime delivery candidate is stale or wrong");
    next.delivery = {
      role: DUAL_KEY_RUNTIME_ROLE,
      actor_task_id: normalizedActor.task_id,
      candidate_sha256: loop.candidate.candidate_sha256,
      route: "RUNTIME_ONLY_DELIVERY",
      delivery_sha256: null,
    };
    next.delivery.delivery_sha256 = digestBody(next.delivery, "delivery_sha256");
  }
  appendTransition(next, {from: loop.state, to, actor: normalizedActor, candidate: next.candidate, reason});
  next.state = to;
  next.loop_sha256 = stateDigest(next);
  return validateDualKeyRepairLoop(next);
}

export function freezeDualKeyCandidate(loop, {actor, candidate} = {}) {
  return transitionDualKeyRepairLoop(loop, {to: "CANDIDATE_FROZEN", actor, candidate});
}

export function routeDualKeyCandidateToAuditor(loop, {actor, candidate = null, recipientTaskId, intermediaryQueue = false} = {}) {
  return transitionDualKeyRepairLoop(loop, {
    to: "AUDITING",
    actor,
    candidate,
    recipientTaskId,
    intermediaryQueue,
  });
}

export function recordDualKeyAuditorVerdict(loop, {actor, candidate = null, verdict} = {}) {
  const status = verdict?.status ?? verdict?.verdict ?? verdict?.result;
  return transitionDualKeyRepairLoop(loop, {
    to: status === "PASS" ? "PASS" : "REPAIR_REQUIRED",
    actor,
    candidate,
    verdict,
  });
}

export function authorizeRuntimeOnlyDelivery(loop, {actor, candidate = null} = {}) {
  const next = transitionDualKeyRepairLoop(loop, {to: "RUNTIME_ONLY_DELIVERY_HANDOFF", actor, candidate});
  return {
    allowed: true,
    role: DUAL_KEY_RUNTIME_ROLE,
    route: "RUNTIME_ONLY_DELIVERY",
    candidate_sha256: next.candidate.candidate_sha256,
    state: next,
    receipt_sha256: canonicalDigest({role: DUAL_KEY_RUNTIME_ROLE, route: "RUNTIME_ONLY_DELIVERY", candidate_sha256: next.candidate.candidate_sha256}),
  };
}

function validDurableResult({taskId, turnId, durableResult}) {
  if (!durableResult || typeof durableResult !== "object" || Array.isArray(durableResult)) return null;
  const resultStatus = durableResult.status ?? durableResult.classification ?? durableResult.result;
  if (!(["PASS", "FAIL"].includes(resultStatus))) return null;
  if ((durableResult.task_id ?? durableResult.taskId) !== taskId || (durableResult.turn_id ?? durableResult.turnId) !== turnId) return null;
  const evidence = durableResult.evidence_sha256 ?? durableResult.evidenceSha256 ?? durableResult.receipt_sha256 ?? durableResult.receiptSha256;
  if (!SHA256.test(evidence ?? "")) return null;
  return {
    status: resultStatus,
    task_id: taskId,
    turn_id: turnId,
    evidence_sha256: evidence,
    ...(durableResult.candidate_sha256 === undefined ? {} : {candidate_sha256: durableResult.candidate_sha256}),
  };
}

function fallbackLedgerSet(ledger) {
  if (ledger instanceof Set) return ledger;
  record(ledger, "blank projection consumption ledger");
  if (!(ledger.consumed instanceof Set)) ledger.consumed = new Set(ledger.consumed_keys ?? []);
  assert(Array.isArray(ledger.consumed_keys ?? []), "blank projection ledger keys must be an array");
  return ledger.consumed;
}

export function createBlankProjectionFallback({taskId, task_id, turnId, turn_id, projection = {}, durableResult = null, durable_result = null, controller = null, controllerEvidence = null} = {}) {
  const task = taskId ?? task_id;
  const turn = turnId ?? turn_id;
  identifier(task, "blank projection task ID");
  identifier(turn, "blank projection turn ID");
  record(projection, "blank projection");
  const items = projection.items ?? [];
  assert(Array.isArray(items), "blank projection items must be an array");
  const blank = items.length === 0 && (projection.items_count === undefined || projection.items_count === 0);
  assert(blank, "durable fallback applies only to a blank projection");
  const durable = validDurableResult({taskId: task, turnId: turn, durableResult: durableResult ?? durable_result});
  if (durable) {
    const recoveryKey = canonicalDigest({task_id: task, turn_id: turn, evidence_sha256: durable.evidence_sha256});
    return {
      schema: DUAL_KEY_REPAIR_LOOP_SCHEMA,
      version: 1,
      classification: DURABLE_RESULT_RECOVERED,
      hostile_case: "BLANK_UI_WITH_DURABLE_PASS_OR_FAIL_RECOVERED_EXACTLY_ONCE",
      task_id: task,
      turn_id: turn,
      projection_blank: true,
      durable_result: durable,
      recovery_key: recoveryKey,
      exactly_once: true,
      replay_completed_work: false,
      wake_completed_task: false,
      rerun_completed_task: false,
    };
  }
  const evidence = controllerEvidence ?? controller;
  record(evidence, "Controller TRUE_BLOCKED evidence");
  assert((evidence.role ?? evidence.role_id) === DUAL_KEY_CONTROLLER_ROLE, "TRUE_BLOCKED/liveness is Controller-only");
  assert(evidence.evidence_complete === true, "Controller TRUE_BLOCKED/liveness requires evidence-complete custody");
  sha(evidence.evidence_sha256, "Controller TRUE_BLOCKED evidence digest");
  return {
    schema: DUAL_KEY_REPAIR_LOOP_SCHEMA,
    version: 1,
    classification: TRUE_BLOCKED_LIVENESS,
    hostile_case: "BLANK_UI_WITHOUT_VALID_FALLBACK_EMITS_TYPED_TRUE_BLOCKED_NOT_FALSE_STALL",
    status: TRUE_BLOCKED,
    task_id: task,
    turn_id: turn,
    projection_blank: true,
    durable_result: null,
    owner_role: DUAL_KEY_CONTROLLER_ROLE,
    evidence_complete: true,
    evidence_sha256: evidence.evidence_sha256,
    false_stall: false,
    replay_completed_work: false,
    wake_completed_task: false,
    rerun_completed_task: false,
  };
}

export function recoverBlankProjectionResult({taskId, task_id, turnId, turn_id, projection = {}, durableResult = null, durable_result = null, controller = null, controllerEvidence = null, ledger = {consumed_keys: []}} = {}) {
  const fallback = createBlankProjectionFallback({taskId, task_id, turnId, turn_id, projection, durableResult, durable_result, controller, controllerEvidence});
  if (fallback.classification === TRUE_BLOCKED_LIVENESS) return {...fallback, emitted: true, next_action: "CONTROLLER_REVIEW_LIVENESS"};
  const consumed = fallbackLedgerSet(ledger);
  const duplicate = consumed.has(fallback.recovery_key);
  if (!duplicate) {
    consumed.add(fallback.recovery_key);
    if (Array.isArray(ledger.consumed_keys) && !ledger.consumed_keys.includes(fallback.recovery_key)) ledger.consumed_keys.push(fallback.recovery_key);
  }
  return {
    ...fallback,
    classification: "BLANK_UI_WITH_DURABLE_PASS_OR_FAIL_RECOVERED_EXACTLY_ONCE",
    consumed: !duplicate,
    duplicate,
    emitted: !duplicate,
    next_action: duplicate ? "NO_OP_ALREADY_CONSUMED" : "PRESERVE_DURABLE_RESULT_AND_CONTINUE",
  };
}

export function createFailureDedupeLedger() {
  return {schema: "agentos.hygiene_failure_dedupe_ledger.v1", keys: []};
}

export function normalizeFailureDedupeKey({issueId, issue_id, candidateId, candidate_id, failureClass, failure_class, evidenceSha256, evidence_sha256} = {}) {
  const issue = issueId ?? issue_id;
  const candidate = candidateId ?? candidate_id;
  const failure = failureClass ?? failure_class;
  const evidence = evidenceSha256 ?? evidence_sha256;
  identifier(issue, "failure issue ID");
  identifier(candidate, "failure candidate ID");
  identifier(failure, "failure class");
  sha(evidence, "failure evidence digest");
  return canonicalDigest({issue_id: issue, candidate_id: candidate, failure_class: failure, evidence_sha256: evidence});
}

export function deduplicateFailure({failure, ledger = createFailureDedupeLedger()} = {}) {
  record(failure, "failure");
  record(ledger, "failure dedupe ledger");
  assert(ledger.schema === "agentos.hygiene_failure_dedupe_ledger.v1", "failure dedupe ledger identity is invalid");
  assert(Array.isArray(ledger.keys), "failure dedupe ledger keys are required");
  const key = normalizeFailureDedupeKey(failure);
  const duplicate = ledger.keys.includes(key);
  if (!duplicate) ledger.keys.push(key);
  ledger.keys.sort();
  return {
    schema: "agentos.hygiene_failure_receipt.v1",
    version: 1,
    key,
    duplicate,
    emitted: !duplicate,
    failure_class: failure.failureClass ?? failure.failure_class,
    receipt_count_for_key: duplicate ? 1 : 1,
    hostile_case: "REPEATED_FAILURE_DEDUPLICATED",
  };
}

export const createRepairLoop = createDualKeyRepairLoop;
export const validateRepairLoop = validateDualKeyRepairLoop;
export const transitionRepairLoop = transitionDualKeyRepairLoop;
export const freezeRepairCandidate = freezeDualKeyCandidate;
export const routeRepairCandidateToAuditor = routeDualKeyCandidateToAuditor;
export const recordAuditorVerdict = recordDualKeyAuditorVerdict;
export const authorizeRuntimeDelivery = authorizeRuntimeOnlyDelivery;
export const compileBlankProjectionFallback = createBlankProjectionFallback;
export const recoverDurableBlankProjection = recoverBlankProjectionResult;
export const dedupeFailure = deduplicateFailure;
