#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  DELIVERY_OUTCOMES,
  advanceDeliveryState,
  assertCampaignCompletionEligible,
  authorizeRuntimeRequest,
  compileClosureRecord,
  compileDeliveryChoice,
  compileFinalHandoff,
  compileLiveAuditReceipt,
  compileNoExternalActionReceipt,
  compileRollbackReceipt,
  compileRuntimeReceipt,
  compileRuntimeRequest,
  createDeliveryState,
  validateDeliveryChoice,
  validateRuntimeReceipt,
} from "../control/delivery-closure-state.mjs";
import {compileDeliveryAdapterContract} from "../control/delivery-adapter.mjs";
import {digestWithout} from "../control/delivery-closure-foundation.mjs";
import {
  approveRuntimeOperationAuthorization,
  compileRuntimeOperationAuthorization,
  compileRuntimeOperationCostProjection,
  operationForDeliveryAction,
} from "../control/delivery-operation-governance.mjs";

const SOURCE_COMMIT = "1".repeat(40);
const SOURCE_TREE = "2".repeat(40);
const ACCEPTED_RESULT = "a".repeat(64);
const FINAL_AUDIT = "b".repeat(64);
const POLICY = "c".repeat(64);
const SCOPE = "d".repeat(64);
const EVIDENCE = "e".repeat(64);
const TEMPORARY_CLOSURE = "f".repeat(64);
const OTHER_DIGEST = "0".repeat(64);
const RUNTIME_REF = "opaque:runtime-delivery";
const ENVIRONMENT_REF = "opaque:environment-production";
const BASE_TIME = Date.parse("2026-08-06T12:00:00.000Z");
const ADAPTER = compileDeliveryAdapterContract({adapter_ref: "delivery-adapter", protocol: "typed-host-v1", policy_digest: POLICY});

function time(offset = 0) {
  return new Date(BASE_TIME + offset * 1000).toISOString();
}

function ownerApproval(tag, scopeDigest = SCOPE) {
  return {
    decision: "APPROVE",
    scope_digest: scopeDigest,
    approval_ref: `opaque:approval-${tag}`,
    approved_at_utc: time(1),
  };
}

function makeChoice(outcome, {
  choiceId = `choice-${outcome.toLowerCase()}`,
  rollbackTargetDigest = null,
} = {}) {
  const prepared = outcome === "PREPARED";
  const environment = ["DEPLOY", "RELEASE", "ROLLBACK"].includes(outcome) ? ENVIRONMENT_REF : null;
  return compileDeliveryChoice({
    choice_id: choiceId,
    outcome,
    project_ref: "project-portable",
    campaign_id: "campaign-delivery",
    campaign_version: 1,
    goal_id: "goal-accepted-result",
    accepted_result_digest: prepared ? null : ACCEPTED_RESULT,
    final_audit_digest: prepared ? null : FINAL_AUDIT,
    source_commit: SOURCE_COMMIT,
    source_tree: SOURCE_TREE,
    worktree_ref: `opaque:worktree-${choiceId}`,
    environment_ref: environment,
    scope_digest: SCOPE,
    policy_digest: POLICY,
    rollback_target_digest: outcome === "ROLLBACK" ? (rollbackTargetDigest ?? OTHER_DIGEST) : null,
    owner_approval: ownerApproval(choiceId),
    selected_at_utc: time(2),
  });
}

function makeState(tag) {
  return createDeliveryState({
    state_id: `state-${tag}`,
    project_ref: "project-portable",
    campaign_id: "campaign-delivery",
    campaign_version: 1,
    goal_id: "goal-accepted-result",
    updated_at_utc: time(3),
  });
}

function selectChoice(state, choice, offset = 4) {
  return advanceDeliveryState({
    state,
    expected_revision: state.revision,
    transition: "SELECT_CHOICE",
    choice,
    updated_at_utc: time(offset),
  });
}

