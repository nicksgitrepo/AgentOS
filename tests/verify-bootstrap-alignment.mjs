#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  BOOTSTRAP_QUESTIONS,
  PLAN_APPROVAL,
  approveBootstrapPlan,
  auditBootstrapSetup,
  compileBootstrapPlan,
  createBootstrapExecution,
  executeBootstrapPlan,
  promoteBootstrapExecution,
  planBootstrapQuestions,
  recommendModels,
  validateBootstrapPlan,
} from "../control/bootstrap-compiler.mjs";
import {
  canonicalDigest,
  runDeliveryProbes,
  validateDeliveryProbeResults,
} from "../control/delivery-policy.mjs";
import {discoverProject} from "../control/bootstrap-discovery.mjs";
import {verifyLegacyPreservation} from "../control/legacy-preservation.mjs";

const ISO = "2026-01-01T00:00:00.000Z";
const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-bootstrap-project-"));
const discovery = discoverProject(projectRoot, "RECOMMENDED").facts;
const answers = {
  "bootstrap.discovery.mode": "RECOMMENDED",
  "project.north_star": {user: "synthetic user", outcome: "complete the first useful workflow"},
  "project.first_workflow": {name: "synthetic workflow", success: "one accepted result"},
  "project.boundary": {project_name: "Synthetic Project", repositories: [{repository_id: "main", remote: "synthetic", default_branch: "main"}], branches: ["main"]},
  "project.protected_boundaries": {owner_only: ["destructive production actions"], protected: ["secrets", "accepted truth"]},
  "authority-corpus.source": {operation: "CREATE_NEW"},
  "project.design": {page_families: ["WORKFLOW"], templates: ["PRIMARY"], tokens: ["DEFAULT"], protected_surfaces: []},
  "project.technical_baseline": {testing: "deterministic"},
  "project.delivery_policy": {
    priority: "BALANCED",
    source_control: {push_mode: "CHECKPOINTS_REMOTE_EQUAL"},
    merge: {authority: "CENTRAL_SERIALIZED", gate: "REQUIRED_AFFECTED_CHECKS"},
    ci_runner: {route: "LOCAL", max_concurrency: 1, weekly_minutes_budget: 120},
    deployment: {route: "LOCAL", environment_ids: ["synthetic"], trigger: "EXACT_ACCEPTED_COMMIT", rollback_required: true, rollback_test: true},
    cost_boundaries: {weekly_runner_minutes: 120, monthly_spend_ceiling: 0, currency: "USD"},
  },
  "project.model_economics": {profile: "ECO", completion_floor: 0.8},
  "project.runtime": {session_id: "RUNTIME-1", environment_identity: "SYNTHETIC_ENV", capabilities: ["filesystem", "git"]},
};

const planned = planBootstrapQuestions({discovery});
assert.equal(planned.next, "bootstrap.discovery.mode");
assert.equal(planned.status, "QUESTION_PENDING");
assert(planned.questions.every((question) => question.discovered_facts !== undefined));
assert(BOOTSTRAP_QUESTIONS.some((question) => question.output === "NORTH_STAR"));
assert.equal(planBootstrapQuestions({discovery, answers}).status, "READY_TO_COMPILE");

const plan = compileBootstrapPlan({discovery, answers, projectRoot});
validateBootstrapPlan(plan);
assert.equal(plan.status, "AWAITING_EXACT_OWNER_APPROVAL");
assert.deepEqual(plan.question_slice, ["FUNCTION_REQUIREMENTS", "DESIGN_BIBLE", "SECURITY"]);
for (const group of ["project_definition", "north_star", "proving_workflow", "technical_baseline", "delivery_policy", "delivery_probe_plan", "design_bible", "security_baseline", "authority_boundaries", "authority_corpus", "model_policy", "persistent_runtime", "first_campaign", "exact_creation_plan"]) assert(plan[group] !== undefined, `missing compiled group ${group}`);
assert.equal(plan.authority_corpus.numbering.bootstrap, "000");
assert.equal(plan.authority_corpus.numbering.feature_block_size, 100);
assert.equal(plan.model_policy.work_slots, 20);
assert.equal(plan.persistent_runtime.never_despawn_between_campaigns, true);
assert.equal(plan.delivery_policy.source_control.push_mode, "CHECKPOINTS_REMOTE_EQUAL");
assert.equal(plan.delivery_policy.merge.authority, "CENTRAL_SERIALIZED");
assert.equal(plan.delivery_policy.deployment.trigger, "EXACT_ACCEPTED_COMMIT");
assert.equal(plan.delivery_probe_plan.policy_sha256, plan.delivery_policy.policy_sha256);
const legacyNamingAnswers = structuredClone(answers);
legacyNamingAnswers["project.technical_constraints"] = legacyNamingAnswers["project.technical_baseline"];
delete legacyNamingAnswers["project.technical_baseline"];
const legacyNamingPlan = compileBootstrapPlan({discovery, answers: legacyNamingAnswers, projectRoot});
assert.equal(legacyNamingPlan.plan_sha256, plan.plan_sha256, "legacy technical answer alias changed the canonical plan");

