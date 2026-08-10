#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {canonicalDigest} from "../control/bootstrap-compiler.mjs";
import {
  assertSourceIdentity,
  compileGuiHostReadbacks,
  compileHostRuntimeReadback,
  compileHostWorkspaceReadback,
} from "../control/host-runtime-adapter.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const controller = path.join(root, "control/bootstrap-compiler.mjs");
const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-bootstrap-start-"));

try {
  const result = spawnSync(process.execPath, [controller, "start", projectRoot, "RECOMMENDED"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const output = JSON.parse(result.stdout);
  assert.equal(output.schema, "agentos.bootstrap_start_result.v1");
  assert.equal(output.governance_version, "2.1rc");
  assert.equal(output.status, "READ_ONLY_DISCOVERY_COMPLETE");
  assert.equal(output.canonical_controller, "control/bootstrap-compiler.mjs");
  assert.equal(output.agentos_root, root);
  assert.equal(output.project_root, fs.realpathSync.native(projectRoot));
  assert.equal(output.control_plane.mode, "EXTERNAL_DEFAULT");
  assert.equal(output.control_plane_root, output.control_plane.control_plane_root);
  assert.notEqual(output.control_plane_root, output.project_root);
  assert.equal(output.initial_answers["bootstrap.discovery.mode"], "RECOMMENDED");
  const startContract = JSON.parse(fs.readFileSync(path.join(root, "schemas/bootstrap-start.v1.json"), "utf8"));
  assert(startContract.safety.next_step.includes("default JSA mode"));
  assert(startContract.safety.next_step.includes("changed scope returns to reassessment"));
  assert.equal(output.bootstrap_operating_mode, "JSA");
  assert.equal(output.question_plan.status, "QUESTION_PENDING");
  assert.equal(output.next_action, "ASK_ONLY_THE_NEXT_MATERIAL_BOOTSTRAP_QUESTION");
  assert.equal(output.discovery.operations.read_only, true);
  assert.equal(output.discovery.operations.authentication_attempted, false);
  assert.equal(output.discovery.operations.spending_attempted, false);
  assert.equal(output.discovery.operations.publication_attempted, false);
  assert.equal(output.discovery.operations.deployment_attempted, false);
  assert.equal(output.discovery.operations.deletion_attempted, false);
  assert.equal(output.question_plan.schema, "agentos.bootstrap_question_plan.v1");
  assert.deepEqual(output.question_plan.conversation_floor, {
    language: "PLAIN_EVERYDAY",
    questions_per_turn: 1,
    internal_fields_hidden: true,
    ask_only: "EARLIEST_MATERIAL_UNRESOLVED",
    safe_discovery_defaults_allowed: true,
    maximum_prompt_words: 20,
    forbidden_user_terms: ["JSON", "authority corpus", "campaign", "digest", "policy state", "runtime", "schema", "worktree"],
  });
  assert.equal(output.question_plan.question_budget.presented, 1);
  const projectRegistration = {
    projectId: "PROJECT-BOOTSTRAP-READBACK",
    projectKind: "local",
    path: root,
    hostId: "local",
    isGitRepository: true,
  };
  const controllerThread = {
    id: "CONTROLLER-THREAD-BOOTSTRAP",
    hostId: "local",
    status: "active",
    cwd: root,
  };
  const runtimeThread = {
    id: "RUNTIME-THREAD-BOOTSTRAP",
    hostId: "local",
    status: "idle",
    cwd: root,
  };
  const hostThreadKind = ["co", "dex"].join("");
  controllerThread.kind = hostThreadKind;
  runtimeThread.kind = hostThreadKind;
  const listThreadsReceipt = {schemaVersion: 2, threads: [controllerThread, runtimeThread]};
  const controllerReadReceipt = {
    schemaVersion: 1,
    thread: {...controllerThread, status: {type: "active"}},
    turns: [],
  };
  const runtimeTurnId = "RUNTIME-TURN-BOOTSTRAP";
  const runtimeReadReceipt = {
    schemaVersion: 1,
    thread: {...runtimeThread, status: {type: "idle"}},
    turns: [{id: runtimeTurnId, status: "completed"}],
  };
  const runtimeWaitReceipt = {
    timedOut: false,
    wake: {reason: "turnCompleted", turnId: runtimeTurnId, threadId: runtimeThread.id, hostId: "local"},
    polls: [{
      thread: {...runtimeThread, status: {type: "idle"}},
      latestTurn: {id: runtimeTurnId, status: "completed", completedAt: 1785960302},
    }],
  };
  const receipts = {
    projectRoot: root,
    projectRegistration,
    listThreadsReceipt,
    controllerThread,
    runtimeThread,
    controllerReadReceipt,
    runtimeReadReceipt,
    controllerPinReceipt: {threadId: controllerThread.id, pinned: true},
    runtimePinReceipt: {threadId: runtimeThread.id, pinned: true},
    runtimeSendReceipt: {threadId: runtimeThread.id},
    runtimeWaitReceipt,
    observedByRole: "BOOTSTRAP",
  };
  const guiReadbacks = compileGuiHostReadbacks(receipts);
  assert.equal(guiReadbacks.workspace_readback.observed_by_session, runtimeThread.id);
  assert.equal(guiReadbacks.runtime_readback.session_id, runtimeThread.id);
  assert.equal(guiReadbacks.runtime_readback.observed_by_session, controllerThread.id);
  assert.equal(guiReadbacks.runtime_readback.pinned, true);
  assert.equal(guiReadbacks.runtime_readback.resume_readback, true);
  assert.equal(guiReadbacks.controller_runtime_readback.project_id, projectRegistration.projectId);
  assert.equal(guiReadbacks.controller_runtime_readback.controller_runtime_id, controllerThread.id);
  assert.equal(guiReadbacks.controller_runtime_readback.runtime_id, runtimeThread.id);
  assert.deepEqual(guiReadbacks.proof, {
    listed_controller_thread_id: controllerThread.id,
    listed_runtime_thread_id: runtimeThread.id,
    controller_read_thread_id: controllerThread.id,
    runtime_read_thread_id: runtimeThread.id,
    controller_pinned: true,
    runtime_pinned: true,
    runtime_send_thread_id: runtimeThread.id,
    runtime_resume_turn_id: runtimeTurnId,
    controller_active: true,
    runtime_resumed: true,
  });
  assert.equal(compileHostRuntimeReadback(receipts).session_id, runtimeThread.id);
  assert.equal(compileHostWorkspaceReadback({
    projectRoot: root,
    projectRegistration,
    observerThread: controllerThread,
  }).observed_by_session, controllerThread.id);
  const sourceIdentity = {source_commit: "a".repeat(40), source_tree: "b".repeat(40)};
  assert.deepEqual(assertSourceIdentity(sourceIdentity), sourceIdentity);
  assert.throws(() => assertSourceIdentity({...sourceIdentity, source_commit: "a".repeat(39)}), /commit is unavailable or invalid/u,
    "shortened source commits must fail closed");
  assert.throws(() => assertSourceIdentity({...sourceIdentity, source_tree: "b".repeat(39)}), /tree is unavailable or invalid/u,
    "shortened source trees must fail closed");

  const priorThreadEnv = process.env.AGENTOS_HOST_SESSION_ID;
  process.env.AGENTOS_HOST_SESSION_ID = "USER-TYPED-SESSION-MUST-NOT-BIND";
  try {
    assert.throws(() => compileHostWorkspaceReadback({projectRoot: root, projectRegistration}), /thread receipts are required/u,
      "environment session IDs must not substitute for host thread receipts");
  } finally {
    if (priorThreadEnv === undefined) delete process.env.AGENTOS_HOST_SESSION_ID;
    else process.env.AGENTOS_HOST_SESSION_ID = priorThreadEnv;
  }

  const mismatchedProject = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-bootstrap-other-project-"));
  try {
    assert.throws(() => compileGuiHostReadbacks({...receipts, projectRegistration: {...projectRegistration, path: mismatchedProject}}), /project registration path differs/u,
      "mismatched project registrations must fail closed");
  } finally {
    fs.rmSync(mismatchedProject, {recursive: true, force: true});
  }
  assert.throws(() => compileGuiHostReadbacks({...receipts, runtimePinReceipt: {threadId: controllerThread.id, pinned: true}}), /pin receipt belongs to the wrong thread/u,
    "wrong-thread pin receipts must fail closed");
  assert.throws(() => compileGuiHostReadbacks({...receipts, runtimePinReceipt: {threadId: runtimeThread.id, pinned: false}}), /does not prove pinning/u,
    "missing pin proof must fail closed");
  assert.throws(() => compileGuiHostReadbacks({...receipts, runtimeWaitReceipt: {...runtimeWaitReceipt, timedOut: true}}), /timed out; resume is unproven/u,
    "missing resume proof must fail closed");
  assert.throws(() => compileGuiHostReadbacks({...receipts, runtimeWaitReceipt: {...runtimeWaitReceipt, wake: {...runtimeWaitReceipt.wake, threadId: controllerThread.id}}}), /wrong thread or host/u,
    "wrong-thread resume receipts must fail closed");
  assert.notEqual(output.question_plan.next, "bootstrap.discovery.mode", "the explicit start mode must not be asked again");
  assert.equal(output.question_plan.discovery_digest_sha256, canonicalDigest(output.discovery.facts), "the start result must expose the discovery binding");
  const startBody = structuredClone(output);
  delete startBody.start_sha256;
  const canonicalize = (value) => Array.isArray(value)
    ? value.map(canonicalize)
    : value && typeof value === "object"
      ? Object.fromEntries(Object.keys(value).sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right))).map((key) => [key, canonicalize(value[key])]))
      : value;
  const digest = crypto.createHash("sha256").update(JSON.stringify(canonicalize(startBody)), "utf8").digest("hex");
  assert.equal(output.start_sha256, digest);

  const missingPath = spawnSync(process.execPath, [controller, "start"], {cwd: root, encoding: "utf8"});
  assert.notEqual(missingPath.status, 0, "start without a project root must fail closed");
  const relativePath = spawnSync(process.execPath, [controller, "start", path.relative(root, projectRoot), "RECOMMENDED"], {cwd: root, encoding: "utf8"});
  assert.notEqual(relativePath.status, 0, "start with a relative project root must fail closed");
  const importedFromStdin = spawnSync(process.execPath, ["--input-type=module", "-"], {
    cwd: root,
    input: "import './control/bootstrap-compiler.mjs'; console.log('IMPORTED');\n",
    encoding: "utf8",
  });
  assert.equal(importedFromStdin.status, 0, `${importedFromStdin.stdout}\n${importedFromStdin.stderr}`);
  assert(importedFromStdin.stdout.includes("IMPORTED"), "controller import from stdin did not complete");
  const spacedProjectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos bootstrap start - "));
  try {
    const spaced = spawnSync(process.execPath, [controller, "start", spacedProjectRoot, "RECOMMENDED"], {cwd: root, encoding: "utf8"});
    assert.equal(spaced.status, 0, `${spaced.stdout}\n${spaced.stderr}`);
    assert.equal(JSON.parse(spaced.stdout).project_root, fs.realpathSync.native(spacedProjectRoot));
  } finally {
    fs.rmSync(spacedProjectRoot, {recursive: true, force: true});
  }
  const symlinkTarget = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-bootstrap-start-target-"));
  const symlinkRoot = path.join(projectRoot, "symlink-project");
  fs.symlinkSync(symlinkTarget, symlinkRoot, "dir");
  try {
    const unsafe = spawnSync(process.execPath, [controller, "start", symlinkRoot, "RECOMMENDED"], {cwd: root, encoding: "utf8"});
    assert.notEqual(unsafe.status, 0, "start through a symlink must fail closed");
  } finally {
    fs.rmSync(symlinkTarget, {recursive: true, force: true});
  }
  console.log("PASS AgentOS Bootstrap start contract: exact two-root read-only invocation, result binding, missing-path, and symlink hostile cases passed");
} finally {
  fs.rmSync(projectRoot, {recursive: true, force: true});
}
