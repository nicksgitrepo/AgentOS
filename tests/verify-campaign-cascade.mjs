#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  AUDIT_DISCIPLINES,
  compileAuditPlan,
  compileAuditReport,
  compileCheckpointAuditLedger,
  compileDeltaAudit,
  compileFirstPassCandidate,
  compileModelPolicy,
  compileRollingAudit,
  completeCampaignFinalizer,
  deriveApplicableDisciplines,
  openCampaignFinalizer,
  reconcileAuditFindings,
  validateAuditPlan,
  validateCheckpointAuditLedger,
  validateDeltaAudit,
  validateModelPolicy,
  validateRollingAudit,
} from "../control/campaign-cascade.mjs";

const SHA = "a".repeat(64);
const candidateInput = {
  candidate_id: "CANDIDATE-1", campaign_id: "CAMPAIGN-1", campaign_version: "v1", logical_lineage_id: "LINE-1",
  worktree_id: "ROOT-WORKTREE", branch: "campaign/main", commit: "commit-1", tree: "tree-1", remote_commit: "commit-1", remote_tree: "tree-1",
  clean: true, pushed: true, changed_paths: ["docs/guide.md"], changed_surfaces: ["DOCS"], owner_role_id: "FEATURE_AGENT:ONE",
  auditor_session_id: "AUDITOR-1",
  created_at_utc: "2026-08-03T00:00:00.000Z",
  quality_floor: {
    intended_path_present: true, affected_checks_pass: true, interfaces_coherent: true, critical_defect_disclosed: true,
    safe_operations: true, clean_checkpoint: true, pushed_checkpoint: true, incomplete_work: [], evidence_sha256: SHA,
  },
};
const candidate = compileFirstPassCandidate(candidateInput);
assert.equal(deriveApplicableDisciplines(["DOCS"]).size, 0);
const docPlan = compileAuditPlan({candidate, auditorSessionId: "AUDITOR-1", terminal: false});
assert(docPlan.disciplines.every((item) => item.disposition === "DEFERRED_UNTIL_TERMINAL"));
validateAuditPlan(docPlan);
const terminalDocPlan = compileAuditPlan({
  candidate: compileFirstPassCandidate({...candidateInput, terminal: true}),
  auditorSessionId: "AUDITOR-1",
  terminal: true,
  applicability: Object.fromEntries(AUDIT_DISCIPLINES.map((discipline) => [discipline, false])),
  nonApplicabilityEvidence: Object.fromEntries(AUDIT_DISCIPLINES.map((discipline) => [discipline, SHA])),
});
assert(terminalDocPlan.disciplines.every((item) => item.disposition === "NOT_APPLICABLE_WITH_PROOF"));
const docReconciliation = reconcileAuditFindings({plan: terminalDocPlan, reports: []});
assert.equal(docReconciliation.settled_disciplines.length, 4);

const deterministicPlan = compileAuditPlan({
  candidate: compileFirstPassCandidate({...candidateInput, candidate_id: "CANDIDATE-DET", terminal: true}),
  auditorSessionId: "AUDITOR-1",
  terminal: true,
  applicability: {FUNCTIONALITY: "DETERMINISTIC_ONLY", DESIGN_UI_SHELL_NAVIGATION: false, SECURITY: false, CODE_QUALITY_HYGIENE: false},
  nonApplicabilityEvidence: {DESIGN_UI_SHELL_NAVIGATION: SHA, SECURITY: SHA, CODE_QUALITY_HYGIENE: SHA},
});
const deterministicReport = compileAuditReport({plan: deterministicPlan, discipline: "FUNCTIONALITY", auditorSessionId: "AUDITOR-1", workerSessionId: null, evidenceSha256: SHA});
const deterministicReconciliation = reconcileAuditFindings({plan: deterministicPlan, reports: [deterministicReport]});
assert.equal(deterministicReconciliation.reports[0].worker_session_id, null);

