#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  ANSWER_VALUES,
  BRANCHES,
  LIFECYCLE_STATES,
  ROOTS,
  compileAcceptance,
  compileCriticalFreeze,
  compileEvidencePlan,
  compileQuestionTree,
  compileRepairDecision,
  compileRepairPacket,
  evaluateQuestion,
  invalidateQuestions,
  invalidateQuestionsFromPolicyAmendment,
  sha256,
  validateQuestionTree,
} from "../control/question-tree.mjs";
import {
  compileProductAcceptanceProof,
  verifyProductAcceptanceProof,
} from "../control/acceptance-bridge.mjs";

const DIGEST = "a".repeat(64);
const NOW = "2026-08-03T00:00:00.000Z";
const AUTHORITY = {authority_id: "TEST-AUTHORITY", version: "1", sha256: DIGEST};

function evidence(kind, questionTreeVersion = "2.1rc") {
  return {
    evidence_id: `EVIDENCE-${kind}`,
    kind,
    sha256: DIGEST,
    commit_sha: "commit-001",
    worktree_id: "WORKTREE-001",
    build_identity: "BUILD-001",
    environment_id: "ENV-001",
    observed_at_utc: NOW,
    question_tree_version: questionTreeVersion,
  };
}

function binding() {
  return {
    commit_sha: "commit-001",
    worktree_id: "WORKTREE-001",
    relevant_hashes: [DIGEST],
    build_identity: "BUILD-001",
    environment_id: "ENV-001",
    question_tree_version: "2.1rc",
  };
}

function clause(questionId, root, appliesToSurfaces, parentQuestionId = null) {
  return {
    clause_id: `${questionId}:CLAUSE`,
    question_id: questionId,
    root,
    parent_question_id: parentQuestionId,
    source_authority: structuredClone(AUTHORITY),
    applicability: {predicate_id: `${questionId}:APPLICABLE`, question: `Does ${questionId} apply?`},
    atomic_question: `Does ${questionId} produce its exact observable result?`,
    required_evidence: [`${questionId}:RESULT`],
    repair_owner_role: "FEATURE_AGENT",
    invalidation_conditions: [`${questionId}:CHANGE`],
    blocking_scope: `${questionId}:SCOPE`,
    exception_policy: {allowed: true, granting_authority_ids: ["OWNER"], scope: `${questionId}:SCOPE`},
    materiality: "MATERIAL_PRODUCT_ACCEPTANCE",
    applies_to_surfaces: appliesToSurfaces,
  };
}

function manifest(changedSurfaces = ["UI"]) {
  const body = {
    schema: "governance.changed_surface_manifest.v1",
    checkpoint_id: "CHECKPOINT-001",
    originating_owner_role_id: "FEATURE_AGENT-001",
    root_id: "WORKTREE-001",
    branch: "campaign/main",
    commit: "commit-001",
    tree: "tree-001",
    changed_paths: ["src/feature.ts"],
    changed_surfaces: changedSurfaces,
  };
  return {...body, manifest_sha256: sha256(body)};
}

const sourceClauses = [
  clause("FR-ENTRY-001", "FUNCTION_REQUIREMENTS", ["ALWAYS"]),
  clause("DB-SURFACE-001", "DESIGN_BIBLE", ["UI"]),
  clause("SEC-ACCESS-001", "SECURITY", ["BACKEND_API"]),
];
const tree = compileQuestionTree({
  schema: "governance.question_tree_source_clauses.v1",
  campaign_id: "CAMPAIGN-001",
  question_tree_version: "2.1rc",
  change_manifest: manifest(["UI", "BACKEND_API"]),
  clauses: sourceClauses,
});
validateQuestionTree(tree);
assert.deepEqual(tree.roots, ROOTS);
assert.deepEqual(tree.questions[0].allowed_answers, ANSWER_VALUES);
assert.deepEqual(tree.questions[0].branches, BRANCHES);
assert.equal(new Set(LIFECYCLE_STATES).size, 5);

function observation(question, answer = "YES", lifecycle = answer === "YES" || answer === "NOT_APPLICABLE" ? "VERIFIED" : answer === "UNKNOWN" ? "EVIDENCE_PENDING" : "OPEN_REPAIR", overrides = {}) {
  const base = {
    question_id: question.question_id,
    answer,
    lifecycle,
    applicable: answer !== "NOT_APPLICABLE",
    applicability_evidence: [evidence(`${question.question_id}:APPLICABLE`)],
    evaluated_at_utc: NOW,
    evaluation_binding: binding(),
  };
  if (answer === "YES") base.evidence = [evidence(question.required_evidence[0])];
  if (answer === "NO") base.evidence = [evidence(question.required_evidence[0])];
  if (answer === "UNKNOWN") base.missing_evidence = [`${question.question_id}:MISSING`];
  return {...base, ...overrides};
}

const allYes = tree.questions.map((question) => observation(question));
const ready = compileAcceptance(tree, allYes);
assert.equal(ready.RC_READY, true);
assert.deepEqual(ready.roots, {FUNCTION_REQUIREMENTS: "PASS", DESIGN_BIBLE: "PASS", SECURITY: "PASS"});
assert(ready.question_states.every((state) => state.answer === "YES" && state.lifecycle === "VERIFIED"));

