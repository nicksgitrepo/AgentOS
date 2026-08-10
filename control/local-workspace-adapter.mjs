#!/usr/bin/env node

/*
 * Provider-neutral local workspace adapter.
 *
 * Filesystem and Git paths are runtime-only. The returned receipts contain
 * opaque binding references, source digests, and bounded failure evidence so
 * a later handoff can be checked without trusting a caller's assertion.
 */

import fs from "node:fs";
import {
  assertPortableRecord,
  compareUtf8,
  digestWithout,
  directoryContentDigest,
  exactKeys,
  invariant,
  readGitIdentity,
  readJsonFile,
  requireDigest,
  requireEnvironmentReference,
  requireGitObject,
  requireRecord,
  requireUtc,
  runGit,
} from "./private-control-common.mjs";
import {
  bindPrivateWorkspaceRuntime,
  getPrivateWorkspaceRuntimeBinding,
  preparePrivateWorkspace,
  privateControlFilePath,
  readPrivateWorkspaceRuntimeBinding,
  validatePrivateWorkspaceBinding,
  WORKSPACE_BOUNDARY_RECORD,
} from "./private-control-storage.mjs";
import {validateProviderNeutralDiscovery} from "./private-provider-discovery.mjs";

export const LOCAL_WORKSPACE_RECEIPT_SCHEMA = "agentos.local_workspace_receipt.v1";
export const LOCAL_WORKSPACE_ADAPTER_REF = "ENV_REF_LOCAL_WORKSPACE";
export const LOCAL_WORKSPACE_OPERATIONS = Object.freeze(["REGISTER", "REOPEN", "RECONCILE", "PRE_WORK", "HANDOFF"]);
export const LOCAL_WORKSPACE_STATUSES = Object.freeze(["MATCHED", "MISMATCH", "UNAVAILABLE"]);
export const LOCAL_PROVIDER_STATUSES = Object.freeze(["NOT_REQUESTED", "AVAILABLE", "UNVERIFIED", "PARTIAL_FAILURE", "UNAVAILABLE"]);

const RECEIPT_FIELDS = [
  "schema", "version", "operation", "status", "adapter_ref", "workspace_binding_digest", "runtime_binding_digest",
  "control_repository_readback", "source_readback", "expected_source", "mismatch_fields", "provider_readback",
  "operations", "failure_code", "observed_at_utc", "digest",
];
const SOURCE_FIELDS = ["source_commit", "source_tree", "working_tree_digest"];
const MISMATCH_FIELDS = ["workspace_binding", "control_repository", "source_commit", "source_tree", "working_tree_digest", "detached"];
const NO_EXTERNAL_EFFECTS = Object.freeze({
  network_attempted: false,
  authentication_attempted: false,
  spending_attempted: false,
  external_write_attempted: false,
});

function isSafeCode(value) {
  return typeof value === "string" && /^[A-Z][A-Z0-9_]*$/u.test(value);
}

function safeCode(error, fallback) {
  return isSafeCode(error?.code) ? error.code : fallback;
}

function sortedUnique(values, label) {
  invariant(Array.isArray(values), `${label} must be an array`);
  invariant(values.every((value) => typeof value === "string"), `${label} must contain strings`);
  const sorted = [...values].sort(compareUtf8);
  invariant(new Set(values).size === values.length, `${label} contains duplicates`);
  invariant(JSON.stringify(values) === JSON.stringify(sorted), `${label} must be sorted`);
  return values;
}

function nullableDigest(value, label) {
  if (value === null) return null;
  requireDigest(value, label);
  return value;
}

function validateExpectedSource(value, label = "expected source") {
  if (value === null) return null;
  exactKeys(value, SOURCE_FIELDS, label);
  requireGitObject(value.source_commit, `${label}.source_commit`);
  requireGitObject(value.source_tree, `${label}.source_tree`);
  requireDigest(value.working_tree_digest, `${label}.working_tree_digest`);
  return value;
}

