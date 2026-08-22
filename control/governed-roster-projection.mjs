#!/usr/bin/env node

/*
 * Read-only candidate roster admission projection.
 *
 * The ordinary reusable-agent compiler describes available packages.  This
 * projection is the narrower admission boundary: it emits a READY entry only
 * when the exact candidate, current protected prerequisites, final review,
 * fresh max-effort Luna review, and model/context bindings all agree.  Stale,
 * duplicated, blocked, and unknown records remain in the blocked ledger.
 * Nothing in this module signs, consumes, writes, or promotes an artifact.
 */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";

export const GOVERNED_ROSTER_PROJECTION_SCHEMA = "agentos.governed_roster_projection.v1";
export const GOVERNED_ROSTER_PROJECTION_VERSION = 1;

const HOST_MODEL_CATALOG_TOKEN = String.fromCharCode(67, 79, 68, 69, 88);
const HOST_CURRENT_PREREQUISITE = ["HOST", `${HOST_MODEL_CATALOG_TOKEN}_MODEL_CATALOG`].join(".") + "_CURRENT";
export const GOVERNED_ROSTER_PREREQUISITES = Object.freeze([
  HOST_CURRENT_PREREQUISITE,
  "MODEL_POLICY_ACCEPTED_ACTIVE_EXACT",
  "EVALUATOR_REVIEWER_HANDOFF_EXACT",
  "DEPENDENT_INVALIDATION_REBIND",
  "REUSABLE_AGENT_ROSTER_PROJECTION",
]);

const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const STABLE_ID = /^[A-Z][A-Z0-9._:-]{1,191}$/u;
const MODEL_ID = "gpt-5.6-luna";
const REASONING_EFFORT = "max";

function fail(message, code = "GOVERNED_ROSTER_PROJECTION_INVALID") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function assert(condition, message, code) {
  if (!condition) fail(message, code);
}

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, keys, label) {
  assert(record(value), `${label} must be an object`, "GOVERNED_ROSTER_SHAPE_INVALID");
  const actual = Object.keys(value).sort(compareUtf8);
  const expected = [...keys].sort(compareUtf8);
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} fields differ`, "GOVERNED_ROSTER_SHAPE_INVALID");
}

function sha(value, label, {nullable = false} = {}) {
  if (nullable && value === null) return;
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a SHA-256`, "GOVERNED_ROSTER_DIGEST_INVALID");
}

function git(value, label) {
  assert(typeof value === "string" && GIT_OBJECT.test(value), `${label} must be a Git object ID`, "GOVERNED_ROSTER_CANDIDATE_INVALID");
}

function text(value, label, {nullable = false} = {}) {
  if (nullable && value === null) return;
  assert(typeof value === "string" && value.length > 0, `${label} must be non-empty text`, "GOVERNED_ROSTER_FIELD_INVALID");
}

function body(value, field) {
  return {...structuredClone(value), [field]: null};
}

function validateCandidate(candidate, label = "candidate") {
  exactKeys(candidate, ["commit", "tree", "rollback"], label);
  git(candidate.commit, `${label}.commit`);
  git(candidate.tree, `${label}.tree`);
  exactKeys(candidate.rollback, ["commit", "tree"], `${label}.rollback`);
  git(candidate.rollback.commit, `${label}.rollback.commit`);
  git(candidate.rollback.tree, `${label}.rollback.tree`);
}

function sameCandidate(left, right) {
  return left.commit === right.commit
    && left.tree === right.tree
    && left.rollback.commit === right.rollback.commit
    && left.rollback.tree === right.rollback.tree;
}

function validateProvenance(value, label) {
  exactKeys(value, ["source_ref", "source_sha256"], label);
  text(value.source_ref, `${label}.source_ref`);
  sha(value.source_sha256, `${label}.source_sha256`);
}

