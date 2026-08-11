#!/usr/bin/env node

import assert from "node:assert/strict";
import {compileNativeCampaignTeamPlan} from "../control/native-session-team.mjs";
import {runNativeSessionTeam} from "../control/native-session-runner.mjs";
import {compileNativeHostAttachment} from "../control/native-host-attachment.mjs";
import {scanPersistedRecord} from "../control/persisted-record-privacy.mjs";
import {compileDigestBoundCheckpoint} from "../control/repair-governance.mjs";
import {TASK_GATE_CATALOG_SHA256, TASK_GATE_CONTEXTS, taskGateQuestionsFor} from "../control/task-gate-questions.mjs";

const COMMIT = "1".repeat(40);
const TREE = "2".repeat(40);
const NOW = "2026-08-04T12:00:00.000Z";
const sourceBinding = {
  project_id: "public-project",
  cwd: "public-project",
  git_top_level: "public-project",
  source_commit: COMMIT,
  source_tree: TREE,
};
const checkpoint = compileDigestBoundCheckpoint({
  checkpointId: "CHECKPOINT-RUNNER-1",
  commit: COMMIT,
  tree: TREE,
  evidenceSha256: "a".repeat(64),
  candidateSha256: "b".repeat(64),
});
const plan = compileNativeCampaignTeamPlan({
  teamId: "TEAM-RUNNER-1",
  projectId: sourceBinding.project_id,
  campaignId: "CAMPAIGN-RUNNER-1",
  campaignVersion: "v1",
  sourceCommit: COMMIT,
  sourceTree: TREE,
  model: "gpt-5.6-luna",
  reasoningEffort: "max",
});
const hostAttachment = compileNativeHostAttachment({
  attachmentId: "ATTACHMENT-RUNNER-1",
  hostId: "test-host",
  projectId: sourceBinding.project_id,
  environmentId: "local-test",
  attachedAtUtc: NOW,
  model: "gpt-5.6-luna",
  reasoningEffort: "max",
});
const makeThreadId = (index) => ["00000000", "0000", "4000", "8000", String(index + 1).padStart(12, "0")].join("-");
const threadForRole = new Map(plan.roles.map((request, index) => [request.role, makeThreadId(index)]));
const calls = [];
const activeThreads = new Set();
function taskGateAnswersFor({threadId, role, worktreePath, buildIdentity}) {
  const goalSha = "c".repeat(64);
  return Object.fromEntries(TASK_GATE_CONTEXTS.map((context) => [context, Object.fromEntries(taskGateQuestionsFor(context).map((question) => [question.question_id, {
    answer: question.pass_answer,
    evidence: Object.fromEntries(question.required_evidence.map((evidenceKey) => [evidenceKey, {
      evidence_key: evidenceKey,
      question_id: question.question_id,
      source_commit: COMMIT,
      source_tree: TREE,
      worktree_id: worktreePath,
      session_id: threadId,
      goal_id: "GOAL-" + role,
      goal_sha256: goalSha,
      build_identity: buildIdentity,
      environment_id: "local-test",
      observed_at_utc: NOW,
      result_sha256: "b".repeat(64),
      status: "PASS",
    }])),
    failure: null,
    recheck: null,
  }]))]));
}
const host = {
  async create_thread(input) {
    calls.push(["create_thread", input]);
    const role = plan.roles.find(({display_name}) => display_name === input.title)?.role;
    const threadId = threadForRole.get(role);
    activeThreads.add(threadId);
    return {
      thread_id: threadId,
      host_id: "test-host",
      campaign_id: plan.campaign_id,
      campaign_version: plan.campaign_version,
      model: input.model,
      reasoning_effort: input.thinking,
      worktree_path: `worktrees/${role.toLocaleLowerCase()}`,
      build_identity: `build-${role.toLocaleLowerCase()}`,
      environment_id: "local-test",
      ...sourceBinding,
    };
  },
  async list_threads() {
    calls.push(["list_threads"]);
    return {active_roster: [...activeThreads].map((thread_id) => ({thread_id, host_id: "test-host", active: true, archived: false, pinned: false}))};
  },
  async read_thread(input) {
    calls.push(["read_thread", input]);
    const request = plan.roles.find((candidate) => threadForRole.get(candidate.role) === input.threadId);
    return {
      thread_id: input.threadId,
      host_id: "test-host",
      campaign_id: plan.campaign_id,
      campaign_version: plan.campaign_version,
      role: request.role,
      model: "gpt-5.6-luna",
      reasoning_effort: "max",
      status: "COMPLETED",
      pinned: true,
      archived: false,
      ...sourceBinding,
      worktree_path: `worktrees/${request.role.toLocaleLowerCase()}`,
      build_identity: `build-${request.role.toLocaleLowerCase()}`,
      environment_id: "local-test",
    };
  },
  async send_message_to_thread(input) { calls.push(["send_message_to_thread", input]); const request = plan.roles.find((candidate) => threadForRole.get(candidate.role) === input.threadId); return {status: "SENT", thread_id: input.threadId, host_id: "test-host", campaign_id: plan.campaign_id, campaign_version: plan.campaign_version, role: request.role, model: "gpt-5.6-luna", reasoning_effort: "max", ...sourceBinding, ok: true}; },
  async set_thread_archived(input) { calls.push(["set_thread_archived", input]); if (input.archived) activeThreads.delete(input.threadId); const request = plan.roles.find((candidate) => threadForRole.get(candidate.role) === input.threadId); return {status: "ARCHIVED", thread_id: input.threadId, host_id: "test-host", campaign_id: plan.campaign_id, campaign_version: plan.campaign_version, role: request.role, model: "gpt-5.6-luna", reasoning_effort: "max", ...sourceBinding, archived: input.archived, pinned: false, ok: true}; },
  async set_thread_pinned(input) { calls.push(["set_thread_pinned", input]); const request = plan.roles.find((candidate) => threadForRole.get(candidate.role) === input.threadId); return {status: input.pinned ? "PINNED" : "UNPINNED", thread_id: input.threadId, host_id: "test-host", campaign_id: plan.campaign_id, campaign_version: plan.campaign_version, role: request.role, model: "gpt-5.6-luna", reasoning_effort: "max", ...sourceBinding, pinned: input.pinned, archived: false, ok: true}; },
  async wait_threads(input) {
    calls.push(["wait_threads", input]);
    return {results: input.threadIds.map((threadId) => {
      const request = plan.roles.find((candidate) => threadForRole.get(candidate.role) === threadId);
      return {
        status: "COMPLETED",
        thread_id: threadId,
        host_id: "test-host",
        campaign_id: plan.campaign_id,
        campaign_version: plan.campaign_version,
        role: request.role,
        model: "gpt-5.6-luna",
        reasoning_effort: "max",
        worktree_path: `worktrees/${request.role.toLocaleLowerCase()}`,
        build_identity: `build-${request.role.toLocaleLowerCase()}`,
        environment_id: "local-test",
        ...sourceBinding,
        meaningful_progress: true,
        handoff_sha256: "a".repeat(64),
        result_sha256: "b".repeat(64),
        changed_paths: ["docs/rapid-foundations/lane.md"],
        task_gate_catalog_sha256: TASK_GATE_CATALOG_SHA256,
        task_gate_answers: taskGateAnswersFor({threadId, role: request.role, worktreePath: `worktrees/${request.role.toLocaleLowerCase()}`, buildIdentity: `build-${request.role.toLocaleLowerCase()}`}),
      };
    })};
  },
};

