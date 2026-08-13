#!/usr/bin/env node

/*
 * AgentOS 3.0 permanent-role authority substrate.
 *
 * This module validates one portable, content-addressed authority graph and
 * emits inactive roster, compatibility, and action-admission receipts. It
 * does not start roles, create sessions, write Product, or call a host.
 */

import {readFileSync} from "node:fs";

import {canonicalDigest} from "./content-addressing.mjs";

export const PERMANENT_ROLE_AUTHORITY_SCHEMA = "agentos.permanent_role_authority_graph.v1";
export const PERMANENT_ROLE_MIGRATION_SCHEMA = "agentos.permanent_role_authority_migration.v1";
export const PERMANENT_ROLE_ROSTER_SCHEMA = "agentos.permanent_role_roster.v1";
export const PERMANENT_ROLE_APPOINTMENT_SCHEMA = "agentos.permanent_role_appointment.v1";
export const PERMANENT_ROLE_ACTION_REQUEST_SCHEMA = "agentos.permanent_role_action_request.v1";
export const PERMANENT_ROLE_ACTION_ADMISSION_SCHEMA = "agentos.permanent_role_action_admission.v1";
export const PERMANENT_ROLE_REFERENCE_RECEIPT_SCHEMA = "agentos.permanent_role_reference_receipt.v1";
export const PERMANENT_ROLE_AUTHORITY_SHA256 = "7395e70dff8ee2237907ac1da2689beaca34dc38d988e8baec286bfd4fca9d2d";
export const PERMANENT_ROLE_MIGRATION_SHA256 = "58345088fa66e2a7fd97e2ffc5840388a2a086cd0d5fea1a07397158c922ad08";

export const CANONICAL_PERMANENT_ROLE_IDS = Object.freeze([
  "AGENT_SPAWNER_COMPILER",
  "CONTROLLER",
  "INTENT_REGULATOR",
  "RUNTIME",
  "SCHEDULER",
]);

const GRAPH_KEYS = [
  "schema", "version", "governance_version", "status", "authority_mode", "activation",
  "roles", "handoffs", "identity_policy", "compatibility", "runtime_effects", "graph_sha256",
];
const ROLE_KEYS = [
  "role_id", "public_name", "lifetime", "purpose", "model_duty", "allowed_authority",
  "prohibited_authority", "protected_actions", "required_evidence", "independent_from_roles",
];
const HANDOFF_KEYS = [
  "handoff_id", "from_role", "to_role", "artifact", "authority_transfer", "independent_identity_required",
];
const APPOINTMENT_KEYS = [
  "schema", "version", "status", "requested_role_id", "subject_identity", "requester_identity",
  "compiler_identity", "acceptor_identity", "appointing_identity", "authority_graph_sha256", "appointment_sha256",
];
const REQUEST_KEYS = [
  "schema", "version", "request_id", "authority_graph_sha256", "roster_sha256", "actor_role",
  "actor_identity", "model_duty", "requested_authority", "independent_review", "accepted_manifest",
  "capability", "protected_decision",
];
const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const PRIVATE_OR_SECRET = /(?:\/Users\/|\\Users\\|\/home\/|[A-Za-z]:\\Users\\|password|credential|api[_-]?key|access[_-]?token|private[_-]?key)/iu;
const compareUtf8 = (left, right) => Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));

const REQUIRED_ROLE_BOUNDARIES = Object.freeze({
  AGENT_SPAWNER_COMPILER: Object.freeze({
    allowed: Object.freeze(["COMPILE_ROLE_CONTEXT", "SPAWN_HOST_SESSION_AFTER_ACCEPTED_MANIFEST"]),
    prohibited: Object.freeze(["ACCEPT_OWN_MANIFEST", "EXECUTE_PROJECT_WORK", "WRITE_PRODUCT"]),
  }),
  CONTROLLER: Object.freeze({
    allowed: Object.freeze(["RECONCILE_LIFECYCLE_15_MINUTES", "ROUTE_LIFECYCLE_RECOVERY", "SUPERVISE_ROLE_LIVENESS"]),
    prohibited: Object.freeze(["EXECUTE_PROJECT_WORK", "REWRITE_OWNER_INTENT", "WRITE_PRODUCT"]),
  }),
  INTENT_REGULATOR: Object.freeze({
    allowed: Object.freeze(["INTERPRET_OWNER_INTENT", "MAINTAIN_SCOPE_BOUNDARIES", "ROUTE_PROTECTED_DECISIONS"]),
    prohibited: Object.freeze(["EXECUTE_PROJECT_WORK", "RECONCILE_LIFECYCLE_15_MINUTES", "WRITE_PRODUCT"]),
  }),
  RUNTIME: Object.freeze({
    allowed: Object.freeze(["BUILD_WITH_BOUND_CAPABILITY", "DEPLOY_AT_PROTECTED_BOUNDARY", "DISCOVER_ENVIRONMENT_READ_ONLY", "ROLLBACK_AT_PROTECTED_BOUNDARY"]),
    prohibited: Object.freeze(["COMPILE_ROLE_CONTEXT", "INTERPRET_OWNER_INTENT", "SPAWN_HOST_SESSION_AFTER_ACCEPTED_MANIFEST"]),
  }),
  SCHEDULER: Object.freeze({
    allowed: Object.freeze(["ALLOCATE_CAPACITY", "CUSTODY_JOBS", "CUSTODY_PROCESSES", "CUSTODY_WORKTREES"]),
    prohibited: Object.freeze(["ACCEPT_PRODUCT", "PROMOTE_RELEASE", "WRITE_PRODUCT"]),
  }),
});