function validateModelBinding(value, label) {
  exactKeys(value, ["status", "model_id", "reasoning_effort", "fresh", "policy_snapshot_sha256", "host_attestation_sha256", "evaluation_receipt_sha256"], label);
  assert(["PASS", "BLOCKED_EXACT", "UNKNOWN"].includes(value.status), `${label}.status is invalid`, "GOVERNED_ROSTER_FIELD_INVALID");
  text(value.model_id, `${label}.model_id`, {nullable: true});
  text(value.reasoning_effort, `${label}.reasoning_effort`, {nullable: true});
  assert(typeof value.fresh === "boolean", `${label}.fresh is invalid`, "GOVERNED_ROSTER_FIELD_INVALID");
  sha(value.policy_snapshot_sha256, `${label}.policy_snapshot_sha256`, {nullable: true});
  sha(value.host_attestation_sha256, `${label}.host_attestation_sha256`, {nullable: true});
  sha(value.evaluation_receipt_sha256, `${label}.evaluation_receipt_sha256`, {nullable: true});
}

function validateContextBinding(value, label) {
  exactKeys(value, ["status", "model_policy_snapshot_sha256", "operational_context_sha256", "governance_memory_sha256", "roster_projection_sha256"], label);
  assert(["PASS", "BLOCKED_EXACT", "UNKNOWN"].includes(value.status), `${label}.status is invalid`, "GOVERNED_ROSTER_FIELD_INVALID");
  for (const field of ["model_policy_snapshot_sha256", "operational_context_sha256", "governance_memory_sha256", "roster_projection_sha256"]) sha(value[field], `${label}.${field}`, {nullable: true});
}

function validateFinalReview(value, label) {
  exactKeys(value, ["status", "approved", "receipt_sha256", "reviewer_ref", "separately_controlled"], label);
  assert(["PASS", "BLOCKED_EXACT", "UNKNOWN"].includes(value.status), `${label}.status is invalid`, "GOVERNED_ROSTER_FIELD_INVALID");
  assert(typeof value.approved === "boolean", `${label}.approved is invalid`, "GOVERNED_ROSTER_FIELD_INVALID");
  sha(value.receipt_sha256, `${label}.receipt_sha256`, {nullable: true});
  text(value.reviewer_ref, `${label}.reviewer_ref`, {nullable: true});
  assert(typeof value.separately_controlled === "boolean", `${label}.separately_controlled is invalid`, "GOVERNED_ROSTER_FIELD_INVALID");
}

function validateLunaReview(value, label) {
  exactKeys(value, ["status", "model_id", "reasoning_effort", "fresh", "receipt_sha256", "reviewer_ref", "separately_controlled"], label);
  assert(["PASS", "BLOCKED_EXACT", "UNKNOWN"].includes(value.status), `${label}.status is invalid`, "GOVERNED_ROSTER_FIELD_INVALID");
  text(value.model_id, `${label}.model_id`, {nullable: true});
  text(value.reasoning_effort, `${label}.reasoning_effort`, {nullable: true});
  assert(typeof value.fresh === "boolean", `${label}.fresh is invalid`, "GOVERNED_ROSTER_FIELD_INVALID");
  sha(value.receipt_sha256, `${label}.receipt_sha256`, {nullable: true});
  text(value.reviewer_ref, `${label}.reviewer_ref`, {nullable: true});
  assert(typeof value.separately_controlled === "boolean", `${label}.separately_controlled is invalid`, "GOVERNED_ROSTER_FIELD_INVALID");
}

function validatePrerequisites(value, label) {
  assert(Array.isArray(value) && value.length === GOVERNED_ROSTER_PREREQUISITES.length, `${label} must contain every protected prerequisite`, "GOVERNED_ROSTER_PREREQUISITE_INVALID");
  let prior = -1;
  const seen = new Set();
  for (const entry of value) {
    exactKeys(entry, ["prerequisite_id", "status", "owner_role", "code", "action"], `${label} entry`);
    const index = GOVERNED_ROSTER_PREREQUISITES.indexOf(entry.prerequisite_id);
    assert(index > prior && !seen.has(entry.prerequisite_id), `${label} ordering or uniqueness differs`, "GOVERNED_ROSTER_PREREQUISITE_INVALID");
    assert(["PASS", "BLOCKED_EXACT", "DEFERRED_PROTECTED_BLOCK", "UNKNOWN"].includes(entry.status), `${label} entry status is invalid`, "GOVERNED_ROSTER_PREREQUISITE_INVALID");
    assert(entry.owner_role === "Spawner/root", `${label} entry owner is invalid`, "GOVERNED_ROSTER_PREREQUISITE_INVALID");
    text(entry.code, `${label} entry code`);
    text(entry.action, `${label} entry action`);
    prior = index;
    seen.add(entry.prerequisite_id);
  }
}

