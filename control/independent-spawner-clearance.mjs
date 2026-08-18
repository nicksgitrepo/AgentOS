import crypto, {createPublicKey, verify as verifySignature} from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {canonicalDigest, canonicalJson, compareUtf8} from "./content-addressing.mjs";
import {assertSealedCanonicalAuthority, getSealedCanonicalAuthority, readSealedAuthorityBinding, sealedAuthorityRepositoryRoot} from "./sealed-canonical-authority.mjs";

export const INDEPENDENT_CLEARANCE_SCHEMA = "agentos.independent_spawner_clearance.v2";
export const INDEPENDENT_CLEARANCE_REGISTRY_SCHEMA = "agentos.independent_evaluator_registry.v2";
export const INDEPENDENT_CLEARANCE_SCOPE = Object.freeze(["ADMISSION_BLOCKS", "AUTHORITY_SEPARATION", "BOOTSTRAP_PACKAGE", "ECO_MODEL_POLICY", "GLOBAL_GOVERNANCE_MEMORY", "HOSTILE_REGRESSIONS", "INERT_SEED_LIFECYCLE"]);
const verifiedClearances = new WeakSet();
const clearanceStores = new WeakMap();
let installedClearanceStore = null;
const SHA256 = /^[0-9a-f]{64}$/u;
const SHA1 = /^[0-9a-f]{40}$/u;
const IDENTIFIER = /^[A-Z][A-Z0-9._:-]{0,191}$/u;
const REQUIRED_BINDINGS = Object.freeze({package: "specialist-blocks/control-plane/agent-spawner/block.json", gate_manifest: "specialist-blocks/control-plane/agent-spawner/gates/manifest.json", admission_manifest: "specialist-blocks/control-plane/agent-spawner/admission/manifest.json", lifecycle: "schemas/agent-spawner-lifecycle.v1.json", roster: "specialist-blocks/registry/roster.v1.json", context: "schemas/bootstrap-binding.v1.json"});
const FORBIDDEN_ROLES = ["AGENT.CONTROLLER", "AGENT.SPAWNER_COMPILER", "AGENT.BUILDER"];

