#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  campaignControlPlaneReceiptDigest,
  compileCampaignControlPlaneReceipt,
  readCampaignControlPlaneReceipt,
  validateCampaignControlPlaneReceipt,
  writeCampaignControlPlaneReceiptCompareAndSwap,
} from "../control/campaign-receipts.mjs";
import {compileGlobalPolicyState} from "../control/global-policy-state.mjs";
import {
  compileOwnerApproval,
  compileOwnerApprovalPacket,
  compileOwnerReviewCandidate,
  compileOwnerReviewPacket,
  ownerReviewDigest,
  parseOwnerReviewReturnMarkdown,
} from "../control/owner-review.mjs";
import {
  AUDIT_DISCIPLINES,
  cascadeDigest,
  compileAuditPlan,
  compileAuditReport,
  compileAuditWorkerBinding,
  compileFirstPassCandidate,
  reconcileAuditFindings,
} from "../control/campaign-cascade.mjs";
import {compileCampaignAcceptanceContract} from "../control/campaign-acceptance-contract.mjs";
import {
  campaignIdentityBindingDigest,
  compileCampaignIdentityBinding,
  compileRepositoryCheckpointProof,
} from "../control/campaign-controller.mjs";
import {compileControllerCampaignCandidate} from "../control/agentos-controller.mjs";

const SHA = "a".repeat(64);
const COMMIT = "c".repeat(40);
const TREE = "d".repeat(40);
const NOW = "2026-08-03T00:00:00.000Z";
const LATER = "2026-08-03T01:00:00.000Z";
const failures = [];
let hostiles = 0;

function reject(label, operation) {
  try {
    operation();
    failures.push(`hostile accepted: ${label}`);
  } catch {
    hostiles += 1;
  }
}

function guidance(economy, speed, difficulty, taskFit, reason) {
  return {economy, speed, difficulty, task_fit: taskFit, reason};
}

function modelCandidates() {
  const levels = ["MEDIUM", "HIGH", "EXTRA_HIGH", "PRO"].map((level) => ({
    level,
    model_class: level === "PRO" ? "FRONTIER" : level === "HIGH" ? "PERFORMANCE" : "BALANCED",
    available: true,
    completion_floor: 0.8,
    meets_floor: true,
    economics_sha256: SHA,
    rationale: `The ${level} review level is available in the synthetic host catalog.`,
    guidance: level === "MEDIUM"
      ? guidance("LOW", "FAST", "ROUTINE", "CONDITIONAL", "Suitable for routine work.")
      : level === "HIGH"
        ? guidance("MEDIUM", "MEDIUM", "SUBSTANTIAL", "GOOD", "Balances care, speed, and economy.")
        : guidance("HIGH", "SLOW", "HIGH_CONSEQUENCE", "GOOD", "Reserved for difficult work."),
    recommended: level === "HIGH",
  }));
  const roles = ["CAMPAIGN_ORCHESTRATOR", "INDEPENDENT_AUDITOR", "FEATURE_AGENT", "PLATFORM_AGENT", "AUDIT_WORKER", "CAMPAIGN_FINALIZER", "RUNTIME"].flatMap((role) => [{
    role,
    model_class: role === "RUNTIME" ? "HOST_DEFAULT" : "BALANCED",
    available: true,
    completion_floor: 0.8,
    meets_floor: true,
    economics_sha256: SHA,
    rationale: `The synthetic host catalog supports ${role}.`,
    guidance: guidance("MEDIUM", "MEDIUM", "SUBSTANTIAL", "GOOD", "The synthetic host catalog supports this role."),
    recommended: true,
  }]);
  return {chat_review_levels: levels, campaign_role_candidates: roles, economics_snapshot_sha256: SHA, host_catalog_sha256: SHA};
}

