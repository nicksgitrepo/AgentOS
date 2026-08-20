#!/usr/bin/env node
import assert from "node:assert/strict";
import {evaluateSchedulerResourcePackage} from "../control/scheduler-resource-package-evaluator.mjs";

const evaluation = await evaluateSchedulerResourcePackage();
assert.equal(evaluation.schema, "agentos.specialist_scheduler_resource_package_operational_evaluation.v1");
assert.equal(evaluation.status, "PASS");
assert.equal(evaluation.block_id, "specialist.control.resource-scheduler");
assert.equal(evaluation.lifecycle, "CANDIDATE");
assert.equal(evaluation.activation, "OFF");
assert.equal(evaluation.fixture_results.length, 18);
assert.equal(new Set(evaluation.fixture_results.map((entry) => entry.fixture_id)).size, 18);
assert(evaluation.fixture_results.every((entry) => entry.entrypoint_invoked && entry.semantic_execution_completed));
assert(evaluation.fixture_results.every((entry) => Object.values(entry.external_side_effects).every((value) => value === 0)));
assert(evaluation.fixture_results.every((entry) => entry.assertion_readbacks.every((assertion) => assertion.observed)));
assert(evaluation.focused_suites.every((suite) => suite.status === "PASS"));
assert.equal(evaluation.mutation_sensitivity.status, "WEAKENED");
assert.equal(evaluation.mutation_sensitivity.mutation_detected, true);
console.log("PASS Scheduler resource evaluator: all 18 real typed hostile vectors, focused scheduler contracts, zero resource side effects, and mutation sensitivity");
