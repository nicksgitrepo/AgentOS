#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {evaluateOAuthIdentityBoundary} from "../control/oauth-identity-boundary-gate.mjs";
import {evaluateOAuthIdentityPackage} from "../control/oauth-identity-package-evaluator.mjs";
import {
  OAUTH_IDENTITY_FIXTURE_CLASSES,
  OAUTH_IDENTITY_MODEL_FILE_SHA256,
  OAUTH_IDENTITY_MODEL_SNAPSHOT_SHA256,
  oauthIdentityContextReceiptSha256,
  resolveOAuthIdentityCanonicalAuthority,
} from "../control/oauth-identity-authority-binding.mjs";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const PACKAGE = path.join(ROOT, "specialist-blocks/wave-02/oauth-identity");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(ROOT, relative), "utf8"));

const authority = resolveOAuthIdentityCanonicalAuthority();
assert.equal(authority.status, "BLOCKED_EXACT");
assert.equal(authority.model_policy.code, "POLICY_SNAPSHOT_STALE");
assert.equal(authority.model_policy.snapshot_sha256, OAUTH_IDENTITY_MODEL_SNAPSHOT_SHA256);
assert.equal(sha256(fs.readFileSync(path.join(ROOT, "fixtures/model-policy-snapshot.initial.v1.json"))), OAUTH_IDENTITY_MODEL_FILE_SHA256);
assert.equal(oauthIdentityContextReceiptSha256({
  blockSha: authority.candidate.block_sha256,
  sourceManifestSha: authority.candidate.source_manifest_sha256,
  standardBlockSha: authority.standard.block_sha256,
  standardSourceManifestSha: authority.standard.source_manifest_sha256,
  routerFileSha: authority.upstream_router.file_sha256,
  routerResultSha: authority.upstream_router.result_sha256,
  modelSnapshotSha: authority.model_policy.snapshot_sha256,
}), authority.context.receipt_sha256);

const evaluation = await evaluateOAuthIdentityPackage();
assert.equal(evaluation.status, "BLOCKED_EXACT");
assert.equal(evaluation.local_status, "PASS_LOCAL_ONLY");
assert.equal(evaluation.ready_for_admission, false);
assert.equal(evaluation.audit_started, false);
assert.equal(evaluation.fixture_count, 17);
assert.equal(evaluation.gate_count, 12);
assert.equal(evaluation.mutation_sensitivity.status, "WEAKENED");
assert.equal(evaluation.mutation_sensitivity.mutation_detected, true);
assert.equal(evaluation.evaluation_sha256, requireDigest(evaluation));

const fixtureFiles = fs.readdirSync(path.join(PACKAGE, "fixtures")).filter((name) => name.endsWith(".json")).sort();
assert.equal(fixtureFiles.length, OAUTH_IDENTITY_FIXTURE_CLASSES.length);
for (const name of fixtureFiles) {
  const fixture = JSON.parse(fs.readFileSync(path.join(PACKAGE, "fixtures", name), "utf8"));
  const actual = evaluateOAuthIdentityBoundary(fixture.vector.input);
  assert.equal(actual.disposition, fixture.vector.expected_readback.disposition, fixture.fixture_id);
  assert.equal(actual.route, fixture.vector.expected_readback.route, fixture.fixture_id);
  assert.equal(actual.error_code, fixture.vector.expected_readback.error_code, fixture.fixture_id);
  assert.equal(actual.acceptance_allowed, false, fixture.fixture_id);
  assert(Object.values(actual.external_side_effects).every((value) => value === 0), fixture.fixture_id);
}

const valid = readJson("specialist-blocks/wave-02/oauth-identity/fixtures/narrowness.json").vector.input;
assert.throws(() => evaluateOAuthIdentityBoundary({...valid, evidence: {...valid.evidence, unexpected: true}}), (error) => error.code === "OAUTH_IDENTITY_UNKNOWN_FIELD");
assert.equal(evaluateOAuthIdentityBoundary({...valid, evidence: {...valid.evidence, self_acceptance: true}}).error_code, "OAUTH_IDENTITY_SELF_ACCEPTANCE_FORBIDDEN");
assert.equal(evaluateOAuthIdentityBoundary({...valid, request_kind: "CHANGE_REDIRECT_URI"}).error_code, "OAUTH_IDENTITY_OPERATION_FORBIDDEN");

const roster = readJson("specialist-blocks/registry/agent-roster.v1.json");
const entry = roster.entries.find((candidate) => candidate.stable_agent_id === "AGENT.SECURITY_OAUTH_IDENTITY");
assert.equal(entry.canonical_block_id, "specialist.security.oauth-identity");
assert.equal(entry.package_path, "specialist-blocks/wave-02/oauth-identity");
assert.equal(entry.model_route.task_class, "NARROW_CODING");
assert.equal(entry.model_route.route_source, "GLOBAL_MODEL_POLICY_SNAPSHOT");
assert.equal(entry.deterministic_gates.gates.length, 12);
assert.equal(entry.hostile_fixtures.fixtures.length, 17);
assert.equal(entry.required_evidence_handoff.independent_review_required, true);

const personalPath = ["/", "Users", "/", "private"].join("");
const homePath = ["/", "home", "/", "private"].join("");
for (const relative of [
  "control/oauth-identity-boundary-gate.mjs",
  "control/oauth-identity-authority-binding.mjs",
  "control/oauth-identity-package-evaluator.mjs",
  "schemas/oauth-identity-gate-execution.v1.json",
]) {
  const source = fs.readFileSync(path.join(ROOT, relative), "utf8");
  assert.equal(source.includes(personalPath), false, `${relative} contains a personal path literal`);
  assert.equal(source.includes(homePath), false, `${relative} contains a home path literal`);
}

function requireDigest(value) {
  return createHash("sha256").update(JSON.stringify(canonicalize({...value, evaluation_sha256: null}))).digest("hex");
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
}

console.log("PASS OAuth Security Identity package: 17 executable hostile vectors, 12 gates, mutation proof, exact stale-policy blocker, roster binding, and portability checks");
