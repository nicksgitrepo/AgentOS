#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  applyOwnerReviewApproval,
  ownerReviewDigest,
  validateOwnerApprovalPacket,
} from "./owner-review.mjs";
import {
  campaignIdentityBindingDigest,
  validateCampaignIdentityBinding,
} from "./campaign-controller.mjs";
import {
  validateAuditPlan,
  validateAuditReconciliation,
  validateAuditReport,
  validateFirstPassCandidate,
} from "./campaign-cascade.mjs";
import {validatePolicyState} from "./global-policy-state.mjs";

export const CAMPAIGN_CONTROL_PLANE_RECEIPT_SCHEMA = "agentos.campaign_control_plane_receipt.v1";
export const CAMPAIGN_CONTROL_PLANE_RECEIPT_STATUS = "RECONCILED_INACTIVE";

const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const RECEIPT_KEYS = [
  "schema", "version", "status", "canonical_campaign_identity", "project_id", "campaign_id", "campaign_version",
  "source_commit", "source_tree", "policy_epoch", "policy_state_sha256", "controller_candidate_sha256",
  "owner_review_candidate_sha256", "approval_packet_sha256", "owner_approval_sha256", "admission_sha256",
  "identity_binding_sha256", "audit_checkpoint_sha256", "audit_plan_sha256", "audit_reconciliation_sha256",
  "approval_packet", "owner_approval", "admission", "identity_binding", "audit_evidence", "current_status",
  "active_campaign", "product_writes_allowed", "product_agent_spawns_allowed", "deployment_allowed", "receipt_sha256",
];
const AUDIT_EVIDENCE_KEYS = ["candidate", "plan", "reports", "reconciliation"];
const APPROVAL_KEYS = [
  "schema", "approval_state", "approval_route", "review_id", "candidate_sha256", "approval_packet_sha256",
  "approved_at_utc", "actor_digest_sha256", "approval_sha256",
];
const ADMISSION_KEYS = [
  "schema", "review_id", "project_id", "candidate_sha256", "approval_packet_sha256", "approval_sha256",
  "policy_state_sha256", "policy_epoch", "status", "active_campaign", "product_writes_allowed",
  "product_agent_spawns_allowed", "deployment_allowed", "next_action", "owner_review_consumed", "admission_sha256",
];

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
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains control characters`);
}

function requireIdentifier(value, label) {
  requireString(value, label);
  assert(IDENTIFIER.test(value), `${label} is not a stable identifier`);
}

function requireSha(value, label, {nullable = false} = {}) {
  if (nullable && value === null) return;
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function requireGitObject(value, label) {
  assert(typeof value === "string" && GIT_OBJECT.test(value), `${label} must be a Git object identity`);
}

function requireUtc(value, label) {
  requireString(value, label);
  assert(ISO_UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} must be UTC`);
}

function sameDigest(left, right, label) {
  assert(campaignIdentityBindingDigest(left) === campaignIdentityBindingDigest(right), `${label} differs`);
}

function receiptBody(receipt) {
  const body = structuredClone(receipt);
  body.receipt_sha256 = null;
  return body;
}

export function campaignControlPlaneReceiptDigest(value) {
  return campaignIdentityBindingDigest(value);
}

function validateOwnerApproval(approval, packet) {
  exactKeys(approval, APPROVAL_KEYS, "campaign owner approval");
  assert(approval.schema === "agentos.owner_review_approval.v1", "campaign owner approval schema mismatch");
  assert(approval.approval_state === "OWNER_AUTHENTICATED_EXACT_APPROVAL", "campaign owner approval is not authenticated exact approval");
  requireIdentifier(approval.approval_route, "campaign owner approval route");
  assert(approval.review_id === packet.review_id, "campaign owner approval review differs");
  assert(approval.candidate_sha256 === packet.candidate_sha256, "campaign owner approval candidate differs");
  assert(approval.approval_packet_sha256 === packet.approval_packet_sha256, "campaign owner approval packet differs");
  requireSha(approval.candidate_sha256, "campaign owner approval candidate");
  requireSha(approval.approval_packet_sha256, "campaign owner approval packet");
  requireUtc(approval.approved_at_utc, "campaign owner approval time");
  requireSha(approval.actor_digest_sha256, "campaign owner approval actor");
  requireSha(approval.approval_sha256, "campaign owner approval digest");
  assert(approval.approval_sha256 === ownerReviewDigest({...approval, approval_sha256: null}), "campaign owner approval digest mismatch");
  return approval;
}

