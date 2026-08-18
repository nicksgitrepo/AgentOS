#!/usr/bin/env node

/* Public Intent Regulator/Runtime facade over durable contracts and storage. */

import {
  ACCEPTANCE_STATUSES,
  ACTIVATION_STATUS,
  CHECKPOINT_NEXT_ACTIONS,
  CHECKPOINT_SCHEMA,
  CHECKPOINT_VERSION,
  DECISION_SCHEMA,
  DECISION_VERSION,
  DEFAULT_REVIEW_INTERVAL_MINUTES,
  EVENT_SCHEMA,
  EVENT_VERSION,
  GENESIS_EVENT_HEAD_SHA256,
  INTENT_REGULATOR_ROLE,
  LEASE_SCHEMA,
  LEASE_VERSION,
  MAX_REVIEW_INTERVAL_MINUTES,
  MEANINGFUL_RESULT_TYPES,
  MIN_REVIEW_INTERVAL_MINUTES,
  PERSISTENT_INTENT_RUNTIME_SCHEMA,
  PERSISTENT_INTENT_RUNTIME_VERSION,
  PERSISTENT_INTENT_RUNTIME_CONTRACT_SCHEMA,
  PERSISTENT_INTENT_RUNTIME_CONTRACT_VERSION,
  PERSISTENT_ROLE_DISPLAY_NAMES,
  PERSISTENT_ROLE_IDS,
  PERSISTENT_ROLE_SCHEMA,
  PERSISTENT_ROLE_VERSION,
  PROGRESS_STATUSES,
  PROTECTED_ACTIONS,
  OWNER_DECISION_CAPABILITY,
  OWNER_DECISION_SCHEMA,
  OWNER_DECISION_VERSION,
  OWNER_DECISIONS,
  REGULATOR_DECISIONS,
  REGULATOR_STATUSES,
  REGULATOR_DECISION_CAPABILITY,
  RUNTIME_ROLE,
  SNAPSHOT_SCHEMA,
  SNAPSHOT_VERSION,
  STATE_SCHEMA,
  STATE_VERSION,
  TRANSACTION_SCHEMA,
  TRANSACTION_VERSION,
  assertIdentityForCheckpoint,
  assertDecisionMatchesState,
  compileIntentRegulatorDecision,
  compilePersistentIntentRuntimeContract,
  compileOwnerGoalReplacement,
  compilePersistentRoleRecord,
  createOpaqueRuntimeReference,
  defaultGovernanceDigest,
  ensureIdempotencyKey,
  statusAfterCheckpoint,
  transitionForOwnerGoalReplacement,
  transitionForDecision,
  validateIntentRegulatorCheckpoint,
  validateIntentRegulatorDecision,
  validatePersistentIntentRuntimeContract,
  validateOwnerGoalReplacement,
  validateIntentRegulatorSnapshot,
  validatePersistentIntentRuntimeState,
  validatePersistentRoleRecord,
  validatePersistentRuntimeLease,
  validateCampaignSnapshot,
} from "./persistent-intent-runtime-contract.mjs";
import {
  assert,
  requireInterval,
  requireOpaqueReference,
  requireUtc,
} from "./persistent-intent-runtime-primitives.mjs";
import {
  assertRuntimeLease,
  commitRuntimeTransaction,
  inspectRuntimeStorage,
  openRuntimeStorage,
  readRuntimeCheckpoint,
  readRuntimeEvents,
  readRuntimeRoles,
  readRuntimeState,
  releaseRuntimeStorage,
  renewRuntimeStorage,
  resumeRuntimeStorage,
} from "./persistent-intent-runtime-storage.mjs";

