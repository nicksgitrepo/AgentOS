/*
 * Project-agnostic durable queue for Agent Spawner defect intakes.
 *
 * The Spawner compiles individual defects; this contract preserves their
 * ordering, identity, and custody status across process restarts.  Queue
 * writes are control-plane-only and never spawn a seed or working agent.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {validateAgentSpawnerDefectIntake} from "./agent-spawner-defect-intake.mjs";

export const AGENT_SPAWNER_DEFECT_QUEUE_SCHEMA = "agentos.agent_spawner_defect_queue.v1";
export const AGENT_SPAWNER_DEFECT_QUEUE_VERSION = 1;
export const AGENT_SPAWNER_DEFECT_INTAKE_SCHEMA = "agentos.agent_spawner_defect_intake.v1";

const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Z][A-Z0-9._:-]{0,191}$/u;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, keys, label) {
  assert(isRecord(value), `${label} must be an object`);
  const actual = Object.keys(value).sort(compareUtf8);
  const expected = [...keys].sort(compareUtf8);
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} fields mismatch`);
}

function requireIdentifier(value, label) {
  assert(typeof value === "string" && IDENTIFIER.test(value), `${label} must be a stable identifier`);
}

function requireSha(value, label, {nullable = false} = {}) {
  if (nullable && value === null) return;
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function requireRecordPath(value, label) {
  assert(typeof value === "string" && value.length > 0, `${label} must be a non-empty relative path`);
  assert(!path.isAbsolute(value) && !value.includes("\\"), `${label} must be a relative POSIX path`);
  assert(!value.split("/").includes(".."), `${label} may not contain parent traversal`);
}

function body(value) {
  const copy = structuredClone(value);
  copy.queue_sha256 = null;
  return copy;
}

function orderedEntries(entries) {
  assert(Array.isArray(entries), "Spawner defect queue entries must be an array");
  const ordered = [...entries].sort((left, right) => compareUtf8(left.defect_id, right.defect_id));
  ordered.forEach((entry) => validateAgentSpawnerDefectIntake(entry));
  assert(new Set(ordered.map((entry) => entry.defect_id)).size === ordered.length, "Spawner defect queue contains duplicate defect IDs");
  return ordered;
}

export function validateAgentSpawnerDefectQueue(queue) {
  exactKeys(queue, ["schema", "version", "queue_id", "intake_schema", "entries", "entry_count", "queue_sha256"], "Spawner defect queue");
  assert(queue.schema === AGENT_SPAWNER_DEFECT_QUEUE_SCHEMA && queue.version === AGENT_SPAWNER_DEFECT_QUEUE_VERSION, "Spawner defect queue identity is invalid");
  requireIdentifier(queue.queue_id, "Spawner defect queue ID");
  assert(queue.intake_schema === AGENT_SPAWNER_DEFECT_INTAKE_SCHEMA, "Spawner defect queue intake schema is invalid");
  const ordered = orderedEntries(queue.entries);
  assert(JSON.stringify(queue.entries) === JSON.stringify(ordered), "Spawner defect queue entries must be sorted by defect ID");
  assert(Number.isSafeInteger(queue.entry_count) && queue.entry_count === ordered.length, "Spawner defect queue entry count is stale");
  requireSha(queue.queue_sha256, "Spawner defect queue digest");
  assert(queue.queue_sha256 === canonicalDigest(body(queue)), "Spawner defect queue digest mismatch");
  return queue;
}

export function compileAgentSpawnerDefectQueue({queueId, entries = []} = {}) {
  requireIdentifier(queueId, "Spawner defect queue ID");
  const ordered = orderedEntries(entries);
  const queue = {
    schema: AGENT_SPAWNER_DEFECT_QUEUE_SCHEMA,
    version: AGENT_SPAWNER_DEFECT_QUEUE_VERSION,
    queue_id: queueId,
    intake_schema: AGENT_SPAWNER_DEFECT_INTAKE_SCHEMA,
    entries: ordered,
    entry_count: ordered.length,
    queue_sha256: null,
  };
  queue.queue_sha256 = canonicalDigest(body(queue));
  return validateAgentSpawnerDefectQueue(queue);
}

function safeQueueRecordPath(authorityRoot, recordPath) {
  assert(typeof authorityRoot === "string" && path.isAbsolute(authorityRoot), "Spawner queue authority root must be absolute");
  requireRecordPath(recordPath, "Spawner queue record path");
  const inputRootStat = fs.lstatSync(authorityRoot);
  assert(inputRootStat.isDirectory() && !inputRootStat.isSymbolicLink(), "Spawner queue authority root must be a real directory");
  const root = fs.realpathSync.native(authorityRoot);
  const rootStat = fs.lstatSync(root);
  assert(rootStat.isDirectory() && !rootStat.isSymbolicLink(), "Spawner queue authority root must be a real directory");
  const target = path.resolve(root, recordPath);
  assert(target.startsWith(`${root}${path.sep}`), "Spawner queue record path escapes authority root");
  for (let cursor = target; cursor !== root; cursor = path.dirname(cursor)) {
    if (fs.existsSync(cursor)) assert(!fs.lstatSync(cursor).isSymbolicLink(), "Spawner queue record path may not contain symlinks");
  }
  return target;
}

function fsyncQueueDirectory(directory) {
  const descriptor = fs.openSync(directory, fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY ?? 0));
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

export function readAgentSpawnerDefectQueue({authorityRoot, recordPath}) {
  const target = safeQueueRecordPath(authorityRoot, recordPath);
  let stat;
  try { stat = fs.lstatSync(target); } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  assert(stat.isFile() && !stat.isSymbolicLink(), "Spawner defect queue record must be a regular file");
  let queue;
  try { queue = JSON.parse(fs.readFileSync(target, "utf8")); }
  catch (error) { throw new Error(`Spawner defect queue JSON is invalid: ${error.message}`); }
  return validateAgentSpawnerDefectQueue(queue);
}

export function writeAgentSpawnerDefectQueueCompareAndSwap({authorityRoot, recordPath, expectedQueueSha256 = null, queue} = {}) {
  const validated = validateAgentSpawnerDefectQueue(queue);
  requireSha(expectedQueueSha256, "Spawner queue compare-and-swap parent", {nullable: true});
  let target = safeQueueRecordPath(authorityRoot, recordPath);
  fs.mkdirSync(path.dirname(target), {recursive: true});
  target = safeQueueRecordPath(authorityRoot, recordPath);
  const lockPath = `${target}.lock`;
  let lockDescriptor;
  let lockHeld = false;
  let temporary;
  try {
    lockDescriptor = fs.openSync(lockPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
    lockHeld = true;
    const current = readAgentSpawnerDefectQueue({authorityRoot, recordPath});
    if (expectedQueueSha256 === null) assert(current === null, "Spawner defect queue already exists");
    else assert(current !== null && current.queue_sha256 === expectedQueueSha256, "Spawner queue compare-and-swap parent is stale");
    temporary = `${target}.${process.pid}.${crypto.randomUUID()}.stage`;
    const descriptor = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
    try {
      fs.writeFileSync(descriptor, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
      fs.fsyncSync(descriptor);
    } finally { fs.closeSync(descriptor); }
    fs.renameSync(temporary, target);
    fsyncQueueDirectory(path.dirname(target));
    temporary = null;
  } finally {
    if (temporary !== undefined && fs.existsSync(temporary)) fs.unlinkSync(temporary);
    if (lockDescriptor !== undefined) fs.closeSync(lockDescriptor);
    if (lockHeld) {
      try { fs.unlinkSync(lockPath); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  }
  const readback = readAgentSpawnerDefectQueue({authorityRoot, recordPath});
  assert(readback.queue_sha256 === validated.queue_sha256, "Spawner defect queue readback differs");
  return {path: recordPath, queue_sha256: readback.queue_sha256, entry_count: readback.entry_count};
}

export function appendAgentSpawnerDefectQueueRecord({authorityRoot, recordPath, expectedQueueSha256, queueId, intake} = {}) {
  requireSha(expectedQueueSha256, "expected Spawner defect queue");
  validateAgentSpawnerDefectIntake(intake);
  const current = readAgentSpawnerDefectQueue({authorityRoot, recordPath});
  assert(current !== null, "Spawner defect queue is missing");
  assert(current.queue_sha256 === expectedQueueSha256, "Spawner defect queue parent is stale");
  assert(!current.entries.some((entry) => entry.defect_id === intake.defect_id), "Spawner defect queue already contains this defect");
  const next = compileAgentSpawnerDefectQueue({queueId: queueId ?? current.queue_id, entries: [...current.entries, intake]});
  return writeAgentSpawnerDefectQueueCompareAndSwap({authorityRoot, recordPath, expectedQueueSha256, queue: next});
}
