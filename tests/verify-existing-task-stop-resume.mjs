#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {canonicalDigest} from "../control/content-addressing.mjs";
import {
  activateSingleReplacement,
  archiveExistingTask,
  authorizeSingleReplacement,
  compileExistingTaskLifecycle,
  compileExactStopMessage,
  classifyExistingTaskMaterialProgress,
  deliverLifecyclePacket,
  exhaustExistingTask,
  finalizeExistingTaskHostEvent,
  requestExistingTaskStop,
  resumeExistingTask,
  revalidateExistingTaskCustody,
  routeExistingTaskLifecycleWork,
  sendExistingTaskResume,
  observeExistingTaskLiveness,
  recordReplacementMaterialOutput,
  recordReplacementRecoveryPrompt,
  finalizeReplacementHostRecovery,
  validateExistingTaskLifecycle,
  validateExistingTaskLifecycleAuthority,
} from "../control/existing-task-stop-resume.mjs";

const sha = (value) => canonicalDigest({value});
const binding = {
  role: "AGENTOS.AGENT_PROTOTYPER",
  model: "gpt-5.6-sol",
  reasoning_effort: "medium",
  cwd: "/project/worktree",
  branch: "project/lifecycle-repair",
  worktree: "/project/worktree",
  queue_id: "QUEUE.PROJECT.CONTROLLER",
  seam_id: "SEAM.HOST.LIFECYCLE",
  basis_sha256: sha("basis"),
};
const baseInput = {
  operationId: "OP.HOST.LIFECYCLE.001",
  nonce: "NONCE.HOST.LIFECYCLE.001",
  projectCampaignId: "PROJECT.CAMPAIGN.001",
  taskId: "TASK.EXISTING.001",
  hostId: "HOST.PORTABLE.001",
  activeTurnId: "TURN.EXISTING.001",
  pinnedThreads: ["TASK.EXISTING.001"],
  binding,
  custodySha256: sha("custody"),
  packetId: "PACKET.HOST.LIFECYCLE.001",
  payloadRefs: ["ref:handoff", "ref:queue"],
  checkpointRef: "CHECKPOINT.HOST.LIFECYCLE.001",
  checkpointSha256: sha("checkpoint"),
  preservationTerms: "Preserve exact custody and receipts; perform no cleanup or replacement.",
  smallestPendingTransition: "Reread finalized host event and resume the same task.",
};
const base = () => compileExistingTaskLifecycle(baseInput);
const observation = (record, label, overrides = {}) => observeExistingTaskLiveness(record, {
  taskId: "TASK.EXISTING.001", hostId: "HOST.PORTABLE.001", turnId: "TURN.EXISTING.001", observationSha256: sha(label), processCount: 0,
  materialReceiptSha256: sha("material-constant"), recoveryPromptConsumed: false, ...overrides,
});
const confirmed = () => observation(observation(base(), "observation-1"), "observation-2");
const stopped = () => requestExistingTaskStop(confirmed(), {operationId: "OP.HOST.LIFECYCLE.001", nonce: "NONCE.HOST.LIFECYCLE.001", taskId: "TASK.EXISTING.001"});
const finalized = () => finalizeExistingTaskHostEvent(stopped(), {
  taskIndex: {task_id: "TASK.EXISTING.001", host_id: "HOST.PORTABLE.001", active: false},
  turnStatus: "stopped",
  processes: [],
  materialReceiptSha256: sha("material-constant"),
});
const custody = () => revalidateExistingTaskCustody(finalized(), {custodySha256: sha("custody"), unstagedCount: 0, untrackedCount: 0, processes: []});
const exhausted = () => exhaustExistingTask(custody(), {taskId: "TASK.EXISTING.001", pinnedThreads: ["TASK.EXISTING.001"], harmlessProbeOutcome: "PASSED", substantiveRetryOutcome: "FAILED"});

