#!/usr/bin/env node

import assert from "node:assert/strict";
import {evaluateThinWorkflow, THIN_WORKFLOW_OUTCOMES} from "../../control/rapid-prototype/functionality.mjs";

const SOURCE = Object.freeze({
  project_id: "synthetic-project",
  project_root: "PROJECT_ROOT",
  cwd: "PROJECT_ROOT",
  git_common_directory: "GIT_COMMON_DIRECTORY",
  source_commit: "a".repeat(40),
  source_tree: "b".repeat(40),
});

const baseContext = () => ({
  source_readback: {...SOURCE, verified: true},
  expected_source: {...SOURCE},
  required_capabilities: ["local_check"],
  capabilities: ["local_check"],
});

const baseRoleAdmission = () => ({
  admitted: true,
  role: "IMPLEMENTATION_FUNCTIONALITY",
  session_id: "synthetic-session",
  identity_verified: true,
  topology: "INDEPENDENT_SIBLING_SESSION",
});

const baseProgress = () => ({
  status: "COMPLETED",
  meaningful: true,
  checkpoint: "synthetic-checkpoint",
});

const baseDecision = () => ({
  status: "READY",
  check: {status: "PASS"},
  independent_check: {status: "PENDING"},
});

function packet({intent = {}, context = baseContext(), roleAdmission = baseRoleAdmission(), progress = baseProgress(), decision = baseDecision()} = {}) {
  return {
    intent: {
      goal: "complete the first useful workflow",
      scope: {in: ["thin local path"], out: ["external actions"]},
      ...intent,
    },
    context,
    roleAdmission,
    progress,
    decision,
  };
}

const happyInput = packet();
const happy = evaluateThinWorkflow(happyInput);
const repeat = evaluateThinWorkflow(packet());
assert.equal(happy.outcome, THIN_WORKFLOW_OUTCOMES.READY);
assert.equal(happy.outcome_code, "READY");
assert.equal(happy.success, true);
assert.equal(happy.accepted, false, "ready is not self-acceptance");
assert.equal(happy.acceptance.root, "FUNCTION_REQUIREMENTS");
assert.equal(happy.acceptance.status, "READY_FOR_INDEPENDENT_CLEARANCE");
assert.deepEqual(happy, repeat, "identical inputs produce a stable result");
assert.deepEqual(
  evaluateThinWorkflow(happyInput.intent, happyInput.context, happyInput.roleAdmission, happyInput.progress, happyInput.decision),
  happy,
  "positional and packet forms share one deterministic path",
);

const identityMismatch = evaluateThinWorkflow(packet({
  context: {
    ...baseContext(),
    source_readback: {...SOURCE, project_id: "different-project", verified: true},
  },
}));
assert.equal(identityMismatch.outcome, THIN_WORKFLOW_OUTCOMES.HARD_STOP);
assert.equal(identityMismatch.reason_code, "SOURCE_BINDING_MISMATCH");
assert.equal(identityMismatch.success, false);

const missingIdentity = evaluateThinWorkflow(packet({
  context: {required_capabilities: ["local_check"], capabilities: ["local_check"]},
}));
assert.equal(missingIdentity.outcome, THIN_WORKFLOW_OUTCOMES.UNAVAILABLE);
assert.equal(missingIdentity.reason_code, "IDENTITY_MISSING");
assert.equal(missingIdentity.success, false);

const timeout = evaluateThinWorkflow(packet({
  progress: {status: "TIMEOUT_NO_RESULT", meaningful: false},
}));
assert.equal(timeout.outcome, THIN_WORKFLOW_OUTCOMES.UNAVAILABLE);
assert.equal(timeout.reason_code, "TIMEOUT_NO_RESULT");
assert.equal(timeout.success, false);

const unavailable = evaluateThinWorkflow(packet({
  context: {...baseContext(), capabilities: []},
}));
assert.equal(unavailable.outcome, THIN_WORKFLOW_OUTCOMES.UNAVAILABLE);
assert.equal(unavailable.reason_code, "CAPABILITY_UNAVAILABLE");
assert.equal(unavailable.success, false);

const changedScope = evaluateThinWorkflow(packet({
  intent: {scope_changed: true},
  context: {...baseContext(), capabilities: []},
}));
assert.equal(changedScope.outcome, THIN_WORKFLOW_OUTCOMES.HARD_STOP, "a hard boundary outranks an unavailable capability");
assert.equal(changedScope.reason_code, "CHANGED_SCOPE");
assert.equal(changedScope.success, false);

const question = evaluateThinWorkflow(packet({decision: {status: "QUESTION"}}));
assert.equal(question.outcome, THIN_WORKFLOW_OUTCOMES.QUESTION);
assert.equal(question.reason_code, "OWNER_INPUT_REQUIRED");

const puzzle = evaluateThinWorkflow(packet({decision: {status: "PUZZLE"}}));
assert.equal(puzzle.outcome, THIN_WORKFLOW_OUTCOMES.PUZZLE);
assert.equal(puzzle.reason_code, "BOUNDED_FAILURE");

const softReview = evaluateThinWorkflow(packet({decision: {status: "SOFT_REVIEW"}}));
assert.equal(softReview.outcome, THIN_WORKFLOW_OUTCOMES.SOFT_REVIEW);
assert.equal(softReview.reason_code, "NON_PROTECTED_CHANGE");

const missingProgress = evaluateThinWorkflow(packet({progress: null}));
assert.equal(missingProgress.outcome, THIN_WORKFLOW_OUTCOMES.UNAVAILABLE);
assert.equal(missingProgress.reason_code, "PROGRESS_MISSING");
assert.equal(missingProgress.success, false);

console.log("PASS thin functionality decision path: deterministic ready/question/puzzle/soft-review/unavailable/hard-stop routing with identity, timeout, capability, progress, and changed-scope hostile cases");
