#!/usr/bin/env node

import {
  APPRENTICESHIP_MODE,
  APPRENTICESHIP_VERSION,
  REQUIRED_WORKER_PROHIBITIONS,
  assert,
  assertDistinctReferences,
  assertNonActivating,
  assertPortableRecord,
  canonicalJson,
  clone,
  compileProvenance,
  exactKeys,
  nonEmptyArray,
  protectedActions,
  requireIdentifier,
  requireSafeReference,
  requireSha256,
  requireString,
  sameBinding,
  uniqueStrings,
  validateConsentDecision,
  validateDigest,
  validateEvidenceRefs,
  validateProvenance,
  validateProtectedActions,
  validateRevocationState,
  validateTimestamp,
  validateWorkerProhibitions,
  withDigest,
} from "./apprenticeship-common.mjs";
import {
  GOVERNANCE_PROPOSAL_SCHEMA,
  compileTaskObservation,
  validateGateSource,
  validateGovernanceProposalForUse,
  validateTaskObservation,
} from "./apprenticeship-observation.mjs";
import {
  WORKFLOW_AUDITOR_DRILL_SCHEMA,
  validateWorkflowDrill,
} from "./apprenticeship-drill.mjs";

export const REPRODUCTION_PACKET_SCHEMA = "agentos.apprenticeship_reproduction_packet.v1";
export const REPRODUCTION_RESULT_SCHEMA = "agentos.apprenticeship_reproduction_result.v1";
export const INDEPENDENT_REVIEW_SCHEMA = "agentos.apprenticeship_independent_review.v1";
export const OWNER_DECISION_SCHEMA = "agentos.apprenticeship_owner_decision.v1";
export const HANDOFF_SCHEMA = "agentos.apprenticeship_handoff.v1";

const REPRODUCTION_RESULT_KINDS = Object.freeze([
  "MEANINGFUL_RESULT",
  "HEARTBEAT_ONLY",
  "WAITING",
  "FAILURE_LIST",
  "TRUE_BLOCKER",
  "NO_RESULT",
]);
const REVIEW_VERDICTS = Object.freeze(["ACCEPT_FOR_OWNER_REVIEW", "REJECT", "REPAIR_REQUIRED"]);
const REVIEW_CHECK_STATUSES = Object.freeze(["PASS", "FAIL", "UNKNOWN"]);
const OWNER_DECISIONS = Object.freeze([
  "RETAIN_INACTIVE",
  "REQUEST_REPAIR",
  "REJECT",
  "APPROVE_INTENT_AUTHORITY_CHANGE",
]);

function validatePacketRoleBehavior(value, {boundedScope = null, observedTools = null} = {}) {
  exactKeys(value, [
    "role_id",
    "scope",
    "authority",
    "prohibited_actions",
    "admitted_tools",
    "evidence_requirements",
    "failure_paths",
    "done_when",
  ], "reproduction packet role behavior");
  requireIdentifier(value.role_id, "reproduction packet role ID");
  assert(value.role_id === "APPRENTICESHIP_WORKER", "reproduction packet role is invalid");
  uniqueStrings(value.scope, "reproduction packet scope");
  if (boundedScope !== null) {
    assert(JSON.stringify([...value.scope].sort()) === JSON.stringify([...boundedScope].sort()), "reproduction packet role scope expands the bounded workflow");
  }
  uniqueStrings(value.authority, "reproduction packet authority", {allowEmpty: true});
  validateWorkerProhibitions(value.prohibited_actions, "reproduction packet prohibited actions");
  uniqueStrings(value.admitted_tools, "reproduction packet admitted tools", {allowEmpty: true});
  if (observedTools !== null) {
    const observed = new Set(observedTools);
    value.admitted_tools.forEach((tool) => assert(observed.has(tool), `reproduction packet admitted tool ${tool} was not observed`));
  }
  uniqueStrings(value.evidence_requirements, "reproduction packet evidence requirements");
  uniqueStrings(value.failure_paths, "reproduction packet failure paths", {allowEmpty: true});
  requireString(value.done_when, "reproduction packet DONE WHEN");
  REQUIRED_WORKER_PROHIBITIONS.forEach((prohibition) => {
    assert(!value.authority.includes(prohibition), `reproduction packet authority cannot include ${prohibition}`);
  });
  assertPortableRecord(value, "reproduction packet role behavior");
}

function validatePacketGateSource(value) {
  validateGateSource(value);
}