const mismatchedEvidence = observation(tree.questions[0], "YES");
mismatchedEvidence.evidence[0].commit_sha = "commit-002";
assert.throws(() => evaluateQuestion(tree.questions[0], mismatchedEvidence), /result evidence.commit_sha does not match evaluation binding/u);

const mismatchedApplicability = observation(tree.questions[0], "YES");
mismatchedApplicability.applicability_evidence[0].environment_id = "ENV-002";
assert.throws(() => evaluateQuestion(tree.questions[0], mismatchedApplicability), /applicability evidence.environment_id does not match evaluation binding/u);

const bridged = compileProductAcceptanceProof({
  tree,
  observations: allYes,
  evidence_cache: [],
  auditor_session_id: "AUDITOR-001",
  evaluated_at_utc: NOW,
  critical_freezes: [],
});
assert.equal(bridged.product_acceptance.rc_ready, true);
assert.equal(bridged.product_acceptance.acceptance_receipt_sha256.length, 64);
verifyProductAcceptanceProof(bridged.product_acceptance, bridged.proof, "CAMPAIGN-001");

const notApplicable = observation(tree.questions[1], "NOT_APPLICABLE", "VERIFIED", {
  applicable: false,
  evidence: undefined,
});
delete notApplicable.evidence;
assert.equal(evaluateQuestion(tree.questions[1], notApplicable).action, "PRESERVE_APPLICABILITY_PROOF");

const unknown = observation(tree.questions[2], "UNKNOWN");
const unknownAcceptance = compileAcceptance(tree, [allYes[0], allYes[1], unknown]);
assert.equal(unknownAcceptance.roots.SECURITY, "UNKNOWN");
assert.equal(unknownAcceptance.RC_READY, false);

const no = observation(tree.questions[0], "NO");
const noAcceptance = compileAcceptance(tree, [no, allYes[1], allYes[2]]);
assert.equal(noAcceptance.roots.FUNCTION_REQUIREMENTS, "OPEN_REPAIR");
assert.equal(noAcceptance.roots.DESIGN_BIBLE, "UNKNOWN");
assert.equal(noAcceptance.roots.SECURITY, "UNKNOWN");
assert.equal(compileRepairPacket(tree, [no]).length, 1);
const repair = {...no, causal_root_id: "ROOT-001", implementation_route_id: "ROUTE-001", evidence_state_sha256: DIGEST};
assert.equal(compileRepairDecision(tree, repair, []).action, "TARGETED_REPAIR");
assert.equal(compileRepairDecision(tree, repair, [{question_id: repair.question_id, causal_root_id: "ROOT-001", implementation_route_id: "ROUTE-001", evidence_state_sha256: DIGEST}]).action, "DIRECT_SUPERVISOR_ONE_REFRAME_NO_EQUIVALENT_RETRY");
assert.equal(compileRepairDecision(tree, {...repair, implementation_route_id: "ROUTE-002", evidence_state_sha256: "b".repeat(64)}, [{question_id: repair.question_id, causal_root_id: "ROOT-001", implementation_route_id: "ROUTE-001", evidence_state_sha256: DIGEST}]).action, "EXECUTE_MATERIALLY_DIFFERENT_REPAIR");

const authorizedException = observation(tree.questions[0], "EXCEPTION_REQUESTED", "VERIFIED", {
  authorized_exception: {
    granting_authority: "OWNER",
    scope: "FR-ENTRY-001:SCOPE",
    rationale: "bounded compatibility",
    compensating_control: "feature remains disabled outside the admitted scope",
    expires_at_utc: "2026-08-04T00:00:00.000Z",
    reevaluation_trigger: "next campaign",
    commit_sha: "commit-001",
    build_identity: "BUILD-001",
    environment_id: "ENV-001",
    authorization_sha256: DIGEST,
  },
});
assert.equal(evaluateQuestion(tree.questions[0], authorizedException).action, "PASS_WITH_SCOPED_EXCEPTION");

const evidenceCache = tree.questions.map((question, index) => ({
  question_id: question.question_id,
  answer: "YES",
  lifecycle: "VERIFIED",
  result_sha256: String(index + 1).repeat(64),
  relevant_hashes: [DIGEST],
  question_tree_version: "2.1rc",
  reuse_scope: index === 0 ? "SOURCE_STABLE" : "BUILD_ENVIRONMENT_BOUND",
  build_identity: "BUILD-001",
  environment_id: "ENV-001",
}));
const evidencePlan = compileEvidencePlan(tree, evidenceCache, {
  invalidated_question_ids: ["DB-SURFACE-001"],
  question_relevant_hashes: Object.fromEntries(tree.questions.map((question) => [question.question_id, [DIGEST]])),
  build_identity: "BUILD-002",
  environment_id: "ENV-001",
});
assert.deepEqual(evidencePlan.reused_question_ids, ["FR-ENTRY-001"]);
assert.deepEqual(evidencePlan.acquire_question_ids, ["DB-SURFACE-001", "SEC-ACCESS-001"]);
const invalidated = invalidateQuestions(tree, allYes.map((result) => ({question_id: result.question_id, answer: result.answer, lifecycle: result.lifecycle})), {change_id: "CHANGE-001", conditions: ["DB-SURFACE-001:CHANGE"]});
assert.equal(invalidated.find((result) => result.question_id === "DB-SURFACE-001").lifecycle, "INVALIDATED");
assert.equal(invalidated.find((result) => result.question_id === "FR-ENTRY-001").lifecycle, "VERIFIED");
const policyInvalidated = invalidateQuestionsFromPolicyAmendment(tree, allYes.map((result) => ({question_id: result.question_id, answer: result.answer, lifecycle: result.lifecycle})), {
  amendment_id: "AMENDMENT-001",
  amendment_sha256: DIGEST,
  invalidated_question_ids: ["DB-SURFACE-001"],
});
assert.equal(policyInvalidated.find((result) => result.question_id === "DB-SURFACE-001").invalidated_by, "AMENDMENT-001");