function validateSourceRoster(value) {
  exactKeys(value, ["status", "roster_sha256", "entry_count", "package_count", "model_policy_snapshot_sha256"], "source roster");
  assert(value.status === "PASS", "source roster compiler did not pass", "GOVERNED_ROSTER_SOURCE_INVALID");
  sha(value.roster_sha256, "source roster digest");
  assert(Number.isInteger(value.entry_count) && value.entry_count > 0, "source roster entry count is invalid", "GOVERNED_ROSTER_SOURCE_INVALID");
  assert(Number.isInteger(value.package_count) && value.package_count > 0, "source roster package count is invalid", "GOVERNED_ROSTER_SOURCE_INVALID");
  sha(value.model_policy_snapshot_sha256, "source roster model-policy digest");
}

const CANDIDATE_RECORD_KEYS = Object.freeze([
  "stable_agent_id", "candidate", "provenance", "model_binding", "context_binding", "final_review", "luna_max_review", "protected_prerequisites",
]);

export function validateGovernedRosterCandidate(value) {
  exactKeys(value, CANDIDATE_RECORD_KEYS, "governed roster candidate");
  assert(typeof value.stable_agent_id === "string" && STABLE_ID.test(value.stable_agent_id), "governed roster stable ID is invalid", "GOVERNED_ROSTER_ID_INVALID");
  validateCandidate(value.candidate);
  validateProvenance(value.provenance, "candidate provenance");
  validateModelBinding(value.model_binding, "candidate model binding");
  validateContextBinding(value.context_binding, "candidate context binding");
  validateFinalReview(value.final_review, "candidate final review");
  validateLunaReview(value.luna_max_review, "candidate Luna review");
  validatePrerequisites(value.protected_prerequisites, "candidate protected prerequisites");
  return value;
}

function readinessIssues(candidate, currentCandidate, sourceRoster) {
  const issues = [];
  const unknown = [];
  if (!sameCandidate(candidate.candidate, currentCandidate)) return [{status: "STALE_DUPLICATE", code: "STALE_CANDIDATE_SUPERSEDED", detail: "Candidate commit/tree/rollback is not the current exact candidate."}];
  for (const entry of candidate.protected_prerequisites) {
    if (entry.status !== "PASS") {
      (entry.status === "UNKNOWN" ? unknown : issues).push({status: entry.status === "UNKNOWN" ? "UNKNOWN" : "BLOCKED_EXACT", code: entry.code, detail: entry.action});
    }
  }
  const model = candidate.model_binding;
  if (model.status !== "PASS" || model.model_id !== MODEL_ID || model.reasoning_effort !== REASONING_EFFORT || model.fresh !== true || model.policy_snapshot_sha256 === null || model.host_attestation_sha256 === null || model.evaluation_receipt_sha256 === null) {
    (model.status === "UNKNOWN" ? unknown : issues).push({status: model.status === "UNKNOWN" ? "UNKNOWN" : "BLOCKED_EXACT", code: "FRESH_LUNA_MODEL_BINDING_REQUIRED", detail: "Fresh max-effort Luna PASS and exact model-policy/host-evidence bindings are required."});
  }
  const context = candidate.context_binding;
  if (context.status !== "PASS" || context.model_policy_snapshot_sha256 !== model.policy_snapshot_sha256 || context.roster_projection_sha256 !== sourceRoster.roster_sha256 || context.operational_context_sha256 === null || context.governance_memory_sha256 === null) {
    (context.status === "UNKNOWN" ? unknown : issues).push({status: context.status === "UNKNOWN" ? "UNKNOWN" : "BLOCKED_EXACT", code: "MODEL_CONTEXT_BINDING_REQUIRED", detail: "Operational context, governance memory, model-policy, and roster projection must bind the exact candidate."});
  }
  const finalReview = candidate.final_review;
  if (finalReview.status !== "PASS" || finalReview.approved !== true || finalReview.receipt_sha256 === null || finalReview.reviewer_ref === null || finalReview.separately_controlled !== true) {
    (finalReview.status === "UNKNOWN" ? unknown : issues).push({status: finalReview.status === "UNKNOWN" ? "UNKNOWN" : "BLOCKED_EXACT", code: "FINAL_REVIEW_APPROVAL_REQUIRED", detail: "Final Review must approve the exact candidate through a separately controlled receipt."});
  }
  const luna = candidate.luna_max_review;
  if (luna.status !== "PASS" || luna.model_id !== MODEL_ID || luna.reasoning_effort !== REASONING_EFFORT || luna.fresh !== true || luna.receipt_sha256 === null || luna.reviewer_ref === null || luna.separately_controlled !== true) {
    (luna.status === "UNKNOWN" ? unknown : issues).push({status: luna.status === "UNKNOWN" ? "UNKNOWN" : "BLOCKED_EXACT", code: "LUNA_MAX_FRESH_PASS_REQUIRED", detail: "A fresh, separately controlled max-effort Luna PASS receipt is required."});
  }
  return issues.length > 0 ? issues : unknown;
}

