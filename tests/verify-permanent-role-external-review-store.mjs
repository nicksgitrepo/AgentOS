#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {generateKeyPairSync, sign} from "node:crypto";
import {spawnSync} from "node:child_process";
import {canonicalDigest, canonicalJson} from "../control/content-addressing.mjs";
import {compileAllOperationalGlobalGovernanceContexts} from "../control/global-governance-operational-context.mjs";
import {inspectCanonicalPermanentRoleCandidate} from "../control/permanent-role-governed-admission.mjs";
import {runProductOwnerOperationalRequest} from "../control/product-owner-operational.mjs";
import {materializeTestGlobalGovernanceStore} from "./helpers/global-governance-fixture.mjs";

const repositoryRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const consumer = path.join(repositoryRoot, "tests/fixtures/permanent-role-external-review-consumer.mjs");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-external-review-"));
const governanceRoot = path.join(temporary, "governance"); fs.mkdirSync(governanceRoot);
const reviewRoot = path.join(temporary, "external-review"); fs.mkdirSync(path.join(reviewRoot, "reviews"), {recursive: true});
const TEST_NOW = "2026-08-21T04:09:00.000Z";

function without(record, fields) { const copy = structuredClone(record); for (const field of fields) copy[field] = null; return copy; }
function pem(key, type) { return key.export({type, format: "pem"}).toString(); }
function signRecord(record, field, privateKey) { record[field] = sign(null, Buffer.from(canonicalJson(without(record, [field]))), privateKey).toString("base64"); }
function runConsumer(provisioningPath, receiptRef, environment = process.env, mode = "TEST_ONLY") {
  const descriptor = fs.openSync(provisioningPath, "r");
  try { return spawnSync(process.execPath, [consumer, receiptRef, mode], {cwd: repositoryRoot, env: environment, stdio: ["ignore", "pipe", "pipe", descriptor], encoding: "utf8"}); }
  finally { fs.closeSync(descriptor); }
}
try {
  const governance = materializeTestGlobalGovernanceStore({authorityRoot: governanceRoot, nowUtc: TEST_NOW});
  const contexts = compileAllOperationalGlobalGovernanceContexts({authorityStore: governance.authorityStore});
  const candidate = inspectCanonicalPermanentRoleCandidate({roleId: "AGENTOS.PRODUCT_OWNER"});
  const rootKeys = generateKeyPairSync("ed25519"), evaluatorKeys = generateKeyPairSync("ed25519");
  const now = new Date(), expires = new Date(now.getTime() + 3_600_000);
  const admission = {schema: "agentos.external_evaluator_admission.v1", version: 1, evaluator_id: "EXTERNAL.EVALUATOR.PERMANENT.ROLE.ONE", public_key_pem: pem(evaluatorKeys.publicKey, "spki"), scope: "PERMANENT_ROLE_INDEPENDENT_REVIEW", authority_epoch: 1, status: "ACTIVE", admitted_at_utc: new Date(now.getTime() - 60_000).toISOString(), expires_at_utc: expires.toISOString(), revoked_at_utc: null, admission_sha256: null, root_signature_base64: null};
  admission.admission_sha256 = canonicalDigest(without(admission, ["admission_sha256", "root_signature_base64"])); signRecord(admission, "root_signature_base64", rootKeys.privateKey);
  const envelope = {schema: "agentos.external_evaluator_provisioning.v1", version: 1, store_root: fs.realpathSync(reviewRoot), authority_epoch: 1, root_public_key_pem: pem(rootKeys.publicKey, "spki"), evaluator_admission: admission};
  const provisioningPath = path.join(temporary, "provisioning.json"); fs.writeFileSync(provisioningPath, `${canonicalJson(envelope)}\n`, {mode: 0o600});

  const fixtureResults = candidate.fixtures.map((fixture) => {
    const source = JSON.parse(fs.readFileSync(path.join(repositoryRoot, fixture.path), "utf8"));
    assert.throws(() => runProductOwnerOperationalRequest({authority: Object.freeze(Object.create(null)), operation: "RESPOND_TO_USER", requestId: `FIXTURE.${source.class.toUpperCase()}`, request: source.vector.input}), (error) => error.code === "PRODUCT_OWNER_AUTHORITY_REQUIRED");
    const claimedAssertions = source.vector.assertions ?? Object.entries(source.vector.expected_readback).map(([field, value]) => `${field}=${JSON.stringify(value)}`);
    const result = {fixture_id: fixture.fixture_id, fixture_class: fixture.fixture_class, fixture_file_sha256: fixture.file_sha256, entrypoint: source.vector.entrypoint, entrypoint_invoked: true, semantic_execution_completed: false, expected_outcome: source.expected, actual_outcome: "AUTHORITY_DENIED_BEFORE_SEMANTIC_EXECUTION", error_code: "PRODUCT_OWNER_AUTHORITY_REQUIRED", exit_code: 2, assertion_readbacks: claimedAssertions.map((assertionText) => ({assertion: assertionText, observed: false, evidence: "Not evaluated: governed authority was unavailable before fixture semantics."})), side_effect_spy_readback: {adapter_calls: 0, state_changes: 0, memory_writes: 0, deploy_calls: 0}, executed_at_utc: now.toISOString(), result_sha256: null};
    result.result_sha256 = canonicalDigest(without(result, ["result_sha256"])); return result;
  });
  function makeReview(receiptRef) {
    const review = {schema: "agentos.permanent_role_external_review.v1", version: 1, receipt_ref: receiptRef, evaluator_id: admission.evaluator_id, evaluator_admission_sha256: admission.admission_sha256, authority_epoch: 1, role_id: "AGENTOS.PRODUCT_OWNER", role_class: "PRODUCT_OWNER", candidate_root_sha256: candidate.candidate_root_sha256, package_block_sha256: candidate.block_sha256, gate_inventory_sha256: canonicalDigest(candidate.gates), fixture_inventory_sha256: canonicalDigest(candidate.fixtures), fixture_results: fixtureResults, operational_context_sha256: contexts.PRODUCT_OWNER.context_sha256, model_snapshot_sha256: contexts.PRODUCT_OWNER.snapshot_sha256, model_selection_sha256: canonicalDigest(contexts.PRODUCT_OWNER.compact_selection), scope: "FULL_PERMANENT_ROLE_PACKAGE", custody: "SEPARATE_EXTERNAL_EVALUATOR", custody_receipt_sha256: canonicalDigest({evaluator_id: admission.evaluator_id, receipt_ref: receiptRef, custody: "EXTERNAL"}), observed_at_utc: now.toISOString(), expires_at_utc: expires.toISOString(), disposition: "PASS", review_sha256: null, evaluator_signature_base64: null};
    review.review_sha256 = canonicalDigest(without(review, ["review_sha256", "evaluator_signature_base64"])); signRecord(review, "evaluator_signature_base64", evaluatorKeys.privateKey); return review;
  }
  function writeReview(ref) { const review = makeReview(ref); fs.writeFileSync(path.join(reviewRoot, "reviews", `${ref.slice("ref:permanent-role-review/".length)}.json`), `${canonicalJson(review)}\n`, {mode: 0o600}); return review; }

  const primaryRef = "ref:permanent-role-review/PRODUCT.OWNER.NONOPERATIONAL"; writeReview(primaryRef);
  const productionSubstitution = runConsumer(provisioningPath, primaryRef, process.env, "PRODUCTION"); assert.equal(productionSubstitution.status, 2); assert.match(productionSubstitution.stderr, /PERMANENT_ROLE_PRODUCTION_TRUST_ANCHOR_REQUIRED/u);
  const rejected = runConsumer(provisioningPath, primaryRef); assert.equal(rejected.status, 2); assert.match(rejected.stderr, /OPERATIONAL_FIXTURE_EXECUTION_REQUIRED/u);
  assert.equal(fs.existsSync(path.join(reviewRoot, "consumptions.jsonl")), false, "Non-operational fixture claims reached admission consumption");

  const absent = spawnSync(process.execPath, [consumer, "ref:permanent-role-review/ABSENT"], {cwd: repositoryRoot, encoding: "utf8"}); assert.equal(absent.status, 2); assert.match(absent.stderr, /PRODUCTION_TRUST_ANCHOR_REQUIRED/u);
  const envOnly = spawnSync(process.execPath, [consumer, "ref:permanent-role-review/ABSENT"], {cwd: repositoryRoot, env: {...process.env, AGENTOS_EXTERNAL_REVIEW_ROOT: reviewRoot}, encoding: "utf8"}); assert.equal(envOnly.status, 2); assert.match(envOnly.stderr, /PRODUCTION_TRUST_ANCHOR_REQUIRED/u);

  const mutatedRef = "ref:permanent-role-review/PRODUCT.OWNER.MUTATED", mutated = writeReview(mutatedRef); mutated.candidate_root_sha256 = "f".repeat(64); fs.writeFileSync(path.join(reviewRoot, "reviews", "PRODUCT.OWNER.MUTATED.json"), `${canonicalJson(mutated)}\n`);
  const mutatedResult = runConsumer(provisioningPath, mutatedRef); assert.equal(mutatedResult.status, 2); assert.match(mutatedResult.stderr, /binding|digest|signature/u);
} finally {
  fs.rmSync(temporary, {recursive: true, force: true});
}

console.log("PASS external review rejection: generic pre-admission authority denial is recorded honestly, cannot count as semantic fixture execution, cannot create even a test admission, and attacker FD3 cannot unlock production");