function fail(message, code = "INDEPENDENT_CLEARANCE_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function record(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function exact(value, keys, label) { assert(record(value), `${label} must be an object`); assert(JSON.stringify(Object.keys(value).sort(compareUtf8)) === JSON.stringify([...keys].sort(compareUtf8)), `${label} fields mismatch`); }
function sha(value, label) { assert(typeof value === "string" && SHA256.test(value), `${label} must be a SHA-256`); }
function sha1(value, label) { assert(typeof value === "string" && SHA1.test(value), `${label} must be a Git object ID`); }
function id(value, label) { assert(typeof value === "string" && IDENTIFIER.test(value), `${label} must be a stable identifier`); }
function time(value, label) { const parsed = Date.parse(value); assert(typeof value === "string" && Number.isFinite(parsed), `${label} must be an ISO timestamp`); return parsed; }
function body(value, digestField, signatureField = null) { const copy = structuredClone(value); copy[digestField] = null; if (signatureField) copy[signatureField] = null; return copy; }
function same(left, right, label) { assert(canonicalJson(left) === canonicalJson(right), `${label} differs from canonical authority`); }
function fileSha(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
function readJson(filePath, label) { const stat = fs.lstatSync(filePath); assert(stat.isFile() && !stat.isSymbolicLink(), `${label} must be a regular non-symlink file`); return JSON.parse(fs.readFileSync(filePath, "utf8")); }
function within(root, relative, label) { assert(typeof relative === "string" && relative.length > 0 && !path.isAbsolute(relative), `${label} path is invalid`); const target = path.resolve(root, relative); assert(target.startsWith(`${path.resolve(root)}${path.sep}`), `${label} path escapes authority root`); return target; }

export function loadIndependentClearanceTrustAnchor() {
  const anchor = readSealedAuthorityBinding(getSealedCanonicalAuthority(), "spawner_bound_specialist_blocks_control_plane_agent_spawner_independent_clearance_trust_anchor_v1_json").value;
  exact(anchor, ["schema", "version", "registry_id", "minimum_authority_epoch", "registry_sha256", "anchor_sha256"], "Independent-clearance trust anchor");
  assert(anchor.schema === "agentos.independent_clearance_trust_anchor.v1" && anchor.version === 1, "Independent-clearance trust anchor identity is invalid");
  id(anchor.registry_id, "Independent-clearance registry ID"); assert(Number.isSafeInteger(anchor.minimum_authority_epoch) && anchor.minimum_authority_epoch >= 1, "Independent-clearance anchor epoch is invalid");
  sha(anchor.registry_sha256, "Anchored evaluator registry"); sha(anchor.anchor_sha256, "Independent-clearance trust anchor");
  assert(anchor.anchor_sha256 === canonicalDigest(body(anchor, "anchor_sha256")), "Independent-clearance trust-anchor digest mismatch");
  return anchor;
}

function validateIndependentEvaluatorRegistryAuthoritatively(registry, {anchor, nowUtc} = {}) {
  exact(registry, ["schema", "version", "registry_id", "authority_epoch", "evaluators", "registry_sha256"], "Independent evaluator registry");
  assert(registry.schema === INDEPENDENT_CLEARANCE_REGISTRY_SCHEMA && registry.version === 2, "Independent evaluator registry identity is invalid");
  assert(registry.registry_id === anchor.registry_id, "Independent evaluator registry identity is not anchored");
  assert(Number.isSafeInteger(registry.authority_epoch) && registry.authority_epoch >= anchor.minimum_authority_epoch, "Independent evaluator authority epoch is superseded");
  assert(Array.isArray(registry.evaluators) && registry.evaluators.length > 0, "Independent evaluator registry is empty");
  const ids = new Set();
  for (const evaluator of registry.evaluators) {
    exact(evaluator, ["issuer_id", "role_id", "status", "authority_epoch", "admission_receipt_sha256", "public_key_pem", "separated_from_roles", "scope", "valid_from_utc", "expires_at_utc", "revoked_at_utc"], "Independent evaluator entry");
    id(evaluator.issuer_id, "Evaluator issuer ID"); assert(!ids.has(evaluator.issuer_id), "Independent evaluator issuer is duplicated"); ids.add(evaluator.issuer_id);
    assert(evaluator.role_id === "AGENT.INDEPENDENT_EVALUATOR" && evaluator.status === "ADMITTED", "Clearance issuer is not a separately admitted evaluator");
    assert(evaluator.authority_epoch === registry.authority_epoch && evaluator.revoked_at_utc === null, "Independent evaluator is revoked or stale");
    sha(evaluator.admission_receipt_sha256, "Evaluator admission receipt"); createPublicKey(evaluator.public_key_pem);
    assert(FORBIDDEN_ROLES.every((role) => evaluator.separated_from_roles.includes(role)), "Evaluator separation is incomplete");
    assert(JSON.stringify(evaluator.scope) === JSON.stringify(INDEPENDENT_CLEARANCE_SCOPE), "Evaluator clearance scope is incomplete");
    const now = time(nowUtc, "trusted current time"); assert(time(evaluator.valid_from_utc, "Evaluator valid-from") <= now && now < time(evaluator.expires_at_utc, "Evaluator expiry"), "Evaluator authority is not current");
  }
  sha(registry.registry_sha256, "Independent evaluator registry digest"); assert(registry.registry_sha256 === canonicalDigest(body(registry, "registry_sha256")), "Independent evaluator registry digest mismatch");
  assert(registry.registry_sha256 === anchor.registry_sha256, "Independent evaluator registry is not the canonical anchored authority");
  return registry;
}

export function auditIndependentEvaluatorRegistryNonAuthoritatively(registry, {anchor, nowUtc} = {}) {
  return validateIndependentEvaluatorRegistryAuthoritatively(registry, {anchor, nowUtc});
}

export function resolveSpawnerCandidateFromRepository({repositoryRoot, candidateAuthority}) {
  exact(candidateAuthority, ["schema", "version", "repository_identity", "commit_sha1", "tree_sha1", "artifact_bindings", "custody", "candidate_authority_sha256"], "Spawner candidate authority");
  assert(candidateAuthority.schema === "agentos.spawner_candidate_authority.v1" && candidateAuthority.version === 1 && candidateAuthority.repository_identity === "AGENTOS_CANONICAL_REPOSITORY", "Spawner candidate authority identity is invalid");
  sha1(candidateAuthority.commit_sha1, "Spawner candidate commit"); sha1(candidateAuthority.tree_sha1, "Spawner candidate tree");
  const head = execFileSync("git", ["rev-parse", "HEAD"], {cwd: repositoryRoot, encoding: "utf8"}).trim();
  const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], {cwd: repositoryRoot, encoding: "utf8"}).trim();
  assert(head === candidateAuthority.commit_sha1 && tree === candidateAuthority.tree_sha1, "Independent clearance candidate is stale or synthetic");
  exact(candidateAuthority.artifact_bindings, Object.keys(REQUIRED_BINDINGS), "Spawner candidate artifact bindings");
  const hashes = {}, contents = {};
  for (const [name, expectedPath] of Object.entries(REQUIRED_BINDINGS)) {
    const binding = candidateAuthority.artifact_bindings[name]; exact(binding, ["path", "file_sha256"], `Spawner candidate ${name} binding`);
    assert(binding.path === expectedPath, `Spawner candidate ${name} path is substituted`); sha(binding.file_sha256, `Spawner candidate ${name} digest`);
    const bytes = fs.readFileSync(within(repositoryRoot, binding.path, `Spawner candidate ${name}`)); hashes[name] = fileSha(bytes); contents[name] = bytes;
    assert(hashes[name] === binding.file_sha256, `Spawner candidate ${name} bytes differ from authority`);
  }
  exact(candidateAuthority.custody, ["worktree_id", "detached", "clean", "source_preserved", "builder_separated", "custody_readback_sha256"], "Spawner candidate custody");
  assert(candidateAuthority.custody.detached === true && candidateAuthority.custody.clean === true && candidateAuthority.custody.source_preserved === true && candidateAuthority.custody.builder_separated === true, "Spawner candidate custody is not independently isolated");
  sha(candidateAuthority.custody.custody_readback_sha256, "Spawner candidate custody readback"); sha(candidateAuthority.candidate_authority_sha256, "Spawner candidate authority digest");
  assert(candidateAuthority.candidate_authority_sha256 === canonicalDigest(body(candidateAuthority, "candidate_authority_sha256")), "Spawner candidate authority digest mismatch");
  const packageBlock = JSON.parse(contents.package.toString("utf8")); sha(packageBlock.package_sha256, "Spawner package semantic digest");
  return {commit_sha1: head, tree_sha1: tree, package_sha256: packageBlock.package_sha256, package_file_sha256: hashes.package, evidence_set_sha256: canonicalDigest({admission_manifest: hashes.admission_manifest, gate_manifest: hashes.gate_manifest}), lifecycle_candidate_sha256: hashes.lifecycle, roster_projection_sha256: hashes.roster, context_sha256: hashes.context};
}

