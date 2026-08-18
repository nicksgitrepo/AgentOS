#!/usr/bin/env node

/* Canonical project-agnostic Agent Spawner bootstrap and admission authority. */

import {canonicalDigest, compareUtf8} from "./content-addressing.mjs";

export const SPAWNER_BOOTSTRAP_SCHEMA = "agentos.spawner_bootstrap_package.v1";
export const SPAWNER_ADMISSION_SCHEMA = "agentos.exact_spawner_admission.v1";
export const INERT_SEED_SCHEMA = "agentos.inert_seed_lifecycle.v1";
export const OWNERSHIP_CLASSIFICATION_SCHEMA = "agentos.spawner_ownership_classification.v1";
export const REDISTRIBUTION_HANDOFF_SCHEMA = "agentos.spawner_redistribution_handoff.v1";
export const SPAWNER_TURN_CLOSEOUT_SCHEMA = "agentos.spawner_turn_closeout.v1";

export const SPAWNER_BLOCK_LAYERS = Object.freeze([
  "GLOBAL", "PROJECT", "ROLE", "TECHNOLOGY_OR_STANDARD", "ENVIRONMENT", "TASK",
]);
export const SPAWNER_BOOTSTRAP_INJECTION_ORDER = Object.freeze([
  "CANONICAL_SPAWNER_BLOCK",
  "GLOBAL_GOVERNANCE_MEMORY_READBACK",
  "MODEL_POLICY_SNAPSHOT",
  "HOST_CAPABILITY_ATTESTATION",
  "REQUESTED_ROLE_BLOCK_GRAPH",
  "EXACT_BLOCK_QA",
  "INERT_SEED_CHECKPOINT",
  "WORKER_CONTEXT_PROJECTION",
]);
export const SPAWNER_DEFECT_KINDS = Object.freeze([
  "OBSERVED_DEFECT", "FAILED_GATE", "CONTRADICTION", "STALE_BLOCK", "MISSING_CONTEXT",
  "INVALID_HANDOFF", "UNAVAILABLE_MODEL", "BAD_RECEIPT", "SEED_INVALIDATION",
  "ROSTER_DEFECT", "SPAWNER_BOOTSTRAP_FLAW", "FAILED_REPAIR", "FAILED_QA",
]);
export const PROTECTED_BOUNDARIES = Object.freeze([
  "MATERIAL_SPEND", "IRREVERSIBLE_USER_WORK_LOSS", "DIRECT_CREDENTIAL_OR_HUMAN_INTERACTION",
  "MATERIAL_LEGAL_OR_SAFETY_EXPOSURE", "MAJOR_PRODUCT_RELEASE_OR_PRODUCTION_DECISION",
]);
export const CONTROLLER_ALLOWED_OPERATIONS = Object.freeze([
  "validateControllerGovernance", "validateSpawnerHandoff", "startAgentSpawner",
  "wakeAgentSpawner", "observeAgentSpawner", "dispatchRedistribution", "reconcileLiveness",
]);
export const CONTROLLER_FORBIDDEN_OPERATIONS = Object.freeze([
  "admitLocalSelfDevelopment", "admitSeed", "admitWorker", "applyPolicyReconciliation", "approveLaneHandoff", "runBootstrap",
  "archiveCampaignAgents", "bindPersistentRuntime", "closeCampaign", "compileRoleBlocks", "deployAcceptedArtifact",
  "despawnAgent", "mutateRoster", "notifyAuditor", "reconcileUserReview", "recoverStalledSession", "runLiveAudit",
  "sendLiveDeltaToNextOrchestrator", "spawnCampaignOrchestrator", "spawnFeatureAgents", "spawnIndependentAuditor",
  "spawnNextCampaignOrchestrator", "verifyCheckpoint", "wakeControllerAgent",
]);

