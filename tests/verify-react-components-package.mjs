#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {evaluateReactComponentsBoundary} from "../control/react-components-boundary-gate.mjs";
import {evaluateReactComponentsPackage} from "../control/react-components-package-evaluator.mjs";
import {
  REACT_COMPONENTS_FIXTURE_CLASSES,
  REACT_COMPONENTS_MODEL_FILE_SHA256,
  REACT_COMPONENTS_MODEL_SNAPSHOT_SHA256,
  resolveReactComponentsCanonicalAuthority,
  reactComponentsContextReceiptSha256,
} from "../control/react-components-authority-binding.mjs";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const PACKAGE = path.join(ROOT, "specialist-blocks/wave-02/react-components");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(ROOT, relative), "utf8"));

const authority = resolveReactComponentsCanonicalAuthority();
assert.equal(authority.status, "BLOCKED_EXACT");
assert.equal(authority.model_policy.code, "POLICY_SNAPSHOT_STALE");
assert.equal(authority.model_policy.snapshot_sha256, REACT_COMPONENTS_MODEL_SNAPSHOT_SHA256);
assert.equal(sha256(fs.readFileSync(path.join(ROOT, "fixtures/model-policy-snapshot.initial.v1.json"))), REACT_COMPONENTS_MODEL_FILE_SHA256);
assert.equal(authority.protected_blockers.find((blocker) => blocker.code === "CANONICAL_EVALUATOR_HANDOFF_REQUIRED")?.status, "BLOCKED_EXACT");
assert.equal(reactComponentsContextReceiptSha256({
  blockSha: authority.candidate.block_sha256,
  sourceManifestSha: authority.candidate.source_manifest_sha256,
  standardBlockSha: authority.standard.block_sha256,
  standardSourceManifestSha: authority.standard.source_manifest_sha256,
  routerFileSha: authority.upstream_router.file_sha256,
  routerResultSha: authority.upstream_router.result_sha256,
  modelSnapshotSha: authority.model_policy.snapshot_sha256,
}), authority.context.receipt_sha256);

const evaluation = await evaluateReactComponentsPackage();
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
assert.equal(fixtureFiles.length, REACT_COMPONENTS_FIXTURE_CLASSES.length);
for (const name of fixtureFiles) {
  const fixture = JSON.parse(fs.readFileSync(path.join(PACKAGE, "fixtures", name), "utf8"));
  const actual = evaluateReactComponentsBoundary(fixture.vector.input);
  assert.equal(actual.disposition, fixture.vector.expected_readback.disposition, fixture.fixture_id);
  assert.equal(actual.route, fixture.vector.expected_readback.route, fixture.fixture_id);
  assert.equal(actual.error_code, fixture.vector.expected_readback.error_code, fixture.fixture_id);
  assert.equal(actual.acceptance_allowed, false, fixture.fixture_id);
  assert(Object.values(actual.external_side_effects).every((value) => value === 0), fixture.fixture_id);
}

const valid = readJson("specialist-blocks/wave-02/react-components/fixtures/narrowness.json").vector.input;
assert.throws(() => evaluateReactComponentsBoundary({...valid, evidence: {...valid.evidence, unexpected: true}}), (error) => error.code === "REACT_COMPONENTS_UNKNOWN_FIELD");
assert.equal(evaluateReactComponentsBoundary({...valid, evidence: {...valid.evidence, self_acceptance: true}}).error_code, "REACT_COMPONENTS_SELF_ACCEPTANCE_FORBIDDEN");
assert.equal(evaluateReactComponentsBoundary({...valid, evidence: {...valid.evidence, framework: "VUE", adversarial_flags: {...valid.evidence.adversarial_flags, wrong_framework: true}}}).error_code, "REACT_COMPONENTS_STANDARD_IDENTITY_INVALID");
assert.throws(() => evaluateReactComponentsBoundary({...valid, evidence: {...valid.evidence, component_context: {...valid.evidence.component_context, version: "19.1"}, adversarial_flags: {...valid.evidence.adversarial_flags, wrong_version: true}}}), (error) => error.code === "REACT_COMPONENTS_VERSION_INVALID");
assert.equal(evaluateReactComponentsBoundary({...valid, request_kind: "WRITE_PROJECT", evidence: {...valid.evidence, adversarial_flags: {...valid.evidence.adversarial_flags, unsafe_action: true}}}).error_code, "REACT_COMPONENTS_OPERATION_FORBIDDEN");

const roster = readJson("specialist-blocks/registry/agent-roster.v1.json");
const entry = roster.entries.find((candidate) => candidate.stable_agent_id === "AGENT.SOFTWARE_LANGUAGE_RUNTIME_REACT_COMPONENTS");
assert.equal(entry.canonical_block_id, "specialist.software-language-runtime.react-components");
assert.equal(entry.package_path, "specialist-blocks/wave-02/react-components");
assert.equal(entry.model_route.task_class, "NARROW_CODING");
assert.equal(entry.model_route.route_source, "GLOBAL_MODEL_POLICY_SNAPSHOT");
assert.equal(entry.deterministic_gates.gates.length, 12);
assert.equal(entry.hostile_fixtures.fixtures.length, 17);
assert.equal(entry.required_evidence_handoff.independent_review_required, true);

const personalPath = ["/", "Users", "/", "private"].join("");
const homePath = ["/", "home", "/", "private"].join("");
for (const relative of ["control/react-components-boundary-gate.mjs", "control/react-components-authority-binding.mjs", "control/react-components-package-evaluator.mjs", "schemas/react-components-gate-execution.v1.json"]) {
  const source = fs.readFileSync(path.join(ROOT, relative), "utf8");
  assert.equal(source.includes(personalPath), false, `${relative} contains a personal path literal`);
  assert.equal(source.includes(homePath), false, `${relative} contains a home path literal`);
}

console.log("PASS React Component Runtime package: 17 executable hostile vectors, 12 gates, React 19.2 identity regressions, mutation proof, exact stale-policy/evaluator blockers, roster binding, and portability checks");
