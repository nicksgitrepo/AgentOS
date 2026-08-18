#!/usr/bin/env node

import {
  APPRENTICESHIP_MODE,
  APPRENTICESHIP_ROLES,
  APPRENTICESHIP_STATES,
  APPRENTICESHIP_VERSION,
  assert,
  assertDistinctReferences,
  assertNonActivating,
  assertPortableRecord,
  exactKeys,
  isRecord,
  nonEmptyArray,
  protectedActions,
  requireIdentifier,
  requireRecord,
  requireSafeReference,
  requireSha256,
  requireString,
  uniqueStrings,
  validateDigest,
  validateEvidenceRefs,
  validateProvenance,
  validateProtectedActions,
  validateTimestamp,
  withDigest,
  transitionApprenticeshipState,
} from "./apprenticeship-common.mjs";

export const APPRENTICESHIP_ADMISSION_SCHEMA = "agentos.apprenticeship_admission.v1";
export const EVIDENCE_ATTESTATION_SCHEMA = "agentos.apprenticeship_evidence_attestation.v1";
export const RECORD_ENVELOPE_SCHEMA = "agentos.apprenticeship_record_envelope.v1";
export const STATE_TRANSITION_SCHEMA = "agentos.apprenticeship_state_transition.v1";
export const STRICT_SCHEMA_DOCUMENT_VERSION = "https://json-schema.org/draft/2020-12/schema";

export const ADMISSION_STATUSES = Object.freeze([
  "PREPARED",
  "ADMITTED",
  "BLOCKED",
  "REASSESS_REQUIRED",
]);

export const ATTESTATION_TYPES = Object.freeze([
  "HOST_READBACK",
  "AUDITOR_ASSERTION",
]);

export const ATTESTATION_AUTHORITIES = Object.freeze([
  "EXTERNAL_HOST",
  "WORKFLOW_AUDITOR",
  "INDEPENDENT_AUDITOR",
]);

export const ATTESTATION_RESULT_STATUSES = Object.freeze([
  "SUCCEEDED",
  "FAILED",
  "BLOCKED",
]);

export const BOUNDARY_DECISIONS = Object.freeze([
  "IN_SCOPE",
  "SOFT_REVIEW",
  "HARD_STOP",
]);

export const RECORD_LIFECYCLE_STATUSES = Object.freeze([
  "PREPARED_NOT_ACTIVATED",
  "REVIEW_REQUIRED",
  "REPAIR_REQUIRED",
  "BLOCKED",
  "ARCHIVED",
]);

export const STATE_TRANSITION_AUTHORITIES = Object.freeze([
  "AGENTOS_CONTROLLER",
  "RUNTIME",
  "APPRENTICESHIP_WORKER",
  "WALKTHROUGH_ORCHESTRATOR",
  "WORKFLOW_AUDITOR",
  "INDEPENDENT_AUDITOR",
]);

export const HARDENED_SCHEMA_FILES = Object.freeze([
  "schemas/apprenticeship-common.v1.json",
  "schemas/apprenticeship-admission.v1.json",
  "schemas/apprenticeship-evidence-attestation.v1.json",
  "schemas/apprenticeship-record-envelope.v1.json",
  "schemas/apprenticeship-state.v1.json",
  "schemas/apprenticeship-role-packet.v1.json",
  "schemas/apprenticeship-native-run.v1.json",
  "schemas/apprenticeship-reconstruction.v1.json",
  "schemas/apprenticeship-gate-source.v1.json",
  "schemas/apprenticeship-independent-review.v1.json",
]);

const PROVENANCE_IDENTITY_FIELDS = Object.freeze([
  "worker_ref",
  "orchestrator_ref",
  "learner_ref",
  "auditor_ref",
  "reproduction_ref",
  "reviewer_ref",
]);

const PROVENANCE_SESSION_FIELDS = Object.freeze([
  "worker_session_ref",
  "orchestrator_session_ref",
  "learner_session_ref",
  "auditor_session_ref",
  "reproduction_session_ref",
  "reviewer_session_ref",
]);

const ACTOR_ROLES = Object.freeze([
  ...APPRENTICESHIP_ROLES,
  "AGENTOS_CONTROLLER",
  "RUNTIME",
]);

