#!/usr/bin/env node

import * as common from "./delivery-closure-foundation.mjs";
import * as records from "./delivery-closure-records.mjs";

const {
  ACTION_BY_OUTCOME,
  LIVE_OUTCOMES,
  assert,
  enumValue,
  nonnegativeInteger,
} = common;

const {
  validateDeliveryChoice,
  validateDeliveryState,
  validateRuntimeRequest,
  validateRuntimeReceipt,
  validateLiveAuditReceipt,
  validateRollbackReceipt,
  validateFinalHandoff,
  validateClosureRecord,
  nextState,
  requireChoiceForState,
  stateContext,
} = records;

export const DELIVERY_TRANSITIONS = Object.freeze([
  "SELECT_CHOICE",
  "REOPEN_AFTER_FAILURE",
  "MARK_PREPARED",
  "NO_EXTERNAL_ACTION",
  "AUTHORIZE_RUNTIME",
  "DISPATCH",
  "RECONCILE_RECEIPT",
  "REGISTER_LIVE_AUDIT",
  "REGISTER_ROLLBACK_RECEIPT",
  "CLOSE",
]);

export function advanceDeliveryState({
  state,
  expected_revision,
  transition,
  choice = null,
  request = null,
  receipt = null,
  live_audit = null,
  rollback_receipt = null,
  closure = null,
  final_handoff = null,
  adapter_contract = null,
  updated_at_utc,
} = {}) {
  validateDeliveryState(state);
  nonnegativeInteger(expected_revision, "expected state revision");
  assert(state.revision === expected_revision, "stale delivery state revision");
  enumValue(transition, DELIVERY_TRANSITIONS, "delivery state transition");

  if (transition === "REOPEN_AFTER_FAILURE") {
    assert(["FAILED", "UNKNOWN"].includes(state.status), "only failed or unknown delivery can be reopened");
    assert(receipt !== null && adapter_contract !== null, "reopen requires the failed action receipt and adapter contract");
    const hasLiveAuditEvidence = state.live_audit_digest !== null;
    if (hasLiveAuditEvidence) {
      assert(state.status === "UNKNOWN" && live_audit?.status === "UNKNOWN", "unknown live-audit re-entry requires its preserved audit evidence");
      validateRuntimeReceipt(receipt, {adapter_contract});
      assert(receipt.digest === state.receipt_digest, "reopen live-audit action receipt differs from state");
      validateLiveAuditReceipt(live_audit, {action_receipt: receipt, adapter_contract});
      assert(live_audit.digest === state.live_audit_digest, "reopen live-audit evidence differs from state");
    } else {
      assert(live_audit === null, "receipt-only re-entry cannot attach unbound live-audit evidence");
      validateRuntimeReceipt(receipt, {adapter_contract});
      assert(receipt.digest === state.receipt_digest && ["FAILED", "UNKNOWN"].includes(receipt.status), "reopen must preserve the failed or unknown receipt");
    }
    return nextState(state, {
      status: "CHOICE_REQUIRED",
      choice_digest: null,
      outcome: null,
      runtime_request_digest: null,
      live_audit_digest: null,
      rollback_receipt_digest: null,
      closure_digest: null,
      final_handoff_digest: null,
    }, updated_at_utc);
  }

  if (transition === "SELECT_CHOICE") {
    assert(state.status === "CHOICE_REQUIRED" || state.status === "ROLLBACK_REQUIRED", "choice cannot be selected from this state");
    requireChoiceForState(choice, state);
    if (state.status === "ROLLBACK_REQUIRED") {
      assert(choice.outcome === "ROLLBACK", "rollback-required state accepts only a rollback choice");
      assert(choice.rollback_target_digest === state.receipt_digest, "rollback choice does not target the failed delivery receipt");
    }
    return nextState(state, {
      status: "CHOICE_SELECTED",
      choice_digest: choice.digest,
      outcome: choice.outcome,
      runtime_request_digest: null,
      receipt_digest: null,
      live_audit_digest: null,
      rollback_receipt_digest: null,
      closure_digest: null,
      final_handoff_digest: null,
    }, updated_at_utc);
  }

  assert(state.choice_digest !== null && state.outcome !== null, "delivery transition requires a selected choice");

  if (transition === "MARK_PREPARED") {
    assert(state.status === "CHOICE_SELECTED" && state.outcome === "PREPARED", "only a prepared choice may enter prepared closure");
    return nextState(state, {status: "CLOSURE_PENDING"}, updated_at_utc);
  }

  if (transition === "NO_EXTERNAL_ACTION") {
    assert(state.status === "CHOICE_SELECTED" && state.outcome === "LOCAL_ONLY", "only a local-only choice may close without external action");
    assert(choice !== null, "no-external closure requires the selected choice");
    validateDeliveryChoice(choice, stateContext(state));
    assert(choice.digest === state.choice_digest && choice.outcome === "LOCAL_ONLY", "no-external choice differs from state");
    validateRuntimeReceipt(receipt, {choice});
    assert(receipt.status === "NO_EXTERNAL_ACTION" && receipt.choice_digest === state.choice_digest, "no-external receipt is not bound to the local-only choice");
    return nextState(state, {status: "CLOSURE_PENDING", receipt_digest: receipt.digest}, updated_at_utc);
  }

  if (transition === "AUTHORIZE_RUNTIME") {
    assert(state.status === "CHOICE_SELECTED", "Runtime authorization requires a selected choice");
    assert(choice !== null && adapter_contract !== null, "Runtime authorization requires the selected choice and adapter contract");
    validateDeliveryChoice(choice, stateContext(state));
    assert(choice.digest === state.choice_digest && choice.outcome === state.outcome, "Runtime authorization choice differs from state");
    validateRuntimeRequest(request, {...stateContext(state), choice, adapter_contract});
    assert(request.status === "AUTHORIZED" && request.choice_digest === state.choice_digest, "Runtime request is not authorized for this choice");
    assert(request.action === ACTION_BY_OUTCOME[state.outcome], "Runtime action differs from selected outcome");
    return nextState(state, {status: "RUNTIME_AUTHORIZED", runtime_request_digest: request.digest}, updated_at_utc);
  }

  if (transition === "DISPATCH") {
    assert(state.status === "RUNTIME_AUTHORIZED", "dispatch requires Runtime authorization");
    assert(request !== null && adapter_contract !== null, "dispatch requires the authorized request and adapter contract");
    validateRuntimeRequest(request, {adapter_contract});
    assert(request.digest === state.runtime_request_digest, "dispatch request differs from authorized Runtime request");
    validateRuntimeReceipt(receipt, {request, adapter_contract});
    assert(receipt.status === "IN_FLIGHT" && receipt.request_digest === state.runtime_request_digest, "dispatch receipt is not in flight for this request");
    return nextState(state, {status: "ACTION_IN_FLIGHT", receipt_digest: receipt.digest}, updated_at_utc);
  }

  if (transition === "RECONCILE_RECEIPT") {
    assert(state.status === "ACTION_IN_FLIGHT", "receipt reconciliation requires an in-flight action");
    assert(request !== null && choice !== null && adapter_contract !== null, "receipt reconciliation requires the selected choice, request, and adapter contract");
    validateDeliveryChoice(choice, stateContext(state));
    assert(choice.digest === state.choice_digest && choice.outcome === state.outcome, "receipt reconciliation choice differs from state");
    validateRuntimeRequest(request, {...stateContext(state), choice, adapter_contract});
    assert(request.digest === state.runtime_request_digest, "receipt reconciliation request differs from state");
    validateRuntimeReceipt(receipt, {request, choice, adapter_contract});
    assert(receipt.request_digest === state.runtime_request_digest && receipt.choice_digest === state.choice_digest, "receipt is not bound to the in-flight action");
    assert(receipt.outcome === state.outcome && receipt.action === ACTION_BY_OUTCOME[state.outcome], "receipt outcome/action differs from selected choice");
    if (receipt.status === "FAILED") return nextState(state, {status: "FAILED", receipt_digest: receipt.digest}, updated_at_utc);
    if (receipt.status === "UNKNOWN") return nextState(state, {status: "UNKNOWN", receipt_digest: receipt.digest}, updated_at_utc);
    assert(receipt.status === "SUCCEEDED", "receipt must be successful, failed, or unknown");
    return nextState(state, {
      status: LIVE_OUTCOMES.has(state.outcome) ? "LIVE_AUDIT_PENDING" : "CLOSURE_PENDING",
      receipt_digest: receipt.digest,
    }, updated_at_utc);
  }

  if (transition === "REGISTER_LIVE_AUDIT") {
    assert(state.status === "LIVE_AUDIT_PENDING", "live audit is not pending");
    assert(choice !== null && receipt !== null && adapter_contract !== null, "live audit requires the selected choice, action receipt, and adapter contract");
    validateDeliveryChoice(choice, stateContext(state));
    validateRuntimeReceipt(receipt, {choice, adapter_contract});
    assert(receipt.digest === state.receipt_digest, "live audit action receipt differs from state");
    validateLiveAuditReceipt(live_audit, {choice, action_receipt: receipt, adapter_contract});
    assert(live_audit.choice_digest === state.choice_digest && live_audit.action_receipt_digest === state.receipt_digest && live_audit.status !== undefined, "live audit is not bound to this choice and receipt");
    if (live_audit.status === "PASS") return nextState(state, {status: "CLOSURE_PENDING", live_audit_digest: live_audit.digest}, updated_at_utc);
    if (live_audit.status === "FAIL") return nextState(state, {status: "ROLLBACK_REQUIRED", live_audit_digest: live_audit.digest}, updated_at_utc);
    return nextState(state, {status: "UNKNOWN", live_audit_digest: live_audit.digest}, updated_at_utc);
  }

  if (transition === "REGISTER_ROLLBACK_RECEIPT") {
    assert(state.status === "CLOSURE_PENDING" && state.outcome === "ROLLBACK", "rollback receipt is not pending");
    assert(choice !== null && request !== null && adapter_contract !== null, "rollback receipt requires the selected choice, request, and adapter contract");
    validateDeliveryChoice(choice, stateContext(state));
    validateRuntimeRequest(request, {...stateContext(state), choice, adapter_contract});
    validateRollbackReceipt(rollback_receipt, {request, choice, adapter_contract});
    assert(rollback_receipt.choice_digest === state.choice_digest, "rollback receipt is not bound to this choice");
    assert(rollback_receipt.status === "SUCCEEDED" && rollback_receipt.verified === true, "rollback receipt is not verified");
    return nextState(state, {rollback_receipt_digest: rollback_receipt.digest}, updated_at_utc);
  }

  assert(transition === "CLOSE", "unsupported delivery transition");
  assert(state.status === "CLOSURE_PENDING", "closure requires a closure-pending state");
  assert(choice !== null, "closure requires the selected choice");
  validateDeliveryChoice(choice, stateContext(state));
  assert(choice.digest === state.choice_digest && choice.outcome === state.outcome, "closure choice differs from state");
  if (state.outcome !== "PREPARED") assert(receipt !== null, "selected closure requires the action receipt");
  if (LIVE_OUTCOMES.has(state.outcome)) assert(live_audit !== null && adapter_contract !== null, "live closure requires the audit and adapter contract");
  if (state.outcome === "ROLLBACK") assert(rollback_receipt !== null && request !== null && adapter_contract !== null, "rollback closure requires the rollback receipt and request");
  if (receipt) validateRuntimeReceipt(receipt, {choice, adapter_contract});
  if (live_audit) validateLiveAuditReceipt(live_audit, {choice, action_receipt: receipt, adapter_contract});
  if (rollback_receipt) validateRollbackReceipt(rollback_receipt, {request, choice, adapter_contract});
  validateFinalHandoff(final_handoff, {choice, state, receipt, live_audit, rollback_receipt, adapter_contract});
  validateClosureRecord(closure, {state, choice, final_handoff, receipt, live_audit, rollback_receipt, adapter_contract});
  assert(closure.choice_digest === state.choice_digest && closure.outcome === state.outcome, "closure is not bound to the current choice");
  if (state.outcome === "ROLLBACK") assert(state.rollback_receipt_digest !== null && closure.rollback_receipt_digest === state.rollback_receipt_digest, "rollback closure lacks verified rollback receipt");
  if (LIVE_OUTCOMES.has(state.outcome)) assert(state.live_audit_digest !== null && closure.live_audit_digest === state.live_audit_digest, "live closure lacks the registered audit");
  if (state.outcome !== "PREPARED") assert(state.receipt_digest !== null && closure.receipt_digest === state.receipt_digest, "closure lacks the registered action receipt");
  return nextState(state, {status: "CLOSED", closure_digest: closure.digest, final_handoff_digest: final_handoff.digest}, updated_at_utc);
}

