#!/usr/bin/env node

/* External evaluator review authority supplied over a protected inherited descriptor. */

import fs from "node:fs";
import path from "node:path";
import {createPublicKey, verify} from "node:crypto";
import {canonicalDigest, canonicalJson} from "./content-addressing.mjs";

const PROVISIONING_FD = 3;
const SHA = /^[0-9a-f]{64}$/u;
const REF = /^ref:permanent-role-review\/[A-Z0-9._:-]{1,192}$/u;
let provisioned;

function fail(message, code = "PERMANENT_ROLE_EXTERNAL_REVIEW_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function exact(value, keys, label) { assert(value && typeof value === "object" && !Array.isArray(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort()), `${label} fields differ`); }
function body(value, omitted) { const copy = structuredClone(value); for (const field of omitted) copy[field] = null; return copy; }
function rawPublicKey(pem) { try { return createPublicKey(pem); } catch { fail("External evaluator public key is invalid"); } }
function verifySignature(record, signatureField, publicKey) {
  const signature = record[signatureField];
  assert(typeof signature === "string" && /^[A-Za-z0-9+/]+={0,2}$/u.test(signature), "External evaluator signature is invalid");
  assert(verify(null, Buffer.from(canonicalJson(body(record, [signatureField]))), publicKey, Buffer.from(signature, "base64")), "External evaluator signature verification failed", "PERMANENT_ROLE_EXTERNAL_REVIEW_SIGNATURE_INVALID");
}
function safeFile(root, relative) {
  assert(typeof relative === "string" && !path.isAbsolute(relative) && !relative.split(/[\\/]/u).some((part) => part === "" || part === ".."), "External review path is unsafe");
  const target = path.resolve(root, relative);
  assert(target.startsWith(`${root}${path.sep}`), "External review path escaped its store");
  if (fs.existsSync(target)) assert(fs.lstatSync(target).isFile() && !fs.lstatSync(target).isSymbolicLink(), "External review file is unsafe");
  return target;
}
function readJson(target) { return JSON.parse(fs.readFileSync(target, "utf8")); }

function loadProvisioning() {
  if (provisioned !== undefined) return provisioned;
  let text;
  try { text = fs.readFileSync(PROVISIONING_FD, "utf8"); }
  catch { provisioned = null; return provisioned; }
  let envelope;
  try { envelope = JSON.parse(text); } catch { fail("External evaluator provisioning envelope is malformed"); }
  assert(envelope && envelope.schema === "agentos.external_evaluator_provisioning.v1" && envelope.version === 1, "External evaluator provisioning identity differs");
  assert(Object.keys(envelope).sort().join(",") === ["authority_epoch", "evaluator_admission", "root_public_key_pem", "schema", "store_root", "version"].sort().join(","), "External evaluator provisioning fields differ");
  const root = fs.realpathSync(envelope.store_root);
  assert(path.isAbsolute(root) && root === envelope.store_root && fs.lstatSync(root).isDirectory() && !fs.lstatSync(root).isSymbolicLink(), "External evaluator store root is unsafe");
  const rootKey = rawPublicKey(envelope.root_public_key_pem), admission = envelope.evaluator_admission;
  exact(admission, ["schema", "version", "evaluator_id", "public_key_pem", "scope", "authority_epoch", "status", "admitted_at_utc", "expires_at_utc", "revoked_at_utc", "admission_sha256", "root_signature_base64"], "External evaluator admission");
  assert(admission?.schema === "agentos.external_evaluator_admission.v1" && admission.version === 1 && Number.isSafeInteger(envelope.authority_epoch) && envelope.authority_epoch >= 1 && admission.authority_epoch === envelope.authority_epoch, "External evaluator admission identity differs");
  assert(admission.status === "ACTIVE" && admission.revoked_at_utc === null && admission.scope === "PERMANENT_ROLE_INDEPENDENT_REVIEW", "External evaluator is inactive, revoked, or out of scope");
  assert(admission.evaluator_id !== "AGENTOS.SPAWNER" && admission.evaluator_id !== "AGENTOS_CONTROLLER" && admission.evaluator_id !== "AGENTOS.PRODUCT_OWNER", "Builder/control identity cannot evaluate permanent roles");
  assert(Number.isFinite(Date.parse(admission.admitted_at_utc)) && Number.isFinite(Date.parse(admission.expires_at_utc)) && Date.parse(admission.admitted_at_utc) <= Date.now() && Date.parse(admission.expires_at_utc) > Date.now(), "External evaluator admission is stale or future-dated");
  assert(SHA.test(admission.admission_sha256) && admission.admission_sha256 === canonicalDigest(body(admission, ["admission_sha256", "root_signature_base64"])), "External evaluator admission digest differs");
  verifySignature(admission, "root_signature_base64", rootKey);
  provisioned = Object.freeze({root, epoch: envelope.authority_epoch, evaluator: Object.freeze(admission), evaluatorKey: rawPublicKey(admission.public_key_pem)});
  return provisioned;
}

function validateFixtureResults(review, candidate) {
  const results = review.fixture_results;
  assert(Array.isArray(results) && results.length === 17, "External review must contain exactly 17 executed fixture results");
  assert(new Set(results.map((entry) => entry.fixture_id)).size === 17, "External review fixture results contain aliases");
  const expected = new Map(candidate.fixtures.map((entry) => [entry.fixture_id, entry]));
  for (const result of results) {
    exact(result, ["fixture_id", "fixture_class", "fixture_file_sha256", "entrypoint", "entrypoint_invoked", "semantic_execution_completed", "expected_outcome", "actual_outcome", "error_code", "exit_code", "assertion_readbacks", "side_effect_spy_readback", "executed_at_utc", "result_sha256"], "External fixture result");
    const fixture = expected.get(result.fixture_id);
    assert(fixture && result.fixture_file_sha256 === fixture.file_sha256 && result.fixture_class === fixture.fixture_class, "External review fixture binding differs");
    assert(result.entrypoint === fixture.entrypoint && result.entrypoint_invoked === true && typeof result.semantic_execution_completed === "boolean" && result.expected_outcome === fixture.expected, "External review fixture execution readback is incomplete");
    exact(result.side_effect_spy_readback, ["adapter_calls", "state_changes", "memory_writes", "deploy_calls"], "External fixture side-effect spy readback");
    assert(Object.values(result.side_effect_spy_readback).every((value) => Number.isSafeInteger(value) && value >= 0), "External fixture side-effect spy readback is invalid");
    assert(Array.isArray(result.assertion_readbacks) && result.assertion_readbacks.length >= 3 && result.assertion_readbacks.every((entry) => entry && typeof entry.assertion === "string" && typeof entry.observed === "boolean" && typeof entry.evidence === "string"), "External review lacks actual assertion readbacks");
    assert(Number.isInteger(result.exit_code) && Number.isFinite(Date.parse(result.executed_at_utc)), "External review execution provenance is incomplete");
    assert(SHA.test(result.result_sha256) && result.result_sha256 === canonicalDigest(body(result, ["result_sha256"])), "External review fixture-result digest differs");
  }
  const genericDenials = results.filter((result) => result.semantic_execution_completed === false || result.error_code === "PRODUCT_OWNER_AUTHORITY_REQUIRED");
  if (genericDenials.length > 0) fail("Pre-admission authority denial does not execute Product Owner fixture semantics; a sealed canonical pre-admission fixture adapter is required", "OPERATIONAL_FIXTURE_EXECUTION_REQUIRED");
  fail("No sealed canonical pre-admission Product Owner fixture adapter is installed; signed result claims cannot substitute for operational execution", "OPERATIONAL_FIXTURE_EXECUTION_REQUIRED");
}

function readReview(state, receiptRef) {
  assert(REF.test(receiptRef), "External review receipt reference is invalid");
  const reviewPath = safeFile(state.root, `reviews/${receiptRef.slice("ref:permanent-role-review/".length)}.json`);
  assert(fs.existsSync(reviewPath), "External review receipt is unknown", "PERMANENT_ROLE_EXTERNAL_REVIEW_UNKNOWN");
  return readJson(reviewPath);
}

function consumeReview({receiptRef, role, candidate, operationalContext, testOnly}) {
  assert(testOnly === true, "Only the non-authoritative dedicated harness may exercise an unpinned evaluator root");
  const state = loadProvisioning();
  assert(state, "External evaluator authority is not provisioned; permanent-role admission remains inactive", "PERMANENT_ROLE_EXTERNAL_REVIEW_PROVISIONING_REQUIRED");
  const review = readReview(state, receiptRef), now = Date.now();
  exact(review, ["schema", "version", "receipt_ref", "evaluator_id", "evaluator_admission_sha256", "authority_epoch", "role_id", "role_class", "candidate_root_sha256", "package_block_sha256", "gate_inventory_sha256", "fixture_inventory_sha256", "fixture_results", "operational_context_sha256", "model_snapshot_sha256", "model_selection_sha256", "scope", "custody", "custody_receipt_sha256", "observed_at_utc", "expires_at_utc", "disposition", "review_sha256", "evaluator_signature_base64"], "External review");
  assert(review.schema === "agentos.permanent_role_external_review.v1" && review.version === 1 && review.disposition === "PASS", "External review disposition or identity differs");
  assert(review.receipt_ref === receiptRef && review.evaluator_id === state.evaluator.evaluator_id && review.evaluator_admission_sha256 === state.evaluator.admission_sha256 && review.authority_epoch === state.epoch, "External review evaluator authority binding differs");
  assert(review.role_id === role.role_id && review.role_class === role.role_class && review.candidate_root_sha256 === candidate.candidate_root_sha256 && review.package_block_sha256 === candidate.block_sha256, "External review candidate binding differs");
  assert(review.gate_inventory_sha256 === canonicalDigest(candidate.gates) && review.fixture_inventory_sha256 === canonicalDigest(candidate.fixtures), "External review gate/fixture inventory binding differs");
  assert(review.operational_context_sha256 === operationalContext.context_sha256 && review.model_snapshot_sha256 === operationalContext.snapshot_sha256 && review.model_selection_sha256 === canonicalDigest(operationalContext.compact_selection), "External review global model context differs");
  assert(review.scope === "FULL_PERMANENT_ROLE_PACKAGE" && review.custody === "SEPARATE_EXTERNAL_EVALUATOR" && review.evaluator_id !== role.role_id, "External review scope/custody/independence differs");
  assert(Number.isFinite(Date.parse(review.observed_at_utc)) && Number.isFinite(Date.parse(review.expires_at_utc)) && Date.parse(review.observed_at_utc) <= now && now - Date.parse(review.observed_at_utc) <= 86_400_000 && now < Date.parse(review.expires_at_utc), "External review is stale or future-dated");
  validateFixtureResults(review, candidate);
}

export function consumeProvisionedPermanentRoleReview() {
  fail("No production external evaluator trust-anchor identity is pinned in canonical bootstrap authority; admission remains inactive", "PERMANENT_ROLE_PRODUCTION_TRUST_ANCHOR_REQUIRED");
}

/* Non-authoritative verifier exercised only by the dedicated child harness. It can only reject until a sealed adapter exists. */
export function verifyTestOnlyProvisionedPermanentRoleReview(options = {}) {
  return consumeReview({...options, testOnly: true});
}
