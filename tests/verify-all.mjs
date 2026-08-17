#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {isRetainedFailedAttempt} from "../control/retained-failed-worktree.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HEX64 = /^[0-9a-f]{64}$/u;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/iu;
const PORTABLE_FORBIDDEN = [
  new RegExp(["private", "-", "consumer"].join(""), "iu"),
  new RegExp(["private", "-", "consumer", "-", "canon"].join(""), "iu"),
  new RegExp(["nicks", "git", "repo"].join(""), "iu"),
  new RegExp(["/", "Use", "rs", "/"].join(""), "u"),
  new RegExp(["chat", "gpt", "-conversation://"].join(""), "u"),
  new RegExp(["Chat", "GPT"].join(""), "iu"),
  new RegExp(["Open", "AI"].join(""), "iu"),
  new RegExp(["Code", "x"].join(""), "iu"),
  new RegExp(["CHAT", "GPT", "_SITES"].join(""), "u"),
  new RegExp(`${["A", "WS"].join("")}\\s+(?:account|region|resource)`, "iu"),
];
const STALE_NORMATIVE_TERMS = [
  ["PENDING", "_ADMISSION"].join(""),
  ["PLATFORM_AGENT", "_WAVE"].join(""),
  ["feature", "-exclusive"].join(""),
  ["successor", " wave"].join(""),
  ["TERMINAL_HANDOFF", "_TO_RUNTIME"].join(""),
  ["NEXT_RELEASE_ORCHESTRATOR", "_AUTHORITY_UPDATE_AND_CAMPAIGN_START"].join(""),
];
const compareUtf8 = (left, right) => Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function digest(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function walk(directory, result = []) {
  for (const entry of fs.readdirSync(directory, {withFileTypes: true}).sort((left, right) => compareUtf8(left.name, right.name))) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "tmp") continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (isRetainedFailedAttempt(absolute, root)) continue;
      walk(absolute, result);
    }
    else if (entry.isFile()) result.push(absolute);
  }
  return result;
}

function assertBoundFile(entry, label) {
  assert(entry && typeof entry.path === "string", `${label} has no path`);
  assert(HEX64.test(entry.sha256), `${label} has no exact digest`);
  const absolute = path.join(root, entry.path);
  assert(fs.existsSync(absolute) && fs.statSync(absolute).isFile(), `${label} is missing: ${entry.path}`);
  assert.equal(digest(fs.readFileSync(absolute)), entry.sha256, `${label} digest mismatch: ${entry.path}`);
}

