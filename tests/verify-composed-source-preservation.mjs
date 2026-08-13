#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  canonicalDigest,
  compileComposedPreservationPlan,
  compileComposedProjectImportPlan,
  validateComposedPreservationPlan,
} from "../control/composed-project-import.mjs";

const sha = (letter) => letter.repeat(64);
const git = (letter) => letter.repeat(40);
const opaque = (kind, letter) => `opaque:${kind}:${sha(letter)}`;
const source = (id, role, letter) => ({
  source_root_ref: opaque("worktree", letter),
  repository_id: id,
  role,
  commit: git(letter),
  tree: git(letter),
  branch: `codex/${role.toLowerCase()}`,
  remote_refs: [`https://example.invalid/${id}.git`],
  dirty_state: {
    status: "DIRTY",
    tracked_modified_count: 4,
    untracked_count: 2,
    worktree_count: 7,
    submodule_count: 0,
    untracked_owner_policy: "PRESERVE_AND_REQUIRE_OWNER_BOUND_DISPOSITION_BEFORE_ARCHIVE",
    observation_sha256: sha(letter),
  },
  worktree_evidence: {historical_worktrees_excluded: true, inventory_sha256: sha(letter)},
  excluded_subpaths: [".git", "node_modules"],
  preservation: {required: true, required_artifacts: ["source-preservation.manifest.json", "source-preservation.zip"], restore_procedure: "Restore exact source identity."},
});

const importPlan = compileComposedProjectImportPlan({
  projectId: "PRESERVATION_FIXTURE",
  sourceRoots: [source("component-a", "CLIENTS", "a"), source("component-b", "PLATFORM", "c"), source("component-c", "DATA", "e")],
  destinationRootRef: opaque("worktree", "f"),
  excludedRepositories: [{repository_id: "orchestration", root_ref: opaque("worktree", "b"), reason: "Operational control evidence remains outside Product scope."}],
  nowUtc: "2026-08-13T00:50:00.000Z",
});
const plan = compileComposedPreservationPlan({
  composedImportPlan: importPlan,
  externalPreservationRootRef: opaque("control-plane", "d"),
  nowUtc: "2026-08-13T00:50:00.000Z",
});
assert.equal(plan.schema, "agentos.composed_source_preservation_plan.v1");
assert.equal(plan.status, "VERIFIED_PLAN");
assert.equal(plan.repositories.length, 3);
assert.equal(plan.execution.archive_creation, "NOT_PERFORMED");
assert.equal(plan.boundaries.source_mutation, "DENY");
assert.equal(plan.boundaries.destination_mutation, "DENY");
assert.equal(plan.verification.independent_reviewer_required, true);
assert.equal(plan.rollback.sources_retained, true);
assert.equal(plan.plan_sha256, canonicalDigest(Object.fromEntries(Object.entries(plan).filter(([key]) => key !== "plan_sha256"))));
assert(plan.repositories.every((repository) => repository.artifacts.length === 5));
assert(plan.repositories.every((repository) => repository.exclusions.includes("historical-worktrees") && repository.exclusions.includes("secrets-and-credentials")));
assert.deepEqual(compileComposedPreservationPlan({
  composedImportPlan: importPlan,
  externalPreservationRootRef: opaque("control-plane", "d"),
  nowUtc: "2026-08-13T00:50:00.000Z",
}), plan, "preservation plan is not deterministic");

const destinationCollision = structuredClone(plan);
destinationCollision.external_preservation_root_ref = destinationCollision.destination_root_ref;
delete destinationCollision.plan_sha256;
destinationCollision.plan_sha256 = canonicalDigest(destinationCollision);
assert.throws(() => validateComposedPreservationPlan(destinationCollision), /cannot equal destination/u);
const missingArtifacts = structuredClone(plan);
missingArtifacts.repositories[0].artifacts.pop();
delete missingArtifacts.plan_sha256;
missingArtifacts.plan_sha256 = canonicalDigest(missingArtifacts);
assert.throws(() => validateComposedPreservationPlan(missingArtifacts), /artifact plan is incomplete/u);
const weakExclusion = structuredClone(plan);
weakExclusion.repositories[0].exclusions = ["generated-and-temporary-material"];
delete weakExclusion.plan_sha256;
weakExclusion.plan_sha256 = canonicalDigest(weakExclusion);
assert.throws(() => validateComposedPreservationPlan(weakExclusion), /lacks secret exclusion/u);
const mutation = structuredClone(plan);
mutation.boundaries.source_mutation = "ALLOW";
delete mutation.plan_sha256;
mutation.plan_sha256 = canonicalDigest(mutation);
assert.throws(() => validateComposedPreservationPlan(mutation), /permits a write/u);
const unboundWorktrees = structuredClone(plan);
unboundWorktrees.repositories[0].worktree_evidence.historical_worktrees_excluded = false;
delete unboundWorktrees.plan_sha256;
unboundWorktrees.plan_sha256 = canonicalDigest(unboundWorktrees);
assert.throws(() => validateComposedPreservationPlan(unboundWorktrees), /does not exclude historical worktrees/u);

console.log("PASS AgentOS composed source-preservation plan: per-root archive/manifest identities, dirty ownership, remotes/worktrees/submodules, exclusions, rollback, independent verification, destination separation, and zero-trace hostile checks");