const missingAttachment = await runNativeSessionTeam({plan, host, sourceBinding, checkpoint, observedAtUtc: NOW});
assert.equal(missingAttachment.status, "TEAM_UNAVAILABLE");
assert.match(missingAttachment.error, /NATIVE_HOST_ATTACHMENT_REQUIRED/u);
assert.equal(calls.filter(([name]) => name === "create_thread").length, 0, "missing attachment must not invoke the provider boundary");

const run = await runNativeSessionTeam({plan, host, hostAttachment, sourceBinding, checkpoint, observedAtUtc: NOW});
assert.equal(run.status, "TEAM_COMPLETED");
assert.equal(run.active_roster.length, 0);
assert.equal(run.sessions.length, 12);
assert.match(run.sessions[0].spawn_attestation_sha256, /^[0-9a-f]{64}$/u);
assert.equal(run.privacy.status, "REDACTED");
assert.equal(scanPersistedRecord(run).safe, true, "native session run record must be privacy safe");
assert(!JSON.stringify(run).includes("test-host"), "raw host identity must not leave the runtime record");
assert(!JSON.stringify(run).includes("worktrees/"), "raw worktree path must not leave the runtime record");
assert.equal(calls.find(([name]) => name === "wait_threads")?.[1].timeoutMs, 900000, "native progress review must default to 15 minutes");
assert.equal(calls.filter(([name]) => name === "create_thread").length, 12);
assert.equal(calls.filter(([name]) => name === "set_thread_archived").length, 12);
assert.equal(calls.filter(([name]) => name === "set_thread_pinned").length, 24);

