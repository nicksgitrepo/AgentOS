#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {compileWorkspaceBoundary, readWorkspaceRuntimeBinding, validateAgentWorkPath} from "../control/workspace-boundary.mjs";
import {CONTROL_BOUNDARY_RECORD, prepareWorkspace} from "../control/workspace-bootstrap.mjs";

const boundary = compileWorkspaceBoundary({
  release_root: "/workspace/AgentOS",
  projects_root: "/workspace/projects",
  project_root: "/workspace/projects/example-project",
  control_root: "/workspace/AgentOS-control",
  worktrees_root: "/workspace/AgentOS-control/worktrees",
});

assert.equal(boundary.layout, "SIBLING_RELEASE_PROJECTS_CONTROL");
assert.equal(boundary.release_root_ref, "AGENTOS_RELEASE_ROOT");
assert.equal(Object.hasOwn(boundary, "release_root"), false);
assert.equal(JSON.stringify(boundary).includes("/workspace/"), false);
assert.equal(boundary.project_state_policy, "NEVER_WRITE_OR_STORE_AGENTOS_ARTIFACTS");
assert.equal(boundary.agent_worktree_policy, "ISOLATED_CHECKOUTS_ONLY_UNDER_CONTROL_REPOSITORY");
assert.equal(validateAgentWorkPath(boundary, "/workspace/AgentOS-control/worktrees/functionality"), "/workspace/AgentOS-control/worktrees/functionality");
assert.deepEqual(readWorkspaceRuntimeBinding({
  AGENTOS_RELEASE_ROOT: "/workspace/AgentOS",
  AGENTOS_PROJECTS_ROOT: "/workspace/projects",
  AGENTOS_PROJECT_ROOT: "/workspace/projects/example-project",
  AGENTOS_CONTROL_ROOT: "/workspace/AgentOS-control",
  AGENTOS_WORKTREES_ROOT: "/workspace/AgentOS-control/worktrees",
}, boundary).refs, {
  release_root: "AGENTOS_RELEASE_ROOT",
  projects_root: "AGENTOS_PROJECTS_ROOT",
  project_root: "AGENTOS_PROJECT_ROOT",
  control_root: "AGENTOS_CONTROL_ROOT",
  worktrees_root: "AGENTOS_WORKTREES_ROOT",
});
assert.throws(() => compileWorkspaceBoundary({
  release_root: "/workspace/AgentOS",
  projects_root: "/workspace/projects",
  project_root: "/workspace/projects/example-project",
  control_root: "/workspace/projects/example-project/.agentos",
  worktrees_root: "/workspace/projects/example-project/.agentos/worktrees",
}), /siblings|overlaps/u);
assert.throws(() => compileWorkspaceBoundary({
  release_root: "/workspace/AgentOS",
  projects_root: "/workspace/projects",
  project_root: "/workspace/other-project",
  control_root: "/workspace/AgentOS-control",
}), /child of the projects root/u);
assert.throws(() => validateAgentWorkPath(boundary, "/workspace/projects/example-project/.agentos/worktrees"), /inside the control repository/u);
assert.throws(() => validateAgentWorkPath(boundary, "/workspace/AgentOS/notes"), /inside the control repository/u);

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-workspace-"));
const release_root = path.join(root, "AgentOS");
const projects_root = path.join(root, "projects");
const project_root = path.join(projects_root, "example-project");
const control_root = path.join(root, "AgentOS-control");
fs.mkdirSync(release_root);
fs.mkdirSync(project_root, {recursive: true});
fs.writeFileSync(path.join(project_root, "README.md"), "Project source stays untouched.\n");
const realBoundary = compileWorkspaceBoundary({release_root, projects_root, project_root, control_root});
const prepared = prepareWorkspace(realBoundary);
assert.equal(prepared.status, "CREATED");
assert.equal(prepared.project_tree_touched, false);
assert.equal(fs.existsSync(path.join(project_root, CONTROL_BOUNDARY_RECORD)), false);
assert.equal(fs.readFileSync(path.join(project_root, "README.md"), "utf8"), "Project source stays untouched.\n");
assert.equal(fs.existsSync(path.join(control_root, ".git")), true);
assert.equal(fs.existsSync(path.join(control_root, CONTROL_BOUNDARY_RECORD)), true);
const persisted = JSON.parse(fs.readFileSync(path.join(control_root, CONTROL_BOUNDARY_RECORD), "utf8"));
assert.equal(Object.hasOwn(persisted.workspace_boundary, "release_root"), false);
assert.equal(Object.hasOwn(persisted.workspace_boundary, "project_root"), false);
assert.equal(JSON.stringify(persisted).includes(root), false);
assert.equal(persisted.workspace_boundary.runtime_binding_digest, realBoundary.runtime_binding_digest);
assert.equal(prepareWorkspace(realBoundary).status, "VERIFIED");
const foreignProject = path.join(projects_root, "other-project");
fs.mkdirSync(foreignProject);
const foreign = compileWorkspaceBoundary({release_root, projects_root, project_root: foreignProject, control_root});
assert.throws(() => prepareWorkspace(foreign), /different workspace|missing|control/u);
fs.rmSync(root, {recursive: true, force: true});
console.log(JSON.stringify({status: "PASS", layout: boundary.layout, project_policy: boundary.project_state_policy}));
