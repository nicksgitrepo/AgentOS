#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  ARCHITECTURE_ACCEPTANCE_REQUIREMENTS,
  assertUniversalDevelopmentMode,
  compileGeneralGovernanceLibrary,
  compileGovernanceArchitecturePlan,
  defaultGeneralGovernanceClauses,
  validateGeneralGovernanceLibrary,
  validateGovernanceArchitecturePlan,
} from "../control/governance-library.mjs";
import {TASK_GATE_CATALOG_SHA256, TASK_GATE_QUESTIONS} from "../control/task-gate-questions.mjs";

const SOURCE_COMMIT = "commit-architecture-repair";
const SOURCE_TREE = "tree-architecture-repair";
const PLAN_DIGEST = "a".repeat(64);

const general = compileGeneralGovernanceLibrary({
  sourceCommit: SOURCE_COMMIT,
  sourceTree: SOURCE_TREE,
  bootstrapPlanSha256: PLAN_DIGEST,
});
validateGeneralGovernanceLibrary(general);
assert.equal(general.library_kind, "SHARED_GENERAL_GOVERNANCE");
assert.equal(general.task_gate_catalog_sha256, TASK_GATE_CATALOG_SHA256);
assert.equal(general.universal_closeout.receipt_schema, "agentos.universal_task_closeout_receipts.v1");
assert.equal(general.universal_closeout.receipt_compiler, "compileUniversalTaskCloseoutReceipts");
assert.equal(general.universal_closeout.receipt_authorities.ARCHIVE_VISIBLE_TASK, "HOST_READBACK");
assert.equal(general.universal_closeout.archive_is_dynamic, true);
assert.equal(general.universal_closeout.archive_requires_chat_out_of_scope, true);
assert.equal(general.universal_closeout.archive_requires_active_scope_removal, true);
assert.equal(general.universal_closeout.archive_requires_stale_worktree_closed, true);
assert.deepEqual(general.universal_closeout.mode, "ALL_DEVELOPMENT_MODES");
assert.deepEqual(general.universal_closeout.applies_to, [
  "APPRENTICESHIP",
  "BOOTSTRAP",
  "CAMPAIGN",
  "CASCADE",
  "ITERATION",
  "IMPORT",
  "RAPID_PROTOTYPE",
  "RAPID_PROTOTYPING",
  "ALL_DEVELOPMENT_MODES",
]);
assert.deepEqual(general.universal_closeout.archive_preconditions, [
  "HANDOFF_PRESERVED",
  "HANDOFF_PERSISTED",
  "CANDIDATE_INDEPENDENTLY_AUDITED",
  "WORKTREE_INTEGRATED",
  "STALE_WORKTREE_CLOSED",
  "ACTIVE_TASK_SCOPE_REMOVED",
  "CHAT_OUT_OF_SCOPE",
]);
assert.deepEqual(general.universal_closeout.sequence, [
  "PRESERVE_HANDOFF",
  "PERSIST_HANDOFF",
  "AUDIT_CANDIDATE",
  "INTEGRATE_ACCEPTED_WORK",
  "UNPIN_SESSION",
  "CLOSE_STALE_WORKTREE",
  "REMOVE_ACTIVE_TASK_SCOPE",
  "MARK_CHAT_OUT_OF_SCOPE",
  "ARCHIVE_VISIBLE_TASK",
]);
assert.equal(general.response_handoff_gating.controller, "control/universal-response-gating.mjs");
assert.equal(general.response_handoff_gating.contract, "schemas/universal-response-handoff.v1.json");
assert.deepEqual(general.response_handoff_gating.applies_to_modes, ["APPRENTICESHIP", "BOOTSTRAP", "CAMPAIGN", "CASCADE", "ITERATION", "IMPORT", "RAPID_PROTOTYPE", "RAPID_PROTOTYPING", "ALL_DEVELOPMENT_MODES"]);
assert.deepEqual(general.response_handoff_gating.applies_to, ["DOCUMENTATION", "HANDOFF", "PROGRESS", "RESPONSE", "CLOSURE"]);
assert.deepEqual(general.response_handoff_gating.complete_requires, ["CATALOG_GRAPH_COMPLETE", "INDEPENDENT_CHECK_PASS", "PRESERVED_TYPED_HANDOFF"]);
assert.equal(general.response_handoff_gating.unknown_behavior, "NEVER_PASSES");
assert.equal(general.response_handoff_gating.not_applicable_behavior, "REQUIRES_APPLICABILITY_JUSTIFICATION");
for (const mode of general.universal_closeout.applies_to.slice(0, -1)) {
  const policy = assertUniversalDevelopmentMode(mode);
  assert.equal(policy.mode, mode);
  assert.equal(policy.closeout.mode, mode);
  assert.deepEqual(policy.response_handoff_gating.applies_to, ["DOCUMENTATION", "HANDOFF", "PROGRESS", "RESPONSE", "CLOSURE"]);
}
assert.throws(() => assertUniversalDevelopmentMode("ALL_DEVELOPMENT_MODES"), /universal development mode is invalid/u);
assert.throws(() => assertUniversalDevelopmentMode("CAMPAIGN", ["INVALID_CONTEXT"]), /universal response-gating context is invalid/u);
assert(general.clauses.every((clause) => clause.gate_question_ids.every((questionId) => TASK_GATE_QUESTIONS.some((question) => question.question_id === questionId))));
assert.equal(general.clauses.length, 11);
assert.deepEqual(general.required_domains, [
  "INTENT_SCOPE",
  "SOURCE_BINDING",
  "CONVERSATION",
  "ROLE_ROUTING",
  "PROGRESS_HEALTH",
  "FUNCTIONAL_ACCEPTANCE",
  "EVIDENCE_IDENTITY",
  "RESPONSE_HANDOFF_GATING",
  "SECURITY_PRIVACY",
  "RECOVERY_BOUNDARIES",
  "DELIVERY_CLOSURE",
]);

const architecturePlan = compileGovernanceArchitecturePlan();
validateGovernanceArchitecturePlan(architecturePlan);
assert.deepEqual(architecturePlan.acceptance_requirements, ARCHITECTURE_ACCEPTANCE_REQUIREMENTS);
assert.equal(architecturePlan.shared_general_library_required, true);
assert.equal(architecturePlan.generated_role_specific_library_required, true);

const tampered = structuredClone(general);
tampered.clauses[0].rule = "Bind a private project path.";
assert.throws(() => validateGeneralGovernanceLibrary(tampered), /digest mismatch|private or provider-bound/u);

const incomplete = defaultGeneralGovernanceClauses().slice(1);
assert.throws(() => compileGeneralGovernanceLibrary({
  sourceCommit: SOURCE_COMMIT,
  sourceTree: SOURCE_TREE,
  bootstrapPlanSha256: PLAN_DIGEST,
  clauses: incomplete,
}), /incomplete|domain/u);

process.stdout.write("PASS governance library\n");
