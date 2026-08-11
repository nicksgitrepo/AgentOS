#!/usr/bin/env node

import {
  APPRENTICESHIP_VERSION,
  DRILL_ANSWERS,
  DRILL_COMPARISON_STATUSES,
  DRILL_LIFECYCLE_OPERATIONS,
  DRILL_QUESTIONS,
  assert,
  assertDistinctReferences,
  assertNonActivating,
  assertPortableRecord,
  clone,
  exactKeys,
  nonEmptyArray,
  protectedActions,
  requireIdentifier,
  requireSafeReference,
  requireSha256,
  requireString,
  uniqueStrings,
  validateDigest,
  validateEvidenceRefs,
  validateProvenance,
  validateProtectedActions,
  validateTimestamp,
  withDigest,
} from "./apprenticeship-common.mjs";
import {GOVERNANCE_PROPOSAL_SCHEMA, validateGovernanceProposalForUse} from "./apprenticeship-observation.mjs";
import {
  assertUniversalDevelopmentMode,
  UNIVERSAL_TASK_CLOSEOUT_AUTHORITIES,
  UNIVERSAL_TASK_CLOSEOUT_SEQUENCE,
  validateUniversalTaskCloseoutReceipts,
} from "./governance-library.mjs";

export const WORKFLOW_AUDITOR_DRILL_SCHEMA = "agentos.workflow_auditor_drill.v1";
export const DRILL_STATUSES = Object.freeze([
  "IN_PROGRESS",
  "DRILL_INCOMPLETE",
  "UNKNOWN_BLOCKED",
  "DRILL_COMPLETE_NON_ACCEPTING",
  "CLOSED_NON_ACCEPTING",
]);

const REQUIRED_CLOSURE_OPERATIONS = Object.freeze([
  "create_thread",
  "pin",
  "unpin",
  "archive",
  "post_close_read",
  "active_list_absent",
]);
const REQUIRED_HOST_WORK_OPERATIONS = Object.freeze(["send", "wait", "read"]);

function questionAt(index) {
  return DRILL_QUESTIONS[index] ?? null;
}

function validateQuestionRecord(record, index, label) {
  exactKeys(record, [
    "question_index",
    "question_id",
    "answer",
    "answerer_ref",
    "auditor_ref",
    "response_ref",
    "evidence_refs",
    "evidence_sha256",
    "current_binding_match",
    "comparison_status",
    "recorded_at",
  ], `${label} ${index}`);
  assert(Number.isSafeInteger(record.question_index) && record.question_index >= 0 && record.question_index < DRILL_QUESTIONS.length, `${label} ${index} question index is invalid`);
  const question = questionAt(record.question_index);
  assert(question !== null && record.question_id === question.question_id, `${label} ${index} question binding is invalid`);
  assert(record.answer === "ANSWERED", `${label} ${index} must be an answered question`);
  requireSafeReference(record.answerer_ref, `${label} ${index} answerer reference`);
  requireSafeReference(record.auditor_ref, `${label} ${index} Auditor reference`);
  requireSafeReference(record.response_ref, `${label} ${index} response reference`);
  validateEvidenceRefs(record.evidence_refs, `${label} ${index} evidence`);
  requireSha256(record.evidence_sha256, `${label} ${index} evidence digest`);
  assert(record.current_binding_match === true, `${label} ${index} current binding must match`);
  assert(record.comparison_status === "MATCHED", `${label} ${index} comparison must match`);
  validateTimestamp(record.recorded_at, `${label} ${index} timestamp`);
  assertPortableRecord(record, `${label} ${index}`);
}

