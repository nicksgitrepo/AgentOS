/* Pure observation and routing envelopes for the persistent Runtime seam. */

import {canonicalDigest} from "./content-addressing.mjs";
import {
  ACTIVATION_STATUS,
  DEFAULT_REVIEW_INTERVAL_MINUTES,
  REGULATOR_DECISIONS,
  validateEvent,
  validateIntentRegulatorDecision,
  validateIntentRegulatorSnapshot,
  validatePersistentIntentRuntimeState,
} from "./persistent-intent-runtime-contract.mjs";
import {
  assert,
  clone,
  digestWithout,
  exactKeys,
  privacyCheck,
  requireBoolean,
  requireIdentifier,
  requireInterval,
  requireRecord,
  requireSha,
  requireSourceSha,
  requireUtc,
} from "./persistent-intent-runtime-primitives.mjs";

export const PERSISTENT_INTENT_RUNTIME_INTEGRATION_VERSION = 1;
export const PERSISTENT_RUNTIME_OBSERVATION_SCHEMA = "agentos.persistent_intent_runtime_observation.v1";
export const PERSISTENT_RUNTIME_ROUTE_SCHEMA = "agentos.persistent_intent_runtime_route.v1";
export const EVIDENCE_ISSUER_KINDS = Object.freeze(["HOST_READBACK", "INDEPENDENT_AUDITOR"]);
export const RUNTIME_ROUTE_ACTIONS = Object.freeze([
  "CONTINUE_CAMPAIGN",
  "HARD_STOP",
  "REASSESS_GOAL",
  "SOFT_REVIEW",
  "REPLACE_STALLED_WORKER",
  "AWAIT_ACCEPTANCE",
]);

const OBSERVATION_EVIDENCE_KEYS = [
  "evidence_sha256",
  "identity_binding_sha256",
  "roster_sha256",
  "progress_sha256",
  "boundary_sha256",
  "issuer_kind",
  "issuer_ref_sha256",
  "attestation_sha256",
];

const OBSERVATION_KEYS = [
  "schema", "version", "activation_status", "project_id", "campaign_id", "campaign_version", "goal_id", "goal_sha256",
  "source_commit", "source_tree", "environment_id", "governance_digest", "review_interval_minutes", "snapshot", "snapshot_sha256",
  "evidence", "observed_at_utc", "evidence_identity_ok", "roster_exact", "observation_sha256",
];

const ROUTE_KEYS = [
  "schema", "version", "activation_status", "project_id", "campaign_id", "campaign_version", "goal_id", "snapshot_sha256",
  "evidence_sha256", "runtime_event_sha256", "runtime_state_sha256", "decision_sha256", "decision", "route", "target_role",
  "route_action", "runtime_status", "route_status", "dependent_work_allowed", "idempotency_key", "reused", "routed_at_utc", "route_sha256",
];

const ROUTE_BY_DECISION = Object.freeze({
  CONTINUE_CAMPAIGN: Object.freeze({route: "CAMPAIGN_ORCHESTRATOR", targetRole: "CAMPAIGN_ORCHESTRATOR", routeAction: "CONTINUE_CAMPAIGN", runtimeStatus: "ACTIVE", routeStatus: "CAMPAIGN_ORCHESTRATOR", dependentWorkAllowed: true}),
  STOP_HARD_BOUNDARY: Object.freeze({route: "OWNER_REVIEW", targetRole: "OWNER", routeAction: "HARD_STOP", runtimeStatus: "HARD_STOPPED", routeStatus: "OWNER_REVIEW", dependentWorkAllowed: false}),
  REASSESS_AND_REPLACE_GOAL: Object.freeze({route: "OWNER_REVIEW", targetRole: "OWNER", routeAction: "REASSESS_GOAL", runtimeStatus: "REASSESSMENT_REQUIRED", routeStatus: "OWNER_REVIEW", dependentWorkAllowed: false}),
  ORCHESTRATOR_REVIEW: Object.freeze({route: "CAMPAIGN_ORCHESTRATOR", targetRole: "CAMPAIGN_ORCHESTRATOR", routeAction: "SOFT_REVIEW", runtimeStatus: "SOFT_REVIEW", routeStatus: "CAMPAIGN_ORCHESTRATOR", dependentWorkAllowed: false}),
  REPLACE_STALLED_WORKER: Object.freeze({route: "CAMPAIGN_ORCHESTRATOR", targetRole: "CAMPAIGN_ORCHESTRATOR", routeAction: "REPLACE_STALLED_WORKER", runtimeStatus: "REPLACEMENT_REQUIRED", routeStatus: "CAMPAIGN_ORCHESTRATOR", dependentWorkAllowed: false}),
  AWAIT_ACCEPTANCE: Object.freeze({route: "INDEPENDENT_AUDITOR", targetRole: "INDEPENDENT_AUDITOR", routeAction: "AWAIT_ACCEPTANCE", runtimeStatus: "AWAITING_ACCEPTANCE", routeStatus: "INDEPENDENT_AUDITOR", dependentWorkAllowed: false}),
});