export function compileReproductionPacket({
  packetId,
  proposal,
  drill,
  provenance,
  createdAt,
} = {}) {
  requireIdentifier(packetId, "reproduction packet ID");
  validateGovernanceProposalForUse(proposal);
  validateWorkflowDrill(drill);
  assert(drill.status === "CLOSED_NON_ACCEPTING" && drill.final_status === "DRILL_COMPLETE_NON_ACCEPTING", "reproduction requires a closed complete non-accepting drill");
  validateProvenance(provenance, {
    requiredRefs: ["worker_ref", "worker_session_ref", "orchestrator_ref", "orchestrator_session_ref", "learner_ref", "learner_session_ref", "auditor_ref", "auditor_session_ref", "reproduction_ref", "reproduction_session_ref", "model_ref"],
  });
  assert(sameBinding(provenance, drill.provenance), "reproduction packet provenance differs from the drill binding");
  assert(provenance.reproduction_ref !== provenance.learner_ref, "reproduction worker must be fresh");
  assert(provenance.reproduction_session_ref !== provenance.learner_session_ref, "reproduction session must be fresh");
  assertDistinctReferences([provenance.reproduction_ref, provenance.auditor_ref, provenance.orchestrator_ref], "reproduction role identities");
  assertDistinctReferences([provenance.reproduction_session_ref, provenance.auditor_session_ref, provenance.orchestrator_session_ref], "reproduction session identities");
  validateTimestamp(createdAt, "reproduction packet creation timestamp");
  const packet = withDigest({
    schema: REPRODUCTION_PACKET_SCHEMA,
    version: APPRENTICESHIP_VERSION,
    mode: APPRENTICESHIP_MODE,
    packet_id: packetId,
    status: proposal.revocation.status === "REVOKED" ? "REVOKED" : "READY_FOR_REPRODUCTION",
    proposal_digest: proposal.digest,
    drill_digest: drill.digest,
    provenance: clone(provenance),
    fresh_worker: {
      worker_ref: provenance.reproduction_ref,
      session_ref: provenance.reproduction_session_ref,
      role: "APPRENTICESHIP_WORKER",
    },
    task_pattern: proposal.task_pattern,
    bounded_scope: [...proposal.bounded_scope],
    consent: clone(proposal.consent),
    observed_tools: [...proposal.observed_tools],
    revocation: clone(proposal.revocation),
    role_behavior: clone(proposal.role_behavior),
    gate_source: clone(proposal.gate_source),
    evidence_requirements: [...proposal.role_behavior.evidence_requirements],
    prohibited_actions: [...proposal.role_behavior.prohibited_actions],
    done_when: proposal.role_behavior.done_when,
    fresh_context: {
      learner_transcript_included: false,
      hidden_reasoning_included: false,
      private_context_included: false,
      unrelated_project_context_included: false,
    },
    activation_allowed: false,
    created_at: createdAt,
    protected_actions: protectedActions(),
    digest: null,
  });
  validateReproductionPacket(packet, {proposal, drill});
  return packet;
}

export function validateReproductionPacket(packet, {proposal = null, drill = null} = {}) {
  exactKeys(packet, [
    "schema",
    "version",
    "mode",
    "packet_id",
    "status",
    "proposal_digest",
    "drill_digest",
    "provenance",
    "fresh_worker",
    "task_pattern",
    "bounded_scope",
    "consent",
    "observed_tools",
    "revocation",
    "role_behavior",
    "gate_source",
    "evidence_requirements",
    "prohibited_actions",
    "done_when",
    "fresh_context",
    "activation_allowed",
    "created_at",
    "protected_actions",
    "digest",
  ], "reproduction packet");
  assert(packet.schema === REPRODUCTION_PACKET_SCHEMA && packet.version === APPRENTICESHIP_VERSION, "reproduction packet identity is invalid");
  assert(packet.mode === APPRENTICESHIP_MODE, "reproduction packet mode is invalid");
  requireIdentifier(packet.packet_id, "reproduction packet ID");
  assert(["READY_FOR_REPRODUCTION", "REVOKED"].includes(packet.status), "reproduction packet status is invalid");
  requireSha256(packet.proposal_digest, "reproduction packet proposal digest");
  requireSha256(packet.drill_digest, "reproduction packet drill digest");
  if (proposal !== null) {
    validateGovernanceProposalForUse(proposal);
    assert(packet.proposal_digest === proposal.digest, "reproduction packet proposal binding differs");
  }
  if (drill !== null) {
    validateWorkflowDrill(drill);
    assert(packet.drill_digest === drill.digest, "reproduction packet drill binding differs");
    assert(sameBinding(packet.provenance, drill.provenance), "reproduction packet provenance differs from drill");
    assert(packet.provenance.reproduction_ref !== packet.provenance.learner_ref, "reproduction packet worker is not fresh");
    assert(packet.provenance.reproduction_session_ref !== packet.provenance.learner_session_ref, "reproduction packet session is not fresh");
  }
  validateProvenance(packet.provenance, {
    requiredRefs: ["worker_ref", "worker_session_ref", "orchestrator_ref", "orchestrator_session_ref", "learner_ref", "learner_session_ref", "auditor_ref", "auditor_session_ref", "reproduction_ref", "reproduction_session_ref", "model_ref"],
  });
  exactKeys(packet.fresh_worker, ["worker_ref", "session_ref", "role"], "reproduction packet fresh worker");
  requireSafeReference(packet.fresh_worker.worker_ref, "reproduction packet fresh worker reference");
  requireSafeReference(packet.fresh_worker.session_ref, "reproduction packet fresh session reference");
  assert(packet.fresh_worker.worker_ref === packet.provenance.reproduction_ref, "reproduction packet fresh worker binding differs");
  assert(packet.fresh_worker.session_ref === packet.provenance.reproduction_session_ref, "reproduction packet fresh session binding differs");
  assert(packet.fresh_worker.role === "APPRENTICESHIP_WORKER", "reproduction packet fresh worker role is invalid");
  requireString(packet.task_pattern, "reproduction packet task pattern");
  nonEmptyArray(packet.bounded_scope, "reproduction packet bounded scope");
  uniqueStrings(packet.bounded_scope, "reproduction packet bounded scope");
  validateConsentDecision(packet.consent, "reproduction packet consent decision");
  if (proposal !== null) assert(JSON.stringify(packet.consent) === JSON.stringify(proposal.consent), "reproduction packet consent binding differs");
  uniqueStrings(packet.observed_tools, "reproduction packet observed tools");
  if (proposal !== null) assert(JSON.stringify(packet.observed_tools) === JSON.stringify(proposal.observed_tools), "reproduction packet observed tools binding differs");
  validateRevocationState(packet.revocation, "reproduction packet revocation state");
  assert(packet.status === (packet.revocation.status === "REVOKED" ? "REVOKED" : "READY_FOR_REPRODUCTION"), "reproduction packet revocation/status binding is invalid");
  if (proposal !== null) assert(JSON.stringify(packet.revocation) === JSON.stringify(proposal.revocation), "reproduction packet revocation binding differs");
  validatePacketRoleBehavior(packet.role_behavior, {boundedScope: packet.bounded_scope, observedTools: packet.observed_tools});
  validatePacketGateSource(packet.gate_source);
  uniqueStrings(packet.evidence_requirements, "reproduction packet evidence requirements");
  uniqueStrings(packet.prohibited_actions, "reproduction packet prohibited actions");
  requireString(packet.done_when, "reproduction packet DONE WHEN");
  assert(JSON.stringify(packet.evidence_requirements) === JSON.stringify(packet.role_behavior.evidence_requirements), "reproduction packet evidence requirements are detached from role behavior");
  assert(JSON.stringify(packet.prohibited_actions) === JSON.stringify(packet.role_behavior.prohibited_actions), "reproduction packet prohibitions are detached from role behavior");
  assert(packet.done_when === packet.role_behavior.done_when, "reproduction packet DONE WHEN is detached from role behavior");
  exactKeys(packet.fresh_context, [
    "learner_transcript_included",
    "hidden_reasoning_included",
    "private_context_included",
    "unrelated_project_context_included",
  ], "reproduction packet fresh context");
  Object.values(packet.fresh_context).forEach((value) => assert(value === false, "reproduction packet includes forbidden learner context"));
  assert(packet.activation_allowed === false, "reproduction packet cannot allow activation");
  validateTimestamp(packet.created_at, "reproduction packet creation timestamp");
  validateProtectedActions(packet.protected_actions);
  assertNonActivating(packet, "reproduction packet");
  assertPortableRecord(packet, "reproduction packet");
  validateDigest(packet, "reproduction packet");
  return packet;
}

