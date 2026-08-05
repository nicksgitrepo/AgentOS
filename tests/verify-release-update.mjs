#!/usr/bin/env node

import assert from "node:assert/strict";
import {compileReleaseUpdate, validateReleaseUpdate} from "../control/release-update.mjs";
import {compileWorkspaceBoundary} from "../control/workspace-boundary.mjs";

const boundary = compileWorkspaceBoundary({
  release_root: "/workspace/AgentOS",
  projects_root: "/workspace/projects",
  project_root: "/workspace/projects/example-project",
  control_root: "/workspace/AgentOS-control",
});
const current_release = {version: "2.1.0-rc.2", source_commit: "a".repeat(40), source_tree: "b".repeat(40), release_digest: "1".repeat(64)};
const replacement_release = {version: "2.1.0-rc.3", source_commit: "c".repeat(40), source_tree: "d".repeat(40), release_digest: "2".repeat(64)};
const control_snapshot_digest = "3".repeat(64);

const preserve = compileReleaseUpdate({update_id: "RELEASE-UPDATE-001", project_id: "PROJECT-001", workspace_boundary: boundary, current_release, replacement_release, governance_mode: "KEEP_PROJECT_APPENDICES", control_snapshot_digest});
assert.equal(preserve.governance_action, "PRESERVE_APPENDICES_AND_REVALIDATE_AGAINST_NEW_RELEASE");
assert.equal(preserve.project_action, "LEAVE_PROJECT_REPOSITORIES_UNCHANGED");
assert.equal(preserve.release_root, boundary.release_root);
assert.equal(validateReleaseUpdate(preserve).digest, preserve.digest);

const clean = compileReleaseUpdate({update_id: "RELEASE-UPDATE-002", project_id: "PROJECT-001", workspace_boundary: boundary, current_release, replacement_release, governance_mode: "RESET_GOVERNANCE_CLEAN", control_snapshot_digest});
assert.equal(clean.governance_action, "REBUILD_GOVERNANCE_WITHOUT_PROJECT_APPENDICES");
assert.throws(() => compileReleaseUpdate({update_id: "RELEASE-UPDATE-003", project_id: "PROJECT-001", workspace_boundary: boundary, current_release, replacement_release: current_release, governance_mode: "KEEP_PROJECT_APPENDICES", control_snapshot_digest}), /must differ/u);
assert.throws(() => validateReleaseUpdate({...preserve, project_action: "WRITE_PROJECT_REPOSITORY", digest: null}), /may not alter project repositories|digest/u);
console.log(JSON.stringify({status: "PASS", modes: [preserve.governance_mode, clean.governance_mode], project_action: preserve.project_action}));
