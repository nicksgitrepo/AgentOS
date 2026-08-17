#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {canonicalDigest, compareUtf8} from "../control/content-addressing.mjs";
import {compileActionResultContinuation} from "../control/action-result-continuation.mjs";
import {compileControllerContinuation} from "../control/controller-action-dispatcher.mjs";
import {dispatchOrchestratorSuccessor} from "../control/orchestrator-successor-dispatch.mjs";
import {
  OBSERVED_DISPATCH_BINDING_PROVEN_STATUS,
  OBSERVED_DISPATCH_BINDING_REQUIRED_STATUS,
  compileObservedDispatchSourceSuccessor,
  compileObservedDispatchSuccessorBinding,
  validateObservedDispatchSuccessorBinding,
} from "../control/observed-dispatch-binding-gate.mjs";
import {
  compileObservedDispatchSuccessorBinding as publicCompile,
  compileObservedDispatchSourceSuccessor as publicCompileSource,
  validateObservedDispatchSuccessorBinding as publicValidate,
} from "../control/agentos.mjs";

const sha = (value) => canonicalDigest({value});
const evidence = (id) => ({evidence_id: id, reference: `opaque:${id.toLowerCase()}`, sha256: sha(id)});
const protectedEvent = {
  blocker_id: "PROTECTED.OBSERVED.DISPATCH.TEST",
  blocker_class: "PROTECTED_EXTERNAL_DEPENDENCY",
  evidence_ceiling: "Only local compiler evidence exists; no external or protected action is authorized.",
  restart_event: "EXPLICIT_PROTECTED_EVENT",
  resources: {jobs: 0, workers: 0, heavyweight_processes: 0, timers: 0},
};

const source = compileActionResultContinuation({
  actionId: "RUN_LOCAL_CANDIDATE_PROOF",
  resultId: "RESULT.OBSERVED.DISPATCH.SOURCE",
  result: {
    status: "RETRY_REQUIRED",
    controller_approval_required: false,
    execution_owner: "LANE_AGENT",
    direct_consumer: "INDEPENDENT_PLATFORM_REVIEW",
  },
  semanticBeforeSha256: sha("observed-before"),
  semanticAfterSha256: sha("observed-after"),
  nextAction: "REQUEST_SPAWNER_QA",
  nextHandler: "HANDLER.ORCHESTRATOR_SPAWNER_QA",
  continuation: compileControllerContinuation("REQUEST_SPAWNER_QA"),
  persistence: {
    status: "PERSISTED",
    receipt_ref: "ref:observed-dispatch/source",
    receipt_sha256: sha("observed-source-receipt"),
    atomic: true,
    same_turn: true,
    write_scope: "CONTROL_PLANE_ONLY",
  },
  evidenceRefs: [evidence("EVIDENCE.OBSERVED.AUTHORITY"), evidence("EVIDENCE.OBSERVED.SOURCE")].sort((left, right) => compareUtf8(left.evidence_id, right.evidence_id)),
  hostileFixtureRefs: ["FIXTURE.OBSERVED.SOURCE.NO_APPROVAL", "FIXTURE.OBSERVED.SOURCE.NO_TIMER"].sort(compareUtf8),
});

const persisted = [];
const dispatchReadback = dispatchOrchestratorSuccessor({
  successor: source,
  dispatchId: "DISPATCH.OBSERVED.BINDING.TEST",
  handlers: {
    "HANDLER.ORCHESTRATOR_SPAWNER_QA": (current) => ({
      semantic_after_sha256: sha(`${current.semantic_after_sha256}:observed`),
      next_action: "WAIT_FOR_PROTECTED_EVENT",
      next_handler: "HANDLER.PROTECTED_EVENT_WAIT",
      continuation: compileControllerContinuation("WAIT_FOR_PROTECTED_EVENT", {protectedEventId: protectedEvent.blocker_id}),
      continuation_sha256: canonicalDigest(compileControllerContinuation("WAIT_FOR_PROTECTED_EVENT", {protectedEventId: protectedEvent.blocker_id})),
      evidence_refs: [evidence("EVIDENCE.OBSERVED.RESULT")],
      hostile_fixture_refs: ["FIXTURE.OBSERVED.RESULT.NO_TIMER", "FIXTURE.OBSERVED.RESULT.PROTECTED"].sort(compareUtf8),
      protected_event: protectedEvent,
      defect: null,
    }),
  },
  persist: (receipt) => { persisted.push(receipt); return true; },
});

