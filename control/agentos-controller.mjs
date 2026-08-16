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
import {
  compileCampaignPolicyProjection,
  reconcileCampaignPolicy,
  validateCampaignPolicyReconciliation,
} from "./campaign-policy-reconcile.mjs";
import {reconcilePolicyAtCampaignBoundary} from "./campaign-state-owner.mjs";
import {validatePolicyAmendment, validatePolicyState} from "./global-policy-state.mjs";
import {AGENTOS_CONTROLLER_DISPLAY_NAME, AGENTOS_CONTROLLER_ROLE, validateControllerRoleDisplay} from "./controller-role-display.mjs";
import {
  validateGovernanceArchitecture,
} from "./role-governance-library.mjs";
import {ARCHITECTURE_ACCEPTANCE_REQUIREMENTS} from "./governance-library.mjs";

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
const EVENT_TYPES = Object.freeze([
  "BOOTSTRAP_REQUESTED",
  "BOOTSTRAP_PROMOTED",
  "USER_REVIEW_RETURNED",
  "LOCAL_SELF_DEVELOPMENT_AUTHORIZED",
  "CAMPAIGN_APPROVED",
  "AGENT_STALLED",
  "POLICY_AMENDMENT",
  "CHECKPOINT_READY",
  "AUDITOR_RELEASE_CLEARED",
  "RUNTIME_DEPLOYED",
  "ACCEPTED_LIVE",
  "TRUE_OWNER_BOUNDARY",
  "RECONCILIATION_TICK",
]);
const OPERATION_NAMES = Object.freeze([
  "runBootstrap",
  "bindPersistentRuntime",
  "reconcileUserReview",
  "admitLocalSelfDevelopment",
  "spawnCampaignOrchestrator",
  "spawnIndependentAuditor",
  "spawnFeatureAgents",
  "recoverStalledSession",
  "wakeControllerAgent",
  "applyPolicyReconciliation",
  "verifyCheckpoint",
  "notifyAuditor",
  "spawnNextCampaignOrchestrator",
  "deployAcceptedArtifact",
  "runLiveAudit",
  "sendLiveDeltaToNextOrchestrator",
  "closeCampaign",
  "archiveCampaignAgents",
  "reconcileLiveness",
]);
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
  exactKeys(event, ["schema", "version", "event_id", "event_type", "source_role", "controller_id", "project_id", "policy_epoch", "policy_state_sha256", "campaign_id", "sequence", "prior_controller_head_sha256", "payload", "occurred_at_utc", "event_sha256"], "controller event");
  assert(event.schema === EVENT_SCHEMA && event.version === 1, "controller event identity is invalid");
  requireIdentifier(event.event_id, "controller event ID");
  assert(EVENT_TYPES.includes(event.event_type), "controller event type is invalid");
  requireString(event.source_role, "controller event source role");
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
  assert(event.event_sha256 === digestWithout(event, "event_sha256"), "controller event digest mismatch");
  return event;
}

export function compileControllerEvent({eventId, eventType, sourceRole, controllerId, projectId, policyEpoch, policyStateSha256, campaignId = null, sequence, priorControllerHeadSha256 = null, payload = {}, occurredAtUtc}) {
  const event = {
    schema: EVENT_SCHEMA,
    version: 1,
    event_id: eventId,
    event_type: eventType,
    source_role: sourceRole,
    controller_id: controllerId,
    project_id: projectId,
    policy_epoch: policyEpoch,
    policy_state_sha256: policyStateSha256,
    campaign_id: campaignId,
    sequence,
    prior_controller_head_sha256: priorControllerHeadSha256,
    payload: structuredClone(payload),
    occurred_at_utc: occurredAtUtc,
    event_sha256: null,
  };
  event.event_sha256 = digestWithout(event, "event_sha256");
  return validateControllerEvent(event);
}

