#!/usr/bin/env node

import assert from "node:assert/strict";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {
  compileControllerEscalation,
  validateControllerEscalation,
} from "../control/controller-escalation-continuation.mjs";

const HASH = (value) => canonicalDigest({value});
const EVIDENCE = [
  {evidence_id: "EVIDENCE.CURRENT.PROJECTION", kind: "ROSTER_PROJECTION", reference: "opaque:current-projection", sha256: HASH("projection"), status: "BOUND"},
  {evidence_id: "EVIDENCE.CURRENT.QA", kind: "QA_CHECKPOINT", reference: "opaque:current-qa", sha256: HASH("qa"), status: "BOUND"},
];
const common = {
  evidenceRefs: EVIDENCE,
  attemptedActions: ["READ_CURRENT_PROJECTION", "PERSIST_TYPED_CHECKPOINT"],
  safeRemaining: ["EVENT_DRIVEN_IDLE_ONLY"],
  ownerTaskId: "OWNER.FRONT_DOOR",
};

const localRepair = compileControllerEscalation({
  ...common,
  escalationId: "ESCALATION.LOCAL.REPAIR",
  blockerClass: "WORKFLOW_STOP",
  blockerCode: "LOCAL_FIXTURE_MISSING",
  protectedBoundary: false,
  ownerDecisionNeeded: "NO_OWNER_DECISION_REQUIRED_CONTROLLER_REPAIR_WITHIN_BOUNDED_SCOPE",
  restartEvent: "LOCAL_REPAIR_COMPLETION_READBACK",
});
assert.equal(localRepair.continuation.mode, "REPAIR_AND_CONTINUE");
assert.equal(localRepair.continuation.next_action, "START_NEXT_LOCAL_REPAIR");
assert.equal(localRepair.continuation.event_driven_idle, false);
assert.equal(localRepair.owner_route.channel, "OWNER_FRONT_DOOR");
validateControllerEscalation(localRepair);

const protectedEscalation = compileControllerEscalation({
  ...common,
  escalationId: "ESCALATION.PROTECTED.DEPENDENCY",
  blockerClass: "PROTECTED_DEPENDENCY",
  blockerCode: "EXTERNAL_AUTHORITY_PENDING",
  protectedBoundary: true,
  ownerDecisionNeeded: "EXPLICIT_PROTECTED_DEPENDENCY_DECISION",
  restartEvent: "EXPLICIT_PROTECTED_CLEARANCE_OR_OWNER_RESUMPTION",
  protectedDependency: {
    dependency_id: "INDEPENDENT.PROTECTED.CLEARANCE",
    status: "PENDING_EXTERNAL_AUTHORITY",
    evidence_ceiling: "No bound clearance receipt authorizes the dependent transition.",
    sole_protected_dependency: true,
  },
});
assert.equal(protectedEscalation.continuation.mode, "ESCALATE_AND_STALL");
assert.equal(protectedEscalation.continuation.next_action, "WAIT_FOR_OWNER_OR_PROTECTED_DEPENDENCY_EVENT");
assert.equal(protectedEscalation.continuation.event_driven_idle, true);
assert.deepEqual(protectedEscalation.resource_state, {temporary_workers: 0, scheduler_jobs: 0, heavyweight_processes: 0, timers: 0, polling: false});
validateControllerEscalation(protectedEscalation);

const missingRoute = structuredClone(protectedEscalation);
missingRoute.owner_route.route_status = "NOT_ROUTED";
missingRoute.owner_route.message_sha256 = HASH("tampered-route");
missingRoute.escalation_sha256 = canonicalDigest({...missingRoute, escalation_sha256: null});
assert.throws(() => validateControllerEscalation(missingRoute), /owner route is not direct and routed/u);

const protectedWithResources = structuredClone(protectedEscalation);
protectedWithResources.resource_state.heavyweight_processes = 1;
protectedWithResources.owner_route.message_sha256 = canonicalDigest({
  channel: protectedWithResources.owner_route.channel,
  owner_task_id: protectedWithResources.owner_route.owner_task_id,
  blocker_class: protectedWithResources.blocker_class,
  blocker_code: protectedWithResources.blocker_code,
  evidence_refs: protectedWithResources.evidence_refs,
  attempted_actions: protectedWithResources.attempted_actions,
  safe_remaining: protectedWithResources.safe_remaining,
  owner_decision_needed: protectedWithResources.owner_decision_needed,
  restart_event: protectedWithResources.restart_event,
  protected_dependency: protectedWithResources.protected_dependency,
});
protectedWithResources.escalation_sha256 = canonicalDigest({...protectedWithResources, escalation_sha256: null});
assert.throws(() => validateControllerEscalation(protectedWithResources), /release all resources/u);

const missingEvidence = structuredClone(localRepair);
missingEvidence.evidence_refs = [];
missingEvidence.owner_route.message_sha256 = canonicalDigest({
  channel: missingEvidence.owner_route.channel,
  owner_task_id: missingEvidence.owner_route.owner_task_id,
  blocker_class: missingEvidence.blocker_class,
  blocker_code: missingEvidence.blocker_code,
  evidence_refs: missingEvidence.evidence_refs,
  attempted_actions: missingEvidence.attempted_actions,
  safe_remaining: missingEvidence.safe_remaining,
  owner_decision_needed: missingEvidence.owner_decision_needed,
  restart_event: missingEvidence.restart_event,
  protected_dependency: missingEvidence.protected_dependency,
});
missingEvidence.escalation_sha256 = canonicalDigest({...missingEvidence, escalation_sha256: null});
assert.throws(() => validateControllerEscalation(missingEvidence), /evidence is required/u);

console.log("PASS Controller escalation contract: direct owner routing, evidence binding, same-turn local repair, protected zero-resource stall, and hostile fail-closed cases");