function validateAttempt(record, index, drill) {
  exactKeys(record, [
    "attempt_number",
    "question_index",
    "question_id",
    "answer",
    "answerer_ref",
    "auditor_ref",
    "response_ref",
    "evidence_refs",
    "evidence_sha256",
    "current_binding_match",
    "comparison_status",
    "recorded_at",
  ], `drill attempt ${index}`);
  assert(Number.isSafeInteger(record.attempt_number) && record.attempt_number > 0, `drill attempt ${index} number is invalid`);
  assert(Number.isSafeInteger(record.question_index) && record.question_index >= 0 && record.question_index < DRILL_QUESTIONS.length, `drill attempt ${index} question index is invalid`);
  const question = questionAt(record.question_index);
  assert(question !== null && record.question_id === question.question_id, `drill attempt ${index} question binding is invalid`);
  assert(DRILL_ANSWERS.includes(record.answer), `drill attempt ${index} answer is invalid`);
  requireSafeReference(record.answerer_ref, `drill attempt ${index} answerer reference`);
  requireSafeReference(record.auditor_ref, `drill attempt ${index} Auditor reference`);
  requireSafeReference(record.response_ref, `drill attempt ${index} response reference`);
  validateEvidenceRefs(record.evidence_refs, `drill attempt ${index} evidence`, {allowEmpty: true});
  if (record.evidence_sha256 !== null) requireSha256(record.evidence_sha256, `drill attempt ${index} evidence digest`);
  assert(typeof record.current_binding_match === "boolean", `drill attempt ${index} binding result is invalid`);
  assert(DRILL_COMPARISON_STATUSES.includes(record.comparison_status), `drill attempt ${index} comparison is invalid`);
  validateTimestamp(record.recorded_at, `drill attempt ${index} timestamp`);
  assert(record.answerer_ref === drill.provenance.learner_ref, `drill attempt ${index} answerer is not the learner`);
  assert(record.auditor_ref === drill.provenance.auditor_ref, `drill attempt ${index} Auditor binding differs`);
  assertPortableRecord(record, `drill attempt ${index}`);
}

function validateLifecycleReceipt(receipt, index, allReceipts) {
  exactKeys(receipt, [
    "sequence",
    "operation",
    "receipt_ref",
    "authority",
    "status",
    "question_id",
    "observed_at",
  ], `drill lifecycle receipt ${index}`);
  assert(Number.isSafeInteger(receipt.sequence) && receipt.sequence === index + 1, `drill lifecycle receipt ${index} sequence is invalid`);
  assert(DRILL_LIFECYCLE_OPERATIONS.includes(receipt.operation), `drill lifecycle receipt ${index} operation is invalid`);
  if (index === 0) assert(receipt.operation === "create_thread", "drill lifecycle must begin with create_thread");
  if (receipt.operation === "create_thread") assert(index === 0, "create_thread must be the first lifecycle receipt");
  requireSafeReference(receipt.receipt_ref, `drill lifecycle receipt ${index} reference`);
  assert(receipt.authority === "HOST_READBACK", `drill lifecycle receipt ${index} is not authoritative host readback`);
  assert(receipt.status === "SUCCEEDED", `drill lifecycle receipt ${index} did not succeed`);
  if (["send", "wait", "read"].includes(receipt.operation)) requireIdentifier(receipt.question_id, `drill lifecycle receipt ${index} question ID`);
  else assert(receipt.question_id === null, `drill lifecycle receipt ${index} has an unexpected question ID`);
  validateTimestamp(receipt.observed_at, `drill lifecycle receipt ${index} timestamp`);
  if (index > 0) {
    const priorReceipts = allReceipts.slice(0, index);
    const previous = allReceipts[index - 1].operation;
    if (receipt.operation === "pin") assert(previous === "create_thread", "pin must follow create_thread");
    if (["send", "wait", "read"].includes(receipt.operation)) assert(priorReceipts.some((candidate) => candidate.operation === "pin") && !priorReceipts.some((candidate) => candidate.operation === "unpin"), "host work must occur while the drill is pinned");
    if (receipt.operation === "unpin") assert(previous === "read" || previous === "pin", "unpin must follow host work readback");
    if (receipt.operation === "archive") assert(previous === "unpin", "archive must follow unpin");
    if (receipt.operation === "post_close_read") assert(previous === "archive", "post-close read must follow archive");
    if (receipt.operation === "active_list_absent") assert(previous === "post_close_read", "active-roster absence must follow post-close read");
  }
  assertPortableRecord(receipt, `drill lifecycle receipt ${index}`);
}

