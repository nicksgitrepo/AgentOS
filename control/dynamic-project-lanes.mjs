#!/usr/bin/env node

/*
 * Dynamic project-lane boundary.
 *
 * This module owns only project-lane discovery, identity, dependency ordering,
 * scope custody, and selection of an already-generated governance role. The
 * Four-Library Governance implementation remains the authority for question
 * trees, clauses, and generated role rules; callers pass its validated catalog
 * into selectDynamicLaneRolePacket().
 */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";

export const DYNAMIC_LANE_MANIFEST_SCHEMA = "agentos.dynamic_lane_manifest.v1";
export const DYNAMIC_DEPENDENCY_GRAPH_SCHEMA = "agentos.dynamic_lane_dependency_graph.v1";
export const DYNAMIC_ROLE_PACKET_SCHEMA = "agentos.dynamic_lane_role_packet.v1";
export const DYNAMIC_LANE_VERSION = 1;
export const DYNAMIC_LANE_STATUS = "PREPARED_NOT_ACTIVATED";

export const LANE_KINDS = Object.freeze(["CAPABILITY", "FEATURE"]);
export const ADMISSION_STATUSES = Object.freeze(["ADMITTED", "NOT_ADMITTED"]);
export const DEPENDENCY_RELATION = "REQUIRES";

const SHA256 = /^[0-9a-f]{64}$/u;
const SOURCE_OBJECT = /^[0-9a-f]{40}$/u;
const IDENTIFIER = /^[A-Z][A-Z0-9._:-]{0,127}$/u;
const VERSION = /^v?(?:0|[1-9][0-9]*)(?:\.(?:0|[1-9][0-9]*)){0,2}(?:[-+][A-Za-z0-9.-]+)?$/u;
const PRIVATE_OR_SECRET = /(?:^|[._ -])(?:private|secret|secrets|credential|credentials|password|token|api[_ -]?key)(?:[._ -]|$)/iu;
const GENERIC_WORKER = /(?:feature[\s_-]*agent|platform[\s_-]*agent|named[\s_-]*lane[\s_-]*worker|generic|shell[\s_-]*worker|recursive[\s_-]*child)/iu;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const COMMON_PROHIBITED_AUTHORITY = Object.freeze([
  "SELF_ACCEPTANCE",
  "UNAUTHORIZED_SCOPE_CHANGE",
  "INVENTED_EVIDENCE",
  "UNAUTHORIZED_EXTERNAL_ACTION",
  "SILENT_HARD_BOUNDARY_BYPASS",
]);

const LANE_ROLE_PROFILES = Object.freeze({
  FEATURE: Object.freeze({
    authority_profile: "FEATURE_LANE_OUTCOME_OWNER",
    allowed_authority: Object.freeze([
      "ASSIGNED_LANE_IMPLEMENTATION",
      "ASSIGNED_LANE_EVIDENCE_COLLECTION",
      "TYPED_LANE_HANDOFF",
    ]),
    lease_policy: "ONE_ACTIVE_ASSIGNMENT",
  }),
  CAPABILITY: Object.freeze({
    authority_profile: "CAPABILITY_LANE_CONTRACT_OWNER",
    allowed_authority: Object.freeze([
      "ASSIGNED_CAPABILITY_IMPLEMENTATION",
      "ASSIGNED_CAPABILITY_EVIDENCE_COLLECTION",
      "SEQUENTIAL_CAPABILITY_HANDOFF",
    ]),
    lease_policy: "CAMPAIGN_LOCAL_SEQUENTIAL",
  }),
});

export class DynamicLaneBoundaryError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "DynamicLaneBoundaryError";
    this.code = code;
    Object.assign(this, details);
  }
}

function fail(code, message, details = {}) {
  throw new DynamicLaneBoundaryError(code, message, details);
}

function assert(condition, code, message, details = {}) {
  if (!condition) fail(code, message, details);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected, label) {
  assert(isRecord(value), "INVALID_RECORD", `${label} must be an object`);
  const actual = Object.keys(value).sort(compareUtf8);
  const wanted = [...expected].sort(compareUtf8);
  assert(JSON.stringify(actual) === JSON.stringify(wanted), "INVALID_RECORD_FIELDS", `${label} fields mismatch`, {label, actual, wanted});
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, "INVALID_STRING", `${label} must be a nonempty string`, {label});
  assert(!/[\u0000-\u001f\u007f]/u.test(value), "UNSAFE_TEXT", `${label} contains control characters`, {label});
}

function requireIdentifier(value, label) {
  requireString(value, label);
  assert(IDENTIFIER.test(value), "INVALID_IDENTIFIER", `${label} is not a stable identifier`, {label, value});
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), "INVALID_DIGEST", `${label} must be a lowercase SHA-256`, {label});
}

function requireSourceObject(value, label) {
  assert(typeof value === "string" && SOURCE_OBJECT.test(value), "INVALID_SOURCE_OBJECT", `${label} must be a Git object`, {label});
}

function digestWithout(record, field) {
  const body = structuredClone(record);
  delete body[field];
  return canonicalDigest(body);
}

function sortedUniqueStrings(value, label, {allowEmpty = false} = {}) {
  assert(Array.isArray(value), "INVALID_LIST", `${label} must be an array`, {label});
  if (!allowEmpty) assert(value.length > 0, "EMPTY_LIST", `${label} must not be empty`, {label});
  value.forEach((item) => requireString(item, `${label} item`));
  const sorted = [...value].sort(compareUtf8);
  assert(new Set(value).size === value.length && JSON.stringify(value) === JSON.stringify(sorted), "UNSORTED_OR_DUPLICATE", `${label} must be sorted and unique`, {label});
  return value;
}

function sortedUniqueIdentifiers(value, label, {allowEmpty = false} = {}) {
  sortedUniqueStrings(value, label, {allowEmpty});
  value.forEach((item) => requireIdentifier(item, `${label} item`));
  return value;
}

function normalizeIdentifier(value, label) {
  requireIdentifier(value, label);
  return value.trim().toUpperCase().replace(/[^A-Z0-9]+/gu, "_").replace(/^_+|_+$/gu, "");
}

function normalizeVersion(value, label) {
  requireString(value, label);
  assert(VERSION.test(value.trim()), "INVALID_VERSION", `${label} must be a numeric human-readable version`, {label});
  const normalized = value.trim().replace(/^v/iu, "");
  return `v${normalized}`;
}

