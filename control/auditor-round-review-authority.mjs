#!/usr/bin/env node

/*
 * Sealed authority adapter for independent auditor-round receipts.
 *
 * A round's local PASS is descriptive evidence only.  The collaborative
 * workflow may consume a round only after a separately provisioned evaluator
 * receipt has been resolved from this opaque, one-use store capability.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {canonicalDigest} from "./content-addressing.mjs";
import {assertSealedCanonicalAuthority, readSealedAuthorityBinding, sealedAuthorityRepositoryRoot} from "./sealed-canonical-authority.mjs";

export const AUDITOR_ROUND_REVIEW_SCHEMA = "agentos.auditor_round_independent_review.v1";
const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_ID = /^[0-9a-f]{40}$/u;
const REF = /^opaque:(?:round|receipt|candidate):[A-Z0-9._:/-]{1,180}$/u;
const IDENTIFIER = /^[A-Z][A-Z0-9._:-]{2,191}$/u;
const stores = new WeakMap();

function fail(message, code = "AUDITOR_ROUND_EXTERNAL_REVIEW_REQUIRED") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function exact(value, keys, label) { assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`, "AUDITOR_ROUND_REVIEW_SHAPE_INVALID"); assert(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort()), `${label} fields differ`, "AUDITOR_ROUND_REVIEW_UNKNOWN_FIELD"); }
function sha(value, label) { assert(typeof value === "string" && SHA256.test(value) && !/^([0-9a-f])\1{63}$/u.test(value), `${label} is not a content digest`, "AUDITOR_ROUND_REVIEW_DIGEST_INVALID"); }
function git(value, label) { assert(typeof value === "string" && GIT_ID.test(value) && !/^([0-9a-f])\1{39}$/u.test(value), `${label} is not a Git identity`, "AUDITOR_ROUND_REVIEW_GIT_INVALID"); }
function ref(value, label) { assert(typeof value === "string" && REF.test(value), `${label} is not an opaque reference`, "AUDITOR_ROUND_REVIEW_REF_INVALID"); }
function id(value, label) { assert(typeof value === "string" && IDENTIFIER.test(value), `${label} is not an identity`, "AUDITOR_ROUND_REVIEW_ID_INVALID"); }
function digestBody(value) { return canonicalDigest({...value, receipt_sha256: null, signature_base64: null}); }

function readJson(file, label) {
  const stat = fs.lstatSync(file, {throwIfNoEntry: false});
  assert(stat?.isFile() && !stat.isSymbolicLink(), `${label} is missing or aliased`, "AUDITOR_ROUND_REVIEW_STORE_UNAVAILABLE");
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { fail(`${label} is not valid JSON`, "AUDITOR_ROUND_REVIEW_ARTIFACT_INVALID"); }
}

function verifySigned(record, digestField, signatureField, publicKeyPem, label) {
  assert(record[digestField] === canonicalDigest({...record, [digestField]: null, [signatureField]: null}), `${label} digest differs`, "AUDITOR_ROUND_REVIEW_DIGEST_MISMATCH");
  assert(typeof record[signatureField] === "string" && record[signatureField].length > 0, `${label} signature is missing`, "AUDITOR_ROUND_REVIEW_SIGNATURE_REQUIRED");
  let valid = false;
  try { valid = crypto.verify(null, Buffer.from(record[digestField], "hex"), publicKeyPem, Buffer.from(record[signatureField], "base64")); } catch { valid = false; }
  assert(valid, `${label} signature is not valid`, "AUDITOR_ROUND_REVIEW_SIGNATURE_INVALID");
}

function fixedReviewRoot(sealedAuthority) {
  const repositoryRoot = sealedAuthorityRepositoryRoot(sealedAuthority);
  let gitCommon;
  try { gitCommon = fs.realpathSync.native(execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {cwd: repositoryRoot, encoding: "utf8"}).trim()); } catch { fail("Canonical evaluator Git custody is unavailable", "AUDITOR_ROUND_REVIEW_STORE_UNAVAILABLE"); }
  const commit = execFileSync("git", ["rev-parse", "HEAD"], {cwd: repositoryRoot, encoding: "utf8"}).trim();
  const root = path.join(gitCommon, "agentos-independent-evaluator", commit, "round-review");
  let realRoot;
  try { realRoot = fs.realpathSync.native(root); } catch { fail("Canonical evaluator review root is not provisioned", "AUDITOR_ROUND_REVIEW_STORE_UNAVAILABLE"); }
  const rootStat = fs.lstatSync(root, {throwIfNoEntry: false});
  assert(realRoot === root && rootStat?.isDirectory() && !rootStat.isSymbolicLink(), "Canonical evaluator review root is not a sealed real path", "AUDITOR_ROUND_REVIEW_STORE_UNAVAILABLE");
  return {repositoryRoot, root, receiptsRoot: path.join(root, "receipts"), registryPath: path.join(root, "reviewer-registry.v1.json")};
}

function validateCanonicalRegistry(registry, canonicalRegistry) {
  assert(JSON.stringify(registry) === JSON.stringify(canonicalRegistry), "Independent evaluator registry differs from sealed canonical trust root", "AUDITOR_ROUND_REVIEW_REGISTRY_SUBSTITUTION");
  exact(registry, ["schema", "version", "authority_epoch", "registry_issuer_id", "registry_public_key_pem", "authorized_predecessor_commit", "reviewers", "registry_sha256"], "independent evaluator registry");
  assert(registry.registry_sha256 === canonicalDigest({...registry, registry_sha256: null}), "Independent evaluator registry digest differs", "AUDITOR_ROUND_REVIEW_REGISTRY_INVALID");
  assert(Array.isArray(registry.reviewers) && registry.reviewers.length > 0, "Independent evaluator registry has no admitted reviewer", "AUDITOR_ROUND_REVIEW_ISSUER_INVALID");
  for (const reviewer of registry.reviewers) {
    exact(reviewer, ["reviewer_id", "role", "status", "authority_epoch", "public_key_pem", "admission_receipt"], "independent evaluator reviewer");
    assert(reviewer.role === "AGENT.INDEPENDENT_EVALUATOR" && reviewer.status === "ADMITTED" && reviewer.authority_epoch === registry.authority_epoch, "Independent evaluator is not currently admitted", "AUDITOR_ROUND_REVIEW_ISSUER_INVALID");
    const admission = reviewer.admission_receipt;
    exact(admission, ["schema", "version", "issuer_id", "subject_id", "subject_role", "scope", "result", "authority_epoch", "issued_at_utc", "expires_at_utc", "receipt_sha256", "signature_base64"], "independent evaluator admission");
    assert(admission.issuer_id === registry.registry_issuer_id && admission.subject_id === reviewer.reviewer_id && admission.subject_role === reviewer.role && admission.result === "ADMITTED" && admission.authority_epoch === registry.authority_epoch, "Independent evaluator admission is not bound to the canonical registry", "AUDITOR_ROUND_REVIEW_ISSUER_INVALID");
    verifySigned(admission, "receipt_sha256", "signature_base64", registry.registry_public_key_pem, "independent evaluator admission");
  }
}

export function installAuditorRoundReviewAuthority(options = {}) {
  assert(options && typeof options === "object" && JSON.stringify(Object.keys(options).sort()) === JSON.stringify(["sealedAuthority"]), "Independent round-review provisioning accepts only sealed bootstrap authority", "AUDITOR_ROUND_REVIEW_CALLER_AUTHORITY_FORBIDDEN");
  const {sealedAuthority} = options;
  assertSealedCanonicalAuthority(sealedAuthority);
  const fixed = fixedReviewRoot(sealedAuthority);
  const canonicalRegistry = readSealedAuthorityBinding(sealedAuthority, "spawner_external_reviewer_registry").value;
  const registry = readJson(fixed.registryPath, "Independent evaluator registry");
  validateCanonicalRegistry(registry, canonicalRegistry);
  const stat = fs.lstatSync(fixed.receiptsRoot, {throwIfNoEntry: false});
  assert(stat?.isDirectory() && !stat.isSymbolicLink(), "Independent round-review receipts directory is unavailable", "AUDITOR_ROUND_REVIEW_STORE_UNAVAILABLE");
  const capability = Object.freeze(Object.create(null));
  stores.set(capability, Object.freeze({realRoot: fixed.root, receiptsRoot: fixed.receiptsRoot, registry, repositoryRoot: fixed.repositoryRoot}));
  return capability;
}

function stateFor(authority) {
  const state = stores.get(authority);
  assert(state, "Independent round-review authority must be installed by sealed bootstrap", "AUDITOR_ROUND_REVIEW_AUTHORITY_REQUIRED");
  return state;
}

function readReceipt(state, receiptSha256) {
  sha(receiptSha256, "review receipt reference");
  const file = path.join(state.receiptsRoot, `${receiptSha256}.json`);
  assert(file.startsWith(`${state.receiptsRoot}${path.sep}`), "Review receipt path escaped its sealed store", "AUDITOR_ROUND_REVIEW_PATH_ESCAPE");
  const stat = fs.lstatSync(file, {throwIfNoEntry: false});
  assert(stat?.isFile() && !stat.isSymbolicLink(), "Independent round-review receipt is missing or aliased", "AUDITOR_ROUND_REVIEW_RECEIPT_MISSING");
  const receipt = readJson(file, "Independent round-review receipt");
  exact(receipt, ["schema", "version", "receipt_id", "issuer_id", "issuer_role", "result", "candidate_commit_sha1", "candidate_tree_sha1", "rollback_commit_sha1", "rollback_tree_sha1", "candidate_ref", "round_ref", "round_sha256", "package_sha256", "gate_inventory_sha256", "fixture_inventory_sha256", "context_sha256", "execution_sha256", "evaluator_admission_sha256", "authority_epoch", "issued_at_utc", "expires_at_utc", "signature_status", "signature_base64", "receipt_sha256"], "independent round-review receipt");
  assert(receipt.schema === AUDITOR_ROUND_REVIEW_SCHEMA && receipt.version === 1, "Independent round-review receipt identity differs", "AUDITOR_ROUND_REVIEW_SCHEMA_MISMATCH");
  id(receipt.issuer_id, "review issuer"); const reviewer = state.registry.reviewers.find((entry) => entry.reviewer_id === receipt.issuer_id); assert(reviewer && reviewer.role === receipt.issuer_role && reviewer.status === "ADMITTED" && reviewer.authority_epoch === state.registry.authority_epoch, "Review issuer is not a currently admitted canonical evaluator", "AUDITOR_ROUND_REVIEW_ISSUER_INVALID"); assert(receipt.issuer_role === "AGENT.INDEPENDENT_EVALUATOR", "Review issuer is not a separately governed evaluator", "AUDITOR_ROUND_REVIEW_ISSUER_INVALID"); assert(receipt.result === "PASS" || receipt.result === "NOT_APPLICABLE_WITH_EVIDENCE", "Independent review did not pass", "AUDITOR_ROUND_REVIEW_NOT_PASS");
  for (const [key, value] of Object.entries({candidate_ref: receipt.candidate_ref, round_ref: receipt.round_ref, receipt_id: receipt.receipt_id})) ref(value, key);
  for (const [key, value] of Object.entries({candidate_commit_sha1: receipt.candidate_commit_sha1, candidate_tree_sha1: receipt.candidate_tree_sha1, rollback_commit_sha1: receipt.rollback_commit_sha1, rollback_tree_sha1: receipt.rollback_tree_sha1})) git(value, key);
  for (const key of ["round_sha256", "package_sha256", "gate_inventory_sha256", "fixture_inventory_sha256", "context_sha256", "execution_sha256", "evaluator_admission_sha256"]) sha(receipt[key], key);
  assert(receipt.signature_status === "VERIFIED_BY_EXTERNAL_EVALUATOR", "Review receipt is not externally verified", "AUDITOR_ROUND_REVIEW_SIGNATURE_REQUIRED");
  const issued = Date.parse(receipt.issued_at_utc), expires = Date.parse(receipt.expires_at_utc), now = Date.now(); assert(Number.isFinite(issued) && Number.isFinite(expires) && issued <= now && now <= expires && expires - issued <= 24 * 60 * 60 * 1000, "Review receipt is stale, future-dated, or too long-lived", "AUDITOR_ROUND_REVIEW_STALE");
  assert(receipt.receipt_sha256 === receiptSha256, "Review receipt filename does not match embedded digest", "AUDITOR_ROUND_REVIEW_RECEIPT_ALIAS");
  verifySigned(receipt, "receipt_sha256", "signature_base64", reviewer.public_key_pem, "Independent round-review receipt");
  assert(receipt.receipt_sha256 === digestBody(receipt), "Review receipt digest differs", "AUDITOR_ROUND_REVIEW_DIGEST_MISMATCH");
  try {
    execFileSync("git", ["cat-file", "-e", `${receipt.candidate_commit_sha1}^{commit}`], {cwd: state.repositoryRoot, stdio: "ignore"});
    const tree = execFileSync("git", ["rev-parse", `${receipt.candidate_commit_sha1}^{tree}`], {cwd: state.repositoryRoot, encoding: "utf8"}).trim();
    assert(tree === receipt.candidate_tree_sha1, "Review candidate tree does not match Git readback", "AUDITOR_ROUND_REVIEW_GIT_BINDING");
    const rollbackTree = execFileSync("git", ["rev-parse", `${receipt.rollback_commit_sha1}^{tree}`], {cwd: state.repositoryRoot, encoding: "utf8"}).trim();
    assert(rollbackTree === receipt.rollback_tree_sha1, "Review rollback tree does not match Git readback", "AUDITOR_ROUND_REVIEW_GIT_BINDING");
    execFileSync("git", ["merge-base", "--is-ancestor", receipt.rollback_commit_sha1, receipt.candidate_commit_sha1], {cwd: state.repositoryRoot, stdio: "ignore"});
  } catch (error) { if (error?.code?.startsWith("AUDITOR_ROUND_REVIEW")) throw error; fail("Review candidate or rollback cannot be independently resolved from Git", "AUDITOR_ROUND_REVIEW_GIT_BINDING"); }
  return receipt;
}

function consumeDurably(state, receiptSha256) {
  const ledgerPath = path.join(state.realRoot, "consumed-round-reviews.jsonl");
  const lockPath = `${ledgerPath}.lock`;
  let lockFd;
  try { lockFd = fs.openSync(lockPath, "wx", 0o600); } catch (error) { if (error.code === "EEXIST") fail("Independent round-review consumption is concurrently locked", "AUDITOR_ROUND_REVIEW_CONCURRENT"); throw error; }
  try {
    const raw = fs.existsSync(ledgerPath) ? fs.readFileSync(ledgerPath, "utf8") : "";
    const prior = raw.split("\n").filter(Boolean).map((line) => JSON.parse(line));
    assert(!prior.some((entry) => entry.receipt_sha256 === receiptSha256), "Independent round-review receipt was already consumed", "AUDITOR_ROUND_REVIEW_REPLAY");
    const event = {sequence: prior.length + 1, receipt_sha256: receiptSha256, prior_event_sha256: prior.at(-1)?.event_sha256 ?? null, consumed_at_utc: new Date().toISOString(), event_sha256: null};
    event.event_sha256 = canonicalDigest({...event, event_sha256: null});
    fs.appendFileSync(ledgerPath, `${JSON.stringify(event)}\n`, {mode: 0o600});
    const fd = fs.openSync(ledgerPath, "r"); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  } finally { fs.closeSync(lockFd); try { fs.unlinkSync(lockPath); } catch {} }
}

export function consumeAuditorRoundReview({authority, receiptSha256, expected = {}} = {}) {
  const state = stateFor(authority); const receipt = readReceipt(state, receiptSha256);
  for (const key of ["candidate_commit_sha1", "candidate_tree_sha1", "rollback_commit_sha1", "rollback_tree_sha1", "round_sha256", "package_sha256", "gate_inventory_sha256", "fixture_inventory_sha256", "context_sha256", "execution_sha256"]) {
    if (expected[key] !== undefined) assert(receipt[key] === expected[key], `Review receipt ${key} differs from the expected immutable binding`, "AUDITOR_ROUND_REVIEW_BINDING_MISMATCH");
  }
  consumeDurably(state, receipt.receipt_sha256);
  return Object.freeze(receipt);
}
