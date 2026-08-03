#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  AUDIT_DISCIPLINES,
  cascadeDigest,
  compileAuditPlan,
  compileAuditReport,
  compileDeltaAudit,
  compileFirstPassCandidate,
  compileModelPolicy,
  completeCampaignFinalizer,
  openCampaignFinalizer,
  reconcileAuditFindings,
  validateAcceptedLiveCascadeBinding,
  validateAuditPlan,
  validateAuditReconciliation,
  validateAuditReport,
  validateCascadeState,
  validateFinalizer,
} from "../control/campaign-cascade.mjs";

const digest = "a".repeat(64);
const now = "2026-08-03T00:00:00.000Z";
const rolePolicies = [
  "CAMPAIGN_ORCHESTRATOR",
  "INDEPENDENT_AUDITOR",
  "FEATURE_AGENT",
  "PLATFORM_AGENT",
  "AUDIT_WORKER",
  "CAMPAIGN_FINALIZER",
  "RUNTIME",
].map((role) => ({
  role,
  selection_mode: "EXTERNAL_SNAPSHOT_ROLE_MATCH",
  minimum_capability_floor: "COMPLETION_FLOOR_AND_REQUIRED_TOOLS",
  budget_behavior: "EXPECTED_ACCEPTED_COST_WITH_REWORK",
  fallback_behavior: "FAIL_CLOSED_NO_ELIGIBLE_MODEL",
}));

const candidate = compileFirstPassCandidate({
  candidate_id: "CANDIDATE-001",
  campaign_id: "campaign-001",
  campaign_version: "001",
  logical_lineage_id: "lineage-001",
  worktree_id: "draft-worktree",
  branch: "campaign/campaign-001",
  commit: "commit-draft",
  tree: "tree-draft",
  remote_commit: "commit-draft",
  remote_tree: "tree-draft",
  clean: true,
  pushed: true,
  changed_paths: ["src/app.ts", "src/app.test.ts"],
  changed_surfaces: ["UI"],
  owner_role_id: "feature-owner",
  terminal: true,
  created_at_utc: now,
  quality_floor: {
    intended_path_present: true,
    affected_checks_pass: true,
    interfaces_coherent: true,
    critical_defect_disclosed: true,
    safe_operations: true,
    clean_checkpoint: true,
    pushed_checkpoint: true,
    incomplete_work: [],
    evidence_sha256: digest,
  },
});

const plan = compileAuditPlan({candidate, terminal: true});
const reports = AUDIT_DISCIPLINES.map((discipline) => compileAuditReport({
  plan,
  discipline,
  auditorSessionId: "auditor-session",
  workerSessionId: `worker-${discipline}`,
  reviewedQuestionIds: [`${discipline === "FUNCTIONALITY" ? "FR" : discipline === "DESIGN_UI_SHELL_NAVIGATION" ? "DB" : "SEC"}-CHECK-001`],
  failedQuestionIds: [],
  findings: [],
  evidenceSha256: digest,
}));
const reconciliation = reconcileAuditFindings({plan, reports, terminal: true});
const materialReport = compileAuditReport({
  plan,
  discipline: "FUNCTIONALITY",
  auditorSessionId: "auditor-session",
  workerSessionId: "worker-FUNCTIONALITY-material",
  reviewedQuestionIds: ["FR-CHECK-001"],
  failedQuestionIds: ["FR-CHECK-001"],
  findings: [{
    finding_id: "FINDING-MATERIAL-001",
    discipline: "FUNCTIONALITY",
    severity: "MATERIAL",
    causal_root_id: "CAUSE-MATERIAL-001",
    route: "FINALIZATION_QUEUE",
    question_ids: ["FR-CHECK-001"],
    evidence_sha256: digest,
    summary: "one bounded cross-cutting correction",
  }],
  evidenceSha256: digest,
});
const materialReconciliation = reconcileAuditFindings({
  plan,
  reports: [...reports.filter((report) => report.discipline !== "FUNCTIONALITY"), materialReport],
  terminal: true,
});
assert.deepEqual(materialReconciliation.finalization_queue, ["FINDING-MATERIAL-001"]);
const nonApplicableCandidate = compileFirstPassCandidate({
  ...structuredClone(candidate),
  candidate_id: "CANDIDATE-NA-001",
  commit: "commit-na",
  tree: "tree-na",
  remote_commit: "commit-na",
  remote_tree: "tree-na",
  changed_surfaces: ["INTERNAL_DOCUMENTATION"],
});
const nonApplicablePlan = compileAuditPlan({
  candidate: nonApplicableCandidate,
  terminal: true,
  nonApplicabilityEvidence: {
    FUNCTIONALITY: digest,
    DESIGN_UI_SHELL_NAVIGATION: digest,
  },
});
assert.deepEqual(
  nonApplicablePlan.disciplines.filter((item) => item.disposition === "NOT_APPLICABLE_WITH_PROOF").map((item) => item.discipline).sort(),
  ["DESIGN_UI_SHELL_NAVIGATION", "FUNCTIONALITY"],
);
const nonApplicableReports = nonApplicablePlan.disciplines
  .filter((item) => item.disposition === "REQUIRED")
  .map((item) => compileAuditReport({
    plan: nonApplicablePlan,
    discipline: item.discipline,
    auditorSessionId: "auditor-session",
    workerSessionId: `worker-${item.discipline}`,
    reviewedQuestionIds: ["SEC-NA-001"],
    failedQuestionIds: [],
    findings: [],
    evidenceSha256: digest,
  }));
