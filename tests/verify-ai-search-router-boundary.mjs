#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {evaluateAiSearchRouterBoundary, AI_SEARCH_ROUTER_INPUT_SCHEMA} from "../control/ai-search-router-boundary-gate.mjs";
import {evaluateAiSearchRouterPackage} from "../control/ai-search-router-package-evaluator.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const inputSchema = JSON.parse(fs.readFileSync(path.join(root, "schemas/ai-search-router-boundary-input.v1.json"), "utf8"));
const resultSchema = JSON.parse(fs.readFileSync(path.join(root, "schemas/ai-search-router-boundary-result.v1.json"), "utf8"));
const digest = "b02d5aecfac19a63f4d6307b2893473a3e859defe761a75287c1ce7c3fb9570d";
const flags = {authority_conflict: false, scope_expanded: false, protected_data: false, stale_source: false, unsupported_tool: false, duplicate_authority: false, self_acceptance: false, unrelated_scope: false, missing_context: false, unsafe_action: false, broad_claim: false, cross_provider: false, false_positive: false};
const evidence = {authority_status: "CURRENT", corpus_scope: "EXTERNAL_TYPED_CORPUS", corpus_ref: "ref:CORPUS/EXTERNAL/1", source_status: "CURRENT_VERIFIED", source_identity: "SOURCE.NIST_AI_RMF", source_version: "1.0", candidate_status: "CURRENT_CANDIDATE", candidate_digest: digest, retrieval_signal: "AI.SEARCH_RAG", signal_status: "BOUND", task_status: "RETRIEVAL_CLASSIFICATION", context_status: "ROUTER_CONTEXT", context_complete: true, requested_action: "CLASSIFY", requested_tools: ["READ_SIGNAL", "READ_SOURCE_LOCK", "READ_CORPUS_DESCRIPTOR", "READ_CONTEXT", "READ_ROUTER_CATALOG"], required_block_identities: ["SPECIALIST.FOUNDATION.AUTHORITY_JURISDICTION_GATE", "SPECIALIST.FOUNDATION.EVIDENCE_FRESHNESS_GATE", "SPECIALIST.FOUNDATION.ROLE_INTAKE_CLASSIFIER", "SPECIALIST.FOUNDATION.SCOPE_NON_GOAL_GATE", "SPECIALIST.FOUNDATION.TOOL_CUSTODY_GATE"], model_policy_status: "CURRENT", model_route_status: "BOUND", authority_scope: "SEARCH_ROUTER", new_findings: false, project_data_present: false, secret_data_present: false, adversarial_flags: flags};
const input = {schema: AI_SEARCH_ROUTER_INPUT_SCHEMA, version: 1, request_kind: "CLASSIFY_SEARCH_SIGNAL", evidence};
const valid = evaluateAiSearchRouterBoundary(input);
assert.equal(valid.disposition, "ROUTE"); assert.equal(valid.route, "SEARCH_ATOMIC_HANDOFF"); assert.equal(valid.acceptance_allowed, false); assert(Object.values(valid.external_side_effects).every((value) => value === 0));
const protectedData = evaluateAiSearchRouterBoundary({...input, evidence: {...evidence, adversarial_flags: {...flags, protected_data: true}}});
assert.equal(protectedData.disposition, "DENY"); assert.equal(protectedData.route, "PRIVACY_BOUNDARY_REQUIRED"); assert.equal(protectedData.error_code, "AI_SEARCH_ROUTER_PROTECTED_DATA_FORBIDDEN");
const toolReview = evaluateAiSearchRouterBoundary({...input, evidence: {...evidence, adversarial_flags: {...flags, unsupported_tool: true}}});
assert.equal(toolReview.disposition, "ROUTE"); assert.equal(toolReview.route, "TOOL_CUSTODY_REVIEW"); assert.equal(toolReview.selected_owner, "AGENTOS.ORCHESTRATOR");
const forbidden = evaluateAiSearchRouterBoundary({...input, request_kind: "SELECT_MODEL"});
assert.equal(forbidden.disposition, "DENY"); assert.equal(forbidden.error_code, "AI_SEARCH_ROUTER_OPERATION_FORBIDDEN");
const evaluation = await evaluateAiSearchRouterPackage();
assert.equal(evaluation.status, "PASS"); assert.equal(evaluation.fixture_results.length, 17); assert.equal(evaluation.mutation_sensitivity.mutation_detected, true); assert(Object.values(evaluation.fixture_results[0].external_side_effects).every((value) => value === 0));
assert.equal(inputSchema.properties.schema.const, AI_SEARCH_ROUTER_INPUT_SCHEMA); assert.equal(resultSchema.properties.schema.const, "agentos.ai_search_router_boundary_result.v1");
console.log("PASS AI/Search/RAG Router boundary: 17 executable vectors, privacy/tool/forbidden routes, zero side effects, and mutation proof");