validateExistingTaskLifecycle(base());
assert.equal(base().transition_sequence, 0);
assert.equal(observation(base(), "provenance").transition_sequence, 1);
const forgedTransition = structuredClone(observation(base(), "provenance"));
forgedTransition.transition_parent_sha256 = null;
forgedTransition.record_sha256 = canonicalDigest({...forgedTransition, record_sha256: null});
assert.throws(() => validateExistingTaskLifecycle(forgedTransition), /transition provenance/u);

// A resealed record cannot promote caller-controlled flags into lifecycle
// authority: every state must agree with the finalized event and its
// state-dependent retry/replacement invariants.
const forgedExhaustion = structuredClone(base());
forgedExhaustion.state = "SAME_TASK_RETRY_FAILED";
forgedExhaustion.same_task.exhausted = true;
forgedExhaustion.record_sha256 = canonicalDigest({...forgedExhaustion, record_sha256: null});
assert.throws(() => validateExistingTaskLifecycle(forgedExhaustion), /genesis provenance|post-STOP|exhaustion evidence/u);
const forgedFinalization = structuredClone(base());
forgedFinalization.state = "TURN_ENDED_IDLE";
forgedFinalization.stop.requested = true;
forgedFinalization.record_sha256 = canonicalDigest({...forgedFinalization, record_sha256: null});
assert.throws(() => validateExistingTaskLifecycle(forgedFinalization), /genesis provenance|post-STOP|finalized host event/u);
const forgedReplacement = structuredClone(exhausted());
forgedReplacement.state = "REPLACEMENT_AUTHORIZED";
forgedReplacement.replacement_task_id = "TASK.REPLACEMENT.FORGED";
forgedReplacement.replacement.authorized = false;
forgedReplacement.record_sha256 = canonicalDigest({...forgedReplacement, record_sha256: null});
assert.throws(() => validateExistingTaskLifecycle(forgedReplacement), /replacement authorization/u);

// A single observation is provisional. Live processes, a new material
// receipt, or consumption of the recovery prompt cancel STOP eligibility.
assert.equal(observation(base(), "single").state, "OBSERVING");
assert.throws(() => requestExistingTaskStop(observation(base(), "single"), {operationId: "OP.HOST.LIFECYCLE.001", nonce: "NONCE.HOST.LIFECYCLE.001", taskId: "TASK.EXISTING.001"}), /repeated fresh/u);
assert.equal(observation(observation(base(), "live-1"), "live-2", {processCount: 1}).state, "OBSERVING");
assert.equal(observation(observation(base(), "receipt-1"), "receipt-2", {materialReceiptSha256: sha("new-material")}).state, "OBSERVING");
assert.equal(observation(observation(base(), "prompt-1"), "prompt-2", {recoveryPromptConsumed: true}).state, "OBSERVING");
assert.equal(confirmed().state, "STUCK_CONFIRMED");
assert.equal(compileExactStopMessage(confirmed(), {operationId: "OP.HOST.LIFECYCLE.001", nonce: "NONCE.HOST.LIFECYCLE.001", preservationTerms: base().preservation_terms}).startsWith("STOP\n"), true);
assert.throws(() => compileExactStopMessage(confirmed(), {operationId: "OP.HOST.LIFECYCLE.001", nonce: "NONCE.HOST.LIFECYCLE.001", preservationTerms: "changed"}), /preservation terms changed/u);
assert.throws(() => requestExistingTaskStop(confirmed(), {operationId: "OP.HOST.LIFECYCLE.001", nonce: "NONCE.WRONG", taskId: "TASK.EXISTING.001"}), /identity mismatch/u);
assert.throws(() => requestExistingTaskStop(stopped(), {operationId: "OP.HOST.LIFECYCLE.001", nonce: "NONCE.HOST.LIFECYCLE.001", taskId: "TASK.EXISTING.001"}), /repeated fresh/u);