const nonApplicableReconciliation = reconcileAuditFindings({
  plan: nonApplicablePlan,
  reports: nonApplicableReports,
  terminal: true,
});
assert.deepEqual(nonApplicableReconciliation.settled_disciplines, [...AUDIT_DISCIPLINES].sort());
const modelPolicy = compileModelPolicy({
  profile: "ECO_CONTINUOUS",
  completionFloor: 0.8,
  marketSnapshotSha256: digest,
  rolePolicies,
});
const finalizer = openCampaignFinalizer({
  candidate,
  auditPlan: plan,
  reconciliation,
  modelPolicyDigestSha256: modelPolicy.policy_sha256,
  sessionId: "finalizer-session",
  worktreeId: "finalizer-worktree",
  branch: "campaign/campaign-001-finalizer",
  scopeFindingIds: [],
  correctionBatchSha256: digest,
});
const completedFinalizer = completeCampaignFinalizer({
  finalizer,
  candidate,
  finalCommit: "commit-final",
  finalTree: "tree-final",
  changedPaths: ["src/app.ts"],
});
const delta = compileDeltaAudit({
  baselineCommit: candidate.commit,
  baselineTree: candidate.tree,
  candidateCommit: completedFinalizer.final_commit,
  candidateTree: completedFinalizer.final_tree,
  allQuestionIds: ["FR-CHECK-001", "DB-CHECK-001", "SEC-CHECK-001", "SEC-CHECK-002"],
  previouslyFailedQuestionIds: ["FR-CHECK-001"],
  directlyTouchedQuestionIds: ["DB-CHECK-001"],
  dependentQuestionIds: [],
  smokeQuestionIds: ["SEC-CHECK-001"],
  causalRootIds: ["CAUSE-001"],
  evidenceReuseSha256: digest,
});
const productAcceptance = {
  question_tree_sha256: digest,
  acceptance_receipt_sha256: digest,
  roots: {
    FUNCTION_REQUIREMENTS: "PASS",
    DESIGN_BIBLE: "PASS",
    SECURITY: "PASS",
  },
  rc_ready: true,
};
const cascade = {
  schema: "governance.campaign_cascade_state.v1",
  governance_version: "2.1rc",
  campaign_id: candidate.campaign_id,
  campaign_version: candidate.campaign_version,
  mode: "STANDARD_SUBSTANTIAL",
  stage: "READY_FOR_ACCEPTANCE",
  logical_lineage_id: candidate.logical_lineage_id,
  first_pass: candidate,
  audit_plan: plan,
  audit_reconciliation: reconciliation,
  finalizer: completedFinalizer,
  delta_audit: delta,
  acceptance: {
    product_acceptance_sha256: cascadeDigest(productAcceptance),
    question_tree_sha256: productAcceptance.question_tree_sha256,
    final_candidate_commit: completedFinalizer.final_commit,
    final_candidate_tree: completedFinalizer.final_tree,
    roots: structuredClone(productAcceptance.roots),
    rc_ready: true,
    auditor_session_id: "auditor-session",
  },
  model_policy: modelPolicy,
  telemetry: {
    records: [],
    evidence_reuse_count: 1,
    escaped_finding_count: 0,
    owner_interruptions: 0,
  },
  loop_control: {
    max_finalization_passes: 1,
    max_delta_repair_passes: 1,
    max_supervisor_reframes: 1,
    equivalent_retry_policy: "STOP_AND_CLASSIFY_AFTER_ONE_REFRAME",
  },
  cascade_sha256: "",
};
delete cascade.cascade_sha256;
cascade.cascade_sha256 = cascadeDigest(cascade);
validateCascadeState(cascade, {productAcceptance});

