#!/usr/bin/env node

/*
 * Catalog-backed boundary for public responses, typed handoffs, and closure
 * claims. The legacy four-root tree remains available for compatibility, but
 * this module is the only boundary that may represent a catalog result as a
 * complete response.
 */

import {
  FAILURE_CLASSIFICATIONS,
  ROUTES,
  canonicalDigest,
  evaluateGateDecisionTree,
  validateCompiledGateTree,
} from "./gate-catalog-compiler.mjs";

export const UNIVERSAL_RESPONSE_SCHEMA = "agentos.universal_response_handoff.v1";
export const UNIVERSAL_RESPONSE_VERSION = 1;
export const UNIVERSAL_RESPONSE_STATUSES = Object.freeze(["COMPLETE", "HARD_STOP", "SOFT_REVIEW", "UNPROVEN"]);
export const UNIVERSAL_HANDOFF_STATUSES = Object.freeze(["PRESERVED", "NOT_PRESERVED"]);
export const UNIVERSAL_CLOSE_STATUSES = Object.freeze(["READY", "NOT_READY"]);

const SHA256 = /^[0-9a-f]{64}$/u;
const REF = /^REF_[A-Z0-9._:-]+$/u;
const ID = /^[A-Z][A-Z0-9._:-]*$/u;
const SAFE_TEXT = /^[^\u0000-\u001f\u007f]+$/u;
const PRIVATE_CONTENT = /(?:\/(?:Users|home|private|var)\/|[A-Za-z]:\\Users\\|\\\\[^\\]+\\Users\\|file:\/\/|(?:api[_-]?key|access[_-]?token|authorization|bearer|sk-[A-Za-z0-9]|ghp_[A-Za-z0-9]))/iu;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value, label) {
  assert(isRecord(value), `${label} must be an object`);
}