function validateSourceReadback(value, label = "source readback") {
  exactKeys(value, ["status", "repository", ...SOURCE_FIELDS, "clean", "detached", "failure_code"], label);
  invariant(["AVAILABLE", "UNAVAILABLE"].includes(value.status), `${label}.status is invalid`);
  if (value.status === "AVAILABLE") {
    invariant(value.repository === "INDEPENDENT_GIT", `${label}.repository is invalid`);
    requireGitObject(value.source_commit, `${label}.source_commit`);
    requireGitObject(value.source_tree, `${label}.source_tree`);
    requireDigest(value.working_tree_digest, `${label}.working_tree_digest`);
    invariant(typeof value.clean === "boolean" && typeof value.detached === "boolean", `${label} flags are invalid`);
    invariant(value.failure_code === null, `${label} cannot carry an unavailable failure`);
  } else {
    invariant(value.repository === null && value.source_commit === null && value.source_tree === null && value.working_tree_digest === null,
      `${label} unavailable readback must not carry partial source identity`);
    invariant(value.clean === null && value.detached === null, `${label} unavailable flags are invalid`);
    invariant(isSafeCode(value.failure_code), `${label}.failure_code is required`);
  }
  return value;
}

function validateControlRepositoryReadback(value, label = "control repository readback") {
  exactKeys(value, ["status", "topology", "commit", "tree", "clean", "failure_code"], label);
  invariant(["AVAILABLE", "UNAVAILABLE"].includes(value.status), `${label}.status is invalid`);
  if (value.status === "AVAILABLE") {
    invariant(value.topology === "INDEPENDENT_GIT", `${label}.topology is invalid`);
    if (value.commit !== null) requireGitObject(value.commit, `${label}.commit`);
    if (value.tree !== null) requireGitObject(value.tree, `${label}.tree`);
    invariant(typeof value.clean === "boolean" && value.failure_code === null, `${label} available fields are invalid`);
  } else {
    invariant(value.topology === null && value.commit === null && value.tree === null && value.clean === null,
      `${label} unavailable readback must not carry partial repository identity`);
    invariant(isSafeCode(value.failure_code), `${label}.failure_code is required`);
  }
  return value;
}

function validateProviderReadback(value, label = "provider readback") {
  exactKeys(value, ["status", "discovery_digest", "catalog_digest", "unavailable_entry_count", "unverified_entry_count", "reason_code"], label);
  invariant(LOCAL_PROVIDER_STATUSES.includes(value.status), `${label}.status is invalid`);
  nullableDigest(value.discovery_digest, `${label}.discovery_digest`);
  nullableDigest(value.catalog_digest, `${label}.catalog_digest`);
  invariant(Number.isSafeInteger(value.unavailable_entry_count) && value.unavailable_entry_count >= 0, `${label}.unavailable_entry_count is invalid`);
  invariant(Number.isSafeInteger(value.unverified_entry_count) && value.unverified_entry_count >= 0, `${label}.unverified_entry_count is invalid`);
  if (value.status === "NOT_REQUESTED") {
    invariant(value.discovery_digest === null && value.catalog_digest === null && value.unavailable_entry_count === 0 && value.unverified_entry_count === 0 && value.reason_code === null,
      `${label} not-requested fields are invalid`);
  } else {
    invariant(value.discovery_digest !== null && value.catalog_digest !== null, `${label} must carry discovery digests`);
    if (value.reason_code !== null) invariant(isSafeCode(value.reason_code), `${label}.reason_code is invalid`);
  }
  return value;
}

function validateOperations(value, label = "local adapter operations") {
  exactKeys(value, Object.keys(NO_EXTERNAL_EFFECTS), label);
  for (const [key, expected] of Object.entries(NO_EXTERNAL_EFFECTS)) invariant(value[key] === expected, `${label}.${key} must remain false`);
  return value;
}

