#!/usr/bin/env node

/*
 * Portable audit -> repair -> Feature -> Platform -> Central convergence.
 *
 * This module owns records and deterministic custody decisions only. It
 * consumes Scheduler admission receipts and emits a typed event for the
 * repaired campaign-cascade transaction; it never runs jobs or changes a
 * repository.
 */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {validateSchedulerAdmissionReceipt} from "./scheduler-admission.mjs";
import {validateCascadeState} from "./campaign-cascade.mjs";

export const AUDIT_FINDING_SCHEMA = "agentos.audit_finding.v1";
export const FINDING_CONSOLIDATION_SCHEMA = "agentos.finding_consolidation.v1";
export const REPAIR_DAG_SCHEMA = "agentos.repair_dag.v1";
export const CANDIDATE_RETENTION_LEDGER_SCHEMA = "agentos.candidate_retention_ledger.v1";
export const PLATFORM_CONSUMPTION_MATRIX_SCHEMA = "agentos.platform_consumption_matrix.v1";
export const PLATFORM_CANDIDATE_SCHEMA = "agentos.cumulative_platform_candidate.v1";
export const CENTRAL_INTAKE_SCHEMA = "agentos.central_intake_manifest.v1";
export const CONVERGENCE_LEDGER_SCHEMA = "agentos.convergence_ledger.v1";
export const CONVERGENCE_BINDING_SCHEMA = "agentos.audit_repair_convergence_binding.v1";

export const FINDING_STATUSES = Object.freeze([
  "OPEN", "CONSOLIDATED", "PLANNED", "IN_REPAIR", "CANDIDATE_REJECTED",
  "REPAIRED_PENDING_REAUDIT", "ACCEPTED", "REOPENED", "DEFERRED_REAL_HOST",
  "REJECTED_FALSE_POSITIVE", "BLOCKED_EXACT",
]);

export const REPAIR_CLASSES = Object.freeze({
  SAFETY_SECURITY_DATA_BLOCKER: {wave: "A", rank: 0},
  CHARACTERIZATION_CONTRACT: {wave: "A", rank: 1},
  ARCHITECTURAL_PREREQUISITE: {wave: "A", rank: 2},
  STRUCTURAL_BOUNDARY: {wave: "A", rank: 3},
  SHARED_SECURITY_DATA_CONCURRENCY: {wave: "A", rank: 4},
  SHARED_SEAM_CONTRACT: {wave: "B", rank: 5},
  FEATURE_CORRECTNESS: {wave: "B", rank: 6},
  ACCESS_VALIDATION_OBSERVABILITY_PERFORMANCE: {wave: "B", rank: 7},
  DUPLICATION_SIMPLIFICATION: {wave: "B", rank: 8},
  LOCALIZED_QUALITY: {wave: "C", rank: 9},
  DOCUMENTATION_TEST_ORGANIZATION: {wave: "C", rank: 10},
  RELEASE_METADATA_HYGIENE: {wave: "C", rank: 11},
});

const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/u;
const SEVERITY_RANK = Object.freeze({BLOCKER: 0, CRITICAL: 1, HIGH: 2, MEDIUM: 3, LOW: 4});
const BLAST_RANK = Object.freeze({SYSTEM: 0, REPOSITORY: 1, COMPONENT: 2, LOCAL: 3});
const CONFIDENCE = new Set(["LOW", "MEDIUM", "HIGH", "VERIFIED"]);
const CLAIM_RANK = Object.freeze({OBSERVED_ONLY: 0, REPRODUCED: 1, LOCALLY_PROVEN: 2, REAL_HOST_PROVEN: 3});

function fail(message, code = "AUDIT_REPAIR_CONVERGENCE_INVALID") {
  const error = new Error(message);
  error.code = code;
  throw error;
}
function assert(condition, message, code) { if (!condition) fail(message, code); }
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function exactKeys(value, keys, label) {
  assert(isRecord(value), `${label} must be an object`);
  const actual = Object.keys(value).sort(compareUtf8);
  const expected = [...keys].sort(compareUtf8);
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} fields mismatch`);
}
function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains a control character`);
}
function requireNullableString(value, label) { if (value !== null) requireString(value, label); }
function requireIdentifier(value, label) { requireString(value, label); assert(IDENTIFIER.test(value), `${label} is not a portable identifier`); }
function requireSha(value, label) { assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`); }
function requireGitObject(value, label) { assert(typeof value === "string" && GIT_OBJECT.test(value), `${label} must be a Git object identity`); }
function requireUtc(value, label) { requireString(value, label); assert(ISO_UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} must be UTC`); }
function sortedUnique(values, label, {allowEmpty = true} = {}) {
  assert(Array.isArray(values), `${label} must be an array`);
  assert(allowEmpty || values.length > 0, `${label} must be nonempty`);
  values.forEach((value, index) => requireString(value, `${label}[${index}]`));
  const sorted = [...values].sort(compareUtf8);
  assert(new Set(sorted).size === sorted.length, `${label} contains duplicates`);
  assert(JSON.stringify(values) === JSON.stringify(sorted), `${label} must be UTF-8 sorted`);
  return values;
}
function sorted(values) { return [...new Set(values)].sort(compareUtf8); }
function digestWithout(value, field) { return canonicalDigest({...value, [field]: null}); }

export function compileSourceObservation({observationId, sourceIdentitySha256, sourceRef, observedAtUtc, observerRole, statement}) {
  const body = {
    observation_id: observationId,
    source_identity_sha256: sourceIdentitySha256,
    source_ref: sourceRef,
    observed_at_utc: observedAtUtc,
    observer_role: observerRole,
    statement,
    observation_sha256: null,
  };
  body.observation_sha256 = digestWithout(body, "observation_sha256");
  return validateSourceObservation(body);
}

function validateSourceObservation(value) {
  exactKeys(value, ["observation_id", "source_identity_sha256", "source_ref", "observed_at_utc", "observer_role", "statement", "observation_sha256"], "source observation");
  requireIdentifier(value.observation_id, "source observation ID");
  requireSha(value.source_identity_sha256, "source observation identity");
  requireString(value.source_ref, "source observation reference");
  requireUtc(value.observed_at_utc, "source observation time");
  requireIdentifier(value.observer_role, "source observation role");
  requireString(value.statement, "source observation statement");
  requireSha(value.observation_sha256, "source observation digest");
  assert(value.observation_sha256 === digestWithout(value, "observation_sha256"), "source observation digest mismatch");
  return value;
}

export function compileEvidenceItem({evidenceId, kind, sourceObservationId, artifactSha256, claim, evidenceClass}) {
  const body = {evidence_id: evidenceId, kind, source_observation_id: sourceObservationId, artifact_sha256: artifactSha256, claim, evidence_class: evidenceClass, evidence_sha256: null};
  body.evidence_sha256 = digestWithout(body, "evidence_sha256");
  return validateEvidenceItem(body);
}

function validateEvidenceItem(value) {
  exactKeys(value, ["evidence_id", "kind", "source_observation_id", "artifact_sha256", "claim", "evidence_class", "evidence_sha256"], "finding evidence item");
  requireIdentifier(value.evidence_id, "finding evidence ID");
  requireIdentifier(value.kind, "finding evidence kind");
  requireIdentifier(value.source_observation_id, "finding evidence observation");
  requireSha(value.artifact_sha256, "finding evidence artifact");
  requireString(value.claim, "finding evidence claim");
  assert(["DIRECT", "DETERMINISTIC", "INDEPENDENT", "REAL_HOST"].includes(value.evidence_class), "finding evidence class is invalid");
  requireSha(value.evidence_sha256, "finding evidence digest");
  assert(value.evidence_sha256 === digestWithout(value, "evidence_sha256"), "finding evidence digest mismatch");
  return value;
}

export function compileFindingEvidenceContract({contractKind, requiredChecks, requiredEvidenceClasses, prohibitedClaims}) {
  const body = {
    schema: "agentos.finding_evidence_contract.v1",
    version: 1,
    contract_kind: contractKind,
    required_checks: sorted(requiredChecks),
    required_evidence_classes: sorted(requiredEvidenceClasses),
    prohibited_claims: sorted(prohibitedClaims),
    contract_sha256: null,
  };
  body.contract_sha256 = digestWithout(body, "contract_sha256");
  return validateFindingEvidenceContract(body);
}

function validateFindingEvidenceContract(value) {
  exactKeys(value, ["schema", "version", "contract_kind", "required_checks", "required_evidence_classes", "prohibited_claims", "contract_sha256"], "finding evidence contract");
  assert(value.schema === "agentos.finding_evidence_contract.v1" && value.version === 1, "finding evidence contract identity is invalid");
  assert(["FOCUSED_PROOF", "INDEPENDENT_ACCEPTANCE"].includes(value.contract_kind), "finding evidence contract kind is invalid");
  sortedUnique(value.required_checks, "finding evidence required checks", {allowEmpty: false});
  sortedUnique(value.required_evidence_classes, "finding evidence required classes", {allowEmpty: false});
  sortedUnique(value.prohibited_claims, "finding evidence prohibited claims");
  requireSha(value.contract_sha256, "finding evidence contract digest");
  assert(value.contract_sha256 === digestWithout(value, "contract_sha256"), "finding evidence contract digest mismatch");
  return value;
}

