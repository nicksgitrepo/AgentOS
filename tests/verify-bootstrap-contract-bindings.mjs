#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {compileBootstrapPlan, validateBootstrapPlan} from "../control/bootstrap-compiler.mjs";
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
      delivery_target: {family: "MANAGED_SITE", adapter_id: "GENERIC_MANAGED_SITE", mode: "LIMITED_PRODUCT", audience: "SELECTED_USERS"},
    },
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

  const lifeTamper = structuredClone(plan);
  lifeTamper.project_life_contract.audience = "PUBLIC";
  delete lifeTamper.plan_sha256;
  lifeTamper.plan_sha256 = "0".repeat(64);
  assert.throws(() => validateBootstrapPlan(lifeTamper), /project life contract is not content-addressed/u);

  const targetTamper = structuredClone(plan);
  targetTamper.delivery_target.mode = "PROTOTYPE";
  delete targetTamper.plan_sha256;
  targetTamper.plan_sha256 = "0".repeat(64);
  assert.throws(() => validateBootstrapPlan(targetTamper), /delivery target production claim does not match|delivery target is not content-addressed/u);

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
} finally {
  fs.rmSync(projectRoot, {recursive: true, force: true});
}

console.log("PASS AgentOS Bootstrap contract bindings (life, target, boundary, exact-plan, and hostile cross-contract coverage)");
