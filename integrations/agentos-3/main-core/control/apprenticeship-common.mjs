#!/usr/bin/env node

import crypto from "node:crypto";

export const APPRENTICESHIP_MODE = "APPRENTICESHIP";
export const APPRENTICESHIP_VERSION = 1;
export const APPRENTICESHIP_CONTRACT_SCHEMA = "agentos.apprenticeship_contracts.v1";

export const APPRENTICESHIP_ROLES = Object.freeze([
  "APPRENTICESHIP_WORKER",
  "WALKTHROUGH_ORCHESTRATOR",
  "WORKFLOW_AUDITOR",
  "INDEPENDENT_AUDITOR",
]);

export const APPRENTICESHIP_STATES = Object.freeze([
  "DRAFT",
  "OWNER_BOUND",
  "ADMITTED",
  "WORKING",
  "WORK_RESULT_READY",
  "CANDIDATE_COMPILED",
  "DRILLING",
  "DRILL_INCOMPLETE",
  "UNKNOWN_BLOCKED",
  "DRILL_COMPLETE_NON_ACCEPTING",
  "REPRODUCTION_PENDING",
  "REPRODUCED",
  "REPRODUCTION_FAILED",
  "HANDOFF_READY",
  "OWNER_REVIEW_REQUIRED",
  "OWNER_APPROVED_PENDING_ACTIVATION",
  "REPAIR_REQUIRED",
  "HARD_STOP",
  "SOFT_REVIEW",
  "REASSESS",
  "ARCHIVING",
  "ARCHIVED",
]);

export const DRILL_ANSWERS = Object.freeze(["ANSWERED", "UNKNOWN", "INCOMPLETE"]);
export const DRILL_COMPARISON_STATUSES = Object.freeze(["MATCHED", "UNKNOWN", "MISMATCH", "INCOMPLETE"]);
export const DRILL_LIFECYCLE_OPERATIONS = Object.freeze([
  "create_thread",
  "pin",
  "send",
  "wait",
  "read",
  "unpin",
  "archive",
  "post_close_read",
  "active_list_absent",
]);

export const DRILL_QUESTIONS = Object.freeze([
  Object.freeze({
    question_id: "WAD-001",
    question: "What was the owner's intent and bounded result?",
    required_evidence: Object.freeze(["OWNER_INTENT", "BOUNDED_RESULT"]),
  }),
  Object.freeze({
    question_id: "WAD-002",
    question: "What was the first authorized action?",
    required_evidence: Object.freeze(["AUTHORIZATION", "FIRST_ACTION"]),
  }),
  Object.freeze({
    question_id: "WAD-003",
    question: "What exact source, scope, and workspace bindings were checked?",
    required_evidence: Object.freeze(["SOURCE_BINDING", "SCOPE_BINDING", "WORKSPACE_BINDING"]),
  }),
  Object.freeze({
    question_id: "WAD-004",
    question: "What evidence supports each reported result?",
    required_evidence: Object.freeze(["RESULT_EVIDENCE"]),
  }),
  Object.freeze({
    question_id: "WAD-005",
    question: "What was meaningful progress versus mere activity?",
    required_evidence: Object.freeze(["PROGRESS_CLASSIFICATION"]),
  }),
  Object.freeze({
    question_id: "WAD-006",
    question: "What uncertainty, drift, or identity mismatch was found?",
    required_evidence: Object.freeze(["UNCERTAINTY", "IDENTITY_CHECK"]),
  }),
  Object.freeze({
    question_id: "WAD-007",
    question: "What failure RCA exists, and why was any repair or non-repair deliberate?",
    required_evidence: Object.freeze(["RCA_OR_NOT_APPLICABLE", "REPAIR_DECISION"]),
  }),
  Object.freeze({
    question_id: "WAD-008",
    question: "What repeat conditions and protected actions remain?",
    required_evidence: Object.freeze(["REPEAT_CONDITIONS", "PROTECTED_ACTIONS"]),
  }),
]);

