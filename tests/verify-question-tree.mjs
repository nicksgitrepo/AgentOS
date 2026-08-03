import assert from "node:assert/strict";
import {
  BRANCHES,
  ROOTS,
  canonicalJson,
  compileAcceptance,
  compileQuestionTree,
  compileRepairPacket,
  compileRepairDecision,
  compileCriticalFreeze,
  compileEvidencePlan,
  evaluateQuestion,
  invalidateQuestions,
  sha256,
  validateQuestionTree,
} from "../control/question-tree.mjs";

const digest = "a".repeat(64);
const now = "2026-08-03T00:00:00Z";
const evidence = (kind) => ({
  evidence_id: `E-${kind}`,
  kind,
  sha256: digest,
  commit_sha: "commit-001",
  worktree_id: "root-001",
  build_identity: "build-001",
  environment_id: "test-001",
  observed_at_utc: now,
  question_tree_version: "2.1rc",
});
const question = (id, root, parent = null, condition = root.toLowerCase()) => ({
  question_id: id,
  root,
  parent_question_id: parent,
  source_authority: { authority_id: `${root}-AUTH`, version: "1", sha256: digest },
  applicability: { predicate_id: `${id}:APPLICABLE`, question: `Does ${id} apply to this change?` },
  question: `Does ${id} produce its exact observable result?`,
  required_evidence: [`${root}:PROOF`],
  allowed_answers: [
    "YES_WITH_EVIDENCE", "NO", "UNKNOWN", "NOT_APPLICABLE_WITH_PROOF",
    "EXCEPTION_REQUESTED", "AUTHORIZED_EXCEPTION", "BLOCKED_AUTHORITY_BOUNDARY",
  ],
  branches: BRANCHES,
  repair_owner_role: root === "DESIGN_BIBLE" ? "UI_UX" : root === "SECURITY" ? "SECURITY" : "FEATURE",
  invalidation_conditions: [condition],
  blocking_scope: `${id}:SCOPE`,
  exception_policy: {
    allowed: true,
    granting_authority_ids: ["OWNER"],
    scope: `${id}:SCOPE`,
  },
});
const tree = {
  schema: "governance.compiled_question_tree.v1",
  question_tree_version: "2.1rc",
  campaign_id: "campaign-001",
  roots: ROOTS,
  questions: [
    question("FR-ENTRY-001", "FUNCTION_REQUIREMENTS"),
    question("DB-SHELL-001", "DESIGN_BIBLE"),
    question("SEC-AUTH-001", "SECURITY"),
  ],
  selection: {
    schema: "governance.question_slice_selection.v1",
    changed_surfaces: ["UI", "BACKEND_API"],
    change_manifest_sha256: digest,
    selected_question_ids: ["FR-ENTRY-001", "DB-SHELL-001", "SEC-AUTH-001"],
    root_non_applicability: {
      FUNCTION_REQUIREMENTS: null,
      DESIGN_BIBLE: null,
      SECURITY: null,
    },
  },
};

validateQuestionTree(tree);
assert.equal(sha256(tree), sha256(JSON.parse(canonicalJson(tree))));

const sourceClause = (q, surfaces) => ({
  clause_id: `${q.question_id}:CLAUSE`,
  question_id: q.question_id,
  root: q.root,
  parent_question_id: q.parent_question_id,
  source_authority: structuredClone(q.source_authority),
  applicability: structuredClone(q.applicability),
  atomic_question: q.question,
  required_evidence: [...q.required_evidence],
  repair_owner_role: q.repair_owner_role,
  invalidation_conditions: [...q.invalidation_conditions],
  blocking_scope: q.blocking_scope,
  exception_policy: structuredClone(q.exception_policy),
  materiality: "MATERIAL_PRODUCT_ACCEPTANCE",
  applies_to_surfaces: surfaces,
});
const compiledSlice = compileQuestionTree({
  schema: "governance.question_tree_source_clauses.v1",
  campaign_id: "campaign-001",
  question_tree_version: "2.1rc",
  change_manifest: (() => {
    const body = {
      schema: "governance.changed_surface_manifest.v1",
      checkpoint_id: "checkpoint-001",
      originating_owner_role_id: "feature-x",
      root_id: "root-001",
      branch: "campaign/campaign-001",
      commit: "commit-001",
      tree: "tree-001",
      changed_paths: ["src/pages/settings.tsx"],
      changed_surfaces: ["UI"],
    };
    return {...body, manifest_sha256: sha256(body)};
  })(),
  clauses: [
    sourceClause(tree.questions[0], ["ALWAYS"]),
    sourceClause(tree.questions[1], ["UI"]),
    sourceClause(tree.questions[2], ["BACKEND_API"]),
  ],
});
assert.deepEqual(compiledSlice.questions.map((item) => item.question_id), ["FR-ENTRY-001", "DB-SHELL-001"]);
assert.match(compiledSlice.selection.root_non_applicability.SECURITY, /^[0-9a-f]{64}$/);