// Finalized host events outrank a stale task-index active flag only for an
// exact finalized systemError readback; a nonterminal status cannot advance.
const staleFinal = finalizeExistingTaskHostEvent(stopped(), {
  taskIndex: {task_id: "TASK.EXISTING.001", host_id: "HOST.PORTABLE.001", active: true},
  turnStatus: "systemError",
  processes: [],
  materialReceiptSha256: sha("material-constant"),
});
assert.equal(staleFinal.state, "TURN_ENDED_IDLE");
assert.equal(staleFinal.stop.finalized_status, "systemError");
assert.throws(() => finalizeExistingTaskHostEvent(stopped(), {taskIndex: {task_id: "TASK.EXISTING.001", host_id: "HOST.PORTABLE.001", active: false}, turnStatus: "stopped", processes: [], materialReceiptSha256: sha("unrelated-receipt")}), /latest material evidence/u);
assert.throws(() => finalizeExistingTaskHostEvent(stopped(), {taskIndex: {task_id: "TASK.EXISTING.001", host_id: "HOST.PORTABLE.001", active: true}, turnStatus: "active", processes: [], materialReceiptSha256: sha("active")}), /not finalized/u);
assert.throws(() => finalizeExistingTaskHostEvent(stopped(), {taskIndex: {task_id: "TASK.EXISTING.001", host_id: "HOST.FORGED.001", active: false}, turnStatus: "systemError", processes: [], materialReceiptSha256: sha("forged")}), /identity mismatch/u);

// Pin operations are accepted by exact fresh membership, never by a pin API
// acknowledgement or membership of a different task.
assert.throws(() => compileExistingTaskLifecycle({...baseInput, operationId: "OP.BAD.PIN", nonce: "NONCE.BAD.PIN", pinnedThreads: ["TASK.OTHER.001"]}), /exact task ID/u);
const resumeSent = () => sendExistingTaskResume(custody(), {taskId: "TASK.EXISTING.001", hostId: "HOST.PORTABLE.001", checkpointRef: "CHECKPOINT.HOST.LIFECYCLE.001", checkpointSha256: sha("checkpoint"), smallestPendingTransition: "Reread finalized host event and resume the same task."});
assert.throws(() => resumeExistingTask(resumeSent(), {taskId: "TASK.EXISTING.001", pinnedThreads: ["TASK.OTHER.001"], harmlessProbeAvailable: true, substantiveRetryAvailable: true, custodySha256: sha("custody")}), /exact resumed task ID/u);

assert.throws(() => resumeExistingTask(custody(), {taskId: "TASK.EXISTING.001", pinnedThreads: ["TASK.EXISTING.001"], harmlessProbeAvailable: true, substantiveRetryAvailable: true, custodySha256: sha("custody")}), /out of order/u);
const resumed = resumeExistingTask(resumeSent(), {taskId: "TASK.EXISTING.001", pinnedThreads: ["TASK.EXISTING.001"], harmlessProbeAvailable: true, substantiveRetryAvailable: true, custodySha256: sha("custody")});
assert.equal(resumed.state, "RESUMED_SAME_TASK");
assert.equal(resumed.writer_task_id, "TASK.EXISTING.001");

// Replacement is impossible until both same-task probes fail.
assert.throws(() => exhaustExistingTask(custody(), {taskId: "TASK.EXISTING.001", pinnedThreads: ["TASK.EXISTING.001"], harmlessProbeOutcome: "PASSED", substantiveRetryOutcome: "PASSED"}), /exhaustion is incomplete/u);
assert.throws(() => authorizeSingleReplacement(custody(), {replacementTaskId: "TASK.REPLACEMENT.001", roleLockNonce: "NONCE.HOST.LIFECYCLE.001", binding, oldTaskRetired: true, oldTaskProcesses: [], pinnedThreads: ["TASK.EXISTING.001"]}), /same-task exhaustion/u);