export function compileEvidenceCeiling({availableLocalChecks = [], unavailableProof = [], realHostRequired, realHostStatus, mandatoryRetest = null, maxClaim}) {
  const body = {
    available_local_checks: sorted(availableLocalChecks),
    unavailable_proof: sorted(unavailableProof),
    real_host_required: realHostRequired,
    real_host_status: realHostStatus,
    mandatory_retest: mandatoryRetest,
    max_claim: maxClaim,
    ceiling_sha256: null,
  };
  body.ceiling_sha256 = digestWithout(body, "ceiling_sha256");
  return validateEvidenceCeiling(body);
}

function validateEvidenceCeiling(value) {
  exactKeys(value, ["available_local_checks", "unavailable_proof", "real_host_required", "real_host_status", "mandatory_retest", "max_claim", "ceiling_sha256"], "finding evidence ceiling");
  sortedUnique(value.available_local_checks, "finding available local checks");
  sortedUnique(value.unavailable_proof, "finding unavailable proof");
  assert(typeof value.real_host_required === "boolean", "finding real-host requirement is invalid");
  assert(["NOT_REQUIRED", "UNTESTED_DEFERRED", "PASSED", "FAILED"].includes(value.real_host_status), "finding real-host status is invalid");
  assert(Object.hasOwn(CLAIM_RANK, value.max_claim), "finding evidence max claim is invalid");
  if (value.real_host_required) {
    assert(value.real_host_status !== "NOT_REQUIRED", "required real-host proof cannot be NOT_REQUIRED");
    requireString(value.mandatory_retest, "finding mandatory real-host retest");
    if (value.real_host_status !== "PASSED") assert(CLAIM_RANK[value.max_claim] <= CLAIM_RANK.LOCALLY_PROVEN, "unproven real-host evidence exceeds its ceiling", "EVIDENCE_CEILING_EXCEEDED");
  } else {
    assert(value.real_host_status === "NOT_REQUIRED" && value.mandatory_retest === null, "non-required real-host proof carries a deferred state");
    assert(value.max_claim !== "REAL_HOST_PROVEN", "non-required real-host proof cannot claim a real-host result");
  }
  if (value.max_claim === "REAL_HOST_PROVEN") assert(value.real_host_status === "PASSED", "real-host claim lacks passed proof", "EVIDENCE_CEILING_EXCEEDED");
  requireSha(value.ceiling_sha256, "finding evidence ceiling digest");
  assert(value.ceiling_sha256 === digestWithout(value, "ceiling_sha256"), "finding evidence ceiling digest mismatch");
  return value;
}

const HISTORY_KEYS = ["sequence", "from_status", "to_status", "event", "at_utc", "actor_role", "reason", "evidence_sha256", "candidate_id", "failure_signature_sha256", "recovery_route_id", "event_sha256"];

function sealHistoryEvent(input) {
  const body = {...input, event_sha256: null};
  body.event_sha256 = digestWithout(body, "event_sha256");
  return body;
}

function validateFindingHistory(history, currentStatus) {
  assert(Array.isArray(history) && history.length > 0, "finding lifecycle history is required");
  for (const [index, event] of history.entries()) {
    exactKeys(event, HISTORY_KEYS, `finding history ${index}`);
    assert(event.sequence === index, `finding history ${index} sequence is not contiguous`);
    assert(event.from_status === null || FINDING_STATUSES.includes(event.from_status), `finding history ${index} source status is invalid`);
    assert(FINDING_STATUSES.includes(event.to_status), `finding history ${index} target status is invalid`);
    requireIdentifier(event.event, `finding history ${index} event`);
    requireUtc(event.at_utc, `finding history ${index} time`);
    requireIdentifier(event.actor_role, `finding history ${index} actor`);
    requireString(event.reason, `finding history ${index} reason`);
    requireSha(event.evidence_sha256, `finding history ${index} evidence`);
    requireNullableString(event.candidate_id, `finding history ${index} candidate`);
    if (event.failure_signature_sha256 !== null) requireSha(event.failure_signature_sha256, `finding history ${index} failure signature`);
    requireNullableString(event.recovery_route_id, `finding history ${index} recovery route`);
    requireSha(event.event_sha256, `finding history ${index} digest`);
    assert(event.event_sha256 === digestWithout(event, "event_sha256"), `finding history ${index} digest mismatch`);
    if (index === 0) assert(event.from_status === null && event.to_status === "OPEN" && event.event === "FINDING_OPENED", "finding history has invalid genesis");
    else {
      assert(event.from_status === history[index - 1].to_status, `finding history ${index} is detached from its predecessor`);
      if (event.event !== "RECOVERY_FAILED") assert(ALLOWED_STATUS_TRANSITIONS[event.from_status]?.has(event.to_status), `finding history ${index} contains an illegal ${event.from_status} -> ${event.to_status} transition`);
    }
    if (event.event === "RECOVERY_FAILED") {
      assert(event.from_status === event.to_status && ["IN_REPAIR", "CANDIDATE_REJECTED", "REOPENED"].includes(event.to_status), "failed recovery changed finding status");
      assert(event.failure_signature_sha256 !== null && event.recovery_route_id !== null, "failed recovery lacks signature or route");
    }
    if (event.to_status === "BLOCKED_EXACT") {
      const attempts = history.slice(0, index).filter((item) => item.event === "RECOVERY_FAILED").slice(-3);
      assert(attempts.length === 3, "BLOCKED_EXACT lacks three failed recoveries", "BLOCKED_EXACT_NOT_EXHAUSTED");
      assert(new Set(attempts.map((item) => item.failure_signature_sha256)).size === 1, "BLOCKED_EXACT recoveries do not share an exact failure signature", "BLOCKED_EXACT_NOT_EXHAUSTED");
      assert(new Set(attempts.map((item) => item.recovery_route_id)).size === 3, "BLOCKED_EXACT recoveries did not exhaust distinct bounded routes", "BLOCKED_EXACT_NOT_EXHAUSTED");
    }
  }
  assert(history.at(-1).to_status === currentStatus, "finding lifecycle status differs from history");
}

function validateAuditFinding(finding) {
  exactKeys(finding, [
    "schema", "version", "finding_id", "semantic_key", "stable_aliases", "causal_root_id", "title", "summary", "discipline",
    "gate_ref", "clause_refs", "source_observations", "evidence_items", "affected_surfaces", "severity", "confidence", "blast_radius",
    "dependency_finding_ids", "conflict_finding_ids", "proposed_repair_class", "focused_proof_contract", "independent_acceptance_contract",
    "evidence_ceiling", "lifecycle", "finding_sha256",
  ], "audit finding");
  assert(finding.schema === AUDIT_FINDING_SCHEMA && finding.version === 1, "audit finding identity is invalid");
  requireIdentifier(finding.finding_id, "audit finding ID");
  requireIdentifier(finding.semantic_key, "audit finding semantic key");
  requireIdentifier(finding.causal_root_id, "audit finding causal root");
  sortedUnique(finding.stable_aliases, "audit finding aliases");
  assert(!finding.stable_aliases.includes(finding.finding_id), "audit finding aliases repeat the finding ID");
  for (const field of ["title", "summary", "discipline", "gate_ref"]) requireString(finding[field], `audit finding ${field}`);
  sortedUnique(finding.clause_refs, "audit finding clauses", {allowEmpty: false});
  assert(Array.isArray(finding.source_observations) && finding.source_observations.length > 0, "audit finding source observations are required");
  finding.source_observations.forEach(validateSourceObservation);
  assert(Array.isArray(finding.evidence_items) && finding.evidence_items.length > 0, "audit finding evidence is required");
  finding.evidence_items.forEach(validateEvidenceItem);
  const observationIds = new Set(finding.source_observations.map((item) => item.observation_id));
  finding.evidence_items.forEach((item) => assert(observationIds.has(item.source_observation_id), `audit finding evidence ${item.evidence_id} references an unknown observation`));
  sortedUnique(finding.affected_surfaces, "audit finding affected surfaces", {allowEmpty: false});
  assert(Object.hasOwn(SEVERITY_RANK, finding.severity), "audit finding severity is invalid");
  assert(CONFIDENCE.has(finding.confidence), "audit finding confidence is invalid");
  assert(Object.hasOwn(BLAST_RANK, finding.blast_radius), "audit finding blast radius is invalid");
  sortedUnique(finding.dependency_finding_ids, "audit finding dependencies");
  sortedUnique(finding.conflict_finding_ids, "audit finding conflicts");
  assert(!finding.dependency_finding_ids.includes(finding.finding_id) && !finding.conflict_finding_ids.includes(finding.finding_id), "audit finding self-references");
  assert(Object.hasOwn(REPAIR_CLASSES, finding.proposed_repair_class), "audit finding repair class is invalid");
  validateFindingEvidenceContract(finding.focused_proof_contract);
  assert(finding.focused_proof_contract.contract_kind === "FOCUSED_PROOF", "audit finding focused proof contract kind is invalid");
  validateFindingEvidenceContract(finding.independent_acceptance_contract);
  assert(finding.independent_acceptance_contract.contract_kind === "INDEPENDENT_ACCEPTANCE", "audit finding acceptance contract kind is invalid");
  validateEvidenceCeiling(finding.evidence_ceiling);
  exactKeys(finding.lifecycle, ["status", "history"], "audit finding lifecycle");
  assert(FINDING_STATUSES.includes(finding.lifecycle.status), "audit finding lifecycle status is invalid");
  validateFindingHistory(finding.lifecycle.history, finding.lifecycle.status);
  requireSha(finding.finding_sha256, "audit finding digest");
  assert(finding.finding_sha256 === digestWithout(finding, "finding_sha256"), "audit finding digest mismatch");
  return finding;
}

