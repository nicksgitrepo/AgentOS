#!/usr/bin/env node

/*
 * Project-agnostic lane autonomy contract.
 *
 * A specialist owns its admitted lane until it has produced a meaningful
 * result and a typed handoff.  The Controller is a liveness/custody observer;
 * it is not an approval gate for ordinary lane completion.  A downstream
 * platform reviewer may independently evaluate the handoff after the lane
 * releases custody.
 */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";

export const AUTONOMOUS_LANE_HANDOFF_SCHEMA = "agentos.autonomous_lane_handoff.v1";
export const AUTONOMOUS_LANE_HANDOFF_VERSION = 1;
export const AUTONOMOUS_LANE_EXECUTION_OWNER = "LANE_AGENT";
export const AUTONOMOUS_LANE_CONTROLLER_ROLE = "LIVENESS_CUSTODIAN";
export const AUTONOMOUS_LANE_NEXT_ACTION = "START_PLATFORM_REVIEW";
export const AUTONOMOUS_LANE_NEXT_HANDLER = "HANDLER.ORCHESTRATOR_PLATFORM_REVIEW";

const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/u;
const OPAQUE_REF = /^(?:opaque:|ref:)[^\s]+$/u;
const HANDOFF_STATUS = "READY_FOR_INDEPENDENT_CONSUMPTION";
const HANDOFF_KEYS = Object.freeze([
  "schema", "version", "lane_id", "worker_ref", "campaign_id", "campaign_version",
  "goal_sha256", "source", "writable_scope", "execution_owner", "controller_role",
  "controller_approval_required", "handoff_status", "next_consumer", "next_action", "next_handler", "result_type",
  "summary", "artifact_sha256", "evidence_sha256", "handoff_ref", "roster_policy",
  "handoff_sha256",
]);
const SOURCE_KEYS = Object.freeze(["commit", "tree", "worktree_id"]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, keys, label) {
  assert(isRecord(value), `${label} must be an object`);
  const actual = Object.keys(value).sort(compareUtf8);
  const expected = [...keys].sort(compareUtf8);
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} fields mismatch`);
}

function requireIdentifier(value, label) {
  assert(typeof value === "string" && IDENTIFIER.test(value), `${label} must be a stable identifier`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function requireReference(value, label) {
  assert(typeof value === "string" && OPAQUE_REF.test(value), `${label} must be an opaque/reference URI`);
}

function requireText(value, label, minimum = 1) {
  assert(typeof value === "string" && value.trim().length >= minimum, `${label} must contain at least ${minimum} characters`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${label} contains control characters`);
}

function digestBody(value) {
  const copy = structuredClone(value);
  copy.handoff_sha256 = null;
  return copy;
}

function validateSource(source) {
  exactKeys(source, SOURCE_KEYS, "autonomous lane source");
  for (const key of SOURCE_KEYS) requireIdentifier(source[key], `autonomous lane source ${key}`);
  return source;
}