// Replacement identity, role/model/effort/cwd/branch/worktree/queue/seam/basis,
// retirement, nonce, and pin order are all exact.
assert.throws(() => authorizeSingleReplacement(exhausted(), {replacementTaskId: "TASK.REPLACEMENT.001", roleLockNonce: "NONCE.WRONG", binding, oldTaskRetired: true, oldTaskProcesses: [], pinnedThreads: ["TASK.EXISTING.001"]}), /role lock nonce/u);
assert.throws(() => authorizeSingleReplacement(exhausted(), {replacementTaskId: "TASK.REPLACEMENT.001", roleLockNonce: "NONCE.HOST.LIFECYCLE.001", binding: {...binding, model: "different-model"}, oldTaskRetired: true, oldTaskProcesses: [], pinnedThreads: ["TASK.EXISTING.001"]}), /role or custody binding/u);
assert.throws(() => authorizeSingleReplacement(exhausted(), {replacementTaskId: "TASK.REPLACEMENT.001", roleLockNonce: "NONCE.HOST.LIFECYCLE.001", binding, oldTaskRetired: false, oldTaskProcesses: [], pinnedThreads: ["TASK.EXISTING.001"]}), /retired and inert/u);
assert.throws(() => authorizeSingleReplacement(exhausted(), {replacementTaskId: "TASK.REPLACEMENT.001", roleLockNonce: "NONCE.HOST.LIFECYCLE.001", binding, oldTaskRetired: true, oldTaskProcesses: [], pinnedThreads: ["TASK.EXISTING.001", "TASK.REPLACEMENT.001"]}), /before retirement authorization/u);

const authorized = authorizeSingleReplacement(exhausted(), {replacementTaskId: "TASK.REPLACEMENT.001", roleLockNonce: "NONCE.HOST.LIFECYCLE.001", binding, oldTaskRetired: true, oldTaskProcesses: [], pinnedThreads: ["TASK.EXISTING.001"]});
assert.equal(authorized.state, "REPLACEMENT_AUTHORIZED");
assert.throws(() => authorizeSingleReplacement(authorized, {replacementTaskId: "TASK.REPLACEMENT.002", roleLockNonce: "NONCE.HOST.LIFECYCLE.001", binding, oldTaskRetired: true, oldTaskProcesses: [], pinnedThreads: ["TASK.EXISTING.001"]}), /same-task exhaustion/u);
assert.throws(() => activateSingleReplacement(authorized, {replacementTaskId: "TASK.REPLACEMENT.001", pinnedThreads: ["TASK.REPLACEMENT.001"], writerTaskIds: ["TASK.EXISTING.001", "TASK.REPLACEMENT.001"]}), /duplicate writer/u);
assert.throws(() => activateSingleReplacement(authorized, {replacementTaskId: "TASK.REPLACEMENT.001", pinnedThreads: ["TASK.EXISTING.001", "TASK.REPLACEMENT.001"], writerTaskIds: ["TASK.REPLACEMENT.001"]}), /pin transfer/u);
const replacement = activateSingleReplacement(authorized, {replacementTaskId: "TASK.REPLACEMENT.001", pinnedThreads: ["TASK.REPLACEMENT.001"], writerTaskIds: ["TASK.REPLACEMENT.001"]});
assert.equal(replacement.state, "REPLACEMENT_ACTIVE");
assert.equal(replacement.pinned_task_id, "TASK.REPLACEMENT.001");

// Immutable packet identity and exactly-once monotonic delivery reject wrong
// digest, omission/reset, replay, and delivery to the retired writer.
assert.throws(() => deliverLifecyclePacket(replacement, {taskId: "TASK.REPLACEMENT.001", packetSha256: sha("different"), expectedDeliveryCount: 0}), /digest changed/u);
assert.throws(() => deliverLifecyclePacket(replacement, {taskId: "TASK.EXISTING.001", packetSha256: replacement.packet.packet_sha256, expectedDeliveryCount: 0}), /sole writer/u);
const delivered = deliverLifecyclePacket(replacement, {taskId: "TASK.REPLACEMENT.001", packetSha256: replacement.packet.packet_sha256, expectedDeliveryCount: 0});
assert.equal(delivered.packet.delivery_count, 1);
assert.throws(() => deliverLifecyclePacket(delivered, {taskId: "TASK.REPLACEMENT.001", packetSha256: delivered.packet.packet_sha256, expectedDeliveryCount: 0}), /replay or reset/u);

