#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {compileGateFile} from "../control/gate-dsl.mjs";
import {compileBootstrapPlan} from "../control/bootstrap-plan.mjs";
import {compileRoleLibrary} from "../control/role-library.mjs";
import {compileProjectGovernance, compileProjectRoleLibrary} from "../control/project-governance.mjs";
import {compileWorkspaceBoundary} from "../control/workspace-boundary.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-project-governance-"));
const releaseRoot = path.join(tempRoot, "AgentOS");
const projectsRoot = path.join(tempRoot, "projects");
const projectRoot = path.join(projectsRoot, "product");
const controlRoot = path.join(tempRoot, "AgentOS-control");
const governanceRoot = path.join(controlRoot, "project-governance");
fs.mkdirSync(releaseRoot);
fs.mkdirSync(projectRoot, {recursive: true});
fs.mkdirSync(governanceRoot, {recursive: true});

const boundary = compileWorkspaceBoundary({
  release_root: releaseRoot,
  projects_root: projectsRoot,
  project_root: projectRoot,
  control_root: controlRoot,
  worktrees_root: path.join(controlRoot, "worktrees"),
});
const graphText = `graph PROJECT_QA 1
entry PROJECT_QA-001

gate PROJECT_QA-001
context TASK_START
question "Does the project-specific result match its accepted behavior?"
evidence behavior
YES COMPLETE
NO HARD-STOP-SCOPE
UNKNOWN UNPROVEN
NOT_APPLICABLE UNPROVEN
end

terminal COMPLETE COMPLETE "The project result passed its project gate."
terminal HARD-STOP-SCOPE HARD_STOP "The project result is outside its accepted behavior."
terminal UNPROVEN UNPROVEN "The project result needs evidence."
`;
const graphPath = path.join(governanceRoot, "project-qa.gate");
fs.writeFileSync(graphPath, graphText, "utf8");
const graph = await compileGateFile(graphPath);
const sourceWithoutDigest = {
  schema: "agentos.project_governance.v1",
  version: 1,
  status: "PREPARED_NOT_ACTIVATED",
  project_id: "PROJECT-001",
  source_revision: "PROJECT-GOV-REV-001",
  graph_bindings: [{graph_id: graph.graph_id, path: "project-governance/project-qa.gate", graph_sha256: graph.digest}],
  default_graph_ids: [graph.graph_id],
  role_overlays: [{role_id: "INDEPENDENT_AUDITOR", graph_ids: [graph.graph_id]}],
  digest: null,
};
const {digestWithout} = await import("../control/canonical-json.mjs");
const source = {...sourceWithoutDigest, digest: digestWithout(sourceWithoutDigest, "digest")};
const projectLibrary = await compileProjectGovernance(controlRoot, source, {workspace_boundary: boundary});
const baseRoleLibrary = await compileRoleLibrary(ROOT);
const projectRoleLibrary = compileProjectRoleLibrary({baseRoleLibrary, projectLibrary});
const bootstrapPlan = await compileBootstrapPlan(ROOT, {
  project_id: "PROJECT-001",
  owner_context: {objective: "Build the project-specific governed result"},
  source_binding: {source_commit: "a".repeat(40), source_tree: "b".repeat(40), worktree_id: "WORKTREE-001", bootstrap_session_id: "BOOTSTRAP-001", environment_id: "ENV-001"},
  workspace_boundary: boundary,
  role_library: projectRoleLibrary,
});

assert.equal(projectLibrary.project_id, "PROJECT-001");
assert.equal(projectLibrary.graph_digests.length, 1);
assert.equal(projectRoleLibrary.packets.length, baseRoleLibrary.packets.length);
assert(projectRoleLibrary.packets.every((packet) => packet.project_graph_ids.includes("PROJECT_QA")));
assert.equal(bootstrapPlan.role_library_digest, projectRoleLibrary.digest);
assert.equal(JSON.stringify(projectLibrary).includes(tempRoot), false);
await assert.rejects(() => compileProjectGovernance(projectRoot, source, {workspace_boundary: boundary}), /external control repository/u);

fs.rmSync(tempRoot, {recursive: true, force: true});
console.log(JSON.stringify({status: "PASS", project_graphs: projectLibrary.graph_digests.length, role_packets: projectRoleLibrary.packets.length}));