export class PermanentRoleAuthorityError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "PermanentRoleAuthorityError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new PermanentRoleAuthorityError(code, message);
}

function assert(condition, code, message) {
  if (!condition) fail(code, message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function exactKeys(value, keys, label) {
  assert(isRecord(value), "INVALID_SHAPE", `${label} must be an object`);
  const actual = Object.keys(value).sort(compareUtf8);
  const expected = [...keys].sort(compareUtf8);
  assert(JSON.stringify(actual) === JSON.stringify(expected), "INVALID_SHAPE", `${label} fields mismatch`);
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, "INVALID_SHAPE", `${label} must be a nonempty string`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), "INVALID_SHAPE", `${label} contains control characters`);
}

function requireIdentifier(value, label) {
  requireString(value, label);
  assert(IDENTIFIER.test(value), "INVALID_IDENTITY", `${label} is not a stable identifier`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), "INVALID_DIGEST", `${label} must be a lowercase SHA-256`);
}

function sortedUniqueStrings(value, label, {allowEmpty = false} = {}) {
  assert(Array.isArray(value), "INVALID_SHAPE", `${label} must be an array`);
  if (!allowEmpty) assert(value.length > 0, "INVALID_SHAPE", `${label} must not be empty`);
  value.forEach((item) => requireString(item, `${label} item`));
  const sorted = [...value].sort(compareUtf8);
  assert(new Set(value).size === value.length && JSON.stringify(value) === JSON.stringify(sorted), "NON_CANONICAL", `${label} must be sorted and unique`);
  return value;
}

function digestWithout(value, field) {
  const body = structuredClone(value);
  body[field] = null;
  return canonicalDigest(body);
}

function requirePortable(value, label) {
  assert(!PRIVATE_OR_SECRET.test(JSON.stringify(value)), "NON_PORTABLE_AUTHORITY", `${label} contains private, host-bound, or secret-like content`);
}

function loadJson(relativeUrl) {
  return JSON.parse(readFileSync(new URL(relativeUrl, import.meta.url), "utf8"));
}

