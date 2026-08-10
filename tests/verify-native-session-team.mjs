#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  CAMPAIGN_TEAM_ROLES,
  FOUNDATION_LANE_ROLES,
  IMPLEMENTATION_LANE_ROLES,
  DEFAULT_AGENT_EXECUTION,
  DEFAULT_AGENT_MODEL,
  DEFAULT_AGENT_REASONING_EFFORT,
  NATIVE_IMPLEMENTATION_LANE_HANDOFF_SCHEMA,
  compileNativeImplementationLaneHandoff,
  validateNativeImplementationLaneHandoff,
  NativeSessionBoundaryError,
  NATIVE_SESSION_CLOSURE_LIFECYCLE,
  NATIVE_SESSION_TOOLS,
  compileNativeSessionHostSpawnPayload,
  compileNativeSessionHostIdentityBoundary,
  createNativeSessionTeam,
  compileNativeCampaignTeamPlan,
  compileNativeImplementationTeamPlan,
  compileNativeSessionSpawnReadback,
  compileNativeSessionSpawnRequest,
  validateNativeSessionClosureReceipt,
  validateNativeSessionHostCapabilities,
  validateNativeSessionHostExecutionIdentity,
  validateNativeSessionHostIdentityBoundary,
  validateNativeSessionSpawnReadback,
} from "../control/native-session-team.mjs";
import {createLocalSelfDevelopmentAdapters} from "../control/local-agent-runtime.mjs";
import {compileNativeHostAttachment} from "../control/native-host-attachment.mjs";

const COMMIT = "1".repeat(40);
const TREE = "2".repeat(40);
const NOW = "2026-08-04T12:00:00.000Z";
const CLIENT_THREAD = `client-new-thread:${["00000000", "0000", "4000", "8000", "000000000001"].join("-")}`;
const THREAD_ID = ["00000000", "0000", "4000", "8000", "000000000002"].join("-");
const hostAttachment = compileNativeHostAttachment({
  attachmentId: "ATTACHMENT-TEAM-1",
  hostId: "local",
  projectId: "project-context",
  environmentId: "local-test",
  attachedAtUtc: NOW,
});

assert.deepEqual(DEFAULT_AGENT_EXECUTION, {model: "gpt-5.6-luna", reasoning_effort: "max"});
assert.equal(DEFAULT_AGENT_MODEL, "gpt-5.6-luna");
assert.equal(DEFAULT_AGENT_REASONING_EFFORT, "max");
assert.deepEqual(NATIVE_SESSION_TOOLS, ["create_thread", "list_threads", "read_thread", "send_message_to_thread", "set_thread_archived", "set_thread_pinned", "wait_threads"]);
assert.equal(FOUNDATION_LANE_ROLES.length, 12);
assert.equal(IMPLEMENTATION_LANE_ROLES.length, 12);
assert(IMPLEMENTATION_LANE_ROLES.every(({display_name, implementation_files}) => !display_name.includes("AgentOS") && implementation_files.length === 2 && implementation_files.every((file) => file.endsWith(".mjs"))));
assert.deepEqual(CAMPAIGN_TEAM_ROLES.map(({role}) => role), FOUNDATION_LANE_ROLES.map(({role}) => role));
assert(FOUNDATION_LANE_ROLES.every(({display_name, lane_file}) => !display_name.includes("AgentOS") && lane_file.endsWith(".md")));

const plan = compileNativeCampaignTeamPlan({
  teamId: "TEAM-1",
  projectId: "project-context",
  campaignId: "CAMPAIGN-1",
  campaignVersion: "v1",
  sourceCommit: COMMIT,
  sourceTree: TREE,
});
assert.equal(plan.model, "gpt-5.6-luna");
assert.equal(plan.reasoning_effort, "max");
assert.equal(plan.parent_child_relationship, false);
assert.equal(plan.subagents_allowed, false);
assert.equal(plan.shell_workers_allowed, false);
assert.equal(plan.local_daemons_allowed, false);
assert.equal(plan.roles.length, 12);

