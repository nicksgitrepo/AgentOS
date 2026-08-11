#!/usr/bin/env node

/* Private release replacement and project-governance preservation boundary. */

import fs from "node:fs";
import path from "node:path";

import {
  GIT_OBJECT,
  PrivateControlError,
  assertPortableRecord,
  canonicalDigest,
  canonicalDestination,
  canonicalExistingDirectory,
  canonicalJson,
  directoryContentDigest,
  digestWithout,
  ensureDirectory,
  exactKeys,
  invariant,
  isWithin,
  readGitIdentity,
  readJsonFile,
  requireDigest,
  requireEnvironmentReference,
  requireGitObject,
  requireRecord,
  requireSafeIdentifier,
  requireString,
  safeRelativePath,
  writeExactFile,
} from "./private-control-common.mjs";
import {
  assertPrivateControlPath,
  getPrivateWorkspaceRuntimeBinding,
  privateControlFilePath,
  privateControlSnapshotDigest,
  validatePrivateWorkspaceBinding,
} from "./private-control-storage.mjs";

export const PROJECT_GOVERNANCE_APPENDIX_SCHEMA = "agentos.project_governance_appendix.v1";
export const PROJECT_GOVERNANCE_UPDATE_SCHEMA = "agentos.project_governance_update.v1";
export const PRIVATE_RELEASE_UPDATE_SCHEMA = "agentos.private_release_update.v1";
export const PRIVATE_RELEASE_UPDATE_PREPARED_SCHEMA = "agentos.private_release_update_prepared.v1";
export const PRIVATE_RELEASE_UPDATE_RECEIPT_SCHEMA = "agentos.private_release_update_receipt.v1";
export const GOVERNANCE_UPDATE_MODES = Object.freeze(["KEEP_PROJECT_APPENDICES", "RESET_GOVERNANCE_CLEAN"]);
export const RELEASE_UPDATE_PHASES = Object.freeze(["CUTOVER_READY", "RELEASE_REPLACED", "VERIFIED", "GOVERNANCE_REVIEW_REQUIRED", "ROLLED_BACK"]);

const APPENDIX_FIELDS = ["schema", "version", "status", "project_id", "source_revision", "compatible_release_digests", "graph_bindings", "role_overlays", "digest"];
const GRAPH_FIELDS = ["graph_id", "path", "graph_sha256"];
const GOVERNANCE_UPDATE_FIELDS = [
  "schema", "version", "status", "mode", "project_id", "current_appendix_digest", "replacement_release_digest",
  "preserved_appendix_digest", "archived_appendix_digest", "clean_governance_digest", "owner_decision_digest", "digest",
];
const RELEASE_PLAN_FIELDS = [
  "schema", "version", "status", "update_id", "project_id", "release_root_ref", "candidate_root_ref", "retention_root_ref",
  "workspace_boundary", "workspace_binding_digest", "current_release", "replacement_release", "governance_mode", "governance_action",
  "control_snapshot_digest", "project_action", "release_action", "rollback_policy", "owner_decision_digest", "digest",
];
const RELEASE_RECEIPT_FIELDS = [
  "schema", "version", "status", "phase", "update_id", "project_id", "workspace_binding_digest", "control_snapshot_digest_before",
  "control_snapshot_digest_after", "current_release", "replacement_release", "governance_mode", "governance_decision_digest",
  "candidate_root_ref", "retention_root_ref", "project_tree_touched", "rollback_available", "digest",
];

function validateReleaseIdentity(value, label) {
  exactKeys(value, ["version", "source_commit", "source_tree", "release_digest"], label);
  requireSafeIdentifier(value.version, `${label}.version`);
  requireGitObject(value.source_commit, `${label}.source_commit`);
  requireGitObject(value.source_tree, `${label}.source_tree`);
  requireDigest(value.release_digest, `${label}.release_digest`);
  return value;
}

function validateGraphBinding(value, label) {
  exactKeys(value, GRAPH_FIELDS, label);
  requireSafeIdentifier(value.graph_id, `${label}.graph_id`);
  value.path = safeRelativePath(value.path, `${label}.path`);
  requireDigest(value.graph_sha256, `${label}.graph_sha256`);
  return value;
}

