#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {canonicalDigest, compileBootstrapPlan, validateBootstrapPlan} from "../control/bootstrap-compiler.mjs";
import {discoverProject} from "../control/bootstrap-discovery.mjs";

const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-contract-binding-project-"));
try {
  const discovery = discoverProject(projectRoot, "RECOMMENDED").facts;
  const answers = {
    "bootstrap.discovery.mode": "RECOMMENDED",
    "project.north_star": {user: "selected users", outcome: "complete one bounded workflow"},
    "project.first_workflow": {name: "bounded workflow", success: "one accepted result"},
    "project.life_contract": {maturity: "LIMITED_PRODUCT", audience: "SELECTED_USERS", data_posture: "NONE_OR_SYNTHETIC"},
    "project.boundary": {project_name: "Synthetic Contract Project", repositories: [{repository_id: "main", remote: "synthetic", default_branch: "main"}], branches: ["main"]},
    "project.protected_boundaries": {owner_only: ["publication", "promotion"], protected: ["secrets", "accepted truth"]},
    "authority-corpus.source": {operation: "CREATE_NEW"},
    "project.technical_baseline": {testing: "deterministic"},
    "project.delivery_policy": {
      source_control: {push_mode: "CHECKPOINTS_REMOTE_EQUAL"},
      ci_runner: {route: "LOCAL", weekly_minutes_budget: 100},
      deployment: {route: "MANAGED", provider_id: "managed", environment_ids: ["synthetic"]},
      delivery_target: {
        family: "MANAGED_SITE",
        adapter_id: "GENERIC_MANAGED_SITE",
        mode: "LIMITED_PRODUCT",
        audience: "SELECTED_USERS",
        supported_scope: ["SELECTED_USER_WORKFLOWS"],
        operating_envelope: ["OWNER_BOUNDED_AVAILABILITY"],
        rollback_path: "EXACT_LAST_ACCEPTED_DEPLOYMENT",
      },
    },
    "project.delivery_finish": "REVIEW",
    "project.model_economics": {profile: "ECO_CONTINUOUS", completion_floor: 0.8},
    "project.runtime": {session_id: "RUNTIME-BOUND", environment_identity: "SYNTHETIC-BOUND", capabilities: ["filesystem"]},
  };
  const plan = compileBootstrapPlan({discovery, answers, projectRoot});
  validateBootstrapPlan(plan);
  assert.equal(plan.project_life_contract.maturity, "LIMITED_PRODUCT");
  assert.equal(plan.delivery_target.adapter_id, "GENERIC_MANAGED_SITE");
  assert.equal(plan.delivery_target.mode, "LIMITED_PRODUCT");
  assert.equal(plan.exact_creation_plan.project_life_contract_sha256, plan.project_life_contract.life_contract_sha256);
  assert.equal(plan.exact_creation_plan.delivery_target_sha256, plan.delivery_target.target_sha256);
  assert.equal(plan.exact_creation_plan.boundary_contract_sha256, plan.boundary_contract.boundary_contract_sha256);
  assert.equal(plan.delivery_policy.delivery_target.target_sha256, plan.delivery_target.target_sha256);
  assert.equal(plan.controller_supervision.controller_display_name, "Controller");
  assert.equal(plan.controller_supervision.audit_interval_minutes, 15);
  assert.equal(plan.controller_supervision.default_audit_interval_minutes, 15);
  assert.equal(plan.controller_supervision.meaningful_progress_window_minutes, 15);
  assert.deepEqual(plan.controller_supervision.stop_only_for, ["HARD_BOUNDARY", "REAL_OWNER_CHOICE", "VERIFIED_HOST_CAPABILITY_FAILURE"]);
  assert.equal(plan.development_plan.mode, "RAPID_PROTOTYPING");
  assert.equal(plan.development_plan.intent_binding.north_star_sha256, canonicalDigest(plan.north_star));
  assert.equal(plan.development_plan.intent_binding.first_workflow_sha256, canonicalDigest(plan.first_useful_workflow));
  assert.equal(plan.exact_creation_plan.controller_supervision_sha256, plan.controller_supervision.supervision_sha256);

  const configuredPlan = compileBootstrapPlan({
    discovery,
    answers: {...answers, "project.audit_interval": {minutes: 30}},
    projectRoot,
  });
  validateBootstrapPlan(configuredPlan);
  assert.equal(configuredPlan.controller_supervision.audit_interval_minutes, 30);
  assert.equal(configuredPlan.global_policy_state.variables.find((item) => item.variable_id === "OPERATIONS.HEARTBEAT_INTERVAL_MINUTES").current_value, 30);

  assert.throws(() => compileBootstrapPlan({discovery, answers: {...answers, "project.audit_interval": {minutes: 0}}, projectRoot}), /audit interval/u);
  assert.throws(() => compileBootstrapPlan({discovery, answers: {...answers, "project.audit_interval": {minutes: 1441}}, projectRoot}), /audit interval/u);

  const lifeTamper = structuredClone(plan);
  lifeTamper.project_life_contract.audience = "PUBLIC";
  delete lifeTamper.plan_sha256;
  lifeTamper.plan_sha256 = "0".repeat(64);
  assert.throws(() => validateBootstrapPlan(lifeTamper), /project life contract is not content-addressed|Bootstrap safety analysis is not bound to scope inputs/u);

  const targetTamper = structuredClone(plan);
  targetTamper.delivery_target.mode = "PROTOTYPE";
  delete targetTamper.plan_sha256;
  targetTamper.plan_sha256 = "0".repeat(64);
  assert.throws(() => validateBootstrapPlan(targetTamper), /delivery target production claim does not match|delivery target is not content-addressed|Bootstrap safety analysis is not bound to scope inputs/u);

  const boundaryTamper = structuredClone(plan);
  boundaryTamper.boundary_contract.hold_rule = "CONTINUE_ALL_WORK";
  delete boundaryTamper.plan_sha256;
  boundaryTamper.plan_sha256 = "0".repeat(64);
  assert.throws(() => validateBootstrapPlan(boundaryTamper), /hold rule is weakened/u);

  const bindingTamper = structuredClone(plan);
  bindingTamper.exact_creation_plan.delivery_bindings.target_mode = "PROTOTYPE";
  delete bindingTamper.plan_sha256;
  bindingTamper.plan_sha256 = "0".repeat(64);
  assert.throws(() => validateBootstrapPlan(bindingTamper), /delivery bindings do not match/u);

  const supervisionTamper = structuredClone(plan);
  supervisionTamper.controller_supervision.stop_only_for = ["HARD_BOUNDARY"];
  delete supervisionTamper.plan_sha256;
  supervisionTamper.plan_sha256 = canonicalDigest(supervisionTamper);
  assert.throws(() => validateBootstrapPlan(supervisionTamper), /controller supervision is not content-addressed|stop boundaries are invalid/u);

  const supervisionBindingTamper = structuredClone(plan);
  supervisionBindingTamper.exact_creation_plan.controller_supervision_sha256 = "0".repeat(64);
  delete supervisionBindingTamper.plan_sha256;
  supervisionBindingTamper.plan_sha256 = canonicalDigest(supervisionBindingTamper);
  assert.throws(() => validateBootstrapPlan(supervisionBindingTamper), /not bound to controller supervision/u);
} finally {
  fs.rmSync(projectRoot, {recursive: true, force: true});
}

console.log("PASS AgentOS Bootstrap contract bindings (life, target, boundary, exact-plan, and hostile cross-contract coverage)");
