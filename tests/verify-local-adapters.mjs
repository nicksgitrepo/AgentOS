#!/usr/bin/env node

import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  compileLocalWorkspaceReceipt,
  createLocalWorkspaceAdapter,
  validateLocalWorkspaceReceipt,
} from "../control/local-workspace-adapter.mjs";
import {
  assertPortableRecord,
} from "../control/private-control-common.mjs";
import {
  compilePrivateWorkspaceBinding,
  validatePrivateWorkspaceBinding,
} from "../control/private-control-storage.mjs";
import {compileOfflinePolicy} from "../control/private-offline-mode.mjs";
import {
  compileProviderNeutralDiscovery,
} from "../control/private-provider-discovery.mjs";

const SCHEMA = JSON.parse(fs.readFileSync(new URL("../schemas/local-workspace-receipt.v1.json", import.meta.url), "utf8"));
assert.equal(SCHEMA.$id, "agentos.local_workspace_receipt.v1");
assert.equal(SCHEMA.additionalProperties, false);

function git(directory, args) {
  return execFileSync("git", ["-C", directory, ...args], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
}

function createGitProject(directory) {
  fs.mkdirSync(directory, {recursive: true});
  git(directory, ["init", "--quiet"]);
  fs.writeFileSync(path.join(directory, "product.txt"), "initial\n", "utf8");
  git(directory, ["add", "product.txt"]);
  execFileSync("git", ["-C", directory, "-c", "user.name=AgentOS Test", "-c", "user.email=agentos-test@example.invalid", "commit", "--quiet", "-m", "initial"], {stdio: ["ignore", "pipe", "pipe"]});
}

function sourceIdentity(readback) {
  return {
    source_commit: readback.source_commit,
    source_tree: readback.source_tree,
    working_tree_digest: readback.working_tree_digest,
  };
}

const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), "agentos-roadmap-05-"));
try {
  const release = path.join(root, "release");
  const projects = path.join(root, "projects");
  const project = path.join(projects, "saved-project");
  const control = path.join(root, "control");
  fs.mkdirSync(release, {recursive: true});
  fs.mkdirSync(projects, {recursive: true});
  createGitProject(project);

  const boundary = compilePrivateWorkspaceBinding({
    release_root: release,
    projects_root: projects,
    project_root: project,
    control_root: control,
    refs: {
      release_root: "ENV_REF_RELEASE",
      projects_root: "ENV_REF_PROJECTS",
      project_root: "ENV_REF_PROJECT",
      control_root: "ENV_REF_CONTROL",
      worktrees_root: "ENV_REF_WORKTREES",
    },
  });
  validatePrivateWorkspaceBinding(boundary);
  const environment = {
    ENV_REF_RELEASE: release,
    ENV_REF_PROJECTS: projects,
    ENV_REF_PROJECT: project,
    ENV_REF_CONTROL: control,
    ENV_REF_WORKTREES: path.join(control, "worktrees"),
  };
  const adapter = createLocalWorkspaceAdapter({workspaceBinding: boundary, environment});

  const registered = adapter.register();
  validateLocalWorkspaceReceipt(registered);
  assert.equal(registered.status, "MATCHED");
  assert.equal(registered.operation, "REGISTER");
  assert.equal(registered.operations.network_attempted, false);
  assert.equal(JSON.stringify(registered).includes(root), false, "runtime roots leaked into the portable receipt");
  assertPortableRecord(registered);

  const reopened = adapter.reopen();
  assert.equal(reopened.status, "MATCHED");
  assert.equal(reopened.operation, "REOPEN");
  const expected = sourceIdentity(reopened.source_readback);
  const preWork = adapter.preWork({expectedSource: expected});
  assert.equal(preWork.status, "MATCHED");

  const offline = compileOfflinePolicy({workspaceBindingDigest: boundary.digest});
  const emptyProvider = compileProviderNeutralDiscovery({
    offlinePolicy: offline,
    workspaceBindingDigest: boundary.digest,
    catalog: [],
  });
  const providerUnavailable = adapter.reconcile({providerDiscovery: emptyProvider});
  assert.equal(providerUnavailable.status, "MATCHED");
  assert.equal(providerUnavailable.provider_readback.status, "UNAVAILABLE");

  const partialProvider = compileProviderNeutralDiscovery({
    offlinePolicy: offline,
    workspaceBindingDigest: boundary.digest,
    catalog: [
      {
        adapter_ref: "ENV_REF_LOCAL_GIT",
        protocol: "LOCAL_ADAPTER_V1",
        capabilities: ["LOCAL_GIT_READ", "LOCAL_FILESYSTEM_READ"],
        network_required: false,
        authentication_required: false,
        external_write_required: false,
        trust_status: "TRUSTED_HOST_CATALOG",
      },
      {
        adapter_ref: "ENV_REF_MISSING_PROVIDER",
        protocol: "LOCAL_ADAPTER_V1",
        capabilities: [],
        network_required: false,
        authentication_required: false,
        external_write_required: false,
        trust_status: "UNAVAILABLE",
      },
    ],
  });
  const partial = adapter.reconcile({providerDiscovery: partialProvider});
  assert.equal(partial.provider_readback.status, "PARTIAL_FAILURE");
  assert.equal(partial.provider_readback.unavailable_entry_count, 1);

  assert.throws(() => compileProviderNeutralDiscovery({
    offlinePolicy: offline,
    workspaceBindingDigest: boundary.digest,
    catalog: [
      {
        adapter_ref: "ENV_REF_DUPLICATE",
        protocol: "LOCAL_ADAPTER_V1",
        capabilities: [],
        network_required: false,
        authentication_required: false,
        external_write_required: false,
        trust_status: "UNVERIFIED",
      },
      {
        adapter_ref: "ENV_REF_DUPLICATE",
        protocol: "OTHER_ADAPTER_V1",
        capabilities: [],
        network_required: false,
        authentication_required: false,
        external_write_required: false,
        trust_status: "UNVERIFIED",
      },
    ],
  }), /duplicate adapter references/u);
  assert.throws(() => compileProviderNeutralDiscovery({
    offlinePolicy: offline,
    workspaceBindingDigest: boundary.digest,
    catalog: [{
      adapter_ref: "ENV_REF_FALSE_NETWORK",
      protocol: "LOCAL_ADAPTER_V1",
      capabilities: ["NETWORK_READ"],
      network_required: false,
      authentication_required: false,
      external_write_required: false,
      trust_status: "UNVERIFIED",
    }],
  }), /network requirement does not match/u);

  fs.writeFileSync(path.join(project, "product.txt"), "changed\n", "utf8");
  const changed = adapter.handoff({expectedSource: expected});
  assert.equal(changed.status, "MISMATCH");
  assert(changed.mismatch_fields.includes("working_tree_digest"));

  const detachedExpected = sourceIdentity(adapter.reconcile().source_readback);
  git(project, ["checkout", "--detach", "--quiet"]);
  const detached = adapter.preWork({expectedSource: detachedExpected});
  assert.equal(detached.status, "MISMATCH");
  assert(detached.mismatch_fields.includes("detached"));

  const boundaryFile = path.join(control, "workspace-boundary.json");
  const persistedBoundary = fs.readFileSync(boundaryFile, "utf8");
  fs.writeFileSync(boundaryFile, `${persistedBoundary.replace("PREPARED_NOT_ACTIVATED", "BROKEN")}`);
  const persistedUnavailable = adapter.reopen();
  assert.equal(persistedUnavailable.status, "UNAVAILABLE");
  assert.equal(persistedUnavailable.failure_code, "PRIVATE_CONTROL_INVALID");
  fs.writeFileSync(boundaryFile, persistedBoundary, "utf8");

  const synthetic = compileLocalWorkspaceReceipt({
    boundary,
    operation: "RECONCILE",
    controlReadback: {
      status: "UNAVAILABLE",
      topology: null,
      commit: null,
      tree: null,
      clean: null,
      failure_code: "CONTROL_REPOSITORY_READBACK_UNAVAILABLE",
    },
    sourceReadback: {
      status: "UNAVAILABLE",
      repository: null,
      source_commit: null,
      source_tree: null,
      working_tree_digest: null,
      clean: null,
      detached: null,
      failure_code: "SOURCE_READBACK_UNAVAILABLE",
    },
    observedAtUtc: "2026-08-09T12:00:00.000Z",
  });
  assert.equal(synthetic.status, "UNAVAILABLE");
  assert.equal(synthetic.failure_code, "CONTROL_REPOSITORY_READBACK_UNAVAILABLE");
  validateLocalWorkspaceReceipt(synthetic);
} finally {
  fs.rmSync(root, {recursive: true, force: true});
}

console.log("PASS local adapter contract: register/reopen, source binding, handoff drift, detached mismatch, provider unavailable/partial readback, no-effects evidence, and privacy checks");