function validateLifecycleReceipts(receipts, {closed = false} = {}) {
  assert(Array.isArray(receipts), "drill lifecycle receipts must be an array");
  receipts.forEach((receipt, index) => validateLifecycleReceipt(receipt, index, receipts));
  const operations = receipts.map((receipt) => receipt.operation);
  assert((operations.filter((operation) => operation === "create_thread").length <= 1), "drill lifecycle has duplicate create_thread");
  assert((operations.filter((operation) => operation === "pin").length <= 1), "drill lifecycle has duplicate pin");
  REQUIRED_CLOSURE_OPERATIONS.filter((operation) => operation !== "create_thread" && operation !== "pin").forEach((operation) => {
    assert(operations.filter((candidate) => candidate === operation).length <= 1, `drill lifecycle has duplicate ${operation}`);
  });
  if (closed) REQUIRED_CLOSURE_OPERATIONS.forEach((operation) => assert(operations.includes(operation), `closed drill is missing ${operation} receipt`));
  if (closed) REQUIRED_HOST_WORK_OPERATIONS.forEach((operation) => assert(operations.includes(operation), `closed drill is missing ${operation} receipt`));
  return receipts;
}

function validateTypedDrillHandoff(value) {
  exactKeys(value, ["status", "next_action", "uncertainty", "hostile_findings", "protected_actions"], "drill typed handoff");
  requireIdentifier(value.status, "drill handoff status");
  assert(["DRILL_COMPLETE_NON_ACCEPTING", "DRILL_INCOMPLETE", "UNKNOWN_BLOCKED"].includes(value.status), "drill handoff status is invalid");
  requireString(value.next_action, "drill handoff next action");
  uniqueStrings(value.uncertainty, "drill handoff uncertainty", {allowEmpty: true});
  uniqueStrings(value.hostile_findings, "drill handoff hostile findings", {allowEmpty: true});
  validateProtectedActions(value.protected_actions, "drill handoff protected actions");
  assertPortableRecord(value, "drill typed handoff");
  return value;
}

function deriveCurrentQuestion(drill) {
  if (drill.current_question_index >= DRILL_QUESTIONS.length) return null;
  return questionAt(drill.current_question_index);
}

export function compileWorkflowDrill({
  drillId,
  proposal,
  provenance,
  createdAt,
} = {}) {
  requireIdentifier(drillId, "Workflow Auditor drill ID");
  validateGovernanceProposalForUse(proposal);
  validateProvenance(provenance, {
    requiredRefs: ["worker_ref", "worker_session_ref", "orchestrator_ref", "orchestrator_session_ref", "learner_ref", "learner_session_ref", "auditor_ref", "auditor_session_ref", "model_ref"],
  });
  assert(provenance.worker_ref === provenance.learner_ref, "drill learner must be the observed worker");
  assert(provenance.worker_session_ref === provenance.learner_session_ref, "drill learner session must be the observed worker session");
  assertDistinctReferences([
    provenance.learner_ref,
    provenance.auditor_ref,
    provenance.orchestrator_ref,
  ], "drill role identities");
  assertDistinctReferences([
    provenance.learner_session_ref,
    provenance.auditor_session_ref,
    provenance.orchestrator_session_ref,
  ], "drill session identities");
  validateTimestamp(createdAt, "drill creation timestamp");
  const drill = withDigest({
    schema: WORKFLOW_AUDITOR_DRILL_SCHEMA,
    version: APPRENTICESHIP_VERSION,
    protocol: "EIGHT_ORDERED_SOURCE_BOUND_QUESTIONS",
    drill_id: drillId,
    status: "IN_PROGRESS",
    proposal_digest: proposal.digest,
    provenance: clone(provenance),
    learner_role: "APPRENTICESHIP_WORKER",
    auditor_role: "WORKFLOW_AUDITOR",
    current_question_index: 0,
    current_question_id: DRILL_QUESTIONS[0].question_id,
    question_records: [],
    comparison_records: [],
    attempts: [],
    repair_records: [],
    lifecycle_receipts: [],
    universal_closeout_receipts: [],
    typed_handoff: null,
    final_status: null,
    created_at: createdAt,
    updated_at: createdAt,
    closed_at: null,
    protected_actions: protectedActions(),
    digest: null,
  });
  validateWorkflowDrill(drill, {proposal});
  return drill;
}