// A single lawful replacement may produce uncommitted tracked and untracked
// material, then suffer a recurring finalized host-filter failure. ACTIVE or
// prompt delivery is provisional; only the finalized full reread can classify
// the recovery, and it must preserve both byte sets exactly.
const trackedEvidenceSha256 = "0ab7f194ed70048d1189de604d60347dc8b5ae26bd05d60939428f62cecf5f78";
const untrackedEvidenceSha256 = "22de5fac77900560ced80d74391c2f38bdf67e4085852207ba6614aa64e83700";
const materialReplacement = recordReplacementMaterialOutput(replacement, {
  taskId: "TASK.REPLACEMENT.001", priorCustodySha256: sha("custody"), custodySha256: sha("material-uncommitted-custody"),
  trackedStateSha256: trackedEvidenceSha256, untrackedStateSha256: untrackedEvidenceSha256, materialReceiptSha256: sha("material-output-receipt"),
});
const promptedReplacement = recordReplacementRecoveryPrompt(materialReplacement, {taskId: "TASK.REPLACEMENT.001", packetSha256: materialReplacement.packet.packet_sha256, expectedPromptCount: 0});
assert.equal(promptedReplacement.state, "REPLACEMENT_ACTIVE", "prompt delivery was incorrectly accepted as recovery");
assert.throws(() => recordReplacementRecoveryPrompt(promptedReplacement, {taskId: "TASK.REPLACEMENT.001", packetSha256: promptedReplacement.packet.packet_sha256, expectedPromptCount: 1}), /duplicate replacement recovery prompt/u);
assert.throws(() => finalizeReplacementHostRecovery(promptedReplacement, {taskIndex: {task_id: "TASK.REPLACEMENT.001", host_id: "HOST.PORTABLE.001", active: true}, turnStatus: "inProgress", processes: [], custodySha256: sha("material-uncommitted-custody"), trackedStateSha256: trackedEvidenceSha256, untrackedStateSha256: untrackedEvidenceSha256, materialReceiptSha256: sha("material-output-receipt")}), /not finalized/u);
assert.throws(() => finalizeReplacementHostRecovery(promptedReplacement, {taskIndex: {task_id: "TASK.REPLACEMENT.001", host_id: "HOST.PORTABLE.001", active: false}, turnStatus: "systemError", processes: [], custodySha256: sha("material-uncommitted-custody"), trackedStateSha256: trackedEvidenceSha256, untrackedStateSha256: untrackedEvidenceSha256, materialReceiptSha256: sha("unrelated-receipt")}), /final receipt is not bound/u);
assert.throws(() => finalizeReplacementHostRecovery(promptedReplacement, {taskIndex: {task_id: "TASK.REPLACEMENT.001", host_id: "HOST.PORTABLE.001", active: false}, turnStatus: "systemError", processes: [], custodySha256: sha("material-uncommitted-custody"), trackedStateSha256: trackedEvidenceSha256, untrackedStateSha256: sha("fixture-lost"), materialReceiptSha256: sha("material-output-receipt")}), /tracked or untracked/u);
const recurrentFailure = finalizeReplacementHostRecovery(promptedReplacement, {taskIndex: {task_id: "TASK.REPLACEMENT.001", host_id: "HOST.PORTABLE.001", active: false}, turnStatus: "systemError", processes: [], custodySha256: sha("material-uncommitted-custody"), trackedStateSha256: trackedEvidenceSha256, untrackedStateSha256: untrackedEvidenceSha256, materialReceiptSha256: sha("material-output-receipt")});
assert.equal(recurrentFailure.state, "SAME_TASK_RETRY_FAILED");
assert.throws(() => authorizeSingleReplacement(recurrentFailure, {replacementTaskId: "TASK.REPLACEMENT.002", roleLockNonce: "NONCE.HOST.LIFECYCLE.001", binding, oldTaskRetired: true, oldTaskProcesses: [], pinnedThreads: ["TASK.REPLACEMENT.001"]}), /role lock already consumed/u);

