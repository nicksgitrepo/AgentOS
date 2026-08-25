#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const libraryRoot = path.join(root, "specialist-blocks");
const roster = JSON.parse(fs.readFileSync(path.join(libraryRoot, "registry/roster.v1.json"), "utf8"));

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function collectPackages(directory, result = new Map()) {
  for (const entry of fs.readdirSync(directory, {withFileTypes: true}).sort((left, right) => left.name.localeCompare(right.name))) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) collectPackages(absolute, result);
    else if (entry.isFile() && entry.name === "block.json") {
      const block = readJson(absolute);
      assert(!result.has(block.block_id), `duplicate package block_id: ${block.block_id}`);
      result.set(block.block_id, {block, directory: path.dirname(absolute)});
    }
  }
  return result;
}

function requiredFile(directory, relativePath, label) {
  const file = path.join(directory, relativePath);
  assert(fs.existsSync(file) && fs.statSync(file).isFile(), `${label} missing: ${relativePath}`);
  return file;
}

assert.equal(roster.schema, "agentos.specialist_roster.v1");
assert.equal(roster.version, 1);
assert.equal(roster.status, "COMPILED_CANDIDATE");
assert.equal(roster.activation, "OFF");
assert.equal(roster.blocks.length, 125);

const rosterIds = new Set();
for (const row of roster.blocks) {
  assert(!rosterIds.has(row.block_id), `duplicate roster block_id: ${row.block_id}`);
  rosterIds.add(row.block_id);
  assert.match(row.candidate_digest, /^[0-9a-f]{64}$/u, `${row.block_id} roster digest`);
}

const packages = collectPackages(libraryRoot);
assert.equal(packages.size, roster.blocks.length, "roster/package count mismatch");
const expectedGateIds = [
  "00-intake",
  "01-applicability",
  "02-authority-precedence",
  "03-scope-nongoals",
  "04-source-evidence-freshness",
  "05-context-completeness",
  "06-tool-resource-custody",
  "07-data-secret-privacy",
  "08-build-browser-runtime",
  "09-output-handoff",
  "10-proof-acceptance",
  "11-lifecycle-recovery-archive",
];

