#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HEX64 = /^[0-9a-f]{64}$/u;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/iu;
const PORTABLE_FORBIDDEN = [
  new RegExp(["Soc", "iuna"].join(""), "iu"),
  new RegExp(["soci", "una", "-canon"].join(""), "iu"),
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
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute, result);
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
assert.equal(kernel.campaign_policy.contract, "schemas/campaign-policy-reconcile.v1.json");
assert.equal(kernel.campaign_state_owner.controller, "control/campaign-state-owner.mjs");
assert.equal(kernel.campaign_state_owner.contract, "schemas/campaign-state-owner.v1.json");
assert.equal(kernel.owner_review.controller, "control/owner-review.mjs");
assert.equal(kernel.owner_review.review_type, "PRE_CAMPAIGN_OWNER_REVIEW");
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
assert(bootstrapStart.safety.next_step.includes("APPROVE_EXACT_PLAN"));

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
for (const relativePath of [
  "tests/verify-campaign-controller.mjs",
  "tests/verify-campaign-policy-reconcile.mjs",
  "tests/verify-campaign-cascade.mjs",
  "tests/verify-question-tree.mjs",
  "tests/verify-readme.mjs",
  "tests/verify-bootstrap-start.mjs",
  "tests/verify-cascade-economics.mjs",
  "tests/verify-bootstrap-coverage.mjs",
  "tests/verify-standards-registry.mjs",
  "tests/verify-normalization-policy.mjs",
  "tests/verify-project-import.mjs",
  "tests/verify-bootstrap-import-bindings.mjs",
  "tests/verify-bootstrap-owner-review-handoff.mjs",
  "tests/verify-bootstrap-contract-bindings.mjs",
  "tests/verify-project-life-contract.mjs",
  "tests/verify-delivery-target.mjs",
  "tests/verify-boundary-contract.mjs",
  "tests/verify-bootstrap-alignment.mjs",
  "tests/verify-delivery-policy.mjs",
  "tests/verify-guided-bootstrap.mjs",
  "tests/verify-dynamic-bootstrap.mjs",
  "tests/verify-browser-runtime-lifecycle.mjs",
  "tests/verify-gpt-assist.mjs",
  "tests/verify-global-policy-state.mjs",
  "tests/verify-agentos-controller.mjs",
  "tests/verify-global-policy-store.mjs",
  "tests/verify-project-context-store.mjs",
  "tests/verify-owner-review.mjs",
  "tests/verify-campaign-state-bridge.mjs",
  "tests/verify-campaign-state-owner.mjs",
  "tests/verify-continuous-audit-sentinel.mjs",
  "tests/verify-repository-readback.mjs",
  "tests/verify-portability.mjs",
  "tests/verify-control-plane-root.mjs",
]) run(relativePath);

console.log(`PASS AgentOS 2.1rc canonical verifier: ${allFiles.length} files scanned; ${Object.keys(binding.normative).length} normative paths hashed; JSON, scripts, portability, lifecycle, Bootstrap, GPT_ASSIST, and hostile suites passed`);
