import {readFile} from "node:fs/promises";
import path from "node:path";
import {assert, digestWithout} from "./canonical-json.mjs";
import {compileCampaignAdmission} from "./campaign-admission.mjs";
import {compileCampaignPlan, runCampaign} from "./campaign-orchestrator.mjs";
import {compileGateFile} from "./gate-dsl.mjs";
import {runLaneCampaign} from "./campaign-runner.mjs";
import {auditorDisplayName} from "./campaign-names.mjs";
import {runIntentRegulatorLoop} from "./intent-regulator.mjs";
import {loadQuestionCatalog} from "./question-catalog.mjs";
import {abortNativeSession, closeNativeSession, readMeaningfulProgress, spawnNativeSession, validateHostAdapter} from "./native-session.mjs";
import {getRuntimeIdentity} from "./opaque-reference.mjs";
import {loadNativeHostAdapter} from "./native-host-loader.mjs";
import {assertPortableRecord} from "./portable-record.mjs";

export const CAMPAIGN_OUTCOME_SCHEMA = "agentos.native_campaign_outcome.v1";

const DIGEST = /^[0-9a-f]{64}$/u;
const STOPPING_AUDIT_DECISIONS = new Set(["STOP_HARD_BOUNDARY", "REASSESS_AND_REPLACE_GOAL", "ORCHESTRATOR_REVIEW", "REPLACE_STALLED_WORKER"]);

function exactKeys(value, expected, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort()), `${label} fields mismatch`);
}

