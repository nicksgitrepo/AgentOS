/* Filesystem authority, leases, fencing, journal commits, and recovery. */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {canonicalDigest, canonicalJson, compareUtf8} from "./content-addressing.mjs";
import {
  GENESIS_EVENT_HEAD_SHA256,
  PERSISTENT_ROLE_IDS,
  RUNTIME_ROLE,
  buildEvent,
  buildTransaction,
  compilePersistentRoleRecord,
  createInitialState,
  defaultGovernanceDigest,
  ensureIdempotencyKey,
  persistentRolesDigest,
  validateEvent,
  validateIntentRegulatorCheckpoint,
  validateLeaseRecord,
  validatePersistentIntentRuntimeState,
  validatePersistentRoleRecord,
  validateTransaction,
} from "./persistent-intent-runtime-contract.mjs";
import {
  assert,
  clone,
  digestWithout,
  exactKeys,
  requireIdentifier,
  requireOpaqueReference,
  requireRecord,
  requireString,
  requireUtc,
} from "./persistent-intent-runtime-primitives.mjs";

const EVENT_FILE = /^(\d{12})\.json$/u;
const TRANSACTION_FILE = /^TRANSACTION_REF_[0-9a-f]{64}\.json$/u;
const LOCK_FILE = "authority.lock";
const LOCK_DURATION_MS = 10_000;
const LOCK_RETRIES = 3;

function validateEventFileName(name, expectedSequence) {
  const match = EVENT_FILE.exec(name);
  assert(match !== null, `unexpected Runtime event file: ${name}`, "RUNTIME_STATE_CORRUPT");
  assert(Number(match[1]) === expectedSequence, `Runtime event sequence does not match file: ${name}`, "RUNTIME_STATE_CORRUPT");
}

function validateTransactionFileName(name) {
  assert(TRANSACTION_FILE.test(name), `unexpected Runtime transaction file: ${name}`, "RUNTIME_STATE_CORRUPT");
}

function canonicalRoot(root, label) {
  requireString(root, label);
  const resolved = fs.realpathSync.native(path.resolve(root));
  const stat = fs.lstatSync(resolved);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), `${label} must be a real directory`);
  return resolved;
}

function ensureDirectory(root) {
  requireString(root, "authority root");
  assert(path.isAbsolute(root), "authority root must be absolute", "RUNTIME_STORAGE_BOUNDARY");
  if (!fs.existsSync(root)) fs.mkdirSync(root, {recursive: true, mode: 0o700});
  const stat = fs.lstatSync(root);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), "authority root must be a real directory");
  return fs.realpathSync.native(root);
}

function isWithin(root, target) {
  return target === root || target.startsWith(`${root}${path.sep}`);
}

function assertAuthorityRootOutsideRepository(authorityRoot, repositoryRoot) {
  if (repositoryRoot === null) return;
  const repository = canonicalRoot(repositoryRoot, "repository root");
  assert(!isWithin(repository, authorityRoot) && !isWithin(authorityRoot, repository), "authority root must be outside the repository", "RUNTIME_STORAGE_BOUNDARY");
}

function safeTarget(root, relativePath) {
  requireString(relativePath, "authority relative path");
  assert(!path.isAbsolute(relativePath) && !relativePath.includes("\\"), "authority path must be relative and portable", "RUNTIME_STORAGE_BOUNDARY");
  const target = path.resolve(root, relativePath);
  assert(isWithin(root, target), "authority path escapes authority root", "RUNTIME_STORAGE_BOUNDARY");
  for (let cursor = target; cursor !== root; cursor = path.dirname(cursor)) {
    if (fs.existsSync(cursor)) {
      const stat = fs.lstatSync(cursor);
      assert(!stat.isSymbolicLink(), "authority path may not contain symlinks", "RUNTIME_STORAGE_BOUNDARY");
    }
  }
  return target;
}

function readJson(root, relativePath) {
  const target = safeTarget(root, relativePath);
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  assert(stat.isFile() && !stat.isSymbolicLink(), `authority record is not a regular file: ${relativePath}`, "RUNTIME_STATE_CORRUPT");
  try {
    return JSON.parse(fs.readFileSync(target, "utf8"));
  } catch (error) {
    const wrapped = new Error(`authority record JSON is invalid: ${relativePath}`);
    wrapped.code = "RUNTIME_STATE_CORRUPT";
    wrapped.cause = error;
    throw wrapped;
  }
}

