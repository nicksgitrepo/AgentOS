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
assert.equal(receipt.packages_checked, 32);
assert.equal(receipt.gate_files_checked, 32 * 12);
assert.equal(receipt.hostile_fixtures_checked, 32 * 17);
assert(receipt.results.every((result) => result.status === "PASS" && result.independent_utility_harm === "PENDING_EXTERNAL_AUTHORITY"));
assert.equal(fs.readFileSync(path.join(root, "specialist-blocks/registry/roster.v1.json"), "utf8"), before, "independent evaluator must be read-only");
console.log("PASS independent specialist evaluator: 32 inactive packages, 384 gate files, 544 hostile fixtures, reusable standard digest checks, atomicity denial, self-admission denial, and read-only receipt");