function validateReceipt({receipt, registry, candidate, candidateAuthority, nowUtc}) {
  exact(receipt, ["schema", "version", "receipt_id", "issuer_id", "issuer_role", "subject_role", "result", "authority_epoch", "registry_sha256", "candidate_authority_sha256", "candidate", "scope", "custody", "issued_at_utc", "expires_at_utc", "nonce_sha256", "supersedes_receipt_sha256", "receipt_sha256", "signature_base64"], "Independent clearance receipt");
  assert(receipt.schema === INDEPENDENT_CLEARANCE_SCHEMA && receipt.version === 2, "Independent clearance receipt identity is invalid"); id(receipt.receipt_id, "Independent clearance receipt ID");
  assert(receipt.issuer_role === "AGENT.INDEPENDENT_EVALUATOR" && !FORBIDDEN_ROLES.includes(receipt.issuer_role), "Spawner, Controller, or builder cannot issue independent clearance");
  assert(receipt.subject_role === "AGENT.SPAWNER_COMPILER" && receipt.result === "PASS", "Independent clearance result or subject is invalid");
  assert(receipt.authority_epoch === registry.authority_epoch && receipt.registry_sha256 === registry.registry_sha256, "Independent clearance registry authority is stale or substituted");
  assert(receipt.candidate_authority_sha256 === candidateAuthority.candidate_authority_sha256, "Independent clearance candidate authority is substituted");
  const evaluator = registry.evaluators.find((entry) => entry.issuer_id === receipt.issuer_id); assert(evaluator && evaluator.role_id === receipt.issuer_role, "Independent clearance issuer is unknown or role-mismatched");
  same(receipt.candidate, candidate, "Independent clearance candidate binding"); assert(JSON.stringify(receipt.scope) === JSON.stringify(INDEPENDENT_CLEARANCE_SCOPE), "Independent clearance scope is partial, reordered, or unknown"); same(receipt.custody, candidateAuthority.custody, "Independent clearance custody binding");
  const now = time(nowUtc, "trusted current time"); assert(time(receipt.issued_at_utc, "Clearance issue time") <= now, "Independent clearance was issued in the future"); assert(now < time(receipt.expires_at_utc, "Clearance expiry"), "Independent clearance is stale");
  sha(receipt.nonce_sha256, "Independent clearance nonce"); if (receipt.supersedes_receipt_sha256 !== null) sha(receipt.supersedes_receipt_sha256, "Superseded clearance receipt");
  sha(receipt.receipt_sha256, "Independent clearance digest"); assert(receipt.receipt_sha256 === canonicalDigest(body(receipt, "receipt_sha256", "signature_base64")), "Independent clearance receipt body was mutated");
  assert(verifySignature(null, Buffer.from(receipt.receipt_sha256, "hex"), evaluator.public_key_pem, Buffer.from(receipt.signature_base64, "base64")), "Independent clearance signature is invalid or locally fabricated");
}