function assertSafePublicName(value, label) {
  requireString(value, label);
  const trimmed = value.trim();
  assert(trimmed.length <= 128, "PUBLIC_NAME_TOO_LONG", `${label} is too long`, {label});
  assert(!/[\\/]/u.test(trimmed), "UNSAFE_PUBLIC_NAME", `${label} must not contain a path separator`, {label});
  assert(!/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(trimmed), "UNSAFE_PUBLIC_NAME", `${label} must not contain a URI scheme`, {label});
  assert(!PRIVATE_OR_SECRET.test(trimmed), "UNSAFE_PUBLIC_NAME", `${label} contains private or secret-like content`, {label});
  assert(!GENERIC_WORKER.test(trimmed), "GENERIC_UNSCOPED_WORKER", `${label} is a generic worker name`, {label});
  assert(!UUID.test(trimmed), "UNSAFE_PUBLIC_NAME", `${label} contains an identity-shaped value`, {label});
  assert(/[A-Za-z0-9]/u.test(trimmed), "UNSAFE_PUBLIC_NAME", `${label} must contain a readable name`, {label});
  return trimmed;
}

function slug(value, label) {
  const normalized = value.normalize("NFKD").replace(/[\u0300-\u036f]/gu, "").toUpperCase();
  const result = normalized.replace(/[^A-Z0-9]+/gu, "_").replace(/^_+|_+$/gu, "");
  assert(result.length > 0, "INVALID_NAME_SLUG", `${label} cannot produce a stable ASCII lane identity`, {label});
  return result;
}

function versionSlug(version) {
  return `V${version.slice(1).replace(/[^A-Z0-9]+/giu, "_").toUpperCase()}`;
}

function normalizeProjectPath(value, label) {
  requireString(value, label);
  const trimmed = value.trim();
  assert(!trimmed.startsWith("/") && !trimmed.startsWith("~") && !/^[A-Za-z]:/u.test(trimmed), "UNSAFE_SCOPE_PATH", `${label} must be project-relative`, {label});
  assert(!trimmed.includes("\\"), "UNSAFE_SCOPE_PATH", `${label} must use project-relative POSIX separators`, {label});
  assert(!/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(trimmed), "UNSAFE_SCOPE_PATH", `${label} must not be a URI`, {label});
  const segments = trimmed.split("/");
  assert(segments.every((segment) => segment.length > 0 && segment !== "." && segment !== ".."), "UNSAFE_SCOPE_PATH", `${label} contains an invalid path segment`, {label});
  assert(!segments.some((segment) => /^(?:\.git|\.env|tmp|var|home|root)$/iu.test(segment)), "UNSAFE_SCOPE_PATH", `${label} contains a private path segment`, {label});
  assert(!PRIVATE_OR_SECRET.test(trimmed), "UNSAFE_SCOPE_PATH", `${label} contains private or secret-like content`, {label});
  return trimmed;
}

function pathWithin(root, target) {
  return root === target || target.startsWith(`${root}/`);
}

function normalizePathList(value, label) {
  assert(Array.isArray(value), "INVALID_SCOPE", `${label} must be an array`, {label});
  const normalized = value.map((item) => normalizeProjectPath(item, `${label} item`)).sort(compareUtf8);
  assert(new Set(normalized).size === normalized.length, "UNSORTED_OR_DUPLICATE", `${label} contains duplicate paths`, {label});
  return normalized;
}

function scopeBody(scope, label) {
  exactKeys(scope, ["read", "write", "protected"], label);
  const body = {
    read: normalizePathList(scope.read, `${label}.read`),
    write: normalizePathList(scope.write, `${label}.write`),
    protected: normalizePathList(scope.protected, `${label}.protected`),
  };
  for (const writePath of body.write) {
    for (const protectedPath of body.protected) {
      assert(!pathWithin(writePath, protectedPath) && !pathWithin(protectedPath, writePath), "LANE_SCOPE_PROTECTED_WRITE", `${label} write scope intersects protected scope`, {writePath, protectedPath});
    }
  }
  return body;
}

function normalizeScope(scope, label) {
  const body = scopeBody(scope, label);
  return {...body, scope_sha256: canonicalDigest(body)};
}

function validateScope(scope, label) {
  exactKeys(scope, ["read", "write", "protected", "scope_sha256"], label);
  const body = scopeBody({read: scope.read, write: scope.write, protected: scope.protected}, label);
  requireSha(scope.scope_sha256, `${label}.scope_sha256`);
  assert(scope.scope_sha256 === canonicalDigest(body), "LANE_SCOPE_DIGEST_MISMATCH", `${label} digest does not match content`, {label});
  return scope;
}

function normalizeGovernance(value, label) {
  exactKeys(value, ["graph_ids", "question_ids"], label);
  return {
    graph_ids: sortedUniqueIdentifiers(value.graph_ids, `${label}.graph_ids`, {allowEmpty: true}),
    question_ids: sortedUniqueIdentifiers(value.question_ids, `${label}.question_ids`, {allowEmpty: true}),
  };
}

function normalizeDependencyRef(value, label) {
  exactKeys(value, ["capability_id", "version"], label);
  const capabilityId = normalizeIdentifier(value.capability_id, `${label}.capability_id`);
  assert(!GENERIC_WORKER.test(capabilityId), "GENERIC_UNSCOPED_WORKER", `${label}.capability_id is a generic worker identity`, {label});
  const version = normalizeVersion(value.version, `${label}.version`);
  return {capability_id: capabilityId, version};
}

function dependencyKey(value) {
  return `${value.capability_id}@${value.version}`;
}

function normalizeDependencies(value, label) {
  assert(Array.isArray(value), "INVALID_DEPENDENCIES", `${label} must be an array`, {label});
  const normalized = value.map((item, index) => normalizeDependencyRef(item, `${label}[${index}]`));
  normalized.sort((left, right) => compareUtf8(dependencyKey(left), dependencyKey(right)));
  assert(new Set(normalized.map(dependencyKey)).size === normalized.length, "DUPLICATE_DEPENDENCY", `${label} contains duplicate dependencies`, {label});
  return normalized;
}

