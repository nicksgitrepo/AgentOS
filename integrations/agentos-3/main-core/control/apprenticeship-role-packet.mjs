#!/usr/bin/env node

import {
  APPRENTICESHIP_MODE,
  APPRENTICESHIP_VERSION,
  REQUIRED_WORKER_PROHIBITIONS,
  assert,
  assertNonActivating,
  assertPortableRecord,
  exactKeys,
  nonEmptyArray,
  protectedActions,
  requireIdentifier,
  requireSafeReference,
  requireString,
  uniqueStrings,
  validateConsentDecision,
  validateDigest,
  validateProvenance,
  validateProtectedActions,
  validateRevocationState,
  validateTimestamp,
  withDigest,
} from "./apprenticeship-common.mjs";
import {NATIVE_SESSION_TOOLS} from "./native-host-contract.mjs";
import {UNIVERSAL_TASK_CLOSEOUT_RECEIPT_SCHEMA, UNIVERSAL_TASK_CLOSEOUT_SEQUENCE} from "./governance-library.mjs";

export const APPRENTICESHIP_ROLE_PACKET_SCHEMA = "agentos.apprenticeship_role_packet.v1";
export const APPRENTICESHIP_ROLE_PACKET_STATUS = "READY_FOR_NATIVE_OBSERVATION";
export const APPRENTICESHIP_WORKER_ROLE = "APPRENTICESHIP_WORKER";
export const APPRENTICESHIP_NATIVE_HOST_TOOLS = Object.freeze([...NATIVE_SESSION_TOOLS].sort());
export const APPRENTICESHIP_LIFECYCLE_OPERATIONS = Object.freeze([
  "create_thread",
  "pin",
  "send",
  "wait",
  "read",
  "unpin",
  "archive",
  "post_close_read",
  "active_list_absent",
]);

const REQUIRED_PROHIBITIONS = REQUIRED_WORKER_PROHIBITIONS;

function validatePacketRoleBehavior(value) {
  exactKeys(value, [
    "role_id",
    "scope",
    "authority",
    "prohibited_actions",
    "admitted_tools",
    "evidence_requirements",
    "failure_paths",
    "done_when",
  ], "apprenticeship role packet behavior");
  requireIdentifier(value.role_id, "apprenticeship role packet role ID");
  assert(value.role_id === APPRENTICESHIP_WORKER_ROLE, "apprenticeship role packet role must be the worker");
  nonEmptyArray(value.scope, "apprenticeship role packet behavior scope");
  uniqueStrings(value.scope, "apprenticeship role packet behavior scope");
  value.scope.forEach((scope) => requireIdentifier(scope, "apprenticeship role packet behavior scope item"));
  uniqueStrings(value.authority, "apprenticeship role packet authority", {allowEmpty: true});
  uniqueStrings(value.prohibited_actions, "apprenticeship role packet prohibited actions");
  REQUIRED_PROHIBITIONS.forEach((action) => assert(value.prohibited_actions.includes(action), `apprenticeship role packet is missing prohibition ${action}`));
  uniqueStrings(value.admitted_tools, "apprenticeship role packet admitted tools");
  uniqueStrings(value.evidence_requirements, "apprenticeship role packet evidence requirements");
  uniqueStrings(value.failure_paths, "apprenticeship role packet failure paths", {allowEmpty: true});
  requireString(value.done_when, "apprenticeship role packet DONE WHEN");
  assertPortableRecord(value, "apprenticeship role packet behavior");
  return value;
}

