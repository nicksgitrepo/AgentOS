#!/usr/bin/env node

/* Safe file transport for the project-memory authority and its rebuildable snapshot. */

import fs from "node:fs";
import path from "node:path";
import {
  canonicalJson,
  canonicalDigest,
  compareUtf8,
  assertPersistedRecordSafe,
} from "./content-addressing.mjs";
import {
  GENESIS_EVENT_SHA256,
  MemoryConflictError,
  bindingFrom,
  memoryRecordLogicalKey,
  replayMemoryLedger,
  validateMemoryEvent,
  validateMemoryLedger,
  validateMemorySnapshot,
} from "./project-memory.mjs";
import {requireSha} from "./map-memory-common.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isWithin(root, target) {
  return target === root || target.startsWith(`${root}${path.sep}`);
}

function resolveAuthorityRoot(authorityRoot, repositoryRoot) {
  assert(typeof authorityRoot === "string" && path.isAbsolute(authorityRoot), "authority root must be an absolute path");
  const authorityStat = fs.lstatSync(authorityRoot);
  assert(authorityStat.isDirectory() && !authorityStat.isSymbolicLink(), "authority root must be a real directory");
  const root = fs.realpathSync.native(authorityRoot);
  const repository = fs.realpathSync.native(repositoryRoot);
  assert(!isWithin(repository, root) && !isWithin(root, repository), "project-memory authority must remain separate from the repository");
  return root;
}

function resolveRelativeTarget(root, relativePath, label) {
  assert(typeof relativePath === "string" && relativePath.length > 0 && !path.isAbsolute(relativePath), `${label} must be a relative path`);
  const segments = relativePath.split(/[\\/]/u);
  assert(segments.every((segment) => segment.length > 0 && segment !== "." && segment !== ".."), `${label} contains an unsafe segment`);
  const target = path.resolve(root, relativePath);
  assert(isWithin(root, target), `${label} escapes the authority root`);
  return target;
}

function ensureSafeParents(root, target) {
  let current = root;
  const relative = path.relative(root, path.dirname(target));
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (stat !== undefined) {
      assert(stat.isDirectory() && !stat.isSymbolicLink(), "project-memory path traverses an unsafe directory");
    } else {
      fs.mkdirSync(current, {mode: 0o700});
    }
  }
}

function assertSafeParents(root, target) {
  let current = root;
  const relative = path.relative(root, path.dirname(target));
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error.code === "ENOENT") break;
      throw error;
    }
    assert(stat.isDirectory() && !stat.isSymbolicLink(), "project-memory path traverses an unsafe directory");
  }
}

function assertRegularFile(target, label) {
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  assert(stat.isFile() && !stat.isSymbolicLink(), `${label} must be a regular file`);
  return true;
}

