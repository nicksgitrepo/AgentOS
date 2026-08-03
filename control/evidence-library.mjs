#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {fileURLToPath} from "node:url";

import {canonicalCompactJson, compareUtf8} from "./authority-corpus.mjs";

const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const canonicalJson = (value) => `${canonicalCompactJson(value)}\n`;
const ZIP_LOCAL = 0x04034b50;
const ZIP_CENTRAL = 0x02014b50;
const ZIP_END = 0x06054b50;
const ZIP_VERSION = 20;

export const EVIDENCE_LIBRARY_LAYOUT = {
  active: "active",
  historical: "historical",
  payload_prefix: "payload",
  manifest_name: "manifest.json",
  retention_default_days: 14,
  retention_min_days: 1,
  retention_max_days: 3650,
};

function requireRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function requireString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a nonempty string`);
  }
}

function requireExactKeys(value, expected, label) {
  requireRecord(value, label);
  const actual = Object.keys(value).sort(compareUtf8);
  const wanted = [...expected].sort(compareUtf8);
  if (actual.length !== wanted.length
      || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} fields mismatch`);
  }
}

function safeId(value, label) {
  requireString(value, label);
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(value)) {
    throw new Error(`${label} contains an unsafe character`);
  }
  return value;
}

function safeArchivePath(value, label) {
  requireString(value, label);
  const normalized = path.posix.normalize(value.replaceAll("\\", "/"));
  if (path.posix.isAbsolute(normalized)
      || normalized === "."
      || normalized === ".."
      || normalized.startsWith("../")
      || normalized.includes("\0")) {
    throw new Error(`${label} is not a safe relative path`);
  }
  return normalized;
}

function canonicalRoot(root) {
  const real = fs.realpathSync.native(path.resolve(root));
  if (!fs.lstatSync(real).isDirectory()) throw new Error("evidence library root is not a directory");
  return real;
}

function isInside(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function inspectPath(root, relativePath, label, requireLeaf = false) {
  const safeRelative = safeArchivePath(relativePath, label);
  const absolute = path.resolve(root, safeRelative);
  if (!isInside(root, absolute)) throw new Error(`${label} escapes evidence library root`);
  let current = root;
  for (const segment of path.relative(root, absolute).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) {
      if (requireLeaf) throw new Error(`${label} is missing`);
      break;
    }
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`${label} traverses a symbolic link`);
    const real = fs.realpathSync.native(current);
    if (!isInside(root, real)) throw new Error(`${label} resolves outside evidence library root`);
  }
  return absolute;
}

function ensureDirectory(root, relativePath, label) {
  const safeRelative = safeArchivePath(relativePath, label);
  let current = root;
  for (const segment of safeRelative.split("/")) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) fs.mkdirSync(current);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`${label} ancestor is not a real directory`);
    }
    const real = fs.realpathSync.native(current);
    if (!isInside(root, real)) throw new Error(`${label} resolves outside evidence library root`);
  }
  return current;
}

function readRegularFileNoFollow(root, relativePath, label) {
  const absolute = inspectPath(root, relativePath, label, true);
  const descriptor = fs.openSync(
    absolute,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
  );
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile()) throw new Error(`${label} is not a regular file`);
    return {bytes: fs.readFileSync(descriptor), mode: stat.mode & 0o777};
  } finally {
    fs.closeSync(descriptor);
  }
}

