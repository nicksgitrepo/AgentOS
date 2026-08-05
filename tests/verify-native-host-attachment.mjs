#!/usr/bin/env node

import assert from "node:assert/strict";
import {compileHostAttachment, bindNativeHost, validateHostAttachment} from "../control/native-host-attachment.mjs";
import {loadNativeHostAdapter} from "../control/native-host-loader.mjs";
import {REQUIRED_HOST_ACTIONS} from "../control/native-session.mjs";

const attachment = compileHostAttachment({attachment_id: "ATTACHMENT-001", host_id: "HOST-001", project_id: "PROJECT-001", environment_id: "ENV-001", attached_at_utc: "2026-01-01T00:00:00.000Z"});
assert.equal(validateHostAttachment(attachment).digest, attachment.digest);
const calls = [];
const host = Object.fromEntries(REQUIRED_HOST_ACTIONS.map((action) => [action, async (payload) => {
  calls.push({action, payload});
  if (action === "create_thread") return {thread_id: "THREAD-001", host_id: "HOST-THREAD-001", project_id: payload.identity.project_id, campaign_id: payload.identity.campaign_id, campaign_version: payload.identity.campaign_version, goal_id: payload.identity.goal_id, lane_id: payload.identity.lane_id, role_id: payload.identity.role_id, source_commit: payload.identity.source_commit, source_tree: payload.identity.source_tree, worktree_id: payload.identity.worktree_id};
  return {threads: []};
}]));
const bound = bindNativeHost(host, attachment);
assert.deepEqual(Object.keys(bound).sort(), [...REQUIRED_HOST_ACTIONS].sort());
const response = await bound.create_thread({identity: {project_id: "PROJECT-001", campaign_id: "CAMPAIGN-001", campaign_version: "V1", goal_id: "GOAL-001", lane_id: "functionality", role_id: "NAMED_LANE_WORKER", source_commit: "a".repeat(40), source_tree: "b".repeat(40), worktree_id: "WORKTREE-001"}});
assert.equal(response.thread_id, "THREAD-001");
await assert.rejects(() => bound.create_thread({identity: {project_id: "FOREIGN-PROJECT", campaign_id: "CAMPAIGN-001", campaign_version: "V1", goal_id: "GOAL-001", lane_id: "functionality", role_id: "NAMED_LANE_WORKER", source_commit: "a".repeat(40), source_tree: "b".repeat(40), worktree_id: "WORKTREE-001"}}), /payload project differs/u);
await assert.rejects(() => bound.read_thread({project_id: "PROJECT-001", environment_id: "FOREIGN-ENVIRONMENT"}), /payload environment differs/u);
assert.deepEqual(calls[0].payload.host_attachment, {attachment_id: "ATTACHMENT-001", host_id: "HOST-001", project_id: "PROJECT-001", environment_id: "ENV-001"});
assert.throws(() => bindNativeHost({...host, set_thread_archived: undefined}, attachment), /set_thread_archived/u);
assert.throws(() => validateHostAttachment({...attachment, capabilities: ["create_thread"]}), /capabilities/u);
assert.throws(() => validateHostAttachment({...attachment, digest: "0".repeat(64)}), /digest does not match/u);
const moduleSource = `export async function createNativeHostAdapter() { return {${REQUIRED_HOST_ACTIONS.map((action) => `${action}: async (payload) => payload`).join(",")}}; }`;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(moduleSource, "utf8").toString("base64")}`;
const loadedBound = await loadNativeHostAdapter(moduleUrl, attachment);
assert.equal(typeof loadedBound.create_thread, "function");
await assert.rejects(() => loadNativeHostAdapter("data:text/javascript,export default 1", attachment), /must export/u);
console.log(JSON.stringify({status: "PASS", capabilities: Object.keys(bound).length, model: attachment.model}));
