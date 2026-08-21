#!/usr/bin/env node

/*
 * Candidate-bound external Repair review consumer.
 *
 * The evaluator's private key never enters this repository.  Bootstrap derives
 * the only review directory from the sealed Git common directory and the exact
 * frozen candidate commit.  The evaluator registry/admission are root-signed;
 * the review and one-use clearance are evaluator-signed; consumption is a
 * durable append-only operation in the external control-plane store.
 */

import fs from "node:fs";
import path from "node:path";
import {createPublicKey, createHash, verify} from "node:crypto";
import {execFileSync} from "node:child_process";
import {canonicalDigest, canonicalJson, compareUtf8} from "./content-addressing.mjs";
import {assertSealedCanonicalAuthority, readSealedAuthorityBinding, sealedAuthorityRepositoryRoot} from "./sealed-canonical-authority.mjs";

export const REPAIR_EXTERNAL_REVIEW_SCHEMA = "agentos.repair_external_review.v1";
export const REPAIR_EXTERNAL_CLEARANCE_SCHEMA = "agentos.repair_external_clearance.v1";
export const REPAIR_EXTERNAL_SCOPE = "REPAIR_PACKAGE_REVIEW";

const SHA = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const REF = /^ref:temporary-role-review\/[0-9a-f]{64}$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const REVIEW_ROOT = "agentos-independent-evaluator";