function writeExclusiveNoFollow(root, relativePath, bytes, mode = 0o444) {
  const absolute = inspectPath(root, relativePath, "archive output");
  ensureDirectory(root, path.posix.dirname(relativePath), "archive output parent");
  const descriptor = fs.openSync(
    absolute,
    fs.constants.O_WRONLY
      | fs.constants.O_CREAT
      | fs.constants.O_EXCL
      | (fs.constants.O_NOFOLLOW ?? 0),
    mode,
  );
  try {
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  return absolute;
}

function addDays(iso, days) {
  const value = new Date(iso);
  if (!Number.isFinite(value.getTime())) throw new Error("closed_at must be an ISO timestamp");
  return new Date(value.getTime() + days * 86_400_000);
}

function normalizeReleaseRecord(record) {
  requireRecord(record, "release record");
  if (record.schema !== "governance.release_evidence_record.v1") {
    throw new Error("release record schema mismatch");
  }
  const releaseId = safeId(record.release_id, "release_id");
  requireString(record.closed_at, "closed_at");
  if (!Number.isSafeInteger(record.archive_after_days)
      || record.archive_after_days < EVIDENCE_LIBRARY_LAYOUT.retention_min_days
      || record.archive_after_days > EVIDENCE_LIBRARY_LAYOUT.retention_max_days) {
    throw new Error("archive_after_days must be within the configured retention bounds");
  }
  if (record.disposition !== "ACCEPTED_LIVE_CLOSED") {
    throw new Error("only an accepted-live closed release may enter historical storage");
  }
  for (const field of [
    "source_identity",
    "artifact_identity",
    "deployment_identity",
    "rollback_identity",
    "audit_identity",
  ]) {
    requireString(record[field], field);
  }
  if (!Array.isArray(record.agent_evidence_owners)
      || record.agent_evidence_owners.length === 0) {
    throw new Error("agent_evidence_owners must be a nonempty array");
  }
  const agentEvidenceOwners = record.agent_evidence_owners
    .map((owner) => safeId(owner, "agent_evidence_owner"))
    .sort(compareUtf8);
  if (new Set(agentEvidenceOwners).size !== agentEvidenceOwners.length) {
    throw new Error("agent_evidence_owners contains duplicates");
  }
  return {
    ...record,
    release_id: releaseId,
    agent_evidence_owners: agentEvidenceOwners,
  };
}

function collectPayload(root, activeRelativePath) {
  const activeAbsolute = inspectPath(root, activeRelativePath, "active release evidence", true);
  if (!fs.lstatSync(activeAbsolute).isDirectory()) {
    throw new Error("active release evidence is not a directory");
  }
  const payload = [];
  function visit(absoluteDirectory, relativeDirectory = "") {
    const entries = fs.readdirSync(absoluteDirectory, {withFileTypes: true})
      .sort((left, right) => compareUtf8(left.name, right.name));
    for (const entry of entries) {
      const relative = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      safeArchivePath(relative, "payload path");
      const absolute = path.join(absoluteDirectory, entry.name);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error(`payload traverses symbolic link: ${relative}`);
      if (stat.isDirectory()) visit(absolute, relative);
      else if (stat.isFile()) {
        const fromLibraryRoot = path.relative(root, absolute).split(path.sep).join("/");
        const {bytes, mode} = readRegularFileNoFollow(root, fromLibraryRoot, "payload file");
        payload.push({
          path: relative,
          bytes,
          mode,
          size: bytes.length,
          sha256: sha256(bytes),
        });
      } else {
        throw new Error(`payload contains unsupported filesystem object: ${relative}`);
      }
    }
  }
  visit(activeAbsolute);
  if (payload.length === 0) throw new Error("active release evidence is empty");
  return payload;
}

function bindAgentInventory(payload, declaredOwners) {
  const observedOwners = new Set();
  for (const record of payload) {
    const segments = record.path.split("/");
    if (segments[0] === "agents") {
      if (segments.length < 3) {
        throw new Error("agent evidence must be stored below agents/<owner>/");
      }
      observedOwners.add(safeId(segments[1], "agent evidence namespace"));
    }
  }
  const observed = [...observedOwners].sort(compareUtf8);
  if (observed.length !== declaredOwners.length
      || observed.some((owner, index) => owner !== declaredOwners[index])) {
    throw new Error("agent_evidence_owners does not exactly match dossier agent namespaces");
  }
  return observed;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function localHeader(nameBytes, bytes, crc) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(ZIP_LOCAL, 0);
  header.writeUInt16LE(ZIP_VERSION, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0x0021, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(bytes.length, 18);
  header.writeUInt32LE(bytes.length, 22);
  header.writeUInt16LE(nameBytes.length, 26);
  header.writeUInt16LE(0, 28);
  return header;
}

function centralHeader(nameBytes, bytes, crc, offset, mode) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(ZIP_CENTRAL, 0);
  header.writeUInt16LE((3 << 8) | ZIP_VERSION, 4);
  header.writeUInt16LE(ZIP_VERSION, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(0x0021, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(bytes.length, 20);
  header.writeUInt32LE(bytes.length, 24);
  header.writeUInt16LE(nameBytes.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(((0o100000 | mode) << 16) >>> 0, 38);
  header.writeUInt32LE(offset, 42);
  return header;
}

function buildStoredZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBytes = Buffer.from(safeArchivePath(entry.name, "ZIP entry"), "utf8");
    const crc = crc32(entry.bytes);
    const local = localHeader(nameBytes, entry.bytes, crc);
    localParts.push(local, nameBytes, entry.bytes);
    centralParts.push(centralHeader(nameBytes, entry.bytes, crc, offset, entry.mode), nameBytes);
    offset += local.length + nameBytes.length + entry.bytes.length;
  }
  const central = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(ZIP_END, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, central, end]);
}

function parseStoredZip(bytes) {
  const entries = new Map();
  const localMetadata = new Map();
  let offset = 0;
  while (offset + 4 <= bytes.length && bytes.readUInt32LE(offset) === ZIP_LOCAL) {
    const localOffset = offset;
    if (offset + 30 > bytes.length) throw new Error("truncated ZIP local header");
    const flags = bytes.readUInt16LE(offset + 6);
    const method = bytes.readUInt16LE(offset + 8);
    const expectedCrc = bytes.readUInt32LE(offset + 14);
    const compressedSize = bytes.readUInt32LE(offset + 18);
    const uncompressedSize = bytes.readUInt32LE(offset + 22);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    if (flags !== 0x0800 || method !== 0 || compressedSize !== uncompressedSize) {
      throw new Error("ZIP entry is not deterministic UTF-8 stored data");
    }
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > bytes.length) throw new Error("truncated ZIP entry");
    const name = bytes.subarray(nameStart, nameStart + nameLength).toString("utf8");
    safeArchivePath(name, "ZIP entry path");
    if (entries.has(name)) throw new Error("ZIP contains duplicate entry");
    const payload = bytes.subarray(dataStart, dataEnd);
    if (crc32(payload) !== expectedCrc) throw new Error(`ZIP CRC mismatch: ${name}`);
    entries.set(name, {bytes: Buffer.from(payload), mode: null});
    localMetadata.set(name, {
      crc: expectedCrc,
      size: uncompressedSize,
      offset: localOffset,
    });
    offset = dataEnd;
  }
  if (entries.size === 0 || offset + 4 > bytes.length || bytes.readUInt32LE(offset) !== ZIP_CENTRAL) {
    throw new Error("ZIP central directory missing");
  }
  const centralStart = offset;
  const centralNames = new Set();
  while (offset + 4 <= bytes.length && bytes.readUInt32LE(offset) === ZIP_CENTRAL) {
    if (offset + 46 > bytes.length) throw new Error("truncated ZIP central header");
    const flags = bytes.readUInt16LE(offset + 8);
    const method = bytes.readUInt16LE(offset + 10);
    const crc = bytes.readUInt32LE(offset + 16);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const uncompressedSize = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const externalAttributes = bytes.readUInt32LE(offset + 38);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    const next = nameStart + nameLength + extraLength + commentLength;
    if (next > bytes.length) throw new Error("truncated ZIP central entry");
    const name = bytes.subarray(nameStart, nameStart + nameLength).toString("utf8");
    safeArchivePath(name, "ZIP central path");
    const local = localMetadata.get(name);
    const unixMode = externalAttributes >>> 16;
    const permissionMode = unixMode & 0o777;
    if (!local
        || centralNames.has(name)
        || flags !== 0x0800
        || method !== 0
        || compressedSize !== uncompressedSize
        || local.crc !== crc
        || local.size !== uncompressedSize
        || local.offset !== localOffset
        || (unixMode & 0o170000) !== 0o100000) {
      throw new Error(`ZIP central/local mismatch: ${name}`);
    }
    entries.get(name).mode = permissionMode;
    centralNames.add(name);
    offset = next;
  }
  if (offset + 22 !== bytes.length || bytes.readUInt32LE(offset) !== ZIP_END) {
    throw new Error("ZIP end record missing or trailing bytes present");
  }
  const entryCount = bytes.readUInt16LE(offset + 10);
  const centralSize = bytes.readUInt32LE(offset + 12);
  const recordedCentralStart = bytes.readUInt32LE(offset + 16);
  const commentLength = bytes.readUInt16LE(offset + 20);
  if (entryCount !== entries.size
      || centralNames.size !== entries.size
      || centralSize !== offset - centralStart
      || recordedCentralStart !== centralStart
      || commentLength !== 0) {
    throw new Error("ZIP end record mismatch");
  }
  return entries;
}

