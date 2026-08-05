import path from "node:path";
import {assert, digestWithout} from "./canonical-json.mjs";

export const WORKSPACE_BOUNDARY_SCHEMA = "agentos.workspace_boundary.v1";
export const WORKSPACE_LAYOUT = "SIBLING_RELEASE_PROJECTS_CONTROL";

const FIELDS = [
  "schema", "version", "status", "layout", "release_root", "projects_root", "project_root",
  "control_root", "worktrees_root", "control_repository_policy", "project_state_policy",
  "agent_worktree_policy", "references_policy", "digest",
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

function sameOrWithin(parent, child) {
  return child === parent || child.startsWith(`${parent}${path.sep}`);
}

function strictlyWithin(parent, child) {
  return child !== parent && sameOrWithin(parent, child);
}

function sibling(left, right) {
  return path.dirname(left) === path.dirname(right);
}

export function compileWorkspaceBoundary({release_root, projects_root, project_root, control_root, worktrees_root}) {
  const release = absolutePath(release_root, "release_root");
  const projects = absolutePath(projects_root, "projects_root");
  const project = absolutePath(project_root, "project_root");
  const control = absolutePath(control_root, "control_root");
  const worktrees = absolutePath(worktrees_root ?? path.join(control, "worktrees"), "worktrees_root");
  const boundary = {
    schema: WORKSPACE_BOUNDARY_SCHEMA,
    version: 1,
    status: "PREPARED_NOT_ACTIVATED",
    layout: WORKSPACE_LAYOUT,
    release_root: release,
    projects_root: projects,
    project_root: project,
    control_root: control,
    worktrees_root: worktrees,
    control_repository_policy: "CREATE_SIBLING_REPOSITORY_BEFORE_ANY_WRITE",
    project_state_policy: "NEVER_WRITE_OR_STORE_AGENTOS_ARTIFACTS",
    agent_worktree_policy: "ISOLATED_CHECKOUTS_ONLY_UNDER_CONTROL_REPOSITORY",
    references_policy: "NO_AGENTOS_REFERENCES_IN_PROJECT_TREE",
    digest: null,
  };
  boundary.digest = digestWithout(boundary, "digest");
  return validateWorkspaceBoundary(boundary);
}

export function validateWorkspaceBoundary(boundary) {
  exactKeys(boundary, FIELDS, "workspace boundary");
  assert(boundary.schema === WORKSPACE_BOUNDARY_SCHEMA && boundary.version === 1, "workspace boundary identity is invalid");
  assert(boundary.status === "PREPARED_NOT_ACTIVATED", "workspace boundary must remain prepared");
  assert(boundary.layout === WORKSPACE_LAYOUT, "workspace layout is invalid");
  const release = absolutePath(boundary.release_root, "release_root");
  const projects = absolutePath(boundary.projects_root, "projects_root");
  const project = absolutePath(boundary.project_root, "project_root");
  const control = absolutePath(boundary.control_root, "control_root");
  const worktrees = absolutePath(boundary.worktrees_root, "worktrees_root");
  assert(release !== projects && release !== control && projects !== control, "workspace roots must be distinct");
  assert(sibling(release, projects) && sibling(release, control) && sibling(projects, control), "release, projects, and control roots must be siblings");
  assert(strictlyWithin(projects, project), "project root must be a child of the projects root");
  assert(strictlyWithin(control, worktrees), "worker worktrees must be inside the control root");
  assert(!sameOrWithin(release, project) && !sameOrWithin(control, project), "project root overlaps an AgentOS root");
  assert(boundary.control_repository_policy === "CREATE_SIBLING_REPOSITORY_BEFORE_ANY_WRITE", "control repository creation policy is invalid");
  assert(boundary.project_state_policy === "NEVER_WRITE_OR_STORE_AGENTOS_ARTIFACTS", "project state policy is invalid");
  assert(boundary.agent_worktree_policy === "ISOLATED_CHECKOUTS_ONLY_UNDER_CONTROL_REPOSITORY", "agent worktree policy is invalid");
  assert(boundary.references_policy === "NO_AGENTOS_REFERENCES_IN_PROJECT_TREE", "project reference policy is invalid");
  assert(boundary.digest === digestWithout(boundary, "digest"), "workspace boundary digest does not match content");
  return boundary;
}

export function validateAgentWorkPath(boundary, candidate) {
  validateWorkspaceBoundary(boundary);
  const pathValue = absolutePath(candidate, "agent work path");
  assert(strictlyWithin(boundary.control_root, pathValue), "Agent work must be inside the control repository");
  assert(!sameOrWithin(boundary.project_root, pathValue), "Agent work cannot be inside the project repository");
  assert(!sameOrWithin(boundary.release_root, pathValue), "Agent work cannot be inside the release repository");
  return pathValue;
}
