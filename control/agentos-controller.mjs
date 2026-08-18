#!/usr/bin/env node

/*
 * Project-level AgentOS Controller.
 *
 * This module owns the durable project control plane.  It does not implement
 * Product code, accept Product work, or impersonate a provider.  Every
 * consequential external action must be performed by a project-bound adapter
 * and returned as a typed readback before the controller advances its state.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {validatePolicyState} from "./global-policy-state.mjs";
import {AGENTOS_CONTROLLER_DISPLAY_NAME, AGENTOS_CONTROLLER_ROLE, validateControllerRoleDisplay} from "./controller-role-display.mjs";
import {
  validateGovernanceArchitecture,
} from "./role-governance-library.mjs";
import {ARCHITECTURE_ACCEPTANCE_REQUIREMENTS} from "./governance-library.mjs";
import {assertControllerOperationAuthorized} from "./spawner-bootstrap-governance.mjs";
import {assertOperationalGlobalGovernanceContext} from "./global-governance-operational-context.mjs";
import {
  assertCanonicalControllerEventAuthority,
  loadCanonicalControllerOperationRegistry,
} from "./controller-event-authority.mjs";
import {
  consumeControllerProjectEventOnce,
  readControllerProjectState,
  writeControllerProjectStateCompareAndSwap,
} from "./controller-project-store.mjs";

const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Z][A-Z0-9._:-]*$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const CONTROLLER_SCHEMA = "agentos.controller_state.v1";
const CANDIDATE_SCHEMA = "agentos.controller_campaign_candidate.v1";
const EVENT_SCHEMA = "agentos.controller_event.v1";
const AGENT_BINDING_SCHEMA = "agentos.controller_agent_binding.v1";
const RUNTIME_READBACK_SCHEMA = "agentos.controller_runtime_readback.v1";
const ADAPTER_READBACK_SCHEMA = "agentos.controller_adapter_readback.v1";
const ARCHITECTURE_REPAIR_GATE_SCHEMA = "agentos.controller_architecture_repair_gate.v1";
const CONTROLLER_OPERATION_REGISTRY = loadCanonicalControllerOperationRegistry();
export const CONTROLLER_EVENT_TYPES = Object.freeze(CONTROLLER_OPERATION_REGISTRY.operations.map((entry) => entry.event_type));
const EVENT_TYPES = CONTROLLER_EVENT_TYPES;
const OPERATION_NAMES = Object.freeze(CONTROLLER_OPERATION_REGISTRY.operations.flatMap((entry) => entry.adapters));
const OPERATION_SET = new Set(OPERATION_NAMES);
const OPERATIONAL_STATUSES = Object.freeze([
  "IDLE",
  "EVENT_DRIVEN_WAIT",
  "BOOTSTRAPPING",
  "OWNER_REVIEW_PENDING",
  "CAMPAIGN_ACTIVE",
  "DEPLOYMENT_PENDING",
  "OWNER_ONLY",
  "PAUSED",
]);
const QUEUE_STATUSES = Object.freeze(["PROPOSED", "ACTIVE", "CLOSED"]);
const ACTION_STATUSES = Object.freeze(["SUCCESS", "JUDGMENT_REQUIRED", "UNAVAILABLE", "REJECTED"]);
const CAMPAIGN_ROLES = Object.freeze([
  "CAMPAIGN_ORCHESTRATOR",
  "INDEPENDENT_AUDITOR",
  "FEATURE_AGENT",
  "PLATFORM_AGENT",
  "AUDIT_WORKER",
  "CAMPAIGN_FINALIZER",
  "RUNTIME",
]);

const compareUtf8 = (left, right) => Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
const sorted = (values) => [...values].sort(compareUtf8);

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
  assert(IDENTIFIER.test(value), `${label} is not a stable identifier`);
}

function requireSha(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function requireUtc(value, label) {
  requireString(value, label);
  assert(ISO_UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} must be UTC`);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort(compareUtf8).map((key) => [key, canonicalize(value[key])]));
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function controllerDigest(value) {
  return crypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function digestWithout(value, field) {
  const body = structuredClone(value);
  body[field] = null;
  return controllerDigest(body);
}

function exactKeys(value, keys, label) {
  requireRecord(value, label);
  assert(JSON.stringify(Object.keys(value).sort(compareUtf8)) === JSON.stringify([...keys].sort(compareUtf8)), `${label} fields mismatch`);
}

function sortedUnique(values, label, {allowEmpty = false} = {}) {
  assert(Array.isArray(values), `${label} must be an array`);
  if (!allowEmpty) assert(values.length > 0, `${label} must not be empty`);
  assert(values.every((value) => typeof value === "string" && value.length > 0), `${label} contains an invalid value`);
  const ordered = sorted(values);
  assert(new Set(ordered).size === ordered.length && JSON.stringify(values) === JSON.stringify(ordered), `${label} must be sorted and unique`);
  return values;
}

function validateCampaignIdentity(projectId, campaignId, campaignVersion) {
  requireString(projectId, "controller project ID");
  requireString(campaignId, "campaign ID");
  requireString(campaignVersion, "campaign version");
}

function validateRoster(roster, label = "campaign roster") {
  assert(Array.isArray(roster) && roster.length > 0, `${label} is required`);
  const roles = new Set();
  const sessions = new Set();
  for (const record of roster) {
    exactKeys(record, ["role", "session_id", "model_class"], `${label} record`);
    assert(CAMPAIGN_ROLES.includes(record.role), `${label} role is invalid`);
    requireString(record.session_id, `${label} session`);
    requireString(record.model_class, `${label} model class`);
    assert(!roles.has(record.role), `${label} role is duplicated`);
    assert(!sessions.has(record.session_id), `${label} session is duplicated`);
    roles.add(record.role);
    sessions.add(record.session_id);
  }
  assert(JSON.stringify(roster.map((record) => record.role)) === JSON.stringify(sorted(roster.map((record) => record.role))), `${label} must be sorted by role`);
}

function validateActionReceipts(receipts, projectId, controllerId) {
  assert(Array.isArray(receipts), "controller action receipts are required");
  for (const receipt of receipts) {
    validateControllerAdapterReadback(receipt);
    assert(receipt.project_id === projectId, "controller action receipt project differs from state");
    assert(receipt.controller_id === controllerId, "controller action receipt controller differs from state");
  }
}

export function validateControllerCampaignCandidate(candidate) {
  const keys = [
    "schema", "version", "project_id", "campaign_id", "campaign_version", "policy_epoch", "policy_state_sha256",
    "owner_intent_sha256", "acceptance_contract_sha256", "model_plan_sha256", "scope_sha256", "source_commit", "source_tree", "candidate_sha256",
  ];
  exactKeys(candidate, keys, "campaign candidate");
  assert(candidate.schema === CANDIDATE_SCHEMA && candidate.version === 1, "campaign candidate identity is invalid");
  validateCampaignIdentity(candidate.project_id, candidate.campaign_id, candidate.campaign_version);
  assert(Number.isSafeInteger(candidate.policy_epoch) && candidate.policy_epoch >= 1, "campaign candidate policy epoch is invalid");
  for (const field of ["policy_state_sha256", "owner_intent_sha256", "acceptance_contract_sha256", "model_plan_sha256", "scope_sha256"]) requireSha(candidate[field], `campaign candidate ${field}`);
  requireString(candidate.source_commit, "campaign candidate source commit");
  requireString(candidate.source_tree, "campaign candidate source tree");
  requireSha(candidate.candidate_sha256, "campaign candidate digest");
  assert(candidate.candidate_sha256 === digestWithout(candidate, "candidate_sha256"), "campaign candidate digest mismatch");
  return candidate;
}

export function validateControllerArchitectureRepairGate(gate, {architecture = null} = {}) {
  const keys = [
    "schema", "version", "project_id", "campaign_id", "source_commit", "source_tree",
    "bootstrap_plan_sha256", "architecture_sha256", "required_acceptance_requirements", "status", "gate_sha256",
  ];
  exactKeys(gate, keys, "architecture repair gate");
  assert(gate.schema === ARCHITECTURE_REPAIR_GATE_SCHEMA && gate.version === 1, "architecture repair gate identity is invalid");
  requireString(gate.project_id, "architecture repair gate project");
  requireString(gate.campaign_id, "architecture repair gate campaign");
  requireString(gate.source_commit, "architecture repair gate source commit");
  requireString(gate.source_tree, "architecture repair gate source tree");
  requireSha(gate.bootstrap_plan_sha256, "architecture repair gate Bootstrap plan");
  requireSha(gate.architecture_sha256, "architecture repair gate architecture digest");
  sortedUnique(gate.required_acceptance_requirements, "architecture repair gate requirements");
  assert(JSON.stringify(gate.required_acceptance_requirements) === JSON.stringify([...ARCHITECTURE_ACCEPTANCE_REQUIREMENTS].sort(compareUtf8)), "architecture repair gate requirements are incomplete");
  assert(gate.status === "ARCHITECTURE_GATE_READY", "architecture repair gate status is invalid");
  requireSha(gate.gate_sha256, "architecture repair gate digest");
  assert(gate.gate_sha256 === digestWithout(gate, "gate_sha256"), "architecture repair gate digest mismatch");
  if (architecture !== null) {
    validateGovernanceArchitecture(architecture);
    assert(gate.architecture_sha256 === architecture.digest, "architecture repair gate differs from architecture envelope");
    assert(gate.source_commit === architecture.source_commit && gate.source_tree === architecture.source_tree, "architecture repair gate source differs from architecture envelope");
    assert(gate.bootstrap_plan_sha256 === architecture.bootstrap_plan_sha256, "architecture repair gate Bootstrap plan differs from architecture envelope");
  }
  return gate;
}

export function compileControllerArchitectureRepairGate({projectId, campaignId, architecture} = {}) {
  validateGovernanceArchitecture(architecture);
  requireString(projectId, "architecture repair gate project");
  requireString(campaignId, "architecture repair gate campaign");
  const gate = {
    schema: ARCHITECTURE_REPAIR_GATE_SCHEMA,
    version: 1,
    project_id: projectId,
    campaign_id: campaignId,
    source_commit: architecture.source_commit,
    source_tree: architecture.source_tree,
    bootstrap_plan_sha256: architecture.bootstrap_plan_sha256,
    architecture_sha256: architecture.digest,
    required_acceptance_requirements: [...ARCHITECTURE_ACCEPTANCE_REQUIREMENTS].sort(compareUtf8),
    status: "ARCHITECTURE_GATE_READY",
    gate_sha256: null,
  };
  gate.gate_sha256 = digestWithout(gate, "gate_sha256");
  return validateControllerArchitectureRepairGate(gate, {architecture});
}

export function validateControllerArchitectureRepairAdmission({candidate, architectureGate} = {}) {
  validateControllerCampaignCandidate(candidate);
  validateControllerArchitectureRepairGate(architectureGate);
  assert(candidate.project_id === architectureGate.project_id, "architecture repair candidate project differs from gate");
  assert(candidate.campaign_id === architectureGate.campaign_id, "architecture repair candidate campaign differs from gate");
  assert(candidate.source_commit === architectureGate.source_commit && candidate.source_tree === architectureGate.source_tree, "architecture repair candidate source differs from gate");
  assert(candidate.acceptance_contract_sha256 === architectureGate.architecture_sha256, "architecture repair candidate acceptance contract is not the architecture digest");
  return {status: "ARCHITECTURE_REPAIR_ADMITTED", candidate_sha256: candidate.candidate_sha256, gate_sha256: architectureGate.gate_sha256};
}

export function compileControllerCampaignCandidate({
  projectId,
  campaignId,
  campaignVersion,
  policyEpoch,
  policyStateSha256,
  ownerIntentSha256,
  acceptanceContractSha256,
  modelPlanSha256,
  scopeSha256,
  sourceCommit,
  sourceTree,
}) {
  const candidate = {
    schema: CANDIDATE_SCHEMA,
    version: 1,
    project_id: projectId,
    campaign_id: campaignId,
    campaign_version: campaignVersion,
    policy_epoch: policyEpoch,
    policy_state_sha256: policyStateSha256,
    owner_intent_sha256: ownerIntentSha256,
    acceptance_contract_sha256: acceptanceContractSha256,
    model_plan_sha256: modelPlanSha256,
    scope_sha256: scopeSha256,
    source_commit: sourceCommit,
    source_tree: sourceTree,
    candidate_sha256: null,
  };
  candidate.candidate_sha256 = digestWithout(candidate, "candidate_sha256");
  return validateControllerCampaignCandidate(candidate);
}

export function validateControllerAgentBinding(binding) {
  exactKeys(binding, ["schema", "version", "project_id", "logical_controller_id", "session_id", "policy_epoch", "policy_state_sha256", "observed_at_utc", "binding_sha256"], "controller agent binding");
  assert(binding.schema === AGENT_BINDING_SCHEMA && binding.version === 1, "controller agent binding identity is invalid");
  validateCampaignIdentity(binding.project_id, binding.logical_controller_id, "controller");
  requireString(binding.session_id, "controller agent session");
  assert(Number.isSafeInteger(binding.policy_epoch) && binding.policy_epoch >= 1, "controller agent policy epoch is invalid");
  requireSha(binding.policy_state_sha256, "controller agent policy state");
  requireUtc(binding.observed_at_utc, "controller agent observation time");
  requireSha(binding.binding_sha256, "controller agent binding digest");
  assert(binding.binding_sha256 === digestWithout(binding, "binding_sha256"), "controller agent binding digest mismatch");
  return binding;
}

export function compileControllerAgentBinding({projectId, logicalControllerId, sessionId, policyEpoch, policyStateSha256, observedAtUtc}) {
  const binding = {
    schema: AGENT_BINDING_SCHEMA,
    version: 1,
    project_id: projectId,
    logical_controller_id: logicalControllerId,
    session_id: sessionId,
    policy_epoch: policyEpoch,
    policy_state_sha256: policyStateSha256,
    observed_at_utc: observedAtUtc,
    binding_sha256: null,
  };
  binding.binding_sha256 = digestWithout(binding, "binding_sha256");
  return validateControllerAgentBinding(binding);
}

export function validateControllerRuntimeReadback(readback) {
  exactKeys(readback, ["schema", "version", "project_id", "controller_runtime_id", "runtime_id", "environment_identity", "capability_set_sha256", "persistent", "status", "observed_by_session", "observed_at_utc", "readback_sha256"], "controller runtime readback");
  assert(readback.schema === RUNTIME_READBACK_SCHEMA && readback.version === 1, "controller runtime readback identity is invalid");
  requireString(readback.project_id, "controller runtime project");
  requireString(readback.controller_runtime_id, "controller runtime ID");
  requireString(readback.runtime_id, "controller runtime product runtime ID");
  requireString(readback.environment_identity, "controller runtime environment");
  requireSha(readback.capability_set_sha256, "controller runtime capability set");
  assert(readback.persistent === true && readback.status === "ACTIVE", "controller runtime must be persistent and active");
  requireString(readback.observed_by_session, "controller runtime observer");
  requireUtc(readback.observed_at_utc, "controller runtime observation time");
  requireSha(readback.readback_sha256, "controller runtime readback digest");
  assert(readback.readback_sha256 === digestWithout(readback, "readback_sha256"), "controller runtime readback digest mismatch");
  return readback;
}

export function compileControllerRuntimeReadback({projectId, controllerRuntimeId, runtimeId, environmentIdentity, capabilitySetSha256, observedBySession, observedAtUtc}) {
  const readback = {
    schema: RUNTIME_READBACK_SCHEMA,
    version: 1,
    project_id: projectId,
    controller_runtime_id: controllerRuntimeId,
    runtime_id: runtimeId,
    environment_identity: environmentIdentity,
    capability_set_sha256: capabilitySetSha256,
    persistent: true,
    status: "ACTIVE",
    observed_by_session: observedBySession,
    observed_at_utc: observedAtUtc,
    readback_sha256: null,
  };
  readback.readback_sha256 = digestWithout(readback, "readback_sha256");
  return validateControllerRuntimeReadback(readback);
}

export function validateControllerAdapterReadback(readback) {
  exactKeys(readback, ["schema", "version", "operation", "action_id", "event_id", "controller_id", "project_id", "policy_epoch", "policy_state_sha256", "campaign_id", "external_identity", "status", "observed_at_utc", "details", "readback_sha256"], "controller adapter readback");
  assert(readback.schema === ADAPTER_READBACK_SCHEMA && readback.version === 1, "controller adapter readback identity is invalid");
  assert(OPERATION_SET.has(readback.operation), "controller adapter operation is invalid");
  requireIdentifier(readback.action_id, "controller action ID");
  requireIdentifier(readback.event_id, "controller event ID");
  requireIdentifier(readback.controller_id, "controller ID");
  requireString(readback.project_id, "controller adapter project");
  assert(Number.isSafeInteger(readback.policy_epoch) && readback.policy_epoch >= 1, "controller adapter policy epoch is invalid");
  requireSha(readback.policy_state_sha256, "controller adapter policy state");
  if (readback.campaign_id !== null) requireString(readback.campaign_id, "controller adapter campaign");
  if (readback.external_identity !== null) requireString(readback.external_identity, "controller adapter external identity");
  assert(ACTION_STATUSES.includes(readback.status), "controller adapter status is invalid");
  requireUtc(readback.observed_at_utc, "controller adapter observation time");
  requireRecord(readback.details, "controller adapter details");
  requireSha(readback.readback_sha256, "controller adapter readback digest");
  assert(readback.readback_sha256 === digestWithout(readback, "readback_sha256"), "controller adapter readback digest mismatch");
  return readback;
}

export function compileControllerAdapterReadback({operation, actionId, eventId, controllerId, projectId, policyEpoch, policyStateSha256, campaignId = null, externalIdentity = null, status = "SUCCESS", observedAtUtc, details = {}}) {
  const readback = {
    schema: ADAPTER_READBACK_SCHEMA,
    version: 1,
    operation,
    action_id: actionId,
    event_id: eventId,
    controller_id: controllerId,
    project_id: projectId,
    policy_epoch: policyEpoch,
    policy_state_sha256: policyStateSha256,
    campaign_id: campaignId,
    external_identity: externalIdentity,
    status,
    observed_at_utc: observedAtUtc,
    details: structuredClone(details),
    readback_sha256: null,
  };
  readback.readback_sha256 = digestWithout(readback, "readback_sha256");
  return validateControllerAdapterReadback(readback);
}

function validateQueue(queue, projectId) {
  assert(Array.isArray(queue), "controller campaign queue is required");
  const ids = [];
  for (const entry of queue) {
    exactKeys(entry, ["campaign_id", "campaign_version", "candidate", "status", "queued_at_utc", "admitted_at_utc"], "controller queue entry");
    validateControllerCampaignCandidate(entry.candidate);
    assert(entry.candidate.project_id === projectId && entry.candidate.campaign_id === entry.campaign_id && entry.candidate.campaign_version === entry.campaign_version, "controller queue candidate identity differs");
    assert(QUEUE_STATUSES.includes(entry.status), "controller queue status is invalid");
    requireUtc(entry.queued_at_utc, "controller queue time");
    if (entry.admitted_at_utc !== null) requireUtc(entry.admitted_at_utc, "controller queue admission time");
    ids.push(entry.campaign_id);
  }
  assert(JSON.stringify(ids) === JSON.stringify(sorted(ids)), "controller campaign queue must be sorted");
  assert(new Set(ids).size === ids.length, "controller campaign queue contains duplicate campaigns");
}

function validateActiveCampaign(active, projectId, policyState) {
  if (active === null) return;
  exactKeys(active, [
    "campaign_id", "campaign_version", "candidate", "candidate_sha256", "orchestrator_session_id", "auditor_session_id",
    "feature_agent_session_ids", "platform_agent_session_ids", "roster", "stage", "policy_epoch", "policy_state_sha256",
    "latest_checkpoint_sha256", "next_orchestrator_session_id", "next_orchestrator_orientation_only", "deployment_identity", "rollback_identity", "live_audit_identity",
  ], "active controller campaign");
  validateControllerCampaignCandidate(active.candidate);
  assert(active.candidate.project_id === projectId && active.candidate.campaign_id === active.campaign_id && active.candidate.campaign_version === active.campaign_version, "active campaign candidate identity differs");
  assert(active.candidate_sha256 === active.candidate.candidate_sha256, "active campaign candidate digest differs");
  requireString(active.orchestrator_session_id, "active orchestrator session");
  requireString(active.auditor_session_id, "active auditor session");
  sortedUnique(active.feature_agent_session_ids, "active Feature Agent sessions");
  sortedUnique(active.platform_agent_session_ids, "active Platform Agent sessions", {allowEmpty: true});
  validateRoster(active.roster);
  requireString(active.stage, "active campaign stage");
  assert(active.policy_epoch === policyState.policy_epoch && active.policy_state_sha256 === policyState.policy_state_sha256, "active campaign policy is stale");
  if (active.latest_checkpoint_sha256 !== null) requireSha(active.latest_checkpoint_sha256, "active campaign checkpoint");
  if (active.next_orchestrator_session_id !== null) requireString(active.next_orchestrator_session_id, "next orchestrator session");
  assert(active.next_orchestrator_orientation_only === true, "next orchestrator must be orientation-only before close");
  for (const field of ["deployment_identity", "rollback_identity", "live_audit_identity"]) if (active[field] !== null) requireString(active[field], `active campaign ${field}`);
}

function validateOwnerBoundary(boundary) {
  exactKeys(boundary, ["boundary_id", "scope", "reason", "recommended_action", "created_at_utc"], "owner boundary");
  requireIdentifier(boundary.boundary_id, "owner boundary ID");
  requireString(boundary.scope, "owner boundary scope");
  requireString(boundary.reason, "owner boundary reason");
  requireString(boundary.recommended_action, "owner boundary recommendation");
  requireUtc(boundary.created_at_utc, "owner boundary time");
}

function validateJudgment(judgment) {
  exactKeys(judgment, ["judgment_id", "reason", "affected_outcomes", "created_at_utc"], "controller judgment");
  requireIdentifier(judgment.judgment_id, "controller judgment ID");
  requireString(judgment.reason, "controller judgment reason");
  sortedUnique(judgment.affected_outcomes, "controller judgment outcomes", {allowEmpty: true});
  requireUtc(judgment.created_at_utc, "controller judgment time");
}

export function validateAgentOSControllerState(state) {
  const keys = [
    "schema", "version", "status", "operational_status", "logical_controller_id", "project_id", "current_session_id",
    "controller_agent", "controller_runtime_readback", "controller_role", "controller_display_name", "policy_state", "policy_epoch", "policy_state_sha256", "active_campaign_id", "active_campaign",
    "campaign_queue", "runtime_id", "event_cursor", "event_ledger_head_sha256", "last_reconciliation_at", "reconciliation_interval_minutes",
    "pending_owner_boundaries", "pending_judgments", "action_receipts", "last_closed_campaign_id", "state_sha256",
  ];
  const legacyKeys = keys.filter((key) => !["controller_role", "controller_display_name"].includes(key));
  const actualKeys = JSON.stringify(Object.keys(state).sort(compareUtf8));
  const hasRoleDisplay = actualKeys === JSON.stringify(keys.sort(compareUtf8));
  assert(hasRoleDisplay || actualKeys === JSON.stringify(legacyKeys.sort(compareUtf8)), "AgentOS Controller state fields mismatch");
  assert(state.schema === CONTROLLER_SCHEMA && state.version === 1, "AgentOS Controller state identity is invalid");
  assert(state.status === "PREPARED_NOT_ACTIVATED", "AgentOS Controller cannot activate AgentOS");
  assert(OPERATIONAL_STATUSES.includes(state.operational_status), "AgentOS Controller operational status is invalid");
  if (hasRoleDisplay) validateControllerRoleDisplay({controllerRole: state.controller_role, controllerDisplayName: state.controller_display_name}, {label: "AgentOS Controller state role"});
  requireIdentifier(state.logical_controller_id, "logical controller ID");
  requireString(state.project_id, "controller project ID");
  requireString(state.current_session_id, "controller session ID");
  validateControllerAgentBinding(state.controller_agent);
  assert(state.controller_agent.project_id === state.project_id && state.controller_agent.logical_controller_id === state.logical_controller_id && state.controller_agent.session_id === state.current_session_id, "controller agent binding differs from state");
  validateControllerRuntimeReadback(state.controller_runtime_readback);
  assert(state.controller_runtime_readback.project_id === state.project_id && state.runtime_id === state.controller_runtime_readback.runtime_id, "controller Runtime binding differs from state");
  validatePolicyState(state.policy_state);
  assert(state.policy_epoch === state.policy_state.policy_epoch && state.policy_state_sha256 === state.policy_state.policy_state_sha256, "controller policy binding differs from state");
  if (state.active_campaign_id !== null) requireString(state.active_campaign_id, "active campaign ID");
  if (state.active_campaign !== null) {
    validateActiveCampaign(state.active_campaign, state.project_id, state.policy_state);
    assert(state.active_campaign_id === state.active_campaign.campaign_id, "active campaign ID differs from active record");
  } else assert(state.active_campaign_id === null, "active campaign record is missing");
  validateQueue(state.campaign_queue, state.project_id);
  requireString(state.runtime_id, "persistent Runtime ID");
  assert(Number.isSafeInteger(state.event_cursor) && state.event_cursor >= 0, "controller event cursor is invalid");
  if (state.event_ledger_head_sha256 !== null) requireSha(state.event_ledger_head_sha256, "controller event ledger head");
  requireUtc(state.last_reconciliation_at, "controller reconciliation time");
  assert(Number.isSafeInteger(state.reconciliation_interval_minutes) && state.reconciliation_interval_minutes >= 1, "controller reconciliation interval is invalid");
  assert(Array.isArray(state.pending_owner_boundaries), "pending owner boundaries are required");
  state.pending_owner_boundaries.forEach(validateOwnerBoundary);
  assert(Array.isArray(state.pending_judgments), "pending controller judgments are required");
  state.pending_judgments.forEach(validateJudgment);
  validateActionReceipts(state.action_receipts, state.project_id, state.logical_controller_id);
  if (state.last_closed_campaign_id !== null) requireString(state.last_closed_campaign_id, "last closed campaign ID");
  requireSha(state.state_sha256, "AgentOS Controller state digest");
  assert(state.state_sha256 === digestWithout(state, "state_sha256"), "AgentOS Controller state digest mismatch");
  if (state.active_campaign !== null) assert(["CAMPAIGN_ACTIVE", "DEPLOYMENT_PENDING", "OWNER_ONLY", "PAUSED"].includes(state.operational_status), "active campaign status is inconsistent");
  return state;
}

export function compileAgentOSControllerState({
  projectId,
  logicalControllerId,
  currentSessionId,
  policyState,
  controllerRuntimeReadback,
  nowUtc,
  reconciliationIntervalMinutes = 15,
}) {
  validatePolicyState(policyState);
  validateControllerRuntimeReadback(controllerRuntimeReadback);
  assert(controllerRuntimeReadback.project_id === projectId, "controller Runtime readback project differs");
  const state = {
    schema: CONTROLLER_SCHEMA,
    version: 1,
    status: "PREPARED_NOT_ACTIVATED",
    // A persistent Controller is never represented as idle after setup.  With
    // no admitted campaign it remains alive in an event-driven wait state;
    // PREPARED_NOT_ACTIVATED still keeps Product and external actions closed.
    operational_status: "EVENT_DRIVEN_WAIT",
    logical_controller_id: logicalControllerId,
    project_id: projectId,
    current_session_id: currentSessionId,
    controller_agent: compileControllerAgentBinding({projectId, logicalControllerId, sessionId: currentSessionId, policyEpoch: policyState.policy_epoch, policyStateSha256: policyState.policy_state_sha256, observedAtUtc: nowUtc}),
    controller_runtime_readback: structuredClone(controllerRuntimeReadback),
    controller_role: AGENTOS_CONTROLLER_ROLE,
    controller_display_name: AGENTOS_CONTROLLER_DISPLAY_NAME,
    policy_state: structuredClone(policyState),
    policy_epoch: policyState.policy_epoch,
    policy_state_sha256: policyState.policy_state_sha256,
    active_campaign_id: null,
    active_campaign: null,
    campaign_queue: [],
    runtime_id: controllerRuntimeReadback.runtime_id,
    event_cursor: 0,
    event_ledger_head_sha256: null,
    last_reconciliation_at: nowUtc,
    reconciliation_interval_minutes: reconciliationIntervalMinutes,
    pending_owner_boundaries: [],
    pending_judgments: [],
    action_receipts: [],
    last_closed_campaign_id: null,
    state_sha256: null,
  };
  state.state_sha256 = digestWithout(state, "state_sha256");
  return validateAgentOSControllerState(state);
}

export function validateControllerEvent(event) {
  exactKeys(event, ["schema", "version", "event_id", "event_type", "issuer_id", "source_role", "authority_epoch", "nonce", "controller_id", "project_id", "policy_epoch", "policy_state_sha256", "campaign_id", "sequence", "prior_controller_head_sha256", "payload", "occurred_at_utc", "event_sha256", "signature_base64"], "controller event");
  assert(event.schema === EVENT_SCHEMA && event.version === 1, "controller event identity is invalid");
  requireIdentifier(event.event_id, "controller event ID");
  assert(EVENT_TYPES.includes(event.event_type), "controller event type is invalid");
  requireIdentifier(event.issuer_id, "controller event issuer ID");
  requireString(event.source_role, "controller event source role");
  assert(Number.isSafeInteger(event.authority_epoch) && event.authority_epoch >= 1, "controller event authority epoch is invalid");
  requireSha(event.nonce, "controller event nonce");
  requireIdentifier(event.controller_id, "controller event controller ID");
  requireString(event.project_id, "controller event project ID");
  assert(Number.isSafeInteger(event.policy_epoch) && event.policy_epoch >= 1, "controller event policy epoch is invalid");
  requireSha(event.policy_state_sha256, "controller event policy state");
  if (event.campaign_id !== null) requireString(event.campaign_id, "controller event campaign ID");
  assert(Number.isSafeInteger(event.sequence) && event.sequence >= 1, "controller event sequence is invalid");
  if (event.prior_controller_head_sha256 !== null) requireSha(event.prior_controller_head_sha256, "controller event prior head");
  requireRecord(event.payload, "controller event payload");
  requireUtc(event.occurred_at_utc, "controller event time");
  requireSha(event.event_sha256, "controller event digest");
  requireString(event.signature_base64, "controller event signature");
  return event;
}

export function compileControllerEvent() {
  const error = new Error("Controller events require an externally held canonical Ed25519 issuer key; local role claims cannot compile signed authority");
  error.code = "CONTROLLER_EVENT_EXTERNAL_SIGNATURE_REQUIRED";
  throw error;
}

function requireReadback({adapters, operation, state, event, payload = {}}) {
  assertControllerOperationAuthorized(operation);
  assert(isRecord(adapters) && typeof adapters[operation] === "function", `required project adapter is unavailable: ${operation}`);
  const actionId = `${event.event_id}:${operation.toUpperCase()}`;
  const readback = adapters[operation]({
    operation,
    action_id: actionId,
    controller_state: structuredClone(state),
    event: structuredClone(event),
    payload: structuredClone(payload),
  });
  validateControllerAdapterReadback(readback);
  assert(readback.operation === operation && readback.action_id === actionId && readback.event_id === event.event_id, `${operation} readback is not bound to the action`);
  assert(readback.controller_id === state.logical_controller_id && readback.project_id === state.project_id, `${operation} readback is not bound to the controller/project`);
  assert(readback.policy_epoch === state.policy_epoch && readback.policy_state_sha256 === state.policy_state_sha256, `${operation} readback is stale for policy state`);
  assert(readback.campaign_id === (state.active_campaign_id ?? event.campaign_id ?? null), `${operation} readback is not bound to the current campaign`);
  assert(readback.status === "SUCCESS", `${operation} did not complete successfully: ${readback.status}`);
  assert(readback.external_identity !== null, `${operation} did not return an external identity`);
  return readback;
}

function requireDetails(readback, fields, label) {
  for (const field of fields) assert(Object.hasOwn(readback.details, field), `${label} readback lacks ${field}`);
  return readback.details;
}

function sessionIdsFromSpawnReadback(readback) {
  const details = readback?.details ?? {};
  const ids = [];
  if (typeof details.session_id === "string" && details.session_id.length > 0) ids.push(details.session_id);
  if (Array.isArray(details.feature_agent_session_ids)) ids.push(...details.feature_agent_session_ids.filter((value) => typeof value === "string" && value.length > 0));
  if (Array.isArray(details.worker_readbacks)) ids.push(...details.worker_readbacks.map((value) => value?.session_id).filter((value) => typeof value === "string" && value.length > 0));
  return [...new Set(ids)];
}

function updateState(state, patch) {
  const next = {...state, ...patch, state_sha256: null};
  next.state_sha256 = digestWithout(next, "state_sha256");
  return validateAgentOSControllerState(next);
}

function appendReadbacks(state, readbacks) {
  return [...state.action_receipts, ...readbacks];
}

export function validateControllerEventPreconditions({state, event, globalGovernanceContext, globalGovernanceAuthorityStore, ...unexpected}) {
  assert(Object.keys(unexpected).length === 0, "Controller preconditions reject caller-supplied authority overrides");
  validateAgentOSControllerState(state);
  validateControllerEvent(event);
  const controllerAuthority = assertCanonicalControllerEventAuthority({event, state});
  assertOperationalGlobalGovernanceContext(globalGovernanceContext, {authorityStore: globalGovernanceAuthorityStore, expectedRoleClass: "CONTROLLER"});
  requireSha(event.payload.global_model_policy_projection_sha256, "Controller global model-policy projection");
  assert(event.payload.global_model_policy_projection_sha256 === globalGovernanceContext.projection_sha256, "Controller global model-policy projection is stale or widened");
  assert(event.controller_id === state.logical_controller_id && event.project_id === state.project_id, "controller event is not bound to project controller");
  assert(event.sequence === state.event_cursor + 1, "controller event sequence is not the next event");
  assert(event.prior_controller_head_sha256 === state.event_ledger_head_sha256, "controller event prior head is stale");
  assert(event.policy_epoch === state.policy_epoch && event.policy_state_sha256 === state.policy_state_sha256, "controller event policy is stale");
  assert(state.active_campaign_id === null && event.campaign_id === null, "Controller Spawner events cannot bind an ordinary campaign");
  if (event.event_type === "SPAWNER_START_REQUESTED") {
    assert(!state.action_receipts.some((record) => record.operation === "startAgentSpawner"), "Controller may start exactly one Agent Spawner");
    requireIdentifier(event.payload.spawner_id, "Agent Spawner identity");
    requireSha(event.payload.bootstrap_package_sha256, "Agent Spawner bootstrap package");
  } else if (event.event_type === "SPAWNER_WAKE_REQUESTED") {
    const starts = state.action_receipts.filter((record) => record.operation === "startAgentSpawner");
    assert(starts.length === 1, "Controller cannot wake an absent or duplicate Spawner");
    requireIdentifier(event.payload.spawner_id, "Agent Spawner identity");
    assert(starts[0].details.spawner_id === event.payload.spawner_id, "Controller cannot wake a different Spawner");
  } else if (["SPAWNER_OBSERVE_REQUESTED", "SPAWNER_LIVENESS_RECONCILE_REQUESTED"].includes(event.event_type)) {
    const starts = state.action_receipts.filter((record) => record.operation === "startAgentSpawner");
    assert(starts.length === 1, "Controller cannot observe or reconcile an absent or duplicate Spawner");
    requireIdentifier(event.payload.spawner_id, "Agent Spawner identity");
    assert(starts[0].details.spawner_id === event.payload.spawner_id, "Controller cannot observe or reconcile a different Spawner");
  } else if (event.event_type === "REDISTRIBUTION_RECEIVED") {
    requireSha(event.payload.redistribution_handoff_sha256, "Redistribution handoff");
  } else {
    throw new Error(`CONTROLLER_EVENT_FORBIDDEN: ${event.event_type}`);
  }
  return {state, event, controllerAuthority};
}

function processControllerEvent({state, event, adapters = {}, globalGovernanceContext, globalGovernanceAuthorityStore}) {
  validateControllerEventPreconditions({state, event, globalGovernanceContext, globalGovernanceAuthorityStore});
  const readbacks = [];
  let next = state;
  const payload = event.payload;
  const add = (operation, data = payload) => {
    const readback = requireReadback({adapters, operation, state: next, event, payload: data});
    readbacks.push(readback);
    return readback;
  };

  switch (event.event_type) {
    case "SPAWNER_START_REQUESTED": {
      assert(state.active_campaign === null, "Controller cannot start Spawner while a legacy campaign is active");
      assert(!state.action_receipts.some((record) => record.operation === "startAgentSpawner"), "Controller may start exactly one Agent Spawner");
      requireIdentifier(payload.spawner_id, "Agent Spawner identity");
      requireSha(payload.bootstrap_package_sha256, "Agent Spawner bootstrap package");
      const governance = add("validateControllerGovernance", payload);
      requireDetails(governance, ["status"], "Controller governance validation");
      assert(governance.details.status === "PASS", "Controller governance validation did not pass");
      const handoff = add("validateSpawnerHandoff", payload);
      requireDetails(handoff, ["status", "spawner_id"], "Spawner handoff validation");
      assert(handoff.details.status === "PASS" && handoff.details.spawner_id === payload.spawner_id, "Spawner handoff validation differs");
      const started = add("startAgentSpawner", payload);
      requireDetails(started, ["spawner_id", "bootstrap_package_sha256", "started_count"], "Spawner start");
      assert(started.details.spawner_id === payload.spawner_id && started.details.bootstrap_package_sha256 === payload.bootstrap_package_sha256 && started.details.started_count === 1, "Controller did not start exactly one bound Spawner");
      next = updateState(next, {operational_status: "EVENT_DRIVEN_WAIT"});
      break;
    }
    case "SPAWNER_WAKE_REQUESTED": {
      const starts = state.action_receipts.filter((record) => record.operation === "startAgentSpawner");
      assert(starts.length === 1, "Controller cannot wake an absent or duplicate Spawner");
      requireIdentifier(payload.spawner_id, "Agent Spawner identity");
      const wake = add("wakeAgentSpawner", payload);
      requireDetails(wake, ["spawner_id", "status"], "Spawner wake");
      assert(wake.details.spawner_id === payload.spawner_id && wake.details.status === "WOKEN", "Spawner wake readback differs");
      next = updateState(next, {operational_status: "EVENT_DRIVEN_WAIT"});
      break;
    }
    case "SPAWNER_OBSERVE_REQUESTED": {
      const observed = add("observeAgentSpawner", payload);
      requireDetails(observed, ["spawner_id", "status"], "Spawner observation");
      assert(observed.details.spawner_id === payload.spawner_id && ["HEALTHY", "DEGRADED", "STOPPED"].includes(observed.details.status), "Spawner observation readback differs");
      next = updateState(next, {operational_status: "EVENT_DRIVEN_WAIT"});
      break;
    }
    case "SPAWNER_LIVENESS_RECONCILE_REQUESTED": {
      const reconciled = add("reconcileLiveness", payload);
      requireDetails(reconciled, ["spawner_id", "status", "ordinary_role_mutation"], "Spawner liveness reconciliation");
      assert(reconciled.details.spawner_id === payload.spawner_id && reconciled.details.status === "RECONCILED" && reconciled.details.ordinary_role_mutation === false, "Spawner liveness reconciliation exceeded Controller authority");
      next = updateState(next, {operational_status: "EVENT_DRIVEN_WAIT"});
      break;
    }
    case "REDISTRIBUTION_RECEIVED": {
      requireSha(payload.redistribution_handoff_sha256, "Redistribution handoff");
      const dispatched = add("dispatchRedistribution", payload);
      requireDetails(dispatched, ["status", "approval_required", "destination"], "Redistribution dispatch");
      assert(dispatched.details.status === "DISPATCHED" && dispatched.details.approval_required === false, "Controller treated redistribution as approval");
      requireString(dispatched.details.destination, "Redistribution destination");
      next = updateState(next, {operational_status: "EVENT_DRIVEN_WAIT"});
      break;
    }
    default:
      throw new Error(`unsupported controller event: ${event.event_type}`);
  }

  return updateState(next, {
    event_cursor: event.sequence,
    event_ledger_head_sha256: event.event_sha256,
    action_receipts: appendReadbacks(next, readbacks),
  });
}

export function readAgentOSControllerState(options = {}) {
  assert(isRecord(options), "Controller state read requires an object");
  assert(JSON.stringify(Object.keys(options).sort(compareUtf8)) === JSON.stringify(["projectControlStoreCapability"].sort(compareUtf8)), "Controller state rejects caller roots, paths, environment, and adapters", "CONTROLLER_PROJECT_STORE_ROOT_CALLER_FORBIDDEN");
  const state = readControllerProjectState(options.projectControlStoreCapability);
  return state === null ? null : validateAgentOSControllerState(state);
}

export function writeAgentOSControllerStateCompareAndSwap(options = {}) {
  assert(isRecord(options), "Controller state write requires an object");
  const allowed = ["expectedStateSha256", "projectControlStoreCapability", "state"];
  assert(Object.keys(options).every((key) => allowed.includes(key)) && Object.hasOwn(options, "projectControlStoreCapability") && Object.hasOwn(options, "state"), "Controller state write rejects caller roots, paths, environment, and adapters", "CONTROLLER_PROJECT_STORE_ROOT_CALLER_FORBIDDEN");
  validateAgentOSControllerState(options.state);
  return writeControllerProjectStateCompareAndSwap(options.projectControlStoreCapability, {
    expectedStateSha256: options.expectedStateSha256 ?? null,
    state: options.state,
    validateState: validateAgentOSControllerState,
  });
}

export function applyAndWriteAgentOSControllerEvent({projectControlStoreCapability, expectedStateSha256, event, adapters, globalGovernanceContext, globalGovernanceAuthorityStore, ...unexpected}) {
  assert(Object.keys(unexpected).length === 0, "Controller event rejects caller-supplied authority overrides");
  const current = readAgentOSControllerState({projectControlStoreCapability});
  assert(current !== null, "controller state is missing");
  if (expectedStateSha256 !== undefined) assert(current.state_sha256 === expectedStateSha256, "controller event parent state is stale");
  validateControllerEventPreconditions({state: current, event, globalGovernanceContext, globalGovernanceAuthorityStore});
  consumeControllerProjectEventOnce(projectControlStoreCapability, event);
  const state = processControllerEvent({state: current, event, adapters, globalGovernanceContext, globalGovernanceAuthorityStore});
  const persistence = writeAgentOSControllerStateCompareAndSwap({projectControlStoreCapability, expectedStateSha256: current.state_sha256, state});
  return {state, persistence};
}

function nativeEventOperations(event) {
  const operation = CONTROLLER_OPERATION_REGISTRY.operations.find((entry) => entry.event_type === event.event_type);
  assert(operation !== undefined, `NATIVE_CONTROLLER_EVENT_UNSUPPORTED: ${event.event_type} has no asynchronous host route`);
  return operation.adapters;
}

async function invokeAsyncControllerAdapter({adapters, operation, state, event, payload = {}}) {
  assert(isRecord(adapters) && typeof adapters[operation] === "function", `required native project adapter is unavailable: ${operation}`);
  const actionId = `${event.event_id}:${operation.toUpperCase()}`;
  const readback = await adapters[operation]({
    operation,
    action_id: actionId,
    controller_state: structuredClone(state),
    event: structuredClone(event),
    payload: structuredClone(payload),
  });
  validateControllerAdapterReadback(readback);
  assert(readback.operation === operation && readback.action_id === actionId && readback.event_id === event.event_id, `${operation} readback is not bound to the asynchronous action`);
  assert(readback.controller_id === state.logical_controller_id && readback.project_id === state.project_id, `${operation} readback is not bound to the asynchronous controller/project`);
  assert(readback.policy_epoch === state.policy_epoch && readback.policy_state_sha256 === state.policy_state_sha256, `${operation} asynchronous readback is stale for policy state`);
  assert(readback.campaign_id === (state.active_campaign_id ?? event.campaign_id ?? null), `${operation} asynchronous readback is not bound to the current campaign`);
  assert(readback.status === "SUCCESS", `${operation} did not complete successfully: ${readback.status}`);
  assert(readback.external_identity !== null, `${operation} did not return an external identity`);
  return readback;
}

/*
 * Async companion for the real host path. The durable Controller state machine
 * remains synchronous and deterministic; host calls happen first, are fully
 * validated, and are then replayed as immutable readbacks through that same
 * state machine. This keeps provider I/O out of the state transition logic.
 */
