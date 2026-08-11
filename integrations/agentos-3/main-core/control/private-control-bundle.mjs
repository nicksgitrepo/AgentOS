#!/usr/bin/env node

/* Deterministic, schema-preserving export/import for a private control repo. */

import fs from "node:fs";
import path from "node:path";

import {
  assertNoSymlinkComponents,
  assertPortableRecord,
  assertPortableText,
  canonicalDigest,
  canonicalJson,
  compareUtf8,
  collectRegularFiles,
  directoryContentDigest,
  digestWithout,
  ensureDirectory,
  exactKeys,
  invariant,
  isWithin,
  inventoryDigest,
  PrivateControlError,
  readGitIdentity,
  readJsonFile,
  requireDigest,
  requireRecord,
  requireSafeIdentifier,
  requireString,
  safeRelativePath,
  sha256,
  writeExactFile,
  writeExclusiveFile,
} from "./private-control-common.mjs";
import {
  WORKSPACE_BOUNDARY_RECORD,
  assertPrivateControlPath,
  getPrivateWorkspaceRuntimeBinding,
  preparePrivateWorkspace,
  privateControlFilePath,
  privateControlInventoryOptions,
  privateControlSnapshotDigest,
  validatePrivateWorkspaceBinding,
} from "./private-control-storage.mjs";

export const PRIVATE_CONTROL_BUNDLE_SCHEMA = "agentos.private_control_bundle.v1";
export const PRIVATE_CONTROL_BUNDLE_VERSION = 1;
export const CONTROL_BUNDLE_IMPORT_SCHEMA = "agentos.private_control_import.v1";

const BUNDLE_FIELDS = [
  "schema", "version", "status", "bundle_id", "source_workspace_binding_digest", "source_control_snapshot_digest",
  "source_git", "files", "excluded_files", "digest",
];
const ARTIFACT_FIELDS = ["path", "mode", "size", "sha256", "bytes_base64"];
const IMPORT_RECEIPT_FIELDS = [
  "schema", "version", "status", "bundle_id", "import_mode", "source_bundle_digest",
  "source_workspace_binding_digest", "destination_workspace_binding_digest", "imported_file_count",
  "owner_decision_digest", "imported_control_snapshot_digest", "project_tree_touched",
  "published_paths", "rolled_back_paths", "failure_code", "digest",
];
const IMPORT_STATUSES = Object.freeze(["IMPORTED", "ROLLED_BACK", "RECOVERY_REQUIRED"]);

function artifactTextIsSafe(relativePath, bytes) {
  invariant(!bytes.includes(0), `control artifact is binary and not portable: ${relativePath}`, "UNSAFE_ARTIFACT");
  const text = bytes.toString("utf8");
  invariant(Buffer.from(text, "utf8").equals(bytes), `control artifact is not valid UTF-8: ${relativePath}`, "UNSAFE_ARTIFACT");
  if (relativePath.endsWith(".json")) {
    let parsed;
    try { parsed = JSON.parse(text); } catch (error) {
      throw new Error(`control JSON artifact is invalid: ${relativePath}: ${error.message}`);
    }
    assertPortableRecord(parsed, `control artifact ${relativePath}`);
  } else if (relativePath.endsWith(".jsonl")) {
    for (const [index, line] of text.split("\n").filter(Boolean).entries()) {
      let parsed;
      try { parsed = JSON.parse(line); } catch (error) {
        throw new Error(`control JSONL artifact is invalid: ${relativePath}:${index + 1}: ${error.message}`);
      }
      assertPortableRecord(parsed, `control artifact ${relativePath}:${index + 1}`);
    }
  } else {
    assertPortableText(text, `control artifact ${relativePath}`);
  }
  return bytes;
}