function closeState({state, choice, request = null, receipt = null, liveAudit = null, rollbackReceipt = null, nextAction = "NONE", tag}) {
  const adapter = ["PUSH", "MERGE", "DEPLOY", "RELEASE", "ROLLBACK"].includes(choice.outcome) ? ADAPTER : null;
  const handoff = compileFinalHandoff({
    handoff_id: `handoff-${tag}`,
    state,
    choice,
    receipt,
    adapter_contract: adapter,
    receipt_digests: receipt ? [receipt.digest, ...(rollbackReceipt ? [rollbackReceipt.digest] : [])] : [],
    live_audit_digest: liveAudit?.digest ?? null,
    rollback_receipt_digest: rollbackReceipt?.digest ?? null,
    open_risk_codes: [],
    deferred_item_codes: [],
    next_action: nextAction,
    created_at_utc: time(20),
  });
  const closure = compileClosureRecord({
    closure_id: `closure-${tag}`,
    state,
    choice,
    final_handoff: handoff,
    receipt,
    live_audit: liveAudit,
    rollback_receipt: rollbackReceipt,
    adapter_contract: adapter,
    receipt_digest: receipt?.digest ?? null,
    live_audit_digest: liveAudit?.digest ?? null,
    rollback_receipt_digest: rollbackReceipt?.digest ?? null,
    temporary_closure_digest: TEMPORARY_CLOSURE,
    closed_at_utc: time(21),
  });
  const closed = advanceDeliveryState({
    state,
    expected_revision: state.revision,
    transition: "CLOSE",
    choice,
    request,
    receipt,
    live_audit: liveAudit,
    rollback_receipt: rollbackReceipt,
    adapter_contract: adapter,
    final_handoff: handoff,
    closure,
    updated_at_utc: time(22),
  });
  return {closed, handoff, closure};
}

function prepareOperationAuthorization(choice, tag, offset = 30) {
  const action = choice.outcome;
  const operation = operationForDeliveryAction(action);
  const routeClass = ["PUSH", "MERGE"].includes(action) ? "SOURCE_CONTROL" : "LOCAL";
  const operationAuthorization = compileRuntimeOperationAuthorization({
    operation_id: `operation-${tag}`,
    operation,
    policy_digest: choice.policy_digest,
    adapter_contract_digest: ADAPTER.digest,
    choice_digest: choice.digest,
    source_commit: choice.source_commit,
    source_tree: choice.source_tree,
    artifact_digest: choice.accepted_result_digest,
    environment_ref: choice.environment_ref,
    route_class: routeClass,
    provider_id: null,
    environment_ids: choice.environment_ref === null ? [] : ["synthetic"],
    cost_projection: compileRuntimeOperationCostProjection({
      currency: "USD",
      one_time_cost: 0,
      recurring_monthly_cost: 0,
      runner_minutes: 1,
      expected_duration_minutes: 1,
      worst_case_duration_minutes: 2,
      max_concurrency: 1,
      rollback_one_time_cost: 0,
      rollback_recurring_monthly_cost: 0,
      confidence: "MEASURED",
      basis: ["TEST_FIXTURE_ESTIMATE"],
      boundary_status: "WITHIN",
    }),
    requested_at_utc: time(offset),
  });
  return approveRuntimeOperationAuthorization(operationAuthorization, {
    decision_ref: `opaque:operation-approval-${tag}`,
    decided_at_utc: time(offset + 1),
  });
}

function authorize(choice, tag, offset = 30) {
  const operationAuthorization = prepareOperationAuthorization(choice, tag, offset);
  const request = compileRuntimeRequest({
    request_id: `request-${tag}`,
    choice,
    runtime_ref: RUNTIME_REF,
    requested_at_utc: time(offset),
    adapter_contract: ADAPTER,
    operation_authorization: operationAuthorization,
  });
  return authorizeRuntimeRequest(request, {choice, adapter_contract: ADAPTER, operation_authorization: operationAuthorization, authorized_at_utc: time(offset + 1)});
}