const SCHEMA_ID = /^[a-z][a-z0-9._:-]+$/u;

function requireSchemaId(value, label) {
  requireString(value, label);
  assert(SCHEMA_ID.test(value), `${label} is not a stable schema identifier`);
  return value;
}

function requireEnum(value, values, label) {
  assert(values.includes(value), `${label} is invalid`);
  return value;
}

function requireNullableReference(value, label) {
  if (value !== null) requireSafeReference(value, label);
  return value;
}

function requireNullableSha256(value, label) {
  if (value !== null) requireSha256(value, label);
  return value;
}

function validateActorBinding(provenance, actorRef, actorSessionRef, label) {
  const identityRefs = PROVENANCE_IDENTITY_FIELDS.map((field) => provenance[field]).filter((value) => value !== null);
  const sessionRefs = PROVENANCE_SESSION_FIELDS.map((field) => provenance[field]).filter((value) => value !== null);
  assert(identityRefs.includes(actorRef), `${label} actor is not provenance-bound`);
  assert(sessionRefs.includes(actorSessionRef), `${label} actor session is not provenance-bound`);
}

function validateAdmissionRoles(value) {
  uniqueStrings(value, "admission required roles");
  value.forEach((role) => requireIdentifier(role, "admission required role"));
  ["APPRENTICESHIP_WORKER", "WALKTHROUGH_ORCHESTRATOR", "WORKFLOW_AUDITOR", "INDEPENDENT_AUDITOR"].forEach((role) => {
    assert(value.includes(role), `admission is missing required role ${role}`);
  });
}

function validateSchemaDocumentRoot(document, label) {
  requireRecord(document, label);
  assert(document.$schema === STRICT_SCHEMA_DOCUMENT_VERSION, `${label} must use JSON Schema 2020-12`);
  requireString(document.$id, `${label} $id`);
  assert(document.type === "object", `${label} root type must be object`);
  assert(document.additionalProperties === false, `${label} must reject additional properties`);
  assert(Array.isArray(document.required) && document.required.length > 0, `${label} must declare required fields`);
  assert(isRecord(document.properties), `${label} must declare properties`);
  document.required.forEach((field) => assert(Object.hasOwn(document.properties, field), `${label} requires undeclared field ${field}`));
  assert(document["x-status"] === "PREPARED_NOT_ACTIVATED", `${label} must remain prepared and inactive`);
  assert(document["x-activation"]?.active === false, `${label} activation must be false`);
  assert(document["x-activation"]?.automatic === false, `${label} automatic activation must be false`);
  assertPortableRecord(document, label);
  return document;
}

export function validateStrictSchemaDocument(document, {label = "strict apprenticeship schema"} = {}) {
  requireRecord(document, label);
  if (document["x-schema-kind"] === "definitions") {
    assert(document.$schema === STRICT_SCHEMA_DOCUMENT_VERSION, `${label} must use JSON Schema 2020-12`);
    requireString(document.$id, `${label} $id`);
    assert(isRecord(document.$defs), `${label} definitions are missing`);
    assertPortableRecord(document, label);
    return document;
  }
  return validateSchemaDocumentRoot(document, label);
}

export function validateStrictSchemaBundle(documents) {
  nonEmptyArray(documents, "strict apprenticeship schema bundle");
  const ids = new Set();
  documents.forEach((document, index) => {
    validateStrictSchemaDocument(document, `strict apprenticeship schema ${index}`);
    assert(!ids.has(document.$id), `strict apprenticeship schema bundle duplicates ${document.$id}`);
    ids.add(document.$id);
  });
  return documents;
}