function compileArtifact(entry) {
  const relative = safeRelativePath(entry.path, "control artifact path");
  invariant(relative !== WORKSPACE_BOUNDARY_RECORD, "workspace boundary is rebound at import and is not bundled", "BOUNDARY_ARTIFACT_REJECTED");
  invariant(relative !== ".git" && !relative.startsWith(".git/"), "Git metadata is not a portable control artifact", "UNSAFE_GIT_OBJECT");
  invariant(Number.isSafeInteger(entry.mode) && entry.mode >= 0 && entry.mode <= 0o777, `control artifact mode is invalid: ${relative}`);
  invariant(Number.isSafeInteger(entry.size) && entry.size >= 0, `control artifact size is invalid: ${relative}`);
  requireDigest(entry.sha256, `control artifact digest: ${relative}`);
  invariant(typeof entry.bytes_base64 === "string", `control artifact bytes are missing: ${relative}`);
  const bytes = Buffer.from(entry.bytes_base64, "base64");
  invariant(bytes.toString("base64") === entry.bytes_base64, `control artifact bytes are not canonical base64: ${relative}`, "BUNDLE_DIGEST_MISMATCH");
  invariant(bytes.length === entry.size && sha256(bytes) === entry.sha256, `control artifact bytes do not match the manifest: ${relative}`, "BUNDLE_DIGEST_MISMATCH");
  artifactTextIsSafe(relative, bytes);
  return {path: relative, mode: entry.mode, size: bytes.length, sha256: entry.sha256, bytes_base64: bytes.toString("base64"), bytes};
}

function compileSourceGit(root) {
  try {
    return readGitIdentity(root);
  } catch {
    return {repository: "NOT_A_GIT_REPOSITORY", commit: null, tree: null, clean: null};
  }
}

export function compilePrivateControlBundle({
  bundleId = null,
  sourceWorkspaceBindingDigest,
  sourceControlSnapshotDigest,
  sourceGit,
  files,
  excludedFiles = [WORKSPACE_BOUNDARY_RECORD],
} = {}) {
  requireDigest(sourceWorkspaceBindingDigest, "source workspace binding digest");
  requireDigest(sourceControlSnapshotDigest, "source control snapshot digest");
  requireRecord(sourceGit, "source Git identity");
  invariant(["INDEPENDENT_GIT", "NOT_A_GIT_REPOSITORY"].includes(sourceGit.repository), "source Git identity is invalid");
  if (sourceGit.commit !== null) invariant(/^[0-9a-f]{40}$/u.test(sourceGit.commit), "source Git commit identity is invalid");
  if (sourceGit.tree !== null) invariant(/^[0-9a-f]{40}$/u.test(sourceGit.tree), "source Git tree identity is invalid");
  invariant(sourceGit.clean === null || typeof sourceGit.clean === "boolean", "source Git clean state is invalid");
  invariant(Array.isArray(files) && files.length > 0, "private control bundle must contain at least one file");
  const artifacts = files.map(compileArtifact).sort((left, right) => compareUtf8(left.path, right.path));
  invariant(new Set(artifacts.map((entry) => entry.path)).size === artifacts.length, "private control bundle contains duplicate paths");
  const id = bundleId ?? `BUNDLE-${sourceControlSnapshotDigest.slice(0, 16).toUpperCase()}`;
  requireSafeIdentifier(id, "private control bundle ID");
  const manifest = artifacts.map(({bytes, ...entry}) => entry);
  invariant(canonicalDigest(manifest) === sourceControlSnapshotDigest, "bundle source snapshot does not match the file manifest", "BUNDLE_DIGEST_MISMATCH");
  const body = {
    schema: PRIVATE_CONTROL_BUNDLE_SCHEMA,
    version: PRIVATE_CONTROL_BUNDLE_VERSION,
    status: "PORTABLE_VERIFIED",
    bundle_id: id,
    source_workspace_binding_digest: sourceWorkspaceBindingDigest,
    source_control_snapshot_digest: sourceControlSnapshotDigest,
    source_git: {
      repository: sourceGit.repository,
      commit: sourceGit.commit,
      tree: sourceGit.tree,
      clean: sourceGit.clean,
    },
    files: manifest,
    excluded_files: [...new Set(excludedFiles.map((value) => safeRelativePath(value, "excluded control artifact")))].sort(compareUtf8),
    digest: null,
  };
  body.digest = digestWithout(body, "digest");
  return validatePrivateControlBundle(body);
}

