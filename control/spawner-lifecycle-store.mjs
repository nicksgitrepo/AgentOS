#!/usr/bin/env node

/* Durable project-scoped lifecycle ledger and typed receipt consumer. */

import fs from "node:fs";
import path from "node:path";
import {randomBytes} from "node:crypto";
import {canonicalDigest, canonicalJson, compareUtf8} from "./content-addressing.mjs";
import {assertOperationalGlobalGovernanceContext} from "./global-governance-operational-context.mjs";
import {resolveCanonicalPermanentRole} from "./permanent-role-registry.mjs";
import {consumeInstalledProjectLifecycleCustody} from "./project-lifecycle-custody.mjs";

export const SPAWNER_LIFECYCLE_STORE_SCHEMA = "agentos.spawner_lifecycle_store.v2";
export const SPAWNER_LIFECYCLE_RECEIPT_SCHEMA = "agentos.spawner_lifecycle_transition_receipt.v1";
export const SPAWNER_LIFECYCLE_EVENT_KINDS = Object.freeze([
  "SPAWN_AUTHORIZED", "HANDOFF_ACCEPTED", "SCOPE_CLOSED", "EVIDENCE_PRESERVED",
  "WORKTREE_RELEASED", "CUSTODY_RELEASED", "DESPAWN_AUTHORIZED",
]);
const RELATIVE_LEDGER = "project-state/agent-lifecycle-events.jsonl";
const RELATIVE_AUTHORITY = "project-state/lifecycle-authority.json";
const RELATIVE_GENERATION = "project-state/lifecycle-attachment-generation.json";
const RELATIVE_RECEIPTS = "project-state/lifecycle-transition-receipts";
const GENESIS = "0".repeat(64);
const SHA = /^[0-9a-f]{64}$/u;
const ID = /^[A-Z][A-Z0-9._:-]{0,191}$/u;
const RECEIPT_REF = /^ref:(spawner-admission|admission|handoff|scope|evidence|worktree-release|custody-release|lifecycle)\/([0-9a-f]{64})$/u;
const stores = new WeakMap();

const REQUIRED_PREDECESSOR = Object.freeze({
  SPAWN_AUTHORIZED: null, HANDOFF_ACCEPTED: "SPAWN_AUTHORIZED", SCOPE_CLOSED: "HANDOFF_ACCEPTED",
  EVIDENCE_PRESERVED: "SCOPE_CLOSED", WORKTREE_RELEASED: "EVIDENCE_PRESERVED",
  CUSTODY_RELEASED: "WORKTREE_RELEASED", DESPAWN_AUTHORIZED: "CUSTODY_RELEASED",
});
const RECEIPT_KIND = Object.freeze({
  SPAWN_AUTHORIZED: "SPAWN_ADMISSION", HANDOFF_ACCEPTED: "HANDOFF_ACCEPTANCE", SCOPE_CLOSED: "SCOPE_CLOSEOUT",
  EVIDENCE_PRESERVED: "EVIDENCE_PRESERVATION", WORKTREE_RELEASED: "WORKTREE_RELEASE",
  CUSTODY_RELEASED: "CUSTODY_RELEASE", DESPAWN_AUTHORIZED: "DESPAWN_ELIGIBILITY",
});
const RECEIPT_PREFIX = Object.freeze({SPAWN_ADMISSION: "admission", SPAWNER_ADMISSION: "spawner-admission", HANDOFF_ACCEPTANCE: "handoff", SCOPE_CLOSEOUT: "scope", EVIDENCE_PRESERVATION: "evidence", WORKTREE_RELEASE: "worktree-release", CUSTODY_RELEASE: "custody-release", DESPAWN_ELIGIBILITY: "lifecycle"});
const RECEIPT_ISSUER = Object.freeze({SPAWNER_ADMISSION: "AGENTOS.INDEPENDENT_EVALUATOR", SPAWN_ADMISSION: "AGENTOS.INDEPENDENT_EVALUATOR", HANDOFF_ACCEPTANCE: "AGENTOS.ORCHESTRATOR", SCOPE_CLOSEOUT: "AGENTOS.ORCHESTRATOR", EVIDENCE_PRESERVATION: "AGENTOS.ORCHESTRATOR", WORKTREE_RELEASE: "AGENTOS.SPAWNER", CUSTODY_RELEASE: "AGENTOS.SPAWNER", DESPAWN_ELIGIBILITY: "AGENTOS.SPAWNER"});

