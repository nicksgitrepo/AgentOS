#!/usr/bin/env node

import * as common from "./delivery-closure-foundation.mjs";
import {
  validateDeliveryAdapterForAction,
} from "./delivery-adapter.mjs";

const {
  DELIVERY_CHOICE_SCHEMA,
  DELIVERY_STATE_SCHEMA,
  RUNTIME_REQUEST_SCHEMA,
  RUNTIME_RECEIPT_SCHEMA,
  ROLLBACK_RECEIPT_SCHEMA,
  LIVE_AUDIT_SCHEMA,
  FINAL_HANDOFF_SCHEMA,
  CLOSURE_SCHEMA,
  DELIVERY_OUTCOMES,
  DELIVERY_ACTIONS,
  DELIVERY_STATE_STATUSES,
  RUNTIME_REQUEST_STATUSES,
  RUNTIME_RECEIPT_STATUSES,
  LIVE_AUDIT_STATUSES,
  CLOSURE_ROSTER_STATUSES,
  ACTION_BY_OUTCOME,
  EXTERNAL_OUTCOMES,
  LIVE_OUTCOMES,
  assert,
  requireRecord,
  exactKeys,
  requireString,
  nullableString,
  enumValue,
  safeId,
  safeCode,
  opaqueRef,
  nullableOpaqueRef,
  sha,
  nullableSha,
  sourceId,
  time,
  positiveInteger,
  nonnegativeInteger,
  canonicalDigest,
  digestWithout,
  withDigest,
  validateDigest,
  validateCodes,
  validateDigestList,
  contextMatches,
  validateOwnerApproval,
  compileOwnerApproval,
  validateChoiceBindings,
} = common;

export function validateDeliveryChoice(choice, expected = {}) {
  exactKeys(choice, [
    "schema", "version", "status", "choice_id", "outcome", "project_ref", "campaign_id",
    "campaign_version", "goal_id", "accepted_result_digest", "final_audit_digest", "source_commit",
    "source_tree", "worktree_ref", "environment_ref", "scope_digest", "policy_digest",
    "rollback_target_digest", "owner_approval", "selected_at_utc", "digest",
  ], "delivery choice");
  assert(choice.schema === DELIVERY_CHOICE_SCHEMA && choice.version === 2, "delivery choice identity is invalid");
  assert(choice.status === "PREPARED_NOT_ACTIVATED", "delivery choice must remain prepared and inactive");
  safeId(choice.choice_id, "choice ID");
  enumValue(choice.outcome, DELIVERY_OUTCOMES, "choice outcome");
  safeId(choice.project_ref, "choice project reference");
  safeId(choice.campaign_id, "choice campaign ID");
  positiveInteger(choice.campaign_version, "choice campaign version");
  safeId(choice.goal_id, "choice goal ID");
  sha(choice.scope_digest, "choice scope digest");
  sha(choice.policy_digest, "choice policy digest");
  nullableSha(choice.accepted_result_digest, "choice accepted result digest");
  nullableSha(choice.final_audit_digest, "choice final audit digest");
  validateChoiceBindings(choice);
  validateOwnerApproval(choice.owner_approval, choice.scope_digest);
  time(choice.selected_at_utc, "choice selected time");
  contextMatches(choice, expected, "delivery choice");
  if (expected.choice_digest !== undefined) assert(choice.digest === expected.choice_digest, "delivery choice digest differs from expected");
  validateDigest(choice.digest, "delivery choice digest", choice);
  return choice;
}

export function compileDeliveryChoice({
  choice_id,
  outcome,
  project_ref,
  campaign_id,
  campaign_version,
  goal_id,
  accepted_result_digest = null,
  final_audit_digest = null,
  source_commit,
  source_tree,
  worktree_ref,
  environment_ref = null,
  scope_digest,
  policy_digest,
  rollback_target_digest = null,
  owner_approval,
  selected_at_utc,
} = {}) {
  const choice = withDigest({
    schema: DELIVERY_CHOICE_SCHEMA,
    version: 2,
    status: "PREPARED_NOT_ACTIVATED",
    choice_id,
    outcome,
    project_ref,
    campaign_id,
    campaign_version,
    goal_id,
    accepted_result_digest,
    final_audit_digest,
    source_commit,
    source_tree,
    worktree_ref,
    environment_ref,
    scope_digest,
    policy_digest,
    rollback_target_digest,
    owner_approval: compileOwnerApproval(owner_approval, scope_digest),
    selected_at_utc,
  });
  return validateDeliveryChoice(choice);
}

function stateContext(state) {
  return {
    project_ref: state.project_ref,
    campaign_id: state.campaign_id,
    campaign_version: state.campaign_version,
    goal_id: state.goal_id,
  };
}