function readLedger(ledgerPath) {
  if (!fs.existsSync(ledgerPath)) return {schema: "agentos.independent_clearance_consumption_ledger.v1", version: 1, events: [], head_sha256: null};
  const ledger = readJson(ledgerPath, "Independent-clearance ledger"); exact(ledger, ["schema", "version", "events", "head_sha256"], "Independent-clearance ledger");
  let head = null; const used = new Set();
  ledger.events.forEach((event, index) => { exact(event, ["sequence", "receipt_sha256", "candidate_authority_sha256", "prior_head_sha256", "consumed_at_utc", "event_sha256"], "Independent-clearance consumption event"); assert(event.sequence === index + 1 && event.prior_head_sha256 === head, "Independent-clearance ledger sequence or head is invalid"); assert(!used.has(event.receipt_sha256), "Independent-clearance ledger replays a receipt"); used.add(event.receipt_sha256); assert(event.event_sha256 === canonicalDigest(body(event, "event_sha256")), "Independent-clearance consumption digest mismatch"); head = event.event_sha256; });
  assert(ledger.head_sha256 === head, "Independent-clearance ledger head mismatch"); return ledger;
}

function consumeReceipt({authorityRoot, receipt, candidateAuthority, nowUtc}) {
  const ledgerPath = within(authorityRoot, "consumption-ledger.v1.json", "Independent-clearance ledger"), lockPath = `${ledgerPath}.lock`;
  let lock; try { lock = fs.openSync(lockPath, "wx", 0o600); } catch (error) { if (error.code === "EEXIST") fail("Independent-clearance ledger is locked by another consumer", "INDEPENDENT_CLEARANCE_CONCURRENT_CONSUMPTION"); throw error; }
  const temporary = `${ledgerPath}.${process.pid}.${crypto.randomUUID()}.stage`;
  try {
    const ledger = readLedger(ledgerPath); assert(!ledger.events.some((event) => event.receipt_sha256 === receipt.receipt_sha256), "Independent clearance receipt was already consumed", "INDEPENDENT_CLEARANCE_REPLAY");
    if (receipt.supersedes_receipt_sha256 !== null) assert(ledger.events.some((event) => event.receipt_sha256 === receipt.supersedes_receipt_sha256), "Independent clearance supersedes an unknown receipt");
    const event = {sequence: ledger.events.length + 1, receipt_sha256: receipt.receipt_sha256, candidate_authority_sha256: candidateAuthority.candidate_authority_sha256, prior_head_sha256: ledger.head_sha256, consumed_at_utc: nowUtc, event_sha256: null}; event.event_sha256 = canonicalDigest(body(event, "event_sha256"));
    const next = {...ledger, events: [...ledger.events, event], head_sha256: event.event_sha256}; const descriptor = fs.openSync(temporary, "wx", 0o600); fs.writeFileSync(descriptor, `${canonicalJson(next)}\n`); fs.fsyncSync(descriptor); fs.closeSync(descriptor); fs.renameSync(temporary, ledgerPath); const directory = fs.openSync(path.dirname(ledgerPath), "r"); fs.fsyncSync(directory); fs.closeSync(directory); assert(readLedger(ledgerPath).head_sha256 === event.event_sha256, "Independent-clearance consumption readback differs");
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); fs.closeSync(lock); if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath); }
}