function validateAdmission(admission, packet, policyState) {
  exactKeys(admission, ADMISSION_KEYS, "campaign admission");
  assert(admission.schema === "agentos.owner_review_admission.v1", "campaign admission schema mismatch");
  assert(admission.review_id === packet.review_id && admission.project_id === packet.project_id, "campaign admission identity differs");
  assert(admission.candidate_sha256 === packet.candidate_sha256, "campaign admission candidate differs");
  assert(admission.approval_packet_sha256 === packet.approval_packet_sha256, "campaign admission packet differs");
  assert(admission.policy_epoch === policyState.policy_epoch && admission.policy_state_sha256 === policyState.policy_state_sha256, "campaign admission policy differs");
  assert(admission.status === "ADMITTED_NEXT_CAMPAIGN" && admission.owner_review_consumed === true, "campaign admission status is invalid");
  assert(admission.active_campaign === false && admission.product_writes_allowed === false
    && admission.product_agent_spawns_allowed === false && admission.deployment_allowed === false,
  "campaign admission crossed the inactive boundary");
  requireString(admission.next_action, "campaign admission next action");
  requireSha(admission.approval_sha256, "campaign admission approval");
  requireSha(admission.admission_sha256, "campaign admission digest");
  assert(admission.admission_sha256 === ownerReviewDigest({...admission, admission_sha256: null}), "campaign admission digest mismatch");
  return admission;
}

function validateAuditEvidence(auditEvidence) {
  exactKeys(auditEvidence, AUDIT_EVIDENCE_KEYS, "campaign audit evidence");
  validateFirstPassCandidate(auditEvidence.candidate);
  validateAuditPlan(auditEvidence.plan);
  assert(Array.isArray(auditEvidence.reports), "campaign audit report bodies are required");
  assert(auditEvidence.reports.length === 4, "campaign audit evidence must retain all four report bodies");
  for (const report of auditEvidence.reports) {
    validateAuditReport(report, auditEvidence.plan);
    assert(report.settled === true && report.findings.length === 0, "campaign audit report is not settled and clean");
  }
  validateAuditReconciliation(auditEvidence.reconciliation, auditEvidence.plan);
  const disciplines = ["FUNCTIONALITY", "DESIGN_UI_SHELL_NAVIGATION", "SECURITY", "CODE_QUALITY_HYGIENE"];
  assert(disciplines.every((discipline) => auditEvidence.reconciliation.settled_disciplines.includes(discipline)), "campaign audit reconciliation does not settle all four disciplines");
  assert(auditEvidence.reconciliation.findings.length === 0
    && auditEvidence.reconciliation.immediate_first_pass_repairs.length === 0
    && auditEvidence.reconciliation.finalization_queue.length === 0
    && auditEvidence.reconciliation.owner_only_findings.length === 0,
  "campaign audit reconciliation contains unresolved work");
  return auditEvidence;
}

