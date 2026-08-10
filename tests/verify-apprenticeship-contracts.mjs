#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {
  APPRENTICESHIP_MODE,
  APPRENTICESHIP_ROLES,
  APPRENTICESHIP_STATES,
  DRILL_QUESTIONS,
  GOVERNANCE_PROPOSAL_SCHEMA,
  HANDOFF_SCHEMA,
  INDEPENDENT_REVIEW_SCHEMA,
  OBSERVATION_SCHEMA,
  OWNER_DECISION_SCHEMA,
  RECONSTRUCTION_SCHEMA,
  REPRODUCTION_PACKET_SCHEMA,
  REPRODUCTION_RESULT_SCHEMA,
  WORKFLOW_AUDITOR_DRILL_SCHEMA,
  answerCurrentDrillQuestion,
  assertPortableRecord,
  compileApprenticeshipHandoff,
  compileGateSource,
  compileGovernanceProposal,
  compileIndependentReview,
  compileOwnerDecision,
  compileProvenance,
  compileReproductionPacket,
  compileReproductionResult,
  compileTaskObservation,
  compileWorkflowDrill,
  currentDrillQuestion,
  closeWorkflowDrill,
  protectedActions,
  recordDrillLifecycleReceipt,
  recordDrillCloseoutReceipt,
  reconstructWorkflow,
  reopenWorkflowDrill,
  transitionApprenticeshipState,
  validateApprenticeshipHandoff,
  validateGovernanceProposal,
  validateIndependentReview,
  validateOwnerDecision,
  validateReproductionPacket,
  validateReproductionResult,
  validateTaskObservation,
  validateWorkflowDrill,
} from "../control/apprenticeship-contracts.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHA = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);
const sourceRef = `sha1:${"1".repeat(40)}`;
const treeRef = `sha1:${"2".repeat(40)}`;

const time = (minute) => `2026-08-06T12:${String(minute).padStart(2, "0")}:00.000Z`;
const ref = (value) => `ref:${value}`;

function provenance(overrides = {}) {
  return compileProvenance({
    projectRef: ref("project"),
    campaignRef: ref("campaign"),
    goalRef: ref("goal"),
    sourceRef,
    treeRef,
    workspaceRef: ref("workspace"),
    environmentRef: ref("environment"),
    workerRef: ref("worker"),
    workerSessionRef: ref("worker-session"),
    orchestratorRef: ref("orchestrator"),
    orchestratorSessionRef: ref("orchestrator-session"),
    learnerRef: ref("worker"),
    learnerSessionRef: ref("worker-session"),
    auditorRef: ref("workflow-auditor"),
    auditorSessionRef: ref("workflow-auditor-session"),
    reproductionRef: null,
    reproductionSessionRef: null,
    reviewerRef: null,
    reviewerSessionRef: null,
    modelRef: ref("reasoning-capability"),
    predecessorHandoffRef: ref("predecessor-handoff"),
    ...overrides,
  });
}

function actions(prefix = "work") {
  return [
    {
      sequence: 1,
      action_id: "ACT-001",
      action: `Establish the bounded source and ${prefix} scope before acting.`,
      tool_class: "SOURCE_READBACK",
      observation_basis: "DIRECT_OBSERVATION",
      scope: ["CONTROL_PLANE"],
      preconditions: ["SOURCE_BOUND", "SCOPE_BOUND"],
      decision_boundary: "Stop if the source or admitted scope differs.",
      result_ref: ref(`${prefix}-baseline`),
      evidence_refs: [ref(`${prefix}-source-evidence`)],
      source_match: true,
      scope_match: true,
      observed_at: time(1),
    },
    {
      sequence: 2,
      action_id: "ACT-002",
      action: `Perform the single bounded ${prefix} action and read back its result.`,
      tool_class: "BOUNDED_WORK",
      observation_basis: "DIRECT_OBSERVATION",
      scope: ["CONTROL_PLANE"],
      preconditions: ["SOURCE_BOUND", "SCOPE_BOUND"],
      decision_boundary: "Stop and route for review when the result is outside the bound.",
      result_ref: ref(`${prefix}-result`),
      evidence_refs: [ref(`${prefix}-result-evidence`)],
      source_match: true,
      scope_match: true,
      observed_at: time(2),
    },
  ];
}

