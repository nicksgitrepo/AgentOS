#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {evaluateAiSearchRagBoundary, AI_SEARCH_RAG_INPUT_SCHEMA, AI_SEARCH_RAG_RESULT_SCHEMA} from "../control/ai-search-rag-boundary-gate.mjs";
import {createAiSearchRagBoundaryInput, evaluateAiSearchRagPackage} from "../control/ai-search-rag-package-evaluator.mjs";
import {resolveAiSearchRagCanonicalAuthority} from "../control/ai-search-rag-authority-binding.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const fixtureRoot = path.join(root, "specialist-blocks/wave-06/search-rag/fixtures");
const authority = resolveAiSearchRagCanonicalAuthority();
const files = fs.readdirSync(fixtureRoot).filter((name) => name.endsWith(".json")).sort();
assert.equal(files.length, 17);

function inputFor(fixture) {
  const input = createAiSearchRagBoundaryInput(authority);
  input.request_kind = fixture.vector.input.request_kind;
  const overrides = fixture.vector.input.evidence_overrides ?? {};
  Object.assign(input.evidence, overrides.evidence ?? {});
  Object.assign(input.evidence.adversarial_flags, overrides.adversarial_flags ?? {});
  return input;
}

for (const file of files) {
  const fixture = JSON.parse(fs.readFileSync(path.join(fixtureRoot, file), "utf8"));
  assert.equal(fixture.vector.entrypoint, "control/ai-search-rag-boundary-gate.mjs#evaluateAiSearchRagBoundary");
  const actual = evaluateAiSearchRagBoundary(inputFor(fixture));
  assert.equal(actual.schema, AI_SEARCH_RAG_RESULT_SCHEMA, fixture.fixture_id);
  assert.equal(actual.disposition, fixture.expected.disposition, fixture.fixture_id);
  assert.equal(actual.route, fixture.expected.route, fixture.fixture_id);
  assert.equal(actual.error_code, fixture.expected.error_code, fixture.fixture_id);
  assert.equal(actual.acceptance_allowed, false, fixture.fixture_id);
  assert.equal(actual.answer_generation_allowed, false, fixture.fixture_id);
  assert.equal(actual.corpus_writes_allowed, false, fixture.fixture_id);
  assert(Object.values(actual.external_side_effects).every((value) => value === 0), fixture.fixture_id);
}

const valid = createAiSearchRagBoundaryInput(authority);
assert.equal(valid.schema, AI_SEARCH_RAG_INPUT_SCHEMA);
assert.equal(evaluateAiSearchRagBoundary(valid).selected_specialist, "specialist.ai.search-rag");
assert.throws(() => evaluateAiSearchRagBoundary({...valid, evidence: {...valid.evidence, unexpected: true}}), (error) => error.code === "AI_SEARCH_RAG_UNKNOWN_FIELD");
assert.throws(() => evaluateAiSearchRagBoundary({...valid, evidence: {...valid.evidence, candidate_digest: "0123456789abcdef".repeat(4)}}), (error) => error.code === "AI_SEARCH_RAG_CANDIDATE_BINDING_INVALID");
const hostilePrivateSource = ["PRIVATE ", "/", "Users", "/secret"].join("");
assert.throws(() => evaluateAiSearchRagBoundary({...valid, evidence: {...valid.evidence, source_identity: hostilePrivateSource}}), (error) => error.code === "AI_SEARCH_RAG_PRIVACY_DENIED");
assert.equal(evaluateAiSearchRagBoundary({...valid, request_kind: "WRITE_PROJECT"}).error_code, "AI_SEARCH_RAG_OPERATION_FORBIDDEN");

const evaluation = await evaluateAiSearchRagPackage();
assert.equal(evaluation.status, "PASS");
assert.equal(evaluation.fixture_results.length, 17);
assert.equal(evaluation.gate_execution.length, 12);
assert.equal(evaluation.mutation_sensitivity.mutation_detected, true);
assert.equal(evaluation.independent_signature_required, true);
console.log("PASS AI Search/RAG boundary: 17 executable vectors, 12 gate executions, zero side effects, canonical model/memory bindings, and hostile mutation proof");