export function recordDrillCloseoutReceipt(drill, {
  step,
  receiptRef,
  observedAt,
} = {}) {
  validateWorkflowDrill(drill);
  assert(!["CLOSED_NON_ACCEPTING"].includes(drill.status), "closed drill cannot receive universal closeout receipts");
  assert(UNIVERSAL_TASK_CLOSEOUT_SEQUENCE.includes(step), `unknown universal closeout step ${step}`);
  requireSafeReference(receiptRef, "universal closeout receipt reference");
  validateTimestamp(observedAt, "universal closeout receipt timestamp");
  const next = clone(drill);
  const index = next.universal_closeout_receipts.length;
  assert(UNIVERSAL_TASK_CLOSEOUT_SEQUENCE[index] === step, `universal closeout step must follow ${UNIVERSAL_TASK_CLOSEOUT_SEQUENCE[index] ?? "the complete sequence"}`);
  next.universal_closeout_receipts.push({
    sequence: index + 1,
    step,
    receipt_ref: receiptRef,
    authority: UNIVERSAL_TASK_CLOSEOUT_AUTHORITIES[step],
    status: "PROVEN",
    observed_at: observedAt,
  });
  validateUniversalTaskCloseoutReceipts(next.universal_closeout_receipts, {label: "drill universal closeout receipts"});
  next.updated_at = observedAt;
  const result = withDigest(next);
  validateWorkflowDrill(result);
  return result;
}

export function currentDrillQuestion(drill) {
  validateWorkflowDrill(drill);
  return clone(deriveCurrentQuestion(drill));
}

export function recordDrillLifecycleReceipt(drill, {
  operation,
  receiptRef,
  questionId = null,
  observedAt,
} = {}) {
  validateWorkflowDrill(drill);
  assert(!["CLOSED_NON_ACCEPTING"].includes(drill.status), "closed drill cannot receive lifecycle receipts");
  assert(DRILL_LIFECYCLE_OPERATIONS.includes(operation), `unknown drill lifecycle operation ${operation}`);
  requireSafeReference(receiptRef, "drill lifecycle receipt reference");
  validateTimestamp(observedAt, "drill lifecycle receipt timestamp");
  const operations = drill.lifecycle_receipts.map((receipt) => receipt.operation);
  if (operation === "create_thread") assert(!operations.includes(operation), "drill already has create_thread receipt");
  if (operation === "pin") assert(!operations.includes(operation), "drill already has pin receipt");
  if (operation === "unpin") assert(drill.lifecycle_receipts.some((receipt) => receipt.operation === "read" || receipt.operation === "pin"), "drill cannot unpin before host activity");
  if (operation === "archive") assert(operations.includes("unpin"), "drill cannot archive before unpin");
  if (operation === "post_close_read") assert(operations.includes("archive"), "drill cannot post-close read before archive");
  if (operation === "active_list_absent") assert(operations.includes("post_close_read"), "drill cannot verify roster absence before post-close read");
  if (["send", "wait", "read"].includes(operation)) {
    requireIdentifier(questionId, "drill lifecycle question ID");
    assert(DRILL_QUESTIONS.some((question) => question.question_id === questionId), "drill lifecycle question is unknown");
  } else assert(questionId === null, "drill lifecycle question is only valid for host work receipts");
  const next = clone(drill);
  next.lifecycle_receipts.push({
    sequence: next.lifecycle_receipts.length + 1,
    operation,
    receipt_ref: receiptRef,
    authority: "HOST_READBACK",
    status: "SUCCEEDED",
    question_id: questionId,
    observed_at: observedAt,
  });
  next.updated_at = observedAt;
  const result = withDigest(next);
  validateWorkflowDrill(result);
  return result;
}