function validateManifest(manifest) {
  requireExactKeys(manifest, [
    "schema",
    "release_id",
    "disposition",
    "closed_at",
    "archive_after_days",
    "archive_eligible_at",
    "identities",
    "agent_evidence_owners",
    "payload",
  ], "manifest");
  if (manifest.schema !== "governance.release_evidence_manifest.v1") {
    throw new Error("manifest schema mismatch");
  }
  safeId(manifest.release_id, "manifest release_id");
  requireString(manifest.closed_at, "manifest closed_at");
  requireString(manifest.archive_eligible_at, "manifest archive_eligible_at");
  if (manifest.disposition !== "ACCEPTED_LIVE_CLOSED"
      || !Number.isSafeInteger(manifest.archive_after_days)
      || manifest.archive_after_days < EVIDENCE_LIBRARY_LAYOUT.retention_min_days
      || manifest.archive_after_days > EVIDENCE_LIBRARY_LAYOUT.retention_max_days) {
    throw new Error("manifest release closure fields mismatch");
  }
  requireExactKeys(
    manifest.identities,
    ["source", "artifact", "deployment", "rollback", "audit"],
    "manifest identities",
  );
  for (const [identity, value] of Object.entries(manifest.identities)) {
    requireString(value, `manifest identity ${identity}`);
  }
  if (!Array.isArray(manifest.agent_evidence_owners)
      || manifest.agent_evidence_owners.length === 0) {
    throw new Error("manifest agent_evidence_owners must be nonempty");
  }
  const owners = manifest.agent_evidence_owners.map(
    (owner) => safeId(owner, "manifest agent_evidence_owner"),
  );
  const sortedOwners = [...owners].sort(compareUtf8);
  if (new Set(owners).size !== owners.length
      || owners.some((owner, index) => owner !== sortedOwners[index])) {
    throw new Error("manifest agent_evidence_owners must be unique and canonically ordered");
  }
  if (!Array.isArray(manifest.payload) || manifest.payload.length === 0) {
    throw new Error("manifest payload must be nonempty");
  }
  const paths = new Set();
  for (const record of manifest.payload) {
    requireExactKeys(record, ["path", "mode", "size", "sha256"], "manifest payload record");
    const payloadPath = safeArchivePath(record.path, "manifest payload path");
    if (paths.has(payloadPath)) throw new Error("manifest contains duplicate payload path");
    paths.add(payloadPath);
    if (!Number.isSafeInteger(record.mode) || record.mode < 0 || record.mode > 0o777) {
      throw new Error(`manifest payload mode is invalid: ${payloadPath}`);
    }
    if (!Number.isSafeInteger(record.size) || record.size < 0) {
      throw new Error(`manifest payload size is invalid: ${payloadPath}`);
    }
    if (typeof record.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(record.sha256)) {
      throw new Error(`manifest payload SHA-256 is invalid: ${payloadPath}`);
    }
  }
  bindAgentInventory(manifest.payload, owners);
}

