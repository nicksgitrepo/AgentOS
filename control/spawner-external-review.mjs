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
const REVIEW_LEDGER_SCHEMA = "agentos.spawner_external_review_consumption_head.v1";
const REVIEW_LEDGER_VERSION = 1;
const GLOBAL_REVIEW_LEDGER_SCHEMA = "agentos.spawner_external_review_global_consumption.v1";
const GLOBAL_REVIEW_LEDGER_VERSION = 1;
const GLOBAL_REVIEW_LEDGER_NAME = "spawner-external-review-consumption.v1.jsonl";
const GLOBAL_REVIEW_LEDGER_BINDING = canonicalDigest({schema: GLOBAL_REVIEW_LEDGER_SCHEMA, version: GLOBAL_REVIEW_LEDGER_VERSION, namespace: "AGENTOS_SPAWNER_EXTERNAL_REVIEW"});
const REVIEW_SCOPE = ["CANDIDATE_COMPONENT_ROOT", "GATE_BYTES", "HOSTILE_FIXTURE_EXECUTION"];
function fail(message, code = "SPAWNER_EXTERNAL_REVIEW_INVALID") { const error = new Error(message); error.code = code; throw error; }
function exact(value, keys, label) { if (!value || typeof value !== "object" || Array.isArray(value) || JSON.stringify(Object.keys(value).sort(compareUtf8)) !== JSON.stringify([...keys].sort(compareUtf8))) fail(`${label} fields mismatch`); }
function safePath(root, relative, {allowMissingLeaf = false} = {}) {
  const realRoot = path.resolve(root);
  const target = path.resolve(realRoot, relative);
  if (target !== realRoot && !target.startsWith(`${realRoot}${path.sep}`)) fail("external review path escaped store", "SPAWNER_EXTERNAL_REVIEW_PATH_ESCAPE");
  const rootStat = fs.lstatSync(realRoot, {throwIfNoEntry: false});
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) fail("external review store root is unsafe", "SPAWNER_EXTERNAL_REVIEW_STORE_UNSAFE");
  const segments = path.relative(realRoot, target).split(path.sep).filter(Boolean);
  let cursor = realRoot;
  for (const [index, segment] of segments.entries()) {
    cursor = path.join(cursor, segment);
    const stat = fs.lstatSync(cursor, {throwIfNoEntry: false});
    const isLeaf = index === segments.length - 1;
    if (!stat) {
      if (isLeaf && allowMissingLeaf) return cursor;
      fail("external review artifact is missing", "SPAWNER_EXTERNAL_REVIEW_STORE_UNAVAILABLE");
    }
    if (stat.isSymbolicLink()) fail("external review artifact path is aliased", "SPAWNER_EXTERNAL_REVIEW_PATH_ALIAS");
    if (!isLeaf && !stat.isDirectory()) fail("external review artifact parent is not a directory", "SPAWNER_EXTERNAL_REVIEW_STORE_UNSAFE");
  }
  return target;
}
function read(root, relative) {
  const target = safePath(root, relative);
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()) fail("external review artifact is unsafe", "SPAWNER_EXTERNAL_REVIEW_ARTIFACT_UNSAFE");
  try { return JSON.parse(fs.readFileSync(target, "utf8")); } catch { fail("external review artifact is not valid JSON", "SPAWNER_EXTERNAL_REVIEW_ARTIFACT_INVALID"); }
}
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
  const repositoryRoot = sealedAuthorityRepositoryRoot(sealedAuthority);
  let globalRoot;
  try {
    const gitCommon = fs.realpathSync.native(execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {cwd: repositoryRoot, encoding: "utf8"}).trim());
    globalRoot = path.join(gitCommon, "agentos-independent-evaluator");
    const globalStat = fs.lstatSync(globalRoot, {throwIfNoEntry: false});
    if (!globalStat?.isDirectory() || globalStat.isSymbolicLink() || fs.realpathSync.native(globalRoot) !== globalRoot) fail("external review global replay store is unsafe", "SPAWNER_EXTERNAL_REVIEW_REPLAY_LEDGER_INVALID");
  } catch (error) {
    if (error?.code?.startsWith("SPAWNER_EXTERNAL_REVIEW")) throw error;
    fail("external review global replay store is unavailable", "SPAWNER_EXTERNAL_REVIEW_REPLAY_LEDGER_INVALID");
  }
  const capability = Object.freeze(Object.create(null)); stores.set(capability, Object.freeze({root: realRoot, registry, globalRoot})); installedStore = capability; installedGeneration += 1; return capability;
}

