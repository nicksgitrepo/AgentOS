#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  AUDIT_DISCIPLINES,
  cascadeDigest,
  compileAuditPlan,
  compileAuditWorkerBinding,
  compileAuditReport,
  compileCheckpointAuditLedger,
  compileCascadeUniversalTaskCloseoutReceipts,
  compileDeltaAudit,
  compileNonApplicabilityEvidence,
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
  validateFirstPassCandidate,
  validateModelPolicy,
  validateRollingAudit,
} from "../control/campaign-cascade.mjs";
import {compileFinalizerRewriteAssessment} from "../control/cascade-economics.mjs";
import {compileCampaignAcceptanceContract} from "../control/campaign-acceptance-contract.mjs";
import {
  campaignIdentityBindingDigest,
  compileCampaignIdentityBinding,
  compileRepositoryCheckpointProof,
  validateCampaignIdentityBinding,
} from "../control/campaign-controller.mjs";
import {compileControllerCampaignCandidate} from "../control/agentos-controller.mjs";

const SHA = "a".repeat(64);
const cascadeCloseout = compileCascadeUniversalTaskCloseoutReceipts({
  receiptRefs: Object.fromEntries([
    "PRESERVE_HANDOFF", "PERSIST_HANDOFF", "AUDIT_CANDIDATE", "INTEGRATE_ACCEPTED_WORK",
    "UNPIN_SESSION", "CLOSE_STALE_WORKTREE", "REMOVE_ACTIVE_TASK_SCOPE", "MARK_CHAT_OUT_OF_SCOPE", "ARCHIVE_VISIBLE_TASK",
  ].map((step) => [step, `opaque:sha256:${cascadeDigest({kind: "cascade-closeout", step})}`])),
  observedAt: "2026-08-03T00:00:00.000Z",
});
assert.equal(cascadeCloseout.length, 9);
assert.equal(cascadeCloseout[0].step, "PRESERVE_HANDOFF");
assert.equal(cascadeCloseout.at(-1).step, "ARCHIVE_VISIBLE_TASK");
function pathBinding(path, candidateId, commit, tree, references) {
  const observation = {
    schema: "governance.path_scope_observation.v1", path, candidate_id: candidateId, commit, tree,
    observation_kind: "PATH_BOUND_SCOPE", summary: `The exact candidate observation covers ${path}.`, observation_sha256: null,
  };
  observation.observation_sha256 = cascadeDigest(observation);
  return {path, references, observation};
}
const acceptanceContract = compileCampaignAcceptanceContract({
  campaignId: "CAMPAIGN-1",
  campaignVersion: "v1",
  logicalLineageId: "LINE-1",
  policyEpoch: 1,
  policyStateSha256: SHA,
  questionTreeSha256: SHA,
  requiredQuestionIdsByRoot: {FUNCTION_REQUIREMENTS: ["FR-ENTRY"], DESIGN_BIBLE: ["DB-SURFACE"], SECURITY: ["SEC-ACCESS"]},
  requiredQuestionIds: ["FR-ENTRY", "DB-SURFACE", "SEC-ACCESS"],
  operationalRequirements: ["clean pushed checkpoint"],
  evidenceRequirements: ["independent three-root acceptance receipt"],
  nonGoals: ["unrelated polish"],
  hardRules: ["no secrets", "independent acceptance"],
  stopCondition: "All required Function Requirements, Design Bible, and Security questions pass.",
  ownerIntentSha256: SHA,
});
const candidateInput = {
  candidate_id: "CANDIDATE-1", campaign_id: "CAMPAIGN-1", campaign_version: "v1", logical_lineage_id: "LINE-1",
  policy_epoch: 1, policy_snapshot_sha256: SHA, acceptance_contract: acceptanceContract, acceptance_contract_sha256: acceptanceContract.contract_sha256,
  scope_justification: {basis: "REQUIRED_ACCEPTANCE", references: ["FR-ENTRY"], summary: "The checkpoint implements the accepted function slice.", owner_authorization_sha256: null, changed_paths: ["docs/guide.md"], path_bindings: [pathBinding("docs/guide.md", "CANDIDATE-1", "commit-1", "tree-1", ["FR-ENTRY"])]},
  worktree_id: "ROOT-WORKTREE", branch: "campaign/main", commit: "commit-1", tree: "tree-1", remote_commit: "commit-1", remote_tree: "tree-1",
  repository_proof: compileRepositoryCheckpointProof({worktreeId: "ROOT-WORKTREE", commit: "commit-1", tree: "tree-1", remoteCommit: "commit-1", remoteTree: "tree-1", clean: true, pushed: true, observedByRole: "DETERMINISTIC_VERIFIER", observedBySession: "QUALITY-VERIFIER", observedAtUtc: "2026-08-03T00:00:00.000Z"}),
  clean: true, pushed: true, changed_paths: ["docs/guide.md"], changed_surfaces: ["DOCS"], owner_role_id: "FEATURE_AGENT:ONE",
  auditor_session_id: "AUDITOR-1",
  created_at_utc: "2026-08-03T00:00:00.000Z",
  quality_floor: {
    intended_path_present: true, affected_checks_pass: true, interfaces_coherent: true, critical_defect_disclosed: true,
    safe_operations: true, clean_checkpoint: true, pushed_checkpoint: true, incomplete_work: [], evidence: {
      schema: "governance.quality_floor_observation.v1", candidate_id: "CANDIDATE-1", campaign_id: "CAMPAIGN-1", campaign_version: "v1",
      worktree_id: "ROOT-WORKTREE", commit: "commit-1", tree: "tree-1", remote_commit: "commit-1", remote_tree: "tree-1",
      checks: ["AFFECTED_CHECKS", "CLEAN_CHECKPOINT", "CRITICAL_DEFECTS", "INTENDED_PATH", "INTERFACES", "PUSHED_CHECKPOINT", "SAFE_OPERATIONS"],
      observed_by_role: "DETERMINISTIC_VERIFIER", observed_by_session: "QUALITY-VERIFIER", observed_at_utc: "2026-08-03T00:00:00.000Z", evidence_sha256: null,
    },
  },
};
candidateInput.quality_floor.evidence.evidence_sha256 = cascadeDigest({...candidateInput.quality_floor.evidence, evidence_sha256: null});
function candidateVariant(overrides = {}) {
  const input = structuredClone({...candidateInput, ...overrides});
  if (input.scope_justification?.path_bindings) {
    input.scope_justification.path_bindings = input.scope_justification.path_bindings.map((binding) => pathBinding(
      binding.path, input.candidate_id, input.commit, input.tree, binding.references,
    ));
  }
  return input;
}
const candidate = compileFirstPassCandidate(candidateInput);
assert.equal(deriveApplicableDisciplines(["DOCS"]).size, 0);
const docPlan = compileAuditPlan({candidate, auditorSessionId: "AUDITOR-1", terminal: false});
assert(docPlan.disciplines.every((item) => item.disposition === "DEFERRED_UNTIL_TERMINAL"));
validateAuditPlan(docPlan);
const terminalDocPlan = compileAuditPlan({
  candidate: compileFirstPassCandidate(candidateVariant({terminal: true})),
  auditorSessionId: "AUDITOR-1",
  terminal: true,
  applicability: Object.fromEntries(AUDIT_DISCIPLINES.map((discipline) => [discipline, false])),
  nonApplicabilityEvidence: Object.fromEntries(AUDIT_DISCIPLINES.map((discipline) => [discipline, compileNonApplicabilityEvidence({
    candidate: compileFirstPassCandidate(candidateVariant({terminal: true})), discipline, auditorSessionId: "AUDITOR-1",
    reason: "The exact candidate changed only documentation and no Product surface is applicable.", observedAtUtc: "2026-08-03T00:00:00.000Z",
  })])),
});
assert(terminalDocPlan.disciplines.every((item) => item.disposition === "NOT_APPLICABLE_WITH_PROOF"));
const docReconciliation = reconcileAuditFindings({plan: terminalDocPlan, reports: []});
assert.equal(docReconciliation.settled_disciplines.length, 4);

