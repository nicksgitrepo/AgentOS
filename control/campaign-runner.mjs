import {assert, digestWithout} from "./canonical-json.mjs";
import {validateGateGraph, findGate} from "./gate-model.mjs";
import {answerCurrent, createExecution, createExecutionAuthority} from "./gate-engine.mjs";
import {readGatePacket, readMeaningfulProgress, spawnNativeSession, closeNativeSession, abortNativeSession} from "./native-session.mjs";
import {toNativeAdmission, validateCampaignAdmission} from "./campaign-admission.mjs";

export const CAMPAIGN_RESULT_SCHEMA = "agentos.campaign_result.v1";

function exactKeys(value, expected, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort()), `${label} fields mismatch`);
}

function digest(value, label) {
  assert(typeof value === "string" && /^[0-9a-f]{64}$/u.test(value), `${label} must be a SHA-256 digest`);
}

export async function runFunctionalityCampaign({host, admission, graph, authority_secret}) {
  validateCampaignAdmission(admission);
  validateGateGraph(graph);
  const nativeAdmission = toNativeAdmission(admission);
  const authority = createExecutionAuthority(authority_secret);
  let session = null;
  try {
    session = await spawnNativeSession(host, nativeAdmission);
    const binding = {
      source_commit: admission.source.source_commit,
      source_tree: admission.source.source_tree,
      worktree_id: admission.source.worktree_id,
      session_id: session.host_id,
      goal_id: admission.goal_id,
      environment_id: admission.source.environment_id,
    };
    let execution = createExecution(graph, binding, {authority});
    const progress = await readMeaningfulProgress(host, session, admission.progress_window_minutes * 60_000);
    const packet = await readGatePacket(host, session);
    for (const item of packet) {
      assert(execution.status === "ACTIVE", "gate packet continued after execution terminal");
      const gate = findGate(graph, execution.current_node);
      assert(item.gate_id === gate.id, `gate packet expected ${gate.id} but received ${item.gate_id}`);
      execution = answerCurrent(execution, graph, item.answer, item.evidence, {authority});
    }
    assert(execution.status === "COMPLETE", `functionality campaign did not complete gates: ${execution.status}`);
    const closed = await closeNativeSession(host, session, {
      summary: progress.summary,
      result_type: progress.result_type,
      artifact_sha256: progress.artifact_sha256,
      evidence_sha256: progress.evidence_sha256,
    });
    const result = {
      schema: CAMPAIGN_RESULT_SCHEMA,
      version: 1,
      status: "AUDIT_CANDIDATE",
      admission_digest: admission.digest,
      graph_digest: graph.digest,
      execution,
      progress,
      closed_session: closed.session,
      closure: closed.closure,
      digest: null,
    };
    result.digest = digestWithout(result, "digest");
    return result;
  } catch (error) {
    if (session) {
      try { await abortNativeSession(host, session, "CAMPAIGN_FAILURE"); } catch (cleanupError) { error.cleanup_error = cleanupError.message; }
    }
    throw error;
  }
}

export function acceptCampaignResult(result, {reviewer_session_id, reviewer_role_id, evidence_sha256, accepted, reason, accepted_at_utc}) {
  exactKeys(result, ["schema", "version", "status", "admission_digest", "graph_digest", "execution", "progress", "closed_session", "closure", "digest"], "campaign result");
  assert(result.schema === CAMPAIGN_RESULT_SCHEMA && result.version === 1 && result.status === "AUDIT_CANDIDATE", "campaign result is not an audit candidate");
  digest(result.admission_digest, "admission_digest");
  digest(result.graph_digest, "graph_digest");
  assert(result.digest === digestWithout(result, "digest"), "campaign result digest does not match content");
  exactKeys({reviewer_session_id, reviewer_role_id, evidence_sha256, accepted, reason, accepted_at_utc}, ["reviewer_session_id", "reviewer_role_id", "evidence_sha256", "accepted", "reason", "accepted_at_utc"], "campaign acceptance");
  assert(typeof reviewer_session_id === "string" && reviewer_session_id.length > 0, "reviewer_session_id is required");
  assert(reviewer_session_id !== result.execution.binding.session_id, "worker cannot accept its own result");
  assert(reviewer_role_id === "INDEPENDENT_AUDITOR", "campaign acceptance requires an Independent Auditor");
  digest(evidence_sha256, "acceptance evidence_sha256");
  assert(accepted === true, "campaign result was not accepted");
  assert(typeof reason === "string" && reason.length > 0, "acceptance reason is required");
  assert(typeof accepted_at_utc === "string" && Number.isFinite(Date.parse(accepted_at_utc)), "accepted_at_utc is invalid");
  const acceptance = {reviewer_session_id, reviewer_role_id, evidence_sha256, accepted, reason, accepted_at_utc, digest: null};
  acceptance.digest = digestWithout(acceptance, "digest");
  return {schema: CAMPAIGN_RESULT_SCHEMA, version: 1, status: "ACCEPTED", result_digest: result.digest, acceptance, digest: digestWithout({schema: CAMPAIGN_RESULT_SCHEMA, version: 1, status: "ACCEPTED", result_digest: result.digest, acceptance, digest: null}, "digest")};
}

