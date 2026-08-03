#!/usr/bin/env node

import path from "node:path";

const ZIP_LOCAL = 0x04034b50;
const ZIP_CENTRAL = 0x02014b50;
const ZIP_END = 0x06054b50;
const ZIP_VERSION = 20;

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function safeArchivePath(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a nonempty string`);
  }
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

export function buildStoredZip(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("ZIP entries must be nonempty");
  }
  const normalized = entries.map((entry) => {
    if (!entry || typeof entry !== "object" || !Buffer.isBuffer(entry.bytes)) {
      throw new Error("ZIP entry is invalid");
    }
    const name = safeArchivePath(entry.name, "ZIP entry");
    if (!Number.isSafeInteger(entry.mode) || entry.mode < 0 || entry.mode > 0o777) {
      throw new Error(`ZIP mode is invalid: ${name}`);
    }
    return {name, bytes: entry.bytes, mode: entry.mode};
  }).sort((left, right) => compareUtf8(left.name, right.name));
  if (new Set(normalized.map((entry) => entry.name)).size !== normalized.length) {
    throw new Error("ZIP entries contain duplicate names");
  }
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of normalized) {
    const nameBytes = Buffer.from(entry.name, "utf8");
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
  end.writeUInt16LE(normalized.length, 8);
  end.writeUInt16LE(normalized.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, central, end]);
}

export function parseStoredZip(bytes) {
  if (!Buffer.isBuffer(bytes)) throw new Error("ZIP bytes must be a Buffer");
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
    localMetadata.set(name, {crc: expectedCrc, size: uncompressedSize, offset: localOffset});
    offset = dataEnd;
  }
  if (entries.size === 0 || offset + 4 > bytes.length
      || bytes.readUInt32LE(offset) !== ZIP_CENTRAL) {
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