function externalReceipt(request, receiptId, status, offset, resultRef = null, errorCode = null) {
  return compileRuntimeReceipt({
    receipt_id: receiptId,
    request,
    status,
    external_result_ref: resultRef,
    evidence_digest: EVIDENCE,
    error_code: errorCode,
    observed_at_utc: time(offset),
    adapter_contract: ADAPTER,
  });
}

// Every supported outcome is explicit and content-addressed.
for (const outcome of DELIVERY_OUTCOMES) {
  const choice = makeChoice(outcome, {choiceId: `choice-inventory-${outcome.toLowerCase()}`});
  assert.equal(choice.outcome, outcome);
  assert.equal(choice.status, "PREPARED_NOT_ACTIVATED");
  validateDeliveryChoice(choice);
}

// A campaign cannot claim completion before an owner choice and closure.
const emptyState = makeState("required");
assert.equal(emptyState.status, "CHOICE_REQUIRED");
assert.throws(() => advanceDeliveryState({
  state: emptyState,
  expected_revision: emptyState.revision,
  transition: "CLOSE",
  updated_at_utc: time(4),
}), /selected choice/u);

// Explicit PREPARED is a valid no-delivery completion only after final handoff and roster closure.
const preparedChoice = makeChoice("PREPARED", {choiceId: "choice-prepared"});
let preparedState = selectChoice(makeState("prepared"), preparedChoice);
preparedState = advanceDeliveryState({
  state: preparedState,
  expected_revision: preparedState.revision,
  transition: "MARK_PREPARED",
  updated_at_utc: time(5),
});
const prepared = closeState({state: preparedState, choice: preparedChoice, nextAction: "OWNER_REVIEW", tag: "prepared"});
assert.equal(prepared.handoff.completion_status, "PREPARED_NO_DELIVERY");
assert.deepEqual(assertCampaignCompletionEligible({
  state: prepared.closed,
  choice: preparedChoice,
  final_handoff: prepared.handoff,
  closure: prepared.closure,
}), {
  eligible: true,
  completion_status: "PREPARED_NO_DELIVERY",
  outcome: "PREPARED",
  choice_digest: preparedChoice.digest,
  closure_digest: prepared.closure.digest,
});

// LOCAL_ONLY proves that no Runtime request is needed and that the no-external receipt is explicit.
const localChoice = makeChoice("LOCAL_ONLY", {choiceId: "choice-local"});
let localState = selectChoice(makeState("local"), localChoice);
const localReceipt = compileNoExternalActionReceipt({
  receipt_id: "receipt-local",
  choice: localChoice,
  evidence_digest: EVIDENCE,
  observed_at_utc: time(6),
});
localState = advanceDeliveryState({
  state: localState,
  expected_revision: localState.revision,
  transition: "NO_EXTERNAL_ACTION",
  choice: localChoice,
  receipt: localReceipt,
  updated_at_utc: time(7),
});
const local = closeState({state: localState, choice: localChoice, receipt: localReceipt, tag: "local"});
assert.equal(local.closed.status, "CLOSED");
assert.equal(assertCampaignCompletionEligible({
  state: local.closed,
  choice: localChoice,
  final_handoff: local.handoff,
  closure: local.closure,
  receipt: localReceipt,
}).eligible, true);

// PUSH proves the Runtime request/receipt boundary and CAS-style state progression.
const pushChoice = makeChoice("PUSH", {choiceId: "choice-push"});
let pushState = selectChoice(makeState("push"), pushChoice);
const pushRequest = authorize(pushChoice, "push", 40);
pushState = advanceDeliveryState({
  state: pushState,
  expected_revision: pushState.revision,
  transition: "AUTHORIZE_RUNTIME",
  choice: pushChoice,
  request: pushRequest,
  adapter_contract: ADAPTER,
  updated_at_utc: time(42),
});
const pushInFlight = externalReceipt(pushRequest, "receipt-push-in-flight", "IN_FLIGHT", 43);
pushState = advanceDeliveryState({
  state: pushState,
  expected_revision: pushState.revision,
  transition: "DISPATCH",
  request: pushRequest,
  receipt: pushInFlight,
  adapter_contract: ADAPTER,
  updated_at_utc: time(44),
});
const pushReceipt = externalReceipt(pushRequest, "receipt-push-success", "SUCCEEDED", 45, "opaque:push-result");
pushState = advanceDeliveryState({
  state: pushState,
  expected_revision: pushState.revision,
  transition: "RECONCILE_RECEIPT",
  choice: pushChoice,
  request: pushRequest,
  receipt: pushReceipt,
  adapter_contract: ADAPTER,
  updated_at_utc: time(46),
});
assert.equal(pushState.status, "CLOSURE_PENDING");
const push = closeState({state: pushState, choice: pushChoice, receipt: pushReceipt, tag: "push"});
assert.equal(assertCampaignCompletionEligible({
  state: push.closed,
  choice: pushChoice,
  final_handoff: push.handoff,
  closure: push.closure,
  receipt: pushReceipt,
  adapter_contract: ADAPTER,
}).eligible, true);