export function validatePrivateControlBundle(bundle) {
  exactKeys(bundle, BUNDLE_FIELDS, "private control bundle");
  invariant(bundle.schema === PRIVATE_CONTROL_BUNDLE_SCHEMA && bundle.version === PRIVATE_CONTROL_BUNDLE_VERSION, "private control bundle identity is invalid");
  invariant(bundle.status === "PORTABLE_VERIFIED", "private control bundle is not verified");
  requireSafeIdentifier(bundle.bundle_id, "private control bundle ID");
  requireDigest(bundle.source_workspace_binding_digest, "bundle source workspace binding digest");
  requireDigest(bundle.source_control_snapshot_digest, "bundle source control snapshot digest");
  requireRecord(bundle.source_git, "bundle source Git identity");
  exactKeys(bundle.source_git, ["repository", "commit", "tree", "clean"], "bundle source Git identity");
  invariant(["INDEPENDENT_GIT", "NOT_A_GIT_REPOSITORY"].includes(bundle.source_git.repository), "bundle source Git identity is invalid");
  if (bundle.source_git.commit !== null) invariant(/^[0-9a-f]{40}$/u.test(bundle.source_git.commit), "bundle source Git commit is invalid");
  if (bundle.source_git.tree !== null) invariant(/^[0-9a-f]{40}$/u.test(bundle.source_git.tree), "bundle source Git tree is invalid");
  invariant(bundle.source_git.clean === null || typeof bundle.source_git.clean === "boolean", "bundle source Git clean state is invalid");
  invariant(Array.isArray(bundle.files) && bundle.files.length > 0, "private control bundle files are empty");
  const paths = new Set();
  const manifest = [];
  for (const [index, entry] of bundle.files.entries()) {
    exactKeys(entry, ARTIFACT_FIELDS, `private control bundle file ${index}`);
    const compiled = compileArtifact(entry);
    invariant(!paths.has(compiled.path), `private control bundle contains duplicate path: ${compiled.path}`);
    paths.add(compiled.path);
    manifest.push(entry);
  }
  invariant(canonicalDigest(manifest) === bundle.source_control_snapshot_digest, "private control bundle manifest digest does not match source snapshot", "BUNDLE_DIGEST_MISMATCH");
  invariant(Array.isArray(bundle.excluded_files), "private control bundle exclusions are invalid");
  bundle.excluded_files.forEach((value) => safeRelativePath(value, "bundle exclusion"));
  requireDigest(bundle.digest, "private control bundle digest");
  invariant(bundle.digest === digestWithout(bundle, "digest"), "private control bundle digest does not match content");
  assertPortableRecord(bundle, "private control bundle");
  return bundle;
}

export function exportPrivateControlBundle(boundary, {bundleId = null} = {}) {
  validatePrivateWorkspaceBinding(boundary);
  const runtime = getPrivateWorkspaceRuntimeBinding(boundary);
  const controlRoot = runtime.control_root;
  const entries = collectRegularFiles(controlRoot, privateControlInventoryOptions(runtime, [".git", WORKSPACE_BOUNDARY_RECORD, "imports"]));
  invariant(entries.length > 0, "private control repository contains no portable artifacts", "EMPTY_CONTROL_REPOSITORY");
  const portableEntries = entries.map((entry) => {
    const bytes = artifactTextIsSafe(entry.path, entry.bytes);
    return {path: entry.path, mode: entry.mode, size: bytes.length, sha256: sha256(bytes), bytes_base64: bytes.toString("base64"), bytes};
  });
  const manifestEntries = portableEntries.map(({bytes, ...entry}) => entry);
  const sourceGit = compileSourceGit(controlRoot);
  const sourceControlSnapshotDigest = inventoryDigest(portableEntries.map(({bytes, ...entry}) => entry));
  const bundle = compilePrivateControlBundle({
    bundleId,
    sourceWorkspaceBindingDigest: boundary.digest,
    sourceControlSnapshotDigest,
    sourceGit,
    files: portableEntries,
    excludedFiles: [WORKSPACE_BOUNDARY_RECORD, ".git", "imports"],
  });
  // Keep this explicit equality check close to the export boundary so an
  // accidental future change cannot silently export a different inventory.
  invariant(canonicalDigest(manifestEntries) === sourceControlSnapshotDigest, "private control bundle inventory digest drifted", "BUNDLE_DIGEST_MISMATCH");
  return bundle;
}

