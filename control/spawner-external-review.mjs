#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {canonicalDigest, canonicalJson, compareUtf8} from "./content-addressing.mjs";
import {assertSealedCanonicalAuthority, getSealedCanonicalAuthority, readSealedAuthorityBinding, sealedAuthorityRepositoryRoot} from "./sealed-canonical-authority.mjs";
import {consumeProtectedSpawnerReviewProvisioning} from "./protected-spawner-review-provisioning.mjs";
import {validateSpawnerGitAncestry} from "./spawner-git-ancestry.mjs";

const stores = new WeakMap(); let installedStore = null; let installedGeneration = 0;
const SHA = /^[0-9a-f]{64}$/u;
const REVIEW_SCOPE = ["CANDIDATE_COMPONENT_ROOT", "GATE_BYTES", "HOSTILE_FIXTURE_EXECUTION"];
function fail(message, code = "SPAWNER_EXTERNAL_REVIEW_INVALID") { const error = new Error(message); error.code = code; throw error; }
function exact(value, keys, label) { if (!value || typeof value !== "object" || Array.isArray(value) || JSON.stringify(Object.keys(value).sort(compareUtf8)) !== JSON.stringify([...keys].sort(compareUtf8))) fail(`${label} fields mismatch`); }
function read(root, relative) { const target = path.resolve(root, relative); if (!target.startsWith(`${root}${path.sep}`)) fail("external review path escaped store"); const stat = fs.lstatSync(target); if (!stat.isFile() || stat.isSymbolicLink()) fail("external review artifact is unsafe"); return JSON.parse(fs.readFileSync(target, "utf8")); }
function body(value, digest, signature = null) { const copy = structuredClone(value); copy[digest] = null; if (signature) copy[signature] = null; return copy; }
function verifySigned(record, digestField, signatureField, publicKey, label) { if (!SHA.test(record[digestField]) || record[digestField] !== canonicalDigest(body(record, digestField, signatureField))) fail(`${label} digest differs`); if (!crypto.verify(null, Buffer.from(record[digestField], "hex"), publicKey, Buffer.from(record[signatureField], "base64"))) fail(`${label} signature differs`); }
function validateAdmission(admission, registry, reviewer) {
  exact(admission, ["schema", "version", "issuer_id", "subject_id", "subject_role", "scope", "result", "authority_epoch", "issued_at_utc", "expires_at_utc", "receipt_sha256", "signature_base64"], "reviewer admission receipt");
  if (admission.schema !== "agentos.external_reviewer_admission.v1" || admission.version !== 1 || admission.issuer_id !== registry.registry_issuer_id || admission.subject_id !== reviewer.reviewer_id || admission.subject_role !== reviewer.role || admission.result !== "ADMITTED" || admission.authority_epoch !== registry.authority_epoch) fail("reviewer admission receipt identity differs", "SPAWNER_EXTERNAL_REVIEW_ISSUER_INVALID");
  if (!Array.isArray(admission.scope) || JSON.stringify(admission.scope) !== JSON.stringify(REVIEW_SCOPE)) fail("reviewer admission scope differs", "SPAWNER_EXTERNAL_REVIEW_ISSUER_INVALID");
  const issued = Date.parse(admission.issued_at_utc), expires = Date.parse(admission.expires_at_utc), now = Date.now();
  if (!Number.isFinite(issued) || !Number.isFinite(expires) || issued > now || now >= expires) fail("reviewer admission is stale or future-dated", "SPAWNER_EXTERNAL_REVIEW_ISSUER_INVALID");
  verifySigned(admission, "receipt_sha256", "signature_base64", registry.registry_public_key_pem, "reviewer admission receipt");
}

