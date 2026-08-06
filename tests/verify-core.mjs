#!/usr/bin/env node

import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {compileGateFile, parseGateDsl} from "../control/gate-dsl.mjs";
import {createEvidence} from "../control/evidence.mjs";
import {digestWithout} from "../control/canonical-json.mjs";
import {answerCurrent, createExecution, createExecutionAuthority} from "../control/gate-engine.mjs";
import {composeRolePacket, validateRolePacket} from "../control/role-packet.mjs";
import {findGate, validateGateGraph} from "../control/gate-model.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const identity = {
  source_commit: "a".repeat(40),
  source_tree: "b".repeat(40),
  worktree_id: "WORKTREE-001",
  session_id: "SESSION-001",
  goal_id: "GOAL-001",
  environment_id: "ENVIRONMENT-001",
};
const evidenceSecret = "core-evidence-attestation-secret-001";

function evidenceFor(graph, gate, answer) {
  return Object.fromEntries(gate.evidence.map((key) => [key, createEvidence({
    evidence_id: `${gate.id}-${key}`,
    question_id: gate.id,
    graph_digest: graph.digest,
    evidence_slot: key,
    answer,
    kind: "OBSERVED_RESULT",
    value: {gate: gate.id, key},
    identity,
    issuer_session_id: key === "review" ? "AUDITOR-SESSION-001" : "HOST-READBACK-001",
    issuer_kind: key === "review" ? "INDEPENDENT_AUDITOR" : "HOST_READBACK",
    supports_answer: true,
    observed_at_utc: "2026-01-01T00:00:00.000Z",
    attestation_secret: evidenceSecret,
  })]));
}

const corePath = path.join(ROOT, "governance/general/core.gate");
const functionalityPath = path.join(ROOT, "governance/lanes/functionality.gate");
const [core, coreAgain, functionality] = await Promise.all([
  compileGateFile(corePath),
  compileGateFile(corePath),
  compileGateFile(functionalityPath),
]);

validateGateGraph(core);
validateGateGraph(functionality);
assert.equal(core.digest, coreAgain.digest, "gate compilation must be deterministic");
assert.deepEqual(core.nodes[0].transitions, coreAgain.nodes[0].transitions);

const authority = createExecutionAuthority("execution-authority-secret-001-which-is-long-enough");
let execution = createExecution(core, identity, {authority});
for (const answer of ["YES", "YES", "YES"]) {
  const gate = findGate(core, execution.current_node);
  execution = answerCurrent(execution, core, answer, evidenceFor(core, gate, answer), {authority, attestation_secret: evidenceSecret});
}
assert.equal(execution.status, "COMPLETE");
assert.equal(execution.trace.length, 3);
assert.throws(() => createExecution(core, identity, {authority}), /already active or permanently closed/u);
const replayAuthority = createExecutionAuthority("replay-authority-secret-001-long-enough");
const replayInitial = createExecution(core, identity, {authority: replayAuthority});
let replayState = replayInitial;
for (const answer of ["YES", "YES", "YES"]) {
  const gate = findGate(core, replayState.current_node);
  replayState = answerCurrent(replayState, core, answer, evidenceFor(core, gate, answer), {authority: replayAuthority, attestation_secret: evidenceSecret});
}
assert.throws(() => answerCurrent(replayInitial, core, "UNKNOWN", evidenceFor(core, findGate(core, "CORE-001"), "UNKNOWN"), {authority: replayAuthority, attestation_secret: evidenceSecret}), /no longer active|stale/u);
const staleSealAuthority = createExecutionAuthority("stale-seal-authority-secret-001-long-enough");
const staleSealInitial = createExecution(core, identity, {authority: staleSealAuthority});
const staleSealNext = answerCurrent(staleSealInitial, core, "YES", evidenceFor(core, findGate(core, "CORE-001"), "YES"), {authority: staleSealAuthority, attestation_secret: evidenceSecret});
assert.throws(() => staleSealAuthority.seal({...staleSealInitial, auth_tag: null}, staleSealInitial.auth_tag), /stale/u);
assert.equal(staleSealNext.status, "ACTIVE");

