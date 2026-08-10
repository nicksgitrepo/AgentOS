#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";

import {
  canonicalDigest,
  canonicalJson,
  digestWithout,
  sha256,
} from "../control/private-control-common.mjs";
import {
  compilePrivateWorkspaceBinding,
  getPrivateWorkspaceRuntimeBinding,
  preparePrivateWorkspace,
  privateControlSnapshotDigest,
  validatePrivateWorkspaceBinding,
} from "../control/private-control-storage.mjs";
import {
  authorizeOfflineAction,
  compileOfflinePolicy,
  transitionOfflinePolicy,
  validateOfflinePolicy,
} from "../control/private-offline-mode.mjs";
import {
  compileProviderNeutralDiscovery,
  findOfflineUsableAdapters,
  validateProviderNeutralDiscovery,
} from "../control/private-provider-discovery.mjs";
import {
  exportPrivateControlBundle,
  importPrivateControlBundle,
  readPrivateControlBundle,
  validatePrivateControlBundle,
  writePrivateControlBundle,
} from "../control/private-control-bundle.mjs";
import {
  compilePrivateReleaseReplacementPlan,
  compileProjectGovernanceAppendix,
  executePrivateReleaseReplacement,
  readReleaseIdentity,
  validatePrivateReleaseReceipt,
} from "../control/private-release-update.mjs";

const SCHEMA_FILES = [
  ["schemas/private-workspace-binding.v1.json", "agentos.private_workspace_binding.v1"],
  ["schemas/private-control-repository.v1.json", "agentos.private_control_repository.v1"],
  ["schemas/offline-policy.v1.json", "agentos.offline_policy.v1"],
  ["schemas/offline-action-authorization.v1.json", "agentos.offline_action_authorization.v1"],
  ["schemas/provider-discovery.v1.json", "agentos.provider_discovery.v1"],
  ["schemas/private-control-bundle.v1.json", "agentos.private_control_bundle.v1"],
  ["schemas/private-control-import.v1.json", "agentos.private_control_import.v1"],
  ["schemas/project-governance-appendix.v1.json", "agentos.project_governance_appendix.v1"],
  ["schemas/project-governance-update.v1.json", "agentos.project_governance_update.v1"],
  ["schemas/private-release-update.v1.json", "agentos.private_release_update.v1"],
  ["schemas/private-release-update-prepared.v1.json", "agentos.private_release_update_prepared.v1"],
  ["schemas/private-release-update-receipt.v1.json", "agentos.private_release_update_receipt.v1"],
];

function mkdir(directory) {
  fs.mkdirSync(directory, {recursive: true});
  return directory;
}

function write(directory, relative, value) {
  const target = path.join(directory, relative);
  mkdir(path.dirname(target));
  fs.writeFileSync(target, value, "utf8");
  return target;
}