export function compileEvidenceAttestation({
  attestationId,
  attestationType,
  authority,
  subjectRef,
  subjectSessionRef = null,
  operation,
  resultStatus,
  evidenceRef,
  evidenceSha256,
  attestorRef,
  attestorSessionRef,
  provenance,
  sourceMatch,
  scopeMatch,
  identityMatch,
  boundaryDecision,
  observedAt,
} = {}) {
  requireIdentifier(attestationId, "evidence attestation ID");
  requireEnum(attestationType, ATTESTATION_TYPES, "evidence attestation type");
  requireEnum(authority, ATTESTATION_AUTHORITIES, "evidence attestation authority");
  requireSafeReference(subjectRef, "evidence attestation subject reference");
  requireNullableReference(subjectSessionRef, "evidence attestation subject session reference");
  requireIdentifier(operation, "evidence attestation operation");
  requireEnum(resultStatus, ATTESTATION_RESULT_STATUSES, "evidence attestation result status");
  requireSafeReference(evidenceRef, "evidence attestation evidence reference");
  requireSha256(evidenceSha256, "evidence attestation evidence digest");
  requireSafeReference(attestorRef, "evidence attestation attestor reference");
  requireSafeReference(attestorSessionRef, "evidence attestation attestor session reference");
  validateProvenance(provenance, {label: "evidence attestation provenance"});
  assert(typeof sourceMatch === "boolean", "evidence attestation source binding is invalid");
  assert(typeof scopeMatch === "boolean", "evidence attestation scope binding is invalid");
  assert(typeof identityMatch === "boolean", "evidence attestation identity binding is invalid");
  requireEnum(boundaryDecision, BOUNDARY_DECISIONS, "evidence attestation boundary decision");
  validateTimestamp(observedAt, "evidence attestation timestamp");

  const attestation = withDigest({
    schema: EVIDENCE_ATTESTATION_SCHEMA,
    version: APPRENTICESHIP_VERSION,
    mode: APPRENTICESHIP_MODE,
    attestation_id: attestationId,
    attestation_type: attestationType,
    authority,
    subject_ref: subjectRef,
    subject_session_ref: subjectSessionRef,
    operation,
    result_status: resultStatus,
    evidence_ref: evidenceRef,
    evidence_sha256: evidenceSha256,
    attestor_ref: attestorRef,
    attestor_session_ref: attestorSessionRef,
    provenance: structuredClone(provenance),
    source_match: sourceMatch,
    scope_match: scopeMatch,
    identity_match: identityMatch,
    boundary_decision: boundaryDecision,
    protected_actions: protectedActions(),
    observed_at: observedAt,
    digest: null,
  });
  validateEvidenceAttestation(attestation);
  return attestation;
}