export function compileAuditFinding(input) {
  const initial = sealHistoryEvent({
    sequence: 0, from_status: null, to_status: "OPEN", event: "FINDING_OPENED", at_utc: input.observedAtUtc,
    actor_role: input.observerRole, reason: input.openReason, evidence_sha256: input.openEvidenceSha256,
    candidate_id: input.candidateId ?? null, failure_signature_sha256: null, recovery_route_id: null,
  });
  const finding = {
    schema: AUDIT_FINDING_SCHEMA,
    version: 1,
    finding_id: input.findingId,
    semantic_key: input.semanticKey,
    stable_aliases: sorted(input.stableAliases ?? []),
    causal_root_id: input.causalRootId,
    title: input.title,
    summary: input.summary,
    discipline: input.discipline,
    gate_ref: input.gateRef,
    clause_refs: sorted(input.clauseRefs),
    source_observations: [...input.sourceObservations].sort((a, b) => compareUtf8(a.observation_id, b.observation_id)),
    evidence_items: [...input.evidenceItems].sort((a, b) => compareUtf8(a.evidence_id, b.evidence_id)),
    affected_surfaces: sorted(input.affectedSurfaces),
    severity: input.severity,
    confidence: input.confidence,
    blast_radius: input.blastRadius,
    dependency_finding_ids: sorted(input.dependencyFindingIds ?? []),
    conflict_finding_ids: sorted(input.conflictFindingIds ?? []),
    proposed_repair_class: input.proposedRepairClass,
    focused_proof_contract: structuredClone(input.focusedProofContract),
    independent_acceptance_contract: structuredClone(input.independentAcceptanceContract),
    evidence_ceiling: structuredClone(input.evidenceCeiling),
    lifecycle: {status: "OPEN", history: [initial]},
    finding_sha256: null,
  };
  finding.finding_sha256 = digestWithout(finding, "finding_sha256");
  return validateAuditFinding(finding);
}

const ALLOWED_STATUS_TRANSITIONS = Object.freeze({
  OPEN: new Set(["CONSOLIDATED", "PLANNED", "DEFERRED_REAL_HOST", "REJECTED_FALSE_POSITIVE"]),
  CONSOLIDATED: new Set(["PLANNED", "DEFERRED_REAL_HOST", "REJECTED_FALSE_POSITIVE"]),
  PLANNED: new Set(["IN_REPAIR", "DEFERRED_REAL_HOST"]),
  IN_REPAIR: new Set(["CANDIDATE_REJECTED", "REPAIRED_PENDING_REAUDIT", "BLOCKED_EXACT"]),
  CANDIDATE_REJECTED: new Set(["IN_REPAIR", "BLOCKED_EXACT"]),
  REPAIRED_PENDING_REAUDIT: new Set(["ACCEPTED", "REOPENED", "DEFERRED_REAL_HOST"]),
  ACCEPTED: new Set(["REOPENED"]),
  REOPENED: new Set(["PLANNED", "IN_REPAIR", "BLOCKED_EXACT"]),
  DEFERRED_REAL_HOST: new Set(["ACCEPTED", "REOPENED", "BLOCKED_EXACT"]),
  REJECTED_FALSE_POSITIVE: new Set(),
  BLOCKED_EXACT: new Set(),
});

export function transitionAuditFinding(finding, {toStatus = null, event, atUtc, actorRole, reason, evidenceSha256, candidateId = null, failureSignatureSha256 = null, recoveryRouteId = null}) {
  validateAuditFinding(finding);
  const next = structuredClone(finding);
  const current = next.lifecycle.status;
  const target = event === "RECOVERY_FAILED" ? current : toStatus;
  assert(FINDING_STATUSES.includes(target), "finding transition target is invalid");
  if (event === "RECOVERY_FAILED") assert(["IN_REPAIR", "CANDIDATE_REJECTED", "REOPENED"].includes(current), "failed recovery is not in a repairable status");
  else assert(ALLOWED_STATUS_TRANSITIONS[current].has(target), `finding transition ${current} -> ${target} is not allowed`);
  const historyEvent = sealHistoryEvent({
    sequence: next.lifecycle.history.length,
    from_status: current,
    to_status: target,
    event,
    at_utc: atUtc,
    actor_role: actorRole,
    reason,
    evidence_sha256: evidenceSha256,
    candidate_id: candidateId,
    failure_signature_sha256: failureSignatureSha256,
    recovery_route_id: recoveryRouteId,
  });
  next.lifecycle.history.push(historyEvent);
  next.lifecycle.status = target;
  next.finding_sha256 = digestWithout(next, "finding_sha256");
  return validateAuditFinding(next);
}

function strongest(values, rank) { return [...values].sort((a, b) => rank[a] - rank[b] || compareUtf8(a, b))[0]; }

export function compileFindingConsolidation(findings) {
  assert(Array.isArray(findings) && findings.length > 0, "findings are required for consolidation");
  findings.forEach(validateAuditFinding);
  const ids = findings.map((item) => item.finding_id);
  assert(new Set(ids).size === ids.length, "finding IDs duplicate before consolidation");
  const known = new Set(ids);
  findings.forEach((finding) => [...finding.dependency_finding_ids, ...finding.conflict_finding_ids].forEach((id) => assert(known.has(id), `finding ${finding.finding_id} references unknown finding ${id}`)));
  const groupKey = (finding) => `${finding.causal_root_id}\u0000${finding.semantic_key}`;
  const aliasOwners = new Map();
  for (const finding of findings) {
    for (const alias of [finding.finding_id, ...finding.stable_aliases]) {
      const prior = aliasOwners.get(alias);
      assert(prior === undefined || prior === groupKey(finding), `semantic alias ${alias} spans causal roots or semantic keys`, "SEMANTIC_ALIAS_CONFLICT");
      aliasOwners.set(alias, groupKey(finding));
    }
  }
  const grouped = new Map();
  for (const finding of findings) {
    const key = groupKey(finding);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(finding);
  }
  const sourceToCanonical = new Map();
  for (const group of grouped.values()) {
    const canonicalId = group.map((item) => item.finding_id).sort(compareUtf8)[0];
    group.forEach((item) => sourceToCanonical.set(item.finding_id, canonicalId));
  }
  const entries = [...grouped.values()].map((group) => {
    const sortedGroup = [...group].sort((a, b) => compareUtf8(a.finding_id, b.finding_id));
    const canonicalFindingId = sortedGroup[0].finding_id;
    const dependencies = sorted(group.flatMap((item) => item.dependency_finding_ids).map((id) => sourceToCanonical.get(id)).filter((id) => id !== canonicalFindingId));
    const conflicts = sorted(group.flatMap((item) => item.conflict_finding_ids).map((id) => sourceToCanonical.get(id)).filter((id) => id !== canonicalFindingId));
    const observations = [...new Map(group.flatMap((item) => item.source_observations).map((item) => [item.observation_sha256, item])).values()].sort((a, b) => compareUtf8(a.observation_sha256, b.observation_sha256));
    const evidence = [...new Map(group.flatMap((item) => item.evidence_items).map((item) => [item.evidence_sha256, item])).values()].sort((a, b) => compareUtf8(a.evidence_sha256, b.evidence_sha256));
    const variants = sortedGroup.map((item) => ({
      source_finding_id: item.finding_id,
      finding_sha256: item.finding_sha256,
      severity: item.severity,
      confidence: item.confidence,
      blast_radius: item.blast_radius,
      proposed_repair_class: item.proposed_repair_class,
    }));
    const repairClass = [...new Set(group.map((item) => item.proposed_repair_class))].sort((a, b) => REPAIR_CLASSES[a].rank - REPAIR_CLASSES[b].rank || compareUtf8(a, b))[0];
    const entry = {
      canonical_finding_id: canonicalFindingId,
      semantic_key: sortedGroup[0].semantic_key,
      causal_root_id: sortedGroup[0].causal_root_id,
      source_finding_ids: sorted(sortedGroup.map((item) => item.finding_id)),
      aliases: sorted(group.flatMap((item) => item.stable_aliases)),
      source_variants: variants,
      source_observations: observations,
      evidence_items: evidence,
      affected_surfaces: sorted(group.flatMap((item) => item.affected_surfaces)),
      dependency_finding_ids: dependencies,
      conflict_finding_ids: conflicts,
      severity: strongest(group.map((item) => item.severity), SEVERITY_RANK),
      confidence: group.every((item) => item.confidence === "VERIFIED") ? "VERIFIED" : strongest(group.map((item) => item.confidence), {VERIFIED: 0, HIGH: 1, MEDIUM: 2, LOW: 3}),
      blast_radius: strongest(group.map((item) => item.blast_radius), BLAST_RANK),
      proposed_repair_class: repairClass,
      entry_sha256: null,
    };
    entry.entry_sha256 = digestWithout(entry, "entry_sha256");
    return entry;
  }).sort((a, b) => compareUtf8(a.canonical_finding_id, b.canonical_finding_id));
  const body = {
    schema: FINDING_CONSOLIDATION_SCHEMA,
    version: 1,
    status: "CONSOLIDATED_MULTI_SOURCE_EVIDENCE_PRESERVED",
    source_finding_digests: findings.map((item) => item.finding_sha256).sort(compareUtf8),
    source_to_canonical: Object.fromEntries([...sourceToCanonical.entries()].sort(([a], [b]) => compareUtf8(a, b))),
    entries,
    consolidation_sha256: null,
  };
  body.consolidation_sha256 = digestWithout(body, "consolidation_sha256");
  return validateFindingConsolidation(body);
}

