#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  compileAutonomousLaneHandoff,
  validateAutonomousLaneHandoff,
  AUTONOMOUS_LANE_NEXT_ACTION,
  AUTONOMOUS_LANE_NEXT_HANDLER,
} from "../control/autonomous-lane-handoff.mjs";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);
const SOURCE = {commit: "commit-autonomous", tree: "tree-autonomous", worktree_id: "lane-worktree"};

const handoff = compileAutonomousLaneHandoff({
  laneId: "security-lane",
  workerRef: "CAMPAIGN:v1:security-lane:ATTEMPT-1",
  campaignId: "CAMPAIGN-AUTONOMOUS-1",
  campaignVersion: "v1",
  goalSha256: SHA_A,
  source: SOURCE,
  writableScope: "SCOPE-SECURITY",
  resultType: "VERIFIED_BEHAVIOR",
  nextAction: AUTONOMOUS_LANE_NEXT_ACTION,
  nextHandler: AUTONOMOUS_LANE_NEXT_HANDLER,
  summary: "The lane completed its bounded independent security pass.",
  artifactSha256: SHA_B,
  evidenceSha256: SHA_C,
  handoffRef: `opaque:campaign-handoff/${SHA_A}`,
});

validateAutonomousLaneHandoff(handoff);
assert.equal(handoff.execution_owner, "LANE_AGENT");
assert.equal(handoff.controller_role, "LIVENESS_CUSTODIAN");
assert.equal(handoff.controller_approval_required, false);
assert.equal(handoff.next_consumer, "INDEPENDENT_PLATFORM_REVIEW");
assert.equal(handoff.next_action, AUTONOMOUS_LANE_NEXT_ACTION);
assert.equal(handoff.next_handler, AUTONOMOUS_LANE_NEXT_HANDLER);

const hostile = (change, expected) => {
  const candidate = structuredClone(handoff);
  change(candidate);
  assert.throws(() => validateAutonomousLaneHandoff(candidate), expected);
};

hostile((candidate) => { candidate.execution_owner = "CONTROLLER"; }, /lane handoff must remain lane-owned/u);
hostile((candidate) => { candidate.controller_approval_required = true; }, /may not require Controller approval/u);
hostile((candidate) => { candidate.next_consumer = "CONTROLLER"; }, /independent consumer/u);
hostile((candidate) => { candidate.next_action = "NONE"; }, /start independent platform review|successor action/u);
hostile((candidate) => { candidate.next_handler = "HANDLER.CONTROLLER_APPROVAL"; }, /platform review handler|Controller approval/u);
hostile((candidate) => { candidate.roster_policy = "KEEP_STALE_DEPENDENTS"; }, /roster policy is incomplete/u);
hostile((candidate) => { candidate.handoff_sha256 = SHA_C; }, /digest mismatch/u);

console.log(JSON.stringify({
  status: "PASS",
  schema: handoff.schema,
  controller_approval_required: handoff.controller_approval_required,
  hostile_cases: 5,
}));
