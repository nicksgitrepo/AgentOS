#!/usr/bin/env node

/*
 * Focused contract test for the canonical automatic path.
 *
 * The host below is deliberately a clearly labeled fake host. It exercises
 * the public native-session contract only; it is not evidence of live host
 * behavior, provider availability, or deployment behavior.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {canonicalDigest, assertPersistedRecordSafe} from "../control/content-addressing.mjs";
import {compileBootstrapPlan} from "../control/bootstrap-compiler.mjs";
import {discoverProject} from "../control/bootstrap-discovery.mjs";
import {compileNativeHostAttachment} from "../control/native-host-attachment.mjs";
import {
  compileCanonicalCampaignAdmission,
  runCanonicalCampaign,
  validateCanonicalCampaignAdmission,
  validateCanonicalCampaignOrchestration,
  inspectCanonicalCampaignRuntime,
} from "../control/canonical-campaign-orchestration-adapter.mjs";

const NOW = "2026-08-06T12:00:00.000Z";
const COMMIT = "1".repeat(40);
const TREE = "2".repeat(40);
const PROJECT_ID = "PROJECT-CANONICAL-E2E";
const ENVIRONMENT_ID = "ENVIRONMENT-CANONICAL-E2E";
const CAMPAIGN_ID = "CAMPAIGN-CANONICAL-E2E";
const CAMPAIGN_VERSION = "V3-0-RC1";
const LINEAGE_ID = "LINEAGE-CANONICAL-E2E";
const GOAL_ID = "GOAL-CANONICAL-E2E";
const WORKER_ARTIFACT = "a".repeat(64);
const WORKER_EVIDENCE = "b".repeat(64);
const AUDIT_EVIDENCE = "c".repeat(64);

function makeBootstrapPlan({finish = "REVIEW"} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-canonical-bootstrap-"));
  const discovery = discoverProject(root, "RECOMMENDED").facts;
  const answers = {
    "bootstrap.discovery.mode": "RECOMMENDED",
    "project.north_star": {user: "synthetic owner", outcome: "receive one truthful result"},
    "project.first_workflow": {name: "synthetic workflow", success: "one accepted result"},
    "project.boundary": {project_name: "Synthetic Campaign Context", repositories: [], branches: []},
    "project.protected_boundaries": {owner_only: ["destructive actions"], protected: ["secrets", "accepted truth"]},
    "authority-corpus.source": {operation: "CREATE_NEW"},
    "project.design": {page_families: [], templates: [], protected_surfaces: []},
    "project.technical_baseline": {testing: "deterministic"},
    "project.delivery_policy": {
      priority: "BALANCED",
      ci_runner: {route: "LOCAL", weekly_minutes_budget: 120},
      deployment: {route: "LOCAL", environment_ids: ["synthetic"], rollback_required: true, rollback_test: true},
    },
    "project.delivery_finish": finish,
    "project.model_economics": {profile: "ECO_CONTINUOUS", completion_floor: 0.8},
    "project.runtime": {session_id: "RUNTIME-CANONICAL-E2E", environment_identity: ENVIRONMENT_ID, capabilities: ["filesystem", "git"]},
    "project.first_campaign": {features: []},
  };
  return compileBootstrapPlan({
    discovery,
    answers,
    projectRoot: root,
    controlPlaneRoot: root,
    controlPlaneMode: "IN_PROJECT_OPT_IN",
  });
}

function makeAdmission(bootstrapPlan, {acceptedRole = "RAPID_SLICE_BUILDER", secondRole = "IMPLEMENTATION_FUNCTIONALITY"} = {}) {
  const goalSha256 = canonicalDigest({
    north_star: bootstrapPlan.north_star,
    first_useful_workflow: bootstrapPlan.first_useful_workflow,
    first_campaign: bootstrapPlan.first_campaign,
  });
  return compileCanonicalCampaignAdmission({
    bootstrapPlan,
    projectId: PROJECT_ID,
    environmentId: ENVIRONMENT_ID,
    campaignId: CAMPAIGN_ID,
    campaignVersion: CAMPAIGN_VERSION,
    logicalLineageId: LINEAGE_ID,
    goalId: GOAL_ID,
    goalSha256,
    source: {commit: COMMIT, tree: TREE, worktree_id: "WORKTREE-CANONICAL-E2E"},
    lanes: [
      {
        lane_id: "ALPHA",
        native_role: acceptedRole,
        dependencies: [],
        writable_scope: "SCOPE-ALPHA",
        task: "Produce the bounded alpha result and return typed evidence.",
      },
      {
        lane_id: "BETA",
        native_role: secondRole,
        dependencies: ["ALPHA"],
        writable_scope: "SCOPE-BETA",
        task: "Produce the bounded beta result after alpha is accepted.",
      },
    ],
    maxConcurrentWorkers: 1,
  });
}

function makeFakeHost({acceptAudits = true} = {}) {
  let nextThread = 10;
  const sessions = new Map();
  const calls = [];
  const activeThreads = () => [...sessions.values()]
    .filter((session) => session.active === true && session.archived === false)
    .map((session) => ({thread_id: session.thread_id, host_id: session.host_id, active: true, archived: false, pinned: session.pinned}));
  const threadId = () => `00000000-0000-4000-8000-${String(nextThread++).padStart(12, "0")}`;

  function common(payload, session) {
    return {
      thread_id: session.thread_id,
      host_id: session.host_id,
      project_id: PROJECT_ID,
      campaign_id: CAMPAIGN_ID,
      campaign_version: CAMPAIGN_VERSION,
      role: session.role,
      source_commit: COMMIT,
      source_tree: TREE,
      status: "COMPLETED",
      ...payload,
    };
  }

  function workerProgress(session) {
    const progress = {
      schema: "agentos.native_worker_progress.v1",
      version: 1,
      status: "MEANINGFUL_PROGRESS",
      thread_id: session.thread_id,
      host_id: session.host_id,
      project_id: PROJECT_ID,
      campaign_id: CAMPAIGN_ID,
      campaign_version: CAMPAIGN_VERSION,
      role: session.role,
      source_commit: COMMIT,
      source_tree: TREE,
      result_type: "VERIFIED_BEHAVIOR",
      summary: `${session.role} produced a bounded verified result.`,
      artifact_sha256: WORKER_ARTIFACT,
      evidence_sha256: WORKER_EVIDENCE,
      observed_at_utc: NOW,
      progress_sha256: null,
    };
    progress.progress_sha256 = canonicalDigest({...progress, progress_sha256: null});
    return progress;
  }

  function auditResult(session, prompt) {
    const match = /handoff digest ([0-9a-f]{64})/u.exec(prompt);
    assert(match, "fake Auditor prompt did not bind a handoff digest");
    const audit = {
      schema: "agentos.native_auditor_result.v1",
      version: 1,
      status: "AUDIT_COMPLETE",
      thread_id: session.thread_id,
      host_id: session.host_id,
      project_id: PROJECT_ID,
      campaign_id: CAMPAIGN_ID,
      campaign_version: CAMPAIGN_VERSION,
      role: "INDEPENDENT_AUDITOR",
      source_commit: COMMIT,
      source_tree: TREE,
      handoff_sha256: match[1],
      accepted: acceptAudits,
      evidence_sha256: AUDIT_EVIDENCE,
      observed_at_utc: NOW,
      audit_sha256: null,
    };
    audit.audit_sha256 = canonicalDigest({...audit, audit_sha256: null});
    return audit;
  }

  const host = {
    async create_thread(payload) {
      const id = threadId();
      const isAuditor = payload.title.startsWith("Independent Auditor");
      const session = {
        thread_id: id,
        host_id: "local",
        role: isAuditor ? "INDEPENDENT_AUDITOR" : payload.title.startsWith("Rapid Slice Builder") ? "RAPID_SLICE_BUILDER" : "IMPLEMENTATION_FUNCTIONALITY",
        model: payload.model,
        reasoning_effort: payload.thinking,
        pinned: false,
        active: true,
        archived: false,
        prompt: payload.prompt,
      };
      sessions.set(id, session);
      calls.push({operation: "create_thread", role: session.role});
      return {
        status: "THREAD_BOUND",
        thread_id: id,
        host_id: session.host_id,
        project_id: PROJECT_ID,
        model: payload.model,
        reasoning_effort: payload.thinking,
        worktree_path: "synthetic-worktree",
        worktree_initialized: true,
        source_commit: COMMIT,
        source_tree: TREE,
        active: true,
        archived: false,
      };
    },
    async list_threads() {
      calls.push({operation: "list_threads"});
      return {status: "LISTED", active_roster: activeThreads()};
    },
    async read_thread(payload) {
      const session = sessions.get(payload.threadId);
      assert(session, "fake host read requested an unknown thread");
      calls.push({operation: "read_thread", role: session.role});
      return common({
        progress: session.role === "INDEPENDENT_AUDITOR" ? undefined : workerProgress(session),
        audit: session.role === "INDEPENDENT_AUDITOR" ? auditResult(session, session.prompt) : undefined,
      }, session);
    },
    async send_message_to_thread(payload) {
      const session = sessions.get(payload.threadId);
      assert(session, "fake host send requested an unknown thread");
      session.prompt = payload.prompt;
      calls.push({operation: "send_message_to_thread", role: session.role});
      return common({}, session);
    },
    async wait_threads(payload) {
      const session = sessions.get(payload.targets[0].threadId);
      assert(session, "fake host wait requested an unknown thread");
      calls.push({operation: "wait_threads", role: session.role});
      return common({timed_out: false}, session);
    },
    async set_thread_pinned(payload) {
      const session = sessions.get(payload.threadId);
      assert(session, "fake host pin requested an unknown thread");
      session.pinned = payload.pinned;
      calls.push({operation: "set_thread_pinned", role: session.role, pinned: payload.pinned});
      return common({pinned: payload.pinned}, session);
    },
    async set_thread_archived(payload) {
      const session = sessions.get(payload.threadId);
      assert(session, "fake host archive requested an unknown thread");
      session.archived = payload.archived;
      session.active = !payload.archived;
      calls.push({operation: "set_thread_archived", role: session.role});
      return common({archived: payload.archived}, session);
    },
  };
  return {host, calls, activeThreads};
}

function laneWork() {
  return {
    ALPHA: {task: "Produce the bounded alpha result and return typed evidence.", prompt: "Complete the admitted alpha work and report its typed result."},
    BETA: {task: "Produce the bounded beta result after alpha is accepted.", prompt: "Complete the admitted beta work and report its typed result."},
  };
}

function persistRecorder() {
  let head = null;
  const states = [];
  return {
    states,
    persist({expected_state_sha256, state}) {
      assert.equal(expected_state_sha256, head);
      head = state.state_sha256;
      states.push(state);
      return true;
    },
  };
}

const bootstrapPlan = makeBootstrapPlan();
const admission = makeAdmission(bootstrapPlan);
validateCanonicalCampaignAdmission(admission, {bootstrapPlan});
const attachment = compileNativeHostAttachment({
  attachmentId: "ATTACHMENT-CANONICAL-E2E",
  hostId: "local",
  projectId: PROJECT_ID,
  environmentId: ENVIRONMENT_ID,
  model: "gpt-5.6-luna",
  reasoningEffort: "max",
  attachedAtUtc: NOW,
});
const fake = makeFakeHost();
const recorder = persistRecorder();
const authorityRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-canonical-runtime-"));
const result = await runCanonicalCampaign({
  bootstrapPlan,
  admission,
  host: fake.host,
  hostAttachment: attachment,
  authorityRoot,
  repositoryRoot: fs.realpathSync(process.cwd()),
  projectBinding: {project_id: PROJECT_ID},
  laneWork: laneWork(),
  persistCampaignState: recorder.persist,
  clock: () => NOW,
});

assert.equal(result.status, "CLOSED");
validateCanonicalCampaignOrchestration(result);
assert.equal(result.acceptance.status, "ACCEPTED");
assert.equal(result.acceptance.accepted_worker_count, 2);
assert.equal(result.delivery.owner_choice, "REVIEW");
assert.equal(result.delivery.result, "REVIEW_READY");
assert.equal(result.closure.active_native_session_count, 0);
assert.equal(result.closure.exact_worker_closure, true);
assert.equal(result.closure.evidence_identity_ok, true);
assert.equal(recorder.states.at(-1).status, "CLOSED");
assert(recorder.states.length >= 10, "campaign persistence did not observe the integrated lifecycle");
assert.deepEqual(fake.calls.filter((call) => call.operation === "create_thread").map((call) => call.role), [
  "RAPID_SLICE_BUILDER", "INDEPENDENT_AUDITOR", "IMPLEMENTATION_FUNCTIONALITY", "INDEPENDENT_AUDITOR",
]);
assert.equal(fake.activeThreads().length, 0);
assert(!JSON.stringify(result).includes("00000000-0000-4000-8000-"), "persisted orchestration result leaked a host thread identity");
assert.doesNotThrow(() => assertPersistedRecordSafe(result));
const runtimeInspection = inspectCanonicalCampaignRuntime({authorityRoot, repositoryRoot: fs.realpathSync(process.cwd())});
assert.equal(runtimeInspection.state.status, "CLOSED");
assert.equal(runtimeInspection.lease.status, "RELEASED");
assert(runtimeInspection.events.length >= 7);
assert(runtimeInspection.roles.every((role) => role.host_session_ref === null));

assert.throws(() => compileCanonicalCampaignAdmission({
  bootstrapPlan,
  projectId: PROJECT_ID,
  environmentId: ENVIRONMENT_ID,
  campaignId: CAMPAIGN_ID,
  campaignVersion: CAMPAIGN_VERSION,
  logicalLineageId: LINEAGE_ID,
  goalId: GOAL_ID,
  goalSha256: canonicalDigest({north_star: bootstrapPlan.north_star, first_useful_workflow: bootstrapPlan.first_useful_workflow, first_campaign: bootstrapPlan.first_campaign}),
  source: {commit: COMMIT, tree: TREE, worktree_id: "WORKTREE-CANONICAL-E2E"},
  lanes: [
    {lane_id: "ALPHA", native_role: "INDEPENDENT_AUDITOR", writable_scope: "SCOPE-ALPHA", task: "A"},
  ],
}), /Auditor role|NATIVE_SESSION_ROLE_COLLISION/u);

const malformedAdmissionBody = {...admission, delivery: {...admission.delivery, owner_choice: "DEPLOY"}, admission_sha256: null};
const malformedAdmission = {...malformedAdmissionBody, admission_sha256: canonicalDigest(malformedAdmissionBody)};
assert.doesNotThrow(() => validateCanonicalCampaignAdmission(malformedAdmission));
const deployPlan = makeBootstrapPlan({finish: "DEPLOY"});
const deployAdmission = makeAdmission(deployPlan);
await assert.rejects(
  () => runCanonicalCampaign({
    bootstrapPlan: deployPlan,
    admission: deployAdmission,
    authorityRoot: fs.mkdtempSync(path.join(os.tmpdir(), "agentos-canonical-unsupported-")),
    laneWork: laneWork(),
    persistCampaignState: () => true,
  }),
  (error) => error.code === "DELIVERY_ADAPTER_REQUIRED",
);

const unavailableHost = makeFakeHost().host;
delete unavailableHost.wait_threads;
await assert.rejects(
  () => runCanonicalCampaign({
    bootstrapPlan,
    admission,
    host: unavailableHost,
    hostAttachment: attachment,
    authorityRoot: fs.mkdtempSync(path.join(os.tmpdir(), "agentos-canonical-host-unavailable-")),
    laneWork: laneWork(),
    projectBinding: {project_id: PROJECT_ID},
    persistCampaignState: () => true,
    clock: () => NOW,
  }),
  (error) => error.code === "NATIVE_SESSION_TOOLING_UNAVAILABLE",
);

const rejectedFake = makeFakeHost({acceptAudits: false});
const rejectedRecorder = persistRecorder();
const rejectedResult = await runCanonicalCampaign({
  bootstrapPlan,
  admission,
  host: rejectedFake.host,
  hostAttachment: attachment,
  authorityRoot: fs.mkdtempSync(path.join(os.tmpdir(), "agentos-canonical-rejected-")),
  laneWork: laneWork(),
  projectBinding: {project_id: PROJECT_ID},
  persistCampaignState: rejectedRecorder.persist,
  clock: () => NOW,
});
assert.equal(rejectedResult.status, "BLOCKED");
assert.equal(rejectedResult.closure, null);
assert.equal(rejectedResult.runtime.status, "HARD_STOPPED");
assert.equal(rejectedFake.activeThreads().length, 0);
assert.doesNotThrow(() => validateCanonicalCampaignOrchestration(rejectedResult));

console.log("PASS canonical campaign orchestration contract: Bootstrap admission, persistent Intent Regulator/Runtime, native workers, independent Auditor, dependency order, acceptance, owner review closure, privacy, and fail-closed hostile cases");
