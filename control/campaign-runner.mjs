import crypto from "node:crypto";
import {assert, canonicalJson, digestWithout} from "./canonical-json.mjs";
import {validateGateGraph, findGate} from "./gate-model.mjs";
import {answerCurrent, createExecution, createExecutionAuthority} from "./gate-engine.mjs";
import {readGatePacket, readMeaningfulProgress, spawnNativeSession, closeNativeSession, abortNativeSession} from "./native-session.mjs";
import {toNativeAdmission, validateCampaignAdmission} from "./campaign-admission.mjs";
import {renderGateQuestion, validateQuestionCatalog} from "./question-catalog.mjs";
import {validateGateResponse} from "./gate-response.mjs";

export const CAMPAIGN_RESULT_SCHEMA = "agentos.campaign_result.v1";

function exactKeys(value, expected, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort()), `${label} fields mismatch`);
}

function digest(value, label) {
  assert(typeof value === "string" && /^[0-9a-f]{64}$/u.test(value), `${label} must be a SHA-256 digest`);
}

function proof(secret, result) {
  assert(typeof secret === "string" && secret.length >= 32, "campaign authority secret is required");
  return crypto.createHmac("sha256", secret).update(canonicalJson({...result, completion_proof: null, digest: null}), "utf8").digest("hex");
}

function meaningful(value, label) {
  exactKeys(value, ["result_type", "summary", "artifact_sha256", "evidence_sha256"], label);
  assert(["ARTIFACT", "VERIFIED_BEHAVIOR", "BOUNDED_HANDOFF"].includes(value.result_type), `${label}.result_type is not meaningful`);
  assert(typeof value.summary === "string" && value.summary.length > 0, `${label}.summary is required`);
  digest(value.artifact_sha256, `${label}.artifact_sha256`);
  digest(value.evidence_sha256, `${label}.evidence_sha256`);
}

function validateReviewerReadback(readback, result) {
  exactKeys(readback, ["thread_id", "host_id", "project_id", "campaign_id", "campaign_version", "goal_id", "lane_id", "role_id", "source_commit", "source_tree", "worktree_id"], "Auditor readback");
  for (const [value, label] of [[readback.thread_id, "Auditor readback.thread_id"], [readback.host_id, "Auditor readback.host_id"], [readback.project_id, "Auditor readback.project_id"], [readback.campaign_id, "Auditor readback.campaign_id"], [readback.campaign_version, "Auditor readback.campaign_version"], [readback.goal_id, "Auditor readback.goal_id"], [readback.lane_id, "Auditor readback.lane_id"], [readback.worktree_id, "Auditor readback.worktree_id"]]) assert(typeof value === "string" && value.length > 0, `${label} is required`);
  assert(readback.role_id === "INDEPENDENT_AUDITOR", "Auditor readback role is invalid");
  const binding = result.closed_session;
  for (const field of ["project_id", "campaign_id", "campaign_version", "goal_id", "lane_id", "source_commit", "source_tree", "worktree_id"]) assert(readback[field] === binding[field], `Auditor readback ${field} differs`);
  return readback;
}

function validateAuditCandidate(result, authority_secret) {
  digest(result.completion_proof, "completion_proof");
  assert(result.completion_proof === proof(authority_secret, result), "campaign completion proof is invalid");
  assert(result.execution && result.execution.status === "COMPLETE", "campaign execution is not complete");
  exactKeys(result.execution, ["schema", "version", "graph_id", "graph_digest", "execution_id", "status", "current_node", "step_count", "max_steps", "trace", "repair_visits", "binding", "result", "auth_tag"], "campaign execution");
  assert(result.execution.current_node === null && Array.isArray(result.execution.trace) && result.execution.trace.length === result.execution.step_count && result.execution.step_count > 0, "campaign execution trace is incomplete");
  assert(result.execution.result && result.execution.result.terminal_type === "COMPLETE", "campaign execution terminal is not COMPLETE");
  assert(result.execution.graph_digest === result.graph_digest, "campaign execution graph differs");
  assert(Array.isArray(result.gate_responses) && result.gate_responses.length === result.execution.trace.length, "campaign gate response count differs from execution trace");
  for (const [index, response] of result.gate_responses.entries()) {
    exactKeys(response, ["gate_id", "gate_name", "answer", "response_digest"], `campaign gate response ${index}`);
    assert(response.gate_id === result.execution.trace[index].gate_id, `campaign gate response ${index} gate differs from execution trace`);
    assert(typeof response.gate_name === "string" && response.gate_name.trim().length > 0, `campaign gate response ${index} name is missing`);
    assert(response.answer === "YES", `campaign gate response ${index} is not a pass`);
    digest(response.response_digest, `campaign gate response ${index}.response_digest`);
  }
  meaningful(result.progress, "campaign progress");
  assert(result.closed_session && result.closed_session.status === "CLOSED", "native session is not closed");
  meaningful(result.closed_session.handoff, "closed session handoff");
  exactKeys(result.closed_session, ["schema", "version", "status", "thread_id", "host_id", "project_id", "campaign_id", "campaign_version", "goal_id", "lane_id", "role_id", "source_commit", "source_tree", "worktree_id", "model", "reasoning_effort", "governance_digest", "handoff", "digest"], "closed native session");
  assert(result.closed_session.status === "CLOSED" && result.closed_session.digest === digestWithout(result.closed_session, "digest"), "closed native session digest is invalid");
  assert(result.closed_session.handoff.summary === result.progress.summary && result.closed_session.handoff.result_type === result.progress.result_type && result.closed_session.handoff.artifact_sha256 === result.progress.artifact_sha256 && result.closed_session.handoff.evidence_sha256 === result.progress.evidence_sha256, "closed handoff differs from progress");
  exactKeys(result.closure, ["order", "active_roster_removed"], "campaign closure");
  assert(JSON.stringify(result.closure.order) === JSON.stringify(["UNPIN", "ARCHIVE", "ROSTER_REMOVE", "ROSTER_VERIFY"]), "campaign closure order is incomplete");
  assert(result.closure.active_roster_removed === true, "campaign closure did not remove the active roster entry");
  assert(result.execution.binding.session_id === result.closed_session.host_id, "closed session does not match execution session");
}

