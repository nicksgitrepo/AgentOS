import {canonicalDigest, canonicalJson, compareUtf8} from "./content-addressing.mjs";
import fs from "node:fs";
import path from "node:path";
import {createHmac, randomBytes, timingSafeEqual} from "node:crypto";
import {MODEL_POLICY_ROLE_CLASSES, compileModelPolicyProjection, selectEcoModelRoute, validateModelPolicyProjection} from "./eco-model-policy.mjs";
import {assertProjectAgnosticGovernanceValue, readGlobalGovernanceMemory, replayGlobalGovernanceMemory, validateGlobalGovernanceMemoryReadback} from "./global-governance-memory.mjs";
import {assertSealedCanonicalAuthority} from "./sealed-canonical-authority.mjs";
import {consumeInstalledGlobalGovernanceProvisioning} from "./installed-global-governance-provisioning.mjs";

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
  assert(envelope.observed_at_utc === readback.observed_at_utc, "Global governance bootstrap time differs from the current memory readback", "GLOBAL_MEMORY_TRUSTED_TIME_OVERRIDE");
  const replay = replayGlobalGovernanceMemory(events);
  assert(replay.status === "READY" && replay.current_snapshot.snapshot_sha256 === envelope.snapshot_sha256, "Global governance bootstrap snapshot is stale");
  assert(Array.isArray(envelope.projections) && envelope.projections.length === MODEL_POLICY_ROLE_CLASSES.length, "Global governance bootstrap role visibility is incomplete");
  const roleIds = envelope.projections.map((entry) => entry.role_class);
  assert(JSON.stringify(roleIds) === JSON.stringify(MODEL_POLICY_ROLE_CLASSES), "Global governance bootstrap role projection order/coverage differs");
  envelope.projections.forEach((projection) => {
    assert(projection.projected_at_utc === envelope.observed_at_utc, "Global governance projection time differs from the current memory readback", "POLICY_PROJECTION_TIME_INVALID");
    validateModelPolicyProjection(projection, {snapshot: replay.current_snapshot, expectedRoleClass: projection.role_class, nowUtc: new Date().toISOString()});
  });
  assert(envelope.invalidation === "SNAPSHOT_CHANGE_INVALIDATES_DEPENDENT_CONTEXTS_AND_INERT_SEEDS", "Global governance bootstrap invalidation rule is incomplete");
  assert(envelope.active_worker_refresh === "BOUND_UNTIL_HANDOFF_OR_TYPED_SAFE_REFRESH", "Global governance active-worker binding is incomplete");
  assert(typeof envelope.memory_readback_sha256 === "string" && SHA.test(envelope.memory_readback_sha256), "Global governance bootstrap readback digest is invalid");
  assert(typeof envelope.bootstrap_sha256 === "string" && SHA.test(envelope.bootstrap_sha256) && envelope.bootstrap_sha256 === canonicalDigest(digestBody(envelope)), "Global governance bootstrap digest mismatch");
  return envelope;
}

