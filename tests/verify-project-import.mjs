#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {compileStandardsRegistry} from "../control/standards-registry.mjs";
import {compileNormalizationPolicy} from "../control/normalization-policy.mjs";
import {
  compileProjectImportPlan,
  compileSourcePreservationPlan,
  compilePyramidImportOutput,
  validatePyramidImportOutput,
  compileGitRepointPlan,
  validateGitRepointPlan,
  canonicalDigest,
  inspectProjectSource,
  preserveProjectSource,
  recommendProjectImportMode,
  validateProjectImportPlan,
  verifySourcePreservation,
} from "../control/project-import.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-project-import-"));
const source = path.join(root, "source");
const destination = path.join(root, "destination");
const preservation = path.join(destination, ".agentos", "import");
fs.mkdirSync(path.join(source, "src"), {recursive: true});
fs.mkdirSync(path.join(source, "dist"), {recursive: true});
fs.mkdirSync(destination, {recursive: true});
fs.writeFileSync(path.join(source, "src", "main.js"), "export const value = 1;\n");
fs.writeFileSync(path.join(source, "README.md"), "synthetic source\n");
fs.writeFileSync(path.join(source, ".env"), "TOKEN=not-an-archive-value\n");
fs.writeFileSync(path.join(source, "settings.json"), "{\"password\":\"abcd\"}\n");
fs.writeFileSync(path.join(source, "dist", "generated.js"), "generated\n");
fs.writeFileSync(path.join(source, "scratch.tmp"), "temporary\n");
const before = inspectProjectSource(source);
const standards = compileStandardsRegistry();
const normalization = compileNormalizationPolicy({importMode: "NORMALIZE_AND_AUDIT"});
const projectId = "SYNTHETIC_IMPORT_PROJECT";
const plan = compileProjectImportPlan({
  projectId,
  mode: "NORMALIZE_AND_AUDIT",
  sourceRoot: source,
  destinationRoot: destination,
  sourcePreservationRoot: preservation,
  discoveryFacts: [{fact_id: "project.marker.package.json", status: "OBSERVED_FACT"}],
  standardsRegistry: standards,
  normalizationPolicy: normalization,
});
const repeated = compileProjectImportPlan({
  projectId,
  mode: "NORMALIZE_AND_AUDIT",
  sourceRoot: source,
  destinationRoot: destination,
  sourcePreservationRoot: preservation,
  discoveryFacts: [{fact_id: "project.marker.package.json", status: "OBSERVED_FACT"}],
  standardsRegistry: standards,
  normalizationPolicy: normalization,
});
assert.deepEqual(plan, repeated, "project import plan is not deterministic");
assert.deepEqual(plan.phases, ["PRESERVE_SOURCE", "BASELINE_EXISTING_PROJECT", "COPY_ALLOWED_SOURCE", "NORMALIZE_STRUCTURE_AND_NAMES", "CONTROLLER_PROJECT_DISCOVERY_AND_CAMPAIGN_PLANNING", "CONTROLLER_DERIVED_AUDIT_REPAIR_PYRAMID", "PLATFORM_AND_CENTRAL_INTEGRATION", "INDEPENDENT_REAUDIT", "MATERIALIZE_NEW_PROJECT_REPOSITORIES", "PREPARE_GIT_REPOINT", "CUTOVER_OR_ROLLBACK"]);
assert.deepEqual(plan.audit.lanes.map((lane) => lane.discipline), ["FUNCTIONALITY", "DESIGN_UI_SHELL_NAVIGATION", "SECURITY", "CODE_QUALITY_HYGIENE"]);
assert(plan.audit.lanes.every((lane) => lane.disposition === "REQUIRED" && lane.writer === "NONE_READ_ONLY"));
assert.equal(plan.audit.lanes_are_minimum_coverage_not_roster, true);
assert.equal(plan.audit.maximum_parallel_lanes, 6);
assert.equal(plan.controller_planning.authority, "AGENTOS_CONTROLLER");
assert.equal(plan.controller_planning.fixed_project_roster_forbidden, true);
assert.equal(plan.controller_planning.routine_transition, "AUTOMATIC_EVENT_DRIVEN");
assert.equal(plan.controller_planning.seed_rule, "SEEDS_NEVER_WORK");
assert.equal(plan.pyramid_output.output_kind, "NEW_PROJECT_REPOSITORIES");
assert.equal(plan.pyramid_output.legacy_policy, "PRESERVE_OLD_REPOSITORIES_UNTOUCHED_AS_LEGACY_READ_ONLY_EVIDENCE");
assert.equal(plan.pyramid_output.git_repoint_executor, "RUNTIME_ONLY_ATOMIC_REPOINT_AFTER_SOURCE_AND_CANDIDATE_RECHECK");
assert.equal(plan.cutover.target, "NEW_PROJECT_REPOSITORIES");
assert.equal(plan.cutover.legacy_repository_policy, "RETAIN_OLD_REPOSITORIES_UNTOUCHED");
validateProjectImportPlan(plan);
assert.equal(plan.universal_closeout.mode, "IMPORT");
assert.equal(plan.universal_closeout.archive_is_dynamic, true);
assert.deepEqual(plan.universal_closeout.sequence, [
  "PRESERVE_HANDOFF", "PERSIST_HANDOFF", "AUDIT_CANDIDATE", "INTEGRATE_ACCEPTED_WORK",
  "UNPIN_SESSION", "CLOSE_STALE_WORKTREE", "REMOVE_ACTIVE_TASK_SCOPE", "MARK_CHAT_OUT_OF_SCOPE",
  "ARCHIVE_VISIBLE_TASK",
]);