assert.throws(() => approveBootstrapPlan(plan, {decision: "PROCEED", planSha256: plan.plan_sha256, discoveryDigestSha256: plan.discovery_digest_sha256, actor: "OWNER", approvedAtUtc: ISO}));
const approved = approveBootstrapPlan(plan, {decision: PLAN_APPROVAL, planSha256: plan.plan_sha256, discoveryDigestSha256: plan.discovery_digest_sha256, actor: "OWNER", approvedAtUtc: ISO});
assert.equal(approved.status, "APPROVED_EXACT_DIGEST");
assert.notEqual(approved.plan_sha256, plan.plan_sha256);
assert.equal(approved.approval_receipt.plan_sha256, plan.plan_sha256);
assert.throws(() => approveBootstrapPlan(plan, {decision: PLAN_APPROVAL, planSha256: "b".repeat(64), discoveryDigestSha256: plan.discovery_digest_sha256, actor: "OWNER", approvedAtUtc: ISO}));

const modelRecommendation = recommendModels({
  role: "CAMPAIGN_FINALIZER",
  economics: {profile: "ECO", completion_floor: 0.8},
  requirements: {required_context_window: 100, minimum_reasoning: "HIGH", required_tools: ["shell"]},
  candidates: [
    {model: "too-weak", reasoning: "MEDIUM", spawnable: true, context_window: 128, tools: ["shell"], estimated_success_probability: 0.7, estimated_attempts: 1, relative_unit_cost: 1},
    {model: "reliable", reasoning: "HIGH", spawnable: true, context_window: 128, tools: ["shell"], estimated_success_probability: 0.9, estimated_attempts: 1.1, relative_unit_cost: 2},
  ],
});
assert.equal(modelRecommendation.recommended.model, "reliable");
assert(modelRecommendation.excluded.some((entry) => entry.reason === "BELOW_COMPLETION_FLOOR"));
const acceptedCostRecommendation = recommendModels({
  economics: {profile: "ECO", completion_floor: 0.8},
  candidates: [
    {model: "cheap-but-fragile", reasoning: "HIGH", spawnable: true, context_window: 128, estimated_success_probability: 0.8, estimated_attempts: 1, relative_unit_cost: 1},
    {model: "slightly-costlier-but-reliable", reasoning: "HIGH", spawnable: true, context_window: 128, estimated_success_probability: 0.95, estimated_attempts: 1, relative_unit_cost: 1.1},
  ],
});
assert.equal(acceptedCostRecommendation.recommended.model, "slightly-costlier-but-reliable");
assert(acceptedCostRecommendation.recommended.expected_completion_cost < 1.2);
assert.throws(() => recommendModels({economics: {profile: "ECO", completion_floor: 0.9}, candidates: [{model: "weak", reasoning: "LOW", spawnable: true, estimated_success_probability: 0.5, estimated_attempts: 1, relative_unit_cost: 1}]}));

