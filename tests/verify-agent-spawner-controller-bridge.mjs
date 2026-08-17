#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {compileAgentSpawnerDefectIntake, acceptAgentSpawnerDefectRepair} from "../control/agent-spawner-defect-intake.mjs";
import {compileAgentSpawnerControllerBridge, validateAgentSpawnerControllerBridge} from "../control/agent-spawner-controller-bridge.mjs";
import {compileControllerProtectedStopDecision} from "../control/controller-action-dispatcher.mjs";

const hash = (value) => canonicalDigest({value});
const sourceBinding = {candidate_sha256: hash("candidate"), context_sha256: hash("context"), roster_projection_sha256: hash("roster"), source_identity_sha256: hash("source")};
const evidenceRefs = [
  {evidence_id: "EVIDENCE.BRIDGE.FAILURE", kind: "REPRODUCIBLE_CHECK", reference: "opaque:failure", sha256: hash("failure")},
  {evidence_id: "EVIDENCE.BRIDGE.RECHECK", kind: "HOST_READBACK", reference: "ref:recheck", sha256: hash("recheck")},
];
const base = {
  defectId: "DEFECT.BRIDGE.ROUTE.001",
  defectKind: "HANDOFF_FAILURE",
  sourceBinding,
  evidenceRefs,
  observation: {summary: "The Spawner handoff has no registered Controller route.", expected: "The same turn dispatches a closed Controller action.", observed: "The custom handoff route was not in the closed registry.", observed_at_utc: "2026-08-17T00:00:00.000Z", details_sha256: hash("details")},
  classification: "ORCHESTRATOR_LIVENESS_FAILURE",
  rootCause: {category: "UNKNOWN_CONTROLLER_ROUTE", statement: "Spawner handoff names a route that the Controller dispatcher cannot execute.", evidence_class: "OBSERVED"},
  blockId: "BLOCK.CONTROLLER.BRIDGE",
  gateId: "GATE.CONTROLLER.REGISTERED_SUCCESSOR",
  graphId: "GRAPH.WORKFLOW",
};

const ready = compileAgentSpawnerDefectIntake(base);
const accepted = acceptAgentSpawnerDefectRepair(ready, {controllerReceiptSha256: hash("controller-receipt")});
const bridge = compileAgentSpawnerControllerBridge({bridgeId: "BRIDGE.SPAWNER.ROUTE.001", intake: accepted});
validateAgentSpawnerControllerBridge(bridge, accepted);
assert.equal(bridge.source_route, "REPAIR_ORCHESTRATOR_ROUTE");
assert.equal(bridge.mapped_action, "START_NEXT_AVAILABLE_CONTROLLER_TRANSITION");
assert.equal(bridge.mapped_handler, "HANDLER.CONTROLLER_AVAILABLE_TRANSITION");
assert.equal(bridge.dispatch.same_turn_dispatch, true);
assert.equal(bridge.controller_action_receipt.next_action, bridge.mapped_action);

const compilePatch = compileAgentSpawnerDefectIntake({...base, defectId: "DEFECT.BRIDGE.COMPILE.001", classification: "REPAIRABLE_GATE_GAP"});
const compileAccepted = acceptAgentSpawnerDefectRepair(compilePatch, {controllerReceiptSha256: hash("controller-receipt-2")});
const compileBridge = compileAgentSpawnerControllerBridge({bridgeId: "BRIDGE.SPAWNER.COMPILE.001", intake: compileAccepted});
assert.equal(compileBridge.mapped_action, "REPAIR_BLOCKS");
assert.equal(compileBridge.mapped_handler, "HANDLER.ORCHESTRATOR_BLOCK_REPAIR");