function typedHandoff(status = "RESULT_READY") {
  return {
    status,
    next_action: "Submit the bounded result for independent comparison.",
    evidence_refs: [ref("work-result-evidence")],
    uncertainty: [],
    protected_actions: protectedActions(),
  };
}

function buildObservation() {
  const record = compileTaskObservation({
    observationId: "OBS-001",
    provenance: provenance(),
    taskPattern: "BOUNDED_GOVERNANCE_TASK",
    boundedScope: ["CONTROL_PLANE"],
    actionRecords: actions(),
    resultKind: "MEANINGFUL_RESULT",
    resultRef: ref("work-result"),
    resultSummary: "The bounded task produced a source-bound result and typed handoff.",
    evidenceRefs: [ref("work-source-evidence"), ref("work-result-evidence")],
    typedHandoff: typedHandoff(),
    sourceMatch: true,
    scopeMatch: true,
    observedAt: time(1),
    completedAt: time(2),
  });
  assert.equal(record.schema, OBSERVATION_SCHEMA);
  assert.equal(record.status, "REAL_RESULT_OBSERVED");
  assert.equal(record.meaningful_progress, true);
  validateTaskObservation(record);
  return record;
}

function buildProposal() {
  const observation = buildObservation();
  const reconstruction = reconstructWorkflow(observation, {
    doneWhen: "The bounded result is source-bound, evidenced, and handed off.",
    failurePaths: ["ROUTE_SCOPE_REVIEW", "ROUTE_EVIDENCE_REPAIR"],
  });
  assert.equal(reconstruction.schema, RECONSTRUCTION_SCHEMA);
  const gates = DRILL_QUESTIONS.map((question, index) => {
    const next = index === DRILL_QUESTIONS.length - 1 ? "DRILL_COMPLETE_NON_ACCEPTING" : `GATE-${String(index + 2).padStart(3, "0")}`;
    return {
      line_number: index + 1,
      gate_id: `GATE-${String(index + 1).padStart(3, "0")}`,
      name: question.question_id,
      question: question.question,
      allowed_answers: ["ANSWERED", "UNKNOWN", "INCOMPLETE"],
      required_evidence: [...question.required_evidence],
      next_branch: {
        ANSWERED: next,
        UNKNOWN: "UNKNOWN_BLOCKED",
        INCOMPLETE: "DRILL_INCOMPLETE",
      },
      repair_recovery_branch: "RETRY_CURRENT_GATE",
      terminal_state: index === DRILL_QUESTIONS.length - 1 ? "DRILL_COMPLETE_NON_ACCEPTING" : "NON_TERMINAL",
    };
  });
  const gateSource = compileGateSource({sourceId: "GATE-SOURCE-001", reconstruction, gates});
  const roleBehavior = {
    role_id: "APPRENTICESHIP_WORKER",
    scope: ["CONTROL_PLANE"],
    authority: ["OBSERVE_BOUNDED_TASK", "PROPOSE_GOVERNANCE"],
    prohibited_actions: ["SELF_ACCEPT", "ACTIVATE", "PUBLISH", "PRODUCT_WRITES", "EXTERNAL_ACTIONS", "SECRETS", "LEAK_PRIVATE_CONTEXT", "SPEND"],
    admitted_tools: ["SOURCE_READBACK", "BOUNDED_WORK"],
    evidence_requirements: ["SOURCE_BINDING", "RESULT_EVIDENCE", "TYPED_HANDOFF"],
    failure_paths: ["ROUTE_TRUE_BLOCKER", "ROUTE_SOFT_REVIEW"],
    done_when: "The bounded task result, evidence, and proposal are handed off.",
  };
  const proposal = compileGovernanceProposal({
    proposalId: "PROPOSAL-001",
    provenance: provenance({
      learnerRef: ref("worker"),
      learnerSessionRef: ref("worker-session"),
    }),
    reconstruction,
    gateSource,
    roleBehavior,
    workerRef: ref("worker"),
    orchestratorRef: ref("orchestrator"),
    createdAt: time(3),
  });
  assert.equal(proposal.schema, GOVERNANCE_PROPOSAL_SCHEMA);
  assert.equal(proposal.status, "PROPOSED");
  assert.equal(proposal.activation_allowed, false);
  validateGovernanceProposal(proposal, {reconstruction});
  return {observation, reconstruction, proposal};
}