const implementationPlan = compileNativeImplementationTeamPlan({
  teamId: "TEAM-1",
  projectId: "project-context",
  campaignId: "CAMPAIGN-1",
  campaignVersion: "v1",
  sourceCommit: COMMIT,
  sourceTree: TREE,
});
assert.equal(implementationPlan.phase, "IMPLEMENT_FOUNDATION_LANES");
assert.equal(implementationPlan.roles.length, 12);
assert.equal(implementationPlan.write_scopes.length, 12);
assert.equal(implementationPlan.required_tools.includes("set_thread_pinned"), true);
assert(implementationPlan.roles.every((request) => request.worktree_mode === "PROJECT_LOCAL_SESSION" && request.lane_file === null));

const IMPLEMENTATION_TASK_ID = ["00000000", "0000", "4000", "8000", "000000000003"].join("-");
const IMPLEMENTATION_TURN_ID = ["00000000", "0000", "4000", "8000", "000000000004"].join("-");
const IMPLEMENTATION_PATHS = ["control/rapid-prototype/functionality.mjs", "tests/rapid-prototype/functionality.mjs"];
const implementationHostReceipts = {
  create_thread: {thread_id: IMPLEMENTATION_TASK_ID, host_id: "local"},
  pin: {thread_id: IMPLEMENTATION_TASK_ID, pinned: true},
  send: {thread_id: IMPLEMENTATION_TASK_ID},
  wait: {thread_id: IMPLEMENTATION_TASK_ID, host_id: "local", timed_out: false, wake: {thread_id: IMPLEMENTATION_TASK_ID, host_id: "local", reason: "turnCompleted", turn_id: IMPLEMENTATION_TURN_ID}},
  read: {thread_id: IMPLEMENTATION_TASK_ID, host_id: "local", status: "completed"},
  unpin: {thread_id: IMPLEMENTATION_TASK_ID, pinned: false},
  archive: {thread_id: IMPLEMENTATION_TASK_ID, archived: true},
  post_close_read: {thread_id: IMPLEMENTATION_TASK_ID, host_id: "local", status: "notLoaded"},
  active_list_absent: true,
};
const implementationHandoff = compileNativeImplementationLaneHandoff({
  laneRole: "IMPLEMENTATION_FUNCTIONALITY",
  taskId: IMPLEMENTATION_TASK_ID,
  hostId: "local",
  projectRoot: "/saved/project",
  cwd: "/saved/project",
  gitTopLevel: "/saved/project",
  sourceCommit: COMMIT,
  sourceTree: TREE,
  result: "ALREADY_SATISFIES_CONTRACT",
  changedPaths: [],
  pathSha256: { [IMPLEMENTATION_PATHS[0]]: "a".repeat(64), [IMPLEMENTATION_PATHS[1]]: "b".repeat(64) },
  focusedTest: {command: `node ${IMPLEMENTATION_PATHS[1]}`, result: "PASS", exit_code: 0},
  hostileCoverage: ["wrong role", "unverified source", "missing session"],
  hostReceipts: implementationHostReceipts,
  protectedActions: {published: false, pushed: false, merged: false, deployed: false, spent: false, revealed_secrets: false, deleted: false},
});
assert.equal(implementationHandoff.schema, NATIVE_IMPLEMENTATION_LANE_HANDOFF_SCHEMA);
assert.equal(validateNativeImplementationLaneHandoff(implementationHandoff).model, "gpt-5.6-luna");
assert.throws(() => validateNativeImplementationLaneHandoff({...implementationHandoff, model: "gpt-5.5"}), /digest mismatch|profile differs/u);
assert.throws(() => validateNativeImplementationLaneHandoff({...implementationHandoff, source_readback: {...implementationHandoff.source_readback, source_commit: "1".repeat(39)} }), /Git object/u);
assert.throws(() => validateNativeImplementationLaneHandoff({...implementationHandoff, path_sha256: {...implementationHandoff.path_sha256, [IMPLEMENTATION_PATHS[0]]: "a".repeat(63)} }), /SHA-256/u);
assert.throws(() => validateNativeImplementationLaneHandoff({...implementationHandoff, host_receipts: {...implementationHandoff.host_receipts, archive: {thread_id: IMPLEMENTATION_TASK_ID, archived: false}}}), /archive receipt/u);