function reviewReturn(packet) {
  return {
    schema: "agentos.user_review_return.v1",
    review_id: packet.review.review_id,
    project_id: packet.review.project_id,
    source_policy_epoch: packet.source_binding.policy_epoch,
    source_policy_state_sha256: packet.source_binding.policy_state_sha256,
    source_campaign_candidate_sha256: packet.source_binding.next_campaign_candidate_sha256,
    orientation: {owner_confirmed_current_summary: true, corrections: []},
    intent: {
      desired_outcome: "Prove one small useful workflow.",
      user_and_moment: "A project owner needs one trustworthy result.",
      rationale: "A bounded first result is easy to verify and undo.",
      north_star_change_requested: null,
    },
    changes: {
      required: ["Keep the first workflow clear and bounded."],
      desired_if_economical: ["Show a concise truthful result."],
      preserve: ["Keep exact approval and hard boundaries."],
      remove: [],
      defer: ["Unrelated polish."],
      non_goals: ["Do not redesign unrelated surfaces."],
    },
    campaign: {
      proposed_boundary: packet.candidate_campaign.owner_outcome,
      first_useful_workflow: packet.candidate_campaign.first_useful_workflow,
      priorities: ["Complete the first useful workflow."],
      deadline: null,
      risk_posture: "Use the reversible route.",
      task_profile: {difficulty: "ROUTINE", time_sensitivity: "MEDIUM", cost_sensitivity: "MEDIUM"},
    },
    model_preferences: {
      cost_priority: 0.5,
      speed_priority: 0.5,
      quality_priority: 0.8,
      accepted_chat_level: null,
      campaign_role_preferences: [],
    },
    policy_changes: [],
    owner_soft_confirmations: {intent_confirmed: true, change_set_confirmed: true, campaign_shape_confirmed: true, model_plan_confirmed: true},
    unresolved: [],
    advisory_only: true,
  };
}

function pathBinding(pathValue, candidateId, references) {
  const observation = {
    schema: "governance.path_scope_observation.v1",
    path: pathValue,
    candidate_id: candidateId,
    commit: COMMIT,
    tree: TREE,
    observation_kind: "PATH_BOUND_SCOPE",
    summary: `The synthetic candidate covers ${pathValue}.`,
    observation_sha256: null,
  };
  observation.observation_sha256 = cascadeDigest(observation);
  return {path: pathValue, references, observation};
}