function validateGateResponse(response, index, packet) {
  exactKeys(response, ["sequence", "gate_id", "answer", "evidence_refs", "evidence_sha256", "binding_match", "comparison_status"], `reproduction gate response ${index}`);
  assert(Number.isSafeInteger(response.sequence) && response.sequence === index + 1, `reproduction gate response ${index} sequence is invalid`);
  const gate = packet.gate_source.gates[index];
  assert(gate !== undefined && response.gate_id === gate.gate_id, `reproduction gate response ${index} gate binding differs`);
  assert(gate.allowed_answers.includes(response.answer), `reproduction gate response ${index} answer is not allowed`);
  validateEvidenceRefs(response.evidence_refs, `reproduction gate response ${index} evidence`, {allowEmpty: true});
  if (response.evidence_sha256 !== null) requireSha256(response.evidence_sha256, `reproduction gate response ${index} evidence digest`);
  assert(typeof response.binding_match === "boolean", `reproduction gate response ${index} binding flag is invalid`);
  assert(["MATCHED", "UNKNOWN", "MISMATCH", "INCOMPLETE"].includes(response.comparison_status), `reproduction gate response ${index} comparison is invalid`);
  if (response.answer === "ANSWERED") {
    assert(response.evidence_refs.length > 0, `reproduction gate response ${index} answered gate requires evidence`);
    assert(response.evidence_sha256 !== null, `reproduction gate response ${index} answered gate requires an evidence digest`);
  }
  if (response.comparison_status === "MATCHED") {
    assert(response.answer === "ANSWERED", `reproduction gate response ${index} matched comparison requires an answered gate`);
    assert(response.binding_match === true, `reproduction gate response ${index} matched comparison requires a matching binding`);
  }
  assertPortableRecord(response, `reproduction gate response ${index}`);
}

export function compileReproductionResult({
  packet,
  resultId,
  actionRecords,
  resultKind,
  resultRef,
  resultSummary,
  evidenceRefs,
  typedHandoff,
  gateResponses,
  completedAt,
} = {}) {
  requireIdentifier(resultId, "reproduction result ID");
  validateReproductionPacket(packet);
  assert(packet.revocation.status === "NOT_REVOKED", "revoked reproduction packet cannot run");
  assert(REPRODUCTION_RESULT_KINDS.includes(resultKind), "reproduction result kind is invalid");
  requireSafeReference(resultRef, "reproduction result reference");
  requireString(resultSummary, "reproduction result summary");
  validateEvidenceRefs(evidenceRefs, "reproduction result evidence", {allowEmpty: true});
  nonEmptyArray(actionRecords, "reproduction action records");
  assert(Array.isArray(gateResponses) && gateResponses.length === packet.gate_source.gates.length, "reproduction gate coverage is incomplete");
  gateResponses.forEach((response, index) => validateGateResponse(response, index, packet));
  validateTimestamp(completedAt, "reproduction completion timestamp");
  const reproductionProvenance = clone(packet.provenance);
  reproductionProvenance.worker_ref = packet.provenance.reproduction_ref;
  reproductionProvenance.worker_session_ref = packet.provenance.reproduction_session_ref;
  const observation = compileTaskObservation({
    observationId: `${resultId}_OBSERVATION`,
    provenance: reproductionProvenance,
    taskPattern: packet.task_pattern,
    boundedScope: packet.bounded_scope,
    actionRecords,
    resultKind,
    resultRef,
    resultSummary,
    evidenceRefs,
    typedHandoff,
    consentRequired: packet.consent.required,
    consentRef: packet.consent.reference,
    sourceMatch: gateResponses.every((response) => response.binding_match),
    scopeMatch: gateResponses.every((response) => response.comparison_status === "MATCHED"),
    observedAt: completedAt,
    completedAt,
  });
  const reproduced = observation.meaningful_progress
    && gateResponses.every((response) => response.answer === "ANSWERED" && response.binding_match === true && response.comparison_status === "MATCHED");
  const result = withDigest({
    schema: REPRODUCTION_RESULT_SCHEMA,
    version: APPRENTICESHIP_VERSION,
    result_id: resultId,
    packet_digest: packet.digest,
    status: reproduced ? "REPRODUCED" : "REPRODUCTION_FAILED",
    provenance: reproductionProvenance,
    observation: clone(observation),
    gate_responses: clone(gateResponses),
    result_kind: resultKind,
    meaningful_progress: reproduced,
    failure_reason: reproduced ? null : "REPRODUCTION_DIVERGED_OR_NOT_MEANINGFUL",
    protected_actions: protectedActions(),
    digest: null,
  });
  validateReproductionResult(result, {packet});
  return result;
}

