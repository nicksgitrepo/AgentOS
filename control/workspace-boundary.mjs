import path from "node:path";
import {assert, digestWithout, sha256} from "./canonical-json.mjs";

export const WORKSPACE_BOUNDARY_SCHEMA = "agentos.workspace_boundary.v2";
export const WORKSPACE_LAYOUT = "SIBLING_RELEASE_PROJECTS_CONTROL";

const RUNTIME_BINDING = Symbol("agentos.workspace.runtime_binding");
const REF = /^[A-Z][A-Z0-9_]*$/u;

const FIELDS = [
  "schema", "version", "status", "layout", "release_root_ref", "projects_root_ref", "project_root_ref",
  "control_root_ref", "worktrees_root_ref", "control_repository_policy", "project_state_policy",
  "agent_worktree_policy", "references_policy", "runtime_binding_digest", "digest",
];

function exactKeys(value, expected, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort()), `${label} fields mismatch`);
}

function absolutePath(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} is required`);
  assert(path.isAbsolute(value), `${label} must be an absolute path`);
  const normalized = path.normalize(value);
  assert(path.dirname(normalized) !== normalized, `${label} cannot be the filesystem root`);
  return normalized;
}

function reference(value, label) {
  assert(typeof value === "string" && REF.test(value), `${label} must be an environment reference`);
  return value;
}

function sameOrWithin(parent, child) {
  return child === parent || child.startsWith(`${parent}${path.sep}`);
}

function strictlyWithin(parent, child) {
  return child !== parent && sameOrWithin(parent, child);
}

function sibling(left, right) {
  return path.dirname(left) === path.dirname(right);
}

function runtimeBinding({release_root, projects_root, project_root, control_root, worktrees_root}, refs) {
  const binding = {
    release_root: absolutePath(release_root, "release_root"),
    projects_root: absolutePath(projects_root, "projects_root"),
    project_root: absolutePath(project_root, "project_root"),
    control_root: absolutePath(control_root, "control_root"),
    worktrees_root: absolutePath(worktrees_root, "worktrees_root"),
    refs: {...refs},
  };
  binding.binding_digest = sha256({
    release_root: binding.release_root,
    projects_root: binding.projects_root,
    project_root: binding.project_root,
    control_root: binding.control_root,
    worktrees_root: binding.worktrees_root,
  });
  const release = binding.release_root;
  const projects = binding.projects_root;
  const project = binding.project_root;
  const control = binding.control_root;
  const worktrees = binding.worktrees_root;
  assert(release !== projects && release !== control && projects !== control, "workspace roots must be distinct");
  assert(sibling(release, projects) && sibling(release, control) && sibling(projects, control), "release, projects, and control roots must be siblings");
  assert(strictlyWithin(projects, project), "project root must be a child of the projects root");
  assert(strictlyWithin(control, worktrees), "worker worktrees must be inside the control root");
  assert(!sameOrWithin(release, project) && !sameOrWithin(control, project), "project root overlaps an AgentOS root");
  return Object.freeze(binding);
}

function attachRuntimeBinding(boundary, binding) {
  Object.defineProperty(boundary, RUNTIME_BINDING, {value: binding, enumerable: false, configurable: false, writable: false});
  return boundary;
}

export function getWorkspaceRuntimeBinding(boundary) {
  validateWorkspaceBoundary(boundary);
  assert(boundary[RUNTIME_BINDING], "workspace runtime binding is unavailable; resolve environment references before host actions");
  return boundary[RUNTIME_BINDING];
}

export function copyWorkspaceBoundary(boundary) {
  validateWorkspaceBoundary(boundary);
  const copy = {...boundary};
  if (boundary[RUNTIME_BINDING]) attachRuntimeBinding(copy, boundary[RUNTIME_BINDING]);
  return copy;
}

export function compileWorkspaceBoundary({release_root, projects_root, project_root, control_root, worktrees_root, refs = {}}) {
  const resolvedRefs = {
    release_root: refs.release_root ?? "AGENTOS_RELEASE_ROOT",
    projects_root: refs.projects_root ?? "AGENTOS_PROJECTS_ROOT",
    project_root: refs.project_root ?? "AGENTOS_PROJECT_ROOT",
    control_root: refs.control_root ?? "AGENTOS_CONTROL_ROOT",
    worktrees_root: refs.worktrees_root ?? "AGENTOS_WORKTREES_ROOT",
  };
  for (const [key, value] of Object.entries(resolvedRefs)) reference(value, `${key}_ref`);
  const binding = runtimeBinding({release_root, projects_root, project_root, control_root, worktrees_root: worktrees_root ?? path.join(control_root, "worktrees")}, resolvedRefs);
  const boundary = {
    schema: WORKSPACE_BOUNDARY_SCHEMA,
    version: 2,
    status: "PREPARED_NOT_ACTIVATED",
    layout: WORKSPACE_LAYOUT,
    release_root_ref: resolvedRefs.release_root,
    projects_root_ref: resolvedRefs.projects_root,
    project_root_ref: resolvedRefs.project_root,
    control_root_ref: resolvedRefs.control_root,
    worktrees_root_ref: resolvedRefs.worktrees_root,
    control_repository_policy: "CREATE_SIBLING_REPOSITORY_BEFORE_ANY_WRITE",
    project_state_policy: "NEVER_WRITE_OR_STORE_AGENTOS_ARTIFACTS",
    agent_worktree_policy: "ISOLATED_CHECKOUTS_ONLY_UNDER_CONTROL_REPOSITORY",
    references_policy: "NO_AGENTOS_REFERENCES_IN_PROJECT_TREE",
    runtime_binding_digest: binding.binding_digest,
    digest: null,
  };
  boundary.digest = digestWithout(boundary, "digest");
  return validateWorkspaceBoundary(attachRuntimeBinding(boundary, binding));
}

export function readWorkspaceRuntimeBinding(environment, boundary) {
  assert(environment && typeof environment === "object", "workspace environment is required");
  validateWorkspaceBoundary(boundary);
  const refs = {
    release_root: boundary.release_root_ref,
    projects_root: boundary.projects_root_ref,
    project_root: boundary.project_root_ref,
    control_root: boundary.control_root_ref,
    worktrees_root: boundary.worktrees_root_ref,
  };
  const values = {};
  for (const [field, envKey] of Object.entries(refs)) {
    assert(typeof environment[envKey] === "string" && environment[envKey].length > 0, `${envKey} is unavailable`);
    values[field] = environment[envKey];
  }
  return runtimeBinding(values, refs);
}

export function bindWorkspaceBoundary(boundary, binding) {
  validateWorkspaceBoundary(boundary);
  assert(binding && typeof binding === "object", "workspace runtime binding is required");
  const refs = {
    release_root: boundary.release_root_ref,
    projects_root: boundary.projects_root_ref,
    project_root: boundary.project_root_ref,
    control_root: boundary.control_root_ref,
    worktrees_root: boundary.worktrees_root_ref,
  };
  const boundRefs = binding.refs ?? refs;
  assert(JSON.stringify(boundRefs) === JSON.stringify(refs), "workspace runtime references differ from the boundary");
  return validateWorkspaceBoundary(attachRuntimeBinding(copyWorkspaceBoundary(boundary), runtimeBinding(binding, refs)));
}

export function validateWorkspaceBoundary(boundary) {
  exactKeys(boundary, FIELDS, "workspace boundary");
  assert(boundary.schema === WORKSPACE_BOUNDARY_SCHEMA && boundary.version === 2, "workspace boundary identity is invalid");
  assert(boundary.status === "PREPARED_NOT_ACTIVATED", "workspace boundary must remain prepared");
  assert(boundary.layout === WORKSPACE_LAYOUT, "workspace layout is invalid");
  for (const [value, label] of [[boundary.release_root_ref, "release_root_ref"], [boundary.projects_root_ref, "projects_root_ref"], [boundary.project_root_ref, "project_root_ref"], [boundary.control_root_ref, "control_root_ref"], [boundary.worktrees_root_ref, "worktrees_root_ref"]]) reference(value, label);
  assert(boundary.control_repository_policy === "CREATE_SIBLING_REPOSITORY_BEFORE_ANY_WRITE", "control repository creation policy is invalid");
  assert(boundary.project_state_policy === "NEVER_WRITE_OR_STORE_AGENTOS_ARTIFACTS", "project state policy is invalid");
  assert(boundary.agent_worktree_policy === "ISOLATED_CHECKOUTS_ONLY_UNDER_CONTROL_REPOSITORY", "agent worktree policy is invalid");
  assert(boundary.references_policy === "NO_AGENTOS_REFERENCES_IN_PROJECT_TREE", "project reference policy is invalid");
  assert(/^[0-9a-f]{64}$/u.test(boundary.runtime_binding_digest), "workspace runtime binding digest is invalid");
  assert(boundary.digest === digestWithout(boundary, "digest"), "workspace boundary digest does not match content");
  if (boundary[RUNTIME_BINDING]) {
    const binding = boundary[RUNTIME_BINDING];
    assert(binding.binding_digest === boundary.runtime_binding_digest, "workspace runtime binding digest differs from the boundary");
    assert(JSON.stringify(binding.refs) === JSON.stringify({release_root: boundary.release_root_ref, projects_root: boundary.projects_root_ref, project_root: boundary.project_root_ref, control_root: boundary.control_root_ref, worktrees_root: boundary.worktrees_root_ref}), "workspace runtime references differ from the boundary");
  }
  return boundary;
}

export function validateAgentWorkPath(boundary, candidate) {
  const binding = getWorkspaceRuntimeBinding(boundary);
  const pathValue = absolutePath(candidate, "agent work path");
  assert(strictlyWithin(binding.control_root, pathValue), "Agent work must be inside the control repository");
  assert(!sameOrWithin(binding.project_root, pathValue), "Agent work cannot be inside the project repository");
  assert(!sameOrWithin(binding.release_root, pathValue), "Agent work cannot be inside the release repository");
  return pathValue;
}

export function resolveWorkspaceRoot(boundary, root) {
  const binding = getWorkspaceRuntimeBinding(boundary);
  assert(["release_root", "projects_root", "project_root", "control_root", "worktrees_root"].includes(root), "workspace root is invalid");
  return binding[root];
}