function fsyncDirectory(directory) {
  try {
    const descriptor = fs.openSync(directory, fs.constants.O_RDONLY);
    try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  } catch (error) {
    if (!( ["EINVAL", "ENOTSUP", "EBADF"].includes(error.code))) throw error;
  }
}

function atomicWriteJson(root, relativePath, value, {mustNotExist = false} = {}) {
  const target = safeTarget(root, relativePath);
  fs.mkdirSync(path.dirname(target), {recursive: true, mode: 0o700});
  if (fs.existsSync(target)) {
    const stat = fs.lstatSync(target);
    assert(!stat.isSymbolicLink(), `authority target is a symlink: ${relativePath}`, "RUNTIME_STORAGE_BOUNDARY");
    if (mustNotExist) {
      const error = new Error(`authority record already exists: ${relativePath}`);
      error.code = "RUNTIME_RECORD_EXISTS";
      throw error;
    }
  }
  const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.stage`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
    fs.writeFileSync(descriptor, `${canonicalJson(value)}\n`, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, target);
    fsyncDirectory(path.dirname(target));
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function removeFileIfPresent(root, relativePath) {
  const target = safeTarget(root, relativePath);
  if (!fs.existsSync(target)) return;
  const stat = fs.lstatSync(target);
  assert(stat.isFile() && !stat.isSymbolicLink(), `authority file is not removable: ${relativePath}`, "RUNTIME_STORAGE_BOUNDARY");
  fs.unlinkSync(target);
  fsyncDirectory(path.dirname(target));
}

function lockMetadata(runtimeRef, expiresAtUtc) {
  return {
    schema: "agentos.intent_regulator_runtime_lock.v1",
    version: 1,
    runtime_ref: runtimeRef,
    expires_at_utc: expiresAtUtc,
  };
}

function validateLockMetadata(value) {
  exactKeys(value, ["schema", "version", "runtime_ref", "expires_at_utc"], "Runtime authority lock");
  assert(value.schema === "agentos.intent_regulator_runtime_lock.v1" && value.version === 1, "Runtime authority lock identity is invalid", "RUNTIME_LOCK_CORRUPT");
  assert(value.runtime_ref === "LOCK_INTERNAL", "Runtime authority lock owner is invalid", "RUNTIME_LOCK_CORRUPT");
  requireUtc(value.expires_at_utc, "Runtime authority lock expiry");
  return value;
}

function withAuthorityLock(root, callback, {nowMs = Date.now()} = {}) {
  const lockPath = safeTarget(root, LOCK_FILE);
  let descriptor;
  for (let attempt = 0; attempt < LOCK_RETRIES; attempt += 1) {
    try {
      descriptor = fs.openSync(lockPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let stale = false;
      try {
        const existing = readJson(root, LOCK_FILE);
        if (existing === null) {
          stale = true;
        } else {
          try {
            validateLockMetadata(existing);
          } catch (validationError) {
            const wrapped = new Error("Runtime authority lock is corrupt");
            wrapped.code = "RUNTIME_LOCK_CORRUPT";
            wrapped.cause = validationError;
            throw wrapped;
          }
          stale = Date.parse(existing.expires_at_utc) <= nowMs;
        }
      } catch (readError) {
        if (readError.code === "RUNTIME_STATE_CORRUPT") {
          const wrapped = new Error("Runtime authority lock is corrupt");
          wrapped.code = "RUNTIME_LOCK_CORRUPT";
          wrapped.cause = readError;
          throw wrapped;
        }
        throw readError;
      }
      if (!stale) {
        const held = new Error("Runtime authority lock is held");
        held.code = "RUNTIME_LOCK_HELD";
        throw held;
      }
      removeFileIfPresent(root, LOCK_FILE);
    }
  }
  if (descriptor === undefined) {
    const error = new Error("Runtime authority lock could not be acquired");
    error.code = "RUNTIME_LOCK_HELD";
    throw error;
  }
  const lockExpires = new Date(Date.now() + LOCK_DURATION_MS).toISOString();
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(lockMetadata("LOCK_INTERNAL", lockExpires))}\n`, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    return callback();
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    removeFileIfPresent(root, LOCK_FILE);
  }
}

function leaseIsActive(lease, nowUtc) {
  return lease !== null && lease.status === "ACTIVE" && Date.parse(lease.expires_at_utc) > Date.parse(nowUtc);
}

