#!/usr/bin/env node

import assert from "node:assert/strict";
import {evaluateIntentRegulatorPackage} from "../control/intent-regulator-package-evaluator.mjs";

const receipt = await evaluateIntentRegulatorPackage();
assert.equal(receipt.status, "PASS");
assert.equal(receipt.lifecycle, "CANDIDATE");
assert.equal(receipt.activation, "OFF");
assert.equal(receipt.fixture_results.length, 17);
assert.equal(receipt.gate_execution.length, 12);
assert.equal(receipt.mutation_sensitivity.mutation_detected, true);
assert.equal(receipt.fixture_results.filter((result) => result.actual_outcome === "ROUTE").length, 3);
assert.equal(receipt.fixture_results.filter((result) => result.actual_outcome === "ESCALATE").length, 2);
assert.equal(receipt.fixture_results.filter((result) => result.actual_outcome === "DENY").length, 12);
process.stdout.write(JSON.stringify({status: "PASS", block_id: receipt.block_id, fixtures: receipt.fixture_results.length, gates: receipt.gate_execution.length, mutation_detected: receipt.mutation_sensitivity.mutation_detected}) + "\n");