// Failed delivery preserves its receipt and can re-enter only through a fresh choice.
const failedChoice = makeChoice("PUSH", {choiceId: "choice-failed"});
let failedState = selectChoice(makeState("failed"), failedChoice);
const failedRequest = authorize(failedChoice, "failed", 80);
failedState = advanceDeliveryState({state: failedState, expected_revision: failedState.revision, transition: "AUTHORIZE_RUNTIME", choice: failedChoice, request: failedRequest, adapter_contract: ADAPTER, updated_at_utc: time(82)});
const failedInFlight = externalReceipt(failedRequest, "receipt-failed-in-flight", "IN_FLIGHT", 83);
failedState = advanceDeliveryState({state: failedState, expected_revision: failedState.revision, transition: "DISPATCH", request: failedRequest, receipt: failedInFlight, adapter_contract: ADAPTER, updated_at_utc: time(84)});
const failedReceipt = externalReceipt(failedRequest, "receipt-failed", "FAILED", 85, null, "REMOTE_ACTION_FAILED");
failedState = advanceDeliveryState({state: failedState, expected_revision: failedState.revision, transition: "RECONCILE_RECEIPT", choice: failedChoice, request: failedRequest, receipt: failedReceipt, adapter_contract: ADAPTER, updated_at_utc: time(86)});
assert.equal(failedState.status, "FAILED");
const reopenedState = advanceDeliveryState({state: failedState, expected_revision: failedState.revision, transition: "REOPEN_AFTER_FAILURE", receipt: failedReceipt, adapter_contract: ADAPTER, updated_at_utc: time(87)});
assert.equal(reopenedState.status, "CHOICE_REQUIRED");
assert.equal(reopenedState.receipt_digest, failedReceipt.digest);

const mismatchedRequest = {...pushRequest, source_commit: "3".repeat(40), digest: null};
mismatchedRequest.digest = digestWithout(mismatchedRequest);
assert.throws(() => authorizeRuntimeRequest(mismatchedRequest, {choice: pushChoice, adapter_contract: ADAPTER, operation_authorization: prepareOperationAuthorization(pushChoice, "mismatched", 88), authorized_at_utc: time(88)}), /source differs from selected choice/u);

const omittedReceiptHandoff = {...push.handoff, receipt_digests: [OTHER_DIGEST], digest: null};
omittedReceiptHandoff.digest = digestWithout(omittedReceiptHandoff);
assert.throws(() => assertCampaignCompletionEligible({
  state: push.closed,
  choice: pushChoice,
  final_handoff: omittedReceiptHandoff,
  closure: push.closure,
  receipt: pushReceipt,
  adapter_contract: ADAPTER,
}), /omits the action receipt|final handoff differs/u);
assert.throws(() => assertCampaignCompletionEligible({
  state: push.closed,
  choice: pushChoice,
  final_handoff: push.handoff,
  closure: push.closure,
  receipt: pushReceipt,
}), /prepared adapter contract/u);

