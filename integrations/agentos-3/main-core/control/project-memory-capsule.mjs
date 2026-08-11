#!/usr/bin/env node

/*
 * Portable project-memory capsule envelope.
 *
 * The envelope carries the canonical memory ledger and optional derived
 * projections. Workspace paths, host bindings, secrets, and raw project
 * payloads never cross this boundary. Contract/governance/campaign/evidence
 * material is represented by opaque references until a project authority
 * supplies a stronger, independently verified transfer policy.
 */

import {
  assertPersistedRecordSafe,
  canonicalDigest,
  canonicalJson,
  compareUtf8,
} from "./content-addressing.mjs";
import {
  assert,
  requireEnum,
  replayMemoryLedger,
  validateBinding,
  validateMemoryLedger,
} from "./project-memory-records.mjs";
import {validateMemorySnapshot, validateRoleContextCapsule} from "./project-memory-projections.mjs";
import {CONTRACT_STATUS, CONTROL_SPACE, exactKeys, requireIdentifier, requireRecord, requireSha} from "./map-memory-common.mjs";

export const PROJECT_MEMORY_CAPSULE_ENVELOPE_SCHEMA = "agentos.project_memory_capsule.v1";
export const PROJECT_MEMORY_CAPSULE_VERSION = 1;
export const PROJECT_MEMORY_CAPSULE_IMPORT_SCHEMA = "agentos.project_memory_capsule_import.v1";

const CAPSULE_FIELDS = [
  "schema", "version", "contract_status", "visibility", "advisory_only", "acceptance_authority",
  "capsule_id", "binding", "events", "snapshot", "role_capsules", "artifact_refs", "capability_status",
  "status", "capsule_sha256",
];
const ARTIFACT_REF_FIELDS = ["artifact_kind", "artifact_sha256", "transfer_status"];
const CAPABILITY_FIELDS = ["status", "reason_code", "recovery_ref"];
const CAPABILITY_KEYS = ["ENCRYPTION", "SYNCHRONIZATION", "MIGRATION", "ROLLBACK"];
const ARTIFACT_KINDS = ["PROJECT_CONTRACT", "GOVERNANCE", "CAMPAIGN_HISTORY", "EVIDENCE_METADATA", "REGISTRATION"];
const ARTIFACT_TRANSFER_STATUSES = ["REFERENCE_ONLY"];
const CAPABILITY_STATUSES = ["UNAVAILABLE"];
const CAPSULE_STATUSES = ["PORTABLE_PARTIAL", "CONFLICT"];

function validateArtifactRefs(artifactRefs) {
  assert(Array.isArray(artifactRefs), "project-memory capsule artifact references must be an array");
  const normalized = artifactRefs.map((entry, index) => {
    exactKeys(entry, ARTIFACT_REF_FIELDS, `project-memory capsule artifact reference ${index}`);
    requireEnum(entry.artifact_kind, ARTIFACT_KINDS, `project-memory capsule artifact ${index} kind`);
    requireSha(entry.artifact_sha256, `project-memory capsule artifact ${index} digest`);
    requireEnum(entry.transfer_status, ARTIFACT_TRANSFER_STATUSES, `project-memory capsule artifact ${index} transfer status`);
    return entry;
  }).sort((left, right) => compareUtf8(
    `${left.artifact_kind}\u0000${left.artifact_sha256}`,
    `${right.artifact_kind}\u0000${right.artifact_sha256}`,
  ));
  assert(JSON.stringify(artifactRefs) === JSON.stringify(normalized), "project-memory capsule artifact references must be UTF-8 sorted");
  assert(new Set(artifactRefs.map((entry) => `${entry.artifact_kind}\u0000${entry.artifact_sha256}`)).size === artifactRefs.length, "project-memory capsule artifact references contain duplicates");
  return artifactRefs;
}

function defaultCapabilityStatus() {
  return Object.fromEntries(CAPABILITY_KEYS.map((key) => [key, {
    status: "UNAVAILABLE",
    reason_code: `NO_${key}_AUTHORITY`,
    recovery_ref: `BIND_${key}_POLICY_AND_INDEPENDENT_PROOF`,
  }]));
}

function validateCapabilityStatus(capabilityStatus) {
  exactKeys(capabilityStatus, CAPABILITY_KEYS, "project-memory capsule capability status");
  for (const key of CAPABILITY_KEYS) {
    const capability = capabilityStatus[key];
    exactKeys(capability, CAPABILITY_FIELDS, `project-memory capsule ${key} capability`);
    requireEnum(capability.status, CAPABILITY_STATUSES, `project-memory capsule ${key} status`);
    requireIdentifier(capability.reason_code, `project-memory capsule ${key} reason`);
    requireIdentifier(capability.recovery_ref, `project-memory capsule ${key} recovery`);
  }
  return capabilityStatus;
}

