#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {
  AUDITOR_REPORT_SCHEMA,
  AUDITOR_SEED_BINDING_SCHEMA,
  AUDITOR_SEED_SCHEMA,
  CONTRACT_STATUS,
  FEATURE_MAP_SCHEMA,
  FEATURE_STATUSES,
  STATUS_ROUTES,
  compileAuditorCompletenessReport,
  compileAuditorSeed,
  compileFeatureMap,
  compileInventoryCoveragePlan,
  createFreshAuditorBinding,
  validateAuditorCompletenessReport,
  validateAuditorSeed,
  validateAuditorSeedBinding,
  validateFeatureInventory,
  validateFeatureMap,
  validateInventoryCoveragePlan,
} from "../control/feature-completeness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {cwd: root, encoding: "utf8"}).trim();
const sourceTree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], {cwd: root, encoding: "utf8"}).trim();
const SHA = "a".repeat(64);

const schema = JSON.parse(fs.readFileSync(path.join(root, "schemas/feature-completeness.v1.json"), "utf8"));
assert.equal(schema.status, CONTRACT_STATUS);
assert.equal(schema.controller, "control/feature-completeness.mjs");
assert.equal(schema.activation.active, false);
assert.deepEqual(schema.auditor_report.allowed_statuses, FEATURE_STATUSES);
assert.equal(schema.auditor_report.schema, AUDITOR_REPORT_SCHEMA);
assert.equal(schema.auditor_seed.schema, AUDITOR_SEED_SCHEMA);
assert.equal(schema.auditor_seed_binding.schema, AUDITOR_SEED_BINDING_SCHEMA);

const featureMap = compileFeatureMap({
  mapId: "MAP-1",
  projectId: "PROJECT-1",
  campaignId: "CAMPAIGN-1",
  buildId: "BUILD-1",
  projectGovernanceSha256: SHA,
  sourceCommit,
  sourceTree,
  features: [
    {featureId: "FEATURE-A", label: "A complete feature"},
    {featureId: "FEATURE-B", label: "A partial feature"},
    {featureId: "FEATURE-C", label: "An owner-choice feature"},
    {featureId: "FEATURE-D", label: "A missing feature"},
    {featureId: "FEATURE-E", label: "An unnecessary feature"},
  ],
});
assert.equal(featureMap.schema, FEATURE_MAP_SCHEMA);
assert.equal(featureMap.contract_status, CONTRACT_STATUS);
assert.equal(featureMap.visibility, "CONTROL_SPACE");
assert.doesNotThrow(() => validateFeatureMap(featureMap, {currentSourceCommit: sourceCommit, currentSourceTree: sourceTree}));

function evidence(featureId, evidenceId, pathValue = null, linkValue = null) {
  return {
    evidenceId,
    kind: "CHECK",
    summary: `Observed evidence for ${featureId}`,
    path: pathValue,
    link: linkValue,
  };
}

const classifications = [
  {featureId: "FEATURE-A", status: "BUILT_AND_CHECKED", evidence: [evidence("FEATURE-A", "EVIDENCE-A", "evidence/feature-a.txt")]},
  {featureId: "FEATURE-B", status: "PARTLY_BUILT", evidence: [evidence("FEATURE-B", "EVIDENCE-B", "evidence/feature-b.txt")]},
  {featureId: "FEATURE-C", status: "WAITING_FOR_OWNER_CHOICE", evidence: [evidence("FEATURE-C", "EVIDENCE-C", null, "evidence/feature-c.txt")]},
  {featureId: "FEATURE-D", status: "NOT_BUILT", evidence: [evidence("FEATURE-D", "EVIDENCE-D")]},
  {featureId: "FEATURE-E", status: "NOT_NEEDED", evidence: [evidence("FEATURE-E", "EVIDENCE-E")]},
];
const report = compileAuditorCompletenessReport({
  reportId: "REPORT-1",
  featureMap,
  sourceCommit,
  sourceTree,
  auditorId: "AUDITOR-1",
  builderId: "BUILDER-1",
  acceptedBy: null,
  classifications,
});
assert.equal(report.schema, AUDITOR_REPORT_SCHEMA);
assert.equal(report.visibility, "PUBLIC");
assert.deepEqual(report.classifications.map((entry) => entry.route), [
  STATUS_ROUTES.BUILT_AND_CHECKED,
  STATUS_ROUTES.PARTLY_BUILT,
  STATUS_ROUTES.WAITING_FOR_OWNER_CHOICE,
  STATUS_ROUTES.NOT_BUILT,
  STATUS_ROUTES.NOT_NEEDED,
]);
assert.equal(report.classifications.find((entry) => entry.status === "PARTLY_BUILT").route, "CAMPAIGN_ORCHESTRATOR");
assert.equal(report.classifications.find((entry) => entry.status === "NOT_BUILT").route, "CAMPAIGN_ORCHESTRATOR");
assert.equal(report.classifications.find((entry) => entry.status === "WAITING_FOR_OWNER_CHOICE").route, "OWNER");
assert.doesNotThrow(() => validateAuditorCompletenessReport(report, {featureMap, currentSourceCommit: sourceCommit, currentSourceTree: sourceTree}));