const deterministicPlan = compileAuditPlan({
  candidate: compileFirstPassCandidate(candidateVariant({candidate_id: "CANDIDATE-DET", terminal: true})),
  auditorSessionId: "AUDITOR-1",
  terminal: true,
  applicability: {FUNCTIONALITY: "DETERMINISTIC_ONLY", DESIGN_UI_SHELL_NAVIGATION: false, SECURITY: false, CODE_QUALITY_HYGIENE: false},
  nonApplicabilityEvidence: Object.fromEntries(["DESIGN_UI_SHELL_NAVIGATION", "SECURITY", "CODE_QUALITY_HYGIENE"].map((discipline) => [discipline, compileNonApplicabilityEvidence({
    candidate: compileFirstPassCandidate(candidateVariant({candidate_id: "CANDIDATE-DET", terminal: true})), discipline, auditorSessionId: "AUDITOR-1",
    reason: "No applicable Product surface is present in this documentation-only candidate.", observedAtUtc: "2026-08-03T00:00:00.000Z",
  })])),
});
const deterministicReport = compileAuditReport({plan: deterministicPlan, discipline: "FUNCTIONALITY", auditorSessionId: "AUDITOR-1", evidenceSha256: SHA});
const deterministicReconciliation = reconcileAuditFindings({plan: deterministicPlan, reports: [deterministicReport]});
assert.equal(deterministicReconciliation.reports[0].worker_session_id, null);

