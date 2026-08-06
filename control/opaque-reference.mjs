import {assert, sha256} from "./canonical-json.mjs";

const RUNTIME = Symbol("agentos.runtime_identity");
const KIND = /^[a-z][a-z0-9_]{1,31}$/u;
const PREFIX = Object.freeze({
  thread: "THREAD_REF",
  host: "HOST_REF",
  session: "SESSION_REF",
  task: "task_ref",
  admission: "ADMISSION_REF",
});

function validateKind(kind) {
  assert(typeof kind === "string" && KIND.test(kind), "opaque reference kind is invalid");
  assert(PREFIX[kind], `opaque reference kind is unsupported: ${kind}`);
  return kind;
}

export function opaqueReference(kind, runtimeValue, binding = "") {
  validateKind(kind);
  assert(typeof runtimeValue === "string" && runtimeValue.length > 0, "opaque reference source is required");
  assert(typeof binding === "string", "opaque reference binding is invalid");
  return `${PREFIX[kind]}_${sha256({kind, runtimeValue, binding})}`;
}

export function sessionReference(runtimeValue, identity = {}) {
  assert(typeof runtimeValue === "string" && runtimeValue.length > 0, "session reference source is required");
  assert(identity && typeof identity === "object" && !Array.isArray(identity), "session reference identity is required");
  const binding = ["source_commit", "source_tree", "worktree_id", "goal_id", "environment_id"]
    .map((field) => `${field}=${identity[field] ?? ""}`)
    .join("|");
  return opaqueReference("session", runtimeValue, binding);
}

export function isOpaqueReference(value, kind = null) {
  if (typeof value !== "string") return false;
  if (kind !== null) {
    validateKind(kind);
    return value.startsWith(`${PREFIX[kind]}_`) && /^[A-Za-z][A-Za-z0-9_]*_[0-9a-f]{64}$/u.test(value);
  }
  return /^(?:THREAD_REF|HOST_REF|SESSION_REF|ADMISSION_REF|task_ref)_[0-9a-f]{64}$/u.test(value);
}

export function assertOpaqueReference(value, kind, label = "opaque reference") {
  assert(isOpaqueReference(value, kind), `${label} must be an opaque ${kind} reference`);
  return value;
}

export function bindRuntimeIdentity(record, identity) {
  assert(record && typeof record === "object" && !Array.isArray(record), "runtime-bound record is invalid");
  assert(identity && typeof identity === "object" && !Array.isArray(identity), "runtime identity is required");
  Object.defineProperty(record, RUNTIME, {value: Object.freeze({...identity}), enumerable: false, configurable: false, writable: false});
  return record;
}

export function getRuntimeIdentity(record) {
  assert(record && typeof record === "object" && record[RUNTIME], "runtime identity is unavailable; rebind the external host context");
  return record[RUNTIME];
}
