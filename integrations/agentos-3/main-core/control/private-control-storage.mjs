#!/usr/bin/env node

/* External private control-plane binding and offline-safe local storage. */

import fs from "node:fs";
import path from "node:path";

import {
  ENVIRONMENT_REFERENCE,
  assertContainedPath,
  assertPortableRecord,
  canonicalDestination,
  canonicalExistingDirectory,
  canonicalDigest,
  collectRegularFiles,
  digestWithout,
  ensureDirectory,
  ensurePrivateGitRepository,
  exactKeys,
  invariant,
  isWithin,
  readGitIdentity,
  readJsonFile,
  requireDigest,
  requireRecord,
  requireString,
  safeRelativePath,
  inventoryDigest,
  writeExactFile,
} from "./private-control-common.mjs";

export const PRIVATE_WORKSPACE_BINDING_SCHEMA = "agentos.private_workspace_binding.v1";
export const PRIVATE_CONTROL_REPOSITORY_SCHEMA = "agentos.private_control_repository.v1";
export const WORKSPACE_BOUNDARY_RECORD = "workspace-boundary.json";
export const WORKSPACE_LAYOUT = "SIBLING_RELEASE_PROJECTS_CONTROL";

const RUNTIME_BINDING = Symbol("agentos.private_workspace.runtime_binding");
const BOUNDARY_FIELDS = [
  "schema", "version", "status", "layout", "release_root_ref", "projects_root_ref", "project_root_ref",
  "control_root_ref", "worktrees_root_ref", "control_repository_policy", "project_state_policy",
  "agent_worktree_policy", "references_policy", "project_write_policy", "project_write_authorization_digest",
  "runtime_binding_digest", "digest",
];

function sibling(left, right) {
  return path.dirname(left) === path.dirname(right);
}

function strictlyWithin(parent, child) {
  return isWithin(parent, child, {strict: true});
}

export function privateControlInventoryOptions(runtime, excludeRootNames = []) {
  const worktreesRelative = path.relative(runtime.control_root, runtime.worktrees_root).replaceAll(path.sep, "/");
  return {
    // Transport bundles are exchange artifacts, not control authority.  They
    // must never become part of a later snapshot or export merely because a
    // caller chose to store the bundle below the control root.
    excludeRootNames: new Set(["exports", ...excludeRootNames]),
    excludeRelativePrefixes: [safeRelativePath(worktreesRelative, "worktrees inventory path")],
  };
}

function bindRuntime({release_root, projects_root, project_root, control_root, worktrees_root, project_write_policy = "EXTERNAL_ONLY", project_write_authorization_digest = null}, refs) {
  const release = canonicalExistingDirectory(release_root, "release root");
  const projects = canonicalExistingDirectory(projects_root, "projects root");
  const project = canonicalExistingDirectory(project_root, "project root");
  const control = canonicalDestination(control_root, "control root");
  const worktrees = canonicalDestination(worktrees_root ?? path.join(control, "worktrees"), "worktrees root");
  invariant(["EXTERNAL_ONLY", "IN_PROJECT_EXPLICIT"].includes(project_write_policy), "project write policy is invalid");
  if (project_write_policy === "EXTERNAL_ONLY") {
    invariant(release !== projects && release !== control && projects !== control, "workspace roots must be distinct", "SIBLING_BOUNDARY_REJECTED");
    invariant(sibling(release, projects) && sibling(release, control) && sibling(projects, control), "release, projects, and control roots must be siblings", "SIBLING_BOUNDARY_REJECTED");
    invariant(!isWithin(project, control) && !isWithin(control, project), "external control root overlaps the project", "SIBLING_BOUNDARY_REJECTED");
    invariant(project_write_authorization_digest === null, "external workspace may not carry in-project authorization", "PROJECT_WRITE_AUTHORIZATION_INVALID");
  } else {
    invariant(typeof project_write_authorization_digest === "string" && /^[0-9a-f]{64}$/u.test(project_write_authorization_digest), "in-project control requires an owner authorization digest", "PROJECT_WRITE_AUTHORIZATION_REQUIRED");
    invariant(sibling(release, projects), "release and projects roots must be siblings", "SIBLING_BOUNDARY_REJECTED");
    invariant(strictlyWithin(project, control), "authorized in-project control root must be inside the project", "CONTAINMENT_REJECTED");
    invariant(!isWithin(release, control) && !isWithin(release, project), "authorized in-project control overlaps the release root", "SIBLING_BOUNDARY_REJECTED");
  }
  invariant(strictlyWithin(projects, project), "project root must be inside the projects root", "CONTAINMENT_REJECTED");
  invariant(strictlyWithin(control, worktrees), "worktrees root must be inside the control root", "CONTAINMENT_REJECTED");
  invariant(!isWithin(release, project), "project root overlaps the release root", "SIBLING_BOUNDARY_REJECTED");
  const binding = {
    release_root: release,
    projects_root: projects,
    project_root: project,
    control_root: control,
    worktrees_root: worktrees,
    project_write_policy,
    project_write_authorization_digest,
    refs: {...refs},
  };
  binding.binding_digest = canonicalDigest({
    release_root: release,
    projects_root: projects,
    project_root: project,
    control_root: control,
    worktrees_root: worktrees,
  });
  return Object.freeze(binding);
}

