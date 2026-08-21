#!/usr/bin/env node

/* Focused lane verifier: public entrypoint, hostile fixtures, gates, and custody. */

import assert from "node:assert/strict";
import {evaluateOpenApiContractsPackage} from "../control/openapi-contracts-package-evaluator.mjs";

const evaluation = await evaluateOpenApiContractsPackage();
assert.equal(evaluation.schema, "agentos.specialist_openapi_contracts_package_operational_evaluation.v1");
assert.equal(evaluation.status, "PASS_PENDING_INDEPENDENT_REVIEW");
assert.equal(evaluation.deterministic_status, "PASS");
assert.equal(evaluation.admission_allowed, false);
assert.equal(evaluation.activation, "OFF");
assert.equal(evaluation.fixture_results.length, 17);
assert.equal(evaluation.gate_execution.length, 12);
assert.equal(evaluation.mutation_sensitivity.status, "WEAKENED");
assert.equal(evaluation.mutation_sensitivity.mutation_detected, true);
assert.equal(evaluation.context_invalidation.bound.reuse_allowed, true);
assert.equal(evaluation.context_invalidation.stale.reuse_allowed, false);
assert.equal(evaluation.context_invalidation.stale.action, "INVALIDATE_DEPENDENT_CONTEXT");
assert.equal(evaluation.lifecycle_readback.builder_admission_attempt.allowed, false);
assert.equal(evaluation.independent_signature_required, true);
assert.equal(evaluation.independent_auditor_model, "gpt-5.6-luna");
assert.equal(evaluation.independent_auditor_reasoning_effort, "max");
console.log("PASS OpenAPI HTTP Contract package: " + evaluation.fixture_results.length + " hostile public vectors, " + evaluation.gate_execution.length + " executable four-valued gates, source/model/context/lifecycle invalidation, and mutation proof");
