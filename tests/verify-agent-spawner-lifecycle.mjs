#!/usr/bin/env node

import assert from "node:assert/strict";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {
  advanceAgentSpawnerLifecycle,
  compileAgentSpawnerLifecycle,
  AGENT_SPAWNER_PROTECTED_HOLD_EVENT_SHA256,
  runAgentSpawnerCompilerTick,
  validateAgentSpawnerLifecycle,
  AGENT_SPAWNER_STORAGE_GOVERNANCE_SCHEMA,
  AGENT_SPAWNER_STORAGE_HOSTILE_FIXTURE_REFS,
  AGENT_SPAWNER_STORAGE_POLICY,
  compileControllerStorageDecision,
  validateControllerStorageDecision,
  compileAgentSpawnerRoutingReceipt,
  validateAgentSpawnerRoutingReceipt,
  finalizeAgentSpawnerRoutingReceipt,
  compileAgentSpawnerRoutingRoutePayload,
  validateAgentSpawnerRouteConsumer,
  correctAgentSpawnerRoutingReceipt,
  AGENT_SPAWNER_ROUTING_RECEIPT_PROVENANCE_BLOCKER,
  AGENT_SPAWNER_ROUTING_HOSTILE_FIXTURE_REFS,
  recordAgentSpawnerAtomicAdmission,
} from "../control/agent-spawner-lifecycle.mjs";
import fs from "node:fs";
import path from "node:path";

const HASH = (value) => canonicalDigest({value});
const lifecycleFixtureCwd = path.resolve("fixture-project");
const common = {
  lifecycleId: "LIFECYCLE.SPAWNER.CURRENT",
  candidateSha256: HASH("candidate"),
  rosterProjectionSha256: HASH("projection"),
  contextSha256: HASH("context"),
};
const pendingQa = {
  status: "STATIC_PASS_REVIEW_REQUIRED",
  complete_block_count: 148,
  incomplete_block_count: 0,
  pending_route_count: 0,
  independent_clearance_status: "PENDING_EXTERNAL_AUTHORITY",
  independent_clearance_receipt_sha256: null,
};
const clearedQa = {
  ...pendingQa,
  status: "INDEPENDENT_PASS",
  independent_clearance_status: "CLEARED",
  independent_clearance_receipt_sha256: HASH("clearance"),
};

const prepared = compileAgentSpawnerLifecycle({...common, state: "PREPARED", qa: pendingQa});
assert.equal(prepared.persistent_state, "PREPARED");
assert.equal(prepared.mode, "COMPILER_ONLY");
assert.equal(prepared.wave_activation, "OFF");

const compilerOnly = compileAgentSpawnerLifecycle({
  ...common,
  lifecycleId: "LIFECYCLE.SPAWNER.COMPILER_ONLY",
  state: "COMPILER_ACTIVE",
  qa: {...pendingQa, incomplete_block_count: 1, status: "NOT_READY"},
});
assert.equal(compilerOnly.persistent_state, "COMPILER_ACTIVE");
assert.equal(compilerOnly.mode, "COMPILER_ONLY");
assert.equal(compilerOnly.wave_activation, "OFF");
let compiled = 0;
const tick = runAgentSpawnerCompilerTick(compilerOnly, {
  onCompileBlock: (request) => {
    compiled += 1;
    assert.equal(request.product_mutation, false);
    assert.equal(request.spawn_authority, false);
    const after = advanceAgentSpawnerLifecycle(compilerOnly, {
      event_type: "BLOCK_LIBRARY_UPDATED",
      event_sha256: canonicalDigest({event_type: "BLOCK_LIBRARY_UPDATED", event_sha256: null}),
    });
    after.qa.incomplete_block_count = 0;
    after.qa.status = "STATIC_PASS_REVIEW_REQUIRED";
    after.next_action = "ADMIT_GOVERNED_SPAWN";
    after.lifecycle_sha256 = canonicalDigest({...after, lifecycle_sha256: null});
    return {
      outcome: "BLOCK_COMPILED",
      lifecycle_after: after,
      evidence_refs: [{evidence_id: "EVIDENCE.BLOCK.CANDIDATE", reference: `opaque:block:${HASH("block-evidence")}`, sha256: HASH("block-evidence")}],
      hostile_fixture_refs: ["FIXTURE.BLOCK.INCOMPLETE", "FIXTURE.BLOCK.STALE_SOURCE"],
    };
  },
});
assert.equal(compiled, 1);
assert.equal(tick.outcome, "BLOCK_COMPILED");
assert.equal(tick.next_action, "ADMIT_GOVERNED_SPAWN");
assert.equal(tick.continuation.same_turn_next_action, true);
assert.equal(tick.admission.spawnable, false);

