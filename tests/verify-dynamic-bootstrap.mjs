#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as dynamic from "../control/dynamic-bootstrap.mjs";
import {canonicalDigest, compileBootstrapPlan, planBootstrapQuestions} from "../control/bootstrap-compiler.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-discovery-"));
fs.writeFileSync(path.join(root, "package.json"), "{}\n");
const discovery = dynamic.discoverProject(root, "LOCAL_ONLY");
assert.equal(dynamic.DISCOVERY_MODES.has("LOCAL_ONLY"), true);
assert(discovery.facts.some((fact) => fact.fact_id === "project.marker.package.json"));
assert(discovery.facts.every((fact) => fact.secret_free === true));
assert.equal(canonicalDigest(discovery.facts).length, 64);
const planned = planBootstrapQuestions({discovery: discovery.facts, answers: {}});
assert.equal(planned.schema, "agentos.bootstrap_question_plan.v1");
assert(planned.question_budget.recommended_maximum <= 9);

const answers = {
  "bootstrap.discovery.mode": "LOCAL_ONLY",
  "project.north_star": {users: ["operator"], moment: "complete workflow", outcome: "truthful result"},
  "project.first_workflow": {name: "synthetic", done_when: ["result exists"]},
  "project.boundary": {project_name: "Synthetic", repositories: [], branches: []},
  "project.protected_boundaries": {owner_only: ["destructive changes"]},
  "authority-corpus.source": {operation: "CREATE_NEW"},
  "project.design": {page_families: [], templates: [], protected_surfaces: []},
  "project.technical_baseline": {testing: "deterministic"},
  "project.delivery_policy": {
    priority: "BALANCED",
    ci_runner: {route: "LOCAL", weekly_minutes_budget: 120},
    deployment: {route: "LOCAL", environment_ids: ["synthetic"], rollback_required: true, rollback_test: true},
  },
  "project.model_economics": {profile: "STANDARD_WORKWEEK", completion_floor: 0.8},
};
const plan = dynamic.compileBootstrapPlan({discovery: discovery.facts, answers, projectRoot: root});
assert.equal(plan.status, "AWAITING_EXACT_OWNER_APPROVAL");
assert.equal(plan.question_slice.join(","), "FUNCTION_REQUIREMENTS,DESIGN_BIBLE,SECURITY");
assert.equal(dynamic.executeBootstrapPlan !== undefined, true);
for (const legacyExport of ["applyBootstrapAnswer", "appendConfigurationSnapshot", "changePreference", "compileWorkerActivation", "nextBootstrapQuestion"]) {
  assert.equal(legacyExport in dynamic, false, `${legacyExport} remains an executable dynamic-bootstrap authority`);
}

assert.throws(() => dynamic.discoverProject(root, "MANUAL"));
assert.throws(() => dynamic.compileBootstrapPlan({discovery: discovery.facts, answers: {...answers, unknown: true}, projectRoot: root}));

console.log("PASS AgentOS dynamic Bootstrap compatibility route is discovery-backed, secret-free, and non-authoritative");