export function validateReproductionResult(result, {packet = null} = {}) {
  exactKeys(result, [
    "schema",
    "version",
    "result_id",
    "packet_digest",
    "status",
    "provenance",
    "observation",
    "gate_responses",
    "result_kind",
    "meaningful_progress",
    "failure_reason",
    "protected_actions",
    "digest",
  ], "reproduction result");
  assert(result.schema === REPRODUCTION_RESULT_SCHEMA && result.version === APPRENTICESHIP_VERSION, "reproduction result identity is invalid");
  requireIdentifier(result.result_id, "reproduction result ID");
  requireSha256(result.packet_digest, "reproduction packet digest");
  if (packet !== null) {
    validateReproductionPacket(packet);
    assert(packet.revocation.status === "NOT_REVOKED", "revoked reproduction packet cannot validate a result");
    assert(result.packet_digest === packet.digest, "reproduction result packet binding differs");
    assert(sameBinding(result.provenance, packet.provenance), "reproduction result provenance differs from packet");
    assert(result.provenance.worker_ref === packet.provenance.reproduction_ref, "reproduction result worker is not the packet worker");
    assert(result.provenance.worker_session_ref === packet.provenance.reproduction_session_ref, "reproduction result session is not the packet session");
  }
  assert(["REPRODUCED", "REPRODUCTION_FAILED"].includes(result.status), "reproduction result status is invalid");
  validateProvenance(result.provenance, {requiredRefs: ["worker_ref", "worker_session_ref", "orchestrator_ref", "orchestrator_session_ref", "learner_ref", "learner_session_ref", "auditor_ref", "auditor_session_ref", "reproduction_ref", "reproduction_session_ref", "model_ref"]});
  assert(result.provenance.worker_ref === result.provenance.reproduction_ref, "reproduction result worker binding differs");
  assert(result.provenance.worker_session_ref === result.provenance.reproduction_session_ref, "reproduction result session binding differs");
  ["learner_ref", "auditor_ref", "orchestrator_ref"].forEach((field) => {
    if (result.provenance[field] !== null) assert(result.provenance.worker_ref !== result.provenance[field], `reproduction result worker reuses ${field}`);
  });
  ["learner_session_ref", "auditor_session_ref", "orchestrator_session_ref"].forEach((field) => {
    if (result.provenance[field] !== null) assert(result.provenance.worker_session_ref !== result.provenance[field], `reproduction result session reuses ${field}`);
  });
  validateTaskObservation(result.observation);
  assert(result.observation.provenance.worker_ref === result.provenance.worker_ref, "reproduction observation worker differs");
  assert(Array.isArray(result.gate_responses) && result.gate_responses.length > 0, "reproduction gate responses are required");
  if (packet !== null) result.gate_responses.forEach((response, index) => validateGateResponse(response, index, packet));
  assert(REPRODUCTION_RESULT_KINDS.includes(result.result_kind), "reproduction result kind is invalid");
  assert(typeof result.meaningful_progress === "boolean", "reproduction progress flag is invalid");
  assert(result.meaningful_progress === (result.status === "REPRODUCED"), "reproduction status and progress differ");
  if (result.status === "REPRODUCED") assert(result.failure_reason === null, "successful reproduction cannot carry a failure reason");
  else requireString(result.failure_reason, "reproduction failure reason");
  validateProtectedActions(result.protected_actions);
  assertNonActivating(result, "reproduction result");
  assertPortableRecord(result, "reproduction result");
  validateDigest(result, "reproduction result");
  return result;
}

function validateReviewChecks(checks) {
  exactKeys(checks, ["process_fidelity", "boundary_compliance", "evidence_completeness", "outcome", "provenance", "quality"], "independent review checks");
  Object.entries(checks).forEach(([key, value]) => {
    assert(REVIEW_CHECK_STATUSES.includes(value), `independent review check ${key} is invalid`);
  });
}