const binding = JSON.parse(read("schemas/bootstrap-binding.v1.json"));
assert.equal(binding.schema, "agentos.governance_2_1rc_bootstrap_binding.v2");
assert.equal(binding.release_candidate, "2.1rc");
assert.equal(binding.status, "PREPARED_NOT_ACTIVATED");
assert.equal(binding.activation.requires_explicit_owner_approval, true);
assert.equal(binding.activation.product_campaign_rebind, false);
assert.equal(binding.activation.deployment_custody, false);
assert.equal(binding.activation.source_repository_modified, false);
const naming = JSON.parse(read("schemas/naming-and-terminology.v1.json"));
assert.equal(naming.canonical_terms.BOOTSTRAP.public_name, "Bootstrap");
assert.equal(naming.canonical_terms.AGENTOS_CONTROLLER.public_name, "Intent Regulator");
assert.equal(naming.compatibility_aliases.GLOBAL_ORCHESTRATOR, "AGENTOS_CONTROLLER");
const controllerContract = JSON.parse(read("schemas/agentos-controller.v1.json"));
assert.equal(controllerContract.name, "AGENTOS_CONTROLLER");
assert.equal(controllerContract.scope, "PROJECT_PERSISTENT");
assert.equal(controllerContract.supervisor.controller, "control/controller-supervisor-runtime.mjs");
assert.equal(controllerContract.supervisor.contract, "schemas/controller-supervisor.v1.json");
assert(controllerContract.controller_agent.wake_rule.includes("every active campaign handoff"));
assert.equal(controllerContract.operating_loop.controller, "control/continuous-operating-loop.mjs");
assert.equal(controllerContract.operating_loop.contract, "schemas/continuous-operating-loop.v1.json");
assert.equal(controllerContract.operating_loop.default_meaningful_progress_window_minutes, 15);
assert.deepEqual(controllerContract.operating_loop.persistent_roles, ["INTENT_REGULATOR", "RUNTIME"]);
const operatingLoopContract = JSON.parse(read("schemas/continuous-operating-loop.v1.json"));
assert.equal(operatingLoopContract.cadence.default_meaningful_progress_window_minutes, 15);
assert.equal(operatingLoopContract.roles.orchestrator.controller, "control/import-orchestrator.mjs");
assert.equal(operatingLoopContract.roles.orchestrator.contract, "schemas/import-orchestrator.v1.json");
assert.equal(operatingLoopContract.cadence.background_runner, "runContinuousOperatingLoop");
assert.equal(operatingLoopContract.cadence.heartbeat_is_not_meaningful_progress, true);
assert.equal(operatingLoopContract.cadence.failure_list_is_not_meaningful_progress, true);
assert.equal(operatingLoopContract.cadence.plan_is_not_meaningful_progress, true);
assert.equal(operatingLoopContract.worker_naming.format, "<clear role or lane> v<version>-tb-<two-digit test build>");
assert.equal(operatingLoopContract.repair_replacement.records.length, 4);
assert.equal(operatingLoopContract.repair_replacement.host_receipt_binding.includes("content-addressed"), true);
const supervisorContract = JSON.parse(read("schemas/controller-supervisor.v1.json"));
assert.equal(supervisorContract.role, "AGENTOS_CONTROLLER");
assert.equal(supervisorContract.persistence.controller, "control/controller-supervisor.mjs");
assert.equal(supervisorContract.goal.one_at_a_time_rule.includes("deterministic bounded goal"), true);
const importOrchestratorContract = JSON.parse(read("schemas/import-orchestrator.v1.json"));
assert.equal(importOrchestratorContract.properties.role_id.const, "CAMPAIGN_ORCHESTRATOR");
assert.equal(importOrchestratorContract.properties.mode.const, "IMPORT");
assert.equal(importOrchestratorContract.properties.handoff_contract.properties.spawner_defect_intake.const, "TYPED_SPAWNER_DEFECT_INTAKE");
assert.equal(importOrchestratorContract.properties.handoff_contract.properties.pyramid_output.const, "PYRAMID_IMPORT_OUTPUT_REPOSITORIES");
assert.equal(importOrchestratorContract.properties.handoff_contract.properties.git_repoint.const, "RUNTIME_ONLY_ATOMIC_GIT_REPOINT_WITH_LEGACY_RETENTION");
assert.equal(importOrchestratorContract.properties.continuation.properties.same_turn_next_action.const, true);
const spawnerDefectIntakeContract = JSON.parse(read("schemas/agent-spawner-defect-intake.v1.json"));
assert.equal(spawnerDefectIntakeContract.properties.spawner_role_id.const, "AGENT.SPAWNER_COMPILER");
assert.equal(spawnerDefectIntakeContract.properties.admission.properties.spawnable.const, false);
assert.equal(spawnerDefectIntakeContract.properties.admission.properties.independent_evaluation_required.const, true);
const sessionContract = JSON.parse(read("schemas/local-agent-session.v1.json"));
assert.equal(sessionContract.session.controller, "control/local-agent-session.mjs");
assert.equal(sessionContract.handoff.one_command_at_a_time, true);
const nativeSessionContract = JSON.parse(read("schemas/native-session-team.v1.json"));
assert.equal(nativeSessionContract.rules.execution_mode_binding.PROJECT_LOCAL_SESSION.includes("environment type local"), true);
assert.equal(nativeSessionContract.rules.execution_mode_binding.ISOLATED_WORKTREE.includes("environment type worktree"), true);
for (const [name, entry] of Object.entries(binding.normative)) assertBoundFile(entry, `normative ${name}`);
for (const [name, entry] of Object.entries(binding.compatibility_only)) {
  if (entry && typeof entry === "object" && !Array.isArray(entry) && entry.path) assertBoundFile(entry, `compatibility ${name}`);
}
for (const relativePath of binding.compatibility_only.legacy_contracts) {
  assert(fs.existsSync(path.join(root, relativePath)), `compatibility contract missing: ${relativePath}`);
}