export function validatePermanentRoleAuthorityGraph(graph, {requireCanonicalDigest = false} = {}) {
  exactKeys(graph, GRAPH_KEYS, "permanent-role authority graph");
  assert(graph.schema === PERMANENT_ROLE_AUTHORITY_SCHEMA && graph.version === 1, "GRAPH_IDENTITY_INVALID", "permanent-role graph identity is invalid");
  assert(graph.governance_version === "3.0" && graph.status === "PREPARED_NOT_ACTIVATED", "GRAPH_LIFECYCLE_INVALID", "permanent-role graph lifecycle is invalid");
  assert(graph.authority_mode === "CANONICAL_SUBSTRATE_ONLY" && graph.activation === "OFF", "GRAPH_ACTIVATION_FORBIDDEN", "permanent-role graph is not an inactive substrate");
  assert(Array.isArray(graph.roles) && graph.roles.length === CANONICAL_PERMANENT_ROLE_IDS.length, "ROLE_SET_INCOMPLETE", "permanent-role graph must contain exactly five roles");
  const roleIds = graph.roles.map((role) => role.role_id);
  assert(JSON.stringify(roleIds) === JSON.stringify(CANONICAL_PERMANENT_ROLE_IDS), "ROLE_SET_INCOMPLETE", "permanent-role graph role IDs are incomplete, duplicated, or unsorted");
  const authorityOwners = new Map();
  for (const role of graph.roles) {
    exactKeys(role, ROLE_KEYS, `role ${role.role_id ?? "unknown"}`);
    requireIdentifier(role.role_id, "role ID");
    requireString(role.public_name, `${role.role_id} public name`);
    requireString(role.purpose, `${role.role_id} purpose`);
    requireIdentifier(role.model_duty, `${role.role_id} model duty`);
    assert(role.lifetime === "PERMANENT", "ROLE_LIFETIME_INVALID", `${role.role_id} is not permanent`);
    sortedUniqueStrings(role.allowed_authority, `${role.role_id} allowed authority`);
    sortedUniqueStrings(role.prohibited_authority, `${role.role_id} prohibited authority`);
    sortedUniqueStrings(role.protected_actions, `${role.role_id} protected actions`, {allowEmpty: true});
    sortedUniqueStrings(role.required_evidence, `${role.role_id} required evidence`);
    sortedUniqueStrings(role.independent_from_roles, `${role.role_id} independent roles`);
    assert(role.allowed_authority.every((action) => !role.prohibited_authority.includes(action)), "AUTHORITY_CONTRADICTION", `${role.role_id} both allows and prohibits an action`);
    assert(role.protected_actions.every((action) => role.allowed_authority.includes(action)), "PROTECTED_ACTION_UNOWNED", `${role.role_id} protects an action it does not own`);
    const expectedIndependent = CANONICAL_PERMANENT_ROLE_IDS.filter((roleId) => roleId !== role.role_id);
    assert(JSON.stringify(role.independent_from_roles) === JSON.stringify(expectedIndependent), "ROLE_IDENTITY_CONFLATION", `${role.role_id} independent-role set is incomplete`);
    for (const action of role.allowed_authority) {
      assert(!authorityOwners.has(action), "AUTHORITY_OVERLAP", `${action} is owned by both ${authorityOwners.get(action)} and ${role.role_id}`);
      authorityOwners.set(action, role.role_id);
    }
    const boundary = REQUIRED_ROLE_BOUNDARIES[role.role_id];
    assert(boundary.allowed.every((action) => role.allowed_authority.includes(action)), "ROLE_BOUNDARY_WEAKENED", `${role.role_id} is missing required authority`);
    assert(boundary.prohibited.every((action) => role.prohibited_authority.includes(action)), "ROLE_BOUNDARY_WEAKENED", `${role.role_id} is missing a required prohibition`);
  }
  assert(Array.isArray(graph.handoffs) && graph.handoffs.length > 0, "HANDOFF_GRAPH_INCOMPLETE", "permanent-role handoffs are missing");
  const handoffIds = [];
  for (const handoff of graph.handoffs) {
    exactKeys(handoff, HANDOFF_KEYS, `handoff ${handoff.handoff_id ?? "unknown"}`);
    for (const field of ["handoff_id", "from_role", "to_role", "artifact"]) requireIdentifier(handoff[field], `handoff ${field}`);
    assert(handoff.from_role !== handoff.to_role && roleIds.includes(handoff.from_role) && roleIds.includes(handoff.to_role), "HANDOFF_ROLE_INVALID", `${handoff.handoff_id} does not cross two canonical roles`);
    assert(handoff.authority_transfer === "NONE" && handoff.independent_identity_required === true, "HANDOFF_AUTHORITY_LEAK", `${handoff.handoff_id} transfers or conflates authority`);
    handoffIds.push(handoff.handoff_id);
  }
  sortedUniqueStrings(handoffIds, "permanent-role handoff IDs");
  exactKeys(graph.identity_policy, ["distinct_role_identities_required", "requester_subject_reviewer_distinct", "compiler_acceptor_distinct", "self_appointment", "missing_identity_evidence"], "identity policy");
  assert(graph.identity_policy.distinct_role_identities_required === true
    && graph.identity_policy.requester_subject_reviewer_distinct === true
    && graph.identity_policy.compiler_acceptor_distinct === true
    && graph.identity_policy.self_appointment === "DENY"
    && graph.identity_policy.missing_identity_evidence === "DENY", "IDENTITY_POLICY_WEAKENED", "permanent-role independent-identity policy is weakened");
  exactKeys(graph.compatibility, ["mapping", "migration_sha256", "legacy_agentos_controller_target", "legacy_agentos_controller_may_target_controller", "ambiguous_record_policy"], "compatibility policy");
  assert(graph.compatibility.mapping === "migrations/permanent-role-authority.v1.json"
    && graph.compatibility.migration_sha256 === PERMANENT_ROLE_MIGRATION_SHA256
    && graph.compatibility.legacy_agentos_controller_target === "INTENT_REGULATOR"
    && graph.compatibility.legacy_agentos_controller_may_target_controller === false
    && graph.compatibility.ambiguous_record_policy === "DENY_UNTIL_EXPLICITLY_REBOUND", "LEGACY_CONTROLLER_CONFLATION", "AGENTOS_CONTROLLER compatibility is unsafe");
  exactKeys(graph.runtime_effects, ["starts_roles", "host_spawn_wired", "product_writes", "deployment_authorized", "publication_authorized"], "runtime effects");
  assert(Object.values(graph.runtime_effects).every((value) => value === false), "RUNTIME_EFFECT_FORBIDDEN", "authority substrate carries a runtime effect");
  requireSha(graph.graph_sha256, "permanent-role graph digest");
  assert(graph.graph_sha256 === digestWithout(graph, "graph_sha256"), "GRAPH_DIGEST_MISMATCH", "permanent-role graph digest does not match content");
  if (requireCanonicalDigest) assert(graph.graph_sha256 === PERMANENT_ROLE_AUTHORITY_SHA256, "GRAPH_BINDING_MISMATCH", "authority graph is not the canonical graph");
  requirePortable(graph, "permanent-role authority graph");
  return graph;
}