export function compileApprenticeshipRolePacket({
  packetId,
  provenance,
  ownerIntentRef,
  taskRequestRef,
  taskPattern,
  boundedScope,
  doneWhen,
  failurePaths = ["ROUTE_TRUE_BLOCKER", "ROUTE_SOFT_BOUNDARY_REVIEW", "ROUTE_EVIDENCE_REPAIR"],
  authority = ["OBSERVE_BOUNDED_TASK", "REPORT_REAL_RESULT", "PROPOSE_TYPED_HANDOFF"],
  prohibitedActions = [...REQUIRED_PROHIBITIONS],
  evidenceRequirements = ["SOURCE_BINDING", "SCOPE_BINDING", "RESULT_EVIDENCE", "TYPED_HANDOFF", "HOST_READBACK"],
  predecessorHandoffRef = null,
  consentRequired = false,
  consentRef = null,
  revocable = true,
  revocationStatus = "NOT_REVOKED",
  revocationRef = null,
  createdAt,
} = {}) {
  requireIdentifier(packetId, "apprenticeship role packet ID");
  validateProvenance(provenance, {requiredRefs: ["worker_ref", "orchestrator_ref", "orchestrator_session_ref", "model_ref"]});
  requireSafeReference(ownerIntentRef, "apprenticeship role packet owner intent reference");
  requireSafeReference(taskRequestRef, "apprenticeship role packet task request reference");
  requireString(taskPattern, "apprenticeship role packet task pattern");
  nonEmptyArray(boundedScope, "apprenticeship role packet bounded scope");
  uniqueStrings(boundedScope, "apprenticeship role packet bounded scope");
  boundedScope.forEach((scope) => requireIdentifier(scope, "apprenticeship role packet bounded scope item"));
  requireString(doneWhen, "apprenticeship role packet DONE WHEN");
  uniqueStrings(failurePaths, "apprenticeship role packet failure paths", {allowEmpty: true});
  failurePaths.forEach((route) => requireIdentifier(route, "apprenticeship role packet failure path"));
  uniqueStrings(authority, "apprenticeship role packet authority", {allowEmpty: true});
  uniqueStrings(prohibitedActions, "apprenticeship role packet prohibited actions");
  uniqueStrings(evidenceRequirements, "apprenticeship role packet evidence requirements");
  if (predecessorHandoffRef !== null) requireSafeReference(predecessorHandoffRef, "apprenticeship role packet predecessor handoff reference");
  const consent = {
    required: consentRequired,
    recorded: consentRequired,
    reference: consentRef,
  };
  validateConsentDecision(consent, "apprenticeship role packet consent decision");
  const revocation = {
    revocable,
    status: revocationStatus,
    reference: revocationRef,
  };
  validateRevocationState(revocation, "apprenticeship role packet revocation state");
  validateTimestamp(createdAt, "apprenticeship role packet creation timestamp");

  const packet = withDigest({
    schema: APPRENTICESHIP_ROLE_PACKET_SCHEMA,
    version: APPRENTICESHIP_VERSION,
    mode: APPRENTICESHIP_MODE,
    packet_id: packetId,
    status: revocation.status === "REVOKED" ? "REVOKED" : APPRENTICESHIP_ROLE_PACKET_STATUS,
    role_id: APPRENTICESHIP_WORKER_ROLE,
    owner_intent_ref: ownerIntentRef,
    task_request_ref: taskRequestRef,
    provenance: structuredClone(provenance),
    task_pattern: taskPattern,
    bounded_scope: [...boundedScope],
    consent,
    revocation,
    role_behavior: {
      role_id: APPRENTICESHIP_WORKER_ROLE,
      scope: [...boundedScope],
      authority: [...authority],
      prohibited_actions: [...prohibitedActions],
      admitted_tools: [...APPRENTICESHIP_NATIVE_HOST_TOOLS],
      evidence_requirements: [...evidenceRequirements],
      failure_paths: [...failurePaths],
      done_when: doneWhen,
    },
    host_contract: {
      required_tools: [...APPRENTICESHIP_NATIVE_HOST_TOOLS],
      lifecycle_operations: [...APPRENTICESHIP_LIFECYCLE_OPERATIONS],
      universal_closeout_receipt_schema: UNIVERSAL_TASK_CLOSEOUT_RECEIPT_SCHEMA,
      universal_closeout_sequence: [...UNIVERSAL_TASK_CLOSEOUT_SEQUENCE],
      external_attachment_required: true,
      local_process_fallback_allowed: false,
      synthetic_receipts_allowed: false,
      real_bounded_work_required: true,
      meaningful_result_required: true,
    },
    predecessor_handoff_ref: predecessorHandoffRef,
    runtime_only_inputs: ["task_instruction", "source_binding", "host_attachment"],
    activation_allowed: false,
    protected_actions: protectedActions(),
    created_at: createdAt,
    digest: null,
  });
  validateApprenticeshipRolePacket(packet);
  return packet;
}

