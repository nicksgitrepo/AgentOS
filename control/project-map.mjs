#!/usr/bin/env node

/*
 * Portable project-map compiler. The compiler consumes an already-scoped,
 * typed snapshot; it never reads a repository, host, session, or transcript.
 * The resulting graph is advisory projection data, not governance authority.
 */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";
import {
  CONTRACT_STATUS,
  CONTROL_SPACE,
  assert,
  assertSafeRecord,
  digestWithout,
  exactKeys,
  requireGitObject,
  requireIdentifier,
  requireNullableIdentifier,
  requireRecord,
  requireSafeInteger,
  requireSafeText,
  requireSha,
  requireSortedUniqueDigests,
  requireSortedUniqueStrings,
  sortByUtf8,
  sortNotices,
  validateSortedNotices,
} from "./map-memory-common.mjs";

export {CONTRACT_STATUS} from "./map-memory-common.mjs";

export const PROJECT_MAP_SCHEMA = "governance.project_map.v1";
export const PROJECT_MAP_VERSION = 1;
export const PROJECT_MAP_COMPILER_ID = "agentos.project_map.compiler.v1";
export const PROJECT_MAP_COMPILER_SHA256 = canonicalDigest({
  compiler: PROJECT_MAP_COMPILER_ID,
  version: PROJECT_MAP_VERSION,
  rules: [
    "typed-input-only",
    "utf8-sorted-graph",
    "bounded-node-and-edge-counts",
    "source-digest-bound",
    "advisory-only",
  ],
});

export const PROJECT_MAP_KINDS = Object.freeze([
  "DEPENDENCY",
  "AUTHORITY",
  "WORKFLOW",
  "FEATURE_COVERAGE",
  "RECOVERY",
  "COMPOSITE",
]);
export const PROJECT_MAP_STATUSES = Object.freeze([
  "READY",
  "BOUNDED_PARTIAL",
  "STALE",
  "CONFLICT",
  "UNAVAILABLE",
]);
export const PROJECT_MAP_COVERAGE = Object.freeze([
  "COMPLETE",
  "BOUNDED_PARTIAL",
  "CONFLICT",
  "UNAVAILABLE",
]);
export const NODE_STATUSES = Object.freeze([
  "CURRENT",
  "BLOCKED",
  "COMPLETE",
  "UNKNOWN",
  "ARCHIVED",
]);
export const EPISTEMIC_CLASSES = Object.freeze([
  "DIRECT",
  "DERIVED",
  "INFERRED",
  "OWNER_STATED",
  "UNAVAILABLE",
]);

const MAP_KEYS = [
  "schema", "version", "contract_status", "visibility", "advisory_only", "acceptance_authority",
  "map_id", "project_ref", "campaign_ref", "goal_ref", "map_kind", "role_scope",
  "source_commit", "source_tree", "source_snapshot_sha256", "policy_sha256", "compiler_sha256",
  "status", "coverage", "bounds", "stale_source_digests", "nodes", "edges", "omissions",
  "uncertainties", "conflicts", "map_sha256",
];
const BOUNDS_KEYS = [
  "max_nodes", "max_edges", "selected_roots", "omitted_node_count", "omitted_edge_count", "truncated",
];
const NODE_KEYS = ["node_id", "node_kind", "label", "status", "source_record_digests", "epistemic_class", "role_scope"];
const EDGE_KEYS = ["edge_id", "from_node_id", "to_node_id", "edge_kind", "source_record_digests", "epistemic_class", "role_scope"];
const NOTICE_KEYS = ["code", "subject_ref", "detail"];

function validateRoleScope(value, label, mapRoleScope = null) {
  requireSortedUniqueStrings(value, label, {validator: requireIdentifier});
  if (mapRoleScope !== null) {
    for (const role of value) assert(mapRoleScope.includes(role), `${label} contains a role outside the map scope`);
  }
  return value;
}