export function currentExternalSpawnerReviewGeneration() { return installedGeneration; }

function verifyCandidateCommitBytes(candidate, ancestry) {
  const repositoryRoot = sealedAuthorityRepositoryRoot(getSealedCanonicalAuthority());
  validateSpawnerGitAncestry(ancestry, {repositoryRoot});
  let liveCommit, liveTree;
  try {
    liveCommit = execFileSync("git", ["rev-parse", "HEAD"], {cwd: repositoryRoot, encoding: "utf8"}).trim();
    liveTree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], {cwd: repositoryRoot, encoding: "utf8"}).trim();
  } catch { fail("reviewed candidate live Git identity is unavailable", "SPAWNER_AUTHORITY_CHAIN_MISMATCH"); }
  if (ancestry.candidate_commit !== liveCommit || ancestry.candidate_tree !== liveTree) fail("external review candidate is stale or not the sealed repository head", "SPAWNER_AUTHORITY_CHAIN_MISMATCH");
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

function ledgerBinding(registry) {
  return ledgerBindingFromSha(registry.registry_sha256, REVIEW_LEDGER_SCHEMA, REVIEW_LEDGER_VERSION, "consumed-reviews.jsonl");
}
function ledgerBindingFromSha(bindingSha256, schema = REVIEW_LEDGER_SCHEMA, version = REVIEW_LEDGER_VERSION, ledger = "consumed-reviews.jsonl") {
  return canonicalDigest({schema, version, binding_sha256: bindingSha256, ledger});
}
export function validateExternalSpawnerReviewReplayText({binding_sha256: bindingSha256, rawLedger = "", head = null, schema = REVIEW_LEDGER_SCHEMA, version = REVIEW_LEDGER_VERSION, ledger = "consumed-reviews.jsonl"} = {}) {
  if (!SHA.test(bindingSha256)) fail("external review replay binding is invalid", "SPAWNER_EXTERNAL_REVIEW_REPLAY_LEDGER_INVALID");
  if (typeof rawLedger !== "string" || (rawLedger !== "" && !rawLedger.endsWith("\n"))) fail("external review replay ledger is not newline-terminated", "SPAWNER_EXTERNAL_REVIEW_REPLAY_LEDGER_INVALID");
  const prior = [];
  const seen = new Set();
  const lines = rawLedger === "" ? [] : rawLedger.slice(0, -1).split("\n");
  for (const [index, line] of lines.entries()) {
    let entry;
    try { entry = JSON.parse(line); } catch { fail(`external review replay ledger record ${index + 1} is malformed`, "SPAWNER_EXTERNAL_REVIEW_REPLAY_LEDGER_INVALID"); }
    exact(entry, ["sequence", "receipt_sha256", "prior_event_sha256", "consumed_at_utc", "event_sha256"], "external review replay ledger record");
    if (!Number.isSafeInteger(entry.sequence) || entry.sequence !== index + 1 || !SHA.test(entry.receipt_sha256) || seen.has(entry.receipt_sha256)) fail(`external review replay ledger record ${index + 1} sequence or receipt is invalid`, "SPAWNER_EXTERNAL_REVIEW_REPLAY_LEDGER_INVALID");
    if (entry.prior_event_sha256 !== (prior.at(-1)?.event_sha256 ?? null) || !SHA.test(entry.event_sha256) || entry.event_sha256 !== canonicalDigest({...entry, event_sha256: null})) fail(`external review replay ledger record ${index + 1} chain is invalid`, "SPAWNER_EXTERNAL_REVIEW_REPLAY_LEDGER_INVALID");
    const consumedAt = Date.parse(entry.consumed_at_utc);
    if (!Number.isFinite(consumedAt) || consumedAt > Date.now()) fail(`external review replay ledger record ${index + 1} time is invalid`, "SPAWNER_EXTERNAL_REVIEW_REPLAY_LEDGER_INVALID");
    seen.add(entry.receipt_sha256); prior.push(entry);
  }
  if (head === null) {
    if (prior.length > 0) fail("external review replay ledger is missing its durable head", "SPAWNER_EXTERNAL_REVIEW_REPLAY_LEDGER_INVALID");
  } else {
    exact(head, ["schema", "version", "binding_sha256", "sequence", "head_event_sha256", "ledger_sha256"], "external review replay head");
    if (head.schema !== schema || head.version !== version || head.binding_sha256 !== bindingSha256 || head.sequence !== prior.length || head.head_event_sha256 !== prior.at(-1)?.event_sha256 || head.ledger_sha256 !== canonicalDigest(prior)) fail("external review replay head does not match its ledger", "SPAWNER_EXTERNAL_REVIEW_REPLAY_LEDGER_INVALID");
  }
  return Object.freeze({prior, seen, ledger_sha256: canonicalDigest(prior), head_event_sha256: prior.at(-1)?.event_sha256 ?? null});
}
function parseLedger(root, registry) {
  const ledgerPath = safePath(root, "consumed-reviews.jsonl", {allowMissingLeaf: true});
  const headPath = safePath(root, "consumed-reviews.head.v1.json", {allowMissingLeaf: true});
  const ledgerStat = fs.lstatSync(ledgerPath, {throwIfNoEntry: false});
  const headStat = fs.lstatSync(headPath, {throwIfNoEntry: false});
  if (ledgerStat && (!ledgerStat.isFile() || ledgerStat.isSymbolicLink())) fail("external review replay ledger is not a regular file", "SPAWNER_EXTERNAL_REVIEW_REPLAY_LEDGER_INVALID");
  if (headStat && (!headStat.isFile() || headStat.isSymbolicLink())) fail("external review replay head is not a regular file", "SPAWNER_EXTERNAL_REVIEW_REPLAY_LEDGER_INVALID");
  if (!ledgerStat && headStat) fail("external review replay head exists without its ledger", "SPAWNER_EXTERNAL_REVIEW_REPLAY_LEDGER_INVALID");
  if (ledgerStat && !headStat) fail("external review replay ledger is missing its durable head", "SPAWNER_EXTERNAL_REVIEW_REPLAY_LEDGER_INVALID");
  const raw = ledgerStat ? fs.readFileSync(ledgerPath, "utf8") : "";
  let head = null;
  if (headStat) {
    try { head = JSON.parse(fs.readFileSync(headPath, "utf8")); } catch { fail("external review replay head is not valid JSON", "SPAWNER_EXTERNAL_REVIEW_REPLAY_LEDGER_INVALID"); }
  }
  const validated = validateExternalSpawnerReviewReplayText({binding_sha256: ledgerBinding(registry), rawLedger: raw, head});
  return {ledgerPath, headPath, prior: validated.prior, seen: validated.seen};
}
function parseLedgerAt(root, ledgerName, bindingSha256, schema, version) {
  const ledgerPath = safePath(root, ledgerName, {allowMissingLeaf: true});
  const headPath = safePath(root, `${ledgerName}.head.v1.json`, {allowMissingLeaf: true});
  const ledgerStat = fs.lstatSync(ledgerPath, {throwIfNoEntry: false});
  const headStat = fs.lstatSync(headPath, {throwIfNoEntry: false});
  if (ledgerStat && (!ledgerStat.isFile() || ledgerStat.isSymbolicLink())) fail("external review replay ledger is not a regular file", "SPAWNER_EXTERNAL_REVIEW_REPLAY_LEDGER_INVALID");
  if (headStat && (!headStat.isFile() || headStat.isSymbolicLink())) fail("external review replay head is not a regular file", "SPAWNER_EXTERNAL_REVIEW_REPLAY_LEDGER_INVALID");
  if (!ledgerStat && headStat) fail("external review replay head exists without its ledger", "SPAWNER_EXTERNAL_REVIEW_REPLAY_LEDGER_INVALID");
  if (ledgerStat && !headStat) fail("external review replay ledger is missing its durable head", "SPAWNER_EXTERNAL_REVIEW_REPLAY_LEDGER_INVALID");
  const raw = ledgerStat ? fs.readFileSync(ledgerPath, "utf8") : "";
  let head = null;
  if (headStat) {
    try { head = JSON.parse(fs.readFileSync(headPath, "utf8")); } catch { fail("external review replay head is not valid JSON", "SPAWNER_EXTERNAL_REVIEW_REPLAY_LEDGER_INVALID"); }
  }
  const validated = validateExternalSpawnerReviewReplayText({binding_sha256: bindingSha256, rawLedger: raw, head, schema, version, ledger: ledgerName});
  return {ledgerPath, headPath, prior: validated.prior, seen: validated.seen};
}
function writeReplayHead(headPath, {bindingSha256, schema, version}, prior, root) {
  const head = {schema, version, binding_sha256: bindingSha256, sequence: prior.length, head_event_sha256: prior.at(-1)?.event_sha256 ?? null, ledger_sha256: canonicalDigest(prior)};
  const temporary = `${headPath}.${process.pid}.${Date.now()}.tmp`;
  const bytes = `${canonicalJson(head)}\n`;
  try {
    fs.writeFileSync(temporary, bytes, {flag: "wx", mode: 0o600});
    const fd = fs.openSync(temporary, "r"); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    const existing = fs.lstatSync(headPath, {throwIfNoEntry: false});
    if (existing?.isSymbolicLink() || (existing && !existing.isFile())) fail("external review replay head is unsafe", "SPAWNER_EXTERNAL_REVIEW_REPLAY_LEDGER_INVALID");
    fs.renameSync(temporary, headPath);
    const directoryFd = fs.openSync(root, "r"); try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
  } finally { try { fs.unlinkSync(temporary); } catch {} }
}
function consume(root, registry, receipt) {
  const globalRoot = stores.get(installedStore)?.globalRoot;
  if (!globalRoot) fail("external review global replay store is unavailable", "SPAWNER_EXTERNAL_REVIEW_REPLAY_LEDGER_INVALID");
  const lockPath = safePath(root, "consumed-reviews.jsonl.lock", {allowMissingLeaf: true});
  let lock;
  try { lock = fs.openSync(lockPath, "wx", 0o600); } catch (error) { if (error.code === "EEXIST") fail("external review consumption is concurrently locked", "SPAWNER_EXTERNAL_REVIEW_CONCURRENT"); throw error; }
  try {
    const state = parseLedger(root, registry);
    const global = parseLedgerAt(globalRoot, GLOBAL_REVIEW_LEDGER_NAME, GLOBAL_REVIEW_LEDGER_BINDING, GLOBAL_REVIEW_LEDGER_SCHEMA, GLOBAL_REVIEW_LEDGER_VERSION);
    if (state.seen.has(receipt.receipt_sha256) || global.seen.has(receipt.receipt_sha256)) fail("external review receipt was already consumed", "SPAWNER_EXTERNAL_REVIEW_REPLAY");
    const event = {sequence: state.prior.length + 1, receipt_sha256: receipt.receipt_sha256, prior_event_sha256: state.prior.at(-1)?.event_sha256 ?? null, consumed_at_utc: new Date().toISOString(), event_sha256: null};
    event.event_sha256 = canonicalDigest({...event, event_sha256: null});
    const globalEvent = {...event, sequence: global.prior.length + 1, prior_event_sha256: global.prior.at(-1)?.event_sha256 ?? null, event_sha256: null}; globalEvent.event_sha256 = canonicalDigest({...globalEvent, event_sha256: null});
    fs.appendFileSync(state.ledgerPath, `${canonicalJson(event)}\n`, {mode: 0o600});
    const descriptor = fs.openSync(state.ledgerPath, "r"); try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    const next = [...state.prior, event];
    const readback = fs.readFileSync(state.ledgerPath, "utf8");
    if (readback !== next.map((entry) => `${canonicalJson(entry)}\n`).join("")) fail("external review replay ledger readback differs", "SPAWNER_EXTERNAL_REVIEW_REPLAY_LEDGER_INVALID");
    writeReplayHead(state.headPath, {bindingSha256: ledgerBinding(registry), schema: REVIEW_LEDGER_SCHEMA, version: REVIEW_LEDGER_VERSION}, next, root);
    fs.appendFileSync(global.ledgerPath, `${canonicalJson(globalEvent)}\n`, {mode: 0o600});
    const globalDescriptor = fs.openSync(global.ledgerPath, "r"); try { fs.fsyncSync(globalDescriptor); } finally { fs.closeSync(globalDescriptor); }
    const globalNext = [...global.prior, globalEvent];
    const globalReadback = fs.readFileSync(global.ledgerPath, "utf8");
    if (globalReadback !== globalNext.map((entry) => `${canonicalJson(entry)}\n`).join("")) fail("external review global replay ledger readback differs", "SPAWNER_EXTERNAL_REVIEW_REPLAY_LEDGER_INVALID");
    writeReplayHead(global.headPath, {bindingSha256: GLOBAL_REVIEW_LEDGER_BINDING, schema: GLOBAL_REVIEW_LEDGER_SCHEMA, version: GLOBAL_REVIEW_LEDGER_VERSION}, globalNext, globalRoot);
  } finally { try { fs.closeSync(lock); } catch {} try { fs.unlinkSync(lockPath); } catch {} }
}

