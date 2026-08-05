import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {assert, digestWithout} from "./canonical-json.mjs";
import {validateWorkspaceBoundary} from "./workspace-boundary.mjs";

export const CONTROL_BOUNDARY_RECORD = "workspace-boundary.json";
export const CONTROL_REPOSITORY_SCHEMA = "agentos.control_repository.v1";

const RECORD_FIELDS = ["schema", "version", "status", "workspace_boundary", "digest"];

function exactKeys(value, expected, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort()), `${label} fields mismatch`);
}

function directory(root, label) {
  let stat;
  try { stat = fs.lstatSync(root); } catch (error) { assert(false, `${label} is missing: ${error.code}`); }
  assert(stat.isDirectory() && !stat.isSymbolicLink(), `${label} must be a real directory`);
  return path.normalize(root);
}

function readBoundaryRecord(recordPath) {
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(recordPath, "utf8")); } catch (error) { assert(false, `control boundary record cannot be read: ${error.message}`); }
  exactKeys(parsed, RECORD_FIELDS, "control repository record");
  assert(parsed.schema === CONTROL_REPOSITORY_SCHEMA && parsed.version === 1 && parsed.status === "BOUND", "control repository record identity is invalid");
  validateWorkspaceBoundary(parsed.workspace_boundary);
  assert(parsed.digest === digestWithout(parsed, "digest"), "control repository record digest does not match content");
  return parsed;
}

function git(root, args) {
  const result = spawnSync("git", ["-C", root, ...args], {encoding: "utf8"});
  assert(result.status === 0, `control repository git action failed: ${(result.stderr ?? "").trim() || "unknown error"}`);
  return result.stdout.trim();
}

function verifyRepository(root) {
  const top = fs.realpathSync(git(root, ["rev-parse", "--show-toplevel"]));
  const expected = fs.realpathSync(root);
  assert(top === expected, "control root is not an independent repository");
}

function createRepository(root) {
  fs.mkdirSync(root);
  git(root, ["init", "--quiet"]);
}

function writeBoundaryRecord(root, boundary) {
  const recordPath = path.join(root, CONTROL_BOUNDARY_RECORD);
  if (fs.existsSync(recordPath)) {
    const recordStat = fs.lstatSync(recordPath);
    assert(recordStat.isFile() && !recordStat.isSymbolicLink(), "control boundary record must be a regular file");
    const record = readBoundaryRecord(recordPath);
    assert(record.workspace_boundary.digest === boundary.digest, "control repository is bound to a different workspace");
    return record;
  }
  const record = {
    schema: CONTROL_REPOSITORY_SCHEMA,
    version: 1,
    status: "BOUND",
    workspace_boundary: {...boundary},
    digest: null,
  };
  record.digest = digestWithout(record, "digest");
  const temporary = `${recordPath}.${process.pid}.tmp`;
  try {
    const handle = fs.openSync(temporary, "wx");
    try { fs.writeFileSync(handle, `${JSON.stringify(record, null, 2)}\n`, "utf8"); }
    finally { fs.closeSync(handle); }
    fs.renameSync(temporary, recordPath);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch {}
    if (error.code === "EEXIST" && fs.existsSync(recordPath)) return readBoundaryRecord(recordPath);
    throw error;
  }
  return record;
}

/**
 * Create or verify the external control repository before Bootstrap writes
 * any state. This function only reads the release/project roots and writes
 * inside the sibling control root.
 */
export function prepareWorkspace(boundary) {
  validateWorkspaceBoundary(boundary);
  const release = directory(boundary.release_root, "release root");
  const projects = directory(boundary.projects_root, "projects root");
  const project = directory(boundary.project_root, "project root");
  assert(path.dirname(project) === projects || project.startsWith(`${projects}${path.sep}`), "project root is outside projects root");

  const control = path.normalize(boundary.control_root);
  let status;
  if (fs.existsSync(control)) {
    directory(control, "control root");
    verifyRepository(control);
    status = "VERIFIED";
  } else {
    createRepository(control);
    status = "CREATED";
  }
  const record = writeBoundaryRecord(control, boundary);
  return {
    status,
    release_root: release,
    projects_root: projects,
    project_root: project,
    control_root: control,
    control_repository: record,
    project_tree_touched: false,
  };
}