export function compileProjectGovernanceAppendix({
  projectId,
  sourceRevision,
  compatibleReleaseDigests,
  graphBindings = [],
  roleOverlays = [],
  status = "ACTIVE",
} = {}) {
  requireSafeIdentifier(projectId, "project governance project ID");
  requireSafeIdentifier(sourceRevision, "project governance source revision");
  invariant(["ACTIVE", "CLEAN", "ARCHIVED"].includes(status), "project governance appendix status is invalid");
  invariant(Array.isArray(compatibleReleaseDigests) && compatibleReleaseDigests.length > 0, "project governance compatible release digests are required");
  const compatible = [...new Set(compatibleReleaseDigests)].sort();
  compatible.forEach((value) => requireDigest(value, "project governance compatible release digest"));
  invariant(Array.isArray(graphBindings), "project governance graph bindings are invalid");
  const graphs = graphBindings.map((value, index) => validateGraphBinding({...value}, `project governance graph binding ${index}`));
  invariant(new Set(graphs.map((value) => value.graph_id)).size === graphs.length, "project governance graph IDs must be unique");
  invariant(Array.isArray(roleOverlays), "project governance role overlays are invalid");
  const body = {
    schema: PROJECT_GOVERNANCE_APPENDIX_SCHEMA,
    version: 1,
    status,
    project_id: projectId,
    source_revision: sourceRevision,
    compatible_release_digests: compatible,
    graph_bindings: graphs,
    role_overlays: structuredClone(roleOverlays),
    digest: null,
  };
  body.digest = digestWithout(body, "digest");
  return validateProjectGovernanceAppendix(body);
}

export function validateProjectGovernanceAppendix(appendix) {
  exactKeys(appendix, APPENDIX_FIELDS, "project governance appendix");
  invariant(appendix.schema === PROJECT_GOVERNANCE_APPENDIX_SCHEMA && appendix.version === 1, "project governance appendix identity is invalid");
  invariant(["ACTIVE", "CLEAN", "ARCHIVED"].includes(appendix.status), "project governance appendix status is invalid");
  requireSafeIdentifier(appendix.project_id, "project governance project ID");
  requireSafeIdentifier(appendix.source_revision, "project governance source revision");
  invariant(Array.isArray(appendix.compatible_release_digests) && appendix.compatible_release_digests.length > 0, "project governance compatible release digests are required");
  appendix.compatible_release_digests.forEach((value) => requireDigest(value, "project governance compatible release digest"));
  invariant(new Set(appendix.compatible_release_digests).size === appendix.compatible_release_digests.length, "project governance compatible release digests must be unique");
  invariant(Array.isArray(appendix.graph_bindings), "project governance graph bindings are invalid");
  appendix.graph_bindings.forEach((value, index) => validateGraphBinding(value, `project governance graph binding ${index}`));
  invariant(new Set(appendix.graph_bindings.map((value) => value.graph_id)).size === appendix.graph_bindings.length, "project governance graph IDs must be unique");
  invariant(Array.isArray(appendix.role_overlays), "project governance role overlays are invalid");
  requireDigest(appendix.digest, "project governance appendix digest");
  invariant(appendix.digest === digestWithout(appendix, "digest"), "project governance appendix digest does not match content");
  assertPortableRecord(appendix, "project governance appendix");
  return appendix;
}