function nonempty(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be nonempty`);
}

function digest(value, label) {
  assert(typeof value === "string" && DIGEST.test(value), `${label} must be a SHA-256 digest`);
}

function validateOutcome(outcome, secretValues = []) {
  exactKeys(outcome, ["schema", "version", "status", "campaign_plan", "campaign_run", "digest"], "campaign outcome");
  assert(outcome.schema === CAMPAIGN_OUTCOME_SCHEMA && outcome.version === 1, "campaign outcome identity is invalid");
  assert(outcome.status === "COMPLETE", "campaign outcome is not complete");
  assert(outcome.campaign_plan?.status === "PREPARED_NOT_ACTIVATED", "campaign outcome plan is not prepared");
  assert(outcome.campaign_run?.status === "COMPLETE", "campaign outcome run is not complete");
  digest(outcome.digest, "campaign outcome digest");
  assert(outcome.digest === digestWithout(outcome, "digest"), "campaign outcome digest does not match content");
  assertPortableRecord(outcome, "campaign outcome", {secretValues});
  return outcome;
}

async function readLaneManifest(root) {
  const manifest = JSON.parse(await readFile(path.join(root, "governance/lane-manifest.json"), "utf8"));
  exactKeys(manifest, ["schema", "version", "status", "lanes", "digest"], "lane manifest");
  assert(manifest.schema === "agentos.lane_manifest.v1" && manifest.version === 1, "lane manifest identity is invalid");
  assert(manifest.status === "PREPARED_NOT_ACTIVATED" && Array.isArray(manifest.lanes), "lane manifest is not prepared");
  digest(manifest.digest, "lane manifest digest");
  assert(manifest.digest === digestWithout(manifest, "digest"), "lane manifest digest does not match content");
  assert(manifest.lanes.length === 12, "lane manifest must contain twelve lanes");
  return manifest;
}

async function readLaneInputs(root, laneId, graphId, manifest, questionCatalog) {
  const lane = manifest.lanes.find((candidate) => candidate.lane_id === laneId);
  assert(lane && lane.graph_id === graphId, `lane manifest does not bind ${laneId} to ${graphId}`);
  assert(typeof lane.path === "string" && !path.isAbsolute(lane.path), `lane ${laneId} path must be relative`);
  const graph = await compileGateFile(path.join(root, lane.path));
  assert(graph.graph_id === lane.graph_id && graph.digest === lane.graph_sha256, `lane ${laneId} graph digest differs from its manifest`);
  return {graph, question_catalog: questionCatalog};
}

function phaseAuditorAdmission(plan, phase) {
  const laneId = phase.phase_id.toLowerCase();
  return {
    project_id: plan.project_id,
    campaign_id: plan.campaign_id,
    campaign_version: plan.campaign_version,
    goal_id: plan.goal_id,
    goal_sha256: plan.goal_sha256,
    lane_id: laneId,
    role_id: "INDEPENDENT_AUDITOR",
    role_display_name: auditorDisplayName(phase.phase_id, plan.campaign_version),
    source_commit: plan.source.source_commit,
    source_tree: plan.source.source_tree,
    worktree_id: plan.source.worktree_id,
    environment_id: plan.source.environment_id,
    workspace_boundary: plan.workspace_boundary,
    governance_digest: plan.role_library_digest,
    task_name: phase.auditor.task_name,
    prompt: phase.auditor.prompt,
  };
}

function validateAuditorDecision(raw, session, phase, candidates, secretValues = []) {
  exactKeys(raw, ["thread_id", "host_id", "project_id", "campaign_id", "campaign_version", "goal_id", "lane_id", "role_id", "source_commit", "source_tree", "worktree_id", "phase_id", "audit"], "phase audit readback");
  for (const field of ["thread_id", "host_id", "project_id", "campaign_id", "campaign_version", "goal_id", "lane_id", "role_id", "source_commit", "source_tree", "worktree_id", "phase_id"]) nonempty(raw[field], `phase audit readback.${field}`);
  const runtime = getRuntimeIdentity(session);
  assert(raw.thread_id === runtime.thread_id, "phase audit readback thread_id differs from its session");
  assert(raw.host_id === runtime.host_id, "phase audit readback host_id differs from its session");
  for (const field of ["project_id", "campaign_id", "campaign_version", "goal_id", "lane_id", "role_id", "source_commit", "source_tree", "worktree_id"]) assert(raw[field] === session[field], `phase audit readback ${field} differs from its session`);
  assert(raw.phase_id === phase.phase_id && raw.role_id === "INDEPENDENT_AUDITOR", "phase audit readback role or phase differs");
  exactKeys(raw.audit, ["accepted", "reason", "evidence_sha256", "reviewed_lane_ids", "reviewed_results"], "phase audit decision");
  assert(raw.audit.accepted === true, "Independent Auditor did not accept the phase");
  nonempty(raw.audit.reason, "phase audit reason");
  digest(raw.audit.evidence_sha256, "phase audit evidence_sha256");
  assert(Array.isArray(raw.audit.reviewed_lane_ids), "phase audit reviewed lanes are invalid");
  const expected = candidates.map((candidate) => candidate.lane_id).sort();
  assert(JSON.stringify(raw.audit.reviewed_lane_ids) === JSON.stringify(expected), "phase audit did not review every lane");
  assert(Array.isArray(raw.audit.reviewed_results) && raw.audit.reviewed_results.length === candidates.length, "phase audit reviewed results are incomplete");
  assertPortableRecord(raw.audit, "phase audit decision", {secretValues});
  const expectedResults = candidates.map(({lane_id, result_digest, worker_session_id}) => ({lane_id, result_digest, worker_session_id})).sort((left, right) => left.lane_id.localeCompare(right.lane_id));
  const actualResults = [...raw.audit.reviewed_results].sort((left, right) => left.lane_id.localeCompare(right.lane_id));
  assert(JSON.stringify(actualResults) === JSON.stringify(expectedResults), "phase audit reviewed result identity differs");
  return raw.audit;
}

async function runPhaseAuditor({host, plan, phase, candidates, secretValues = []}) {
  const admission = phaseAuditorAdmission(plan, phase);
  const session = await spawnNativeSession(host, admission);
  let closed = false;
  try {
    const runtime = getRuntimeIdentity(session);
    const request = candidates.map((candidate) => ({lane_id: candidate.lane_id, result_digest: candidate.result_digest, worker_session_id: candidate.worker_session_id, result_type: candidate.result_type, summary: candidate.summary, artifact_sha256: candidate.artifact_sha256, evidence_sha256: candidate.evidence_sha256}));
    await host.send_message_to_thread({thread_id: runtime.thread_id, host_id: runtime.host_id, identity: session, message: JSON.stringify({type: "PHASE_AUDIT_REQUEST", phase_id: phase.phase_id, candidates: request})});
    const raw = await host.read_thread({thread_id: runtime.thread_id, host_id: runtime.host_id, identity: session, view: "phase_audit"});
    const decision = validateAuditorDecision(raw, session, phase, candidates, secretValues);
    const progress = await readMeaningfulProgress(host, session, plan.defaults.progress_window_minutes * 60_000, {secretValues});
    assert(progress.evidence_sha256 === decision.evidence_sha256, "Auditor decision evidence differs from meaningful progress");
    const closedSession = await closeNativeSession(host, session, progress, {secretValues});
    closed = true;
    const auditorReadback = {
      thread_id: closedSession.session.thread_id,
      host_id: closedSession.session.host_id,
      project_id: closedSession.session.project_id,
      campaign_id: closedSession.session.campaign_id,
      campaign_version: closedSession.session.campaign_version,
      goal_id: closedSession.session.goal_id,
      phase_id: phase.phase_id,
      role_id: closedSession.session.role_id,
      source_commit: closedSession.session.source_commit,
      source_tree: closedSession.session.source_tree,
      worktree_id: closedSession.session.worktree_id,
    };
    const acceptance = {
      status: "ACCEPTED",
      reviewer_role_id: "INDEPENDENT_AUDITOR",
      reviewer_session_id: closedSession.session.host_id,
      auditor_readback: auditorReadback,
      evidence_sha256: decision.evidence_sha256,
      reason: decision.reason,
      lane_results: candidates.map(({lane_id, result_digest, worker_session_id}) => ({lane_id, result_digest, worker_session_id})),
      reviewed_lane_ids: [...decision.reviewed_lane_ids],
      acceptance_digest: null,
    };
    acceptance.acceptance_digest = digestWithout(acceptance, "acceptance_digest");
    assertPortableRecord(acceptance, "phase acceptance", {secretValues});
    return acceptance;
  } catch (error) {
    if (!closed) {
      try { await abortNativeSession(host, session, "PHASE_AUDIT_FAILURE"); } catch (cleanupError) { error.cleanup_error = cleanupError.message; }
    }
    throw error;
  }
}

export function createCampaignAuditSupervisor({readSnapshot, onAudit, interval_minutes = 15, max_iterations = null}) {
  assert(typeof readSnapshot === "function" && typeof onAudit === "function", "campaign audit callbacks are required");
  let controller = null;
  let loop = null;
  let failure = null;
  const enforceAudit = async (audit) => {
    await onAudit(audit);
    if (STOPPING_AUDIT_DECISIONS.has(audit.decision)) {
      const error = new Error(`INTENT_REGULATOR_${audit.decision}`);
      error.code = audit.decision;
      throw error;
    }
  };
  return Object.freeze({
    start() {
      assert(controller === null, "campaign audit supervisor has already started");
      controller = new AbortController();
      loop = runIntentRegulatorLoop({readSnapshot, onAudit: enforceAudit, interval_minutes, max_iterations, signal: controller.signal}).catch((error) => {
        if (!controller.signal.aborted || error?.message !== "AUDIT_LOOP_ABORTED") failure = error;
        return {iterations: 0, stopped: controller.signal.aborted};
      });
      return loop;
    },
    async stop() {
      assert(controller !== null && loop !== null, "campaign audit supervisor has not started");
      controller.abort();
      await loop;
      if (failure) throw failure;
      return {status: "STOPPED"};
    },
    assertHealthy() {
      if (failure) throw failure;
    },
  });
}

export async function prepareNativeCampaign({root, bootstrap_plan, goal, campaign_id, campaign_version, source, role_library = null, secretValues = []}) {
  const campaign_plan = await compileCampaignPlan(root, {plan: bootstrap_plan, goal, campaign_id, campaign_version, source, role_library});
  assertPortableRecord(campaign_plan, "prepared native campaign plan", {secretValues});
  return {campaign_plan};
}

export async function runNativeCampaign({root, bootstrap_plan, goal, campaign_id, campaign_version, source, host, authority_secret, evidence_secret, role_library = null, intent_regulator = null}) {
  validateHostAdapter(host);
  nonempty(authority_secret, "campaign authority secret");
  nonempty(evidence_secret, "campaign evidence secret");
  const secretValues = [authority_secret, evidence_secret];
  const prepared = await prepareNativeCampaign({root, bootstrap_plan, goal, campaign_id, campaign_version, source, role_library, secretValues});
  const auditSupervisor = intent_regulator ? createCampaignAuditSupervisor(intent_regulator) : null;
  auditSupervisor?.start();
  try {
    const manifest = await readLaneManifest(root);
    const questionCatalog = await loadQuestionCatalog(root);
    const campaign_run = await runCampaign({
      plan: prepared.campaign_plan,
      async runLane(assignment, {phase}) {
        auditSupervisor?.assertHealthy();
        const admission = compileCampaignAdmission({
          plan: bootstrap_plan,
          goal,
          project_id: prepared.campaign_plan.project_id,
          campaign_id,
          campaign_version,
          lane_id: assignment.lane_id,
          source,
          task_name: assignment.task_name,
          prompt: assignment.prompt,
        });
        const inputs = await readLaneInputs(root, assignment.lane_id, assignment.graph_id, manifest, questionCatalog);
        const result = await runLaneCampaign({host, admission, graph: inputs.graph, question_catalog: inputs.question_catalog, authority_secret, evidence_secret});
        auditSupervisor?.assertHealthy();
        return {status: "AUDIT_CANDIDATE", phase_id: phase.phase_id, lane_id: assignment.lane_id, result_digest: result.digest, worker_session_id: result.closed_session.host_id, result_type: result.progress.result_type, summary: result.progress.summary, artifact_sha256: result.progress.artifact_sha256, evidence_sha256: result.progress.evidence_sha256};
      },
      async acceptPhase({phase, candidates}) {
        auditSupervisor?.assertHealthy();
        const acceptance = await runPhaseAuditor({host, plan: prepared.campaign_plan, phase, candidates, secretValues});
        auditSupervisor?.assertHealthy();
        return acceptance;
      },
    });
    const outcome = {schema: CAMPAIGN_OUTCOME_SCHEMA, version: 1, status: "COMPLETE", campaign_plan: prepared.campaign_plan, campaign_run, digest: null};
    outcome.digest = digestWithout(outcome, "digest");
    const validated = validateOutcome(outcome, secretValues);
    if (auditSupervisor) await auditSupervisor.stop();
    return validated;
  } catch (error) {
    if (auditSupervisor) {
      try { await auditSupervisor.stop(); } catch (auditError) { error.audit_error = auditError.message; }
    }
    throw error;
  }
}

export async function runConfiguredNativeCampaign({host_module_url, host_attachment, ...options}) {
  nonempty(host_module_url, "native host adapter module URL");
  const host = await loadNativeHostAdapter(host_module_url, host_attachment);
  return runNativeCampaign({...options, host});
}

export {validateOutcome as validateCampaignOutcome};