function blockedEntry(candidate, status, reason, supersededBy = null) {
  const entry = {
    stable_agent_id: candidate.stable_agent_id,
    status,
    candidate: structuredClone(candidate.candidate),
    provenance: structuredClone(candidate.provenance),
    model_binding: structuredClone(candidate.model_binding),
    context_binding: structuredClone(candidate.context_binding),
    final_review: structuredClone(candidate.final_review),
    luna_max_review: structuredClone(candidate.luna_max_review),
    reason_code: reason.code,
    reason: reason.detail,
    superseded_by: supersededBy,
    entry_sha256: null,
  };
  entry.entry_sha256 = canonicalDigest(body(entry, "entry_sha256"));
  return entry;
}

function readyEntry(candidate) {
  const entry = {
    stable_agent_id: candidate.stable_agent_id,
    status: "READY",
    candidate: structuredClone(candidate.candidate),
    provenance: structuredClone(candidate.provenance),
    model_binding: structuredClone(candidate.model_binding),
    context_binding: structuredClone(candidate.context_binding),
    final_review: structuredClone(candidate.final_review),
    luna_max_review: structuredClone(candidate.luna_max_review),
    protected_prerequisites: structuredClone(candidate.protected_prerequisites),
    entry_sha256: null,
  };
  entry.entry_sha256 = canonicalDigest(body(entry, "entry_sha256"));
  return entry;
}

function entrySort(left, right) {
  return compareUtf8(left.stable_agent_id, right.stable_agent_id)
    || compareUtf8(left.candidate.commit, right.candidate.commit)
    || compareUtf8(left.entry_sha256 ?? canonicalDigest(left), right.entry_sha256 ?? canonicalDigest(right));
}

