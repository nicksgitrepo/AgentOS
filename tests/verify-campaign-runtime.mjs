import assert from "node:assert/strict";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {compileBootstrapPlan} from "../control/bootstrap-plan.mjs";
import {createGoal} from "../control/campaign-state.mjs";
import {compileGateFile} from "../control/gate-dsl.mjs";
import {createEvidence} from "../control/evidence.mjs";
import {createGateResponse} from "../control/gate-response.mjs";
import {loadQuestionCatalog, renderGateQuestion} from "../control/question-catalog.mjs";
import {runNativeCampaign} from "../control/campaign-runtime.mjs";
import {createAgentOS3BootstrapRuntime} from "../control/agentos-3.mjs";
import {createOwnerContinuation} from "../control/owner-continuation.mjs";
import {compileWorkspaceBoundary} from "../control/workspace-boundary.mjs";
import {sha256} from "../control/canonical-json.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = {source_commit: "a".repeat(40), source_tree: "b".repeat(40), worktree_id: "WORKTREE-3-0", environment_id: "ENV-3-0"};
const workspace_parent = path.dirname(ROOT);
const projects_root = path.join(workspace_parent, "projects");
const control_root = path.join(workspace_parent, "AgentOS-control");
const workspace_boundary = compileWorkspaceBoundary({release_root: ROOT, projects_root, project_root: path.join(projects_root, "example-project"), control_root, worktrees_root: path.join(control_root, "worktrees")});
const bootstrapPlan = await compileBootstrapPlan(ROOT, {
  project_id: "PROJECT-3-0",
  owner_context: {objective: "Build the first governed working release"},
  source_binding: {...source, bootstrap_session_id: "BOOTSTRAP-3-0"},
  workspace_boundary,
});
const goal = createGoal({
  goal_id: "GOAL-3-0",
  objective: "Build the first governed working release",
  scope: {all_lanes: true},
  intent: {outcome: "a complete audited campaign"},
  boundaries: {hard: ["no secrets in records"], soft: ["orchestrator review"]},
  created_at_utc: "2026-01-01T00:00:00.000Z",
});
const questionCatalog = await loadQuestionCatalog(ROOT);
const manifest = JSON.parse(await (await import("node:fs/promises")).readFile(path.join(ROOT, "governance/lane-manifest.json"), "utf8"));
const graphs = new Map();
for (const lane of manifest.lanes) graphs.set(lane.lane_id, await compileGateFile(path.join(ROOT, lane.path)));

const authoritySecret = "campaign-runtime-authority-secret-3-0-0001";
const evidenceSecret = "campaign-runtime-evidence-attestation-secret-3-0-0001";
const calls = [];
const threads = new Map();
const audits = [];
let sequence = 0;

function identityFor(thread) {
  return {
    source_commit: thread.source_commit,
    source_tree: thread.source_tree,
    worktree_id: thread.worktree_id,
    session_id: thread.host_id,
    goal_id: thread.goal_id,
    environment_id: source.environment_id,
  };
}

function baseFor(thread) {
  return {
    thread_id: thread.thread_id,
    host_id: thread.host_id,
    project_id: thread.project_id,
    campaign_id: thread.campaign_id,
    campaign_version: thread.campaign_version,
    goal_id: thread.goal_id,
    lane_id: thread.lane_id,
    role_id: thread.role_id,
    source_commit: thread.source_commit,
    source_tree: thread.source_tree,
    worktree_id: thread.worktree_id,
  };
}

