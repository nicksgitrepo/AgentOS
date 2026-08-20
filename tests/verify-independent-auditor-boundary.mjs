#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {evaluateIndependentAuditorBoundary} from "../control/independent-auditor-boundary-gate.mjs";
import {evaluateIndependentAuditorPackage} from "../control/independent-auditor-package-evaluator.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const schemaInput = JSON.parse(fs.readFileSync(path.join(root, "schemas/independent-auditor-boundary-input.v1.json"), "utf8"));
const schemaResult = JSON.parse(fs.readFileSync(path.join(root, "schemas/independent-auditor-boundary-result.v1.json"), "utf8"));
const digest = "b02d5aecfac19a63f4d6307b2893473a3e859defe761a75287c1ce7c3fb9570d";
const flags = {authority_conflict: false, scope_expanded: false, protected_data: false, stale_source: false, unsupported_tool: false, duplicate_authority: false, self_acceptance: false, unrelated_scope: false, missing_context: false, unsafe_action: false, broad_claim: false, cross_provider: false, false_positive: false};
const review = {candidate_ref: "ref:CANDIDATE/INDEPENDENT_AUDITOR/1", candidate_digest: digest, candidate_status: "CURRENT_CANDIDATE", package_scope: "ONE_EXACT_CANDIDATE", author_identity: "AGENT.BUILDER", evaluator_identity: "AGENTOS.INDEPENDENT_EVALUATOR", evaluator_status: "ADMITTED_CURRENT", independence_status: "SEPARATE_CONTROLLED_IDENTITIES", gate_status: "COMPLETE_EXECUTABLE", fixture_status: "COMPLETE_EXECUTABLE", source_status: "CURRENT_VERIFIED", custody_status: "BOUND", model_policy_status: "CURRENT_BOUND", requested_action: "INSPECT", requested_tools: ["READ_CANDIDATE", "READ_GATES", "READ_FIXTURES", "READ_SOURCE_LOCK", "READ_MODEL_POLICY", "READ_CUSTODY"], required_blocks: ["SPECIALIST.FOUNDATION.EVALUATION_ADMISSION_GATE", "SPECIALIST.FOUNDATION.EVIDENCE_FRESHNESS_GATE"], earlier_packages_status: "NONE", recheck_scope: "NONE", new_findings: false, project_data_present: false, secret_data_present: false, adversarial_flags: flags};
const valid = evaluateIndependentAuditorBoundary({schema: "agentos.independent_auditor_boundary_input.v1", version: 1, request_kind: "EVALUATE_CANDIDATE", review});
assert.equal(valid.disposition, "ROUTE"); assert.equal(valid.route, "EVALUATION_RECEIPT_TO_SPAWNER"); assert.equal(valid.acceptance_allowed, false); assert(Object.values(valid.external_side_effects).every((value) => value === 0));
const forbidden = evaluateIndependentAuditorBoundary({schema: "agentos.independent_auditor_boundary_input.v1", version: 1, request_kind: "ACCEPT", review});
assert.equal(forbidden.disposition, "DENY"); assert.equal(forbidden.error_code, "INDEPENDENT_AUDITOR_OPERATION_FORBIDDEN");
const recheck = evaluateIndependentAuditorBoundary({schema: "agentos.independent_auditor_boundary_input.v1", version: 1, request_kind: "RECHECK_EARLIER_PACKAGES", review: {...review, requested_action: "RECHECK_EARLIER", earlier_packages_status: "RECHECK_REQUIRED", recheck_scope: "ALL_EARLIER_NON_ARCHIVED", new_findings: true}});
assert.equal(recheck.route, "EARLIER_PACKAGE_RECHECK"); assert.equal(recheck.selected_owner, "AGENTOS.SPAWNER");
const evaluation = await evaluateIndependentAuditorPackage();
assert.equal(evaluation.status, "PASS"); assert.equal(evaluation.fixture_results.length, 17); assert.equal(evaluation.earlier_recheck_route.status, "EXECUTED"); assert.equal(evaluation.mutation_sensitivity.mutation_detected, true);
assert.equal(schemaInput.properties.schema.const, "agentos.independent_auditor_boundary_input.v1"); assert.equal(schemaResult.properties.schema.const, "agentos.independent_auditor_boundary_result.v1");
console.log("PASS Independent Auditor boundary: 17 executable vectors, earlier-package recheck route, zero side effects, and mutation proof");
