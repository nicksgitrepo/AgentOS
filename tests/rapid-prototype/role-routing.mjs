#!/usr/bin/env node

import assert from "node:assert/strict";
import {admitRole} from "../../control/rapid-prototype/role-routing.mjs";

const role = "IMPLEMENTATION_ROLE_ROUTING";
const admittedRoles = [role, "IMPLEMENTATION_INTENT_AND_SCOPE"];
const expectedProject = "PROJECT-ALPHA";
const expectedCwd = "/workspace/project-alpha";
const sessionIdentity = {
  sessionId: "SESSION-ROLE-ROUTING-1",
  projectId: expectedProject,
  cwd: expectedCwd,
  verified: true,
  real: true,
  hostReadback: true,
};
const sourceBinding = {
  projectId: expectedProject,
  cwd: expectedCwd,
  capabilities: ["local_check"],
};
const hostReadback = {
  status: "MATCH",
  verified: true,
  projectId: expectedProject,
  cwd: expectedCwd,
  capabilities: ["local_check"],
};
const base = {
  role,
  admittedRoles,
  sessionIdentity,
  expectedProject,
  expectedCwd,
  phase: "IMPLEMENT_FOUNDATION_LANES",
  sourceBinding,
  hostReadback,
  requiredCapabilities: ["local_check"],
  topology: "INDEPENDENT_SIBLING_SESSION",
};

const admitted = admitRole(base);
assert.equal(admitted.admitted, true);
assert.equal(admitted.status, "ADMITTED");
assert.equal(admitted.role, role);
assert.equal(admitted.topology, "INDEPENDENT_SIBLING_SESSION");
assert.equal(admitted.source_binding_status, "MATCH");
assert.equal(admitted.capability_status, "MATCH");
assert.equal(Object.hasOwn(admitted, "sessionIdentity"), false);
assert.equal(Object.hasOwn(admitted, "project"), false);
assert.equal(Object.hasOwn(admitted, "cwd"), false);

const alternateTopology = admitRole({
  ...base,
  sessionIdentity: {...sessionIdentity, sessionId: "SESSION-ROLE-ROUTING-2"},
  topology: "INDEPENDENT_SIBLING_SESSIONS",
});
assert.equal(alternateTopology.identity_verified, true);
assert.equal(alternateTopology.topology, "INDEPENDENT_SIBLING_SESSIONS");

function rejects(label, overrides, pattern) {
  assert.throws(() => admitRole({...base, ...overrides}), pattern, label);
}

rejects("unknown role", {role: "IMPLEMENTATION_UNKNOWN"}, /not exactly named/u);
rejects("generic Feature Agent", {role: "Feature Agent", admittedRoles: ["Feature Agent"]}, /generic Feature Agent/u);
rejects("generic uppercase Feature Agent", {role: "FEATURE_AGENT", admittedRoles: ["FEATURE_AGENT"]}, /generic Feature Agent/u);
rejects("compatibility-only export", {role: "CAMPAIGN_TEAM_ROLES", admittedRoles: ["CAMPAIGN_TEAM_ROLES"]}, /compatibility-only/u);
rejects("compatibility alias", {role: "GLOBAL_ORCHESTRATOR", admittedRoles: ["GLOBAL_ORCHESTRATOR"]}, /compatibility-only/u);
rejects("recursive child role", {role: "IMPLEMENTATION_ROLE_ROUTING_CHILD", admittedRoles: ["IMPLEMENTATION_ROLE_ROUTING_CHILD"]}, /recursive child/u);
rejects("shell stand-in role", {role: "SHELL_WORKER", admittedRoles: ["SHELL_WORKER"]}, /shell stand-in/u);
rejects("missing session identity", {sessionIdentity: null}, /structured host identity/u);
rejects("string session identity", {sessionIdentity: "SESSION-ROLE-ROUTING-2"}, /structured host identity/u);
rejects("unverified session identity", {sessionIdentity: {sessionId: "SESSION-1", projectId: expectedProject, cwd: expectedCwd, verified: false}}, /lacks verified host readback/u);
rejects("project mismatch", {sessionIdentity: {...sessionIdentity, projectId: "PROJECT-BETA"}}, /does not match the expected source/u);
rejects("cwd mismatch", {sessionIdentity: {...sessionIdentity, cwd: "/workspace/project-beta"}}, /does not match the expected source/u);
rejects("missing phase", {phase: undefined}, /phase binding is required/u);
rejects("missing source binding", {sourceBinding: undefined}, /source binding and host readback are required/u);
rejects("missing capability binding", {requiredCapabilities: undefined}, /capability binding is required/u);
rejects("foreign source readback", {hostReadback: {...hostReadback, projectId: "PROJECT-BETA"}}, /source binding does not match/u);
rejects("capability mismatch", {hostReadback: {...hostReadback, capabilities: ["foreign_capability"]}}, /source capabilities differ/u);
rejects("duplicate source capability", {sourceBinding: {...sourceBinding, capabilities: ["local_check", "local_check"]}}, /capabilities contain duplicates/u);
rejects("duplicate host capability", {hostReadback: {...hostReadback, capabilities: ["local_check", "local_check"]}}, /capabilities contain duplicates/u);
rejects("duplicate required capability", {requiredCapabilities: ["local_check", "local_check"]}, /capabilities contain duplicates/u);
rejects("missing project readback", {sessionIdentity: {sessionId: "SESSION-1", cwd: expectedCwd, verified: true, real: true, hostReadback: true}}, /project is missing/u);
rejects("missing cwd readback", {sessionIdentity: {sessionId: "SESSION-1", projectId: expectedProject, verified: true, real: true, hostReadback: true}}, /cwd is missing/u);
rejects("parent-child topology", {topology: "PARENT_CHILD"}, /forbidden topology/u);
rejects("recursive topology", {topology: "RECURSIVE_CHILD"}, /forbidden topology/u);
rejects("shell topology", {topology: "SHELL_WORKER"}, /forbidden topology/u);
rejects("topology enables child relationship", {topology: {type: "INDEPENDENT_SIBLING_SESSION", parent_child_relationship: true}}, /topology flag/u);
rejects("topology enables shell workers", {topology: {type: "INDEPENDENT_SIBLING_SESSION", shellWorkersAllowed: true}}, /topology flag/u);
rejects("conflicting topology aliases", {topology: {type: "INDEPENDENT_SIBLING_SESSION", name: "PARENT_CHILD"}}, /topology aliases disagree/u);
rejects("polluted admitted role list", {admittedRoles: [role, "Feature Agent"]}, /generic Feature Agent/u);
rejects("compatibility role definitions are not names", {admittedRoles: [{role}]}, /admitted role must be a nonempty string/u);

console.log("PASS role routing: exact named admission, real source-bound identity, independent-sibling topology, and hostile rejection coverage verified");