export const PROVENANCE_FIELDS = Object.freeze([
  "project_ref",
  "campaign_ref",
  "goal_ref",
  "source_ref",
  "tree_ref",
  "workspace_ref",
  "environment_ref",
  "worker_ref",
  "worker_session_ref",
  "orchestrator_ref",
  "orchestrator_session_ref",
  "learner_ref",
  "learner_session_ref",
  "auditor_ref",
  "auditor_session_ref",
  "reproduction_ref",
  "reproduction_session_ref",
  "reviewer_ref",
  "reviewer_session_ref",
  "model_ref",
  "predecessor_handoff_ref",
]);

export const PROTECTED_ACTIONS = Object.freeze({
  activation: false,
  acceptance: false,
  publication: false,
  deletion: false,
  product_writes: false,
  external_actions: false,
  secrets: false,
  spend: false,
});

export const REQUIRED_WORKER_PROHIBITIONS = Object.freeze([
  "ACTIVATE",
  "PUBLISH",
  "SELF_ACCEPT",
  "PRODUCT_WRITES",
  "EXTERNAL_ACTIONS",
  "SECRETS",
  "LEAK_PRIVATE_CONTEXT",
  "SPEND",
]);

export const APPRENTICESHIP_TRANSITIONS = Object.freeze({
  DRAFT: Object.freeze(["OWNER_BOUND", "HARD_STOP", "REASSESS"]),
  OWNER_BOUND: Object.freeze(["ADMITTED", "SOFT_REVIEW", "HARD_STOP", "REASSESS"]),
  ADMITTED: Object.freeze(["WORKING", "SOFT_REVIEW", "HARD_STOP", "REASSESS"]),
  WORKING: Object.freeze(["WORK_RESULT_READY", "SOFT_REVIEW", "HARD_STOP", "REASSESS"]),
  WORK_RESULT_READY: Object.freeze(["CANDIDATE_COMPILED", "REPAIR_REQUIRED", "HARD_STOP", "REASSESS"]),
  CANDIDATE_COMPILED: Object.freeze(["DRILLING", "REPAIR_REQUIRED", "HARD_STOP", "REASSESS"]),
  DRILLING: Object.freeze(["DRILL_INCOMPLETE", "UNKNOWN_BLOCKED", "DRILL_COMPLETE_NON_ACCEPTING", "SOFT_REVIEW", "HARD_STOP", "REASSESS"]),
  DRILL_INCOMPLETE: Object.freeze(["DRILLING", "REPAIR_REQUIRED", "ARCHIVING"]),
  UNKNOWN_BLOCKED: Object.freeze(["DRILLING", "REPAIR_REQUIRED", "ARCHIVING"]),
  DRILL_COMPLETE_NON_ACCEPTING: Object.freeze(["REPRODUCTION_PENDING", "REPAIR_REQUIRED", "ARCHIVING"]),
  REPRODUCTION_PENDING: Object.freeze(["REPRODUCED", "REPRODUCTION_FAILED", "REPAIR_REQUIRED", "HARD_STOP"]),
  REPRODUCED: Object.freeze(["HANDOFF_READY", "REPAIR_REQUIRED"]),
  REPRODUCTION_FAILED: Object.freeze(["REPAIR_REQUIRED", "ARCHIVING"]),
  HANDOFF_READY: Object.freeze(["OWNER_REVIEW_REQUIRED", "REPAIR_REQUIRED", "ARCHIVING"]),
  OWNER_REVIEW_REQUIRED: Object.freeze(["OWNER_APPROVED_PENDING_ACTIVATION", "REPAIR_REQUIRED", "ARCHIVING"]),
  OWNER_APPROVED_PENDING_ACTIVATION: Object.freeze(["ARCHIVING"]),
  REPAIR_REQUIRED: Object.freeze(["WORKING", "CANDIDATE_COMPILED", "DRILLING", "REPRODUCTION_PENDING", "ARCHIVING"]),
  HARD_STOP: Object.freeze(["ARCHIVING"]),
  SOFT_REVIEW: Object.freeze(["WORKING", "REASSESS", "ARCHIVING"]),
  REASSESS: Object.freeze(["OWNER_BOUND", "ADMITTED", "ARCHIVING"]),
  ARCHIVING: Object.freeze(["ARCHIVED"]),
  ARCHIVED: Object.freeze([]),
});