const loadedGraph = loadJson("../governance/3.0/permanent-role-authority-graph.v1.json");
export const CANONICAL_PERMANENT_ROLE_AUTHORITY_GRAPH = deepFreeze(validatePermanentRoleAuthorityGraph(loadedGraph, {requireCanonicalDigest: true}));

export function permanentRoleById(roleId, graph = CANONICAL_PERMANENT_ROLE_AUTHORITY_GRAPH) {
  validatePermanentRoleAuthorityGraph(graph);
  const role = graph.roles.find((candidate) => candidate.role_id === roleId);
  assert(role !== undefined, "UNKNOWN_PERMANENT_ROLE", `unknown permanent role ${roleId}`);
  return role;
}

export function validatePermanentRoleMigrationMap(map) {
  exactKeys(map, ["schema", "version", "from_governance_versions", "to_governance_version", "status", "canonical_role_ids", "role_aliases", "ambiguous_role_terms", "record_rules", "runtime_effects", "migration_sha256"], "permanent-role migration map");
  assert(map.schema === PERMANENT_ROLE_MIGRATION_SCHEMA && map.version === 1 && map.to_governance_version === "3.0" && map.status === "PREPARED_NOT_ACTIVATED", "MIGRATION_IDENTITY_INVALID", "permanent-role migration identity is invalid");
  sortedUniqueStrings(map.from_governance_versions, "migration source versions");
  assert(JSON.stringify(map.canonical_role_ids) === JSON.stringify(CANONICAL_PERMANENT_ROLE_IDS), "MIGRATION_ROLE_SET_INVALID", "migration canonical role set differs from the graph");
  assert(Array.isArray(map.role_aliases) && map.role_aliases.length > 0, "MIGRATION_ALIAS_MISSING", "migration aliases are missing");
  const aliases = new Set();
  for (const alias of map.role_aliases) {
    exactKeys(alias, ["legacy_id", "canonical_role_id", "disposition", "never_maps_to", "required_semantics"], `role alias ${alias.legacy_id ?? "unknown"}`);
    requireIdentifier(alias.legacy_id, "legacy role ID");
    assert(!aliases.has(alias.legacy_id), "MIGRATION_ALIAS_DUPLICATE", `${alias.legacy_id} is duplicated`);
    aliases.add(alias.legacy_id);
    assert(CANONICAL_PERMANENT_ROLE_IDS.includes(alias.canonical_role_id), "MIGRATION_TARGET_INVALID", `${alias.legacy_id} has an unknown target`);
    sortedUniqueStrings(alias.never_maps_to, `${alias.legacy_id} never-map targets`, {allowEmpty: true});
    alias.never_maps_to.forEach((roleId) => assert(CANONICAL_PERMANENT_ROLE_IDS.includes(roleId), "MIGRATION_TARGET_INVALID", `${alias.legacy_id} has an unknown never-map target`));
    requireIdentifier(alias.disposition, `${alias.legacy_id} disposition`);
    requireIdentifier(alias.required_semantics, `${alias.legacy_id} required semantics`);
  }
  const legacyController = map.role_aliases.find((alias) => alias.legacy_id === "AGENTOS_CONTROLLER");
  assert(legacyController?.canonical_role_id === "INTENT_REGULATOR" && legacyController.never_maps_to.includes("CONTROLLER"), "LEGACY_CONTROLLER_CONFLATION", "AGENTOS_CONTROLLER must map only to Intent Regulator");
  sortedUniqueStrings(map.ambiguous_role_terms, "ambiguous role terms");
  exactKeys(map.record_rules, ["canonical_reference", "legacy_alias", "accepted_history", "incomplete_roster", "ambiguous_record"], "migration record rules");
  Object.values(map.record_rules).forEach((rule) => requireString(rule, "migration rule"));
  exactKeys(map.runtime_effects, ["mutates_history", "starts_roles", "spawns_sessions", "activates_governance"], "migration runtime effects");
  assert(Object.values(map.runtime_effects).every((value) => value === false), "MIGRATION_EFFECT_FORBIDDEN", "migration map carries a runtime effect");
  requireSha(map.migration_sha256, "permanent-role migration digest");
  assert(map.migration_sha256 === digestWithout(map, "migration_sha256"), "MIGRATION_DIGEST_MISMATCH", "permanent-role migration digest does not match content");
  requirePortable(map, "permanent-role migration map");
  return map;
}