export function compileEvidenceArchivePlan(libraryRoot, releaseRecord, nowIso) {
  const root = canonicalRoot(libraryRoot);
  const release = normalizeReleaseRecord(releaseRecord);
  const archiveAt = addDays(release.closed_at, release.archive_after_days);
  const now = new Date(nowIso);
  if (!Number.isFinite(now.getTime())) throw new Error("now must be an ISO timestamp");
  const activeRelativePath = `${EVIDENCE_LIBRARY_LAYOUT.active}/${release.release_id}`;
  const historicalRelativePath =
    `${EVIDENCE_LIBRARY_LAYOUT.historical}/${release.release_id}`;
  const payload = collectPayload(root, activeRelativePath);
  bindAgentInventory(payload, release.agent_evidence_owners);
  const manifest = {
    schema: "governance.release_evidence_manifest.v1",
    release_id: release.release_id,
    disposition: release.disposition,
    closed_at: release.closed_at,
    archive_after_days: release.archive_after_days,
    archive_eligible_at: archiveAt.toISOString(),
    identities: {
      source: release.source_identity,
      artifact: release.artifact_identity,
      deployment: release.deployment_identity,
      rollback: release.rollback_identity,
      audit: release.audit_identity,
    },
    agent_evidence_owners: release.agent_evidence_owners,
    payload: payload.map(({path: payloadPath, mode, size, sha256: digest}) => ({
      path: payloadPath,
      mode,
      size,
      sha256: digest,
    })),
  };
  const manifestBytes = Buffer.from(canonicalJson(manifest), "utf8");
  const zipEntries = [
    {name: EVIDENCE_LIBRARY_LAYOUT.manifest_name, bytes: manifestBytes, mode: 0o444},
    ...payload.map((entry) => ({
      name: `${EVIDENCE_LIBRARY_LAYOUT.payload_prefix}/${entry.path}`,
      bytes: entry.bytes,
      mode: entry.mode,
    })),
  ];
  const zipBytes = buildStoredZip(zipEntries);
  const archiveName = `${release.release_id}.evidence.zip`;
  return {
    schema: "governance.release_evidence_archive_plan.v1",
    release,
    active_relative_path: activeRelativePath,
    historical_relative_path: historicalRelativePath,
    archive_relative_path: `${historicalRelativePath}/${archiveName}`,
    manifest_relative_path: `${historicalRelativePath}/${release.release_id}.manifest.json`,
    checksum_relative_path: `${historicalRelativePath}/${release.release_id}.sha256`,
    eligible: now.getTime() >= archiveAt.getTime(),
    manifest,
    manifest_bytes: manifestBytes,
    manifest_sha256: sha256(manifestBytes),
    archive_bytes: zipBytes,
    archive_sha256: sha256(zipBytes),
  };
}