export function answerCurrentDrillQuestion(drill, {
  questionId,
  answer,
  answererRef,
  responseRef,
  evidenceRefs,
  evidenceSha256 = null,
  currentBindingMatch,
  comparisonStatus,
  recordedAt,
} = {}) {
  validateWorkflowDrill(drill);
  assert(drill.status === "IN_PROGRESS", "drill is not accepting an answer");
  const current = deriveCurrentQuestion(drill);
  assert(current !== null, "drill has no current question");
  assert(questionId === current.question_id, "drill answers must target only the current question");
  assert(DRILL_ANSWERS.includes(answer), "drill answer is invalid");
  requireSafeReference(answererRef, "drill answerer reference");
  assert(answererRef === drill.provenance.learner_ref, "drill answerer must be the observed worker");
  requireSafeReference(responseRef, "drill response reference");
  validateEvidenceRefs(evidenceRefs, "drill answer evidence", {allowEmpty: true});
  if (evidenceSha256 !== null) requireSha256(evidenceSha256, "drill answer evidence digest");
  assert(typeof currentBindingMatch === "boolean", "drill current binding result is invalid");
  assert(DRILL_COMPARISON_STATUSES.includes(comparisonStatus), "drill comparison status is invalid");
  validateTimestamp(recordedAt, "drill answer timestamp");

  if (answer === "ANSWERED") {
    assert(evidenceRefs.length > 0, "answered drill question requires evidence");
    assert(evidenceSha256 !== null, "answered drill question requires an evidence digest");
  }
  const previousAttempts = drill.attempts.filter((attempt) => attempt.question_id === questionId).length;
  const attempt = {
    attempt_number: previousAttempts + 1,
    question_index: drill.current_question_index,
    question_id: questionId,
    answer,
    answerer_ref: answererRef,
    auditor_ref: drill.provenance.auditor_ref,
    response_ref: responseRef,
    evidence_refs: [...evidenceRefs],
    evidence_sha256: evidenceSha256,
    current_binding_match: currentBindingMatch,
    comparison_status: comparisonStatus,
    recorded_at: recordedAt,
  };
  const next = clone(drill);
  next.attempts.push(attempt);
  next.updated_at = recordedAt;
  const matched = answer === "ANSWERED" && currentBindingMatch === true && comparisonStatus === "MATCHED";
  if (!matched) {
    next.status = answer === "UNKNOWN" || currentBindingMatch === false || comparisonStatus === "UNKNOWN" ? "UNKNOWN_BLOCKED" : "DRILL_INCOMPLETE";
    next.final_status = next.status;
  } else {
    next.question_records.push({
      question_index: drill.current_question_index,
      question_id: questionId,
      answer,
      answerer_ref: answererRef,
      auditor_ref: drill.provenance.auditor_ref,
      response_ref: responseRef,
      evidence_refs: [...evidenceRefs],
      evidence_sha256: evidenceSha256,
      current_binding_match: currentBindingMatch,
      comparison_status: comparisonStatus,
      recorded_at: recordedAt,
    });
    next.comparison_records.push({
      question_index: drill.current_question_index,
      question_id: questionId,
      answer,
      answerer_ref: answererRef,
      auditor_ref: drill.provenance.auditor_ref,
      response_ref: responseRef,
      evidence_refs: [...evidenceRefs],
      evidence_sha256: evidenceSha256,
      current_binding_match: currentBindingMatch,
      comparison_status: comparisonStatus,
      recorded_at: recordedAt,
    });
    next.current_question_index += 1;
    next.current_question_id = deriveCurrentQuestion(next)?.question_id ?? null;
    if (next.current_question_index === DRILL_QUESTIONS.length) {
      next.status = "DRILL_COMPLETE_NON_ACCEPTING";
      next.final_status = "DRILL_COMPLETE_NON_ACCEPTING";
    }
  }
  const result = withDigest(next);
  validateWorkflowDrill(result);
  return result;
}

