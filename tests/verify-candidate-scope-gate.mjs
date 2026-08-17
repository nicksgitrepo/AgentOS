#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import {
  CANDIDATE_SCOPE_GATE_HOSTILE_FIXTURES,
  CANDIDATE_SCOPE_MODES,
  compileCandidateScopeGate,
  validateCandidateScopeGate,
} from "../control/candidate-scope-gate.mjs";

const refs = {
  actionRef: "ref:action/candidate-scope",
  rollbackRef: "ref:rollback/candidate-scope",
  candidateScopeRef: "ref:evidence/isolated-candidate",
  finalCutoverScopeRef: "ref:evidence/final-cutover",
  zeroCostRef: "ref:evidence/zero-cost",
  preservationRef: "ref:evidence/preserved-legacy",
  rollbackEvidenceRef: "ref:evidence/rollback",
  delegatedAuthorityRef: "ref:evidence/delegated-authority",
};

const isolated = compileCandidateScopeGate({
  gateId: "GATE.CONTROLLER.CANDIDATE_SCOPE.ISOLATED",
  mode: CANDIDATE_SCOPE_MODES[0],
  ...refs,
});
assert.equal(isolated.stop_decision.outcome, "CONTINUE_AUTONOMOUS");
assert.equal(isolated.successor.route, "CONTINUE_ISOLATED_CANDIDATE_CUSTODY");
assert.equal(isolated.successor.stop, false);
validateCandidateScopeGate(isolated);

const finalCutover = compileCandidateScopeGate({
  gateId: "GATE.CONTROLLER.CANDIDATE_SCOPE.FINAL",
  mode: CANDIDATE_SCOPE_MODES[1],
  ...refs,
});
assert.equal(finalCutover.stop_decision.outcome, "STOP_OWNER_DECISION");
assert.equal(finalCutover.stop_decision.primary_trigger_question_id, "CHANGES_PROTECTED_PROJECT_OR_SCOPE");
assert.equal(finalCutover.successor.route, "WAIT_FOR_PROTECTED_RUNTIME_REPOINT_OR_RELEASE");
assert.equal(finalCutover.successor.stop, true);
validateCandidateScopeGate(finalCutover);

assert.deepEqual(finalCutover.hostile_fixture_refs, [...CANDIDATE_SCOPE_GATE_HOSTILE_FIXTURES].sort());
assert.throws(() => validateCandidateScopeGate({...isolated, mode: "FINAL_RUNTIME_GIT_REPOINT_OR_RELEASE"}), /stop|successor|scope/u);
assert.throws(() => compileCandidateScopeGate({...refs, gateId: "GATE.CONTROLLER.CANDIDATE_SCOPE.BAD", mode: "ISOLATED_CANDIDATE_CUSTODY", candidateScopeRef: "not-a-reference"}), /reference/u);

const schema = JSON.parse(fs.readFileSync(new URL("../schemas/candidate-scope-gate.v1.json", import.meta.url), "utf8"));
assert.equal(schema.$id, "https://agentos.dev/schemas/candidate-scope-gate.v1.json");
for (const relative of ["control/candidate-scope-gate.mjs", "schemas/candidate-scope-gate.v1.json"]) {
  const source = fs.readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");
  assert(!/Sociuna|JobSight|WellSight/iu.test(source), `${relative} contains consumer-specific policy`);
}

console.log("PASS candidate-scope gate: isolated custody continues, final cutover stops, and scope conflation is rejected");
