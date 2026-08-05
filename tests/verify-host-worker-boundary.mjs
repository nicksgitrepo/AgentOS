#!/usr/bin/env node

import assert from "node:assert/strict";
import {compileHostWorkerBoundary, bindHostWorkspacePath, validateHostWorkspacePath} from "../control/host-worker-boundary.mjs";
import {compileWorkspaceBoundary} from "../control/workspace-boundary.mjs";

const workspace_boundary = compileWorkspaceBoundary({
  release_root: "/workspace/AgentOS",
  projects_root: "/workspace/projects",
  project_root: "/workspace/projects/example-project",
  control_root: "/workspace/AgentOS-control",
});
const source_binding = {source_commit: "a".repeat(40), source_tree: "b".repeat(40), source_ref: "v2.1.0-rc.5"};
const protected_actions = ["PUSH", "MERGE", "DEPLOY"];

const release = compileHostWorkerBoundary({
  worker_id: "WORKER-RELEASE-001",
  worker_scope: "RELEASE_CONTROL",
  workspace_mode: "HOST_MANAGED_VISIBLE",
  source_root_kind: "RELEASE",
  host_project_id: "REGISTERED-RELEASE-PROJECT",
  host_project_role: "RELEASE",
  campaign_project_id: "PROJECT-001",
  source_binding,
  workspace_boundary,
  protected_actions,
});
assert.equal(validateHostWorkspacePath(release, "/host/ephemeral/release-worker"), "/host/ephemeral/release-worker");
const bound = bindHostWorkspacePath(release, "/host/ephemeral/release-worker");
assert.equal(bound.workspace_path, "/host/ephemeral/release-worker");
assert.equal(bound.source_binding.source_ref, "v2.1.0-rc.5");
assert.throws(() => validateHostWorkspacePath(bound, "/workspace/projects/example-project/worker"), /product repository/u);
assert.throws(() => compileHostWorkerBoundary({...release, host_project_role: "CONTROL"}), /registered release project/u);
assert.throws(() => compileHostWorkerBoundary({...release, worker_scope: "PRODUCT", source_root_kind: "PRODUCT", host_project_role: "PRODUCT"}), /host-managed visible|product work/u);

const product = compileHostWorkerBoundary({
  worker_id: "WORKER-PRODUCT-001",
  worker_scope: "PRODUCT",
  workspace_mode: "CONTROL_ISOLATED",
  source_root_kind: "PRODUCT",
  host_project_id: "CONTROL-REPOSITORY",
  host_project_role: "CONTROL",
  campaign_project_id: "PROJECT-001",
  source_binding,
  workspace_boundary,
  protected_actions,
});
assert.equal(validateHostWorkspacePath(product, "/workspace/AgentOS-control/worktrees/product-worker"), "/workspace/AgentOS-control/worktrees/product-worker");
assert.throws(() => validateHostWorkspacePath(product, "/host/ephemeral/product-worker"), /inside the control repository/u);

console.log(JSON.stringify({status: "PASS", visible_scope: release.worker_scope, product_mode: product.workspace_mode}));
