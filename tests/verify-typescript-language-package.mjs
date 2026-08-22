#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {evaluateTypeScriptLanguageBoundary} from "../control/typescript-language-boundary-gate.mjs";
import {evaluateTypeScriptLanguagePackage} from "../control/typescript-language-package-evaluator.mjs";
import {
  TYPESCRIPT_LANGUAGE_FIXTURE_CLASSES,
  TYPESCRIPT_LANGUAGE_MODEL_FILE_SHA256,
  TYPESCRIPT_LANGUAGE_MODEL_SNAPSHOT_SHA256,
  resolveTypeScriptLanguageCanonicalAuthority,
  typescriptLanguageContextReceiptSha256,
} from "../control/typescript-language-authority-binding.mjs";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const PACKAGE = path.join(ROOT, "specialist-blocks/wave-02/typescript-language");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(ROOT, relative), "utf8"));

const authority = resolveTypeScriptLanguageCanonicalAuthority();
assert.equal(authority.status, "BLOCKED_EXACT");
assert.equal(authority.model_policy.code, "POLICY_SNAPSHOT_STALE");
assert.equal(authority.model_policy.snapshot_sha256, TYPESCRIPT_LANGUAGE_MODEL_SNAPSHOT_SHA256);
assert.equal(sha256(fs.readFileSync(path.join(ROOT, "fixtures/model-policy-snapshot.initial.v1.json"))), TYPESCRIPT_LANGUAGE_MODEL_FILE_SHA256);
assert.equal(authority.protected_blockers.find((blocker) => blocker.code === "CANONICAL_EVALUATOR_HANDOFF_REQUIRED")?.status, "BLOCKED_EXACT");
assert.equal(typescriptLanguageContextReceiptSha256({
  blockSha: authority.candidate.block_sha256,
  sourceManifestSha: authority.candidate.source_manifest_sha256,
  standardBlockSha: authority.standard.block_sha256,
  standardSourceManifestSha: authority.standard.source_manifest_sha256,
  routerFileSha: authority.upstream_router.file_sha256,
  routerResultSha: authority.upstream_router.result_sha256,
  modelSnapshotSha: authority.model_policy.snapshot_sha256,
}), authority.context.receipt_sha256);

const evaluation = await evaluateTypeScriptLanguagePackage();
assert.equal(evaluation.status, "BLOCKED_EXACT");
assert.equal(evaluation.local_status, "PASS_LOCAL_ONLY");
assert.equal(evaluation.ready_for_admission, false);
assert.equal(evaluation.audit_started, false);
assert.equal(evaluation.audit_verdict, "NOT_STARTED / BLOCKED_EXACT");
assert.equal(evaluation.fixture_count, 17);
assert.equal(evaluation.gate_count, 12);
assert.equal(evaluation.mutation_sensitivity.status, "WEAKENED");
assert.equal(evaluation.mutation_sensitivity.mutation_detected, true);
assert.equal(evaluation.evaluation_sha256, canonicalDigest({...evaluation, evaluation_sha256: null}));

const fixtureFiles = fs.readdirSync(path.join(PACKAGE, "fixtures")).filter((name) => name.endsWith(".json")).sort();
assert.deepEqual(fixtureFiles.map((name) => name.replace(/\.json$/u, "")).sort(), TYPESCRIPT_LANGUAGE_FIXTURE_CLASSES.slice().sort());
for (const name of fixtureFiles) {
  const fixture = JSON.parse(fs.readFileSync(path.join(PACKAGE, "fixtures", name), "utf8"));
  const evidence = fixture.vector.input.evidence;
  const actual = evaluateTypeScriptLanguageBoundary(fixture.vector.input);
  assert.equal(actual.disposition, fixture.vector.expected_readback.disposition, fixture.fixture_id);
  assert.equal(actual.route, fixture.vector.expected_readback.route, fixture.fixture_id);
  assert.equal(actual.error_code, fixture.vector.expected_readback.error_code, fixture.fixture_id);
  assert.equal(evidence.candidate_digest, authority.candidate.block_sha256, fixture.fixture_id);
  assert.equal(evidence.context_receipt_sha256, authority.context.receipt_sha256, fixture.fixture_id);
  assert.equal(evidence.upstream_router_result_sha256, authority.upstream_router.result_sha256, fixture.fixture_id);
  assert.equal(actual.acceptance_allowed, false, fixture.fixture_id);
  assert(Object.values(actual.external_side_effects).every((value) => value === 0), fixture.fixture_id);
}

