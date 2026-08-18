import fs from "node:fs";
import path from "node:path";
import {canonicalDigest, canonicalJson, compareUtf8} from "./content-addressing.mjs";
import {MODEL_POLICY_ROLE_CLASSES} from "./eco-model-policy.mjs";
import {resolveCanonicalGlobalGovernanceProjection, resolveGlobalGovernanceStoreForMemoryAdapter} from "./global-governance-bootstrap.mjs";
import {GLOBAL_GOVERNANCE_MEMORY_WRITERS, readGlobalGovernanceMemory, replayGlobalGovernanceMemory} from "./global-governance-memory.mjs";

export const OPERATIONAL_GLOBAL_GOVERNANCE_CONTEXT_SCHEMA = "agentos.operational_global_governance_context.v1";
const SHA = /^[0-9a-f]{64}$/u;
const ID = /^[A-Z][A-Z0-9._:-]{0,191}$/u;
const issuedContexts = new WeakMap();
function assert(value, message, code = "OPERATIONAL_GLOBAL_GOVERNANCE_INVALID") { if (!value) { const error = new Error(message); error.code = code; throw error; } }
function exact(value, keys, label) { assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`); assert(JSON.stringify(Object.keys(value).sort(compareUtf8)) === JSON.stringify([...keys].sort(compareUtf8)), `${label} fields mismatch`); }
function body(value) { return {...structuredClone(value), context_sha256: null}; }

export function compileOperationalGlobalGovernanceContext({authorityStore, roleClass, operationalId} = {}) {
  assert(MODEL_POLICY_ROLE_CLASSES.includes(roleClass), "Operational role class is invalid");
  assert(typeof operationalId === "string" && ID.test(operationalId), "Operational context identity is invalid");
  const governed = resolveCanonicalGlobalGovernanceProjection({authorityStore, roleClass});
  const context = {
    schema: OPERATIONAL_GLOBAL_GOVERNANCE_CONTEXT_SCHEMA, version: 1, status: "READY", operational_id: operationalId,
    role_class: roleClass, read_only_projection: true, global_memory_write_capability: roleClass === "SPAWNER",
    ledger_head_sha256: governed.ledger_head_sha256, memory_readback_sha256: governed.readback_sha256,
    bootstrap_sha256: governed.bootstrap_sha256, snapshot_sha256: governed.snapshot.snapshot_sha256,
    projection_sha256: governed.projection.projection_sha256, compact_selection: governed.projection.selected,
    worker_binding_rule: roleClass === "WORKING_AGENT" ? "BOUND_UNTIL_HANDOFF_OR_TYPED_SAFE_REFRESH" : "CURRENT_HEAD_REQUIRED_BEFORE_WORK",
    context_sha256: null,
  };
  context.context_sha256 = canonicalDigest(body(context));
  issuedContexts.set(context, authorityStore);
  return Object.freeze(context);
}

export function assertOperationalGlobalGovernanceContext(context, {authorityStore, expectedRoleClass, activeWorker = false} = {}) {
  exact(context, ["schema", "version", "status", "operational_id", "role_class", "read_only_projection", "global_memory_write_capability", "ledger_head_sha256", "memory_readback_sha256", "bootstrap_sha256", "snapshot_sha256", "projection_sha256", "compact_selection", "worker_binding_rule", "context_sha256"], "Operational global-governance context");
  assert(issuedContexts.has(context), "Operational context was not constructed from canonical global governance memory");
  assert(context.schema === OPERATIONAL_GLOBAL_GOVERNANCE_CONTEXT_SCHEMA && context.version === 1 && context.status === "READY", "Operational context identity is invalid");
  assert(context.role_class === expectedRoleClass && context.read_only_projection === true, "Operational context role or projection authority differs");
  assert(context.global_memory_write_capability === (expectedRoleClass === "SPAWNER"), "Operational context global-memory writer authority differs");
  for (const field of ["ledger_head_sha256", "memory_readback_sha256", "bootstrap_sha256", "snapshot_sha256", "projection_sha256", "context_sha256"]) assert(typeof context[field] === "string" && SHA.test(context[field]), `Operational context ${field} is invalid`);
  assert(context.context_sha256 === canonicalDigest(body(context)), "Operational context digest mismatch");
  let governed;
  try { governed = resolveCanonicalGlobalGovernanceProjection({authorityStore, roleClass: expectedRoleClass}); }
  catch (error) {
    if (expectedRoleClass === "WORKING_AGENT" && activeWorker) return Object.freeze({status: "BOUND_UNTIL_HANDOFF", context});
    throw error;
  }
  const current = context.ledger_head_sha256 === governed.ledger_head_sha256 && context.snapshot_sha256 === governed.snapshot.snapshot_sha256 && context.projection_sha256 === governed.projection.projection_sha256;
  if (!current && expectedRoleClass === "WORKING_AGENT" && activeWorker) return Object.freeze({status: "BOUND_UNTIL_HANDOFF", context});
  assert(current, `${expectedRoleClass} operational context is stale and must be invalidated/rebuilt`, "OPERATIONAL_CONTEXT_STALE");
  return Object.freeze({status: "READY_FOR_WORK", context});
}

export function assertGlobalGovernanceWriterContext(context, {bootstrapSha256, expectedPriorHeadSha256} = {}) {
  exact(context, ["schema", "version", "status", "operational_id", "role_class", "read_only_projection", "global_memory_write_capability", "ledger_head_sha256", "memory_readback_sha256", "bootstrap_sha256", "snapshot_sha256", "projection_sha256", "compact_selection", "worker_binding_rule", "context_sha256"], "Global-governance writer context");
  assert(issuedContexts.has(context), "Global-governance writer context was not minted from canonical memory", "GLOBAL_MEMORY_WRITER_FORBIDDEN");
  assert(context.role_class === "SPAWNER" && context.global_memory_write_capability === true, "Only a canonical Spawner context can authorize global-memory writes", "GLOBAL_MEMORY_WRITER_FORBIDDEN");
  assert(context.bootstrap_sha256 === bootstrapSha256 && context.ledger_head_sha256 === expectedPriorHeadSha256, "Global-memory writer context is stale or bound to another bootstrap/head", "GLOBAL_MEMORY_WRITER_STALE");
  assert(context.context_sha256 === canonicalDigest(body(context)), "Global-memory writer context digest mismatch", "GLOBAL_MEMORY_WRITER_FORBIDDEN");
  return context;
}

export function appendAuthorizedGlobalGovernanceMemoryEvent(options = {}) {
  assert(options && typeof options === "object" && Object.keys(options).every((key) => ["expectedHeadSha256", "event", "writerContext"].includes(key)), "Global governance append accepts only a bound writer context and event", "GLOBAL_MEMORY_ROOT_CALLER_FORBIDDEN");
  const {expectedHeadSha256, event, writerContext} = options;
  const authorityStore = issuedContexts.get(writerContext);
  assert(authorityStore, "Global governance writer context is not bound to an authority store", "GLOBAL_MEMORY_WRITER_FORBIDDEN");
  const {authority_root: authorityRoot, bootstrap_sha256: bootstrapSha256, ledger_relative_path: relativePath} = resolveGlobalGovernanceStoreForMemoryAdapter(authorityStore);
  assertGlobalGovernanceWriterContext(writerContext, {bootstrapSha256, expectedPriorHeadSha256: event?.prior_event_sha256});
  assert(GLOBAL_GOVERNANCE_MEMORY_WRITERS.includes(event?.writer_role), "Global governance memory event writer is forbidden", "GLOBAL_MEMORY_WRITER_FORBIDDEN");
  assert(typeof authorityRoot === "string" && path.isAbsolute(authorityRoot), "Global governance memory root must be absolute");
  assert(typeof relativePath === "string" && !path.isAbsolute(relativePath) && !relativePath.split(/[\\/]/u).some((part) => part === ".." || part === ""), "Global governance memory path is unsafe");
  const target = path.resolve(authorityRoot, relativePath);
  assert(target.startsWith(`${path.resolve(authorityRoot)}${path.sep}`), "Global governance memory path escaped its root");
  fs.mkdirSync(path.dirname(target), {recursive: true});
  const lockPath = `${target}.lock`;
  const lock = {schema: "agentos.global_governance_memory_lock.v1", version: 1, process_id: process.pid, target_relative_path: relativePath, acquired_at_utc: new Date().toISOString(), fence_sha256: null};
  lock.fence_sha256 = canonicalDigest({...lock, fence_sha256: null});
  let lockFd;
  try {
    lockFd = fs.openSync(lockPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
    fs.writeFileSync(lockFd, `${canonicalJson(lock)}\n`); fs.fsyncSync(lockFd); fs.closeSync(lockFd); lockFd = undefined;
  } catch (error) {
    if (lockFd !== undefined) fs.closeSync(lockFd);
    if (error.code === "EEXIST") assert(false, "Global governance memory ledger is locked", "GLOBAL_MEMORY_LOCKED");
    throw error;
  }
  try {
    const events = readGlobalGovernanceMemory({authorityRoot, relativePath});
    const replay = replayGlobalGovernanceMemory(events);
    assert(replay.head_sha256 === expectedHeadSha256, "Global governance memory compare-and-swap head is stale", "GLOBAL_MEMORY_CAS_STALE");
    if (events.some((entry) => entry.event_sha256 === event.event_sha256)) return {status: "IDEMPOTENT", replay, fence_sha256: lock.fence_sha256};
    assert(event.sequence === events.length && event.prior_event_sha256 === replay.head_sha256, "Global governance memory append is not bound to the current head");
    const nextReplay = replayGlobalGovernanceMemory([...events, event]);
    const temporary = `${target}.tmp.${lock.fence_sha256}`;
    const descriptor = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
    try { fs.writeFileSync(descriptor, `${[...events, event].map((entry) => canonicalJson(entry)).join("\n")}\n`); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    fs.renameSync(temporary, target);
    const directoryFd = fs.openSync(path.dirname(target), fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY ?? 0));
    try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
    const readback = readGlobalGovernanceMemory({authorityRoot, relativePath});
    assert(readback.length === events.length + 1 && readback.at(-1).event_sha256 === event.event_sha256, "Global governance memory durable readback differs");
    return {status: "APPENDED", replay: nextReplay, fence_sha256: lock.fence_sha256};
  } finally {
    try { fs.unlinkSync(lockPath); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

export function compileAllOperationalGlobalGovernanceContexts({authorityStore} = {}) {
  return Object.freeze(Object.fromEntries(MODEL_POLICY_ROLE_CLASSES.map((roleClass) => [roleClass, compileOperationalGlobalGovernanceContext({authorityStore, roleClass, operationalId: `CONTEXT.${roleClass}.BOOTSTRAP`})])));
}
