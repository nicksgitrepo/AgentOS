#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {independentlyEvaluateSpecialistLibrary} from "../control/specialist-independent-evaluator.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-independent-evaluator-recheck-"));

try {
  fs.cpSync(root, temporaryRoot, {recursive: true});
  const laterBlockPath = path.join(temporaryRoot, "specialist-blocks/wave-06/search-router/block.json");
  const laterBlock = JSON.parse(fs.readFileSync(laterBlockPath, "utf8"));
  laterBlock.block_sha256 = "0".repeat(64);
  fs.writeFileSync(laterBlockPath, `${JSON.stringify(laterBlock, null, 2)}\n`, "utf8");

  const receipt = independentlyEvaluateSpecialistLibrary({repositoryRoot: temporaryRoot});
  assert.equal(receipt.status, "NEW_FINDINGS_RECHECKED");
  assert.equal(receipt.new_findings.length, 1);
  assert.equal(receipt.new_findings[0].block_id, "specialist.ai.search-router");
  assert.equal(receipt.new_findings[0].defect_code, "INDEPENDENT_EVALUATION_FAILED");
  assert.equal(receipt.regression_recheck.trigger, "ANY_NEW_FINDING");
  assert.equal(receipt.regression_recheck.policy, "RECHECK_ALL_EARLIER_NON_ARCHIVED_PACKAGES");
  assert.equal(receipt.regression_recheck.status, "PASS");
  assert(receipt.regression_recheck.packages.some((item) => item.block_id === "specialist.ai.search-rag" && item.status === "PASS"));
  assert(!receipt.regression_recheck.packages.some((item) => item.block_id === "specialist.ai.search-router"), "the newly failing package is not an earlier-package recheck");
  assert(receipt.residuals.some((item) => item.includes("new evaluator finding blocks acceptance")));
} finally {
  fs.rmSync(temporaryRoot, {recursive: true, force: true});
}

console.log("PASS independent evaluator regression recheck: later defect reported, earlier packages rechecked, acceptance blocked");