const yes = (q) => ({
  question_id: q.question_id,
  applicable: true,
  applicability_evidence: [evidence("APPLICABILITY")],
  disposition: "YES_WITH_EVIDENCE",
  evidence: [evidence(q.required_evidence[0])],
  evaluated_at_utc: now,
  evaluation_binding: {
    commit_sha: "commit-001",
    worktree_id: "root-001",
    relevant_hashes: [digest],
    build_identity: "build-001",
    environment_id: "test-001",
    question_tree_version: "2.1rc",
  },
});
assert.equal(compileAcceptance(compiledSlice, compiledSlice.questions.map(yes)).RC_READY, true);
const allYes = tree.questions.map(yes);
assert.equal(compileAcceptance(tree, allYes).RC_READY, true);
const evidenceCache = tree.questions.map((item, index) => ({
  question_id: item.question_id,
  disposition: "YES_WITH_EVIDENCE",
  result_sha256: String(index + 1).repeat(64),
  relevant_hashes: [digest],
  question_tree_version: "2.1rc",
  reuse_scope: index === 0 ? "SOURCE_STABLE" : "BUILD_ENVIRONMENT_BOUND",
  build_identity: "build-001",
  environment_id: "test-001",
}));
const evidencePlan = compileEvidencePlan(tree, evidenceCache, {
  invalidated_question_ids: ["DB-SHELL-001"],
  question_relevant_hashes: Object.fromEntries(tree.questions.map((item) => [item.question_id, [digest]])),
  build_identity: "build-002",
  environment_id: "test-001",
});
assert.deepEqual(evidencePlan.reused_question_ids, ["FR-ENTRY-001"]);
assert.deepEqual(evidencePlan.acquire_question_ids, ["DB-SHELL-001", "SEC-AUTH-001"]);

const securityUnknown = structuredClone(allYes);
securityUnknown[2].disposition = "UNKNOWN";
delete securityUnknown[2].evidence;
securityUnknown[2].missing_evidence = ["SECURITY:PROOF"];
const open = compileAcceptance(tree, securityUnknown);
assert.equal(open.roots.SECURITY, "OPEN_REPAIR");
assert.equal(open.RC_READY, false);

const functionNo = structuredClone(allYes);
functionNo[0].disposition = "NO";
const ordered = compileAcceptance(tree, functionNo);
assert.equal(ordered.roots.FUNCTION_REQUIREMENTS, "OPEN_REPAIR");
assert.equal(ordered.roots.DESIGN_BIBLE, "PENDING_ADMISSION");
assert.equal(ordered.roots.SECURITY, "PENDING_ADMISSION");
assert.equal(compileRepairPacket(tree, functionNo).length, 1);
functionNo[0].causal_root_id = "CAUSE-AUTH-SCOPE";
functionNo[0].implementation_route_id = "ROUTE-SERVER-FENCE";
functionNo[0].evidence_state_sha256 = digest;
const firstRepair = compileRepairDecision(tree, functionNo[0], []);
assert.equal(firstRepair.action, "TARGETED_REPAIR");
const priorRepair = {
  question_id: functionNo[0].question_id,
  causal_root_id: functionNo[0].causal_root_id,
  implementation_route_id: functionNo[0].implementation_route_id,
  evidence_state_sha256: digest,
};
assert.equal(
  compileRepairDecision(tree, functionNo[0], [priorRepair]).action,
  "DIRECT_SUPERVISOR_ONE_REFRAME_NO_EQUIVALENT_RETRY",
);
const newRoute = structuredClone(functionNo[0]);
newRoute.implementation_route_id = "ROUTE-BOUND-PROJECTION";
newRoute.evidence_state_sha256 = "b".repeat(64);
assert.equal(
  compileRepairDecision(tree, newRoute, [priorRepair]).action,
  "EXECUTE_MATERIALLY_DIFFERENT_REPAIR",
);

const notApplicable = {
  question_id: tree.questions[0].question_id,
  applicable: false,
  applicability_evidence: [evidence("APPLICABILITY")],
  disposition: "NOT_APPLICABLE_WITH_PROOF",
  evaluated_at_utc: now,
  evaluation_binding: structuredClone(allYes[0].evaluation_binding),
};
assert.equal(evaluateQuestion(tree.questions[0], notApplicable).action, "PRESERVE_PROOF");