const codePlan = compileAuditPlan({
  candidate: compileFirstPassCandidate({...candidateInput, candidate_id: "CANDIDATE-CODE", changed_surfaces: ["UI"], terminal: true}),
  auditorSessionId: "AUDITOR-1",
  terminal: true,
  applicability: {FUNCTIONALITY: true, DESIGN_UI_SHELL_NAVIGATION: true, SECURITY: false, CODE_QUALITY_HYGIENE: true},
  nonApplicabilityEvidence: {SECURITY: SHA},
});
assert(codePlan.disciplines.find((item) => item.discipline === "SECURITY").disposition === "NOT_APPLICABLE_WITH_PROOF");
assert.throws(() => compileAuditReport({
  plan: codePlan, discipline: "CODE_QUALITY_HYGIENE", auditorSessionId: "AUDITOR-1", workerSessionId: "WORKER-CODE", evidenceSha256: SHA,
  findings: [{finding_id: "F-CODE", discipline: "CODE_QUALITY_HYGIENE", severity: "MATERIAL", causal_root_id: "ROOT-CODE", route: "FINALIZATION_QUEUE", question_ids: [], evidence_sha256: SHA, summary: "unmapped material hygiene"}],
}));

const fullCandidate = compileFirstPassCandidate({...candidateInput, candidate_id: "CANDIDATE-FULL", terminal: true, changed_surfaces: ["AUTHENTICATED_UI"]});
const fullPlan = compileAuditPlan({candidate: fullCandidate, auditorSessionId: "AUDITOR-1", terminal: true});
const reports = fullPlan.disciplines.filter((item) => ["REQUIRED", "DETERMINISTIC_ONLY"].includes(item.disposition)).map((item, index) => compileAuditReport({
  plan: fullPlan,
  discipline: item.discipline,
    auditorSessionId: "AUDITOR-1",
  workerSessionId: item.disposition === "REQUIRED" ? `WORKER-${index}` : null,
  reviewedQuestionIds: item.disposition === "REQUIRED" ? [item.discipline === "FUNCTIONALITY" ? "FR-ENTRY" : item.discipline === "DESIGN_UI_SHELL_NAVIGATION" ? "DB-SURFACE" : item.discipline === "SECURITY" ? "SEC-ACCESS" : "FR-RESULT"] : [],
  evidenceSha256: SHA,
}));
const reconciliation = reconcileAuditFindings({plan: fullPlan, reports});
assert.equal(reconciliation.immediate_first_pass_repairs.length, 0);
const directAuditorReports = fullPlan.disciplines
  .filter((item) => ["REQUIRED", "DETERMINISTIC_ONLY"].includes(item.disposition))
  .map((item) => compileAuditReport({
    plan: fullPlan,
    discipline: item.discipline,
    auditorSessionId: "AUDITOR-1",
    workerSessionId: null,
    evidenceSha256: SHA,
  }));
const directAuditorReconciliation = reconcileAuditFindings({plan: fullPlan, reports: directAuditorReports});
assert(directAuditorReconciliation.reports.every((report) => report.worker_session_id === null));
const rollingAudit = compileRollingAudit({candidate, auditPlan: docPlan});
validateRollingAudit(rollingAudit);
const finalizer = openCampaignFinalizer({candidate: fullCandidate, auditPlan: fullPlan, reconciliation, modelPolicyDigestSha256: SHA, sessionId: "FINALIZER-1", worktreeId: "FINALIZER-WORKTREE", branch: "campaign/finalizer", correctionBatchSha256: SHA});
const completed = completeCampaignFinalizer({finalizer, candidate: fullCandidate, finalCommit: "commit-final", finalTree: "tree-final", changedPaths: ["src/feature.ts"]});
assert.equal(completed.status, "COMPLETE");