const completePendingCompiler = compileAgentSpawnerLifecycle({
  ...common,
  lifecycleId: "LIFECYCLE.SPAWNER.COMPILER_ONLY.COMPLETE_PENDING",
  state: "COMPILER_ACTIVE",
  qa: pendingQa,
});
assert.equal(completePendingCompiler.next_action, "ADMIT_GOVERNED_SPAWN", "compiler-only local QA must not stop on external clearance");

const admitted = compileAgentSpawnerLifecycle({
  ...common,
  lifecycleId: "LIFECYCLE.SPAWNER.ADMITTED",
  mode: "GOVERNED_SPAWN",
  state: "SPAWN_ADMITTED",
  qa: clearedQa,
});
assert.equal(admitted.persistent_state, "ADMITTED");
assert.equal(admitted.wave_activation, "OFF");
assert.equal(admitted.authority.spawn_authority, true);

assert.throws(() => compileAgentSpawnerLifecycle({
  ...common,
  lifecycleId: "LIFECYCLE.SPAWNER.UNPUBLISHED_ROSTER",
  mode: "GOVERNED_SPAWN",
  state: "SPAWN_ADMITTED",
  qa: {...clearedQa, pending_route_count: 1},
}), /pending roster route|published roster/u, "Spawner cannot admit workers before the roster is published");

// Local pyramid audit/repair may be admitted without external utility/harm
// clearance when custody is isolated, product/provider/external authority is
// false, and the resource ceiling is enforced.  This is ordinary reversible
// development work, not a protected release or provider route.
const isolatedLocal = compileAgentSpawnerLifecycle({
  ...common,
  lifecycleId: "LIFECYCLE.SPAWNER.ISOLATED_LOCAL",
  mode: "GOVERNED_SPAWN",
  isolatedLocalCustody: true,
  qa: pendingQa,
});
assert.equal(isolatedLocal.state, "SPAWN_ADMITTED");
assert.equal(isolatedLocal.authority.isolated_local_custody, true);
const atomicTransition = recordAgentSpawnerAtomicAdmission(isolatedLocal, {
  schema: "agentos.agent_spawner_atomic_admission.v1",
  version: 1,
  status: "ADMITTED",
  environment: "local",
  task_id: "TASK-GOV02-LIFECYCLE",
  role_id: "AGENT.GOV02.ATOMIC",
  role_kind: "ATOMIC_SPECIALIST",
  project_id: "PROJECT-GOV02",
  cwd: lifecycleFixtureCwd,
  worktree: path.join(lifecycleFixtureCwd, "gov02-fixture"),
  custody_ref: "ref:custody/gov02",
  model: "gpt-5.6-luna",
  reasoning_effort: "max",
  queue: "GOV-02-ATOMIC-SPAWNER-ADMISSION",
  seam: "GOV-02",
  substantive_prompt_sent: false,
  process_started: false,
  cleanup_action: "NONE",
  retry_allowed: false,
  material_transition: "ADMISSION_RECORDED_NEXT_GOVERNED_ACTION",
});
assert.equal(atomicTransition.status, "ATOMIC_ADMISSION_RECORDED");
assert.equal(atomicTransition.next_action, "START_GOVERNED_SPAWN");
assert.equal(atomicTransition.substantive_work_started, false);
assert.throws(() => recordAgentSpawnerAtomicAdmission(isolatedLocal, {
  schema: "agentos.agent_spawner_atomic_admission.v1", version: 1, status: "ADMITTED", environment: "local",
  task_id: "TASK-GOV02-LIFECYCLE", role_id: "AGENT.GOV02.ATOMIC", role_kind: "ATOMIC_SPECIALIST", project_id: "PROJECT-GOV02",
  cwd: "/", worktree: path.join(lifecycleFixtureCwd, "gov02-fixture"), custody_ref: "ref:custody/gov02",
  model: "gpt-5.6-luna", reasoning_effort: "max", queue: "GOV-02-ATOMIC-SPAWNER-ADMISSION", seam: "GOV-02",
  substantive_prompt_sent: false, process_started: false, cleanup_action: "NONE", retry_allowed: false,
  material_transition: "ADMISSION_RECORDED_NEXT_GOVERNED_ACTION",
}), /cwd/u);
assert.equal(isolatedLocal.authority.spawn_authority, true);
assert.equal(isolatedLocal.wave_activation, "OFF");
const isolatedActive = advanceAgentSpawnerLifecycle(isolatedLocal, {
  event_type: "START_GOVERNED_SPAWN",
  event_sha256: canonicalDigest({event_type: "START_GOVERNED_SPAWN", event_sha256: null}),
});
assert.equal(isolatedActive.state, "SPAWN_ACTIVE");
assert.equal(isolatedActive.wave_activation, "ON");
assert.equal(isolatedActive.authority.isolated_local_custody, true);