const exception = structuredClone(allYes[0]);
exception.disposition = "AUTHORIZED_EXCEPTION";
delete exception.evidence;
exception.authorized_exception = {
  granting_authority: "OWNER",
  scope: "FR-ENTRY-001:SCOPE",
  rationale: "bounded compatibility",
  compensating_control: "feature disabled outside test",
  expires_at_utc: "2026-08-04T00:00:00Z",
  reevaluation_trigger: "next build",
  commit_sha: "commit-001",
  build_identity: "build-001",
  environment_id: "test-001",
  authorization_sha256: digest,
};
assert.equal(evaluateQuestion(tree.questions[0], exception).action, "PASS_WITH_SCOPED_EXCEPTION");

const blocked = structuredClone(allYes[0]);
blocked.disposition = "BLOCKED_AUTHORITY_BOUNDARY";
delete blocked.evidence;
blocked.owner_boundary_class = "HUMAN_AUTHENTICATION_OR_LEGAL_ACCEPTANCE";
blocked.authority_boundary_id = "AUTH-MFA-001";
blocked.blocker_evidence_sha256 = digest;
blocked.smallest_owner_action = "complete MFA";
blocked.attempted_safe_alternatives = ["existing session", "public device flow"];
blocked.unaffected_work = "all non-deployment checks";
assert.equal(evaluateQuestion(tree.questions[0], blocked).action, "PAUSE_AFFECTED_SCOPE_CONTINUE_UNRELATED");

const localFreeze = compileCriticalFreeze({
  schema: "governance.critical_surface_finding.v1",
  domain: "SECURITY",
  severity: "CRITICAL",
  finding_id: "SEC-CRITICAL-001",
  evidence_sha256: digest,
  auditor_session_id: "auditor-session-001",
  auditor_roster_receipt_sha256: digest,
  affected_surfaces: ["api/auth"],
  global_impact: false,
});
assert.equal(localFreeze.action, "FREEZE_AFFECTED_SURFACES_ONLY");
assert.equal(localFreeze.continue_unaffected_work, true);

const prior = allYes.map((item) => ({ question_id: item.question_id, disposition: item.disposition }));
const invalidated = invalidateQuestions(tree, prior, { change_id: "change-001", conditions: ["design_bible"] });
assert.equal(invalidated.find((item) => item.question_id === "DB-SHELL-001").disposition, "UNKNOWN");
assert.equal(invalidated.find((item) => item.question_id === "FR-ENTRY-001").disposition, "YES_WITH_EVIDENCE");

let hostileCount = 0;
function rejects(label, mutate, action = validateQuestionTree) {
  const candidate = structuredClone(tree);
  mutate(candidate);
  assert.throws(() => action(candidate), undefined, label);
  hostileCount += 1;
}

rejects("wrong roots", (x) => x.roots.reverse());
rejects("missing root proof", (x) => {
  x.questions = x.questions.filter((q) => q.root !== "SECURITY");
  x.selection.selected_question_ids = x.selection.selected_question_ids.filter((id) => !id.startsWith("SEC-"));
});
rejects("ceremonial inventory mismatch", (x) => x.selection.selected_question_ids.push("SEC-UNRELATED-999"));
rejects("active root claims non-applicability", (x) => { x.selection.root_non_applicability.SECURITY = digest; });
assert.throws(() => compileQuestionTree({
  schema: "governance.question_tree_source_clauses.v1",
  campaign_id: "campaign-001",
  question_tree_version: "2.1rc",
  change_manifest: {...compiledSlice.selection, schema: "governance.changed_surface_manifest.v1"},
  clauses: [sourceClause(tree.questions[0], ["ALWAYS"])],
}), /change manifest identity/);
hostileCount += 1;
const poisonedCache = structuredClone(evidenceCache);
poisonedCache[0].reuse_scope = "TRUST_ME";
assert.throws(() => compileEvidencePlan(tree, poisonedCache, {
  invalidated_question_ids: [],
  question_relevant_hashes: Object.fromEntries(tree.questions.map((item) => [item.question_id, [digest]])),
  build_identity: "build-002",
  environment_id: "test-001",
}), /reuse scope/);
hostileCount += 1;
rejects("duplicate question", (x) => x.questions.push(structuredClone(x.questions[0])));
rejects("cycle", (x) => { x.questions[0].parent_question_id = x.questions[0].question_id; });
rejects("cross-root parent", (x) => { x.questions[1].parent_question_id = x.questions[0].question_id; });
rejects("vague statement", (x) => { x.questions[0].question = "Search works"; });
rejects("missing source hash", (x) => { x.questions[0].source_authority.sha256 = "x"; });
rejects("missing evidence kinds", (x) => { x.questions[0].required_evidence = []; });
rejects("duplicate evidence kind", (x) => { x.questions[0].required_evidence.push(x.questions[0].required_evidence[0]); });
rejects("missing branch", (x) => { delete x.questions[0].branches.NO; });
rejects("swapped branch", (x) => { x.questions[0].branches.NO = BRANCHES.UNKNOWN; });
rejects("missing allowed disposition", (x) => { x.questions[0].allowed_answers.pop(); });
rejects("forbidden confidence", (x) => { x.questions[0].confidence = 0.9; });
rejects("forbidden score", (x) => { x.score = 100; });
rejects("forbidden weight", (x) => { x.questions[0].weight = 2; });
rejects("exception contradiction", (x) => { x.questions[0].exception_policy.allowed = false; });
rejects("root family mismatch", (x) => { x.questions[0].question_id = "DB-WRONG-001"; });

