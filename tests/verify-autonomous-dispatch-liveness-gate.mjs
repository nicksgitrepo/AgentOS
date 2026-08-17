#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {
  AUTONOMOUS_DISPATCH_RETRY_ACTION,
  AUTONOMOUS_DISPATCH_RETRY_HANDLER,
  compileAutonomousDispatchLivenessGate,
  evaluateAutonomousDispatchLiveness,
  validateAutonomousDispatchLivenessGate,
} from "../control/autonomous-dispatch-liveness-gate.mjs";

const sha = (value) => canonicalDigest({value});
const evidence = (id, value = id) => ({evidence_id: id, reference: `opaque:${id.toLowerCase()}`, sha256: sha(value)});
const authorityBinding = {
  authority_commit: "a".repeat(40),
  authority_tree: "b".repeat(40),
  authority_receipt_ref: "ref:authority/current",
  authority_receipt_sha256: sha("authority-receipt"),
  source_mapping_sha256: sha("source-mapping"),
};
const sourceHandoff = {
  handoff_ref: "ref:control-plane/autonomous-handoff/6a1f64e",
  handoff_sha256: sha("handoff"),
  handoff_status: "READY_FOR_INDEPENDENT_CONSUMPTION",
  expected_next_action: "START_PLATFORM_REVIEW",
  expected_next_handler: "HANDLER.ORCHESTRATOR_PLATFORM_REVIEW",
  direct_consumer: "INDEPENDENT_PLATFORM_REVIEW",
  controller_approval_required: false,
  same_turn_dispatch: true,
  lane_execution: "AUTONOMOUS_TYPED_HANDOFF",
};
const expectedDispatch = {
  action: "START_PLATFORM_REVIEW",
  handler: "HANDLER.ORCHESTRATOR_PLATFORM_REVIEW",
  direct_consumer: "INDEPENDENT_PLATFORM_REVIEW",
  same_turn_dispatch: true,
  registered: true,
};
const turnWindow = {
  start_at_utc: "2026-08-17T12:00:00Z",
  observed_at_utc: "2026-08-17T12:05:01Z",
  elapsed_seconds: 301,
  threshold_seconds: 300,
  overlong: true,
  measurement_ref: "ref:control-plane/defect/dispatch-missing",
};
const scope = {
  control_plane_only: true,
  consumer_product_mutated: false,
  provider_access: false,
  credential_access: false,
  external_sync: false,
  spend: false,
  destructive_work: false,
  deployment: false,
  publication: false,
  merge: false,
  protected_event_id: null,
  timers: 0,
  polling: false,
};
const evidenceRefs = [
  evidence("EVIDENCE.AUTHORITY.CURRENT"),
  evidence("EVIDENCE.CUSTODY.RECEIPT"),
  evidence("EVIDENCE.DISPATCH.MISSING"),
  evidence("EVIDENCE.VALID.HANDOFF"),
].sort((left, right) => left.evidence_id.localeCompare(right.evidence_id));
const hostileFixtureRefs = [
  "FIXTURE.DISPATCH.COMMENTARY_ONLY",
  "FIXTURE.DISPATCH.MISSING_HANDLER_INVOCATION",
  "FIXTURE.DISPATCH.MISSING_READBACK",
  "FIXTURE.DISPATCH.NULL_DIGEST",
  "FIXTURE.DISPATCH.PLACEHOLDER_DIGEST",
  "FIXTURE.DISPATCH.STALE_HANDLER",
  "FIXTURE.DISPATCH.TIMER_ONLY",
  "FIXTURE.DISPATCH.UNREGISTERED_HANDLER",
].sort();
const retryCheckpoint = {
  schema: "agentos.typed_retry_checkpoint.v1",
  version: 1,
  checkpoint_id: "CHECKPOINT.ORCHESTRATOR.DISPATCH.MISSING.001",
  status: "RETRY_REQUIRED",
  reason_code: "MISSING_REGISTERED_HANDLER_INVOCATION_OR_READBACK",
  next_action: AUTONOMOUS_DISPATCH_RETRY_ACTION,
  next_handler: AUTONOMOUS_DISPATCH_RETRY_HANDLER,
  direct_consumer: "INDEPENDENT_PLATFORM_REVIEW",
  controller_approval_required: false,
  lane_execution: "AUTONOMOUS_TYPED_HANDOFF",
  same_turn_dispatch: true,
  persistence: {
    receipt_ref: "ref:control-plane/autonomous-dispatch-liveness/retry-001",
    receipt_sha256: sha("retry-receipt"),
    atomic: true,
    same_turn: true,
    write_scope: "CONTROL_PLANE_ONLY",
  },
  checkpoint_sha256: null,
};

const retryGate = compileAutonomousDispatchLivenessGate({
  gateId: "GATE.WORKFLOW.ORCHESTRATOR.DISPATCH.LIVENESS.001",
  defectId: "DEFECT.WORKFLOW.ORCHESTRATOR.DISPATCH.MISSING.001",
  turnWindow,
  sourceHandoff,
  expectedDispatch,
  authorityBinding,
  scope,
  evidenceRefs,
  hostileFixtureRefs,
  retryCheckpoint,
});
validateAutonomousDispatchLivenessGate(retryGate);
assert.equal(retryGate.status, "RETRY_REQUIRED");
assert.equal(retryGate.observed_dispatch, null);
assert.equal(retryGate.retry_checkpoint.next_action, "REPAIR_BLOCKS");
assert.equal(retryGate.commentary_only, false);
assert.deepEqual(evaluateAutonomousDispatchLiveness({retryCheckpoint: retryGate.retry_checkpoint}), {
  status: "RETRY_REQUIRED",
  next_action: "REPAIR_BLOCKS",
  durable_readback: true,
  commentary_only: false,
});