function recordReceipt(drill, operation, minute, questionId = null) {
  return recordDrillLifecycleReceipt(drill, {
    operation,
    receiptRef: ref(`host-receipt-${operation}-${minute}-${questionId ?? "lifecycle"}`),
    questionId,
    observedAt: time(minute),
  });
}

function completeDrill(proposal) {
  let drill = compileWorkflowDrill({
    drillId: "DRILL-001",
    proposal,
    provenance: provenance(),
    createdAt: time(4),
  });
  assert.equal(currentDrillQuestion(drill).question_id, "WAD-001");
  drill = recordReceipt(drill, "create_thread", 4);
  drill = recordReceipt(drill, "pin", 4);
  for (let index = 0; index < DRILL_QUESTIONS.length; index += 1) {
    const questionId = currentDrillQuestion(drill).question_id;
    drill = recordReceipt(drill, "send", 5 + index, questionId);
    drill = recordReceipt(drill, "wait", 5 + index, questionId);
    drill = recordReceipt(drill, "read", 5 + index, questionId);
    drill = answerCurrentDrillQuestion(drill, {
      questionId,
      answer: "ANSWERED",
      answererRef: ref("worker"),
      responseRef: ref(`answer-${index + 1}`),
      evidenceRefs: [ref(`drill-evidence-${index + 1}`)],
      evidenceSha256: SHA,
      currentBindingMatch: true,
      comparisonStatus: "MATCHED",
      recordedAt: time(5 + index),
    });
  }
  assert.equal(drill.status, "DRILL_COMPLETE_NON_ACCEPTING");
  drill = recordReceipt(drill, "unpin", 14);
  drill = recordReceipt(drill, "archive", 14);
  drill = recordReceipt(drill, "post_close_read", 14);
  drill = recordReceipt(drill, "active_list_absent", 14);
  for (const [index, step] of [
    "PRESERVE_HANDOFF",
    "PERSIST_HANDOFF",
    "AUDIT_CANDIDATE",
    "INTEGRATE_ACCEPTED_WORK",
    "UNPIN_SESSION",
    "CLOSE_STALE_WORKTREE",
    "REMOVE_ACTIVE_TASK_SCOPE",
    "MARK_CHAT_OUT_OF_SCOPE",
    "ARCHIVE_VISIBLE_TASK",
  ].entries()) {
    drill = recordDrillCloseoutReceipt(drill, {
      step,
      receiptRef: ref(`universal-closeout-${index + 1}`),
      observedAt: time(14),
    });
  }
  drill = closeWorkflowDrill(drill, {
    typedHandoff: {
      status: "DRILL_COMPLETE_NON_ACCEPTING",
      next_action: "Create a fresh reproduction packet.",
      uncertainty: [],
      hostile_findings: [],
      protected_actions: protectedActions(),
    },
    universalCloseoutReceipts: drill.universal_closeout_receipts,
    closedAt: time(15),
  });
  assert.equal(drill.schema, WORKFLOW_AUDITOR_DRILL_SCHEMA);
  assert.equal(drill.status, "CLOSED_NON_ACCEPTING");
  validateWorkflowDrill(drill, {proposal});
  return drill;
}