function validateCapsuleBinding(binding) {
  validateBinding(binding, "project-memory capsule binding");
  return binding;
}

export function compileProjectMemoryCapsule({
  capsuleId = null,
  binding,
  events,
  snapshot = null,
  roleCapsules = [],
  artifactRefs = [],
  capabilityStatus = defaultCapabilityStatus(),
}) {
  validateCapsuleBinding(binding);
  const ledger = validateMemoryLedger(events, {binding});
  const replay = replayMemoryLedger(events, {binding});
  if (snapshot !== null) {
    validateMemorySnapshot(snapshot, {binding});
    assert(snapshot.event_cursor === ledger.event_count, "project-memory capsule snapshot cursor does not cover the ledger");
    assert(snapshot.event_ledger_head_sha256 === ledger.head_sha256, "project-memory capsule snapshot head does not cover the ledger");
  }
  assert(Array.isArray(roleCapsules), "project-memory capsule role capsules must be an array");
  const sortedRoleCapsules = [...roleCapsules].sort((left, right) => compareUtf8(left.capsule_sha256, right.capsule_sha256));
  assert(JSON.stringify(roleCapsules) === JSON.stringify(sortedRoleCapsules), "project-memory capsule role capsules must be UTF-8 sorted");
  assert(new Set(roleCapsules.map((capsule) => capsule.capsule_sha256)).size === roleCapsules.length, "project-memory capsule role capsules contain duplicates");
  for (const [index, roleCapsule] of roleCapsules.entries()) {
    assert(snapshot !== null, `project-memory capsule role capsule ${index} requires a snapshot`);
    validateRoleContextCapsule(roleCapsule, {snapshot});
  }
  validateArtifactRefs(artifactRefs);
  validateCapabilityStatus(capabilityStatus);
  const status = replay.status === "CONFLICT" || roleCapsules.some((capsule) => capsule.status === "CONFLICT")
    ? "CONFLICT"
    : "PORTABLE_PARTIAL";
  const capsule = {
    schema: PROJECT_MEMORY_CAPSULE_ENVELOPE_SCHEMA,
    version: PROJECT_MEMORY_CAPSULE_VERSION,
    contract_status: CONTRACT_STATUS,
    visibility: CONTROL_SPACE,
    advisory_only: true,
    acceptance_authority: false,
    capsule_id: capsuleId ?? `PROJECT_MEMORY_CAPSULE_${canonicalDigest({binding, head: ledger.head_sha256})}`,
    binding: structuredClone(binding),
    events: structuredClone(events),
    snapshot: snapshot === null ? null : structuredClone(snapshot),
    role_capsules: structuredClone(roleCapsules),
    artifact_refs: structuredClone(artifactRefs),
    capability_status: structuredClone(capabilityStatus),
    status,
    capsule_sha256: null,
  };
  requireIdentifier(capsule.capsule_id, "project-memory capsule ID");
  capsule.capsule_sha256 = canonicalDigest({...capsule, capsule_sha256: null});
  assertPersistedRecordSafe(capsule);
  return validateProjectMemoryCapsule(capsule);
}

