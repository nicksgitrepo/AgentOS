#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

import {
  FOUR_LIBRARY_VERSION,
  GovernanceValidationError,
  HISTORY_EVENT_TYPES,
  PROJECT_HISTORY_SCHEMA,
  assert,
  assertPortable,
  canonicalDigest,
  canonicalJson,
  digestWithout,
  exactKeys,
  requireDigest,
  requireIdentifier,
  requirePositiveInteger,
  requireString,
  validatePacketDigest,
  validateProjectGeneralLibrary,
} from "./four-library-foundation.mjs";

export function compileProjectHistoryEntry({projectGeneralLibrary, event_type, previous = null, source_snapshot_digest = null} = {}) {
  validateProjectGeneralLibrary(projectGeneralLibrary);
  assert(HISTORY_EVENT_TYPES.includes(event_type), "project history event_type is invalid");
  if (previous !== null) validateProjectHistoryEntry(previous);
  if (source_snapshot_digest !== null) requireDigest(source_snapshot_digest, "project history source_snapshot_digest");
  const entry = {
    schema: PROJECT_HISTORY_SCHEMA,
    version: FOUR_LIBRARY_VERSION,
    status: "APPENDED",
    project_id: projectGeneralLibrary.project_id,
    event_type,
    project_general_library_digest: projectGeneralLibrary.digest,
    source_snapshot_digest: source_snapshot_digest ?? projectGeneralLibrary.digest,
    supersedes: previous?.digest ?? null,
    revision: previous === null ? 1 : previous.revision + 1,
    digest: null,
  };
  entry.digest = digestWithout(entry, "digest");
  return validateProjectHistoryEntry(entry);
}

export function validateProjectHistoryEntry(value) {
  exactKeys(value, [
    "schema", "version", "status", "project_id", "event_type", "project_general_library_digest",
    "source_snapshot_digest", "supersedes", "revision", "digest",
  ], "project governance history entry");
  assert(value.schema === PROJECT_HISTORY_SCHEMA && value.version === FOUR_LIBRARY_VERSION && value.status === "APPENDED", "project history entry identity is invalid");
  requireIdentifier(value.project_id, "project history project_id");
  assert(HISTORY_EVENT_TYPES.includes(value.event_type), "project history event_type is invalid");
  requireDigest(value.project_general_library_digest, "project history project_general_library_digest");
  requireDigest(value.source_snapshot_digest, "project history source_snapshot_digest");
  if (value.supersedes !== null) requireDigest(value.supersedes, "project history supersedes");
  requirePositiveInteger(value.revision, "project history revision");
  validatePacketDigest(value, "project governance history entry");
  assertPortable(value, "project governance history entry");
  return value;
}

function safeHistoryTarget(historyFile, controlRoot) {
  requireString(historyFile, "historyFile");
  requireString(controlRoot, "controlRoot");
  const root = fs.realpathSync.native(controlRoot);
  const unresolvedTarget = path.resolve(historyFile);
  const canonicalParent = fs.realpathSync.native(path.dirname(unresolvedTarget));
  const target = path.join(canonicalParent, path.basename(unresolvedTarget));
  assert(target === root || target.startsWith(`${root}${path.sep}`), "project history must remain inside its control root");
  if (fs.existsSync(target)) {
    const stat = fs.lstatSync(target);
    assert(!stat.isSymbolicLink() && stat.isFile(), "project history target must be a regular file");
  }
  return target;
}

function readHistoryEntries(target) {
  if (!fs.existsSync(target)) return [];
  const text = fs.readFileSync(target, "utf8");
  if (text.length === 0) return [];
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const entries = lines.map((line, index) => {
    assert(line.length > 0, `project history line ${index + 1} is empty`);
    let entry;
    try {
      entry = JSON.parse(line);
    } catch (error) {
      throw new GovernanceValidationError(`project history line ${index + 1} is not JSON: ${error.message}`);
    }
    return validateProjectHistoryEntry(entry);
  });
  validateHistoryChain(entries);
  return entries;
}

function validateHistoryChain(entries) {
  let previous = null;
  for (const entry of entries) {
    if (previous === null) {
      assert(entry.supersedes === null && entry.revision === 1, "project history chain must start at revision 1");
    } else {
      assert(entry.project_id === previous.project_id, "project history chain changed project");
      assert(entry.supersedes === previous.digest, "project history chain supersession is not contiguous");
      assert(entry.revision === previous.revision + 1, "project history chain revision is not monotonic");
    }
    previous = entry;
  }
  return entries;
}

export function appendProjectGovernanceHistory({historyFile, controlRoot, entry} = {}) {
  const target = safeHistoryTarget(historyFile, controlRoot);
  validateProjectHistoryEntry(entry);
  const entries = readHistoryEntries(target);
  validateHistoryChain(entries);
  const previous = entries.at(-1) ?? null;
  if (previous === null) {
    assert(entry.supersedes === null && entry.revision === 1, "initial project history entry must start a new chain");
  } else {
    assert(previous.project_id === entry.project_id, "project history project changed");
    assert(entry.supersedes === previous.digest, "project history supersession is not append-only");
    assert(entry.revision === previous.revision + 1, "project history revision is not monotonic");
  }
  fs.mkdirSync(path.dirname(target), {recursive: true});
  const flags = fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_WRONLY | (fs.constants.O_NOFOLLOW ?? 0);
  const descriptor = fs.openSync(target, flags, 0o600);
  try {
    fs.writeSync(descriptor, `${canonicalJson(entry)}\n`, null, "utf8");
  } finally {
    fs.closeSync(descriptor);
  }
  return entry;
}

export {canonicalDigest};
