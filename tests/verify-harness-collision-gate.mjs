#!/usr/bin/env node

import assert from "node:assert/strict";

import {
  HARNESS_COLLISION_DEFECT_CODE,
  HARNESS_COLLISION_HOSTILE_FIXTURE_REFS,
  compileHarnessCollisionGate,
  validateHarnessCollisionGate,
} from "../control/harness-collision-gate.mjs";
import {canonicalDigest} from "../control/content-addressing.mjs";

const AUTHORITY = {
  authority_commit: "ca63c10f5e85ca3ecf680936a4ffd041091e1772",
  authority_tree: "a5d654de40b94263367130cd33ace7f669312311",
  authority_receipt_sha256: "dc9c5123cd9b57e7ad028a546821c77d2c4f82d98b6a46acc4e9aa1502318655",
  source_mapping_sha256: "72da1380db142b59d32a5e097f43d33c1519a06f59775067d44d8c58e05ceb33",
};

const duplicateSource = "const readback = {};\nconst readback = {};";
const fixedSource = "const readback = {};\nconst continuation = {};";
const observedFailure = {
  defectCode: HARNESS_COLLISION_DEFECT_CODE,
  exactFailure: "Identifier 'readback' has already been declared",
  bindingName: "readback",
};

const compile = (sourceText, overrides = {}) => compileHarnessCollisionGate({
  gateId: "GATE.HARNESS.COLLISION.CA63C10",
  authorityBinding: AUTHORITY,
  source: {sourceRef: "opaque:harness-fixture/ca63c10", sourceText, ...(sourceText === null ? {sourceSha256: canonicalDigest({source_unavailable: true})} : {})},
  observedFailure,
  hostileFixtureRefs: HARNESS_COLLISION_HOSTILE_FIXTURE_REFS,
  ...overrides,
});

const retry = compile(duplicateSource);
assert.equal(retry.status, "RETRY_REQUIRED");
assert.equal(retry.parse_evaluation.collision_detected, true);
assert.equal(retry.parse_evaluation.binding_name, "readback");
assert.equal(retry.observed_failure.exact_failure, retry.parse_evaluation.syntax_error_message);
assert.equal(retry.repair_block.spawnable, false);
assert.equal(retry.controller_approval_required, false);
validateHarnessCollisionGate(retry);

const clear = compile(fixedSource, {nextAction: "DISPATCH_TO_INDEPENDENT_PLATFORM_REVIEW", nextHandler: "HANDLER.INDEPENDENT_PLATFORM_REVIEW"});
assert.equal(clear.status, "CLEAR");
assert.equal(clear.parse_evaluation.status, "PASS");
assert.equal(clear.parse_evaluation.collision_detected, false);
validateHarnessCollisionGate(clear);

const missing = compile(null);
assert.equal(missing.status, "RETRY_REQUIRED");
assert.equal(missing.parse_evaluation.status, "UNAVAILABLE");
assert(missing.parse_evaluation.missing_evidence.includes("SOURCE_TEXT_OR_PARSE_EVIDENCE"));

const tamperedMessage = structuredClone(retry);
tamperedMessage.observed_failure.exact_failure = "Identifier 'continuation' has already been declared";
tamperedMessage.gate_sha256 = canonicalDigest({...tamperedMessage, gate_sha256: null});
assert.throws(() => validateHarnessCollisionGate(tamperedMessage), /observed evidence digest mismatch|observed message drifted/u);

const tamperedAuthority = structuredClone(retry);
tamperedAuthority.authority_binding.authority_tree = "f".repeat(64);
tamperedAuthority.gate_sha256 = canonicalDigest({...tamperedAuthority, gate_sha256: null});
assert.throws(() => validateHarnessCollisionGate(tamperedAuthority), /authority tree/u);

const duplicateFixtures = structuredClone(retry);
duplicateFixtures.hostile_fixture_refs = [...duplicateFixtures.hostile_fixture_refs, duplicateFixtures.hostile_fixture_refs[0]];
duplicateFixtures.gate_sha256 = canonicalDigest({...duplicateFixtures, gate_sha256: null});
assert.throws(() => validateHarnessCollisionGate(duplicateFixtures), /sorted and unique/u);

const unsafeBoundary = structuredClone(retry);
unsafeBoundary.controller_approval_required = true;
unsafeBoundary.gate_sha256 = canonicalDigest({...unsafeBoundary, gate_sha256: null});
assert.throws(() => validateHarnessCollisionGate(unsafeBoundary), /Controller approval/u);

console.log("PASS harness collision gate: duplicate-binding detection, clear-source route, missing evidence, drift, hostile fixtures, and boundary closure");