const allFiles = walk(root);
const jsonFiles = allFiles.filter((file) => file.endsWith(".json"));
for (const file of jsonFiles) JSON.parse(fs.readFileSync(file, "utf8"));
const scriptFiles = allFiles.filter((file) => file.endsWith(".mjs"));
for (const file of scriptFiles) {
  const check = spawnSync(process.execPath, ["--check", file], {encoding: "utf8"});
  assert.equal(check.status, 0, `script syntax failed: ${path.relative(root, file)}\n${check.stderr}`);
}

const normativeFiles = Object.values(binding.normative).map((entry) => path.join(root, entry.path));
for (const file of normativeFiles) {
  const relative = path.relative(root, file);
  const text = fs.readFileSync(file, "utf8");
  for (const pattern of PORTABLE_FORBIDDEN) assert(!pattern.test(text), `portable authority contains product-specific context: ${relative}`);
  if (!relative.startsWith("tests/")) {
    for (const term of STALE_NORMATIVE_TERMS) assert(!text.includes(term), `normative authority contains stale lifecycle term ${term}: ${relative}`);
  }
}

const lifecycle = JSON.parse(read("schemas/campaign-lifecycle.v1.json"));
assert(!lifecycle.stages.includes("BLOCKED"), "campaign lifecycle has a terminal BLOCKED stage");
assert.equal(lifecycle.status, "PREPARED_NOT_ACTIVATED");
assert.equal(lifecycle.platform_pool.supervision_rule.includes("zero or one Feature Agent"), true);
assert.equal(lifecycle.finalizer.writer_rule.includes("campaign root adopts"), true);
assert.equal(lifecycle.successor_orientation.rule.includes("No next Auditor, Feature Agent, Platform Agent"), true);

const cascade = JSON.parse(read("schemas/campaign-cascade.v1.json"));
assert(!cascade.stages.includes("BLOCKED"), "campaign cascade has a BLOCKED stage");
assert.deepEqual(cascade.audit_disciplines, ["FUNCTIONALITY", "DESIGN_UI_SHELL_NAVIGATION", "SECURITY", "CODE_QUALITY_HYGIENE"]);
assert.equal(cascade.audit_rule.terminal.includes("DETERMINISTIC_ONLY"), true);
assert.equal(cascade.finalizer.custody.includes("campaign root adopts"), true);

const questionTree = JSON.parse(read("schemas/question-tree.v1.json"));
assert.deepEqual(questionTree.acceptance_roots, ["FUNCTION_REQUIREMENTS", "DESIGN_BIBLE", "SECURITY"]);
assert.deepEqual(questionTree.answer_values, ["YES", "NO", "UNKNOWN", "NOT_APPLICABLE", "EXCEPTION_REQUESTED"]);
assert.deepEqual(questionTree.lifecycle_states, ["UNEVALUATED", "EVIDENCE_PENDING", "OPEN_REPAIR", "VERIFIED", "INVALIDATED"]);
assert(!questionTree.root_statuses.includes("BLOCKED"));

