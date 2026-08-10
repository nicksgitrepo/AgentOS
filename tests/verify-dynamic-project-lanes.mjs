#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {
  DYNAMIC_DEPENDENCY_GRAPH_SCHEMA,
  DYNAMIC_LANE_MANIFEST_SCHEMA,
  DYNAMIC_ROLE_PACKET_SCHEMA,
  DynamicLaneBoundaryError,
  compileDynamicDependencyGraph,
  compileDynamicLaneManifest,
  discoverDynamicLanes,
  selectDynamicLaneRolePacket,
  selectDynamicLaneRolePackets,
  validateDynamicLaneManifest,
  validateDynamicLaneRolePacket,
  validateDynamicDependencyGraph,
  validateLaneWriteSet,
} from "../control/dynamic-project-lanes.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_COMMIT = "a".repeat(40);
const SOURCE_TREE = "b".repeat(40);
const PLAN_SHA256 = "c".repeat(64);
const GOVERNANCE_SHA256 = "d".repeat(64);

function capability({capability_id, lane_kind, name, version, admission_status = "ADMITTED", depends_on = [], write, read = [write], protected_paths = []}) {
  return {
    capability_id,
    lane_kind,
    name,
    version,
    admission_status,
    governance: {
      graph_ids: [`${lane_kind}_GOVERNANCE`],
      question_ids: [`Q-${capability_id}`],
    },
    scope: {read, write: [write], protected: protected_paths},
    depends_on,
  };
}

const inputs = [
  capability({capability_id: "DATA_STORE", lane_kind: "CAPABILITY", name: "Data Store", version: "1.0.0", write: "src/data"}),
  capability({capability_id: "CHECKOUT", lane_kind: "FEATURE", name: "Checkout", version: "2.1.0", write: "src/checkout", depends_on: [{capability_id: "DATA_STORE", version: "1.0.0"}]}),
  capability({capability_id: "REPORTING", lane_kind: "FEATURE", name: "Reporting", version: "1.0.0", write: "src/reporting", depends_on: [{capability_id: "CHECKOUT", version: "2.1.0"}]}),
  capability({capability_id: "LATER", lane_kind: "FEATURE", name: "Later", version: "1.0.0", admission_status: "NOT_ADMITTED", write: "src/later"}),
];

const discovered = discoverDynamicLanes({admitted_capabilities: inputs});
assert.deepEqual(discovered.map((lane) => lane.lane_id), [
  "CAPABILITY_DATA_STORE_V1_0_0",
  "FEATURE_CHECKOUT_V2_1_0",
  "FEATURE_REPORTING_V1_0_0",
]);
assert.equal(discovered.find((lane) => lane.lane_id === "FEATURE_CHECKOUT_V2_1_0").display_name, "Checkout v2.1.0");
assert.equal(discovered.some((lane) => lane.capability_id === "LATER"), false);

const compiled = compileDynamicLaneManifest({
  project_id: "PROJECT_DYNAMIC_LANES",
  campaign_id: "CAMPAIGN_DYNAMIC_LANES",
  goal_id: "GOAL_DYNAMIC_LANES",
  source_commit: SOURCE_COMMIT,
  source_tree: SOURCE_TREE,
  bootstrap_plan_sha256: PLAN_SHA256,
  project_governance_sha256: GOVERNANCE_SHA256,
  admitted_capabilities: inputs,
});
const manifest = compiled;
assert.equal(manifest.schema, DYNAMIC_LANE_MANIFEST_SCHEMA);
assert.equal(manifest.lanes.length, 3);
assert.equal(manifest.dependency_graph.schema, DYNAMIC_DEPENDENCY_GRAPH_SCHEMA);
assert.deepEqual(manifest.dependency_graph.waves, [
  ["CAPABILITY_DATA_STORE_V1_0_0"],
  ["FEATURE_CHECKOUT_V2_1_0"],
  ["FEATURE_REPORTING_V1_0_0"],
]);
assert.doesNotThrow(() => validateDynamicLaneManifest(manifest, {currentSourceCommit: SOURCE_COMMIT, currentSourceTree: SOURCE_TREE}));
assert.doesNotThrow(() => validateDynamicDependencyGraph(manifest.dependency_graph, {currentSourceCommit: SOURCE_COMMIT, currentSourceTree: SOURCE_TREE}));