function normalizeCapability(value, index) {
  const label = `admitted_capabilities[${index}]`;
  exactKeys(value, ["capability_id", "lane_kind", "name", "version", "admission_status", "governance", "scope", "depends_on"], label);
  const capabilityId = normalizeIdentifier(value.capability_id, `${label}.capability_id`);
  assert(!GENERIC_WORKER.test(capabilityId), "GENERIC_UNSCOPED_WORKER", `${label}.capability_id is a generic worker identity`, {label});
  assert(LANE_KINDS.includes(value.lane_kind), "INVALID_LANE_KIND", `${label}.lane_kind is invalid`, {label});
  assert(ADMISSION_STATUSES.includes(value.admission_status), "INVALID_ADMISSION_STATUS", `${label}.admission_status is invalid`, {label});
  const name = assertSafePublicName(value.name, `${label}.name`);
  const version = normalizeVersion(value.version, `${label}.version`);
  const laneId = `${value.lane_kind}_${slug(capabilityId, `${label}.capability_id`)}_${versionSlug(version)}`;
  requireIdentifier(laneId, `${label}.lane_id`);
  const displayName = `${name} ${version}`;
  assertSafePublicName(displayName, `${label}.display_name`);
  const scope = normalizeScope(value.scope, `${label}.scope`);
  const governance = normalizeGovernance(value.governance, `${label}.governance`);
  const dependsOn = normalizeDependencies(value.depends_on, `${label}.depends_on`);
  return {
    capability_id: capabilityId,
    lane_kind: value.lane_kind,
    name,
    version,
    display_name: displayName,
    lane_id: laneId,
    admission_status: value.admission_status,
    governance,
    scope,
    depends_on: dependsOn,
  };
}

function laneSetBody({project_id, campaign_id, goal_id, source_commit, source_tree, lanes}) {
  return {
    project_id,
    campaign_id,
    goal_id,
    source_commit,
    source_tree,
    lanes: lanes.map((lane) => ({
      capability_id: lane.capability_id,
      lane_kind: lane.lane_kind,
      name: lane.name,
      version: lane.version,
      display_name: lane.display_name,
      lane_id: lane.lane_id,
      admission_status: lane.admission_status,
      governance: lane.governance,
      scope: lane.scope,
      depends_on: lane.depends_on,
    })),
  };
}

function assertDisjointWriteScopes(lanes) {
  for (let leftIndex = 0; leftIndex < lanes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < lanes.length; rightIndex += 1) {
      const left = lanes[leftIndex];
      const right = lanes[rightIndex];
      for (const leftPath of left.scope.write) {
        for (const rightPath of right.scope.write) {
          if (pathWithin(leftPath, rightPath) || pathWithin(rightPath, leftPath)) {
            fail("SHARED_WRITE_CUSTODY_REQUIRED", "lane write scopes overlap and require one explicit primary custodian", {
              lane_a: left.lane_id,
              lane_b: right.lane_id,
              overlap: pathWithin(leftPath, rightPath) ? rightPath : leftPath,
              resolution: "CAMPAIGN_ORCHESTRATOR_PRIMARY_CUSTODY_REQUIRED",
            });
          }
        }
      }
    }
  }
}

function graphBinding({project_id, campaign_id, goal_id, source_commit, source_tree}) {
  return {project_id, campaign_id, goal_id, source_commit, source_tree};
}

function requireBinding(binding, label, current = null) {
  exactKeys(binding, ["project_id", "campaign_id", "goal_id", "source_commit", "source_tree"], label);
  requireIdentifier(binding.project_id, `${label}.project_id`);
  requireIdentifier(binding.campaign_id, `${label}.campaign_id`);
  requireIdentifier(binding.goal_id, `${label}.goal_id`);
  requireSourceObject(binding.source_commit, `${label}.source_commit`);
  requireSourceObject(binding.source_tree, `${label}.source_tree`);
  if (current !== null) {
    requireSourceObject(current.source_commit, "current source_commit");
    requireSourceObject(current.source_tree, "current source_tree");
    assert(binding.source_commit === current.source_commit, "STALE_SOURCE_BINDING", `${label} source commit is stale`, {label});
    assert(binding.source_tree === current.source_tree, "STALE_SOURCE_BINDING", `${label} source tree is stale`, {label});
  }
}

function optionalCurrentSource(currentSourceCommit, currentSourceTree) {
  if (currentSourceCommit === undefined && currentSourceTree === undefined) return null;
  return {source_commit: currentSourceCommit, source_tree: currentSourceTree};
}

function laneByDependencyKey(lanes) {
  const map = new Map();
  for (const lane of lanes) {
    const key = dependencyKey({capability_id: lane.capability_id, version: lane.version});
    assert(!map.has(key), "DUPLICATE_CAPABILITY_ADMISSION", "more than one lane is admitted for the same capability version", {key});
    map.set(key, lane);
  }
  return map;
}

function graphBody({binding, lanes}) {
  const byKey = laneByDependencyKey(lanes);
  const nodes = lanes.map((lane) => ({
    lane_id: lane.lane_id,
    lane_kind: lane.lane_kind,
    display_name: lane.display_name,
    dependency_ids: lane.depends_on.map((dependency) => {
      const dependencyLane = byKey.get(dependencyKey(dependency));
      assert(dependencyLane, "UNKNOWN_DEPENDENCY", `dependency ${dependencyKey(dependency)} is not admitted`, {lane_id: lane.lane_id, dependency: dependencyKey(dependency)});
      assert(dependencyLane.lane_id !== lane.lane_id, "DEPENDENCY_CYCLE_REQUIRES_OWNER_DECISION", "a lane cannot depend on itself", {lane_id: lane.lane_id});
      return dependencyLane.lane_id;
    }).sort(compareUtf8),
    critical_path_rank: null,
  })).sort((left, right) => compareUtf8(left.lane_id, right.lane_id));

  const nodeById = new Map(nodes.map((node) => [node.lane_id, node]));
  const remaining = new Set(nodes.map((node) => node.lane_id));
  const completed = new Set();
  const waves = [];
  while (remaining.size > 0) {
    const ready = [...remaining].filter((laneId) => nodeById.get(laneId).dependency_ids.every((dependencyId) => completed.has(dependencyId))).sort(compareUtf8);
    if (ready.length === 0) {
      fail("DEPENDENCY_CYCLE_REQUIRES_OWNER_DECISION", "dependency graph contains a cycle", {
        unresolved_lane_ids: [...remaining].sort(compareUtf8),
        resolution: "OWNER_DECISION_OR_EXPLICIT_SHARED_CONTRACT_LANE",
      });
    }
    const rank = waves.length;
    ready.forEach((laneId) => {
      nodeById.get(laneId).critical_path_rank = rank;
      remaining.delete(laneId);
      completed.add(laneId);
    });
    waves.push(ready);
  }

  const dependencyOrder = waves.flat();
  return {
    ...binding,
    lane_set_sha256: canonicalDigest(laneSetBody({...binding, lanes})),
    nodes,
    edges: nodes.flatMap((node) => node.dependency_ids.map((dependencyId) => ({
      from_lane_id: dependencyId,
      to_lane_id: node.lane_id,
      relation: DEPENDENCY_RELATION,
    }))).sort((left, right) => compareUtf8(`${left.from_lane_id}:${left.to_lane_id}`, `${right.from_lane_id}:${right.to_lane_id}`)),
    waves,
    dependency_order: dependencyOrder,
  };
}

