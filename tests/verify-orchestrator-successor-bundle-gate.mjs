#!/usr/bin/env node

import assert from "node:assert/strict";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {compileActionResultContinuation} from "../control/action-result-continuation.mjs";
import {compileControllerContinuation} from "../control/controller-action-dispatcher.mjs";
import {dispatchOrchestratorSuccessor} from "../control/orchestrator-successor-dispatch.mjs";
import {compileOrchestratorSuccessorBundle, validateOrchestratorSuccessorBundle} from "../control/orchestrator-successor-bundle-gate.mjs";

const sha = (value) => canonicalDigest({value});
const evidence = (id) => ({evidence_id: id, reference: `opaque:${id.toLowerCase()}`, sha256: sha(id)});
const protectedEvent = {
  blocker_id: "PROTECTED.BUNDLE.TEST",
  blocker_class: "PROTECTED_EXTERNAL_DEPENDENCY",
  evidence_ceiling: "Only local governance evidence exists; this fixture does not authorize external work.",
  restart_event: "EXPLICIT_PROTECTED_EVENT",
  resources: {jobs: 0, workers: 0, heavyweight_processes: 0, timers: 0},
};
const source = compileActionResultContinuation({
  actionId: "RUN_LOCAL_CANDIDATE_PROOF",
  resultId: "RESULT.BUNDLE.SOURCE",
  result: {status: "RETRY_REQUIRED", controller_approval_required: false, execution_owner: "LANE_AGENT", direct_consumer: "INDEPENDENT_PLATFORM_REVIEW"},
  semanticBeforeSha256: sha("before"),
  semanticAfterSha256: sha("after"),
  nextAction: "RETRY_SPAWNER_QA",
  nextHandler: "HANDLER.ORCHESTRATOR_SPAWNER_QA",
  continuation: compileControllerContinuation("RETRY_SPAWNER_QA"),
  persistence: {status: "PERSISTED", receipt_ref: "ref:bundle/source", receipt_sha256: sha("source-receipt"), atomic: true, same_turn: true, write_scope: "CONTROL_PLANE_ONLY"},
  evidenceRefs: [evidence("EVIDENCE.BUNDLE.SOURCE")],
  hostileFixtureRefs: ["FIXTURE.BUNDLE.SOURCE"],
});
const persisted = [];
const dispatchReadback = dispatchOrchestratorSuccessor({
  successor: source,
  dispatchId: "DISPATCH.BUNDLE.TEST",
  handlers: {
    "HANDLER.ORCHESTRATOR_SPAWNER_QA": (current) => ({
      semantic_after_sha256: sha(`${current.semantic_after_sha256}:final`),
      next_action: "WAIT_FOR_PROTECTED_EVENT",
      next_handler: "HANDLER.PROTECTED_EVENT_WAIT",
      continuation: compileControllerContinuation("WAIT_FOR_PROTECTED_EVENT", {protectedEventId: protectedEvent.blocker_id}),
      continuation_sha256: canonicalDigest(compileControllerContinuation("WAIT_FOR_PROTECTED_EVENT", {protectedEventId: protectedEvent.blocker_id})),
      evidence_refs: [evidence("EVIDENCE.BUNDLE.FINAL")],
      hostile_fixture_refs: ["FIXTURE.BUNDLE.NO_TIMER"],
      protected_event: protectedEvent,
      defect: null,
    }),
  },
  persist: (receipt) => { persisted.push(receipt); return true; },
});
const bundle = compileOrchestratorSuccessorBundle({
  bundleId: "BUNDLE.ORCHESTRATOR.AUTONOMOUS.001",
  sourceSuccessor: source,
  dispatchReadback,
  finalReceipt: persisted.at(-1),
  directConsumer: "INDEPENDENT_PLATFORM_REVIEW",
  evidenceRefs: [evidence("EVIDENCE.BUNDLE.DISPATCH"), evidence("EVIDENCE.BUNDLE.SOURCE")],
  hostileFixtureRefs: ["FIXTURE.BUNDLE.NO_NULL_DIGEST", "FIXTURE.BUNDLE.NO_APPROVAL", "FIXTURE.BUNDLE.CROSS_BINDING"],
});
validateOrchestratorSuccessorBundle(bundle);
const rejects = (mutator, pattern) => {
  const candidate = structuredClone(bundle);
  mutator(candidate);
  assert.throws(() => validateOrchestratorSuccessorBundle(candidate), pattern);
};
rejects((candidate) => { candidate.bundle_sha256 = null; }, /non-null|digest/u);
rejects((candidate) => { candidate.controller_approval_required = true; }, /approval/u);
rejects((candidate) => { candidate.source_successor.record_sha256 = null; }, /record|digest/u);
rejects((candidate) => { candidate.dispatch_readback.source_successor_sha256 = sha("wrong"); }, /bind|digest|source/u);
rejects((candidate) => { candidate.final_receipt.receipt_sha256 = null; }, /receipt|digest/u);
console.log("PASS Orchestrator successor bundle gate: non-null nested digests, direct consumer binding, cross-record consistency, no Controller approval, and hostile tamper coverage");