export function reopenWorkflowDrill(drill, {questionId, repairRef, repairedAt} = {}) {
  validateWorkflowDrill(drill);
  assert(["UNKNOWN_BLOCKED", "DRILL_INCOMPLETE"].includes(drill.status), "only blocked or incomplete drills can be reopened");
  assert(questionId === drill.current_question_id, "repair must target the blocked current question");
  requireSafeReference(repairRef, "drill repair reference");
  validateTimestamp(repairedAt, "drill repair timestamp");
  const next = clone(drill);
  next.status = "IN_PROGRESS";
  next.final_status = null;
  next.repair_records.push({question_id: questionId, repair_ref: repairRef, repaired_at: repairedAt});
  next.updated_at = repairedAt;
  const result = withDigest(next);
  validateWorkflowDrill(result);
  return result;
}

export function closeWorkflowDrill(drill, {typedHandoff, universalCloseoutReceipts, closedAt} = {}) {
  validateWorkflowDrill(drill);
  assert(["DRILL_COMPLETE_NON_ACCEPTING", "DRILL_INCOMPLETE", "UNKNOWN_BLOCKED"].includes(drill.status), "drill must have a terminal learning result before closure");
  validateTypedDrillHandoff(typedHandoff);
  assert(typedHandoff.status === drill.final_status, "drill handoff status differs from final drill status");
  validateLifecycleReceipts(drill.lifecycle_receipts, {closed: true});
  validateUniversalTaskCloseoutReceipts(universalCloseoutReceipts, {closed: true, label: "drill universal closeout receipts"});
  validateTimestamp(closedAt, "drill close timestamp");
  const next = clone(drill);
  next.status = "CLOSED_NON_ACCEPTING";
  next.typed_handoff = clone(typedHandoff);
  next.universal_closeout_receipts = clone(universalCloseoutReceipts);
  next.closed_at = closedAt;
  next.updated_at = closedAt;
  const result = withDigest(next);
  validateWorkflowDrill(result);
  return result;
}

