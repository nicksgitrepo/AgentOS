#!/usr/bin/env node

/*
 * Lane-owned four-library governance compiler.
 *
 * This module is deliberately standalone. It does not modify Bootstrap,
 * Runtime, native adapters, or any shared registry. Every generated record is
 * content-addressed, and project-owned inputs are represented by explicit
 * parent digests plus append-only lineage.
 */

import crypto from "node:crypto";
import path from "node:path";

export const BASE_GENERAL_SCHEMA = "agentos.base_general_library.v1";
export const BASE_ROLE_SCHEMA = "agentos.base_role_library.v1";
export const PROJECT_GENERAL_SCHEMA = "agentos.project_general_library.v1";
export const GENERATED_PROJECT_ROLE_SCHEMA = "agentos.generated_project_role_library.v1";
export const GOVERNANCE_BINDING_SCHEMA = "agentos.governance_binding.v1";
export const GOVERNANCE_MIGRATION_SCHEMA = "agentos.governance_migration.v1";
export const GOVERNANCE_CONFLICT_SCHEMA = "agentos.governance_conflict.v1";
export const PROJECT_HISTORY_SCHEMA = "agentos.project_governance_history_entry.v1";

export const FOUR_LIBRARY_VERSION = 1;
export const GOVERNANCE_VERSION = "3.0";
export const BASE_GENERAL_KIND = "BASE_GENERAL";
export const BASE_ROLE_KIND = "BASE_ROLE";
export const PROJECT_GENERAL_KIND = "PROJECT_GENERAL";
export const GENERATED_PROJECT_ROLE_KIND = "GENERATED_PROJECT_ROLE";

export const LIBRARY_STATUSES = Object.freeze([
  "COMPILED",
  "INDEPENDENTLY_CHECKED",
  "OWNER_ACCEPTED",
  "PREPARED_NOT_ACTIVATED",
  "ACTIVE",
  "SUPERSEDED",
  "REJECTED",
  "BLOCKED",
]);

export const GOVERNANCE_UPDATE_MODES = Object.freeze([
  "KEEP_PROJECT_GOVERNANCE",
  "RESET_GOVERNANCE_CLEAN",
]);

export const FIXED_ROLE_IDS = Object.freeze([
  "CAMPAIGN_ORCHESTRATOR",
  "INDEPENDENT_AUDITOR",
  "INTENT_REGULATOR",
  "RUNTIME",
]);

export const FIXED_ROLE_KINDS = Object.freeze({
  CAMPAIGN_ORCHESTRATOR: "CAMPAIGN_ORCHESTRATOR",
  INDEPENDENT_AUDITOR: "INDEPENDENT_AUDITOR",
  INTENT_REGULATOR: "INTENT_REGULATOR",
  RUNTIME: "RUNTIME",
});

const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Z][A-Z0-9._:-]*$/u;
const SAFE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const LANE_IDENTIFIER = /^[A-Z][A-Z0-9._-]*$/u;
const CHAT_LINK_SCHEME = ["chat", "gpt", "-conversation"].join("");
const PRIVATE_TEXT = new RegExp(`(?:\\/Users\\/|\\\\Users\\\\|\\/home\\/|[A-Za-z]:\\\\|\\$[A-Z][A-Z0-9_]*|\\b(?:password|passwd|secret|credential|api[_ -]?key|access[_ -]?token|refresh[_ -]?token)\\s*[:=]|(?:${CHAT_LINK_SCHEME}|chat|file):\\/\\/|\\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\b)`, "iu");
const ABSOLUTE_PATH = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/u;
const HISTORY_EVENT_TYPES = Object.freeze([
  "CREATED",
  "SUPERSEDED",
  "REBASED",
  "PRESERVED",
  "RESET_ARCHIVED",
]);