export function chooseProjectGovernanceUpdate({
  mode,
  projectId,
  currentAppendix = null,
  replacementReleaseDigest,
  cleanGovernance = null,
  ownerDecisionDigest = null,
} = {}) {
  invariant(GOVERNANCE_UPDATE_MODES.includes(mode), "governance update mode is invalid");
  requireSafeIdentifier(projectId, "governance update project ID");
  requireDigest(replacementReleaseDigest, "governance replacement release digest");
  if (currentAppendix !== null) validateProjectGovernanceAppendix(currentAppendix);
  if (cleanGovernance !== null) validateProjectGovernanceAppendix(cleanGovernance);
  if (currentAppendix !== null) invariant(currentAppendix.project_id === projectId, "current project governance belongs to a different project", "GOVERNANCE_PROJECT_MISMATCH");
  if (cleanGovernance !== null) invariant(cleanGovernance.project_id === projectId, "clean project governance belongs to a different project", "GOVERNANCE_PROJECT_MISMATCH");
  if (ownerDecisionDigest !== null) requireDigest(ownerDecisionDigest, "governance owner decision digest");
  const currentDigest = currentAppendix?.digest ?? null;
  let status;
  let preserved = null;
  let archived = null;
  let clean = null;
  if (mode === "KEEP_PROJECT_APPENDICES") {
    if (currentAppendix === null || currentAppendix.compatible_release_digests.includes(replacementReleaseDigest)) {
      status = "PRESERVED";
      preserved = currentDigest;
    } else {
      status = "GOVERNANCE_REVIEW_REQUIRED";
    }
  } else {
    requireDigest(ownerDecisionDigest, "governance reset owner decision digest");
    invariant(cleanGovernance !== null && cleanGovernance.status === "CLEAN", "governance reset requires a clean governance appendix", "GOVERNANCE_RESET_INPUT_REQUIRED");
    status = "RESET_STAGED";
    archived = currentDigest;
    clean = cleanGovernance.digest;
  }
  const body = {
    schema: PROJECT_GOVERNANCE_UPDATE_SCHEMA,
    version: 1,
    status,
    mode,
    project_id: projectId,
    current_appendix_digest: currentDigest,
    replacement_release_digest: replacementReleaseDigest,
    preserved_appendix_digest: preserved,
    archived_appendix_digest: archived,
    clean_governance_digest: clean,
    owner_decision_digest: ownerDecisionDigest,
    digest: null,
  };
  body.digest = digestWithout(body, "digest");
  return validateProjectGovernanceUpdate(body);
}

export function validateProjectGovernanceUpdate(update) {
  exactKeys(update, GOVERNANCE_UPDATE_FIELDS, "project governance update");
  invariant(update.schema === PROJECT_GOVERNANCE_UPDATE_SCHEMA && update.version === 1, "project governance update identity is invalid");
  invariant(["PRESERVED", "RESET_STAGED", "GOVERNANCE_REVIEW_REQUIRED"].includes(update.status), "project governance update status is invalid");
  invariant(GOVERNANCE_UPDATE_MODES.includes(update.mode), "project governance update mode is invalid");
  requireSafeIdentifier(update.project_id, "governance update project ID");
  for (const [value, label] of [
    [update.current_appendix_digest, "current appendix digest"],
    [update.preserved_appendix_digest, "preserved appendix digest"],
    [update.archived_appendix_digest, "archived appendix digest"],
    [update.clean_governance_digest, "clean governance digest"],
    [update.owner_decision_digest, "owner decision digest"],
  ]) if (value !== null) requireDigest(value, label);
  requireDigest(update.replacement_release_digest, "replacement release digest");
  if (update.mode === "KEEP_PROJECT_APPENDICES") invariant(update.status !== "RESET_STAGED" && update.clean_governance_digest === null, "keep mode carries reset data");
  if (update.mode === "KEEP_PROJECT_APPENDICES") invariant(["PRESERVED", "GOVERNANCE_REVIEW_REQUIRED"].includes(update.status), "keep mode has an invalid governance status");
  if (update.mode === "RESET_GOVERNANCE_CLEAN") invariant(update.status === "RESET_STAGED" && update.owner_decision_digest !== null && update.clean_governance_digest !== null, "reset mode lacks its decision or clean governance");
  requireDigest(update.digest, "project governance update digest");
  invariant(update.digest === digestWithout(update, "digest"), "project governance update digest does not match content");
  assertPortableRecord(update, "project governance update");
  return update;
}