export function compileIndependentReview({
  reviewId,
  reviewRef,
  packet,
  proposal,
  drill,
  reproduction,
  provenance,
  verdict,
  checks,
  findings = [],
  reviewedAt,
} = {}) {
  requireIdentifier(reviewId, "independent review ID");
  requireSafeReference(reviewRef, "independent review reference");
  validateReproductionPacket(packet);
  assert(packet.revocation.status === "NOT_REVOKED", "revoked reproduction packet cannot receive independent review");
  validateGovernanceProposalForUse(proposal);
  validateWorkflowDrill(drill);
  validateReproductionResult(reproduction, {packet});
  assert(drill.status === "CLOSED_NON_ACCEPTING", "independent review requires a closed drill");
  validateProvenance(provenance, {
    requiredRefs: ["worker_ref", "worker_session_ref", "orchestrator_ref", "orchestrator_session_ref", "learner_ref", "learner_session_ref", "auditor_ref", "auditor_session_ref", "reproduction_ref", "reproduction_session_ref", "reviewer_ref", "reviewer_session_ref", "model_ref"],
  });
  assert(sameBinding(provenance, proposal.provenance), "independent review provenance differs from proposal");
  assert(provenance.reviewer_ref !== proposal.author.worker_ref, "independent reviewer cannot be the worker");
  assert(provenance.reviewer_ref !== proposal.compiled_by.orchestrator_ref, "independent reviewer cannot be the compiler");
  assert(provenance.reviewer_ref !== drill.provenance.auditor_ref, "independent reviewer cannot be the Workflow Auditor");
  assert(provenance.reviewer_ref !== reproduction.provenance.reproduction_ref, "independent reviewer cannot be the reproducing worker");
  assertDistinctReferences([
    provenance.reviewer_ref,
    proposal.author.worker_ref,
    proposal.compiled_by.orchestrator_ref,
    drill.provenance.auditor_ref,
    reproduction.provenance.reproduction_ref,
  ], "independent review identities");
  assertDistinctReferences([
    provenance.reviewer_session_ref,
    proposal.provenance.worker_session_ref,
    proposal.provenance.orchestrator_session_ref,
    drill.provenance.auditor_session_ref,
    reproduction.provenance.reproduction_session_ref,
  ], "independent review sessions");
  assert(REVIEW_VERDICTS.includes(verdict), "independent review verdict is invalid");
  validateReviewChecks(checks);
  uniqueStrings(findings, "independent review findings", {allowEmpty: true});
  validateTimestamp(reviewedAt, "independent review timestamp");
  if (verdict === "ACCEPT_FOR_OWNER_REVIEW") {
    assert(reproduction.status === "REPRODUCED", "a non-reproduced result cannot reach owner review");
    Object.values(checks).forEach((value) => assert(value === "PASS", "owner-review recommendation requires every independent check to pass"));
  }
  const review = withDigest({
    schema: INDEPENDENT_REVIEW_SCHEMA,
    version: APPRENTICESHIP_VERSION,
    review_id: reviewId,
    review_ref: reviewRef,
    status: "COMPLETED",
    verdict,
    reviewer_role: "INDEPENDENT_AUDITOR",
    proposal_digest: proposal.digest,
    drill_digest: drill.digest,
    packet_digest: packet.digest,
    reproduction_digest: reproduction.digest,
    provenance: clone(provenance),
    checks: clone(checks),
    findings: [...findings],
    owner_approval: null,
    activation_allowed: false,
    reviewed_at: reviewedAt,
    protected_actions: protectedActions(),
    digest: null,
  });
  validateIndependentReview(review, {proposal, drill, packet, reproduction});
  return review;
}

export function validateIndependentReview(review, {proposal = null, drill = null, packet = null, reproduction = null} = {}) {
  exactKeys(review, [
    "schema",
    "version",
    "review_id",
    "review_ref",
    "status",
    "verdict",
    "reviewer_role",
    "proposal_digest",
    "drill_digest",
    "packet_digest",
    "reproduction_digest",
    "provenance",
    "checks",
    "findings",
    "owner_approval",
    "activation_allowed",
    "reviewed_at",
    "protected_actions",
    "digest",
  ], "independent review");
  assert(review.schema === INDEPENDENT_REVIEW_SCHEMA && review.version === APPRENTICESHIP_VERSION, "independent review identity is invalid");
  requireIdentifier(review.review_id, "independent review ID");
  requireSafeReference(review.review_ref, "independent review reference");
  assert(review.status === "COMPLETED", "independent review status is invalid");
  assert(REVIEW_VERDICTS.includes(review.verdict), "independent review verdict is invalid");
  assert(review.reviewer_role === "INDEPENDENT_AUDITOR", "independent review role is invalid");
  requireSha256(review.proposal_digest, "independent review proposal digest");
  requireSha256(review.drill_digest, "independent review drill digest");
  requireSha256(review.packet_digest, "independent review packet digest");
  requireSha256(review.reproduction_digest, "independent review reproduction digest");
  if (proposal !== null) {
    validateGovernanceProposalForUse(proposal);
    assert(review.proposal_digest === proposal.digest, "independent review proposal binding differs");
  }
  if (drill !== null) {
    validateWorkflowDrill(drill);
    assert(review.drill_digest === drill.digest, "independent review drill binding differs");
  }
  if (packet !== null) {
    validateReproductionPacket(packet);
    assert(packet.revocation.status === "NOT_REVOKED", "revoked reproduction packet cannot receive independent review");
    assert(review.packet_digest === packet.digest, "independent review packet binding differs");
  }
  if (reproduction !== null) {
    validateReproductionResult(reproduction, {packet});
    assert(review.packet_digest === reproduction.packet_digest, "independent review packet binding differs from reproduction");
    assert(review.reproduction_digest === reproduction.digest, "independent review reproduction binding differs");
  }
  validateProvenance(review.provenance, {requiredRefs: ["worker_ref", "worker_session_ref", "orchestrator_ref", "orchestrator_session_ref", "learner_ref", "learner_session_ref", "auditor_ref", "auditor_session_ref", "reproduction_ref", "reproduction_session_ref", "reviewer_ref", "reviewer_session_ref", "model_ref"]});
  ["worker_ref", "learner_ref", "orchestrator_ref", "auditor_ref", "reproduction_ref"].forEach((field) => {
    if (review.provenance[field] !== null) assert(review.provenance.reviewer_ref !== review.provenance[field], `independent reviewer reuses ${field}`);
  });
  ["worker_session_ref", "learner_session_ref", "orchestrator_session_ref", "auditor_session_ref", "reproduction_session_ref"].forEach((field) => {
    if (review.provenance[field] !== null) assert(review.provenance.reviewer_session_ref !== review.provenance[field], `independent reviewer session reuses ${field}`);
  });
  if (proposal !== null) {
    assert(sameBinding(review.provenance, proposal.provenance), "independent review provenance differs from proposal");
    assert(review.provenance.reviewer_ref !== proposal.author.worker_ref, "independent reviewer cannot be the worker");
    assert(review.provenance.reviewer_ref !== proposal.compiled_by.orchestrator_ref, "independent reviewer cannot be the compiler");
    assert(review.provenance.reviewer_session_ref !== proposal.provenance.worker_session_ref, "independent reviewer session cannot be the worker session");
    assert(review.provenance.reviewer_session_ref !== proposal.provenance.orchestrator_session_ref, "independent reviewer session cannot be the compiler session");
  }
  if (drill !== null) {
    assert(review.provenance.reviewer_ref !== drill.provenance.auditor_ref, "independent reviewer cannot be the Workflow Auditor");
    assert(review.provenance.reviewer_session_ref !== drill.provenance.auditor_session_ref, "independent reviewer session cannot be the Workflow Auditor session");
  }
  if (reproduction !== null) {
    assert(review.provenance.reviewer_ref !== reproduction.provenance.reproduction_ref, "independent reviewer cannot be the reproducing worker");
    assert(review.provenance.reviewer_session_ref !== reproduction.provenance.reproduction_session_ref, "independent reviewer session cannot be the reproducing session");
  }
  validateReviewChecks(review.checks);
  uniqueStrings(review.findings, "independent review findings", {allowEmpty: true});
  assert(review.owner_approval === null || typeof review.owner_approval === "object", "independent review owner approval is invalid");
  assert(review.activation_allowed === false, "independent review cannot allow activation");
  validateTimestamp(review.reviewed_at, "independent review timestamp");
  validateProtectedActions(review.protected_actions);
  assertNonActivating(review, "independent review");
  assertPortableRecord(review, "independent review");
  validateDigest(review, "independent review");
  return review;
}

