#!/usr/bin/env node

/*
 * Typed boundary for an external host adapter.
 *
 * The attachment is portable metadata only. The host's runtime identity
 * is held in a non-enumerable process-local binding and is forwarded only to
 * the external adapter call. It must never be written to an AgentOS record.
 */

import {assertPersistedRecordSafe, canonicalDigest} from "./content-addressing.mjs";
import {
  DEFAULT_AGENT_MODEL,
  DEFAULT_AGENT_REASONING_EFFORT,
  NATIVE_SESSION_TOOLS,
} from "./native-host-contract.mjs";

export const NATIVE_HOST_ATTACHMENT_SCHEMA = "agentos.native_host_attachment.v1";
export const NATIVE_HOST_ATTACHMENT_VERSION = 1;
export const REQUIRED_NATIVE_HOST_ACTIONS = Object.freeze([...NATIVE_SESSION_TOOLS].sort());

const RUNTIME_IDENTITY = new WeakMap();
const BOUND_ADAPTER = new WeakMap();
const SAFE_IDENTIFIER = /^[A-Za-z][A-Za-z0-9._:-]*$/u;
const OPAQUE_HOST_REFERENCE = /^HOST_REF_[0-9a-f]{64}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value, label) {
  assert(isRecord(value), `${label} must be an object`);
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains control characters`);
}

function requireIdentifier(value, label) {
  requireString(value, label);
  assert(SAFE_IDENTIFIER.test(value), `${label} is not a safe identifier`);
}

function requireUtc(value, label) {
  requireString(value, label);
  assert(ISO_UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} must be UTC`);
}

function exactKeys(value, expected, label) {
  requireRecord(value, label);
  assert(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort()), `${label} fields mismatch`);
}

function opaqueHostReference(runtimeHostId, attachmentId, projectId, environmentId) {
  return `HOST_REF_${canonicalDigest({kind: "host", runtimeHostId, attachmentId, projectId, environmentId})}`;
}

function isOpaqueHostReference(value) {
  return typeof value === "string" && OPAQUE_HOST_REFERENCE.test(value);
}

function runtimeIdentityFor(attachment, runtimeIdentity) {
  const candidate = runtimeIdentity ?? RUNTIME_IDENTITY.get(attachment);
  requireRecord(candidate, "native host runtime identity");
  requireIdentifier(candidate.host_id, "native host runtime host_id");
  return Object.freeze({host_id: candidate.host_id});
}

function requireHostReadback(value, action) {
  if (isRecord(value)) return value;
  const error = new Error(`NATIVE_HOST_READBACK_INVALID: ${action} must return an object readback`);
  error.code = "NATIVE_HOST_READBACK_INVALID";
  throw error;
}

function normalizeAliases(value) {
  if (Array.isArray(value)) return value.map(normalizeAliases);
  if (!isRecord(value)) return value;
  const normalized = {};
  for (const [key, child] of Object.entries(value)) {
    if (key !== "host_attachment") normalized[key] = normalizeAliases(child);
  }
  const aliases = [
    ["thread_id", "threadId"],
    ["host_id", "hostId"],
    ["client_thread_id", "clientThreadId"],
    ["project_id", "projectId"],
    ["campaign_id", "campaignId"],
    ["campaign_version", "campaignVersion"],
    ["source_commit", "sourceCommit"],
    ["source_tree", "sourceTree"],
    ["git_top_level", "gitTopLevel"],
    ["worktree_path", "worktreePath"],
    ["build_identity", "buildIdentity"],
    ["environment_id", "environmentId"],
    ["reasoning_effort", "reasoningEffort"],
    ["host_model", "hostModel"],
    ["host_reasoning_effort", "hostReasoningEffort"],
  ];
  for (const [canonical, alias] of aliases) {
    const hasCanonical = Object.hasOwn(normalized, canonical);
    const hasAlias = Object.hasOwn(normalized, alias);
    if (hasCanonical && hasAlias) assert(normalized[canonical] === normalized[alias], `host readback aliases conflict for ${canonical}`);
    if (!hasCanonical && hasAlias) normalized[canonical] = normalized[alias];
  }
  return normalized;
}

export function validateNativeHostAdapter(host) {
  requireRecord(host, "native host adapter");
  for (const action of REQUIRED_NATIVE_HOST_ACTIONS) {
    assert(typeof host[action] === "function", `NATIVE_SESSION_TOOLING_REQUIRED: host.${action} is unavailable`);
  }
  return host;
}

export function validateNativeHostAttachment(attachment) {
  const required = [
    "schema", "version", "status", "attachment_id", "host_id", "project_id", "environment_id",
    "capabilities", "model", "reasoning_effort", "attached_at_utc", "digest",
  ];
  exactKeys(attachment, required, "native host attachment");
  assertPersistedRecordSafe(attachment);
  assert(attachment.schema === NATIVE_HOST_ATTACHMENT_SCHEMA && attachment.version === NATIVE_HOST_ATTACHMENT_VERSION, "native host attachment schema is invalid");
  assert(attachment.status === "BOUND", "native host attachment is not bound");
  requireIdentifier(attachment.attachment_id, "native host attachment_id");
  assert(isOpaqueHostReference(attachment.host_id), "native host attachment host_id must be opaque");
  requireIdentifier(attachment.project_id, "native host attachment project_id");
  requireIdentifier(attachment.environment_id, "native host attachment environment_id");
  assert(Array.isArray(attachment.capabilities)
    && JSON.stringify(attachment.capabilities) === JSON.stringify(REQUIRED_NATIVE_HOST_ACTIONS),
  "native host attachment capabilities do not match the required host actions");
  requireString(attachment.model, "native host attachment model");
  requireString(attachment.reasoning_effort, "native host attachment reasoning_effort");
  requireUtc(attachment.attached_at_utc, "native host attachment attached_at_utc");
  assert(typeof attachment.digest === "string" && SHA256.test(attachment.digest)
    && attachment.digest === canonicalDigest({...attachment, digest: null}),
  "native host attachment digest is invalid");
  return attachment;
}