export function verifyEvidenceArchive(
  archiveBytes,
  manifestBytes,
  checksumBytes,
  expectedArchiveBasename,
) {
  const expectedArchiveSha256 = sha256(archiveBytes);
  safeId(expectedArchiveBasename, "archive basename");
  const expectedChecksum = `${expectedArchiveSha256}  ${expectedArchiveBasename}\n`;
  if (!Buffer.isBuffer(checksumBytes)
      || checksumBytes.toString("utf8") !== expectedChecksum) {
    throw new Error("adjacent checksum readback mismatch");
  }
  if (!/^[0-9a-f]{64}$/.test(expectedArchiveSha256)) {
    throw new Error("archive SHA-256 mismatch");
  }
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (canonicalJson(manifest) !== manifestBytes.toString("utf8")) {
    throw new Error("manifest is not canonical compact JSON");
  }
  validateManifest(manifest);
  const entries = parseStoredZip(archiveBytes);
  const embeddedManifest = entries.get(EVIDENCE_LIBRARY_LAYOUT.manifest_name);
  if (!embeddedManifest
      || embeddedManifest.mode !== 0o444
      || !embeddedManifest.bytes.equals(manifestBytes)) {
    throw new Error("embedded manifest mismatch");
  }
  const expectedNames = new Set([EVIDENCE_LIBRARY_LAYOUT.manifest_name]);
  for (const record of manifest.payload) {
    const name = `${EVIDENCE_LIBRARY_LAYOUT.payload_prefix}/${safeArchivePath(record.path, "manifest payload path")}`;
    expectedNames.add(name);
    const entry = entries.get(name);
    if (!entry
        || entry.mode !== record.mode
        || entry.bytes.length !== record.size
        || sha256(entry.bytes) !== record.sha256) {
      throw new Error(`manifest payload mismatch: ${record.path}`);
    }
  }
  if (entries.size !== expectedNames.size
      || [...entries.keys()].some((name) => !expectedNames.has(name))) {
    throw new Error("archive contains unmanifested entries");
  }
  return {
    schema: "governance.release_evidence_archive_verification.v1",
    release_id: manifest.release_id,
    archive_sha256: expectedArchiveSha256,
    manifest_sha256: sha256(manifestBytes),
    payload_files: manifest.payload.length,
    status: "VERIFIED_EXACT",
  };
}