export function installExternalSpawnerReviewStore({sealedAuthority, reviewProvisioning} = {}) {
  assertSealedCanonicalAuthority(sealedAuthority);
  const {realRoot} = consumeProtectedSpawnerReviewProvisioning(reviewProvisioning);
  const registry = read(realRoot, "reviewer-registry.v1.json");
  const canonicalRegistry = readSealedAuthorityBinding(sealedAuthority, "spawner_external_reviewer_registry").value;
  if (canonicalJson(registry) !== canonicalJson(canonicalRegistry)) fail("external reviewer registry differs from sealed canonical trust root", "SPAWNER_EXTERNAL_REVIEW_REGISTRY_SUBSTITUTION");
  exact(registry, ["schema", "version", "authority_epoch", "registry_issuer_id", "registry_public_key_pem", "authorized_predecessor_commit", "reviewers", "registry_sha256"], "external reviewer registry");
  if (registry.schema !== "agentos.external_spawner_reviewer_registry.v1" || registry.version !== 1 || registry.registry_sha256 !== canonicalDigest({...registry, registry_sha256: null})) fail("external reviewer registry identity/digest differs");
  if (!Array.isArray(registry.reviewers) || registry.reviewers.length === 0) fail("external reviewer registry is empty");
  for (const reviewer of registry.reviewers) {
    exact(reviewer, ["reviewer_id", "role", "status", "authority_epoch", "public_key_pem", "admission_receipt"], "external reviewer");
    if (reviewer.role !== "AGENT.INDEPENDENT_EVALUATOR" || reviewer.status !== "ADMITTED" || reviewer.authority_epoch !== registry.authority_epoch) fail("external reviewer is not separately admitted");
    validateAdmission(reviewer.admission_receipt, registry, reviewer);
  }
  const capability = Object.freeze(Object.create(null)); stores.set(capability, Object.freeze({root: realRoot, registry})); installedStore = capability; installedGeneration += 1; return capability;
}

export function currentExternalSpawnerReviewGeneration() { return installedGeneration; }

function verifyCandidateCommitBytes(candidate, ancestry) {
  const repositoryRoot = sealedAuthorityRepositoryRoot(getSealedCanonicalAuthority());
  validateSpawnerGitAncestry(ancestry, {repositoryRoot});
  const packageRoot = "specialist-blocks/control-plane/agent-spawner";
  const paths = new Set([
    `${packageRoot}/block.json`, `${packageRoot}/gates/manifest.json`, `${packageRoot}/decision-tree.json`,
    `${packageRoot}/hostile-fixtures.manifest.json`, `${packageRoot}/hostile-evaluation.v1.json`, `${packageRoot}/admission/manifest.json`,
    `${packageRoot}/controller-issuer-registry.v1.json`, `${packageRoot}/controller-operation-registry.v1.json`,
    `${packageRoot}/independent-clearance-trust-anchor.v1.json`, "fixtures/model-policy-evidence/source-registry.v1.json",
    `${packageRoot}/canonical-evaluator-trust-root.v1.json`, `${packageRoot}/external-reviewer-registry.v1.json`,
    `${packageRoot}/independent-evaluator-admission.v1.json`, `${packageRoot}/independent-evaluator-registry.v2.json`,
  ]);
  for (const gate of candidate.resolved_gates) paths.add(gate.artifact_path);
  for (const fixture of candidate.fixture_manifest.entries) paths.add(`${packageRoot}/${fixture.path}`);
  for (const relative of paths) {
    let committed; try { committed = execFileSync("git", ["-C", repositoryRoot, "show", `${ancestry.candidate_commit}:${relative}`], {encoding: null, stdio: ["ignore", "pipe", "pipe"]}); } catch { fail(`reviewed candidate commit does not contain canonical artifact: ${relative}`, "SPAWNER_AUTHORITY_CHAIN_MISMATCH"); }
    const live = fs.readFileSync(path.join(repositoryRoot, relative));
    if (!committed.equals(live)) fail(`reviewed candidate commit bytes differ from canonical artifact: ${relative}`, "SPAWNER_AUTHORITY_CHAIN_MISMATCH");
  }
}

function consume(root, receipt) {
  const ledgerPath = path.join(root, "consumed-reviews.jsonl"), lockPath = `${ledgerPath}.lock`;
  let lock; try { lock = fs.openSync(lockPath, "wx", 0o600); } catch (error) { if (error.code === "EEXIST") fail("external review consumption is concurrently locked", "SPAWNER_EXTERNAL_REVIEW_CONCURRENT"); throw error; }
  try {
    const prior = fs.existsSync(ledgerPath) ? fs.readFileSync(ledgerPath, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [];
    if (prior.some((entry) => entry.receipt_sha256 === receipt.receipt_sha256)) fail("external review receipt was already consumed", "SPAWNER_EXTERNAL_REVIEW_REPLAY");
    const event = {sequence: prior.length + 1, receipt_sha256: receipt.receipt_sha256, prior_event_sha256: prior.at(-1)?.event_sha256 ?? null, consumed_at_utc: new Date().toISOString(), event_sha256: null}; event.event_sha256 = canonicalDigest({...event, event_sha256: null});
    fs.appendFileSync(ledgerPath, `${canonicalJson(event)}\n`, {mode: 0o600}); const descriptor = fs.openSync(ledgerPath, "r"); try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  } finally { fs.closeSync(lock); if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath); }
}