const host = {
  async create_thread(input) {
    calls.push("CREATE");
    sequence += 1;
    const thread = {
      ...input.identity,
      thread_id: `THREAD-${String(sequence).padStart(3, "0")}`,
      host_id: `SESSION-${String(sequence).padStart(3, "0")}`,
      active: true,
      pinned: false,
      archived: false,
      progress: {
        result_type: "VERIFIED_BEHAVIOR",
        summary: `${input.identity.role_id} completed the admitted work for ${input.identity.lane_id}.`,
        artifact_sha256: sha256({kind: "artifact", sequence}),
        evidence_sha256: sha256({kind: "evidence", sequence}),
      },
      auditRequest: null,
    };
    threads.set(thread.thread_id, thread);
    return baseFor(thread);
  },

  async list_threads({include_archived = false} = {}) {
    calls.push("LIST");
    return {threads: [...threads.values()].filter((thread) => include_archived || thread.active).map(baseFor)};
  },

  async wait_threads({targets}) {
    calls.push("WAIT");
    assert.equal(targets.length, 1);
    const thread = [...threads.values()].find((candidate) => candidate.thread_id === targets[0].thread_id);
    assert(thread && thread.host_id === targets[0].host_id);
    return {threads: [{thread_id: thread.thread_id, host_id: thread.host_id}]};
  },

  async send_message_to_thread({thread_id, message}) {
    calls.push("SEND");
    const thread = threads.get(thread_id);
    if (typeof message === "string" && message.startsWith("{")) thread.auditRequest = JSON.parse(message);
    return {sent: true};
  },

  async set_thread_pinned({thread_id, pinned}) {
    calls.push(pinned ? "PIN" : "UNPIN");
    const thread = threads.get(thread_id);
    assert(thread);
    thread.pinned = pinned;
    return {pinned};
  },

  async set_thread_archived({thread_id, archived}) {
    calls.push("ARCHIVE");
    const thread = threads.get(thread_id);
    assert(thread);
    thread.archived = archived;
    thread.active = !archived;
    return {archived};
  },

  async read_thread({thread_id, view}) {
    const thread = threads.get(thread_id);
    assert(thread);
    const base = baseFor(thread);
    if (view === "progress") return {...base, progress: thread.progress};
    if (view === "handoff") return {...base, handoff: thread.progress};
    if (view === "phase_audit") {
      assert(thread.role_id === "INDEPENDENT_AUDITOR" && thread.auditRequest?.type === "PHASE_AUDIT_REQUEST");
      return {
        ...base,
        phase_id: thread.lane_id.toUpperCase(),
        audit: {
          accepted: true,
          reason: "The Auditor reviewed every worker result and found the phase bound to the requested work.",
          evidence_sha256: thread.progress.evidence_sha256,
          reviewed_lane_ids: thread.auditRequest.candidates.map((candidate) => candidate.lane_id).sort(),
          reviewed_results: thread.auditRequest.candidates.map(({lane_id, result_digest, worker_session_id}) => ({lane_id, result_digest, worker_session_id})).sort((left, right) => left.lane_id.localeCompare(right.lane_id)),
        },
      };
    }
    const graph = graphs.get(thread.lane_id);
    assert(graph, `no graph for ${thread.lane_id}`);
    const identity = identityFor(thread);
    return {
      ...base,
      gate_packet: graph.nodes.map((gate) => {
        const rendered = renderGateQuestion(graph, gate.id, questionCatalog);
        const evidence = Object.fromEntries(gate.evidence.map((slot) => [slot, createEvidence({
          evidence_id: `${thread.host_id}-${gate.id}-${slot}`,
          question_id: gate.id,
          graph_digest: graph.digest,
          evidence_slot: slot,
          answer: "YES",
          kind: "HOST_OBSERVATION",
          value: {gate_id: gate.id, lane_id: thread.lane_id, result: "observed"},
          identity,
          issuer_session_id: slot === "review" ? `${thread.host_id}-AUDITOR` : `${thread.host_id}-HOST`,
          issuer_kind: slot === "review" ? "INDEPENDENT_AUDITOR" : "HOST_READBACK",
          supports_answer: true,
          observed_at_utc: "2026-01-01T00:00:00.000Z",
          attestation_secret: evidenceSecret,
        })]));
        return {
          gate_id: gate.id,
          gate_name: rendered.gate_name,
          context: rendered.context,
          question: rendered.question,
          answer: "YES",
          evidence,
          response: createGateResponse({rendered, answer: "YES", evidence, identity, issuer_session_id: `${thread.host_id}-AUDITOR`, issuer_kind: "INDEPENDENT_AUDITOR"}),
        };
      }),
    };
  },
};

