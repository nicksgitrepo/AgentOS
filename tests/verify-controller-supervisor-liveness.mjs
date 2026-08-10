#!/usr/bin/env node

import assert from "node:assert/strict";
import {summarizeDurableSessionLiveness} from "../control/local-self-development-supervisor-adapter.mjs";

const roles = ["CAMPAIGN_ORCHESTRATOR", "FEATURE_AGENT", "INDEPENDENT_AUDITOR"];
const healthy = roles.map((role) => ({
  role,
  session_id: `SESSION-${role}`,
  process_alive: true,
  record_status: "RUNNING",
  heartbeat_status: "RUNNING",
  heartbeat_valid: true,
  source_aligned: true,
  repair_required: false,
}));

assert.deepEqual(summarizeDurableSessionLiveness({
  snapshots: healthy,
  declaredSessionIds: healthy.map((snapshot) => snapshot.session_id),
}), {
  unhealthy: [],
  missing_roles: [],
  orphaned_session_ids: [],
}, "three healthy declared roles must not trigger recovery");

const missingAndStopped = summarizeDurableSessionLiveness({
  snapshots: [healthy[0], {...healthy[1], process_alive: false, record_status: "STOPPED", repair_required: true}],
  declaredSessionIds: [healthy[0].session_id, healthy[1].session_id],
});
assert.deepEqual(missingAndStopped.missing_roles, ["INDEPENDENT_AUDITOR"]);
assert.equal(missingAndStopped.unhealthy.some((entry) => entry.role === "FEATURE_AGENT" && entry.record_status === "STOPPED"), true);
assert.equal(missingAndStopped.unhealthy.some((entry) => entry.role === "INDEPENDENT_AUDITOR" && entry.record_status === "MISSING"), true);

const orphanedHealthy = summarizeDurableSessionLiveness({
  snapshots: [...healthy, {...healthy[0], session_id: "ORPHAN-ORCHESTRATOR"}],
  declaredSessionIds: healthy.map((snapshot) => snapshot.session_id),
});
assert.deepEqual(orphanedHealthy.orphaned_session_ids, ["ORPHAN-ORCHESTRATOR"]);
assert.equal(orphanedHealthy.unhealthy.some((entry) => entry.session_id === "ORPHAN-ORCHESTRATOR"), true, "an orphaned live process is not progress");

const staleSource = summarizeDurableSessionLiveness({
  snapshots: [{...healthy[0], source_aligned: false, repair_required: true}],
  declaredSessionIds: [healthy[0].session_id],
  requiredRoles: ["CAMPAIGN_ORCHESTRATOR"],
});
assert.equal(staleSource.unhealthy[0].source_aligned, false, "source-stale role must remain a repair finding");

assert.throws(() => summarizeDurableSessionLiveness({snapshots: [], declaredSessionIds: [], requiredRoles: []}), /required durable session roles/u);
console.log("PASS Controller liveness: missing, stopped, orphaned, and source-stale roles require a fresh recovery route");