const active = compileAgentSpawnerLifecycle({
  ...common,
  lifecycleId: "LIFECYCLE.SPAWNER.ACTIVE",
  mode: "GOVERNED_SPAWN",
  state: "SPAWN_ACTIVE",
  waveActivation: "ON",
  qa: clearedQa,
  execution: {compiler_ticks: 0, active_worker_count: 0, scheduler_job_count: 0, heavyweight_process_count: 0, timer_count: 0, polling: false},
});
assert.equal(active.persistent_state, "ACTIVE");
assert.equal(active.wave_activation, "ON");

const stalled = compileAgentSpawnerLifecycle({
  ...common,
  mode: "GOVERNED_SPAWN",
  lifecycleId: "LIFECYCLE.SPAWNER.STALLED",
  state: "STALLED",
  protectedHoldEventSha256: AGENT_SPAWNER_PROTECTED_HOLD_EVENT_SHA256,
  qa: pendingQa,
});
assert.equal(stalled.persistent_state, "STALLED");
assert.equal(stalled.mode, "GOVERNED_SPAWN");
assert.equal(stalled.wave_activation, "OFF");
assert.equal(stalled.authority.temporary_worker_admission, false);
assert.equal(stalled.authority.spawn_authority, false);
assert.deepEqual(stalled.execution, {compiler_ticks: 0, active_worker_count: 0, scheduler_job_count: 0, heavyweight_process_count: 0, timer_count: 0, polling: false});
assert.throws(() => compileAgentSpawnerLifecycle({
  ...common,
  mode: "GOVERNED_SPAWN",
  lifecycleId: "LIFECYCLE.SPAWNER.UNBOUND_STALLED",
  state: "STALLED",
  qa: pendingQa,
}), /protected hold receipt/u, "Spawner cannot be stalled without a typed protected-hold receipt");

const resumedCompiler = advanceAgentSpawnerLifecycle(prepared, {
  event_type: "START_COMPILER",
  event_sha256: canonicalDigest({event_type: "START_COMPILER", event_sha256: null}),
});
assert.equal(resumedCompiler.state, "COMPILER_ACTIVE");
assert.equal(resumedCompiler.persistent_state, "COMPILER_ACTIVE");
assert.equal(resumedCompiler.mode, "COMPILER_ONLY");
assert.throws(() => compileAgentSpawnerLifecycle({
  ...common,
  lifecycleId: "LIFECYCLE.SPAWNER.COMPILER_ONLY.STALLED",
  state: "STALLED",
  protectedHoldEventSha256: AGENT_SPAWNER_PROTECTED_HOLD_EVENT_SHA256,
  qa: pendingQa,
}), /cannot enter a protected stall/u, "compiler-only Spawner cannot park behind a protected hold");

assert.throws(() => advanceAgentSpawnerLifecycle(compilerOnly, {
  event_type: "PROTECTED_HOLD",
  event_sha256: canonicalDigest({event_type: "PROTECTED_HOLD", event_sha256: null}),
}), /cannot enter a protected hold/u, "compiler-only Spawner cannot be parked by an external hold event");