const roster = compileAgentSpawnerDefectIntake({...base, defectId: "DEFECT.BRIDGE.ROSTER.001", classification: "AUTHORITY_CONFLICT"});
const rosterAccepted = acceptAgentSpawnerDefectRepair(roster, {controllerReceiptSha256: hash("controller-receipt-3")});
const rosterBridge = compileAgentSpawnerControllerBridge({bridgeId: "BRIDGE.SPAWNER.ROSTER.001", intake: rosterAccepted});
assert.equal(rosterBridge.mapped_action, "START_NEXT_AVAILABLE_CONTROLLER_TRANSITION");
assert.equal(rosterBridge.roster_invalidation, "PRESERVE_EXISTING_AND_REBUILD");

const protectedIntake = compileAgentSpawnerDefectIntake({...base, defectId: "DEFECT.BRIDGE.PROTECTED.001", classification: "PROTECTED_BOUNDARY"});
const protectedEvent = {
  blocker_id: "PROTECTED.EXTERNAL.DEPENDENCY",
  blocker_class: "PROTECTED_EXTERNAL_DEPENDENCY",
  evidence_ceiling: "A protected external dependency has no independent clearance receipt; no local route may infer permission.",
  restart_event: "Resume only on a typed protected event or explicit owner resumption.",
  resources: {jobs: 0, workers: 0, heavyweight_processes: 0, timers: 0},
};
const protectedGate = {
  local_work_present: false,
  incomplete_block_count: 0,
  pending_route_count: 0,
  stop_workflow_decision: compileControllerProtectedStopDecision({protectedEvent, nextAction: "WAIT_FOR_PROTECTED_EVENT"}),
};
const protectedBridge = compileAgentSpawnerControllerBridge({bridgeId: "BRIDGE.SPAWNER.PROTECTED.001", intake: protectedIntake, protectedEvent, protectedGate});
assert.equal(protectedBridge.mapped_action, "WAIT_FOR_PROTECTED_EVENT");
assert.equal(protectedBridge.dispatch.same_turn_dispatch, false);
assert.equal(protectedBridge.controller_action_receipt.protected_event.blocker_id, protectedEvent.blocker_id);
assert.throws(() => compileAgentSpawnerControllerBridge({bridgeId: "BRIDGE.SPAWNER.PROTECTED.BAD", intake: protectedIntake, protectedEvent}), /explicit zero-local-work gate/u);
assert.throws(() => compileAgentSpawnerControllerBridge({
  bridgeId: "BRIDGE.SPAWNER.PROTECTED.LOCAL_WORK",
  intake: protectedIntake,
  protectedEvent,
  protectedGate: {...protectedGate, local_work_present: true},
}), /cannot hide local work/u);
assert.throws(() => compileAgentSpawnerControllerBridge({
  bridgeId: "BRIDGE.SPAWNER.PROTECTED.QUEUED_ROUTE",
  intake: protectedIntake,
  protectedEvent,
  protectedGate: {...protectedGate, pending_route_count: 1},
}), /cannot hide pending routes/u);

const tampered = structuredClone(bridge);
tampered.mapped_action = "WAIT_FOR_PROTECTED_EVENT";
tampered.mapped_handler = "HANDLER.PROTECTED_EVENT_WAIT";
tampered.bridge_sha256 = canonicalDigest({...tampered, bridge_sha256: null});
assert.throws(() => validateAgentSpawnerControllerBridge(tampered, accepted), /mapped action is stale/u);
const tamperedDigest = structuredClone(bridge);
tamperedDigest.readback_sha256 = hash("tampered");
assert.throws(() => validateAgentSpawnerControllerBridge(tamperedDigest, accepted), /readback digest mismatch/u);

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
for (const relative of ["control/agent-spawner-controller-bridge.mjs", "schemas/agent-spawner-controller-bridge.v1.json"]) {
  const text = fs.readFileSync(path.join(root, relative), "utf8");
  assert(!/Sociuna|JobSight|WellSight/iu.test(text), `${relative} contains consumer-specific policy`);
}

console.log("PASS Agent Spawner Controller bridge: custom Spawner handoffs map to closed Controller successors with same-turn dispatch, protected waits, roster invalidation, and tamper rejection");
