#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  approveBootstrapPlan,
  auditBootstrapSetup,
  compileBootstrapPlan,
  compileRuntimeReadback,
  executeBootstrapPlan,
  PLAN_APPROVAL,
  promoteBootstrapExecution,
  validateBootstrapPlan,
} from "../control/bootstrap-compiler.mjs";
import {resolveControlPlaneRoot} from "../control/control-plane-root.mjs";
import {discoverProject} from "../control/bootstrap-discovery.mjs";
import {compileControllerRuntimeReadback} from "../control/agentos-controller.mjs";

const parent = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-control-plane-boundary-"));
const projectRoot = path.join(parent, "product");
fs.mkdirSync(projectRoot);
const workflow = JSON.parse(fs.readFileSync("schemas/capability-and-worktree-registry.v1.json", "utf8"));
const nowUtc = "2026-08-03T00:00:00.000Z";

const answers = {
  "bootstrap.discovery.mode": "RECOMMENDED",
  "project.north_star": {user: "synthetic user", outcome: "complete the first useful workflow"},
  "project.first_workflow": {name: "synthetic workflow", success: "one accepted result"},
  "project.boundary": {project_name: "Synthetic Control Plane Project", repositories: [], branches: []},
  "project.protected_boundaries": {owner_only: ["destructive production actions"], protected: ["secrets"]},
  "authority-corpus.source": {operation: "CREATE_NEW"},
  "project.technical_baseline": {testing: "deterministic"},
  "project.delivery_policy": {
    source_control: {push_mode: "CHECKPOINTS_REMOTE_EQUAL"},
    ci_runner: {route: "LOCAL", weekly_minutes_budget: 100},
    deployment: {route: "LOCAL", environment_ids: ["synthetic"]},
  },
  "project.delivery_finish": "REVIEW",
  "project.model_economics": {profile: "ECO_CONTINUOUS", completion_floor: 0.8},
  "project.runtime": {session_id: "RUNTIME-CONTROL-PLANE", environment_identity: "ENV-CONTROL-PLANE", capabilities: ["filesystem"]},
};

const discovery = discoverProject(projectRoot, "RECOMMENDED").facts;
const plan = compileBootstrapPlan({discovery, answers, projectRoot});
validateBootstrapPlan(plan);
assert.equal(plan.control_plane.mode, "EXTERNAL_DEFAULT");
assert.equal(plan.control_plane.storage_scope, "EXTERNAL");
assert.equal(plan.control_plane.storage_backend, "LOCAL");
assert.equal(plan.control_plane.home_policy.repository_role, "AGENTOS_DEVELOPER_HOME");
assert.notEqual(plan.control_plane_root, plan.project_root);
assert(plan.control_plane_root.startsWith(`${path.dirname(plan.project_root)}${path.sep}`));
assert(plan.control_plane_root.endsWith(".agentos-control-plane"));

const approved = approveBootstrapPlan(plan, {
  decision: PLAN_APPROVAL,
  planSha256: plan.plan_sha256,
  discoveryDigestSha256: plan.discovery_digest_sha256,
  actor: "SYNTHETIC-OWNER",
  approvedAtUtc: nowUtc,
});
const controllerRuntimeReadback = compileControllerRuntimeReadback({
  projectId: approved.project_definition.project_name,
  controllerRuntimeId: "CONTROLLER-RUNTIME-CONTROL-PLANE",
  runtimeId: "PROJECT-RUNTIME-CONTROL-PLANE",
  environmentIdentity: approved.persistent_runtime.environment_identity,
  capabilitySetSha256: "a".repeat(64),
  observedBySession: "CONTROLLER-READBACK-CONTROL-PLANE",
  observedAtUtc: nowUtc,
});
const execution = executeBootstrapPlan(approved, {
  bootstrapSessionId: "BOOTSTRAP-CONTROL-PLANE",
  projectRoot,
  workflow,
  nowUtc,
  controllerRuntimeReadback,
  controllerSessionId: "CONTROLLER-SESSION-CONTROL-PLANE",
});
const runtimeReadback = compileRuntimeReadback({
  sessionId: approved.persistent_runtime.session_id,
  environmentIdentity: approved.persistent_runtime.environment_identity,
  capabilities: approved.persistent_runtime.capabilities,
  observedByRole: "SYNTHETIC-RUNTIME-ADAPTER",
  observedBySession: "RUNTIME-READBACK-CONTROL-PLANE",
  observedAtUtc: nowUtc,
});
const audit = auditBootstrapSetup({
  plan: approved,
  executionState: execution.state,
  auditorSessionId: "SETUP-AUDITOR-CONTROL-PLANE",
  bootstrapSessionId: "BOOTSTRAP-CONTROL-PLANE",
  stagingRoot: execution.staging_root,
  workflow,
  runtimeReadback,
  controllerRuntimeReadback,
  controllerSessionId: "CONTROLLER-SESSION-CONTROL-PLANE",
});
assert.equal(audit.status, "PASS");
assert.equal(execution.state.control_plane_root, approved.control_plane_root);
assert(fs.existsSync(path.join(execution.staging_root, "bootstrap.plan.json")));
assert.deepEqual(fs.readdirSync(projectRoot), [], "external control-plane mode wrote into the Product root");

const promoted = promoteBootstrapExecution({
  plan: approved,
  executionState: execution.state,
  setupAudit: audit,
  projectRoot,
  nowUtc: "2026-08-03T00:01:00.000Z",
});
assert.equal(promoted.state.promotion_root, approved.control_plane_root);
assert(fs.existsSync(path.join(approved.control_plane_root, "bootstrap.promotion.receipt.json")));
assert.deepEqual(fs.readdirSync(projectRoot), [], "external promotion wrote into the Product root");

assert.throws(() => resolveControlPlaneRoot({projectRoot, controlPlaneRoot: projectRoot}), /separate from the project root/u);
assert.throws(() => resolveControlPlaneRoot({projectRoot, controlPlaneRoot: parent, controlPlaneMode: "IN_PROJECT_OPT_IN"}), /inside the project root/u);
const optedIn = resolveControlPlaneRoot({
  projectRoot,
  controlPlaneRoot: path.join(projectRoot, ".agentos"),
  controlPlaneMode: "IN_PROJECT_OPT_IN",
});
assert.equal(optedIn.binding.mode, "IN_PROJECT_OPT_IN");
assert.equal(optedIn.binding.storage_scope, "PROJECT_ROOT");

const gitHome = path.join(parent, "agentos-git-home");
fs.mkdirSync(path.join(gitHome, ".git"), {recursive: true});
const gitBinding = resolveControlPlaneRoot({
  projectRoot,
  controlPlaneRoot: gitHome,
  storageBackend: "GIT",
});
assert.equal(gitBinding.binding.storage_backend, "GIT");
const hybridBinding = resolveControlPlaneRoot({
  projectRoot,
  controlPlaneRoot: gitHome,
  storageBackend: "HYBRID",
});
assert.equal(hybridBinding.binding.storage_backend, "HYBRID");

fs.rmSync(parent, {recursive: true, force: true});
console.log("PASS AgentOS control-plane boundary (external default, clean Product root, promotion containment, and explicit in-project opt-in)");
