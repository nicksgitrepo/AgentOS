#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import {
  BOOTSTRAP_OUTPUT_DEFINITIONS,
  BOOTSTRAP_REQUIRED_OUTPUT_GROUPS,
  compileBootstrapCoverage,
  validateBootstrapCoverage,
} from "../control/bootstrap-coverage.mjs";
import {planBootstrapQuestions} from "../control/bootstrap-compiler.mjs";

const contract = JSON.parse(fs.readFileSync(new URL("../schemas/bootstrap-coverage.v1.json", import.meta.url), "utf8"));
assert.deepEqual(
  contract.coverage_outputs.map((entry) => ({output_id: entry.output_id, category: entry.category, question_ids: entry.question_ids, applicability: entry.applicability ?? "REQUIRED"})),
  BOOTSTRAP_OUTPUT_DEFINITIONS.map((entry) => ({output_id: entry.output_id, category: entry.category, question_ids: [...entry.question_ids], applicability: entry.applicability})),
  "machine coverage contract and executable output registry diverged",
);

const completeAnswers = {
  "bootstrap.discovery.mode": "RECOMMENDED",
  "project.north_star": {user: "synthetic user", outcome: "complete the first useful workflow"},
  "project.first_workflow": {name: "synthetic workflow", success: "one accepted result"},
  "project.boundary": {project_name: "Synthetic Project", repositories: [], branches: []},
  "project.protected_boundaries": {owner_only: ["destructive production actions"]},
  "authority-corpus.source": {operation: "CREATE_NEW"},
  "project.technical_baseline": {testing: "deterministic"},
  "project.delivery_policy": {
    priority: "BALANCED",
    source_control: {push_mode: "CHECKPOINTS_REMOTE_EQUAL"},
    merge: {authority: "CENTRAL_SERIALIZED"},
    ci_runner: {route: "LOCAL", weekly_minutes_budget: 120},
    deployment: {route: "LOCAL", environment_ids: ["synthetic"], rollback_required: true, rollback_test: true},
  },
  "project.delivery_finish": "REVIEW",
  "project.model_economics": {profile: "ECO_CONTINUOUS", completion_floor: 0.8},
  "project.runtime": {session_id: "RUNTIME-001", environment_identity: "ENV-001", capabilities: ["filesystem"]},
};

const pending = compileBootstrapCoverage({discovery: [], answers: {}});
assert.equal(pending.status, "QUESTION_PENDING");
assert.equal(pending.output_count, BOOTSTRAP_OUTPUT_DEFINITIONS.length);
assert.deepEqual(pending.required_output_groups, BOOTSTRAP_REQUIRED_OUTPUT_GROUPS);
assert(pending.pending_question_ids.includes("project.runtime"));
assert(pending.pending_question_ids.includes("project.technical_baseline"));
assert(pending.outputs.some((row) => row.output_id === "SECURITY_BASELINE" && row.status === "DEFAULTED"));
assert(pending.outputs.some((row) => row.output_id === "DATA_AND_MIGRATION_POLICY" && row.status === "DEFERRED_NONBLOCKING"));
assert(pending.outputs.some((row) => row.output_id === "DESIGN_BIBLE" && row.status === "NOT_APPLICABLE_WITH_PROOF"));
validateBootstrapCoverage(pending);

const ready = compileBootstrapCoverage({discovery: [], answers: completeAnswers});
const repeated = compileBootstrapCoverage({discovery: [], answers: completeAnswers});
assert.equal(ready.status, "READY_TO_COMPILE");
assert.deepEqual(ready, repeated, "coverage output is not deterministic");
assert.equal(ready.outputs.find((row) => row.output_id === "FUNCTION_REQUIREMENTS").status, "DERIVED");
assert.equal(ready.outputs.find((row) => row.output_id === "FIRST_CAMPAIGN").status, "DEFAULTED");
assert.equal(ready.outputs.find((row) => row.output_id === "DEVELOPMENT_PLAN").status, "DEFAULTED");
assert.equal(ready.outputs.find((row) => row.output_id === "LEGACY_PRESERVATION").status, "NOT_APPLICABLE_WITH_PROOF");
assert.equal(ready.outputs.find((row) => row.output_id === "ACTIVATION_BOUNDARY").safe_default, "PREPARED_NOT_ACTIVATED");
validateBootstrapCoverage(ready);
const configured = compileBootstrapCoverage({discovery: [], answers: {...completeAnswers, "project.development_mode": "ITERATION"}});
assert.equal(configured.outputs.find((row) => row.output_id === "DEVELOPMENT_PLAN").status, "OWNER_CONFIRMED");
validateBootstrapCoverage(configured);

const questionPlan = planBootstrapQuestions({discovery: [], answers: {}});
assert.equal(questionPlan.status, "QUESTION_PENDING");
assert(questionPlan.questions.every((question) => question.coverage_output_ids.length > 0));
assert.equal(questionPlan.questions[0]?.id, questionPlan.next);
assert(questionPlan.coverage.pending_question_ids.includes("project.runtime"));
assert.equal(questionPlan.question_budget.presented, Math.min(questionPlan.question_budget.unresolved, 1));
assert(questionPlan.coverage_sha256 === questionPlan.coverage.coverage_sha256);

const missingRow = structuredClone(ready);
missingRow.outputs.pop();
delete missingRow.coverage_sha256;
missingRow.coverage_sha256 = "0".repeat(64);
assert.throws(() => validateBootstrapCoverage(missingRow), /outputs are invalid/u);

const falseReady = structuredClone(ready);
const runtimeRow = falseReady.outputs.find((row) => row.output_id === "PERSISTENT_RUNTIME");
runtimeRow.status = "OWNER_REQUIRED";
runtimeRow.blocking = false;
delete falseReady.coverage_sha256;
falseReady.coverage_sha256 = "0".repeat(64);
assert.throws(() => validateBootstrapCoverage(falseReady), /blocking flag does not match status/u);

const wrongMapping = structuredClone(ready);
wrongMapping.outputs[0].question_ids = [];
delete wrongMapping.coverage_sha256;
wrongMapping.coverage_sha256 = "0".repeat(64);
assert.throws(() => validateBootstrapCoverage(wrongMapping), /question mapping changed/u);

const incompleteImport = structuredClone(completeAnswers);
incompleteImport["authority-corpus.source"] = {operation: "IMPORT"};
const importCoverage = compileBootstrapCoverage({discovery: [], answers: incompleteImport});
assert.equal(importCoverage.status, "QUESTION_PENDING");
assert(importCoverage.material_gaps.some((gap) => gap.output_id === "AUTHORITY_CORPUS"));

console.log(`PASS AgentOS Bootstrap coverage compiler (${BOOTSTRAP_OUTPUT_DEFINITIONS.length} output rows, deterministic readiness, material-gap, mapping, and hostile coverage)`);