function buildReproduction(proposal, drill) {
  const reproductionProvenance = provenance({
    reproductionRef: ref("reproduction-worker"),
    reproductionSessionRef: ref("reproduction-session"),
  });
  const packet = compileReproductionPacket({
    packetId: "PACKET-001",
    proposal,
    drill,
    provenance: reproductionProvenance,
    createdAt: time(16),
  });
  assert.equal(packet.schema, REPRODUCTION_PACKET_SCHEMA);
  assert.equal(packet.fresh_context.private_context_included, false);
  validateReproductionPacket(packet, {proposal, drill});
  const gateResponses = packet.gate_source.gates.map((gate, index) => ({
    sequence: index + 1,
    gate_id: gate.gate_id,
    answer: "ANSWERED",
    evidence_refs: [ref(`reproduction-evidence-${index + 1}`)],
    evidence_sha256: SHA_B,
    binding_match: true,
    comparison_status: "MATCHED",
  }));
  const result = compileReproductionResult({
    packet,
    resultId: "REPRODUCTION-001",
    actionRecords: actions("reproduction"),
    resultKind: "MEANINGFUL_RESULT",
    resultRef: ref("reproduction-result"),
    resultSummary: "A fresh worker reproduced the bounded result from the inactive packet.",
    evidenceRefs: [ref("reproduction-result-evidence")],
    typedHandoff: typedHandoff(),
    gateResponses,
    completedAt: time(17),
  });
  assert.equal(result.schema, REPRODUCTION_RESULT_SCHEMA);
  assert.equal(result.status, "REPRODUCED");
  validateReproductionResult(result, {packet});
  return {reproductionProvenance, packet, result};
}

function buildReview(proposal, drill, packet, result, reproductionProvenance) {
  const reviewProvenance = provenance({
    reproductionRef: reproductionProvenance.reproduction_ref,
    reproductionSessionRef: reproductionProvenance.reproduction_session_ref,
    reviewerRef: ref("independent-reviewer"),
    reviewerSessionRef: ref("independent-reviewer-session"),
  });
  const review = compileIndependentReview({
    reviewId: "REVIEW-001",
    reviewRef: ref("review-001"),
    packet,
    proposal,
    drill,
    reproduction: result,
    provenance: reviewProvenance,
    verdict: "ACCEPT_FOR_OWNER_REVIEW",
    checks: {
      process_fidelity: "PASS",
      boundary_compliance: "PASS",
      evidence_completeness: "PASS",
      outcome: "PASS",
      provenance: "PASS",
      quality: "PASS",
    },
    findings: [],
    reviewedAt: time(18),
  });
  assert.equal(review.schema, INDEPENDENT_REVIEW_SCHEMA);
  validateIndependentReview(review, {proposal, drill, packet, reproduction: result});
  return {review, reviewProvenance};
}

const schemas = [
  ["schemas/apprenticeship-plan.v1.json", "agentos.apprenticeship_plan_contract.v1"],
  ["schemas/apprenticeship-observation.v1.json", "agentos.apprenticeship_observation_contract.v1"],
  ["schemas/apprenticeship-proposal.v1.json", "agentos.apprenticeship_proposal_contract.v1"],
  ["schemas/workflow-auditor-drill.v1.json", "agentos.workflow_auditor_drill_contract.v1"],
  ["schemas/apprenticeship-reproduction.v1.json", "agentos.apprenticeship_reproduction_contract.v1"],
  ["schemas/apprenticeship-handoff.v1.json", "agentos.apprenticeship_handoff_contract.v1"],
  ["schemas/apprenticeship-owner-decision.v1.json", "agentos.apprenticeship_owner_decision_contract.v1"],
];
schemas.forEach(([file, schema]) => {
  const record = JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
  assert.equal(record.schema, schema, `${file} schema identity`);
  assert.equal(record.status, "PREPARED_NOT_ACTIVATED", `${file} activation state`);
  assert.equal(record.activation.active, false, `${file} activation flag`);
});