const delta = compileDeltaAudit({baselineCommit: "commit-1", baselineTree: "tree-1", candidateCommit: "commit-final", candidateTree: "tree-final", allQuestionIds: ["FR-ENTRY", "FR-RESULT", "DB-SURFACE", "SEC-ACCESS"], previouslyFailedQuestionIds: ["FR-ENTRY"], directlyTouchedQuestionIds: ["FR-RESULT"], dependentQuestionIds: ["SEC-ACCESS"], smokeQuestionIds: ["DB-SURFACE"], causalRootIds: ["ROOT-CODE"], evidenceReuseSha256: SHA});
validateDeltaAudit(delta);
assert(delta.reused_question_ids.length === 0);

const ledger = compileCheckpointAuditLedger({
  activeCandidateId: "CANDIDATE-FULL",
  entries: [
    {candidate_id: "CANDIDATE-1", candidate_commit: "commit-1", candidate_tree: "tree-1", terminal: false, audit_plan_sha256: null, audit_reconciliation_sha256: null, finding_status: "NONE", status: "AUDITING"},
    {candidate_id: "CANDIDATE-FULL", candidate_commit: "commit-1", candidate_tree: "tree-1", terminal: true, audit_plan_sha256: fullPlan.plan_sha256, audit_reconciliation_sha256: reconciliation.reconciliation_sha256, finding_status: "SETTLED", status: "SETTLED"},
  ],
});
validateCheckpointAuditLedger(ledger);
assert.equal(ledger.entries.length, 2);

const modelPolicy = compileModelPolicy({profile: "ECO_CONTINUOUS", completionFloor: 0.8, rolePolicies: [
  ...["CAMPAIGN_ORCHESTRATOR", "INDEPENDENT_AUDITOR", "FEATURE_AGENT", "PLATFORM_AGENT", "AUDIT_WORKER", "CAMPAIGN_FINALIZER", "RUNTIME"].map((role) => ({role, selection_mode: "EXTERNAL_SNAPSHOT", minimum_capability_floor: "TYPED", budget_behavior: "FAIL_CLOSED", fallback_behavior: "RETRY_OR_HOLD"})),
], observations: []});
validateModelPolicy(modelPolicy);

let hostile = 0;
function hostileCase(label, operation) { assert.throws(operation, label); hostile += 1; }
hostileCase("unmapped material finding", () => compileAuditReport({plan: codePlan, discipline: "FUNCTIONALITY", auditorSessionId: "AUDITOR-1", workerSessionId: "WORKER-F", evidenceSha256: SHA, findings: [{finding_id: "F", discipline: "FUNCTIONALITY", severity: "MATERIAL", causal_root_id: "ROOT", route: "FINALIZATION_QUEUE", question_ids: [], evidence_sha256: SHA, summary: "missing mapping"}]}));
hostileCase("deterministic worker", () => compileAuditReport({plan: deterministicPlan, discipline: "FUNCTIONALITY", auditorSessionId: "AUDITOR-1", workerSessionId: "WORKER-WRONG", evidenceSha256: SHA}));
hostileCase("wrong campaign Auditor", () => compileAuditReport({plan: fullPlan, discipline: "FUNCTIONALITY", auditorSessionId: "AUDITOR-WRONG", workerSessionId: null, evidenceSha256: SHA}));
hostileCase("changed candidate reused", () => compileDeltaAudit({baselineCommit: "same", baselineTree: "same", candidateCommit: "same", candidateTree: "same", allQuestionIds: ["FR-ENTRY"], smokeQuestionIds: ["FR-ENTRY"], evidenceReuseSha256: SHA}));
hostileCase("second report", () => reconcileAuditFindings({plan: fullPlan, reports: [...reports, reports[0]]}));
hostileCase("rolling audit of active terminal candidate", () => compileRollingAudit({
  candidate: compileFirstPassCandidate({...candidateInput, candidate_id: "CANDIDATE-TERMINAL", terminal: true}),
  auditPlan: docPlan,
}));
hostileCase("pushed dirty first-pass checkpoint", () => compileFirstPassCandidate({...candidateInput, clean: false, pushed: true}));

console.log(`PASS Governance 2.1rc campaign cascade (${hostile} hostile cases)`);
