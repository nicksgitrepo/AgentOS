#!/usr/bin/env node

/*
 * Disposable positive-path proof.  This deliberately creates a fresh Git
 * clone, trust root, evaluator key, and review receipt outside the repository.
 * It never installs test authority into the real AgentOS checkout and never
 * treats the generated key as production trust material.
 */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {fileURLToPath, pathToFileURL} from "node:url";
import {canonicalDigest, canonicalJson, compareUtf8} from "../control/content-addressing.mjs";

const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_ROOT = "specialist-blocks/control-plane/agent-spawner";
const REVIEW_SCOPE = ["CANDIDATE_COMPONENT_ROOT", "GATE_BYTES", "HOSTILE_FIXTURE_EXECUTION"];
const GLOBAL_REVIEW_LEDGER_NAME = "spawner-external-review-consumption.v1.jsonl";

function git(root, args) { return execFileSync("git", ["-C", root, ...args], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim(); }
function sha(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
function pem(key) { return key.export({type: "spki", format: "pem"}); }
function sign(value, digestField, signatureField, privateKey) {
  value[digestField] = canonicalDigest({...value, [digestField]: null, [signatureField]: null});
  value[signatureField] = crypto.sign(null, Buffer.from(value[digestField], "hex"), privateKey).toString("base64");
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700});
  fs.writeFileSync(file, `${canonicalJson(value)}\n`, {flag: "w", mode: 0o600});
}
function inventory(receipt, evaluation) {
  return evaluation.results.map((entry) => ({
    fixture_id: entry.fixture_id,
    gate_id: entry.gate_id,
    result: entry.result,
    actual_outcome: entry.actual_outcome,
    error_code: entry.error_code,
  })).sort((left, right) => compareUtf8(left.fixture_id, right.fixture_id));
}

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-spawner-external-positive-"));
const cloneRoot = path.join(temporaryRoot, "repo");
try {
  execFileSync("git", ["clone", "--no-local", SOURCE_ROOT, cloneRoot], {stdio: ["ignore", "ignore", "pipe"]});
  git(cloneRoot, ["config", "user.name", "AgentOS disposable evaluator"]);
  git(cloneRoot, ["config", "user.email", "agentos-disposable-evaluator@example.invalid"]);

  const registryKeys = crypto.generateKeyPairSync("ed25519");
  const reviewerKeys = crypto.generateKeyPairSync("ed25519");
  const issuedAtUtc = new Date(Date.now() - 1_000).toISOString();
  const expiresAtUtc = new Date(Date.now() + 60 * 60 * 1_000).toISOString();
  const predecessor = git(cloneRoot, ["rev-parse", "HEAD^"]);
  const admission = {
    schema: "agentos.external_reviewer_admission.v1",
    version: 1,
    issuer_id: "REGISTRY.DISPOSABLE.EXTERNAL.REVIEW",
    subject_id: "EVALUATOR.DISPOSABLE.EXTERNAL.REVIEW",
    subject_role: "AGENT.INDEPENDENT_EVALUATOR",
    scope: REVIEW_SCOPE,
    result: "ADMITTED",
    authority_epoch: 1,
    issued_at_utc: issuedAtUtc,
    expires_at_utc: expiresAtUtc,
    receipt_sha256: null,
    signature_base64: null,
  };
  sign(admission, "receipt_sha256", "signature_base64", registryKeys.privateKey);
  const registry = {
    schema: "agentos.external_spawner_reviewer_registry.v1",
    version: 1,
    authority_epoch: 1,
    registry_issuer_id: admission.issuer_id,
    registry_public_key_pem: pem(registryKeys.publicKey),
    authorized_predecessor_commit: predecessor,
    reviewers: [{
      reviewer_id: admission.subject_id,
      role: admission.subject_role,
      status: "ADMITTED",
      authority_epoch: 1,
      public_key_pem: pem(reviewerKeys.publicKey),
      admission_receipt: admission,
    }],
    registry_sha256: null,
  };
  registry.registry_sha256 = canonicalDigest({...registry, registry_sha256: null});

  const registryPath = path.join(cloneRoot, PACKAGE_ROOT, "external-reviewer-registry.v1.json");
  writeJson(registryPath, registry);
  const bindingPath = path.join(cloneRoot, "schemas/bootstrap-binding.v1.json");
  const binding = JSON.parse(fs.readFileSync(bindingPath, "utf8"));
  binding.normative.spawner_external_reviewer_registry.sha256 = sha(fs.readFileSync(registryPath));
  writeJson(bindingPath, binding);
  git(cloneRoot, ["add", "schemas/bootstrap-binding.v1.json", `${PACKAGE_ROOT}/external-reviewer-registry.v1.json`]);
  git(cloneRoot, ["commit", "-m", "Create disposable external evaluator trust root"]);

  const candidateCommit = git(cloneRoot, ["rev-parse", "HEAD"]);
  const gitCommon = fs.realpathSync.native(git(cloneRoot, ["rev-parse", "--path-format=absolute", "--git-common-dir"]));
  const reviewRoot = path.join(gitCommon, "agentos-independent-evaluator", candidateCommit, "review");
  fs.mkdirSync(path.join(reviewRoot, "receipts"), {recursive: true, mode: 0o700});
  writeJson(path.join(reviewRoot, "reviewer-registry.v1.json"), registry);

  // Keep the clone's sealed-authority module on one URL.  A query-string
  // import would create a second WeakMap and make the opaque capability look
  // forged to the modules that consume it.
  const sealed = await import(pathToFileURL(path.join(cloneRoot, "control/sealed-canonical-authority.mjs")).href);
  const governance = await import(pathToFileURL(path.join(cloneRoot, "control/spawner-bootstrap-governance.mjs")).href);
  const ancestryModule = await import(pathToFileURL(path.join(cloneRoot, "control/spawner-git-ancestry.mjs")).href);
  const provisioning = await import(pathToFileURL(path.join(cloneRoot, "control/protected-spawner-review-provisioning.mjs")).href);
  const review = await import(pathToFileURL(path.join(cloneRoot, "control/spawner-external-review.mjs")).href);
  const sealedAuthority = sealed.getSealedCanonicalAuthority();
  const candidate = governance.prepareCanonicalSpawnerBootstrapCandidateForIndependentEvaluation();
  const evaluation = candidate.hostile_evaluation;
  const ancestry = ancestryModule.resolveSpawnerGitAncestry({repositoryRoot: cloneRoot, candidateCommit, authorizedPredecessor: predecessor});
  const results = inventory(candidate, evaluation);
  const receipt = {
    schema: "agentos.external_spawner_review_receipt.v1",
    version: 1,
    receipt_id: "REVIEW.DISPOSABLE.EXTERNAL.SPAWNER",
    reviewer_id: admission.subject_id,
    reviewer_role: admission.subject_role,
    authority_epoch: 1,
    git_ancestry: ancestry,
    candidate_package_sha256: candidate.spawner_package.package_sha256,
    candidate_package_file_sha256: candidate.package_file_sha256,
    candidate_root_sha256: candidate.review_candidate_root_sha256,
    gate_manifest_sha256: candidate.manifest.manifest_sha256,
    fixture_manifest_sha256: candidate.fixture_manifest.manifest_sha256,
    hostile_evaluation_sha256: evaluation.evaluation_sha256,
    fixture_result_count: results.length,
    fixture_inventory_sha256: canonicalDigest(results),
    scope: REVIEW_SCOPE,
    custody: {read_only_candidate: true, builder_separated: true, governance_write_capability: false},
    result: "PASS",
    issued_at_utc: issuedAtUtc,
    expires_at_utc: expiresAtUtc,
    nonce_sha256: canonicalDigest({nonce: crypto.randomBytes(32).toString("hex")}),
    receipt_sha256: null,
    signature_base64: null,
  };
  sign(receipt, "receipt_sha256", "signature_base64", reviewerKeys.privateKey);
  writeJson(path.join(reviewRoot, "current-review.v1.json"), {schema: "agentos.current_external_spawner_review.v1", version: 1, receipt_sha256: receipt.receipt_sha256});
  writeJson(path.join(reviewRoot, "receipts", `${receipt.receipt_sha256}.json`), receipt);

  const reviewProvisioning = provisioning.prepareProtectedSpawnerReviewProvisioning({sealedAuthority});
  review.installExternalSpawnerReviewStore({sealedAuthority, reviewProvisioning});
  const consumed = review.verifyAndConsumeCurrentExternalSpawnerReview({candidate, hostileEvaluation: evaluation});
  assert.equal(consumed.receipt_sha256, receipt.receipt_sha256);

  const localLedger = path.join(reviewRoot, "consumed-reviews.jsonl");
  const localHead = path.join(reviewRoot, "consumed-reviews.head.v1.json");
  const globalRoot = path.join(gitCommon, "agentos-independent-evaluator");
  const globalLedger = path.join(globalRoot, GLOBAL_REVIEW_LEDGER_NAME);
  const globalHead = `${globalLedger}.head.v1.json`;
  assert(fs.statSync(localLedger).isFile() && fs.statSync(localHead).isFile());
  assert(fs.statSync(globalLedger).isFile() && fs.statSync(globalHead).isFile());
  assert.throws(() => review.verifyAndConsumeCurrentExternalSpawnerReview({candidate, hostileEvaluation: evaluation}), /replay|already consumed/iu);

  // Local history can be lost, but the canonical cross-store ledger must still
  // deny the same signed receipt.
  fs.unlinkSync(localLedger); fs.unlinkSync(localHead);
  assert.throws(() => review.verifyAndConsumeCurrentExternalSpawnerReview({candidate, hostileEvaluation: evaluation}), /replay|already consumed/iu);

  // A shared lock must fail closed before any second read/append can occur.
  const globalLock = `${globalLedger}.lock`;
  fs.writeFileSync(globalLock, `${process.pid}\n`, {flag: "wx", mode: 0o600});
  assert.throws(() => review.verifyAndConsumeCurrentExternalSpawnerReview({candidate, hostileEvaluation: evaluation}), /concurrently locked/iu);
  fs.unlinkSync(globalLock);

  console.log("PASS disposable positive external review: real signed receipt consumed once; local-ledger deletion, replay, and global-lock hostile cases denied");
} finally {
  fs.rmSync(temporaryRoot, {recursive: true, force: true});
}
