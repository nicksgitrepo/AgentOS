#!/usr/bin/env node

import assert from "node:assert/strict";
import {auditCampaignSnapshot, runIntentRegulatorLoop} from "../control/intent-regulator.mjs";

const base = {schema: "agentos.campaign_snapshot.v1", version: 1, project_id: "PROJECT-001", campaign_id: "CAMPAIGN-001", campaign_version: "V1", goal_id: "GOAL-001", goal_sha256: "a".repeat(64), source_commit: "b".repeat(40), source_tree: "c".repeat(40), progress_status: "PROGRESS_RECORDED", scope_changed: false, intent_changed: false, conditions_changed: false, hard_boundary_detected: false, soft_boundary_detected: false, evidence_identity_ok: true, roster_exact: true, acceptance_status: "NONE"};
const now = "2026-01-01T00:00:00.000Z";
assert.equal(auditCampaignSnapshot({...base, hard_boundary_detected: true}, now).decision, "STOP_HARD_BOUNDARY");
assert.equal(auditCampaignSnapshot({...base, scope_changed: true}, now).decision, "REASSESS_AND_REPLACE_GOAL");
assert.equal(auditCampaignSnapshot({...base, soft_boundary_detected: true}, now).decision, "ORCHESTRATOR_REVIEW");
assert.equal(auditCampaignSnapshot({...base, progress_status: "STALLED"}, now).decision, "REPLACE_STALLED_WORKER");
assert.equal(auditCampaignSnapshot({...base, acceptance_status: "CANDIDATE"}, now).decision, "AWAIT_ACCEPTANCE");
assert.equal(auditCampaignSnapshot(base, now, 15).interval_minutes, 15);

const decisions = [];
let reads = 0;
let sleeps = [];
const result = await runIntentRegulatorLoop({
  readSnapshot: async () => { reads += 1; return base; },
  onAudit: async (audit) => decisions.push(audit.decision),
  interval_minutes: 15,
  max_iterations: 2,
  sleep: async (milliseconds) => sleeps.push(milliseconds),
});
assert.equal(result.iterations, 2);
assert.deepEqual(decisions, ["CONTINUE_CAMPAIGN", "CONTINUE_CAMPAIGN"]);
assert.deepEqual(sleeps, [900000]);
assert.equal(reads, 2);
console.log(JSON.stringify({status: "PASS", decisions, interval_ms: sleeps[0]}));