const loadedMigration = loadJson("../migrations/permanent-role-authority.v1.json");
assert(loadedMigration.migration_sha256 === PERMANENT_ROLE_MIGRATION_SHA256, "MIGRATION_BINDING_MISMATCH", "migration map is not the canonical mapping");
export const PERMANENT_ROLE_MIGRATION_MAP = deepFreeze(validatePermanentRoleMigrationMap(loadedMigration));

export function normalizePermanentRoleReference(reference, {graph = CANONICAL_PERMANENT_ROLE_AUTHORITY_GRAPH, migration = PERMANENT_ROLE_MIGRATION_MAP} = {}) {
  exactKeys(reference, ["role_id", "source_schema", "source_governance_version", "public_name", "legacy_semantics", "authority_graph_sha256"], "permanent-role reference");
  requireIdentifier(reference.role_id, "permanent-role reference ID");
  requireString(reference.source_schema, "permanent-role source schema");
  requireString(reference.source_governance_version, "permanent-role source governance version");
  validatePermanentRoleAuthorityGraph(graph);
  validatePermanentRoleMigrationMap(migration);
  let canonicalRoleId;
  let disposition;
  if (CANONICAL_PERMANENT_ROLE_IDS.includes(reference.role_id)) {
    assert(reference.source_governance_version === "3.0" && reference.authority_graph_sha256 === graph.graph_sha256, "CANONICAL_REFERENCE_UNBOUND", "canonical role reference is not bound to the current graph");
    canonicalRoleId = reference.role_id;
    disposition = "CURRENT_GRAPH_BOUND_REFERENCE";
  } else {
    assert(!migration.ambiguous_role_terms.includes(reference.role_id), "ROLE_REFERENCE_AMBIGUOUS", `${reference.role_id} is ambiguous and requires explicit rebinding`);
    const alias = migration.role_aliases.find((candidate) => candidate.legacy_id === reference.role_id);
    assert(alias !== undefined, "UNKNOWN_LEGACY_ROLE", `${reference.role_id} has no admitted compatibility mapping`);
    assert(migration.from_governance_versions.includes(reference.source_governance_version), "LEGACY_VERSION_UNSUPPORTED", "legacy role reference version is not admitted");
    assert(reference.legacy_semantics === alias.required_semantics, "LEGACY_ROLE_EVIDENCE_MISSING", `${reference.role_id} lacks its required semantic evidence`);
    canonicalRoleId = alias.canonical_role_id;
    disposition = alias.disposition;
  }
  const role = permanentRoleById(canonicalRoleId, graph);
  if (reference.public_name !== null) {
    requireString(reference.public_name, "permanent-role public name");
    const legacyIntentNames = reference.role_id === "AGENTOS_CONTROLLER" && ["AgentOS Controller", "Intent Regulator"].includes(reference.public_name);
    assert(reference.public_name === role.public_name || legacyIntentNames, "ROLE_NAME_CONFLICT", "role public name conflicts with the canonical target");
  }
  if (reference.role_id === "AGENTOS_CONTROLLER") assert(canonicalRoleId === "INTENT_REGULATOR", "LEGACY_CONTROLLER_CONFLATION", "AGENTOS_CONTROLLER cannot become Controller");
  const receipt = {
    schema: PERMANENT_ROLE_REFERENCE_RECEIPT_SCHEMA,
    version: 1,
    status: reference.role_id === canonicalRoleId ? "CURRENT_REFERENCE" : "MIGRATED_REFERENCE_ONLY",
    source_role_id: reference.role_id,
    canonical_role_id: canonicalRoleId,
    canonical_public_name: role.public_name,
    disposition,
    authority_graph_sha256: graph.graph_sha256,
    migration_sha256: migration.migration_sha256,
    mutation: "NONE",
    activation: "OFF",
    receipt_sha256: null,
  };
  receipt.receipt_sha256 = digestWithout(receipt, "receipt_sha256");
  return receipt;
}

function compileAppointment(roleId, identityId, input, graph) {
  exactKeys(input, ["requester_identity", "compiler_identity", "acceptor_identity", "appointing_identity"], `${roleId} appointment input`);
  const appointment = {
    schema: PERMANENT_ROLE_APPOINTMENT_SCHEMA,
    version: 1,
    status: "INDEPENDENTLY_ACCEPTED",
    requested_role_id: roleId,
    subject_identity: identityId,
    requester_identity: input.requester_identity,
    compiler_identity: input.compiler_identity,
    acceptor_identity: input.acceptor_identity,
    appointing_identity: input.appointing_identity,
    authority_graph_sha256: graph.graph_sha256,
    appointment_sha256: null,
  };
  appointment.appointment_sha256 = digestWithout(appointment, "appointment_sha256");
  return appointment;
}

