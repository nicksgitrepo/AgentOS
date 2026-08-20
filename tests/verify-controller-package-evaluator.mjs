#!/usr/bin/env node

import assert from "node:assert/strict";
import {evaluatePermanentRolePackage} from "../control/permanent-role-package-evaluator.mjs";

const evaluation = await evaluatePermanentRolePackage();
assert.equal(evaluation.schema, "agentos.permanent_role_package_evaluation.v1");
assert.equal(evaluation.status, "PASS");
assert.equal(evaluation.role_id, "AGENTOS_CONTROLLER");
assert.equal(evaluation.fixture_results.length, 17);
assert.equal(new Set(evaluation.fixture_results.map((entry) => entry.fixture_id)).size, 17);
assert(evaluation.fixture_results.every((entry) => entry.entrypoint_invoked === true && entry.semantic_execution_completed === true));
assert(evaluation.fixture_results.every((entry) => entry.actual_outcome === entry.expected_outcome));
assert(evaluation.fixture_results.every((entry) => entry.assertion_readbacks.every((assertion) => assertion.observed === true)));
assert(evaluation.fixture_results.every((entry) => entry.side_effect_spy_readback.adapter_calls === 0 && entry.side_effect_spy_readback.state_changes === 0 && entry.side_effect_spy_readback.memory_writes === 0 && entry.side_effect_spy_readback.deploy_calls === 0));
assert.equal(evaluation.mutation_sensitivity.status, "WEAKENED");
assert.equal(evaluation.mutation_sensitivity.mutation_detected, true);
console.log("PASS Controller package evaluator: all 17 real hostile vectors execute with expected outcomes, zero side effects, and mutation sensitivity");