export function validateDeliveryState(state, expected = {}) {
  exactKeys(state, [
    "schema", "version", "state_id", "project_ref", "campaign_id", "campaign_version", "goal_id",
    "status", "choice_digest", "outcome", "runtime_request_digest", "receipt_digest", "live_audit_digest",
    "rollback_receipt_digest", "closure_digest", "final_handoff_digest", "revision", "updated_at_utc", "digest",
  ], "delivery state");
  assert(state.schema === DELIVERY_STATE_SCHEMA && state.version === 1, "delivery state identity is invalid");
  safeId(state.state_id, "state ID");
  safeId(state.project_ref, "state project reference");
  safeId(state.campaign_id, "state campaign ID");
  positiveInteger(state.campaign_version, "state campaign version");
  safeId(state.goal_id, "state goal ID");
  enumValue(state.status, DELIVERY_STATE_STATUSES, "delivery state status");
  nullableSha(state.choice_digest, "state choice digest");
  if (state.outcome !== null) enumValue(state.outcome, DELIVERY_OUTCOMES, "state outcome");
  for (const field of ["runtime_request_digest", "receipt_digest", "live_audit_digest", "rollback_receipt_digest", "closure_digest", "final_handoff_digest"]) {
    nullableSha(state[field], `state ${field}`);
  }
  nonnegativeInteger(state.revision, "state revision");
  time(state.updated_at_utc, "state update time");
  if (state.status === "CHOICE_REQUIRED") {
    assert(state.choice_digest === null && state.outcome === null, "choice-required state cannot contain a choice");
  } else {
    assert(state.choice_digest !== null && state.outcome !== null, "selected state must contain a choice");
  }
  if (["CLOSED"].includes(state.status)) {
    assert(state.closure_digest !== null && state.final_handoff_digest !== null, "closed state requires closure and final handoff");
  }
  if (state.status === "CHOICE_REQUIRED") {
    assert(state.runtime_request_digest === null && state.live_audit_digest === null && state.rollback_receipt_digest === null
      && state.closure_digest === null && state.final_handoff_digest === null, "choice-required state contains active delivery evidence");
  }
  if (["RUNTIME_AUTHORIZED", "ACTION_IN_FLIGHT"].includes(state.status)) assert(state.runtime_request_digest !== null, "active delivery state lacks Runtime request evidence");
  if (["ACTION_IN_FLIGHT", "RECEIPT_VERIFIED", "LIVE_AUDIT_PENDING", "CLOSURE_PENDING", "ROLLBACK_REQUIRED", "FAILED", "UNKNOWN"].includes(state.status)) {
    assert(state.receipt_digest !== null, "delivery state lacks action receipt evidence");
  }
  if (state.status === "LIVE_AUDIT_PENDING" || state.status === "ROLLBACK_REQUIRED") assert(state.live_audit_digest !== null, "live delivery state lacks live-audit evidence");
  if (state.status === "CLOSURE_PENDING" && state.outcome !== "PREPARED") assert(state.receipt_digest !== null, "closure-pending state lacks action receipt evidence");
  contextMatches(state, expected, "delivery state");
  validateDigest(state.digest, "delivery state digest", state);
  return state;
}

export function createDeliveryState({state_id, project_ref, campaign_id, campaign_version, goal_id, updated_at_utc} = {}) {
  const state = withDigest({
    schema: DELIVERY_STATE_SCHEMA,
    version: 1,
    state_id,
    project_ref,
    campaign_id,
    campaign_version,
    goal_id,
    status: "CHOICE_REQUIRED",
    choice_digest: null,
    outcome: null,
    runtime_request_digest: null,
    receipt_digest: null,
    live_audit_digest: null,
    rollback_receipt_digest: null,
    closure_digest: null,
    final_handoff_digest: null,
    revision: 0,
    updated_at_utc,
  });
  return validateDeliveryState(state);
}

function nextState(state, patch, updatedAt) {
  return validateDeliveryState(withDigest({
    ...state,
    ...patch,
    revision: state.revision + 1,
    updated_at_utc: updatedAt,
  }));
}

function requireChoiceForState(choice, state) {
  validateDeliveryChoice(choice, stateContext(state));
  return choice;
}

export function validateRuntimeRequest(request, expected = {}) {
  const {choice = null, adapter_contract = null, ...context} = expected;
  exactKeys(request, [
    "schema", "version", "request_id", "action", "choice_digest", "project_ref", "campaign_id",
    "campaign_version", "goal_id", "source_commit", "source_tree", "environment_ref", "scope_digest",
    "owner_approval_digest", "policy_digest", "adapter_contract_digest", "rollback_target_digest", "runtime_ref", "status", "requested_at_utc",
    "authorized_by_role", "authorized_at_utc", "digest",
  ], "Runtime delivery request");
  assert(request.schema === RUNTIME_REQUEST_SCHEMA && request.version === 1, "Runtime request identity is invalid");
  safeId(request.request_id, "Runtime request ID");
  enumValue(request.action, ["PUSH", "MERGE", "DEPLOY", "RELEASE", "ROLLBACK"], "Runtime action");
  assert(adapter_contract !== null, "external Runtime request requires the prepared adapter contract");
  sha(request.choice_digest, "Runtime request choice digest");
  safeId(request.project_ref, "Runtime request project reference");
  safeId(request.campaign_id, "Runtime request campaign ID");
  positiveInteger(request.campaign_version, "Runtime request campaign version");
  safeId(request.goal_id, "Runtime request goal ID");
  sourceId(request.source_commit, "Runtime request source commit");
  sourceId(request.source_tree, "Runtime request source tree");
  if (["DEPLOY", "RELEASE", "ROLLBACK"].includes(request.action)) opaqueRef(request.environment_ref, "Runtime request environment reference");
  else nullableOpaqueRef(request.environment_ref, "Runtime request environment reference");
  sha(request.scope_digest, "Runtime request scope digest");
  sha(request.owner_approval_digest, "Runtime request owner approval digest");
  sha(request.policy_digest, "Runtime request policy digest");
  sha(request.adapter_contract_digest, "Runtime request adapter contract digest");
  nullableSha(request.rollback_target_digest, "Runtime request rollback target digest");
  if (request.action === "ROLLBACK") sha(request.rollback_target_digest, "rollback Runtime request target digest");
  else assert(request.rollback_target_digest === null, "non-rollback Runtime request cannot contain a rollback target");
  opaqueRef(request.runtime_ref, "Runtime reference");
  enumValue(request.status, RUNTIME_REQUEST_STATUSES, "Runtime request status");
  time(request.requested_at_utc, "Runtime request time");
  if (request.status === "PREPARED") {
    assert(request.authorized_by_role === null && request.authorized_at_utc === null, "prepared Runtime request is already authorized");
  } else {
    assert(request.authorized_by_role === "RUNTIME", "Runtime request is not authorized by Runtime");
    time(request.authorized_at_utc, "Runtime authorization time");
  }
  contextMatches(request, context, "Runtime request");
  if (context.choice_digest !== undefined) assert(request.choice_digest === context.choice_digest, "Runtime request choice differs");
  if (choice) {
    validateDeliveryChoice(choice);
    assert(request.choice_digest === choice.digest, "Runtime request choice differs from selected choice");
    assert(request.action === ACTION_BY_OUTCOME[choice.outcome], "Runtime request action differs from selected choice");
    assert(request.source_commit === choice.source_commit && request.source_tree === choice.source_tree, "Runtime request source differs from selected choice");
    assert(request.environment_ref === choice.environment_ref, "Runtime request environment differs from selected choice");
    assert(request.scope_digest === choice.scope_digest, "Runtime request scope differs from selected choice");
    assert(request.owner_approval_digest === choice.owner_approval.digest, "Runtime request owner approval differs from selected choice");
    assert(request.policy_digest === choice.policy_digest, "Runtime request policy differs from selected choice");
    assert(request.rollback_target_digest === choice.rollback_target_digest, "Runtime request rollback target differs from selected choice");
  }
  if (adapter_contract) {
    validateDeliveryAdapterForAction(adapter_contract, request.action, request.policy_digest);
    assert(request.adapter_contract_digest === adapter_contract.digest, "Runtime request adapter contract differs");
  }
  validateDigest(request.digest, "Runtime request digest", request);
  return request;
}