function validateFindingConsolidation(value) {
  exactKeys(value, ["schema", "version", "status", "source_finding_digests", "source_to_canonical", "entries", "consolidation_sha256"], "finding consolidation");
  assert(value.schema === FINDING_CONSOLIDATION_SCHEMA && value.version === 1 && value.status === "CONSOLIDATED_MULTI_SOURCE_EVIDENCE_PRESERVED", "finding consolidation identity is invalid");
  sortedUnique(value.source_finding_digests, "consolidation source digests", {allowEmpty: false});
  assert(isRecord(value.source_to_canonical), "finding consolidation source map is invalid");
  assert(Array.isArray(value.entries) && value.entries.length > 0, "finding consolidation entries are required");
  const ids = value.entries.map((entry) => entry.canonical_finding_id);
  sortedUnique(ids, "consolidated finding IDs", {allowEmpty: false});
  const known = new Set(ids);
  for (const entry of value.entries) {
    requireIdentifier(entry.canonical_finding_id, "consolidated finding ID");
    requireIdentifier(entry.semantic_key, "consolidated semantic key");
    requireIdentifier(entry.causal_root_id, "consolidated causal root");
    sortedUnique(entry.source_finding_ids, "consolidated source findings", {allowEmpty: false});
    sortedUnique(entry.aliases, "consolidated aliases");
    assert(Array.isArray(entry.source_variants) && entry.source_variants.length === entry.source_finding_ids.length, "consolidated source variants are incomplete");
    entry.source_variants.forEach((variant) => {
      exactKeys(variant, ["source_finding_id", "finding_sha256", "severity", "confidence", "blast_radius", "proposed_repair_class"], "consolidated source variant");
      requireIdentifier(variant.source_finding_id, "consolidated source variant finding");
      requireSha(variant.finding_sha256, "consolidated source variant digest");
      assert(entry.source_finding_ids.includes(variant.source_finding_id), "consolidated source variant is not in source findings");
      assert(Object.hasOwn(SEVERITY_RANK, variant.severity) && CONFIDENCE.has(variant.confidence) && Object.hasOwn(BLAST_RANK, variant.blast_radius), "consolidated source variant priority is invalid");
      assert(Object.hasOwn(REPAIR_CLASSES, variant.proposed_repair_class), "consolidated source variant repair class is invalid");
    });
    assert(Array.isArray(entry.source_observations) && entry.source_observations.length > 0, "consolidated observations are missing");
    entry.source_observations.forEach(validateSourceObservation);
    assert(Array.isArray(entry.evidence_items) && entry.evidence_items.length > 0, "consolidated evidence is missing");
    entry.evidence_items.forEach(validateEvidenceItem);
    sortedUnique(entry.affected_surfaces, "consolidated affected surfaces", {allowEmpty: false});
    sortedUnique(entry.dependency_finding_ids, "consolidated dependencies");
    sortedUnique(entry.conflict_finding_ids, "consolidated conflicts");
    entry.dependency_finding_ids.forEach((id) => assert(known.has(id), `consolidated dependency ${id} is missing`));
    entry.conflict_finding_ids.forEach((id) => assert(known.has(id), `consolidated conflict ${id} is missing`));
    assert(Object.hasOwn(SEVERITY_RANK, entry.severity) && CONFIDENCE.has(entry.confidence) && Object.hasOwn(BLAST_RANK, entry.blast_radius), "consolidated priority is invalid");
    assert(Object.hasOwn(REPAIR_CLASSES, entry.proposed_repair_class), "consolidated repair class is invalid");
    requireSha(entry.entry_sha256, "consolidated entry digest");
    assert(entry.entry_sha256 === digestWithout(entry, "entry_sha256"), "consolidated entry digest mismatch");
  }
  requireSha(value.consolidation_sha256, "finding consolidation digest");
  assert(value.consolidation_sha256 === digestWithout(value, "consolidation_sha256"), "finding consolidation digest mismatch");
  return value;
}

const CONFLICT_RESOLUTIONS = new Set(["ORDER_FIRST_BEFORE_SECOND", "ORDER_SECOND_BEFORE_FIRST", "SCOPE_DISTINCTION_NO_EDGE", "REJECT_FIRST_AS_FALSE_POSITIVE", "REJECT_SECOND_AS_FALSE_POSITIVE"]);

function descendantCounts(ids, adjacency) {
  const memo = new Map();
  function count(id) {
    if (memo.has(id)) return memo.get(id);
    const reached = new Set();
    const stack = [...adjacency.get(id)];
    while (stack.length > 0) {
      const current = stack.pop();
      if (reached.has(current)) continue;
      reached.add(current);
      stack.push(...adjacency.get(current));
    }
    memo.set(id, reached.size);
    return reached.size;
  }
  return Object.fromEntries(ids.map((id) => [id, count(id)]));
}

export function compileRepairDag({consolidation, conflictResolutions = []}) {
  validateFindingConsolidation(consolidation);
  const entries = new Map(consolidation.entries.map((entry) => [entry.canonical_finding_id, entry]));
  const pairs = new Map();
  for (const entry of consolidation.entries) for (const other of entry.conflict_finding_ids) {
    const pair = [entry.canonical_finding_id, other].sort(compareUtf8);
    pairs.set(pair.join("\u0000"), pair);
  }
  const resolutions = new Map();
  for (const resolution of conflictResolutions) {
    exactKeys(resolution, ["finding_ids", "resolution", "reason", "evidence_sha256"], "repair conflict resolution");
    sortedUnique(resolution.finding_ids, "repair conflict pair", {allowEmpty: false});
    assert(resolution.finding_ids.length === 2, "repair conflict resolution must name exactly two findings");
    assert(CONFLICT_RESOLUTIONS.has(resolution.resolution), "repair conflict resolution is invalid");
    requireString(resolution.reason, "repair conflict reason");
    requireSha(resolution.evidence_sha256, "repair conflict evidence");
    resolutions.set(resolution.finding_ids.join("\u0000"), resolution);
  }
  for (const key of pairs.keys()) assert(resolutions.has(key), `repair conflict ${pairs.get(key).join(" <-> ")} is unresolved`, "UNRESOLVED_REPAIR_CONFLICT");
  for (const key of resolutions.keys()) assert(pairs.has(key), "repair conflict resolution does not bind a declared conflict");
  const rejected = new Set();
  const extraEdges = [];
  for (const [key, pair] of pairs) {
    const resolution = resolutions.get(key);
    if (resolution.resolution === "ORDER_FIRST_BEFORE_SECOND") extraEdges.push([pair[0], pair[1], "CONFLICT_ORDER"]);
    if (resolution.resolution === "ORDER_SECOND_BEFORE_FIRST") extraEdges.push([pair[1], pair[0], "CONFLICT_ORDER"]);
    if (resolution.resolution === "REJECT_FIRST_AS_FALSE_POSITIVE") rejected.add(pair[0]);
    if (resolution.resolution === "REJECT_SECOND_AS_FALSE_POSITIVE") rejected.add(pair[1]);
  }
  const ids = [...entries.keys()].filter((id) => !rejected.has(id)).sort(compareUtf8);
  const adjacency = new Map(ids.map((id) => [id, new Set()]));
  const indegree = new Map(ids.map((id) => [id, 0]));
  const edgeMap = new Map();
  function addEdge(from, to, kind) {
    if (rejected.has(from) || rejected.has(to)) return;
    assert(from !== to, `repair DAG has a self edge at ${from}`, "REPAIR_DAG_CYCLE");
    const key = `${from}\u0000${to}`;
    if (!edgeMap.has(key)) {
      edgeMap.set(key, {from_finding_id: from, to_finding_id: to, edge_kind: kind});
      adjacency.get(from).add(to);
      indegree.set(to, indegree.get(to) + 1);
    }
  }
  for (const entry of consolidation.entries) for (const dependency of entry.dependency_finding_ids) addEdge(dependency, entry.canonical_finding_id, "DEPENDENCY");
  extraEdges.forEach(([from, to, kind]) => addEdge(from, to, kind));
  const descendants = descendantCounts(ids, adjacency);
  function compareReady(left, right) {
    const a = entries.get(left); const b = entries.get(right);
    return REPAIR_CLASSES[a.proposed_repair_class].rank - REPAIR_CLASSES[b.proposed_repair_class].rank
      || SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
      || BLAST_RANK[a.blast_radius] - BLAST_RANK[b.blast_radius]
      || descendants[right] - descendants[left]
      || compareUtf8(left, right);
  }
  const ready = ids.filter((id) => indegree.get(id) === 0).sort(compareReady);
  const ordered = [];
  while (ready.length > 0) {
    const id = ready.shift();
    ordered.push(id);
    for (const next of [...adjacency.get(id)].sort(compareUtf8)) {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) ready.push(next);
    }
    ready.sort(compareReady);
  }
  assert(ordered.length === ids.length, "repair dependency/conflict graph contains a cycle", "REPAIR_DAG_CYCLE");
  const plan = ordered.map((id, index) => {
    const entry = entries.get(id);
    return {
      order: index,
      finding_id: id,
      wave: REPAIR_CLASSES[entry.proposed_repair_class].wave,
      repair_class: entry.proposed_repair_class,
      downstream_unblock_count: descendants[id],
      severity: entry.severity,
      blast_radius: entry.blast_radius,
    };
  });
  const body = {
    schema: REPAIR_DAG_SCHEMA,
    version: 1,
    status: "ACYCLIC_DETERMINISTIC_WAVES_PLANNED",
    consolidation_sha256: consolidation.consolidation_sha256,
    nodes: ids,
    edges: [...edgeMap.values()].sort((a, b) => compareUtf8(`${a.from_finding_id}\u0000${a.to_finding_id}`, `${b.from_finding_id}\u0000${b.to_finding_id}`)),
    conflict_resolutions: [...resolutions.values()].sort((a, b) => compareUtf8(a.finding_ids.join("\u0000"), b.finding_ids.join("\u0000"))),
    rejected_false_positive_finding_ids: [...rejected].sort(compareUtf8),
    plan,
    dag_sha256: null,
  };
  body.dag_sha256 = digestWithout(body, "dag_sha256");
  return validateRepairDag(body, consolidation);
}