function requireReadback({adapters, operation, state, event, payload = {}}) {
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

function spawnCampaignRolesWithRollback({adapters, state, event, payload, operations}) {
  assert(typeof adapters.archiveCampaignAgents === "function", "campaign spawn cleanup adapter is unavailable");
  const readbacks = [];
  const spawnedSessionIds = [];
  try {
    for (const operation of operations) {
      const readback = requireReadback({adapters, operation, state, event, payload});
      readbacks.push(readback);
      spawnedSessionIds.push(...sessionIdsFromSpawnReadback(readback));
    }
    return readbacks;
  } catch (error) {
    const uniqueSpawnedSessionIds = [...new Set(spawnedSessionIds)].sort(compareUtf8);
    if (uniqueSpawnedSessionIds.length === 0) throw error;
    try {
      const cleanup = requireReadback({
        adapters,
        operation: "archiveCampaignAgents",
        state,
        event,
        payload: {
          ...payload,
          spawned_session_ids: uniqueSpawnedSessionIds,
          cleanup_reason: "campaign role spawn failed before activation",
        },
      });
      const archived = cleanup.details?.archived_session_ids;
      assert(Array.isArray(archived), "campaign spawn cleanup readback lacks archived_session_ids");
      const archivedSet = new Set(archived);
      assert(archivedSet.size === archived.length && uniqueSpawnedSessionIds.every((sessionId) => archivedSet.has(sessionId)), "campaign spawn cleanup did not confirm every created session");
    } catch (cleanupError) {
      const combined = new Error(`campaign role spawn failed and cleanup failed: ${cleanupError.message}`);
      combined.code = "CAMPAIGN_SPAWN_CLEANUP_FAILED";
      combined.cause = error;
      combined.cleanup_error = cleanupError.message;
      combined.spawned_session_ids = uniqueSpawnedSessionIds;
      throw combined;
    }
    throw error;
  }
}

function validateLocalAuthorizationEnvelope(authorization) {
  exactKeys(authorization, [
    "schema", "version", "status", "source", "owner_decision", "campaign_id", "campaign_version", "source_commit", "source_tree",
    "parent_audit_packet_sha256", "parent_audit_addendum_sha256", "owner_intent_sha256", "decision_tree_requirement_sha256",
    "policy_epoch", "policy_state_sha256", "acceptance_contract_sha256", "model_plan_sha256", "scope_sha256", "permissions",
    "worker_roles", "stop_conditions", "authorization_sha256",
  ], "local self-development authorization event");
  assert(authorization.schema === "agentos.local_development_authorization.v1" && authorization.version === 1 && authorization.status === "AUTHORIZED", "local self-development authorization is invalid");
  assert(authorization.source === "OWNER_EXISTING_CONSENT", "local self-development authorization is not current owner consent");
  requireSha(authorization.authorization_sha256, "local self-development authorization digest");
  assert(authorization.authorization_sha256 === digestWithout(authorization, "authorization_sha256"), "local self-development authorization digest mismatch");
  assert(authorization.permissions.local_development_writes_allowed === true && authorization.permissions.local_worker_agent_spawns_allowed === true, "local self-development permissions are not enabled");
  for (const field of ["product_writes_allowed", "product_agent_spawns_allowed", "external_deployment_allowed", "external_release_allowed", "external_publication_allowed", "external_push_allowed", "external_merge_allowed", "secrets_allowed", "destructive_work_allowed"]) assert(authorization.permissions[field] === false, `local self-development authorization crosses ${field}`);
  return authorization;
}

function validateLocalAdmissionEnvelope(admission, candidate, authorization) {
  requireRecord(admission, "local self-development admission");
  assert(admission.schema === "agentos.local_campaign_admission.v1" && admission.version === 1 && admission.status === "CAMPAIGN_ADMITTED", "local self-development admission is invalid");
  assert(admission.active_campaign === false && admission.next_event === "LOCAL_SELF_DEVELOPMENT_AUTHORIZED", "local self-development admission crossed its start boundary");
  assert(admission.campaign_id === candidate.campaign_id && admission.campaign_version === candidate.campaign_version, "local self-development admission campaign differs");
  assert(admission.controller_candidate_sha256 === candidate.candidate_sha256 && admission.authorization_sha256 === authorization.authorization_sha256, "local self-development admission identity differs");
  requireSha(admission.admission_sha256, "local self-development admission digest");
  assert(admission.admission_sha256 === digestWithout(admission, "admission_sha256"), "local self-development admission digest mismatch");
  return admission;
}

function policyAmendmentNeedsControllerRotation(amendment) {
  return amendment.affected_variable_ids.includes("MODEL.PROFILE") || amendment.affected_variable_ids.some((id) => id.startsWith("MODEL.ROLE."));
}

function validateNextRoster(previous, next, reconciliation) {
  validateRoster(previous, "previous campaign roster");
  validateRoster(next, "next campaign roster");
  const oldByRole = new Map(previous.map((record) => [record.role, record]));
  const assignments = new Map(reconciliation.next_assignments.map((record) => [record.role, record]));
  for (const record of next) {
    const old = oldByRole.get(record.role);
    const assignment = assignments.get(record.role);
    assert(old && assignment, `next campaign roster has an unplanned role: ${record.role}`);
    assert(record.model_class === assignment.model_class, `next campaign roster model differs for ${record.role}`);
    if (assignment.assignment_status === "ROTATE_AT_BOUNDARY") assert(record.session_id !== old.session_id, `rotated campaign role retained stale session: ${record.role}`);
    else assert(record.session_id === old.session_id, `retained campaign role changed session: ${record.role}`);
  }
}

function makeActiveCampaign({state, candidate, orchestrator, auditor, features, stage = "BUILDING"}) {
  const projection = compileCampaignPolicyProjection({policyState: state.policy_state, campaignId: candidate.campaign_id, campaignVersion: candidate.campaign_version});
  const roleModel = (role) => projection.role_models.find((record) => record.role === role).model_class;
  const roster = [
    {role: "CAMPAIGN_ORCHESTRATOR", session_id: orchestrator, model_class: roleModel("CAMPAIGN_ORCHESTRATOR")},
    {role: "INDEPENDENT_AUDITOR", session_id: auditor, model_class: roleModel("INDEPENDENT_AUDITOR")},
    {role: "FEATURE_AGENT", session_id: features[0], model_class: roleModel("FEATURE_AGENT")},
  ].sort((left, right) => compareUtf8(left.role, right.role));
  return {
    campaign_id: candidate.campaign_id,
    campaign_version: candidate.campaign_version,
    candidate: structuredClone(candidate),
    candidate_sha256: candidate.candidate_sha256,
    orchestrator_session_id: orchestrator,
    auditor_session_id: auditor,
    feature_agent_session_ids: sorted(features),
    platform_agent_session_ids: [],
    roster,
    stage,
    policy_epoch: state.policy_epoch,
    policy_state_sha256: state.policy_state_sha256,
    latest_checkpoint_sha256: null,
    next_orchestrator_session_id: null,
    next_orchestrator_orientation_only: true,
    deployment_identity: null,
    rollback_identity: null,
    live_audit_identity: null,
  };
}

function updateState(state, patch) {
  const next = {...state, ...patch, state_sha256: null};
  next.state_sha256 = digestWithout(next, "state_sha256");
  return validateAgentOSControllerState(next);
}

function appendReadbacks(state, readbacks) {
  return [...state.action_receipts, ...readbacks];
}

function queueCandidate(state, candidate, occurredAtUtc) {
  const existing = state.campaign_queue.find((entry) => entry.campaign_id === candidate.campaign_id);
  if (existing) {
    assert(existing.candidate.candidate_sha256 === candidate.candidate_sha256, "controller queue campaign candidate changed");
    return state.campaign_queue;
  }
  return [...state.campaign_queue, {
    campaign_id: candidate.campaign_id,
    campaign_version: candidate.campaign_version,
    candidate: structuredClone(candidate),
    status: "PROPOSED",
    queued_at_utc: occurredAtUtc,
    admitted_at_utc: null,
  }].sort((left, right) => compareUtf8(left.campaign_id, right.campaign_id));
}

function markQueueActive(queue, campaignId, occurredAtUtc) {
  return queue.map((entry) => entry.campaign_id === campaignId
    ? {...entry, status: "ACTIVE", admitted_at_utc: occurredAtUtc}
    : entry);
}

function markQueueClosed(queue, campaignId) {
  return queue.map((entry) => entry.campaign_id === campaignId ? {...entry, status: "CLOSED"} : entry);
}

export function processControllerEvent({state, event, adapters = {}, nowUtc = event?.occurred_at_utc}) {
  validateAgentOSControllerState(state);
  validateControllerEvent(event);
  assert(event.controller_id === state.logical_controller_id && event.project_id === state.project_id, "controller event is not bound to project controller");
  assert(event.sequence === state.event_cursor + 1, "controller event sequence is not the next event");
  assert(event.prior_controller_head_sha256 === state.event_ledger_head_sha256, "controller event prior head is stale");
  assert(event.policy_epoch === state.policy_epoch && event.policy_state_sha256 === state.policy_state_sha256, "controller event policy is stale");
  if (state.active_campaign_id !== null) assert(event.campaign_id === state.active_campaign_id || event.event_type === "TRUE_OWNER_BOUNDARY", "controller event campaign differs from active campaign");
  const readbacks = [];
  let next = state;
  const payload = event.payload;
  const add = (operation, data = payload) => {
    const readback = requireReadback({adapters, operation, state: next, event, payload: data});
    readbacks.push(readback);
    return readback;
  };

  switch (event.event_type) {
    case "BOOTSTRAP_REQUESTED": {
      assert(state.active_campaign === null, "Bootstrap cannot start while a campaign is active");
      add("runBootstrap");
      next = updateState(next, {operational_status: "BOOTSTRAPPING"});
      break;
    }
    case "BOOTSTRAP_PROMOTED": {
      assert(state.active_campaign === null, "Bootstrap promotion cannot occur during an active campaign");
      const readback = add("bindPersistentRuntime");
      const details = requireDetails(readback, ["runtime_id", "controller_runtime_id"], "Runtime binding");
      assert(details.runtime_id === state.runtime_id, "Runtime binding changed the persistent Runtime identity");
      next = updateState(next, {operational_status: "OWNER_REVIEW_PENDING"});
      break;
    }
    case "USER_REVIEW_RETURNED": {
      assert(state.active_campaign === null, "User Review return cannot replace an active campaign");
      const readback = add("reconcileUserReview");
      const details = requireDetails(readback, ["candidate"], "User Review reconciliation");
      validateControllerCampaignCandidate(details.candidate);
      assert(details.candidate.project_id === state.project_id && details.candidate.policy_epoch === state.policy_epoch && details.candidate.policy_state_sha256 === state.policy_state_sha256, "User Review candidate is stale for project policy");
      next = updateState(next, {operational_status: "OWNER_REVIEW_PENDING", campaign_queue: queueCandidate(next, details.candidate, event.occurred_at_utc)});
      break;
    }
    case "LOCAL_SELF_DEVELOPMENT_AUTHORIZED": {
      assert(state.active_campaign === null, "local self-development admission cannot replace an active campaign");
      assert(state.runtime_id !== null, "persistent Runtime is required before local self-development admission");
      const candidate = payload.candidate;
      validateControllerCampaignCandidate(candidate);
      assert(candidate.project_id === state.project_id && candidate.policy_epoch === state.policy_epoch && candidate.policy_state_sha256 === state.policy_state_sha256, "local self-development candidate is stale");
      const authorization = validateLocalAuthorizationEnvelope(payload.authorization);
      assert(authorization.campaign_id === candidate.campaign_id && authorization.campaign_version === candidate.campaign_version, "local self-development authorization campaign differs");
      assert(authorization.source_commit === candidate.source_commit && authorization.source_tree === candidate.source_tree, "local self-development authorization source differs");
      assert(authorization.policy_epoch === candidate.policy_epoch && authorization.policy_state_sha256 === candidate.policy_state_sha256, "local self-development authorization policy differs");
      assert(authorization.owner_intent_sha256 === candidate.owner_intent_sha256 && authorization.acceptance_contract_sha256 === candidate.acceptance_contract_sha256, "local self-development authorization intent differs");
      const admission = validateLocalAdmissionEnvelope(payload.admission, candidate, authorization);
      const identityBinding = payload.identity_binding;
      requireRecord(identityBinding, "local self-development identity binding");
      requireSha(identityBinding.binding_sha256, "local self-development identity binding digest");
      const admissionReadback = add("admitLocalSelfDevelopment", {authorization, admission, candidate, identity_binding: identityBinding});
      const admissionDetails = requireDetails(admissionReadback, ["status", "admission_sha256", "authorization_sha256", "candidate_sha256", "identity_binding_sha256"], "local self-development admission");
      assert(admissionDetails.status === "CAMPAIGN_ADMITTED" && admissionDetails.admission_sha256 === admission.admission_sha256 && admissionDetails.authorization_sha256 === authorization.authorization_sha256 && admissionDetails.candidate_sha256 === candidate.candidate_sha256 && admissionDetails.identity_binding_sha256 === identityBinding.binding_sha256, "local self-development admission readback differs");
      // Feature custody must exist before the Auditor reports on the changed tree.
      const [orchestratorReadback, featureReadback, auditorReadback] = spawnCampaignRolesWithRollback({
        adapters,
        state: next,
        event,
        payload,
        operations: ["spawnCampaignOrchestrator", "spawnFeatureAgents", "spawnIndependentAuditor"],
      });
      readbacks.push(orchestratorReadback, featureReadback, auditorReadback);
      const orchestrator = requireDetails(orchestratorReadback, ["session_id", "worker_readback"], "local Campaign Orchestrator spawn").session_id;
      const auditor = requireDetails(auditorReadback, ["session_id", "worker_readback"], "local Independent Auditor spawn").session_id;
      const featureDetails = requireDetails(featureReadback, ["feature_agent_session_ids", "worker_readbacks"], "local Feature Agent spawn");
      const features = featureDetails.feature_agent_session_ids;
      sortedUnique(features, "local Feature Agent spawn sessions");
      assert(features.length > 0 && !features.includes(orchestrator) && !features.includes(auditor), "local campaign worker sessions are not independent");
      const activeCampaign = makeActiveCampaign({state: next, candidate, orchestrator, auditor, features, stage: "BUILDING_AND_AUDITING"});
      next = updateState(next, {operational_status: "CAMPAIGN_ACTIVE", active_campaign_id: candidate.campaign_id, active_campaign: activeCampaign, campaign_queue: markQueueActive(queueCandidate(next, candidate, event.occurred_at_utc), candidate.campaign_id, event.occurred_at_utc)});
      break;
    }
    case "CAMPAIGN_APPROVED": {
      assert(state.active_campaign === null, "a campaign is already active");
      assert(state.runtime_id !== null, "persistent Runtime is required before campaign admission");
      assert(payload.authorization === undefined && payload.admission === undefined, "local self-development must use LOCAL_SELF_DEVELOPMENT_AUTHORIZED");
      const candidate = payload.candidate;
      validateControllerCampaignCandidate(candidate);
      assert(candidate.project_id === state.project_id && candidate.policy_epoch === state.policy_epoch && candidate.policy_state_sha256 === state.policy_state_sha256, "approved campaign candidate is stale");
      if (payload.owner_approval_sha256 !== undefined) requireSha(payload.owner_approval_sha256, "campaign owner approval");
      const queued = state.campaign_queue.find((entry) => entry.campaign_id === candidate.campaign_id);
      if (queued) assert(queued.candidate.candidate_sha256 === candidate.candidate_sha256, "approved candidate differs from queued review candidate");
      const [orchestratorReadback, auditorReadback, featureReadback] = spawnCampaignRolesWithRollback({
        adapters,
        state: next,
        event,
        payload,
        operations: ["spawnCampaignOrchestrator", "spawnIndependentAuditor", "spawnFeatureAgents"],
      });
      readbacks.push(orchestratorReadback, auditorReadback, featureReadback);
      const orchestrator = requireDetails(orchestratorReadback, ["session_id"], "Campaign Orchestrator spawn").session_id;
      const auditor = requireDetails(auditorReadback, ["session_id"], "Auditor spawn").session_id;
      const features = requireDetails(featureReadback, ["feature_agent_session_ids"], "Feature Agent spawn").feature_agent_session_ids;
      sortedUnique(features, "Feature Agent spawn sessions");
      assert(features.length > 0 && !features.includes(orchestrator) && !features.includes(auditor), "campaign roster sessions are not independent");
      const activeCampaign = makeActiveCampaign({state: next, candidate, orchestrator, auditor, features});
      next = updateState(next, {operational_status: "CAMPAIGN_ACTIVE", active_campaign_id: candidate.campaign_id, active_campaign: activeCampaign, campaign_queue: markQueueActive(queueCandidate(next, candidate, event.occurred_at_utc), candidate.campaign_id, event.occurred_at_utc)});
      break;
    }
    case "AGENT_STALLED": {
      assert(state.active_campaign !== null, "stalled-agent recovery requires an active campaign");
      if (payload.judgment_required === true) {
        const readback = add("wakeControllerAgent");
        const details = requireDetails(readback, ["judgment_id", "reason", "affected_outcomes"], "Controller judgment wake");
        next = updateState(next, {
          operational_status: "OWNER_ONLY",
          pending_judgments: [...next.pending_judgments, {judgment_id: details.judgment_id, reason: details.reason, affected_outcomes: sorted(details.affected_outcomes), created_at_utc: event.occurred_at_utc}],
        });
      } else {
        const readback = add("recoverStalledSession");
        const details = requireDetails(readback, ["replacement_session_id", "role"], "stalled-agent recovery");
        requireString(details.replacement_session_id, "replacement session");
        requireString(details.role, "recovered role");
        next = updateState(next, {operational_status: "CAMPAIGN_ACTIVE"});
      }
      break;
    }
    case "POLICY_AMENDMENT": {
      const amendment = payload.amendment;
      const nextPolicyState = payload.next_policy_state;
      requireRecord(amendment, "policy amendment event amendment");
      validatePolicyAmendment(amendment);
      validatePolicyState(nextPolicyState);
      assert(amendment.project_id === state.project_id && amendment.parent_policy_state_sha256 === state.policy_state_sha256, "policy amendment is not based on current controller policy");
      assert(nextPolicyState.project_id === state.project_id && nextPolicyState.parent_policy_state_sha256 === state.policy_state_sha256 && nextPolicyState.policy_epoch === state.policy_epoch + 1, "policy amendment next state is not the immediate child");
      let reconciliation = null;
      let nextProjection = null;
      if (state.active_campaign !== null) {
        const boundary = reconcilePolicyAtCampaignBoundary({
          currentPolicyState: state.policy_state,
          nextPolicyState,
          amendment,
          campaignId: state.active_campaign.campaign_id,
          campaignVersion: state.active_campaign.campaign_version,
          activeRoster: state.active_campaign.roster,
          currentBoundary: payload.current_boundary ?? amendment.effective_boundary,
        });
        reconciliation = boundary.reconciliation;
        nextProjection = boundary.nextProjection;
      } else {
        nextProjection = compileCampaignPolicyProjection({policyState: nextPolicyState, campaignId: event.campaign_id ?? "PROJECT", campaignVersion: "next"});
      }
      const readback = add("applyPolicyReconciliation", {amendment, next_policy_state: nextPolicyState, reconciliation});
      const details = requireDetails(readback, state.active_campaign === null
        ? ["policy_state_sha256", "controller_session_id"]
        : ["policy_state_sha256", "controller_session_id", "reconciliation_sha256", "next_roster", "recompiled_candidate"], "policy reconciliation");
      assert(details.policy_state_sha256 === nextPolicyState.policy_state_sha256, "policy adapter did not persist the next policy state");
      if (reconciliation !== null) {
        requireSha(details.reconciliation_sha256, "policy reconciliation readback");
        assert(details.reconciliation_sha256 === reconciliation.reconciliation_sha256, "policy adapter reconciliation differs");
        validateNextRoster(state.active_campaign.roster, details.next_roster, reconciliation);
        validateControllerCampaignCandidate(details.recompiled_candidate);
        assert(details.recompiled_candidate.project_id === state.project_id
          && details.recompiled_candidate.campaign_id === state.active_campaign.campaign_id
          && details.recompiled_candidate.campaign_version === state.active_campaign.campaign_version
          && details.recompiled_candidate.policy_epoch === nextPolicyState.policy_epoch
          && details.recompiled_candidate.policy_state_sha256 === nextPolicyState.policy_state_sha256,
        "policy reconciliation did not return a candidate compiled for the next policy");
      }
      const controllerAgent = compileControllerAgentBinding({
        projectId: state.project_id,
        logicalControllerId: state.logical_controller_id,
        sessionId: details.controller_session_id,
        policyEpoch: nextPolicyState.policy_epoch,
        policyStateSha256: nextPolicyState.policy_state_sha256,
        observedAtUtc: event.occurred_at_utc,
      });
      const activeCampaign = state.active_campaign === null ? null : {
        ...state.active_campaign,
        candidate: details.recompiled_candidate,
        candidate_sha256: details.recompiled_candidate.candidate_sha256,
        roster: details.next_roster,
        policy_epoch: nextPolicyState.policy_epoch,
        policy_state_sha256: nextPolicyState.policy_state_sha256,
      };
      next = updateState(next, {
        current_session_id: details.controller_session_id,
        controller_agent: controllerAgent,
        policy_state: structuredClone(nextPolicyState),
        policy_epoch: nextPolicyState.policy_epoch,
        policy_state_sha256: nextPolicyState.policy_state_sha256,
        active_campaign: activeCampaign,
        operational_status: activeCampaign === null ? "OWNER_REVIEW_PENDING" : "CAMPAIGN_ACTIVE",
      });
      break;
    }
    case "CHECKPOINT_READY": {
      assert(state.active_campaign !== null, "checkpoint requires an active campaign");
      const verified = add("verifyCheckpoint");
      const verifiedDetails = requireDetails(verified, ["checkpoint_sha256"], "checkpoint verification");
      requireSha(payload.checkpoint_sha256, "checkpoint event");
      assert(verifiedDetails.checkpoint_sha256 === payload.checkpoint_sha256, "checkpoint readback differs from event");
      const notified = add("notifyAuditor", {checkpoint_sha256: payload.checkpoint_sha256});
      const notifiedDetails = requireDetails(notified, ["checkpoint_sha256", "auditor_session_id"], "Auditor notification");
      assert(notifiedDetails.checkpoint_sha256 === payload.checkpoint_sha256 && notifiedDetails.auditor_session_id === state.active_campaign.auditor_session_id, "Auditor notification is not bound to checkpoint/roster");
      next = updateState(next, {active_campaign: {...next.active_campaign, latest_checkpoint_sha256: payload.checkpoint_sha256}});
      break;
    }
    case "AUDITOR_RELEASE_CLEARED": {
      assert(state.active_campaign !== null, "release clearance requires an active campaign");
      requireSha(payload.candidate_sha256, "release candidate");
      assert(payload.candidate_sha256 === state.active_campaign.candidate_sha256, "release clearance candidate differs");
      const orientation = add("spawnNextCampaignOrchestrator");
      const orientationDetails = requireDetails(orientation, ["session_id", "orientation_only"], "next orchestrator orientation");
      assert(orientationDetails.orientation_only === true, "next orchestrator is not orientation-only");
      const deployment = add("deployAcceptedArtifact", {candidate_sha256: payload.candidate_sha256});
      const deploymentDetails = requireDetails(deployment, ["candidate_sha256", "deployed_identity", "rollback_identity"], "deployment");
      assert(deploymentDetails.candidate_sha256 === payload.candidate_sha256, "deployment candidate differs");
      next = updateState(next, {operational_status: "DEPLOYMENT_PENDING", active_campaign: {...next.active_campaign, next_orchestrator_session_id: orientationDetails.session_id, deployment_identity: deploymentDetails.deployed_identity, rollback_identity: deploymentDetails.rollback_identity}});
      break;
    }
    case "RUNTIME_DEPLOYED": {
      assert(state.active_campaign !== null, "live audit requires an active campaign");
      requireString(payload.deployed_identity, "deployed identity");
      assert(payload.deployed_identity === state.active_campaign.deployment_identity, "Runtime deployment identity differs");
      const liveAudit = add("runLiveAudit", payload);
      const details = requireDetails(liveAudit, ["candidate_sha256", "deployed_identity", "live_audit_identity"], "live audit");
      assert(details.candidate_sha256 === state.active_campaign.candidate_sha256 && details.deployed_identity === payload.deployed_identity, "live audit is not bound to deployed candidate");
      next = updateState(next, {active_campaign: {...next.active_campaign, live_audit_identity: details.live_audit_identity}});
      break;
    }
    case "ACCEPTED_LIVE": {
      assert(state.active_campaign !== null, "accepted-live closure requires an active campaign");
      assert(state.active_campaign.live_audit_identity !== null, "accepted-live closure requires a live audit");
      add("sendLiveDeltaToNextOrchestrator");
      add("closeCampaign");
      add("archiveCampaignAgents");
      const closedId = state.active_campaign.campaign_id;
      next = updateState(next, {
        operational_status: "EVENT_DRIVEN_WAIT",
        active_campaign_id: null,
        active_campaign: null,
        campaign_queue: markQueueClosed(next.campaign_queue, closedId),
        last_closed_campaign_id: closedId,
      });
      break;
    }
    case "TRUE_OWNER_BOUNDARY": {
      assert(event.source_role === "OWNER", "owner boundary must come from the owner authority");
      const boundary = {
        boundary_id: payload.boundary_id,
        scope: payload.scope,
        reason: payload.reason,
        recommended_action: payload.recommended_action,
        created_at_utc: event.occurred_at_utc,
      };
      validateOwnerBoundary(boundary);
      next = updateState(next, {operational_status: "OWNER_ONLY", pending_owner_boundaries: [...next.pending_owner_boundaries, boundary]});
      break;
    }
    case "RECONCILIATION_TICK": {
      const readback = add("reconcileLiveness", {observed_at_utc: nowUtc});
      const details = requireDetails(readback, ["observed_at_utc"], "liveness reconciliation");
      requireUtc(details.observed_at_utc, "liveness reconciliation observation");
      const operationalStatus = next.active_campaign === null && ["IDLE", "EVENT_DRIVEN_WAIT"].includes(next.operational_status)
        ? "EVENT_DRIVEN_WAIT"
        : next.operational_status;
      next = updateState(next, {last_reconciliation_at: details.observed_at_utc, operational_status: operationalStatus});
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

function safeControllerPath(root, relativePath) {
  const resolvedRoot = fs.realpathSync.native(root);
  const target = path.resolve(resolvedRoot, relativePath);
  assert(target === resolvedRoot || target.startsWith(`${resolvedRoot}${path.sep}`), "controller state path escapes authority root");
  return {resolvedRoot, target};
}

export function readAgentOSControllerState({authorityRoot, statePath = "agentos/controller-state.json"}) {
  const {target} = safeControllerPath(authorityRoot, statePath);
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  assert(stat.isFile() && !stat.isSymbolicLink(), "controller state must be a regular non-symlink file");
  return validateAgentOSControllerState(JSON.parse(fs.readFileSync(target, "utf8")));
}

export function writeAgentOSControllerStateCompareAndSwap({authorityRoot, statePath = "agentos/controller-state.json", expectedStateSha256 = null, state}) {
  validateAgentOSControllerState(state);
  if (expectedStateSha256 !== null) requireSha(expectedStateSha256, "expected controller state digest");
  const {target} = safeControllerPath(authorityRoot, statePath);
  assert(!fs.existsSync(target) || !fs.lstatSync(target).isSymbolicLink(), "controller state may not be a symlink");
  const current = readAgentOSControllerState({authorityRoot, statePath});
  if (expectedStateSha256 === null) assert(current === null, "controller state already exists");
  else assert(current !== null && current.state_sha256 === expectedStateSha256, "controller state compare-and-swap parent is stale");
  fs.mkdirSync(path.dirname(target), {recursive: true});
  const lock = `${target}.lock`;
  const temporary = `${target}.${process.pid}.${Date.now()}.stage`;
  let lockHeld = false;
  try {
    fs.writeFileSync(lock, `${process.pid}\n`, {flag: "wx", mode: 0o600});
    lockHeld = true;
    fs.writeFileSync(temporary, `${canonicalJson(state)}\n`, {flag: "wx", mode: 0o600});
    fs.renameSync(temporary, target);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    if (lockHeld && fs.existsSync(lock)) fs.unlinkSync(lock);
  }
  const readback = readAgentOSControllerState({authorityRoot, statePath});
  assert(readback?.state_sha256 === state.state_sha256, "controller state readback differs");
  return {state_sha256: readback.state_sha256, path: statePath};
}

export function applyAndWriteAgentOSControllerEvent({authorityRoot, statePath = "agentos/controller-state.json", expectedStateSha256, event, adapters, nowUtc = event.occurred_at_utc}) {
  const current = readAgentOSControllerState({authorityRoot, statePath});
  assert(current !== null, "controller state is missing");
  if (expectedStateSha256 !== undefined) assert(current.state_sha256 === expectedStateSha256, "controller event parent state is stale");
  const state = processControllerEvent({state: current, event, adapters, nowUtc});
  const persistence = writeAgentOSControllerStateCompareAndSwap({authorityRoot, statePath, expectedStateSha256: current.state_sha256, state});
  return {state, persistence};
}

function nativeEventOperations(event) {
  if (event.event_type === "LOCAL_SELF_DEVELOPMENT_AUTHORIZED") return ["admitLocalSelfDevelopment", "spawnCampaignOrchestrator", "spawnFeatureAgents", "spawnIndependentAuditor"];
  if (event.event_type === "CAMPAIGN_APPROVED") return ["spawnCampaignOrchestrator", "spawnIndependentAuditor", "spawnFeatureAgents"];
  if (event.event_type === "RECONCILIATION_TICK") return ["reconcileLiveness"];
  if (event.event_type === "BOOTSTRAP_REQUESTED") return ["runBootstrap"];
  if (event.event_type === "BOOTSTRAP_PROMOTED") return ["bindPersistentRuntime"];
  if (event.event_type === "USER_REVIEW_RETURNED") return ["reconcileUserReview"];
  if (event.event_type === "AGENT_STALLED") return [event.payload?.judgment_required === true ? "wakeControllerAgent" : "recoverStalledSession"];
  if (event.event_type === "POLICY_AMENDMENT") return ["applyPolicyReconciliation"];
  throw new Error(`NATIVE_CONTROLLER_EVENT_UNSUPPORTED: ${event.event_type} has no asynchronous host route`);
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
export async function applyAndWriteAgentOSControllerEventAsync({authorityRoot, statePath = "agentos/controller-state.json", expectedStateSha256, event, adapters, nowUtc = event.occurred_at_utc}) {
  const current = readAgentOSControllerState({authorityRoot, statePath});
  assert(current !== null, "controller state is missing");
  if (expectedStateSha256 !== undefined) assert(current.state_sha256 === expectedStateSha256, "controller event parent state is stale");
  const operations = nativeEventOperations(event);
  const prepared = new Map();
  const spawned = [];
  try {
    for (const operation of operations) {
      const readback = await invokeAsyncControllerAdapter({adapters, operation, state: current, event, payload: event.payload});
      prepared.set(operation, readback);
      spawned.push(...sessionIdsFromSpawnReadback(readback));
    }
  } catch (error) {
    if (spawned.length > 0 && typeof adapters?.archiveCampaignAgents === "function") {
      try {
        await invokeAsyncControllerAdapter({
          adapters,
          operation: "archiveCampaignAgents",
          state: current,
          event,
          payload: {...event.payload, spawned_session_ids: [...new Set(spawned)].sort(compareUtf8), cleanup_reason: "asynchronous controller event failed before state commit"},
        });
      } catch (cleanupError) {
        error.code = "CAMPAIGN_SPAWN_CLEANUP_FAILED";
        error.cleanup_error = cleanupError?.message ?? String(cleanupError);
        error.spawned_session_ids = [...new Set(spawned)].sort(compareUtf8);
      }
    }
    throw error;
  }
  const synchronousAdapters = Object.fromEntries(operations.map((operation) => [operation, () => prepared.get(operation)]));
  // The synchronous state machine verifies that a rollback adapter exists
  // before it begins a multi-role spawn. The host calls already completed
  // above; this sentinel is intentionally unreachable on the successful
  // replay path.
  synchronousAdapters.archiveCampaignAgents = () => {
    throw new Error("native rollback was already handled before controller replay");
  };
  const state = processControllerEvent({state: current, event, adapters: synchronousAdapters, nowUtc});
  const persistence = writeAgentOSControllerStateCompareAndSwap({authorityRoot, statePath, expectedStateSha256: current.state_sha256, state});
  return {state, persistence, host_readbacks: Object.fromEntries(prepared)};
}

if (process.argv[1] !== undefined && fs.existsSync(process.argv[1]) && import.meta.url === pathToFileURL(fs.realpathSync.native(path.resolve(process.argv[1]))).href) {
  const [command, statePath] = process.argv.slice(2);
  if (!command || !statePath || command !== "validate") throw new Error("usage: agentos-controller validate <state.json>");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  process.stdout.write(`${JSON.stringify(validateAgentOSControllerState(state))}\n`);
}