// DEPLOY requires an independent live audit before closure.
const deployChoice = makeChoice("DEPLOY", {choiceId: "choice-deploy"});
let deployState = selectChoice(makeState("deploy"), deployChoice);
const deployRequest = authorize(deployChoice, "deploy", 50);
deployState = advanceDeliveryState({
  state: deployState,
  expected_revision: deployState.revision,
  transition: "AUTHORIZE_RUNTIME",
  choice: deployChoice,
  request: deployRequest,
  adapter_contract: ADAPTER,
  updated_at_utc: time(52),
});
const deployInFlight = externalReceipt(deployRequest, "receipt-deploy-in-flight", "IN_FLIGHT", 53);
deployState = advanceDeliveryState({
  state: deployState,
  expected_revision: deployState.revision,
  transition: "DISPATCH",
  request: deployRequest,
  receipt: deployInFlight,
  adapter_contract: ADAPTER,
  updated_at_utc: time(54),
});
const deployReceipt = externalReceipt(deployRequest, "receipt-deploy-success", "SUCCEEDED", 55, "opaque:deployment-result");
deployState = advanceDeliveryState({
  state: deployState,
  expected_revision: deployState.revision,
  transition: "RECONCILE_RECEIPT",
  choice: deployChoice,
  request: deployRequest,
  receipt: deployReceipt,
  adapter_contract: ADAPTER,
  updated_at_utc: time(56),
});
assert.equal(deployState.status, "LIVE_AUDIT_PENDING");
const deployAwaitingAudit = deployState;
assert.throws(() => advanceDeliveryState({
  state: deployState,
  expected_revision: deployState.revision,
  transition: "CLOSE",
  updated_at_utc: time(57),
}), /closure requires/u);
const unknownLiveAudit = compileLiveAuditReceipt({
  audit_id: "audit-deploy-unknown",
  choice: deployChoice,
  action_receipt: deployReceipt,
  independent_auditor_ref: "opaque:auditor-unknown-live",
  status: "UNKNOWN",
  evidence_digest: EVIDENCE,
  audited_at_utc: time(57),
  adapter_contract: ADAPTER,
});
const unknownLiveState = advanceDeliveryState({
  state: deployAwaitingAudit,
  expected_revision: deployAwaitingAudit.revision,
  transition: "REGISTER_LIVE_AUDIT",
  choice: deployChoice,
  receipt: deployReceipt,
  live_audit: unknownLiveAudit,
  adapter_contract: ADAPTER,
  updated_at_utc: time(58),
});
assert.equal(unknownLiveState.status, "UNKNOWN");
const reopenedUnknownLiveState = advanceDeliveryState({
  state: unknownLiveState,
  expected_revision: unknownLiveState.revision,
  transition: "REOPEN_AFTER_FAILURE",
  receipt: deployReceipt,
  live_audit: unknownLiveAudit,
  adapter_contract: ADAPTER,
  updated_at_utc: time(59),
});
assert.equal(reopenedUnknownLiveState.status, "CHOICE_REQUIRED");
assert.equal(reopenedUnknownLiveState.receipt_digest, deployReceipt.digest);
const liveAudit = compileLiveAuditReceipt({
  audit_id: "audit-deploy-pass",
  choice: deployChoice,
  action_receipt: deployReceipt,
  independent_auditor_ref: "opaque:auditor-live",
  status: "PASS",
  evidence_digest: EVIDENCE,
  audited_at_utc: time(60),
  adapter_contract: ADAPTER,
});
deployState = advanceDeliveryState({
  state: deployState,
  expected_revision: deployState.revision,
  transition: "REGISTER_LIVE_AUDIT",
  choice: deployChoice,
  receipt: deployReceipt,
  live_audit: liveAudit,
  adapter_contract: ADAPTER,
  updated_at_utc: time(61),
});
const deploy = closeState({state: deployState, choice: deployChoice, receipt: deployReceipt, liveAudit, tag: "deploy"});
assert.equal(assertCampaignCompletionEligible({
  state: deploy.closed,
  choice: deployChoice,
  final_handoff: deploy.handoff,
  closure: deploy.closure,
  receipt: deployReceipt,
  live_audit: liveAudit,
  adapter_contract: ADAPTER,
}).eligible, true);