const common = {
  sourceSuccessorSha256: source.record_sha256,
  sourceAction: source.next_action,
  evidenceRefs: [evidence("EVIDENCE.OBSERVED.AUTHORITY"), evidence("EVIDENCE.OBSERVED.DISPATCH")].sort((left, right) => compareUtf8(left.evidence_id, right.evidence_id)),
  hostileFixtureRefs: [
    "FIXTURE.OBSERVED.DISPATCH.HANDLER_FALSE",
    "FIXTURE.OBSERVED.DISPATCH.MISSING_READBACK",
    "FIXTURE.OBSERVED.DISPATCH.SOURCE_MISMATCH",
    "FIXTURE.OBSERVED.DISPATCH.STALE_HANDLER",
  ],
};

const pending = compileObservedDispatchSuccessorBinding({
  ...common,
  bindingId: "BINDING.OBSERVED.DISPATCH.PENDING",
});
validateObservedDispatchSuccessorBinding(pending);
assert.equal(pending.status, OBSERVED_DISPATCH_BINDING_REQUIRED_STATUS);
assert.equal(pending.progress_claimed, false);
assert.equal(pending.dispatch_readback, null);
assert.equal(pending.dispatch_observation, null);

const proven = compileObservedDispatchSuccessorBinding({
  ...common,
  bindingId: "BINDING.OBSERVED.DISPATCH.PROVEN",
  dispatchReadback,
});
validateObservedDispatchSuccessorBinding(proven);
publicValidate(proven);
assert.equal(proven.status, OBSERVED_DISPATCH_BINDING_PROVEN_STATUS);
assert.equal(proven.progress_claimed, true);
assert.equal(proven.dispatch_observation.handler_invoked, true);
assert.equal(proven.dispatch_observation.readback_sha256, dispatchReadback.readback_sha256);
assert.equal(persisted.length, 1);
assert.equal(typeof publicCompile, "function");
assert.equal(typeof publicCompileSource, "function");

const sourceSuccessor = compileObservedDispatchSourceSuccessor({
  binding: pending,
  actionId: pending.source_action,
  resultId: "RESULT.OBSERVED.DISPATCH.CANONICAL.SOURCE",
  result: {
    status: "DISPATCH_REQUESTED",
    controller_approval_required: false,
    execution_owner: "LANE_AGENT",
    direct_consumer: "INDEPENDENT_PLATFORM_REVIEW",
  },
  semanticBeforeSha256: sha("canonical-source-before"),
  semanticAfterSha256: sha("canonical-source-after"),
  receiptRef: "ref:observed-dispatch/canonical-source",
  receiptSha256: sha("canonical-source-receipt"),
  evidenceRefs: [evidence("EVIDENCE.CANONICAL.SOURCE")],
  hostileFixtureRefs: ["FIXTURE.CANONICAL.SOURCE.NO_CONTROLLER", "FIXTURE.CANONICAL.SOURCE.NO_TIMER"].sort(compareUtf8),
});
assert.equal(sourceSuccessor.next_action, pending.source_action);
assert.equal(sourceSuccessor.next_handler, pending.source_handler);
assert.equal(sourceSuccessor.continuation.same_turn_dispatch, true);
assert.equal(sourceSuccessor.persistence.same_turn, true);

