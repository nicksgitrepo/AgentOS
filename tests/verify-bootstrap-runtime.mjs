#!/usr/bin/env node

import assert from "node:assert/strict";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {compileBootstrapPlan} from "../control/bootstrap-plan.mjs";
import {createBootstrapRuntime} from "../control/bootstrap-runtime.mjs";
import {compileCampaignAdmission, toNativeAdmission} from "../control/campaign-admission.mjs";
import {createGoal} from "../control/campaign-state.mjs";
import {digestWithout} from "../control/canonical-json.mjs";
import {createOwnerContinuation} from "../control/owner-continuation.mjs";
import {parseOwnerAnswer, renderOwnerQuestion} from "../control/owner-conversation.mjs";
import {compileHostWorkerBoundary} from "../control/host-worker-boundary.mjs";
import {compileWorkspaceBoundary} from "../control/workspace-boundary.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspace_boundary = compileWorkspaceBoundary({
  release_root: "/workspace/AgentOS",
  projects_root: "/workspace/projects",
  project_root: "/workspace/projects/example-project",
  control_root: "/workspace/AgentOS-control",
});
const source = {
  source_commit: "a".repeat(40),
  source_tree: "b".repeat(40),
  worktree_id: "WORKTREE-001",
  environment_id: "ENV-001",
};
const bootstrapPlan = await compileBootstrapPlan(ROOT, {
  project_id: "PROJECT-001",
  owner_context: {objective: "Build a bounded release control check"},
  source_binding: {...source, bootstrap_session_id: "BOOTSTRAP-001"},
  workspace_boundary,
});
const goal = createGoal({
  goal_id: "GOAL-001",
  objective: "Build a bounded release control check",
  scope: {lane: "bootstrap-context"},
  intent: {outcome: "verified"},
  boundaries: {hard: ["no product writes"], soft: ["local only"]},
  created_at_utc: "2026-01-01T00:00:00.000Z",
});
const admission = compileCampaignAdmission({
  plan: bootstrapPlan,
  goal,
  project_id: "PROJECT-001",
  campaign_id: "CAMPAIGN-001",
  campaign_version: "V1",
  lane_id: "bootstrap-context",
  source,
  task_name: "bootstrap_context_worker_001",
  prompt: "Run the admitted release control check and return a typed handoff.",
});
const nativeAdmission = toNativeAdmission(admission);
const hostWorkerBoundary = compileHostWorkerBoundary({
  worker_id: "WORKER-RELEASE-CONTROL-001",
  worker_scope: "RELEASE_CONTROL",
  workspace_mode: "HOST_MANAGED_VISIBLE",
  source_root_kind: "RELEASE",
  host_project_id: "REGISTERED-RELEASE-PROJECT",
  host_project_role: "RELEASE",
  campaign_project_id: "PROJECT-001",
  source_binding: {source_commit: source.source_commit, source_tree: source.source_tree, source_ref: "v2.1.0-rc.5"},
  workspace_boundary,
  protected_actions: ["PUSH", "MERGE"],
  workspace_path: "/host/ephemeral/release-worker",
});
const surface = renderOwnerQuestion({
  question_id: "OWNER.LAUNCH",
  prompt: "Would you like me to begin the local check now?",
  choices: [
    {value: "START_LOCAL_CAMPAIGN", label: "Begin the local check"},
    {value: "KEEP_PREPARED", label: "Keep it prepared"},
  ],
});
const answer = parseOwnerAnswer(surface, "1");
const continuation = createOwnerContinuation({
  activation_id: "ACTIVATION-001",
  project_id: "PROJECT-001",
  campaign_id: "CAMPAIGN-001",
  campaign_version: "V1",
  goal_id: "GOAL-001",
  question_id: surface.question_id,
  expected_value: "START_LOCAL_CAMPAIGN",
  protected_actions: ["PUSH", "MERGE"],
});

function makeHost() {
  const calls = [];
  return {
    calls,
    async create_thread(input) {
      calls.push(["CREATE", input]);
      return {
        thread_id: "THREAD-001",
        host_id: "HOST-001",
        project_id: input.identity.project_id,
        campaign_id: input.identity.campaign_id,
        campaign_version: input.identity.campaign_version,
        goal_id: input.identity.goal_id,
        lane_id: input.identity.lane_id,
        role_id: input.identity.role_id,
        source_commit: input.identity.source_commit,
        source_tree: input.identity.source_tree,
        worktree_id: input.identity.worktree_id,
      };
    },
    async list_threads() { calls.push(["LIST"]); return {threads: []}; },
    async read_thread() { calls.push(["READ"]); throw new Error("not used in route integration"); },
    async wait_threads() { calls.push(["WAIT"]); throw new Error("not used in route integration"); },
    async send_message_to_thread() { calls.push(["SEND"]); throw new Error("not used in route integration"); },
    async set_thread_pinned(input) { calls.push([input.pinned ? "PIN" : "UNPIN"]); return {pinned: input.pinned}; },
    async set_thread_archived() { calls.push(["ARCHIVE"]); return {archived: true}; },
  };
}

const host = makeHost();
let admissionCalls = 0;
const runtime = createBootstrapRuntime({
  host,
  admitCampaign: async (request) => {
    admissionCalls += 1;
    assert.equal(request.project_id, nativeAdmission.project_id);
    assert.equal(request.owner_answer.value, "START_LOCAL_CAMPAIGN");
    return {admission: nativeAdmission, host_worker_boundary: hostWorkerBoundary};
  },
});
const [first, second] = await Promise.all([
  runtime.recordOwnerAnswer(continuation, answer),
  runtime.recordOwnerAnswer(continuation, answer),
]);
assert.equal(first.status, "RESUMED");
assert.deepEqual(second, first);
assert.equal(admissionCalls, 1);
assert.equal(host.calls.filter(([name]) => name === "CREATE").length, 1);
assert.equal(host.calls[0][1].host_worker_boundary.digest, hostWorkerBoundary.digest);
assert.equal(host.calls[0][1].host_worker_boundary.host_project_role, "RELEASE");

const badBoundary = {...hostWorkerBoundary, worker_scope: "PRODUCT", digest: null};
badBoundary.digest = digestWithout(badBoundary, "digest");
const hostileHost = makeHost();
const hostileRuntime = createBootstrapRuntime({
  host: hostileHost,
  admitCampaign: async () => ({admission: nativeAdmission, host_worker_boundary: badBoundary}),
});
const blocked = await hostileRuntime.recordOwnerAnswer(continuation, answer);
assert.equal(blocked.status, "BLOCKED");
assert.equal(blocked.failure.code, "ADMISSION_RESUME_FAILED");
assert.equal(hostileHost.calls.filter(([name]) => name === "CREATE").length, 0);

console.log(JSON.stringify({status: "PASS", continuation: first.status, admission_calls: admissionCalls, create_calls: host.calls.filter(([name]) => name === "CREATE").length, hostile_spawn_calls: hostileHost.calls.filter(([name]) => name === "CREATE").length}));
