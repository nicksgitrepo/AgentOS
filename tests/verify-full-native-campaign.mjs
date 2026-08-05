#!/usr/bin/env node

import assert from "node:assert/strict";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {readFile} from "node:fs/promises";
import {compileBootstrapPlan} from "../control/bootstrap-plan.mjs";
import {compileCampaignPlan, runCampaign} from "../control/campaign-orchestrator.mjs";
import {createGoal} from "../control/campaign-state.mjs";
import {compileCampaignAdmission} from "../control/campaign-admission.mjs";
import {compileGateFile} from "../control/gate-dsl.mjs";
import {createEvidence} from "../control/evidence.mjs";
import {loadQuestionCatalog, renderGateQuestion} from "../control/question-catalog.mjs";
import {createGateResponse} from "../control/gate-response.mjs";
import {acceptCampaignResult, runLaneCampaign} from "../control/campaign-runner.mjs";
import {digestWithout, sha256} from "../control/canonical-json.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = {source_commit: "a".repeat(40), source_tree: "b".repeat(40), worktree_id: "WORKTREE-001", environment_id: "ENV-001"};
const authoritySecret = "full-campaign-authority-secret-001";
const evidenceSecret = "full-campaign-evidence-secret-001";
const bootstrapPlan = await compileBootstrapPlan(ROOT, {project_id: "PROJECT-001", owner_context: {objective: "Build a complete bounded prototype"}, source_binding: {...source, bootstrap_session_id: "BOOTSTRAP-001"}});
const goal = createGoal({goal_id: "GOAL-001", objective: "Build a complete bounded prototype", scope: {all_lanes: true}, intent: {outcome: "working"}, boundaries: {hard: ["no release"], soft: ["review"]}, created_at_utc: "2026-01-01T00:00:00.000Z"});
const plan = await compileCampaignPlan(ROOT, {plan: bootstrapPlan, goal, campaign_id: "CAMPAIGN-001", campaign_version: "V1", source});
const laneManifest = JSON.parse(await readFile(path.join(ROOT, "governance/lane-manifest.json"), "utf8"));
const questionCatalog = await loadQuestionCatalog(ROOT);
const graphs = new Map(await Promise.all(laneManifest.lanes.map(async (lane) => [lane.lane_id, await compileGateFile(path.join(ROOT, lane.path))])));
const results = new Map();

function fakeHost(graph, admission, workerSessionId) {
  const threadId = `${admission.lane_id.toUpperCase().replaceAll("-", "_")}-THREAD-001`;
  const threads = new Map();
  const identity = {
    thread_id: threadId,
    host_id: workerSessionId,
    project_id: admission.project_id,
    campaign_id: admission.campaign_id,
    campaign_version: admission.campaign_version,
    goal_id: admission.goal_id,
    lane_id: admission.lane_id,
    role_id: admission.role_id,
    source_commit: admission.source.source_commit,
    source_tree: admission.source.source_tree,
    worktree_id: admission.source.worktree_id,
  };
  const progress = {result_type: "VERIFIED_BEHAVIOR", summary: `${admission.lane_id} completed its bounded checks`, artifact_sha256: sha256({lane: admission.lane_id, artifact: true}), evidence_sha256: sha256({lane: admission.lane_id, evidence: true})};
  const evidenceFor = (gate, slot) => createEvidence({
    evidence_id: `${admission.lane_id}-${gate.id}-${slot}`,
    question_id: gate.id,
    graph_digest: graph.digest,
    evidence_slot: slot,
    answer: "YES",
    kind: slot === "review" ? "INDEPENDENT_REVIEW" : "HOST_READBACK",
    value: {lane: admission.lane_id, gate: gate.id, slot},
    identity: {source_commit: admission.source.source_commit, source_tree: admission.source.source_tree, worktree_id: admission.source.worktree_id, session_id: workerSessionId, goal_id: admission.goal_id, environment_id: "ENV-001"},
    issuer_session_id: slot === "review" ? `${admission.lane_id}-AUDITOR-001` : `${admission.lane_id}-HOST-001`,
    issuer_kind: slot === "review" ? "INDEPENDENT_AUDITOR" : "HOST_READBACK",
    supports_answer: true,
    observed_at_utc: "2026-01-01T00:10:00.000Z",
    attestation_secret: evidenceSecret,
  });
  return {
    async create_thread() { threads.set(threadId, {active: true, pinned: false, archived: false}); return {...identity}; },
    async list_threads() { return {threads: threads.has(threadId) ? [{...identity, ...threads.get(threadId)}] : []}; },
    async wait_threads() { return {threads: [{thread_id: threadId, host_id: workerSessionId}]}; },
    async read_thread({view}) {
      if (view === "progress") return {...identity, progress};
      if (view === "handoff") return {...identity, handoff: progress};
      return {...identity, gate_packet: graph.nodes.map((gate) => {
        const rendered = renderGateQuestion(graph, gate.id, questionCatalog);
        const gateEvidence = Object.fromEntries(gate.evidence.map((slot) => [slot, evidenceFor(gate, slot)]));
        return {gate_id: gate.id, gate_name: rendered.gate_name, context: rendered.context, question: rendered.question, answer: "YES", evidence: gateEvidence, response: createGateResponse({rendered, answer: "YES", evidence: gateEvidence, identity: {source_commit: admission.source.source_commit, source_tree: admission.source.source_tree, worktree_id: admission.source.worktree_id, session_id: workerSessionId, goal_id: admission.goal_id, environment_id: "ENV-001"}, issuer_session_id: `${admission.lane_id}-AUDITOR-001`, issuer_kind: "INDEPENDENT_AUDITOR"})};
      })};
    },
    async send_message_to_thread() {},
    async set_thread_pinned({pinned}) { threads.get(threadId).pinned = pinned; return {pinned}; },
    async set_thread_archived({archived}) { threads.get(threadId).archived = archived; return {archived}; },
    async remove_from_active_roster() { threads.delete(threadId); return {active_roster_removed: true}; },
  };
}