function validateNode(node, index, mapRoleScope) {
  exactKeys(node, NODE_KEYS, `project map node ${index}`);
  requireIdentifier(node.node_id, `project map node ${index} ID`);
  requireIdentifier(node.node_kind, `project map node ${node.node_id} kind`);
  requireSafeText(node.label, `project map node ${node.node_id} label`, {maxLength: 256});
  assert(NODE_STATUSES.includes(node.status), `project map node ${node.node_id} status is invalid`);
  requireSortedUniqueDigests(node.source_record_digests, `project map node ${node.node_id} source records`);
  assert(EPISTEMIC_CLASSES.includes(node.epistemic_class), `project map node ${node.node_id} epistemic class is invalid`);
  validateRoleScope(node.role_scope, `project map node ${node.node_id} role scope`, mapRoleScope);
}

function validateEdge(edge, index, nodeIds, mapRoleScope) {
  exactKeys(edge, EDGE_KEYS, `project map edge ${index}`);
  requireIdentifier(edge.edge_id, `project map edge ${index} ID`);
  requireIdentifier(edge.from_node_id, `project map edge ${edge.edge_id} source`);
  requireIdentifier(edge.to_node_id, `project map edge ${edge.edge_id} target`);
  assert(nodeIds.has(edge.from_node_id), `project map edge ${edge.edge_id} has an unknown source node`);
  assert(nodeIds.has(edge.to_node_id), `project map edge ${edge.edge_id} has an unknown target node`);
  requireIdentifier(edge.edge_kind, `project map edge ${edge.edge_id} kind`);
  requireSortedUniqueDigests(edge.source_record_digests, `project map edge ${edge.edge_id} source records`);
  assert(EPISTEMIC_CLASSES.includes(edge.epistemic_class), `project map edge ${edge.edge_id} epistemic class is invalid`);
  validateRoleScope(edge.role_scope, `project map edge ${edge.edge_id} role scope`, mapRoleScope);
}

function validateBounds(bounds, nodeCount, edgeCount) {
  exactKeys(bounds, BOUNDS_KEYS, "project map bounds");
  requireSafeInteger(bounds.max_nodes, "project map maximum nodes", {min: 1, max: 100000});
  requireSafeInteger(bounds.max_edges, "project map maximum edges", {min: 1, max: 100000});
  requireSortedUniqueStrings(bounds.selected_roots, "project map selected roots", {allowEmpty: true, validator: requireIdentifier});
  requireSafeInteger(bounds.omitted_node_count, "project map omitted node count", {min: 0, max: 100000});
  requireSafeInteger(bounds.omitted_edge_count, "project map omitted edge count", {min: 0, max: 100000});
  assert(typeof bounds.truncated === "boolean", "project map bounds truncated flag is invalid");
  assert(nodeCount <= bounds.max_nodes, "project map exceeds its node bound");
  assert(edgeCount <= bounds.max_edges, "project map exceeds its edge bound");
  assert(bounds.truncated === (bounds.omitted_node_count > 0 || bounds.omitted_edge_count > 0), "project map truncation flag is inconsistent");
  return bounds;
}