function validateCurrentStatus(status, expected) {
  requireRecord(status, "campaign current status");
  assert(status.queue_status === "ADMITTED_NEXT_CAMPAIGN", "campaign current status is not admitted");
  assert(status.active_campaign === false, "campaign current status is active");
  assert(status.controller_status === "PREPARED_NOT_ACTIVATED", "campaign Controller status crossed activation");
  assert(status.reconciliation_status === CAMPAIGN_CONTROL_PLANE_RECEIPT_STATUS, "campaign current status lacks inactive reconciliation");
  assert(status.current_commit === expected.source_commit && status.current_tree === expected.source_tree, "campaign current status source differs");
  assert(status.controller_candidate_sha256 === expected.controller_candidate_sha256
    && status.owner_review_candidate_sha256 === expected.owner_review_candidate_sha256
    && status.approval_packet_sha256 === expected.approval_packet_sha256
    && status.identity_binding_sha256 === expected.identity_binding_sha256
    && status.audit_candidate_sha256 === expected.audit_checkpoint_sha256
    && status.audit_plan_sha256 === expected.audit_plan_sha256
    && status.audit_reconciliation_sha256 === expected.audit_reconciliation_sha256,
  "campaign current status evidence differs");
  assert(status.audit_reports_complete === 4 && status.audit_findings === 0 && status.scope_intent_unchanged === true, "campaign current status audit or scope state differs");
  return status;
}

function safeReceiptPath(authorityRoot, receiptPath) {
  requireString(authorityRoot, "campaign control-plane authority root");
  requireString(receiptPath, "campaign control-plane receipt path");
  assert(path.isAbsolute(authorityRoot), "campaign control-plane authority root must be absolute");
  assert(!path.isAbsolute(receiptPath), "campaign control-plane receipt path must be relative");
  const resolvedRoot = fs.realpathSync.native(authorityRoot);
  const rootStat = fs.lstatSync(resolvedRoot);
  assert(rootStat.isDirectory() && !rootStat.isSymbolicLink(), "campaign control-plane authority root must be a real directory");
  const target = path.resolve(resolvedRoot, receiptPath);
  assert(target === resolvedRoot || target.startsWith(`${resolvedRoot}${path.sep}`), "campaign control-plane receipt path escapes authority root");
  let cursor = target;
  while (cursor !== resolvedRoot) {
    if (fs.existsSync(cursor)) assert(!fs.lstatSync(cursor).isSymbolicLink(), "campaign control-plane receipt path may not contain symlinks");
    cursor = path.dirname(cursor);
  }
  return {resolvedRoot, target};
}