const retired = advanceAgentSpawnerLifecycle(active, {
  event_type: "RETIRE",
  event_sha256: canonicalDigest({event_type: "RETIRE", event_sha256: null}),
});
assert.equal(retired.state, "RETIRED");
assert.equal(retired.persistent_state, "RETIRED", "retirement must not be persisted as an active/stalled state");
assert.equal(retired.next_action, "NONE", "retirement is an explicit terminal lifecycle record, not an unexplained idle");
assert.equal(retired.execution.active_worker_count, 0);
assert.equal(retired.execution.scheduler_job_count, 0);
assert.equal(retired.execution.heavyweight_process_count, 0);
assert.equal(retired.execution.timer_count, 0);
assert.equal(retired.execution.polling, false);
assert.throws(() => advanceAgentSpawnerLifecycle(retired, {
  event_type: "START_COMPILER",
  event_sha256: canonicalDigest({event_type: "START_COMPILER", event_sha256: null}),
}), /compiler-only mode|current state/u, "retired Spawner cannot silently re-enter the workflow");

const retiredWithStalledProjection = structuredClone(retired);
retiredWithStalledProjection.persistent_state = "STALLED";
retiredWithStalledProjection.lifecycle_sha256 = canonicalDigest({...retiredWithStalledProjection, lifecycle_sha256: null});
assert.throws(() => validateAgentSpawnerLifecycle(retiredWithStalledProjection), /persistent lifecycle state is not bound/u, "retirement cannot masquerade as a stalled hold");

const fakeActivePending = structuredClone(stalled);
fakeActivePending.persistent_state = "ACTIVE";
fakeActivePending.lifecycle_sha256 = canonicalDigest({...fakeActivePending, lifecycle_sha256: null});
assert.throws(
  () => validateAgentSpawnerLifecycle(fakeActivePending),
  /persistent lifecycle state is not bound|Pending utility\/harm/u,
  "pending utility/harm must reject an active persistent Spawner claim",
);

const fakeWave = structuredClone(stalled);
fakeWave.wave_activation = "ON";
fakeWave.lifecycle_sha256 = canonicalDigest({...fakeWave, lifecycle_sha256: null});
assert.throws(
  () => validateAgentSpawnerLifecycle(fakeWave),
  /Pending utility\/harm must keep governed activation off/u,
  "pending utility/harm must reject wave activation",
);

const fakeAdmission = structuredClone(compilerOnly);
fakeAdmission.authority.temporary_worker_admission = true;
fakeAdmission.lifecycle_sha256 = canonicalDigest({...fakeAdmission, lifecycle_sha256: null});
assert.throws(
  () => validateAgentSpawnerLifecycle(fakeAdmission),
  /Compiler-only Spawner cannot admit or spawn workers/u,
  "compiler-only Spawner must reject temporary admission",
);

const clearedStall = structuredClone(stalled);
clearedStall.qa.independent_clearance_status = "CLEARED";
clearedStall.qa.independent_clearance_receipt_sha256 = HASH("clearance");
clearedStall.lifecycle_sha256 = canonicalDigest({...clearedStall, lifecycle_sha256: null});
assert.throws(
  () => validateAgentSpawnerLifecycle(clearedStall),
  /requires a pending external decision/u,
  "a cleared governed Spawner cannot masquerade as a protected wait",
);

const queuedStall = structuredClone(stalled);
queuedStall.qa.pending_route_count = 1;
queuedStall.lifecycle_sha256 = canonicalDigest({...queuedStall, lifecycle_sha256: null});
assert.throws(
  () => validateAgentSpawnerLifecycle(queuedStall),
  /cannot hide local block or roster work/u,
  "a protected Spawner hold cannot hide queued local work",
);

console.log("PASS Agent Spawner lifecycle: persistent PREPARED/QA_READY/COMPILER_ACTIVE/ADMITTED/ACTIVE/STALLED/RETIRED state, compiler-only safe mode, separate wave activation, and hostile gate checks");

const storageAt = (freeGib, options = {}) => compileControllerStorageDecision({
  receiptId: `STORAGE.CHECK.${String(freeGib).replaceAll(".", "_")}`,
  observedAtUtc: options.observedAtUtc ?? "2026-08-25T00:00:00.000Z",
  freeGib,
  ...options,
});

const ordinary79 = storageAt(79);
assert.equal(ordinary79.schema, AGENT_SPAWNER_STORAGE_GOVERNANCE_SCHEMA);
assert.equal(ordinary79.threshold_class, "BELOW_CLEANUP_TARGET");
assert.equal(ordinary79.current_issue.work_allowed, true, "79 GiB ordinary compile/test must not stall");
assert.equal(ordinary79.current_issue.storage_heavy_work_allowed, true);
assert.equal(ordinary79.current_issue.finish_verify_freeze_handoff_required, true);
assert.equal(ordinary79.next_issue.allowed, false);
assert.equal(ordinary79.next_issue.admission, "DENY_DURING_CLEANUP");
assert.equal(ordinary79.cleanup.action, "CONTROLLER_RUNS_CUSTODY_SAFE_CLEANUP_TOWARD_80_TO_100_GIB");

