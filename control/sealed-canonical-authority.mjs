#!/usr/bin/env node

/* Repository-relative AgentOS authority. Callers can request canonical refs; they cannot supply roots. */

import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const LOADER_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "bootstrap-authority-loader.mjs");
const states = new WeakMap();
let singleton = null;

function assert(condition, message, code = "SEALED_AUTHORITY_INVALID") {
  if (!condition) { const error = new Error(message); error.code = code; throw error; }
}
function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function cleanLoaderEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !["NODE_OPTIONS", "NODE_PATH"].includes(key) && !key.startsWith("NODE_")));
}
function invokeLoader(args) {
  assert(process.execArgv.every((arg) => !/(?:--loader|--import|--require|-r(?:$|=))/u.test(arg)), "Authority cannot be sealed under a preload/custom loader", "SEALED_AUTHORITY_RUNTIME_HOOK");
  assert(!process.env.NODE_OPTIONS, "Authority cannot be sealed when NODE_OPTIONS can preload or hook runtime code", "SEALED_AUTHORITY_RUNTIME_HOOK");
  const raw = execFileSync(process.execPath, [LOADER_PATH, ...args], {encoding: "utf8", env: cleanLoaderEnvironment(), cwd: dirname(LOADER_PATH), stdio: ["ignore", "pipe", "pipe"]});
  return JSON.parse(raw);
}
function loadBinding() {
  const readback = invokeLoader(["identity"]);
  assert(readback.schema === "agentos.bootstrap_authority_loader_readback.v1", "Authority loader readback identity differs");
  const entries = new Map(readback.entries.map((entry) => [entry.binding_id, Object.freeze(entry)]));
  return {root: readback.root, binding_sha256: readback.binding_sha256, authority_sha256: readback.authority_sha256, entries};
}

class SealedCanonicalAuthority {
  constructor(token) { assert(token === SealedCanonicalAuthority, "Sealed authority cannot be caller-constructed"); }
  toJSON() { return {schema: "agentos.sealed_authority_opaque.v1", serializable: false}; }
}

export function getSealedCanonicalAuthority() {
  if (singleton !== null) return singleton;
  const loaded = loadBinding();
  const capability = Object.freeze(new SealedCanonicalAuthority(SealedCanonicalAuthority));
  states.set(capability, Object.freeze(loaded));
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
  const readback = invokeLoader(["read", bindingId]);
  const bytes = Buffer.from(readback.bytes_base64, "base64");
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