export function validateCampaignControlPlaneReceipt(receipt) {
  exactKeys(receipt, RECEIPT_KEYS, "campaign control-plane receipt");
  assert(receipt.schema === CAMPAIGN_CONTROL_PLANE_RECEIPT_SCHEMA && receipt.version === 1, "campaign control-plane receipt identity is invalid");
  assert(receipt.status === CAMPAIGN_CONTROL_PLANE_RECEIPT_STATUS, "campaign control-plane receipt status is invalid");
  assert(receipt.canonical_campaign_identity === "CONTROLLER_CANDIDATE", "campaign control-plane receipt canonical identity is invalid");
  requireIdentifier(receipt.project_id, "campaign control-plane project");
  requireIdentifier(receipt.campaign_id, "campaign control-plane campaign");
  requireIdentifier(receipt.campaign_version, "campaign control-plane campaign version");
  requireGitObject(receipt.source_commit, "campaign control-plane source commit");
  requireGitObject(receipt.source_tree, "campaign control-plane source tree");
  assert(Number.isSafeInteger(receipt.policy_epoch) && receipt.policy_epoch >= 1, "campaign control-plane policy epoch is invalid");
  for (const field of [
    "policy_state_sha256", "controller_candidate_sha256", "owner_review_candidate_sha256", "approval_packet_sha256", "owner_approval_sha256",
    "admission_sha256", "identity_binding_sha256", "audit_checkpoint_sha256", "audit_plan_sha256", "audit_reconciliation_sha256", "receipt_sha256",
  ]) requireSha(receipt[field], `campaign control-plane ${field}`);
  assert(receipt.active_campaign === false && receipt.product_writes_allowed === false
    && receipt.product_agent_spawns_allowed === false && receipt.deployment_allowed === false,
  "campaign control-plane receipt crossed the inactive boundary");

  validateOwnerApprovalPacket(receipt.approval_packet);
  validateOwnerApproval(receipt.owner_approval, receipt.approval_packet);
  validateAdmissionShape(receipt.admission, receipt.approval_packet);
  validateCampaignIdentityBinding(receipt.identity_binding);
  validateAuditEvidence(receipt.audit_evidence);
  validateCurrentStatus(receipt.current_status, {
    source_commit: receipt.source_commit,
    source_tree: receipt.source_tree,
    controller_candidate_sha256: receipt.controller_candidate_sha256,
    owner_review_candidate_sha256: receipt.owner_review_candidate_sha256,
    approval_packet_sha256: receipt.approval_packet_sha256,
    identity_binding_sha256: receipt.identity_binding_sha256,
    audit_checkpoint_sha256: receipt.audit_checkpoint_sha256,
    audit_plan_sha256: receipt.audit_plan_sha256,
    audit_reconciliation_sha256: receipt.audit_reconciliation_sha256,
  });
  assert(receipt.approval_packet.project_id === receipt.project_id, "campaign control-plane packet project differs");
  assert(receipt.identity_binding.project_id === receipt.project_id
    && receipt.identity_binding.campaign_id === receipt.campaign_id
    && receipt.identity_binding.campaign_version === receipt.campaign_version,
  "campaign control-plane identity binding differs");
  assert(receipt.audit_evidence.candidate.campaign_id === receipt.campaign_id
    && receipt.audit_evidence.candidate.campaign_version === receipt.campaign_version,
  "campaign control-plane audit campaign differs");
  assert(receipt.audit_evidence.candidate.commit === receipt.source_commit && receipt.audit_evidence.candidate.tree === receipt.source_tree,
    "campaign control-plane audit source differs");
  assert(receipt.approval_packet.exact_candidate.source_binding.source_commit === receipt.source_commit
    && receipt.approval_packet.exact_candidate.source_binding.source_tree === receipt.source_tree,
  "campaign control-plane owner source differs");
  assert(receipt.identity_binding.audit_candidate_commit === receipt.source_commit
    && receipt.identity_binding.audit_candidate_tree === receipt.source_tree,
  "campaign control-plane mapped audit source differs");
  assert(receipt.approval_packet.source_policy_epoch === receipt.policy_epoch
    && receipt.approval_packet.source_policy_state_sha256 === receipt.policy_state_sha256
    && receipt.audit_evidence.candidate.policy_epoch === receipt.policy_epoch
    && receipt.audit_evidence.candidate.policy_snapshot_sha256 === receipt.policy_state_sha256,
  "campaign control-plane policy differs");
  assert(receipt.controller_candidate_sha256 === receipt.approval_packet.exact_candidate.source_binding.next_campaign_candidate_sha256
    && receipt.controller_candidate_sha256 === receipt.identity_binding.controller_candidate_sha256,
  "campaign control-plane Controller identity differs");
  assert(receipt.owner_review_candidate_sha256 === receipt.approval_packet.candidate_sha256
    && receipt.approval_packet_sha256 === receipt.approval_packet.approval_packet_sha256,
  "campaign control-plane owner packet identity differs");
  assert(receipt.owner_approval_sha256 === receipt.owner_approval.approval_sha256
    && receipt.admission_sha256 === receipt.admission.admission_sha256,
  "campaign control-plane approval/admission identity differs");
  assert(receipt.admission.approval_sha256 === receipt.owner_approval_sha256,
    "campaign control-plane admission approval differs");
  assert(receipt.admission.policy_epoch === receipt.policy_epoch
    && receipt.admission.policy_state_sha256 === receipt.policy_state_sha256,
  "campaign control-plane admission policy differs");
  assert(receipt.approval_packet.campaign_identity_binding.binding_sha256 === receipt.identity_binding_sha256
    && receipt.approval_packet.campaign_identity_binding.controller_candidate_sha256 === receipt.controller_candidate_sha256,
  "campaign control-plane packet mapping differs");
  assert(receipt.identity_binding_sha256 === receipt.identity_binding.binding_sha256
    && receipt.audit_checkpoint_sha256 === receipt.identity_binding.audit_candidate_sha256
    && receipt.audit_plan_sha256 === receipt.identity_binding.audit_plan_sha256
    && receipt.audit_reconciliation_sha256 === receipt.identity_binding.audit_reconciliation_sha256,
  "campaign control-plane audit mapping differs");
  assert(receipt.audit_checkpoint_sha256 === receipt.audit_evidence.candidate.candidate_sha256
    && receipt.audit_plan_sha256 === receipt.audit_evidence.plan.plan_sha256
    && receipt.audit_reconciliation_sha256 === receipt.audit_evidence.reconciliation.reconciliation_sha256,
  "campaign control-plane audit evidence identity differs");
  assert(receipt.receipt_sha256 === campaignControlPlaneReceiptDigest(receiptBody(receipt)), "campaign control-plane receipt digest mismatch");
  return receipt;
}

