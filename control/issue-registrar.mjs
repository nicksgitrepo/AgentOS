#!/usr/bin/env node
import fs from "node:fs"; import path from "node:path"; import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {BLUEPRINT_REFERENCE_SCHEMA, BLUEPRINT_VERSION, compileBlueprintReference, validateBlueprintReference} from "./blueprint-release-governance.mjs"; export const ISSUE_REGISTRAR_SCHEMA = "agentos.issue_registrar.v1";
export const ISSUE_REGISTRAR_VERSION = 1; export const ISSUE_REGISTRAR_ROLE_ID = "AGENTOS.ISSUE_REGISTRAR"; export const ISSUE_REGISTRAR_ROLE_TITLE = "AgentOS Issue Registrar — Permanent";
export const ISSUE_REGISTRAR_ROLE_KIND = "ISSUE_REGISTRAR"; export const ISSUE_REGISTRAR_CANONICAL_FILENAME = "issues.md"; export const ISSUE_REGISTRAR_CLEARED_CANONICAL_FILENAME = "cleared-issues.md";
export const ISSUE_REGISTRAR_FAILURE_CODE = "INCOMPLETE_STANDARDIZED_ISSUE"; export const ISSUE_REGISTRAR_RESERVATION_POLICY = "RESERVE_BEFORE_VALIDATION"; export const ISSUE_REGISTRAR_SEAM_RELATIONS = Object.freeze([
  "CHILD_OF", "DEPENDS_ON", "SAME_ROOT_CAUSE", "OWNER_ATOMIC_SEAM",
]); export const ISSUE_REGISTRAR_FINDING_KINDS = Object.freeze([
  "ISSUE", "SEAM_FINDING", "SCOPE_AMENDMENT", "REGRESSION",
]); export const ISSUE_REGISTRAR_MAX_SEAM_CLOSURE = 32; export const ISSUE_STATUSES = Object.freeze([
  "INTAKE_FAILED", "DUPLICATE", "READY", "IN_REPAIR", "AUDITING", "BLOCKED",
  "NOT_READY", "DELIVERED", "REGRESSION", "REOPENED", "SUPERSEDED",
  "DEFERRED", "ACCEPTED_RISK", "WONT_FIX",
]); export const ISSUE_LIFECYCLE_STAGES = Object.freeze([
  "NOT_AUTHORIZED", "PROVISIONAL", "READY", "IN_REPAIR", "AUDITING",
  "BLOCKED", "NOT_READY", "DELIVERED", "REGRESSION", "REOPENED", "SUPERSEDED",
  "DEFERRED", "ACCEPTED_RISK", "WONT_FIX", "DUPLICATE",
]); export const ISSUE_SEVERITIES = Object.freeze(["BLOCKER", "HIGH", "MEDIUM", "LOW", "INFO"]); export const ISSUE_TERMINAL_OWNER_STATUSES = Object.freeze(["DEFERRED", "ACCEPTED_RISK", "WONT_FIX"]);
export const ISSUE_REGISTRY_SCHEMA = "agentos.issue_registry.v1"; export const ISSUE_SUBMISSION_SCHEMA = "agentos.issue_submission.v1"; export const ISSUE_TRANSITION_SCHEMA = "agentos.issue_transition.v1";
const SHA256 = /^[0-9a-f]{64}$/u; const HEX40 = /^[0-9a-f]{40}$/u; const PRODUCT_PREFIX = /^[A-Z][A-Z0-9]{1,31}$/u; const ISSUE_ID = /^([A-Z][A-Z0-9]{1,31})-ISSUE-(\d{4})-(\d{4,})$/u;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u; const REFERENCE = /^(?:opaque:|ref:)[^\s]+$/u; const CONTROL = /[\u0000-\u001f\u007f]/u;
const PROJECTION_FILE_NAMES = new Set([ISSUE_REGISTRAR_CANONICAL_FILENAME, ISSUE_REGISTRAR_CLEARED_CANONICAL_FILENAME]); function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function fail(code, message, details = undefined) {
  const error = new Error(`${code}: ${message}`); error.code = code; if (details !== undefined) error.details = details; return error;
}
function assert(condition, code, message, details = undefined) {
  if (!condition) throw fail(code, message, details);
}
function clone(value) {
  return structuredClone(value);
}
function digestWithout(value, field) {
  const body = clone(value); body[field] = null; return canonicalDigest(body);
}
function requireSha(value, label, code = "ISSUE_REGISTRAR_INVALID_DIGEST") {
  assert(typeof value === "string" && SHA256.test(value), code, `${label} must be a lowercase SHA-256`);
}
function requireIdentifier(value, label, code = "ISSUE_REGISTRAR_INVALID_IDENTIFIER") {
  assert(typeof value === "string" && /^[A-Z][A-Z0-9._:-]{0,191}$/u.test(value), code, `${label} must be a stable identifier`); assert(!CONTROL.test(value), code, `${label} contains control characters`);
}
function requireText(value, label, minimum = 1, code = "ISSUE_REGISTRAR_INVALID_TEXT") {
  assert(typeof value === "string" && value.trim().length >= minimum, code, `${label} must be non-empty text`); assert(!CONTROL.test(value), code, `${label} contains control characters`);
}
function requireUtc(value, label) {
  assert(typeof value === "string" && UTC.test(value), "ISSUE_REGISTRAR_INVALID_TIMESTAMP", `${label} must be UTC`);
}
function sortedUnique(values, label) {
  assert(Array.isArray(values), "ISSUE_REGISTRAR_INVALID_ARRAY", `${label} must be an array`); const ordered = [...values].sort(compareUtf8);
  assert(new Set(ordered).size === ordered.length, "ISSUE_REGISTRAR_DUPLICATE_VALUE", `${label} must be unique`);
  assert(JSON.stringify(values) === JSON.stringify(ordered), "ISSUE_REGISTRAR_NONDETERMINISTIC_ORDER", `${label} must be sorted`); return values;
}
function asOptionalString(value) {
  if (value === null || value === undefined) return null; return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
function asOptionalScalar(value) {
  if (value === null || value === undefined) return null; if (typeof value === "string" || typeof value === "number") return String(value); return null;
}
function timestamp(options = {}) {
  const value = options.nowUtc ?? options.now_utc ?? new Date().toISOString(); requireUtc(value, "Registrar timestamp"); return value;
}
function normalizePrefix(value, fallback = "SOCIUNA") {
  const prefix = String(value ?? fallback).trim().toUpperCase(); assert(PRODUCT_PREFIX.test(prefix), "ISSUE_REGISTRAR_INVALID_PRODUCT_PREFIX", "product prefix is invalid"); return prefix;
}
function normalizeYear(value, fallback = new Date().getUTCFullYear()) {
  const year = Number(value ?? fallback); assert(Number.isInteger(year) && year >= 2000 && year <= 9999, "ISSUE_REGISTRAR_INVALID_YEAR", "issue year is invalid"); return year;
}
function normalizeReporter(input = {}) {
  const source = isRecord(input.reporter) ? input.reporter : input; return {
    task_id: asOptionalString(source.task_id ?? source.taskId ?? input.reporter_task_id),
    thread_id: asOptionalString(source.thread_id ?? source.threadId ?? input.reporter_thread_id),
    turn_id: asOptionalScalar(source.turn_id ?? source.turnId ?? input.reporter_turn_id),
    item_id: asOptionalScalar(source.item_id ?? source.itemId ?? input.reporter_item_id),
    identity: asOptionalString(source.identity ?? source.role_id ?? input.reporter_identity),
  };
}
function reporterPresent(reporter) {
  return Object.values(reporter).some((value) => value !== null);
}
const BLUEPRINT_EMBEDDED_FIELDS = Object.freeze([
  "blueprint", "blueprint_content", "blueprintContent", "advice", "advisory",
  "advisory_inputs", "advisoryInputs", "batching_suggestions", "batchingSuggestions",
  "implementation_suggestions", "implementationSuggestions", "producer_notice",
  "producerNotice", "acknowledgement_required", "acknowledgementRequired",
]);
function rejectEmbeddedBlueprintFields(value) {
  if (!isRecord(value)) return;
  for (const field of BLUEPRINT_EMBEDDED_FIELDS) assert(value[field] === undefined || value[field] === null, "ISSUE_REGISTRAR_BLUEPRINT_EMBEDDED_FORBIDDEN", `Blueprint ${field} must not be embedded in canonical issue state`);
}
export function normalizeBlueprintReference(value) {
  if (value === undefined || value === null) return null;
  assert(isRecord(value), "ISSUE_REGISTRAR_BLUEPRINT_REFERENCE_INVALID", "Blueprint reference must be an object");
  rejectEmbeddedBlueprintFields(value);
  if (value.schema !== undefined) assert(value.schema === BLUEPRINT_REFERENCE_SCHEMA, "ISSUE_REGISTRAR_BLUEPRINT_REFERENCE_INVALID", "Blueprint reference schema is invalid");
  if (value.version !== undefined) assert(value.version === BLUEPRINT_VERSION, "ISSUE_REGISTRAR_BLUEPRINT_REFERENCE_INVALID", "Blueprint reference version is invalid");
  const reference = value.schema === BLUEPRINT_REFERENCE_SCHEMA
    ? clone(value)
    : compileBlueprintReference({releaseId: value.release_id ?? value.releaseId, path: value.path ?? value.path_ref ?? value.release_path, sha256: value.sha256 ?? value.release_sha256 ?? value.releaseSha256});
  validateBlueprintReference(reference);
  return reference;
}
function normalizeBlueprintSubmission(value) {
  rejectEmbeddedBlueprintFields(value);
  return normalizeBlueprintReference(value?.blueprint_reference ?? value?.blueprintReference ?? null);
}
const ISSUE_STATUS_LIFECYCLE = Object.freeze({
  INTAKE_FAILED: "NOT_AUTHORIZED",
  DUPLICATE: "DUPLICATE",
  READY: "READY",
  IN_REPAIR: "IN_REPAIR",
  AUDITING: "AUDITING",
  BLOCKED: "BLOCKED",
  NOT_READY: "NOT_READY",
  DELIVERED: "DELIVERED",
  REGRESSION: "REGRESSION",
  REOPENED: "REOPENED",
  SUPERSEDED: "SUPERSEDED",
  DEFERRED: "DEFERRED",
  ACCEPTED_RISK: "ACCEPTED_RISK",
  WONT_FIX: "WONT_FIX",
});
const READY_REQUIRED_FIELDS = Object.freeze(["title", "summary", "category", "severity", "reporter", "evidence"]);
function validateReadyCompleteness(issue) {
  assert(issue.status === "READY" && issue.lifecycle_stage === "READY", "ISSUE_REGISTRAR_STATUS_LIFECYCLE_MISMATCH", "READY issues must use the READY lifecycle stage");
  assert(issue.missing_fields.length === 0, "ISSUE_REGISTRAR_READY_REQUIRES_COMPLETE", "READY issues cannot have missing standardized fields");
  assert(issue.invalid_fields.length === 0, "ISSUE_REGISTRAR_READY_REQUIRES_COMPLETE", "READY issues cannot have invalid standardized fields");
  assert(issue.resubmission_requirements.length === 0, "ISSUE_REGISTRAR_READY_REQUIRES_COMPLETE", "READY issues cannot require resubmission");
  assert(issue.failure_code === null, "ISSUE_REGISTRAR_READY_REQUIRES_COMPLETE", "READY issues cannot retain an intake failure code");
  for (const field of READY_REQUIRED_FIELDS) assert(issue.accepted_fields.includes(field), "ISSUE_REGISTRAR_READY_REQUIRES_COMPLETE", `READY issues must accept ${field}`);
  assert(reporterPresent(issue.reporter), "ISSUE_REGISTRAR_READY_REQUIRES_COMPLETE", "READY issues require reporter evidence");
  assert(issue.evidence.length > 0, "ISSUE_REGISTRAR_READY_REQUIRES_COMPLETE", "READY issues require evidence");
}
function normalizeEvidence(values) {
  if (values === undefined || values === null) return []; assert(Array.isArray(values), "ISSUE_REGISTRAR_INVALID_EVIDENCE", "evidence must be an array"); const result = values.map((entry, index) => {
    const source = isRecord(entry) ? entry : {kind: "UNSTRUCTURED", payload: entry}; const evidenceId = asOptionalString(source.evidence_id ?? source.evidenceId) ?? `EVIDENCE.${String(index + 1).padStart(4, "0")}`;
    requireIdentifier(evidenceId, "evidence ID"); const kind = String(source.kind ?? "UNSPECIFIED").trim().toUpperCase().replace(/[^A-Z0-9._:-]/gu, "_"); requireIdentifier(kind, "evidence kind");
    const sourceDigest = SHA256.test(source.sha256 ?? "") ? source.sha256 : canonicalDigest({
      evidence_id: evidenceId,
      kind,
      payload: source.payload ?? source.value ?? null,
    }); const sensitive = source.sensitive === true || source.security_sensitive === true || /SECRET|TOKEN|PASSWORD|CREDENTIAL|PRIVATE/u.test(kind);
    const suppliedReference = asOptionalString(source.reference ?? source.ref); const reference = sensitive || !suppliedReference || !REFERENCE.test(suppliedReference)
      ? `opaque:issue-evidence:${sourceDigest}`
      : suppliedReference; return {
      evidence_id: evidenceId,
      kind,
      reference,
      sha256: sourceDigest,
      redacted: sensitive,
    };
  }).sort((left, right) => compareUtf8(left.evidence_id, right.evidence_id)); const ids = result.map((entry) => entry.evidence_id);
  assert(new Set(ids).size === ids.length, "ISSUE_REGISTRAR_DUPLICATE_EVIDENCE", "evidence IDs must be unique"); return result;
}
function normalizeRelated(values) {
  if (values === undefined || values === null) return []; assert(Array.isArray(values), "ISSUE_REGISTRAR_INVALID_RELATION", "related issue IDs must be an array");
  const result = values.map((value) => String(value)).sort(compareUtf8); result.forEach((value) => assert(ISSUE_ID.test(value), "ISSUE_REGISTRAR_INVALID_RELATION", "related issue ID is invalid"));
  return sortedUnique(result, "related issue IDs");
}
function normalizeFindingKind(value, fallback = "ISSUE") {
  const kind = String(value ?? fallback).trim().toUpperCase(); assert(ISSUE_REGISTRAR_FINDING_KINDS.includes(kind), "ISSUE_REGISTRAR_INVALID_FINDING_KIND", "finding kind is invalid"); return kind;
}
function normalizeRelationType(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback; const relation = String(value).trim().toUpperCase();
  assert(ISSUE_REGISTRAR_SEAM_RELATIONS.includes(relation), "ISSUE_REGISTRAR_INVALID_RELATION", "seam relation is invalid"); return relation;
}
function normalizeScopeAmendment(value) {
  if (value === null || value === undefined) return null; assert(isRecord(value), "ISSUE_REGISTRAR_INVALID_SCOPE_AMENDMENT", "scope amendment must be an object"); const amendment = {
    type: String(value.type ?? value.kind ?? "SCOPE_AMENDMENT").trim().toUpperCase(),
    rationale: asOptionalString(value.rationale ?? value.reason),
    paths: Array.isArray(value.paths ?? value.path_list) ? [...(value.paths ?? value.path_list)].map(String).sort(compareUtf8) : [],
    verification_mapping: isRecord(value.verification_mapping ?? value.verificationMapping) ? clone(value.verification_mapping ?? value.verificationMapping) : {},
    authority: asOptionalString(value.authority ?? value.authority_id),
    source_issue_id: asOptionalString(value.source_issue_id ?? value.sourceIssueId),
  }; assert(amendment.type === "SCOPE_AMENDMENT" || amendment.type === "SEAM_FINDING", "ISSUE_REGISTRAR_INVALID_SCOPE_AMENDMENT", "scope amendment type is invalid");
  if (amendment.rationale !== null) requireText(amendment.rationale, "scope amendment rationale"); if (amendment.paths.length > 0) sortedUnique(amendment.paths, "scope amendment paths");
  if (amendment.authority !== null) requireIdentifier(amendment.authority, "scope amendment authority");
  if (amendment.source_issue_id !== null) assert(ISSUE_ID.test(amendment.source_issue_id), "ISSUE_REGISTRAR_INVALID_SCOPE_AMENDMENT", "scope amendment source issue is invalid"); return amendment;
}
function isRuntimeDeliveryVerified(delivery) {
  if (!isRecord(delivery)) return false; const independentPass = delivery.independent_pass ?? delivery.independentPass ?? delivery.audit_pass ?? delivery.auditPass;
  const pass = delivery.independent_pass_status === "PASS"
    || delivery.pass === true
    || independentPass?.status === "PASS"
    || independentPass?.pass === true; const identical = delivery.identical_bytes === true || independentPass?.identical_bytes === true || independentPass?.identicalBytes === true;
  const validCommit = (value) => typeof value === "string" && (HEX40.test(value) || SHA256.test(value)); const validTree = (value) => typeof value === "string" && (HEX40.test(value) || SHA256.test(value));
  const commitsEqual = validCommit(delivery.local_commit)
    && delivery.local_commit === delivery.origin_commit
    && validCommit(delivery.origin_commit)
    && delivery.origin_commit === delivery.github_commit
    && validCommit(delivery.github_commit); const treesEqual = validTree(delivery.local_tree)
    && delivery.local_tree === delivery.origin_tree
    && validTree(delivery.origin_tree)
    && delivery.origin_tree === delivery.github_tree
    && validTree(delivery.github_tree); const delivered = delivery.status === "DELIVERED_VERIFIED" || delivery.delivered === true; return delivered && pass && identical && commitsEqual && treesEqual;
}
function validateDeliveredRecord(issue) {
  assert(isRecord(issue.candidate), "ISSUE_REGISTRAR_DELIVERY_CANDIDATE_REQUIRED", "DELIVERED issues require a bound immutable candidate");
  for (const field of ["commit", "tree", "scope", "verification_contract"]) requireText(issue.candidate[field], `delivered candidate ${field}`, 1, "ISSUE_REGISTRAR_DELIVERY_CANDIDATE_REQUIRED");
  assert(HEX40.test(issue.candidate.commit) || SHA256.test(issue.candidate.commit), "ISSUE_REGISTRAR_DELIVERY_CANDIDATE_REQUIRED", "delivered candidate commit is invalid");
  assert(HEX40.test(issue.candidate.tree) || SHA256.test(issue.candidate.tree), "ISSUE_REGISTRAR_DELIVERY_CANDIDATE_REQUIRED", "delivered candidate tree is invalid");
  assert(isRecord(issue.delivery), "ISSUE_REGISTRAR_DELIVERY_EVIDENCE_REQUIRED", "DELIVERED issues require delivery evidence");
  const independentPass = issue.delivery.independent_pass ?? issue.delivery.independentPass ?? issue.delivery.audit_pass ?? issue.delivery.auditPass;
  assert(isRecord(independentPass) && (independentPass.status === "PASS" || independentPass.pass === true) && (independentPass.identical_bytes === true || independentPass.identicalBytes === true), "ISSUE_REGISTRAR_RUNTIME_PASS_REQUIRED", "DELIVERED issues require an explicit identical-byte independent PASS");
  for (const [field, expected] of [["candidate_commit", issue.candidate.commit], ["candidate_tree", issue.candidate.tree]]) {
    if (issue.delivery[field] !== undefined) assert(issue.delivery[field] === expected, "ISSUE_REGISTRAR_DELIVERY_IDENTITY_MISMATCH", `delivery ${field} must bind the candidate`);
    for (const alias of [field === "candidate_commit" ? "candidateCommit" : "candidateTree"]) if (independentPass[alias] !== undefined) assert(independentPass[alias] === expected, "ISSUE_REGISTRAR_DELIVERY_IDENTITY_MISMATCH", `independent PASS ${alias} must bind the candidate`);
  }
  assert(isRuntimeDeliveryVerified(issue.delivery), "ISSUE_REGISTRAR_DELIVERY_EVIDENCE_REQUIRED", "DELIVERED issues require verified Runtime identities");
  assert(issue.delivery.local_commit === issue.candidate.commit && issue.delivery.local_tree === issue.candidate.tree, "ISSUE_REGISTRAR_DELIVERY_IDENTITY_MISMATCH", "delivery identities must equal the bound candidate");
}
function isClearedIssue(issue) {
  const candidate = issue.candidate; const candidateMatches = isRecord(candidate)
    && issue.delivery?.local_commit === candidate.commit && issue.delivery?.local_tree === candidate.tree; return ["DELIVERED", ...ISSUE_TERMINAL_OWNER_STATUSES].includes(issue.status)
    && isRuntimeDeliveryVerified(issue.delivery)
    && candidateMatches;
}
function normalizeCandidate(value) {
  if (value === null || value === undefined) return null; assert(isRecord(value), "ISSUE_REGISTRAR_INVALID_CANDIDATE", "candidate must be an object"); const candidate = {
    commit: asOptionalString(value.commit ?? value.commit_sha ?? value.commitSha),
    tree: asOptionalString(value.tree ?? value.tree_sha ?? value.treeSha),
    parent: asOptionalString(value.parent ?? value.parent_sha ?? value.parentSha),
    scope: asOptionalString(value.scope ?? value.path_manifest ?? value.pathManifest),
    verification_contract: asOptionalString(value.verification_contract ?? value.verificationContract),
  }; if (candidate.commit !== null) assert(HEX40.test(candidate.commit) || SHA256.test(candidate.commit), "ISSUE_REGISTRAR_INVALID_CANDIDATE", "candidate commit must be a digest");
  if (candidate.tree !== null) assert(HEX40.test(candidate.tree) || SHA256.test(candidate.tree), "ISSUE_REGISTRAR_INVALID_CANDIDATE", "candidate tree must be a digest");
  if (candidate.parent !== null) assert(HEX40.test(candidate.parent) || SHA256.test(candidate.parent), "ISSUE_REGISTRAR_INVALID_CANDIDATE", "candidate parent must be a digest"); return candidate;
}
function normalizeHistory(history, nowUtc, event, reason, actor = ISSUE_REGISTRAR_ROLE_ID) {
  const existing = Array.isArray(history) ? history.map(clone) : []; const sequence = existing.length + 1; existing.push({sequence, event, at_utc: nowUtc, actor, reason: reason ?? ""}); return existing;
}
function issueId(prefix, year, number) {
  return `${prefix}-ISSUE-${year}-${String(number).padStart(4, "0")}`;
}
function nextNumber(registry, prefix, year) {
  const key = `${prefix}-${year}`; const used = new Set(); for (const issue of registry.issues ?? []) {
    if (issue.product_prefix === prefix && issue.year === year) used.add(issue.number);
  }
  for (const reservation of registry.reservations ?? []) {
    if (reservation.product_prefix === prefix && reservation.year === year) used.add(reservation.number);
  }
  let number = Number(registry.next_numbers?.[key] ?? 1); while (used.has(number)) number += 1; return {key, number};
}
function dedupeKey(input, prefix) {
  if (typeof input.dedupe_key === "string" && input.dedupe_key.trim().length > 0) return input.dedupe_key.trim(); const title = String(input.title ?? "").trim().toLocaleLowerCase();
  const category = String(input.category ?? "").trim().toLocaleLowerCase(); const root = String(input.root_issue_id ?? input.rootIssueId ?? "").trim(); return `${prefix}|${category}|${title}|${root}`;
}
function initialRegistry(prefix = "SOCIUNA", year = normalizeYear()) {
  return {
    schema: ISSUE_REGISTRY_SCHEMA,
    version: ISSUE_REGISTRAR_VERSION,
    product_prefixes: [prefix],
    reservations: [],
    next_numbers: {[`${prefix}-${year}`]: 1},
    issues: [],
    duplicate_submissions: [],
    registry_sha256: null,
  };
}
function validateReporter(reporter) {
  assert(isRecord(reporter), "ISSUE_REGISTRAR_INVALID_REPORTER", "reporter must be an object"); const expected = ["identity", "item_id", "task_id", "thread_id", "turn_id"];
  assert(JSON.stringify(Object.keys(reporter).sort(compareUtf8)) === JSON.stringify(expected), "ISSUE_REGISTRAR_INVALID_REPORTER", "reporter fields mismatch");
  for (const value of Object.values(reporter)) if (value !== null) requireText(value, "reporter field");
}
export function validateIssueRecord(issue) {
  assert(isRecord(issue), "ISSUE_REGISTRAR_INVALID_RECORD", "issue record must be an object");
  rejectEmbeddedBlueprintFields(issue);
  assert(issue.schema === ISSUE_REGISTRAR_SCHEMA && issue.version === ISSUE_REGISTRAR_VERSION, "ISSUE_REGISTRAR_INVALID_RECORD", "issue schema/version is invalid");
  for (const field of ["issue_id", "product_prefix", "title", "summary", "category", "severity", "status", "lifecycle_stage", "dedupe_key", "reason"]) requireText(issue[field], `issue ${field}`);
  assert(PRODUCT_PREFIX.test(issue.product_prefix), "ISSUE_REGISTRAR_INVALID_PRODUCT_PREFIX", "issue product prefix is invalid");
  assert(Number.isInteger(issue.year) && issue.year >= 2000 && issue.year <= 9999, "ISSUE_REGISTRAR_INVALID_YEAR", "issue year is invalid");
  assert(Number.isInteger(issue.number) && issue.number > 0, "ISSUE_REGISTRAR_INVALID_NUMBER", "issue number is invalid"); const parsed = ISSUE_ID.exec(issue.issue_id);
  assert(parsed && parsed[1] === issue.product_prefix && Number(parsed[2]) === issue.year && Number(parsed[3]) === issue.number, "ISSUE_REGISTRAR_INVALID_IDENTIFIER", "issue ID does not match its number");
  assert(ISSUE_STATUSES.includes(issue.status), "ISSUE_REGISTRAR_INVALID_STATUS", "issue status is invalid");
  assert(ISSUE_LIFECYCLE_STAGES.includes(issue.lifecycle_stage), "ISSUE_REGISTRAR_INVALID_STATUS", "issue lifecycle stage is invalid");
  assert(ISSUE_STATUS_LIFECYCLE[issue.status] === issue.lifecycle_stage, "ISSUE_REGISTRAR_STATUS_LIFECYCLE_MISMATCH", "issue status and lifecycle stage must agree");
  assert(ISSUE_SEVERITIES.includes(issue.severity), "ISSUE_REGISTRAR_INVALID_SEVERITY", "issue severity is invalid"); normalizeFindingKind(issue.finding_kind ?? "ISSUE");
  const relationType = normalizeRelationType(issue.relation_type ?? null); if (relationType !== null) {
    assert(issue.root_issue_id !== null && issue.root_issue_id !== undefined, "ISSUE_REGISTRAR_INVALID_RELATION", "a seam relation requires a root issue");
    assert(normalizeFindingKind(issue.finding_kind ?? "ISSUE") === "SEAM_FINDING" || normalizeFindingKind(issue.finding_kind ?? "ISSUE") === "SCOPE_AMENDMENT", "ISSUE_REGISTRAR_INVALID_RELATION", "a seam relation requires a typed seam finding");
  }
  if (issue.scope_amendment !== null && issue.scope_amendment !== undefined) normalizeScopeAmendment(issue.scope_amendment); validateReporter(issue.reporter);
  if (issue.blueprint_reference !== undefined && issue.blueprint_reference !== null) validateBlueprintReference(issue.blueprint_reference);
  requireUtc(issue.submitted_at_utc, "issue submitted timestamp"); requireUtc(issue.updated_at_utc, "issue updated timestamp");
  for (const field of ["accepted_fields", "missing_fields", "invalid_fields", "resubmission_requirements", "related_issue_ids", "evidence"]) {
    assert(Array.isArray(issue[field]), "ISSUE_REGISTRAR_INVALID_RECORD", `issue ${field} must be an array`); const strings = field === "evidence" ? null : issue[field]; if (strings !== null) {
      strings.forEach((value) => requireText(value, `issue ${field} item`)); sortedUnique(strings, `issue ${field}`);
    }
  }
  for (const evidence of issue.evidence) {
    assert(isRecord(evidence), "ISSUE_REGISTRAR_INVALID_EVIDENCE", "evidence must be an object"); requireIdentifier(evidence.evidence_id, "evidence ID"); requireIdentifier(evidence.kind, "evidence kind");
    assert(typeof evidence.reference === "string" && REFERENCE.test(evidence.reference), "ISSUE_REGISTRAR_INVALID_EVIDENCE", "evidence reference is invalid"); requireSha(evidence.sha256, "evidence digest");
    assert(typeof evidence.redacted === "boolean", "ISSUE_REGISTRAR_INVALID_EVIDENCE", "evidence redaction flag is invalid");
  }
  const orderedEvidence = [...issue.evidence].sort((left, right) => compareUtf8(left.evidence_id, right.evidence_id));
  assert(JSON.stringify(orderedEvidence) === JSON.stringify(issue.evidence), "ISSUE_REGISTRAR_NONDETERMINISTIC_ORDER", "evidence is not sorted");
  if (issue.status === "READY") validateReadyCompleteness(issue);
  if (issue.duplicate_of !== null) assert(ISSUE_ID.test(issue.duplicate_of), "ISSUE_REGISTRAR_INVALID_RELATION", "duplicate_of is invalid");
  if (issue.root_issue_id !== null) assert(ISSUE_ID.test(issue.root_issue_id), "ISSUE_REGISTRAR_INVALID_RELATION", "root_issue_id is invalid");
  if (issue.regression_of !== null) assert(ISSUE_ID.test(issue.regression_of), "ISSUE_REGISTRAR_INVALID_RELATION", "regression_of is invalid");
  if (issue.supersedes !== null) assert(ISSUE_ID.test(issue.supersedes), "ISSUE_REGISTRAR_INVALID_RELATION", "supersedes is invalid");
  assert(Array.isArray(issue.history) && issue.history.length > 0, "ISSUE_REGISTRAR_INVALID_HISTORY", "issue history is required"); issue.history.forEach((entry, index) => {
    assert(isRecord(entry) && entry.sequence === index + 1, "ISSUE_REGISTRAR_INVALID_HISTORY", "issue history sequence is not canonical"); requireText(entry.event, "history event");
    requireUtc(entry.at_utc, "history timestamp");
  }); if (issue.candidate !== null) normalizeCandidate(issue.candidate);
  for (const field of ["audit", "delivery", "owner_decision"]) assert(issue[field] === null || isRecord(issue[field]), "ISSUE_REGISTRAR_INVALID_RECORD", `${field} must be an object or null`);
  if (issue.status === "DELIVERED") validateDeliveredRecord(issue);
  requireSha(issue.issue_sha256, "issue digest"); assert(issue.issue_sha256 === digestWithout(issue, "issue_sha256"), "ISSUE_REGISTRAR_DIGEST_MISMATCH", "issue digest mismatch"); return issue;
}
export function compileIssueRegistry({productPrefixes = ["SOCIUNA"], reservations = [], nextNumbers = {}, issues = [], duplicateSubmissions = []} = {}) {
  const prefixes = [...new Set(productPrefixes.map((value) => normalizePrefix(value)))].sort(compareUtf8); const orderedIssues = issues.map((item) => {
    const copy = clone(item); validateIssueRecord(copy); return copy;
  }).sort((left, right) => compareUtf8(left.issue_id, right.issue_id)); const registry = {
    schema: ISSUE_REGISTRY_SCHEMA,
    version: ISSUE_REGISTRAR_VERSION,
    product_prefixes: prefixes,
    reservations: reservations.map((item) => ({...item})).sort((left, right) => `${left.product_prefix}-${left.year}-${left.number}`.localeCompare(`${right.product_prefix}-${right.year}-${right.number}`)),
    next_numbers: Object.fromEntries(Object.entries(nextNumbers).sort(([left], [right]) => compareUtf8(left, right))),
    issues: orderedIssues,
    duplicate_submissions: duplicateSubmissions.map(clone).sort((left, right) => compareUtf8(String(left.submission_id), String(right.submission_id))),
    registry_sha256: null,
  }; for (const reservation of registry.reservations) {
    requireIdentifier(reservation.reservation_id, "reservation ID"); assert(PRODUCT_PREFIX.test(reservation.product_prefix), "ISSUE_REGISTRAR_INVALID_RESERVATION", "reservation prefix is invalid");
    assert(Number.isInteger(reservation.year) && Number.isInteger(reservation.number), "ISSUE_REGISTRAR_INVALID_RESERVATION", "reservation number is invalid");
    requireUtc(reservation.reserved_at_utc, "reservation timestamp");
  }
  requireSha("0".repeat(64), "registry digest"); registry.registry_sha256 = digestWithout(registry, "registry_sha256"); return validateIssueRegistry(registry);
}
export function validateIssueRegistry(registry) {
  assert(isRecord(registry) && registry.schema === ISSUE_REGISTRY_SCHEMA && registry.version === ISSUE_REGISTRAR_VERSION, "ISSUE_REGISTRAR_INVALID_REGISTRY", "registry schema/version is invalid");
  assert(Array.isArray(registry.product_prefixes) && registry.product_prefixes.length > 0, "ISSUE_REGISTRAR_INVALID_REGISTRY", "registry prefixes are required");
  const prefixes = [...registry.product_prefixes].sort(compareUtf8);
  assert(JSON.stringify(prefixes) === JSON.stringify(registry.product_prefixes), "ISSUE_REGISTRAR_NONDETERMINISTIC_ORDER", "registry prefixes are not sorted");
  prefixes.forEach((value) => assert(PRODUCT_PREFIX.test(value), "ISSUE_REGISTRAR_INVALID_PRODUCT_PREFIX", "registry prefix is invalid"));
  assert(Array.isArray(registry.issues), "ISSUE_REGISTRAR_INVALID_REGISTRY", "registry issues are required"); const ids = registry.issues.map((item) => item.issue_id);
  assert(new Set(ids).size === ids.length, "ISSUE_REGISTRAR_DUPLICATE_ID", "issue IDs must be unique"); const ordered = [...ids].sort(compareUtf8);
  assert(JSON.stringify(ids) === JSON.stringify(ordered), "ISSUE_REGISTRAR_NONDETERMINISTIC_ORDER", "registry issues are not sorted"); registry.issues.forEach(validateIssueRecord);
  assert(Array.isArray(registry.reservations), "ISSUE_REGISTRAR_INVALID_REGISTRY", "registry reservations are required");
  assert(Array.isArray(registry.duplicate_submissions), "ISSUE_REGISTRAR_INVALID_REGISTRY", "duplicate submissions are required"); requireSha(registry.registry_sha256, "registry digest");
  assert(registry.registry_sha256 === digestWithout(registry, "registry_sha256"), "ISSUE_REGISTRAR_DIGEST_MISMATCH", "registry digest mismatch"); return registry;
}
export function reserveIssueNumber(registry, {productPrefix = "SOCIUNA", year = normalizeYear(), reservationId = null, nowUtc = undefined} = {}) {
  const next = nextNumber(registry, normalizePrefix(productPrefix), normalizeYear(year)); const reserved = clone(registry); reserved.reservations ??= []; reserved.next_numbers ??= {};
  const id = reservationId ?? `RESERVATION.${next.key}.${String(next.number).padStart(4, "0")}`; requireIdentifier(id, "reservation ID");
  reserved.reservations.push({reservation_id: id, product_prefix: normalizePrefix(productPrefix), year: normalizeYear(year), number: next.number, reserved_at_utc: timestamp({nowUtc})});
  reserved.next_numbers[next.key] = next.number + 1;
  const result = compileIssueRegistry({productPrefixes: reserved.product_prefixes ?? [productPrefix], reservations: reserved.reservations, nextNumbers: reserved.next_numbers, issues: reserved.issues ?? [], duplicateSubmissions: reserved.duplicate_submissions ?? []});
  return {number: next.number, reservationId: id, registry: result};
}
function buildSubmissionRecord(input, {prefix, year, number, nowUtc, reservationId, historical = false} = {}) {
  const title = asOptionalString(input.title ?? input.name); const summary = asOptionalString(input.summary ?? input.description ?? input.details);
  const category = asOptionalString(input.category ?? input.classification); const severity = asOptionalString(input.severity)?.toUpperCase() ?? null; const reporter = normalizeReporter(input);
  const evidence = normalizeEvidence(input.evidence ?? input.evidence_refs); const findingKind = normalizeFindingKind(input.finding_kind ?? input.findingKind ?? (input.seam_finding === true ? "SEAM_FINDING" : "ISSUE"));
  const relationType = normalizeRelationType(input.relation_type ?? input.relationType ?? null); const requestedRootIssueId = asOptionalString(input.root_issue_id ?? input.rootIssueId);
  const scopeAmendment = normalizeScopeAmendment(input.scope_amendment ?? input.scopeAmendment ?? null); const accepted = []; const missing = []; const invalid = [];
  if (title) accepted.push("title"); else missing.push("title"); if (summary) accepted.push("summary"); else missing.push("summary"); if (category) accepted.push("category"); else missing.push("category");
  if (severity && ISSUE_SEVERITIES.includes(severity)) accepted.push("severity"); else if (severity) invalid.push("severity"); else missing.push("severity");
  if (reporterPresent(reporter)) accepted.push("reporter"); else missing.push("reporter"); if (evidence.length > 0) accepted.push("evidence"); else missing.push("evidence");
  const complete = missing.length === 0 && invalid.length === 0; const status = complete ? "READY" : "INTAKE_FAILED"; const lifecycleStage = complete ? "READY" : "NOT_AUTHORIZED"; const issue = {
    schema: ISSUE_REGISTRAR_SCHEMA,
    version: ISSUE_REGISTRAR_VERSION,
    issue_id: issueId(prefix, year, number),
    product_prefix: prefix,
    year,
    number,
    title: title ?? "Untitled issue (provisional)",
    summary: summary ?? "Incomplete standardized issue intake; resubmission is required.",
    category: category ?? "UNCLASSIFIED",
    severity: severity && ISSUE_SEVERITIES.includes(severity) ? severity : "BLOCKER",
    status,
    lifecycle_stage: lifecycleStage,
    dedupe_key: dedupeKey(input, prefix),
    reporter,
    submitted_at_utc: nowUtc,
    updated_at_utc: nowUtc,
    accepted_fields: accepted.sort(compareUtf8),
    missing_fields: missing.sort(compareUtf8),
    invalid_fields: invalid.sort(compareUtf8),
    reason: complete ? "Standardized issue intake accepted." : "Required standardized fields are missing or invalid.",
    resubmission_requirements: complete ? [] : [...new Set([...missing.map((field) => `Provide valid ${field}.`), ...invalid.map((field) => `Correct invalid ${field}.`)])].sort(compareUtf8),
    failure_code: complete ? null : ISSUE_REGISTRAR_FAILURE_CODE,
    reporter_disappearance_policy: "REPORTER_SNAPSHOT_PRESERVED",
    finding_kind: findingKind,
    relation_type: relationType,
    scope_amendment: scopeAmendment,
    blueprint_reference: normalizeBlueprintSubmission(input),
    evidence,
    candidate: normalizeCandidate(input.candidate),
    audit: null,
    delivery: null,
    owner_decision: null,
    root_issue_id: requestedRootIssueId,
    duplicate_of: null,
    related_issue_ids: normalizeRelated(input.related_issue_ids ?? input.relatedIssueIds),
    regression_of: asOptionalString(input.regression_of ?? input.regressionOf),
    supersedes: asOptionalString(input.supersedes),
    duplicate_reports: [],
    historical_source: historical ? {
      source_id: asOptionalString(input.source_id ?? input.sourceId),
      source_ref: asOptionalString(input.source_ref ?? input.sourceRef),
      source_kind: asOptionalString(input.source_kind ?? input.sourceKind ?? input.source_type ?? input.sourceType),
      source_sha256: SHA256.test(input.source_sha256 ?? "") ? input.source_sha256 : null,
      uncertain: input.uncertain === true || input.status === "CREATED" || input.missing_evidence === true,
      missing_evidence_reasons: Array.isArray(input.missing_evidence_reasons) ? [...input.missing_evidence_reasons].map(String).sort(compareUtf8) : [],
    } : null,
    reservation_id: reservationId,
    history: normalizeHistory([], nowUtc, complete ? "INTAKE_ACCEPTED" : "INTAKE_FAILED", complete ? "Standardized issue accepted." : ISSUE_REGISTRAR_FAILURE_CODE),
    issue_sha256: null,
  }; if (issue.regression_of !== null) {
    assert(ISSUE_ID.test(issue.regression_of), "ISSUE_REGISTRAR_INVALID_RELATION", "regression_of is invalid"); issue.status = "REGRESSION"; issue.lifecycle_stage = "REGRESSION";
  }
  issue.root_issue_id = requestedRootIssueId ?? issue.issue_id; if (historical && issue.historical_source?.uncertain && issue.status === "READY") {
    issue.status = "INTAKE_FAILED"; issue.lifecycle_stage = "NOT_AUTHORIZED"; issue.failure_code = ISSUE_REGISTRAR_FAILURE_CODE;
    issue.missing_fields = [...new Set([...issue.missing_fields, "independent_verdict"])] .sort(compareUtf8);
    issue.resubmission_requirements = [...new Set([...issue.resubmission_requirements, "Provide an independent verdict before historical promotion."])] .sort(compareUtf8);
    issue.reason = "Historical source is uncertain; no acceptance or delivery is inferred.";
    issue.history[0] = {sequence: 1, event: "INTAKE_FAILED", at_utc: nowUtc, actor: ISSUE_REGISTRAR_ROLE_ID, reason: ISSUE_REGISTRAR_FAILURE_CODE};
  }
  if (issue.relation_type !== null) {
    assert(issue.finding_kind === "SEAM_FINDING" || issue.finding_kind === "SCOPE_AMENDMENT", "ISSUE_REGISTRAR_SEAM_FINDING_REQUIRED", "causal companions must use typed SEAM_FINDING or SCOPE_AMENDMENT intake");
    assert(issue.root_issue_id !== issue.issue_id, "ISSUE_REGISTRAR_INVALID_RELATION", "a root issue cannot be its own seam companion");
    assert(issue.scope_amendment !== null, "ISSUE_REGISTRAR_SCOPE_AMENDMENT_REQUIRED", "a causal seam finding requires a typed scope amendment");
  }
  issue.issue_sha256 = digestWithout(issue, "issue_sha256"); return validateIssueRecord(issue);
}
function receiptFor(action, issue, nowUtc) {
  const receipt = {
    schema: ISSUE_SUBMISSION_SCHEMA,
    version: ISSUE_REGISTRAR_VERSION,
    action,
    issue_id: issue.issue_id,
    status: issue.status,
    lifecycle_stage: issue.lifecycle_stage,
    issue_sha256: issue.issue_sha256,
    at_utc: nowUtc,
    receipt_sha256: null,
  }; receipt.receipt_sha256 = digestWithout(receipt, "receipt_sha256"); return receipt;
}
export function submitIssue(registry = compileIssueRegistry(), input = {}, options = {}) {
  validateIssueRegistry(registry); assert(isRecord(input), "ISSUE_REGISTRAR_INVALID_SUBMISSION", "submission must be an object"); const nowUtc = timestamp(options);
  const prefix = normalizePrefix(input.product_prefix ?? input.productPrefix ?? options.productPrefix); const year = normalizeYear(input.year ?? options.year); const key = dedupeKey(input, prefix);
  const existing = registry.issues.find((item) => item.dedupe_key === key && item.product_prefix === prefix); if (existing) {
    const duplicate = clone(existing); const reportIndex = duplicate.duplicate_reports.length + 1; duplicate.duplicate_reports.push({
      submission_id: `DUPLICATE.${duplicate.issue_id}.${String(reportIndex).padStart(4, "0")}`,
      submitted_at_utc: nowUtc,
      reporter: normalizeReporter(input),
      evidence: normalizeEvidence(input.evidence ?? input.evidence_refs),
      reason: "Duplicate submission linked to existing issue; attribution and evidence preserved.",
    }); duplicate.duplicate_reports.sort((left, right) => compareUtf8(left.submission_id, right.submission_id));
    duplicate.history = normalizeHistory(duplicate.history, nowUtc, "DUPLICATE_LINKED", `Linked duplicate submission to ${duplicate.issue_id}.`); duplicate.updated_at_utc = nowUtc;
    duplicate.issue_sha256 = digestWithout(duplicate, "issue_sha256"); const issues = registry.issues.filter((item) => item.issue_id !== duplicate.issue_id).concat(duplicate);
    const nextRegistry = compileIssueRegistry({productPrefixes: [...registry.product_prefixes, prefix], reservations: registry.reservations, nextNumbers: registry.next_numbers, issues, duplicateSubmissions: [...registry.duplicate_submissions, {submission_id: duplicate.duplicate_reports.at(-1).submission_id, issue_id: duplicate.issue_id, at_utc: nowUtc}]});
    return {registry: nextRegistry, issue: duplicate, receipt: receiptFor("DUPLICATE_LINKED", duplicate, nowUtc), reserved: false};
  }
  const reservation = reserveIssueNumber(registry, {productPrefix: prefix, year, nowUtc});
  const issue = buildSubmissionRecord(input, {prefix, year, number: reservation.number, reservationId: reservation.reservationId, nowUtc, historical: options.historical === true});
  const nextRegistry = compileIssueRegistry({productPrefixes: [...reservation.registry.product_prefixes, prefix], reservations: reservation.registry.reservations, nextNumbers: reservation.registry.next_numbers, issues: [...reservation.registry.issues, issue], duplicateSubmissions: reservation.registry.duplicate_submissions});
  return {registry: nextRegistry, issue, receipt: receiptFor("SUBMITTED", issue, nowUtc), reserved: true, reservation_id: reservation.reservationId};
}
function actorRole(actor) {
  if (typeof actor === "string") return actor; if (!isRecord(actor)) return null; return actor.role ?? actor.role_id ?? actor.identity ?? null;
}
function assertOwner(actor) {
  const role = actorRole(actor); assert(["OWNER", "PROJECT_OWNER", "AGENTOS.PROJECT_OWNER"].includes(role), "ISSUE_REGISTRAR_OWNER_ONLY", "terminal issue decisions require Project Owner authority");
}
function patchIssue(issue, patch, nowUtc, event, actor = ISSUE_REGISTRAR_ROLE_ID) {
  const next = clone(issue); for (const field of ["title", "summary", "category"]) if (patch[field] !== undefined) {
    requireText(patch[field], `issue ${field}`); next[field] = patch[field].trim();
  }
  if (patch.severity !== undefined) {
    const severity = String(patch.severity).toUpperCase(); assert(ISSUE_SEVERITIES.includes(severity), "ISSUE_REGISTRAR_INVALID_SEVERITY", "issue severity is invalid"); next.severity = severity;
  }
  for (const field of ["candidate", "audit", "delivery"]) if (patch[field] !== undefined) next[field] = field === "candidate" ? normalizeCandidate(patch[field]) : clone(patch[field]);
  if (patch.blueprint_reference !== undefined || patch.blueprintReference !== undefined) next.blueprint_reference = normalizeBlueprintReference(patch.blueprint_reference ?? patch.blueprintReference);
  rejectEmbeddedBlueprintFields(patch);
  if (patch.evidence !== undefined) next.evidence = normalizeEvidence(patch.evidence); if (patch.related_issue_ids !== undefined) next.related_issue_ids = normalizeRelated(patch.related_issue_ids);
  if (patch.finding_kind !== undefined || patch.findingKind !== undefined) next.finding_kind = normalizeFindingKind(patch.finding_kind ?? patch.findingKind);
  if (patch.relation_type !== undefined || patch.relationType !== undefined) next.relation_type = normalizeRelationType(patch.relation_type ?? patch.relationType);
  if (patch.scope_amendment !== undefined || patch.scopeAmendment !== undefined) next.scope_amendment = normalizeScopeAmendment(patch.scope_amendment ?? patch.scopeAmendment); if (patch.status !== undefined) {
    const status = String(patch.status).toUpperCase(); assert(ISSUE_STATUSES.includes(status), "ISSUE_REGISTRAR_INVALID_STATUS", "issue status is invalid");
    if (ISSUE_TERMINAL_OWNER_STATUSES.includes(status)) assertOwner(actor); next.status = status; next.lifecycle_stage = status === "INTAKE_FAILED" ? "NOT_AUTHORIZED" : status;
    if (ISSUE_TERMINAL_OWNER_STATUSES.includes(status)) next.owner_decision = {status, decided_by: actorRole(actor), decided_at_utc: nowUtc};
  }
  if (next.status === "READY") validateReadyCompleteness(next);
  if (patch.regression_of !== undefined) {
    assert(ISSUE_ID.test(String(patch.regression_of)), "ISSUE_REGISTRAR_INVALID_RELATION", "regression_of is invalid"); next.regression_of = String(patch.regression_of); next.status = "REGRESSION";
    next.lifecycle_stage = "REGRESSION";
  }
  if (patch.supersedes !== undefined) {
    assert(ISSUE_ID.test(String(patch.supersedes)), "ISSUE_REGISTRAR_INVALID_RELATION", "supersedes is invalid"); next.supersedes = String(patch.supersedes); next.status = "SUPERSEDED";
    next.lifecycle_stage = "SUPERSEDED";
  }
  next.updated_at_utc = nowUtc; next.history = normalizeHistory(next.history, nowUtc, event, patch.reason ?? `Issue transition ${event}.`, actorRole(actor) ?? ISSUE_REGISTRAR_ROLE_ID);
  next.issue_sha256 = digestWithout(next, "issue_sha256"); return validateIssueRecord(next);
}
export function completeIssue(registry, issueIdValue, fields = {}, {nowUtc, actor = ISSUE_REGISTRAR_ROLE_ID} = {}) {
  validateIssueRegistry(registry); const found = registry.issues.find((item) => item.issue_id === issueIdValue); assert(found, "ISSUE_REGISTRAR_NOT_FOUND", "issue ID does not exist");
  const next = patchIssue(found, {...fields, status: undefined}, timestamp({nowUtc}), "INTAKE_COMPLETED", actor);
  const intake = buildSubmissionRecord({...fields, reporter: fields.reporter ?? found.reporter, evidence: fields.evidence ?? found.evidence, product_prefix: found.product_prefix, year: found.year}, {prefix: found.product_prefix, year: found.year, number: found.number, reservationId: found.reservation_id, nowUtc: timestamp({nowUtc})});
  for (const field of ["title", "summary", "category", "severity", "reporter", "evidence", "accepted_fields", "missing_fields", "invalid_fields", "resubmission_requirements", "reason", "failure_code"]) next[field] = intake[field];
  next.issue_id = found.issue_id; next.root_issue_id = found.root_issue_id ?? found.issue_id; if (next.missing_fields.length === 0 && next.invalid_fields.length === 0) {
    next.status = "READY"; next.lifecycle_stage = "READY"; next.failure_code = null;
  } else {
    next.status = "INTAKE_FAILED"; next.lifecycle_stage = "NOT_AUTHORIZED"; next.failure_code = ISSUE_REGISTRAR_FAILURE_CODE;
  }
  next.updated_at_utc = timestamp({nowUtc}); next.issue_sha256 = digestWithout(next, "issue_sha256");
  const nextRegistry = compileIssueRegistry({productPrefixes: registry.product_prefixes, reservations: registry.reservations, nextNumbers: registry.next_numbers, issues: registry.issues.filter((item) => item.issue_id !== issueIdValue).concat(next), duplicateSubmissions: registry.duplicate_submissions});
  return {registry: nextRegistry, issue: next, receipt: receiptFor("COMPLETED", next, next.updated_at_utc)};
}
export function updateIssue(registry, issueIdValue, patch = {}, {nowUtc, actor = ISSUE_REGISTRAR_ROLE_ID} = {}) {
  validateIssueRegistry(registry); const found = registry.issues.find((item) => item.issue_id === issueIdValue); assert(found, "ISSUE_REGISTRAR_NOT_FOUND", "issue ID does not exist");
  if (ISSUE_TERMINAL_OWNER_STATUSES.includes(found.status) && patch.status !== "REOPENED" && patch.status !== "SUPERSEDED" && patch.status !== "REGRESSION") {
    throw fail("ISSUE_REGISTRAR_TERMINAL_IMMUTABLE", "resolved records may only advance, reopen, link, or supersede");
  }
  const next = patchIssue(found, patch, timestamp({nowUtc}), patch.status ?? "UPDATED", actor);
  const nextRegistry = compileIssueRegistry({productPrefixes: registry.product_prefixes, reservations: registry.reservations, nextNumbers: registry.next_numbers, issues: registry.issues.filter((item) => item.issue_id !== issueIdValue).concat(next), duplicateSubmissions: registry.duplicate_submissions});
  return {registry: nextRegistry, issue: next, receipt: receiptFor("UPDATED", next, next.updated_at_utc)};
}
export function reopenIssue(registry, issueIdValue, {rootIssueId = issueIdValue, nowUtc, actor = ISSUE_REGISTRAR_ROLE_ID, reason = "Issue reopened after a same-root recurrence."} = {}) {
  if (rootIssueId !== issueIdValue) throw fail("ISSUE_REGISTRAR_DIFFERENT_ROOT_REQUIRES_LINK", "a different-root recurrence must be a linked new issue");
  return updateIssue(registry, issueIdValue, {status: "REOPENED", reason}, {nowUtc, actor});
}
export function submitRegression(registry, input, regressionOf, options = {}) {
  assert(ISSUE_ID.test(regressionOf), "ISSUE_REGISTRAR_INVALID_RELATION", "regression_of is invalid"); return submitIssue(registry, {...input, regression_of: regressionOf}, options);
}
export function submitSeamFinding(registry, input, rootIssueId, relationType = "SAME_ROOT_CAUSE", options = {}) {
  assert(ISSUE_ID.test(String(rootIssueId)), "ISSUE_REGISTRAR_ROOT_REQUIRED", "a seam finding requires an existing root issue ID"); const relation = normalizeRelationType(relationType);
  const requestedScope = input?.scope_amendment ?? input?.scopeAmendment;
  assert(requestedScope !== null && requestedScope !== undefined, "ISSUE_REGISTRAR_SCOPE_AMENDMENT_REQUIRED", "a causal seam finding requires an explicit scope amendment"); const finding = submitIssue(registry, {
    ...input,
    finding_kind: input?.finding_kind ?? input?.findingKind ?? "SEAM_FINDING",
    root_issue_id: rootIssueId,
    relation_type: relation,
    scope_amendment: requestedScope,
  }, options); return resultWithRelation(finding, relation, rootIssueId);
}
function resultWithRelation(result, relation, rootIssueId) {
  return {...result, seam_relation: relation, root_issue_id: rootIssueId};
}
function closureEntries(value) {
  if (value === undefined || value === null) return []; assert(Array.isArray(value), "ISSUE_REGISTRAR_SEAM_CLOSURE_INVALID", "seam closure must be an array"); return value.map((entry) => {
    if (typeof entry === "string") return {issue_id: entry}; assert(isRecord(entry), "ISSUE_REGISTRAR_SEAM_CLOSURE_INVALID", "seam closure entries must be typed records"); return clone(entry);
  });
}
function verifyScopeAmendment(scopeAmendment, rootId, companionIds) {
  assert(isRecord(scopeAmendment), "ISSUE_REGISTRAR_SCOPE_AMENDMENT_REQUIRED", "a causal seam closure requires a typed scope-amendment intake");
  const root = String(scopeAmendment.root_issue_id ?? scopeAmendment.rootIssueId ?? ""); assert(root === rootId, "ISSUE_REGISTRAR_SCOPE_ROOT_MISMATCH", "scope amendment root does not match the READY root issue");
  const listed = scopeAmendment.companion_issue_ids ?? scopeAmendment.companionIssueIds ?? scopeAmendment.issue_ids;
  assert(Array.isArray(listed), "ISSUE_REGISTRAR_SCOPE_IDS_REQUIRED", "scope amendment must enumerate companion issue IDs"); const ordered = [...listed].map(String).sort(compareUtf8);
  assert(JSON.stringify(ordered) === JSON.stringify(listed.map(String)), "ISSUE_REGISTRAR_NONDETERMINISTIC_ORDER", "scope amendment companion IDs are not sorted");
  assert(JSON.stringify(ordered) === JSON.stringify(companionIds), "ISSUE_REGISTRAR_SCOPE_IDS_MISMATCH", "scope amendment companions do not match the closure set");
  const rationale = asOptionalString(scopeAmendment.rationale ?? scopeAmendment.reason); requireText(rationale, "scope amendment rationale"); const paths = scopeAmendment.paths ?? scopeAmendment.path_list;
  assert(Array.isArray(paths) && paths.length > 0, "ISSUE_REGISTRAR_SCOPE_PATHS_REQUIRED", "scope amendment must enumerate bounded paths"); const pathStrings = paths.map(String);
  sortedUnique(pathStrings, "scope amendment paths"); const mapping = scopeAmendment.verification_mapping ?? scopeAmendment.verificationMapping;
  assert(isRecord(mapping), "ISSUE_REGISTRAR_SCOPE_VERIFICATION_REQUIRED", "scope amendment must include verification mapping"); for (const id of companionIds) requireText(mapping[id], `verification mapping for ${id}`);
  const authority = asOptionalString(scopeAmendment.authority ?? scopeAmendment.authorized_by ?? scopeAmendment.authorizedBy);
  assert(authority !== null, "ISSUE_REGISTRAR_SCOPE_AUTHORITY_REQUIRED", "scope amendment requires explicit authority");
  assert(![ISSUE_REGISTRAR_ROLE_ID, "REPAIR", "AGENTOS.REPAIR"].includes(authority), "ISSUE_REGISTRAR_SELF_AUTHORIZATION", "Repair or Registrar cannot self-authorize a scope amendment"); return {
    root_issue_id: root,
    companion_issue_ids: [...companionIds],
    rationale,
    paths: pathStrings,
    verification_mapping: clone(mapping),
    authority,
  };
}
function validateSeamCompanion(companion, rootId, registeredById) {
  const issueId = String(companion.issue_id ?? companion.issueId ?? ""); assert(ISSUE_ID.test(issueId), "ISSUE_REGISTRAR_SEAM_ID_REQUIRED", "every causal companion requires a registered issue ID");
  const registered = registeredById.get(issueId);
  assert(registered !== undefined, "ISSUE_REGISTRAR_SEAM_COMPANION_NOT_REGISTERED", "causal companion must resolve to an authoritative registered issue record");
  const registeredRecord = clone(registered); delete registeredRecord.lane; validateIssueRecord(registeredRecord);
  const registeredKind = normalizeFindingKind(registered.finding_kind ?? "ISSUE");
  const suppliedKind = companion.finding_kind ?? companion.findingKind;
  if (suppliedKind !== undefined) assert(normalizeFindingKind(suppliedKind) === registeredKind, "ISSUE_REGISTRAR_SEAM_RECORD_MISMATCH", "typed companion finding kind differs from its registered issue");
  const kind = registeredKind;
  assert(kind === "SEAM_FINDING" || kind === "SCOPE_AMENDMENT", "ISSUE_REGISTRAR_SEAM_FINDING_REQUIRED", "every companion must arrive as SEAM_FINDING or SCOPE_AMENDMENT intake");
  const registeredRelation = normalizeRelationType(registered.relation_type ?? null);
  const suppliedRelation = companion.relation_type ?? companion.relationType;
  if (suppliedRelation !== undefined) assert(normalizeRelationType(suppliedRelation) === registeredRelation, "ISSUE_REGISTRAR_SEAM_RECORD_MISMATCH", "typed companion relation differs from its registered issue");
  const relation = registeredRelation;
  assert(relation !== null && ISSUE_REGISTRAR_SEAM_RELATIONS.includes(relation), "ISSUE_REGISTRAR_SEAM_RELATION_REQUIRED", "every companion requires an allowed causal relation");
  const registeredRoot = String(registered.root_issue_id ?? "");
  const suppliedRoot = companion.root_issue_id ?? companion.rootIssueId;
  if (suppliedRoot !== undefined) assert(String(suppliedRoot) === registeredRoot, "ISSUE_REGISTRAR_SEAM_RECORD_MISMATCH", "typed companion root differs from its registered issue");
  assert(registeredRoot === rootId, "ISSUE_REGISTRAR_UNRELATED_SCOPE", "companion issue is not same-root");
  const status = String(registered.status ?? "").toUpperCase();
  const suppliedStatus = companion.status;
  if (suppliedStatus !== undefined) assert(String(suppliedStatus).toUpperCase() === status, "ISSUE_REGISTRAR_SEAM_RECORD_MISMATCH", "typed companion status differs from its registered issue");
  assert(!["INTAKE_FAILED", "BLOCKED", "NOT_READY", "DEFERRED", "ACCEPTED_RISK", "WONT_FIX", "SUPERSEDED"].includes(status), "ISSUE_REGISTRAR_SEAM_COMPANION_NOT_ACTIVE", "causal companion is not eligible for the active closure set");
  const registeredScope = registered.scope_amendment ?? null;
  assert(registeredScope !== null, "ISSUE_REGISTRAR_SCOPE_AMENDMENT_REQUIRED", "causal companion requires scope-amendment evidence");
  const suppliedScope = companion.scope_amendment ?? companion.scopeAmendment;
  if (suppliedScope !== undefined) assert(JSON.stringify(normalizeScopeAmendment(suppliedScope)) === JSON.stringify(normalizeScopeAmendment(registeredScope)), "ISSUE_REGISTRAR_SEAM_RECORD_MISMATCH", "typed companion scope differs from its registered issue");
  return {issue_id: issueId, relation_type: relation, finding_kind: kind, root_issue_id: rootId, scope_amendment: normalizeScopeAmendment(registeredScope)};
}
export function validateIssueSeamClosure({rootIssue, issue = rootIssue, registration = null, lane = null, activeIssues = [], ownerAtomicGroup = null, seamClosure, closureSet, companionIssues, scopeAmendment, scope_amendment, rootIssueId = null, root_issue_id = null, repairActor = null, actor = null, auditorReview = null, broadAudit = false, productIntentDecision = false, speculative = false, custodyConflict = false} = {}) {
  validateIssueRecord(issue); const root = rootIssue ?? issue; validateIssueRecord(root); assert(root.issue_id === issue.issue_id, "ISSUE_REGISTRAR_ROOT_REQUIRED", "the claimed READY root must be the admitted issue");
  const claimedRootId = rootIssueId ?? root_issue_id;
  if (claimedRootId !== null && claimedRootId !== undefined) assert(String(claimedRootId) === root.issue_id, "ISSUE_REGISTRAR_ROOT_MISMATCH", "claimed root issue does not match the admitted issue");
  assert(root.status === "READY" && root.lifecycle_stage === "READY", "ISSUE_REGISTRAR_ROOT_NOT_READY", "exactly one compliant READY root issue is required");
  const proof = registration ?? root.registration ?? root.audit ?? null; const pass = proof?.pass === true || proof?.status === "PASS" || proof?.verification_status === "PASS";
  const ready = proof?.ready === true || root.status === "READY"; assert(pass && ready, "ISSUE_REGISTRAR_REPAIR_NOT_READY", "Repair requires a registered PASS+READY root issue");
  assert(broadAudit !== true && productIntentDecision !== true && speculative !== true && custodyConflict !== true, "ISSUE_REGISTRAR_UNAUTHORIZED_SCOPE", "broad audit, product-intent, speculative, or conflicting custody scope is forbidden");
  if (auditorReview?.status === "FAIL" || auditorReview?.accepted === false || auditorReview?.scope_accepted === false) throw fail("ISSUE_REGISTRAR_AUDITOR_SCOPE_REJECTED", "Auditor rejected the proposed causal scope");
  const closureValue = seamClosure ?? closureSet ?? companionIssues; const entries = closureEntries(closureValue);
  assert(entries.length <= ISSUE_REGISTRAR_MAX_SEAM_CLOSURE, "ISSUE_REGISTRAR_SEAM_CLOSURE_TOO_LARGE", "causal seam closure exceeds its bounded maximum");
  const registered = Array.isArray(activeIssues) ? activeIssues.filter((candidate) => candidate && candidate.issue_id !== root.issue_id) : [];
  const registeredById = new Map(registered.map((candidate) => [candidate.issue_id, candidate]));
  const active = registered.filter((candidate) => lane === null || candidate.lane === undefined || candidate.lane === lane); const activeStatuses = new Set(["READY", "IN_REPAIR", "AUDITING", "REOPENED"]);
  const conflicts = active.filter((candidate) => activeStatuses.has(String(candidate.status).toUpperCase())); const companionIds = entries.map((entry) => String(entry.issue_id ?? entry.issueId ?? "")).sort(compareUtf8);
  assert(new Set(companionIds).size === companionIds.length, "ISSUE_REGISTRAR_SEAM_DUPLICATE", "causal seam companions must be unique");
  assert(!companionIds.includes(root.issue_id), "ISSUE_REGISTRAR_SEAM_ROOT_INCLUDED", "the READY root cannot also be a companion");
  if (conflicts.length > 0 && entries.length === 0) throw fail("ISSUE_REGISTRAR_ONE_LANE_ONLY", "one lane requires an explicit root plus bounded causal seam closure");
  const companions = entries.map((entry) => validateSeamCompanion(entry, root.issue_id, registeredById)); if (companions.some((companion) => companion.relation_type === "OWNER_ATOMIC_SEAM")) {
    assert(ownerAtomicGroup?.owner_authorized === true, "ISSUE_REGISTRAR_SCOPE_AUTHORITY_REQUIRED", "OWNER_ATOMIC_SEAM requires an explicit Owner atomic group");
  }
  const conflictIds = conflicts.map((candidate) => candidate.issue_id).sort(compareUtf8); for (const candidate of conflicts) {
    if (!companionIds.includes(candidate.issue_id)) throw fail("ISSUE_REGISTRAR_UNRELATED_SCOPE", "unrelated active finding is not included in the bounded causal closure");
    if (candidate.root_issue_id !== root.issue_id) throw fail("ISSUE_REGISTRAR_UNRELATED_SCOPE", "active finding has a different causal root");
  }
  if (entries.length > 0) {
    const amendment = verifyScopeAmendment(scopeAmendment ?? scope_amendment, root.issue_id, companionIds); const repairIdentity = actor ?? repairActor;
    if (repairIdentity !== null && [ISSUE_REGISTRAR_ROLE_ID, "REPAIR", "AGENTOS.REPAIR"].includes(actorRole(repairIdentity))) throw fail("ISSUE_REGISTRAR_SELF_AUTHORIZATION", "Registrar or Repair cannot authorize its own seam expansion");
    return {
      accepted: true,
      status: "REPAIR_ADMITTED",
      issue_id: root.issue_id,
      root_issue_id: root.issue_id,
      companion_issue_ids: companionIds,
      causal_seam_closure: companions,
      scope_amendment: amendment,
      active_conflict_issue_ids: conflictIds,
      lane,
      handoff_scope: {root_issue_id: root.issue_id, companion_issue_ids: companionIds, paths: amendment.paths, verification_mapping: amendment.verification_mapping},
    };
  }
  return {accepted: true, status: "REPAIR_ADMITTED", issue_id: root.issue_id, root_issue_id: root.issue_id, companion_issue_ids: [], causal_seam_closure: [], scope_amendment: null, active_conflict_issue_ids: [], lane, handoff_scope: {root_issue_id: root.issue_id, companion_issue_ids: [], paths: [], verification_mapping: {}}};
}
export function validateIssueWorkflowAdmission(options = {}) {
  return validateIssueSeamClosure(options);
}
export function validateIssueAuditAdmission({issue, candidate} = {}) {
  validateIssueRecord(issue); assert(ISSUE_ID.test(issue.issue_id), "ISSUE_REGISTRAR_AUDIT_ID_REQUIRED", "audit requires a registered issue ID");
  assert(isRecord(candidate), "ISSUE_REGISTRAR_AUDIT_CONTRACT_REQUIRED", "audit requires an immutable candidate");
  for (const field of ["commit", "tree", "scope", "verification_contract"]) requireText(candidate[field], `audit candidate ${field}`);
  assert(HEX40.test(candidate.commit) || SHA256.test(candidate.commit), "ISSUE_REGISTRAR_AUDIT_IDENTITY_INVALID", "candidate commit identity is invalid");
  assert(HEX40.test(candidate.tree) || SHA256.test(candidate.tree), "ISSUE_REGISTRAR_AUDIT_IDENTITY_INVALID", "candidate tree identity is invalid");
  return {accepted: true, status: "AUDIT_ADMITTED", issue_id: issue.issue_id, candidate: clone(candidate)};
}
export function validateIssueRuntimeDelivery({issue, candidate, independentPass, delivery} = {}) {
  validateIssueRecord(issue); validateIssueAuditAdmission({issue, candidate}); const pass = independentPass?.status === "PASS" || independentPass?.pass === true;
  assert(pass && independentPass?.identical_bytes === true, "ISSUE_REGISTRAR_RUNTIME_PASS_REQUIRED", "Runtime requires an identical-byte independent PASS");
  assert(isRecord(delivery), "ISSUE_REGISTRAR_DELIVERY_REQUIRED", "Runtime delivery evidence is required");
  for (const field of ["local_commit", "origin_commit", "github_commit", "local_tree", "origin_tree", "github_tree"]) {
    requireText(delivery[field], `delivery ${field}`); const valid = field.endsWith("commit") ? HEX40.test(delivery[field]) || SHA256.test(delivery[field]) : HEX40.test(delivery[field]) || SHA256.test(delivery[field]);
    assert(valid, "ISSUE_REGISTRAR_DELIVERY_IDENTITY_MISMATCH", `delivery ${field} is not a commit/tree digest`);
  }
  const equal = delivery.local_commit === delivery.origin_commit
    && delivery.origin_commit === delivery.github_commit
    && delivery.local_tree === delivery.origin_tree
    && delivery.origin_tree === delivery.github_tree
    && delivery.local_commit === candidate.commit
    && delivery.local_tree === candidate.tree; assert(equal, "ISSUE_REGISTRAR_DELIVERY_IDENTITY_MISMATCH", "local/fetched-origin/GitHub identities must equal the audited candidate");
  assert(delivery.status === "DELIVERED_VERIFIED" || delivery.delivered === true, "ISSUE_REGISTRAR_DELIVERY_REQUIRED", "delivery must be explicitly verified");
  return {accepted: true, status: "DELIVERY_ADMITTED", issue_id: issue.issue_id, commit: candidate.commit, tree: candidate.tree};
}
function issueDetailLines(issue, {cleared = false} = {}) {
  const target = cleared ? "cleared-issue" : "issue";
  const relationship = `duplicate_of=${issue.duplicate_of ?? "none"}; regression_of=${issue.regression_of ?? "none"}; supersedes=${issue.supersedes ?? "none"}; root=${issue.root_issue_id ?? "none"}; relation=${issue.relation_type ?? "none"}`;
  const lines = [
    `<a id="${target}-${issue.issue_id.toLowerCase()}"></a>`,
    `### ${issue.issue_id}`,
    "",
    `- Summary: ${issue.summary.replaceAll("\n", " ")}`,
    `- Status / lifecycle: ${issue.status} / ${issue.lifecycle_stage}`,
    `- Finding kind: ${issue.finding_kind ?? "ISSUE"}`,
    `- Reporter task/thread: ${issue.reporter.task_id ?? "(not provided)"} / ${issue.reporter.thread_id ?? "(not provided)"}`,
    `- Reporter turn/item: ${issue.reporter.turn_id ?? "(not provided)"} / ${issue.reporter.item_id ?? "(not provided)"}`,
    `- Evidence: ${issue.evidence.map((entry) => `${entry.evidence_id} (${entry.reference})`).join(", ") || "(none)"}`,
    `- Blueprint release reference: ${issue.blueprint_reference === null || issue.blueprint_reference === undefined ? "(none)" : `${issue.blueprint_reference.release_id} (${issue.blueprint_reference.path}; ${issue.blueprint_reference.sha256})`}`,
    `- Relationships: ${relationship}`,
  ]; if (issue.scope_amendment !== null && issue.scope_amendment !== undefined) lines.push(`- Scope amendment: ${JSON.stringify(issue.scope_amendment)}`);
  if (cleared) lines.push(`- Delivery: ${JSON.stringify(issue.delivery)}`); lines.push(""); return lines;
}
export function compileIssueMarkdown(registry) {
  validateIssueRegistry(registry); const visible = (issue) => !isClearedIssue(issue); const sections = [
    ["provisional", "Provisional / Compliance Failures", (issue) => visible(issue) && (["INTAKE_FAILED", "NOT_READY"].includes(issue.status) || issue.lifecycle_stage === "NOT_AUTHORIZED")],
    ["ready", "READY", (issue) => visible(issue) && issue.status === "READY"],
    ["in-repair", "In Repair", (issue) => visible(issue) && issue.status === "IN_REPAIR"],
    ["auditing", "Auditing", (issue) => visible(issue) && issue.status === "AUDITING"],
    ["blocked", "Blocked / NOT_READY", (issue) => visible(issue) && (issue.status === "BLOCKED" || issue.status === "NOT_READY")],
    ["delivered", "Delivered", (issue) => visible(issue) && issue.status === "DELIVERED"],
    ["regressions", "Regressions", (issue) => visible(issue) && issue.status === "REGRESSION"],
  ]; const lines = [
    "# AgentOS Issue Registry",
    "",
    `Registry digest: \`${registry.registry_sha256}\``,
    "",
    "This projection is generated by AGENTOS.ISSUE_REGISTRAR from typed state and immutable evidence references.",
    "",
  ]; for (const [anchor, heading, predicate] of sections) {
    lines.push(`<a id="${anchor}"></a>`, `## ${heading}`, "", "| Issue | Title | Status | Severity | Lifecycle |", "| --- | --- | --- | --- | --- |");
    const selected = registry.issues.filter(predicate).sort((left, right) => compareUtf8(left.issue_id, right.issue_id));
    for (const issue of selected) lines.push(`| [${issue.issue_id}](#issue-${issue.issue_id.toLowerCase()}) | ${issue.title.replaceAll("|", "\\|")} | ${issue.status} | ${issue.severity} | ${issue.lifecycle_stage} |`);
    if (selected.length === 0) lines.push("| _none_ |  |  |  |  |"); lines.push("");
  }
  const cleared = registry.issues.filter(isClearedIssue).sort((left, right) => compareUtf8(left.issue_id, right.issue_id));
  lines.push(`<a id="cleared-tombstones"></a>`, "## Cleared issue tombstones", "", "| Issue | State | Full record | Delivery commit/tree |", "| --- | --- | --- | --- |");
  for (const issue of cleared) lines.push(`| [${issue.issue_id}](#cleared-issue-${issue.issue_id.toLowerCase()}) | CLEARED | [cleared-issues.md](cleared-issues.md#cleared-issue-${issue.issue_id.toLowerCase()}) | ${issue.delivery.local_commit} / ${issue.delivery.local_tree} |`);
  if (cleared.length === 0) lines.push("| _none_ |  |  |  |"); lines.push(""); lines.push("## Permanent details", ""); for (const issue of registry.issues.filter(visible)) lines.push(...issueDetailLines(issue));
  return `${lines.join("\n").replace(/\n{3,}/gu, "\n\n")}\n`;
}
export function compileClearedIssuesMarkdown(registry) {
  validateIssueRegistry(registry); const cleared = registry.issues.filter(isClearedIssue).sort((left, right) => compareUtf8(left.issue_id, right.issue_id)); const lines = [
    "# AgentOS Cleared Issues",
    "",
    `Registry digest: \`${registry.registry_sha256}\``,
    "",
    "This projection contains full records only after identical-byte independent PASS and verified local/fetched-origin/GitHub equality.",
    "",
    "<a id=\"cleared\"></a>",
    "## Delivered / Resolved",
    "",
  ]; if (cleared.length === 0) lines.push("_none_", ""); for (const issue of cleared) lines.push(...issueDetailLines(issue, {cleared: true})); return `${lines.join("\n").replace(/\n{3,}/gu, "\n\n")}\n`;
}
function safeProjectionTarget(target, expected, label) {
  const resolved = path.resolve(target ?? expected); assert(resolved === expected, "ISSUE_REGISTRAR_CANONICAL_PATH_REQUIRED", `${label} is restricted to its canonical path`);
  const root = path.dirname(expected); const rootParts = root.split(path.sep).filter(Boolean); let current = path.parse(root).root;
  for (const part of rootParts) {
    current = path.join(current, part);
    try {
      const stat = fs.lstatSync(current); assert(!stat.isSymbolicLink(), "ISSUE_REGISTRAR_PROJECTION_COLLISION", `${label} has a symlinked ancestor`); assert(stat.isDirectory(), "ISSUE_REGISTRAR_PROJECTION_COLLISION", `${label} has a non-directory ancestor`);
    } catch (error) {
      if (error?.code === "ENOENT") break; throw error;
    }
  }
  const relative = path.relative(root, resolved); assert(relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative), "ISSUE_REGISTRAR_CANONICAL_PATH_REQUIRED", `${label} escapes its authorized root`);
  try {
    const stat = fs.lstatSync(resolved); assert(!stat.isSymbolicLink() && stat.isFile(), "ISSUE_REGISTRAR_PROJECTION_COLLISION", `${label} collides with a non-regular file`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return resolved;
}
function projectionReceipt(registry, issuesMarkdown, clearedMarkdown) {
  const cleared = registry.issues.filter(isClearedIssue).sort((left, right) => compareUtf8(left.issue_id, right.issue_id));
  const visible = registry.issues.filter((issue) => !isClearedIssue(issue)).sort((left, right) => compareUtf8(left.issue_id, right.issue_id)); const receipt = {
    schema: "agentos.issue_projection_receipt.v1",
    version: ISSUE_REGISTRAR_VERSION,
    registry_sha256: registry.registry_sha256,
    issues_filename: ISSUE_REGISTRAR_CANONICAL_FILENAME,
    cleared_filename: ISSUE_REGISTRAR_CLEARED_CANONICAL_FILENAME,
    counts: {registry: registry.issues.length, issues: visible.length, cleared: cleared.length},
    issue_ids: visible.map((issue) => issue.issue_id),
    cleared_issue_ids: cleared.map((issue) => issue.issue_id),
    issues_markdown_sha256: canonicalDigest({markdown: issuesMarkdown}),
    cleared_markdown_sha256: canonicalDigest({markdown: clearedMarkdown}),
    projection_sha256: null,
  }; receipt.projection_sha256 = digestWithout(receipt, "projection_sha256"); return receipt;
}
export function reconcileIssueProjections(registry, {issuesMarkdown = undefined, clearedMarkdown = undefined} = {}) {
  validateIssueRegistry(registry); const expectedIssues = compileIssueMarkdown(registry); const expectedCleared = compileClearedIssuesMarkdown(registry);
  if (issuesMarkdown !== undefined) assert(issuesMarkdown === expectedIssues, "ISSUE_REGISTRAR_PROJECTION_DIGEST_MISMATCH", "issues.md projection bytes do not match typed state");
  if (clearedMarkdown !== undefined) assert(clearedMarkdown === expectedCleared, "ISSUE_REGISTRAR_PROJECTION_DIGEST_MISMATCH", "cleared-issues.md projection bytes do not match typed state");
  const receipt = projectionReceipt(registry, expectedIssues, expectedCleared);
  assert(new Set(receipt.issue_ids).size === receipt.issue_ids.length && new Set(receipt.cleared_issue_ids).size === receipt.cleared_issue_ids.length, "ISSUE_REGISTRAR_PROJECTION_COLLISION", "projection IDs are not unique");
  assert(receipt.issue_ids.every((id) => !receipt.cleared_issue_ids.includes(id)), "ISSUE_REGISTRAR_PROJECTION_COLLISION", "an issue cannot appear in both projections");
  assert(receipt.issue_ids.length + receipt.cleared_issue_ids.length === registry.issues.length, "ISSUE_REGISTRAR_PROJECTION_RECONCILIATION_FAILED", "projection counts do not reconcile to registry");
  return {accepted: true, status: "PROJECTIONS_RECONCILED", ...receipt, issues_markdown: expectedIssues, cleared_markdown: expectedCleared};
}
export const compileIssueProjectionReceipt = reconcileIssueProjections;
export function writeIssuesMarkdownAtomic(registry, {operationsRoot, canonicalPath = null, targetPath = null, clearedCanonicalPath = null, clearedTargetPath = null, actor, deliveryEvidence} = {}) {
  validateIssueRegistry(registry); assert(actorRole(actor) === ISSUE_REGISTRAR_ROLE_ID, "ISSUE_REGISTRAR_SOLE_WRITER_REQUIRED", "only the admitted Issue Registrar may write both issue projections");
  requireText(operationsRoot, "operations root"); const expected = path.resolve(operationsRoot, ISSUE_REGISTRAR_CANONICAL_FILENAME);
  const expectedCleared = path.resolve(operationsRoot, ISSUE_REGISTRAR_CLEARED_CANONICAL_FILENAME); const requested = safeProjectionTarget(targetPath ?? canonicalPath ?? expected, expected, "issues.md");
  const requestedCleared = safeProjectionTarget(clearedTargetPath ?? clearedCanonicalPath ?? expectedCleared, expectedCleared, "cleared-issues.md");
  assert(requested !== requestedCleared, "ISSUE_REGISTRAR_PROJECTION_COLLISION", "projection targets must be distinct"); const clearedCount = registry.issues.filter(isClearedIssue).length;
  assert(clearedCount === 0 || isRuntimeDeliveryVerified(deliveryEvidence), "ISSUE_REGISTRAR_DELIVERY_REQUIRED", "cleared projections require independent PASS and equal Runtime identities");
  assert(deliveryEvidence === undefined || deliveryEvidence?.status === "DELIVERED_VERIFIED" || deliveryEvidence?.delivered === true, "ISSUE_REGISTRAR_DELIVERY_REQUIRED", "supplied projection delivery evidence must be explicitly verified");
  const markdown = compileIssueMarkdown(registry); const clearedMarkdown = compileClearedIssuesMarkdown(registry); const projection = reconcileIssueProjections(registry, {issuesMarkdown: markdown, clearedMarkdown});
  fs.mkdirSync(path.dirname(expected), {recursive: true}); safeProjectionTarget(expected, expected, "issues.md"); safeProjectionTarget(expectedCleared, expectedCleared, "cleared-issues.md"); const token = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`; const entries = [
    {target: expected, data: markdown, suffix: "issues"},
    {target: expectedCleared, data: clearedMarkdown, suffix: "cleared"},
  ]; const created = []; const backups = []; let installed = []; try {
    for (const entry of entries) {
      const temporary = `${entry.target}.tmp-${token}-${entry.suffix}`; const fd = fs.openSync(temporary, "wx", 0o644); try {
        fs.writeFileSync(fd, entry.data, "utf8"); fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      created.push(temporary);
    }
    for (const entry of entries) {
      if (fs.existsSync(entry.target)) {
        const backup = `${entry.target}.bak-${token}-${entry.suffix}`; fs.renameSync(entry.target, backup); backups.push({target: entry.target, backup});
      }
    }
    for (let index = 0; index < entries.length; index += 1) {
      fs.renameSync(created[index], entries[index].target); installed.push(entries[index].target);
    }
    for (const backup of backups) fs.unlinkSync(backup.backup); installed = [];
  } catch (error) {
    for (const targetPath of installed) {
      try { fs.unlinkSync(targetPath); } catch {}
    }
    for (const temporary of created) {
      try { fs.unlinkSync(temporary); } catch {}
    }
    for (const backup of backups.reverse()) {
      try { if (fs.existsSync(backup.target)) fs.unlinkSync(backup.target); } catch {}
      try { fs.renameSync(backup.backup, backup.target); } catch {}
    }
    throw fail("ISSUE_REGISTRAR_PROJECTION_ATOMIC_WRITE_FAILED", `dual projection write rolled back: ${error.message}`);
  } finally {
    for (const temporary of created) {
      try { fs.unlinkSync(temporary); } catch {}
    }
    for (const backup of backups) {
      try { fs.unlinkSync(backup.backup); } catch {}
    }
  }
  return {
    path: requested,
    cleared_path: requestedCleared,
    paths: [requested, requestedCleared],
    bytes: Buffer.byteLength(markdown),
    cleared_bytes: Buffer.byteLength(clearedMarkdown),
    sha256: canonicalDigest({markdown}),
    cleared_sha256: canonicalDigest({markdown: clearedMarkdown}),
    markdown,
    cleared_markdown: clearedMarkdown,
    projection,
  };
}
export function importHistoricalIssues(sources, {registry = compileIssueRegistry(), productPrefix = "SOCIUNA", year = normalizeYear(), nowUtc} = {}) {
  assert(Array.isArray(sources), "ISSUE_REGISTRAR_HISTORICAL_INPUT_REQUIRED", "historical sources must be an array"); let current = registry; const imported = [];
  for (const source of [...sources].sort((left, right) => compareUtf8(String(left.source_id ?? left.sourceId ?? ""), String(right.source_id ?? right.sourceId ?? "")))) {
    assert(isRecord(source), "ISSUE_REGISTRAR_HISTORICAL_INVALID", "historical source must be an object"); const result = submitIssue(current, {
      ...source,
      product_prefix: source.product_prefix ?? productPrefix,
      year: source.year ?? year,
      title: source.title ?? source.name ?? source.finding_title,
      summary: source.summary ?? source.description ?? source.finding,
      category: source.category ?? source.classification ?? "LEGACY_IMPORT",
      severity: source.severity ?? "MEDIUM",
      reporter: source.reporter ?? {identity: "HISTORICAL_IMPORT"},
      evidence: source.evidence ?? (source.source_sha256 ? [{evidence_id: "HISTORICAL.SOURCE", kind: "SOURCE_REPORT", sha256: source.source_sha256, reference: source.source_ref ?? "opaque:historical-source"}] : []),
      source_id: source.source_id ?? source.sourceId,
      source_ref: source.source_ref ?? source.sourceRef,
      missing_evidence_reasons: source.missing_evidence_reasons ?? (source.uncertain ? ["Legacy source did not provide complete evidence."] : []),
    }, {nowUtc, historical: true, productPrefix, year}); current = result.registry; imported.push(result.issue.issue_id);
  }
  return {registry: current, imported};
}
export function reconcileIssueRegistry(registry) {
  validateIssueRegistry(registry); const issueIds = new Set(); for (const issue of registry.issues) {
    assert(!issueIds.has(issue.issue_id), "ISSUE_REGISTRAR_DUPLICATE_ID", "reconciliation found duplicate issue ID"); issueIds.add(issue.issue_id);
  }
  return compileIssueRegistry({productPrefixes: registry.product_prefixes, reservations: registry.reservations, nextNumbers: registry.next_numbers, issues: registry.issues, duplicateSubmissions: registry.duplicate_submissions});
}
export function compileIssueRegistrarRole({blockSha256 = canonicalDigest({role: ISSUE_REGISTRAR_ROLE_ID}), evaluationSha256 = canonicalDigest({role: ISSUE_REGISTRAR_ROLE_ID, evaluation: true})} = {}) {
  requireSha(blockSha256, "Issue Registrar block digest"); requireSha(evaluationSha256, "Issue Registrar evaluation digest"); const role = {
    schema: ISSUE_REGISTRAR_SCHEMA,
    version: ISSUE_REGISTRAR_VERSION,
    role_id: ISSUE_REGISTRAR_ROLE_ID,
    title: ISSUE_REGISTRAR_ROLE_TITLE,
    role_kind: ISSUE_REGISTRAR_ROLE_KIND,
    block_sha256: blockSha256,
    evaluation_sha256: evaluationSha256,
    activation_state: "OFF",
    writer_scope: "OPERATIONS_ROOT_ISSUES_MD_AFTER_DELIVERY_ONLY",
    canonical_filename: ISSUE_REGISTRAR_CANONICAL_FILENAME,
    self_acceptance_forbidden: true,
    owner_terminal_decisions_only: true,
    role_sha256: null,
  }; role.role_sha256 = digestWithout(role, "role_sha256"); return validateIssueRegistrarRole(role);
}
export function validateIssueRegistrarRole(role) {
  assert(isRecord(role) && role.schema === ISSUE_REGISTRAR_SCHEMA && role.version === ISSUE_REGISTRAR_VERSION, "ISSUE_REGISTRAR_ROLE_INVALID", "Issue Registrar role schema/version is invalid");
  assert(role.role_id === ISSUE_REGISTRAR_ROLE_ID && role.title === ISSUE_REGISTRAR_ROLE_TITLE && role.role_kind === ISSUE_REGISTRAR_ROLE_KIND, "ISSUE_REGISTRAR_ROLE_INVALID", "Issue Registrar role identity is invalid");
  requireSha(role.block_sha256, "Issue Registrar block digest"); requireSha(role.evaluation_sha256, "Issue Registrar evaluation digest");
  assert(role.activation_state === "OFF" && role.self_acceptance_forbidden === true && role.owner_terminal_decisions_only === true, "ISSUE_REGISTRAR_ROLE_INVALID", "Issue Registrar safety flags are invalid");
  assert(role.writer_scope === "OPERATIONS_ROOT_ISSUES_MD_AFTER_DELIVERY_ONLY" && role.canonical_filename === ISSUE_REGISTRAR_CANONICAL_FILENAME, "ISSUE_REGISTRAR_ROLE_INVALID", "Issue Registrar writer scope is invalid");
  requireSha(role.role_sha256, "Issue Registrar role digest"); assert(role.role_sha256 === digestWithout(role, "role_sha256"), "ISSUE_REGISTRAR_DIGEST_MISMATCH", "Issue Registrar role digest mismatch"); return role;
}
export class IssueRegistrar {
  constructor({registry = compileIssueRegistry(), writerIdentity = ISSUE_REGISTRAR_ROLE_ID, operationsRoot = null} = {}) {
    validateIssueRegistry(registry); this.registry = registry; this.writerIdentity = writerIdentity; this.operationsRoot = operationsRoot;
  }
  submit(input, options = {}) {
    const result = submitIssue(this.registry, input, options); this.registry = result.registry; return result;
  }
  complete(issueIdValue, fields, options = {}) {
    const result = completeIssue(this.registry, issueIdValue, fields, {actor: options.actor ?? this.writerIdentity, nowUtc: options.nowUtc}); this.registry = result.registry; return result;
  }
  update(issueIdValue, patch, options = {}) {
    const result = updateIssue(this.registry, issueIdValue, patch, {actor: options.actor ?? this.writerIdentity, nowUtc: options.nowUtc}); this.registry = result.registry; return result;
  }
  importHistorical(sources, options = {}) {
    const result = importHistoricalIssues(sources, {...options, registry: this.registry}); this.registry = result.registry; return result;
  }
  reconcile() {
    this.registry = reconcileIssueRegistry(this.registry); return this.registry;
  }
  markdown() { return compileIssueMarkdown(this.registry); }
  write(options = {}) {
    return writeIssuesMarkdownAtomic(this.registry, {
      operationsRoot: options.operationsRoot ?? this.operationsRoot,
      canonicalPath: options.canonicalPath,
      targetPath: options.targetPath,
      clearedCanonicalPath: options.clearedCanonicalPath,
      clearedTargetPath: options.clearedTargetPath,
      actor: options.actor ?? this.writerIdentity,
      deliveryEvidence: options.deliveryEvidence,
    });
  }
}
export function createIssueRegistrar(options = {}) { return new IssueRegistrar(options); }
export const compileIssueSubmission = submitIssue; export const validateIssueSubmission = validateIssueRecord; export const compileIssueTransition = updateIssue; export const validateIssueTransition = updateIssue;
export const compileIssueIntake = submitIssue; export const validateIssueIntake = validateIssueRecord; export const compileIssueRole = compileIssueRegistrarRole; export const compileIssueSeamFinding = submitSeamFinding;
export const validateIssueSeam = validateIssueSeamClosure; if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("Issue Registrar contract loaded\n");
export const ISSUE_REGISTRAR_BLUEPRINT_REFERENCE_SCHEMA = BLUEPRINT_REFERENCE_SCHEMA;
export const ISSUE_REGISTRAR_BLUEPRINT_REFERENCE_VERSION = BLUEPRINT_VERSION;
export const validateIssueBlueprintReference = normalizeBlueprintReference;
export const compileIssueBlueprintReference = (value) => normalizeBlueprintReference(value);