function buildLease({runtimeRef, leaseId, fencingEpoch, acquiredAtUtc, expiresAtUtc}) {
  const lease = {
    schema: "agentos.intent_regulator_runtime_lease.v1",
    version: 1,
    role: RUNTIME_ROLE,
    status: "ACTIVE",
    runtime_ref: runtimeRef,
    lease_id: leaseId,
    fencing_epoch: fencingEpoch,
    acquired_at_utc: acquiredAtUtc,
    renewed_at_utc: acquiredAtUtc,
    expires_at_utc: expiresAtUtc,
    released_at_utc: null,
    lease_sha256: null,
  };
  lease.lease_sha256 = digestWithout(lease, "lease_sha256");
  return validateLeaseRecord(lease);
}

function leaseToken(lease) {
  return Object.freeze({runtime_ref: lease.runtime_ref, lease_id: lease.lease_id, fencing_epoch: lease.fencing_epoch});
}

function makeLeaseId(runtimeRef, fencingEpoch, acquiredAtUtc) {
  return `LEASE_REF_${canonicalDigest({runtime_ref: runtimeRef, fencing_epoch: fencingEpoch, acquired_at_utc: acquiredAtUtc})}`;
}

function acquireRuntimeLease(root, runtimeRef, {nowUtc, leaseDurationSeconds}) {
  return withAuthorityLock(root, () => {
    const current = readJson(root, "lease.json");
    if (current !== null) validateLeaseRecord(current);
    if (leaseIsActive(current, nowUtc)) {
      const error = new Error("Runtime authority lease is held by another active Runtime");
      error.code = "RUNTIME_LEASE_HELD";
      throw error;
    }
    const epoch = current === null ? 1 : current.fencing_epoch + 1;
    const expiresAtUtc = new Date(Date.parse(nowUtc) + leaseDurationSeconds * 1000).toISOString();
    const lease = buildLease({
      runtimeRef,
      leaseId: makeLeaseId(runtimeRef, epoch, nowUtc),
      fencingEpoch: epoch,
      acquiredAtUtc: nowUtc,
      expiresAtUtc,
    });
    atomicWriteJson(root, "lease.json", lease);
    const readback = readJson(root, "lease.json");
    validateLeaseRecord(readback);
    assert(readback.lease_sha256 === lease.lease_sha256, "Runtime lease readback differs", "RUNTIME_STATE_CORRUPT");
    return {lease, token: leaseToken(lease)};
  });
}

export function assertRuntimeLease(root, token, nowUtc) {
  requireRecord(token, "Runtime lease token");
  requireOpaqueReference(token.runtime_ref, "Runtime lease token runtime reference");
  requireOpaqueReference(token.lease_id, "Runtime lease token ID");
  assert(Number.isSafeInteger(token.fencing_epoch) && token.fencing_epoch >= 1, "Runtime lease token fencing epoch is invalid");
  const current = readJson(root, "lease.json");
  if (current === null) throw new Error("Runtime authority lease is missing");
  validateLeaseRecord(current);
  assert(current.status === "ACTIVE" && current.runtime_ref === token.runtime_ref && current.lease_id === token.lease_id && current.fencing_epoch === token.fencing_epoch,
    "Runtime lease token is fenced", "RUNTIME_LEASE_FENCED");
  assert(Date.parse(current.expires_at_utc) > Date.parse(nowUtc), "Runtime lease has expired", "RUNTIME_LEASE_EXPIRED");
  return current;
}

function releaseRuntimeLease(root, token, nowUtc) {
  return withAuthorityLock(root, () => {
    const current = assertRuntimeLease(root, token, nowUtc);
    const released = {...current, status: "RELEASED", released_at_utc: nowUtc, lease_sha256: null};
    released.lease_sha256 = digestWithout(released, "lease_sha256");
    atomicWriteJson(root, "lease.json", validateLeaseRecord(released));
    return released;
  });
}

function renewRuntimeLease(root, token, {nowUtc, leaseDurationSeconds}) {
  return withAuthorityLock(root, () => {
    const current = assertRuntimeLease(root, token, nowUtc);
    const renewed = {
      ...current,
      renewed_at_utc: nowUtc,
      expires_at_utc: new Date(Date.parse(nowUtc) + leaseDurationSeconds * 1000).toISOString(),
      lease_sha256: null,
    };
    renewed.lease_sha256 = digestWithout(renewed, "lease_sha256");
    atomicWriteJson(root, "lease.json", validateLeaseRecord(renewed));
    return {lease: renewed, token: leaseToken(renewed)};
  });
}