const rejects = (mutator, pattern) => {
  const candidate = structuredClone(proven);
  mutator(candidate);
  assert.throws(() => validateObservedDispatchSuccessorBinding(candidate), pattern);
};
rejects((candidate) => {
  candidate.dispatch_readback = null;
}, /requires a dispatch readback/u);
rejects((candidate) => {
  candidate.dispatch_observation.handler_invoked = false;
  candidate.binding_sha256 = canonicalDigest({...candidate, binding_sha256: null});
}, /invocation is not proven/u);
rejects((candidate) => {
  candidate.dispatch_readback.dispatch_observed = false;
  candidate.dispatch_readback.readback_sha256 = canonicalDigest({...candidate.dispatch_readback, readback_sha256: null});
  candidate.dispatch_observation.readback_sha256 = candidate.dispatch_readback.readback_sha256;
  candidate.binding_sha256 = canonicalDigest({...candidate, binding_sha256: null});
}, /dispatch observation is missing/u);
rejects((candidate) => {
  candidate.dispatch_readback.source_successor_sha256 = sha("stale-source");
  candidate.dispatch_readback.readback_sha256 = canonicalDigest({...candidate.dispatch_readback, readback_sha256: null});
  candidate.dispatch_observation.readback_sha256 = candidate.dispatch_readback.readback_sha256;
  candidate.binding_sha256 = canonicalDigest({...candidate, binding_sha256: null});
}, /source successor is stale/u);
rejects((candidate) => {
  candidate.source_handler = "HANDLER.WRONG";
  candidate.binding_sha256 = canonicalDigest({...candidate, binding_sha256: null});
}, /not registry-bound/u);
rejects((candidate) => {
  candidate.progress_claimed = false;
  candidate.status = OBSERVED_DISPATCH_BINDING_REQUIRED_STATUS;
  candidate.binding_sha256 = canonicalDigest({...candidate, binding_sha256: null});
}, /cannot carry a readback/u);
rejects((candidate) => {
  candidate.controller_approval_required = true;
  candidate.binding_sha256 = canonicalDigest({...candidate, binding_sha256: null});
}, /Controller approval/u);
rejects((candidate) => {
  candidate.binding_sha256 = sha("tampered-binding");
}, /binding digest/u);
assert.throws(() => compileObservedDispatchSourceSuccessor({
  binding: proven,
  actionId: proven.source_action,
  resultId: "RESULT.OBSERVED.DISPATCH.BAD.PROVEN",
  result: {status: "BAD", controller_approval_required: false, execution_owner: "LANE_AGENT", direct_consumer: "INDEPENDENT_PLATFORM_REVIEW"},
  semanticBeforeSha256: sha("bad-before"), semanticAfterSha256: sha("bad-after"),
  receiptRef: "ref:bad/source", receiptSha256: sha("bad-receipt"), evidenceRefs: [evidence("EVIDENCE.BAD")], hostileFixtureRefs: ["FIXTURE.BAD"],
}), /pending binding/u);
assert.throws(() => compileObservedDispatchSourceSuccessor({
  binding: pending,
  actionId: "START_INDEPENDENT_REAUDIT",
  resultId: "RESULT.OBSERVED.DISPATCH.BAD.ACTION",
  result: {status: "BAD", controller_approval_required: false, execution_owner: "LANE_AGENT", direct_consumer: "INDEPENDENT_PLATFORM_REVIEW"},
  semanticBeforeSha256: sha("bad-action-before"), semanticAfterSha256: sha("bad-action-after"),
  receiptRef: "ref:bad/action", receiptSha256: sha("bad-action-receipt"), evidenceRefs: [evidence("EVIDENCE.BAD.ACTION")], hostileFixtureRefs: ["FIXTURE.BAD.ACTION"],
}), /action ID/u);
assert.throws(() => compileObservedDispatchSourceSuccessor({
  binding: pending,
  actionId: pending.source_action,
  resultId: "RESULT.OBSERVED.DISPATCH.BAD.CUSTODY",
  result: {status: "BAD", controller_approval_required: true, execution_owner: "LANE_AGENT", direct_consumer: "INDEPENDENT_PLATFORM_REVIEW"},
  semanticBeforeSha256: sha("bad-custody-before"), semanticAfterSha256: sha("bad-custody-after"),
  receiptRef: "ref:bad/custody", receiptSha256: sha("bad-custody-receipt"), evidenceRefs: [evidence("EVIDENCE.BAD.CUSTODY")], hostileFixtureRefs: ["FIXTURE.BAD.CUSTODY"],
}), /Controller approval/u);

const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "../schemas/observed-dispatch-binding-gate.v1.json");
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
assert.deepEqual(schema.required, [
  "schema", "version", "binding_id", "status", "source_successor_sha256", "source_action", "source_handler",
  "execution_owner", "direct_consumer", "controller_approval_required", "same_turn_dispatch", "progress_claimed",
  "dispatch_readback", "dispatch_observation", "evidence_refs", "hostile_fixture_refs", "binding_sha256",
]);
assert.equal(schema.properties.progress_claimed.type, "boolean");
assert.equal(schema.properties.execution_owner.const, "LANE_AGENT");
assert.equal(schema.properties.direct_consumer.const, "INDEPENDENT_PLATFORM_REVIEW");
const readbackSchema = schema.properties.dispatch_readback.oneOf.find((entry) => entry.type === "object");
assert(readbackSchema, "schema must define the dispatch readback object");
assert(readbackSchema.additionalProperties === false, "dispatch readback schema must reject placeholders and unknown fields");
assert(readbackSchema.required.includes("dispatch_observed"), "dispatch readback schema must require observed dispatch");
assert(readbackSchema.required.includes("readback_sha256"), "dispatch readback schema must require its digest");
assert(readbackSchema.properties.dispatch_observed.const === true, "dispatch readback schema must fail closed on unobserved dispatch");

console.log("PASS observed dispatch successor binding gate: registry-bound handler invocation/readback required for same-turn progress, pending routes remain unclaimed, and hostile cross-binding/custody coverage rejects false claims");