export function validateProjectMemoryCapsule(capsule) {
  requireRecord(capsule, "project-memory capsule");
  exactKeys(capsule, CAPSULE_FIELDS, "project-memory capsule");
  assert(capsule.schema === PROJECT_MEMORY_CAPSULE_ENVELOPE_SCHEMA, "project-memory capsule schema mismatch");
  assert(capsule.version === PROJECT_MEMORY_CAPSULE_VERSION, "project-memory capsule version mismatch");
  assert(capsule.contract_status === CONTRACT_STATUS, "project-memory capsule activation status is invalid");
  assert(capsule.visibility === CONTROL_SPACE, "project-memory capsule visibility is invalid");
  assert(capsule.advisory_only === true, "project-memory capsule must be advisory-only");
  assert(capsule.acceptance_authority === false, "project-memory capsule cannot be acceptance authority");
  requireIdentifier(capsule.capsule_id, "project-memory capsule ID");
  validateCapsuleBinding(capsule.binding);
  const ledger = validateMemoryLedger(capsule.events, {binding: capsule.binding});
  const replay = replayMemoryLedger(capsule.events, {binding: capsule.binding});
  if (capsule.snapshot !== null) {
    validateMemorySnapshot(capsule.snapshot, {binding: capsule.binding});
    assert(capsule.snapshot.event_cursor === ledger.event_count, "project-memory capsule snapshot cursor mismatch");
    assert(capsule.snapshot.event_ledger_head_sha256 === ledger.head_sha256, "project-memory capsule snapshot head mismatch");
  }
  assert(Array.isArray(capsule.role_capsules), "project-memory capsule role capsules are invalid");
  const roleCapsules = [...capsule.role_capsules].sort((left, right) => compareUtf8(left.capsule_sha256, right.capsule_sha256));
  assert(JSON.stringify(capsule.role_capsules) === JSON.stringify(roleCapsules), "project-memory capsule role capsules are not UTF-8 sorted");
  for (const [index, roleCapsule] of capsule.role_capsules.entries()) {
    assert(capsule.snapshot !== null, `project-memory capsule role capsule ${index} has no snapshot`);
    validateRoleContextCapsule(roleCapsule, {snapshot: capsule.snapshot});
  }
  validateArtifactRefs(capsule.artifact_refs);
  validateCapabilityStatus(capsule.capability_status);
  requireEnum(capsule.status, CAPSULE_STATUSES, "project-memory capsule status");
  const expectedStatus = replay.status === "CONFLICT" || capsule.role_capsules.some((roleCapsule) => roleCapsule.status === "CONFLICT")
    ? "CONFLICT"
    : "PORTABLE_PARTIAL";
  assert(capsule.status === expectedStatus, "project-memory capsule status does not match replay state");
  if (capsule.status === "CONFLICT") assert(
    replay.conflicts.length > 0
      || capsule.events.some((event) => event.record.record_type === "CONFLICT")
      || capsule.role_capsules.some((roleCapsule) => roleCapsule.status === "CONFLICT"),
    "conflict project-memory capsule lacks conflict evidence",
  );
  requireSha(capsule.capsule_sha256, "project-memory capsule digest");
  assert(capsule.capsule_sha256 === canonicalDigest({...capsule, capsule_sha256: null}), "project-memory capsule digest mismatch");
  assertPersistedRecordSafe(capsule);
  return capsule;
}

export function serializeProjectMemoryCapsule(capsule) {
  validateProjectMemoryCapsule(capsule);
  return `${canonicalJson(capsule)}\n`;
}

export function parseProjectMemoryCapsule(serialized) {
  assert(typeof serialized === "string" && serialized.trim().length > 0, "serialized project-memory capsule is required");
  let capsule;
  try {
    capsule = JSON.parse(serialized);
  } catch (error) {
    throw new Error("serialized project-memory capsule is not valid JSON", {cause: error});
  }
  return validateProjectMemoryCapsule(capsule);
}

export function prepareProjectMemoryCapsuleImport(capsule, {destinationBinding = null, ownerDecisionDigest = null} = {}) {
  validateProjectMemoryCapsule(capsule);
  if (ownerDecisionDigest !== null) requireSha(ownerDecisionDigest, "project-memory capsule import owner decision digest");
  const destination = destinationBinding === null ? structuredClone(capsule.binding) : structuredClone(destinationBinding);
  validateCapsuleBinding(destination);
  for (const key of ["project_ref", "campaign_ref", "goal_ref", "role_ref"]) {
    assert(destination[key] === capsule.binding[key], `project-memory capsule import scope mismatch at ${key}`);
  }
  const exactBinding = ["project_ref", "campaign_ref", "goal_ref", "role_ref", "source_commit", "source_tree", "source_snapshot_sha256", "policy_sha256", "handoff_sha256"]
    .every((key) => destination[key] === capsule.binding[key]);
  const result = {
    schema: PROJECT_MEMORY_CAPSULE_IMPORT_SCHEMA,
    version: PROJECT_MEMORY_CAPSULE_VERSION,
    status: exactBinding ? "READY_TO_REPLAY" : "RECONCILIATION_REQUIRED",
    capsule_id: capsule.capsule_id,
    source_capsule_sha256: capsule.capsule_sha256,
    destination_binding: destination,
    owner_decision_digest: ownerDecisionDigest,
    project_tree_touched: false,
    authority_write_required: true,
    next_action_ref: exactBinding ? "REPLAY_AND_COMPARE_BEFORE_CAS" : "OWNER_RECONCILE_SOURCE_AND_POLICY_BINDING",
    digest: null,
  };
  result.digest = canonicalDigest({...result, digest: null});
  assertPersistedRecordSafe(result);
  return result;
}

export const importProjectMemoryCapsule = prepareProjectMemoryCapsuleImport;
