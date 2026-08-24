#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {independentlyEvaluateSpecialistLibrary} from "../control/specialist-independent-evaluator.mjs";

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
fs.writeFileSync(path.join(tempRosterDir, "roster.v1.json"), JSON.stringify({schema: "agentos.specialist_roster.v1", version: 1, status: "COMPILED_CANDIDATE", activation: "OFF", roster_sha256: "0".repeat(64), blocks: [{block_id: sourceBlock.block_id}]}, null, 2) + "\n");
try {
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