function readJsonFile(target, label) {
  assert(assertRegularFile(target, label), `${label} is missing`);
  try {
    return JSON.parse(fs.readFileSync(target, "utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON`, {cause: error});
  }
}

function writeBufferDurably(target, bytes) {
  const descriptor = fs.openSync(target, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
  try {
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function syncDirectory(directory) {
  const flags = fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY ?? 0);
  const descriptor = fs.openSync(directory, flags);
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function removeIfPresent(target) {
  try {
    fs.unlinkSync(target);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function acquireLock(lockPath) {
  let descriptor = null;
  try {
    descriptor = fs.openSync(lockPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
    fs.writeFileSync(descriptor, Buffer.from("LOCKED\n", "utf8"));
    fs.fsyncSync(descriptor);
    return true;
  } catch (error) {
    if (error.code === "EEXIST") throw new MemoryConflictError("LEDGER_LOCKED", "project-memory ledger is already locked");
    throw error;
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
}

function readEventsAtTarget(target) {
  if (!assertRegularFile(target, "project-memory ledger")) return [];
  const content = fs.readFileSync(target, "utf8");
  if (content.length === 0) return [];
  const lines = content.split("\n");
  if (lines.at(-1) === "") lines.pop();
  assert(lines.length > 0 && lines.every((line) => line.length > 0), "project-memory ledger contains a blank line");
  try {
    return lines.map((line) => JSON.parse(line));
  } catch (error) {
    throw new Error("project-memory ledger contains invalid JSON", {cause: error});
  }
}

function findExistingIdempotent(events, event) {
  return events.find((candidate) => candidate.event_id === event.event_id || candidate.idempotency_key === event.idempotency_key) ?? null;
}

function findSemanticConflict(events, event) {
  const candidateKey = memoryRecordLogicalKey(event.record);
  for (const existing of events) {
    if (memoryRecordLogicalKey(existing.record) === candidateKey && existing.record_sha256 !== event.record_sha256) {
      return {
        conflict_key: candidateKey,
        left_record_sha256: [existing.record_sha256, event.record_sha256].sort(compareUtf8)[0],
        right_record_sha256: [existing.record_sha256, event.record_sha256].sort(compareUtf8)[1],
      };
    }
  }
  return null;
}

export function readProjectMemoryLedger({authorityRoot, relativePath = "ledgers/project-memory-events.jsonl", repositoryRoot = process.cwd(), binding = null} = {}) {
  const root = resolveAuthorityRoot(authorityRoot, repositoryRoot);
  const target = resolveRelativeTarget(root, relativePath, "project-memory ledger path");
  assertSafeParents(root, target);
  const events = readEventsAtTarget(target);
  const validation = validateMemoryLedger(events, {binding});
  return {
    relative_path: relativePath,
    events,
    event_count: validation.event_count,
    head_sha256: validation.head_sha256,
  };
}

export function reconstructProjectMemory({authorityRoot, relativePath = "ledgers/project-memory-events.jsonl", repositoryRoot = process.cwd(), binding = null} = {}) {
  const ledger = readProjectMemoryLedger({authorityRoot, relativePath, repositoryRoot, binding});
  const replay = replayMemoryLedger(ledger.events, {binding});
  return {...replay, relative_path: ledger.relative_path, events: ledger.events};
}

export function appendProjectMemoryEvent({
  authorityRoot,
  relativePath = "ledgers/project-memory-events.jsonl",
  repositoryRoot = process.cwd(),
  expectedHeadSha256,
  event,
} = {}) {
  validateMemoryEvent(event);
  requireSha(expectedHeadSha256, "project-memory append expected head");
  const root = resolveAuthorityRoot(authorityRoot, repositoryRoot);
  const target = resolveRelativeTarget(root, relativePath, "project-memory ledger path");
  ensureSafeParents(root, target);
  const lockPath = `${target}.lock`;
  acquireLock(lockPath);
  try {
    const events = readEventsAtTarget(target);
    validateMemoryLedger(events);
    const existing = findExistingIdempotent(events, event);
    if (existing !== null) {
      if (existing.event_sha256 === event.event_sha256) {
        return {status: "IDEMPOTENT_REPLAY", event: existing, head_sha256: events.at(-1)?.event_sha256 ?? GENESIS_EVENT_SHA256};
      }
      throw new MemoryConflictError("IDEMPOTENCY_CONFLICT", "project-memory idempotency key was reused with different content", {
        existing_event_sha256: existing.event_sha256,
        candidate_event_sha256: event.event_sha256,
      });
    }
    const actualHead = events.at(-1)?.event_sha256 ?? GENESIS_EVENT_SHA256;
    if (expectedHeadSha256 !== actualHead) throw new MemoryConflictError("CAS_MISMATCH", "project-memory ledger head changed", {expectedHeadSha256, actualHead});
    if (event.sequence !== events.length) throw new MemoryConflictError("SEQUENCE_MISMATCH", "project-memory event sequence does not append to the ledger", {expectedSequence: events.length, actualSequence: event.sequence});
    if (event.prior_event_sha256 !== actualHead) throw new MemoryConflictError("PRIOR_HEAD_MISMATCH", "project-memory event prior head is stale", {expectedPrior: actualHead, actualPrior: event.prior_event_sha256});
    const semanticConflict = findSemanticConflict(events, event);
    if (semanticConflict !== null) throw new MemoryConflictError("RECORD_CONFLICT", "project-memory record version conflicts with existing canonical truth", semanticConflict);
    const ledgerBinding = bindingFrom(events[0] ?? event, "project-memory append binding");
    validateMemoryLedger([...events, event], {binding: ledgerBinding});
    const line = Buffer.from(`${canonicalJson(event)}\n`, "utf8");
    const descriptor = fs.openSync(target, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
    try {
      fs.writeFileSync(descriptor, line);
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    syncDirectory(path.dirname(target));
    const readback = readEventsAtTarget(target);
    validateMemoryLedger(readback, {binding: ledgerBinding});
    assert(readback.at(-1)?.event_sha256 === event.event_sha256, "project-memory append readback mismatch");
    return {status: "APPENDED", event, head_sha256: event.event_sha256};
  } finally {
    removeIfPresent(lockPath);
  }
}

export function readProjectMemorySnapshot({authorityRoot, relativePath = "snapshots/current.json", repositoryRoot = process.cwd()} = {}) {
  const root = resolveAuthorityRoot(authorityRoot, repositoryRoot);
  const target = resolveRelativeTarget(root, relativePath, "project-memory snapshot path");
  assertSafeParents(root, target);
  if (!assertRegularFile(target, "project-memory snapshot")) return null;
  const snapshot = readJsonFile(target, "project-memory snapshot");
  return validateMemorySnapshot(snapshot);
}

export function writeProjectMemorySnapshotCompareAndSwap({
  authorityRoot,
  relativePath = "snapshots/current.json",
  repositoryRoot = process.cwd(),
  expectedSnapshotSha256 = null,
  snapshot,
} = {}) {
  validateMemorySnapshot(snapshot);
  if (expectedSnapshotSha256 !== null) requireSha(expectedSnapshotSha256, "project-memory snapshot expected head");
  const root = resolveAuthorityRoot(authorityRoot, repositoryRoot);
  const target = resolveRelativeTarget(root, relativePath, "project-memory snapshot path");
  ensureSafeParents(root, target);
  const lockPath = `${target}.lock`;
  acquireLock(lockPath);
  let temporaryPath = null;
  try {
    const existing = assertRegularFile(target, "project-memory snapshot") ? readJsonFile(target, "project-memory snapshot") : null;
    if (existing !== null) validateMemorySnapshot(existing);
    const actual = existing?.snapshot_sha256 ?? null;
    if (actual === snapshot.snapshot_sha256) return {status: "IDEMPOTENT_REPLAY", snapshot, previous_snapshot_sha256: actual};
    if (expectedSnapshotSha256 !== actual) throw new MemoryConflictError("SNAPSHOT_CAS_MISMATCH", "project-memory snapshot head changed", {expectedSnapshotSha256, actual});
    assertPersistedRecordSafe(snapshot);
    temporaryPath = `${target}.tmp-${process.pid}-${Date.now()}`;
    writeBufferDurably(temporaryPath, Buffer.from(`${canonicalJson(snapshot)}\n`, "utf8"));
    fs.renameSync(temporaryPath, target);
    syncDirectory(path.dirname(target));
    temporaryPath = null;
    const readback = readJsonFile(target, "project-memory snapshot");
    validateMemorySnapshot(readback);
    assert(readback.snapshot_sha256 === snapshot.snapshot_sha256, "project-memory snapshot readback mismatch");
    return {status: "UPDATED", snapshot: readback, previous_snapshot_sha256: actual};
  } finally {
    if (temporaryPath !== null) removeIfPresent(temporaryPath);
    removeIfPresent(lockPath);
  }
}

export const PROJECT_MEMORY_STORE_API = Object.freeze({
  readProjectMemoryLedger,
  reconstructProjectMemory,
  appendProjectMemoryEvent,
  readProjectMemorySnapshot,
  writeProjectMemorySnapshotCompareAndSwap,
});