function validateMapState(projectMap) {
  const {status, coverage, bounds, stale_source_digests: stale, omissions, uncertainties, conflicts, nodes, edges} = projectMap;
  assert(PROJECT_MAP_STATUSES.includes(status), "project map status is invalid");
  assert(PROJECT_MAP_COVERAGE.includes(coverage), "project map coverage is invalid");
  const hasPartialEvidence = bounds.truncated || omissions.length > 0 || uncertainties.length > 0;

  if (coverage === "COMPLETE") {
    assert(!hasPartialEvidence, "complete project map has omissions or uncertainties");
    assert(conflicts.length === 0, "complete project map has conflicts");
    assert(status === "READY" || status === "STALE", "complete project map has an incompatible status");
  }
  if (coverage === "BOUNDED_PARTIAL") {
    assert(hasPartialEvidence, "bounded-partial project map has no bounded or uncertain evidence");
    assert(conflicts.length === 0, "bounded-partial project map has conflicts");
    assert(status === "BOUNDED_PARTIAL" || status === "STALE", "bounded-partial project map has an incompatible status");
  }
  if (coverage === "CONFLICT") {
    assert(conflicts.length > 0, "conflict project map has no conflict notices");
    assert(status === "CONFLICT", "conflict project map has an incompatible status");
    assert(stale.length === 0, "conflict project map cannot also claim stale sources");
  }
  if (coverage === "UNAVAILABLE") {
    assert(nodes.length === 0 && edges.length === 0, "unavailable project map contains graph data");
    assert(omissions.length > 0 || uncertainties.length > 0, "unavailable project map has no reason notice");
    assert(status === "UNAVAILABLE", "unavailable project map has an incompatible status");
    assert(conflicts.length === 0 && stale.length === 0, "unavailable project map has conflicts or stale sources");
  }
  if (status === "READY") {
    assert(coverage === "COMPLETE", "ready project map must be complete");
    assert(nodes.length > 0, "ready project map must contain a node");
    assert(stale.length === 0, "ready project map has stale sources");
  }
  if (status === "BOUNDED_PARTIAL") assert(coverage === "BOUNDED_PARTIAL", "bounded-partial status requires bounded-partial coverage");
  if (status === "STALE") assert(stale.length > 0, "stale project map has no stale source digest");
  if (status === "CONFLICT") assert(conflicts.length > 0, "conflict project map has no conflict notice");
  if (status === "UNAVAILABLE") assert(nodes.length === 0 && edges.length === 0, "unavailable project map contains graph data");
}