export function archiveReleaseEvidence(libraryRoot, releaseRecord, nowIso) {
  const root = canonicalRoot(libraryRoot);
  const plan = compileEvidenceArchivePlan(root, releaseRecord, nowIso);
  if (!plan.eligible) throw new Error("release evidence is still inside its configured active window");
  ensureDirectory(root, plan.historical_relative_path, "historical release directory");
  if ([plan.archive_relative_path, plan.manifest_relative_path, plan.checksum_relative_path]
    .some((relative) => fs.existsSync(inspectPath(root, relative, "historical output")))) {
    throw new Error("historical release archive already exists");
  }
  writeExclusiveNoFollow(root, plan.archive_relative_path, plan.archive_bytes);
  writeExclusiveNoFollow(root, plan.manifest_relative_path, plan.manifest_bytes);
  writeExclusiveNoFollow(
    root,
    plan.checksum_relative_path,
    Buffer.from(`${plan.archive_sha256}  ${path.posix.basename(plan.archive_relative_path)}\n`, "utf8"),
  );
  const archiveBasename = path.posix.basename(plan.archive_relative_path);
  const verification = verifyEvidenceArchive(
    readRegularFileNoFollow(root, plan.archive_relative_path, "historical archive").bytes,
    readRegularFileNoFollow(root, plan.manifest_relative_path, "historical manifest").bytes,
    readRegularFileNoFollow(root, plan.checksum_relative_path, "historical checksum").bytes,
    archiveBasename,
  );
  return {
    plan: {
      schema: plan.schema,
      active_relative_path: plan.active_relative_path,
      historical_relative_path: plan.historical_relative_path,
      archive_relative_path: plan.archive_relative_path,
      manifest_relative_path: plan.manifest_relative_path,
      checksum_relative_path: plan.checksum_relative_path,
      archive_sha256: plan.archive_sha256,
      manifest_sha256: plan.manifest_sha256,
    },
    verification,
    loose_evidence_disposition:
      "PRESERVED_UNTIL_CALLER_MECHANICALLY_CONFIRMS_ARCHIVE_AND_EXPLICITLY_COMPACTS_DUPLICATES",
  };
}

function parseCli(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (["--library-root", "--release", "--now", "--archive", "--manifest", "--checksum"]
      .includes(argument)) {
      result[argument.slice(2).replaceAll("-", "_")] = argv[++index];
    } else if (argument === "--apply") {
      result.apply = true;
    } else if (argument === "--verify") {
      result.verify = true;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  return result;
}

function main() {
  const options = parseCli(process.argv.slice(2));
  if (options.verify) {
    if (!options.archive || !options.manifest || !options.checksum) {
      throw new Error("--verify requires --archive, --manifest, and --checksum");
    }
    process.stdout.write(canonicalJson(verifyEvidenceArchive(
      fs.readFileSync(options.archive),
      fs.readFileSync(options.manifest),
      fs.readFileSync(options.checksum),
      path.basename(options.archive),
    )));
    return;
  }
  if (!options.library_root || !options.release || !options.now) {
    throw new Error("--library-root, --release, and --now are required");
  }
  const release = JSON.parse(fs.readFileSync(options.release, "utf8"));
  const result = options.apply
    ? archiveReleaseEvidence(options.library_root, release, options.now)
    : compileEvidenceArchivePlan(options.library_root, release, options.now);
  const printable = structuredClone(result);
  delete printable.archive_bytes;
  delete printable.manifest_bytes;
  process.stdout.write(canonicalJson(printable));
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    main();
  } catch (error) {
    console.error(`FAIL: ${error.message}`);
    process.exit(1);
  }
}