export function serializePrivateControlBundle(bundle) {
  validatePrivateControlBundle(bundle);
  return `${canonicalJson(bundle)}\n`;
}

export function writePrivateControlBundle(filePath, bundle, {workspaceBoundary = null} = {}) {
  invariant(workspaceBoundary !== null, "bundle export requires a bound workspace", "WORKSPACE_BINDING_REQUIRED");
  validatePrivateWorkspaceBinding(workspaceBoundary);
  const runtime = getPrivateWorkspaceRuntimeBinding(workspaceBoundary);
  requireString(filePath, "bundle export file");
  invariant(path.isAbsolute(filePath), "bundle export file must be absolute");
  const destination = path.resolve(filePath);
  const insideControl = isWithin(runtime.control_root, destination);
  const insideProject = isWithin(runtime.project_root, destination);
  invariant(!insideProject || (runtime.project_write_policy === "IN_PROJECT_EXPLICIT" && insideControl), "bundle export may not write into a project outside the authorized control root", "CONTAINMENT_REJECTED");
  if (insideControl) {
    const relative = path.relative(runtime.control_root, destination).replaceAll(path.sep, "/");
    invariant(relative.startsWith("exports/") && relative !== "exports/", "bundle exports inside the control root must use the transport directory", "UNSAFE_ARTIFACT");
  }
  invariant(insideControl || (!isWithin(runtime.release_root, destination) && !isWithin(runtime.projects_root, destination)), "bundle export destination overlaps a protected workspace root", "CONTAINMENT_REJECTED");
  assertNoSymlinkComponents(destination, "bundle export destination");
  ensureDirectory(path.dirname(destination), "bundle export parent");
  const bytes = Buffer.from(serializePrivateControlBundle(bundle), "utf8");
  return writeExactFile(destination, bytes, {mode: 0o600});
}

export function readPrivateControlBundle(filePath) {
  const bundle = readJsonFile(filePath, "private control bundle");
  return validatePrivateControlBundle(bundle);
}

function materializeArtifact(stageRoot, entry) {
  const relative = safeRelativePath(entry.path, "staged control artifact path");
  const destination = path.join(stageRoot, relative);
  ensureDirectory(path.dirname(destination), "staged artifact parent");
  const bytes = Buffer.from(entry.bytes_base64, "base64");
  writeExclusiveFile(destination, bytes, {mode: entry.mode});
  return destination;
}

function verifyStage(stageRoot, bundle) {
  const entries = collectRegularFiles(stageRoot);
  const manifest = entries.map(({bytes, ...entry}) => entry);
  const bundledManifest = bundle.files.map(({bytes_base64, ...entry}) => entry);
  invariant(canonicalDigest(manifest) === canonicalDigest(bundledManifest), "staged control bundle inventory differs", "BUNDLE_DIGEST_MISMATCH");
  return true;
}

function publishArtifact(boundary, entry) {
  const destination = privateControlFilePath(boundary, entry.path);
  ensureDirectory(path.dirname(destination), "control artifact parent");
  const bytes = Buffer.from(entry.bytes_base64, "base64");
  return writeExactFile(destination, bytes, {mode: entry.mode});
}

function preflightPublishArtifact(boundary, entry) {
  const destination = privateControlFilePath(boundary, entry.path);
  if (!fs.existsSync(destination)) return;
  const stat = fs.lstatSync(destination);
  invariant(stat.isFile() && !stat.isSymbolicLink(), `control artifact target is unsafe: ${entry.path}`, "UNSAFE_FILE");
  const bytes = Buffer.from(entry.bytes_base64, "base64");
  invariant(sha256(fs.readFileSync(destination)) === sha256(bytes), `control artifact target differs: ${entry.path}`, "SHARED_FILE_CONFLICT");
}

