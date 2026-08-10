#!/usr/bin/env node

/* Hostile authority-boundary and privacy cases for the prepared Runtime slice. */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {
  ACTIVATION_STATUS,
  PROTECTED_ACTIONS,
  compileIntentRegulatorDecision,
  createOpaqueRuntimeReference,
  openPersistentIntentRuntime,
} from "../control/persistent-intent-runtime.mjs";
import {validateEvent, validateIntentRegulatorDecision} from "../control/persistent-intent-runtime-contract.mjs";

const repositoryRoot = fs.realpathSync(process.cwd());
const PROJECT = "PROJECT-001";
const ENVIRONMENT = "ENVIRONMENT-001";
const T0 = "2026-01-01T00:00:00.000Z";
const snapshot = {
  schema: "agentos.campaign_snapshot.v1",
  version: 1,
  project_id: PROJECT,
  campaign_id: "CAMPAIGN-001",
  campaign_version: "V1",
  goal_id: "GOAL-001",
  goal_sha256: "a".repeat(64),
  source_commit: "b".repeat(40),
  source_tree: "c".repeat(40),
  progress_status: "PROGRESS_RECORDED",
  scope_changed: false,
  intent_changed: false,
  conditions_changed: false,
  hard_boundary_detected: false,
  soft_boundary_detected: false,
  evidence_identity_ok: true,
  roster_exact: true,
  acceptance_status: "NONE",
};

function freshRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agentos-runtime-hostile-"));
}

function open(root, name, options = {}) {
  return openPersistentIntentRuntime({
    authorityRoot: root,
    repositoryRoot,
    runtimeRef: createOpaqueRuntimeReference("RUNTIME_REF", name),
    snapshot,
    environmentId: ENVIRONMENT,
    nowUtc: T0,
    ...options,
  });
}

const root = freshRoot();
let runtime;
try {
  runtime = open(root, "hostile-boundary");
  const result = runtime.runIntentRegulatorTick(snapshot, {idempotencyKey: "HOSTILE-001", observedAtUtc: T0});

  // Regulator output is guide-only and cannot be reconstructed from JSON for commit.
  const serializedDecision = JSON.parse(JSON.stringify(compileIntentRegulatorDecision(snapshot, {observedAtUtc: T0})));
  assert.throws(() => runtime.commitRegulatorDecision(serializedDecision, {idempotencyKey: "HOSTILE-JSON-001", nowUtc: T0}), /in-process Intent Regulator decision capability/u);

  // Public readbacks are clones; mutating one cannot mutate authoritative in-memory state.
  const readback = runtime.readState();
  readback.status = "CLOSED";
  readback.protected_actions.activation = true;
  assert.equal(runtime.readState().status, "ACTIVE");
  assert.deepEqual(runtime.readState().protected_actions, PROTECTED_ACTIONS);

  // Protected actions remain disabled even when a caller presents a recomputed digest.
  const unsafeDecision = {...result.event.payload, protected_actions: {...PROTECTED_ACTIONS, deployment: true}, decision_sha256: null};
  unsafeDecision.decision_sha256 = canonicalDigest(unsafeDecision);
  assert.throws(() => validateIntentRegulatorDecision(unsafeDecision), /must remain false|PROTECTED_ACTION_BLOCKED/u);

  // Persisted event custody cannot be downgraded from Runtime to the guide role.
  const unsafeEvent = {...result.event, committed_by_role: "INTENT_REGULATOR", event_sha256: null};
  unsafeEvent.event_sha256 = canonicalDigest(unsafeEvent);
  assert.throws(() => validateEvent(unsafeEvent), /only Runtime may commit/u);

  // Raw path-like content is rejected from durable decision records.
  const unsafePathDecision = {...result.event.payload, reasons: ["/absolute/private/host/path"], decision_sha256: null};
  unsafePathDecision.decision_sha256 = canonicalDigest(unsafePathDecision);
  assert.throws(() => validateIntentRegulatorDecision(unsafePathDecision), /privacy validation/u);

  runtime.close({nowUtc: "2026-01-01T00:00:01.000Z"});
  runtime = null;
  assert.throws(() => open(repositoryRoot, "runtime-inside-repository"), /outside the repository/u);
} finally {
  try { runtime?.close({nowUtc: "2026-01-01T00:00:02.000Z"}); } catch { /* test cleanup */ }
  fs.rmSync(root, {recursive: true, force: true});
}

console.log("PASS persistent Runtime hostile boundaries: guide-only custody, protected actions, clone isolation, privacy, and repository containment verified");