// Archive cannot race idle/process/custody preservation.
assert.throws(() => archiveExistingTask(replacement, {taskId: "TASK.EXISTING.001", processes: [101], custodySha256: sha("custody")}), /while old task is live/u);
assert.throws(() => archiveExistingTask(replacement, {taskId: "TASK.EXISTING.001", processes: [], custodySha256: sha("changed")}), /custody changed/u);
assert.equal(archiveExistingTask(replacement, {taskId: "TASK.EXISTING.001", processes: [], custodySha256: sha("custody")}).state, "RETIRED");

// Ordinary work bypasses the Orchestrator. Only evidence-complete TRUE_BLOCKED
// may cross that boundary.
for (const routeClass of ["CANDIDATE", "AUDIT", "REMEDIATION", "NEXT_SEAM"]) {
  assert.equal(routeExistingTaskLifecycleWork({routeClass, laneLead: "AGENTOS.CONTROLLER"}).handler, "AGENTOS.CONTROLLER");
}
assert.throws(() => routeExistingTaskLifecycleWork({routeClass: "AUDIT", laneLead: "AGENTOS.CONTROLLER", trueBlocked: {classification: "UNKNOWN", evidence_sha256: sha("evidence")}}), /TRUE_BLOCKED/u);
assert.equal(routeExistingTaskLifecycleWork({routeClass: "AUDIT", laneLead: "AGENTOS.CONTROLLER", trueBlocked: {classification: "TRUE_BLOCKED", evidence_sha256: sha("evidence")}}).handler, "CAMPAIGN_ORCHESTRATOR");

assert.equal(classifyExistingTaskMaterialProgress({status: "ACTIVE", beforeCustodySha256: sha("same"), afterCustodySha256: sha("same")}), false, "ACTIVE alone was accepted as progress");
assert.equal(classifyExistingTaskMaterialProgress({status: "ACTIVE", beforeCustodySha256: sha("before"), afterCustodySha256: sha("after"), materialReceiptSha256: sha("receipt")}), true);
assert.throws(() => validateExistingTaskLifecycleAuthority({action: "IMPLEMENT", actor: "AGENTOS.SPAWNER"}), /authority split/u);
assert.throws(() => validateExistingTaskLifecycleAuthority({action: "EVALUATE", actor: "AGENTOS.SPAWNER"}), /authority split/u);
assert.throws(() => validateExistingTaskLifecycleAuthority({action: "BIND_CUSTODY", actor: "AGENTOS.ORCHESTRATOR"}), /independent PASS/u);
assert.equal(validateExistingTaskLifecycleAuthority({action: "BIND_CUSTODY", actor: "AGENTOS.ORCHESTRATOR", independentPassSha256: sha("independent-pass")}), true);

// Normative surfaces remain portable and schema/runtime identities agree.
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const schema = JSON.parse(fs.readFileSync(path.join(root, "schemas/existing-task-stop-resume.v1.json"), "utf8"));
assert.equal(schema.properties.schema.const, base().schema);
for (const relative of ["control/existing-task-stop-resume.mjs", "schemas/existing-task-stop-resume.v1.json"]) {
  assert(!/Sociuna|JobSight|WellSight|nicholaspacheco/iu.test(fs.readFileSync(path.join(root, relative), "utf8")), `${relative} contains consumer-specific policy`);
}

console.log("PASS existing-task lifecycle: finalized reread, exact pin membership, same-task exhaustion, single replacement, immutable delivery, custody, and ordinary routing are fail closed");
