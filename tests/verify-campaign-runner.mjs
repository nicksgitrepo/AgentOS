#!/usr/bin/env node

import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {digestWithout} from "../control/canonical-json.mjs";
import {compileBootstrapPlan} from "../control/bootstrap-plan.mjs";
import {compileCampaignAdmission} from "../control/campaign-admission.mjs";
import {createGoal} from "../control/campaign-state.mjs";
import {compileGateFile} from "../control/gate-dsl.mjs";
import {createEvidence} from "../control/evidence.mjs";
import {loadQuestionCatalog, renderGateQuestion} from "../control/question-catalog.mjs";
import {createGateResponse} from "../control/gate-response.mjs";
import {acceptCampaignResult, runFunctionalityCampaign} from "../control/campaign-runner.mjs";
import {compileWorkspaceBoundary} from "../control/workspace-boundary.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspace_boundary = compileWorkspaceBoundary({release_root: "/workspace/AgentOS", projects_root: "/workspace/projects", project_root: "/workspace/projects/example-project", control_root: "/workspace/AgentOS-control"});
const plan = await compileBootstrapPlan(ROOT, {project_id: "PROJECT-001", owner_context: {objective: "Build a bounded prototype"}, source_binding: {source_commit: "a".repeat(40), source_tree: "b".repeat(40), worktree_id: "WORKTREE-001", bootstrap_session_id: "BOOTSTRAP-001", environment_id: "ENV-001"}, workspace_boundary});
const goal = createGoal({goal_id: "GOAL-001", objective: "Build functionality", scope: {lane: "functionality"}, intent: {outcome: "works"}, boundaries: {hard: ["no release"], soft: ["review"]}, created_at_utc: "2026-01-01T00:00:00.000Z"});
const admission = compileCampaignAdmission({plan, goal, project_id: "PROJECT-001", campaign_id: "CAMPAIGN-001", campaign_version: "V1", lane_id: "functionality", source: {source_commit: "a".repeat(40), source_tree: "b".repeat(40), worktree_id: "WORKTREE-001", environment_id: "ENV-001"}, task_name: "functionality_worker_001", prompt: "Build the admitted functionality."});
const graph = await compileGateFile(path.join(ROOT, "governance/lanes/functionality.gate"));
const questionCatalog = await loadQuestionCatalog(ROOT);
const authoritySecret = "campaign-runner-authority-secret-001";
const evidenceSecret = "campaign-runner-evidence-attestation-secret-001";
const calls = [];
const threads = new Map();
const host = {
  async create_thread(input) {
    calls.push("CREATE");
    const thread = {thread_id: "THREAD-001", host_id: "WORKER-SESSION-001", project_id: input.identity.project_id, campaign_id: input.identity.campaign_id, campaign_version: input.identity.campaign_version, goal_id: input.identity.goal_id, lane_id: input.identity.lane_id, role_id: input.identity.role_id, source_commit: input.identity.source_commit, source_tree: input.identity.source_tree, worktree_id: input.identity.worktree_id, active: true, pinned: false, archived: false};
    threads.set(thread.thread_id, thread);
    return Object.fromEntries(Object.entries(thread).filter(([key]) => ["thread_id", "host_id", "project_id", "campaign_id", "campaign_version", "goal_id", "lane_id", "role_id", "source_commit", "source_tree", "worktree_id"].includes(key)));
  },
  async list_threads({include_archived = false} = {}) { calls.push("LIST"); return {threads: [...threads.values()].filter((thread) => include_archived || thread.active)}; },
  async wait_threads() { calls.push("WAIT"); return {threads: [{thread_id: "THREAD-001", host_id: "WORKER-SESSION-001"}]}; },
  async send_message_to_thread() { calls.push("SEND"); },
  async set_thread_pinned({thread_id, pinned}) { calls.push(pinned ? "PIN" : "UNPIN"); threads.get(thread_id).pinned = pinned; return {pinned}; },
  async set_thread_archived({thread_id, archived}) { calls.push("ARCHIVE"); threads.get(thread_id).archived = archived; threads.get(thread_id).active = !archived; return {archived}; },
  async read_thread({view}) {
    const base = {thread_id: "THREAD-001", host_id: "WORKER-SESSION-001", project_id: "PROJECT-001", campaign_id: "CAMPAIGN-001", campaign_version: "V1", goal_id: "GOAL-001", lane_id: "functionality", role_id: "NAMED_LANE_WORKER", source_commit: "a".repeat(40), source_tree: "b".repeat(40), worktree_id: "WORKTREE-001"};
    if (view === "progress") return {...base, progress: {result_type: "VERIFIED_BEHAVIOR", summary: "The functionality was observed", artifact_sha256: "c".repeat(64), evidence_sha256: "d".repeat(64)}};
    if (view === "handoff") return {...base, handoff: {summary: "The functionality was observed", result_type: "VERIFIED_BEHAVIOR", artifact_sha256: "c".repeat(64), evidence_sha256: "d".repeat(64)}};
    const identity = {source_commit: "a".repeat(40), source_tree: "b".repeat(40), worktree_id: "WORKTREE-001", session_id: "WORKER-SESSION-001", goal_id: "GOAL-001", environment_id: "ENV-001"};
    const evidence = (gate, slot) => createEvidence({evidence_id: `${gate.id}-${slot}`, question_id: gate.id, graph_digest: graph.digest, evidence_slot: slot, answer: "YES", kind: "HOST_OBSERVATION", value: {gate: gate.id, slot}, identity, issuer_session_id: slot === "review" ? "AUDITOR-SESSION-001" : "HOST-SESSION-001", issuer_kind: slot === "review" ? "INDEPENDENT_AUDITOR" : "HOST_READBACK", supports_answer: true, observed_at_utc: "2026-01-01T00:00:00.000Z", attestation_secret: evidenceSecret});
    return {...base, gate_packet: graph.nodes.map((gate) => {
      const gateEvidence = Object.fromEntries(gate.evidence.map((slot) => [slot, evidence(gate, slot)]));
      return {gate_id: gate.id, gate_name: renderGateQuestion(graph, gate.id, questionCatalog).gate_name, context: renderGateQuestion(graph, gate.id, questionCatalog).context, question: renderGateQuestion(graph, gate.id, questionCatalog).question, answer: "YES", evidence: gateEvidence, response: createGateResponse({rendered: renderGateQuestion(graph, gate.id, questionCatalog), answer: "YES", evidence: gateEvidence, identity, issuer_session_id: "AUDITOR-SESSION-001", issuer_kind: "INDEPENDENT_AUDITOR"})};
    })};
  },
};
const result = await runFunctionalityCampaign({host, admission, graph, question_catalog: questionCatalog, authority_secret: authoritySecret, evidence_secret: evidenceSecret});
assert.equal(result.status, "AUDIT_CANDIDATE");
assert.equal(result.closed_session.status, "CLOSED");
assert.deepEqual(calls.slice(-3), ["UNPIN", "ARCHIVE", "LIST"]);
const reviewerReadback = {thread_id: "AUDITOR-THREAD-001", host_id: "AUDITOR-SESSION-001", project_id: "PROJECT-001", campaign_id: "CAMPAIGN-001", campaign_version: "V1", goal_id: "GOAL-001", lane_id: "functionality", role_id: "INDEPENDENT_AUDITOR", source_commit: "a".repeat(40), source_tree: "b".repeat(40), worktree_id: "WORKTREE-001"};
const accepted = acceptCampaignResult(result, {reviewer_session_id: "AUDITOR-SESSION-001", reviewer_role_id: "INDEPENDENT_AUDITOR", reviewer_readback: reviewerReadback, evidence_sha256: "e".repeat(64), accepted: true, reason: "Independent review matched the result", accepted_at_utc: "2026-01-01T00:20:00.000Z", authority_secret: authoritySecret});
assert.equal(accepted.status, "ACCEPTED");
assert.throws(() => acceptCampaignResult(result, {reviewer_session_id: "WORKER-SESSION-001", reviewer_role_id: "INDEPENDENT_AUDITOR", reviewer_readback: {...reviewerReadback, host_id: "WORKER-SESSION-001"}, evidence_sha256: "e".repeat(64), accepted: true, reason: "self", accepted_at_utc: "2026-01-01T00:20:00.000Z", authority_secret: authoritySecret}), /cannot accept its own/u);
const falseSuccess = {...result, progress: null, digest: null};
falseSuccess.digest = digestWithout(falseSuccess, "digest");
assert.throws(() => acceptCampaignResult(falseSuccess, {reviewer_session_id: "AUDITOR-SESSION-001", reviewer_role_id: "INDEPENDENT_AUDITOR", reviewer_readback: reviewerReadback, evidence_sha256: "e".repeat(64), accepted: true, reason: "false", accepted_at_utc: "2026-01-01T00:20:00.000Z", authority_secret: authoritySecret}), /completion proof is invalid/u);
console.log(JSON.stringify({status: "PASS", campaign: result.status, acceptance: accepted.status}));