function requireEvidenceInput(value) {
  exactKeys(value, ["evidenceSha256", "issuerKind", "issuerRefSha256", "attestationSha256", "rosterSha256", "progressSha256", "boundarySha256"], "Runtime observation evidence input");
  requireSha(value.evidenceSha256, "Runtime observation evidence digest");
  assert(EVIDENCE_ISSUER_KINDS.includes(value.issuerKind), "Runtime observation evidence issuer kind is invalid");
  requireSha(value.issuerRefSha256, "Runtime observation evidence issuer reference digest");
  requireSha(value.attestationSha256, "Runtime observation evidence attestation digest");
  requireSha(value.rosterSha256, "Runtime observation roster evidence digest");
  requireSha(value.progressSha256, "Runtime observation progress evidence digest");
  requireSha(value.boundarySha256, "Runtime observation boundary evidence digest");
}

function identityBindingDigest({snapshot, environmentId, issuerKind, issuerRefSha256, attestationSha256}) {
  return canonicalDigest({
    project_id: snapshot.project_id,
    campaign_id: snapshot.campaign_id,
    campaign_version: snapshot.campaign_version,
    goal_id: snapshot.goal_id,
    goal_sha256: snapshot.goal_sha256,
    source_commit: snapshot.source_commit,
    source_tree: snapshot.source_tree,
    environment_id: environmentId,
    issuer_kind: issuerKind,
    issuer_ref_sha256: issuerRefSha256,
    attestation_sha256: attestationSha256,
  });
}

function validateObservationEvidence(evidence, observation) {
  exactKeys(evidence, OBSERVATION_EVIDENCE_KEYS, "Runtime observation evidence");
  requireSha(evidence.evidence_sha256, "Runtime observation evidence digest");
  requireSha(evidence.identity_binding_sha256, "Runtime observation identity binding digest");
  requireSha(evidence.roster_sha256, "Runtime observation roster evidence digest");
  requireSha(evidence.progress_sha256, "Runtime observation progress evidence digest");
  requireSha(evidence.boundary_sha256, "Runtime observation boundary evidence digest");
  assert(EVIDENCE_ISSUER_KINDS.includes(evidence.issuer_kind), "Runtime observation evidence issuer kind is invalid");
  requireSha(evidence.issuer_ref_sha256, "Runtime observation evidence issuer reference digest");
  requireSha(evidence.attestation_sha256, "Runtime observation evidence attestation digest");
  assert(evidence.identity_binding_sha256 === identityBindingDigest({
    snapshot: observation.snapshot,
    environmentId: observation.environment_id,
    issuerKind: evidence.issuer_kind,
    issuerRefSha256: evidence.issuer_ref_sha256,
    attestationSha256: evidence.attestation_sha256,
  }), "Runtime observation identity binding digest mismatch", "RUNTIME_OBSERVATION_IDENTITY_MISMATCH");
  return evidence;
}

