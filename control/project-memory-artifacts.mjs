#!/usr/bin/env node

/* Privacy-screened semantic payloads referenced by canonical memory records. */

import fs from "node:fs";
import path from "node:path";
import {
  assertPersistedRecordSafe,
  canonicalDigest,
  canonicalJson,
} from "./content-addressing.mjs";
import {
  CONTRACT_STATUS,
  CONTROL_SPACE,
  exactKeys,
  requireIdentifier,
  requireRecord,
  requireSha,
} from "./map-memory-common.mjs";

export const PROJECT_MEMORY_ARTIFACT_SCHEMA = "agentos.project_memory_artifact.v1";
export const PROJECT_MEMORY_ARTIFACT_VERSION = 1;

const ARTIFACT_FIELDS = [
  "schema", "version", "contract_status", "visibility", "advisory_only",
  "acceptance_authority", "artifact_kind", "scope_ref", "project_ref",
  "payload", "payload_sha256", "artifact_sha256",
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isWithin(root, target) {
  return target === root || target.startsWith(`${root}${path.sep}`);
}

function resolveAuthorityRoot(authorityRoot, repositoryRoot) {
  assert(typeof authorityRoot === "string" && path.isAbsolute(authorityRoot), "memory artifact authority root must be absolute");
  const stat = fs.lstatSync(authorityRoot);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), "memory artifact authority root must be a real directory");
  const root = fs.realpathSync.native(authorityRoot);
  const repository = fs.realpathSync.native(repositoryRoot);
  assert(!isWithin(repository, root) && !isWithin(root, repository), "memory artifact authority must remain separate from the repository");
  return root;
}

function artifactPath(root, projectRef, payloadSha256) {
  requireIdentifier(projectRef, "memory artifact project");
  requireSha(payloadSha256, "memory artifact payload digest");
  return path.join(root, "artifacts", "projects", projectRef, "sha256", payloadSha256.slice(0, 2), `${payloadSha256}.json`);
}

function ensureSafeDirectory(root, directory) {
  const relative = path.relative(root, directory);
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      const stat = fs.lstatSync(current);
      assert(stat.isDirectory() && !stat.isSymbolicLink(), "memory artifact path traverses an unsafe directory");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      fs.mkdirSync(current, {mode: 0o700});
    }
  }
}