export function readReleaseIdentity(root, version) {
  const releaseRoot = canonicalExistingDirectory(root, "release root");
  const git = readGitIdentity(releaseRoot);
  invariant(git.commit !== null && git.tree !== null && GIT_OBJECT.test(git.commit) && GIT_OBJECT.test(git.tree), "release must have a readable Git commit and tree", "RELEASE_IDENTITY_UNAVAILABLE");
  return {
    version,
    source_commit: git.commit,
    source_tree: git.tree,
    release_digest: directoryContentDigest(releaseRoot, {excludeRootNames: new Set([".git"])}),
  };
}

export function compilePrivateReleaseReplacementPlan({
  updateId,
  projectId,
  workspaceBoundary,
  currentRelease,
  replacementRelease,
  governanceMode = "KEEP_PROJECT_APPENDICES",
  controlSnapshotDigest,
  ownerDecisionDigest = null,
  candidateRootRef = "AGENTOS_CANDIDATE_RELEASE",
  retentionRootRef = "AGENTOS_RELEASE_RETENTION",
} = {}) {
  requireSafeIdentifier(updateId, "release update ID");
  requireSafeIdentifier(projectId, "release update project ID");
  validatePrivateWorkspaceBinding(workspaceBoundary);
  validateReleaseIdentity(currentRelease, "current release");
  validateReleaseIdentity(replacementRelease, "replacement release");
  invariant(currentRelease.release_digest !== replacementRelease.release_digest, "replacement release must differ from current release");
  invariant(GOVERNANCE_UPDATE_MODES.includes(governanceMode), "release governance mode is invalid");
  requireDigest(controlSnapshotDigest, "release control snapshot digest");
  if (ownerDecisionDigest !== null) requireDigest(ownerDecisionDigest, "release owner decision digest");
  if (governanceMode === "RESET_GOVERNANCE_CLEAN") requireDigest(ownerDecisionDigest, "governance reset owner decision digest");
  requireEnvironmentReference(candidateRootRef, "candidate root reference");
  requireEnvironmentReference(retentionRootRef, "retention root reference");
  const body = {
    schema: PRIVATE_RELEASE_UPDATE_SCHEMA,
    version: 1,
    status: "PREPARED_NOT_ACTIVATED",
    update_id: updateId,
    project_id: projectId,
    release_root_ref: workspaceBoundary.release_root_ref,
    candidate_root_ref: candidateRootRef,
    retention_root_ref: retentionRootRef,
    workspace_boundary: {...workspaceBoundary},
    workspace_binding_digest: workspaceBoundary.digest,
    current_release: {...currentRelease},
    replacement_release: {...replacementRelease},
    governance_mode: governanceMode,
    governance_action: governanceMode === "KEEP_PROJECT_APPENDICES"
      ? "PRESERVE_AND_REVALIDATE_PROJECT_APPENDICES"
      : "ARCHIVE_AND_RESET_PROJECT_GOVERNANCE",
    control_snapshot_digest: controlSnapshotDigest,
    project_action: "LEAVE_PROJECT_REPOSITORIES_UNCHANGED",
    release_action: "REPLACE_RELEASE_AT_SAME_ROOT",
    rollback_policy: "RETAIN_PREVIOUS_RELEASE_UNTIL_REPLACEMENT_IS_VERIFIED",
    owner_decision_digest: ownerDecisionDigest,
    digest: null,
  };
  body.digest = digestWithout(body, "digest");
  return validatePrivateReleaseReplacementPlan(body);
}