for (const mode of ["ADOPT_IN_PLACE", "CLEAN_COPY", "RECONSTRUCT_FROM_INTENT"]) {
  const modeDestination = mode === "ADOPT_IN_PLACE" ? null : path.join(root, `${mode.toLowerCase()}-destination`);
  const modePolicy = compileNormalizationPolicy({importMode: mode});
  const modePlan = compileProjectImportPlan({
    projectId,
    mode,
    sourceRoot: source,
    destinationRoot: modeDestination,
    standardsRegistry: standards,
    normalizationPolicy: modePolicy,
  });
  validateProjectImportPlan(modePlan);
  assert.equal(modePlan.audit.full_audit_required, ["NORMALIZE_AND_AUDIT", "RECONSTRUCT_FROM_INTENT"].includes(mode));
}

const sourcePlan = compileSourcePreservationPlan(source, preservation);
const sourcePlanRepeat = compileSourcePreservationPlan(source, preservation);
assert.equal(sourcePlan.archive_sha256, sourcePlanRepeat.archive_sha256);
assert.equal(sourcePlan.manifest_sha256, sourcePlanRepeat.manifest_sha256);
assert.equal(sourcePlan.index_sha256, sourcePlanRepeat.index_sha256);
assert.equal(sourcePlan.exclusions_sha256, sourcePlanRepeat.exclusions_sha256);
const preserved = preserveProjectSource(source, preservation, "2026-08-03T00:00:00.000Z");
assert.equal(preserved.verification.status, "VERIFIED_EXACT");
assert.equal(preserved.verification.excluded_paths, 5);
assert.deepEqual(inspectProjectSource(source), before, "source changed during preservation");
assert.equal(verifySourcePreservation(preservation).status, "VERIFIED_EXACT");
assert(fs.readFileSync(path.join(preservation, "import-exclusions.md"), "utf8").includes(".env"));
assert(fs.readFileSync(path.join(preservation, "import-exclusions.md"), "utf8").includes("dist"));
assert(fs.readFileSync(path.join(preservation, "import-exclusions.md"), "utf8").includes("settings.json"));