export function compileRuntimeRequest({request_id, choice, runtime_ref, requested_at_utc, adapter_contract} = {}) {
  validateDeliveryChoice(choice);
  assert(EXTERNAL_OUTCOMES.has(choice.outcome), "only external delivery choices may create a Runtime request");
  validateDeliveryAdapterForAction(adapter_contract, ACTION_BY_OUTCOME[choice.outcome], choice.policy_digest);
  const request = withDigest({
    schema: RUNTIME_REQUEST_SCHEMA,
    version: 1,
    request_id,
    action: ACTION_BY_OUTCOME[choice.outcome],
    choice_digest: choice.digest,
    project_ref: choice.project_ref,
    campaign_id: choice.campaign_id,
    campaign_version: choice.campaign_version,
    goal_id: choice.goal_id,
    source_commit: choice.source_commit,
    source_tree: choice.source_tree,
    environment_ref: choice.environment_ref,
    scope_digest: choice.scope_digest,
    owner_approval_digest: choice.owner_approval.digest,
    policy_digest: choice.policy_digest,
    adapter_contract_digest: adapter_contract.digest,
    rollback_target_digest: choice.rollback_target_digest,
    runtime_ref,
    status: "PREPARED",
    requested_at_utc,
    authorized_by_role: null,
    authorized_at_utc: null,
  });
  return validateRuntimeRequest(request, {...stateContext(choice), choice, adapter_contract});
}

export function authorizeRuntimeRequest(request, {runtime_role = "RUNTIME", authorized_at_utc, choice = null, adapter_contract = null} = {}) {
  assert(choice !== null && adapter_contract !== null, "Runtime authorization requires the selected choice and adapter contract");
  validateRuntimeRequest(request, {choice, adapter_contract});
  assert(request.status === "PREPARED", "Runtime request is not awaiting authorization");
  assert(runtime_role === "RUNTIME", "only the persistent Runtime may authorize delivery");
  const authorized = withDigest({
    ...request,
    status: "AUTHORIZED",
    authorized_by_role: "RUNTIME",
    authorized_at_utc,
  });
  return validateRuntimeRequest(authorized, {choice, adapter_contract});
}

function validateReceiptShape(receipt) {
  exactKeys(receipt, [
    "schema", "version", "receipt_id", "request_id", "request_digest", "choice_digest", "outcome", "action",
    "status", "project_ref", "campaign_id", "campaign_version", "goal_id", "source_commit", "source_tree",
    "environment_ref", "runtime_ref", "external_result_ref", "rollback_target_digest", "policy_digest", "adapter_contract_digest", "evidence_digest",
    "error_code", "observed_at_utc", "digest",
  ], "delivery receipt");
  assert(receipt.schema === RUNTIME_RECEIPT_SCHEMA && receipt.version === 1, "delivery receipt identity is invalid");
  safeId(receipt.receipt_id, "receipt ID");
  if (receipt.request_id !== null) safeId(receipt.request_id, "receipt request ID");
  nullableSha(receipt.request_digest, "receipt request digest");
  sha(receipt.choice_digest, "receipt choice digest");
  enumValue(receipt.outcome, DELIVERY_OUTCOMES, "receipt outcome");
  enumValue(receipt.action, DELIVERY_ACTIONS, "receipt action");
  enumValue(receipt.status, RUNTIME_RECEIPT_STATUSES, "receipt status");
  safeId(receipt.project_ref, "receipt project reference");
  safeId(receipt.campaign_id, "receipt campaign ID");
  positiveInteger(receipt.campaign_version, "receipt campaign version");
  safeId(receipt.goal_id, "receipt goal ID");
  sourceId(receipt.source_commit, "receipt source commit");
  sourceId(receipt.source_tree, "receipt source tree");
  nullableOpaqueRef(receipt.environment_ref, "receipt environment reference");
  nullableOpaqueRef(receipt.runtime_ref, "receipt Runtime reference");
  nullableOpaqueRef(receipt.external_result_ref, "receipt external result reference");
  nullableSha(receipt.rollback_target_digest, "receipt rollback target digest");
  nullableSha(receipt.policy_digest, "receipt policy digest");
  nullableSha(receipt.adapter_contract_digest, "receipt adapter contract digest");
  sha(receipt.evidence_digest, "receipt evidence digest");
  if (receipt.error_code !== null) safeCode(receipt.error_code, "receipt error code");
  time(receipt.observed_at_utc, "receipt observed time");
  validateDigest(receipt.digest, "delivery receipt digest", receipt);
  return receipt;
}