const roleFor = (lane) => ({
  role_id: `WORKER_${lane.lane_id}`,
  public_name: `One-Lane Worker: ${lane.lane_id}`,
  role_scope: "CAMPAIGN",
  role_kind: "ONE_LANE_WORKER",
  lane_id: lane.lane_id,
  shared_clause_ids: ["GENERAL_EVIDENCE_IDENTITY"],
  question_ids: [...lane.governance.question_ids],
  universal_task_gate_question_ids: ["TASK-START-001"],
  generated_rules: lane.governance.question_ids.map((question_id) => ({rule_id: `WORKER_${lane.lane_id}:${question_id}`, question_id})),
});

const roleGovernanceLibrary = {
  source_commit: SOURCE_COMMIT,
  source_tree: SOURCE_TREE,
  bootstrap_plan_sha256: PLAN_SHA256,
  role_definition_source_sha256: GOVERNANCE_SHA256,
  roles: [
    {role_id: "CAMPAIGN_ORCHESTRATOR"},
    {role_id: "INDEPENDENT_AUDITOR"},
    {role_id: "INTENT_REGULATOR"},
    {role_id: "RUNTIME"},
    ...manifest.lanes.map(roleFor),
  ],
  digest: "e".repeat(64),
};

const packets = selectDynamicLaneRolePackets({manifest, roleGovernanceLibrary});
assert.equal(packets.length, manifest.lanes.length);
assert.deepEqual(packets.map((packet) => packet.role_id), [
  "WORKER_CAPABILITY_DATA_STORE_V1_0_0",
  "WORKER_FEATURE_CHECKOUT_V2_1_0",
  "WORKER_FEATURE_REPORTING_V1_0_0",
]);
assert.equal(packets.find((packet) => packet.lane_kind === "CAPABILITY").lease_policy, "CAMPAIGN_LOCAL_SEQUENTIAL");
assert.equal(packets.find((packet) => packet.lane_kind === "FEATURE").lease_policy, "ONE_ACTIVE_ASSIGNMENT");
assert.equal(packets[0].schema, DYNAMIC_ROLE_PACKET_SCHEMA);
assert.doesNotThrow(() => validateDynamicLaneRolePacket(packets[0], {manifest}));
assert.doesNotThrow(() => validateDynamicLaneManifest(manifest));
assert.doesNotThrow(() => validateDynamicDependencyGraph(manifest.dependency_graph));
assert.throws(() => selectDynamicLaneRolePacket({manifest, lane_id: manifest.lanes[0].lane_id, roleGovernanceLibrary, current_source_commit: SOURCE_COMMIT, current_source_tree: "f".repeat(40)}), /STALE_SOURCE_BINDING/u);

const changed = packets.find((packet) => packet.lane_id === "FEATURE_CHECKOUT_V2_1_0");
assert.doesNotThrow(() => validateLaneWriteSet(changed.scope, ["src/checkout/cart.mjs"]));
assert.throws(() => validateLaneWriteSet(changed.scope, ["src/data/schema.mjs"]), (error) => error instanceof DynamicLaneBoundaryError && error.code === "LANE_SCOPE_VIOLATION");

const staleManifest = structuredClone(manifest);
staleManifest.source_tree = "f".repeat(40);
staleManifest.digest = "0".repeat(64);
assert.throws(() => validateDynamicLaneManifest(staleManifest, {currentSourceCommit: SOURCE_COMMIT, currentSourceTree: SOURCE_TREE}), /STALE_SOURCE_BINDING/u);