export function validateEvidenceAttestation(attestation) {
  exactKeys(attestation, [
    "schema",
    "version",
    "mode",
    "attestation_id",
    "attestation_type",
    "authority",
    "subject_ref",
    "subject_session_ref",
    "operation",
    "result_status",
    "evidence_ref",
    "evidence_sha256",
    "attestor_ref",
    "attestor_session_ref",
    "provenance",
    "source_match",
    "scope_match",
    "identity_match",
    "boundary_decision",
    "protected_actions",
    "observed_at",
    "digest",
  ], "evidence attestation");
  assert(attestation.schema === EVIDENCE_ATTESTATION_SCHEMA && attestation.version === APPRENTICESHIP_VERSION, "evidence attestation identity is invalid");
  assert(attestation.mode === APPRENTICESHIP_MODE, "evidence attestation mode is invalid");
  requireIdentifier(attestation.attestation_id, "evidence attestation ID");
  requireEnum(attestation.attestation_type, ATTESTATION_TYPES, "evidence attestation type");
  requireEnum(attestation.authority, ATTESTATION_AUTHORITIES, "evidence attestation authority");
  if (attestation.attestation_type === "HOST_READBACK") assert(attestation.authority === "EXTERNAL_HOST", "host readback must be external-host authority");
  if (attestation.attestation_type === "AUDITOR_ASSERTION") assert(attestation.authority !== "EXTERNAL_HOST", "auditor assertion cannot use host authority");
  requireSafeReference(attestation.subject_ref, "evidence attestation subject reference");
  requireNullableReference(attestation.subject_session_ref, "evidence attestation subject session reference");
  requireIdentifier(attestation.operation, "evidence attestation operation");
  requireEnum(attestation.result_status, ATTESTATION_RESULT_STATUSES, "evidence attestation result status");
  requireSafeReference(attestation.evidence_ref, "evidence attestation evidence reference");
  requireSha256(attestation.evidence_sha256, "evidence attestation evidence digest");
  requireSafeReference(attestation.attestor_ref, "evidence attestation attestor reference");
  requireSafeReference(attestation.attestor_session_ref, "evidence attestation attestor session reference");
  validateProvenance(attestation.provenance, {label: "evidence attestation provenance"});
  assertDistinctReferences([attestation.attestor_ref, attestation.subject_ref], "evidence attestation identities");
  if (attestation.subject_session_ref !== null) assertDistinctReferences([attestation.attestor_session_ref, attestation.subject_session_ref], "evidence attestation sessions");
  if (attestation.authority === "WORKFLOW_AUDITOR") {
    assert(attestation.provenance.auditor_ref === attestation.attestor_ref, "Workflow Auditor attestation identity is not provenance-bound");
    assert(attestation.provenance.auditor_session_ref === attestation.attestor_session_ref, "Workflow Auditor attestation session is not provenance-bound");
  }
  if (attestation.authority === "INDEPENDENT_AUDITOR") {
    assert(attestation.provenance.reviewer_ref === attestation.attestor_ref, "Independent Auditor attestation identity is not provenance-bound");
    assert(attestation.provenance.reviewer_session_ref === attestation.attestor_session_ref, "Independent Auditor attestation session is not provenance-bound");
  }
  assert(typeof attestation.source_match === "boolean", "evidence attestation source binding is invalid");
  assert(typeof attestation.scope_match === "boolean", "evidence attestation scope binding is invalid");
  assert(typeof attestation.identity_match === "boolean", "evidence attestation identity binding is invalid");
  requireEnum(attestation.boundary_decision, BOUNDARY_DECISIONS, "evidence attestation boundary decision");
  if (attestation.result_status === "SUCCEEDED") {
    assert(attestation.source_match === true, "successful evidence attestation requires source binding");
    assert(attestation.scope_match === true, "successful evidence attestation requires scope binding");
    assert(attestation.identity_match === true, "successful evidence attestation requires identity binding");
    assert(attestation.boundary_decision === "IN_SCOPE", "successful evidence attestation cannot cross a boundary");
  }
  if (attestation.result_status === "BLOCKED") assert(attestation.boundary_decision !== "IN_SCOPE", "blocked evidence attestation must carry a review or stop boundary");
  validateProtectedActions(attestation.protected_actions, "evidence attestation protected actions");
  validateTimestamp(attestation.observed_at, "evidence attestation timestamp");
  assertNonActivating(attestation, "evidence attestation");
  assertPortableRecord(attestation, "evidence attestation");
  validateDigest(attestation, "evidence attestation");
  return attestation;
}