const SHA256 = /^[0-9a-f]{64}$/u;
const ID = /^[A-Z][A-Z0-9._:-]{0,191}$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const PLACEHOLDER = /(?:TBD|TODO|FIXME|PLACEHOLDER|FILL[ _-]?ME|LATER)/iu;

function assert(condition, message, code = "SPAWNER_GOVERNANCE_INVALID") {
  if (!condition) {
    const error = new Error(message);
    error.code = code;
    throw error;
  }
}
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function requireRecord(value, label) { assert(isRecord(value), `${label} must be an object`); }
function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a nonempty string`);
  assert(!PLACEHOLDER.test(value), `${label} contains a placeholder`, "PLACEHOLDER_BLOCK");
}
function requireId(value, label) { assert(typeof value === "string" && ID.test(value), `${label} is invalid`); }
function requireSha(value, label) { assert(typeof value === "string" && SHA256.test(value), `${label} must be a SHA-256`); }
function requireUtc(value, label) { assert(typeof value === "string" && ISO_UTC.test(value) && Number.isFinite(Date.parse(value)), `${label} must be UTC`); }
function body(value, digestField) { return {...structuredClone(value), [digestField]: null}; }
function sortedUnique(values, label) {
  assert(Array.isArray(values), `${label} must be an array`);
  const result = [...values].sort(compareUtf8);
  assert(new Set(result).size === result.length, `${label} contains duplicates`);
  return result;
}
function assertDigest(value, field, label) {
  requireSha(value[field], `${label} digest`);
  assert(value[field] === canonicalDigest(body(value, field)), `${label} digest mismatch`, "DIGEST_INVALID");
}

export function assertControllerOperationAuthorized(operation) {
  requireString(operation, "Controller operation");
  assert(CONTROLLER_ALLOWED_OPERATIONS.includes(operation), `Controller operation is forbidden: ${operation}`, "CONTROLLER_OPERATION_FORBIDDEN");
  return operation;
}

export function validateCanonicalSpawnerBootstrapPackage(spawnerPackage) {
  requireRecord(spawnerPackage, "Spawner bootstrap package");
  assert(spawnerPackage.schema === SPAWNER_BOOTSTRAP_SCHEMA && spawnerPackage.version === 1, "Spawner bootstrap identity is invalid");
  assert(spawnerPackage.status === "COMPLETE_QA_PASS" && spawnerPackage.activation === "PREPARED_NOT_ACTIVATED", "Spawner bootstrap is not prepared and QA complete");
  requireId(spawnerPackage.block_id, "Spawner block ID");
  assert(spawnerPackage.project_agnostic === true && spawnerPackage.non_placeholder === true && spawnerPackage.content_addressed === true, "Spawner bootstrap portability/content-addressing invariant failed");
  for (const field of ["purpose", "scope", "authority", "required_knowledge", "stop_conditions", "typed_inputs", "typed_outputs", "custody", "lifecycle", "handoff_contract"]) {
    const value = spawnerPackage[field];
    assert(Array.isArray(value) && value.length > 0, `Spawner bootstrap lacks ${field}`);
    value.forEach((entry) => requireString(entry, `Spawner bootstrap ${field}`));
  }
  assert(JSON.stringify(spawnerPackage.bootstrap_injection_order) === JSON.stringify(SPAWNER_BOOTSTRAP_INJECTION_ORDER), "Spawner bootstrap injection order is invalid");
  requireSha(spawnerPackage.gate_manifest_sha256, "Spawner gate manifest");
  requireSha(spawnerPackage.decision_tree_sha256, "Spawner decision tree");
  assert(Array.isArray(spawnerPackage.gates) && spawnerPackage.gates.length >= 12, "Spawner bootstrap gate pack is incomplete");
  assert(Array.isArray(spawnerPackage.hostile_fixtures) && spawnerPackage.hostile_fixtures.length >= 12, "Spawner bootstrap hostile fixtures are incomplete");
  for (const gate of spawnerPackage.gates) {
    requireRecord(gate, "Spawner gate");
    requireId(gate.gate_id, "Spawner gate ID");
    assert(gate.status === "PASS", `Spawner gate is not passing: ${gate.gate_id}`);
    requireSha(gate.evidence_sha256, "Spawner gate evidence");
  }
  sortedUnique(spawnerPackage.hostile_fixtures, "Spawner hostile fixtures").forEach((fixture) => requireId(fixture, "Spawner hostile fixture"));
  assertDigest(spawnerPackage, "package_sha256", "Spawner bootstrap package");
  return spawnerPackage;
}

export function compileSpawnerDenial({requestId, code, blockId = null, layer = null, detail, repairRoute, observedAtUtc}) {
  requireId(requestId, "Spawner denial request ID");
  requireId(code, "Spawner denial code");
  if (blockId !== null) requireId(blockId, "Spawner denial block ID");
  if (layer !== null) assert(SPAWNER_BLOCK_LAYERS.includes(layer), "Spawner denial layer is invalid");
  requireString(detail, "Spawner denial detail");
  requireString(repairRoute, "Spawner denial repair route");
  requireUtc(observedAtUtc, "Spawner denial time");
  const denial = {schema: "agentos.spawner_admission_denial.v1", version: 1, status: "DENIED", request_id: requestId, code, block_id: blockId, layer, detail, repair_route: repairRoute, observed_at_utc: observedAtUtc, denial_sha256: null};
  denial.denial_sha256 = canonicalDigest(body(denial, "denial_sha256"));
  return denial;
}

function validateBlockEvidence(block, nowMs) {
  requireRecord(block, "Applicable block evidence");
  requireId(block.block_id, "Applicable block ID");
  assert(SPAWNER_BLOCK_LAYERS.includes(block.layer), `Applicable block layer is invalid: ${block.block_id}`);
  requireSha(block.block_sha256, "Applicable block digest");
  assert(block.status === "COMPLETE_QA_PASS", `Block is not QA complete: ${block.block_id}`, "BLOCK_QA_INCOMPLETE");
  assert(block.non_placeholder === true, `Block is a placeholder: ${block.block_id}`, "PLACEHOLDER_BLOCK");
  assert(block.evaluation === "PASS", `Block evaluation is inconclusive: ${block.block_id}`, "BLOCK_EVALUATION_INCONCLUSIVE");
  assert(block.availability === "AVAILABLE", `Block is unavailable: ${block.block_id}`, "BLOCK_UNAVAILABLE");
  requireUtc(block.observed_at_utc, "Block observation time");
  requireUtc(block.expires_at_utc, "Block expiry time");
  assert(Date.parse(block.expires_at_utc) > nowMs, `Block is stale: ${block.block_id}`, "BLOCK_STALE");
  assert(Array.isArray(block.contradictions) && block.contradictions.length === 0, `Block is contradictory: ${block.block_id}`, "BLOCK_CONTRADICTORY");
  assert(Array.isArray(block.gates) && block.gates.length > 0, `Block lacks gate evidence: ${block.block_id}`, "BLOCK_GATE_EVIDENCE_MISSING");
  for (const gate of block.gates) {
    requireId(gate.gate_id, "Block gate ID");
    assert(gate.outcome === "PASS", `Block gate did not pass: ${block.block_id}/${gate.gate_id}`, "BLOCK_GATE_FAILED");
    requireSha(gate.evidence_sha256, "Block gate evidence digest");
  }
  assertDigest(block, "evidence_sha256", `Applicable block ${block.block_id}`);
}

export function compileExactSpawnerAdmission({requestId, spawnerPackage, requiredLayers, applicableBlocks, modelPolicyProjection, observedAtUtc}) {
  validateCanonicalSpawnerBootstrapPackage(spawnerPackage);
  requireId(requestId, "Spawner admission request ID");
  requireUtc(observedAtUtc, "Spawner admission time");
  const layers = sortedUnique(requiredLayers, "Required block layers");
  layers.forEach((layer) => assert(SPAWNER_BLOCK_LAYERS.includes(layer), `Required block layer is invalid: ${layer}`));
  assert(Array.isArray(applicableBlocks) && applicableBlocks.length > 0, "Applicable block evidence is required");
  const nowMs = Date.parse(observedAtUtc);
  applicableBlocks.forEach((block) => validateBlockEvidence(block, nowMs));
  const covered = new Set(applicableBlocks.map((block) => block.layer));
  for (const layer of layers) assert(covered.has(layer), `Required block layer is missing: ${layer}`, "REQUIRED_BLOCK_LAYER_INCOMPLETE");
  assert(new Set(applicableBlocks.map((block) => block.block_id)).size === applicableBlocks.length, "Applicable block evidence contains duplicate IDs");
  requireRecord(modelPolicyProjection, "Model-policy projection");
  assert(modelPolicyProjection.status === "READY" && modelPolicyProjection.spawn_eligible === true, "Model-policy projection is not spawn eligible", "MODEL_POLICY_UNAVAILABLE");
  requireSha(modelPolicyProjection.snapshot_sha256, "Model-policy snapshot");
  requireSha(modelPolicyProjection.projection_sha256, "Model-policy projection");
  const admission = {
    schema: SPAWNER_ADMISSION_SCHEMA,
    version: 1,
    status: "READY_FOR_INERT_SEED",
    request_id: requestId,
    spawner_package_sha256: spawnerPackage.package_sha256,
    required_layers: layers,
    block_evidence: [...applicableBlocks].sort((left, right) => compareUtf8(left.block_id, right.block_id)),
    model_policy_snapshot_sha256: modelPolicyProjection.snapshot_sha256,
    model_policy_projection_sha256: modelPolicyProjection.projection_sha256,
    observed_at_utc: observedAtUtc,
    admission_sha256: null,
  };
  admission.admission_sha256 = canonicalDigest(body(admission, "admission_sha256"));
  return admission;
}

export function compileInertSeed({seedId, admission, contextSha256, rosterSha256, modelPolicySnapshotSha256, createdAtUtc}) {
  requireId(seedId, "Seed ID");
  assert(admission?.schema === SPAWNER_ADMISSION_SCHEMA && admission.status === "READY_FOR_INERT_SEED", "Seed requires exact passing admission");
  [contextSha256, rosterSha256, modelPolicySnapshotSha256].forEach((value) => requireSha(value, "Seed binding"));
  assert(modelPolicySnapshotSha256 === admission.model_policy_snapshot_sha256, "Seed model-policy snapshot differs from admission");
  requireUtc(createdAtUtc, "Seed creation time");
  const seed = {
    schema: INERT_SEED_SCHEMA, version: 1, seed_id: seedId, state: "VERIFIED_INERT", immutable: true,
    work_authority: false, execution_authority: false, network_authority: false, mutation_authority: false,
    admission_sha256: admission.admission_sha256, context_sha256: contextSha256, roster_sha256: rosterSha256,
    model_policy_snapshot_sha256: modelPolicySnapshotSha256, predecessor_seed_sha256: null,
    created_at_utc: createdAtUtc, invalidated_at_utc: null, invalidation_reason: null,
    allowed_transitions: ["CLONE_TO_WORKER", "INVALIDATE", "ARCHIVE", "SUPERSEDE"], seed_sha256: null,
  };
  seed.seed_sha256 = canonicalDigest(body(seed, "seed_sha256"));
  return validateInertSeed(seed);
}

export function validateInertSeed(seed) {
  requireRecord(seed, "Inert seed");
  assert(seed.schema === INERT_SEED_SCHEMA && seed.version === 1, "Inert seed identity is invalid");
  requireId(seed.seed_id, "Seed ID");
  assert(["VERIFIED_INERT", "INVALIDATED", "ARCHIVED", "SUPERSEDED"].includes(seed.state), "Inert seed state is invalid");
  assert(seed.immutable === true && seed.work_authority === false && seed.execution_authority === false && seed.network_authority === false && seed.mutation_authority === false, "Seed is not inert", "SEED_EXECUTION_FORBIDDEN");
  for (const field of ["admission_sha256", "context_sha256", "roster_sha256", "model_policy_snapshot_sha256"]) requireSha(seed[field], `Seed ${field}`);
  assertDigest(seed, "seed_sha256", "Inert seed");
  return seed;
}

export function transitionInertSeed(seed, {transition, observedAtUtc, reason = null, replacementSeedSha256 = null} = {}) {
  validateInertSeed(seed);
  assert(seed.state === "VERIFIED_INERT", "Only a verified inert seed may transition");
  requireUtc(observedAtUtc, "Seed transition time");
  if (transition === "EXECUTE_WORK") assert(false, "An inert seed can never execute work", "SEED_EXECUTION_FORBIDDEN");
  if (transition === "CLONE_TO_WORKER") {
    const clone = {schema: "agentos.seed_worker_clone.v1", version: 1, status: "WORKER_CONTEXT_CANDIDATE", source_seed_sha256: seed.seed_sha256, bound_model_policy_snapshot_sha256: seed.model_policy_snapshot_sha256, created_at_utc: observedAtUtc, clone_sha256: null};
    clone.clone_sha256 = canonicalDigest(body(clone, "clone_sha256"));
    return clone;
  }
  assert(["INVALIDATE", "ARCHIVE", "SUPERSEDE"].includes(transition), "Seed transition is invalid");
  requireString(reason, "Seed transition reason");
  if (transition === "SUPERSEDE") requireSha(replacementSeedSha256, "Replacement seed digest");
  const next = structuredClone(seed);
  next.state = {INVALIDATE: "INVALIDATED", ARCHIVE: "ARCHIVED", SUPERSEDE: "SUPERSEDED"}[transition];
  next.invalidated_at_utc = observedAtUtc;
  next.invalidation_reason = reason;
  next.predecessor_seed_sha256 = transition === "SUPERSEDE" ? replacementSeedSha256 : next.predecessor_seed_sha256;
  next.seed_sha256 = canonicalDigest(body(next, "seed_sha256"));
  return validateInertSeed(next);
}

export function compileOwnershipClassification({defectId, defectKind, affectedLayer, withinSpawnerAuthority, protectedBoundary = null, evidenceSha256, observedAtUtc}) {
  requireId(defectId, "Ownership defect ID");
  assert(SPAWNER_DEFECT_KINDS.includes(defectKind), "Ownership defect kind is invalid");
  assert(SPAWNER_BLOCK_LAYERS.includes(affectedLayer), "Ownership affected layer is invalid");
  requireSha(evidenceSha256, "Ownership evidence");
  requireUtc(observedAtUtc, "Ownership observation time");
  if (protectedBoundary !== null) assert(PROTECTED_BOUNDARIES.includes(protectedBoundary), "Protected boundary is not genuine", "FALSE_PROTECTED_BLOCKER");
  const ownership = withinSpawnerAuthority === true && protectedBoundary === null ? "SPAWNER_LANE" : "OUTSIDE_SPAWNER_LANE";
  const result = {
    schema: OWNERSHIP_CLASSIFICATION_SCHEMA, version: 1, status: "CLASSIFIED", defect_id: defectId,
    defect_kind: defectKind, affected_layer: affectedLayer, ownership, protected_boundary: protectedBoundary,
    owner_approval_required: false, controller_approval_required: false, evidence_sha256: evidenceSha256,
    next_action: ownership === "SPAWNER_LANE" ? "START_AUTONOMOUS_REPAIR" : "DELIVER_REDISTRIBUTION_HANDOFF",
    observed_at_utc: observedAtUtc, classification_sha256: null,
  };
  result.classification_sha256 = canonicalDigest(body(result, "classification_sha256"));
  return result;
}

export function compileRedistributionHandoff({classification, affectedScope, reasonOutsideLane, requiredCapabilities, suggestedDestination, dependencies, urgency, custodyState, rollback, nextAction}) {
  assert(classification?.schema === OWNERSHIP_CLASSIFICATION_SCHEMA && classification.ownership === "OUTSIDE_SPAWNER_LANE", "Redistribution requires out-of-lane ownership");
  [affectedScope, reasonOutsideLane, suggestedDestination, urgency, custodyState, rollback, nextAction].forEach((value) => requireString(value, "Redistribution field"));
  const handoff = {
    schema: REDISTRIBUTION_HANDOFF_SCHEMA, version: 1, status: "DELIVERED_TO_CONTROLLER_DISPATCH",
    classification_sha256: classification.classification_sha256, affected_scope: affectedScope,
    reason_outside_lane: reasonOutsideLane, required_capabilities: sortedUnique(requiredCapabilities, "Redistribution capabilities"),
    suggested_destination: suggestedDestination, dependencies: sortedUnique(dependencies, "Redistribution dependencies"),
    urgency, custody_state: custodyState, rollback, next_action: nextAction,
    controller_is_dispatcher_not_approver: true, handoff_sha256: null,
  };
  handoff.handoff_sha256 = canonicalDigest(body(handoff, "handoff_sha256"));
  return handoff;
}

export function compileSpawnerTurnCloseout({turnId, outcome, successorStartedSha256 = null, redistributionHandoffSha256 = null, protectedBlocker = null, resourcesActive = 0, restartEvent = null}) {
  requireId(turnId, "Spawner turn ID");
  assert(["NEXT_REPAIR_STARTED", "REPAIR_COMPLETED_AND_NEXT_STARTED", "REDISTRIBUTION_DELIVERED", "GENUINE_PROTECTED_BLOCKER"].includes(outcome), "Spawner turn closeout is invalid");
  if (["NEXT_REPAIR_STARTED", "REPAIR_COMPLETED_AND_NEXT_STARTED"].includes(outcome)) requireSha(successorStartedSha256, "Started successor");
  if (outcome === "REDISTRIBUTION_DELIVERED") requireSha(redistributionHandoffSha256, "Redistribution handoff");
  if (outcome === "GENUINE_PROTECTED_BLOCKER") {
    assert(PROTECTED_BOUNDARIES.includes(protectedBlocker), "False protected blocker cannot close a Spawner turn", "FALSE_PROTECTED_BLOCKER");
    assert(resourcesActive === 0, "Protected blocker closeout must have zero active resources");
    requireString(restartEvent, "Protected blocker restart event");
  }
  const closeout = {schema: SPAWNER_TURN_CLOSEOUT_SCHEMA, version: 1, status: "VALID_CLOSEOUT", turn_id: turnId, outcome, successor_started_sha256: successorStartedSha256, redistribution_handoff_sha256: redistributionHandoffSha256, protected_blocker: protectedBlocker, resources_active: resourcesActive, restart_event: restartEvent, closeout_sha256: null};
  closeout.closeout_sha256 = canonicalDigest(body(closeout, "closeout_sha256"));
  return closeout;
}

export function computeInvalidationClosure({changedDigests, dependencyGraph}) {
  const changed = new Set(sortedUnique(changedDigests, "Changed digests"));
  changed.forEach((digest) => requireSha(digest, "Changed digest"));
  assert(Array.isArray(dependencyGraph), "Dependency graph must be an array");
  const affected = new Set(changed);
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const edge of dependencyGraph) {
      requireSha(edge.source_sha256, "Dependency source");
      requireSha(edge.dependent_sha256, "Dependency dependent");
      if (affected.has(edge.source_sha256) && !affected.has(edge.dependent_sha256)) {
        affected.add(edge.dependent_sha256);
        progressed = true;
      }
    }
  }
  return [...affected].sort(compareUtf8);
}