function validateAdmissionShape(admission, packet) {
  exactKeys(admission, ADMISSION_KEYS, "campaign control-plane admission");
  assert(admission.schema === "agentos.owner_review_admission.v1"
    && admission.review_id === packet.review_id
    && admission.project_id === packet.project_id
    && admission.candidate_sha256 === packet.candidate_sha256
    && admission.approval_packet_sha256 === packet.approval_packet_sha256,
  "campaign control-plane admission identity differs");
  assert(admission.status === "ADMITTED_NEXT_CAMPAIGN" && admission.active_campaign === false
    && admission.product_writes_allowed === false && admission.product_agent_spawns_allowed === false && admission.deployment_allowed === false,
  "campaign control-plane admission crossed the inactive boundary");
  requireSha(admission.approval_sha256, "campaign control-plane admission approval");
  requireSha(admission.policy_state_sha256, "campaign control-plane admission policy");
  requireSha(admission.admission_sha256, "campaign control-plane admission digest");
  assert(admission.admission_sha256 === ownerReviewDigest({...admission, admission_sha256: null}), "campaign control-plane admission digest mismatch");
  return admission;
}

export function compileCampaignControlPlaneReceipt({
  approvalPacket,
  ownerApproval,
  admission,
  identityBinding,
  auditEvidence,
  currentStatus,
  policyState,
  reconciledAtUtc = null,
}) {
  validatePolicyState(policyState);
  validateOwnerApprovalPacket(approvalPacket);
  assert(approvalPacket.exact_candidate.policy_amendment === null && approvalPacket.exact_candidate.project_context_amendment === null,
    "campaign control-plane receipt cannot apply an unrecorded amendment");
  validateOwnerApproval(ownerApproval, approvalPacket);
  const applied = applyOwnerReviewApproval({
    candidate: approvalPacket.exact_candidate,
    approvalPacket,
    approval: ownerApproval,
    policyState,
    currentBoundary: "NEXT_CAMPAIGN",
  });
  assert(applied.policyState.policy_state_sha256 === policyState.policy_state_sha256, "campaign control-plane receipt changed policy");
  validateAdmission(admission, approvalPacket, policyState);
  sameDigest(admission, applied.admission, "campaign control-plane admission replay");
  validateCampaignIdentityBinding(identityBinding);
  validateAuditEvidence(auditEvidence);
  if (reconciledAtUtc !== null) requireUtc(reconciledAtUtc, "campaign control-plane reconciliation time");

  const receipt = {
    schema: CAMPAIGN_CONTROL_PLANE_RECEIPT_SCHEMA,
    version: 1,
    status: CAMPAIGN_CONTROL_PLANE_RECEIPT_STATUS,
    canonical_campaign_identity: "CONTROLLER_CANDIDATE",
    project_id: approvalPacket.project_id,
    campaign_id: identityBinding.campaign_id,
    campaign_version: identityBinding.campaign_version,
    source_commit: auditEvidence.candidate.commit,
    source_tree: auditEvidence.candidate.tree,
    policy_epoch: policyState.policy_epoch,
    policy_state_sha256: policyState.policy_state_sha256,
    controller_candidate_sha256: approvalPacket.exact_candidate.source_binding.next_campaign_candidate_sha256,
    owner_review_candidate_sha256: approvalPacket.candidate_sha256,
    approval_packet_sha256: approvalPacket.approval_packet_sha256,
    owner_approval_sha256: ownerApproval.approval_sha256,
    admission_sha256: admission.admission_sha256,
    identity_binding_sha256: identityBinding.binding_sha256,
    audit_checkpoint_sha256: auditEvidence.candidate.candidate_sha256,
    audit_plan_sha256: auditEvidence.plan.plan_sha256,
    audit_reconciliation_sha256: auditEvidence.reconciliation.reconciliation_sha256,
    approval_packet: structuredClone(approvalPacket),
    owner_approval: structuredClone(ownerApproval),
    admission: structuredClone(admission),
    identity_binding: structuredClone(identityBinding),
    audit_evidence: structuredClone(auditEvidence),
    current_status: structuredClone(currentStatus),
    active_campaign: false,
    product_writes_allowed: false,
    product_agent_spawns_allowed: false,
    deployment_allowed: false,
    receipt_sha256: null,
  };
  if (reconciledAtUtc !== null) receipt.current_status.reconciled_at_utc = reconciledAtUtc;
  receipt.receipt_sha256 = campaignControlPlaneReceiptDigest(receiptBody(receipt));
  return validateCampaignControlPlaneReceipt(receipt);
}