export function validateLocalWorkspaceReceipt(receipt) {
  exactKeys(receipt, RECEIPT_FIELDS, "local workspace receipt");
  invariant(receipt.schema === LOCAL_WORKSPACE_RECEIPT_SCHEMA && receipt.version === 1, "local workspace receipt identity is invalid");
  invariant(LOCAL_WORKSPACE_OPERATIONS.includes(receipt.operation), "local workspace receipt operation is invalid");
  invariant(LOCAL_WORKSPACE_STATUSES.includes(receipt.status), "local workspace receipt status is invalid");
  requireEnvironmentReference(receipt.adapter_ref, "local workspace adapter_ref");
  requireDigest(receipt.workspace_binding_digest, "local workspace binding digest");
  requireDigest(receipt.runtime_binding_digest, "local workspace runtime binding digest");
  validateControlRepositoryReadback(receipt.control_repository_readback);
  validateSourceReadback(receipt.source_readback);
  validateExpectedSource(receipt.expected_source);
  sortedUnique(receipt.mismatch_fields, "local workspace mismatch fields");
  receipt.mismatch_fields.forEach((field) => invariant(MISMATCH_FIELDS.includes(field), `unknown local workspace mismatch field: ${field}`));
  validateProviderReadback(receipt.provider_readback);
  validateOperations(receipt.operations);
  if (receipt.status === "UNAVAILABLE") {
    invariant(receipt.mismatch_fields.length === 0 && isSafeCode(receipt.failure_code), "unavailable local workspace receipt must preserve a safe failure code");
  } else if (receipt.status === "MISMATCH") {
    invariant(receipt.mismatch_fields.length > 0 && receipt.failure_code === null, "mismatched local workspace receipt must preserve mismatch fields");
  } else {
    invariant(receipt.mismatch_fields.length === 0 && receipt.failure_code === null, "matched local workspace receipt carries failure evidence");
  }
  requireUtc(receipt.observed_at_utc, "local workspace observation time");
  requireDigest(receipt.digest, "local workspace receipt digest");
  invariant(receipt.digest === digestWithout(receipt, "digest"), "local workspace receipt digest does not match content");
  assertPortableRecord(receipt, "local workspace receipt");
  return receipt;
}

function sourceReadbackUnavailable(code) {
  return {
    status: "UNAVAILABLE",
    repository: null,
    source_commit: null,
    source_tree: null,
    working_tree_digest: null,
    clean: null,
    detached: null,
    failure_code: code,
  };
}

function readSourceReadback(runtime) {
  const root = runtime.project_root;
  try {
    const top = runGit(root, ["rev-parse", "--show-toplevel"], {allowFailure: true});
    if (top.status !== 0) return sourceReadbackUnavailable("SOURCE_GIT_UNAVAILABLE");
    if (fs.realpathSync.native(top.stdout) !== fs.realpathSync.native(root)) return sourceReadbackUnavailable("SOURCE_ROOT_MISMATCH");
    const commit = runGit(root, ["rev-parse", "HEAD"], {allowFailure: true});
    const tree = runGit(root, ["rev-parse", "HEAD^{tree}"], {allowFailure: true});
    if (commit.status !== 0 || tree.status !== 0 || !/^[0-9a-f]{40}$/u.test(commit.stdout) || !/^[0-9a-f]{40}$/u.test(tree.stdout)) {
      return sourceReadbackUnavailable("SOURCE_IDENTITY_UNAVAILABLE");
    }
    const branch = runGit(root, ["symbolic-ref", "--short", "-q", "HEAD"], {allowFailure: true});
    if (![0, 1].includes(branch.status)) return sourceReadbackUnavailable("SOURCE_BRANCH_READBACK_UNAVAILABLE");
    const status = runGit(root, ["status", "--porcelain=v1", "--untracked-files=all"], {allowFailure: true});
    if (status.status !== 0) return sourceReadbackUnavailable("SOURCE_STATUS_UNAVAILABLE");
    const workingTreeDigest = directoryContentDigest(root, {excludeRootNames: new Set([".git"])});
    return {
      status: "AVAILABLE",
      repository: "INDEPENDENT_GIT",
      source_commit: commit.stdout,
      source_tree: tree.stdout,
      working_tree_digest: workingTreeDigest,
      clean: status.stdout.length === 0,
      detached: branch.status === 1,
      failure_code: null,
    };
  } catch (error) {
    return sourceReadbackUnavailable(safeCode(error, "SOURCE_READBACK_UNAVAILABLE"));
  }
}

function controlRepositoryReadback(runtime) {
  try {
    const git = readGitIdentity(runtime.control_root);
    return {
      status: "AVAILABLE",
      topology: git.repository,
      commit: git.commit,
      tree: git.tree,
      clean: git.clean,
      failure_code: null,
    };
  } catch (error) {
    return {
      status: "UNAVAILABLE",
      topology: null,
      commit: null,
      tree: null,
      clean: null,
      failure_code: safeCode(error, "CONTROL_REPOSITORY_READBACK_UNAVAILABLE"),
    };
  }
}

