import path from "node:path";
import {assert, digestWithout} from "./canonical-json.mjs";
import {validateAgentWorkPath, validateWorkspaceBoundary} from "./workspace-boundary.mjs";

export const HOST_WORKER_BOUNDARY_SCHEMA = "agentos.host_worker_boundary.v1";
export const HOST_WORKER_SCOPES = Object.freeze(["RELEASE_CONTROL", "PRODUCT"]);
export const HOST_WORKSPACE_MODES = Object.freeze(["HOST_MANAGED_VISIBLE", "CONTROL_ISOLATED"]);

const ID = /^[A-Z][A-Z0-9._-]*$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const SOURCE_ROOTS = new Set(["RELEASE", "PRODUCT"]);
const HOST_PROJECT_ROLES = new Set(["RELEASE", "CONTROL", "PRODUCT"]);
const PROTECTED_ACTIONS = new Set([
  "PUBLISH", "PUSH", "MERGE", "DEPLOY", "ROLLBACK", "SPEND", "AUTHENTICATE", "REVEAL_SECRET", "DELETE_ACCEPTED_WORK",
]);
const FIELDS = [
  "schema", "version", "status", "worker_id", "worker_scope", "workspace_mode", "source_root_kind", "host_project_id",
  "host_project_role", "campaign_project_id", "source_binding", "workspace_boundary", "product_action", "protected_actions",
  "workspace_path", "digest",
];

function exactKeys(value, expected, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort()), `${label} fields mismatch`);
}

function nonempty(value, label) { assert(typeof value === "string" && value.trim().length > 0, `${label} must be nonempty`); }

function identity(value, label) { assert(typeof value === "string" && ID.test(value), `${label} is invalid`); }

function absolutePath(value, label) {
  nonempty(value, label);
  assert(path.isAbsolute(value), `${label} must be absolute`);
  const normalized = path.normalize(value);
  assert(path.dirname(normalized) !== normalized, `${label} cannot be the filesystem root`);
  return normalized;
}

function sameOrWithin(parent, child) { return child === parent || child.startsWith(`${parent}${path.sep}`); }

function validateProtectedActions(actions) {
  assert(Array.isArray(actions) && actions.length > 0, "protected_actions must not be empty");
  assert(actions.every((action) => typeof action === "string" && PROTECTED_ACTIONS.has(action)), "protected_actions contains an unknown action");
  assert(new Set(actions).size === actions.length, "protected_actions contains duplicates");
}

function validateSourceBinding(binding) {
  exactKeys(binding, ["source_commit", "source_tree", "source_ref"], "host worker source binding");
  assert(COMMIT.test(binding.source_commit) && COMMIT.test(binding.source_tree), "host worker source commit/tree is invalid");
  nonempty(binding.source_ref, "host worker source_ref");
}

function seal(boundary) {
  const sealed = {...boundary, digest: null};
  sealed.digest = digestWithout(sealed, "digest");
  return validateHostWorkerBoundary(sealed);
}

export function compileHostWorkerBoundary({worker_id, worker_scope, workspace_mode, source_root_kind, host_project_id, host_project_role, campaign_project_id, source_binding, workspace_boundary, product_action = "LEAVE_PRODUCT_REPOSITORY_UNCHANGED", protected_actions, workspace_path = null}) {
  identity(worker_id, "worker_id");
  assert(HOST_WORKER_SCOPES.includes(worker_scope), "worker_scope is invalid");
  assert(HOST_WORKSPACE_MODES.includes(workspace_mode), "workspace_mode is invalid");
  assert(SOURCE_ROOTS.has(source_root_kind), "source_root_kind is invalid");
  nonempty(host_project_id, "host_project_id");
  assert(HOST_PROJECT_ROLES.has(host_project_role), "host_project_role is invalid");
  identity(campaign_project_id, "campaign_project_id");
  validateSourceBinding(source_binding);
  validateWorkspaceBoundary(workspace_boundary);
  assert(product_action === "LEAVE_PRODUCT_REPOSITORY_UNCHANGED", "product repository action is invalid");
  validateProtectedActions(protected_actions);
  if (workspace_path !== null) absolutePath(workspace_path, "workspace_path");
  const boundary = {
    schema: HOST_WORKER_BOUNDARY_SCHEMA,
    version: 1,
    status: "PREPARED_NOT_ACTIVATED",
    worker_id,
    worker_scope,
    workspace_mode,
    source_root_kind,
    host_project_id,
    host_project_role,
    campaign_project_id,
    source_binding: {...source_binding},
    workspace_boundary: {...workspace_boundary},
    product_action,
    protected_actions: [...protected_actions],
    workspace_path: workspace_path === null ? null : path.normalize(workspace_path),
    digest: null,
  };
  return seal(boundary);
}

