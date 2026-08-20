#!/usr/bin/env node

/* External evaluator review authority supplied over a protected inherited descriptor. */

import fs from "node:fs";
import path from "node:path";
import {createHash, createPublicKey, verify} from "node:crypto";
import {canonicalDigest, canonicalJson} from "./content-addressing.mjs";
import {getSealedCanonicalAuthority, sealedAuthorityRepositoryRoot} from "./sealed-canonical-authority.mjs";

const PROVISIONING_FD = 3;
const SHA = /^[0-9a-f]{64}$/u;
const REF = /^ref:permanent-role-review\/[A-Z0-9._:-]{1,192}$/u;
const TRUST_ROOT_PATH = "specialist-blocks/control-plane/agent-spawner/permanent-role-evaluator-trust-root.v1.json";
let provisioned;
let testProvisioned;

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

function canonicalArtifact(root, relative, expectedSha, label) {
  const target = path.resolve(root, relative);
  assert(target.startsWith(`${root}${path.sep}`), `${label} escaped canonical authority`);
  const stat = fs.lstatSync(target);
  assert(stat.isFile() && !stat.isSymbolicLink(), `${label} is not a canonical file`);
  const bytes = fs.readFileSync(target);
  assert(SHA.test(expectedSha) && sha256(bytes) === expectedSha, `${label} digest differs`);
  return JSON.parse(bytes.toString("utf8"));
}

function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

function loadCanonicalTrustRoot() {
  const repositoryRoot = sealedAuthorityRepositoryRoot(getSealedCanonicalAuthority());
  const trustRoot = canonicalArtifact(repositoryRoot, TRUST_ROOT_PATH, sha256(fs.readFileSync(path.join(repositoryRoot, TRUST_ROOT_PATH))), "Permanent-role evaluator trust root");
  exact(trustRoot, ["schema", "version", "registry_path", "registry_sha256", "registry_file_sha256", "admission_path", "admission_sha256", "admission_file_sha256", "evaluator_id", "evaluator_role", "scope", "authority_epoch", "root_registry_path", "root_registry_sha256", "root_registry_file_sha256", "root_public_key_pem", "evaluator_public_key_pem", "trust_root_sha256"], "Permanent-role evaluator trust root");
  assert(trustRoot.schema === "agentos.permanent_role_evaluator_trust_root.v1" && trustRoot.version === 1, "Permanent-role evaluator trust-root identity differs");
  assert(SHA.test(trustRoot.trust_root_sha256) && trustRoot.trust_root_sha256 === canonicalDigest(body(trustRoot, ["trust_root_sha256"])), "Permanent-role evaluator trust-root digest differs");
  const rootRegistry = canonicalArtifact(repositoryRoot, trustRoot.root_registry_path, trustRoot.root_registry_file_sha256, "Canonical evaluator root registry");
  const evaluatorRegistry = canonicalArtifact(repositoryRoot, trustRoot.registry_path, trustRoot.registry_file_sha256, "Canonical evaluator registry");
  const admission = canonicalArtifact(repositoryRoot, trustRoot.admission_path, trustRoot.admission_file_sha256, "Canonical evaluator admission");
  exact(rootRegistry, ["evaluator_admission_sha256", "external_reviewer_registry_sha256", "minimum_authority_epoch", "registry_id", "registry_issuer_id", "registry_public_key_pem", "registry_sha256", "schema", "trust_root_sha256", "version"], "Canonical evaluator root registry");
  exact(evaluatorRegistry, ["authority_epoch", "evaluators", "registry_id", "registry_sha256", "schema", "version"], "Canonical evaluator registry");
  exact(admission, ["admission_sha256", "authority_epoch", "expires_at_utc", "issued_at_utc", "issuer_id", "result", "schema", "scope", "separated_from_roles", "signature_base64", "subject_id", "subject_role", "version"], "Canonical evaluator admission");
  assert(rootRegistry.trust_root_sha256 === trustRoot.root_registry_sha256 && rootRegistry.registry_sha256 === trustRoot.registry_sha256 && rootRegistry.evaluator_admission_sha256 === trustRoot.admission_sha256, "Canonical evaluator trust-root references disagree");
  assert(rootRegistry.registry_public_key_pem === trustRoot.root_public_key_pem && rootRegistry.evaluator_admission_sha256 === admission.admission_sha256, "Canonical evaluator root key or admission differs");
  const evaluator = evaluatorRegistry.evaluators.find((entry) => entry.issuer_id === trustRoot.evaluator_id && entry.role_id === trustRoot.evaluator_role);
  assert(evaluator && evaluator.status === "ADMITTED" && evaluator.revoked_at_utc === null && evaluator.authority_epoch === trustRoot.authority_epoch, "Canonical evaluator is missing, revoked, or stale");
  assert(evaluator.public_key_pem === trustRoot.evaluator_public_key_pem && evaluator.admission_receipt_sha256 === admission.admission_sha256, "Canonical evaluator key or admission binding differs");
  assert(admission.issuer_id === rootRegistry.registry_issuer_id && admission.subject_id === trustRoot.evaluator_id && admission.subject_role === trustRoot.evaluator_role && admission.result === "ADMITTED" && admission.authority_epoch === trustRoot.authority_epoch, "Canonical evaluator admission identity differs");
  assert(Array.isArray(admission.scope) && admission.scope.includes("ADMISSION_BLOCKS") && admission.scope.includes("HOSTILE_REGRESSIONS"), "Canonical evaluator admission lacks independent package-review scope");
  assert(Number.isFinite(Date.parse(admission.issued_at_utc)) && Number.isFinite(Date.parse(admission.expires_at_utc)) && Date.parse(admission.issued_at_utc) <= Date.now() && Date.parse(admission.expires_at_utc) > Date.now(), "Canonical evaluator admission is stale or future-dated");
  assert(SHA.test(admission.admission_sha256) && admission.admission_sha256 === canonicalDigest(body(admission, ["admission_sha256", "signature_base64"])), "Canonical evaluator admission digest differs");
  verifySignature(admission, "signature_base64", rawPublicKey(trustRoot.root_public_key_pem));
  return Object.freeze({trustRoot, rootRegistry, evaluatorRegistry, admission, evaluator});
}