export function validateRuntimeReceipt(receipt, {request = null, choice = null, adapter_contract = null} = {}) {
  validateReceiptShape(receipt);
  if (receipt.status === "NO_EXTERNAL_ACTION") {
    assert(receipt.action === "NONE" && receipt.outcome === "LOCAL_ONLY", "no-external receipt must be local-only");
    assert(receipt.request_id === null && receipt.request_digest === null && receipt.runtime_ref === null, "no-external receipt cannot claim Runtime execution");
    assert(receipt.external_result_ref === null && receipt.error_code === null && receipt.policy_digest !== null && receipt.adapter_contract_digest === null, "no-external receipt contains external action data");
  } else {
    assert(adapter_contract !== null, "external delivery receipt requires the prepared adapter contract");
    assert(receipt.action !== "NONE", "external receipt must identify an action");
    assert(receipt.request_id !== null && receipt.request_digest !== null && receipt.runtime_ref !== null, "external receipt lacks Runtime request binding");
    assert(receipt.policy_digest !== null && receipt.adapter_contract_digest !== null, "external receipt lacks policy or adapter binding");
    assert(receipt.outcome === receipt.action, "receipt outcome does not match its action");
    if (receipt.status === "SUCCEEDED") {
      opaqueRef(receipt.external_result_ref, "successful receipt external result reference");
      assert(receipt.error_code === null, "successful receipt cannot contain an error");
    } else if (receipt.status === "FAILED" || receipt.status === "UNKNOWN") {
      safeCode(receipt.error_code, "failed or unknown receipt error code");
      assert(receipt.external_result_ref === null, "failed or unknown receipt cannot claim an external result");
    } else if (receipt.status === "IN_FLIGHT") {
      assert(receipt.external_result_ref === null && receipt.error_code === null, "in-flight receipt cannot claim a final result or error");
    }
  }
  if (receipt.outcome === "ROLLBACK") sha(receipt.rollback_target_digest, "rollback receipt target digest");
  else assert(receipt.rollback_target_digest === null, "non-rollback receipt cannot contain a rollback target");
  if (request) {
    assert(request.status === "AUTHORIZED", "delivery receipt requires an authorized Runtime request");
    validateRuntimeRequest(request, {choice, adapter_contract});
    assert(receipt.request_id === request.request_id && receipt.request_digest === request.digest, "receipt request binding differs");
    assert(receipt.action === request.action, "receipt action differs from Runtime request");
    assert(receipt.choice_digest === request.choice_digest, "receipt choice binding differs");
    assert(receipt.runtime_ref === request.runtime_ref, "receipt Runtime binding differs");
    assert(receipt.rollback_target_digest === request.rollback_target_digest, "receipt rollback target differs from Runtime request");
    assert(receipt.policy_digest === request.policy_digest, "receipt policy binding differs from Runtime request");
    assert(receipt.adapter_contract_digest === request.adapter_contract_digest, "receipt adapter binding differs from Runtime request");
    contextMatches(receipt, stateContext(request), "delivery receipt");
    assert(receipt.source_commit === request.source_commit && receipt.source_tree === request.source_tree, "receipt source differs from request");
    assert(receipt.environment_ref === request.environment_ref, "receipt environment differs from request");
  }
  if (choice) {
    validateDeliveryChoice(choice);
    assert(receipt.choice_digest === choice.digest, "receipt choice differs from delivery choice");
    assert(receipt.outcome === choice.outcome && receipt.action === ACTION_BY_OUTCOME[choice.outcome], "receipt outcome/action differs from choice");
    assert(receipt.source_commit === choice.source_commit && receipt.source_tree === choice.source_tree, "receipt source differs from choice");
    assert(receipt.environment_ref === choice.environment_ref, "receipt environment differs from choice");
    assert(receipt.policy_digest === choice.policy_digest, "receipt policy differs from choice");
    if (choice.outcome === "ROLLBACK") assert(receipt.rollback_target_digest === choice.rollback_target_digest, "receipt rollback target differs from choice");
  }
  if (adapter_contract) {
    assert(receipt.adapter_contract_digest === adapter_contract.digest, "receipt adapter differs from adapter contract");
    validateDeliveryAdapterForAction(adapter_contract, receipt.action, receipt.policy_digest);
  }
  return receipt;
}