const staleMap = structuredClone(featureMap);
staleMap.source_commit = "b".repeat(40);
assert.throws(
  () => validateFeatureMap(staleMap, {currentSourceCommit: sourceCommit, currentSourceTree: sourceTree}),
  /source commit is stale/u,
);

const staleReport = structuredClone(report);
staleReport.source_tree = "c".repeat(40);
assert.throws(
  () => validateAuditorCompletenessReport(staleReport, {featureMap, currentSourceCommit: sourceCommit, currentSourceTree: sourceTree}),
  /source tree is stale/u,
);

const missingClassification = structuredClone(report);
missingClassification.classifications.pop();
assert.throws(
  () => validateAuditorCompletenessReport(missingClassification, {featureMap, currentSourceCommit: sourceCommit, currentSourceTree: sourceTree}),
  /cover every mapped feature/u,
);

const duplicateClassification = structuredClone(report);
duplicateClassification.classifications[1].feature_id = duplicateClassification.classifications[0].feature_id;
assert.throws(
  () => validateAuditorCompletenessReport(duplicateClassification, {featureMap, currentSourceCommit: sourceCommit, currentSourceTree: sourceTree}),
  /duplicates|UTF-8 sorted|unknown or missing/u,
);

const unknownClassification = structuredClone(report);
unknownClassification.classifications[0].feature_id = "FEATURE-UNKNOWN";
assert.throws(
  () => validateAuditorCompletenessReport(unknownClassification, {featureMap, currentSourceCommit: sourceCommit, currentSourceTree: sourceTree}),
  /unknown or missing/u,
);

const invalidStatus = structuredClone(report);
invalidStatus.classifications[0].status = "MAYBE";
assert.throws(
  () => validateAuditorCompletenessReport(invalidStatus, {featureMap, currentSourceCommit: sourceCommit, currentSourceTree: sourceTree}),
  /unknown feature status/u,
);

const missingEvidence = structuredClone(report);
missingEvidence.classifications[0].evidence = [];
assert.throws(
  () => validateAuditorCompletenessReport(missingEvidence, {featureMap, currentSourceCommit: sourceCommit, currentSourceTree: sourceTree}),
  /requires evidence/u,
);

for (const unsafeReference of [
  {field: "path", value: "/outside/project.txt"},
  {field: "path", value: "../outside/project.txt"},
  {field: "path", value: "private/notes.txt"},
  {field: "link", value: "chat/conversation.txt"},
  {field: "link", value: "https://example.invalid/reference"},
]) {
  const unsafe = structuredClone(report);
  unsafe.classifications[0].evidence[0][unsafeReference.field] = unsafeReference.value;
  assert.throws(
    () => validateAuditorCompletenessReport(unsafe, {featureMap, currentSourceCommit: sourceCommit, currentSourceTree: sourceTree}),
    /project-relative|leaves the project|private path|chat link|absolute link/u,
    `unsafe public ${unsafeReference.field} was accepted: ${unsafeReference.value}`,
  );
}

const hostileChatIdentity = [
  "Continue in chat:",
  "019fdcf9", "-5cba-", "7042", "-9404-", "54e905f696a8",
].join("");
for (const unsafeSummary of [
  ["See ", String.fromCharCode(47), "Users/private/project/token.txt"].join(""),
  "Authorization token: raw-value",
  hostileChatIdentity,
]) {
  const unsafe = structuredClone(report);
  unsafe.classifications[0].evidence[0].summary = unsafeSummary;
  assert.throws(
    () => validateAuditorCompletenessReport(unsafe, {featureMap, currentSourceCommit: sourceCommit, currentSourceTree: sourceTree}),
    /private|credential-like|chat-bound/u,
    `unsafe public evidence summary was accepted: ${unsafeSummary}`,
  );
}

const selfBuilder = structuredClone(report);
selfBuilder.work.builder_id = selfBuilder.auditor.auditor_id;
assert.throws(
  () => validateAuditorCompletenessReport(selfBuilder, {featureMap, currentSourceCommit: sourceCommit, currentSourceTree: sourceTree}),
  /cannot be the builder/u,
);

const selfAcceptor = structuredClone(report);
selfAcceptor.work.accepted_by = selfAcceptor.auditor.auditor_id;
assert.throws(
  () => validateAuditorCompletenessReport(selfAcceptor, {featureMap, currentSourceCommit: sourceCommit, currentSourceTree: sourceTree}),
  /cannot accept its own work/u,
);

const seed = compileAuditorSeed({
  seedId: "SEED-1",
  featureMap,
  sourceCommit,
  sourceTree,
  checkedEvidenceSha256: SHA,
});
assert.equal(seed.schema, AUDITOR_SEED_SCHEMA);
assert.equal(seed.check.status, "CHECKED");
assert.equal(seed.visibility, "CONTROL_SPACE");
assert.doesNotThrow(() => validateAuditorSeed(seed, {featureMap, currentSourceCommit: sourceCommit, currentSourceTree: sourceTree}));