const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_REFERENCE = /^(?:opaque|ref|sha1|sha256|digest):[A-Za-z0-9._:-]+$/u;
const IDENTIFIER = /^[A-Z][A-Z0-9._:-]*$/u;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/iu;
const ABSOLUTE_PATH = /(?:^|[\s"'`=:(\[{])\/(?!\/)(?:[A-Za-z0-9._-]+[\/]){1,}[A-Za-z0-9._-]+/u;
const WINDOWS_PATH = /(?:^|[\s"'`=:(\[{])[A-Za-z]:[\\/]/u;
const WORKTREE_SEGMENT = [".", "code", "x"].join("");
const WORKTREE_PATH = new RegExp(`${WORKTREE_SEGMENT.replace(".", "\\\\.")}[/\\\\]worktrees[/\\\\]`, "iu");
const ENVIRONMENT_VALUE = /(?:\$[A-Z][A-Z0-9_]*|\b[A-Z][A-Z0-9_]{2,}=[^\s,;]+)/u;
const SECRET_VALUE = /\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|passwd|secret|credential|private[_ -]?key)\s*[:=]\s*(?!\[?redacted\]?\b)[^\s,;)}\]]+/iu;
const CHAT_LINK_SCHEME = ["chat", "gpt", "-conversation"].join("");
const PRIVATE_LINK = new RegExp(`(?:file:\\/\\/|${CHAT_LINK_SCHEME}:\\/\\/|chat:\\/\\/|https?:\\/\\/(?:localhost|127\\.0\\.0\\.1|[^\\s/]+\\.(?:local|internal|private|corp)))(?:[^\\s"'\\x60<>)}\\]]*)`, "iu");
const FORBIDDEN_KEYS = new Set([
  "reasoning",
  "chain_of_thought",
  "hidden_context",
  "private_context",
  "transcript",
  "secret",
  "credential",
  "password",
  "token",
  "api_key",
  "access_token",
  "refresh_token",
  "environment_value",
  "raw_environment_value",
  "absolute_path",
  "private_path",
  "session_id",
  "task_id",
]);

function fail(message) {
  throw new Error(message);
}

export function assert(condition, message) {
  if (!condition) fail(message);
}

export function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function requireRecord(value, label) {
  assert(isRecord(value), `${label} must be an object`);
  return value;
}