export function compileRuntimeReceipt({
  receipt_id,
  request,
  status,
  external_result_ref = null,
  evidence_digest,
  error_code = null,
  observed_at_utc,
  adapter_contract,
} = {}) {
  validateRuntimeRequest(request, {adapter_contract});
  assert(request.status === "AUTHORIZED", "a delivery receipt requires an authorized Runtime request");
  const receipt = withDigest({
    schema: RUNTIME_RECEIPT_SCHEMA,
    version: 1,
    receipt_id,
    request_id: request.request_id,
    request_digest: request.digest,
    choice_digest: request.choice_digest,
    outcome: request.action === "ROLLBACK" ? "ROLLBACK" : request.action,
    action: request.action,
    status,
    project_ref: request.project_ref,
    campaign_id: request.campaign_id,
    campaign_version: request.campaign_version,
    goal_id: request.goal_id,
    source_commit: request.source_commit,
    source_tree: request.source_tree,
    environment_ref: request.environment_ref,
    runtime_ref: request.runtime_ref,
    external_result_ref,
    rollback_target_digest: request.rollback_target_digest,
    policy_digest: request.policy_digest,
    adapter_contract_digest: request.adapter_contract_digest,
    evidence_digest,
    error_code,
    observed_at_utc,
  });
  return validateRuntimeReceipt(receipt, {request, adapter_contract});
}

export function compileNoExternalActionReceipt({receipt_id, choice, evidence_digest, observed_at_utc} = {}) {
  validateDeliveryChoice(choice);
  assert(choice.outcome === "LOCAL_ONLY", "only a local-only choice may produce a no-external receipt");
  const receipt = withDigest({
    schema: RUNTIME_RECEIPT_SCHEMA,
    version: 1,
    receipt_id,
    request_id: null,
    request_digest: null,
    choice_digest: choice.digest,
    outcome: "LOCAL_ONLY",
    action: "NONE",
    status: "NO_EXTERNAL_ACTION",
    project_ref: choice.project_ref,
    campaign_id: choice.campaign_id,
    campaign_version: choice.campaign_version,
    goal_id: choice.goal_id,
    source_commit: choice.source_commit,
    source_tree: choice.source_tree,
    environment_ref: choice.environment_ref,
    runtime_ref: null,
    external_result_ref: null,
    rollback_target_digest: null,
    policy_digest: choice.policy_digest,
    adapter_contract_digest: null,
    evidence_digest,
    error_code: null,
    observed_at_utc,
  });
  return validateRuntimeReceipt(receipt, {choice});
}

export function validateRollbackReceipt(receipt, {request = null, choice = null, target_receipt_digest = undefined, adapter_contract = null} = {}) {
  exactKeys(receipt, [
    "schema", "version", "rollback_id", "request_id", "request_digest", "choice_digest", "target_receipt_digest",
    "target_external_result_ref", "restored_external_result_ref", "status", "verified", "evidence_digest",
    "observed_at_utc", "digest",
  ], "rollback receipt");
  assert(receipt.schema === ROLLBACK_RECEIPT_SCHEMA && receipt.version === 1, "rollback receipt identity is invalid");
  safeId(receipt.rollback_id, "rollback ID");
  safeId(receipt.request_id, "rollback request ID");
  sha(receipt.request_digest, "rollback request digest");
  sha(receipt.choice_digest, "rollback choice digest");
  sha(receipt.target_receipt_digest, "rollback target receipt digest");
  opaqueRef(receipt.target_external_result_ref, "rollback target result reference");
  nullableOpaqueRef(receipt.restored_external_result_ref, "rollback restored result reference");
  enumValue(receipt.status, ["SUCCEEDED", "FAILED", "UNKNOWN"], "rollback status");
  assert(typeof receipt.verified === "boolean", "rollback verified flag is invalid");
  if (receipt.status === "SUCCEEDED") {
    assert(receipt.verified === true && receipt.restored_external_result_ref !== null, "successful rollback must be verified");
  } else {
    assert(receipt.verified === false, "failed or unknown rollback cannot be verified");
  }
  sha(receipt.evidence_digest, "rollback evidence digest");
  time(receipt.observed_at_utc, "rollback observed time");
  if (request || choice) assert(adapter_contract !== null, "rollback evidence requires the prepared adapter contract");
  if (target_receipt_digest !== undefined) assert(receipt.target_receipt_digest === target_receipt_digest, "rollback target receipt differs");
  if (request) {
    validateRuntimeRequest(request, {choice, adapter_contract});
    assert(request.action === "ROLLBACK" && receipt.request_id === request.request_id && receipt.request_digest === request.digest, "rollback request binding differs");
    assert(receipt.choice_digest === request.choice_digest, "rollback choice binding differs");
  }
  if (choice) {
    validateDeliveryChoice(choice);
    assert(choice.outcome === "ROLLBACK", "rollback receipt requires a rollback choice");
    assert(receipt.choice_digest === choice.digest, "rollback receipt choice differs");
    assert(receipt.target_receipt_digest === choice.rollback_target_digest, "rollback target is not the owner-selected target");
  }
  validateDigest(receipt.digest, "rollback receipt digest", receipt);
  return receipt;
}

export function compileRollbackReceipt({
  rollback_id,
  request,
  choice,
  target_receipt_digest,
  target_external_result_ref,
  restored_external_result_ref = null,
  status,
  verified = false,
  evidence_digest,
  observed_at_utc,
  adapter_contract,
} = {}) {
  validateRuntimeRequest(request, {choice, adapter_contract});
  assert(request.status === "AUTHORIZED", "a rollback receipt requires an authorized Runtime request");
  validateDeliveryChoice(choice);
  const receipt = withDigest({
    schema: ROLLBACK_RECEIPT_SCHEMA,
    version: 1,
    rollback_id,
    request_id: request.request_id,
    request_digest: request.digest,
    choice_digest: choice.digest,
    target_receipt_digest,
    target_external_result_ref,
    restored_external_result_ref,
    status,
    verified,
    evidence_digest,
    observed_at_utc,
  });
  return validateRollbackReceipt(receipt, {request, choice, adapter_contract});
}