export function compileOwnerDecision({
  decisionId,
  decisionRef,
  proposal,
  review,
  ownerRef,
  decision,
  intentOrAuthorityChange,
  decidedAt,
} = {}) {
  requireIdentifier(decisionId, "owner decision ID");
  requireSafeReference(decisionRef, "owner decision reference");
  validateGovernanceProposalForUse(proposal);
  validateIndependentReview(review, {proposal});
  requireSafeReference(ownerRef, "owner reference");
  assert(OWNER_DECISIONS.includes(decision), "owner decision is invalid");
  assert(typeof intentOrAuthorityChange === "boolean", "owner decision change flag is invalid");
  if (decision === "APPROVE_INTENT_AUTHORITY_CHANGE") assert(intentOrAuthorityChange === true, "approval decision requires an intent or authority change flag");
  if (intentOrAuthorityChange) {
    assert(decision === "APPROVE_INTENT_AUTHORITY_CHANGE", "intent or authority changes require explicit owner approval");
    assert(review.verdict === "ACCEPT_FOR_OWNER_REVIEW", "intent or authority approval requires an independent owner-review recommendation");
  }
  validateTimestamp(decidedAt, "owner decision timestamp");
  const ownerDecision = withDigest({
    schema: OWNER_DECISION_SCHEMA,
    version: APPRENTICESHIP_VERSION,
    decision_id: decisionId,
    decision_ref: decisionRef,
    status: "RECORDED_NOT_ACTIVATED",
    proposal_digest: proposal.digest,
    independent_review_ref: review.review_ref,
    owner_ref: ownerRef,
    decision,
    intent_or_authority_change: intentOrAuthorityChange,
    explicit: true,
    activation_allowed: false,
    decided_at: decidedAt,
    protected_actions: protectedActions(),
    digest: null,
  });
  validateOwnerDecision(ownerDecision, {proposal, review});
  return ownerDecision;
}

export function validateOwnerDecision(decision, {proposal = null, review = null} = {}) {
  exactKeys(decision, [
    "schema",
    "version",
    "decision_id",
    "decision_ref",
    "status",
    "proposal_digest",
    "independent_review_ref",
    "owner_ref",
    "decision",
    "intent_or_authority_change",
    "explicit",
    "activation_allowed",
    "decided_at",
    "protected_actions",
    "digest",
  ], "owner decision");
  assert(decision.schema === OWNER_DECISION_SCHEMA && decision.version === APPRENTICESHIP_VERSION, "owner decision identity is invalid");
  requireIdentifier(decision.decision_id, "owner decision ID");
  requireSafeReference(decision.decision_ref, "owner decision reference");
  assert(decision.status === "RECORDED_NOT_ACTIVATED", "owner decision status is invalid");
  requireSha256(decision.proposal_digest, "owner decision proposal digest");
  requireSafeReference(decision.independent_review_ref, "owner decision review reference");
  requireSafeReference(decision.owner_ref, "owner decision owner reference");
  assert(OWNER_DECISIONS.includes(decision.decision), "owner decision value is invalid");
  assert(typeof decision.intent_or_authority_change === "boolean", "owner decision change flag is invalid");
  if (decision.decision === "APPROVE_INTENT_AUTHORITY_CHANGE") assert(decision.intent_or_authority_change === true, "approval decision requires an intent or authority change flag");
  if (decision.intent_or_authority_change) assert(decision.decision === "APPROVE_INTENT_AUTHORITY_CHANGE", "owner decision does not explicitly approve the authority change");
  assert(decision.explicit === true, "owner decision must be explicit");
  assert(decision.activation_allowed === false, "owner decision cannot activate a proposal");
  if (proposal !== null) {
    validateGovernanceProposalForUse(proposal);
    assert(decision.proposal_digest === proposal.digest, "owner decision proposal binding differs");
  }
  if (review !== null) {
    validateIndependentReview(review, {proposal});
    assert(decision.independent_review_ref === review.review_ref, "owner decision review binding differs");
    if (decision.intent_or_authority_change) assert(review.verdict === "ACCEPT_FOR_OWNER_REVIEW", "owner decision cannot approve a rejected proposal");
  }
  validateTimestamp(decision.decided_at, "owner decision timestamp");
  validateProtectedActions(decision.protected_actions);
  assertNonActivating(decision, "owner decision");
  assertPortableRecord(decision, "owner decision");
  validateDigest(decision, "owner decision");
  return decision;
}