export function compileGlobalGovernanceBootstrap(options = {}) {
  assert(options && typeof options === "object" && !Array.isArray(options), "Global governance bootstrap input must be an object");
  assert(Object.keys(options).every((key) => ["events", "readback", "observedAtUtc"].includes(key)), "Caller-supplied model routes or bootstrap authority are forbidden", "GLOBAL_POLICY_ROUTE_CALLER_FORBIDDEN");
  let {events, readback, observedAtUtc} = options;
  assert(observedAtUtc === undefined || observedAtUtc === readback?.observed_at_utc, "Global governance bootstrap time must be the canonical current readback time", "GLOBAL_MEMORY_TRUSTED_TIME_OVERRIDE");
  observedAtUtc = readback?.observed_at_utc;
  validateGlobalGovernanceMemoryReadback(readback, {events});
  const snapshot = replayGlobalGovernanceMemory(events).current_snapshot;
  const workerRoute = selectEcoModelRoute({snapshot, taskClass: "NARROW_CODING", roleCapabilityFloor: 0, requiredContextTokens: 0, requiredCapabilities: [], nowUtc: observedAtUtc});
  const seedRoute = workerRoute;
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
export function openGlobalGovernanceAuthorityStore(options = {}) {
  assert(options && typeof options === "object" && Object.keys(options).every((key) => ["sealedAuthority", "storeProvisioning"].includes(key)), "Global-governance store accepts only a one-use Bootstrap provisioning capability", "GLOBAL_GOVERNANCE_ROOT_CALLER_FORBIDDEN");
  const {sealedAuthority, storeProvisioning} = options;
  assertSealedCanonicalAuthority(sealedAuthority);
  const {realRoot, bootstrapSha256} = consumeInstalledGlobalGovernanceProvisioning(storeProvisioning);
  const events = readGlobalGovernanceMemory({authorityRoot: realRoot});
  const readback = JSON.parse(fs.readFileSync(canonicalStorePath(realRoot, "global-governance/current-readback.v1.json"), "utf8"));
  const bootstrap = JSON.parse(fs.readFileSync(canonicalStorePath(realRoot, "global-governance/current-bootstrap.v1.json"), "utf8"));
  assert(bootstrap.bootstrap_sha256 === bootstrapSha256, "Global governance bootstrap reference is stale or aliased");
  validateGlobalGovernanceBootstrap(bootstrap, {events, readback});
  const capability = Object.freeze(Object.create(null));
  authorityStores.set(capability, Object.freeze({authorityRoot: realRoot, bootstrapSha256, ledgerRelativePath: "global-governance/model-policy-events.jsonl", memoryIdentity: canonicalDigest({schema: "agentos.global_governance_memory_identity.v1", bootstrap_sha256: bootstrapSha256, authority_root_readback_sha256: canonicalDigest({real_root: realRoot})}), processAttachmentKey: randomBytes(32)}));
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
export function resolveGlobalGovernanceStoreForMemoryAdapter(authorityStore) {
  const sealedStore = authorityStores.get(authorityStore);
  assert(sealedStore, "A sealed global-governance authority capability is required", "SEALED_GLOBAL_AUTHORITY_REQUIRED");
  return Object.freeze({authority_root: sealedStore.authorityRoot, bootstrap_sha256: sealedStore.bootstrapSha256, ledger_relative_path: sealedStore.ledgerRelativePath, memory_identity: sealedStore.memoryIdentity});
}

function attachmentMac(key, attachment) { return createHmac("sha256", key).update(JSON.stringify({...attachment, mac_sha256: null})).digest("hex"); }

export function issueGlobalGovernanceProcessAttachment({authorityStore, consumerRole} = {}) {
  const sealedStore = authorityStores.get(authorityStore);
  assert(sealedStore, "A sealed global-governance authority capability is required", "SEALED_GLOBAL_AUTHORITY_REQUIRED");
  assert(["SESSION", "WORKER"].includes(consumerRole), "Global-governance attachment consumer role is invalid");
  const attachment = {schema: "agentos.global_governance_process_attachment.v1", version: 1, issuer_process_id: process.pid, consumer_role: consumerRole, authority_root: sealedStore.authorityRoot, bootstrap_sha256: sealedStore.bootstrapSha256, memory_identity: sealedStore.memoryIdentity, nonce_sha256: canonicalDigest({pid: process.pid, role: consumerRole, random: randomBytes(32).toString("hex")}), mac_sha256: null};
  attachment.mac_sha256 = attachmentMac(sealedStore.processAttachmentKey, attachment);
  const attachmentDirectory = path.join(sealedStore.authorityRoot, "global-governance/process-attachments");
  fs.mkdirSync(attachmentDirectory, {recursive: true, mode: 0o700});
  const attachmentPath = path.join(attachmentDirectory, `${attachment.nonce_sha256}.issued.json`);
  const descriptor = fs.openSync(attachmentPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
  try { fs.writeFileSync(descriptor, `${canonicalJson(attachment)}\n`); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  return Object.freeze({attachment: Object.freeze(attachment), secret_base64: sealedStore.processAttachmentKey.toString("base64")});
}

export function reattachGlobalGovernanceAuthorityStore({sealedAuthority, attachment, secretBase64, expectedConsumerRole} = {}) {
  assertSealedCanonicalAuthority(sealedAuthority);
  assert(attachment?.schema === "agentos.global_governance_process_attachment.v1" && attachment.version === 1 && attachment.consumer_role === expectedConsumerRole, "Global-governance process attachment identity/role differs", "GLOBAL_GOVERNANCE_REATTACHMENT_INVALID");
  assert(attachment.issuer_process_id === process.ppid, "Global-governance process attachment was not issued by this process parent", "GLOBAL_GOVERNANCE_REATTACHMENT_INVALID");
  const key = Buffer.from(secretBase64 ?? "", "base64");
  assert(key.length === 32, "Global-governance process attachment secret is unavailable", "GLOBAL_GOVERNANCE_REATTACHMENT_INVALID");
  const expected = Buffer.from(attachmentMac(key, attachment), "hex"), actual = Buffer.from(attachment.mac_sha256 ?? "", "hex");
  assert(actual.length === expected.length && timingSafeEqual(actual, expected), "Global-governance process attachment MAC differs", "GLOBAL_GOVERNANCE_REATTACHMENT_INVALID");
  const realRoot = fs.realpathSync.native(attachment.authority_root);
  assert(realRoot === attachment.authority_root && fs.lstatSync(realRoot).isDirectory() && !fs.lstatSync(realRoot).isSymbolicLink(), "Global-governance attachment root is unsafe");
  const events = readGlobalGovernanceMemory({authorityRoot: realRoot});
  const readback = JSON.parse(fs.readFileSync(canonicalStorePath(realRoot, "global-governance/current-readback.v1.json"), "utf8"));
  const bootstrap = JSON.parse(fs.readFileSync(canonicalStorePath(realRoot, "global-governance/current-bootstrap.v1.json"), "utf8"));
  assert(bootstrap.bootstrap_sha256 === attachment.bootstrap_sha256, "Global-governance attachment bootstrap is stale");
  validateGlobalGovernanceBootstrap(bootstrap, {events, readback});
  const memoryIdentity = canonicalDigest({schema: "agentos.global_governance_memory_identity.v1", bootstrap_sha256: attachment.bootstrap_sha256, authority_root_readback_sha256: canonicalDigest({real_root: realRoot})});
  assert(memoryIdentity === attachment.memory_identity, "Global-governance attachment memory identity differs");
  const attachmentDirectory = path.join(realRoot, "global-governance/process-attachments");
  const issuedPath = path.join(attachmentDirectory, `${attachment.nonce_sha256}.issued.json`), consumedPath = path.join(attachmentDirectory, `${attachment.nonce_sha256}.consumed.json`);
  assert(fs.existsSync(issuedPath) && !fs.existsSync(consumedPath), "Global-governance process attachment is unknown or already consumed", "GLOBAL_GOVERNANCE_REATTACHMENT_REPLAY");
  const issued = JSON.parse(fs.readFileSync(issuedPath, "utf8"));
  assert(canonicalJson(issued) === canonicalJson(attachment), "Global-governance process attachment durable record differs");
  fs.renameSync(issuedPath, consumedPath);
  const capability = Object.freeze(Object.create(null));
  authorityStores.set(capability, Object.freeze({authorityRoot: realRoot, bootstrapSha256: attachment.bootstrap_sha256, ledgerRelativePath: "global-governance/model-policy-events.jsonl", memoryIdentity, processAttachmentKey: key}));
  return capability;
}