const bootstrapPlan = JSON.parse(read("schemas/bootstrap-plan.v1.json"));
assert.equal(bootstrapPlan.approval.decision, "APPROVE_EXACT_PLAN");
assert(bootstrapPlan.approval.toctou.includes("Re-read discovery") && bootstrapPlan.approval.toctou.includes("plan digest"));
assert(bootstrapPlan.execution.legacy_gate.includes("legacy.zip") && bootstrapPlan.execution.legacy_gate.includes("before replacement corpus writes"));
assert(bootstrapPlan.required_output_groups.includes("DELIVERY_POLICY"));
assert(bootstrapPlan.required_output_groups.includes("BOOTSTRAP_SAFETY_ANALYSIS"));
assert.equal(bootstrapPlan.bootstrap_safety_analysis.default_operating_mode, "JSA");
assert(bootstrapPlan.bootstrap_safety_analysis.protected_activation_rule.includes("protected actions"));
assert.equal(bootstrapPlan.bootstrap_coverage.controller, "control/bootstrap-coverage.mjs");
assert.equal(bootstrapPlan.bootstrap_coverage.contract, "schemas/bootstrap-coverage.v1.json");
assert.equal(bootstrapPlan.project_life_contract.controller, "control/project-life-contract.mjs");
assert.equal(bootstrapPlan.boundary_contract.controller, "control/boundary-contract.mjs");
assert.equal(bootstrapPlan.delivery_target.controller, "control/delivery-target.mjs");
assert(bootstrapPlan.plan_identity.required_fields.includes("control_plane_root") && bootstrapPlan.plan_identity.required_fields.includes("control_plane"));
assert.equal(bootstrapPlan.execution.control_plane_rule.includes("product root"), true);
const controlPlane = JSON.parse(read("schemas/control-plane-root.v1.json"));
assert.equal(controlPlane.controller, "control/control-plane-root.mjs");
assert.equal(controlPlane.modes.EXTERNAL_DEFAULT.includes("separate sibling"), true);
assert.equal(controlPlane.modes.IN_PROJECT_OPT_IN.includes("explicitly"), true);
assert.deepEqual(Object.keys(controlPlane.storage_backends), ["LOCAL", "GIT", "HYBRID"]);
assert.equal(controlPlane.home_policy.repository_role, "AGENTOS_DEVELOPER_HOME");
const bootstrapCoverage = JSON.parse(read("schemas/bootstrap-coverage.v1.json"));
assert.equal(bootstrapCoverage.status, "PREPARED_NOT_ACTIVATED");
assert(bootstrapCoverage.coverage_outputs.some((entry) => entry.output_id === "PERSISTENT_RUNTIME"));
assert(bootstrapCoverage.coverage_outputs.some((entry) => entry.output_id === "DATA_AND_MIGRATION_POLICY"));
assert(bootstrapCoverage.binding.readiness.includes("material_gaps"));
const deliveryPolicy = JSON.parse(read("schemas/delivery-policy.v1.json"));
assert.equal(deliveryPolicy.question.id, "project.delivery_policy");
assert.equal(deliveryPolicy.finish.question_id, "project.delivery_finish");
assert.equal(deliveryPolicy.finish.owner_prompt, "When we're ready, what should I do with it?");
assert.equal(deliveryPolicy.finish.options.length, 6);
assert(deliveryPolicy.finish.rule.includes("No finish is silently assumed"));
assert.equal(deliveryPolicy.deployment.authority, "RUNTIME_AFTER_CENTRAL_ACCEPTANCE");
assert.equal(deliveryPolicy.delivery_target.contract, "schemas/delivery-target.v1.json");
const lifeContract = JSON.parse(read("schemas/project-life-contract.v1.json"));
assert.equal(lifeContract.question.id, "project.life_contract");
assert.equal(lifeContract.defaults.maturity, "PRIVATE_PROTOTYPE");
const targetContract = JSON.parse(read("schemas/delivery-target.v1.json"));
assert.equal(targetContract.managed_site_option.adapter_id, "GENERIC_MANAGED_SITE");
assert.deepEqual(targetContract.managed_site_option.supported_modes, ["PROTOTYPE", "LIMITED_PRODUCT"]);
const boundaryContract = JSON.parse(read("schemas/boundary-contract.v1.json"));
assert.deepEqual(boundaryContract.classes, ["CONSTITUTIONAL", "OWNER_SOVEREIGN", "DERIVED_OPERATING", "TEMPORARY_PROBE"]);
assert(boundaryContract.conflict_rule.includes("more restrictive") || boundaryContract.conflict_rule.includes("more restrictive".toUpperCase()));
const deliveryProbes = JSON.parse(read("schemas/delivery-probes.v1.json"));
assert.equal(deliveryProbes.safe_effects.network_attempted, false);
assert(deliveryProbes.prohibited.includes("deployment"));
const kernel = JSON.parse(read("schemas/kernel.v1.json"));
assert.equal(kernel.bootstrap.delivery_policy.controller, "control/delivery-policy.mjs");
assert.equal(kernel.bootstrap.delivery_policy.probe_contract, "schemas/delivery-probes.v1.json");
assert.equal(kernel.global_policy.controller, "control/global-policy-state.mjs");
assert.equal(kernel.global_policy.contract, "schemas/global-policy-state.v1.json");
assert.equal(kernel.agentos_controller.controller, "control/agentos-controller.mjs");
assert.equal(kernel.agentos_controller.contract, "schemas/agentos-controller.v1.json");
assert.equal(kernel.agentos_controller.name, "AGENTOS_CONTROLLER");
assert.equal(kernel.agentos_controller.campaign_orchestrator, "CAMPAIGN_SCOPED");
assert.equal(kernel.agentos_controller.supervisor, "control/controller-supervisor-runtime.mjs");
assert.equal(kernel.agentos_controller.supervisor_contract, "schemas/controller-supervisor.v1.json");
assert.equal(kernel.agentos_controller.durable_session_controller, "control/local-agent-session.mjs");
assert.equal(kernel.agentos_controller.durable_session_contract, "schemas/local-agent-session.v1.json");
assert(kernel.agentos_controller.supervisor_rule.includes("every active handoff") && kernel.agentos_controller.supervisor_rule.includes("hard boundary"));
assert.equal(kernel.agentos_controller.continuous_operating_loop.controller, "control/continuous-operating-loop.mjs");
assert.equal(kernel.agentos_controller.continuous_operating_loop.contract, "schemas/continuous-operating-loop.v1.json");
assert.equal(kernel.agentos_controller.reconciliation_interval_minutes, 15);
assert.equal(kernel.campaign_policy.contract, "schemas/campaign-policy-reconcile.v1.json");
assert.equal(kernel.campaign_state_owner.controller, "control/campaign-state-owner.mjs");
assert.equal(kernel.campaign_state_owner.contract, "schemas/campaign-state-owner.v1.json");
assert.equal(kernel.owner_review.controller, "control/owner-review.mjs");
assert.equal(kernel.owner_review.review_type, "PRE_CAMPAIGN_OWNER_REVIEW");
assert.equal(kernel.campaign_receipts.controller, "control/campaign-receipts.mjs");
assert.equal(kernel.campaign_receipts.contract, "schemas/campaign-receipts.v1.json");
assert(kernel.campaign_receipts.rule.includes("complete audit bodies") && kernel.campaign_receipts.rule.includes("fails closed"));
assert.equal(kernel.task_continuation.controller, "control/task-continuation.mjs");
assert.equal(kernel.task_continuation.contract, "schemas/task-continuation.v1.json");
assert(kernel.task_continuation.rule.includes("exactly one") && kernel.task_continuation.rule.includes("inactive"));
assert.equal(kernel.task_run_loop.controller, "control/task-run-loop.mjs");
assert.equal(kernel.task_run_loop.contract, "schemas/task-run-loop.v1.json");
assert(kernel.task_run_loop.rule.includes("exactly one") && kernel.task_run_loop.rule.includes("fails closed"));
assert.equal(kernel.agentos_controller_initialization.controller, "control/agentos-controller.mjs");
assert.equal(kernel.agentos_controller_initialization.state_path, "agentos/controller-state.json");
assert.equal(kernel.agentos_controller_initialization.storage_rule.includes("control-plane root"), true);
assert.equal(kernel.control_plane.controller, "control/control-plane-root.mjs");
assert.equal(kernel.control_plane.default_mode, "EXTERNAL_DEFAULT");
assert.deepEqual(kernel.control_plane.storage_backends, ["LOCAL", "GIT", "HYBRID"]);
assert.equal(kernel.bootstrap.start_contract, "schemas/bootstrap-start.v1.json");
assert.equal(kernel.bootstrap.start_command, "node <AGENTOS_ROOT>/control/bootstrap-compiler.mjs start <PROJECT_ROOT> RECOMMENDED");
const bootstrapStart = JSON.parse(read("schemas/bootstrap-start.v1.json"));
assert.equal(bootstrapStart.invocation.side_effects, "READ_ONLY_DISCOVERY_ONLY");
assert.equal(bootstrapStart.invocation.command, "node <AGENTOS_ROOT>/control/bootstrap-compiler.mjs start <PROJECT_ROOT> RECOMMENDED");
assert(bootstrapStart.result.required_fields.includes("bootstrap_operating_mode"));
assert(bootstrapStart.safety.next_step.includes("default JSA mode"));
assert(bootstrapStart.safety.next_step.includes("changed scope returns to reassessment"));
const promotionGate = JSON.parse(read("schemas/release-promotion-gate.v1.json"));
assert.equal(promotionGate.controller, "control/release-promotion-gate.mjs");
assert.equal(promotionGate.blocker, "STERILE_RELEASE_NOT_PROMOTED");
const promotionBlocker = JSON.parse(read("docs/release-development-promotion-blocker.v1.json"));
assert.equal(promotionBlocker.status, "BLOCKED_STERILE_RELEASE_NOT_PROMOTED");
assert.equal(promotionBlocker.publishing, false);
assert.equal(promotionBlocker.action_taken, "NONE");

