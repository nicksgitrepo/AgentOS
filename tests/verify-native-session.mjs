#!/usr/bin/env node

import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {sha256} from "../control/canonical-json.mjs";
import {abortNativeSession, closeNativeSession, DEFAULT_MODEL, DEFAULT_REASONING_EFFORT, readMeaningfulProgress, REQUIRED_HOST_ACTIONS, spawnNativeSession} from "../control/native-session.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
void ROOT;
const admission = {
  project_id: "PROJECT-001",
  campaign_id: "CAMPAIGN-001",
  campaign_version: "CAMPAIGN-V1",
  goal_id: "GOAL-001",
  goal_sha256: "a".repeat(64),
  lane_id: "functionality",
  role_id: "NAMED_LANE_WORKER",
  role_display_name: "functionality Worker",
  source_commit: "b".repeat(40),
  source_tree: "c".repeat(40),
  worktree_id: "WORKTREE-001",
  governance_digest: "d".repeat(64),
  task_name: "functionality_worker_001",
  prompt: "Build the admitted functionality lane and return a typed handoff.",
};

function makeHost({wrongSource = false, wrongThread = false, wrongHandoff = false} = {}) {
  const calls = [];
  const threads = new Map();
  let sequence = 0;
  return {
    calls,
    async create_thread(input) {
      calls.push(["CREATE", input]);
      sequence += 1;
      const thread = {
        thread_id: `THREAD-${String(sequence).padStart(3, "0")}`,
        host_id: `HOST-${String(sequence).padStart(3, "0")}`,
        project_id: input.identity.project_id,
        campaign_id: input.identity.campaign_id,
        campaign_version: input.identity.campaign_version,
        goal_id: input.identity.goal_id,
        lane_id: input.identity.lane_id,
        role_id: input.identity.role_id,
        source_commit: wrongSource ? "e".repeat(40) : input.identity.source_commit,
        source_tree: input.identity.source_tree,
        worktree_id: input.identity.worktree_id,
        pinned: false,
        archived: false,
        active: true,
        progress: {result_type: "VERIFIED_BEHAVIOR", summary: "The behavior was observed", artifact_sha256: "f".repeat(64), evidence_sha256: "1".repeat(64)},
        handoff: null,
      };
      threads.set(thread.thread_id, thread);
      return Object.fromEntries(Object.entries(thread).filter(([key]) => ["thread_id", "host_id", "project_id", "campaign_id", "campaign_version", "goal_id", "lane_id", "role_id", "source_commit", "source_tree", "worktree_id"].includes(key)));
    },
    async list_threads() { calls.push(["LIST"]); return {threads: [...threads.values()].filter((thread) => thread.active)}; },
    async read_thread(input) {
      calls.push([input.view === "handoff" ? "READ_HANDOFF" : "READ_PROGRESS"]);
      const thread = threads.get(input.thread_id);
      if (!thread) throw new Error("thread missing");
      const identity = Object.fromEntries(["thread_id", "host_id", "project_id", "campaign_id", "campaign_version", "goal_id", "lane_id", "role_id", "source_commit", "source_tree", "worktree_id"].map((key) => [key, thread[key]]));
      if (wrongThread) { identity.thread_id = "THREAD-WRONG"; identity.host_id = "HOST-WRONG"; }
      const handoff = wrongHandoff ? {...thread.handoff, artifact_sha256: "4".repeat(64), evidence_sha256: "5".repeat(64)} : thread.handoff;
      return input.view === "handoff" ? {...identity, handoff} : {...identity, progress: thread.progress};
    },
    async wait_threads(input) { calls.push(["WAIT", input]); return {threads: input.targets}; },
    async send_message_to_thread(input) { calls.push(["SEND"]); const thread = threads.get(input.thread_id); thread.handoff = {summary: "The admitted behavior is complete", result_type: "VERIFIED_BEHAVIOR", artifact_sha256: "2".repeat(64), evidence_sha256: "3".repeat(64)}; },
    async set_thread_pinned(input) { calls.push([input.pinned ? "PIN" : "UNPIN"]); const thread = threads.get(input.thread_id); thread.pinned = input.pinned; return {pinned: input.pinned}; },
    async set_thread_archived(input) { calls.push(["ARCHIVE"]); const thread = threads.get(input.thread_id); thread.archived = input.archived; return {archived: input.archived}; },
    async remove_from_active_roster(input) { calls.push(["ROSTER_REMOVE"]); const thread = threads.get(input.thread_id); thread.active = false; threads.delete(input.thread_id); return {active_roster_removed: true}; },
  };
}

const host = makeHost();
const session = await spawnNativeSession(host, admission);
assert.equal(session.model, DEFAULT_MODEL);
assert.equal(session.reasoning_effort, DEFAULT_REASONING_EFFORT);
assert.equal(host.calls[0][0], "CREATE");
assert.deepEqual(host.calls[0][1].model, DEFAULT_MODEL);
const progress = await readMeaningfulProgress(host, session);
assert.equal(progress.result_type, "VERIFIED_BEHAVIOR");
const closed = await closeNativeSession(host, session, {summary: "The admitted behavior is complete", result_type: "VERIFIED_BEHAVIOR", artifact_sha256: "2".repeat(64), evidence_sha256: "3".repeat(64)});
assert.equal(closed.session.status, "CLOSED");
assert.deepEqual(closed.closure.order.slice(0, 3), ["UNPIN", "ARCHIVE", "ROSTER_REMOVE"]);
assert.equal(host.calls.filter(([name]) => name === "LIST").length >= 1, true);

const badHost = makeHost({wrongSource: true});
await assert.rejects(() => spawnNativeSession(badHost, admission), /source_commit differs/u);
assert.deepEqual(badHost.calls.map(([name]) => name), ["CREATE", "UNPIN", "ARCHIVE", "ROSTER_REMOVE", "LIST"]);

const wrongReadHost = makeHost({wrongThread: true});
const wrongReadSession = await spawnNativeSession(wrongReadHost, admission);
await assert.rejects(() => readMeaningfulProgress(wrongReadHost, wrongReadSession), /differs from active session/u);

const wrongHandoffHost = makeHost({wrongHandoff: true});
const wrongHandoffSession = await spawnNativeSession(wrongHandoffHost, admission);
await assert.rejects(() => closeNativeSession(wrongHandoffHost, wrongHandoffSession, {summary: "The admitted behavior is complete", result_type: "VERIFIED_BEHAVIOR", artifact_sha256: "2".repeat(64), evidence_sha256: "3".repeat(64)}), /differs from the requested handoff/u);

const missing = makeHost();
delete missing.remove_from_active_roster;
await assert.rejects(() => spawnNativeSession(missing, admission), /remove_from_active_roster/u);

const abortHost = makeHost();
const abortSession = await spawnNativeSession(abortHost, admission);
const aborted = await abortNativeSession(abortHost, abortSession, "TEST_ABORT");
assert.equal(aborted.active_roster_removed, true);

assert.equal(REQUIRED_HOST_ACTIONS.length, 8);
assert.equal(sha256({model: DEFAULT_MODEL, reasoning_effort: DEFAULT_REASONING_EFFORT}).length, 64);
console.log(JSON.stringify({status: "PASS", required_host_actions: REQUIRED_HOST_ACTIONS.length, closure_order: closed.closure.order}));