const bootstrapRuntime = createAgentOS3BootstrapRuntime({
  root: ROOT,
  bootstrap_plan: bootstrapPlan,
  goal,
  campaign_id: "CAMPAIGN-3-0-TB-03",
  campaign_version: "v3.0.3-tb-03",
  source,
  host,
  authority_secret: authoritySecret,
  evidence_secret: evidenceSecret,
  intent_regulator: {
    readSnapshot: async () => ({
      schema: "agentos.campaign_snapshot.v1",
      version: 1,
      project_id: "PROJECT-3-0",
      campaign_id: "CAMPAIGN-3-0-TB-03",
      campaign_version: "v3.0.3-tb-03",
      goal_id: "GOAL-3-0",
      goal_sha256: goal.digest,
      source_commit: source.source_commit,
      source_tree: source.source_tree,
      progress_status: "PROGRESS_RECORDED",
      scope_changed: false,
      intent_changed: false,
      conditions_changed: false,
      hard_boundary_detected: false,
      soft_boundary_detected: false,
      evidence_identity_ok: true,
      roster_exact: true,
      acceptance_status: "NONE",
    }),
    onAudit: async (audit) => audits.push(audit),
    interval_minutes: 15,
    max_iterations: 1,
  },
});
const ownerContinuation = createOwnerContinuation({
  activation_id: "ACTIVATION-3-0",
  project_id: "PROJECT-3-0",
  campaign_id: "CAMPAIGN-3-0-TB-03",
  campaign_version: "v3.0.3-tb-03",
  goal_id: "GOAL-3-0",
  question_id: "OWNER.LAUNCH",
  expected_value: "START_LOCAL_CAMPAIGN",
  protected_actions: ["PUSH"],
});
const resumed = await bootstrapRuntime.recordOwnerAnswer(ownerContinuation, {
  question_id: "OWNER.LAUNCH",
  answer: "Start the campaign",
  value: "START_LOCAL_CAMPAIGN",
});
assert.equal(resumed.status, "RESUMED");
const outcome = bootstrapRuntime.campaignOutcome(resumed.resume_request.digest);
assert(outcome && outcome.status === "COMPLETE");
const heldContinuation = createOwnerContinuation({
  activation_id: "ACTIVATION-3-0-HELD",
  project_id: "PROJECT-3-0",
  campaign_id: "CAMPAIGN-3-0-TB-03",
  campaign_version: "v3.0.3-tb-03",
  goal_id: "GOAL-3-0",
  question_id: "OWNER.KEEP",
  expected_value: "KEEP_PREPARED",
  protected_actions: ["PUSH"],
});
const held = await bootstrapRuntime.recordOwnerAnswer(heldContinuation, {
  question_id: "OWNER.KEEP",
  answer: "Keep it prepared",
  value: "KEEP_PREPARED",
});
assert.equal(held.status, "BLOCKED");
assert.equal(held.failure.code, "OWNER_LAUNCH_NOT_AUTHORIZED");
const unavailableRuntime = createAgentOS3BootstrapRuntime({
  root: ROOT,
  bootstrap_plan: bootstrapPlan,
  goal,
  campaign_id: "CAMPAIGN-3-0-TB-05",
  campaign_version: "v3.0.3-tb-05",
  source,
  authority_secret: authoritySecret,
  evidence_secret: evidenceSecret,
});
const unavailable = await unavailableRuntime.recordOwnerAnswer(createOwnerContinuation({
  activation_id: "ACTIVATION-3-0-UNAVAILABLE",
  project_id: "PROJECT-3-0",
  campaign_id: "CAMPAIGN-3-0-TB-05",
  campaign_version: "v3.0.3-tb-05",
  goal_id: "GOAL-3-0",
  question_id: "OWNER.LAUNCH",
  expected_value: "START_LOCAL_CAMPAIGN",
  protected_actions: ["PUSH"],
}), {
  question_id: "OWNER.LAUNCH",
  answer: "Start the campaign",
  value: "START_LOCAL_CAMPAIGN",
});
assert.equal(unavailable.status, "BLOCKED");
assert.equal(unavailable.failure.code, "HOST_ADAPTER_UNAVAILABLE");

assert.equal(outcome.status, "COMPLETE");
assert.equal(outcome.campaign_run.status, "COMPLETE");
assert.equal(outcome.campaign_run.phase_results.length, 4);
assert.equal(outcome.campaign_run.lane_results.length, 12);
assert(outcome.campaign_plan.phases.flatMap((phase) => phase.worker_assignments).every((assignment) => assignment.role_display_name.endsWith(" Worker v3.0.3-tb-03")));
assert(outcome.campaign_plan.phases.every((phase) => phase.auditor.display_name.endsWith(" Auditor v3.0.3-tb-03")));
assert.equal([...threads.values()].filter((thread) => thread.active).length, 0);
assert.equal(calls.filter((call) => call === "CREATE").length, 16);
assert.equal(calls.filter((call) => call === "ARCHIVE").length, 16);
assert.equal(audits.length, 1);
assert.equal(audits[0].decision, "CONTINUE_CAMPAIGN");
assert(!JSON.stringify(outcome).includes("/workspace"));
assert(!JSON.stringify(outcome).includes(authoritySecret));
assert(!JSON.stringify(outcome).includes(evidenceSecret));

await assert.rejects(() => runNativeCampaign({
  root: ROOT,
  bootstrap_plan: bootstrapPlan,
  goal,
  campaign_id: "CAMPAIGN-3-0-TB-04",
  campaign_version: "v3.0.3-tb-04",
  source,
  host,
  authority_secret: authoritySecret,
  evidence_secret: evidenceSecret,
  intent_regulator: {
    readSnapshot: async () => ({
      schema: "agentos.campaign_snapshot.v1",
      version: 1,
      project_id: "PROJECT-3-0",
      campaign_id: "CAMPAIGN-3-0-TB-04",
      campaign_version: "v3.0.3-tb-04",
      goal_id: "GOAL-3-0",
      goal_sha256: goal.digest,
      source_commit: source.source_commit,
      source_tree: source.source_tree,
      progress_status: "PROGRESS_RECORDED",
      scope_changed: false,
      intent_changed: false,
      conditions_changed: false,
      hard_boundary_detected: true,
      soft_boundary_detected: false,
      evidence_identity_ok: true,
      roster_exact: true,
      acceptance_status: "NONE",
    }),
    onAudit: async () => {},
    interval_minutes: 15,
    max_iterations: 1,
  },
}), /INTENT_REGULATOR_STOP_HARD_BOUNDARY/u);
assert.equal([...threads.values()].filter((thread) => thread.active).length, 0);

console.log(JSON.stringify({status: "PASS", phases: outcome.campaign_run.phase_results.length, lanes: outcome.campaign_run.lane_results.length, sessions_created: calls.filter((call) => call === "CREATE").length}));