const duplicate = [...inputs, capability({capability_id: "CHECKOUT", lane_kind: "FEATURE", name: "Checkout Duplicate", version: "2.1.0", write: "src/other"})];
assert.throws(() => discoverDynamicLanes({admitted_capabilities: duplicate}), /DUPLICATE_CAPABILITY_ADMISSION/u);
assert.throws(() => discoverDynamicLanes({admitted_capabilities: [
  capability({capability_id: "VERSIONED", lane_kind: "FEATURE", name: "Versioned", version: "1.0.0", write: "src/v1"}),
  capability({capability_id: "VERSIONED", lane_kind: "FEATURE", name: "Versioned", version: "2.0.0", write: "src/v2"}),
]}), /DUPLICATE_CAPABILITY_LANE/u);
assert.throws(() => discoverDynamicLanes({admitted_capabilities: [capability({capability_id: "UNSAFE", lane_kind: "FEATURE", name: "Secret Token", version: "1.0.0", write: "src/unsafe"})]}), /UNSAFE_PUBLIC_NAME/u);
assert.throws(() => discoverDynamicLanes({admitted_capabilities: [capability({capability_id: "UNSAFE_SCOPE", lane_kind: "FEATURE", name: "Unsafe Scope", version: "1.0.0", write: "../outside"})]}), /UNSAFE_SCOPE_PATH/u);

const generic = structuredClone(roleGovernanceLibrary);
generic.roles.push({role_id: "FEATURE_AGENT", role_kind: "ONE_LANE_WORKER", lane_id: null});
assert.throws(() => selectDynamicLaneRolePacket({manifest, lane_id: manifest.lanes[0].lane_id, roleGovernanceLibrary: generic}), /GENERIC_UNSCOPED_WORKER/u);

const unscoped = structuredClone(roleGovernanceLibrary);
unscoped.roles = unscoped.roles.filter((role) => role.role_id !== "WORKER_CAPABILITY_DATA_STORE_V1_0_0");
unscoped.roles.push({role_id: "NAMED_LANE_WORKER", role_kind: "ONE_LANE_WORKER", lane_id: null});
assert.throws(() => selectDynamicLaneRolePacket({manifest, lane_id: manifest.lanes[0].lane_id, roleGovernanceLibrary: unscoped}), /GENERIC_UNSCOPED_WORKER/u);

assert.throws(() => compileDynamicLaneManifest({
  project_id: "PROJECT_DYNAMIC_LANES",
  campaign_id: "CAMPAIGN_DYNAMIC_LANES",
  goal_id: "GOAL_DYNAMIC_LANES",
  source_commit: SOURCE_COMMIT,
  source_tree: SOURCE_TREE,
  bootstrap_plan_sha256: PLAN_SHA256,
  project_governance_sha256: GOVERNANCE_SHA256,
  admitted_capabilities: [
    capability({capability_id: "A", lane_kind: "FEATURE", name: "A", version: "1.0.0", write: "src/shared"}),
    capability({capability_id: "B", lane_kind: "FEATURE", name: "B", version: "1.0.0", write: "src/shared/file.mjs"}),
  ],
}), /SHARED_WRITE_CUSTODY_REQUIRED/u);

assert.throws(() => compileDynamicDependencyGraph({
  project_id: "PROJECT_DYNAMIC_LANES",
  campaign_id: "CAMPAIGN_DYNAMIC_LANES",
  goal_id: "GOAL_DYNAMIC_LANES",
  source_commit: SOURCE_COMMIT,
  source_tree: SOURCE_TREE,
  lanes: discoverDynamicLanes({admitted_capabilities: [
    capability({capability_id: "A", lane_kind: "FEATURE", name: "A", version: "1.0.0", write: "src/a", depends_on: [{capability_id: "B", version: "1.0.0"}]}),
    capability({capability_id: "B", lane_kind: "FEATURE", name: "B", version: "1.0.0", write: "src/b", depends_on: [{capability_id: "A", version: "1.0.0"}]}),
  ]}),
}), /DEPENDENCY_CYCLE_REQUIRES_OWNER_DECISION/u);

for (const schemaPath of [
  "schemas/dynamic-lane-manifest.v1.json",
  "schemas/dynamic-lane-dependency-graph.v1.json",
  "schemas/dynamic-lane-role-packet.v1.json",
  "schemas/dynamic-lane-discovery.v1.json",
]) {
  const schema = JSON.parse(fs.readFileSync(path.join(root, schemaPath), "utf8"));
  assert.equal(typeof schema.$id, "string");
  assert.equal(schema.type, "object");
  if (schema.properties?.version) assert.equal(schema.properties.version.const, 1);
}

process.stdout.write("PASS dynamic project lanes: discovery, identity, scope, dependency ordering, and role packet selection\n");
