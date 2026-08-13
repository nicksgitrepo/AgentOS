#!/usr/bin/env node

/*
 * Read-only composition contract for projects whose source is intentionally
 * split across several repositories.  It compiles an opaque, source-bound
 * plan; it never copies, archives, normalizes, or mutates a source root.
 */

import crypto from "node:crypto";

export const COMPOSED_IMPORT_SCHEMA = "agentos.composed_project_import.v1";
export const COMPOSED_IMPORT_MODES = Object.freeze(["NORMALIZE_AND_AUDIT"]);
export const COMPOSED_IMPORT_STATUSES = Object.freeze(["PLANNED", "PRESERVED", "MIGRATION_IN_PROGRESS", "CUTOVER_READY", "ROLLED_BACK"]);
export const COMPOSED_IMPORT_DECISIONS = Object.freeze(["COMPOSED_MULTI_REPOSITORY"]);
export const COMPOSED_PRESERVATION_SCHEMA = "agentos.composed_source_preservation_plan.v1";
export const COMPOSED_PRESERVATION_STATUSES = Object.freeze(["PLANNED", "VERIFIED_PLAN", "NOT_AUTHORIZED"]);

const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const OPAQUE_WORKTREE = /^opaque:worktree:[0-9a-f]{64}$/u;
const SAFE_ID = /^[A-Za-z][A-Za-z0-9._:-]*$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const SECRET = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|credential|private[_-]?key)\s*[:=]/iu;