function providerReadback(providerDiscovery, workspaceBindingDigest) {
  if (providerDiscovery === null) return {
    status: "NOT_REQUESTED",
    discovery_digest: null,
    catalog_digest: null,
    unavailable_entry_count: 0,
    unverified_entry_count: 0,
    reason_code: null,
  };
  validateProviderNeutralDiscovery(providerDiscovery);
  invariant(providerDiscovery.workspace_binding_digest === workspaceBindingDigest, "provider discovery is bound to a different workspace", "WORKSPACE_BINDING_MISMATCH");
  const unavailable = providerDiscovery.entries.filter((entry) => entry.trust_status === "UNAVAILABLE").length;
  const unverified = providerDiscovery.entries.filter((entry) => entry.trust_status === "UNVERIFIED").length;
  const status = providerDiscovery.entries.length === 0
    ? "UNAVAILABLE"
    : unavailable > 0
      ? "PARTIAL_FAILURE"
      : unverified > 0 ? "UNVERIFIED" : "AVAILABLE";
  return {
    status,
    discovery_digest: providerDiscovery.digest,
    catalog_digest: providerDiscovery.catalog_digest,
    unavailable_entry_count: unavailable,
    unverified_entry_count: unverified,
    reason_code: status === "UNAVAILABLE" ? "PROVIDER_CATALOG_UNAVAILABLE" : status === "PARTIAL_FAILURE" ? "PROVIDER_CATALOG_PARTIAL_FAILURE" : null,
  };
}

function expectedFromReadback(readback) {
  if (readback.status !== "AVAILABLE") return null;
  return {
    source_commit: readback.source_commit,
    source_tree: readback.source_tree,
    working_tree_digest: readback.working_tree_digest,
  };
}

function compareSource(expected, observed) {
  if (expected === null || observed.status !== "AVAILABLE") return [];
  return SOURCE_FIELDS.filter((field) => expected[field] !== observed[field]);
}

function buildReceipt({boundary, operation, adapterRef = LOCAL_WORKSPACE_ADAPTER_REF, expectedSource = null, controlReadback, sourceReadback, providerDiscovery = null, observedAtUtc, extraMismatchFields = [], forcedFailureCode = null}) {
  requireEnvironmentReference(adapterRef, "local workspace adapter reference");
  validateExpectedSource(expectedSource);
  const mismatchFields = [...extraMismatchFields];
  if (sourceReadback.status === "AVAILABLE" && sourceReadback.detached) mismatchFields.push("detached");
  mismatchFields.push(...compareSource(expectedSource, sourceReadback));
  const failureCode = forcedFailureCode ?? (controlReadback.status === "UNAVAILABLE"
    ? controlReadback.failure_code
    : sourceReadback.status === "UNAVAILABLE" ? sourceReadback.failure_code : null);
  const status = failureCode !== null ? "UNAVAILABLE" : mismatchFields.length > 0 ? "MISMATCH" : "MATCHED";
  const persistedMismatchFields = failureCode === null ? [...new Set(mismatchFields)].sort(compareUtf8) : [];
  const body = {
    schema: LOCAL_WORKSPACE_RECEIPT_SCHEMA,
    version: 1,
    operation,
    status,
    adapter_ref: adapterRef,
    workspace_binding_digest: boundary.digest,
    runtime_binding_digest: boundary.runtime_binding_digest,
    control_repository_readback: controlReadback,
    source_readback: sourceReadback,
    expected_source: expectedSource,
    mismatch_fields: persistedMismatchFields,
    provider_readback: providerReadback(providerDiscovery, boundary.digest),
    operations: {...NO_EXTERNAL_EFFECTS},
    failure_code: failureCode,
    observed_at_utc: observedAtUtc,
    digest: null,
  };
  body.digest = digestWithout(body, "digest");
  return validateLocalWorkspaceReceipt(body);
}

function resolveBoundary(boundary, environment) {
  validatePrivateWorkspaceBinding(boundary);
  if (environment !== null) return bindPrivateWorkspaceRuntime(boundary, readPrivateWorkspaceRuntimeBinding(environment, boundary));
  getPrivateWorkspaceRuntimeBinding(boundary);
  return boundary;
}