function attachRuntime(boundary, runtime) {
  Object.defineProperty(boundary, RUNTIME_BINDING, {value: runtime, enumerable: false, configurable: false, writable: false});
  return boundary;
}

function reference(value, label) {
  invariant(typeof value === "string" && ENVIRONMENT_REFERENCE.test(value), `${label} must be an opaque environment reference`);
  return value;
}

export function getPrivateWorkspaceRuntimeBinding(boundary) {
  validatePrivateWorkspaceBinding(boundary);
  invariant(boundary[RUNTIME_BINDING], "workspace runtime binding is unavailable; bind host references before filesystem actions", "RUNTIME_BINDING_REQUIRED");
  return boundary[RUNTIME_BINDING];
}

export function copyPrivateWorkspaceBinding(boundary) {
  validatePrivateWorkspaceBinding(boundary);
  const copy = {...boundary};
  if (boundary[RUNTIME_BINDING]) attachRuntime(copy, boundary[RUNTIME_BINDING]);
  return copy;
}

export function compilePrivateWorkspaceBinding({release_root, projects_root, project_root, control_root, worktrees_root = null, refs = {}, projectWritePolicy = "EXTERNAL_ONLY", projectWriteAuthorizationDigest = null} = {}) {
  const resolvedRefs = {
    release_root: refs.release_root ?? "AGENTOS_RELEASE_ROOT",
    projects_root: refs.projects_root ?? "AGENTOS_PROJECTS_ROOT",
    project_root: refs.project_root ?? "AGENTOS_PROJECT_ROOT",
    control_root: refs.control_root ?? "AGENTOS_CONTROL_ROOT",
    worktrees_root: refs.worktrees_root ?? "AGENTOS_WORKTREES_ROOT",
  };
  for (const [key, value] of Object.entries(resolvedRefs)) reference(value, `${key}_ref`);
  const runtime = bindRuntime({release_root, projects_root, project_root, control_root, worktrees_root, project_write_policy: projectWritePolicy, project_write_authorization_digest: projectWriteAuthorizationDigest}, resolvedRefs);
  const body = {
    schema: PRIVATE_WORKSPACE_BINDING_SCHEMA,
    version: 1,
    status: "PREPARED_NOT_ACTIVATED",
    layout: projectWritePolicy === "IN_PROJECT_EXPLICIT" ? "EXPLICIT_IN_PROJECT_CONTROL" : WORKSPACE_LAYOUT,
    release_root_ref: resolvedRefs.release_root,
    projects_root_ref: resolvedRefs.projects_root,
    project_root_ref: resolvedRefs.project_root,
    control_root_ref: resolvedRefs.control_root,
    worktrees_root_ref: resolvedRefs.worktrees_root,
    control_repository_policy: "PRIVATE_INDEPENDENT_GIT_REPOSITORY_NO_REMOTE_REQUIRED",
    project_state_policy: projectWritePolicy === "IN_PROJECT_EXPLICIT"
      ? "CONTROL_ARTIFACTS_ALLOWED_ONLY_WITH_EXPLICIT_OWNER_AUTHORIZATION"
      : "NEVER_WRITE_OR_STORE_CONTROL_ARTIFACTS_IN_PROJECT",
    agent_worktree_policy: "ISOLATED_CHECKOUTS_ONLY_UNDER_CONTROL_REPOSITORY",
    references_policy: "NO_RESOLVED_PATHS_OR_CONTROL_REFERENCES_IN_PROJECT_RECORDS",
    project_write_policy: projectWritePolicy,
    project_write_authorization_digest: projectWriteAuthorizationDigest,
    runtime_binding_digest: runtime.binding_digest,
    digest: null,
  };
  body.digest = digestWithout(body, "digest");
  const boundary = attachRuntime(body, runtime);
  return validatePrivateWorkspaceBinding(boundary);
}