function validateGraphShape(graph, {currentSourceCommit, currentSourceTree} = {}) {
  exactKeys(graph, [
    "schema", "version", "status", "project_id", "campaign_id", "goal_id", "source_commit", "source_tree",
    "lane_set_sha256", "nodes", "edges", "waves", "dependency_order", "graph_sha256",
  ], "dynamic dependency graph");
  assert(graph.schema === DYNAMIC_DEPENDENCY_GRAPH_SCHEMA && graph.version === DYNAMIC_LANE_VERSION, "INVALID_GRAPH_IDENTITY", "dynamic dependency graph identity is invalid");
  assert(graph.status === DYNAMIC_LANE_STATUS, "INVALID_GRAPH_STATUS", "dynamic dependency graph status is invalid");
  requireBinding({project_id: graph.project_id, campaign_id: graph.campaign_id, goal_id: graph.goal_id, source_commit: graph.source_commit, source_tree: graph.source_tree}, "dynamic dependency graph", optionalCurrentSource(currentSourceCommit, currentSourceTree));
  requireSha(graph.lane_set_sha256, "dynamic dependency graph lane set");
  assert(Array.isArray(graph.nodes) && graph.nodes.length > 0, "EMPTY_DEPENDENCY_GRAPH", "dynamic dependency graph must contain nodes");
  assert(Array.isArray(graph.edges), "INVALID_GRAPH_EDGES", "dynamic dependency graph edges must be an array");
  assert(Array.isArray(graph.waves) && graph.waves.length > 0, "INVALID_GRAPH_WAVES", "dynamic dependency graph waves must be nonempty");
  assert(Array.isArray(graph.dependency_order) && graph.dependency_order.length > 0, "INVALID_GRAPH_ORDER", "dynamic dependency graph dependency_order must be nonempty");
  assert(new Set(graph.dependency_order).size === graph.dependency_order.length, "INVALID_GRAPH_ORDER", "dynamic dependency graph dependency_order contains duplicates");
  graph.dependency_order.forEach((laneId) => requireIdentifier(laneId, "dynamic dependency graph dependency_order lane_id"));
  const nodeIds = graph.nodes.map((node) => node.lane_id);
  sortedUniqueIdentifiers(nodeIds, "dynamic dependency graph node IDs");
  const nodeById = new Map(graph.nodes.map((node) => [node.lane_id, node]));
  graph.nodes.forEach((node) => {
    exactKeys(node, ["lane_id", "lane_kind", "display_name", "dependency_ids", "critical_path_rank"], "dynamic dependency graph node");
    requireIdentifier(node.lane_id, "dynamic dependency graph node lane_id");
    assert(LANE_KINDS.includes(node.lane_kind), "INVALID_LANE_KIND", "dynamic dependency graph node lane kind is invalid");
    assertSafePublicName(node.display_name, "dynamic dependency graph node display_name");
    sortedUniqueIdentifiers(node.dependency_ids, `${node.lane_id} dependency_ids`, {allowEmpty: true});
    node.dependency_ids.forEach((dependencyId) => assert(nodeById.has(dependencyId), "UNKNOWN_DEPENDENCY", `${node.lane_id} references an unknown dependency`, {dependencyId}));
    assert(Number.isSafeInteger(node.critical_path_rank) && node.critical_path_rank >= 0, "INVALID_GRAPH_RANK", `${node.lane_id} critical path rank is invalid`);
    node.dependency_ids.forEach((dependencyId) => assert(nodeById.get(dependencyId).critical_path_rank < node.critical_path_rank, "INVALID_GRAPH_ORDER", `${node.lane_id} is scheduled before a dependency`, {lane_id: node.lane_id, dependencyId}));
  });
  const expectedEdges = graph.nodes.flatMap((node) => node.dependency_ids.map((dependencyId) => ({from_lane_id: dependencyId, to_lane_id: node.lane_id, relation: DEPENDENCY_RELATION}))).sort((left, right) => compareUtf8(`${left.from_lane_id}:${left.to_lane_id}`, `${right.from_lane_id}:${right.to_lane_id}`));
  assert(JSON.stringify(graph.edges) === JSON.stringify(expectedEdges), "INVALID_GRAPH_EDGES", "dynamic dependency graph edges do not match node dependencies");
  graph.waves.forEach((wave, index) => sortedUniqueIdentifiers(wave, `dynamic dependency graph wave ${index}`));
  const flattenedWaves = graph.waves.flat();
  assert(JSON.stringify(flattenedWaves) === JSON.stringify(graph.dependency_order), "INVALID_GRAPH_ORDER", "dynamic dependency graph order does not match waves");
  assert(new Set(flattenedWaves).size === nodeIds.length && flattenedWaves.every((laneId) => nodeById.has(laneId)), "INVALID_GRAPH_WAVES", "dynamic dependency graph waves do not cover each node exactly once");
  graph.waves.forEach((wave, index) => wave.forEach((laneId) => assert(nodeById.get(laneId).critical_path_rank === index, "INVALID_GRAPH_RANK", `${laneId} rank does not match its wave`)));
  const orderIndex = new Map(graph.dependency_order.map((laneId, index) => [laneId, index]));
  graph.nodes.forEach((node) => node.dependency_ids.forEach((dependencyId) => assert(orderIndex.get(dependencyId) < orderIndex.get(node.lane_id), "INVALID_GRAPH_ORDER", `${node.lane_id} appears before a dependency in dependency_order`, {lane_id: node.lane_id, dependencyId})));
  requireSha(graph.graph_sha256, "dynamic dependency graph digest");
  assert(graph.graph_sha256 === digestWithout(graph, "graph_sha256"), "DIGEST_MISMATCH", "dynamic dependency graph digest does not match content");
  return graph;
}

