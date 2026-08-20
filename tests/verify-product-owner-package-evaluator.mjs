#!/usr/bin/env node

import assert from "node:assert/strict";
import {evaluateProductOwnerPackage} from "../control/product-owner-package-evaluator.mjs";

const evaluation = await evaluateProductOwnerPackage();
assert.equal(evaluation.schema, "agentos.permanent_role_package_evaluation.v1");
assert.equal(evaluation.status, "PASS");
assert.equal(evaluation.role_id, "AGENTOS.PRODUCT_OWNER");
assert.equal(evaluation.fixture_results.length, 17);
assert.equal(new Set(evaluation.fixture_results.map((entry) => entry.fixture_id)).size, 17);
assert(evaluation.fixture_results.every((entry) => entry.entrypoint_invoked && entry.semantic_execution_completed));
assert(evaluation.fixture_results.every((entry) => entry.actual_outcome === entry.expected_outcome && entry.actual_route === entry.expected_route));
assert(evaluation.fixture_results.every((entry) => entry.assertion_readbacks.every((assertion) => assertion.observed)));
assert(evaluation.fixture_results.every((entry) => Object.values(entry.side_effect_spy_readback).every((value) => value === 0)));
assert.equal(evaluation.mutation_sensitivity.status, "WEAKENED");
assert.equal(evaluation.mutation_sensitivity.mutation_detected, true);
console.log("PASS Product Owner package evaluator: all 17 real hostile vectors execute with expected routes, zero side effects, and mutation sensitivity");
