#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  approveBootstrapPlan,
  auditBootstrapSetup,
  compileBootstrapPlan,
  executeBootstrapPlan,
  validateBootstrapPlan,
} from "../control/bootstrap-compiler.mjs";
import {discoverProject} from "../control/bootstrap-discovery.mjs";
import {canonicalDigest as importDigest} from "../control/project-import.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-bootstrap-import-binding-"));
const source = path.join(root, "source");
const destination = path.join(root, "destination");
fs.mkdirSync(path.join(source, "src"), {recursive: true});
fs.mkdirSync(destination);
fs.writeFileSync(path.join(source, "package.json"), "{\"name\":\"synthetic\"}\n");
fs.writeFileSync(path.join(source, "src", "main.js"), "export default true;\n");
const discovery = discoverProject(destination, "RECOMMENDED").facts;
const answers = {
  "bootstrap.discovery.mode": "RECOMMENDED",
  "project.north_star": {user: "synthetic user", outcome: "complete the first useful workflow"},
  "project.first_workflow": {name: "synthetic workflow", success: "one accepted result"},
  "project.boundary": {project_name: "Synthetic Import Project", repositories: [], branches: []},
  "project.import": {mode: "NORMALIZE_AND_AUDIT", source_root: source, destination_root: destination},
  "project.protected_boundaries": {owner_only: ["publication", "promotion"]},
  "authority-corpus.source": {operation: "CREATE_NEW"},
  "project.technical_baseline": {testing: "deterministic"},
  "project.delivery_policy": {
    source_control: {push_mode: "CHECKPOINTS_REMOTE_EQUAL"},
    ci_runner: {route: "LOCAL", weekly_minutes_budget: 100},
    deployment: {route: "LOCAL", environment_ids: ["synthetic"]},
  },
  "project.model_economics": {profile: "ECO_CONTINUOUS", completion_floor: 0.8},
  "project.runtime": {session_id: "RUNTIME-IMPORT", environment_identity: "ENV-IMPORT", capabilities: ["filesystem"]},
};
const plan = compileBootstrapPlan({discovery, answers, projectRoot: destination});
validateBootstrapPlan(plan);
assert.equal(plan.project_import.mode, "NORMALIZE_AND_AUDIT");
assert.equal(plan.project_import.standards_registry_sha256, plan.standards_registry.registry_sha256);
assert.equal(plan.project_import.normalization_sha256, plan.normalization_policy.normalization_sha256);
assert.equal(plan.exact_creation_plan.project_import_sha256, plan.project_import.plan_sha256);
assert.equal(plan.exact_creation_plan.source_preservation_sha256, plan.project_import.source_identity.source_content_sha256);
assert(plan.bootstrap_coverage.outputs.some((row) => row.output_id === "PROJECT_IMPORT" && row.status === "OWNER_CONFIRMED"));
assert(plan.bootstrap_coverage.outputs.some((row) => row.output_id === "SOURCE_PRESERVATION" && row.blocking === false));

const approved = approveBootstrapPlan(plan, {
  decision: "APPROVE_EXACT_PLAN",
  planSha256: plan.plan_sha256,
  discoveryDigestSha256: plan.discovery_digest_sha256,
  actor: "SYNTHETIC_OWNER",
  approvedAtUtc: "2026-08-03T00:00:00.000Z",
});
const executed = executeBootstrapPlan(approved, {
  bootstrapSessionId: "BOOTSTRAP-IMPORT-001",
  projectRoot: destination,
  nowUtc: "2026-08-03T00:00:00.000Z",
});
const setupAudit = auditBootstrapSetup({
  plan: approved,
  executionState: executed.state,
  auditorSessionId: "AUDITOR-IMPORT-001",
  bootstrapSessionId: "BOOTSTRAP-IMPORT-001",
  stagingRoot: executed.staging_root,
});
assert.equal(setupAudit.status, "PASS");
assert(setupAudit.checks.includes("PROJECT_IMPORT_SOURCE_PRESERVATION"));
assert(fs.existsSync(path.join(executed.staging_root, ".agentos", "import", "source-preservation", "source-preservation.zip")));

const adoptRoot = path.join(root, "adopt-in-place");
fs.mkdirSync(adoptRoot);
fs.writeFileSync(path.join(adoptRoot, "package.json"), "{\"name\":\"adopt\"}\n");
const adoptAnswers = structuredClone(answers);
adoptAnswers["project.boundary"].project_name = "Synthetic Adopt Project";
adoptAnswers["project.import"] = {mode: "ADOPT_IN_PLACE", source_root: adoptRoot};
const adoptPlan = compileBootstrapPlan({discovery: discoverProject(adoptRoot, "RECOMMENDED").facts, answers: adoptAnswers, projectRoot: adoptRoot});
const adoptApproved = approveBootstrapPlan(adoptPlan, {
  decision: "APPROVE_EXACT_PLAN",
  planSha256: adoptPlan.plan_sha256,
  discoveryDigestSha256: adoptPlan.discovery_digest_sha256,
  actor: "SYNTHETIC_OWNER",
  approvedAtUtc: "2026-08-03T00:00:00.000Z",
});
const adoptExecuted = executeBootstrapPlan(adoptApproved, {
  bootstrapSessionId: "BOOTSTRAP-ADOPT-001",
  projectRoot: adoptRoot,
  nowUtc: "2026-08-03T00:00:00.000Z",
});
const adoptAudit = auditBootstrapSetup({
  plan: adoptApproved,
  executionState: adoptExecuted.state,
  auditorSessionId: "AUDITOR-ADOPT-001",
  bootstrapSessionId: "BOOTSTRAP-ADOPT-001",
  stagingRoot: adoptExecuted.staging_root,
});
assert.equal(adoptAudit.status, "PASS");
assert(fs.existsSync(path.join(adoptRoot, ".agentos", "import", "source-preservation", "source-preservation.zip")));

const importTamper = structuredClone(plan);
importTamper.project_import.standards_registry_sha256 = "0".repeat(64);
delete importTamper.project_import.plan_sha256;
importTamper.project_import.plan_sha256 = importDigest(importTamper.project_import);
importTamper.exact_creation_plan.project_import_sha256 = importTamper.project_import.plan_sha256;
delete importTamper.plan_sha256;
importTamper.plan_sha256 = importDigest(importTamper);
assert.throws(() => validateBootstrapPlan(importTamper), /project import is not bound to the standards registry/u);

const emptyRoot = path.join(root, "empty");
fs.mkdirSync(emptyRoot);
const emptyDiscovery = discoverProject(emptyRoot, "RECOMMENDED").facts;
const emptyAnswers = {...answers};
delete emptyAnswers["project.import"];
const emptyPlan = compileBootstrapPlan({discovery: emptyDiscovery, answers: emptyAnswers, projectRoot: emptyRoot});
assert.equal(emptyPlan.project_import, null);
assert.equal(emptyPlan.normalization_policy.import_mode, null);
assert.equal(emptyPlan.exact_creation_plan.project_import_sha256, null);
validateBootstrapPlan(emptyPlan);

fs.rmSync(root, {recursive: true, force: true});
console.log("PASS AgentOS Bootstrap import bindings (typed import context separation, source/standards/normalization digests, empty synthetic path, and hostile cross-contract mutation)");
