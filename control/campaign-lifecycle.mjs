#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const LIFECYCLE_STAGES = Object.freeze([
  "BUILDING",
  "TERMINAL_PROPOSED",
  "FIRST_PASS_REPAIR_REQUIRED",
  "TERMINAL_SETTLED",
  "FINALIZER_ACTIVE",
  "FINALIZER_COMPLETE",
  "DELTA_AUDIT",
  "READY_FOR_ACCEPTANCE",
  "DEPLOYMENT_CLEARED",
  "ACCEPTED_LIVE_PENDING_CLOSURE",
  "ACCEPTED_LIVE_CLOSED",
]);

export const PLATFORM_STATES = Object.freeze([
  "UNSPAWNED",
  "AVAILABLE",
  "LEASED",
  "WORKING",
  "HANDOFF_READY",
  "ARCHIVED_UNPINNED",
]);

export const HOLD_KINDS = Object.freeze([
  "CONTEXT",
  "AUTHORITY_BOUNDARY",
  "EXTERNAL_DEPENDENCY",
  "CREDENTIAL_ACCESS",
  "OWNER_DECISION",
  "PROTECTED_RESOURCE",
]);

export const SUCCESSOR_STATUSES = Object.freeze([
  "NONE",
  "ORCHESTRATOR_ORIENTED_HELD",
  "LIVE_DELTA_RECEIVED",
  "CAMPAIGN_ADMITTED",
]);

const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const RELATIVE_PATH = /^(?!\/)(?!.*\\)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\0).+$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const GENESIS_UTC = "1970-01-01T00:00:00.000Z";
const TRANSITION_KEYS = [
  "sequence", "from_state_sha256", "from_stage", "to_stage", "event_type", "payload", "at_utc", "event_sha256",
];