export {
  ACCEPTANCE_STATUSES,
  ACTIVATION_STATUS,
  CHECKPOINT_NEXT_ACTIONS,
  CHECKPOINT_SCHEMA,
  CHECKPOINT_VERSION,
  DECISION_SCHEMA,
  DECISION_VERSION,
  DEFAULT_REVIEW_INTERVAL_MINUTES,
  EVENT_SCHEMA,
  EVENT_VERSION,
  GENESIS_EVENT_HEAD_SHA256,
  INTENT_REGULATOR_ROLE,
  LEASE_SCHEMA,
  LEASE_VERSION,
  MAX_REVIEW_INTERVAL_MINUTES,
  MEANINGFUL_RESULT_TYPES,
  MIN_REVIEW_INTERVAL_MINUTES,
  PERSISTENT_INTENT_RUNTIME_SCHEMA,
  PERSISTENT_INTENT_RUNTIME_VERSION,
  PERSISTENT_INTENT_RUNTIME_CONTRACT_SCHEMA,
  PERSISTENT_INTENT_RUNTIME_CONTRACT_VERSION,
  PERSISTENT_ROLE_DISPLAY_NAMES,
  PERSISTENT_ROLE_IDS,
  PERSISTENT_ROLE_SCHEMA,
  PERSISTENT_ROLE_VERSION,
  PROGRESS_STATUSES,
  PROTECTED_ACTIONS,
  OWNER_DECISION_CAPABILITY,
  OWNER_DECISION_SCHEMA,
  OWNER_DECISION_VERSION,
  OWNER_DECISIONS,
  REGULATOR_DECISIONS,
  REGULATOR_STATUSES,
  RUNTIME_ROLE,
  SNAPSHOT_SCHEMA,
  SNAPSHOT_VERSION,
  STATE_SCHEMA,
  STATE_VERSION,
  TRANSACTION_SCHEMA,
  TRANSACTION_VERSION,
  compileIntentRegulatorDecision,
  compilePersistentIntentRuntimeContract,
  compileOwnerGoalReplacement,
  compilePersistentRoleRecord,
  createOpaqueRuntimeReference,
  validateIntentRegulatorCheckpoint,
  validateIntentRegulatorDecision,
  validatePersistentIntentRuntimeContract,
  validateOwnerGoalReplacement,
  validateIntentRegulatorSnapshot,
  validatePersistentIntentRuntimeState,
  validatePersistentRoleRecord,
  validatePersistentRuntimeLease,
};

export class PersistentIntentRuntime {
  #root;
  #lease;
  #token;
  #leaseDurationSeconds;
  #faultInjector;
  #closed = false;
  #state;
  #checkpoint;
  #roles;

  constructor({authorityRoot, repositoryRoot = process.cwd(), runtimeRef, snapshot, environmentId, governanceDigest = defaultGovernanceDigest(), reviewIntervalMinutes = DEFAULT_REVIEW_INTERVAL_MINUTES, nowUtc = new Date().toISOString(), leaseDurationSeconds = 60, faultInjector = null} = {}) {
    requireOpaqueReference(runtimeRef, "Runtime reference");
    requireInterval(reviewIntervalMinutes);
    requireUtc(nowUtc, "Runtime start time");
    assert(Number.isSafeInteger(leaseDurationSeconds) && leaseDurationSeconds >= 1 && leaseDurationSeconds <= 24 * 60 * 60, "Runtime lease duration is invalid");
    assert(typeof faultInjector === "undefined" || faultInjector === null || typeof faultInjector === "function", "Runtime fault injector is invalid");
    const opened = openRuntimeStorage({
      authorityRoot,
      repositoryRoot,
      runtimeRef,
      snapshot,
      environmentId,
      governanceDigest,
      reviewIntervalMinutes,
      nowUtc,
      leaseDurationSeconds,
      faultInjector,
    });
    this.#root = opened.root;
    this.#lease = opened.lease;
    this.#token = opened.token;
    this.#leaseDurationSeconds = leaseDurationSeconds;
    this.#faultInjector = faultInjector;
    this.#state = opened.state;
    this.#checkpoint = opened.checkpoint;
    this.#roles = opened.roles;
  }

  #assertOpen() {
    assert(!this.#closed, "Persistent Intent Regulator/Runtime is closed", "RUNTIME_CLOSED");
  }

