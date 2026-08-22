#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {evaluateAiSearchRagBoundary, AI_SEARCH_RAG_INPUT_SCHEMA, AI_SEARCH_RAG_RESULT_SCHEMA} from "../control/ai-search-rag-boundary-gate.mjs";
import {assertAiSearchRagCanonicalEvidence, resolveAiSearchRagCanonicalAuthority} from "../control/ai-search-rag-authority-binding.mjs";
import {buildAiSearchRagInput, evaluateAiSearchRagPackage} from "../control/ai-search-rag-package-evaluator.mjs";

const repositoryRoot = path.resolve(new URL("..", import.meta.url).pathname);
const authority = resolveAiSearchRagCanonicalAuthority();
assert.equal(authority.block_sha256, "c661430c0f7b9da3c833a914f9f3cb1d4b4e9fe3d02303dc6b3db9447eb2a3ce");
assert.equal(authority.model_preflight_status, "BLOCKED_EXACT");
assert.equal(authority.model_blocker, "POLICY_SNAPSHOT_STALE");
assert.deepEqual([...authority.protected_blockers], ["POLICY_SNAPSHOT_STALE", "CANONICAL_EVALUATOR_HANDOFF_REQUIRED"]);
assert.equal(authority.independent_reviewer_required, true);
assert.equal(authority.audit_started, false);
assert.equal(authority.context.memory_write_allowed, false);
assert.equal(authority.context.context_invalidation_rule, "INVALIDATE_ON_BLOCK_SOURCE_GATE_FIXTURE_MODEL_OR_REGISTRY_CHANGE");

const evaluation = await evaluateAiSearchRagPackage();
assert.equal(evaluation.schema, "agentos.specialist_ai_search_rag_package_operational_evaluation.v1");
assert.equal(evaluation.status, "BLOCKED_EXACT");
assert.equal(evaluation.local_status, "PASS_LOCAL_ONLY");
assert.equal(evaluation.fixture_results.length, 17);
assert.equal(evaluation.gate_trace.length, 12);
assert.equal(evaluation.mutation_sensitivity.status, "WEAKENED");
assert.equal(evaluation.mutation_sensitivity.mutation_detected, true);
assert.equal(evaluation.audit_started, false);
assert.equal(evaluation.audit_verdict, "NOT_STARTED");
assert.equal(evaluation.ready_for_admission, false);
assert.deepEqual([...evaluation.protected_blockers], ["POLICY_SNAPSHOT_STALE", "CANONICAL_EVALUATOR_HANDOFF_REQUIRED"]);
for (const result of evaluation.fixture_results) {
  assert.equal(result.entrypoint_invoked, true);
  assert.equal(result.semantic_execution_completed, true);
  assert(Object.values(result.external_side_effects).every((value) => value === 0));
}

const valid = buildAiSearchRagInput(authority);
const route = evaluateAiSearchRagBoundary(valid);
assert.equal(route.schema, AI_SEARCH_RAG_RESULT_SCHEMA);
assert.equal(route.disposition, "ROUTE");
assert.equal(route.route, "AI_SEARCH_RAG_ANALYSIS_HANDOFF");
assert.equal(route.analysis_allowed, true);
assert.equal(route.acceptance_allowed, false);
assert.equal(route.memory_write_allowed, false);
assert.equal(route.result_sha256, canonicalDigest({...route, result_sha256: null}));
assert(Object.values(route.external_side_effects).every((value) => value === 0));

const forbidden = structuredClone(valid);
forbidden.request_kind = "DEPLOY";
const forbiddenResult = evaluateAiSearchRagBoundary(forbidden);
assert.equal(forbiddenResult.disposition, "DENY");
assert.equal(forbiddenResult.error_code, "AI_SEARCH_RAG_OPERATION_FORBIDDEN");

const stale = structuredClone(valid);
stale.evidence.model_policy_status = "POLICY_SNAPSHOT_STALE";
stale.evidence.model_route_status = "BLOCKED_EXACT";
const staleResult = evaluateAiSearchRagBoundary(stale);
assert.equal(staleResult.disposition, "BLOCKED_EXACT");
assert.equal(staleResult.route, "MODEL_POLICY_REFRESH_REQUIRED");
assert.equal(staleResult.error_code, "POLICY_SNAPSHOT_STALE");

const canonicalEvidence = structuredClone(valid.evidence);
canonicalEvidence.model_policy_status = authority.model_preflight_status;
canonicalEvidence.model_route_status = "BLOCKED_EXACT";
assert.doesNotThrow(() => assertAiSearchRagCanonicalEvidence(canonicalEvidence, authority));
const substituted = structuredClone(canonicalEvidence);
substituted.candidate_digest = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
assert.throws(() => assertAiSearchRagCanonicalEvidence(substituted, authority), (error) => error?.code === "AI_SEARCH_RAG_CANDIDATE_BINDING_INVALID");

const memoryWrite = structuredClone(valid);
memoryWrite.evidence.memory_write_requested = true;
const memoryResult = evaluateAiSearchRagBoundary(memoryWrite);
assert.equal(memoryResult.disposition, "DENY");
assert.equal(memoryResult.error_code, "AI_SEARCH_RAG_MEMORY_WRITE_FORBIDDEN");

const handoff = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "specialist-blocks/wave-06/search-rag/handoff.json"), "utf8"));
assert(handoff.changed_paths.every((changedPath) => changedPath.startsWith("specialist-blocks/wave-06/search-rag/")), "handoff changed paths must remain package-local");

for (const relativePath of [
  "control/ai-search-rag-authority-binding.mjs",
  "control/ai-search-rag-boundary-gate.mjs",
  "control/ai-search-rag-package-evaluator.mjs",
  "schemas/ai-search-rag-gate-execution.v1.json",
  "tests/verify-ai-search-rag-boundary.mjs",
]) {
  const source = fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
  const personalPathLiterals = ["/" + "Users/", "/" + "home/", "C:" + "\\\\Users\\\\"];
  assert(personalPathLiterals.every((literal) => !source.includes(literal)), `personal path literal found in ${relativePath}`);
}

const schema = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "schemas/ai-search-rag-gate-execution.v1.json"), "utf8"));
assert.equal(schema.properties.block_id.const, "specialist.ai.search-rag");
assert.equal(schema.properties.evaluator_entrypoint.const, "control/ai-search-rag-package-evaluator.mjs#evaluateAiSearchRagPackage");
console.log("PASS AI Search/RAG boundary: 17 executable hostile fixtures, 12 fail-closed gates, source/model/custody bindings, context invalidation, mutation proof, and zero side effects");