function auditFixture(policyStateSha256 = SHA) {
  const acceptanceContract = compileCampaignAcceptanceContract({
    campaignId: "CAMPAIGN-1",
    campaignVersion: "v1",
    logicalLineageId: "LINE-1",
    policyEpoch: 1,
    policyStateSha256,
    questionTreeSha256: SHA,
    requiredQuestionIdsByRoot: {FUNCTION_REQUIREMENTS: ["FR-ENTRY"], DESIGN_BIBLE: ["DB-SURFACE"], SECURITY: ["SEC-ACCESS"]},
    requiredQuestionIds: ["FR-ENTRY", "DB-SURFACE", "SEC-ACCESS"],
    operationalRequirements: ["clean pushed checkpoint"],
    evidenceRequirements: ["complete independent audit report bodies"],
    nonGoals: ["unrelated polish"],
    hardRules: ["no secrets", "independent acceptance"],
    stopCondition: "All required questions pass.",
    ownerIntentSha256: SHA,
  });
  const candidate = compileFirstPassCandidate({
    candidate_id: "CANDIDATE-1",
    campaign_id: "CAMPAIGN-1",
    campaign_version: "v1",
    logical_lineage_id: "LINE-1",
    policy_epoch: 1,
    policy_snapshot_sha256: policyStateSha256,
    acceptance_contract: acceptanceContract,
    acceptance_contract_sha256: acceptanceContract.contract_sha256,
    scope_justification: {
      basis: "REQUIRED_ACCEPTANCE",
      references: ["FR-ENTRY"],
      summary: "The synthetic checkpoint implements one accepted slice.",
      owner_authorization_sha256: null,
      changed_paths: ["src/auth/controller.js", "tests/controller.test.js"],
      path_bindings: [
        pathBinding("src/auth/controller.js", "CANDIDATE-1", ["FR-ENTRY"]),
        pathBinding("tests/controller.test.js", "CANDIDATE-1", ["FR-ENTRY"]),
      ],
    },
    worktree_id: "ROOT-WORKTREE",
    branch: "campaign/main",
    commit: COMMIT,
    tree: TREE,
    remote_commit: COMMIT,
    remote_tree: TREE,
    repository_proof: compileRepositoryCheckpointProof({
      worktreeId: "ROOT-WORKTREE", commit: COMMIT, tree: TREE, remoteCommit: COMMIT, remoteTree: TREE,
      clean: true, pushed: true, observedByRole: "DETERMINISTIC_VERIFIER", observedBySession: "QUALITY-VERIFIER", observedAtUtc: NOW,
    }),
    clean: true,
    pushed: true,
    changed_paths: ["src/auth/controller.js", "tests/controller.test.js"],
    changed_surfaces: ["AUTHENTICATED_UI", "BACKEND_API", "TESTS"],
    owner_role_id: "FEATURE_AGENT:ONE",
    auditor_session_id: "AUDITOR-1",
    checkpoint_kind: "TERMINAL_FIRST_PASS",
    terminal: true,
    created_at_utc: NOW,
    quality_floor: {
      intended_path_present: true,
      affected_checks_pass: true,
      interfaces_coherent: true,
      critical_defect_disclosed: true,
      safe_operations: true,
      clean_checkpoint: true,
      pushed_checkpoint: true,
      incomplete_work: [],
      evidence: {
        schema: "governance.quality_floor_observation.v1",
        candidate_id: "CANDIDATE-1",
        campaign_id: "CAMPAIGN-1",
        campaign_version: "v1",
        worktree_id: "ROOT-WORKTREE",
        commit: COMMIT,
        tree: TREE,
        remote_commit: COMMIT,
        remote_tree: TREE,
        checks: ["AFFECTED_CHECKS", "CLEAN_CHECKPOINT", "CRITICAL_DEFECTS", "INTENDED_PATH", "INTERFACES", "PUSHED_CHECKPOINT", "SAFE_OPERATIONS"],
        observed_by_role: "DETERMINISTIC_VERIFIER",
        observed_by_session: "QUALITY-VERIFIER",
        observed_at_utc: NOW,
        evidence_sha256: null,
      },
    },
  });
  const plan = compileAuditPlan({
    candidate,
    auditorSessionId: "AUDITOR-1",
    terminal: true,
    applicability: Object.fromEntries(AUDIT_DISCIPLINES.map((discipline) => [discipline, true])),
  });
  function workerReceipt(discipline, sessionId, roster) {
    const receipt = {
      schema: `governance.audit_worker_${roster ? "roster" : "spawn"}_receipt.v1`,
      receipt_kind: roster ? "ROSTER" : "SPAWN",
      session_id: sessionId,
      campaign_id: plan.campaign_id,
      campaign_version: plan.campaign_version,
      candidate_id: plan.candidate_id,
      discipline,
      issued_by_role: "CAMPAIGN_ORCHESTRATOR",
      issued_at_utc: NOW,
      ...(roster ? {role: "AUDIT_WORKER", status: "ACTIVE"} : {}),
      receipt_sha256: null,
    };
    receipt.receipt_sha256 = cascadeDigest(receipt);
    return receipt;
  }
  const questions = {
    FUNCTIONALITY: ["FR-ENTRY"],
    DESIGN_UI_SHELL_NAVIGATION: ["DB-SURFACE"],
    SECURITY: ["SEC-ACCESS"],
    CODE_QUALITY_HYGIENE: ["FR-ENTRY"],
  };
  const reports = plan.disciplines.map((item, index) => {
    const sessionId = `WORKER-${index}`;
    const binding = compileAuditWorkerBinding({
      plan,
      discipline: item.discipline,
      sessionId,
      spawnReceipt: workerReceipt(item.discipline, sessionId, false),
      rosterReceipt: workerReceipt(item.discipline, sessionId, true),
    });
    return compileAuditReport({
      plan,
      discipline: item.discipline,
      auditorSessionId: "AUDITOR-1",
      workerBinding: binding,
      reviewedQuestionIds: questions[item.discipline],
      evidenceSha256: SHA,
    });
  });
  const reconciliation = reconcileAuditFindings({plan, reports});
  return {candidate, plan, reports, reconciliation};
}

