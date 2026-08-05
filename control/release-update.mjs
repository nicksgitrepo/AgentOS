import {assert, digestWithout} from "./canonical-json.mjs";
import {validateWorkspaceBoundary} from "./workspace-boundary.mjs";

export const RELEASE_UPDATE_SCHEMA = "agentos.release_update.v1";
export const GOVERNANCE_UPDATE_MODES = Object.freeze(["KEEP_PROJECT_APPENDICES", "RESET_GOVERNANCE_CLEAN"]);

const ID = /^[A-Z][A-Z0-9._-]*$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const RELEASE_VERSION = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/u;

function exactKeys(value, expected, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort()), `${label} fields mismatch`);
}

function nonempty(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be nonempty`);
}

function releaseIdentity(value, label) {
  exactKeys(value, ["version", "source_commit", "source_tree", "release_digest"], label);
  assert(RELEASE_VERSION.test(value.version), `${label}.version is invalid`);
  assert(COMMIT.test(value.source_commit) && COMMIT.test(value.source_tree), `${label} source identity is invalid`);
  assert(DIGEST.test(value.release_digest), `${label}.release_digest is invalid`);
}

function updateAction(mode) {
  return mode === "KEEP_PROJECT_APPENDICES"
    ? "PRESERVE_APPENDICES_AND_REVALIDATE_AGAINST_NEW_RELEASE"
    : "REBUILD_GOVERNANCE_WITHOUT_PROJECT_APPENDICES";
}

export function compileReleaseUpdate({update_id, project_id, workspace_boundary, current_release, replacement_release, governance_mode, control_snapshot_digest}) {
  assert(ID.test(update_id), "release update_id is invalid");
  assert(ID.test(project_id), "release update project_id is invalid");
  validateWorkspaceBoundary(workspace_boundary);
  releaseIdentity(current_release, "current release");
  releaseIdentity(replacement_release, "replacement release");
  assert(current_release.release_digest !== replacement_release.release_digest, "replacement release must differ from current release");
  assert(DIGEST.test(control_snapshot_digest), "control snapshot digest is invalid");
  assert(GOVERNANCE_UPDATE_MODES.includes(governance_mode), "release governance update mode is invalid");
  const update = {
    schema: RELEASE_UPDATE_SCHEMA,
    version: 1,
    status: "PREPARED_NOT_ACTIVATED",
    update_id,
    project_id,
    release_root: workspace_boundary.release_root,
    workspace_boundary: {...workspace_boundary},
    current_release: {...current_release},
    replacement_release: {...replacement_release},
    governance_mode,
    governance_action: updateAction(governance_mode),
    control_snapshot_digest,
    project_action: "LEAVE_PROJECT_REPOSITORIES_UNCHANGED",
    release_action: "REPLACE_RELEASE_AT_SAME_ROOT",
    rollback_policy: "RETAIN_PREVIOUS_RELEASE_UNTIL_NEW_RELEASE_IS_BOUND_AND_CHECKED",
    digest: null,
  };
  update.digest = digestWithout(update, "digest");
  return validateReleaseUpdate(update);
}

export function validateReleaseUpdate(update) {
  exactKeys(update, ["schema", "version", "status", "update_id", "project_id", "release_root", "workspace_boundary", "current_release", "replacement_release", "governance_mode", "governance_action", "control_snapshot_digest", "project_action", "release_action", "rollback_policy", "digest"], "release update");
  assert(update.schema === RELEASE_UPDATE_SCHEMA && update.version === 1 && update.status === "PREPARED_NOT_ACTIVATED", "release update identity is invalid");
  assert(ID.test(update.update_id) && ID.test(update.project_id), "release update identity fields are invalid");
  validateWorkspaceBoundary(update.workspace_boundary);
  assert(update.release_root === update.workspace_boundary.release_root, "release update root differs from workspace boundary");
  releaseIdentity(update.current_release, "current release");
  releaseIdentity(update.replacement_release, "replacement release");
  assert(update.current_release.release_digest !== update.replacement_release.release_digest, "replacement release must differ from current release");
  assert(GOVERNANCE_UPDATE_MODES.includes(update.governance_mode), "release governance update mode is invalid");
  assert(update.governance_action === updateAction(update.governance_mode), "release governance action does not match mode");
  assert(DIGEST.test(update.control_snapshot_digest), "control snapshot digest is invalid");
  assert(update.project_action === "LEAVE_PROJECT_REPOSITORIES_UNCHANGED", "release update may not alter project repositories");
  assert(update.release_action === "REPLACE_RELEASE_AT_SAME_ROOT", "release update action is invalid");
  assert(update.rollback_policy === "RETAIN_PREVIOUS_RELEASE_UNTIL_NEW_RELEASE_IS_BOUND_AND_CHECKED", "release rollback policy is invalid");
  assert(DIGEST.test(update.digest) && update.digest === digestWithout(update, "digest"), "release update digest does not match content");
  return update;
}