export function validateLiveAuditReceipt(receipt, {choice = null, action_receipt = null, adapter_contract = null} = {}) {
  exactKeys(receipt, [
    "schema", "version", "audit_id", "choice_digest", "action_receipt_digest", "outcome", "source_commit",
    "source_tree", "environment_ref", "deployed_result_ref", "runtime_ref", "independent_auditor_ref",
    "status", "evidence_digest", "audited_at_utc", "digest",
  ], "live audit receipt");
  assert(receipt.schema === LIVE_AUDIT_SCHEMA && receipt.version === 1, "live audit receipt identity is invalid");
  safeId(receipt.audit_id, "live audit ID");
  sha(receipt.choice_digest, "live audit choice digest");
  sha(receipt.action_receipt_digest, "live audit action receipt digest");
  enumValue(receipt.outcome, ["DEPLOY", "RELEASE"], "live audit outcome");
  sourceId(receipt.source_commit, "live audit source commit");
  sourceId(receipt.source_tree, "live audit source tree");
  opaqueRef(receipt.environment_ref, "live audit environment reference");
  opaqueRef(receipt.deployed_result_ref, "live audit deployed result reference");
  opaqueRef(receipt.runtime_ref, "live audit Runtime reference");
  opaqueRef(receipt.independent_auditor_ref, "independent Auditor reference");
  assert(receipt.independent_auditor_ref !== receipt.runtime_ref, "live audit must be independent of Runtime");
  enumValue(receipt.status, LIVE_AUDIT_STATUSES, "live audit status");
  sha(receipt.evidence_digest, "live audit evidence digest");
  time(receipt.audited_at_utc, "live audit time");
  if (choice || action_receipt) assert(adapter_contract !== null, "live audit evidence requires the prepared adapter contract");
  if (action_receipt) {
    validateRuntimeReceipt(action_receipt, {choice, adapter_contract});
    assert(action_receipt.status === "SUCCEEDED", "live audit requires a successful delivery receipt");
    assert(receipt.action_receipt_digest === action_receipt.digest, "live audit action receipt differs");
    assert(receipt.choice_digest === action_receipt.choice_digest, "live audit choice differs");
    assert(receipt.outcome === action_receipt.outcome, "live audit outcome differs");
    assert(receipt.source_commit === action_receipt.source_commit && receipt.source_tree === action_receipt.source_tree, "live audit source differs");
    assert(receipt.environment_ref === action_receipt.environment_ref && receipt.deployed_result_ref === action_receipt.external_result_ref, "live audit target differs");
    assert(receipt.runtime_ref === action_receipt.runtime_ref, "live audit Runtime binding differs");
  }
  if (choice) {
    validateDeliveryChoice(choice);
    assert(LIVE_OUTCOMES.has(choice.outcome) && receipt.choice_digest === choice.digest && receipt.outcome === choice.outcome, "live audit choice is not deploy/release bound");
  }
  validateDigest(receipt.digest, "live audit receipt digest", receipt);
  return receipt;
}

export function compileLiveAuditReceipt({
  audit_id,
  choice,
  action_receipt,
  independent_auditor_ref,
  status,
  evidence_digest,
  audited_at_utc,
  adapter_contract,
} = {}) {
  validateDeliveryChoice(choice);
  validateRuntimeReceipt(action_receipt, {choice, adapter_contract});
  const receipt = withDigest({
    schema: LIVE_AUDIT_SCHEMA,
    version: 1,
    audit_id,
    choice_digest: choice.digest,
    action_receipt_digest: action_receipt.digest,
    outcome: choice.outcome,
    source_commit: choice.source_commit,
    source_tree: choice.source_tree,
    environment_ref: choice.environment_ref,
    deployed_result_ref: action_receipt.external_result_ref,
    runtime_ref: action_receipt.runtime_ref,
    independent_auditor_ref,
    status,
    evidence_digest,
    audited_at_utc,
  });
  return validateLiveAuditReceipt(receipt, {choice, action_receipt, adapter_contract});
}

function validateHandoffShape(handoff) {
  exactKeys(handoff, [
    "schema", "version", "handoff_id", "project_ref", "campaign_id", "campaign_version", "goal_id",
    "state_digest", "choice_digest", "outcome", "completion_status", "source_commit", "source_tree",
    "accepted_result_digest", "final_audit_digest", "receipt_digests", "live_audit_digest", "rollback_receipt_digest",
    "open_risk_codes", "deferred_item_codes", "next_action", "created_at_utc", "digest",
  ], "final delivery handoff");
  assert(handoff.schema === FINAL_HANDOFF_SCHEMA && handoff.version === 1, "final handoff identity is invalid");
  safeId(handoff.handoff_id, "handoff ID");
  safeId(handoff.project_ref, "handoff project reference");
  safeId(handoff.campaign_id, "handoff campaign ID");
  positiveInteger(handoff.campaign_version, "handoff campaign version");
  safeId(handoff.goal_id, "handoff goal ID");
  sha(handoff.state_digest, "handoff state digest");
  sha(handoff.choice_digest, "handoff choice digest");
  enumValue(handoff.outcome, DELIVERY_OUTCOMES, "handoff outcome");
  enumValue(handoff.completion_status, ["SELECTED_RESULT", "PREPARED_NO_DELIVERY"], "handoff completion status");
  sourceId(handoff.source_commit, "handoff source commit");
  sourceId(handoff.source_tree, "handoff source tree");
  nullableSha(handoff.accepted_result_digest, "handoff accepted result digest");
  nullableSha(handoff.final_audit_digest, "handoff final audit digest");
  validateDigestList(handoff.receipt_digests, "handoff receipt digests", {allowEmpty: handoff.outcome === "PREPARED"});
  nullableSha(handoff.live_audit_digest, "handoff live audit digest");
  nullableSha(handoff.rollback_receipt_digest, "handoff rollback receipt digest");
  validateCodes(handoff.open_risk_codes, "handoff open risk codes");
  validateCodes(handoff.deferred_item_codes, "handoff deferred item codes");
  enumValue(handoff.next_action, ["NONE", "OWNER_REVIEW", "ITERATION_REQUIRED"], "handoff next action");
  time(handoff.created_at_utc, "handoff creation time");
  validateDigest(handoff.digest, "final handoff digest", handoff);
  return handoff;
}