const runtime = JSON.parse(read("schemas/browser-runtime-lifecycle.v1.json"));
assert.equal(runtime.agent_lifecycle.persistent_roles.join(","), "RUNTIME");
assert.equal(runtime.agent_lifecycle.successor_creation_trigger, "CURRENT_AUDITOR_RELEASE_CLEARANCE_FOR_DEPLOYMENT");
assert.equal(runtime.agent_lifecycle.successor_pre_live_scope, "ORCHESTRATOR_ORIENTATION_ONLY");
assert.equal(runtime.seam_review.scheduler, "control/campaign-cascade.mjs");
assert.deepEqual(runtime.seam_review.always_required, []);

const run = (relativePath) => {
  const result = spawnSync(process.execPath, [relativePath], {cwd: root, encoding: "utf8"});
  assert.equal(result.status, 0, `${relativePath} failed\n${result.stdout}\n${result.stderr}`);
};
const canonicalVerifierPaths = allFiles
  .map((file) => path.relative(root, file))
  .filter((relativePath) => relativePath.startsWith("tests/")
    && relativePath.endsWith(".mjs")
    && relativePath !== "tests/verify-all.mjs")
  .sort(compareUtf8);
assert(canonicalVerifierPaths.length > 0, "canonical verifier discovered no test modules");
for (const relativePath of canonicalVerifierPaths) run(relativePath);

console.log(`PASS AgentOS 2.1rc canonical verifier: ${allFiles.length} files scanned; ${Object.keys(binding.normative).length} normative paths hashed; ${canonicalVerifierPaths.length} test modules executed; JSON, scripts, portability, lifecycle, Bootstrap, GPT_ASSIST, hostile, and the canonical rapid-lane runner passed`);