const observedDispatch = {
  status: "OBSERVED",
  invocation_ref: "ref:orchestrator/invocation/start-platform-review",
  invocation_sha256: sha("invocation"),
  action: expectedDispatch.action,
  handler: expectedDispatch.handler,
  direct_consumer: expectedDispatch.direct_consumer,
  invoked: true,
  same_turn_dispatch: true,
  result_ref: "ref:control-plane/orchestrator/start-platform-review/result",
  result_sha256: sha("result"),
  readback_ref: "ref:control-plane/orchestrator/start-platform-review/readback",
  readback_sha256: sha("readback"),
  readback_status: "DISPATCHED_SAME_TURN",
};
const passGate = compileAutonomousDispatchLivenessGate({
  gateId: "GATE.WORKFLOW.ORCHESTRATOR.DISPATCH.LIVENESS.002",
  defectId: "DEFECT.WORKFLOW.ORCHESTRATOR.DISPATCH.MISSING.002",
  turnWindow,
  sourceHandoff,
  expectedDispatch,
  observedDispatch,
  authorityBinding,
  scope,
  evidenceRefs,
  hostileFixtureRefs,
});
validateAutonomousDispatchLivenessGate(passGate);
assert.equal(passGate.status, "PASS");
assert.equal(passGate.retry_checkpoint, null);
assert.deepEqual(evaluateAutonomousDispatchLiveness({observedDispatch}), {
  status: "PASS",
  next_action: "CONTINUE_NEXT_ACTION",
  durable_readback: true,
  commentary_only: false,
});

const rejects = (mutator, pattern) => {
  const candidate = structuredClone(retryGate);
  mutator(candidate);
  assert.throws(() => validateAutonomousDispatchLivenessGate(candidate), pattern);
};
rejects((candidate) => { candidate.retry_checkpoint = null; }, /exactly one observed dispatch or retry checkpoint/u);
rejects((candidate) => { candidate.observed_dispatch = structuredClone(observedDispatch); }, /exactly one observed dispatch or retry checkpoint/u);
rejects((candidate) => { candidate.commentary_only = true; }, /Commentary-only/u);
rejects((candidate) => { candidate.turn_window.elapsed_seconds = 300; }, /overlong decision|applies only/u);
rejects((candidate) => { candidate.retry_checkpoint.same_turn_dispatch = false; }, /same-turn/u);
rejects((candidate) => { candidate.retry_checkpoint.persistence.atomic = false; }, /atomic/u);
rejects((candidate) => { candidate.retry_checkpoint.checkpoint_sha256 = "0".repeat(64); }, /placeholder digest/u);
rejects((candidate) => { candidate.retry_checkpoint.next_handler = "HANDLER.PROTECTED_EVENT_WAIT"; }, /block repair/u);
rejects((candidate) => { candidate.source_handoff.direct_consumer = "CONTROLLER"; }, /direct consumer/u);
rejects((candidate) => { candidate.scope.timers = 1; }, /timer/u);
rejects((candidate) => { candidate.gate_sha256 = sha("tampered-gate"); }, /gate digest/u);

const missingReadback = structuredClone(passGate);
missingReadback.observed_dispatch.readback_sha256 = null;
assert.throws(() => validateAutonomousDispatchLivenessGate(missingReadback), /readback digest/u);
const wrongHandler = structuredClone(passGate);
wrongHandler.observed_dispatch.handler = "HANDLER.WRONG";
assert.throws(() => validateAutonomousDispatchLivenessGate(wrongHandler), /handler diverges/u);
const unregistered = structuredClone(passGate);
unregistered.expected_dispatch.registered = false;
assert.throws(() => validateAutonomousDispatchLivenessGate(unregistered), /not registered/u);
const commentaryOnly = structuredClone(passGate);
commentaryOnly.observed_dispatch = null;
commentaryOnly.retry_checkpoint = null;
commentaryOnly.status = "RETRY_REQUIRED";
commentaryOnly.gate_sha256 = canonicalDigest({...commentaryOnly, gate_sha256: null});
assert.throws(() => validateAutonomousDispatchLivenessGate(commentaryOnly), /exactly one observed dispatch or retry checkpoint/u);

const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "../schemas/autonomous-dispatch-liveness-gate.v1.json");
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
assert.deepEqual(schema.required, [
  "schema", "version", "gate_id", "defect_id", "turn_window", "source_handoff", "expected_dispatch",
  "observed_dispatch", "retry_checkpoint", "lane_execution", "direct_consumer", "controller_approval_required",
  "commentary_only", "authority_binding", "scope", "evidence_refs", "hostile_fixture_refs", "status", "gate_sha256",
]);
assert.equal(schema.properties.expected_dispatch.properties.registered.const, true);
const retrySchema = schema.properties.retry_checkpoint.oneOf.find((candidate) => candidate.type === "object");
assert.equal(retrySchema.properties.next_action.const, "REPAIR_BLOCKS");
assert.equal(schema.properties.scope.properties.control_plane_only.const, true);

console.log("PASS autonomous dispatch liveness gate: same-turn registered invocation/readback, durable retry checkpoint, overlong detection, commentary/timer/protected-boundary rejection, and hostile digest coverage");