try {
  const policyState = compileGlobalPolicyState({projectId: "synthetic-project", nowUtc: NOW});
  const auditEvidence = auditFixture(policyState.policy_state_sha256);
  const controllerCandidate = compileControllerCampaignCandidate({
    projectId: "synthetic-project",
    campaignId: auditEvidence.candidate.campaign_id,
    campaignVersion: auditEvidence.candidate.campaign_version,
    policyEpoch: auditEvidence.candidate.policy_epoch,
    policyStateSha256: auditEvidence.candidate.policy_snapshot_sha256,
    ownerIntentSha256: auditEvidence.candidate.acceptance_contract.owner_intent_sha256,
    acceptanceContractSha256: auditEvidence.candidate.acceptance_contract_sha256,
    modelPlanSha256: SHA,
    scopeSha256: SHA,
    sourceCommit: COMMIT,
    sourceTree: TREE,
  });
  const packet = compileOwnerReviewPacket({
    reviewId: "REVIEW-001",
    projectId: "synthetic-project",
    createdAtUtc: NOW,
    expiresAtUtc: "2026-08-09T00:00:00.000Z",
    sourceBinding: {
      policy_epoch: policyState.policy_epoch,
      policy_state_sha256: policyState.policy_state_sha256,
      project_context_sha256: SHA,
      source_commit: COMMIT,
      source_tree: TREE,
      current_campaign_id: null,
      next_campaign_candidate_sha256: controllerCandidate.candidate_sha256,
    },
    policyState,
    questionIdsByRoot: {FUNCTION_REQUIREMENTS: ["FR-ENTRY"], DESIGN_BIBLE: ["DB-SURFACE"], SECURITY: ["SEC-ACCESS"]},
    currentProject: {
      summary: "A synthetic project with one accepted baseline.",
      north_star: "Prove one useful workflow.",
      users: ["project owner"],
      accepted_capabilities: ["baseline is readable"],
      working_unaccepted: ["next workflow is not built"],
      unavailable: [],
      known_flaws: [],
      deferred: ["unrelated polish"],
      current_recommendation: "Use one small first useful workflow.",
    },
    reviewScope: {
      may_change: ["next campaign intent"],
      may_not_change: ["current accepted truth"],
      protected_boundaries: ["no secrets", "no silent deployment"],
      owner_only_decisions: ["publication and spending"],
    },
    candidateCampaign: {
      owner_outcome: "Prove the primary workflow.",
      first_useful_workflow: "Owner completes the primary workflow and sees a truthful result.",
      proposed_features: ["primary workflow"],
      dependencies: [],
      excluded_scope: ["unrelated polish"],
      campaign_mode: "STANDARD_SUBSTANTIAL",
      release_stop: "Stop when the workflow and three roots pass.",
      task_profile: {difficulty: "SUBSTANTIAL", time_sensitivity: "MEDIUM", cost_sensitivity: "MEDIUM"},
    },
    modelCandidates: modelCandidates(),
    transport: "PRIVATE_MARKDOWN",
    memoryPosture: "PROJECT_ONLY",
    voiceRecommended: true,
  });
  const response = parseOwnerReviewReturnMarkdown(`\`\`\`json\n${JSON.stringify(reviewReturn(packet))}\n\`\`\``, packet);
  const candidate = compileOwnerReviewCandidate({packet, response, policyState, nowUtc: LATER});
  const identityBinding = compileCampaignIdentityBinding({
    controllerCandidate,
    auditCandidate: auditEvidence.candidate,
    auditPlan: auditEvidence.plan,
    auditReconciliation: auditEvidence.reconciliation,
  });
  const approvalPacket = compileOwnerApprovalPacket({candidate, packet, policyState, campaignIdentityBinding: identityBinding});
  const approval = compileOwnerApproval({approvalPacket, approvedAtUtc: "2026-08-03T02:00:00.000Z", actorDigestSha256: SHA});
  const admission = (await import("../control/owner-review.mjs")).applyOwnerReviewApproval({
    candidate,
    approvalPacket,
    approval,
    policyState,
    currentBoundary: "NEXT_CAMPAIGN",
  }).admission;
  const currentStatus = {
    current_commit: COMMIT,
    current_tree: TREE,
    queue_status: "ADMITTED_NEXT_CAMPAIGN",
    active_campaign: false,
    controller_status: "PREPARED_NOT_ACTIVATED",
    reconciliation_status: "RECONCILED_INACTIVE",
    controller_candidate_sha256: controllerCandidate.candidate_sha256,
    owner_review_candidate_sha256: candidate.candidate_sha256,
    approval_packet_sha256: approvalPacket.approval_packet_sha256,
    identity_binding_sha256: identityBinding.binding_sha256,
    audit_candidate_sha256: auditEvidence.candidate.candidate_sha256,
    audit_plan_sha256: auditEvidence.plan.plan_sha256,
    audit_reconciliation_sha256: auditEvidence.reconciliation.reconciliation_sha256,
    audit_reports_complete: 4,
    audit_findings: 0,
    scope_intent_unchanged: true,
  };
  const receipt = compileCampaignControlPlaneReceipt({
    approvalPacket,
    ownerApproval: approval,
    admission,
    identityBinding,
    auditEvidence,
    currentStatus,
    policyState,
    reconciledAtUtc: "2026-08-03T03:00:00.000Z",
  });
  validateCampaignControlPlaneReceipt(receipt);
  const controlPlaneRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-campaign-receipt-"));
  try {
    const persisted = writeCampaignControlPlaneReceiptCompareAndSwap({authorityRoot: controlPlaneRoot, receipt, receiptPath: "campaign/receipt.json"});
    assert.equal(persisted.receipt_sha256, receipt.receipt_sha256);
    const bytes = fs.readFileSync(path.join(controlPlaneRoot, "campaign/receipt.json"), "utf8");
    assert.doesNotThrow(() => JSON.parse(bytes));
    const readback = readCampaignControlPlaneReceipt({authorityRoot: controlPlaneRoot, receiptPath: "campaign/receipt.json"});
    assert.equal(readback.receipt_sha256, receipt.receipt_sha256);
    assert.equal(readback.audit_evidence.reports.length, 4);
    assert.equal(campaignControlPlaneReceiptDigest({...readback, receipt_sha256: null}), receipt.receipt_sha256);

    reject("stale compare-and-swap parent", () => writeCampaignControlPlaneReceiptCompareAndSwap({authorityRoot: controlPlaneRoot, receiptPath: "campaign/receipt.json", expectedReceiptSha256: "f".repeat(64), receipt}));
    const missingReport = structuredClone(auditEvidence);
    missingReport.reports.pop();
    reject("missing complete audit report body", () => compileCampaignControlPlaneReceipt({approvalPacket, ownerApproval: approval, admission, identityBinding, auditEvidence: missingReport, currentStatus, policyState}));
    const summaryOnly = structuredClone(auditEvidence);
    summaryOnly.reports[0] = {discipline: summaryOnly.reports[0].discipline, findings: []};
    reject("summary-only audit evidence", () => compileCampaignControlPlaneReceipt({approvalPacket, ownerApproval: approval, admission, identityBinding, auditEvidence: summaryOnly, currentStatus, policyState}));
    const wrongBinding = structuredClone(identityBinding);
    wrongBinding.controller_candidate_sha256 = "b".repeat(64);
    wrongBinding.binding_sha256 = campaignIdentityBindingDigest({...wrongBinding, binding_sha256: null});
    reject("audit wrapper mapped to another Controller candidate", () => compileCampaignControlPlaneReceipt({approvalPacket, ownerApproval: approval, admission, identityBinding: wrongBinding, auditEvidence, currentStatus, policyState}));
    const mismatchedAdmissionApproval = structuredClone(receipt);
    mismatchedAdmissionApproval.admission.approval_sha256 = "b".repeat(64);
    mismatchedAdmissionApproval.admission.admission_sha256 = ownerReviewDigest({...mismatchedAdmissionApproval.admission, admission_sha256: null});
    mismatchedAdmissionApproval.receipt_sha256 = campaignControlPlaneReceiptDigest({...mismatchedAdmissionApproval, receipt_sha256: null});
    reject("admission approval is not bound to owner approval", () => validateCampaignControlPlaneReceipt(mismatchedAdmissionApproval));
    const staleStatus = {...currentStatus, current_tree: "e".repeat(40)};
    reject("stale current commit/tree", () => compileCampaignControlPlaneReceipt({approvalPacket, ownerApproval: approval, admission, identityBinding, auditEvidence, currentStatus: staleStatus, policyState}));
    const activeStatus = {...currentStatus, active_campaign: true};
    reject("current status crosses inactive boundary", () => compileCampaignControlPlaneReceipt({approvalPacket, ownerApproval: approval, admission, identityBinding, auditEvidence, currentStatus: activeStatus, policyState}));
    fs.writeFileSync(path.join(controlPlaneRoot, "campaign/receipt.json"), "{malformed", {mode: 0o600});
    reject("malformed JSON readback", () => readCampaignControlPlaneReceipt({authorityRoot: controlPlaneRoot, receiptPath: "campaign/receipt.json"}));
    const symlinkPath = path.join(controlPlaneRoot, "campaign/symlink.json");
    fs.symlinkSync(path.join(controlPlaneRoot, "campaign/receipt.json"), symlinkPath);
    reject("symlink receipt path", () => readCampaignControlPlaneReceipt({authorityRoot: controlPlaneRoot, receiptPath: "campaign/symlink.json"}));
  } finally {
    fs.rmSync(controlPlaneRoot, {recursive: true, force: true});
  }
} catch (error) {
  failures.push(error.stack || error.message);
}

assert.deepEqual(failures, []);
assert(hostiles >= 7);
console.log(`PASS AgentOS campaign control-plane receipts (${hostiles} hostile cases, complete report-body retention, exact replay, CAS, JSON, symlink, and inactive-boundary checks)`);