function validateImportReceiptShape(receipt) {
  exactKeys(receipt, IMPORT_RECEIPT_FIELDS, "private control import receipt");
  invariant(receipt.schema === CONTROL_BUNDLE_IMPORT_SCHEMA && receipt.version === 1, "private control import receipt identity is invalid");
  invariant(IMPORT_STATUSES.includes(receipt.status), "private control import receipt status is invalid");
  requireSafeIdentifier(receipt.bundle_id, "private control import receipt bundle ID");
  invariant(["NEW_CONTROL", "MERGE_EXACT"].includes(receipt.import_mode), "private control import receipt mode is invalid");
  requireDigest(receipt.source_bundle_digest, "private control import source bundle digest");
  requireDigest(receipt.source_workspace_binding_digest, "private control import source workspace digest");
  requireDigest(receipt.destination_workspace_binding_digest, "private control import destination workspace digest");
  invariant(Number.isSafeInteger(receipt.imported_file_count) && receipt.imported_file_count >= 0, "private control import file count is invalid");
  invariant(receipt.owner_decision_digest === null || (typeof receipt.owner_decision_digest === "string" && /^[0-9a-f]{64}$/u.test(receipt.owner_decision_digest)), "private control import owner decision digest is invalid");
  requireDigest(receipt.imported_control_snapshot_digest, "private control import snapshot digest");
  invariant(receipt.project_tree_touched === false, "private control import may not touch the project tree");
  for (const [value, label] of [[receipt.published_paths, "published paths"], [receipt.rolled_back_paths, "rolled-back paths"]]) {
    invariant(Array.isArray(value), `private control import ${label} must be an array`);
    const sorted = [...value].sort(compareUtf8);
    invariant(JSON.stringify(value) === JSON.stringify(sorted), `private control import ${label} must be sorted`);
    invariant(new Set(value).size === value.length, `private control import ${label} contains duplicates`);
    value.forEach((entry) => safeRelativePath(entry, `private control import ${label} entry`));
  }
  invariant(receipt.failure_code === null || (typeof receipt.failure_code === "string" && /^[A-Z][A-Z0-9_:-]*$/u.test(receipt.failure_code)), "private control import failure code is invalid");
  if (receipt.status === "IMPORTED") {
    invariant(receipt.imported_file_count > 0, "successful private control import has no files");
    invariant(receipt.failure_code === null && receipt.rolled_back_paths.length === 0, "successful private control import contains failure evidence");
  } else {
    invariant(receipt.failure_code !== null, "failed private control import lacks failure evidence");
  }
  requireDigest(receipt.digest, "private control import receipt digest");
  invariant(receipt.digest === digestWithout(receipt, "digest"), "private control import receipt digest does not match content");
  assertPortableRecord(receipt, "private control import receipt");
  return receipt;
}

function compileImportReceipt({status, bundle, boundary, mode, ownerDecisionDigest, importedFileCount, snapshotDigest, publishedPaths = [], rolledBackPaths = [], failureCode = null}) {
  const body = {
    schema: CONTROL_BUNDLE_IMPORT_SCHEMA,
    version: 1,
    status,
    bundle_id: bundle.bundle_id,
    import_mode: mode,
    source_bundle_digest: bundle.digest,
    source_workspace_binding_digest: bundle.source_workspace_binding_digest,
    destination_workspace_binding_digest: boundary.digest,
    imported_file_count: importedFileCount,
    owner_decision_digest: ownerDecisionDigest,
    imported_control_snapshot_digest: snapshotDigest,
    project_tree_touched: false,
    published_paths: [...publishedPaths].sort(compareUtf8),
    rolled_back_paths: [...rolledBackPaths].sort(compareUtf8),
    failure_code: failureCode,
    digest: null,
  };
  body.digest = digestWithout(body, "digest");
  return validateImportReceiptShape(body);
}