function fail(message, code = "SPAWNER_LIFECYCLE_STORE_INVALID", details = null) { const error = new Error(message); error.code = code; if (details !== null) error.details = details; throw error; }
function assert(value, message, code, details) { if (!value) fail(message, code, details); }
function exact(value, keys, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert(JSON.stringify(Object.keys(value).sort(compareUtf8)) === JSON.stringify([...keys].sort(compareUtf8)), `${label} fields mismatch`);
}
function realRoot(root) { const real = fs.realpathSync.native(root), stat = fs.lstatSync(real); assert(real === root && stat.isDirectory() && !stat.isSymbolicLink(), "Project lifecycle root is unsafe"); return real; }
function target(root, relative) { const value = path.resolve(root, relative); assert(value.startsWith(`${root}${path.sep}`), "Project lifecycle path escaped custody"); return value; }
function ensureParent(file, root) {
  let cursor = path.dirname(file), missing = [];
  while (!fs.existsSync(cursor)) { missing.push(cursor); cursor = path.dirname(cursor); }
  assert(fs.realpathSync.native(cursor) === cursor && !fs.lstatSync(cursor).isSymbolicLink(), "Project lifecycle parent is unsafe");
  for (const directory of missing.reverse()) fs.mkdirSync(directory, {mode: 0o700});
  for (let current = path.dirname(file); current !== root; current = path.dirname(current)) assert(!fs.lstatSync(current).isSymbolicLink(), "Project lifecycle parent is a symlink");
}
function syncDirectory(directory) { const fd = fs.openSync(directory, fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY ?? 0)); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
function writeExclusive(file, value, root) { ensureParent(file, root); const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600); try { fs.writeFileSync(fd, `${canonicalJson(value)}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } syncDirectory(path.dirname(file)); }
function atomicReplace(file, value, nonce, root) { ensureParent(file, root); const staged = `${file}.stage.${nonce}`; const fd = fs.openSync(staged, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600); try { fs.writeFileSync(fd, `${canonicalJson(value)}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } fs.renameSync(staged, file); syncDirectory(path.dirname(file)); }
function readJson(file) { const stat = fs.lstatSync(file); assert(stat.isFile() && !stat.isSymbolicLink(), "Project lifecycle artifact is unsafe"); return JSON.parse(fs.readFileSync(file, "utf8")); }
function body(value, digestField) { return {...structuredClone(value), [digestField]: null}; }
function eventBody(value) { return body(value, "event_sha256"); }
function receiptBody(value) { return {...structuredClone(value), receipt_ref: null, receipt_sha256: null}; }

function lockAlive(record) {
  if (!record || record.schema !== "agentos.spawner_lifecycle_lock.v2" || !Number.isSafeInteger(record.process_id) || record.process_id < 1 || !SHA.test(record.fence)) return true;
  try { process.kill(record.process_id, 0); return true; } catch (error) { return error.code !== "ESRCH"; }
}
function acquireLock(file, purpose, root) {
  const lockPath = `${file}.lock`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const lock = {schema: "agentos.spawner_lifecycle_lock.v2", version: 1, purpose, process_id: process.pid, nonce: randomBytes(32).toString("hex"), acquired_at_utc: new Date().toISOString(), fence: null};
    lock.fence = canonicalDigest(body(lock, "fence"));
    try { writeExclusive(lockPath, lock, root); return {lockPath, lock}; }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      let prior; try { prior = readJson(lockPath); } catch { fail("Lifecycle lock is malformed", "SPAWNER_LIFECYCLE_LOCKED"); }
      if (lockAlive(prior)) fail("Lifecycle store is held by a live or unproven writer", "SPAWNER_LIFECYCLE_LOCKED");
      fs.unlinkSync(lockPath);
    }
  }
  fail("Lifecycle lock could not be acquired", "SPAWNER_LIFECYCLE_LOCKED");
}
function releaseLock(lockPath) { try { fs.unlinkSync(lockPath); } catch (error) { if (error.code !== "ENOENT") throw error; } }