export function discoverDynamicLanes({admitted_capabilities = []} = {}) {
  assert(Array.isArray(admitted_capabilities), "INVALID_ADMISSION_INPUT", "admitted_capabilities must be an array");
  const normalized = admitted_capabilities.map(normalizeCapability);
  const byKey = new Map();
  const byCapabilityId = new Map();
  for (const capability of normalized) {
    const key = dependencyKey(capability);
    assert(!byKey.has(key), "DUPLICATE_CAPABILITY_ADMISSION", `capability ${key} appears more than once`, {key});
    assert(!byCapabilityId.has(capability.capability_id), "DUPLICATE_CAPABILITY_LANE", `capability ${capability.capability_id} would create more than one lane`, {capability_id: capability.capability_id});
    byKey.set(key, capability);
    byCapabilityId.set(capability.capability_id, capability);
  }
  return normalized.filter((capability) => capability.admission_status === "ADMITTED").sort((left, right) => compareUtf8(left.lane_id, right.lane_id));
}

export function compileDynamicDependencyGraph({project_id, campaign_id, goal_id, source_commit, source_tree, lanes} = {}) {
  const binding = graphBinding({project_id, campaign_id, goal_id, source_commit, source_tree});
  requireBinding(binding, "dynamic dependency graph", {source_commit, source_tree});
  assert(Array.isArray(lanes) && lanes.length > 0, "EMPTY_DEPENDENCY_GRAPH", "dynamic dependency graph requires at least one admitted lane");
  lanes.forEach((lane, index) => validateLaneRecord(lane, `lanes[${index}]`));
  assertDisjointWriteScopes(lanes);
  const body = graphBody({binding, lanes});
  const graph = {
    schema: DYNAMIC_DEPENDENCY_GRAPH_SCHEMA,
    version: DYNAMIC_LANE_VERSION,
    status: DYNAMIC_LANE_STATUS,
    ...body,
    graph_sha256: null,
  };
  graph.graph_sha256 = digestWithout(graph, "graph_sha256");
  return validateGraphShape(graph, {currentSourceCommit: source_commit, currentSourceTree: source_tree});
}

export function validateDynamicDependencyGraph(graph, {currentSourceCommit, currentSourceTree} = {}) {
  return validateGraphShape(graph, {currentSourceCommit, currentSourceTree});
}

function validateLaneRecord(lane, label) {
  exactKeys(lane, [
    "capability_id", "lane_kind", "name", "version", "display_name", "lane_id", "admission_status",
    "governance", "scope", "depends_on",
  ], label);
  const normalized = normalizeCapability({
    capability_id: lane.capability_id,
    lane_kind: lane.lane_kind,
    name: lane.name,
    version: lane.version,
    admission_status: lane.admission_status,
    governance: lane.governance,
    scope: {read: lane.scope.read, write: lane.scope.write, protected: lane.scope.protected},
    depends_on: lane.depends_on,
  }, label);
  assert(canonicalDigest(normalized) === canonicalDigest(lane), "LANE_RECORD_MISMATCH", `${label} is not canonically normalized`, {label});
  assert(lane.admission_status === "ADMITTED", "UNADMITTED_LANE", `${label} is not admitted`, {label});
  return lane;
}

export function compileDynamicLaneManifest({
  project_id,
  campaign_id,
  goal_id,
  source_commit,
  source_tree,
  bootstrap_plan_sha256,
  project_governance_sha256,
  admitted_capabilities,
} = {}) {
  const binding = {project_id, campaign_id, goal_id, source_commit, source_tree};
  requireBinding(binding, "dynamic lane manifest", {source_commit, source_tree});
  requireSha(bootstrap_plan_sha256, "dynamic lane manifest bootstrap plan");
  requireSha(project_governance_sha256, "dynamic lane manifest project governance");
  const lanes = discoverDynamicLanes({admitted_capabilities});
  assert(lanes.length > 0, "EMPTY_DYNAMIC_LANE_MANIFEST", "at least one capability must be admitted before compiling a lane manifest");
  lanes.forEach((lane, index) => validateLaneRecord(lane, `dynamic lane manifest lanes[${index}]`));
  assertDisjointWriteScopes(lanes);
  const dependencyGraph = compileDynamicDependencyGraph({project_id, campaign_id, goal_id, source_commit, source_tree, lanes});
  const manifest = {
    schema: DYNAMIC_LANE_MANIFEST_SCHEMA,
    version: DYNAMIC_LANE_VERSION,
    status: DYNAMIC_LANE_STATUS,
    project_id,
    campaign_id,
    goal_id,
    source_commit,
    source_tree,
    bootstrap_plan_sha256,
    project_governance_sha256,
    lanes,
    dependency_graph: dependencyGraph,
    digest: null,
  };
  manifest.digest = digestWithout(manifest, "digest");
  return validateDynamicLaneManifest(manifest, {currentSourceCommit: source_commit, currentSourceTree: source_tree});
}