assert.deepEqual(APPRENTICESHIP_ROLES, [
  "APPRENTICESHIP_WORKER",
  "WALKTHROUGH_ORCHESTRATOR",
  "WORKFLOW_AUDITOR",
  "INDEPENDENT_AUDITOR",
]);
assert.equal(transitionApprenticeshipState("DRAFT", "OWNER_BOUND"), "OWNER_BOUND");
assert.throws(() => transitionApprenticeshipState("DRAFT", "ARCHIVED"), /invalid apprenticeship transition/u);
assert.throws(() => transitionApprenticeshipState("ARCHIVED", "WORKING"), /invalid apprenticeship transition/u);

const {observation, reconstruction, proposal} = buildProposal();
const drill = completeDrill(proposal);
const {reproductionProvenance, packet, result} = buildReproduction(proposal, drill);
const {review, reviewProvenance} = buildReview(proposal, drill, packet, result, reproductionProvenance);
const ownerDecision = compileOwnerDecision({
  decisionId: "OWNER-DECISION-001",
  decisionRef: ref("owner-decision-001"),
  proposal,
  review,
  ownerRef: ref("owner"),
  decision: "APPROVE_INTENT_AUTHORITY_CHANGE",
  intentOrAuthorityChange: true,
  decidedAt: time(19),
});
assert.equal(ownerDecision.schema, OWNER_DECISION_SCHEMA);
validateOwnerDecision(ownerDecision, {proposal, review});
const handoff = compileApprenticeshipHandoff({
  handoffId: "HANDOFF-001",
  proposal,
  drill,
  packet,
  reproduction: result,
  review,
  ownerDecision,
  nextAction: "Keep the proposal inactive until a separately governed activation decision.",
  uncertainty: [],
  hostileFindings: [],
  createdAt: time(20),
});
assert.equal(handoff.schema, HANDOFF_SCHEMA);
assert.equal(handoff.status, "OWNER_APPROVED_PENDING_ACTIVATION");
validateApprenticeshipHandoff(handoff, {proposal, drill, packet, reproduction: result, review, ownerDecision});

const failureObservation = compileTaskObservation({
  ...{
    observationId: "OBS-FAILURE",
    provenance: provenance(),
    taskPattern: "BOUNDED_GOVERNANCE_TASK",
    boundedScope: ["CONTROL_PLANE"],
    actionRecords: actions("failure"),
    resultKind: "FAILURE_LIST",
    resultRef: ref("failure-result"),
    resultSummary: "The worker emitted only a failure list.",
    evidenceRefs: [],
    typedHandoff: null,
    sourceMatch: true,
    scopeMatch: true,
    observedAt: time(21),
    completedAt: time(21),
  },
});
assert.equal(failureObservation.meaningful_progress, false);
assert.throws(() => reconstructWorkflow(failureObservation, {doneWhen: "Must not compile."}), /real meaningful result/u);

const hostileDrill = compileWorkflowDrill({
  drillId: "DRILL-HOSTILE-001",
  proposal,
  provenance: provenance(),
  createdAt: time(22),
});
assert.throws(() => answerCurrentDrillQuestion(hostileDrill, {
  questionId: "WAD-002",
  answer: "ANSWERED",
  answererRef: ref("worker"),
  responseRef: ref("early-response"),
  evidenceRefs: [ref("early-evidence")],
  evidenceSha256: SHA,
  currentBindingMatch: true,
  comparisonStatus: "MATCHED",
  recordedAt: time(22),
}), /current question/u, "drill cannot skip question one");
assert.throws(() => closeWorkflowDrill(hostileDrill, {
  typedHandoff: {
    status: "DRILL_COMPLETE_NON_ACCEPTING",
    next_action: "Must not close early.",
    uncertainty: [],
    hostile_findings: [],
    protected_actions: protectedActions(),
  },
  closedAt: time(22),
}), /terminal learning result/u, "drill cannot finalize early");
assert.throws(() => answerCurrentDrillQuestion(hostileDrill, {
  questionId: "WAD-001",
  answer: "ANSWERED",
  answererRef: ref("worker"),
  responseRef: ref("missing-evidence-response"),
  evidenceRefs: [],
  evidenceSha256: null,
  currentBindingMatch: true,
  comparisonStatus: "MATCHED",
  recordedAt: time(22),
}), /requires evidence/u, "answered question cannot omit evidence");