const freshAuditor = createFreshAuditorBinding({
  seed,
  auditorId: "AUDITOR-FRESH-1",
  featureMap,
  currentSourceCommit: sourceCommit,
  currentSourceTree: sourceTree,
});
assert.equal(freshAuditor.schema, AUDITOR_SEED_BINDING_SCHEMA);
assert.equal(freshAuditor.fresh, true);
assert.equal(freshAuditor.seed_sha256, seed.seed_sha256);
assert.doesNotThrow(() => validateAuditorSeedBinding(freshAuditor, {seed, featureMap, currentSourceCommit: sourceCommit, currentSourceTree: sourceTree}));

const staleSeed = structuredClone(seed);
staleSeed.binding.source_tree = "d".repeat(40);
assert.throws(
  () => validateAuditorSeed(staleSeed, {featureMap, currentSourceCommit: sourceCommit, currentSourceTree: sourceTree}),
  /source tree is stale|seed binding differs/u,
);

const uncheckedSeed = structuredClone(seed);
uncheckedSeed.check.status = "UNCHECKED";
assert.throws(
  () => validateAuditorSeed(uncheckedSeed, {featureMap, currentSourceCommit: sourceCommit, currentSourceTree: sourceTree}),
  /must be CHECKED/u,
);

const detachedBinding = structuredClone(freshAuditor);
detachedBinding.seed_sha256 = "e".repeat(64);
assert.throws(
  () => validateAuditorSeedBinding(detachedBinding, {seed, featureMap, currentSourceCommit: sourceCommit, currentSourceTree: sourceTree}),
  /not created from this seed/u,
);

const inventoryFeatures = Array.from({length: 37}, (_, index) => {
  const number = String(index + 1).padStart(2, "0");
  return {feature_id: `FEATURE-${number}`, name: `Feature ${number}`, kind: "NAMED_CAPABILITY", sources: ["docs/roadmap.md"], report_path: `docs/feature-audits/FEATURE-${number}/auditreport.md`, auditor_task_id: null, worktree_id: null, status: "NOT_STARTED"};
});
const inventoryLanes = Array.from({length: 12}, (_, index) => {
  const number = String(index + 1).padStart(2, "0");
  return {lane_id: `LANE-${number}`, name: `Lane ${number}`, report_path: `docs/rapid-foundations/lane-${number}-auditreport.md`, auditor_task_id: `TASK-${number}`, worktree_id: `WORKTREE-${number}`, status: "AUDIT_IN_PROGRESS"};
});
const inventory = {
  schema: "governance.feature_inventory.v1",
  version: 1,
  contract_status: "PREPARED_NOT_ACTIVATED",
  authority: "CURRENT_ACCEPTED_MERGE",
  source_catalog: ["docs/roadmap.md", "docs/rapid-foundations/"],
  coverage_rule: "Each named capability receives one classification and report.",
  expected_feature_count: 37,
  expected_governance_lane_count: 12,
  expected_platform_lane_count: 0,
  expected_auditor_count: 49,
  expected_report_count: 49,
  expected_goal_count: 49,
  goal_rule: "Every capability and governance lane receives one persistent goal record.",
  features: inventoryFeatures,
  governance_lanes: inventoryLanes,
  platform_domains: [],
  platform_lanes: [],
  platform_phase: {platform_roster_source: "platform_lanes", required_outputs: ["feature_consumption_matrix", "source_bound_handoffs"], feature_admission: "PLATFORM_FOUNDATION_THEN_PLATFORM_INTEGRATION_THEN_FEATURE_AUDIT_REPAIR_THEN_CENTRAL_INTEGRATION"},
  parity: {feature_tasks_created: 37, feature_reports_present: 37, governance_tasks_created: 12, governance_reports_present: 12, platform_tasks_created: 0, platform_reports_present: 0, goal_records_compiled: 49, parity_status: "PARITY_UNVERIFIED_VISIBLE_TASK_GOAL_AND_REPORT_READBACK"},
};
assert.doesNotThrow(() => validateFeatureInventory(inventory));
const coverage = compileInventoryCoveragePlan({inventory, mapId: "MAP-INVENTORY", projectId: "PROJECT-1", campaignId: "CAMPAIGN-1", buildId: "BUILD-1", projectGovernanceSha256: SHA, sourceCommit, sourceTree});
assert.equal(coverage.plan.feature_count, 37);
assert.equal(coverage.plan.governance_lane_count, 12);
assert.equal(coverage.plan.report_count, 49);
assert.doesNotThrow(() => validateInventoryCoveragePlan(coverage.plan, {inventory, featureMap: coverage.featureMap}));

console.log("PASS whole-project feature completeness, independent Auditor classification, safe public evidence, routing, checked seed binding, and inventory parity");