const run = await runCampaign({
  plan,
  async runLane(assignment, {phase}) {
    const graph = graphs.get(assignment.lane_id);
    const admission = compileCampaignAdmission({plan: bootstrapPlan, goal, project_id: plan.project_id, campaign_id: plan.campaign_id, campaign_version: plan.campaign_version, lane_id: assignment.lane_id, source, task_name: assignment.task_name, prompt: assignment.prompt});
    const workerSessionId = `${assignment.lane_id.toUpperCase().replaceAll("-", "_")}-WORKER-001`;
    const result = await runLaneCampaign({host: fakeHost(graph, admission, workerSessionId), admission, graph, question_catalog: questionCatalog, authority_secret: authoritySecret, evidence_secret: evidenceSecret});
    results.set(assignment.lane_id, result);
    return {status: "AUDIT_CANDIDATE", phase_id: phase.phase_id, lane_id: assignment.lane_id, result_digest: result.digest, worker_session_id: result.closed_session.host_id};
  },
  async acceptPhase({phase, candidates}) {
    const auditorSessionId = `${phase.phase_id}-AUDITOR-001`;
    for (const candidate of candidates) {
      const result = results.get(candidate.lane_id);
      const accepted = acceptCampaignResult(result, {
        reviewer_session_id: auditorSessionId,
        reviewer_role_id: "INDEPENDENT_AUDITOR",
        reviewer_readback: {thread_id: `${phase.phase_id}-AUDITOR-THREAD-001`, host_id: auditorSessionId, project_id: plan.project_id, campaign_id: plan.campaign_id, campaign_version: plan.campaign_version, goal_id: plan.goal_id, lane_id: candidate.lane_id, role_id: "INDEPENDENT_AUDITOR", source_commit: source.source_commit, source_tree: source.source_tree, worktree_id: source.worktree_id},
        evidence_sha256: sha256({phase: phase.phase_id, lane: candidate.lane_id, accepted: true}),
        accepted: true,
        reason: "The phase Auditor independently reviewed the lane result.",
        accepted_at_utc: "2026-01-01T00:12:00.000Z",
        authority_secret: authoritySecret,
      });
      assert.equal(accepted.status, "ACCEPTED");
    }
    const acceptance = {
      status: "ACCEPTED",
      reviewer_role_id: "INDEPENDENT_AUDITOR",
      reviewer_session_id: auditorSessionId,
      auditor_readback: {thread_id: `${phase.phase_id}-AUDITOR-THREAD-001`, host_id: auditorSessionId, project_id: plan.project_id, campaign_id: plan.campaign_id, campaign_version: plan.campaign_version, goal_id: plan.goal_id, phase_id: phase.phase_id, role_id: "INDEPENDENT_AUDITOR", source_commit: source.source_commit, source_tree: source.source_tree, worktree_id: source.worktree_id},
      evidence_sha256: sha256({phase: phase.phase_id, accepted: true}),
      reason: "The phase Auditor independently reviewed every lane result.",
      lane_results: candidates.map(({lane_id, result_digest, worker_session_id}) => ({lane_id, result_digest, worker_session_id})),
      reviewed_lane_ids: candidates.map(({lane_id}) => lane_id).sort(),
      acceptance_digest: null,
    };
    acceptance.acceptance_digest = digestWithout(acceptance, "acceptance_digest");
    return acceptance;
  },
});

assert.equal(run.status, "COMPLETE");
assert.equal(run.phase_results.length, 4);
assert.equal(run.lane_results.length, 12);
assert.equal(results.size, 12);
console.log(JSON.stringify({status: "PASS", phases: run.phase_results.length, native_lane_results: results.size}));
