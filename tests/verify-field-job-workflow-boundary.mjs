#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {evaluateFieldJobWorkflowBoundary, FIELD_JOB_WORKFLOW_INPUT_SCHEMA, FIELD_JOB_WORKFLOW_RESULT_SCHEMA} from "../control/field-job-workflow-boundary-gate.mjs";
import {evaluateFieldJobWorkflowPackage} from "../control/field-job-workflow-package-evaluator.mjs";
import {resolveFieldJobWorkflowCanonicalAuthority} from "../control/field-job-workflow-authority-binding.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const inputSchema = JSON.parse(fs.readFileSync(path.join(root, "schemas/field-job-workflow-boundary-input.v1.json"), "utf8"));
const resultSchema = JSON.parse(fs.readFileSync(path.join(root, "schemas/field-job-workflow-boundary-result.v1.json"), "utf8"));
const gateExecutionSchema = JSON.parse(fs.readFileSync(path.join(root, "schemas/field-job-workflow-gate-execution.v1.json"), "utf8"));
assert.equal(inputSchema.properties.schema.const, FIELD_JOB_WORKFLOW_INPUT_SCHEMA);
assert.equal(resultSchema.properties.schema.const, FIELD_JOB_WORKFLOW_RESULT_SCHEMA);
assert.equal(gateExecutionSchema.properties.schema.const, "agentos.field_job_workflow_gate_execution.v1");
const authority = resolveFieldJobWorkflowCanonicalAuthority();
const input = {schema: FIELD_JOB_WORKFLOW_INPUT_SCHEMA, version: 1, request_kind: "ANALYZE_FIELD_JOB_WORKFLOW", evidence: structuredClone(authority.evidence)};
const routed = evaluateFieldJobWorkflowBoundary(input);
assert.equal(routed.schema, FIELD_JOB_WORKFLOW_RESULT_SCHEMA);
assert.equal(routed.disposition, "ROUTE");
assert.equal(routed.route, "FIELD_WORKFLOW_ANALYSIS_HANDOFF");
assert.equal(routed.error_code, "FIELD_JOB_WORKFLOW_ROUTE_READY");
assert.equal(routed.acceptance_allowed, false);
assert.equal(routed.admission_allowed, false);
assert.equal(routed.activation_allowed, false);
assert.equal(routed.memory_write_allowed, false);
assert.equal(routed.handoff.execution_instruction, false);
assert(Object.values(routed.external_side_effects).every((value) => value === 0));

const unsafeInput = structuredClone(input);
unsafeInput.evidence.adversarial_flags.unsafe_action = true;
const unsafe = evaluateFieldJobWorkflowBoundary(unsafeInput);
assert.equal(unsafe.disposition, "DENY");
assert.equal(unsafe.route, "NO_FIELD_WORKFLOW_SIDE_EFFECT");
assert.equal(unsafe.error_code, "FIELD_JOB_WORKFLOW_OPERATION_FORBIDDEN");
assert(Object.values(unsafe.external_side_effects).every((value) => value === 0));

const evaluation = await evaluateFieldJobWorkflowPackage();
assert.equal(evaluation.status, "PASS");
assert.equal(evaluation.fixture_results.length, 17);
assert(evaluation.fixture_results.every((entry) => entry.entrypoint_invoked && entry.semantic_execution_completed));
assert.equal(evaluation.gate_execution.results.length, 12);
assert.equal(evaluation.mutation_sensitivity.status, "WEAKENED");
assert.equal(evaluation.mutation_sensitivity.mutation_detected, true);
assert.equal(evaluation.context_memory_invalidation.status, "PASS");
assert.equal(evaluation.context_memory_invalidation.write_allowed, false);
assert.equal(evaluation.canonical_external_admission, "BLOCKED_EXACT:SPAWNER_EXTERNAL_REVIEW_PROVISIONING_REQUIRED");
assert.equal(authority.registry.shared_registry_integration.schema, "agentos.field_job_workflow_shared_registry_integration_result.v1");
assert.equal(authority.registry.shared_registry_integration.finding_code, "SHARED_REGISTRY_SPAWNER_INTEGRATION_DRIFT");
assert.equal(authority.registry.shared_registry_integration.verdict, "BLOCKED_EXACT");
assert.equal(authority.registry.shared_registry_integration.severity, "HIGH");
assert.equal(authority.registry.shared_registry_integration.evidence.gate_pin_mismatch_count, 12);
assert.equal(authority.registry.shared_registry_integration.evidence.fixture_pin_mismatch_count, 17);
assert.equal(authority.registry.shared_registry_integration.evidence.handoff_pin_mismatch, true);
assert.equal(authority.registry.shared_registry_integration.evidence.review_state_mismatch, true);
assert.equal(evaluation.shared_registry_integration.finding_code, "SHARED_REGISTRY_SPAWNER_INTEGRATION_DRIFT");

const dossier = JSON.parse(fs.readFileSync(path.join(root, "specialist-blocks/wave-06/field-job-workflow/evaluation.json"), "utf8"));
assert.deepEqual(dossier.results, {passed: 17, failed: 0, pending: 0});
assert(dossier.cases.every((entry) => entry.observed === "PASS"));

console.log("PASS Field Job Workflow boundary: canonical route, hostile denial, 17 executable vectors, 12 gates, mutation proof, and blocked canonical admission preserved");
