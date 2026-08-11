#!/usr/bin/env node

import {
  APPRENTICESHIP_MODE,
  APPRENTICESHIP_VERSION,
  assert,
  assertNonActivating,
  assertPortableRecord,
  canonicalDigest,
  exactKeys,
  isRecord,
  nonEmptyArray,
  protectedActions,
  requireIdentifier,
  requireSafeReference,
  requireSha256,
  requireString,
  validateDigest,
  validateEvidenceRefs,
  validateProvenance,
  validateProtectedActions,
  validateTimestamp,
  withDigest,
} from "./apprenticeship-common.mjs";
import {
  UNIVERSAL_TASK_CLOSEOUT_AUTHORITIES,
  UNIVERSAL_TASK_CLOSEOUT_SEQUENCE,
  validateUniversalTaskCloseoutReceipts,
} from "./governance-library.mjs";
import {
  compileEvidenceAttestation,
  validateEvidenceAttestation,
} from "./apprenticeship-contract-hardening.mjs";
import {
  APPRENTICESHIP_LIFECYCLE_OPERATIONS,
  APPRENTICESHIP_NATIVE_HOST_TOOLS,
  APPRENTICESHIP_WORKER_ROLE,
  validateApprenticeshipRolePacket,
} from "./apprenticeship-role-packet.mjs";
import {compileTaskObservation} from "./apprenticeship-observation.mjs";
import {bindNativeHost, validateNativeHostAdapter, validateNativeHostAttachment} from "./native-host-attachment.mjs";

export const APPRENTICESHIP_NATIVE_RUN_SCHEMA = "agentos.apprenticeship_native_observation_run.v1";
export const APPRENTICESHIP_NATIVE_RUN_STATUSES = Object.freeze([
  "REAL_RESULT_OBSERVED",
  "NO_MEANINGFUL_RESULT",
]);

const SHA256 = /^[0-9a-f]{64}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const RESULT_KINDS = new Set([
  "MEANINGFUL_RESULT",
  "HEARTBEAT_ONLY",
  "WAITING",
  "FAILURE_LIST",
  "TRUE_BLOCKER",
  "SOFT_BOUNDARY_REVIEW",
  "NO_RESULT",
]);

export class ApprenticeshipNativeBoundaryError extends Error {
  constructor(code, message, cause = null) {
    super(`${code}: ${message}`);
    this.name = "ApprenticeshipNativeBoundaryError";
    this.code = code;
    if (cause !== null) this.cause = cause;
  }
}

function boundary(code, message, cause = null) {
  return new ApprenticeshipNativeBoundaryError(code, message, cause);
}

function requireObject(value, label) {
  assert(isRecord(value), `${label} must be an object`);
  return value;
}

function requireRuntimeBinding(value) {
  requireObject(value, "apprenticeship native runtime binding");
  ["project_id", "campaign_id", "campaign_version", "environment_id", "cwd", "git_top_level", "source_commit", "source_tree"].forEach((field) => requireString(value[field], `apprenticeship native runtime binding ${field}`));
  return value;
}