function loadProvisioning({testOnly = false} = {}) {
  const cached = testOnly ? testProvisioned : provisioned;
  if (cached !== undefined) return cached;
  let text;
  try { text = fs.readFileSync(PROVISIONING_FD, "utf8"); }
  catch { if (testOnly) testProvisioned = null; else provisioned = null; return null; }
  let envelope;
  try { envelope = JSON.parse(text); } catch { fail("External evaluator provisioning envelope is malformed"); }
  assert(envelope && envelope.schema === "agentos.external_evaluator_provisioning.v1" && envelope.version === 1, "External evaluator provisioning identity differs");
  const envelopeKeys = Object.keys(envelope).sort();
  const allowedKeys = ["authority_epoch", "evaluator_admission", "root_public_key_pem", "schema", "store_root", "version"];
  const productionKeys = [...allowedKeys, "trust_root_sha256"];
  if (testOnly) assert(JSON.stringify(envelopeKeys) === JSON.stringify(allowedKeys.sort()), "External evaluator provisioning fields differ");
  else assert(JSON.stringify(envelopeKeys) === JSON.stringify(productionKeys.sort()), "External evaluator trust-anchor provisioning is not canonical", "PERMANENT_ROLE_PRODUCTION_TRUST_ANCHOR_REQUIRED");
  const root = fs.realpathSync(envelope.store_root);
  assert(path.isAbsolute(root) && root === envelope.store_root && fs.lstatSync(root).isDirectory() && !fs.lstatSync(root).isSymbolicLink(), "External evaluator store root is unsafe");
  const rootKey = rawPublicKey(envelope.root_public_key_pem), admission = envelope.evaluator_admission;
  if (!testOnly) {
    const trust = loadCanonicalTrustRoot();
    assert(envelope.trust_root_sha256 === trust.trustRoot.trust_root_sha256 && envelope.root_public_key_pem === trust.trustRoot.root_public_key_pem, "External evaluator provisioning is not bound to the canonical trust root", "PERMANENT_ROLE_EXTERNAL_REVIEW_TRUST_ROOT_INVALID");
    assert(envelope.authority_epoch === trust.trustRoot.authority_epoch && JSON.stringify(admission) === JSON.stringify(trust.admission), "External evaluator admission is not the canonical admitted identity", "PERMANENT_ROLE_EXTERNAL_REVIEW_TRUST_ROOT_INVALID");
    verifySignature(admission, "signature_base64", rootKey);
    const state = Object.freeze({root, epoch: envelope.authority_epoch, evaluator: Object.freeze({evaluator_id: trust.trustRoot.evaluator_id, admission_sha256: trust.admission.admission_sha256, public_key_pem: trust.trustRoot.evaluator_public_key_pem}), evaluatorKey: rawPublicKey(trust.trustRoot.evaluator_public_key_pem), trust});
    provisioned = state; return state;
  }
  exact(admission, ["schema", "version", "evaluator_id", "public_key_pem", "scope", "authority_epoch", "status", "admitted_at_utc", "expires_at_utc", "revoked_at_utc", "admission_sha256", "root_signature_base64"], "External evaluator admission");
  assert(admission?.schema === "agentos.external_evaluator_admission.v1" && admission.version === 1 && Number.isSafeInteger(envelope.authority_epoch) && envelope.authority_epoch >= 1 && admission.authority_epoch === envelope.authority_epoch, "External evaluator admission identity differs");
  assert(admission.status === "ACTIVE" && admission.revoked_at_utc === null && admission.scope === "PERMANENT_ROLE_INDEPENDENT_REVIEW", "External evaluator is inactive, revoked, or out of scope");
  assert(admission.evaluator_id !== "AGENTOS.SPAWNER" && admission.evaluator_id !== "AGENTOS_CONTROLLER" && admission.evaluator_id !== "AGENTOS.PRODUCT_OWNER", "Builder/control identity cannot evaluate permanent roles");
  assert(Number.isFinite(Date.parse(admission.admitted_at_utc)) && Number.isFinite(Date.parse(admission.expires_at_utc)) && Date.parse(admission.admitted_at_utc) <= Date.now() && Date.parse(admission.expires_at_utc) > Date.now(), "External evaluator admission is stale or future-dated");
  assert(SHA.test(admission.admission_sha256) && admission.admission_sha256 === canonicalDigest(body(admission, ["admission_sha256", "root_signature_base64"])), "External evaluator admission digest differs");
  verifySignature(admission, "root_signature_base64", rootKey);
  testProvisioned = Object.freeze({root, epoch: envelope.authority_epoch, evaluator: Object.freeze({evaluator_id: admission.evaluator_id, admission_sha256: admission.admission_sha256, public_key_pem: admission.public_key_pem}), evaluatorKey: rawPublicKey(admission.public_key_pem)});
  return testProvisioned;
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
  assert(results.every((result) => result.semantic_execution_completed === true), "External review contains a pre-admission or incomplete fixture result", "OPERATIONAL_FIXTURE_EXECUTION_REQUIRED");
  assert(results.every((result) => result.actual_outcome === result.expected_outcome), "External review fixture outcome differs from the canonical expected outcome", "PERMANENT_ROLE_EXTERNAL_REVIEW_FIXTURE_FAILED");
  assert(results.every((result) => result.assertion_readbacks.every((entry) => entry.observed === true)), "External review contains an unobserved hostile assertion", "PERMANENT_ROLE_EXTERNAL_REVIEW_FIXTURE_FAILED");
}