const EXPECTED_OWNERSHIP = Object.freeze({
  [BASE_GENERAL_KIND]: Object.freeze({owner_role: "RELEASE_MAINTAINER", authoring_role: "RELEASE_COMPILER"}),
  [BASE_ROLE_KIND]: Object.freeze({owner_role: "RELEASE_MAINTAINER", authoring_role: "RELEASE_COMPILER"}),
  [PROJECT_GENERAL_KIND]: Object.freeze({owner_role: "PROJECT_OWNER", authoring_role: "INTENT_REGULATOR"}),
  [GENERATED_PROJECT_ROLE_KIND]: Object.freeze({owner_role: "GOVERNANCE_COMPILER", authoring_role: "GOVERNANCE_COMPILER"}),
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assert(condition, message) {
  if (!condition) throw new GovernanceValidationError(message);
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort(compareUtf8)
      .map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function digest(value) {
  return crypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function digestWithout(value, field) {
  const body = structuredClone(value);
  body[field] = null;
  return digest(body);
}

function exactKeys(value, expected, label) {
  assert(isRecord(value), `${label} must be an object`);
  const actual = Object.keys(value).sort(compareUtf8);
  const required = [...expected].sort(compareUtf8);
  assert(JSON.stringify(actual) === JSON.stringify(required), `${label} fields mismatch`);
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains control characters`);
}

function requireSafeToken(value, label) {
  requireString(value, label);
  assert(SAFE_TOKEN.test(value), `${label} is not a safe token`);
}

function requireIdentifier(value, label) {
  requireString(value, label);
  assert(IDENTIFIER.test(value), `${label} is not a stable identifier`);
}

function requireLaneIdentifier(value, label) {
  requireString(value, label);
  assert(LANE_IDENTIFIER.test(value), `${label} is not a stable lane identifier`);
}

function requireDigest(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256 digest`);
}

function requirePositiveInteger(value, label) {
  assert(Number.isSafeInteger(value) && value > 0, `${label} must be a positive integer`);
}

function sortedUniqueStrings(value, label, {allowEmpty = false} = {}) {
  assert(Array.isArray(value), `${label} must be an array`);
  if (!allowEmpty) assert(value.length > 0, `${label} must not be empty`);
  value.forEach((item) => requireString(item, `${label} item`));
  const sorted = [...value].sort(compareUtf8);
  assert(new Set(value).size === value.length, `${label} contains duplicates`);
  assert(JSON.stringify(value) === JSON.stringify(sorted), `${label} must be sorted and unique`);
  return value;
}

function assertPortable(value, label) {
  const text = JSON.stringify(value);
  assert(!PRIVATE_TEXT.test(text), `${label} contains private, secret, host, or session-bound content`);
}

function requireRelativePath(value, label) {
  requireString(value, label);
  assert(!ABSOLUTE_PATH.test(value), `${label} must be relative`);
  assert(value === value.replaceAll("\\", "/"), `${label} must use normalized forward slashes`);
  assert(!value.includes("\0"), `${label} contains a NUL byte`);
  const normalized = path.posix.normalize(value.replaceAll("\\", "/"));
  assert(normalized !== "." && normalized !== ".." && !normalized.startsWith("../") && !normalized.includes("/../"), `${label} escapes its control boundary`);
  assert(normalized === value.replaceAll("\\", "/"), `${label} must be normalized`);
  return value;
}

function validateStatus(value, label) {
  requireString(value, label);
  assert(LIBRARY_STATUSES.includes(value), `${label} is invalid`);
}

function validateLineage(value, label) {
  exactKeys(value, ["revision", "supersedes", "owner_decision_digest", "independent_check_digest"], label);
  requirePositiveInteger(value.revision, `${label}.revision`);
  if (value.supersedes !== null) requireDigest(value.supersedes, `${label}.supersedes`);
  if (value.owner_decision_digest !== null) requireDigest(value.owner_decision_digest, `${label}.owner_decision_digest`);
  if (value.independent_check_digest !== null) requireDigest(value.independent_check_digest, `${label}.independent_check_digest`);
}

function validateLifecycleEvidence(status, lineage, label) {
  const requiresIndependentCheck = [
    "INDEPENDENTLY_CHECKED",
    "OWNER_ACCEPTED",
    "PREPARED_NOT_ACTIVATED",
    "ACTIVE",
    "SUPERSEDED",
  ].includes(status);
  const requiresOwnerDecision = [
    "OWNER_ACCEPTED",
    "PREPARED_NOT_ACTIVATED",
    "ACTIVE",
    "SUPERSEDED",
  ].includes(status);
  if (status === "COMPILED") {
    assert(lineage.owner_decision_digest === null, `${label}.compiled record must not carry owner decision evidence`);
    assert(lineage.independent_check_digest === null, `${label}.compiled record must not carry independent check evidence`);
  }
  if (requiresIndependentCheck) requireDigest(lineage.independent_check_digest, `${label}.independent_check_digest`);
  if (requiresOwnerDecision) requireDigest(lineage.owner_decision_digest, `${label}.owner_decision_digest`);
}

function validateOwnership(value, label) {
  exactKeys(value, ["owner_role", "authoring_role"], label);
  requireIdentifier(value.owner_role, `${label}.owner_role`);
  requireIdentifier(value.authoring_role, `${label}.authoring_role`);
}

function validateReleaseIdentity(value, label) {
  exactKeys(value, ["version", "source_commit", "source_tree", "release_digest"], label);
  requireSafeToken(value.version, `${label}.version`);
  requireSafeToken(value.source_commit, `${label}.source_commit`);
  requireSafeToken(value.source_tree, `${label}.source_tree`);
  requireDigest(value.release_digest, `${label}.release_digest`);
}

function validateSourceDigests(value, expected, label) {
  exactKeys(value, expected, label);
  for (const field of expected) requireDigest(value[field], `${label}.${field}`);
}

function validateGraphBinding(value, label, {project = false} = {}) {
  exactKeys(value, ["graph_id", "path_ref", "graph_sha256", "domain", "precedence_class"], label);
  requireIdentifier(value.graph_id, `${label}.graph_id`);
  requireRelativePath(value.path_ref, `${label}.path_ref`);
  requireDigest(value.graph_sha256, `${label}.graph_sha256`);
  requireIdentifier(value.domain, `${label}.domain`);
  requireIdentifier(value.precedence_class, `${label}.precedence_class`);
  if (project) assert(value.precedence_class === "PROJECT_ADDITIVE", `${label}.precedence_class must be PROJECT_ADDITIVE`);
}

function validateGraphBindings(value, label, options = {}) {
  assert(Array.isArray(value) && value.length > 0, `${label} must not be empty`);
  value.forEach((binding, index) => validateGraphBinding(binding, `${label}[${index}]`, options));
  const ids = value.map((binding) => binding.graph_id);
  sortedUniqueStrings(ids, `${label} graph IDs`);
  assert(new Set(value.map((binding) => binding.path_ref)).size === value.length, `${label} paths are duplicated`);
}

function graphNamespaceCollisions(leftBindings, rightBindings) {
  const rightIds = new Set(rightBindings.map((binding) => binding.graph_id));
  const rightPaths = new Set(rightBindings.map((binding) => binding.path_ref));
  return {
    graphIds: [...new Set(leftBindings.filter((binding) => rightIds.has(binding.graph_id)).map((binding) => binding.graph_id))].sort(compareUtf8),
    paths: [...new Set(leftBindings.filter((binding) => rightPaths.has(binding.path_ref)).map((binding) => binding.path_ref))].sort(compareUtf8),
  };
}

function validateRoleAuthority(value, label, {allowEmptyEvidence = true} = {}) {
  exactKeys(value, ["allowed_authority", "prohibited_authority", "required_evidence"], label);
  sortedUniqueStrings(value.allowed_authority, `${label}.allowed_authority`);
  sortedUniqueStrings(value.prohibited_authority, `${label}.prohibited_authority`);
  sortedUniqueStrings(value.required_evidence, `${label}.required_evidence`, {allowEmpty: allowEmptyEvidence});
}

function validatePacketDigest(value, label) {
  requireDigest(value.digest, `${label}.digest`);
  assert(value.digest === digestWithout(value, "digest"), `${label}.digest does not match content`);
}

function makeLineage(previous = null) {
  if (previous === null) {
    return {
      revision: 1,
      supersedes: null,
      owner_decision_digest: null,
      independent_check_digest: null,
    };
  }
  return {
    revision: previous.lineage.revision + 1,
    supersedes: previous.digest,
    owner_decision_digest: null,
    independent_check_digest: null,
  };
}

function validatePrevious(previous, validator, label) {
  if (previous === null) return;
  assert(isRecord(previous), `${label} must be an object`);
  validator(previous);
}

function roleSort(left, right) {
  return compareUtf8(`${left.role_id}:${left.lane_id ?? ""}`, `${right.role_id}:${right.lane_id ?? ""}`);
}

function graphIds(record) {
  return record.map((binding) => binding.graph_id);
}

function roleIds(rolePackets) {
  return rolePackets.map((packet) => packet.role_id);
}

function rolePacketKey(packet) {
  return `${packet.role_id}:${packet.lane_id ?? ""}`;
}

function rolePacketById(roleLibrary, roleId) {
  return roleLibrary.role_packets.find((packet) => packet.role_id === roleId) ?? null;
}

function commonLibraryKeys() {
  return ["schema", "version", "status", "library_kind", "governance_version", "ownership", "lineage", "digest"];
}

function validateCommonLibrary(value, schema, kind, label) {
  for (const key of commonLibraryKeys()) assert(Object.hasOwn(value, key), `${label} is missing ${key}`);
  assert(value.schema === schema && value.version === FOUR_LIBRARY_VERSION, `${label} identity is invalid`);
  assert(value.library_kind === kind && value.governance_version === GOVERNANCE_VERSION, `${label} kind or governance version is invalid`);
  validateStatus(value.status, `${label}.status`);
  validateOwnership(value.ownership, `${label}.ownership`);
  validateLineage(value.lineage, `${label}.lineage`);
  validateLifecycleEvidence(value.status, value.lineage, label);
  validatePacketDigest(value, label);
  assertPortable(value, label);
}

function validateExpectedOwnership(value, kind, label) {
  const expected = EXPECTED_OWNERSHIP[kind];
  assert(expected !== undefined, `${label} has no ownership policy`);
  assert(value.ownership.owner_role === expected.owner_role, `${label}.ownership.owner_role is not authorized for ${kind}`);
  assert(value.ownership.authoring_role === expected.authoring_role, `${label}.ownership.authoring_role is not authorized for ${kind}`);
}

function validateBaseRolePacket(packet, label, {baseGraphIds = null, roleGraphBindings, roleIds: knownRoleIds = null} = {}) {
  exactKeys(packet, [
    "role_id", "display_name", "role_kind", "lifetime", "lane_id", "graph_ids",
    "allowed_authority", "prohibited_authority", "required_evidence", "digest",
  ], label);
  requireIdentifier(packet.role_id, `${label}.role_id`);
  requireString(packet.display_name, `${label}.display_name`);
  assert(!PRIVATE_TEXT.test(packet.display_name), `${label}.display_name contains forbidden content`);
  requireString(packet.role_kind, `${label}.role_kind`);
  requireString(packet.lifetime, `${label}.lifetime`);
  if (packet.role_kind === "NAMED_LANE_WORKER") {
    assert(packet.lifetime === "CAMPAIGN", `${label}.worker lifetime must be CAMPAIGN`);
    assert(packet.lane_id !== null, `${label}.worker lane is missing`);
    requireLaneIdentifier(packet.lane_id, `${label}.lane_id`);
    assert(packet.role_id === `WORKER_${packet.lane_id}`, `${label}.worker role ID is not lane-bound`);
  } else {
    assert(FIXED_ROLE_IDS.includes(packet.role_id), `${label}.fixed role is not admitted`);
    assert(packet.lane_id === null, `${label}.fixed role carries a lane`);
    assert(packet.role_kind === FIXED_ROLE_KINDS[packet.role_id], `${label}.fixed role kind is invalid`);
    assert(packet.lifetime === "CAMPAIGN" || packet.lifetime === "PERSISTENT", `${label}.lifetime is invalid`);
  }
  if (knownRoleIds !== null) assert(!knownRoleIds.has(packet.role_id), `${label}.role_id is duplicated`);
  sortedUniqueStrings(packet.graph_ids, `${label}.graph_ids`);
  validateRoleAuthority({
    allowed_authority: packet.allowed_authority,
    prohibited_authority: packet.prohibited_authority,
    required_evidence: packet.required_evidence,
  }, label);
  if (baseGraphIds !== null) {
    const allowedGraphIds = new Set([...baseGraphIds, ...roleGraphBindings.map((binding) => binding.graph_id)]);
    packet.graph_ids.forEach((graphId) => assert(allowedGraphIds.has(graphId), `${label}.graph_ids contains an unbound graph: ${graphId}`));
  }
  if (packet.role_kind === "NAMED_LANE_WORKER") {
    const laneGraphs = roleGraphBindings.filter((binding) => binding.scope_role_id === packet.role_id);
    assert(laneGraphs.length === 1, `${label} has no unique lane graph binding`);
    assert(packet.graph_ids.includes(laneGraphs[0].graph_id), `${label} omits its lane graph`);
  }
  validatePacketDigest(packet, label);
}

function validateRoleGraphBinding(value, label, roleIdsSet) {
  exactKeys(value, ["graph_id", "path_ref", "graph_sha256", "scope_role_id", "lane_id"], label);
  requireIdentifier(value.graph_id, `${label}.graph_id`);
  requireRelativePath(value.path_ref, `${label}.path_ref`);
  requireDigest(value.graph_sha256, `${label}.graph_sha256`);
  requireIdentifier(value.scope_role_id, `${label}.scope_role_id`);
  assert(value.scope_role_id === "ALL_ROLES" || roleIdsSet.has(value.scope_role_id), `${label}.scope_role_id is not a known role`);
  if (value.scope_role_id.startsWith("WORKER_")) {
    assert(value.lane_id !== null, `${label}.lane_id is required for a worker graph`);
    requireLaneIdentifier(value.lane_id, `${label}.lane_id`);
    assert(value.scope_role_id === `WORKER_${value.lane_id}`, `${label}.lane_id does not match scope role`);
  } else {
    assert(value.lane_id === null, `${label}.lane_id is only valid for workers`);
  }
}

function validateProjectOverlay(value, label, knownRoleIds) {
  exactKeys(value, ["role_id", "graph_ids", "additional_prohibited_authority", "additional_required_evidence"], label);
  requireIdentifier(value.role_id, `${label}.role_id`);
  assert(value.role_id === "ALL_ROLES" || knownRoleIds === null || knownRoleIds.has(value.role_id), `${label}.role_id is not a base role`);
  sortedUniqueStrings(value.graph_ids, `${label}.graph_ids`, {allowEmpty: true});
  sortedUniqueStrings(value.additional_prohibited_authority, `${label}.additional_prohibited_authority`, {allowEmpty: true});
  sortedUniqueStrings(value.additional_required_evidence, `${label}.additional_required_evidence`, {allowEmpty: true});
}

function validateCompositionPolicy(value, label) {
  exactKeys(value, ["mode", "base_override", "graph_id_collision", "authority_expansion", "duplicate_overlay_policy"], label);
  assert(value.mode === "ADDITIVE_ONLY", `${label}.mode must be ADDITIVE_ONLY`);
  assert(value.base_override === "REJECT", `${label}.base_override must be REJECT`);
  assert(value.graph_id_collision === "REJECT", `${label}.graph_id_collision must be REJECT`);
  assert(value.authority_expansion === "REJECT", `${label}.authority_expansion must be REJECT`);
  assert(value.duplicate_overlay_policy === "REJECT_UNLESS_IDENTICAL", `${label}.duplicate_overlay_policy is invalid`);
}

function validateMigrationConflicts(value, label) {
  assert(Array.isArray(value), `${label} must be an array`);
  value.forEach((conflict, index) => validateConflictRecord(conflict, `${label}[${index}]`));
}

export class GovernanceValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "GovernanceValidationError";
  }
}

export class GovernanceConflictError extends GovernanceValidationError {
  constructor(record) {
    super(`${record.conflict_code}: ${record.resolution}`);
    this.name = "GovernanceConflictError";
    this.conflict = record;
    this.code = record.conflict_code;
  }
}

export function makeGovernanceConflict({
  conflict_code,
  severity = "HARD_STOP",
  affected_library,
  project_id = null,
  left_digest = null,
  right_digest = null,
  resolution = "OWNER_REVIEW_REQUIRED",
} = {}) {
  requireIdentifier(conflict_code, "conflict_code");
  requireString(severity, "conflict severity");
  requireIdentifier(affected_library, "affected_library");
  if (project_id !== null) requireIdentifier(project_id, "conflict project_id");
  if (left_digest !== null) requireDigest(left_digest, "conflict left_digest");
  if (right_digest !== null) requireDigest(right_digest, "conflict right_digest");
  requireString(resolution, "conflict resolution");
  const record = {
    schema: GOVERNANCE_CONFLICT_SCHEMA,
    version: FOUR_LIBRARY_VERSION,
    status: "BLOCKED",
    conflict_code,
    severity,
    affected_library,
    project_id,
    left_digest,
    right_digest,
    resolution,
    digest: null,
  };
  record.digest = digestWithout(record, "digest");
  return validateConflictRecord(record, "governance conflict");
}

export function validateConflictRecord(value, label = "governance conflict") {
  exactKeys(value, [
    "schema", "version", "status", "conflict_code", "severity", "affected_library", "project_id",
    "left_digest", "right_digest", "resolution", "digest",
  ], label);
  assert(value.schema === GOVERNANCE_CONFLICT_SCHEMA && value.version === FOUR_LIBRARY_VERSION && value.status === "BLOCKED", `${label} identity is invalid`);
  requireIdentifier(value.conflict_code, `${label}.conflict_code`);
  requireString(value.severity, `${label}.severity`);
  requireIdentifier(value.affected_library, `${label}.affected_library`);
  if (value.project_id !== null) requireIdentifier(value.project_id, `${label}.project_id`);
  if (value.left_digest !== null) requireDigest(value.left_digest, `${label}.left_digest`);
  if (value.right_digest !== null) requireDigest(value.right_digest, `${label}.right_digest`);
  requireString(value.resolution, `${label}.resolution`);
  validatePacketDigest(value, label);
  assertPortable(value, label);
  return value;
}

function failConflict(options) {
  throw new GovernanceConflictError(makeGovernanceConflict(options));
}

export function validateBaseGeneralLibrary(value) {
  exactKeys(value, [
    "schema", "version", "status", "library_kind", "governance_version", "ownership", "lineage",
    "release_identity", "source", "general_graph_bindings", "compatibility", "digest",
  ], "base general library");
  validateCommonLibrary(value, BASE_GENERAL_SCHEMA, BASE_GENERAL_KIND, "base general library");
  validateExpectedOwnership(value, BASE_GENERAL_KIND, "base general library");
  validateReleaseIdentity(value.release_identity, "base general library.release_identity");
  validateSourceDigests(value.source, ["general_manifest_digest", "question_catalog_digest", "coverage_manifest_digest"], "base general library.source");
  validateGraphBindings(value.general_graph_bindings, "base general library.general_graph_bindings");
  exactKeys(value.compatibility, ["base_role_schema", "project_general_schema", "generated_project_role_schema"], "base general library.compatibility");
  for (const field of Object.keys(value.compatibility)) requireString(value.compatibility[field], `base general library.compatibility.${field}`);
  assert(value.compatibility.base_role_schema === BASE_ROLE_SCHEMA, "base general library base-role schema binding is invalid");
  assert(value.compatibility.project_general_schema === PROJECT_GENERAL_SCHEMA, "base general library project schema binding is invalid");
  assert(value.compatibility.generated_project_role_schema === GENERATED_PROJECT_ROLE_SCHEMA, "base general library generated-role schema binding is invalid");
  return value;
}

export function compileBaseGeneralLibrary({release_identity, source, general_graph_bindings, previous = null} = {}) {
  validateReleaseIdentity(release_identity, "base general release_identity");
  validateSourceDigests(source, ["general_manifest_digest", "question_catalog_digest", "coverage_manifest_digest"], "base general source");
  validateGraphBindings(general_graph_bindings, "base general graph bindings");
  validatePrevious(previous, validateBaseGeneralLibrary, "base general previous record");
  const library = {
    schema: BASE_GENERAL_SCHEMA,
    version: FOUR_LIBRARY_VERSION,
    status: "COMPILED",
    library_kind: BASE_GENERAL_KIND,
    governance_version: GOVERNANCE_VERSION,
    ownership: {owner_role: "RELEASE_MAINTAINER", authoring_role: "RELEASE_COMPILER"},
    lineage: makeLineage(previous),
    release_identity: structuredClone(release_identity),
    source: structuredClone(source),
    general_graph_bindings: structuredClone(general_graph_bindings).sort((left, right) => compareUtf8(left.graph_id, right.graph_id)),
    compatibility: {
      base_role_schema: BASE_ROLE_SCHEMA,
      project_general_schema: PROJECT_GENERAL_SCHEMA,
      generated_project_role_schema: GENERATED_PROJECT_ROLE_SCHEMA,
    },
    digest: null,
  };
  library.digest = digestWithout(library, "digest");
  return validateBaseGeneralLibrary(library);
}

export function validateBaseRoleLibrary(value, {baseGeneralLibrary = null} = {}) {
  exactKeys(value, [
    "schema", "version", "status", "library_kind", "governance_version", "ownership", "lineage",
    "base_general_library_digest", "source", "role_graph_bindings", "role_packets", "digest",
  ], "base role library");
  validateCommonLibrary(value, BASE_ROLE_SCHEMA, BASE_ROLE_KIND, "base role library");
  validateExpectedOwnership(value, BASE_ROLE_KIND, "base role library");
  requireDigest(value.base_general_library_digest, "base role library.base_general_library_digest");
  if (baseGeneralLibrary !== null) {
    validateBaseGeneralLibrary(baseGeneralLibrary);
    assert(value.base_general_library_digest === baseGeneralLibrary.digest, "base role library parent differs");
  }
  validateSourceDigests(value.source, ["lane_manifest_digest", "role_selection_digest", "role_definition_source_digest"], "base role library.source");
  assert(Array.isArray(value.role_graph_bindings) && value.role_graph_bindings.length > 0, "base role library.role_graph_bindings must not be empty");
  const packetRoleIds = new Set((value.role_packets ?? []).map((packet) => packet.role_id));
  value.role_graph_bindings.forEach((binding, index) => validateRoleGraphBinding(binding, `base role library.role_graph_bindings[${index}]`, packetRoleIds));
  if (baseGeneralLibrary !== null) {
    const collisions = graphNamespaceCollisions(value.role_graph_bindings, baseGeneralLibrary.general_graph_bindings);
    assert(collisions.graphIds.length === 0, `base role graph ID collides with base general governance: ${collisions.graphIds[0]}`);
    assert(collisions.paths.length === 0, `base role graph path collides with base general governance: ${collisions.paths[0]}`);
  }
  const roleGraphIds = value.role_graph_bindings.map((binding) => binding.graph_id);
  sortedUniqueStrings(roleGraphIds, "base role library role graph IDs");
  assert(JSON.stringify(value.role_graph_bindings) === JSON.stringify([...value.role_graph_bindings].sort((left, right) => compareUtf8(left.graph_id, right.graph_id))), "base role graph bindings must be sorted");
  assert(Array.isArray(value.role_packets) && value.role_packets.length > 0, "base role library.role_packets must not be empty");
  const roleIds = new Set();
  value.role_packets.forEach((packet, index) => {
    validateBaseRolePacket(packet, `base role library.role_packets[${index}]`, {
      baseGraphIds: baseGeneralLibrary === null ? null : graphIds(baseGeneralLibrary.general_graph_bindings),
      roleGraphBindings: value.role_graph_bindings,
      roleIds,
    });
    roleIds.add(packet.role_id);
  });
  const fixed = value.role_packets.filter((packet) => packet.role_kind !== "NAMED_LANE_WORKER").map((packet) => packet.role_id).sort(compareUtf8);
  assert(JSON.stringify(fixed) === JSON.stringify([...FIXED_ROLE_IDS].sort(compareUtf8)), "base role library fixed role inventory is incomplete or duplicated");
  assert(value.role_packets.some((packet) => packet.role_kind === "NAMED_LANE_WORKER"), "base role library has no named lane worker");
  assert(JSON.stringify(value.role_packets) === JSON.stringify([...value.role_packets].sort(roleSort)), "base role library role packets must be sorted");
  return value;
}

export function compileBaseRoleLibrary({
  baseGeneralLibrary,
  source,
  role_graph_bindings,
  role_definitions,
  previous = null,
} = {}) {
  validateBaseGeneralLibrary(baseGeneralLibrary);
  validateSourceDigests(source, ["lane_manifest_digest", "role_selection_digest", "role_definition_source_digest"], "base role source");
  assert(Array.isArray(role_graph_bindings) && role_graph_bindings.length > 0, "base role graph bindings must not be empty");
  assert(Array.isArray(role_definitions) && role_definitions.length > 0, "base role definitions must not be empty");
  validatePrevious(previous, (record) => validateBaseRoleLibrary(record, {baseGeneralLibrary}), "base role previous record");
  const roleIds = new Set(role_definitions.map((role) => role.role_id));
  assert(roleIds.size === role_definitions.length, "base role definitions contain duplicate role IDs");
  role_graph_bindings.forEach((binding, index) => validateRoleGraphBinding(binding, `base role graph binding ${index}`, roleIds));
  const baseGraphIds = new Set(graphIds(baseGeneralLibrary.general_graph_bindings));
  const roleGraphIds = new Set(role_graph_bindings.map((binding) => binding.graph_id));
  roleGraphIds.forEach((graphId) => {
    if (baseGraphIds.has(graphId)) failConflict({
      conflict_code: "BASE_ROLE_GRAPH_COLLISION",
      affected_library: BASE_ROLE_KIND,
      left_digest: baseGeneralLibrary.digest,
      resolution: `RELEASE_ROLE_GRAPH_MUST_USE_A_DISJOINT_ID:${graphId}`,
    });
  });
  const baseNamespaceCollisions = graphNamespaceCollisions(role_graph_bindings, baseGeneralLibrary.general_graph_bindings);
  if (baseNamespaceCollisions.paths.length > 0) failConflict({
    conflict_code: "BASE_ROLE_GRAPH_PATH_COLLISION",
    affected_library: BASE_ROLE_KIND,
    left_digest: baseGeneralLibrary.digest,
    resolution: `RELEASE_ROLE_GRAPH_MUST_USE_A_DISJOINT_PATH:${baseNamespaceCollisions.paths[0]}`,
  });
  const packets = role_definitions.map((definition, index) => {
    exactKeys(definition, [
      "role_id", "display_name", "role_kind", "lifetime", "lane_id", "graph_ids",
      "allowed_authority", "prohibited_authority", "required_evidence",
    ], `base role definition ${index}`);
    const packet = {...structuredClone(definition), digest: null};
    packet.digest = digestWithout(packet, "digest");
    return packet;
  }).sort(roleSort);
  const library = {
    schema: BASE_ROLE_SCHEMA,
    version: FOUR_LIBRARY_VERSION,
    status: "COMPILED",
    library_kind: BASE_ROLE_KIND,
    governance_version: GOVERNANCE_VERSION,
    ownership: {owner_role: "RELEASE_MAINTAINER", authoring_role: "RELEASE_COMPILER"},
    lineage: makeLineage(previous),
    base_general_library_digest: baseGeneralLibrary.digest,
    source: structuredClone(source),
    role_graph_bindings: structuredClone(role_graph_bindings).sort((left, right) => compareUtf8(left.graph_id, right.graph_id)),
    role_packets: packets,
    digest: null,
  };
  library.digest = digestWithout(library, "digest");
  return validateBaseRoleLibrary(library, {baseGeneralLibrary});
}

export function validateProjectGeneralLibrary(value, {baseGeneralLibrary = null, baseRoleLibrary = null} = {}) {
  exactKeys(value, [
    "schema", "version", "status", "library_kind", "governance_version", "ownership", "lineage",
    "project_id", "base_general_library_digest", "base_role_library_digest", "project_context_revision",
    "project_context_digest", "policy_state_digest", "source_revision", "project_graph_bindings",
    "default_graph_ids", "role_overlays", "composition_policy", "digest",
  ], "project general library");
  validateCommonLibrary(value, PROJECT_GENERAL_SCHEMA, PROJECT_GENERAL_KIND, "project general library");
  validateExpectedOwnership(value, PROJECT_GENERAL_KIND, "project general library");
  requireIdentifier(value.project_id, "project general library.project_id");
  requireDigest(value.base_general_library_digest, "project general library.base_general_library_digest");
  requireDigest(value.base_role_library_digest, "project general library.base_role_library_digest");
  if (baseGeneralLibrary !== null) {
    validateBaseGeneralLibrary(baseGeneralLibrary);
    assert(value.base_general_library_digest === baseGeneralLibrary.digest, "project general base-general binding differs");
  }
  if (baseRoleLibrary !== null) {
    validateBaseRoleLibrary(baseRoleLibrary, {baseGeneralLibrary});
    assert(value.base_role_library_digest === baseRoleLibrary.digest, "project general base-role binding differs");
  }
  requireSafeToken(value.project_context_revision, "project general library.project_context_revision");
  requireDigest(value.project_context_digest, "project general library.project_context_digest");
  requireDigest(value.policy_state_digest, "project general library.policy_state_digest");
  requireSafeToken(value.source_revision, "project general library.source_revision");
  validateGraphBindings(value.project_graph_bindings, "project general library.project_graph_bindings", {project: true});
  const baseBindings = [
    ...(baseGeneralLibrary === null ? [] : baseGeneralLibrary.general_graph_bindings),
    ...(baseRoleLibrary === null ? [] : value.base_role_library_digest === baseRoleLibrary.digest ? baseRoleLibrary.role_graph_bindings : []),
  ];
  if (baseBindings.length > 0) {
    const collisions = graphNamespaceCollisions(value.project_graph_bindings, baseBindings);
    assert(collisions.paths.length === 0, `project general graph path collides with base governance: ${collisions.paths[0]}`);
  }
  const projectGraphIds = new Set(graphIds(value.project_graph_bindings));
  const baseGraphIds = baseGeneralLibrary === null && baseRoleLibrary === null
    ? null
    : new Set([
      ...(baseGeneralLibrary === null ? [] : graphIds(baseGeneralLibrary.general_graph_bindings)),
      ...(baseRoleLibrary === null ? [] : value.base_role_library_digest === baseRoleLibrary.digest ? baseRoleLibrary.role_graph_bindings.map((binding) => binding.graph_id) : []),
    ]);
  if (baseGraphIds !== null) projectGraphIds.forEach((graphId) => {
    assert(!baseGraphIds.has(graphId), `project general graph ID collides with base governance: ${graphId}`);
  });
  sortedUniqueStrings(value.default_graph_ids, "project general library.default_graph_ids", {allowEmpty: true});
  value.default_graph_ids.forEach((graphId) => assert(projectGraphIds.has(graphId), `project default graph is not bound: ${graphId}`));
  assert(Array.isArray(value.role_overlays), "project general library.role_overlays must be an array");
  const knownRoleIds = baseRoleLibrary === null ? null : new Set(roleIds(baseRoleLibrary.role_packets));
  const overlayRoleIds = new Set();
  value.role_overlays.forEach((overlay, index) => {
    validateProjectOverlay(overlay, `project general library.role_overlays[${index}]`, knownRoleIds);
    assert(!overlayRoleIds.has(overlay.role_id), `project general library has duplicate role overlay: ${overlay.role_id}`);
    overlayRoleIds.add(overlay.role_id);
    overlay.graph_ids.forEach((graphId) => assert(projectGraphIds.has(graphId), `project overlay graph is not bound: ${graphId}`));
  });
  assert(JSON.stringify(value.role_overlays) === JSON.stringify([...value.role_overlays].sort((left, right) => compareUtf8(left.role_id, right.role_id))), "project role overlays must be sorted");
  validateCompositionPolicy(value.composition_policy, "project general library.composition_policy");
  return value;
}

export function compileProjectGeneralLibrary({
  project_id,
  baseGeneralLibrary,
  baseRoleLibrary,
  project_context_revision,
  project_context_digest,
  policy_state_digest,
  source_revision,
  project_graph_bindings,
  default_graph_ids = [],
  role_overlays = [],
  previous = null,
} = {}) {
  validateBaseGeneralLibrary(baseGeneralLibrary);
  validateBaseRoleLibrary(baseRoleLibrary, {baseGeneralLibrary});
  requireIdentifier(project_id, "project_id");
  requireSafeToken(project_context_revision, "project_context_revision");
  requireDigest(project_context_digest, "project_context_digest");
  requireDigest(policy_state_digest, "policy_state_digest");
  requireSafeToken(source_revision, "source_revision");
  validateGraphBindings(project_graph_bindings, "project graph bindings", {project: true});
  const baseNamespaceCollisions = graphNamespaceCollisions(project_graph_bindings, [
    ...baseGeneralLibrary.general_graph_bindings,
    ...baseRoleLibrary.role_graph_bindings,
  ]);
  if (baseNamespaceCollisions.graphIds.length > 0) failConflict({
    conflict_code: "PROJECT_GRAPH_ID_COLLISION",
    affected_library: PROJECT_GENERAL_KIND,
    project_id,
    left_digest: baseGeneralLibrary.digest,
    right_digest: baseRoleLibrary.digest,
    resolution: `PROJECT_GRAPH_ID_MUST_BE_DISJOINT:${baseNamespaceCollisions.graphIds[0]}`,
  });
  if (baseNamespaceCollisions.paths.length > 0) failConflict({
    conflict_code: "PROJECT_GRAPH_PATH_COLLISION",
    affected_library: PROJECT_GENERAL_KIND,
    project_id,
    left_digest: baseGeneralLibrary.digest,
    right_digest: baseRoleLibrary.digest,
    resolution: `PROJECT_GRAPH_PATH_MUST_BE_DISJOINT:${baseNamespaceCollisions.paths[0]}`,
  });
  validatePrevious(previous, (record) => validateProjectGeneralLibrary(record, {baseGeneralLibrary, baseRoleLibrary}), "project general previous record");
  if (previous !== null) assert(previous.project_id === project_id, "project general previous record belongs to another project");
  const library = {
    schema: PROJECT_GENERAL_SCHEMA,
    version: FOUR_LIBRARY_VERSION,
    status: "COMPILED",
    library_kind: PROJECT_GENERAL_KIND,
    governance_version: GOVERNANCE_VERSION,
    ownership: {owner_role: "PROJECT_OWNER", authoring_role: "INTENT_REGULATOR"},
    lineage: makeLineage(previous),
    project_id,
    base_general_library_digest: baseGeneralLibrary.digest,
    base_role_library_digest: baseRoleLibrary.digest,
    project_context_revision,
    project_context_digest,
    policy_state_digest,
    source_revision,
    project_graph_bindings: structuredClone(project_graph_bindings).sort((left, right) => compareUtf8(left.graph_id, right.graph_id)),
    default_graph_ids: [...default_graph_ids].sort(compareUtf8),
    role_overlays: structuredClone(role_overlays).sort((left, right) => compareUtf8(left.role_id, right.role_id)),
    composition_policy: {
      mode: "ADDITIVE_ONLY",
      base_override: "REJECT",
      graph_id_collision: "REJECT",
      authority_expansion: "REJECT",
      duplicate_overlay_policy: "REJECT_UNLESS_IDENTICAL",
    },
    digest: null,
  };
  library.digest = digestWithout(library, "digest");
  try {
    return validateProjectGeneralLibrary(library, {baseGeneralLibrary, baseRoleLibrary});
  } catch (error) {
    if (error instanceof GovernanceConflictError) throw error;
    const collision = error.message.match(/project general graph ID collides with base governance: ([^ ]+)/u);
    if (collision) failConflict({
      conflict_code: "PROJECT_GRAPH_ID_COLLISION",
      affected_library: PROJECT_GENERAL_KIND,
      project_id,
      left_digest: baseGeneralLibrary.digest,
      right_digest: baseRoleLibrary.digest,
      resolution: `PROJECT_GRAPH_ID_MUST_BE_DISJOINT:${collision[1]}`,
    });
    const pathCollision = error.message.match(/project general graph path collides with base governance: ([^ ]+)/u);
    if (pathCollision) failConflict({
      conflict_code: "PROJECT_GRAPH_PATH_COLLISION",
      affected_library: PROJECT_GENERAL_KIND,
      project_id,
      left_digest: baseGeneralLibrary.digest,
      right_digest: baseRoleLibrary.digest,
      resolution: `PROJECT_GRAPH_PATH_MUST_BE_DISJOINT:${pathCollision[1]}`,
    });
    const duplicate = error.message.match(/duplicate role overlay: ([^ ]+)/u);
    if (duplicate) failConflict({
      conflict_code: "DUPLICATE_ROLE_OVERLAY",
      affected_library: PROJECT_GENERAL_KIND,
      project_id,
      resolution: `ROLE_OVERLAY_MUST_BE_UNIQUE:${duplicate[1]}`,
    });
    throw error;
  }
}

export {
  assert,
  canonicalJson,
  compareUtf8,
  digestWithout,
  exactKeys,
  requireString,
  requireSafeToken,
  requireIdentifier,
  requireLaneIdentifier,
  requireDigest,
  requirePositiveInteger,
  sortedUniqueStrings,
  assertPortable,
  requireRelativePath,
  validateStatus,
  validateLineage,
  validateOwnership,
  validateReleaseIdentity,
  validateSourceDigests,
  validateGraphBinding,
  validateGraphBindings,
  validateRoleAuthority,
  validatePacketDigest,
  makeLineage,
  validatePrevious,
  roleSort,
  graphIds,
  graphNamespaceCollisions,
  roleIds,
  rolePacketKey,
  validateCommonLibrary,
  validateRoleGraphBinding,
  validateProjectOverlay,
  validateCompositionPolicy,
  validateMigrationConflicts,
  failConflict,
  HISTORY_EVENT_TYPES,
};

export function canonicalDigest(value) {
  return digest(value);
}