function rejectsObservation(label, observation) {
  assert.throws(() => evaluateQuestion(tree.questions[0], observation), undefined, label);
  hostileCount += 1;
}
const missingProof = structuredClone(allYes[0]);
missingProof.evidence = [];
rejectsObservation("YES without evidence", missingProof);
const fakeNa = structuredClone(notApplicable);
fakeNa.applicability_evidence = [];
rejectsObservation("N/A without proof", fakeNa);
const wrongNa = structuredClone(notApplicable);
wrongNa.disposition = "YES_WITH_EVIDENCE";
rejectsObservation("inapplicable YES", wrongNa);
const expired = structuredClone(exception);
expired.authorized_exception.expires_at_utc = "2026-07-01T00:00:00Z";
rejectsObservation("expired exception", expired);
const badException = structuredClone(exception);
badException.authorized_exception.authorization_sha256 = "x";
rejectsObservation("unbound exception", badException);
const noAlternatives = structuredClone(blocked);
noAlternatives.attempted_safe_alternatives = [];
rejectsObservation("owner blocker without safe attempts", noAlternatives);
const ordinaryAsOwner = structuredClone(blocked);
ordinaryAsOwner.owner_boundary_class = "FAILING_TEST";
rejectsObservation("ordinary repair called owner blocker", ordinaryAsOwner);
const oldEvidence = structuredClone(allYes[0]);
oldEvidence.evidence[0].question_tree_version = "2.0rc";
rejectsObservation("stale evidence version", oldEvidence);
const noWithoutEvidence = structuredClone(allYes[0]);
noWithoutEvidence.disposition = "NO";
delete noWithoutEvidence.evidence;
rejectsObservation("NO without observed evidence", noWithoutEvidence);
const unknownWithoutGap = structuredClone(allYes[0]);
unknownWithoutGap.disposition = "UNKNOWN";
delete unknownWithoutGap.evidence;
rejectsObservation("UNKNOWN without named missing evidence", unknownWithoutGap);
const unboundResult = structuredClone(allYes[0]);
delete unboundResult.evaluation_binding;
rejectsObservation("result lacks exact evaluation binding", unboundResult);
const wrongCommitException = structuredClone(exception);
wrongCommitException.authorized_exception.commit_sha = "commit-other";
rejectsObservation("exception applies to wrong commit", wrongCommitException);
const wrongAuthorityException = structuredClone(exception);
wrongAuthorityException.authorized_exception.granting_authority = "OTHER";
rejectsObservation("exception granted by unadmitted authority", wrongAuthorityException);
const requested = structuredClone(allYes[0]);
requested.disposition = "EXCEPTION_REQUESTED";
delete requested.evidence;
requested.exception_request = {
  granting_authority: "OWNER",
  scope: "wrong scope",
  rationale: "bounded request",
};
rejectsObservation("exception request scope mismatch", requested);
const parentTree = structuredClone(tree);
parentTree.questions.push(question("FR-CHILD-001", "FUNCTION_REQUIREMENTS", "FR-ENTRY-001"));
parentTree.selection.selected_question_ids.push("FR-CHILD-001");
const parentObservations = structuredClone(allYes);
parentObservations[0].disposition = "NO";
parentObservations.push(yes(parentTree.questions.at(-1)));
assert.throws(() => compileAcceptance(parentTree, parentObservations), /parent was not admitted/);
hostileCount += 1;
assert.throws(() => compileCriticalFreeze({
  schema: "governance.critical_surface_finding.v1",
  domain: "SECURITY",
  severity: "CRITICAL",
  finding_id: "SEC-CRITICAL-002",
  evidence_sha256: digest,
  auditor_session_id: "auditor-session-001",
  auditor_roster_receipt_sha256: digest,
  affected_surfaces: ["api/auth"],
  global_impact: true,
}), /global freeze requires/);
hostileCount += 1;
assert.throws(() => compileCriticalFreeze({
  schema: "governance.critical_surface_finding.v1",
  domain: "SECURITY",
  severity: "CRITICAL",
  finding_id: "SEC-CRITICAL-003",
  evidence_sha256: digest,
  affected_surfaces: ["api/auth"],
  global_impact: false,
}), /Auditor identity/);
hostileCount += 1;

assert.equal(hostileCount, 38);
console.log(`Governance 2.1rc question-tree PASS (${hostileCount} hostile cases)`);
