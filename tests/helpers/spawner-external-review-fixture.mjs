import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {canonicalDigest, canonicalJson, compareUtf8} from "../../control/content-addressing.mjs";
import {getSealedCanonicalAuthority} from "../../control/sealed-canonical-authority.mjs";
import {resolveSpawnerGitAncestry} from "../../control/spawner-git-ancestry.mjs";

function sign(value, digestField, signatureField, privateKey) {
  value[digestField] = canonicalDigest({...value, [digestField]: null, [signatureField]: null});
  value[signatureField] = crypto.sign(null, Buffer.from(value[digestField], "hex"), privateKey).toString("base64");
}

export function provisionTestExternalSpawnerReview({candidate, install = true}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-external-spawner-review-")); fs.mkdirSync(path.join(root, "receipts"));
  const registryKeys = crypto.generateKeyPairSync("ed25519"), reviewerKeys = crypto.generateKeyPairSync("ed25519");
  const issuedAtUtc = new Date(Date.now() - 1_000).toISOString(), expiresAtUtc = new Date(Date.now() + 86_400_000).toISOString();
  const admission = {schema: "agentos.external_reviewer_admission.v1", version: 1, issuer_id: "REGISTRY.EXTERNAL.BOOTSTRAP.TEST", subject_id: "EVALUATOR.EXTERNAL.TEST", subject_role: "AGENT.INDEPENDENT_EVALUATOR", scope: ["CANDIDATE_COMPONENT_ROOT", "GATE_BYTES", "HOSTILE_FIXTURE_EXECUTION"], result: "ADMITTED", authority_epoch: 1, issued_at_utc: issuedAtUtc, expires_at_utc: expiresAtUtc, receipt_sha256: null, signature_base64: null}; sign(admission, "receipt_sha256", "signature_base64", registryKeys.privateKey);
  const sealedAuthority = getSealedCanonicalAuthority();
  const repositoryRoot = new URL("../..", import.meta.url).pathname;
  const candidateCommit = execFileSync("git", ["-C", repositoryRoot, "rev-parse", "HEAD"], {encoding: "utf8"}).trim();
  const authorizedPredecessorCommit = execFileSync("git", ["-C", repositoryRoot, "rev-parse", "HEAD^"], {encoding: "utf8"}).trim();
  const gitAncestry = resolveSpawnerGitAncestry({repositoryRoot, candidateCommit, authorizedPredecessor: authorizedPredecessorCommit});
  const registry = {schema: "agentos.external_spawner_reviewer_registry.v1", version: 1, authority_epoch: 1, registry_issuer_id: admission.issuer_id, registry_public_key_pem: registryKeys.publicKey.export({type: "spki", format: "pem"}), authorized_predecessor_commit: authorizedPredecessorCommit, reviewers: [{reviewer_id: admission.subject_id, role: admission.subject_role, status: "ADMITTED", authority_epoch: 1, public_key_pem: reviewerKeys.publicKey.export({type: "spki", format: "pem"}), admission_receipt: admission}], registry_sha256: null}; registry.registry_sha256 = canonicalDigest({...registry, registry_sha256: null});
  const evaluation = candidate.hostile_evaluation;
  const inventory = evaluation.results.map((entry) => ({fixture_id: entry.fixture_id, gate_id: entry.gate_id, result: entry.result, actual_outcome: entry.actual_outcome, error_code: entry.error_code})).sort((a, b) => compareUtf8(a.fixture_id, b.fixture_id));
  const receipt = {schema: "agentos.external_spawner_review_receipt.v1", version: 1, receipt_id: "REVIEW.EXTERNAL.SPAWNER.TEST", reviewer_id: admission.subject_id, reviewer_role: admission.subject_role, authority_epoch: 1, git_ancestry: gitAncestry, candidate_package_sha256: candidate.spawner_package.package_sha256, candidate_package_file_sha256: candidate.package_file_sha256, candidate_root_sha256: candidate.review_candidate_root_sha256, gate_manifest_sha256: candidate.manifest.manifest_sha256, fixture_manifest_sha256: candidate.fixture_manifest.manifest_sha256, hostile_evaluation_sha256: evaluation.evaluation_sha256, fixture_result_count: inventory.length, fixture_inventory_sha256: canonicalDigest(inventory), scope: admission.scope, custody: {read_only_candidate: true, builder_separated: true, governance_write_capability: false}, result: "PASS", issued_at_utc: issuedAtUtc, expires_at_utc: expiresAtUtc, nonce_sha256: canonicalDigest({nonce: crypto.randomBytes(32).toString("hex")}), receipt_sha256: null, signature_base64: null}; sign(receipt, "receipt_sha256", "signature_base64", reviewerKeys.privateKey);
  fs.writeFileSync(path.join(root, "reviewer-registry.v1.json"), `${canonicalJson(registry)}\n`); fs.writeFileSync(path.join(root, "current-review.v1.json"), `${canonicalJson({schema: "agentos.current_external_spawner_review.v1", version: 1, receipt_sha256: receipt.receipt_sha256})}\n`); fs.writeFileSync(path.join(root, "receipts", `${receipt.receipt_sha256}.json`), `${canonicalJson(receipt)}\n`);
  if (install) throw new Error("Synthetic external reviewer roots are evidence fixtures only and cannot be installed as authority");
  return {root, receipt};
}