export function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains control characters`);
  return value;
}

export function requireIdentifier(value, label) {
  requireString(value, label);
  assert(IDENTIFIER.test(value), `${label} is not a stable identifier`);
  return value;
}

export function requireSha256(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
  return value;
}

export function requireSafeReference(value, label) {
  requireString(value, label);
  assert(SAFE_REFERENCE.test(value), `${label} must be an opaque or content-addressed reference`);
  return value;
}

export function exactKeys(value, required, label, {allow = []} = {}) {
  requireRecord(value, label);
  const allowed = new Set([...required, ...allow]);
  Object.keys(value).forEach((key) => assert(allowed.has(key), `${label} contains unknown field ${key}`));
  required.forEach((key) => assert(Object.hasOwn(value, key), `${label} is missing required field ${key}`));
  return value;
}

export function nonEmptyArray(value, label) {
  assert(Array.isArray(value) && value.length > 0, `${label} must be a nonempty array`);
  return value;
}

export function uniqueStrings(value, label, {allowEmpty = false} = {}) {
  assert(Array.isArray(value), `${label} must be an array`);
  if (!allowEmpty) assert(value.length > 0, `${label} must not be empty`);
  value.forEach((item) => requireString(item, `${label} item`));
  assert(new Set(value).size === value.length, `${label} contains duplicates`);
  return value;
}

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function canonicalDigest(value) {
  return crypto.createHash("sha256").update(canonicalJson(value) ?? "null", "utf8").digest("hex");
}

export function withDigest(record, field = "digest") {
  const copy = structuredClone(record);
  copy[field] = null;
  copy[field] = canonicalDigest(copy);
  return copy;
}

export function validateDigest(record, label, field = "digest") {
  requireRecord(record, label);
  requireSha256(record[field], `${label} ${field}`);
  const copy = structuredClone(record);
  copy[field] = null;
  assert(record[field] === canonicalDigest(copy), `${label} ${field} does not match the record`);
  return record;
}

export function assertPortableRecord(value, label = "portable record") {
  const text = JSON.stringify(value);
  const forbidden = [
    [ABSOLUTE_PATH, "absolute path"],
    [WINDOWS_PATH, "Windows path"],
    [WORKTREE_PATH, "private worktree path"],
    [ENVIRONMENT_VALUE, "environment value"],
    [SECRET_VALUE, "secret-like value"],
    [PRIVATE_LINK, "private link"],
    [UUID, "raw identity"],
  ];
  for (const [pattern, description] of forbidden) assert(!pattern.test(text), `${label} contains a ${description}`);
  const visitKeys = (node, location) => {
    if (Array.isArray(node)) {
      node.forEach((child, index) => visitKeys(child, `${location}[${index}]`));
      return;
    }
    if (!isRecord(node)) return;
    Object.entries(node).forEach(([key, child]) => {
      assert(!FORBIDDEN_KEYS.has(key), `${label} contains forbidden field ${location}.${key}`);
      visitKeys(child, `${location}.${key}`);
    });
  };
  visitKeys(value, label);
  return true;
}

export function compileProvenance({
  projectRef,
  campaignRef,
  goalRef,
  sourceRef,
  treeRef,
  workspaceRef,
  environmentRef,
  workerRef = null,
  workerSessionRef = null,
  orchestratorRef = null,
  orchestratorSessionRef = null,
  learnerRef = null,
  learnerSessionRef = null,
  auditorRef = null,
  auditorSessionRef = null,
  reproductionRef = null,
  reproductionSessionRef = null,
  reviewerRef = null,
  reviewerSessionRef = null,
  modelRef = null,
  predecessorHandoffRef = null,
} = {}) {
  const provenance = {
    project_ref: projectRef,
    campaign_ref: campaignRef,
    goal_ref: goalRef,
    source_ref: sourceRef,
    tree_ref: treeRef,
    workspace_ref: workspaceRef,
    environment_ref: environmentRef,
    worker_ref: workerRef,
    worker_session_ref: workerSessionRef,
    orchestrator_ref: orchestratorRef,
    orchestrator_session_ref: orchestratorSessionRef,
    learner_ref: learnerRef,
    learner_session_ref: learnerSessionRef,
    auditor_ref: auditorRef,
    auditor_session_ref: auditorSessionRef,
    reproduction_ref: reproductionRef,
    reproduction_session_ref: reproductionSessionRef,
    reviewer_ref: reviewerRef,
    reviewer_session_ref: reviewerSessionRef,
    model_ref: modelRef,
    predecessor_handoff_ref: predecessorHandoffRef,
  };
  validateProvenance(provenance);
  return provenance;
}

export function validateProvenance(value, {requiredRefs = [], label = "provenance"} = {}) {
  exactKeys(value, PROVENANCE_FIELDS, label);
  ["project_ref", "campaign_ref", "goal_ref", "source_ref", "tree_ref", "workspace_ref", "environment_ref"].forEach((field) => requireSafeReference(value[field], `${label}.${field}`));
  PROVENANCE_FIELDS.filter((field) => !["project_ref", "campaign_ref", "goal_ref", "source_ref", "tree_ref", "workspace_ref", "environment_ref"].includes(field)).forEach((field) => {
    if (value[field] !== null) requireSafeReference(value[field], `${label}.${field}`);
  });
  requiredRefs.forEach((field) => requireSafeReference(value[field], `${label}.${field}`));
  assertPortableRecord(value, label);
  return value;
}

export function sameBinding(left, right) {
  validateProvenance(left, {label: "left provenance"});
  validateProvenance(right, {label: "right provenance"});
  return ["project_ref", "campaign_ref", "goal_ref", "source_ref", "tree_ref", "workspace_ref", "environment_ref"].every((field) => left[field] === right[field]);
}

export function assertDistinctReferences(values, label) {
  const present = values.filter((value) => value !== null && value !== undefined);
  assert(new Set(present).size === present.length, `${label} contains reused identities`);
  return true;
}

export function protectedActions() {
  return structuredClone(PROTECTED_ACTIONS);
}

export function validateProtectedActions(value, label = "protected actions") {
  exactKeys(value, Object.keys(PROTECTED_ACTIONS), label);
  Object.entries(PROTECTED_ACTIONS).forEach(([key, expected]) => assert(value[key] === expected, `${label}.${key} must remain ${String(expected)}`));
  return value;
}

export function validateWorkerProhibitions(value, label = "worker prohibitions") {
  uniqueStrings(value, label);
  REQUIRED_WORKER_PROHIBITIONS.forEach((prohibition) => {
    assert(value.includes(prohibition), `${label} is missing prohibition ${prohibition}`);
  });
  return value;
}

export function validateConsentDecision(value, label = "consent decision") {
  exactKeys(value, ["required", "recorded", "reference"], label);
  assert(typeof value.required === "boolean", `${label} required flag is invalid`);
  assert(typeof value.recorded === "boolean", `${label} recorded flag is invalid`);
  if (value.reference !== null) requireSafeReference(value.reference, `${label} reference`);
  if (value.required) {
    assert(value.recorded === true, `${label} must be recorded when required`);
    assert(value.reference !== null, `${label} requires a safe reference when required`);
  } else {
    assert(value.recorded === false, `${label} cannot be recorded when not required`);
    assert(value.reference === null, `${label} reference must be null when not required`);
  }
  assertPortableRecord(value, label);
  return value;
}

export function validateRevocationState(value, label = "revocation state") {
  exactKeys(value, ["revocable", "status", "reference"], label);
  assert(typeof value.revocable === "boolean", `${label} revocable flag is invalid`);
  assert(["NOT_REVOKED", "REVOKED"].includes(value.status), `${label} status is invalid`);
  if (value.status === "REVOKED") {
    assert(value.revocable === true, `${label} cannot be revoked when revocation is disabled`);
    requireSafeReference(value.reference, `${label} reference`);
  } else {
    assert(value.reference === null, `${label} reference must be null while not revoked`);
  }
  assertPortableRecord(value, label);
  return value;
}

export function assertNonActivating(value, label = "record") {
  if (Object.hasOwn(value, "activation_allowed")) assert(value.activation_allowed === false, `${label} cannot allow activation`);
  if (Object.hasOwn(value, "owner_approval")) assert(value.owner_approval === null || isRecord(value.owner_approval), `${label} owner approval is invalid`);
  if (typeof value.status === "string") assert(!["PASS", "ACCEPTED", "ACTIVATED"].includes(value.status), `${label} cannot use an activating status`);
  return true;
}

export function transitionApprenticeshipState(current, next) {
  assert(APPRENTICESHIP_STATES.includes(current), `unknown apprenticeship state ${current}`);
  assert(APPRENTICESHIP_STATES.includes(next), `unknown apprenticeship state ${next}`);
  assert(APPRENTICESHIP_TRANSITIONS[current].includes(next), `invalid apprenticeship transition ${current} -> ${next}`);
  return next;
}

export function validateEvidenceRefs(value, label = "evidence references", {allowEmpty = false} = {}) {
  uniqueStrings(value, label, {allowEmpty});
  value.forEach((reference) => requireSafeReference(reference, `${label} item`));
  return value;
}

export function validateTimestamp(value, label) {
  requireString(value, label);
  assert(!Number.isNaN(Date.parse(value)), `${label} must be an ISO timestamp`);
  return value;
}

export function clone(value) {
  return structuredClone(value);
}
