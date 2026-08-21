#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  AUTONOMOUS_BLOCKER_ROUTING_SCHEMA,
  classifyAutonomousBlocker,
  compileAutonomousBlockerRoute,
  validateAutonomousBlockerRoute,
  assertAutonomousTurnCloseout,
} from "../control/autonomous-blocker-routing.mjs";

const successor = {action: "START_NEXT_LANE", handler: "HANDLER.NEXT_LANE", reference: "ref:successor/next-lane", started_same_turn: true};
const baseFacts = {
  material_spend: false,
  credential_or_human_auth: false,
  irreversible_destructive_action: false,
  owner_only_major_decision: false,
  governance_or_workflow_failure: false,
  optional_capability_missing: false,
  evidence_unavailable: false,
  lane_has_safe_successor: true,
};

assert.equal(classifyAutonomousBlocker({...baseFacts, optional_capability_missing: true}), "CAPABILITY_GAP");
assert.equal(classifyAutonomousBlocker({...baseFacts, evidence_unavailable: true}), "EVIDENCE_CEILING");
assert.equal(classifyAutonomousBlocker({...baseFacts, governance_or_workflow_failure: true}), "REPAIRABLE_FAILURE");
assert.equal(classifyAutonomousBlocker({...baseFacts, material_spend: true, optional_capability_missing: true}), "TRUE_BLOCKER");

const remoteGap = compileAutonomousBlockerRoute({
  routeId: "ROUTE.REMOTE.OPTIONAL",
  laneId: "LANE.BUILDER.ONE",
  facts: {...baseFacts, optional_capability_missing: true},
  reason: "The optional push destination is unavailable; local work remains safe.",
  evidenceCeiling: "Remote availability was not proven and no push was attempted.",
  dependencyId: "CAPABILITY.REMOTE_PUSH",
  safeAlternatives: ["RUN_LOCAL_QA", "START_NEXT_LANE"].sort(),
  successor,
  remote: {required: true, available: false, optional: true},
});
assert.equal(remoteGap.schema, AUTONOMOUS_BLOCKER_ROUTING_SCHEMA);
assert.equal(remoteGap.global_state, "RUNNING");
assert.equal(remoteGap.lane_state, "WAITING_FOR_CAPABILITY");
assert.deepEqual(remoteGap.remote, {required: true, available: false, optional: true, status: "LOCAL_CANDIDATE_READY", local_candidate_ready: true, push_deferred: true, route: "REMOTE_PUSH_DEFERRED"});
assertAutonomousTurnCloseout({route: remoteGap});

const evidenceGap = compileAutonomousBlockerRoute({
  routeId: "ROUTE.EVIDENCE.CEILING",
  laneId: "LANE.AUDIT.ONE",
  facts: {...baseFacts, evidence_unavailable: true},
  reason: "A live environment proof is unavailable for this lane.",
  evidenceCeiling: "Only local evidence is available; the lane remains unproven.",
  safeAlternatives: ["RUN_LOCAL_QA", "START_NEXT_LANE"].sort(),
  successor,
});
assert.equal(evidenceGap.global_state, "RUNNING");
assert.equal(evidenceGap.lane_state, "UNPROVEN");

const repair = compileAutonomousBlockerRoute({
  routeId: "ROUTE.REPAIR.GATE",
  laneId: "LANE.GOVERNANCE",
  facts: {...baseFacts, governance_or_workflow_failure: true},
  reason: "The routing gate is missing a deterministic branch.",
  evidenceCeiling: "The defect is locally reproducible and needs a governance patch.",
  safeAlternatives: ["PATCH_GOVERNANCE", "START_NEXT_LANE"].sort(),
  successor,
});
assert.equal(repair.global_state, "RUNNING");
assert.equal(repair.lane_state, "REPAIRING");

const trueBlocker = compileAutonomousBlockerRoute({
  routeId: "ROUTE.TRUE.BLOCKER",
  laneId: "LANE.PROTECTED",
  facts: {...baseFacts, owner_only_major_decision: true, lane_has_safe_successor: false},
  reason: "A major owner-only decision is required and no safe alternative exists.",
  evidenceCeiling: "The governing intent does not resolve the protected decision.",
  safeAlternatives: ["PRESERVE_EVIDENCE"],
  successor: null,
});
assert.equal(trueBlocker.global_state, "STOPPED");
assert.equal(trueBlocker.lane_state, "BLOCKED_GLOBAL");
assert.throws(() => assertAutonomousTurnCloseout({route: trueBlocker, trueBlocker: false}), /true blocker/u);
assertAutonomousTurnCloseout({route: trueBlocker, trueBlocker: true});

const emptyQueue = structuredClone(remoteGap);
emptyQueue.successor = null;
emptyQueue.route_sha256 = "0".repeat(64);
assert.throws(() => validateAutonomousBlockerRoute(emptyQueue), /same-turn successor/u);

const globalStopTamper = structuredClone(remoteGap);
globalStopTamper.global_state = "STOPPED";
globalStopTamper.route_sha256 = "0".repeat(64);
assert.throws(() => validateAutonomousBlockerRoute(globalStopTamper), /global work running|digest mismatch/u);

console.log("PASS autonomous blocker routing: true blockers stop globally; capability gaps, evidence ceilings, and repairable failures stay lane-scoped with same-turn successors; optional remote is local-ready/deferred");