const withinTarget = storageAt(80);
assert.equal(withinTarget.threshold_class, "CLEANUP_TARGET");
assert.equal(withinTarget.next_issue.allowed, true);
assert.equal(withinTarget.cleanup.required, false);

const warning50 = storageAt(50);
assert.equal(warning50.threshold_class, "OWNER_WARNING");
assert.equal(warning50.cleanup.owner_alert, true);
assert.equal(warning50.current_issue.work_allowed, true, "50 GiB warning must not be an early hard stop");
assert.equal(warning50.current_issue.storage_heavy_work_allowed, true);

const hard25 = storageAt(25);
assert.equal(hard25.threshold_class, "HARD_FLOOR");
assert.equal(hard25.current_issue.work_allowed, false);
assert.equal(hard25.current_issue.storage_heavy_work_allowed, false);
assert.equal(hard25.current_issue.finish_verify_freeze_handoff_required, true);
assert.equal(hard25.next_issue.admission, "DENY_HARD_OPERATING_FLOOR");
assert.equal(hard25.cleanup.action, "ALERT_OWNER_AND_WAIT_FOR_RECOVERY_AUTHORITY");

const cleanupFailed = storageAt(40, {currentIssueCustody: "FROZEN", cleanupAttempted: true, cleanupReachedTarget: false, cleanupFailed: true});
assert.equal(cleanupFailed.cleanup.owner_alert, true);
assert.equal(cleanupFailed.cleanup.resume_above_gib, 25);
assert.equal(cleanupFailed.next_issue.allowed, false);
assert.throws(() => compileControllerStorageDecision({
  receiptId: "STORAGE.CHECK.ACTIVE_CUSTODY",
  observedAtUtc: "2026-08-25T00:00:00.000Z",
  freeGib: 79,
  currentIssueCustody: "ACTIVE",
  cleanupAttempted: true,
}), /Ambiguous or active custody cleanup/u);

assert.throws(() => compileControllerStorageDecision({
  receiptId: "STORAGE.CHECK.ORDINARY_AGENT",
  observedAtUtc: "2026-08-25T00:00:00.000Z",
  freeGib: 79,
  actorRole: "AGENT",
}), /Only the Controller|repeated storage polling/u);
assert.throws(() => compileControllerStorageDecision({
  receiptId: "STORAGE.CHECK.POLL",
  observedAtUtc: "2026-08-25T00:00:00.000Z",
  freeGib: 79,
  storagePoll: true,
}), /repeated storage polling/u);
assert.throws(() => compileControllerStorageDecision({
  receiptId: "STORAGE.CHECK.AMBIGUOUS",
  observedAtUtc: "2026-08-25T00:00:00.000Z",
  freeGib: 79,
  currentIssueCustody: "AMBIGUOUS",
  cleanupAttempted: true,
}), /Ambiguous or active custody cleanup/u);
assert.throws(() => compileControllerStorageDecision({
  receiptId: "STORAGE.CHECK.NEXT",
  observedAtUtc: "2026-08-25T00:00:00.000Z",
  freeGib: 79,
  nextIssueRequested: true,
}), /Next issue admission/u);

const nextDaily = compileControllerStorageDecision({
  receiptId: "STORAGE.CHECK.NEXT_DAY",
  observedAtUtc: "2026-08-26T00:00:00.000Z",
  freeGib: 79,
  previousReceiptSha256: ordinary79.receipt_sha256,
  previousReceipt: ordinary79,
});
validateControllerStorageDecision(nextDaily, {previousReceipt: ordinary79});
assert.throws(() => compileControllerStorageDecision({
  receiptId: "STORAGE.CHECK.DUPLICATE",
  observedAtUtc: ordinary79.observed_at_utc,
  freeGib: 79,
  previousReceipt: ordinary79,
}), /duplicated or too early/u);
const historical = structuredClone(ordinary79);
historical.free_gib = 100;
historical.threshold_class = "CLEANUP_TARGET";
historical.receipt_sha256 = canonicalDigest({...historical, receipt_sha256: null});
assert.throws(() => validateControllerStorageDecision(historical, {previousReceipt: ordinary79}), /parent is stale|too early/u);

