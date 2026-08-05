#!/usr/bin/env node

import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {compileGateFile, parseGateDsl} from "../control/gate-dsl.mjs";
import {createEvidence} from "../control/evidence.mjs";
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
  execution = answerCurrent(execution, core, answer, evidenceFor(core, gate, answer), {authority});
}
assert.equal(execution.status, "COMPLETE");
assert.equal(execution.trace.length, 3);
assert.throws(() => createExecution(core, identity, {authority}), /already active or permanently closed/u);

const forged = createExecutionAuthority("forged-state-authority-secret-001");
const honest = createExecution(core, identity, {authority: forged});
assert.throws(() => answerCurrent({...honest, current_node: "CORE-003"}, core, "YES", evidenceFor(core, findGate(core, "CORE-001"), "YES"), {authority: forged}), /authentication failed/u);
const foreignIdentity = {...identity, worktree_id: "WORKTREE-FOREIGN"};
const foreignEvidence = evidenceFor(core, findGate(core, "CORE-001"), "YES");
foreignEvidence.admission = {...foreignEvidence.admission, worktree_id: foreignIdentity.worktree_id};
foreignEvidence.admission.digest = "0".repeat(64);
assert.throws(() => answerCurrent(honest, core, "YES", foreignEvidence, {authority: forged}), /digest does not match|differs from execution binding/u);
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
stopped = answerCurrent(stopped, core, "UNKNOWN", evidenceFor(core, findGate(core, stopped.current_node), "UNKNOWN"), {authority: stoppedAuthority});
assert.equal(stopped.status, "HARD_STOP");
assert.equal(stopped.result.terminal_id, "HARD-STOP-EVIDENCE");

const missingEvidenceAuthority = createExecutionAuthority("missing-evidence-authority-secret-001");
assert.throws(() => answerCurrent(createExecution(core, identity, {authority: missingEvidenceAuthority}), core, "YES", {}, {authority: missingEvidenceAuthority}), /evidence fields mismatch/u);
assert.throws(() => parseGateDsl("graph BAD 1\nentry BAD-001\ngate BAD-001\ncontext TASK_START\nquestion \"cycle\"\nevidence one\nYES BAD-001\nNO BAD-001\nUNKNOWN BAD-001\nNOT_APPLICABLE BAD-001\nend\nterminal STOP HARD_STOP \"stop\""), /unbounded cycle/u);
assert.throws(() => parseGateDsl("graph BAD 1\nentry BAD-001\ngate BAD-001\ncontext TASK_START\nquestion \"unsafe\"\nevidence one\nYES COMPLETE\nNO COMPLETE\nUNKNOWN COMPLETE\nNOT_APPLICABLE COMPLETE\nend\nterminal COMPLETE COMPLETE \"complete\""), /can reach COMPLETE/u);
assert.throws(() => parseGateDsl("graph BAD 1\nentry BAD-001\ngate BAD-001\ncontext TASK_START\ncontext CODE_CHANGE\nquestion \"duplicate\"\nevidence one\nYES COMPLETE\nNO COMPLETE\nUNKNOWN STOP\nNOT_APPLICABLE STOP\nend\nterminal COMPLETE COMPLETE \"complete\"\nterminal STOP UNPROVEN \"stop\""), /duplicate context/u);
assert.throws(() => parseGateDsl("graph BAD 1\nentry BAD-001\ngate BAD-001\ncontext TASK_START\nquestion \"entry\"\nevidence one\nYES COMPLETE\nNO STOP\nUNKNOWN STOP\nNOT_APPLICABLE STOP\nend\ngate BAD-002\ncontext TASK_START\nquestion \"unreachable\"\nevidence one\nYES BAD-002\nNO BAD-002\nUNKNOWN BAD-002\nNOT_APPLICABLE BAD-002\nend\nterminal COMPLETE COMPLETE \"complete\"\nterminal STOP UNPROVEN \"stop\""), /unbounded cycle|unreachable/u);

const functionalityAuthority = createExecutionAuthority("functionality-execution-authority-secret-001");
let functionalityRun = createExecution(functionality, identity, {authority: functionalityAuthority});
for (const answer of ["YES", "YES", "YES", "YES", "YES", "YES", "YES", "YES", "YES"]) {
  const gate = findGate(functionality, functionalityRun.current_node);
  functionalityRun = answerCurrent(functionalityRun, functionality, answer, evidenceFor(functionality, gate, answer), {authority: functionalityAuthority});
}
assert.equal(functionalityRun.status, "COMPLETE");

const packet = composeRolePacket({role_id: "NAMED_LANE_WORKER", lane_id: "functionality", graph_ids: ["CORE", "FUNCTIONALITY"]});
assert.equal(validateRolePacket(packet).digest, packet.digest);
const regulator = composeRolePacket({role_id: "INTENT_REGULATOR", graph_ids: ["CORE"]});
assert.equal(validateRolePacket(regulator).lifetime, "PERSISTENT");

const schemaText = await readFile(path.join(ROOT, "schemas/gate-graph.v1.json"), "utf8");
assert.equal(JSON.parse(schemaText).$id, "agentos.gate-graph.v1");

console.log(JSON.stringify({status: "PASS", graphs: [core.graph_id, functionality.graph_id], roles: [packet.role_id, regulator.role_id]}));