function openProjectCustody(provisioning) {
  const installed = consumeInstalledProjectLifecycleCustody(provisioning), root = realRoot(installed.root);
  const authorityPath = target(root, RELATIVE_AUTHORITY), generationPath = target(root, RELATIVE_GENERATION);
  const identity = canonicalDigest({schema: "agentos.project_lifecycle_identity.v1", project_identity_sha256: installed.projectIdentitySha256, bootstrap_custody_sha256: installed.bootstrapCustodySha256});
  const authority = {schema: "agentos.project_lifecycle_authority.v1", version: 1, project_identity_sha256: installed.projectIdentitySha256, bootstrap_custody_sha256: installed.bootstrapCustodySha256, project_store_id: `PROJECT.STORE.${identity.toUpperCase()}`, store_id: `LIFECYCLE.STORE.${identity.toUpperCase()}`, authority_sha256: null};
  authority.authority_sha256 = canonicalDigest(body(authority, "authority_sha256"));
  if (!fs.existsSync(authorityPath)) writeExclusive(authorityPath, authority, root);
  else assert(canonicalJson(readJson(authorityPath)) === canonicalJson(authority), "Project lifecycle authority identity changed", "PROJECT_LIFECYCLE_CROSS_PROJECT");
  const {lockPath, lock} = acquireLock(generationPath, "ATTACHMENT_GENERATION", root);
  try {
    const prior = fs.existsSync(generationPath) ? readJson(generationPath) : null;
    if (prior !== null) {
      exact(prior, ["schema", "version", "authority_sha256", "generation", "prior_generation_sha256", "generation_sha256"], "Lifecycle attachment generation");
      assert(prior.authority_sha256 === authority.authority_sha256 && prior.generation_sha256 === canonicalDigest(body(prior, "generation_sha256")), "Lifecycle attachment generation is invalid");
    }
    const generation = (prior?.generation ?? 0) + 1;
    const next = {schema: "agentos.project_lifecycle_attachment_generation.v1", version: 1, authority_sha256: authority.authority_sha256, generation, prior_generation_sha256: prior?.generation_sha256 ?? GENESIS, generation_sha256: null};
    next.generation_sha256 = canonicalDigest(body(next, "generation_sha256")); atomicReplace(generationPath, next, lock.fence, root);
    return Object.freeze({root, authority, generation, generationPath});
  } finally { releaseLock(lockPath); }
}

function validateEvent(event, index, prior, state) {
  exact(event, ["schema", "version", "sequence", "fencing_epoch", "attachment_generation", "project_identity_sha256", "project_store_id", "store_id", "event_id", "event_kind", "request_id", "agent_id", "role_id", "admission_receipt_ref", "custody_chain_sha256", "receipt_ref", "receipt_sha256", "spawner_context_sha256", "model_snapshot_sha256", "model_selection_sha256", "prior_event_sha256", "occurred_at_utc", "event_sha256"], `Lifecycle event ${index}`);
  assert(event.schema === "agentos.spawner_lifecycle_event.v2" && event.version === 2 && event.sequence === index && event.fencing_epoch === index + 1, "Lifecycle event identity/sequence differs");
  assert(event.project_identity_sha256 === state.project.authority.project_identity_sha256 && event.project_store_id === state.project.authority.project_store_id && event.store_id === state.project.authority.store_id, "Lifecycle event belongs to another project");
  assert(Number.isSafeInteger(event.attachment_generation) && event.attachment_generation >= 1 && event.attachment_generation <= state.project.generation, "Lifecycle event attachment generation is invalid");
  assert(SPAWNER_LIFECYCLE_EVENT_KINDS.includes(event.event_kind) && ID.test(event.request_id) && ID.test(event.agent_id), "Lifecycle event kind/identity is invalid"); resolveCanonicalPermanentRole(event.role_id);
  assert(RECEIPT_REF.test(event.admission_receipt_ref) && RECEIPT_REF.test(event.receipt_ref) && SHA.test(event.receipt_sha256), "Lifecycle receipt binding is invalid");
  for (const value of [event.custody_chain_sha256, event.spawner_context_sha256, event.model_snapshot_sha256, event.model_selection_sha256, event.prior_event_sha256, event.event_sha256]) assert(SHA.test(value), "Lifecycle digest is invalid");
  assert(event.prior_event_sha256 === prior && Number.isFinite(Date.parse(event.occurred_at_utc)) && event.event_sha256 === canonicalDigest(eventBody(event)), "Lifecycle chain/time/digest differs");
  assert(event.event_id === `EVENT.${canonicalDigest({...event, event_id: null, event_sha256: null}).toUpperCase()}`, "Lifecycle event ID was not derived from content");
  return event.event_sha256;
}
function readEvents(state) {
  if (!fs.existsSync(state.ledgerPath)) return [];
  const text = fs.readFileSync(state.ledgerPath, "utf8"); assert(text.length === 0 || text.endsWith("\n"), "Lifecycle ledger is truncated");
  const events = text.length === 0 ? [] : text.trimEnd().split("\n").map(JSON.parse); let prior = GENESIS, agentStates = new Map(), generation = 0;
  events.forEach((event, index) => { prior = validateEvent(event, index, prior, state); assert(event.attachment_generation >= generation, "Lifecycle attachment generation moved backward"); generation = event.attachment_generation; const previous = agentStates.get(event.agent_id) ?? null; assert(previous?.event_kind === REQUIRED_PREDECESSOR[event.event_kind] || (previous === null && REQUIRED_PREDECESSOR[event.event_kind] === null), `Lifecycle transition ${event.event_kind} is out of order`); if (previous) assert(event.role_id === previous.role_id && event.admission_receipt_ref === previous.admission_receipt_ref && event.custody_chain_sha256 === previous.custody_chain_sha256, "Lifecycle continuity differs"); agentStates.set(event.agent_id, event); });
  // Crash recovery: a ledger rename may become durable immediately before the
  // matching issued->consumed receipt rename. The committed event is the
  // authoritative transaction record, so replay completes that one-way move.
  for (const event of events) {
    const match = RECEIPT_REF.exec(event.receipt_ref), directory = target(state.project.root, RELATIVE_RECEIPTS);
    const issued = path.join(directory, `${match[2]}.issued.json`), consumed = path.join(directory, `${match[2]}.consumed.json`);
    if (fs.existsSync(issued) && !fs.existsSync(consumed)) { try { fs.renameSync(issued, consumed); syncDirectory(directory); } catch (error) { if (error.code !== "ENOENT") throw error; } }
    assert(fs.existsSync(consumed), "Committed lifecycle event lacks its consumed receipt", "SPAWNER_LIFECYCLE_RECEIPT_READBACK_MISSING");
  }
  return events;
}
function stateFor(capability) {
  const state = stores.get(capability); assert(state, "Lifecycle store requires an opaque capability", "SPAWNER_LIFECYCLE_STORE_CAPABILITY_REQUIRED");
  const generation = readJson(state.project.generationPath); assert(generation.generation === state.project.generation && generation.generation_sha256 === canonicalDigest(body(generation, "generation_sha256")), "Lifecycle store attachment was fenced by a restart", "PROJECT_LIFECYCLE_ATTACHMENT_STALE");
  assertOperationalGlobalGovernanceContext(state.spawnerContext, {authorityStore: state.authorityStore, expectedRoleClass: "SPAWNER"}); return state;
}