function eventPath(sequence) {
  return `events/${String(sequence).padStart(12, "0")}.json`;
}

function transactionPath(transactionId) {
  return `transactions/${transactionId}.json`;
}

function listFiles(root, relativeDirectory) {
  const directory = safeTarget(root, relativeDirectory);
  if (!fs.existsSync(directory)) return [];
  const stat = fs.lstatSync(directory);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), `authority directory is invalid: ${relativeDirectory}`, "RUNTIME_STATE_CORRUPT");
  return fs.readdirSync(directory).sort(compareUtf8);
}

export function readRuntimeState(root) {
  const state = readJson(root, "state.json");
  if (state === null) return null;
  return validatePersistentIntentRuntimeState(state);
}

function readCheckpoint(root, state) {
  if (state.checkpoint_sha256 === null) {
    assert(readJson(root, "checkpoint.json") === null, "checkpoint record exists without a Runtime state pointer", "RUNTIME_STATE_CORRUPT");
    return null;
  }
  const checkpoint = readJson(root, "checkpoint.json");
  assert(checkpoint !== null, "checkpoint pointer has no checkpoint record", "RUNTIME_STATE_CORRUPT");
  validateIntentRegulatorCheckpoint(checkpoint);
  assert(checkpoint.checkpoint_sha256 === state.checkpoint_sha256, "checkpoint pointer differs from state", "RUNTIME_STATE_CORRUPT");
  return checkpoint;
}

function rolePath(roleId) {
  assert(PERSISTENT_ROLE_IDS.includes(roleId), "persistent role ID is invalid");
  return `roles/${roleId}.json`;
}

function readPersistentRoles(root) {
  const names = listFiles(root, "roles");
  if (names.length === 0) return null;
  const expected = PERSISTENT_ROLE_IDS.map((roleId) => `${roleId}.json`).sort(compareUtf8);
  assert(JSON.stringify(names) === JSON.stringify(expected), "persistent role record set is incomplete or contains an unknown role", "RUNTIME_STATE_CORRUPT");
  const roles = PERSISTENT_ROLE_IDS.map((roleId) => {
    const role = readJson(root, rolePath(roleId));
    return validatePersistentRoleRecord(role);
  });
  return roles.sort((left, right) => compareUtf8(left.role_id, right.role_id));
}

function validateRoleSetForState(state, roles) {
  assert(Array.isArray(roles) && roles.length === PERSISTENT_ROLE_IDS.length, "persistent role record set is incomplete", "RUNTIME_STATE_CORRUPT");
  for (const role of roles) {
    validatePersistentRoleRecord(role);
    assert(role.project_id === state.project_id && role.environment_id === state.environment_id, "persistent role binding differs from Runtime state", "RUNTIME_BINDING_MISMATCH");
    assert(role.source_commit === state.source_commit && role.source_tree === state.source_tree, "persistent role source differs from Runtime state", "RUNTIME_BINDING_MISMATCH");
  }
  assert(persistentRolesDigest(roles) === state.persistent_roles_sha256, "persistent role set digest differs from Runtime state", "RUNTIME_STATE_CORRUPT");
  return roles;
}

function readEvent(root, sequence) {
  const event = readJson(root, eventPath(sequence));
  assert(event !== null, `Runtime event ${sequence} is missing`, "RUNTIME_STATE_CORRUPT");
  validateEvent(event);
  validateEventFileName(`${String(sequence).padStart(12, "0")}.json`, sequence);
  return event;
}

function readPendingTransactions(root) {
  const names = listFiles(root, "transactions");
  const transactions = [];
  for (const name of names) {
    validateTransactionFileName(name);
    const transaction = readJson(root, `transactions/${name}`);
    validateTransaction(transaction);
    transactions.push(transaction);
  }
  return transactions;
}