// A failed live audit requires a new, explicit ROLLBACK choice targeting the exact deployment receipt.
let failedLiveState = deployAwaitingAudit;
const failedLiveAudit = compileLiveAuditReceipt({
  audit_id: "audit-deploy-fail",
  choice: deployChoice,
  action_receipt: deployReceipt,
  independent_auditor_ref: "opaque:auditor-failed-live",
  status: "FAIL",
  evidence_digest: EVIDENCE,
  audited_at_utc: time(62),
  adapter_contract: ADAPTER,
});
failedLiveState = advanceDeliveryState({
  state: failedLiveState,
  expected_revision: failedLiveState.revision,
  transition: "REGISTER_LIVE_AUDIT",
  choice: deployChoice,
  receipt: deployReceipt,
  live_audit: failedLiveAudit,
  adapter_contract: ADAPTER,
  updated_at_utc: time(63),
});
assert.equal(failedLiveState.status, "ROLLBACK_REQUIRED");
const rollbackChoice = makeChoice("ROLLBACK", {
  choiceId: "choice-rollback",
  rollbackTargetDigest: deployReceipt.digest,
});
let rollbackState = selectChoice(failedLiveState, rollbackChoice, 62);
const rollbackRequest = authorize(rollbackChoice, "rollback", 63);
rollbackState = advanceDeliveryState({
  state: rollbackState,
  expected_revision: rollbackState.revision,
  transition: "AUTHORIZE_RUNTIME",
  choice: rollbackChoice,
  request: rollbackRequest,
  adapter_contract: ADAPTER,
  updated_at_utc: time(65),
});
const rollbackInFlight = externalReceipt(rollbackRequest, "receipt-rollback-in-flight", "IN_FLIGHT", 66);
rollbackState = advanceDeliveryState({
  state: rollbackState,
  expected_revision: rollbackState.revision,
  transition: "DISPATCH",
  request: rollbackRequest,
  receipt: rollbackInFlight,
  adapter_contract: ADAPTER,
  updated_at_utc: time(67),
});
const rollbackActionReceipt = externalReceipt(rollbackRequest, "receipt-rollback-success", "SUCCEEDED", 68, "opaque:rollback-result");
rollbackState = advanceDeliveryState({
  state: rollbackState,
  expected_revision: rollbackState.revision,
  transition: "RECONCILE_RECEIPT",
  choice: rollbackChoice,
  request: rollbackRequest,
  receipt: rollbackActionReceipt,
  adapter_contract: ADAPTER,
  updated_at_utc: time(69),
});
const rollbackReceipt = compileRollbackReceipt({
  rollback_id: "rollback-verified",
  request: rollbackRequest,
  choice: rollbackChoice,
  target_receipt_digest: deployReceipt.digest,
  target_external_result_ref: deployReceipt.external_result_ref,
  restored_external_result_ref: "opaque:restored-result",
  status: "SUCCEEDED",
  verified: true,
  evidence_digest: EVIDENCE,
  observed_at_utc: time(70),
  adapter_contract: ADAPTER,
});
rollbackState = advanceDeliveryState({
  state: rollbackState,
  expected_revision: rollbackState.revision,
  transition: "REGISTER_ROLLBACK_RECEIPT",
  request: rollbackRequest,
  choice: rollbackChoice,
  rollback_receipt: rollbackReceipt,
  adapter_contract: ADAPTER,
  updated_at_utc: time(71),
});
const rollback = closeState({
  state: rollbackState,
  choice: rollbackChoice,
  request: rollbackRequest,
  receipt: rollbackActionReceipt,
  rollbackReceipt,
  tag: "rollback",
});
assert.equal(assertCampaignCompletionEligible({
  state: rollback.closed,
  choice: rollbackChoice,
  final_handoff: rollback.handoff,
  closure: rollback.closure,
  receipt: rollbackActionReceipt,
  rollback_receipt: rollbackReceipt,
  adapter_contract: ADAPTER,
}).eligible, true);

