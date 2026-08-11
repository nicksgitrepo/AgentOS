#!/usr/bin/env node

/*
 * Local AgentOS self-development admission.
 *
 * This bridge is deliberately narrower than delivery or Product admission. It
 * binds one current source checkpoint to one owner authorization, then allows
 * only local AgentOS work and local worker processes. External side effects
 * remain explicit false values and are validated at every boundary.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  compileControllerCampaignCandidate,
  controllerDigest,
  validateControllerCampaignCandidate,
} from "./agentos-controller.mjs";

const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

export const LOCAL_AUTHORIZATION_SCHEMA = "agentos.local_development_authorization.v1";
export const LOCAL_IDENTITY_BINDING_SCHEMA = "agentos.local_campaign_identity_binding.v1";
export const LOCAL_ADMISSION_SCHEMA = "agentos.local_campaign_admission.v1";
export const LOCAL_ACTIVATION_SCHEMA = "agentos.local_campaign_activation.v1";

export const LOCAL_WORKER_ROLES = Object.freeze([
  "CAMPAIGN_ORCHESTRATOR",
  "INDEPENDENT_AUDITOR",
  "FEATURE_AGENT",
]);

const PERMISSION_KEYS = [
  "local_development_writes_allowed",
  "local_worker_agent_spawns_allowed",
  "product_writes_allowed",
  "product_agent_spawns_allowed",
  "external_deployment_allowed",
  "external_release_allowed",
  "external_publication_allowed",
  "external_push_allowed",
  "external_merge_allowed",
  "secrets_allowed",
  "destructive_work_allowed",
];

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

function requireGitObject(value, label) {
  assert(typeof value === "string" && GIT_OBJECT.test(value), `${label} must be a Git object identity`);
}

function requireUtc(value, label) {
  requireString(value, label);
  assert(ISO_UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} must be UTC`);
}

function exactKeys(value, keys, label) {
  requireRecord(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} fields mismatch`);
}

function digestWithout(value, field) {
  const body = structuredClone(value);
  body[field] = null;
  return controllerDigest(body);
}

function validateBooleanMap(value, label, keys) {
  exactKeys(value, keys, label);
  for (const key of keys) assert(typeof value[key] === "boolean", `${label}.${key} must be boolean`);
}

function validatePermissions(permissions) {
  validateBooleanMap(permissions, "local campaign permissions", PERMISSION_KEYS);
  assert(permissions.local_development_writes_allowed === true, "local development writes must be allowed");
  assert(permissions.local_worker_agent_spawns_allowed === true, "local worker-agent spawns must be allowed");
  for (const key of PERMISSION_KEYS.filter((key) => key !== "local_development_writes_allowed" && key !== "local_worker_agent_spawns_allowed")) {
    assert(permissions[key] === false, `${key} must remain disabled for local self-development`);
  }
}

function validateWorkerRoles(roles, label = "local worker roles") {
  assert(Array.isArray(roles) && roles.length === LOCAL_WORKER_ROLES.length, `${label} must contain the three local campaign roles`);
  const sorted = [...roles].sort();
  assert(JSON.stringify(roles) === JSON.stringify(sorted), `${label} must be sorted`);
  assert(JSON.stringify(roles) === JSON.stringify([...LOCAL_WORKER_ROLES].sort()), `${label} must contain Orchestrator, Auditor, and Feature Agent exactly once`);
}

export function validateLocalDevelopmentAuthorization(authorization) {
  exactKeys(authorization, [
    "schema", "version", "status", "source", "owner_decision", "campaign_id", "campaign_version",
    "source_commit", "source_tree", "parent_audit_packet_sha256", "parent_audit_addendum_sha256",
    "owner_intent_sha256", "decision_tree_requirement_sha256", "policy_epoch", "policy_state_sha256",
    "acceptance_contract_sha256", "model_plan_sha256", "scope_sha256", "permissions", "worker_roles",
    "stop_conditions", "authorization_sha256",
  ], "local development authorization");
  assert(authorization.schema === LOCAL_AUTHORIZATION_SCHEMA && authorization.version === 1, "local development authorization schema mismatch");
  assert(authorization.status === "AUTHORIZED", "local development authorization is not active");
  assert(authorization.source === "OWNER_EXISTING_CONSENT", "local development authorization source is not the owner's existing consent");
  exactKeys(authorization.owner_decision, ["authority", "decision", "scope", "recorded_from"], "local owner decision");
  assert(authorization.owner_decision.authority === "OWNER", "local owner decision authority is invalid");
  assert(authorization.owner_decision.decision === "START_LOCAL_AGENTOS_SELF_DEVELOPMENT", "local owner decision is not the authorized start");
  assert(authorization.owner_decision.scope === "WRITABLE_DEVELOPMENT_COPY_ONLY", "local owner decision scope is invalid");
  requireString(authorization.owner_decision.recorded_from, "local owner decision source");
  requireIdentifier(authorization.campaign_id, "local authorization campaign ID");
  requireString(authorization.campaign_version, "local authorization campaign version");
  requireGitObject(authorization.source_commit, "local authorization source commit");
  requireGitObject(authorization.source_tree, "local authorization source tree");
  for (const field of ["parent_audit_packet_sha256", "parent_audit_addendum_sha256", "owner_intent_sha256", "decision_tree_requirement_sha256", "policy_state_sha256", "acceptance_contract_sha256", "model_plan_sha256", "scope_sha256"]) requireSha(authorization[field], `local authorization ${field}`);
  assert(Number.isSafeInteger(authorization.policy_epoch) && authorization.policy_epoch >= 1, "local authorization policy epoch is invalid");
  validatePermissions(authorization.permissions);
  validateWorkerRoles(authorization.worker_roles);
  assert(Array.isArray(authorization.stop_conditions) && authorization.stop_conditions.length > 0, "local authorization stop conditions are required");
  authorization.stop_conditions.forEach((condition) => requireString(condition, "local authorization stop condition"));
  requireSha(authorization.authorization_sha256, "local authorization digest");
  assert(authorization.authorization_sha256 === digestWithout(authorization, "authorization_sha256"), "local authorization digest mismatch");
  return authorization;
}

export function compileLocalDevelopmentAuthorization({
  campaignId,
  campaignVersion,
  sourceCommit,
  sourceTree,
  parentAuditPacketSha256,
  parentAuditAddendumSha256,
  ownerIntentSha256,
  decisionTreeRequirementSha256,
  policyEpoch,
  policyStateSha256,
  acceptanceContractSha256,
  modelPlanSha256,
  scopeSha256,
  recordedFrom = "CURRENT_OWNER_AUTHORIZATION",
}) {
  const authorization = {
    schema: LOCAL_AUTHORIZATION_SCHEMA,
    version: 1,
    status: "AUTHORIZED",
    source: "OWNER_EXISTING_CONSENT",
    owner_decision: {
      authority: "OWNER",
      decision: "START_LOCAL_AGENTOS_SELF_DEVELOPMENT",
      scope: "WRITABLE_DEVELOPMENT_COPY_ONLY",
      recorded_from: recordedFrom,
    },
    campaign_id: campaignId,
    campaign_version: campaignVersion,
    source_commit: sourceCommit,
    source_tree: sourceTree,
    parent_audit_packet_sha256: parentAuditPacketSha256,
    parent_audit_addendum_sha256: parentAuditAddendumSha256,
    owner_intent_sha256: ownerIntentSha256,
    decision_tree_requirement_sha256: decisionTreeRequirementSha256,
    policy_epoch: policyEpoch,
    policy_state_sha256: policyStateSha256,
    acceptance_contract_sha256: acceptanceContractSha256,
    model_plan_sha256: modelPlanSha256,
    scope_sha256: scopeSha256,
    permissions: {
      local_development_writes_allowed: true,
      local_worker_agent_spawns_allowed: true,
      product_writes_allowed: false,
      product_agent_spawns_allowed: false,
      external_deployment_allowed: false,
      external_release_allowed: false,
      external_publication_allowed: false,
      external_push_allowed: false,
      external_merge_allowed: false,
      secrets_allowed: false,
      destructive_work_allowed: false,
    },
    worker_roles: [...LOCAL_WORKER_ROLES].sort(),
    stop_conditions: [
      "Any stale source, policy, owner-intent, decision-tree, identity, evidence, or readback binding.",
      "Any Product write, Product-agent spawn, deployment, release, publication, push, merge, secret, or destructive request.",
      "Any unavailable, duplicate, crashed, fake, or identity-mismatched local worker spawn.",
      "Any ambiguous gate answer, weak/generic gate, missing evidence, drift, stall, or failed exact re-check.",
    ],
    authorization_sha256: null,
  };
  authorization.authorization_sha256 = digestWithout(authorization, "authorization_sha256");
  return validateLocalDevelopmentAuthorization(authorization);
}

export function validateLocalCampaignIdentityBinding(binding) {
  exactKeys(binding, [
    "schema", "version", "mapping_kind", "project_id", "campaign_id", "campaign_version", "audit_campaign_version",
    "controller_candidate_sha256", "audit_candidate_id", "audit_candidate_sha256", "audit_candidate_commit", "audit_candidate_tree", "current_source_commit", "current_source_tree",
    "audit_plan_sha256", "audit_reconciliation_sha256", "parent_audit_packet_sha256", "parent_audit_addendum_sha256",
    "owner_intent_sha256", "decision_tree_requirement_sha256", "policy_epoch", "policy_state_sha256", "acceptance_contract_sha256", "binding_sha256",
  ], "local campaign identity binding");
  assert(binding.schema === LOCAL_IDENTITY_BINDING_SCHEMA && binding.version === 1, "local campaign identity binding schema mismatch");
  assert(binding.mapping_kind === "CURRENT_SOURCE_REBIND", "local campaign identity binding kind mismatch");
  requireString(binding.project_id, "local identity project ID");
  requireIdentifier(binding.campaign_id, "local identity campaign ID");
  requireString(binding.campaign_version, "local identity campaign version");
  requireString(binding.audit_campaign_version, "local identity audit campaign version");
  requireSha(binding.controller_candidate_sha256, "local identity Controller candidate");
  requireIdentifier(binding.audit_candidate_id, "local identity audit candidate ID");
  requireSha(binding.audit_candidate_sha256, "local identity audit candidate");
  requireGitObject(binding.audit_candidate_commit, "local identity audit commit");
  requireGitObject(binding.audit_candidate_tree, "local identity audit tree");
  requireGitObject(binding.current_source_commit, "local identity current commit");
  requireGitObject(binding.current_source_tree, "local identity current tree");
  for (const field of ["audit_plan_sha256", "audit_reconciliation_sha256", "parent_audit_packet_sha256", "parent_audit_addendum_sha256", "owner_intent_sha256", "decision_tree_requirement_sha256", "policy_state_sha256", "acceptance_contract_sha256", "binding_sha256"]) requireSha(binding[field], `local identity ${field}`);
  assert(binding.binding_sha256 === digestWithout(binding, "binding_sha256"), "local identity binding digest mismatch");
  return binding;
}

export function compileLocalCampaignIdentityBinding({authorization, candidate, auditCandidate, auditCampaignVersion = "v1", auditPlanSha256, auditReconciliationSha256, parentAuditPacketSha256, parentAuditAddendumSha256}) {
  validateLocalDevelopmentAuthorization(authorization);
  validateControllerCampaignCandidate(candidate);
  requireRecord(auditCandidate, "local identity audit candidate");
  for (const field of ["candidate_id", "candidate_sha256", "commit", "tree"]) requireString(auditCandidate[field], `local identity audit candidate ${field}`);
  requireSha(auditCandidate.candidate_sha256, "local identity audit candidate digest");
  requireGitObject(auditCandidate.commit, "local identity audit candidate commit");
  requireGitObject(auditCandidate.tree, "local identity audit candidate tree");
  requireSha(auditPlanSha256, "local identity audit plan");
  requireSha(auditReconciliationSha256, "local identity audit reconciliation");
  assert(candidate.source_commit !== "" && candidate.source_tree !== "", "local identity current source is missing");
  assert(candidate.campaign_id === authorization.campaign_id && candidate.campaign_version === authorization.campaign_version, "local identity campaign differs from authorization");
  assert(candidate.policy_epoch === authorization.policy_epoch && candidate.policy_state_sha256 === authorization.policy_state_sha256, "local identity policy differs from authorization");
  assert(candidate.owner_intent_sha256 === authorization.owner_intent_sha256, "local identity owner intent differs from authorization");
  assert(candidate.acceptance_contract_sha256 === authorization.acceptance_contract_sha256, "local identity acceptance differs from authorization");
  const binding = {
    schema: LOCAL_IDENTITY_BINDING_SCHEMA,
    version: 1,
    mapping_kind: "CURRENT_SOURCE_REBIND",
    project_id: candidate.project_id,
    campaign_id: candidate.campaign_id,
    campaign_version: candidate.campaign_version,
    audit_campaign_version: auditCampaignVersion,
    controller_candidate_sha256: candidate.candidate_sha256,
    audit_candidate_id: auditCandidate.candidate_id,
    audit_candidate_sha256: auditCandidate.candidate_sha256,
    audit_candidate_commit: auditCandidate.commit,
    audit_candidate_tree: auditCandidate.tree,
    current_source_commit: candidate.source_commit,
    current_source_tree: candidate.source_tree,
    audit_plan_sha256: auditPlanSha256,
    audit_reconciliation_sha256: auditReconciliationSha256,
    parent_audit_packet_sha256: parentAuditPacketSha256,
    parent_audit_addendum_sha256: parentAuditAddendumSha256,
    owner_intent_sha256: authorization.owner_intent_sha256,
    decision_tree_requirement_sha256: authorization.decision_tree_requirement_sha256,
    policy_epoch: authorization.policy_epoch,
    policy_state_sha256: authorization.policy_state_sha256,
    acceptance_contract_sha256: authorization.acceptance_contract_sha256,
    binding_sha256: null,
  };
  binding.binding_sha256 = digestWithout(binding, "binding_sha256");
  return validateLocalCampaignIdentityBinding(binding);
}

export function validateLocalCampaignAdmission(admission) {
  exactKeys(admission, [
    "schema", "version", "status", "controller_role", "campaign_id", "campaign_version", "source_commit", "source_tree",
    "controller_candidate_sha256", "authorization_sha256", "identity_binding_sha256", "parent_audit_packet_sha256", "parent_audit_addendum_sha256",
    "policy_epoch", "policy_state_sha256", "owner_intent_sha256", "decision_tree_requirement_sha256", "acceptance_contract_sha256",
    "permissions", "worker_roles", "active_campaign", "next_event", "admission_sha256",
  ], "local campaign admission");
  assert(admission.schema === LOCAL_ADMISSION_SCHEMA && admission.version === 1, "local campaign admission schema mismatch");
  assert(admission.status === "CAMPAIGN_ADMITTED", "local campaign admission status is invalid");
  assert(admission.controller_role === "AGENTOS_CONTROLLER", "local campaign admission role is invalid");
  requireIdentifier(admission.campaign_id, "local admission campaign ID");
  requireString(admission.campaign_version, "local admission campaign version");
  requireGitObject(admission.source_commit, "local admission source commit");
  requireGitObject(admission.source_tree, "local admission source tree");
  for (const field of ["controller_candidate_sha256", "authorization_sha256", "identity_binding_sha256", "parent_audit_packet_sha256", "parent_audit_addendum_sha256", "policy_state_sha256", "owner_intent_sha256", "decision_tree_requirement_sha256", "acceptance_contract_sha256", "admission_sha256"]) requireSha(admission[field], `local admission ${field}`);
  assert(Number.isSafeInteger(admission.policy_epoch) && admission.policy_epoch >= 1, "local admission policy epoch is invalid");
  validatePermissions(admission.permissions);
  validateWorkerRoles(admission.worker_roles);
  assert(admission.active_campaign === false, "local campaign admission must not claim active before the spawn transition");
  assert(admission.next_event === "LOCAL_SELF_DEVELOPMENT_AUTHORIZED", "local admission next event is invalid");
  assert(admission.admission_sha256 === digestWithout(admission, "admission_sha256"), "local admission digest mismatch");
  return admission;
}

export function compileLocalCampaignAdmission({authorization, candidate, identityBinding, nowUtc}) {
  validateLocalDevelopmentAuthorization(authorization);
  validateControllerCampaignCandidate(candidate);
  validateLocalCampaignIdentityBinding(identityBinding);
  requireUtc(nowUtc, "local admission time");
  assert(identityBinding.controller_candidate_sha256 === candidate.candidate_sha256, "local admission identity candidate differs");
  const admission = {
    schema: LOCAL_ADMISSION_SCHEMA,
    version: 1,
    status: "CAMPAIGN_ADMITTED",
    controller_role: "AGENTOS_CONTROLLER",
    campaign_id: candidate.campaign_id,
    campaign_version: candidate.campaign_version,
    source_commit: candidate.source_commit,
    source_tree: candidate.source_tree,
    controller_candidate_sha256: candidate.candidate_sha256,
    authorization_sha256: authorization.authorization_sha256,
    identity_binding_sha256: identityBinding.binding_sha256,
    parent_audit_packet_sha256: authorization.parent_audit_packet_sha256,
    parent_audit_addendum_sha256: authorization.parent_audit_addendum_sha256,
    policy_epoch: authorization.policy_epoch,
    policy_state_sha256: authorization.policy_state_sha256,
    owner_intent_sha256: authorization.owner_intent_sha256,
    decision_tree_requirement_sha256: authorization.decision_tree_requirement_sha256,
    acceptance_contract_sha256: authorization.acceptance_contract_sha256,
    permissions: structuredClone(authorization.permissions),
    worker_roles: [...authorization.worker_roles],
    active_campaign: false,
    next_event: "LOCAL_SELF_DEVELOPMENT_AUTHORIZED",
    admission_sha256: null,
  };
  admission.admission_sha256 = digestWithout(admission, "admission_sha256");
  return validateLocalCampaignAdmission(admission);
}

export function validateLocalCampaignExecutionBoundary(boundary) {
  exactKeys(boundary, [
    "schema", "version", "status", "controller_role", "campaign_id", "campaign_version", "source_commit", "source_tree",
    "candidate_sha256", "authorization_sha256", "admission_sha256", "owner_authorized", "active_campaign", "campaign_start_allowed",
    "required_worker_roles", "local_development_writes_allowed", "local_worker_agent_spawns_allowed", "product_writes_allowed", "product_agent_spawns_allowed",
    "external_deployment_allowed", "external_release_allowed", "external_publication_allowed", "external_push_allowed", "external_merge_allowed", "secrets_allowed", "destructive_work_allowed", "next_event", "boundary_sha256",
  ], "local campaign execution boundary");
  assert(boundary.schema === "agentos.local_campaign_execution_boundary.v1" && boundary.version === 1, "local campaign execution boundary schema mismatch");
  assert(boundary.status === "PREPARED_OWNER_AUTHORIZED", "local campaign execution boundary status is invalid");
  assert(boundary.controller_role === "AGENTOS_CONTROLLER", "local campaign execution boundary role is invalid");
  requireIdentifier(boundary.campaign_id, "local execution boundary campaign ID");
  requireString(boundary.campaign_version, "local execution boundary campaign version");
  requireGitObject(boundary.source_commit, "local execution boundary source commit");
  requireGitObject(boundary.source_tree, "local execution boundary source tree");
  for (const field of ["candidate_sha256", "authorization_sha256", "admission_sha256", "boundary_sha256"]) requireSha(boundary[field], `local execution boundary ${field}`);
  assert(boundary.owner_authorized === true && boundary.active_campaign === false && boundary.campaign_start_allowed === true, "local execution boundary is not an owner-authorized inactive start");
  validateWorkerRoles(boundary.required_worker_roles);
  assert(boundary.local_development_writes_allowed === true && boundary.local_worker_agent_spawns_allowed === true, "local execution boundary lacks local worker permissions");
  for (const key of ["product_writes_allowed", "product_agent_spawns_allowed", "external_deployment_allowed", "external_release_allowed", "external_publication_allowed", "external_push_allowed", "external_merge_allowed", "secrets_allowed", "destructive_work_allowed"]) assert(boundary[key] === false, `local execution boundary ${key} must remain closed`);
  assert(boundary.next_event === "LOCAL_SELF_DEVELOPMENT_AUTHORIZED", "local execution boundary next event is invalid");
  assert(boundary.boundary_sha256 === digestWithout(boundary, "boundary_sha256"), "local execution boundary digest mismatch");
  return boundary;
}

export function compileLocalCampaignExecutionBoundary({authorization, admission}) {
  validateLocalDevelopmentAuthorization(authorization);
  validateLocalCampaignAdmission(admission);
  assert(authorization.campaign_id === admission.campaign_id && authorization.campaign_version === admission.campaign_version, "local execution boundary campaign differs");
  assert(authorization.source_commit === admission.source_commit && authorization.source_tree === admission.source_tree, "local execution boundary source differs");
  assert(authorization.authorization_sha256 && admission.admission_sha256, "local execution boundary authority digests are missing");
  const boundary = {
    schema: "agentos.local_campaign_execution_boundary.v1",
    version: 1,
    status: "PREPARED_OWNER_AUTHORIZED",
    controller_role: "AGENTOS_CONTROLLER",
    campaign_id: admission.campaign_id,
    campaign_version: admission.campaign_version,
    source_commit: admission.source_commit,
    source_tree: admission.source_tree,
    candidate_sha256: admission.controller_candidate_sha256,
    authorization_sha256: authorization.authorization_sha256,
    admission_sha256: admission.admission_sha256,
    owner_authorized: authorization.status === "AUTHORIZED" && authorization.owner_decision.decision === "START_LOCAL_AGENTOS_SELF_DEVELOPMENT",
    active_campaign: admission.active_campaign,
    campaign_start_allowed: authorization.status === "AUTHORIZED" && admission.active_campaign === false,
    required_worker_roles: [...authorization.worker_roles].sort(),
    local_development_writes_allowed: authorization.permissions.local_development_writes_allowed,
    local_worker_agent_spawns_allowed: authorization.permissions.local_worker_agent_spawns_allowed,
    product_writes_allowed: authorization.permissions.product_writes_allowed,
    product_agent_spawns_allowed: authorization.permissions.product_agent_spawns_allowed,
    external_deployment_allowed: authorization.permissions.external_deployment_allowed,
    external_release_allowed: authorization.permissions.external_release_allowed,
    external_publication_allowed: authorization.permissions.external_publication_allowed,
    external_push_allowed: authorization.permissions.external_push_allowed,
    external_merge_allowed: authorization.permissions.external_merge_allowed,
    secrets_allowed: authorization.permissions.secrets_allowed,
    destructive_work_allowed: authorization.permissions.destructive_work_allowed,
    next_event: admission.next_event,
    boundary_sha256: null,
  };
  boundary.boundary_sha256 = digestWithout(boundary, "boundary_sha256");
  return validateLocalCampaignExecutionBoundary(boundary);
}
export function validateLocalStartTransition({authorization, admission}) {
  validateLocalDevelopmentAuthorization(authorization);
  validateLocalCampaignAdmission(admission);
  assert(admission.active_campaign === false, "local start transition cannot begin from an active campaign");
  assert(admission.next_event === "LOCAL_SELF_DEVELOPMENT_AUTHORIZED", "valid local authorization cannot remain on a queued-only path");
  const executionBoundary = compileLocalCampaignExecutionBoundary({authorization, admission});
  assert(executionBoundary.campaign_start_allowed === true && executionBoundary.active_campaign === false, "local start transition crossed its execution boundary");
  return {event_type: admission.next_event, campaign_id: admission.campaign_id, campaign_version: admission.campaign_version};
}

export function validateLocalCampaignActivation(activation) {
  exactKeys(activation, [
    "schema", "version", "status", "controller_role", "campaign_id", "campaign_version", "source_commit", "source_tree",
    "controller_candidate_sha256", "authorization_sha256", "admission_sha256", "identity_binding_sha256", "permissions", "worker_roles",
    "spawn_readbacks", "controller_state_sha256", "started_at_utc", "active_campaign", "activation_sha256",
  ], "local campaign activation");
  assert(activation.schema === LOCAL_ACTIVATION_SCHEMA && activation.version === 1, "local campaign activation schema mismatch");
  assert(activation.status === "CAMPAIGN_ACTIVE", "local campaign activation status is invalid");
  assert(activation.controller_role === "AGENTOS_CONTROLLER", "local campaign activation role is invalid");
  requireIdentifier(activation.campaign_id, "local activation campaign ID");
  requireString(activation.campaign_version, "local activation campaign version");
  requireGitObject(activation.source_commit, "local activation source commit");
  requireGitObject(activation.source_tree, "local activation source tree");
  for (const field of ["controller_candidate_sha256", "authorization_sha256", "admission_sha256", "identity_binding_sha256", "controller_state_sha256", "activation_sha256"]) requireSha(activation[field], `local activation ${field}`);
  validatePermissions(activation.permissions);
  validateWorkerRoles(activation.worker_roles);
  assert(Array.isArray(activation.spawn_readbacks) && activation.spawn_readbacks.length === 3, "local activation requires three spawn readbacks");
  const roles = activation.spawn_readbacks.map((readback) => readback.role).sort();
  assert(JSON.stringify(roles) === JSON.stringify([...LOCAL_WORKER_ROLES].sort()), "local activation spawn roles are incomplete");
  const sessionIds = activation.spawn_readbacks.map((readback) => readback.session_id);
  assert(new Set(sessionIds).size === sessionIds.length, "local activation spawn session identities must be unique");
  for (const readback of activation.spawn_readbacks) {
    requireRecord(readback, "local activation spawn readback");
    for (const field of ["role", "session_id", "campaign_id", "campaign_version", "candidate_sha256", "pid", "worktree_path", "source_commit", "source_tree", "status", "build_status", "artifact_path", "observed_at_utc", "readback_sha256"]) requireString(String(readback[field]), `local activation spawn readback ${field}`);
    assert(readback.campaign_id === activation.campaign_id && readback.campaign_version === activation.campaign_version, "local activation spawn readback campaign identity differs");
    assert(readback.candidate_sha256 === activation.controller_candidate_sha256, "local activation spawn readback candidate differs");
    assert(readback.source_commit === activation.source_commit && readback.source_tree === activation.source_tree, "local activation spawn readback source differs");
    assert(readback.status === "READY" || readback.status === "COMPLETED", "local activation spawn readback status is invalid");
    assert(["COMPLETED", "AUDIT_VERIFIED", "NOT_FEATURE_AGENT_BUILD"].includes(readback.build_status), "local activation spawn readback build status is invalid");
    if (readback.role === "FEATURE_AGENT") {
      assert(readback.build_status === "COMPLETED", "metadata-only Feature Agent marker is not a completed build");
      requireGitObject(readback.build_commit, "Feature Agent build commit");
      requireGitObject(readback.build_tree, "Feature Agent build tree");
      assert(readback.build_commit !== activation.source_commit && readback.build_tree !== activation.source_tree, "Feature Agent build did not change the source checkpoint");
      assert(Array.isArray(readback.changed_paths) && readback.changed_paths.includes("control/governance-decision-tree.mjs"), "Feature Agent build lacks the governance code change");
      assert(Array.isArray(readback.focused_checks) && readback.focused_checks.length > 0 && typeof readback.build_checkpoint_sha256 === "string", "Feature Agent build evidence is incomplete");
    }
    if (readback.role === "INDEPENDENT_AUDITOR") assert(readback.build_status === "AUDIT_VERIFIED", "Independent Auditor has not verified the changed Feature-Agent tree");
    requireSha(readback.readback_sha256, "local activation spawn readback digest");
  }
  requireSha(activation.controller_state_sha256, "local activation Controller state");
  requireUtc(activation.started_at_utc, "local activation start time");
  assert(activation.active_campaign === true, "local activation must be active");
  assert(activation.activation_sha256 === digestWithout(activation, "activation_sha256"), "local activation digest mismatch");
  return activation;
}

export function compileLocalCampaignActivation({admission, authorization, identityBinding, candidate, spawnReadbacks, controllerStateSha256, startedAtUtc}) {
  validateLocalCampaignAdmission(admission);
  validateLocalDevelopmentAuthorization(authorization);
  validateLocalCampaignIdentityBinding(identityBinding);
  validateControllerCampaignCandidate(candidate);
  requireSha(controllerStateSha256, "local activation Controller state");
  requireUtc(startedAtUtc, "local activation start time");
  assert(admission.controller_candidate_sha256 === candidate.candidate_sha256, "local activation candidate differs from admission");
  const activation = {
    schema: LOCAL_ACTIVATION_SCHEMA,
    version: 1,
    status: "CAMPAIGN_ACTIVE",
    controller_role: "AGENTOS_CONTROLLER",
    campaign_id: candidate.campaign_id,
    campaign_version: candidate.campaign_version,
    source_commit: candidate.source_commit,
    source_tree: candidate.source_tree,
    controller_candidate_sha256: candidate.candidate_sha256,
    authorization_sha256: authorization.authorization_sha256,
    admission_sha256: admission.admission_sha256,
    identity_binding_sha256: identityBinding.binding_sha256,
    permissions: structuredClone(authorization.permissions),
    worker_roles: [...authorization.worker_roles],
    spawn_readbacks: structuredClone(spawnReadbacks).sort((left, right) => String(left.role).localeCompare(String(right.role))),
    controller_state_sha256: controllerStateSha256,
    started_at_utc: startedAtUtc,
    active_campaign: true,
    activation_sha256: null,
  };
  activation.activation_sha256 = digestWithout(activation, "activation_sha256");
  return validateLocalCampaignActivation(activation);
}

function safeRecordPath(root, fileName) {
  const resolvedRoot = fs.realpathSync.native(path.resolve(root));
  const target = path.resolve(resolvedRoot, fileName);
  assert(target === resolvedRoot || target.startsWith(`${resolvedRoot}${path.sep}`), "local campaign record escapes its root");
  return target;
}

export function writeLocalCampaignRecord({root, fileName, record, validate = (value) => value}) {
  const target = safeRecordPath(root, fileName);
  validate(record);
  fs.mkdirSync(path.dirname(target), {recursive: true});
  assert(!fs.existsSync(target) || !fs.lstatSync(target).isSymbolicLink(), "local campaign record may not be a symlink");
  const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.stage`;
  fs.writeFileSync(temporary, `${JSON.stringify(record)}\n`, {flag: "wx", mode: 0o600});
  fs.renameSync(temporary, target);
  let readback;
  try {
    readback = JSON.parse(fs.readFileSync(target, "utf8"));
  } catch (error) {
    throw new Error(`local campaign record JSON is invalid: ${error.message}`);
  }
  validate(readback);
  return {path: fileName, record: readback};
}

export function readLocalCampaignRecord({root, fileName, validate = (value) => value}) {
  const target = safeRecordPath(root, fileName);
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  assert(stat.isFile() && !stat.isSymbolicLink(), "local campaign record must be a regular file");
  let record;
  try {
    record = JSON.parse(fs.readFileSync(target, "utf8"));
  } catch (error) {
    throw new Error(`local campaign record JSON is invalid: ${error.message}`);
  }
  return validate(record);
}