function validateEventHistory(root, state) {
  const names = listFiles(root, "events");
  for (const name of names) {
    const match = EVENT_FILE.exec(name);
    assert(match !== null, `unexpected Runtime event file: ${name}`, "RUNTIME_STATE_CORRUPT");
    assert(Number(match[1]) <= state.event_cursor, `Runtime event exists beyond committed cursor: ${name}`, "RUNTIME_STATE_CORRUPT");
  }
  if (state.event_cursor === 0) {
    assert(state.event_ledger_head_sha256 === GENESIS_EVENT_HEAD_SHA256, "empty Runtime journal has a non-genesis head", "RUNTIME_STATE_CORRUPT");
    assert(names.length === 0, "empty Runtime state has event files", "RUNTIME_STATE_CORRUPT");
    return true;
  }
  assert(names.length === state.event_cursor, "Runtime event file count does not match committed cursor", "RUNTIME_STATE_CORRUPT");
  let parentState = state.genesis_state_sha256;
  let parentHead = GENESIS_EVENT_HEAD_SHA256;
  for (let sequence = 1; sequence <= state.event_cursor; sequence += 1) {
    const event = readEvent(root, sequence);
    assert(event.parent_state_sha256 === parentState, `Runtime event ${sequence} parent state is broken`, "RUNTIME_STATE_CORRUPT");
    assert(event.parent_event_ledger_head_sha256 === parentHead, `Runtime event ${sequence} parent head is broken`, "RUNTIME_STATE_CORRUPT");
    parentState = event.next_state_sha256;
    parentHead = event.event_sha256;
  }
  assert(parentState === state.state_sha256, "Runtime state does not match event chain", "RUNTIME_STATE_CORRUPT");
  assert(parentHead === state.event_ledger_head_sha256, "Runtime event head does not match state", "RUNTIME_STATE_CORRUPT");
  return true;
}

function findEventByIdempotency(root, idempotencyKey) {
  const names = listFiles(root, "events");
  for (const name of names) {
    const match = EVENT_FILE.exec(name);
    assert(match !== null, `unexpected Runtime event file: ${name}`, "RUNTIME_STATE_CORRUPT");
    const event = readJson(root, `events/${name}`);
    validateEvent(event);
    if (event.idempotency_key === idempotencyKey) return event;
  }
  return null;
}

function markTransactionCommitted(root, transaction, committedAtUtc) {
  const committed = {...transaction, status: "COMMITTED", committed_at_utc: committedAtUtc, transaction_sha256: null};
  committed.transaction_sha256 = digestWithout(committed, "transaction_sha256");
  atomicWriteJson(root, transactionPath(transaction.transaction_id), validateTransaction(committed));
  return committed;
}

function maybeInjectFault(faultInjector, stage) {
  if (typeof faultInjector !== "function") return;
  faultInjector(stage);
}

function writeOrVerifyEvent(root, event) {
  const relative = eventPath(event.sequence);
  const existing = readJson(root, relative);
  if (existing !== null) {
    validateEvent(existing);
    assert(existing.event_sha256 === event.event_sha256, `Runtime event ${event.sequence} differs during recovery`, "RUNTIME_STATE_CORRUPT");
    return existing;
  }
  atomicWriteJson(root, relative, event, {mustNotExist: true});
  return event;
}

function writeOrVerifyCheckpoint(root, checkpoint, expectedCheckpointSha256 = null) {
  if (checkpoint === null) {
    const existing = readJson(root, "checkpoint.json");
    if (expectedCheckpointSha256 === null) {
      assert(existing === null, "checkpoint record exists without an expected Runtime pointer", "RUNTIME_STATE_CORRUPT");
      return null;
    }
    assert(existing !== null, "checkpoint pointer has no checkpoint record", "RUNTIME_STATE_CORRUPT");
    validateIntentRegulatorCheckpoint(existing);
    assert(existing.checkpoint_sha256 === expectedCheckpointSha256,
      "checkpoint record differs before Runtime pointer removal", "RUNTIME_STATE_CORRUPT");
    // A null next checkpoint means that this transaction does not replace the
    // current checkpoint. Preserve the record while the state pointer remains
    // bound to it; only a checkpoint-bearing transaction may advance it.
    return existing;
  }
  const existing = readJson(root, "checkpoint.json");
  if (existing !== null) {
    validateIntentRegulatorCheckpoint(existing);
    if (existing.checkpoint_sha256 === checkpoint.checkpoint_sha256) return existing;
    assert(existing.checkpoint_sha256 === expectedCheckpointSha256, "checkpoint differs during recovery", "RUNTIME_STATE_CORRUPT");
    atomicWriteJson(root, "checkpoint.json", checkpoint);
    return checkpoint;
  }
  assert(expectedCheckpointSha256 === null, "checkpoint is missing despite a persisted checkpoint pointer", "RUNTIME_STATE_CORRUPT");
  atomicWriteJson(root, "checkpoint.json", checkpoint, {mustNotExist: true});
  return checkpoint;
}