export async function applyAndWriteAgentOSControllerEventAsync({projectControlStoreCapability, expectedStateSha256, event, adapters, globalGovernanceContext, globalGovernanceAuthorityStore, ...unexpected}) {
  assert(Object.keys(unexpected).length === 0, "Controller event rejects caller-supplied authority overrides");
  const current = readAgentOSControllerState({projectControlStoreCapability});
  assert(current !== null, "controller state is missing");
  if (expectedStateSha256 !== undefined) assert(current.state_sha256 === expectedStateSha256, "controller event parent state is stale");
  validateControllerEventPreconditions({state: current, event, globalGovernanceContext, globalGovernanceAuthorityStore});
  consumeControllerProjectEventOnce(projectControlStoreCapability, event);
  const operations = nativeEventOperations(event);
  const prepared = new Map();
  for (const operation of operations) {
    const readback = await invokeAsyncControllerAdapter({adapters, operation, state: current, event, payload: event.payload});
    prepared.set(operation, readback);
  }
  const synchronousAdapters = Object.fromEntries(operations.map((operation) => [operation, () => prepared.get(operation)]));
  const state = processControllerEvent({state: current, event, adapters: synchronousAdapters, globalGovernanceContext, globalGovernanceAuthorityStore});
  const persistence = writeAgentOSControllerStateCompareAndSwap({projectControlStoreCapability, expectedStateSha256: current.state_sha256, state});
  return {state, persistence, host_readbacks: Object.fromEntries(prepared)};
}

if (process.argv[1] !== undefined && fs.existsSync(process.argv[1]) && import.meta.url === pathToFileURL(fs.realpathSync.native(path.resolve(process.argv[1]))).href) {
  throw new Error("CONTROLLER_DIRECT_PATH_FORBIDDEN: use the opaque project-store capability and Controller API");
}
