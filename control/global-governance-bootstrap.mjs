import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import fs from "node:fs";
import path from "node:path";
import {MODEL_POLICY_ROLE_CLASSES, compileModelPolicyProjection, validateEcoModelRoute, validateModelPolicyProjection} from "./eco-model-policy.mjs";
import {assertProjectAgnosticGovernanceValue, readGlobalGovernanceMemory, replayGlobalGovernanceMemory, validateGlobalGovernanceMemoryReadback} from "./global-governance-memory.mjs";

export const GLOBAL_GOVERNANCE_BOOTSTRAP_SCHEMA = "agentos.global_governance_bootstrap.v1";
const SHA = /^[0-9a-f]{64}$/u;
function assert(value, message, code = "GLOBAL_GOVERNANCE_BOOTSTRAP_INVALID") { if (!value) { const error = new Error(message); error.code = code; throw error; } }
function exact(value, keys, label) { assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`); assert(JSON.stringify(Object.keys(value).sort(compareUtf8)) === JSON.stringify([...keys].sort(compareUtf8)), `${label} fields mismatch`); }
function digestBody(value) { return {...structuredClone(value), bootstrap_sha256: null}; }

export function validateGlobalGovernanceBootstrap(envelope, {events, readback, observedAtUtc = envelope?.observed_at_utc} = {}) {
  assertProjectAgnosticGovernanceValue(envelope, "global_governance_bootstrap");
  exact(envelope, ["schema", "version", "status", "read_only", "memory_readback_sha256", "snapshot_sha256", "observed_at_utc", "projections", "invalidation", "active_worker_refresh", "bootstrap_sha256"], "Global governance bootstrap");
  assert(envelope.schema === GLOBAL_GOVERNANCE_BOOTSTRAP_SCHEMA && envelope.version === 1 && envelope.status === "READY" && envelope.read_only === true, "Global governance bootstrap identity is invalid");
  validateGlobalGovernanceMemoryReadback(readback, {events, observedAtUtc});
  assert(readback.readback_sha256 === envelope.memory_readback_sha256, "Global governance bootstrap readback is stale");
  const replay = replayGlobalGovernanceMemory(events, {observedAtUtc});
  assert(replay.status === "READY" && replay.current_snapshot.snapshot_sha256 === envelope.snapshot_sha256, "Global governance bootstrap snapshot is stale");
  assert(Array.isArray(envelope.projections) && envelope.projections.length === MODEL_POLICY_ROLE_CLASSES.length, "Global governance bootstrap role visibility is incomplete");
  const roleIds = envelope.projections.map((entry) => entry.role_class);
  assert(JSON.stringify(roleIds) === JSON.stringify(MODEL_POLICY_ROLE_CLASSES), "Global governance bootstrap role projection order/coverage differs");
  envelope.projections.forEach((projection) => validateModelPolicyProjection(projection, {snapshot: replay.current_snapshot, expectedRoleClass: projection.role_class, nowUtc: observedAtUtc}));
  assert(envelope.invalidation === "SNAPSHOT_CHANGE_INVALIDATES_DEPENDENT_CONTEXTS_AND_INERT_SEEDS", "Global governance bootstrap invalidation rule is incomplete");
  assert(envelope.active_worker_refresh === "BOUND_UNTIL_HANDOFF_OR_TYPED_SAFE_REFRESH", "Global governance active-worker binding is incomplete");
  assert(typeof envelope.memory_readback_sha256 === "string" && SHA.test(envelope.memory_readback_sha256), "Global governance bootstrap readback digest is invalid");
  assert(typeof envelope.bootstrap_sha256 === "string" && SHA.test(envelope.bootstrap_sha256) && envelope.bootstrap_sha256 === canonicalDigest(digestBody(envelope)), "Global governance bootstrap digest mismatch");
  return envelope;
}

export function compileGlobalGovernanceBootstrap({events, readback, workerRoute, seedRoute = workerRoute, observedAtUtc} = {}) {
  validateGlobalGovernanceMemoryReadback(readback, {events, observedAtUtc});
  const snapshot = replayGlobalGovernanceMemory(events, {observedAtUtc}).current_snapshot;
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
  return validateGlobalGovernanceBootstrap(envelope, {events, readback, observedAtUtc});
}

export function requireGlobalGovernanceRoleProjection({bootstrap, events, readback, roleClass, observedAtUtc} = {}) {
  validateGlobalGovernanceBootstrap(bootstrap, {events, readback, observedAtUtc});
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

export function resolveCanonicalGlobalGovernanceProjection({authorityRoot, bootstrapSha256, roleClass, observedAtUtc = null} = {}) {
  assert(typeof bootstrapSha256 === "string" && SHA.test(bootstrapSha256), "Global governance bootstrap reference is invalid");
  const events = readGlobalGovernanceMemory({authorityRoot});
  const readback = JSON.parse(fs.readFileSync(canonicalStorePath(authorityRoot, "global-governance/current-readback.v1.json"), "utf8"));
  const bootstrap = JSON.parse(fs.readFileSync(canonicalStorePath(authorityRoot, "global-governance/current-bootstrap.v1.json"), "utf8"));
  const effectiveObservedAtUtc = observedAtUtc ?? readback.observed_at_utc;
  assert(bootstrap.bootstrap_sha256 === bootstrapSha256, "Global governance bootstrap reference is stale or aliased");
  const projection = requireGlobalGovernanceRoleProjection({bootstrap, events, readback, roleClass, observedAtUtc: effectiveObservedAtUtc});
  const replay = replayGlobalGovernanceMemory(events, {observedAtUtc: effectiveObservedAtUtc});
  assert(projection.snapshot_sha256 === replay.current_snapshot.snapshot_sha256 && readback.live_ledger_head_sha256 === replay.head_sha256, "Global governance projection is not bound to the current memory head");
  return Object.freeze({projection, snapshot: replay.current_snapshot, ledger_head_sha256: replay.head_sha256, event_count: replay.event_count, readback_sha256: readback.readback_sha256, bootstrap_sha256: bootstrap.bootstrap_sha256, observed_at_utc: effectiveObservedAtUtc});
}