export function readPrivateWorkspaceRuntimeBinding(environment, boundary) {
  requireRecord(environment, "workspace environment");
  validatePrivateWorkspaceBinding(boundary);
  const refs = {
    release_root: boundary.release_root_ref,
    projects_root: boundary.projects_root_ref,
    project_root: boundary.project_root_ref,
    control_root: boundary.control_root_ref,
    worktrees_root: boundary.worktrees_root_ref,
  };
  const values = {};
  for (const [field, envKey] of Object.entries(refs)) {
    requireString(environment[envKey], envKey);
    values[field] = environment[envKey];
  }
  const runtime = bindRuntime({...values, project_write_policy: boundary.project_write_policy, project_write_authorization_digest: boundary.project_write_authorization_digest}, refs);
  invariant(runtime.binding_digest === boundary.runtime_binding_digest, "workspace environment does not match the bound workspace digest", "WORKSPACE_BINDING_MISMATCH");
  return runtime;
}

export function bindPrivateWorkspaceRuntime(boundary, runtime) {
  validatePrivateWorkspaceBinding(boundary);
  requireRecord(runtime, "workspace runtime binding");
  const refs = {
    release_root: boundary.release_root_ref,
    projects_root: boundary.projects_root_ref,
    project_root: boundary.project_root_ref,
    control_root: boundary.control_root_ref,
    worktrees_root: boundary.worktrees_root_ref,
  };
  const boundRefs = runtime.refs ?? refs;
  invariant(JSON.stringify(boundRefs) === JSON.stringify(refs), "runtime references differ from workspace binding", "WORKSPACE_BINDING_MISMATCH");
  const next = bindRuntime({...runtime, project_write_policy: boundary.project_write_policy, project_write_authorization_digest: boundary.project_write_authorization_digest}, refs);
  invariant(next.binding_digest === boundary.runtime_binding_digest, "runtime roots differ from workspace binding", "WORKSPACE_BINDING_MISMATCH");
  return attachRuntime({...boundary}, next);
}

export function validatePrivateWorkspaceBinding(boundary) {
  exactKeys(boundary, BOUNDARY_FIELDS, "private workspace binding");
  invariant(boundary.schema === PRIVATE_WORKSPACE_BINDING_SCHEMA && boundary.version === 1, "private workspace binding identity is invalid");
  invariant(boundary.status === "PREPARED_NOT_ACTIVATED", "private workspace binding must remain prepared");
  invariant([WORKSPACE_LAYOUT, "EXPLICIT_IN_PROJECT_CONTROL"].includes(boundary.layout), "private workspace layout is invalid");
  for (const [value, label] of [
    [boundary.release_root_ref, "release_root_ref"],
    [boundary.projects_root_ref, "projects_root_ref"],
    [boundary.project_root_ref, "project_root_ref"],
    [boundary.control_root_ref, "control_root_ref"],
    [boundary.worktrees_root_ref, "worktrees_root_ref"],
  ]) reference(value, label);
  invariant(boundary.control_repository_policy === "PRIVATE_INDEPENDENT_GIT_REPOSITORY_NO_REMOTE_REQUIRED", "control repository policy is invalid");
  invariant(["NEVER_WRITE_OR_STORE_CONTROL_ARTIFACTS_IN_PROJECT", "CONTROL_ARTIFACTS_ALLOWED_ONLY_WITH_EXPLICIT_OWNER_AUTHORIZATION"].includes(boundary.project_state_policy), "project state policy is invalid");
  invariant(boundary.agent_worktree_policy === "ISOLATED_CHECKOUTS_ONLY_UNDER_CONTROL_REPOSITORY", "agent worktree policy is invalid");
  invariant(boundary.references_policy === "NO_RESOLVED_PATHS_OR_CONTROL_REFERENCES_IN_PROJECT_RECORDS", "references policy is invalid");
  invariant(["EXTERNAL_ONLY", "IN_PROJECT_EXPLICIT"].includes(boundary.project_write_policy), "project write policy is invalid");
  if (boundary.project_write_policy === "EXTERNAL_ONLY") {
    invariant(boundary.layout === WORKSPACE_LAYOUT && boundary.project_state_policy === "NEVER_WRITE_OR_STORE_CONTROL_ARTIFACTS_IN_PROJECT", "external workspace policy is inconsistent");
    invariant(boundary.project_write_authorization_digest === null, "external workspace carries in-project authorization");
  } else {
    invariant(boundary.layout === "EXPLICIT_IN_PROJECT_CONTROL" && boundary.project_state_policy === "CONTROL_ARTIFACTS_ALLOWED_ONLY_WITH_EXPLICIT_OWNER_AUTHORIZATION", "in-project workspace policy is inconsistent");
    requireDigest(boundary.project_write_authorization_digest, "project write authorization digest");
  }
  requireDigest(boundary.runtime_binding_digest, "runtime binding digest");
  requireDigest(boundary.digest, "workspace binding digest");
  invariant(boundary.digest === digestWithout(boundary, "digest"), "workspace binding digest does not match content");
  assertPortableRecord(boundary, "private workspace binding");
  if (boundary[RUNTIME_BINDING]) invariant(boundary[RUNTIME_BINDING].binding_digest === boundary.runtime_binding_digest, "attached runtime binding differs from workspace binding");
  return boundary;
}