const request = plan.roles.find(({role}) => role === "FOUNDATION_FUNCTIONALITY");
assert.equal(request.display_name, "Functionality");
assert.equal(request.lane_file, "docs/rapid-foundations/06-functionality.md");
assert.equal(request.model, "gpt-5.6-luna");
assert.equal(request.reasoning_effort, "max");
assert.deepEqual(request.required_tools, NATIVE_SESSION_TOOLS);
assert.match(request.prompt, /TASK GATES \(/u);
assert.match(request.prompt, /TASK-START-001 .*Is there exactly one observable behavior being changed\?/u);
assert.equal(Object.keys(request.task_gate_question_ids_by_context).length, 6);

const pending = compileNativeSessionSpawnReadback({
  request,
  status: "SETUP_PENDING",
  clientThreadId: CLIENT_THREAD,
  observedAtUtc: NOW,
});
assert.equal(pending.thread_id, null);
assert.equal(pending.client_thread_id, CLIENT_THREAD);
assert.throws(() => validateNativeSessionSpawnReadback({...pending, thread_id: THREAD_ID}, {request}), /setup-pending/u);

const bound = compileNativeSessionSpawnReadback({
  request,
  status: "THREAD_BOUND",
  clientThreadId: CLIENT_THREAD,
  threadId: THREAD_ID,
  hostId: "local",
  worktreePath: "isolated/feature-agent",
  sourceCommit: COMMIT,
  sourceTree: TREE,
  hostModel: request.model,
  hostReasoningEffort: request.reasoning_effort,
  observedAtUtc: NOW,
});
assert.equal(bound.thread_id, THREAD_ID);
assert.equal(bound.model, "gpt-5.6-luna");
assert.equal(bound.host_model, "gpt-5.6-luna");
assert.equal(bound.host_reasoning_effort, "max");
const wrongName = structuredClone(bound);
wrongName.display_name = "Unexpected Functionality";
assert.throws(() => validateNativeSessionSpawnReadback(wrongName, {request}), /wrong display name|readback digest mismatch/u);
assert.throws(() => compileNativeSessionSpawnRequest({
  teamId: "TEAM-1",
  projectId: "project-context",
  campaignId: "CAMPAIGN-1",
  campaignVersion: "v1",
  role: "FOUNDATION_FUNCTIONALITY",
  task: "Build the bounded change.",
  prompt: "Work in scope.",
  sourceCommit: COMMIT,
  sourceTree: TREE,
  tools: ["create_thread"],
}), /tooling is incomplete/u);
assert.throws(() => createLocalSelfDevelopmentAdapters({}), /NATIVE_SESSION_TOOLING_REQUIRED/u);

const calls = [];
function makeHost({createResult = null} = {}) {
  return {
    async create_thread(payload) {
      calls.push(["create_thread", structuredClone(payload)]);
      return createResult ?? {
        status: "THREAD_BOUND",
        clientThreadId: CLIENT_THREAD,
        threadId: THREAD_ID,
        hostId: "local",
        projectId: "project-context",
        model: payload.model,
        reasoningEffort: payload.thinking,
        worktreePath: "synthetic-worktree",
        worktreeInitialized: true,
        sourceCommit: COMMIT,
        sourceTree: TREE,
        active: true,
        archived: false,
      };
    },
    async list_threads(payload) {
      calls.push(["list_threads", structuredClone(payload)]);
      return {status: "LISTED", active_roster: []};
    },
    async read_thread(payload) {
      calls.push(["read_thread", structuredClone(payload)]);
      return {threadId: payload.threadId, hostId: payload.hostId, status: "READ"};
    },
    async send_message_to_thread(payload) {
      calls.push(["send_message_to_thread", structuredClone(payload)]);
      return {threadId: payload.threadId, hostId: payload.hostId, status: "SENT"};
    },
    async wait_threads(payload) {
      calls.push(["wait_threads", structuredClone(payload)]);
      return {threadId: payload.targets[0].threadId, hostId: payload.targets[0].hostId, status: "WAITED"};
    },
    async set_thread_pinned(payload) {
      calls.push(["set_thread_pinned", structuredClone(payload)]);
      return {threadId: payload.threadId, hostId: payload.hostId, pinned: payload.pinned, status: "PINNED"};
    },
    async set_thread_archived(payload) {
      calls.push(["set_thread_archived", structuredClone(payload)]);
      return {threadId: payload.threadId, hostId: payload.hostId, archived: payload.archived, status: "ARCHIVED"};
    },
  };
}

assert.throws(() => validateNativeSessionHostCapabilities({}), (error) => error.code === "NATIVE_SESSION_TOOLING_UNAVAILABLE");
const disappearingHost = makeHost();
const disappearingTeam = createNativeSessionTeam({host: disappearingHost, hostAttachment, projectId: "project-context", now: () => NOW});
const disappearingSpawn = await disappearingTeam.spawn(request);
delete disappearingHost.read_thread;
await assert.rejects(() => disappearingTeam.readback(disappearingSpawn.session), (error) => error.code === "NATIVE_SESSION_TOOLING_UNAVAILABLE");
assert.deepEqual(compileNativeSessionHostSpawnPayload(request), {
  target: {type: "project", projectId: "project-context", environment: {type: "local"}},
  title: "Functionality",
  prompt: request.prompt,
  model: request.model,
  thinking: "max",
});
const isolatedRequest = compileNativeSessionSpawnRequest({
  teamId: "TEAM-1", projectId: "project-context", campaignId: "CAMPAIGN-1", campaignVersion: "v1",
  role: "FOUNDATION_UI_UX", sourceCommit: COMMIT, sourceTree: TREE, worktreeMode: "ISOLATED_WORKTREE",
});
assert.deepEqual(compileNativeSessionHostSpawnPayload(isolatedRequest).target, {
  type: "project", projectId: "project-context", environment: {type: "worktree"},
}, "isolated worktree mode must remain explicit");
const mismatchedWorkspaceHost = makeHost({createResult: {
  status: "THREAD_BOUND", threadId: THREAD_ID, hostId: "local", projectId: "project-context", model: request.model,
  reasoningEffort: request.reasoning_effort, worktreePath: "/synthetic/host-boundary",
  cwd: "/synthetic/host-boundary",
  gitTopLevel: "/synthetic/host-boundary",
  worktreeInitialized: true, sourceCommit: COMMIT, sourceTree: TREE,
}});
const mismatchedWorkspaceTeam = createNativeSessionTeam({
  host: mismatchedWorkspaceHost,
  hostAttachment,
  projectId: "project-context",
  projectBinding: {project_id: "project-context", cwd: "/saved/project", git_top_level: "/saved/project"},
  now: () => NOW,
});
await assert.rejects(
  () => mismatchedWorkspaceTeam.spawn(request),
  (error) => error.code === "INVALID_HOST_READBACK" && /wrong project cwd|wrong project Git top level/u.test(error.cause?.message ?? ""),
  "a project-local task must reject an out-of-bound host cwd",
);

calls.length = 0;
const identityUnavailableHost = makeHost({createResult: {
  status: "THREAD_BOUND", threadId: THREAD_ID, hostId: "local", projectId: "project-context",
  worktreePath: "synthetic-worktree", worktreeInitialized: true, sourceCommit: COMMIT, sourceTree: TREE,
}});
const identityUnavailableTeam = createNativeSessionTeam({
  host: identityUnavailableHost,
  hostAttachment,
  projectId: "project-context",
  teamId: "TEAM-1",
  campaignId: "CAMPAIGN-1",
  campaignVersion: "v1",
  now: () => NOW,
});
await assert.rejects(
  () => identityUnavailableTeam.spawn(request),
  (error) => error instanceof NativeSessionBoundaryError
    && error.code === "HOST_MODEL_REASONING_READBACK_UNAVAILABLE"
    && error.boundary?.identity_status === "UNAVAILABLE"
    && error.boundary?.requested_model === request.model
    && error.boundary?.requested_reasoning_effort === request.reasoning_effort
    && error.boundary?.host_model === null
    && error.boundary?.host_reasoning_effort === null
    && error.boundary?.acceptance === false
    && error.boundary?.protected_actions_enabled === false,
  "missing host model/reasoning must become an explicit blocked capability",
);
assert.equal(identityUnavailableTeam.roster().length, 0, "missing host identity must not enter the active roster");
assert(calls.some(([name]) => name === "set_thread_archived"), "unverifiable thread must be cleaned up");

const identityMismatchHost = makeHost({createResult: {
  status: "THREAD_BOUND", threadId: THREAD_ID, hostId: "local", projectId: "project-context",
  model: "gpt-5.6-sol", reasoningEffort: "medium", worktreePath: "synthetic-worktree", worktreeInitialized: true,
  sourceCommit: COMMIT, sourceTree: TREE,
}});
const identityMismatchTeam = createNativeSessionTeam({host: identityMismatchHost, hostAttachment, projectId: "project-context", teamId: "TEAM-1", campaignId: "CAMPAIGN-1", campaignVersion: "v1", now: () => NOW});
await assert.rejects(
  () => identityMismatchTeam.spawn(request),
  (error) => error instanceof NativeSessionBoundaryError
    && error.code === "HOST_MODEL_REASONING_MISMATCH"
    && error.boundary?.identity_status === "MISMATCH"
    && error.boundary?.requested_model === request.model
    && error.boundary?.host_model === "gpt-5.6-sol"
    && error.boundary?.requested_reasoning_effort === request.reasoning_effort
    && error.boundary?.host_reasoning_effort === "medium"
    && error.boundary?.acceptance === false,
  "host model/reasoning mismatch must be a typed non-accepting failure",
);
assert.equal(identityMismatchTeam.roster().length, 0);

const unavailableBoundary = compileNativeSessionHostIdentityBoundary({
  request,
  hostModel: null,
  hostReasoningEffort: "UNKNOWN",
  missingHostFields: ["model", "reasoning_effort"],
  reason: "host identity is not exposed",
  observedAtUtc: NOW,
});
assert.doesNotThrow(() => validateNativeSessionHostIdentityBoundary(unavailableBoundary, {request}));
assert.throws(() => validateNativeSessionHostIdentityBoundary({...unavailableBoundary, acceptance: true}, {request}), /acceptance/u);
assert.throws(() => validateNativeSessionHostExecutionIdentity({request, value: {model: request.model}, observedAtUtc: NOW}), (error) => error.code === "HOST_MODEL_REASONING_READBACK_UNAVAILABLE");
calls.length = 0;

const team = createNativeSessionTeam({
  host: makeHost(),
  hostAttachment,
  projectId: "project-context",
  teamId: "TEAM-1",
  campaignId: "CAMPAIGN-1",
  campaignVersion: "v1",
  now: () => NOW,
});
const spawned = await team.spawn(request);
assert.equal(spawned.status, "THREAD_BOUND");
assert.equal(spawned.session.pinned, false);
assert.equal(team.roster().length, 1);
const pinned = await team.pin(spawned.session);
assert.equal(pinned.session.pinned, true);
assert.equal(team.roster()[0].pinned, true);
const sent = await team.send(pinned.session, "Continue with the bounded work.");
assert.equal(sent.readback.status, "COMPLETED");
const observed = await team.readback(pinned.session);
assert.equal(observed.readback.operation, "READBACK");
const waited = await team.wait(pinned.session, 1000);
assert.equal(waited.readback.operation, "WAIT");
const sentAndRead = await team.sendAndReadback(pinned.session, "Return the current typed handoff.");
assert.equal(sentAndRead.readback.readback.operation, "READBACK");
const closed = await team.close(pinned.session, {schema: "synthetic.typed_handoff.v1", status: "READY"});
assert.equal(closed.status, "CLOSED");
assert.deepEqual(closed.receipt.lifecycle, [...NATIVE_SESSION_CLOSURE_LIFECYCLE]);
assert.equal(team.roster().length, 0, "closed session must leave no active roster entry");
assert.equal(calls.filter(([operation]) => operation === "set_thread_pinned").length, 2, "closure must unpin exactly once after the initial pin");
assert.equal(calls.filter(([operation]) => operation === "set_thread_archived").length, 1);
assert.doesNotThrow(() => validateNativeSessionClosureReceipt(closed.receipt));

const wrongProjectRequest = compileNativeSessionSpawnRequest({
  teamId: "TEAM-1", projectId: "other-project", campaignId: "CAMPAIGN-1", campaignVersion: "v1", role: "FOUNDATION_FUNCTIONALITY",
  sourceCommit: COMMIT, sourceTree: TREE,
});
await assert.rejects(() => team.spawn(wrongProjectRequest), /wrong project binding/u);

const wrongModelRequest = compileNativeSessionSpawnRequest({
  teamId: "TEAM-1", projectId: "project-context", campaignId: "CAMPAIGN-1", campaignVersion: "v1", role: "FOUNDATION_UI_UX",
  sourceCommit: COMMIT, sourceTree: TREE, model: "gpt-5.6-sol",
});
await assert.rejects(() => team.spawn(wrongModelRequest), /wrong model/u);

const wrongReasoningRequest = compileNativeSessionSpawnRequest({
  teamId: "TEAM-1", projectId: "project-context", campaignId: "CAMPAIGN-1", campaignVersion: "v1", role: "FOUNDATION_UI_UX",
  sourceCommit: COMMIT, sourceTree: TREE, reasoningEffort: "high",
});
await assert.rejects(() => team.spawn(wrongReasoningRequest), /wrong reasoning effort/u);

const staleRequest = compileNativeSessionSpawnRequest({
  teamId: "TEAM-1", projectId: "project-context", campaignId: "CAMPAIGN-1", campaignVersion: "v1", role: "FOUNDATION_UI_UX",
  sourceCommit: COMMIT, sourceTree: TREE,
});
await assert.rejects(() => team.spawn(staleRequest, {predecessor: closed.removal.session}), /STALE_PREDECESSOR|stale/u);

const failedTeam = createNativeSessionTeam({
  host: makeHost({createResult: {
    status: "WORKTREE_FAILED",
    clientThreadId: CLIENT_THREAD,
    worktreeInitialized: false,
    error: "synthetic setup failure",
  }}),
  hostAttachment,
  projectId: "project-context",
  teamId: "TEAM-1",
  campaignId: "CAMPAIGN-1",
  campaignVersion: "v1",
  now: () => NOW,
});
await assert.rejects(() => failedTeam.spawn(staleRequest), (error) => error instanceof NativeSessionBoundaryError && error.code === "WORKTREE_INITIALIZATION_FAILED" && error.readback?.status === "FAILED");
assert.equal(failedTeam.roster().length, 0, "failed worktree initialization must not leak a roster entry");

const duplicateArchiveTeam = createNativeSessionTeam({
  host: makeHost(), hostAttachment, projectId: "project-context", teamId: "TEAM-1", campaignId: "CAMPAIGN-1", campaignVersion: "v1", now: () => NOW,
});
const duplicateArchiveSpawn = await duplicateArchiveTeam.spawn(staleRequest);
const archived = await duplicateArchiveTeam.archive(duplicateArchiveSpawn.session);
await assert.rejects(() => duplicateArchiveTeam.archive(archived.session), /DUPLICATE_ARCHIVE|already archived/u);
await duplicateArchiveTeam.removeFromRoster(archived.session);
assert.equal(duplicateArchiveTeam.roster().length, 0);

const leakHost = makeHost();
leakHost.list_threads = async () => ({threads: [{threadId: THREAD_ID, hostId: "local", archived: false, pinned: false, active: true}]});
const leakTeam = createNativeSessionTeam({
  host: leakHost, hostAttachment, projectId: "project-context", teamId: "TEAM-1", campaignId: "CAMPAIGN-1", campaignVersion: "v1", now: () => NOW,
});
const leakSpawn = await leakTeam.spawn(staleRequest);
const leakArchived = await leakTeam.archive(leakSpawn.session);
await assert.rejects(() => leakTeam.removeFromRoster(leakArchived.session), /active session|ROSTER_NOT_REMOVED/u);
assert.equal(leakTeam.roster().length, 1, "host roster leak must keep the local roster entry for repair");

const shellTeam = createNativeSessionTeam({
  host: makeHost({createResult: {
    status: "THREAD_BOUND", threadId: "shell output: fake", hostId: "local", projectId: "project-context", model: "gpt-5.6-luna",
    reasoningEffort: "max", worktreePath: "synthetic-worktree", worktreeInitialized: true, sourceCommit: COMMIT, sourceTree: TREE,
  }}),
  hostAttachment,
  projectId: "project-context", teamId: "TEAM-1", campaignId: "CAMPAIGN-1", campaignVersion: "v1", now: () => NOW,
});
await assert.rejects(() => shellTeam.spawn(staleRequest), (error) => error.code === "INVALID_HOST_READBACK");
assert.equal(shellTeam.roster().length, 0, "fabricated or shell-derived IDs must not enter the roster");

const duplicateRoster = [spawned.session, spawned.session];
assert.throws(() => createNativeSessionTeam({host: makeHost(), hostAttachment, projectId: "project-context", activeRoster: duplicateRoster}), /duplicate session/u);

console.log("PASS native session team: typed host lifecycle, Luna/max defaults, exact identity binding, fail-closed capability checks, closure, and hostile coverage");