export function validateFinalHandoff(handoff, {choice = null, state = null, receipt = null, live_audit = null, rollback_receipt = null, adapter_contract = null} = {}) {
  validateHandoffShape(handoff);
  if (choice) {
    validateDeliveryChoice(choice);
    assert(handoff.choice_digest === choice.digest && handoff.outcome === choice.outcome, "handoff choice differs");
    if (EXTERNAL_OUTCOMES.has(choice.outcome)) assert(adapter_contract !== null, "external handoff requires the prepared adapter contract");
    assert(handoff.source_commit === choice.source_commit && handoff.source_tree === choice.source_tree, "handoff source differs");
    assert(handoff.accepted_result_digest === choice.accepted_result_digest && handoff.final_audit_digest === choice.final_audit_digest, "handoff acceptance differs");
    assert(handoff.completion_status === (choice.outcome === "PREPARED" ? "PREPARED_NO_DELIVERY" : "SELECTED_RESULT"), "handoff completion status differs");
    if (choice.outcome === "PREPARED") {
      assert(handoff.live_audit_digest === null && handoff.rollback_receipt_digest === null, "prepared handoff cannot contain action evidence");
      assert(handoff.next_action !== "NONE", "prepared handoff must name a next action");
    } else {
      assert(handoff.accepted_result_digest !== null && handoff.final_audit_digest !== null, "selected-result handoff lacks acceptance evidence");
      assert(handoff.receipt_digests.length > 0, "selected-result handoff lacks action evidence");
      if (receipt) {
        validateRuntimeReceipt(receipt, {choice, adapter_contract});
        assert(handoff.receipt_digests.includes(receipt.digest), "selected-result handoff omits the action receipt");
      }
      if (choice.outcome === "DEPLOY" || choice.outcome === "RELEASE") assert(handoff.live_audit_digest !== null, "live delivery handoff lacks live audit");
      if (choice.outcome === "ROLLBACK") {
        assert(handoff.rollback_receipt_digest !== null, "rollback handoff lacks rollback receipt");
        assert(handoff.receipt_digests.includes(handoff.rollback_receipt_digest), "rollback handoff omits rollback receipt evidence");
      }
    }
  }
  if (state) {
    validateDeliveryState(state);
    assert(handoff.state_digest === state.digest, "handoff state differs");
    assert(handoff.choice_digest === state.choice_digest && handoff.outcome === state.outcome, "handoff choice differs from state");
    if (EXTERNAL_OUTCOMES.has(state.outcome)) assert(adapter_contract !== null, "external handoff requires the prepared adapter contract");
    contextMatches(handoff, stateContext(state), "final handoff");
  }
  if (live_audit) assert(handoff.live_audit_digest === live_audit.digest, "handoff live audit differs");
  if (rollback_receipt) assert(handoff.rollback_receipt_digest === rollback_receipt.digest, "handoff rollback receipt differs");
  return handoff;
}

export function compileFinalHandoff({
  handoff_id,
  state,
  choice,
  receipt = null,
  adapter_contract = null,
  receipt_digests = [],
  live_audit_digest = null,
  rollback_receipt_digest = null,
  open_risk_codes = [],
  deferred_item_codes = [],
  next_action,
  created_at_utc,
} = {}) {
  validateDeliveryState(state);
  validateDeliveryChoice(choice, stateContext(state));
  assert(state.status === "CLOSURE_PENDING", "final handoff requires a closure-pending state");
  const handoff = withDigest({
    schema: FINAL_HANDOFF_SCHEMA,
    version: 1,
    handoff_id,
    project_ref: choice.project_ref,
    campaign_id: choice.campaign_id,
    campaign_version: choice.campaign_version,
    goal_id: choice.goal_id,
    state_digest: state.digest,
    choice_digest: choice.digest,
    outcome: choice.outcome,
    completion_status: choice.outcome === "PREPARED" ? "PREPARED_NO_DELIVERY" : "SELECTED_RESULT",
    source_commit: choice.source_commit,
    source_tree: choice.source_tree,
    accepted_result_digest: choice.accepted_result_digest,
    final_audit_digest: choice.final_audit_digest,
    receipt_digests,
    live_audit_digest,
    rollback_receipt_digest,
    open_risk_codes,
    deferred_item_codes,
    next_action,
    created_at_utc,
  });
  return validateFinalHandoff(handoff, {choice, state, receipt, adapter_contract});
}