export function validatePrivateReleaseReplacementPlan(plan) {
  exactKeys(plan, RELEASE_PLAN_FIELDS, "private release replacement plan");
  invariant(plan.schema === PRIVATE_RELEASE_UPDATE_SCHEMA && plan.version === 1 && plan.status === "PREPARED_NOT_ACTIVATED", "private release replacement plan identity is invalid");
  requireSafeIdentifier(plan.update_id, "release update ID");
  requireSafeIdentifier(plan.project_id, "release update project ID");
  validatePrivateWorkspaceBinding(plan.workspace_boundary);
  requireDigest(plan.workspace_binding_digest, "release workspace binding digest");
  invariant(plan.workspace_binding_digest === plan.workspace_boundary.digest, "release plan workspace binding differs from boundary");
  requireEnvironmentReference(plan.release_root_ref, "release root reference");
  requireEnvironmentReference(plan.candidate_root_ref, "candidate root reference");
  requireEnvironmentReference(plan.retention_root_ref, "retention root reference");
  validateReleaseIdentity(plan.current_release, "current release");
  validateReleaseIdentity(plan.replacement_release, "replacement release");
  invariant(plan.current_release.release_digest !== plan.replacement_release.release_digest, "release plan replacement does not differ");
  invariant(GOVERNANCE_UPDATE_MODES.includes(plan.governance_mode), "release plan governance mode is invalid");
  requireString(plan.governance_action, "release governance action");
  requireDigest(plan.control_snapshot_digest, "release control snapshot digest");
  invariant(plan.project_action === "LEAVE_PROJECT_REPOSITORIES_UNCHANGED", "release plan may not modify project repositories");
  invariant(plan.release_action === "REPLACE_RELEASE_AT_SAME_ROOT", "release action is invalid");
  invariant(plan.rollback_policy === "RETAIN_PREVIOUS_RELEASE_UNTIL_REPLACEMENT_IS_VERIFIED", "release rollback policy is invalid");
  if (plan.owner_decision_digest !== null) requireDigest(plan.owner_decision_digest, "release owner decision digest");
  if (plan.governance_mode === "RESET_GOVERNANCE_CLEAN") requireDigest(plan.owner_decision_digest, "release reset owner decision digest");
  requireDigest(plan.digest, "release plan digest");
  invariant(plan.digest === digestWithout(plan, "digest"), "release plan digest does not match content");
  assertPortableRecord(plan, "private release replacement plan");
  return plan;
}

function assertExternalReleasePath(runtime, candidate, label, {mustExist = true} = {}) {
  const target = mustExist ? canonicalExistingDirectory(candidate, label) : canonicalDestination(candidate, label);
  invariant(path.dirname(target) === path.dirname(runtime.release_root), `${label} must be a release sibling`, "SIBLING_BOUNDARY_REJECTED");
  invariant(!isWithin(runtime.projects_root, target) && !isWithin(runtime.control_root, target), `${label} overlaps a protected workspace root`, "CONTAINMENT_REJECTED");
  invariant(!isWithin(runtime.project_root, target) && target !== runtime.release_root, `${label} overlaps the project or active release`, "CONTAINMENT_REJECTED");
  return target;
}

function updateFile(boundary, updateId, suffix) {
  return privateControlFilePath(boundary, `updates/${updateId}.${suffix}.json`);
}

function writeControlRecord(boundary, relativePath, record) {
  const destination = privateControlFilePath(boundary, relativePath);
  ensureDirectory(path.dirname(destination), "control record parent");
  assertPortableRecord(record, `control record ${relativePath}`);
  return writeExactFile(destination, Buffer.from(`${canonicalJson(record)}\n`, "utf8"), {mode: 0o600});
}

function rollbackReplacement(currentRoot, candidateRoot, retentionRoot, {candidateMoved, oldMoved}) {
  try {
    if (candidateMoved && fs.existsSync(currentRoot) && !fs.existsSync(candidateRoot)) fs.renameSync(currentRoot, candidateRoot);
    if (oldMoved && fs.existsSync(retentionRoot) && !fs.existsSync(currentRoot)) fs.renameSync(retentionRoot, currentRoot);
    invariant(fs.existsSync(currentRoot) && fs.existsSync(candidateRoot), "release rollback did not restore both release roots", "RELEASE_ROLLBACK_FAILED");
    return true;
  } catch (error) {
    throw new PrivateControlError(`release rollback failed: ${error.message}`, "RELEASE_ROLLBACK_FAILED");
  }
}