export function compilePersistentRuntimeObservation({snapshot, environmentId, governanceDigest, evidence, observedAtUtc = new Date().toISOString(), reviewIntervalMinutes = DEFAULT_REVIEW_INTERVAL_MINUTES} = {}) {
  validateIntentRegulatorSnapshot(snapshot);
  requireIdentifier(environmentId, "Runtime observation environment ID");
  requireSha(governanceDigest, "Runtime observation governance digest");
  requireUtc(observedAtUtc, "Runtime observation time");
  requireInterval(reviewIntervalMinutes, "Runtime observation review interval");
  requireRecord(evidence, "Runtime observation evidence");
  requireEvidenceInput(evidence);
  const observation = {
    schema: PERSISTENT_RUNTIME_OBSERVATION_SCHEMA,
    version: PERSISTENT_INTENT_RUNTIME_INTEGRATION_VERSION,
    activation_status: ACTIVATION_STATUS,
    project_id: snapshot.project_id,
    campaign_id: snapshot.campaign_id,
    campaign_version: snapshot.campaign_version,
    goal_id: snapshot.goal_id,
    goal_sha256: snapshot.goal_sha256,
    source_commit: snapshot.source_commit,
    source_tree: snapshot.source_tree,
    environment_id: environmentId,
    governance_digest: governanceDigest,
    review_interval_minutes: reviewIntervalMinutes,
    snapshot: clone(snapshot),
    snapshot_sha256: canonicalDigest(snapshot),
    evidence: {
      evidence_sha256: evidence.evidenceSha256,
      identity_binding_sha256: identityBindingDigest({
        snapshot,
        environmentId,
        issuerKind: evidence.issuerKind,
        issuerRefSha256: evidence.issuerRefSha256,
        attestationSha256: evidence.attestationSha256,
      }),
      roster_sha256: evidence.rosterSha256,
      progress_sha256: evidence.progressSha256,
      boundary_sha256: evidence.boundarySha256,
      issuer_kind: evidence.issuerKind,
      issuer_ref_sha256: evidence.issuerRefSha256,
      attestation_sha256: evidence.attestationSha256,
    },
    observed_at_utc: observedAtUtc,
    evidence_identity_ok: snapshot.evidence_identity_ok,
    roster_exact: snapshot.roster_exact,
    observation_sha256: null,
  };
  observation.observation_sha256 = digestWithout(observation, "observation_sha256");
  return validatePersistentRuntimeObservation(observation);
}