const valid = readJson("specialist-blocks/wave-02/typescript-language/fixtures/narrowness.json").vector.input;
assert.throws(() => evaluateTypeScriptLanguageBoundary({...valid, evidence: {...valid.evidence, unexpected: true}}), (error) => error.code === "TYPESCRIPT_LANGUAGE_UNKNOWN_FIELD");
assert.equal(evaluateTypeScriptLanguageBoundary({...valid, evidence: {...valid.evidence, self_acceptance: true}}).error_code, "TYPESCRIPT_LANGUAGE_SELF_ACCEPTANCE_FORBIDDEN");
assert.equal(evaluateTypeScriptLanguageBoundary({...valid, evidence: {...valid.evidence, language: "RUST", adversarial_flags: {...valid.evidence.adversarial_flags, wrong_language: true}}}).error_code, "TYPESCRIPT_LANGUAGE_STANDARD_IDENTITY_INVALID");
assert.throws(() => evaluateTypeScriptLanguageBoundary({...valid, evidence: {...valid.evidence, compiler_options: {...valid.evidence.compiler_options, target: "ES2019"}, adversarial_flags: {...valid.evidence.adversarial_flags, compiler_options_unverified: true}}}), (error) => error.code === "TYPESCRIPT_LANGUAGE_COMPILER_OPTIONS_INVALID");
assert.equal(evaluateTypeScriptLanguageBoundary({...valid, request_kind: "WRITE_PROJECT", evidence: {...valid.evidence, adversarial_flags: {...valid.evidence.adversarial_flags, unsafe_action: true}}}).error_code, "TYPESCRIPT_LANGUAGE_OPERATION_FORBIDDEN");

const roster = readJson("specialist-blocks/registry/agent-roster.v1.json");
const entry = roster.entries.find((candidate) => candidate.stable_agent_id === "AGENT.SOFTWARE_LANGUAGE_RUNTIME_TYPESCRIPT_LANGUAGE");
assert.equal(entry.canonical_block_id, "specialist.software-language-runtime.typescript-language");
assert.equal(entry.package_path, "specialist-blocks/wave-02/typescript-language");
assert.equal(entry.model_route.task_class, "NARROW_CODING");
assert.equal(entry.model_route.route_source, "GLOBAL_MODEL_POLICY_SNAPSHOT");
assert.equal(entry.deterministic_gates.gates.length, 12);
assert.equal(entry.hostile_fixtures.fixtures.length, 17);
assert.equal(entry.required_evidence_handoff.independent_review_required, true);

const personalPath = ["/", "Users", "/", "private"].join("");
const homePath = ["/", "home", "/", "private"].join("");
for (const relative of ["control/typescript-language-boundary-gate.mjs", "control/typescript-language-authority-binding.mjs", "control/typescript-language-package-evaluator.mjs", "schemas/typescript-language-gate-execution.v1.json"]) {
  const source = fs.readFileSync(path.join(ROOT, relative), "utf8");
  assert.equal(source.includes(personalPath), false, `${relative} contains a personal path literal`);
  assert.equal(source.includes(homePath), false, `${relative} contains a home path literal`);
}

console.log(`PASS TypeScript Language and Compiler Semantics package: ${TYPESCRIPT_LANGUAGE_FIXTURE_CLASSES.length} executable hostile vectors, 12 gates, TypeScript 5.9/compiler-option identity regressions, mutation proof, exact stale-policy/evaluator blockers, roster binding, memory/context invalidation, and portability checks`);