function validateAppointment(appointment, roleId, identityId, graph) {
  exactKeys(appointment, APPOINTMENT_KEYS, `${roleId} appointment`);
  assert(appointment.schema === PERMANENT_ROLE_APPOINTMENT_SCHEMA && appointment.version === 1 && appointment.status === "INDEPENDENTLY_ACCEPTED", "APPOINTMENT_INVALID", `${roleId} appointment identity is invalid`);
  assert(appointment.requested_role_id === roleId && appointment.subject_identity === identityId, "APPOINTMENT_BINDING_MISMATCH", `${roleId} appointment targets another subject`);
  const identities = [appointment.subject_identity, appointment.requester_identity, appointment.compiler_identity, appointment.acceptor_identity, appointment.appointing_identity];
  identities.forEach((identity) => requireIdentifier(identity, `${roleId} appointment identity`));
  assert(new Set(identities).size === identities.length, "SELF_APPOINTMENT", `${roleId} appointment identities are not independent`);
  assert(appointment.authority_graph_sha256 === graph.graph_sha256, "GRAPH_BINDING_MISMATCH", `${roleId} appointment graph binding is stale`);
  requireSha(appointment.appointment_sha256, `${roleId} appointment digest`);
  assert(appointment.appointment_sha256 === digestWithout(appointment, "appointment_sha256"), "APPOINTMENT_DIGEST_MISMATCH", `${roleId} appointment digest does not match content`);
  return appointment;
}

export function compilePermanentRoleRoster({bindings, graph = CANONICAL_PERMANENT_ROLE_AUTHORITY_GRAPH} = {}) {
  validatePermanentRoleAuthorityGraph(graph);
  assert(Array.isArray(bindings), "INVALID_SHAPE", "permanent-role bindings must be an array");
  const compiled = bindings.map((binding) => {
    exactKeys(binding, ["role_id", "identity_id", "appointment"], "permanent-role binding input");
    requireIdentifier(binding.role_id, "permanent-role binding role");
    requireIdentifier(binding.identity_id, `${binding.role_id} identity`);
    return {role_id: binding.role_id, identity_id: binding.identity_id, appointment: compileAppointment(binding.role_id, binding.identity_id, binding.appointment, graph)};
  }).sort((left, right) => compareUtf8(left.role_id, right.role_id));
  const roster = {
    schema: PERMANENT_ROLE_ROSTER_SCHEMA,
    version: 1,
    status: "PREPARED_NOT_ACTIVATED",
    authority_graph_sha256: graph.graph_sha256,
    bindings: compiled,
    activation: "OFF",
    host_sessions_bound: false,
    roster_sha256: null,
  };
  roster.roster_sha256 = digestWithout(roster, "roster_sha256");
  return validatePermanentRoleRoster(roster, {graph});
}

export function validatePermanentRoleRoster(roster, {graph = CANONICAL_PERMANENT_ROLE_AUTHORITY_GRAPH} = {}) {
  exactKeys(roster, ["schema", "version", "status", "authority_graph_sha256", "bindings", "activation", "host_sessions_bound", "roster_sha256"], "permanent-role roster");
  validatePermanentRoleAuthorityGraph(graph);
  assert(roster.schema === PERMANENT_ROLE_ROSTER_SCHEMA && roster.version === 1 && roster.status === "PREPARED_NOT_ACTIVATED", "ROSTER_IDENTITY_INVALID", "permanent-role roster identity is invalid");
  assert(roster.authority_graph_sha256 === graph.graph_sha256, "GRAPH_BINDING_MISMATCH", "permanent-role roster graph binding is stale");
  assert(roster.activation === "OFF" && roster.host_sessions_bound === false, "ROSTER_ACTIVATION_FORBIDDEN", "permanent-role roster starts or binds a role");
  assert(Array.isArray(roster.bindings) && roster.bindings.length === CANONICAL_PERMANENT_ROLE_IDS.length, "ROLE_SET_INCOMPLETE", "permanent-role roster must contain exactly five bindings");
  const roleIds = roster.bindings.map((binding) => binding.role_id);
  assert(JSON.stringify(roleIds) === JSON.stringify(CANONICAL_PERMANENT_ROLE_IDS), "ROLE_SET_INCOMPLETE", "permanent-role roster is incomplete, duplicated, or unsorted");
  const identities = new Set();
  for (const binding of roster.bindings) {
    exactKeys(binding, ["role_id", "identity_id", "appointment"], `${binding.role_id ?? "unknown"} roster binding`);
    requireIdentifier(binding.identity_id, `${binding.role_id} identity`);
    assert(!identities.has(binding.identity_id), "ROLE_IDENTITY_CONFLATION", `${binding.identity_id} is assigned to multiple permanent roles`);
    identities.add(binding.identity_id);
    validateAppointment(binding.appointment, binding.role_id, binding.identity_id, graph);
  }
  requireSha(roster.roster_sha256, "permanent-role roster digest");
  assert(roster.roster_sha256 === digestWithout(roster, "roster_sha256"), "ROSTER_DIGEST_MISMATCH", "permanent-role roster digest does not match content");
  requirePortable(roster, "permanent-role roster");
  return roster;
}

