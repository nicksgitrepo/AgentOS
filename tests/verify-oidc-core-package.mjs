#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {evaluateOidcCoreBoundary} from "../control/oidc-core-boundary-gate.mjs";
import {evaluateOidcCorePackage} from "../control/oidc-core-package-evaluator.mjs";
import {
  OIDC_CORE_FIXTURE_CLASSES,
  OIDC_CORE_MODEL_FILE_SHA256,
  OIDC_CORE_MODEL_SNAPSHOT_SHA256,
  oidcCoreContextReceiptSha256,
  resolveOidcCoreCanonicalAuthority,
} from "../control/oidc-core-authority-binding.mjs";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const PACKAGE = path.join(ROOT, "specialist-blocks/wave-02/oidc-core");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(ROOT, relative), "utf8"));

const authority = resolveOidcCoreCanonicalAuthority();
assert.equal(authority.status, "BLOCKED_EXACT");
assert.equal(authority.model_policy.code, "POLICY_SNAPSHOT_STALE");
assert.equal(authority.model_policy.snapshot_sha256, OIDC_CORE_MODEL_SNAPSHOT_SHA256);
assert.equal(sha256(fs.readFileSync(path.join(ROOT, "fixtures/model-policy-snapshot.initial.v1.json"))), OIDC_CORE_MODEL_FILE_SHA256);
assert.equal(oidcCoreContextReceiptSha256({
  blockSha: authority.candidate.block_sha256,
  sourceManifestSha: authority.candidate.source_manifest_sha256,
  standardBlockSha: authority.standard.block_sha256,
  standardSourceManifestSha: authority.standard.source_manifest_sha256,
  routerFileSha: authority.upstream_router.file_sha256,
  routerResultSha: authority.upstream_router.result_sha256,
  modelSnapshotSha: authority.model_policy.snapshot_sha256,
}), authority.context.receipt_sha256);

const evaluation = await evaluateOidcCorePackage();
assert.equal(evaluation.status, "BLOCKED_EXACT");
assert.equal(evaluation.local_status, "PASS_LOCAL_ONLY");
assert.equal(evaluation.ready_for_admission, false);
assert.equal(evaluation.audit_started, false);
assert.equal(evaluation.fixture_count, 17);
assert.equal(evaluation.gate_count, 12);
assert.equal(evaluation.mutation_sensitivity.status, "WEAKENED");
assert.equal(evaluation.mutation_sensitivity.mutation_detected, true);
assert.equal(evaluation.evaluation_sha256, canonicalDigest({...evaluation, evaluation_sha256: null}));

const fixtureFiles = fs.readdirSync(path.join(PACKAGE, "fixtures")).filter((name) => name.endsWith(".json")).sort();
assert.equal(fixtureFiles.length, OIDC_CORE_FIXTURE_CLASSES.length);
for (const name of fixtureFiles) {
  const fixture = JSON.parse(fs.readFileSync(path.join(PACKAGE, "fixtures", name), "utf8"));
  const actual = evaluateOidcCoreBoundary(fixture.vector.input);
  assert.equal(actual.disposition, fixture.vector.expected_readback.disposition, fixture.fixture_id);
  assert.equal(actual.route, fixture.vector.expected_readback.route, fixture.fixture_id);
  assert.equal(actual.error_code, fixture.vector.expected_readback.error_code, fixture.fixture_id);
  assert.equal(actual.acceptance_allowed, false, fixture.fixture_id);
  assert(Object.values(actual.external_side_effects).every((value) => value === 0), fixture.fixture_id);
}

const valid = readJson("specialist-blocks/wave-02/oidc-core/fixtures/narrowness.json").vector.input;
assert.throws(() => evaluateOidcCoreBoundary({...valid, evidence: {...valid.evidence, unexpected: true}}), (error) => error.code === "OIDC_CORE_UNKNOWN_FIELD");
assert.equal(evaluateOidcCoreBoundary({...valid, evidence: {...valid.evidence, self_acceptance: true}}).error_code, "OIDC_CORE_SELF_ACCEPTANCE_FORBIDDEN");
assert.equal(evaluateOidcCoreBoundary({...valid, request_kind: "MANAGE_ACCOUNT"}).error_code, "OIDC_CORE_OPERATION_FORBIDDEN");
assert.equal(evaluateOidcCoreBoundary({...valid, evidence: {...valid.evidence, adversarial_flags: {...valid.evidence.adversarial_flags, issuer_mismatch: true}}}).error_code, "OIDC_CORE_ISSUER_IDENTITY_INVALID");
assert.equal(evaluateOidcCoreBoundary({...valid, evidence: {...valid.evidence, adversarial_flags: {...valid.evidence.adversarial_flags, claims_unverified: true}}}).error_code, "OIDC_CORE_CLAIMS_CONTEXT_INCOMPLETE");

const roster = readJson("specialist-blocks/registry/agent-roster.v1.json");
const entry = roster.entries.find((candidate) => candidate.stable_agent_id === "AGENT.SECURITY_OIDC_CORE");
assert.equal(entry.canonical_block_id, "specialist.security.oidc-core");
assert.equal(entry.package_path, "specialist-blocks/wave-02/oidc-core");
assert.equal(entry.model_route.task_class, "NARROW_CODING");
assert.equal(entry.model_route.route_source, "GLOBAL_MODEL_POLICY_SNAPSHOT");
assert.equal(entry.deterministic_gates.gates.length, 12);
assert.equal(entry.hostile_fixtures.fixtures.length, 17);
assert.equal(entry.required_evidence_handoff.independent_review_required, true);

const personalPath = ["/", "Users", "/", "private"].join("");
const homePath = ["/", "home", "/", "private"].join("");
for (const relative of ["control/oidc-core-boundary-gate.mjs", "control/oidc-core-authority-binding.mjs", "control/oidc-core-package-evaluator.mjs", "schemas/oidc-core-gate-execution.v1.json"]) {
  const source = fs.readFileSync(path.join(ROOT, relative), "utf8");
  assert.equal(source.includes(personalPath), false, `${relative} contains a personal path literal`);
  assert.equal(source.includes(homePath), false, `${relative} contains a home path literal`);
}

console.log("PASS OIDC Core package: 17 executable hostile vectors, 12 gates, issuer/claims regressions, mutation proof, exact stale-policy blocker, roster binding, and portability checks");