function verifyBundle({authorityRoot, repositoryRoot, receiptSha256, consume, issueToken}) {
  sha(receiptSha256, "Independent clearance receipt reference"); const nowUtc = new Date().toISOString(), anchor = loadIndependentClearanceTrustAnchor();
  const registry = validateIndependentEvaluatorRegistryAuthoritatively(readJson(within(authorityRoot, "evaluator-registry.v2.json", "Evaluator registry"), "Evaluator registry"), {anchor, nowUtc});
  const candidateAuthority = readJson(within(authorityRoot, "candidate-authority.v1.json", "Spawner candidate authority"), "Spawner candidate authority"); const candidate = resolveSpawnerCandidateFromRepository({repositoryRoot, candidateAuthority});
  const receipt = readJson(within(authorityRoot, `receipts/${receiptSha256}.json`, "Independent clearance receipt"), "Independent clearance receipt"); assert(receipt.receipt_sha256 === receiptSha256, "Independent clearance receipt reference is aliased"); validateReceipt({receipt, registry, candidate, candidateAuthority, nowUtc});
  if (consume) consumeReceipt({authorityRoot, receipt, candidateAuthority, nowUtc});
  const clearance = Object.freeze({receipt_sha256: receipt.receipt_sha256, candidate: Object.freeze(structuredClone(candidate)), issuer_id: receipt.issuer_id, authority_epoch: receipt.authority_epoch, candidate_authority_sha256: candidateAuthority.candidate_authority_sha256}); if (issueToken) verifiedClearances.add(clearance);
  return {clearance, receipt, registry, candidate, candidateAuthority};
}

/* Internal bootstrap adapter. The resulting capability is opaque and is never exported from the public AgentOS facade. */
export function installIndependentClearanceAuthorityStore({sealedAuthority, authorityRoot} = {}) {
  assertSealedCanonicalAuthority(sealedAuthority);
  assert(typeof authorityRoot === "string" && path.isAbsolute(authorityRoot), "Independent-clearance store root must be absolute");
  const realRoot = fs.realpathSync.native(authorityRoot);
  assert(fs.lstatSync(realRoot).isDirectory() && !fs.lstatSync(authorityRoot).isSymbolicLink(), "Independent-clearance store root must be a real non-symlink directory");
  const anchor = loadIndependentClearanceTrustAnchor();
  const registry = readJson(within(realRoot, "evaluator-registry.v2.json", "Evaluator registry"), "Evaluator registry");
  validateIndependentEvaluatorRegistryAuthoritatively(registry, {anchor, nowUtc: new Date().toISOString()});
  const store = Object.freeze(Object.create(null));
  clearanceStores.set(store, Object.freeze({authorityRoot: realRoot, repositoryRoot: sealedAuthorityRepositoryRoot(sealedAuthority)}));
  installedClearanceStore = store;
  return store;
}

export function verifyIndependentSpawnerClearance({receiptSha256, authorityRoot = undefined, registry = undefined, anchor = undefined, expectedCandidate = undefined, usedReceipts = undefined, nowUtc = undefined} = {}) {
  assert(authorityRoot === undefined && registry === undefined && anchor === undefined && expectedCandidate === undefined && usedReceipts === undefined && nowUtc === undefined, "Caller-supplied clearance authority, candidate, clock, or replay state is forbidden", "SEALED_CLEARANCE_AUTHORITY_REQUIRED");
  const store = clearanceStores.get(installedClearanceStore);
  assert(store, "Canonical independent-clearance store is not installed by sealed bootstrap", "SEALED_CLEARANCE_AUTHORITY_REQUIRED");
  return verifyBundle({...store, receiptSha256, consume: true, issueToken: true}).clearance;
}
export function auditIndependentClearanceFixture({authorityRoot, repositoryRoot, receiptSha256, consume = false} = {}) { return verifyBundle({authorityRoot: fs.realpathSync.native(authorityRoot), repositoryRoot: fs.realpathSync.native(repositoryRoot), receiptSha256, consume, issueToken: false}); }
export function assertVerifiedIndependentClearance(clearance, expectedCandidate) { assert(record(clearance) && verifiedClearances.has(clearance), "Independent clearance was not verified and consumed through the canonical authority store"); same(clearance.candidate, expectedCandidate, "Verified independent clearance candidate binding"); return clearance; }