function validateRepairDag(value, consolidation) {
  exactKeys(value, ["schema", "version", "status", "consolidation_sha256", "nodes", "edges", "conflict_resolutions", "rejected_false_positive_finding_ids", "plan", "dag_sha256"], "repair DAG");
  assert(value.schema === REPAIR_DAG_SCHEMA && value.version === 1 && value.status === "ACYCLIC_DETERMINISTIC_WAVES_PLANNED", "repair DAG identity is invalid");
  assert(value.consolidation_sha256 === consolidation.consolidation_sha256, "repair DAG consolidation binding is stale");
  sortedUnique(value.nodes, "repair DAG nodes");
  sortedUnique(value.rejected_false_positive_finding_ids, "repair DAG rejected findings");
  assert(Array.isArray(value.edges), "repair DAG edges are required");
  const nodeSet = new Set(value.nodes);
  const edgeKeys = new Set();
  value.edges.forEach((edge) => {
    exactKeys(edge, ["from_finding_id", "to_finding_id", "edge_kind"], "repair DAG edge");
    assert(nodeSet.has(edge.from_finding_id) && nodeSet.has(edge.to_finding_id), "repair DAG edge references a missing node");
    assert(edge.from_finding_id !== edge.to_finding_id, "repair DAG contains a self edge");
    assert(["DEPENDENCY", "CONFLICT_ORDER"].includes(edge.edge_kind), "repair DAG edge kind is invalid");
    const key = `${edge.from_finding_id}\u0000${edge.to_finding_id}`;
    assert(!edgeKeys.has(key), "repair DAG contains a duplicate edge");
    edgeKeys.add(key);
  });
  assert(Array.isArray(value.conflict_resolutions), "repair DAG conflict resolutions are required");
  value.conflict_resolutions.forEach((resolution) => {
    exactKeys(resolution, ["finding_ids", "resolution", "reason", "evidence_sha256"], "repair DAG conflict resolution");
    sortedUnique(resolution.finding_ids, "repair DAG conflict pair", {allowEmpty: false});
    assert(resolution.finding_ids.length === 2 && CONFLICT_RESOLUTIONS.has(resolution.resolution), "repair DAG conflict resolution is invalid");
    requireString(resolution.reason, "repair DAG conflict reason"); requireSha(resolution.evidence_sha256, "repair DAG conflict evidence");
  });
  assert(Array.isArray(value.plan) && value.plan.length === value.nodes.length, "repair DAG plan coverage is incomplete");
  const planned = new Set();
  value.plan.forEach((item, index) => {
    assert(item.order === index && value.nodes.includes(item.finding_id), "repair DAG plan order or node is invalid");
    assert(!planned.has(item.finding_id), "repair DAG plan duplicates a node"); planned.add(item.finding_id);
    assert(REPAIR_CLASSES[item.repair_class].wave === item.wave, "repair DAG wave is invalid");
    assert(Number.isSafeInteger(item.downstream_unblock_count) && item.downstream_unblock_count >= 0, "repair DAG downstream count is invalid");
  });
  const positions = new Map(value.plan.map((item) => [item.finding_id, item.order]));
  value.edges.forEach((edge) => assert(positions.get(edge.from_finding_id) < positions.get(edge.to_finding_id), "repair DAG plan violates an edge or contains a cycle", "REPAIR_DAG_CYCLE"));
  requireSha(value.dag_sha256, "repair DAG digest");
  assert(value.dag_sha256 === digestWithout(value, "dag_sha256"), "repair DAG digest mismatch");
  return value;
}

export function compileFeatureCandidateReceipt({receiptId, featureId, candidateId, commit, tree, findingIds, applicablePlatformIds, proofEvidenceSha256, independentAcceptanceSha256, schedulerAdmission, status, rejectionReason = null, rejectionEvidenceSha256 = null, createdAtUtc}) {
  validateSchedulerAdmissionReceipt(schedulerAdmission, {candidateCommit: commit, candidateTree: tree});
  const body = {
    schema: "agentos.feature_candidate_receipt.v1",
    version: 1,
    receipt_id: receiptId,
    feature_id: featureId,
    candidate_id: candidateId,
    commit,
    tree,
    finding_ids: sorted(findingIds),
    applicable_platform_ids: sorted(applicablePlatformIds),
    proof_evidence_sha256: proofEvidenceSha256,
    independent_acceptance_sha256: independentAcceptanceSha256,
    scheduler_admission: structuredClone(schedulerAdmission),
    status,
    rejection_reason: rejectionReason,
    rejection_evidence_sha256: rejectionEvidenceSha256,
    retained: true,
    created_at_utc: createdAtUtc,
    receipt_sha256: null,
  };
  body.receipt_sha256 = digestWithout(body, "receipt_sha256");
  return validateFeatureCandidateReceipt(body);
}

function validateFeatureCandidateReceipt(value) {
  exactKeys(value, ["schema", "version", "receipt_id", "feature_id", "candidate_id", "commit", "tree", "finding_ids", "applicable_platform_ids", "proof_evidence_sha256", "independent_acceptance_sha256", "scheduler_admission", "status", "rejection_reason", "rejection_evidence_sha256", "retained", "created_at_utc", "receipt_sha256"], "Feature candidate receipt");
  assert(value.schema === "agentos.feature_candidate_receipt.v1" && value.version === 1, "Feature candidate receipt identity is invalid");
  for (const field of ["receipt_id", "feature_id", "candidate_id"]) requireIdentifier(value[field], `Feature candidate ${field}`);
  requireGitObject(value.commit, "Feature candidate commit"); requireGitObject(value.tree, "Feature candidate tree");
  sortedUnique(value.finding_ids, "Feature candidate findings", {allowEmpty: false});
  sortedUnique(value.applicable_platform_ids, "Feature candidate applicable Platforms");
  requireSha(value.proof_evidence_sha256, "Feature candidate proof");
  requireSha(value.independent_acceptance_sha256, "Feature candidate independent acceptance");
  validateSchedulerAdmissionReceipt(value.scheduler_admission, {candidateCommit: value.commit, candidateTree: value.tree});
  assert(["ACCEPTED_FOR_PLATFORM", "REJECTED_RETAINED"].includes(value.status), "Feature candidate status is invalid");
  assert(value.retained === true, "Feature candidate was silently dropped");
  if (value.status === "ACCEPTED_FOR_PLATFORM") assert(value.rejection_reason === null && value.rejection_evidence_sha256 === null, "accepted Feature candidate carries rejection evidence");
  else { requireString(value.rejection_reason, "Feature candidate rejection reason"); requireSha(value.rejection_evidence_sha256, "Feature candidate rejection evidence"); }
  requireUtc(value.created_at_utc, "Feature candidate time");
  requireSha(value.receipt_sha256, "Feature candidate receipt digest");
  assert(value.receipt_sha256 === digestWithout(value, "receipt_sha256"), "Feature candidate receipt digest mismatch");
  return value;
}

export function compileCandidateRetentionLedger({receipts, expectedCandidateIds}) {
  assert(Array.isArray(receipts) && receipts.length > 0, "candidate retention receipts are required");
  receipts.forEach(validateFeatureCandidateReceipt);
  const ids = receipts.map((item) => item.candidate_id);
  assert(new Set(ids).size === ids.length, "candidate retention ledger has duplicate candidate IDs");
  const expected = sorted(expectedCandidateIds);
  assert(JSON.stringify([...ids].sort(compareUtf8)) === JSON.stringify(expected), "candidate retention ledger silently dropped or invented a candidate", "CANDIDATE_RETENTION_INCOMPLETE");
  const body = {
    schema: CANDIDATE_RETENTION_LEDGER_SCHEMA,
    version: 1,
    status: "ALL_CANDIDATES_RETAINED",
    expected_candidate_ids: expected,
    receipts: [...receipts].sort((a, b) => compareUtf8(a.candidate_id, b.candidate_id)),
    accepted_candidate_ids: receipts.filter((item) => item.status === "ACCEPTED_FOR_PLATFORM").map((item) => item.candidate_id).sort(compareUtf8),
    rejected_candidate_ids: receipts.filter((item) => item.status === "REJECTED_RETAINED").map((item) => item.candidate_id).sort(compareUtf8),
    ledger_sha256: null,
  };
  body.ledger_sha256 = digestWithout(body, "ledger_sha256");
  return validateCandidateRetentionLedger(body);
}