const deliveryProbeResults = runDeliveryProbes({projectRoot, policy: plan.delivery_policy, discovery, planSha256: plan.plan_sha256});
validateDeliveryProbeResults(deliveryProbeResults, {planSha256: plan.plan_sha256, policySha256: plan.delivery_policy.policy_sha256, discoveryDigestSha256: plan.discovery_digest_sha256});
assert.equal(deliveryProbeResults.binding.plan_sha256, plan.plan_sha256);
assert.equal(deliveryProbeResults.operations.network_attempted, false);
assert(deliveryProbeResults.results.some((entry) => entry.status === "NOT_RUN_OWNER_BOUNDARY"));
assert.throws(() => runDeliveryProbes({projectRoot, policy: plan.delivery_policy, discovery, planSha256: "not-a-digest"}), /exact plan digest/u);
const wrongBoundDeliveryResults = structuredClone(deliveryProbeResults);
wrongBoundDeliveryResults.binding.plan_sha256 = "0".repeat(64);
delete wrongBoundDeliveryResults.result_sha256;
wrongBoundDeliveryResults.result_sha256 = canonicalDigest(wrongBoundDeliveryResults);
assert.throws(() => validateDeliveryProbeResults(wrongBoundDeliveryResults, {planSha256: plan.plan_sha256}), /different exact plan/u);
const tamperedDeliveryPolicy = structuredClone(plan.delivery_policy);
tamperedDeliveryPolicy.deployment.authority = "OWNER_DIRECT";
tamperedDeliveryPolicy.policy_sha256 = plan.delivery_policy.policy_sha256;
assert.throws(() => validateBootstrapPlan({...plan, delivery_policy: tamperedDeliveryPolicy}), /delivery policy deployment authority/u);

const observedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-bootstrap-discovery-"));
try {
  fs.writeFileSync(path.join(observedRoot, "package.json"), "{}\n");
  const observed = discoverProject(observedRoot, "RECOMMENDED");
  assert.equal(observed.operations.read_only, true);
  assert.equal(observed.operations.authentication_attempted, false);
  assert(observed.facts.every((fact) => fact.secret_free === true));
  assert.throws(() => discoverProject(observedRoot, "MANUAL"));
} finally {
  fs.rmSync(observedRoot, {recursive: true, force: true});
}

try {
  const workflow = JSON.parse(fs.readFileSync("schemas/capability-and-worktree-registry.v1.json", "utf8"));
  const resumable = createBootstrapExecution(approved, {bootstrapSessionId: "BOOTSTRAP-2", projectRoot, nowUtc: ISO});
  assert.equal(resumable.phase, "APPROVED");
  const execution = executeBootstrapPlan(approved, {bootstrapSessionId: "BOOTSTRAP-1", projectRoot, workflow, nowUtc: ISO});
  assert.equal(execution.state.phase, "SEALED");
  assert(fs.existsSync(path.join(execution.staging_root, "bootstrap.plan.json")));
  const stagedDeliveryProbeResults = JSON.parse(fs.readFileSync(path.join(execution.staging_root, "delivery.probe.results.json"), "utf8"));
  validateDeliveryProbeResults(stagedDeliveryProbeResults, {planSha256: approved.plan_sha256, policySha256: approved.delivery_policy.policy_sha256, discoveryDigestSha256: approved.discovery_digest_sha256});
  const audit = auditBootstrapSetup({plan: approved, executionState: execution.state, auditorSessionId: "SETUP-AUDITOR-1", bootstrapSessionId: "BOOTSTRAP-1", stagingRoot: execution.staging_root, workflow});
  assert.equal(audit.status, "PASS");
  const contextPath = path.join(execution.staging_root, plan.authority_corpus.roots.project_context_root, "project-context.json");
  const context = JSON.parse(fs.readFileSync(contextPath, "utf8"));
  assert.equal(context.source_plan_sha256, approved.plan_sha256);
  assert.equal(context.project_definition.project_name, plan.project_definition.project_name);
  assert.deepEqual(context.question_slice, ["FUNCTION_REQUIREMENTS", "DESIGN_BIBLE", "SECURITY"]);
  const promoted = promoteBootstrapExecution({plan: approved, executionState: execution.state, setupAudit: audit, projectRoot, nowUtc: "2026-01-01T00:01:00.000Z"});
  assert.equal(promoted.state.phase, "PROMOTED");
  assert.equal(promoted.receipt.schema, "agentos.bootstrap_promotion_receipt.v1");
  assert(fs.existsSync(path.join(projectRoot, "bootstrap.promotion.receipt.json")));
  assert.equal(promoteBootstrapExecution({plan: approved, executionState: promoted.state, setupAudit: audit, projectRoot, nowUtc: "2026-01-01T00:02:00.000Z"}).resumed, true);
} finally {
  fs.rmSync(projectRoot, {recursive: true, force: true});
}