export function validateProjectMap(projectMap, {
  currentSourceCommit = null,
  currentSourceTree = null,
  currentSourceSnapshotSha256 = null,
  currentPolicySha256 = null,
} = {}) {
  requireRecord(projectMap, "project map");
  assertSafeRecord(projectMap, "project map");
  exactKeys(projectMap, MAP_KEYS, "project map");
  assert(projectMap.schema === PROJECT_MAP_SCHEMA, "project map schema mismatch");
  assert(projectMap.version === PROJECT_MAP_VERSION, "project map version mismatch");
  assert(projectMap.contract_status === CONTRACT_STATUS, "project map is active or has an invalid contract status");
  assert(projectMap.visibility === CONTROL_SPACE, "project map must remain in control space");
  assert(projectMap.advisory_only === true, "project map must be advisory-only");
  assert(projectMap.acceptance_authority === false, "project map cannot be acceptance authority");
  requireIdentifier(projectMap.map_id, "project map ID");
  requireIdentifier(projectMap.project_ref, "project map project reference");
  requireNullableIdentifier(projectMap.campaign_ref, "project map campaign reference");
  requireNullableIdentifier(projectMap.goal_ref, "project map goal reference");
  assert(PROJECT_MAP_KINDS.includes(projectMap.map_kind), "project map kind is invalid");
  const mapRoleScope = validateRoleScope(projectMap.role_scope, "project map role scope");
  requireGitObject(projectMap.source_commit, "project map source commit");
  requireGitObject(projectMap.source_tree, "project map source tree");
  requireSha(projectMap.source_snapshot_sha256, "project map source snapshot");
  requireSha(projectMap.policy_sha256, "project map policy digest");
  requireSha(projectMap.compiler_sha256, "project map compiler digest");
  assert(projectMap.compiler_sha256 === PROJECT_MAP_COMPILER_SHA256, "project map compiler digest mismatch");

  if (currentSourceCommit !== null) {
    requireGitObject(currentSourceCommit, "current source commit");
    assert(projectMap.source_commit === currentSourceCommit, "project map source commit is stale");
  }
  if (currentSourceTree !== null) {
    requireGitObject(currentSourceTree, "current source tree");
    assert(projectMap.source_tree === currentSourceTree, "project map source tree is stale");
  }
  if (currentSourceSnapshotSha256 !== null) {
    requireSha(currentSourceSnapshotSha256, "current source snapshot");
    assert(projectMap.source_snapshot_sha256 === currentSourceSnapshotSha256, "project map source snapshot is stale");
  }
  if (currentPolicySha256 !== null) {
    requireSha(currentPolicySha256, "current policy digest");
    assert(projectMap.policy_sha256 === currentPolicySha256, "project map policy is stale");
  }

  assert(Array.isArray(projectMap.nodes), "project map nodes must be an array");
  assert(Array.isArray(projectMap.edges), "project map edges must be an array");
  assert(Array.isArray(projectMap.stale_source_digests), "project map stale source digests must be an array");
  validateBounds(projectMap.bounds, projectMap.nodes.length, projectMap.edges.length);
  const nodeIds = new Set();
  projectMap.nodes.forEach((node, index) => {
    validateNode(node, index, mapRoleScope);
    assert(!nodeIds.has(node.node_id), `project map nodes contain duplicate ${node.node_id}`);
    nodeIds.add(node.node_id);
  });
  assert(JSON.stringify(projectMap.nodes.map((node) => node.node_id)) === JSON.stringify([...nodeIds].sort(compareUtf8)), "project map nodes must be UTF-8 sorted");
  projectMap.edges.forEach((edge, index) => validateEdge(edge, index, nodeIds, mapRoleScope));
  const edgeIds = projectMap.edges.map((edge) => edge.edge_id);
  assert(new Set(edgeIds).size === edgeIds.length, "project map edges contain duplicates");
  assert(JSON.stringify(edgeIds) === JSON.stringify([...edgeIds].sort(compareUtf8)), "project map edges must be UTF-8 sorted");
  for (const root of projectMap.bounds.selected_roots) assert(nodeIds.has(root), `project map selected root ${root} is unknown`);

  requireSortedUniqueDigests(projectMap.stale_source_digests, "project map stale source digests", {allowEmpty: true});
  validateSortedNotices(projectMap.omissions, "project map omissions");
  validateSortedNotices(projectMap.uncertainties, "project map uncertainties");
  validateSortedNotices(projectMap.conflicts, "project map conflicts");
  validateMapState(projectMap);
  requireSha(projectMap.map_sha256, "project map digest");
  assert(projectMap.map_sha256 === digestWithout(projectMap, "map_sha256"), "project map digest mismatch");
  return projectMap;
}

function normalizeNotice(value, index, label) {
  requireRecord(value, `${label} ${index}`);
  exactKeys(value, NOTICE_KEYS, `${label} ${index}`);
  const notice = {
    code: value.code,
    subject_ref: value.subject_ref ?? null,
    detail: value.detail,
  };
  validateSortedNotices([notice], label);
  return notice;
}

function normalizeNode(value, index, mapRoleScope) {
  requireRecord(value, `project map node ${index}`);
  validateNode(value, index, mapRoleScope);
  return structuredClone(value);
}

function normalizeEdge(value, index, nodeIds, mapRoleScope) {
  requireRecord(value, `project map edge ${index}`);
  validateEdge(value, index, nodeIds, mapRoleScope);
  return structuredClone(value);
}

function normalizeBounds({maxNodes, maxEdges}) {
  requireSafeInteger(maxNodes, "project map maximum nodes", {min: 1, max: 100000});
  requireSafeInteger(maxEdges, "project map maximum edges", {min: 1, max: 100000});
  return {max_nodes: maxNodes, max_edges: maxEdges};
}