function validateCandidateRetentionLedger(value) {
  exactKeys(value, ["schema", "version", "status", "expected_candidate_ids", "receipts", "accepted_candidate_ids", "rejected_candidate_ids", "ledger_sha256"], "candidate retention ledger");
  assert(value.schema === CANDIDATE_RETENTION_LEDGER_SCHEMA && value.version === 1 && value.status === "ALL_CANDIDATES_RETAINED", "candidate retention ledger identity is invalid");
  assert(Array.isArray(value.receipts) && value.receipts.length > 0, "candidate retention ledger receipts are missing");
  value.receipts.forEach(validateFeatureCandidateReceipt);
  sortedUnique(value.expected_candidate_ids, "expected candidate IDs", {allowEmpty: false});
  sortedUnique(value.accepted_candidate_ids, "accepted candidate IDs");
  sortedUnique(value.rejected_candidate_ids, "rejected candidate IDs");
  assert(value.receipts.length === value.accepted_candidate_ids.length + value.rejected_candidate_ids.length, "candidate retention ledger silently dropped a receipt");
  assert(JSON.stringify(value.receipts.map((item) => item.candidate_id).sort(compareUtf8)) === JSON.stringify(value.expected_candidate_ids), "candidate retention ledger does not cover the expected inventory");
  requireSha(value.ledger_sha256, "candidate retention ledger digest");
  assert(value.ledger_sha256 === digestWithout(value, "ledger_sha256"), "candidate retention ledger digest mismatch");
  return value;
}

export function compilePlatformConsumptionMatrix({platformIds, candidateLedger, dispositions}) {
  validateCandidateRetentionLedger(candidateLedger);
  const platforms = sorted(platformIds);
  assert(platforms.length > 0, "Platform roster is required");
  assert(isRecord(dispositions), "Platform matrix dispositions are required");
  const accepted = candidateLedger.receipts.filter((item) => item.status === "ACCEPTED_FOR_PLATFORM");
  const expectedKeys = accepted.flatMap((receipt) => platforms.map((platformId) => `${receipt.candidate_id}::${platformId}`)).sort(compareUtf8);
  assert(JSON.stringify(Object.keys(dispositions).sort(compareUtf8)) === JSON.stringify(expectedKeys), "Platform matrix does not cover every accepted Feature candidate/Platform cell", "PLATFORM_MATRIX_INCOMPLETE");
  const cells = [];
  for (const receipt of accepted) for (const platformId of platforms) {
    const key = `${receipt.candidate_id}::${platformId}`;
    const input = dispositions[key];
    assert(isRecord(input), `Platform matrix cell ${key} is missing`);
    const applicable = receipt.applicable_platform_ids.includes(platformId);
    const expected = applicable ? "CONSUMED" : "NOT_APPLICABLE_WITH_EVIDENCE";
    assert(input.status === expected, `Platform matrix cell ${key} disposition is invalid`);
    requireSha(input.evidence_sha256, `Platform matrix cell ${key} evidence`);
    if (applicable) assert(input.reason === null, `consumed Platform matrix cell ${key} carries an N/A reason`);
    else requireString(input.reason, `Platform matrix cell ${key} N/A reason`);
    const cell = {
      cell_id: key,
      feature_candidate_id: receipt.candidate_id,
      feature_receipt_sha256: receipt.receipt_sha256,
      feature_id: receipt.feature_id,
      platform_id: platformId,
      finding_ids: [...receipt.finding_ids],
      status: expected,
      reason: input.reason,
      evidence_sha256: input.evidence_sha256,
      cell_sha256: null,
    };
    cell.cell_sha256 = digestWithout(cell, "cell_sha256");
    cells.push(cell);
  }
  cells.sort((a, b) => compareUtf8(a.cell_id, b.cell_id));
  const body = {
    schema: PLATFORM_CONSUMPTION_MATRIX_SCHEMA,
    version: 1,
    status: "EVERY_CELL_SETTLED",
    candidate_ledger_sha256: candidateLedger.ledger_sha256,
    platform_ids: platforms,
    cells,
    matrix_sha256: null,
  };
  body.matrix_sha256 = digestWithout(body, "matrix_sha256");
  return validatePlatformConsumptionMatrix(body, candidateLedger);
}

function validatePlatformConsumptionMatrix(value, candidateLedger) {
  exactKeys(value, ["schema", "version", "status", "candidate_ledger_sha256", "platform_ids", "cells", "matrix_sha256"], "Platform consumption matrix");
  assert(value.schema === PLATFORM_CONSUMPTION_MATRIX_SCHEMA && value.version === 1 && value.status === "EVERY_CELL_SETTLED", "Platform matrix identity is invalid");
  assert(value.candidate_ledger_sha256 === candidateLedger.ledger_sha256, "Platform matrix candidate ledger binding is stale");
  sortedUnique(value.platform_ids, "Platform matrix roster", {allowEmpty: false});
  assert(Array.isArray(value.cells), "Platform matrix cells are missing");
  value.cells.forEach((cell) => {
    exactKeys(cell, ["cell_id", "feature_candidate_id", "feature_receipt_sha256", "feature_id", "platform_id", "finding_ids", "status", "reason", "evidence_sha256", "cell_sha256"], "Platform matrix cell");
    assert(["CONSUMED", "NOT_APPLICABLE_WITH_EVIDENCE"].includes(cell.status), `Platform matrix cell ${cell.cell_id} is unsettled`);
    requireSha(cell.evidence_sha256, `Platform matrix cell ${cell.cell_id} evidence`);
    if (cell.status === "NOT_APPLICABLE_WITH_EVIDENCE") requireString(cell.reason, `Platform matrix cell ${cell.cell_id} N/A reason`);
    requireSha(cell.cell_sha256, `Platform matrix cell ${cell.cell_id} digest`);
    assert(cell.cell_sha256 === digestWithout(cell, "cell_sha256"), `Platform matrix cell ${cell.cell_id} digest mismatch`);
  });
  const expected = candidateLedger.accepted_candidate_ids.length * value.platform_ids.length;
  assert(value.cells.length === expected && new Set(value.cells.map((item) => item.cell_id)).size === expected, "Platform matrix silently dropped or duplicated a cell");
  requireSha(value.matrix_sha256, "Platform matrix digest");
  assert(value.matrix_sha256 === digestWithout(value, "matrix_sha256"), "Platform matrix digest mismatch");
  return value;
}

export function compileCumulativePlatformCandidate({platformId, candidateId, commit, tree, matrix, candidateLedger, schedulerAdmission, reAuditStatus, reviewedFindingIds, reopenedFindingIds = [], auditorRole, reAuditEvidenceSha256, createdAtUtc}) {
  validatePlatformConsumptionMatrix(matrix, candidateLedger);
  validateSchedulerAdmissionReceipt(schedulerAdmission, {candidateCommit: commit, candidateTree: tree});
  const consumed = matrix.cells.filter((cell) => cell.platform_id === platformId && cell.status === "CONSUMED");
  assert(consumed.length > 0, `Platform ${platformId} has no applicable consumption cells`);
  const requiredFindings = sorted(consumed.flatMap((cell) => cell.finding_ids));
  const reviewed = sorted(reviewedFindingIds);
  assert(JSON.stringify(requiredFindings) === JSON.stringify(reviewed), `Platform ${platformId} re-audit does not cover every consumed finding`);
  const reopened = sorted(reopenedFindingIds);
  reopened.forEach((id) => assert(reviewed.includes(id), `Platform ${platformId} reopened an unreviewed finding`));
  assert((reAuditStatus === "PASS" && reopened.length === 0) || (reAuditStatus === "REOPENED" && reopened.length > 0), `Platform ${platformId} re-audit status is inconsistent`);
  const reAudit = {status: reAuditStatus, reviewed_finding_ids: reviewed, reopened_finding_ids: reopened, auditor_role: auditorRole, evidence_sha256: reAuditEvidenceSha256, reaudit_sha256: null};
  reAudit.reaudit_sha256 = digestWithout(reAudit, "reaudit_sha256");
  const body = {
    schema: PLATFORM_CANDIDATE_SCHEMA,
    version: 1,
    status: reAuditStatus === "PASS" ? "CUMULATIVE_REAUDITED_PASS" : "CUMULATIVE_REAUDIT_REOPENED",
    platform_id: platformId,
    candidate_id: candidateId,
    commit,
    tree,
    matrix_sha256: matrix.matrix_sha256,
    consumed_cell_ids: consumed.map((cell) => cell.cell_id).sort(compareUtf8),
    scheduler_admission: structuredClone(schedulerAdmission),
    independent_reaudit: reAudit,
    created_at_utc: createdAtUtc,
    candidate_sha256: null,
  };
  body.candidate_sha256 = digestWithout(body, "candidate_sha256");
  return validateCumulativePlatformCandidate(body, matrix, candidateLedger);
}

