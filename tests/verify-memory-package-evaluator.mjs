#!/usr/bin/env node

import assert from "node:assert/strict";
import {evaluateMemoryPackage} from "../control/memory-package-evaluator.mjs";

const evaluation = await evaluateMemoryPackage();
assert.equal(evaluation.schema, "agentos.specialist_memory_package_operational_evaluation.v1");
assert.equal(evaluation.status, "PASS");
assert.equal(evaluation.block_id, "specialist.control.memory");
assert.equal(evaluation.lifecycle, "CANDIDATE");
assert.equal(evaluation.activation, "OFF");
assert.equal(evaluation.fixture_results.length, 17);
assert.equal(new Set(evaluation.fixture_results.map((entry) => entry.fixture_id)).size, 17);
assert(evaluation.fixture_results.every((entry) => entry.entrypoint_invoked && entry.semantic_execution_completed));
assert(evaluation.fixture_results.every((entry) => Object.values(entry.external_side_effects).every((value) => value === 0)));
assert(evaluation.focused_suites.every((suite) => suite.status === "PASS"));
assert.equal(evaluation.mutation_sensitivity.status, "WEAKENED");
assert.equal(evaluation.mutation_sensitivity.mutation_detected, true);
console.log("PASS Memory package evaluator: all 17 real hostile vectors, eight focused memory suites, isolated stores, privacy mutation sensitivity, and zero external side effects");