export function assertCampaignCompletionEligible({state, choice, final_handoff, closure, receipt = null, live_audit = null, rollback_receipt = null, adapter_contract = null} = {}) {
  validateDeliveryState(state);
  validateDeliveryChoice(choice, stateContext(state));
  assert(choice.digest === state.choice_digest && choice.outcome === state.outcome, "completion choice differs from state");
  validateFinalHandoff(final_handoff, {choice, receipt, live_audit, rollback_receipt, adapter_contract});
  validateClosureRecord(closure, {choice, final_handoff, receipt, live_audit, rollback_receipt, adapter_contract});
  assert(closure.preclosure_state_digest === final_handoff.state_digest, "completion closure and handoff pre-closure state differ");
  if (choice.outcome !== "PREPARED") assert(receipt !== null, "selected campaign completion requires the action receipt");
  if (LIVE_OUTCOMES.has(choice.outcome)) assert(live_audit !== null, "live campaign completion requires the live audit receipt");
  if (choice.outcome === "ROLLBACK") assert(rollback_receipt !== null, "rollback campaign completion requires the rollback receipt");
  assert(state.status === "CLOSED", "campaign completion is not eligible before delivery closure");
  assert(state.closure_digest === closure.digest && state.final_handoff_digest === final_handoff.digest, "campaign completion is not bound to final closure");
  const expectedCompletion = choice.outcome === "PREPARED" ? "PREPARED_NO_DELIVERY" : "SELECTED_RESULT";
  assert(final_handoff.completion_status === expectedCompletion, "campaign completion status does not match owner choice");
  return {
    eligible: true,
    completion_status: final_handoff.completion_status,
    outcome: choice.outcome,
    choice_digest: choice.digest,
    closure_digest: closure.digest,
  };
}

export {ACTION_BY_OUTCOME};