function removeCreatedArtifacts(boundary, createdEntries) {
  const removed = [];
  for (const entry of [...createdEntries].reverse()) {
    const destination = privateControlFilePath(boundary, entry.path, {mustExist: true});
    assertNoSymlinkComponents(destination, `created control artifact ${entry.path}`);
    const stat = fs.lstatSync(destination);
    invariant(stat.isFile() && !stat.isSymbolicLink(), `created control artifact became unsafe: ${entry.path}`, "SYMLINK_COMPONENT_REJECTED");
    const bytes = fs.readFileSync(destination);
    invariant(sha256(bytes) === entry.sha256, `created control artifact changed before rollback: ${entry.path}`, "RECOVERY_REQUIRED");
    fs.unlinkSync(destination);
    removed.push(entry.path);
  }
  return removed.sort(compareUtf8);
}

export function validatePrivateControlImportReceipt(receipt) {
  return validateImportReceiptShape(receipt);
}

export function readPrivateControlImportReceipt(filePath, boundary, {expectedBundleId = null} = {}) {
  validatePrivateWorkspaceBinding(boundary);
  requireString(filePath, "private control import receipt path");
  invariant(path.isAbsolute(filePath), "private control import receipt path must be absolute");
  const runtime = getPrivateWorkspaceRuntimeBinding(boundary);
  const absolute = path.resolve(filePath);
  const relative = path.relative(runtime.control_root, absolute).replaceAll(path.sep, "/");
  invariant(relative.startsWith("imports/") && relative.endsWith(".json"), "private control import receipt is outside the imports root", "CONTAINMENT_REJECTED");
  const boundPath = privateControlFilePath(boundary, relative, {mustExist: true});
  const bytes = fs.readFileSync(boundPath);
  const receipt = JSON.parse(bytes.toString("utf8"));
  invariant(`${canonicalJson(receipt)}\n` === bytes.toString("utf8"), "private control import receipt is not canonical JSON", "RECEIPT_READBACK_INVALID");
  validateImportReceiptShape(receipt);
  if (expectedBundleId !== null) invariant(receipt.bundle_id === expectedBundleId, "private control import receipt bundle identity differs", "RECEIPT_READBACK_INVALID");
  const snapshot = privateControlSnapshotDigest(boundary, {excludeRelativePaths: [relative]});
  invariant(snapshot === receipt.imported_control_snapshot_digest, "private control import receipt snapshot is stale", "RECEIPT_READBACK_INVALID");
  return receipt;
}