const lifecycleSchema = JSON.parse(fs.readFileSync(new URL("../schemas/agent-spawner-lifecycle.v1.json", import.meta.url), "utf8"));
assert.equal(lifecycleSchema.$defs.storage_decision.properties.policy.properties.cleanup_target_free_gib.properties.minimum.const, 80);
assert.equal(lifecycleSchema.$defs.storage_decision.properties.policy.properties.hard_operating_floor_at_or_below_free_gib.const, 25);
assert.deepEqual(lifecycleSchema.$defs.storage_decision.properties.hostile_fixture_refs.const, AGENT_SPAWNER_STORAGE_HOSTILE_FIXTURE_REFS);
assert.deepEqual(AGENT_SPAWNER_STORAGE_POLICY.cleanup_target_free_gib, {minimum: 80, maximum: 100, work_stopping_floor: false});

console.log(`PASS Controller storage decision tree: ${AGENT_SPAWNER_STORAGE_HOSTILE_FIXTURE_REFS.length} hostile cases, 79 GiB ordinary work, <=50 GiB warning, <=25 GiB hard floor, daily exactly-once and custody-safe cleanup`);

// Audit-routing receipts are finalized before a route payload is emitted.  The
// consumer must hash the exact final bytes it receives; a self-consistent
// payload digest is not sufficient evidence when the referenced bytes changed.
const routingBytes = Buffer.from('{"schema":"opaque.audit.v1","status":"PASS"}\n', "utf8");
const routingBytesChanged = Buffer.from('{"schema":"opaque.audit.v1","status":"CORRECTED"}\n', "utf8");
const routingReceipt = compileAgentSpawnerRoutingReceipt({
  routingReceiptId: "ROUTING.RECEIPT.CURRENT",
  routeId: "ROUTING.ROUTE.CURRENT",
  recipientRef: "opaque:auditor:independent",
  receiptPath: "opaque:receipt:routing-current",
  finalReceiptRef: "opaque:receipt:audit-final",
  finalReceiptBytes: routingBytes,
});
assert.equal(routingReceipt.final_receipt_bytes_verified, true);
assert.deepEqual(routingReceipt.hostile_fixture_refs, AGENT_SPAWNER_ROUTING_HOSTILE_FIXTURE_REFS);
validateAgentSpawnerRoutingReceipt(routingReceipt);
const routePayload = compileAgentSpawnerRoutingRoutePayload(routingReceipt);
assert.deepEqual(
  validateAgentSpawnerRouteConsumer({receipt: routingReceipt, routePayload, finalReceiptBytes: routingBytes}),
  {
    accepted: true,
    status: "ROUTING_RECEIPT_CONSUMER_VERIFIED",
    receipt_sha256: routingReceipt.receipt_sha256,
    final_receipt_bytes_sha256: routingReceipt.final_receipt_bytes_sha256,
  },
);

assert.throws(
  () => validateAgentSpawnerRouteConsumer({receipt: routingReceipt, routePayload, finalReceiptBytes: routingBytesChanged}),
  new RegExp(AGENT_SPAWNER_ROUTING_RECEIPT_PROVENANCE_BLOCKER),
  "a digest computed before the final receipt write must be rejected",
);
assert.throws(
  () => validateAgentSpawnerRouteConsumer({receipt: routingReceipt, routePayload, finalReceiptBytes: routingBytes, observedReceiptPath: "opaque:receipt:routing-replaced"}),
  new RegExp(AGENT_SPAWNER_ROUTING_RECEIPT_PROVENANCE_BLOCKER),
  "a same-path post-route substitution must be rejected",
);