export function validatePersistentRuntimeObservation(observation) {
  exactKeys(observation, OBSERVATION_KEYS, "Runtime observation");
  assert(observation.schema === PERSISTENT_RUNTIME_OBSERVATION_SCHEMA && observation.version === PERSISTENT_INTENT_RUNTIME_INTEGRATION_VERSION, "Runtime observation identity is invalid");
  assert(observation.activation_status === ACTIVATION_STATUS, "Runtime observation activation status is invalid");
  validateIntentRegulatorSnapshot(observation.snapshot);
  for (const field of ["project_id", "campaign_id", "campaign_version", "goal_id"]) requireIdentifier(observation[field], `Runtime observation ${field}`);
  requireSha(observation.goal_sha256, "Runtime observation goal digest");
  requireSourceSha(observation.source_commit, "Runtime observation source commit");
  requireSourceSha(observation.source_tree, "Runtime observation source tree");
  requireIdentifier(observation.environment_id, "Runtime observation environment ID");
  requireSha(observation.governance_digest, "Runtime observation governance digest");
  requireInterval(observation.review_interval_minutes, "Runtime observation review interval");
  assert(observation.project_id === observation.snapshot.project_id, "Runtime observation project differs from snapshot", "RUNTIME_OBSERVATION_IDENTITY_MISMATCH");
  assert(observation.campaign_id === observation.snapshot.campaign_id && observation.campaign_version === observation.snapshot.campaign_version, "Runtime observation campaign differs from snapshot", "RUNTIME_OBSERVATION_IDENTITY_MISMATCH");
  assert(observation.goal_id === observation.snapshot.goal_id && observation.goal_sha256 === observation.snapshot.goal_sha256, "Runtime observation goal differs from snapshot", "RUNTIME_OBSERVATION_IDENTITY_MISMATCH");
  assert(observation.source_commit === observation.snapshot.source_commit && observation.source_tree === observation.snapshot.source_tree, "Runtime observation source differs from snapshot", "RUNTIME_OBSERVATION_IDENTITY_MISMATCH");
  requireSha(observation.snapshot_sha256, "Runtime observation snapshot digest");
  assert(observation.snapshot_sha256 === canonicalDigest(observation.snapshot), "Runtime observation snapshot digest mismatch", "RUNTIME_OBSERVATION_IDENTITY_MISMATCH");
  validateObservationEvidence(observation.evidence, observation);
  requireUtc(observation.observed_at_utc, "Runtime observation time");
  requireBoolean(observation.evidence_identity_ok, "Runtime observation evidence identity");
  requireBoolean(observation.roster_exact, "Runtime observation roster exactness");
  assert(observation.evidence_identity_ok === observation.snapshot.evidence_identity_ok, "Runtime observation evidence identity differs from snapshot", "RUNTIME_OBSERVATION_IDENTITY_MISMATCH");
  assert(observation.roster_exact === observation.snapshot.roster_exact, "Runtime observation roster exactness differs from snapshot", "RUNTIME_OBSERVATION_IDENTITY_MISMATCH");
  requireSha(observation.observation_sha256, "Runtime observation digest");
  assert(observation.observation_sha256 === digestWithout(observation, "observation_sha256"), "Runtime observation digest mismatch");
  privacyCheck(observation, "Runtime observation");
  return observation;
}

function validateCommitResult(result) {
  exactKeys(result, ["reused", "event", "state", "checkpoint"], "Runtime commit result");
  requireBoolean(result.reused, "Runtime commit result reuse flag");
  validateEvent(result.event);
  validatePersistentIntentRuntimeState(result.state);
  assert(result.event.event_type === "REGULATOR_DECISION_COMMITTED", "Runtime route requires a regulator decision event", "RUNTIME_ROUTE_AUTHORITY_BOUNDARY");
  assert(result.event.committed_by_role === "RUNTIME", "Runtime route requires Runtime-committed authority", "RUNTIME_ROUTE_AUTHORITY_BOUNDARY");
  validateIntentRegulatorDecision(result.event.payload);
  assert(result.event.next_state_sha256 === result.state.state_sha256, "Runtime route event and state differ", "RUNTIME_ROUTE_AUTHORITY_BOUNDARY");
  assert(result.checkpoint === null || typeof result.checkpoint === "object", "Runtime commit result checkpoint is invalid");
  return result;
}

function expectedRoute(decision) {
  const route = ROUTE_BY_DECISION[decision];
  assert(route !== undefined, "Runtime route decision is unsupported", "RUNTIME_ROUTE_AUTHORITY_BOUNDARY");
  return route;
}

