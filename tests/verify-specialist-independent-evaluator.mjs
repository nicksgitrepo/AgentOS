#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {independentlyEvaluateSpecialistLibrary} from "../control/specialist-independent-evaluator.mjs";
import {canonicalDigest} from "../control/specialist-block-compiler.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const before = fs.readFileSync(path.join(root, "specialist-blocks/registry/roster.v1.json"), "utf8");
const receipt = independentlyEvaluateSpecialistLibrary({repositoryRoot: root});
assert.equal(receipt.schema, "agentos.independent_specialist_evaluation_receipt.v1");
assert.equal(receipt.status, "STATIC_PASS_REVIEW_REQUIRED");
assert.equal(receipt.self_acceptance, "FORBIDDEN");
assert.equal(receipt.packages_checked, 123);
assert.equal(receipt.gate_files_checked, 123 * 12);
assert.equal(receipt.hostile_fixtures_checked, 123 * 17);
assert(receipt.results.every((result) => result.status === "PASS" && result.independent_utility_harm === "PENDING_EXTERNAL_AUTHORITY"));
assert.equal(fs.readFileSync(path.join(root, "specialist-blocks/registry/roster.v1.json"), "utf8"), before, "independent evaluator must be read-only");

const tempParent = path.resolve(root, "../../..", "Temp");
const mutationRoot = fs.mkdtempSync(path.join(tempParent, "agentos-independent-evaluator-"));
const sourcePackage = path.join(root, "specialist-blocks/foundation/authority-jurisdiction-gate");
const tempPackage = path.join(mutationRoot, "specialist-blocks/foundation/authority-jurisdiction-gate");
fs.cpSync(sourcePackage, tempPackage, {recursive: true});
const tempRosterDir = path.join(mutationRoot, "specialist-blocks/registry");
fs.mkdirSync(tempRosterDir, {recursive: true});
const sourceBlock = JSON.parse(fs.readFileSync(path.join(sourcePackage, "block.json"), "utf8"));
const canonicalRoster = JSON.parse(fs.readFileSync(path.join(root, "specialist-blocks/registry/roster.v1.json"), "utf8"));
const sourceRow = canonicalRoster.blocks.find((row) => row.block_id === sourceBlock.block_id);
assert(sourceRow, "independent evaluator hostile test source row is missing");
const makeRoster = (rows) => {
  const roster = {
    schema: canonicalRoster.schema,
    version: canonicalRoster.version,
    status: canonicalRoster.status,
    governance_version: canonicalRoster.governance_version,
    blocks: structuredClone(rows),
    aliases: [],
    routing_index: canonicalRoster.routing_index,
    activation: canonicalRoster.activation,
    roster_sha256: null,
  };
  roster.roster_sha256 = canonicalDigest({...roster, roster_sha256: null});
  return roster;
};
const baselineRoster = makeRoster([sourceRow]);
const writeRoster = (roster) => fs.writeFileSync(path.join(tempRosterDir, "roster.v1.json"), JSON.stringify(roster, null, 2) + "\n");
writeRoster(baselineRoster);
try {
  const expectRosterFailure = (mutate, expectedMessage, {recomputeDigest = false} = {}) => {
    const mutatedRoster = structuredClone(baselineRoster);
    mutate(mutatedRoster);
    if (recomputeDigest) mutatedRoster.roster_sha256 = canonicalDigest({...mutatedRoster, roster_sha256: null});
    writeRoster(mutatedRoster);
    assert.throws(() => independentlyEvaluateSpecialistLibrary({repositoryRoot: mutationRoot}), expectedMessage);
    writeRoster(baselineRoster);
  };
  expectRosterFailure((roster) => { roster.blocks[0].status = "ADMITTED"; }, /roster self digest mismatch/u);
  expectRosterFailure((roster) => { roster.blocks[0].status = "ADMITTED"; }, /roster status mismatch/u, {recomputeDigest: true});
  expectRosterFailure((roster) => { roster.blocks[0].lifecycle = "ADMITTED"; }, /roster lifecycle mismatch/u, {recomputeDigest: true});
  expectRosterFailure((roster) => { roster.blocks[0].activation = "ON"; }, /roster activation mismatch/u, {recomputeDigest: true});
  expectRosterFailure((roster) => { roster.blocks[0].candidate_digest = "f".repeat(64); }, /roster candidate digest mismatch/u, {recomputeDigest: true});
  const expectMutationFailure = (relativePath, mutate, expectedMessage) => {
    const filePath = path.join(tempPackage, relativePath);
    const original = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const mutated = structuredClone(original);
    mutate(mutated);
    fs.writeFileSync(filePath, JSON.stringify(mutated, null, 2) + "\n");
    assert.throws(() => independentlyEvaluateSpecialistLibrary({repositoryRoot: mutationRoot}), expectedMessage);
    fs.writeFileSync(filePath, JSON.stringify(original, null, 2) + "\n");
  };
  expectMutationFailure("block.json", (block) => { block.controls.deploy = "ALLOW"; }, /block digest mismatch/u);
  expectMutationFailure("fixtures/authority_conflict.json", (fixture) => { fixture.hostile = false; }, /fixture is not marked hostile/u);
  expectMutationFailure("gates/00-intake.gate", (gate) => { gate.allowed_outcomes = ["YES"]; }, /outcomes mismatch/u);
} finally {
  fs.rmSync(mutationRoot, {recursive: true, force: true});
}
console.log("PASS independent specialist evaluator: 123 inactive packages, 1476 gate files, 2091 hostile fixtures, reusable standard digest checks, dependency closure, atomicity denial, self-admission denial, and read-only receipt");
