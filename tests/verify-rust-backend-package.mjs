#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {evaluateRustBackendBoundary} from "../control/rust-backend-boundary-gate.mjs";
import {evaluateRustBackendPackage} from "../control/rust-backend-package-evaluator.mjs";
import {
  RUST_BACKEND_FIXTURE_CLASSES,
  RUST_BACKEND_MODEL_FILE_SHA256,
  RUST_BACKEND_MODEL_SNAPSHOT_SHA256,
  resolveRustBackendCanonicalAuthority,
  rustBackendContextReceiptSha256,
} from "../control/rust-backend-authority-binding.mjs";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const PACKAGE = path.join(ROOT, "specialist-blocks/wave-02/rust-backend");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(ROOT, relative), "utf8"));

const authority = resolveRustBackendCanonicalAuthority();
assert.equal(authority.status, "BLOCKED_EXACT");
assert.equal(authority.model_policy.code, "POLICY_SNAPSHOT_STALE");
assert.equal(authority.model_policy.snapshot_sha256, RUST_BACKEND_MODEL_SNAPSHOT_SHA256);
assert.equal(sha256(fs.readFileSync(path.join(ROOT, "fixtures/model-policy-snapshot.initial.v1.json"))), RUST_BACKEND_MODEL_FILE_SHA256);
assert.equal(authority.protected_blockers.find((blocker) => blocker.code === "CANONICAL_EVALUATOR_HANDOFF_REQUIRED")?.status, "BLOCKED_EXACT");
assert.equal(rustBackendContextReceiptSha256({
  blockSha: authority.candidate.block_sha256,
  sourceManifestSha: authority.candidate.source_manifest_sha256,
  standardBlockSha: authority.standard.block_sha256,
  standardSourceManifestSha: authority.standard.source_manifest_sha256,
  routerFileSha: authority.upstream_router.file_sha256,
  routerResultSha: authority.upstream_router.result_sha256,
  modelSnapshotSha: authority.model_policy.snapshot_sha256,
}), authority.context.receipt_sha256);

const evaluation = await evaluateRustBackendPackage();
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
assert.deepEqual(fixtureFiles.map((name) => name.replace(/\.json$/u, "")).sort(), [
  "authority_conflict", "broad_when_narrow_exists", "cross_provider_version_claim", "data_limit", "duplicate_sibling_authority", "false_positive", "handoff", "missing_context", "narrowness", "router_self_accept", "routing", "silent_scope_expansion", "stale_source", "tool_limit", "umbrella_authority", "unrelated_scope", "unsafe_action",
].sort());
for (const name of fixtureFiles) {
  const fixture = JSON.parse(fs.readFileSync(path.join(PACKAGE, "fixtures", name), "utf8"));
  const evidence = fixture.vector.input.evidence;
  const actual = evaluateRustBackendBoundary(fixture.vector.input);
  assert.equal(actual.disposition, fixture.vector.expected_readback.disposition, fixture.fixture_id);
  assert.equal(actual.route, fixture.vector.expected_readback.route, fixture.fixture_id);
  assert.equal(actual.error_code, fixture.vector.expected_readback.error_code, fixture.fixture_id);
  assert.equal(evidence.candidate_digest, authority.candidate.block_sha256, fixture.fixture_id);
  assert.equal(evidence.context_receipt_sha256, authority.context.receipt_sha256, fixture.fixture_id);
  assert.equal(evidence.upstream_router_result_sha256, authority.upstream_router.result_sha256, fixture.fixture_id);
  assert.equal(actual.acceptance_allowed, false, fixture.fixture_id);
  assert(Object.values(actual.external_side_effects).every((value) => value === 0), fixture.fixture_id);
}

const valid = readJson("specialist-blocks/wave-02/rust-backend/fixtures/narrowness.json").vector.input;
assert.throws(() => evaluateRustBackendBoundary({...valid, evidence: {...valid.evidence, unexpected: true}}), (error) => error.code === "RUST_BACKEND_UNKNOWN_FIELD");
assert.equal(evaluateRustBackendBoundary({...valid, evidence: {...valid.evidence, self_acceptance: true}}).error_code, "RUST_BACKEND_SELF_ACCEPTANCE_FORBIDDEN");
assert.equal(evaluateRustBackendBoundary({...valid, evidence: {...valid.evidence, language: "GO", adversarial_flags: {...valid.evidence.adversarial_flags, wrong_language: true}}}).error_code, "RUST_BACKEND_STANDARD_IDENTITY_INVALID");
assert.equal(evaluateRustBackendBoundary({...valid, request_kind: "WRITE_PROJECT", evidence: {...valid.evidence, adversarial_flags: {...valid.evidence.adversarial_flags, unsafe_action: true}}}).error_code, "RUST_BACKEND_OPERATION_FORBIDDEN");

const roster = readJson("specialist-blocks/registry/agent-roster.v1.json");
const entry = roster.entries.find((candidate) => candidate.stable_agent_id === "AGENT.SOFTWARE_LANGUAGE_RUNTIME_RUST_BACKEND");
assert.equal(entry.canonical_block_id, "specialist.software-language-runtime.rust-backend");
assert.equal(entry.package_path, "specialist-blocks/wave-02/rust-backend");
assert.equal(entry.model_route.task_class, "NARROW_CODING");
assert.equal(entry.model_route.route_source, "GLOBAL_MODEL_POLICY_SNAPSHOT");
assert.equal(entry.deterministic_gates.gates.length, 12);
assert.equal(entry.hostile_fixtures.fixtures.length, 17);
assert.equal(entry.required_evidence_handoff.independent_review_required, true);

const personalPath = ["/", "Users", "/", "private"].join("");
const homePath = ["/", "home", "/", "private"].join("");
for (const relative of ["control/rust-backend-boundary-gate.mjs", "control/rust-backend-authority-binding.mjs", "control/rust-backend-package-evaluator.mjs", "schemas/rust-backend-gate-execution.v1.json"]) {
  const source = fs.readFileSync(path.join(ROOT, relative), "utf8");
  assert.equal(source.includes(personalPath), false, `${relative} contains a personal path literal`);
  assert.equal(source.includes(homePath), false, `${relative} contains a home path literal`);
}

console.log(`PASS Rust Backend Language Semantics package: ${RUST_BACKEND_FIXTURE_CLASSES.length} executable hostile vectors, 12 gates, Rust 2024/1.97.1 identity regressions, mutation proof, exact stale-policy/evaluator blockers, roster binding, memory/context invalidation, and portability checks`);