const pyramidOutput = compilePyramidImportOutput({
  projectId,
  sourceIdentity: before,
  preservationRef: "opaque:preservation/synthetic-import",
  preservationReceiptSha256: preserved.receipt.receipt_sha256,
  candidateRepositories: [{
    repository_id: "main",
    source_repository_ids: ["synthetic-source"],
    source_mapping_sha256: canonicalDigest({source: "synthetic-source-mapping"}),
    repository_ref: "opaque:repository/synthetic-main",
    branch_ref: "refs/heads/agentos/import-candidate",
    commit: "3".repeat(40),
    tree: "4".repeat(40),
    candidate_sha256: canonicalDigest({candidate: "synthetic-main"}),
    source_content_sha256: before.source_content_sha256,
    source_observation_sha256: before.source_observation_sha256,
    pyramid_candidate_sha256: canonicalDigest({pyramid: "synthetic-main"}),
    rollback_ref: "opaque:rollback/synthetic-main",
    clean: true,
    status: "INDEPENDENT_REAUDITED_CANDIDATE",
  }],
  sourceCoverage: (() => {
    const coverage = {
      required_repository_ids: ["synthetic-source"],
      candidate_source_repository_ids: ["synthetic-source"],
      opaque_exclusion_repository_ids: [],
      source_mapping_sha256: canonicalDigest({source: "synthetic-source-mapping"}),
      coverage_sha256: null,
    };
    coverage.coverage_sha256 = canonicalDigest({...coverage, coverage_sha256: null});
    return coverage;
  })(),
  pyramid: {
    specialist_audit_repair_sha256: canonicalDigest({stage: "specialist"}),
    platform_review_sha256: canonicalDigest({stage: "platform"}),
    central_integration_sha256: canonicalDigest({stage: "central"}),
    independent_reaudit_sha256: canonicalDigest({stage: "reaudit"}),
    audit_repair_complete: true,
    platform_review_complete: true,
    central_integration_complete: true,
    independent_reaudit_complete: true,
    wave_count: 1,
  },
  rollbackRef: "opaque:rollback/synthetic-import",
});
validatePyramidImportOutput(pyramidOutput);
assert.equal(pyramidOutput.status, "READY_FOR_GIT_REPOINT");
assert.equal(pyramidOutput.legacy.retention, "LEGACY_REPOSITORY_UNTOUCHED");
assert.equal(pyramidOutput.git_repoint.next_action, "WAIT_FOR_GIT_REPOINT_AUTHORIZATION");
const incompleteCoverage = structuredClone(pyramidOutput);
incompleteCoverage.source_coverage.required_repository_ids = ["different-source"];
incompleteCoverage.source_coverage.candidate_source_repository_ids = ["different-source"];
incompleteCoverage.source_coverage.coverage_sha256 = canonicalDigest({...incompleteCoverage.source_coverage, coverage_sha256: null});
incompleteCoverage.output_sha256 = canonicalDigest({...incompleteCoverage, output_sha256: null});
assert.throws(() => validatePyramidImportOutput(incompleteCoverage), /candidate repositories do not cover|source coverage does not account/u);
const repointPlan = compileGitRepointPlan({output: pyramidOutput, targetProjectRef: "opaque:project/synthetic-import"});
validateGitRepointPlan(repointPlan);
assert.equal(repointPlan.execution_allowed, false);
assert.equal(repointPlan.next_action, "WAIT_FOR_GIT_REPOINT_AUTHORIZATION");
const authorizedRepoint = compileGitRepointPlan({
  output: pyramidOutput,
  targetProjectRef: "opaque:project/synthetic-import",
  authorizationRef: "opaque:authorization/synthetic-cutover",
});
assert.equal(authorizedRepoint.status, "AUTHORIZED_PENDING_RUNTIME_EXECUTION");
assert.equal(authorizedRepoint.next_action, "RUNTIME_ATOMIC_GIT_REPOINT");
assert.equal(authorizedRepoint.execution_allowed, false);
const outputTamper = structuredClone(pyramidOutput);
outputTamper.legacy.untouched = false;
outputTamper.output_sha256 = canonicalDigest({...outputTamper, output_sha256: null});
assert.throws(() => validatePyramidImportOutput(outputTamper), /immutable, untouched, and read-only/u);

const recommendation = recommendProjectImportMode([{fact_id: "authority-corpus.candidate.docs", status: "OBSERVED_FACT"}]);
assert.equal(recommendation.recommended_mode, "NORMALIZE_AND_AUDIT");
assert.equal(recommendation.status, "CANDIDATE_ONLY");
assert.throws(() => compileProjectImportPlan({
  projectId,
  mode: "NORMALIZE_AND_AUDIT", sourceRoot: source, destinationRoot: source,
  standardsRegistry: standards, normalizationPolicy: normalization,
}), /separate non-overlapping roots/u);
assert.throws(() => compileProjectImportPlan({
  projectId,
  mode: "NORMALIZE_AND_AUDIT", sourceRoot: source, destinationRoot: destination,
  sourcePreservationRoot: path.join(source, ".agentos", "import"),
  standardsRegistry: standards, normalizationPolicy: normalization,
}), /cannot be inside the imported source/u);
assert.throws(() => compileProjectImportPlan({
  projectId,
  mode: "NORMALIZE_AND_AUDIT", sourceRoot: source, destinationRoot: destination,
  sourcePreservationRoot: path.join(root, "unrelated-preservation"),
  standardsRegistry: standards, normalizationPolicy: normalization,
}), /must remain inside the destination project/u);

const symlinkSource = path.join(root, "symlink-source");
fs.mkdirSync(symlinkSource);
fs.writeFileSync(path.join(symlinkSource, "real.txt"), "real\n");
fs.symlinkSync(path.join(source, "README.md"), path.join(symlinkSource, "linked.txt"));
assert.throws(() => inspectProjectSource(symlinkSource), /unsafe filesystem entry/u);

const tampered = structuredClone(plan);
tampered.source_remains_unchanged_until_cutover = false;
delete tampered.plan_sha256;
tampered.plan_sha256 = "0".repeat(64);
assert.throws(() => validateProjectImportPlan(tampered), /permits source mutation/u);

const laneTamper = structuredClone(plan);
laneTamper.audit.full_audit_required = false;
delete laneTamper.plan_sha256;
laneTamper.plan_sha256 = canonicalDigest(laneTamper);
assert.throws(() => validateProjectImportPlan(laneTamper), /full-audit converse/u);

fs.rmSync(root, {recursive: true, force: true});
console.log("PASS AgentOS Project Import (four modes, Controller-derived campaign handoff, source preservation, exclusions, deterministic output, path containment, symlink rejection, rollback, and hostile coverage)");
