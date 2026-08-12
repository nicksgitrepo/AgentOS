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
const specialistRosterSha256 = "a".repeat(64);
const plan = compileProjectImportPlan({
  projectId,
  mode: "NORMALIZE_AND_AUDIT",
  sourceRoot: source,
  destinationRoot: destination,
  sourcePreservationRoot: preservation,
  discoveryFacts: [{fact_id: "project.marker.package.json", status: "OBSERVED_FACT"}],
  standardsRegistry: standards,
  normalizationPolicy: normalization,
  specialistRosterSha256,
  discoveredStandardIds: ["RUST_STYLE_CURRENT"],
  ownerDeclaredStandardIds: ["ISO_IEC_25010"],
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
  specialistRosterSha256,
  discoveredStandardIds: ["RUST_STYLE_CURRENT"],
  ownerDeclaredStandardIds: ["ISO_IEC_25010"],
});
assert.deepEqual(plan, repeated, "project import plan is not deterministic");
assert.equal(plan.phases[0], "PRESERVE_SOURCE");
assert(plan.phases.includes("RUN_SOURCE_FRESHNESS_AND_APPLICABILITY_GATES"));
assert(plan.phases.includes("BUILD_CLAUSE_REQUIREMENTS_TRACEABILITY"));
assert(plan.phases.includes("RUN_REQUIRED_DEPLOYED_REAL_USE_PROOF"));
assert.equal(plan.phases.at(-1), "CUTOVER_OR_ROLLBACK");
assert.equal(plan.audit_first_procedure.custody.maximum_concurrent_repair_clones, 6);
assert.deepEqual(plan.audit_first_procedure.standards_inventory.map((entry) => entry.standard_id), [...new Set([...standards.required_standard_ids, "ISO_IEC_25010", "RUST_STYLE_CURRENT"])].sort());
assert.deepEqual(plan.audit.lanes.map((lane) => lane.discipline), ["FUNCTIONALITY", "DESIGN_UI_SHELL_NAVIGATION", "SECURITY", "CODE_QUALITY_HYGIENE"]);
assert(plan.audit.lanes.every((lane) => lane.disposition === "REQUIRED" && lane.writer === "NONE_READ_ONLY"));
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
    specialistRosterSha256: ["NORMALIZE_AND_AUDIT", "RECONSTRUCT_FROM_INTENT"].includes(mode) ? specialistRosterSha256 : null,
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

const recommendation = recommendProjectImportMode([{fact_id: "authority-corpus.candidate.docs", status: "OBSERVED_FACT"}]);
assert.equal(recommendation.recommended_mode, "NORMALIZE_AND_AUDIT");
assert.equal(recommendation.status, "CANDIDATE_ONLY");
assert.throws(() => compileProjectImportPlan({
  projectId,
  mode: "NORMALIZE_AND_AUDIT", sourceRoot: source, destinationRoot: source,
  standardsRegistry: standards, normalizationPolicy: normalization,
  specialistRosterSha256,
}), /separate non-overlapping roots/u);
assert.throws(() => compileProjectImportPlan({
  projectId,
  mode: "NORMALIZE_AND_AUDIT", sourceRoot: source, destinationRoot: destination,
  sourcePreservationRoot: path.join(source, ".agentos", "import"),
  standardsRegistry: standards, normalizationPolicy: normalization,
  specialistRosterSha256,
}), /cannot be inside the imported source/u);
assert.throws(() => compileProjectImportPlan({
  projectId,
  mode: "NORMALIZE_AND_AUDIT", sourceRoot: source, destinationRoot: destination,
  sourcePreservationRoot: path.join(root, "unrelated-preservation"),
  standardsRegistry: standards, normalizationPolicy: normalization,
  specialistRosterSha256,
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
console.log("PASS AgentOS Project Import (four modes controller, source preservation, exclusions, deterministic output, path containment, symlink rejection, rollback, and hostile coverage)");
