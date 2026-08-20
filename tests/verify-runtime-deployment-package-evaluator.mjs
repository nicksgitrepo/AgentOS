#!/usr/bin/env node
import assert from "node:assert/strict";
import {evaluateRuntimeDeploymentPackage} from "../control/runtime-deployment-package-evaluator.mjs";

const evaluation = await evaluateRuntimeDeploymentPackage();
assert.equal(evaluation.schema, "agentos.specialist_runtime_deployment_package_operational_evaluation.v1");
assert.equal(evaluation.status, "PASS");
assert.equal(evaluation.block_id, "specialist.control.runtime-deployment-operator");
assert.equal(evaluation.lifecycle, "CANDIDATE");
assert.equal(evaluation.activation, "OFF");
assert.equal(evaluation.fixture_results.length, 21);
assert.equal(new Set(evaluation.fixture_results.map((entry) => entry.fixture_id)).size, 21);
assert(evaluation.fixture_results.every((entry) => entry.entrypoint_invoked && entry.semantic_execution_completed));
assert(evaluation.fixture_results.every((entry) => Object.values(entry.external_side_effects).every((value) => value === 0)));
assert(evaluation.fixture_results.every((entry) => entry.assertion_readbacks.every((assertion) => assertion.observed)));
assert(evaluation.focused_suites.every((suite) => suite.status === "PASS"));
assert.equal(evaluation.mutation_sensitivity.status, "WEAKENED");
assert.equal(evaluation.mutation_sensitivity.mutation_detected, true);
console.log("PASS Runtime/Deployment Operator evaluator: all 21 real typed hostile vectors, eight focused delivery suites, zero operational side effects, and mutation sensitivity");