export function executePrivateReleaseReplacement({
  plan,
  workspaceBoundary = null,
  candidateRoot,
  retentionRoot,
  projectGovernanceAppendix = null,
  cleanGovernanceAppendix = null,
} = {}) {
  validatePrivateReleaseReplacementPlan(plan);
  const boundary = workspaceBoundary ?? plan.workspace_boundary;
  validatePrivateWorkspaceBinding(boundary);
  invariant(boundary.digest === plan.workspace_binding_digest, "release executor workspace binding differs from plan", "WORKSPACE_BINDING_MISMATCH");
  const runtime = getPrivateWorkspaceRuntimeBinding(boundary);
  const receiptPath = updateFile(boundary, plan.update_id, "receipt");
  if (fs.existsSync(receiptPath)) {
    const existing = readJsonFile(receiptPath, "release update receipt");
    validatePrivateReleaseReceipt(existing);
    return {status: existing.status, idempotent: true, receipt: existing};
  }
  const currentRoot = canonicalExistingDirectory(runtime.release_root, "active release root");
  const candidate = assertExternalReleasePath(runtime, candidateRoot, "replacement release root");
  const retention = assertExternalReleasePath(runtime, retentionRoot, "release retention root", {mustExist: false});
  invariant(!fs.existsSync(retention), "release retention root already exists", "SHARED_FILE_CONFLICT");
  invariant(candidate !== currentRoot && candidate !== retention, "release candidate or retention root aliases the active release", "CONTAINMENT_REJECTED");
  const currentIdentity = readReleaseIdentity(currentRoot, plan.current_release.version);
  const candidateIdentity = readReleaseIdentity(candidate, plan.replacement_release.version);
  invariant(canonicalJson(currentIdentity) === canonicalJson(plan.current_release), "active release identity differs from the exact plan", "RELEASE_IDENTITY_MISMATCH");
  invariant(canonicalJson(candidateIdentity) === canonicalJson(plan.replacement_release), "replacement release identity differs from the exact plan", "RELEASE_IDENTITY_MISMATCH");
  const beforeControlDigest = privateControlSnapshotDigest(boundary);
  invariant(beforeControlDigest === plan.control_snapshot_digest, "control repository changed after release plan approval", "CONTROL_SNAPSHOT_MISMATCH");

  const governance = chooseProjectGovernanceUpdate({
    mode: plan.governance_mode,
    projectId: plan.project_id,
    currentAppendix: projectGovernanceAppendix,
    replacementReleaseDigest: plan.replacement_release.release_digest,
    cleanGovernance: cleanGovernanceAppendix,
    ownerDecisionDigest: plan.owner_decision_digest,
  });
  writeControlRecord(boundary, `governance/release-updates/${plan.update_id}.json`, governance);
  if (governance.status === "GOVERNANCE_REVIEW_REQUIRED") {
    return {status: governance.status, idempotent: false, governance_decision: governance, project_tree_touched: false};
  }
  if (plan.governance_mode === "KEEP_PROJECT_APPENDICES" && projectGovernanceAppendix !== null) {
    writeControlRecord(boundary, `governance/preserved/${plan.update_id}.appendix.json`, projectGovernanceAppendix);
  }
  if (plan.governance_mode === "RESET_GOVERNANCE_CLEAN") {
    if (projectGovernanceAppendix !== null) {
      const archived = {...projectGovernanceAppendix, status: "ARCHIVED", digest: null};
      archived.digest = digestWithout(archived, "digest");
      writeControlRecord(boundary, `governance/archives/${projectGovernanceAppendix.digest}.json`, archived);
    }
    writeControlRecord(boundary, `governance/active/${plan.update_id}.json`, cleanGovernanceAppendix);
  }
  writeControlRecord(boundary, `updates/${plan.update_id}.plan.json`, plan);
  const prepared = {
    schema: PRIVATE_RELEASE_UPDATE_PREPARED_SCHEMA,
    version: 1,
    status: "CUTOVER_READY",
    update_id: plan.update_id,
    project_id: plan.project_id,
    workspace_binding_digest: plan.workspace_binding_digest,
    control_snapshot_digest_before: beforeControlDigest,
    current_release: currentIdentity,
    replacement_release: candidateIdentity,
    governance_decision_digest: governance.digest,
    candidate_root_ref: plan.candidate_root_ref,
    retention_root_ref: plan.retention_root_ref,
    digest: null,
  };
  prepared.digest = digestWithout(prepared, "digest");
  writeControlRecord(boundary, `updates/${plan.update_id}.prepared.json`, prepared);

  let oldMoved = false;
  let candidateMoved = false;
  try {
    fs.renameSync(currentRoot, retention);
    oldMoved = true;
    fs.renameSync(candidate, currentRoot);
    candidateMoved = true;
    const rebound = readReleaseIdentity(currentRoot, plan.replacement_release.version);
    invariant(canonicalJson(rebound) === canonicalJson(plan.replacement_release), "replacement release readback differs after cutover", "RELEASE_IDENTITY_MISMATCH");
    const receiptRelative = `updates/${plan.update_id}.receipt.json`;
    const afterControlDigest = privateControlSnapshotDigest(boundary, {excludeRelativePaths: [receiptRelative]});
    const receiptBody = {
      schema: PRIVATE_RELEASE_UPDATE_RECEIPT_SCHEMA,
      version: 1,
      status: "VERIFIED",
      phase: "VERIFIED",
      update_id: plan.update_id,
      project_id: plan.project_id,
      workspace_binding_digest: plan.workspace_binding_digest,
      control_snapshot_digest_before: beforeControlDigest,
      control_snapshot_digest_after: afterControlDigest,
      current_release: currentIdentity,
      replacement_release: rebound,
      governance_mode: plan.governance_mode,
      governance_decision_digest: governance.digest,
      candidate_root_ref: plan.candidate_root_ref,
      retention_root_ref: plan.retention_root_ref,
      project_tree_touched: false,
      rollback_available: true,
      digest: null,
    };
    receiptBody.digest = digestWithout(receiptBody, "digest");
    validatePrivateReleaseReceipt(receiptBody);
    writeControlRecord(boundary, receiptRelative, receiptBody);
    return {status: "VERIFIED", idempotent: false, receipt: receiptBody, governance_decision: governance, project_tree_touched: false};
  } catch (error) {
    rollbackReplacement(currentRoot, candidate, retention, {candidateMoved, oldMoved});
    throw error;
  }
}