export function assertPrivateControlPath(boundary, candidate, label = "control path", {allowRoot = false, mustExist = false} = {}) {
  const runtime = getPrivateWorkspaceRuntimeBinding(boundary);
  const target = assertContainedPath(runtime.control_root, candidate, label, {allowRoot, mustExist});
  invariant(!isWithin(runtime.release_root, target), `${label} overlaps a protected root`, "CONTAINMENT_REJECTED");
  if (runtime.project_write_policy === "EXTERNAL_ONLY") invariant(!isWithin(runtime.project_root, target), `${label} overlaps the project root`, "CONTAINMENT_REJECTED");
  else invariant(isWithin(runtime.project_root, target), `${label} escapes the explicitly authorized project control root`, "CONTAINMENT_REJECTED");
  return target;
}

export function privateControlSnapshotDigest(boundary, {excludeRelativePaths = []} = {}) {
  const runtime = getPrivateWorkspaceRuntimeBinding(boundary);
  const root = canonicalExistingDirectory(runtime.control_root, "control root");
  const excluded = new Set(excludeRelativePaths.map((value) => safeRelativePath(value, "excluded control path")));
  const entries = collectRegularFiles(root, privateControlInventoryOptions(runtime, [".git"])).filter((entry) => !excluded.has(entry.path));
  return inventoryDigest(entries);
}

function controlBoundaryRecord(boundary, gitIdentity) {
  const body = {
    schema: PRIVATE_CONTROL_REPOSITORY_SCHEMA,
    version: 1,
    status: "BOUND",
    workspace_binding_digest: boundary.digest,
    runtime_binding_digest: boundary.runtime_binding_digest,
    git_repository: {
      topology: gitIdentity.repository,
      commit: gitIdentity.commit,
      tree: gitIdentity.tree,
      clean: gitIdentity.clean,
    },
    digest: null,
  };
  body.digest = digestWithout(body, "digest");
  return body;
}

function validateControlBoundaryRecord(record, boundary) {
  exactKeys(record, ["schema", "version", "status", "workspace_binding_digest", "runtime_binding_digest", "git_repository", "digest"], "control repository boundary record");
  invariant(record.schema === PRIVATE_CONTROL_REPOSITORY_SCHEMA && record.version === 1 && record.status === "BOUND", "control repository record identity is invalid");
  invariant(record.workspace_binding_digest === boundary.digest, "control repository is bound to a different workspace", "WORKSPACE_BINDING_MISMATCH");
  invariant(record.runtime_binding_digest === boundary.runtime_binding_digest, "control repository runtime binding differs", "WORKSPACE_BINDING_MISMATCH");
  requireRecord(record.git_repository, "control repository Git identity");
  exactKeys(record.git_repository, ["topology", "commit", "tree", "clean"], "control repository Git identity");
  invariant(record.git_repository.topology === "INDEPENDENT_GIT", "control repository topology is invalid");
  invariant(typeof record.git_repository.clean === "boolean", "control repository clean state is invalid");
  invariant([null, undefined].includes(record.git_repository.commit) || /^[0-9a-f]{40}$/u.test(record.git_repository.commit), "control repository commit identity is invalid");
  invariant([null, undefined].includes(record.git_repository.tree) || /^[0-9a-f]{40}$/u.test(record.git_repository.tree), "control repository tree identity is invalid");
  invariant(record.digest === digestWithout(record, "digest"), "control repository record digest is invalid");
  assertPortableRecord(record, "control repository boundary record");
  return record;
}