export function validateHostWorkerBoundary(boundary) {
  exactKeys(boundary, FIELDS, "host worker boundary");
  assert(boundary.schema === HOST_WORKER_BOUNDARY_SCHEMA && boundary.version === 1, "host worker boundary identity is invalid");
  assert(boundary.status === "PREPARED_NOT_ACTIVATED", "host worker boundary must remain prepared");
  identity(boundary.worker_id, "worker_id");
  assert(HOST_WORKER_SCOPES.includes(boundary.worker_scope), "worker_scope is invalid");
  assert(HOST_WORKSPACE_MODES.includes(boundary.workspace_mode), "workspace_mode is invalid");
  assert(SOURCE_ROOTS.has(boundary.source_root_kind), "source_root_kind is invalid");
  nonempty(boundary.host_project_id, "host_project_id");
  assert(HOST_PROJECT_ROLES.has(boundary.host_project_role), "host_project_role is invalid");
  identity(boundary.campaign_project_id, "campaign_project_id");
  validateSourceBinding(boundary.source_binding);
  validateWorkspaceBoundary(boundary.workspace_boundary);
  assert(boundary.product_action === "LEAVE_PRODUCT_REPOSITORY_UNCHANGED", "product repository action is invalid");
  validateProtectedActions(boundary.protected_actions);
  if (boundary.workspace_path !== null) absolutePath(boundary.workspace_path, "workspace_path");

  if (boundary.workspace_mode === "HOST_MANAGED_VISIBLE") {
    assert(boundary.worker_scope === "RELEASE_CONTROL", "host-managed visible work is reserved for the release/control lane");
    assert(boundary.source_root_kind === "RELEASE", "host-managed visible work must bind to the release source");
    assert(boundary.host_project_role === "RELEASE", "host-managed visible work must use the registered release project");
  }
  if (boundary.worker_scope === "PRODUCT") {
    assert(boundary.workspace_mode === "CONTROL_ISOLATED", "product work may not use a host-managed visible workspace");
    assert(boundary.source_root_kind === "PRODUCT" && boundary.host_project_role === "CONTROL", "product work must use a control-managed isolated workspace");
  }
  if (boundary.worker_scope === "RELEASE_CONTROL") assert(boundary.source_root_kind === "RELEASE", "release/control work must bind to the release source");
  assert(DIGEST.test(boundary.digest) && boundary.digest === digestWithout(boundary, "digest"), "host worker boundary digest does not match content");
  return boundary;
}

export function validateHostWorkspacePath(boundary, candidate) {
  validateHostWorkerBoundary(boundary);
  const pathValue = absolutePath(candidate, "host workspace path");
  const workspace = boundary.workspace_boundary;
  const project = path.normalize(workspace.project_root);
  if (boundary.workspace_mode === "CONTROL_ISOLATED") return validateAgentWorkPath(workspace, pathValue);
  assert(!sameOrWithin(project, pathValue), "host-managed visible work cannot be inside the product repository");
  assert(!sameOrWithin(path.normalize(workspace.release_root), pathValue), "host-managed visible work cannot modify the release checkout directly");
  return pathValue;
}

export function validateHostWorkerBoundaryForAdmission(boundary, admission) {
  validateHostWorkerBoundary(boundary);
  assert(admission && typeof admission === "object" && !Array.isArray(admission), "host worker admission is required");
  nonempty(admission.project_id, "host worker admission project_id");
  assert(COMMIT.test(admission.source_commit) && COMMIT.test(admission.source_tree), "host worker admission source identity is invalid");
  assert(boundary.campaign_project_id === admission.project_id, "host worker boundary project identity differs from admission");
  assert(boundary.source_binding.source_commit === admission.source_commit, "host worker boundary source commit differs from admission");
  assert(boundary.source_binding.source_tree === admission.source_tree, "host worker boundary source tree differs from admission");
  if (boundary.workspace_mode === "HOST_MANAGED_VISIBLE") {
    assert(boundary.workspace_path !== null, "host-managed visible worker requires a bound workspace path");
    validateHostWorkspacePath(boundary, boundary.workspace_path);
  } else if (boundary.workspace_path !== null) validateHostWorkspacePath(boundary, boundary.workspace_path);
  return boundary;
}

export function bindHostWorkspacePath(boundary, workspace_path) {
  validateHostWorkerBoundary(boundary);
  const pathValue = validateHostWorkspacePath(boundary, workspace_path);
  if (boundary.workspace_path !== null) assert(path.normalize(boundary.workspace_path) === pathValue, "host workspace path is already bound to a different path");
  return seal({...boundary, workspace_path: pathValue, digest: null});
}