function assert(condition, message) { if (!condition) throw new Error(message); }
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function requireRecord(value, label) { assert(isRecord(value), `${label} must be an object`); }
function requireString(value, label) { assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`); }
function requireId(value, label) { requireString(value, label); assert(SAFE_ID.test(value), `${label} has an unsafe identity`); }
function requireSha(value, label) { assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`); }
function requireGit(value, label) { assert(typeof value === "string" && GIT_OBJECT.test(value), `${label} must be a 40-character Git object`); }
function requireOpaque(value, label) { assert(typeof value === "string" && OPAQUE_WORKTREE.test(value), `${label} must be an opaque worktree reference`); }
function requireUtc(value, label) { requireString(value, label); assert(ISO_UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} must be UTC`); }
function compareUtf8(left, right) { return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")); }
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort(compareUtf8).map((key) => [key, canonicalize(value[key])]));
  return value;
}
export function canonicalDigest(value) { return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value)), "utf8").digest("hex"); }
function sortedUnique(values, label, {minItems = 0} = {}) {
  assert(Array.isArray(values) && values.length >= minItems, `${label} must contain at least ${minItems} item(s)`);
  assert(values.every((value) => typeof value === "string" && value.trim().length > 0), `${label} contains an invalid value`);
  const sorted = [...new Set(values)].sort(compareUtf8);
  assert(JSON.stringify(values) === JSON.stringify(sorted), `${label} must be sorted and unique`);
  return values;
}
function secretFree(value, label) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  assert(!SECRET.test(text), `${label} contains raw secret-like material`);
  assert(!/https?:\/\/[^\s]+[?&](?:token|secret|key|signature)=/iu.test(text), `${label} contains a credential-bearing URL`);
}

function opaqueRef(rootPath) {
  requireString(rootPath, "source root path");
  assert(rootPath.startsWith("/"), "source root path must be absolute at the execution boundary");
  return `opaque:worktree:${canonicalDigest(rootPath)}`;
}

function opaqueTypedRef(kind, value, label) {
  requireString(value, label);
  assert(/^[a-z][a-z0-9._-]*$/u.test(kind), `${label} kind is invalid`);
  return `opaque:${kind}:${canonicalDigest(value)}`;
}

function requireOpaqueAny(value, label) {
  assert(typeof value === "string" && /^opaque:[a-z][a-z0-9._-]*:[0-9a-f]{64}$/u.test(value), `${label} must be an opaque reference`);
}

function normalizeRoot(root, index) {
  requireRecord(root, `source_roots[${index}]`);
  const sourceRootRef = root.source_root_ref ?? (root.root_path ? opaqueRef(root.root_path) : null);
  requireOpaque(sourceRootRef, `source_roots[${index}].source_root_ref`);
  requireId(root.repository_id, `source_roots[${index}].repository_id`);
  requireId(root.role, `source_roots[${index}].role`);
  requireGit(root.commit, `source_roots[${index}].commit`);
  requireGit(root.tree, `source_roots[${index}].tree`);
  requireString(root.branch, `source_roots[${index}].branch`);
  sortedUnique(root.remote_refs, `source_roots[${index}].remote_refs`, {minItems: 1});
  requireRecord(root.dirty_state, `source_roots[${index}].dirty_state`);
  assert(["CLEAN", "DIRTY"].includes(root.dirty_state.status), `source_roots[${index}].dirty_state.status is invalid`);
  for (const field of ["tracked_modified_count", "untracked_count", "worktree_count", "submodule_count"]) {
    assert(Number.isSafeInteger(root.dirty_state[field]) && root.dirty_state[field] >= 0, `source_roots[${index}].dirty_state.${field} is invalid`);
  }
  requireString(root.dirty_state.untracked_owner_policy, `source_roots[${index}].dirty_state.untracked_owner_policy`);
  requireSha(root.dirty_state.observation_sha256, `source_roots[${index}].dirty_state.observation_sha256`);
  requireRecord(root.worktree_evidence, `source_roots[${index}].worktree_evidence`);
  assert(root.worktree_evidence.historical_worktrees_excluded === true, `source_roots[${index}] historical worktrees must be excluded explicitly`);
  requireSha(root.worktree_evidence.inventory_sha256, `source_roots[${index}].worktree_evidence.inventory_sha256`);
  sortedUnique(root.excluded_subpaths ?? [], `source_roots[${index}].excluded_subpaths`);
  requireRecord(root.preservation, `source_roots[${index}].preservation`);
  assert(root.preservation.required === true, `source_roots[${index}] source preservation is required`);
  sortedUnique(root.preservation.required_artifacts, `source_roots[${index}].preservation.required_artifacts`, {minItems: 1});
  requireString(root.preservation.restore_procedure, `source_roots[${index}].preservation.restore_procedure`);
  return {
    source_root_ref: sourceRootRef,
    repository_id: root.repository_id,
    role: root.role,
    commit: root.commit,
    tree: root.tree,
    branch: root.branch,
    remote_refs: [...root.remote_refs],
    dirty_state: structuredClone(root.dirty_state),
    worktree_evidence: structuredClone(root.worktree_evidence),
    excluded_subpaths: [...(root.excluded_subpaths ?? [])],
    preservation: structuredClone(root.preservation),
  };
}

export function validateComposedProjectImportPlan(plan) {
  requireRecord(plan, "composed project import plan");
  assert(plan.schema === COMPOSED_IMPORT_SCHEMA && plan.version === 1 && plan.governance_version === "2.1rc", "composed project import schema is invalid");
  assert(COMPOSED_IMPORT_STATUSES.includes(plan.status), "composed project import status is invalid");
  requireId(plan.project_id, "composed project import project ID");
  assert(COMPOSED_IMPORT_MODES.includes(plan.mode), "composed project import mode is invalid");
  assert(COMPOSED_IMPORT_DECISIONS.includes(plan.composition.decision), "composed project import decision is invalid");
  assert(Array.isArray(plan.source_roots) && plan.source_roots.length >= 2, "composed project import requires at least two source roots");
  const normalized = plan.source_roots.map(normalizeRoot);
  assert(new Set(normalized.map((root) => root.source_root_ref)).size === normalized.length, "composed project import source roots are duplicated");
  assert(new Set(normalized.map((root) => root.repository_id)).size === normalized.length, "composed project import repository identities are duplicated");
  assert(new Set(normalized.map((root) => root.role)).size === normalized.length, "composed project import repository roles are duplicated");
  requireOpaque(plan.destination_root_ref, "composed project import destination root");
  assert(!normalized.some((root) => root.source_root_ref === plan.destination_root_ref), "composed project import destination overlaps a source root");
  requireRecord(plan.composition, "composed project import composition");
  sortedUnique(plan.composition.included_repository_ids, "composed project import included repositories", {minItems: 2});
  assert(JSON.stringify(plan.composition.included_repository_ids) === JSON.stringify(normalized.map((root) => root.repository_id).sort(compareUtf8)), "composition inclusion does not bind every source root");
  sortedUnique(plan.composition.excluded_repository_ids, "composed project import excluded repositories");
  assert(!plan.composition.excluded_repository_ids.some((id) => plan.composition.included_repository_ids.includes(id)), "a repository cannot be both included and excluded");
  requireString(plan.composition.rule, "composed project import composition rule");
  requireRecord(plan.exclusions, "composed project import exclusions");
  assert(Array.isArray(plan.exclusions.repositories), "composed project import repository exclusions are invalid");
  for (const [index, exclusion] of plan.exclusions.repositories.entries()) {
    requireRecord(exclusion, `composed project import exclusions.repositories[${index}]`);
    requireId(exclusion.repository_id, `composed project import exclusions.repositories[${index}].repository_id`);
    requireOpaque(exclusion.root_ref, `composed project import exclusions.repositories[${index}].root_ref`);
    requireString(exclusion.reason, `composed project import exclusions.repositories[${index}].reason`);
    assert(exclusion.preserved_outside_product === true, `composed project import exclusion ${exclusion.repository_id} is not preserved`);
    assert(!plan.composition.included_repository_ids.includes(exclusion.repository_id), `excluded repository ${exclusion.repository_id} is also included`);
  }
  requireRecord(plan.source_preservation, "composed project import source preservation");
  assert(plan.source_preservation.required_before_any_write === true, "composed project import permits a write before source preservation");
  assert(plan.source_preservation.storage_mode === "EXTERNAL_CONTROL_PLANE", "composed import source preservation must remain outside the product roots");
  sortedUnique(plan.source_preservation.required_artifacts, "composed project import preservation artifacts", {minItems: 5});
  requireString(plan.source_preservation.independent_verification, "composed project import preservation verification");
  requireRecord(plan.execution, "composed project import execution");
  assert(plan.execution.mutation === "NONE" && plan.execution.status === "NOT_AUTHORIZED" && plan.execution.activation === "OFF", "composed project import execution is not fail-closed");
  assert(plan.execution.source_preservation_complete === false, "read-only composed plan cannot claim source preservation complete");
  requireString(plan.execution.next_protected_decision, "composed project import next decision");
  requireRecord(plan.rollback, "composed project import rollback");
  assert(plan.rollback.source_retained === true && plan.rollback.cutover_reversible === true, "composed project import rollback is incomplete");
  requireSha(plan.plan_sha256, "composed project import plan digest");
  const body = structuredClone(plan); delete body.plan_sha256;
  assert(plan.plan_sha256 === canonicalDigest(body), "composed project import plan is not content-addressed");
  secretFree(plan, "composed project import plan");
  return plan;
}

export function compileComposedProjectImportPlan({projectId, sourceRoots, destinationRootRef = null, destinationRootPath = null, excludedRepositories = [], mode = "NORMALIZE_AND_AUDIT", nowUtc = "1970-01-01T00:00:00.000Z", sourcePreservationArtifacts = ["source-preservation.zip", "source-preservation.manifest.json", "source-preservation.index.jsonl", "source-preservation.receipt.json", "import-exclusions.md"]} = {}) {
  requireId(projectId, "composed project import project ID");
  assert(Array.isArray(sourceRoots) && sourceRoots.length >= 2, "composed project import requires at least two source roots");
  requireUtc(nowUtc, "composed project import observation time");
  const roots = sourceRoots.map(normalizeRoot).sort((left, right) => compareUtf8(left.repository_id, right.repository_id));
  const destination = destinationRootRef ?? (destinationRootPath ? opaqueRef(destinationRootPath) : null);
  requireOpaque(destination, "composed project import destination root");
  const exclusions = excludedRepositories.map((item, index) => {
    requireRecord(item, `excluded_repositories[${index}]`);
    const rootRef = item.root_ref ?? (item.root_path ? opaqueRef(item.root_path) : null);
    requireOpaque(rootRef, `excluded_repositories[${index}].root_ref`);
    requireId(item.repository_id, `excluded_repositories[${index}].repository_id`);
    requireString(item.reason, `excluded_repositories[${index}].reason`);
    return {repository_id: item.repository_id, root_ref: rootRef, reason: item.reason, preserved_outside_product: true};
  }).sort((left, right) => compareUtf8(left.repository_id, right.repository_id));
  const body = {
    schema: COMPOSED_IMPORT_SCHEMA,
    version: 1,
    governance_version: "2.1rc",
    status: "PLANNED",
    project_id: projectId,
    mode,
    composition: {
      decision: "COMPOSED_MULTI_REPOSITORY",
      included_repository_ids: roots.map((root) => root.repository_id),
      excluded_repository_ids: exclusions.map((item) => item.repository_id),
      rule: "Treat the listed source repositories as one composed project only at the approved boundary; preserve every excluded repository outside Product scope and never infer inclusion from filesystem adjacency.",
    },
    source_roots: roots,
    destination_root_ref: destination,
    exclusions: {repositories: exclusions},
    source_preservation: {
      required_before_any_write: true,
      storage_mode: "EXTERNAL_CONTROL_PLANE",
      required_artifacts: [...sourcePreservationArtifacts].sort(compareUtf8),
      independent_verification: "Verify each archive, manifest, index, exclusions record, and restore procedure against every source commit/tree and observation digest before any normalization or destination write.",
    },
    execution: {
      status: "NOT_AUTHORIZED",
      mutation: "NONE",
      activation: "OFF",
      source_preservation_complete: false,
      next_protected_decision: "Approve the exact source-preservation policy for the observed dirty and untracked state of every included repository before any write.",
    },
    rollback: {
      source_retained: true,
      cutover_reversible: true,
      rule: "Retain every original source root and preservation receipt; cutover may proceed only from a content-addressed candidate and returns to the exact source identities on failure.",
    },
    observed_at_utc: nowUtc,
  };
  const plan = {...body, plan_sha256: canonicalDigest(body)};
  return validateComposedProjectImportPlan(plan);
}

export function assertComposedImportExecutionUnsupported(plan) {
  validateComposedProjectImportPlan(plan);
  throw new Error("COMPOSED_IMPORT_EXECUTION_NOT_AUTHORIZED: read-only composition plan must receive source-preservation custody and an explicit execution implementation before any write");
}

function preservationArtifactPlan({projectPlanSha256, repositoryId, sourceRootRef, artifactName}) {
  return {
    artifact_name: artifactName,
    artifact_ref: opaqueTypedRef("artifact", `${projectPlanSha256}:${repositoryId}:${sourceRootRef}:${artifactName}`, "artifact identity seed"),
    content_addressing: "CONTENT_ADDRESS_AFTER_CREATION_AND_FULL_READBACK",
    planned_identity_sha256: canonicalDigest({projectPlanSha256, repositoryId, sourceRootRef, artifactName}),
  };
}

export function validateComposedPreservationPlan(plan) {
  requireRecord(plan, "composed source-preservation plan");
  assert(plan.schema === COMPOSED_PRESERVATION_SCHEMA && plan.version === 1 && plan.governance_version === "2.1rc", "composed source-preservation schema is invalid");
  assert(COMPOSED_PRESERVATION_STATUSES.includes(plan.status), "composed source-preservation status is invalid");
  requireSha(plan.project_import_plan_sha256, "composed source-preservation import binding");
  requireOpaque(plan.destination_root_ref, "composed source-preservation destination");
  requireOpaqueAny(plan.external_preservation_root_ref, "composed source-preservation external root");
  assert(plan.external_preservation_root_ref !== plan.destination_root_ref, "preservation root cannot equal destination");
  requireRecord(plan.boundaries, "composed source-preservation boundaries");
  assert(plan.boundaries.source_mutation === "DENY" && plan.boundaries.destination_mutation === "DENY" && plan.boundaries.archive_creation === "NOT_PERFORMED", "composed source-preservation plan permits a write");
  assert(plan.boundaries.zero_trace_consumer === true, "composed source-preservation plan lacks zero-trace proof");
  assert(Array.isArray(plan.repositories) && plan.repositories.length >= 2, "composed source-preservation requires every included repository");
  const repositoryIds = [];
  const artifactNames = ["import-exclusions.md", "source-preservation.index.jsonl", "source-preservation.manifest.json", "source-preservation.receipt.json", "source-preservation.zip"];
  for (const [index, repository] of plan.repositories.entries()) {
    requireRecord(repository, `composed source-preservation.repositories[${index}]`);
    requireId(repository.repository_id, `composed source-preservation.repositories[${index}].repository_id`);
    requireOpaque(repository.source_root_ref, `composed source-preservation.repositories[${index}].source_root_ref`);
    requireGit(repository.commit, `composed source-preservation.repositories[${index}].commit`);
    requireGit(repository.tree, `composed source-preservation.repositories[${index}].tree`);
    requireString(repository.branch, `composed source-preservation.repositories[${index}].branch`);
    sortedUnique(repository.remote_refs, `composed source-preservation.repositories[${index}].remote_refs`, {minItems: 1});
    requireRecord(repository.dirty_state, `composed source-preservation.repositories[${index}].dirty_state`);
    assert(["CLEAN", "DIRTY"].includes(repository.dirty_state.status), `composed source-preservation.repositories[${index}] dirty state is invalid`);
    requireString(repository.dirty_state.untracked_owner_policy, `composed source-preservation.repositories[${index}] untracked ownership policy`);
    assert(repository.worktree_evidence?.historical_worktrees_excluded === true, `composed source-preservation.repositories[${index}] does not exclude historical worktrees`);
    assert(repository.submodule_policy === "RECORD_AND_VERIFY;_DO_NOT_TRAVERSE_UNBOUND_SUBMODULES", `composed source-preservation.repositories[${index}] submodule policy is incomplete`);
    sortedUnique(repository.exclusions, `composed source-preservation.repositories[${index}].exclusions`, {minItems: 1});
    assert(repository.exclusions.includes("secrets-and-credentials"), `composed source-preservation.repositories[${index}] lacks secret exclusion`);
    assert(repository.exclusions.includes("historical-worktrees"), `composed source-preservation.repositories[${index}] lacks historical-worktree exclusion`);
    assert(repository.restore_procedure && typeof repository.restore_procedure === "string", `composed source-preservation.repositories[${index}] lacks restore procedure`);
    assert(Array.isArray(repository.artifacts) && repository.artifacts.map((artifact) => artifact.artifact_name).sort(compareUtf8).join("\0") === artifactNames.sort(compareUtf8).join("\0"), `composed source-preservation.repositories[${index}] artifact plan is incomplete`);
    for (const artifact of repository.artifacts) {
      requireRecord(artifact, `composed source-preservation.repositories[${index}].artifact`);
      requireString(artifact.artifact_name, "preservation artifact name");
      requireOpaqueAny(artifact.artifact_ref, "preservation artifact reference");
      requireSha(artifact.planned_identity_sha256, "preservation artifact planned identity");
      assert(artifact.content_addressing === "CONTENT_ADDRESS_AFTER_CREATION_AND_FULL_READBACK", "preservation artifact is not content-addressed after readback");
    }
    repositoryIds.push(repository.repository_id);
  }
  sortedUnique(repositoryIds, "composed source-preservation repository IDs", {minItems: 2});
  assert(JSON.stringify(repositoryIds) === JSON.stringify([...repositoryIds].sort(compareUtf8)), "composed source-preservation repositories are not sorted");
  assert(repositoryIds.length === new Set(repositoryIds).size, "composed source-preservation repository IDs are duplicated");
  requireRecord(plan.exclusions, "composed source-preservation exclusions");
  for (const exclusion of plan.exclusions.repositories ?? []) {
    requireId(exclusion.repository_id, "preserved exclusion repository ID");
    requireOpaque(exclusion.root_ref, "preserved exclusion root");
    assert(exclusion.preserved_outside_product === true, "preserved exclusion may not enter Product scope");
    assert(!repositoryIds.includes(exclusion.repository_id), "preservation exclusion is also an included repository");
  }
  requireRecord(plan.verification, "composed source-preservation verification");
  sortedUnique(plan.verification.before_write, "preservation before-write checks", {minItems: 5});
  sortedUnique(plan.verification.after_creation, "preservation after-creation checks", {minItems: 5});
  assert(plan.verification.independent_reviewer_required === true && plan.verification.consumer_byte_for_byte_check === true, "composed source-preservation independence or zero-trace verification is missing");
  requireString(plan.rollback.restore_rule, "composed source-preservation rollback rule");
  assert(plan.rollback.sources_retained === true && plan.rollback.cutover_reversible === true, "composed source-preservation rollback is incomplete");
  requireSha(plan.plan_sha256, "composed source-preservation plan digest");
  const body = structuredClone(plan); delete body.plan_sha256;
  assert(plan.plan_sha256 === canonicalDigest(body), "composed source-preservation plan is not content-addressed");
  secretFree(plan, "composed source-preservation plan");
  return plan;
}

export function compileComposedPreservationPlan({composedImportPlan, externalPreservationRootPath = null, externalPreservationRootRef = null, nowUtc = "1970-01-01T00:00:00.000Z"} = {}) {
  validateComposedProjectImportPlan(composedImportPlan);
  requireUtc(nowUtc, "composed source-preservation observation time");
  const preservationRootRef = externalPreservationRootRef ?? (externalPreservationRootPath ? opaqueTypedRef("control-plane", externalPreservationRootPath, "external preservation root") : null);
  requireOpaqueAny(preservationRootRef, "external preservation root");
  assert(preservationRootRef !== composedImportPlan.destination_root_ref, "external preservation root overlaps the destination");
  const artifactNames = ["import-exclusions.md", "source-preservation.index.jsonl", "source-preservation.manifest.json", "source-preservation.receipt.json", "source-preservation.zip"];
  const repositories = composedImportPlan.source_roots.map((root) => ({
    repository_id: root.repository_id,
    source_root_ref: root.source_root_ref,
    commit: root.commit,
    tree: root.tree,
    branch: root.branch,
    remote_refs: [...root.remote_refs],
    dirty_state: structuredClone(root.dirty_state),
    worktree_evidence: structuredClone(root.worktree_evidence),
    submodule_policy: "RECORD_AND_VERIFY;_DO_NOT_TRAVERSE_UNBOUND_SUBMODULES",
    exclusions: ["generated-and-temporary-material", "historical-worktrees", "secrets-and-credentials", "unsafe-filesystem-objects"].sort(compareUtf8),
    restore_procedure: "Restore the exact archive and manifest for this source root, verify commit/tree and observation digests, then release only the source-preservation receipt for candidate use.",
    artifacts: artifactNames.map((artifactName) => preservationArtifactPlan({projectPlanSha256: composedImportPlan.plan_sha256, repositoryId: root.repository_id, sourceRootRef: root.source_root_ref, artifactName})).sort((left, right) => compareUtf8(left.artifact_name, right.artifact_name)),
  })).sort((left, right) => compareUtf8(left.repository_id, right.repository_id));
  const body = {
    schema: COMPOSED_PRESERVATION_SCHEMA,
    version: 1,
    governance_version: "2.1rc",
    status: "VERIFIED_PLAN",
    project_import_plan_sha256: composedImportPlan.plan_sha256,
    destination_root_ref: composedImportPlan.destination_root_ref,
    external_preservation_root_ref: preservationRootRef,
    repositories,
    exclusions: {repositories: structuredClone(composedImportPlan.exclusions.repositories)},
    boundaries: {source_mutation: "DENY", destination_mutation: "DENY", archive_creation: "NOT_PERFORMED", zero_trace_consumer: true},
    verification: {
      before_write: ["DESTINATION_IS_SEPARATE_AND_EMPTY_OR_EXPLICITLY_BOUND", "EVERY_INCLUDED_SOURCE_COMMIT_AND_TREE_RECHECKED", "EVERY_DIRTY_AND_UNTRACKED_OWNER_POLICY_BOUND", "EXCLUDED_REPOSITORIES_PRESERVED_OUTSIDE_PRODUCT", "EXTERNAL_PRESERVATION_ROOT_DOES_NOT_OVERLAP_SOURCE_OR_DESTINATION", "REMOTES_WORKTREES_SUBMODULES_AND_UNSAFE_OBJECT_RULES_BOUND"].sort(compareUtf8),
      after_creation: ["ARCHIVE_BYTES_MATCH_MANIFEST", "CONTENT_ADDRESSED_RECEIPT_READBACK", "EXCLUSION_RECORD_READBACK", "RESTORE_PROCEDURE_REHEARSAL_OR_TYPED_EXCEPTION", "SOURCES_REMAIN_BYTE_FOR_BYTE_UNCHANGED", "DESTINATION_ZERO_TRACE_RECHECK"].sort(compareUtf8),
      independent_reviewer_required: true,
      consumer_byte_for_byte_check: true,
      no_archive_created_in_this_plan: true,
    },
    rollback: {sources_retained: true, cutover_reversible: true, restore_rule: "Retain every source root and receipt; reject the candidate and restore only from the exact preserved source identity on any mismatch."},
    execution: {status: "NOT_AUTHORIZED", mutation: "NONE", activation: "OFF", archive_creation: "NOT_PERFORMED"},
    observed_at_utc: nowUtc,
  };
  const plan = {...body, plan_sha256: canonicalDigest(body)};
  return validateComposedPreservationPlan(plan);
}