function validateAddressedEvidence(value, keys, schema, label) {
  if (value === null) return null;
  exactKeys(value, keys, label);
  assert(value.schema === schema && value.version === 1, "EVIDENCE_IDENTITY_INVALID", `${label} identity is invalid`);
  requireSha(value[keys[keys.length - 1]], `${label} digest`);
  assert(value[keys[keys.length - 1]] === digestWithout(value, keys[keys.length - 1]), "EVIDENCE_DIGEST_MISMATCH", `${label} digest does not match content`);
  return value;
}

export function permanentRoleActionRequestDigest(request) {
  exactKeys(request, REQUEST_KEYS, "permanent-role action request");
  const body = structuredClone(request);
  body.independent_review = null;
  return canonicalDigest(body);
}

function validateActionRequestShape(request) {
  exactKeys(request, REQUEST_KEYS, "permanent-role action request");
  assert(request.schema === PERMANENT_ROLE_ACTION_REQUEST_SCHEMA && request.version === 1, "REQUEST_IDENTITY_INVALID", "permanent-role action request identity is invalid");
  for (const field of ["request_id", "actor_role", "actor_identity", "model_duty"]) requireIdentifier(request[field], `action request ${field}`);
  requireSha(request.authority_graph_sha256, "action request graph digest");
  requireSha(request.roster_sha256, "action request roster digest");
  sortedUniqueStrings(request.requested_authority, "requested authority");
  validateAddressedEvidence(request.independent_review,
    ["schema", "version", "status", "reviewer_identity", "reviewed_request_sha256", "review_sha256"],
    "agentos.permanent_role_independent_review.v1", "independent review");
  validateAddressedEvidence(request.accepted_manifest,
    ["schema", "version", "status", "manifest_sha256", "compiled_by_identity", "accepted_by_identity", "receipt_sha256"],
    "agentos.accepted_role_context_manifest.v1", "accepted manifest");
  validateAddressedEvidence(request.capability,
    ["schema", "version", "status", "capability_id", "granted_to_identity", "authorized_by_identity", "capability_sha256"],
    "agentos.bound_capability_receipt.v1", "bound capability");
  validateAddressedEvidence(request.protected_decision,
    ["schema", "version", "status", "decision_id", "decided_by_identity", "decision_sha256"],
    "agentos.protected_decision_receipt.v1", "protected decision");
  requirePortable(request, "permanent-role action request");
  return request;
}

function semanticDenials(request, roster, graph) {
  const denials = [];
  const deny = (code) => denials.push(code);
  if (request.authority_graph_sha256 !== graph.graph_sha256) deny("GRAPH_BINDING_MISMATCH");
  if (request.roster_sha256 !== roster.roster_sha256) deny("ROSTER_BINDING_MISMATCH");
  const role = graph.roles.find((candidate) => candidate.role_id === request.actor_role);
  const binding = roster.bindings.find((candidate) => candidate.role_id === request.actor_role);
  if (!role) deny("UNKNOWN_PERMANENT_ROLE");
  if (!binding || binding.identity_id !== request.actor_identity) deny("ACTOR_BINDING_MISMATCH");
  if (role && request.model_duty !== role.model_duty) deny("MODEL_DUTY_MISMATCH");
  const authorityOwners = new Map(graph.roles.flatMap((candidate) => candidate.allowed_authority.map((action) => [action, candidate.role_id])));
  for (const action of request.requested_authority) {
    if (/^(?:APPOINT|SELF_)/u.test(action)) deny("SELF_APPOINTMENT");
    const prohibited = role?.prohibited_authority.includes(action) === true;
    const otherOwner = authorityOwners.has(action) && authorityOwners.get(action) !== request.actor_role;
    if (prohibited) deny("PROHIBITED_AUTHORITY");
    if (otherOwner) deny("AUTHORITY_OVERLAP");
    else if (!prohibited && !role?.allowed_authority.includes(action)) deny("UNKNOWN_AUTHORITY");
  }
  const review = request.independent_review;
  if (review === null || review.status !== "ACCEPTED" || review.reviewed_request_sha256 !== permanentRoleActionRequestDigest(request)) deny("INDEPENDENT_REVIEW_REQUIRED");
  if (review !== null && review.reviewer_identity === request.actor_identity) deny("REVIEWER_IDENTITY_CONFLATION");
  const manifestActions = new Set(["SPAWN_HOST_SESSION_AFTER_ACCEPTED_MANIFEST", "CUSTODY_JOBS", "CUSTODY_PROCESSES", "CUSTODY_WORKTREES"]);
  if (request.requested_authority.some((action) => manifestActions.has(action))) {
    const manifest = request.accepted_manifest;
    if (manifest === null || manifest.status !== "ACCEPTED") deny("ACCEPTED_MANIFEST_REQUIRED");
    else {
      const compilerIdentity = roster.bindings.find((candidate) => candidate.role_id === "AGENT_SPAWNER_COMPILER")?.identity_id;
      if (manifest.compiled_by_identity !== compilerIdentity) deny("MANIFEST_COMPILER_BINDING_MISMATCH");
      if (manifest.accepted_by_identity === manifest.compiled_by_identity
        || manifest.accepted_by_identity === request.actor_identity
        || manifest.accepted_by_identity === review?.reviewer_identity) deny("MANIFEST_ACCEPTOR_IDENTITY_CONFLATION");
    }
  }
  const capabilityActions = new Set(["BUILD_WITH_BOUND_CAPABILITY", "DEPLOY_AT_PROTECTED_BOUNDARY", "ROLLBACK_AT_PROTECTED_BOUNDARY"]);
  if (request.requested_authority.some((action) => capabilityActions.has(action))) {
    const capability = request.capability;
    if (capability === null || capability.status !== "BOUND" || capability.granted_to_identity !== request.actor_identity) deny("BOUND_CAPABILITY_REQUIRED");
    else if (capability.authorized_by_identity === request.actor_identity || capability.authorized_by_identity === review?.reviewer_identity) deny("CAPABILITY_AUTHORIZER_IDENTITY_CONFLATION");
  }
  if (request.requested_authority.some((action) => ["DEPLOY_AT_PROTECTED_BOUNDARY", "ROLLBACK_AT_PROTECTED_BOUNDARY"].includes(action))) {
    const decision = request.protected_decision;
    if (decision === null || decision.status !== "ACCEPTED") deny("PROTECTED_DECISION_REQUIRED");
    else if ([request.actor_identity, review?.reviewer_identity, request.capability?.authorized_by_identity].includes(decision.decided_by_identity)) deny("PROTECTED_DECIDER_IDENTITY_CONFLATION");
  }
  return [...new Set(denials)].sort(compareUtf8);
}

