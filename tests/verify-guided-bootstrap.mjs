#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  PLAN_APPROVAL,
  approveBootstrapPlan,
  auditBootstrapSetup,
  compileBootstrapPlan,
  createBootstrapExecution,
  executeBootstrapPlan,
  planBootstrapQuestions,
  promoteBootstrapExecution,
  validateBootstrapPlan,
} from "../control/bootstrap-compiler.mjs";
import {discoverProject} from "../control/bootstrap-discovery.mjs";
import * as guided from "../control/guided-bootstrap.mjs";

const DIGEST = "a".repeat(64);
const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-guided-"));
const source = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-legacy-"));
fs.writeFileSync(path.join(source, "legacy.md"), "legacy authority\n");

const answers = {
  "bootstrap.discovery.mode": "RECOMMENDED",
  "project.north_star": {users: ["operator"], moment: "complete the first workflow", outcome: "a truthful result"},
  "project.first_workflow": {name: "synthetic workflow", done_when: ["result is visible", "state is retained"]},
  "project.boundary": {project_name: "Synthetic Project", repositories: [], branches: []},
  "project.protected_boundaries": {owner_only: ["unapproved spending", "destructive changes"]},
  "authority-corpus.source": {operation: "CREATE_NEW"},
  "project.technical_constraints": {testing: "deterministic", deployment: "not yet configured"},
  "project.model_economics": {profile: "ECO_CONTINUOUS", completion_floor: 0.8, market_snapshot_sha256: DIGEST},
  "project.runtime": {session_id: "RUNTIME-001", environment_identity: "ENV-001", capabilities: ["persistent-navigation"]},
  "security.baseline": {standard_identity: "PROJECT_SECURITY_STANDARD", version: "1", clauses: ["SEC-001"]},
  "project.first_campaign": {features: []},
};

const questions = planBootstrapQuestions({discovery: [], answers: {}});
assert.equal(questions.status, "QUESTION_PENDING");
assert(questions.question_budget.recommended_maximum <= 9);
const discovery = discoverProject(root, "RECOMMENDED").facts;
const plan = compileBootstrapPlan({discovery, answers, projectRoot: root});
validateBootstrapPlan(plan);
for (const group of [
  "project_definition", "north_star", "proving_workflow", "technical_baseline",
  "design_bible", "security_baseline", "authority_boundaries", "authority_corpus",
  "model_policy", "persistent_runtime", "first_campaign", "exact_creation_plan",
]) assert(Object.hasOwn(plan, group), `missing compiled group ${group}`);
assert.equal(plan.persistent_runtime.persistent, true);
assert.equal(plan.persistent_runtime.never_despawn_between_campaigns, true);
assert.equal(plan.security_baseline.standard_identity, "PROJECT_SECURITY_STANDARD");
assert.equal(plan.authority_corpus.numbering.feature_block_size, 100);

assert.throws(() => approveBootstrapPlan(plan, {
  decision: "PROCEED",
  planSha256: plan.plan_sha256,
  discoveryDigestSha256: plan.discovery_digest_sha256,
  actor: "owner",
  approvedAtUtc: "2026-08-03T00:00:00.000Z",
}));
const approved = approveBootstrapPlan(plan, {
  decision: PLAN_APPROVAL,
  planSha256: plan.plan_sha256,
  discoveryDigestSha256: plan.discovery_digest_sha256,
  actor: "OWNER-001",
  approvedAtUtc: "2026-08-03T00:00:00.000Z",
});
assert.equal(approved.status, "APPROVED_EXACT_DIGEST");
assert.equal(approved.approval_receipt.plan_sha256, plan.plan_sha256);
assert.notEqual(approved.plan_sha256, plan.plan_sha256, "approval must create a new content-addressed plan identity");

const execution = createBootstrapExecution(approved, {
  bootstrapSessionId: "BOOTSTRAP-001",
  projectRoot: root,
  nowUtc: "2026-08-03T00:01:00.000Z",
});
const result = executeBootstrapPlan(approved, {
  bootstrapSessionId: "BOOTSTRAP-001",
  projectRoot: root,
  workflow: null,
  nowUtc: "2026-08-03T00:02:00.000Z",
});
assert.equal(result.state.phase, "SEALED");
assert(fs.existsSync(path.join(result.staging_root, "bootstrap.plan.json")));
const setupAudit = auditBootstrapSetup({
  plan: approved,
  executionState: result.state,
  auditorSessionId: "AUDITOR-001",
  bootstrapSessionId: "BOOTSTRAP-001",
  stagingRoot: result.staging_root,
});
assert.equal(setupAudit.status, "PASS");
const promoted = promoteBootstrapExecution({plan: approved, executionState: result.state, setupAudit, projectRoot: root, nowUtc: "2026-08-03T00:03:00.000Z"});
assert.equal(promoted.state.phase, "PROMOTED");
assert.equal(promoteBootstrapExecution({plan: approved, executionState: promoted.state, setupAudit, projectRoot: root, nowUtc: "2026-08-03T00:04:00.000Z"}).resumed, true);
assert.throws(() => auditBootstrapSetup({
  plan: approved,
  executionState: result.state,
  auditorSessionId: "BOOTSTRAP-001",
  bootstrapSessionId: "BOOTSTRAP-001",
  stagingRoot: result.staging_root,
}), /independent/);
assert.equal(execution.phase, "APPROVED");

const importedPlan = compileBootstrapPlan({
  discovery: discoverProject(root, "RECOMMENDED").facts,
  answers: {...answers, "authority-corpus.source": {operation: "IMPORT", source_root: source}},
  projectRoot: root,
});
const importedApproved = approveBootstrapPlan(importedPlan, {
  decision: PLAN_APPROVAL,
  planSha256: importedPlan.plan_sha256,
  discoveryDigestSha256: importedPlan.discovery_digest_sha256,
  actor: "OWNER-001",
  approvedAtUtc: "2026-08-03T00:03:00.000Z",
});
const imported = executeBootstrapPlan(importedApproved, {
  bootstrapSessionId: "BOOTSTRAP-002",
  projectRoot: root,
  legacySourceRoot: source,
  workflow: null,
  nowUtc: "2026-08-03T00:04:00.000Z",
});
assert.equal(imported.state.phase, "SEALED");
assert(imported.state.legacy_receipt_sha256);
assert(fs.existsSync(path.join(imported.staging_root, importedApproved.authority_corpus.roots.authority_root, "legacy.zip")));

assert.equal("allocatePortableFeatureExtension" in guided, false);
assert.equal(guided.compileBootstrapPlan, compileBootstrapPlan);
assert.equal(guided.planBootstrapQuestions, planBootstrapQuestions);

console.log("PASS AgentOS guided Bootstrap compatibility routes to exact-plan compiler (approval, transaction, independent setup audit, and legacy gate)");