function verifyPersistedBoundary(boundary) {
  const file = privateControlFilePath(boundary, WORKSPACE_BOUNDARY_RECORD, {mustExist: true});
  const persisted = readJsonFile(file, "workspace boundary record");
  validatePrivateWorkspaceBinding(persisted);
  invariant(persisted.digest === boundary.digest, "persisted workspace binding differs from the requested binding", "WORKSPACE_BINDING_MISMATCH");
  return persisted;
}

export function compileLocalWorkspaceReceipt(options = {}) {
  requireRecord(options, "local workspace receipt options");
  const {boundary, operation, controlReadback, sourceReadback} = options;
  validatePrivateWorkspaceBinding(boundary);
  invariant(LOCAL_WORKSPACE_OPERATIONS.includes(operation), "local workspace receipt operation is invalid");
  validateControlRepositoryReadback(controlReadback);
  validateSourceReadback(sourceReadback);
  const observedAtUtc = options.observedAtUtc ?? new Date().toISOString();
  requireUtc(observedAtUtc, "local workspace observation time");
  return buildReceipt({...options, observedAtUtc});
}

export function createLocalWorkspaceAdapter({workspaceBinding, environment = null, adapterRef = LOCAL_WORKSPACE_ADAPTER_REF} = {}) {
  validatePrivateWorkspaceBinding(workspaceBinding);
  requireEnvironmentReference(adapterRef, "local workspace adapter reference");
  const resolve = () => resolveBoundary(workspaceBinding, environment);
  const now = () => new Date().toISOString();

  function state({operation, expectedSource = null, providerDiscovery = null, requirePersisted = false, extraMismatchFields = []} = {}) {
    const boundary = resolve();
    let forcedFailureCode = null;
    const observedMismatchFields = [...extraMismatchFields];
    if (requirePersisted) {
      try {
        verifyPersistedBoundary(boundary);
      } catch (error) {
        if (error?.code === "WORKSPACE_BINDING_MISMATCH") observedMismatchFields.push("workspace_binding");
        else forcedFailureCode = safeCode(error, "PERSISTED_BOUNDARY_UNAVAILABLE");
      }
    }
    const runtime = getPrivateWorkspaceRuntimeBinding(boundary);
    const controlReadback = controlRepositoryReadback(runtime);
    const sourceReadback = readSourceReadback(runtime);
    return buildReceipt({
      boundary,
      operation,
      expectedSource,
      adapterRef,
      controlReadback,
      sourceReadback,
      providerDiscovery,
      observedAtUtc: now(),
      extraMismatchFields: observedMismatchFields,
      forcedFailureCode,
    });
  }

  const adapter = {
    register({expectedSource = null, providerDiscovery = null} = {}) {
      const boundary = resolve();
      const prepared = preparePrivateWorkspace(boundary);
      const runtime = getPrivateWorkspaceRuntimeBinding(prepared.workspace_binding);
      const sourceReadback = readSourceReadback(runtime);
      const baseline = expectedSource ?? expectedFromReadback(sourceReadback);
      return buildReceipt({
        boundary: prepared.workspace_binding,
        operation: "REGISTER",
        adapterRef,
        expectedSource: baseline,
        controlReadback: controlRepositoryReadback(runtime),
        sourceReadback,
        providerDiscovery,
        observedAtUtc: now(),
      });
    },
    reopen({providerDiscovery = null} = {}) {
      return state({operation: "REOPEN", providerDiscovery, requirePersisted: true});
    },
    reconcile({expectedSource = null, providerDiscovery = null} = {}) {
      return state({operation: "RECONCILE", expectedSource, providerDiscovery, requirePersisted: true});
    },
    preWork({expectedSource, providerDiscovery = null} = {}) {
      validateExpectedSource(expectedSource, "pre-work expected source");
      return state({operation: "PRE_WORK", expectedSource, providerDiscovery, requirePersisted: true});
    },
    handoff({expectedSource, providerDiscovery = null} = {}) {
      validateExpectedSource(expectedSource, "handoff expected source");
      return state({operation: "HANDOFF", expectedSource, providerDiscovery, requirePersisted: true});
    },
  };
  return Object.freeze(adapter);
}

export function reconcileLocalWorkspace(options = {}) {
  const {workspaceBinding, environment, adapterRef, ...rest} = options;
  return createLocalWorkspaceAdapter({workspaceBinding, environment, adapterRef}).reconcile(rest);
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("local workspace adapter loaded\n");