let blockedDrill = compileWorkflowDrill({drillId: "DRILL-HOSTILE-002", proposal, provenance: provenance(), createdAt: time(23)});
blockedDrill = answerCurrentDrillQuestion(blockedDrill, {
  questionId: "WAD-001",
  answer: "UNKNOWN",
  answererRef: ref("worker"),
  responseRef: ref("unknown-response"),
  evidenceRefs: [],
  evidenceSha256: null,
  currentBindingMatch: false,
  comparisonStatus: "UNKNOWN",
  recordedAt: time(23),
});
assert.equal(blockedDrill.status, "UNKNOWN_BLOCKED");
blockedDrill = reopenWorkflowDrill(blockedDrill, {questionId: "WAD-001", repairRef: ref("repair-unknown"), repairedAt: time(24)});
assert.equal(blockedDrill.status, "IN_PROGRESS");

const unsafeObservation = structuredClone(observation);
unsafeObservation.result_summary = ["", "HOST_ONLY_PATH", "hidden.txt"].join("/");
assert.throws(() => validateTaskObservation(unsafeObservation), /absolute path/u, "private path cannot enter an observation");
const unsafePacket = structuredClone(packet);
unsafePacket.fresh_context.private_context_included = true;
assert.throws(() => validateReproductionPacket(unsafePacket), /forbidden learner context/u, "private learner context cannot enter a reproduction packet");
const syntheticReceiptDrill = structuredClone(drill);
syntheticReceiptDrill.lifecycle_receipts[0].authority = "SYNTHETIC";
assert.throws(() => validateWorkflowDrill(syntheticReceiptDrill), /authoritative host readback/u, "synthetic receipts cannot validate lifecycle");
const selfReviewProvenance = provenance({
  reproductionRef: reproductionProvenance.reproduction_ref,
  reproductionSessionRef: reproductionProvenance.reproduction_session_ref,
  reviewerRef: ref("worker"),
  reviewerSessionRef: ref("worker-review-session"),
});
assert.throws(() => compileIndependentReview({
  reviewId: "REVIEW-HOSTILE-001",
  reviewRef: ref("review-hostile"),
  proposal,
  drill,
  packet,
  reproduction: result,
  provenance: selfReviewProvenance,
  verdict: "ACCEPT_FOR_OWNER_REVIEW",
  checks: {
    process_fidelity: "PASS",
    boundary_compliance: "PASS",
    evidence_completeness: "PASS",
    outcome: "PASS",
    provenance: "PASS",
    quality: "PASS",
  },
  reviewedAt: time(25),
}), /cannot be the worker/u, "worker cannot independently review its own proposal");
const activationProposal = structuredClone(proposal);
activationProposal.activation_allowed = true;
assert.throws(() => validateGovernanceProposal(activationProposal), /allow activation/u, "proposal cannot activate itself");
assertPortableRecord(handoff);

console.log(JSON.stringify({
  status: "PASS",
  schemas: schemas.length,
  observation: observation.status,
  reconstruction: reconstruction.status,
  drill: drill.status,
  reproduction: result.status,
  review: review.verdict,
  handoff: handoff.status,
  hostile_cases: 10,
}));