export function validatePrivateReleaseReceipt(receipt) {
  exactKeys(receipt, RELEASE_RECEIPT_FIELDS, "private release update receipt");
  invariant(receipt.schema === PRIVATE_RELEASE_UPDATE_RECEIPT_SCHEMA && receipt.version === 1, "private release receipt identity is invalid");
  invariant(receipt.status === "VERIFIED" && receipt.phase === "VERIFIED", "private release receipt is not verified");
  requireSafeIdentifier(receipt.update_id, "release receipt update ID");
  requireSafeIdentifier(receipt.project_id, "release receipt project ID");
  requireDigest(receipt.workspace_binding_digest, "release receipt workspace binding digest");
  requireDigest(receipt.control_snapshot_digest_before, "release receipt before digest");
  requireDigest(receipt.control_snapshot_digest_after, "release receipt after digest");
  validateReleaseIdentity(receipt.current_release, "release receipt current release");
  validateReleaseIdentity(receipt.replacement_release, "release receipt replacement release");
  invariant(GOVERNANCE_UPDATE_MODES.includes(receipt.governance_mode), "release receipt governance mode is invalid");
  requireDigest(receipt.governance_decision_digest, "release receipt governance decision digest");
  requireEnvironmentReference(receipt.candidate_root_ref, "release receipt candidate root reference");
  requireEnvironmentReference(receipt.retention_root_ref, "release receipt retention root reference");
  invariant(receipt.project_tree_touched === false && receipt.rollback_available === true, "release receipt protection flags are invalid");
  requireDigest(receipt.digest, "release receipt digest");
  invariant(receipt.digest === digestWithout(receipt, "digest"), "release receipt digest does not match content");
  assertPortableRecord(receipt, "private release update receipt");
  return receipt;
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("private release update loaded\n");