export function validateGovernedRosterProjection(projection) {
  exactKeys(projection, ["schema", "version", "status", "current_candidate", "source_roster", "ready", "blocked_ledger", "projection_sha256"], "governed roster projection");
  assert(projection.schema === GOVERNED_ROSTER_PROJECTION_SCHEMA && projection.version === GOVERNED_ROSTER_PROJECTION_VERSION, "governed roster projection identity differs", "GOVERNED_ROSTER_SCHEMA_INVALID");
  assert(["READY", "BLOCKED_EXACT", "UNKNOWN"].includes(projection.status), "governed roster projection status is invalid", "GOVERNED_ROSTER_STATUS_INVALID");
  validateCandidate(projection.current_candidate, "current candidate");
  validateSourceRoster(projection.source_roster);
  assert(Array.isArray(projection.ready), "governed roster ready projection is invalid", "GOVERNED_ROSTER_SHAPE_INVALID");
  assert(Array.isArray(projection.blocked_ledger), "governed roster blocked ledger is invalid", "GOVERNED_ROSTER_SHAPE_INVALID");
  const readyIds = new Set();
  for (const entry of projection.ready) {
    exactKeys(entry, ["stable_agent_id", "status", "candidate", "provenance", "model_binding", "context_binding", "final_review", "luna_max_review", "protected_prerequisites", "entry_sha256"], "governed roster READY entry");
    assert(entry.status === "READY" && !readyIds.has(entry.stable_agent_id), "governed roster contains duplicate READY identities", "GOVERNED_ROSTER_DUPLICATE_READY");
    readyIds.add(entry.stable_agent_id);
    validateCandidate(entry.candidate, "READY candidate"); validateProvenance(entry.provenance, "READY provenance"); validateModelBinding(entry.model_binding, "READY model binding"); validateContextBinding(entry.context_binding, "READY context binding"); validateFinalReview(entry.final_review, "READY final review"); validateLunaReview(entry.luna_max_review, "READY Luna review"); validatePrerequisites(entry.protected_prerequisites, "READY prerequisites");
    assert(sameCandidate(entry.candidate, projection.current_candidate), "READY entry is not bound to the current exact candidate", "GOVERNED_ROSTER_CANDIDATE_DIVERGED");
    assert(entry.model_binding.status === "PASS" && entry.model_binding.model_id === MODEL_ID && entry.model_binding.reasoning_effort === REASONING_EFFORT && entry.model_binding.fresh === true, "READY entry model proof is not fresh max-effort Luna PASS", "GOVERNED_ROSTER_MODEL_NOT_READY");
    assert(entry.final_review.status === "PASS" && entry.final_review.approved === true && entry.final_review.separately_controlled === true, "READY entry lacks Final Review approval", "GOVERNED_ROSTER_FINAL_REVIEW_NOT_READY");
    assert(entry.luna_max_review.status === "PASS" && entry.luna_max_review.model_id === MODEL_ID && entry.luna_max_review.reasoning_effort === REASONING_EFFORT && entry.luna_max_review.fresh === true && entry.luna_max_review.separately_controlled === true, "READY entry lacks fresh Luna max PASS", "GOVERNED_ROSTER_LUNA_NOT_READY");
    assert(entry.entry_sha256 === canonicalDigest(body(entry, "entry_sha256")), "READY entry digest differs", "GOVERNED_ROSTER_DIGEST_INVALID");
  }
  const ledgerIds = new Set();
  for (const entry of projection.blocked_ledger) {
    exactKeys(entry, ["stable_agent_id", "status", "candidate", "provenance", "model_binding", "context_binding", "final_review", "luna_max_review", "reason_code", "reason", "superseded_by", "entry_sha256"], "governed roster blocked ledger entry");
    assert(["BLOCKED_EXACT", "UNKNOWN", "STALE_DUPLICATE"].includes(entry.status), "blocked ledger entry status is invalid", "GOVERNED_ROSTER_STATUS_INVALID");
    assert(!readyIds.has(entry.stable_agent_id) || entry.status === "STALE_DUPLICATE", "blocked identity was materialized as READY and blocked simultaneously", "GOVERNED_ROSTER_DUPLICATE_READY");
    assert(!ledgerIds.has(`${entry.stable_agent_id}:${entry.candidate.commit}:${entry.candidate.tree}:${entry.reason_code}:${entry.entry_sha256}`), "blocked ledger contains a duplicate record", "GOVERNED_ROSTER_DUPLICATE_LEDGER");
    ledgerIds.add(`${entry.stable_agent_id}:${entry.candidate.commit}:${entry.candidate.tree}:${entry.reason_code}:${entry.entry_sha256}`);
    validateCandidate(entry.candidate, "blocked candidate"); validateProvenance(entry.provenance, "blocked provenance"); validateModelBinding(entry.model_binding, "blocked model binding"); validateContextBinding(entry.context_binding, "blocked context binding"); validateFinalReview(entry.final_review, "blocked final review"); validateLunaReview(entry.luna_max_review, "blocked Luna review");
    text(entry.reason_code, "blocked reason code"); text(entry.reason, "blocked reason"); text(entry.superseded_by, "blocked superseded_by", {nullable: true});
    assert(entry.entry_sha256 === canonicalDigest(body(entry, "entry_sha256")), "blocked ledger entry digest differs", "GOVERNED_ROSTER_DIGEST_INVALID");
  }
  assert(projection.projection_sha256 === canonicalDigest(body(projection, "projection_sha256")), "governed roster projection digest differs", "GOVERNED_ROSTER_DIGEST_INVALID");
  if (projection.status === "READY") assert(projection.ready.length > 0, "READY projection has no READY entries", "GOVERNED_ROSTER_STATUS_INVALID");
  if (projection.status !== "READY") assert(projection.ready.length === 0, "blocked or unknown projection contains a READY entry", "GOVERNED_ROSTER_STATUS_INVALID");
  return projection;
}