const codePlan = compileAuditPlan({
  candidate: compileFirstPassCandidate(candidateVariant({candidate_id: "CANDIDATE-CODE", terminal: true})),
  auditorSessionId: "AUDITOR-1",
  terminal: true,
  applicability: {FUNCTIONALITY: true, DESIGN_UI_SHELL_NAVIGATION: true, SECURITY: false, CODE_QUALITY_HYGIENE: true},
  nonApplicabilityEvidence: {SECURITY: compileNonApplicabilityEvidence({
    candidate: compileFirstPassCandidate(candidateVariant({candidate_id: "CANDIDATE-CODE", terminal: true})), discipline: "SECURITY", auditorSessionId: "AUDITOR-1",
    reason: "The candidate has no security-bearing surface outside the declared function/UI scope.", observedAtUtc: "2026-08-03T00:00:00.000Z",
  })},
});
assert(codePlan.disciplines.find((item) => item.discipline === "SECURITY").disposition === "NOT_APPLICABLE_WITH_PROOF");
assert.throws(() => compileAuditReport({
  plan: codePlan, discipline: "CODE_QUALITY_HYGIENE", auditorSessionId: "AUDITOR-1", workerSessionId: "WORKER-CODE", evidenceSha256: SHA,
  findings: [{finding_id: "F-CODE", discipline: "CODE_QUALITY_HYGIENE", severity: "MATERIAL", causal_root_id: "ROOT-CODE", route: "FINALIZATION_QUEUE", question_ids: [], evidence_sha256: SHA, summary: "unmapped material hygiene"}],
}));