export function compileApprenticeshipAdmission({
  admissionId,
  status = "PREPARED",
  planRef,
  ownerIntentRef,
  provenance,
  allowedScope,
  progressWindowMinutes = 15,
  requiredRoles = ["APPRENTICESHIP_WORKER", "WALKTHROUGH_ORCHESTRATOR", "WORKFLOW_AUDITOR", "INDEPENDENT_AUDITOR"],
  hostCapabilityRef = null,
  hostAttestationRef = null,
  hostAttestation = null,
  createdAt,
} = {}) {
  requireIdentifier(admissionId, "apprenticeship admission ID");
  requireEnum(status, ADMISSION_STATUSES, "apprenticeship admission status");
  requireSafeReference(planRef, "apprenticeship admission plan reference");
  requireSafeReference(ownerIntentRef, "apprenticeship admission owner intent reference");
  validateProvenance(provenance, {label: "apprenticeship admission provenance"});
  nonEmptyArray(allowedScope, "apprenticeship admission allowed scope");
  uniqueStrings(allowedScope, "apprenticeship admission allowed scope");
  allowedScope.forEach((scope) => requireIdentifier(scope, "apprenticeship admission scope item"));
  assert(Number.isSafeInteger(progressWindowMinutes) && progressWindowMinutes >= 1 && progressWindowMinutes <= 240, "apprenticeship admission progress window is invalid");
  validateAdmissionRoles(requiredRoles);
  requireNullableReference(hostCapabilityRef, "apprenticeship admission host capability reference");
  requireNullableReference(hostAttestationRef, "apprenticeship admission host attestation reference");
  if (status === "ADMITTED") {
    assert(hostCapabilityRef !== null, "admitted apprenticeship requires a host capability reference");
    assert(hostAttestationRef !== null, "admitted apprenticeship requires a host attestation reference");
    requireRecord(hostAttestation, "apprenticeship admission host attestation");
    validateEvidenceAttestation(hostAttestation);
    assert(hostAttestation.attestation_type === "HOST_READBACK", "admission requires host readback attestation");
    assert(hostAttestation.result_status === "SUCCEEDED", "admission host readback must succeed");
    assert(`digest:${hostAttestation.digest}` === hostAttestationRef || `ref:${hostAttestation.digest}` === hostAttestationRef || hostAttestation.evidence_ref === hostAttestationRef, "admission host attestation reference does not bind");
    const bindingFields = ["project_ref", "campaign_ref", "goal_ref", "source_ref", "tree_ref", "workspace_ref", "environment_ref"];
    bindingFields.forEach((field) => assert(hostAttestation.provenance[field] === provenance[field], `admission host attestation ${field} binding differs`));
  }
  requireString(createdAt, "apprenticeship admission creation timestamp");
  validateTimestamp(createdAt, "apprenticeship admission creation timestamp");
  const admission = withDigest({
    schema: APPRENTICESHIP_ADMISSION_SCHEMA,
    version: APPRENTICESHIP_VERSION,
    mode: APPRENTICESHIP_MODE,
    admission_id: admissionId,
    status,
    plan_ref: planRef,
    owner_intent_ref: ownerIntentRef,
    provenance: structuredClone(provenance),
    allowed_scope: [...allowedScope],
    protected_actions: protectedActions(),
    progress_window_minutes: progressWindowMinutes,
    required_roles: [...requiredRoles],
    host_capability_ref: hostCapabilityRef,
    host_attestation_ref: hostAttestationRef,
    activation_allowed: false,
    created_at: createdAt,
    digest: null,
  });
  validateApprenticeshipAdmission(admission);
  return admission;
}

export function validateApprenticeshipAdmission(admission) {
  exactKeys(admission, [
    "schema",
    "version",
    "mode",
    "admission_id",
    "status",
    "plan_ref",
    "owner_intent_ref",
    "provenance",
    "allowed_scope",
    "protected_actions",
    "progress_window_minutes",
    "required_roles",
    "host_capability_ref",
    "host_attestation_ref",
    "activation_allowed",
    "created_at",
    "digest",
  ], "apprenticeship admission");
  assert(admission.schema === APPRENTICESHIP_ADMISSION_SCHEMA && admission.version === APPRENTICESHIP_VERSION, "apprenticeship admission identity is invalid");
  assert(admission.mode === APPRENTICESHIP_MODE, "apprenticeship admission mode is invalid");
  requireIdentifier(admission.admission_id, "apprenticeship admission ID");
  requireEnum(admission.status, ADMISSION_STATUSES, "apprenticeship admission status");
  requireSafeReference(admission.plan_ref, "apprenticeship admission plan reference");
  requireSafeReference(admission.owner_intent_ref, "apprenticeship admission owner intent reference");
  validateProvenance(admission.provenance, {label: "apprenticeship admission provenance"});
  nonEmptyArray(admission.allowed_scope, "apprenticeship admission allowed scope");
  uniqueStrings(admission.allowed_scope, "apprenticeship admission allowed scope");
  admission.allowed_scope.forEach((scope) => requireIdentifier(scope, "apprenticeship admission scope item"));
  assert(Number.isSafeInteger(admission.progress_window_minutes) && admission.progress_window_minutes >= 1 && admission.progress_window_minutes <= 240, "apprenticeship admission progress window is invalid");
  validateAdmissionRoles(admission.required_roles);
  requireNullableReference(admission.host_capability_ref, "apprenticeship admission host capability reference");
  requireNullableReference(admission.host_attestation_ref, "apprenticeship admission host attestation reference");
  if (admission.status === "ADMITTED") {
    assert(admission.host_capability_ref !== null, "admitted apprenticeship is missing host capability binding");
    assert(admission.host_attestation_ref !== null, "admitted apprenticeship is missing host attestation binding");
  }
  assert(admission.activation_allowed === false, "apprenticeship admission cannot allow activation");
  validateProtectedActions(admission.protected_actions, "apprenticeship admission protected actions");
  validateTimestamp(admission.created_at, "apprenticeship admission creation timestamp");
  assertNonActivating(admission, "apprenticeship admission");
  assertPortableRecord(admission, "apprenticeship admission");
  validateDigest(admission, "apprenticeship admission");
  return admission;
}