  #assertLease(nowUtc) {
    this.#assertOpen();
    requireUtc(nowUtc, "Runtime operation time");
    assertRuntimeLease(this.#root, this.#token, nowUtc);
  }

  #commit({eventType, actorRole, payload, idempotencyKey, nextState, nextCheckpoint = null, nowUtc}) {
    this.#assertLease(nowUtc);
    ensureIdempotencyKey(idempotencyKey);
    const result = commitRuntimeTransaction({
      root: this.#root,
      token: this.#token,
      expectedStateSha256: this.#state.state_sha256,
      eventType,
      actorRole,
      payload,
      idempotencyKey,
      nextState,
      nextCheckpoint,
      nowUtc,
      faultInjector: this.#faultInjector,
    });
    this.#state = result.state;
    this.#checkpoint = result.checkpoint;
    return result;
  }

  #assertReadback() {
    const diskState = readRuntimeState(this.#root);
    assert(diskState !== null && diskState.state_sha256 === this.#state.state_sha256,
      "Runtime state readback differs from the open Runtime", "RUNTIME_STATE_STALE");
    const diskRoles = readRuntimeRoles(this.#root);
    assert(JSON.stringify(diskRoles) === JSON.stringify(this.#roles),
      "Runtime persistent role readback differs from the open Runtime", "RUNTIME_STATE_STALE");
    readRuntimeEvents(this.#root, diskState);
    readRuntimeCheckpoint(this.#root, diskState);
  }

  readState() {
    this.#assertOpen();
    this.#assertReadback();
    return structuredClone(this.#state);
  }

  readCheckpoint() {
    this.#assertOpen();
    this.#assertReadback();
    return structuredClone(this.#checkpoint);
  }

  readPersistentRoles() {
    this.#assertOpen();
    this.#assertReadback();
    return structuredClone(this.#roles);
  }

  readEvents() {
    this.#assertOpen();
    this.#assertReadback();
    return readRuntimeEvents(this.#root, this.#state);
  }

  resume({nowUtc = new Date().toISOString()} = {}) {
    this.#assertLease(nowUtc);
    const recovered = resumeRuntimeStorage({root: this.#root, token: this.#token, nowUtc, faultInjector: this.#faultInjector});
    this.#state = recovered.state;
    this.#checkpoint = recovered.checkpoint;
    return {recovered: recovered.recovered, state: structuredClone(this.#state), checkpoint: structuredClone(this.#checkpoint)};
  }

  renew({nowUtc = new Date().toISOString()} = {}) {
    this.#assertLease(nowUtc);
    const renewed = renewRuntimeStorage({root: this.#root, token: this.#token, nowUtc, leaseDurationSeconds: this.#leaseDurationSeconds});
    this.#lease = renewed.lease;
    this.#token = renewed.token;
    return structuredClone(renewed.lease);
  }

  runIntentRegulatorTick(snapshot, {idempotencyKey, observedAtUtc = new Date().toISOString()} = {}) {
    this.#assertOpen();
    ensureIdempotencyKey(idempotencyKey);
    validateCampaignSnapshot(snapshot);
    const decision = compileIntentRegulatorDecision(snapshot, {observedAtUtc, intervalMinutes: this.#state.review_interval_minutes});
    return this.commitRegulatorDecision(decision, {idempotencyKey, nowUtc: observedAtUtc});
  }

  commitRegulatorDecision(decision, {idempotencyKey, nowUtc = decision?.observed_at_utc ?? new Date().toISOString()} = {}) {
    assert(decision?.[REGULATOR_DECISION_CAPABILITY] === true, "Runtime may commit only an in-process Intent Regulator decision capability", "REGULATOR_AUTHORITY_BOUNDARY");
    validateIntentRegulatorDecision(decision);
    ensureIdempotencyKey(idempotencyKey);
    assertDecisionMatchesState(this.#state, decision);
    const nextState = transitionForDecision(this.#state, decision, nowUtc);
    nextState.last_idempotency_key = idempotencyKey;
    nextState.state_sha256 = null;
    return this.#commit({
      eventType: "REGULATOR_DECISION_COMMITTED",
      actorRole: INTENT_REGULATOR_ROLE,
      payload: decision,
      idempotencyKey,
      nextState,
      nowUtc,
    });
  }

  commitOwnerGoalReplacement(decision, {idempotencyKey, nowUtc = decision?.approved_at_utc ?? new Date().toISOString()} = {}) {
    assert(decision?.[OWNER_DECISION_CAPABILITY] === true, "Runtime may commit only an in-process owner decision capability", "OWNER_DECISION_REQUIRED");
    validateOwnerGoalReplacement(decision);
    ensureIdempotencyKey(idempotencyKey);
    const replaying = this.#state.last_idempotency_key === idempotencyKey
      && this.#state.goal_id === decision.goal_id
      && this.#state.goal_sha256 === decision.goal_sha256
      && this.#state.source_commit === decision.source_commit
      && this.#state.source_tree === decision.source_tree;
    const nextState = replaying ? {...this.#state} : transitionForOwnerGoalReplacement(this.#state, decision, nowUtc);
    nextState.last_idempotency_key = idempotencyKey;
    nextState.state_sha256 = null;
    return this.#commit({
      eventType: "OWNER_GOAL_REPLACEMENT_COMMITTED",
      actorRole: RUNTIME_ROLE,
      payload: decision,
      idempotencyKey,
      nextState,
      nowUtc,
    });
  }

  recordCheckpoint(checkpoint, {idempotencyKey, nowUtc = checkpoint?.created_at_utc ?? new Date().toISOString()} = {}) {
    validateIntentRegulatorCheckpoint(checkpoint);
    ensureIdempotencyKey(idempotencyKey);
    assert(this.#closed === false, "Persistent Intent Regulator/Runtime is closed", "RUNTIME_CLOSED");
    assertIdentityForCheckpoint(this.#state, checkpoint);
    if (["HARD_STOPPED", "BLOCKED"].includes(this.#state.status)) {
      assert(checkpoint.progress_status === "CLOSED", "hard-stopped Runtime cannot record new progress", "HARD_BOUNDARY_TERMINAL");
    }
    assert(this.#state.status !== "REASSESSMENT_REQUIRED" || checkpoint.progress_status !== "CLOSED",
      "reassessment cannot close before an owner-controlled goal replacement", "OWNER_DECISION_REQUIRED");
    const nextState = {
      ...this.#state,
      ...statusAfterCheckpoint(this.#state, checkpoint),
      checkpoint_id: checkpoint.checkpoint_id,
      checkpoint_sha256: checkpoint.checkpoint_sha256,
      last_idempotency_key: idempotencyKey,
      updated_at_utc: nowUtc,
      state_sha256: null,
    };
    return this.#commit({
      eventType: "CHECKPOINT_RECORDED",
      actorRole: RUNTIME_ROLE,
      payload: checkpoint,
      idempotencyKey,
      nextState,
      nextCheckpoint: checkpoint,
      nowUtc,
    });
  }

  close({nowUtc = new Date().toISOString()} = {}) {
    if (this.#closed) return;
    this.#assertLease(nowUtc);
    releaseRuntimeStorage({root: this.#root, token: this.#token, nowUtc});
    this.#closed = true;
  }
}

export function openPersistentIntentRuntime(options = {}) {
  throw Object.assign(new Error("Persistent Intent Regulator authority is retired; use the read-only migration adapter"), {code: "READ_ONLY_MIGRATION_REQUIRED"});
}

export function inspectPersistentIntentRuntime({authorityRoot, repositoryRoot = process.cwd()} = {}) {
  throw Object.assign(new Error("Persistent Intent Regulator authority is retired; use the read-only migration adapter"), {code: "READ_ONLY_MIGRATION_REQUIRED"});
}