export function openSpawnerLifecycleStore(options = {}) {
  exact(options, ["spawnerContext", "globalGovernanceAuthorityStore", "projectLifecycleCustody"], "Lifecycle store open");
  const {spawnerContext, globalGovernanceAuthorityStore, projectLifecycleCustody} = options;
  assertOperationalGlobalGovernanceContext(spawnerContext, {authorityStore: globalGovernanceAuthorityStore, expectedRoleClass: "SPAWNER"});
  assert(spawnerContext.compact_selection?.model_id && spawnerContext.compact_selection?.reasoning_effort, "Spawner lifecycle requires a current model route");
  const project = openProjectCustody(projectLifecycleCustody), ledgerPath = target(project.root, RELATIVE_LEDGER); ensureParent(ledgerPath, project.root);
  const capability = Object.freeze(Object.create(null)); stores.set(capability, Object.freeze({project, ledgerPath, spawnerContext, authorityStore: globalGovernanceAuthorityStore})); return capability;
}

export function readSpawnerLifecycleStore(capability) {
  const state = stateFor(capability), events = readEvents(state);
  return Object.freeze({schema: SPAWNER_LIFECYCLE_STORE_SCHEMA, version: 2, project_identity_sha256: state.project.authority.project_identity_sha256, project_store_id: state.project.authority.project_store_id, store_id: state.project.authority.store_id, attachment_generation: state.project.generation, event_count: events.length, head_sha256: events.at(-1)?.event_sha256 ?? GENESIS, events: Object.freeze(events.map(Object.freeze))});
}