export function compileApprenticeshipRecordEnvelope({
  recordId,
  recordType,
  state = "DRAFT",
  lifecycleStatus = "PREPARED_NOT_ACTIVATED",
  payloadSchema,
  payloadDigest,
  provenance,
  predecessorRef = null,
  predecessorDigest = null,
  evidenceAttestationRefs = [],
  actorRef,
  actorSessionRef,
  actorRole,
  ownerDecisionRef = null,
  createdAt,
  updatedAt = createdAt,
} = {}) {
  requireIdentifier(recordId, "apprenticeship record ID");
  requireIdentifier(recordType, "apprenticeship record type");
  requireEnum(state, APPRENTICESHIP_STATES, "apprenticeship record state");
  requireEnum(lifecycleStatus, RECORD_LIFECYCLE_STATUSES, "apprenticeship record lifecycle status");
  requireSchemaId(payloadSchema, "apprenticeship record payload schema");
  requireSha256(payloadDigest, "apprenticeship record payload digest");
  validateProvenance(provenance, {label: "apprenticeship record provenance"});
  requireNullableReference(predecessorRef, "apprenticeship record predecessor reference");
  requireNullableSha256(predecessorDigest, "apprenticeship record predecessor digest");
  validateEvidenceRefs(evidenceAttestationRefs, "apprenticeship record attestation references", {allowEmpty: true});
  requireSafeReference(actorRef, "apprenticeship record actor reference");
  requireSafeReference(actorSessionRef, "apprenticeship record actor session reference");
  requireEnum(actorRole, ACTOR_ROLES, "apprenticeship record actor role");
  requireNullableReference(ownerDecisionRef, "apprenticeship record owner decision reference");
  requireString(createdAt, "apprenticeship record creation timestamp");
  validateTimestamp(createdAt, "apprenticeship record creation timestamp");
  validateTimestamp(updatedAt, "apprenticeship record update timestamp");
  assert((predecessorRef === null) === (predecessorDigest === null), "apprenticeship record predecessor reference and digest must be paired");
  const envelope = withDigest({
    schema: RECORD_ENVELOPE_SCHEMA,
    version: APPRENTICESHIP_VERSION,
    mode: APPRENTICESHIP_MODE,
    record_id: recordId,
    record_type: recordType,
    state,
    lifecycle_status: lifecycleStatus,
    payload_schema: payloadSchema,
    payload_digest: payloadDigest,
    provenance: structuredClone(provenance),
    predecessor_ref: predecessorRef,
    predecessor_digest: predecessorDigest,
    evidence_attestation_refs: [...evidenceAttestationRefs],
    actor_ref: actorRef,
    actor_session_ref: actorSessionRef,
    actor_role: actorRole,
    owner_decision_ref: ownerDecisionRef,
    activation_allowed: false,
    protected_actions: protectedActions(),
    created_at: createdAt,
    updated_at: updatedAt,
    digest: null,
  });
  validateApprenticeshipRecordEnvelope(envelope);
  return envelope;
}

