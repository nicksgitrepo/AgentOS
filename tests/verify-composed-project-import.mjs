#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  canonicalDigest,
  compileComposedProjectImportPlan,
  validateComposedProjectImportPlan,
  assertComposedImportExecutionUnsupported,
} from "../control/composed-project-import.mjs";

const sha = (letter) => letter.repeat(64);
const git = (letter) => letter.repeat(40);
const root = (letter) => `opaque:worktree:${sha(letter)}`;
const source = (id, role, letter, modified, untracked, worktrees) => ({
  source_root_ref: root(letter),
  repository_id: id,
  role,
  commit: git(letter),
  tree: git(String.fromCharCode(letter.charCodeAt(0) + 1)),
  branch: `codex/${role}`,
  remote_refs: [`https://example.invalid/${id}.git`],
  dirty_state: {
    status: modified || untracked ? "DIRTY" : "CLEAN",
    tracked_modified_count: modified,
    untracked_count: untracked,
    worktree_count: worktrees,
    submodule_count: 0,
    untracked_owner_policy: "PRESERVE_AND_REQUIRE_OWNER_BOUND_DISPOSITION_BEFORE_ARCHIVE",
    observation_sha256: sha(String.fromCharCode(letter.charCodeAt(0) + 2)),
  },
  worktree_evidence: {historical_worktrees_excluded: true, inventory_sha256: sha(String.fromCharCode(letter.charCodeAt(0) + 3))},
  excluded_subpaths: [".git", "node_modules"],
  preservation: {
    required: true,
    required_artifacts: ["source-preservation.manifest.json", "source-preservation.zip"],
    restore_procedure: "Restore exact source identity from the preserved archive and manifest.",
  },
});

const destination = root("d");
const plan = compileComposedProjectImportPlan({
  projectId: "COMPOSED_FIXTURE",
  sourceRoots: [source("component-a", "CLIENTS", "a", 2, 3, 4), source("component-b", "PLATFORM", "b", 1, 0, 2), source("component-c", "DATA", "c", 0, 1, 1)],
  destinationRootRef: destination,
  excludedRepositories: [{repository_id: "orchestration", root_ref: root("e"), reason: "Operational control evidence is preserved but excluded from Product import scope."}],
  nowUtc: "2026-08-13T00:00:00.000Z",
});
assert.equal(plan.mode, "NORMALIZE_AND_AUDIT");
assert.equal(plan.composition.decision, "COMPOSED_MULTI_REPOSITORY");
assert.equal(plan.source_roots.length, 3);
assert.equal(plan.execution.mutation, "NONE");
assert.equal(plan.source_preservation.storage_mode, "EXTERNAL_CONTROL_PLANE");
assert.equal(plan.rollback.source_retained, true);
const planBody = structuredClone(plan);
delete planBody.plan_sha256;
assert.equal(plan.plan_sha256, canonicalDigest(planBody));
assert.deepEqual(compileComposedProjectImportPlan({
  projectId: "COMPOSED_FIXTURE",
  sourceRoots: [source("component-a", "CLIENTS", "a", 2, 3, 4), source("component-b", "PLATFORM", "b", 1, 0, 2), source("component-c", "DATA", "c", 0, 1, 1)],
  destinationRootRef: destination,
  excludedRepositories: [{repository_id: "orchestration", root_ref: root("e"), reason: "Operational control evidence is preserved but excluded from Product import scope."}],
  nowUtc: "2026-08-13T00:00:00.000Z",
}), plan, "composed import compilation is not deterministic");

assert.throws(() => compileComposedProjectImportPlan({projectId: "TOO_FEW", sourceRoots: [source("only", "ONE", "a", 0, 0, 1)], destinationRootRef: destination}), /at least two/u);
assert.throws(() => compileComposedProjectImportPlan({projectId: "OVERLAP", sourceRoots: [source("a", "A", "a", 0, 0, 1), source("b", "B", "b", 0, 0, 1)], destinationRootRef: root("a")}), /overlaps a source root/u);
const dirtyTamper = structuredClone(plan);
dirtyTamper.source_roots[0].dirty_state.status = "CLEAN";
assert.throws(() => validateComposedProjectImportPlan(dirtyTamper), /plan is not content-addressed/u);
const historicalTamper = structuredClone(plan);
historicalTamper.source_roots[0].worktree_evidence.historical_worktrees_excluded = false;
assert.throws(() => validateComposedProjectImportPlan(historicalTamper), /historical worktrees must be excluded/u);
const exclusionTamper = structuredClone(plan);
exclusionTamper.composition.included_repository_ids.push("orchestration");
assert.throws(() => validateComposedProjectImportPlan(exclusionTamper), /does not bind every source root/u);
const secretTamper = structuredClone(plan);
secretTamper.execution.next_protected_decision = "password=never";
delete secretTamper.plan_sha256;
secretTamper.plan_sha256 = canonicalDigest(secretTamper);
assert.throws(() => validateComposedProjectImportPlan(secretTamper), /raw secret-like/u);
assert.throws(() => assertComposedImportExecutionUnsupported(plan), /NOT_AUTHORIZED/u);

console.log("PASS AgentOS composed multi-repository import: exact source roots, separate destination, excluded operational root, dirty/untracked preservation, historical-worktree exclusion, rollback, deterministic read-only plan, and fail-closed execution");
