import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import fs from "node:fs";
import path from "node:path";
import {MODEL_POLICY_ROLE_CLASSES, compileModelPolicyProjection, validateEcoModelRoute, validateModelPolicyProjection} from "./eco-model-policy.mjs";
import {assertProjectAgnosticGovernanceValue, readGlobalGovernanceMemory, replayGlobalGovernanceMemory, validateGlobalGovernanceMemoryReadback} from "./global-governance-memory.mjs";
import {assertSealedCanonicalAuthority} from "./sealed-canonical-authority.mjs";

export const GLOBAL_GOVERNANCE_BOOTSTRAP_SCHEMA = "agentos.global_governance_bootstrap.v1";
const SHA = /^[0-9a-f]{64}$/u;
const authorityStores = new WeakMap();
function assert(value, message, code = "GLOBAL_GOVERNANCE_BOOTSTRAP_INVALID") { if (!value) { const error = new Error(message); error.code = code; throw error; } }
function exact(value, keys, label) { assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`); assert(JSON.stringify(Object.keys(value).sort(compareUtf8)) === JSON.stringify([...keys].sort(compareUtf8)), `${label} fields mismatch`); }
function digestBody(value) { return {...structuredClone(value), bootstrap_sha256: null}; }

export function validateGlobalGovernanceBootstrap(envelope, {events, readback, ...forbiddenClockOverrides} = {}) {
  assert(Object.keys(forbiddenClockOverrides).length === 0, "Global governance trusted time cannot be supplied by a caller", "GLOBAL_MEMORY_TRUSTED_TIME_OVERRIDE");
  assertProjectAgnosticGovernanceValue(envelope, "global_governance_bootstrap");
  exact(envelope, ["schema", "version", "status", "read_only", "memory_readback_sha256", "snapshot_sha256", "observed_at_utc", "projections", "invalidation", "active_worker_refresh", "bootstrap_sha256"], "Global governance bootstrap");
  assert(envelope.schema === GLOBAL_GOVERNANCE_BOOTSTRAP_SCHEMA && envelope.version === 1 && envelope.status === "READY" && envelope.read_only === true, "Global governance bootstrap identity is invalid");
  validateGlobalGovernanceMemoryReadback(readback, {events});
  assert(readback.readback_sha256 === envelope.memory_readback_sha256, "Global governance bootstrap readback is stale");
  const replay = replayGlobalGovernanceMemory(events);
  assert(replay.status === "READY" && replay.current_snapshot.snapshot_sha256 === envelope.snapshot_sha256, "Global governance bootstrap snapshot is stale");
  assert(Array.isArray(envelope.projections) && envelope.projections.length === MODEL_POLICY_ROLE_CLASSES.length, "Global governance bootstrap role visibility is incomplete");
  const roleIds = envelope.projections.map((entry) => entry.role_class);
  assert(JSON.stringify(roleIds) === JSON.stringify(MODEL_POLICY_ROLE_CLASSES), "Global governance bootstrap role projection order/coverage differs");
  envelope.projections.forEach((projection) => validateModelPolicyProjection(projection, {snapshot: replay.current_snapshot, expectedRoleClass: projection.role_class, nowUtc: new Date().toISOString()}));
  assert(envelope.invalidation === "SNAPSHOT_CHANGE_INVALIDATES_DEPENDENT_CONTEXTS_AND_INERT_SEEDS", "Global governance bootstrap invalidation rule is incomplete");
  assert(envelope.active_worker_refresh === "BOUND_UNTIL_HANDOFF_OR_TYPED_SAFE_REFRESH", "Global governance active-worker binding is incomplete");
  assert(typeof envelope.memory_readback_sha256 === "string" && SHA.test(envelope.memory_readback_sha256), "Global governance bootstrap readback digest is invalid");
  assert(typeof envelope.bootstrap_sha256 === "string" && SHA.test(envelope.bootstrap_sha256) && envelope.bootstrap_sha256 === canonicalDigest(digestBody(envelope)), "Global governance bootstrap digest mismatch");
  return envelope;
}

export function compileGlobalGovernanceBootstrap({events, readback, workerRoute, seedRoute = workerRoute, observedAtUtc} = {}) {
  assert(observedAtUtc === undefined || observedAtUtc === readback?.observed_at_utc, "Global governance bootstrap time must be the canonical current readback time", "GLOBAL_MEMORY_TRUSTED_TIME_OVERRIDE");
  observedAtUtc = readback?.observed_at_utc;
  validateGlobalGovernanceMemoryReadback(readback, {events});
  const snapshot = replayGlobalGovernanceMemory(events).current_snapshot;
  validateEcoModelRoute(workerRoute, {snapshot}); validateEcoModelRoute(seedRoute, {snapshot});
  const projections = MODEL_POLICY_ROLE_CLASSES.map((roleClass) => compileModelPolicyProjection({
    snapshot, roleClass,
    selectedRoute: roleClass === "WORKING_AGENT" ? workerRoute : roleClass === "INERT_SEED" ? seedRoute : null,
    projectedAtUtc: observedAtUtc,
  }));
  const envelope = {
    schema: GLOBAL_GOVERNANCE_BOOTSTRAP_SCHEMA, version: 1, status: "READY", read_only: true,
    memory_readback_sha256: readback.readback_sha256, snapshot_sha256: snapshot.snapshot_sha256,
    observed_at_utc: observedAtUtc, projections,
    invalidation: "SNAPSHOT_CHANGE_INVALIDATES_DEPENDENT_CONTEXTS_AND_INERT_SEEDS",
    active_worker_refresh: "BOUND_UNTIL_HANDOFF_OR_TYPED_SAFE_REFRESH", bootstrap_sha256: null,
  };
  envelope.bootstrap_sha256 = canonicalDigest(digestBody(envelope));
  return validateGlobalGovernanceBootstrap(envelope, {events, readback});
}

export function requireGlobalGovernanceRoleProjection({bootstrap, events, readback, roleClass, observedAtUtc} = {}) {
  assert(observedAtUtc === undefined || observedAtUtc === readback?.observed_at_utc, "Global governance projection time must be the canonical current readback time", "GLOBAL_MEMORY_TRUSTED_TIME_OVERRIDE");
  validateGlobalGovernanceBootstrap(bootstrap, {events, readback});
  const projection = bootstrap.projections.find((entry) => entry.role_class === roleClass);
  assert(projection, `Global governance projection is missing for ${roleClass}`, "GLOBAL_POLICY_PROJECTION_MISSING");
  return Object.freeze(structuredClone(projection));
}

function canonicalStorePath(authorityRoot, relativePath) {
  assert(typeof authorityRoot === "string" && path.isAbsolute(authorityRoot), "Global governance authority root must be absolute");
  const target = path.resolve(authorityRoot, relativePath);
  assert(target.startsWith(`${path.resolve(authorityRoot)}${path.sep}`), "Global governance store path escaped its root");
  const stat = fs.lstatSync(target);
  assert(stat.isFile() && !stat.isSymbolicLink(), "Global governance store artifact must be a regular file");
  return target;
}

/* Internal bootstrap adapter. Deliberately omitted from the public AgentOS facade. */
export function openGlobalGovernanceAuthorityStore({sealedAuthority, authorityRoot, bootstrapSha256} = {}) {
  assertSealedCanonicalAuthority(sealedAuthority);
  assert(typeof authorityRoot === "string" && path.isAbsolute(authorityRoot), "Global governance authority root must be absolute");
  assert(typeof bootstrapSha256 === "string" && SHA.test(bootstrapSha256), "Global governance bootstrap reference is invalid");
  const realRoot = fs.realpathSync.native(authorityRoot);
  assert(fs.lstatSync(realRoot).isDirectory() && !fs.lstatSync(authorityRoot).isSymbolicLink(), "Global governance authority root must be a real non-symlink directory");
  const events = readGlobalGovernanceMemory({authorityRoot: realRoot});
  const readback = JSON.parse(fs.readFileSync(canonicalStorePath(realRoot, "global-governance/current-readback.v1.json"), "utf8"));
  const bootstrap = JSON.parse(fs.readFileSync(canonicalStorePath(realRoot, "global-governance/current-bootstrap.v1.json"), "utf8"));
  assert(bootstrap.bootstrap_sha256 === bootstrapSha256, "Global governance bootstrap reference is stale or aliased");
  validateGlobalGovernanceBootstrap(bootstrap, {events, readback});
  const capability = Object.freeze(Object.create(null));
  authorityStores.set(capability, Object.freeze({authorityRoot: realRoot, bootstrapSha256}));
  return capability;
}

export function resolveCanonicalGlobalGovernanceProjection(options = {}) {
  assert(options && typeof options === "object" && !Array.isArray(options) && Object.keys(options).every((key) => ["authorityStore", "roleClass"].includes(key)), "Caller-supplied global governance roots, authority objects, or clocks are forbidden", "SEALED_GLOBAL_AUTHORITY_REQUIRED");
  const {authorityStore, roleClass} = options;
  const sealedStore = authorityStores.get(authorityStore);
  assert(sealedStore, "A sealed global-governance authority capability is required", "SEALED_GLOBAL_AUTHORITY_REQUIRED");
  const {authorityRoot: sealedRoot, bootstrapSha256: sealedBootstrapSha256} = sealedStore;
  assert(typeof sealedBootstrapSha256 === "string" && SHA.test(sealedBootstrapSha256), "Global governance bootstrap reference is invalid");
  const events = readGlobalGovernanceMemory({authorityRoot: sealedRoot});
  const readback = JSON.parse(fs.readFileSync(canonicalStorePath(sealedRoot, "global-governance/current-readback.v1.json"), "utf8"));
  const bootstrap = JSON.parse(fs.readFileSync(canonicalStorePath(sealedRoot, "global-governance/current-bootstrap.v1.json"), "utf8"));
  assert(bootstrap.bootstrap_sha256 === sealedBootstrapSha256, "Global governance bootstrap reference is stale or aliased");
  const projection = requireGlobalGovernanceRoleProjection({bootstrap, events, readback, roleClass});
  const replay = replayGlobalGovernanceMemory(events);
  assert(projection.snapshot_sha256 === replay.current_snapshot.snapshot_sha256 && readback.live_ledger_head_sha256 === replay.head_sha256, "Global governance projection is not bound to the current memory head");
  return Object.freeze({projection, snapshot: replay.current_snapshot, ledger_head_sha256: replay.head_sha256, event_count: replay.event_count, readback_sha256: readback.readback_sha256, bootstrap_sha256: bootstrap.bootstrap_sha256, observed_at_utc: readback.observed_at_utc});
}

export function inspectGlobalGovernanceAuthorityStore(authorityStore) {
  const sealedStore = authorityStores.get(authorityStore);
  assert(sealedStore, "A sealed global-governance authority capability is required", "SEALED_GLOBAL_AUTHORITY_REQUIRED");
  return Object.freeze({bootstrap_sha256: sealedStore.bootstrapSha256});
}

/* Internal process bridge. It is intentionally omitted from the public AgentOS facade. */
export function globalGovernanceStoreProcessBridge(authorityStore) {
  const sealedStore = authorityStores.get(authorityStore);
  assert(sealedStore, "A sealed global-governance authority capability is required", "SEALED_GLOBAL_AUTHORITY_REQUIRED");
  return Object.freeze({authority_root: sealedStore.authorityRoot, bootstrap_sha256: sealedStore.bootstrapSha256});
}