for (const row of roster.blocks) {
  const packageEntry = packages.get(row.block_id);
  assert(packageEntry, `roster package missing: ${row.block_id}`);
  const {block, directory} = packageEntry;
  assert.equal(block.schema, "agentos.specialist_block.v1", `${row.block_id} block schema`);
  assert.equal(block.version, 1, `${row.block_id} block version`);
  assert.equal(block.block_id, row.block_id, `${row.block_id} block identity`);
  assert.equal(block.block_sha256, row.candidate_digest, `${row.block_id} block digest`);
  assert.equal(block.role_kind, row.role_kind, `${row.block_id} role kind`);
  assert.equal(typeof row.family, "string", `${row.block_id} roster family`);
  assert.equal(block.family, row.family, `${row.block_id} family parity`);
  assert.equal(block.revision, "1.0.0", `${row.block_id} revision`);
  assert.equal(block.lifecycle, "CANDIDATE", `${row.block_id} lifecycle`);
  assert.equal(block.activation, "OFF", `${row.block_id} activation`);
  assert.equal(block.controls.secrets, "DENY", `${row.block_id} secret default`);
  assert.equal(block.controls.deploy, "DENY", `${row.block_id} deploy default`);
  assert.equal(block.controls.acceptance_authority, "INDEPENDENT_AUTHORITY_ONLY", `${row.block_id} acceptance authority`);
  assert.equal(block.controls.browser, "READ_ONLY_PRIMARY_SOURCES", `${row.block_id} browser default`);
  assert(["LOCAL_ISOLATED_CANDIDATE", "LOCAL_READ_ONLY", "DENY"].includes(block.controls.build), `${row.block_id} build default`);
  assert.equal(block.controls.communication, "TYPED_HANDOFF_ONLY", `${row.block_id} communication default`);
  assert.equal(block.authority.acceptance_authority, "INDEPENDENT_AUTHORITY_ONLY;_AUTHOR_CANNOT_SELF_ADMIT", `${row.block_id} authority boundary`);
  assert.equal(block.intake.context_schema, "schemas/specialist-context.v1.json", `${row.block_id} intake schema`);
  assert.equal(block.output.typed_schema, "schemas/specialist-output.v1.json", `${row.block_id} output schema`);
  assert.equal(typeof block.lifecycle_rules.candidate_entry, "string", `${row.block_id} lifecycle binding`);
  assert(["STATIC_PASS_REVIEW_REQUIRED", "UTILITY_HARM_PENDING"].includes(block.evaluation.disposition), `${row.block_id} evaluation disposition`);
  assert.equal(block.evaluation.independent_reviewer_required, true, `${row.block_id} independent review requirement`);
  assert.equal(block.evaluation.dossier_path, "evaluation.json", `${row.block_id} evaluation path`);
  assert.equal(block.gate_pack.manifest_path, "gates/manifest.json", `${row.block_id} gate manifest path`);
  assert.deepEqual(block.gate_pack.ordered_gate_ids, expectedGateIds, `${row.block_id} gate order`);

  for (const relativePath of ["block.json", "sources.lock", "evaluation.json", "handoff.json", "gates/manifest.json"]) {
    requiredFile(directory, relativePath, row.block_id);
  }
  if (row.role_kind === "STANDARD_BLOCK") {
    for (const relativePath of ["requirements.json", "compatibility.json", "supersession.json"]) {
      requiredFile(directory, relativePath, `${row.block_id} standard contract`);
    }
  }

  const evaluation = readJson(path.join(directory, "evaluation.json"));
  assert.equal(evaluation.schema, "agentos.specialist_evaluation.v1", `${row.block_id} evaluation schema`);
  assert.equal(evaluation.version, 1, `${row.block_id} evaluation version`);
  assert.equal(evaluation.block_id, row.block_id, `${row.block_id} evaluation identity`);
  assert.equal(evaluation.candidate_digest, row.candidate_digest, `${row.block_id} evaluation digest`);
  assert.equal(evaluation.cases.length, 17, `${row.block_id} evaluation case count`);
  assert.equal(evaluation.results.passed + evaluation.results.failed + evaluation.results.pending, evaluation.cases.length, `${row.block_id} evaluation result coverage`);
  assert.equal(evaluation.results.failed, 0, `${row.block_id} evaluation failures`);
  assert.deepEqual(Object.keys(evaluation.results).sort(), ["failed", "passed", "pending"], `${row.block_id} evaluation result keys`);

  const handoff = readJson(path.join(directory, "handoff.json"));
  assert.equal(handoff.schema, "agentos.specialist_handoff.v1", `${row.block_id} handoff schema`);
  assert.equal(handoff.version, 1, `${row.block_id} handoff version`);
  assert.equal(handoff.block_id, row.block_id, `${row.block_id} handoff identity`);
  assert.equal(handoff.candidate_digest, row.candidate_digest, `${row.block_id} handoff digest`);
  assert.match(handoff.authority, /ISOLATED_CANDIDATE_ONLY;_NO_ACTIVATION_OR_ADMISSION/u, `${row.block_id} handoff authority`);
  assert.equal(handoff.disposition, "WAITING_WITH_RECEIPT", `${row.block_id} handoff disposition`);
  assert(handoff.residuals.some((residual) => /independent utility\/harm evaluation/u.test(residual)), `${row.block_id} handoff external review residual`);

  const gateManifest = readJson(path.join(directory, "gates/manifest.json"));
  assert.equal(gateManifest.schema, "agentos.specialist_gate_manifest.v1", `${row.block_id} gate manifest schema`);
  assert.deepEqual(gateManifest.ordered_gate_ids, expectedGateIds, `${row.block_id} manifest order`);
  assert.equal(gateManifest.gate_paths.length, 12, `${row.block_id} gate path count`);
  for (const gatePath of gateManifest.gate_paths) {
    const gate = requiredFile(directory, gatePath, `${row.block_id} gate`);
    assert(fs.readFileSync(gate, "utf8").trim().length > 0, `${row.block_id} empty gate: ${gatePath}`);
  }

  const fixtureDirectory = path.join(directory, "fixtures");
  const fixtureFiles = fs.readdirSync(fixtureDirectory).filter((entry) => entry.endsWith(".json")).sort();
  assert.equal(fixtureFiles.length, 17, `${row.block_id} fixture count`);
  const fixtureClasses = new Set();
  for (const fixtureFile of fixtureFiles) {
    const fixture = readJson(path.join(fixtureDirectory, fixtureFile));
    assert.equal(fixture.schema, "agentos.specialist_fixture.v1", `${row.block_id}/${fixtureFile} fixture schema`);
    assert.equal(fixture.version, 1, `${row.block_id}/${fixtureFile} fixture version`);
    assert.equal(fixture.block_id, row.block_id, `${row.block_id}/${fixtureFile} fixture identity`);
    assert.equal(typeof fixture.class, "string", `${row.block_id}/${fixtureFile} fixture class`);
    assert.equal(typeof fixture.hostile, "boolean", `${row.block_id}/${fixtureFile} hostile flag`);
    fixtureClasses.add(fixture.class);
  }
  assert.equal(fixtureClasses.size, 17, `${row.block_id} fixture classes must be unique`);
}

console.log(`PASS specialist package completeness: ${roster.blocks.length} roster rows, ${packages.size} packages, 12 gates and 17 hostile fixtures per package, lifecycle CANDIDATE/OFF`);