const freeze = compileCriticalFreeze({
  schema: "governance.critical_surface_finding.v1",
  domain: "SECURITY",
  severity: "CRITICAL",
  finding_id: "SEC-CRITICAL-001",
  evidence_sha256: DIGEST,
  auditor_session_id: "AUDITOR-001",
  auditor_roster_receipt_sha256: DIGEST,
  affected_surfaces: ["AUTH"],
  global_impact: false,
});
assert.equal(freeze.action, "FREEZE_AFFECTED_SURFACES_ONLY");
assert.equal(freeze.continue_unaffected_work, true);

let hostile = 0;
function rejects(label, operation) {
  assert.throws(operation, undefined, label);
  hostile += 1;
}
rejects("old disposition cannot answer a question", () => evaluateQuestion(tree.questions[0], {...allYes[0], answer: undefined, disposition: "YES_WITH_EVIDENCE"}));
rejects("unknown lifecycle cannot claim YES", () => evaluateQuestion(tree.questions[0], {...allYes[0], lifecycle: "EVIDENCE_PENDING"}));
rejects("missing evidence cannot pass", () => evaluateQuestion(tree.questions[0], {...allYes[0], evidence: []}));
rejects("N/A needs proof", () => evaluateQuestion(tree.questions[1], {...notApplicable, applicability_evidence: []}));
rejects("unauthorized exception cannot pass", () => evaluateQuestion(tree.questions[0], {...authorizedException, authorized_exception: undefined}));
rejects("invalidated answer needs cause", () => evaluateQuestion(tree.questions[0], {...allYes[0], lifecycle: "INVALIDATED"}));
rejects("wrong root order", () => compileAcceptance(tree, [allYes[0], allYes[1], {...allYes[2], lifecycle: "INVALIDATED"}]));
rejects("duplicate evidence cache", () => compileEvidencePlan(tree, [evidenceCache[0], evidenceCache[0]], {
  invalidated_question_ids: [],
  question_relevant_hashes: Object.fromEntries(tree.questions.map((question) => [question.question_id, [DIGEST]])),
  build_identity: "BUILD-001",
  environment_id: "ENV-001",
}));
rejects("cross-root parent", () => validateQuestionTree({...tree, questions: tree.questions.map((question, index) => index === 1 ? {...question, parent_question_id: tree.questions[0].question_id} : question)}));
rejects("old root status vocabulary", () => {
  const result = compileAcceptance(tree, allYes);
  assert(!Object.values(result.roots).some((value) => ["BLOCKED", "PENDING_ADMISSION"].includes(value)));
  throw new Error("sentinel");
});
rejects("tampered acceptance receipt", () => verifyProductAcceptanceProof({
  ...bridged.product_acceptance,
  acceptance_receipt_sha256: "b".repeat(64),
}, bridged.proof, "CAMPAIGN-001"));
rejects("tampered Auditor attestation", () => verifyProductAcceptanceProof(
  bridged.product_acceptance,
  {...bridged.proof, auditor_attestation: {...bridged.proof.auditor_attestation, auditor_session_id: "AUDITOR-002"}},
  "CAMPAIGN-001",
));
rejects("policy amendment invalidates an unknown question", () => invalidateQuestionsFromPolicyAmendment(tree, allYes, {
  amendment_id: "AMENDMENT-UNKNOWN",
  amendment_sha256: DIGEST,
  invalidated_question_ids: ["FR-NOT-IN-TREE"],
}));
rejects("policy amendment without a digest", () => invalidateQuestionsFromPolicyAmendment(tree, allYes, {
  amendment_id: "AMENDMENT-NO-DIGEST",
  invalidated_question_ids: [],
}));
rejects("invalidation result from outside the tree", () => invalidateQuestionsFromPolicyAmendment(tree, [{question_id: "FR-OUTSIDE", answer: "YES", lifecycle: "VERIFIED"}], {
  amendment_id: "AMENDMENT-OUTSIDE-RESULT",
  amendment_sha256: DIGEST,
  invalidated_question_ids: [],
}));

console.log(`PASS Governance 2.1rc question tree (${hostile} hostile cases)`);