function git(directory, args) {
  return execFileSync("git", ["-C", directory, ...args], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
}

function createGitRelease(directory, label, version) {
  mkdir(directory);
  git(directory, ["init", "--quiet"]);
  write(directory, "release.txt", `${label}\n`);
  git(directory, ["add", "."]);
  git(directory, ["-c", "user.name=AgentOS Test", "-c", "user.email=agentos-test@example.invalid", "commit", "--quiet", "-m", `release ${version}`]);
  return directory;
}

function createWorkspace(root, label) {
  const workspace = mkdir(path.join(root, label));
  const release = createGitRelease(path.join(workspace, "release"), `${label}-release`, "V1");
  const projects = mkdir(path.join(workspace, "projects"));
  const project = mkdir(path.join(projects, "project"));
  write(project, "product.txt", `${label}-product\n`);
  const control = path.join(workspace, "control");
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
  return {workspace, release, projects, project, control, boundary};
}

function jsonRecord(directory, relative, value) {
  return write(directory, relative, `${canonicalJson(value)}\n`);
}

function testSchemas() {
  for (const [relative, id] of SCHEMA_FILES) {
    const schema = JSON.parse(fs.readFileSync(new URL(`../${relative}`, import.meta.url), "utf8"));
    assert.equal(schema.$id, id, relative);
    assert.equal(schema.additionalProperties, false, relative);
  }
}

function testWorkspaceAndOffline(workspace) {
  const beforeProject = sha256(fs.readFileSync(path.join(workspace.project, "product.txt")));
  const prepared = preparePrivateWorkspace(workspace.boundary);
  assert.equal(prepared.status, "CREATED");
  assert.equal(prepared.project_tree_touched, false);
  assert.equal(sha256(fs.readFileSync(path.join(workspace.project, "product.txt"))), beforeProject);
  assert.equal(fs.existsSync(path.join(workspace.control, ".git")), true);
  assert.equal(getPrivateWorkspaceRuntimeBinding(workspace.boundary).project_root, fs.realpathSync(workspace.project));
  validatePrivateWorkspaceBinding(JSON.parse(fs.readFileSync(path.join(workspace.control, "workspace-boundary.json"), "utf8")));
  assert.equal(JSON.stringify(workspace.boundary).includes(workspace.release), false);
  assert.equal(JSON.stringify(workspace.boundary).includes(workspace.control), false);

  const offline = compileOfflinePolicy({workspaceBindingDigest: workspace.boundary.digest});
  validateOfflinePolicy(offline);
  assert.equal(authorizeOfflineAction(offline, "LOCAL_GIT_READ").status, "ALLOWED");
  assert.throws(() => authorizeOfflineAction(offline, "NETWORK_READ"), (error) => error.code === "OFFLINE_ACTION_DENIED");
  const review = transitionOfflinePolicy(offline, {event: "REQUEST_ONLINE", ownerDecisionDigest: canonicalDigest({choice: "review"})});
  assert.equal(review.mode, "ONLINE_READ_ONLY");
  const online = transitionOfflinePolicy(review, {
    event: "BIND_ONLINE_ACTIONS",
    ownerDecisionDigest: canonicalDigest({choice: "online"}),
    capabilityDigest: canonicalDigest({capability: "test"}),
  });
  assert.equal(online.status, "ONLINE_BOUND");
  assert.equal(transitionOfflinePolicy(online, {event: "RETURN_OFFLINE"}).mode, "OFFLINE_ENFORCED");

  const discovery = compileProviderNeutralDiscovery({
    offlinePolicy: offline,
    workspaceBindingDigest: workspace.boundary.digest,
    catalog: [{
      adapter_ref: "ENV_REF_LOCAL_GIT",
      protocol: "CONTROL_ADAPTER_V1",
      capabilities: ["LOCAL_GIT_READ", "LOCAL_FILESYSTEM_READ"],
      network_required: false,
      authentication_required: false,
      external_write_required: false,
      trust_status: "TRUSTED_HOST_CATALOG",
    }],
  });
  validateProviderNeutralDiscovery(discovery);
  assert.equal(findOfflineUsableAdapters(discovery).length, 1);
  assert.equal(JSON.stringify(discovery).includes("provider_id"), false);
  assert.throws(() => compileProviderNeutralDiscovery({
    offlinePolicy: offline,
    workspaceBindingDigest: workspace.boundary.digest,
    catalog: [{
      adapter_ref: "ENV_REF_UNSAFE",
      protocol: "CONTROL_ADAPTER_V1",
      capabilities: [],
      network_required: false,
      authentication_required: false,
      external_write_required: false,
      trust_status: "UNVERIFIED",
      module_url: "not-allowed",
    }],
  }));
}

function testBundleRoundTrip(first, second) {
  write(first.control, "worktrees/should-not-export.txt", "isolated worktree content\n");
  jsonRecord(first.control, "state/control-state.json", {
    schema: "fixture.control_state.v1",
    version: 1,
    status: "READY",
    environment_ref: "ENV_REF_LOCAL",
    artifact_digest: "a".repeat(64),
    path: "state/control-state.json",
  });
  const bundle = exportPrivateControlBundle(first.boundary, {bundleId: "BUNDLE-ROUNDTRIP"});
  validatePrivateControlBundle(bundle);
  assert.equal(bundle.files.some((entry) => entry.path.startsWith("worktrees/")), false);
  writePrivateControlBundle(path.join(first.workspace, "private-control.bundle.json"), bundle, {workspaceBoundary: first.boundary});
  assert.equal(readPrivateControlBundle(path.join(first.workspace, "private-control.bundle.json")).digest, bundle.digest);
  assert.equal(JSON.stringify(bundle).includes(first.control), false);
  assert.equal(JSON.stringify(bundle).includes(first.project), false);
  const receipt = importPrivateControlBundle(bundle, second.boundary, {mode: "NEW_CONTROL"});
  assert.equal(receipt.status, "IMPORTED");
  assert.equal(fs.readFileSync(path.join(second.control, "state/control-state.json"), "utf8"), fs.readFileSync(path.join(first.control, "state/control-state.json"), "utf8"));
  assert.equal(receipt.project_tree_touched, false);
  assert.throws(() => writePrivateControlBundle(path.join(first.project, "bundle.json"), bundle, {workspaceBoundary: first.boundary}), /project|control|CONTAINMENT/u);

  write(second.control, "state/control-state.json", "{\"different\":true}\n");
  assert.throws(() => importPrivateControlBundle(bundle, second.boundary, {mode: "MERGE_EXACT"}), (error) => error.code === "SHARED_FILE_CONFLICT");
  fs.rmSync(path.join(second.control, "state/control-state.json"));

  const stagedBundle = {...bundle, bundle_id: "BUNDLE-STAGE-CONFLICT", digest: null};
  stagedBundle.digest = digestWithout(stagedBundle, "digest");
  const stagingConflict = path.join(second.control, "worktrees", ".agentos-import-BUNDLE-STAGE-CONFLICT");
  mkdir(stagingConflict);
  assert.throws(() => importPrivateControlBundle(stagedBundle, second.boundary, {mode: "MERGE_EXACT"}), (error) => error.code === "SHARED_FILE_CONFLICT");
  assert.equal(fs.existsSync(stagingConflict), true);
  fs.rmSync(stagingConflict, {recursive: true, force: true});

  const hostile = structuredClone(bundle);
  hostile.files[0].path = "../escape.json";
  assert.throws(() => validatePrivateControlBundle(hostile), /escapes|relative path/u);
  const gitHostile = structuredClone(bundle);
  gitHostile.files[0].path = ".git/config";
  assert.throws(() => validatePrivateControlBundle(gitHostile), /Git metadata|UNSAFE_GIT_OBJECT/u);
  jsonRecord(first.control, "state/unsafe.json", {value: "token=SHOULD_NOT_PERSIST"});
  assert.throws(() => exportPrivateControlBundle(first.boundary), /secret-like|environment value/u);
  fs.rmSync(path.join(first.control, "state/unsafe.json"));
}

function testHostileBoundaries(root, workspace) {
  const insideProject = path.join(workspace.project, "control");
  assert.throws(() => compilePrivateWorkspaceBinding({
    release_root: workspace.release,
    projects_root: workspace.projects,
    project_root: workspace.project,
    control_root: insideProject,
  }), /siblings|overlaps|inside/u);

  const authorized = compilePrivateWorkspaceBinding({
    release_root: workspace.release,
    projects_root: workspace.projects,
    project_root: workspace.project,
    control_root: insideProject,
    projectWritePolicy: "IN_PROJECT_EXPLICIT",
    projectWriteAuthorizationDigest: canonicalDigest({choice: "owner-authorized-in-project-control"}),
  });
  assert.equal(preparePrivateWorkspace(authorized).project_tree_touched, false);
  assert.equal(fs.existsSync(path.join(insideProject, "workspace-boundary.json")), true);
  fs.rmSync(insideProject, {recursive: true, force: true});

  const symlink = path.join(root, "control-alias");
  try {
    fs.symlinkSync(workspace.control, symlink, "dir");
    assert.throws(() => compilePrivateWorkspaceBinding({
      release_root: workspace.release,
      projects_root: workspace.projects,
      project_root: workspace.project,
      control_root: symlink,
    }), /symbolic|siblings|canonical/u);
  } finally {
    if (fs.existsSync(symlink)) fs.unlinkSync(symlink);
  }
}

function testReleaseReplacement(root, workspace) {
  const candidate = createGitRelease(path.join(workspace.workspace, "release-candidate"), "candidate-two", "V2");
  const currentIdentity = readReleaseIdentity(workspace.release, "V1");
  const candidateIdentity = readReleaseIdentity(candidate, "V2");
  const appendix = compileProjectGovernanceAppendix({
    projectId: "PROJECT-TEST",
    sourceRevision: "REV-1",
    compatibleReleaseDigests: [candidateIdentity.release_digest],
    graphBindings: [{graph_id: "GRAPH-TEST", path: "governance/graph.gate", graph_sha256: "b".repeat(64)}],
    roleOverlays: [],
  });
  const plan = compilePrivateReleaseReplacementPlan({
    updateId: "UPDATE-KEEP",
    projectId: "PROJECT-TEST",
    workspaceBoundary: workspace.boundary,
    currentRelease: currentIdentity,
    replacementRelease: candidateIdentity,
    governanceMode: "KEEP_PROJECT_APPENDICES",
    controlSnapshotDigest: privateControlSnapshotDigest(workspace.boundary),
  });
  const projectBefore = sha256(fs.readFileSync(path.join(workspace.project, "product.txt")));
  const retention = path.join(workspace.workspace, "release-previous");
  const result = executePrivateReleaseReplacement({
    plan,
    workspaceBoundary: workspace.boundary,
    candidateRoot: candidate,
    retentionRoot: retention,
    projectGovernanceAppendix: appendix,
  });
  assert.equal(result.status, "VERIFIED");
  validatePrivateReleaseReceipt(result.receipt);
  assert.equal(readReleaseIdentity(workspace.release, "V2").release_digest, candidateIdentity.release_digest);
  assert.equal(fs.existsSync(retention), true);
  assert.equal(fs.existsSync(candidate), false);
  assert.equal(sha256(fs.readFileSync(path.join(workspace.project, "product.txt"))), projectBefore);
  assert.equal(executePrivateReleaseReplacement({
    plan,
    workspaceBoundary: workspace.boundary,
    candidateRoot: candidate,
    retentionRoot: retention,
    projectGovernanceAppendix: appendix,
  }).idempotent, true);

  const incompatibleCandidate = createGitRelease(path.join(workspace.workspace, "release-incompatible"), "candidate-three", "V3");
  const incompatibleIdentity = readReleaseIdentity(incompatibleCandidate, "V3");
  const reviewPlan = compilePrivateReleaseReplacementPlan({
    updateId: "UPDATE-REVIEW",
    projectId: "PROJECT-TEST",
    workspaceBoundary: workspace.boundary,
    currentRelease: readReleaseIdentity(workspace.release, "V2"),
    replacementRelease: incompatibleIdentity,
    governanceMode: "KEEP_PROJECT_APPENDICES",
    controlSnapshotDigest: privateControlSnapshotDigest(workspace.boundary),
  });
  const review = executePrivateReleaseReplacement({
    plan: reviewPlan,
    workspaceBoundary: workspace.boundary,
    candidateRoot: incompatibleCandidate,
    retentionRoot: path.join(workspace.workspace, "review-retention"),
    projectGovernanceAppendix: appendix,
  });
  assert.equal(review.status, "GOVERNANCE_REVIEW_REQUIRED");
  assert.equal(fs.existsSync(incompatibleCandidate), true);
  assert.equal(readReleaseIdentity(workspace.release, "V2").release_digest, candidateIdentity.release_digest);

  const resetCandidate = createGitRelease(path.join(workspace.workspace, "release-reset"), "candidate-four", "V4");
  const resetIdentity = readReleaseIdentity(resetCandidate, "V4");
  const resetDecision = canonicalDigest({decision: "owner-selected-clean-governance"});
  const clean = compileProjectGovernanceAppendix({
    projectId: "PROJECT-TEST",
    sourceRevision: "CLEAN-1",
    compatibleReleaseDigests: [resetIdentity.release_digest],
    graphBindings: [],
    roleOverlays: [],
    status: "CLEAN",
  });
  const resetPlan = compilePrivateReleaseReplacementPlan({
    updateId: "UPDATE-RESET",
    projectId: "PROJECT-TEST",
    workspaceBoundary: workspace.boundary,
    currentRelease: readReleaseIdentity(workspace.release, "V2"),
    replacementRelease: resetIdentity,
    governanceMode: "RESET_GOVERNANCE_CLEAN",
    controlSnapshotDigest: privateControlSnapshotDigest(workspace.boundary),
    ownerDecisionDigest: resetDecision,
  });
  const resetResult = executePrivateReleaseReplacement({
    plan: resetPlan,
    workspaceBoundary: workspace.boundary,
    candidateRoot: resetCandidate,
    retentionRoot: path.join(workspace.workspace, "release-reset-previous"),
    projectGovernanceAppendix: appendix,
    cleanGovernanceAppendix: clean,
  });
  assert.equal(resetResult.status, "VERIFIED");
  assert.equal(fs.existsSync(path.join(workspace.control, `governance/archives/${appendix.digest}.json`)), true);
  assert.equal(fs.existsSync(path.join(workspace.control, "governance/active/UPDATE-RESET.json")), true);
}

function main() {
  testSchemas();
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "agentos-private-control-slice-"));
  try {
    const first = createWorkspace(root, "first");
    const second = createWorkspace(root, "second");
    testWorkspaceAndOffline(first);
    testBundleRoundTrip(first, second);
    testHostileBoundaries(root, first);
    testReleaseReplacement(root, first);
    process.stdout.write("PASS private control storage, offline policy, provider discovery, bundle portability, release replacement, governance choice, and hostile boundaries\n");
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
}

main();