export function validateDynamicLaneManifest(manifest, {currentSourceCommit, currentSourceTree} = {}) {
  exactKeys(manifest, [
    "schema", "version", "status", "project_id", "campaign_id", "goal_id", "source_commit", "source_tree",
    "bootstrap_plan_sha256", "project_governance_sha256", "lanes", "dependency_graph", "digest",
  ], "dynamic lane manifest");
  assert(manifest.schema === DYNAMIC_LANE_MANIFEST_SCHEMA && manifest.version === DYNAMIC_LANE_VERSION, "INVALID_MANIFEST_IDENTITY", "dynamic lane manifest identity is invalid");
  assert(manifest.status === DYNAMIC_LANE_STATUS, "INVALID_MANIFEST_STATUS", "dynamic lane manifest status is invalid");
  requireBinding({project_id: manifest.project_id, campaign_id: manifest.campaign_id, goal_id: manifest.goal_id, source_commit: manifest.source_commit, source_tree: manifest.source_tree}, "dynamic lane manifest", optionalCurrentSource(currentSourceCommit, currentSourceTree));
  requireSha(manifest.bootstrap_plan_sha256, "dynamic lane manifest bootstrap plan");
  requireSha(manifest.project_governance_sha256, "dynamic lane manifest project governance");
  assert(Array.isArray(manifest.lanes) && manifest.lanes.length > 0, "EMPTY_DYNAMIC_LANE_MANIFEST", "dynamic lane manifest must contain admitted lanes");
  const laneIds = [];
  manifest.lanes.forEach((lane, index) => {
    validateLaneRecord(lane, `dynamic lane manifest lanes[${index}]`);
    laneIds.push(lane.lane_id);
  });
  assert(JSON.stringify(laneIds) === JSON.stringify([...laneIds].sort(compareUtf8)), "UNSORTED_LANES", "dynamic lane manifest lanes must be UTF-8 sorted");
  assertDisjointWriteScopes(manifest.lanes);
  validateGraphShape(manifest.dependency_graph, {currentSourceCommit, currentSourceTree});
  assert(manifest.dependency_graph.project_id === manifest.project_id && manifest.dependency_graph.campaign_id === manifest.campaign_id && manifest.dependency_graph.goal_id === manifest.goal_id, "GRAPH_BINDING_MISMATCH", "dependency graph project or goal binding differs from manifest");
  assert(manifest.dependency_graph.source_commit === manifest.source_commit && manifest.dependency_graph.source_tree === manifest.source_tree, "GRAPH_BINDING_MISMATCH", "dependency graph source binding differs from manifest");
  assert(manifest.dependency_graph.lane_set_sha256 === canonicalDigest(laneSetBody({project_id: manifest.project_id, campaign_id: manifest.campaign_id, goal_id: manifest.goal_id, source_commit: manifest.source_commit, source_tree: manifest.source_tree, lanes: manifest.lanes})), "GRAPH_LANE_SET_MISMATCH", "dependency graph lane set differs from manifest");
  assert(JSON.stringify(manifest.dependency_graph.nodes.map((node) => node.lane_id)) === JSON.stringify(laneIds), "GRAPH_LANE_COVERAGE_MISMATCH", "dependency graph does not cover manifest lanes");
  requireSha(manifest.digest, "dynamic lane manifest digest");
  assert(manifest.digest === digestWithout(manifest, "digest"), "DIGEST_MISMATCH", "dynamic lane manifest digest does not match content");
  return manifest;
}

function validateRoleCatalogBinding(roleGovernanceLibrary, manifest) {
  assert(isRecord(roleGovernanceLibrary), "INVALID_ROLE_CATALOG", "role governance library must be an object");
  requireSha(roleGovernanceLibrary.digest, "role governance library digest");
  requireSourceObject(roleGovernanceLibrary.source_commit, "role governance library source_commit");
  requireSourceObject(roleGovernanceLibrary.source_tree, "role governance library source_tree");
  requireSha(roleGovernanceLibrary.bootstrap_plan_sha256, "role governance library bootstrap plan");
  assert(roleGovernanceLibrary.source_commit === manifest.source_commit && roleGovernanceLibrary.source_tree === manifest.source_tree, "STALE_ROLE_CATALOG", "role governance library source binding differs from lane manifest");
  assert(roleGovernanceLibrary.bootstrap_plan_sha256 === manifest.bootstrap_plan_sha256, "ROLE_CATALOG_PLAN_MISMATCH", "role governance library Bootstrap plan differs from lane manifest");
  assert(Array.isArray(roleGovernanceLibrary.roles), "INVALID_ROLE_CATALOG", "role governance library roles must be an array");
  for (const role of roleGovernanceLibrary.roles) {
    if (typeof role?.role_id === "string" && (GENERIC_WORKER.test(role.role_id) || role.role_kind === "ONE_LANE_WORKER" && role.lane_id === null)) {
      fail("GENERIC_UNSCOPED_WORKER", "role governance library contains a generic unscoped worker", {role_id: role.role_id});
    }
  }
}

function selectedRoleRecord(roleGovernanceLibrary, lane) {
  const expectedRoleId = `WORKER_${lane.lane_id}`;
  const role = roleGovernanceLibrary.roles.find((candidate) => candidate?.role_id === expectedRoleId);
  assert(role, "LANE_ROLE_NOT_FOUND", `role governance library has no packet for ${lane.lane_id}`, {expectedRoleId, lane_id: lane.lane_id});
  exactKeys(role, [
    "role_id", "public_name", "role_scope", "role_kind", "lane_id", "shared_clause_ids", "question_ids",
    "universal_task_gate_question_ids", "generated_rules",
  ], `selected role ${expectedRoleId}`);
  assert(role.role_id === expectedRoleId && role.lane_id === lane.lane_id, "LANE_ROLE_BINDING_MISMATCH", "selected role is not bound to the lane identity", {expectedRoleId, actualRoleId: role.role_id});
  assert(role.role_scope === "CAMPAIGN" && role.role_kind === "ONE_LANE_WORKER", "INVALID_LANE_ROLE_KIND", "selected role is not a campaign one-lane worker", {role_id: role.role_id});
  assertSafePublicName(role.public_name, `selected role ${expectedRoleId} public_name`);
  sortedUniqueIdentifiers(role.shared_clause_ids, `${expectedRoleId}.shared_clause_ids`);
  sortedUniqueIdentifiers(role.question_ids, `${expectedRoleId}.question_ids`, {allowEmpty: true});
  sortedUniqueIdentifiers(role.universal_task_gate_question_ids, `${expectedRoleId}.universal_task_gate_question_ids`);
  assert(Array.isArray(role.generated_rules) && role.generated_rules.length === role.question_ids.length, "INVALID_LANE_ROLE_RULES", `${expectedRoleId} generated rules do not cover its questions`);
  assert(JSON.stringify(role.generated_rules.map((rule) => rule.question_id)) === JSON.stringify(role.question_ids), "INVALID_LANE_ROLE_RULES", `${expectedRoleId} generated rules are not ordered with its questions`);
  if (lane.governance.question_ids.length > 0) assert(JSON.stringify(role.question_ids) === JSON.stringify(lane.governance.question_ids), "LANE_GOVERNANCE_SELECTION_MISMATCH", `${expectedRoleId} question selection differs from the lane manifest`, {role_id: expectedRoleId});
  return role;
}