export async function runLaneCampaign({host, admission, graph, question_catalog, authority_secret, evidence_secret}) {
  validateCampaignAdmission(admission);
  validateGateGraph(graph);
  validateQuestionCatalog(question_catalog);
  assert(typeof evidence_secret === "string" && evidence_secret.length >= 32, "campaign evidence attestation secret is required");
  assert(graph.graph_id === admission.lane_id.toUpperCase().replaceAll("-", "_"), "campaign graph does not match admitted lane");
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
    const expectedIdentity = {
      source_commit: admission.source.source_commit,
      source_tree: admission.source.source_tree,
      worktree_id: admission.source.worktree_id,
      session_id: session.host_id,
      goal_id: admission.goal_id,
      environment_id: admission.source.environment_id,
    };
    const packet = await readGatePacket(host, session, {renderedForGate: (gateId) => renderGateQuestion(graph, gateId, question_catalog)});
    const gate_responses = [];
    for (const item of packet) {
      assert(execution.status === "ACTIVE", "gate packet continued after execution terminal");
      const gate = findGate(graph, execution.current_node);
      assert(item.gate_id === gate.id, `gate packet expected ${gate.id} but received ${item.gate_id}`);
      const rendered = renderGateQuestion(graph, item.gate_id, question_catalog);
      const response = validateGateResponse(item.response, rendered, {evidence: item.evidence, expectedIdentity});
      gate_responses.push({gate_id: response.gate_id, gate_name: response.gate_name, answer: response.answer, response_digest: response.digest});
      execution = answerCurrent(execution, graph, item.answer, item.evidence, {authority, attestation_secret: evidence_secret});
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
      gate_responses,
      closed_session: closed.session,
      closure: closed.closure,
      completion_proof: null,
      digest: null,
    };
    result.completion_proof = proof(authority_secret, result);
    result.digest = digestWithout(result, "digest");
    return result;
  } catch (error) {
    if (session) {
      try { await abortNativeSession(host, session, "CAMPAIGN_FAILURE"); } catch (cleanupError) { error.cleanup_error = cleanupError.message; }
    }
    throw error;
  }
}

export const runFunctionalityCampaign = runLaneCampaign;

export function acceptCampaignResult(result, {reviewer_session_id, reviewer_role_id, reviewer_readback, evidence_sha256, accepted, reason, accepted_at_utc, authority_secret}) {
  exactKeys(result, ["schema", "version", "status", "admission_digest", "graph_digest", "execution", "progress", "gate_responses", "closed_session", "closure", "completion_proof", "digest"], "campaign result");
  assert(result.schema === CAMPAIGN_RESULT_SCHEMA && result.version === 1 && result.status === "AUDIT_CANDIDATE", "campaign result is not an audit candidate");
  digest(result.admission_digest, "admission_digest");
  digest(result.graph_digest, "graph_digest");
  assert(result.digest === digestWithout(result, "digest"), "campaign result digest does not match content");
  validateAuditCandidate(result, authority_secret);
  exactKeys({reviewer_session_id, reviewer_role_id, reviewer_readback, evidence_sha256, accepted, reason, accepted_at_utc, authority_secret}, ["reviewer_session_id", "reviewer_role_id", "reviewer_readback", "evidence_sha256", "accepted", "reason", "accepted_at_utc", "authority_secret"], "campaign acceptance");
  assert(typeof reviewer_session_id === "string" && reviewer_session_id.length > 0, "reviewer_session_id is required");
  assert(reviewer_session_id !== result.execution.binding.session_id, "worker cannot accept its own result");
  assert(reviewer_role_id === "INDEPENDENT_AUDITOR", "campaign acceptance requires an Independent Auditor");
  assert(reviewer_session_id === validateReviewerReadback(reviewer_readback, result).host_id, "reviewer session does not match Auditor readback");
  digest(evidence_sha256, "acceptance evidence_sha256");
  assert(accepted === true, "campaign result was not accepted");
  assert(typeof reason === "string" && reason.length > 0, "acceptance reason is required");
  assert(typeof accepted_at_utc === "string" && Number.isFinite(Date.parse(accepted_at_utc)), "accepted_at_utc is invalid");
  const acceptance = {reviewer_session_id, reviewer_role_id, evidence_sha256, accepted, reason, accepted_at_utc, digest: null};
  acceptance.digest = digestWithout(acceptance, "digest");
  return {schema: CAMPAIGN_RESULT_SCHEMA, version: 1, status: "ACCEPTED", result_digest: result.digest, acceptance, digest: digestWithout({schema: CAMPAIGN_RESULT_SCHEMA, version: 1, status: "ACCEPTED", result_digest: result.digest, acceptance, digest: null}, "digest")};
}