export function verifyAndConsumeCurrentExternalSpawnerReview({candidate, hostileEvaluation} = {}) {
  const store = stores.get(installedStore);
  if (!store) fail("external reviewer authority is not provisioned", "SPAWNER_EXTERNAL_REVIEW_PROVISIONING_REQUIRED");
  const current = read(store.root, "current-review.v1.json"); exact(current, ["schema", "version", "receipt_sha256"], "current external review reference");
  if (current.schema !== "agentos.current_external_spawner_review.v1" || current.version !== 1 || !SHA.test(current.receipt_sha256)) fail("current external review reference differs");
  const receipt = read(store.root, `receipts/${current.receipt_sha256}.json`);
  exact(receipt, ["schema", "version", "receipt_id", "reviewer_id", "reviewer_role", "authority_epoch", "git_ancestry", "candidate_package_sha256", "candidate_package_file_sha256", "candidate_root_sha256", "gate_manifest_sha256", "fixture_manifest_sha256", "hostile_evaluation_sha256", "fixture_result_count", "fixture_inventory_sha256", "scope", "custody", "result", "issued_at_utc", "expires_at_utc", "nonce_sha256", "receipt_sha256", "signature_base64"], "external Spawner review receipt");
  const reviewer = store.registry.reviewers.find((entry) => entry.reviewer_id === receipt.reviewer_id);
  if (receipt.receipt_sha256 !== current.receipt_sha256) fail("external review receipt filename does not match its embedded digest", "SPAWNER_EXTERNAL_REVIEW_RECEIPT_ALIAS");
  if (!reviewer || receipt.reviewer_role !== reviewer.role || receipt.authority_epoch !== store.registry.authority_epoch) fail("external review issuer is unknown, revoked, stale, or role-mismatched");
  if (receipt.git_ancestry?.authorized_predecessor_commit !== store.registry.authorized_predecessor_commit) fail("external review authorized predecessor differs from protected reviewer registry", "SPAWNER_AUTHORITY_CHAIN_MISMATCH");
  verifyCandidateCommitBytes(candidate, receipt.git_ancestry);
  const expectedInventory = hostileEvaluation.results.map((entry) => ({fixture_id: entry.fixture_id, gate_id: entry.gate_id, result: entry.result, actual_outcome: entry.actual_outcome, error_code: entry.error_code})).sort((a, b) => compareUtf8(a.fixture_id, b.fixture_id));
  if (receipt.candidate_package_sha256 !== candidate.spawner_package.package_sha256 || receipt.candidate_package_file_sha256 !== candidate.package_file_sha256 || receipt.candidate_root_sha256 !== candidate.review_candidate_root_sha256 || receipt.gate_manifest_sha256 !== candidate.manifest.manifest_sha256 || receipt.fixture_manifest_sha256 !== candidate.fixture_manifest.manifest_sha256 || receipt.hostile_evaluation_sha256 !== hostileEvaluation.evaluation_sha256 || receipt.fixture_result_count !== expectedInventory.length || receipt.fixture_inventory_sha256 !== canonicalDigest(expectedInventory)) fail("external review candidate or executed evidence binding differs");
  if (receipt.result !== "PASS" || receipt.reviewer_role !== "AGENT.INDEPENDENT_EVALUATOR" || JSON.stringify(receipt.scope) !== JSON.stringify(["CANDIDATE_COMPONENT_ROOT", "GATE_BYTES", "HOSTILE_FIXTURE_EXECUTION"]) || receipt.custody?.read_only_candidate !== true || receipt.custody?.builder_separated !== true || receipt.custody?.governance_write_capability !== false) fail("external review result, scope, or custody differs");
  const now = Date.now(); if (!(Date.parse(receipt.issued_at_utc) <= now && now < Date.parse(receipt.expires_at_utc))) fail("external review receipt is future-dated or stale");
  verifySigned(receipt, "receipt_sha256", "signature_base64", reviewer.public_key_pem, "external review receipt"); consume(store.root, store.registry, receipt);
  return Object.freeze({receipt_sha256: receipt.receipt_sha256, reviewer_id: receipt.reviewer_id, candidate_root_sha256: receipt.candidate_root_sha256, hostile_evaluation_sha256: receipt.hostile_evaluation_sha256});
}
