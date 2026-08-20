#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {evaluateWorkflowRouterBoundary, WORKFLOW_ROUTER_INPUT_SCHEMA} from "../control/workflow-router-boundary-gate.mjs";
import {evaluateWorkflowRouterPackage} from "../control/workflow-router-package-evaluator.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const inputSchema = JSON.parse(fs.readFileSync(path.join(root, "schemas/workflow-router-boundary-input.v1.json"), "utf8"));
const resultSchema = JSON.parse(fs.readFileSync(path.join(root, "schemas/workflow-router-boundary-result.v1.json"), "utf8"));
const digest = "b02d5aecfac19a63f4d6307b2893473a3e859defe761a75287c1ce7c3fb9570d";
const flags = {authority_conflict: false, scope_expanded: false, protected_data: false, stale_source: false, unsupported_tool: false, duplicate_authority: false, self_acceptance: false, unrelated_scope: false, missing_context: false, unsafe_action: false, broad_claim: false, cross_provider: false, false_positive: false};
const evidence = {authority_status: "CURRENT", workflow_domain: "FIELD_WORKFLOW", workflow_phase: "PLANNING", workflow_task: "TYPED_CLASSIFICATION", workflow_ref: "ref:WORKFLOW/EXTERNAL/1", source_status: "CURRENT_VERIFIED", source_identity: "SOURCE.OSHA_OIL_GAS_WELL_ETOOL", source_version: "current", candidate_status: "CURRENT_CANDIDATE", candidate_digest: digest, workflow_signal: "DOMAIN.FIELD_JOB_WORKFLOW", signal_status: "BOUND", task_status: "WORKFLOW_CLASSIFICATION", context_status: "WORKFLOW_ROUTER_CONTEXT", context_complete: true, requested_action: "CLASSIFY", requested_tools: ["READ_SIGNAL", "READ_SOURCE_LOCK", "READ_WORKFLOW_CATALOG", "READ_CONTEXT", "READ_SAFETY_BOUNDARY"], required_block_identities: ["SPECIALIST.FOUNDATION.AUTHORITY_JURISDICTION_GATE", "SPECIALIST.FOUNDATION.EVIDENCE_FRESHNESS_GATE", "SPECIALIST.FOUNDATION.ROLE_INTAKE_CLASSIFIER", "SPECIALIST.FOUNDATION.SCOPE_NON_GOAL_GATE", "SPECIALIST.FOUNDATION.TOOL_CUSTODY_GATE"], model_policy_status: "CURRENT", model_route_status: "BOUND", authority_scope: "DOMAIN_WORKFLOW_ROUTER", new_findings: false, project_data_present: false, secret_data_present: false, adversarial_flags: flags};
const input = {schema: WORKFLOW_ROUTER_INPUT_SCHEMA, version: 1, request_kind: "CLASSIFY_WORKFLOW_SIGNAL", evidence};
const valid = evaluateWorkflowRouterBoundary(input);
assert.equal(valid.disposition, "ROUTE"); assert.equal(valid.route, "WORKFLOW_ATOMIC_HANDOFF"); assert.equal(valid.acceptance_allowed, false); assert.equal(valid.operational_dispatch_allowed, false); assert.equal(valid.engineering_or_safety_claim_allowed, false); assert(Object.values(valid.external_side_effects).every((value) => value === 0));
const privacy = evaluateWorkflowRouterBoundary({...input, evidence: {...evidence, adversarial_flags: {...flags, protected_data: true}}});
assert.equal(privacy.disposition, "DENY"); assert.equal(privacy.route, "PRIVACY_BOUNDARY_REQUIRED"); assert.equal(privacy.error_code, "WORKFLOW_ROUTER_PROTECTED_DATA_FORBIDDEN");
const toolReview = evaluateWorkflowRouterBoundary({...input, evidence: {...evidence, adversarial_flags: {...flags, unsupported_tool: true}}});
assert.equal(toolReview.disposition, "ROUTE"); assert.equal(toolReview.route, "TOOL_CUSTODY_REVIEW"); assert.equal(toolReview.selected_owner, "AGENTOS.ORCHESTRATOR");
const forbidden = evaluateWorkflowRouterBoundary({...input, request_kind: "ISSUE_FIELD_INSTRUCTION"});
assert.equal(forbidden.disposition, "DENY"); assert.equal(forbidden.error_code, "WORKFLOW_ROUTER_OPERATION_FORBIDDEN");
const evaluation = await evaluateWorkflowRouterPackage();
assert.equal(evaluation.status, "PASS"); assert.equal(evaluation.fixture_results.length, 17); assert.equal(evaluation.mutation_sensitivity.mutation_detected, true); assert(Object.values(evaluation.fixture_results[0].external_side_effects).every((value) => value === 0));
assert.equal(inputSchema.properties.schema.const, WORKFLOW_ROUTER_INPUT_SCHEMA); assert.equal(resultSchema.properties.schema.const, "agentos.workflow_router_boundary_result.v1");
console.log("PASS Field/Well Workflow Router boundary: 17 executable vectors, privacy/tool/instruction denials, zero side effects, and mutation proof");