export function compileApprenticeshipHandoff({
  handoffId,
  proposal,
  drill,
  packet,
  reproduction,
  review,
  ownerDecision = null,
  nextAction,
  uncertainty = [],
  hostileFindings = [],
  createdAt,
} = {}) {
  requireIdentifier(handoffId, "apprenticeship handoff ID");
  validateGovernanceProposalForUse(proposal);
  validateWorkflowDrill(drill);
  validateReproductionPacket(packet);
  assert(packet.revocation.status === "NOT_REVOKED", "revoked reproduction packet cannot be handed off");
  validateReproductionResult(reproduction);
  validateIndependentReview(review, {packet});
  assert(drill.status === "CLOSED_NON_ACCEPTING", "handoff requires a closed drill");
  if (ownerDecision !== null) validateOwnerDecision(ownerDecision, {proposal, review});
  assert(sameBinding(reproduction.provenance, proposal.provenance), "handoff reproduction provenance differs from proposal");
  assert(review.proposal_digest === proposal.digest && review.drill_digest === drill.digest && review.packet_digest === packet.digest && review.reproduction_digest === reproduction.digest, "handoff review bindings differ");
  requireString(nextAction, "apprenticeship handoff next action");
  uniqueStrings(uncertainty, "apprenticeship handoff uncertainty", {allowEmpty: true});
  uniqueStrings(hostileFindings, "apprenticeship handoff hostile findings", {allowEmpty: true});
  validateTimestamp(createdAt, "apprenticeship handoff creation timestamp");
  const acceptedForOwner = review.verdict === "ACCEPT_FOR_OWNER_REVIEW" && reproduction.status === "REPRODUCED";
  const explicitActivationApproval = ownerDecision?.decision === "APPROVE_INTENT_AUTHORITY_CHANGE" && ownerDecision.intent_or_authority_change === true;
  const status = !acceptedForOwner || ["REQUEST_REPAIR", "REJECT"].includes(ownerDecision?.decision)
    ? "REPAIR_REQUIRED"
    : explicitActivationApproval
      ? "OWNER_APPROVED_PENDING_ACTIVATION"
      : "OWNER_REVIEW_REQUIRED";
  const handoffProvenance = clone(proposal.provenance);
  handoffProvenance.reproduction_ref = reproduction.provenance.reproduction_ref;
  handoffProvenance.reproduction_session_ref = reproduction.provenance.reproduction_session_ref;
  const handoff = withDigest({
    schema: HANDOFF_SCHEMA,
    version: APPRENTICESHIP_VERSION,
    mode: APPRENTICESHIP_MODE,
    handoff_id: handoffId,
    status,
    proposal_digest: proposal.digest,
    drill_digest: drill.digest,
    packet_digest: packet.digest,
    reproduction_digest: reproduction.digest,
    review_ref: review.review_ref,
    owner_decision_ref: ownerDecision?.decision_ref ?? null,
    task_identity: {
      project_ref: proposal.provenance.project_ref,
      campaign_ref: proposal.provenance.campaign_ref,
      goal_ref: proposal.provenance.goal_ref,
      worker_session_ref: proposal.provenance.worker_session_ref,
      reproduction_session_ref: reproduction.provenance.reproduction_session_ref,
    },
    project_binding: {
      project_ref: proposal.provenance.project_ref,
      campaign_ref: proposal.provenance.campaign_ref,
      goal_ref: proposal.provenance.goal_ref,
      workspace_ref: proposal.provenance.workspace_ref,
    },
    source_identity: {
      source_ref: proposal.provenance.source_ref,
      tree_ref: proposal.provenance.tree_ref,
      environment_ref: proposal.provenance.environment_ref,
    },
    provenance: handoffProvenance,
    question_records: clone(drill.question_records),
    comparison_records: clone(drill.comparison_records),
    hostile_findings: [...hostileFindings],
    uncertainty: [...uncertainty],
    model_identity: {
      model_ref: proposal.provenance.model_ref,
      authoritative: true,
    },
    next_action: nextAction,
    protected_actions: protectedActions(),
    activation_allowed: false,
    created_at: createdAt,
    digest: null,
  });
  validateApprenticeshipHandoff(handoff, {proposal, drill, packet, reproduction, review, ownerDecision});
  return handoff;
}