export function validateApprenticeshipRecordEnvelope(envelope) {
  exactKeys(envelope, [
    "schema",
    "version",
    "mode",
    "record_id",
    "record_type",
    "state",
    "lifecycle_status",
    "payload_schema",
    "payload_digest",
    "provenance",
    "predecessor_ref",
    "predecessor_digest",
    "evidence_attestation_refs",
    "actor_ref",
    "actor_session_ref",
    "actor_role",
    "owner_decision_ref",
    "activation_allowed",
    "protected_actions",
    "created_at",
    "updated_at",
    "digest",
  ], "apprenticeship record envelope");
  assert(envelope.schema === RECORD_ENVELOPE_SCHEMA && envelope.version === APPRENTICESHIP_VERSION, "apprenticeship record envelope identity is invalid");
  assert(envelope.mode === APPRENTICESHIP_MODE, "apprenticeship record envelope mode is invalid");
  requireIdentifier(envelope.record_id, "apprenticeship record ID");
  requireIdentifier(envelope.record_type, "apprenticeship record type");
  requireEnum(envelope.state, APPRENTICESHIP_STATES, "apprenticeship record state");
  requireEnum(envelope.lifecycle_status, RECORD_LIFECYCLE_STATUSES, "apprenticeship record lifecycle status");
  if (envelope.state === "ARCHIVED") assert(envelope.lifecycle_status === "ARCHIVED", "archived apprenticeship records must be archived");
  if (envelope.lifecycle_status === "ARCHIVED") assert(envelope.state === "ARCHIVED", "archived lifecycle requires archived state");
  requireSchemaId(envelope.payload_schema, "apprenticeship record payload schema");
  requireSha256(envelope.payload_digest, "apprenticeship record payload digest");
  validateProvenance(envelope.provenance, {label: "apprenticeship record provenance"});
  requireNullableReference(envelope.predecessor_ref, "apprenticeship record predecessor reference");
  requireNullableSha256(envelope.predecessor_digest, "apprenticeship record predecessor digest");
  assert((envelope.predecessor_ref === null) === (envelope.predecessor_digest === null), "apprenticeship record predecessor reference and digest must be paired");
  validateEvidenceRefs(envelope.evidence_attestation_refs, "apprenticeship record attestation references", {allowEmpty: true});
  requireSafeReference(envelope.actor_ref, "apprenticeship record actor reference");
  requireSafeReference(envelope.actor_session_ref, "apprenticeship record actor session reference");
  requireEnum(envelope.actor_role, ACTOR_ROLES, "apprenticeship record actor role");
  validateActorBinding(envelope.provenance, envelope.actor_ref, envelope.actor_session_ref, "apprenticeship record");
  requireNullableReference(envelope.owner_decision_ref, "apprenticeship record owner decision reference");
  assert(envelope.activation_allowed === false, "apprenticeship record envelope cannot allow activation");
  validateProtectedActions(envelope.protected_actions, "apprenticeship record protected actions");
  validateTimestamp(envelope.created_at, "apprenticeship record creation timestamp");
  validateTimestamp(envelope.updated_at, "apprenticeship record update timestamp");
  assertNonActivating(envelope, "apprenticeship record envelope");
  assertPortableRecord(envelope, "apprenticeship record envelope");
  validateDigest(envelope, "apprenticeship record envelope");
  return envelope;
}