export function validateClosureRecord(closure, {
  state = null,
  choice = null,
  final_handoff = null,
  receipt = null,
  live_audit = null,
  rollback_receipt = null,
  adapter_contract = null,
} = {}) {
  exactKeys(closure, [
    "schema", "version", "closure_id", "project_ref", "campaign_id", "campaign_version", "goal_id",
    "choice_digest", "outcome", "preclosure_state_digest", "final_handoff_digest", "receipt_digest",
    "live_audit_digest", "rollback_receipt_digest", "temporary_closure_digest", "temporary_roster_status",
    "closed_at_utc", "digest",
  ], "delivery closure");
  assert(closure.schema === CLOSURE_SCHEMA && closure.version === 1, "delivery closure identity is invalid");
  safeId(closure.closure_id, "closure ID");
  safeId(closure.project_ref, "closure project reference");
  safeId(closure.campaign_id, "closure campaign ID");
  positiveInteger(closure.campaign_version, "closure campaign version");
  safeId(closure.goal_id, "closure goal ID");
  sha(closure.choice_digest, "closure choice digest");
  enumValue(closure.outcome, DELIVERY_OUTCOMES, "closure outcome");
  sha(closure.preclosure_state_digest, "closure pre-closure state digest");
  sha(closure.final_handoff_digest, "closure final handoff digest");
  nullableSha(closure.receipt_digest, "closure receipt digest");
  nullableSha(closure.live_audit_digest, "closure live audit digest");
  nullableSha(closure.rollback_receipt_digest, "closure rollback receipt digest");
  sha(closure.temporary_closure_digest, "temporary closure digest");
  enumValue(closure.temporary_roster_status, CLOSURE_ROSTER_STATUSES, "temporary roster status");
  time(closure.closed_at_utc, "closure time");
  if (closure.outcome === "PREPARED") {
    assert(closure.receipt_digest === null && closure.live_audit_digest === null && closure.rollback_receipt_digest === null, "prepared closure cannot claim delivery evidence");
  } else {
    assert(closure.receipt_digest !== null, "selected closure requires a receipt");
    if (LIVE_OUTCOMES.has(closure.outcome)) assert(closure.live_audit_digest !== null, "live closure requires a live audit");
    if (closure.outcome === "ROLLBACK") assert(closure.rollback_receipt_digest !== null, "rollback closure requires a rollback receipt");
  }
  if (state) {
    validateDeliveryState(state);
    assert(state.status === "CLOSURE_PENDING", "closure record must bind the pre-closure state");
    assert(closure.preclosure_state_digest === state.digest, "closure pre-closure state differs");
    assert(closure.choice_digest === state.choice_digest && closure.outcome === state.outcome, "closure choice differs from state");
    if (EXTERNAL_OUTCOMES.has(state.outcome)) assert(adapter_contract !== null, "external closure requires the prepared adapter contract");
    contextMatches(closure, stateContext(state), "delivery closure");
  }
  if (choice) {
    validateDeliveryChoice(choice);
    assert(closure.choice_digest === choice.digest && closure.outcome === choice.outcome, "closure choice differs");
    if (EXTERNAL_OUTCOMES.has(choice.outcome)) assert(adapter_contract !== null, "external closure requires the prepared adapter contract");
    contextMatches(closure, stateContext(choice), "delivery closure");
  }
  if (final_handoff) {
    validateFinalHandoff(final_handoff, {choice, state, receipt, live_audit, rollback_receipt, adapter_contract});
    assert(closure.final_handoff_digest === final_handoff.digest, "closure final handoff differs");
  }
  if (receipt) {
    validateRuntimeReceipt(receipt, {choice, adapter_contract});
    assert(closure.receipt_digest === receipt.digest, "closure receipt differs");
  }
  if (live_audit) {
    validateLiveAuditReceipt(live_audit, {choice, action_receipt: receipt, adapter_contract});
    assert(closure.live_audit_digest === live_audit.digest, "closure live audit differs");
  }
  if (rollback_receipt) {
    validateRollbackReceipt(rollback_receipt, {choice, adapter_contract});
    assert(closure.rollback_receipt_digest === rollback_receipt.digest, "closure rollback receipt differs");
  }
  validateDigest(closure.digest, "delivery closure digest", closure);
  return closure;
}

export function compileClosureRecord({
  closure_id,
  state,
  choice,
  final_handoff,
  receipt = null,
  live_audit = null,
  rollback_receipt = null,
  adapter_contract = null,
  receipt_digest = null,
  live_audit_digest = null,
  rollback_receipt_digest = null,
  temporary_closure_digest,
  temporary_roster_status = "VERIFIED_ZERO_ACTIVE",
  closed_at_utc,
} = {}) {
  validateDeliveryState(state);
  validateDeliveryChoice(choice, stateContext(state));
  validateFinalHandoff(final_handoff, {choice, state, receipt, adapter_contract});
  const closure = withDigest({
    schema: CLOSURE_SCHEMA,
    version: 1,
    closure_id,
    project_ref: choice.project_ref,
    campaign_id: choice.campaign_id,
    campaign_version: choice.campaign_version,
    goal_id: choice.goal_id,
    choice_digest: choice.digest,
    outcome: choice.outcome,
    preclosure_state_digest: state.digest,
    final_handoff_digest: final_handoff.digest,
    receipt_digest,
    live_audit_digest,
    rollback_receipt_digest,
    temporary_closure_digest,
    temporary_roster_status,
    closed_at_utc,
  });
  return validateClosureRecord(closure, {state, choice, final_handoff, receipt, live_audit, rollback_receipt, adapter_contract});
}


export {stateContext, nextState, requireChoiceForState};