function writeOrVerifyState(root, current, nextState) {
  const existing = readRuntimeState(root);
  assert(existing !== null && existing.state_sha256 === current.state_sha256, "Runtime state compare-and-swap parent is stale", "RUNTIME_STATE_STALE");
  atomicWriteJson(root, "state.json", nextState);
  const readback = readRuntimeState(root);
  assert(readback.state_sha256 === nextState.state_sha256 && readback.event_ledger_head_sha256 === nextState.event_ledger_head_sha256,
    "Runtime state readback differs", "RUNTIME_STATE_CORRUPT");
  return readback;
}

function recoverTransactions(root, {nowUtc, leaseToken: token, faultInjector = null} = {}) {
  const state = readRuntimeState(root);
  assert(state !== null, "Runtime state is required before transaction recovery", "RUNTIME_STATE_CORRUPT");
  const transactions = readPendingTransactions(root);
  const prepared = transactions.filter((transaction) => transaction.status === "PREPARED");
  assert(prepared.length <= 1, "multiple prepared Runtime transactions require manual reconciliation", "RUNTIME_RECOVERY_BLOCKED");
  if (prepared.length === 0) {
    validateEventHistory(root, state);
    return {state, checkpoint: readCheckpoint(root, state), recovered: false};
  }
  const transaction = prepared[0];
  assertRuntimeLease(root, token, nowUtc);
  const current = readRuntimeState(root);
  const alreadyApplied = current.state_sha256 === transaction.next_state.state_sha256 && current.event_ledger_head_sha256 === transaction.event.event_sha256;
  if (alreadyApplied) {
    assert(transaction.event.sequence === current.event_cursor, "recovered Runtime event sequence differs from state", "RUNTIME_RECOVERY_BLOCKED");
    assert(transaction.next_state.event_cursor === current.event_cursor, "recovered Runtime state cursor differs from state", "RUNTIME_RECOVERY_BLOCKED");
    const expectedParentState = transaction.event.sequence === 1 ? transaction.next_state.genesis_state_sha256 : transaction.expected_current_state_sha256;
    assert(transaction.event.parent_state_sha256 === expectedParentState,
      "recovered Runtime transaction parent state is broken", "RUNTIME_RECOVERY_BLOCKED");
    assert(transaction.event.parent_event_ledger_head_sha256 === transaction.expected_event_head_sha256,
      "recovered Runtime transaction parent event head is broken", "RUNTIME_RECOVERY_BLOCKED");
    writeOrVerifyEvent(root, transaction.event);
    writeOrVerifyCheckpoint(root, transaction.next_checkpoint, transaction.expected_checkpoint_sha256);
    markTransactionCommitted(root, transaction, nowUtc);
    validateEventHistory(root, current);
    return {state: current, checkpoint: readCheckpoint(root, current), recovered: true};
  }
  assert(transaction.event.sequence === current.event_cursor + 1, "prepared Runtime transaction sequence is not the next event", "RUNTIME_RECOVERY_BLOCKED");
  assert(transaction.next_state.event_cursor === current.event_cursor + 1, "prepared Runtime transaction state cursor is not the next event", "RUNTIME_RECOVERY_BLOCKED");
  assert(transaction.event.parent_state_sha256 === current.state_sha256 || (current.event_cursor === 0 && transaction.event.parent_state_sha256 === current.genesis_state_sha256),
    "prepared Runtime transaction parent state is broken", "RUNTIME_RECOVERY_BLOCKED");
  assert(transaction.event.parent_event_ledger_head_sha256 === current.event_ledger_head_sha256,
    "prepared Runtime transaction parent event head is broken", "RUNTIME_RECOVERY_BLOCKED");
  assert(current.state_sha256 === transaction.expected_current_state_sha256 && current.event_ledger_head_sha256 === transaction.expected_event_head_sha256,
    "prepared Runtime transaction has an unexpected parent state", "RUNTIME_RECOVERY_BLOCKED");
  writeOrVerifyEvent(root, transaction.event);
  maybeInjectFault(faultInjector, "EVENT_RECOVERED");
  writeOrVerifyCheckpoint(root, transaction.next_checkpoint, transaction.expected_checkpoint_sha256);
  maybeInjectFault(faultInjector, "CHECKPOINT_RECOVERED");
  const nextState = writeOrVerifyState(root, current, transaction.next_state);
  maybeInjectFault(faultInjector, "STATE_RECOVERED");
  markTransactionCommitted(root, transaction, nowUtc);
  validateEventHistory(root, nextState);
  return {state: nextState, checkpoint: readCheckpoint(root, nextState), recovered: true};
}

