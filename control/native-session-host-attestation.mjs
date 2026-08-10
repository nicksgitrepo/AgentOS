#!/usr/bin/env node

/*
 * Narrow adapter for an external host's create-thread contract.
 *
 * A successful create call proves that the host accepted the requested
 * model/thinking combination under the host contract. It does not prove that
 * a later session readback carries those values. This receipt keeps those
 * claims separate and never makes a worker acceptable by itself.
 */

import crypto from "node:crypto";
import {validateNativeSessionSpawnRequest} from "./native-session-team.mjs";
import {compileRedactedRecord, redactPersistedRecord, validateRedactedRecord} from "./persisted-record-privacy.mjs";

const SHA256 = /^[0-9a-f]{64}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CLIENT_THREAD = /^client-new-thread:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const HOST_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const UNKNOWN = new Set(["UNKNOWN", "UNAVAILABLE", "NOT_REPORTED", "NOT_AVAILABLE", "N/A"]);

export const NATIVE_SESSION_HOST_SPAWN_ATTESTATION_SCHEMA = "agentos.native_session_host_spawn_attestation.v1";
export const NATIVE_SESSION_HOST_SPAWN_ATTESTATION_PROVENANCE = Object.freeze([
  "EXTERNAL_HOST_CREATE_THREAD_CONTRACT",
  "EXTERNAL_HOST_CREATE_THREAD_SUCCESS_RECEIPT",
]);
export const EXTERNAL_HOST_CREATE_THREAD_CONTRACT = Object.freeze({
  host: "EXTERNAL_HOST",
  operation: "create_thread",
  requested_model_field: "model",
  requested_reasoning_field: "thinking",
  success_identity_fields: Object.freeze(["threadId", "hostId", "clientThreadId"]),
  success_semantics: "The host validates the requested model/thinking combination when creation succeeds.",
  returned_model_field: null,
  returned_reasoning_field: null,
  readback_is_separate: true,
});