const forged = createExecutionAuthority("forged-state-authority-secret-001");
const honest = createExecution(core, identity, {authority: forged});
assert.throws(() => answerCurrent({...honest, current_node: "CORE-003"}, core, "YES", evidenceFor(core, findGate(core, "CORE-001"), "YES"), {authority: forged, attestation_secret: evidenceSecret}), /authentication failed/u);
const foreignIdentity = {...identity, worktree_id: "WORKTREE-FOREIGN"};
const foreignEvidence = evidenceFor(core, findGate(core, "CORE-001"), "YES");
foreignEvidence.admission = {...foreignEvidence.admission, worktree_id: foreignIdentity.worktree_id};
foreignEvidence.admission.digest = "0".repeat(64);
assert.throws(() => answerCurrent(honest, core, "YES", foreignEvidence, {authority: forged, attestation_secret: evidenceSecret}), /digest does not match|differs from execution binding|attestation/u);
const tamperedEvidence = evidenceFor(core, findGate(core, "CORE-001"), "YES");
tamperedEvidence.admission.value_sha256 = "0".repeat(64);
tamperedEvidence.admission.digest = digestWithout(tamperedEvidence.admission, "digest");
assert.throws(() => answerCurrent(honest, core, "YES", tamperedEvidence, {authority: forged, attestation_secret: evidenceSecret}), /attestation is invalid/u);
assert.throws(() => createEvidence({
  evidence_id: "BAD-EVIDENCE",
  question_id: "CORE-001",
  graph_digest: core.digest,
  evidence_slot: "admission",
  answer: "YES",
  kind: "OBSERVED_RESULT",
  value: true,
  identity,
  issuer_session_id: "HOST-READBACK-001",
  issuer_kind: "HOST_READBACK",
  supports_answer: false,
  observed_at_utc: "2026-01-01T00:00:00.000Z",
}), /support its answer/u);

const stoppedAuthority = createExecutionAuthority("stopped-execution-authority-secret-001");
let stopped = createExecution(core, identity, {authority: stoppedAuthority});
stopped = answerCurrent(stopped, core, "UNKNOWN", evidenceFor(core, findGate(core, stopped.current_node), "UNKNOWN"), {authority: stoppedAuthority, attestation_secret: evidenceSecret});
assert.equal(stopped.status, "HARD_STOP");
assert.equal(stopped.result.terminal_id, "HARD-STOP-EVIDENCE");

const missingEvidenceAuthority = createExecutionAuthority("missing-evidence-authority-secret-001");
assert.throws(() => answerCurrent(createExecution(core, identity, {authority: missingEvidenceAuthority}), core, "YES", {}, {authority: missingEvidenceAuthority, attestation_secret: evidenceSecret}), /evidence fields mismatch/u);
const boundedRepair = parseGateDsl(`graph REPAIR 1
entry REPAIR-001
gate REPAIR-001
context TASK_START
question "Is the repair task admitted?"
evidence one
YES REPAIR-002
NO REPAIR-003
UNKNOWN REPAIR-003
NOT_APPLICABLE REPAIR-003
end
gate REPAIR-002
context TASK_START
question "Did the admitted task pass?"
evidence one
YES COMPLETE
NO REPAIR-003
UNKNOWN REPAIR-003
NOT_APPLICABLE REPAIR-003
end
gate REPAIR-003
context REPAIR
question "Is the bounded repair ready?"
evidence one
YES REPAIR-004
NO STOP
UNKNOWN STOP
NOT_APPLICABLE STOP
end
gate REPAIR-004
context REPAIR
question "Did the bounded repair finish?"
evidence one
YES REPAIR-003
NO STOP
UNKNOWN STOP
NOT_APPLICABLE STOP
end
repair REPAIR-003 YES REPAIR-004 1
repair REPAIR-004 YES REPAIR-003 1
repair-limit-terminal REPAIR-LIMIT
terminal COMPLETE COMPLETE "complete"
terminal STOP HARD_STOP "stop"
terminal REPAIR-LIMIT HARD_STOP "The bounded repair limit was reached."
`);
validateGateGraph(boundedRepair);
const boundedRepairAuthority = createExecutionAuthority("bounded-repair-execution-authority-secret-001");
let boundedRepairRun = createExecution(boundedRepair, identity, {authority: boundedRepairAuthority});
for (const answer of ["NO", "YES", "YES", "YES"]) {
  const gate = findGate(boundedRepair, boundedRepairRun.current_node);
  boundedRepairRun = answerCurrent(boundedRepairRun, boundedRepair, answer, evidenceFor(boundedRepair, gate, answer), {authority: boundedRepairAuthority, attestation_secret: evidenceSecret});
}
assert.equal(boundedRepairRun.status, "HARD_STOP");
assert.equal(boundedRepairRun.result.terminal_id, "REPAIR-LIMIT");
assert.equal(boundedRepairRun.trace.at(-1).repair_visit, 2);
assert.throws(() => parseGateDsl(`graph BAD-REPAIR 1
entry BAD-REPAIR-001
gate BAD-REPAIR-001
context REPAIR
question "cycle"
evidence one
YES BAD-REPAIR-001
NO STOP
UNKNOWN STOP
NOT_APPLICABLE STOP
end
terminal STOP HARD_STOP "stop"
repair-limit-terminal STOP`), /repair-limit-terminal requires a repair edge|unbounded cycle/u);
assert.throws(() => parseGateDsl("graph BAD 1\nentry BAD-001\ngate BAD-001\ncontext TASK_START\nquestion \"cycle\"\nevidence one\nYES BAD-001\nNO BAD-001\nUNKNOWN BAD-001\nNOT_APPLICABLE BAD-001\nend\nterminal STOP HARD_STOP \"stop\""), /unbounded cycle/u);
assert.throws(() => parseGateDsl("graph BAD 1\nentry BAD-001\ngate BAD-001\ncontext TASK_START\nquestion \"unsafe\"\nevidence one\nYES COMPLETE\nNO COMPLETE\nUNKNOWN COMPLETE\nNOT_APPLICABLE COMPLETE\nend\nterminal COMPLETE COMPLETE \"complete\""), /can reach COMPLETE/u);
assert.throws(() => parseGateDsl("graph BAD 1\nentry BAD-001\ngate BAD-001\ncontext TASK_START\ncontext CODE_CHANGE\nquestion \"duplicate\"\nevidence one\nYES COMPLETE\nNO COMPLETE\nUNKNOWN STOP\nNOT_APPLICABLE STOP\nend\nterminal COMPLETE COMPLETE \"complete\"\nterminal STOP UNPROVEN \"stop\""), /duplicate context/u);
assert.throws(() => parseGateDsl("graph BAD 1\nentry BAD-001\ngate BAD-001\ncontext TASK_START\nquestion \"entry\"\nevidence one\nYES COMPLETE\nNO STOP\nUNKNOWN STOP\nNOT_APPLICABLE STOP\nend\ngate BAD-002\ncontext TASK_START\nquestion \"unreachable\"\nevidence one\nYES BAD-002\nNO BAD-002\nUNKNOWN BAD-002\nNOT_APPLICABLE BAD-002\nend\nterminal COMPLETE COMPLETE \"complete\"\nterminal STOP UNPROVEN \"stop\""), /unbounded cycle|unreachable/u);
assert.throws(() => parseGateDsl("graph BAD 1\nentry BAD-001\ngate BAD-001\ncontext TASK_START\nquestion \"entry\"\nevidence one\nYES COMPLETE\nNO STOP\nUNKNOWN STOP\nNOT_APPLICABLE STOP\nend\ngate BAD-002\ncontext TASK_START\nquestion \"unreachable\"\nevidence one\nYES STOP\nNO STOP\nUNKNOWN STOP\nNOT_APPLICABLE STOP\nend\nterminal COMPLETE COMPLETE \"complete\"\nterminal STOP UNPROVEN \"stop\""), /unreachable gates/u);
assert.throws(() => parseGateDsl("graph BAD 1\nentry BAD-001\ngate BAD-001\ncontext TASK_START\nquestion \"empty evidence\"\nevidence one,,two\nYES COMPLETE\nNO STOP\nUNKNOWN STOP\nNOT_APPLICABLE STOP\nend\nterminal COMPLETE COMPLETE \"complete\"\nterminal STOP UNPROVEN \"stop\""), /empty slot/u);