function validateReceipt(receipt, state) {
  exact(receipt, ["schema", "version", "receipt_ref", "receipt_kind", "project_identity_sha256", "project_store_id", "agent_id", "role_id", "admission_receipt_ref", "request_id", "issuer_role", "subject_sha256", "assertions", "spawner_context_sha256", "model_snapshot_sha256", "model_selection_sha256", "occurred_at_utc", "receipt_sha256"], "Lifecycle transition receipt");
  assert(receipt.schema === SPAWNER_LIFECYCLE_RECEIPT_SCHEMA && receipt.version === 1 && Object.values(RECEIPT_KIND).concat("SPAWNER_ADMISSION").includes(receipt.receipt_kind), "Lifecycle receipt identity/kind differs");
  assert(receipt.issuer_role === RECEIPT_ISSUER[receipt.receipt_kind], "Lifecycle receipt issuer is not authorized for its transition kind");
  const match = RECEIPT_REF.exec(receipt.receipt_ref); assert(match && match[1] === RECEIPT_PREFIX[receipt.receipt_kind] && match[2] === receipt.receipt_sha256, "Lifecycle receipt reference differs from content");
  assert(receipt.project_identity_sha256 === state.project.authority.project_identity_sha256 && receipt.project_store_id === state.project.authority.project_store_id, "Lifecycle receipt belongs to another project", "PROJECT_LIFECYCLE_CROSS_PROJECT");
  assert(ID.test(receipt.agent_id) && ID.test(receipt.request_id) && typeof receipt.role_id === "string", "Lifecycle receipt identifiers are invalid"); resolveCanonicalPermanentRole(receipt.role_id);
  assert(RECEIPT_REF.test(receipt.admission_receipt_ref) && SHA.test(receipt.subject_sha256) && receipt.receipt_sha256 === canonicalDigest(receiptBody(receipt)), "Lifecycle receipt digest/binding is invalid");
  assert(receipt.spawner_context_sha256 === state.spawnerContext.context_sha256 && receipt.model_snapshot_sha256 === state.spawnerContext.snapshot_sha256 && receipt.model_selection_sha256 === canonicalDigest(state.spawnerContext.compact_selection), "Lifecycle receipt model/Spawner context is stale");
  assert(Number.isFinite(Date.parse(receipt.occurred_at_utc)) && Date.parse(receipt.occurred_at_utc) <= Date.now() && Date.now() - Date.parse(receipt.occurred_at_utc) <= 86_400_000, "Lifecycle receipt time is invalid, future, or stale");
  const a = receipt.assertions; exact(a, ["admission_current", "handoff_accepted", "scope_closed", "evidence_preserved", "worktree_reference_count", "custody_reference_count", "despawn_eligible"], "Lifecycle receipt assertions");
  const expected = {SPAWNER_ADMISSION: ["admission_current"], SPAWN_ADMISSION: ["admission_current"], HANDOFF_ACCEPTANCE: ["handoff_accepted"], SCOPE_CLOSEOUT: ["scope_closed"], EVIDENCE_PRESERVATION: ["evidence_preserved"], WORKTREE_RELEASE: ["worktree_reference_count"], CUSTODY_RELEASE: ["custody_reference_count"], DESPAWN_ELIGIBILITY: ["despawn_eligible"]}[receipt.receipt_kind];
  for (const field of expected) assert(field.endsWith("_count") ? a[field] === 0 : a[field] === true, `Lifecycle receipt did not prove ${field}`);
  return receipt;
}

function resolveIssuedReceipt(state, {receiptRef, expectedKind, requestId, agentId, roleId, admissionReceiptRef}) {
  assert(Object.values(RECEIPT_KIND).concat("SPAWNER_ADMISSION").includes(expectedKind), "Expected lifecycle receipt kind is invalid");
  const match = RECEIPT_REF.exec(receiptRef ?? ""); assert(match, "Lifecycle receipt reference is invalid");
  const directory = target(state.project.root, RELATIVE_RECEIPTS), issued = path.join(directory, `${match[2]}.issued.json`), consumed = path.join(directory, `${match[2]}.consumed.json`);
  assert(fs.existsSync(issued) && !fs.existsSync(consumed), "Lifecycle receipt is unknown, replayed, or already consumed", "SPAWNER_LIFECYCLE_RECEIPT_REPLAY");
  const receipt = validateReceipt(readJson(issued), state);
  assert(receipt.receipt_ref === receiptRef && receipt.receipt_kind === expectedKind && receipt.request_id === requestId && receipt.agent_id === agentId && receipt.role_id === roleId && receipt.admission_receipt_ref === admissionReceiptRef, "Lifecycle receipt scope differs from requested transition");
  return {receipt, directory, issued, consumed};
}

