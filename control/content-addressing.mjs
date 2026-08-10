#!/usr/bin/env node

/* Small shared primitive for deterministic, content-addressed records. */

import crypto from "node:crypto";

import {
  PERSISTED_RECORD_PRIVACY_SCHEMA,
  PERSISTED_RECORD_PRIVACY_VERSION,
  PRIVACY_CATEGORIES,
  assertPersistedRecordSafe,
  compileRedactedRecord,
  privacyDigest,
  redactPersistedRecord,
  redactPersistedText,
  resolveHostLocalRuntimeConfig,
  scanPersistedRecord,
  serializePersistedRecord,
  validateRedactedRecord,
  writePersistedRecordAtomic,
} from "./persisted-record-privacy.mjs";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort(compareUtf8)
      .map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function canonicalDigest(value) {
  return crypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

// Public export boundary: callers use this shared module for both ordinary
// content addressing and privacy-safe persisted-record serialization. Keep the
// serializer names bound locally so an export drift cannot hide behind a
// transitive re-export.
export {
  PERSISTED_RECORD_PRIVACY_SCHEMA,
  PERSISTED_RECORD_PRIVACY_VERSION,
  PRIVACY_CATEGORIES,
  assertPersistedRecordSafe,
  compileRedactedRecord,
  privacyDigest,
  redactPersistedRecord,
  redactPersistedText,
  resolveHostLocalRuntimeConfig,
  scanPersistedRecord,
  serializePersistedRecord,
  validateRedactedRecord,
  writePersistedRecordAtomic,
} from "./persisted-record-privacy.mjs";