function ensureInitialStore(root, {snapshot, environmentId, reviewIntervalMinutes, governanceDigest = defaultGovernanceDigest(), createdAtUtc}) {
  const state = readRuntimeState(root);
  const existingRoles = readPersistentRoles(root);
  if (state !== null) {
    assert(existingRoles !== null, "persistent Runtime state has no persistent role records", "RUNTIME_STATE_CORRUPT");
    validateRoleSetForState(state, existingRoles);
    return {state, roles: existingRoles};
  }
  const eventNames = listFiles(root, "events");
  const transactionNames = listFiles(root, "transactions");
  assert(eventNames.length === 0 && transactionNames.length === 0 && existingRoles === null, "Runtime state is missing while durable records exist", "RUNTIME_STATE_CORRUPT");
  const roles = PERSISTENT_ROLE_IDS.map((roleId) => compilePersistentRoleRecord({
    roleId,
    projectId: snapshot.project_id,
    environmentId,
    sourceCommit: snapshot.source_commit,
    sourceTree: snapshot.source_tree,
    governanceDigest,
    createdAtUtc,
  }));
  const roleSetDigest = persistentRolesDigest(roles);
  for (const role of roles) atomicWriteJson(root, rolePath(role.role_id), role, {mustNotExist: true});
  const initial = createInitialState({snapshot, environmentId, reviewIntervalMinutes, persistentRolesSha256: roleSetDigest, createdAtUtc});
  atomicWriteJson(root, "state.json", initial, {mustNotExist: true});
  const readback = readRuntimeState(root);
  assert(readback.state_sha256 === initial.state_sha256, "initial Runtime state readback differs", "RUNTIME_STATE_CORRUPT");
  return {state: readback, roles: validateRoleSetForState(readback, readPersistentRoles(root))};
}

export function openRuntimeStorage({authorityRoot, repositoryRoot, runtimeRef, snapshot, environmentId, governanceDigest = defaultGovernanceDigest(), reviewIntervalMinutes, nowUtc, leaseDurationSeconds, faultInjector = null}) {
  const root = ensureDirectory(authorityRoot);
  assertAuthorityRootOutsideRepository(root, repositoryRoot);
  const acquired = acquireRuntimeLease(root, runtimeRef, {nowUtc, leaseDurationSeconds});
  try {
    const initialized = withAuthorityLock(root, () => ensureInitialStore(root, {snapshot, environmentId, governanceDigest, reviewIntervalMinutes, createdAtUtc: nowUtc}));
    const current = initialized.state;
    if (current.project_id !== snapshot.project_id || current.environment_id !== environmentId || current.campaign_id !== snapshot.campaign_id || current.campaign_version !== snapshot.campaign_version || current.goal_id !== snapshot.goal_id || current.goal_sha256 !== snapshot.goal_sha256 || current.source_commit !== snapshot.source_commit || current.source_tree !== snapshot.source_tree) {
      throw Object.assign(new Error("Runtime startup binding differs from persisted state"), {code: "RUNTIME_BINDING_MISMATCH"});
    }
    const recovered = withAuthorityLock(root, () => recoverTransactions(root, {nowUtc, leaseToken: acquired.token, faultInjector}));
    validateEventHistory(root, recovered.state);
    return {
      root,
      lease: acquired.lease,
      token: acquired.token,
      roles: initialized.roles,
      state: recovered.state,
      checkpoint: recovered.checkpoint,
    };
  } catch (error) {
    try { releaseRuntimeLease(root, acquired.token, nowUtc); } catch { /* preserve the original startup failure */ }
    throw error;
  }
}

export function readRuntimeCheckpoint(root, state) {
  return readCheckpoint(root, state);
}

export function readRuntimeRoles(root) {
  return readPersistentRoles(root);
}

export function readRuntimeEvents(root, state) {
  validateEventHistory(root, state);
  return Array.from({length: state.event_cursor}, (_, index) => clone(readEvent(root, index + 1)));
}

export function resumeRuntimeStorage({root, token, nowUtc, faultInjector = null}) {
  const recovered = withAuthorityLock(root, () => recoverTransactions(root, {nowUtc, leaseToken: token, faultInjector}));
  return recovered;
}

