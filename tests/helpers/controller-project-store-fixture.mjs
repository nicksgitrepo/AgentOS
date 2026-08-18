/*
 * Test-only Controller project-store clone.
 *
 * This fixture intentionally does not provision the production module. It
 * exercises the storage protocol in isolation while production remains
 * fail-closed until trusted Bootstrap provisioning is available.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {randomBytes} from "node:crypto";
import {canonicalDigest, canonicalJson, compareUtf8} from "../../control/content-addressing.mjs";

export const CONTROLLER_PROJECT_STORE_SCHEMA = "agentos.controller_project_store.v1";
const STATE_PATH = "agentos/controller-state.json";
const SHA256 = /^[0-9a-f]{64}$/u;
const provisions = new WeakMap();
const stores = new WeakMap();

function fail(message, code = "CONTROLLER_PROJECT_STORE_INVALID") { const error = new Error(message); error.code = code; throw error; }
function assert(value, message, code) { if (!value) fail(message, code); }
function record(value, label) { assert(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`); return value; }
function exactKeys(value, keys, label) { record(value, label); assert(JSON.stringify(Object.keys(value).sort(compareUtf8)) === JSON.stringify([...keys].sort(compareUtf8)), `${label} fields mismatch`); }
function rootDirectory(root) {
  const resolved = fs.realpathSync.native(root), stat = fs.lstatSync(resolved);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), "Controller fixture root is unsafe", "CONTROLLER_PROJECT_STORE_UNSAFE");
  return resolved;
}
function stateTarget(root) {
  const resolved = rootDirectory(root), target = path.resolve(resolved, STATE_PATH);
  assert(target.startsWith(`${resolved}${path.sep}`), "Controller fixture state escaped its root", "CONTROLLER_PROJECT_STORE_UNSAFE");
  const parent = path.dirname(target);
  fs.mkdirSync(parent, {recursive: true, mode: 0o700});
  assert(fs.realpathSync.native(parent) === parent && !fs.lstatSync(parent).isSymbolicLink(), "Controller fixture parent is unsafe", "CONTROLLER_PROJECT_STORE_UNSAFE");
  return {root: resolved, target};
}
function provisionFor(capability) {
  const provision = provisions.get(capability);
  assert(provision?.active && !provision.consumed && !provision.reattached, "Controller fixture provisioning capability is stale, replayed, or consumed", "CONTROLLER_PROJECT_STORE_CAPABILITY_REQUIRED");
  assert(provision.generation === provision.rootRecord.generation, "Controller fixture provisioning generation is stale", "CONTROLLER_PROJECT_STORE_STALE");
  return provision;
}
function storeFor(capability) {
  const store = stores.get(capability);
  assert(store?.rootRecord.active && store.generation === store.rootRecord.generation, "Controller fixture capability is stale, revoked, or forged", "CONTROLLER_PROJECT_STORE_CAPABILITY_REQUIRED");
  return store;
}
function readRaw(target) {
  if (!fs.existsSync(target)) return null;
  const stat = fs.lstatSync(target); assert(stat.isFile() && !stat.isSymbolicLink(), "Controller fixture state is unsafe", "CONTROLLER_PROJECT_STORE_UNSAFE");
  return JSON.parse(fs.readFileSync(target, "utf8"));
}
function lock(target, generation) {
  const lockPath = `${target}.lock`, fence = canonicalDigest({schema: CONTROLLER_PROJECT_STORE_SCHEMA, target_ref: "opaque:controller-state", generation, nonce: randomBytes(32).toString("hex")});
  try { fs.writeFileSync(lockPath, `${fence}\n`, {flag: "wx", mode: 0o600}); }
  catch (error) { if (error.code === "EEXIST") fail("Controller fixture store is fenced", "CONTROLLER_PROJECT_STORE_FENCED"); throw error; }
  return {lockPath, fence};
}

export function prepareEphemeralControllerProjectStoreForTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-controller-project-store-fixture-"));
  const rootRecord = {root, projectStoreId: `PROJECT.STORE.${randomBytes(16).toString("hex").toUpperCase()}`, generation: 1, active: true};
  const capability = Object.freeze(Object.create(null));
  provisions.set(capability, {rootRecord, generation: 1, active: true, consumed: false, reattached: false});
  return capability;
}

export function reattachEphemeralControllerProjectStoreForTest(priorCapability) {
  const prior = provisions.get(priorCapability);
  assert(prior?.active && prior.consumed && !prior.reattached && prior.generation === prior.rootRecord.generation, "Controller fixture reattachment requires the current consumed capability", "CONTROLLER_PROJECT_STORE_REATTACHMENT_INVALID");
  prior.reattached = true; prior.rootRecord.generation += 1;
  const capability = Object.freeze(Object.create(null));
  provisions.set(capability, {rootRecord: prior.rootRecord, generation: prior.rootRecord.generation, active: true, consumed: false, reattached: false});
  return capability;
}

export function disposeEphemeralControllerProjectStoreForTest(capability) {
  const provision = provisions.get(capability);
  assert(provision?.rootRecord, "Controller fixture dispose requires its opaque capability", "CONTROLLER_PROJECT_STORE_CAPABILITY_REQUIRED");
  fs.rmSync(provision.rootRecord.root, {recursive: true, force: true}); provision.rootRecord.active = false; provision.active = false;
}

export function openControllerProjectStore(options = {}) {
  assert(record(options, "Controller fixture open") && JSON.stringify(Object.keys(options).sort(compareUtf8)) === JSON.stringify(["projectControlStoreCapability"].sort(compareUtf8)), "Controller fixture rejects caller roots, paths, environment, and adapters", "CONTROLLER_PROJECT_STORE_ROOT_CALLER_FORBIDDEN");
  exactKeys(options, ["projectControlStoreCapability"], "Controller fixture open");
  const provision = provisionFor(options.projectControlStoreCapability);
  provision.consumed = true;
  const {root, target} = stateTarget(provision.rootRecord.root);
  const capability = Object.freeze(Object.create(null));
  stores.set(capability, {root, target, rootRecord: provision.rootRecord, generation: provision.generation});
  return capability;
}

export function readControllerProjectState(capability) { return readRaw(storeFor(capability).target); }

export function writeControllerProjectStateCompareAndSwap(capability, {expectedStateSha256 = null, state, validateState} = {}) {
  const store = storeFor(capability); if (typeof validateState === "function") validateState(state);
  if (expectedStateSha256 !== null) assert(typeof expectedStateSha256 === "string" && SHA256.test(expectedStateSha256), "Controller fixture expected digest is invalid");
  const current = readRaw(store.target);
  if (expectedStateSha256 === null) assert(current === null, "Controller fixture state already exists", "CONTROLLER_PROJECT_STORE_CAS_STALE");
  else assert(current?.state_sha256 === expectedStateSha256, "Controller fixture compare-and-swap parent is stale", "CONTROLLER_PROJECT_STORE_CAS_STALE");
  const held = lock(store.target, store.generation); let staged;
  try {
    const locked = readRaw(store.target);
    if (expectedStateSha256 === null) assert(locked === null, "Controller fixture state already exists", "CONTROLLER_PROJECT_STORE_CAS_STALE");
    else assert(locked?.state_sha256 === expectedStateSha256, "Controller fixture compare-and-swap parent is stale", "CONTROLLER_PROJECT_STORE_CAS_STALE");
    staged = `${store.target}.${held.fence}.stage`;
    fs.writeFileSync(staged, `${canonicalJson(state)}\n`, {flag: "wx", mode: 0o600}); fs.renameSync(staged, store.target); staged = undefined;
    const readback = readRaw(store.target); if (typeof validateState === "function") validateState(readback);
    assert(readback?.state_sha256 === state?.state_sha256, "Controller fixture durable readback differs", "CONTROLLER_PROJECT_STORE_READBACK_INVALID");
    return Object.freeze({state_sha256: readback.state_sha256, store_generation: store.generation});
  } finally {
    if (staged) { try { fs.unlinkSync(staged); } catch (error) { if (error.code !== "ENOENT") throw error; } }
    try { fs.unlinkSync(held.lockPath); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

export function inspectControllerProjectStoreForTest(capability) {
  const store = storeFor(capability), state = readRaw(store.target);
  return Object.freeze({schema: CONTROLLER_PROJECT_STORE_SCHEMA, version: 1, project_store_id: store.rootRecord.projectStoreId, attachment_generation: store.generation, state_present: state !== null, event_count: 0, event_head_sha256: "0".repeat(64)});
}