// Hostile and boundary cases.
assert.throws(() => compileDeliveryChoice({
  ...makeChoice("LOCAL_ONLY", {choiceId: "choice-invalid-approval"}),
  owner_approval: null,
}), /owner approval/u);
assert.throws(() => compileDeliveryChoice({
  choice_id: "choice-secret",
  outcome: "LOCAL_ONLY",
  project_ref: ["api", "key"].join("_") + "=material",
  campaign_id: "campaign-delivery",
  campaign_version: 1,
  goal_id: "goal-accepted-result",
  accepted_result_digest: ACCEPTED_RESULT,
  final_audit_digest: FINAL_AUDIT,
  source_commit: SOURCE_COMMIT,
  source_tree: SOURCE_TREE,
  worktree_ref: "opaque:worktree-secret",
  environment_ref: null,
  scope_digest: SCOPE,
  policy_digest: POLICY,
  rollback_target_digest: null,
  owner_approval: ownerApproval("secret"),
  selected_at_utc: time(72),
}), /secret material/u);
const unauthorizedOperation = prepareOperationAuthorization(pushChoice, "unauthorized", 73);
const unauthorizedRequest = compileRuntimeRequest({
  request_id: "request-unauthorized",
  choice: pushChoice,
  runtime_ref: RUNTIME_REF,
  requested_at_utc: time(73),
  adapter_contract: ADAPTER,
  operation_authorization: unauthorizedOperation,
});
assert.throws(() => authorizeRuntimeRequest(unauthorizedRequest, {choice: pushChoice, adapter_contract: ADAPTER, operation_authorization: unauthorizedOperation, runtime_role: "OWNER", authorized_at_utc: time(74)}), /persistent Runtime/u);
assert.throws(() => advanceDeliveryState({
  state: pushState,
  expected_revision: 0,
  transition: "CLOSE",
  updated_at_utc: time(74),
}), /stale delivery state revision/u);
assert.throws(() => compileLiveAuditReceipt({
  audit_id: "audit-self",
  choice: deployChoice,
  action_receipt: deployReceipt,
  independent_auditor_ref: RUNTIME_REF,
  status: "PASS",
  evidence_digest: EVIDENCE,
  audited_at_utc: time(75),
  adapter_contract: ADAPTER,
}), /independent/u);
const mismatchedReceipt = {...pushReceipt, choice_digest: deployChoice.digest, digest: null};
mismatchedReceipt.digest = "1".repeat(64);
assert.throws(() => validateRuntimeReceipt(mismatchedReceipt, {adapter_contract: ADAPTER}), /digest does not match content/u);
assert.throws(() => advanceDeliveryState({
  state: failedLiveState,
  expected_revision: failedLiveState.revision,
  transition: "SELECT_CHOICE",
  choice: makeChoice("ROLLBACK", {choiceId: "choice-wrong-rollback", rollbackTargetDigest: OTHER_DIGEST}),
  updated_at_utc: time(76),
}), /failed delivery receipt/u);
assert.throws(() => compileDeliveryChoice({
  choice_id: "choice-private-ref",
  outcome: "LOCAL_ONLY",
  project_ref: "project-portable",
  campaign_id: "campaign-delivery",
  campaign_version: 1,
  goal_id: "goal-accepted-result",
  accepted_result_digest: ACCEPTED_RESULT,
  final_audit_digest: FINAL_AUDIT,
  source_commit: SOURCE_COMMIT,
  source_tree: SOURCE_TREE,
  worktree_ref: [String.fromCharCode(47), "tmp", "delivery", "worktree"].join("/"),
  environment_ref: null,
  scope_digest: SCOPE,
  policy_digest: POLICY,
  rollback_target_digest: null,
  owner_approval: ownerApproval("private-ref"),
  selected_at_utc: time(77),
}), /private path|opaque reference/u);

console.log("PASS delivery closure state: explicit owner outcomes, Runtime boundary, CAS transitions, live-audit gate, rollback targeting, final handoff, closure, completion eligibility, and hostile privacy tests");