export function readCampaignControlPlaneReceipt({authorityRoot, receiptPath = "campaign/control-plane-receipt.json"}) {
  const {target} = safeReceiptPath(authorityRoot, receiptPath);
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  assert(stat.isFile() && !stat.isSymbolicLink(), "campaign control-plane receipt must be a regular file");
  let receipt;
  try {
    receipt = JSON.parse(fs.readFileSync(target, "utf8"));
  } catch (error) {
    throw new Error(`campaign control-plane receipt JSON is invalid: ${error.message}`);
  }
  return validateCampaignControlPlaneReceipt(receipt);
}

export function writeCampaignControlPlaneReceiptCompareAndSwap({
  authorityRoot,
  receiptPath = "campaign/control-plane-receipt.json",
  expectedReceiptSha256 = null,
  receipt,
}) {
  validateCampaignControlPlaneReceipt(receipt);
  requireSha(expectedReceiptSha256, "expected campaign control-plane receipt", {nullable: true});
  const {target} = safeReceiptPath(authorityRoot, receiptPath);
  fs.mkdirSync(path.dirname(target), {recursive: true});
  const lockPath = `${target}.lock`;
  let lockDescriptor;
  let lockHeld = false;
  let temporary;
  try {
    lockDescriptor = fs.openSync(lockPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
    lockHeld = true;
    const current = readCampaignControlPlaneReceipt({authorityRoot, receiptPath});
    if (expectedReceiptSha256 === null) assert(current === null, "campaign control-plane receipt already exists");
    else assert(current !== null && current.receipt_sha256 === expectedReceiptSha256, "campaign control-plane receipt compare-and-swap parent is stale");
    temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.stage`);
    const bytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
    const descriptor = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
    try {
      fs.writeFileSync(descriptor, bytes);
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    fs.renameSync(temporary, target);
    temporary = null;
  } finally {
    if (temporary !== undefined && fs.existsSync(temporary)) fs.unlinkSync(temporary);
    if (lockDescriptor !== undefined) fs.closeSync(lockDescriptor);
    if (lockHeld) {
      try { fs.unlinkSync(lockPath); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  }
  const readback = readCampaignControlPlaneReceipt({authorityRoot, receiptPath});
  assert(readback?.receipt_sha256 === receipt.receipt_sha256, "campaign control-plane receipt readback digest differs");
  return {path: receiptPath, receipt_sha256: readback.receipt_sha256};
}