export function compilePermanentRoleActionAdmission({request, roster, graph = CANONICAL_PERMANENT_ROLE_AUTHORITY_GRAPH} = {}) {
  validateActionRequestShape(request);
  validatePermanentRoleRoster(roster, {graph});
  validatePermanentRoleAuthorityGraph(graph);
  const denialCodes = semanticDenials(request, roster, graph);
  const receipt = {
    schema: PERMANENT_ROLE_ACTION_ADMISSION_SCHEMA,
    version: 1,
    status: denialCodes.length === 0 ? "SHAPE_ACCEPTED_NOT_ACTIVATED" : "DENIED",
    request_sha256: canonicalDigest(request),
    authority_graph_sha256: graph.graph_sha256,
    roster_sha256: roster.roster_sha256,
    actor_role: request.actor_role,
    requested_authority: [...request.requested_authority],
    denial_codes: denialCodes,
    execution_authorized: false,
    activation: "OFF",
    host_spawn_wired: false,
    admission_sha256: null,
  };
  receipt.admission_sha256 = digestWithout(receipt, "admission_sha256");
  return validatePermanentRoleActionAdmission(receipt);
}

export function validatePermanentRoleActionAdmission(receipt) {
  exactKeys(receipt, ["schema", "version", "status", "request_sha256", "authority_graph_sha256", "roster_sha256", "actor_role", "requested_authority", "denial_codes", "execution_authorized", "activation", "host_spawn_wired", "admission_sha256"], "permanent-role action admission");
  assert(receipt.schema === PERMANENT_ROLE_ACTION_ADMISSION_SCHEMA && receipt.version === 1, "ADMISSION_IDENTITY_INVALID", "permanent-role action admission identity is invalid");
  assert(["SHAPE_ACCEPTED_NOT_ACTIVATED", "DENIED"].includes(receipt.status), "ADMISSION_STATUS_INVALID", "permanent-role action admission status is invalid");
  for (const field of ["request_sha256", "authority_graph_sha256", "roster_sha256", "admission_sha256"]) requireSha(receipt[field], `admission ${field}`);
  requireIdentifier(receipt.actor_role, "admission actor role");
  sortedUniqueStrings(receipt.requested_authority, "admission requested authority");
  sortedUniqueStrings(receipt.denial_codes, "admission denial codes", {allowEmpty: true});
  assert((receipt.status === "DENIED") === (receipt.denial_codes.length > 0), "ADMISSION_STATUS_INVALID", "admission status and denials disagree");
  assert(receipt.execution_authorized === false && receipt.activation === "OFF" && receipt.host_spawn_wired === false, "ADMISSION_EFFECT_FORBIDDEN", "authority admission authorizes execution or activation");
  assert(receipt.admission_sha256 === digestWithout(receipt, "admission_sha256"), "ADMISSION_DIGEST_MISMATCH", "permanent-role action admission digest does not match content");
  return receipt;
}
