#!/usr/bin/env node

/* Repository-relative AgentOS authority. Callers can request canonical refs; they cannot supply roots. */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {canonicalDigest} from "./content-addressing.mjs";

const MODULE_ROOT = fs.realpathSync.native(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
const BINDING_PATH = "schemas/bootstrap-binding.v1.json";
const states = new WeakMap();
let singleton = null;

function assert(condition, message, code = "SEALED_AUTHORITY_INVALID") {
  if (!condition) { const error = new Error(message); error.code = code; throw error; }
}
function sha256(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
function safeCanonicalFile(relativePath) {
  assert(typeof relativePath === "string" && relativePath.length > 0 && !path.isAbsolute(relativePath), "Canonical authority path is invalid");
  assert(!relativePath.split(/[\\/]/u).some((part) => part === "" || part === ".."), "Canonical authority path escapes the repository");
  const target = path.resolve(MODULE_ROOT, relativePath);
  assert(target.startsWith(`${MODULE_ROOT}${path.sep}`), "Canonical authority path escapes the repository");
  const stat = fs.lstatSync(target);
  assert(stat.isFile() && !stat.isSymbolicLink(), `Canonical authority is not a regular non-symlink file: ${relativePath}`);
  assert(fs.realpathSync.native(target) === target, `Canonical authority contains a symlinked path: ${relativePath}`);
  return target;
}
function loadBinding() {
  const bytes = fs.readFileSync(safeCanonicalFile(BINDING_PATH));
  const value = JSON.parse(bytes.toString("utf8"));
  assert(value.schema === "agentos.governance_2_1rc_bootstrap_binding.v2" && value.version === 2, "Canonical bootstrap binding identity is invalid");
  const entries = new Map();
  for (const section of ["normative", "compatibility_only"]) for (const [bindingId, record] of Object.entries(value[section] ?? {})) {
    if (!record?.path) continue;
    assert(!entries.has(bindingId), `Canonical binding ID is duplicated: ${bindingId}`);
    assert(typeof record.sha256 === "string" && /^[0-9a-f]{64}$/u.test(record.sha256), `Canonical binding digest is invalid: ${bindingId}`);
    const fileBytes = fs.readFileSync(safeCanonicalFile(record.path));
    assert(sha256(fileBytes) === record.sha256, `Canonical binding bytes differ: ${bindingId}`, "SEALED_AUTHORITY_BINDING_DRIFT");
    entries.set(bindingId, Object.freeze({binding_id: bindingId, path: record.path, sha256: record.sha256}));
  }
  return {binding: Object.freeze(value), binding_sha256: sha256(bytes), entries};
}

class SealedCanonicalAuthority {
  constructor(token) { assert(token === SealedCanonicalAuthority, "Sealed authority cannot be caller-constructed"); }
  toJSON() { return {schema: "agentos.sealed_authority_opaque.v1", serializable: false}; }
}

export function getSealedCanonicalAuthority() {
  if (singleton !== null) return singleton;
  const loaded = loadBinding();
  const capability = Object.freeze(new SealedCanonicalAuthority(SealedCanonicalAuthority));
  states.set(capability, Object.freeze({root: MODULE_ROOT, ...loaded, authority_sha256: canonicalDigest({binding_sha256: loaded.binding_sha256, entries: [...loaded.entries.values()]})}));
  singleton = capability;
  return capability;
}

export function assertSealedCanonicalAuthority(capability) {
  assert(states.has(capability), "Authority capability was serialized, reconstructed, or caller-authored", "SEALED_AUTHORITY_PROVENANCE_INVALID");
  return capability;
}

export function readSealedAuthorityBinding(capability, bindingId, {json = true} = {}) {
  assertSealedCanonicalAuthority(capability);
  const state = states.get(capability);
  const entry = state.entries.get(bindingId);
  assert(entry, `Canonical authority binding is unknown: ${bindingId}`);
  const target = safeCanonicalFile(entry.path);
  const bytes = fs.readFileSync(target);
  assert(sha256(bytes) === entry.sha256, `Canonical authority changed after sealing: ${bindingId}`, "SEALED_AUTHORITY_BINDING_DRIFT");
  return Object.freeze({binding_id: bindingId, relative_path: entry.path, file_sha256: entry.sha256, bytes: Buffer.from(bytes), value: json ? JSON.parse(bytes.toString("utf8")) : null});
}

export function sealedAuthorityIdentity(capability = getSealedCanonicalAuthority()) {
  assertSealedCanonicalAuthority(capability);
  const state = states.get(capability);
  return Object.freeze({schema: "agentos.sealed_authority_identity.v1", binding_sha256: state.binding_sha256, authority_sha256: state.authority_sha256});
}

export function sealedAuthorityRepositoryRoot(capability = getSealedCanonicalAuthority()) {
  assertSealedCanonicalAuthority(capability);
  return states.get(capability).root;
}
