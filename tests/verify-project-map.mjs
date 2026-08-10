#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {scanPersistedRecord} from "../control/content-addressing.mjs";
import {
  CONTRACT_STATUS,
  PROJECT_MAP_COMPILER_SHA256,
  PROJECT_MAP_SCHEMA,
  compileProjectMap,
  validateProjectMap,
} from "../control/project-map.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schema = JSON.parse(fs.readFileSync(path.join(root, "schemas/project-map.v1.json"), "utf8"));
assert.equal(schema.status, CONTRACT_STATUS);
assert.equal(schema.controller, "control/project-map.mjs");
assert.equal(schema.activation.active, false);
assert.equal(schema.project_map.schema, PROJECT_MAP_SCHEMA);
assert.equal(schema.project_map.advisory_only, true);
assert.equal(schema.project_map.acceptance_authority, false);

const sourceCommit = "a".repeat(40);
const sourceTree = "b".repeat(40);
const sourceSnapshotSha256 = "c".repeat(64);
const policySha256 = "d".repeat(64);
const recordA = "e".repeat(64);
const recordB = "f".repeat(64);
const roleScope = ["ORCHESTRATOR", "OWNER"];

function node(nodeId, label, sourceRecordDigest, roles = roleScope) {
  return {
    node_id: nodeId,
    node_kind: nodeId.startsWith("PROJECT") ? "PROJECT" : "GOAL",
    label,
    status: "CURRENT",
    source_record_digests: [sourceRecordDigest],
    epistemic_class: "DERIVED",
    role_scope: roles,
  };
}

function edge(edgeId, fromNodeId, toNodeId) {
  return {
    edge_id: edgeId,
    from_node_id: fromNodeId,
    to_node_id: toNodeId,
    edge_kind: "CONTAINS",
    source_record_digests: [recordA],
    epistemic_class: "DIRECT",
    role_scope: roleScope,
  };
}

const nodes = [
  node("PROJECT-1", "Project root", recordA, ["OWNER"]),
  node("GOAL-2", "Goal outcome", recordB),
];
const edges = [edge("EDGE-1", "PROJECT-1", "GOAL-2")];
const compileArgs = {
  mapId: "MAP-1",
  projectRef: "PROJECT-1",
  campaignRef: "CAMPAIGN-1",
  goalRef: "GOAL-2",
  mapKind: "WORKFLOW",
  roleScope,
  sourceCommit,
  sourceTree,
  sourceSnapshotSha256,
  policySha256,
  nodes,
  edges,
  selectedRoots: ["PROJECT-1"],
};

const projectMap = compileProjectMap(compileArgs);
assert.equal(projectMap.schema, PROJECT_MAP_SCHEMA);
assert.equal(projectMap.contract_status, CONTRACT_STATUS);
assert.equal(projectMap.advisory_only, true);
assert.equal(projectMap.acceptance_authority, false);
assert.equal(projectMap.compiler_sha256, PROJECT_MAP_COMPILER_SHA256);
assert.equal(projectMap.status, "READY");
assert.equal(projectMap.coverage, "COMPLETE");
assert.deepEqual(projectMap.nodes.map((entry) => entry.node_id), ["GOAL-2", "PROJECT-1"]);
assert.deepEqual(projectMap.edges.map((entry) => entry.edge_id), ["EDGE-1"]);
assert.doesNotThrow(() => validateProjectMap(projectMap, {
  currentSourceCommit: sourceCommit,
  currentSourceTree: sourceTree,
  currentSourceSnapshotSha256: sourceSnapshotSha256,
  currentPolicySha256: policySha256,
}));
assert.equal(scanPersistedRecord(projectMap).safe, true);

const rebuiltMap = compileProjectMap({...compileArgs, nodes: [...nodes].reverse(), edges: [...edges].reverse()});
assert.deepEqual(rebuiltMap, projectMap, "map compilation must be independent of input order");

const boundedMap = compileProjectMap({
  ...compileArgs,
  nodes: [...nodes, node("GOAL-3", "Another outcome", recordA)],
  edges: [...edges, edge("EDGE-2", "PROJECT-1", "GOAL-3")],
  maxNodes: 2,
  maxEdges: 10,
});
assert.equal(boundedMap.status, "BOUNDED_PARTIAL");
assert.equal(boundedMap.coverage, "BOUNDED_PARTIAL");
assert.equal(boundedMap.bounds.truncated, true);
assert.equal(boundedMap.bounds.omitted_node_count, 1);
assert.equal(boundedMap.bounds.omitted_edge_count, 1);
assert.ok(boundedMap.omissions.length >= 2);
assert.doesNotThrow(() => validateProjectMap(boundedMap));

const staleMap = structuredClone(projectMap);
staleMap.source_snapshot_sha256 = "1".repeat(64);
assert.throws(
  () => validateProjectMap(staleMap, {currentSourceSnapshotSha256: sourceSnapshotSha256}),
  /source snapshot is stale/u,
);

const conflictMap = compileProjectMap({
  ...compileArgs,
  conflicts: [{code: "SOURCE_CONFLICT", subject_ref: "GOAL-2", detail: "Two source records disagree."}],
});
assert.equal(conflictMap.status, "CONFLICT");
assert.equal(conflictMap.coverage, "CONFLICT");
assert.doesNotThrow(() => validateProjectMap(conflictMap));

const unavailableMap = compileProjectMap({
  ...compileArgs,
  nodes: [],
  edges: [],
  selectedRoots: [],
  unavailableNotices: [{code: "NO_SOURCE", subject_ref: null, detail: "No safe source records were available."}],
});
assert.equal(unavailableMap.status, "UNAVAILABLE");
assert.equal(unavailableMap.coverage, "UNAVAILABLE");
assert.equal(unavailableMap.nodes.length, 0);
assert.doesNotThrow(() => validateProjectMap(unavailableMap));

const syntheticPath = ["", "synthetic", "private", "record"].join("/");
assert.throws(
  () => compileProjectMap({...compileArgs, nodes: [node("PROJECT-1", syntheticPath, recordA, ["OWNER"]), node("GOAL-2", "Goal outcome", recordB)]}),
  /privacy-safe|ABSOLUTE_PATH/u,
);
const syntheticIdentity = ["00000000", "0000", "4000", "8000", "000000000000"].join("-");
assert.throws(
  () => compileProjectMap({...compileArgs, mapId: syntheticIdentity}),
  /session|task|SESSION_OR_TASK_IDENTITY/u,
);
assert.throws(
  () => compileProjectMap({...compileArgs, edges: [edge("EDGE-1", "PROJECT-1", "UNKNOWN-1")]}),
  /unknown target node/u,
);
const unauthorizedMap = structuredClone(projectMap);
unauthorizedMap.acceptance_authority = true;
assert.throws(() => validateProjectMap(unauthorizedMap), /acceptance authority/u);

console.log("PASS project map: deterministic, bounded, source-bound, privacy-safe, advisory-only behavior verified");
