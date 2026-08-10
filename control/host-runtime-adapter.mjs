#!/usr/bin/env node

/* Host-runtime boundary: derive persistent role readbacks from host receipts. */

import {execFileSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {compileControllerRuntimeReadback} from "./agentos-controller.mjs";
import {canonicalDigest} from "./content-addressing.mjs";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value, label) {
  assert(isRecord(value), `${label} is unavailable or invalid`);
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} is unavailable or invalid`);
}

function requireIdentifier(value, label) {
  assert(typeof value === "string" && IDENTIFIER.test(value), `${label} is unavailable or unsafe`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} is unavailable or invalid`);
}

export function assertSourceIdentity(sourceIdentity, label = "source identity") {
  requireRecord(sourceIdentity, label);
  assert(typeof sourceIdentity.source_commit === "string" && GIT_OBJECT.test(sourceIdentity.source_commit), `${label} commit is unavailable or invalid`);
  assert(typeof sourceIdentity.source_tree === "string" && GIT_OBJECT.test(sourceIdentity.source_tree), `${label} tree is unavailable or invalid`);
  return sourceIdentity;
}

function requireUtc(value, label) {
  assert(typeof value === "string" && ISO_UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} is unavailable or invalid`);
}

function canonicalRoot(value, label) {
  requireString(value, label);
  const root = fs.realpathSync.native(path.resolve(value));
  const stat = fs.lstatSync(root);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), `${label} must be a real directory`);
  return root;
}

function threadState(thread) {
  if (typeof thread?.status === "string") return thread.status;
  if (isRecord(thread?.status) && typeof thread.status.type === "string") return thread.status.type;
  return null;
}

function validateProjectRegistration(projectRegistration, projectRoot) {
  requireRecord(projectRegistration, "host-runtime project registration");
  requireIdentifier(projectRegistration.projectId, "host-runtime project registration ID");
  requireString(projectRegistration.path, "host-runtime project registration path");
  requireIdentifier(projectRegistration.hostId, "host-runtime project registration host");
  assert(projectRegistration.isGitRepository === true, "host-runtime project registration is not a Git repository");
  assert(canonicalRoot(projectRegistration.path, "host-runtime project registration path") === projectRoot,
    "host-runtime project registration path differs from the saved project");
  return projectRegistration;
}

function validateThread(thread, projectRoot, projectRegistration, label) {
  requireRecord(thread, label);
  requireIdentifier(thread.id, `${label} ID`);
  assert(thread.kind === "codex", `${label} is not a Codex task`);
  assert(thread.hostId === projectRegistration.hostId, `${label} host differs from the project host`);
  requireString(thread.cwd, `${label} working path`);
  assert(canonicalRoot(thread.cwd, `${label} working path`) === projectRoot,
    `${label} working path differs from the saved project`);
  return thread;
}

function listedThread(listThreadsReceipt, thread, projectRoot, projectRegistration, label) {
  requireRecord(listThreadsReceipt, "host-runtime list_threads receipt");
  assert(Array.isArray(listThreadsReceipt.threads), "host-runtime list_threads receipt has no thread objects");
  const listed = listThreadsReceipt.threads.find((candidate) => candidate?.id === thread?.id);
  assert(listed !== undefined, `${label} is not the thread returned by list_threads`);
  validateThread(listed, projectRoot, projectRegistration, `${label} listed thread`);
  validateThread(thread, projectRoot, projectRegistration, label);
  assert(listed.cwd === thread.cwd && listed.hostId === thread.hostId, `${label} thread binding changed after list_threads`);
  return listed;
}

function readThread(readReceipt, expectedThread, projectRoot, projectRegistration, label) {
  requireRecord(readReceipt, `${label} read receipt`);
  validateThread(readReceipt.thread, projectRoot, projectRegistration, `${label} read thread`);
  assert(readReceipt.thread.id === expectedThread.id, `${label} read receipt belongs to the wrong thread`);
  return readReceipt.thread;
}

function requirePinReceipt(pinReceipt, thread, label) {
  requireRecord(pinReceipt, `${label} pin receipt`);
  assert(pinReceipt.threadId === thread.id, `${label} pin receipt belongs to the wrong thread`);
  assert(pinReceipt.pinned === true, `${label} pin receipt does not prove pinning`);
}

function requireSendReceipt(sendReceipt, thread, label) {
  requireRecord(sendReceipt, `${label} send receipt`);
  assert(sendReceipt.threadId === thread.id, `${label} send receipt belongs to the wrong thread`);
}

function hostEpochToUtc(value, label) {
  assert(Number.isSafeInteger(value) && value > 0, `${label} is unavailable or invalid`);
  const milliseconds = value < 1_000_000_000_000 ? value * 1000 : value;
  const result = new Date(milliseconds).toISOString();
  requireUtc(result, label);
  return result;
}

function requireResumeProof(waitReceipt, runtimeReadReceipt, runtimeThread, projectRoot, projectRegistration) {
  requireRecord(waitReceipt, "Runtime wait receipt");
  assert(waitReceipt.timedOut === false, "Runtime wait receipt timed out; resume is unproven");
  requireRecord(waitReceipt.wake, "Runtime wait wake receipt");
  assert(waitReceipt.wake.threadId === runtimeThread.id && waitReceipt.wake.hostId === runtimeThread.hostId,
    "Runtime wait receipt belongs to the wrong thread or host");
  assert(waitReceipt.wake.reason === "turnCompleted", "Runtime wait receipt does not prove a completed resumed turn");
  requireIdentifier(waitReceipt.wake.turnId, "Runtime wait turn ID");
  assert(Array.isArray(waitReceipt.polls), "Runtime wait receipt has no host polls");
  const completedPoll = waitReceipt.polls.find((poll) => poll?.thread?.id === runtimeThread.id
    && poll.thread.hostId === runtimeThread.hostId
    && poll.latestTurn?.id === waitReceipt.wake.turnId
    && poll.latestTurn.status === "completed"
    && Number.isSafeInteger(poll.latestTurn.completedAt));
  assert(completedPoll !== undefined, "Runtime wait receipt does not prove a completed resumed turn");
  const readThreadResult = readThread(runtimeReadReceipt, runtimeThread, projectRoot, projectRegistration, "Runtime");
  assert(Array.isArray(runtimeReadReceipt.turns), "Runtime read receipt has no turns");
  const resumedTurn = runtimeReadReceipt.turns.find((turn) => turn?.id === waitReceipt.wake.turnId && turn.status === "completed");
  assert(resumedTurn !== undefined, "Runtime read receipt does not retain the completed resumed turn");
  return {
    turn_id: waitReceipt.wake.turnId,
    observed_at_utc: hostEpochToUtc(completedPoll.latestTurn.completedAt, "Runtime resume observation time"),
    readback_thread_id: readThreadResult.id,
  };
}

function readHostWorkspace({projectRoot, projectRegistration, observerThread, observedByRole}) {
  const root = canonicalRoot(projectRoot, "host runtime project root");
  validateProjectRegistration(projectRegistration, root);
  requireIdentifier(observedByRole, "host runtime observer role");
  validateThread(observerThread, root, projectRegistration, "host runtime observer thread");
  const gitReadback = (args, label) => {
    try {
      return execFileSync("git", ["-C", root, ...args], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
    } catch (error) {
      throw new Error(`host runtime ${label} readback is unavailable: ${error.stderr?.toString().trim() || error.message}`);
    }
  };
  const sourceRoot = gitReadback(["rev-parse", "--show-toplevel"], "Git root");
  assert(fs.realpathSync.native(sourceRoot) === root, "host runtime project root is not the Git workspace root");
  const sourceCommit = gitReadback(["rev-parse", "HEAD"], "source commit");
  const sourceTree = gitReadback(["rev-parse", "HEAD^{tree}"], "source tree");
  assertSourceIdentity({source_commit: sourceCommit, source_tree: sourceTree}, "host runtime Git source identity");
  // The environment is the registered workspace and committed source.  The
  // observer is a host-returned task object, never an environment variable or
  // owner-supplied identity.
  const environmentIdentity = `ENV-${canonicalDigest({adapter: "HOST_WORKSPACE", root, source_commit: sourceCommit, source_tree: sourceTree}).slice(0, 32).toUpperCase()}`;
  const readback = {
    schema: "agentos.host_workspace_readback.v1",
    version: 1,
    project_root: root,
    git_top_level: root,
    source_commit: sourceCommit,
    source_tree: sourceTree,
    environment_identity: environmentIdentity,
    capabilities: ["filesystem", "git"],
    observed_by_role: observedByRole,
    observed_by_session: observerThread.id,
    observed_at_utc: new Date().toISOString(),
    verification_method: "HOST_WORKSPACE_READBACK",
    readback_sha256: null,
  };
  readback.readback_sha256 = canonicalDigest({...readback, readback_sha256: null});
  return readback;
}

export function compileHostWorkspaceReadback({
  projectRoot = process.cwd(),
  projectRegistration = null,
  observerThread = null,
  observedByRole = "BOOTSTRAP",
} = {}) {
  assert(projectRegistration !== null && observerThread !== null,
    "host-runtime project registration and observer task receipts are required; environment session IDs are not accepted");
  return readHostWorkspace({projectRoot, projectRegistration, observerThread, observedByRole});
}

function validateRuntimeReadback(runtimeReadback, workspaceReadback) {
  const expectedKeys = [
    "schema", "version", "session_id", "environment_identity", "capabilities", "persistent", "pinned", "resume_readback",
    "observed_by_role", "observed_by_session", "observed_at_utc", "verification_method", "readback_sha256",
  ];
  requireRecord(runtimeReadback, "host Runtime readback");
  assert(JSON.stringify(Object.keys(runtimeReadback).sort()) === JSON.stringify([...expectedKeys].sort()), "host Runtime readback shape is invalid");
  assert(runtimeReadback.schema === "agentos.runtime_readback.v1" && runtimeReadback.version === 1, "host Runtime readback schema is invalid");
  requireIdentifier(runtimeReadback.session_id, "host Runtime session ID");
  requireIdentifier(runtimeReadback.environment_identity, "host Runtime environment identity");
  requireIdentifier(runtimeReadback.observed_by_role, "host Runtime observer role");
  requireIdentifier(runtimeReadback.observed_by_session, "host Runtime observer session");
  assert(Array.isArray(runtimeReadback.capabilities), "host Runtime capabilities are unavailable");
  const capabilities = [...runtimeReadback.capabilities].sort();
  assert(JSON.stringify(runtimeReadback.capabilities) === JSON.stringify(capabilities)
    && new Set(capabilities).size === capabilities.length
    && capabilities.every((value) => IDENTIFIER.test(value)), "host Runtime capabilities are invalid");
  assert(runtimeReadback.persistent === true && runtimeReadback.pinned === true && runtimeReadback.resume_readback === true,
    "host Runtime readback does not prove persistent pinned resume continuity");
  requireUtc(runtimeReadback.observed_at_utc, "host Runtime observation time");
  assert(runtimeReadback.verification_method === "RUNTIME_ADAPTER_READBACK", "host Runtime verification method is invalid");
  requireSha(runtimeReadback.readback_sha256, "host Runtime readback digest");
  assert(runtimeReadback.readback_sha256 === canonicalDigest({...runtimeReadback, readback_sha256: null}), "host Runtime readback digest is invalid");
  assert(runtimeReadback.environment_identity === workspaceReadback.environment_identity, "host Runtime environment differs from the observed workspace");
  assert(runtimeReadback.observed_by_session !== workspaceReadback.observed_by_session, "host Runtime readback lacks an independent observer session");
  return runtimeReadback;
}

export function compileHostRuntimeReadbacks({
  projectRoot = process.cwd(),
  projectRegistration = null,
  listThreadsReceipt = null,
  controllerThread = null,
  runtimeThread = null,
  controllerReadReceipt = null,
  runtimeReadReceipt = null,
  controllerPinReceipt = null,
  runtimePinReceipt = null,
  runtimeSendReceipt = null,
  runtimeWaitReceipt = null,
  observedByRole = "BOOTSTRAP",
} = {}) {
  const root = canonicalRoot(projectRoot, "host-runtime project root");
  validateProjectRegistration(projectRegistration, root);
  assert(controllerThread !== null && runtimeThread !== null, "host-runtime Controller and Runtime task objects are required");
  const listedController = listedThread(listThreadsReceipt, controllerThread, root, projectRegistration, "Controller");
  const listedRuntime = listedThread(listThreadsReceipt, runtimeThread, root, projectRegistration, "Runtime");
  assert(listedController.id !== listedRuntime.id, "host-runtime Controller and Runtime tasks must be different");
  const controllerRead = readThread(controllerReadReceipt, controllerThread, root, projectRegistration, "Controller");
  const runtimeRead = readThread(runtimeReadReceipt, runtimeThread, root, projectRegistration, "Runtime");
  requirePinReceipt(controllerPinReceipt, controllerThread, "Controller");
  requirePinReceipt(runtimePinReceipt, runtimeThread, "Runtime");
  requireSendReceipt(runtimeSendReceipt, runtimeThread, "Runtime");
  const resumeProof = requireResumeProof(runtimeWaitReceipt, runtimeReadReceipt, runtimeThread, root, projectRegistration);
  assert(threadState(controllerRead) === "active", "Controller read receipt does not prove an active task");
  assert(threadState(runtimeRead) === "idle" || threadState(runtimeRead) === "active", "Runtime read receipt has no usable task state");

  const workspaceReadback = readHostWorkspace({
    projectRoot: root,
    projectRegistration,
    observerThread: runtimeThread,
    observedByRole,
  });
  const runtimeReadbackBody = {
    schema: "agentos.runtime_readback.v1",
    version: 1,
    session_id: runtimeThread.id,
    environment_identity: workspaceReadback.environment_identity,
    capabilities: workspaceReadback.capabilities,
    persistent: true,
    pinned: true,
    resume_readback: true,
    observed_by_role: observedByRole,
    observed_by_session: controllerThread.id,
    observed_at_utc: resumeProof.observed_at_utc,
    verification_method: "RUNTIME_ADAPTER_READBACK",
    readback_sha256: null,
  };
  runtimeReadbackBody.readback_sha256 = canonicalDigest({...runtimeReadbackBody, readback_sha256: null});
  const runtimeReadback = validateRuntimeReadback(runtimeReadbackBody, workspaceReadback);
  const controllerRuntimeReadback = compileControllerRuntimeReadback({
    projectId: projectRegistration.projectId,
    controllerRuntimeId: controllerThread.id,
    runtimeId: runtimeThread.id,
    environmentIdentity: workspaceReadback.environment_identity,
    capabilitySetSha256: canonicalDigest(workspaceReadback.capabilities),
    observedBySession: runtimeThread.id,
    observedAtUtc: resumeProof.observed_at_utc,
  });
  return {
    schema: "agentos.host_runtime_readbacks.v1",
    version: 1,
    project_id: projectRegistration.projectId,
    project_root: root,
    source_commit: workspaceReadback.source_commit,
    source_tree: workspaceReadback.source_tree,
    environment_identity: workspaceReadback.environment_identity,
    workspace_readback: workspaceReadback,
    runtime_readback: runtimeReadback,
    controller_runtime_readback: controllerRuntimeReadback,
    proof: {
      listed_controller_thread_id: listedController.id,
      listed_runtime_thread_id: listedRuntime.id,
      controller_read_thread_id: controllerRead.id,
      runtime_read_thread_id: runtimeRead.id,
      controller_pinned: true,
      runtime_pinned: true,
      runtime_send_thread_id: runtimeSendReceipt.threadId,
      runtime_resume_turn_id: resumeProof.turn_id,
      controller_active: true,
      runtime_resumed: true,
    },
  };
}

export function compileHostRuntimeReadback(options = {}) {
  return compileHostRuntimeReadbacks(options).runtime_readback;
}

// Compatibility alias for historical callers. New output is generic and does
// not imply a graphical interface.
export const compileGuiHostReadbacks = compileHostRuntimeReadbacks;