function rolePacketBody({manifest, lane, roleGovernanceLibrary, role}) {
  const profile = LANE_ROLE_PROFILES[lane.lane_kind];
  return {
    schema: DYNAMIC_ROLE_PACKET_SCHEMA,
    version: DYNAMIC_LANE_VERSION,
    status: DYNAMIC_LANE_STATUS,
    project_id: manifest.project_id,
    campaign_id: manifest.campaign_id,
    goal_id: manifest.goal_id,
    source_commit: manifest.source_commit,
    source_tree: manifest.source_tree,
    bootstrap_plan_sha256: manifest.bootstrap_plan_sha256,
    project_governance_sha256: manifest.project_governance_sha256,
    lane_manifest_sha256: manifest.digest,
    dependency_graph_sha256: manifest.dependency_graph.graph_sha256,
    role_governance_sha256: roleGovernanceLibrary.digest,
    role_id: role.role_id,
    display_name: lane.display_name,
    lane_id: lane.lane_id,
    lane_kind: lane.lane_kind,
    capability_id: lane.capability_id,
    lane_version: lane.version,
    role_scope: role.role_scope,
    role_kind: role.role_kind,
    governance: {
      graph_ids: lane.governance.graph_ids,
      question_ids: role.question_ids,
      shared_clause_ids: role.shared_clause_ids,
      universal_task_gate_question_ids: role.universal_task_gate_question_ids,
      generated_rule_ids: role.generated_rules.map((rule) => rule.rule_id),
      role_definition_source_sha256: roleGovernanceLibrary.role_definition_source_sha256 ?? null,
    },
    authority_profile: profile.authority_profile,
    allowed_authority: [...profile.allowed_authority],
    prohibited_authority: [...COMMON_PROHIBITED_AUTHORITY],
    lease_policy: profile.lease_policy,
    scope: structuredClone(lane.scope),
    dependencies: structuredClone(lane.depends_on),
  };
}

function validateRolePacketShape(packet, {manifest = null} = {}) {
  exactKeys(packet, [
    "schema", "version", "status", "project_id", "campaign_id", "goal_id", "source_commit", "source_tree",
    "bootstrap_plan_sha256", "project_governance_sha256", "lane_manifest_sha256", "dependency_graph_sha256",
    "role_governance_sha256", "role_id", "display_name", "lane_id", "lane_kind", "capability_id", "lane_version",
    "role_scope", "role_kind", "governance", "authority_profile", "allowed_authority", "prohibited_authority",
    "lease_policy", "scope", "dependencies", "packet_sha256",
  ], "dynamic lane role packet");
  assert(packet.schema === DYNAMIC_ROLE_PACKET_SCHEMA && packet.version === DYNAMIC_LANE_VERSION, "INVALID_ROLE_PACKET_IDENTITY", "dynamic lane role packet identity is invalid");
  assert(packet.status === DYNAMIC_LANE_STATUS, "INVALID_ROLE_PACKET_STATUS", "dynamic lane role packet status is invalid");
  const binding = {project_id: packet.project_id, campaign_id: packet.campaign_id, goal_id: packet.goal_id, source_commit: packet.source_commit, source_tree: packet.source_tree};
  requireBinding(binding, "dynamic lane role packet");
  for (const field of ["bootstrap_plan_sha256", "project_governance_sha256", "lane_manifest_sha256", "dependency_graph_sha256", "role_governance_sha256"]) requireSha(packet[field], `dynamic lane role packet ${field}`);
  requireIdentifier(packet.role_id, "dynamic lane role packet role_id");
  requireIdentifier(packet.lane_id, "dynamic lane role packet lane_id");
  requireIdentifier(packet.capability_id, "dynamic lane role packet capability_id");
  normalizeVersion(packet.lane_version, "dynamic lane role packet lane_version");
  assert(!GENERIC_WORKER.test(packet.role_id) && !GENERIC_WORKER.test(packet.display_name), "GENERIC_UNSCOPED_WORKER", "dynamic lane role packet contains a generic worker identity");
  assert(packet.role_id === `WORKER_${packet.lane_id}`, "LANE_ROLE_BINDING_MISMATCH", "dynamic lane role packet role_id is not derived from lane_id");
  assert(LANE_KINDS.includes(packet.lane_kind), "INVALID_LANE_KIND", "dynamic lane role packet lane_kind is invalid");
  assert(packet.lane_id.startsWith(`${packet.lane_kind}_`), "INVALID_LANE_IDENTITY", "dynamic lane role packet lane_id does not carry its lane kind");
  assertSafePublicName(packet.display_name, "dynamic lane role packet display_name");
  assert(packet.role_scope === "CAMPAIGN" && packet.role_kind === "ONE_LANE_WORKER", "INVALID_LANE_ROLE_KIND", "dynamic lane role packet role kind is invalid");
  exactKeys(packet.governance, ["graph_ids", "question_ids", "shared_clause_ids", "universal_task_gate_question_ids", "generated_rule_ids", "role_definition_source_sha256"], "dynamic lane role packet governance");
  sortedUniqueIdentifiers(packet.governance.graph_ids, "dynamic lane role packet graph_ids", {allowEmpty: true});
  sortedUniqueIdentifiers(packet.governance.question_ids, "dynamic lane role packet question_ids", {allowEmpty: true});
  sortedUniqueIdentifiers(packet.governance.shared_clause_ids, "dynamic lane role packet shared_clause_ids");
  sortedUniqueIdentifiers(packet.governance.universal_task_gate_question_ids, "dynamic lane role packet task gates");
  sortedUniqueIdentifiers(packet.governance.generated_rule_ids, "dynamic lane role packet generated rules", {allowEmpty: true});
  assert(packet.governance.role_definition_source_sha256 === null || SHA256.test(packet.governance.role_definition_source_sha256), "INVALID_ROLE_CATALOG", "dynamic lane role packet role-definition source digest is invalid");
  const profile = LANE_ROLE_PROFILES[packet.lane_kind];
  assert(packet.authority_profile === profile.authority_profile, "INVALID_LANE_AUTHORITY", "dynamic lane role packet authority profile is invalid");
  assert(JSON.stringify(packet.allowed_authority) === JSON.stringify(profile.allowed_authority), "INVALID_LANE_AUTHORITY", "dynamic lane role packet allowed authority is invalid");
  assert(JSON.stringify(packet.prohibited_authority) === JSON.stringify(COMMON_PROHIBITED_AUTHORITY), "INVALID_LANE_AUTHORITY", "dynamic lane role packet prohibited authority is invalid");
  assert(packet.lease_policy === profile.lease_policy, "INVALID_LANE_LEASE_POLICY", "dynamic lane role packet lease policy is invalid");
  validateScope(packet.scope, "dynamic lane role packet scope");
  assert(Array.isArray(packet.dependencies), "INVALID_DEPENDENCIES", "dynamic lane role packet dependencies must be an array");
  assert(JSON.stringify(packet.dependencies) === JSON.stringify([...packet.dependencies].sort((left, right) => compareUtf8(dependencyKey(left), dependencyKey(right)))), "UNSORTED_DEPENDENCIES", "dynamic lane role packet dependencies are not sorted");
  packet.dependencies.forEach((dependency, index) => normalizeDependencyRef(dependency, `dynamic lane role packet dependencies[${index}]`));
  requireSha(packet.packet_sha256, "dynamic lane role packet digest");
  assert(packet.packet_sha256 === digestWithout(packet, "packet_sha256"), "DIGEST_MISMATCH", "dynamic lane role packet digest does not match content");
  if (manifest !== null) {
    validateDynamicLaneManifest(manifest, {currentSourceCommit: manifest.source_commit, currentSourceTree: manifest.source_tree});
    assert(packet.project_id === manifest.project_id && packet.campaign_id === manifest.campaign_id && packet.goal_id === manifest.goal_id, "PACKET_BINDING_MISMATCH", "dynamic lane role packet project or goal differs from manifest");
    assert(packet.source_commit === manifest.source_commit && packet.source_tree === manifest.source_tree, "STALE_SOURCE_BINDING", "dynamic lane role packet source differs from manifest");
    assert(packet.bootstrap_plan_sha256 === manifest.bootstrap_plan_sha256 && packet.project_governance_sha256 === manifest.project_governance_sha256, "PACKET_BINDING_MISMATCH", "dynamic lane role packet governance binding differs from manifest");
    const lane = manifest.lanes.find((candidate) => candidate.lane_id === packet.lane_id);
    assert(lane, "LANE_ROLE_BINDING_MISMATCH", "dynamic lane role packet lane is absent from manifest", {lane_id: packet.lane_id});
    assert(packet.lane_kind === lane.lane_kind && packet.capability_id === lane.capability_id && packet.lane_version === lane.version && packet.display_name === lane.display_name, "LANE_ROLE_BINDING_MISMATCH", "dynamic lane role packet lane identity differs from manifest");
    assert(packet.lane_manifest_sha256 === manifest.digest && packet.dependency_graph_sha256 === manifest.dependency_graph.graph_sha256, "PACKET_BINDING_MISMATCH", "dynamic lane role packet manifest or graph digest differs");
    assert(packet.scope.scope_sha256 === lane.scope.scope_sha256, "LANE_SCOPE_DIGEST_MISMATCH", "dynamic lane role packet scope differs from manifest lane");
    assert(JSON.stringify(packet.dependencies) === JSON.stringify(lane.depends_on), "DEPENDENCY_BINDING_MISMATCH", "dynamic lane role packet dependencies differ from manifest lane");
  }
  return packet;
}

