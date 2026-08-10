#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {
  compilePersistentRuntimeObservation,
  compilePersistentRuntimeRoute,
  validatePersistentRuntimeObservation,
  validatePersistentRuntimeRoute,
} from "../control/persistent-intent-runtime-integration.mjs";
import {
  createOpaqueRuntimeReference,
  openPersistentIntentRuntime,
} from "../control/persistent-intent-runtime.mjs";

const REPOSITORY_ROOT = fs.realpathSync(process.cwd());
const PROJECT = "PROJECT-001";
const ENVIRONMENT = "ENVIRONMENT-001";
const CAMPAIGN = "CAMPAIGN-001";
const CAMPAIGN_VERSION = "V1";
const GOAL = "a".repeat(64);
const COMMIT = "b".repeat(40);
const TREE = "c".repeat(40);
const GOVERNANCE = canonicalDigest({schema: "agentos.test.governance.v1", version: 1});
const T0 = "2026-01-01T00:00:00.000Z";

function timeAt(seconds) {
  return new Date(Date.parse(T0) + seconds * 1000).toISOString();
}

function snapshot(overrides = {}) {
  return {
    schema: "agentos.campaign_snapshot.v1",
    version: 1,
    project_id: PROJECT,
    campaign_id: CAMPAIGN,
    campaign_version: CAMPAIGN_VERSION,
    goal_id: "GOAL-001",
    goal_sha256: GOAL,
    source_commit: COMMIT,
    source_tree: TREE,
    progress_status: "PROGRESS_RECORDED",
    scope_changed: false,
    intent_changed: false,
    conditions_changed: false,
    hard_boundary_detected: false,
    soft_boundary_detected: false,
    evidence_identity_ok: true,
    roster_exact: true,
    acceptance_status: "NONE",
    ...overrides,
  };
}

function evidence(overrides = {}) {
  return {
    evidenceSha256: "d".repeat(64),
    issuerKind: "HOST_READBACK",
    issuerRefSha256: "e".repeat(64),
    attestationSha256: "f".repeat(64),
    rosterSha256: "1".repeat(64),
    progressSha256: "2".repeat(64),
    boundarySha256: "3".repeat(64),
    ...overrides,
  };
}

function observation(overrides = {}) {
  return compilePersistentRuntimeObservation({
    snapshot: snapshot(overrides.snapshot),
    environmentId: ENVIRONMENT,
    governanceDigest: GOVERNANCE,
    evidence: evidence(overrides.evidence),
    observedAtUtc: overrides.observedAtUtc ?? timeAt(1),
    reviewIntervalMinutes: overrides.reviewIntervalMinutes ?? 15,
  });
}

function freshRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agentos-runtime-integration-"));
}

const healthyObservation = observation();
validatePersistentRuntimeObservation(healthyObservation);
assert.equal(healthyObservation.snapshot_sha256, canonicalDigest(healthyObservation.snapshot));
assert.equal(healthyObservation.evidence_identity_ok, true);
assert.equal(healthyObservation.roster_exact, true);

assert.throws(
  () => observation({evidence: {issuerRefSha256: "/tmp/private-host-session"}}),
  /lowercase SHA-256/u,
  "raw host/path input must never enter the integration envelope",
);

const tamperedObservation = structuredClone(healthyObservation);
tamperedObservation.evidence.identity_binding_sha256 = "9".repeat(64);
assert.throws(
  () => validatePersistentRuntimeObservation(tamperedObservation),
  /identity binding digest mismatch/u,
  "identity-bound evidence tampering must fail closed",
);

const root = freshRoot();
let runtime;
try {
  runtime = openPersistentIntentRuntime({
    authorityRoot: root,
    repositoryRoot: REPOSITORY_ROOT,
    runtimeRef: createOpaqueRuntimeReference("RUNTIME_REF", "integration-runtime"),
    snapshot: healthyObservation.snapshot,
    environmentId: ENVIRONMENT,
    governanceDigest: GOVERNANCE,
    nowUtc: T0,
  });
  const committed = runtime.runIntentRegulatorTick(healthyObservation.snapshot, {
    idempotencyKey: "INTEGRATION-TICK-001",
    observedAtUtc: healthyObservation.observed_at_utc,
  });
  const route = compilePersistentRuntimeRoute({observation: healthyObservation, commitResult: committed, routedAtUtc: timeAt(2)});
  validatePersistentRuntimeRoute(route);
  assert.equal(route.decision, "CONTINUE_CAMPAIGN");
  assert.equal(route.route_action, "CONTINUE_CAMPAIGN");
  assert.equal(route.runtime_status, "ACTIVE");
  assert.equal(route.dependent_work_allowed, true);
  assert.equal(route.runtime_event_sha256, committed.event.event_sha256);
  assert.equal(route.runtime_state_sha256, committed.state.state_sha256);

  const reused = runtime.runIntentRegulatorTick(healthyObservation.snapshot, {
    idempotencyKey: "INTEGRATION-TICK-001",
    observedAtUtc: healthyObservation.observed_at_utc,
  });
  const reusedRoute = compilePersistentRuntimeRoute({observation: healthyObservation, commitResult: reused, routedAtUtc: timeAt(3)});
  assert.equal(reusedRoute.reused, true);
  assert.equal(reusedRoute.runtime_event_sha256, route.runtime_event_sha256);

  const hardObservation = observation({
    observedAtUtc: timeAt(4),
    snapshot: {evidence_identity_ok: false},
  });
  const hardResult = runtime.runIntentRegulatorTick(hardObservation.snapshot, {
    idempotencyKey: "INTEGRATION-HARD-001",
    observedAtUtc: hardObservation.observed_at_utc,
  });
  const hardRoute = compilePersistentRuntimeRoute({observation: hardObservation, commitResult: hardResult, routedAtUtc: timeAt(5)});
  assert.equal(hardRoute.decision, "STOP_HARD_BOUNDARY");
  assert.equal(hardRoute.route_action, "HARD_STOP");
  assert.equal(hardRoute.runtime_status, "HARD_STOPPED");
  assert.equal(hardRoute.dependent_work_allowed, false);

  const wrongRouteInput = structuredClone(committed);
  wrongRouteInput.event.committed_by_role = "INTENT_REGULATOR";
  assert.throws(
    () => compilePersistentRuntimeRoute({observation: healthyObservation, commitResult: wrongRouteInput, routedAtUtc: timeAt(6)}),
    /only Runtime may commit authority events|Runtime route requires Runtime-committed authority/u,
    "a regulator-only event cannot become a route",
  );
} finally {
  try { runtime?.close({nowUtc: timeAt(7)}); } catch { /* test cleanup */ }
  fs.rmSync(root, {recursive: true, force: true});
}

console.log(JSON.stringify({status: "PASS", observation_schema: "v1", route_schema: "v1", evidence_identity: true, runtime_commit_required: true, hard_stop_route: true, idempotent_route: true}));
