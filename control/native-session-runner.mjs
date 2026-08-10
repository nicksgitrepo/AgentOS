#!/usr/bin/env node

/*
 * Bounded native-session wave orchestrator.
 *
 * The team controller owns host binding, identity validation, lifecycle state,
 * and closure. This module only aggregates one admitted wave, validates the
 * returned work, and serializes a privacy-safe run record.
 */

import crypto from "node:crypto";
import {
  NATIVE_SESSION_TOOLS,
  NATIVE_TEAM_PLAN_SCHEMA,
  NATIVE_IMPLEMENTATION_TEAM_PLAN_SCHEMA,
  DEFAULT_PROGRESS_REVIEW_MINUTES,
  createNativeSessionTeam,
  validateNativeCampaignTeamPlan,
  validateNativeImplementationTeamPlan,
} from "./native-session-team.mjs";
import {
  TASK_GATE_CATALOG_SHA256,
  TASK_GATE_CONTEXTS,
  validateTaskGateAnswerSet,
} from "./task-gate-questions.mjs";
import {compileNativeSessionHostSpawnAttestation} from "./native-session-host-attestation.mjs";
import {
  compileRedactedRecord,
  redactPersistedRecord,
  validateRedactedRecord,
} from "./persisted-record-privacy.mjs";
import {validateDigestBoundCheckpoint} from "./repair-governance.mjs";

const SHA256 = /^[0-9a-f]{64}$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const NATIVE_SESSION_RUN_SCHEMA = "agentos.native_session_team_run.v1";
export const NATIVE_SESSION_RUN_STATUS = Object.freeze(["TEAM_COMPLETED", "TEAM_FAILED", "TEAM_UNAVAILABLE"]);
export const NATIVE_SESSION_LIFECYCLE = "SPAWN_BIND_PIN_WORK_READBACK_UNPIN_ARCHIVE_REMOVE_VERIFY";

