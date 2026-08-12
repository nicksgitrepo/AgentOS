#!/usr/bin/env node

const ADMITTED_TOPOLOGIES = Object.freeze([
  "INDEPENDENT_SIBLING_SESSION",
  "INDEPENDENT_SIBLING_SESSIONS",
]);

const SESSION_ID_FIELDS = Object.freeze([
  "sessionId",
  "session_id",
  "threadId",
  "thread_id",
  "hostId",
  "host_id",
  "id",
]);

const PROJECT_FIELDS = Object.freeze([
  "project",
  "projectId",
  "project_id",
  "projectRoot",
  "project_root",
]);

const CWD_FIELDS = Object.freeze([
  "cwd",
  "workingDirectory",
  "working_directory",
  "projectCwd",
  "project_cwd",
  "worktreePath",
  "worktree_path",
]);

const GENERIC_ROLE_NAMES = new Set([
  "FEATURE_AGENT",
  "GENERIC_FEATURE_AGENT",
  "FEATURE AGENT",
  "GENERIC FEATURE AGENT",
]);

const COMPATIBILITY_ROLE_NAMES = new Set([
  "CAMPAIGN_TEAM_ROLES",
  "NATIVE_SESSION_ROLES",
  "GLOBAL_ORCHESTRATOR",
  "LEGACY_ROLES",
  "COMPATIBILITY_ROLES",
  "COMPATIBILITY_EXPORT",
]);

const INVALID_IDENTITY_MARKERS = new Set([
  "CALLER_ASSERTION",
  "COMPATIBILITY_EXPORT",
  "DISPLAY_LABEL",
  "INHERITED_ROSTER",
  "MISSING",
  "PLACEHOLDER",
  "SETUP_TOKEN",
  "UNKNOWN",
]);