export function validateWorkflowDrill(drill, {proposal = null} = {}) {
  assertUniversalDevelopmentMode("APPRENTICESHIP");
  exactKeys(drill, [
    "schema",
    "version",
    "protocol",
    "drill_id",
    "status",
    "proposal_digest",
    "provenance",
    "learner_role",
    "auditor_role",
    "current_question_index",
    "current_question_id",
    "question_records",
    "comparison_records",
    "attempts",
    "repair_records",
    "lifecycle_receipts",
    "universal_closeout_receipts",
    "typed_handoff",
    "final_status",
    "created_at",
    "updated_at",
    "closed_at",
    "protected_actions",
    "digest",
  ], "Workflow Auditor drill", {allow: []});
  assert(drill.schema === WORKFLOW_AUDITOR_DRILL_SCHEMA && drill.version === APPRENTICESHIP_VERSION, "Workflow Auditor drill identity is invalid");
  assert(drill.protocol === "EIGHT_ORDERED_SOURCE_BOUND_QUESTIONS", "Workflow Auditor drill protocol is invalid");
  requireIdentifier(drill.drill_id, "Workflow Auditor drill ID");
  assert(DRILL_STATUSES.includes(drill.status), "Workflow Auditor drill status is invalid");
  requireSha256(drill.proposal_digest, "Workflow Auditor drill proposal digest");
  if (proposal !== null) {
    validateGovernanceProposalForUse(proposal);
    assert(drill.proposal_digest === proposal.digest, "Workflow Auditor drill proposal binding differs");
  }
  validateProvenance(drill.provenance, {
    requiredRefs: ["worker_ref", "worker_session_ref", "orchestrator_ref", "orchestrator_session_ref", "learner_ref", "learner_session_ref", "auditor_ref", "auditor_session_ref", "model_ref"],
  });
  assert(drill.learner_role === "APPRENTICESHIP_WORKER", "drill learner role is invalid");
  assert(drill.auditor_role === "WORKFLOW_AUDITOR", "drill Auditor role is invalid");
  assert(drill.provenance.worker_ref === drill.provenance.learner_ref, "drill learner and worker identities differ");
  assert(drill.provenance.worker_session_ref === drill.provenance.learner_session_ref, "drill learner and worker sessions differ");
  assertDistinctReferences([drill.provenance.learner_ref, drill.provenance.auditor_ref, drill.provenance.orchestrator_ref], "drill roles");
  assertDistinctReferences([drill.provenance.learner_session_ref, drill.provenance.auditor_session_ref, drill.provenance.orchestrator_session_ref], "drill sessions");
  assert(Number.isSafeInteger(drill.current_question_index) && drill.current_question_index >= 0 && drill.current_question_index <= DRILL_QUESTIONS.length, "drill current question index is invalid");
  const expectedCurrent = deriveCurrentQuestion(drill)?.question_id ?? null;
  assert(drill.current_question_id === expectedCurrent, "drill current question binding is invalid");
  assert(Array.isArray(drill.question_records) && Array.isArray(drill.comparison_records) && Array.isArray(drill.attempts), "drill question records are invalid");
  assert(drill.question_records.length === drill.comparison_records.length, "drill question/comparison coverage differs");
  drill.question_records.forEach((record, index) => validateQuestionRecord(record, index, "drill question record"));
  drill.comparison_records.forEach((record, index) => validateQuestionRecord(record, index, "drill comparison record"));
  for (let index = 0; index < drill.question_records.length; index += 1) {
    assert(drill.question_records[index].question_index === index, "drill questions must be answered in order");
    assert(drill.comparison_records[index].question_id === drill.question_records[index].question_id, "drill comparison binding differs");
  }
  assert(drill.question_records.length === drill.current_question_index || drill.status === "CLOSED_NON_ACCEPTING", "drill current index does not match accepted coverage");
  drill.attempts.forEach((attempt, index) => validateAttempt(attempt, index, drill));
  uniqueStrings(drill.repair_records.map((record) => record.repair_ref), "drill repair references", {allowEmpty: true}).forEach((reference) => requireSafeReference(reference, "drill repair reference"));
  drill.repair_records.forEach((record, index) => {
    exactKeys(record, ["question_id", "repair_ref", "repaired_at"], `drill repair record ${index}`);
    requireIdentifier(record.question_id, `drill repair record ${index} question`);
    requireSafeReference(record.repair_ref, `drill repair record ${index} reference`);
    validateTimestamp(record.repaired_at, `drill repair record ${index} timestamp`);
  });
  validateLifecycleReceipts(drill.lifecycle_receipts, {closed: drill.status === "CLOSED_NON_ACCEPTING"});
  validateUniversalTaskCloseoutReceipts(drill.universal_closeout_receipts, {closed: drill.status === "CLOSED_NON_ACCEPTING", label: "drill universal closeout receipts"});
  if (drill.typed_handoff !== null) validateTypedDrillHandoff(drill.typed_handoff);
  if (drill.status === "CLOSED_NON_ACCEPTING") {
    assert(drill.final_status === "DRILL_COMPLETE_NON_ACCEPTING" || drill.final_status === "DRILL_INCOMPLETE" || drill.final_status === "UNKNOWN_BLOCKED", "closed drill final status is invalid");
    assert(drill.typed_handoff !== null && drill.closed_at !== null, "closed drill is missing its typed handoff or close time");
  } else {
    assert(drill.closed_at === null, "open drill cannot carry a close time");
  }
  if (drill.status === "DRILL_COMPLETE_NON_ACCEPTING") assert(drill.question_records.length === DRILL_QUESTIONS.length, "complete drill does not cover all questions");
  if (drill.status === "IN_PROGRESS") assert(drill.final_status === null, "in-progress drill cannot have a final status");
  if (["DRILL_INCOMPLETE", "UNKNOWN_BLOCKED"].includes(drill.status)) assert(drill.final_status === drill.status, "blocked drill final status is invalid");
  validateTimestamp(drill.created_at, "drill creation timestamp");
  validateTimestamp(drill.updated_at, "drill update timestamp");
  validateProtectedActions(drill.protected_actions);
  assertNonActivating(drill, "Workflow Auditor drill");
  assertPortableRecord(drill, "Workflow Auditor drill");
  validateDigest(drill, "Workflow Auditor drill");
  return drill;
}