function requireUtc(value, label) {
  requireString(value, label);
  assert(ISO_UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} must be UTC`);
  return value;
}

function requireHostThreadId(value, label) {
  requireString(value, label);
  assert(UUID.test(value), `${label} must be a host thread identity`);
  return value;
}

function threadIdFrom(readback, label) {
  return requireHostThreadId(readback.thread_id ?? readback.threadId, `${label} thread ID`);
}

function hostIdFrom(readback, label) {
  return requireString(readback.host_id ?? readback.hostId, `${label} host ID`);
}

function validateSourceReadback(readback, runtimeBinding, label) {
  for (const field of ["project_id", "cwd", "git_top_level", "source_commit", "source_tree"]) {
    requireString(readback[field], `${label}.${field}`);
    assert(readback[field] === runtimeBinding[field], `${label}.${field} differs from the bound source`);
  }
}

function validateBoundaryMarkers(readback, label) {
  const boundaryStatus = readback.boundary_status ?? readback.boundary;
  if (boundaryStatus === "HARD_STOP" || readback.hard_boundary === true) throw boundary("APPRENTICESHIP_HARD_BOUNDARY", `${label} reported a hard boundary`);
  if (boundaryStatus === "SOFT_REVIEW" || readback.soft_boundary === true) throw boundary("APPRENTICESHIP_SOFT_BOUNDARY_REVIEW", `${label} reported a soft boundary`);
  if (readback.shared_file_conflict === true) throw boundary("APPRENTICESHIP_SHARED_FILE_CONFLICT", `${label} reported a shared-file conflict`);
}

function validateThreadActionReadback(readback, session, runtimeBinding, operation, expected) {
  requireObject(readback, `${operation} host readback`);
  const threadId = threadIdFrom(readback, operation);
  assert(threadId === session.thread_id, `${operation} returned a different host thread`);
  const hostId = hostIdFrom(readback, operation);
  assert(hostId === session.host_id, `${operation} returned a different host identity`);
  validateSourceReadback(readback, runtimeBinding, operation);
  if (readback.ok === false || readback.success === false || ["FAILED", "ERROR"].includes(readback.status)) throw boundary("APPRENTICESHIP_HOST_READBACK_FAILED", `${operation} host action failed`);
  if (Object.hasOwn(readback, "pinned")) assert(readback.pinned === expected.pinned, `${operation} pinned state is wrong`);
  if (Object.hasOwn(readback, "archived")) assert(readback.archived === expected.archived, `${operation} archived state is wrong`);
  validateBoundaryMarkers(readback, operation);
  return readback;
}

function validateWaitReadback(readback, session, runtimeBinding) {
  requireObject(readback, "wait host readback");
  assert(Array.isArray(readback.results), "wait host readback results are missing");
  assert(readback.results.length === 1, "apprenticeship worker wait must return exactly one result");
  validateThreadActionReadback(readback.results[0], session, runtimeBinding, "wait", {pinned: true, archived: false});
  validateBoundaryMarkers(readback, "wait");
  return readback;
}

function validateRosterReadback(readback, session, runtimeBinding) {
  requireObject(readback, "active roster host readback");
  const threads = readback.active_roster ?? readback.activeRoster ?? readback.threads;
  assert(Array.isArray(threads), "active roster host readback is missing a thread list");
  if (readback.project_id !== undefined) assert(readback.project_id === runtimeBinding.project_id, "active roster project differs from the bound source");
  const own = threads.filter((thread) => (thread.thread_id ?? thread.threadId) === session.thread_id);
  if (readback.active_roster !== undefined || readback.activeRoster !== undefined) {
    assert(own.length === 0, "closed apprenticeship worker remains in the authoritative active roster");
  } else {
    own.forEach((thread) => {
      assert(thread.archived === true && thread.pinned !== true && thread.active !== true, "closed apprenticeship worker remains active in the host roster");
    });
  }
  validateBoundaryMarkers(readback, "active roster");
  return readback;
}

function mergeCompletion(waitResult, finalReadback) {
  return {
    ...waitResult,
    ...finalReadback,
    status: finalReadback.status ?? waitResult.status,
    meaningful_progress: finalReadback.meaningful_progress ?? waitResult.meaningful_progress,
    result_sha256: finalReadback.result_sha256 ?? waitResult.result_sha256,
    handoff_sha256: finalReadback.handoff_sha256 ?? waitResult.handoff_sha256,
    changed_paths: finalReadback.changed_paths ?? waitResult.changed_paths,
    result_kind: finalReadback.result_kind ?? waitResult.result_kind,
  };
}

function validateCompletionReadback(readback, session, runtimeBinding) {
  validateThreadActionReadback(readback, session, runtimeBinding, "final handoff read", {pinned: true, archived: false});
  assert(readback.status === "COMPLETED", "apprenticeship worker did not return a completed result");
  assert(typeof readback.meaningful_progress === "boolean", "apprenticeship worker meaningful-progress result is missing");
  requireSha256(readback.result_sha256, "apprenticeship worker result digest");
  requireSha256(readback.handoff_sha256, "apprenticeship worker handoff digest");
  assert(Array.isArray(readback.changed_paths), "apprenticeship worker changed paths are missing");
  readback.changed_paths.forEach((item) => {
    requireString(item, "apprenticeship worker changed path");
    assert(!item.startsWith("/") && !/^[A-Za-z]:[\\/]/u.test(item), "apprenticeship worker changed path is not portable");
  });
  validateBoundaryMarkers(readback, "final handoff read");
  return readback;
}

function bindObservationProvenance(packet, workerSessionRef) {
  const provenance = structuredClone(packet.provenance);
  if (provenance.worker_session_ref !== null) assert(provenance.worker_session_ref === workerSessionRef, "role packet worker session binding is stale");
  provenance.worker_session_ref = workerSessionRef;
  if (provenance.learner_ref !== null) assert(provenance.learner_ref === provenance.worker_ref, "role packet learner identity differs from worker");
  provenance.learner_ref = provenance.worker_ref;
  if (provenance.learner_session_ref !== null) assert(provenance.learner_session_ref === workerSessionRef, "role packet learner session binding is stale");
  provenance.learner_session_ref = workerSessionRef;
  validateProvenance(provenance, {requiredRefs: ["worker_ref", "worker_session_ref", "orchestrator_ref", "orchestrator_session_ref", "model_ref"]});
  return provenance;
}

function hostSessionReference({packet, threadId, hostId, runtimeBinding}) {
  return `digest:${canonicalDigest({
    kind: "apprenticeship-worker-session",
    worker_ref: packet.provenance.worker_ref,
    thread_id: threadId,
    host_id: hostId,
    source_commit: runtimeBinding.source_commit,
    source_tree: runtimeBinding.source_tree,
  })}`;
}

function compileHostEvidence({operation, readback, provenance, hostAttachment, workerSessionRef, observedAt, sequence}) {
  const rawReadbackDigest = canonicalDigest(readback);
  const evidenceRef = `digest:${rawReadbackDigest}`;
  const attestorRef = `digest:${hostAttachment.digest}`;
  const attestorSessionRef = `digest:${canonicalDigest({host: hostAttachment.digest, worker_session: workerSessionRef, operation})}`;
  const attestation = compileEvidenceAttestation({
    attestationId: `ATTEST-${String(sequence).padStart(3, "0")}`,
    attestationType: "HOST_READBACK",
    authority: "EXTERNAL_HOST",
    subjectRef: provenance.worker_ref,
    subjectSessionRef: workerSessionRef,
    operation,
    resultStatus: "SUCCEEDED",
    evidenceRef,
    evidenceSha256: rawReadbackDigest,
    attestorRef,
    attestorSessionRef,
    provenance,
    sourceMatch: true,
    scopeMatch: true,
    identityMatch: true,
    boundaryDecision: "IN_SCOPE",
    observedAt,
  });
  validateEvidenceAttestation(attestation);
  return {
    evidenceRef,
    attestation,
    receipt: {
      sequence,
      operation,
      receipt_ref: `digest:${attestation.digest}`,
      evidence_attestation_ref: `digest:${attestation.digest}`,
      evidence_ref: evidenceRef,
      authority: "HOST_READBACK",
      status: "SUCCEEDED",
      observed_at: observedAt,
    },
  };
}

function compileActionRecord({sequence, operation, action, packet, resultRef, evidenceRefs, observedAt}) {
  return {
    sequence,
    action_id: `ACT-${String(sequence).padStart(3, "0")}`,
    action,
    tool_class: "EXTERNAL_NATIVE_HOST",
    observation_basis: "DIRECT_OBSERVATION",
    scope: [...packet.bounded_scope],
    preconditions: ["SOURCE_BOUND", "SCOPE_BOUND", "EXTERNAL_HOST_ATTACHED"],
    decision_boundary: "Stop on source, scope, identity, host, hard-boundary, soft-boundary, or shared-file mismatch.",
    result_ref: resultRef,
    evidence_refs: [...evidenceRefs],
    source_match: true,
    scope_match: true,
    observed_at: observedAt,
  };
}

function resultKindFor(readback) {
  if (readback.meaningful_progress === true) return "MEANINGFUL_RESULT";
  return RESULT_KINDS.has(readback.result_kind) && readback.result_kind !== "MEANINGFUL_RESULT" ? readback.result_kind : "NO_RESULT";
}

function validateNativeRunReceipt(receipt, index) {
  exactKeys(receipt, [
    "sequence",
    "operation",
    "receipt_ref",
    "evidence_attestation_ref",
    "evidence_ref",
    "authority",
    "status",
    "observed_at",
  ], `apprenticeship native run receipt ${index}`);
  assert(Number.isSafeInteger(receipt.sequence) && receipt.sequence === index + 1, `apprenticeship native run receipt ${index} sequence is invalid`);
  assert(APPRENTICESHIP_LIFECYCLE_OPERATIONS.includes(receipt.operation), `apprenticeship native run receipt ${index} operation is invalid`);
  requireSafeReference(receipt.receipt_ref, `apprenticeship native run receipt ${index} reference`);
  requireSafeReference(receipt.evidence_attestation_ref, `apprenticeship native run receipt ${index} attestation reference`);
  requireSafeReference(receipt.evidence_ref, `apprenticeship native run receipt ${index} evidence reference`);
  assert(receipt.authority === "HOST_READBACK", `apprenticeship native run receipt ${index} is not host-authoritative`);
  assert(receipt.status === "SUCCEEDED", `apprenticeship native run receipt ${index} did not succeed`);
  validateTimestamp(receipt.observed_at, `apprenticeship native run receipt ${index} timestamp`);
  assertPortableRecord(receipt, `apprenticeship native run receipt ${index}`);
}

function compileNativeRun({runId, packet, provenance, hostAttachment, receipts, attestations, universalCloseoutReceipts, observation, resultRef, status, startedAt, completedAt}) {
  const run = withDigest({
    schema: APPRENTICESHIP_NATIVE_RUN_SCHEMA,
    version: APPRENTICESHIP_VERSION,
    mode: APPRENTICESHIP_MODE,
    run_id: runId,
    status,
    packet_digest: packet.digest,
    provenance: structuredClone(provenance),
    host_capability_ref: `digest:${hostAttachment.digest}`,
    lifecycle_receipts: structuredClone(receipts),
    universal_closeout_receipts: structuredClone(universalCloseoutReceipts),
    evidence_attestation_refs: attestations.map((attestation) => `digest:${attestation.digest}`),
    observation_digest: observation.digest,
    result_ref: resultRef,
    active_roster_absent: true,
    activation_allowed: false,
    protected_actions: protectedActions(),
    started_at: startedAt,
    completed_at: completedAt,
    digest: null,
  });
  validateApprenticeshipNativeRun(run, {packet, observation});
  return run;
}

export function validateApprenticeshipNativeRun(run, {packet = null, observation = null} = {}) {
  exactKeys(run, [
    "schema",
    "version",
    "mode",
    "run_id",
    "status",
    "packet_digest",
    "provenance",
    "host_capability_ref",
    "lifecycle_receipts",
    "universal_closeout_receipts",
    "evidence_attestation_refs",
    "observation_digest",
    "result_ref",
    "active_roster_absent",
    "activation_allowed",
    "protected_actions",
    "started_at",
    "completed_at",
    "digest",
  ], "apprenticeship native observation run");
  assert(run.schema === APPRENTICESHIP_NATIVE_RUN_SCHEMA && run.version === APPRENTICESHIP_VERSION, "apprenticeship native observation run identity is invalid");
  assert(run.mode === APPRENTICESHIP_MODE, "apprenticeship native observation run mode is invalid");
  requireIdentifier(run.run_id, "apprenticeship native observation run ID");
  assert(APPRENTICESHIP_NATIVE_RUN_STATUSES.includes(run.status), "apprenticeship native observation run status is invalid");
  requireSha256(run.packet_digest, "apprenticeship native observation packet digest");
  validateProvenance(run.provenance, {requiredRefs: ["worker_ref", "worker_session_ref", "orchestrator_ref", "orchestrator_session_ref", "model_ref"]});
  requireSafeReference(run.host_capability_ref, "apprenticeship native host capability reference");
  nonEmptyArray(run.lifecycle_receipts, "apprenticeship native lifecycle receipts");
  run.lifecycle_receipts.forEach(validateNativeRunReceipt);
  const operations = run.lifecycle_receipts.map((receipt) => receipt.operation);
  ["create_thread", "pin", "send", "wait", "read", "unpin", "archive", "post_close_read", "active_list_absent"].forEach((operation) => assert(operations.includes(operation), `apprenticeship native run is missing ${operation} receipt`));
  validateUniversalTaskCloseoutReceipts(run.universal_closeout_receipts, {closed: true, label: "apprenticeship native universal closeout receipts"});
  validateEvidenceRefs(run.evidence_attestation_refs, "apprenticeship native evidence attestations");
  requireSha256(run.observation_digest, "apprenticeship native observation digest");
  requireSafeReference(run.result_ref, "apprenticeship native result reference");
  assert(run.active_roster_absent === true, "apprenticeship native run must prove zero active worker roster entries");
  assert(run.activation_allowed === false, "apprenticeship native run cannot allow activation");
  validateProtectedActions(run.protected_actions, "apprenticeship native protected actions");
  validateTimestamp(run.started_at, "apprenticeship native run start timestamp");
  validateTimestamp(run.completed_at, "apprenticeship native run completion timestamp");
  if (packet !== null) {
    validateApprenticeshipRolePacket(packet);
    assert(run.packet_digest === packet.digest, "apprenticeship native run packet binding differs");
  }
  if (observation !== null) assert(run.observation_digest === observation.digest, "apprenticeship native run observation binding differs");
  if (run.status === "REAL_RESULT_OBSERVED") assert(run.result_ref !== null, "real apprenticeship result requires a result reference");
  assertNonActivating(run, "apprenticeship native observation run");
  assertPortableRecord(run, "apprenticeship native observation run");
  validateDigest(run, "apprenticeship native observation run");
  return run;
}

function requireCloseoutCallback(closeout, name) {
  assert(isRecord(closeout) && typeof closeout[name] === "function", `apprenticeship native closeout requires ${name} callback`);
}

async function controllerCloseoutReceipt(closeout, callbackName, step, context, sequence) {
  requireCloseoutCallback(closeout, callbackName);
  const result = await closeout[callbackName](context);
  requireObject(result, `${step} closeout callback result`);
  if (result.receipt_sha256 !== undefined) requireSha256(result.receipt_sha256, `${step} closeout receipt digest`);
  const receiptRef = result.receipt_ref ?? (typeof result.receipt_sha256 === "string" ? `digest:${result.receipt_sha256}` : null);
  assert(typeof receiptRef === "string", `${step} closeout callback did not return a receipt reference`);
  const observed = result.observed_at;
  requireString(observed, `${step} closeout observation time`);
  const receipt = {
    sequence,
    step,
    receipt_ref: receiptRef,
    authority: UNIVERSAL_TASK_CLOSEOUT_AUTHORITIES[step],
    status: "PROVEN",
    observed_at: observed,
  };
  return receipt;
}

async function closeSession({boundHost, session, runtimeBinding, receipts, attestations, provenance, observedAt, handoffSha256, closeout}) {
  const universalCloseoutReceipts = [];
  universalCloseoutReceipts.push(await controllerCloseoutReceipt(closeout, "preserveHandoff", "PRESERVE_HANDOFF", {session: structuredClone(session), handoff_sha256: handoffSha256}, 1));
  universalCloseoutReceipts.push(await controllerCloseoutReceipt(closeout, "persistHandoff", "PERSIST_HANDOFF", {session: structuredClone(session), handoff_sha256: handoffSha256}, 2));
  universalCloseoutReceipts.push(await controllerCloseoutReceipt(closeout, "auditCandidate", "AUDIT_CANDIDATE", {session: structuredClone(session), handoff_sha256: handoffSha256}, 3));
  universalCloseoutReceipts.push(await controllerCloseoutReceipt(closeout, "integrateAcceptedWork", "INTEGRATE_ACCEPTED_WORK", {session: structuredClone(session), handoff_sha256: handoffSha256}, 4));

  const unpinned = await boundHost.set_thread_pinned({threadId: session.thread_id, pinned: false});
  validateThreadActionReadback(unpinned, session, runtimeBinding, "unpin", {pinned: false, archived: false});
  let evidence = compileHostEvidence({operation: "unpin", readback: unpinned, provenance, hostAttachment: session.host_attachment, workerSessionRef: session.session_ref, observedAt, sequence: receipts.length + 1});
  receipts.push(evidence.receipt);
  attestations.push(evidence.attestation);
  universalCloseoutReceipts.push({
    sequence: 5,
    step: "UNPIN_SESSION",
    receipt_ref: `digest:${evidence.attestation.digest}`,
    authority: UNIVERSAL_TASK_CLOSEOUT_AUTHORITIES.UNPIN_SESSION,
    status: "PROVEN",
    observed_at: observedAt,
  });

  universalCloseoutReceipts.push(await controllerCloseoutReceipt(closeout, "closeStaleWorktree", "CLOSE_STALE_WORKTREE", {session: structuredClone(session), handoff_sha256: handoffSha256}, 6));
  universalCloseoutReceipts.push(await controllerCloseoutReceipt(closeout, "removeActiveTaskScope", "REMOVE_ACTIVE_TASK_SCOPE", {session: structuredClone(session), handoff_sha256: handoffSha256}, 7));
  universalCloseoutReceipts.push(await controllerCloseoutReceipt(closeout, "markChatOutOfScope", "MARK_CHAT_OUT_OF_SCOPE", {session: structuredClone(session), handoff_sha256: handoffSha256}, 8));

  const archived = await boundHost.set_thread_archived({threadId: session.thread_id, archived: true});
  validateThreadActionReadback(archived, session, runtimeBinding, "archive", {pinned: false, archived: true});
  evidence = compileHostEvidence({operation: "archive", readback: archived, provenance, hostAttachment: session.host_attachment, workerSessionRef: session.session_ref, observedAt, sequence: receipts.length + 1});
  receipts.push(evidence.receipt);
  attestations.push(evidence.attestation);
  universalCloseoutReceipts.push({
    sequence: 9,
    step: "ARCHIVE_VISIBLE_TASK",
    receipt_ref: `digest:${evidence.attestation.digest}`,
    authority: UNIVERSAL_TASK_CLOSEOUT_AUTHORITIES.ARCHIVE_VISIBLE_TASK,
    status: "PROVEN",
    observed_at: observedAt,
  });

  const postClose = await boundHost.read_thread({threadId: session.thread_id});
  validateThreadActionReadback(postClose, session, runtimeBinding, "post_close_read", {pinned: false, archived: true});
  evidence = compileHostEvidence({operation: "post_close_read", readback: postClose, provenance, hostAttachment: session.host_attachment, workerSessionRef: session.session_ref, observedAt, sequence: receipts.length + 1});
  receipts.push(evidence.receipt);
  attestations.push(evidence.attestation);

  const roster = await boundHost.list_threads({});
  validateRosterReadback(roster, session, runtimeBinding);
  evidence = compileHostEvidence({operation: "active_list_absent", readback: roster, provenance, hostAttachment: session.host_attachment, workerSessionRef: session.session_ref, observedAt, sequence: receipts.length + 1});
  receipts.push(evidence.receipt);
  attestations.push(evidence.attestation);
  validateUniversalTaskCloseoutReceipts(universalCloseoutReceipts, {closed: true, label: "apprenticeship native universal closeout receipts"});
  return universalCloseoutReceipts;
}

async function bestEffortClose({boundHost, session}) {
  if (boundHost === null || session === null) return;
  try { await boundHost.set_thread_pinned({threadId: session.thread_id, pinned: false}); } catch { /* boundary cleanup is best effort */ }
  try { await boundHost.set_thread_archived({threadId: session.thread_id, archived: true}); } catch { /* boundary cleanup is best effort */ }
}

export async function runApprenticeshipNativeObservation({
  runId,
  observationId = `OBS-${runId}`,
  packet,
  host = null,
  hostAttachment = null,
  runtimeBinding,
  taskInstruction,
  consentRequired = false,
  consentRef = null,
  observedAt,
  progressWindowMinutes = 15,
  closeout = null,
} = {}) {
  requireIdentifier(runId, "apprenticeship native observation run ID");
  requireIdentifier(observationId, "apprenticeship native observation ID");
  validateApprenticeshipRolePacket(packet);
  assert(packet.revocation.status === "NOT_REVOKED", "revoked apprenticeship role packet cannot run");
  requireRuntimeBinding(runtimeBinding);
  requireString(taskInstruction, "apprenticeship native task instruction");
  requireUtc(observedAt, "apprenticeship native observation timestamp");
  assert(Number.isSafeInteger(progressWindowMinutes) && progressWindowMinutes >= 1 && progressWindowMinutes <= 240, "apprenticeship native progress window must be 1 to 240 minutes");
  if (host === null) throw boundary("APPRENTICESHIP_HOST_ADAPTER_REQUIRED", "native observation requires an external host adapter");
  if (hostAttachment === null) throw boundary("APPRENTICESHIP_HOST_ATTACHMENT_REQUIRED", "native observation requires a bound external host attachment");
  if (closeout === null) throw boundary("APPRENTICESHIP_UNIVERSAL_CLOSEOUT_REQUIRED", "native observation requires the general closeout callbacks");
  for (const callbackName of ["preserveHandoff", "persistHandoff", "auditCandidate", "integrateAcceptedWork", "closeStaleWorktree", "removeActiveTaskScope", "markChatOutOfScope"]) requireCloseoutCallback(closeout, callbackName);

  try {
    validateNativeHostAdapter(host);
    validateNativeHostAttachment(hostAttachment);
  } catch (error) {
    throw boundary("APPRENTICESHIP_HOST_ATTACHMENT_INVALID", "native observation host boundary is invalid", error);
  }
  assert(hostAttachment.project_id === runtimeBinding.project_id, "apprenticeship native host project differs from runtime binding");
  assert(hostAttachment.environment_id === runtimeBinding.environment_id, "apprenticeship native host environment differs from runtime binding");
  assert(JSON.stringify(hostAttachment.capabilities) === JSON.stringify([...APPRENTICESHIP_NATIVE_HOST_TOOLS]), "apprenticeship native host capabilities are incomplete");

  let boundHost = null;
  let session = null;
  const receipts = [];
  const attestations = [];
  try {
    boundHost = bindNativeHost(host, hostAttachment);
    const created = await boundHost.create_thread({
      role: APPRENTICESHIP_WORKER_ROLE,
      display_name: "Apprenticeship worker",
      project_id: runtimeBinding.project_id,
      campaign_id: runtimeBinding.campaign_id,
      campaign_version: runtimeBinding.campaign_version,
      prompt: taskInstruction,
      task_request_ref: packet.task_request_ref,
      model: hostAttachment.model,
      reasoning_effort: hostAttachment.reasoning_effort,
      tools: [...APPRENTICESHIP_NATIVE_HOST_TOOLS],
      source_commit: runtimeBinding.source_commit,
      source_tree: runtimeBinding.source_tree,
      cwd: runtimeBinding.cwd,
      git_top_level: runtimeBinding.git_top_level,
      worktree_mode: "ISOLATED_WORKTREE",
      identity: {project_id: runtimeBinding.project_id, environment_id: runtimeBinding.environment_id},
    });
    requireObject(created, "apprenticeship native create readback");
    const createdThreadId = threadIdFrom(created, "create_thread");
    const createdHostId = hostIdFrom(created, "create_thread");
    validateSourceReadback(created, runtimeBinding, "create_thread");
    ["worktree_path", "build_identity", "environment_id"].forEach((field) => requireString(created[field], `create_thread ${field}`));
    assert(created.environment_id === runtimeBinding.environment_id, "create_thread environment differs from the bound runtime");
    validateBoundaryMarkers(created, "create_thread");
    const workerSessionRef = hostSessionReference({packet, threadId: createdThreadId, hostId: createdHostId, runtimeBinding});
    const provenance = bindObservationProvenance(packet, workerSessionRef);
    session = {
      thread_id: createdThreadId,
      host_id: createdHostId,
      session_ref: workerSessionRef,
      host_attachment: hostAttachment,
    };
    let evidence = compileHostEvidence({operation: "create_thread", readback: created, provenance, hostAttachment, workerSessionRef, observedAt, sequence: 1});
    receipts.push(evidence.receipt);
    attestations.push(evidence.attestation);
    const actions = [compileActionRecord({
      sequence: 1,
      operation: "create_thread",
      action: "Create one fresh apprenticeship worker session bound to the admitted source and scope.",
      packet,
      resultRef: evidence.evidenceRef,
      evidenceRefs: [evidence.receipt.evidence_attestation_ref],
      observedAt,
    })];

    const pinned = await boundHost.set_thread_pinned({threadId: session.thread_id, pinned: true});
    validateThreadActionReadback(pinned, session, runtimeBinding, "pin", {pinned: true, archived: false});
    evidence = compileHostEvidence({operation: "pin", readback: pinned, provenance, hostAttachment, workerSessionRef, observedAt, sequence: receipts.length + 1});
    receipts.push(evidence.receipt);
    attestations.push(evidence.attestation);
    actions.push(compileActionRecord({sequence: actions.length + 1, operation: "pin", action: "Pin the fresh worker session before bounded work.", packet, resultRef: evidence.evidenceRef, evidenceRefs: [evidence.receipt.evidence_attestation_ref], observedAt}));

    const sent = await boundHost.send_message_to_thread({threadId: session.thread_id, message: taskInstruction});
    validateThreadActionReadback(sent, session, runtimeBinding, "send", {pinned: true, archived: false});
    evidence = compileHostEvidence({operation: "send", readback: sent, provenance, hostAttachment, workerSessionRef, observedAt, sequence: receipts.length + 1});
    receipts.push(evidence.receipt);
    attestations.push(evidence.attestation);
    actions.push(compileActionRecord({sequence: actions.length + 1, operation: "send", action: "Send the bounded task instruction to the worker session.", packet, resultRef: evidence.evidenceRef, evidenceRefs: [evidence.receipt.evidence_attestation_ref], observedAt}));

    const waited = await boundHost.wait_threads({threadIds: [session.thread_id], timeoutMs: progressWindowMinutes * 60 * 1000, progress_window_minutes: progressWindowMinutes});
    validateWaitReadback(waited, session, runtimeBinding);
    evidence = compileHostEvidence({operation: "wait", readback: waited, provenance, hostAttachment, workerSessionRef, observedAt, sequence: receipts.length + 1});
    receipts.push(evidence.receipt);
    attestations.push(evidence.attestation);
    actions.push(compileActionRecord({sequence: actions.length + 1, operation: "wait", action: "Wait for the configured progress window and read the worker result.", packet, resultRef: evidence.evidenceRef, evidenceRefs: [evidence.receipt.evidence_attestation_ref], observedAt}));

    const firstRead = await boundHost.read_thread({threadId: session.thread_id});
    validateThreadActionReadback(firstRead, session, runtimeBinding, "read", {pinned: true, archived: false});
    evidence = compileHostEvidence({operation: "read", readback: firstRead, provenance, hostAttachment, workerSessionRef, observedAt, sequence: receipts.length + 1});
    receipts.push(evidence.receipt);
    attestations.push(evidence.attestation);
    actions.push(compileActionRecord({sequence: actions.length + 1, operation: "read", action: "Read back the worker result without persisting the host transcript.", packet, resultRef: evidence.evidenceRef, evidenceRefs: [evidence.receipt.evidence_attestation_ref], observedAt}));

    const handoffRequest = await boundHost.send_message_to_thread({threadId: session.thread_id, message: "Return the typed handoff for the bounded result before closure."});
    validateThreadActionReadback(handoffRequest, session, runtimeBinding, "send", {pinned: true, archived: false});
    evidence = compileHostEvidence({operation: "send", readback: handoffRequest, provenance, hostAttachment, workerSessionRef, observedAt, sequence: receipts.length + 1});
    receipts.push(evidence.receipt);
    attestations.push(evidence.attestation);
    actions.push(compileActionRecord({sequence: actions.length + 1, operation: "send", action: "Request the worker's typed handoff before session closure.", packet, resultRef: evidence.evidenceRef, evidenceRefs: [evidence.receipt.evidence_attestation_ref], observedAt}));

    const finalRead = await boundHost.read_thread({threadId: session.thread_id});
    validateThreadActionReadback(finalRead, session, runtimeBinding, "read", {pinned: true, archived: false});
    const completion = validateCompletionReadback(mergeCompletion(waited.results[0], finalRead), session, runtimeBinding);
    evidence = compileHostEvidence({operation: "read", readback: finalRead, provenance, hostAttachment, workerSessionRef, observedAt, sequence: receipts.length + 1});
    receipts.push(evidence.receipt);
    attestations.push(evidence.attestation);
    actions.push(compileActionRecord({sequence: actions.length + 1, operation: "read", action: "Read back the final typed handoff and result digest.", packet, resultRef: `digest:${completion.handoff_sha256}`, evidenceRefs: [evidence.receipt.evidence_attestation_ref], observedAt}));

    const universalCloseoutReceipts = await closeSession({boundHost, session, runtimeBinding, receipts, attestations, provenance, observedAt, handoffSha256: completion.handoff_sha256, closeout});
    const allEvidenceRefs = receipts.map((receipt) => receipt.evidence_attestation_ref);
    const meaningful = completion.meaningful_progress === true;
    const resultKind = resultKindFor(completion);
    const resultRef = `digest:${completion.result_sha256}`;
    const typedHandoff = meaningful ? {
      status: "RESULT_READY",
      next_action: "Submit the source-bound result and host-attested evidence for Workflow Auditor drilling.",
      evidence_refs: [...allEvidenceRefs],
      uncertainty: [],
      protected_actions: protectedActions(),
    } : null;
    const compiledObservation = compileTaskObservation({
      observationId,
      provenance,
      taskPattern: packet.task_pattern,
      boundedScope: packet.bounded_scope,
      actionRecords: actions,
      resultKind,
      resultRef,
      resultSummary: meaningful ? "The worker produced a source-bound bounded result and typed handoff." : "The worker session closed without a meaningful bounded result.",
      evidenceRefs: [...allEvidenceRefs],
      typedHandoff,
      consentRequired,
      consentRef,
      sourceMatch: true,
      scopeMatch: true,
      observedAt,
      completedAt: observedAt,
    });
    const status = compiledObservation.meaningful_progress ? "REAL_RESULT_OBSERVED" : "NO_MEANINGFUL_RESULT";
    const run = compileNativeRun({runId, packet, provenance, hostAttachment, receipts, attestations, universalCloseoutReceipts, observation: compiledObservation, resultRef, status, startedAt: observedAt, completedAt: observedAt});
    return {
      run,
      observation: compiledObservation,
      evidence_attestations: attestations.map((attestation) => structuredClone(attestation)),
    };
  } catch (error) {
    await bestEffortClose({boundHost, session});
    if (error instanceof ApprenticeshipNativeBoundaryError) throw error;
    throw boundary("APPRENTICESHIP_NATIVE_OBSERVATION_FAILED", "native apprenticeship observation stopped before a trusted handoff", error);
  }
}
