#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {evaluateAccountingRouterBoundary, ACCOUNTING_ROUTER_INPUT_SCHEMA} from "../control/accounting-router-boundary-gate.mjs";
import {evaluateAccountingRouterPackage} from "../control/accounting-router-package-evaluator.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const inputSchema = JSON.parse(fs.readFileSync(path.join(root, "schemas/accounting-router-boundary-input.v1.json"), "utf8"));
const resultSchema = JSON.parse(fs.readFileSync(path.join(root, "schemas/accounting-router-boundary-result.v1.json"), "utf8"));
const digest = "b02d5aecfac19a63f4d6307b2893473a3e859defe761a75287c1ce7c3fb9570d";
const flags = {authority_conflict: false, scope_expanded: false, protected_data: false, stale_source: false, unsupported_tool: false, duplicate_authority: false, self_acceptance: false, unrelated_scope: false, missing_context: false, unsafe_action: false, broad_claim: false, cross_provider: false, false_positive: false};
const evidence = {authority_status: "CURRENT", accounting_domain: "JOB_COST", accounting_entity: "TYPED_ENTITY", accounting_objective: "INTERNAL_CONTROL_CLASSIFICATION", accounting_period: "TYPED_PERIOD", accounting_policy: "TYPED_POLICY_REF", accounting_ref: "ref:ACCOUNTING/EXTERNAL/1", source_status: "CURRENT_VERIFIED", source_identity: "SOURCE.GAO_GREEN_BOOK_2025", source_version: "2025", candidate_status: "CURRENT_CANDIDATE", candidate_digest: digest, accounting_signal: "FIN.JOB_COST_ACCOUNTING", signal_status: "BOUND", task_status: "ACCOUNTING_CLASSIFICATION", context_status: "ACCOUNTING_ROUTER_CONTEXT", context_complete: true, requested_action: "CLASSIFY", requested_tools: ["READ_SIGNAL", "READ_SOURCE_LOCK", "READ_ACCOUNTING_CATALOG", "READ_CONTEXT", "READ_PROFESSIONAL_BOUNDARY"], required_block_identities: ["SPECIALIST.FOUNDATION.AUTHORITY_JURISDICTION_GATE", "SPECIALIST.FOUNDATION.EVIDENCE_FRESHNESS_GATE", "SPECIALIST.FOUNDATION.ROLE_INTAKE_CLASSIFIER", "SPECIALIST.FOUNDATION.SCOPE_NON_GOAL_GATE", "SPECIALIST.FOUNDATION.TOOL_CUSTODY_GATE"], model_policy_status: "CURRENT", model_route_status: "BOUND", authority_scope: "ACCOUNTING_ROUTER", new_findings: false, project_data_present: false, secret_data_present: false, adversarial_flags: flags};
const input = {schema: ACCOUNTING_ROUTER_INPUT_SCHEMA, version: 1, request_kind: "CLASSIFY_ACCOUNTING_SIGNAL", evidence};
const valid = evaluateAccountingRouterBoundary(input);
assert.equal(valid.disposition, "ROUTE"); assert.equal(valid.route, "ACCOUNTING_ATOMIC_HANDOFF"); assert.equal(valid.acceptance_allowed, false); assert.equal(valid.accounting_entry_allowed, false); assert.equal(valid.professional_opinion_allowed, false); assert(Object.values(valid.external_side_effects).every((value) => value === 0));
const privacy = evaluateAccountingRouterBoundary({...input, evidence: {...evidence, adversarial_flags: {...flags, protected_data: true}}});
assert.equal(privacy.disposition, "DENY"); assert.equal(privacy.route, "PRIVACY_BOUNDARY_REQUIRED"); assert.equal(privacy.error_code, "ACCOUNTING_ROUTER_PROTECTED_DATA_FORBIDDEN");
const review = evaluateAccountingRouterBoundary({...input, evidence: {...evidence, adversarial_flags: {...flags, unsupported_tool: true}}});
assert.equal(review.disposition, "ROUTE"); assert.equal(review.route, "PROFESSIONAL_REVIEW"); assert.equal(review.selected_owner, "AGENTOS.ORCHESTRATOR");
const forbidden = evaluateAccountingRouterBoundary({...input, request_kind: "GIVE_GAAP_OPINION"});
assert.equal(forbidden.disposition, "DENY"); assert.equal(forbidden.error_code, "ACCOUNTING_ROUTER_OPERATION_FORBIDDEN");
const evaluation = await evaluateAccountingRouterPackage();
assert.equal(evaluation.status, "PASS"); assert.equal(evaluation.fixture_results.length, 17); assert.equal(evaluation.mutation_sensitivity.mutation_detected, true); assert(Object.values(evaluation.fixture_results[0].external_side_effects).every((value) => value === 0));
assert.equal(inputSchema.properties.schema.const, ACCOUNTING_ROUTER_INPUT_SCHEMA); assert.equal(resultSchema.properties.schema.const, "agentos.accounting_router_boundary_result.v1");
console.log("PASS Accounting and Job-Cost Router boundary: 17 executable vectors, privacy/professional/opinion denials, zero side effects, and mutation proof");