export function renewRuntimeStorage({root, token, nowUtc, leaseDurationSeconds}) {
  return renewRuntimeLease(root, token, {nowUtc, leaseDurationSeconds});
}

export function releaseRuntimeStorage({root, token, nowUtc}) {
  return releaseRuntimeLease(root, token, nowUtc);
}

export function commitRuntimeTransaction({root, token, expectedStateSha256, eventType, actorRole, payload, idempotencyKey, nextState, nextCheckpoint = null, nowUtc, faultInjector = null}) {
  assertRuntimeLease(root, token, nowUtc);
  ensureIdempotencyKey(idempotencyKey);
  if (nextCheckpoint !== null) validateIntentRegulatorCheckpoint(nextCheckpoint);
  return withAuthorityLock(root, () => {
    assertRuntimeLease(root, token, nowUtc);
    const prepared = readPendingTransactions(root).filter((transaction) => transaction.status === "PREPARED");
    assert(prepared.length === 0, "Runtime has a prepared transaction requiring explicit recovery", "RUNTIME_RECOVERY_REQUIRED");
    const current = readRuntimeState(root);
    assert(current !== null, "Runtime state is missing", "RUNTIME_STATE_CORRUPT");
    const existing = findEventByIdempotency(root, idempotencyKey);
    if (existing !== null) {
      assert(existing.event_type === eventType && existing.payload_sha256 === canonicalDigest(payload), "Runtime idempotency key was reused with different content", "RUNTIME_IDEMPOTENCY_CONFLICT");
      validateEventHistory(root, current);
      return {reused: true, event: existing, state: clone(current), checkpoint: clone(readCheckpoint(root, current))};
    }
    assert(current.state_sha256 === expectedStateSha256, "Runtime in-memory state is stale", "RUNTIME_STATE_STALE");
    const finalizedState = {...nextState, event_cursor: current.event_cursor + 1, event_ledger_head_sha256: current.event_ledger_head_sha256, state_sha256: null};
    finalizedState.state_sha256 = (awaitableStateDigest(finalizedState));
    const event = buildEvent({current, nextState: finalizedState, eventType, actorRole, fencingEpoch: token.fencing_epoch, idempotencyKey, payload, occurredAtUtc: nowUtc});
    finalizedState.event_ledger_head_sha256 = event.event_sha256;
    const transaction = buildTransaction({current, nextState: finalizedState, nextCheckpoint, event, idempotencyKey, preparedAtUtc: nowUtc});
    atomicWriteJson(root, transactionPath(transaction.transaction_id), transaction, {mustNotExist: true});
    maybeInjectFault(faultInjector, "TRANSACTION_PREPARED");
    writeOrVerifyEvent(root, event);
    maybeInjectFault(faultInjector, "EVENT_WRITTEN");
    writeOrVerifyCheckpoint(root, nextCheckpoint, current.checkpoint_sha256);
    maybeInjectFault(faultInjector, "CHECKPOINT_WRITTEN");
    const state = writeOrVerifyState(root, current, finalizedState);
    maybeInjectFault(faultInjector, "STATE_WRITTEN");
    markTransactionCommitted(root, transaction, nowUtc);
    validateEventHistory(root, state);
    return {reused: false, event, state: clone(state), checkpoint: clone(readCheckpoint(root, state))};
  });
}

function awaitableStateDigest(state) {
  const body = clone(state);
  body.state_sha256 = null;
  body.event_ledger_head_sha256 = null;
  return canonicalDigest(body);
}

export function inspectRuntimeStorage({authorityRoot, repositoryRoot = process.cwd()} = {}) {
  const root = canonicalRoot(authorityRoot, "authority root");
  assertAuthorityRootOutsideRepository(root, repositoryRoot);
  const state = readRuntimeState(root);
  if (state === null) return {state: null, roles: readPersistentRoles(root), checkpoint: null, lease: readJson(root, "lease.json"), events: []};
  const roles = validateRoleSetForState(state, readPersistentRoles(root));
  validateEventHistory(root, state);
  const checkpoint = readCheckpoint(root, state);
  const lease = readJson(root, "lease.json");
  if (lease !== null) validateLeaseRecord(lease);
  return {
    state: clone(state),
    roles: clone(roles),
    checkpoint: clone(checkpoint),
    lease: clone(lease),
    events: readRuntimeEvents(root, state),
  };
}