export const ROLE_ROUTING_TOPOLOGIES = ADMITTED_TOPOLOGIES;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
  assert(value === value.trim(), `${label} must not have surrounding whitespace`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains control characters`);
}

function normalized(value) {
  return value.trim().toUpperCase().replace(/[\s-]+/gu, "_");
}

function validateRoleName(role) {
  requireString(role, "role");
  const name = normalized(role);
  assert(!GENERIC_ROLE_NAMES.has(name), "generic Feature Agent roles are not admitted");
  assert(!COMPATIBILITY_ROLE_NAMES.has(name) && !name.includes("COMPATIBILITY") && !name.startsWith("LEGACY_"), "compatibility-only exports are not admitted roles");
  const tokens = new Set(name.split("_"));
  assert(!["CHILD", "CHILDREN", "PARENT", "RECURSIVE", "SUBAGENT"].some((token) => tokens.has(token)), "recursive child roles are forbidden");
  assert(!["DAEMON", "SHELL", "STANDIN", "STAND_IN"].some((token) => tokens.has(token)), "shell stand-ins are forbidden");
  return role;
}

function roleNames(admittedRoles) {
  const values = admittedRoles instanceof Set
    ? [...admittedRoles]
    : Array.isArray(admittedRoles) ? admittedRoles : null;
  assert(values !== null && values.length > 0, "admittedRoles must contain exact named roles");
  const names = values.map((value) => {
    requireString(value, "admitted role");
    return value;
  });
  assert(new Set(names).size === names.length, "admittedRoles contains duplicate role names");
  names.forEach(validateRoleName);
  return names;
}

function typedFailure(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function consistentField(record, fields, label, required, code = "ROLE_ROUTING_INPUT_INVALID") {
  const values = fields.filter((field) => Object.hasOwn(record, field)).map((field) => record[field]);
  if (values.length === 0) {
    if (required) typedFailure(code, `${label} is missing`);
    return null;
  }
  values.forEach((value) => requireString(value, `session identity ${label}`));
  if (!values.every((value) => value === values[0])) {
    typedFailure(code, `session identity ${label} aliases disagree`);
  }
  return values[0];
}

function validateIdentityMarker(value) {
  if (typeof value !== "string") return;
  if (INVALID_IDENTITY_MARKERS.has(normalized(value))) {
    typedFailure("SESSION_IDENTITY_UNVERIFIED", "session identity is not a real host identity");
  }
}

function validateSessionIdentity(sessionIdentity, expectedProject, expectedCwd) {
  if (typeof sessionIdentity === "string") {
    typedFailure("SESSION_IDENTITY_UNAVAILABLE", "session identity must be a structured host identity");
  }

  if (!isRecord(sessionIdentity)) {
    typedFailure("SESSION_IDENTITY_UNAVAILABLE", "session identity must be a structured host identity");
  }
  consistentField(sessionIdentity, SESSION_ID_FIELDS, "ID", true, "SESSION_IDENTITY_UNAVAILABLE");
  if (sessionIdentity.verified !== true || sessionIdentity.real !== true || sessionIdentity.hostReadback !== true) {
    typedFailure("SESSION_IDENTITY_UNVERIFIED", "session identity lacks verified host readback");
  }
  const identity = consistentField(sessionIdentity, SESSION_ID_FIELDS, "ID", true, "SESSION_IDENTITY_UNAVAILABLE");
  validateIdentityMarker(identity);
  for (const field of ["source", "origin", "kind"]) validateIdentityMarker(sessionIdentity[field]);

  const project = consistentField(sessionIdentity, PROJECT_FIELDS, "project", true);
  const cwd = consistentField(sessionIdentity, CWD_FIELDS, "cwd", true);
  if (project !== expectedProject || cwd !== expectedCwd) {
    typedFailure("SOURCE_BINDING_MISMATCH", "session identity does not match the expected source");
  }
}

function topologyName(topology) {
  if (typeof topology === "string") {
    requireString(topology, "topology");
    assert(ADMITTED_TOPOLOGIES.includes(topology), "forbidden topology");
    return topology;
  }

  assert(isRecord(topology), "topology must be an admitted independent-sibling topology");
  const aliases = ["type", "topology", "name"].filter((field) => Object.hasOwn(topology, field));
  assert(aliases.length > 0, "topology name is missing");
  const names = aliases.map((field) => {
    requireString(topology[field], "topology name");
    return topology[field];
  });
  assert(names.every((value) => value === names[0]), "topology aliases disagree");
  const name = names[0];
  assert(ADMITTED_TOPOLOGIES.includes(name), "forbidden topology");
  for (const field of ["parentChildRelationship", "parent_child_relationship", "recursive", "subagentsAllowed", "subagents_allowed", "shellWorkersAllowed", "shell_workers_allowed", "localDaemonsAllowed", "local_daemons_allowed"]) {
    if (Object.hasOwn(topology, field)) assert(topology[field] === false, `topology flag ${field} is forbidden`);
  }
  return name;
}

function normalizeArguments(role, admittedRoles, sessionIdentity, expectedProject, expectedCwd, topology, argumentCount) {
  if (argumentCount === 1 && isRecord(role)) return role;
  return {role, admittedRoles, sessionIdentity, expectedProject, expectedCwd, topology};
}

export function admitRole(role, admittedRoles, sessionIdentity, expectedProject, expectedCwd, topology) {
  const input = normalizeArguments(role, admittedRoles, sessionIdentity, expectedProject, expectedCwd, topology, arguments.length);
  const namedRole = validateRoleName(input.role);
  const admitted = roleNames(input.admittedRoles);
  assert(admitted.includes(namedRole), "role is not exactly named in admittedRoles");
  requireString(input.expectedProject, "expected project");
  requireString(input.expectedCwd, "expected cwd");
  validateSessionIdentity(input.sessionIdentity, input.expectedProject, input.expectedCwd);
  if (typeof input.phase !== "string" || input.phase.trim().length === 0) {
    typedFailure("ROLE_PHASE_BINDING_REQUIRED", "role phase binding is required");
  }
  const sourceBinding = input.sourceBinding ?? input.source_binding;
  const hostReadback = input.hostReadback ?? input.host_readback;
  if (!isRecord(sourceBinding) || !isRecord(hostReadback)) {
    typedFailure("SOURCE_BINDING_REQUIRED", "source binding and host readback are required");
  }
  const sourceProject = consistentField(sourceBinding, PROJECT_FIELDS, "source project", true, "SOURCE_BINDING_REQUIRED");
  const sourceCwd = consistentField(sourceBinding, CWD_FIELDS, "source cwd", true, "SOURCE_BINDING_REQUIRED");
  const observedProject = consistentField(hostReadback, PROJECT_FIELDS, "source readback project", true, "SOURCE_READBACK_REQUIRED");
  const observedCwd = consistentField(hostReadback, CWD_FIELDS, "source readback cwd", true, "SOURCE_READBACK_REQUIRED");
  if (hostReadback.status !== "MATCH" || hostReadback.verified !== true) {
    typedFailure("SOURCE_READBACK_UNVERIFIED", "source readback is not authoritative");
  }
  if (sourceProject !== input.expectedProject || sourceCwd !== input.expectedCwd || observedProject !== sourceProject || observedCwd !== sourceCwd) {
    typedFailure("SOURCE_BINDING_MISMATCH", "source binding does not match the admitted identity");
  }
  const expectedCapabilities = sourceBinding.capabilities;
  const observedCapabilities = hostReadback.capabilities;
  const requiredCapabilities = input.requiredCapabilities ?? input.required_capabilities;
  if (!Array.isArray(expectedCapabilities) || expectedCapabilities.length === 0
    || !Array.isArray(observedCapabilities) || observedCapabilities.length === 0
    || !Array.isArray(requiredCapabilities) || requiredCapabilities.length === 0) {
    typedFailure("CAPABILITY_BINDING_REQUIRED", "source capability binding is required");
  }
  const capabilityValues = [...expectedCapabilities, ...observedCapabilities, ...requiredCapabilities];
  if (!capabilityValues.every((value) => typeof value === "string" && value.trim().length > 0)) {
    typedFailure("CAPABILITY_BINDING_INVALID", "source capabilities are invalid");
  }
  if (new Set(expectedCapabilities).size !== expectedCapabilities.length
    || new Set(observedCapabilities).size !== observedCapabilities.length
    || new Set(requiredCapabilities).size !== requiredCapabilities.length) {
    typedFailure("CAPABILITY_BINDING_INVALID", "source capabilities contain duplicates");
  }
  if (JSON.stringify([...expectedCapabilities].sort()) !== JSON.stringify([...observedCapabilities].sort())) {
    typedFailure("CAPABILITY_BINDING_MISMATCH", "source capabilities differ from the host readback");
  }
  if (!requiredCapabilities.every((value) => observedCapabilities.includes(value))) {
    typedFailure("CAPABILITY_UNAVAILABLE", "required capability is unavailable");
  }
  const admittedTopology = topologyName(input.topology);

  return Object.freeze({
    admitted: true,
    status: "ADMITTED",
    role: namedRole,
    phase: input.phase,
    identity_verified: true,
    source_binding_status: "MATCH",
    capability_status: "MATCH",
    topology: admittedTopology,
  });
}