export function verifyAndConsumeCurrentExternalSpawnerReview({candidate, hostileEvaluation} = {}) {
  const store = stores.get(installedStore);
  if (!store) fail("external reviewer authority is not provisioned", "SPAWNER_EXTERNAL_REVIEW_PROVISIONING_REQUIRED");
  const current = read(store.root, "current-review.v1.json"); exact(current, ["schema", "version", "receipt_sha256"], "current external review reference");
  if (current.schema !== "agentos.current_external_spawner_review.v1" || current.version !== 1 || !SHA.test(current.receipt_sha256)) fail("current external review reference differs");
  const receipt = read(store.root, `receipts/${current.receipt_sha256}.json`);
  exact(receipt, ["schema", "version", "receipt_id", "reviewer_id", "reviewer_role", "authority_epoch", "git_ancestry", "candidate_package_sha256", "candidate_package_file_sha256", "candidate_root_sha256", "gate_manifest_sha256", "fixture_manifest_sha256", "hostile_evaluation_sha256", "fixture_result_count", "fixture_inventory_sha256", "scope", "custody", "result", "issued_at_utc", "expires_at_utc", "nonce_sha256", "receipt_sha256", "signature_base64"], "external Spawner review receipt");
  const reviewer = store.registry.reviewers.find((entry) => entry.reviewer_id === receipt.reviewer_id);
  if (!reviewer || receipt.reviewer_role !== reviewer.role || receipt.authority_epoch !== store.registry.authority_epoch) fail("external review issuer is unknown, revoked, stale, or role-mismatched");
  if (receipt.git_ancestry?.authorized_predecessor_commit !== store.registry.authorized_predecessor_commit) fail("external review authorized predecessor differs from protected reviewer registry", "SPAWNER_AUTHORITY_CHAIN_MISMATCH");
  verifyCandidateCommitBytes(candidate, receipt.git_ancestry);
  const expectedInventory = hostileEvaluation.results.map((entry) => ({fixture_id: entry.fixture_id, gate_id: entry.gate_id, result: entry.result, actual_outcome: entry.actual_outcome, error_code: entry.error_code})).sort((a, b) => compareUtf8(a.fixture_id, b.fixture_id));
  if (receipt.candidate_package_sha256 !== candidate.spawner_package.package_sha256 || receipt.candidate_package_file_sha256 !== candidate.package_file_sha256 || receipt.candidate_root_sha256 !== candidate.review_candidate_root_sha256 || receipt.gate_manifest_sha256 !== candidate.manifest.manifest_sha256 || receipt.fixture_manifest_sha256 !== candidate.fixture_manifest.manifest_sha256 || receipt.hostile_evaluation_sha256 !== hostileEvaluation.evaluation_sha256 || receipt.fixture_result_count !== expectedInventory.length || receipt.fixture_inventory_sha256 !== canonicalDigest(expectedInventory)) fail("external review candidate or executed evidence binding differs");
  if (receipt.result !== "PASS" || receipt.reviewer_role !== "AGENT.INDEPENDENT_EVALUATOR" || JSON.stringify(receipt.scope) !== JSON.stringify(["CANDIDATE_COMPONENT_ROOT", "GATE_BYTES", "HOSTILE_FIXTURE_EXECUTION"]) || receipt.custody?.read_only_candidate !== true || receipt.custody?.builder_separated !== true || receipt.custody?.governance_write_capability !== false) fail("external review result, scope, or custody differs");
  const now = Date.now(); if (!(Date.parse(receipt.issued_at_utc) <= now && now < Date.parse(receipt.expires_at_utc))) fail("external review receipt is future-dated or stale");
  verifySigned(receipt, "receipt_sha256", "signature_base64", reviewer.public_key_pem, "external review receipt"); consume(store.root, receipt);
  return Object.freeze({receipt_sha256: receipt.receipt_sha256, reviewer_id: receipt.reviewer_id, candidate_root_sha256: receipt.candidate_root_sha256, hostile_evaluation_sha256: receipt.hostile_evaluation_sha256});
}