const ALLOWED_TRANSITIONS = Object.freeze({
  BUILDING: new Set(["BUILDING", "TERMINAL_PROPOSED"]),
  TERMINAL_PROPOSED: new Set(["TERMINAL_PROPOSED", "FIRST_PASS_REPAIR_REQUIRED", "TERMINAL_SETTLED"]),
  FIRST_PASS_REPAIR_REQUIRED: new Set(["FIRST_PASS_REPAIR_REQUIRED", "BUILDING"]),
  TERMINAL_SETTLED: new Set(["TERMINAL_SETTLED", "FINALIZER_ACTIVE", "READY_FOR_ACCEPTANCE"]),
  FINALIZER_ACTIVE: new Set(["FINALIZER_ACTIVE", "FINALIZER_COMPLETE"]),
  FINALIZER_COMPLETE: new Set(["FINALIZER_COMPLETE", "DELTA_AUDIT"]),
  DELTA_AUDIT: new Set(["DELTA_AUDIT", "FINALIZER_ACTIVE", "READY_FOR_ACCEPTANCE"]),
  READY_FOR_ACCEPTANCE: new Set(["READY_FOR_ACCEPTANCE", "DEPLOYMENT_CLEARED"]),
  DEPLOYMENT_CLEARED: new Set(["DEPLOYMENT_CLEARED", "ACCEPTED_LIVE_PENDING_CLOSURE"]),
  ACCEPTED_LIVE_PENDING_CLOSURE: new Set(["ACCEPTED_LIVE_PENDING_CLOSURE", "ACCEPTED_LIVE_CLOSED"]),
  ACCEPTED_LIVE_CLOSED: new Set(["ACCEPTED_LIVE_CLOSED"]),
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value, label) {
  assert(isRecord(value), `${label} must be an object`);
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
}

function requireIdentifier(value, label) {
  requireString(value, label);
  assert(IDENTIFIER.test(value), `${label} contains an unsafe identifier`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function requireUtc(value, label) {
  requireString(value, label);
  assert(ISO_UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} must be UTC`);
}

function exactKeys(value, keys, label) {
  requireRecord(value, label);
  const actual = Object.keys(value).sort(compareUtf8);
  const expected = [...keys].sort(compareUtf8);
  assert(actual.length === expected.length
    && actual.every((key, index) => key === expected[index]), `${label} fields mismatch`);
}

export function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort(compareUtf8)
      .map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function lifecycleDigest(value) {
  return crypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function sortedUniqueStrings(values, label, {allowEmpty = false} = {}) {
  assert(Array.isArray(values), `${label} must be an array`);
  if (!allowEmpty) assert(values.length > 0, `${label} must be nonempty`);
  assert(values.every((value) => typeof value === "string" && value.length > 0), `${label} contains an invalid value`);
  const sorted = [...values].sort(compareUtf8);
  assert(new Set(sorted).size === sorted.length, `${label} contains duplicates`);
  assert(canonicalJson(values) === canonicalJson(sorted), `${label} must be UTF-8 sorted`);
  return sorted;
}

function validateRelativePath(value, label) {
  requireString(value, label);
  assert(RELATIVE_PATH.test(value), `${label} must be a safe project-relative path`);
}

function validateIdentity(identity, label) {
  requireRecord(identity, label);
  exactKeys(identity, ["role_id", "session_id", "campaign_id", "campaign_version", "orientation_only"], label);
  for (const field of ["role_id", "session_id", "campaign_id", "campaign_version"]) {
    requireIdentifier(identity[field], `${label} ${field}`);
  }
  assert(typeof identity.orientation_only === "boolean", `${label} orientation_only is invalid`);
}

function validateRoot(root) {
  exactKeys(root, [
    "root_id", "branch", "commit", "tree", "remote_commit", "remote_tree", "clean", "pushed",
  ], "campaign root");
  for (const field of ["root_id", "branch", "commit", "tree", "remote_commit", "remote_tree"]) {
    requireString(root[field], `campaign root ${field}`);
  }
  assert(typeof root.clean === "boolean" && typeof root.pushed === "boolean", "campaign root flags are invalid");
  if (root.pushed) {
    assert(root.commit === root.remote_commit && root.tree === root.remote_tree,
      "pushed campaign root is not remote-equal");
  }
}

const WORKTREE_KEYS = ["worktree_id", "branch", "base_commit", "current_commit", "base_tree", "current_tree", "clean", "pushed"];

function validatePlatformWorktree(worktree, label) {
  exactKeys(worktree, WORKTREE_KEYS, label);
  for (const field of WORKTREE_KEYS.slice(0, 6)) requireString(worktree[field], `${label} ${field}`);
  assert(typeof worktree.clean === "boolean" && typeof worktree.pushed === "boolean", `${label} flags are invalid`);
  if (worktree.pushed) assert(worktree.current_commit.length > 0 && worktree.current_tree.length > 0, `${label} pushed identity is missing`);
}

function validateSupervision(value, label) {
  if (value === null) return;
  exactKeys(value, ["feature_agent_id", "feature_session_id", "assignment_id", "lease_id", "goal_sha256", "writable_scope", "acquired_at_utc"], label);
  for (const field of ["feature_agent_id", "feature_session_id", "assignment_id", "lease_id", "writable_scope"]) {
    requireIdentifier(value[field], `${label} ${field}`);
  }
  requireSha(value.goal_sha256, `${label} goal`);
  requireUtc(value.acquired_at_utc, `${label} acquired_at_utc`);
}

function validateRequestQueue(queue, label) {
  assert(Array.isArray(queue), `${label} must be an array`);
  let previous = null;
  for (const item of queue) {
    exactKeys(item, ["feature_id", "dependency", "critical_path_rank", "goal_sha256"], `${label} item`);
    requireIdentifier(item.feature_id, `${label} feature_id`);
    requireString(item.dependency, `${label} dependency`);
    assert(Number.isSafeInteger(item.critical_path_rank) && item.critical_path_rank >= 0, `${label} rank is invalid`);
    requireSha(item.goal_sha256, `${label} goal`);
    if (previous !== null) assert(compareUtf8(previous, item.feature_id) < 0, `${label} must be deterministically ordered`);
    previous = item.feature_id;
  }
}

function validateHandoffReceipts(receipts, label) {
  assert(Array.isArray(receipts), `${label} must be an array`);
  let previous = null;
  for (const receipt of receipts) {
    exactKeys(receipt, ["assignment_id", "from_feature_agent_id", "goal_sha256", "to_state", "commit", "tree", "receipt_sha256", "at_utc"], `${label} item`);
    for (const field of ["assignment_id", "from_feature_agent_id", "commit", "tree"]) requireIdentifier(receipt[field], `${label} ${field}`);
    requireSha(receipt.goal_sha256, `${label} goal`);
    assert(receipt.to_state === "AVAILABLE", `${label} must release to AVAILABLE`);
    requireSha(receipt.receipt_sha256, `${label} receipt`);
    requireUtc(receipt.at_utc, `${label} time`);
    if (previous !== null) assert(compareUtf8(previous, receipt.assignment_id) < 0, `${label} must be deterministically ordered`);
    previous = receipt.assignment_id;
    const body = structuredClone(receipt);
    delete body.receipt_sha256;
    assert(lifecycleDigest(body) === receipt.receipt_sha256, `${label} receipt is not content-addressed`);
  }
}

export function validatePlatformAgent(agent) {
  exactKeys(agent, [
    "logical_capability_id", "logical_agent_id", "execution_session_id", "state",
    "platform_worktree", "supervision", "request_queue", "handoff_receipts",
  ], "Platform Agent pool entry");
  for (const field of ["logical_capability_id", "logical_agent_id", "execution_session_id"]) {
    requireIdentifier(agent[field], `Platform Agent ${field}`);
  }
  assert(PLATFORM_STATES.includes(agent.state), "Platform Agent state is invalid");
  validatePlatformWorktree(agent.platform_worktree, "Platform Agent worktree");
  validateSupervision(agent.supervision, "Platform Agent supervision");
  validateRequestQueue(agent.request_queue, "Platform Agent request queue");
  validateHandoffReceipts(agent.handoff_receipts, "Platform Agent handoff receipts");
  if (agent.state === "UNSPAWNED") {
    assert(agent.supervision === null, "unspawned Platform Agent has a supervisor");
  }
  if (["AVAILABLE", "ARCHIVED_UNPINNED"].includes(agent.state)) {
    assert(agent.supervision === null, `${agent.state} Platform Agent has a supervisor`);
  }
  if (["LEASED", "WORKING", "HANDOFF_READY"].includes(agent.state)) {
    assert(agent.supervision !== null, `${agent.state} Platform Agent lacks a supervision lease`);
  }
  return agent;
}

export function compilePlatformAgent({
  logicalCapabilityId,
  logicalAgentId,
  executionSessionId,
  platformWorktree,
  state = "UNSPAWNED",
}) {
  const agent = {
    logical_capability_id: logicalCapabilityId,
    logical_agent_id: logicalAgentId,
    execution_session_id: executionSessionId,
    state,
    platform_worktree: structuredClone(platformWorktree),
    supervision: null,
    request_queue: [],
    handoff_receipts: [],
  };
  validatePlatformAgent(agent);
  return agent;
}

export function enqueuePlatformRequest(agent, request) {
  validatePlatformAgent(agent);
  exactKeys(request, ["feature_id", "dependency", "critical_path_rank", "goal_sha256"], "Platform request");
  requireIdentifier(request.feature_id, "Platform request feature_id");
  requireString(request.dependency, "Platform request dependency");
  assert(Number.isSafeInteger(request.critical_path_rank) && request.critical_path_rank >= 0, "Platform request rank is invalid");
  requireSha(request.goal_sha256, "Platform request goal");
  assert(!agent.request_queue.some((item) => item.feature_id === request.feature_id), "duplicate Platform request");
  const next = structuredClone(agent);
  next.request_queue.push(structuredClone(request));
  next.request_queue.sort((left, right) => compareUtf8(left.feature_id, right.feature_id));
  validatePlatformAgent(next);
  return next;
}

export function acquirePlatformLease(agent, {featureAgentId, featureSessionId, assignmentId, leaseId, goalSha256, writableScope, acquiredAtUtc}) {
  validatePlatformAgent(agent);
  for (const [value, label] of [[featureAgentId, "feature agent"], [featureSessionId, "feature session"], [assignmentId, "assignment"], [leaseId, "lease"], [writableScope, "writable scope"]]) requireIdentifier(value, label);
  requireSha(goalSha256, "Platform lease goal");
  requireUtc(acquiredAtUtc, "Platform lease acquisition time");
  assert(["UNSPAWNED", "AVAILABLE"].includes(agent.state), "Platform Agent is not available for a new lease");
  assert(agent.supervision === null, "Platform Agent already has a supervisor");
  const next = structuredClone(agent);
  next.state = "LEASED";
  next.supervision = {
    feature_agent_id: featureAgentId,
    feature_session_id: featureSessionId,
    assignment_id: assignmentId,
    lease_id: leaseId,
    goal_sha256: goalSha256,
    writable_scope: writableScope,
    acquired_at_utc: acquiredAtUtc,
  };
  next.request_queue = next.request_queue.filter((item) => item.feature_id !== featureAgentId);
  validatePlatformAgent(next);
  return next;
}

export function startPlatformWork(agent) {
  validatePlatformAgent(agent);
  assert(agent.state === "LEASED", "Platform Agent must be LEASED before work starts");
  const next = structuredClone(agent);
  next.state = "WORKING";
  validatePlatformAgent(next);
  return next;
}

export function markPlatformHandoffReady(agent, currentCommit, currentTree, clean = true, pushed = true) {
  validatePlatformAgent(agent);
  requireString(currentCommit, "Platform current commit");
  requireString(currentTree, "Platform current tree");
  assert(agent.state === "WORKING", "Platform Agent must be WORKING before handoff");
  const next = structuredClone(agent);
  next.state = "HANDOFF_READY";
  next.platform_worktree.current_commit = currentCommit;
  next.platform_worktree.current_tree = currentTree;
  next.platform_worktree.clean = clean;
  next.platform_worktree.pushed = pushed;
  validatePlatformAgent(next);
  return next;
}

export function releasePlatformLease(agent, atUtc) {
  validatePlatformAgent(agent);
  requireUtc(atUtc, "Platform lease release time");
  assert(["LEASED", "WORKING", "HANDOFF_READY"].includes(agent.state), "Platform Agent is not leased");
  assert(agent.supervision !== null, "Platform lease release lacks supervision");
  assert(agent.platform_worktree.clean && agent.platform_worktree.pushed, "Platform Agent must release a clean pushed worktree");
  const supervision = agent.supervision;
  const receiptBody = {
    assignment_id: supervision.assignment_id,
    from_feature_agent_id: supervision.feature_agent_id,
    goal_sha256: supervision.goal_sha256,
    to_state: "AVAILABLE",
    commit: agent.platform_worktree.current_commit,
    tree: agent.platform_worktree.current_tree,
    at_utc: atUtc,
  };
  const receipt = {...receiptBody, receipt_sha256: lifecycleDigest(receiptBody)};
  const next = structuredClone(agent);
  next.state = "AVAILABLE";
  next.supervision = null;
  next.handoff_receipts.push(receipt);
  next.handoff_receipts.sort((left, right) => compareUtf8(left.assignment_id, right.assignment_id));
  validatePlatformAgent(next);
  return next;
}

export function archivePlatformAgent(agent) {
  validatePlatformAgent(agent);
  assert(agent.state === "AVAILABLE", "only an available Platform Agent may be archived");
  const next = structuredClone(agent);
  next.state = "ARCHIVED_UNPINNED";
  validatePlatformAgent(next);
  return next;
}

const CHECKPOINT_KEYS = [
  "candidate_id", "campaign_id", "campaign_version", "logical_lineage_id", "parent_candidate_id",
  "commit", "tree", "worktree_id", "clean", "pushed", "terminal", "status",
  "audit_plan_sha256", "audit_reconciliation_sha256", "finding_ids", "checkpoint_sha256",
];

export function compileCheckpoint(input) {
  requireRecord(input, "checkpoint");
  const checkpoint = {
    candidate_id: input.candidate_id,
    campaign_id: input.campaign_id,
    campaign_version: input.campaign_version,
    logical_lineage_id: input.logical_lineage_id,
    parent_candidate_id: input.parent_candidate_id ?? null,
    commit: input.commit,
    tree: input.tree,
    worktree_id: input.worktree_id,
    clean: input.clean,
    pushed: input.pushed,
    terminal: Boolean(input.terminal),
    status: input.status ?? (input.terminal ? "TERMINAL_PROPOSED" : "BUILDING"),
    audit_plan_sha256: input.audit_plan_sha256 ?? null,
    audit_reconciliation_sha256: input.audit_reconciliation_sha256 ?? null,
    finding_ids: [...(input.finding_ids ?? [])].sort(compareUtf8),
    checkpoint_sha256: "",
  };
  const body = structuredClone(checkpoint);
  delete body.checkpoint_sha256;
  checkpoint.checkpoint_sha256 = lifecycleDigest(body);
  validateCheckpoint(checkpoint);
  return checkpoint;
}

export function validateCheckpoint(checkpoint) {
  exactKeys(checkpoint, CHECKPOINT_KEYS, "checkpoint");
  for (const field of ["candidate_id", "campaign_id", "campaign_version", "logical_lineage_id", "commit", "tree", "worktree_id", "status"]) requireIdentifier(checkpoint[field], `checkpoint ${field}`);
  if (checkpoint.parent_candidate_id !== null) requireIdentifier(checkpoint.parent_candidate_id, "checkpoint parent");
  assert(typeof checkpoint.clean === "boolean" && typeof checkpoint.pushed === "boolean" && typeof checkpoint.terminal === "boolean", "checkpoint flags are invalid");
  if (checkpoint.pushed) assert(checkpoint.clean, "pushed checkpoint must be clean");
  for (const field of ["audit_plan_sha256", "audit_reconciliation_sha256"]) {
    if (checkpoint[field] !== null) requireSha(checkpoint[field], `checkpoint ${field}`);
  }
  sortedUniqueStrings(checkpoint.finding_ids, "checkpoint finding IDs", {allowEmpty: true});
  assert(["BUILDING", "AUDITING", "TERMINAL_PROPOSED", "REPAIR_REQUIRED", "SETTLED", "SUPERSEDED"].includes(checkpoint.status), "checkpoint status is invalid");
  if (checkpoint.status === "SETTLED") assert(checkpoint.audit_reconciliation_sha256 !== null, "settled checkpoint lacks audit reconciliation");
  const body = structuredClone(checkpoint);
  delete body.checkpoint_sha256;
  assert(checkpoint.checkpoint_sha256 === lifecycleDigest(body), "checkpoint digest is not content-addressed");
  return checkpoint;
}

export function compileCheckpointLedger(entries, activeCandidateId) {
  assert(Array.isArray(entries) && entries.length > 0, "checkpoint ledger must contain an entry");
  requireIdentifier(activeCandidateId, "active checkpoint candidate");
  const ledger = {
    entries: entries.map((entry) => structuredClone(entry)),
    active_candidate_id: activeCandidateId,
    ledger_sha256: "",
  };
  const body = structuredClone(ledger);
  delete body.ledger_sha256;
  ledger.ledger_sha256 = lifecycleDigest(body);
  validateCheckpointLedger(ledger);
  return ledger;
}

export function validateCheckpointLedger(ledger) {
  exactKeys(ledger, ["entries", "active_candidate_id", "ledger_sha256"], "checkpoint ledger");
  assert(Array.isArray(ledger.entries) && ledger.entries.length > 0, "checkpoint ledger entries are required");
  requireIdentifier(ledger.active_candidate_id, "active checkpoint candidate");
  const seen = new Set();
  for (const [index, checkpoint] of ledger.entries.entries()) {
    validateCheckpoint(checkpoint);
    assert(!seen.has(checkpoint.candidate_id), "checkpoint ledger contains duplicate candidate identity");
    seen.add(checkpoint.candidate_id);
    if (index === 0) assert(checkpoint.parent_candidate_id === null, "first checkpoint unexpectedly has a parent");
    else assert(checkpoint.parent_candidate_id === null || seen.has(checkpoint.parent_candidate_id), "checkpoint parent is not earlier in the ledger");
  }
  assert(seen.has(ledger.active_candidate_id), "checkpoint ledger active candidate is missing");
  const body = structuredClone(ledger);
  delete body.ledger_sha256;
  assert(ledger.ledger_sha256 === lifecycleDigest(body), "checkpoint ledger digest is not content-addressed");
  return ledger;
}

function validateHold(hold) {
  exactKeys(hold, ["hold_id", "kind", "scope", "authority_boundary", "resume_condition", "owner_role_id", "created_at_utc"], "lifecycle hold");
  requireIdentifier(hold.hold_id, "hold ID");
  assert(HOLD_KINDS.includes(hold.kind), "hold kind is invalid");
  for (const field of ["scope", "authority_boundary", "resume_condition", "owner_role_id"]) requireString(hold[field], `hold ${field}`);
  requireUtc(hold.created_at_utc, "hold created_at_utc");
}

function validateFinalizer(finalizer, state) {
  if (finalizer === null) return;
  exactKeys(finalizer, ["session_id", "worktree_id", "branch", "source_candidate_id", "source_commit", "source_tree", "lease_id", "goal_sha256", "status", "final_commit", "final_tree", "clean", "pushed", "scope_finding_ids", "repair_passes", "reframes", "finalizer_sha256"], "Campaign Finalizer");
  for (const field of ["session_id", "worktree_id", "source_candidate_id", "source_commit", "source_tree", "lease_id", "status"]) requireIdentifier(finalizer[field], `Finalizer ${field}`);
  requireSha(finalizer.goal_sha256, "Finalizer goal");
  requireString(finalizer.branch, "Finalizer branch");
  assert(finalizer.source_candidate_id === state.checkpoint_ledger.active_candidate_id, "Finalizer source candidate is not the active terminal checkpoint");
  assert(finalizer.status === "ACTIVE" || finalizer.status === "COMPLETE", "Finalizer status is invalid");
  if (finalizer.status === "ACTIVE") {
    assert(finalizer.final_commit === null && finalizer.final_tree === null && finalizer.clean === null && finalizer.pushed === null, "active Finalizer carries final identity");
  } else {
    for (const field of ["final_commit", "final_tree"]) requireString(finalizer[field], `Finalizer ${field}`);
    assert(finalizer.clean === true && finalizer.pushed === true, "complete Finalizer must be clean and pushed");
  }
  sortedUniqueStrings(finalizer.scope_finding_ids, "Finalizer finding scope", {allowEmpty: true});
  assert(Number.isSafeInteger(finalizer.repair_passes) && finalizer.repair_passes >= 0 && finalizer.repair_passes <= 1, "Finalizer repair pass limit exceeded");
  assert(Number.isSafeInteger(finalizer.reframes) && finalizer.reframes >= 0 && finalizer.reframes <= 1, "Finalizer reframe limit exceeded");
  requireSha(finalizer.finalizer_sha256, "Finalizer digest");
  const body = structuredClone(finalizer);
  delete body.finalizer_sha256;
  assert(finalizer.finalizer_sha256 === lifecycleDigest(body), "Finalizer digest is not content-addressed");
}

function emptySuccessorOrientation() {
  return {
    status: "NONE",
    orchestrator_binding: null,
    predeployment_candidate_sha256: null,
    live_delta_sha256: null,
    final_candidate_sha256: null,
    auditor_binding: null,
    feature_agent_bindings: [],
    platform_agent_bindings: [],
    product_writer_lease: "NONE",
  };
}

function validateSuccessorOrientation(orientation, state) {
  exactKeys(orientation, ["status", "orchestrator_binding", "predeployment_candidate_sha256", "live_delta_sha256", "final_candidate_sha256", "auditor_binding", "feature_agent_bindings", "platform_agent_bindings", "product_writer_lease"], "next-campaign orientation");
  assert(SUCCESSOR_STATUSES.includes(orientation.status), "next-campaign orientation status is invalid");
  for (const field of ["orchestrator_binding", "auditor_binding"]) {
    if (orientation[field] !== null) validateIdentity(orientation[field], `next-campaign ${field}`);
  }
  for (const field of ["predeployment_candidate_sha256", "live_delta_sha256", "final_candidate_sha256"]) {
    if (orientation[field] !== null) requireSha(orientation[field], `next-campaign ${field}`);
  }
  assert(Array.isArray(orientation.feature_agent_bindings) && Array.isArray(orientation.platform_agent_bindings), "next-campaign roster bindings are invalid");
  assert(["NONE", "HELD_FOR_ADMISSION", "RELEASED"].includes(orientation.product_writer_lease), "next-campaign writer lease is invalid");
  if (orientation.status === "NONE") {
    assert(orientation.orchestrator_binding === null
      && orientation.predeployment_candidate_sha256 === null
      && orientation.live_delta_sha256 === null
      && orientation.final_candidate_sha256 === null
      && orientation.auditor_binding === null
      && orientation.feature_agent_bindings.length === 0
      && orientation.platform_agent_bindings.length === 0
      && orientation.product_writer_lease === "NONE", "empty next-campaign orientation contains invented state");
  }
  if (["ORCHESTRATOR_ORIENTED_HELD", "LIVE_DELTA_RECEIVED"].includes(orientation.status)) {
    assert(orientation.orchestrator_binding?.role_id === "CAMPAIGN_ORCHESTRATOR", "orientation must bind only the next Campaign Orchestrator");
    assert(orientation.orchestrator_binding.orientation_only === true, "oriented successor Orchestrator must be orientation-only");
    assert(orientation.predeployment_candidate_sha256 !== null, "oriented successor lacks predeployment candidate");
    assert(orientation.auditor_binding === null && orientation.feature_agent_bindings.length === 0 && orientation.platform_agent_bindings.length === 0, "oriented successor has a speculative roster");
    assert(orientation.product_writer_lease === "NONE", "oriented successor holds Product custody");
  }
  if (orientation.status === "ORCHESTRATOR_ORIENTED_HELD") assert(orientation.live_delta_sha256 === null, "oriented successor has premature live delta");
  if (orientation.status === "LIVE_DELTA_RECEIVED") assert(orientation.live_delta_sha256 !== null, "live-delta state lacks its delta digest");
  if (orientation.status === "CAMPAIGN_ADMITTED") {
    assert(orientation.orchestrator_binding?.role_id === "CAMPAIGN_ORCHESTRATOR", "admitted successor lacks Orchestrator");
    assert(orientation.auditor_binding?.role_id === "INDEPENDENT_AUDITOR", "admitted successor lacks Auditor");
    assert(orientation.feature_agent_bindings.length > 0, "admitted successor lacks Feature Agents");
    assert(orientation.final_candidate_sha256 !== null && orientation.product_writer_lease === "HELD_FOR_ADMISSION", "admitted successor lacks final candidate or writer lease");
    assert(state.stage === "ACCEPTED_LIVE_CLOSED", "successor roster may be admitted only after accepted-live closure");
  }
}

const PRODUCT_ROOTS = ["FUNCTION_REQUIREMENTS", "DESIGN_BIBLE", "SECURITY"];
const PRODUCT_ANSWERS = ["YES", "NO", "UNKNOWN", "NOT_APPLICABLE", "EXCEPTION_REQUESTED"];
const PRODUCT_LIFECYCLE = ["UNEVALUATED", "EVIDENCE_PENDING", "OPEN_REPAIR", "VERIFIED", "INVALIDATED"];

function validateProductQuestionStates(states) {
  assert(Array.isArray(states), "Product question states are required");
  let previous = null;
  const ids = new Set();
  for (const state of states) {
    exactKeys(state, ["question_id", "answer", "lifecycle"], "Product question state");
    requireIdentifier(state.question_id, "Product question ID");
    assert(/^(?:FR|DB|SEC)-/u.test(state.question_id), "Product question state is outside the three roots");
    assert(PRODUCT_ANSWERS.includes(state.answer), "Product question answer is invalid");
    assert(PRODUCT_LIFECYCLE.includes(state.lifecycle), "Product question lifecycle is invalid");
    assert(!ids.has(state.question_id), "Product question states contain duplicates");
    ids.add(state.question_id);
    if (previous !== null) assert(compareUtf8(previous, state.question_id) < 0, "Product question states must be UTF-8 sorted");
    previous = state.question_id;
  }
  return states;
}

function validateDerivedQuestionIds(values, label) {
  sortedUniqueStrings(values, label, {allowEmpty: true});
  assert(values.every((value) => /^(?:FR|DB|SEC)-/u.test(value)), `${label} contains a question outside the three roots`);
}

function validateAcceptance(acceptance) {
  exactKeys(acceptance, [
    "question_tree_sha256", "observations_sha256", "question_states", "open_question_ids",
    "invalidated_question_ids", "authorized_exception_ids", "root_non_applicability", "roots", "rc_ready",
    "final_candidate_commit", "final_candidate_tree", "auditor_session_id", "product_receipt_sha256",
  ], "Product acceptance");
  requireSha(acceptance.question_tree_sha256, "Product question tree");
  requireSha(acceptance.observations_sha256, "Product observations");
  const states = validateProductQuestionStates(acceptance.question_states);
  validateDerivedQuestionIds(acceptance.open_question_ids, "open Product questions");
  validateDerivedQuestionIds(acceptance.invalidated_question_ids, "invalidated Product questions");
  validateDerivedQuestionIds(acceptance.authorized_exception_ids, "authorized Product exceptions");
  exactKeys(acceptance.root_non_applicability, PRODUCT_ROOTS, "Product root non-applicability");
  for (const root of PRODUCT_ROOTS) {
    if (acceptance.root_non_applicability[root] !== null) requireSha(acceptance.root_non_applicability[root], `${root} non-applicability proof`);
  }
  const open = states.filter((state) => state.lifecycle !== "VERIFIED").map((state) => state.question_id).sort(compareUtf8);
  const invalidated = states.filter((state) => state.lifecycle === "INVALIDATED").map((state) => state.question_id).sort(compareUtf8);
  const exceptions = states.filter((state) => state.answer === "EXCEPTION_REQUESTED" && state.lifecycle === "VERIFIED").map((state) => state.question_id).sort(compareUtf8);
  assert(canonicalJson(acceptance.open_question_ids) === canonicalJson(open), "open Product question inventory is not derived");
  assert(canonicalJson(acceptance.invalidated_question_ids) === canonicalJson(invalidated), "invalidated Product question inventory is not derived");
  assert(canonicalJson(acceptance.authorized_exception_ids) === canonicalJson(exceptions), "authorized Product exception inventory is not derived");
  exactKeys(acceptance.roots, PRODUCT_ROOTS, "Product acceptance roots");
  for (const root of PRODUCT_ROOTS) assert(["PASS", "OPEN_REPAIR", "UNKNOWN"].includes(acceptance.roots[root]), `Product root ${root} is invalid`);
  const derivedRoots = Object.fromEntries(PRODUCT_ROOTS.map((root) => {
    const prefix = root === "FUNCTION_REQUIREMENTS" ? "FR-" : root === "DESIGN_BIBLE" ? "DB-" : "SEC-";
    const rootStates = states.filter((state) => state.question_id.startsWith(prefix));
    if (rootStates.length === 0) {
      assert(acceptance.root_non_applicability[root] !== null, `${root} lacks an active question or non-applicability proof`);
      return [root, "PASS"];
    }
    assert(acceptance.root_non_applicability[root] === null, `${root} has both active questions and non-applicability proof`);
    if (rootStates.some((state) => state.lifecycle === "OPEN_REPAIR")) return [root, "OPEN_REPAIR"];
    if (rootStates.some((state) => state.lifecycle !== "VERIFIED")) return [root, "UNKNOWN"];
    return [root, "PASS"];
  }));
  assert(canonicalJson(acceptance.roots) === canonicalJson(derivedRoots), "Product root status is not derived from question states");
  const rootsPass = PRODUCT_ROOTS.every((root) => acceptance.roots[root] === "PASS");
  assert(typeof acceptance.rc_ready === "boolean" && acceptance.rc_ready === (rootsPass && open.length === 0 && invalidated.length === 0), "RC_READY is not the exact three-root conjunction");
  requireString(acceptance.final_candidate_commit, "accepted final commit");
  requireString(acceptance.final_candidate_tree, "accepted final tree");
  requireString(acceptance.auditor_session_id, "acceptance Auditor");
  requireSha(acceptance.product_receipt_sha256, "Product acceptance receipt");
  const body = structuredClone(acceptance);
  delete body.product_receipt_sha256;
  assert(acceptance.product_receipt_sha256 === lifecycleDigest(body), "Product acceptance receipt is not content-addressed");
}

export function compileProductAcceptance({
  questionTreeSha256,
  observationsSha256,
  questionStates = [],
  rootNonApplicability = {FUNCTION_REQUIREMENTS: null, DESIGN_BIBLE: null, SECURITY: null},
  roots,
  finalCandidateCommit,
  finalCandidateTree,
  auditorSessionId,
}) {
  const acceptance = {
    question_tree_sha256: questionTreeSha256,
    observations_sha256: observationsSha256,
    question_states: structuredClone(questionStates).sort((left, right) => compareUtf8(left.question_id, right.question_id)),
    open_question_ids: [],
    invalidated_question_ids: [],
    authorized_exception_ids: [],
    root_non_applicability: structuredClone(rootNonApplicability),
    roots: structuredClone(roots),
    rc_ready: false,
    final_candidate_commit: finalCandidateCommit,
    final_candidate_tree: finalCandidateTree,
    auditor_session_id: auditorSessionId,
    product_receipt_sha256: "",
  };
  const states = validateProductQuestionStates(acceptance.question_states);
  acceptance.open_question_ids = states.filter((state) => state.lifecycle !== "VERIFIED").map((state) => state.question_id).sort(compareUtf8);
  acceptance.invalidated_question_ids = states.filter((state) => state.lifecycle === "INVALIDATED").map((state) => state.question_id).sort(compareUtf8);
  acceptance.authorized_exception_ids = states.filter((state) => state.answer === "EXCEPTION_REQUESTED" && state.lifecycle === "VERIFIED").map((state) => state.question_id).sort(compareUtf8);
  acceptance.rc_ready = PRODUCT_ROOTS.every((root) => roots[root] === "PASS")
    && acceptance.open_question_ids.length === 0 && acceptance.invalidated_question_ids.length === 0;
  const body = structuredClone(acceptance);
  delete body.product_receipt_sha256;
  acceptance.product_receipt_sha256 = lifecycleDigest(body);
  validateAcceptance(acceptance);
  return acceptance;
}

function validateRoster(roster) {
  exactKeys(roster, ["campaign_orchestrator", "auditor", "feature_agents"], "campaign roster");
  validateIdentity(roster.campaign_orchestrator, "campaign Orchestrator");
  validateIdentity(roster.auditor, "campaign Auditor");
  assert(roster.campaign_orchestrator.role_id === "CAMPAIGN_ORCHESTRATOR" && roster.auditor.role_id === "INDEPENDENT_AUDITOR", "campaign roster roles are invalid");
  assert(Array.isArray(roster.feature_agents) && roster.feature_agents.length > 0, "campaign Feature roster is empty");
  const sessions = new Set([roster.campaign_orchestrator.session_id, roster.auditor.session_id]);
  for (const feature of roster.feature_agents) {
    validateIdentity(feature, "campaign Feature Agent");
    assert(feature.role_id.startsWith("FEATURE_AGENT:"), "campaign Feature Agent role is invalid");
    assert(!sessions.has(feature.session_id), "campaign roster session is reused");
    sessions.add(feature.session_id);
  }
}

function validateLivingLedgerBinding(binding) {
  exactKeys(binding, ["events_root", "current_view_path", "event_count", "ledger_sha256", "current_view_sha256", "writer_heads"], "living ledger binding");
  for (const field of ["events_root", "current_view_path"]) validateRelativePath(binding[field], `living ledger ${field}`);
  assert(Number.isSafeInteger(binding.event_count) && binding.event_count >= 0, "living ledger event_count is invalid");
  requireSha(binding.ledger_sha256, "living ledger digest");
  requireSha(binding.current_view_sha256, "living current-view digest");
  requireRecord(binding.writer_heads, "living ledger writer heads");
  for (const [writer, head] of Object.entries(binding.writer_heads)) {
    requireIdentifier(writer, "living ledger writer");
    requireSha(head, "living ledger writer head");
  }
}

function validateTransitionJournal(journal, currentStage) {
  assert(Array.isArray(journal) && journal.length > 0, "lifecycle transition journal is required");
  for (const [index, entry] of journal.entries()) {
    exactKeys(entry, TRANSITION_KEYS, "lifecycle transition journal entry");
    assert(Number.isSafeInteger(entry.sequence) && entry.sequence === index, "lifecycle transition sequence is not contiguous");
    if (entry.from_state_sha256 !== null) requireSha(entry.from_state_sha256, "lifecycle transition parent state");
    assert(entry.from_stage === null || LIFECYCLE_STAGES.includes(entry.from_stage), "lifecycle transition source stage is invalid");
    assert(LIFECYCLE_STAGES.includes(entry.to_stage), "lifecycle transition target stage is invalid");
    requireIdentifier(entry.event_type, "lifecycle transition event type");
    requireRecord(entry.payload, "lifecycle transition payload");
    requireUtc(entry.at_utc, "lifecycle transition time");
    requireSha(entry.event_sha256, "lifecycle transition event digest");
    if (index === 0) {
      assert(entry.from_state_sha256 === null && entry.from_stage === null && entry.event_type === "GENESIS",
        "lifecycle transition journal has invalid genesis");
    } else {
      const previous = journal[index - 1];
      assert(entry.from_state_sha256 !== null && entry.from_stage === previous.to_stage,
        "lifecycle transition journal parent is not bound to the previous stage");
    }
    const body = structuredClone(entry);
    delete body.event_sha256;
    assert(entry.event_sha256 === lifecycleDigest(body), "lifecycle transition event is not content-addressed");
  }
  assert(journal.at(-1).to_stage === currentStage, "lifecycle transition journal does not end at the current stage");
}

function appendTransition(next, previous, event) {
  assert(Array.isArray(previous.transition_journal) && Array.isArray(next.transition_journal), "lifecycle transition journal is missing");
  assert(canonicalJson(next.transition_journal) === canonicalJson(previous.transition_journal),
    "lifecycle transition replaced the prior journal before appending");
  requireString(event?.type ?? "", "lifecycle event type");
  const atUtc = event.at_utc ?? new Date().toISOString();
  const entryBody = {
    sequence: next.transition_journal.length,
    from_state_sha256: previous.state_sha256,
    from_stage: previous.stage,
    to_stage: next.stage,
    event_type: event.type,
    payload: structuredClone(event.payload ?? {}),
    at_utc: atUtc,
  };
  const entry = {...entryBody, event_sha256: lifecycleDigest(entryBody)};
  next.transition_journal.push(entry);
  return next;
}

export function validateLifecycleState(state) {
  exactKeys(state, ["schema", "governance_version", "status", "campaign_id", "campaign_version", "logical_lineage_id", "stage", "root", "active_writer", "holds", "platform_pool", "checkpoint_ledger", "finalizer", "acceptance", "runtime", "roster", "successor_orientation", "living_ledger", "transition_journal", "state_sha256"], "campaign lifecycle state");
  assert(state.schema === "governance.campaign_lifecycle_state.v1" && state.governance_version === "2.1rc", "campaign lifecycle identity is invalid");
  assert(state.status === "PREPARED_NOT_ACTIVATED", "campaign lifecycle must remain prepared and inactive");
  for (const field of ["campaign_id", "campaign_version", "logical_lineage_id"]) requireIdentifier(state[field], `campaign ${field}`);
  assert(LIFECYCLE_STAGES.includes(state.stage), "campaign lifecycle stage is invalid");
  validateTransitionJournal(state.transition_journal, state.stage);
  validateRoot(state.root);
  if (state.active_writer !== null) {
    exactKeys(state.active_writer, ["kind", "role_id", "session_id", "lease_id", "worktree_id", "goal_sha256", "writable_scope"], "active writer");
    for (const field of ["kind", "role_id", "session_id", "lease_id", "worktree_id", "writable_scope"]) requireIdentifier(state.active_writer[field], `active writer ${field}`);
    requireSha(state.active_writer.goal_sha256, "active writer goal");
    assert(["FEATURE_AGENT", "CAMPAIGN_FINALIZER"].includes(state.active_writer.kind), "active writer kind is invalid");
  }
  assert(Array.isArray(state.holds), "lifecycle holds are missing");
  const holdIds = new Set();
  for (const hold of state.holds) {
    validateHold(hold);
    assert(!holdIds.has(hold.hold_id), "lifecycle hold IDs duplicate");
    holdIds.add(hold.hold_id);
  }
  assert(Array.isArray(state.platform_pool), "Platform pool is missing");
  const capabilityIds = new Set();
  const agentIds = new Set();
  for (const agent of state.platform_pool) {
    validatePlatformAgent(agent);
    assert(!capabilityIds.has(agent.logical_capability_id), "Platform capability is duplicated");
    assert(!agentIds.has(agent.logical_agent_id), "Platform logical agent is duplicated");
    capabilityIds.add(agent.logical_capability_id);
    agentIds.add(agent.logical_agent_id);
  }
  validateCheckpointLedger(state.checkpoint_ledger);
  const activeCheckpoint = state.checkpoint_ledger.entries.find((entry) => entry.candidate_id === state.checkpoint_ledger.active_candidate_id);
  assert(activeCheckpoint !== undefined, "active checkpoint is not in the ledger");
  if (["TERMINAL_PROPOSED", "FIRST_PASS_REPAIR_REQUIRED", "TERMINAL_SETTLED", "FINALIZER_ACTIVE", "FINALIZER_COMPLETE", "DELTA_AUDIT", "READY_FOR_ACCEPTANCE", "DEPLOYMENT_CLEARED", "ACCEPTED_LIVE_PENDING_CLOSURE", "ACCEPTED_LIVE_CLOSED"].includes(state.stage)) {
    assert(activeCheckpoint.terminal, `${state.stage} requires a terminal checkpoint`);
  }
  if (state.stage === "FIRST_PASS_REPAIR_REQUIRED") assert(activeCheckpoint.status === "REPAIR_REQUIRED", "repair-required stage lacks a repair checkpoint");
  validateFinalizer(state.finalizer, state);
  validateAcceptance(state.acceptance);
  exactKeys(state.runtime, ["session_id", "state_identity", "deployed_identity", "rollback_identity"], "Runtime binding");
  for (const field of ["session_id", "state_identity", "deployed_identity", "rollback_identity"]) requireString(state.runtime[field], `Runtime ${field}`);
  validateRoster(state.roster);
  assert(state.acceptance.auditor_session_id === state.roster.auditor.session_id || state.stage === "BUILDING" || state.stage === "TERMINAL_PROPOSED" || state.stage === "FIRST_PASS_REPAIR_REQUIRED" || state.stage === "TERMINAL_SETTLED" || state.stage === "FINALIZER_ACTIVE" || state.stage === "FINALIZER_COMPLETE" || state.stage === "DELTA_AUDIT",
    "Product acceptance Auditor is not the current campaign Auditor");
  const featureBindings = new Map(state.roster.feature_agents.map((feature) => [feature.session_id, feature.role_id]));
  for (const agent of state.platform_pool) {
    if (agent.supervision === null) continue;
    const role = featureBindings.get(agent.supervision.feature_session_id);
    assert(role === `FEATURE_AGENT:${agent.supervision.feature_agent_id}`,
      "Platform supervision is not bound to the current Feature Agent roster");
  }
  validateSuccessorOrientation(state.successor_orientation, state);
  validateLivingLedgerBinding(state.living_ledger);
  if (state.stage === "FINALIZER_ACTIVE") assert(state.finalizer?.status === "ACTIVE" && state.active_writer?.kind === "CAMPAIGN_FINALIZER", "Finalizer custody is not active");
  if (state.stage === "FINALIZER_COMPLETE") assert(state.finalizer?.status === "COMPLETE" && state.active_writer === null, "completed Finalizer still holds Product custody");
  if (["READY_FOR_ACCEPTANCE", "DEPLOYMENT_CLEARED", "ACCEPTED_LIVE_PENDING_CLOSURE", "ACCEPTED_LIVE_CLOSED"].includes(state.stage)) {
    assert(state.acceptance.rc_ready === true, `${state.stage} lacks all three Product roots`);
    assert(state.acceptance.final_candidate_commit === state.root.commit && state.acceptance.final_candidate_tree === state.root.tree,
      `${state.stage} Product acceptance is not bound to the campaign root`);
  }
  if (state.stage === "ACCEPTED_LIVE_CLOSED") assert(state.active_writer === null && state.holds.length === 0, "accepted-live closure is incomplete");
  const body = structuredClone(state);
  delete body.state_sha256;
  assert(state.state_sha256 === lifecycleDigest(body), "campaign lifecycle state is not content-addressed");
  return state;
}

export function sealLifecycleState(state) {
  const next = structuredClone(state);
  if (!Array.isArray(next.transition_journal) || next.transition_journal.length === 0) {
    const genesisBody = {
      sequence: 0,
      from_state_sha256: null,
      from_stage: null,
      to_stage: next.stage,
      event_type: "GENESIS",
      payload: {campaign_id: next.campaign_id, campaign_version: next.campaign_version, logical_lineage_id: next.logical_lineage_id},
      at_utc: GENESIS_UTC,
    };
    next.transition_journal = [{...genesisBody, event_sha256: lifecycleDigest(genesisBody)}];
  } else {
    assert(next.transition_journal.at(-1).to_stage === next.stage,
      "a stage change requires applyLifecycleTransition and a journal entry");
  }
  delete next.state_sha256;
  next.state_sha256 = lifecycleDigest(next);
  validateLifecycleState(next);
  return next;
}

export function createLifecycleState(input) {
  requireRecord(input, "campaign lifecycle input");
  const firstCheckpoint = input.checkpoint_ledger ?? compileCheckpointLedger([compileCheckpoint(input.first_checkpoint)], input.first_checkpoint.candidate_id);
  const state = {
    schema: "governance.campaign_lifecycle_state.v1",
    governance_version: "2.1rc",
    status: "PREPARED_NOT_ACTIVATED",
    campaign_id: input.campaign_id,
    campaign_version: input.campaign_version,
    logical_lineage_id: input.logical_lineage_id,
    stage: input.stage ?? "BUILDING",
    root: structuredClone(input.root),
    active_writer: input.active_writer ?? null,
    holds: structuredClone(input.holds ?? []),
    platform_pool: structuredClone(input.platform_pool ?? []),
    checkpoint_ledger: structuredClone(firstCheckpoint),
    finalizer: input.finalizer ?? null,
    acceptance: structuredClone(input.acceptance),
    runtime: structuredClone(input.runtime),
    roster: structuredClone(input.roster),
    successor_orientation: structuredClone(input.successor_orientation ?? emptySuccessorOrientation()),
    living_ledger: structuredClone(input.living_ledger),
    transition_journal: [],
    state_sha256: "",
  };
  return sealLifecycleState(state);
}

function assertLineage(previous, next) {
  for (const field of ["campaign_id", "campaign_version", "logical_lineage_id"]) assert(previous[field] === next[field], `lifecycle transition changed ${field}`);
}

export function applyLifecycleTransition(previous, next, event = {}) {
  validateLifecycleState(previous);
  const candidate = structuredClone(next);
  assertLineage(previous, candidate);
  assert(canonicalJson(candidate.transition_journal) === canonicalJson(previous.transition_journal),
    "lifecycle transition must append to the current journal");
  assert(ALLOWED_TRANSITIONS[previous.stage]?.has(candidate.stage), `illegal lifecycle transition ${previous.stage} -> ${candidate.stage}`);
  requireString(event.type ?? "LIFECYCLE_TRANSITION", "lifecycle event type");
  if (previous.stage === "TERMINAL_PROPOSED" && candidate.stage === "FIRST_PASS_REPAIR_REQUIRED") {
    const checkpoint = candidate.checkpoint_ledger.entries.find((entry) => entry.candidate_id === candidate.checkpoint_ledger.active_candidate_id);
    assert(checkpoint?.status === "REPAIR_REQUIRED", "immediate repair transition lacks repair-required checkpoint");
  }
  if (previous.stage === "FIRST_PASS_REPAIR_REQUIRED" && candidate.stage === "BUILDING") {
    assert(previous.checkpoint_ledger.active_candidate_id !== candidate.checkpoint_ledger.active_candidate_id, "first-pass repair rewrote the terminal candidate identity");
    const checkpoint = candidate.checkpoint_ledger.entries.find((entry) => entry.candidate_id === candidate.checkpoint_ledger.active_candidate_id);
    assert(checkpoint?.parent_candidate_id === previous.checkpoint_ledger.active_candidate_id, "repair checkpoint does not bind its terminal parent");
  }
  if (previous.stage === "TERMINAL_SETTLED" && candidate.stage === "FINALIZER_ACTIVE") {
    assert(previous.active_writer === null && candidate.active_writer?.kind === "CAMPAIGN_FINALIZER", "Finalizer handoff did not transfer exclusive writer custody");
  }
  if (previous.stage === "FINALIZER_ACTIVE" && candidate.stage === "FINALIZER_COMPLETE") {
    assert(candidate.active_writer === null && candidate.finalizer?.status === "COMPLETE", "Finalizer completion did not release custody");
  }
  if (previous.stage === "FINALIZER_COMPLETE" && candidate.stage === "DELTA_AUDIT") {
    const finalCommit = candidate.finalizer.final_commit;
    const finalTree = candidate.finalizer.final_tree;
    assert(candidate.root.commit === finalCommit && candidate.root.tree === finalTree && candidate.root.remote_commit === finalCommit && candidate.root.remote_tree === finalTree, "campaign root did not adopt exact Finalizer output");
  }
  appendTransition(candidate, previous, event);
  const sealed = sealLifecycleState(candidate);
  assert(sealed.state_sha256 !== previous.state_sha256, "lifecycle transition did not change state");
  return sealed;
}

export function handoffToFinalizer(state, finalizer, atUtc = new Date().toISOString()) {
  validateLifecycleState(state);
  assert(state.stage === "TERMINAL_SETTLED", "Finalizer handoff requires terminal audit settlement");
  assert(state.active_writer === null, "Feature writer must release custody before Finalizer handoff");
  const next = structuredClone(state);
  next.finalizer = structuredClone(finalizer);
  next.active_writer = {
    kind: "CAMPAIGN_FINALIZER",
    role_id: "CAMPAIGN_FINALIZER",
    session_id: finalizer.session_id,
    lease_id: finalizer.lease_id,
    worktree_id: finalizer.worktree_id,
    goal_sha256: finalizer.goal_sha256,
    writable_scope: "CONSOLIDATED_FINDINGS_ONLY",
  };
  next.stage = "FINALIZER_ACTIVE";
  return applyLifecycleTransition(state, next, {
    type: "FINALIZER_ADMISSION",
    at_utc: atUtc,
    payload: {finalizer_session_id: finalizer.session_id, source_candidate_id: finalizer.source_candidate_id},
  });
}

export function completeFinalizer(state, finalCommit, finalTree, atUtc = new Date().toISOString()) {
  validateLifecycleState(state);
  assert(state.stage === "FINALIZER_ACTIVE", "Finalizer completion requires active Finalizer custody");
  requireIdentifier(finalCommit, "Finalizer final commit");
  requireIdentifier(finalTree, "Finalizer final tree");
  const next = structuredClone(state);
  next.finalizer.status = "COMPLETE";
  next.finalizer.final_commit = finalCommit;
  next.finalizer.final_tree = finalTree;
  next.finalizer.clean = true;
  next.finalizer.pushed = true;
  const body = structuredClone(next.finalizer);
  delete body.finalizer_sha256;
  next.finalizer.finalizer_sha256 = lifecycleDigest(body);
  next.active_writer = null;
  next.stage = "FINALIZER_COMPLETE";
  return applyLifecycleTransition(state, next, {
    type: "FINALIZER_COMPLETION",
    at_utc: atUtc,
    payload: {final_commit: finalCommit, final_tree: finalTree},
  });
}

export function adoptFinalizerRoot(state, atUtc = new Date().toISOString()) {
  validateLifecycleState(state);
  assert(state.stage === "FINALIZER_COMPLETE", "Finalizer root adoption requires completed Finalizer");
  const next = structuredClone(state);
  const finalizer = next.finalizer;
  next.root.commit = finalizer.final_commit;
  next.root.tree = finalizer.final_tree;
  next.root.remote_commit = finalizer.final_commit;
  next.root.remote_tree = finalizer.final_tree;
  next.root.clean = true;
  next.root.pushed = true;
  next.stage = "DELTA_AUDIT";
  return applyLifecycleTransition(state, next, {
    type: "FINALIZER_ROOT_ADOPTION",
    at_utc: atUtc,
    payload: {final_commit: finalizer.final_commit, final_tree: finalizer.final_tree},
  });
}

export function setHold(state, hold) {
  validateLifecycleState(state);
  validateHold(hold);
  const next = structuredClone(state);
  assert(!next.holds.some((item) => item.hold_id === hold.hold_id), "hold ID already exists");
  next.holds.push(structuredClone(hold));
  next.holds.sort((left, right) => compareUtf8(left.hold_id, right.hold_id));
  return applyLifecycleTransition(state, next, {
    type: "HOLD_SET",
    at_utc: hold.created_at_utc,
    payload: {hold_id: hold.hold_id, scope: hold.scope, kind: hold.kind},
  });
}

export function clearHold(state, holdId, evidenceSha256) {
  validateLifecycleState(state);
  requireIdentifier(holdId, "hold ID");
  requireSha(evidenceSha256, "hold resolution evidence");
  const next = structuredClone(state);
  const before = next.holds.length;
  next.holds = next.holds.filter((hold) => hold.hold_id !== holdId);
  assert(next.holds.length === before - 1, "hold is not active");
  return applyLifecycleTransition(state, next, {
    type: "HOLD_CLEARED",
    payload: {hold_id: holdId, resolution_evidence_sha256: evidenceSha256},
  });
}

export function orientNextCampaignOrchestrator(state, binding, predeploymentCandidateSha256) {
  validateLifecycleState(state);
  assert(["READY_FOR_ACCEPTANCE", "DEPLOYMENT_CLEARED"].includes(state.stage), "next Orchestrator orientation requires release clearance");
  validateIdentity(binding, "next Campaign Orchestrator");
  assert(binding.role_id === "CAMPAIGN_ORCHESTRATOR" && binding.orientation_only === true, "successor orientation must be Orchestrator-only");
  requireSha(predeploymentCandidateSha256, "predeployment candidate digest");
  assert(state.successor_orientation.status === "NONE", "next Orchestrator is already oriented");
  const next = structuredClone(state);
  next.successor_orientation = {
    ...emptySuccessorOrientation(),
    status: "ORCHESTRATOR_ORIENTED_HELD",
    orchestrator_binding: structuredClone(binding),
    predeployment_candidate_sha256: predeploymentCandidateSha256,
  };
  return applyLifecycleTransition(state, next, {
    type: "NEXT_ORCHESTRATOR_ORIENTED",
    payload: {orchestrator_session_id: binding.session_id, predeployment_candidate_sha256: predeploymentCandidateSha256},
  });
}

export function recordLiveDelta(state, orchestratorSessionId, liveDeltaSha256) {
  validateLifecycleState(state);
  requireIdentifier(orchestratorSessionId, "oriented Orchestrator session");
  requireSha(liveDeltaSha256, "live delta digest");
  assert(state.stage === "ACCEPTED_LIVE_PENDING_CLOSURE", "live delta requires accepted-live pending closure");
  assert(state.successor_orientation.status === "ORCHESTRATOR_ORIENTED_HELD", "live delta has no oriented successor");
  assert(state.successor_orientation.orchestrator_binding.session_id === orchestratorSessionId, "live delta is bound to the wrong Orchestrator");
  const next = structuredClone(state);
  next.successor_orientation.status = "LIVE_DELTA_RECEIVED";
  next.successor_orientation.live_delta_sha256 = liveDeltaSha256;
  return applyLifecycleTransition(state, next, {
    type: "NEXT_ORCHESTRATOR_LIVE_DELTA_RECEIVED",
    payload: {orchestrator_session_id: orchestratorSessionId, live_delta_sha256: liveDeltaSha256},
  });
}

export function admitNextCampaign(state, {finalCandidateSha256, auditorBinding, featureAgentBindings, platformAgentBindings = []}) {
  validateLifecycleState(state);
  assert(state.stage === "ACCEPTED_LIVE_CLOSED", "next campaign admission requires accepted-live closure");
  assert(state.successor_orientation.status === "LIVE_DELTA_RECEIVED", "next campaign admission requires the live delta");
  requireSha(finalCandidateSha256, "next campaign final candidate");
  validateIdentity(auditorBinding, "next campaign Auditor");
  assert(auditorBinding.role_id === "INDEPENDENT_AUDITOR" && auditorBinding.orientation_only === false, "next campaign Auditor binding is invalid");
  assert(Array.isArray(featureAgentBindings) && featureAgentBindings.length > 0, "next campaign Feature roster is empty");
  for (const binding of featureAgentBindings) {
    validateIdentity(binding, "next Feature Agent");
    assert(binding.role_id.startsWith("FEATURE_AGENT:") && binding.orientation_only === false, "next Feature Agent binding is invalid");
  }
  for (const binding of platformAgentBindings) {
    validateIdentity(binding, "next Platform Agent");
    assert(binding.role_id.startsWith("PLATFORM_AGENT:") && binding.orientation_only === false, "next Platform Agent binding is invalid");
  }
  const next = structuredClone(state);
  next.successor_orientation.status = "CAMPAIGN_ADMITTED";
  next.successor_orientation.final_candidate_sha256 = finalCandidateSha256;
  next.successor_orientation.auditor_binding = structuredClone(auditorBinding);
  next.successor_orientation.feature_agent_bindings = structuredClone(featureAgentBindings);
  next.successor_orientation.platform_agent_bindings = structuredClone(platformAgentBindings);
  next.successor_orientation.product_writer_lease = "HELD_FOR_ADMISSION";
  return applyLifecycleTransition(state, next, {
    type: "NEXT_CAMPAIGN_ADMITTED",
    payload: {final_candidate_sha256: finalCandidateSha256, feature_count: featureAgentBindings.length, platform_count: platformAgentBindings.length},
  });
}

function validateEvent(event) {
  exactKeys(event, ["sequence", "event_id", "writer_session_id", "event_type", "payload", "prior_writer_head_sha256", "event_sha256", "created_at_utc"], "living campaign event");
  assert(Number.isSafeInteger(event.sequence) && event.sequence >= 0, "living event sequence is invalid");
  requireIdentifier(event.event_id, "living event ID");
  requireIdentifier(event.writer_session_id, "living event writer");
  requireIdentifier(event.event_type, "living event type");
  requireRecord(event.payload, "living event payload");
  if (event.prior_writer_head_sha256 !== null) requireSha(event.prior_writer_head_sha256, "living prior writer head");
  requireSha(event.event_sha256, "living event digest");
  requireUtc(event.created_at_utc, "living event time");
  const body = structuredClone(event);
  delete body.event_sha256;
  assert(event.event_sha256 === lifecycleDigest(body), "living event digest is not content-addressed");
}

export function compileLivingCampaignEvent({sequence, eventId, writerSessionId, eventType, payload, priorWriterHeadSha256 = null, createdAtUtc}) {
  const body = {
    sequence,
    event_id: eventId,
    writer_session_id: writerSessionId,
    event_type: eventType,
    payload: structuredClone(payload),
    prior_writer_head_sha256: priorWriterHeadSha256,
    created_at_utc: createdAtUtc,
  };
  const event = {...body, event_sha256: lifecycleDigest(body)};
  validateEvent(event);
  return event;
}

export function validateLivingCampaignLedger(events, {allowEmpty = true} = {}) {
  assert(Array.isArray(events), "living campaign events must be an array");
  if (!allowEmpty) assert(events.length > 0, "living campaign events are empty");
  const heads = new Map();
  events.forEach((event, index) => {
    validateEvent(event);
    assert(event.sequence === index, "living events must have contiguous sequence numbers");
    const head = heads.get(event.writer_session_id) ?? null;
    assert(event.prior_writer_head_sha256 === head, "living event chain is not append-only per writer");
    heads.set(event.writer_session_id, event.event_sha256);
  });
  return Object.fromEntries([...heads.entries()].sort((left, right) => compareUtf8(left[0], right[0])));
}

export function appendLivingCampaignEvent(authorityRoot, relativePath, event, expectedBytes = null) {
  requireString(authorityRoot, "authority root");
  validateRelativePath(relativePath, "living event path");
  validateEvent(event);
  const root = fs.realpathSync.native(path.resolve(authorityRoot));
  const target = path.resolve(root, relativePath);
  assert(target === root || target.startsWith(`${root}${path.sep}`), "living event path escapes authority root");
  let current = root;
  for (const segment of path.relative(root, path.dirname(target)).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (fs.existsSync(current)) {
      const stat = fs.lstatSync(current);
      assert(stat.isDirectory() && !stat.isSymbolicLink(), "living event path traverses an unsafe directory");
    } else {
      fs.mkdirSync(current);
    }
  }
  const lockPath = `${target}.lock`;
  let lockDescriptor;
  try {
    lockDescriptor = fs.openSync(lockPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
    if (fs.existsSync(target)) {
      const targetStat = fs.lstatSync(target);
      assert(targetStat.isFile() && !targetStat.isSymbolicLink(), "living event target is not a regular file");
    }
    const observed = fs.existsSync(target) ? fs.readFileSync(target) : Buffer.alloc(0);
    if (expectedBytes !== null) assert(observed.equals(expectedBytes), "living event compare-and-swap failed");
    const existingEvents = observed.length === 0
      ? []
      : observed.toString("utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
    const existingHeads = validateLivingCampaignLedger(existingEvents);
    assert(event.sequence === existingEvents.length, "living event sequence does not append to the current ledger");
    assert(event.prior_writer_head_sha256 === (existingHeads[event.writer_session_id] ?? null), "living event writer head does not append to the current ledger");
    const line = Buffer.from(`${canonicalJson(event)}\n`, "utf8");
    const descriptor = fs.openSync(target, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND | (fs.constants.O_NOFOLLOW ?? 0), 0o644);
    try {
      fs.writeFileSync(descriptor, line);
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("living event compare-and-swap lock is already held");
    throw error;
  } finally {
    if (lockDescriptor !== undefined) fs.closeSync(lockDescriptor);
    try { fs.unlinkSync(lockPath); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  }
  return {path: relativePath, event_sha256: event.event_sha256};
}

export function writeStateCompareAndSwap(targetPath, expectedBytes, nextState) {
  requireString(targetPath, "state path");
  assert(Buffer.isBuffer(expectedBytes), "expected state bytes must be a Buffer");
  validateLifecycleState(nextState);
  const target = path.resolve(targetPath);
  const directory = path.dirname(target);
  fs.mkdirSync(directory, {recursive: true});
  if (fs.existsSync(target)) {
    const targetStat = fs.lstatSync(target);
    assert(targetStat.isFile() && !targetStat.isSymbolicLink(), "state target is not a regular file");
  }
  const current = fs.existsSync(target) ? fs.readFileSync(target) : Buffer.alloc(0);
  assert(current.equals(expectedBytes), "state compare-and-swap expected bytes do not match");
  const lockPath = `${target}.lock`;
  let lockDescriptor;
  let temporary = null;
  try {
    lockDescriptor = fs.openSync(lockPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
    if (fs.existsSync(target)) {
      const targetStat = fs.lstatSync(target);
      assert(targetStat.isFile() && !targetStat.isSymbolicLink(), "state target is not a regular file");
    }
    const lockedCurrent = fs.existsSync(target) ? fs.readFileSync(target) : Buffer.alloc(0);
    assert(lockedCurrent.equals(expectedBytes), "state compare-and-swap observed a changed state");
    temporary = path.join(directory, `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.next`);
    const bytes = Buffer.from(`${canonicalJson(nextState)}\n`, "utf8");
    const descriptor = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o644);
    try {
      fs.writeFileSync(descriptor, bytes);
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    if (fs.existsSync(target)) {
      const targetStat = fs.lstatSync(target);
      assert(targetStat.isFile() && !targetStat.isSymbolicLink(), "state target changed to an unsafe object");
    }
    const beforeRename = fs.existsSync(target) ? fs.readFileSync(target) : Buffer.alloc(0);
    assert(beforeRename.equals(expectedBytes), "state compare-and-swap changed before commit");
    fs.renameSync(temporary, target);
    temporary = null;
  } finally {
    if (temporary !== null) {
      try { fs.unlinkSync(temporary); } catch (error) { if (error?.code !== "ENOENT") throw error; }
    }
    if (lockDescriptor !== undefined) fs.closeSync(lockDescriptor);
    try { fs.unlinkSync(lockPath); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  }
  return nextState.state_sha256;
}

export function decideHeartbeatAction(state, observedAtUtc, nowUtc) {
  validateLifecycleState(state);
  requireUtc(observedAtUtc, "last heartbeat");
  requireUtc(nowUtc, "current heartbeat");
  const ageMinutes = (Date.parse(nowUtc) - Date.parse(observedAtUtc)) / 60_000;
  assert(ageMinutes >= 0, "heartbeat time moves backward");
  return {
    action: ageMinutes >= 15 ? "RECONCILE" : "NO_ACTION",
    age_minutes: ageMinutes,
    interval_minutes: 15,
    unaffected_work_continues: true,
    hold_count: state.holds.length,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("campaign lifecycle controller loaded\n");
