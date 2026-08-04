#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const CONTROL_PLANE_SCHEMA = "agentos.control_plane_root.v1";
export const CONTROL_PLANE_MODES = Object.freeze([
  "EXTERNAL_DEFAULT",
  "EXTERNAL_EXPLICIT",
  "IN_PROJECT_OPT_IN",
]);
export const CONTROL_PLANE_ARTIFACT_GROUPS = Object.freeze([
  "AUTHORITY_CORPUS",
  "PROJECT_CONTEXT",
  "POLICY_STATE",
  "CONTROLLER_STATE",
  "CAMPAIGN_STATE",
  "EVIDENCE_AND_RECEIPTS",
  "HANDOFFS",
  "SOURCE_PRESERVATION",
]);

const SHA256 = /^[0-9a-f]{64}$/u;
const compareUtf8 = (left, right) => Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value, label) {
  assert(isRecord(value), `${label} must be an object`);
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains control characters`);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort(compareUtf8).map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function canonicalDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value)), "utf8").digest("hex");
}

function canonicalExistingDirectory(root, label) {
  requireString(root, label);
  assert(path.isAbsolute(root), `${label} must be absolute`);
  const absolute = path.resolve(root);
  const initial = fs.lstatSync(absolute);
  assert(!initial.isSymbolicLink(), `${label} must not be a symbolic link`);
  const real = fs.realpathSync.native(absolute);
  const stat = fs.lstatSync(real);
  assert(stat.isDirectory() && fs.realpathSync.native(real) === real, `${label} must be a canonical directory`);
  return real;
}

function canonicalDestination(root, label) {
  requireString(root, label);
  assert(path.isAbsolute(root), `${label} must be absolute`);
  const absolute = path.resolve(root);
  if (fs.existsSync(absolute)) return canonicalExistingDirectory(absolute, label);
  const missing = [];
  let ancestor = absolute;
  while (!fs.existsSync(ancestor)) {
    missing.push(path.basename(ancestor));
    const next = path.dirname(ancestor);
    assert(next !== ancestor, `${label} has no existing parent`);
    ancestor = next;
  }
  const parent = canonicalExistingDirectory(ancestor, `${label} parent`);
  return path.join(parent, ...missing.reverse());
}

function isInside(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function pathsOverlap(left, right) {
  return isInside(left, right) || isInside(right, left);
}

function validateStaticBinding(binding, {projectRoot = null, controlPlaneRoot = null} = {}) {
  requireRecord(binding, "control-plane binding");
  const expectedKeys = [
    "schema", "version", "mode", "storage_scope", "project_root", "control_plane_root",
    "default_resolution", "artifact_groups", "source_preservation", "binding_sha256",
  ].sort(compareUtf8);
  const actualKeys = Object.keys(binding).sort(compareUtf8);
  assert(JSON.stringify(actualKeys) === JSON.stringify(expectedKeys), "control-plane binding fields mismatch");
  assert(binding.schema === CONTROL_PLANE_SCHEMA && binding.version === 1, "control-plane binding identity is invalid");
  assert(CONTROL_PLANE_MODES.includes(binding.mode), "control-plane mode is invalid");
  assert(["EXTERNAL", "PROJECT_ROOT"].includes(binding.storage_scope), "control-plane storage scope is invalid");
  requireString(binding.project_root, "control-plane project root");
  requireString(binding.control_plane_root, "control-plane root");
  assert(path.isAbsolute(binding.project_root) && path.isAbsolute(binding.control_plane_root), "control-plane roots must be absolute");
  assert(Array.isArray(binding.artifact_groups)
    && JSON.stringify(binding.artifact_groups) === JSON.stringify([...CONTROL_PLANE_ARTIFACT_GROUPS]),
  "control-plane artifact groups are invalid");
  requireString(binding.default_resolution, "control-plane default resolution");
  requireString(binding.source_preservation, "control-plane source preservation rule");
  assert(SHA256.test(binding.binding_sha256), "control-plane binding digest is invalid");
  const body = structuredClone(binding);
  delete body.binding_sha256;
  assert(binding.binding_sha256 === canonicalDigest(body), "control-plane binding is not content-addressed");

  const project = path.resolve(projectRoot ?? binding.project_root);
  const control = path.resolve(controlPlaneRoot ?? binding.control_plane_root);
  assert(project === path.resolve(binding.project_root), "control-plane binding project root changed");
  assert(control === path.resolve(binding.control_plane_root), "control-plane binding root changed");
  if (binding.mode === "IN_PROJECT_OPT_IN") {
    assert(binding.storage_scope === "PROJECT_ROOT" && isInside(project, control), "in-project control plane is not explicitly contained by the project root");
  } else {
    assert(binding.storage_scope === "EXTERNAL" && !pathsOverlap(project, control), "external control plane overlaps the project root");
  }
  return binding;
}

export function validateControlPlaneBinding(binding, options = {}) {
  return validateStaticBinding(binding, options);
}

export function resolveControlPlaneRoot({projectRoot, controlPlaneRoot = null, controlPlaneMode = null} = {}) {
  const project = canonicalExistingDirectory(projectRoot, "project root");
  if (controlPlaneRoot !== null) assert(path.isAbsolute(controlPlaneRoot), "explicit control-plane root must be absolute");
  const mode = controlPlaneMode ?? (controlPlaneRoot === null ? "EXTERNAL_DEFAULT" : "EXTERNAL_EXPLICIT");
  assert(CONTROL_PLANE_MODES.includes(mode), "control-plane mode is invalid");
  if (mode === "IN_PROJECT_OPT_IN") {
    assert(controlPlaneRoot !== null, "in-project control plane requires an explicit root");
  }
  const requested = controlPlaneRoot === null
    ? path.join(path.dirname(project), `${path.basename(project)}.agentos-control-plane`)
    : path.resolve(controlPlaneRoot);
  const control = canonicalDestination(requested, "control-plane root");
  if (mode === "IN_PROJECT_OPT_IN") {
    assert(isInside(project, control), "in-project control plane must be inside the project root");
  } else {
    assert(!pathsOverlap(project, control), "external control plane must be separate from the project root");
  }
  const body = {
    schema: CONTROL_PLANE_SCHEMA,
    version: 1,
    mode,
    storage_scope: mode === "IN_PROJECT_OPT_IN" ? "PROJECT_ROOT" : "EXTERNAL",
    project_root: project,
    control_plane_root: control,
    default_resolution: mode === "EXTERNAL_DEFAULT" ? "PROJECT_SIBLING_WITH_AGENTOS_CONTROL_PLANE_SUFFIX" : "OWNER_SELECTED_ROOT",
    artifact_groups: [...CONTROL_PLANE_ARTIFACT_GROUPS],
    source_preservation: mode === "IN_PROJECT_OPT_IN"
      ? "PROJECT_ROOT_STORAGE_ALLOWED_ONLY_AFTER_EXPLICIT_CONTROL_PLANE_OPT_IN"
      : "SOURCE_PRESERVATION_STAYS_OUTSIDE_PROJECT_ROOT",
  };
  const binding = {...body, binding_sha256: canonicalDigest(body)};
  validateStaticBinding(binding, {projectRoot: project, controlPlaneRoot: control});
  return {project_root: project, control_plane_root: control, binding};
}

export function relativeControlPlanePath(controlPlaneRoot, candidate, label = "control-plane path") {
  const root = path.resolve(controlPlaneRoot);
  const resolved = path.resolve(candidate);
  assert(isInside(root, resolved), `${label} escapes the control plane root`);
  const relative = path.relative(root, resolved);
  assert(relative !== "" && relative !== "." && !relative.split(path.sep).includes(".."), `${label} must identify a child of the control plane root`);
  return relative;
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("control-plane root controller loaded\n");