export function validateApprenticeshipHandoff(handoff, {proposal = null, drill = null, packet = null, reproduction = null, review = null, ownerDecision = null} = {}) {
  exactKeys(handoff, [
    "schema",
    "version",
    "mode",
    "handoff_id",
    "status",
    "proposal_digest",
    "drill_digest",
    "packet_digest",
    "reproduction_digest",
    "review_ref",
    "owner_decision_ref",
    "task_identity",
    "project_binding",
    "source_identity",
    "provenance",
    "question_records",
    "comparison_records",
    "hostile_findings",
    "uncertainty",
    "model_identity",
    "next_action",
    "protected_actions",
    "activation_allowed",
    "created_at",
    "digest",
  ], "apprenticeship handoff");
  assert(handoff.schema === HANDOFF_SCHEMA && handoff.version === APPRENTICESHIP_VERSION, "apprenticeship handoff identity is invalid");
  assert(handoff.mode === APPRENTICESHIP_MODE, "apprenticeship handoff mode is invalid");
  requireIdentifier(handoff.handoff_id, "apprenticeship handoff ID");
  assert(["OWNER_REVIEW_REQUIRED", "OWNER_APPROVED_PENDING_ACTIVATION", "REPAIR_REQUIRED"].includes(handoff.status), "apprenticeship handoff status is invalid");
  requireSha256(handoff.proposal_digest, "handoff proposal digest");
  requireSha256(handoff.drill_digest, "handoff drill digest");
  requireSha256(handoff.packet_digest, "handoff packet digest");
  requireSha256(handoff.reproduction_digest, "handoff reproduction digest");
  requireSafeReference(handoff.review_ref, "handoff review reference");
  if (handoff.owner_decision_ref !== null) requireSafeReference(handoff.owner_decision_ref, "handoff owner decision reference");
  exactKeys(handoff.task_identity, ["project_ref", "campaign_ref", "goal_ref", "worker_session_ref", "reproduction_session_ref"], "handoff task identity");
  exactKeys(handoff.project_binding, ["project_ref", "campaign_ref", "goal_ref", "workspace_ref"], "handoff project binding");
  exactKeys(handoff.source_identity, ["source_ref", "tree_ref", "environment_ref"], "handoff source identity");
  validateProvenance(handoff.provenance, {requiredRefs: ["worker_ref", "worker_session_ref", "orchestrator_ref", "orchestrator_session_ref", "learner_ref", "learner_session_ref", "auditor_ref", "auditor_session_ref", "reproduction_ref", "reproduction_session_ref", "model_ref"]});
  [handoff.task_identity, handoff.project_binding, handoff.source_identity].forEach((binding, index) => Object.values(binding).forEach((value) => requireSafeReference(value, `handoff binding ${index}`)));
  assert(Array.isArray(handoff.question_records) && handoff.question_records.length === 8, "handoff question coverage is incomplete");
  assert(Array.isArray(handoff.comparison_records) && handoff.comparison_records.length === 8, "handoff comparison coverage is incomplete");
  uniqueStrings(handoff.hostile_findings, "handoff hostile findings", {allowEmpty: true});
  uniqueStrings(handoff.uncertainty, "handoff uncertainty", {allowEmpty: true});
  exactKeys(handoff.model_identity, ["model_ref", "authoritative"], "handoff model identity");
  requireSafeReference(handoff.model_identity.model_ref, "handoff model reference");
  assert(handoff.model_identity.authoritative === true, "handoff model identity must be authoritative");
  requireString(handoff.next_action, "handoff next action");
  assert(handoff.activation_allowed === false, "handoff cannot allow activation");
  validateTimestamp(handoff.created_at, "handoff creation timestamp");
  validateProtectedActions(handoff.protected_actions);
  if (proposal !== null) {
    validateGovernanceProposalForUse(proposal);
    assert(handoff.proposal_digest === proposal.digest, "handoff proposal binding differs");
    assert(sameBinding(handoff.provenance, proposal.provenance), "handoff provenance differs from proposal");
  }
  if (drill !== null) {
    validateWorkflowDrill(drill);
    assert(handoff.drill_digest === drill.digest, "handoff drill binding differs");
    assert(canonicalJson(handoff.question_records) === canonicalJson(drill.question_records), "handoff question records differ from drill");
    assert(canonicalJson(handoff.comparison_records) === canonicalJson(drill.comparison_records), "handoff comparison records differ from drill");
  }
  if (packet !== null) {
    validateReproductionPacket(packet);
    assert(packet.revocation.status === "NOT_REVOKED", "revoked reproduction packet cannot be handed off");
    assert(handoff.packet_digest === packet.digest, "handoff packet binding differs");
  }
  if (reproduction !== null) {
    validateReproductionResult(reproduction, {packet});
    if (packet !== null) assert(handoff.packet_digest === packet.digest, "handoff packet binding differs");
    assert(handoff.reproduction_digest === reproduction.digest, "handoff reproduction binding differs");
    assert(handoff.provenance.reproduction_ref === reproduction.provenance.reproduction_ref, "handoff reproduction identity differs");
    assert(handoff.provenance.reproduction_session_ref === reproduction.provenance.reproduction_session_ref, "handoff reproduction session differs");
  }
  if (review !== null) {
    validateIndependentReview(review, {packet});
    assert(handoff.review_ref === review.review_ref, "handoff review binding differs");
    if (handoff.status === "OWNER_REVIEW_REQUIRED" || handoff.status === "OWNER_APPROVED_PENDING_ACTIVATION") assert(review.verdict === "ACCEPT_FOR_OWNER_REVIEW", "owner-review handoff requires an independent owner-review recommendation");
  }
  if (ownerDecision !== null) {
    validateOwnerDecision(ownerDecision, {proposal, review});
    assert(handoff.owner_decision_ref === ownerDecision.decision_ref, "handoff owner decision binding differs");
  }
  if (handoff.status === "OWNER_APPROVED_PENDING_ACTIVATION") {
    assert(ownerDecision !== null && ownerDecision.decision === "APPROVE_INTENT_AUTHORITY_CHANGE" && ownerDecision.intent_or_authority_change === true, "owner-approved pending activation requires explicit intent/authority approval");
  }
  assertNonActivating(handoff, "apprenticeship handoff");
  assertPortableRecord(handoff, "apprenticeship handoff");
  validateDigest(handoff, "apprenticeship handoff");
  return handoff;
}