const fullCandidate = compileFirstPassCandidate({...candidateInput, candidate_id: "CANDIDATE-FULL", terminal: true, changed_paths: ["src/auth/controller.js"], changed_surfaces: ["AUTHENTICATED_UI", "BACKEND_API"], scope_justification: {...candidateInput.scope_justification, changed_paths: ["src/auth/controller.js"], path_bindings: [pathBinding("src/auth/controller.js", "CANDIDATE-FULL", "commit-1", "tree-1", ["FR-ENTRY"])]}});
const fullPlan = compileAuditPlan({candidate: fullCandidate, auditorSessionId: "AUDITOR-1", terminal: true, nonApplicabilityEvidence: {
  CODE_QUALITY_HYGIENE: compileNonApplicabilityEvidence({candidate: fullCandidate, discipline: "CODE_QUALITY_HYGIENE", auditorSessionId: "AUDITOR-1", reason: "No code-quality-only surface is separately applicable; deterministic checks cover the candidate.", observedAtUtc: "2026-08-03T00:00:00.000Z"}),
}});
function workerReceipt(plan, discipline, sessionId, roster = false) {
  const receipt = {
    schema: `governance.audit_worker_${roster ? "roster" : "spawn"}_receipt.v1`,
    receipt_kind: roster ? "ROSTER" : "SPAWN",
    session_id: sessionId,
    campaign_id: plan.campaign_id,
    campaign_version: plan.campaign_version,
    candidate_id: plan.candidate_id,
    discipline,
    issued_by_role: "CAMPAIGN_ORCHESTRATOR",
    issued_at_utc: "2026-08-03T00:00:00.000Z",
    ...(roster ? {role: "AUDIT_WORKER", status: "ACTIVE"} : {}),
    receipt_sha256: null,
  };
  receipt.receipt_sha256 = cascadeDigest(receipt);
  return receipt;
}
const reports = fullPlan.disciplines.filter((item) => ["REQUIRED", "DETERMINISTIC_ONLY"].includes(item.disposition)).map((item, index) => compileAuditReport({
  plan: fullPlan,
  discipline: item.discipline,
  auditorSessionId: "AUDITOR-1",
  workerBinding: item.disposition === "REQUIRED" ? compileAuditWorkerBinding({plan: fullPlan, discipline: item.discipline, sessionId: `WORKER-${index}`, spawnReceipt: workerReceipt(fullPlan, item.discipline, `WORKER-${index}`), rosterReceipt: workerReceipt(fullPlan, item.discipline, `WORKER-${index}`, true)}) : null,
  reviewedQuestionIds: item.disposition === "REQUIRED" ? [item.discipline === "FUNCTIONALITY" ? "FR-ENTRY" : item.discipline === "DESIGN_UI_SHELL_NAVIGATION" ? "DB-SURFACE" : item.discipline === "SECURITY" ? "SEC-ACCESS" : "FR-RESULT"] : [],
  evidenceSha256: SHA,
}));
const reconciliation = reconcileAuditFindings({plan: fullPlan, reports});
assert.equal(reconciliation.immediate_first_pass_repairs.length, 0);
const controllerCandidate = compileControllerCampaignCandidate({
  projectId: "synthetic-project",
  campaignId: fullCandidate.campaign_id,
  campaignVersion: fullCandidate.campaign_version,
  policyEpoch: fullCandidate.policy_epoch,
  policyStateSha256: fullCandidate.policy_snapshot_sha256,
  ownerIntentSha256: fullCandidate.acceptance_contract.owner_intent_sha256,
  acceptanceContractSha256: fullCandidate.acceptance_contract_sha256,
  modelPlanSha256: SHA,
  scopeSha256: SHA,
  sourceCommit: fullCandidate.commit,
  sourceTree: fullCandidate.tree,
});
const identityBinding = compileCampaignIdentityBinding({
  controllerCandidate,
  auditCandidate: fullCandidate,
  auditPlan: fullPlan,
  auditReconciliation: reconciliation,
});
validateCampaignIdentityBinding(identityBinding);
assert.equal(identityBinding.controller_candidate_sha256, controllerCandidate.candidate_sha256);
assert.equal(identityBinding.audit_candidate_sha256, fullCandidate.candidate_sha256);
assert.equal(identityBinding.audit_plan_sha256, fullPlan.plan_sha256);
assert.equal(identityBinding.audit_reconciliation_sha256, reconciliation.reconciliation_sha256);
assert.equal(identityBinding.binding_sha256, campaignIdentityBindingDigest({...identityBinding, binding_sha256: null}));
const reportsWithFindings = reports.map((report, index) => compileAuditReport({
  plan: fullPlan,
  discipline: report.discipline,
  auditorSessionId: report.auditor_session_id,
  workerBinding: report.worker_binding,
  reviewedQuestionIds: report.reviewed_question_ids,
  evidenceSha256: SHA,
  findings: [{
    finding_id: `F-${index}`,
    discipline: report.discipline,
    severity: "NONCRITICAL",
    causal_root_id: `ROOT-${index}`,
    route: "FINALIZATION_QUEUE",
    question_ids: report.reviewed_question_ids.length > 0 ? [report.reviewed_question_ids[0]] : [],
    evidence_sha256: SHA,
    summary: "deterministic finding order",
  }],
}));
const orderedFindingReconciliation = reconcileAuditFindings({plan: fullPlan, reports: reportsWithFindings});
const reversedFindingReconciliation = reconcileAuditFindings({plan: fullPlan, reports: [...reportsWithFindings].reverse()});
assert.equal(orderedFindingReconciliation.reconciliation_sha256, reversedFindingReconciliation.reconciliation_sha256);
const rollingAudit = compileRollingAudit({candidate, auditPlan: docPlan});
validateRollingAudit(rollingAudit);
const finalizer = openCampaignFinalizer({candidate: fullCandidate, auditPlan: fullPlan, reconciliation, modelPolicyDigestSha256: SHA, sessionId: "FINALIZER-1", worktreeId: "FINALIZER-WORKTREE", branch: "campaign/finalizer", changeJustification: {basis: "REQUIRED_ACCEPTANCE", references: ["FR-ENTRY"], summary: "Finalizer prepares evidence for the accepted function slice.", owner_authorization_sha256: null, changed_paths: ["src/feature.ts"], path_bindings: [pathBinding("src/feature.ts", "CANDIDATE-FULL", "commit-1", "tree-1", ["FR-ENTRY"])]}, correctionBatchSha256: SHA});
const rewriteAssessment = compileFinalizerRewriteAssessment({
  relevant_hunks_replaced: 1, relevant_hunks_total: 10, files_substantially_rewritten: 0,
  public_contracts_reinterpreted: false, architecture_changed: false, owner_intent_recompiled: false,
  tests_rebuilt: false, new_platform_seams_added: false, load_bearing_implementation_replaced: false,
  broad_repository_rediscovery_required: false, first_pass_behavior_preserved: true, same_task_class_low_survival: false,
});
const completed = completeCampaignFinalizer({finalizer, candidate: fullCandidate, finalCommit: "commit-final", finalTree: "tree-final", repositoryProof: compileRepositoryCheckpointProof({worktreeId: "FINALIZER-WORKTREE", commit: "commit-final", tree: "tree-final", remoteCommit: "commit-final", remoteTree: "tree-final", clean: true, pushed: true, observedByRole: "DETERMINISTIC_VERIFIER", observedBySession: "QUALITY-VERIFIER", observedAtUtc: "2026-08-03T00:00:00.000Z"}), changedPaths: ["src/feature.ts"], rewriteAssessment});
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
hostileCase("acceptance question assigned to the wrong root", () => compileCampaignAcceptanceContract({
  campaignId: "CAMPAIGN-WRONG-ROOT", campaignVersion: "v1", logicalLineageId: "LINE-WRONG-ROOT", policyEpoch: 1,
  policyStateSha256: SHA, questionTreeSha256: SHA,
  requiredQuestionIdsByRoot: {FUNCTION_REQUIREMENTS: ["SEC-ACCESS"], DESIGN_BIBLE: ["DB-SURFACE"], SECURITY: ["FR-ENTRY"]},
  requiredQuestionIds: ["FR-ENTRY", "DB-SURFACE", "SEC-ACCESS"], operationalRequirements: ["checkpoint"],
  evidenceRequirements: ["receipt"], nonGoals: ["polish"], hardRules: ["no secrets"], stopCondition: "All roots pass.", ownerIntentSha256: SHA,
}));
hostileCase("deterministic worker", () => compileAuditReport({plan: deterministicPlan, discipline: "FUNCTIONALITY", auditorSessionId: "AUDITOR-1", workerSessionId: "WORKER-WRONG", evidenceSha256: SHA}));
hostileCase("audit plan terminality contradicts candidate", () => compileAuditPlan({candidate, auditorSessionId: "AUDITOR-1", terminal: true}));
hostileCase("terminal required audit without worker", () => compileAuditReport({plan: fullPlan, discipline: "FUNCTIONALITY", auditorSessionId: "AUDITOR-1", workerSessionId: null, reviewedQuestionIds: ["FR-ENTRY"], evidenceSha256: SHA}));
hostileCase("wrong campaign Auditor", () => compileAuditReport({plan: fullPlan, discipline: "FUNCTIONALITY", auditorSessionId: "AUDITOR-WRONG", workerSessionId: null, evidenceSha256: SHA}));
hostileCase("changed candidate reused", () => compileDeltaAudit({baselineCommit: "same", baselineTree: "same", candidateCommit: "same", candidateTree: "same", allQuestionIds: ["FR-ENTRY"], smokeQuestionIds: ["FR-ENTRY"], evidenceReuseSha256: SHA}));
hostileCase("second report", () => reconcileAuditFindings({plan: fullPlan, reports: [...reports, reports[0]]}));
hostileCase("applicable discipline suppressed", () => compileAuditPlan({
  candidate: fullCandidate,
  auditorSessionId: "AUDITOR-1",
  terminal: true,
  applicability: {SECURITY: false},
}));
hostileCase("audit question outside complete contract", () => compileAuditReport({
  plan: fullPlan,
  discipline: "FUNCTIONALITY",
  auditorSessionId: "AUDITOR-1",
  workerSessionId: "WORKER-FUNCTIONALITY",
  reviewedQuestionIds: ["FR-OUTSIDE"],
  evidenceSha256: SHA,
}));
hostileCase("material finding hidden as closed", () => compileAuditReport({
  plan: fullPlan,
  discipline: "FUNCTIONALITY",
  auditorSessionId: "AUDITOR-1",
  workerSessionId: "WORKER-FUNCTIONALITY",
  reviewedQuestionIds: ["FR-ENTRY"],
  evidenceSha256: SHA,
  findings: [{finding_id: "F-HIDDEN", discipline: "FUNCTIONALITY", severity: "MATERIAL", causal_root_id: "ROOT-HIDDEN", route: "CLOSED_NO_FINDING", question_ids: ["FR-ENTRY"], evidence_sha256: SHA, summary: "hidden material defect"}],
}));
hostileCase("rolling audit of active terminal candidate", () => compileRollingAudit({
  candidate: compileFirstPassCandidate(candidateVariant({candidate_id: "CANDIDATE-TERMINAL", terminal: true})),
  auditPlan: docPlan,
}));
hostileCase("pushed dirty first-pass checkpoint", () => compileFirstPassCandidate(candidateVariant({clean: false, pushed: true})));
hostileCase("terminal first-pass checkpoint is not actually clean and pushed", () => compileFirstPassCandidate(candidateVariant({terminal: true, clean: false, pushed: false, quality_floor: {...candidateInput.quality_floor, clean_checkpoint: true, pushed_checkpoint: true}})));
hostileCase("quality floor invents clean and pushed state", () => compileFirstPassCandidate(candidateVariant({quality_floor: {...candidateInput.quality_floor, clean_checkpoint: false}})));
hostileCase("path observation names a different candidate", () => {
  const tampered = structuredClone(candidate);
  tampered.scope_justification.path_bindings[0].observation.candidate_id = "OTHER-CANDIDATE";
  tampered.scope_justification.path_bindings[0].observation.observation_sha256 = cascadeDigest({...tampered.scope_justification.path_bindings[0].observation, observation_sha256: null});
  tampered.candidate_sha256 = cascadeDigest({...tampered, candidate_sha256: null});
  validateFirstPassCandidate(tampered);
});
hostileCase("Controller and audit source checkpoints differ", () => compileCampaignIdentityBinding({
  controllerCandidate: compileControllerCampaignCandidate({
    projectId: "synthetic-project",
    campaignId: fullCandidate.campaign_id,
    campaignVersion: fullCandidate.campaign_version,
    policyEpoch: fullCandidate.policy_epoch,
    policyStateSha256: fullCandidate.policy_snapshot_sha256,
    ownerIntentSha256: fullCandidate.acceptance_contract.owner_intent_sha256,
    acceptanceContractSha256: fullCandidate.acceptance_contract_sha256,
    modelPlanSha256: SHA,
    scopeSha256: SHA,
    sourceCommit: fullCandidate.commit,
    sourceTree: "different-tree",
  }),
  auditCandidate: fullCandidate,
  auditPlan: fullPlan,
  auditReconciliation: reconciliation,
}));
hostileCase("tampered identity binding digest", () => validateCampaignIdentityBinding({...identityBinding, binding_sha256: SHA}));
hostileCase("first-pass path omitted from justification", () => compileFirstPassCandidate({
  ...candidateInput,
  scope_justification: {...candidateInput.scope_justification, changed_paths: ["docs/other.md"]},
}));
hostileCase("Finalizer path omitted from justification", () => completeCampaignFinalizer({
  finalizer,
  candidate: fullCandidate,
  finalCommit: "commit-mismatch",
  finalTree: "tree-mismatch",
  changedPaths: ["src/other.ts"],
  rewriteAssessment,
}));
hostileCase("rebuild-required Finalizer closed as repair", () => completeCampaignFinalizer({
  finalizer,
  candidate: fullCandidate,
  finalCommit: "commit-rebuild",
  finalTree: "tree-rebuild",
  changedPaths: ["src/feature.ts"],
  rewriteAssessment: compileFinalizerRewriteAssessment({
    relevant_hunks_replaced: 4, relevant_hunks_total: 10, files_substantially_rewritten: 2,
    public_contracts_reinterpreted: false, architecture_changed: true, owner_intent_recompiled: false,
    tests_rebuilt: false, new_platform_seams_added: false, load_bearing_implementation_replaced: false,
    broad_repository_rediscovery_required: false, first_pass_behavior_preserved: true, same_task_class_low_survival: false,
  }),
}));

console.log(`PASS Governance 2.1rc campaign cascade (${hostile} hostile cases)`);