export function selectDynamicLaneRolePacket({manifest, lane_id, roleGovernanceLibrary, current_source_commit, current_source_tree} = {}) {
  const currentSourceCommit = current_source_commit ?? manifest?.source_commit;
  const currentSourceTree = current_source_tree ?? manifest?.source_tree;
  validateDynamicLaneManifest(manifest, {currentSourceCommit, currentSourceTree});
  requireIdentifier(lane_id, "lane_id");
  const lane = manifest.lanes.find((candidate) => candidate.lane_id === lane_id);
  assert(lane, "LANE_NOT_FOUND", `lane ${lane_id} is not admitted by the manifest`, {lane_id});
  validateRoleCatalogBinding(roleGovernanceLibrary, manifest);
  const role = selectedRoleRecord(roleGovernanceLibrary, lane);
  const packet = rolePacketBody({manifest, lane, roleGovernanceLibrary, role});
  packet.packet_sha256 = digestWithout(packet, "packet_sha256");
  return validateRolePacketShape(packet, {manifest});
}

export function selectDynamicLaneRolePackets({manifest, roleGovernanceLibrary, current_source_commit, current_source_tree} = {}) {
  const currentSourceCommit = current_source_commit ?? manifest?.source_commit;
  const currentSourceTree = current_source_tree ?? manifest?.source_tree;
  validateDynamicLaneManifest(manifest, {currentSourceCommit, currentSourceTree});
  return manifest.lanes.map((lane) => selectDynamicLaneRolePacket({manifest, lane_id: lane.lane_id, roleGovernanceLibrary, current_source_commit: currentSourceCommit, current_source_tree: currentSourceTree}));
}

export function validateDynamicLaneRolePacket(packet, {manifest = null} = {}) {
  return validateRolePacketShape(packet, {manifest});
}

export function validateLaneWriteSet(scope, changedPaths) {
  validateScope(scope, "lane scope");
  assert(Array.isArray(changedPaths), "INVALID_WRITE_SET", "changedPaths must be an array");
  const normalizedPaths = changedPaths.map((value, index) => normalizeProjectPath(value, `changedPaths[${index}]`));
  for (const changedPath of normalizedPaths) {
    assert(scope.write.some((writeRoot) => pathWithin(writeRoot, changedPath)), "LANE_SCOPE_VIOLATION", `changed path ${changedPath} is outside the lane write scope`, {changedPath});
    assert(!scope.protected.some((protectedRoot) => pathWithin(protectedRoot, changedPath)), "LANE_SCOPE_VIOLATION", `changed path ${changedPath} intersects a protected scope`, {changedPath});
  }
  return true;
}