function assert(condition, message) { if (!condition) throw new Error(message); }
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function requireRecord(value, label) { assert(isRecord(value), `${label} must be an object`); }
function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains control characters`);
}
function requireNullableString(value, label) { if (value !== null) requireString(value, label); }
function requireBoolean(value, label) { assert(typeof value === "boolean", `${label} must be boolean`); }
function requireSha(value, label) { assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`); }
function requireUtc(value, label) { requireString(value, label); assert(ISO_UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} must be UTC`); }
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
function digest(value) { return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value)), "utf8").digest("hex"); }
function hostValue(value, fields, label) {
  const present = fields.filter((field) => Object.prototype.hasOwnProperty.call(value, field));
  if (present.length === 0) return null;
  const first = value[present[0]];
  for (const field of present.slice(1)) assert(value[field] === first, `${label} conflicts across host fields`);
  return first;
}
function optionalString(value, fields, label) {
  const candidate = hostValue(value, fields, label);
  if (candidate === null) return null;
  if (typeof candidate !== "string" || candidate.trim().length === 0 || /[\u0000-\u001f\u007f]/u.test(candidate)) return null;
  return candidate;
}
function known(value) { return typeof value === "string" && value.trim().length > 0 && !UNKNOWN.has(value.trim().toUpperCase()); }
function requireHostId(value, label, {thread = false, client = false} = {}) {
  requireString(value, label);
  assert(HOST_IDENTIFIER.test(value), `${label} is not a stable host identity`);
  if (thread) assert(UUID.test(value), `${label} is not a host thread ID`);
  if (client) assert(CLIENT_THREAD.test(value), `${label} is not a host client-thread ID`);
  assert(!/(?:shell|stdout|stderr|command|task[_ -]?id|subagent|fabricated)/iu.test(value), `${label} contains a forbidden substitute`);
}

export const EXTERNAL_HOST_CREATE_THREAD_CONTRACT_SHA256 = digest(EXTERNAL_HOST_CREATE_THREAD_CONTRACT);

function rejectShellOrProcessFields(value) {
  for (const field of ["stdout", "stderr", "output", "shell_output", "command", "command_line", "exit_code", "pid", "process_id"]) {
    assert(!Object.prototype.hasOwnProperty.call(value, field), `host create receipt contains shell/process field: ${field}`);
  }
}

export function compileNativeSessionHostSpawnAttestation({request, hostResponse, observedAtUtc}) {
  validateNativeSessionSpawnRequest(request);
  requireRecord(hostResponse, "external host create-thread receipt");
  rejectShellOrProcessFields(hostResponse);
  const status = optionalString(hostResponse, ["status", "state"], "external host create-thread status");
  assert(!["FAILED", "ERROR", "REJECTED", "SETUP_FAILED", "WORKTREE_FAILED"].includes(status), "external host create-thread call was not accepted");
  const threadId = optionalString(hostResponse, ["thread_id", "threadId"], "external host create-thread ID");
  const clientThreadId = optionalString(hostResponse, ["client_thread_id", "clientThreadId"], "external host create-thread client ID");
  const hostId = optionalString(hostResponse, ["host_id", "hostId"], "external host create-thread host ID");
  assert(threadId !== null || clientThreadId !== null, "external host create-thread receipt lacks a thread identity");
  if (threadId !== null) requireHostId(threadId, "external host create-thread ID", {thread: true});
  if (clientThreadId !== null) requireHostId(clientThreadId, "external host create-thread client ID", {client: true});
  if (hostId !== null) requireHostId(hostId, "external host create-thread host ID");
  const returnedModelCandidate = optionalString(hostResponse, ["model", "host_model", "hostModel", "session_model", "sessionModel"], "external host create-thread model");
  const returnedReasoningCandidate = optionalString(hostResponse, ["reasoning_effort", "reasoningEffort", "thinking", "host_reasoning_effort", "hostReasoningEffort", "session_reasoning_effort", "sessionReasoningEffort"], "external host create-thread reasoning");
  const returnedModel = known(returnedModelCandidate) ? returnedModelCandidate : null;
  const returnedReasoning = known(returnedReasoningCandidate) ? returnedReasoningCandidate : null;
  const modelReturned = returnedModel !== null;
  const reasoningReturned = returnedReasoning !== null;
  const executionIdentityStatus = modelReturned && reasoningReturned
    ? (known(returnedModel) && known(returnedReasoning) && returnedModel === request.model && returnedReasoning === request.reasoning_effort ? "HOST_FIELDS_MATCHED" : "HOST_FIELDS_MISMATCH")
    : modelReturned || reasoningReturned ? "READBACK_INCOMPLETE" : "CONTRACT_ACCEPTED_NO_READBACK";
  assert(executionIdentityStatus !== "HOST_FIELDS_MISMATCH", "external host create-thread model/reasoning differs from the requested combination");
  requireUtc(observedAtUtc, "external host create-thread attestation time");
  const attestation = {
    schema: NATIVE_SESSION_HOST_SPAWN_ATTESTATION_SCHEMA,
    version: 1,
    status: "SPAWN_ACCEPTED",
    provenance: [...NATIVE_SESSION_HOST_SPAWN_ATTESTATION_PROVENANCE],
    contract_sha256: EXTERNAL_HOST_CREATE_THREAD_CONTRACT_SHA256,
    execution_identity_status: executionIdentityStatus,
    team_id: request.team_id,
    project_id: request.project_id,
    campaign_id: request.campaign_id,
    campaign_version: request.campaign_version,
    role: request.role,
    requested_model: request.model,
    requested_reasoning_effort: request.reasoning_effort,
    host_accepted_model: request.model,
    host_accepted_reasoning_effort: request.reasoning_effort,
    host_model_readback: modelReturned ? returnedModel : null,
    host_reasoning_readback: reasoningReturned ? returnedReasoning : null,
    readback_status: executionIdentityStatus === "HOST_FIELDS_MATCHED" ? "RETURNED_AND_MATCHED" : executionIdentityStatus === "CONTRACT_ACCEPTED_NO_READBACK" ? "NOT_RETURNED" : "INCOMPLETE",
    thread_id: threadId,
    client_thread_id: clientThreadId,
    host_id: hostId,
    request_sha256: request.request_sha256,
    acceptance: false,
    protected_actions_enabled: false,
    observed_at_utc: observedAtUtc,
    attestation_sha256: null,
  };
  attestation.attestation_sha256 = digestWithout(attestation, "attestation_sha256");
  return validateNativeSessionHostSpawnAttestation(attestation, {request});
}

export function validateNativeSessionHostSpawnAttestation(attestation, {request = null} = {}) {
  const required = [
    "schema", "version", "status", "provenance", "contract_sha256", "execution_identity_status", "team_id", "project_id", "campaign_id", "campaign_version", "role",
    "requested_model", "requested_reasoning_effort", "host_accepted_model", "host_accepted_reasoning_effort", "host_model_readback", "host_reasoning_readback", "readback_status",
    "thread_id", "client_thread_id", "host_id", "request_sha256", "acceptance", "protected_actions_enabled", "observed_at_utc", "attestation_sha256",
  ];
  requireRecord(attestation, "external host spawn attestation");
  assert(JSON.stringify(Object.keys(attestation).sort()) === JSON.stringify([...required].sort()), "external host spawn attestation fields mismatch");
  assert(attestation.schema === NATIVE_SESSION_HOST_SPAWN_ATTESTATION_SCHEMA && attestation.version === 1 && attestation.status === "SPAWN_ACCEPTED", "external host spawn attestation identity is invalid");
  assert(JSON.stringify(attestation.provenance) === JSON.stringify([...NATIVE_SESSION_HOST_SPAWN_ATTESTATION_PROVENANCE]), "external host spawn attestation provenance is invalid");
  assert(attestation.contract_sha256 === EXTERNAL_HOST_CREATE_THREAD_CONTRACT_SHA256, "external host spawn attestation contract differs");
  assert(["HOST_FIELDS_MATCHED", "CONTRACT_ACCEPTED_NO_READBACK", "READBACK_INCOMPLETE"].includes(attestation.execution_identity_status), "external host spawn attestation execution identity status is invalid");
  assert(attestation.readback_status === (attestation.execution_identity_status === "HOST_FIELDS_MATCHED" ? "RETURNED_AND_MATCHED" : attestation.execution_identity_status === "CONTRACT_ACCEPTED_NO_READBACK" ? "NOT_RETURNED" : "INCOMPLETE"), "external host spawn attestation readback status differs");
  for (const field of ["team_id", "project_id", "campaign_id", "campaign_version", "role"]) requireString(attestation[field], `external host spawn attestation ${field}`);
  requireString(attestation.requested_model, "external host spawn requested model");
  requireString(attestation.requested_reasoning_effort, "external host spawn requested reasoning");
  requireString(attestation.host_accepted_model, "external host accepted model");
  requireString(attestation.host_accepted_reasoning_effort, "external host accepted reasoning");
  assert(attestation.host_accepted_model === attestation.requested_model && attestation.host_accepted_reasoning_effort === attestation.requested_reasoning_effort, "external host accepted execution identity differs from request");
  requireNullableString(attestation.host_model_readback, "external host model readback");
  requireNullableString(attestation.host_reasoning_readback, "external host reasoning readback");
  if (attestation.execution_identity_status === "CONTRACT_ACCEPTED_NO_READBACK") assert(attestation.host_model_readback === null && attestation.host_reasoning_readback === null, "accepted-request attestation cannot invent host readback");
  if (attestation.execution_identity_status === "HOST_FIELDS_MATCHED") assert(attestation.host_model_readback === attestation.requested_model && attestation.host_reasoning_readback === attestation.requested_reasoning_effort, "returned host execution identity does not match request");
  assert(attestation.thread_id !== null || attestation.client_thread_id !== null, "external host spawn attestation lacks a thread identity");
  if (attestation.thread_id !== null) requireHostId(attestation.thread_id, "external host spawn attestation thread ID", {thread: true});
  if (attestation.client_thread_id !== null) requireHostId(attestation.client_thread_id, "external host spawn attestation client thread ID", {client: true});
  if (attestation.host_id !== null) requireHostId(attestation.host_id, "external host spawn attestation host ID");
  requireNullableString(attestation.host_id, "external host spawn attestation host ID");
  requireSha(attestation.request_sha256, "external host spawn attestation request digest");
  assert(attestation.acceptance === false && attestation.protected_actions_enabled === false, "external host spawn attestation crossed acceptance or protected actions");
  requireUtc(attestation.observed_at_utc, "external host spawn attestation time");
  requireSha(attestation.attestation_sha256, "external host spawn attestation digest");
  assert(attestation.attestation_sha256 === digestWithout(attestation, "attestation_sha256"), "external host spawn attestation digest mismatch");
  if (request !== null) {
    validateNativeSessionSpawnRequest(request);
    assert(attestation.request_sha256 === request.request_sha256, "external host spawn attestation request differs");
    for (const [attestationField, requestField] of [["team_id", "team_id"], ["project_id", "project_id"], ["campaign_id", "campaign_id"], ["campaign_version", "campaign_version"], ["role", "role"], ["requested_model", "model"], ["requested_reasoning_effort", "reasoning_effort"]]) assert(attestation[attestationField] === request[requestField], `external host spawn attestation ${attestationField} differs`);
  }
  return attestation;
}

/**
 * Persist only a privacy envelope for a host attestation. The raw host
 * identities remain available to the live adapter and are never written to a
 * portable AgentOS record.
 */
export function compilePersistedNativeSessionHostSpawnAttestation(attestation) {
  validateNativeSessionHostSpawnAttestation(attestation);
  const redacted = redactPersistedRecord(attestation);
  const categories = Object.entries(redacted.redaction_counts)
    .filter(([, count]) => count > 0)
    .map(([category]) => category);
  const record = compileRedactedRecord({
    sourceDigest: redacted.original_value_sha256,
    originalDigest: attestation.attestation_sha256,
    schemaHint: NATIVE_SESSION_HOST_SPAWN_ATTESTATION_SCHEMA,
    capabilityLabels: ["HOST_BOUNDARY_ONLY", "OPAQUE_RECORD", "PRIVACY_REDACTED", ...categories],
    redactionCounts: redacted.redaction_counts,
  });
  return validateRedactedRecord(record);
}