const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-bootstrap-legacy-source-"));
const importedProject = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-bootstrap-imported-project-"));
try {
  fs.writeFileSync(path.join(sourceRoot, "legacy.md"), "legacy bytes\n");
  const importedAnswers = structuredClone(answers);
  importedAnswers["authority-corpus.source"] = {operation: "IMPORT", source_root: sourceRoot};
  const importedDiscovery = discoverProject(importedProject, "RECOMMENDED").facts;
  const importedPlan = compileBootstrapPlan({discovery: importedDiscovery, answers: importedAnswers, projectRoot: importedProject});
  const importedApproval = approveBootstrapPlan(importedPlan, {decision: PLAN_APPROVAL, planSha256: importedPlan.plan_sha256, discoveryDigestSha256: importedPlan.discovery_digest_sha256, actor: "OWNER", approvedAtUtc: ISO});
  const execution = executeBootstrapPlan(importedApproval, {bootstrapSessionId: "BOOTSTRAP-IMPORT", projectRoot: importedProject, legacySourceRoot: sourceRoot, workflow: JSON.parse(fs.readFileSync("schemas/capability-and-worktree-registry.v1.json", "utf8")), nowUtc: ISO});
  const legacyRoot = path.join(execution.staging_root, importedPlan.authority_corpus.roots.authority_root);
  assert.equal(verifyLegacyPreservation(legacyRoot).status, "VERIFIED_EXACT");
} finally {
  fs.rmSync(sourceRoot, {recursive: true, force: true});
  fs.rmSync(importedProject, {recursive: true, force: true});
}

const toctouSourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-bootstrap-legacy-toctou-source-"));
const toctouProject = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-bootstrap-toctou-project-"));
try {
  fs.writeFileSync(path.join(toctouSourceRoot, "legacy.md"), "original legacy bytes\n");
  const toctouAnswers = structuredClone(answers);
  toctouAnswers["authority-corpus.source"] = {operation: "IMPORT", source_root: toctouSourceRoot};
  const toctouDiscovery = discoverProject(toctouProject, "RECOMMENDED").facts;
  const toctouPlan = compileBootstrapPlan({discovery: toctouDiscovery, answers: toctouAnswers, projectRoot: toctouProject});
  const toctouApproval = approveBootstrapPlan(toctouPlan, {decision: PLAN_APPROVAL, planSha256: toctouPlan.plan_sha256, discoveryDigestSha256: toctouPlan.discovery_digest_sha256, actor: "OWNER", approvedAtUtc: ISO});
  fs.writeFileSync(path.join(toctouSourceRoot, "legacy.md"), "changed after approval\n");
  assert.throws(() => executeBootstrapPlan(toctouApproval, {
    bootstrapSessionId: "BOOTSTRAP-TOCTOU",
    projectRoot: toctouProject,
    legacySourceRoot: toctouSourceRoot,
    workflow: JSON.parse(fs.readFileSync("schemas/capability-and-worktree-registry.v1.json", "utf8")),
    nowUtc: ISO,
  }), /legacy source contents changed/u);
} finally {
  fs.rmSync(toctouSourceRoot, {recursive: true, force: true});
  fs.rmSync(toctouProject, {recursive: true, force: true});
}

const secretSourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-bootstrap-legacy-secret-source-"));
const secretProject = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-bootstrap-secret-project-"));
try {
  fs.writeFileSync(path.join(secretSourceRoot, ".env"), "API_KEY=not-a-placeholder-secret\n");
  const secretAnswers = structuredClone(answers);
  secretAnswers["authority-corpus.source"] = {operation: "IMPORT", source_root: secretSourceRoot};
  const secretDiscovery = discoverProject(secretProject, "RECOMMENDED").facts;
  assert.throws(() => compileBootstrapPlan({discovery: secretDiscovery, answers: secretAnswers, projectRoot: secretProject}), /secret-bearing file/u);
} finally {
  fs.rmSync(secretSourceRoot, {recursive: true, force: true});
  fs.rmSync(secretProject, {recursive: true, force: true});
}

console.log("PASS AgentOS Bootstrap compiler alignment (exact-plan approval, discovery, model floor, transaction, setup audit, and legacy gate)");