function readReview(state, receiptRef) {
  assert(REF.test(receiptRef), "External review receipt reference is invalid");
  const reviewPath = safeFile(state.root, `reviews/${receiptRef.slice("ref:permanent-role-review/".length)}.json`);
  assert(fs.existsSync(reviewPath), "External review receipt is unknown", "PERMANENT_ROLE_EXTERNAL_REVIEW_UNKNOWN");
  return readJson(reviewPath);
}

function consumeReview({receiptRef, role, candidate, operationalContext, testOnly = false}) {
  const state = loadProvisioning({testOnly});
  assert(state, "External evaluator authority is not provisioned; permanent-role admission remains inactive", testOnly ? "PERMANENT_ROLE_EXTERNAL_REVIEW_PROVISIONING_REQUIRED" : "PERMANENT_ROLE_PRODUCTION_TRUST_ANCHOR_REQUIRED");
  const review = readReview(state, receiptRef), now = Date.now();
  exact(review, ["schema", "version", "receipt_ref", "evaluator_id", "evaluator_admission_sha256", "authority_epoch", "role_id", "role_class", "candidate_root_sha256", "package_block_sha256", "gate_inventory_sha256", "fixture_inventory_sha256", "fixture_results", "operational_context_sha256", "model_snapshot_sha256", "model_selection_sha256", "scope", "custody", "custody_receipt_sha256", "observed_at_utc", "expires_at_utc", "disposition", "review_sha256", "evaluator_signature_base64"], "External review");
  assert(review.schema === "agentos.permanent_role_external_review.v1" && review.version === 1 && review.disposition === "PASS", "External review disposition or identity differs");
  assert(review.receipt_ref === receiptRef && review.evaluator_id === state.evaluator.evaluator_id && review.evaluator_admission_sha256 === state.evaluator.admission_sha256 && review.authority_epoch === state.epoch, "External review evaluator authority binding differs");
  assert(review.role_id === role.role_id && review.role_class === role.role_class && review.candidate_root_sha256 === candidate.candidate_root_sha256 && review.package_block_sha256 === candidate.block_sha256, "External review candidate binding differs");
  assert(review.gate_inventory_sha256 === canonicalDigest(candidate.gates) && review.fixture_inventory_sha256 === canonicalDigest(candidate.fixtures), "External review gate/fixture inventory binding differs");
  assert(review.operational_context_sha256 === operationalContext.context_sha256 && review.model_snapshot_sha256 === operationalContext.snapshot_sha256 && review.model_selection_sha256 === canonicalDigest(operationalContext.compact_selection), "External review global model context differs");
  assert(review.scope === "FULL_PERMANENT_ROLE_PACKAGE" && review.custody === "SEPARATE_EXTERNAL_EVALUATOR" && review.evaluator_id !== role.role_id, "External review scope/custody/independence differs");
  assert(Number.isFinite(Date.parse(review.observed_at_utc)) && Number.isFinite(Date.parse(review.expires_at_utc)) && Date.parse(review.observed_at_utc) <= now && now - Date.parse(review.observed_at_utc) <= 86_400_000 && now < Date.parse(review.expires_at_utc), "External review is stale or future-dated");
  assert(SHA.test(review.review_sha256) && review.review_sha256 === canonicalDigest(body(review, ["review_sha256", "evaluator_signature_base64"])), "External review digest differs");
  verifySignature(review, "evaluator_signature_base64", state.evaluatorKey);
  validateFixtureResults(review, candidate);
  if (testOnly) return Object.freeze({status: "TEST_ONLY_REVIEW_VERIFIED", review_sha256: review.review_sha256, receipt_ref: review.receipt_ref});
  const ledgerPath = safeFile(state.root, "consumptions.jsonl"), lockPath = `${ledgerPath}.lock`;
  let lock;
  try { lock = fs.openSync(lockPath, "wx", 0o600); } catch (error) { if (error.code === "EEXIST") fail("Permanent-role review consumption is concurrently locked", "PERMANENT_ROLE_EXTERNAL_REVIEW_CONCURRENT"); throw error; }
  try {
    const prior = fs.existsSync(ledgerPath) ? fs.readFileSync(ledgerPath, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
    assert(!prior.some((entry) => entry.receipt_ref === review.receipt_ref || entry.review_sha256 === review.review_sha256), "Permanent-role review receipt was already consumed", "PERMANENT_ROLE_EXTERNAL_REVIEW_REPLAY");
    const event = {schema: "agentos.permanent_role_review_consumption.v1", version: 1, sequence: prior.length + 1, receipt_ref: review.receipt_ref, review_sha256: review.review_sha256, role_id: role.role_id, candidate_root_sha256: candidate.candidate_root_sha256, prior_event_sha256: prior.at(-1)?.event_sha256 ?? null, consumed_at_utc: new Date().toISOString(), event_sha256: null};
    event.event_sha256 = canonicalDigest(body(event, ["event_sha256"]));
    fs.appendFileSync(ledgerPath, `${canonicalJson(event)}\n`, {mode: 0o600});
    const descriptor = fs.openSync(ledgerPath, "r"); try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    const custodyReceiptSha256 = review.custody_receipt_sha256;
    const receipt = {schema: "agentos.permanent_role_governed_admission.v1", version: 1, status: "ADMITTED_ONE_USE", role_id: role.role_id, role_class: role.role_class, receipt_ref: review.receipt_ref, candidate_root_sha256: candidate.candidate_root_sha256, package_block_sha256: candidate.block_sha256, gate_inventory_sha256: review.gate_inventory_sha256, fixture_execution_sha256: canonicalDigest(review.fixture_results), external_review_receipt_sha256: review.review_sha256, evaluator_admission_receipt_sha256: review.evaluator_admission_sha256, operational_context_sha256: review.operational_context_sha256, model_snapshot_sha256: review.model_snapshot_sha256, model_selection_sha256: review.model_selection_sha256, custody_receipt_sha256: custodyReceiptSha256, consumption_event_sha256: event.event_sha256, receipt_sha256: null};
    receipt.receipt_sha256 = canonicalDigest(body(receipt, ["receipt_sha256"]));
    const admissionDirectory = path.resolve(state.root, "admissions"); assert(admissionDirectory.startsWith(`${state.root}${path.sep}`), "Permanent-role admission directory escaped its store"); fs.mkdirSync(admissionDirectory, {recursive: true});
    fs.writeFileSync(path.join(admissionDirectory, `${receipt.receipt_sha256}.json`), `${canonicalJson(receipt)}\n`, {mode: 0o600});
    return Object.freeze(receipt);
  } finally { fs.closeSync(lock); if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath); }
}

export function consumeProvisionedPermanentRoleReview(options = {}) { return consumeReview({...options, testOnly: false}); }

/* Non-authoritative verifier exercised only by the dedicated child harness. It can only reject until a sealed adapter exists. */
export function verifyTestOnlyProvisionedPermanentRoleReview(options = {}) {
  return consumeReview({...options, testOnly: true});
}
