#!/usr/bin/env node

import assert from "node:assert/strict";
import {summarizeDurableSessionLiveness} from "../control/local-self-development-supervisor-adapter.mjs";
import {selectHostLifecycleNextRoute} from "../control/controller-supervisor.mjs";
import {shouldContinueExistingTaskLifecycleSameTurn} from "../control/controller-supervisor-runtime.mjs";
import {compileExistingTaskLifecycle} from "../control/existing-task-stop-resume.mjs";
import {canonicalDigest} from "../control/content-addressing.mjs";

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

const lifecycle = compileExistingTaskLifecycle({
  operationId: "OP.LIVENESS.001", nonce: "NONCE.LIVENESS.001", projectCampaignId: "PROJECT.CAMPAIGN.LIVENESS", taskId: "TASK.LIVENESS.001", hostId: "HOST.LIVENESS.001", activeTurnId: "TURN.LIVENESS.001", pinnedThreads: ["TASK.LIVENESS.001"],
  binding: {role: "AGENTOS.CONTROLLER", model: "MODEL.PORTABLE", reasoning_effort: "medium", cwd: "/project/worktree", branch: "branch/liveness", worktree: "/project/worktree", queue_id: "QUEUE.LIVENESS", seam_id: "SEAM.LIVENESS", basis_sha256: canonicalDigest({basis: "liveness"})},
  custodySha256: canonicalDigest({custody: "liveness"}), packetId: "PACKET.LIVENESS.001", checkpointRef: "CHECKPOINT.LIVENESS.001", checkpointSha256: canonicalDigest({checkpoint: "liveness"}), preservationTerms: "Preserve exact liveness custody.", smallestPendingTransition: "Reread and continue the same task.",
});
assert.equal(shouldContinueExistingTaskLifecycleSameTurn(lifecycle), true);
assert.equal(selectHostLifecycleNextRoute({routeClass: "NEXT_SEAM", laneLead: "AGENTOS.CONTROLLER"}).handler, "AGENTOS.CONTROLLER");
assert.throws(() => selectHostLifecycleNextRoute({routeClass: "AUDIT", laneLead: "AGENTOS.CONTROLLER", trueBlocked: {classification: "SOFT_BOUNDARY", evidence_sha256: canonicalDigest({blocked: false})}}), /TRUE_BLOCKED/u);
console.log("PASS Controller liveness: missing, stopped, orphaned, and source-stale roles require a fresh recovery route");