export function compileGovernedRosterProjection({currentCandidate, sourceRoster, candidates} = {}) {
  validateCandidate(currentCandidate, "current candidate");
  validateSourceRoster(sourceRoster);
  assert(Array.isArray(candidates) && candidates.length > 0, "governed roster candidates are required", "GOVERNED_ROSTER_CANDIDATE_MISSING");
  const validated = candidates.map((candidate) => validateGovernedRosterCandidate(candidate));
  const grouped = new Map();
  for (const candidate of validated) {
    const list = grouped.get(candidate.stable_agent_id) ?? [];
    list.push(candidate);
    grouped.set(candidate.stable_agent_id, list);
  }
  const ready = [];
  const blocked = [];
  for (const stableId of [...grouped.keys()].sort(compareUtf8)) {
    const group = grouped.get(stableId).sort((left, right) => compareUtf8(canonicalDigest(left), canonicalDigest(right)));
    const exact = group.filter((candidate) => sameCandidate(candidate.candidate, currentCandidate));
    if (exact.length === 0) {
      for (const candidate of group) blocked.push(blockedEntry(candidate, "STALE_DUPLICATE", {code: "STALE_CANDIDATE_SUPERSEDED", detail: "Candidate commit/tree/rollback is not the current exact candidate."}, `${currentCandidate.commit}/${currentCandidate.tree}`));
      continue;
    }
    const selected = exact[0];
    const exactDigests = new Set(exact.map((candidate) => canonicalDigest(candidate)));
    if (exactDigests.size > 1) {
      for (const candidate of exact) blocked.push(blockedEntry(candidate, "UNKNOWN", {code: "DIVERGENT_EXACT_DUPLICATES", detail: "Multiple exact candidate records disagree; no READY identity is materialized."}));
    } else {
      const issues = readinessIssues(selected, currentCandidate, sourceRoster);
      if (issues.length === 0) ready.push(readyEntry(selected));
      else {
        const status = issues.some((issue) => issue.status === "BLOCKED_EXACT") ? "BLOCKED_EXACT" : issues.some((issue) => issue.status === "UNKNOWN") ? "UNKNOWN" : "STALE_DUPLICATE";
        blocked.push(blockedEntry(selected, status, issues[0]));
      }
    }
    for (const duplicate of group.filter((candidate) => !exact.includes(candidate))) blocked.push(blockedEntry(duplicate, "STALE_DUPLICATE", {code: "STALE_CANDIDATE_SUPERSEDED", detail: "A stale duplicate is retained only in the blocked ledger."}, `${currentCandidate.commit}/${currentCandidate.tree}`));
    for (const duplicate of exact.slice(1)) if (exactDigests.size === 1) blocked.push(blockedEntry(duplicate, "STALE_DUPLICATE", {code: "DUPLICATE_EXACT_SUPERSEDED", detail: "One canonical exact record replaces an identical duplicate."}, `${currentCandidate.commit}/${currentCandidate.tree}`));
  }
  ready.sort(entrySort); blocked.sort(entrySort);
  const status = ready.length > 0 ? "READY" : blocked.some((entry) => entry.status === "BLOCKED_EXACT") ? "BLOCKED_EXACT" : "UNKNOWN";
  const projection = {schema: GOVERNED_ROSTER_PROJECTION_SCHEMA, version: GOVERNED_ROSTER_PROJECTION_VERSION, status, current_candidate: structuredClone(currentCandidate), source_roster: structuredClone(sourceRoster), ready, blocked_ledger: blocked, projection_sha256: null};
  projection.projection_sha256 = canonicalDigest(body(projection, "projection_sha256"));
  return validateGovernedRosterProjection(Object.freeze(projection));
}

