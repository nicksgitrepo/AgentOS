#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  compileImportOrchestratorTestFailureGate,
  validateImportOrchestratorTestFailureGate,
  IMPORT_ORCHESTRATOR_TEST_FAILURE_GATE_SCHEMA,
} from "../control/import-orchestrator-test-failure-gate.mjs";

const sha = (value) => value.repeat(64).slice(0, 64);
const authority = {commit: sha("a"), tree: sha("b"), receipt_sha256: sha("c")};
const evidence = (id) => ({evidence_id: id, reference: `ref:test/${id.toLowerCase()}`, sha256: sha("d")});
const baseCheck = {
  defect_code: "DEFECT.AGENTOS.TEST.IMPORT_ORCHESTRATOR.STALE_CLEARANCE_EXPECTATION",
  command: "node tests/verify-import-orchestrator.mjs",
  file: "tests/verify-import-orchestrator.mjs",
  line: 200,
  actual: "ACTIVE",
  expected: "REPAIRING",
  assertion: "assert.equal(held.state, expected)",
};
const compilerFacts = {
  boundary_id: "INDEPENDENT.UTILITY_HARM_CLEARANCE",
  boundary_scope: "APPLICABILITY_ONLY_LOCAL",
  clearance_applicability: "NOT_APPLICABLE_LOCAL_COMPILER_QA",
  run_state: "BLOCKED_PROTECTED",
  open_findings_count: 0,
  isolated_local_custody: false,
  source_roots_preserved: true,
  shared_workspace_read_only: true,
  wave_activation: "OFF",
  provider_access: false,
  credential_access: false,
  external_sync: false,
  spend: false,
  destructive_work: false,
  derived_next_action: "REQUEST_SPAWNER_QA",
  derived_next_handler: "HANDLER.ORCHESTRATOR_SPAWNER_QA",
};
const gate = compileImportOrchestratorTestFailureGate({
  gateId: "GATE.IMPORT_ORCHESTRATOR.TEST_FAILURE.STALE_CLEARANCE",
  authorityBinding: authority,
  failedCheck: baseCheck,
  routeFacts: compilerFacts,
  evidenceRefs: [evidence("EVIDENCE.AUTHORITY"), evidence("EVIDENCE.FAILED_CHECK")],
  hostileFixtureRefs: ["FIXTURE.TEST.NULL_DIGEST", "FIXTURE.TEST.PROTECTED_ROUTE", "FIXTURE.TEST.STALE_EXPECTATION"],
});
validateImportOrchestratorTestFailureGate(gate, {authority});
assert.equal(gate.schema, IMPORT_ORCHESTRATOR_TEST_FAILURE_GATE_SCHEMA);
assert.equal(gate.decision, "STALE_EXPECTATION_REPAIR_REQUIRED");
assert.equal(gate.repair_block.next_action, "REPAIR_BLOCKS");
assert.equal(gate.custody.controller_approval_required, false);

const hostile = (change, pattern) => {
  const candidate = structuredClone(gate);
  change(candidate);
  assert.throws(() => validateImportOrchestratorTestFailureGate(candidate, {authority}), pattern);
};
hostile((candidate) => { candidate.gate_sha256 = sha("e"); }, /digest mismatch/u);
hostile((candidate) => { candidate.authority_binding.tree = sha("f"); }, /authority is stale/u);
hostile((candidate) => { candidate.custody.controller_approval_required = true; }, /Controller approval/u);
hostile((candidate) => { candidate.route_facts.clearance_applicability = "REQUIRED_PROTECTED_ROUTE"; }, /gate digest mismatch|route facts/u);
hostile((candidate) => { candidate.hostile_fixture_refs.push("FIXTURE.TEST.NULL_DIGEST"); }, /sorted and unique/u);
hostile((candidate) => { candidate.failed_check.actual = candidate.failed_check.expected; }, /real mismatch/u);

const protectedFacts = {...compilerFacts,
  boundary_id: "BOUNDED_LOCAL_INTEGRATION",
  boundary_scope: "PROTECTED_INTEGRATION",
  clearance_applicability: "REQUIRED_PROTECTED_ROUTE",
  derived_next_action: "START_CENTRAL_INTEGRATION",
  derived_next_handler: "HANDLER.ORCHESTRATOR_CENTRAL_INTEGRATION",
};
const protectedGate = compileImportOrchestratorTestFailureGate({
  gateId: "GATE.IMPORT_ORCHESTRATOR.TEST_FAILURE.PROTECTED_ROUTE",
  authorityBinding: authority,
  failedCheck: {...baseCheck, actual: "ACTIVE", expected: "PROTECTED_WAIT"},
  routeFacts: protectedFacts,
  evidenceRefs: [evidence("EVIDENCE.AUTHORITY"), evidence("EVIDENCE.FAILED_CHECK")],
  hostileFixtureRefs: ["FIXTURE.TEST.PROTECTED_ROUTE"],
});
assert.equal(protectedGate.decision, "PROTECTED_ROUTE_REPAIR_REQUIRED");
assert.equal(protectedGate.repair_block.route_kind, "PROTECTED_ROUTE_REPAIR");

console.log(JSON.stringify({
  status: "PASS",
  schema: gate.schema,
  hostile_cases: 7,
  local_route: gate.route_facts.derived_next_action,
  protected_route: protectedGate.decision,
  next_action: gate.repair_block.next_action,
}));