const missingTaskGates = await runNativeSessionTeam({
  plan,
  host: {
    ...host,
    async wait_threads(input) {
      const readback = await host.wait_threads(input);
      for (const result of readback.results) {
        delete result.task_gate_catalog_sha256;
        delete result.task_gate_answers;
      }
      return readback;
    },
  },
  hostAttachment,
  sourceBinding,
  checkpoint,
  observedAtUtc: NOW,
});
assert.equal(missingTaskGates.status, "TEAM_FAILED");
assert.match(missingTaskGates.error, /task-gate/u);
assert.equal(missingTaskGates.active_roster.length, 0);

let createdBeforeFailure = 0;
const partialFailure = await runNativeSessionTeam({
  plan,
  host: {
    ...host,
    async create_thread(input) {
      if (createdBeforeFailure === 1) throw new Error("host stopped creating sessions");
      createdBeforeFailure += 1;
      return host.create_thread(input);
    },
  },
  hostAttachment,
  sourceBinding,
  checkpoint,
  observedAtUtc: NOW,
});
assert.equal(partialFailure.status, "TEAM_FAILED");
assert.equal(partialFailure.active_roster.length, 0, "a partial wave must close the session it did create");

const badHost = {...host, create_thread: async () => ({agent_id: "agent-not-thread"})};
const failed = await runNativeSessionTeam({plan, host: badHost, hostAttachment, sourceBinding, checkpoint, observedAtUtc: NOW});
assert.equal(failed.status, "TEAM_FAILED");
assert.match(failed.error, /thread ID|thread identity|task\/subagent|INVALID_HOST_READBACK/u);

const missingHost = {...host};
delete missingHost.wait_threads;
const missing = await runNativeSessionTeam({plan, host: missingHost, hostAttachment, sourceBinding, checkpoint, observedAtUtc: NOW});
assert.equal(missing.status, "TEAM_UNAVAILABLE");
assert.match(missing.error, /NATIVE_SESSION_TOOLING_REQUIRED|NATIVE_SESSION_TOOLING_UNAVAILABLE/u);

const identityCalls = [];
const identityUnavailableHost = {
  ...host,
  async create_thread(input) {
    const created = await host.create_thread(input);
    delete created.model;
    delete created.reasoning_effort;
    return created;
  },
  async set_thread_pinned(input) {
    identityCalls.push(["pin", input]);
    return host.set_thread_pinned(input);
  },
  async set_thread_archived(input) {
    identityCalls.push(["archive", input]);
    return host.set_thread_archived(input);
  },
};
const identityUnavailable = await runNativeSessionTeam({plan, host: identityUnavailableHost, hostAttachment, sourceBinding, checkpoint, observedAtUtc: NOW});
assert.equal(identityUnavailable.status, "TEAM_COMPLETED");
assert.equal(identityUnavailable.active_roster.length, 0);
assert(identityCalls.some(([name]) => name === "archive"), "runner must close a thread whose host execution identity is unavailable");

console.log("PASS native session runner: real UUID thread boundary, Luna/max progress, source readback, partial cleanup, archive, roster closure, and fail-closed cases verified");