const acceptedLive = {
  status: "VERIFIED",
  deployed_identity: "release-001",
  rollback_identity: "release-000",
  independent_audit_identity: "live-audit-001",
  closure_receipt_sha256: digest,
  cascade_state_sha256: cascade.cascade_sha256,
};
assert.equal(validateAcceptedLiveCascadeBinding({cascade, acceptedLive, productAcceptance}), true);

let hostileRejected = 0;
function rejects(label, operation) {
  assert.throws(operation, undefined, label);
  hostileRejected += 1;
}

rejects("audit plan loses a discipline", () => {
  const altered = structuredClone(plan);
  altered.disciplines.pop();
  validateAuditPlan(altered);
});
rejects("audit report inspects a mutable wrong candidate", () => {
  const altered = structuredClone(reports[0]);
  altered.candidate_tree = "tree-other";
  validateAuditReport(altered, plan);
});
rejects("reconciliation omits a required report binding", () => {
  const altered = structuredClone(reconciliation);
  altered.reports.pop();
  const body = structuredClone(altered);
  delete body.reconciliation_sha256;
  altered.reconciliation_sha256 = cascadeDigest(body);
  validateAuditReconciliation(altered, plan);
});
rejects("critical finding is queued for finalizer", () => {
  compileAuditReport({
    plan,
    discipline: "SECURITY",
    auditorSessionId: "auditor-session",
    findings: [{
      finding_id: "SEC-CRITICAL-001",
      discipline: "SECURITY",
      severity: "CATASTROPHIC",
      causal_root_id: "CAUSE-CRITICAL",
      route: "FINALIZATION_QUEUE",
      question_ids: ["SEC-CHECK-001"],
      evidence_sha256: digest,
      summary: "critical security failure",
    }],
    evidenceSha256: digest,
  });
});
rejects("finalizer uses source worktree", () => {
  const altered = structuredClone(finalizer);
  altered.worktree_id = candidate.worktree_id;
  const body = structuredClone(altered);
  delete body.finalizer_sha256;
  altered.finalizer_sha256 = cascadeDigest(body);
  validateFinalizer(altered, candidate);
});
rejects("finalizer claims acceptance authority", () => {
  const altered = structuredClone(finalizer);
  altered.acceptance_authority = true;
  const body = structuredClone(altered);
  delete body.finalizer_sha256;
  altered.finalizer_sha256 = cascadeDigest(body);
  validateFinalizer(altered, candidate);
});
rejects("delta audit restarts unaffected corpus", () => {
  compileDeltaAudit({
    baselineCommit: candidate.commit,
    baselineTree: candidate.tree,
    candidateCommit: "commit-other",
    candidateTree: "tree-other",
    allQuestionIds: ["FR-CHECK-001", "DB-CHECK-001", "SEC-CHECK-001", "SEC-CHECK-002"],
    previouslyFailedQuestionIds: [],
    directlyTouchedQuestionIds: [],
    dependentQuestionIds: [],
    smokeQuestionIds: ["FR-CHECK-001", "DB-CHECK-001", "SEC-CHECK-001", "SEC-CHECK-002"],
    causalRootIds: [],
    evidenceReuseSha256: digest,
  });
});
rejects("closure accepts a forged cascade digest", () => {
  const altered = structuredClone(acceptedLive);
  altered.cascade_state_sha256 = digest;
  validateAcceptedLiveCascadeBinding({cascade, acceptedLive: altered, productAcceptance});
});
rejects("closure accepts a changed Product proof", () => {
  const altered = {...productAcceptance, roots: {...productAcceptance.roots, SECURITY: "OPEN_REPAIR"}, rc_ready: false};
  validateAcceptedLiveCascadeBinding({cascade, acceptedLive, productAcceptance: altered});
});

console.log(`PASS Governance 2.1rc campaign cascade (${hostileRejected} hostile cases)`);