export function validateAutonomousLaneHandoff(handoff) {
  exactKeys(handoff, HANDOFF_KEYS, "autonomous lane handoff");
  assert(handoff.schema === AUTONOMOUS_LANE_HANDOFF_SCHEMA && handoff.version === AUTONOMOUS_LANE_HANDOFF_VERSION, "autonomous lane handoff identity is invalid");
  requireIdentifier(handoff.lane_id, "autonomous lane ID");
  requireIdentifier(handoff.worker_ref, "autonomous worker reference");
  requireIdentifier(handoff.campaign_id, "autonomous campaign ID");
  requireIdentifier(handoff.campaign_version, "autonomous campaign version");
  requireSha(handoff.goal_sha256, "autonomous lane goal digest");
  validateSource(handoff.source);
  requireIdentifier(handoff.writable_scope, "autonomous lane writable scope");
  assert(handoff.execution_owner === AUTONOMOUS_LANE_EXECUTION_OWNER, "lane handoff must remain lane-owned");
  assert(handoff.controller_role === AUTONOMOUS_LANE_CONTROLLER_ROLE, "Controller role must be liveness custody only");
  assert(handoff.controller_approval_required === false, "ordinary lane handoff may not require Controller approval");
  assert(handoff.handoff_status === HANDOFF_STATUS, "autonomous lane handoff is not ready for consumption");
  assert(handoff.next_consumer === "INDEPENDENT_PLATFORM_REVIEW", "lane handoff must route to an independent consumer");
  requireIdentifier(handoff.next_action, "autonomous lane next action");
  requireIdentifier(handoff.next_handler, "autonomous lane next handler");
  assert(handoff.next_action === AUTONOMOUS_LANE_NEXT_ACTION, "lane handoff next action must start independent platform review");
  assert(handoff.next_handler === AUTONOMOUS_LANE_NEXT_HANDLER, "lane handoff next handler is not the platform review handler");
  assert(handoff.next_action !== "NONE" && handoff.next_action !== "DONE", "lane handoff cannot close without a successor action");
  assert(!handoff.next_handler.startsWith("HANDLER.CONTROLLER"), "lane handoff cannot route ordinary work through Controller approval");
  requireIdentifier(handoff.result_type, "autonomous lane result type");
  requireText(handoff.summary, "autonomous lane summary", 16);
  requireSha(handoff.artifact_sha256, "autonomous lane artifact digest");
  requireSha(handoff.evidence_sha256, "autonomous lane evidence digest");
  requireReference(handoff.handoff_ref, "autonomous lane handoff reference");
  assert(handoff.roster_policy === "INVALIDATE_AND_REBUILD_DEPENDENTS_ON_BLOCK_CHANGE", "autonomous lane roster policy is incomplete");
  requireSha(handoff.handoff_sha256, "autonomous lane handoff digest");
  assert(handoff.handoff_sha256 === canonicalDigest(digestBody(handoff)), "autonomous lane handoff digest mismatch");
  return handoff;
}

export function compileAutonomousLaneHandoff({
  laneId,
  workerRef,
  campaignId,
  campaignVersion,
  goalSha256,
  source,
  writableScope,
  resultType,
  nextAction,
  nextHandler,
  summary,
  artifactSha256,
  evidenceSha256,
  handoffRef,
} = {}) {
  requireIdentifier(laneId, "autonomous lane ID");
  requireIdentifier(workerRef, "autonomous worker reference");
  requireIdentifier(campaignId, "autonomous campaign ID");
  requireIdentifier(campaignVersion, "autonomous campaign version");
  requireSha(goalSha256, "autonomous lane goal digest");
  validateSource(source);
  requireIdentifier(writableScope, "autonomous lane writable scope");
  requireIdentifier(resultType, "autonomous lane result type");
  requireIdentifier(nextAction, "autonomous lane next action");
  requireIdentifier(nextHandler, "autonomous lane next handler");
  requireText(summary, "autonomous lane summary", 16);
  requireSha(artifactSha256, "autonomous lane artifact digest");
  requireSha(evidenceSha256, "autonomous lane evidence digest");
  requireReference(handoffRef, "autonomous lane handoff reference");
  const handoff = {
    schema: AUTONOMOUS_LANE_HANDOFF_SCHEMA,
    version: AUTONOMOUS_LANE_HANDOFF_VERSION,
    lane_id: laneId,
    worker_ref: workerRef,
    campaign_id: campaignId,
    campaign_version: campaignVersion,
    goal_sha256: goalSha256,
    source: structuredClone(source),
    writable_scope: writableScope,
    execution_owner: AUTONOMOUS_LANE_EXECUTION_OWNER,
    controller_role: AUTONOMOUS_LANE_CONTROLLER_ROLE,
    controller_approval_required: false,
    handoff_status: HANDOFF_STATUS,
    next_consumer: "INDEPENDENT_PLATFORM_REVIEW",
    next_action: nextAction,
    next_handler: nextHandler,
    result_type: resultType,
    summary,
    artifact_sha256: artifactSha256,
    evidence_sha256: evidenceSha256,
    handoff_ref: handoffRef,
    roster_policy: "INVALIDATE_AND_REBUILD_DEPENDENTS_ON_BLOCK_CHANGE",
    handoff_sha256: null,
  };
  handoff.handoff_sha256 = canonicalDigest(digestBody(handoff));
  return validateAutonomousLaneHandoff(handoff);
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write("Autonomous lane handoff contract loaded\n");