const functionalityAuthority = createExecutionAuthority("functionality-execution-authority-secret-001");
let functionalityRun = createExecution(functionality, identity, {authority: functionalityAuthority});
for (const answer of ["YES", "YES", "YES", "YES", "YES", "YES", "YES", "YES", "YES", "YES", "YES", "YES"]) {
  const gate = findGate(functionality, functionalityRun.current_node);
  functionalityRun = answerCurrent(functionalityRun, functionality, answer, evidenceFor(functionality, gate, answer), {authority: functionalityAuthority, attestation_secret: evidenceSecret});
}
assert.equal(functionalityRun.status, "COMPLETE");

const generalGraphs = ["CORE", "GENERAL_CLOSURE", "GENERAL_CONVERSATION", "GENERAL_EVIDENCE", "GENERAL_PROGRESS", "GENERAL_RECOVERY", "GENERAL_RESPONSE", "GENERAL_SECURITY"];
const packet = composeRolePacket({role_id: "NAMED_LANE_WORKER", lane_id: "functionality", graph_ids: [...generalGraphs, "FUNCTIONALITY"].sort()});
assert.equal(validateRolePacket(packet).digest, packet.digest);
assert.throws(() => composeRolePacket({role_id: "RUNTIME", graph_ids: [...generalGraphs, "FUNCTIONALITY"].sort()}), /another role/u);
assert.throws(() => composeRolePacket({role_id: "RUNTIME", graph_ids: generalGraphs}), /complete role governance/u);
assert.throws(() => composeRolePacket({role_id: "NAMED_LANE_WORKER", lane_id: "functionality", graph_ids: ["CORE", "FUNCTIONALITY"]}), /complete general foundation/u);
const regulator = composeRolePacket({role_id: "INTENT_REGULATOR", graph_ids: [...generalGraphs, "DELIVERY_CLOSURE", "INTENT_SCOPE", "ROLE_ROUTING", "USER_CONVERSATION"].sort()});
assert.equal(validateRolePacket(regulator).lifetime, "PERSISTENT");

const schemaText = await readFile(path.join(ROOT, "schemas/gate-graph.v1.json"), "utf8");
assert.equal(JSON.parse(schemaText).$id, "agentos.gate-graph.v1");

console.log(JSON.stringify({status: "PASS", graphs: [core.graph_id, functionality.graph_id], roles: [packet.role_id, regulator.role_id]}));