export function preparePrivateWorkspace(boundary, {runtime_binding = null} = {}) {
  validatePrivateWorkspaceBinding(boundary);
  const boundBoundary = runtime_binding ? bindPrivateWorkspaceRuntime(boundary, runtime_binding) : boundary;
  const runtime = getPrivateWorkspaceRuntimeBinding(boundBoundary);
  canonicalExistingDirectory(runtime.release_root, "release root");
  canonicalExistingDirectory(runtime.projects_root, "projects root");
  canonicalExistingDirectory(runtime.project_root, "project root");
  const controlExisted = fs.existsSync(runtime.control_root);
  const control = ensureDirectory(runtime.control_root, "control root");
  const controlEntries = fs.readdirSync(control);
  const gitMetadata = path.join(control, ".git");
  let gitIdentity;
  if (!controlExisted || controlEntries.length === 0) {
    // A host may have created the empty control directory before first use.
    // Initialize only that harmless case; a non-empty foreign directory must
    // never be adopted as AgentOS custody.
    gitIdentity = ensurePrivateGitRepository(control);
  } else {
    if (fs.existsSync(gitMetadata)) {
      const gitStat = fs.lstatSync(gitMetadata);
      invariant(!gitStat.isSymbolicLink(), "control repository Git metadata is a symbolic link", "SYMLINK_COMPONENT_REJECTED");
    }
    invariant(fs.existsSync(gitMetadata), "existing control root is not an independent Git repository", "NOT_A_GIT_REPOSITORY");
    gitIdentity = readGitIdentity(control);
  }
  ensureDirectory(runtime.worktrees_root, "worktrees root");

  const boundaryPath = path.join(control, WORKSPACE_BOUNDARY_RECORD);
  const boundaryBytes = Buffer.from(`${JSON.stringify(boundary, null, 2)}\n`, "utf8");
  const boundaryWrite = writeExactFile(boundaryPath, boundaryBytes, {mode: 0o600});
  const parsedBoundary = readJsonFile(boundaryPath, "workspace boundary record");
  validatePrivateWorkspaceBinding(parsedBoundary);
  invariant(parsedBoundary.digest === boundBoundary.digest, "workspace boundary record differs from the prepared boundary", "WORKSPACE_BINDING_MISMATCH");

  const record = controlBoundaryRecord(boundBoundary, gitIdentity);
  validateControlBoundaryRecord(record, boundBoundary);
  const result = {
    status: controlExisted ? "VERIFIED" : "CREATED",
    workspace_binding: copyPrivateWorkspaceBinding(boundBoundary),
    control_repository: record,
    boundary_record_status: boundaryWrite.status,
    project_tree_touched: false,
  };
  assertPortableRecord(result, "prepared private workspace result");
  return result;
}

export function validatePrivateControlRelativePath(value, label = "control relative path") {
  return safeRelativePath(value, label);
}

export function privateControlFilePath(boundary, relativePath, {mustExist = false} = {}) {
  const runtime = getPrivateWorkspaceRuntimeBinding(boundary);
  const relative = safeRelativePath(relativePath, "control relative path");
  invariant(relative !== ".git" && !relative.startsWith(".git/"), "Git metadata is not a portable control artifact", "UNSAFE_GIT_OBJECT");
  invariant(relative !== "exports" && !relative.startsWith("exports/"), "transport exports are not control authority", "UNSAFE_ARTIFACT");
  const candidate = path.join(runtime.control_root, relative);
  return assertPrivateControlPath(boundary, candidate, "control file path", {mustExist});
}

export function controlBoundaryEnvironmentReferences(boundary) {
  validatePrivateWorkspaceBinding(boundary);
  return Object.freeze({
    release_root_ref: boundary.release_root_ref,
    projects_root_ref: boundary.projects_root_ref,
    project_root_ref: boundary.project_root_ref,
    control_root_ref: boundary.control_root_ref,
    worktrees_root_ref: boundary.worktrees_root_ref,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("private control storage loaded\n");