export function compileProjectMap({
  mapId,
  projectRef,
  campaignRef = null,
  goalRef = null,
  mapKind = "COMPOSITE",
  roleScope,
  sourceCommit,
  sourceTree,
  sourceSnapshotSha256,
  policySha256,
  nodes,
  edges,
  selectedRoots = [],
  maxNodes = 256,
  maxEdges = 512,
  staleSourceDigests = [],
  omissions = [],
  uncertainties = [],
  conflicts = [],
  unavailableNotices = [],
}) {
  requireIdentifier(mapId, "project map ID");
  requireIdentifier(projectRef, "project map project reference");
  requireNullableIdentifier(campaignRef, "project map campaign reference");
  requireNullableIdentifier(goalRef, "project map goal reference");
  assert(PROJECT_MAP_KINDS.includes(mapKind), "project map kind is invalid");
  validateRoleScope(roleScope, "project map role scope");
  requireGitObject(sourceCommit, "project map source commit");
  requireGitObject(sourceTree, "project map source tree");
  requireSha(sourceSnapshotSha256, "project map source snapshot");
  requireSha(policySha256, "project map policy digest");
  const boundsInput = normalizeBounds({maxNodes, maxEdges});
  assert(Array.isArray(nodes), "project map nodes must be an array");
  assert(Array.isArray(edges), "project map edges must be an array");
  assert(Array.isArray(selectedRoots), "project map selected roots must be an array");
  requireSortedUniqueStrings(selectedRoots, "project map selected roots", {allowEmpty: true, validator: requireIdentifier});
  requireSortedUniqueDigests(staleSourceDigests, "project map stale source digests", {allowEmpty: true});

  const normalizedNodes = nodes.map((node, index) => normalizeNode(node, index, roleScope));
  const sortedNodes = sortByUtf8(normalizedNodes, (node) => node.node_id);
  const sourceNodeIds = new Set();
  for (const node of sortedNodes) {
    assert(!sourceNodeIds.has(node.node_id), `project map nodes contain duplicate ${node.node_id}`);
    sourceNodeIds.add(node.node_id);
  }
  for (const root of selectedRoots) assert(sourceNodeIds.has(root), `project map selected root ${root} is unknown`);
  const normalizedEdges = edges.map((edge, index) => normalizeEdge(edge, index, sourceNodeIds, roleScope));
  const sortedEdges = sortByUtf8(normalizedEdges, (edge) => edge.edge_id);
  const edgeIds = new Set();
  for (const edge of sortedEdges) {
    assert(!edgeIds.has(edge.edge_id), `project map edges contain duplicate ${edge.edge_id}`);
    edgeIds.add(edge.edge_id);
  }

  const prioritizedIds = [
    ...selectedRoots,
    ...sortedNodes.map((node) => node.node_id).filter((nodeId) => !selectedRoots.includes(nodeId)),
  ];
  assert(selectedRoots.length <= boundsInput.max_nodes, "project map selected roots exceed the node bound");
  const keptNodeIds = new Set(prioritizedIds.slice(0, boundsInput.max_nodes));
  const keptNodes = sortedNodes.filter((node) => keptNodeIds.has(node.node_id));
  const omittedNodeCount = sortedNodes.length - keptNodes.length;
  const retainedEdgesBeforeBound = sortedEdges.filter((edge) => keptNodeIds.has(edge.from_node_id) && keptNodeIds.has(edge.to_node_id));
  const keptEdges = retainedEdgesBeforeBound.slice(0, boundsInput.max_edges);
  const omittedEdgeCount = sortedEdges.length - keptEdges.length;
  const generatedOmissions = [];
  if (omittedNodeCount > 0) generatedOmissions.push({code: "NODE_BOUND", subject_ref: null, detail: `Node bound omitted ${omittedNodeCount} source node records.`});
  if (omittedEdgeCount > 0) generatedOmissions.push({code: "EDGE_BOUND", subject_ref: null, detail: `Edge bound omitted ${omittedEdgeCount} source edge records.`});

  const normalizedOmissions = omissions.map((notice, index) => normalizeNotice(notice, index, "project map omission"));
  const normalizedUncertainties = uncertainties.map((notice, index) => normalizeNotice(notice, index, "project map uncertainty"));
  const normalizedConflicts = conflicts.map((notice, index) => normalizeNotice(notice, index, "project map conflict"));
  const normalizedUnavailable = unavailableNotices.map((notice, index) => normalizeNotice(notice, index, "project map unavailable notice"));
  assert(!(normalizedConflicts.length > 0 && staleSourceDigests.length > 0), "project map conflicts cannot be combined with stale sources");
  assert(!(normalizedConflicts.length > 0 && normalizedUnavailable.length > 0), "project map conflicts cannot be combined with unavailable notices");
  assert(!(staleSourceDigests.length > 0 && normalizedUnavailable.length > 0), "project map stale sources cannot be combined with unavailable notices");

  let finalOmissions = [...normalizedOmissions, ...generatedOmissions];
  let finalUncertainties = [...normalizedUncertainties];
  let finalCoverage;
  let finalStatus;
  if (normalizedConflicts.length > 0) {
    finalCoverage = "CONFLICT";
    finalStatus = "CONFLICT";
  } else if (keptNodes.length === 0 && normalizedUnavailable.length > 0) {
    finalOmissions = [...finalOmissions, ...normalizedUnavailable];
    finalCoverage = "UNAVAILABLE";
    finalStatus = "UNAVAILABLE";
  } else {
    if (normalizedUnavailable.length > 0) finalUncertainties = [...finalUncertainties, ...normalizedUnavailable];
    const partial = omittedNodeCount > 0 || omittedEdgeCount > 0 || finalOmissions.length > 0 || finalUncertainties.length > 0;
    finalCoverage = partial ? "BOUNDED_PARTIAL" : "COMPLETE";
    finalStatus = staleSourceDigests.length > 0 ? "STALE" : (partial ? "BOUNDED_PARTIAL" : "READY");
  }
  if (keptNodes.length === 0 && finalCoverage !== "UNAVAILABLE") throw new Error("project map must contain a node or an unavailable notice");

  const projectMap = {
    schema: PROJECT_MAP_SCHEMA,
    version: PROJECT_MAP_VERSION,
    contract_status: CONTRACT_STATUS,
    visibility: CONTROL_SPACE,
    advisory_only: true,
    acceptance_authority: false,
    map_id: mapId,
    project_ref: projectRef,
    campaign_ref: campaignRef,
    goal_ref: goalRef,
    map_kind: mapKind,
    role_scope: [...roleScope].sort(compareUtf8),
    source_commit: sourceCommit,
    source_tree: sourceTree,
    source_snapshot_sha256: sourceSnapshotSha256,
    policy_sha256: policySha256,
    compiler_sha256: PROJECT_MAP_COMPILER_SHA256,
    status: finalStatus,
    coverage: finalCoverage,
    bounds: {
      max_nodes: boundsInput.max_nodes,
      max_edges: boundsInput.max_edges,
      selected_roots: [...selectedRoots].sort(compareUtf8),
      omitted_node_count: omittedNodeCount,
      omitted_edge_count: omittedEdgeCount,
      truncated: omittedNodeCount > 0 || omittedEdgeCount > 0,
    },
    stale_source_digests: [...staleSourceDigests],
    nodes: sortByUtf8(keptNodes, (node) => node.node_id),
    edges: sortByUtf8(keptEdges, (edge) => edge.edge_id),
    omissions: sortNotices(finalOmissions),
    uncertainties: sortNotices(finalUncertainties),
    conflicts: sortNotices(normalizedConflicts),
    map_sha256: null,
  };
  projectMap.map_sha256 = digestWithout(projectMap, "map_sha256");
  assertSafeRecord(projectMap, "compiled project map");
  return validateProjectMap(projectMap, {
    currentSourceCommit: sourceCommit,
    currentSourceTree: sourceTree,
    currentSourceSnapshotSha256: sourceSnapshotSha256,
    currentPolicySha256: policySha256,
  });
}
