#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  compileDurableSessionProcessProvenance,
  compileNoncanonicalCleanupRca,
  validateDurableSessionProcessProvenance,
} from "../control/durable-session-process-provenance.mjs";

const NOW = "2026-08-16T22:30:00.000Z";
const COMMIT = "a".repeat(40);
const TREE = "b".repeat(40);
const ROOT_REF = `opaque:root:${"c".repeat(64)}`;

function snapshot(overrides = {}) {
  return {
    session_id: "SESSION-1",
    campaign_id: "CAMPAIGN-1",
    pid: 1234,
    pgid: 1234,
    ppid: 4321,
    status: "RUNNING",
    heartbeat_status: "RUNNING",
    process_alive: true,
    source_commit: COMMIT,
    source_tree: TREE,
    observed_at_utc: NOW,
    ...overrides,
  };
}

function registry(overrides = {}) {
  return {
    session_id: "SESSION-1",
    pid: 1234,
    job_id: "JOB-1",
    requester_id: "REQUESTER-1",
    root_ref: ROOT_REF,
    hold_id: "HOLD-1",
    status: "REGISTERED",
    registry_observed_at_utc: NOW,
    ...overrides,
  };
}

const healthy = compileDurableSessionProcessProvenance({
  snapshots: [snapshot()],
  registryEntries: [registry()],
  observedAtUtc: NOW,
});
assert.equal(healthy.status, "PASS");
assert.equal(healthy.next_action, "CONTINUE");
assert.deepEqual(healthy.findings, []);
validateDurableSessionProcessProvenance(healthy);

const pp1 = snapshot({ppid: 1});
const orphaned = compileDurableSessionProcessProvenance({snapshots: [pp1], registryEntries: [], observedAtUtc: NOW});
assert.equal(orphaned.status, "CLEANUP_RCA_REQUIRED");
assert.equal(orphaned.next_action, "EMIT_CLEANUP_RCA_BEFORE_STOP");
assert(orphaned.findings.some((finding) => finding.code === "ORPHANED_PP1_RUNNING"));
assert(orphaned.findings.some((finding) => finding.code === "MISSING_SCHEDULER_REGISTRY"));
const pp1Rca = compileNoncanonicalCleanupRca({snapshot: pp1, reason: "ORPHANED_PP1_RUNNING", observedAtUtc: NOW});
const orphanedWithRca = compileDurableSessionProcessProvenance({snapshots: [pp1], registryEntries: [], cleanupRcas: [pp1Rca], observedAtUtc: NOW});
assert.equal(orphanedWithRca.status, "REPAIR_REQUIRED");
assert.equal(orphanedWithRca.next_action, "STOP_AFTER_CLEANUP_RCA_AND_RETAIN_EVIDENCE");

const missing = compileDurableSessionProcessProvenance({snapshots: [snapshot({session_id: "SESSION-MISSING"})], registryEntries: [], observedAtUtc: NOW});
assert(missing.findings.some((finding) => finding.code === "MISSING_SCHEDULER_REGISTRY"));

const duplicate = compileDurableSessionProcessProvenance({
  snapshots: [snapshot({session_id: "SESSION-DUPLICATE"})],
  registryEntries: [registry({session_id: "SESSION-DUPLICATE"}), registry({session_id: "SESSION-DUPLICATE", job_id: "JOB-2"})],
  observedAtUtc: NOW,
});
assert(duplicate.findings.some((finding) => finding.code === "DUPLICATE_SCHEDULER_REGISTRY"));

const stale = compileDurableSessionProcessProvenance({
  snapshots: [snapshot({session_id: "SESSION-STALE"})],
  registryEntries: [registry({session_id: "SESSION-STALE", status: "RELEASED"})],
  observedAtUtc: NOW,
});
assert(stale.findings.some((finding) => finding.code === "STALE_SCHEDULER_REGISTRY"));

const mismatch = compileDurableSessionProcessProvenance({
  snapshots: [snapshot({session_id: "SESSION-MISMATCH"})],
  registryEntries: [registry({session_id: "SESSION-MISMATCH", pid: 4321})],
  observedAtUtc: NOW,
});
assert(mismatch.findings.some((finding) => finding.code === "LIVE_PID_REGISTRY_MISMATCH"));

const staleReleasedForStopped = compileDurableSessionProcessProvenance({
  snapshots: [snapshot({session_id: "SESSION-STOPPED", status: "STOPPED", heartbeat_status: "STOPPED", process_alive: false })],
  registryEntries: [registry({session_id: "SESSION-STOPPED"})],
  observedAtUtc: NOW,
});
assert(staleReleasedForStopped.findings.some((finding) => finding.code === "STALE_SCHEDULER_REGISTRY"));
assert.equal(staleReleasedForStopped.next_action, "RECONCILE_REGISTRY_AND_RETAIN_EVIDENCE");

assert.throws(() => compileDurableSessionProcessProvenance({snapshots: [snapshot(), snapshot()], registryEntries: [registry()], observedAtUtc: NOW}), /snapshots are duplicated/u);
assert.throws(() => compileDurableSessionProcessProvenance({snapshots: [snapshot()], registryEntries: [registry({root_ref: "/private/root"})], observedAtUtc: NOW}), /opaque reference/u);
assert.doesNotThrow(() => compileNoncanonicalCleanupRca({snapshot: pp1, reason: "ORPHANED_PP1_RUNNING", observedAtUtc: NOW}), "RCA compilation should be deterministic and valid");

console.log("PASS durable session process provenance: exact scheduler custody, PPID-1 rejection, cleanup RCA ordering, stale/duplicate/missing registry hostile cases");
