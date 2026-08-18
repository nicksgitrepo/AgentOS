#!/usr/bin/env node
import assert from "node:assert/strict";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {verifyIndependentSpawnerClearance} from "../control/independent-spawner-clearance.mjs";
import {independentlyVerifyTestCandidate} from "./helpers/independent-clearance-fixture.mjs";

const H = (name) => canonicalDigest({name});
const candidate = {
  commit_sha1: "a".repeat(40), tree_sha1: "b".repeat(40), package_sha256: H("package"), package_file_sha256: H("package-file"),
  evidence_set_sha256: H("evidence"), lifecycle_candidate_sha256: H("lifecycle"), roster_projection_sha256: H("roster"), context_sha256: H("context"),
};
const valid = independentlyVerifyTestCandidate(candidate);
assert.equal(valid.clearance.receipt_sha256, valid.receipt.receipt_sha256);
assert.throws(() => independentlyVerifyTestCandidate(candidate, {mutateReceipt: (receipt) => { receipt.issuer_id = "EVALUATOR.UNKNOWN"; }}), /issuer is unknown/iu);
assert.throws(() => independentlyVerifyTestCandidate(candidate, {mutateReceipt: (receipt) => { receipt.issuer_role = "AGENT.SPAWNER_COMPILER"; }}), /cannot issue independent clearance/iu);
assert.throws(() => independentlyVerifyTestCandidate(candidate, {mutateReceipt: (receipt) => { receipt.scope.pop(); }}), /scope is partial/iu);
assert.throws(() => independentlyVerifyTestCandidate(candidate, {mutateReceipt: (receipt) => { receipt.candidate.tree_sha1 = "c".repeat(40); }}), /current candidate/iu);
assert.throws(() => independentlyVerifyTestCandidate(candidate, {mutateReceipt: (receipt) => { receipt.custody.builder_separated = false; }}), /custody/iu);
assert.throws(() => independentlyVerifyTestCandidate(candidate, {mutateReceipt: (receipt) => { receipt.expires_at_utc = "2026-08-18T11:30:00.000Z"; }}), /stale/iu);
assert.throws(() => verifyIndependentSpawnerClearance({receipt: valid.receipt, registry: valid.registry, trustedRegistrySha256: valid.registry.registry_sha256, expectedCandidate: candidate, nowUtc: "2026-08-18T12:00:00.000Z", usedReceiptSha256s: [valid.receipt.receipt_sha256]}), /already consumed/iu);
const fabricated = structuredClone(valid.receipt);
fabricated.signature_base64 = Buffer.from("locally-fabricated-digest-only-clearance").toString("base64");
assert.throws(() => verifyIndependentSpawnerClearance({receipt: fabricated, registry: valid.registry, trustedRegistrySha256: valid.registry.registry_sha256, expectedCandidate: candidate, nowUtc: "2026-08-18T12:00:00.000Z"}), /signature is invalid|fabricated/iu);
const partialCandidate = {...candidate}; delete partialCandidate.evidence_set_sha256;
assert.throws(() => independentlyVerifyTestCandidate(partialCandidate), /candidate fields mismatch/iu);
console.log("PASS independent Spawner clearance: separately admitted signed issuer, exact candidate/scope/custody binding, stale/self/fabricated/partial/replay denial");