const provisionalRoutingReceipt = compileAgentSpawnerRoutingReceipt({
  routingReceiptId: "ROUTING.RECEIPT.PROVISIONAL",
  routeId: "ROUTING.ROUTE.PROVISIONAL",
  recipientRef: "opaque:auditor:independent",
  receiptPath: "opaque:receipt:routing-provisional",
  finalReceiptRef: "opaque:receipt:audit-provisional",
  finalReceiptBytesSha256: HASH("not-the-bytes"),
});
assert.equal(provisionalRoutingReceipt.final_receipt_bytes_verified, false);
assert.throws(
  () => compileAgentSpawnerRoutingRoutePayload(provisionalRoutingReceipt),
  new RegExp(AGENT_SPAWNER_ROUTING_RECEIPT_PROVENANCE_BLOCKER),
  "a route payload may not be emitted before exact bytes are validated",
);
const finalizedRoutingReceipt = finalizeAgentSpawnerRoutingReceipt(provisionalRoutingReceipt, {finalReceiptBytes: routingBytes});
assert.equal(finalizedRoutingReceipt.final_receipt_bytes_sha256, routingReceipt.final_receipt_bytes_sha256);
assert.throws(
  () => finalizeAgentSpawnerRoutingReceipt(routingReceipt, {finalReceiptBytes: routingBytesChanged}),
  new RegExp(AGENT_SPAWNER_ROUTING_RECEIPT_PROVENANCE_BLOCKER),
  "a byte-validated receipt may not be finalized again with different bytes on the same path",
);

const correctedRoutingReceipt = correctAgentSpawnerRoutingReceipt(routingReceipt, {
  routingReceiptId: "ROUTING.RECEIPT.SUCCESSOR",
  routeId: "ROUTING.ROUTE.SUCCESSOR",
  recipientRef: "opaque:auditor:independent",
  receiptPath: "opaque:receipt:routing-successor",
  finalReceiptRef: "opaque:receipt:audit-corrected",
  finalReceiptBytes: routingBytesChanged,
  freshReplacementAuthoritySha256: HASH("fresh-replacement-authority"),
});
assert.equal(correctedRoutingReceipt.historical_receipt_ref, routingReceipt.receipt_path);
assert.equal(correctedRoutingReceipt.historical_receipt_bytes_sha256, routingReceipt.final_receipt_bytes_sha256);
assert.equal(correctedRoutingReceipt.successor_receipt_ref, correctedRoutingReceipt.receipt_path);
assert.equal(correctedRoutingReceipt.product_verdict_inherited, false);
assert.equal(correctedRoutingReceipt.product_verdict, null);
const correctedPayload = compileAgentSpawnerRoutingRoutePayload(correctedRoutingReceipt);
assert.equal(validateAgentSpawnerRouteConsumer({receipt: correctedRoutingReceipt, routePayload: correctedPayload, finalReceiptBytes: routingBytesChanged}).accepted, true);
assert.throws(
  () => correctAgentSpawnerRoutingReceipt(routingReceipt, {
    routingReceiptId: "ROUTING.RECEIPT.REUSED",
    routeId: "ROUTING.ROUTE.REUSED",
    recipientRef: "opaque:auditor:independent",
    receiptPath: routingReceipt.receipt_path,
    finalReceiptRef: "opaque:receipt:audit-reused",
    finalReceiptBytes: routingBytesChanged,
    freshReplacementAuthoritySha256: HASH("fresh-replacement-authority"),
  }),
  new RegExp(AGENT_SPAWNER_ROUTING_RECEIPT_PROVENANCE_BLOCKER),
  "a correction may not amend the routed receipt path",
);
assert.throws(
  () => correctAgentSpawnerRoutingReceipt(routingReceipt, {
    routingReceiptId: "ROUTING.RECEIPT.NO_AUTHORITY",
    routeId: "ROUTING.ROUTE.NO_AUTHORITY",
    recipientRef: "opaque:auditor:independent",
    receiptPath: "opaque:receipt:routing-no-authority",
    finalReceiptRef: "opaque:receipt:audit-no-authority",
    finalReceiptBytes: routingBytesChanged,
  }),
  new RegExp(AGENT_SPAWNER_ROUTING_RECEIPT_PROVENANCE_BLOCKER),
  "a replacement audit must have explicit fresh authority",
);
const verdictTampered = structuredClone(correctedRoutingReceipt);
verdictTampered.product_verdict = "PASS";
verdictTampered.receipt_sha256 = HASH("tampered");
assert.throws(
  () => validateAgentSpawnerRoutingReceipt(verdictTampered),
  new RegExp(AGENT_SPAWNER_ROUTING_RECEIPT_PROVENANCE_BLOCKER),
  "a corrected receipt may not inherit a product verdict",
);
console.log("PASS Agent Spawner routing receipt: final-before-route, exact consumer byte recomputation, same-path mutation denial, historical separation, fresh replacement authority, and hostile coverage");