export function importPrivateControlBundle(bundle, boundary, {mode = "NEW_CONTROL", ownerDecisionDigest = null} = {}) {
  validatePrivateControlBundle(bundle);
  validatePrivateWorkspaceBinding(boundary);
  invariant(["NEW_CONTROL", "MERGE_EXACT"].includes(mode), "private control import mode is invalid");
  if (ownerDecisionDigest !== null) requireDigest(ownerDecisionDigest, "control import owner decision digest");
  const prepared = preparePrivateWorkspace(boundary);
  const runtime = getPrivateWorkspaceRuntimeBinding(boundary);
  const existing = collectRegularFiles(runtime.control_root, privateControlInventoryOptions(runtime, [".git"]))
    .filter((entry) => entry.path !== WORKSPACE_BOUNDARY_RECORD);
  if (mode === "NEW_CONTROL") invariant(existing.length === 0, "new control import target is not empty", "SHARED_FILE_CONFLICT");
  const receiptRelative = `imports/${bundle.bundle_id}.json`;
  const receiptPath = privateControlFilePath(boundary, receiptRelative);
  invariant(!fs.existsSync(receiptPath), "control import receipt target already exists", "SHARED_FILE_CONFLICT");
  for (const entry of bundle.files) {
    invariant(!entry.path.startsWith("imports/"), "derived import receipts are not portable artifacts", "UNSAFE_ARTIFACT");
    preflightPublishArtifact(boundary, entry);
  }
  const stagePath = path.join(runtime.worktrees_root, `.agentos-import-${bundle.bundle_id}`);
  invariant(!fs.existsSync(stagePath), "control import staging root already exists", "SHARED_FILE_CONFLICT");
  const stageRoot = ensureDirectory(stagePath, "control import staging root");
  const imported = [];
  const createdEntries = [];
  let publishFailure = null;
  let rolledBackPaths = [];
  try {
    for (const entry of bundle.files) {
      materializeArtifact(stageRoot, entry);
    }
    verifyStage(stageRoot, bundle);
    for (const entry of bundle.files) {
      const result = publishArtifact(boundary, entry);
      imported.push(entry.path);
      if (result.status === "CREATED") {
        createdEntries.push(entry);
      }
    }
  } catch (error) {
    publishFailure = error;
  } finally {
    if (fs.existsSync(stageRoot)) {
      try {
        const stat = fs.lstatSync(stageRoot);
        invariant(stat.isDirectory() && !stat.isSymbolicLink(), "control import staging root became unsafe", "SYMLINK_COMPONENT_REJECTED");
        fs.rmSync(stageRoot, {recursive: true, force: true});
      } catch (error) {
        publishFailure ??= new PrivateControlError(`control import staging cleanup failed: ${error.message}`, "RECOVERY_REQUIRED");
      }
    }
  }
  if (publishFailure !== null) {
    try {
      rolledBackPaths = removeCreatedArtifacts(boundary, createdEntries);
    } catch (rollbackError) {
      publishFailure = new PrivateControlError(`${publishFailure.message}; rollback failed: ${rollbackError.message}`, "RECOVERY_REQUIRED");
    }
    const status = publishFailure.code === "RECOVERY_REQUIRED" ? "RECOVERY_REQUIRED" : "ROLLED_BACK";
    const failureCode = status === "RECOVERY_REQUIRED" ? "CONTROL_IMPORT_ROLLBACK_REQUIRED" : (publishFailure.code ?? "CONTROL_IMPORT_PUBLISH_FAILED");
    const snapshot = privateControlSnapshotDigest(boundary, {excludeRelativePaths: [`imports/${bundle.bundle_id}.json`]});
    const failureReceipt = compileImportReceipt({
      status,
      bundle,
      boundary,
      mode,
      ownerDecisionDigest,
      importedFileCount: 0,
      snapshotDigest: snapshot,
      publishedPaths: createdEntries.map((entry) => entry.path),
      rolledBackPaths,
      failureCode,
    });
    ensureDirectory(path.dirname(receiptPath), "control import receipt parent");
    writeExactFile(receiptPath, Buffer.from(`${canonicalJson(failureReceipt)}\n`, "utf8"), {mode: 0o600});
    throw new PrivateControlError(`private control bundle import ${status.toLowerCase()}`, status === "RECOVERY_REQUIRED" ? "RECOVERY_REQUIRED" : "CONTROL_IMPORT_ROLLED_BACK");
  }
  const receiptBody = compileImportReceipt({
    status: "IMPORTED",
    bundle,
    boundary,
    mode,
    ownerDecisionDigest,
    importedFileCount: imported.length,
    snapshotDigest: privateControlSnapshotDigest(boundary, {excludeRelativePaths: [`imports/${bundle.bundle_id}.json`]}),
    publishedPaths: imported,
    rolledBackPaths: [],
    failureCode: null,
  });
  ensureDirectory(path.dirname(receiptPath), "control import receipt parent");
  writeExactFile(receiptPath, Buffer.from(`${canonicalJson(receiptBody)}\n`, "utf8"), {mode: 0o600});
  return readPrivateControlImportReceipt(receiptPath, boundary, {expectedBundleId: bundle.bundle_id});
}

export function importPrivateControlBundleFile(filePath, boundary, options = {}) {
  return importPrivateControlBundle(readPrivateControlBundle(filePath), boundary, options);
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("private control bundle loaded\n");