function validateCumulativePlatformCandidate(value, matrix, candidateLedger) {
  exactKeys(value, ["schema", "version", "status", "platform_id", "candidate_id", "commit", "tree", "matrix_sha256", "consumed_cell_ids", "scheduler_admission", "independent_reaudit", "created_at_utc", "candidate_sha256"], "cumulative Platform candidate");
  assert(value.schema === PLATFORM_CANDIDATE_SCHEMA && value.version === 1, "cumulative Platform candidate identity is invalid");
  assert(["CUMULATIVE_REAUDITED_PASS", "CUMULATIVE_REAUDIT_REOPENED"].includes(value.status), "cumulative Platform candidate status is invalid");
  for (const field of ["platform_id", "candidate_id"]) requireIdentifier(value[field], `cumulative Platform candidate ${field}`);
  requireGitObject(value.commit, "cumulative Platform commit"); requireGitObject(value.tree, "cumulative Platform tree");
  assert(value.matrix_sha256 === matrix.matrix_sha256, "cumulative Platform candidate matrix binding is stale");
  sortedUnique(value.consumed_cell_ids, "cumulative Platform consumed cells", {allowEmpty: false});
  const expected = matrix.cells.filter((cell) => cell.platform_id === value.platform_id && cell.status === "CONSUMED").map((cell) => cell.cell_id).sort(compareUtf8);
  assert(JSON.stringify(value.consumed_cell_ids) === JSON.stringify(expected), "cumulative Platform candidate silently dropped a consumed cell");
  validateSchedulerAdmissionReceipt(value.scheduler_admission, {candidateCommit: value.commit, candidateTree: value.tree});
  exactKeys(value.independent_reaudit, ["status", "reviewed_finding_ids", "reopened_finding_ids", "auditor_role", "evidence_sha256", "reaudit_sha256"], "cumulative Platform independent re-audit");
  assert(["PASS", "REOPENED"].includes(value.independent_reaudit.status), "cumulative Platform re-audit status is invalid");
  sortedUnique(value.independent_reaudit.reviewed_finding_ids, "cumulative Platform reviewed findings", {allowEmpty: false});
  sortedUnique(value.independent_reaudit.reopened_finding_ids, "cumulative Platform reopened findings");
  requireIdentifier(value.independent_reaudit.auditor_role, "cumulative Platform re-audit role");
  assert((value.independent_reaudit.status === "PASS" && value.independent_reaudit.reopened_finding_ids.length === 0) || (value.independent_reaudit.status === "REOPENED" && value.independent_reaudit.reopened_finding_ids.length > 0), "cumulative Platform re-audit disposition is inconsistent");
  requireSha(value.independent_reaudit.evidence_sha256, "cumulative Platform re-audit evidence");
  requireSha(value.independent_reaudit.reaudit_sha256, "cumulative Platform re-audit digest");
  assert(value.independent_reaudit.reaudit_sha256 === digestWithout(value.independent_reaudit, "reaudit_sha256"), "cumulative Platform re-audit digest mismatch");
  requireUtc(value.created_at_utc, "cumulative Platform candidate time");
  requireSha(value.candidate_sha256, "cumulative Platform candidate digest");
  assert(value.candidate_sha256 === digestWithout(value, "candidate_sha256"), "cumulative Platform candidate digest mismatch");
  return value;
}

export function compileConvergenceLedger(findings) {
  assert(Array.isArray(findings) && findings.length > 0, "convergence findings are required");
  findings.forEach(validateAuditFinding);
  const entries = findings.flatMap((finding) => finding.lifecycle.history.map((event) => ({finding_id: finding.finding_id, finding_sha256: finding.finding_sha256, ...event})))
    .sort((a, b) => Date.parse(a.at_utc) - Date.parse(b.at_utc) || compareUtf8(a.finding_id, b.finding_id) || a.sequence - b.sequence);
  const terminal = new Set(["ACCEPTED", "DEFERRED_REAL_HOST", "REJECTED_FALSE_POSITIVE", "BLOCKED_EXACT"]);
  const open = findings.filter((finding) => !terminal.has(finding.lifecycle.status)).map((finding) => finding.finding_id).sort(compareUtf8);
  const blocked = findings.filter((finding) => finding.lifecycle.status === "BLOCKED_EXACT").map((finding) => finding.finding_id).sort(compareUtf8);
  const deferred = findings.filter((finding) => finding.lifecycle.status === "DEFERRED_REAL_HOST").map((finding) => finding.finding_id).sort(compareUtf8);
  const body = {
    schema: CONVERGENCE_LEDGER_SCHEMA,
    version: 1,
    status: open.length === 0 ? "CONVERGED_WITH_EXACT_DISPOSITIONS" : "REPAIR_LOOP_ACTIVE",
    finding_digests: findings.map((finding) => finding.finding_sha256).sort(compareUtf8),
    entries,
    open_finding_ids: open,
    blocked_exact_finding_ids: blocked,
    deferred_real_host_finding_ids: deferred,
    reopened_event_count: entries.filter((entry) => entry.to_status === "REOPENED").length,
    ledger_sha256: null,
  };
  body.ledger_sha256 = digestWithout(body, "ledger_sha256");
  return validateConvergenceLedger(body);
}

function validateConvergenceLedger(value) {
  exactKeys(value, ["schema", "version", "status", "finding_digests", "entries", "open_finding_ids", "blocked_exact_finding_ids", "deferred_real_host_finding_ids", "reopened_event_count", "ledger_sha256"], "convergence ledger");
  assert(value.schema === CONVERGENCE_LEDGER_SCHEMA && value.version === 1, "convergence ledger identity is invalid");
  assert(["CONVERGED_WITH_EXACT_DISPOSITIONS", "REPAIR_LOOP_ACTIVE"].includes(value.status), "convergence ledger status is invalid");
  sortedUnique(value.finding_digests, "convergence finding digests", {allowEmpty: false});
  assert(Array.isArray(value.entries) && value.entries.length > 0, "convergence ledger entries are missing");
  sortedUnique(value.open_finding_ids, "convergence open findings");
  sortedUnique(value.blocked_exact_finding_ids, "convergence blocked findings");
  sortedUnique(value.deferred_real_host_finding_ids, "convergence deferred findings");
  assert(Number.isSafeInteger(value.reopened_event_count) && value.reopened_event_count >= 0, "convergence reopened count is invalid");
  assert(value.reopened_event_count === value.entries.filter((entry) => entry.to_status === "REOPENED").length, "convergence reopened count is stale");
  if (value.status === "CONVERGED_WITH_EXACT_DISPOSITIONS") assert(value.open_finding_ids.length === 0, "converged ledger carries open findings");
  requireSha(value.ledger_sha256, "convergence ledger digest");
  assert(value.ledger_sha256 === digestWithout(value, "ledger_sha256"), "convergence ledger digest mismatch");
  return value;
}

export function compileCentralIntakeManifest({centralCandidateId, commit, tree, matrix, candidateLedger, platformCandidates, convergenceLedger, repairDag, intakeEvidenceSha256, createdAtUtc}) {
  validatePlatformConsumptionMatrix(matrix, candidateLedger);
  validateConvergenceLedger(convergenceLedger);
  validateRepairDag(repairDag, {consolidation_sha256: repairDag.consolidation_sha256});
  assert(convergenceLedger.status === "CONVERGED_WITH_EXACT_DISPOSITIONS", "Central intake cannot consume an active repair/reopen loop", "CONVERGENCE_NOT_SETTLED");
  const convergenceFindingIds = new Set(convergenceLedger.entries.map((entry) => entry.finding_id));
  repairDag.nodes.forEach((id) => assert(convergenceFindingIds.has(id), `Central intake convergence ledger lacks repair DAG finding ${id}`));
  candidateLedger.receipts.filter((receipt) => receipt.status === "ACCEPTED_FOR_PLATFORM").flatMap((receipt) => receipt.finding_ids)
    .forEach((id) => assert(convergenceFindingIds.has(id), `Central intake convergence ledger lacks accepted Feature finding ${id}`));
  assert(Array.isArray(platformCandidates), "Central intake Platform candidates are required");
  const byPlatform = new Map(platformCandidates.map((candidate) => [candidate.platform_id, candidate]));
  assert(byPlatform.size === platformCandidates.length, "Central intake has duplicate Platform candidates");
  const platformEntries = [];
  for (const platformId of matrix.platform_ids) {
    const consumed = matrix.cells.filter((cell) => cell.platform_id === platformId && cell.status === "CONSUMED");
    if (consumed.length > 0) {
      const candidate = byPlatform.get(platformId);
      assert(candidate !== undefined, `Central intake lacks cumulative candidate for Platform ${platformId}`);
      validateCumulativePlatformCandidate(candidate, matrix, candidateLedger);
      assert(candidate.status === "CUMULATIVE_REAUDITED_PASS", `Central intake Platform ${platformId} has reopened findings`, "PLATFORM_REAUDIT_REOPENED");
      platformEntries.push({platform_id: platformId, status: "CONSUMED", platform_candidate_sha256: candidate.candidate_sha256, evidence_sha256: candidate.independent_reaudit.evidence_sha256});
    } else {
      assert(!byPlatform.has(platformId), `Central intake has a candidate for non-applicable Platform ${platformId}`);
      const naCells = matrix.cells.filter((cell) => cell.platform_id === platformId);
      assert(naCells.every((cell) => cell.status === "NOT_APPLICABLE_WITH_EVIDENCE"), `Central intake Platform ${platformId} lacks evidence-backed N/A cells`);
      platformEntries.push({platform_id: platformId, status: "NOT_APPLICABLE_WITH_EVIDENCE", platform_candidate_sha256: null, evidence_sha256: canonicalDigest(naCells.map((cell) => cell.evidence_sha256))});
    }
  }
  assert([...byPlatform.keys()].every((id) => matrix.platform_ids.includes(id)), "Central intake carries an unknown Platform candidate");
  const body = {
    schema: CENTRAL_INTAKE_SCHEMA,
    version: 1,
    status: "CENTRAL_INTAKE_COMPLETE",
    central_candidate_id: centralCandidateId,
    commit,
    tree,
    candidate_ledger_sha256: candidateLedger.ledger_sha256,
    matrix_sha256: matrix.matrix_sha256,
    repair_dag_sha256: repairDag.dag_sha256,
    convergence_ledger_sha256: convergenceLedger.ledger_sha256,
    matrix_cell_dispositions: matrix.cells.map((cell) => ({cell_id: cell.cell_id, status: cell.status, evidence_sha256: cell.evidence_sha256})),
    platform_entries: platformEntries,
    consumed_feature_candidate_ids: [...candidateLedger.accepted_candidate_ids],
    retained_rejected_candidate_ids: [...candidateLedger.rejected_candidate_ids],
    intake_evidence_sha256: intakeEvidenceSha256,
    created_at_utc: createdAtUtc,
    manifest_sha256: null,
  };
  body.manifest_sha256 = digestWithout(body, "manifest_sha256");
  return validateCentralIntakeManifest(body, {matrix, candidateLedger, convergenceLedger, repairDag});
}

