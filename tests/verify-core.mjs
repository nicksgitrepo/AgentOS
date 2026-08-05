#!/usr/bin/env node

import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {compileGateFile, parseGateDsl} from "../control/gate-dsl.mjs";
import {createEvidence} from "../control/evidence.mjs";
import {answerCurrent, createExecution} from "../control/gate-engine.mjs";
import {composeRolePacket, validateRolePacket} from "../control/role-packet.mjs";
import {validateGateGraph} from "../control/gate-model.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const identity = {
  source_commit: "a".repeat(40),
  source_tree: "b".repeat(40),
  worktree_id: "WORKTREE-001",
  session_id: "SESSION-001",
  goal_id: "GOAL-001",
  environment_id: "ENVIRONMENT-001",
};

function evidenceFor(gate) {
  return Object.fromEntries(gate.evidence.map((key) => [key, createEvidence({
    evidence_id: `${gate.id}-${key}`,
    question_id: gate.id,
    kind: "OBSERVED_RESULT",
    value: {gate: gate.id, key},
    identity,
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

let execution = createExecution(core, identity);
for (const answer of ["YES", "YES", "YES"]) {
  const {findGate} = await import("../control/gate-model.mjs");
  execution = answerCurrent(execution, core, answer, evidenceFor(findGate(core, execution.current_node)));
}
assert.equal(execution.status, "COMPLETE");
assert.equal(execution.trace.length, 3);

let stopped = createExecution(core, identity);
const {findGate} = await import("../control/gate-model.mjs");
stopped = answerCurrent(stopped, core, "UNKNOWN", evidenceFor(findGate(core, stopped.current_node)));
assert.equal(stopped.status, "HARD_STOP");
assert.equal(stopped.result.terminal_id, "HARD-STOP-EVIDENCE");

assert.throws(() => answerCurrent(createExecution(core, identity), core, "YES", {}), /evidence fields mismatch/u);
assert.throws(() => parseGateDsl("graph BAD 1\nentry BAD-001\ngate BAD-001\ncontext TASK_START\nquestion \"cycle\"\nevidence one\nYES BAD-001\nNO BAD-001\nUNKNOWN BAD-001\nNOT_APPLICABLE BAD-001\nend\nterminal STOP HARD_STOP \"stop\""), /unbounded cycle/u);

let functionalityRun = createExecution(functionality, identity);
for (const answer of ["YES", "YES", "YES", "YES"]) {
  functionalityRun = answerCurrent(functionalityRun, functionality, answer, evidenceFor(findGate(functionality, functionalityRun.current_node)));
}
assert.equal(functionalityRun.status, "COMPLETE");

const packet = composeRolePacket({role_id: "NAMED_LANE_WORKER", lane_id: "functionality", graph_ids: ["CORE", "FUNCTIONALITY"]});
assert.equal(validateRolePacket(packet).digest, packet.digest);
const regulator = composeRolePacket({role_id: "INTENT_REGULATOR", graph_ids: ["CORE"]});
assert.equal(validateRolePacket(regulator).lifetime, "PERSISTENT");

const schemaText = await readFile(path.join(ROOT, "schemas/gate-graph.v1.json"), "utf8");
assert.equal(JSON.parse(schemaText).$id, "agentos.gate-graph.v1");

console.log(JSON.stringify({status: "PASS", graphs: [core.graph_id, functionality.graph_id], roles: [packet.role_id, regulator.role_id]}));