export function compileNativeHostAttachment({
  attachmentId,
  hostId,
  projectId,
  environmentId,
  model = DEFAULT_AGENT_MODEL,
  reasoningEffort = DEFAULT_AGENT_REASONING_EFFORT,
  attachedAtUtc,
} = {}) {
  requireIdentifier(attachmentId, "native host attachmentId");
  requireIdentifier(hostId, "native host hostId");
  requireIdentifier(projectId, "native host projectId");
  requireIdentifier(environmentId, "native host environmentId");
  requireString(model, "native host model");
  requireString(reasoningEffort, "native host reasoningEffort");
  requireUtc(attachedAtUtc, "native host attachedAtUtc");
  assert(!isOpaqueHostReference(hostId), "compileNativeHostAttachment requires the host-local identity, not a persisted reference");
  const attachment = {
    schema: NATIVE_HOST_ATTACHMENT_SCHEMA,
    version: NATIVE_HOST_ATTACHMENT_VERSION,
    status: "BOUND",
    attachment_id: attachmentId,
    host_id: opaqueHostReference(hostId, attachmentId, projectId, environmentId),
    project_id: projectId,
    environment_id: environmentId,
    capabilities: [...REQUIRED_NATIVE_HOST_ACTIONS],
    model,
    reasoning_effort: reasoningEffort,
    attached_at_utc: attachedAtUtc,
    digest: null,
  };
  attachment.digest = canonicalDigest(attachment);
  validateNativeHostAttachment(attachment);
  RUNTIME_IDENTITY.set(attachment, Object.freeze({host_id: hostId}));
  return Object.freeze(attachment);
}

export function bindNativeHost(host, attachment, {runtimeIdentity = null} = {}) {
  validateNativeHostAdapter(host);
  validateNativeHostAttachment(attachment);
  const runtime = runtimeIdentityFor(attachment, runtimeIdentity);
  const existing = BOUND_ADAPTER.get(host);
  if (existing !== undefined) {
    assert(existing.attachment_digest === attachment.digest, "NATIVE_HOST_ATTACHMENT_INVALID: adapter is already bound to another attachment");
    assert(existing.host_id === runtime.host_id, "NATIVE_HOST_ATTACHMENT_INVALID: adapter is already bound to another host identity");
    return host;
  }
  const context = Object.freeze({
    attachment_id: attachment.attachment_id,
    host_id: runtime.host_id,
    project_id: attachment.project_id,
    environment_id: attachment.environment_id,
  });
  const bound = {};
  for (const action of REQUIRED_NATIVE_HOST_ACTIONS) {
    bound[action] = async (payload = {}) => {
      if (typeof host[action] !== "function") {
        const error = new Error(`NATIVE_SESSION_TOOLING_UNAVAILABLE: host collaboration tool is unavailable: ${action}`);
        error.code = "NATIVE_SESSION_TOOLING_UNAVAILABLE";
        throw error;
      }
      requireRecord(payload, `${action} payload`);
      if (payload.host_attachment !== undefined) {
        requireRecord(payload.host_attachment, `${action} host attachment context`);
        assert(payload.host_attachment.attachment_id === context.attachment_id, `${action} attachment differs from the bound host`);
        assert(payload.host_attachment.project_id === context.project_id, `${action} project differs from the bound host`);
        assert(payload.host_attachment.environment_id === context.environment_id, `${action} environment differs from the bound host`);
      }
      const identity = isRecord(payload.identity) ? {...payload.identity} : {};
      if (identity.project_id !== undefined) assert(identity.project_id === context.project_id, `${action} payload project differs from the bound host`);
      if (identity.environment_id !== undefined) assert(identity.environment_id === context.environment_id, `${action} payload environment differs from the bound host`);
      if (identity.attachment_id !== undefined) assert(identity.attachment_id === context.attachment_id, `${action} payload attachment differs from the bound host`);
      if (identity.host_id !== undefined) assert(identity.host_id === context.host_id, `${action} payload host differs from the bound host`);
      identity.project_id ??= context.project_id;
      identity.environment_id ??= context.environment_id;
      identity.attachment_id ??= context.attachment_id;
      identity.host_id ??= context.host_id;
      const response = await host[action]({
        ...payload,
        identity,
        host_attachment: context,
      });
      return normalizeAliases(requireHostReadback(response, action));
    };
  }
  const frozen = Object.freeze(bound);
  BOUND_ADAPTER.set(frozen, Object.freeze({attachment_digest: attachment.digest, host_id: runtime.host_id}));
  return frozen;
}

export function getNativeHostRuntimeIdentity(attachment) {
  validateNativeHostAttachment(attachment);
  return runtimeIdentityFor(attachment, null);
}