export function validateApprenticeshipRolePacket(packet) {
  exactKeys(packet, [
    "schema",
    "version",
    "mode",
    "packet_id",
    "status",
    "role_id",
    "owner_intent_ref",
    "task_request_ref",
    "provenance",
    "task_pattern",
    "bounded_scope",
    "consent",
    "revocation",
    "role_behavior",
    "host_contract",
    "predecessor_handoff_ref",
    "runtime_only_inputs",
    "activation_allowed",
    "protected_actions",
    "created_at",
    "digest",
  ], "apprenticeship role packet");
  assert(packet.schema === APPRENTICESHIP_ROLE_PACKET_SCHEMA && packet.version === APPRENTICESHIP_VERSION, "apprenticeship role packet identity is invalid");
  assert(packet.mode === APPRENTICESHIP_MODE, "apprenticeship role packet mode is invalid");
  requireIdentifier(packet.packet_id, "apprenticeship role packet ID");
  assert([APPRENTICESHIP_ROLE_PACKET_STATUS, "REVOKED"].includes(packet.status), "apprenticeship role packet status is invalid");
  assert(packet.role_id === APPRENTICESHIP_WORKER_ROLE, "apprenticeship role packet role is invalid");
  requireSafeReference(packet.owner_intent_ref, "apprenticeship role packet owner intent reference");
  requireSafeReference(packet.task_request_ref, "apprenticeship role packet task request reference");
  validateProvenance(packet.provenance, {requiredRefs: ["worker_ref", "orchestrator_ref", "orchestrator_session_ref", "model_ref"]});
  requireString(packet.task_pattern, "apprenticeship role packet task pattern");
  nonEmptyArray(packet.bounded_scope, "apprenticeship role packet bounded scope");
  uniqueStrings(packet.bounded_scope, "apprenticeship role packet bounded scope");
  packet.bounded_scope.forEach((scope) => requireIdentifier(scope, "apprenticeship role packet bounded scope item"));
  validateConsentDecision(packet.consent, "apprenticeship role packet consent decision");
  validateRevocationState(packet.revocation, "apprenticeship role packet revocation state");
  assert(packet.status === (packet.revocation.status === "REVOKED" ? "REVOKED" : APPRENTICESHIP_ROLE_PACKET_STATUS), "apprenticeship role packet revocation/status binding is invalid");
  validatePacketRoleBehavior(packet.role_behavior);
  exactKeys(packet.host_contract, [
    "required_tools",
    "lifecycle_operations",
    "universal_closeout_receipt_schema",
    "universal_closeout_sequence",
    "external_attachment_required",
    "local_process_fallback_allowed",
    "synthetic_receipts_allowed",
    "real_bounded_work_required",
    "meaningful_result_required",
  ], "apprenticeship role packet host contract");
  assert(JSON.stringify(packet.host_contract.required_tools) === JSON.stringify([...APPRENTICESHIP_NATIVE_HOST_TOOLS]), "apprenticeship role packet host tools are not canonical");
  assert(JSON.stringify(packet.host_contract.lifecycle_operations) === JSON.stringify([...APPRENTICESHIP_LIFECYCLE_OPERATIONS]), "apprenticeship role packet lifecycle is incomplete");
  assert(packet.host_contract.universal_closeout_receipt_schema === UNIVERSAL_TASK_CLOSEOUT_RECEIPT_SCHEMA, "apprenticeship role packet universal closeout receipt schema is not bound");
  assert(JSON.stringify(packet.host_contract.universal_closeout_sequence) === JSON.stringify([...UNIVERSAL_TASK_CLOSEOUT_SEQUENCE]), "apprenticeship role packet universal closeout sequence is incomplete");
  assert(packet.host_contract.external_attachment_required === true, "apprenticeship role packet must require an external attachment");
  assert(packet.host_contract.local_process_fallback_allowed === false, "apprenticeship role packet cannot use a local process fallback");
  assert(packet.host_contract.synthetic_receipts_allowed === false, "apprenticeship role packet cannot accept synthetic receipts");
  assert(packet.host_contract.real_bounded_work_required === true, "apprenticeship role packet must require real bounded work");
  assert(packet.host_contract.meaningful_result_required === true, "apprenticeship role packet must require meaningful progress");
  if (packet.predecessor_handoff_ref !== null) requireSafeReference(packet.predecessor_handoff_ref, "apprenticeship role packet predecessor handoff reference");
  assert(JSON.stringify(packet.runtime_only_inputs) === JSON.stringify(["task_instruction", "source_binding", "host_attachment"]), "apprenticeship role packet runtime-only boundary is invalid");
  assert(packet.activation_allowed === false, "apprenticeship role packet cannot allow activation");
  validateProtectedActions(packet.protected_actions, "apprenticeship role packet protected actions");
  validateTimestamp(packet.created_at, "apprenticeship role packet creation timestamp");
  assertNonActivating(packet, "apprenticeship role packet");
  assertPortableRecord(packet, "apprenticeship role packet");
  validateDigest(packet, "apprenticeship role packet");
  return packet;
}