function syncDirectory(directory) {
  const descriptor = fs.openSync(directory, fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY ?? 0));
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function writeAtomic(target, bytes) {
  const staged = `${target}.tmp-${process.pid}-${Date.now()}`;
  let descriptor = null;
  try {
    descriptor = fs.openSync(staged, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    // Publish without replacing a concurrently created content-addressed object.
    fs.linkSync(staged, target);
    fs.unlinkSync(staged);
    syncDirectory(path.dirname(target));
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
    try {
      fs.unlinkSync(staged);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

export function compileProjectMemoryArtifact({artifactKind, scopeRef, projectRef, payload}) {
  requireIdentifier(artifactKind, "memory artifact kind");
  requireIdentifier(scopeRef, "memory artifact scope");
  requireIdentifier(projectRef, "memory artifact project");
  requireRecord(payload, "memory artifact payload");
  assertPersistedRecordSafe(payload);
  const artifact = {
    schema: PROJECT_MEMORY_ARTIFACT_SCHEMA,
    version: PROJECT_MEMORY_ARTIFACT_VERSION,
    contract_status: CONTRACT_STATUS,
    visibility: CONTROL_SPACE,
    advisory_only: true,
    acceptance_authority: false,
    artifact_kind: artifactKind,
    scope_ref: scopeRef,
    project_ref: projectRef,
    payload: structuredClone(payload),
    payload_sha256: canonicalDigest(payload),
    artifact_sha256: null,
  };
  artifact.artifact_sha256 = canonicalDigest({...artifact, artifact_sha256: null});
  return validateProjectMemoryArtifact(artifact);
}

export function validateProjectMemoryArtifact(artifact, {payloadSha256 = null, projectRef = null} = {}) {
  requireRecord(artifact, "memory artifact");
  exactKeys(artifact, ARTIFACT_FIELDS, "memory artifact");
  assert(artifact.schema === PROJECT_MEMORY_ARTIFACT_SCHEMA && artifact.version === PROJECT_MEMORY_ARTIFACT_VERSION, "memory artifact identity is invalid");
  assert(artifact.contract_status === CONTRACT_STATUS && artifact.visibility === CONTROL_SPACE, "memory artifact contract boundary is invalid");
  assert(artifact.advisory_only === true && artifact.acceptance_authority === false, "memory artifact cannot carry acceptance authority");
  requireIdentifier(artifact.artifact_kind, "memory artifact kind");
  requireIdentifier(artifact.scope_ref, "memory artifact scope");
  requireIdentifier(artifact.project_ref, "memory artifact project");
  requireRecord(artifact.payload, "memory artifact payload");
  assertPersistedRecordSafe(artifact.payload);
  requireSha(artifact.payload_sha256, "memory artifact payload digest");
  assert(artifact.payload_sha256 === canonicalDigest(artifact.payload), "memory artifact payload digest mismatch");
  if (payloadSha256 !== null) assert(artifact.payload_sha256 === payloadSha256, "memory artifact filename and payload digest differ");
  if (projectRef !== null) assert(artifact.project_ref === projectRef, "memory artifact belongs to another project");
  requireSha(artifact.artifact_sha256, "memory artifact digest");
  assert(artifact.artifact_sha256 === canonicalDigest({...artifact, artifact_sha256: null}), "memory artifact digest mismatch");
  assertPersistedRecordSafe(artifact);
  return artifact;
}

export function writeProjectMemoryArtifact({authorityRoot, repositoryRoot = process.cwd(), artifact}) {
  validateProjectMemoryArtifact(artifact);
  const root = resolveAuthorityRoot(authorityRoot, repositoryRoot);
  const target = artifactPath(root, artifact.project_ref, artifact.payload_sha256);
  ensureSafeDirectory(root, path.dirname(target));
  try {
    const stat = fs.lstatSync(target);
    assert(stat.isFile() && !stat.isSymbolicLink(), "memory artifact target must be a regular file");
    const current = validateProjectMemoryArtifact(JSON.parse(fs.readFileSync(target, "utf8")), {payloadSha256: artifact.payload_sha256});
    assert(current.artifact_sha256 === artifact.artifact_sha256, "memory artifact digest collision");
    return {status: "IDEMPOTENT_REPLAY", artifact: current, relative_path: path.relative(root, target)};
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  try {
    writeAtomic(target, Buffer.from(`${canonicalJson(artifact)}\n`, "utf8"));
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const current = validateProjectMemoryArtifact(JSON.parse(fs.readFileSync(target, "utf8")), {payloadSha256: artifact.payload_sha256, projectRef: artifact.project_ref});
    assert(current.artifact_sha256 === artifact.artifact_sha256, "memory artifact digest collision");
    return {status: "IDEMPOTENT_REPLAY", artifact: current, relative_path: path.relative(root, target)};
  }
  const readback = validateProjectMemoryArtifact(JSON.parse(fs.readFileSync(target, "utf8")), {payloadSha256: artifact.payload_sha256});
  assert(readback.artifact_sha256 === artifact.artifact_sha256, "memory artifact readback mismatch");
  return {status: "WRITTEN", artifact: readback, relative_path: path.relative(root, target)};
}

export function readProjectMemoryArtifact({authorityRoot, repositoryRoot = process.cwd(), payloadSha256, projectRef}) {
  const root = resolveAuthorityRoot(authorityRoot, repositoryRoot);
  const target = artifactPath(root, projectRef, payloadSha256);
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  assert(stat.isFile() && !stat.isSymbolicLink(), "memory artifact source must be a regular file");
  return validateProjectMemoryArtifact(JSON.parse(fs.readFileSync(target, "utf8")), {payloadSha256, projectRef});
}

export const PROJECT_MEMORY_ARTIFACT_API = Object.freeze({
  compileProjectMemoryArtifact,
  validateProjectMemoryArtifact,
  writeProjectMemoryArtifact,
  readProjectMemoryArtifact,
});