function assert(condition, message) { if (!condition) throw new Error(message); }
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function requireRecord(value, label) { assert(isRecord(value), `${label} must be an object`); }
function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains control characters`);
}
function requireThreadId(value, label) {
  requireString(value, label);
  assert(THREAD_ID.test(value), `${label} is not a real host thread identity`);
  assert(!/(?:agent|subagent|task)[-_]/iu.test(value), `${label} is a task or subagent identity, not a host thread`);
}
function requireSha(value, label) { assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`); }
function requireUtc(value, label) {
  requireString(value, label);
  assert(ISO_UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} must be UTC`);
}
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
}
function digestWithout(value, field) {
  const body = structuredClone(value);
  body[field] = null;
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(body)), "utf8").digest("hex");
}
function planValidator(plan) {
  if (plan.schema === NATIVE_TEAM_PLAN_SCHEMA) return validateNativeCampaignTeamPlan;
  assert(plan.schema === NATIVE_IMPLEMENTATION_TEAM_PLAN_SCHEMA, "native session team plan schema is not admitted");
  return validateNativeImplementationTeamPlan;
}
function sourceReadback(readback, expected, label) {
  requireRecord(readback, label);
  for (const field of ["project_id", "source_commit", "source_tree"]) {
    requireString(readback[field], `${label}.${field}`);
    assert(readback[field] === expected[field], `${label}.${field} differs from the exact source binding`);
  }
}
function completionFrom(waitReadback, finalReadback, session, expected) {
  const result = {...(isRecord(waitReadback) ? waitReadback : {}), ...(isRecord(finalReadback) ? finalReadback : {})};
  requireRecord(result, `${session.role} completion readback`);
  assert(result.status === "COMPLETED", `${session.role} did not return a completed result`);
  requireThreadId(result.thread_id ?? result.threadId, `${session.role} completion thread ID`);
  assert((result.thread_id ?? result.threadId) === session.thread_id, `${session.role} completion thread differs from spawn`);
  sourceReadback(result, expected, `${session.role} completion`);
  for (const field of ["worktree_path", "build_identity", "environment_id"]) requireString(result[field], `${session.role} completion ${field}`);
  assert(result.meaningful_progress === true, `${session.role} returned no meaningful progress`);
  requireSha(result.handoff_sha256, `${session.role} handoff digest`);
  requireSha(result.result_sha256, `${session.role} result digest`);
  assert(Array.isArray(result.changed_paths), `${session.role} changed paths are missing`);
  assert(result.changed_paths.every((item) => typeof item === "string" && item.length > 0 && !item.startsWith("/") && !item.split("/").includes("..")), `${session.role} changed paths are not portable`);
  assert(result.task_gate_catalog_sha256 === TASK_GATE_CATALOG_SHA256, `${session.role} task-gate catalog binding differs`);
  requireRecord(result.task_gate_answers, `${session.role} task-gate answers`);
  assert(JSON.stringify(Object.keys(result.task_gate_answers).sort()) === JSON.stringify([...TASK_GATE_CONTEXTS].sort()), `${session.role} task-gate contexts are incomplete`);
  const expectedTaskBinding = {
    source_commit: expected.source_commit,
    source_tree: expected.source_tree,
    worktree_id: result.worktree_path,
    session_id: session.thread_id,
    build_identity: result.build_identity,
    environment_id: result.environment_id,
  };
  let taskBinding = null;
  for (const context of TASK_GATE_CONTEXTS) {
    const evaluation = validateTaskGateAnswerSet({context, answers: result.task_gate_answers[context], expectedBinding: expectedTaskBinding});
    assert(evaluation.status === "PASS", `${session.role} ${context} task gates did not pass`);
    if (taskBinding === null) taskBinding = evaluation.binding;
    else for (const field of ["goal_id", "goal_sha256"]) assert(evaluation.binding[field] === taskBinding[field], `${session.role} task-gate goal identity differs across contexts`);
  }
  return result;
}
function handoffForClosure(completion) {
  return {
    schema: "agentos.native_session_typed_handoff.v1",
    version: 1,
    status: "COMPLETED",
    result_sha256: completion.result_sha256,
    handoff_sha256: completion.handoff_sha256,
    changed_paths: [...completion.changed_paths],
  };
}
function requireCheckpointJoin(checkpoint, sourceBinding) {
  if (checkpoint === null) {
    const error = new Error("DIGEST_BOUND_CHECKPOINT_REQUIRED: native session completion requires a validated checkpoint");
    error.code = "DIGEST_BOUND_CHECKPOINT_REQUIRED";
    throw error;
  }
  validateDigestBoundCheckpoint(checkpoint, "native session checkpoint");
  assert(checkpoint.source_commit === sourceBinding.source_commit
    && checkpoint.source_tree === sourceBinding.source_tree,
  "native session checkpoint source differs from the wave source binding");
  return checkpoint;
}
function compileRunRecord({plan, status, sessions, completion, roster, checkpoint = null, observedAtUtc, error = null, failureBoundary = null}) {
  const privatePayload = redactPersistedRecord({sessions, completion, active_roster: roster, error});
  const categories = Object.entries(privatePayload.redaction_counts).filter(([, count]) => count > 0).map(([category]) => category);
  const privacy = compileRedactedRecord({
    sourceDigest: privatePayload.original_value_sha256,
    originalDigest: privatePayload.original_value_sha256,
    schemaHint: NATIVE_SESSION_RUN_SCHEMA,
    capabilityLabels: ["HOST_BOUNDARY_ONLY", "OPAQUE_RECORD", "PRIVACY_REDACTED", ...categories],
    redactionCounts: privatePayload.redaction_counts,
  });
  const body = {
    schema: NATIVE_SESSION_RUN_SCHEMA,
    version: 1,
    status,
    team_id: plan.team_id,
    project_id: plan.project_id,
    campaign_id: plan.campaign_id,
    campaign_version: plan.campaign_version,
    model: plan.model,
    reasoning_effort: plan.reasoning_effort,
    topology: plan.topology,
    lifecycle: NATIVE_SESSION_LIFECYCLE,
    sessions: privatePayload.record.sessions,
    completion: privatePayload.record.completion,
    active_roster: privatePayload.record.active_roster,
    checkpoint: checkpoint === null ? null : structuredClone(checkpoint),
    error: privatePayload.record.error,
    failure_boundary: failureBoundary,
    privacy,
    observed_at_utc: observedAtUtc,
    run_sha256: null,
  };
  body.run_sha256 = digestWithout(body, "run_sha256");
  return body;
}
function validateRunRecord(record) {
  requireRecord(record, "native session run record");
  assert(record.schema === NATIVE_SESSION_RUN_SCHEMA && record.version === 1, "native session run identity is invalid");
  assert(NATIVE_SESSION_RUN_STATUS.includes(record.status), "native session run status is invalid");
  for (const field of ["team_id", "project_id", "campaign_id", "campaign_version", "model", "reasoning_effort"]) requireString(record[field], `native session run ${field}`);
  assert(record.topology === "INDEPENDENT_SIBLING_SESSIONS" && record.lifecycle === NATIVE_SESSION_LIFECYCLE, "native session lifecycle is incomplete");
  assert(Array.isArray(record.sessions) && Array.isArray(record.active_roster), "native session run arrays are missing");
  if (record.checkpoint !== undefined && record.checkpoint !== null) {
    validateDigestBoundCheckpoint(record.checkpoint, "native session run checkpoint");
  }
  if (record.status === "TEAM_COMPLETED") {
    assert(record.checkpoint !== undefined && record.checkpoint !== null, "completed native session run lacks a digest-bound checkpoint");
  }
  assert(record.status === "TEAM_COMPLETED" ? record.active_roster.length === 0 : true, "completed native team left active roster entries");
  validateRedactedRecord(record.privacy);
  requireUtc(record.observed_at_utc, "native session run time");
  if (record.error !== null) requireString(record.error, "native session run error");
  if (record.failure_boundary !== null) requireRecord(record.failure_boundary, "native session run failure boundary");
  requireSha(record.run_sha256, "native session run digest");
  assert(record.run_sha256 === digestWithout(record, "run_sha256"), "native session run digest mismatch");
  return record;
}
async function closeRemaining(team) {
  const errors = [];
  for (const session of team.roster()) {
    try {
      let current = session;
      if (current.archived !== true) current = (await team.archive(current)).session;
      await team.removeFromRoster(current);
    } catch (error) {
      errors.push(error?.message ?? String(error));
    }
  }
  return {active_roster: team.roster(), errors};
}
function classifyUnavailable(error) {
  return [
    "NATIVE_SESSION_TOOLING_UNAVAILABLE",
    "NATIVE_HOST_ATTACHMENT_REQUIRED",
    "NATIVE_HOST_ATTACHMENT_INVALID",
    "HOST_MODEL_REASONING_READBACK_UNAVAILABLE",
  ].some((marker) => error?.message?.includes(marker) || error?.code === marker);
}

export async function runNativeSessionTeam({plan, host, hostAttachment = null, sourceBinding, checkpoint = null, observedAtUtc, predecessorSessionId = null, progressWindowMinutes = DEFAULT_PROGRESS_REVIEW_MINUTES} = {}) {
  planValidator(plan)(plan);
  requireRecord(sourceBinding, "native session source binding");
  for (const field of ["project_id", "cwd", "git_top_level", "source_commit", "source_tree"]) requireString(sourceBinding[field], `native session source binding ${field}`);
  assert(plan.project_id === sourceBinding.project_id, "native session plan project differs from source binding");
  for (const request of plan.roles) {
    assert(request.project_id === sourceBinding.project_id, `${request.role} project differs from source binding`);
    assert(request.source_commit === sourceBinding.source_commit && request.source_tree === sourceBinding.source_tree, `${request.role} source differs from source binding`);
  }
  requireUtc(observedAtUtc, "native session run time");
  assert(Number.isInteger(progressWindowMinutes) && progressWindowMinutes >= 1 && progressWindowMinutes <= 240, "native session progress window must be an integer from 1 to 240 minutes");
  const sessions = [];
  const completion = [];
  const attestations = [];
  let boundCheckpoint = null;
  let team = null;
  try {
    boundCheckpoint = requireCheckpointJoin(checkpoint, sourceBinding);
    team = createNativeSessionTeam({
      host,
      hostAttachment,
      projectId: plan.project_id,
      teamId: plan.team_id,
      campaignId: plan.campaign_id,
      campaignVersion: plan.campaign_version,
      model: plan.model,
      reasoningEffort: plan.reasoning_effort,
      projectBinding: sourceBinding,
      acceptRequestedIdentityWithoutReadback: true,
      now: () => observedAtUtc,
    });
    for (const request of plan.roles) {
      const spawned = await team.spawn(request, {predecessorSessionId});
      assert(spawned.status === "THREAD_BOUND" && spawned.session !== null, `${request.role} did not bind a native session`);
      const attestation = compileNativeSessionHostSpawnAttestation({request, hostResponse: spawned.host_readback, observedAtUtc});
      attestations.push(attestation);
      const pinned = await team.pin(spawned.session);
      sessions.push({...pinned.session, spawn_attestation_sha256: attestation.attestation_sha256});
    }
    for (let index = 0; index < sessions.length; index += 1) {
      const session = sessions[index];
      const waited = await team.wait(session, progressWindowMinutes * 60 * 1000);
      const waitedReadback = waited.readback.host_readback;
      const observed = await team.readback(session);
      const result = completionFrom(waitedReadback, observed.readback.host_readback, session, sourceBinding);
      completion.push(result);
    }
    for (let index = 0; index < sessions.length; index += 1) {
      const session = sessions[index];
      await team.send(session, `Return the typed handoff for ${session.role} before closure.`);
      const finalReadback = await team.readback(session);
      const final = completionFrom(completion[index], finalReadback.readback.host_readback, session, sourceBinding);
      completion[index] = final;
      const closed = await team.close(session, handoffForClosure(final));
      sessions[index] = closed.removal.session;
    }
    assert(team.roster().length === 0, "native session closure left an active roster entry");
    const record = compileRunRecord({plan, status: "TEAM_COMPLETED", sessions, completion, roster: [], checkpoint: boundCheckpoint, observedAtUtc});
    record.attestations = attestations.map((attestation) => ({attestation_sha256: attestation.attestation_sha256, execution_identity_status: attestation.execution_identity_status}));
    record.run_sha256 = digestWithout(record, "run_sha256");
    return validateRunRecord(record);
  } catch (error) {
    const cleanup = team === null ? {active_roster: [], errors: []} : await closeRemaining(team);
    const cleanupMessage = cleanup.errors.length > 0 ? `; cleanup: ${cleanup.errors.join("; ")}` : "";
    const record = compileRunRecord({
      plan,
      status: classifyUnavailable(error) ? "TEAM_UNAVAILABLE" : "TEAM_FAILED",
      sessions,
      completion,
      roster: cleanup.active_roster,
      checkpoint: boundCheckpoint,
      observedAtUtc,
      error: `${error?.message ?? String(error)}${cleanupMessage}`,
      failureBoundary: error?.boundary ?? null,
    });
    record.attestations = attestations.map((attestation) => ({attestation_sha256: attestation.attestation_sha256, execution_identity_status: attestation.execution_identity_status}));
    record.run_sha256 = digestWithout(record, "run_sha256");
    return validateRunRecord(record);
  }
}

export {validateRunRecord};