export function compileProtectedCandidateRosterProjection({candidate, sourceRoster, authoritySha256, modelPolicy, evaluatorHandoff, protectedPrerequisites} = {}) {
  validateCandidate(candidate, "protected candidate");
  validateSourceRoster(sourceRoster);
  sha(authoritySha256, "protected authority digest");
  validatePrerequisites(protectedPrerequisites, "protected candidate prerequisites");
  assert(record(modelPolicy), "protected model-policy readback is required", "GOVERNED_ROSTER_MODEL_INVALID");
  assert(record(evaluatorHandoff), "protected evaluator readback is required", "GOVERNED_ROSTER_REVIEW_INVALID");
  const candidateRecord = {
    stable_agent_id: "AGENTOS.SPAWNER.CURRENT_CANDIDATE",
    candidate: {commit: candidate.commit, tree: candidate.tree, rollback: structuredClone(candidate.rollback)},
    provenance: {source_ref: `ref:agentos-candidate/${candidate.commit}`, source_sha256: canonicalDigest({candidate, authority_sha256: authoritySha256})},
    model_binding: {
      status: modelPolicy.status === "PASS" ? "PASS" : modelPolicy.status === "UNKNOWN" ? "UNKNOWN" : "BLOCKED_EXACT",
      model_id: modelPolicy.model_id ?? null,
      reasoning_effort: modelPolicy.reasoning_effort ?? null,
      fresh: modelPolicy.fresh === true,
      policy_snapshot_sha256: modelPolicy.snapshot_sha256 ?? null,
      host_attestation_sha256: modelPolicy.host_attestation?.file_sha256 ?? null,
      evaluation_receipt_sha256: modelPolicy.evaluation_receipt_sha256 ?? null,
    },
    context_binding: {
      status: "UNKNOWN",
      model_policy_snapshot_sha256: modelPolicy.snapshot_sha256 ?? null,
      operational_context_sha256: null,
      governance_memory_sha256: null,
      roster_projection_sha256: sourceRoster.roster_sha256,
    },
    final_review: {
      status: evaluatorHandoff.final_review_status ?? "UNKNOWN",
      approved: evaluatorHandoff.final_review_approved === true,
      receipt_sha256: evaluatorHandoff.final_review_receipt_sha256 ?? null,
      reviewer_ref: evaluatorHandoff.final_review_reviewer_ref ?? null,
      separately_controlled: evaluatorHandoff.final_review_separately_controlled === true,
    },
    luna_max_review: {
      status: evaluatorHandoff.luna_max_status ?? "UNKNOWN",
      model_id: evaluatorHandoff.luna_max_model_id ?? null,
      reasoning_effort: evaluatorHandoff.luna_max_reasoning_effort ?? null,
      fresh: evaluatorHandoff.luna_max_fresh === true,
      receipt_sha256: evaluatorHandoff.luna_max_receipt_sha256 ?? null,
      reviewer_ref: evaluatorHandoff.luna_max_reviewer_ref ?? null,
      separately_controlled: evaluatorHandoff.luna_max_separately_controlled === true,
    },
    protected_prerequisites: structuredClone(protectedPrerequisites),
  };
  return compileGovernedRosterProjection({currentCandidate: candidateRecord.candidate, sourceRoster, candidates: [candidateRecord]});
}