function exactKeys(value, keys, label) {
  requireRecord(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} fields mismatch`);
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
  assert(SAFE_TEXT.test(value), `${label} contains control characters`);
}

function requireSafePublicText(value, label) {
  requireString(value, label);
  assert(!PRIVATE_CONTENT.test(value), `${label} contains private or credential-like content`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function requireRef(value, label) {
  assert(typeof value === "string" && REF.test(value), `${label} must be an opaque reference`);
}

function requireId(value, label) {
  assert(typeof value === "string" && ID.test(value), `${label} is invalid`);
}

function sortedUniqueStrings(value, label, {allowEmpty = false} = {}) {
  assert(Array.isArray(value), `${label} must be an array`);
  if (!allowEmpty) assert(value.length > 0, `${label} must not be empty`);
  assert(value.every((item) => typeof item === "string" && item.length > 0), `${label} contains an invalid value`);
  const sorted = [...value].sort();
  assert(new Set(sorted).size === sorted.length, `${label} contains duplicates`);
  return sorted;
}

function validateIdentity(identity, label) {
  exactKeys(identity, ["source_ref", "worktree_ref", "session_ref", "goal_ref", "environment_ref"], label);
  for (const field of Object.keys(identity)) requireRef(identity[field], `${label}.${field}`);
  return identity;
}

function validateIndependentCheck(value, evidenceByDigest, workerSessionRef, label = "independent_check") {
  exactKeys(value, ["status", "reviewer_ref", "evidence_digest"], label);
  assert(["PASS", "PENDING", "UNAVAILABLE"].includes(value.status), `${label}.status is invalid`);
  if (value.status === "PASS") {
    requireRef(value.reviewer_ref, `${label}.reviewer_ref`);
    requireSha(value.evidence_digest, `${label}.evidence_digest`);
    assert(value.reviewer_ref !== workerSessionRef, `${label} reviewer cannot be the worker session`);
    const evidence = evidenceByDigest.get(value.evidence_digest);
    assert(evidence?.issuer_kind === "INDEPENDENT_AUDITOR", `${label} evidence is not independently issued`);
    assert(evidence.issuer_ref === value.reviewer_ref, `${label} reviewer differs from evidence issuer`);
  } else {
    assert(value.reviewer_ref === null && value.evidence_digest === null, `${label} incomplete state must not carry reviewer evidence`);
  }
  return value;
}

function validateHandoff(value, status, expectedFailure, label = "handoff") {
  exactKeys(value, ["status", "handoff_sha256", "next_action", "limitation", "failure_classification", "repair_route"], label);
  assert(UNIVERSAL_HANDOFF_STATUSES.includes(value.status), `${label}.status is invalid`);
  requireSha(value.handoff_sha256, `${label}.handoff_sha256`);
  requireSafePublicText(value.next_action, `${label}.next_action`);
  requireSafePublicText(value.limitation, `${label}.limitation`);
  if (value.failure_classification === null) assert(expectedFailure === null, `${label} omitted the evaluated failure classification`);
  else assert(FAILURE_CLASSIFICATIONS.includes(value.failure_classification) && value.failure_classification === expectedFailure.classification, `${label}.failure_classification differs from the evaluated failure`);
  if (value.repair_route === null) assert(expectedFailure === null, `${label} omitted the evaluated repair route`);
  else assert(ROUTES.includes(value.repair_route) && value.repair_route === expectedFailure.route, `${label}.repair_route differs from the evaluated failure`);
  assert(value.handoff_sha256 === canonicalDigest({...value, handoff_sha256: null}), `${label}.handoff_sha256 does not match its canonical record`);
  if (status === "COMPLETE") assert(value.status === "PRESERVED", "COMPLETE response lacks a preserved handoff");
  return value;
}

function validateCloseReadiness(value, context, status, label = "close_readiness") {
  exactKeys(value, ["status", "temporary_work_closed", "active_temporary_count", "roster_readback_sha256"], label);
  assert(UNIVERSAL_CLOSE_STATUSES.includes(value.status), `${label}.status is invalid`);
  assert(typeof value.temporary_work_closed === "boolean", `${label}.temporary_work_closed is invalid`);
  assert(Number.isSafeInteger(value.active_temporary_count) && value.active_temporary_count >= 0, `${label}.active_temporary_count is invalid`);
  if (value.roster_readback_sha256 !== null) requireSha(value.roster_readback_sha256, `${label}.roster_readback_sha256`);
  if (value.status === "READY") {
    assert(value.temporary_work_closed === true && value.active_temporary_count === 0, `${label} READY requires closed temporary work and zero active tasks`);
    requireSha(value.roster_readback_sha256, `${label}.roster_readback_sha256`);
  } else assert(value.temporary_work_closed === false || value.active_temporary_count > 0, `${label} NOT_READY is inconsistent`);
  if (context === "CLOSURE" && status === "COMPLETE") assert(value.status === "READY", "closure COMPLETE requires a ready temporary roster");
  return value;
}

function evidenceRecordsForTree(tree, graphId, answers) {
  const graph = tree.graphs.find((candidate) => candidate.graph_id === graphId);
  assert(graph, `unknown graph ${graphId}`);
  const gateIds = new Set(graph.gate_ids);
  const records = [];
  for (const gateId of gateIds) {
    const answer = answers[gateId];
    if (!answer) continue;
    for (const evidence of Object.values(answer.evidence ?? {})) records.push(evidence);
  }
  const byDigest = new Map();
  for (const evidence of records) {
    requireSha(evidence.evidence_digest, "gate evidence digest");
    const prior = byDigest.get(evidence.evidence_digest);
    if (prior !== undefined) assert(JSON.stringify(prior) === JSON.stringify(evidence), "evidence digest is reused for different records");
    byDigest.set(evidence.evidence_digest, evidence);
  }
  return {graph, byDigest};
}

function expectedFailureFromEvaluation(evaluation) {
  if (evaluation.status === "COMPLETE") return null;
  const last = [...evaluation.trace].reverse().find((entry) => entry.failure);
  assert(last?.failure, "non-complete catalog evaluation lacks a failure classification");
  return last.failure;
}

function validateClaims(claims, evaluation, evidenceByDigest, publicText, requireEvidenceMembership) {
  assert(Array.isArray(claims) && claims.length > 0, "response claims must not be empty");
  const traceGateIds = new Set(evaluation.trace.map((entry) => entry.gate_id));
  const seen = new Set();
  const normalized = claims.map((claim, index) => {
    exactKeys(claim, ["claim_id", "gate_id", "text", "evidence_digests"], `response claim ${index}`);
    requireId(claim.claim_id, `response claim ${index} claim_id`);
    assert(!seen.has(claim.claim_id), `duplicate response claim ${claim.claim_id}`);
    seen.add(claim.claim_id);
    assert(traceGateIds.has(claim.gate_id), `response claim ${claim.claim_id} names a gate not in the evaluated trace`);
    requireSafePublicText(claim.text, `response claim ${claim.claim_id}.text`);
    assert(publicText.includes(claim.text), `response claim ${claim.claim_id} is not present in public_text`);
    const digests = sortedUniqueStrings(claim.evidence_digests, `response claim ${claim.claim_id}.evidence_digests`);
    for (const digest of digests) {
      requireSha(digest, `response claim ${claim.claim_id} evidence digest`);
      if (requireEvidenceMembership) assert(evidenceByDigest.has(digest), `response claim ${claim.claim_id} names evidence outside the evaluated graph`);
    }
    return {...claim, evidence_digests: digests};
  });
  return normalized.sort((left, right) => left.claim_id.localeCompare(right.claim_id));
}

export function validateUniversalResponseEnvelope(envelope, {tree = null, answers = null, expectedIdentity = null} = {}) {
  exactKeys(envelope, [
    "schema", "version", "status", "context", "graph_id", "graph_sha256",
    "gate_evaluation", "gate_evaluation_sha256", "trace_sha256", "claims",
    "public_text", "limitation", "next_action", "independent_check", "handoff",
    "close_readiness", "evidence_digests", "envelope_sha256",
  ], "universal response envelope");
  assert(envelope.schema === UNIVERSAL_RESPONSE_SCHEMA && envelope.version === UNIVERSAL_RESPONSE_VERSION, "universal response envelope identity is invalid");
  assert(UNIVERSAL_RESPONSE_STATUSES.includes(envelope.status), "universal response status is invalid");
  requireId(envelope.context, "universal response context");
  requireId(envelope.graph_id, "universal response graph_id");
  requireSha(envelope.graph_sha256, "universal response graph digest");
  requireRecord(envelope.gate_evaluation, "universal response gate evaluation");
  requireSha(envelope.gate_evaluation_sha256, "universal response gate evaluation digest");
  requireSha(envelope.trace_sha256, "universal response trace digest");
  requireSafePublicText(envelope.public_text, "universal response public_text");
  requireSafePublicText(envelope.limitation, "universal response limitation");
  requireSafePublicText(envelope.next_action, "universal response next_action");
  assert(envelope.gate_evaluation_sha256 === canonicalDigest(envelope.gate_evaluation), "universal response gate evaluation digest differs");
  assert(envelope.trace_sha256 === canonicalDigest(envelope.gate_evaluation.trace), "universal response trace digest differs");
  assert(envelope.gate_evaluation.status === envelope.status, "universal response status differs from gate evaluation");
  if (envelope.status === "COMPLETE") assert(tree !== null && answers !== null && expectedIdentity !== null, "COMPLETE envelope requires source-bound re-evaluation inputs");
  assert(envelope.gate_evaluation.graph_id === envelope.graph_id, "universal response graph differs from gate evaluation");
  const graph = tree === null ? null : evidenceRecordsForTree(tree, envelope.graph_id, answers ?? {}).graph;
  if (tree !== null) {
    validateCompiledGateTree(tree);
    assert(envelope.graph_sha256 === canonicalDigest(graph), "universal response graph digest differs");
    if (answers !== null) {
      const reevaluated = evaluateGateDecisionTree({tree, graphId: envelope.graph_id, answers, expectedIdentity});
      assert(canonicalDigest(reevaluated) === envelope.gate_evaluation_sha256, "universal response gate result does not re-evaluate identically");
    }
  }
  const identity = expectedIdentity ?? envelope.gate_evaluation.execution_identity;
  if (identity !== undefined && identity !== null) validateIdentity(identity, "universal response execution identity");
  const evidenceByDigest = tree === null || answers === null ? new Map() : evidenceRecordsForTree(tree, envelope.graph_id, answers).byDigest;
  const evidenceDigests = sortedUniqueStrings(envelope.evidence_digests, "universal response evidence_digests");
  assert(JSON.stringify(evidenceDigests) === JSON.stringify(envelope.evidence_digests), "universal response evidence_digests are not canonicalized");
  for (const digest of evidenceDigests) {
    requireSha(digest, "universal response evidence digest");
    if (answers !== null) assert(evidenceByDigest.has(digest), "universal response evidence is outside the evaluated graph");
  }
  const claims = validateClaims(envelope.claims, envelope.gate_evaluation, evidenceByDigest, envelope.public_text, answers !== null);
  assert(JSON.stringify(claims) === JSON.stringify(envelope.claims), "universal response claims are not canonicalized");
  const workerSessionRef = identity?.session_ref ?? null;
  validateIndependentCheck(envelope.independent_check, evidenceByDigest, workerSessionRef);
  const expectedFailure = expectedFailureFromEvaluation(envelope.gate_evaluation);
  validateHandoff(envelope.handoff, envelope.status, expectedFailure);
  validateCloseReadiness(envelope.close_readiness, envelope.context, envelope.status);
  if (envelope.status === "COMPLETE") assert(envelope.independent_check.status === "PASS", "COMPLETE requires independent PASS");
  if (envelope.independent_check.status === "PASS") assert(envelope.evidence_digests.includes(envelope.independent_check.evidence_digest), "independent evidence is absent from the response evidence set");
  assert(envelope.envelope_sha256 === canonicalDigest({...envelope, envelope_sha256: null}), "universal response envelope digest differs");
  return envelope;
}

export function compileUniversalResponseEnvelope({
  tree,
  graphId,
  context,
  answers,
  expectedIdentity,
  claims,
  publicText,
  limitation,
  nextAction,
  independentCheck,
  handoff,
  closeReadiness,
}) {
  validateCompiledGateTree(tree);
  validateIdentity(expectedIdentity, "universal response expected identity");
  requireId(context, "universal response context");
  requireSafePublicText(publicText, "universal response public_text");
  requireSafePublicText(limitation, "universal response limitation");
  requireSafePublicText(nextAction, "universal response next_action");
  const {graph, byDigest} = evidenceRecordsForTree(tree, graphId, answers);
  const evaluation = evaluateGateDecisionTree({tree, graphId, answers, expectedIdentity});
  const expectedFailure = expectedFailureFromEvaluation(evaluation);
  const normalizedClaims = validateClaims(claims, evaluation, byDigest, publicText, true);
  validateIndependentCheck(independentCheck, byDigest, expectedIdentity.session_ref);
  validateHandoff(handoff, evaluation.status, expectedFailure);
  validateCloseReadiness(closeReadiness, context, evaluation.status);
  const evidenceDigests = sortedUniqueStrings(
    [...new Set([
      ...normalizedClaims.flatMap((claim) => claim.evidence_digests),
      ...(independentCheck.status === "PASS" ? [independentCheck.evidence_digest] : []),
    ])],
    "universal response evidence_digests",
  );
  const envelope = {
    schema: UNIVERSAL_RESPONSE_SCHEMA,
    version: UNIVERSAL_RESPONSE_VERSION,
    status: evaluation.status,
    context,
    graph_id: graphId,
    graph_sha256: canonicalDigest(graph),
    gate_evaluation: evaluation,
    gate_evaluation_sha256: canonicalDigest(evaluation),
    trace_sha256: canonicalDigest(evaluation.trace),
    claims: normalizedClaims,
    public_text: publicText,
    limitation,
    next_action: nextAction,
    independent_check: structuredClone(independentCheck),
    handoff: structuredClone(handoff),
    close_readiness: structuredClone(closeReadiness),
    evidence_digests: evidenceDigests,
    envelope_sha256: null,
  };
  envelope.envelope_sha256 = canonicalDigest(envelope);
  return validateUniversalResponseEnvelope(envelope, {tree, answers, expectedIdentity});
}

export const evaluateUniversalResponse = compileUniversalResponseEnvelope;