export function compilePersistentRuntimeRoute({observation, commitResult, routedAtUtc = new Date().toISOString()} = {}) {
  validatePersistentRuntimeObservation(observation);
  validateCommitResult(commitResult);
  requireUtc(routedAtUtc, "Runtime route time");
  const event = commitResult.event;
  const decision = event.payload;
  assert(decision.snapshot_sha256 === observation.snapshot_sha256, "Runtime route decision differs from observation", "RUNTIME_ROUTE_IDENTITY_MISMATCH");
  assert(decision.observed_at_utc === observation.observed_at_utc, "Runtime route observation time differs", "RUNTIME_ROUTE_IDENTITY_MISMATCH");
  assert(decision.interval_minutes === observation.review_interval_minutes, "Runtime route review interval differs", "RUNTIME_ROUTE_IDENTITY_MISMATCH");
  for (const field of ["project_id", "campaign_id", "campaign_version", "goal_id", "goal_sha256", "source_commit", "source_tree"]) {
    assert(decision[field] === observation[field] || (field === "goal_id" && decision.decision === "REASSESS_AND_REPLACE_GOAL"), `Runtime route ${field} differs from observation`, "RUNTIME_ROUTE_IDENTITY_MISMATCH");
  }
  const route = expectedRoute(decision.decision);
  assert(commitResult.state.status === route.runtimeStatus, "Runtime route state status differs from decision", "RUNTIME_ROUTE_AUTHORITY_BOUNDARY");
  assert(commitResult.state.route_status === route.routeStatus, "Runtime route status differs from decision", "RUNTIME_ROUTE_AUTHORITY_BOUNDARY");
  assert(commitResult.state.dependent_work_allowed === route.dependentWorkAllowed, "Runtime route dependent-work authority differs from decision", "RUNTIME_ROUTE_AUTHORITY_BOUNDARY");
  const record = {
    schema: PERSISTENT_RUNTIME_ROUTE_SCHEMA,
    version: PERSISTENT_INTENT_RUNTIME_INTEGRATION_VERSION,
    activation_status: ACTIVATION_STATUS,
    project_id: observation.project_id,
    campaign_id: observation.campaign_id,
    campaign_version: observation.campaign_version,
    goal_id: decision.goal_id,
    snapshot_sha256: observation.snapshot_sha256,
    evidence_sha256: observation.evidence.evidence_sha256,
    runtime_event_sha256: event.event_sha256,
    runtime_state_sha256: commitResult.state.state_sha256,
    decision_sha256: decision.decision_sha256,
    decision: decision.decision,
    route: route.route,
    target_role: route.targetRole,
    route_action: route.routeAction,
    runtime_status: route.runtimeStatus,
    route_status: route.routeStatus,
    dependent_work_allowed: route.dependentWorkAllowed,
    idempotency_key: event.idempotency_key,
    reused: commitResult.reused,
    routed_at_utc: routedAtUtc,
    route_sha256: null,
  };
  record.route_sha256 = digestWithout(record, "route_sha256");
  return validatePersistentRuntimeRoute(record);
}

export function validatePersistentRuntimeRoute(route) {
  exactKeys(route, ROUTE_KEYS, "Runtime route");
  assert(route.schema === PERSISTENT_RUNTIME_ROUTE_SCHEMA && route.version === PERSISTENT_INTENT_RUNTIME_INTEGRATION_VERSION, "Runtime route identity is invalid");
  assert(route.activation_status === ACTIVATION_STATUS, "Runtime route activation status is invalid");
  for (const field of ["project_id", "campaign_id", "campaign_version", "goal_id"]) requireIdentifier(route[field], `Runtime route ${field}`);
  for (const field of ["snapshot_sha256", "evidence_sha256", "runtime_event_sha256", "runtime_state_sha256", "decision_sha256"]) requireSha(route[field], `Runtime route ${field}`);
  assert(REGULATOR_DECISIONS.includes(route.decision), "Runtime route decision is invalid");
  const expected = expectedRoute(route.decision);
  assert(route.route === expected.route && route.target_role === expected.targetRole && route.route_action === expected.routeAction, "Runtime route target differs from decision", "RUNTIME_ROUTE_AUTHORITY_BOUNDARY");
  assert(route.runtime_status === expected.runtimeStatus && route.route_status === expected.routeStatus, "Runtime route state differs from decision", "RUNTIME_ROUTE_AUTHORITY_BOUNDARY");
  assert(route.dependent_work_allowed === expected.dependentWorkAllowed, "Runtime route dependent-work authority differs from decision", "RUNTIME_ROUTE_AUTHORITY_BOUNDARY");
  requireIdentifier(route.idempotency_key, "Runtime route idempotency key");
  requireBoolean(route.reused, "Runtime route reuse flag");
  requireUtc(route.routed_at_utc, "Runtime route time");
  requireSha(route.route_sha256, "Runtime route digest");
  assert(route.route_sha256 === digestWithout(route, "route_sha256"), "Runtime route digest mismatch");
  privacyCheck(route, "Runtime route");
  return route;
}