function validateCentralIntakeManifest(value, {matrix, candidateLedger, convergenceLedger, repairDag}) {
  exactKeys(value, ["schema", "version", "status", "central_candidate_id", "commit", "tree", "candidate_ledger_sha256", "matrix_sha256", "repair_dag_sha256", "convergence_ledger_sha256", "matrix_cell_dispositions", "platform_entries", "consumed_feature_candidate_ids", "retained_rejected_candidate_ids", "intake_evidence_sha256", "created_at_utc", "manifest_sha256"], "Central intake manifest");
  assert(value.schema === CENTRAL_INTAKE_SCHEMA && value.version === 1 && value.status === "CENTRAL_INTAKE_COMPLETE", "Central intake manifest identity is invalid");
  requireIdentifier(value.central_candidate_id, "Central candidate ID"); requireGitObject(value.commit, "Central commit"); requireGitObject(value.tree, "Central tree");
  assert(value.candidate_ledger_sha256 === candidateLedger.ledger_sha256 && value.matrix_sha256 === matrix.matrix_sha256, "Central intake custody binding is stale");
  assert(value.repair_dag_sha256 === repairDag.dag_sha256 && value.convergence_ledger_sha256 === convergenceLedger.ledger_sha256, "Central intake convergence binding is stale");
  assert(value.matrix_cell_dispositions.length === matrix.cells.length, "Central intake silently dropped a matrix cell");
  value.matrix_cell_dispositions.forEach((cell, index) => {
    exactKeys(cell, ["cell_id", "status", "evidence_sha256"], "Central intake matrix disposition");
    const source = matrix.cells[index];
    assert(cell.cell_id === source.cell_id && cell.status === source.status && cell.evidence_sha256 === source.evidence_sha256, `Central intake matrix cell ${index} differs from Platform custody`);
    assert(["CONSUMED", "NOT_APPLICABLE_WITH_EVIDENCE"].includes(cell.status), `Central intake matrix cell ${cell.cell_id} is unsettled`);
  });
  assert(value.platform_entries.length === matrix.platform_ids.length, "Central intake Platform coverage is incomplete");
  value.platform_entries.forEach((entry, index) => {
    exactKeys(entry, ["platform_id", "status", "platform_candidate_sha256", "evidence_sha256"], `Central intake Platform ${index}`);
    assert(entry.platform_id === matrix.platform_ids[index], `Central intake Platform ${index} is reordered`);
    assert(["CONSUMED", "NOT_APPLICABLE_WITH_EVIDENCE"].includes(entry.status), `Central intake Platform ${entry.platform_id} is unsettled`);
    if (entry.status === "CONSUMED") requireSha(entry.platform_candidate_sha256, `Central intake Platform ${entry.platform_id} candidate`);
    else assert(entry.platform_candidate_sha256 === null, `Central intake non-applicable Platform ${entry.platform_id} carries a candidate`);
    requireSha(entry.evidence_sha256, `Central intake Platform ${entry.platform_id} evidence`);
  });
  assert(JSON.stringify(value.consumed_feature_candidate_ids) === JSON.stringify(candidateLedger.accepted_candidate_ids), "Central intake silently dropped an accepted Feature candidate");
  assert(JSON.stringify(value.retained_rejected_candidate_ids) === JSON.stringify(candidateLedger.rejected_candidate_ids), "Central intake silently dropped a rejected Feature candidate");
  requireSha(value.intake_evidence_sha256, "Central intake evidence"); requireUtc(value.created_at_utc, "Central intake time");
  requireSha(value.manifest_sha256, "Central intake manifest digest");
  assert(value.manifest_sha256 === digestWithout(value, "manifest_sha256"), "Central intake manifest digest mismatch");
  return value;
}

export function compileCascadeConvergenceEvent({centralManifest, outcomeId, atUtc}) {
  requireIdentifier(outcomeId, "cascade convergence outcome");
  requireUtc(atUtc, "cascade convergence event time");
  assert(centralManifest.schema === CENTRAL_INTAKE_SCHEMA && centralManifest.status === "CENTRAL_INTAKE_COMPLETE", "cascade convergence event requires a complete Central manifest");
  return {
    type: "AUDIT_REPAIR_CONVERGENCE",
    at_utc: atUtc,
    payload: {
      outcome_id: outcomeId,
      central_intake_sha256: centralManifest.manifest_sha256,
      repair_dag_sha256: centralManifest.repair_dag_sha256,
      convergence_ledger_sha256: centralManifest.convergence_ledger_sha256,
    },
  };
}

export function validateCascadeConvergenceReadback({previousCascade, completedCascade, centralManifest}) {
  validateCascadeState(previousCascade);
  validateCascadeState(completedCascade);
  assert(completedCascade.transition_journal.length === previousCascade.transition_journal.length + 1, "cascade convergence readback did not append exactly one transition");
  const event = completedCascade.transition_journal.at(-1);
  assert(event.from_state_sha256 === previousCascade.cascade_sha256 && event.event_type === "AUDIT_REPAIR_CONVERGENCE", "cascade convergence readback is detached from its predecessor");
  assert(event.payload.central_intake_sha256 === centralManifest.manifest_sha256 && event.payload.repair_dag_sha256 === centralManifest.repair_dag_sha256 && event.payload.convergence_ledger_sha256 === centralManifest.convergence_ledger_sha256, "cascade convergence readback does not bind the exact Central manifest");
  return completedCascade;
}

export function validateAuditRepairConvergenceBinding(binding, {repositoryRoot, readFile, sha256File}) {
  exactKeys(binding, ["schema", "version", "status", "kernel_version", "files", "dependencies", "invalidation_rule", "migration_ref", "binding_sha256"], "audit-repair convergence binding");
  assert(binding.schema === CONVERGENCE_BINDING_SCHEMA && binding.version === 1 && binding.status === "PORTABLE_CANDIDATE_INACTIVE", "audit-repair convergence binding identity is invalid");
  requireString(binding.kernel_version, "audit-repair convergence kernel version");
  assert(Array.isArray(binding.files) && binding.files.length > 0, "audit-repair convergence binding files are required");
  const paths = binding.files.map((entry) => entry.path);
  sortedUnique(paths, "audit-repair convergence binding paths", {allowEmpty: false});
  for (const entry of binding.files) {
    requireSha(entry.sha256, `audit-repair convergence binding ${entry.path}`);
    assert(readFile(repositoryRoot, entry.path), `audit-repair convergence binding file is missing: ${entry.path}`);
    assert(sha256File(repositoryRoot, entry.path) === entry.sha256, `audit-repair convergence binding digest mismatch: ${entry.path}`);
  }
  assert(Array.isArray(binding.dependencies) && binding.dependencies.length === 2, "audit-repair convergence dependencies are incomplete");
  requireString(binding.invalidation_rule, "audit-repair convergence invalidation rule");
  requireString(binding.migration_ref, "audit-repair convergence migration ref");
  requireSha(binding.binding_sha256, "audit-repair convergence binding digest");
  assert(binding.binding_sha256 === digestWithout(binding, "binding_sha256"), "audit-repair convergence binding digest mismatch");
  return binding;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(`${JSON.stringify({schema: CONVERGENCE_BINDING_SCHEMA, status: "PORTABLE_CANDIDATE_INACTIVE", mutation: "NONE", activation: "OFF"}, null, 2)}\n`);
}