export function compileApprenticeshipStateTransition({
  transitionId,
  recordRef,
  predecessorStateRef = null,
  fromState,
  toState,
  reasonCode,
  authority,
  actorRef,
  actorSessionRef,
  provenance,
  evidenceAttestationRefs = [],
  ownerDecisionRef = null,
  observedAt,
} = {}) {
  requireIdentifier(transitionId, "apprenticeship state transition ID");
  requireSafeReference(recordRef, "apprenticeship state transition record reference");
  requireNullableReference(predecessorStateRef, "apprenticeship state predecessor reference");
  requireEnum(fromState, APPRENTICESHIP_STATES, "apprenticeship state transition source state");
  requireEnum(toState, APPRENTICESHIP_STATES, "apprenticeship state transition target state");
  transitionApprenticeshipState(fromState, toState);
  requireIdentifier(reasonCode, "apprenticeship state transition reason code");
  requireEnum(authority, STATE_TRANSITION_AUTHORITIES, "apprenticeship state transition authority");
  requireSafeReference(actorRef, "apprenticeship state transition actor reference");
  requireSafeReference(actorSessionRef, "apprenticeship state transition actor session reference");
  validateProvenance(provenance, {label: "apprenticeship state transition provenance"});
  validateActorBinding(provenance, actorRef, actorSessionRef, "apprenticeship state transition");
  validateEvidenceRefs(evidenceAttestationRefs, "apprenticeship state transition attestation references", {allowEmpty: true});
  requireNullableReference(ownerDecisionRef, "apprenticeship state transition owner decision reference");
  if (toState === "OWNER_APPROVED_PENDING_ACTIVATION") assert(ownerDecisionRef !== null, "owner-approved state requires a separate owner decision reference");
  validateTimestamp(observedAt, "apprenticeship state transition timestamp");
  const transition = withDigest({
    schema: STATE_TRANSITION_SCHEMA,
    version: APPRENTICESHIP_VERSION,
    mode: APPRENTICESHIP_MODE,
    transition_id: transitionId,
    record_ref: recordRef,
    predecessor_state_ref: predecessorStateRef,
    from_state: fromState,
    to_state: toState,
    reason_code: reasonCode,
    authority,
    actor_ref: actorRef,
    actor_session_ref: actorSessionRef,
    provenance: structuredClone(provenance),
    evidence_attestation_refs: [...evidenceAttestationRefs],
    owner_decision_ref: ownerDecisionRef,
    activation_allowed: false,
    protected_actions: protectedActions(),
    observed_at: observedAt,
    digest: null,
  });
  validateApprenticeshipStateTransition(transition);
  return transition;
}

export function validateApprenticeshipStateTransition(transition) {
  exactKeys(transition, [
    "schema",
    "version",
    "mode",
    "transition_id",
    "record_ref",
    "predecessor_state_ref",
    "from_state",
    "to_state",
    "reason_code",
    "authority",
    "actor_ref",
    "actor_session_ref",
    "provenance",
    "evidence_attestation_refs",
    "owner_decision_ref",
    "activation_allowed",
    "protected_actions",
    "observed_at",
    "digest",
  ], "apprenticeship state transition");
  assert(transition.schema === STATE_TRANSITION_SCHEMA && transition.version === APPRENTICESHIP_VERSION, "apprenticeship state transition identity is invalid");
  assert(transition.mode === APPRENTICESHIP_MODE, "apprenticeship state transition mode is invalid");
  requireIdentifier(transition.transition_id, "apprenticeship state transition ID");
  requireSafeReference(transition.record_ref, "apprenticeship state transition record reference");
  requireNullableReference(transition.predecessor_state_ref, "apprenticeship state predecessor reference");
  requireEnum(transition.from_state, APPRENTICESHIP_STATES, "apprenticeship state transition source state");
  requireEnum(transition.to_state, APPRENTICESHIP_STATES, "apprenticeship state transition target state");
  transitionApprenticeshipState(transition.from_state, transition.to_state);
  requireIdentifier(transition.reason_code, "apprenticeship state transition reason code");
  requireEnum(transition.authority, STATE_TRANSITION_AUTHORITIES, "apprenticeship state transition authority");
  requireSafeReference(transition.actor_ref, "apprenticeship state transition actor reference");
  requireSafeReference(transition.actor_session_ref, "apprenticeship state transition actor session reference");
  validateProvenance(transition.provenance, {label: "apprenticeship state transition provenance"});
  validateActorBinding(transition.provenance, transition.actor_ref, transition.actor_session_ref, "apprenticeship state transition");
  validateEvidenceRefs(transition.evidence_attestation_refs, "apprenticeship state transition attestation references", {allowEmpty: true});
  requireNullableReference(transition.owner_decision_ref, "apprenticeship state transition owner decision reference");
  if (transition.to_state === "OWNER_APPROVED_PENDING_ACTIVATION") assert(transition.owner_decision_ref !== null, "owner-approved state requires a separate owner decision reference");
  assert(transition.activation_allowed === false, "apprenticeship state transition cannot allow activation");
  validateProtectedActions(transition.protected_actions, "apprenticeship state transition protected actions");
  validateTimestamp(transition.observed_at, "apprenticeship state transition timestamp");
  assertNonActivating(transition, "apprenticeship state transition");
  assertPortableRecord(transition, "apprenticeship state transition");
  validateDigest(transition, "apprenticeship state transition");
  return transition;
}