function fail(message, code = "REPAIR_EXTERNAL_REVIEW_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function exact(value, keys, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert(JSON.stringify(Object.keys(value).sort(compareUtf8)) === JSON.stringify([...keys].sort(compareUtf8)), `${label} fields differ`, "REPAIR_EXTERNAL_REVIEW_SCHEMA_INVALID");
}
function sha(value, label) { assert(typeof value === "string" && SHA.test(value), `${label} must be a SHA-256`); }
function utc(value, label) { assert(typeof value === "string" && ISO_UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} must be UTC`); }
function body(value, fields) { const copy = structuredClone(value); for (const field of fields) copy[field] = null; return copy; }
function fileSha(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function git(root, args) {
  try { return execFileSync("git", ["-C", root, ...args], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim(); }
  catch { fail("Repair external review Git readback failed", "REPAIR_EXTERNAL_REVIEW_GIT_READBACK_REQUIRED"); }
}
function publicKey(pem, label) { try { return createPublicKey(pem); } catch { fail(`${label} public key is invalid`, "REPAIR_EXTERNAL_REVIEW_KEY_INVALID"); } }
function verifySignature(record, signatureField, key, label) {
  const signature = record[signatureField];
  assert(typeof signature === "string" && /^[A-Za-z0-9+/]+={0,2}$/u.test(signature), `${label} signature is invalid`);
  assert(verify(null, Buffer.from(canonicalJson(body(record, [signatureField])), "utf8"), key, Buffer.from(signature, "base64")), `${label} signature verification failed`, "REPAIR_EXTERNAL_REVIEW_SIGNATURE_INVALID");
}
function safeRoot(root) {
  assert(typeof root === "string" && path.isAbsolute(root), "Repair external review root is not absolute");
  let real;
  let stat;
  try { real = fs.realpathSync.native(root); stat = fs.lstatSync(root); }
  catch { fail("Repair external review artifacts are not provisioned", "REPAIR_EXTERNAL_REVIEW_PROVISIONING_REQUIRED"); }
  assert(real === root && stat.isDirectory() && !stat.isSymbolicLink(), "Repair external review root is not a canonical directory");
  return real;
}
function safeFile(root, relative, label) {
  assert(typeof relative === "string" && !path.isAbsolute(relative) && !relative.split(/[\\/]/u).some((part) => part === "" || part === ".."), `${label} path is unsafe`);
  const target = path.resolve(root, relative);
  assert(target.startsWith(`${root}${path.sep}`), `${label} escaped the external review root`);
  assert(fs.existsSync(target), `${label} is missing`, "REPAIR_EXTERNAL_REVIEW_PROVISIONING_REQUIRED");
  const stat = fs.lstatSync(target);
  assert(stat.isFile() && !stat.isSymbolicLink() && fs.realpathSync.native(target) === target, `${label} is not a canonical file`);
  return target;
}
function readJson(root, relative, label) {
  const target = safeFile(root, relative, label);
  let value; try { value = JSON.parse(fs.readFileSync(target, "utf8")); } catch { fail(`${label} is not valid JSON`); }
  return Object.freeze({value, file_sha256: fileSha(fs.readFileSync(target)), target});
}

function externalRoot(sealedAuthority, candidateCommit) {
  const repositoryRoot = sealedAuthorityRepositoryRoot(sealedAuthority);
  const common = safeRoot(git(repositoryRoot, ["rev-parse", "--path-format=absolute", "--git-common-dir"]));
  const root = path.join(common, REVIEW_ROOT, candidateCommit, "repair");
  assert(root.startsWith(`${common}${path.sep}`), "Repair external review root escaped Git custody");
  return safeRoot(root);
}

function loadCanonicalRoot(sealedAuthority) {
  const root = readSealedAuthorityBinding(sealedAuthority, "spawner_canonical_evaluator_trust_root").value;
  exact(root, ["evaluator_admission_sha256", "external_reviewer_registry_sha256", "minimum_authority_epoch", "registry_id", "registry_issuer_id", "registry_public_key_pem", "registry_sha256", "schema", "trust_root_sha256", "version"], "Canonical evaluator trust root");
  assert(root.schema === "agentos.canonical_evaluator_trust_root.v1" && root.version === 1, "Canonical evaluator trust-root identity differs");
  sha(root.trust_root_sha256, "Canonical evaluator trust-root digest");
  assert(root.trust_root_sha256 === canonicalDigest(body(root, ["trust_root_sha256"])), "Canonical evaluator trust-root digest differs");
  return Object.freeze(root);
}

function loadRegistry(root, canonicalRoot) {
  const artifact = readJson(root, "evaluator-registry.v1.json", "Repair evaluator registry");
  const registry = artifact.value;
  exact(registry, ["schema", "version", "registry_id", "canonical_trust_root_sha256", "authority_epoch", "evaluator_id", "evaluator_role", "scope", "public_key_pem", "valid_from_utc", "expires_at_utc", "revoked_at_utc", "admission_sha256", "registry_sha256", "root_signature_base64"], "Repair evaluator registry");
  assert(registry.schema === "agentos.repair_external_evaluator_registry.v1" && registry.version === 1, "Repair evaluator registry identity differs");
  assert(registry.canonical_trust_root_sha256 === canonicalRoot.trust_root_sha256 && registry.registry_id === canonicalRoot.registry_id, "Repair evaluator registry is bound to another trust root", "REPAIR_EXTERNAL_REVIEW_TRUST_ROOT_INVALID");
  assert(registry.authority_epoch >= canonicalRoot.minimum_authority_epoch && Number.isSafeInteger(registry.authority_epoch), "Repair evaluator authority epoch is stale");
  assert(registry.evaluator_id !== "AGENTOS.SPAWNER" && registry.evaluator_id !== "AGENTOS_CONTROLLER" && registry.evaluator_id !== "AGENTOS.REPAIR", "Spawner, Controller, or Repair cannot be the independent evaluator", "REPAIR_EXTERNAL_REVIEW_SELF_ISSUER");
  assert(registry.evaluator_role === "AGENT.INDEPENDENT_EVALUATOR" && registry.scope === REPAIR_EXTERNAL_SCOPE, "Repair evaluator scope is invalid");
  utc(registry.valid_from_utc, "Repair evaluator valid-from time"); utc(registry.expires_at_utc, "Repair evaluator expiry");
  assert(registry.revoked_at_utc === null, "Repair evaluator is revoked", "REPAIR_EXTERNAL_REVIEW_REVOKED");
  assert(Date.parse(registry.valid_from_utc) <= Date.now() && Date.parse(registry.expires_at_utc) > Date.now(), "Repair evaluator registry is stale or future-dated", "REPAIR_EXTERNAL_REVIEW_EVALUATOR_STALE");
  sha(registry.admission_sha256, "Repair evaluator admission binding"); sha(registry.registry_sha256, "Repair evaluator registry digest");
  assert(registry.registry_sha256 === canonicalDigest(body(registry, ["registry_sha256", "root_signature_base64"])), "Repair evaluator registry digest differs");
  verifySignature(registry, "root_signature_base64", publicKey(canonicalRoot.registry_public_key_pem, "Canonical root"), "Repair evaluator registry");
  return Object.freeze({registry, file_sha256: artifact.file_sha256});
}

function loadAdmission(root, canonicalRoot, registry) {
  const artifact = readJson(root, "evaluator-admission.v1.json", "Repair evaluator admission");
  const admission = artifact.value;
  exact(admission, ["schema", "version", "evaluator_id", "evaluator_role", "scope", "authority_epoch", "issued_at_utc", "expires_at_utc", "status", "admission_sha256", "root_signature_base64"], "Repair evaluator admission");
  assert(admission.schema === "agentos.repair_external_evaluator_admission.v1" && admission.version === 1 && admission.status === "ACTIVE", "Repair evaluator admission identity differs");
  assert(admission.evaluator_id === registry.registry.evaluator_id && admission.evaluator_role === registry.registry.evaluator_role && admission.scope === registry.registry.scope && admission.authority_epoch === registry.registry.authority_epoch, "Repair evaluator admission and registry disagree");
  utc(admission.issued_at_utc, "Repair evaluator admission issue time"); utc(admission.expires_at_utc, "Repair evaluator admission expiry");
  assert(Date.parse(admission.issued_at_utc) <= Date.now() && Date.parse(admission.expires_at_utc) > Date.now(), "Repair evaluator admission is stale or future-dated", "REPAIR_EXTERNAL_REVIEW_EVALUATOR_STALE");
  sha(admission.admission_sha256, "Repair evaluator admission digest");
  assert(admission.admission_sha256 === registry.registry.admission_sha256 && admission.admission_sha256 === canonicalDigest(body(admission, ["admission_sha256", "root_signature_base64"])), "Repair evaluator admission digest differs");
  verifySignature(admission, "root_signature_base64", publicKey(canonicalRoot.registry_public_key_pem, "Canonical root"), "Repair evaluator admission");
  return Object.freeze({admission, file_sha256: artifact.file_sha256});
}

function validateFixtureResults(review, candidate) {
  assert(Array.isArray(review.fixture_results) && review.fixture_results.length === candidate.fixtures.length, "Repair review fixture coverage is incomplete", "REPAIR_EXTERNAL_REVIEW_FIXTURE_COVERAGE");
  const expected = new Map(candidate.fixtures.map((fixture) => [fixture.fixture_id, fixture]));
  assert(new Set(review.fixture_results.map((result) => result.fixture_id)).size === candidate.fixtures.length, "Repair review fixture results contain aliases", "REPAIR_EXTERNAL_REVIEW_FIXTURE_COVERAGE");
  for (const result of review.fixture_results) {
    exact(result, ["fixture_id", "fixture_class", "fixture_file_sha256", "entrypoint", "entrypoint_invoked", "semantic_execution_completed", "expected_outcome", "actual_outcome", "error_code", "exit_code", "assertion_readbacks", "side_effect_spy_readback", "executed_at_utc", "result_sha256"], "Repair fixture result");
    const fixture = expected.get(result.fixture_id);
    assert(fixture && result.fixture_class === fixture.class && result.fixture_file_sha256 === fixture.file_sha256 && result.entrypoint === fixture.entrypoint, "Repair fixture result binding differs");
    assert(result.entrypoint_invoked === true && result.semantic_execution_completed === true && result.expected_outcome === fixture.expected && result.actual_outcome === result.expected_outcome, "Repair fixture execution is incomplete or failed", "REPAIR_EXTERNAL_REVIEW_FIXTURE_FAILED");
    exact(result.side_effect_spy_readback, ["adapter_calls", "state_changes", "memory_writes", "deploy_calls"], "Repair fixture side-effect readback");
    assert(Object.values(result.side_effect_spy_readback).every((value) => Number.isSafeInteger(value) && value >= 0), "Repair fixture side-effect counts are invalid");
    assert(Array.isArray(result.assertion_readbacks) && result.assertion_readbacks.length >= 3 && result.assertion_readbacks.every((entry) => entry && typeof entry.assertion === "string" && typeof entry.observed === "boolean" && typeof entry.evidence === "string"), "Repair fixture assertions are incomplete");
    assert(result.assertion_readbacks.every((entry) => entry.observed === true), "Repair fixture contains an unobserved assertion", "REPAIR_EXTERNAL_REVIEW_FIXTURE_FAILED");
    utc(result.executed_at_utc, "Repair fixture execution time"); sha(result.result_sha256, "Repair fixture result digest");
    assert(result.result_sha256 === canonicalDigest(body(result, ["result_sha256"])), "Repair fixture result digest differs");
  }
}

function loadReview(root, registry, admission, candidate, operationalContext, receiptRef) {
  assert(REF.test(receiptRef), "Repair review receipt reference is invalid");
  const artifact = readJson(root, `review-${receiptRef.slice("ref:temporary-role-review/".length)}.v1.json`, "Repair external review receipt");
  const review = artifact.value;
  exact(review, ["schema", "version", "receipt_ref", "evaluator_id", "evaluator_admission_sha256", "authority_epoch", "role_id", "role_class", "candidate_commit", "candidate_tree", "candidate_root_sha256", "package_block_sha256", "gate_inventory_sha256", "fixture_inventory_sha256", "fixture_results", "operational_context_sha256", "model_snapshot_sha256", "model_selection_sha256", "scope", "custody", "custody_receipt_sha256", "observed_at_utc", "expires_at_utc", "disposition", "review_sha256", "evaluator_signature_base64"], "Repair external review");
  assert(review.schema === REPAIR_EXTERNAL_REVIEW_SCHEMA && review.version === 1 && review.receipt_ref === receiptRef && review.disposition === "PASS", "Repair review disposition or identity differs");
  assert(review.evaluator_id === registry.registry.evaluator_id && review.evaluator_admission_sha256 === admission.admission.admission_sha256 && review.authority_epoch === registry.registry.authority_epoch, "Repair review evaluator binding differs");
  assert(review.role_id === "AGENTOS.REPAIR" && review.role_class === "REPAIR" && review.candidate_commit === candidate.candidate_commit && review.candidate_tree === candidate.candidate_tree && review.candidate_root_sha256 === candidate.candidate_root_sha256 && review.package_block_sha256 === candidate.block_sha256, "Repair review candidate binding differs");
  assert(review.gate_inventory_sha256 === candidate.gate_inventory_sha256 && review.fixture_inventory_sha256 === candidate.fixture_inventory_sha256, "Repair review gate or fixture inventory differs");
  assert(review.operational_context_sha256 === operationalContext.context_sha256 && review.model_snapshot_sha256 === operationalContext.snapshot_sha256 && review.model_selection_sha256 === canonicalDigest(operationalContext.compact_selection), "Repair review global model context differs");
  assert(review.scope === REPAIR_EXTERNAL_SCOPE && review.custody === "SEPARATE_EXTERNAL_EVALUATOR" && review.evaluator_id !== review.role_id, "Repair review scope or custody is invalid");
  utc(review.observed_at_utc, "Repair review observation time"); utc(review.expires_at_utc, "Repair review expiry");
  assert(Date.parse(review.observed_at_utc) <= Date.now() && Date.parse(review.expires_at_utc) > Date.now() && Date.now() - Date.parse(review.observed_at_utc) <= 86_400_000, "Repair external review is stale or future-dated", "REPAIR_EXTERNAL_REVIEW_STALE");
  sha(review.review_sha256, "Repair review digest"); assert(review.review_sha256 === canonicalDigest(body(review, ["review_sha256", "evaluator_signature_base64"])), "Repair review digest differs");
  validateFixtureResults(review, candidate);
  verifySignature(review, "evaluator_signature_base64", publicKey(registry.registry.public_key_pem, "Repair evaluator"), "Repair review");
  return Object.freeze({review, file_sha256: artifact.file_sha256});
}

function loadClearance(root, registry, admission, candidate, operationalContext, review) {
  const artifact = readJson(root, `clearance-${review.review.review_sha256}.v1.json`, "Repair external clearance");
  const clearance = artifact.value;
  exact(clearance, ["schema", "version", "receipt_ref", "evaluator_id", "evaluator_admission_sha256", "authority_epoch", "role_id", "role_class", "candidate_commit", "candidate_tree", "candidate_root_sha256", "review_sha256", "operational_context_sha256", "model_snapshot_sha256", "model_selection_sha256", "scope", "custody_receipt_sha256", "issued_at_utc", "expires_at_utc", "status", "nonce_sha256", "clearance_sha256", "evaluator_signature_base64"], "Repair external clearance");
  assert(clearance.schema === REPAIR_EXTERNAL_CLEARANCE_SCHEMA && clearance.version === 1 && clearance.status === "GRANTED", "Repair external clearance identity differs");
  assert(clearance.receipt_ref === review.review.receipt_ref && clearance.evaluator_id === registry.registry.evaluator_id && clearance.evaluator_admission_sha256 === admission.admission.admission_sha256 && clearance.authority_epoch === registry.registry.authority_epoch, "Repair clearance evaluator binding differs");
  assert(clearance.role_id === "AGENTOS.REPAIR" && clearance.role_class === "REPAIR" && clearance.candidate_commit === candidate.candidate_commit && clearance.candidate_tree === candidate.candidate_tree && clearance.candidate_root_sha256 === candidate.candidate_root_sha256 && clearance.review_sha256 === review.review.review_sha256, "Repair clearance candidate or review binding differs");
  assert(clearance.operational_context_sha256 === operationalContext.context_sha256 && clearance.model_snapshot_sha256 === operationalContext.snapshot_sha256 && clearance.model_selection_sha256 === canonicalDigest(operationalContext.compact_selection) && clearance.scope === REPAIR_EXTERNAL_SCOPE, "Repair clearance context or scope differs");
  sha(clearance.custody_receipt_sha256, "Repair clearance custody receipt"); sha(clearance.nonce_sha256, "Repair clearance nonce"); utc(clearance.issued_at_utc, "Repair clearance issue time"); utc(clearance.expires_at_utc, "Repair clearance expiry");
  assert(Date.parse(clearance.issued_at_utc) <= Date.now() && Date.parse(clearance.expires_at_utc) > Date.now(), "Repair clearance is stale or future-dated", "REPAIR_EXTERNAL_CLEARANCE_STALE");
  sha(clearance.clearance_sha256, "Repair clearance digest"); assert(clearance.clearance_sha256 === canonicalDigest(body(clearance, ["clearance_sha256", "evaluator_signature_base64"])), "Repair clearance digest differs");
  verifySignature(clearance, "evaluator_signature_base64", publicKey(registry.registry.public_key_pem, "Repair evaluator"), "Repair clearance");
  return Object.freeze({clearance, file_sha256: artifact.file_sha256});
}

function consumeOnce(root, review, clearance, candidate) {
  const ledgerPath = path.resolve(root, "consumptions.jsonl");
  assert(ledgerPath.startsWith(`${root}${path.sep}`), "Repair review ledger escaped external root");
  if (fs.existsSync(ledgerPath)) {
    const stat = fs.lstatSync(ledgerPath);
    assert(stat.isFile() && !stat.isSymbolicLink() && fs.realpathSync.native(ledgerPath) === ledgerPath, "Repair review consumption ledger is not a canonical file");
  }
  const lockPath = `${ledgerPath}.lock`;
  let lockFd;
  try { lockFd = fs.openSync(lockPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600); fs.writeFileSync(lockFd, `${JSON.stringify({schema: "agentos.repair_review_consumption_lock.v1", pid: process.pid})}\n`); fs.fsyncSync(lockFd); fs.closeSync(lockFd); lockFd = undefined; }
  catch (error) { if (lockFd !== undefined) fs.closeSync(lockFd); if (error.code === "EEXIST") fail("Repair review consumption is concurrently locked", "REPAIR_EXTERNAL_REVIEW_CONCURRENT"); throw error; }
  try {
    const prior = fs.existsSync(ledgerPath) ? fs.readFileSync(ledgerPath, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
    for (let index = 0; index < prior.length; index += 1) {
      const previous = prior[index];
      assert(previous && previous.schema === "agentos.repair_review_consumption.v1" && previous.version === 1 && previous.sequence === index, "Repair review consumption ledger sequence is invalid", "REPAIR_EXTERNAL_REVIEW_LEDGER_INVALID");
      assert(previous.event_sha256 === canonicalDigest(body(previous, ["event_sha256"])), "Repair review consumption ledger digest is invalid", "REPAIR_EXTERNAL_REVIEW_LEDGER_INVALID");
      assert(previous.prior_event_sha256 === (index === 0 ? null : prior[index - 1].event_sha256), "Repair review consumption ledger chain is invalid", "REPAIR_EXTERNAL_REVIEW_LEDGER_INVALID");
    }
    assert(!prior.some((entry) => entry.receipt_ref === review.receipt_ref || entry.review_sha256 === review.review_sha256 || entry.clearance_sha256 === clearance.clearance_sha256), "Repair clearance was already consumed", "REPAIR_EXTERNAL_REVIEW_REPLAY");
    const event = {schema: "agentos.repair_review_consumption.v1", version: 1, sequence: prior.length, receipt_ref: review.receipt_ref, review_sha256: review.review_sha256, clearance_sha256: clearance.clearance_sha256, candidate_commit: candidate.candidate_commit, candidate_tree: candidate.candidate_tree, candidate_root_sha256: candidate.candidate_root_sha256, consumed_at_utc: new Date().toISOString(), prior_event_sha256: prior.at(-1)?.event_sha256 ?? null, event_sha256: null};
    event.event_sha256 = canonicalDigest(body(event, ["event_sha256"]));
    fs.appendFileSync(ledgerPath, `${canonicalJson(event)}\n`, {mode: 0o600});
    const fd = fs.openSync(ledgerPath, "r"); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    return Object.freeze(event);
  } finally { try { fs.unlinkSync(lockPath); } catch (error) { if (error.code !== "ENOENT") throw error; } }
}

export function consumeCanonicalRepairExternalReview(options = {}) {
  assert(options && typeof options === "object" && !Array.isArray(options), "Repair external review input must be an object");
  assert(JSON.stringify(Object.keys(options).sort(compareUtf8)) === JSON.stringify(["candidate", "operationalContext", "receiptRef", "sealedAuthority"].sort(compareUtf8)), "Repair external review accepts only sealed candidate context and receipt reference", "REPAIR_EXTERNAL_REVIEW_CALLER_AUTHORITY_FORBIDDEN");
  const {sealedAuthority, candidate, operationalContext, receiptRef} = options;
  assertSealedCanonicalAuthority(sealedAuthority);
  assert(candidate && candidate.role_id === "AGENTOS.REPAIR" && SHA.test(candidate.candidate_root_sha256) && SHA.test(candidate.block_sha256) && SHA.test(candidate.gate_inventory_sha256) && SHA.test(candidate.fixture_inventory_sha256), "Repair candidate binding is invalid");
  assert(GIT_OBJECT.test(candidate.candidate_commit) && GIT_OBJECT.test(candidate.candidate_tree), "Repair candidate Git identity is missing");
  assert(operationalContext && operationalContext.role_class === "WORKING_AGENT" && SHA.test(operationalContext.context_sha256) && SHA.test(operationalContext.snapshot_sha256), "Repair model context binding is invalid");
  const canonicalRoot = loadCanonicalRoot(sealedAuthority);
  const root = externalRoot(sealedAuthority, candidate.candidate_commit);
  const registry = loadRegistry(root, canonicalRoot);
  const admission = loadAdmission(root, canonicalRoot, registry);
  const review = loadReview(root, registry, admission, candidate, operationalContext, receiptRef);
  const clearance = loadClearance(root, registry, admission, candidate, operationalContext, review);
  const consumption = consumeOnce(root, review.review, clearance.clearance, candidate);
  return Object.freeze({schema: "agentos.repair_external_review_consumption.v1", version: 1, status: "CONSUMED_ONE_USE", receipt_ref: review.review.receipt_ref, evaluator_id: registry.registry.evaluator_id, evaluator_admission_sha256: admission.admission.admission_sha256, review_sha256: review.review.review_sha256, clearance_sha256: clearance.clearance.clearance_sha256, consumption_event_sha256: consumption.event_sha256, candidate_commit: candidate.candidate_commit, candidate_tree: candidate.candidate_tree, candidate_root_sha256: candidate.candidate_root_sha256, registry_file_sha256: registry.file_sha256, admission_file_sha256: admission.file_sha256, review_file_sha256: review.file_sha256, clearance_file_sha256: clearance.file_sha256});
}