export function consumeSpawnerLifecycleReceipt(capability, options = {}) {
  const state = stateFor(capability), resolved = resolveIssuedReceipt(state, options);
  const {receipt, directory, issued, consumed} = resolved;
  try { fs.renameSync(issued, consumed); } catch (error) { if (error.code === "ENOENT" || error.code === "EEXIST") fail("Lifecycle receipt was consumed concurrently", "SPAWNER_LIFECYCLE_RECEIPT_REPLAY"); throw error; }
  syncDirectory(directory); const consumedReceipt = validateReceipt(readJson(consumed), state); assert(consumedReceipt.receipt_sha256 === receipt.receipt_sha256, "Consumed lifecycle receipt readback differs");
  return Object.freeze(receipt);
}

export function commitGovernedSpawnerLifecycleTransition(capability, {expectedHeadSha256, eventKind, receiptRef, requestId, agentId, roleId, admissionReceiptRef} = {}) {
  const state = stateFor(capability); assert(SHA.test(expectedHeadSha256) && RECEIPT_KIND[eventKind], "Lifecycle transition kind/head differs");
  const {lockPath, lock} = acquireLock(state.ledgerPath, "LEDGER_APPEND", state.project.root); let staged;
  try {
    const events = readEvents(state), head = events.at(-1)?.event_sha256 ?? GENESIS;
    assert(!events.some((event) => event.request_id === requestId), "Lifecycle request was already consumed", "SPAWNER_LIFECYCLE_REPLAY_CONFLICT");
    assert(head === expectedHeadSha256, "Lifecycle append compare-and-swap head is stale", "SPAWNER_LIFECYCLE_CAS_STALE");
    const {receipt, directory, issued, consumed} = resolveIssuedReceipt(state, {receiptRef, expectedKind: RECEIPT_KIND[eventKind], requestId, agentId, roleId, admissionReceiptRef});
    const previous = [...events].reverse().find((entry) => entry.agent_id === receipt.agent_id) ?? null;
    assert(previous?.event_kind === REQUIRED_PREDECESSOR[eventKind] || (previous === null && REQUIRED_PREDECESSOR[eventKind] === null), `Lifecycle transition ${eventKind} is out of order`, "SPAWNER_LIFECYCLE_TRANSITION_INVALID");
    if (previous) assert(previous.role_id === receipt.role_id && previous.admission_receipt_ref === receipt.admission_receipt_ref, "Lifecycle continuity differs");
    const custody = previous?.custody_chain_sha256 ?? canonicalDigest({project_identity_sha256: state.project.authority.project_identity_sha256, agent_id: receipt.agent_id, role_id: receipt.role_id, admission_receipt_ref: receipt.admission_receipt_ref});
    const event = {schema: "agentos.spawner_lifecycle_event.v2", version: 2, sequence: events.length, fencing_epoch: events.length + 1, attachment_generation: state.project.generation, project_identity_sha256: state.project.authority.project_identity_sha256, project_store_id: state.project.authority.project_store_id, store_id: state.project.authority.store_id, event_id: null, event_kind: eventKind, request_id: receipt.request_id, agent_id: receipt.agent_id, role_id: receipt.role_id, admission_receipt_ref: receipt.admission_receipt_ref, custody_chain_sha256: custody, receipt_ref: receipt.receipt_ref, receipt_sha256: receipt.receipt_sha256, spawner_context_sha256: state.spawnerContext.context_sha256, model_snapshot_sha256: state.spawnerContext.snapshot_sha256, model_selection_sha256: canonicalDigest(state.spawnerContext.compact_selection), prior_event_sha256: head, occurred_at_utc: new Date().toISOString(), event_sha256: null};
    event.event_id = `EVENT.${canonicalDigest({...event, event_id: null, event_sha256: null}).toUpperCase()}`; event.event_sha256 = canonicalDigest(eventBody(event)); validateEvent(event, events.length, head, state);
    staged = `${state.ledgerPath}.stage.${lock.fence}`; const fd = fs.openSync(staged, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600); try { fs.writeFileSync(fd, `${[...events, event].map(canonicalJson).join("\n")}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(staged, state.ledgerPath); staged = null; syncDirectory(path.dirname(state.ledgerPath));
    try { fs.renameSync(issued, consumed); } catch (error) { if (error.code !== "ENOENT") throw error; } syncDirectory(directory);
    const readback = readEvents(state); assert(readback.at(-1)?.event_sha256 === event.event_sha256 && fs.existsSync(consumed), "Lifecycle durable event/receipt readback differs"); return Object.freeze({status: "APPENDED", event: Object.freeze(event), head_sha256: event.event_sha256});
  } finally { if (staged) { try { fs.unlinkSync(staged); } catch {} } releaseLock(lockPath); }
}

export function lifecycleStoreGenesisHead() { return GENESIS; }
